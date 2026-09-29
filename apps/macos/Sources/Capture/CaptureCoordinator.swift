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
    private let onRecoveryChanged: (() -> Void)?
    private let onVerifiedContext: ((CaptureContext) -> Void)?
    private var pendingPreview: (image: CGImage, context: CaptureContext, capturedAt: Date)?
    private var intents: [UUID: CaptureIntent] = [:]
    private var intentGenerations: [UUID: Int] = [:]
    private var progressPoll: Task<Void, Never>?
    private var lastVerifiedContext: CaptureContext?
    private var captureInFlight = false
    private var captureGeneration = 0
    private var ownerRevision = 0
    private var explicitlySignedOut = false

    init(transport: CaptureTransporting, selector: CaptureSelecting, recovery: CaptureRecoveryPersisting,
         preferences: CapturePreferences, now: @escaping () -> Date = Date.init,
         onRecoveryChanged: (() -> Void)? = nil,
         onVerifiedContext: ((CaptureContext) -> Void)? = nil) {
        self.transport = transport
        self.selector = selector
        self.recovery = recovery
        self.preferences = preferences
        self.now = now
        self.onRecoveryChanged = onRecoveryChanged
        self.onVerifiedContext = onVerifiedContext
    }

    deinit { progressPoll?.cancel() }

    func startCapture(prepareToSelect: () -> Void = {}) async {
        guard !captureInFlight, pendingPreview == nil else { return }
        // Reserve the gesture before fetching context. Two shortcut/menu events
        // must never enter the screen selector while either awaits that fetch.
        captureInFlight = true
        defer { captureInFlight = false }
        var generation = captureGeneration
        do {
            let context = try await transport.context()
            guard generation == captureGeneration || boundOwnerScope == context.ownerScope else { return }
            rebindOwner(to: context)
            generation = captureGeneration
            onVerifiedContext?(context)
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
            guard generation == captureGeneration else { return }
            await select(context: context, generation: generation)
        } catch CaptureTransportError.server(401, _) {
            guard generation == captureGeneration else { return }
            rebindOwner(to: nil)
        } catch {
            guard generation == captureGeneration else { return }
            if let prior = lastVerifiedContext,
               WorkspaceConnection.shared.origin?.url.absoluteString == prior.origin,
               preferences.hasAcknowledgedProcessingScope(origin: prior.origin, ownerScope: prior.ownerScope,
                                                           policyVersion: prior.processing.policyVersion) {
                // Capture can be staged under the last verified in-process
                // identity, but no upload can start until a fresh readback.
                prepareToSelect()
                await Task.yield()
                guard generation == captureGeneration else { return }
                await select(context: prior, generation: generation)
            } else {
                presentation = .failed(nil, "暂时无法确认工作区，请重试。")
            }
        }
    }

    func acknowledgeAndCapture(prepareToSelect: () -> Void = {}) async {
        guard !captureInFlight, case .needsDisclosure(let context) = presentation else { return }
        captureInFlight = true
        defer { captureInFlight = false }
        let generation = captureGeneration
        preferences.acknowledgeProcessingScope(origin: context.origin, ownerScope: context.ownerScope,
                                               policyVersion: context.processing.policyVersion, at: now())
        prepareToSelect()
        await Task.yield()
        guard generation == captureGeneration else { return }
        await select(context: context, generation: generation)
    }

    private func select(context: CaptureContext, generation: Int) async {
        guard generation == captureGeneration, boundOwnerScope == context.ownerScope else { return }
        presentation = .selecting
        do {
            let selected = try await selector.select()
            guard generation == captureGeneration, boundOwnerScope == context.ownerScope else { return }
            if selected.preview || preferences.afterSelection == .preview {
                pendingPreview = (selected.image, context, selected.capturedAt)
                presentation = .previewReady
                onRecoveryChanged?()
            } else {
                await stageAndAdmit(selected.image, context: context, capturedAt: selected.capturedAt,
                                    generation: generation)
            }
        } catch CaptureSelectionError.cancelled {
            guard generation == captureGeneration else { return }
            presentation = .idle
        } catch {
            guard generation == captureGeneration else { return }
            presentation = .failed(nil, (error as? LocalizedError)?.errorDescription ?? "截图未完成，请重试。")
        }
    }

    func submitPreview(_ image: CGImage) async {
        guard let preview = pendingPreview else { return }
        let generation = captureGeneration
        pendingPreview = nil
        onRecoveryChanged?()
        await stageAndAdmit(image, context: preview.context, capturedAt: preview.capturedAt,
                            generation: generation)
    }

    func discardPreview() {
        pendingPreview = nil
        presentation = .idle
        onRecoveryChanged?()
    }

    var previewImage: CGImage? { pendingPreview?.image }
    var boundOwnerScope: String? {
        lastVerifiedContext?.ownerScope ?? pendingPreview?.context.ownerScope ?? intents.values.first?.ownerScope
    }
    var currentOwnerRevision: Int { ownerRevision }

    private func sameAuthorization(as context: CaptureContext) -> Bool {
        guard let current = lastVerifiedContext ?? pendingPreview?.context else { return false }
        return current.origin == context.origin && current.ownerScope == context.ownerScope &&
            current.loginBinding == context.loginBinding &&
            current.processing.policyVersion == context.processing.policyVersion
    }
    /// A same-origin sign-in can still change the owner. Release the prior
    /// owner's in-memory pixels and invalidate in-flight callbacks; encrypted
    /// files stay partitioned for later authorized recovery.
    @discardableResult
    func rebindOwner(to context: CaptureContext?) -> Bool {
        let previous = boundOwnerScope
        guard previous != context?.ownerScope else {
            if let context {
                if !sameAuthorization(as: context) { ownerRevision += 1 }
            } else {
                ownerRevision += 1
            }
            lastVerifiedContext = context
            explicitlySignedOut = context == nil
            if context == nil {
                captureGeneration += 1
                selector.cancel()
                presentation = .needsSignIn
            }
            return false
        }
        captureGeneration += 1
        ownerRevision += 1
        selector.cancel()
        for id in intents.keys { intentGenerations[id, default: 0] += 1 }
        intents.removeAll()
        intentGenerations.removeAll()
        pendingPreview = nil
        progressPoll?.cancel(); progressPoll = nil
        lastVerifiedContext = context
        explicitlySignedOut = context == nil
        presentation = context == nil ? .needsSignIn : .idle
        onRecoveryChanged?()
        return true
    }
    var nextLocalExpiry: Date? {
        let previewDeadline = pendingPreview?.capturedAt.addingTimeInterval(86_400)
        let intentDeadline = intents.values.filter(\.hasRawImage).map(\.localRecoveryDeadline).min()
        return [previewDeadline, intentDeadline].compactMap { $0 }.min()
    }

    func hasLocalImage(intentID: UUID) -> Bool { intents[intentID]?.hasRawImage == true }

    /// Erase pixels at their original capture deadline, including previews
    /// that were never submitted. Keep only IDs/hash for uncertain in-flight
    /// admissions so exact server readback remains possible without replay.
    func expireLocalImages(at deadline: Date) {
        var changed = false
        if let preview = pendingPreview, preview.capturedAt.addingTimeInterval(86_400) <= deadline {
            pendingPreview = nil
            if case .previewReady = presentation {
                presentation = .failed(nil, "本机截图已过期，请重新截图。")
            }
            changed = true
        }
        for intent in Array(intents.values) where intent.hasRawImage && intent.isLocallyExpired(at: deadline) {
            intentGenerations[intent.id, default: 0] += 1
            do {
                try recovery.remove(intent)
                intents[intent.id] = intent.withoutRawImage()
                if case .uploading(let current) = presentation, current == intent.id { presentation = .unknown(intent.id) }
                if case .unknown(let current) = presentation, current == intent.id { presentation = .unknown(intent.id) }
                if case .failed(let current, _) = presentation, current == intent.id {
                    presentation = .failed(intent.id, "本机截图已过期，无法再次上传；请核对原会话。")
                }
            } catch {
                intents[intent.id] = intent.withoutRawImage()
                presentation = .deletionFailed(intent.id)
            }
            changed = true
        }
        if changed { onRecoveryChanged?() }
    }

    private func stageAndAdmit(_ image: CGImage, context: CaptureContext, capturedAt: Date,
                               generation: Int) async {
        guard generation == captureGeneration, boundOwnerScope == context.ownerScope else { return }
        var stagedID: UUID?
        do {
            let encoded = try CaptureImageEncoder.encodePNG(image)
            guard generation == captureGeneration, boundOwnerScope == context.ownerScope else { return }
            var intent = try CaptureIntent(imagePNG: encoded.data, context: context, capturedAt: capturedAt)
            guard !intent.isLocallyExpired(at: now()) else {
                presentation = .failed(nil, "本机截图已过期，请重新选择。")
                return
            }
            // Stage under the identity reviewed at capture start even when the
            // five-minute context expires during a long selection. Transport
            // rereads the current owner and policy before any upload.
            try recovery.save(intent)
            intents[intent.id] = intent
            intentGenerations[intent.id] = 0
            stagedID = intent.id
            onRecoveryChanged?()
            intent.phase = .uploading
            try recovery.save(intent)
            intents[intent.id] = intent
            presentation = .uploading(intent.id)
            await submit(intent, context: context, generation: intentGenerations[intent.id] ?? 0)
        } catch CaptureIntentError.imageTooLarge {
            presentation = .failed(nil, "截图超过 10 MB，请缩小选区再试。")
        } catch {
            presentation = .failed(stagedID, "截图暂存失败，尚未上传。")
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
            do { try recovery.remove(intent) }
            catch {
                intents[intent.id] = intent.withoutRawImage()
                presentation = .deletionFailed(intent.id)
                onRecoveryChanged?()
                return
            }
            let admitted = intent.withoutRawImage()
            if receipt.resultRecorded {
                progressPoll?.cancel(); progressPoll = nil
                intents.removeValue(forKey: intent.id)
                intentGenerations.removeValue(forKey: intent.id)
                presentation = .viewable(intent.sessionId)
            } else if receipt.status == "failed" || receipt.status == "interrupted" || receipt.status == "cancelled" {
                progressPoll?.cancel(); progressPoll = nil
                var failed = admitted
                failed.phase = .failed
                intents[intent.id] = failed
                presentation = .failed(intent.id, "Agent 未完成处理，可打开原会话查看或重试。")
            } else {
                // The backend owns execution independently of this window.
                intents[intent.id] = admitted
                presentation = .processing(intent.sessionId)
                startProgressPollIfNeeded()
            }
            onRecoveryChanged?()
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
            if boundOwnerScope != current.ownerScope { rebindOwner(to: current); return }
            onVerifiedContext?(current)
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
        presentation = intent.hasRawImage ? .uploading(intentID) : .unknown(intentID)
        do {
            let current = try await transport.context()
            guard intentIsCurrent(intentID, generation: generation) else { return }
            if boundOwnerScope != current.ownerScope { rebindOwner(to: current); return }
            onVerifiedContext?(current)
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
        let expectedRevision = ownerRevision
        do {
            let context = try await transport.context()
            guard expectedRevision == ownerRevision || sameAuthorization(as: context) else { return }
            rebindOwner(to: context)
            onVerifiedContext?(context)
            let restored = try recovery.load(origin: context.origin, ownerScope: context.ownerScope, now: now())
            for intent in restored { intents[intent.id] = intent }
            for intent in restored { intentGenerations[intent.id] = 0 }
            if let recent = restored.last { presentation = .unknown(recent.id) }
            onRecoveryChanged?()
        } catch CaptureTransportError.server(401, _) {
            guard expectedRevision == ownerRevision else { return }
            // An explicit sign-out is not an offline condition. Do not surface
            // the previous owner's encrypted recovery under a signed-out UI.
            rebindOwner(to: nil)
        } catch {
            guard expectedRevision == ownerRevision else { return }
            // Offline readback cannot establish the current login. Recover only
            // under the user's previously acknowledged origin/owner and keep
            // it explicitly unsent until authenticated context is fresh.
            guard let prior = preferences.onboardingAcknowledgement,
                  prior.origin == WorkspaceConnection.shared.origin?.url.absoluteString,
                  !explicitlySignedOut,
                  boundOwnerScope == nil || boundOwnerScope == prior.ownerScope,
                  let restored = try? recovery.load(origin: prior.origin, ownerScope: prior.ownerScope, now: now())
            else { return }
            for intent in restored { intents[intent.id] = intent }
            for intent in restored { intentGenerations[intent.id] = 0 }
            if let recent = restored.last { presentation = .unknown(recent.id) }
            onRecoveryChanged?()
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
            onRecoveryChanged?()
        }
        catch {
            intents[intentID] = intent.withoutRawImage()
            presentation = .deletionFailed(intentID)
            onRecoveryChanged?()
        }
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
