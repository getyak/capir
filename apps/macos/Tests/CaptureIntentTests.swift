import Foundation
import XCTest
@testable import TalentSignalMac

final class CaptureIntentTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_800_000_000)
    private let png = Data([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

    private func context(owner: String = "owner-one", policy: String = "policy-one",
                         login: String = "login-one") -> CaptureContext {
        CaptureContext(origin: "https://workspace.example", ownerScope: owner,
                       loginBinding: login, expiresAt: date.addingTimeInterval(300),
                       processing: CaptureProcessing(policyVersion: policy,
                                                     workspaceLabel: "Workspace", processorLabels: ["Claude · sonnet"],
                                                     sourceRetentionDays: 30, available: true))
    }

    func testIntentPinsOneAccountOnePolicyAndImmutableImageIdentity() throws {
        let intent = try CaptureIntent(imagePNG: png, context: context(), capturedAt: date)
        XCTAssertTrue(intent.canSubmit(context: context(), now: date.addingTimeInterval(10)))
        XCTAssertFalse(intent.canSubmit(context: context(owner: "owner-two"), now: date))
        XCTAssertFalse(intent.canSubmit(context: context(policy: "policy-two"), now: date))
        XCTAssertFalse(intent.canSubmit(context: context(login: "login-two"), now: date))
        XCTAssertTrue(intent.canReadback(context: context(login: "login-two"), now: date),
                      "The same owner may reconcile the original receipt after reauthentication")
        XCTAssertTrue(intent.canExplicitlyReplay(context: context(login: "login-two"), now: date))
        XCTAssertFalse(intent.canSubmit(context: context(), now: date.addingTimeInterval(301)))
        XCTAssertEqual(intent.idempotencyKey, intent.messageId.uuidString.lowercased())
        XCTAssertEqual(intent.contentHash.count, 64)
        XCTAssertEqual(intent.imageByteSize, png.count)
    }

    func testEarlierRecoveryWithoutLoginBindingCannotAuthorizeUpload() throws {
        let intent = try CaptureIntent(imagePNG: png, context: context(), capturedAt: date)
        var encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(intent)) as? [String: Any])
        encoded.removeValue(forKey: "loginBinding")
        let recovered = try JSONDecoder().decode(CaptureIntent.self, from: JSONSerialization.data(withJSONObject: encoded))
        XCTAssertNil(recovered.loginBinding)
        XCTAssertFalse(recovered.canSubmit(context: context(), now: date))
        XCTAssertFalse(recovered.canExplicitlyReplay(context: context(), now: date))
        XCTAssertTrue(recovered.canReadback(context: context(), now: date))
    }

    func testRecoveryDeadlineDoesNotMoveWhenRetryPhaseChanges() throws {
        var intent = try CaptureIntent(imagePNG: png, context: context(), capturedAt: date)
        let deadline = intent.localRecoveryDeadline
        intent.phase = .unknown
        XCTAssertEqual(intent.localRecoveryDeadline, deadline)
        XCTAssertTrue(intent.isLocallyExpired(at: date.addingTimeInterval(86_400)))
        XCTAssertFalse(intent.isLocallyExpired(at: date.addingTimeInterval(86_399)))
    }

    func testVerifiedAdmissionReleasesPixelsButPreservesExactReceiptIdentity() throws {
        let intent = try CaptureIntent(imagePNG: png, context: context(), capturedAt: date)
        let admitted = intent.withoutRawImage()
        XCTAssertFalse(admitted.hasRawImage)
        XCTAssertEqual(admitted.imageByteSize, png.count)
        XCTAssertEqual(admitted.contentHash, intent.contentHash)
        XCTAssertEqual(admitted.sessionId, intent.sessionId)
        XCTAssertEqual(admitted.messageId, intent.messageId)
        XCTAssertFalse(admitted.canSubmit(context: context(), now: date))
        XCTAssertThrowsError(try CaptureTransportPayload.encode(admitted))
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
