import Foundation

enum StandaloneOnboardingRoute: String, Codable, CaseIterable {
    case welcome
    case identity
    case pursuit
    case productDemo
    case sourceChoice
    case calendarExplanation
    case meetingSelection
    case capture
    case processing
    case proposalReview
    case verifiedProgress
    case actionButtonOffer
    case actionButtonPractice
    case today
}

enum StandaloneSourceKind: String, Codable, CaseIterable, Identifiable {
    case calendar
    case voice
    case text

    var id: String { rawValue }
}

enum StandaloneCalendarPermission: String, Codable, Equatable {
    case notDetermined
    case fullAccess
    case writeOnly
    case denied
    case restricted
    case connectedEmpty
    case connectedWithMeetings
}

enum StandaloneCaptureState: String, Codable, Equatable {
    case draftCreated
    case requestingPermission
    case recording
    case transcribing
    case readyToProcess
    case processing
    case proposalReady
    case failedRecoverable
    case cancelled
}

enum StandaloneActivationStatus: String, Codable, Equatable {
    case notStarted
    case proposalReviewed
    case verifiedProgress
}

enum StandaloneActionPracticeState: String, Codable, Equatable {
    case notOffered
    case offered
    case practiceWindowOpened
    case intentReceivedInPractice
    case simulated
    case skipped
}

struct StandaloneAccount: Codable, Equatable, Identifiable {
    let id: UUID
    var displayName: String
    let isDemo: Bool
}

struct StandalonePursuit: Codable, Equatable, Identifiable {
    let id: UUID
    var template: String
    var outcome: String
    var targetDate: Date?
    let createdAt: Date
}

struct StandaloneMeeting: Codable, Equatable, Identifiable {
    let id: String
    let eventIdentifier: String?
    let title: String
    let startsAt: Date
    let endsAt: Date
    let calendarTitle: String
    let isDemo: Bool
}

struct StandaloneCaptureDraft: Codable, Equatable, Identifiable {
    let id: UUID
    let idempotencyKey: UUID
    let pursuitID: UUID
    var sourceKind: StandaloneSourceKind
    var meeting: StandaloneMeeting?
    var text: String
    var audioFileName: String?
    var sharedEnvelopeID: UUID? = nil
    var sharedPayloadKind: SharedCapturePayloadKind? = nil
    var sharedPayloadFileName: String? = nil
    var sharedSourceText: String? = nil
    var sharedRecruiterNote: String? = nil
    var sharedSourceURL: URL? = nil
    var state: StandaloneCaptureState
    var processingGeneration: Int
    let createdAt: Date
}

struct StandaloneProposalFact: Codable, Equatable, Identifiable {
    let id: UUID
    var field: String
    var proposedValue: String
    let evidenceExcerpt: String
    let confidenceBand: String
}

struct StandaloneProposalInference: Codable, Equatable, Identifiable {
    let id: UUID
    var statement: String
    let basis: String
}

struct StandaloneProposalUnknown: Codable, Equatable, Identifiable {
    let id: UUID
    var question: String
    let whyUnresolved: String
}

struct StandaloneProposalAction: Codable, Equatable, Identifiable {
    let id: UUID
    var title: String
    let rationale: String
}

struct StandaloneProposal: Codable, Equatable, Identifiable {
    let id: UUID
    let sourceSummary: String
    let matchedPursuitID: UUID
    var facts: [StandaloneProposalFact]
    var inferences: [StandaloneProposalInference]
    var unknowns: [StandaloneProposalUnknown]
    var nextActions: [StandaloneProposalAction]
    let engineLabel: String
    let modelDisclaimer: String
    let createdAt: Date

    func enforcingEvidenceGrounding(in sourceText: String) -> StandaloneProposal {
        var grounded = self
        let normalizedSource = Self.normalizedEvidence(sourceText)
        let rejectedFacts = facts.filter {
            let excerpt = Self.normalizedEvidence($0.evidenceExcerpt)
            return excerpt.isEmpty || !normalizedSource.contains(excerpt)
        }
        grounded.facts = facts.filter { !rejectedFacts.contains($0) }
        grounded.unknowns.append(contentsOf: rejectedFacts.map {
            StandaloneProposalUnknown(
                id: UUID(),
                question: "Can this proposed \($0.field.lowercased()) be grounded in the saved Signal?",
                whyUnresolved: "The proposed evidence excerpt could not be located in the saved source, so it cannot be confirmed as fact."
            )
        })
        return grounded
    }

    private static func normalizedEvidence(_ value: String) -> String {
        value
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
            .lowercased()
    }
}

struct StandaloneVerifiedProgress: Codable, Equatable, Identifiable {
    let id: UUID
    let pursuitID: UUID
    let proposalID: UUID
    let confirmedFacts: [StandaloneProposalFact]
    let acceptedActions: [StandaloneProposalAction]
    let unresolved: [StandaloneProposalUnknown]
    let sourceSummary: String
    let confirmedAt: Date
}

struct StandaloneOnboardingState: Codable, Equatable {
    static let flowVersion = 2

    var sessionID: UUID
    var version: Int
    var route: StandaloneOnboardingRoute
    var account: StandaloneAccount?
    var pursuit: StandalonePursuit?
    var selectedSource: StandaloneSourceKind?
    var lastObservedCalendarPermission: StandaloneCalendarPermission
    var selectedCalendarIDs: [String]
    var selectedMeeting: StandaloneMeeting?
    var captureDraft: StandaloneCaptureDraft?
    var proposal: StandaloneProposal?
    var selectedFactIDs: Set<UUID>
    var acceptedActionIDs: Set<UUID>
    var progress: StandaloneVerifiedProgress?
    var activationStatus: StandaloneActivationStatus
    var actionPracticeState: StandaloneActionPracticeState
    var introCompleted: Bool
    var lastRecoverableError: String?
    var importedSharedEnvelopeIDs: Set<UUID> = []
    var unassignedSystemCaptureID: UUID? = nil
    var calendarWindow: StandaloneCalendarWindow = .upcoming

    static func fresh() -> StandaloneOnboardingState {
        StandaloneOnboardingState(
            sessionID: UUID(),
            version: flowVersion,
            route: .welcome,
            account: nil,
            pursuit: nil,
            selectedSource: nil,
            lastObservedCalendarPermission: .notDetermined,
            selectedCalendarIDs: [],
            selectedMeeting: nil,
            captureDraft: nil,
            proposal: nil,
            selectedFactIDs: [],
            acceptedActionIDs: [],
            progress: nil,
            activationStatus: .notStarted,
            actionPracticeState: .notOffered,
            introCompleted: false,
            lastRecoverableError: nil
        )
    }

    mutating func startFirstProgressExample(now: Date = Date()) {
        let account = StandaloneAccount(
            id: UUID(),
            displayName: "Demo Recruiter",
            isDemo: true
        )
        let pursuit = StandalonePursuit(
            id: UUID(),
            template: "Hire someone",
            outcome: "Hire a VP of Engineering",
            targetDate: nil,
            createdAt: now
        )
        var draft = StandaloneCaptureDraft(
            id: UUID(),
            idempotencyKey: UUID(),
            pursuitID: pursuit.id,
            sourceKind: .text,
            meeting: nil,
            text: StandaloneDemoProposalCatalog.firstProgressSignal,
            audioFileName: nil,
            state: .proposalReady,
            processingGeneration: 1,
            createdAt: now
        )
        let proposal = StandaloneDemoProposalCatalog.proposal(
            for: draft,
            pursuit: pursuit,
            engineLabel: "Synthetic example · fixture v1"
        )
        draft.state = .proposalReady

        self.account = account
        self.pursuit = pursuit
        selectedSource = .text
        selectedMeeting = nil
        captureDraft = draft
        self.proposal = proposal
        selectedFactIDs = []
        acceptedActionIDs = []
        progress = nil
        activationStatus = .notStarted
        actionPracticeState = .notOffered
        introCompleted = false
        unassignedSystemCaptureID = nil
        route = .proposalReview
        lastRecoverableError = nil
    }

    mutating func startOwnSignalSetup() {
        if account?.isDemo == true {
            account = nil
            pursuit = nil
            selectedSource = nil
            selectedMeeting = nil
            captureDraft = nil
            proposal = nil
            selectedFactIDs = []
            acceptedActionIDs = []
            progress = nil
            activationStatus = .notStarted
            actionPracticeState = .notOffered
            introCompleted = false
            unassignedSystemCaptureID = nil
            lastRecoverableError = nil
            route = .identity
            return
        }

        route = pursuit == nil ? .identity : .sourceChoice
        lastRecoverableError = nil
    }

    var isActivated: Bool {
        activationStatus == .verifiedProgress && progress != nil
    }

    @discardableResult
    mutating func recoverInterruptedWorkAfterRelaunch() -> Bool {
        guard let captureState = captureDraft?.state else {
            if route == .processing {
                route = pursuit == nil ? .pursuit : .sourceChoice
                lastRecoverableError = "Interrupted processing had no recoverable Draft. Choose a source to continue."
                return true
            }
            return false
        }
        guard [.requestingPermission, .recording, .transcribing, .processing]
            .contains(captureState) else { return false }

        captureDraft?.state = .failedRecoverable
        route = .capture
        lastRecoverableError = "The interrupted step stopped safely. Your local Draft is preserved; edit it or retry when ready."
        return true
    }

    mutating func showIdentity() {
        guard route == .welcome else { return }
        route = .identity
    }

    mutating func begin(displayName: String, demoAccount: Bool) {
        guard route == .welcome || route == .identity else { return }
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        begin(
            account: StandaloneAccount(
                id: UUID(),
                displayName: name.isEmpty ? "You" : name,
                isDemo: demoAccount
            )
        )
    }

    mutating func begin(account proposedAccount: StandaloneAccount) {
        guard route == .welcome || route == .identity else { return }
        if account == nil {
            account = proposedAccount
        } else if !proposedAccount.displayName.isEmpty {
            account?.displayName = proposedAccount.displayName
        }
        route = .pursuit
        lastRecoverableError = nil
    }

    @discardableResult
    mutating func createPursuit(
        template: String,
        outcome: String,
        targetDate: Date?,
        now: Date = Date()
    ) -> Bool {
        let trimmed = outcome.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            lastRecoverableError = "Describe the outcome before creating this Pursuit."
            return false
        }
        if pursuit == nil {
            pursuit = StandalonePursuit(
                id: UUID(),
                template: template,
                outcome: trimmed,
                targetDate: targetDate,
                createdAt: now
            )
        } else {
            pursuit?.template = template
            pursuit?.outcome = trimmed
            pursuit?.targetDate = targetDate
        }
        route = .sourceChoice
        lastRecoverableError = nil
        return true
    }

    mutating func finishProductDemo() {
        guard pursuit != nil else { return }
        route = .sourceChoice
    }

    mutating func returnToSourceChoice() {
        guard pursuit != nil else { return }
        route = .sourceChoice
        lastRecoverableError = nil
    }

    mutating func showMeetingSelection() {
        guard selectedSource == .calendar else { return }
        route = .meetingSelection
    }

    @discardableResult
    mutating func chooseSource(
        _ source: StandaloneSourceKind,
        now: Date = Date()
    ) -> Bool {
        guard let pursuit else { return false }
        selectedSource = source
        selectedMeeting = nil
        if source == .calendar {
            route = .calendarExplanation
        } else {
            captureDraft = StandaloneCaptureDraft(
                id: captureDraft?.id ?? UUID(),
                idempotencyKey: captureDraft?.idempotencyKey ?? UUID(),
                pursuitID: pursuit.id,
                sourceKind: source,
                meeting: nil,
                text: captureDraft?.text ?? "",
                audioFileName: captureDraft?.audioFileName,
                state: .draftCreated,
                processingGeneration: captureDraft?.processingGeneration ?? 0,
                createdAt: captureDraft?.createdAt ?? now
            )
            route = .capture
        }
        lastRecoverableError = nil
        return true
    }

    mutating func observeCalendar(
        _ permission: StandaloneCalendarPermission,
        selectedCalendarIDs: [String]? = nil
    ) {
        lastObservedCalendarPermission = permission
        if let selectedCalendarIDs {
            self.selectedCalendarIDs = selectedCalendarIDs
        }
        if permission == .denied || permission == .restricted || permission == .writeOnly {
            selectedMeeting = nil
        }
    }

    mutating func selectCalendarWindow(_ window: StandaloneCalendarWindow) {
        calendarWindow = window
    }

    @discardableResult
    mutating func chooseMeeting(
        _ meeting: StandaloneMeeting,
        now: Date = Date()
    ) -> Bool {
        guard let pursuit else { return false }
        selectedSource = .calendar
        selectedMeeting = meeting
        captureDraft = StandaloneCaptureDraft(
            id: captureDraft?.id ?? UUID(),
            idempotencyKey: captureDraft?.idempotencyKey ?? UUID(),
            pursuitID: pursuit.id,
            sourceKind: .calendar,
            meeting: meeting,
            text: captureDraft?.text ?? "",
            audioFileName: captureDraft?.audioFileName,
            state: .draftCreated,
            processingGeneration: captureDraft?.processingGeneration ?? 0,
            createdAt: captureDraft?.createdAt ?? now
        )
        route = .capture
        lastRecoverableError = nil
        return true
    }

    mutating func updateDraftText(_ text: String) {
        guard captureDraft != nil else { return }
        captureDraft?.text = text
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            captureDraft?.state = .draftCreated
        } else {
            captureDraft?.state = .readyToProcess
        }
    }

    @discardableResult
    mutating func importSharedCapture(
        _ envelope: SharedCaptureEnvelope,
        now: Date = Date()
    ) -> Bool {
        guard SharedCaptureEnvelope.supportedSchemaVersions.contains(envelope.schemaVersion),
              !importedSharedEnvelopeIDs.contains(envelope.id),
              let pursuit else { return false }
        let initialText: String
        switch envelope.kind {
        case .image:
            // Image-derived text from legacy Share Extension OCR is never used.
            // The original remains available for the shared preprocessing path.
            initialText = envelope.recruiterNote ?? ""
        case .text:
            initialText = envelope.sourceText ?? envelope.recruiterNote ?? ""
        case .url:
            initialText = envelope.recruiterNote ?? envelope.url?.absoluteString ?? ""
        }
        selectedSource = .text
        selectedMeeting = nil
        proposal = nil
        selectedFactIDs = []
        acceptedActionIDs = []
        captureDraft = StandaloneCaptureDraft(
            id: UUID(),
            idempotencyKey: envelope.id,
            pursuitID: pursuit.id,
            sourceKind: .text,
            meeting: nil,
            text: initialText,
            audioFileName: nil,
            sharedEnvelopeID: envelope.id,
            sharedPayloadKind: envelope.kind,
            sharedPayloadFileName: envelope.payloadFileName,
            sharedSourceText: envelope.kind == .image ? nil : envelope.sourceText,
            sharedRecruiterNote: envelope.recruiterNote,
            sharedSourceURL: envelope.url,
            state: initialText.isEmpty ? .draftCreated : .readyToProcess,
            processingGeneration: 0,
            createdAt: now
        )
        importedSharedEnvelopeIDs.insert(envelope.id)
        route = .capture
        lastRecoverableError = envelope.kind == .image && initialText.isEmpty
            ? "Shared image saved locally. Add a short Signal before generating a Proposal."
            : "Shared \(envelope.kind.rawValue) saved locally. Review the Signal before processing."
        return true
    }

    mutating func updateCaptureState(
        _ captureState: StandaloneCaptureState,
        audioFileName: String? = nil,
        error: String? = nil
    ) {
        guard captureDraft != nil else { return }
        captureDraft?.state = captureState
        if let audioFileName { captureDraft?.audioFileName = audioFileName }
        lastRecoverableError = error
    }

    @discardableResult
    mutating func beginProcessing() -> Int? {
        guard var draft = captureDraft,
              !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              pursuit?.id == draft.pursuitID else {
            lastRecoverableError = "Add a Signal before asking capri to organize it."
            return nil
        }
        draft.processingGeneration += 1
        draft.state = .processing
        captureDraft = draft
        route = .processing
        lastRecoverableError = nil
        return draft.processingGeneration
    }

    @discardableResult
    mutating func receiveProposal(
        _ proposal: StandaloneProposal,
        generation: Int
    ) -> Bool {
        guard let draft = captureDraft,
              draft.processingGeneration == generation,
              proposal.matchedPursuitID == draft.pursuitID,
              pursuit?.id == draft.pursuitID else {
            return false
        }
        self.proposal = proposal
        selectedFactIDs = []
        acceptedActionIDs = []
        captureDraft?.state = .proposalReady
        route = .proposalReview
        lastRecoverableError = nil
        return true
    }

    mutating func failProcessing(_ message: String, generation: Int) {
        guard captureDraft?.processingGeneration == generation else { return }
        captureDraft?.state = .failedRecoverable
        route = .capture
        lastRecoverableError = message
    }

    mutating func selectFact(_ id: UUID, selected: Bool) {
        guard proposal?.facts.contains(where: { $0.id == id }) == true else { return }
        if selected { selectedFactIDs.insert(id) } else { selectedFactIDs.remove(id) }
    }

    mutating func acceptAction(_ id: UUID, accepted: Bool) {
        guard proposal?.nextActions.contains(where: { $0.id == id }) == true else { return }
        if accepted { acceptedActionIDs.insert(id) } else { acceptedActionIDs.remove(id) }
    }

    mutating func editFact(_ id: UUID, value: String) {
        guard let index = proposal?.facts.firstIndex(where: { $0.id == id }) else { return }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        proposal?.facts[index].proposedValue = trimmed
        selectedFactIDs.insert(id)
    }

    @discardableResult
    mutating func keepUnresolvedOnly() -> Bool {
        guard proposal != nil else { return false }
        selectedFactIDs.removeAll()
        acceptedActionIDs.removeAll()
        activationStatus = .proposalReviewed
        lastRecoverableError = "Unknowns were preserved. Confirm a supported change or accept a next action to create verified progress."
        return true
    }

    @discardableResult
    mutating func confirm(now: Date = Date()) -> Bool {
        guard let proposal, let pursuit else { return false }
        if let progress, progress.proposalID == proposal.id {
            route = .verifiedProgress
            return true
        }
        let facts = proposal.facts.filter { selectedFactIDs.contains($0.id) }
        let actions = proposal.nextActions.filter { acceptedActionIDs.contains($0.id) }
        guard !facts.isEmpty || !actions.isEmpty else {
            activationStatus = .proposalReviewed
            lastRecoverableError = "Choose a sourced change or explicitly accept a next action before confirming progress."
            return false
        }
        progress = StandaloneVerifiedProgress(
            id: UUID(),
            pursuitID: pursuit.id,
            proposalID: proposal.id,
            confirmedFacts: facts,
            acceptedActions: actions,
            unresolved: proposal.unknowns,
            sourceSummary: proposal.sourceSummary,
            confirmedAt: now
        )
        activationStatus = .verifiedProgress
        route = .verifiedProgress
        lastRecoverableError = nil
        return true
    }

    mutating func discardProposal() {
        proposal = nil
        selectedFactIDs = []
        acceptedActionIDs = []
        captureDraft?.state = .readyToProcess
        activationStatus = .notStarted
        route = .capture
        lastRecoverableError = "The Proposal was discarded. Your local Signal draft is still available."
    }

    @discardableResult
    mutating func discardImportedCapture(_ envelopeID: UUID) -> Bool {
        guard captureDraft?.sharedEnvelopeID == envelopeID else { return false }
        importedSharedEnvelopeIDs.remove(envelopeID)
        selectedSource = nil
        selectedMeeting = nil
        captureDraft = nil
        proposal = nil
        selectedFactIDs = []
        acceptedActionIDs = []
        progress = nil
        activationStatus = .notStarted
        actionPracticeState = .notOffered
        introCompleted = false
        route = pursuit == nil ? .pursuit : .sourceChoice
        lastRecoverableError = nil
        return true
    }

    mutating func showLatestProposal() {
        guard proposal != nil else { return }
        route = .proposalReview
    }

    mutating func requestSystemCapture(_ source: StandaloneSourceKind) {
        guard pursuit != nil else {
            unassignedSystemCaptureID = unassignedSystemCaptureID ?? UUID()
            lastRecoverableError = "A system capture is waiting in the local Unassigned Inbox. Create a Pursuit before assigning evidence."
            if account != nil { route = .pursuit }
            return
        }
        unassignedSystemCaptureID = nil
        _ = chooseSource(source)
    }

    mutating func openPursuit(id: String) {
        guard pursuit?.id.uuidString == id else { return }
        route = isActivated ? .today : .pursuit
    }

    mutating func markWrongPursuit() {
        proposal = nil
        selectedFactIDs = []
        acceptedActionIDs = []
        let hasSignalText = captureDraft?.text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty == false
        captureDraft?.state = hasSignalText
            ? .readyToProcess
            : .draftCreated
        route = .pursuit
        lastRecoverableError = "The Proposal match was withdrawn. Your Source and Signal remain saved while you edit the Pursuit."
    }

    mutating func showActionButtonOffer() {
        guard isActivated else { return }
        actionPracticeState = .offered
        route = .actionButtonOffer
    }

    mutating func openPractice() {
        guard isActivated else { return }
        actionPracticeState = .practiceWindowOpened
        route = .actionButtonPractice
    }

    mutating func completePractice(simulated: Bool) {
        guard actionPracticeState == .practiceWindowOpened else { return }
        actionPracticeState = simulated ? .simulated : .intentReceivedInPractice
    }

    mutating func skipPractice() {
        actionPracticeState = .skipped
        enterToday()
    }

    mutating func enterToday() {
        guard isActivated else { return }
        introCompleted = true
        route = .today
    }

    mutating func replayOnboarding() {
        route = .welcome
        introCompleted = false
    }
}

enum StandaloneDemoProposalCatalog {
    static let firstProgressSignal = "Mina prefers remote. Visa status is still unclear."
    static let showcaseSignal = "Mina prefers remote, could start in three weeks, and wants to understand the team size. Visa status is still unclear."

    static func isShowcaseFixture(_ text: String) -> Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines) == showcaseSignal
    }

    static func proposal(
        for draft: StandaloneCaptureDraft,
        pursuit: StandalonePursuit,
        engineLabel: String = "Demo Engine · fixture v1"
    ) -> StandaloneProposal {
        let source = StandaloneProposalSource.summary(for: draft)
        let text = draft.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let lowered = text.lowercased()
        var facts: [StandaloneProposalFact] = []
        if lowered.contains("remote") {
            facts.append(.init(
                id: UUID(), field: "Work preference", proposedValue: "Remote preferred",
                evidenceExcerpt: excerpt(containing: "remote", in: text), confidenceBand: "Directly stated"
            ))
        }
        if lowered.contains("three weeks") || lowered.contains("3 weeks") {
            facts.append(.init(
                id: UUID(), field: "Availability", proposedValue: "Could start in three weeks",
                evidenceExcerpt: excerpt(containing: "three", in: text), confidenceBand: "Directly stated"
            ))
        }
        if facts.isEmpty {
            facts.append(.init(
                id: UUID(), field: "Conversation update", proposedValue: text,
                evidenceExcerpt: text,
                confidenceBand: draft.sharedSourceText == nil
                    ? "User-authored Signal"
                    : "Shared source text"
            ))
        }
        let hasVisa = lowered.contains("visa")
        let asksTeamSize = lowered.contains("team size")
        return StandaloneProposal(
            id: UUID(),
            sourceSummary: source,
            matchedPursuitID: pursuit.id,
            facts: facts,
            inferences: asksTeamSize ? [
                .init(
                    id: UUID(),
                    statement: "Team scope may shape interest in the role.",
                    basis: "Inferred from the question about team size; not stated as a decision driver."
                ),
            ] : [],
            unknowns: hasVisa ? [
                .init(
                    id: UUID(),
                    question: "What is the current visa or work-authorization status?",
                    whyUnresolved: "The Signal explicitly says this remains unclear."
                ),
            ] : [
                .init(
                    id: UUID(),
                    question: "What still needs evidence before the next decision?",
                    whyUnresolved: "The current Signal does not establish every dependency."
                ),
            ],
            nextActions: [
                .init(
                    id: UUID(),
                    title: asksTeamSize ? "Share the team size before the next conversation" : "Clarify the open dependency",
                    rationale: "This is an internal proposed next step. Nothing will be sent until you separately choose an effect."
                ),
            ],
            engineLabel: engineLabel,
            modelDisclaimer: "This engine proposes structure only. You decide what becomes current Pursuit state.",
            createdAt: Date()
        )
    }

    private static func excerpt(containing token: String, in text: String) -> String {
        guard let range = text.range(of: token, options: .caseInsensitive) else { return text }
        let sentenceRange = text.rangeOfComposedCharacterSequences(
            for: text.startIndex ..< text.endIndex
        )
        let full = String(text[sentenceRange])
        if full.count <= 180 { return full }
        let offset = text.distance(from: text.startIndex, to: range.lowerBound)
        let start = max(0, offset - 70)
        return String(full.dropFirst(start).prefix(180))
    }
}

enum StandaloneProposalSource {
    static func summary(for draft: StandaloneCaptureDraft) -> String {
        draft.meeting.map {
            "\($0.title) · \(StandaloneOnboardingDate.short.string(from: $0.startsAt))"
        } ?? draft.sharedPayloadKind.map {
            "Shared \($0.rawValue.capitalized) · Share Sheet"
        } ?? (draft.sourceKind == .voice ? "Voice Signal" : "Typed Signal")
    }
}

enum StandaloneOnboardingDate {
    static let short: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}
