import AppKit
import CryptoKit
import Foundation
import LocalAuthentication
import Security
import WebKit

/// The capability is scoped to one verified account and one selected WebKit
/// store. Its secret is never serialized outside the system Keychain.
struct DesktopDeviceCredential: Codable, Equatable {
    let origin: String
    let storeIdentifier: UUID
    let epoch: UInt64
    let accountID: String
    let userID: String
    let sessionID: String
    let secret: String
    var enrolled: Bool

    func matches(_ selection: LoginStoreSelection) -> Bool {
        origin == selection.origin && storeIdentifier == selection.storeIdentifier && epoch == selection.epoch
            && UUID(uuidString: accountID) != nil && UUID(uuidString: userID) != nil
            && UUID(uuidString: sessionID) != nil && secret.count == 43
            && secret.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil
    }
}

enum DesktopDeviceCredentialError: Error { case keychainUnavailable, invalidRecord }

protocol DesktopDeviceCredentialStoring: AnyObject {
    func read(for selection: LoginStoreSelection) throws -> DesktopDeviceCredential?
    func write(_ credential: DesktopDeviceCredential, for selection: LoginStoreSelection) throws
    func remove(for selection: LoginStoreSelection) throws
}

/// This Developer-ID app uses the login Keychain with its stable designated
/// signing requirement; it does not opt into the entitlement-dependent data
/// protection Keychain or synchronize the capability through iCloud.
/// Sources: Apple TN3137; developer.apple.com/documentation/security/secitemadd(_:_:)
final class KeychainDesktopDeviceCredentialStore: DesktopDeviceCredentialStoring {
    private static let service = "com.talentsignal.macos.persistent-session.v1"
    private func query(_ selection: LoginStoreSelection) -> [String: Any] {
        let scope = "\(selection.origin)|\(selection.storeIdentifier.uuidString)|\(selection.epoch)"
        let account = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: Self.service, kSecAttrAccount as String: account,
                kSecUseDataProtectionKeychain as String: false]
    }
    func read(for selection: LoginStoreSelection) throws -> DesktopDeviceCredential? {
        var request = query(selection)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        let context = LAContext()
        context.interactionNotAllowed = true
        request[kSecUseAuthenticationContext as String] = context
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw DesktopDeviceCredentialError.keychainUnavailable }
        guard data.count <= 4096, let value = try? JSONDecoder().decode(DesktopDeviceCredential.self, from: data),
              value.matches(selection) else { throw DesktopDeviceCredentialError.invalidRecord }
        return value
    }
    func write(_ credential: DesktopDeviceCredential, for selection: LoginStoreSelection) throws {
        guard credential.matches(selection) else { throw DesktopDeviceCredentialError.invalidRecord }
        let data = try JSONEncoder().encode(credential)
        let request = query(selection)
        let update = SecItemUpdate(request as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw DesktopDeviceCredentialError.keychainUnavailable }
        var addition = request
        addition[kSecValueData as String] = data
        addition[kSecAttrLabel as String] = "capri device sign-in"
        guard SecItemAdd(addition as CFDictionary, nil) == errSecSuccess else { throw DesktopDeviceCredentialError.keychainUnavailable }
    }
    func remove(for selection: LoginStoreSelection) throws {
        let status = SecItemDelete(query(selection) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw DesktopDeviceCredentialError.keychainUnavailable }
    }
}

struct DesktopPersistentSessionReceipt: Decodable, Equatable {
    let status: String
    var account_id: String? = nil
    var user_id: String? = nil
    var session_id: String? = nil
    var session_expires_at: String? = nil

    var authenticated: Bool {
        status == "authenticated" && UUID(uuidString: account_id ?? "") != nil
            && UUID(uuidString: user_id ?? "") != nil && UUID(uuidString: session_id ?? "") != nil
            && session_expires_at.flatMap(desktopLoginDate).map { $0 > Date() } == true
    }
    func matches(_ credential: DesktopDeviceCredential) -> Bool {
        authenticated && account_id == credential.accountID && user_id == credential.userID && session_id == credential.sessionID
    }
}

@MainActor
protocol DesktopPersistentSessionTransporting: AnyObject {
    func status(selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt
    func submit(_ action: String, credential: DesktopDeviceCredential, selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt
    func cancel()
}

enum DesktopPersistentSessionOutcome: Equatable {
    case authenticated(DesktopPersistentSessionReceipt), needsLogin, unavailable, cancelled
}

/// One in-flight operation per canonical origin; all user-visible admission
/// follows a separate read-only live readback in that exact selected store.
@MainActor
final class DesktopPersistentSessionCoordinator {
    static let shared = DesktopPersistentSessionCoordinator()
    private struct Operation {
        let ticket: UUID
        let selection: LoginStoreSelection
        let transport: DesktopPersistentSessionTransporting
        let task: Task<DesktopPersistentSessionOutcome, Never>
    }
    private let registry: LoginStoreRegistry
    private let vault: DesktopDeviceCredentialStoring
    private let transportFactory: (WorkspaceOrigin) -> DesktopPersistentSessionTransporting
    private var operations: [String: Operation] = [:]
    private var signedOutStores: Set<UUID> = []

    init(registry: LoginStoreRegistry? = nil, vault: DesktopDeviceCredentialStoring? = nil,
         transportFactory: ((WorkspaceOrigin) -> DesktopPersistentSessionTransporting)? = nil) {
        let owner = registry ?? .shared
        self.registry = owner
        self.vault = vault ?? KeychainDesktopDeviceCredentialStore()
        self.transportFactory = transportFactory ?? { DesktopPersistentSessionWKTransport(origin: $0, registry: owner) }
    }

    func restore(in origin: WorkspaceOrigin) async -> DesktopPersistentSessionOutcome {
        let key = origin.url.absoluteString
        guard let selection = try? registry.selection(for: key) else { return .unavailable }
        guard !selection.unresolved, !signedOutStores.contains(selection.storeIdentifier) else { return .needsLogin }
        if let running = operations[key], registry.isCurrent(running.selection) { return await running.task.value }
        let ticket = UUID(), transport = transportFactory(origin)
        let task = Task { await self.perform(origin: origin, selection: selection, transport: transport, ticket: ticket) }
        operations[key] = Operation(ticket: ticket, selection: selection, transport: transport, task: task)
        let result = await task.value
        if operations[key]?.ticket == ticket { operations[key] = nil }
        return result
    }

    private func current(_ selection: LoginStoreSelection, _ ticket: UUID) -> Bool {
        registry.isCurrent(selection) && operations[selection.origin]?.ticket == ticket
            && !signedOutStores.contains(selection.storeIdentifier) && !Task.isCancelled
    }

    private func perform(origin: WorkspaceOrigin, selection: LoginStoreSelection,
                         transport: DesktopPersistentSessionTransporting, ticket: UUID) async -> DesktopPersistentSessionOutcome {
        do {
            var credential = try vault.read(for: selection)
            var newlyCreated = false
            guard current(selection, ticket) else { return .cancelled }
            if credential == nil {
                let live = try await transport.status(selection: selection)
                guard current(selection, ticket) else { return .cancelled }
                if live.status == "signed_out" || live.status == "revoked" { return .needsLogin }
                guard live.authenticated else { return .unavailable }
                let secret = try DesktopBrowserLoginCoordinator.newSecrets().verifier
                credential = DesktopDeviceCredential(origin: selection.origin, storeIdentifier: selection.storeIdentifier,
                    epoch: selection.epoch, accountID: live.account_id!, userID: live.user_id!, sessionID: live.session_id!,
                    secret: secret, enrolled: false)
                try vault.write(credential!, for: selection)
                newlyCreated = true
            }
            guard var capability = credential, capability.matches(selection), current(selection, ticket) else { return .cancelled }
            var response = try await transport.submit(newlyCreated ? "enroll" : "renew", credential: capability, selection: selection)
            guard current(selection, ticket) else { return .cancelled }
            // A persisted pending capability may precede its enrollment. A lost
            // successful response renews first; only a still-live SAME session
            // can authorize the initial enrollment, never revive a revoked one.
            if !capability.enrolled && response.status == "revoked" {
                let live = try await transport.status(selection: selection)
                guard current(selection, ticket) else { return .cancelled }
                guard live.matches(capability) else {
                    if live.status == "signed_out" || live.status == "revoked" { try vault.remove(for: selection); return .needsLogin }
                    return .unavailable
                }
                response = try await transport.submit("enroll", credential: capability, selection: selection)
                guard current(selection, ticket) else { return .cancelled }
            }
            if response.status == "revoked" || response.status == "ineligible" {
                try vault.remove(for: selection)
                return .needsLogin
            }
            guard response.matches(capability) else { return .unavailable }
            let live = try await transport.status(selection: selection)
            guard current(selection, ticket) else { return .cancelled }
            guard live.matches(capability) else { return .unavailable }
            if !capability.enrolled {
                capability.enrolled = true
                try vault.write(capability, for: selection)
            }
            return .authenticated(live)
        } catch DesktopDeviceCredentialError.invalidRecord {
            guard current(selection, ticket) else { return .cancelled }
            try? vault.remove(for: selection)
            return .needsLogin
        } catch {
            return current(selection, ticket) ? .unavailable : .cancelled
        }
    }

    /// Commit a new empty store before any late response can write a cookie.
    /// Even if a locked Keychain prevents deletion, its old scope is no longer
    /// selected on this or a subsequent process launch.
    func signOut(in origin: WorkspaceOrigin) throws {
        let selection = try registry.selection(for: origin.url.absoluteString)
        signedOutStores.insert(selection.storeIdentifier)
        let credential = try? vault.read(for: selection)
        cancel(selection: selection)
        _ = try registry.endSession(for: selection.origin)
        try? vault.remove(for: selection)
        if let credential {
            let transport = transportFactory(origin)
            Task { _ = try? await transport.submit("revoke", credential: credential, selection: selection) }
        }
    }

    func cancel(selection: LoginStoreSelection) {
        guard let running = operations[selection.origin], running.selection.storeIdentifier == selection.storeIdentifier else { return }
        operations[selection.origin] = nil
        running.task.cancel(); running.transport.cancel()
    }
}

/// A dedicated hidden WK host shares only the selected persistent cookie jar;
/// it never receives workspace JavaScript, a bridge, or a native bearer token.
@MainActor
final class DesktopPersistentSessionWKTransport: NSObject, DesktopPersistentSessionTransporting, WKNavigationDelegate {
    private static let world = WKContentWorld.world(name: "capri.persistent-session.readback")
    private let origin: WorkspaceOrigin
    private let registry: LoginStoreRegistry
    private var selection: LoginStoreSelection?
    private var webView: WKWebView?
    private var continuation: CheckedContinuation<Void, Error>?
    private var navigation: WKNavigation?
    private var timeout: Task<Void, Never>?
    private var revoking = false
    private var endpoint: URL { origin.url.appendingPathComponent("api/desktop-auth/persistent") }

    init(origin: WorkspaceOrigin, registry: LoginStoreRegistry) { self.origin = origin; self.registry = registry }

    private func validate(_ selection: LoginStoreSelection) throws {
        guard selection.origin == origin.url.absoluteString, (revoking || registry.isCurrent(selection)), !Task.isCancelled else { throw CancellationError() }
    }
    private func load(_ request: URLRequest, selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt {
        try validate(selection)
        if webView == nil {
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: selection.storeIdentifier)
            webView = WKWebView(frame: .zero, configuration: configuration)
            webView?.navigationDelegate = self
        }
        self.selection = selection
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            navigation = webView?.load(request)
            guard navigation != nil else { finish(.failure(URLError(.badServerResponse))); return }
            timeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(20))
                guard !Task.isCancelled else { return }
                self?.finish(.failure(URLError(.timedOut))); self?.webView?.stopLoading()
            }
        }
        try validate(selection)
        let raw = try await webView!.callAsyncJavaScript("return document.body?.textContent ?? '';", arguments: [:], in: nil, contentWorld: Self.world)
        try validate(selection)
        guard let text = raw as? String, let data = text.data(using: .utf8), data.count <= 4096,
              let receipt = try? JSONDecoder().decode(DesktopPersistentSessionReceipt.self, from: data) else { throw URLError(.badServerResponse) }
        return receipt
    }
    func status(selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt {
        try await load(URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData), selection: selection)
    }
    func submit(_ action: String, credential: DesktopDeviceCredential, selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt {
        revoking = action == "revoke"
        guard credential.matches(selection), ["enroll", "renew", "revoke"].contains(action) else { throw URLError(.badURL) }
        var request = URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("1", forHTTPHeaderField: "x-capri-desktop-session")
        // Native WK navigation is not a browser form; supply its exact
        // configured origin instead of relying on WebKit's opaque/null Origin.
        request.setValue(origin.url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["action": action, "device_secret": credential.secret,
            "account_id": credential.accountID, "user_id": credential.userID])
        return try await load(request, selection: selection)
    }
    private func finish(_ result: Result<Void, Error>) {
        let pending = continuation; continuation = nil; navigation = nil
        timeout?.cancel(); timeout = nil; pending?.resume(with: result)
    }
    func cancel() { finish(.failure(CancellationError())); webView?.stopLoading() }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard action.targetFrame?.isMainFrame != false, action.request.url == endpoint, let selection,
              revoking || registry.isCurrent(selection) else { decisionHandler(.cancel); finish(.failure(CancellationError())); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard response.isForMainFrame, response.response.url == endpoint else { decisionHandler(.cancel); finish(.failure(URLError(.badServerResponse))); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard navigation === self.navigation else { return }; finish(.success(()))
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard navigation === self.navigation else { return }; finish(.failure(error))
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard navigation === self.navigation else { return }; finish(.failure(error))
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish(.failure(URLError(.networkConnectionLost))) }
}
