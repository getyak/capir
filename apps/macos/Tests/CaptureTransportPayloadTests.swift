import Foundation
import XCTest
@testable import TalentSignalMac

final class CaptureTransportPayloadTests: XCTestCase {
    func testInstructionEnvelopeMatchesTheSharedWebAdmissionFixture() throws {
        // The real encoder owns this fixture; Web runs it through the real
        // desktop submit and canonical queue routes on every supported CI host.
        let fixtureURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("scripts/macos/fixtures/desktop-capture-submission.json")
        let expected = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? NSDictionary)
        let context = CaptureContext(origin: "https://workspace.example",
            ownerScope: "9adafce302b5b34661dbc65e7f5097e0b269ac258c5d2eeceba0e6cada0c6cb0",
            loginBinding: "synthetic-login", expiresAt: Date(timeIntervalSince1970: 1_900_000_000),
            processing: .init(policyVersion: "current-policy", workspaceLabel: "Workspace",
                processorLabels: ["Synthetic"], sourceRetentionDays: 30, available: true))
        let images = try XCTUnwrap(expected["images"] as? [[String: Any]])
        let encodedImage = try XCTUnwrap(images.first?["data_base64"] as? String)
        let png = try XCTUnwrap(Data(base64Encoded: encodedImage))
        let intent = try CaptureIntent(imagePNG: png, context: context,
            capturedAt: Date(timeIntervalSince1970: 1_800_000_000),
            id: UUID(uuidString: "fe397a13-e018-48b9-ab09-0f6c866a4501")!,
            sessionId: UUID(uuidString: "72ce7ff4-a5a8-40d0-b1d7-d84a13adcd30")!,
            messageId: UUID(uuidString: "a072ed54-6d56-413d-af4b-3ebc01ba646a")!,
            attachmentId: UUID(uuidString: "ae5d77d0-7cdf-420f-8c45-ecf317d05c6d")!,
            objective: "  只分析截图，不保存 🕊️\n保留原文，不创建联系人。  ")
        let actual = try XCTUnwrap(JSONSerialization.jsonObject(with: CaptureTransportPayload.encode(intent)) as? NSDictionary)
        XCTAssertEqual(actual, expected)
        XCTAssertEqual(intent.objective, "  只分析截图，不保存 🕊️\n保留原文，不创建联系人。  ")
    }

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
