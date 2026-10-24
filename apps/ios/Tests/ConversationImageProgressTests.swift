import Foundation
import XCTest
@testable import TalentSignal

final class ConversationImageProgressTests: XCTestCase {
    func testRetryDistinguishesCheckingFromResendingTheSameUnknownMessage() {
        var message = pending()
        message.state = .unknown
        XCTAssertEqual(progress(message, sending: true, checking: true).phase, .checking)
        XCTAssertEqual(progress(message, sending: true).phase, .sending)
        XCTAssertEqual(progress(message).phase, .unknown)
        XCTAssertFalse(progress(message).showsActivity)
    }
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

    func testCompletedQueueRowOnlyShowsReadbackDuringAnActiveCanonicalReplyCheck() throws {
        var pending = pending(); pending.state = .admitted
        let row = try entry(messageID: pending.messageID, status: "completed")
        let checking = progress(pending, checking: true, entry: row, observedAt: now)
        XCTAssertEqual(checking.phase, .readback)
        XCTAssertTrue(checking.showsActivity)
        XCTAssertFalse(checking.canCheck)
        let unresolved = progress(pending, entry: row, observedAt: now)
        XCTAssertEqual(unresolved.messageID, pending.messageID)
        XCTAssertEqual(unresolved.phase, .unknown)
        XCTAssertEqual(unresolved.textKey, "Reply status needs checking")
        XCTAssertFalse(unresolved.showsActivity)
        XCTAssertTrue(unresolved.canCheck)
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

    func testRunningPresentationExpiresWithoutAnotherStoreEvent() throws {
        let pending = pending()
        let row = try entry(messageID: pending.messageID, status: "running", extra: [
            "stage": "answer", "started_at": ISO8601DateFormatter().string(from: now.addingTimeInterval(-30))
        ])
        let value = progress(pending, entry: row, observedAt: now)
        XCTAssertEqual(value.phase, .running)
        XCTAssertEqual(value.observationExpiresAt, now.addingTimeInterval(65))
        XCTAssertTrue(value.requiresTimeline)
        XCTAssertNotNil(value.presentation(at: now.addingTimeInterval(64)).elapsedText(at: now.addingTimeInterval(64)))

        // Reuse this immutable value: no poll, SSE event or finishChecking
        // publication occurs between these two presentation times.
        let expired = value.presentation(at: now.addingTimeInterval(66))
        XCTAssertEqual(expired.messageID, pending.messageID)
        XCTAssertEqual(expired.phase, .unknown)
        XCTAssertEqual(expired.textKey, "Reply status needs checking")
        XCTAssertFalse(expired.showsActivity)
        XCTAssertTrue(expired.canCheck)
        XCTAssertNil(expired.elapsedSince)
        XCTAssertNil(expired.elapsedText(at: now.addingTimeInterval(66)))
        XCTAssertEqual(value.phase, .running)
    }

    func testQueuedAndPausedPresentationExpiresEvenWithoutElapsedTime() throws {
        let pending = pending()
        let row = try entry(messageID: pending.messageID, status: "queued")
        for paused in [false, true] {
            let value = progress(pending, entry: row, observedAt: now, paused: paused)
            XCTAssertEqual(value.phase, paused ? .paused : .queued)
            XCTAssertNil(value.elapsedSince)
            XCTAssertTrue(value.requiresTimeline, "An observation must age even when there is no run-start timer.")
            XCTAssertEqual(value.presentation(at: now.addingTimeInterval(64)), value)
            let expired = value.presentation(at: now.addingTimeInterval(66))
            XCTAssertEqual(expired.messageID, pending.messageID)
            XCTAssertEqual(expired.phase, .unknown)
            XCTAssertFalse(expired.showsActivity)
            XCTAssertTrue(expired.canCheck)
        }
    }

    func testObservationExpiryPreservesTheInclusiveFreshnessBoundary() throws {
        let pending = pending()
        let row = try entry(messageID: pending.messageID, status: "queued")
        let value = progress(pending, entry: row, observedAt: now.addingTimeInterval(-65))
        XCTAssertEqual(value.phase, .queued)
        XCTAssertEqual(value.observationExpiresAt, now)
        XCTAssertEqual(value.presentation(at: now), value)
        XCTAssertEqual(value.presentation(at: now.addingTimeInterval(0.001)).phase, .unknown)
        XCTAssertEqual(progress(pending, entry: row, observedAt: now.addingTimeInterval(-65.001)).phase, .unknown)
    }

    func testFreshObservationForSameMessageReplacesExpiredPresentation() throws {
        let pending = pending()
        let row = try entry(messageID: pending.messageID, status: "running")
        let original = progress(pending, entry: row, observedAt: now)
        let later = now.addingTimeInterval(66)
        XCTAssertEqual(original.presentation(at: later).phase, .unknown)
        let renewed = ConversationImageProgressState.derive(pending: pending, isSending: false,
            isChecking: false, entry: row, observedAt: later, now: later)
        XCTAssertEqual(renewed.messageID, original.messageID)
        XCTAssertEqual(renewed.presentation(at: later).phase, .running)
        XCTAssertEqual(renewed.observationExpiresAt, later.addingTimeInterval(65))

        let completed = ConversationImageProgressState.derive(pending: pending, isSending: false,
            isChecking: false, entry: try entry(messageID: pending.messageID, status: "completed"),
            observedAt: later, now: later)
        XCTAssertEqual(completed.presentation(at: later.addingTimeInterval(66)).phase, .unknown)
        XCTAssertFalse(completed.showsActivity)
        XCTAssertTrue(completed.canCheck)
    }

    func testFutureObservationAndClockRollbackFailClosedOutsideExistingTolerance() throws {
        let pending = pending()
        let row = try entry(messageID: pending.messageID, status: "running")
        let future = progress(pending, entry: row, observedAt: now.addingTimeInterval(5))
        XCTAssertEqual(future.phase, .running)
        XCTAssertEqual(future.observationExpiresAt, now.addingTimeInterval(70))
        XCTAssertEqual(future.presentation(at: now.addingTimeInterval(70)), future)
        XCTAssertEqual(future.presentation(at: now.addingTimeInterval(70.001)).phase, .unknown)
        XCTAssertEqual(future.presentation(at: now.addingTimeInterval(-0.001)).phase, .unknown)
        let anomalous = progress(pending, entry: row, observedAt: now.addingTimeInterval(5.001))
        XCTAssertEqual(anomalous.phase, .unknown)
        XCTAssertNil(anomalous.observationExpiresAt)
        XCTAssertFalse(anomalous.showsActivity)
        XCTAssertTrue(anomalous.canCheck)
    }

    func testStoppingObservationExpiresButLocalSendAndFailureStatesDoNot() throws {
        var pending = pending()
        let stopping = progress(pending, entry: try entry(messageID: pending.messageID,
            status: "running", extra: ["cancel_requested": true]), observedAt: now)
        XCTAssertEqual(stopping.phase, .stopping)
        XCTAssertEqual(stopping.presentation(at: now.addingTimeInterval(66)).phase, .unknown)

        let local = progress(pending, sending: true)
        XCTAssertEqual(local.phase, .sending)
        XCTAssertNil(local.observationExpiresAt)
        XCTAssertFalse(local.requiresTimeline)
        XCTAssertEqual(local.presentation(at: now.addingTimeInterval(300)), local)
        pending.state = .admitted
        let checkingAdmission = progress(pending, checking: true)
        XCTAssertEqual(checkingAdmission.phase, .waiting)
        XCTAssertNil(checkingAdmission.observationExpiresAt)
        XCTAssertEqual(checkingAdmission.presentation(at: now.addingTimeInterval(300)), checkingAdmission)

        for status in ["failed", "interrupted", "cancelled"] {
            let terminal = progress(pending, entry: try entry(messageID: pending.messageID, status: status), observedAt: now)
            XCTAssertEqual(terminal.phase, status == "cancelled" ? .stopped : .failed)
            XCTAssertFalse(terminal.showsActivity)
            XCTAssertTrue(terminal.canCheck)
            XCTAssertNil(terminal.observationExpiresAt)
            XCTAssertEqual(terminal.presentation(at: now.addingTimeInterval(300)), terminal)
        }
    }

    func testExpiredPresentationCannotBorrowAnObservationForDifferentMessageOrAttachment() throws {
        let pending = pending()
        let foreignMessage = progress(pending, entry: try entry(status: "running"), observedAt: now)
        let foreignImage = progress(pending, entry: try entry(messageID: pending.messageID, status: "queued", extra: [
            "images": [["attachment_id": UUID().uuidString, "file_name": "synthetic.png", "media_type": "image/png",
                        "byte_size": 1, "content_hash": String(repeating: "a", count: 64)]]
        ]), observedAt: now)
        for value in [foreignMessage, foreignImage] {
            XCTAssertEqual(value.phase, .unknown)
            XCTAssertNil(value.observationExpiresAt)
            XCTAssertFalse(value.requiresTimeline)
            XCTAssertEqual(value.presentation(at: now.addingTimeInterval(66)), value)
        }
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
