import CryptoKit
import Foundation

struct PersistedPursuitActionCompletion: Codable, Equatable {
    let workspaceID: String
    let pursuitID: String
    let actionID: String
    var expectedPursuitRevision: Int
    var expectedActionRevision: Int
    var outcomeSummary: String
    var operationID: UUID?
    var receipt: PursuitReviewReceipt?
    var updatedAt: Date
}

protocol PursuitActionCompletionPersisting: AnyObject {
    func entry(for actionID: String) throws -> PersistedPursuitActionCompletion?
    func allEntries() throws -> [PersistedPursuitActionCompletion]
    func save(_ entry: PersistedPursuitActionCompletion) throws
    func remove(actionID: String) throws
    func deleteAll() throws
}

final class UserDefaultsPursuitActionCompletionStore: PursuitActionCompletionPersisting {
    private let defaults: UserDefaults
    private let key = "talent-signal.pursuit-action-completions.v1"
    private let resetProcessKey = "talent-signal.pursuit-action-completions.reset-process.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains(
            "--reset-pursuit-action-completions"
        ) {
            let processID = Int(ProcessInfo.processInfo.processIdentifier)
            if defaults.integer(forKey: resetProcessKey) != processID {
                defaults.removeObject(forKey: key)
                defaults.set(processID, forKey: resetProcessKey)
            }
        }
#endif
    }

    func entry(for actionID: String) -> PersistedPursuitActionCompletion? {
        entries[actionID]
    }

    func allEntries() -> [PersistedPursuitActionCompletion] {
        Array(entries.values)
    }

    func save(_ entry: PersistedPursuitActionCompletion) {
        var next = entries
        next[entry.actionID] = entry
        if let data = try? JSONEncoder().encode(next) {
            defaults.set(data, forKey: key)
        }
    }

    func remove(actionID: String) {
        var next = entries
        next.removeValue(forKey: actionID)
        if next.isEmpty {
            defaults.removeObject(forKey: key)
        } else if let data = try? JSONEncoder().encode(next) {
            defaults.set(data, forKey: key)
        }
    }

    func deleteAll() {
        defaults.removeObject(forKey: key)
    }

    private var entries: [String: PersistedPursuitActionCompletion] {
        guard let data = defaults.data(forKey: key),
              let value = try? JSONDecoder().decode(
                [String: PersistedPursuitActionCompletion].self,
                from: data
              ) else {
            return [:]
        }
        return value
    }
}

final class FilePursuitActionCompletionStore: PursuitActionCompletionPersisting {
    private static let retention: TimeInterval = 30 * 24 * 60 * 60
    private let fileURL: URL
    private let deletionTombstoneURL: URL
    private let now: () -> Date
    private let migrationError: Error?

    init(
        accountID: String,
        rootURL: URL? = nil,
        now: @escaping () -> Date = Date.init,
        legacyAccountID: String? = nil
    ) {
        let digest = SHA256.hash(data: Data(accountID.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        let root = rootURL ?? FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        fileURL = root
            .appending(path: "TalentSignal/ActionCompletions", directoryHint: .isDirectory)
            .appending(path: "\(digest).json")
        deletionTombstoneURL = fileURL.appendingPathExtension("deletion-pending")
        self.now = now
        do {
            try RuntimeLegacyBindings.migrateFile(legacyAccountID: legacyAccountID, scope: accountID,
                directory: fileURL.deletingLastPathComponent(), destination: fileURL)
            migrationError = nil
        } catch { migrationError = error }
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains(
            "--reset-pursuit-action-completions"
        ) {
            let resetKey = "talent-signal.pursuit-action-completions.file-reset-process.\(digest)"
            let processID = Int(ProcessInfo.processInfo.processIdentifier)
            let defaults = UserDefaults.standard
            if defaults.integer(forKey: resetKey) != processID {
                if (try? deleteAll()) != nil {
                    defaults.set(processID, forKey: resetKey)
                }
            }
        }
#endif
    }

    func entry(for actionID: String) throws -> PersistedPursuitActionCompletion? {
        try entries()[actionID]
    }

    func allEntries() throws -> [PersistedPursuitActionCompletion] {
        Array(try entries().values)
    }

    func save(_ entry: PersistedPursuitActionCompletion) throws {
        var next = try entries()
        next[entry.actionID] = entry
        try write(next)
    }

    func remove(actionID: String) throws {
        var next = try entries()
        next.removeValue(forKey: actionID)
        if next.isEmpty {
            if FileManager.default.fileExists(atPath: fileURL.path) {
                try FileManager.default.removeItem(at: fileURL)
            }
        } else {
            try write(next)
        }
    }

    func deleteAll() throws {
        if let migrationError { throw migrationError }
        try writeProtected(Data("pending".utf8), to: deletionTombstoneURL)
        if FileManager.default.fileExists(atPath: fileURL.path) {
            try FileManager.default.removeItem(at: fileURL)
        }
        guard !FileManager.default.fileExists(atPath: fileURL.path) else {
            throw CocoaError(.fileWriteUnknown)
        }
        if FileManager.default.fileExists(atPath: deletionTombstoneURL.path) {
            try FileManager.default.removeItem(at: deletionTombstoneURL)
        }
    }

    private func entries() throws -> [String: PersistedPursuitActionCompletion] {
        if let migrationError { throw migrationError }
        if FileManager.default.fileExists(atPath: deletionTombstoneURL.path) {
            try deleteAll()
            return [:]
        }
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return [:]
        }
        let decoded = try JSONDecoder().decode(
            [String: PersistedPursuitActionCompletion].self,
            from: Data(contentsOf: fileURL)
        )
        let cutoff = now().addingTimeInterval(-Self.retention)
        let retained = decoded.filter { $0.value.updatedAt > cutoff }
        if retained.count != decoded.count {
            if retained.isEmpty {
                try FileManager.default.removeItem(at: fileURL)
            } else {
                try write(retained)
            }
        }
        return retained
    }

    private func write(
        _ entries: [String: PersistedPursuitActionCompletion]
    ) throws {
        try writeProtected(try JSONEncoder().encode(entries), to: fileURL)
    }

    private func writeProtected(_ data: Data, to destination: URL) throws {
        let directory = destination.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var protectedDirectory = directory
        try protectedDirectory.setResourceValues(values)
        try data.write(
            to: destination,
            options: [.atomic, .completeFileProtectionUnlessOpen]
        )
    }
}

struct PursuitActionRecoveryItem: Equatable, Identifiable {
    enum Status: Equatable {
        case recovering
        case recorded
    }

    let actionID: String
    let pursuitID: String
    let pursuitTitle: String
    let actionTitle: String
    let ownerDisplayName: String
    let outcomeSummary: String
    let updatedAt: Date
    let status: Status

    var id: String { actionID }
}

@MainActor
final class PursuitWorkspaceStore: ObservableObject {
    /// Shared active-refresh registration: the workspace directory (People
    /// and pursuits) is refreshed on foreground, focus, network recovery and a
    /// bounded active interval through one coordinator. Completions are fenced
    /// by the captured scope generation and the store's own lifetime.
    private var activeRefreshRegistration: WorkspaceActiveRefresh.Registration?
    private let activeRefreshEnabled: Bool

    private func adoptActiveRefresh() {
        guard activeRefreshEnabled, readScopeActive, readScopeIsCurrent(), activeRefreshRegistration == nil else { return }
        activeRefreshRegistration = WorkspaceActiveRefresh.shared.register(
            scope: "pursuit-workspace-directory"
        ) { [weak self] generation in
            guard let self,
                  WorkspaceActiveRefresh.shared.coordinator.isCurrent(generation)
            else { return }
            await self.load()
        }
    }

    deinit {
        if let activeRefreshRegistration {
            WorkspaceActiveRefresh.shared.unregister(activeRefreshRegistration)
        }
    }

    enum Phase: Equatable {
        case preview(PursuitWorkspaceSnapshot)
        case loading
        case loaded(PursuitWorkspaceSnapshot)
        case empty(PursuitWorkspaceSnapshot)
        case failed(String)
    }

    enum ActionCompletionPhase: Equatable {
        case idle
        case editing
        case confirming(operationID: UUID)
        case unknownLocked(operationID: UUID)
        case recorded(PursuitActionCompletionResult)
        case conflict(String)
        case failed(String)
    }

    @Published private(set) var phase: Phase
    @Published private(set) var lastCanonicalRevisionByPursuit: [String: Int] = [:]
    @Published private(set) var refreshNotice: String?
    @Published private(set) var isReadInFlight = false
    @Published private(set) var completedReadCount = 0
    @Published private(set) var actionCompletionPhases: [String: ActionCompletionPhase] = [:]
    @Published private(set) var actionOutcomeDrafts: [String: String] = [:]

    let isCanonical: Bool
    private let service: PursuitWorkspaceServing?
    var sessionSyncService: (any AgentSessionSyncServing)? { service as? any AgentSessionSyncServing }
    private let actionCompletions: PursuitActionCompletionPersisting
    private let readScopeIsCurrent: () -> Bool
    private var readScopeActive = true
    private let operationIDFactory: () -> UUID

    init(
        service: PursuitWorkspaceServing?,
        actionCompletions: PursuitActionCompletionPersisting = UserDefaultsPursuitActionCompletionStore(),
        operationIDFactory: @escaping () -> UUID = UUID.init,
        previewSnapshot: PursuitWorkspaceSnapshot = .preview,
        activeRefreshEnabled: Bool = true,
        readScopeIsCurrent: @escaping () -> Bool = { true }
    ) {
        self.service = service
        self.activeRefreshEnabled = activeRefreshEnabled
        self.readScopeIsCurrent = readScopeIsCurrent
        self.actionCompletions = actionCompletions
        self.operationIDFactory = operationIDFactory
        isCanonical = service != nil
        phase = service == nil ? .preview(previewSnapshot) : .loading
    }

    func load() async {
        adoptActiveRefresh()
        guard service != nil, !isReadInFlight else { return }
        await LabClientDiagnostics.observe(.workspaceRead) { await loadRecorded() }
    }
    func refreshForLab() async -> Bool {
        guard isCanonical, !isReadInFlight else { return false }
        var verified = false
        await LabClientDiagnostics.observe(.workspaceRead) {
            let outcome = await loadRecorded(); verified = outcome == .completed; return outcome
        }
        return verified
    }

    /// Scope/lifetime change: a completed People fetch from the old scope must
    /// never publish into the new one.
    private var readEpoch = 0
    private var conversationImageReadTasks: [UUID: Task<Void, Never>] = [:]
    private var memoryReviewRecoveryBindings = Set<String>()
    func invalidateReadScope() {
        readEpoch += 1
        readScopeActive = false
        conversationImageReadTasks.values.forEach { $0.cancel() }
        conversationImageReadTasks.removeAll()
        for binding in memoryReviewRecoveryBindings {
            try? KeychainConversationMemoryOperationStore().removeAccount(
                prefix: ConversationMemoryIntentRetention.accountPrefix(binding: binding))
        }
        memoryReviewRecoveryBindings.removeAll()
        isReadInFlight = false
        if let activeRefreshRegistration {
            WorkspaceActiveRefresh.shared.unregister(activeRefreshRegistration)
            self.activeRefreshRegistration = nil
        }
    }

    func activateReadScope() {
        readScopeActive = true
        adoptActiveRefresh()
    }

    private func loadRecorded() async -> LabClientSpan.Outcome {
        guard readScopeActive, readScopeIsCurrent(), let service, !isReadInFlight else { return .skipped }
        isReadInFlight = true
        let epoch = readEpoch
        // A stale read can never clear a newer read's ownership or publish.
        defer {
            if epoch == readEpoch { isReadInFlight = false }
            if epoch == readEpoch { completedReadCount += 1 }
        }
        let currentSnapshot = snapshot
        let isRetryingFailure: Bool
        if case .failed = phase {
            isRetryingFailure = true
        } else {
            isRetryingFailure = false
        }
        if currentSnapshot == nil && !isRetryingFailure {
            refreshNotice = nil
            phase = .loading
        }
        do {
            let snapshot = try await service.loadWorkspace()
            guard epoch == readEpoch, readScopeActive, readScopeIsCurrent() else { return .skipped }
            refreshNotice = nil
            let nextRevisions = Dictionary(
                uniqueKeysWithValues: snapshot.pursuits.map { ($0.id, $0.revision) }
            )
            if !lastCanonicalRevisionByPursuit.isEmpty {
                let removedCount = lastCanonicalRevisionByPursuit.keys.filter {
                    nextRevisions[$0] == nil
                }.count
                let changedCount = lastCanonicalRevisionByPursuit.filter { current in
                    nextRevisions[current.key].map { nextRevision in
                        nextRevision != current.value
                    } ?? false
                }.count
                if removedCount > 0 {
                    refreshNotice = removedCount == 1
                        ? "A Pursuit was removed from the canonical workspace. This view is current."
                        : "\(removedCount) Pursuits were removed from the canonical workspace. This view is current."
                } else if changedCount > 0 {
                    refreshNotice = changedCount == 1
                        ? "A Pursuit changed in the canonical workspace. This view was refreshed."
                        : "\(changedCount) Pursuits changed in the canonical workspace. This view was refreshed."
                }
            }
            LabClientDiagnostics.measureSync(.statePublished) {
                lastCanonicalRevisionByPursuit = nextRevisions
                phase = snapshot.pursuits.isEmpty && snapshot.people.isEmpty
                    ? .empty(snapshot)
                    : .loaded(snapshot)
            }
            await restoreSavedActionCompletions(in: snapshot, epoch: epoch)
            guard epoch == readEpoch, readScopeActive, readScopeIsCurrent() else { return .skipped }
            return .completed
        } catch {
            guard epoch == readEpoch, readScopeActive, readScopeIsCurrent() else { return .skipped }
            let message = (error as? LocalizedError)?.errorDescription
                ?? "The canonical workspace could not be loaded."
            if let currentSnapshot {
                refreshNotice = "Refresh failed. Showing the last canonical read; retry to confirm it is current. \(message)"
                phase = currentSnapshot.pursuits.isEmpty && currentSnapshot.people.isEmpty
                    ? .empty(currentSnapshot)
                    : .loaded(currentSnapshot)
            } else {
                phase = .failed(message)
            }
            return LabClientDiagnostics.failure(error)
        }
    }

    func ask(
        objective: String,
        personID: String,
        relationshipContextID: String,
        idempotencyKey: String,
        mediaIDs: [String] = [],
        sessionID: UUID? = nil,
        messageID: UUID? = nil
    ) async throws -> RelationshipAskResponse {
        guard let service else {
            throw PursuitWorkspaceClientError.askUnavailable
        }
        return try await LabClientDiagnostics.measure(.relationshipTask) {
            try await service.ask(
                objective: objective,
                personID: personID,
                relationshipContextID: relationshipContextID,
                idempotencyKey: idempotencyKey,
                mediaIDs: mediaIDs,
                sessionID: sessionID,
                messageID: messageID
            )
        }
    }

    func chatUnscoped(
        objective: String,
        idempotencyKey: String,
        sessionID: UUID? = nil,
        messageID: UUID? = nil
    ) async throws -> UnscopedChatTaskResponse {
        guard let service else {
            throw PursuitWorkspaceClientError.askUnavailable
        }
        return try await LabClientDiagnostics.measure(.conversationTask) {
            try await service.chatUnscoped(
                objective: objective,
                idempotencyKey: idempotencyKey,
                sessionID: sessionID,
                messageID: messageID
            )
        }
    }

    func researchPerson(
        objective: String,
        imageData: Data,
        mediaType: String,
        idempotencyKey: String
    ) async throws -> PersonResearchTaskResponse {
        guard let service else {
            throw PursuitWorkspaceClientError.askUnavailable
        }
        return try await LabClientDiagnostics.measure(.imageResearch) {
            try await service.researchPerson(
                objective: objective,
                imageData: imageData,
                mediaType: mediaType,
                idempotencyKey: idempotencyKey
            )
        }
    }

    func createScreenshotContactTask(_ body: ScreenshotContactTaskBody) async throws -> ScreenshotContactTask {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.createScreenshotContactTask(body)
    }
    func refreshReviewRequirement(_ requirement: AskCitationReviewRequirement, personID: String, contextID: String) async throws -> AskCitationReviewRequirement {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.refreshReviewRequirement(requirement, personID: personID, relationshipContextID: contextID)
    }

    func loadReplyPreference() async throws -> AgentReplyPreference {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.loadReplyPreference()
    }
    func saveReplyPreference(_ body: AgentReplyPreferenceMutation) async throws -> AgentReplyPreference {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.saveReplyPreference(body)
    }
    func listRunArtifacts(taskID: String) async throws -> [RunArtifact] {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.listRunArtifacts(taskID: taskID)
    }
    func loadRunArtifact(taskID: String, artifact: RunArtifact) async throws -> Data {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.loadRunArtifact(taskID: taskID, artifact: artifact)
    }
    func loadScreenshotContactImage(taskID: String, index: Int) async throws -> ChatMediaContent {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.loadScreenshotContactImage(taskID: taskID, index: index)
    }
    func loadScreenshotContactTask(id: String) async throws -> ScreenshotContactTask {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.loadScreenshotContactTask(id: id)
    }
    func listScreenshotContactTasks() async throws -> ScreenshotContactTaskList {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.listScreenshotContactTasks()
    }
    func loadContactIntelligence(personID: String, contextID: String) async throws -> ContactIntelligenceEnvelope {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.loadContactIntelligence(personID: personID, contextID: contextID)
    }
    func resumeScreenshotContactTask(id: String, body: ScreenshotContactResumeBody) async throws -> ScreenshotContactTask {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.resumeScreenshotContactTask(id: id, body: body)
    }
    func cancelScreenshotContactTask(id: String, revision: Int) async throws -> ScreenshotContactTask {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.cancelScreenshotContactTask(id: id, revision: revision)
    }

    /// Executes an accepted screenshot stop command without depending on the
    /// Ask view's currently selected Session. The caller owns an unstructured
    /// Task so this read-revision-write sequence can finish after dismissal.
    func cancelLatestScreenshotContactTask(id: String) async throws -> ScreenshotContactTask {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        let latest = try await service.loadScreenshotContactTask(id: id)
        guard latest.taskID == id else { throw PursuitWorkspaceClientError.invalidResponse }
        try Task.checkCancellation()
        return try await service.cancelScreenshotContactTask(
            id: id,
            revision: latest.revision
        )
    }

    func saveContactDraft(
        _ draft: ConversationContactDraft,
        target: ConversationContactTarget,
        confirmIdentityClue: Bool,
        capturedAt: Date,
        idempotencyKey: String
    ) async throws -> ResourceCaptureResult {
        guard let service else {
            throw PursuitWorkspaceClientError.askUnavailable
        }
        let result = try await service.saveContactDraft(
            draft,
            target: target,
            confirmIdentityClue: confirmIdentityClue,
            capturedAt: capturedAt,
            idempotencyKey: idempotencyKey
        )
        await load()
        return result
    }

    func findContactMatches(
        identityClue: ConversationContactDraft.IdentityClue
    ) async throws -> [WorkspacePerson] {
        guard let service else {
            throw PursuitWorkspaceClientError.askUnavailable
        }
        return try await service.findContactMatches(identityClue: identityClue)
    }

    func createChatMedia(
        personID: String,
        relationshipContextID: String,
        fileName: String,
        mediaType: String,
        byteSize: Int,
        width: Int?,
        height: Int?,
        idempotencyKey: String
    ) async throws -> ChatMediaAsset {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.createChatMedia(
            personID: personID,
            relationshipContextID: relationshipContextID,
            fileName: fileName,
            mediaType: mediaType,
            byteSize: byteSize,
            width: width,
            height: height,
            idempotencyKey: idempotencyKey
        )
    }

    func uploadChatMedia(id: String, data: Data, mediaType: String) async throws -> ChatMediaAsset {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await LabClientDiagnostics.measure(.mediaUpload) {
            try await service.uploadChatMedia(id: id, data: data, mediaType: mediaType)
        }
    }

    func deleteChatMedia(id: String) async throws {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        try await service.deleteChatMedia(id: id)
    }

    func loadChatMedia(id: String) async throws -> ChatMediaContent {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.loadChatMedia(id: id)
    }

    func revalidateAsk(
        response: RelationshipAskResponse,
        personID: String,
        relationshipContextID: String
    ) async throws {
        guard let service else {
            throw PursuitWorkspaceClientError.askUnavailable
        }
        try await service.revalidateAsk(
            response: response,
            personID: personID,
            relationshipContextID: relationshipContextID
        )
    }

    func rejectEvidence(
        fragmentID: String,
        expectedReviewStatus: String,
        expectedLastReviewID: String?,
        reason: String,
        idempotencyKey: String
    ) async throws -> PursuitEvidenceReviewResult {
        guard let service else {
            throw PursuitWorkspaceClientError.askUnavailable
        }
        let result = try await service.rejectEvidence(
            fragmentID: fragmentID,
            expectedReviewStatus: expectedReviewStatus,
            expectedLastReviewID: expectedLastReviewID,
            reason: reason,
            idempotencyKey: idempotencyKey
        )
        await load()
        return result
    }

    func reviewEvidence(
        fragmentID: String,
        expectedReviewStatus: String,
        expectedLastReviewID: String?,
        decision: String,
        reason: String,
        idempotencyKey: String
    ) async throws -> PursuitEvidenceReviewResult {
        guard let service else {
            throw PursuitWorkspaceClientError.askUnavailable
        }
        let result = try await service.reviewEvidence(
            fragmentID: fragmentID,
            expectedReviewStatus: expectedReviewStatus,
            expectedLastReviewID: expectedLastReviewID,
            decision: decision,
            reason: reason,
            idempotencyKey: idempotencyKey
        )
        await load()
        return result
    }

    func prepareActionCompletion(
        pursuit: WorkspacePursuit,
        action: WorkspaceAction
    ) async {
        let savedEntry: PersistedPursuitActionCompletion?
        do {
            savedEntry = try actionCompletions.entry(for: action.id)
        } catch {
            actionCompletionPhases[action.id] = .failed(
                "Protected action recovery could not be read. No outcome was sent."
            )
            return
        }
        guard let entry = savedEntry,
              entry.workspaceID == pursuit.workspaceID,
              entry.pursuitID == pursuit.id else {
            actionOutcomeDrafts[action.id] = ""
            actionCompletionPhases[action.id] = .editing
            return
        }
        actionOutcomeDrafts[action.id] = entry.outcomeSummary
        if let receipt = entry.receipt {
            let result = PursuitActionCompletionResult(
                pursuit: pursuit,
                receipt: receipt
            )
            if trustedCompletion(
                result,
                entry: entry,
                currentUserID: snapshot?.currentUserID
            ) {
                actionCompletionPhases[action.id] = .recorded(result)
            } else if let operationID = entry.operationID {
                actionCompletionPhases[action.id] = .unknownLocked(
                    operationID: operationID
                )
                await reconcileActionCompletion(actionID: action.id)
            }
        } else if let operationID = entry.operationID {
            actionCompletionPhases[action.id] = .unknownLocked(operationID: operationID)
            await reconcileActionCompletion(actionID: action.id)
        } else {
            actionCompletionPhases[action.id] = .editing
        }
    }

    func updateActionOutcomeDraft(
        pursuit: WorkspacePursuit,
        action: WorkspaceAction,
        value: String
    ) {
        guard !isActionCompletionLocked(actionID: action.id) else { return }
        let bounded = String(value.prefix(1_000))
        actionOutcomeDrafts[action.id] = bounded
        do {
            try actionCompletions.save(
                PersistedPursuitActionCompletion(
                    workspaceID: pursuit.workspaceID,
                    pursuitID: pursuit.id,
                    actionID: action.id,
                    expectedPursuitRevision: pursuit.revision,
                    expectedActionRevision: action.revision,
                    outcomeSummary: bounded,
                    operationID: nil,
                    receipt: nil,
                    updatedAt: Date()
                )
            )
            actionCompletionPhases[action.id] = .editing
        } catch {
            actionCompletionPhases[action.id] = .failed(
                "This draft could not be protected on this device. No outcome was sent."
            )
        }
    }

    func cancelActionCompletion(actionID: String) {
        guard !isActionCompletionLocked(actionID: actionID) else { return }
        do {
            try actionCompletions.remove(actionID: actionID)
            actionOutcomeDrafts.removeValue(forKey: actionID)
            actionCompletionPhases[actionID] = .idle
        } catch {
            actionCompletionPhases[actionID] = .failed(
                "The protected draft could not be removed. Try again before leaving this device."
            )
        }
    }

    func submitActionCompletion(
        pursuit: WorkspacePursuit,
        action: WorkspaceAction
    ) async {
        guard let service else {
            actionCompletionPhases[action.id] = .failed(
                PursuitWorkspaceClientError.actionCompletionUnavailable.localizedDescription
            )
            return
        }
        let outcome = (actionOutcomeDrafts[action.id] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !outcome.isEmpty, !isActionCompletionLocked(actionID: action.id) else {
            return
        }
        let operationID = operationIDFactory()
        var entry = PersistedPursuitActionCompletion(
            workspaceID: pursuit.workspaceID,
            pursuitID: pursuit.id,
            actionID: action.id,
            expectedPursuitRevision: pursuit.revision,
            expectedActionRevision: action.revision,
            outcomeSummary: outcome,
            operationID: operationID,
            receipt: nil,
            updatedAt: Date()
        )
        do {
            try actionCompletions.save(entry)
        } catch {
            actionCompletionPhases[action.id] = .failed(
                "This operation could not be protected on this device. No outcome was sent."
            )
            return
        }
        actionCompletionPhases[action.id] = .confirming(operationID: operationID)
        do {
            let result = try await service.completeAction(
                pursuitID: pursuit.id,
                actionID: action.id,
                expectedPursuitRevision: pursuit.revision,
                expectedActionRevision: action.revision,
                outcomeSummary: outcome,
                operationID: operationID
            )
            guard trustedCompletion(
                result,
                entry: entry,
                currentUserID: snapshot?.currentUserID
            ) else {
                actionCompletionPhases[action.id] = .unknownLocked(
                    operationID: operationID
                )
                return
            }
            entry.receipt = result.receipt
            entry.updatedAt = Date()
            do {
                try actionCompletions.save(entry)
            } catch {
                actionCompletionPhases[action.id] = .unknownLocked(
                    operationID: operationID
                )
                return
            }
            actionOutcomeDrafts[action.id] = outcome
            actionCompletionPhases[action.id] = .recorded(result)
            await load()
        } catch let error as PursuitWorkspaceClientError {
            if case let .backend(code, message) = error {
                entry.operationID = nil
                entry.updatedAt = Date()
                do {
                    try actionCompletions.save(entry)
                    actionCompletionPhases[action.id] = .conflict("\(message) (\(code))")
                } catch {
                    actionCompletionPhases[action.id] = .unknownLocked(
                        operationID: operationID
                    )
                }
            } else {
                actionCompletionPhases[action.id] = .unknownLocked(
                    operationID: operationID
                )
            }
        } catch {
            actionCompletionPhases[action.id] = .unknownLocked(operationID: operationID)
        }
    }

    func reconcileActionCompletion(actionID: String) async {
        guard readScopeActive, readScopeIsCurrent(), let service else { return }
        let epoch = readEpoch
        let savedEntry: PersistedPursuitActionCompletion?
        do {
            savedEntry = try actionCompletions.entry(for: actionID)
        } catch {
            guard epoch == readEpoch, readScopeActive, readScopeIsCurrent() else { return }
            actionCompletionPhases[actionID] = .failed(
                "Protected action recovery could not be read. No retry was sent."
            )
            return
        }
        guard var entry = savedEntry,
              let operationID = entry.operationID else { return }
        actionCompletionPhases[actionID] = .unknownLocked(operationID: operationID)
        do {
            let readback = try await service.readOperation(id: operationID)
            guard epoch == readEpoch, readScopeActive, readScopeIsCurrent() else { return }
            if readback.operation.status == "applied",
               let receipt = readback.receipt,
               trustedReconciliation(readback, entry: entry, receipt: receipt) {
                entry.receipt = receipt
                entry.updatedAt = Date()
                do {
                    try actionCompletions.save(entry)
                } catch {
                    actionCompletionPhases[actionID] = .unknownLocked(
                        operationID: operationID
                    )
                    return
                }
                actionOutcomeDrafts[actionID] = entry.outcomeSummary
                actionCompletionPhases[actionID] = .recorded(
                    PursuitActionCompletionResult(
                        pursuit: readback.pursuit,
                        receipt: receipt
                    )
                )
                await load()
            } else if readback.operation.status == "conflict" {
                entry.operationID = nil
                entry.updatedAt = Date()
                do {
                    try actionCompletions.save(entry)
                    actionCompletionPhases[actionID] = .conflict(
                        "Canonical state changed before this outcome could be recorded. Review the current action."
                    )
                    await load()
                } catch {
                    actionCompletionPhases[actionID] = .unknownLocked(
                        operationID: operationID
                    )
                }
            } else if readback.operation.status == "failed" {
                entry.operationID = nil
                entry.updatedAt = Date()
                do {
                    try actionCompletions.save(entry)
                    actionCompletionPhases[actionID] = .failed(
                        "Canonical readback proves that this outcome was not recorded. The draft remains available."
                    )
                    await load()
                } catch {
                    actionCompletionPhases[actionID] = .unknownLocked(
                        operationID: operationID
                    )
                }
            }
        } catch let error as PursuitWorkspaceClientError {
            guard epoch == readEpoch, readScopeActive, readScopeIsCurrent() else { return }
            if case let .backend(code, _) = error, code == "OPERATION_NOT_FOUND" {
                entry.operationID = nil
                entry.updatedAt = Date()
                do {
                    try actionCompletions.save(entry)
                    actionCompletionPhases[actionID] = .editing
                    refreshNotice = "Canonical readback found no action operation. The saved draft is safe to submit again."
                    await load()
                } catch {
                    actionCompletionPhases[actionID] = .unknownLocked(
                        operationID: operationID
                    )
                }
            } else {
                actionCompletionPhases[actionID] = .unknownLocked(
                    operationID: operationID
                )
            }
        } catch {
            guard epoch == readEpoch, readScopeActive, readScopeIsCurrent() else { return }
            actionCompletionPhases[actionID] = .unknownLocked(operationID: operationID)
        }
    }

    func actionCompletionPhase(actionID: String) -> ActionCompletionPhase {
        actionCompletionPhases[actionID] ?? .idle
    }

    func hasSavedActionCompletion(actionID: String) -> Bool {
        (try? actionCompletions.entry(for: actionID)) != nil
    }

    func latestActionRecovery(
        in snapshot: PursuitWorkspaceSnapshot
    ) -> PursuitActionRecoveryItem? {
        guard let savedEntries = try? actionCompletions.allEntries() else {
            return nil
        }
        for entry in savedEntries.sorted(by: {
            $0.updatedAt > $1.updatedAt
        }) where entry.workspaceID == snapshot.workspaceID
            && (entry.operationID != nil || entry.receipt != nil) {
            guard let pursuit = snapshot.pursuit(id: entry.pursuitID),
                  let action = pursuit.actions.first(where: {
                      $0.id == entry.actionID
                  }) else { continue }
            let status: PursuitActionRecoveryItem.Status
            let canonicalAction: WorkspaceAction
            if case let .recorded(result) = actionCompletionPhase(
                actionID: entry.actionID
            ), let recordedAction = result.pursuit.actions.first(where: {
                $0.id == entry.actionID
            }) {
                status = .recorded
                canonicalAction = recordedAction
            } else {
                status = .recovering
                canonicalAction = action
            }
            return PursuitActionRecoveryItem(
                actionID: entry.actionID,
                pursuitID: entry.pursuitID,
                pursuitTitle: pursuit.title,
                actionTitle: canonicalAction.title,
                ownerDisplayName: canonicalAction.ownerDisplayName,
                outcomeSummary: entry.outcomeSummary,
                updatedAt: entry.updatedAt,
                status: status
            )
        }
        return nil
    }

    private func restoreSavedActionCompletions(
        in snapshot: PursuitWorkspaceSnapshot, epoch: Int
    ) async {
        let savedEntries: [PersistedPursuitActionCompletion]
        do {
            savedEntries = try actionCompletions.allEntries()
        } catch {
            refreshNotice = "Protected action recovery could not be read. No outcome will be retried."
            return
        }
        let entries = savedEntries
            .filter { $0.workspaceID == snapshot.workspaceID }
            .sorted { $0.updatedAt > $1.updatedAt }
        for entry in entries {
            guard epoch == readEpoch, readScopeActive, readScopeIsCurrent() else { return }
            guard let pursuit = snapshot.pursuit(id: entry.pursuitID),
                  let action = pursuit.actions.first(where: {
                      $0.id == entry.actionID
                  }) else { continue }
            actionOutcomeDrafts[action.id] = entry.outcomeSummary
            if let receipt = entry.receipt {
                let result = PursuitActionCompletionResult(
                    pursuit: pursuit,
                    receipt: receipt
                )
                if trustedCompletion(
                    result,
                    entry: entry,
                    currentUserID: snapshot.currentUserID
                ) {
                    actionCompletionPhases[action.id] = .recorded(result)
                    continue
                }
            }
            if let operationID = entry.operationID {
                actionCompletionPhases[action.id] = .unknownLocked(
                    operationID: operationID
                )
                await reconcileActionCompletion(actionID: action.id)
            } else {
                actionCompletionPhases[action.id] = .editing
            }
        }
    }

    func deleteSavedActionCompletions() -> Bool {
        do {
            try actionCompletions.deleteAll()
            actionOutcomeDrafts = [:]
            actionCompletionPhases = [:]
            return true
        } catch {
            refreshNotice = "Protected action recovery could not be removed. Sign out was paused; try again."
            return false
        }
    }

    private func isActionCompletionLocked(actionID: String) -> Bool {
        switch actionCompletionPhase(actionID: actionID) {
        case .confirming, .unknownLocked, .recorded:
            return true
        case .idle, .editing, .conflict, .failed:
            return false
        }
    }

    private func trustedCompletion(
        _ result: PursuitActionCompletionResult,
        entry: PersistedPursuitActionCompletion,
        currentUserID: String?
    ) -> Bool {
        guard let operationID = entry.operationID?.uuidString.lowercased(),
              let action = result.pursuit.actions.first(where: {
                $0.id == entry.actionID
              }) else { return false }
        return result.pursuit.id == entry.pursuitID
            && result.pursuit.workspaceID == entry.workspaceID
            && result.receipt.workspaceID == entry.workspaceID
            && result.receipt.operationID == operationID
            && result.receipt.operationKind == "revise_pursuit"
            && result.receipt.status == "applied"
            && result.receipt.proposalID == nil
            && result.receipt.actorUserID == currentUserID
            && result.receipt.outcome == "canonical_applied"
            && result.receipt.entityRef.beforeRevision == entry.expectedPursuitRevision
            && result.receipt.entityRef.afterRevision == entry.expectedPursuitRevision + 1
            && result.receipt.entityRef.afterRevision == result.pursuit.revision
            && Set(result.receipt.changedFields) == Set([
                "actions.\(entry.actionID).status",
                "actions.\(entry.actionID).outcome_summary",
            ])
            && result.receipt.externalEffects.isEmpty
            && action.ownerUserID == currentUserID
            && action.status == "completed"
            && action.revision == entry.expectedActionRevision + 1
            && action.outcomeSummary == entry.outcomeSummary
            && action.externalEffects.isEmpty
    }

    private func trustedReconciliation(
        _ readback: PursuitActionOperationReadback,
        entry: PersistedPursuitActionCompletion,
        receipt: PursuitReviewReceipt
    ) -> Bool {
        guard let operationID = entry.operationID?.uuidString.lowercased(),
              let action = readback.pursuit.actions.first(where: {
                $0.id == entry.actionID
              }) else { return false }
        let result = PursuitActionCompletionResult(
            pursuit: readback.pursuit,
            receipt: receipt
        )
        return readback.operation.id == operationID
            && readback.operation.pursuitID == entry.pursuitID
            && readback.operation.proposalID == nil
            && readback.operation.operationKind == "revise_pursuit"
            && readback.operation.status == "applied"
            && readback.operation.beforeRevision == entry.expectedPursuitRevision
            && readback.operation.afterRevision == receipt.entityRef.afterRevision
            && action.ownerUserID == receipt.actorUserID
            && trustedCompletion(
                result,
                entry: entry,
                currentUserID: receipt.actorUserID
            )
    }

    var snapshot: PursuitWorkspaceSnapshot? {
        switch phase {
        case let .preview(snapshot), let .loaded(snapshot), let .empty(snapshot):
            return snapshot
        case .loading, .failed:
            return nil
        }
    }
}

extension PursuitWorkspaceStore {
    /// Typed capabilities keep authentication inside the service. A restored
    /// proposal still needs a fresh, scope-bound authenticated read.
    func memoryReviewClient() async throws -> ConversationMemoryReviewClient {
        guard readScopeActive, readScopeIsCurrent(),
              let provider = service as? any ConversationMemoryReviewClientProviding else {
            throw PursuitWorkspaceClientError.askUnavailable
        }
        let epoch = readEpoch
        let client = try await provider.memoryReviewClient()
        guard epoch == readEpoch, readScopeActive, readScopeIsCurrent() else {
            throw CancellationError()
        }
        memoryReviewRecoveryBindings.insert(client.accountBinding)
        return client.boundToCurrentScope { [weak self] in
            guard let self else { return false }
            return epoch == self.readEpoch && self.readScopeActive && self.readScopeIsCurrent()
        }
    }

    /// Queue events are observations, never final-answer authority. Stop
    /// forwarding and cancel the connection when this workspace loses scope.
    func conversationImageUpdates(sessionID: UUID, messageID: UUID) async throws
        -> AsyncThrowingStream<ConversationImageQueueUpdate, Error> {
        guard readScopeActive, readScopeIsCurrent(),
              let source = service as? any ConversationImageStreaming else {
            throw PursuitWorkspaceClientError.askUnavailable
        }
        let epoch = readEpoch
        let upstream = try await source.conversationImageUpdates(sessionID: sessionID, messageID: messageID)
        guard epoch == readEpoch, readScopeActive, readScopeIsCurrent() else {
            throw CancellationError()
        }
        let streamID = UUID()
        return AsyncThrowingStream { continuation in
            let reader = Task { @MainActor [weak self] in
                do {
                    for try await update in upstream {
                        try Task.checkCancellation()
                        guard let self, epoch == self.readEpoch,
                              self.readScopeActive, self.readScopeIsCurrent() else {
                            continuation.finish()
                            return
                        }
                        guard update.sessionID == sessionID, update.messageID == messageID else { continue }
                        continuation.yield(update)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            conversationImageReadTasks[streamID] = reader
            continuation.onTermination = { [weak self] _ in
                reader.cancel()
                Task { @MainActor in
                    self?.conversationImageReadTasks.removeValue(forKey: streamID)
                }
            }
        }
    }

    func admitConversationImages(sessionID: UUID, messageID: UUID, idempotencyKey: String,
        objective: String, images: [ConversationImageUpload], timeZone: String) async throws -> ConversationImageAdmission {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.admitConversationImages(sessionID: sessionID, messageID: messageID,
            idempotencyKey: idempotencyKey, objective: objective, images: images, timeZone: timeZone)
    }
    func readConversationImageState(sessionID: UUID, messageID: UUID) async throws -> ConversationImageObservation {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.readConversationImageState(sessionID: sessionID, messageID: messageID)
    }
    func loadConversationImage(sessionID: UUID, messageID: UUID, index: Int,
        manifest: ConversationImageManifest) async throws -> ChatMediaContent {
        guard let service else { throw PursuitWorkspaceClientError.askUnavailable }
        return try await service.loadConversationImage(sessionID: sessionID, messageID: messageID, index: index, manifest: manifest)
    }
}
