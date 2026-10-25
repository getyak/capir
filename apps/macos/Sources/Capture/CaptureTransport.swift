import Foundation
import WebKit

/** Only native code calls this fixed isolated-world fetch. The page gains no capture API. */
@MainActor
final class CaptureWebSession: NSObject, CaptureTransporting, WKNavigationDelegate {
    private static let world = WKContentWorld.world(name: "TalentSignalCaptureSubmission")
    private static let script = """
    const host = '/api/desktop-capture/host';
    if (location.pathname !== host) throw new Error('capture host changed');
    const permitted = path === '/api/desktop-capture/context' || path === '/api/desktop-capture/recent-session' ||
      /^\\/api\\/desktop-capture\\/[0-9a-f-]{36}\\/[0-9a-f-]{36}(?:\\/result)?$/.test(path);
    if (!permitted) throw new Error('capture path unavailable');
    const destination = new URL(path, location.origin);
    if (destination.origin !== location.origin) throw new Error('capture origin changed');
    const headers = { 'accept': 'application/json' };
    if (method === 'POST') headers['content-type'] = 'application/json';
    if (binding) headers['x-workspace-session'] = binding;
    if (account) headers['x-talent-signal-workspace'] = account;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(destination, {
        method, headers, credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        signal: controller.signal, ...(body === null ? {} : { body }),
      });
      return { status: response.status, text: await response.text() };
    } finally { clearTimeout(timer); }
    """

    let automaticallyPollsStatus = true
    func isOriginCurrent(_ value: String) -> Bool {
        origin.url.absoluteString == value && (try? assertOrigin()) != nil
    }

    let origin: WorkspaceOrigin
    private let webView: WKWebView
    private let hostURL: URL
    private var loaded = false
    private var loadingWaiters: [CheckedContinuation<Void, Error>] = []
    private var loadTimeout: Task<Void, Never>?
    private var activeNavigation: WKNavigation?
    private let storeSelection: LoginStoreSelection?
    private let registry: LoginStoreRegistry
    private let persistentSession: DesktopPersistentSessionCoordinator
    private let originProvider: () -> WorkspaceOrigin?
    private var initialSessionRestore: Task<DesktopPersistentSessionOutcome, Never>?
    private var retired = false
    private let contextFence = CaptureContextReadFence()
    private var verifiedPrimarySession: DesktopPersistentSessionReceipt?

    init(origin: WorkspaceOrigin, registry: LoginStoreRegistry? = nil,
         persistentSession: DesktopPersistentSessionCoordinator? = nil,
         originProvider: (() -> WorkspaceOrigin?)? = nil) {
        self.origin = origin
        let owner = registry ?? .shared
        self.registry = owner
        self.persistentSession = persistentSession ?? (registry == nil ? .shared : DesktopPersistentSessionCoordinator(registry: owner))
        self.originProvider = originProvider ?? { WorkspaceConnection.shared.origin }
        self.storeSelection = try? owner.selection(for: origin.url.absoluteString)
        hostURL = origin.url.appendingPathComponent("api/desktop-capture/host")
        let configuration = WKWebViewConfiguration()
        if let store = storeSelection?.storeIdentifier {
            configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: store)
        } else { configuration.websiteDataStore = .nonPersistent() }
        configuration.userContentController = WKUserContentController()
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        // A menu-bar-only launch may never construct WorkspaceBrowser. Enroll
        // its healthy old cookie before the short session expires, and share
        // the same coalesced restore with any workspace starting concurrently.
        initialSessionRestore = Task { [weak self] in
            guard let self, (try? self.assertOrigin()) != nil else { return .cancelled }
            return await self.persistentSession.restore(in: self.origin)
        }
    }

    func retire() {
        verifiedPrimarySession = nil
        initialSessionRestore?.cancel(); initialSessionRestore = nil
        retired = true; loaded = false; webView.stopLoading(); webView.navigationDelegate = nil
        finishLoading(.failure(CaptureTransportError.staleOrigin))
    }

    private func assertOrigin() throws {
        guard !retired, let storeSelection, registry.isCurrent(storeSelection),
              !registry.hasUnresolvedLogin(for: origin.url.absoluteString),
              originProvider() == origin else { throw CaptureTransportError.staleOrigin }
        if let current = webView.url, !origin.contains(current) { throw CaptureTransportError.untrustedHost }
    }

    private func ensureLoaded() async throws {
        try assertOrigin()
        if loaded && webView.url == hostURL { return }
        try await withCheckedThrowingContinuation { continuation in
            let shouldLoad = loadingWaiters.isEmpty
            loadingWaiters.append(continuation)
            if shouldLoad {
                guard let navigation = webView.load(URLRequest(url: hostURL, cachePolicy: .reloadIgnoringLocalCacheData))
                else {
                    finishLoading(.failure(CaptureTransportError.unavailable))
                    return
                }
                activeNavigation = navigation
                loadTimeout = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(15))
                    guard !Task.isCancelled, let self, !self.loadingWaiters.isEmpty else { return }
                    self.loaded = false
                    self.finishLoading(.failure(CaptureTransportError.unavailable))
                    self.webView.stopLoading()
                }
            }
        }
        try assertOrigin()
    }

    private func finishLoading(_ result: Result<Void, Error>) {
        loadTimeout?.cancel()
        loadTimeout = nil
        activeNavigation = nil
        let pending = loadingWaiters
        loadingWaiters.removeAll()
        for continuation in pending { continuation.resume(with: result) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(!retired && (try? assertOrigin()) != nil && navigationAction.request.url == hostURL ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard navigation === activeNavigation, !loadingWaiters.isEmpty else { return }
        loaded = webView.url == hostURL
        finishLoading(loaded ? .success(()) : .failure(CaptureTransportError.untrustedHost))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard navigation === activeNavigation else { return }
        loaded = false
        finishLoading(.failure(error))
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard navigation === activeNavigation else { return }
        loaded = false
        finishLoading(.failure(error))
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loaded = false
        finishLoading(.failure(CaptureTransportError.unavailable))
    }

    private func fetch(path: String, method: String, body: String? = nil,
                       binding: String? = nil, account: String? = nil) async throws -> Data {
        try await ensureLoaded()
        try assertOrigin()
        let value = try await webView.callAsyncJavaScript(Self.script, arguments: [
            "path": path, "method": method,
            "body": body as Any? ?? NSNull(), "binding": binding ?? "", "account": account ?? "",
        ], in: nil, contentWorld: Self.world)
        try assertOrigin()
        guard let envelope = value as? [String: Any], let status = envelope["status"] as? Int,
              let text = envelope["text"] as? String else { throw CaptureTransportError.malformedResponse }
        if !(200...299).contains(status) {
            let code = (try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])?["code"] as? String
            throw CaptureTransportError.server(status, code ?? "capture_request_failed")
        }
        return Data(text.utf8)
    }

    func context() async throws -> CaptureContext {
        let sequence = contextFence.begin()
        do {
            try Task.checkCancellation()
            try assertOrigin()
            var initialOutcome: DesktopPersistentSessionOutcome?
            if let initialSessionRestore {
                initialOutcome = await initialSessionRestore.value
                self.initialSessionRestore = nil
                try assertOrigin()
                // The host can have been constructed during primary login's
                // unresolved store epoch. Once that exact epoch is resolved,
                // join enrollment before reading the first business context.
                if case .cancelled? = initialOutcome {
                    initialOutcome = await persistentSession.restore(in: origin)
                    try assertOrigin()
                }
            } else if verifiedPrimarySession == nil {
                // An unavailable/unknown initial attempt is not admission.
                // Every retry must rejoin verification until it obtains proof.
                initialOutcome = await persistentSession.restore(in: origin)
                try assertOrigin()
            }
            try Task.checkCancellation()
            switch initialOutcome {
            case .needsLogin?:
                verifiedPrimarySession = nil
                throw CaptureTransportError.server(401, "desktop_session_requires_sign_in")
            case .unavailable?: throw CaptureTransportError.unavailable
            case .cancelled?: throw CaptureTransportError.staleOrigin
            default: break
            }
            let data: Data
            if case .authenticated(let live)? = initialOutcome { try rememberVerifiedPrimarySession(live) }
            guard verifiedPrimarySession != nil else { throw CaptureTransportError.unavailable }
            do {
                data = try await fetch(path: "/api/desktop-capture/context", method: "GET")
            } catch CaptureTransportError.server(401, let code) {
                // Only this read-only context discovery is retried. Uploads,
                // admissions, result actions and other writes are never replayed.
                let outcome: DesktopPersistentSessionOutcome
                switch initialOutcome {
                case .unavailable?: outcome = .unavailable
                case .needsLogin?: outcome = .needsLogin
                case .cancelled?: outcome = .cancelled
                default: outcome = await persistentSession.restore(in: origin)
                }
                try assertOrigin()
                switch outcome {
                case .authenticated(let live):
                    try rememberVerifiedPrimarySession(live)
                    data = try await fetch(path: "/api/desktop-capture/context", method: "GET")
                case .needsLogin:
                    verifiedPrimarySession = nil
                    throw CaptureTransportError.server(401, code)
                case .unavailable: throw CaptureTransportError.unavailable
                case .cancelled: throw CaptureTransportError.staleOrigin
                }
            }
            let context = try CaptureContext.decode(data, origin: origin.url.absoluteString)
            try Task.checkCancellation()
            guard let verifiedPrimarySession else { throw CaptureTransportError.unavailable }
            guard let account = context.primaryAccountID, UUID(uuidString: account) != nil,
                  let user = context.primaryUserID, UUID(uuidString: user) != nil,
                  let session = context.primarySessionID, UUID(uuidString: session) != nil
            else { throw CaptureTransportError.malformedResponse }
            guard account == verifiedPrimarySession.account_id, user == verifiedPrimarySession.user_id,
                  session == verifiedPrimarySession.session_id else { throw CaptureTransportError.staleOrigin }
            try contextFence.accept(context, sequence: sequence)
            return context
        } catch CaptureTransportError.server(401, let code) {
            guard contextFence.signedOut(sequence: sequence) else { throw CaptureTransportError.staleOrigin }
            throw CaptureTransportError.server(401, code)
        }
    }

    private func rememberVerifiedPrimarySession(_ live: DesktopPersistentSessionReceipt) throws {
        guard live.authenticated else { throw CaptureTransportError.malformedResponse }
        if let prior = verifiedPrimarySession,
           prior.account_id != live.account_id || prior.user_id != live.user_id || prior.session_id != live.session_id {
            throw CaptureTransportError.staleOrigin
        }
        verifiedPrimarySession = live
    }

    func recentSession(context current: CaptureContext) async throws -> UUID? {
        let data = try await fetch(path: "/api/desktop-capture/recent-session", method: "GET",
                                   binding: current.loginBinding, account: current.workspaceAccountID)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CaptureTransportError.malformedResponse
        }
        if object["session_id"] is NSNull { return nil }
        guard let raw = object["session_id"] as? String, let session = UUID(uuidString: raw) else {
            throw CaptureTransportError.malformedResponse
        }
        return session
    }

    func admit(_ intent: CaptureIntent, context: CaptureContext) async throws -> CaptureAdmission {
        let fresh = try await self.context()
        guard intent.canSubmit(context: fresh, now: Date()) else { throw CaptureTransportError.staleOrigin }
        let body = try CaptureTransportPayload.encode(intent)
        guard let json = String(data: body, encoding: .utf8) else { throw CaptureTransportError.malformedResponse }
        let path = "/api/desktop-capture/\(intent.sessionId.uuidString.lowercased())/\(intent.messageId.uuidString.lowercased())"
        let result = try await fetch(path: path, method: "POST", body: json,
                                     binding: fresh.loginBinding, account: fresh.workspaceAccountID)
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        let admission = try decoder.decode(CaptureAdmission.self, from: result)
        guard admission.sessionId == intent.sessionId, admission.messageId == intent.messageId
        else { throw CaptureTransportError.malformedResponse }
        return admission
    }

    func receipt(for intent: CaptureIntent, context: CaptureContext) async throws -> CaptureReceipt? {
        let fresh = try await self.context()
        guard intent.canReadback(context: fresh, now: Date()) else { throw CaptureTransportError.staleOrigin }
        let path = "/api/desktop-capture/\(intent.sessionId.uuidString.lowercased())/\(intent.messageId.uuidString.lowercased())"
        do {
            let result = try await fetch(path: path, method: "GET",
                                         binding: fresh.loginBinding, account: fresh.workspaceAccountID)
            let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
            let receipt = try decoder.decode(CaptureReceipt.self, from: result)
            guard receipt.sessionId == intent.sessionId, receipt.messageId == intent.messageId,
                  receipt.imageManifest.count == 1,
                  receipt.imageManifest[0].attachmentId == intent.attachmentId,
                  receipt.imageManifest[0].contentHash == intent.contentHash,
                  receipt.imageManifest[0].byteSize == intent.imageByteSize
            else { throw CaptureTransportError.malformedResponse }
            return receipt
        } catch CaptureTransportError.server(404, _) {
            return nil
        }
    }

    func result(for intent: CaptureIntent, context: CaptureContext) async throws -> CaptureResult? {
        let fresh = try await self.context()
        guard intent.canReadback(context: fresh, now: Date()) else { throw CaptureTransportError.staleOrigin }
        let path = "/api/desktop-capture/\(intent.sessionId.uuidString.lowercased())/\(intent.messageId.uuidString.lowercased())/result"
        let data = try await fetch(path: path, method: "GET", binding: fresh.loginBinding, account: fresh.workspaceAccountID)
        guard data.count <= 24_000 else { throw CaptureTransportError.malformedResponse }
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        let result = try decoder.decode(CaptureResult.self, from: data)
        guard result.matches(intent: intent, queueEntryID: intent.queueEntryId) else {
            throw CaptureTransportError.malformedResponse
        }
        return result
    }

    func originalSourceRequest(result: CaptureResult, context: CaptureContext) throws -> (URLRequest, LoginStoreSelection) {
        try assertOrigin()
        guard context.origin == origin.url.absoluteString, context.expiresAt > Date(), let storeSelection else {
            throw CaptureTransportError.staleOrigin
        }
        let path = "api/workspace-sessions/\(result.sessionId.uuidString.lowercased())/conversation-images/\(result.messageId.uuidString.lowercased())/0"
        var request = URLRequest(url: origin.url.appendingPathComponent(path), cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue(context.loginBinding, forHTTPHeaderField: "x-workspace-session")
        request.setValue(context.workspaceAccountID, forHTTPHeaderField: "x-talent-signal-workspace")
        return (request, storeSelection)
    }
}
