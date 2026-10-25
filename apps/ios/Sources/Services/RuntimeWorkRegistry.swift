import Foundation

final class RuntimeWorkLease {
    private let id: UUID
    init(_ kind: RuntimeWorkRegistry.Kind) throws { id = try RuntimeWorkRegistry.shared.begin(kind) }
    deinit { RuntimeWorkRegistry.shared.end(id) }
}

final class RuntimeWorkRegistry: @unchecked Sendable {
    static let shared = RuntimeWorkRegistry()
    enum Kind: String { case apiWrite, recording }
    private let lock = NSLock()
    private var transitioning = false
    private var maintenance: UUID?
    private var operations: [UUID: Kind] = [:]
    func beginTransition() throws {
        lock.lock(); defer { lock.unlock() }
        guard !transitioning, operations.isEmpty else { throw RuntimeEnvironmentError.busy }
        transitioning = true
    }
    func beginMaintenance() throws -> UUID {
        lock.lock(); defer { lock.unlock() }
        guard !transitioning, operations.isEmpty else { throw RuntimeEnvironmentError.busy }
        let id = UUID(); transitioning = true; maintenance = id; return id
    }
    func endMaintenance(_ id: UUID) {
        lock.lock(); defer { lock.unlock() }
        guard maintenance == id else { return }
        maintenance = nil; transitioning = false
    }
    func endTransition() {
        lock.lock(); defer { lock.unlock() }
        guard maintenance == nil else { return }
        transitioning = false
    }
    func ownsMaintenance(_ id: UUID) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return maintenance == id && transitioning
    }
    func beginWrite(maintenance owner: UUID? = nil) throws -> UUID {
        lock.lock(); defer { lock.unlock() }
        guard !transitioning || (owner != nil && maintenance == owner) else { throw RuntimeEnvironmentError.busy }
        let id = UUID(); operations[id] = .apiWrite; return id
    }
    @discardableResult
    func begin(_ kind: Kind) throws -> UUID {
        lock.lock(); defer { lock.unlock() }
        guard !transitioning else { throw RuntimeEnvironmentError.busy }
        let id = UUID(); operations[id] = kind; return id
    }
    func end(_ id: UUID) {
        lock.lock(); defer { lock.unlock() }
        operations.removeValue(forKey: id)
    }
    var counts: [Kind: Int] {
        lock.lock(); defer { lock.unlock() }
        return Dictionary(grouping: operations.values, by: { $0 }).mapValues(\.count)
    }
}

enum RuntimeMaintenanceContext {
    @TaskLocal static var logoutPermit: UUID?
    @TaskLocal static var logoutEndpoint: URL?
    @TaskLocal static var persistentRenewal: RuntimePersistentRenewalPermission?
}

/// A maintenance barrier may verify exactly one already protected session.
/// This grants neither enrollment nor a business write. The proof is checked
/// before dispatch and beginWrite independently checks the same live owner.
struct RuntimePersistentRenewalPermission: Sendable {
    let owner: UUID
    let endpoint: URL
    let accountID: String
    let userID: String
    let sessionID: String
    private let secretDigest: String

    init?(owner: UUID, session: TalentSignalSession) {
        guard let capability = session.persistent, session.sessionID == capability.sessionID else { return nil }
        self.owner = owner; endpoint = session.baseURL; accountID = session.account.id
        userID = session.user.id; sessionID = capability.sessionID
        secretDigest = IOSPersistentSessionCredential.tokenFingerprint(capability.secret, endpoint: session.baseURL)
    }
    func authorizes(_ request: URLRequest) -> UUID? {
        guard RuntimeWorkRegistry.shared.ownsMaintenance(owner), request.httpMethod == "POST",
              let url = request.url, RuntimeEndpoint.relativeRoute(url, endpoint: endpoint) == "/v1/auth/persistent/renew",
              request.value(forHTTPHeaderField: "authorization") == nil,
              let data = request.httpBody, data.count <= 4096,
              let proof = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              Set(proof.keys) == Set(["renewal_secret", "account_id", "user_id", "session_id"]),
              proof["account_id"] == accountID, proof["user_id"] == userID, proof["session_id"] == sessionID,
              let secret = proof["renewal_secret"], IOSPersistentSessionCredential.tokenFingerprint(secret, endpoint: endpoint) == secretDigest else { return nil }
        return owner
    }
}

extension TalentSignalNetworking {
    static func data(for request: URLRequest, using session: URLSession) async throws -> (Data, URLResponse) {
        let synthetic = LabFaultURLProtocol.isIsolated(session)
        if synthetic && !LabFaultURLProtocol.permits(request) { throw URLError(.unsupportedURL) }
        // Resolve once before dispatch. No business POST/PUT/PATCH/DELETE is
        // replayed after a 401 or an uncertain transport result.
        let request = synthetic ? request : try await IOSSessionRequestResolution.coordinator.preflight(request)
        let method = request.httpMethod ?? "GET"
        let logoutRoute = request.url.flatMap { url in
            if let endpoint = RuntimeMaintenanceContext.logoutEndpoint { return RuntimeEndpoint.relativeRoute(url, endpoint: endpoint) }
            return url.path
        }
        let logoutPermit = method == "POST" && ["/v1/auth/logout", "/v1/auth/persistent/revoke"].contains(logoutRoute ?? "") ? RuntimeMaintenanceContext.logoutPermit : nil
        let permit = RuntimeMaintenanceContext.persistentRenewal?.authorizes(request) ?? logoutPermit
        let operation = ["POST", "PUT", "PATCH", "DELETE"].contains(method)
            ? try RuntimeWorkRegistry.shared.beginWrite(maintenance: permit) : nil
        defer { if let operation { RuntimeWorkRegistry.shared.end(operation) } }
        guard let ticket = LabDiagnosticsEngine.shared.begin(request, origin: synthetic ? .syntheticFault : .runtime) else {
            return try await session.data(for: request)
        }
        let delegate = LabDiagnosticRequestDelegate()
        var measuredRequest = request
        let asksForServerTrace = !synthetic && LabServerTrace.mayRequest(request)
        if asksForServerTrace {
            measuredRequest.setValue(ticket.requestID.uuidString.lowercased(), forHTTPHeaderField: LabServerTrace.requestHeader)
        }
        do {
            let result = try await session.data(for: measuredRequest, delegate: delegate)
            let serverTrace = asksForServerTrace ? LabServerTrace.parse(
                (result.1 as? HTTPURLResponse)?.value(forHTTPHeaderField: LabServerTrace.responseHeader),
                requestID: ticket.requestID) : nil
            LabDiagnosticsEngine.shared.finish(ticket, status: (result.1 as? HTTPURLResponse)?.statusCode,
                receivedBytes: result.0.count, error: nil, phases: delegate.phases, serverTrace: serverTrace)
            return result
        } catch {
            LabDiagnosticsEngine.shared.finish(ticket, status: nil, receivedBytes: nil, error: error, phases: delegate.phases)
            throw error
        }
    }
}
