import XCTest
@testable import TalentSignalMac

@MainActor
final class AppModelSafetyTests: XCTestCase {
    func testFirstNativeInitializationIsSharedAndDoesNotReloadOverACollectedDraft() async {
        let service = SwitchingAccountService(accountIDs: ["real-account", "unexpected-reload"])
        let model = AppModel(service: service, accountID: "pending-live-account")
        async let first = model.ensureInitialized()
        async let second = model.ensureInitialized()
        let initialized = await (first, second)
        XCTAssertTrue(initialized.0)
        XCTAssertTrue(initialized.1)
        model.addSelectedText("Synthetic first Quick Panel selection")
        let itemIDs = model.capsule.items.map(\.id)
        let readyAgain = await model.ensureInitialized()
        XCTAssertTrue(readyAgain)
        XCTAssertEqual(model.capsule.items.map(\.id), itemIDs)
        XCTAssertEqual(model.relationshipScopeOptions.first?.id, "scope-real-account")
    }

    func testFirstUsefulInsightAppearsBeforeIdentityOrScopeConfirmation() throws {
        let model = AppModel(service: FixtureRelationshipService(initialMode: .ready))

        model.addSelectedText("I'd prefer a hybrid setup, ideally two days from home.")

        let insight = try XCTUnwrap(model.provisionalInsight)
        XCTAssertEqual(model.scopeReviewStatus, .proposed)
        XCTAssertNil(model.selectedScopeOptionID)
        XCTAssertFalse(model.canSubmitCapsule)
        XCTAssertEqual(insight.change, "A work-arrangement factor surfaced")
        XCTAssertTrue(model.capsule.items[0].preview.contains(insight.exactEvidence))
        XCTAssertNotNil(model.companionTrialMetrics.firstValueMilliseconds)
        XCTAssertLessThan(model.companionTrialMetrics.firstValueMilliseconds ?? .infinity, 5_000)

        model.prepareLocalDraft()
        XCTAssertEqual(model.localDraftStatus, .prepared)
        XCTAssertTrue(model.editableFollowUpDraft.contains("work-arrangement"))
        XCTAssertNotNil(model.companionTrialMetrics.draftPreparedMilliseconds)

        model.recordEvidenceSupport(.supported)
        XCTAssertEqual(model.companionTrialMetrics.evidenceSupport, .supported)
    }

    func testExplicitMacSelectionServiceRequestIsHandledExactlyOnce() {
        let model = AppModel(service: FixtureRelationshipService(initialMode: .ready))
        let requestID = UUID()

        XCTAssertTrue(model.addServiceSelectedText("I prefer a hybrid setup.", requestID: requestID))
        XCTAssertFalse(model.addServiceSelectedText("I prefer a hybrid setup.", requestID: requestID))

        XCTAssertEqual(model.capsule.items.count, 1)
        XCTAssertTrue(model.intakeControlReceipt?.contains("explicitly invoked") == true)
        XCTAssertTrue(model.intakeControlReceipt?.contains("No clipboard polling") == true)
    }

    func testScopeMustBeExplicitlySelectedAndConfirmedBeforeSubmission() async {
        let model = AppModel(service: FixtureRelationshipService(initialMode: .ready))
        model.addSelectedText("Reviewed source fragment")
        let itemID = try! XCTUnwrap(model.capsule.items.first?.id)
        model.setAttribution(id: itemID, actorKind: .candidate)
        model.confirmAttribution(id: itemID)

        XCTAssertNil(model.selectedScopeOptionID)
        XCTAssertEqual(model.presentation.candidateName, "Choose a Person or keep identity unresolved")
        XCTAssertFalse(model.canSubmitCapsule)

        model.recordConsequenceReviewStarted()
        XCTAssertNotNil(model.companionTrialMetrics.scopeReviewStartedMilliseconds)

        model.selectFirstRelationshipScopeFromKeyboard()
        XCTAssertFalse(model.canSubmitCapsule, "Selection is not confirmation.")

        await model.confirmRelationshipScope()
        XCTAssertTrue(model.canSubmitCapsule)
        XCTAssertNotNil(model.companionTrialMetrics.scopeConfirmedMilliseconds)

        model.keepRelationshipScopeUnresolved()
        XCTAssertNil(model.selectedScopeOptionID)
        XCTAssertFalse(model.canSubmitCapsule)
        XCTAssertEqual(model.mode, .ambiguousIdentity)
    }

    func testSyntheticDecisionReviewPreservesTheExactSubmittedEvidence() async throws {
        let model = AppModel(service: FixtureRelationshipService(initialMode: .ready))
        let submittedEvidence = "I can decide Friday once the client confirms the exact remote policy."
        model.addSelectedText(submittedEvidence)
        let itemID = try XCTUnwrap(model.capsule.items.first?.id)
        model.setAttribution(id: itemID, actorKind: .candidate)
        model.confirmAttribution(id: itemID)
        model.selectFirstRelationshipScopeFromKeyboard()
        await model.confirmRelationshipScope()

        await model.submitCurrentInsight()

        let review = try XCTUnwrap(model.pendingDecision)
        XCTAssertEqual(model.mode, .needsDecision)
        XCTAssertEqual(review.evidence.map(\.text), [submittedEvidence])
        XCTAssertTrue(review.evidence[0].source.contains("User-selected text"))
        XCTAssertEqual(review.items[0].evidenceRefs, review.evidence.map(\.id))
        let expiry = try XCTUnwrap(ISO8601DateFormatter().date(from: review.expiresAt))
        XCTAssertGreaterThan(expiry, Date())
    }

    func testCurrentInsightSaveCannotReuseAnEarlierReviewedSource() async throws {
        let model = AppModel(service: FixtureRelationshipService(initialMode: .ready))
        model.addSelectedText("Earlier evidence that was already reviewed.")
        let earlierID = try XCTUnwrap(model.capsule.items.first?.id)
        model.setAttribution(id: earlierID, actorKind: .candidate)
        model.confirmAttribution(id: earlierID)
        model.selectFirstRelationshipScopeFromKeyboard()
        await model.confirmRelationshipScope()
        await model.submitCurrentInsight()
        XCTAssertTrue(model.currentInsightHasSubmittedManifest)

        let currentEvidence = "I can decide Friday once the client confirms the exact remote policy."
        model.addSelectedText(currentEvidence)
        let currentID = try XCTUnwrap(model.capsule.items.last?.id)

        XCTAssertFalse(model.currentInsightHasSubmittedManifest)
        XCTAssertFalse(model.canSubmitCurrentInsight)
        XCTAssertTrue(model.canSubmitCapsule, "The general Capsule still contains an earlier reviewed item.")

        model.setAttribution(id: currentID, actorKind: .candidate)
        model.confirmAttribution(id: currentID)
        XCTAssertTrue(model.canSubmitCurrentInsight)
        await model.submitCurrentInsight()

        XCTAssertEqual(model.lastSubmittedManifest?.selectedItems.map(\.sourceID), [currentID.uuidString])
        XCTAssertEqual(model.lastSubmittedManifest?.selectedItems.map(\.reviewedContent), [currentEvidence])
        XCTAssertEqual(model.pendingDecision?.evidence.map(\.text), [currentEvidence])
        XCTAssertTrue(model.currentInsightHasSubmittedManifest)
    }

    func testRemoteSignOutFailureStillClearsLocalAuthorityAndCapsule() async {
        let reminderService = StubFollowUpReminderService(executeFailure: nil)
        let reminderRecoveryStore = AccountFixtureReminderRecoveryStore()
        let model = AppModel(
            service: FailingSignOutService(),
            initialMode: .ready,
            capsuleStore: DeletingCapsuleStore(),
            followUpReminderService: reminderService,
            reminderRecoveryStore: reminderRecoveryStore
        )
        model.addSelectedText("Sensitive reviewed fragment")
        model.selectRelationshipScopeOption(id: "synthetic-scope")

        await model.signOutAndClearLocalData()

        XCTAssertTrue(model.isSignedOut)
        XCTAssertTrue(model.isPaused)
        XCTAssertTrue(model.capsule.items.isEmpty)
        XCTAssertTrue(model.relationshipScopeOptions.isEmpty)
        XCTAssertNil(model.selectedScopeOptionID)
        XCTAssertEqual(model.accountID, "signed-out")
        XCTAssertFalse(model.canSubmitCapsule)
        XCTAssertTrue(model.deletionReceipt?.contains("outcome-unknown") == true)
        XCTAssertTrue(model.deletionReceipt?.contains("Deleted encrypted Capsule recovery") == true)
        XCTAssertTrue(model.errorMessage?.contains("Signed out locally") == true)
        XCTAssertEqual(reminderService.clearRecoveryCallCount, 1)
        XCTAssertEqual(reminderRecoveryStore.clearedAccountIDs, ["synthetic-account"])
    }

    func testStopIntakeDeletesOnlyLocalDraftAndDoesNotClaimCanonicalCancellation() {
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            initialMode: .ready,
            capsuleStore: DeletingCapsuleStore()
        )
        model.addSelectedText("Unsubmitted local fragment")

        model.stopContextIntake()

        XCTAssertTrue(model.isPaused)
        XCTAssertTrue(model.capsule.items.isEmpty)
        XCTAssertEqual(model.mode, .deleted)
        XCTAssertTrue(model.intakeControlReceipt?.contains("deleted 1 visible local item") == true)
        XCTAssertTrue(model.intakeControlReceipt?.contains("No canonical Task was active") == true)
    }

    func testOpeningModelCreatesNoWindowCaptureAndExplicitPickerAddsOneLocalItem() async {
        let capture = StubWindowCapture(payload: .init(
            recognizedText: "Synthetic reviewed window text",
            imagePNG: Data([1, 2, 3, 4]),
            pixelWidth: 800,
            pixelHeight: 600,
            sourceFingerprint: "window-hash",
            localTextRecognition: .available
        ))
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            windowCapture: capture
        )

        XCTAssertTrue(model.capsule.items.isEmpty)
        XCTAssertEqual(capture.callCount, 0)

        await model.addSystemSelectedWindow()

        XCTAssertEqual(capture.callCount, 1)
        XCTAssertEqual(model.capsule.items.count, 1)
        XCTAssertEqual(model.capsule.items[0].kind, .window)
        XCTAssertTrue(model.capsule.items[0].localOnly)
        XCTAssertTrue(model.windowCaptureReceipt?.contains("exactly one frame") == true)
        XCTAssertTrue(model.windowCaptureReceipt?.contains("No cursor or audio") == true)
    }

    func testWindowChoiceCanBeCancelledFromTheQuickPanelWithoutCapturing() async {
        let capture = CancellableStubWindowCapture()
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            windowCapture: capture
        )

        let task = Task { await model.addSystemSelectedWindow() }
        await Task.yield()
        await Task.yield()
        XCTAssertTrue(model.isSelectingWindow)

        model.cancelSystemSelectedWindow()
        await task.value

        XCTAssertFalse(model.isSelectingWindow)
        XCTAssertEqual(capture.cancelCallCount, 1)
        XCTAssertTrue(model.capsule.items.isEmpty)
        XCTAssertEqual(model.windowCaptureReceipt, "Window selection cancelled. Nothing was captured or retained.")
    }

    func testExplicitScreenshotFileProducesLocalFirstValueWithoutScopeOrUpload() async throws {
        let extraction = LocalFileTextExtraction(
            displayName: "authorized-screenshot.png",
            recognizedText: "The candidate said another process reaches final interviews on September 3, 2026, and I need the exact remote-work policy before then.",
            rawData: Data([1, 2, 3, 4]),
            mediaType: "image/png",
            sourceFingerprint: "synthetic-image-fingerprint",
            method: .localImageOCR
        )
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            localFileTextExtractor: StubLocalFileTextExtractor(result: .success(extraction))
        )

        await model.addFiles([URL(fileURLWithPath: "/tmp/authorized-screenshot.png")])

        let item = try XCTUnwrap(model.capsule.items.last)
        XCTAssertEqual(item.kind, .file)
        XCTAssertEqual(item.preview, extraction.recognizedText)
        XCTAssertEqual(item.localAssetData, extraction.rawData)
        XCTAssertEqual(item.localAssetMediaType, "image/png")
        XCTAssertTrue(item.localOnly)
        XCTAssertTrue(item.hasReviewedTextDerivative)
        XCTAssertNil(model.selectedScopeOptionID)
        XCTAssertNotNil(model.provisionalInsight)
        XCTAssertTrue(model.fileIngestReceipt?.contains("reviewable local text") == true)
        XCTAssertTrue(model.capsule.sharedItems.isEmpty)
    }

    func testUnsupportedChosenFileIsNotRetainedOrPresentedAsReviewed() async {
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            localFileTextExtractor: StubLocalFileTextExtractor(result: .failure(.unsupportedType))
        )

        await model.addFiles([URL(fileURLWithPath: "/tmp/unsupported.bin")])

        XCTAssertTrue(model.capsule.items.isEmpty)
        XCTAssertNil(model.provisionalInsight)
        XCTAssertEqual(model.fileIngestReceipt, "No file was retained or added to the Capsule.")
        XCTAssertTrue(model.errorMessage?.contains("Nothing was retained") == true)
    }

    func testClearingContextInvalidatesLateFileExtractionResult() async {
        let extraction = LocalFileTextExtraction(
            displayName: "late-screenshot.png",
            recognizedText: "Candidate needs the remote policy before September 3, 2026.",
            rawData: Data([9, 8, 7]),
            mediaType: "image/png",
            sourceFingerprint: "late-file-fingerprint",
            method: .localImageOCR
        )
        let extractor = SuspendedLocalFileTextExtractor()
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            localFileTextExtractor: extractor
        )

        let importTask = Task {
            await model.addFiles([URL(fileURLWithPath: "/tmp/late-screenshot.png")])
        }
        for _ in 0..<100 {
            if await extractor.didStart() { break }
            await Task.yield()
        }
        XCTAssertTrue(model.isImportingFiles)

        model.clearLocalContext()
        await extractor.finish(with: extraction)
        await importTask.value

        XCTAssertTrue(model.capsule.items.isEmpty)
        XCTAssertNil(model.provisionalInsight)
        XCTAssertFalse(model.isImportingFiles)
        XCTAssertNil(model.fileIngestReceipt)
        XCTAssertTrue(model.deletionReceipt?.contains("No external record was changed") == true)
    }

    func testLocalRecognitionLossKeepsRawCaptureLocalWithoutCloudFallback() async {
        let capture = StubWindowCapture(payload: .init(
            recognizedText: "",
            imagePNG: Data([7, 8, 9]),
            pixelWidth: 640,
            pixelHeight: 480,
            sourceFingerprint: "ocr-outage-window",
            localTextRecognition: .unavailable
        ))
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            windowCapture: capture
        )

        await model.addSystemSelectedWindow()

        XCTAssertEqual(model.capsule.items.count, 1)
        XCTAssertTrue(model.capsule.items[0].localOnly)
        XCTAssertEqual(model.capsule.items[0].localAssetData, Data([7, 8, 9]))
        XCTAssertFalse(model.capsule.canSubmit)
        XCTAssertTrue(model.windowCaptureReceipt?.contains("Local text recognition was unavailable") == true)
        XCTAssertTrue(model.windowCaptureReceipt?.contains("no cloud fallback") == true)
    }

    func testClipboardFailureNeverClaimsCopiedOrSent() {
        let clipboard = StubPreparedDraftClipboard(result: false)
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .needsDecision),
            initialMode: .needsDecision,
            preparedDraftClipboard: clipboard
        )
        model.addSelectedText("I need clarity on the remote policy before Friday.")
        model.prepareLocalDraft()

        model.copyPreparedDraft()

        XCTAssertEqual(clipboard.callCount, 1)
        XCTAssertEqual(model.localDraftStatus, .prepared)
        XCTAssertTrue(model.errorMessage?.contains("did not confirm the clipboard write") == true)
        XCTAssertTrue(model.errorMessage?.contains("nothing was sent") == true)
    }

    func testClipboardSuccessClaimsCopiedButNeverSent() {
        let clipboard = StubPreparedDraftClipboard(result: true)
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .needsDecision),
            initialMode: .needsDecision,
            preparedDraftClipboard: clipboard
        )
        model.addSelectedText("I need clarity on the remote policy before Friday.")
        model.prepareLocalDraft()

        model.copyPreparedDraft()

        XCTAssertEqual(model.localDraftStatus, .copied)
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(clipboard.lastText, model.editableFollowUpDraft)
    }

    func testCopyWithoutSupportedDraftDoesNotWriteClipboardOrFabricateText() {
        let clipboard = StubPreparedDraftClipboard(result: true)
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            preparedDraftClipboard: clipboard
        )

        model.copyPreparedDraft()

        XCTAssertEqual(clipboard.callCount, 0)
        XCTAssertTrue(model.editableFollowUpDraft.isEmpty)
        XCTAssertEqual(model.localDraftStatus, .awaitingDecision)
        XCTAssertTrue(model.errorMessage?.contains("Nothing was copied or sent") == true)
    }

    func testFourDraftPurposesRemainLocalAndDoNotOpenMailUntilExplicitlyAsked() throws {
        let mail = StubPreparedMailDraftService(result: .failure(.systemRejectedOpen))
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            preparedMailDraftService: mail
        )
        model.addSelectedText("The candidate needs the exact remote policy before September 3, 2026.")

        for kind in PreparedDraftKind.allCases {
            model.prepareDraft(kind: kind)

            XCTAssertEqual(model.preparedDraftKind, kind)
            XCTAssertEqual(model.editableMailSubject, kind.mailSubject)
            XCTAssertFalse(model.editableFollowUpDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            XCTAssertEqual(model.localDraftStatus, .prepared)
            XCTAssertEqual(model.mailDraftHandoffStatus, .notOpened)
            XCTAssertEqual(model.capsule.localPreparedDraft?.kind, kind)
        }

        XCTAssertEqual(mail.callCount, 0)
    }

    func testMailDraftHandoffUsesExactlyReviewedSubjectAndBodyWithoutClaimingSend() throws {
        let mail = StubPreparedMailDraftService(result: .success(.init(
            subject: "Reviewed client question",
            openedAt: Date(timeIntervalSince1970: 1_788_000_000)
        )))
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            preparedMailDraftService: mail
        )
        model.addSelectedText("I need clarity on the remote policy before Friday.")
        model.prepareClientQuestion()
        model.editableMailSubject = "Reviewed client question"
        model.editableFollowUpDraft = "Could you confirm the remote policy before Friday?"

        model.openPreparedMailDraft()

        XCTAssertEqual(mail.callCount, 1)
        XCTAssertEqual(mail.lastSubject, "Reviewed client question")
        XCTAssertEqual(mail.lastBody, "Could you confirm the remote policy before Friday?")
        guard case .opened(let receipt) = model.mailDraftHandoffStatus else {
            return XCTFail("Expected the system draft open request to be acknowledged")
        }
        XCTAssertEqual(receipt.subject, "Reviewed client question")
        XCTAssertNil(model.errorMessage)
    }

    func testMailDraftHandoffFailureNeverClaimsOpenedOrSent() {
        let mail = StubPreparedMailDraftService(result: .failure(.systemRejectedOpen))
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            preparedMailDraftService: mail
        )
        model.addSelectedText("I need clarity on the remote policy before Friday.")
        model.prepareClientQuestion()

        model.openPreparedMailDraft()

        XCTAssertEqual(mail.callCount, 1)
        guard case .failed(let message) = model.mailDraftHandoffStatus else {
            return XCTFail("Expected a fail-closed mail handoff state")
        }
        XCTAssertTrue(message.contains("did not open"))
        XCTAssertTrue(message.contains("Nothing was sent"))
    }

    func testFieldTrialExportContainsMeasuresButNoCandidateRelationshipOrDraftContent() throws {
        let draftClipboard = StubPreparedDraftClipboard(result: true)
        let exportClipboard = StubCompanionTrialExportClipboard(result: true)
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            preparedDraftClipboard: draftClipboard,
            companionTrialExportClipboard: exportClipboard
        )
        model.addSelectedText("PRIVATE_TRIAL_SENTINEL Alex needs the remote policy before Friday.")
        model.prepareClientQuestion()
        model.editableFollowUpDraft = "PRIVATE_DRAFT_SENTINEL ask Alex about the confidential role."
        model.markPreparedDraftEdited()
        model.copyPreparedDraft()
        model.recordChangeUnderstanding(.yes)
        model.recordEvidenceSupport(.supported)
        model.recordReuseIntent(.yes)

        model.copyCompanionTrialExport()

        let export = try XCTUnwrap(exportClipboard.lastText)
        XCTAssertTrue(export.contains("draft_copied"))
        XCTAssertTrue(export.contains("\"schemaVersion\" : 2"))
        XCTAssertTrue(export.contains("\"changeUnderstanding\" : \"yes\""))
        XCTAssertTrue(export.contains("\"actionWasAdopted\" : true"))
        XCTAssertTrue(export.contains("\"actionWasEdited\" : true"))
        XCTAssertTrue(export.contains("supported"))
        XCTAssertTrue(export.contains("\"reuseIntent\" : \"yes\""))
        XCTAssertFalse(export.contains("PRIVATE_TRIAL_SENTINEL"))
        XCTAssertFalse(export.contains("PRIVATE_DRAFT_SENTINEL"))
        XCTAssertFalse(export.localizedCaseInsensitiveContains("Alex"))
        XCTAssertFalse(export.localizedCaseInsensitiveContains("remote policy"))
        XCTAssertFalse(export.localizedCaseInsensitiveContains(model.presentation.pursuitTitle))
        XCTAssertEqual(model.companionTrialExportReceipt, "Content-free session measures copied")
    }

    func testUnchangedDraftIsAdoptedWithoutBeingMisclassifiedAsEdited() throws {
        let clipboard = StubPreparedDraftClipboard(result: true)
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            preparedDraftClipboard: clipboard
        )
        model.addSelectedText("I need clarity on the remote policy before Friday.")
        model.prepareClientQuestion()

        model.markPreparedDraftEdited()
        model.copyPreparedDraft()

        XCTAssertFalse(model.companionTrialMetrics.actionWasEdited)
        let export = try XCTUnwrap(model.companionTrialExportJSON())
        XCTAssertTrue(export.contains("\"actionWasAdopted\" : true"))
        XCTAssertTrue(export.contains("\"actionWasEdited\" : false"))
    }

    func testDraftPurposeOrReminderEditRecordsAdaptationWithoutContent() {
        let model = AppModel(service: FixtureRelationshipService(initialMode: .ready))
        model.addSelectedText("I need clarity on the remote policy before Friday.")
        model.prepareClientQuestion()

        model.prepareDraft(kind: .meetingQuestion)

        XCTAssertTrue(model.companionTrialMetrics.actionWasEdited)

        let reminderModel = AppModel(service: FixtureRelationshipService(initialMode: .ready))
        let now = Date(timeIntervalSince1970: 1_788_000_000)
        reminderModel.addSelectedText("I need clarity on the remote policy before Friday.")
        reminderModel.beginReminderPreparation(now: now)
        XCTAssertFalse(reminderModel.companionTrialMetrics.actionWasEdited)

        reminderModel.reminderTitle = "Reviewed follow-up"
        reminderModel.markReminderEdited()

        XCTAssertTrue(reminderModel.companionTrialMetrics.actionWasEdited)
    }

    func testCancelledConsequenceReviewCanProduceAContentFreeDropOffMeasure() throws {
        let model = AppModel(service: FixtureRelationshipService(initialMode: .ready))
        model.addSelectedText("I need clarity on the remote policy before Friday.")
        model.recordConsequenceReviewStarted()

        model.recordConsequenceReviewAbandoned()
        model.recordChangeUnderstanding(.unsure)

        XCTAssertNotNil(model.companionTrialMetrics.consequenceReviewAbandonedMilliseconds)
        XCTAssertTrue(model.shouldShowCompanionTrialFeedback)
        XCTAssertFalse(model.hasCompletedCompanionAction)
        let export = try XCTUnwrap(model.companionTrialExportJSON())
        XCTAssertTrue(export.contains("\"changeUnderstanding\" : \"unsure\""))
        XCTAssertTrue(export.contains("\"actionWasAdopted\" : false"))
        XCTAssertFalse(export.localizedCaseInsensitiveContains("remote policy"))
    }

    func testUnsentDraftRecoversOnlyWithItsAccountAndExactSelectedSource() async throws {
        let store = AccountFixtureCapsuleStore()
        let option = Self.scopeOption(id: "recovery", person: "Alex Chen", pursuit: "Platform VP")
        let service = ScopeOptionsService(options: [option], accountID: "draft-account")
        let first = AppModel(service: service, capsuleStore: store)
        await first.load()
        first.addSelectedText("Alex Chen needs clarity on the remote policy before Friday.")
        first.prepareClientQuestion()
        first.editableMailSubject = "Reviewed subject"
        first.editableFollowUpDraft = "Reviewed unsent body"
        first.markMailDraftEdited()

        let recovered = AppModel(service: service, capsuleStore: store)
        await recovered.load()

        XCTAssertEqual(recovered.editableMailSubject, "Reviewed subject")
        XCTAssertEqual(recovered.editableFollowUpDraft, "Reviewed unsent body")
        XCTAssertEqual(recovered.preparedDraftKind, .clientQuestion)
        XCTAssertEqual(recovered.localDraftStatus, .prepared)
        XCTAssertEqual(recovered.mailDraftHandoffStatus, .notOpened)
        XCTAssertTrue(recovered.localRecoveryNotice?.contains("nothing was sent") == true)

        let otherAccount = AppModel(
            service: ScopeOptionsService(options: [option], accountID: "other-account"),
            capsuleStore: store
        )
        await otherAccount.load()
        XCTAssertEqual(otherAccount.localDraftStatus, .awaitingDecision)
        XCTAssertTrue(otherAccount.editableFollowUpDraft.isEmpty)
    }

    func testUnsentDraftFromOlderCompilerVersionFailsClosed() async throws {
        let store = AccountFixtureCapsuleStore()
        let option = Self.scopeOption(id: "old-compiler", person: "Alex Chen", pursuit: "Platform VP")
        let service = ScopeOptionsService(options: [option], accountID: "old-compiler-account")
        let now = Date()
        var draft = ContextCapsuleDraft()
        draft.addSelectedText("Alex Chen needs clarity on the remote policy before Friday.", now: now)
        let item = try XCTUnwrap(draft.items.first)
        let insight = try XCTUnwrap(CandidateFollowUpCompiler.compile(item: item, now: now))
        draft.localPreparedDraft = LocalPreparedDraftRecovery(
            sourceItemID: item.id,
            sourceDigest: insight.sourceDigest,
            derivationVersion: "candidate-follow-up-local-v2",
            kind: .clientQuestion,
            subject: "Stale subject",
            body: "Stale unsent body",
            savedAt: now,
            expiresAt: now.addingTimeInterval(3_600)
        )
        store.setDraft(draft, for: "old-compiler-account")

        let model = AppModel(service: service, capsuleStore: store)
        await model.load()

        XCTAssertEqual(model.localDraftStatus, .awaitingDecision)
        XCTAssertTrue(model.editableFollowUpDraft.isEmpty)
        XCTAssertNil(model.capsule.localPreparedDraft)
        XCTAssertNil(try store.load(accountID: "old-compiler-account", now: Date()).draft.localPreparedDraft)
    }

    func testDiscardPreparedDraftDeletesRecoveryButKeepsSelectedConversation() async throws {
        let store = AccountFixtureCapsuleStore()
        let option = Self.scopeOption(id: "discard", person: "Alex Chen", pursuit: "Platform VP")
        let service = ScopeOptionsService(options: [option], accountID: "discard-account")
        let model = AppModel(service: service, capsuleStore: store)
        await model.load()
        model.addSelectedText("Alex Chen needs clarity before Friday.")
        model.prepareClientQuestion()
        XCTAssertNotNil(try store.load(accountID: "discard-account", now: Date()).draft.localPreparedDraft)

        model.discardPreparedDraft()

        let stored = try store.load(accountID: "discard-account", now: Date()).draft
        XCTAssertNil(stored.localPreparedDraft)
        XCTAssertEqual(stored.items.count, 1)
        XCTAssertEqual(model.localDraftStatus, .awaitingDecision)
        XCTAssertTrue(model.editableFollowUpDraft.isEmpty)
        XCTAssertTrue(model.intakeControlReceipt?.contains("Nothing was sent") == true)
    }

    func testFailureRecoveryReturnsToLocalReviewWithoutRetryAuthority() {
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .failed),
            initialMode: .failed
        )
        model.errorMessage = "Synthetic task failure."

        model.returnToCapsuleAfterFailure()

        XCTAssertEqual(model.mode, .empty)
        XCTAssertNil(model.errorMessage)
        XCTAssertTrue(model.intakeControlReceipt?.contains("No Task, decision, or external action was retried") == true)
    }

    func testAccountSwitchClearsPriorMemoryAndRecoversOnlyCurrentAccount() async {
        let store = AccountFixtureCapsuleStore()
        store.setDraft(Self.draft("Account A private excerpt"), for: "account-a")
        store.setDraft(Self.draft("Account B private excerpt"), for: "account-b")
        let service = SwitchingAccountService(accountIDs: ["account-a", "account-b", "account-a"])
        let model = AppModel(service: service, capsuleStore: store)

        await model.load()
        XCTAssertEqual(model.accountID, "account-a")
        XCTAssertEqual(model.capsule.items.first?.preview, "Account A private excerpt")

        await model.load()
        XCTAssertEqual(model.accountID, "account-b")
        XCTAssertEqual(model.capsule.items.first?.preview, "Account B private excerpt")
        XCTAssertFalse(model.capsule.items.contains { $0.preview.contains("Account A") })

        await model.load()
        XCTAssertEqual(model.accountID, "account-a")
        XCTAssertEqual(model.capsule.items.first?.preview, "Account A private excerpt")
        XCTAssertFalse(model.capsule.items.contains { $0.preview.contains("Account B") })
    }

    func testMenuBarPrivacyCopyNeverContainsRelationshipOrEvidenceContent() {
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .needsDecision),
            initialMode: .needsDecision
        )
        model.addSelectedText("PRIVATE_NOTIFICATION_SENTINEL candidate compensation evidence")
        let copy = model.menuBarPrivacySummary.lowercased()

        XCTAssertFalse(copy.contains(model.presentation.candidateName.lowercased()))
        XCTAssertFalse(copy.contains(model.presentation.pursuitTitle.lowercased()))
        XCTAssertFalse(copy.contains(model.presentation.evidenceQuote.lowercased()))
        XCTAssertFalse(copy.contains("remote-work"))
        XCTAssertFalse(copy.contains("private_notification_sentinel"))
        XCTAssertFalse(copy.contains("compensation"))
        XCTAssertTrue(copy.contains("no private source content"))
    }

    func testUniqueVisibleCandidateNameSuggestsScopeWithoutSelectingOrBindingIt() async throws {
        let alex = Self.scopeOption(id: "alex", person: "Alex Chen", pursuit: "Platform VP")
        let mia = Self.scopeOption(id: "mia", person: "Mia Rivera", pursuit: "Revenue Lead")
        let model = AppModel(service: ScopeOptionsService(options: [alex, mia]))
        await model.load()

        model.addSelectedText("Alex Chen said the other process is moving quickly and needs clarity by Friday.")

        XCTAssertEqual(model.suggestedRelationshipScopeOption?.id, alex.id)
        XCTAssertNil(model.selectedScopeOptionID, "A local suggestion must never select relationship scope.")
        XCTAssertEqual(model.scopeReviewStatus, .proposed)
        XCTAssertFalse(model.canSubmitCapsule)
    }

    func testSharedCandidateNameAbstainsFromScopeSuggestion() async {
        let first = Self.scopeOption(id: "alex-platform", person: "Alex Chen", pursuit: "Platform VP")
        let second = Self.scopeOption(id: "alex-revenue", person: "Alex Chen", pursuit: "Revenue Lead")
        let model = AppModel(service: ScopeOptionsService(options: [first, second]))
        await model.load()

        model.addSelectedText("Alex Chen needs clarity by Friday.")

        XCTAssertNil(model.suggestedRelationshipScopeOption)
        XCTAssertNil(model.selectedScopeOptionID)
        XCTAssertEqual(model.scopeReviewStatus, .proposed)
    }

    func testTodayOpensTheExactCurrentProjectionWithoutSelectingRelationshipAuthority() async throws {
        let option = Self.scopeOption(id: "alex", person: "Alex Chen", pursuit: "Platform VP")
        let item = Self.todayItem(id: "proposal-alex", scopeOptionID: option.id)
        let model = AppModel(service: ScopeOptionsService(
            options: [option],
            todayAttention: .init(items: [item], noActionCount: 0, totalPursuitCount: 1)
        ))
        await model.load()

        model.openFirstTodayAttentionFromKeyboard()

        XCTAssertEqual(model.focusedTodayAttentionItem, item)
        XCTAssertEqual(model.focusedTodayRelationshipScopeOption?.id, option.id)
        XCTAssertEqual(model.selectedNavigation, .workspace)
        XCTAssertNil(model.selectedScopeOptionID, "Today navigation must not select relationship scope.")
        XCTAssertNil(model.pursuitID)
        XCTAssertNil(model.personID)
        XCTAssertEqual(model.scopeReviewStatus, .proposed)
        XCTAssertFalse(model.canSubmitCapsule)

        model.selectRelationshipScopeOption(id: option.id)
        XCTAssertNil(model.focusedTodayAttentionItem, "An explicit consequence-scope choice replaces the read-only Today projection.")
        XCTAssertEqual(model.selectedScopeOptionID, option.id)
        XCTAssertFalse(model.canSubmitCapsule, "Selection still is not confirmation.")
    }

    func testStaleTodayProjectionCannotOpenAsCurrentRelationshipContext() async {
        let item = Self.todayItem(id: "current-item", scopeOptionID: nil)
        let model = AppModel(service: ScopeOptionsService(
            options: [],
            todayAttention: .init(items: [item], noActionCount: 0, totalPursuitCount: 1)
        ))
        await model.load()

        model.openTodayAttention(id: "superseded-item")

        XCTAssertNil(model.focusedTodayAttentionItem)
        XCTAssertEqual(model.selectedNavigation, .today)
        XCTAssertTrue(model.errorMessage?.contains("changed") == true)
    }

    func testTodayProposalOpensTheExactDecisionGateWithoutPreselectingAChoice() async throws {
        let option = Self.scopeOption(id: "alex", person: "Alex Chen", pursuit: "Platform VP")
        let item = Self.todayItem(id: "proposal-alex", scopeOptionID: option.id)
        let model = AppModel(service: ScopeOptionsService(
            options: [option],
            todayAttention: .init(items: [item], noActionCount: 0, totalPursuitCount: 1)
        ))
        await model.load()
        model.openFirstTodayAttentionFromKeyboard()

        await model.reviewFocusedTodayProposal()

        let review = try XCTUnwrap(model.pendingDecision)
        XCTAssertEqual(model.mode, .needsDecision)
        XCTAssertEqual(review.proposalID, "20000000-0000-4000-8000-000000000003")
        XCTAssertTrue(model.decisionSelections.isEmpty)
        XCTAssertFalse(model.canResolveCanonicalDecision)
        XCTAssertNil(model.focusedTodayAttentionItem)
    }

    func testSyntheticTodayRemovesResolvedProposalButKeepsReversibleResult() async throws {
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .needsDecision),
            initialMode: .needsDecision,
            showsSyntheticTodayPreview: true
        )
        model.addSelectedText("I need clarity on the remote policy before Friday because the other process has accelerated.")
        await model.load()

        XCTAssertTrue(model.todayAttention.items.contains { $0.kind == .proposalReview })
        XCTAssertEqual(model.todayAttention.noActionCount, 2)

        model.decideNextCanonicalItem(.accept)
        await model.resolveCanonicalDecision()

        XCTAssertEqual(model.mode, .receipt)
        XCTAssertFalse(model.todayAttention.items.contains { $0.kind == .proposalReview })
        XCTAssertEqual(model.todayAttention.noActionCount, 3)
        XCTAssertEqual(model.todayAttention.totalPursuitCount, 5)
        XCTAssertEqual(model.actionCenterProjections.map(\.status), [.reversible])

        model.prepareCurrentConversationNextStep()

        XCTAssertEqual(model.localDraftStatus, .prepared)
        XCTAssertEqual(model.preparedDraftKind, .clientQuestion)
        XCTAssertEqual(model.quickPanelNavigationRequest?.destination, .insight)
        XCTAssertNotNil(model.canonicalReceipt, "Preparing the next local step must not erase the saved relationship receipt.")
        XCTAssertEqual(model.actionCenterProjections.map(\.status), [.reversible])

        model.clearLocalContext()

        XCTAssertNil(model.quickPanelNavigationRequest, "Deleting the local conversation must invalidate an unconsumed Quick Panel route.")
        XCTAssertEqual(model.localDraftStatus, .awaitingDecision)
    }

    func testNoActionReviewCannotCreateDuplicateWorkFromToday() async {
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .noAction),
            initialMode: .noAction,
            showsSyntheticTodayPreview: true
        )
        await model.load()

        XCTAssertFalse(model.canPrepareCurrentConversationNextStep)
        model.prepareCurrentConversationNextStep()

        XCTAssertEqual(model.localDraftStatus, .awaitingDecision)
        XCTAssertNil(model.quickPanelNavigationRequest)
        XCTAssertTrue(model.errorMessage?.contains("no new action") == true)
    }

    func testStaleAuthorityBecomesRefreshStateInsteadOfGenericFailure() async {
        let model = AppModel(
            service: StaleDecisionService(),
            initialMode: .needsDecision
        )

        await model.load()
        model.decideNextCanonicalItem(.accept)
        await model.resolveCanonicalDecision()

        XCTAssertEqual(model.mode, .stale)
        XCTAssertNil(model.pendingDecision)
        XCTAssertTrue(model.errorMessage?.contains("no longer has current authority") == true)
        XCTAssertTrue(model.presentation.actionProjections.allSatisfy {
            $0.status == .stale && $0.route == .reviewStaleSource
        })
    }

    func testReminderDestinationIsNotReadBeforeScopeAndAttributionReview() async {
        let reminderService = StubFollowUpReminderService(executeFailure: nil)
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            followUpReminderService: reminderService
        )
        model.addSelectedText("I need to decide by Friday.")
        model.beginReminderPreparation(now: Date(timeIntervalSince1970: 1_788_000_000))
        model.reminderDueAt = Date(timeIntervalSinceNow: 86_400)

        await model.loadReminderDestinationPreview()

        XCTAssertEqual(reminderService.previewCallCount, 0)
        guard case .failed(let message) = model.reminderOperationState else {
            return XCTFail("Expected a fail-closed reminder preview state")
        }
        XCTAssertTrue(message.contains("Confirm the relationship"))
    }

    func testSelectingRelationshipPreservesEditedReminderProposal() async throws {
        let option = Self.scopeOption(id: "alex", person: "Alex Chen", pursuit: "Platform VP")
        let model = AppModel(service: ScopeOptionsService(options: [option]))
        await model.load()
        model.addSelectedText("I need to decide by Friday.")
        let now = Date(timeIntervalSince1970: 1_788_000_000)
        let reviewedDueAt = now.addingTimeInterval(36_000)
        model.beginReminderPreparation(now: now)
        model.reminderTitle = "Confirm exact remote policy"
        model.reminderDueAt = reviewedDueAt

        model.selectRelationshipScopeOption(id: option.id)

        XCTAssertEqual(model.reminderTitle, "Confirm exact remote policy")
        XCTAssertEqual(model.reminderDueAt, reviewedDueAt)
        XCTAssertEqual(model.reminderOperationState, .notPrepared)
        XCTAssertEqual(model.selectedScopeOptionID, option.id)
    }

    func testExistingCanonicalActionBlocksReminderUntilRecruiterConfirmsItIsSeparate() async throws {
        let reminderService = StubFollowUpReminderService(executeFailure: nil)
        let option = Self.scopeOption(
            id: "alex",
            person: "Alex Chen",
            pursuit: "Platform VP",
            preflight: Self.preflightWithOpenAction
        )
        let model = AppModel(
            service: ScopeOptionsService(options: [option]),
            followUpReminderService: reminderService
        )
        await model.load()
        model.addSelectedText("I need to decide by Friday.")
        let itemID = try XCTUnwrap(model.capsule.items.first?.id)
        model.setAttribution(id: itemID, actorKind: .candidate)
        model.confirmAttribution(id: itemID)
        model.selectRelationshipScopeOption(id: option.id)
        await model.confirmRelationshipScope()
        model.beginReminderPreparation()
        model.reminderDueAt = Date(timeIntervalSinceNow: 86_400)

        XCTAssertEqual(model.reminderDuplicateActionDecision, .unreviewed)
        XCTAssertFalse(model.canPreviewReminderDestination)
        await model.loadReminderDestinationPreview()
        XCTAssertEqual(reminderService.previewCallCount, 0)

        model.confirmSeparateReminderAfterExistingActionReview()

        XCTAssertEqual(model.reminderDuplicateActionDecision, .separateReminderConfirmed)
        XCTAssertTrue(model.canPreviewReminderDestination)
        await model.loadReminderDestinationPreview()
        XCTAssertEqual(reminderService.previewCallCount, 1)
    }

    func testRecruiterCanUseExistingCanonicalActionWithoutTouchingEventKit() async throws {
        let reminderService = StubFollowUpReminderService(executeFailure: nil)
        let option = Self.scopeOption(
            id: "alex",
            person: "Alex Chen",
            pursuit: "Platform VP",
            preflight: Self.preflightWithOpenAction
        )
        let model = AppModel(
            service: ScopeOptionsService(options: [option]),
            followUpReminderService: reminderService
        )
        await model.load()
        model.addSelectedText("I need to decide by Friday.")
        let itemID = try XCTUnwrap(model.capsule.items.first?.id)
        model.setAttribution(id: itemID, actorKind: .candidate)
        model.confirmAttribution(id: itemID)
        model.selectRelationshipScopeOption(id: option.id)
        await model.confirmRelationshipScope()

        model.useExistingOwnedActionInstead()

        XCTAssertEqual(model.reminderDuplicateActionDecision, .useExistingAction)
        XCTAssertFalse(model.canPreviewReminderDestination)
        XCTAssertEqual(reminderService.previewCallCount, 0)
        XCTAssertEqual(reminderService.executeCallCount, 0)
        XCTAssertTrue(model.intakeControlReceipt?.contains("No Apple Reminder was created") == true)
    }

    func testMissingCanonicalConsequencePreflightFailsReminderClosed() async throws {
        let reminderService = StubFollowUpReminderService(executeFailure: nil)
        let option = Self.scopeOption(id: "alex", person: "Alex Chen", pursuit: "Platform VP")
        let model = AppModel(
            service: ScopeOptionsService(options: [option]),
            followUpReminderService: reminderService
        )
        await model.load()
        model.addSelectedText("I need to decide by Friday.")
        let itemID = try XCTUnwrap(model.capsule.items.first?.id)
        model.setAttribution(id: itemID, actorKind: .candidate)
        model.confirmAttribution(id: itemID)
        model.selectRelationshipScopeOption(id: option.id)
        await model.confirmRelationshipScope()
        model.beginReminderPreparation()
        model.reminderDueAt = Date(timeIntervalSinceNow: 86_400)

        XCTAssertEqual(model.reminderDuplicateActionDecision, .unavailable)
        XCTAssertFalse(model.canPreviewReminderDestination)
        await model.loadReminderDestinationPreview()
        XCTAssertEqual(reminderService.previewCallCount, 0)
    }

    func testReminderRequiresPreviewApprovalAndVerifiedDestinationReadback() async throws {
        let reminderService = StubFollowUpReminderService(executeFailure: nil)
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            followUpReminderService: reminderService
        )
        model.addSelectedText("I need to decide by Friday.")
        let itemID = try XCTUnwrap(model.capsule.items.first?.id)
        model.setAttribution(id: itemID, actorKind: .candidate)
        model.confirmAttribution(id: itemID)
        model.selectFirstRelationshipScopeFromKeyboard()
        await model.confirmRelationshipScope()
        model.beginReminderPreparation()
        model.reminderDueAt = Date(timeIntervalSinceNow: 86_400)

        await model.loadReminderDestinationPreview()
        XCTAssertEqual(model.reminderDestination?.title, "Follow Up")
        XCTAssertEqual(reminderService.previewCallCount, 1)
        XCTAssertEqual(reminderService.executeCallCount, 0)

        await model.approveAndCreateReminder()

        XCTAssertEqual(reminderService.executeCallCount, 1)
        guard case .saved(let receipt) = model.reminderOperationState else {
            return XCTFail("Expected verified reminder receipt")
        }
        XCTAssertEqual(receipt.destinationTitle, "Follow Up")
        XCTAssertEqual(receipt.title, model.reminderTitle)
    }

    func testUncertainReminderWriteDoesNotRetryAndCanOnlyReconcile() async throws {
        let reminderService = StubFollowUpReminderService(executeFailure: .saveFailed("response lost"))
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            followUpReminderService: reminderService
        )
        model.addSelectedText("I need to decide by Friday.")
        let itemID = try XCTUnwrap(model.capsule.items.first?.id)
        model.setAttribution(id: itemID, actorKind: .candidate)
        model.confirmAttribution(id: itemID)
        model.selectFirstRelationshipScopeFromKeyboard()
        await model.confirmRelationshipScope()
        model.beginReminderPreparation()
        model.reminderDueAt = Date(timeIntervalSinceNow: 86_400)
        await model.loadReminderDestinationPreview()

        await model.approveAndCreateReminder()

        XCTAssertEqual(reminderService.executeCallCount, 1)
        guard case .unknown = model.reminderOperationState else {
            return XCTFail("A lost write response must remain outcome-unknown")
        }

        await model.reconcileReminderOutcome()

        XCTAssertEqual(reminderService.executeCallCount, 1, "Reconciliation must not create another reminder.")
        XCTAssertEqual(reminderService.reconcileCallCount, 1)
        guard case .saved = model.reminderOperationState else {
            return XCTFail("Expected reconciliation readback receipt")
        }
    }

    func testReminderCreationFailsClosedWhenProtectedRecoveryCannotBeSaved() async throws {
        let reminderService = StubFollowUpReminderService(executeFailure: nil)
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            followUpReminderService: reminderService,
            reminderRecoveryStore: FailingReminderRecoveryStore()
        )
        model.addSelectedText("I need to decide by Friday.")
        let itemID = try XCTUnwrap(model.capsule.items.first?.id)
        model.setAttribution(id: itemID, actorKind: .candidate)
        model.confirmAttribution(id: itemID)
        model.selectFirstRelationshipScopeFromKeyboard()
        await model.confirmRelationshipScope()
        model.beginReminderPreparation()
        model.reminderDueAt = Date(timeIntervalSinceNow: 86_400)
        await model.loadReminderDestinationPreview()

        await model.approveAndCreateReminder()

        XCTAssertEqual(reminderService.executeCallCount, 0)
        guard case .failed(let message) = model.reminderOperationState else {
            return XCTFail("Expected reminder creation to fail before the external write")
        }
        XCTAssertTrue(message.contains("nothing was created"))
    }

    func testUnreadableReminderRecoveryBlocksNewWritesAndBlindReconciliation() async {
        let reminderService = StubFollowUpReminderService(executeFailure: nil)
        let model = AppModel(
            service: ScopeOptionsService(
                options: [Self.scopeOption(id: "alex", person: "Alex Chen", pursuit: "Platform VP")],
                accountID: "unreadable-recovery-account"
            ),
            followUpReminderService: reminderService,
            reminderRecoveryStore: UnreadableReminderRecoveryStore()
        )

        await model.load()

        guard case .unknown(let message) = model.reminderOperationState else {
            return XCTFail("Unreadable protected recovery must remain consequence-bearing")
        }
        XCTAssertTrue(message.contains("cannot be opened"))
        XCTAssertTrue(model.reminderNeedsActionCenter)
        XCTAssertFalse(model.canReconcileReminderOutcome)

        model.addSelectedText("I need to decide by Friday.")
        model.beginReminderPreparation()
        XCTAssertTrue(model.errorMessage?.contains("Finish checking or removing the earlier reminder") == true)

        await model.reconcileReminderOutcome()
        XCTAssertEqual(reminderService.executeCallCount, 0)
        XCTAssertEqual(reminderService.reconcileCallCount, 0)
        guard case .unknown = model.reminderOperationState else {
            return XCTFail("An unreadable recovery must not degrade into retry authority")
        }
    }

    func testReminderRecoverySurvivesRelaunchAndReconcilesWithoutCreate() async throws {
        let accountID = "reminder-recovery-account"
        let option = Self.scopeOption(id: "alex", person: "Alex Chen", pursuit: "Platform VP")
        let proposal = FollowUpReminderProposal.make(
            sourceItemID: UUID(uuidString: "10000000-0000-4000-8000-000000000010")!,
            sourceDigest: "opaque-source-digest",
            title: "Confirm exact remote policy",
            dueAt: Date(timeIntervalSinceNow: 86_400),
            timeZone: .current,
            evidenceQuote: "not stored in recovery",
            destination: .init(identifier: "follow-up-list", title: "Follow Up")
        )
        let recoveryStore = AccountFixtureReminderRecoveryStore()
        try recoveryStore.save(
            ReminderOperationRecovery(proposal: proposal, stage: .executionPending),
            accountID: accountID
        )
        let reminderService = StubFollowUpReminderService(executeFailure: nil)
        let model = AppModel(
            service: ScopeOptionsService(options: [option], accountID: accountID),
            followUpReminderService: reminderService,
            reminderRecoveryStore: recoveryStore
        )

        await model.load()

        guard case .unknown = model.reminderOperationState else {
            return XCTFail("Expected an unfinished write to recover as outcome unknown")
        }
        XCTAssertTrue(model.reminderNeedsActionCenter)
        XCTAssertEqual(model.reminderTitle, proposal.title)
        XCTAssertEqual(model.reminderDestination, proposal.destination)
        XCTAssertTrue(model.reminderRecoveryNotice?.contains("original operation") == true)

        await model.reconcileReminderOutcome()

        XCTAssertEqual(reminderService.executeCallCount, 0)
        XCTAssertEqual(reminderService.reconcileCallCount, 1)
        guard case .saved(let receipt) = model.reminderOperationState else {
            return XCTFail("Expected exact-ID reconciliation to restore a verified receipt")
        }
        XCTAssertEqual(receipt.idempotencyKey, proposal.idempotencyKey)
        XCTAssertEqual(recoveryStore.recoveries[accountID]?.stage, .verified)

        let relaunchedService = StubFollowUpReminderService(executeFailure: nil)
        let relaunched = AppModel(
            service: ScopeOptionsService(options: [option], accountID: accountID),
            followUpReminderService: relaunchedService,
            reminderRecoveryStore: recoveryStore
        )
        await relaunched.load()
        guard case .saved(let recoveredReceipt) = relaunched.reminderOperationState else {
            return XCTFail("Expected the verified reminder and reversal path after relaunch")
        }

        await relaunched.removeVerifiedReminder(recoveredReceipt)

        XCTAssertEqual(relaunchedService.removeCallCount, 1)
        guard case .removed = relaunched.reminderOperationState else {
            return XCTFail("Expected verified removal")
        }
        XCTAssertNil(recoveryStore.recoveries[accountID])
    }

    func testVerifiedReminderCanBeRemovedOnlyThroughVerifiedRemovalReadback() async throws {
        let reminderService = StubFollowUpReminderService(executeFailure: nil)
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            followUpReminderService: reminderService
        )
        model.addSelectedText("I need to decide by Friday.")
        let itemID = try XCTUnwrap(model.capsule.items.first?.id)
        model.setAttribution(id: itemID, actorKind: .candidate)
        model.confirmAttribution(id: itemID)
        model.selectFirstRelationshipScopeFromKeyboard()
        await model.confirmRelationshipScope()
        model.beginReminderPreparation()
        model.reminderDueAt = Date(timeIntervalSinceNow: 86_400)
        await model.loadReminderDestinationPreview()
        await model.approveAndCreateReminder()
        guard case .saved(let receipt) = model.reminderOperationState else {
            return XCTFail("Expected verified reminder receipt")
        }
        XCTAssertTrue(model.reminderNeedsActionCenter)
        XCTAssertEqual(model.actionCenterCount, 1)

        await model.removeVerifiedReminder(receipt)

        XCTAssertEqual(reminderService.removeCallCount, 1)
        guard case .removed(let removalReceipt) = model.reminderOperationState else {
            return XCTFail("Expected verified removal receipt")
        }
        XCTAssertEqual(removalReceipt.reminderIdentifier, receipt.reminderIdentifier)
        XCTAssertFalse(model.reminderNeedsActionCenter)
        XCTAssertEqual(model.actionCenterCount, 0)
    }

    func testClearingSensitiveConversationPreservesVerifiedExternalReminderRecovery() async throws {
        let reminderService = StubFollowUpReminderService(executeFailure: nil)
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: .ready),
            initialMode: .ready,
            capsuleStore: DeletingCapsuleStore(),
            followUpReminderService: reminderService
        )
        model.addSelectedText("I need to decide by Friday.")
        let itemID = try XCTUnwrap(model.capsule.items.first?.id)
        model.setAttribution(id: itemID, actorKind: .candidate)
        model.confirmAttribution(id: itemID)
        model.selectFirstRelationshipScopeFromKeyboard()
        await model.confirmRelationshipScope()
        model.beginReminderPreparation()
        model.reminderDueAt = Date(timeIntervalSinceNow: 86_400)
        await model.loadReminderDestinationPreview()
        await model.approveAndCreateReminder()
        guard case .saved(let receiptBeforeClear) = model.reminderOperationState else {
            return XCTFail("Expected a verified reminder before local evidence deletion")
        }

        model.clearLocalContext()

        XCTAssertTrue(model.capsule.items.isEmpty)
        guard case .saved(let receiptAfterClear) = model.reminderOperationState else {
            return XCTFail("Deleting sensitive context must not hide a real external reminder")
        }
        XCTAssertEqual(receiptAfterClear, receiptBeforeClear)
        XCTAssertTrue(model.reminderNeedsActionCenter)
        XCTAssertEqual(model.actionCenterCount, 1)
        XCTAssertTrue(model.deletionReceipt?.contains("remains visible in Needs your review") == true)
    }

    private static func draft(_ text: String) -> ContextCapsuleDraft {
        var draft = ContextCapsuleDraft()
        draft.addSelectedText(text)
        return draft
    }

    private static func scopeOption(
        id: String,
        person: String,
        pursuit: String,
        preflight: RelationshipConsequencePreflight? = nil
    ) -> RelationshipScopeOption {
        RelationshipScopeOption(
            id: id,
            pursuitID: "pursuit-\(id)",
            pursuitRevision: 1,
            pursuitTitle: pursuit,
            personID: "person-\(id)",
            personDisplayLabel: person,
            relationshipContextID: "context-\(id)",
            relationshipContextLabel: "Candidate in \(pursuit)",
            consequencePreflight: preflight
        )
    }

    private static func todayItem(
        id: String,
        scopeOptionID: String?,
        proposalID: String? = "proposal-alex"
    ) -> TodayAttentionItem {
        TodayAttentionItem(
            id: id,
            pursuitID: "pursuit-alex",
            pursuitTitle: "Platform VP",
            personLabel: "Alex Chen",
            kind: .proposalReview,
            whyNow: "Remote-policy expectation needs review",
            unresolved: "Two proposed changes remain unconfirmed.",
            owner: "You",
            dueAt: nil,
            dueFallback: "Pursuit target Sep 3",
            nextMove: "Review each proposed change against its exact evidence.",
            evidenceAvailability: "available",
            scopeOptionID: scopeOptionID,
            proposalID: proposalID
        )
    }

    private static let preflightWithOpenAction = RelationshipConsequencePreflight(
        milestone: "Decision dependency review",
        targetDate: "2026-09-03",
        evidenceAvailability: "available",
        openActions: [
            .init(
                id: "action-existing",
                title: "Clarify remote policy with client",
                owner: "Recruiter",
                dueAt: Date(timeIntervalSince1970: 1_788_364_800),
                status: "open"
            )
        ],
        openGaps: []
    )
}

private struct ScopeOptionsService: MacRelationshipServing {
    let options: [RelationshipScopeOption]
    var accountID = "scope-suggestion-account"
    var todayAttention: TodayAttentionProjection = .empty

    func loadWorkspace() async throws -> MacRelationshipServiceResponse {
        .connected(.init(
            workspaceID: "scope-suggestion-workspace",
            accountID: accountID,
            options: options,
            presentation: options.first?.presentation ?? .cleared,
            todayAttention: todayAttention
        ))
    }

    func confirmScope(_ selection: RelationshipScopeSelection) async throws { }
    func submit(manifest: SubmittedContextManifest) async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func resolveDecision(_ request: CanonicalDecisionRequest) async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func reconcileDecisionOutcome() async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func openTodayProposalReview(pursuitID: String, proposalID: String) async throws -> MacRelationshipServiceResponse {
        guard pursuitID == "pursuit-alex", proposalID == "proposal-alex" else {
            throw AppModelSafetyTestError.unavailable
        }
        return .syntheticFixture(FixtureRelationshipService.fixture(mode: .needsDecision))
    }
    func openProjection(_ projection: CanonicalProjectionRequest) async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func signOut() async throws -> SessionSignOutReceipt { throw AppModelSafetyTestError.unavailable }
}

private struct StaleDecisionService: MacRelationshipServing {
    func loadWorkspace() async throws -> MacRelationshipServiceResponse {
        .syntheticFixture(FixtureRelationshipService.fixture(mode: .needsDecision))
    }

    func confirmScope(_ selection: RelationshipScopeSelection) async throws { }

    func submit(manifest: SubmittedContextManifest) async throws -> MacRelationshipServiceResponse {
        .syntheticFixture(FixtureRelationshipService.fixture(mode: .needsDecision))
    }

    func resolveDecision(_ request: CanonicalDecisionRequest) async throws -> MacRelationshipServiceResponse {
        throw RelationshipServiceError.staleAuthority("Synthetic source version changed. No decision was sent.")
    }

    func reconcileDecisionOutcome() async throws -> MacRelationshipServiceResponse {
        throw RelationshipServiceError.invalidResponse("No unknown operation exists.")
    }

    func openProjection(_ projection: CanonicalProjectionRequest) async throws -> MacRelationshipServiceResponse {
        .syntheticFixture(FixtureRelationshipService.fixture(mode: .stale))
    }

    func signOut() async throws -> SessionSignOutReceipt {
        .init(sessionID: "stale-test", revokedAt: "2026-08-31T00:00:00Z")
    }
}

private enum AppModelSafetyTestError: LocalizedError {
    case unavailable

    var errorDescription: String? { "Synthetic transport loss." }
}

private struct FailingSignOutService: MacRelationshipServing {
    func loadWorkspace() async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func confirmScope(_ selection: RelationshipScopeSelection) async throws { }
    func submit(manifest: SubmittedContextManifest) async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func resolveDecision(_ request: CanonicalDecisionRequest) async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func reconcileDecisionOutcome() async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func openProjection(_ projection: CanonicalProjectionRequest) async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func signOut() async throws -> SessionSignOutReceipt { throw AppModelSafetyTestError.unavailable }
}

private struct DeletingCapsuleStore: LocalCapsulePersisting {
    func load(accountID: String, now: Date) throws -> CapsuleRecoveryResult {
        .init(draft: ContextCapsuleDraft(), expiredItemCount: 0)
    }

    func save(_ draft: ContextCapsuleDraft, accountID: String, now: Date) throws { }

    func clear(accountID: String, deleteKey: Bool) throws -> LocalCapsuleDeletionReceipt {
        .init(deletedFile: true, deletedKey: deleteKey)
    }
}

@MainActor
private final class StubWindowCapture: WindowCapturing {
    let payload: WindowCapturePayload
    var callCount = 0

    init(payload: WindowCapturePayload) {
        self.payload = payload
    }

    func captureOneWindow() async throws -> WindowCapturePayload {
        callCount += 1
        return payload
    }
}

@MainActor
private final class CancellableStubWindowCapture: WindowCapturing {
    var cancelCallCount = 0
    private var continuation: CheckedContinuation<WindowCapturePayload, Error>?

    func captureOneWindow() async throws -> WindowCapturePayload {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
        }
    }

    func cancelCapture() {
        cancelCallCount += 1
        continuation?.resume(throwing: WindowCaptureError.cancelled)
        continuation = nil
    }
}

private struct StubLocalFileTextExtractor: LocalFileTextExtracting {
    let result: Result<LocalFileTextExtraction, LocalFileTextExtractionError>

    func extract(url _: URL) async throws -> LocalFileTextExtraction {
        try result.get()
    }
}

private actor SuspendedLocalFileTextExtractor: LocalFileTextExtracting {
    private var started = false
    private var continuation: CheckedContinuation<LocalFileTextExtraction, Error>?

    func extract(url _: URL) async throws -> LocalFileTextExtraction {
        started = true
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
        }
    }

    func didStart() -> Bool { started }

    func finish(with extraction: LocalFileTextExtraction) {
        continuation?.resume(returning: extraction)
        continuation = nil
    }
}

@MainActor
private final class StubPreparedDraftClipboard: PreparedDraftCopying {
    let result: Bool
    var callCount = 0
    var lastText: String?

    init(result: Bool) {
        self.result = result
    }

    func copyPreparedDraft(_ text: String) -> Bool {
        callCount += 1
        lastText = text
        return result
    }
}

@MainActor
private final class StubPreparedMailDraftService: PreparedMailDraftOpening {
    let result: Result<MailDraftHandoffReceipt, MailDraftHandoffFailure>
    var callCount = 0
    var lastSubject: String?
    var lastBody: String?

    init(result: Result<MailDraftHandoffReceipt, MailDraftHandoffFailure>) {
        self.result = result
    }

    func openDraft(subject: String, body: String) -> Result<MailDraftHandoffReceipt, MailDraftHandoffFailure> {
        callCount += 1
        lastSubject = subject
        lastBody = body
        return result
    }
}

@MainActor
private final class StubCompanionTrialExportClipboard: CompanionTrialExportCopying {
    let result: Bool
    var lastText: String?

    init(result: Bool) {
        self.result = result
    }

    func copyTrialExport(_ text: String) -> Bool {
        lastText = text
        return result
    }
}

@MainActor
private final class StubFollowUpReminderService: FollowUpReminderServing {
    let executeFailure: FollowUpReminderFailure?
    var previewCallCount = 0
    var executeCallCount = 0
    var reconcileCallCount = 0
    var removeCallCount = 0
    var reconcileRemovalCallCount = 0
    var clearRecoveryCallCount = 0
    var recoveryAccountScopes: [String] = []

    init(executeFailure: FollowUpReminderFailure?) {
        self.executeFailure = executeFailure
    }

    func setLocalRecoveryAccount(_ accountID: String) {
        recoveryAccountScopes.append(accountID)
    }

    func clearLocalRecovery() {
        clearRecoveryCallCount += 1
    }

    func previewDestination() async -> Result<FollowUpReminderDestination, FollowUpReminderFailure> {
        previewCallCount += 1
        return .success(.init(identifier: "follow-up-list", title: "Follow Up"))
    }

    func execute(_ proposal: FollowUpReminderProposal) async -> Result<FollowUpReminderReceipt, FollowUpReminderFailure> {
        executeCallCount += 1
        if let executeFailure { return .failure(executeFailure) }
        return .success(receipt(for: proposal))
    }

    func reconcile(_ proposal: FollowUpReminderProposal) async -> Result<FollowUpReminderReceipt, FollowUpReminderFailure> {
        reconcileCallCount += 1
        return .success(receipt(for: proposal))
    }

    func remove(_ receipt: FollowUpReminderReceipt) async -> Result<FollowUpReminderRemovalReceipt, FollowUpReminderFailure> {
        removeCallCount += 1
        return .success(removalReceipt(for: receipt, alreadyAbsent: false))
    }

    func reconcileRemoval(_ receipt: FollowUpReminderReceipt) async -> Result<FollowUpReminderRemovalReceipt, FollowUpReminderFailure> {
        reconcileRemovalCallCount += 1
        return .success(removalReceipt(for: receipt, alreadyAbsent: false))
    }

    private func receipt(for proposal: FollowUpReminderProposal) -> FollowUpReminderReceipt {
        FollowUpReminderReceipt(
            idempotencyKey: proposal.idempotencyKey,
            reminderIdentifier: "verified-reminder",
            title: proposal.title,
            dueAt: proposal.dueAt,
            destinationIdentifier: proposal.destination.identifier,
            destinationTitle: proposal.destination.title,
            verifiedAt: Date()
        )
    }

    private func removalReceipt(
        for receipt: FollowUpReminderReceipt,
        alreadyAbsent: Bool
    ) -> FollowUpReminderRemovalReceipt {
        FollowUpReminderRemovalReceipt(
            idempotencyKey: receipt.idempotencyKey,
            reminderIdentifier: receipt.reminderIdentifier,
            destinationTitle: receipt.destinationTitle,
            removedAt: Date(),
            wasAlreadyAbsent: alreadyAbsent
        )
    }
}

private final class AccountFixtureCapsuleStore: LocalCapsulePersisting, @unchecked Sendable {
    private var drafts: [String: ContextCapsuleDraft] = [:]

    func setDraft(_ draft: ContextCapsuleDraft, for accountID: String) {
        drafts[accountID] = draft
    }

    func load(accountID: String, now: Date) throws -> CapsuleRecoveryResult {
        .init(draft: drafts[accountID] ?? ContextCapsuleDraft(), expiredItemCount: 0)
    }

    func save(_ draft: ContextCapsuleDraft, accountID: String, now: Date) throws {
        drafts[accountID] = draft
    }

    func clear(accountID: String, deleteKey: Bool) throws -> LocalCapsuleDeletionReceipt {
        .init(deletedFile: drafts.removeValue(forKey: accountID) != nil, deletedKey: deleteKey)
    }
}

private final class AccountFixtureReminderRecoveryStore: ReminderOperationRecoveryPersisting, @unchecked Sendable {
    var recoveries: [String: ReminderOperationRecovery] = [:]
    var clearedAccountIDs: [String] = []

    func load(accountID: String, now: Date) throws -> ReminderOperationRecovery? {
        guard let recovery = recoveries[accountID], recovery.expiresAt > now else {
            recoveries.removeValue(forKey: accountID)
            return nil
        }
        return recovery
    }

    func save(_ recovery: ReminderOperationRecovery, accountID: String) throws {
        recoveries[accountID] = recovery
    }

    func clear(accountID: String) throws -> Bool {
        clearedAccountIDs.append(accountID)
        return recoveries.removeValue(forKey: accountID) != nil
    }
}

private struct FailingReminderRecoveryStore: ReminderOperationRecoveryPersisting {
    private struct SaveFailure: Error { }

    func load(accountID: String, now: Date) throws -> ReminderOperationRecovery? { nil }
    func save(_ recovery: ReminderOperationRecovery, accountID: String) throws { throw SaveFailure() }
    func clear(accountID: String) throws -> Bool { false }
}

private struct UnreadableReminderRecoveryStore: ReminderOperationRecoveryPersisting {
    private struct ReadFailure: Error { }

    func load(accountID: String, now: Date) throws -> ReminderOperationRecovery? { throw ReadFailure() }
    func save(_ recovery: ReminderOperationRecovery, accountID: String) throws { }
    func clear(accountID: String) throws -> Bool { false }
}

private actor SwitchingAccountService: MacRelationshipServing {
    private let accountIDs: [String]
    private var index = 0

    init(accountIDs: [String]) {
        self.accountIDs = accountIDs
    }

    func loadWorkspace() async throws -> MacRelationshipServiceResponse {
        let accountID = accountIDs[min(index, accountIDs.count - 1)]
        index += 1
        let option = RelationshipScopeOption(
            id: "scope-\(accountID)",
            pursuitID: "pursuit-\(accountID)",
            pursuitRevision: 1,
            pursuitTitle: "Synthetic Pursuit",
            personID: "person-\(accountID)",
            personDisplayLabel: "Synthetic Person",
            relationshipContextID: "context-\(accountID)",
            relationshipContextLabel: "Synthetic relationship"
        )
        return .connected(.init(
            workspaceID: accountID,
            accountID: accountID,
            options: [option],
            presentation: option.presentation
        ))
    }

    func confirmScope(_ selection: RelationshipScopeSelection) async throws { }
    func submit(manifest: SubmittedContextManifest) async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func resolveDecision(_ request: CanonicalDecisionRequest) async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func reconcileDecisionOutcome() async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func openProjection(_ projection: CanonicalProjectionRequest) async throws -> MacRelationshipServiceResponse { throw AppModelSafetyTestError.unavailable }
    func signOut() async throws -> SessionSignOutReceipt { throw AppModelSafetyTestError.unavailable }
}
