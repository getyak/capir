import Foundation
import XCTest
@testable import TalentSignalMac

final class CaptureResultTests: XCTestCase {
    private func fixture() throws -> (CaptureIntent, [String: Any]) {
        let context = CaptureContext(origin: "https://workspace.example", ownerScope: "scope", loginBinding: "binding",
            expiresAt: .distantFuture, processing: .init(policyVersion: "policy", workspaceLabel: "Workspace",
                processorLabels: ["Actual Inspector"], sourceRetentionDays: 30, available: true))
        let intent = try CaptureIntent(imagePNG: Data([1, 2, 3]), context: context)
        let object: [String: Any] = ["session_id": intent.sessionId.uuidString, "message_id": intent.messageId.uuidString,
            "queue_entry_id": UUID().uuidString, "result_version": String(repeating: "a", count: 64),
            "source": ["attachment_id": intent.attachmentId.uuidString, "byte_size": 3, "content_hash": intent.contentHash],
            "observation": ["artifact_id": "conversation-image-\(intent.messageId.uuidString.lowercased())-0-\(intent.attachmentId.uuidString.lowercased())",
                "content_hash": intent.contentHash, "model": "actual-inspector", "inspection_request_id": "same-run-receipt",
                "pending": true, "conversation_kind": "unknown", "clues": [["kind": "company", "text": "松禾设计", "source_excerpt": "松禾设计"]]],
            "observed_at": "2026-10-18T00:00:00Z"]
        return (intent, object)
    }

    private func decode(_ object: [String: Any]) throws -> CaptureResult {
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(CaptureResult.self, from: JSONSerialization.data(withJSONObject: object))
    }

    func testExactPendingResultAndLegacyNoClueResponseRemainDistinct() throws {
        var (intent, object) = try fixture()
        let result = try decode(object)
        XCTAssertTrue(result.matches(intent: intent, queueEntryID: result.queueEntryId))
        XCTAssertEqual(result.observation?.clues.first?.text, "松禾设计")
        object["observation"] = NSNull()
        let legacy = try decode(object)
        XCTAssertTrue(legacy.matches(intent: intent, queueEntryID: result.queueEntryId))
        XCTAssertNil(legacy.observation)
    }

    func testAnotherMessageQueueImageOrProducerCannotSupplyAClue() throws {
        let (intent, original) = try fixture()
        for key in ["session_id", "message_id"] {
            var changed = original; changed[key] = UUID().uuidString
            XCTAssertFalse(try decode(changed).matches(intent: intent, queueEntryID: nil))
        }
        XCTAssertFalse(try decode(original).matches(intent: intent, queueEntryID: UUID()))
        for (key, value) in [("content_hash", String(repeating: "b", count: 64)), ("artifact_id", "foreign"),
                             ("inspection_request_id", "")] {
            var changed = original
            var observation = try XCTUnwrap(changed["observation"] as? [String: Any]); observation[key] = value
            changed["observation"] = observation
            XCTAssertFalse(try decode(changed).matches(intent: intent, queueEntryID: nil))
        }
    }

    func testConfirmedOrUnboundedTextAndMissingExcerptNeverRenders() throws {
        let (intent, original) = try fixture()
        var object = original
        var observation = try XCTUnwrap(object["observation"] as? [String: Any])
        observation["pending"] = false; object["observation"] = observation
        XCTAssertFalse(try decode(object).matches(intent: intent, queueEntryID: nil))
        observation["pending"] = true
        for clue in [["kind": "person", "text": "虚构", "source_excerpt": "其他文字"],
                     ["kind": "company", "text": String(repeating: "x", count: 81), "source_excerpt": String(repeating: "x", count: 81)]] {
            observation["clues"] = [clue]; object["observation"] = observation
            XCTAssertFalse(try decode(object).matches(intent: intent, queueEntryID: nil))
        }
    }
}
