import AppKit
import AuthenticationServices
import CryptoKit
import Foundation
import WebKit
import Combine

struct DesktopLoginIdentity: Equatable {
    let accountID: String
    let userID: String
}

enum DesktopBrowserLoginPhase: Equatable {
    case idle, preparing, waiting, exchanging, cancelled, unresolved
    case completed(accountID: String, userID: String)
    case failed(String)
}

struct DesktopBrowserLoginOperation: Equatable {
    let attemptID: String
    let state: String
    let verifier: String
    let cancelSecret: String
    let matchingHint: String
    let expiresAt: Date
    let selection: LoginStoreSelection
    var storeEpoch: UInt64 { selection.epoch }
    var storeIdentifier: UUID { selection.storeIdentifier }
}

enum DesktopBrowserLoginCallback {
    static let scheme = "com.talentsignal.macos.auth"
    static let host = "complete"
    static func isBoundedSecret(_ value: String) -> Bool {
        (32...256).contains(value.count) && value.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil
    }
    static func parse(_ url: URL) -> (attempt: String, code: String, state: String)? {
        guard url.scheme == scheme, url.host == host, url.path.isEmpty,
              url.user == nil, url.password == nil, url.port == nil, url.fragment == nil,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              items.count == 3, items.map(\.name).sorted() == ["attempt", "code", "state"],
              let attempt = items.first(where: { $0.name == "attempt" })?.value, UUID(uuidString: attempt) != nil,
              let code = items.first(where: { $0.name == "code" })?.value, isBoundedSecret(code),
              let state = items.first(where: { $0.name == "state" })?.value, isBoundedSecret(state) else { return nil }
        return (attempt, code, state)
    }
}

func desktopLoginDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let parsed = formatter.date(from: value) { return parsed }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}

struct DesktopPreparedGrant: Decodable {
    let attempt_id: String
    let authorization_url: String
    let expires_at: String
    let matching_hint: String
}
struct DesktopGrantResult: Decodable {
    let attempt_id: String
    let state: String
    let account_id: String?
    let user_id: String?
    let committed: Bool
    var identity: DesktopLoginIdentity? {
        guard let account_id, let user_id, UUID(uuidString: account_id) != nil, UUID(uuidString: user_id) != nil else { return nil }
        return .init(accountID: account_id, userID: user_id)
    }
}

protocol DesktopLoginTransporting {
    func prepare(challenge: String, state: String, cancelSecret: String) async throws -> DesktopPreparedGrant
    func result(operation: DesktopBrowserLoginOperation) async throws -> DesktopGrantResult
    func cancel(operation: DesktopBrowserLoginOperation) async throws
}

/// Anonymous requests have no cookies, credential storage, redirects or bearer
/// credentials. The configured first-party Web origin is the only destination.
final class DesktopBrowserLoginTransport: NSObject, URLSessionTaskDelegate, DesktopLoginTransporting, @unchecked Sendable {
    let origin: WorkspaceOrigin
    init(origin: WorkspaceOrigin) { self.origin = origin }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    private func post(_ path: String, _ body: [String: String]) async throws -> Data {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil; configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 10; configuration.timeoutIntervalForResource = 15
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: origin.url.appendingPathComponent(path))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.url.map(origin.contains) == true, data.count <= 65_536 else { throw URLError(.badServerResponse) }
        return data
    }
    func prepare(challenge: String, state: String, cancelSecret: String) async throws -> DesktopPreparedGrant {
        let data = try await post("api/desktop-auth/prepare", ["challenge": challenge, "state": state, "cancel_secret": cancelSecret])
        let grant = try JSONDecoder().decode(DesktopPreparedGrant.self, from: data)
        guard UUID(uuidString: grant.attempt_id) != nil,
              let entry = URL(string: grant.authorization_url), origin.contains(entry), entry.path == "/desktop-auth/authorize",
              entry.fragment == nil, let items = URLComponents(url: entry, resolvingAgainstBaseURL: false)?.queryItems,
              items.count == 2, items.map(\.name).sorted() == ["attempt", "state"],
              items.first(where: { $0.name == "attempt" })?.value == grant.attempt_id,
              items.first(where: { $0.name == "state" })?.value == state,
              let expires = desktopLoginDate(grant.expires_at), expires > Date(), expires <= Date().addingTimeInterval(305),
              grant.matching_hint.range(of: #"^[A-Z0-9-]{4,32}$"#, options: .regularExpression) != nil else { throw URLError(.badServerResponse) }
        return grant
    }
    func result(operation: DesktopBrowserLoginOperation) async throws -> DesktopGrantResult {
        let data = try await post("api/desktop-auth/grant-result", ["attempt_id": operation.attemptID, "verifier": operation.verifier])
        let result = try JSONDecoder().decode(DesktopGrantResult.self, from: data)
        guard result.attempt_id == operation.attemptID else { throw URLError(.badServerResponse) }
        return result
    }
    func cancel(operation: DesktopBrowserLoginOperation) async throws {
        _ = try await post("api/desktop-auth/cancel", ["attempt_id": operation.attemptID, "cancel_secret": operation.cancelSecret])
    }
}

@MainActor
protocol DesktopLoginExchanging: AnyObject {
    func exchange(operation: DesktopBrowserLoginOperation, code: String, expected: DesktopLoginIdentity) async throws -> DesktopLoginIdentity
    func readStatus(operation: DesktopBrowserLoginOperation, expected: DesktopLoginIdentity) async throws -> DesktopLoginIdentity
    func cancel()
}

/// A coordinator survives WebKit-host rotation. It owns one generation from
/// the user's gesture through live readback. No callback, DOM receipt, timeout
/// or cancellation alone can admit the workspace.
@MainActor
final class DesktopBrowserLoginCoordinator: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = DesktopBrowserLoginCoordinator()
    @Published private(set) var phase: DesktopBrowserLoginPhase = .idle
    @Published private(set) var matchingHint: String?
    private(set) var operation: DesktopBrowserLoginOperation?
    private(set) var returnTarget: URL?
    private let registry: LoginStoreRegistry
    private let originProvider: () -> WorkspaceOrigin?
    private let transportFactory: (WorkspaceOrigin) -> DesktopLoginTransporting
    private let exchangerFactory: () -> DesktopLoginExchanging
    private let launchOverride: ((URL, @escaping (URL?, Error?) -> Void) -> Bool)?
    private var authSession: ASWebAuthenticationSession?
    private var exchanger: DesktopLoginExchanging?
    private var work: Task<Void, Never>?
    private var expiryTask: Task<Void, Never>?
    private var generation = UUID()
    private var activeOrigin: WorkspaceOrigin?
    private var exchangeDispatched = false
    var canCheckResult: Bool { operation != nil && phase == .unresolved }

    init(registry: LoginStoreRegistry? = nil, originProvider: (() -> WorkspaceOrigin?)? = nil,
         transportFactory: ((WorkspaceOrigin) -> DesktopLoginTransporting)? = nil,
         exchangerFactory: (() -> DesktopLoginExchanging)? = nil,
         launchOverride: ((URL, @escaping (URL?, Error?) -> Void) -> Bool)? = nil) {
        self.registry = registry ?? .shared
        self.originProvider = originProvider ?? { WorkspaceConnection.shared.origin }
        self.transportFactory = transportFactory ?? { DesktopBrowserLoginTransport(origin: $0) }
        self.exchangerFactory = exchangerFactory ?? { DesktopBrowserLoginWKExchanger() }
        self.launchOverride = launchOverride
    }

    enum SecretGenerationError: Error { case randomSourceUnavailable }
    static func newSecrets() throws -> (verifier: String, challenge: String, state: String, cancelSecret: String) {
        func secret() throws -> String {
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw SecretGenerationError.randomSourceUnavailable }
            return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        }
        let verifier = try secret()
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        return (verifier, challenge, try secret(), try secret())
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApp.keyWindow ?? NSApp.mainWindow ?? ASPresentationAnchor()
    }
    private func current(_ ticket: UUID, _ selection: LoginStoreSelection, _ origin: WorkspaceOrigin) -> Bool {
        ticket == generation && originProvider() == origin && activeOrigin == origin && registry.isCurrent(selection)
    }
    func signedOut(in origin: WorkspaceOrigin) {
        if activeOrigin != nil && activeOrigin != origin { originChanged() }
        if case .completed = phase { operation = nil; phase = .idle }
        if phase == .idle && registry.hasUnresolvedLogin(for: origin.url.absoluteString) { phase = .unresolved }
    }
    func originChanged() {
        cancel(); generation = UUID(); operation = nil; activeOrigin = nil; matchingHint = nil; phase = .idle
    }

    func start(in origin: WorkspaceOrigin, returningTo target: URL?) {
        switch phase { case .preparing, .waiting, .exchanging: return; default: break }
        guard originProvider() == origin else { return }
        work?.cancel(); expiryTask?.cancel(); authSession?.cancel(); exchanger?.cancel()
        generation = UUID(); let ticket = generation
        operation = nil; matchingHint = nil; exchangeDispatched = false; activeOrigin = origin
        returnTarget = target.flatMap { origin.contains($0) && (($0.path == "/workspace" || $0.path.hasPrefix("/workspace/")) || $0.path == "/onboarding") && !WorkspaceSurfacePolicy.isSettingsOwned($0) ? $0 : nil }
        phase = .preparing
        do {
            let secrets = try Self.newSecrets()
            let selection = try registry.beginFreshPrimaryLogin(for: origin.url.absoluteString)
            let transport = transportFactory(origin)
            work = Task { [weak self] in
                guard let self else { return }
                do {
                    let prepared = try await transport.prepare(challenge: secrets.challenge, state: secrets.state, cancelSecret: secrets.cancelSecret)
                    guard let expiry = desktopLoginDate(prepared.expires_at), let entry = URL(string: prepared.authorization_url) else { throw URLError(.badServerResponse) }
                    let operation = DesktopBrowserLoginOperation(attemptID: prepared.attempt_id, state: secrets.state,
                        verifier: secrets.verifier, cancelSecret: secrets.cancelSecret, matchingHint: prepared.matching_hint,
                        expiresAt: expiry, selection: selection)
                    guard self.current(ticket, selection, origin), !Task.isCancelled else {
                        try? await transport.cancel(operation: operation); return
                    }
                    self.operation = operation; self.matchingHint = prepared.matching_hint; self.phase = .waiting
                    self.expiryTask = Task { [weak self] in
                        try? await Task.sleep(for: .seconds(max(0, expiry.timeIntervalSinceNow)))
                        guard !Task.isCancelled, let self, self.current(ticket, selection, origin), self.phase == .waiting else { return }
                        self.cancel(); self.phase = .failed("登录请求已过期，请重新登录。")
                    }
                    let callback: (URL?, Error?) -> Void = { [weak self] url, error in
                        Task { @MainActor in self?.receive(url, error: error, operation: operation, ticket: ticket, origin: origin) }
                    }
                    let started: Bool
                    if let launchOverride = self.launchOverride { started = launchOverride(entry, callback) }
                    else {
                        let session = ASWebAuthenticationSession(url: entry, callbackURLScheme: DesktopBrowserLoginCallback.scheme, completionHandler: callback)
                        session.prefersEphemeralWebBrowserSession = false; session.presentationContextProvider = self
                        self.authSession = session; NSApp.activate(ignoringOtherApps: true); started = session.start()
                    }
                    if !started { self.cancel(); self.phase = .failed("无法打开系统浏览器，请检查默认浏览器后重试。") }
                } catch {
                    guard self.current(ticket, selection, origin), !Task.isCancelled else { return }
                    self.phase = .failed("暂时无法连接登录服务，请重试或检查工作区地址。")
                }
            }
        } catch LoginStoreRegistryError.anotherInstance {
            phase = .failed("另一个 Talent Signal 实例正在使用登录状态。请关闭该实例后重试。")
        } catch {
            phase = .failed("无法保存本地登录状态。请检查磁盘与应用权限后重试。")
        }
    }

    private func receive(_ callback: URL?, error: Error?, operation: DesktopBrowserLoginOperation, ticket: UUID, origin: WorkspaceOrigin) {
        guard current(ticket, operation.selection, origin), self.operation == operation, phase == .waiting else { return }
        authSession = nil; expiryTask?.cancel(); expiryTask = nil
        guard let callback, let parsed = DesktopBrowserLoginCallback.parse(callback), parsed.attempt == operation.attemptID,
              parsed.state == operation.state, operation.expiresAt > Date() else {
            cancel(); phase = error == nil ? .failed("登录请求无效或已过期，请重新登录。") : .cancelled; return
        }
        phase = .exchanging
        let transport = transportFactory(origin)
        let exchange = exchangerFactory(); exchanger = exchange
        work = Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await transport.result(operation: operation)
                guard self.current(ticket, operation.selection, origin), !Task.isCancelled else { return }
                guard result.state == "approved", !result.committed, let expected = result.identity else { throw URLError(.badServerResponse) }
                self.exchangeDispatched = true
                let live = try await exchange.exchange(operation: operation, code: parsed.code, expected: expected)
                guard self.current(ticket, operation.selection, origin), !Task.isCancelled, live == expected else { return }
                try self.registry.resolveLogin(for: operation.selection.origin, epoch: operation.storeEpoch)
                self.operation = nil; self.matchingHint = nil; self.exchanger = nil
                self.phase = .completed(accountID: live.accountID, userID: live.userID)
            } catch {
                guard self.current(ticket, operation.selection, origin), !Task.isCancelled else { return }
                self.phase = .unresolved
            }
        }
    }

    func cancel() {
        let uncertain = exchangeDispatched
        generation = UUID(); work?.cancel(); work = nil; expiryTask?.cancel(); expiryTask = nil
        authSession?.cancel(); authSession = nil; exchanger?.cancel()
        if let operation, let origin = activeOrigin {
            let transport = transportFactory(origin)
            if !uncertain {
                Task { try? await transport.cancel(operation: operation) }
                try? registry.resolveLogin(for: operation.selection.origin, epoch: operation.storeEpoch)
                self.operation = nil
            }
        }
        phase = uncertain ? .unresolved : .cancelled
    }

    /// Reads the grant result, then the exact same store's live session. It
    /// never replays an exchange, reissues a code or restores credentials.
    func checkResult() {
        guard canCheckResult, let operation, let origin = activeOrigin, registry.isCurrent(operation.selection), originProvider() == origin else { return }
        generation = UUID(); let ticket = generation; phase = .exchanging
        let transport = transportFactory(origin); let exchange = exchangerFactory(); exchanger = exchange
        work = Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await transport.result(operation: operation)
                guard self.current(ticket, operation.selection, origin), !Task.isCancelled else { return }
                guard result.committed, result.state == "consumed", let expected = result.identity else {
                    self.phase = .failed("这次登录尚未完成，请重新登录。"); return
                }
                let live = try await exchange.readStatus(operation: operation, expected: expected)
                guard self.current(ticket, operation.selection, origin), !Task.isCancelled, live == expected else { return }
                try self.registry.resolveLogin(for: operation.selection.origin, epoch: operation.storeEpoch)
                self.operation = nil; self.matchingHint = nil; self.exchanger = nil
                self.phase = .completed(accountID: live.accountID, userID: live.userID)
            } catch {
                guard self.current(ticket, operation.selection, origin), !Task.isCancelled else { return }
                self.phase = .unresolved
            }
        }
    }
}

/// WKWebView.load is synchronous. This loader awaits the exact navigation's
/// delegate completion, fences foreign redirects and late completions, and
/// reads only content-free first-party documents in an isolated script world.
@MainActor
final class DesktopBrowserLoginWKExchanger: NSObject, DesktopLoginExchanging, WKNavigationDelegate {
    enum ExchangeError: Error { case storeChanged, navigationFailed, invalidReceipt, statusMismatch }
    private let registry: LoginStoreRegistry
    private var webView: WKWebView?
    private var origin: WorkspaceOrigin?
    private var operation: DesktopBrowserLoginOperation?
    private var navigation: WKNavigation?
    private var continuation: CheckedContinuation<Void, Error>?
    private var timeout: Task<Void, Never>?
    private var allowedURL: URL?
    private static let world = WKContentWorld.world(name: "TalentSignalDesktopLoginReadback")
    init(registry: LoginStoreRegistry? = nil) { self.registry = registry ?? .shared }

    private func validate(_ operation: DesktopBrowserLoginOperation) throws {
        guard registry.isCurrent(operation.selection) else { throw ExchangeError.storeChanged }
    }
    private func configure(_ operation: DesktopBrowserLoginOperation) throws {
        try validate(operation)
        guard let origin = WorkspaceOrigin(operation.selection.origin, allowLocalDevelopment: true) else { throw ExchangeError.storeChanged }
        if let prior = self.operation, prior.selection.storeIdentifier != operation.selection.storeIdentifier {
            cancel(); webView = nil
        }
        self.origin = origin; self.operation = operation
        if webView == nil {
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: operation.storeIdentifier)
            configuration.applicationNameForUserAgent = "TalentSignalMac"
            let view = WKWebView(frame: .zero, configuration: configuration)
            view.navigationDelegate = self; webView = view
        }
    }
    private func load(_ request: URLRequest) async throws {
        guard let webView, let operation, continuation == nil else { throw ExchangeError.navigationFailed }
        try validate(operation); allowedURL = request.url
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation; self.navigation = webView.load(request)
            guard self.navigation != nil else { self.finish(.failure(ExchangeError.navigationFailed)); return }
            timeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(20))
                guard !Task.isCancelled else { return }
                self?.finish(.failure(ExchangeError.navigationFailed)); self?.webView?.stopLoading()
            }
        }
        try validate(operation)
        guard webView.url == request.url else { throw ExchangeError.navigationFailed }
    }
    private func finish(_ result: Result<Void, Error>) {
        let pending = continuation; continuation = nil; navigation = nil
        timeout?.cancel(); timeout = nil; pending?.resume(with: result)
    }
    func cancel() { finish(.failure(CancellationError())); webView?.stopLoading() }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard action.targetFrame?.isMainFrame != false, action.request.url == allowedURL,
              let operation, registry.isCurrent(operation.selection) else { decisionHandler(.cancel); finish(.failure(ExchangeError.navigationFailed)); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard response.isForMainFrame, response.response.url == allowedURL else { decisionHandler(.cancel); finish(.failure(ExchangeError.navigationFailed)); return }
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
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish(.failure(ExchangeError.navigationFailed)) }

    func exchange(operation: DesktopBrowserLoginOperation, code: String, expected: DesktopLoginIdentity) async throws -> DesktopLoginIdentity {
        try configure(operation)
        var request = URLRequest(url: origin!.url.appendingPathComponent("api/desktop-auth/consume"), cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["attempt_id": operation.attemptID, "code": code, "verifier": operation.verifier, "state": operation.state])
        try await load(request)
        let json = try await webView!.callAsyncJavaScript("return document.body?.dataset.talentSignalReceipt ?? '';", arguments: [:], in: nil, contentWorld: Self.world)
        try validate(operation)
        guard let text = json as? String, let data = text.data(using: .utf8),
              let receipt = try? JSONDecoder().decode([String: String].self, from: data),
              receipt["attempt_id"] == operation.attemptID, receipt["account_id"] == expected.accountID,
              receipt["user_id"] == expected.userID, UUID(uuidString: receipt["request_id"] ?? "") != nil else { throw ExchangeError.invalidReceipt }
        return try await readStatus(operation: operation, expected: expected)
    }

    private struct Status: Decodable {
        struct Identity: Decodable { let id: String }
        struct Attempt: Decodable { let attempt_id: String; let account_id: String; let user_id: String; let state: String; let device_session_id: String }
        let status: String
        let account: Identity
        let user: Identity
        let attempt: Attempt
        let session_expires_at: String
    }
    func readStatus(operation: DesktopBrowserLoginOperation, expected: DesktopLoginIdentity) async throws -> DesktopLoginIdentity {
        try configure(operation)
        var components = URLComponents(url: origin!.url.appendingPathComponent("api/desktop-auth/status"), resolvingAgainstBaseURL: false)!
        components.queryItems = [.init(name: "attempt", value: operation.attemptID)]
        try await load(URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData))
        let json = try await webView!.callAsyncJavaScript("return document.body?.textContent ?? '';", arguments: [:], in: nil, contentWorld: Self.world)
        try validate(operation)
        guard let text = json as? String, let data = text.data(using: .utf8), let status = try? JSONDecoder().decode(Status.self, from: data),
              status.status == "authenticated", status.account.id == expected.accountID, status.user.id == expected.userID,
              status.attempt.attempt_id == operation.attemptID, status.attempt.state == "consumed",
              status.attempt.account_id == expected.accountID, status.attempt.user_id == expected.userID,
              UUID(uuidString: status.attempt.device_session_id) != nil,
              let expiry = desktopLoginDate(status.session_expires_at), expiry > Date() else { throw ExchangeError.statusMismatch }
        return expected
    }
}
