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
    var revocationProof: String? = nil

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

/// This non-secret index references retired Keychain scopes; it contains no
/// device proof, access token, revocation envelope or conversation metadata.
struct DesktopRevocationScope: Codable, Equatable {
    let origin: String
    let storeIdentifier: UUID
    let epoch: UInt64
    init(_ selection: LoginStoreSelection) {
        origin = selection.origin; storeIdentifier = selection.storeIdentifier; epoch = selection.epoch
    }
    var selection: LoginStoreSelection {
        .init(origin: origin, storeIdentifier: storeIdentifier, epoch: epoch, unresolved: false, updatedAt: .distantPast)
    }
}

@MainActor
final class DesktopRevocationIndex {
    private let persistence: LoginStoreRegistryPersisting
    init(persistence: LoginStoreRegistryPersisting) { self.persistence = persistence }
    func pending() throws -> [DesktopRevocationScope] {
        guard let data = try persistence.read() else { return [] }
        guard data.count <= 1_048_576,
              let scopes = try? JSONDecoder().decode([DesktopRevocationScope].self, from: data),
              scopes.allSatisfy({ WorkspaceOrigin($0.origin, allowLocalDevelopment: true)?.url.absoluteString == $0.origin })
        else { throw LoginStoreRegistryError.corruptedRegistry }
        return scopes
    }
    func enqueue(_ scope: DesktopRevocationScope) throws {
        var scopes = try pending()
        if !scopes.contains(scope) { scopes.append(scope) }
        try persistence.write(JSONEncoder().encode(scopes))
    }
    func remove(_ scope: DesktopRevocationScope) throws {
        try persistence.write(JSONEncoder().encode(try pending().filter { $0 != scope }))
    }
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
    var revocation_proof: String? = nil
    var revocation_confirmed: Bool? = nil

    var confirmedRevoked: Bool { status == "revoked" && revocation_confirmed == true }

    var boundedRevocationProof: String? {
        guard let revocation_proof, revocation_proof.utf8.count <= 2048,
              revocation_proof.range(of: #"^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{1,1800}\.[A-Za-z0-9_-]{22}$"#, options: .regularExpression) != nil else { return nil }
        return revocation_proof
    }

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
    func revocationStatus(selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt
    func cancel()
}
extension DesktopPersistentSessionTransporting {
    func revocationStatus(selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt { try await status(selection: selection) }
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
    private let revocations: DesktopRevocationIndex
    private var revocationTask: Task<Void, Never>?
    private var revocationGeneration: UInt64 = 0
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var workspaceLifecycleObservers: [NSObjectProtocol] = []
    private let workspaceNotifications: NotificationCenter

    init(registry: LoginStoreRegistry? = nil, vault: DesktopDeviceCredentialStoring? = nil,
         transportFactory: ((WorkspaceOrigin) -> DesktopPersistentSessionTransporting)? = nil,
         revocations: DesktopRevocationIndex? = nil) {
        let owner = registry ?? .shared
        self.registry = owner
        self.vault = vault ?? KeychainDesktopDeviceCredentialStore()
        self.transportFactory = transportFactory ?? { DesktopPersistentSessionWKTransport(origin: $0, registry: owner) }
        self.revocations = revocations ?? DesktopRevocationIndex(persistence: FileLoginStoreRegistryPersistence(fileURL: owner.revocationIndexURL))
        self.workspaceNotifications = NSWorkspace.shared.notificationCenter
        lifecycleObservers.append(NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.retryPendingRevocations() }
        })
        for name in [NSWorkspace.didWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            workspaceLifecycleObservers.append(workspaceNotifications.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in await self?.retryPendingRevocations() }
            })
        }
        Task { [weak self] in await self?.retryPendingRevocations() }
    }

    deinit {
        for observer in lifecycleObservers { NotificationCenter.default.removeObserver(observer) }
        for observer in workspaceLifecycleObservers { workspaceNotifications.removeObserver(observer) }
    }

    func restore(in origin: WorkspaceOrigin) async -> DesktopPersistentSessionOutcome {
        do { try fencePendingRevocations() } catch { return .unavailable }
        Task { [weak self] in await self?.retryPendingRevocations() }
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
                guard live.authenticated, let revocationProof = live.boundedRevocationProof else { return .unavailable }
                let secret = try DesktopBrowserLoginCoordinator.newSecrets().verifier
                credential = DesktopDeviceCredential(origin: selection.origin, storeIdentifier: selection.storeIdentifier,
                    epoch: selection.epoch, accountID: live.account_id!, userID: live.user_id!, sessionID: live.session_id!,
                    secret: secret, enrolled: false, revocationProof: revocationProof)
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
                guard let revocationProof = live.boundedRevocationProof else { return .unavailable }
                capability.revocationProof = revocationProof
                try vault.write(capability, for: selection)
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
            if !capability.enrolled || (live.boundedRevocationProof != nil && capability.revocationProof != live.boundedRevocationProof) {
                capability.enrolled = true; capability.revocationProof = live.boundedRevocationProof ?? capability.revocationProof
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

    /// Journal the retired scope BEFORE local fencing. Its Keychain capability
    /// survives locked storage, process restart, lost responses and offline UI.
    func signOut(in origin: WorkspaceOrigin) throws {
        let selection = try registry.selection(for: origin.url.absoluteString)
        // Even a failed durable write fences this process immediately. The UI
        // retains a retryable error; it cannot keep renewing via another host.
        signedOutStores.insert(selection.storeIdentifier)
        cancel(selection: selection)
        try revocations.enqueue(DesktopRevocationScope(selection))
        revocationGeneration &+= 1
        _ = try registry.endSession(for: selection.origin)
        Task { [weak self] in await self?.retryPendingRevocations() }
    }

    func isLocallySignedOut(_ selection: LoginStoreSelection) -> Bool { signedOutStores.contains(selection.storeIdentifier) }

    private func fencePendingRevocations() throws {
        for scope in try revocations.pending() {
            // Acquiring registry ownership also prevents cross-process drains.
            let current = try registry.selection(for: scope.origin)
            if current.storeIdentifier == scope.storeIdentifier && current.epoch == scope.epoch {
                signedOutStores.insert(scope.storeIdentifier); cancel(selection: scope.selection)
                _ = try registry.endSession(for: scope.origin)
            }
        }
    }

    func retryPendingRevocations() async {
        if let revocationTask { await revocationTask.value; return }
        let task = Task {
            repeat {
                let generation = self.revocationGeneration
                await self.drainRevocations()
                if generation == self.revocationGeneration { self.revocationTask = nil; return }
            } while true
        }
        revocationTask = task
        await task.value
    }

    private func drainRevocations() async {
        do {
            try fencePendingRevocations()
            for scope in try revocations.pending() {
                guard let origin = WorkspaceOrigin(scope.origin, allowLocalDevelopment: true) else { continue }
                do {
                    guard var credential = try vault.read(for: scope.selection) else {
                        // No capability was persisted/dispatched; current guards
                        // prevent canceled operations from writing it later.
                        try revocations.remove(scope); continue
                    }
                    let transport = transportFactory(origin)
                    if !credential.enrolled && credential.revocationProof == nil {
                        // A legacy pending record may already have committed
                        // server-side; try its existing capability first.
                        if let ended = try? await transport.submit("revoke", credential: credential, selection: scope.selection), ended.confirmedRevoked {
                            try vault.remove(for: scope.selection); try revocations.remove(scope); continue
                        }
                        let live = try await transport.revocationStatus(selection: scope.selection)
                        guard live.matches(credential), let proof = live.boundedRevocationProof else { continue }
                        credential.revocationProof = proof
                        try vault.write(credential, for: scope.selection)
                    }
                    let response = try await transport.submit("revoke", credential: credential, selection: scope.selection)
                    guard response.confirmedRevoked else { continue }
                    try vault.remove(for: scope.selection)
                    try revocations.remove(scope)
                } catch { /* Unknown/protected-storage failure retains both recovery paths. */ }
            }
        } catch { /* A corrupt/unavailable journal cannot authorize disposal. */ }
    }

    func cancel(selection: LoginStoreSelection) {
        guard let running = operations[selection.origin], running.selection.storeIdentifier == selection.storeIdentifier else { return }
        operations[selection.origin] = nil
        running.task.cancel(); running.transport.cancel()
    }
}

#if DEBUG
/// Test-owned observation only: fixed categories contain no request, document,
/// identity, credential, URL or arbitrary error text. Release has no observer.
struct DesktopPersistentSessionWKDiagnosticEvent: Codable {
    enum Phase: String, Codable {
        case request, loadStarted, actionPolicy, responsePolicy, commit, finish, fail, watchdog, readbackStart, readbackDone
    }
    enum ErrorDomain: String, Codable {
        case cancellation, url = "NSURLErrorDomain", cocoa = "NSCocoaErrorDomain", webKit = "WKErrorDomain", other
    }
    let phase: Phase
    let elapsedMilliseconds: Int
    let statusCode: Int?
    let errorDomain: ErrorDomain?
    let errorCode: Int?

    static func errorMetadata(_ error: Error) -> (domain: ErrorDomain, code: Int?) {
        if error is CancellationError { return (.cancellation, nil) }
        let value = error as NSError
        switch value.domain {
        case NSURLErrorDomain: return (.url, value.code)
        case NSCocoaErrorDomain: return (.cocoa, value.code)
        case WKErrorDomain: return (.webKit, value.code)
        default: return (.other, nil)
        }
    }
}
#endif

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
    private var requiringRevokeReceipt = false
    private var responseStatus: Int?
    private var endpoint: URL { origin.url.appendingPathComponent("api/desktop-auth/persistent") }
#if DEBUG
    var diagnosticObserver: ((DesktopPersistentSessionWKDiagnosticEvent) -> Void)?
    private var diagnosticEventCount = 0
    private let diagnosticStarted = ProcessInfo.processInfo.systemUptime
    private func diagnose(_ phase: DesktopPersistentSessionWKDiagnosticEvent.Phase, statusCode: Int? = nil, error: Error? = nil) {
        guard let diagnosticObserver, diagnosticEventCount < 64 else { return }
        diagnosticEventCount += 1
        let metadata = error.map(DesktopPersistentSessionWKDiagnosticEvent.errorMetadata)
        diagnosticObserver(.init(phase: phase,
            elapsedMilliseconds: max(0, Int((ProcessInfo.processInfo.systemUptime - diagnosticStarted) * 1000)),
            statusCode: statusCode.flatMap { (100...599).contains($0) ? $0 : nil },
            errorDomain: metadata?.domain, errorCode: metadata?.code))
    }
#endif

    init(origin: WorkspaceOrigin, registry: LoginStoreRegistry) { self.origin = origin; self.registry = registry }

    private func validate(_ selection: LoginStoreSelection) throws {
        guard selection.origin == origin.url.absoluteString, (revoking || registry.isCurrent(selection)), !Task.isCancelled else { throw CancellationError() }
    }
    private func load(_ request: URLRequest, selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt {
#if DEBUG
        diagnose(.request)
#endif
        try validate(selection)
        if webView == nil {
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: selection.storeIdentifier)
            webView = WKWebView(frame: .zero, configuration: configuration)
            webView?.navigationDelegate = self
        }
        self.selection = selection
        responseStatus = nil
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            navigation = webView?.load(request)
            guard navigation != nil else { finish(.failure(URLError(.badServerResponse))); return }
#if DEBUG
            diagnose(.loadStarted)
#endif
            timeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(20))
                guard !Task.isCancelled else { return }
#if DEBUG
                self?.diagnose(.watchdog)
#endif
                self?.finish(.failure(URLError(.timedOut))); self?.webView?.stopLoading()
            }
        }
        try validate(selection)
#if DEBUG
        diagnose(.readbackStart)
        let raw: Any?
        do {
            raw = try await webView!.callAsyncJavaScript("return document.body?.textContent ?? '';", arguments: [:], in: nil, contentWorld: Self.world)
        } catch {
            diagnose(.fail, error: error)
            throw error
        }
        diagnose(.readbackDone)
#else
        let raw = try await webView!.callAsyncJavaScript("return document.body?.textContent ?? '';", arguments: [:], in: nil, contentWorld: Self.world)
#endif
        try validate(selection)
        guard let text = raw as? String, let data = text.data(using: .utf8), data.count <= 4096,
              let receipt = try? JSONDecoder().decode(DesktopPersistentSessionReceipt.self, from: data) else { throw URLError(.badServerResponse) }
        if requiringRevokeReceipt && (responseStatus != 200 || !receipt.confirmedRevoked) { throw URLError(.badServerResponse) }
        return receipt
    }
    func status(selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt {
        revoking = false; requiringRevokeReceipt = false
        return try await load(URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData), selection: selection)
    }
    func revocationStatus(selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt {
        revoking = true; requiringRevokeReceipt = false
        return try await load(URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData), selection: selection)
    }
    func submit(_ action: String, credential: DesktopDeviceCredential, selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt {
        revoking = action == "revoke"
        requiringRevokeReceipt = revoking
        guard credential.matches(selection), ["enroll", "renew", "revoke"].contains(action) else { throw URLError(.badURL) }
        var request = URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("1", forHTTPHeaderField: "x-capri-desktop-session")
        // Native WK navigation is not a browser form; supply its exact
        // configured origin instead of relying on WebKit's opaque/null Origin.
        request.setValue(origin.url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        var body = ["action": action, "device_secret": credential.secret,
            "account_id": credential.accountID, "user_id": credential.userID]
        if revoking, let proof = credential.revocationProof { body["session_id"] = credential.sessionID; body["revocation_proof"] = proof }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await load(request, selection: selection)
    }
    private func finish(_ result: Result<Void, Error>) {
#if DEBUG
        if case .failure(let error) = result { diagnose(.fail, error: error) }
#endif
        let pending = continuation; continuation = nil; navigation = nil
        timeout?.cancel(); timeout = nil; pending?.resume(with: result)
    }
    func cancel() { finish(.failure(CancellationError())); webView?.stopLoading() }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
#if DEBUG
        diagnose(.actionPolicy)
#endif
        guard action.targetFrame?.isMainFrame != false, action.request.url == endpoint, let selection,
              revoking || registry.isCurrent(selection) else { decisionHandler(.cancel); finish(.failure(CancellationError())); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        responseStatus = (response.response as? HTTPURLResponse)?.statusCode
#if DEBUG
        diagnose(.responsePolicy, statusCode: (response.response as? HTTPURLResponse)?.statusCode)
#endif
        guard response.isForMainFrame, response.response.url == endpoint else { decisionHandler(.cancel); finish(.failure(URLError(.badServerResponse))); return }
        decisionHandler(.allow)
    }
#if DEBUG
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard navigation === self.navigation else { return }
        diagnose(.commit)
    }
#endif
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard navigation === self.navigation else { return }
#if DEBUG
        diagnose(.finish)
#endif
        finish(.success(()))
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard navigation === self.navigation else { return }; finish(.failure(error))
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard navigation === self.navigation else { return }; finish(.failure(error))
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish(.failure(URLError(.networkConnectionLost))) }
}
