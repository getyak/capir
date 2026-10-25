import Foundation
import CryptoKit

/// The PRODUCTION open-Session/People refresh consumer used by the archive
/// view and by its tests. It owns a scope lease binding the actual
/// endpoint/token/account/user identity; once released it refuses to start,
/// publish, persist or upload anything, even for callbacks copied before the
/// release. Stored user data is never deleted here.
@MainActor
final class AgentSessionActiveRefreshConsumer {
    struct Lease: Hashable, Sendable {
        var scopeID: String
        var endpoint: URL
        var accessToken: String
        var accountID: String
        var userID: String
        var openSessionID: UUID?
        static func == (lhs: Self, rhs: Self) -> Bool {
            lhs.scopeID == rhs.scopeID && RuntimeEndpoint.same(lhs.endpoint, rhs.endpoint)
                && lhs.accountID == rhs.accountID && lhs.userID == rhs.userID && lhs.openSessionID == rhs.openSessionID
        }
        func hash(into hasher: inout Hasher) {
            hasher.combine(scopeID); hasher.combine(RuntimeEndpoint.scope(endpoint))
            hasher.combine(accountID); hasher.combine(userID); hasher.combine(openSessionID)
        }
    }

    static let scopePrefix = "agent-sessions-"

    private(set) var lease: Lease
    private var released = false
    private let sessions: AgentSessionStore
    private let people: PursuitWorkspaceStore?
    private let syncService: () -> (any AgentSessionSyncServing)?
    private let isScopeCurrent: () -> Bool
    private let isCanonical: () -> Bool

    init(
        lease: Lease,
        sessions: AgentSessionStore,
        people: PursuitWorkspaceStore?,
        syncService: @escaping () -> (any AgentSessionSyncServing)?,
        isCanonical: @escaping () -> Bool,
        isScopeCurrent: @escaping () -> Bool = { true }
    ) {
        self.lease = lease
        self.sessions = sessions
        self.people = people
        self.syncService = syncService
        self.isCanonical = isCanonical
        self.isScopeCurrent = isScopeCurrent
        sessions.activateSynchronizationScope(isCurrent: isScopeCurrent)
        people?.activateReadScope()
    }

    static func lease(
        endpoint: URL?,
        accessToken: String,
        accountID: String,
        userID: String,
        openSessionID: UUID?
    ) -> Lease? {
        guard let endpoint else { return nil }
        let family = IOSSessionFamilyRegistry.shared.family(endpoint: endpoint, token: accessToken) ?? accessToken
        let identity = [RuntimeEndpoint.canonical(endpoint), family, accountID, userID].joined(separator: "\u{0}")
        let fingerprint = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        return Lease(
            scopeID: scopePrefix + fingerprint + "-" + (openSessionID?.uuidString ?? "directory"),
            endpoint: endpoint,
            accessToken: accessToken,
            accountID: accountID,
            userID: userID,
            openSessionID: openSessionID
        )
    }

    var registryScope: String { lease.scopeID }

    /// The registered callback. A released lease or a changed live identity
    /// does no work at all.
    func refresh(generation: Int) async {
        guard !released, isScopeCurrent(),
              WorkspaceActiveRefresh.shared.coordinator.isCurrent(generation),
              isCanonical(),
              let client = syncService()
        else { return }
        // The request itself coalesces inside the store; its completions are
        // fenced by the store generation that release() advances.
        _ = await sessions.synchronize(using: client, requiredSessionID: lease.openSessionID)
    }

    /// Release invalidates BOTH the Session and People leases without deleting
    /// any stored user data. Already-running and copied-but-not-started work
    /// loses authority here.
    func release() {
        guard !released else { return }
        released = true
        sessions.invalidateSynchronizationScope()
        people?.invalidateReadScope()
    }

    var isReleased: Bool { released }
}
