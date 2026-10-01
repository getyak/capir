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
                return .init(reachable: false, summary: "未收到网页响应", detail: "请确认这是工作区的网页入口。")
            }
            let ok = (200...299).contains(http.statusCode) || [401, 403].contains(http.statusCode)
            return .init(reachable: ok, summary: ok ? "服务可以访问" : "服务尚未就绪",
                         detail: "HTTP \(http.statusCode) · 连通性检查不代表已登录或后端业务正常。")
        } catch {
            let code = (error as NSError).code
            let detail: String
            switch code {
            case NSURLErrorTimedOut: detail = "连接超时。请检查 Tailscale、代理和服务端口。"
            case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed: detail = "无法解析地址。请检查拼写和 Tailscale 连接。"
            case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted,
                 NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateHasUnknownRoot:
                detail = "安全连接未通过验证。请检查服务证书。"
            case NSURLErrorCancelled: detail = "检查已取消。"
            default: detail = "请检查网络与工作区服务，然后重试。"
            }
            return .init(reachable: false, summary: "暂时无法连接", detail: detail)
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
