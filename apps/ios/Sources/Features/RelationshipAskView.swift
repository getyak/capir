import SwiftUI
import UIKit
import CoreTransferable
import AVFoundation
import ActivityKit
import CryptoKit
import PhotosUI
import UniformTypeIdentifiers

private struct VoiceQuickControlFramePreferenceKey: PreferenceKey {
    static var defaultValue: CGRect = .zero

    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let next = nextValue()
        if !next.isEmpty {
            value = next
        }
    }
}

@MainActor
final class VoiceInputStore: ObservableObject {
    enum Phase: Equatable {
        case idle
        case requestingPermission
        case recording(startedAt: Date)
        case transcribing
        case failed(String)
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var microphonePermission: AudioSignalPermission
    @Published private(set) var transcript: String?
    @Published private(set) var liveTranscript = ""

    private let recorder: VoiceDictationRecordingServing
    private var activePayload: VoiceDictationPayload?
    private var transcriber: (any VoiceTranscriptionServing)?
    private var limitTask: Task<Void, Never>?
    private var transcriptionOperation: Task<VoiceTranscriptionDraft, Error>?
    private var sceneIsActive = true

    init(recorder: VoiceDictationRecordingServing? = nil) {
        let resolvedRecorder: VoiceDictationRecordingServing
        if let recorder {
            resolvedRecorder = recorder
        } else {
#if DEBUG
            resolvedRecorder = ProcessInfo.processInfo.arguments.contains(
                "--deterministic-voice-input"
            )
                ? DeterministicVoiceDictationRecorder()
                : VoiceDictationRecorder()
#else
            resolvedRecorder = VoiceDictationRecorder()
#endif
        }
        self.recorder = resolvedRecorder
        microphonePermission = resolvedRecorder.permissionStatus()
    }

    deinit {
        limitTask?.cancel()
        transcriptionOperation?.cancel()
    }

    var isRecording: Bool {
        if case .recording = phase { return true }
        return false
    }

    var isBusy: Bool {
        switch phase {
        case .requestingPermission, .recording, .transcribing:
            return true
        case .idle, .failed:
            return false
        }
    }

    func refreshPermissionStatus() {
        microphonePermission = recorder.permissionStatus()
    }

    func updateSceneIsActive(_ isActive: Bool) {
        sceneIsActive = isActive
    }

    func start(
        sceneIsActive: Bool,
        locale: Locale = .current,
        transcriber: any VoiceTranscriptionServing
    ) async {
        await LabClientDiagnostics.observe(.audioSessionPreparation) {
            guard !self.isBusy else { return .skipped }
            self.sceneIsActive = sceneIsActive
            guard sceneIsActive else {
                self.phase = .failed(
                    "Keep capri in the foreground to use voice input."
                )
                return .skipped
            }
            self.transcript = nil
            self.liveTranscript = ""
            var permission = self.recorder.permissionStatus()
            if permission == .undetermined {
                self.phase = .requestingPermission
                permission = await self.recorder.requestPermission()
            }
            self.microphonePermission = permission
            guard permission == .granted else {
                self.phase = .failed(
                    "Microphone permission was not granted. No audio was recorded."
                )
                return .failed
            }
            do {
                while !self.sceneIsActive {
                    try Task.checkCancellation()
                    try await Task.sleep(for: .milliseconds(50))
                }
                try Task.checkCancellation()
            } catch {
                self.phase = .idle
                return LabClientDiagnostics.failure(error)
            }
            do {
                let recordID = UUID()
                await self.recorder.prepareLiveTranscription(
                    locale: locale
                ) { [weak self] value in
                    Task { @MainActor in
                        self?.liveTranscript = value.trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                    }
                }
                try Task.checkCancellation()
                try self.recorder.start(recordID: recordID)
                self.transcriber = transcriber
                self.phase = .recording(startedAt: Date())
                self.limitTask?.cancel()
                self.limitTask = Task { [weak self] in
                    do {
                        try await Task.sleep(
                            for: .seconds(
                                VoiceDictationAudioContract.maximumDurationSeconds
                            )
                        )
                    } catch {
                        return
                    }
                    await self?.stopAndTranscribe(triggeredByLimit: true)
                }
                return .completed
            } catch {
                try? self.recorder.cancel()
                self.phase = .failed(
                    (error as? LocalizedError)?.errorDescription
                        ?? "Voice input could not start the microphone."
                )
                return LabClientDiagnostics.failure(error)
            }
        }
    }

    func stopAndTranscribe(triggeredByLimit: Bool = false) async {
        guard isRecording, let transcriber else { return }
        if !triggeredByLimit {
            limitTask?.cancel()
            limitTask = nil
        }
        do {
            let payload = try LabClientDiagnostics.measureSync(.audioPayloadFinalization) {
                try recorder.stop()
            }
            activePayload = payload
            phase = .transcribing
            defer {
                try? recorder.delete(payload)
                activePayload = nil
                self.transcriber = nil
                if triggeredByLimit { limitTask = nil }
            }
            let draft = try await LabClientDiagnostics.measure(.voiceTranscription) {
                let operation = Task {
                    try await transcriber.transcribe(payload)
                }
                transcriptionOperation = operation
                defer { transcriptionOperation = nil }
                return try await operation.value
            }
            try Task.checkCancellation()
            transcript = draft.transcript.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            if transcript?.isEmpty == false {
                phase = .idle
            } else {
                phase = .failed("No clear words were heard. Try again.")
            }
        } catch is CancellationError {
            if case .failed = phase {
                // Foreground loss keeps its explicit recovery message.
            } else {
                phase = .idle
            }
        } catch {
            phase = .failed(
                (error as? LocalizedError)?.errorDescription
                    ?? "Voice transcription failed. Your text draft is unchanged."
            )
        }
    }

    func consumeTranscript() {
        transcript = nil
    }

    func cancel() {
        limitTask?.cancel()
        limitTask = nil
        transcriptionOperation?.cancel()
        transcriptionOperation = nil
        try? recorder.cancel()
        if let activePayload { try? recorder.delete(activePayload) }
        activePayload = nil
        transcriber = nil
        transcript = nil
        liveTranscript = ""
        phase = .idle
    }

    func stopForForegroundLoss() {
        guard isBusy else { return }
        let wasTranscribing: Bool
        if case .transcribing = phase {
            wasTranscribing = true
        } else {
            wasTranscribing = false
        }
        cancel()
        phase = .failed(
            wasTranscribing
                ? "Voice transcription was interrupted. The temporary recording was deleted; the provider result is unavailable."
                : "Voice input stopped when capri left the foreground. No audio was sent."
        )
    }

    func stopForAudioInterruption() {
        guard isRecording else { return }
        cancel()
        phase = .failed(
            "Voice input was interrupted by another audio session. No audio was sent."
        )
    }

    func dismissFailure() {
        if case .failed = phase { phase = .idle }
    }

    func reportUnavailable() {
        guard !isBusy else { return }
        phase = .failed(
            "Voice dictation is not configured for this workspace. Your message and attachments are unchanged."
        )
    }
}

private struct VoiceListeningVisualizer: View {
    @Environment(\.talentSignalReduceMotion) private var reduceMotion

    private let barCount = 13

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 12.0, paused: reduceMotion)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            HStack(alignment: .center, spacing: 4) {
                ForEach(0..<barCount, id: \.self) { index in
                    Capsule()
                        .fill(index == barCount / 2 ? Color.tsVermilion : Color.tsInk.opacity(0.72))
                        .frame(width: 3, height: barHeight(index: index, time: time))
                }
            }
            .frame(maxWidth: .infinity, minHeight: 42)
        }
        .accessibilityHidden(true)
    }

    private func barHeight(index: Int, time: TimeInterval) -> CGFloat {
        guard !reduceMotion else {
            return CGFloat(10 + (index * 7) % 22)
        }
        let phase = time * 3.0 + Double(index) * 0.74
        let envelope = 0.5 + 0.5 * sin(phase)
        let stagger = 0.72 + 0.28 * sin(phase * 0.53 + Double(index))
        return 9 + CGFloat(envelope * stagger) * 27
    }
}

private struct VoiceRecordButtonHalo: View {
    let isActive: Bool

    @Environment(\.talentSignalReduceMotion) private var reduceMotion

    var body: some View {
        if isActive {
            TimelineView(.animation(minimumInterval: 1.0 / 15.0, paused: reduceMotion)) { context in
                let pulse: CGFloat = reduceMotion
                    ? 0
                    : CGFloat(
                        (sin(context.date.timeIntervalSinceReferenceDate * 3.2) + 1) / 2
                    )
                Circle()
                    .stroke(Color.tsVermilion.opacity(0.18 + pulse * 0.18), lineWidth: 1.5)
                    .scaleEffect(1.08 + pulse * 0.12)
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

enum RelationshipAskCaptureAction: Equatable, Sendable {
    case screenshotReview
    case foregroundAudio
}

enum RelationshipAskEntryMode: Equatable, Sendable {
    case text
    case attachment
    case voice
}

private enum AskFailureRecovery: Equatable {
    case retry
    case reviewSource(AskCitationReviewRequirement)
    case openRelationship(String)

    var needsSourceAttention: Bool {
        switch self {
        case .reviewSource, .openRelationship:
            return true
        case .retry:
            return false
        }
    }
}

private struct AskSessionSynchronizationFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private enum VoiceRibbonMode: Equatable {
    case idle
    case pressToDraft
    case locked
    case cancelling
}

@MainActor
struct RelationshipAskView: View {
    let snapshot: PursuitWorkspaceSnapshot
    let isCanonical: Bool
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    @ObservedObject var sessionStore: AgentSessionStore
    let sessionID: UUID?
    var initialSeed: AgentSessionSeed? = nil
    var preferredPersonID: String? = nil
    var preferredPersonLabel: String? = nil
    var initialEntryMode: RelationshipAskEntryMode = .text
    let ask: (
        _ objective: String,
        _ personID: String,
        _ contextID: String,
        _ idempotencyKey: String,
        _ mediaIDs: [String],
        _ sessionID: UUID?,
        _ messageID: UUID?
    ) async throws -> RelationshipAskResponse
    let saveContact: (
        _ draft: ConversationContactDraft,
        _ target: ConversationContactTarget,
        _ confirmIdentityClue: Bool,
        _ capturedAt: Date,
        _ idempotencyKey: String
    ) async throws -> ResourceCaptureResult
    let reviewEvidence: (
        _ fragmentID: String,
        _ expectedReviewStatus: String,
        _ expectedLastReviewID: String?,
        _ decision: String,
        _ reason: String,
        _ idempotencyKey: String
    ) async throws -> PursuitEvidenceReviewResult
    let revalidateSessions: () async -> Void
    var synchronizeSessions: (_ requiredSessionID: UUID?) async -> Bool = { _ in true }
    var answerFeedbackClient: (any AnswerFeedbackServing)? = nil
    let onOpenProposal: (WorkspaceProposal) -> Void
    let onCapture: (RelationshipAskCaptureAction) -> Void
    let onOpenPerson: (String) -> Void
    let voiceTranscriber: (any VoiceTranscriptionServing)?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.sizeCategory) private var sizeCategory
    @Environment(\.talentSignalReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    @ScaledMetric(relativeTo: .caption2) private var scopeContextFontSize: CGFloat = 11
    @State private var selectedScope: AskScope?
    @State private var scopeQuery = ""
    @State private var isChoosingScope = false
    @State private var isRequestingScope = false
    @State private var draft = ""
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var isPhotoLibraryPresented = false
    @State private var isFileImporterPresented = false
    @State private var isHomeAttachmentChooserPresented = false
    @State private var mediaDrafts: [AskMediaDraft] = []
    @State private var screenshotContactTask: ScreenshotContactTask?
    @State private var screenshotTasks: [String: ScreenshotContactTask] = [:]
    @State private var screenshotContactRequest: ScreenshotContactTaskBody?
    @State private var showScreenshotHistory = false
    @State private var mediaNotice: String?
    @State private var mediaImportTask: Task<Void, Never>?
    @State private var activeSessionID: UUID?
    @State private var operationState = RelationshipAskOperationState()
#if DEBUG
    @State private var fixtureAskFailureConsumed = false
    @State private var fixtureContactLookupFailureConsumed = false
    @State private var fixtureAskRequestCount = 0
#endif
    @State private var errorMessage: String?
    @State private var errorRecovery: AskFailureRecovery = .retry
    @State private var sourceReviewNotice: String?
    @State private var contactDraft: ConversationContactDraft?
    @State private var contactOperationKey: String?
    @State private var pendingContactTarget: ConversationContactTarget?
    @State private var pendingContactCapturedAt: Date?
    @State private var pendingContactConfirmIdentityClue: Bool?
    @State private var contactCandidates: [WorkspacePerson] = []
    @State private var contactLookupPhase: ConversationContactLookupPhase = .idle
    @State private var contactLookupTask: Task<Void, Never>?
    @State private var selectedContactPersonID: String?
    @State private var selectedContactContextID: String?
    @State private var createDistinctContact = false
    @State private var saveContactForIdentityReview = false
    @State private var confirmContactIdentityClue = false
    @State private var isSavingContact = false
    @State private var contactSaveMessage: String?
    @State private var contactSaveError: String?
    @State private var selectedCitation: SelectedAskCitation?
    @State private var reviewRecoveryOwner: AskCitationReviewOwner?
    @State private var selectedPursuit: SelectedPursuitTarget?
    @State private var reinstatementOperation: AgentEvidenceReviewOperation?
    @State private var reinstatementReason = ""
    @State private var reviewPreparationError: String?
    @State private var isVoiceDisclosurePresented = false
    @State private var voiceOperation: Task<Void, Never>?
    @State private var draftPersistenceTask: Task<Void, Never>?
    @State private var isComposerComposing = false
    @State private var shouldSendAfterCompositionCommits = false
    @State private var voiceRibbonMode: VoiceRibbonMode = .idle
    @State private var voiceHoldActivated = false
    @State private var voiceGestureStartedInControl = false
    @State private var voiceQuickControlFrame = CGRect.zero
    @State private var voiceTextInputFrame = CGRect.zero
    @State private var sessionActionError: String?
    @State private var shareReviewSessionID: ShareReviewTarget?
    @State private var answerFeedbackSelection: AnswerFeedbackSelection?
    @State private var voiceReleasePending = false
    @State private var voiceTapSuppressed = false
    @State private var voiceStopRequested = false
    @StateObject private var voiceInput = VoiceInputStore()
    @AppStorage("voice-input-cloud-disclosure-v1")
    private var hasAcceptedVoiceDisclosure = false
    @FocusState private var composerFocused: Bool

    private var preferredPersonName: String? {
        guard let preferredPersonID else { return preferredPersonLabel }
        return currentSnapshot.people.first(where: { $0.id == preferredPersonID })?.displayLabel
            ?? preferredPersonLabel
    }

    var body: some View {
        VStack(spacing: 0) {
                if isNewSessionEntry {
                    newSessionHeader
                    if isHomeAttachmentChooserPresented {
                        homeAttachmentChooser
                    } else {
                        Spacer(minLength: 0)
                        compactComposerContext
                        composer
                        Text(
                            appLanguage.text(
                                "Send naturally. Agent uses contact context only when it helps.",
                                zhHans: "直接发送即可。Agent 只会在有帮助时使用联系人上下文。"
                            )
                        )
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 28)
                        .accessibilityIdentifier("ask-recall-disclosure")
                        if !isCanonical {
                            starterGrid
                                .padding(.horizontal, 28)
                        }
                        Spacer(minLength: 14)
                    }
                } else {
                    if shouldShowScopeBar,
                       contactDraft == nil || contactSaveMessage != nil,
                       !usesScrollableScopeBar {
                        scopeBar
                            .transition(.opacity)
                    }
                    conversation
                    composer
                }
            }
            .background(Color.tsSurface.ignoresSafeArea())
            .animation(
                reduceMotion
                    ? nil
                    : .spring(response: 0.42, dampingFraction: 0.88),
                value: isNewSessionEntry
            )
        .navigationTitle(appLanguage.text("Session"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(isNewSessionEntry ? .hidden : .visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if !isNewSessionEntry { sessionMenu }
            }
        }
        .tint(.tsInk)
        .alert(appLanguage.text("Session"), isPresented: Binding(
            get: { sessionActionError != nil },
            set: { if !$0 { sessionActionError = nil } }
        )) {
            Button(appLanguage.text("OK"), role: .cancel) {}
        } message: {
            Text(sessionActionError ?? "")
        }
        .sheet(isPresented: $showScreenshotHistory) {
            ScreenshotContactHistoryView(workspaceStore: workspaceStore, onOpenPerson: onOpenPerson)
        }
        .sheet(item: $shareReviewSessionID) { target in
            AgentSessionShareReviewSheet(
                session: sessionStore.session(id: target.id),
                language: appLanguage
            )
        }
        .sheet(item: $answerFeedbackSelection) { selection in
            if let answerFeedbackClient {
                AnswerFeedbackSheet(selection: selection, client: answerFeedbackClient) {
                    await synchronizeSessions(selection.sessionID)
                }
            }
        }
        .photosPicker(
            isPresented: $isPhotoLibraryPresented,
            selection: $selectedPhotoItems,
            maxSelectionCount: 10,
            matching: .images
        )
        .fileImporter(
            isPresented: $isFileImporterPresented,
            allowedContentTypes: [.image],
            allowsMultipleSelection: true,
            onCompletion: importSelectedImageFiles
        )
        .sheet(item: $selectedCitation) { selection in
            AskCitationDetailView(
                citation: selection.citation,
                language: appLanguage,
                onReject: isCanonical ? { reason in
                    try await submitCitationDecision(
                        selection,
                        decision: "rejected",
                        reason: reason
                    )
                } : nil,
                onReview: isCanonical && selection.citation.needsCurrentReview
                    ? { reason in
                        try await submitCitationDecision(
                            selection,
                            decision: "reviewed",
                            reason: reason
                        )
                    }
                    : nil
            )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $selectedPursuit) { target in
            PursuitDetailView(
                pursuit: target.pursuit,
                snapshot: workspaceStore.snapshot,
                currentUserID: workspaceStore.snapshot?.currentUserID,
                workspaceStore: workspaceStore,
                targetActionID: target.actionID,
                onOpenProposal: { proposal in
                    selectedPursuit = nil
                    onOpenProposal(proposal)
                }
            )
        }
        .alert(
            appLanguage.text("Re-review this source?", zhHans: "重新审阅此来源？"),
            isPresented: Binding(
                get: { reinstatementOperation != nil },
                set: { if !$0 { reinstatementOperation = nil } }
            )
        ) {
            TextField(
                appLanguage.text("What changed or was corrected?", zhHans: "发生了什么更正？"),
                text: $reinstatementReason
            )
            Button(appLanguage.text("Cancel", zhHans: "取消"), role: .cancel) {
                reinstatementOperation = nil
                reinstatementReason = ""
            }
            Button(appLanguage.text("Re-review source", zhHans: "重新审阅来源")) {
                guard let operation = reinstatementOperation else { return }
                submitReinstatement(operation)
                reinstatementOperation = nil
            }
            .disabled(
                reinstatementReason.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ).isEmpty
            )
        } message: {
            Text(
                appLanguage.text(
                    "The prior dispute stays in the audit. Old answers stay stale; only a fresh Ask can use the source again.",
                    zhHans: "原争议会保留在审计记录中。旧回复仍为过期；只有新的提问才能再次使用该来源。"
                )
            )
        }
        .task {
            voiceInput.updateSceneIsActive(scenePhase == .active)
            await revalidateAndDismissUnavailableCitation()
            activeSessionID = sessionID
            if let session = sessionStore.session(id: sessionID) {
                if let personID = session.personID,
                   let relationshipContextID = session.relationshipContextID {
                    selectedScope = availableScopes.first {
                        $0.person.id == personID
                            && $0.context.id == relationshipContextID
                    }
                    if let recoverableObjective = session.pendingObjective {
                        draft = recoverableObjective
                    }
                } else {
                    selectedScope = nil
                    if session.isUnresolvedIntent,
                       let recoverableObjective = session.pendingObjective {
                        draft = recoverableObjective
                        if session.hasPendingPersonResearch {
                            mediaNotice = appLanguage.text(
                                "The prior screenshot was not retained. Reattach the same image to reconcile or retry its protected Run."
                            )
                        }
                    }
                }
                sessionStore.markRead(session.id)
            } else if let initialSeed {
                selectedScope = availableScopes.first {
                    $0.person.id == initialSeed.personID
                        && $0.context.id == initialSeed.relationshipContextID
                }
                if selectedScope == nil {
                    errorMessage = appLanguage.text(
                        "The reviewed relationship is not available in the current workspace.",
                        zhHans: "当前工作区中找不到刚审阅的关系。"
                    )
                }
            } else if let preferredPersonID {
                let matchingScopes = availableScopes.filter {
                    $0.person.id == preferredPersonID
                }
                switch AgentPreferredPersonScopePolicy.resolve(
                    matchingScopeCount: matchingScopes.count
                ) {
                case .exact:
                    selectedScope = matchingScopes[0]
                case .unavailable:
                    errorMessage = appLanguage.text(
                        "This person is not available in the current workspace."
                    )
                case .requiresSelection:
                    scopeQuery = preferredPersonName ?? ""
                    isChoosingScope = true
                }
            }
#if DEBUG
            let fixtureEnvironment = ProcessInfo.processInfo.environment
            let isFixturePreview = !isCanonical
                && fixtureEnvironment["TS_IOS_UI_TEST_PREVIEW_WORKSPACE"] == "true"
            let completedScreenshotArgument = ProcessInfo.processInfo.arguments.contains("--fixture-get-5-completed-screenshot")
            let completedScreenshotEnvironment = fixtureEnvironment["TS_IOS_UI_TEST_GET5_COMPLETED_SCREENSHOT"] == "true"
            let completedScreenshotRequested = isFixturePreview
                && (completedScreenshotArgument || completedScreenshotEnvironment)
            if isFixturePreview {
                // Boolean-only diagnostics distinguish launch delivery from
                // fixture seeding without logging arguments or evidence.
                print("GET5 screenshot fixture: argument=\(completedScreenshotArgument) environment=\(completedScreenshotEnvironment) emptyEntry=\(activeSessionID == nil) cancelled=\(Task.isCancelled)")
            }
            if completedScreenshotRequested, activeSessionID == nil {
                seedCompletedScreenshotFixture()
                print("GET5 screenshot fixture seeded: session=\(activeSessionID != nil) task=\(screenshotContactTask != nil) error=\(errorMessage != nil)")
            }
            if ProcessInfo.processInfo.arguments.contains("--fixture-get-5-interrupted-screenshot"), activeSessionID == nil {
                let objective = "Review the synthetic screenshot."
                activeSessionID = sessionStore.beginUnscopedSession(objective: objective)
                if let activeSessionID {
                    _ = sessionStore.beginScreenshotAdmission(
                        sessionID: activeSessionID, objective: objective,
                        requestIdentity: String(repeating: "a", count: 64),
                        proposedIdempotencyKey: "ios:contact-agent:00000000-0000-4000-8000-000000000005"
                    )
                }
            }
#endif
            restoreContactProposal()
            await restoreScreenshotTasks()
            restoreDraft(preferred: sessionStore.session(id: activeSessionID)?.pendingObjective ?? initialSeed?.suggestedObjective)
            if hasPendingScreenshotAdmission {
                draft = ""
                composerFocused = false
            }
            if let sessionID,
               let session = sessionStore.session(id: sessionID),
               session.isUnresolvedIntent,
               AskScreenshotAdmissionPolicy.canResumeAsText(
                   hasPendingScreenshotAdmission: session.hasPendingScreenshotAdmission,
                   hasPendingPersonResearch: session.hasPendingPersonResearch
               ),
               let recoverableObjective = session.pendingObjective,
               !recoverableObjective.trimmingCharacters(
                   in: .whitespacesAndNewlines
               ).isEmpty {
                operationState.pendingObjective = recoverableObjective
                operationState.pendingScopedSend = recoverableObjective
                draft = ""
                operationState.isSending = true
                if session.hasPendingUnscopedChat {
                    operationState.relationshipRecallPhase = .replyingWithoutRelationship
                    updateAskSubmissionPhase(.requestingWorkspaceAnswer)
                    performUnscopedChat(
                        sessionID: sessionID,
                        effectiveObjective: recoverableObjective,
                        originalDraft: recoverableObjective
                    )
                } else {
                    operationState.relationshipRecallPhase = .replyingWithoutRelationship
                    updateAskSubmissionPhase(.requestingWorkspaceAnswer)
                    performUnscopedChat(
                        sessionID: sessionID,
                        effectiveObjective: recoverableObjective,
                        originalDraft: recoverableObjective
                    )
                }
            }
            if sessionID == nil,
               activeSessionID == nil,
               initialSeed == nil,
               contactDraft == nil,
               preferredPersonID == nil {
                await Task.yield()
                switch initialEntryMode {
                case .text:
                    if !voiceOverEnabled,
                       !dynamicTypeSize.isAccessibilitySize,
                       !sizeCategory.isAccessibilityCategory {
                        composerFocused = true
                    }
                case .attachment:
                    isHomeAttachmentChooserPresented = true
                case .voice:
                    composerPrimaryAction()
                }
            }
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(60))
                } catch {
                    return
                }
                await revalidateAndDismissUnavailableCitation()
            }
        }
        .task(id: screenshotPollingKey) {
            guard !operationState.isSending, let ownerSessionID = activeSessionID else { return }
            let taskIDs = screenshotTasks.values.filter { $0.status == "running" }.map(\.taskID)
            guard !taskIDs.isEmpty else { return }
            do {
                while !Task.isCancelled {
                    try await Task.sleep(for: .seconds(2))
                    for taskID in taskIDs {
                        let current = try await workspaceStore.loadScreenshotContactTask(id: taskID)
                        try Task.checkCancellation()
                        guard AskScreenshotResponseOwner(sessionID: ownerSessionID, taskID: taskID)
                            .accepts(currentSessionID: activeSessionID, responseTaskID: current.taskID) else { return }
                        recordScreenshotResult(current, expectedSessionID: ownerSessionID)
                    }
                    if !screenshotTasks.values.contains(where: { $0.status == "running" }) { return }
                }
            } catch {
                if !Task.isCancelled, activeSessionID == ownerSessionID { sourceReviewNotice = appLanguage.text("A screenshot result could not be refreshed. Its saved message remains available.") }
            }
        }
        .onChange(of: selectedCitationIsCurrent) { isCurrent in
            if !isCurrent { selectedCitation = nil }
        }
        .onChange(of: currentReviewOwner) { _ in
            reviewRecoveryOwner = nil
            if case .reviewSource = errorRecovery { errorRecovery = .retry; selectedCitation = nil }
        }
        .onChange(of: sessionStore.session(id: activeSessionID)?.updatedAt) { _ in
            guard !operationState.isSending else { return }
            Task { _ = await synchronizeSessions(nil) }
        }
        .onChange(of: operationState.isSending) { sending in
            if !sending {
                if let activeSessionID, draft.isEmpty {
                    _ = sessionStore.clearDraft(sessionID: activeSessionID)
                }
                Task { _ = await synchronizeSessions(nil) }
            }
        }
        .onChange(of: draft) { value in
            guard !operationState.isSending else { return }
            if selectedScope == nil,
               value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                isRequestingScope = false
                isChoosingScope = false
                scopeQuery = ""
            }
            scheduleDraftPersistence(value)
        }
        .onChange(of: isComposerComposing) { composing in
            guard !composing, shouldSendAfterCompositionCommits else { return }
            shouldSendAfterCompositionCommits = false
            send(draft)
        }
        .onChange(of: selectedPhotoItems) { items in
            guard !items.isEmpty else { return }
            importSelectedPhotos(items)
        }
        .onChange(of: voiceInput.phase) { phase in
            switch phase {
            case .idle:
                AskInputDiagnostics.voiceTransition(.idle)
                voiceReleasePending = false
                voiceStopRequested = false
                voiceRibbonMode = .idle
                break
            case .requestingPermission:
                AskInputDiagnostics.voiceTransition(.requestingPermission)
            case .recording:
                AskInputDiagnostics.voiceTransition(.recording)
                voiceQuickControlFrame = .zero
                if voiceReleasePending {
                    voiceReleasePending = false
                    finishVoiceInputForReview()
                }
            case .transcribing:
                AskInputDiagnostics.voiceTransition(.transcribing)
            case .failed:
                AskInputDiagnostics.voiceTransition(.failed)
                voiceReleasePending = false
                voiceStopRequested = false
                voiceRibbonMode = .idle
            }
        }
        .onChange(of: selectedScope?.id) { _ in
            guard let selectedScope, !mediaDrafts.isEmpty else { return }
            rebindMediaDrafts(to: selectedScope)
        }
        .onChange(of: voiceInput.transcript) { transcript in
            guard let transcript, !transcript.isEmpty else { return }
            voiceInput.consumeTranscript()
            insertVoiceTranscript(transcript)
        }
        .onChange(of: scenePhase) { phase in
            voiceInput.updateSceneIsActive(phase == .active)
            if phase == .active {
                voiceInput.refreshPermissionStatus()
            } else if phase == .background {
                flushDraftPersistence()
                voiceOperation?.cancel()
                voiceOperation = nil
                voiceInput.stopForForegroundLoss()
            }
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: AVAudioSession.interruptionNotification
            )
        ) { _ in
            guard voiceInput.isRecording else { return }
            voiceOperation?.cancel()
            voiceOperation = nil
            voiceInput.stopForAudioInterruption()
        }
        .onDisappear {
            shouldSendAfterCompositionCommits = false
            voiceGestureStartedInControl = false
            flushDraftPersistence()
            operationState.cancelViewBoundOperations()
            voiceOperation?.cancel()
            voiceOperation = nil
            voiceInput.cancel()
            draftPersistenceTask?.cancel()
            draftPersistenceTask = nil
            mediaImportTask?.cancel()
            mediaImportTask = nil
            discardMediaDrafts()
        }
        .confirmationDialog(
            appLanguage.text("Create a voice draft?"),
            isPresented: $isVoiceDisclosurePresented,
            titleVisibility: .visible
        ) {
            Button(appLanguage.text("Start dictating")) {
                hasAcceptedVoiceDisclosure = true
                voiceHaptic(.soft)
                voiceRibbonMode = .locked
                startVoiceInput(mode: .locked)
            }
            .accessibilityIdentifier("confirm-voice-input-disclosure")
            Button(appLanguage.text("Cancel"), role: .cancel) {}
        } message: {
            Text(
                appLanguage.text(
                    "When available, provisional words appear on device while you speak. After you stop, the temporary recording goes to Doubao to create an editable draft. Nothing is sent to Agent until you tap Send. capri deletes its temporary audio after transcription; provider handling follows your service agreement."
                )
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("relationship-ask-screen")
        .labDiagnosticPresentation()
#if DEBUG
        .overlay(alignment: .topTrailing) {
            if ProcessInfo.processInfo.arguments.contains(
                "--fixture-record-ask-request-count"
            ) {
                Text(verbatim: "\(fixtureAskRequestCount)")
                    .font(.system(size: 1))
                    .foregroundStyle(Color.clear)
                    .frame(width: 1, height: 1)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(appLanguage.text("Agent request count"))
                    .accessibilityValue("\(fixtureAskRequestCount)")
                    .accessibilityIdentifier("ask-fixture-request-count")
            }
        }
#endif
    }

    private var scopeBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                composerFocused = false
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) {
                    isChoosingScope.toggle()
                }
            } label: {
                Group {
                    if let selectedScope {
                        scopeChip(selectedScope)
                    } else {
                        HStack {
                            Image(systemName: "person.crop.circle.badge.questionmark")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.tsVermilion)
                                .accessibilityHidden(true)
                            Text(
                                appLanguage.text(
                                    isRequestingScope
                                        ? "Who is this about?"
                                        : preferredPersonName.map {
                                            String(
                                                format: appLanguage.text(
                                                    "Choose a relationship for %@"
                                                ),
                                                locale: appLanguage.locale,
                                                $0
                                            )
                                        }
                                        ?? "Choose a relationship"
                                )
                            )
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.tsInk)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer()
                            Image(systemName: "chevron.down")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.tsMutedInk)
                                .accessibilityHidden(true)
                        }
                    }
                }
                .frame(
                    maxWidth: .infinity,
                    minHeight: scopeSelectorMinimumHeight,
                    alignment: .leading
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(operationState.isSending || hasPendingScreenshotAdmission)
            .frame(
                maxWidth: .infinity,
                minHeight: scopeSelectorMinimumHeight,
                alignment: .leading
            )
            .accessibilityHint(
                appLanguage.text(
                    selectedScope == nil
                        ? "Choose a person and relationship for this message."
                        : "Choose a different person or relationship."
                )
            )
            .accessibilityIdentifier("ask-scope-selector")

            if isChoosingScope {
                if isResolvingPreferredPerson {
                    Text(
                        appLanguage.text(
                            "Choosing a relationship is optional. Otherwise Agent will resolve it after Send.",
                            zhHans: "选择关系是可选的；未选择时，Agent 会在发送后判断。"
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("ask-preferred-scope-optional")
                }
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(Color.tsMutedInk)
                        .accessibilityHidden(true)
                    TextField(
                        appLanguage.text("Person or context", zhHans: "人物或情境"),
                        text: $scopeQuery
                    )
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("ask-scope-search")
                }
                .frame(minHeight: 44)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, usesAccessibilityLayout ? 10 : 6)
    }

    @ViewBuilder
    private var scopeChoices: some View {
        if filteredScopes.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Label(
                    appLanguage.text("No matching relationships"),
                    systemImage: "magnifyingglass"
                )
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                Text(appLanguage.text("Try another person or context."))
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                Button(appLanguage.text("Clear search")) {
                    scopeQuery = ""
                }
                .font(.caption.weight(.semibold))
                .frame(minHeight: 44)
            }
            .accessibilityIdentifier("ask-scope-no-results")
        } else if dynamicTypeSize.isAccessibilitySize
                    || sizeCategory.isAccessibilityCategory {
            VStack(spacing: 8) {
                ForEach(filteredScopes) { scope in
                    scopeOption(scope, fillsWidth: true)
                }
            }
        } else {
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(filteredScopes) { scope in
                        scopeOption(scope, fillsWidth: false)
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    private func scopeOption(_ scope: AskScope, fillsWidth: Bool) -> some View {
        Button {
            selectScope(scope)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(scope.person.displayLabel)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                    .lineLimit(fillsWidth ? nil : 1)
                    .fixedSize(horizontal: false, vertical: true)
                Text(scope.context.displayLabel)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .lineLimit(fillsWidth ? nil : 1)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(
                maxWidth: fillsWidth ? .infinity : nil,
                minHeight: 44,
                alignment: .leading
            )
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 14))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(
            "ask-scope-option-\(scope.person.id)-\(scope.context.id)"
        )
    }

    private func scopeChip(_ scope: AskScope) -> some View {
        HStack(alignment: .top, spacing: 8) {
            if !dynamicTypeSize.isAccessibilitySize && !sizeCategory.isAccessibilityCategory {
                Circle()
                    .fill(Color.tsVermilion.opacity(0.14))
                    .frame(width: 26, height: 26)
                    .overlay {
                        Text(initials(scope.person.displayLabel))
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Color.tsVermilion)
                            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    }
                    .accessibilityHidden(true)
            }
            Group {
                if usesAccessibilityLayout {
                    Text(scope.person.displayLabel + "\n" + scope.context.displayLabel)
                        .font(.caption)
                        .foregroundStyle(Color.tsInk)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(scope.person.displayLabel)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.tsInk)
                            .lineLimit(1)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(scope.context.displayLabel)
                            .font(.system(size: scopeContextFontSize))
                            .foregroundStyle(Color.tsMutedInk)
                            .lineLimit(1)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .layoutPriority(1)
            Spacer(minLength: 8)
            Image(systemName: "chevron.down")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
                .frame(width: 32, height: 32)
                .accessibilityHidden(true)
        }
        .frame(
            maxWidth: .infinity,
            minHeight: scopeSelectorMinimumHeight,
            alignment: .leading
        )
        .contentShape(Rectangle())
    }

    private var scopeSelectorMinimumHeight: CGFloat {
        guard selectedScope != nil else { return 44 }
        return usesAccessibilityLayout ? 68 : 52
    }

    private var usesScrollableScopeBar: Bool {
        dynamicTypeSize.isAccessibilitySize || sizeCategory.isAccessibilityCategory
    }

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    if shouldShowScopeBar,
                       contactDraft == nil || contactSaveMessage != nil,
                       usesScrollableScopeBar {
                        scopeBar
                            .padding(.horizontal, -20)
                            .id("ask-scrollable-scope-bar")
                    }

                    if isChoosingScope {
                        scopeChoices
                            .id("ask-scope-choices")
                    }

                    if conversationItems.isEmpty, contactDraft == nil, screenshotContactTask == nil {
                        starterGrid
                            .padding(.top, 24)
                    }

                    if !conversationItems.isEmpty {
                        ForEach(conversationItems) { item in
                            switch item {
                            case let .contactReceipt(receipt):
                                AgentContactReceiptTurn(
                                    receipt: receipt,
                                    language: appLanguage,
                                    onOpenPerson: openPersonAction(for: receipt)
                                )
                                .id(item.id)
                            case let .ask(turn):
                            VStack(alignment: .leading, spacing: 18) {
                            AskTurnView(
                                turn: turn,
                                language: appLanguage,
                                evidenceReviews: sessionStore.latestEvidenceReviews(
                                    taskID: turn.response.taskID
                                ),
                                evidenceReviewHistory: sessionStore.evidenceReviewHistory(
                                    taskID: turn.response.taskID
                                ),
                                inFlightEvidenceReviewKeys: sessionStore.activeEvidenceReviewKeys,
                                transientSupersededEvidenceReviewKeys:
                                    sessionStore.transientSupersededEvidenceReviewKeys,
                                evidenceReviewAuthorityReadbackKeys:
                                    sessionStore.evidenceReviewAuthorityReadbackKeys,
                                loadMedia: { mediaID in
                                    try await workspaceStore.loadChatMedia(id: mediaID)
                                },
                                onOpenEvidence: { citation in
                                    selectedCitation = SelectedAskCitation(
                                        taskID: turn.response.taskID,
                                        citation: citation
                                    )
                                },
                                onRetryEvidenceReview: retryEvidenceReview,
                                onReinstateEvidence: { operation in
                                    reinstatementReason = ""
                                    reinstatementOperation = operation
                                },
                                onStartFreshAsk: {
                                    draft = RelationshipAskDraftPolicy.currentEvidenceDraft(
                                        preserving: draft,
                                        suggestion: appLanguage.text(
                                            "What is current now?",
                                            zhHans: "现在的最新情况是什么？"
                                        )
                                    )
                                    composerFocused = true
                                },
                                onOpenPursuit: { pursuitID, actionID in
                                    guard let pursuit = currentSnapshot.pursuit(id: pursuitID) else {
                                        return
                                    }
                                    selectedPursuit = SelectedPursuitTarget(
                                        pursuit: pursuit,
                                        actionID: actionID
                                    )
                                },
                                onReviewPublicProfile: { source in
                                    stagePublicProfileReview(source)
                                },
                                screenshotTask: screenshotTasks[turn.response.taskID],
                                loadScreenshotImage: { taskID, index in
                                    try await workspaceStore.loadScreenshotContactImage(taskID: taskID, index: index)
                                },
                                onResumeScreenshot: { task, body in resumeScreenshotContact(task, body: body) },
                                onCancelScreenshot: { task in cancelScreenshotContact(task) },
                                onOpenPerson: onOpenPerson,
                                canRegenerate: !operationState.isSending && !hasBlockingContactProposal
                                    && draft.isEmpty && mediaDrafts.isEmpty
                                    && !voiceInput.isBusy && turn.response.media.isEmpty
                                    && !turn.response.blocks.contains { $0.kind == "screenshot_processing" || $0.kind == "contact_proposal" },
                                onRegenerate: { send(turn.objective) },
                                onFeedback: { feedback in
                                    guard let activeSessionID,
                                          sessionStore.toggleFeedback(
                                            sessionID: activeSessionID,
                                            turnID: turn.id,
                                            feedback: feedback
                                          ) else {
                                        sessionActionError = appLanguage.text("Feedback could not be saved. Try again.")
                                        return
                                    }
                                },
                                onCorrect: answerFeedbackClient == nil ? nil : {
                                    guard let activeSessionID else { return }
                                    answerFeedbackSelection = AnswerFeedbackSelection(sessionID: activeSessionID, turn: turn)
                                },
                                productFeedbackClient: answerFeedbackClient,
                                onFeedbackCorrection: { text in
                                    draft = appLanguage.text("Revise your previous answer using this correction: ", zhHans: "请根据以下纠正修改刚才的回答：") + text
                                    composerFocused = true
                                }
                            )
                            if RunArtifact.canLoadInventory(taskID: turn.response.taskID,
                                manifestID: turn.response.contextManifestID, isCanonical: isCanonical) {
                                RunArtifactsView(taskID: turn.response.taskID, language: appLanguage,
                                    list: { try await workspaceStore.listRunArtifacts(taskID: turn.response.taskID) },
                                    download: { try await workspaceStore.loadRunArtifact(taskID: turn.response.taskID, artifact: $0) })
                            }
                            }
                            .id(item.id)
                            }
                        }
                    }

                    if hasPendingScreenshotAdmission, !operationState.isSending {
                        screenshotAdmissionRecovery
                            .id("ask-screenshot-admission-recovery")
                    }

                    if let contactDraft {
                        ConversationContactProposalTurn(
                            draft: contactDraftBinding(fallback: contactDraft),
                            candidates: contactCandidates,
                            lookupPhase: contactLookupPhase,
                            selectedPersonID: $selectedContactPersonID,
                            selectedContextID: $selectedContactContextID,
                            createDistinct: $createDistinctContact,
                            saveForIdentityReview: $saveContactForIdentityReview,
                            confirmIdentityClue: $confirmContactIdentityClue,
                            hasPendingWrite: pendingContactTarget != nil,
                            isSaving: isSavingContact,
                            saveMessage: contactSaveMessage,
                            errorMessage: contactSaveError,
                            isCanonical: isCanonical,
                            isCurrent: isContactProposalCurrent,
                            language: appLanguage,
                            onConfirm: saveContactProposal,
                            onRetryLookup: {
                                if let current = self.contactDraft { startContactLookup(for: current) }
                            },
                            onCancel: clearContactProposal
                        )
                        .id("contact-proposal-turn")
                    }

                    if let pendingObjective = operationState.pendingObjective {
                        AskPendingTurnView(
                            message: pendingObjective,
                            mediaDrafts: mediaDrafts,
                            language: appLanguage,
                            recallPhase: operationState.relationshipRecallPhase,
                            onChooseCandidate: chooseRecallCandidate,
                            onChangeMatch: changeRecalledRelationship,
                            onContinueWithoutRelationship:
                                continueWithoutRelationship
                        )
                        .id("ask-loading")
                    }

                    if let sourceReviewNotice {
                        Label(
                            sourceReviewNotice,
                            systemImage: "checkmark.shield"
                        )
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, 4)
                        .accessibilityIdentifier("ask-source-review-notice")
                    }

                    if let errorMessage {
                        askFailureCard(errorMessage)
                        .id("ask-error")
                    }

                    if let reviewPreparationError {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "exclamationmark.shield")
                                .foregroundStyle(Color.tsVermilion)
                                .accessibilityHidden(true)
                            Text(reviewPreparationError)
                                .font(.caption)
                                .foregroundStyle(Color.tsInk)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 8)
                            Button(appLanguage.text("Dismiss", zhHans: "关闭")) {
                                self.reviewPreparationError = nil
                            }
                            .font(.caption.weight(.semibold))
                        }
                        .padding(14)
                        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 14))
                        .accessibilityIdentifier("ask-evidence-review-persistence-error")
                    }

                    if !conversationItems.isEmpty {
                        Color.clear
                            .frame(height: usesAccessibilityLayout ? 88 : 24)
                            .accessibilityHidden(true)
                            .id("ask-conversation-reading-clearance")
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 20)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("ask-conversation")
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: conversationItems.count) { _ in
                if let last = conversationItems.last {
                    Task { @MainActor in
                        await Task.yield()
                        proxy.scrollTo(last.id, anchor: .top)
                        try? await Task.sleep(for: .milliseconds(100))
                        if reduceMotion {
                            proxy.scrollTo(last.responseScrollTargetID, anchor: .top)
                        } else {
                            withAnimation(.easeOut(duration: 0.2)) {
                                proxy.scrollTo(last.responseScrollTargetID, anchor: .top)
                            }
                        }
                    }
                }
            }
            .onChange(of: operationState.isSending) { sending in
                guard sending else { return }
                Task { @MainActor in
                    await Task.yield()
                    if reduceMotion {
                        proxy.scrollTo("ask-loading", anchor: .bottom)
                    } else {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo("ask-loading", anchor: .bottom)
                        }
                    }
                }
            }
            .onChange(of: errorMessage) { message in
                guard message != nil else { return }
                Task { @MainActor in
                    await Task.yield()
                    if reduceMotion {
                        proxy.scrollTo("ask-error", anchor: .bottom)
                    } else {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo("ask-error", anchor: .bottom)
                        }
                    }
                }
            }
            .onChange(of: contactDraft?.sourceNote) { sourceNote in
                guard sourceNote != nil else { return }
                Task { @MainActor in
                    await Task.yield()
                    if reduceMotion {
                        proxy.scrollTo("contact-proposal-turn", anchor: .top)
                    } else {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo("contact-proposal-turn", anchor: .top)
                        }
                    }
                }
            }
            .onChange(of: contactLookupPhase) { phase in
                guard case .failed = phase else { return }
                Task { @MainActor in
                    await Task.yield()
                    if reduceMotion {
                        proxy.scrollTo("contact-identity-state", anchor: .bottom)
                    } else {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo("contact-identity-state", anchor: .bottom)
                        }
                    }
                }
            }
        }
    }

    private var starterGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !isCanonical {
                Label(
                    appLanguage.text(
                        dynamicTypeSize.isAccessibilitySize
                            || sizeCategory.isAccessibilityCategory
                            ? "Preview · connect to send"
                            : "Preview data · connect a workspace to send",
                        zhHans: dynamicTypeSize.isAccessibilitySize
                            || sizeCategory.isAccessibilityCategory
                            ? "预览 · 连接后可发送"
                            : "预览数据 · 连接工作区后即可提问"
                    ),
                    systemImage: "eye"
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("ask-preview-send-boundary")
            }
        }
    }

    private func askFailureCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(
                    systemName: errorRecovery.needsSourceAttention
                        ? "exclamationmark.shield"
                        : "exclamationmark.circle"
                )
                .foregroundStyle(Color.tsVermilion)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(
                        screenshotAdmissionCapacityNotice != nil
                            ? appLanguage.text("Session history is full")
                            : errorRecovery.needsSourceAttention
                            ? appLanguage.text("Review one source to continue")
                            : appLanguage.text("This answer did not complete")
                    )
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if isCanonical, screenshotAdmissionCapacityNotice == nil {
                switch errorRecovery {
                case .retry:
                    Button(appLanguage.text("Try again")) {
                        send(draft.isEmpty ? turns.last?.objective ?? "" : draft)
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44, alignment: .leading)
                    .accessibilityIdentifier("ask-retry")
                case let .reviewSource(requirement):
                    Button {
                        Task { await openRecoveryCitation(requirement) }
                    } label: {
                        Label(
                            appLanguage.text("Review exact source"),
                            systemImage: "quote.bubble"
                        )
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44, alignment: .leading)
                    .accessibilityIdentifier("ask-review-required-source")
                case let .openRelationship(personID):
                    Button {
                        onOpenPerson(personID)
                    } label: {
                        Label(
                            appLanguage.text("Open relationship sources"),
                            systemImage: "person.text.rectangle"
                        )
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44, alignment: .leading)
                    .accessibilityIdentifier("ask-open-source-relationship")
                }
            }
        }
        .padding(16)
        .background(
            Color.tsCanvas,
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.tsLine.opacity(0.72), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-error")
    }

    private var composer: some View {
        let controlSize = composerControlSize

        return VStack(spacing: 8) {
            if originalSessionUnavailable {
                VStack(alignment: .leading, spacing: 4) {
                    Text(appLanguage.text("This conversation was deleted. Your draft is kept here.", zhHans: "这条对话已删除。草稿仍保留在这里。"))
                        .font(.caption).foregroundStyle(Color.tsMutedInk)
                    Button(appLanguage.text("Start new Session", zhHans: "开始新对话")) {
                        startNewSessionAfterTombstone()
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("ask-start-new-after-deletion")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("ask-session-deleted")
            }
            askSubmissionStatus
            if !voiceInput.isRecording && voiceInput.phase != .transcribing {
                voiceInputStatus
            }

            if !mediaDrafts.isEmpty, !operationState.isSending {
                AskMediaDraftTray(
                    drafts: mediaDrafts,
                    onRetry: retryMediaDraft,
                    onRemove: removeMediaDraft
                )
            }

            if let mediaNotice, !operationState.isSending {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .accessibilityHidden(true)
                    Text(mediaNotice)
                        .font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                }
                .foregroundStyle(Color.tsMutedInk)
                .accessibilityIdentifier("ask-media-notice")
            }

            if voiceInput.isRecording || voiceInput.phase == .transcribing {
                activeVoiceRibbon
            } else if isNewSessionEntry {
                compactMarkdownComposer
            } else {
                voiceRibbonComposer(controlSize: controlSize)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(Color.tsSurface.opacity(0.98))
        .animation(
            reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.84),
            value: voiceInput.phase
        )
        .onPreferenceChange(VoiceQuickControlFramePreferenceKey.self) { frame in
            if !frame.isEmpty {
                voiceQuickControlFrame = frame
            }
        }
        .onPreferenceChange(VoiceTextInputFramePreferenceKey.self) { frame in
            voiceTextInputFrame = frame
        }
        .overlay {
            AskVoiceHoldSurface(
                inputFrame: voiceTextInputFrame,
                voiceControlFrame: voiceQuickControlFrame,
                draft: draft,
                hasAttachments: !mediaDrafts.isEmpty,
                isComposing: isComposerComposing,
                isDisabled: composerInputDisabled || hasPendingScreenshotAdmission,
                onTapInput: { composerFocused = true },
                onTapVoice: { requestVoiceInput(mode: .locked) },
                onHoldBegan: beginVoiceHold,
                onHoldChanged: updateVoiceHold,
                onHoldEnded: endVoiceHold
            )
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-message-composer")
    }

    private var compactMarkdownComposer: some View {
        VStack(spacing: 0) {
            composerTextInput(
                lineLimit: usesAccessibilityLayout ? 3...7 : 5...9,
                minimumHeight: usesAccessibilityLayout ? 174 : 148,
                horizontalPadding: 16,
                verticalPadding: 14
            )

            Divider()
                .overlay(Color.tsLine.opacity(0.72))
                .padding(.horizontal, 12)

            HStack(spacing: 2) {
                compactPhotoControl

                Divider()
                    .frame(height: 26)
                    .padding(.horizontal, 2)

                markdownButton(
                    symbol: "number",
                    label: appLanguage.text("Heading"),
                    identifier: "ask-markdown-heading"
                ) {
                    insertMarkdownBlock("# ")
                }

                markdownTextButton(
                    text: "B",
                    label: appLanguage.text("Bold"),
                    identifier: "ask-markdown-bold"
                ) {
                    insertMarkdownInline(
                        prefix: "**",
                        suffix: "**",
                        placeholder: appLanguage.text("bold text")
                    )
                }

                markdownButton(
                    symbol: "list.bullet",
                    label: appLanguage.text("Bulleted list"),
                    identifier: "ask-markdown-list"
                ) {
                    insertMarkdownBlock("- ")
                }

                markdownMoreMenu

                Spacer(minLength: 2)

                if hasComposerInput {
                    composerPrimaryControl
                } else {
                    voiceQuickControl
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("ask-markdown-toolbar")
        }
        .frame(
            minHeight: usesAccessibilityLayout ? 246 : 218,
            alignment: .topLeading
        )
        .background(
            Color.tsCanvas,
            in: RoundedRectangle(cornerRadius: 24, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(Color.tsLine, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-expanded-composer")
    }

    private func voiceRibbonComposer(controlSize: CGFloat) -> some View {
        Group {
            if usesAccessibilityLayout {
                VStack(spacing: 4) {
                    composerTextInput(
                        lineLimit: 1...3,
                        minimumHeight: 52,
                        horizontalPadding: 8,
                        verticalPadding: 12
                    )
                    HStack(spacing: 4) {
                        composerAttachmentControl(size: controlSize)
                        Spacer(minLength: 8)
                        voiceQuickControl
                        if hasComposerInput {
                            composerPrimaryControl
                        }
                    }
                }
            } else {
                HStack(alignment: .bottom, spacing: 4) {
                    composerAttachmentControl(size: controlSize)
                    composerTextInput(
                        lineLimit: 1...5,
                        minimumHeight: 52,
                        horizontalPadding: 8,
                        verticalPadding: 12
                    )
                    voiceQuickControl
                    if hasComposerInput {
                        composerPrimaryControl
                    }
                }
            }
        }
        .padding(5)
        .background(
            Color.tsCanvas,
            in: RoundedRectangle(cornerRadius: 28, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(Color.tsLine.opacity(0.88), lineWidth: 1)
        }
        .contentShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .background {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityIdentifier("ask-voice-ribbon")
        }
    }

    private var voiceQuickControl: some View {
        Button {
            guard !voiceHoldActivated, !voiceTapSuppressed else { return }
            requestVoiceInput(mode: .locked)
        } label: {
            ZStack {
                Label(
                    appLanguage.text("Hold to talk"),
                    systemImage: "waveform"
                )
                .labelStyle(.iconOnly)
                .opacity(0.001)
                TalentSignalBrandMark()
                    .frame(width: 24, height: 24)
            }
            .frame(
                width: composerPrimaryControlSize,
                height: composerPrimaryControlSize
            )
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .background {
            GeometryReader { proxy in
                Color.clear.preference(
                    key: VoiceQuickControlFramePreferenceKey.self,
                    value: proxy.frame(in: .global)
                )
            }
        }
        .disabled(composerInputDisabled || !draft.isEmpty || !mediaDrafts.isEmpty || isComposerComposing || hasPendingScreenshotAdmission)
        .opacity(composerInputDisabled || !draft.isEmpty || !mediaDrafts.isEmpty || isComposerComposing || hasPendingScreenshotAdmission ? 0.28 : 1)
        .accessibilityLabel(appLanguage.text("Hold to talk"))
        .accessibilityHint(
            appLanguage.text(
                "Double tap for hands-free voice, or hold and release to create an editable draft."
            )
        )
        .accessibilityIdentifier("ask-voice")
    }

    private var activeVoiceRibbon: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityIdentifier("ask-active-voice-ribbon")
            HStack(alignment: .top, spacing: 12) {
                LivingConnectionMark(
                    phase: voiceInput.isRecording ? .listening : .thinking,
                    size: 30,
                    ink: .tsInk,
                    signal: .tsVermilion,
                    reduceMotion: reduceMotion
                )
                .padding(.top, 2)

                Text(voiceRibbonTranscript)
                    .font(.body)
                    .foregroundStyle(
                        voiceInput.liveTranscript.isEmpty
                            ? Color.tsMutedInk
                            : Color.tsInk
                    )
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, minHeight: 66, alignment: .topLeading)
                    .contentTransition(.interpolate)
                    .accessibilityIdentifier("ask-voice-live-transcript")
            }
            .padding(.horizontal, 16)
            .padding(.top, 15)
            .padding(.bottom, 10)

            VoiceListeningVisualizer()
                .frame(height: 18)
                .mask(alignment: .center) {
                    Rectangle().frame(height: 18)
                }
                .opacity(voiceInput.isRecording ? 1 : 0.42)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(Color.tsVermilion.opacity(0.78))
                        .frame(height: 1)
                }

            HStack(spacing: 8) {
                if case let .recording(startedAt) = voiceInput.phase {
                    Text(startedAt, style: .timer)
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                        .frame(minWidth: 42, alignment: .leading)
                }

                Text(voiceRibbonHint)
                    .font(.caption2)
                    .foregroundStyle(Color.tsMutedInk)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    cancelVoiceInput()
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(appLanguage.text("Cancel"))
                .accessibilityIdentifier("ask-voice-cancel")

                Button {
                    finishVoiceInputForReview()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Color.tsSurface)
                        .frame(width: 44, height: 44)
                        .background(Color.tsVermilion, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(!voiceInput.isRecording)
                .opacity(voiceInput.isRecording ? 1 : 0.42)
                .accessibilityLabel(
                    appLanguage.text(
                        "Stop and review transcript"
                    )
                )
                .accessibilityIdentifier("ask-voice-stop")
            }
            .padding(.leading, 16)
            .padding(.trailing, 8)
            .padding(.vertical, 6)
        }
        .background(
            Color.tsCanvas,
            in: RoundedRectangle(cornerRadius: 24, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(
                    voiceRibbonMode == .cancelling
                        ? Color.tsVermilion.opacity(0.68)
                        : Color.tsLine,
                    lineWidth: 1
                )
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private var voiceRibbonTranscript: String {
        if voiceInput.phase == .transcribing {
            return appLanguage.text("Finalizing transcript…")
        }
        let live = voiceInput.liveTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        if !live.isEmpty { return live }
        return appLanguage.text("Listening…")
    }

    private var voiceRibbonHint: String {
        if voiceInput.phase == .transcribing {
            return ""
        }
        switch voiceRibbonMode {
        case .pressToDraft:
            return appLanguage.text(
                "Release to review · up to lock · left to cancel"
            )
        case .locked:
            return appLanguage.text(
                "Hands-free · tap stop to review"
            )
        case .cancelling:
            return appLanguage.text("Release to cancel")
        case .idle:
            return appLanguage.text("Release to review")
        }
    }

    private func composerTextInput(
        lineLimit: ClosedRange<Int>,
        minimumHeight: CGFloat,
        horizontalPadding: CGFloat,
        verticalPadding: CGFloat
    ) -> some View {
        TextField(
            composerPlaceholder,
            text: $draft,
            axis: .vertical
        )
        .focused($composerFocused)
        .lineLimit(lineLimit)
        .submitLabel(.send)
        .onSubmit {
            guard hasComposerInput, !composerPrimaryDisabled else { return }
            composerPrimaryAction()
        }
        .disabled(composerInputDisabled || hasPendingScreenshotAdmission)
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
        .frame(
            maxWidth: .infinity,
            minHeight: minimumHeight,
            alignment: .topLeading
        )
        .background {
            AskIMECompositionMonitor(
                isEnabled: composerFocused && !composerInputDisabled
            ) { composing in
                guard isComposerComposing != composing else { return }
                isComposerComposing = composing
                AskInputDiagnostics.compositionChanged(
                    isComposing: composing
                )
                if !composing {
                    scheduleDraftPersistence(draft)
                }
            }
            .frame(width: 0, height: 0)
        }
        .background {
            GeometryReader { proxy in
                Color.clear.preference(
                    key: VoiceTextInputFramePreferenceKey.self,
                    value: proxy.frame(in: .global)
                )
            }
        }
        .accessibilityHint(appLanguage.text("When empty, hold anywhere in the input to talk. Release to review your words before sending."))
        .accessibilityIdentifier("ask-composer")
    }

    private var composerInputDisabled: Bool {
        voiceInput.isBusy
            || operationState.isSending
            || hasBlockingContactProposal
            || operationState.pendingObjective != nil
    }

    private var compactPhotoControl: some View {
        Button {
            composerFocused = false
            isPhotoLibraryPresented = true
        } label: {
            Image(systemName: "photo")
                .font(.system(size: 17, weight: .semibold))
                .frame(width: markdownControlSize, height: markdownControlSize)
                .fixedSize()
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(width: markdownControlSize, height: markdownControlSize)
        .fixedSize()
        .layoutPriority(1)
        .disabled(composerInputDisabled || mediaDrafts.count >= 10)
        .accessibilityLabel(appLanguage.text("Add photo"))
        .accessibilityIdentifier("ask-markdown-photo")
    }

    private func markdownButton(
        symbol: String,
        label: String,
        identifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .frame(width: markdownControlSize, height: markdownControlSize)
                .fixedSize()
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(width: markdownControlSize, height: markdownControlSize)
        .fixedSize()
        .layoutPriority(1)
        .disabled(composerInputDisabled)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
    }

    private func markdownTextButton(
        text: String,
        label: String,
        identifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(text)
                .font(.title3.weight(.bold))
                .frame(width: markdownControlSize, height: markdownControlSize)
                .fixedSize()
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(width: markdownControlSize, height: markdownControlSize)
        .fixedSize()
        .layoutPriority(1)
        .disabled(composerInputDisabled)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
    }

    private var markdownMoreMenu: some View {
        Menu {
            Button {
                insertMarkdownBlock("> ")
            } label: {
                Label(appLanguage.text("Quote"), systemImage: "text.quote")
            }
            Button {
                insertMarkdownBlock("- [ ] ")
            } label: {
                Label(appLanguage.text("Task list"), systemImage: "checklist")
            }
            Button {
                insertMarkdownInline(
                    prefix: "`",
                    suffix: "`",
                    placeholder: appLanguage.text("code")
                )
            } label: {
                Label(
                    appLanguage.text("Inline code"),
                    systemImage: "chevron.left.forwardslash.chevron.right"
                )
            }
            Button {
                insertMarkdownInline(
                    prefix: "[",
                    suffix: "](https://)",
                    placeholder: appLanguage.text("link label")
                )
            } label: {
                Label(appLanguage.text("Link"), systemImage: "link")
            }
            Button {
                insertMarkdownBlock("---")
            } label: {
                Label(appLanguage.text("Divider"), systemImage: "minus")
            }
            Divider()
            Button {
                composerFocused = false
                isFileImporterPresented = true
            } label: {
                Label(appLanguage.text("Image from Files"), systemImage: "folder")
            }
            Button {
                requestRelationshipScope()
            } label: {
                Label(
                    appLanguage.text("Link a relationship", zhHans: "关联关系"),
                    systemImage: "person.crop.circle.badge.plus"
                )
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 17, weight: .semibold))
                .frame(width: markdownControlSize, height: markdownControlSize)
                .fixedSize()
                .contentShape(Rectangle())
        }
        .frame(width: markdownControlSize, height: markdownControlSize)
        .fixedSize()
        .layoutPriority(1)
        .disabled(composerInputDisabled)
        .accessibilityLabel(appLanguage.text("More Markdown and attachment options"))
        .accessibilityIdentifier("ask-markdown-more")
    }

    private func insertMarkdownBlock(_ marker: String) {
        let separator = draft.isEmpty || draft.hasSuffix("\n") ? "" : "\n"
        draft += "\(separator)\(marker)"
        composerFocused = true
    }

    private func insertMarkdownInline(
        prefix: String,
        suffix: String,
        placeholder: String
    ) {
        let separator = draft.isEmpty || draft.last?.isWhitespace == true ? "" : " "
        draft += "\(separator)\(prefix)\(placeholder)\(suffix)"
        composerFocused = true
    }

    private var composerPrimaryControl: some View {
        Button(action: composerPrimaryAction) {
            Group {
                if voiceInput.phase == .transcribing {
                    ProgressView()
                        .tint(Color.tsSurface)
                } else {
                    Image(systemName: composerPrimarySymbol)
                        .font(.system(size: 17, weight: .semibold))
                }
            }
            .foregroundStyle(composerPrimaryForeground)
            .frame(
                width: composerPrimaryControlSize,
                height: composerPrimaryControlSize
            )
            .fixedSize()
            .background(composerPrimaryBackground, in: Circle())
            .overlay {
                VoiceRecordButtonHalo(isActive: voiceInput.isRecording)
            }
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .frame(
            width: composerPrimaryControlSize,
            height: composerPrimaryControlSize
        )
        .fixedSize()
        .layoutPriority(1)
        .disabled(composerPrimaryDisabled)
        .opacity(composerPrimaryDisabled ? 0.35 : 1)
        .accessibilityLabel(composerPrimaryAccessibilityLabel)
        .accessibilityIdentifier(
            voiceInput.isRecording
                ? "ask-voice"
                : (hasComposerInput ? "ask-send" : "ask-voice")
        )
        .accessibilityHint(composerPrimaryAccessibilityHint)
    }

    @ViewBuilder
    private func composerAttachmentControl(size: CGFloat) -> some View {
        Menu {
            Button {
                composerFocused = false
                isPhotoLibraryPresented = true
            } label: {
                Label(
                    appLanguage.text("Photos"),
                    systemImage: "photo.on.rectangle"
                )
            }
            Button {
                composerFocused = false
                isFileImporterPresented = true
            } label: {
                Label(
                    appLanguage.text("Image from Files"),
                    systemImage: "folder"
                )
            }
            Divider()
            Button {
                requestRelationshipScope()
            } label: {
                Label(
                    appLanguage.text("Link a relationship", zhHans: "关联关系"),
                    systemImage: "person.crop.circle.badge.plus"
                )
            }
        } label: {
                composerAttachmentIcon(size: size)
        }
        .disabled(
            voiceInput.isBusy
                || operationState.isSending
                || hasBlockingContactProposal
                || mediaDrafts.count >= 10
        )
        .accessibilityLabel(appLanguage.text("Add to this message"))
        .accessibilityHint(
            appLanguage.text(
                "Add task images or link a relationship. Attachments remain proposals, not reviewed evidence."
            )
        )
        .accessibilityIdentifier("ask-attachment-menu")
    }

    nonisolated private func composerAttachmentIcon(size: CGFloat) -> some View {
        Image(systemName: "paperclip")
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Color.tsInk)
            .frame(width: size, height: size)
            .background(Color.tsCanvas, in: Circle())
    }

    private var composerControlSize: CGFloat {
        dynamicTypeSize.isAccessibilitySize || sizeCategory.isAccessibilityCategory
            ? 52
            : 44
    }

    @ViewBuilder
    private var askSubmissionStatus: some View {
        switch operationState.askSubmissionPhase {
        case .idle:
            EmptyView()
        case .routingLocally, .requestingWorkspaceAnswer:
            HStack(spacing: 8) {
                LivingConnectionMark(
                    phase: .thinking,
                    size: 24,
                    ink: .tsInk,
                    signal: .tsVermilion,
                    reduceMotion: reduceMotion
                )
                Capsule(style: .continuous)
                    .fill(Color.tsInk.opacity(reduceMotion ? 0.28 : 0.16))
                    .frame(width: 22, height: 2)
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 4)
            .frame(minHeight: 32)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                operationState.askSubmissionPhase == .routingLocally
                    ? appLanguage.text(
                        "Finding the relationship on this device. Nothing has been sent."
                    )
                    : appLanguage.text(
                        "The question was sent to the governed workspace. Waiting for verified readback."
                    )
            )
            .accessibilityIdentifier(
                operationState.askSubmissionPhase == .routingLocally
                    ? "ask-submission-routing"
                    : "ask-submission-requesting"
            )
        }
    }

    private var composerPrimaryControlSize: CGFloat {
        max(52, composerControlSize)
    }

    private var markdownControlSize: CGFloat {
        48
    }

    @ViewBuilder
    private var voiceInputStatus: some View {
        switch voiceInput.phase {
        case .idle:
            EmptyView()
        case .requestingPermission:
            HStack(spacing: 10) {
                ProgressView()
                Text(appLanguage.text("Waiting for microphone permission…"))
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                Spacer(minLength: 8)
            }
            .accessibilityIdentifier("ask-voice-requesting-permission")
        case .recording, .transcribing:
            EmptyView()
        case let .failed(message):
            HStack(alignment: .top, spacing: 10) {
                LivingConnectionMark(
                    phase: .failed,
                    size: 24,
                    ink: .tsInk,
                    signal: .tsVermilion,
                    reduceMotion: true
                )
                    .accessibilityHidden(true)
                Text(
                    voiceInput.microphonePermission == .denied
                        ? appLanguage.text("Microphone is off")
                        : appLanguage.text("Didn't catch that")
                )
                    .font(.caption)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("ask-voice-failed")
                    .accessibilityLabel(appLanguage.text(message))
                Spacer(minLength: 8)
                if voiceInput.microphonePermission == .denied {
                    Button(appLanguage.text("Settings")) {
                        guard let url = URL(
                            string: UIApplication.openSettingsURLString
                        ) else { return }
                        openURL(url)
                    }
                    .font(.caption.weight(.semibold))
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("ask-voice-open-settings")
                } else {
                    Button(appLanguage.text("Dismiss")) {
                        voiceInput.dismissFailure()
                    }
                    .font(.caption.weight(.semibold))
                    .frame(minHeight: 44)
                }
            }
        }
    }

    private var composerPrimarySymbol: String {
        if operationState.isSending { return "arrow.up" }
        if voiceInput.isRecording { return "stop.fill" }
        return hasComposerInput ? "arrow.up" : "mic.fill"
    }

    private var composerPrimaryForeground: Color {
        if voiceInput.isRecording || hasComposerInput { return .tsSurface }
        return .tsInk
    }

    private var composerPrimaryBackground: Color {
        if voiceInput.isRecording { return .tsVermilion }
        if hasComposerInput { return .tsInk }
        return .tsSurfaceMuted
    }

    private var composerPrimaryDisabled: Bool {
        if hasBlockingContactProposal { return true }
        if operationState.pendingObjective != nil { return true }
        if voiceInput.isRecording { return false }
        if voiceInput.phase == .transcribing
            || voiceInput.phase == .requestingPermission {
            return true
        }
        if hasComposerInput { return !canSendDraft }
        return operationState.isSending
    }

    private var composerPrimaryAccessibilityLabel: String {
        if hasBlockingContactProposal {
            return appLanguage.text("Finish reviewing the contact first")
        }
        if operationState.isSending {
            return appLanguage.text("Reading the record…")
        }
        if voiceInput.isRecording {
            return appLanguage.text(
                "Stop and review transcript"
            )
        }
        if hasComposerInput {
            return appLanguage.text("Send", zhHans: "发送")
        }
        if voiceTranscriber == nil { return appLanguage.text("Record voice") }
        return appLanguage.text("Hold to talk")
    }

    private var composerPrimaryAccessibilityHint: String {
        if voiceInput.isRecording {
            return appLanguage.text(
                "Stops recording and creates an editable transcript. Nothing is sent until you tap Send."
            )
        }
        if hasComposerInput {
            return selectedScope == nil
                ? appLanguage.text(
                    "Agent may search your account contacts when this message needs relationship context.",
                    zhHans: "如果这条消息需要关系上下文，Agent 可能会搜索你的账户联系人。"
                )
                : ""
        }
        guard voiceTranscriber != nil else { return "" }
        return appLanguage.text(
            "Starts foreground voice input. Release to review, slide up to continue hands-free, or slide left to cancel."
        )
    }

    private func composerPrimaryAction() {
        if isComposerComposing {
            // Send is a clear request to commit the current IME candidate.
            // UIKit publishes the final text when focus resigns; the
            // composition observer continues this exact send afterwards.
            shouldSendAfterCompositionCommits = true
            composerFocused = false
            return
        }
        if voiceInput.isRecording {
            finishVoiceInputForReview()
            return
        }
        if hasComposerInput {
            send(draft)
            return
        }
        requestVoiceInput(mode: .locked)
    }

    private func requestVoiceInput(mode: VoiceRibbonMode = .locked) {
        guard voiceTranscriber != nil else {
            voiceInput.reportUnavailable()
            return
        }
        guard draft.isEmpty, mediaDrafts.isEmpty, !isComposerComposing, !composerInputDisabled,
              !hasPendingScreenshotAdmission else { return }
        voiceRibbonMode = mode
        guard hasAcceptedVoiceDisclosure else {
            voiceRibbonMode = .locked
            isVoiceDisclosurePresented = true
            return
        }
        voiceHaptic(.soft)
        startVoiceInput(mode: mode)
    }

    private func startVoiceInput(mode: VoiceRibbonMode = .locked) {
        guard let voiceTranscriber else { return }
        voiceRibbonMode = mode
        voiceStopRequested = false
        composerFocused = false
        voiceInput.dismissFailure()
        voiceOperation?.cancel()
        voiceOperation = Task {
            await voiceInput.start(
                sceneIsActive: scenePhase == .active,
                locale: appLanguage.locale,
                transcriber: voiceTranscriber
            )
            voiceOperation = nil
        }
    }

    private func cancelVoiceInput() {
        voiceHaptic(.light)
        voiceReleasePending = false
        voiceStopRequested = false
        voiceRibbonMode = .idle
        voiceHoldActivated = false
        voiceOperation?.cancel()
        voiceOperation = nil
        voiceInput.cancel()
    }

    private func finishVoiceInputForReview() {
        guard voiceInput.isRecording, !voiceStopRequested else { return }
        voiceStopRequested = true
        voiceHaptic(.rigid)
        voiceReleasePending = false
        voiceRibbonMode = .idle
        voiceHoldActivated = false
        voiceOperation?.cancel()
        voiceOperation = Task {
            await voiceInput.stopAndTranscribe()
            voiceOperation = nil
            voiceStopRequested = false
        }
    }

    private func beginVoiceHold() {
        guard draft.isEmpty, mediaDrafts.isEmpty, !isComposerComposing,
              !composerInputDisabled, !hasPendingScreenshotAdmission else { return }
        voiceHoldActivated = true
        voiceTapSuppressed = true
        voiceGestureStartedInControl = true
        voiceRibbonMode = .pressToDraft
        requestVoiceInput(mode: .pressToDraft)
    }

    private func updateVoiceHold(_ translation: CGSize) {
        guard voiceHoldActivated else { return }
        if translation.width <= -72 {
            voiceRibbonMode = .cancelling
        } else if translation.height <= -56 {
            voiceRibbonMode = .locked
        } else {
            voiceRibbonMode = .pressToDraft
        }
    }

    private func endVoiceHold(cancelled: Bool) {
        guard voiceGestureStartedInControl else { return }
        voiceGestureStartedInControl = false
        guard voiceHoldActivated else { return }
        voiceHoldActivated = false
        defer { voiceTapSuppressed = false }
        if cancelled {
            cancelVoiceInput()
            return
        }
        switch voiceRibbonMode {
        case .cancelling:
            cancelVoiceInput()
        case .locked:
            voiceHaptic(.soft)
        case .pressToDraft, .idle:
            if voiceInput.isRecording {
                finishVoiceInputForReview()
            } else if voiceInput.phase == .requestingPermission {
                voiceReleasePending = true
            } else {
                // First-use permission may outlive the gesture. Its explicit
                // confirmation owns a hands-free start after this touch ends.
                voiceRibbonMode = .locked
            }
        }
    }

    private func voiceHaptic(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
        let generator = UIImpactFeedbackGenerator(style: style)
        generator.prepare()
        generator.impactOccurred()
    }

    private func insertVoiceTranscript(_ transcript: String) {
        let current = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = current.isEmpty ? transcript : "\(current) \(transcript)"
        composerFocused = true
    }

    private func scheduleDraftPersistence(_ value: String) {
        draftPersistenceTask?.cancel()
        draftPersistenceTask = Task {
            do {
                try await Task.sleep(for: .milliseconds(350))
            } catch {
                return
            }
            guard !Task.isCancelled,
                  !operationState.isSending,
                  !isComposerComposing,
                  draft == value else { return }
            persistDraft(value)
            draftPersistenceTask = nil
        }
    }

    private func flushDraftPersistence() {
        draftPersistenceTask?.cancel()
        draftPersistenceTask = nil
        guard !operationState.isSending, !isComposerComposing else { return }
        persistDraft(draft)
    }

    private func persistDraft(_ value: String) {
        if let activeSessionID {
            _ = sessionStore.saveDraft(value, sessionID: activeSessionID)
        } else if let selectedScope {
            sessionStore.saveDraft(
                value,
                personID: selectedScope.person.id,
                relationshipContextID: selectedScope.context.id
            )
        } else if activeSessionID == nil,
                  initialSeed == nil,
                  contactDraft == nil {
            sessionStore.saveGlobalDraft(value)
        }
    }

    private var isNewSessionEntry: Bool {
        sessionID == nil
            && activeSessionID == nil
            && initialSeed == nil
            && contactDraft == nil
            && screenshotContactTask == nil
            && preferredPersonID == nil
            && selectedScope == nil
            && !isChoosingScope
            && !operationState.isSending
            && !isRequestingScope
            && errorMessage == nil
            && reviewPreparationError == nil
    }

    private var newSessionHeader: some View {
        HStack(spacing: 10) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.medium))
                    .frame(width: 48, height: 48)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(appLanguage.text("Close", zhHans: "关闭"))
            .accessibilityIdentifier("ask-close")

            Spacer(minLength: 0)

            Text(appLanguage.text("New Session", zhHans: "新会话"))
                .font(.headline)
                .foregroundStyle(Color.tsInk)
                .lineLimit(1)

            Spacer(minLength: 0)

            Color.clear
                .frame(width: 48, height: 48)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 12)
        .padding(.top, usesAccessibilityLayout ? 2 : 6)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-new-session-header")
    }

    private var sessionMenu: some View {
        Menu {
            if let activeSessionID {
                Button {
                    shareReviewSessionID = ShareReviewTarget(id: activeSessionID)
                } label: {
                    Label(appLanguage.text("Share Session"), systemImage: "square.and.arrow.up")
                }
                .accessibilityIdentifier("ask-share-session")
                Button {
                    forkCurrentSession()
                } label: {
                    Label(appLanguage.text("Fork Session"), systemImage: "arrow.triangle.branch")
                }
                .disabled(operationState.isSending || voiceInput.isBusy || hasBlockingContactProposal || hasPendingScreenshotAdmission)
                .accessibilityIdentifier("ask-fork-session")
            }
            if isCanonical {
                Button { showScreenshotHistory = true } label: {
                    Label(appLanguage.text("Screenshot history"), systemImage: "photo.stack")
                }
                .accessibilityIdentifier("screenshot-contact-history")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.body.weight(.medium))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(appLanguage.text("Session actions"))
        .accessibilityIdentifier("ask-session-menu")
    }

    private func forkCurrentSession() {
        guard let activeSessionID, !operationState.isSending, !hasBlockingContactProposal,
              let forkID = sessionStore.forkSession(activeSessionID) else {
            sessionActionError = appLanguage.text("The Session could not be forked. Try again.")
            return
        }
        flushDraftPersistence()
        self.activeSessionID = forkID
        _ = sessionStore.saveDraft(draft, sessionID: forkID)
        errorMessage = nil
        screenshotTasks = [:]
        screenshotContactTask = nil
        sessionStore.markRead(forkID)
        Task { await restoreScreenshotTasks() }
        sourceReviewNotice = sessionStore.session(id: forkID)?.contextWasTrimmed == true
            ? appLanguage.text("A recent portion of this Session was copied. The complete history remains in the original Session.")
            : appLanguage.text("Session fork created. Continue here.")
    }

    private var usesAccessibilityLayout: Bool {
        dynamicTypeSize.isAccessibilitySize || sizeCategory.isAccessibilityCategory
    }

    private var homeAttachmentChooser: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(appLanguage.text("ADD TO MESSAGE"))
                    .font(.caption2.weight(.bold))
                    .tracking(1.15)
                    .foregroundStyle(Color.tsVermilion)
                Text(
                    appLanguage.text("Choose a source first.")
                )
                .font(.custom("Georgia", size: 30, relativeTo: .title2))
                .foregroundStyle(Color.tsInk)
                .tracking(-0.45)
                .padding(.top, 8)
                Text(
                    appLanguage.text(
                        "Nothing is imported until you make a choice."
                    )
                )
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
                .padding(.top, 7)

                VStack(spacing: 10) {
                    homeAttachmentChoice(
                        title: appLanguage.text("Photos"),
                        detail: appLanguage.text("Choose one or more images"),
                        symbol: "photo.on.rectangle",
                        identifier: "home-attachment-photos"
                    ) {
                        composerFocused = false
                        isHomeAttachmentChooserPresented = false
                        isPhotoLibraryPresented = true
                    }
                    homeAttachmentChoice(
                        title: appLanguage.text("Image files"),
                        detail: appLanguage.text(
                            "Browse JPEG, PNG, WebP, GIF, HEIC, or HEIF"
                        ),
                        symbol: "folder",
                        identifier: "home-attachment-files"
                    ) {
                        composerFocused = false
                        isHomeAttachmentChooserPresented = false
                        isFileImporterPresented = true
                    }
                    homeAttachmentChoice(
                        title: appLanguage.text("Link a relationship"),
                        detail: appLanguage.text(
                            "Choose the Person and Pursuit context"
                        ),
                        symbol: "person.crop.circle.badge.plus",
                        identifier: "home-attachment-relationship"
                    ) {
                        isHomeAttachmentChooserPresented = false
                        requestRelationshipScope()
                    }
                }
                .padding(.top, 22)

                Button {
                    isHomeAttachmentChooserPresented = false
                    Task { @MainActor in
                        await Task.yield()
                        composerFocused = true
                    }
                } label: {
                    Label(
                        appLanguage.text("Write text or Markdown instead"),
                        systemImage: "square.and.pencil"
                    )
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.tsInk)
                .padding(.top, 10)
                .accessibilityIdentifier("home-attachment-write")
            }
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .padding(.bottom, 28)
        }
        .background(Color.tsSurface.ignoresSafeArea())
        .accessibilityIdentifier("home-attachment-chooser")
    }

    private func homeAttachmentChoice(
        title: String,
        detail: String,
        symbol: String,
        identifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: symbol)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                    .frame(width: 44, height: 44)
                    .background(Color.tsSurface, in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsMutedInk)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, minHeight: 68, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 18))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title). \(detail)")
        .accessibilityIdentifier(identifier)
    }

    @ViewBuilder
    private var compactComposerContext: some View {
        if let selectedScope {
            Button {
                requestRelationshipScope()
            } label: {
                HStack(spacing: 8) {
                    Circle()
                        .fill(Color.tsVermilion.opacity(0.14))
                        .frame(width: 24, height: 24)
                        .overlay {
                            Text(initials(selectedScope.person.displayLabel))
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(Color.tsVermilion)
                        }
                        .accessibilityHidden(true)
                    Text(selectedScope.person.displayLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                        .lineLimit(1)
                    Text(selectedScope.context.displayLabel)
                        .font(.caption2)
                        .foregroundStyle(Color.tsMutedInk)
                        .lineLimit(1)
                    Spacer(minLength: 6)
                    Image(systemName: "chevron.down")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.tsMutedInk)
                }
                .frame(minHeight: 32)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 18)
            .accessibilityLabel(
                appLanguage.text(
                    "Selected relationship",
                    zhHans: "已选择的关系"
                )
            )
            .accessibilityValue(
                "\(selectedScope.person.displayLabel), \(selectedScope.context.displayLabel)"
            )
            .accessibilityHint(
                appLanguage.text(
                    "Choose a different person or relationship."
                )
            )
            .accessibilityIdentifier("ask-scope-selector")
        }
    }

    private var currentSnapshot: PursuitWorkspaceSnapshot {
        workspaceStore.snapshot ?? snapshot
    }

    private var availableScopes: [AskScope] {
        currentSnapshot.people.flatMap { person in
            person.contexts.map { context in
                AskScope(person: person, context: context)
            }
        }
    }

    private var trimmedDraft: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var hasComposerInput: Bool {
        !trimmedDraft.isEmpty || !mediaDrafts.isEmpty
    }

    private var composerPlaceholder: String {
        if hasPendingScreenshotAdmission {
            return appLanguage.text("Reattach the same screenshots to continue")
        }
        if hasBlockingContactProposal {
            return appLanguage.text("Finish reviewing the contact first")
        }
        if contactSaveMessage != nil, selectedScope == nil {
            return appLanguage.text("Add another contact…")
        }
        if isNewSessionEntry {
            return appLanguage.text("Ask about anyone or anything…")
        }
        return appLanguage.text("Reply…")
    }

    private var isContactProposalCurrent: Bool {
        guard let contactOperationKey else { return false }
        return sessionStore.isContactProposalCurrent(
            sessionID: activeSessionID, idempotencyKey: contactOperationKey
        )
    }

    private var endedContactProposalMessage: String {
        appLanguage.text("This proposal has ended. Its source remains in the Session. Send a new message to review a current proposal.")
    }

    private var hasBlockingContactProposal: Bool {
        contactDraft != nil && contactSaveMessage == nil
    }

    private var shouldShowScopeBar: Bool {
        operationState.pendingObjective == nil
            && (selectedScope != nil || isRequestingScope || isChoosingScope)
    }

    private var isResolvingPreferredPerson: Bool {
        guard let preferredPersonID else { return false }
        return selectedScope?.person.id != preferredPersonID
    }

    /// The original durable Session was removed (tombstoned): the draft is
    /// preserved for the user's decision and sending is disabled. Only the
    /// explicit Start-new-Session action may create or rebind a conversation.
    private var originalSessionUnavailable: Bool {
        return AskSendAvailability.originalSessionUnavailable(
            activeSessionID: activeSessionID,
            sessionExists: activeSessionID.map { sessionStore.session(id: $0) != nil } ?? false
        )
    }

    private var canSendDraft: Bool {
        return AskSendAvailability.canSendDraft(
            hasComposerInput: hasComposerInput,
            isSending: operationState.isSending,
            isSavingContact: isSavingContact,
            originalSessionUnavailable: originalSessionUnavailable
        )
            && mediaDrafts.allSatisfy {
                if case .failed = $0.phase { return false }
                return $0.phase != .removing
            }
    }

    private var filteredScopes: [AskScope] {
        let allowedScopes = preferredPersonID.map { preferredPersonID in
            availableScopes.filter { $0.person.id == preferredPersonID }
        } ?? availableScopes
        let needle = scopeQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return allowedScopes }
        return allowedScopes.filter {
            $0.person.displayLabel.localizedCaseInsensitiveContains(needle)
                || $0.context.displayLabel.localizedCaseInsensitiveContains(needle)
        }
    }

    private var turns: [AgentSessionTurn] {
        sessionStore.session(id: activeSessionID)?.turns ?? []
    }

    private var conversationItems: [AgentConversationItem] {
        guard let session = sessionStore.session(id: activeSessionID) else {
            return []
        }
        let receiptItems = session.contactReceipts.map(AgentConversationItem.contactReceipt)
        return (receiptItems + session.turns.map(AgentConversationItem.ask))
            .sorted { lhs, rhs in
                lhs.createdAt == rhs.createdAt
                    ? lhs.id < rhs.id
                    : lhs.createdAt < rhs.createdAt
            }
    }

    private func openPersonAction(
        for receipt: AgentContactReceipt
    ) -> (() -> Void)? {
        guard let personID = receipt.currentPerson(in: currentSnapshot)?.id else {
            return nil
        }
        return { onOpenPerson(personID) }
    }

    private func importSelectedPhotos(_ items: [PhotosPickerItem]) {
        mediaImportTask?.cancel()
        mediaImportTask = Task {
            defer {
                selectedPhotoItems = []
                mediaImportTask = nil
            }
            let remaining = max(0, 10 - mediaDrafts.count)
            guard remaining > 0 else {
                mediaNotice = appLanguage.text("Ten images is the limit for one Ask.")
                return
            }
            if items.count > remaining {
                mediaNotice = appLanguage.text(
                    "Only the first \(remaining) selected images were added.",
                    zhHans: "仅添加了所选图片中的前 \(remaining) 张。"
                )
            }
            for (offset, item) in items.prefix(remaining).enumerated() {
                if Task.isCancelled { return }
                do {
                    guard var data = try await item.loadTransferable(type: Data.self),
                          var preview = UIImage(data: data) else {
                        throw PursuitWorkspaceClientError.invalidResponse
                    }
                    var mediaType = item.supportedContentTypes
                        .compactMap(\.preferredMIMEType)
                        .first(where: Self.allowedChatMediaTypes.contains)
                    var fileExtension = item.supportedContentTypes
                        .compactMap(\.preferredFilenameExtension)
                        .first
                    if mediaType == nil || !["image/png", "image/jpeg", "image/webp"].contains(mediaType ?? "") {
                        guard let converted = preview.jpegData(compressionQuality: 0.9) else {
                            throw PursuitWorkspaceClientError.invalidResponse
                        }
                        data = converted
                        preview = UIImage(data: converted) ?? preview
                        mediaType = "image/jpeg"
                        fileExtension = "jpg"
                    }
                    guard !data.isEmpty, data.count <= 8_388_608 else {
                        mediaNotice = appLanguage.text("One image was larger than 8 MB and was not added.")
                        continue
                    }
                    appendMediaDraft(
                        data: data,
                        preview: preview,
                        fileName: "ask-photo-\(mediaDrafts.count + offset + 1).\(fileExtension ?? "image")",
                        mediaType: mediaType ?? "image/jpeg"
                    )
                } catch is CancellationError {
                    return
                } catch {
                    mediaNotice = appLanguage.text("One selected image could not be read; the rest are unchanged.")
                }
            }
        }
    }

    private func importSelectedImageFiles(_ result: Result<[URL], Error>) {
        guard case let .success(urls) = result else {
            mediaNotice = appLanguage.text(
                "The selected file could not be opened. Your message is unchanged."
            )
            return
        }
        mediaImportTask?.cancel()
        mediaImportTask = Task {
            defer { mediaImportTask = nil }
            let remaining = max(0, 10 - mediaDrafts.count)
            for url in urls.prefix(remaining) {
                if Task.isCancelled { return }
                let accessed = url.startAccessingSecurityScopedResource()
                defer {
                    if accessed { url.stopAccessingSecurityScopedResource() }
                }
                do {
                    let data = try Data(contentsOf: url, options: [.mappedIfSafe])
                    guard !data.isEmpty,
                          data.count <= 8_388_608,
                          let preview = UIImage(data: data) else {
                        mediaNotice = appLanguage.text(
                            "One file was not a supported image or was larger than 8 MB."
                        )
                        continue
                    }
                    let originalType = (try? url.resourceValues(
                        forKeys: [.contentTypeKey]
                    ).contentType)?.preferredMIMEType
                    let normalizedData: Data
                    let normalizedName: String
                    let mediaType: String
                    if let originalType,
                       ["image/png", "image/jpeg", "image/webp"].contains(originalType) {
                        normalizedData = data
                        normalizedName = url.lastPathComponent
                        mediaType = originalType
                    } else if let jpeg = preview.jpegData(compressionQuality: 0.9) {
                        normalizedData = jpeg
                        normalizedName = "\(url.deletingPathExtension().lastPathComponent).jpg"
                        mediaType = "image/jpeg"
                    } else {
                        continue
                    }
                    appendMediaDraft(
                        data: normalizedData,
                        preview: preview,
                        fileName: normalizedName,
                        mediaType: mediaType
                    )
                } catch {
                    mediaNotice = appLanguage.text(
                        "One image file could not be read; the rest are unchanged."
                    )
                }
            }
        }
    }

    private func appendMediaDraft(
        data: Data,
        preview: UIImage,
        fileName: String,
        mediaType: String
    ) {
        let id = UUID()
        let scale = preview.scale
        let mediaDraft = AskMediaDraft(
            id: id,
            data: data,
            preview: preview,
            fileName: fileName,
            mediaType: mediaType,
            width: max(1, Int(preview.size.width * scale)),
            height: max(1, Int(preview.size.height * scale)),
            remoteAsset: nil,
            phase: .waitingForContext
        )
        mediaDrafts.append(mediaDraft)
        mediaNotice = nil
        if let selectedScope, !hasPendingScreenshotAdmission {
            uploadMediaDraft(id, scope: selectedScope)
        }
    }

    private func rebindMediaDrafts(to scope: AskScope) {
        let priorMediaIDs = mediaDrafts.compactMap { $0.remoteAsset?.id }
        for index in mediaDrafts.indices {
            mediaDrafts[index].remoteAsset = nil
            mediaDrafts[index].phase = .uploading
        }
        Task {
            for mediaID in priorMediaIDs {
                try? await workspaceStore.deleteChatMedia(id: mediaID)
            }
            for id in mediaDrafts.map(\.id) {
                uploadMediaDraft(id, scope: scope)
            }
        }
    }

    private func uploadMediaDraft(_ id: UUID, scope: AskScope? = nil) {
        guard let index = mediaDrafts.firstIndex(where: { $0.id == id }),
              let resolvedScope = scope ?? selectedScope else { return }
        if ["image/png", "image/jpeg", "image/webp"].contains(mediaDrafts[index].mediaType) {
            mediaDrafts[index].phase = .waitingForContext
            return
        }
        mediaDrafts[index].phase = .uploading
        let mediaDraft = mediaDrafts[index]
        Task {
            do {
                let asset: ChatMediaAsset
                if let existing = mediaDraft.remoteAsset {
                    asset = existing
                } else {
                    asset = try await workspaceStore.createChatMedia(
                        personID: resolvedScope.person.id,
                        relationshipContextID: resolvedScope.context.id,
                        fileName: mediaDraft.fileName,
                        mediaType: mediaDraft.mediaType,
                        byteSize: mediaDraft.data.count,
                        width: mediaDraft.width,
                        height: mediaDraft.height,
                        idempotencyKey: "ios:chat-media:\(mediaDraft.id.uuidString.lowercased())"
                    )
                }
                guard let current = mediaDrafts.firstIndex(where: { $0.id == id }) else {
                    try? await workspaceStore.deleteChatMedia(id: asset.id)
                    return
                }
                mediaDrafts[current].remoteAsset = asset
                let ready = asset.status == "ready"
                    ? asset
                    : try await workspaceStore.uploadChatMedia(
                        id: asset.id,
                        data: mediaDraft.data,
                        mediaType: mediaDraft.mediaType
                    )
                guard let finalIndex = mediaDrafts.firstIndex(where: { $0.id == id }) else {
                    try? await workspaceStore.deleteChatMedia(id: ready.id)
                    return
                }
                mediaDrafts[finalIndex].remoteAsset = ready
                mediaDrafts[finalIndex].phase = .ready
            } catch {
                guard let failedIndex = mediaDrafts.firstIndex(where: { $0.id == id }) else { return }
                mediaDrafts[failedIndex].phase = .failed(
                    (error as? LocalizedError)?.errorDescription
                        ?? appLanguage.text("Upload failed. Retry keeps the same image identity.")
                )
                mediaNotice = appLanguage.text("An image did not upload. Retry or remove it before Send.")
            }
        }
    }

    private func retryMediaDraft(_ id: UUID) {
        uploadMediaDraft(id)
    }

    private func removeMediaDraft(_ id: UUID) {
        guard let index = mediaDrafts.firstIndex(where: { $0.id == id }) else { return }
        guard let mediaID = mediaDrafts[index].remoteAsset?.id else {
            mediaDrafts.remove(at: index)
            if mediaDrafts.isEmpty { mediaNotice = nil }
            return
        }
        mediaDrafts[index].phase = .removing
        Task {
            do {
                try await workspaceStore.deleteChatMedia(id: mediaID)
                mediaDrafts.removeAll { $0.id == id }
                if mediaDrafts.isEmpty { mediaNotice = nil }
            } catch {
                guard let failedIndex = mediaDrafts.firstIndex(where: { $0.id == id }) else { return }
                mediaDrafts[failedIndex].phase = .failed(
                    (error as? LocalizedError)?.errorDescription
                        ?? appLanguage.text("The image could not be removed.")
                )
                mediaNotice = appLanguage.text("Removal was not confirmed. The image remains attached locally.")
            }
        }
    }

    private func discardMediaDrafts() {
        let mediaIDs = mediaDrafts.compactMap { $0.remoteAsset?.id }
        mediaDrafts = []
        mediaNotice = nil
        guard !mediaIDs.isEmpty else { return }
        Task {
            for mediaID in mediaIDs {
                try? await workspaceStore.deleteChatMedia(id: mediaID)
            }
        }
    }

    private static let allowedChatMediaTypes: Set<String> = [
        "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
    ]

    /// Explicit Start-new-Session: release the tombstoned durable Session so
    /// the next send may create a new one with the preserved draft. Nothing is
    /// sent or created until the user acts.
    func startNewSessionAfterTombstone() {
        guard originalSessionUnavailable else { return }
        activeSessionID = nil
        errorMessage = nil
    }

    private func send(_ objective: String) {
        // Unified tombstone guard: FIRST action of every send path (local
        // answers, media, screenshots, scoped/unscoped, retry, IME commit,
        // pending sends). Nothing is cleared, created, uploaded or sent.
        if originalSessionUnavailable {
            if draft.isEmpty { draft = objective }
            operationState.pendingObjective = nil
            operationState.isSending = false
            errorMessage = appLanguage.text("This conversation was deleted. Start a new Session to continue; your draft is kept.")
            return
        }
        if hasPendingScreenshotAdmission, mediaDrafts.isEmpty {
            mediaNotice = appLanguage.text("Reattach the same screenshots to continue")
            return
        }
        let submittedObjective = hasPendingScreenshotAdmission
            ? sessionStore.session(id: activeSessionID)?.pendingObjective ?? objective
            : objective
        let trimmed = submittedObjective.trimmingCharacters(in: .whitespacesAndNewlines)
        guard AskInputCommitPolicy.canSubmit(
                hasCommittedInput: !trimmed.isEmpty || !mediaDrafts.isEmpty,
                isComposing: isComposerComposing
              ),
              !operationState.isSending else { return }
        if mediaDrafts.isEmpty,
           let localIntent = AgentLocalWorkspacePolicy.intent(for: trimmed) {
            flushDraftPersistence()
            performLocalWorkspaceAnswer(
                localIntent,
                objective: trimmed,
                originalDraft: trimmed
            )
            return
        }
        sourceReviewNotice = nil
        errorRecovery = .retry
        flushDraftPersistence()
        let screenshotRoute = AskScreenshotResearchRoutingPolicy.route(
            hasSelectedRelationship: selectedScope != nil,
            mediaTypes: mediaDrafts.map(\.mediaType)
        )
        let isUnscopedPersonResearch = screenshotRoute == .directResearch
        if screenshotRoute == .unsupported {
            errorMessage = appLanguage.text(
                "Choose up to ten PNG, JPEG, or WebP images."
            )
            composerFocused = false
            return
        }
        if mediaDrafts.reduce(0, { $0 + $1.data.count }) > 30_000_000 {
            errorMessage = appLanguage.text("Images must total no more than 30 MB.")
            return
        }
        let effectiveObjective = trimmed.isEmpty
            ? isUnscopedPersonResearch
                ? appLanguage.text("File this chat screenshot to the correct internal contact, save its messages, and explain supported changes and the next step. Research public professional context when useful.")
                : appLanguage.text(
                    "Read the attached material. Tell me what changed, what remains uncertain, and the smallest safe next step."
                )
            : trimmed
        if let capacityNotice = screenshotAdmissionCapacityNotice {
            errorMessage = capacityNotice
            composerFocused = false
            return
        }
        if (selectedScope != nil || isUnscopedPersonResearch), !isCanonical {
            errorMessage = appLanguage.text(
                "This is preview data, so no question was sent. Open a signed-in workspace connected to the backend, then try again."
            )
            composerFocused = false
            return
        }
        errorMessage = nil
        operationState.beginSubmission(objective: effectiveObjective)
        draft = ""
        composerFocused = false

        if !mediaDrafts.isEmpty, mediaDrafts.count <= 10,
           mediaDrafts.allSatisfy({ ["image/png", "image/jpeg", "image/webp"].contains($0.mediaType) }) {
            performScreenshotContact(media: mediaDrafts, objective: effectiveObjective, originalDraft: trimmed)
            return
        }

        if let selectedScope {
            // A tombstoned original Session never silently forks into a new
            // one: the draft stays and the user chooses explicitly.
            if originalSessionUnavailable {
                draft = trimmed
                operationState.pendingObjective = nil
                operationState.isSending = false
                errorMessage = appLanguage.text("This conversation was deleted. Start a new Session to continue; your draft is kept.")
                return
            }
            if activeSessionID.flatMap({ sessionStore.session(id: $0) })?.scope.matches(
                personID: selectedScope.person.id,
                relationshipContextID: selectedScope.context.id
            ) != true {
                guard let created = sessionStore.beginSession(
                    person: selectedScope.person, context: selectedScope.context,
                    objective: effectiveObjective
                ) else {
                    draft = trimmed
                    operationState.pendingObjective = nil
                    operationState.isSending = false
                    errorMessage = appLanguage.text("The Session could not be protected. Your message was not sent.")
                    return
                }
                activeSessionID = created
            }
            operationState.adoptScopedSend(
                objective: effectiveObjective,
                recallPhase: .reading(nil)
            )
            performScopedAsk(
                effectiveObjective: effectiveObjective,
                originalDraft: trimmed,
                scope: selectedScope
            )
            return
        }

        let unscopedSessionID: UUID
        if let activeSessionID,
           sessionStore.session(id: activeSessionID)?.isUnresolvedIntent == true {
            unscopedSessionID = activeSessionID
        } else if let created = sessionStore.beginUnscopedSession(
            objective: effectiveObjective
        ) {
            unscopedSessionID = created
            activeSessionID = created
        } else {
            operationState.isSending = false
            operationState.pendingObjective = nil
            draft = trimmed
            updateAskSubmissionPhase(.idle)
            errorMessage = appLanguage.text(
                "A protected Session could not be created. Your message was not sent."
            )
            return
        }

        sessionStore.saveGlobalDraft("")
        operationState.pendingScopedSend = effectiveObjective
        if isUnscopedPersonResearch, let mediaDraft = mediaDrafts.first {
            operationState.relationshipRecallPhase = .reading(nil)
            updateAskSubmissionPhase(.requestingWorkspaceAnswer)
            performUnscopedPersonResearch(
                sessionID: unscopedSessionID,
                effectiveObjective: effectiveObjective,
                originalDraft: trimmed,
                mediaDraft: mediaDraft
            )
            return
        }
        operationState.relationshipRecallPhase = .replyingWithoutRelationship
        updateAskSubmissionPhase(.requestingWorkspaceAnswer)
        performUnscopedChat(
            sessionID: unscopedSessionID,
            effectiveObjective: effectiveObjective,
            originalDraft: trimmed
        )
    }

    private func sessionSynchronizationFailure(_ sessionID: UUID) -> AskSessionSynchronizationFailure {
        AskSessionSynchronizationFailure(message: sessionStore.syncNotice(sessionID: sessionID)
            ?? appLanguage.text("The Session could not be synced. Try again."))
    }

    private var screenshotAdmissionCapacityNotice: String? {
        guard let activeSessionID,
              let notice = AskScreenshotAdmissionPolicy.newAdmissionCapacityNotice(
                hasAttachments: !mediaDrafts.isEmpty,
                hasPendingScreenshotAdmission: hasPendingScreenshotAdmission,
                capacityNotice: sessionStore.screenshotAdmissionNotice(sessionID: activeSessionID)
              ) else { return nil }
        return appLanguage.text(notice)
    }

    private func performScreenshotContact(media: [AskMediaDraft], objective: String, originalDraft: String) {
        if activeSessionID == nil {
            activeSessionID = selectedScope.map { scope in
                sessionStore.beginSession(person: scope.person, context: scope.context, objective: objective)
            } ?? sessionStore.beginUnscopedSession(objective: objective)
        }
        guard let activeSessionID else {
            draft = originalDraft
            operationState.pendingObjective = nil
            operationState.isSending = false
            errorMessage = appLanguage.text("The Session could not be protected. Your screenshot was not sent.")
            return
        }
        let images = media.map { ScreenshotContactTaskBody.Image(data: $0.data, mediaType: $0.mediaType) }
        guard let identity = AskScreenshotAdmissionPolicy.requestIdentity(
            images: images, objective: objective, personID: selectedScope?.person.id,
            relationshipContextID: selectedScope?.context.id
        ), let operationKey = sessionStore.beginScreenshotAdmission(
            sessionID: activeSessionID, objective: objective, requestIdentity: identity,
            proposedIdempotencyKey: "ios:contact-agent:\(UUID().uuidString.lowercased())"
        ), let capturedAt = sessionStore.session(id: activeSessionID)?.pendingScreenshotCapturedAt else {
            draft = hasPendingScreenshotAdmission ? "" : originalDraft
            operationState.pendingObjective = nil
            operationState.isSending = false
            errorMessage = screenshotAdmissionCapacityNotice
                ?? appLanguage.text("Choose the same screenshots in the same order to recover the original task.")
            return
        }
        let request = ScreenshotContactTaskBody(
            idempotencyKey: operationKey, objective: objective, images: images,
            personID: selectedScope?.person.id, contextID: selectedScope?.context.id,
            capturedAt: capturedAt
        )
        screenshotContactRequest = request
        updateAskSubmissionPhase(.requestingWorkspaceAnswer)
        operationState.replaceOperation { operationID in
            Task {
                var accepted = false
                defer {
                    if operationState.finishOperationIfCurrent(operationID) {
                        operationState.isSending = false
                    }
                }
                do {
                    guard await synchronizeSessions(activeSessionID) else {
                        throw sessionSynchronizationFailure(activeSessionID)
                    }
                    guard self.activeSessionID == activeSessionID, !Task.isCancelled,
                          operationState.isCurrentOperation(operationID) else { return }
                    var response = try await workspaceStore.createScreenshotContactTask(request)
                    guard AskScreenshotResponseOwner(sessionID: activeSessionID, taskID: nil)
                        .accepts(currentSessionID: self.activeSessionID, responseTaskID: response.taskID),
                          operationState.isCurrentOperation(operationID) else { return }
                    guard recordScreenshotResult(
                        response,
                        expectedSessionID: activeSessionID,
                        admissionIdempotencyKey: request.idempotencyKey
                    ) else {
                        throw AskSessionSynchronizationFailure(
                            message: appLanguage.text(
                                "Screenshot processing is available, but Session recovery could not be saved."
                            )
                        )
                    }
                    accepted = true
                    try Task.checkCancellation()
                    screenshotContactRequest = nil
                    mediaDrafts = []
                    mediaNotice = nil
                    while response.status == "running" {
                        try await Task.sleep(nanoseconds: 2_000_000_000)
                        let expectedTaskID = response.taskID
                        response = try await workspaceStore.loadScreenshotContactTask(id: expectedTaskID)
                        try Task.checkCancellation()
                        guard AskScreenshotResponseOwner(sessionID: activeSessionID, taskID: expectedTaskID)
                            .accepts(currentSessionID: self.activeSessionID, responseTaskID: response.taskID),
                              operationState.isCurrentOperation(operationID) else { return }
                        recordScreenshotResult(response, expectedSessionID: activeSessionID)
                    }
                    await workspaceStore.load()
                    guard self.activeSessionID == activeSessionID, !Task.isCancelled,
                          operationState.isCurrentOperation(operationID) else { return }
                    bindScreenshotContact(response)
                    operationState.pendingObjective = nil
                    operationState.pendingScopedSend = nil
                    updateAskSubmissionPhase(.idle)
                } catch {
                    guard !Task.isCancelled, self.activeSessionID == activeSessionID,
                          operationState.isCurrentOperation(operationID) else { return }
                    draft = hasPendingScreenshotAdmission || accepted ? "" : originalDraft
                    operationState.pendingObjective = nil
                    updateAskSubmissionPhase(.idle)
                    if hasPendingScreenshotAdmission {
                        errorMessage = nil
                        mediaNotice = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    } else {
                        presentAskFailure(error)
                    }
                }
            }
        }
    }

    private func resumeScreenshotContact(_ current: ScreenshotContactTask, body: ScreenshotContactResumeBody) {
        guard !operationState.isSending, let ownerSessionID = activeSessionID,
              screenshotTasks[current.taskID] != nil,
              sessionStore.session(id: ownerSessionID)?.readOnlyScreenshotTaskIDs.contains(current.taskID) == false else { return }
        let owner = AskScreenshotResponseOwner(sessionID: ownerSessionID, taskID: current.taskID)
        operationState.isSending = true
        operationState.replaceOperation { operationID in
            Task {
                defer {
                    if operationState.finishOperationIfCurrent(operationID) {
                        operationState.isSending = false
                    }
                }
                do {
                    var response = try await workspaceStore.resumeScreenshotContactTask(
                        id: current.taskID,
                        body: body
                    )
                    guard owner.accepts(currentSessionID: activeSessionID, responseTaskID: response.taskID),
                          !Task.isCancelled,
                          operationState.isCurrentOperation(operationID) else { return }
                    recordScreenshotResult(response, expectedSessionID: ownerSessionID)
                    while response.status == "running" {
                        try await Task.sleep(nanoseconds: 2_000_000_000)
                        response = try await workspaceStore.loadScreenshotContactTask(id: current.taskID)
                        try Task.checkCancellation()
                        guard owner.accepts(currentSessionID: activeSessionID, responseTaskID: response.taskID),
                              operationState.isCurrentOperation(operationID) else { return }
                        recordScreenshotResult(response, expectedSessionID: ownerSessionID)
                    }
                    await workspaceStore.load()
                    guard activeSessionID == ownerSessionID, !Task.isCancelled,
                          operationState.isCurrentOperation(operationID) else { return }
                    bindScreenshotContact(response)
                } catch {
                    guard activeSessionID == ownerSessionID, !Task.isCancelled,
                          operationState.isCurrentOperation(operationID) else { return }
                    presentAskFailure(error)
                }
            }
        }
    }

    private func cancelScreenshotContact(_ current: ScreenshotContactTask) {
        guard let ownerSessionID = activeSessionID, screenshotTasks[current.taskID] != nil,
              sessionStore.session(id: ownerSessionID)?.readOnlyScreenshotTaskIDs.contains(current.taskID) == false,
              !operationState.isCancellingScreenshot(current.taskID) else { return }
        let taskID = current.taskID
        let owner = AskScreenshotResponseOwner(sessionID: ownerSessionID, taskID: current.taskID)
        operationState.replaceScreenshotCancellation(for: taskID) { cancellationID in
            Task {
                defer {
                    operationState.finishScreenshotCancellationIfCurrent(cancellationID, for: taskID)
                }
                do {
                    let cancelled = try await workspaceStore.cancelLatestScreenshotContactTask(
                        id: taskID
                    )
                    guard owner.accepts(currentSessionID: activeSessionID, responseTaskID: cancelled.taskID),
                          !Task.isCancelled,
                          operationState.isCurrentScreenshotCancellation(cancellationID, for: taskID) else { return }
                    recordScreenshotResult(
                        cancelled,
                        expectedSessionID: ownerSessionID,
                        updatesAskContext: false
                    )
                } catch {
                    guard activeSessionID == ownerSessionID, !Task.isCancelled,
                          operationState.isCurrentScreenshotCancellation(cancellationID, for: taskID) else { return }
                    mediaNotice = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
    }

#if DEBUG
    private func seedCompletedScreenshotFixture() {
        let objective = "Review this synthetic screenshot."
        guard let created = sessionStore.beginUnscopedSession(objective: objective) else {
            errorMessage = appLanguage.text("The preview reply could not be saved.")
            return
        }
        let task = ScreenshotContactTask(
            sourceImages: [], taskID: "00000000-0000-4000-8000-000000000013",
            revision: 1, status: "completed", contact: nil, captureID: nil,
            sourceResourceID: nil, messageCount: 2,
            extraction: .init(messages: [
                .init(messageID: "synthetic-message-1", sequence: 0, text: "Could we review the draft on Friday?",
                      speakerSide: "left", speakerLabel: nil, timeText: nil, sourceImageIndex: nil),
                .init(messageID: "synthetic-message-2", sequence: 1, text: "I will check and reply.",
                      speakerSide: "right", speakerLabel: nil, timeText: nil, sourceImageIndex: nil)
            ], uncertainties: ["Friday has no confirmed date or time zone."]),
            preprocessing: nil,
            summary: "The source proposes reviewing a draft on Friday. **No action has been taken.**",
            findings: [], profileFields: [], publicSources: [], question: nil,
            candidates: [], limitations: ["Synthetic preview. No contact, source, or calendar was changed."],
            events: []
        )
        activeSessionID = created
        operationState.pendingObjective = objective
        recordScreenshotResult(task, expectedSessionID: created)
        composerFocused = false
    }
#endif

    private var hasPendingScreenshotAdmission: Bool {
        sessionStore.session(id: activeSessionID)?.hasPendingScreenshotAdmission == true
    }

    private var screenshotAdmissionRecovery: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let objective = sessionStore.session(id: activeSessionID)?.pendingObjective {
                AskUserMessageBubble(message: objective)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            Label(appLanguage.text("Screenshot outcome needs checking"), systemImage: "photo.badge.exclamationmark")
                .font(.subheadline.weight(.semibold))
            Text(appLanguage.text("The screenshot may already be processing. Reattach the same images in the same order to check the original task. Its message will not be sent as text."))
                .font(.caption).foregroundStyle(Color.tsMutedInk)
            Button {
                composerFocused = false
                discardMediaDrafts()
                selectedPhotoItems = []
                isPhotoLibraryPresented = true
            } label: {
                Label(appLanguage.text("Reattach same screenshots"), systemImage: "photo.on.rectangle")
                    .font(.subheadline.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            .accessibilityIdentifier("ask-reattach-admission-screenshots")
            if !mediaDrafts.isEmpty {
                Button { send("") } label: {
                    Label(appLanguage.text("Check original screenshot task"), systemImage: "arrow.clockwise")
                        .font(.subheadline.weight(.semibold))
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
                .accessibilityIdentifier("ask-reconcile-screenshot-admission")
            }
        }
        .padding(.vertical, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-screenshot-admission-recovery")
    }

    private var screenshotPollingKey: String {
        "\(activeSessionID?.uuidString ?? "none"):\(operationState.isSending):" + screenshotTasks.values.filter { $0.status == "running" }.map(\.taskID).sorted().joined(separator: ":")
    }

    private func bindScreenshotContact(_ task: ScreenshotContactTask) {
        guard !hasPendingScreenshotAdmission,
              let activeSessionID, let contact = task.contact,
              let person = currentSnapshot.people.first(where: { $0.id == contact.personID }),
              let context = person.contexts.first(where: { $0.id == contact.relationshipContextID }),
              let session = sessionStore.session(id: activeSessionID) else { return }
        if session.scope.matches(personID: person.id, relationshipContextID: context.id) {
            selectedScope = AskScope(person: person, context: context)
        } else if session.isUnresolvedIntent,
                  sessionStore.bindUnscopedSession(id: activeSessionID, person: person, context: context) {
            selectedScope = AskScope(person: person, context: context)
        }
    }

    @discardableResult
    private func recordScreenshotResult(
        _ receivedTask: ScreenshotContactTask,
        expectedSessionID: UUID,
        admissionIdempotencyKey: String? = nil,
        updatesAskContext: Bool = true
    ) -> Bool {
        let task = screenshotTasks[receivedTask.taskID].map {
            $0.revision > receivedTask.revision ? $0 : receivedTask
        } ?? receivedTask
        guard let ownerSession = sessionStore.session(id: expectedSessionID),
              AskScreenshotResponseOwner(sessionID: expectedSessionID, taskID: nil)
                .accepts(currentSessionID: activeSessionID, responseTaskID: task.taskID,
                         readOnlyTaskIDs: ownerSession.readOnlyScreenshotTaskIDs) else { return false }
        screenshotContactTask = task
        screenshotTasks[task.taskID] = task
        let activeSessionID = expectedSessionID
        let objective = turns.first { $0.response.taskID == task.taskID }?.objective
            ?? (admissionIdempotencyKey != nil ? sessionStore.session(id: activeSessionID)?.pendingObjective : nil)
            ?? (updatesAskContext ? operationState.pendingObjective : nil)
            ?? appLanguage.text("Read this screenshot")
        let fallback: String
        switch task.status {
        case "running": fallback = appLanguage.text("Reading the screenshot to identify the contact and preserve source-linked context.")
        case "deleted": fallback = appLanguage.text("This screenshot source is no longer available.")
        case "waiting_for_user": fallback = task.question ?? appLanguage.text("One clarification is needed to continue.")
        case "completed": fallback = appLanguage.text("Screenshot processing completed. Review its sources and results below.")
        default: fallback = appLanguage.text("Screenshot processing stopped. Review its current result before retrying.")
        }
        let summary = task.status == "deleted" || task.summary.isEmpty ? fallback : task.summary
        if !sessionStore.recordScreenshotTask(
            sessionID: activeSessionID, taskID: task.taskID,
            objective: objective, summary: summary, status: task.status,
            admissionIdempotencyKey: admissionIdempotencyKey,
            clearsMatchingPendingObjective: updatesAskContext
        ) {
            sourceReviewNotice = appLanguage.text("Screenshot processing is available, but Session recovery could not be saved.")
            return false
        }
        if updatesAskContext {
            bindScreenshotContact(task)
            // The accepted image is now represented by its original Session message.
            operationState.pendingObjective = nil
        }
        return true
    }

    private func restoreScreenshotTasks() async {
        guard isCanonical, let session = sessionStore.session(id: activeSessionID) else { return }
        for taskID in session.ownedScreenshotTaskIDs {
            do {
                let task = try await workspaceStore.loadScreenshotContactTask(id: taskID)
                try Task.checkCancellation()
                guard AskScreenshotResponseOwner(sessionID: session.id, taskID: taskID)
                    .accepts(currentSessionID: activeSessionID, responseTaskID: task.taskID) else { return }
                recordScreenshotResult(task, expectedSessionID: session.id)
            } catch {
                if Task.isCancelled || activeSessionID != session.id { return }
                sourceReviewNotice = appLanguage.text("A screenshot result could not be refreshed. Its saved message remains available.")
            }
        }
    }

    private func performUnscopedPersonResearch(
        sessionID: UUID, effectiveObjective: String, originalDraft: String, mediaDraft: AskMediaDraft
    ) {
        let contentHash = SHA256.hash(data: mediaDraft.data).map { String(format: "%02x", $0) }.joined()
        let requestIdentity = "\(mediaDraft.mediaType):\(contentHash)"
        guard
            let idempotencyKey = sessionStore.beginUnscopedPersonResearch(
                sessionID: sessionID, objective: effectiveObjective, requestIdentity: requestIdentity,
                proposedIdempotencyKey: "ios:person-research:\(UUID().uuidString.lowercased())")
        else {
            returnOperationStateToIdle()
            draft = originalDraft
            errorMessage = appLanguage.text("The screenshot Run could not be protected for retry. Nothing was sent.")
            return
        }
        operationState.replaceOperation { operationID in
            Task {
                defer { if operationState.finishOperationIfCurrent(operationID) { operationState.isSending = false } }
                let activityIdentity = await startAskActivity(sessionID: sessionID)
                guard operationState.isCurrentOperation(operationID), !Task.isCancelled else { return }
                do {
                    try await waitForFixtureAskDelayIfNeeded()
                    let response = try await workspaceStore.researchPerson(
                        objective: effectiveObjective, imageData: mediaDraft.data, mediaType: mediaDraft.mediaType,
                        idempotencyKey: idempotencyKey)
                    try Task.checkCancellation()
                    guard activeSessionID == sessionID, operationState.pendingScopedSend == effectiveObjective,
                        operationState.isCurrentOperation(operationID)
                    else { return }
                    guard
                        sessionStore.recordUnscopedPersonResearch(
                            sessionID: sessionID, objective: effectiveObjective,
                            response: response.relationshipAskProjection)
                    else { throw PursuitWorkspaceClientError.invalidResponse }
                    operationState.pendingObjective = nil
                    operationState.pendingScopedSend = nil
                    operationState.relationshipRecallPhase = .idle
                    updateAskSubmissionPhase(.idle)
                    if response.disposition == "unavailable" {
                        await updateAskActivity(activityIdentity, phase: .failed)
                        guard operationState.isCurrentOperation(operationID), !Task.isCancelled else { return }
                        draft = originalDraft
                        sessionStore.saveGlobalDraft(originalDraft)
                        mediaNotice = appLanguage.text(
                            "The Agent did not complete this Run. The screenshot remains only on this screen for a fresh retry; the backend receipt says it was not retained."
                        )
                    } else {
                        await updateAskActivity(activityIdentity, phase: .review)
                        guard operationState.isCurrentOperation(operationID), !Task.isCancelled else { return }
                        sessionStore.saveGlobalDraft("")
                        mediaDrafts = []
                        mediaNotice = appLanguage.text(
                            "Screenshot processed for this Run · raw image not retained · public matches remain unconfirmed"
                        )
                    }
                } catch {
                    guard !Task.isCancelled, operationState.isCurrentOperation(operationID) else { return }
                    await updateAskActivity(activityIdentity, phase: askActivityFailurePhase(error))
                    guard !Task.isCancelled, operationState.isCurrentOperation(operationID) else { return }
                    draft = originalDraft
                    operationState.pendingObjective = nil
                    operationState.pendingScopedSend = nil
                    operationState.relationshipRecallPhase = .idle
                    updateAskSubmissionPhase(.idle)
                    presentAskFailure(error)
                }
            }
        }
    }

    private func performUnscopedChat(sessionID: UUID, effectiveObjective: String, originalDraft: String) {
        guard
            let idempotencyKey = sessionStore.beginUnscopedChat(
                sessionID: sessionID, objective: effectiveObjective,
                proposedIdempotencyKey: "ios:unscoped-chat:\(UUID().uuidString.lowercased())")
        else {
            returnOperationStateToIdle()
            draft = originalDraft
            errorMessage = appLanguage.text(
                "A protected conversation retry could not be saved. Your message was not sent.")
            return
        }

        if !isCanonical {
            #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--fixture-agent-contact-proposal"),
                    var proposal = ConversationContactIntake.propose(effectiveObjective)
                {
                    proposal.interpreter = .workspaceAgent
                    let digest = SHA256.hash(data: Data(effectiveObjective.utf8)).map { String(format: "%02x", $0) }
                        .joined()
                    let proposalOperationKey = "ios:fixture-agent-contact:\(digest)"
                    guard
                        sessionStore.promoteUnscopedChatToContactProposal(
                            sessionID: sessionID, objective: effectiveObjective,
                            unscopedChatIdempotencyKey: idempotencyKey, draft: proposal,
                            proposalIdempotencyKey: proposalOperationKey, clearingGlobalDraft: true)
                    else {
                        returnOperationStateToIdle()
                        draft = originalDraft
                        errorMessage = appLanguage.text("The preview proposal could not be protected.")
                        return
                    }
                    returnOperationStateToIdle()
                    sessionStore.saveGlobalDraft("")
                    stageContactProposal(proposal, operationKey: proposalOperationKey, proposalIsProtected: true)
                    return
                }
            #endif
            let response = previewUnscopedResponse(for: effectiveObjective)
            guard
                sessionStore.recordUnscopedChat(sessionID: sessionID, objective: effectiveObjective, response: response)
            else {
                returnOperationStateToIdle()
                draft = originalDraft
                errorMessage = appLanguage.text("The preview reply could not be saved.")
                return
            }
            returnOperationStateToIdle()
            sessionStore.saveGlobalDraft("")
            return
        }

        operationState.replaceOperation { operationID in
            Task {
                var continuationScope: AskScope?
                defer {
                    if operationState.finishOperationIfCurrent(operationID) {
                        operationState.isSending = false
                        if let continuationScope {
                            operationState.isSending = true
                            performScopedAsk(
                                effectiveObjective: effectiveObjective, originalDraft: originalDraft,
                                scope: continuationScope)
                        }
                    }
                }
                let activityIdentity = await startAskActivity(sessionID: sessionID)
                guard operationState.isCurrentOperation(operationID), !Task.isCancelled else { return }
                do {
                    try await waitForFixtureAskDelayIfNeeded()
                    guard await synchronizeSessions(sessionID) else { throw sessionSynchronizationFailure(sessionID) }
                    guard activeSessionID == sessionID, !Task.isCancelled,
                        operationState.pendingScopedSend == effectiveObjective,
                        operationState.isCurrentOperation(operationID)
                    else { return }
                    let response = try await workspaceStore.chatUnscoped(
                        objective: effectiveObjective, idempotencyKey: idempotencyKey, sessionID: sessionID,
                        messageID: UUID(uuidString: idempotencyKey.components(separatedBy: ":").last ?? ""))
                    try Task.checkCancellation()
                    guard activeSessionID == sessionID, operationState.pendingScopedSend == effectiveObjective,
                        operationState.isCurrentOperation(operationID)
                    else { return }
                    if ["contact_candidates", "resolved_contact_context", "contact_change_proposal"].contains(
                        response.agentEvent?.kind ?? "")
                    {
                        await workspaceStore.load()
                        try Task.checkCancellation()
                        guard activeSessionID == sessionID, operationState.pendingScopedSend == effectiveObjective,
                            operationState.isCurrentOperation(operationID)
                        else { return }
                    }
                    if response.agentEvent?.kind == "contact_candidates" {
                        guard let event = response.agentEvent, let eventCandidates = event.candidates else {
                            throw PursuitWorkspaceClientError.invalidResponse
                        }
                        let candidates: [AgentRelationshipRecallCandidate] = eventCandidates.compactMap {
                            item -> AgentRelationshipRecallCandidate? in
                            guard let person = currentSnapshot.people.first(where: { $0.id == item.personID }),
                                let context = person.contexts.first(where: { $0.id == item.relationshipContextID })
                            else { return nil }
                            return AgentRelationshipRecallCandidate(
                                person: person, context: context, matchScore: 0, matchedPersonName: true,
                                matchedContextName: false, matchedRecentSession: false)
                        }
                        guard candidates.count == eventCandidates.count else {
                            throw PursuitWorkspaceClientError.scopeReadbackMismatch
                        }
                        operationState.relationshipRecallPhase = .ambiguous(
                            candidates: candidates, possibleDuplicate: event.possibleDuplicate ?? false)
                        updateAskSubmissionPhase(.idle)
                    } else if response.agentEvent?.kind == "resolved_contact_context" {
                        guard let event = response.agentEvent, let personID = event.personID,
                            let contextID = event.relationshipContextID,
                            let person = currentSnapshot.people.first(where: { $0.id == personID }),
                            let context = person.contexts.first(where: { $0.id == contextID }),
                            sessionStore.bindUnscopedSession(id: sessionID, person: person, context: context)
                        else { throw PursuitWorkspaceClientError.scopeReadbackMismatch }
                        let candidate = AgentRelationshipRecallCandidate(
                            person: person, context: context, matchScore: 0, matchedPersonName: true,
                            matchedContextName: true, matchedRecentSession: false)
                        let scope = AskScope(person: person, context: context)
                        selectedScope = scope
                        continuationScope = scope
                        operationState.relationshipRecallPhase = .reading(candidate)
                    } else {
                        if let event = response.agentEvent, event.kind == "contact_change_proposal" {
                            guard
                                stageAgentContactProposal(
                                    event, source: originalDraft.isEmpty ? effectiveObjective : originalDraft,
                                    sessionID: sessionID, objective: effectiveObjective,
                                    unscopedChatIdempotencyKey: idempotencyKey)
                            else { throw PursuitWorkspaceClientError.invalidResponse }
                        } else {
                            guard
                                sessionStore.recordUnscopedChat(
                                    sessionID: sessionID, objective: effectiveObjective,
                                    response: response.relationshipAskProjection)
                            else { throw PursuitWorkspaceClientError.invalidResponse }
                        }
                        operationState.pendingObjective = nil
                        operationState.pendingScopedSend = nil
                        operationState.relationshipRecallPhase = .idle
                        updateAskSubmissionPhase(.idle)
                        sessionStore.saveGlobalDraft("")
                    }
                    if continuationScope == nil {
                        await updateAskActivity(activityIdentity, phase: .review)
                        guard operationState.isCurrentOperation(operationID), !Task.isCancelled else { return }
                    }
                } catch {
                    guard !Task.isCancelled, operationState.isCurrentOperation(operationID) else { return }
                    await updateAskActivity(activityIdentity, phase: askActivityFailurePhase(error))
                    guard !Task.isCancelled, operationState.isCurrentOperation(operationID) else { return }
                    draft = originalDraft
                    operationState.pendingObjective = nil
                    operationState.pendingScopedSend = nil
                    operationState.relationshipRecallPhase = .idle
                    updateAskSubmissionPhase(.idle)
                    presentAskFailure(error)
                }
            }
        }
    }

    private func performLocalWorkspaceAnswer(
        _ intent: AgentLocalWorkspaceIntent,
        objective: String,
        originalDraft: String
    ) {
        let snapshot = currentSnapshot
        let peopleCount = snapshot.people.count
        let relationshipCount = snapshot.people.reduce(0) {
            $0 + $1.contexts.count
        }
        let title: String
        let body: String
        switch intent {
        case .peopleCount:
            title = appLanguage.text("Current workspace")
            if appLanguage.usesSimplifiedChinese() {
                body = "当前已同步的工作区中有 \(peopleCount) 位联系人，覆盖 \(relationshipCount) 段关系。这个结果由本机工作区索引直接计算；没有打开聊天内容，也没有调用远程模型。"
            } else {
                let contacts = peopleCount == 1
                    ? "1 contact"
                    : "\(peopleCount) contacts"
                let relationships = relationshipCount == 1
                    ? "1 relationship"
                    : "\(relationshipCount) relationships"
                body = "The synced workspace contains \(contacts) across \(relationships). This was calculated on this device from the workspace index; no candidate conversation was opened and no remote model was called."
            }
        }
        let response = RelationshipAskResponse(
            contractVersion: TalentSignalAPIContract.version,
            taskID: UUID().uuidString.lowercased(),
            contextManifestID: "none-unbound-conversation",
            knowledgeSnapshotID: "local-workspace-index",
            disposition: "answer",
            blocks: [
                .init(
                    id: UUID().uuidString.lowercased(),
                    kind: "answer",
                    title: title,
                    body: body,
                    status: "informational",
                    citationDependencyIDs: [],
                    requiresUserDecision: false
                ),
            ],
            createdAt: ISO8601DateFormatter().string(from: Date())
        )

        errorMessage = nil
        errorRecovery = .retry
        sourceReviewNotice = nil
        draft = ""
        composerFocused = false
        if let selectedScope {
            activeSessionID = sessionStore.record(
                sessionID: activeSessionID,
                objective: objective,
                response: response,
                person: selectedScope.person,
                context: selectedScope.context
            )
            if let activeSessionID { _ = sessionStore.clearDraft(sessionID: activeSessionID) }
            sessionStore.clearDraft(
                personID: selectedScope.person.id,
                relationshipContextID: selectedScope.context.id
            )
            return
        }

        let sessionID: UUID
        if let activeSessionID,
           sessionStore.session(id: activeSessionID)?.isUnresolvedIntent == true {
            sessionID = activeSessionID
        } else if let created = sessionStore.beginUnscopedSession(
            objective: objective
        ) {
            sessionID = created
            activeSessionID = created
        } else {
            draft = originalDraft
            errorMessage = appLanguage.text(
                "The on-device answer could not be protected in Sessions. Your message is still here."
            )
            return
        }
        guard sessionStore.recordUnscopedChat(
            sessionID: sessionID,
            objective: objective,
            response: response
        ) else {
            draft = originalDraft
            errorMessage = appLanguage.text(
                "The on-device answer could not be protected in Sessions. Your message is still here."
            )
            return
        }
        sessionStore.saveGlobalDraft("")
        _ = sessionStore.clearDraft(sessionID: sessionID)
    }

    private func previewUnscopedResponse(
        for objective: String
    ) -> RelationshipAskResponse {
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--fixture-get-27-long-share-summary") {
            return RelationshipAskResponse(
                contractVersion: "preview", taskID: UUID().uuidString.lowercased(),
                contextManifestID: "none-unbound-conversation",
                knowledgeSnapshotID: "none-unbound-conversation", disposition: "answer",
                blocks: [.init(
                    id: UUID().uuidString.lowercased(), kind: "answer", title: "Reviewed summary",
                    body: String(repeating: "界", count: AgentSessionSharePolicy.excerptLimit),
                    status: "informational", citationDependencyIDs: [], requiresUserDecision: false
                )], createdAt: ISO8601DateFormatter().string(from: Date())
            )
        }
        if ProcessInfo.processInfo.arguments.contains("--fixture-get-5-markdown") {
            return RelationshipAskResponse(
                contractVersion: "preview", taskID: UUID().uuidString.lowercased(),
                contextManifestID: "none-unbound-conversation",
                knowledgeSnapshotID: "none-unbound-conversation", disposition: "answer",
                blocks: [.init(
                    id: UUID().uuidString.lowercased(), kind: "answer", title: "Review plan",
                    body: """
                    # Delivery plan

                    Keep the source beside the decision.

                    - Review the message
                      - Preserve its exact wording
                    - [x] Keep the original Session
                    - [ ] Confirm the contact context

                    | Step | State |
                    | --- | --- |
                    | Source | Available |
                    | Contact | Proposed |

                    ```swift
                    let decision = "review"
                    ```

                    This is a synthetic preview. Nothing has been saved to a contact.
                    """,
                    status: "informational", citationDependencyIDs: [], requiresUserDecision: false
                )], createdAt: ISO8601DateFormatter().string(from: Date())
            )
        }
#endif
        let usesChinese = objective.range(
            of: #"\p{Script=Han}"#,
            options: .regularExpression
        ) != nil
        return RelationshipAskResponse(
            contractVersion: "preview",
            taskID: UUID().uuidString.lowercased(),
            contextManifestID: "none-unbound-conversation",
            knowledgeSnapshotID: "none-unbound-conversation",
            disposition: "answer",
            blocks: [
                .init(
                    id: UUID().uuidString.lowercased(),
                    kind: "answer",
                    title: usesChinese ? "Agent · 预览" : "Agent · Preview",
                    body: usesChinese
                        ? "你好，我在。你可以直接和我聊，或者告诉我想回顾哪段关系。"
                        : "Hello, I’m here. You can chat directly or tell me which relationship you want to revisit.",
                    status: "informational",
                    citationDependencyIDs: [],
                    requiresUserDecision: false
                ),
            ],
            createdAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    private func continueWithoutRelationship() {
        guard mediaDrafts.isEmpty,
              let sessionID = activeSessionID,
              let effectiveObjective = operationState.pendingScopedSend else { return }
        operationState.isSending = true
        operationState.relationshipRecallPhase = .replyingWithoutRelationship
        updateAskSubmissionPhase(.requestingWorkspaceAnswer)
        performUnscopedChat(
            sessionID: sessionID,
            effectiveObjective: effectiveObjective,
            originalDraft: effectiveObjective
        )
    }

    private func chooseRecallCandidate(
        _ candidate: AgentRelationshipRecallCandidate
    ) {
        guard let activeSessionID,
              let effectiveObjective = operationState.pendingScopedSend,
              bindRecalledCandidate(candidate, to: activeSessionID) else {
            return
        }
        operationState.isSending = true
        operationState.relationshipRecallPhase = .reading(candidate)
        performScopedAsk(
            effectiveObjective: effectiveObjective,
            originalDraft: effectiveObjective,
            scope: AskScope(
                person: candidate.person,
                context: candidate.context
            )
        )
    }

    private func bindRecalledCandidate(
        _ candidate: AgentRelationshipRecallCandidate,
        to sessionID: UUID
    ) -> Bool {
        guard sessionStore.bindUnscopedSession(
            id: sessionID,
            person: candidate.person,
            context: candidate.context
        ) else { return false }
        selectedScope = AskScope(
            person: candidate.person,
            context: candidate.context
        )
        if !mediaDrafts.isEmpty, let selectedScope {
            rebindMediaDrafts(to: selectedScope)
        }
        return true
    }

    private func changeRecalledRelationship() {
        guard operationState.pendingObjective != nil else { return }
        operationState.cancelOperation()
        operationState.isSending = false
        updateAskSubmissionPhase(.idle)
        selectedScope = nil
        operationState.relationshipRecallPhase = .unresolved(
            recent: AgentRelationshipRecallPolicy.recentCandidatesForReview(
                people: currentSnapshot.people,
                recentSessions: sessionStore.sessions
            )
        )
    }

    private func performScopedAsk(
        effectiveObjective: String,
        originalDraft: String,
        scope: AskScope
    ) {
        guard isCanonical else {
            updateAskSubmissionPhase(.idle)
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains(
                "--fixture-ask-delay-seconds"
            ) {
                operationState.replaceOperation { operationID in
                    Task {
                        try? await waitForFixtureAskDelayIfNeeded()
                        guard !Task.isCancelled,
                              operationState.finishOperationIfCurrent(operationID) else { return }
                        surfacePreviewAskFailure(originalDraft: originalDraft)
                    }
                }
                return
            }
#endif
            surfacePreviewAskFailure(originalDraft: originalDraft)
            return
        }
        updateAskSubmissionPhase(.requestingWorkspaceAnswer)
        operationState.replaceOperation { operationID in
            Task {
                defer {
                    if operationState.finishOperationIfCurrent(operationID) {
                        returnOperationStateToIdle()
                    }
                }
                let sessionID = activeSessionID ?? UUID()
                activeSessionID = sessionID
                let reviewOwner = AskCitationReviewOwner(workspaceID: currentSnapshot.workspaceID,
                    userID: currentSnapshot.currentUserID, sessionID: sessionID,
                    personID: scope.person.id, contextID: scope.context.id)
                do {
                    try await waitForMediaToBecomeReady()
                    try Task.checkCancellation()
                    guard operationState.isCurrentOperation(operationID) else { return }
                    let mediaIDs = mediaDrafts.compactMap(\.readyMediaID)
                    guard mediaIDs.count == mediaDrafts.count else {
                        throw PursuitWorkspaceClientError.askUnavailable
                    }
                    let requestID = UUID()
                    guard let idempotencyKey = sessionStore.beginAsk(
                        effectiveObjective,
                        personID: scope.person.id,
                        relationshipContextID: scope.context.id,
                        proposedIdempotencyKey: "ios:ask:\(requestID.uuidString.lowercased())",
                        requestIdentity: mediaIDs.isEmpty
                            ? nil
                            : mediaIDs.joined(separator: ":"),
                        sessionID: sessionID
                    ) else {
                        draft = originalDraft
                        returnOperationStateToIdle()
                        errorMessage = appLanguage.text(
                            "The question could not be protected for retry. Your message was not sent."
                        )
                        return
                    }
                    let activityIdentity = await startAskActivity(sessionID: sessionID)
                    guard !Task.isCancelled,
                          operationState.isCurrentOperation(operationID) else { return }
                    try await waitForFixtureAskDelayIfNeeded()
                    guard !Task.isCancelled,
                          operationState.isCurrentOperation(operationID) else { return }
#if DEBUG
                    fixtureAskRequestCount += 1
#endif
                    guard await synchronizeSessions(sessionID) else {
                        throw sessionSynchronizationFailure(sessionID)
                    }
                    guard activeSessionID == sessionID, !Task.isCancelled,
                          operationState.pendingScopedSend == effectiveObjective,
                          operationState.isCurrentOperation(operationID) else { return }
                    let response = try await ask(
                        effectiveObjective,
                        scope.person.id,
                        scope.context.id,
                        idempotencyKey,
                        mediaIDs,
                        sessionID,
                        UUID(uuidString: idempotencyKey.components(separatedBy: ":").last ?? "")
                    )
                    try Task.checkCancellation()
                    guard activeSessionID == sessionID, selectedScope?.id == scope.id,
                          operationState.pendingScopedSend == effectiveObjective,
                          operationState.isCurrentOperation(operationID) else {
                        return
                    }
                    sessionStore.revalidateEvidenceReviewAuthority(
                        citations: response.citations,
                        supersededMessage: appLanguage.text(
                            "A newer source decision is already current. This older operation cannot be retried.",
                            zhHans: "已有更新的来源决定生效。这条较早的操作不能再次重试。"
                        )
                    )
                    guard let recordedSessionID = sessionStore.recordIfOwned(
                        sessionID: sessionID,
                        objective: effectiveObjective,
                        response: response,
                        person: scope.person,
                        context: scope.context,
                        sourceMessageID: UUID(uuidString: idempotencyKey.components(separatedBy: ":").last ?? "")
                    ) else {
                        throw AskSessionSynchronizationFailure(message: appLanguage.text("The original Session is no longer available. Your message was not recorded."))
                    }
                    activeSessionID = recordedSessionID
                    operationState.pendingObjective = nil
                    operationState.pendingScopedSend = nil
                    operationState.relationshipRecallPhase = .idle
                    updateAskSubmissionPhase(.idle)
                    sessionStore.saveGlobalDraft("")
                    sessionStore.clearDraft(
                        personID: scope.person.id,
                        relationshipContextID: scope.context.id
                    )
                    mediaDrafts = []
                    mediaNotice = nil
                    await updateAskActivity(activityIdentity, phase: .review)
                } catch {
                    guard !Task.isCancelled,
                          currentReviewOwner == reviewOwner,
                          operationState.isCurrentOperation(operationID) else { return }
                    if let identity = currentAskActivityIdentity(sessionID: sessionID) {
                        await updateAskActivity(
                            identity,
                            phase: askActivityFailurePhase(error)
                        )
                    }
                    guard !Task.isCancelled,
                          currentReviewOwner == reviewOwner,
                          operationState.isCurrentOperation(operationID) else { return }
                    draft = originalDraft
                    operationState.pendingObjective = nil
                    operationState.pendingScopedSend = nil
                    operationState.relationshipRecallPhase = .idle
                    updateAskSubmissionPhase(.idle)
                    presentAskFailure(error, reviewOwner: reviewOwner)
                }
            }
        }
    }

    private func startAskActivity(
        sessionID: UUID
    ) async -> AgentAskActivityIdentity? {
        guard isCanonical else { return nil }
        return await AgentAskActivityController.shared.start(
            workspaceID: currentSnapshot.workspaceID,
            sessionID: sessionID
        )
    }

    private func currentAskActivityIdentity(
        sessionID: UUID
    ) -> AgentAskActivityIdentity? {
        guard #available(iOS 16.2, *) else { return nil }
        return Activity<AgentAskActivityAttributes>.activities
            .first(where: {
                $0.attributes.workspaceID == currentSnapshot.workspaceID
                    && $0.attributes.sessionID == sessionID.uuidString.lowercased()
            })
            .map {
                AgentAskActivityIdentity(
                    workspaceID: $0.attributes.workspaceID,
                    sessionID: $0.attributes.sessionID,
                    activityInstanceID: $0.attributes.activityInstanceID
                )
            }
    }

    private func updateAskActivity(
        _ identity: AgentAskActivityIdentity?,
        phase: AgentAskActivityPhase
    ) async {
        guard let identity else { return }
        _ = await AgentAskActivityController.shared.update(
            identity: identity,
            phase: phase
        )
    }

    private func askActivityFailurePhase(_ error: Error) -> AgentAskActivityPhase {
        if let urlError = error as? URLError, urlError.code == .timedOut {
            return .timedOut
        }
        if case let PursuitWorkspaceClientError.backend(code, _) = error,
           code.localizedCaseInsensitiveContains("timeout") {
            return .timedOut
        }
        return .failed
    }

    private func surfacePreviewAskFailure(originalDraft: String) {
        draft = originalDraft
        returnOperationStateToIdle()
        errorMessage = appLanguage.text(
            "This is preview data, so no question was sent. Open a signed-in workspace connected to the backend, then try again."
        )
    }

    private func presentAskFailure(_ error: Error, reviewOwner: AskCitationReviewOwner? = nil) {
        if case let PursuitWorkspaceClientError.askCitationReviewRequired(
            requirement
        ) = error {
            guard let reviewOwner, reviewOwner == currentReviewOwner,
                  requirement.citation.personID == reviewOwner.personID,
                  requirement.citation.relationshipContextID == reviewOwner.contextID else {
                errorRecovery = .retry
                errorMessage = appLanguage.text("The source is no longer current. Ask again.", zhHans: "来源已变化，请重新提问。")
                return
            }
            reviewRecoveryOwner = reviewOwner
            errorRecovery = .reviewSource(requirement)
            errorMessage = appLanguage.text(
                "One exact source has not completed its current user review. Your question is still in the composer. Review the source below; a new Ask will still require a separate tap."
            )
            return
        }
        if let typed = error as? PursuitWorkspaceClientError {
            switch typed {
            case .askCitationReviewAuthorityMissing,
                 .citedEvidenceUnavailable:
                if let personID = selectedScope?.person.id {
                    errorRecovery = .openRelationship(personID)
                } else {
                    errorRecovery = .retry
                }
                errorMessage = appLanguage.text(
                    "This relationship contains a source that is no longer current, reviewable, or authorized. Your question is still here; inspect the relationship source before asking again."
                )
                return
            case let .backend(code, _)
                where code == "CHAT_CITED_EVIDENCE_UNAVAILABLE":
                if let personID = selectedScope?.person.id {
                    errorRecovery = .openRelationship(personID)
                } else {
                    errorRecovery = .retry
                }
                errorMessage = appLanguage.text(
                    "The server found a relationship source whose current review or authorization changed. Your question is still here; inspect the relationship source before asking again."
                )
                return
            default:
                break
            }
        }
        errorRecovery = .retry
        errorMessage = askFailureMessage(error)
    }

    private func askFailureMessage(_ error: Error) -> String {
        if let urlError = error as? URLError,
           [
            .notConnectedToInternet,
            .cannotConnectToHost,
            .cannotFindHost,
            .networkConnectionLost,
            .timedOut,
            .dataNotAllowed,
           ].contains(urlError.code) {
            return appLanguage.text(
                "The workspace could not be reached. Check your connection and Tailscale, then retry. Your message is still here."
            )
        }
        return (error as? LocalizedError)?.errorDescription
            ?? appLanguage.text(
                "Ask could not read this material. Your message and attachments are still here.",
                zhHans: "暂时无法读取这些内容，你的消息和附件仍已保留。"
            )
    }

    private func updateAskSubmissionPhase(_ phase: AskSubmissionPhase) {
        guard operationState.transitionAskSubmissionPhase(to: phase) else { return }
        askSubmissionDiagnostic(for: phase)
    }

    /// Returns the pending values, busy flag, and visible phases to idle while
    /// emitting the submission diagnostic only on a real phase transition.
    private func returnOperationStateToIdle() {
        guard operationState.returnToIdle() else { return }
        askSubmissionDiagnostic(for: .idle)
    }

    private func askSubmissionDiagnostic(for phase: AskSubmissionPhase) {
        let diagnostic: AskInputDiagnostics.SubmissionState
        switch phase {
        case .idle:
            diagnostic = .idle
        case .routingLocally:
            diagnostic = .routingLocal
        case .requestingWorkspaceAnswer:
            diagnostic = .requestingWorkspace
        }
        AskInputDiagnostics.submissionTransition(diagnostic)
    }

    private func waitForMediaToBecomeReady() async throws {
        guard !mediaDrafts.isEmpty else { return }
        for _ in 0..<300 {
            if mediaDrafts.allSatisfy({ $0.phase == .ready }) { return }
            if mediaDrafts.contains(where: {
                if case .failed = $0.phase { return true }
                return false
            }) {
                throw PursuitWorkspaceClientError.askUnavailable
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw URLError(.timedOut)
    }

    private func inferredScope(from source: String) -> AskScope? {
        let normalizedSource = normalizedScopeText(source)
        guard !normalizedSource.isEmpty else {
            return availableScopes.count == 1 ? availableScopes.first : nil
        }
        let scored = availableScopes.compactMap { scope -> (AskScope, Int)? in
            let person = normalizedScopeText(scope.person.displayLabel)
            let context = normalizedScopeText(scope.context.displayLabel)
            var score = 0
            if person.count >= 2, normalizedSource.contains(person) {
                score += 100
            }
            if context.count >= 4, normalizedSource.contains(context) {
                score += 40
            }
            return score > 0 ? (scope, score) : nil
        }
        guard let bestScore = scored.map(\.1).max() else { return nil }
        let best = scored.filter { $0.1 == bestScore }.map(\.0)
        if best.count == 1 { return best[0] }
        let people = Set(best.map { $0.person.id })
        if people.count == 1,
           let onlyPersonID = people.first,
           let person = currentSnapshot.people.first(where: { $0.id == onlyPersonID }),
           person.contexts.count == 1 {
            return best.first
        }
        return nil
    }

    private func normalizedScopeText(_ value: String) -> String {
        value.folding(
            options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
            locale: appLanguage.locale
        )
        .precomposedStringWithCompatibilityMapping
        .replacingOccurrences(
            of: #"[^\p{L}\p{N}@+]+"#,
            with: " ",
            options: .regularExpression
        )
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func requestRelationshipScope() {
        errorMessage = nil
        isRequestingScope = true
        scopeQuery = ""
        composerFocused = false
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) {
            isChoosingScope = true
        }
    }

    private func stageContactProposal(
        _ proposedContact: ConversationContactDraft,
        operationKey: String? = nil,
        suggestedPersonID: String? = nil,
        suggestedContextID: String? = nil,
        proposalIsProtected: Bool = false
    ) {
        guard contactDraft == nil || contactSaveMessage != nil else {
            sessionActionError = appLanguage.text("Finish or dismiss the current contact proposal first.")
            return
        }
        operationState.pendingScopedSend = nil
        errorMessage = nil
        isChoosingScope = false
        isRequestingScope = false
        contactDraft = proposedContact
        contactOperationKey = operationKey
            ?? "ios:contact:\(UUID().uuidString.lowercased())"
        pendingContactTarget = nil
        pendingContactCapturedAt = nil
        pendingContactConfirmIdentityClue = nil
        selectedContactPersonID = nil
        selectedContactContextID = nil
        createDistinctContact = false
        saveContactForIdentityReview = false
        confirmContactIdentityClue = proposedContact.identityClue != nil
        contactSaveMessage = nil
        contactSaveError = nil
        if let suggestedPersonID,
           let suggestedPerson = currentSnapshot.people.first(where: {
               $0.id == suggestedPersonID
           }) {
            contactCandidates = [suggestedPerson]
            contactLookupPhase = .complete
            selectedContactPersonID = suggestedPersonID
            selectedContactContextID = suggestedContextID
        } else {
            startContactLookup(for: proposedContact)
        }
        if !proposalIsProtected,
           let contactOperationKey,
           !sessionStore.saveContactProposal(
                proposedContact,
                idempotencyKey: contactOperationKey,
                clearingGlobalDraft: true,
                sessionID: activeSessionID
           ) {
            contactSaveError = appLanguage.text(
                "The proposal is open, but this device could not protect it for relaunch."
            )
        }
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--fixture-get-5-ended-contact-proposal") {
            _ = sessionStore.clearContactProposal(sessionID: activeSessionID)
        }
#endif
        draft = ""
        composerFocused = false
    }

    private func stageAgentContactProposal(
        _ event: UnscopedChatTaskResponse.AgentEvent,
        source: String,
        sessionID: UUID,
        objective: String,
        unscopedChatIdempotencyKey: String
    ) -> Bool {
        guard event.requiresUserConfirmation == true,
              let fingerprint = event.candidateFingerprint,
              let displayName = event.displayName,
              let relationshipContext = event.relationshipContext else {
            return false
        }
        if event.proposalKind == "update" {
            guard let targetPersonID = event.targetPersonID,
                  let baseRevision = event.baseRevision,
                  let person = currentSnapshot.people.first(where: {
                      $0.id == targetPersonID
                  }),
                  (person.profile?.revision ?? 1) == baseRevision,
                  person.displayLabel.compare(
                      displayName,
                      options: [.caseInsensitive, .diacriticInsensitive]
                  ) == .orderedSame else {
                return false
            }
            if let targetContextID = event.targetRelationshipContextID {
                guard let context = person.contexts.first(where: {
                    $0.id == targetContextID
                }), context.displayLabel.compare(
                    relationshipContext,
                    options: [.caseInsensitive, .diacriticInsensitive]
                ) == .orderedSame else {
                    return false
                }
            }
        }
        let clue = event.identityClue.map {
            ConversationContactDraft.IdentityClue(
                type: $0.type,
                value: $0.value
            )
        }
        let proposal = ConversationContactDraft(
            name: displayName,
            identityClue: clue,
            relationshipContext: relationshipContext,
            sourceNote: source,
            interpreter: .workspaceAgent,
            fieldEvidence: [
                source.contains(displayName) ? ConversationContactDraft.FieldEvidence(field: .name, exactExcerpt: displayName) : nil,
                clue.flatMap { clue -> ConversationContactDraft.FieldEvidence? in
                    source.contains(clue.value) ? .init(field: .identityClue, exactExcerpt: clue.value) : nil
                },
                !relationshipContext.isEmpty && source.contains(relationshipContext)
                    ? ConversationContactDraft.FieldEvidence(field: .relationshipContext, exactExcerpt: relationshipContext) : nil,
            ].compactMap { $0 }
        )
        let operationKey = "ios:agent-contact:\(fingerprint)"
        guard sessionStore.promoteUnscopedChatToContactProposal(
            sessionID: sessionID,
            objective: objective,
            unscopedChatIdempotencyKey: unscopedChatIdempotencyKey,
            draft: proposal,
            proposalIdempotencyKey: operationKey,
            clearingGlobalDraft: true,
            sourceMessageID: event.sourceMessageID.flatMap(UUID.init(uuidString:))
        ) else {
            return false
        }
        stageContactProposal(
            proposal,
            operationKey: operationKey,
            suggestedPersonID: event.targetPersonID,
            suggestedContextID: event.targetRelationshipContextID,
            proposalIsProtected: true
        )
        return true
    }

    private func stagePublicProfileReview(
        _ source: RelationshipAskResponse.Block.PublicSource
    ) {
        let biography = source.biography?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let headline = biography.count <= 240
            ? biography
            : String(biography.prefix(237)) + "…"
        let profile = ConversationContactDraft.ReviewedPublicProfile(
            resultID: source.resultID,
            providerID: source.providerID,
            platform: source.platform,
            profileURL: source.profileURL,
            displayName: source.displayName,
            handle: source.handle,
            biography: source.biography,
            avatarURL: source.avatarURL,
            avatarDisplayPolicy: source.avatarDisplayPolicy,
            avatarRightsBasis: source.avatarRightsBasis,
            verified: source.verified,
            matchBasis: source.matchBasis,
            contentHash: source.contentHash,
            retrievedAt: source.retrievedAt,
            cardHeadline: headline,
            includeAvatar: source.avatarURL != nil
                && source.avatarDisplayPolicy == "display_and_store"
                && source.avatarRightsBasis != nil
        )
        stageContactProposal(
            ConversationContactDraft(
                name: source.displayName,
                identityClue: .init(
                    type: source.platform.lowercased() == "linkedin"
                        ? "linkedin_url"
                        : "public_profile_url",
                    value: source.profileURL
                ),
                relationshipContext: "",
                sourceNote: appLanguage.text(
                    "Review public profile from \(source.platform): \(source.profileURL)",
                    zhHans: "核对来自 \(source.platform) 的公开资料：\(source.profileURL)"
                ),
                interpreter: .reviewedPublicResearch,
                reviewedPublicProfile: profile
            )
        )
    }

    private func waitForFixtureAskDelayIfNeeded() async throws {
#if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard let flagIndex = arguments.firstIndex(of: "--fixture-ask-delay-seconds"),
              arguments.indices.contains(flagIndex + 1),
              let seconds = Double(arguments[flagIndex + 1]),
              seconds > 0 else {
            if arguments.contains("--fixture-ask-fail-once"),
               !fixtureAskFailureConsumed {
                fixtureAskFailureConsumed = true
                throw URLError(.networkConnectionLost)
            }
            return
        }
        try await Task.sleep(for: .milliseconds(Int(seconds * 1_000)))
        if arguments.contains("--fixture-ask-fail-once"),
           !fixtureAskFailureConsumed {
            fixtureAskFailureConsumed = true
            throw URLError(.networkConnectionLost)
        }
#endif
    }

    private func startContactLookup(
        for proposal: ConversationContactDraft,
        preservePendingWrite: Bool = false
    ) {
        contactLookupTask?.cancel()
        if !preservePendingWrite {
            selectedContactPersonID = nil
            selectedContactContextID = nil
            createDistinctContact = false
            saveContactForIdentityReview = false
        }
        guard isCanonical else {
            contactCandidates = []
            contactLookupPhase = .idle
            return
        }
        guard let identityClue = proposal.identityClue else {
            contactCandidates = ConversationContactMatchPolicy.sameNameReview(
                for: proposal,
                in: currentSnapshot.people
            )
            contactLookupPhase = .complete
            return
        }
        contactCandidates = []
        contactLookupPhase = .checking
        contactLookupTask = Task {
            do {
                try await Task.sleep(for: .milliseconds(250))
                guard isContactProposalCurrent, contactDraft == proposal else { return }
                try await waitForFixtureContactLookupIfNeeded()
                let matches = try await workspaceStore.findContactMatches(
                    identityClue: identityClue
                )
                guard !Task.isCancelled, isContactProposalCurrent, contactDraft == proposal else {
                    return
                }
                contactCandidates = matches
                contactLookupPhase = .complete
            } catch is CancellationError {
                return
            } catch {
                guard contactDraft == proposal else { return }
                contactCandidates = []
                contactLookupPhase = .failed(
                    (error as? LocalizedError)?.errorDescription
                        ?? appLanguage.text(
                            "Identity checking is temporarily unavailable."
                        )
                )
            }
        }
    }

    private func waitForFixtureContactLookupIfNeeded() async throws {
#if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if let flagIndex = arguments.firstIndex(
            of: "--fixture-contact-lookup-delay-seconds"
        ), arguments.indices.contains(flagIndex + 1),
           let seconds = Double(arguments[flagIndex + 1]),
           seconds > 0 {
            try await Task.sleep(for: .milliseconds(Int(seconds * 1_000)))
        }
        if arguments.contains("--fixture-contact-lookup-fail-once"),
           !fixtureContactLookupFailureConsumed {
            fixtureContactLookupFailureConsumed = true
            throw URLError(.networkConnectionLost)
        }
#endif
    }

    private func saveContactProposal() {
        guard let contactDraft, !isSavingContact else { return }
        guard isContactProposalCurrent else {
            contactSaveError = endedContactProposalMessage
            return
        }
        guard !contactDraft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !contactDraft.relationshipContext.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            contactSaveError = appLanguage.text("Add a name and real relationship context before saving.")
            return
        }
        guard contactLookupPhase == .complete else {
            contactSaveError = appLanguage.text(
                "Wait for identity checking or retry it before saving."
            )
            return
        }
        let candidates = contactCandidates
        let target: ConversationContactTarget
        if let pendingContactTarget {
            target = pendingContactTarget
        } else {
            let hasIdentityConflict = ConversationContactMatchPolicy
                .hasCurrentHistoricalConflict(in: candidates)
            if saveContactForIdentityReview {
                target = .unresolved
            } else if let selectedContactPersonID {
                target = .existingPerson(
                    personID: selectedContactPersonID,
                    relationshipContextID: selectedContactContextID
                )
            } else if candidates.isEmpty || (createDistinctContact && !hasIdentityConflict) {
                target = .newPerson
            } else {
                contactSaveError = appLanguage.text(
                    "Choose the existing person or explicitly create a separate contact."
                )
                return
            }
        }
        contactSaveError = nil
        contactSaveMessage = nil
        isSavingContact = true
        guard let operationKey = contactOperationKey else {
            isSavingContact = false
            contactSaveError = endedContactProposalMessage
            return
        }
        let confirmedIdentityClue = pendingContactConfirmIdentityClue
            ?? confirmContactIdentityClue
        guard sessionStore.saveContactProposal(
            contactDraft,
            idempotencyKey: operationKey,
            pendingTarget: target,
            pendingConfirmIdentityClue: confirmedIdentityClue,
            sessionID: activeSessionID
        ) else {
            isSavingContact = false
            contactSaveError = appLanguage.text(
                "The confirmed operation could not be protected for a safe retry. Nothing was saved."
            )
            return
        }
        let capturedAt = sessionStore.contactProposal(sessionID: activeSessionID)?.capturedAt ?? Date()
        pendingContactTarget = target
        pendingContactCapturedAt = capturedAt
        pendingContactConfirmIdentityClue = confirmedIdentityClue
        Task {
            do {
                let result = try await saveContact(
                    contactDraft,
                    target,
                    confirmedIdentityClue,
                    capturedAt,
                    operationKey
                )
                let receipt = result.resource.id.suffix(8)
                let receiptOutcome = contactReceiptOutcome(for: target)
                if receiptOutcome == .identityReview {
                    guard result.identity.resolutionCaseID != nil,
                          result.identity.personID == nil,
                          result.identity.relationshipContextID == nil else {
                        throw PursuitWorkspaceClientError.scopeReadbackMismatch
                    }
                } else {
                    guard result.identity.personID != nil,
                          result.identity.relationshipContextID != nil,
                          result.identity.resolutionCaseID == nil else {
                        throw PursuitWorkspaceClientError.scopeReadbackMismatch
                    }
                }
                let canonicalPerson = result.identity.personID.flatMap { personID in
                    currentSnapshot.people.first { $0.id == personID }
                }
                let canonicalContext = result.identity.relationshipContextID.flatMap {
                    contextID in
                    canonicalPerson?.contexts.first { $0.id == contextID }
                }
                let receiptSessionID = sessionStore.recordContactReceipt(
                    operationKey: operationKey,
                    outcome: receiptOutcome,
                    result: result,
                    personDisplayLabel: canonicalPerson?.displayLabel ?? contactDraft.name,
                    contextDisplayLabel: canonicalContext?.displayLabel
                        ?? (receiptOutcome == .identityReview
                            ? nil
                            : contactDraft.relationshipContext),
                    sessionID: activeSessionID
                )
                bindContactContinuation(
                    to: result,
                    sessionID: receiptSessionID
                )
                let didClearRecovery = sessionStore.clearContactProposal(sessionID: activeSessionID)
                if didClearRecovery {
                    pendingContactTarget = nil
                    pendingContactCapturedAt = nil
                    pendingContactConfirmIdentityClue = nil
                }
                if target == .unresolved {
                    guard let caseID = result.identity.resolutionCaseID else {
                        throw PursuitWorkspaceClientError.scopeReadbackMismatch
                    }
                    contactSaveMessage = didClearRecovery
                        ? receiptSessionID.map { _ in
                            "\(appLanguage.text("Saved for identity review")) · \(appLanguage.text("case")) \(caseID.suffix(8)) · \(appLanguage.text("source receipt")) \(receipt)."
                        } ?? appLanguage.text(
                            "Saved for identity review, but Session history is unavailable on this device.",
                            zhHans: "已保存以供身份审阅，但此设备上的会话历史不可用。"
                        )
                        : appLanguage.text(
                            "Saved for identity review, but local recovery could not be cleared. Reopening uses the same safe operation."
                        )
                } else {
                    let destination = canonicalPerson?.displayLabel ?? contactDraft.name
                    contactSaveMessage = didClearRecovery
                        ? receiptSessionID.map { _ in
                            appLanguage.text(
                                "Saved to \(destination) · receipt \(receipt). The original note remains the source.",
                                zhHans: "已保存到 \(destination) · 回执 \(receipt)。原始输入仍作为来源保留。"
                            )
                        } ?? appLanguage.text(
                            "Saved to \(destination), but Session history is unavailable on this device.",
                            zhHans: "已保存到 \(destination)，但此设备上的会话历史不可用。"
                        )
                        : appLanguage.text(
                            "Saved, but local recovery could not be cleared. Reopening uses the same safe operation."
                        )
                }
            } catch {
                contactSaveError = pendingContactTarget != nil
                    ? appLanguage.text("The save outcome needs checking. Check or retry the original operation.")
                    : (error as? LocalizedError)?.errorDescription
                        ?? appLanguage.text("The proposal could not be saved. Your proposal is still here.")
            }
            isSavingContact = false
            if contactSaveMessage != nil && pendingContactTarget == nil {
                self.contactDraft = nil
                self.contactOperationKey = nil
                self.contactSaveMessage = nil
            }
        }
    }

    private func contactReceiptOutcome(
        for target: ConversationContactTarget
    ) -> AgentContactReceipt.Outcome {
        switch target {
        case .newPerson: return .createdPerson
        case .existingPerson: return .matchedExisting
        case .unresolved: return .identityReview
        }
    }

    private func bindContactContinuation(
        to result: ResourceCaptureResult,
        sessionID: UUID?
    ) {
        activeSessionID = sessionID
        isChoosingScope = false
        guard let personID = result.identity.personID,
              let relationshipContextID = result.identity.relationshipContextID else {
            // An unresolved identity case owns no relationship scope. The
            // composer may accept another contact intent, but a generic Ask
            // must never inherit whichever relationship preceded this review.
            selectedScope = nil
            return
        }
        selectedScope = availableScopes.first {
            $0.person.id == personID
                && $0.context.id == relationshipContextID
        }
    }

    private func clearContactProposal() {
        guard !isContactProposalCurrent || sessionStore.clearContactProposal(sessionID: activeSessionID) else {
            contactSaveError = appLanguage.text(
                "The proposal could not be cleared from protected recovery. It remains open."
            )
            return
        }
        contactDraft = nil
        contactOperationKey = nil
        pendingContactTarget = nil
        pendingContactCapturedAt = nil
        pendingContactConfirmIdentityClue = nil
        contactLookupTask?.cancel()
        contactLookupTask = nil
        contactCandidates = []
        contactLookupPhase = .idle
        selectedContactPersonID = nil
        selectedContactContextID = nil
        createDistinctContact = false
        saveContactForIdentityReview = false
        confirmContactIdentityClue = false
        contactSaveMessage = nil
        contactSaveError = nil
    }

    private func contactDraftBinding(
        fallback: ConversationContactDraft
    ) -> Binding<ConversationContactDraft> {
        Binding(
            get: { contactDraft ?? fallback },
            set: { updated in
                guard pendingContactTarget == nil, !isSavingContact, contactSaveMessage == nil else { return }
                guard isContactProposalCurrent else {
                    contactSaveError = endedContactProposalMessage
                    return
                }
                let previous = contactDraft
                contactDraft = updated
                if previous?.name != updated.name || previous?.identityClue != updated.identityClue
                    || previous?.relationshipContext != updated.relationshipContext {
                    confirmContactIdentityClue = updated.identityClue != nil
                    startContactLookup(for: updated)
                }
                let operationKey = contactOperationKey
                    ?? sessionStore.contactProposal(sessionID: activeSessionID)?.idempotencyKey
                    ?? "ios:contact:\(UUID().uuidString.lowercased())"
                contactOperationKey = operationKey
                if !sessionStore.saveContactProposal(
                    updated,
                    idempotencyKey: operationKey,
                    sessionID: activeSessionID
                ) {
                    contactSaveError = appLanguage.text(
                        "This edit is visible, but it could not be protected for relaunch."
                    )
                }
            }
        )
    }

    private func restorePendingContactChoice() {
        selectedContactPersonID = nil
        selectedContactContextID = nil
        createDistinctContact = false
        saveContactForIdentityReview = false
        switch pendingContactTarget {
        case .newPerson:
            createDistinctContact = true
        case let .existingPerson(personID, relationshipContextID):
            selectedContactPersonID = personID
            selectedContactContextID = relationshipContextID
        case .unresolved:
            saveContactForIdentityReview = true
        case nil:
            break
        }
    }

    private func restoreContactProposal() {
        guard initialSeed == nil, contactDraft == nil,
              let saved = sessionStore.contactProposal(sessionID: activeSessionID) else {
            return
        }
        // A fresh composer must not silently load another existing Session's draft.
        guard activeSessionID != nil || saved.sessionID == nil else { return }
        contactDraft = saved.draft
        contactOperationKey = saved.idempotencyKey
        pendingContactTarget = saved.pendingTarget
        pendingContactCapturedAt = saved.capturedAt
        pendingContactConfirmIdentityClue = saved.pendingConfirmIdentityClue
        confirmContactIdentityClue = saved.draft.identityClue != nil
        restorePendingContactChoice()
        startContactLookup(for: saved.draft, preservePendingWrite: saved.pendingTarget != nil)
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ")
        return String(parts.prefix(2).compactMap(\.first)).uppercased()
    }

    private func restoreDraft(preferred: String? = nil) {
        let saved: String
        if let activeSessionID {
            saved = sessionStore.draft(sessionID: activeSessionID)
        } else if let selectedScope {
            saved = sessionStore.draft(
                personID: selectedScope.person.id,
                relationshipContextID: selectedScope.context.id
            )
        } else if sessionID == nil,
                  initialSeed == nil,
                  contactDraft == nil {
            saved = sessionStore.globalDraft()
        } else {
            return
        }
        draft = saved.isEmpty ? preferred ?? "" : saved
    }

    private func selectScope(_ scope: AskScope) {
        let pendingSend = operationState.pendingScopedSend
        operationState.pendingScopedSend = nil
        let priorScope = selectedScope
        let unscopedDraft = draft
        let shouldPromoteDraft = priorScope == nil
            && !unscopedDraft.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).isEmpty
        let wasGlobalComposition = activeSessionID == nil
            && initialSeed == nil

        flushDraftPersistence()
        if let activeSessionID, let current = sessionStore.session(id: activeSessionID) {
            if current.scope.matches(personID: scope.person.id, relationshipContextID: scope.context.id) {
                // Re-selecting the same context keeps the current conversation.
            } else if current.isUnresolvedIntent,
                      sessionStore.bindUnscopedSession(id: activeSessionID, person: scope.person, context: scope.context) {
                // Exact selected scope joins the existing unbound Session.
            } else {
                self.activeSessionID = nil
            }
        }
        selectedScope = scope
        scopeQuery = ""
        isChoosingScope = false
        isRequestingScope = false
        errorMessage = nil

        if shouldPromoteDraft {
            if wasGlobalComposition {
                if !sessionStore.promoteGlobalDraft(
                    unscopedDraft,
                    personID: scope.person.id,
                    relationshipContextID: scope.context.id
                ) {
                    errorMessage = appLanguage.text(
                        "This relationship is selected, but the draft remains protected as a global draft until this device can save the move."
                    )
                }
            } else {
                sessionStore.saveDraft(
                    unscopedDraft,
                    personID: scope.person.id,
                    relationshipContextID: scope.context.id
                )
            }
            draft = unscopedDraft
            if !voiceOverEnabled {
                Task { @MainActor in
                    await Task.yield()
                    composerFocused = true
                }
            }
        } else if let activeSessionID {
            draft = sessionStore.draft(sessionID: activeSessionID)
        } else {
            draft = sessionStore.draft(
                personID: scope.person.id,
                relationshipContextID: scope.context.id
            )
        }

        if let pendingSend {
            Task { @MainActor in
                await Task.yield()
                send(pendingSend)
            }
        }
    }

    private func reviewIdempotencyKey(
        fragmentID: String,
        expectedReviewStatus: String,
        authorityToken: String,
        reason: String,
        decision: String
    ) -> String {
        AgentEvidenceReviewIntent.idempotencyKey(
            fragmentID: fragmentID,
            expectedReviewStatus: expectedReviewStatus,
            authorityToken: authorityToken,
            decision: decision,
            reason: reason
        )
    }

    private func submitCitationDecision(
        _ selection: SelectedAskCitation,
        decision: String,
        reason: String
    ) async throws {
        guard selectedCitation?.id == selection.id, selectedCitationIsCurrent else {
            throw PursuitWorkspaceClientError.citedEvidenceUnavailable
        }
        if case let .reviewSource(requirement) = errorRecovery,
           requirement.taskID == selection.taskID {
            guard requirement.citation.id == selection.citation.id else { throw PursuitWorkspaceClientError.citedEvidenceUnavailable }
            _ = try await refreshRecoveryCitation(requirement)
        } else if !selectedCitationIsCurrent {
            throw PursuitWorkspaceClientError.citedEvidenceUnavailable
        }
        let recoveryOwner: AskCitationReviewOwner?
        if case let .reviewSource(requirement) = errorRecovery, requirement.taskID == selection.taskID {
            recoveryOwner = reviewRecoveryOwner
        } else { recoveryOwner = nil }
        let pendingKey = recoveryOwner.flatMap { sessionStore.session(id: $0.sessionID)?.pendingScopedAskIdempotencyKey }
        let citation = selection.citation
        let reviewKey = reviewIdempotencyKey(
            fragmentID: citation.id,
            expectedReviewStatus: citation.reviewStatus,
            authorityToken: citation.lastReviewID ?? "no-current-review",
            reason: reason,
            decision: decision
        )
        let scope = selectedScope
        _ = try sessionStore.beginEvidenceReview(
            idempotencyKey: reviewKey,
            taskID: selection.taskID,
            citation: citation,
            personDisplayName: scope?.person.displayLabel ?? "Current person",
            relationshipContextDisplayName: scope?.context.displayLabel
                ?? "Current relationship",
            expectedReviewStatus: citation.reviewStatus,
            decision: decision,
            reason: reason,
            pendingAskSessionID: pendingKey == nil ? nil : recoveryOwner?.sessionID,
            pendingAskKey: pendingKey
        )
        reviewPreparationError = nil
        sessionStore.markCitationStale(citation.id)
        guard sessionStore.claimEvidenceReview(reviewKey) else { return }
        defer { sessionStore.releaseEvidenceReview(reviewKey) }
        do {
            let result = try await reviewEvidence(
                citation.id,
                citation.reviewStatus,
                citation.lastReviewID,
                decision,
                reason,
                reviewKey
            )
            guard sessionStore.markEvidenceReviewApplied(
                reviewKey,
                result: result
            ) else {
                reviewPreparationError = postReviewPersistenceMessage
                return
            }
            if let recoveryOwner, currentReviewOwner != recoveryOwner { return }
            selectedCitation = nil
            errorMessage = nil
            errorRecovery = .retry
            sourceReviewNotice = decision == "reviewed"
                ? appLanguage.text(
                    "Source reviewed. Your question is still in the composer; send it when you are ready for a fresh answer."
                )
                : appLanguage.text(
                    "Source disputed. The old answer stays stale; your question remains in the composer."
                )
            await revalidateAndDismissUnavailableCitation()
        } catch {
            let isTerminal = recordEvidenceReviewFailure(
                reviewKey,
                error: error
            )
            if !isTerminal { throw error }
            selectedCitation = nil
        }
    }

    private func retryEvidenceReview(_ operation: AgentEvidenceReviewOperation) {
        guard !sessionStore.activeEvidenceReviewKeys.contains(
            operation.idempotencyKey
        ) else {
            return
        }
        do {
            try sessionStore.markEvidenceReviewPending(operation.idempotencyKey)
            reviewPreparationError = nil
        } catch {
            reviewPreparationError = evidenceReviewFailureMessage(error)
            return
        }
        performEvidenceReview(operation)
    }

    private func performEvidenceReview(_ operation: AgentEvidenceReviewOperation) {
        guard sessionStore.claimEvidenceReview(operation.idempotencyKey) else {
            return
        }
        Task {
            defer {
                sessionStore.releaseEvidenceReview(operation.idempotencyKey)
            }
            do {
                let result = try await reviewEvidence(
                    operation.fragmentID,
                    operation.expectedReviewStatus,
                    operation.authorityReviewID,
                    operation.decision,
                    operation.reason,
                    operation.idempotencyKey
                )
                if !sessionStore.markEvidenceReviewApplied(
                    operation.idempotencyKey,
                    result: result
                ) {
                    reviewPreparationError = postReviewPersistenceMessage
                }
                await revalidateAndDismissUnavailableCitation()
            } catch {
                _ = recordEvidenceReviewFailure(
                    operation.idempotencyKey,
                    error: error
                )
            }
        }
    }

    private func submitReinstatement(_ prior: AgentEvidenceReviewOperation) {
        let reason = reinstatementReason.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !reason.isEmpty else { return }
        guard let authorityReviewID = prior.resultingReviewID else {
            reviewPreparationError = appLanguage.text(
                "Ask again before re-reviewing this older saved operation.",
                zhHans: "请先重新提问，再重新审阅这条较早保存的操作。"
            )
            return
        }
        let key = reviewIdempotencyKey(
            fragmentID: prior.fragmentID,
            expectedReviewStatus: "rejected",
            authorityToken: authorityReviewID,
            reason: reason,
            decision: "reviewed"
        )
        reinstatementReason = ""
        do {
            let operation = try sessionStore.beginEvidenceReview(
                idempotencyKey: key,
                basedOn: prior,
                expectedReviewStatus: "rejected",
                authorityReviewID: authorityReviewID,
                decision: "reviewed",
                reason: reason
            )
            reviewPreparationError = nil
            performEvidenceReview(operation)
        } catch {
            reviewPreparationError = evidenceReviewFailureMessage(error)
        }
    }

    private var postReviewPersistenceMessage: String {
        appLanguage.text(
            "The canonical review responded, but its protected local confirmation was not saved. Reconcile safely with the same operation key.",
            zhHans: "规范审阅已响应，但受保护的本地确认未能保存。请使用同一操作键安全核对。"
        )
    }

    private func evidenceReviewFailureMessage(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription
            ?? appLanguage.text(
                "The canonical review outcome is unknown. Retry uses the same operation key.",
                zhHans: "规范审阅结果尚不确定。重试会使用同一个操作键。"
            )
    }

    @discardableResult
    private func recordEvidenceReviewFailure(
        _ idempotencyKey: String,
        error: Error
    ) -> Bool {
        if let typed = error as? PursuitWorkspaceClientError,
           typed.isSupersededEvidenceReview {
            let didPersist = sessionStore.markEvidenceReviewSuperseded(
                idempotencyKey,
                message: appLanguage.text(
                    "A newer source decision is already current. This older operation cannot be retried.",
                    zhHans: "已有更新的来源决定生效。这条较早的操作不能再次重试。"
                )
            )
            if !didPersist {
                reviewPreparationError = appLanguage.text(
                    "A newer source decision is current, but this device could not save that notice. Ask again for current evidence.",
                    zhHans: "已有更新的来源决定生效，但此设备无法保存该提示。请重新提问以获取当前证据。"
                )
            }
            return true
        }
        let message = evidenceReviewFailureMessage(error)
        let didPersist: Bool
        if let typed = error as? PursuitWorkspaceClientError,
           case .backend = typed {
            didPersist = sessionStore.markEvidenceReviewFailed(
                idempotencyKey,
                message: message
            )
        } else {
            didPersist = sessionStore.markEvidenceReviewUnknown(
                idempotencyKey,
                message: message
            )
        }
        if !didPersist {
            reviewPreparationError = postReviewPersistenceMessage
        }
        return false
    }

    private var currentReviewOwner: AskCitationReviewOwner? {
        guard let activeSessionID, let selectedScope else { return nil }
        return AskCitationReviewOwner.current(session: sessionStore.session(id: activeSessionID),
            workspaceID: currentSnapshot.workspaceID, userID: currentSnapshot.currentUserID,
            personID: selectedScope.person.id, contextID: selectedScope.context.id)
    }

    private func refreshRecoveryCitation(_ requirement: AskCitationReviewRequirement) async throws -> AskCitationReviewRequirement {
        guard let owner = reviewRecoveryOwner, owner == currentReviewOwner,
              errorRecovery == .reviewSource(requirement) else { throw PursuitWorkspaceClientError.citedEvidenceUnavailable }
        let current = try await workspaceStore.refreshReviewRequirement(requirement,
            personID: owner.personID, contextID: owner.contextID)
        try Task.checkCancellation()
        guard reviewRecoveryOwner == owner, currentReviewOwner == owner,
              errorRecovery == .reviewSource(requirement) else { throw PursuitWorkspaceClientError.citedEvidenceUnavailable }
        return current
    }

    private func openRecoveryCitation(_ requirement: AskCitationReviewRequirement) async {
        do {
            let current = try await refreshRecoveryCitation(requirement)
            selectedCitation = SelectedAskCitation(taskID: current.taskID, citation: current.citation)
        } catch {
            guard errorRecovery == .reviewSource(requirement) else { return }
            selectedCitation = nil; reviewRecoveryOwner = nil; errorRecovery = .retry
            errorMessage = appLanguage.text("The source is no longer current. Ask again.", zhHans: "来源已变化，请重新提问。")
        }
    }

    private var selectedCitationIsCurrent: Bool {
        guard isCanonical, let selectedCitation else { return true }
        if case let .reviewSource(requirement) = errorRecovery,
           reviewRecoveryOwner != nil, reviewRecoveryOwner == currentReviewOwner,
           requirement.taskID == selectedCitation.taskID,
           requirement.citation.id == selectedCitation.citation.id { return true }
        return sessionStore.validationTargets().contains { target in
            target.taskID == selectedCitation.taskID
                && target.response.citations.contains {
                    $0.id == selectedCitation.citation.id
                }
        }
    }

    private func revalidateAndDismissUnavailableCitation() async {
        await revalidateSessions()
        if case let .reviewSource(requirement) = errorRecovery {
            do { _ = try await refreshRecoveryCitation(requirement) }
            catch {
                if errorRecovery == .reviewSource(requirement) {
                    selectedCitation = nil; reviewRecoveryOwner = nil; errorRecovery = .retry
                    errorMessage = appLanguage.text("The source is no longer current. Ask again.", zhHans: "来源已变化，请重新提问。")
                }
            }
        }
        if !selectedCitationIsCurrent { selectedCitation = nil }
    }
}

private struct ShareReviewTarget: Identifiable, Equatable {
    let id: UUID
}

private struct AgentSessionShareReviewSheet: View {
    let session: AgentSession?
    let language: AppLanguage
    @Environment(\.dismiss) private var dismiss
    @State private var scope: AgentSessionShareScope = .summary
    @State private var renderedCard: AgentSessionRenderedShareCard?

    private var availability: AgentSessionShareAvailability {
        guard let session else {
            return .unavailable(language.text("This Session is no longer available."))
        }
        return AgentSessionSharePolicy.availability(for: session, scope: scope, language: language)
    }

    private var allowsConversation: Bool {
        session.map(AgentSessionSharePolicy.allowsConversation) ?? false
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    scopeChoice
                    switch availability {
                    case let .available(snapshot):
                        previewCard(snapshot)
                        safetyDisclosure
                        shareControl(snapshot)
                    case let .unavailable(reason):
                        unavailableNotice(reason)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color.tsSurface.ignoresSafeArea())
            .navigationTitle(language.text("Review before sharing"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(language.text("Close")) { dismiss() }
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityIdentifier("ask-share-close")
                }
            }
        }
        .task(id: renderKey) {
            renderedCard = nil
            renderCard(expectedKey: renderKey)
        }
        .accessibilityIdentifier("ask-share-review-sheet")
    }

    private var renderKey: String {
        guard let session,
              let snapshot = AgentSessionSharePolicy.availability(
                for: session,
                scope: .summary,
                language: language
              ).snapshot else {
            return "unavailable-\(session?.id.uuidString ?? "none")-\(language.rawValue)"
        }
        return AgentSessionSharePolicy.alternateText(snapshot, language: language)
    }

    private var scopeChoice: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(language.text("WHAT TO SHARE"))
                .font(.caption2.weight(.bold))
                .tracking(1.15)
                .foregroundStyle(Color.tsVermilion)
            scopeButton(
                .summary,
                title: language.text("Visual summary"),
                detail: language.text("Scope, latest saved answer, and status."),
                identifier: "ask-share-scope-summary"
            )
            scopeButton(
                .conversation,
                title: language.text("Readable conversation"),
                detail: allowsConversation
                    ? language.text("Your objectives and safe answers only.")
                    : language.text("Not available for identity review."),
                identifier: "ask-share-scope-conversation"
            )
        }
    }

    private func scopeButton(
        _ value: AgentSessionShareScope,
        title: String,
        detail: String,
        identifier: String
    ) -> some View {
        let isEnabled = value == .summary || allowsConversation
        let isSelected = scope == value
        return Button {
            scope = value
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                    .font(.body)
                    .foregroundStyle(isSelected ? Color.tsVermilion : Color.tsMutedInk)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(minHeight: 44, alignment: .leading)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 16))
            .overlay {
                RoundedRectangle(cornerRadius: 16)
                    .stroke(isSelected ? Color.tsVermilion : Color.tsLine, lineWidth: isSelected ? 1.5 : 1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityLabel("\(title). \(detail)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(identifier)
    }

    private func previewCard(_ snapshot: AgentSessionShareSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(language.text("PREVIEW"))
                .font(.caption2.weight(.bold))
                .tracking(1.15)
                .foregroundStyle(Color.tsVermilion)
            if snapshot.isSummary {
                AgentSessionShareCardPreview(snapshot: snapshot, language: language)
                    .environment(\.colorScheme, .light)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                    .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("ask-share-preview")
            } else {
                conversationPreview(snapshot)
            }
        }
    }

    private func conversationPreview(_ snapshot: AgentSessionShareSnapshot) -> some View {
        return VStack(alignment: .leading, spacing: 12) {
            Text(snapshot.title)
                .font(.headline)
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
            Text(snapshot.contextLabel)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
            Divider()
            ForEach(snapshot.conversationLines) { line in
                VStack(alignment: .leading, spacing: 3) {
                    Text(line.isObjective
                        ? language.text("You")
                        : language.text("Agent"))
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color.tsMutedInk)
                    Text(line.text)
                        .font(.callout)
                        .foregroundStyle(Color.tsInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if snapshot.conversationWasTruncated {
                Label(
                    AgentSessionSharePolicy.conversationLimitLabel(language: language),
                    systemImage: "text.badge.minus"
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            Text("\(snapshot.updatedLabel) · \(snapshot.statusLabel)")
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .stroke(Color.tsLine, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-share-conversation-preview")
    }

    private var safetyDisclosure: some View {
        Label(
            language.text("This is a static copy. Sources, pending decisions, and action authority are omitted, and nothing here can continue the Session."),
            systemImage: "lock.shield"
        )
        .font(.caption)
        .foregroundStyle(Color.tsMutedInk)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("ask-share-safety-disclosure")
    }

    @ViewBuilder
    private func shareControl(_ snapshot: AgentSessionShareSnapshot) -> some View {
        if let renderedCard, renderedCard.key == renderKey {
            if snapshot.isSummary {
                ShareLink(
                    item: renderedCard.item,
                    subject: Text(snapshot.title),
                    preview: SharePreview(snapshot.title, image: renderedCard.image)
                ) {
                    shareLabel(language.text("Share summary card"))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(language.text("Share summary card"))
                .accessibilityIdentifier("ask-share-link")
            } else {
                ShareLink(
                    item: AgentSessionSharePolicy.alternateText(snapshot, language: language),
                    subject: Text(snapshot.title),
                    preview: SharePreview(snapshot.title, image: renderedCard.image)
                ) {
                    shareLabel(language.text("Share readable conversation"))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(language.text("Share readable conversation"))
                .accessibilityIdentifier("ask-share-link")
            }
        }
    }

    private func shareLabel(_ title: String) -> some View {
        Label(title, systemImage: "square.and.arrow.up")
            .font(.subheadline.weight(.bold))
            .foregroundStyle(Color.tsSurface)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Color.tsInk, in: RoundedRectangle(cornerRadius: 16))
    }

    private func unavailableNotice(_ reason: String) -> some View {
        Label(reason, systemImage: "exclamationmark.circle")
            .font(.subheadline)
            .foregroundStyle(Color.tsInk)
            .fixedSize(horizontal: false, vertical: true)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 16))
            .accessibilityIdentifier("ask-share-unavailable")
    }

    @MainActor
    private func renderCard(expectedKey: String) {
        guard let session,
              let snapshot = AgentSessionSharePolicy.availability(
                for: session, scope: .summary, language: language
              ).snapshot else {
            return
        }
        let renderer = ImageRenderer(
            content: AgentSessionShareCardPreview(snapshot: snapshot, language: language)
                .environment(\.colorScheme, .light)
                .frame(width: 420)
                .padding(24)
                .background(AgentSessionShareCardPalette.canvas)
        )
        renderer.scale = 3
        guard expectedKey == renderKey,
              let uiImage = renderer.uiImage,
              let pngData = uiImage.pngData() else { return }
        renderedCard = AgentSessionRenderedShareCard(
            key: expectedKey,
            image: Image(uiImage: uiImage),
            item: AgentSessionShareCardItem(
                pngData: pngData,
                alternateText: AgentSessionSharePolicy.alternateText(snapshot, language: language)
            )
        )
    }
}

private struct AgentSessionRenderedShareCard {
    let key: String
    let image: Image
    let item: AgentSessionShareCardItem
}

/// A single share item with both visual and readable representations. Targets
/// that accept images receive the reviewed card; text-oriented targets and
/// assistive workflows can request the exact reviewed alternate text.
private struct AgentSessionShareCardItem: Transferable {
    let pngData: Data
    let alternateText: String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .png) { item in
            item.pngData
        }
        ProxyRepresentation { item in item.alternateText }
    }
}

/// Stable light palette so the exported card never changes appearance with the
/// device theme.
private enum AgentSessionShareCardPalette {
    static let canvas = Color(red: 0.949, green: 0.945, blue: 0.929)
    static let surface = Color(red: 0.98, green: 0.976, blue: 0.961)
    static let ink = Color(red: 0.094, green: 0.094, blue: 0.086)
    static let mutedInk = Color(red: 0.36, green: 0.35, blue: 0.32)
    static let vermilion = Color(red: 0.78, green: 0.22, blue: 0.15)
    static let line = Color(red: 0.094, green: 0.094, blue: 0.086).opacity(0.14)
}

/// The exported artifact. It renders the same bounded snapshot the policy
/// allows, never live Session state.
private struct AgentSessionShareCardPreview: View {
    let snapshot: AgentSessionShareSnapshot
    let language: AppLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(language.text("TALENT SIGNAL"))
                .font(.caption2.weight(.bold))
                .tracking(1.4)
                .foregroundStyle(AgentSessionShareCardPalette.vermilion)
            Text(snapshot.title)
                .font(.title3.weight(.bold))
                .foregroundStyle(AgentSessionShareCardPalette.ink)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("ask-share-preview-title")
            Text(snapshot.contextLabel)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AgentSessionShareCardPalette.mutedInk)
                .accessibilityIdentifier("ask-share-preview-context")

            Text(snapshot.excerpt)
                .font(.body)
                .foregroundStyle(AgentSessionShareCardPalette.ink)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AgentSessionShareCardPalette.surface, in: RoundedRectangle(cornerRadius: 14))
                .overlay {
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(AgentSessionShareCardPalette.line, lineWidth: 1)
                }
                .accessibilityIdentifier("ask-share-preview-excerpt")

            HStack(spacing: 8) {
                Text(snapshot.statusLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AgentSessionShareCardPalette.mutedInk)
                Spacer(minLength: 8)
                Text(snapshot.updatedLabel)
                    .font(.caption)
                    .foregroundStyle(AgentSessionShareCardPalette.mutedInk)
            }
            .accessibilityIdentifier("ask-share-preview-status")

            Text(language.text("Static copy · sources, pending decisions, and action authority omitted."))
            .font(.caption2)
            .foregroundStyle(AgentSessionShareCardPalette.mutedInk)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AgentSessionShareCardPalette.canvas, in: RoundedRectangle(cornerRadius: 18))
    }
}

private struct ConversationContactProposalTurn: View {
    @Binding var draft: ConversationContactDraft
    let candidates: [WorkspacePerson]
    let lookupPhase: ConversationContactLookupPhase
    @Binding var selectedPersonID: String?
    @Binding var selectedContextID: String?
    @Binding var createDistinct: Bool
    @Binding var saveForIdentityReview: Bool
    @Binding var confirmIdentityClue: Bool
    let hasPendingWrite: Bool
    let isSaving: Bool
    let saveMessage: String?
    let errorMessage: String?
    let isCanonical: Bool
    let isCurrent: Bool
    let language: AppLanguage
    let onConfirm: () -> Void
    let onRetryLookup: () -> Void
    let onCancel: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.sizeCategory) private var sizeCategory
    @State private var showsAllMatches = false
    @State private var editsDetails = false

    private var selectedPerson: WorkspacePerson? {
        candidates.first { $0.id == selectedPersonID }
    }

    private var canConfirm: Bool {
        isCanonical
            && isCurrent
            && !isSaving
            && lookupPhase == .complete
            && !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !draft.relationshipContext.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).isEmpty
            && (hasPendingWrite || (
                saveForIdentityReview
                    || candidates.isEmpty
                    || (createDistinct && !hasCurrentHistoricalConflict)
                    || selectedPersonID != nil
            ))
            && saveMessage == nil
    }

    private var hasCurrentHistoricalConflict: Bool {
        ConversationContactMatchPolicy.hasCurrentHistoricalConflict(in: candidates)
    }

    private var isReadOnly: Bool {
        !isCurrent || hasPendingWrite || saveMessage != nil
    }

    private var confirmButtonEmphasized: Bool {
        canConfirm || isSaving
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 0) {
                proposalCard
                    .frame(
                        maxWidth: dynamicTypeSize.isAccessibilitySize
                            || sizeCategory.isAccessibilityCategory
                            ? .infinity
                            : 344,
                        alignment: .leading
                    )
                Spacer(minLength: 0)
            }
        }
    }

    private var proposalCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Label(
                        language.text("Contact"),
                        systemImage: "person.crop.circle.badge.plus"
                    )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsMutedInk)

                    Text(proposalTitle)
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("contact-proposal-title")
                }
                Spacer(minLength: 8)
                Button(action: onCancel) {
                    Text(language.text(isCurrent ? "Not a contact" : "Dismiss"))
                        .font(.caption)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
                .disabled(isSaving || (isCurrent && hasPendingWrite && saveMessage == nil))
                .opacity(isSaving || (isCurrent && hasPendingWrite && saveMessage == nil) ? 0.42 : 1)
                .accessibilityLabel(language.text(isCurrent ? "Not a contact" : "Dismiss"))
                .accessibilityIdentifier("contact-dismiss-proposal")
            }

            if let saveMessage {
                completedReceipt(saveMessage)
            } else if !isCurrent {
                contactDetails
                sourceDetails
                Label(
                    language.text("This proposal has ended. Its source remains in the Session. Send a new message to review a current proposal."),
                    systemImage: "clock.badge.exclamationmark"
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("contact-proposal-ended")
            } else {
                contactDetails
                sourceDetails
                reviewedPublicProfileDetails

                if let clue = draft.identityClue {
                    Toggle(isOn: $confirmIdentityClue) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: "\(identityClueLabel(clue)) · \(clue.value)")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.tsInk)
                                .textSelection(.enabled)
                            Text(
                                language.text(
                                    "Include this identity clue when you confirm"
                                )
                            )
                            .font(.caption)
                            .foregroundStyle(Color.tsMutedInk)
                        }
                    }
                    .tint(Color.tsVermilion)
                    .disabled(isReadOnly)
                    .accessibilityIdentifier("contact-confirm-identity-clue")
                }

                if hasPendingWrite {
                    Label(
                        language.text(
                            "Previous outcome is unknown · retry is locked to the original operation"
                        ),
                        systemImage: "arrow.triangle.2.circlepath"
                    )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 14))
                    .accessibilityIdentifier("contact-pending-write-boundary")
                }

                identityReview
                    .id("contact-identity-state")

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.circle")
                        .font(.caption)
                        .foregroundStyle(Color.tsVermilion)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("contact-save-error")
                }

                Button {
                    editsDetails = false
                    onConfirm()
                } label: {
                    HStack(spacing: 8) {
                        if isSaving {
                            ProgressView()
                                .tint(Color.tsSurface)
                        }
                        Text(confirmTitle)
                            .font(.subheadline.weight(.bold))
                        Spacer()
                        Image(systemName: "arrow.right")
                            .font(.subheadline.weight(.bold))
                    }
                    .foregroundStyle(
                        confirmButtonEmphasized ? Color.tsSurface : Color.tsMutedInk
                    )
                    .padding(.horizontal, 16)
                    .frame(minHeight: 50)
                    .background(
                        confirmButtonEmphasized ? Color.tsInk : Color.tsCanvas,
                        in: RoundedRectangle(cornerRadius: 16)
                    )
                    .overlay {
                        if !confirmButtonEmphasized {
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(Color.tsLine, lineWidth: 1)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(!canConfirm)
                .accessibilityIdentifier("contact-confirm-save")
            }

            Label(
                hasPendingWrite && saveMessage == nil
                    ? language.text("The save outcome needs checking. Check or retry the original operation.")
                    : !isCurrent && saveMessage == nil
                    ? language.text("Proposal ended")
                    : saveMessage == nil
                    ? language.text(
                        "Proposed only · nothing changes until you confirm",
                        zhHans: "仅为提议 · 确认前不会发生任何更改"
                    )
                    : language.text(
                        "Saved with canonical receipt · source remains traceable"
                    ),
                systemImage: hasPendingWrite && saveMessage == nil ? "arrow.clockwise" : saveMessage == nil ? "lock.shield" : "checkmark.shield"
            )
            .font(.caption2)
            .foregroundStyle(Color.tsMutedInk)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(
                saveMessage == nil ? "contact-proposal-boundary" : "contact-receipt-boundary"
            )
        }
        .padding(16)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.tsLine, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("contact-proposal-card")
    }

    private var sourceDetails: some View {
        DisclosureGroup(language.text("Source message")) {
            Text(verbatim: draft.sourceNote)
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
            ForEach(Array((draft.fieldEvidence ?? []).enumerated()), id: \.offset) { _, evidence in
                VStack(alignment: .leading, spacing: 3) {
                    Text(fieldEvidenceLabel(evidence.field)).font(.caption.weight(.semibold))
                    Text(verbatim: "“\(evidence.exactExcerpt)”").font(.caption)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
            }
        }
        .font(.caption)
        .accessibilityIdentifier("contact-proposal-source")
    }

    private func fieldEvidenceLabel(_ field: ConversationContactDraft.FieldEvidence.Field) -> String {
        switch field {
        case .name: return language.text("Name")
        case .identityClue: return language.text("Identity clue")
        case .relationshipContext: return language.text("Relationship")
        }
    }

    private func completedReceipt(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            contactDetails
            reviewedPublicProfileDetails

            if let clue = draft.identityClue {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: "\(identityClueLabel(clue)) · \(clue.value)")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.tsInk)
                            .textSelection(.enabled)
                        Text(
                            language.text(
                                confirmIdentityClue
                                    ? "Included in the saved source"
                                    : "Not included in the saved source"
                            )
                        )
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                    }
                } icon: {
                    Image(
                        systemName: confirmIdentityClue
                            ? "checkmark.circle.fill"
                            : "minus.circle"
                    )
                    .foregroundStyle(
                        confirmIdentityClue ? Color.tsVermilion : Color.tsMutedInk
                    )
                }
                .accessibilityIdentifier("contact-saved-identity-clue")
            }

            Label {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.tsInk)
            }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 16))
                .accessibilityIdentifier("contact-save-success")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("contact-completed-receipt")
    }

    private var proposalTitle: String {
        if saveMessage != nil {
            return language.text("Contact saved")
        }
        if !isCurrent { return language.text("Proposal ended") }
        if hasPendingWrite {
            return language.text("Confirm the original save")
        }
        guard isCanonical else {
            return language.text("Review this contact")
        }
        switch lookupPhase {
        case .idle:
            return language.text("Review this contact")
        case .checking:
            return language.text("Checking existing contacts")
        case .failed:
            return language.text("Identity check needs retry")
        case .complete:
            if hasCurrentHistoricalConflict {
                return language.text("Identity needs review")
            }
            if candidates.isEmpty {
                return language.text("Create a new contact?")
            }
            if selectedPersonID != nil {
                return language.text("Add to the existing contact?")
            }
            return language.text("Choose the existing contact")
        }
    }

    @ViewBuilder
    private var contactDetails: some View {
        if editsDetails {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(language.text("Name"))
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                    TextField(
                        language.text("Contact name", zhHans: "联系人姓名"),
                        text: $draft.name
                    )
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.next)
                    .disabled(isReadOnly)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("contact-proposal-name")
                }

                VStack(alignment: .leading, spacing: 5) {
                    Text(language.text("Relationship"))
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                    TextField(
                        language.text("Relationship", zhHans: "关系"),
                        text: $draft.relationshipContext
                    )
                    .font(.body)
                    .foregroundStyle(Color.tsInk)
                    .submitLabel(.done)
                    .disabled(isReadOnly)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("contact-proposal-relationship")
                }

                Button {
                    editsDetails = false
                } label: {
                    Label(
                        language.text("Done editing"),
                        systemImage: "checkmark"
                    )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .disabled(isReadOnly)
                .accessibilityIdentifier("contact-finish-details")
            }
            .padding(14)
            .background(Color.tsSurface.opacity(0.72), in: RoundedRectangle(cornerRadius: 16))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("contact-details-editor")
        } else {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(
                        draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? language.text("Name needed")
                            : draft.name
                    )
                    .font(.headline)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("contact-summary-name")

                    Text(
                        draft.relationshipContext.trimmingCharacters(
                            in: .whitespacesAndNewlines
                        ).isEmpty
                            ? language.text("Relationship needed")
                            : draft.relationshipContext
                    )
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("contact-summary-relationship")
                }
                .layoutPriority(1)

                Spacer(minLength: 4)

                if !isReadOnly {
                    Button {
                        editsDetails = true
                    } label: {
                        Label(
                            language.text("Edit"),
                            systemImage: "pencil"
                        )
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
                    .accessibilityLabel(language.text("Edit contact details"))
                    .accessibilityIdentifier("contact-edit-details")
                }
            }
            .padding(.vertical, 2)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("contact-proposal-summary")
        }
    }

    @ViewBuilder
    private var reviewedPublicProfileDetails: some View {
        if let profile = draft.reviewedPublicProfile {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 10) {
                    reviewedProfileAvatar(profile)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(profile.displayName)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.tsInk)
                            Spacer(minLength: 4)
                            Text(language.text("Unconfirmed source"))
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(Color.tsVermilion)
                        }
                        Text(
                            [profile.platform.capitalized, profile.handle]
                                .compactMap { $0 }
                                .joined(separator: " · ")
                        )
                        .font(.caption2)
                        .foregroundStyle(Color.tsMutedInk)
                        Text(profile.matchBasis)
                            .font(.caption2)
                            .foregroundStyle(Color.tsMutedInk)
                            .lineLimit(3)
                    }
                }

                if let profileURL = httpsURL(profile.profileURL) {
                    Link(destination: profileURL) {
                        Label(
                            language.text("Open source"),
                            systemImage: "arrow.up.right.square"
                        )
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.tsInk)
                    .accessibilityIdentifier("contact-public-profile-source")
                }

                VStack(alignment: .leading, spacing: 5) {
                    Text(language.text("Card headline"))
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                    TextField(
                        language.text("Optional title, role, or company"),
                        text: reviewedProfileHeadlineBinding
                    )
                    .font(.subheadline)
                    .foregroundStyle(Color.tsInk)
                    .disabled(isReadOnly)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("contact-public-profile-headline")
                }

                if profile.avatarDisplayPolicy == "display_and_store",
                   profile.avatarRightsBasis != nil,
                   profile.avatarURL.flatMap(httpsURL) != nil {
                    Toggle(isOn: reviewedProfileAvatarBinding) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(language.text("Use this public avatar"))
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.tsInk)
                            Text(
                                language.text(
                                    "It appears on the person card only after this contact is confirmed"
                                )
                            )
                            .font(.caption)
                            .foregroundStyle(Color.tsMutedInk)
                        }
                    }
                    .tint(Color.tsVermilion)
                    .disabled(isReadOnly)
                    .accessibilityIdentifier("contact-public-profile-avatar-toggle")
                } else if profile.avatarURL != nil {
                    Label(
                        language.text(
                            "Avatar remains at source because display rights are unavailable"
                        ),
                        systemImage: "photo.badge.exclamationmark"
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                }

                Label(
                    language.text(
                        "Profile fields stay proposed until the contact save is confirmed"
                    ),
                    systemImage: "lock.shield"
                )
                .font(.caption2)
                .foregroundStyle(Color.tsMutedInk)
            }
            .padding(12)
            .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 16))
            .overlay {
                RoundedRectangle(cornerRadius: 16)
                    .stroke(Color.tsLine, lineWidth: 1)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("contact-public-profile-review")
        }
    }

    private var reviewedProfileHeadlineBinding: Binding<String> {
        Binding(
            get: { draft.reviewedPublicProfile?.cardHeadline ?? "" },
            set: { value in
                guard var profile = draft.reviewedPublicProfile else { return }
                profile.cardHeadline = String(value.prefix(240))
                draft.reviewedPublicProfile = profile
            }
        )
    }

    private var reviewedProfileAvatarBinding: Binding<Bool> {
        Binding(
            get: { draft.reviewedPublicProfile?.includeAvatar ?? false },
            set: { value in
                guard var profile = draft.reviewedPublicProfile else { return }
                profile.includeAvatar = value
                draft.reviewedPublicProfile = profile
            }
        )
    }

    @ViewBuilder
    private func reviewedProfileAvatar(
        _ profile: ConversationContactDraft.ReviewedPublicProfile
    ) -> some View {
        if profile.avatarDisplayPolicy == "display_and_store",
           profile.avatarRightsBasis != nil,
           let avatarURL = profile.avatarURL.flatMap(httpsURL) {
            AsyncImage(url: avatarURL) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                RelationshipInitials(
                    initials: String(profile.displayName.prefix(2)).uppercased(),
                    size: 40
                )
            }
            .frame(width: 40, height: 40)
            .clipShape(Circle())
            .overlay { Circle().stroke(Color.tsLine, lineWidth: 1) }
            .overlay(alignment: .bottomTrailing) {
                Image(systemName: "questionmark.circle.fill")
                    .font(.caption2)
                    .foregroundStyle(Color.tsVermilion)
                    .background(Color.tsCanvas, in: Circle())
            }
            .accessibilityLabel(language.text("Unconfirmed public avatar"))
        } else {
            RelationshipInitials(
                initials: String(profile.displayName.prefix(2)).uppercased(),
                size: 40
            )
            .accessibilityHidden(true)
        }
    }

    private func httpsURL(_ value: String) -> URL? {
        guard let url = URL(string: value),
              url.scheme?.lowercased() == "https",
              url.host != nil else { return nil }
        return url
    }

    @ViewBuilder
    private var identityReview: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(
                language.text("Identity check"),
                systemImage: "person.text.rectangle"
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.tsInk)

            if !isCanonical {
                Label(
                    language.text(
                        "Workspace readback is unavailable. Edit safely here; identity checking and save stay disabled.",
                        zhHans: "工作区回读暂不可用；你仍可安全编辑，但身份检查和保存保持禁用。"
                    ),
                    systemImage: "exclamationmark.shield"
                )
                .font(.subheadline)
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("contact-workspace-unavailable")
            } else if lookupPhase == .checking {
                Label {
                    Text(
                        language.text(
                            "Checking confirmed identity clues…"
                        )
                    )
                } icon: {
                    ProgressView()
                }
                .font(.subheadline)
                .foregroundStyle(Color.tsInk)
                .accessibilityIdentifier("contact-identity-checking")
            } else if case let .failed(message) = lookupPhase {
                VStack(alignment: .leading, spacing: 8) {
                    Label(message, systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                        .font(.subheadline)
                        .foregroundStyle(Color.tsInk)
                        .fixedSize(horizontal: false, vertical: true)
                    Button(action: onRetryLookup) {
                        Text(language.text("Retry identity check"))
                            .font(.caption.weight(.semibold))
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("contact-retry-identity-check")
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("contact-identity-check-failed")
            } else if candidates.isEmpty {
                Label(
                    language.text(
                        draft.identityClue == nil
                            ? "No same-name page found · no identity clue to verify"
                            : "No confirmed identity match · ready to create after review"
                    ),
                    systemImage: "checkmark.circle"
                )
                .font(.subheadline)
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("contact-identity-no-match")
            } else {
                Text(
                    language.text(
                        hasCurrentHistoricalConflict
                            ? "Current and historical owners differ · choose the current owner or keep this unresolved"
                            : draft.identityClue == nil
                                ? "Same-name review only · names do not prove identity"
                                : "Possible identity matches · none selected"
                    )
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("contact-no-preselection")

                ForEach(visibleCandidates) { person in
                    let policyAllowsSelection = ConversationContactMatchPolicy.canSelect(
                        person,
                        among: candidates
                    )
                    let selectionAllowed = !isReadOnly && policyAllowsSelection
                    Button {
                        guard selectionAllowed else { return }
                        selectedPersonID = person.id
                        selectedContextID = matchingContext(in: person)?.id
                        createDistinct = false
                        saveForIdentityReview = false
                    } label: {
                        HStack(spacing: 12) {
                            Text(initials(person.displayLabel))
                                .font(.caption.weight(.bold))
                                .foregroundStyle(Color.tsVermilion)
                                .frame(width: 36, height: 36)
                                .background(Color.tsVermilion.opacity(0.1), in: Circle())
                            VStack(alignment: .leading, spacing: 2) {
                                Text(person.displayLabel)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Color.tsInk)
                                Text(
                                    matchDetail(for: person)
                                )
                                .font(.caption)
                                .foregroundStyle(Color.tsMutedInk)
                            }
                            Spacer()
                            Image(
                                systemName: selectionAllowed
                                    ? selectedPersonID == person.id
                                        ? "checkmark.circle.fill"
                                        : "circle"
                                    : policyAllowsSelection
                                        ? "lock.circle"
                                        : "clock.arrow.circlepath"
                            )
                            .foregroundStyle(
                                selectionAllowed && selectedPersonID == person.id
                                    ? Color.tsVermilion
                                    : Color.tsMutedInk.opacity(0.5)
                            )
                        }
                        .padding(12)
                        .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)
                    .disabled(!selectionAllowed)
                    .opacity(selectionAllowed ? 1 : 0.72)
                    .accessibilityIdentifier("contact-match-\(person.id)")
                    .accessibilityValue(
                        selectionAllowed
                            ? ""
                            : policyAllowsSelection
                                ? language.text(
                                    saveMessage == nil
                                        ? "Original operation locked · selection disabled"
                                        : "Saved receipt · selection disabled"
                                )
                                : language.text(
                                    "Historical ownership only · selection disabled"
                                )
                    )
                }

                if candidates.count > 3, !showsAllMatches {
                    Button {
                        showsAllMatches = true
                    } label: {
                        Text(
                            language.text(
                                "Show \(candidates.count - 3) more matches",
                                zhHans: "显示另外 \(candidates.count - 3) 个匹配项"
                            )
                        )
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("contact-show-all-matches")
                }

                if let selectedPerson {
                    relationshipChoices(for: selectedPerson)
                        .disabled(isReadOnly)
                }

                if hasCurrentHistoricalConflict {
                    VStack(alignment: .leading, spacing: 6) {
                        Button {
                            saveForIdentityReview.toggle()
                            if saveForIdentityReview {
                                selectedPersonID = nil
                                selectedContextID = nil
                                createDistinct = false
                            }
                        } label: {
                            Label(
                                language.text("Save for identity review"),
                                systemImage: saveForIdentityReview
                                    ? "checkmark.square.fill"
                                    : "square"
                            )
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(
                                saveForIdentityReview ? Color.tsVermilion : Color.tsInk
                            )
                            .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .disabled(isReadOnly)
                        .accessibilityIdentifier("contact-save-for-identity-review")

                        Button {
                            draft.identityClue = nil
                        } label: {
                            Label(
                                language.text("Remove identity clue and review by name"),
                                systemImage: "minus.circle"
                            )
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.tsInk)
                            .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .disabled(isReadOnly)
                        .accessibilityIdentifier("contact-remove-identity-clue")
                    }
                } else {
                    Button {
                        createDistinct.toggle()
                        if createDistinct {
                            selectedPersonID = nil
                            selectedContextID = nil
                            saveForIdentityReview = false
                        }
                    } label: {
                        Label(
                            language.text(
                                saveMessage == nil
                                    ? "Create as a separate person"
                                    : "Created as a separate person"
                            ),
                            systemImage: createDistinct
                                ? "checkmark.square.fill"
                                : "square"
                        )
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(createDistinct ? Color.tsVermilion : Color.tsInk)
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .disabled(isReadOnly)
                    .accessibilityIdentifier("contact-create-distinct")
                }
            }
        }
    }

    private func relationshipChoices(for person: WorkspacePerson) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(language.text("Add to relationship", zhHans: "添加到关系"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
            ForEach(person.contexts.prefix(3)) { context in
                Button {
                    selectedContextID = context.id
                } label: {
                    Label(
                        context.displayLabel,
                        systemImage: selectedContextID == context.id
                            ? "checkmark.circle.fill"
                            : "circle"
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsInk)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.plain)
            }
            Button {
                selectedContextID = nil
            } label: {
                Label(
                    language.text(
                        "New · \(draft.relationshipContext)",
                        zhHans: "新关系 · \(draft.relationshipContext)"
                    ),
                    systemImage: selectedContextID == nil
                        ? "checkmark.circle.fill"
                        : "circle"
                )
                .font(.caption)
                .foregroundStyle(Color.tsInk)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .buttonStyle(.plain)
        }
        .padding(.leading, 12)
    }

    private var confirmTitle: String {
        if hasPendingWrite {
            return language.text(
                "Retry same operation"
            )
        }
        if saveForIdentityReview {
            return language.text("Save for identity review")
        }
        if candidates.isEmpty || createDistinct {
            return language.text("Create contact", zhHans: "创建联系人")
        }
        return language.text("Add to existing contact", zhHans: "添加到现有联系人")
    }

    private var visibleCandidates: [WorkspacePerson] {
        showsAllMatches ? candidates : Array(candidates.prefix(3))
    }

    private func matchDetail(for person: WorkspacePerson) -> String {
        if let match = person.identityMatches.first(where: {
            $0.kind == "confirmed_handle" || $0.kind == "expired_handle"
        }) {
            let status = match.kind == "confirmed_handle"
                ? language.text("Confirmed", zhHans: "已确认")
                : language.text("Needs fresh confirmation", zhHans: "需要重新确认")
            let type = match.handleType.map { handleType in
                switch handleType {
                case "email": return language.text("email", zhHans: "邮箱")
                case "phone": return language.text("phone", zhHans: "电话")
                case "linkedin_url": return "LinkedIn"
                default: return language.text("identity clue", zhHans: "身份线索")
                }
            } ?? language.text("identity clue", zhHans: "身份线索")
            if let displayHint = match.displayHint {
                return "\(status) \(type) · \(displayHint)"
            }
            return "\(status) \(type)"
        }
        return language.text(
            "Same name · \(person.contextCount) relationship\(person.contextCount == 1 ? "" : "s")",
            zhHans: "同名 · \(person.contextCount) 段关系"
        )
    }

    private func identityClueLabel(
        _ clue: ConversationContactDraft.IdentityClue
    ) -> String {
        switch clue.type {
        case "email": return language.text("Email", zhHans: "邮箱")
        case "phone": return language.text("Phone", zhHans: "电话")
        case "linkedin_url": return "LinkedIn"
        default: return language.text("Identity clue", zhHans: "身份线索")
        }
    }

    private func matchingContext(in person: WorkspacePerson) -> WorkspacePerson.Context? {
        let target = draft.relationshipContext.folding(
            options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
            locale: .current
        )
        return person.contexts.first {
            $0.displayLabel.folding(
                options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
                locale: .current
            ) == target
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ")
        let value = String(parts.prefix(2).compactMap(\.first))
        return value.isEmpty ? String(name.prefix(2)) : value.uppercased()
    }
}

private enum AgentConversationItem: Identifiable {
    case contactReceipt(AgentContactReceipt)
    case ask(AgentSessionTurn)

    var id: String {
        switch self {
        case let .contactReceipt(receipt):
            return "contact-receipt-\(receipt.id.uuidString)"
        case let .ask(turn):
            return "ask-turn-\(turn.id.uuidString)"
        }
    }

    var createdAt: Date {
        switch self {
        case let .contactReceipt(receipt): return receipt.createdAt
        case let .ask(turn): return turn.createdAt
        }
    }

    var responseScrollTargetID: String {
        guard case let .ask(turn) = self else { return id }
        let answer = turn.response.blocks.first {
            ["answer", "question_set", "clarification", "failure_recovery"]
                .contains($0.kind)
        } ?? turn.response.blocks.first
        return answer.map { "ask-response-block-\($0.id)" } ?? id
    }
}

private struct AskScope: Identifiable, Equatable {
    let person: WorkspacePerson
    let context: WorkspacePerson.Context
    var id: String { "\(person.id):\(context.id)" }
}

private struct SelectedAskCitation: Identifiable {
    let taskID: String
    let citation: RelationshipAskResponse.Citation
    var id: String { "\(taskID):\(citation.id)" }
}

private struct SelectedPursuitTarget: Identifiable {
    let pursuit: WorkspacePursuit
    let actionID: String
    var id: String { "\(pursuit.id):\(actionID)" }
}

private struct AskPendingTurnView: View {
    let message: String
    let mediaDrafts: [AskMediaDraft]
    let language: AppLanguage
    let recallPhase: RelationshipRecallPhase
    let onChooseCandidate: (AgentRelationshipRecallCandidate) -> Void
    let onChangeMatch: () -> Void
    let onContinueWithoutRelationship: () -> Void
    @State private var recallQuery = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .trailing, spacing: 7) {
                if !mediaDrafts.isEmpty {
                    AskPendingMediaStrip(
                        drafts: mediaDrafts,
                        language: language
                    )
                }
                AskUserMessageBubble(message: message)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)

            recallContent
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-pending-turn")
    }

    @ViewBuilder
    private var recallContent: some View {
        switch recallPhase {
        case .idle:
            EmptyView()
        case let .reading(candidate):
            if let candidate { matchedReceipt(candidate, allowsChange: true) }
            activityRow(
                language.text("Reading the current record…")
            )
            .accessibilityIdentifier("ask-loading")
        case .replyingWithoutRelationship:
            activityRow(
                language.text(
                    "Replying without opening a relationship…"
                )
            )
            .accessibilityIdentifier("ask-unscoped-loading")
        case let .ambiguous(candidates, possibleDuplicate):
            candidateDecision(
                candidates: candidates,
                possibleDuplicate: possibleDuplicate,
                isFallback: false
            )
        case let .unresolved(recent):
            candidateDecision(
                candidates: recent,
                possibleDuplicate: false,
                isFallback: true
            )
        }
    }

    private func activityRow(_ label: String) -> some View {
        HStack(spacing: 9) {
            ProgressView()
                .controlSize(.small)
                .tint(Color.tsVermilion)
                .accessibilityHidden(true)
            Text(label)
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    private func matchedReceipt(
        _ candidate: AgentRelationshipRecallCandidate,
        allowsChange: Bool
    ) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: "checkmark")
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.tsInk)
                .frame(width: 34, height: 34)
                .background(Color.tsCanvas, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(
                    verbatim: "\(candidate.person.displayLabel) · \(candidate.context.displayLabel)"
                )
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                Text(
                    language.text("Matched by Agent from your contact workspace")
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                if allowsChange {
                    Button(language.text("Change")) {
                        onChangeMatch()
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                    .frame(minHeight: 44, alignment: .leading)
                    .accessibilityIdentifier("ask-recall-change")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-recall-match")
    }

    private func candidateDecision(
        candidates: [AgentRelationshipRecallCandidate],
        possibleDuplicate: Bool,
        isFallback: Bool
    ) -> some View {
        let visibleCandidates = recallCandidates(
            from: candidates,
            isFallback: isFallback
        )
        return VStack(alignment: .leading, spacing: 10) {
            Text(
                language.text(
                    possibleDuplicate
                        ? "I found records that may represent the same person."
                        : isFallback
                            ? "I need one detail to find the right relationship."
                            : "I found more than one possible relationship."
                )
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.tsInk)

            if possibleDuplicate {
                Text(
                    language.text(
                        "Choosing below only sets this Session’s working context. Merging requires a separate evidence review."
                    )
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
            }

            if isFallback, candidates.count > 6 {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(Color.tsMutedInk)
                        .accessibilityHidden(true)
                    TextField(
                        language.text("Search people or relationships"),
                        text: $recallQuery
                    )
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("ask-recall-search")
                }
                .frame(minHeight: 44)
            }

            if visibleCandidates.isEmpty {
                Text(language.text("No matching relationships"))
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .accessibilityIdentifier("ask-recall-no-results")
            }

            ForEach(visibleCandidates) { candidate in
                Button {
                    onChooseCandidate(candidate)
                } label: {
                    HStack(alignment: .center, spacing: 10) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(candidate.person.displayLabel)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.tsInk)
                            Text(candidate.context.displayLabel)
                                .font(.caption)
                                .foregroundStyle(Color.tsMutedInk)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.tsMutedInk)
                    }
                    .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) {
                    Divider().foregroundStyle(Color.tsLine)
                }
                .accessibilityIdentifier("ask-recall-candidate-\(candidate.id)")
            }

            if isFallback, mediaDrafts.isEmpty {
                Button(action: onContinueWithoutRelationship) {
                    Text(
                        language.text(
                            "Continue without a relationship"
                        )
                    )
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.tsInk)
                .accessibilityHint(
                    language.text(
                        "Replies without reading candidate or relationship evidence"
                    )
                )
                .accessibilityIdentifier("ask-continue-unscoped")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(
            possibleDuplicate
                ? "ask-recall-possible-duplicate"
                : isFallback
                    ? "ask-recall-unresolved"
                    : "ask-recall-ambiguous"
        )
    }

    private func recallCandidates(
        from candidates: [AgentRelationshipRecallCandidate],
        isFallback: Bool
    ) -> [AgentRelationshipRecallCandidate] {
        guard isFallback else { return candidates }
        let normalizedQuery = recallQuery.trimmingCharacters(
            in: .whitespacesAndNewlines
        ).folding(
            options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
            locale: language.locale
        )
        guard !normalizedQuery.isEmpty else {
            return Array(candidates.prefix(6))
        }
        return candidates.filter { candidate in
            "\(candidate.person.displayLabel) \(candidate.context.displayLabel)"
                .folding(
                    options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
                    locale: language.locale
                )
                .contains(normalizedQuery)
        }
    }
}

private struct AgentContactReceiptTurn: View {
    let receipt: AgentContactReceipt
    let language: AppLanguage
    let onOpenPerson: (() -> Void)?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(Color.tsVermilion.opacity(0.12))
                            .frame(width: 38, height: 38)
                        Image(systemName: outcomeIcon)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.tsVermilion)
                    }
                    .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(language.text("Contact tool"))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.tsMutedInk)
                        Text(outcomeTitle)
                            .font(.headline)
                            .foregroundStyle(Color.tsInk)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                VStack(alignment: .leading, spacing: 5) {
                    Text(receipt.personDisplayLabel)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                    Text(
                        receipt.contextDisplayLabel
                            ?? language.text("Identity review")
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                }

                Divider()
                    .overlay(Color.tsLine)

                VStack(alignment: .leading, spacing: 7) {
                    receiptReference(
                        label: language.text("Source receipt"),
                        value: String(receipt.resourceID.suffix(8))
                    )
                    if let resolutionCaseID = receipt.resolutionCaseID {
                        receiptReference(
                            label: language.text("Review case"),
                            value: String(resolutionCaseID.suffix(8))
                        )
                    }
                }

                Label(
                    boundaryMessage,
                    systemImage: receipt.requiresRefresh
                        ? "clock.arrow.circlepath"
                        : "checkmark.shield"
                )
                .font(.caption2)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)

                if let onOpenPerson {
                    Divider()
                        .overlay(Color.tsLine)
                    Button(action: onOpenPerson) {
                        HStack(spacing: 10) {
                            Text(language.text("Open in People"))
                            Spacer(minLength: 12)
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.bold))
                        }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("contact-receipt-open-person")
                }
            }
            .padding(16)
            .frame(maxWidth: 344, alignment: .leading)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
            .overlay {
                RoundedRectangle(cornerRadius: 20)
                    .stroke(Color.tsLine, lineWidth: 1)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("agent-contact-receipt-\(receipt.id.uuidString)")
    }

    private var outcomeTitle: String {
        switch receipt.outcome {
        case .createdPerson:
            return language.text("Contact created")
        case .matchedExisting:
            return language.text("Added to existing contact")
        case .identityReview:
            return language.text("Saved for identity review", zhHans: "已保存以供身份审阅")
        }
    }

    private var outcomeIcon: String {
        switch receipt.outcome {
        case .createdPerson: return "person.crop.circle.badge.plus"
        case .matchedExisting: return "person.2.badge.gearshape"
        case .identityReview: return "person.crop.circle.badge.questionmark"
        }
    }

    private var boundaryMessage: String {
        if receipt.requiresRefresh {
            if receipt.outcome == .identityReview {
                return language.text(
                    "Restored reference · identity still needs review"
                )
            }
            if receipt.personID != nil, onOpenPerson == nil {
                return language.text(
                    "Restored reference · person is no longer available in People"
                )
            }
            return language.text(
                    "Restored reference · verify current state in People"
                )
        }
        return language.text(
            "Canonical IDs saved · original source stays separate"
        )
    }

    private func receiptReference(label: String, value: String) -> some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 3) {
                    receiptReferenceLabel(label)
                    receiptReferenceValue(value)
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    receiptReferenceLabel(label)
                    Spacer(minLength: 12)
                    receiptReferenceValue(value)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func receiptReferenceLabel(_ label: String) -> some View {
        Text(label)
            .font(.caption)
            .foregroundStyle(Color.tsMutedInk)
    }

    private func receiptReferenceValue(_ value: String) -> some View {
        Text(value)
            .font(.caption.monospaced().weight(.semibold))
            .foregroundStyle(Color.tsInk)
            .textSelection(.enabled)
    }
}

private struct PublicProfileCandidateCard: View {
    let source: RelationshipAskResponse.Block.PublicSource
    let language: AppLanguage
    let canReview: Bool
    let onReview: () -> Void

    private var profileURL: URL? {
        Self.httpsURL(source.profileURL)
    }

    private var avatarURL: URL? {
        guard source.avatarDisplayPolicy == "display_and_store",
              source.avatarRightsBasis != nil else {
            return nil
        }
        return source.avatarURL.flatMap(Self.httpsURL)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            candidateAvatar
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(source.displayName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                    if source.verified == true {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.caption2)
                            .foregroundStyle(Color.tsMutedInk)
                            .accessibilityLabel(language.text("Provider verified"))
                    }
                    Spacer(minLength: 4)
                    Text(language.text("Unconfirmed"))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.tsVermilion)
                }
                Text(
                    [source.platform.capitalized, source.handle]
                        .compactMap { $0 }
                        .joined(separator: " · ")
                )
                .font(.caption2)
                .foregroundStyle(Color.tsMutedInk)
                if source.avatarURL != nil && avatarURL == nil {
                    Label(
                        language.text("Avatar remains at source"),
                        systemImage: "photo.badge.exclamationmark"
                    )
                    .font(.caption2)
                    .foregroundStyle(Color.tsMutedInk)
                }
                if let biography = source.biography, !biography.isEmpty {
                    Text(biography)
                        .font(.caption)
                        .foregroundStyle(Color.tsInk)
                        .lineLimit(3)
                }
                Text(source.matchBasis)
                    .font(.caption2)
                    .foregroundStyle(Color.tsMutedInk)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    if let profileURL {
                        Link(destination: profileURL) {
                            Label(
                                language.text("Open source"),
                                systemImage: "arrow.up.right.square"
                            )
                            .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Color.tsMutedInk)
                        .accessibilityHint(language.text("Open the public provider source"))
                    }
                    Button(action: onReview) {
                        Label(
                            language.text("Review contact"),
                            systemImage: "person.crop.circle.badge.plus"
                        )
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(canReview ? Color.tsVermilion : Color.tsMutedInk)
                    .disabled(!canReview)
                    .accessibilityHint(
                        language.text(
                            "Review identity and fields before creating or attaching a contact"
                        )
                    )
                    .accessibilityIdentifier("ask-public-source-review-\(source.resultID)")
                }
                .font(.caption.weight(.semibold))
            }
        }
        .padding(10)
        .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 14))
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.tsLine, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-public-source-\(source.resultID)")
    }

    @ViewBuilder
    private var candidateAvatar: some View {
        if let avatarURL {
            AsyncImage(url: avatarURL) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                RelationshipInitials(
                    initials: String(source.displayName.prefix(2)).uppercased(),
                    size: 38
                )
            }
            .frame(width: 38, height: 38)
            .clipShape(Circle())
            .overlay {
                Circle().stroke(Color.tsLine, lineWidth: 1)
            }
            .overlay(alignment: .bottomTrailing) {
                Image(systemName: "questionmark.circle.fill")
                    .font(.caption2)
                    .foregroundStyle(Color.tsVermilion)
                    .background(Color.tsCanvas, in: Circle())
            }
            .accessibilityLabel(language.text("Unconfirmed public avatar"))
        } else {
            RelationshipInitials(
                initials: String(source.displayName.prefix(2)).uppercased(),
                size: 38
            )
            .accessibilityHidden(true)
        }
    }

    private static func httpsURL(_ value: String) -> URL? {
        guard let url = URL(string: value),
              url.scheme?.lowercased() == "https",
              url.host != nil else { return nil }
        return url
    }
}

private struct ScreenshotContactInlineResult: View {
    let task: ScreenshotContactTask
    let language: AppLanguage
    let onOpenPerson: (String) -> Void
    let onResume: (ScreenshotContactResumeBody) -> Void
    let onCancel: () -> Void
    let onLoadImage: (Int) async throws -> ChatMediaContent

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let contact = task.contact {
                Button { onOpenPerson(contact.personID) } label: {
                    Label(contact.displayName, systemImage: "person.crop.rectangle")
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }
            if task.status == "running" {
                Label(language.text("Reading screenshot"), systemImage: "photo.badge.arrow.down")
                    .font(.caption).foregroundStyle(Color.tsMutedInk)
            }
            if ["waiting_for_user", "failed", "partial", "cancelled"].contains(task.status) {
                detail
            } else {
                DisclosureGroup(language.text("Sources and processing details")) { detail }
                    .font(.caption)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-screenshot-result")
    }

    private var detail: some View {
        ScreenshotContactCard(
            task: task, language: language, onOpenPerson: onOpenPerson,
            onResume: onResume, onCancel: onCancel, onLoadImage: onLoadImage
        )
    }
}

private struct AskTurnView: View {
    let turn: AgentSessionTurn
    let language: AppLanguage
    let evidenceReviews: [AgentEvidenceReviewOperation]
    let evidenceReviewHistory: [AgentEvidenceReviewOperation]
    let inFlightEvidenceReviewKeys: Set<String>
    let transientSupersededEvidenceReviewKeys: Set<String>
    let evidenceReviewAuthorityReadbackKeys: Set<String>
    let loadMedia: (String) async throws -> ChatMediaContent
    let onOpenEvidence: (RelationshipAskResponse.Citation) -> Void
    let onRetryEvidenceReview: (AgentEvidenceReviewOperation) -> Void
    let onReinstateEvidence: (AgentEvidenceReviewOperation) -> Void
    let onStartFreshAsk: () -> Void
    let onOpenPursuit: (String, String) -> Void
    let onReviewPublicProfile: (RelationshipAskResponse.Block.PublicSource) -> Void
    let screenshotTask: ScreenshotContactTask?
    let loadScreenshotImage: (String, Int) async throws -> ChatMediaContent
    let onResumeScreenshot: (ScreenshotContactTask, ScreenshotContactResumeBody) -> Void
    let onCancelScreenshot: (ScreenshotContactTask) -> Void
    let onOpenPerson: (String) -> Void
    let canRegenerate: Bool
    let onRegenerate: () -> Void
    let onFeedback: (AgentSessionFeedback) -> Void
    let onCorrect: (() -> Void)?
    var productFeedbackClient: (any AnswerFeedbackServing)? = nil
    var onFeedbackCorrection: ((String) -> Void)? = nil
    @State private var didCopy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .trailing, spacing: 7) {
                if !turn.response.media.isEmpty {
                    ChatMediaAlbumBubble(media: turn.response.media, load: loadMedia)
                        .frame(maxWidth: 310)
                }
                AskUserMessageBubble(message: turn.objective)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)

            if turn.requiresRefresh {
                Label(
                    language.text(
                        "Saved response · ask again to refresh its sources",
                        zhHans: "已保存回复 · 再次提问以刷新来源"
                    ),
                    systemImage: "clock.arrow.trianglehead.counterclockwise.rotate.90"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
                .accessibilityIdentifier("ask-restored-response-needs-refresh")
            }

            if let receipt = turn.response.labFeatureReceipt,
               receipt.feature_id == "relationship_evidence_preview" {
                Label(
                    language.text(
                        "Lab · Exact evidence is shown inline for this answer",
                        zhHans: "Lab · 此回答已内联显示精确证据"
                    ),
                    systemImage: "flask.fill"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsVermilion)
                .accessibilityIdentifier("ask-lab-feature-receipt")
            }

            ForEach(turn.response.blocks) { block in
                VStack(alignment: .leading, spacing: 9) {
                    if let eyebrow = responseEyebrow(for: block) {
                        Text(eyebrow)
                            .font(.caption2.weight(.semibold))
                            .tracking(0.7)
                            .foregroundStyle(Color.tsMutedInk)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(responseTitle(for: block))
                            .font(.headline)
                            .foregroundStyle(Color.tsInk)
                        Spacer(minLength: 8)
                        if block.requiresUserDecision {
                            Image(systemName: "checkmark.circle.badge.questionmark")
                                .foregroundStyle(Color.tsVermilion)
                                .accessibilityLabel(
                                    language.text("Needs review", zhHans: "需要审阅")
                                )
                        }
                    }
                    if block.kind == "active_action" {
                        AskActiveActionView(
                            rawBody: block.body,
                            targetRef: block.targetRef,
                            language: language,
                            onOpenPursuit: onOpenPursuit
                        )
                    } else {
                        AgentMarkdownView(markdown: block.body)
                    }
                    if let draft = block.calendarDraft,
                       draft.sourceRequestID == turn.response.taskID,
                       let proposal = draft.deviceProposal {
                        DeviceCalendarHandoffView(proposal: proposal, allowsEditing: true)
                            .disabled(turn.requiresRefresh)
                    }
                    if let publicSources = block.publicSources,
                       !publicSources.isEmpty {
                        VStack(alignment: .leading, spacing: 7) {
                            Label(
                                language.text("Unconfirmed public sources"),
                                systemImage: "person.crop.circle.badge.questionmark"
                            )
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.tsMutedInk)

                            ForEach(publicSources) { source in
                                PublicProfileCandidateCard(
                                    source: source,
                                    language: language,
                                    canReview: !turn.requiresRefresh,
                                    onReview: { onReviewPublicProfile(source) }
                                )
                            }
                        }
                    }
                    if !block.citationDependencyIDs.isEmpty && !turn.requiresRefresh {
                        let citations = block.citationDependencyIDs.compactMap { id in
                            turn.response.citations.first { $0.id == id }
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(citations) { citation in
                                Button { onOpenEvidence(citation) } label: {
                                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                                        Image(systemName: "quote.bubble")
                                            .accessibilityHidden(true)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(citation.sourceName)
                                                .font(.caption.weight(.semibold))
                                                .foregroundStyle(Color.tsInk)
                                            Text(citation.compactProvenance(in: language))
                                                .font(.caption2)
                                                .foregroundStyle(Color.tsMutedInk)
                                            if turn.response.labFeatureReceipt?.effective_value == "inline_excerpt",
                                               let excerpt = citation.exactExcerpt {
                                                Text(verbatim: "“\(excerpt)”")
                                                    .font(.caption)
                                                    .foregroundStyle(Color.tsInk)
                                                    .fixedSize(horizontal: false, vertical: true)
                                                    .padding(.top, 3)
                                                    .accessibilityIdentifier("ask-citation-inline-excerpt-\(citation.id)")
                                            }
                                        }
                                        Spacer(minLength: 6)
                                        Image(systemName: "chevron.right")
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(Color.tsMutedInk)
                                    }
                                    .frame(minHeight: 44)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(
                                    language.text(
                                        "Evidence from \(citation.sourceName), \(citation.compactProvenance(in: language))",
                                        zhHans: "来自 \(citation.sourceName) 的证据，\(citation.compactProvenance(in: language))"
                                    )
                                )
                                .accessibilityHint(
                                    language.text("Open the exact cited source", zhHans: "打开精确引用来源")
                                )
                                .accessibilityIdentifier("ask-citation-\(citation.id)")
                            }
                        }
                    } else if !block.citationDependencyIDs.isEmpty {
                        Label(
                            language.text(
                                "Citations are hidden until this response is refreshed",
                                zhHans: "刷新回复前，引用暂不显示"
                            ),
                            systemImage: "shield.lefthalf.filled"
                        )
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                    }
                }
                .padding(.vertical, 14)
                .overlay(alignment: .bottom) { Divider().overlay(Color.tsLine) }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("ask-response-block-\(turn.response.taskID)-\(block.id)")
                .id("ask-response-block-\(block.id)")
            }

            if let screenshotTask {
                ScreenshotContactInlineResult(
                    task: screenshotTask, language: language,
                    onOpenPerson: onOpenPerson,
                    onResume: { onResumeScreenshot(screenshotTask, $0) },
                    onCancel: { onCancelScreenshot(screenshotTask) },
                    onLoadImage: { try await loadScreenshotImage(screenshotTask.taskID, $0) }
                )
            }
            responseControls

            ForEach(evidenceReviews) { operation in
                AskEvidenceReviewStatusView(
                    operation: operation,
                    language: language,
                    isInFlight: inFlightEvidenceReviewKeys.contains(
                        operation.idempotencyKey
                    ),
                    isSupersededInSession:
                        transientSupersededEvidenceReviewKeys.contains(
                            operation.idempotencyKey
                        ),
                    requiresAuthorityReadback:
                        evidenceReviewAuthorityReadbackKeys.contains(
                            operation.idempotencyKey
                        ),
                    onRetry: { onRetryEvidenceReview(operation) },
                    onReinstate: { onReinstateEvidence(operation) },
                    onStartFreshAsk: onStartFreshAsk
                )
            }

            if evidenceReviewHistory.count > 1 {
                AskEvidenceReviewHistoryView(
                    operations: evidenceReviewHistory,
                    language: language
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-response-turn")
    }

    private var responseControls: some View {
        HStack(spacing: 0) {
            responseControl(
                symbol: "arrow.clockwise", title: language.text("Regenerate"),
                identifier: "ask-regenerate", action: onRegenerate
            )
            .disabled(!canRegenerate)
            .opacity(canRegenerate ? 1 : 0.35)
            responseControl(
                symbol: didCopy ? "checkmark" : "doc.on.doc",
                title: language.text(didCopy ? "Copied" : "Copy"),
                identifier: "ask-copy"
            ) {
                let text = turn.response.blocks.map { $0.body }.joined(separator: "\n\n")
                UIPasteboard.general.setItems(
                    [[UTType.utf8PlainText.identifier: text]],
                    options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(300)]
                )
                didCopy = true
            }
            if let productFeedbackClient {
                ProductRunFeedbackControls(client: productFeedbackClient, taskID: turn.response.taskID, onCorrection: onFeedbackCorrection)
            } else {
            responseControl(
                symbol: turn.feedback == .helpful ? "hand.thumbsup.fill" : "hand.thumbsup",
                title: language.text("Helpful"),
                identifier: "ask-feedback-helpful"
            ) { onFeedback(.helpful) }
            .accessibilityValue(turn.feedback == .helpful ? language.text("Selected") : "")
            responseControl(
                symbol: turn.feedback == .unhelpful ? "hand.thumbsdown.fill" : "hand.thumbsdown",
                title: language.text("Not helpful"),
                identifier: "ask-feedback-unhelpful"
            ) { onFeedback(.unhelpful) }
            .accessibilityValue(turn.feedback == .unhelpful ? language.text("Selected") : "")
            }
            if let onCorrect {
                responseControl(symbol: "text.bubble", title: language.text("Correct answer"),
                    identifier: "ask-feedback-correct", action: onCorrect)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(Color.tsMutedInk)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-response-controls")
    }

    private func responseControl(
        symbol: String, title: String, identifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .regular))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }

    private func responseEyebrow(
        for block: RelationshipAskResponse.Block
    ) -> String? {
        if turn.response.knowledgeSnapshotID == "local-workspace-index" {
            return language.text("On-device workspace index")
        }
        switch block.kind {
        case "answer", "clarification", "question_set":
            return language.text("Agent answer")
        default:
            return nil
        }
    }

    private func responseTitle(
        for block: RelationshipAskResponse.Block
    ) -> String {
        let legacyProviderPrefix = "Zhipu AI · "
        guard block.title.hasPrefix(legacyProviderPrefix) else {
            return block.title
        }
        return String(block.title.dropFirst(legacyProviderPrefix.count))
    }
}

private struct AskActiveActionView: View {
    let rawBody: String
    let targetRef: RelationshipAskResponse.Block.TargetRef?
    let language: AppLanguage
    let onOpenPursuit: (String, String) -> Void

    private var fields: Fields { Fields(body: rawBody) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(fields.action)
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { metadata }
                VStack(alignment: .leading, spacing: 8) { metadata }
            }

            if let gap = fields.gap {
                detail(
                    language.text("Waiting on", zhHans: "正在等待"),
                    value: gap,
                    symbol: "hourglass"
                )
            }
            if let close = fields.closeCondition {
                detail(
                    language.text("Done when", zhHans: "完成条件"),
                    value: close,
                    symbol: "checkmark.circle"
                )
            }
            if let effect = fields.effect {
                Label(effect, systemImage: "shield.lefthalf.filled")
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let targetRef, targetRef.type == "pursuit_action" {
                Button {
                    onOpenPursuit(targetRef.pursuitID, targetRef.actionID)
                } label: {
                    Label(
                        language.text("Open Pursuit", zhHans: "打开追求事项"),
                        systemImage: "arrow.up.right"
                    )
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityHint(
                    language.text(
                        "Opens the existing action without recording a change",
                        zhHans: "打开现有行动，不记录任何更改"
                    )
                )
                .accessibilityIdentifier(
                    "ask-open-pursuit-\(targetRef.pursuitID)-\(targetRef.actionID)"
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-active-action")
    }

    @ViewBuilder
    private var metadata: some View {
        if let owner = fields.owner {
            Label(owner, systemImage: "person.crop.circle")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
        }
        if let due = fields.due {
            Label(due.label(language: language), systemImage: due.isOverdue ? "exclamationmark.clock" : "calendar")
                .font(.caption.weight(.semibold))
                .foregroundStyle(due.isOverdue ? Color.tsVermilion : Color.tsMutedInk)
                .accessibilityIdentifier("ask-active-action-due")
        }
    }

    private func detail(_ label: String, value: String, symbol: String) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
                .frame(width: 16)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsMutedInk)
                Text(value)
                    .font(.subheadline)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private struct Fields {
        let action: String
        let owner: String?
        let due: Due?
        let gap: String?
        let closeCondition: String?
        let effect: String?

        init(body: String) {
            let lines = body.split(separator: "\n").map(String.init)
            action = lines.first ?? body
            owner = Self.value(prefix: "Owner: ", lines: lines)
            due = Self.value(prefix: "Due: ", lines: lines).flatMap(Due.init(raw:))
            gap = Self.value(prefix: "Open gap: ", lines: lines)
            closeCondition = Self.value(prefix: "Close when: ", lines: lines)
            effect = lines.first { $0.hasPrefix("Existing work only") }
        }

        private static func value(prefix: String, lines: [String]) -> String? {
            lines.first { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)) }
        }
    }

    private struct Due {
        let date: Date?
        let fallback: String

        init?(raw: String) {
            guard raw != "not set" else { return nil }
            fallback = raw
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = "yyyy-MM-dd HH:mm:ss 'UTC'"
            date = formatter.date(from: raw)
        }

        var isOverdue: Bool { date.map { $0 < Date() } ?? false }

        func label(language: AppLanguage) -> String {
            guard let date else { return fallback }
            let localized = date.formatted(date: .abbreviated, time: .shortened)
            return isOverdue
                ? language.text("Overdue · \(localized)", zhHans: "已逾期 · \(localized)")
                : localized
        }
    }
}

private struct AskEvidenceReviewStatusView: View {
    let operation: AgentEvidenceReviewOperation
    let language: AppLanguage
    let isInFlight: Bool
    let isSupersededInSession: Bool
    let requiresAuthorityReadback: Bool
    let onRetry: () -> Void
    let onReinstate: () -> Void
    let onStartFreshAsk: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: symbol)
                    .foregroundStyle(foreground)
                    .accessibilityHidden(true)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                Spacer(minLength: 8)
                if operation.state == .pending && isInFlight {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            Text("\(operation.sourceName) · \(operation.personDisplayName) · \(operation.relationshipContextDisplayName)")
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
            if requiresAuthorityReadback && !isEffectivelySuperseded {
                Text(
                    language.text(
                        "This operation was restored after an interruption. Check current evidence before any retry.",
                        zhHans: "此操作在中断后恢复。任何重试前，请先检查当前证据。"
                    )
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
            } else if isSupersededInSession && operation.state != .superseded {
                Text(
                    language.text(
                        "This terminal notice could not be saved on this device. The older operation stays blocked for this session.",
                        zhHans: "此终态提示未能保存在本设备上。这条较早的操作在本次会话中仍会被阻止。"
                    )
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
            } else if let statusMessage = operation.statusMessage,
                      [.outcomeUnknown, .failed, .superseded].contains(
                        operation.state
                      ) {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(
                language.text(
                    "The audit keeps every decision. Old answers stay stale.",
                    zhHans: "审计会保留每次决定。旧回复仍保持过期。"
                )
            )
            .font(.caption2)
            .foregroundStyle(Color.tsMutedInk)

            if isEffectivelySuperseded || requiresAuthorityReadback {
                Button(action: onStartFreshAsk) {
                    Label(
                        language.text(
                            requiresAuthorityReadback
                                ? "Check current evidence"
                                : "Ask with current evidence",
                            zhHans: requiresAuthorityReadback
                                ? "检查当前证据"
                                : "基于当前证据提问"
                        ),
                        systemImage: "sparkle.magnifyingglass"
                    )
                    .font(.caption.weight(.semibold))
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityHint(
                    language.text(
                        "Moves to a fresh Ask and sends nothing automatically; the old review is not retried",
                        zhHans: "转到新的提问且不会自动发送；不会重试较早的审阅"
                    )
                )
                .accessibilityIdentifier("ask-evidence-review-current")
            } else if [.outcomeUnknown, .failed].contains(operation.state)
                || (operation.state == .pending && !isInFlight) {
                Button(action: onRetry) {
                    Label(
                        language.text("Reconcile safely", zhHans: "安全核对"),
                        systemImage: "arrow.clockwise"
                    )
                    .font(.caption.weight(.semibold))
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityHint(
                    language.text(
                        "Retries the same evidence-review operation; it cannot create a duplicate review",
                        zhHans: "使用同一证据审阅操作重试，不会创建重复审阅"
                    )
                )
            } else if operation.state == .applied,
                      operation.decision == "rejected",
                      operation.resultingReviewID != nil {
                Button(action: onReinstate) {
                    Label(
                        language.text("Re-review corrected source", zhHans: "重新审阅已更正来源"),
                        systemImage: "clock.arrow.circlepath"
                    )
                    .font(.caption.weight(.semibold))
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityHint(
                    language.text(
                        "Adds a new reviewed decision; the prior dispute remains in the audit",
                        zhHans: "添加新的已审阅决定；原争议仍保留在审计中"
                    )
                )
            }
        }
        .padding(14)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-evidence-review-\(operation.fragmentID)")
    }

    private var symbol: String {
        if isEffectivelySuperseded {
            return "arrow.trianglehead.2.clockwise.rotate.90"
        }
        if requiresAuthorityReadback {
            return "checkmark.shield"
        }
        switch operation.state {
        case .pending:
            return "clock"
        case .outcomeUnknown, .failed:
            return "exclamationmark.triangle"
        case .superseded:
            return "arrow.trianglehead.2.clockwise.rotate.90"
        case .applied:
            return operation.decision == "rejected"
                ? "checkmark.shield"
                : "checkmark.seal"
        }
    }

    private var foreground: Color {
        (isEffectivelySuperseded
            || requiresAuthorityReadback
            || [.outcomeUnknown, .failed].contains(operation.state))
            ? Color.tsVermilion
            : Color.tsMutedInk
    }

    private var title: String {
        if isEffectivelySuperseded {
            return language.text(
                "Newer source review is current",
                zhHans: "更新的来源审阅已生效"
            )
        }
        if requiresAuthorityReadback {
            return language.text(
                "Check source authority before retry",
                zhHans: "重试前检查来源权限"
            )
        }
        switch operation.state {
        case .pending:
            return isInFlight
                ? language.text("Saving source review…", zhHans: "正在保存来源审阅…")
                : language.text(
                    "Source review needs reconciliation",
                    zhHans: "来源审阅需要核对"
                )
        case .outcomeUnknown:
            return language.text("Review outcome unknown", zhHans: "审阅结果尚不确定")
        case .failed:
            return language.text("Review was not saved", zhHans: "审阅未保存")
        case .superseded:
            return language.text(
                "Newer source review is current",
                zhHans: "更新的来源审阅已生效"
            )
        case .applied where operation.decision == "rejected":
            return language.text("Source disputed · saved", zhHans: "来源已标记争议 · 已保存")
        case .applied:
            return language.text(
                "Source re-reviewed · ask again for fresh evidence",
                zhHans: "来源已重新审阅 · 再次提问以获取最新证据"
            )
        }
    }

    private var isEffectivelySuperseded: Bool {
        operation.state == .superseded || isSupersededInSession
    }
}

enum RelationshipAskDraftPolicy {
    static func currentEvidenceDraft(
        preserving existingDraft: String,
        suggestion: String
    ) -> String {
        existingDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? suggestion
            : existingDraft
    }
}

private struct AskEvidenceReviewHistoryView: View {
    let operations: [AgentEvidenceReviewOperation]
    let language: AppLanguage

    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(operations) { operation in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(decisionLabel(operation))
                                .font(.caption.weight(.semibold))
                            Spacer(minLength: 8)
                            Text(historyDate(operation).formatted(date: .abbreviated, time: .shortened))
                                .font(.caption2)
                                .foregroundStyle(Color.tsMutedInk)
                        }
                        Text(operation.reason)
                            .font(.caption)
                            .foregroundStyle(Color.tsInk)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("\(operation.state.rawValue) · …\(operation.idempotencyKey.suffix(8))")
                            .font(.caption2.monospaced())
                            .foregroundStyle(Color.tsMutedInk)
                    }
                    if operation.id != operations.last?.id {
                        Divider().overlay(Color.tsLine)
                    }
                }
            }
            .padding(.top, 10)
        } label: {
            Label(
                language.text(
                    "Source review history · \(operations.count)",
                    zhHans: "来源审阅历史 · \(operations.count)"
                ),
                systemImage: "clock.arrow.circlepath"
            )
            .font(.caption.weight(.semibold))
        }
        .padding(14)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 14))
        .accessibilityIdentifier("ask-evidence-review-history")
    }

    private func decisionLabel(_ operation: AgentEvidenceReviewOperation) -> String {
        operation.decision == "rejected"
            ? language.text("Disputed", zhHans: "已标记争议")
            : language.text("Reviewed", zhHans: "已审阅")
    }

    private func historyDate(_ operation: AgentEvidenceReviewOperation) -> Date {
        guard let canonicalDecidedAt = operation.canonicalDecidedAt else {
            return operation.updatedAt
        }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: canonicalDecidedAt)
            ?? ISO8601DateFormatter().date(from: canonicalDecidedAt)
            ?? operation.updatedAt
    }
}

extension RelationshipAskResponse.Citation {
    var needsCurrentReview: Bool {
        (reviewStatus != "reviewed" || lastReviewID == nil)
            && attribution.status == "confirmed"
            && exactExcerpt?.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).isEmpty == false
    }

    func compactProvenance(in language: AppLanguage) -> String {
        let day = observedDate.map { date in
            Self.observedDateFormatter(timeZone: resolvedSourceTimeZone).string(from: date)
        } ?? String(observedAt.prefix(10))
        return "\(day) · \(language.workspaceValue(attribution.actorKind)) · \(language.workspaceValue(reviewStatus))"
    }

    var detailedObservedAt: String {
        guard let observedDate else {
            return "\(observedAt)\(sourceTimezone.map { " · \($0)" } ?? "")"
        }
        let zone = resolvedSourceTimeZone
        let value = Self.observedDateTimeFormatter(timeZone: zone).string(
            from: observedDate
        )
        return sourceTimezone.map { "\(value) · \($0)" } ?? value
    }

    var detailedLastReviewedAt: String? {
        guard let lastReviewedAt else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = fractional.date(from: lastReviewedAt)
            ?? ISO8601DateFormatter().date(from: lastReviewedAt)
        guard let date else {
            return "\(lastReviewedAt)\(sourceTimezone.map { " · \($0)" } ?? "")"
        }
        let value = Self.observedDateTimeFormatter(
            timeZone: resolvedSourceTimeZone
        ).string(from: date)
        return sourceTimezone.map { "\(value) · \($0)" } ?? value
    }

    private var observedDate: Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: observedAt) { return date }
        return ISO8601DateFormatter().date(from: observedAt)
    }

    private var resolvedSourceTimeZone: TimeZone {
        sourceTimezone.flatMap(TimeZone.init(identifier:))
            ?? TimeZone(secondsFromGMT: 0)!
    }

    private static func observedDateFormatter(timeZone: TimeZone) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }

    private static func observedDateTimeFormatter(timeZone: TimeZone) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd HH:mm zzz"
        return formatter
    }
}

private struct AskCitationDetailView: View {
    let citation: RelationshipAskResponse.Citation
    let language: AppLanguage
    let onReject: ((String) async throws -> Void)?
    let onReview: ((String) async throws -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var isReviewing = false
    @State private var isRejecting = false
    @State private var showsReviewPrompt = false
    @State private var showsRejectPrompt = false
    @State private var reviewReason = ""
    @State private var rejectionReason = ""
    @State private var reviewError: String?
    @State private var rejectionError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text(citation.sourceName)
                            .font(.custom("Georgia", size: 28, relativeTo: .title2))
                            .foregroundStyle(Color.tsInk)
                        Text(citation.compactProvenance(in: language))
                            .font(.caption)
                            .foregroundStyle(Color.tsMutedInk)
                    }

                    if let excerpt = citation.exactExcerpt {
                        Text(excerpt)
                            .font(.body)
                            .foregroundStyle(Color.tsInk)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(18)
                            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 18))
                            .accessibilityIdentifier("ask-citation-excerpt")
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        citationLine(
                            language.text("Observed", zhHans: "观察时间"),
                            citation.detailedObservedAt
                        )
                        citationLine(
                            language.text("Source state", zhHans: "来源状态"),
                            "\(language.workspaceValue(citation.reviewStatus)) · capture v\(citation.captureVersion)"
                        )
                        citationLine(
                            language.text("Attribution", zhHans: "归属"),
                            "\(language.workspaceValue(citation.attribution.actorKind)) · \(language.workspaceValue(citation.attribution.status))"
                        )
                        if let reviewer = citation.lastReviewedBy {
                            citationLine(
                                language.text("Last reviewed", zhHans: "最近审阅"),
                                "\(reviewer)\(citation.detailedLastReviewedAt.map { " · \($0)" } ?? "")"
                            )
                        }
                        citationLine(
                            language.text("Derived by", zhHans: "解析来源"),
                            "\(citation.parser.name) \(citation.parser.version)"
                        )
                    }

                    Label(
                        citation.needsCurrentReview
                            ? language.text(
                                "This exact fragment needs your current review before a new Agent answer may cite it."
                            )
                            : language.text(
                                "This exact governed fragment supports the Agent response.",
                                zhHans: "这个受治理的精确片段支持了 Agent 的回答。"
                            ),
                        systemImage: citation.needsCurrentReview
                            ? "exclamationmark.shield"
                            : "checkmark.shield"
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)

                    if onReview != nil {
                        Button {
                            showsReviewPrompt = true
                        } label: {
                            Label(
                                language.text("Review and confirm source"),
                                systemImage: "checkmark.shield"
                            )
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color.tsInk)
                        .disabled(isReviewing || isRejecting)
                        .accessibilityIdentifier("ask-confirm-citation-review")

                        if let reviewError {
                            Text(reviewError)
                                .font(.caption)
                                .foregroundStyle(Color.tsMutedInk)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("ask-confirm-citation-review-error")
                        }
                    }

                    if onReject != nil {
                        Button {
                            showsRejectPrompt = true
                        } label: {
                            Label(
                                language.text("Dispute this source"),
                                systemImage: "exclamationmark.bubble"
                            )
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.bordered)
                        .disabled(isReviewing || isRejecting)
                        .accessibilityIdentifier("ask-review-citation")

                        if let rejectionError {
                            Text(rejectionError)
                                .font(.caption)
                                .foregroundStyle(Color.tsMutedInk)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("ask-review-citation-error")
                        }
                    }
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 24)
            }
            .background(Color.tsSurface.ignoresSafeArea())
            .navigationTitle(language.text("Evidence", zhHans: "证据"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(language.text("Done", zhHans: "完成")) { dismiss() }
                }
            }
        }
        .tint(.tsInk)
        .accessibilityIdentifier("ask-citation-detail")
        .alert(
            language.text("Review this source?"),
            isPresented: $showsReviewPrompt
        ) {
            TextField(
                language.text("Why is it accurate and in scope?"),
                text: $reviewReason
            )
            Button(language.text("Cancel"), role: .cancel) {}
            Button(language.text("Confirm review")) {
                let reason = reviewReason.trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
                guard let onReview, !reason.isEmpty else { return }
                isReviewing = true
                reviewError = nil
                Task {
                    do {
                        try await onReview(reason)
                    } catch {
                        reviewError = (error as? LocalizedError)?.errorDescription
                            ?? language.text("The source review was not saved.")
                    }
                    isReviewing = false
                }
            }
            .disabled(
                reviewReason.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ).isEmpty || isReviewing
            )
        } message: {
            Text(
                language.text(
                    "This records a new user review. It does not send the saved question or perform any external action."
                )
            )
        }
        .alert(
            language.text("Dispute this source?", zhHans: "对这个来源提出异议？"),
            isPresented: $showsRejectPrompt
        ) {
            TextField(
                language.text("What is wrong?", zhHans: "哪里不准确？"),
                text: $rejectionReason
            )
            Button(language.text("Cancel", zhHans: "取消"), role: .cancel) {}
            Button(
                language.text("Mark disputed", zhHans: "标记为有异议"),
                role: .destructive
            ) {
                let reason = rejectionReason.trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
                guard let onReject, !reason.isEmpty else { return }
                isRejecting = true
                rejectionError = nil
                Task {
                    do {
                        try await onReject(reason)
                    } catch {
                        rejectionError = (error as? LocalizedError)?.errorDescription
                            ?? language.text(
                                "The source review was not saved.",
                                zhHans: "来源审阅未能保存。"
                            )
                    }
                    isRejecting = false
                }
            }
            .disabled(
                rejectionReason.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ).isEmpty || isRejecting
            )
        } message: {
            Text(
                language.text(
                    "The current Agent response will become stale. No external message is sent.",
                    zhHans: "当前 Agent 回答会变为过期状态，不会发送任何外部消息。"
                )
            )
        }
    }

    private func citationLine(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
            Text(value)
                .font(.caption)
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}


/// The exact send availability decision used by the Ask view. A tombstoned
/// original durable Session disables sending while keeping the draft; only an
/// explicit Start-new-Session may rebind.
enum AskSendAvailability {
    static func originalSessionUnavailable(activeSessionID: UUID?, sessionExists: Bool) -> Bool {
        activeSessionID != nil && !sessionExists
    }

    static func canSendDraft(
        hasComposerInput: Bool,
        isSending: Bool,
        isSavingContact: Bool,
        originalSessionUnavailable: Bool
    ) -> Bool {
        hasComposerInput && !isSending && !isSavingContact && !originalSessionUnavailable
    }
}
