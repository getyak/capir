import Foundation
import XCTest
@testable import TalentSignal

@MainActor
final class ConversationImageProgressTrackerTests: XCTestCase {
    func testPeriodicSnapshotDoesNotEraseTheSameRunsVerifiedStage() throws {
        let pending = pending(), runID = UUID()
        let row = try entry(pending: pending, runID: runID)
        let tracker = ConversationImageProgressTracker()
        tracker.beginChecking(messageID: pending.messageID)
        tracker.apply(update(pending: pending, row: row, revision: 8, stage: .contactRead))
        XCTAssertEqual(tracker.state(for: pending, isSending: true).textKey, "Reading relevant records…")

        // The periodic snapshot has the same queue revision but no stage field.
        // The interface must not flicker back to a generic spinner every poll.
        tracker.apply(observation(row: row, revision: 8), messageID: pending.messageID)
        XCTAssertEqual(tracker.state(for: pending, isSending: true).textKey, "Reading relevant records…")
    }

    func testNewRunAndTerminalReadbackDoNotReuseAnEarlierRunsStage() throws {
        let pending = pending(), firstRun = UUID(), nextRun = UUID()
        let tracker = ConversationImageProgressTracker()
        tracker.beginChecking(messageID: pending.messageID)
        tracker.apply(update(pending: pending, row: try entry(pending: pending, runID: firstRun), revision: 3, stage: .contactRead))
        tracker.apply(observation(row: try entry(pending: pending, runID: nextRun), revision: 4), messageID: pending.messageID)
        XCTAssertEqual(tracker.state(for: pending, isSending: true).textKey, "Processing your message…")

        tracker.apply(update(pending: pending, row: try entry(pending: pending, runID: nextRun), revision: 5, stage: .answer))
        tracker.apply(observation(row: try entry(pending: pending, runID: nextRun, status: "completed"), revision: 6), messageID: pending.messageID)
        let terminal = tracker.state(for: pending, isSending: true)
        XCTAssertEqual(terminal.phase, .readback)
        XCTAssertEqual(terminal.textKey, "Reading the saved reply…")
    }

    func testOlderOrForeignObservationCannotReplaceCurrentMessageProgress() throws {
        let pending = pending(), runID = UUID()
        let tracker = ConversationImageProgressTracker()
        tracker.beginChecking(messageID: pending.messageID)
        tracker.apply(update(pending: pending, row: try entry(pending: pending, runID: runID), revision: 9, stage: .answer))
        tracker.apply(observation(row: try entry(pending: pending, runID: runID, status: "failed"), revision: 8), messageID: pending.messageID)
        let foreign = self.pending()
        tracker.apply(update(pending: foreign, row: try entry(pending: foreign, runID: UUID(), status: "failed"), revision: 100))
        XCTAssertEqual(tracker.state(for: pending, isSending: true).textKey, "Writing a reply…")

        tracker.reset(for: foreign.messageID)
        tracker.apply(update(pending: pending, row: try entry(pending: pending, runID: runID), revision: 101, stage: .answer))
        XCTAssertEqual(tracker.state(for: foreign, isSending: false).phase, .unknown,
                       "A prior message cannot animate the new protected message.")
    }

    private func pending() -> PendingImageConversation {
        PendingImageConversation(messageID: UUID(), idempotencyKey: "synthetic-progress-only", objective: "",
            images: [], createdAt: Date(), timeZone: "UTC", queueEntryID: UUID(), state: .admitted)
    }

    private func entry(pending: PendingImageConversation, runID: UUID, status: String = "running") throws -> ConversationImageQueueEntry {
        let body: [String: Any] = ["queue_entry_id": try XCTUnwrap(pending.queueEntryID).uuidString,
            "message_id": pending.messageID.uuidString, "run_id": runID.uuidString,
            "status": status, "images": []]
        return try JSONDecoder().decode(ConversationImageQueueEntry.self, from: JSONSerialization.data(withJSONObject: body))
    }

    private func update(pending: PendingImageConversation, row: ConversationImageQueueEntry, revision: Int,
        stage: ConversationImageRunStage? = nil) -> ConversationImageQueueUpdate {
        .init(sessionID: UUID(), messageID: pending.messageID, entry: row, paused: false,
            revision: revision, observedAt: Date(), observedStage: stage)
    }

    private func observation(row: ConversationImageQueueEntry, revision: Int) -> ConversationImageObservation {
        let record = AgentSessionRemoteRecord(sessionID: UUID(), revision: revision,
            updatedAt: Date(), expiresAt: Date().addingTimeInterval(60), deletedAt: nil, payload: nil)
        return ConversationImageObservation(record: record, entry: row, paused: false, observedAt: Date(), revision: revision)
    }
}
