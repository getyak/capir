import AppKit
import Foundation
import XCTest
@testable import TalentSignalMac

@MainActor
private final class FixtureSelector: CaptureSelecting {
    let image: CGImage
    var calls = 0
    var suspendNextSelection = false
    var pendingSelection: CheckedContinuation<CaptureSelectionResult, Error>?
    init() {
        let data = Data(repeating: 255, count: 4 * 4 * 4)
        let provider = CGDataProvider(data: data as CFData)!
        image = CGImage(width: 4, height: 4, bitsPerComponent: 8, bitsPerPixel: 32,
                        bytesPerRow: 16, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                        provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
    }
    func select() async throws -> CaptureSelectionResult {
        calls += 1
        if suspendNextSelection {
            suspendNextSelection = false
            return try await withCheckedThrowingContinuation { pendingSelection = $0 }
        }
        return CaptureSelectionResult(image: image, capturedAt: Date(timeIntervalSince1970: 1_800_000_000), preview: false)
    }
    func cancel() {}
}

@MainActor
private final class FixtureTransport: CaptureTransporting {
    var current: CaptureContext
    var contextRequests = 0
    var submissions = 0
    var loseFirstResponse = false
    var canonical: CaptureReceipt?
    var receiptReads = 0
    var suspendNextContext = false
    var pendingContext: CheckedContinuation<CaptureContext, Error>?
    var contextError: Error?
    init(current: CaptureContext) { self.current = current }
    func context() async throws -> CaptureContext {
        contextRequests += 1
        if let contextError { throw contextError }
        if suspendNextContext {
            suspendNextContext = false
            return try await withCheckedThrowingContinuation { pendingContext = $0 }
        }
        return current
    }
    func admit(_ intent: CaptureIntent, context: CaptureContext) async throws -> CaptureAdmission {
        guard intent.canSubmit(context: current, now: Date(timeIntervalSince1970: 1_800_000_000))
        else { throw CaptureTransportError.staleOrigin }
        submissions += 1
        canonical = CaptureReceipt(sessionId: intent.sessionId, messageId: intent.messageId,
                                   queueEntryId: UUID(), status: "queued",
                                   imageManifest: [.init(attachmentId: intent.attachmentId,
                                                         byteSize: intent.imageByteSize, contentHash: intent.contentHash)],
                                   resultRecorded: false)
        if loseFirstResponse && submissions == 1 { throw CaptureTransportError.unavailable }
        return CaptureAdmission(sessionId: intent.sessionId, messageId: intent.messageId,
                                queueEntryId: canonical!.queueEntryId, status: "queued")
    }
    func receipt(for intent: CaptureIntent, context: CaptureContext) async throws -> CaptureReceipt? {
        receiptReads += 1
        return canonical
    }
}

private final class FixtureRecovery: CaptureRecoveryPersisting {
    var saved: [CaptureIntent] = []
    var failDeletion = false
    func save(_ intent: CaptureIntent) throws {
        saved.removeAll { $0.id == intent.id }
        saved.append(intent)
    }
    func load(origin: String, ownerScope: String, now: Date) throws -> [CaptureIntent] {
        saved.filter { $0.origin == origin && $0.ownerScope == ownerScope && !$0.isLocallyExpired(at: now) }
    }
    func remove(_ intent: CaptureIntent) throws {
        if failDeletion { throw CaptureRecoveryError.encryptionFailed }
        saved.removeAll { $0.id == intent.id }
    }
}

final class CaptureCoordinatorTests: XCTestCase {
    @MainActor
    private func fixture() -> (CaptureContext, CapturePreferences, FixtureSelector, FixtureTransport, FixtureRecovery) {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let context = CaptureContext(origin: "https://workspace.example", ownerScope: "owner-one", loginBinding: "login-one",
                                     expiresAt: now.addingTimeInterval(300),
                                     processing: .init(policyVersion: "policy-one", workspaceLabel: "Workspace",
                                                       processorLabels: ["Claude · sonnet"], sourceRetentionDays: 30, available: true))
        let store = UserDefaults(suiteName: UUID().uuidString)!
        let preferences = CapturePreferences(store: store)
        preferences.acknowledgeProcessingScope(origin: context.origin, ownerScope: context.ownerScope,
                                               policyVersion: context.processing.policyVersion, at: now)
        return (context, preferences, FixtureSelector(), FixtureTransport(current: context), FixtureRecovery())
    }

    @MainActor
    func testCapturePersistsBeforeUploadAndUsesOneSessionMessage() async throws {
        let (_, prefs, selector, transport, recovery) = fixture()
        let coordinator = CaptureCoordinator(transport: transport, selector: selector, recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        await coordinator.startCapture()
        XCTAssertEqual(selector.calls, 1)
        XCTAssertEqual(transport.submissions, 1)
        XCTAssertEqual(recovery.saved.count, 0, "A matching canonical image receipt releases raw local bytes")
        guard case .processing = coordinator.presentation else { return XCTFail("Expected admitted processing") }
        XCTAssertNil(coordinator.nextLocalExpiry, "Only content-free receipt identity remains after admission")
    }

    @MainActor
    func testLostAdmissionResponseReadsTheExactReceiptBeforeRetry() async throws {
        let (_, prefs, _, transport, recovery) = fixture()
        transport.loseFirstResponse = true
        let coordinator = CaptureCoordinator(transport: transport, selector: FixtureSelector(), recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        await coordinator.startCapture()
        XCTAssertEqual(transport.submissions, 1)
        guard case .unknown(let id) = coordinator.presentation else { return XCTFail("Expected uncertain admission") }
        await coordinator.retry(intentID: id)
        XCTAssertEqual(transport.submissions, 1, "Readback resolves the lost response without sending again")
        XCTAssertTrue(recovery.saved.isEmpty)
        guard case .processing = coordinator.presentation else { return XCTFail("Expected canonical processing") }
    }

    @MainActor
    func testCompletedAnswerBecomesViewableOnlyAfterExactResultReadback() async throws {
        let (_, prefs, _, transport, recovery) = fixture()
        let coordinator = CaptureCoordinator(transport: transport, selector: FixtureSelector(), recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        await coordinator.startCapture()
        guard case .processing(let sessionID) = coordinator.presentation else { return XCTFail("Expected processing") }
        let queued = try XCTUnwrap(transport.canonical)
        transport.canonical = CaptureReceipt(sessionId: queued.sessionId, messageId: queued.messageId,
                                             queueEntryId: queued.queueEntryId, status: "completed",
                                             imageManifest: queued.imageManifest, resultRecorded: true)
        await coordinator.refreshCurrentStatus()
        guard case .viewable(let exact) = coordinator.presentation else { return XCTFail("Result must be recorded") }
        XCTAssertEqual(exact, sessionID)
    }

    @MainActor
    func testUnacknowledgedProcessingPolicyNeverOpensTheScreenSelector() async {
        let (context, _, selector, transport, recovery) = fixture()
        let prefs = CapturePreferences(store: UserDefaults(suiteName: UUID().uuidString)!)
        let coordinator = CaptureCoordinator(transport: transport, selector: selector, recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        await coordinator.startCapture()
        XCTAssertEqual(selector.calls, 0)
        XCTAssertEqual(transport.submissions, 0)
        guard case .needsDisclosure(let offered) = coordinator.presentation else { return XCTFail("Expected disclosure") }
        XCTAssertEqual(offered.ownerScope, context.ownerScope)
    }

    @MainActor
    func testFailedLocalDeletionCanOnlyRetryDeletion() async throws {
        let (_, prefs, _, transport, recovery) = fixture()
        transport.loseFirstResponse = true
        let coordinator = CaptureCoordinator(transport: transport, selector: FixtureSelector(), recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        await coordinator.startCapture()
        guard case .unknown(let id) = coordinator.presentation else { return XCTFail("Expected pending screenshot") }
        recovery.failDeletion = true
        coordinator.discardLocal(intentID: id)
        guard case .deletionFailed(let pending) = coordinator.presentation else { return XCTFail("Expected deletion recovery") }
        XCTAssertEqual(pending, id)
        await coordinator.retry(intentID: id)
        XCTAssertEqual(transport.submissions, 1)
        XCTAssertEqual(transport.receiptReads, 0, "Deleting cannot turn into an upload or status retry")
        recovery.failDeletion = false
        coordinator.discardLocal(intentID: id)
        XCTAssertTrue(recovery.saved.isEmpty)
        XCTAssertEqual(coordinator.presentation, .idle)
    }

    @MainActor
    func testDeletingWhileReceiptCheckIsSuspendedCannotUpload() async throws {
        let (_, prefs, _, transport, recovery) = fixture()
        transport.loseFirstResponse = true
        let coordinator = CaptureCoordinator(transport: transport, selector: FixtureSelector(), recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        await coordinator.startCapture()
        guard case .unknown(let id) = coordinator.presentation else { return XCTFail("Expected pending screenshot") }
        transport.suspendNextContext = true
        let retry = Task { await coordinator.retry(intentID: id) }
        for _ in 0..<100 where transport.pendingContext == nil { await Task.yield() }
        XCTAssertNotNil(transport.pendingContext)
        coordinator.discardLocal(intentID: id)
        transport.pendingContext?.resume(returning: transport.current)
        transport.pendingContext = nil
        await retry.value
        XCTAssertEqual(coordinator.presentation, .idle)
        XCTAssertTrue(recovery.saved.isEmpty)
        XCTAssertEqual(transport.submissions, 1)
        XCTAssertEqual(transport.receiptReads, 0)
    }

    @MainActor
    func testRepeatedShortcutDuringContextFetchStartsOnlyOneSelection() async throws {
        let (_, prefs, selector, transport, recovery) = fixture()
        transport.suspendNextContext = true
        let coordinator = CaptureCoordinator(transport: transport, selector: selector, recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        let first = Task { await coordinator.startCapture() }
        for _ in 0..<100 where transport.pendingContext == nil { await Task.yield() }
        XCTAssertNotNil(transport.pendingContext)
        await coordinator.startCapture()
        XCTAssertEqual(transport.contextRequests, 1)
        transport.pendingContext?.resume(returning: transport.current)
        transport.pendingContext = nil
        await first.value
        XCTAssertEqual(selector.calls, 1)
        XCTAssertEqual(transport.submissions, 1)
    }

    @MainActor
    func testReauthenticationDuringSelectionNeedsExactReadbackAndExplicitRetry() async throws {
        let (_, prefs, selector, transport, recovery) = fixture()
        selector.suspendNextSelection = true
        let coordinator = CaptureCoordinator(transport: transport, selector: selector, recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        let capture = Task { await coordinator.startCapture() }
        for _ in 0..<100 where selector.pendingSelection == nil { await Task.yield() }
        XCTAssertNotNil(selector.pendingSelection)
        let old = transport.current
        transport.current = CaptureContext(origin: old.origin, ownerScope: old.ownerScope,
                                           loginBinding: "login-two", expiresAt: old.expiresAt,
                                           processing: old.processing)
        selector.pendingSelection?.resume(returning: .init(image: selector.image,
                                                            capturedAt: Date(timeIntervalSince1970: 1_800_000_000), preview: false))
        selector.pendingSelection = nil
        await capture.value
        XCTAssertEqual(transport.submissions, 0)
        guard case .unknown(let intentID) = coordinator.presentation else { return XCTFail("Expected held recovery") }
        XCTAssertNil(recovery.saved.first?.authorizedReplayLoginBinding)
        await coordinator.retry(intentID: intentID)
        XCTAssertEqual(transport.receiptReads, 2, "Read absence before replay and the exact manifest after admission")
        XCTAssertEqual(transport.submissions, 1, "Only explicit retry may send the old image with the new login")
        guard case .processing = coordinator.presentation else { return XCTFail("Expected canonical admission") }
    }

    @MainActor
    func testExpiredUnknownImageKeepsOnlyReceiptIdentityAndCannotReplay() async throws {
        let (_, prefs, _, transport, recovery) = fixture()
        transport.loseFirstResponse = true
        let capturedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let coordinator = CaptureCoordinator(transport: transport, selector: FixtureSelector(), recovery: recovery,
                                             preferences: prefs, now: { capturedAt })
        await coordinator.startCapture()
        guard case .unknown(let id) = coordinator.presentation else { return XCTFail("Expected uncertain delivery") }
        transport.canonical = nil
        XCTAssertEqual(recovery.saved.count, 1)
        coordinator.expireLocalImages(at: capturedAt.addingTimeInterval(86_400))
        XCTAssertTrue(recovery.saved.isEmpty)
        XCTAssertFalse(coordinator.hasLocalImage(intentID: id))
        XCTAssertNil(coordinator.nextLocalExpiry)
        await coordinator.retry(intentID: id)
        XCTAssertEqual(transport.submissions, 1, "Expiry must not replay the same image")
        XCTAssertEqual(transport.receiptReads, 1, "Content-free state may still check the exact receipt")
    }

    @MainActor
    func testUnsubmittedPreviewExpiresAtOriginalCaptureTime() async throws {
        let (_, prefs, selector, transport, recovery) = fixture()
        prefs.afterSelection = .preview
        let capturedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let coordinator = CaptureCoordinator(transport: transport, selector: selector, recovery: recovery,
                                             preferences: prefs, now: { capturedAt })
        await coordinator.startCapture()
        XCTAssertEqual(coordinator.presentation, .previewReady)
        XCTAssertNotNil(coordinator.previewImage)
        XCTAssertEqual(coordinator.nextLocalExpiry, capturedAt.addingTimeInterval(86_400))
        coordinator.expireLocalImages(at: capturedAt.addingTimeInterval(86_400))
        XCTAssertNil(coordinator.previewImage)
        XCTAssertEqual(transport.submissions, 0)
        XCTAssertNil(coordinator.nextLocalExpiry)
    }

    @MainActor
    func testPreviewWindowRebindsAfterWorkspaceCoordinatorChanges() async throws {
        let (_, firstPrefs, _, firstTransport, firstRecovery) = fixture()
        firstPrefs.afterSelection = .preview
        let first = CaptureCoordinator(transport: firstTransport, selector: FixtureSelector(), recovery: firstRecovery,
                                       preferences: firstPrefs)
        await first.startCapture()
        XCTAssertNotNil(first.previewImage)

        let window = CapturePreviewWindowController()
        window.show(coordinator: first)
        let (_, secondPrefs, _, secondTransport, secondRecovery) = fixture()
        secondPrefs.afterSelection = .preview
        let second = CaptureCoordinator(transport: secondTransport, selector: FixtureSelector(), recovery: secondRecovery,
                                        preferences: secondPrefs)
        await second.startCapture()
        window.show(coordinator: second)
        XCTAssertNil(first.previewImage, "The prior workspace preview must be discarded on rebind")
        XCTAssertNotNil(second.previewImage)
        window.dismiss()
        XCTAssertNil(second.previewImage, "Closing the rebound preview must discard only its image")
    }

    @MainActor
    func testSignedOutContextCannotRestorePreviousOwnerScreenshot() async throws {
        let (context, prefs, _, transport, recovery) = fixture()
        let intent = try CaptureIntent(imagePNG: Data([1, 2, 3]), context: context,
                                       capturedAt: Date(timeIntervalSince1970: 1_800_000_000))
        try recovery.save(intent)
        transport.contextError = CaptureTransportError.server(401, "backend_session_expired")
        let coordinator = CaptureCoordinator(transport: transport, selector: FixtureSelector(), recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        await coordinator.restoreRecovery()
        XCTAssertEqual(coordinator.presentation, .needsSignIn)
        XCTAssertNil(coordinator.nextLocalExpiry, "Signed-out UI must not load the prior owner's raw image")
        transport.contextError = CaptureTransportError.unavailable
        await coordinator.restoreRecovery()
        XCTAssertEqual(coordinator.presentation, .needsSignIn)
        XCTAssertNil(coordinator.nextLocalExpiry, "Offline fallback cannot undo an explicit sign-out")
        XCTAssertEqual(recovery.saved.count, 1, "Encrypted recovery remains partitioned for a later authorized login")
    }

    @MainActor
    func testSameOriginAccountSwitchClearsOldOwnerPresentationAndPixels() async throws {
        let (context, prefs, _, transport, recovery) = fixture()
        transport.loseFirstResponse = true
        let coordinator = CaptureCoordinator(transport: transport, selector: FixtureSelector(), recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        await coordinator.startCapture()
        guard case .unknown(let oldID) = coordinator.presentation else { return XCTFail("Expected held old-owner image") }
        XCTAssertTrue(coordinator.hasLocalImage(intentID: oldID))
        let otherOwner = CaptureContext(origin: context.origin, ownerScope: "owner-two", loginBinding: "login-two",
                                        expiresAt: context.expiresAt, processing: context.processing)
        XCTAssertTrue(coordinator.rebindOwner(to: otherOwner))
        XCTAssertEqual(coordinator.presentation, .idle)
        XCTAssertFalse(coordinator.hasLocalImage(intentID: oldID))
        XCTAssertEqual(coordinator.boundOwnerScope, otherOwner.ownerScope)
        XCTAssertEqual(recovery.saved.count, 1, "Old-owner encrypted recovery stays out of the new owner's UI")
    }

    @MainActor
    func testLateOldOwnerContextCannotRebindOrOpenSelection() async throws {
        let (old, prefs, selector, transport, recovery) = fixture()
        transport.suspendNextContext = true
        let coordinator = CaptureCoordinator(transport: transport, selector: selector, recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        let capture = Task { await coordinator.startCapture() }
        for _ in 0..<100 where transport.pendingContext == nil { await Task.yield() }
        XCTAssertNotNil(transport.pendingContext)
        let next = CaptureContext(origin: old.origin, ownerScope: "owner-two", loginBinding: "login-two",
                                  expiresAt: old.expiresAt, processing: old.processing)
        coordinator.rebindOwner(to: next)
        transport.pendingContext?.resume(returning: old)
        transport.pendingContext = nil
        await capture.value
        XCTAssertEqual(coordinator.boundOwnerScope, next.ownerScope)
        XCTAssertEqual(selector.calls, 0)
        XCTAssertTrue(recovery.saved.isEmpty)
    }

    @MainActor
    func testOwnerSwitchWhileSelectingCannotStageOldOwnerPixels() async throws {
        let (old, prefs, selector, transport, recovery) = fixture()
        selector.suspendNextSelection = true
        let coordinator = CaptureCoordinator(transport: transport, selector: selector, recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        let capture = Task { await coordinator.startCapture() }
        for _ in 0..<100 where selector.pendingSelection == nil { await Task.yield() }
        XCTAssertNotNil(selector.pendingSelection)
        let next = CaptureContext(origin: old.origin, ownerScope: "owner-two", loginBinding: "login-two",
                                  expiresAt: old.expiresAt, processing: old.processing)
        coordinator.rebindOwner(to: next)
        selector.pendingSelection?.resume(returning: .init(image: selector.image,
                                                            capturedAt: Date(timeIntervalSince1970: 1_800_000_000), preview: false))
        selector.pendingSelection = nil
        await capture.value
        XCTAssertEqual(coordinator.boundOwnerScope, next.ownerScope)
        XCTAssertEqual(coordinator.presentation, .idle)
        XCTAssertTrue(recovery.saved.isEmpty)
        XCTAssertEqual(transport.submissions, 0)
    }

    @MainActor
    func testOfflineRestoreCannotLoadOldAcknowledgedOwnerAfterRebinding() async throws {
        let (old, prefs, _, transport, recovery) = fixture()
        let intent = try CaptureIntent(imagePNG: Data([1, 2, 3]), context: old,
                                       capturedAt: Date(timeIntervalSince1970: 1_800_000_000))
        try recovery.save(intent)
        let coordinator = CaptureCoordinator(transport: transport, selector: FixtureSelector(), recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        let next = CaptureContext(origin: old.origin, ownerScope: "owner-two", loginBinding: "login-two",
                                  expiresAt: old.expiresAt, processing: old.processing)
        coordinator.rebindOwner(to: next)
        transport.contextError = CaptureTransportError.unavailable
        await coordinator.restoreRecovery()
        XCTAssertEqual(coordinator.boundOwnerScope, next.ownerScope)
        XCTAssertEqual(coordinator.presentation, .idle)
        XCTAssertNil(coordinator.nextLocalExpiry)
        XCTAssertEqual(recovery.saved.count, 1, "The old encrypted image remains outside the new owner's menu")
    }

    @MainActor
    func testLateRecoveryContextCannotRestorePriorOwnerAfterAccountSwitch() async throws {
        let (old, prefs, _, transport, recovery) = fixture()
        let intent = try CaptureIntent(imagePNG: Data([1, 2, 3]), context: old,
                                       capturedAt: Date(timeIntervalSince1970: 1_800_000_000))
        try recovery.save(intent)
        transport.suspendNextContext = true
        let coordinator = CaptureCoordinator(transport: transport, selector: FixtureSelector(), recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        let restore = Task { await coordinator.restoreRecovery() }
        for _ in 0..<100 where transport.pendingContext == nil { await Task.yield() }
        XCTAssertNotNil(transport.pendingContext)
        let next = CaptureContext(origin: old.origin, ownerScope: "owner-two", loginBinding: "login-two",
                                  expiresAt: old.expiresAt, processing: old.processing)
        coordinator.rebindOwner(to: next)
        transport.pendingContext?.resume(returning: old)
        transport.pendingContext = nil
        await restore.value
        XCTAssertEqual(coordinator.boundOwnerScope, next.ownerScope)
        XCTAssertEqual(coordinator.presentation, .idle)
        XCTAssertFalse(coordinator.hasLocalImage(intentID: intent.id))
    }

    @MainActor
    func testLateRecoveryContextCannotUndoSignOut() async throws {
        let (old, prefs, _, transport, recovery) = fixture()
        transport.suspendNextContext = true
        let coordinator = CaptureCoordinator(transport: transport, selector: FixtureSelector(), recovery: recovery,
                                             preferences: prefs, now: { Date(timeIntervalSince1970: 1_800_000_000) })
        let restore = Task { await coordinator.restoreRecovery() }
        for _ in 0..<100 where transport.pendingContext == nil { await Task.yield() }
        XCTAssertNotNil(transport.pendingContext)
        coordinator.rebindOwner(to: nil)
        transport.pendingContext?.resume(returning: old)
        transport.pendingContext = nil
        await restore.value
        XCTAssertNil(coordinator.boundOwnerScope)
        XCTAssertEqual(coordinator.presentation, .needsSignIn)
    }
}
