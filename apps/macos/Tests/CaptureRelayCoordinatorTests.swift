import AppKit
import Combine
import CoreGraphics
import Foundation
import SwiftUI
import XCTest
@testable import TalentSignalMac

private final class RelayMemoryPreferences: CapturePreferenceStore {
    var values: [String: Any] = [:]
    func object(forKey key: String) -> Any? { values[key] }
    func set(_ value: Any?, forKey key: String) { values[key] = value }
    func removeObject(forKey key: String) { values.removeValue(forKey: key) }
}

private final class RelayMemoryRecovery: CaptureRecoveryPersisting {
    var intents: [UUID: CaptureIntent] = [:]
    func save(_ intent: CaptureIntent) throws { intents[intent.id] = intent }
    func load(origin: String, ownerScope: String, now: Date) throws -> [CaptureIntent] { [] }
    func remove(_ intent: CaptureIntent) throws { intents.removeValue(forKey: intent.id) }
}

@MainActor private final class RelaySelector: CaptureSelecting {
    let image: CGImage
    var preview = false
    var selections = 0
    init() {
        image = CGContext(data: nil, width: 640, height: 480, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!.makeImage()!
    }
    func select() async throws -> CaptureSelectionResult {
        selections += 1
        return .init(image: image, capturedAt: Date(timeIntervalSince1970: 1_800_000_000), preview: preview)
    }
    func cancel() {}
}

@MainActor private final class RelayTransport: CaptureTransporting {
    var current: CaptureContext
    var admissions = 0
    var suspendAdmission = false
    var pendingAdmission: CheckedContinuation<Void, Never>?
    var resultReads = 0
    var receiptReads = 0
    var suspendReceipt = false
    var pendingReceipt: CheckedContinuation<CaptureReceipt?, Error>?
    var canonical: CaptureReceipt?
    var lastIntent: CaptureIntent?
    var resultError: Error?
    var suspendResult = false
    var pendingResult: CheckedContinuation<CaptureResult?, Error>?
    var noClues = false
    init(context: CaptureContext) { current = context }
    func context() async throws -> CaptureContext { current }
    func admit(_ intent: CaptureIntent, context: CaptureContext) async throws -> CaptureAdmission {
        admissions += 1; lastIntent = intent.withoutRawImage()
        if suspendAdmission { await withCheckedContinuation { pendingAdmission = $0 } }
        canonical = .init(sessionId: intent.sessionId, messageId: intent.messageId, queueEntryId: UUID(), status: "queued",
            imageManifest: [.init(attachmentId: intent.attachmentId, byteSize: intent.imageByteSize, contentHash: intent.contentHash)], resultRecorded: false)
        return .init(sessionId: intent.sessionId, messageId: intent.messageId, queueEntryId: canonical!.queueEntryId, status: "queued")
    }
    func receipt(for intent: CaptureIntent, context: CaptureContext) async throws -> CaptureReceipt? {
        receiptReads += 1
        if suspendReceipt { return try await withCheckedThrowingContinuation { pendingReceipt = $0 } }
        return canonical
    }
    func complete() {
        let old = canonical!
        canonical = .init(sessionId: old.sessionId, messageId: old.messageId, queueEntryId: old.queueEntryId, status: "completed",
            imageManifest: old.imageManifest, resultRecorded: true)
    }
    func makeResult(_ intent: CaptureIntent) -> CaptureResult {
        .init(sessionId: intent.sessionId, messageId: intent.messageId, queueEntryId: canonical!.queueEntryId,
            resultVersion: String(repeating: "a", count: 64), source: canonical!.imageManifest[0],
            observation: noClues ? nil : .init(artifactId: "conversation-image-\(intent.messageId.uuidString.lowercased())-0-\(intent.attachmentId.uuidString.lowercased())",
                contentHash: intent.contentHash, model: "synthetic-existing-inspector", inspectionRequestId: "same-run-receipt",
                conversationKind: .unknown, pending: true,
                clues: [.init(kind: .company, text: "松禾设计", sourceExcerpt: "松禾设计")], sourceWarning: nil),
            observedAt: "2026-10-18T00:00:00Z")
    }
    func result(for intent: CaptureIntent, context: CaptureContext) async throws -> CaptureResult? {
        resultReads += 1
        if let resultError { throw resultError }
        if suspendResult { return try await withCheckedThrowingContinuation { pendingResult = $0 } }
        return makeResult(intent)
    }
}

final class CaptureRelayCoordinatorTests: XCTestCase {
    @MainActor private func fixture() -> (CaptureCoordinator, RelayTransport, RelaySelector, RelayMemoryRecovery) {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let context = CaptureContext(origin: "https://workspace.example", ownerScope: "owner-one", loginBinding: "login-one",
            expiresAt: now.addingTimeInterval(3600), processing: .init(policyVersion: "policy", workspaceLabel: "Workspace",
                processorLabels: ["Existing Inspector"], sourceRetentionDays: 30, available: true))
        let preferences = CapturePreferences(store: RelayMemoryPreferences())
        preferences.acknowledgeProcessingScope(origin: context.origin, ownerScope: context.ownerScope,
            policyVersion: context.processing.policyVersion, at: now)
        let transport = RelayTransport(context: context), selector = RelaySelector(), recovery = RelayMemoryRecovery()
        return (CaptureCoordinator(transport: transport, selector: selector, recovery: recovery, preferences: preferences, now: { now }),
                transport, selector, recovery)
    }

    @MainActor func testAdmissionReleasesOriginalAndOnlyRetainsABoundedExpiringThumbnail() async throws {
        let (coordinator, transport, _, recovery) = fixture()
        await coordinator.startCapture()
        let relay = try XCTUnwrap(coordinator.relay), image = try XCTUnwrap(relay.thumbnail)
        XCTAssertEqual(transport.admissions, 1)
        XCTAssertTrue(recovery.intents.isEmpty)
        XCTAssertEqual(max(image.width, image.height), 320)
        XCTAssertEqual(relay.phase, .processing)
        XCTAssertEqual(coordinator.nextLocalExpiry, Date(timeIntervalSince1970: 1_800_000_300))
        coordinator.expireLocalImages(at: Date(timeIntervalSince1970: 1_800_000_300))
        XCTAssertNil(coordinator.relay)
        XCTAssertEqual(transport.admissions, 1)
    }

    @MainActor func testRealResultReadbackAndSourceWithdrawalNeverResubmitOrLeaveCachedClues() async throws {
        let (coordinator, transport, _, _) = fixture()
        await coordinator.startCapture(); transport.complete()
        await coordinator.refreshCurrentStatus()
        XCTAssertEqual(coordinator.relay?.phase, .ready)
        XCTAssertEqual(coordinator.relay?.result?.observation?.clues.first?.text, "松禾设计")
        transport.resultError = CaptureTransportError.server(410, "DESKTOP_CAPTURE_SOURCE_GONE")
        await coordinator.refreshRelayResult()
        XCTAssertNil(coordinator.relay)
        XCTAssertEqual(transport.admissions, 1)
        XCTAssertEqual(transport.resultReads, 2)
    }

    @MainActor func testOwnerChangeWhileResultIsInFlightCannotResurrectPixelsOrClues() async throws {
        let (coordinator, transport, _, _) = fixture()
        await coordinator.startCapture(); transport.complete(); transport.suspendResult = true
        let late = transport.makeResult(try XCTUnwrap(transport.lastIntent))
        let refresh = Task { await coordinator.refreshCurrentStatus() }
        for _ in 0..<100 where transport.pendingResult == nil { await Task.yield() }
        XCTAssertNotNil(transport.pendingResult)
        let old = transport.current
        coordinator.rebindOwner(to: .init(origin: old.origin, ownerScope: "owner-two", loginBinding: "login-two",
            expiresAt: old.expiresAt, processing: old.processing))
        transport.pendingResult?.resume(returning: late); transport.pendingResult = nil
        await refresh.value
        XCTAssertNil(coordinator.relay)
        XCTAssertEqual(coordinator.presentation, .idle)
        XCTAssertEqual(coordinator.boundOwnerScope, "owner-two")
    }

    @MainActor func testCollapsingPresentationDoesNotStopOrResubmitTheCanonicalTask() async {
        let (coordinator, transport, _, _) = fixture()
        await coordinator.startCapture(); coordinator.dismissRelay()
        transport.complete(); await coordinator.refreshCurrentStatus()
        XCTAssertNil(coordinator.relay)
        XCTAssertEqual(transport.admissions, 1)
        XCTAssertEqual(transport.resultReads, 0)
        guard case .viewable = coordinator.presentation else { return XCTFail("Real task still completes after visual dismissal") }
    }

    @MainActor func testPreviewStaysLocalAndSendsOnlyTheEditedImageAndInstruction() async throws {
        let (coordinator, transport, selector, _) = fixture(); selector.preview = true
        await coordinator.startCapture()
        XCTAssertEqual(transport.admissions, 0); XCTAssertNil(coordinator.relay)
        let edited = try XCTUnwrap(CaptureSelectedImage.copyRegion(selector.image, pixels: CGRect(x: 0, y: 0, width: 16, height: 8)))
        await coordinator.submitPreview(edited, objective: "核对公司文字")
        XCTAssertEqual(transport.admissions, 1)
        XCTAssertEqual(transport.lastIntent?.objective, "核对公司文字")
        XCTAssertEqual(coordinator.relay?.thumbnail?.width, 16)
        XCTAssertNil(coordinator.relay?.origin, "Edited preview has no invented region origin")
    }

    @MainActor func testPreviewSendThroughSynchronousWindowObserverPreservesAdmissionAndRelay() async throws {
        _ = NSApplication.shared
        let (coordinator, transport, selector, _) = fixture(); selector.preview = true
        let previewWindow = CapturePreviewWindowController()
        // Match the production Runtime observer, including synchronous willSet delivery.
        let observer = coordinator.$presentation.sink { state in
            if case .previewReady = state { previewWindow.show(coordinator: coordinator) }
            else { previewWindow.dismiss() }
        }
        defer { observer.cancel(); previewWindow.dismiss() }
        await coordinator.startCapture()
        XCTAssertNotNil(coordinator.previewImage)
        await coordinator.submitPreview(selector.image, objective: "核对公司文字")
        XCTAssertEqual(transport.admissions, 1)
        guard case .processing = coordinator.presentation else { return XCTFail("The admitted screenshot must keep processing") }
        XCTAssertEqual(coordinator.relay?.phase, .processing)
        XCTAssertNil(coordinator.previewImage)
    }

    @MainActor func testClosingActualPreviewWindowDiscardsOnlyItsLocalDraftWithoutReentrancy() async throws {
        _ = NSApplication.shared
        let existingWindows = Set(NSApp.windows.map(ObjectIdentifier.init))
        let (coordinator, transport, selector, _) = fixture(); selector.preview = true
        let previewWindow = CapturePreviewWindowController()
        let observer = coordinator.$presentation.sink { state in
            if case .previewReady = state { previewWindow.show(coordinator: coordinator) }
            else { previewWindow.dismiss() }
        }
        defer { observer.cancel(); previewWindow.dismiss() }
        await coordinator.startCapture()
        let window = try XCTUnwrap(NSApp.windows.first {
            !existingWindows.contains(ObjectIdentifier($0)) && $0.title == "capri · 截图预览"
        })
        window.close()
        XCTAssertEqual(coordinator.presentation, .idle)
        XCTAssertNil(coordinator.previewImage)
        XCTAssertNil(coordinator.relay)
        XCTAssertEqual(transport.admissions, 0)
        XCTAssertFalse(window.isVisible)
    }

    @MainActor func testSecondShortcutCannotReplacePreviewWhileItsAdmissionIsUnresolved() async throws {
        let (coordinator, transport, selector, _) = fixture(); selector.preview = true
        await coordinator.startCapture()
        transport.suspendAdmission = true
        let send = Task { await coordinator.submitPreview(selector.image, objective: "只分析截图，不保存") }
        for _ in 0..<100 where transport.pendingAdmission == nil { await Task.yield() }
        XCTAssertNotNil(transport.pendingAdmission)
        await coordinator.startCapture()
        let selectionsDuringAdmission = selector.selections
        let previewDuringAdmission = coordinator.previewImage
        transport.pendingAdmission?.resume(); transport.pendingAdmission = nil
        await send.value
        XCTAssertEqual(selectionsDuringAdmission, 1, "An unresolved preview send still owns the capture gesture")
        XCTAssertNil(previewDuringAdmission, "A second local draft cannot replace the submitted preview")
        XCTAssertEqual(transport.admissions, 1)
        XCTAssertEqual(coordinator.relay?.phase, .processing)
        guard case .processing = coordinator.presentation else { return XCTFail("Keep the original admitted screenshot") }
        await coordinator.startCapture()
        XCTAssertEqual(selector.selections, 2, "Verified admission releases the gesture for the next capture")
        XCTAssertNotNil(coordinator.previewImage)
    }

    @MainActor func testOlderReceiptCompletesItsIntentWithoutClosingANewerLocalPreview() async throws {
        _ = NSApplication.shared
        let (coordinator, transport, selector, _) = fixture()
        let previewWindow = CapturePreviewWindowController()
        let observer = coordinator.$presentation.sink { state in
            if case .previewReady = state { previewWindow.show(coordinator: coordinator) }
            else { previewWindow.dismiss() }
        }
        defer { observer.cancel(); previewWindow.dismiss() }
        await coordinator.startCapture()
        let first = try XCTUnwrap(transport.lastIntent)
        transport.suspendReceipt = true
        let refresh = Task { await coordinator.refreshCurrentStatus() }
        for _ in 0..<100 where transport.pendingReceipt == nil { await Task.yield() }
        XCTAssertNotNil(transport.pendingReceipt)
        selector.preview = true
        await coordinator.startCapture()
        XCTAssertNotNil(coordinator.previewImage)
        XCTAssertEqual(coordinator.presentation, .previewReady)
        transport.complete()
        transport.pendingReceipt?.resume(returning: transport.canonical); transport.pendingReceipt = nil
        await refresh.value
        XCTAssertEqual(coordinator.presentation, .previewReady, "Old canonical completion does not own the newer preview")
        XCTAssertNotNil(coordinator.previewImage)
        XCTAssertEqual(transport.admissions, 1)
        let reads = transport.receiptReads
        await coordinator.retry(intentID: first.id)
        XCTAssertEqual(transport.receiptReads, reads, "The completed older intent must still be retired")
        XCTAssertEqual(coordinator.presentation, .previewReady)
    }

    @MainActor func testOldPreviewCloseCallbackCannotDismissAReboundWorkspaceDraft() async throws {
        _ = NSApplication.shared
        let existingWindows = Set(NSApp.windows.map(ObjectIdentifier.init))
        let (first, _, firstSelector, _) = fixture(); firstSelector.preview = true
        let (second, secondTransport, secondSelector, _) = fixture(); secondSelector.preview = true
        await first.startCapture(); await second.startCapture()
        let previewWindow = CapturePreviewWindowController()
        defer { previewWindow.dismiss() }
        previewWindow.show(coordinator: first)
        let firstWindow = try XCTUnwrap(NSApp.windows.first {
            !existingWindows.contains(ObjectIdentifier($0)) && $0.title == "capri · 截图预览"
        })
        let oldRoot = try XCTUnwrap(firstWindow.contentViewController as? NSHostingController<CapturePreviewView>).rootView
        previewWindow.show(coordinator: second)
        XCTAssertNil(first.previewImage)
        XCTAssertNotNil(second.previewImage)
        oldRoot.close()
        XCTAssertNotNil(second.previewImage, "A completed old Send callback does not own the new window")
        XCTAssertEqual(second.presentation, .previewReady)
        XCTAssertEqual(secondTransport.admissions, 0)
    }

    @MainActor func testUnresolvedExplicitRetryKeepsTheCaptureGestureUntilItsReceiptReturns() async throws {
        let (coordinator, transport, selector, _) = fixture()
        await coordinator.startCapture()
        let first = try XCTUnwrap(transport.lastIntent)
        transport.suspendReceipt = true
        let retry = Task { await coordinator.retry(intentID: first.id) }
        for _ in 0..<100 where transport.pendingReceipt == nil { await Task.yield() }
        XCTAssertNotNil(transport.pendingReceipt)
        selector.preview = true
        await coordinator.startCapture()
        let selectionsDuringRetry = selector.selections
        let previewDuringRetry = coordinator.previewImage
        transport.suspendReceipt = false
        transport.pendingReceipt?.resume(returning: transport.canonical); transport.pendingReceipt = nil
        await retry.value
        XCTAssertEqual(selectionsDuringRetry, 1, "Explicit retry still owns its unresolved operation")
        XCTAssertNil(previewDuringRetry)
        XCTAssertEqual(transport.admissions, 1, "Receipt reconciliation must not create a duplicate admission")
        guard case .processing = coordinator.presentation else { return XCTFail("Keep the retried admitted screenshot") }
        await coordinator.startCapture()
        XCTAssertEqual(selector.selections, 2)
        XCTAssertNotNil(coordinator.previewImage)
        let reads = transport.receiptReads
        await coordinator.retry(intentID: first.id)
        XCTAssertEqual(transport.receiptReads, reads, "A pending preview cannot be silently replaced by another retry")
        XCTAssertNotNil(coordinator.previewImage)
        XCTAssertEqual(coordinator.presentation, .previewReady)
    }

    @MainActor func testOlderReceiptCannotReplaceANewerProcessingDisclosure() async throws {
        let (coordinator, transport, _, _) = fixture()
        await coordinator.startCapture()
        transport.suspendReceipt = true
        let refresh = Task { await coordinator.refreshCurrentStatus() }
        for _ in 0..<100 where transport.pendingReceipt == nil { await Task.yield() }
        XCTAssertNotNil(transport.pendingReceipt)
        coordinator.preferences.revokeProcessingScopeAcknowledgement()
        await coordinator.startCapture()
        guard case .needsDisclosure = coordinator.presentation else { return XCTFail("The new gesture requires disclosure") }
        transport.complete()
        transport.pendingReceipt?.resume(returning: transport.canonical); transport.pendingReceipt = nil
        await refresh.value
        guard case .needsDisclosure = coordinator.presentation else { return XCTFail("Older completion cannot replace the new disclosure") }
        XCTAssertEqual(transport.admissions, 1)
    }

    @MainActor func testLegacyProducerHasAnHonestNoClueResultAndLoginChangeClearsIt() async {
        let (coordinator, transport, _, _) = fixture(); transport.noClues = true
        await coordinator.startCapture(); transport.complete(); await coordinator.refreshCurrentStatus()
        XCTAssertNotNil(coordinator.relay?.result); XCTAssertNil(coordinator.relay?.result?.observation)
        let old = transport.current
        coordinator.rebindOwner(to: .init(origin: old.origin, ownerScope: old.ownerScope, loginBinding: "login-new",
            expiresAt: old.expiresAt, processing: old.processing))
        XCTAssertNil(coordinator.relay)
    }
}
