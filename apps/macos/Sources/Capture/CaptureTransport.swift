import Foundation
import WebKit

struct CaptureAdmission: Decodable, Sendable {
    let sessionId: UUID
    let messageId: UUID
    let queueEntryId: UUID
    let status: String
}

struct CaptureImageManifest: Decodable, Sendable {
    let attachmentId: UUID
    let byteSize: Int
    let contentHash: String
}

struct CaptureReceipt: Decodable, Sendable {
    let sessionId: UUID
    let messageId: UUID
    let queueEntryId: UUID
    let status: String
    let imageManifest: [CaptureImageManifest]
    let resultRecorded: Bool
}

enum CaptureTransportError: Error, Equatable {
    case staleOrigin
    case untrustedHost
    case malformedResponse
    case server(Int, String)
    case unavailable
}

enum CaptureTransportPayload {
    static func encode(_ intent: CaptureIntent) throws -> Data {
        guard intent.hasRawImage, intent.imagePNG.count == intent.imageByteSize else {
            throw CaptureIntentError.emptyImage
        }
        let image: [String: Any] = [
            "attachment_id": intent.attachmentId.uuidString.lowercased(),
            "file_name": "capture.png",
            "media_type": "image/png",
            "byte_size": intent.imageByteSize,
            "content_hash": intent.contentHash,
            "data_base64": intent.imagePNG.base64EncodedString(),
        ]
        let body: [String: Any] = [
            "policy_version": intent.policyVersion,
            "owner_scope": intent.ownerScope,
            "idempotency_key": intent.idempotencyKey,
            "session_id": intent.sessionId.uuidString.lowercased(),
            "message_id": intent.messageId.uuidString.lowercased(),
            "objective": "",
            "images": [image],
        ]
        return try JSONSerialization.data(withJSONObject: body)
    }
}

/// Later-started authenticated reads may finish first. Once a newer owner,
/// login or processor policy is observed, an older response cannot restore
/// authority merely because it arrives last.
@MainActor
final class CaptureContextReadFence {
    private struct Identity: Equatable {
        let origin: String
        let ownerScope: String
        let loginBinding: String
        let policyVersion: String
        init(_ context: CaptureContext) {
            origin = context.origin
            ownerScope = context.ownerScope
            loginBinding = context.loginBinding
            policyVersion = context.processing.policyVersion
        }
    }
    private enum Latest { case context(Identity), signedOut }
    private var nextSequence = 0
    private var appliedSequence = 0
    private var latest: Latest?

    func begin() -> Int { nextSequence += 1; return nextSequence }

    func accept(_ context: CaptureContext, sequence: Int) throws {
        if sequence < appliedSequence {
            guard case .some(.context(let current)) = latest, current == Identity(context) else {
                throw CaptureTransportError.staleOrigin
            }
            return
        }
        appliedSequence = sequence
        latest = .context(Identity(context))
    }

    @discardableResult
    func signedOut(sequence: Int) -> Bool {
        guard sequence >= appliedSequence else { return false }
        appliedSequence = sequence
        latest = .signedOut
        return true
    }
}

@MainActor
protocol CaptureTransporting {
    func context() async throws -> CaptureContext
    func admit(_ intent: CaptureIntent, context: CaptureContext) async throws -> CaptureAdmission
    func receipt(for intent: CaptureIntent, context: CaptureContext) async throws -> CaptureReceipt?
}

/** Only native code calls this fixed isolated-world fetch. The page gains no capture API. */
@MainActor
final class CaptureWebSession: NSObject, CaptureTransporting, WKNavigationDelegate {
    private static let world = WKContentWorld.world(name: "TalentSignalCaptureSubmission")
    private static let script = """
    const host = '/api/desktop-capture/host';
    if (location.pathname !== host) throw new Error('capture host changed');
    const permitted = path === '/api/desktop-capture/context' || path === '/api/desktop-capture/recent-session' ||
      /^\\/api\\/desktop-capture\\/[0-9a-f-]{36}\\/[0-9a-f-]{36}$/.test(path);
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

    let origin: WorkspaceOrigin
    private let webView: WKWebView
    private let hostURL: URL
    private var loaded = false
    private var loadingWaiters: [CheckedContinuation<Void, Error>] = []
    private var loadTimeout: Task<Void, Never>?
    private var activeNavigation: WKNavigation?
    private let contextFence = CaptureContextReadFence()

    init(origin: WorkspaceOrigin) {
        self.origin = origin
        hostURL = origin.url.appendingPathComponent("api/desktop-capture/host")
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: origin.dataStoreIdentifier)
        configuration.userContentController = WKUserContentController()
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
    }

    private func assertOrigin() throws {
        guard WorkspaceConnection.shared.origin == origin else { throw CaptureTransportError.staleOrigin }
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
        decisionHandler(navigationAction.request.url == hostURL ? .allow : .cancel)
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
            let data = try await fetch(path: "/api/desktop-capture/context", method: "GET")
            let context = try CaptureContext.decode(data, origin: origin.url.absoluteString)
            try contextFence.accept(context, sequence: sequence)
            return context
        } catch CaptureTransportError.server(401, let code) {
            guard contextFence.signedOut(sequence: sequence) else { throw CaptureTransportError.staleOrigin }
            throw CaptureTransportError.server(401, code)
        }
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
}
