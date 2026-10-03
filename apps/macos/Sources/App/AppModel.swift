import AppKit
import Foundation

@MainActor
final class AppModel: ObservableObject {
    @Published var capsule = ContextCapsuleDraft()
    @Published var mode: WorkspaceMode
    @Published var presentation: WorkspacePresentation
    @Published var isSyntheticFixture = true
    @Published var isPaused = false
    @Published var selectedNavigation: NavigationDestination? = .today
    @Published var errorMessage: String?
    @Published var deletionReceipt: String?
    @Published var lastSubmittedManifest: SubmittedContextManifest?
    @Published var factReviewStatus: FactReviewStatus = .proposed
    @Published var localDraftStatus: LocalDraftStatus = .awaitingDecision
    @Published var pendingDecision: CanonicalProposalReview?
    @Published var canonicalReceipt: CanonicalPursuitReceipt?
    @Published var identityReviewReceipt: IdentityReviewReceipt?
    @Published var decisionSelections: [String: CanonicalDecisionChoice] = [:]
    @Published var scopeReviewStatus: RelationshipScopeReviewStatus
    @Published var localRecoveryNotice: String?
    @Published var intakeControlReceipt: String?
    @Published var isSignedOut = false
    @Published var relationshipScopeOptions: [RelationshipScopeOption]
    @Published private(set) var todayAttention: TodayAttentionProjection = .empty
    @Published private(set) var focusedTodayAttentionItem: TodayAttentionItem?
    @Published var selectedScopeOptionID: String?
    @Published var isAccessibilityZoomPreview = ProcessInfo.processInfo.arguments.contains("--accessibility-zoom-200")
    @Published var isReducedMotionPreview = ProcessInfo.processInfo.arguments.contains("--reduced-motion-preview")
    @Published var isDarkAppearancePreview = ProcessInfo.processInfo.arguments.contains("--dark-appearance-preview")
    @Published var isSelectingWindow = false
    @Published var windowCaptureReceipt: String?
    @Published var isImportingFiles = false
    @Published var fileIngestReceipt: String?
    @Published var runAudit: RunAuditSummary?
    @Published private(set) var provisionalInsight: ProvisionalFollowUpInsight?
    @Published var editableFollowUpDraft = ""
    @Published var editableMailSubject = ""
    @Published private(set) var preparedDraftKind: PreparedDraftKind?
    @Published private(set) var mailDraftHandoffStatus: MailDraftHandoffStatus = .notOpened
    @Published var reminderTitle = ""
    @Published var reminderDueAt = Date()
    @Published private(set) var reminderDestination: FollowUpReminderDestination?
    @Published private(set) var reminderOperationState: FollowUpReminderOperationState = .notPrepared
    @Published private(set) var reminderDuplicateActionDecision: ReminderDuplicateActionDecision = .unavailable
    @Published private(set) var reminderRecoveryNotice: String?
    @Published private(set) var companionTrialMetrics = CompanionTrialMetrics()
    @Published private(set) var companionTrialExportReceipt: String?
    @Published private(set) var quickPanelNavigationRequest: QuickPanelNavigationRequest?

    let service: any MacRelationshipServing
    private let capsuleStore: any LocalCapsulePersisting
    private let windowCapture: any WindowCapturing
    private let localFileTextExtractor: any LocalFileTextExtracting
    private let preparedDraftClipboard: any PreparedDraftCopying
    private let followUpReminderService: any FollowUpReminderServing
    private let reminderRecoveryStore: any ReminderOperationRecoveryPersisting
    private let preparedMailDraftService: any PreparedMailDraftOpening
    private let companionTrialExportClipboard: any CompanionTrialExportCopying
    private let showsSyntheticTodayPreview: Bool
    private var recoveredAccountIDs: Set<String> = []
    private var recoveredReminderAccountIDs: Set<String> = []
    private var handledServiceRequestIDs: Set<UUID> = []
    private var activeFileImportID: UUID?
    private var preparedDraftBaseline: (kind: PreparedDraftKind, subject: String, body: String)?
    private var reminderBaseline: (title: String, dueAt: Date)?
    private var activeReminderRecovery: ReminderOperationRecovery?
    private var isReminderRecoveryUnreadable = false
    private(set) var accountID: String
    private(set) var pursuitID: String?
    private(set) var personID: String?
    private(set) var relationshipContextID: String?
    private(set) var currentTaskID: String?

    var identityTags: [String] {
        guard scopeReviewStatus == .confirmed else { return [] }
        if isSyntheticFixture,
           let raw = Self.value(after: "--identity-tag-count", in: ProcessInfo.processInfo.arguments),
           let count = Int(raw) {
            return Array(["Candidate role", "Scope confirmed", "Candidate-authored source"].prefix(max(0, min(3, count))))
        }
        var tags: [String] = []
        if personID != nil { tags.append("Candidate role") }
        if scopeReviewStatus == .confirmed { tags.append("Scope confirmed") }
        if capsule.sharedItems.contains(where: { $0.actorKind == .candidate }) {
            tags.append("Candidate-authored source")
        }
        return Array(tags.prefix(3))
    }

    var menuBarPrivacySummary: String {
        isSyntheticFixture
            ? "Synthetic fixture · no private source content"
            : "Connected · person, Pursuit, evidence, and message content hidden"
    }

    var actionCenterProjections: [ActionProjection] {
        presentation.actionProjections.filter {
            switch $0.status {
            case .awaitingDecision, .active, .failed, .outcomeUnknown, .stale, .reversible:
                true
            case .verified:
                false
            }
        }
    }

    var reminderNeedsActionCenter: Bool {
        switch reminderOperationState {
        case .notPrepared, .removed:
            false
        case .loadingDestination, .readyForApproval, .executing, .saved, .failed, .unknown,
             .removing, .removalFailed, .removalUnknown:
            true
        }
    }

    var actionCenterCount: Int {
        actionCenterProjections.count + (reminderNeedsActionCenter ? 1 : 0)
    }

    var hasActionCenterWork: Bool { actionCenterCount > 0 }

    var canPrepareCurrentConversationNextStep: Bool {
        guard mode != .noAction,
              let insight = provisionalInsight,
              insight.canPrepareAction else { return false }
        return true
    }

    /// A local text match may point the recruiter toward one available scope,
    /// but it never selects or confirms that scope. Shared names abstain.
    var suggestedRelationshipScopeOption: RelationshipScopeOption? {
        guard scopeReviewStatus == .proposed,
              selectedScopeOptionID == nil,
              let sourceID = provisionalInsight?.sourceItemID,
              let source = capsule.items.first(where: { $0.id == sourceID })?.preview else {
            return nil
        }

        let identities = relationshipScopeOptions.map {
            ($0.id, Self.scopeIdentityTerms($0.personDisplayLabel))
        }
        let matches = relationshipScopeOptions.filter { option in
            let otherTerms = Set(identities.filter { $0.0 != option.id }.flatMap(\.1))
            let distinguishingTerms = Self.scopeIdentityTerms(option.personDisplayLabel)
                .filter { !otherTerms.contains($0) }
            return distinguishingTerms.contains { Self.source(source, containsIdentityTerm: $0) }
        }
        return matches.count == 1 ? matches[0] : nil
    }

    var selectedRelationshipConsequencePreflight: RelationshipConsequencePreflight? {
        guard let selectedScopeOptionID else { return nil }
        return relationshipScopeOptions.first(where: { $0.id == selectedScopeOptionID })?.consequencePreflight
    }

    var focusedTodayRelationshipScopeOption: RelationshipScopeOption? {
        guard let scopeOptionID = focusedTodayAttentionItem?.scopeOptionID else { return nil }
        return relationshipScopeOptions.first(where: { $0.id == scopeOptionID })
    }

    var hasReviewedDuplicateActionBoundary: Bool {
        switch reminderDuplicateActionDecision {
        case .notRequired, .separateReminderConfirmed:
            true
        case .unavailable, .unreviewed, .useExistingAction:
            false
        }
    }

    init(
        service: any MacRelationshipServing,
        initialMode: WorkspaceMode = .ready,
        accountID: String = "synthetic-account",
        pursuitID: String? = "synthetic-pursuit",
        personID: String? = "synthetic-person",
        relationshipContextID: String? = "synthetic-relationship-context",
        capsuleStore: any LocalCapsulePersisting = NullLocalCapsuleStore(),
        windowCapture: (any WindowCapturing)? = nil,
        localFileTextExtractor: (any LocalFileTextExtracting)? = nil,
        preparedDraftClipboard: (any PreparedDraftCopying)? = nil,
        followUpReminderService: (any FollowUpReminderServing)? = nil,
        reminderRecoveryStore: any ReminderOperationRecoveryPersisting = NullReminderOperationRecoveryStore(),
        preparedMailDraftService: (any PreparedMailDraftOpening)? = nil,
        companionTrialExportClipboard: (any CompanionTrialExportCopying)? = nil,
        showsSyntheticTodayPreview: Bool = ProcessInfo.processInfo.arguments.contains("--today-preview")
    ) {
        self.service = service
        self.mode = initialMode
        self.accountID = accountID
        self.pursuitID = pursuitID
        self.personID = personID
        self.relationshipContextID = relationshipContextID
        self.capsuleStore = capsuleStore
        self.windowCapture = windowCapture ?? SystemWindowCaptureService.shared
        self.localFileTextExtractor = localFileTextExtractor ?? SystemLocalFileTextExtractor()
        self.preparedDraftClipboard = preparedDraftClipboard ?? SystemPreparedDraftClipboard()
        self.followUpReminderService = followUpReminderService ?? PreviewOnlyFollowUpReminderService()
        self.reminderRecoveryStore = reminderRecoveryStore
        self.preparedMailDraftService = preparedMailDraftService ?? SystemPreparedMailDraftService()
        self.companionTrialExportClipboard = companionTrialExportClipboard ?? SystemCompanionTrialExportClipboard()
        self.showsSyntheticTodayPreview = showsSyntheticTodayPreview
        self.scopeReviewStatus = [.empty, .ready].contains(initialMode) ? .proposed : .confirmed
        let syntheticOption = Self.syntheticScopeOptionForCurrentProcess
        let initiallySelectsScope = ProcessInfo.processInfo.arguments.contains("--consequence-preflight-preview") ||
            ![.empty, .ready].contains(initialMode)
        self.relationshipScopeOptions = [syntheticOption]
        self.selectedScopeOptionID = initiallySelectsScope ? syntheticOption.id : nil
        self.reminderDuplicateActionDecision = Self.duplicateActionDecision(
            for: initiallySelectsScope ? syntheticOption.consequencePreflight : nil
        )
        self.presentation = [.empty, .ready].contains(initialMode)
            ? Self.unboundScopePresentation
            : FixtureRelationshipService.fixture(mode: initialMode).presentation
        self.followUpReminderService.setLocalRecoveryAccount(accountID)
    }

    static func bootstrap() -> AppModel {
        let arguments = ProcessInfo.processInfo.arguments
        let fixtureState = value(after: "--fixture-state", in: arguments)
            .flatMap(WorkspaceMode.argumentValue) ?? .ready

        if let rawBaseURL = value(after: "--live-backend", in: arguments),
           let baseURL = URL(string: rawBaseURL),
           let service = try? URLMacRelationshipService(
               configuration: .init(
                   baseURL: baseURL,
                   accountSlug: value(after: "--account-slug", in: arguments) ?? "fixture-alpha",
                   userEmail: value(after: "--user-email", in: arguments) ?? "recruiter@alpha.local"
               ),
               unknownResolutionStore: SecureUnknownResolutionStore.shared
           ) {
            let model = AppModel(
                service: service,
                initialMode: .working,
                accountID: "pending-live-account",
                pursuitID: nil,
                personID: nil,
                relationshipContextID: nil,
                capsuleStore: SecureLocalCapsuleStore.shared,
                followUpReminderService: EventKitFollowUpReminderService(),
                reminderRecoveryStore: SecureReminderOperationRecoveryStore.shared
            )
            model.isSyntheticFixture = false
            if arguments.contains("--open-action-center") {
                model.selectedNavigation = .actionCenter
            }
            return model
        }

        // Fixture mode is an explicit, separate service result and is always
        // labeled in the UI. It is never treated as backend proof.
        let model = AppModel(
            service: FixtureRelationshipService(initialMode: fixtureState),
            initialMode: fixtureState,
            followUpReminderService: PreviewOnlyFollowUpReminderService()
        )
        if arguments.contains("--ui-testing"), !arguments.contains("--today-preview") {
            model.selectedNavigation = .workspace
        }
        if arguments.contains("--quick-panel-preview") || arguments.contains("--today-preview") {
            model.addSelectedText("I need clarity on the remote policy before Friday because the other process has accelerated.")
        }
        if arguments.contains("--today-preview") {
            model.todayAttention = Self.syntheticTodayAttention(for: fixtureState)
        }
        if arguments.contains("--open-action-center") {
            model.selectedNavigation = .actionCenter
        }
        return model
    }

    private static func value(after flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    private static func scopeIdentityTerms(_ displayLabel: String) -> [String] {
        let name = displayLabel
            .components(separatedBy: " — ").first?
            .components(separatedBy: " – ").first?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? displayLabel
        let normalizedName = normalizedIdentityText(name)
        let words = normalizedName.split(separator: " ").map(String.init)
        let distinctiveWords = words.filter { word in
            word.unicodeScalars.contains(where: { !$0.isASCII }) ? word.count >= 2 : word.count >= 4
        }
        return Array(Set(([normalizedName] + distinctiveWords).filter { !$0.isEmpty }))
    }

    private static func source(_ source: String, containsIdentityTerm term: String) -> Bool {
        let normalizedSource = normalizedIdentityText(source)
        if term.contains(" ") {
            return normalizedSource.contains(term)
        }
        return Set(normalizedSource.split(separator: " ").map(String.init)).contains(term)
    }

    private static func normalizedIdentityText(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .lowercased()
            .unicodeScalars
            .map { CharacterSet.alphanumerics.contains($0) ? Character(String($0)) : " " }
            .reduce(into: "") { partial, character in
                if character == " ", partial.last == " " { return }
                partial.append(character)
            }
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var initializationTask: Task<Bool, Never>?
    private var didInitialize = false

    /// Native intake cannot save under the pre-login placeholder account.
    func ensureInitialized() async -> Bool {
        if didInitialize { return true }
        if let initializationTask { return await initializationTask.value }
        let task = Task { @MainActor in
            do {
                self.apply(try await self.service.loadWorkspace())
                self.didInitialize = true
                return true
            } catch {
                self.fail(error)
                return false
            }
        }
        initializationTask = task
        let ready = await task.value
        initializationTask = nil
        return ready
    }

    func load() async {
        do {
            apply(try await service.loadWorkspace())
        } catch {
            fail(error)
        }
    }

    func addSelectedText(_ text: String) {
        guard !isSignedOut else {
            errorMessage = "Sign in before creating a new Context Capsule."
            return
        }
        guard !isPaused else {
            errorMessage = "Context intake is paused. Resume before adding anything."
            return
        }
        invalidateActiveFileImport()
        let acceptedAt = Date()
        let countBefore = capsule.items.count
        capsule.addSelectedText(text, now: acceptedAt)
        guard capsule.items.count > countBefore else { return }
        intakeControlReceipt = nil
        fileIngestReceipt = nil
        localRecoveryNotice = nil
        companionTrialMetrics = CompanionTrialMetrics(inputAcceptedAt: acceptedAt)
        companionTrialExportReceipt = nil
        persistCapsule()
        refreshProvisionalInsight()
        companionTrialMetrics.firstValueMilliseconds = Date().timeIntervalSince(acceptedAt) * 1_000
        companionTrialMetrics.actionWasProposed = provisionalInsight?.suggestedAction != nil
        mode = capsule.items.isEmpty ? .empty : .ready
        errorMessage = nil
    }

    @discardableResult
    func addServiceSelectedText(_ text: String, requestID: UUID) -> Bool {
        guard !handledServiceRequestIDs.contains(requestID) else { return false }
        handledServiceRequestIDs.insert(requestID)
        let countBefore = capsule.items.count
        addSelectedText(text)
        if capsule.items.count > countBefore {
            intakeControlReceipt = "Added text from an explicitly invoked macOS selection service. No clipboard polling or background capture occurred."
            return true
        }
        return false
    }

    func addFiles(_ urls: [URL]) async {
        guard !isSignedOut else {
            errorMessage = "Sign in before creating a new Context Capsule."
            return
        }
        guard !isPaused else {
            errorMessage = "Context intake is paused. Resume before adding anything."
            return
        }
        guard !isImportingFiles, !isSelectingWindow, !urls.isEmpty else { return }

        let acceptedAt = Date()
        let importID = UUID()
        let selectedURLs = Array(urls.prefix(8))
        var extractedFiles: [LocalFileTextExtraction] = []
        var failureCount = max(0, urls.count - selectedURLs.count)
        var firstFailure: Error?
        activeFileImportID = importID
        isImportingFiles = true
        fileIngestReceipt = "Reading \(selectedURLs.count) explicitly chosen file\(selectedURLs.count == 1 ? "" : "s") on this Mac. Nothing has left the device."
        defer {
            if activeFileImportID == importID {
                activeFileImportID = nil
                isImportingFiles = false
            }
        }

        for url in selectedURLs {
            let didAccess = url.startAccessingSecurityScopedResource()
            defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
            do {
                let extracted = try await localFileTextExtractor.extract(url: url)
                guard activeFileImportID == importID, !isSignedOut, !isPaused else { return }
                extractedFiles.append(extracted)
            } catch {
                guard activeFileImportID == importID, !isSignedOut, !isPaused else { return }
                failureCount += 1
                if firstFailure == nil { firstFailure = error }
            }
        }

        guard activeFileImportID == importID, !isSignedOut, !isPaused else { return }
        guard !extractedFiles.isEmpty else {
            fileIngestReceipt = "No file was retained or added to the Capsule."
            errorMessage = firstFailure?.localizedDescription ?? "No supported file was selected."
            return
        }

        for extracted in extractedFiles {
            capsule.addProcessedFile(
                displayName: extracted.displayName,
                reviewedText: extracted.recognizedText,
                rawData: extracted.rawData,
                mediaType: extracted.mediaType,
                acquisition: extracted.method.acquisition,
                sourceFingerprint: extracted.sourceFingerprint,
                now: acceptedAt
            )
        }
        let importedCount = extractedFiles.count
        let reviewableCount = extractedFiles.lazy.filter { !$0.recognizedText.isEmpty }.count

        intakeControlReceipt = nil
        windowCaptureReceipt = nil
        localRecoveryNotice = nil
        companionTrialMetrics = CompanionTrialMetrics(inputAcceptedAt: acceptedAt)
        companionTrialExportReceipt = nil
        persistCapsule()
        refreshProvisionalInsight()
        companionTrialMetrics.firstValueMilliseconds = provisionalInsight == nil
            ? nil
            : Date().timeIntervalSince(acceptedAt) * 1_000
        companionTrialMetrics.actionWasProposed = provisionalInsight?.suggestedAction != nil
        mode = capsule.items.isEmpty ? .empty : .ready
        let reviewSummary = reviewableCount > 0
            ? "\(reviewableCount) produced reviewable local text."
            : "No reviewable text was found; the raw file remains encrypted and local-only."
        let failureSummary = failureCount > 0
            ? " \(failureCount) other selection\(failureCount == 1 ? "" : "s") was not retained."
            : ""
        fileIngestReceipt = "Added \(importedCount) explicitly chosen file\(importedCount == 1 ? "" : "s"). \(reviewSummary) Raw bytes and text remain on this Mac until you change the visible boundary.\(failureSummary)"
        errorMessage = failureCount > 0
            ? "Some selected files could not be reviewed locally. \(firstFailure?.localizedDescription ?? "Unsupported selections were not retained.")"
            : nil
    }

    func addSystemSelectedWindow() async {
        guard !isSignedOut else {
            errorMessage = "Sign in before creating a new Context Capsule."
            return
        }
        guard !isPaused else {
            errorMessage = "Context intake is paused. Resume before adding anything."
            return
        }
        guard !isSelectingWindow, !isImportingFiles else { return }

        isSelectingWindow = true
        fileIngestReceipt = nil
        windowCaptureReceipt = "Waiting for the macOS single-window picker. Nothing has been captured yet."
        defer { isSelectingWindow = false }
        do {
            let captured = try await windowCapture.captureOneWindow()
            let acceptedAt = Date()
            capsule.addWindowCapture(
                recognizedText: captured.recognizedText,
                imagePNG: captured.imagePNG,
                pixelWidth: captured.pixelWidth,
                pixelHeight: captured.pixelHeight,
                sourceFingerprint: captured.sourceFingerprint,
                now: acceptedAt
            )
            intakeControlReceipt = nil
            localRecoveryNotice = nil
            companionTrialMetrics = CompanionTrialMetrics(inputAcceptedAt: acceptedAt)
            companionTrialExportReceipt = nil
            persistCapsule()
            refreshProvisionalInsight()
            companionTrialMetrics.firstValueMilliseconds = provisionalInsight == nil
                ? nil
                : Date().timeIntervalSince(acceptedAt) * 1_000
            companionTrialMetrics.actionWasProposed = provisionalInsight?.suggestedAction != nil
            mode = .ready
            let derivative: String
            if captured.localTextRecognition == .unavailable {
                derivative = "Local text recognition was unavailable. The encrypted image remains on this Mac; no cloud fallback ran."
            } else if captured.recognizedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                derivative = "No text derivative was recognized; the image cannot leave this Mac."
            } else {
                derivative = "Local OCR produced a reviewable text derivative; it remains local-only until you change the visible boundary."
            }
            windowCaptureReceipt = "Captured exactly one frame from the system-selected window. No cursor or audio was captured. \(derivative)"
            errorMessage = nil
        } catch WindowCaptureError.cancelled {
            windowCaptureReceipt = "Window selection cancelled. Nothing was captured or retained."
            errorMessage = nil
        } catch {
            windowCaptureReceipt = "Window capture failed before a Capsule item was created."
            fail(error)
        }
    }

    func cancelSystemSelectedWindow() {
        guard isSelectingWindow else { return }
        windowCapture.cancelCapture()
    }

    func removeCapsuleItem(id: UUID) {
        capsule.remove(id: id)
        persistCapsule()
        refreshProvisionalInsight()
        mode = capsule.items.isEmpty ? .empty : .ready
    }

    func setLocalOnly(id: UUID, value: Bool) {
        capsule.setLocalOnly(id: id, value: value)
        persistCapsule()
        refreshProvisionalInsight()
    }

    func setRetention(id: UUID, value: CapsuleRetention) {
        capsule.setRetention(id: id, value: value)
        persistPreparedDraftRecoveryIfNeeded()
        refreshProvisionalInsight()
    }

    func setAttribution(id: UUID, actorKind: CapsuleActorKind?) {
        capsule.setActorKind(id: id, value: actorKind)
        persistCapsule()
        refreshProvisionalInsight()
    }

    func confirmAttribution(id: UUID) {
        capsule.confirmAttribution(id: id)
        persistCapsule()
        refreshProvisionalInsight()
    }

    func attributeFirstUnresolvedItemToCandidate() {
        guard let item = capsule.items.first(where: { !$0.hasConfirmedAttribution }) else { return }
        setAttribution(id: item.id, actorKind: .candidate)
    }

    func confirmFirstPendingAttribution() {
        guard let item = capsule.items.first(where: {
            $0.actorKind != nil && !$0.hasConfirmedAttribution
        }) else { return }
        confirmAttribution(id: item.id)
    }

    func redactCapsuleItem(id: UUID, exactTerms: [String]) {
        let count = capsule.redact(id: id, exactTerms: exactTerms)
        errorMessage = count == 0
            ? "No matching text was redacted. Enter an exact visible term."
            : nil
        if count > 0 {
            persistCapsule()
            refreshProvisionalInsight()
        }
    }

    func submitCapsule() async {
        await submitCapsule(sourceItemID: nil)
    }

    func submitCurrentInsight() async {
        guard let sourceItemID = provisionalInsight?.sourceItemID else {
            errorMessage = "Review one exact evidence source before creating a save proposal."
            return
        }
        await submitCapsule(sourceItemID: sourceItemID)
    }

    private func submitCapsule(sourceItemID: UUID?) async {
        do {
            guard scopeReviewStatus == .confirmed else {
                throw RelationshipServiceError.invalidResponse("Confirm the Pursuit, Person, and relationship context, or keep identity unresolved, before submission.")
            }
            let manifest = try capsule.freeze(
                accountID: accountID,
                pursuitID: pursuitID,
                personID: personID,
                sourceItemID: sourceItemID
            )
            lastSubmittedManifest = manifest
            mode = .working
            errorMessage = nil
            apply(try await service.submit(manifest: manifest))
        } catch {
            fail(error)
        }
    }

    var canSubmitCapsule: Bool {
        scopeReviewStatus == .confirmed && capsule.canSubmit && mode != .working
    }

    var canSubmitCurrentInsight: Bool {
        guard scopeReviewStatus == .confirmed,
              mode != .working,
              let sourceItemID = provisionalInsight?.sourceItemID else {
            return false
        }
        return capsule.canSubmit(sourceItemID: sourceItemID)
    }

    var currentInsightHasSubmittedManifest: Bool {
        guard let sourceItemID = provisionalInsight?.sourceItemID,
              let lastSubmittedManifest else {
            return false
        }
        return lastSubmittedManifest.selectedItems.map(\.sourceID) == [sourceItemID.uuidString]
    }

    func confirmRelationshipScope() async {
        guard let selectedScopeOptionID,
              let option = relationshipScopeOptions.first(where: { $0.id == selectedScopeOptionID }) else {
            errorMessage = "Select one exact Pursuit, Person, and relationship context, or keep identity unresolved."
            return
        }
        guard pursuitID == option.pursuitID,
              personID == option.personID,
              relationshipContextID == option.relationshipContextID else {
            errorMessage = "The proposed relationship scope is incomplete. Keep it unresolved instead of guessing."
            return
        }
        do {
            try await service.confirmScope(option.selection)
            scopeReviewStatus = .confirmed
            if companionTrialMetrics.scopeReviewStartedMilliseconds != nil {
                companionTrialMetrics.scopeConfirmedMilliseconds = elapsedTrialMilliseconds()
            }
            errorMessage = nil
        } catch {
            fail(error)
        }
    }

    func selectRelationshipScopeOption(id: String) {
        guard scopeReviewStatus == .proposed,
              let option = relationshipScopeOptions.first(where: { $0.id == id }) else { return }
        focusedTodayAttentionItem = nil
        selectedScopeOptionID = option.id
        pursuitID = option.pursuitID
        personID = option.personID
        relationshipContextID = option.relationshipContextID
        presentation = option.presentation
        reminderDuplicateActionDecision = Self.duplicateActionDecision(for: option.consequencePreflight)
        if !hasReminderExternalRecoveryState {
            // Relationship choice changes the authority and duplicate-action
            // boundary, but it must not erase the reminder the recruiter just
            // reviewed or edited. Any destination preview is no longer valid.
            clearReminderDestinationPreview()
        }
        errorMessage = nil
    }

    func selectFirstRelationshipScopeFromKeyboard() {
        guard selectedScopeOptionID == nil, let first = relationshipScopeOptions.first else { return }
        selectRelationshipScopeOption(id: first.id)
    }

    func keepRelationshipScopeUnresolved() {
        focusedTodayAttentionItem = nil
        scopeReviewStatus = .unresolved
        selectedScopeOptionID = nil
        pursuitID = nil
        personID = nil
        relationshipContextID = nil
        reminderDuplicateActionDecision = .unavailable
        resetReminderPreparationPreservingExternalRecovery()
        mode = .ambiguousIdentity
        pendingDecision = nil
        runAudit = nil
        canonicalReceipt = nil
        decisionSelections = [:]
        errorMessage = nil
    }

    func clearLocalContext() {
        invalidateActiveFileImport()
        let count = capsule.items.count
        let localReceipt: LocalCapsuleDeletionReceipt
        do {
            localReceipt = try capsuleStore.clear(accountID: accountID, deleteKey: false)
        } catch {
            fail(error)
            return
        }
        capsule = ContextCapsuleDraft()
        provisionalInsight = nil
        editableFollowUpDraft = ""
        editableMailSubject = ""
        preparedDraftKind = nil
        mailDraftHandoffStatus = .notOpened
        localDraftStatus = .awaitingDecision
        resetReminderPreparationPreservingExternalRecovery()
        companionTrialMetrics = CompanionTrialMetrics()
        companionTrialExportReceipt = nil
        quickPanelNavigationRequest = nil
        lastSubmittedManifest = nil
        pendingDecision = nil
        runAudit = nil
        canonicalReceipt = nil
        identityReviewReceipt = nil
        decisionSelections = [:]
        presentation = .cleared
        scopeReviewStatus = .proposed
        selectedScopeOptionID = nil
        reminderDuplicateActionDecision = .unavailable
        mode = .deleted
        let reminderBoundary = hasReminderExternalRecoveryState
            ? " Existing reminder execution/recovery state remains visible in Needs your review."
            : ""
        deletionReceipt = "Deleted \(count) visible local Capsule item\(count == 1 ? "" : "s")\(localReceipt.deletedFile ? " and its encrypted recovery file" : ""). No external record was changed.\(reminderBoundary)"
        localRecoveryNotice = nil
        windowCaptureReceipt = nil
        fileIngestReceipt = nil
        errorMessage = nil
    }

    func togglePause() {
        guard !isSignedOut else {
            errorMessage = "Sign in before resuming context intake."
            return
        }
        isPaused.toggle()
        if isPaused { invalidateActiveFileImport() }
        intakeControlReceipt = isPaused
            ? "Paused new context intake. Existing local Capsule items were retained; no canonical Task was stopped."
            : "Resumed manual context intake. Nothing is captured until you explicitly add it."
        errorMessage = nil
    }

    func toggleAccessibilityZoomPreview() {
        guard isSyntheticFixture else { return }
        isAccessibilityZoomPreview.toggle()
    }

    func toggleReducedMotionPreview() {
        guard isSyntheticFixture else { return }
        isReducedMotionPreview.toggle()
    }

    func stopContextIntake() {
        guard !isSignedOut else {
            errorMessage = "Context intake is already stopped because this Mac is signed out."
            return
        }
        let count = capsule.items.count
        invalidateActiveFileImport()
        do {
            let local = try capsuleStore.clear(accountID: accountID, deleteKey: false)
            capsule = ContextCapsuleDraft()
            provisionalInsight = nil
            editableFollowUpDraft = ""
            editableMailSubject = ""
            preparedDraftKind = nil
            mailDraftHandoffStatus = .notOpened
            localDraftStatus = .awaitingDecision
            resetReminderPreparationPreservingExternalRecovery()
            companionTrialMetrics = CompanionTrialMetrics()
            companionTrialExportReceipt = nil
            quickPanelNavigationRequest = nil
            lastSubmittedManifest = nil
            isPaused = true
            localRecoveryNotice = nil
            windowCaptureReceipt = nil
            fileIngestReceipt = nil
            let taskBoundary = currentTaskID.map {
                "Canonical Task \($0) was not cancelled; its status remains visible separately."
            } ?? "No canonical Task was active."
            let reminderBoundary = hasReminderExternalRecoveryState
                ? " Existing reminder execution/recovery state remains visible in Needs your review."
                : ""
            intakeControlReceipt = "Stopped local context intake and deleted \(count) visible local item\(count == 1 ? "" : "s")\(local.deletedFile ? " plus its encrypted recovery file" : ""). \(taskBoundary)\(reminderBoundary)"
            deletionReceipt = intakeControlReceipt
            if ![.working, .needsDecision, .receipt, .outcomeUnknown, .failed].contains(mode) {
                mode = count > 0 ? .deleted : .empty
            }
            errorMessage = nil
        } catch {
            isPaused = true
            errorMessage = "Intake paused, but local Capsule deletion could not be verified: \(error.localizedDescription)"
            intakeControlReceipt = "Stopped accepting new context. Existing local recovery may remain until deletion succeeds; no canonical Task was cancelled."
        }
    }

    func signOutAndClearLocalData() async {
        invalidateActiveFileImport()
        focusedTodayAttentionItem = nil
        let priorAccountID = accountID
        var remoteReceipt: SessionSignOutReceipt?
        var remoteFailure: Error?
        do {
            remoteReceipt = try await service.signOut()
        } catch {
            remoteFailure = error
        }

        var localReceipt: LocalCapsuleDeletionReceipt?
        var localFailure: Error?
        var reminderRecoveryDeleted = false
        var reminderRecoveryFailure: Error?
        followUpReminderService.clearLocalRecovery()
        do {
            reminderRecoveryDeleted = try reminderRecoveryStore.clear(accountID: priorAccountID)
        } catch {
            reminderRecoveryFailure = error
        }
        do {
            localReceipt = try capsuleStore.clear(accountID: priorAccountID, deleteKey: true)
        } catch {
            localFailure = error
        }

        // In-memory authority and content are always removed. A disk deletion
        // failure remains visible and never causes the old signed-in workspace
        // to be presented again.
        capsule = ContextCapsuleDraft()
        provisionalInsight = nil
        editableFollowUpDraft = ""
        editableMailSubject = ""
        preparedDraftKind = nil
        mailDraftHandoffStatus = .notOpened
        localDraftStatus = .awaitingDecision
        resetReminderPreparation()
        activeReminderRecovery = nil
        isReminderRecoveryUnreadable = false
        reminderRecoveryNotice = nil
        recoveredReminderAccountIDs.remove(priorAccountID)
        companionTrialMetrics = CompanionTrialMetrics()
        companionTrialExportReceipt = nil
        quickPanelNavigationRequest = nil
        lastSubmittedManifest = nil
        pendingDecision = nil
        runAudit = nil
        canonicalReceipt = nil
        identityReviewReceipt = nil
        decisionSelections = [:]
        presentation = .cleared
        accountID = "signed-out"
        pursuitID = nil
        personID = nil
        relationshipContextID = nil
        currentTaskID = nil
        relationshipScopeOptions = []
        todayAttention = .empty
        selectedScopeOptionID = nil
        reminderDuplicateActionDecision = .unavailable
        scopeReviewStatus = .unresolved
        isPaused = true
        isSignedOut = true
        mode = .empty
        localRecoveryNotice = nil
        windowCaptureReceipt = nil
        fileIngestReceipt = nil
        intakeControlReceipt = "Signed out. This Mac will not accept new context until a new authenticated session is established."

        let remoteSummary: String
        if let remoteReceipt {
            remoteSummary = "Remote session \(remoteReceipt.sessionID) was revoked at \(remoteReceipt.revokedAt)."
        } else {
            remoteSummary = "Remote session revocation is outcome-unknown. This Mac discarded its local session authority; reconnect to verify the server session."
        }
        let localSummary: String
        if let localReceipt {
            let reminderSummary = reminderRecoveryFailure == nil
                ? (reminderRecoveryDeleted ? "Deleted encrypted reminder recovery." : "No reminder recovery file remained.")
                : "Encrypted reminder recovery deletion could not be verified."
            localSummary = "\(localReceipt.deletedFile ? "Deleted encrypted Capsule recovery." : "No Capsule recovery file remained.") \(reminderSummary) \(localReceipt.deletedKey ? "Deleted the account-scoped local key." : "No account-scoped local key remained.")"
        } else {
            localSummary = "Encrypted recovery deletion could not be verified."
        }
        deletionReceipt = "\(remoteSummary) \(localSummary) Visible local context and relationship authority were cleared."

        if let reminderRecoveryFailure {
            errorMessage = "Signed out locally, but reminder recovery deletion needs attention: \(reminderRecoveryFailure.localizedDescription)"
        } else if let localFailure {
            errorMessage = "Signed out locally, but local recovery deletion needs attention: \(localFailure.localizedDescription)"
        } else if let remoteFailure {
            errorMessage = "Signed out locally; remote revocation outcome is unknown: \(remoteFailure.localizedDescription)"
        } else {
            errorMessage = nil
        }
    }

    func selectFixtureState(_ state: WorkspaceMode) {
        guard isSyntheticFixture else { return }
        apply(.syntheticFixture(FixtureRelationshipService.fixture(mode: state)))
    }

    /// Opens the exact current Today projection as a read-only relationship
    /// explanation. It deliberately does not select or confirm a relationship
    /// scope; Today is navigation authority, not mutation authority.
    func openTodayAttention(id: String) {
        guard let item = todayAttention.items.first(where: { $0.id == id }) else {
            errorMessage = "This Today item changed. Return to Today and open the current version."
            return
        }
        focusedTodayAttentionItem = item
        selectedNavigation = .workspace
        errorMessage = nil
    }

    /// Gives keyboard and menu users the same work-first transition as the
    /// first canonical relationship follow-up in Today. It resolves the item
    /// from the current projection instead of retaining a stale identifier.
    func openFirstTodayAttentionFromKeyboard() {
        guard let item = todayAttention.items.first else {
            errorMessage = "No relationship follow-up currently needs attention."
            return
        }
        openTodayAttention(id: item.id)
    }

    /// Continues the still-open recruiter-owned next move after relationship
    /// review without replaying the completed review receipt. This prepares
    /// only local draft/reminder state; external authority remains behind the
    /// Quick Panel's exact consequence review.
    func prepareCurrentConversationNextStep() {
        guard canPrepareCurrentConversationNextStep,
              let suggestedAction = provisionalInsight?.suggestedAction else {
            errorMessage = mode == .noAction
                ? "The review found no new action. Open the result instead of creating duplicate work."
                : "This conversation does not support a prepared next step. Review the exact evidence first."
            return
        }

        switch suggestedAction {
        case .prepareClientQuestion:
            if localDraftStatus == .awaitingDecision { prepareClientQuestion() }
            guard localDraftStatus != .awaitingDecision else { return }
            quickPanelNavigationRequest = .init(destination: .insight)
        case .prepareCandidateFollowUp:
            if localDraftStatus == .awaitingDecision { prepareDraft(kind: .candidateFollowUp) }
            guard localDraftStatus != .awaitingDecision else { return }
            quickPanelNavigationRequest = .init(destination: .insight)
        case .createReminder:
            recordConsequenceReviewStarted()
            beginReminderPreparation()
            guard errorMessage == nil else { return }
            quickPanelNavigationRequest = .init(destination: .reminder)
        }
    }

    func consumeQuickPanelNavigationRequest(id: UUID) {
        guard quickPanelNavigationRequest?.id == id else { return }
        quickPanelNavigationRequest = nil
    }

    func reviewFocusedTodayProposal() async {
        guard let item = focusedTodayAttentionItem,
              item.kind == .proposalReview,
              let proposalID = item.proposalID else {
            errorMessage = "This Today item does not have a current Proposal review gate. Return to Today and refresh."
            return
        }
        if isSyntheticFixture {
            apply(.syntheticFixture(FixtureRelationshipService.fixture(mode: .needsDecision)))
            selectedNavigation = .workspace
            return
        }
        do {
            mode = .working
            errorMessage = nil
            apply(try await service.openTodayProposalReview(
                pursuitID: item.pursuitID,
                proposalID: proposalID
            ))
            selectedNavigation = .workspace
        } catch {
            fail(error)
        }
    }

    func openActionProjection(_ action: ActionProjection) async {
        focusedTodayAttentionItem = nil
        selectedNavigation = .workspace
        if isSyntheticFixture {
            let target: WorkspaceMode = switch action.route {
            case .reviewDecision: .needsDecision
            case .reconcileOperation: .outcomeUnknown
            case .openReceipt: .receipt
            case .reviewStaleSource: .stale
            case .openCurrent: mode
            }
            apply(.syntheticFixture(FixtureRelationshipService.fixture(mode: target)))
            return
        }

        do {
            mode = .working
            errorMessage = nil
            apply(try await service.openProjection(.init(
                objectID: action.id,
                route: action.route
            )))
        } catch {
            fail(error)
        }
    }

    func copyPreparedDraft() {
        let text = editableFollowUpDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            localDraftStatus = .awaitingDecision
            errorMessage = "No supported editable draft is available to copy. Nothing was copied or sent."
            return
        }
        if preparedDraftClipboard.copyPreparedDraft(text) {
            localDraftStatus = .copied
            companionTrialMetrics.completedActions.insert(.draftCopied)
            companionTrialExportReceipt = nil
            errorMessage = nil
        } else {
            localDraftStatus = .prepared
            errorMessage = "The draft remains prepared, but macOS did not confirm the clipboard write. Copy again; nothing was sent."
        }
    }

    func returnToCapsuleAfterFailure() {
        guard mode == .failed else { return }
        errorMessage = nil
        mode = capsule.items.isEmpty ? .empty : .ready
        intakeControlReceipt = "Returned to local Capsule review. No Task, decision, or external action was retried. Canonical failure history remains in Action Center."
    }

    func confirmFactProposal() {
        factReviewStatus = .confirmed
    }

    func dismissFactProposal() {
        factReviewStatus = .dismissed
    }

    func prepareLocalDraft() {
        guard let insight = provisionalInsight else {
            errorMessage = "No supported follow-up signal is available for a draft. Review the selected evidence or leave it as no action."
            return
        }
        let kind: PreparedDraftKind = insight.suggestedAction == .prepareClientQuestion
            ? .clientQuestion
            : .candidateFollowUp
        prepareDraft(kind: kind)
    }

    func prepareClientQuestion() {
        prepareDraft(kind: .clientQuestion)
    }

    func prepareDraft(kind: PreparedDraftKind) {
        guard let insight = provisionalInsight,
              let draft = EvidenceBoundDraftComposer.compose(kind: kind, insight: insight) else {
            let language = provisionalInsight?.language ?? .english
            let purpose = kind.title(language: language)
            errorMessage = language == .chinese
                ? "选择的证据不足以支持“\(purpose)”。系统没有准备或发送任何内容。"
                : "The selected evidence does not support a \(purpose.lowercased()). Nothing was prepared or sent."
            return
        }
        if let previousKind = preparedDraftKind, previousKind != kind {
            companionTrialMetrics.actionWasEdited = true
        }
        preparedDraftKind = draft.kind
        editableFollowUpDraft = draft.body
        editableMailSubject = draft.subject
        preparedDraftBaseline = (draft.kind, draft.subject, draft.body)
        mailDraftHandoffStatus = .notOpened
        localDraftStatus = .prepared
        recordDraftPreparedMetric()
        persistPreparedDraftRecoveryIfNeeded()
        errorMessage = nil
    }

    func recordEvidenceSupport(_ judgment: EvidenceSupportJudgment) {
        companionTrialMetrics.evidenceSupport = judgment
        companionTrialExportReceipt = nil
    }

    func recordChangeUnderstanding(_ judgment: ChangeUnderstandingJudgment) {
        companionTrialMetrics.changeUnderstanding = judgment
        companionTrialExportReceipt = nil
    }

    func recordConsequenceReviewStarted() {
        if companionTrialMetrics.scopeReviewStartedMilliseconds == nil {
            companionTrialMetrics.scopeReviewStartedMilliseconds = elapsedTrialMilliseconds()
        }
    }

    func recordConsequenceReviewAbandoned() {
        guard companionTrialMetrics.scopeReviewStartedMilliseconds != nil,
              companionTrialMetrics.completedActions.isEmpty,
              companionTrialMetrics.consequenceReviewAbandonedMilliseconds == nil else { return }
        companionTrialMetrics.consequenceReviewAbandonedMilliseconds = elapsedTrialMilliseconds()
        companionTrialExportReceipt = nil
    }

    func recordReuseIntent(_ intent: CompanionReuseIntent) {
        companionTrialMetrics.reuseIntent = intent
        companionTrialExportReceipt = nil
    }

    var hasCompletedCompanionAction: Bool {
        !companionTrialMetrics.completedActions.isEmpty
    }

    var shouldShowCompanionTrialFeedback: Bool {
        hasCompletedCompanionAction || companionTrialMetrics.consequenceReviewAbandonedMilliseconds != nil
    }

    func companionTrialExportJSON() -> String? {
        let export = CompanionTrialExport(metrics: companionTrialMetrics)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(export) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func copyCompanionTrialExport() {
        guard let text = companionTrialExportJSON() else {
            companionTrialExportReceipt = "Session measures could not be prepared. No conversation content was copied."
            return
        }
        companionTrialExportReceipt = companionTrialExportClipboard.copyTrialExport(text)
            ? "Content-free session measures copied"
            : "macOS did not confirm the session-measure copy"
    }

    func markPreparedDraftEdited() {
        if localDraftStatus == .copied {
            localDraftStatus = .prepared
            mailDraftHandoffStatus = .notOpened
        }
        guard let baseline = preparedDraftBaseline else { return }
        if baseline.kind != preparedDraftKind ||
            baseline.subject != editableMailSubject ||
            baseline.body != editableFollowUpDraft {
            companionTrialMetrics.actionWasEdited = true
            companionTrialExportReceipt = nil
        }
    }

    func markReminderEdited() {
        guard let baseline = reminderBaseline else { return }
        if baseline.title != reminderTitle || baseline.dueAt != reminderDueAt {
            companionTrialMetrics.actionWasEdited = true
            companionTrialExportReceipt = nil
        }
    }

    func markMailDraftEdited() {
        if case .opened = mailDraftHandoffStatus {
            mailDraftHandoffStatus = .notOpened
        }
        persistPreparedDraftRecoveryIfNeeded()
    }

    func discardPreparedDraft() {
        editableFollowUpDraft = ""
        editableMailSubject = ""
        preparedDraftKind = nil
        preparedDraftBaseline = nil
        localDraftStatus = .awaitingDecision
        mailDraftHandoffStatus = .notOpened
        capsule.localPreparedDraft = nil
        persistCapsule()
        intakeControlReceipt = "Discarded the unsent draft from this Mac. Nothing was sent."
        errorMessage = nil
    }

    func openPreparedMailDraft() {
        let body = editableFollowUpDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else {
            mailDraftHandoffStatus = .failed("The editable draft is empty. Nothing was opened or sent.")
            return
        }
        switch preparedMailDraftService.openDraft(subject: editableMailSubject, body: body) {
        case .success(let receipt):
            mailDraftHandoffStatus = .opened(receipt)
            companionTrialMetrics.completedActions.insert(.mailDraftOpened)
            companionTrialExportReceipt = nil
            errorMessage = nil
        case .failure(let failure):
            mailDraftHandoffStatus = .failed(mailDraftFailureMessage(failure))
        }
    }

    var hasReviewedReminderAuthority: Bool {
        guard scopeReviewStatus == .confirmed,
              let sourceID = provisionalInsight?.sourceItemID,
              let item = capsule.items.first(where: { $0.id == sourceID }) else {
            return false
        }
        return item.actorKind == .candidate && item.hasConfirmedAttribution
    }

    var canPreviewReminderDestination: Bool {
        hasReviewedReminderAuthority &&
            hasReviewedDuplicateActionBoundary &&
            !reminderTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            reminderDueAt > Date()
    }

    func confirmSeparateReminderAfterExistingActionReview() {
        guard let preflight = selectedRelationshipConsequencePreflight,
              !preflight.openActions.isEmpty,
              !hasReminderExternalRecoveryState else { return }
        reminderDuplicateActionDecision = .separateReminderConfirmed
        intakeControlReceipt = "Reviewed the existing recruiter-owned action. This reminder is deliberately separate; nothing has been written yet."
        errorMessage = nil
    }

    func useExistingOwnedActionInstead() {
        guard let preflight = selectedRelationshipConsequencePreflight,
              !preflight.openActions.isEmpty,
              !hasReminderExternalRecoveryState else { return }
        reminderDuplicateActionDecision = .useExistingAction
        clearReminderDestinationPreview()
        clearReminderRecovery()
        intakeControlReceipt = "Using the existing recruiter-owned action. No Apple Reminder was created; any earlier destination preview was discarded."
        errorMessage = nil
    }

    func reconsiderReminderDuplicateActionDecision() {
        guard let preflight = selectedRelationshipConsequencePreflight,
              !preflight.openActions.isEmpty,
              !hasReminderExternalRecoveryState else { return }
        reminderDuplicateActionDecision = .unreviewed
        clearReminderDestinationPreview()
        intakeControlReceipt = nil
        errorMessage = nil
    }

    func beginReminderPreparation(now: Date = Date()) {
        guard !hasReminderExternalRecoveryState else {
            errorMessage = "Finish checking or removing the earlier reminder before preparing another one. Its external state remains visible in Needs your review."
            return
        }
        guard let insight = provisionalInsight, insight.canPrepareAction else {
            errorMessage = "No supported follow-up signal is available for a reminder."
            return
        }
        if reminderTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            reminderTitle = "Follow up · \(insight.change)"
        }
        if reminderDueAt <= now {
            var components = Calendar.current.dateComponents([.year, .month, .day], from: now)
            components.day = (components.day ?? 0) + 1
            components.hour = 9
            components.minute = 0
            reminderDueAt = Calendar.current.date(from: components) ?? now.addingTimeInterval(24 * 60 * 60)
        }
        reminderBaseline = (reminderTitle, reminderDueAt)
        errorMessage = nil
    }

    func loadReminderDestinationPreview() async {
        guard canPreviewReminderDestination else {
            reminderOperationState = .failed("Confirm the relationship and candidate attribution, review any existing recruiter-owned action, then provide a future date and non-empty title before previewing the destination.")
            return
        }
        reminderOperationState = .loadingDestination
        switch await followUpReminderService.previewDestination() {
        case .success(let destination):
            reminderDestination = destination
            reminderOperationState = .readyForApproval
            if let proposal = currentReminderProposal {
                _ = persistReminderRecovery(proposal: proposal, stage: .proposalPrepared)
            }
        case .failure(let failure):
            reminderDestination = nil
            reminderOperationState = .failed(reminderFailureMessage(failure, afterWriteAttempt: false))
        }
    }

    func approveAndCreateReminder() async {
        guard let proposal = currentReminderProposal else {
            reminderOperationState = .failed("The exact reminder preview is incomplete. Review its title, date, destination, relationship, and source attribution.")
            return
        }
        guard persistReminderRecovery(proposal: proposal, stage: .executionPending) else {
            reminderOperationState = .failed("Protected local recovery could not be saved, so nothing was created.")
            return
        }
        reminderOperationState = .executing
        switch await followUpReminderService.execute(proposal) {
        case .success(let receipt):
            reminderOperationState = .saved(receipt)
            _ = persistReminderRecovery(proposal: proposal, stage: .verified, receipt: receipt)
            companionTrialMetrics.reminderVerifiedMilliseconds = Date()
                .timeIntervalSince(companionTrialMetrics.inputAcceptedAt) * 1_000
            companionTrialMetrics.completedActions.insert(.reminderVerified)
            companionTrialExportReceipt = nil
        case .failure(let failure):
            switch failure {
            case .saveFailed, .readbackMissing, .readbackMismatch:
                _ = persistReminderRecovery(proposal: proposal, stage: .outcomeUnknown)
                reminderOperationState = .unknown(reminderFailureMessage(failure, afterWriteAttempt: true))
            case .previewOnly, .permissionDenied, .noDefaultList, .destinationChanged, .recoveryUnavailable:
                _ = persistReminderRecovery(proposal: proposal, stage: .proposalPrepared)
                reminderOperationState = .failed(reminderFailureMessage(failure, afterWriteAttempt: true))
            }
        }
    }

    func reconcileReminderOutcome() async {
        guard !isReminderRecoveryUnreadable else {
            reminderOperationState = .unknown(
                "The protected reminder recovery cannot be opened. Inspect Apple Reminders and sign out to clear this account's local recovery before creating anything else."
            )
            return
        }
        guard let proposal = reminderProposalForReconciliation else {
            reminderOperationState = .failed("The reminder proposal changed, so the earlier outcome cannot be reconciled from this preview.")
            return
        }
        reminderOperationState = .executing
        switch await followUpReminderService.reconcile(proposal) {
        case .success(let receipt):
            reminderOperationState = .saved(receipt)
            _ = persistReminderRecovery(proposal: proposal, stage: .verified, receipt: receipt)
            companionTrialMetrics.reminderVerifiedMilliseconds = elapsedTrialMilliseconds()
            companionTrialMetrics.completedActions.insert(.reminderVerified)
            companionTrialExportReceipt = nil
        case .failure(.readbackMissing):
            _ = persistReminderRecovery(proposal: proposal, stage: .proposalPrepared)
            reminderOperationState = .failed("No matching reminder was found in the reviewed list. The exact proposal may be tried again; the recovery reference still prevents duplicates.")
        case .failure(let failure):
            _ = persistReminderRecovery(proposal: proposal, stage: .outcomeUnknown)
            reminderOperationState = .unknown(reminderFailureMessage(failure, afterWriteAttempt: true))
        }
    }

    func removeVerifiedReminder(_ receipt: FollowUpReminderReceipt) async {
        guard let proposal = reminderProposal(for: receipt),
              persistReminderRecovery(proposal: proposal, stage: .removalPending, receipt: receipt) else {
            reminderOperationState = .removalFailed(
                receipt,
                "Protected removal recovery could not be saved, so the reminder was not removed."
            )
            return
        }
        reminderOperationState = .removing(receipt)
        switch await followUpReminderService.remove(receipt) {
        case .success(let removalReceipt):
            reminderOperationState = .removed(removalReceipt)
            clearReminderRecovery()
        case .failure(.saveFailed):
            _ = persistReminderRecovery(proposal: proposal, stage: .removalUnknown, receipt: receipt)
            reminderOperationState = .removalUnknown(
                receipt,
                "Apple Reminders returned an uncertain removal result. Reconcile before trying to remove it again."
            )
        case .failure(let failure):
            _ = persistReminderRecovery(proposal: proposal, stage: .verified, receipt: receipt)
            reminderOperationState = .removalFailed(
                receipt,
                reminderRemovalFailureMessage(failure)
            )
        }
    }

    func reconcileReminderRemoval(_ receipt: FollowUpReminderReceipt) async {
        guard let proposal = reminderProposal(for: receipt) else {
            reminderOperationState = .removalFailed(
                receipt,
                "The protected reminder proposal is unavailable. Inspect Apple Reminders before taking another action."
            )
            return
        }
        reminderOperationState = .removing(receipt)
        switch await followUpReminderService.reconcileRemoval(receipt) {
        case .success(let removalReceipt):
            reminderOperationState = .removed(removalReceipt)
            clearReminderRecovery()
        case .failure(.readbackMismatch):
            _ = persistReminderRecovery(proposal: proposal, stage: .verified, receipt: receipt)
            reminderOperationState = .removalFailed(
                receipt,
                "Apple Reminders readback shows that the reminder still exists. It is safe to review and remove it again."
            )
        case .failure(let failure):
            _ = persistReminderRecovery(proposal: proposal, stage: .removalUnknown, receipt: receipt)
            reminderOperationState = .removalUnknown(
                receipt,
                reminderRemovalFailureMessage(failure)
            )
        }
    }

    private var currentReminderProposal: FollowUpReminderProposal? {
        guard canPreviewReminderDestination,
              let insight = provisionalInsight,
              let reminderDestination else { return nil }
        return FollowUpReminderProposal.make(
            sourceItemID: insight.sourceItemID,
            sourceDigest: insight.sourceDigest,
            title: reminderTitle,
            dueAt: reminderDueAt,
            timeZone: .current,
            evidenceQuote: insight.exactEvidence,
            destination: reminderDestination
        )
    }

    private var reminderProposalForReconciliation: FollowUpReminderProposal? {
        activeReminderRecovery?.proposal ?? currentReminderProposal
    }

    var canReconcileReminderOutcome: Bool {
        !isReminderRecoveryUnreadable && reminderProposalForReconciliation != nil
    }

    private func reminderProposal(for receipt: FollowUpReminderReceipt) -> FollowUpReminderProposal? {
        if let recovery = activeReminderRecovery,
           recovery.proposal.idempotencyKey == receipt.idempotencyKey {
            return recovery.proposal
        }
        guard let proposal = currentReminderProposal,
              proposal.idempotencyKey == receipt.idempotencyKey else {
            return nil
        }
        return proposal
    }

    private func recordDraftPreparedMetric() {
        companionTrialMetrics.draftPreparedMilliseconds = elapsedTrialMilliseconds()
    }

    private func recordRelationshipCompletionMetricIfNeeded(mode: WorkspaceMode) {
        guard provisionalInsight != nil, [.noAction, .receipt].contains(mode) else { return }
        companionTrialMetrics.relationshipReviewCompletedMilliseconds = elapsedTrialMilliseconds()
        companionTrialMetrics.completedActions.insert(.relationshipReviewed)
        companionTrialExportReceipt = nil
    }

    private func elapsedTrialMilliseconds() -> Double {
        Date().timeIntervalSince(companionTrialMetrics.inputAcceptedAt) * 1_000
    }

    private func reminderFailureMessage(_ failure: FollowUpReminderFailure, afterWriteAttempt: Bool) -> String {
        switch failure {
        case .previewOnly:
            return "Synthetic preview never writes to Apple Reminders. Connect a live workspace to create a real reminder."
        case .permissionDenied:
            return "Apple Reminders access was not granted. Nothing was created."
        case .noDefaultList:
            return "Apple Reminders has no default destination list. Choose a default list, then preview again."
        case .destinationChanged:
            return "The reviewed Reminders list is no longer available. Nothing was created; preview the destination again."
        case .recoveryUnavailable:
            return "The local duplicate-prevention reference could not be verified, so nothing was created."
        case .saveFailed:
            return afterWriteAttempt
                ? "Apple Reminders returned an uncertain write result. Check or reconcile before trying again."
                : "The Reminders destination could not be read. Nothing was created."
        case .readbackMissing:
            return "The write returned, but the reminder could not be read back. Its outcome is unknown; reconcile before trying again."
        case .readbackMismatch:
            return "The saved reminder did not match the approved title, date, or destination. Treat the outcome as unknown and inspect Apple Reminders."
        }
    }

    private func reminderRemovalFailureMessage(_ failure: FollowUpReminderFailure) -> String {
        switch failure {
        case .previewOnly:
            "Synthetic preview has no Apple Reminder to remove."
        case .permissionDenied:
            "Apple Reminders access is unavailable, so the verified reminder was not removed."
        case .noDefaultList:
            "The Reminders destination is unavailable; the verified reminder was not removed."
        case .destinationChanged:
            "The original Reminders list is no longer available. Inspect Apple Reminders before taking another action."
        case .recoveryUnavailable:
            "The reminder recovery reference is unavailable. Inspect Apple Reminders before taking another action."
        case .saveFailed:
            "Apple Reminders returned an uncertain removal result. Reconcile before trying again."
        case .readbackMissing:
            "The reminder could not be read back after removal. Reconcile before trying again."
        case .readbackMismatch:
            "The reminder identity did not match the verified receipt, so nothing was removed."
        }
    }

    private func mailDraftFailureMessage(_ failure: MailDraftHandoffFailure) -> String {
        switch failure {
        case .emptyDraft:
            "The editable draft is empty. Nothing was opened or sent."
        case .invalidDraftURL:
            "macOS could not prepare this mail draft. Nothing was opened or sent."
        case .systemRejectedOpen:
            "macOS did not open a mail composer. Nothing was sent."
        }
    }

    func saveIdentityForReview() {
        guard mode == .ambiguousIdentity else { return }
        identityReviewReceipt = IdentityReviewReceipt(
            id: "identity-review-\(UUID().uuidString.lowercased())",
            taskID: currentTaskID,
            summary: isSyntheticFixture
                ? "Synthetic identity review saved. No person was bound and no fact or action authority was granted."
                : "The canonical Agent Task remains unresolved. No person was bound and no fact or action authority was granted.",
            occurredAt: Date()
        )
        pendingDecision = nil
        runAudit = nil
        canonicalReceipt = nil
        decisionSelections = [:]
        mode = .identityReviewSaved
    }

    func setDecision(itemID: String, choice: CanonicalDecisionChoice) {
        guard pendingDecision?.items.contains(where: { $0.id == itemID }) == true else { return }
        decisionSelections[itemID] = choice
    }

    func decideNextCanonicalItem(_ choice: CanonicalDecisionChoice) {
        guard let item = pendingDecision?.items.first(where: { decisionSelections[$0.id] == nil }) else { return }
        setDecision(itemID: item.id, choice: choice)
    }

    var canResolveCanonicalDecision: Bool {
        guard let pendingDecision else { return false }
        return !pendingDecision.items.isEmpty &&
            pendingDecision.items.allSatisfy { decisionSelections[$0.id] != nil }
    }

    func resolveCanonicalDecision() async {
        guard let pendingDecision, canResolveCanonicalDecision else {
            errorMessage = "Choose Confirm, Reject, or Keep unresolved for every proposal item."
            return
        }
        let decisions = pendingDecision.items.compactMap { item in
            decisionSelections[item.id].map {
                CanonicalDecisionRequest.Decision(itemID: item.id, choice: $0)
            }
        }
        do {
            mode = .working
            errorMessage = nil
            apply(try await service.resolveDecision(.init(
                bundleID: pendingDecision.bundleID,
                taskID: pendingDecision.taskID,
                taskRevision: pendingDecision.taskRevision,
                bundleRevision: pendingDecision.bundleRevision,
                proposalID: pendingDecision.proposalID,
                baseRevision: pendingDecision.baseRevision,
                reason: "The recruiter reviewed exact evidence, before and proposed values, effect, and authority in capri for Mac.",
                decisions: decisions
            )))
        } catch {
            fail(error)
        }
    }

    func reconcileCanonicalDecision() async {
        do {
            mode = .working
            errorMessage = nil
            apply(try await service.reconcileDecisionOutcome())
        } catch {
            fail(error)
        }
    }

    private func apply(_ response: MacRelationshipServiceResponse) {
        focusedTodayAttentionItem = nil
        switch response {
        case .connected(let scope):
            let priorAccountID = accountID
            if priorAccountID != scope.accountID {
                // An authenticated account change is an authority boundary.
                // Never carry the previous account's in-memory Capsule,
                // manifest, decisions, or receipts into the new workspace.
                capsule = ContextCapsuleDraft()
                provisionalInsight = nil
                editableFollowUpDraft = ""
                editableMailSubject = ""
                preparedDraftKind = nil
                mailDraftHandoffStatus = .notOpened
                localDraftStatus = .awaitingDecision
                resetReminderPreparation()
                activeReminderRecovery = nil
                isReminderRecoveryUnreadable = false
                reminderRecoveryNotice = nil
                reminderDuplicateActionDecision = .unavailable
                companionTrialMetrics = CompanionTrialMetrics()
                companionTrialExportReceipt = nil
                quickPanelNavigationRequest = nil
                lastSubmittedManifest = nil
                pendingDecision = nil
                runAudit = nil
                canonicalReceipt = nil
                identityReviewReceipt = nil
                decisionSelections = [:]
                localRecoveryNotice = nil
                deletionReceipt = nil
                recoveredAccountIDs.remove(scope.accountID)
                recoveredReminderAccountIDs.remove(scope.accountID)
            }
            isSyntheticFixture = false
            isSignedOut = false
            accountID = scope.accountID
            followUpReminderService.setLocalRecoveryAccount(scope.accountID)
            pursuitID = nil
            personID = nil
            relationshipContextID = nil
            currentTaskID = nil
            relationshipScopeOptions = scope.options
            todayAttention = scope.todayAttention
            selectedScopeOptionID = nil
            reminderDuplicateActionDecision = .unavailable
            presentation = scope.presentation
            pendingDecision = nil
            runAudit = nil
            canonicalReceipt = nil
            identityReviewReceipt = nil
            decisionSelections = [:]
            scopeReviewStatus = .proposed
            mode = .ready
            recoverCapsuleIfNeeded(accountID: scope.accountID)
            recoverReminderOperationIfNeeded(accountID: scope.accountID)
        case .syntheticFixture(let fixture):
            let syntheticOption = Self.syntheticScopeOptionForCurrentProcess
            let preflightPreview = ProcessInfo.processInfo.arguments.contains("--consequence-preflight-preview")
            isSyntheticFixture = true
            isSignedOut = false
            mode = fixture.mode
            presentation = [.empty, .ready].contains(fixture.mode)
                ? Self.unboundScopePresentation
                : fixture.presentation
            factReviewStatus = .proposed
            editableFollowUpDraft = ""
            editableMailSubject = ""
            preparedDraftKind = nil
            mailDraftHandoffStatus = .notOpened
            localDraftStatus = .awaitingDecision
            activeReminderRecovery = nil
            isReminderRecoveryUnreadable = false
            reminderRecoveryNotice = nil
            pendingDecision = fixture.pendingDecision
            canonicalReceipt = fixture.receipt
            runAudit = nil
            identityReviewReceipt = fixture.mode == .identityReviewSaved
                ? FixtureRelationshipService.identityReviewReceiptFixture()
                : nil
            decisionSelections = [:]
            scopeReviewStatus = [.empty, .ready].contains(fixture.mode) ? .proposed : .confirmed
            relationshipScopeOptions = [syntheticOption]
            todayAttention = showsSyntheticTodayPreview
                ? Self.syntheticTodayAttention(for: fixture.mode)
                : .empty
            selectedScopeOptionID = preflightPreview || ![.empty, .ready].contains(fixture.mode)
                ? syntheticOption.id
                : nil
            reminderDuplicateActionDecision = Self.duplicateActionDecision(
                for: selectedScopeOptionID == nil ? nil : syntheticOption.consequencePreflight
            )
            if selectedScopeOptionID != nil {
                pursuitID = syntheticOption.pursuitID
                personID = syntheticOption.personID
                relationshipContextID = syntheticOption.relationshipContextID
            }
            recordRelationshipCompletionMetricIfNeeded(mode: fixture.mode)
        case .canonical(let readback):
            guard readback.provesCanonicalSafeReadback else {
                fail(RelationshipServiceError.canonicalReadbackIncomplete)
                return
            }
            isSyntheticFixture = false
            isSignedOut = false
            accountID = readback.accountID
            followUpReminderService.setLocalRecoveryAccount(readback.accountID)
            pursuitID = readback.pursuitID
            personID = readback.personID
            relationshipContextID = readback.relationshipContextID
            currentTaskID = readback.taskID
            presentation = readback.presentation
            mode = readback.displayMode
            pendingDecision = readback.pendingDecision
            canonicalReceipt = readback.receipt
            runAudit = readback.runAudit
            identityReviewReceipt = nil
            decisionSelections = [:]
            scopeReviewStatus = .confirmed
            relationshipScopeOptions = relationshipScopeOptions.filter {
                $0.pursuitID == readback.pursuitID &&
                    $0.personID == readback.personID &&
                    $0.relationshipContextID == readback.relationshipContextID
            }
            selectedScopeOptionID = relationshipScopeOptions.first?.id
            resetReminderDuplicateActionDecisionForSelectedScope()
            recordRelationshipCompletionMetricIfNeeded(mode: readback.displayMode)
            if [.noAction, .receipt, .failed].contains(readback.displayMode) {
                let purged = capsule.purgeTaskOnlyItems()
                if purged > 0 {
                    persistCapsule()
                    refreshProvisionalInsight()
                    localRecoveryNotice = "Deleted \(purged) task-only local Capsule item\(purged == 1 ? "" : "s") after the canonical task ended."
                }
            }
        }
    }

    private func fail(_ error: Error) {
        if case .staleAuthority = error as? RelationshipServiceError {
            mode = .stale
            pendingDecision = nil
            decisionSelections = [:]
            presentation = WorkspacePresentation(
                candidateName: presentation.candidateName,
                pursuitTitle: presentation.pursuitTitle,
                relationshipContext: presentation.relationshipContext,
                changedSummary: "The reviewed source changed after preview.",
                evidenceQuote: "The prior excerpt is no longer available as current decision authority.",
                evidenceSource: "Canonical source revalidation",
                dependency: "Review the changed evidence and submit a new immutable Capsule version before deciding.",
                proposal: "The prior proposal is stale and cannot be confirmed.",
                actionProjections: presentation.actionProjections.map {
                    ActionProjection(
                        id: $0.id,
                        objectName: $0.objectName,
                        consequence: "No decision write was sent",
                        authority: "Current source authority failed revalidation",
                        status: .stale,
                        nextOperation: "Review changed context and create a new Task version",
                        route: .reviewStaleSource
                    )
                }
            )
            errorMessage = error.localizedDescription
            return
        }
        mode = .failed
        errorMessage = error.localizedDescription
    }

    private func refreshProvisionalInsight() {
        let previousDigest = provisionalInsight?.sourceDigest
        let next = CandidateFollowUpCompiler.compile(items: capsule.items)
        provisionalInsight = next
        if previousDigest != next?.sourceDigest {
            quickPanelNavigationRequest = nil
            if previousDigest != nil {
                capsule.localPreparedDraft = nil
                persistCapsule()
            }
            editableFollowUpDraft = ""
            editableMailSubject = ""
            preparedDraftKind = nil
            mailDraftHandoffStatus = .notOpened
            localDraftStatus = .awaitingDecision
            resetReminderPreparationPreservingExternalRecovery()
            if !hasReminderExternalRecoveryState {
                resetReminderDuplicateActionDecisionForSelectedScope()
            }
            companionTrialMetrics.evidenceSupport = nil
            companionTrialMetrics.actionWasProposed = next?.suggestedAction != nil
        }
    }

    /// File decoding can outlive a view transition. Boundary-changing actions
    /// invalidate the transaction so a late local OCR/PDF result cannot
    /// repopulate a cleared, paused, stopped, or signed-out Capsule.
    private func invalidateActiveFileImport() {
        activeFileImportID = nil
        isImportingFiles = false
        fileIngestReceipt = nil
    }

    private func persistPreparedDraftRecoveryIfNeeded(now: Date = Date()) {
        let body = editableFollowUpDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty,
              let insight = provisionalInsight,
              let source = capsule.items.first(where: { $0.id == insight.sourceItemID }) else {
            capsule.localPreparedDraft = nil
            persistCapsule()
            return
        }
        capsule.localPreparedDraft = LocalPreparedDraftRecovery(
            sourceItemID: insight.sourceItemID,
            sourceDigest: insight.sourceDigest,
            derivationVersion: insight.derivationVersion,
            kind: preparedDraftKind,
            subject: editableMailSubject,
            body: editableFollowUpDraft,
            savedAt: now,
            expiresAt: source.capturedAt.addingTimeInterval(Self.localDraftRecoveryLifetime(source.retention))
        )
        persistCapsule()
    }

    private func recoverPreparedDraftIfAvailable(now: Date = Date()) {
        guard let recovered = capsule.localPreparedDraft else { return }
        guard recovered.expiresAt > now,
              recovered.sourceItemID == provisionalInsight?.sourceItemID,
              recovered.sourceDigest == provisionalInsight?.sourceDigest,
              recovered.derivationVersion == provisionalInsight?.derivationVersion,
              !recovered.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            capsule.localPreparedDraft = nil
            persistCapsule()
            return
        }
        editableMailSubject = recovered.subject
        editableFollowUpDraft = recovered.body
        preparedDraftKind = recovered.kind ?? PreparedDraftKind.inferred(from: recovered.subject)
        if let preparedDraftKind {
            preparedDraftBaseline = (preparedDraftKind, recovered.subject, recovered.body)
        }
        localDraftStatus = .prepared
        mailDraftHandoffStatus = .notOpened
        localRecoveryNotice = provisionalInsight?.language == .chinese
            ? "已恢复这段选择内容的一份未发送草稿。请逐字审核；系统没有发送任何内容。"
            : "Recovered one unsent draft for this selected conversation. Review every word; nothing was sent."
    }

    private static func localDraftRecoveryLifetime(_ retention: CapsuleRetention) -> TimeInterval {
        switch retention {
        case .taskOnly, .oneHour: 60 * 60
        case .twentyFourHours: 24 * 60 * 60
        }
    }

    private func resetReminderPreparation() {
        reminderTitle = ""
        reminderDueAt = Date()
        reminderBaseline = nil
        clearReminderDestinationPreview()
    }

    private func clearReminderDestinationPreview() {
        reminderDestination = nil
        reminderOperationState = .notPrepared
    }

    private var hasReminderExternalRecoveryState: Bool {
        if isReminderRecoveryUnreadable { return true }
        return switch reminderOperationState {
        case .executing, .saved, .unknown, .removing, .removalFailed, .removalUnknown:
            true
        case .notPrepared, .loadingDestination, .readyForApproval, .failed, .removed:
            false
        }
    }

    private func resetReminderPreparationPreservingExternalRecovery() {
        guard !hasReminderExternalRecoveryState else { return }
        resetReminderPreparation()
        if activeReminderRecovery?.stage == .proposalPrepared {
            clearReminderRecovery()
        }
    }

    @discardableResult
    private func persistReminderRecovery(
        proposal: FollowUpReminderProposal,
        stage: ReminderOperationRecoveryStage,
        receipt: FollowUpReminderReceipt? = nil,
        now: Date = Date()
    ) -> Bool {
        let recovery = ReminderOperationRecovery(
            proposal: proposal,
            stage: stage,
            receipt: receipt,
            now: now
        )
        do {
            try reminderRecoveryStore.save(recovery, accountID: accountID)
            activeReminderRecovery = recovery
            isReminderRecoveryUnreadable = false
            reminderRecoveryNotice = nil
            return true
        } catch {
            reminderRecoveryNotice = "The exact reminder recovery could not be protected on this Mac: \(error.localizedDescription)"
            return false
        }
    }

    private func clearReminderRecovery() {
        do {
            _ = try reminderRecoveryStore.clear(accountID: accountID)
            activeReminderRecovery = nil
            isReminderRecoveryUnreadable = false
            reminderRecoveryNotice = nil
        } catch {
            reminderRecoveryNotice = "The local reminder recovery could not be deleted: \(error.localizedDescription)"
        }
    }

    private func recoverReminderOperationIfNeeded(accountID: String, now: Date = Date()) {
        guard !recoveredReminderAccountIDs.contains(accountID) else { return }
        recoveredReminderAccountIDs.insert(accountID)
        do {
            guard let recovery = try reminderRecoveryStore.load(accountID: accountID, now: now) else {
                isReminderRecoveryUnreadable = false
                return
            }
            activeReminderRecovery = recovery
            isReminderRecoveryUnreadable = false
            reminderTitle = recovery.title
            reminderDueAt = recovery.dueAt
            reminderBaseline = (recovery.title, recovery.dueAt)
            reminderDestination = .init(
                identifier: recovery.destinationIdentifier,
                title: recovery.destinationTitle
            )
            switch recovery.stage {
            case .proposalPrepared:
                reminderDestination = nil
                reminderOperationState = .notPrepared
                reminderRecoveryNotice = "Recovered the exact reminder draft. Preview its Apple Reminders destination again before approval."
            case .executionPending, .outcomeUnknown:
                reminderOperationState = .unknown(
                    "capri found an unfinished reminder operation after relaunch. Check Apple Reminders before creating anything else."
                )
                reminderRecoveryNotice = "Recovered an unfinished reminder check. capri will reconcile the original operation instead of retrying it."
            case .verified:
                guard let receipt = recovery.receipt else { return }
                reminderOperationState = .saved(receipt)
                reminderRecoveryNotice = "Recovered a verified Apple Reminder and its removal path."
            case .removalPending, .removalUnknown:
                guard let receipt = recovery.receipt else { return }
                reminderOperationState = .removalUnknown(
                    receipt,
                    "capri found an unfinished reminder removal after relaunch. Check the original reminder before trying again."
                )
                reminderRecoveryNotice = "Recovered an unfinished reminder removal. capri will verify absence before claiming it was removed."
            }
        } catch {
            activeReminderRecovery = nil
            isReminderRecoveryUnreadable = true
            reminderOperationState = .unknown(
                "The protected reminder recovery cannot be opened. Inspect Apple Reminders before creating anything else."
            )
            reminderRecoveryNotice = "Encrypted reminder recovery could not be opened. New reminder writes remain blocked for this account."
        }
    }

    private func resetReminderDuplicateActionDecisionForSelectedScope() {
        reminderDuplicateActionDecision = Self.duplicateActionDecision(
            for: selectedRelationshipConsequencePreflight
        )
    }

    private static func duplicateActionDecision(
        for preflight: RelationshipConsequencePreflight?
    ) -> ReminderDuplicateActionDecision {
        guard let preflight else { return .unavailable }
        return preflight.openActions.isEmpty ? .notRequired : .unreviewed
    }

    private func persistCapsule() {
        do {
            try capsuleStore.save(capsule, accountID: accountID, now: Date())
        } catch {
            errorMessage = "Local recovery was not updated: \(error.localizedDescription)"
        }
    }

    private func recoverCapsuleIfNeeded(accountID: String) {
        guard !recoveredAccountIDs.contains(accountID), capsule.items.isEmpty else { return }
        recoveredAccountIDs.insert(accountID)
        do {
            let recovery = try capsuleStore.load(accountID: accountID, now: Date())
            capsule = recovery.draft
            refreshProvisionalInsight()
            if !capsule.items.isEmpty {
                mode = .ready
                localRecoveryNotice = "Recovered \(capsule.items.count) encrypted local Capsule item\(capsule.items.count == 1 ? "" : "s") for review. Nothing was submitted automatically."
            } else if recovery.expiredItemCount > 0 {
                localRecoveryNotice = "Expired and deleted \(recovery.expiredItemCount) local Capsule item\(recovery.expiredItemCount == 1 ? "" : "s") before recovery."
            }
            recoverPreparedDraftIfAvailable()
        } catch {
            errorMessage = "Local Capsule recovery failed closed: \(error.localizedDescription)"
        }
    }

    private static let syntheticScopeOption = RelationshipScopeOption(
        id: "synthetic-scope",
        pursuitID: "synthetic-pursuit",
        pursuitRevision: 1,
        pursuitTitle: "VP Engineering · APAC platform expansion",
        personID: "synthetic-person",
        personDisplayLabel: "Alexandra 陈嘉宁-Sørensen — International Leadership & Platform Transformation",
        relationshipContextID: "synthetic-relationship-context",
        relationshipContextLabel: "Candidate in this Pursuit · identity deliberately reviewable",
        consequencePreflight: RelationshipConsequencePreflight(
            milestone: "Decision dependency review",
            targetDate: "2026-09-03",
            evidenceAvailability: "available",
            openActions: [],
            openGaps: []
        )
    )

    private static var syntheticScopeOptionForCurrentProcess: RelationshipScopeOption {
        guard ProcessInfo.processInfo.arguments.contains("--consequence-preflight-preview") else {
            return syntheticScopeOption
        }
        return RelationshipScopeOption(
            id: syntheticScopeOption.id,
            pursuitID: syntheticScopeOption.pursuitID,
            pursuitRevision: syntheticScopeOption.pursuitRevision,
            pursuitTitle: syntheticScopeOption.pursuitTitle,
            personID: syntheticScopeOption.personID,
            personDisplayLabel: syntheticScopeOption.personDisplayLabel,
            relationshipContextID: syntheticScopeOption.relationshipContextID,
            relationshipContextLabel: syntheticScopeOption.relationshipContextLabel,
            consequencePreflight: RelationshipConsequencePreflight(
                milestone: "Decision dependency review",
                targetDate: "2026-09-03",
                evidenceAvailability: "available",
                openActions: [
                    .init(
                        id: "synthetic-existing-action",
                        title: "Clarify the exact remote policy with the client",
                        owner: "Recruiter",
                        dueAt: Calendar.current.date(byAdding: .day, value: 1, to: Date()),
                        status: "in_progress"
                    )
                ],
                openGaps: [
                    .init(
                        id: "synthetic-open-gap",
                        title: "Remote-policy dependency",
                        closeCondition: "Confirm the exact policy wording with the client",
                        evidenceAvailability: "available"
                    )
                ]
            )
        )
    }

    private static let syntheticTodayAttention = TodayAttentionProjection(
        items: [
            TodayAttentionItem(
                id: "synthetic-proposal",
                pursuitID: "synthetic-pursuit-alex",
                pursuitTitle: "Platform leadership search",
                personLabel: "Alex Chen",
                kind: .proposalReview,
                whyNow: "Remote-policy expectation needs review",
                unresolved: "Two proposed changes remain unconfirmed; exact evidence is available.",
                owner: "You",
                dueAt: nil,
                dueFallback: "Pursuit target Sep 3",
                nextMove: "Review each proposed change against its exact evidence.",
                evidenceAvailability: "available",
                scopeOptionID: nil,
                proposalID: "20000000-0000-4000-8000-000000000003",
                evidence: [
                    TodayAttentionEvidence(
                        id: "synthetic-remote-policy-fragment",
                        text: "I need clarity on the remote policy before Friday because the other process has accelerated.",
                        source: "Synthetic selected conversation",
                        observedAt: "2026-09-01T10:00:00Z",
                        attributedActor: "candidate"
                    )
                ]
            ),
            TodayAttentionItem(
                id: "synthetic-action",
                pursuitID: "synthetic-pursuit-mia",
                pursuitTitle: "Revenue leadership search",
                personLabel: "Mia Rivera",
                kind: .ownedAction,
                whyNow: "Send the reviewed role brief",
                unresolved: "The recruiter-owned action outcome has not been recorded.",
                owner: "Recruiter Owner",
                dueAt: Date(timeIntervalSince1970: 1_788_246_000),
                dueFallback: "Due date unavailable",
                nextMove: "Send the reviewed role brief",
                evidenceAvailability: "available",
                scopeOptionID: nil
            ),
            TodayAttentionItem(
                id: "synthetic-gap",
                pursuitID: "synthetic-pursuit-daniel",
                pursuitTitle: "Engineering director search",
                personLabel: "Daniel Kim",
                kind: .openGap,
                whyNow: "Client feedback conflicts with candidate expectation",
                unresolved: "Confirm which requirement is current before changing the relationship state.",
                owner: "Recruiter to assign",
                dueAt: nil,
                dueFallback: "Pursuit target Sep 5",
                nextMove: "Ask the client which requirement is current.",
                evidenceAvailability: "partial",
                scopeOptionID: nil
            ),
        ],
        noActionCount: 2,
        totalPursuitCount: 5
    )

    /// Synthetic Today mirrors the current fixture state instead of leaving a
    /// completed Proposal in the pending review queue. The resolved Pursuit
    /// remains counted, but now belongs to the no-action cohort; its reversible
    /// receipt is exposed separately through Action Center.
    private static func syntheticTodayAttention(for mode: WorkspaceMode) -> TodayAttentionProjection {
        guard mode == .receipt else { return syntheticTodayAttention }

        let resolvedProposalID = FixtureRelationshipService.receiptFixture().proposalID
        let remainingItems = syntheticTodayAttention.items.filter { item in
            item.kind != .proposalReview || item.proposalID != resolvedProposalID
        }
        return TodayAttentionProjection(
            items: remainingItems,
            noActionCount: syntheticTodayAttention.noActionCount + (syntheticTodayAttention.items.count - remainingItems.count),
            totalPursuitCount: syntheticTodayAttention.totalPursuitCount
        )
    }

    private static let unboundScopePresentation = WorkspacePresentation(
        candidateName: "Choose a Person or keep identity unresolved",
        pursuitTitle: "Relationship scope required",
        relationshipContext: "No Pursuit, Person, or relationship context is selected.",
        changedSummary: "Review the available source owner before adding task authority.",
        evidenceQuote: "No source has been submitted from this Mac.",
        evidenceSource: "Unbound local workspace",
        dependency: "A recruiter must explicitly select one exact scope or preserve an unresolved outcome.",
        proposal: "No proposal exists until a reviewed Capsule is submitted.",
        actionProjections: []
    )
}

struct QuickPanelNavigationRequest: Equatable, Sendable {
    enum Destination: Equatable, Sendable {
        case insight
        case reminder
    }

    let id = UUID()
    let destination: Destination
}

enum NavigationDestination: String, CaseIterable, Identifiable {
    case today = "Today"
    case workspace = "Relationship Workspace"
    case actionCenter = "Action Center"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .today: "sun.max"
        case .workspace: "rectangle.split.3x1"
        case .actionCenter: "checklist"
        }
    }
}
