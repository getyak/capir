import AppKit
import Combine
import Foundation

enum CapturePresentation: Equatable {
    case idle
    case needsSignIn
    case needsDisclosure(CaptureContext)
    case selecting
    case previewReady
    case uploading(UUID)
    case processing(UUID)
    case viewable(UUID)
    case unknown(UUID)
    case failed(UUID?, String)
    case deletionFailed(UUID)
}

/** Owns one user-initiated capture and hands its immutable message to the durable queue. */
@MainActor
final class CaptureCoordinator: ObservableObject {
    @Published private(set) var presentation: CapturePresentation = .idle
    private let transport: CaptureTransporting
    private let selector: CaptureSelecting
    private let recovery: CaptureRecoveryPersisting
    let preferences: CapturePreferences
    private let now: () -> Date
    private var pendingPreview: (image: CGImage, context: CaptureContext, capturedAt: Date)?
    private var intents: [UUID: CaptureIntent] = [:]
    private var intentGenerations: [UUID: Int] = [:]
    private var progressPoll: Task<Void, Never>?
    private var lastVerifiedContext: CaptureContext?
    private var captureInFlight = false

    init(transport: CaptureTransporting, selector: CaptureSelecting, recovery: CaptureRecoveryPersisting,
         preferences: CapturePreferences, now: @escaping () -> Date = Date.init) {
        self.transport = transport
        self.selector = selector
        self.recovery = recovery
        self.preferences = preferences
        self.now = now
    }

    deinit { progressPoll?.cancel() }

    func startCapture(prepareToSelect: () -> Void = {}) async {
        guard !captureInFlight, pendingPreview == nil else { return }
        // Reserve the gesture before fetching context. Two shortcut/menu events
        // must never enter the screen selector while either awaits that fetch.
        captureInFlight = true
        defer { captureInFlight = false }
        do {
            let context = try await transport.context()
            lastVerifiedContext = context
            guard context.processing.available else {
                presentation = .failed(nil, "当前工作区尚未启用图片处理。")
                return
            }
            if !preferences.hasAcknowledgedProcessingScope(origin: context.origin, ownerScope: context.ownerScope,
                                                            policyVersion: context.processing.policyVersion) {
                presentation = .needsDisclosure(context)
                return
            }
            prepareToSelect()
            await Task.yield()
            await select(context: context)
        } catch CaptureTransportError.server(401, _) {
            presentation = .needsSignIn
        } catch {
            if let prior = lastVerifiedContext,
               WorkspaceConnection.shared.origin?.url.absoluteString == prior.origin,
               preferences.hasAcknowledgedProcessingScope(origin: prior.origin, ownerScope: prior.ownerScope,
                                                           policyVersion: prior.processing.policyVersion) {
                // Capture can be staged under the last verified in-process
                // identity, but no upload can start until a fresh readback.
                prepareToSelect()
                await Task.yield()
                await select(context: prior)
            } else {
                presentation = .failed(nil, "暂时无法确认工作区，请重试。")
            }
        }
    }

    func acknowledgeAndCapture(prepareToSelect: () -> Void = {}) async {
        guard !captureInFlight, case .needsDisclosure(let context) = presentation else { return }
        captureInFlight = true
        defer { captureInFlight = false }
        preferences.acknowledgeProcessingScope(origin: context.origin, ownerScope: context.ownerScope,
                                               policyVersion: context.processing.policyVersion, at: now())
        prepareToSelect()
        await Task.yield()
        await select(context: context)
    }

    private func select(context: CaptureContext) async {
        presentation = .selecting
        do {
            let selected = try await selector.select()
            if selected.preview || preferences.afterSelection == .preview {
                pendingPreview = (selected.image, context, selected.capturedAt)
                presentation = .previewReady
            } else {
                await stageAndAdmit(selected.image, context: context, capturedAt: selected.capturedAt)
            }
        } catch CaptureSelectionError.cancelled {
            presentation = .idle
        } catch {
            presentation = .failed(nil, (error as? LocalizedError)?.errorDescription ?? "截图未完成，请重试。")
        }
    }

    func submitPreview(_ image: CGImage) async {
        guard let preview = pendingPreview else { return }
        pendingPreview = nil
        await stageAndAdmit(image, context: preview.context, capturedAt: preview.capturedAt)
    }

    func discardPreview() {
        pendingPreview = nil
        presentation = .idle
    }

    var previewImage: CGImage? { pendingPreview?.image }

    private func stageAndAdmit(_ image: CGImage, context: CaptureContext, capturedAt: Date) async {
        do {
            let encoded = try CaptureImageEncoder.encodePNG(image)
            var intent = try CaptureIntent(imagePNG: encoded.data, context: context, capturedAt: capturedAt)
            // Stage under the identity reviewed at capture start even when the
            // five-minute context expires during a long selection. Transport
            // rereads the current owner and policy before any upload.
            try recovery.save(intent)
            intents[intent.id] = intent
            intentGenerations[intent.id] = 0
            intent.phase = .uploading
            try recovery.save(intent)
            intents[intent.id] = intent
            presentation = .uploading(intent.id)
            await submit(intent, context: context, generation: intentGenerations[intent.id] ?? 0)
        } catch CaptureIntentError.imageTooLarge {
            presentation = .failed(nil, "截图超过 10 MB，请缩小选区再试。")
        } catch {
            presentation = .failed(nil, "截图暂存失败，尚未上传。")
        }
    }

    private func intentIsCurrent(_ id: UUID, generation: Int) -> Bool {
        guard intents[id] != nil, intentGenerations[id] == generation else { return false }
        if case .deletionFailed(let deleting) = presentation, deleting == id { return false }
        return true
    }

    private func submit(_ intent: CaptureIntent, context: CaptureContext, generation: Int) async {
        guard intentIsCurrent(intent.id, generation: generation) else { return }
        do {
            let admitted = try await transport.admit(intent, context: context)
            guard intentIsCurrent(intent.id, generation: generation) else { return }
            guard admitted.sessionId == intent.sessionId, admitted.messageId == intent.messageId else {
                throw CaptureTransportError.malformedResponse
            }
            await reconcile(intent, context: context, generation: generation)
        } catch CaptureTransportError.server(let status, _) where status >= 400 && status < 500 && status != 408 {
            if intentIsCurrent(intent.id, generation: generation) {
                presentation = .failed(intent.id, "工作区拒绝了这次截图，请检查账户和处理设置。")
            }
        } catch {
            guard intentIsCurrent(intent.id, generation: generation) else { return }
            if var stored = intents[intent.id] {
                stored.phase = .unknown
                try? recovery.save(stored)
                intents[intent.id] = stored
            }
            presentation = .unknown(intent.id)
        }
    }

    private func reconcile(_ intent: CaptureIntent, context: CaptureContext, generation: Int) async {
        guard intentIsCurrent(intent.id, generation: generation) else { return }
        do {
            let currentReceipt = try await transport.receipt(for: intent, context: context)
            guard intentIsCurrent(intent.id, generation: generation) else { return }
            guard let receipt = currentReceipt else {
                presentation = .unknown(intent.id)
                return
            }
            guard receipt.sessionId == intent.sessionId, receipt.messageId == intent.messageId,
                  receipt.imageManifest.count == 1,
                  receipt.imageManifest[0].attachmentId == intent.attachmentId,
                  receipt.imageManifest[0].contentHash == intent.contentHash,
                  receipt.imageManifest[0].byteSize == intent.imageByteSize else {
                throw CaptureTransportError.malformedResponse
            }
            try recovery.remove(intent)
            if receipt.resultRecorded {
                progressPoll?.cancel(); progressPoll = nil
                intents.removeValue(forKey: intent.id)
                intentGenerations.removeValue(forKey: intent.id)
                presentation = .viewable(intent.sessionId)
            } else if receipt.status == "failed" || receipt.status == "interrupted" || receipt.status == "cancelled" {
                progressPoll?.cancel(); progressPoll = nil
                var failed = intent
                failed.phase = .failed
                intents[intent.id] = failed
                presentation = .failed(intent.id, "Agent 未完成处理，可打开原会话查看或重试。")
            } else {
                // The backend owns execution independently of this window.
                intents[intent.id] = intent
                presentation = .processing(intent.sessionId)
                startProgressPollIfNeeded()
            }
        } catch {
            if intentIsCurrent(intent.id, generation: generation) { presentation = .unknown(intent.id) }
        }
    }

    func refreshCurrentStatus() async {
        guard case .processing(let sessionID) = presentation,
              let intent = intents.values.first(where: { $0.sessionId == sessionID }) else { return }
        let generation = intentGenerations[intent.id] ?? 0
        do {
            let current = try await transport.context()
            guard intentIsCurrent(intent.id, generation: generation) else { return }
            guard intent.canReadback(context: current, now: now()) else {
                presentation = .failed(intent.id, "工作区或处理方式已改变，请重新打开会话。")
                return
            }
            await reconcile(intent, context: current, generation: generation)
        } catch {
            if intentIsCurrent(intent.id, generation: generation) { presentation = .unknown(intent.id) }
        }
    }

    private func startProgressPollIfNeeded() {
        guard transport is CaptureWebSession, progressPoll == nil else { return }
        progressPoll = Task { [weak self] in
            for _ in 0..<60 {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled, let self else { return }
                guard case .processing = self.presentation else { break }
                await self.refreshCurrentStatus()
            }
            self?.progressPoll = nil
        }
    }

    func retry(intentID: UUID) async {
        if case .deletionFailed(let pending) = presentation, pending == intentID { return }
        guard let intent = intents[intentID] else { return }
        let generation = intentGenerations[intentID] ?? 0
        presentation = .uploading(intentID)
        do {
            let current = try await transport.context()
            guard intentIsCurrent(intentID, generation: generation) else { return }
            guard intent.canReadback(context: current, now: now()) else {
                presentation = .failed(intentID, "工作区或处理方式已改变，请查看后重新截图。")
                return
            }
            let checked = try await transport.receipt(for: intent, context: current)
            guard intentIsCurrent(intentID, generation: generation) else { return }
            if let receipt = checked {
                guard receipt.messageId == intent.messageId else { throw CaptureTransportError.malformedResponse }
                await reconcile(intent, context: current, generation: generation)
            } else {
                guard intent.canExplicitlyReplay(context: current, now: now()) else {
                    presentation = .failed(intentID, "工作区或处理方式已改变，请重新截图。")
                    return
                }
                var replay = intent
                if !intent.canSubmit(context: current, now: now()) {
                    // This is the user's explicit retry after a definitive
                    // absence readback. Preserve every image/message ID and
                    // pin only the newly authorized login before upload.
                    replay.authorizedReplayLoginBinding = current.loginBinding
                    try recovery.save(replay)
                    intents[intentID] = replay
                }
                presentation = .uploading(intentID)
                guard intentIsCurrent(intentID, generation: generation) else { return }
                await submit(replay, context: current, generation: generation)
            }
        } catch {
            if intentIsCurrent(intentID, generation: generation) { presentation = .unknown(intentID) }
        }
    }

    func restoreRecovery() async {
        do {
            let context = try await transport.context()
            lastVerifiedContext = context
            let restored = try recovery.load(origin: context.origin, ownerScope: context.ownerScope, now: now())
            for intent in restored { intents[intent.id] = intent }
            for intent in restored { intentGenerations[intent.id] = 0 }
            if let recent = restored.last { presentation = .unknown(recent.id) }
        } catch {
            // Offline readback cannot establish the current login. Recover only
            // under the user's previously acknowledged origin/owner and keep
            // it explicitly unsent until authenticated context is fresh.
            guard let prior = preferences.onboardingAcknowledgement,
                  prior.origin == WorkspaceConnection.shared.origin?.url.absoluteString,
                  let restored = try? recovery.load(origin: prior.origin, ownerScope: prior.ownerScope, now: now())
            else { return }
            for intent in restored { intents[intent.id] = intent }
            for intent in restored { intentGenerations[intent.id] = 0 }
            if let recent = restored.last { presentation = .unknown(recent.id) }
        }
    }

    func discardLocal(intentID: UUID) {
        guard let intent = intents[intentID] else { return }
        intentGenerations[intentID, default: 0] += 1
        do {
            try recovery.remove(intent)
            intents.removeValue(forKey: intentID)
            intentGenerations.removeValue(forKey: intentID)
            presentation = .idle
        }
        catch { presentation = .deletionFailed(intentID) }
    }

    func failedSession(intentID: UUID) -> UUID? {
        guard let intent = intents[intentID], intent.phase == .failed else { return nil }
        return intent.sessionId
    }

    func dismissHint() {
        if case .processing = presentation { return }
        if case .viewable = presentation { presentation = .idle }
    }
}
