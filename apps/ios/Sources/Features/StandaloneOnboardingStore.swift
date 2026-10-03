import Foundation

protocol StandaloneAccountClient {
    func localAccount(displayName: String, isDemo: Bool) -> StandaloneAccount
}

struct LocalStandaloneAccountClient: StandaloneAccountClient {
    func localAccount(displayName: String, isDemo: Bool) -> StandaloneAccount {
        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return StandaloneAccount(
            id: UUID(),
            displayName: trimmed.isEmpty ? "You" : trimmed,
            isDemo: isDemo
        )
    }
}

protocol StandaloneProposalGenerating {
    func generate(
        draft: StandaloneCaptureDraft,
        pursuit: StandalonePursuit
    ) async throws -> StandaloneProposal
}

struct DeterministicStandaloneProposalEngine: StandaloneProposalGenerating {
    let label: String

    init(label: String = "Demo Engine · fixture v1") {
        self.label = label
    }

    func generate(
        draft: StandaloneCaptureDraft,
        pursuit: StandalonePursuit
    ) async throws -> StandaloneProposal {
        StandaloneDemoProposalCatalog.proposal(
            for: draft,
            pursuit: pursuit,
            engineLabel: label
        )
    }
}

enum StandaloneShortcutCaptureBridge {
    static func stage(
        _ seed: PendingCaptureSeed,
        in inbox: SharedCaptureInbox
    ) throws -> SharedCaptureEnvelope {
        if let existing = try inbox.envelope(id: seed.id) {
            return existing
        }
        return try inbox.appendImage(
            id: seed.id,
            data: seed.imageData,
            fileExtension: URL(fileURLWithPath: seed.fileName).pathExtension,
            mediaType: seed.mediaType,
            sourceApplication: seed.origin.label,
            now: seed.createdAt
        )
    }
}

@MainActor
final class StandaloneOnboardingStore: ObservableObject {
    @Published private(set) var state: StandaloneOnboardingState
    @Published private(set) var persistenceNotice: String?

    private let persistence: StandaloneOnboardingPersisting
    private let accountClient: StandaloneAccountClient

    init(
        persistence: StandaloneOnboardingPersisting = FileStandaloneOnboardingStore(),
        accountClient: StandaloneAccountClient = LocalStandaloneAccountClient(),
        reset: Bool = false
    ) {
        self.persistence = persistence
        self.accountClient = accountClient
        if reset {
            do {
                try persistence.reset()
                state = .fresh()
            } catch {
                state = .fresh()
                persistenceNotice = "The requested clean launch could not remove the previous local session. Prior evidence is hidden; retry Reset before using this device: \(error.localizedDescription)"
            }
            return
        }
        do {
            if var restored = try persistence.load(),
               restored.version == StandaloneOnboardingState.flowVersion {
                let recoveredInterruptedWork = restored.recoverInterruptedWorkAfterRelaunch()
                state = restored
                if recoveredInterruptedWork {
                    do {
                        try persistence.save(restored)
                    } catch {
                        persistenceNotice = "The interrupted Draft was recovered in memory but could not be saved again: \(error.localizedDescription)"
                    }
                }
            } else {
                state = .fresh()
            }
        } catch {
            state = .fresh()
            persistenceNotice = "The previous local onboarding session could not be verified. A new local session was started."
        }
    }

    func begin(displayName: String, demoAccount: Bool) {
        let account = accountClient.localAccount(
            displayName: displayName,
            isDemo: demoAccount
        )
        mutate { $0.begin(account: account) }
    }

    func showIdentity() {
        mutate { $0.showIdentity() }
    }

    func startFirstProgressExample() {
        mutate { $0.startFirstProgressExample() }
    }

    func startOwnSignalSetup() {
        mutate { $0.startOwnSignalSetup() }
    }

    func createPursuit(template: String, outcome: String, targetDate: Date?) {
        mutate { _ = $0.createPursuit(template: template, outcome: outcome, targetDate: targetDate) }
    }

    func finishProductDemo() {
        mutate { $0.finishProductDemo() }
    }

    func returnToSourceChoice() {
        mutate { $0.returnToSourceChoice() }
    }

    func showMeetingSelection() {
        mutate { $0.showMeetingSelection() }
    }

    func chooseSource(_ source: StandaloneSourceKind) {
        mutate { _ = $0.chooseSource(source) }
    }

    func observeCalendar(
        _ permission: StandaloneCalendarPermission,
        selectedCalendarIDs: [String]? = nil
    ) {
        mutate { $0.observeCalendar(permission, selectedCalendarIDs: selectedCalendarIDs) }
    }

    func selectCalendarWindow(_ window: StandaloneCalendarWindow) {
        mutate { $0.selectCalendarWindow(window) }
    }

    func chooseMeeting(_ meeting: StandaloneMeeting) {
        mutate { _ = $0.chooseMeeting(meeting) }
    }

    func updateDraftText(_ text: String) {
        mutate { $0.updateDraftText(text) }
    }

    @discardableResult
    func importSharedCapture(_ envelope: SharedCaptureEnvelope) -> Bool {
        var imported = false
        let durablySaved = mutate { imported = $0.importSharedCapture(envelope) }
        return imported && durablySaved
    }

    func updateCaptureState(
        _ captureState: StandaloneCaptureState,
        audioFileName: String? = nil,
        error: String? = nil
    ) {
        mutate {
            $0.updateCaptureState(
                captureState,
                audioFileName: audioFileName,
                error: error
            )
        }
    }

    func process(using engine: StandaloneProposalGenerating) async {
        guard let pursuit = state.pursuit,
              let generation = beginProcessing(),
              let draft = state.captureDraft else { return }
        do {
            let proposal = try await engine.generate(draft: draft, pursuit: pursuit)
            let groundedProposal = proposal.enforcingEvidenceGrounding(in: draft.text)
            mutate { _ = $0.receiveProposal(groundedProposal, generation: generation) }
        } catch {
            mutate {
                $0.failProcessing(
                    "The Signal is still saved. \(error.localizedDescription)",
                    generation: generation
                )
            }
        }
    }

    func selectFact(_ id: UUID, selected: Bool) {
        mutate { $0.selectFact(id, selected: selected) }
    }

    func acceptAction(_ id: UUID, accepted: Bool) {
        mutate { $0.acceptAction(id, accepted: accepted) }
    }

    func editFact(_ id: UUID, value: String) {
        mutate { $0.editFact(id, value: value) }
    }

    func keepUnresolvedOnly() {
        mutate { _ = $0.keepUnresolvedOnly() }
    }

    func confirm() {
        mutate { _ = $0.confirm() }
    }

    func discardProposal() {
        mutate { $0.discardProposal() }
    }

    func reconcileSharedCaptureTransactions(using inbox: SharedCaptureInbox) throws {
        try inbox.reconcileDeletionTransactions(
            retainedEnvelopeIDs: state.importedSharedEnvelopeIDs
        )
    }

    func deleteImportedCapture(using inbox: SharedCaptureInbox) {
        guard let envelopeID = state.captureDraft?.sharedEnvelopeID else { return }
        deleteRetainedCapture(envelopeID, using: inbox)
    }

    func deleteRetainedCapture(_ envelopeID: UUID, using inbox: SharedCaptureInbox) {
        do {
            let transaction = try inbox.stageDeletion(envelopeID)
            var next = state
            if next.captureDraft?.sharedEnvelopeID == envelopeID {
                guard next.discardImportedCapture(envelopeID) else {
                    try inbox.rollbackDeletion(transaction)
                    return
                }
            } else {
                next.importedSharedEnvelopeIDs.remove(envelopeID)
            }
            if commit(next) {
                do {
                    try inbox.commitDeletion(transaction)
                } catch {
                    persistenceNotice = "The imported source is no longer referenced and its protected deletion is queued for recovery: \(error.localizedDescription)"
                }
            } else {
                do {
                    try inbox.rollbackDeletion(transaction)
                } catch {
                    persistenceNotice = "The session change was not saved and the imported source deletion could not roll back cleanly: \(error.localizedDescription)"
                }
            }
        } catch {
            persistenceNotice = "The imported source was not deleted: \(error.localizedDescription)"
        }
    }

    func showLatestProposal() {
        mutate { $0.showLatestProposal() }
    }

    func requestSystemCapture(_ source: StandaloneSourceKind) {
        mutate { $0.requestSystemCapture(source) }
    }

    func openPursuit(id: String) {
        mutate { $0.openPursuit(id: id) }
    }

    func markWrongPursuit() {
        mutate { $0.markWrongPursuit() }
    }

    func showActionButtonOffer() {
        mutate { $0.showActionButtonOffer() }
    }

    func openPractice() {
        mutate { $0.openPractice() }
    }

    func completePractice(simulated: Bool) {
        mutate { $0.completePractice(simulated: simulated) }
    }

    func skipPractice() {
        mutate { $0.skipPractice() }
    }

    func enterToday() {
        mutate { $0.enterToday() }
    }

    func replayOnboarding() {
        mutate { $0.replayOnboarding() }
    }

    var resetPersistence: any StandaloneOnboardingPersisting { persistence }

    func reloadAfterMaintenance() {
        do {
            guard let restored = try persistence.load(),
                  restored.version == StandaloneOnboardingState.flowVersion else { return }
            state = restored
            persistenceNotice = nil
        } catch {
            persistenceNotice = "The saved onboarding state could not be read. Existing sources were preserved."
        }
    }

    private func beginProcessing() -> Int? {
        var next = state
        guard let generation = next.beginProcessing() else {
            _ = commit(next)
            return nil
        }
        return commit(next) ? generation : nil
    }

    @discardableResult
    private func mutate(_ change: (inout StandaloneOnboardingState) -> Void) -> Bool {
        var next = state
        change(&next)
        return commit(next)
    }

    @discardableResult
    private func commit(_ next: StandaloneOnboardingState) -> Bool {
        do {
            try persistence.save(next)
            state = next
            persistenceNotice = nil
            return true
        } catch {
            persistenceNotice = "This step was not applied because it could not be durably saved. Retry when local storage is available: \(error.localizedDescription)"
            return false
        }
    }
}
