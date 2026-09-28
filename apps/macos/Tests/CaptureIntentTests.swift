import Foundation
import XCTest
@testable import TalentSignalMac

final class CaptureIntentTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_800_000_000)
    private let png = Data([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

    private func context(owner: String = "owner-one", policy: String = "policy-one") -> CaptureContext {
        CaptureContext(origin: "https://workspace.example", ownerScope: owner,
                       loginBinding: "login-one", expiresAt: date.addingTimeInterval(300),
                       processing: CaptureProcessing(policyVersion: policy,
                                                     workspaceLabel: "Workspace", processorLabels: ["Claude · sonnet"],
                                                     sourceRetentionDays: 30, available: true))
    }

    func testIntentPinsOneAccountOnePolicyAndImmutableImageIdentity() throws {
        let intent = try CaptureIntent(imagePNG: png, context: context(), capturedAt: date)
        XCTAssertTrue(intent.canSubmit(context: context(), now: date.addingTimeInterval(10)))
        XCTAssertFalse(intent.canSubmit(context: context(owner: "owner-two"), now: date))
        XCTAssertFalse(intent.canSubmit(context: context(policy: "policy-two"), now: date))
        XCTAssertFalse(intent.canSubmit(context: context(), now: date.addingTimeInterval(301)))
        XCTAssertEqual(intent.idempotencyKey, intent.messageId.uuidString.lowercased())
        XCTAssertEqual(intent.contentHash.count, 64)
        XCTAssertEqual(intent.imageByteSize, png.count)
    }

    func testRecoveryDeadlineDoesNotMoveWhenRetryPhaseChanges() throws {
        var intent = try CaptureIntent(imagePNG: png, context: context(), capturedAt: date)
        let deadline = intent.localRecoveryDeadline
        intent.phase = .unknown
        XCTAssertEqual(intent.localRecoveryDeadline, deadline)
        XCTAssertTrue(intent.isLocallyExpired(at: date.addingTimeInterval(86_400)))
        XCTAssertFalse(intent.isLocallyExpired(at: date.addingTimeInterval(86_399)))
    }

    func testContextRejectsMalformedOrUnavailableProcessing() throws {
        let json = Data("""
          {"protocol_version":1,"owner_scope":"owner","login_binding":"login","expires_at":"2027-01-01T00:00:00.000Z",
           "processing":{"policy_version":"v1","available":false,"processor_labels":[],"source_retention_days":30}}
          """.utf8)
        let parsed = try CaptureContext.decode(json, origin: "https://workspace.example")
        XCTAssertFalse(parsed.processing.available)
        XCTAssertThrowsError(try CaptureIntent(imagePNG: png, context: parsed, capturedAt: date))
    }
}
