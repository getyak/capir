import Foundation
import XCTest
@testable import TalentSignal

final class ConversationImageProgressTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_792_663_200)

    func testLegacyEntryDecodesWithoutInventingStageOrTiming() throws {
        let entry = try entry(status: "running")
        XCTAssertEqual(entry.queueStatus, .running)
        XCTAssertNil(entry.stage)
        XCTAssertNil(entry.startedAt)
        XCTAssertNil(entry.createdAt)
        XCTAssertNil(entry.revision)
        XCTAssertFalse(entry.cancelRequested)
    }

    func testSendingAndAdmissionAreDifferentUntilVerifiedQueueObservation() throws {
        var pending = pending()
        XCTAssertEqual(progress(pending, sending: true).phase, .sending)
        XCTAssertEqual(progress(pending).phase, .prepared)
        pending.state = .admitted
        XCTAssertEqual(progress(pending, checking: true).phase, .waiting)
        XCTAssertEqual(progress(pending).phase, .unknown)
        let row = try entry(messageID: pending.messageID, status: "queued")
        XCTAssertEqual(progress(pending, entry: row, observedAt: now).phase, .queued)
        XCTAssertEqual(progress(pending, entry: row, observedAt: now, paused: true).phase, .paused)
    }

    func testUnknownStageIsGenericAndDoesNotFabricateElapsedTime() throws {
        let pending = pending()
        let row = try entry(messageID: pending.messageID, status: "running", extra: ["stage": "new_server_stage"])
        let value = progress(pending, entry: row, observedAt: now)
        XCTAssertEqual(value.phase, .running)
        XCTAssertEqual(value.textKey, "Processing your message…")
        XCTAssertNil(value.elapsedSince)
        XCTAssertNil(value.elapsedText(at: now.addingTimeInterval(100)))
    }

    func testElapsedUsesObservedRunStartNotLocalSendTime() throws {
        let pending = pending()
        let row = try entry(messageID: pending.messageID, status: "running", extra: ["started_at": "2026-10-22T09:58:50Z"])
        let value = progress(pending, entry: row, observedAt: now)
        let started = try XCTUnwrap(row.startedAt)
        XCTAssertEqual(value.elapsedSince, started)
        XCTAssertEqual(value.elapsedText(at: started.addingTimeInterval(70)), "1:10")
        XCTAssertNil(value.elapsedText(at: started.addingTimeInterval(9)))
    }

    func testCompletedQueueRowIsReadbackAndAbsentRowIsNeverSuccess() throws {
        var pending = pending(); pending.state = .admitted
        let row = try entry(messageID: pending.messageID, status: "completed")
        XCTAssertEqual(progress(pending, checking: true, entry: row, observedAt: now).phase, .readback)
        XCTAssertEqual(progress(pending, entry: nil, observedAt: now).phase, .unknown)
    }

    func testStaleOrWrongMessageCannotContinueAnimating() throws {
        let pending = pending()
        let row = try entry(messageID: pending.messageID, status: "running")
        let stale = progress(pending, entry: row, observedAt: now.addingTimeInterval(-66))
        XCTAssertEqual(stale.phase, .unknown); XCTAssertFalse(stale.showsActivity); XCTAssertTrue(stale.canCheck)
        let foreign = progress(pending, entry: try entry(status: "running"), observedAt: now)
        XCTAssertEqual(foreign.phase, .unknown); XCTAssertFalse(foreign.showsActivity)
    }

    func testUnknownAndStoppedRemainRecoverableWithoutNewSend() {
        var pending = pending(); pending.state = .unknown
        XCTAssertEqual(progress(pending).phase, .unknown)
        XCTAssertTrue(progress(pending).canCheck)
        XCTAssertEqual(progress(pending, checking: true).phase, .checking)
        pending.state = .stopped
        XCTAssertEqual(progress(pending).phase, .stopped)
        XCTAssertFalse(progress(pending).showsActivity)
    }

    func testWrongReceiptAndEarlierRunningRowCannotOverrideProtectedStop() throws {
        var pending = pending()
        pending.queueEntryID = UUID()
        let row = try entry(messageID: pending.messageID, status: "running")
        XCTAssertEqual(progress(pending, entry: row, observedAt: now).phase, .unknown)
        pending.state = .stopped
        XCTAssertEqual(progress(pending, entry: row, observedAt: now).phase, .stopped)
        XCTAssertFalse(progress(pending, entry: row, observedAt: now).showsActivity)
    }

    func testStreamRequiresOwnedSnapshotBeforeStageAndDiscardsOldRun() throws {
        let sid = UUID(), mid = UUID(), run = UUID()
        var reader = ConversationImageStreamAccumulator(sessionID: sid, messageID: mid)
        XCTAssertNil(try reader.accept(preview(mid: mid, run: run, revision: 1, stage: "answer")))
        let first = try reader.accept(snapshot(sid: sid, mid: mid, run: run, revision: 1))
        XCTAssertEqual(first?.entry?.queueStatus, .running)
        XCTAssertEqual(try reader.accept(preview(mid: mid, run: run, revision: 2, stage: "contact_read"))?.observedStage, .contactRead)
        XCTAssertNil(try reader.accept(preview(mid: UUID(), run: run, revision: 3, stage: "answer")))
        XCTAssertNil(try reader.accept(preview(mid: mid, run: UUID(), revision: 3, stage: "answer")))
        XCTAssertNil(try reader.accept(preview(mid: mid, run: run, revision: 1, stage: "answer")))
        XCTAssertNil(try reader.accept(snapshot(sid: sid, mid: mid, run: run, revision: 0)))
        let nextRun = UUID()
        XCTAssertNil(try reader.accept(snapshot(sid: sid, mid: mid, run: nextRun, revision: 2))?.observedStage)
        XCTAssertNil(try reader.accept(preview(mid: mid, run: run, revision: 10, stage: "answer")))
        XCTAssertEqual(try reader.accept(preview(mid: mid, run: nextRun, revision: 1, stage: "preparing"))?.observedStage, .preparing)
        let terminal = try reader.accept(snapshot(sid: sid, mid: mid, run: nextRun, revision: 3, status: "completed"))
        XCTAssertNil(terminal?.observedStage)
        XCTAssertNil(try reader.accept(preview(mid: mid, run: nextRun, revision: 2, stage: "answer")))
    }

    func testStreamRejectsForeignSessionAndAcceptsUnknownStageWithoutTextProjection() throws {
        let sid = UUID(), mid = UUID(), run = UUID()
        var reader = ConversationImageStreamAccumulator(sessionID: sid, messageID: mid)
        XCTAssertThrowsError(try reader.accept(snapshot(sid: UUID(), mid: mid, run: run, revision: 1)))
        _ = try reader.accept(snapshot(sid: sid, mid: mid, run: run, revision: 1))
        let unknown = try reader.accept(preview(mid: mid, run: run, revision: 1, stage: "new_stage"))
        XCTAssertNil(unknown?.observedStage)
        XCTAssertEqual(unknown?.entry?.messageID, mid)
    }

    func testFrameParserHandlesCRLFCommentsAndBoundedPartialFrames() throws {
        var parser = ConversationImageEventParser()
        var frames: [ConversationImageEventFrame] = []
        for byte in ": heartbeat\r\n\r\nevent: snapshot\r\ndata: {\"revision\":1}\r\n\r\n".utf8 {
            if let frame = try parser.push(byte) { frames.append(frame) }
        }
        XCTAssertEqual(frames.count, 1)
        XCTAssertEqual(frames[0].event, "snapshot")
        XCTAssertEqual(String(data: frames[0].data, encoding: .utf8), "{\"revision\":1}")
        var unbounded = ConversationImageEventParser()
        XCTAssertThrowsError(try (0...262_144).forEach { _ in _ = try unbounded.push(65) })
    }

    private func pending() -> PendingImageConversation {
        PendingImageConversation(messageID: UUID(), idempotencyKey: "synthetic-same-intent", objective: "Synthetic",
            images: [], createdAt: now.addingTimeInterval(-100), timeZone: "UTC", state: .prepared)
    }

    private func progress(_ pending: PendingImageConversation, sending: Bool = false, checking: Bool = false,
        entry: ConversationImageQueueEntry? = nil, observedAt: Date? = nil, paused: Bool = false) -> ConversationImageProgressState {
        .derive(pending: pending, isSending: sending, isChecking: checking, entry: entry,
            paused: paused, observedAt: observedAt, now: now)
    }

    private func entry(messageID: UUID = UUID(), status: String, extra: [String: Any] = [:]) throws -> ConversationImageQueueEntry {
        var body: [String: Any] = ["queue_entry_id": UUID().uuidString, "message_id": messageID.uuidString, "status": status, "images": []]
        extra.forEach { body[$0] = $1 }
        return try JSONDecoder().decode(ConversationImageQueueEntry.self, from: JSONSerialization.data(withJSONObject: body))
    }

    private func snapshot(sid: UUID, mid: UUID, run: UUID, revision: Int, status: String = "running") throws -> ConversationImageEventFrame {
        let row: [String: Any] = ["queue_entry_id": mid.uuidString, "message_id": mid.uuidString, "status": status, "run_id": run.uuidString, "images": []]
        return try frame(event: "snapshot", body: ["contract_version": TalentSignalAPIContract.version, "session_id": sid.uuidString,
            "revision": revision, "paused": false, "active": row, "queued": [], "preview": NSNull()])
    }

    private func preview(mid: UUID, run: UUID, revision: Int, stage: String) throws -> ConversationImageEventFrame {
        try frame(event: "preview", body: ["run_id": run.uuidString, "message_id": mid.uuidString,
            "stage": stage, "revision": revision, "text": "UNVALIDATED_TEXT_MUST_NOT_BE_PROJECTED", "completed_tools": []])
    }

    private func frame(event: String, body: [String: Any]) throws -> ConversationImageEventFrame {
        ConversationImageEventFrame(event: event, data: try JSONSerialization.data(withJSONObject: body))
    }
}
