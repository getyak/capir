import XCTest
@testable import TalentSignal

final class AskScreenshotAdmissionPolicyTests: XCTestCase {
    func testInterruptedScreenshotAndResearchNeverResumeAsText() {
        XCTAssertFalse(AskScreenshotAdmissionPolicy.canResumeAsText(hasPendingScreenshotAdmission: true, hasPendingPersonResearch: false))
        XCTAssertFalse(AskScreenshotAdmissionPolicy.canResumeAsText(hasPendingScreenshotAdmission: false, hasPendingPersonResearch: true))
        XCTAssertTrue(AskScreenshotAdmissionPolicy.canResumeAsText(hasPendingScreenshotAdmission: false, hasPendingPersonResearch: false))
    }

    func testInterruptedImageConversationNeverResumesAsText() {
        XCTAssertFalse(AskScreenshotAdmissionPolicy.canResumeAsText(hasPendingScreenshotAdmission: false,
            hasPendingPersonResearch: false, hasPendingImageConversation: true))
    }

    func testFingerprintReusesExactOrderedImagesWithoutPersistingBytes() throws {
        let images = [image([1, 2, 3]), image([4, 5, 6])]
        let fingerprint = try XCTUnwrap(identity(images))
        XCTAssertEqual(fingerprint.count, 64)
        XCTAssertEqual(fingerprint, identity([image([1, 2, 3]), image([4, 5, 6])]))
        XCTAssertNotEqual(fingerprint, identity(Array(images.reversed())))
        XCTAssertNotEqual(fingerprint, identity([image([1, 2, 3]), image([4, 5, 7])]))
        XCTAssertNotEqual(fingerprint, identity(images, objective: "A different objective"))
        XCTAssertNotEqual(fingerprint, identity(images, personID: "different-person"))
        XCTAssertFalse(fingerprint.contains(Data([1, 2, 3]).base64EncodedString()))
    }

    func testFingerprintIncludesMediaTypeAndRejectsEmptyAttachmentSet() {
        XCTAssertNotEqual(identity([image([1, 2, 3])]), identity([image([1, 2, 3], type: "image/jpeg")]))
        XCTAssertNil(identity([]))
    }

    func testDelayedOriginalScreenshotCompletionCannotAttachToFork() {
        let original = UUID()
        let fork = UUID()
        let owner = AskScreenshotResponseOwner(sessionID: original, taskID: "original-task")
        XCTAssertTrue(owner.accepts(currentSessionID: original, responseTaskID: "original-task"))
        XCTAssertFalse(owner.accepts(currentSessionID: fork, responseTaskID: "original-task"))
        XCTAssertFalse(owner.accepts(currentSessionID: nil, responseTaskID: "original-task"))
        XCTAssertFalse(owner.accepts(currentSessionID: original, responseTaskID: "another-task"))
        XCTAssertFalse(AskScreenshotResponseOwner(sessionID: original, taskID: nil)
            .accepts(currentSessionID: fork, responseTaskID: "newly-created-task"))
    }

    func testForkAcceptsItsNewScreenshotAndRejectsInheritedLiveResult() {
        let fork = UUID()
        let readOnly: Set<String> = ["inherited-task"]
        let owner = AskScreenshotResponseOwner(sessionID: fork, taskID: nil)
        XCTAssertTrue(owner.accepts(currentSessionID: fork, responseTaskID: "new-owned-task", readOnlyTaskIDs: readOnly))
        XCTAssertFalse(owner.accepts(currentSessionID: fork, responseTaskID: "inherited-task", readOnlyTaskIDs: readOnly))
    }

    @MainActor
    func testFullHistoryComposerPreflightStillReconcilesItsProtectedAdmission() throws {
        let store = AgentSessionStore()
        let sessionID = try XCTUnwrap(store.beginUnscopedSession(objective: "Capture history"))
        let objective = "Reconcile this screenshot"
        let images = [image([1, 2, 3])]
        let exactIdentity = try XCTUnwrap(identity(images, objective: objective))
        let key = "protected-before-other-device-filled-history"
        for index in 0..<19 {
            XCTAssertTrue(store.recordScreenshotTask(sessionID: sessionID, taskID: UUID().uuidString,
                objective: "Earlier screenshot \(index)", summary: "Saved", status: "completed"))
        }
        XCTAssertEqual(store.beginScreenshotAdmission(sessionID: sessionID, objective: objective,
            requestIdentity: exactIdentity, proposedIdempotencyKey: key), key)
        XCTAssertTrue(store.recordScreenshotTask(sessionID: sessionID, taskID: UUID().uuidString,
            objective: "Other device screenshot", summary: "Saved", status: "completed"))
        let pending = try XCTUnwrap(store.session(id: sessionID))
        XCTAssertEqual(pending.screenshotTaskIDs.count, 20)
        let capacityNotice = try XCTUnwrap(store.screenshotAdmissionNotice(sessionID: sessionID))
        // This is the same preflight used by send() before it reaches admission.
        XCTAssertNil(AskScreenshotAdmissionPolicy.newAdmissionCapacityNotice(
            hasAttachments: true, hasPendingScreenshotAdmission: pending.hasPendingScreenshotAdmission,
            capacityNotice: capacityNotice))
        XCTAssertNotNil(AskScreenshotAdmissionPolicy.newAdmissionCapacityNotice(
            hasAttachments: true, hasPendingScreenshotAdmission: false, capacityNotice: capacityNotice))
        XCTAssertNil(AskScreenshotAdmissionPolicy.newAdmissionCapacityNotice(
            hasAttachments: false, hasPendingScreenshotAdmission: false, capacityNotice: capacityNotice))
        XCTAssertNil(store.beginScreenshotAdmission(sessionID: sessionID, objective: objective,
            requestIdentity: try XCTUnwrap(identity([image([9])], objective: objective)),
            proposedIdempotencyKey: "different-image-must-not-pass"))
        XCTAssertEqual(store.beginScreenshotAdmission(sessionID: sessionID, objective: objective,
            requestIdentity: exactIdentity, proposedIdempotencyKey: "retry-keeps-the-original-key"), key)
        let acceptedTask = UUID().uuidString
        XCTAssertTrue(store.recordScreenshotTask(sessionID: sessionID, taskID: acceptedTask,
            objective: objective, summary: "Reconciled original task", status: "completed",
            admissionIdempotencyKey: key))
        let recovered = try XCTUnwrap(store.session(id: sessionID))
        XCTAssertFalse(recovered.hasPendingScreenshotAdmission)
        XCTAssertEqual(recovered.screenshotTaskIDs.count, 21)
        XCTAssertTrue(recovered.screenshotTaskIDs.contains(acceptedTask))
    }

    private func image(_ bytes: [UInt8], type: String = "image/png") -> ScreenshotContactTaskBody.Image {
        .init(data: Data(bytes), mediaType: type)
    }

    private func identity(_ images: [ScreenshotContactTaskBody.Image], objective: String = "Review the screenshot", personID: String? = nil) -> String? {
        AskScreenshotAdmissionPolicy.requestIdentity(images: images, objective: objective, personID: personID, relationshipContextID: nil)
    }
}
