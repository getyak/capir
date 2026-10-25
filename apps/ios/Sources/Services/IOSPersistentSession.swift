import CryptoKit
import Foundation
import Security

/// Stored only inside the existing WhenUnlocked, device-only Keychain item.
/// Pending is durable before enrollment, so a lost response can renew the same
/// canonical family without generating a replacement capability.
struct IOSPersistentSessionCredential: Codable, Equatable {
    let secret: String
    let sessionID: String
    var enrolled: Bool
    var accessFingerprints: [String]

    static func pending(session: TalentSignalSession) throws -> Self {
        guard let id = session.sessionID, UUID(uuidString: id) != nil else { throw AppSessionError.invalidResponse }
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else { throw AppSessionError.keychain(status) }
        let secret = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        return .init(secret: secret, sessionID: id, enrolled: false,
                     accessFingerprints: [Self.tokenFingerprint(session.accessToken, endpoint: session.baseURL)])
    }
    static func tokenFingerprint(_ token: String, endpoint: URL) -> String {
        SHA256.hex(RuntimeEndpoint.scope(endpoint) + "|" + token)
    }
    mutating func remember(token: String, endpoint: URL) {
        let value = Self.tokenFingerprint(token, endpoint: endpoint)
        if !accessFingerprints.contains(value) { accessFingerprints.append(value) }
        // Durable history is bounded. In-process clients retain their stable
        // family alias in IOSSessionFamilyRegistry until the next primary login.
        accessFingerprints = Array(accessFingerprints.suffix(64))
    }
}

extension TalentSignalSession {
    var isRealUserSession: Bool { ["password_human", "apple_human", "google_human"].contains(user.kind) }
    var loginIdentity: String {
        RuntimeEndpoint.scope(baseURL, accountID: account.id, userID: user.id) + "|"
            + (persistent?.sessionID ?? sessionID ?? SHA256.hex(accessToken))
    }
    var logoutFingerprints: [String] {
        Array(Set([AppSessionEnding.fingerprint(self), IOSPersistentSessionCredential.tokenFingerprint(accessToken, endpoint: baseURL)]
            + (persistent?.accessFingerprints ?? [])))
    }
}

/// Identity metadata only; grants no authorization. Account operations keep
/// their canonical family across access rotation while a new login fences old
/// async completions. Tokens themselves are never retained by this registry.
final class IOSSessionFamilyRegistry: @unchecked Sendable {
    struct Authority: Sendable { let endpoint: URL; let family: String }
    static let shared = IOSSessionFamilyRegistry()
    private let lock = NSLock()
    private var families: [String: String] = [:]
    private var authorities: [String: Authority] = [:]
    func remember(_ session: TalentSignalSession) {
        guard session.persistent != nil else { return }
        lock.lock(); defer { lock.unlock() }
        let owner = RuntimeEndpoint.scope(session.baseURL, accountID: session.account.id, userID: session.user.id) + "|"
        families = families.filter { !$0.value.hasPrefix(owner) || $0.value == session.loginIdentity }
        for fingerprint in session.logoutFingerprints { families[fingerprint] = session.loginIdentity }
        authorities[SHA256.hex(session.accessToken)] = Authority(endpoint: session.baseURL, family: session.loginIdentity)
    }
    func family(endpoint: URL, token: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return families[IOSPersistentSessionCredential.tokenFingerprint(token, endpoint: endpoint)]
    }
    func authority(token: String) -> Authority? {
        lock.lock(); defer { lock.unlock() }
        return authorities[SHA256.hex(token)]
    }
    func rememberAlias(token: String, session: TalentSignalSession) {
        lock.lock(); defer { lock.unlock() }
        authorities[SHA256.hex(token)] = Authority(endpoint: session.baseURL, family: session.loginIdentity)
        families[IOSPersistentSessionCredential.tokenFingerprint(token, endpoint: session.baseURL)] = session.loginIdentity
    }
}

extension Notification.Name {
    static let iosSessionRenewed = Notification.Name("com.talentsignal.session.renewed")
    static let iosSessionRevoked = Notification.Name("com.talentsignal.session.revoked")
}

/// One owner for foreground, timer and cached-client preflight. This never
/// retries a business request: renewal completes before its first dispatch.
actor IOSPersistentSessionCoordinator {
    static let shared = IOSPersistentSessionCoordinator()
    private struct Flight { let id: UUID; let task: Task<TalentSignalSession, Error> }
    private var flights: [String: Flight] = [:]
    private var retired: Set<String> = []
    private let mirror: CaptureLogoutDenyMirror
    private let endpointProvider: () -> URL?
    private let persistenceProvider: (URL) -> any TalentSignalSessionPersisting
    private let endingsProvider: (URL) -> any AppSessionEndingPersisting
    private let clientProvider: (URL) -> any AppAuthenticationServing
    init(mirror: CaptureLogoutDenyMirror = .init(),
         endpointProvider: @escaping () -> URL? = {
             RuntimeEnvironmentDirectory(buildEndpoint: TalentSignalAuthenticationConfiguration.baseURL(arguments: ProcessInfo.processInfo.arguments)).selected?.endpoint
         },
         persistenceProvider: @escaping (URL) -> any TalentSignalSessionPersisting = { KeychainTalentSignalSessionStore(baseURL: $0) },
         endingsProvider: @escaping (URL) -> any AppSessionEndingPersisting = { KeychainAppSessionEndingStore(endpoint: $0) },
         clientProvider: @escaping (URL) -> any AppAuthenticationServing = { AppAuthenticationClient(baseURL: $0) }) {
        self.mirror = mirror; self.endpointProvider = endpointProvider
        self.persistenceProvider = persistenceProvider; self.endingsProvider = endingsProvider; self.clientProvider = clientProvider
    }

    func retire(_ session: TalentSignalSession) {
        retired.insert(session.loginIdentity)
        flights[session.loginIdentity]?.task.cancel()
    }

    func assertRestorable(_ session: TalentSignalSession) throws {
        if retired.contains(session.loginIdentity) { throw Self.revoked() }
        for fingerprint in session.logoutFingerprints {
            if try mirror.isDenied(endpoint: session.baseURL, fingerprint: fingerprint) { throw Self.revoked() }
        }
    }
    private static func revoked() -> AppSessionError {
        .backend(status: 401, code: "PERSISTENT_SESSION_REVOKED", message: "This device session was signed out or revoked.")
    }

    func resolve(_ source: TalentSignalSession, persistence: any TalentSignalSessionPersisting,
                 endings: any AppSessionEndingPersisting, client: any AppAuthenticationServing,
                 force: Bool = false) async throws -> TalentSignalSession {
        let identity = source.loginIdentity
        try assertRestorable(source)
        guard let saved = try persistence.load(), saved.loginIdentity == identity,
              try !endings.load().contains(where: { $0.blocks(saved) }) else { throw CancellationError() }
        if !force, saved.persistent?.enrolled == true, saved.expiresAt.timeIntervalSinceNow > 4 * 3600 {
            IOSSessionFamilyRegistry.shared.remember(saved)
            return saved
        }
        let flight: Flight
        if let existing = flights[identity] { flight = existing }
        else {
            flight = Flight(id: UUID(), task: Task { try await client.validate(saved) })
            flights[identity] = flight
        }
        do {
            let next = try await flight.task.value
            if flights[identity]?.id == flight.id { flights.removeValue(forKey: identity) }
            try assertRestorable(source)
            guard let current = try persistence.load(), current.loginIdentity == identity,
                  try !endings.load().contains(where: { $0.blocks(current) }),
                  RuntimeEndpoint.same(next.baseURL, source.baseURL), next.account.id == source.account.id,
                  next.user.id == source.user.id, next.loginIdentity == identity else { throw CancellationError() }
            try persistence.save(next)
            IOSSessionFamilyRegistry.shared.remember(next)
            NotificationCenter.default.post(name: .iosSessionRenewed, object: next)
            return next
        } catch {
            if flights[identity]?.id == flight.id { flights.removeValue(forKey: identity) }
            if let failure = error as? AppSessionError, failure.invalidatesSession {
                retired.insert(identity)
                // Mirror first: a failed protected removal must not authorize
                // an old frozen capture or reopen this family on next launch.
                try? mirror.deny(endpoint: source.baseURL, fingerprints: source.logoutFingerprints)
                if var records = try? endings.load(), !records.contains(where: { $0.blocks(source) }) {
                    var record = AppSessionEnding(session: source)
                    record.remote = .revoked; record.credential = nil
                    records.append(record)
                    try? endings.save(records)
                }
                _ = try? persistence.removeMatching(source)
                NotificationCenter.default.post(name: .iosSessionRevoked, object: identity)
            }
            throw error
        }
    }

    func preflight(_ request: URLRequest) async throws -> URLRequest {
        guard let url = request.url,
              let authorization = request.value(forHTTPHeaderField: "authorization"), authorization.hasPrefix("Bearer ") else { return request }
        let token = String(authorization.dropFirst(7))
        let known = IOSSessionFamilyRegistry.shared.authority(token: token)
        guard let endpoint = endpointProvider(), let route = RuntimeEndpoint.relativeRoute(url, endpoint: endpoint) else {
            if known != nil { throw CancellationError() }
            return request
        }
        if route.hasPrefix("/v1/auth/") { return request }
        if let known, !RuntimeEndpoint.same(known.endpoint, endpoint) { throw CancellationError() }
        let fingerprint = IOSPersistentSessionCredential.tokenFingerprint(token, endpoint: endpoint)
        let family = IOSSessionFamilyRegistry.shared.family(endpoint: endpoint, token: token)
        if let family, retired.contains(family) { throw CancellationError() }
        let endings = endingsProvider(endpoint)
        let familyFingerprint = family.flatMap { $0.split(separator: "|").last }.map {
            SHA256.hex(RuntimeEndpoint.scope(endpoint) + "|persistent|" + $0)
        }
        let denied = try endings.load().contains { record in
            record.credentialFingerprint == fingerprint || record.credentialFingerprint == familyFingerprint
                || (record.blockedCredentialFingerprints ?? []).contains(fingerprint)
        }
        guard !denied else { throw CancellationError() }
        // Logout may remove the active item or fail after its monotonic deny
        // commits. Check denial BEFORE any missing/different active-item exit.
        try mirror.assertNotDenied(endpoint: endpoint, fingerprint: fingerprint)
        if let familyFingerprint { try mirror.assertNotDenied(endpoint: endpoint, fingerprint: familyFingerprint) }
        let persistence = persistenceProvider(endpoint)
        guard let stored = try persistence.load() else {
            if known != nil { throw CancellationError() }
            return request
        }
        if let known, known.family != stored.loginIdentity { throw CancellationError() }
        guard let capability = stored.persistent else {
            if known != nil { throw CancellationError() }
            return request
        }
        guard token == stored.accessToken || capability.accessFingerprints.contains(fingerprint)
                || IOSSessionFamilyRegistry.shared.family(endpoint: endpoint, token: token) == stored.loginIdentity else { return request }
        let current = try await resolve(stored, persistence: persistence, endings: endings, client: clientProvider(endpoint))
        IOSSessionFamilyRegistry.shared.rememberAlias(token: token, session: current)
        var next = request
        next.setValue("Bearer \(current.accessToken)", forHTTPHeaderField: "authorization")
        return next
    }

}

/// Dependency selection for the common data and SSE dispatch entries. The
/// production value is always the same coordinator used by AppSessionStore.
enum IOSSessionRequestResolution {
    @TaskLocal static var coordinator = IOSPersistentSessionCoordinator.shared
}
