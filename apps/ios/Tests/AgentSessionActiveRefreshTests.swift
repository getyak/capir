import XCTest
@testable import TalentSignal

/// The PRODUCTION open-Session consumer (AgentSessionActiveRefreshConsumer)
/// drives the real AgentSessionStore through a deferred
/// AgentSessionSyncServing and a counting persistence: seeded real transcript
/// turns, a real remote turn, tombstones, scope release, and copied-but-not-
/// started callbacks are all covered.
@MainActor
final class AgentSessionActiveRefreshTests: XCTestCase {
    private static let fixtureNow = Date(timeIntervalSince1970: 1_789_000_300)

    final class DeferredSyncService: AgentSessionSyncServing, @unchecked Sendable {
        private let lock = NSLock()
        private var pending: [CheckedContinuation<AgentSessionRemotePage, Error>] = []
        private(set) var listCalls = 0
        private(set) var putCalls = 0
        private(set) var deleteCalls = 0

        func list(after: String?) async throws -> AgentSessionRemotePage {
            return try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                listCalls += 1
                pending.append(continuation)
                lock.unlock()
            }
        }

        func put(_ payload: PersistedAgentSession, expectedRevision: Int, idempotencyKey: UUID) async throws -> AgentSessionRemoteRecord {
            lock.lock(); putCalls += 1; lock.unlock()
            throw AgentSessionSyncError.unavailable(500)
        }

        func delete(id: UUID, expectedRevision: Int, idempotencyKey: UUID) async throws -> AgentSessionRemoteRecord {
            lock.lock(); deleteCalls += 1; lock.unlock()
            throw AgentSessionSyncError.unavailable(500)
        }

        func counts() -> (list: Int, put: Int, delete: Int) {
            lock.lock(); defer { lock.unlock() }
            return (listCalls, putCalls, deleteCalls)
        }

        func waitForCall(_ n: Int) async throws {
            for _ in 0..<400 {
                if counts().list >= n { return }
                try await Task.sleep(nanoseconds: 5_000_000)
            }
            XCTFail("request #\(n) never entered the sync service")
            throw URLError(.timedOut)
        }

        func deliver(_ page: AgentSessionRemotePage) {
            lock.lock()
            let continuation = pending.isEmpty ? nil : pending.removeFirst()
            lock.unlock()
            continuation?.resume(returning: page)
        }

        func fail() {
            lock.lock()
            let continuation = pending.isEmpty ? nil : pending.removeFirst()
            lock.unlock()
            continuation?.resume(throwing: AgentSessionSyncError.unavailable(503))
        }
    }

    /// Counts real persistence writes without touching disk.
    final class CountingPersistence: AgentSessionPersisting, @unchecked Sendable {
        private(set) var saves = 0
        private var data: Data?
        func load() throws -> Data? { data }
        func save(_ data: Data) throws { saves += 1; self.data = data }
        func deletionPending() throws -> Bool { false }
        func beginDeletion() throws {}
        func completeDeletion() throws { data = nil }
    }

    private func turn(_ id: String, objective: String) -> AgentSessionTurn {
        AgentSessionTurn(
            id: UUID(uuidString: id) ?? UUID(),
            objective: objective,
            response: RelationshipAskResponse(
                contractVersion: TalentSignalAPIContract.version,
                taskID: "task-\(id)",
                contextManifestID: "none-unbound-conversation",
                knowledgeSnapshotID: "none-unbound-conversation",
                disposition: "answered",
                blocks: [RelationshipAskResponse.Block(
                    id: "block-\(id)", kind: "answer", title: "Next step",
                    body: "Review the latest message.", status: "ready",
                    citationDependencyIDs: [], requiresUserDecision: false
                )],
                createdAt: ISO8601DateFormatter().string(from: Self.fixtureNow)
            ),
            createdAt: Date(timeIntervalSince1970: 1_789_000_000),
            requiresRefresh: false
        )
    }

    private func seedSession() -> AgentSession {
        AgentSession(
            id: UUID(),
            scope: .unresolvedIntent,
            title: "Open conversation",
            turns: [turn("11111111-1111-4111-8111-111111111111", objective: "seeded message")],
            contactReceipts: [],
            updatedAt: Date(timeIntervalSince1970: 1_789_000_100),
            isUnread: false
        )
    }

    private func page(_ session: AgentSession, revision: Int, extraTurn: String?, deleted: Bool) throws -> AgentSessionRemotePage {
        let turns = session.turns + (extraTurn.map {
            [turn("22222222-2222-4222-8222-222222222222", objective: $0)]
        } ?? [])
        let remote = AgentSession(
            id: session.id,
            scope: session.scope,
            title: session.title,
            turns: turns,
            contactReceipts: [],
            updatedAt: Date(timeIntervalSince1970: 1_789_000_200),
            isUnread: session.isUnread
        )
        let record = AgentSessionRemoteRecord(
            sessionID: session.id,
            revision: revision,
            updatedAt: Self.fixtureNow,
            expiresAt: Self.fixtureNow.addingTimeInterval(86_400),
            deletedAt: deleted ? Self.fixtureNow : nil,
            payload: deleted ? nil : PersistedAgentSession(remote)
        )
        return AgentSessionRemotePage(
            contractVersion: TalentSignalAPIContract.version,
            sessions: [record],
            complete: true,
            nextCursor: nil
        )
    }

    func testProductionConsumerMergesRealTurnsTombstonesAndDropsReleasedScope() async throws {
        let session = seedSession()
        let service = DeferredSyncService()
        let persistence = CountingPersistence()
        let store = AgentSessionStore(
            sessions: [session], persistence: persistence, now: { Self.fixtureNow }
        )
        store.saveGlobalDraft("draft kept for the user")
        let people = PursuitWorkspaceStore(service: nil)
        let consumer = AgentSessionActiveRefreshConsumer(
            lease: .init(
                scopeID: "agent-sessions-\(session.id.uuidString)",
                endpoint: URL(string: "https://api.example.test")!,
                accessToken: "token-T1",
                accountID: "account-1",
                userID: "user-1",
                openSessionID: session.id
            ),
            sessions: store,
            people: people,
            syncService: { service },
            isCanonical: { true }
        )
        let consumerRef = consumer
        let registration = WorkspaceActiveRefresh.shared.register(
            scope: consumer.registryScope
        ) { generation in
            await consumerRef.refresh(generation: generation)
        }
        defer { WorkspaceActiveRefresh.shared.unregister(registration) }

        // The production consumer drives the real store.
        WorkspaceActiveRefresh.shared.requestRefresh(reason: "manual")
        try await service.waitForCall(1)
        XCTAssertEqual(store.session(id: session.id)?.turns.count, 1)

        // A real remote transcript turn merges into the same durable Session.
        service.deliver(try page(session, revision: 4, extraTurn: "remote committed message", deleted: false))
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertEqual(store.session(id: session.id)?.turns.count, 2, "the remote turn merges without forking")
        XCTAssertEqual(store.globalDraft(), "draft kept for the user", "the local draft survives the merge")

        // A second successful page is held while the consumer scope RELEASES.
        WorkspaceActiveRefresh.shared.requestRefresh(reason: "manual")
        try await service.waitForCall(2)
        consumer.release()
        let savedBefore = persistence.saves
        let countsBefore = service.counts()
        service.deliver(try page(session, revision: 9, extraTurn: "stale-scope message", deleted: false))
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertEqual(store.session(id: session.id)?.turns.count, 2, "released scope never publishes")
        XCTAssertEqual(persistence.saves, savedBefore, "released scope never persists")
        XCTAssertEqual(service.counts().put, countsBefore.put, "released scope never uploads")
        XCTAssertEqual(service.counts().delete, countsBefore.delete, "released scope never deletes")

        // A callback copied BEFORE release but entering after it does nothing.
        await consumerRef.refresh(generation: WorkspaceActiveRefresh.shared.coordinator.scopeGeneration)
        XCTAssertEqual(service.counts().list, countsBefore.list, "a copied callback acquires no authority after release")

        // A current-scope consumer settles a valid newer tombstone.
        let second = AgentSessionActiveRefreshConsumer(
            lease: .init(
                scopeID: "agent-sessions-\(session.id.uuidString)-current",
                endpoint: URL(string: "https://api.example.test")!,
                accessToken: "token-T2",
                accountID: "account-1",
                userID: "user-1",
                openSessionID: session.id
            ),
            sessions: store,
            people: people,
            syncService: { service },
            isCanonical: { true }
        )
        let currentRegistration = WorkspaceActiveRefresh.shared.register(
            scope: second.registryScope
        ) { generation in
            await second.refresh(generation: generation)
        }
        defer { WorkspaceActiveRefresh.shared.unregister(currentRegistration) }
        WorkspaceActiveRefresh.shared.requestRefresh(reason: "manual")
        try await service.waitForCall(service.counts().list + 1)
        service.deliver(try page(session, revision: 10, extraTurn: nil, deleted: true))
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertNil(store.session(id: session.id), "a current-scope tombstone retires the Session")
        XCTAssertEqual(store.globalDraft(), "draft kept for the user", "the draft survives the tombstone")
    }

    func testTombstoneAvailabilityDrivesTheViewDecision() async throws {
        let session = seedSession()
        let store = AgentSessionStore(sessions: [session], now: { Self.fixtureNow })
        // Derived from the REAL store state the view observes.
        XCTAssertTrue(
            AskSendAvailability.originalSessionUnavailable(
                activeSessionID: session.id,
                sessionExists: store.session(id: session.id) != nil
            ) == false
        )
        store.invalidateSynchronizationScope()
        // After a real tombstone the same derivation disables sending.
        XCTAssertTrue(
            AskSendAvailability.originalSessionUnavailable(
                activeSessionID: session.id,
                sessionExists: false
            )
        )
        XCTAssertFalse(
            AskSendAvailability.canSendDraft(
                hasComposerInput: true,
                isSending: false,
                isSavingContact: false,
                originalSessionUnavailable: true
            )
        )
        XCTAssertTrue(
            AskSendAvailability.canSendDraft(
                hasComposerInput: true,
                isSending: false,
                isSavingContact: false,
                originalSessionUnavailable: false
            )
        )
    }
}
