import CryptoKit
import Foundation

struct RuntimeEnvironmentProfile: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let endpoint: URL
    let expectedDeploymentID: String?
}

struct RuntimeDeploymentManifest: Codable, Equatable {
    let service: String
    let contract_version: String
    let deployment_id: String?
    let revision: String?
    let data_domain: String
    let internal_lab_enabled: Bool
    let authentication: Authentication
    struct Authentication: Codable, Equatable {
        let apple: Bool
        let password: Bool
        let simulated: Bool
    }
}

struct VerifiedRuntimeTarget: Equatable {
    let profile: RuntimeEnvironmentProfile
    let manifest: RuntimeDeploymentManifest
    let checkedAt: Date
}

enum RuntimeEnvironmentError: LocalizedError {
    case untrustedEndpoint, redirect, unavailable, incompatible, identityMismatch, identityUnavailable, expiredPreflight, busy
    case protectedWorkspaceActive
    var errorDescription: String? {
        switch self {
        case .untrustedEndpoint: "This endpoint is not in the build's approved environment directory."
        case .redirect: "The backend redirected its request. Use the approved final endpoint."
        case .unavailable: "The target backend is not ready. The current environment is unchanged."
        case .incompatible: "This backend uses an incompatible service contract."
        case .identityMismatch: "The deployed backend identity does not match the approved target."
        case .identityUnavailable: "The backend has not reported its deployment identity."
        case .expiredPreflight: "Check this environment again before switching."
        case .busy: "Finish active requests, sign-in or recording before switching environments."
        case .protectedWorkspaceActive: "Return from or finish the protected test workspace before switching backends."
        }
    }
}

enum RuntimeEndpoint {
    static func canonical(_ url: URL) -> String {
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        parts.scheme = parts.scheme?.lowercased()
        parts.host = parts.host?.lowercased()
        if (parts.scheme == "https" && parts.port == 443) || (parts.scheme == "http" && parts.port == 80) { parts.port = nil }
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        return parts.string ?? url.absoluteString
    }
    static func same(_ first: URL, _ second: URL) -> Bool { canonical(first) == canonical(second) }
    static func relativeRoute(_ url: URL, endpoint: URL) -> String? {
        func port(_ value: URL) -> Int? { value.port ?? (value.scheme?.lowercased() == "https" ? 443 : value.scheme?.lowercased() == "http" ? 80 : nil) }
        guard url.scheme?.lowercased() == endpoint.scheme?.lowercased(), url.host?.lowercased() == endpoint.host?.lowercased(),
              port(url) == port(endpoint) else { return nil }
        var prefix = endpoint.path
        while prefix.hasSuffix("/") { prefix.removeLast() }
        guard prefix.isEmpty || url.path == prefix || url.path.hasPrefix(prefix + "/") else { return nil }
        return String(url.path.dropFirst(prefix.count))
    }
    static func permitted(_ url: URL, allowsLoopbackHTTP: Bool) -> Bool {
        guard let host = url.host?.lowercased(), !host.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              !url.pathComponents.contains("..") else { return false }
        if url.scheme?.lowercased() == "https" { return true }
        return allowsLoopbackHTTP && url.scheme == "http" && ["127.0.0.1", "localhost", "::1", "[::1]"].contains(host)
    }
    static func scope(_ url: URL, accountID: String? = nil, userID: String? = nil) -> String {
        SHA256.hex([canonical(url), accountID ?? "", userID ?? ""].joined(separator: "|"))
    }
}

struct RuntimeEnvironmentDirectory {
    let profiles: [RuntimeEnvironmentProfile]
    let buildEndpoint: URL?
    private let defaults: UserDefaults
    private let selectionKey: String

    init(buildEndpoint: URL?, info: [String: Any] = Bundle.main.infoDictionary ?? [:],
         defaults: UserDefaults = .standard, allowsLoopbackHTTP: Bool = _isDebugAssertConfiguration()) {
        self.buildEndpoint = buildEndpoint
        self.defaults = defaults
        selectionKey = "talent-signal.runtime.selected.\(buildEndpoint.map { RuntimeEndpoint.scope($0) } ?? "local")"
        var configured: [RuntimeEnvironmentProfile] = []
        if let buildEndpoint, RuntimeEndpoint.permitted(buildEndpoint, allowsLoopbackHTTP: allowsLoopbackHTTP) {
            configured.append(.init(id: "build-default", name: "Build default", endpoint: buildEndpoint, expectedDeploymentID: nil))
        }
        if DeviceLabAvailability.enabled, let encoded = info["TalentSignalEnvironmentProfilesBase64URL"] as? String {
            var base64 = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
            if let data = Data(base64Encoded: base64), let items = try? JSONDecoder().decode([RuntimeEnvironmentProfile].self, from: data) {
                for item in items.prefix(12) where !item.id.isEmpty && !item.name.isEmpty
                    && item.expectedDeploymentID?.isEmpty == false
                    && RuntimeEndpoint.permitted(item.endpoint, allowsLoopbackHTTP: allowsLoopbackHTTP)
                    && !configured.contains(where: { $0.id == item.id || RuntimeEndpoint.same($0.endpoint, item.endpoint) }) {
                    configured.append(item)
                }
            }
        }
        profiles = configured
    }
    var selected: RuntimeEnvironmentProfile? {
        profiles.first(where: { $0.id == defaults.string(forKey: selectionKey) })
            ?? profiles.first(where: { $0.id == "build-default" })
    }
    func saveSelection(_ target: RuntimeEnvironmentProfile) throws {
        guard profiles.contains(target) else { throw RuntimeEnvironmentError.untrustedEndpoint }
        defaults.set(target.id, forKey: selectionKey)
    }
}

protocol RuntimePreflighting {
    func verify(_ target: RuntimeEnvironmentProfile) async throws -> VerifiedRuntimeTarget
}

actor RuntimePreflightClient: RuntimePreflighting {
    private let session: URLSession
    init(session: URLSession = TalentSignalNetworking.session) { self.session = session }
    func verify(_ target: RuntimeEnvironmentProfile) async throws -> VerifiedRuntimeTarget {
        // No authentication token, cookies, headers, or body are copied from the source environment.
        var request = URLRequest(url: target.endpoint.appending(path: "v1/runtime/manifest"))
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await TalentSignalNetworking.data(for: request, using: session)
        try validate(response)
        let manifest = try JSONDecoder().decode(RuntimeDeploymentManifest.self, from: data)
        guard manifest.service == "talent-signal", manifest.contract_version == TalentSignalAPIContract.version else {
            throw RuntimeEnvironmentError.incompatible
        }
        guard let identity = manifest.deployment_id, !identity.isEmpty else { throw RuntimeEnvironmentError.identityUnavailable }
        if let expected = target.expectedDeploymentID, identity != expected { throw RuntimeEnvironmentError.identityMismatch }
        request.url = target.endpoint.appending(path: "health/ready")
        let (_, ready) = try await TalentSignalNetworking.data(for: request, using: session)
        try validate(ready)
        return .init(profile: target, manifest: manifest, checkedAt: .now)
    }
    private func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw RuntimeEnvironmentError.unavailable }
        if (300...399).contains(http.statusCode) { throw RuntimeEnvironmentError.redirect }
        guard http.statusCode == 200 else { throw RuntimeEnvironmentError.unavailable }
    }
}

enum TalentSignalNetworking {
    static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 30
        return URLSession(configuration: configuration, delegate: RuntimeRedirectGuard(), delegateQueue: nil)
    }()
}

class RuntimeRedirectGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // API origins are approved explicitly. Never follow a redirect with session credentials.
        completionHandler(nil)
    }
}
