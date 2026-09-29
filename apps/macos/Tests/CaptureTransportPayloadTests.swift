import Foundation
import XCTest
@testable import TalentSignalMac

final class CaptureTransportPayloadTests: XCTestCase {
    func testUploadEnvelopeReusesStableImageAndMessageIDsWithoutCredentials() throws {
        let context = CaptureContext(origin: "https://workspace.example", ownerScope: "scope-one", loginBinding: "login-one",
                                     expiresAt: Date(timeIntervalSince1970: 1_900_000_000),
                                     processing: CaptureProcessing(policyVersion: "policy-one", workspaceLabel: "Workspace",
                                                                   processorLabels: ["Claude · sonnet"], sourceRetentionDays: 30,
                                                                   available: true))
        let png = Data([137, 80, 78, 71, 13, 10, 26, 10, 4, 5])
        let intent = try CaptureIntent(imagePNG: png, context: context, capturedAt: Date(timeIntervalSince1970: 1_800_000_000))
        let body = try CaptureTransportPayload.encode(intent)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        let images = try XCTUnwrap(object["images"] as? [[String: Any]])
        XCTAssertEqual(object["message_id"] as? String, intent.messageId.uuidString.lowercased())
        XCTAssertEqual(object["idempotency_key"] as? String, intent.messageId.uuidString.lowercased())
        XCTAssertEqual(object["owner_scope"] as? String, "scope-one")
        XCTAssertEqual(object["policy_version"] as? String, "policy-one")
        XCTAssertEqual(images.count, 1)
        XCTAssertEqual(images[0]["data_base64"] as? String, png.base64EncodedString())
        XCTAssertEqual(images[0]["content_hash"] as? String, intent.contentHash)
        XCTAssertEqual(images[0]["byte_size"] as? Int, png.count)
        XCTAssertFalse(String(decoding: body, as: UTF8.self).contains("login-one"))
    }

    @MainActor
    func testOlderContextCannotUndoNewerOwnerOrSignOut() throws {
        let at = Date(timeIntervalSince1970: 1_800_000_000)
        let processing = CaptureProcessing(policyVersion: "policy", workspaceLabel: "Workspace",
                                           processorLabels: ["Synthetic"], sourceRetentionDays: 30, available: true)
        let ownerA = CaptureContext(origin: "https://workspace.example", ownerScope: "owner-a", loginBinding: "login-a",
                                    expiresAt: at.addingTimeInterval(300), processing: processing)
        let ownerB = CaptureContext(origin: ownerA.origin, ownerScope: "owner-b", loginBinding: "login-b",
                                    expiresAt: at.addingTimeInterval(300), processing: processing)
        let fence = CaptureContextReadFence()
        let oldA = fence.begin(), newB = fence.begin()
        try fence.accept(ownerB, sequence: newB)
        XCTAssertThrowsError(try fence.accept(ownerA, sequence: oldA))

        let oldB = fence.begin(), signedOut = fence.begin()
        XCTAssertTrue(fence.signedOut(sequence: signedOut))
        XCTAssertThrowsError(try fence.accept(ownerB, sequence: oldB))

        let staleSignOut = fence.begin(), freshB = fence.begin()
        try fence.accept(ownerB, sequence: freshB)
        XCTAssertFalse(fence.signedOut(sequence: staleSignOut),
                       "A late 401 must surface as stale, never sign out a newer verified owner")
    }

    @MainActor
    func testConcurrentSameOwnerContextsMayBothFinish() throws {
        let at = Date(timeIntervalSince1970: 1_800_000_000)
        let processing = CaptureProcessing(policyVersion: "policy", workspaceLabel: "Workspace",
                                           processorLabels: ["Synthetic"], sourceRetentionDays: 30, available: true)
        let earlier = CaptureContext(origin: "https://workspace.example", ownerScope: "owner-a", loginBinding: "login-a",
                                     expiresAt: at.addingTimeInterval(300), processing: processing)
        let later = CaptureContext(origin: earlier.origin, ownerScope: earlier.ownerScope, loginBinding: earlier.loginBinding,
                                   expiresAt: at.addingTimeInterval(301), processing: processing)
        let fence = CaptureContextReadFence()
        let first = fence.begin(), second = fence.begin()
        try fence.accept(later, sequence: second)
        XCTAssertNoThrow(try fence.accept(earlier, sequence: first))
    }
}
