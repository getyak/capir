import AppKit
import Foundation
import XCTest
@testable import TalentSignalMac

@MainActor
private final class FixtureSelector: CaptureSelecting {
    let image: CGImage
    var calls = 0
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
        return CaptureSelectionResult(image: image, capturedAt: Date(timeIntervalSince1970: 1_800_000_000), preview: false)
    }
    func cancel() {}
}

@MainActor
private final class FixtureTransport: CaptureTransporting {
    let current: CaptureContext
    var submissions = 0
    var loseFirstResponse = false
    var canonical: CaptureReceipt?
    var receiptReads = 0
    var suspendNextContext = false
    var pendingContext: CheckedContinuation<CaptureContext, Error>?
    init(current: CaptureContext) { self.current = current }
    func context() async throws -> CaptureContext {
        if suspendNextContext {
            suspendNextContext = false
            return try await withCheckedThrowingContinuation { pendingContext = $0 }
        }
        return current
    }
    func admit(_ intent: CaptureIntent, context: CaptureContext) async throws -> CaptureAdmission {
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
}
