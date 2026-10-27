import Foundation
import CryptoKit
import Combine

/// Connection preferences contain addresses and UI choices, never credentials.
@MainActor
final class WorkspaceConnection: ObservableObject {
    static let shared = WorkspaceConnection()
    @Published private(set) var origin: WorkspaceOrigin?
    @Published private(set) var allowsLocalDevelopment: Bool
    @Published var inspectorEnabled: Bool {
        didSet { defaults.set(inspectorEnabled, forKey: "workspace.desktop.inspector") }
    }
    /// Published store-epoch changes: every WebKit host retires surfaces built
    /// for an older epoch when a deliberate new primary login selects a store.
    @Published private(set) var storeEpoch: UInt64 = 0
    private let defaults: UserDefaults
    private var storeObservation: AnyCancellable?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        allowsLocalDevelopment = defaults.bool(forKey: "workspace.connection.localDevelopment")
        inspectorEnabled = defaults.bool(forKey: "workspace.desktop.inspector")
        origin = WorkspaceOrigin.configured(saved: defaults.string(forKey: "workspace.web.origin") ?? "",
                                            allowLocalDevelopment: allowsLocalDevelopment)
        storeObservation = LoginStoreRegistry.shared.changes.sink { [weak self] selection in
            guard self?.origin?.url.absoluteString == selection.origin else { return }
            self?.storeEpoch = selection.epoch
        }
    }

    func save(_ value: String, allowLocalDevelopment: Bool) -> Bool {
        guard let parsed = Self.parseInput(value, allowLocalDevelopment: allowLocalDevelopment) else { return false }
        defaults.set(parsed.url.absoluteString, forKey: "workspace.web.origin")
        defaults.set(allowLocalDevelopment, forKey: "workspace.connection.localDevelopment")
        allowsLocalDevelopment = allowLocalDevelopment
        origin = parsed
        return true
    }

    static func parseInput(_ value: String, allowLocalDevelopment: Bool) -> WorkspaceOrigin? {
        guard var parts = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" || parts.path == "/workspace" || parts.path.hasPrefix("/workspace/")
        else { return nil }
        parts.path = ""
        guard let origin = parts.url else { return nil }
        return WorkspaceOrigin(origin.absoluteString, allowLocalDevelopment: allowLocalDevelopment)
    }
}

extension WorkspaceOrigin {
    /// WebKit cookies ignore ports. Separate stores also isolate same-host test environments.
    /// The application-owned registry selects the persistent store for this
    /// origin (ADR 0021/0022). Nil means the registry is corrupt or its write
    /// failed: hosts must refuse to build a WebKit surface instead of silently
    /// adopting legacy state.
    @MainActor var dataStoreIdentifier: UUID? {
        LoginStoreRegistry.shared.storeIdentifierIfHealthy(for: url.absoluteString)
    }
}

struct ConnectionProbeResult: Equatable {
    let reachable: Bool
    let summary: String
    let detail: String
}

/// A diagnostic result belongs to one endpoint and one explicit check.
/// Endpoint changes and closing Settings revoke even a non-cooperative task's
/// ability to publish a result. Callers also resolve presentation by endpoint,
/// so an old result cannot paint during SwiftUI's change-notification turn.
@MainActor
final class WorkspaceConnectionProbeController: ObservableObject {
    typealias Probe = @MainActor (WorkspaceOrigin) async -> ConnectionProbeResult
    @Published private var completed: ConnectionProbeResult?
    @Published private var checking = false
    private var origin: WorkspaceOrigin?
    private var requestID = UUID()
    private var task: Task<Void, Never>?
    private let probe: Probe

    init(probe: @escaping Probe = { await WorkspaceConnectionProbe(origin: $0).run() }) {
        self.probe = probe
    }

    func result(for origin: WorkspaceOrigin?) -> ConnectionProbeResult? {
        origin != nil && self.origin == origin ? completed : nil
    }

    func isChecking(for origin: WorkspaceOrigin?) -> Bool {
        origin != nil && self.origin == origin && checking
    }

    func reset(for origin: WorkspaceOrigin?) {
        task?.cancel()
        task = nil
        requestID = UUID()
        self.origin = origin
        completed = nil
        checking = false
    }

    func check(_ origin: WorkspaceOrigin?) {
        guard let origin, !isChecking(for: origin) else { return }
        reset(for: origin)
        checking = true
        let requestID = self.requestID
        task = Task { [weak self, probe] in
            let result = await probe(origin)
            guard !Task.isCancelled, let self,
                  self.origin == origin, self.requestID == requestID else { return }
            self.completed = result
            self.checking = false
            self.task = nil
        }
    }

    deinit { task?.cancel() }
}

/// No cookies, credentials, response body retention or redirect-based host discovery.
final class WorkspaceConnectionProbe: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let origin: WorkspaceOrigin
    init(origin: WorkspaceOrigin) { self.origin = origin }

    func run() async -> ConnectionProbeResult {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 10
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: origin.url.appendingPathComponent("login"))
        request.httpMethod = "HEAD"
        do {
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .init(reachable: false, summary: String(localized: "No web response received", bundle: .main), detail: String(localized: "Confirm that this is the workspace web entry point.", bundle: .main))
            }
            let ok = (200...299).contains(http.statusCode) || [401, 403].contains(http.statusCode)
            return .init(reachable: ok, summary: ok ? String(localized: "Service is reachable", bundle: .main) : String(localized: "Service is not ready", bundle: .main),
                         detail: String(format: String(localized: "HTTP %lld · Reachability does not mean you are signed in or that backend business services are healthy.", bundle: .main), Int64(http.statusCode)))
        } catch {
            let code = (error as NSError).code
            let detail: String
            switch code {
            case NSURLErrorTimedOut: detail = String(localized: "Connection timed out. Check Tailscale, the proxy, and service ports.", bundle: .main)
            case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed: detail = String(localized: "Unable to resolve the address. Check the spelling and Tailscale connection.", bundle: .main)
            case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted,
                 NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateHasUnknownRoot:
                detail = String(localized: "Secure connection verification failed. Check the service certificate.", bundle: .main)
            case NSURLErrorCancelled: detail = String(localized: "Check cancelled.", bundle: .main)
            default: detail = String(localized: "Check the network and workspace service, then retry.", bundle: .main)
            }
            return .init(reachable: false, summary: String(localized: "Unable to connect right now", bundle: .main), detail: detail)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map(origin.contains) == true ? request : nil)
    }
}

/// Only explicit main-frame links from the configured workspace can request native chrome actions.
enum DesktopChromeAction: Equatable {
    case settings, updates
    case accountSettings(AccountSettingsDestination)
    case installUpdate(UUID)

    static func resolve(_ target: URL, source: URL?, origin: WorkspaceOrigin,
                        mainFrame: Bool, userActivated: Bool) -> DesktopChromeAction? {
        guard mainFrame, userActivated, let source, origin.contains(source),
              target.scheme == "talentsignal-desktop", target.user == nil, target.password == nil,
              target.port == nil, target.fragment == nil,
              target.path.isEmpty, let host = target.host else { return nil }
        if host == "install-update" {
            guard let items = URLComponents(url: target, resolvingAgainstBaseURL: false)?.queryItems,
                  items.count == 1, items[0].name == "offer", let value = items[0].value,
                  let offerID = UUID(uuidString: value) else { return nil }
            return .installUpdate(offerID)
        }
        // Account settings always open in the default browser. Only the fixed
        // allowlisted section may cross the boundary; nothing else is read from
        // the URL, so no token, email or account identifier can ride along.
        if host == "account-settings" {
            // `queryItems` is nil when there is no query at all, which is the
            // ordinary "open the settings overview" link.
            let items = URLComponents(url: target, resolvingAgainstBaseURL: false)?.queryItems ?? []
            guard items.count <= 1 else { return nil }
            if let item = items.first {
                guard item.name == "section", let value = item.value,
                      let destination = AccountSettingsDestination(rawValue: value) else { return nil }
                return .accountSettings(destination)
            }
            return .accountSettings(.overview)
        }
        guard target.query == nil else { return nil }
        switch host {
        case "settings": return .settings
        case "updates": return .updates
        default: return nil
        }
    }
}
