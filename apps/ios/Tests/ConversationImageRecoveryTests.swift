import Foundation
import XCTest
@testable import TalentSignal

@MainActor
final class ConversationImageRecoveryTests: XCTestCase {
    private let bytes = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3f8AAAAASUVORK5CYII=")!

    private func image(id: UUID = UUID()) throws -> ConversationImageManifest {
        try ConversationImageUpload(id: id, data: bytes, fileName: "synthetic.png", mediaType: "image/png").manifest
    }

    func testUncertainSendRestoresSameIdentityAndRejectsChangedIntent() throws {
        let persistence = ImageRecoveryPersistence()
        let store = AgentSessionStore(persistence: persistence)
        let session = try XCTUnwrap(store.beginUnscopedSession(objective: "Read the blue panel"))
        let manifest = try image()
        let pending = try XCTUnwrap(store.beginImageConversation(sessionID: session,
            objective: "Read the blue panel", images: [manifest]))
        XCTAssertTrue(store.markImageObservationUnknown(sessionID: session, messageID: pending.messageID))
        let restored = AgentSessionStore(persistence: persistence)
        let same = try XCTUnwrap(restored.beginImageConversation(sessionID: session,
            objective: "Read the blue panel", images: [try image()]))
        XCTAssertEqual(same.messageID, pending.messageID)
        XCTAssertEqual(same.idempotencyKey, pending.idempotencyKey)
        XCTAssertEqual(same.images, pending.images)
        XCTAssertEqual(same.state, .unknown)
        XCTAssertNil(restored.beginImageConversation(sessionID: session, objective: "A different question", images: [manifest]))
    }

    func testFailedProtectionDoesNotCreateDispatchablePendingOperation() throws {
        let persistence = ImageRecoveryPersistence()
        let store = AgentSessionStore(persistence: persistence)
        let session = try XCTUnwrap(store.beginUnscopedSession(objective: "Question"))
        persistence.fail = true
        XCTAssertNil(store.beginImageConversation(sessionID: session, objective: "Question", images: [try image()]))
        XCTAssertNil(store.session(id: session)?.pendingImageConversation)
    }

    func testCanonicalTurnPreservesExactServerResponseAndOriginalManifest() throws {
        let manifest = try image()
        let raw = try turn(messageID: UUID(), manifest: manifest)
        let before = try JSONSerialization.jsonObject(with: raw) as! NSDictionary
        let persisted = try JSONDecoder.agentSession.decode(PersistedAgentSessionTurn.self, from: raw)
        let local = persisted.value
        XCTAssertEqual(local.images, [manifest])
        XCTAssertNotNil(local.canonicalWire)
        let encoded = try JSONEncoder.agentSession.encode(PersistedAgentSessionTurn(local))
        let after = try JSONSerialization.jsonObject(with: encoded) as! NSDictionary
        XCTAssertEqual(before, after, "Do not invent savedBlocks, erase nulls or rewrite execution provenance.")
        XCTAssertFalse(local.response.blocks.contains(where: { $0.requiresUserDecision }))
        XCTAssertEqual(local.response.blocks.first?.body, "ORBIT 734")
    }

    func testOnlyExactCanonicalMessageCompletesAndEmptyQueueIsNotSuccess() throws {
        let store = AgentSessionStore()
        let session = try XCTUnwrap(store.beginUnscopedSession(objective: "Read the blue panel"))
        let manifest = try image()
        let pending = try XCTUnwrap(store.beginImageConversation(sessionID: session,
            objective: "Read the blue panel", images: [manifest]))
        let empty = try record(store: store, sessionID: session, turn: nil)
        XCTAssertEqual(try store.observeImageConversation(sessionID: session, messageID: pending.messageID,
            observation: ConversationImageObservation(record: empty, entry: nil)), .unknown)
        XCTAssertNotNil(store.session(id: session)?.pendingImageConversation)
        let rawTurn = try turn(messageID: pending.messageID, manifest: manifest)
        let canonical = try record(store: store, sessionID: session, turn: rawTurn)
        XCTAssertEqual(try store.observeImageConversation(sessionID: session, messageID: pending.messageID,
            observation: ConversationImageObservation(record: canonical, entry: nil)), .completed)
        XCTAssertNil(store.session(id: session)?.pendingImageConversation)
        XCTAssertNil(store.session(id: session)?.pendingObjective)
        XCTAssertEqual(store.session(id: session)?.turns.count, 1)
    }

    func testFailedCanonicalSaveCanRetrySameRevisionWithoutLosingTurn() throws {
        let persistence = ImageRecoveryPersistence()
        let store = AgentSessionStore(persistence: persistence)
        let session = try XCTUnwrap(store.beginUnscopedSession(objective: "Read the blue panel"))
        let manifest = try image()
        let pending = try XCTUnwrap(store.beginImageConversation(sessionID: session,
            objective: "Read the blue panel", images: [manifest]))
        let canonical = try record(store: store, sessionID: session,
            turn: turn(messageID: pending.messageID, manifest: manifest))
        let observation = ConversationImageObservation(record: canonical, entry: nil)
        persistence.fail = true
        XCTAssertThrowsError(try store.observeImageConversation(sessionID: session,
            messageID: pending.messageID, observation: observation))
        XCTAssertTrue(store.session(id: session)?.turns.isEmpty == true)
        XCTAssertNotNil(store.session(id: session)?.pendingImageConversation)
        persistence.fail = false
        XCTAssertEqual(try store.observeImageConversation(sessionID: session,
            messageID: pending.messageID, observation: observation), .completed)
        XCTAssertEqual(store.session(id: session)?.turns.count, 1)
        XCTAssertNil(store.session(id: session)?.pendingImageConversation)
    }

    func testChangedOriginalManifestCannotResolvePendingImage() throws {
        let store = AgentSessionStore()
        let session = try XCTUnwrap(store.beginUnscopedSession(objective: "Read the blue panel"))
        let pending = try XCTUnwrap(store.beginImageConversation(sessionID: session,
            objective: "Read the blue panel", images: [try image()]))
        let changed = try record(store: store, sessionID: session,
            turn: turn(messageID: pending.messageID, manifest: image()))
        XCTAssertThrowsError(try store.observeImageConversation(sessionID: session, messageID: pending.messageID,
            observation: ConversationImageObservation(record: changed, entry: nil)))
        XCTAssertNotNil(store.session(id: session)?.pendingImageConversation)
        XCTAssertTrue(store.session(id: session)?.turns.isEmpty == true)
    }

    func testRemoteSyncNeverExportsImageRecoveryAsLegacyTextIntent() async throws {
        let store = AgentSessionStore()
        let session = try XCTUnwrap(store.beginUnscopedSession(objective: ""))
        let pending = try XCTUnwrap(store.beginImageConversation(sessionID: session,
            objective: "Read the blue panel", images: [try image()]))
        let client = RecordingImageSync()
        let synced = await store.synchronize(using: client)
        XCTAssertTrue(synced)
        let sent = try XCTUnwrap(client.received.first)
        XCTAssertNil(sent.pendingImageConversation)
        XCTAssertNil(sent.pendingObjective)
        XCTAssertEqual(store.session(id: session)?.pendingImageConversation?.messageID, pending.messageID)
        let fresh = AgentSessionStore()
        let restored = await fresh.synchronize(using: client)
        XCTAssertTrue(restored)
        XCTAssertNil(fresh.session(id: session)?.pendingObjective)
        XCTAssertNil(fresh.session(id: session)?.pendingImageConversation)
    }

    func testLegacyScreenshotCapacityDoesNotBlockNewConversationImage() throws {
        let legacy = AgentSession(id: UUID(), scope: .unresolvedIntent, title: "Legacy capture history",
            turns: [], contactReceipts: [], updatedAt: Date(), isUnread: false,
            screenshotTaskIDs: (0..<20).map { _ in UUID().uuidString.lowercased() })
        let store = AgentSessionStore(sessions: [legacy])
        XCTAssertNotNil(store.screenshotAdmissionNotice(sessionID: legacy.id))
        XCTAssertNotNil(store.beginImageConversation(sessionID: legacy.id,
            objective: "Read the blue panel", images: [try image()]))
    }

    func testReattachmentMustMatchFrozenSourceOrderAndTimezone() throws {
        let store = AgentSessionStore()
        let session = try XCTUnwrap(store.beginUnscopedSession(objective: ""))
        let first = try image(), second = try ConversationImageUpload(id: UUID(), data: Data([3,2,1]),
            fileName: "second.png", mediaType: "image/png").manifest
        let pending = try XCTUnwrap(store.beginImageConversation(sessionID: session,
            objective: "Read the blue panel", images: [first,second]))
        XCTAssertFalse(pending.matches(objective: pending.objective, images: [second,first]))
        XCTAssertTrue(store.markImageObservationUnknown(sessionID: session, messageID: pending.messageID))
        let same = try XCTUnwrap(store.beginImageConversation(sessionID: session,
            objective: pending.objective, images: [first,second]))
        XCTAssertEqual(same.timeZone, pending.timeZone)
        XCTAssertEqual(same.messageID, pending.messageID)
    }

    private func turn(messageID: UUID, manifest: ConversationImageManifest) throws -> Data {
        let imageJSON = try JSONSerialization.jsonObject(with: JSONEncoder().encode(manifest))
        return try JSONSerialization.data(withJSONObject: ["id":messageID.uuidString.lowercased(),
            "objective":"Read the blue panel", "images":[imageJSON], "createdAt":"2026-10-22T10:00:00.000Z",
            "response":["contractVersion":TalentSignalAPIContract.version,"taskID":UUID().uuidString.lowercased(),
                "contextManifestID":"", "knowledgeSnapshotID":"", "disposition":"answer",
                "createdAt":"2026-10-22T10:00:08.123Z",
                "unboundConversationBlocks":[["id":"answer","kind":"answer","title":"Answer","body":"ORBIT 734",
                    "status":"informational","citation_dependency_ids":[],"requires_user_decision":false,
                    "allows_static_share":false,"target_ref":NSNull()]],
                "execution":["started_at":NSNull(),"completed_at":"2026-10-22T10:00:08.123Z","tools":[]]]])
    }

    private func record(store: AgentSessionStore, sessionID: UUID, turn: Data?) throws -> AgentSessionRemoteRecord {
        let value = try XCTUnwrap(store.session(id: sessionID))
        var payload = try JSONSerialization.jsonObject(with: JSONEncoder.agentSession.encode(PersistedAgentSession(value))) as! [String:Any]
        payload.removeValue(forKey: "pendingImageConversation")
        payload["turns"] = try turn.map { [try JSONSerialization.jsonObject(with: $0)] } ?? []
        let stamp = ISO8601DateFormatter().string(from: Date())
        let expiry = ISO8601DateFormatter().string(from: Date().addingTimeInterval(86400))
        return try JSONDecoder.agentSession.decode(AgentSessionRemoteRecord.self,
            from: JSONSerialization.data(withJSONObject: ["session_id":sessionID.uuidString.lowercased(),
                "revision":1,"updated_at":stamp,"expires_at":expiry,"deleted_at":NSNull(),"payload":payload]))
    }
}

private final class ImageRecoveryPersistence: AgentSessionPersisting {
    var data: Data?
    var fail = false
    func load() throws -> Data? { data }
    func save(_ data: Data) throws { if fail { throw CocoaError(.fileWriteUnknown) }; self.data = data }
    func deletionPending() throws -> Bool { false }
    func beginDeletion() throws { }
    func completeDeletion() throws { data = nil }
}

@MainActor
private final class RecordingImageSync: AgentSessionSyncServing {
    var received: [PersistedAgentSession] = []
    var records: [AgentSessionRemoteRecord] = []
    func list(after: String?) async throws -> AgentSessionRemotePage {
        AgentSessionRemotePage(contractVersion: TalentSignalAPIContract.version,
            sessions: records, complete: true, nextCursor: nil)
    }
    func put(_ payload: PersistedAgentSession, expectedRevision: Int, idempotencyKey: UUID) async throws -> AgentSessionRemoteRecord {
        received.append(payload)
        let row = AgentSessionRemoteRecord(sessionID: payload.id, revision: expectedRevision + 1,
            updatedAt: Date(), expiresAt: Date().addingTimeInterval(86400), deletedAt: nil, payload: payload)
        records = [row]
        return row
    }
    func delete(id: UUID, expectedRevision: Int, idempotencyKey: UUID) async throws -> AgentSessionRemoteRecord {
        throw ImageConversationError.invalidReadback
    }
}
