import CryptoKit
import Foundation
import Darwin
import SwiftUI

enum RelationshipArchivePage: String, CaseIterable, Identifiable {
    case today = "Today"
    case sessions = "Sessions"
    case people = "People"
    case meetings = "Meetings"

    var id: String { rawValue }

    var accessibilityIdentifier: String {
        rawValue.lowercased()
    }

    var pageIndex: Int {
        Self.allCases.firstIndex(of: self) ?? 0
    }

    func title(in language: AppLanguage) -> String {
        switch self {
        case .today:
            return language.text("Today", zhHans: "今天")
        case .sessions:
            return language.text("Sessions", zhHans: "会话")
        case .people:
            return language.text("People", zhHans: "人物")
        case .meetings:
            return language.text("Meetings", zhHans: "会面")
        }
    }

    var symbolName: String {
        switch self {
        case .today: return "house"
        case .sessions: return "bubble.left"
        case .people: return "person.2"
        case .meetings: return "calendar"
        }
    }
}

struct AgentSessionTurn: Identifiable, Equatable {
    let id: UUID
    let objective: String
    let response: RelationshipAskResponse
    let createdAt: Date
    let requiresRefresh: Bool
    var feedback: AgentSessionFeedback? = nil
    var feedbackUpdatedAt: Date? = nil
    var images: [ConversationImageManifest] = []
    var canonicalWire: JSONValue? = nil

    init(
        id: UUID,
        objective: String,
        response: RelationshipAskResponse,
        createdAt: Date,
        requiresRefresh: Bool,
        feedback: AgentSessionFeedback? = nil,
        feedbackUpdatedAt: Date? = nil,
        images: [ConversationImageManifest] = [],
        canonicalWire: JSONValue? = nil
    ) {
        self.id = id
        self.objective = objective
        self.response = AgentSessionContextPolicy.classifiedResponse(
            response,
            requireExistingShareClassification: requiresRefresh
        )
        self.createdAt = createdAt
        self.requiresRefresh = requiresRefresh
        self.feedback = feedback
        self.feedbackUpdatedAt = feedbackUpdatedAt
        self.images = images
        self.canonicalWire = canonicalWire
    }
}

enum AgentSessionFeedback: String, Codable, Equatable {
    case helpful
    case unhelpful
}

struct AgentContactReceipt: Identifiable, Equatable {
    enum Outcome: String, Codable, Equatable {
        case createdPerson = "created_person"
        case matchedExisting = "matched_existing"
        case identityReview = "identity_review"
    }

    let id: UUID
    let operationKey: String
    let outcome: Outcome
    let captureID: String
    let resourceID: String
    let duplicateOfResourceID: String?
    let personID: String?
    let relationshipContextID: String?
    let resolutionCaseID: String?
    let personDisplayLabel: String
    let contextDisplayLabel: String?
    let createdAt: Date
    let requiresRefresh: Bool

    var compactPreview: String {
        compactPreview(in: .english)
    }

    func compactPreview(in language: AppLanguage) -> String {
        let reference = resourceID.suffix(8)
        let preview: String
        switch outcome {
        case .createdPerson:
            preview = String(
                format: language.text("Created contact · receipt %@"),
                locale: language.locale,
                String(reference)
            )
        case .matchedExisting:
            preview = String(
                format: language.text("Added to existing contact · receipt %@"),
                locale: language.locale,
                String(reference)
            )
        case .identityReview:
            let caseReference = resolutionCaseID.map { String($0.suffix(8)) }
                ?? String(reference)
            preview = String(
                format: language.text("Saved for identity review · case %@"),
                locale: language.locale,
                caseReference
            )
        }
        guard requiresRefresh else { return preview }
        return String(
            format: language.text("Saved receipt · %@"),
            locale: language.locale,
            preview
        )
    }

    func currentPerson(in snapshot: PursuitWorkspaceSnapshot) -> WorkspacePerson? {
        guard let personID else { return nil }
        return snapshot.people.first { $0.id == personID }
    }
}

enum AgentSessionScope: Equatable {
    case unresolvedIntent
    case relationship(
        personID: String,
        relationshipContextID: String,
        personDisplayLabel: String,
        contextDisplayLabel: String
    )
    case identityReview(
        resolutionCaseID: String,
        personDisplayLabel: String
    )

    var personID: String? {
        guard case let .relationship(personID, _, _, _) = self else { return nil }
        return personID
    }

    var relationshipContextID: String? {
        guard case let .relationship(_, relationshipContextID, _, _) = self else {
            return nil
        }
        return relationshipContextID
    }

    var resolutionCaseID: String? {
        guard case let .identityReview(resolutionCaseID, _) = self else { return nil }
        return resolutionCaseID
    }

    var personDisplayLabel: String {
        switch self {
        case .unresolvedIntent:
            return "New session"
        case let .relationship(_, _, personDisplayLabel, _),
             let .identityReview(_, personDisplayLabel):
            return personDisplayLabel
        }
    }

    var contextDisplayLabel: String {
        switch self {
        case .unresolvedIntent:
            return "Finding relationship"
        case let .relationship(_, _, _, contextDisplayLabel):
            return contextDisplayLabel
        case .identityReview:
            return "Identity review"
        }
    }

    func matches(personID: String, relationshipContextID: String) -> Bool {
        self.personID == personID
            && self.relationshipContextID == relationshipContextID
    }
}

struct AgentSessionSeed: Equatable {
    let personID: String
    let relationshipContextID: String
    let suggestedObjective: String

    static func reviewedCapture(
        personID: String,
        relationshipContextID: String
    ) -> AgentSessionSeed {
        AgentSessionSeed(
            personID: personID,
            relationshipContextID: relationshipContextID,
            suggestedObjective:
                "What changed in this relationship, and what is the smallest safe next step?"
        )
    }

    static func meetingPreparation(
        personID: String,
        relationshipContextID: String,
        suggestedObjective: String
    ) -> AgentSessionSeed {
        AgentSessionSeed(
            personID: personID,
            relationshipContextID: relationshipContextID,
            suggestedObjective: suggestedObjective
        )
    }
}

enum AgentPreferredPersonScopeResolution: Equatable {
    case unavailable
    case exact
    case requiresSelection
}

enum AgentPreferredPersonScopePolicy {
    static func resolve(matchingScopeCount: Int) -> AgentPreferredPersonScopeResolution {
        switch matchingScopeCount {
        case 0:
            return .unavailable
        case 1:
            return .exact
        default:
            return .requiresSelection
        }
    }

}

struct AgentRelationshipRecallCandidate: Equatable, Identifiable {
    let person: WorkspacePerson
    let context: WorkspacePerson.Context
    let matchScore: Int
    let matchedPersonName: Bool
    let matchedContextName: Bool
    let matchedRecentSession: Bool

    var id: String { "\(person.id):\(context.id)" }
}

enum AgentLocalWorkspaceIntent: Equatable {
    case peopleCount
}

enum AgentLocalWorkspacePolicy {
    static func intent(for objective: String) -> AgentLocalWorkspaceIntent? {
        let normalized = objective
            .folding(
                options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
                locale: Locale(identifier: "en_US_POSIX")
            )
            .lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return nil }

        let countSignals = [
            "how many contacts", "contact count",
            "number of contacts", "多少个联系人", "多少联系人",
            "联系人数量", "有多少位联系人",
        ]
        return countSignals.contains(where: normalized.contains)
            ? .peopleCount
            : nil
    }
}

enum AgentRelationshipRecallPolicy {
    static func recentCandidatesForReview(
        people: [WorkspacePerson],
        recentSessions: [AgentSession]
    ) -> [AgentRelationshipRecallCandidate] {
        let sessionScopes = Set(
            recentSessions.prefix(12).compactMap { session -> String? in
                guard let personID = session.personID,
                      let contextID = session.relationshipContextID else {
                    return nil
                }
                return "\(personID):\(contextID)"
            }
        )
        return recentCandidates(
            people: people,
            sessionScopes: sessionScopes
        )
    }

    private static func recentCandidates(
        people: [WorkspacePerson],
        sessionScopes: Set<String>
    ) -> [AgentRelationshipRecallCandidate] {
        let flattened = people.flatMap { person in
            person.contexts.map { context in
                candidate(
                    person: person,
                    context: context,
                    score: sessionScopes.contains("\(person.id):\(context.id)")
                        ? 1
                        : 0,
                    personMatch: false,
                    contextMatch: false,
                    sessionMatch: sessionScopes.contains(
                        "\(person.id):\(context.id)"
                    )
                )
            }
        }
        return flattened.sorted { lhs, rhs in
            if lhs.matchedRecentSession != rhs.matchedRecentSession {
                return lhs.matchedRecentSession
            }
            if lhs.context.lastActivityAt != rhs.context.lastActivityAt {
                return lhs.context.lastActivityAt > rhs.context.lastActivityAt
            }
            return lhs.id < rhs.id
        }
    }

    private static func candidate(
        person: WorkspacePerson,
        context: WorkspacePerson.Context,
        score: Int,
        personMatch: Bool,
        contextMatch: Bool,
        sessionMatch: Bool
    ) -> AgentRelationshipRecallCandidate {
        AgentRelationshipRecallCandidate(
            person: person,
            context: context,
            matchScore: score,
            matchedPersonName: personMatch,
            matchedContextName: contextMatch,
            matchedRecentSession: sessionMatch
        )
    }

}

struct AgentSession: Identifiable, Equatable {
    let id: UUID
    var scope: AgentSessionScope
    var title: String
    var turns: [AgentSessionTurn]
    var contactReceipts: [AgentContactReceipt]
    var pendingObjective: String? = nil
    var pendingUnscopedChatIdempotencyKey: String? = nil
    var pendingImageConversation: PendingImageConversation? = nil
    var pendingPersonResearchIdempotencyKey: String? = nil
    var pendingPersonResearchRequestIdentity: String? = nil
    var updatedAt: Date
    var isUnread: Bool
    var originSessionID: UUID? = nil
    var originTurnID: UUID? = nil
    var originKind: String? = nil
    var screenshotTaskIDs: [String] = []
    var inheritedScreenshotTaskIDs: [String]? = nil
    var composerDraft: String? = nil
    var composerDraftUpdatedAt: Date? = nil
    var pendingScopedAskIdempotencyKey: String? = nil
    var pendingScopedAskRequestIdentity: String? = nil
    var pendingScreenshotIdempotencyKey: String? = nil
    var pendingScreenshotRequestIdentity: String? = nil
    var pendingScreenshotCapturedAt: Date? = nil
    var createdAt: Date? = nil
    var retentionExpiresAt: Date? = nil
    var contextWasTrimmed: Bool = false
    var backgroundCapturePendingAdmission: Bool = false

    var readOnlyScreenshotTaskIDs: Set<String> {
        Set(inheritedScreenshotTaskIDs ?? (originSessionID == nil ? [] : screenshotTaskIDs))
    }

    var ownedScreenshotTaskIDs: [String] {
        screenshotTaskIDs.filter { !readOnlyScreenshotTaskIDs.contains($0) }
    }

    static let retentionInterval: TimeInterval = 30 * 24 * 60 * 60

    var originalCreatedAt: Date {
        createdAt ?? ([updatedAt] + turns.map(\.createdAt) + contactReceipts.map(\.createdAt)).min() ?? updatedAt
    }

    var retentionDeadline: Date {
        min(originalCreatedAt.addingTimeInterval(Self.retentionInterval), retentionExpiresAt ?? .distantFuture)
    }

    var personID: String? { scope.personID }
    var relationshipContextID: String? { scope.relationshipContextID }
    var personDisplayLabel: String { scope.personDisplayLabel }
    var contextDisplayLabel: String { scope.contextDisplayLabel }
    var resolutionCaseID: String? { scope.resolutionCaseID }

    var isIdentityReview: Bool {
        if case .identityReview = scope { return true }
        return false
    }

    var isUnresolvedIntent: Bool {
        if case .unresolvedIntent = scope { return true }
        return false
    }

    var hasPendingPersonResearch: Bool {
        pendingPersonResearchIdempotencyKey != nil
            && pendingPersonResearchRequestIdentity != nil
    }

    var hasPendingScreenshotAdmission: Bool {
        pendingScreenshotIdempotencyKey != nil
    }

    var hasPendingUnscopedChat: Bool {
        pendingUnscopedChatIdempotencyKey != nil
    }

    var retrievalAttention: AgentSessionRetrievalAttention? {
        if let pendingObjective,
           !pendingObjective.trimmingCharacters(
                in: .whitespacesAndNewlines
           ).isEmpty {
            return .waitingToContinue
        }

        let latestTurn = turns.max { $0.createdAt < $1.createdAt }
        let latestReceipt = contactReceipts.max { $0.createdAt < $1.createdAt }
        if let latestReceipt,
           latestTurn.map({ latestReceipt.createdAt >= $0.createdAt }) ?? true {
            if latestReceipt.requiresRefresh { return .refreshNeeded }
            if latestReceipt.outcome == .identityReview { return .needsJudgment }
            return nil
        }

        if let latestTurn {
            if latestTurn.requiresRefresh { return .refreshNeeded }
            if latestTurn.response.blocks.contains(where: \.requiresUserDecision) {
                return .needsJudgment
            }
        }

        return isIdentityReview ? .needsJudgment : nil
    }

    var latestPreview: String {
        let latestTurn = turns.max { $0.createdAt < $1.createdAt }
        let latestReceipt = contactReceipts.max { $0.createdAt < $1.createdAt }
        if let latestReceipt {
            if let latestTurn {
                if latestReceipt.createdAt >= latestTurn.createdAt {
                    return latestReceipt.compactPreview
                }
            } else {
                return latestReceipt.compactPreview
            }
        }
        guard let turn = latestTurn else {
            if let pendingObjective,
               !pendingObjective.trimmingCharacters(
                    in: .whitespacesAndNewlines
               ).isEmpty {
                return "Waiting to continue · \(pendingObjective)"
            }
            return isUnresolvedIntent
                ? "Finding the relevant relationship."
                : "No Agent response has been recorded in this session."
        }
        let preview = turn.response.blocks.first?.body
            ?? "No Agent response has been recorded in this session."
        return turn.requiresRefresh ? "Needs refresh · \(preview)" : preview
    }

    func displayTitle(in language: AppLanguage) -> String {
        guard let receipt = contactReceipts.max(by: {
            $0.createdAt < $1.createdAt
        }) else { return title }
        let key: String
        switch receipt.outcome {
        case .createdPerson:
            key = "Added %@"
        case .matchedExisting:
            key = "Updated %@"
        case .identityReview:
            key = "Review %@’s identity"
        }
        return String(
            format: language.text(key),
            locale: language.locale,
            receipt.personDisplayLabel
        )
    }

    func displayContextLabel(in language: AppLanguage) -> String {
        if isUnresolvedIntent {
            if turns.contains(where: { turn in
                turn.response.blocks.contains { $0.kind == "person_research" }
            }) {
                return language.text("Public profile research")
            }
            if turns.contains(where: {
                $0.response.contextManifestID == "none-unbound-conversation"
            }) {
                return language.text("Agent conversation")
            }
            return language.text("Finding relationship")
        }
        return isIdentityReview
            ? language.text("Identity review")
            : contextDisplayLabel
    }

    func latestPreview(in language: AppLanguage) -> String {
        let latestTurn = turns.max { $0.createdAt < $1.createdAt }
        let latestReceipt = contactReceipts.max { $0.createdAt < $1.createdAt }
        guard let latestReceipt else { return latestPreview }
        if let latestTurn, latestReceipt.createdAt < latestTurn.createdAt {
            return latestPreview
        }
        return latestReceipt.compactPreview(in: language)
    }

    func retrievalSubtitle(in language: AppLanguage) -> String {
        let latestTurn = turns.max { $0.createdAt < $1.createdAt }
        let latestReceipt = contactReceipts.max { $0.createdAt < $1.createdAt }
        if let latestReceipt,
           latestTurn.map({ latestReceipt.createdAt >= $0.createdAt }) ?? true {
            let result: String
            switch latestReceipt.outcome {
            case .createdPerson:
                result = language.text("Contact created")
            case .matchedExisting:
                result = language.text("Contact updated")
            case .identityReview:
                result = language.text("Identity needs review")
            }
            return latestReceipt.requiresRefresh
                ? "\(result) · \(language.text("Refresh needed"))"
                : result
        }

        if let pendingObjective,
           !pendingObjective.trimmingCharacters(
                in: .whitespacesAndNewlines
           ).isEmpty {
            return "\(personDisplayLabel) · \(language.text("Waiting to continue"))"
        }

        if latestTurn?.requiresRefresh == true {
            return "\(personDisplayLabel) · \(language.text("Refresh needed"))"
        }

        if isIdentityReview {
            return language.text("Identity needs review")
        }
        if isUnresolvedIntent {
            return language.text("No person linked")
        }
        return personDisplayLabel
    }
}

enum AgentSessionRetrievalAttention: Equatable {
    case needsJudgment
    case waitingToContinue
    case refreshNeeded
}

struct AgentSessionValidationTarget: Equatable {
    let taskID: String
    let personID: String
    let relationshipContextID: String
    let response: RelationshipAskResponse
}

struct AgentSessionDraft: Codable, Equatable {
    let personID: String
    let relationshipContextID: String
    var text: String
    var updatedAt: Date
    var pendingIdempotencyKey: String?
    var requestIdentity: String? = nil
}

struct AgentGlobalDraft: Codable, Equatable {
    var text: String
    var updatedAt: Date
}

struct AgentEvidenceReviewOperation: Codable, Equatable, Identifiable {
    enum State: String, Codable, Equatable {
        case pending
        case outcomeUnknown = "outcome_unknown"
        case failed
        case superseded
        case applied
    }

    let idempotencyKey: String
    let taskID: String
    let fragmentID: String
    let resourceID: String
    let sourceName: String
    let personID: String
    let personDisplayName: String
    let relationshipContextID: String
    let relationshipContextDisplayName: String
    let expectedReviewStatus: String
    let authorityReviewID: String?
    let decision: String
    let reason: String
    var resultingReviewID: String?
    var canonicalDecidedAt: String?
    var state: State
    var statusMessage: String?
    var updatedAt: Date
    var pendingAskSessionID: UUID? = nil
    var pendingAskKey: String? = nil

    var id: String { idempotencyKey }
}

enum AgentEvidenceReviewIntent {
    static func idempotencyKey(
        fragmentID: String,
        expectedReviewStatus: String,
        authorityToken: String,
        decision: String,
        reason: String
    ) -> String {
        let material = [
            fragmentID,
            expectedReviewStatus,
            authorityToken,
            decision,
            reason.trimmingCharacters(in: .whitespacesAndNewlines),
        ].joined(separator: "|")
        let digest = SHA256.hash(data: Data(material.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return "ios:evidence-review:\(digest)"
    }
}

protocol AgentSessionPersisting {
    func load() throws -> Data?
    func save(_ data: Data) throws
    func deletionPending() throws -> Bool
    func beginDeletion() throws
    func completeDeletion() throws
}

final class FileAgentSessionPersistence: AgentSessionPersisting {
    private let fileURL: URL
    private let deletionTombstoneURL: URL
    private let migrationError: Error?
    private let captureScope: String
    private let captureDenials: CaptureSessionDenyStore
    private var deletionGeneration: Int?

    init(accountID: String, rootURL: URL? = nil, legacyAccountID: String? = nil) {
        captureScope = accountID; captureDenials = CaptureSessionDenyStore(rootURL: rootURL)
        let digest = SHA256.hash(data: Data(accountID.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        let root = rootURL ?? FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        fileURL = root
            .appending(path: "TalentSignal/AgentSessions", directoryHint: .isDirectory)
            .appending(path: "\(digest).json")
        deletionTombstoneURL = fileURL.appendingPathExtension("deletion-pending")
        do {
            try RuntimeLegacyBindings.migrateFile(legacyAccountID: legacyAccountID, scope: accountID,
                directory: fileURL.deletingLastPathComponent(), destination: fileURL)
            migrationError = nil
        } catch { migrationError = error }
    }

    func load() throws -> Data? {
        if let migrationError { throw migrationError }
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return nil
        }
        return try Data(contentsOf: fileURL)
    }

    func save(_ data: Data) throws {
        if let migrationError { throw migrationError }
        let envelope = try JSONDecoder.agentSession.decode(PersistedAgentSessionEnvelope.self, from: data)
        guard (1...8).contains(envelope.version) else { throw AppSessionEndingError.unreadable }
        let keys = Array(envelope.syncTombstones?.keys ?? Dictionary<String, Int>().keys)
        let ids = keys.compactMap { UUID(uuidString: $0) }
        guard ids.count == keys.count else { throw AppSessionEndingError.unreadable }
        try captureDenials.deny(scope: captureScope, sessionIDs: ids)
        try writeProtected(data, to: fileURL)
    }

    func deletionPending() throws -> Bool {
        if let migrationError { throw migrationError }
        return try captureDenials.pendingEpoch(scope: captureScope) != nil || FileManager.default.fileExists(atPath: deletionTombstoneURL.path)
    }

    func beginDeletion() throws {
        if let migrationError { throw migrationError }
        let epoch = try captureDenials.beginDeletion(scope: captureScope)
        deletionGeneration = epoch
        try writeProtected(JSONEncoder().encode(epoch), to: deletionTombstoneURL)
    }

    func completeDeletion() throws {
        if let migrationError { throw migrationError }
        let pending = try captureDenials.pendingEpoch(scope: captureScope)
        let marker = FileManager.default.fileExists(atPath: deletionTombstoneURL.path)
            ? try Data(contentsOf: deletionTombstoneURL) : nil
        let markerEpoch = marker.flatMap { try? JSONDecoder().decode(Int.self, from: $0) }
        var epoch = deletionGeneration ?? markerEpoch ?? pending
        if epoch == nil {
            // A pre-capture legacy deletion marker is adopted while unlocked.
            guard marker == Data("pending".utf8) else { throw AgentSessionPersistenceError.deletionCouldNotBeVerified }
            try beginDeletion(); epoch = deletionGeneration
        }
        guard let epoch else { throw AgentSessionPersistenceError.deletionCouldNotBeVerified }
        try captureDenials.completeDeletion(scope: captureScope, epoch: epoch) {
            if let markerEpoch, markerEpoch != epoch { throw AgentSessionPersistenceError.deletionCouldNotBeVerified }
            if FileManager.default.fileExists(atPath: fileURL.path) { try FileManager.default.removeItem(at: fileURL) }
            guard !FileManager.default.fileExists(atPath: fileURL.path) else { throw AgentSessionPersistenceError.deletionCouldNotBeVerified }
            if FileManager.default.fileExists(atPath: deletionTombstoneURL.path) { try FileManager.default.removeItem(at: deletionTombstoneURL) }
            let descriptor = open(fileURL.deletingLastPathComponent().path, O_RDONLY)
            guard descriptor >= 0 else { throw AgentSessionPersistenceError.deletionCouldNotBeVerified }
            let result = fsync(descriptor); close(descriptor)
            guard result == 0 else { throw AgentSessionPersistenceError.deletionCouldNotBeVerified }
        }
        deletionGeneration = nil
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

struct PersistedAgentSessionEnvelope: Codable {
    let version: Int
    let sessions: [PersistedAgentSession]
    let drafts: [AgentSessionDraft]
    let globalDraft: AgentGlobalDraft?
    let evidenceReviews: [AgentEvidenceReviewOperation]?
    let contactProposal: AgentContactProposalDraft?
    var contactProposals: [AgentContactProposalDraft]? = nil
    var syncRevisions: [String: Int]? = nil
    var syncTombstones: [String: Int]? = nil
    var syncDigests: [String: String]? = nil
    var retiredContactProposalIntentHashes: [String]? = nil
}

struct AgentContactProposalDraft: Codable, Equatable {
    let draft: ConversationContactDraft
    let idempotencyKey: String
    let capturedAt: Date?
    let pendingTarget: ConversationContactTarget?
    let pendingConfirmIdentityClue: Bool?
    var updatedAt: Date
    var sessionID: UUID? = nil
    var sourceMessageID: UUID? = nil
    var sourceText: String? = nil
    var expiresAt: Date? = nil
    var status: Status? = nil

    enum Status: String, Codable, Equatable {
        case proposed, declined, expired, completed
    }

    var isActive: Bool { status == nil || status == .proposed }
}

struct PersistedAgentSession: Codable {
    let id: UUID
    let scopeKind: String?
    let personID: String?
    let relationshipContextID: String?
    let identityResolutionCaseID: String?
    let personDisplayLabel: String
    let contextDisplayLabel: String
    let title: String
    let turns: [PersistedAgentSessionTurn]
    let contactReceipts: [PersistedAgentContactReceipt]?
    var pendingObjective: String?
    let pendingUnscopedChatIdempotencyKey: String?
    let pendingPersonResearchIdempotencyKey: String?
    let pendingPersonResearchRequestIdentity: String?
    let updatedAt: Date
    let isUnread: Bool
    var originSessionID: UUID? = nil
    var originTurnID: UUID? = nil
    var originKind: String? = nil
    var contactProposal: AgentContactProposalDraft? = nil
    var screenshotTaskIDs: [String]? = nil
    var inheritedScreenshotTaskIDs: [String]? = nil
    var composerDraft: String? = nil
    var composerDraftUpdatedAt: Date? = nil
    var pendingScopedAskIdempotencyKey: String? = nil
    var pendingScopedAskRequestIdentity: String? = nil
    var pendingScreenshotIdempotencyKey: String? = nil
    var pendingScreenshotRequestIdentity: String? = nil
    var pendingScreenshotCapturedAt: Date? = nil
    var createdAt: Date? = nil
    var retentionExpiresAt: Date? = nil
    var contextWasTrimmed: Bool? = nil
    var backgroundCapturePendingAdmission: Bool? = nil
    var pendingImageConversation: PendingImageConversation? = nil

    init(_ value: AgentSession) {
        id = value.id
        scopeKind = value.isUnresolvedIntent
            ? "unresolved_intent"
            : value.isIdentityReview ? "identity_review" : "relationship"
        personID = value.personID
        relationshipContextID = value.relationshipContextID
        identityResolutionCaseID = value.resolutionCaseID
        personDisplayLabel = value.personDisplayLabel
        contextDisplayLabel = value.contextDisplayLabel
        title = value.title
        turns = value.turns.map(PersistedAgentSessionTurn.init)
        contactReceipts = value.contactReceipts.map(PersistedAgentContactReceipt.init)
        pendingObjective = value.pendingObjective
        pendingUnscopedChatIdempotencyKey = value.pendingUnscopedChatIdempotencyKey
        pendingImageConversation = value.pendingImageConversation
        pendingPersonResearchIdempotencyKey = value.pendingPersonResearchIdempotencyKey
        pendingPersonResearchRequestIdentity = value.pendingPersonResearchRequestIdentity
        updatedAt = value.updatedAt
        isUnread = value.isUnread
        originSessionID = value.originSessionID
        originTurnID = value.originTurnID
        originKind = value.originKind
        screenshotTaskIDs = value.screenshotTaskIDs
        inheritedScreenshotTaskIDs = value.inheritedScreenshotTaskIDs
        composerDraft = value.composerDraft
        composerDraftUpdatedAt = value.composerDraftUpdatedAt
        pendingScopedAskIdempotencyKey = value.pendingScopedAskIdempotencyKey
        pendingScopedAskRequestIdentity = value.pendingScopedAskRequestIdentity
        pendingScreenshotIdempotencyKey = value.pendingScreenshotIdempotencyKey
        pendingScreenshotRequestIdentity = value.pendingScreenshotRequestIdentity
        pendingScreenshotCapturedAt = value.pendingScreenshotCapturedAt
        createdAt = value.originalCreatedAt
        retentionExpiresAt = value.retentionExpiresAt
        contextWasTrimmed = value.contextWasTrimmed ? true : nil
        backgroundCapturePendingAdmission = value.backgroundCapturePendingAdmission ? true : nil
    }

    func value() throws -> AgentSession {
        let scope: AgentSessionScope
        if scopeKind == "unresolved_intent" {
            scope = .unresolvedIntent
        } else if scopeKind == "identity_review" {
            guard let identityResolutionCaseID else {
                throw AgentSessionPersistenceError.invalidSessionScope
            }
            scope = .identityReview(
                resolutionCaseID: identityResolutionCaseID,
                personDisplayLabel: personDisplayLabel
            )
        } else {
            guard let personID, let relationshipContextID else {
                throw AgentSessionPersistenceError.invalidSessionScope
            }
            scope = .relationship(
                personID: personID,
                relationshipContextID: relationshipContextID,
                personDisplayLabel: personDisplayLabel,
                contextDisplayLabel: contextDisplayLabel
            )
        }
        return AgentSession(
            id: id,
            scope: scope,
            title: title,
            turns: turns.map(\.value),
            contactReceipts: (contactReceipts ?? []).map(\.value),
            pendingObjective: pendingObjective,
            pendingUnscopedChatIdempotencyKey: pendingUnscopedChatIdempotencyKey,
            pendingImageConversation: pendingImageConversation,
            pendingPersonResearchIdempotencyKey: pendingPersonResearchIdempotencyKey,
            pendingPersonResearchRequestIdentity: pendingPersonResearchRequestIdentity,
            updatedAt: updatedAt,
            isUnread: isUnread,
            originSessionID: originSessionID,
            originTurnID: originTurnID,
            originKind: originKind,
            screenshotTaskIDs: screenshotTaskIDs ?? [],
            inheritedScreenshotTaskIDs: inheritedScreenshotTaskIDs ?? (originSessionID == nil ? nil : screenshotTaskIDs ?? []),
            composerDraft: composerDraft,
            composerDraftUpdatedAt: composerDraftUpdatedAt,
            pendingScopedAskIdempotencyKey: pendingScopedAskIdempotencyKey,
            pendingScopedAskRequestIdentity: pendingScopedAskRequestIdentity,
            pendingScreenshotIdempotencyKey: pendingScreenshotIdempotencyKey,
            pendingScreenshotRequestIdentity: pendingScreenshotRequestIdentity,
            pendingScreenshotCapturedAt: pendingScreenshotCapturedAt,
            createdAt: createdAt ?? ([updatedAt] + turns.map(\.createdAt) + (contactReceipts ?? []).map(\.createdAt)).min(),
            retentionExpiresAt: retentionExpiresAt,
            contextWasTrimmed: contextWasTrimmed ?? false,
            backgroundCapturePendingAdmission: backgroundCapturePendingAdmission ?? false
        )
    }
}

struct PersistedAgentContactReceipt: Codable {
    let id: UUID
    let operationKey: String
    let outcome: AgentContactReceipt.Outcome
    let captureID: String
    let resourceID: String
    let duplicateOfResourceID: String?
    let personID: String?
    let relationshipContextID: String?
    let resolutionCaseID: String?
    let personDisplayLabel: String
    let contextDisplayLabel: String?
    let createdAt: Date

    init(_ value: AgentContactReceipt) {
        id = value.id
        operationKey = value.operationKey
        outcome = value.outcome
        captureID = value.captureID
        resourceID = value.resourceID
        duplicateOfResourceID = value.duplicateOfResourceID
        personID = value.personID
        relationshipContextID = value.relationshipContextID
        resolutionCaseID = value.resolutionCaseID
        personDisplayLabel = value.personDisplayLabel
        contextDisplayLabel = value.contextDisplayLabel
        createdAt = value.createdAt
    }

    var value: AgentContactReceipt {
        AgentContactReceipt(
            id: id,
            operationKey: operationKey,
            outcome: outcome,
            captureID: captureID,
            resourceID: resourceID,
            duplicateOfResourceID: duplicateOfResourceID,
            personID: personID,
            relationshipContextID: relationshipContextID,
            resolutionCaseID: resolutionCaseID,
            personDisplayLabel: personDisplayLabel,
            contextDisplayLabel: contextDisplayLabel,
            createdAt: createdAt,
            requiresRefresh: true
        )
    }
}

struct PersistedAgentSessionTurn: Codable {
    let id: UUID
    let objective: String
    let response: PersistedRelationshipAskResponse
    let createdAt: Date
    var feedback: AgentSessionFeedback? = nil
    var feedbackUpdatedAt: Date? = nil
    var images: [ConversationImageManifest] = []
    // Keep the server's immutable response shape, including nulls and host-only
    // provenance. Display projection is read-only; it is never re-encoded as fact.
    var canonicalWire: JSONValue? = nil

    enum CodingKeys: String, CodingKey {
        case id, objective, response, createdAt, feedback, feedbackUpdatedAt, images
    }

    init(_ value: AgentSessionTurn) {
        id = value.id; objective = value.objective
        response = PersistedRelationshipAskResponse(value.response,
            requireExistingShareClassification: value.requiresRefresh)
        createdAt = value.createdAt; feedback = value.feedback
        feedbackUpdatedAt = value.feedbackUpdatedAt
        images = value.images; canonicalWire = value.canonicalWire
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        objective = try c.decode(String.self, forKey: .objective)
        response = try c.decode(PersistedRelationshipAskResponse.self, forKey: .response)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        feedback = try c.decodeIfPresent(AgentSessionFeedback.self, forKey: .feedback)
        feedbackUpdatedAt = try c.decodeIfPresent(Date.self, forKey: .feedbackUpdatedAt)
        images = try c.decodeIfPresent([ConversationImageManifest].self, forKey: .images) ?? []
        let raw = try JSONValue(from: decoder)
        if case let .object(turn) = raw, case let .object(reply)? = turn["response"],
           reply["execution"] != nil || (reply["contextManifestID"] == .string("")
               && reply["unboundConversationBlocks"] != nil) {
            canonicalWire = raw
        }
    }

    func encode(to encoder: Encoder) throws {
        if case var .object(wire)? = canonicalWire {
            wire["feedback"] = feedback.map { .string($0.rawValue) }
            if let feedbackUpdatedAt {
                wire["feedbackUpdatedAt"] = try JSONDecoder().decode(JSONValue.self,
                    from: JSONEncoder.agentSession.encode(feedbackUpdatedAt))
            } else { wire.removeValue(forKey: "feedbackUpdatedAt") }
            try JSONValue.object(wire).encode(to: encoder)
            return
        }
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(objective, forKey: .objective)
        try c.encode(response, forKey: .response); try c.encode(createdAt, forKey: .createdAt)
        try c.encodeIfPresent(feedback, forKey: .feedback)
        try c.encodeIfPresent(feedbackUpdatedAt, forKey: .feedbackUpdatedAt)
        if !images.isEmpty { try c.encode(images, forKey: .images) }
    }

    var value: AgentSessionTurn {
        AgentSessionTurn(id: id, objective: objective, response: response.value,
            createdAt: createdAt, requiresRefresh: true, feedback: feedback,
            feedbackUpdatedAt: feedbackUpdatedAt, images: images, canonicalWire: canonicalWire)
    }
}

struct PersistedRelationshipAskResponse: Codable {
    let contractVersion: String
    let taskID: String
    let contextManifestID: String
    let knowledgeSnapshotID: String
    let disposition: String
    let unboundPersonResearchBlocks: [RelationshipAskResponse.Block]?
    let unboundConversationBlocks: [RelationshipAskResponse.Block]?
    let media: [ChatMediaAsset]?
    let createdAt: String
    let labFeatureReceipt: LabFeatureAdoptionReceipt?
    var savedBlocks: [RelationshipAskResponse.Block]? = nil
    var memoryProposal: ConversationMemoryProposalReference? = nil

    init(
        _ value: RelationshipAskResponse,
        requireExistingShareClassification: Bool = false
    ) {
        let isRetracted = value.blocks.count == 1
            && value.blocks.first?.kind == "continuity"
            && value.blocks.first?.id == "restored-\(value.taskID)"
        contractVersion = value.contractVersion
        taskID = value.taskID
        contextManifestID = value.contextManifestID
        knowledgeSnapshotID = value.knowledgeSnapshotID
        disposition = value.disposition
        unboundPersonResearchBlocks = value.contextManifestID
            == "none-unbound-person-research" && !isRetracted
            ? value.blocks.map {
                AgentSessionContextPolicy.readOnlyBlock(
                    $0,
                    requireExistingShareClassification: requireExistingShareClassification
                )
            }
            : nil
        unboundConversationBlocks = value.contextManifestID
            == "none-unbound-conversation" && !isRetracted
            ? value.blocks.map {
                AgentSessionContextPolicy.readOnlyBlock(
                    $0,
                    requireExistingShareClassification: requireExistingShareClassification
                )
            }
            : nil
        media = isRetracted ? nil : value.media
        createdAt = value.createdAt
        labFeatureReceipt = value.labFeatureReceipt
        memoryProposal = isRetracted ? nil : value.memoryProposal
        savedBlocks = isRetracted ? nil : value.blocks.map {
            AgentSessionContextPolicy.readOnlyBlock(
                $0,
                requireExistingShareClassification: requireExistingShareClassification
            )
        }
    }

    var value: RelationshipAskResponse {
        RelationshipAskResponse(
            contractVersion: contractVersion,
            taskID: taskID,
            contextManifestID: contextManifestID,
            knowledgeSnapshotID: knowledgeSnapshotID,
            disposition: disposition,
            blocks: savedBlocks ?? unboundPersonResearchBlocks ?? unboundConversationBlocks ?? [
                .init(
                    id: "restored-\(taskID)",
                    kind: "continuity",
                    title: "Saved response needs refresh",
                    body: "Ask again to read current evidence.",
                    status: "needs_review",
                    citationDependencyIDs: [],
                    requiresUserDecision: false
                ),
            ],
            media: media ?? [],
            createdAt: createdAt,
            citations: [],
            labFeatureReceipt: labFeatureReceipt,
            memoryProposal: memoryProposal?.isValid == true ? memoryProposal : nil
        )
    }
}

@MainActor
final class AgentSessionStore: ObservableObject {
    private static let sessionRetention = AgentSession.retentionInterval
    private static let draftRetention: TimeInterval = 7 * 24 * 60 * 60

    private static func stableContactCaptureDate(_ date: Date) -> Date {
        Date(timeIntervalSince1970: date.timeIntervalSince1970.rounded())
    }
    @Published private var storedSessions: [AgentSession]
    @Published private var storedEvidenceReviews: [AgentEvidenceReviewOperation]
    @Published private(set) var activeEvidenceReviewKeys: Set<String>
    @Published private(set) var transientSupersededEvidenceReviewKeys: Set<String>
    @Published private(set) var evidenceReviewAuthorityReadbackKeys: Set<String>
    @Published private(set) var persistenceNotice: String?
    @Published private(set) var syncNotice: String?
    @Published private(set) var isSynchronizing = false
    @Published private(set) var sessionSyncNotices: [UUID: String] = [:]
    private var hasGlobalSyncFailure = false
    private var syncGeneration = UUID()
    private var synchronizationScopeActive = true
    private var synchronizationScopeIsCurrent: () -> Bool = { true }
    private var drafts: [AgentSessionDraft]
    private var storedGlobalDraft: AgentGlobalDraft?
    private var storedContactProposals: [AgentContactProposalDraft] = []
    private var retiredContactProposalIntentHashes = Set<String>()
    private var syncRevisions: [String: Int] = [:]
    private var syncTombstones: [String: Int] = [:]
    private var syncDigests: [String: String] = [:]
    private let persistence: AgentSessionPersisting?
    private let now: () -> Date
    private var expirationTask: Task<Void, Never>?

    init(
        sessions: [AgentSession] = [],
        persistence: AgentSessionPersisting? = nil,
        now: @escaping () -> Date = Date.init
    ) {
        self.persistence = persistence
        self.now = now
        expirationTask = nil
        persistenceNotice = nil
        drafts = []
        storedGlobalDraft = nil
        storedContactProposals = []
        activeEvidenceReviewKeys = []
        transientSupersededEvidenceReviewKeys = []
        evidenceReviewAuthorityReadbackKeys = []
        storedEvidenceReviews = []
        storedSessions = sessions.map { session in
            var restored = session
            restored.createdAt = session.originalCreatedAt
            if session.originSessionID != nil, session.inheritedScreenshotTaskIDs == nil {
                restored.inheritedScreenshotTaskIDs = session.screenshotTaskIDs
            }
            return restored
        }.sorted { $0.updatedAt > $1.updatedAt }
        defer { scheduleNextExpiration() }
        guard sessions.isEmpty, let persistence else { return }
        do {
            if try persistence.deletionPending() {
                do {
                    try persistence.completeDeletion()
                } catch {
                    persistenceNotice = "Saved Agent sessions are pending deletion and remain unavailable."
                }
                return
            }
            guard let data = try persistence.load() else { return }
            let envelope = try JSONDecoder.agentSession.decode(
                PersistedAgentSessionEnvelope.self,
                from: data
            )
            guard [1, 2, 3, 4, 5, 6, 7, 8].contains(envelope.version) else {
                throw AgentSessionPersistenceError.unsupportedVersion
            }
            storedSessions = try envelope.sessions
                .map { try $0.value() }
                .sorted { $0.updatedAt > $1.updatedAt }
            drafts = envelope.drafts
            storedGlobalDraft = envelope.globalDraft
            storedContactProposals = envelope.contactProposals
                ?? envelope.contactProposal.map { [$0] } ?? []
            syncRevisions = envelope.syncRevisions ?? [:]
            syncTombstones = envelope.syncTombstones ?? [:]
            syncDigests = envelope.syncDigests ?? [:]
            retiredContactProposalIntentHashes = Set(envelope.retiredContactProposalIntentHashes ?? [])
            storedEvidenceReviews = envelope.evidenceReviews ?? []
            evidenceReviewAuthorityReadbackKeys = Set(
                storedEvidenceReviews.lazy
                    .filter {
                        [.pending, .outcomeUnknown, .failed].contains($0.state)
                    }
                    .map(\.idempotencyKey)
            )
            persist()
        } catch {
            storedSessions = []
            drafts = []
            storedGlobalDraft = nil
            storedContactProposals = []
            storedEvidenceReviews = []
            evidenceReviewAuthorityReadbackKeys = []
            persistenceNotice = "Saved Agent sessions could not be restored on this device."
        }
    }

    var sessions: [AgentSession] {
        pruneExpired()
        return storedSessions
    }

    var unreadSessions: [AgentSession] {
        pruneExpired()
        return storedSessions.filter(\.isUnread)
    }

    func session(id: UUID?) -> AgentSession? {
        pruneExpired()
        guard let id else { return nil }
        return storedSessions.first { $0.id == id }
    }

    /// Import only a protected capture placeholder. A current in-memory or
    /// canonical Session always wins over its initial capture snapshot.
    func importBackgroundCapture(_ payload: PersistedAgentSession) {
        guard !storedSessions.contains(where: { $0.id == payload.id }),
              syncTombstones[payload.id.uuidString.lowercased()] == nil,
              let session = try? payload.value(), session.retentionDeadline > now() else { return }
        storedSessions.append(session)
        sortSessions()
        if !persist() { storedSessions.removeAll { $0.id == payload.id } }
    }

    @discardableResult
    func beginUnscopedSession(
        objective: String,
        id: UUID = UUID(),
        createdAt: Date? = nil
    ) -> UUID? {
        _ = pruneExpiredState()
        let session = AgentSession(
            id: id,
            scope: .unresolvedIntent,
            title: Self.sessionTitle(from: objective),
            turns: [],
            contactReceipts: [],
            pendingObjective: objective,
            updatedAt: createdAt ?? now(),
            isUnread: false,
            createdAt: createdAt ?? now()
        )
        let priorSessions = storedSessions
        storedSessions.append(session)
        sortSessions()
        guard persist() else {
            storedSessions = priorSessions
            scheduleNextExpiration()
            return nil
        }
        return session.id
    }

    func beginUnscopedPersonResearch(
        sessionID: UUID,
        objective: String,
        requestIdentity: String,
        proposedIdempotencyKey: String
    ) -> String? {
        _ = pruneExpiredState()
        guard let index = storedSessions.firstIndex(where: {
            $0.id == sessionID && $0.isUnresolvedIntent
        }), !storedSessions[index].hasPendingScreenshotAdmission else { return nil }
        if storedSessions[index].pendingObjective == objective,
           storedSessions[index].pendingPersonResearchRequestIdentity == requestIdentity,
           let pending = storedSessions[index]
                .pendingPersonResearchIdempotencyKey {
            return pending
        }
        let prior = storedSessions[index]
        storedSessions[index].pendingObjective = objective
        storedSessions[index].pendingUnscopedChatIdempotencyKey = nil
        storedSessions[index].pendingPersonResearchIdempotencyKey = proposedIdempotencyKey
        storedSessions[index].pendingPersonResearchRequestIdentity = requestIdentity
        storedSessions[index].updatedAt = now()
        guard persist() else {
            storedSessions[index] = prior
            scheduleNextExpiration()
            return nil
        }
        return proposedIdempotencyKey
    }

    func beginUnscopedChat(
        sessionID: UUID,
        objective: String,
        proposedIdempotencyKey: String
    ) -> String? {
        _ = pruneExpiredState()
        guard let index = storedSessions.firstIndex(where: {
            $0.id == sessionID && $0.isUnresolvedIntent
        }), !storedSessions[index].hasPendingScreenshotAdmission else { return nil }
        if storedSessions[index].pendingObjective == objective,
           let pending = storedSessions[index]
                .pendingUnscopedChatIdempotencyKey {
            return pending
        }
        let prior = storedSessions[index]
        storedSessions[index].pendingObjective = objective
        storedSessions[index].pendingUnscopedChatIdempotencyKey = proposedIdempotencyKey
        storedSessions[index].pendingPersonResearchIdempotencyKey = nil
        storedSessions[index].pendingPersonResearchRequestIdentity = nil
        storedSessions[index].updatedAt = now()
        guard persist() else {
            storedSessions[index] = prior
            scheduleNextExpiration()
            return nil
        }
        return proposedIdempotencyKey
    }

    @discardableResult
    func recordUnscopedPersonResearch(
        sessionID: UUID,
        objective: String,
        response: RelationshipAskResponse,
        createdAt: Date = Date()
    ) -> Bool {
        recordUnscopedResponse(
            sessionID: sessionID,
            objective: objective,
            response: response,
            createdAt: createdAt
        )
    }

    @discardableResult
    func recordUnscopedChat(
        sessionID: UUID,
        objective: String,
        response: RelationshipAskResponse,
        createdAt: Date = Date()
    ) -> Bool {
        recordUnscopedResponse(
            sessionID: sessionID,
            objective: objective,
            response: response,
            createdAt: createdAt
        )
    }

    private func recordUnscopedResponse(
        sessionID: UUID,
        objective: String,
        response: RelationshipAskResponse,
        createdAt: Date
    ) -> Bool {
        _ = pruneExpiredState()
        guard let index = storedSessions.firstIndex(where: {
            $0.id == sessionID && $0.isUnresolvedIntent
        }) else { return false }
        if storedSessions[index].turns.contains(where: { $0.response.taskID == response.taskID }) { return true }
        let prior = storedSessions[index]
        let sourceMessageID = storedSessions[index].pendingUnscopedChatIdempotencyKey
            .flatMap { UUID(uuidString: String($0.split(separator: ":").last ?? "")) }
        if storedSessions[index].turns.isEmpty,
           let proposedTitle = response.sessionTitle,
           let title = Self.canonicalSessionTitle(from: proposedTitle) {
            storedSessions[index].title = title
        }
        storedSessions[index].turns.append(
            AgentSessionTurn(
                id: sourceMessageID ?? UUID(),
                objective: objective,
                response: response,
                createdAt: createdAt,
                requiresRefresh: false
            )
        )
        storedSessions[index].pendingObjective = nil
        storedSessions[index].pendingUnscopedChatIdempotencyKey = nil
        storedSessions[index].pendingPersonResearchIdempotencyKey = nil
        storedSessions[index].pendingPersonResearchRequestIdentity = nil
        storedSessions[index].updatedAt = createdAt
        storedSessions[index].isUnread = false
        sortSessions()
        guard persist() else {
            if let rollbackIndex = storedSessions.firstIndex(where: {
                $0.id == sessionID
            }) {
                storedSessions[rollbackIndex] = prior
                sortSessions()
            }
            scheduleNextExpiration()
            return false
        }
        return true
    }

    @discardableResult
    func bindUnscopedSession(
        id: UUID,
        person: WorkspacePerson,
        context: WorkspacePerson.Context
    ) -> Bool {
        _ = pruneExpiredState()
        guard let index = storedSessions.firstIndex(where: { $0.id == id }),
              storedSessions[index].turns.allSatisfy({
                  $0.response.contextManifestID == "none-unbound-conversation"
              }),
              storedSessions[index].contactReceipts.isEmpty else {
            return false
        }
        let prior = storedSessions[index]
        storedSessions[index].scope = .relationship(
            personID: person.id,
            relationshipContextID: context.id,
            personDisplayLabel: person.displayLabel,
            contextDisplayLabel: context.displayLabel
        )
        storedSessions[index].pendingPersonResearchIdempotencyKey = nil
        storedSessions[index].pendingPersonResearchRequestIdentity = nil
        storedSessions[index].pendingUnscopedChatIdempotencyKey = nil
        storedSessions[index].updatedAt = now()
        guard persist() else {
            storedSessions[index] = prior
            scheduleNextExpiration()
            return false
        }
        return true
    }

    @discardableResult
    func record(
        sessionID: UUID?,
        objective: String,
        response: RelationshipAskResponse,
        person: WorkspacePerson,
        context: WorkspacePerson.Context,
        createdAt: Date = Date(),
        sourceMessageID: UUID? = nil
    ) -> UUID {
        _ = pruneExpiredState()
        if let sessionID, syncTombstones[sessionID.uuidString.lowercased()] != nil
            || !storedSessions.contains(where: { $0.id == sessionID }) {
            persistenceNotice = "The Session is no longer available. Its delayed answer was not restored."
            return sessionID
        }
        let priorSessions = storedSessions
        let turn = AgentSessionTurn(
            id: sourceMessageID ?? UUID(),
            objective: objective,
            response: response,
            createdAt: createdAt,
            requiresRefresh: false
        )
        let existingIndex = sessionID.flatMap { proposedID in
            storedSessions.firstIndex {
                $0.id == proposedID
                    && ($0.isUnresolvedIntent
                        || $0.scope.matches(
                            personID: person.id,
                            relationshipContextID: context.id
                        ))
            }
        }
        let availableProposedID = sessionID.flatMap { proposedID in
            storedSessions.contains(where: { $0.id == proposedID })
                ? nil
                : proposedID
        }
        let resolvedID = existingIndex.map { storedSessions[$0].id }
            ?? availableProposedID
            ?? UUID()

        if let index = existingIndex {
            if storedSessions[index].turns.isEmpty,
               let proposedTitle = response.sessionTitle,
               let title = Self.canonicalSessionTitle(from: proposedTitle) {
                storedSessions[index].title = title
            }
            if storedSessions[index].isUnresolvedIntent {
                storedSessions[index].scope = .relationship(
                    personID: person.id,
                    relationshipContextID: context.id,
                    personDisplayLabel: person.displayLabel,
                    contextDisplayLabel: context.displayLabel
                )
            }
            storedSessions[index].pendingObjective = nil
            storedSessions[index].pendingScopedAskIdempotencyKey = nil
            storedSessions[index].pendingScopedAskRequestIdentity = nil
            storedSessions[index].pendingUnscopedChatIdempotencyKey = nil
            storedSessions[index].pendingPersonResearchIdempotencyKey = nil
            storedSessions[index].pendingPersonResearchRequestIdentity = nil
            storedSessions[index].turns.append(turn)
            storedSessions[index].updatedAt = createdAt
            storedSessions[index].isUnread = false
        } else {
            storedSessions.append(
                AgentSession(
                    id: resolvedID,
                    scope: .relationship(
                        personID: person.id,
                        relationshipContextID: context.id,
                        personDisplayLabel: person.displayLabel,
                        contextDisplayLabel: context.displayLabel
                    ),
                    title: response.sessionTitle.flatMap { Self.canonicalSessionTitle(from: $0) }
                        ?? Self.sessionTitle(from: objective),
                    turns: [turn],
                    contactReceipts: [],
                    updatedAt: createdAt,
                    isUnread: false,
                    createdAt: createdAt
                )
            )
        }
        sortSessions()
        if !persist() { storedSessions = priorSessions }
        return resolvedID
    }

    @discardableResult
    func recordContactReceipt(
        operationKey: String,
        outcome: AgentContactReceipt.Outcome,
        result: ResourceCaptureResult,
        personDisplayLabel: String,
        contextDisplayLabel: String?,
        createdAt: Date? = nil,
        sessionID: UUID? = nil
    ) -> UUID? {
        _ = pruneExpiredState()
        for session in storedSessions {
            guard let existing = session.contactReceipts.first(where: {
                $0.operationKey == operationKey
                    || $0.captureID == result.captureID
            }) else { continue }
            guard existing.operationKey == operationKey,
                  existing.outcome == outcome,
                  existing.captureID == result.captureID,
                  existing.resourceID == result.resource.id,
                  existing.personID == result.identity.personID,
                  existing.relationshipContextID
                    == result.identity.relationshipContextID,
                  existing.resolutionCaseID == result.identity.resolutionCaseID else {
                persistenceNotice = "The retried contact receipt did not match the protected canonical references."
                return nil
            }
            return session.id
        }

        let scope: AgentSessionScope
        switch outcome {
        case .createdPerson, .matchedExisting:
            guard let personID = result.identity.personID,
                  let relationshipContextID = result.identity.relationshipContextID,
                  result.identity.resolutionCaseID == nil,
                  let contextDisplayLabel else {
                persistenceNotice = "The canonical contact receipt did not include a usable relationship scope."
                return nil
            }
            scope = .relationship(
                personID: personID,
                relationshipContextID: relationshipContextID,
                personDisplayLabel: personDisplayLabel,
                contextDisplayLabel: contextDisplayLabel
            )
        case .identityReview:
            guard let resolutionCaseID = result.identity.resolutionCaseID,
                  result.identity.personID == nil,
                  result.identity.relationshipContextID == nil else {
                persistenceNotice = "The canonical contact receipt did not include an identity review case."
                return nil
            }
            scope = .identityReview(
                resolutionCaseID: resolutionCaseID,
                personDisplayLabel: personDisplayLabel
            )
        }

        let receiptDate = createdAt ?? now()
        let receipt = AgentContactReceipt(
            id: UUID(),
            operationKey: operationKey,
            outcome: outcome,
            captureID: result.captureID,
            resourceID: result.resource.id,
            duplicateOfResourceID: result.resource.duplicateOfResourceID,
            personID: result.identity.personID,
            relationshipContextID: result.identity.relationshipContextID,
            resolutionCaseID: result.identity.resolutionCaseID,
            personDisplayLabel: personDisplayLabel,
            contextDisplayLabel: contextDisplayLabel,
            createdAt: receiptDate,
            requiresRefresh: false
        )
        let sourceSessionID = sessionID ?? storedContactProposals.first {
            $0.idempotencyKey == operationKey
        }?.sessionID
        let priorSessions = storedSessions
        let priorProposals = storedContactProposals
        let priorRetiredIntents = retiredContactProposalIntentHashes
        let resolvedID: UUID
        if let sourceSessionID,
           let index = storedSessions.firstIndex(where: { $0.id == sourceSessionID }) {
            resolvedID = sourceSessionID
            storedSessions[index].scope = scope
            storedSessions[index].contactReceipts.append(receipt)
            storedSessions[index].pendingObjective = nil
            storedSessions[index].pendingUnscopedChatIdempotencyKey = nil
            storedSessions[index].pendingPersonResearchIdempotencyKey = nil
            storedSessions[index].pendingPersonResearchRequestIdentity = nil
            storedSessions[index].updatedAt = receiptDate
            storedSessions[index].isUnread = false
        } else {
            resolvedID = UUID()
            storedSessions.append(AgentSession(
                id: resolvedID, scope: scope,
                title: Self.contactSessionTitle(outcome: outcome, personDisplayLabel: personDisplayLabel),
                turns: [], contactReceipts: [receipt], updatedAt: receiptDate, isUnread: false, createdAt: receiptDate
            ))
        }
        if let index = storedContactProposals.firstIndex(where: { $0.idempotencyKey == operationKey }) {
            updateContactProposalTurn(storedContactProposals[index], status: .completed)
            storedContactProposals[index].status = .completed
            retiredContactProposalIntentHashes.insert(Self.contactProposalIntentHash(operationKey))
            storedContactProposals[index].updatedAt = now()
        }
        sortSessions()
        guard persist() else {
            storedSessions = priorSessions
            storedContactProposals = priorProposals
            retiredContactProposalIntentHashes = priorRetiredIntents
            scheduleNextExpiration()
            return nil
        }
        return resolvedID
    }

    func markRead(_ id: UUID) {
        _ = pruneExpiredState()
        guard let index = storedSessions.firstIndex(where: { $0.id == id }) else { return }
        storedSessions[index].isUnread = false
        persist()
    }

    func markUnread(_ id: UUID) {
        _ = pruneExpiredState()
        guard let index = storedSessions.firstIndex(where: { $0.id == id }) else { return }
        storedSessions[index].isUnread = true
        persist()
    }

    @discardableResult
    func delete(_ id: UUID) -> Bool {
        _ = pruneExpiredState()
        guard storedSessions.contains(where: { $0.id == id }) else {
            return true
        }
        if storedContactProposals.contains(where: { $0.sessionID == id && $0.isActive && $0.pendingTarget != nil }) {
            persistenceNotice = "Check the pending contact result before deleting this session."
            return false
        }
        let priorSessions = storedSessions
        let priorProposals = storedContactProposals
        let priorTombstones = syncTombstones
        syncTombstones[id.uuidString.lowercased()] = -((syncRevisions[id.uuidString.lowercased()] ?? 0) + 1)
        storedSessions.removeAll { $0.id == id }
        storedContactProposals.removeAll { $0.sessionID == id }
        guard persist() else {
            storedContactProposals = priorProposals
            syncTombstones = priorTombstones
            storedSessions = priorSessions
            scheduleNextExpiration()
            return false
        }
        Task { await BackgroundCaptureDelivery.shared.cancelSession(id) }
        return true
    }

    func draft(personID: String, relationshipContextID: String) -> String {
        pruneExpired()
        return drafts.first {
            $0.personID == personID
                && $0.relationshipContextID == relationshipContextID
        }?.text ?? ""
    }

    func saveDraft(
        _ text: String,
        personID: String,
        relationshipContextID: String
    ) {
        _ = pruneExpiredState()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let existing = drafts.first {
            $0.personID == personID
                && $0.relationshipContextID == relationshipContextID
        }
        drafts.removeAll {
            $0.personID == personID
                && $0.relationshipContextID == relationshipContextID
        }
        if !trimmed.isEmpty {
            drafts.append(
                AgentSessionDraft(
                    personID: personID,
                    relationshipContextID: relationshipContextID,
                    text: text,
                    updatedAt: now(),
                    pendingIdempotencyKey: existing?.text == text
                        ? existing?.pendingIdempotencyKey
                        : nil,
                    requestIdentity: existing?.text == text
                        ? existing?.requestIdentity
                        : nil
                )
            )
        }
        persist()
    }

    func globalDraft() -> String {
        pruneExpired()
        return storedGlobalDraft?.text ?? ""
    }

    func saveGlobalDraft(_ text: String) {
        _ = pruneExpiredState()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        storedGlobalDraft = trimmed.isEmpty
            ? nil
            : AgentGlobalDraft(text: text, updatedAt: now())
        persist()
    }

    @discardableResult
    func promoteGlobalDraft(
        _ text: String,
        personID: String,
        relationshipContextID: String
    ) -> Bool {
        _ = pruneExpiredState()
        let priorDrafts = drafts
        let priorGlobalDraft = storedGlobalDraft
        let existing = drafts.first {
            $0.personID == personID
                && $0.relationshipContextID == relationshipContextID
        }
        drafts.removeAll {
            $0.personID == personID
                && $0.relationshipContextID == relationshipContextID
        }
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            drafts.append(
                AgentSessionDraft(
                    personID: personID,
                    relationshipContextID: relationshipContextID,
                    text: text,
                    updatedAt: now(),
                    pendingIdempotencyKey: existing?.text == text
                        ? existing?.pendingIdempotencyKey
                        : nil,
                    requestIdentity: existing?.text == text
                        ? existing?.requestIdentity
                        : nil
                )
            )
        }
        storedGlobalDraft = nil
        guard persist() else {
            drafts = priorDrafts
            storedGlobalDraft = priorGlobalDraft
            scheduleNextExpiration()
            return false
        }
        return true
    }

    func beginAsk(
        _ text: String,
        personID: String,
        relationshipContextID: String,
        proposedIdempotencyKey: String,
        requestIdentity: String? = nil,
        sessionID: UUID? = nil
    ) -> String? {
        _ = pruneExpiredState()
        if let sessionID {
            guard let index = storedSessions.firstIndex(where: {
                $0.id == sessionID && $0.scope.matches(personID: personID, relationshipContextID: relationshipContextID)
            }), !storedSessions[index].hasPendingScreenshotAdmission else { return nil }
            let prior = storedSessions[index]
            if prior.pendingObjective == text,
               prior.pendingScopedAskRequestIdentity == requestIdentity,
               let key = prior.pendingScopedAskIdempotencyKey { return key }
            storedSessions[index].pendingObjective = text
            storedSessions[index].pendingScopedAskIdempotencyKey = proposedIdempotencyKey
            storedSessions[index].pendingScopedAskRequestIdentity = requestIdentity
            storedSessions[index].updatedAt = now()
            guard persist() else { storedSessions[index] = prior; return nil }
            return proposedIdempotencyKey
        }
        if let pending = drafts.first(where: {
            $0.personID == personID
                && $0.relationshipContextID == relationshipContextID
                && $0.text == text
                && $0.requestIdentity == requestIdentity
        })?.pendingIdempotencyKey {
            return pending
        }
        let priorDrafts = drafts
        drafts.removeAll {
            $0.personID == personID
                && $0.relationshipContextID == relationshipContextID
        }
        drafts.append(
            AgentSessionDraft(
                personID: personID,
                relationshipContextID: relationshipContextID,
                text: text,
                updatedAt: now(),
                pendingIdempotencyKey: proposedIdempotencyKey,
                requestIdentity: requestIdentity
            )
        )
        guard persist() else {
            drafts = priorDrafts
            scheduleNextExpiration()
            return nil
        }
        return proposedIdempotencyKey
    }

    func clearDraft(personID: String, relationshipContextID: String) {
        _ = pruneExpiredState()
        drafts.removeAll {
            $0.personID == personID
                && $0.relationshipContextID == relationshipContextID
        }
        persist()
    }

    // Legacy accessors support pre-session callers during migration. New UI always supplies a session.
    var contactProposalDraft: ConversationContactDraft? { contactProposal(sessionID: nil)?.draft }
    var contactProposalOperationKey: String? { contactProposal(sessionID: nil)?.idempotencyKey }
    var contactProposalCapturedAt: Date? { contactProposal(sessionID: nil)?.capturedAt }
    var contactProposalPendingTarget: ConversationContactTarget? { contactProposal(sessionID: nil)?.pendingTarget }
    var contactProposalPendingConfirmIdentityClue: Bool? { contactProposal(sessionID: nil)?.pendingConfirmIdentityClue }

    func contactProposal(sessionID: UUID?) -> AgentContactProposalDraft? {
        pruneExpired()
        return storedContactProposals.filter {
            $0.isActive && (sessionID == nil || $0.sessionID == sessionID)
                && !retiredContactProposalIntentHashes.contains(Self.contactProposalIntentHash($0.idempotencyKey))
        }.max { $0.updatedAt < $1.updatedAt }
    }

    private static func contactProposalIntentHash(_ key: String) -> String {
        SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Pure freshness read for SwiftUI rendering. Pruning and publication happen only in store mutations.
    func isContactProposalCurrent(sessionID: UUID?, idempotencyKey: String) -> Bool {
        guard !retiredContactProposalIntentHashes.contains(Self.contactProposalIntentHash(idempotencyKey)),
              let proposal = storedContactProposals.first(where: {
                  $0.idempotencyKey == idempotencyKey && (sessionID == nil || $0.sessionID == sessionID)
              }), proposal.isActive else { return false }
        let expiration = proposal.expiresAt ?? proposal.updatedAt.addingTimeInterval(Self.draftRetention)
        return proposal.pendingTarget != nil || expiration > now()
    }

    @discardableResult
    func saveContactProposal(
        _ draft: ConversationContactDraft,
        idempotencyKey: String,
        pendingTarget: ConversationContactTarget? = nil,
        pendingConfirmIdentityClue: Bool? = nil,
        clearingGlobalDraft: Bool = false,
        sessionID: UUID? = nil,
        sourceMessageID: UUID? = nil
    ) -> Bool {
        pruneExpired()
        guard !retiredContactProposalIntentHashes.contains(Self.contactProposalIntentHash(idempotencyKey)) else { return false }
        if let sessionID, !storedSessions.contains(where: { $0.id == sessionID }) { return false }
        let previous = storedContactProposals.first { $0.idempotencyKey == idempotencyKey }
        if let previous {
            guard previous.isActive else { return false }
            if previous.pendingTarget != nil {
                guard previous.draft == draft, previous.pendingTarget == pendingTarget,
                      previous.pendingConfirmIdentityClue == pendingConfirmIdentityClue else { return false }
            }
        }
        let resolvedSessionID = sessionID ?? previous?.sessionID
        if let active = storedContactProposals.first(where: {
            $0.sessionID == resolvedSessionID && $0.isActive
        }), active.idempotencyKey != idempotencyKey, active.pendingTarget != nil {
            persistenceNotice = "Resolve the pending contact result before replacing this proposal."
            return false
        }
        let priorProposals = storedContactProposals
        let priorRetiredIntents = retiredContactProposalIntentHashes
        let priorSessions = storedSessions
        let priorGlobalDraft = storedGlobalDraft
        let capturedAt = Self.stableContactCaptureDate(previous?.capturedAt ?? now())
        let messageID = sourceMessageID ?? previous?.sourceMessageID ?? UUID()
        if let resolvedSessionID,
           let original = storedSessions.first(where: { $0.id == resolvedSessionID })?.turns.first(where: { $0.id == messageID }),
           original.objective != (previous?.sourceText ?? draft.sourceNote) { return false }
        if let resolvedSessionID,
           let index = storedSessions.firstIndex(where: { $0.id == resolvedSessionID }),
           !storedSessions[index].turns.contains(where: { $0.id == messageID }) {
            storedSessions[index].turns.append(Self.contactProposalTurn(
                id: messageID, objective: draft.sourceNote, createdAt: capturedAt
            ))
            storedSessions[index].updatedAt = now()
            if storedSessions[index].pendingObjective == draft.sourceNote {
                storedSessions[index].pendingObjective = nil
                storedSessions[index].pendingUnscopedChatIdempotencyKey = nil
                storedSessions[index].pendingPersonResearchIdempotencyKey = nil
                storedSessions[index].pendingPersonResearchRequestIdentity = nil
            }
        }
        for replaced in storedContactProposals where replaced.sessionID == resolvedSessionID && replaced.idempotencyKey != idempotencyKey {
            retiredContactProposalIntentHashes.insert(Self.contactProposalIntentHash(replaced.idempotencyKey))
        }
        storedContactProposals.removeAll { $0.sessionID == resolvedSessionID }
        storedContactProposals.append(AgentContactProposalDraft(
            draft: draft, idempotencyKey: idempotencyKey, capturedAt: capturedAt,
            pendingTarget: pendingTarget, pendingConfirmIdentityClue: pendingConfirmIdentityClue,
            updatedAt: now(), sessionID: resolvedSessionID, sourceMessageID: messageID,
            sourceText: previous?.sourceText ?? draft.sourceNote,
            expiresAt: previous?.expiresAt ?? now().addingTimeInterval(Self.draftRetention),
            status: .proposed
        ))
        if clearingGlobalDraft { storedGlobalDraft = nil }
        sortSessions()
        guard persist() else {
            storedContactProposals = priorProposals
            retiredContactProposalIntentHashes = priorRetiredIntents
            storedSessions = priorSessions
            storedGlobalDraft = priorGlobalDraft
            scheduleNextExpiration()
            return false
        }
        return true
    }

    @discardableResult
    func promoteUnscopedChatToContactProposal(
        sessionID: UUID,
        objective: String,
        unscopedChatIdempotencyKey: String,
        draft: ConversationContactDraft,
        proposalIdempotencyKey: String,
        clearingGlobalDraft: Bool = false,
        sourceMessageID: UUID? = nil
    ) -> Bool {
        _ = pruneExpiredState()
        guard let index = storedSessions.firstIndex(where: {
            $0.id == sessionID && $0.isUnresolvedIntent
        }), storedSessions[index].pendingObjective == objective,
        storedSessions[index].pendingUnscopedChatIdempotencyKey == unscopedChatIdempotencyKey else {
            return false
        }
        let priorSessions = storedSessions
        storedSessions[index].pendingObjective = nil
        storedSessions[index].pendingUnscopedChatIdempotencyKey = nil
        storedSessions[index].pendingPersonResearchIdempotencyKey = nil
        storedSessions[index].pendingPersonResearchRequestIdentity = nil
        guard saveContactProposal(
            draft, idempotencyKey: proposalIdempotencyKey,
            clearingGlobalDraft: clearingGlobalDraft, sessionID: sessionID,
            sourceMessageID: sourceMessageID
        ) else {
            storedSessions = priorSessions
            scheduleNextExpiration()
            return false
        }
        return true
    }

    @discardableResult
    func clearContactProposal(sessionID: UUID? = nil) -> Bool {
        _ = pruneExpiredState()
        guard let current = contactProposal(sessionID: sessionID),
              let index = storedContactProposals.firstIndex(where: { $0.idempotencyKey == current.idempotencyKey }) else {
            return true
        }
        // An in-flight or unknown write must remain recoverable until canonical readback.
        guard current.pendingTarget == nil else {
            persistenceNotice = "Check the pending contact result before dismissing it."
            return false
        }
        let prior = storedContactProposals
        let priorRetiredIntents = retiredContactProposalIntentHashes
        let priorSessions = storedSessions
        updateContactProposalTurn(current, status: .declined)
        storedContactProposals[index].status = .declined
        retiredContactProposalIntentHashes.insert(Self.contactProposalIntentHash(current.idempotencyKey))
        storedContactProposals[index].updatedAt = now()
        guard persist() else {
            storedContactProposals = prior
            retiredContactProposalIntentHashes = priorRetiredIntents
            storedSessions = priorSessions
            scheduleNextExpiration()
            return false
        }
        return true
    }

    private static func contactProposalStatusTurn(_ turn: AgentSessionTurn, status: AgentContactProposalDraft.Status) -> AgentSessionTurn {
        let title: String
        let body: String
        switch status {
        case .declined:
            title = "No contact created"
            body = "You declined this contact proposal. The original message is kept."
        case .expired:
            title = "Contact proposal expired"
            body = "This proposal expired. The original message is kept; review fresh details to continue."
        case .completed:
            title = "Contact review completed"
            body = "The contact result is recorded below."
        case .proposed: return turn
        }
        let response = turn.response
        return AgentSessionTurn(id: turn.id, objective: turn.objective,
            response: .init(contractVersion: response.contractVersion, taskID: response.taskID,
                contextManifestID: response.contextManifestID, knowledgeSnapshotID: response.knowledgeSnapshotID,
                disposition: status == .declined ? "no_action" : status.rawValue,
                blocks: [.init(id: response.blocks.first?.id ?? "proposal", kind: "contact_proposal",
                    title: title, body: body, status: status.rawValue, citationDependencyIDs: [], requiresUserDecision: false)],
                media: response.media, createdAt: response.createdAt, citations: []),
            createdAt: turn.createdAt, requiresRefresh: turn.requiresRefresh,
            feedback: turn.feedback, feedbackUpdatedAt: turn.feedbackUpdatedAt)
    }

    private func updateContactProposalTurn(_ proposal: AgentContactProposalDraft, status: AgentContactProposalDraft.Status) {
        guard let sessionID = proposal.sessionID, let sourceID = proposal.sourceMessageID,
              let index = storedSessions.firstIndex(where: { $0.id == sessionID }),
              let turnIndex = storedSessions[index].turns.firstIndex(where: { $0.id == sourceID }) else { return }
        storedSessions[index].turns[turnIndex] = Self.contactProposalStatusTurn(storedSessions[index].turns[turnIndex], status: status)
    }

    private static func contactProposalTurn(id: UUID, objective: String, createdAt: Date) -> AgentSessionTurn {
        AgentSessionTurn(
            id: id, objective: objective,
            response: RelationshipAskResponse(
                contractVersion: "2026-09-07", taskID: "contact-proposal-\(id.uuidString.lowercased())",
                contextManifestID: "none-unbound-conversation", knowledgeSnapshotID: "none-unbound-conversation",
                disposition: "proposal_only", blocks: [.init(
                    id: "proposal-\(id.uuidString.lowercased())", kind: "contact_proposal",
                    title: "Contact proposal", body: "Contact details were prepared for your review.",
                    status: "needs_review", citationDependencyIDs: [], requiresUserDecision: false
                )], media: [], createdAt: ISO8601DateFormatter().string(from: createdAt), citations: []
            ), createdAt: createdAt, requiresRefresh: false
        )
    }

    @discardableResult
    func beginEvidenceReview(
        idempotencyKey: String,
        taskID: String,
        citation: RelationshipAskResponse.Citation,
        personDisplayName: String,
        relationshipContextDisplayName: String,
        expectedReviewStatus: String,
        decision: String,
        reason: String,
        pendingAskSessionID: UUID? = nil,
        pendingAskKey: String? = nil
    ) throws -> AgentEvidenceReviewOperation {
        _ = pruneExpiredState()
        if let existing = storedEvidenceReviews.first(where: {
            $0.idempotencyKey == idempotencyKey
        }) {
            return existing
        }
        if pendingAskSessionID != nil || pendingAskKey != nil {
            guard let pendingAskSessionID, let pendingAskKey,
                  let session = storedSessions.first(where: { $0.id == pendingAskSessionID }),
                  session.pendingScopedAskIdempotencyKey == pendingAskKey,
                  session.scope.matches(personID: citation.personID ?? "", relationshipContextID: citation.relationshipContextID ?? "") else {
                throw AgentSessionPersistenceError.evidenceReviewRecoveryUnavailable
            }
        }
        let operation = AgentEvidenceReviewOperation(
            idempotencyKey: idempotencyKey,
            taskID: taskID,
            fragmentID: citation.id,
            resourceID: citation.resourceID,
            sourceName: citation.sourceName,
            personID: citation.personID ?? "unavailable",
            personDisplayName: personDisplayName,
            relationshipContextID: citation.relationshipContextID ?? "unavailable",
            relationshipContextDisplayName: relationshipContextDisplayName,
            expectedReviewStatus: expectedReviewStatus,
            authorityReviewID: citation.lastReviewID,
            decision: decision,
            reason: reason,
            resultingReviewID: nil,
            canonicalDecidedAt: nil,
            state: .pending,
            statusMessage: nil,
            updatedAt: now(),
            pendingAskSessionID: pendingAskSessionID,
            pendingAskKey: pendingAskKey
        )
        storedEvidenceReviews.append(operation)
        guard persist() else {
            storedEvidenceReviews.removeAll {
                $0.idempotencyKey == idempotencyKey
            }
            scheduleNextExpiration()
            throw AgentSessionPersistenceError.evidenceReviewRecoveryUnavailable
        }
        return operation
    }

    @discardableResult
    func beginEvidenceReview(
        idempotencyKey: String,
        basedOn prior: AgentEvidenceReviewOperation,
        expectedReviewStatus: String,
        authorityReviewID: String,
        decision: String,
        reason: String
    ) throws -> AgentEvidenceReviewOperation {
        _ = pruneExpiredState()
        if let existing = storedEvidenceReviews.first(where: {
            $0.idempotencyKey == idempotencyKey
        }) {
            return existing
        }
        let operation = AgentEvidenceReviewOperation(
            idempotencyKey: idempotencyKey,
            taskID: prior.taskID,
            fragmentID: prior.fragmentID,
            resourceID: prior.resourceID,
            sourceName: prior.sourceName,
            personID: prior.personID,
            personDisplayName: prior.personDisplayName,
            relationshipContextID: prior.relationshipContextID,
            relationshipContextDisplayName: prior.relationshipContextDisplayName,
            expectedReviewStatus: expectedReviewStatus,
            authorityReviewID: authorityReviewID,
            decision: decision,
            reason: reason,
            resultingReviewID: nil,
            canonicalDecidedAt: nil,
            state: .pending,
            statusMessage: nil,
            updatedAt: now()
        )
        storedEvidenceReviews.append(operation)
        guard persist() else {
            storedEvidenceReviews.removeAll {
                $0.idempotencyKey == idempotencyKey
            }
            scheduleNextExpiration()
            throw AgentSessionPersistenceError.evidenceReviewRecoveryUnavailable
        }
        return operation
    }

    func markEvidenceReviewPending(_ idempotencyKey: String) throws {
        guard !isEvidenceReviewSuperseded(idempotencyKey) else {
            throw AgentSessionPersistenceError.evidenceReviewSuperseded
        }
        guard !evidenceReviewAuthorityReadbackKeys.contains(idempotencyKey) else {
            throw AgentSessionPersistenceError.evidenceReviewAuthorityReadbackRequired
        }
        guard updateEvidenceReview(idempotencyKey, update: {
            $0.state = .pending
            $0.statusMessage = nil
        }) else {
            throw AgentSessionPersistenceError.evidenceReviewRecoveryUnavailable
        }
    }

    @discardableResult
    func markEvidenceReviewApplied(
        _ idempotencyKey: String,
        result: PursuitEvidenceReviewResult
    ) -> Bool {
        _ = pruneExpiredState()
        guard let index = storedEvidenceReviews.firstIndex(where: { $0.idempotencyKey == idempotencyKey }),
              storedEvidenceReviews[index].state != .superseded,
              !transientSupersededEvidenceReviewKeys.contains(idempotencyKey) else { return false }
        let priorReviews = storedEvidenceReviews, priorSessions = storedSessions
        storedEvidenceReviews[index].state = .applied
        storedEvidenceReviews[index].statusMessage = nil
        storedEvidenceReviews[index].resultingReviewID = result.reviewID
        storedEvidenceReviews[index].canonicalDecidedAt = result.decidedAt
        storedEvidenceReviews[index].updatedAt = now()
        let operation = storedEvidenceReviews[index]
        if let sessionID = operation.pendingAskSessionID, let key = operation.pendingAskKey,
           let sessionIndex = storedSessions.firstIndex(where: { $0.id == sessionID }),
           storedSessions[sessionIndex].pendingScopedAskIdempotencyKey == key,
           storedSessions[sessionIndex].scope.matches(personID: operation.personID, relationshipContextID: operation.relationshipContextID) {
            // One durable transaction records the canonical review and retires
            // only its former request identity. The draft still requires Send.
            storedSessions[sessionIndex].pendingScopedAskIdempotencyKey = nil
            storedSessions[sessionIndex].pendingScopedAskRequestIdentity = nil
            storedSessions[sessionIndex].updatedAt = now()
        }
        guard persist() else {
            storedEvidenceReviews = priorReviews; storedSessions = priorSessions
            scheduleNextExpiration()
            return false
        }
        return true
    }

    @discardableResult
    func markEvidenceReviewUnknown(
        _ idempotencyKey: String,
        message: String
    ) -> Bool {
        updateEvidenceReview(idempotencyKey) {
            $0.state = .outcomeUnknown
            $0.statusMessage = message
        }
    }

    @discardableResult
    func markEvidenceReviewFailed(
        _ idempotencyKey: String,
        message: String
    ) -> Bool {
        updateEvidenceReview(idempotencyKey) {
            $0.state = .failed
            $0.statusMessage = message
        }
    }

    @discardableResult
    func markEvidenceReviewSuperseded(
        _ idempotencyKey: String,
        message: String
    ) -> Bool {
        guard storedEvidenceReviews.contains(where: {
            $0.idempotencyKey == idempotencyKey
        }) else { return false }
        let didPersist = updateEvidenceReview(
            idempotencyKey,
            allowSupersededMutation: true
        ) {
            $0.state = .superseded
            $0.statusMessage = message
        }
        if didPersist {
            transientSupersededEvidenceReviewKeys.remove(idempotencyKey)
        } else {
            transientSupersededEvidenceReviewKeys.insert(idempotencyKey)
        }
        evidenceReviewAuthorityReadbackKeys.remove(idempotencyKey)
        return didPersist
    }

    func isEvidenceReviewSuperseded(_ idempotencyKey: String) -> Bool {
        transientSupersededEvidenceReviewKeys.contains(idempotencyKey)
            || storedEvidenceReviews.contains {
                $0.idempotencyKey == idempotencyKey
                    && $0.state == .superseded
            }
    }

    func requiresEvidenceReviewAuthorityReadback(_ idempotencyKey: String) -> Bool {
        evidenceReviewAuthorityReadbackKeys.contains(idempotencyKey)
    }

    func revalidateEvidenceReviewAuthority(
        citations: [RelationshipAskResponse.Citation],
        supersededMessage: String
    ) {
        for idempotencyKey in Array(evidenceReviewAuthorityReadbackKeys) {
            guard let operation = storedEvidenceReviews.first(where: {
                $0.idempotencyKey == idempotencyKey
            }), let citation = citations.first(where: {
                $0.id == operation.fragmentID
            }) else {
                continue
            }
            if citation.availability == "available",
               citation.reviewStatus == operation.expectedReviewStatus,
               citation.lastReviewID == operation.authorityReviewID {
                evidenceReviewAuthorityReadbackKeys.remove(idempotencyKey)
            } else {
                _ = markEvidenceReviewSuperseded(
                    idempotencyKey,
                    message: supersededMessage
                )
            }
        }
    }

    @discardableResult
    func claimEvidenceReview(_ idempotencyKey: String) -> Bool {
        guard !activeEvidenceReviewKeys.contains(idempotencyKey),
              !isEvidenceReviewSuperseded(idempotencyKey),
              !evidenceReviewAuthorityReadbackKeys.contains(idempotencyKey) else {
            return false
        }
        activeEvidenceReviewKeys.insert(idempotencyKey)
        return true
    }

    func releaseEvidenceReview(_ idempotencyKey: String) {
        activeEvidenceReviewKeys.remove(idempotencyKey)
    }

    func latestEvidenceReviews(taskID: String) -> [AgentEvidenceReviewOperation] {
        let matching = evidenceReviewHistory(taskID: taskID)
        var seen = Set<String>()
        return matching.filter { operation in
            seen.insert(operation.fragmentID).inserted
        }
    }

    func evidenceReviewHistory(taskID: String) -> [AgentEvidenceReviewOperation] {
        pruneExpired()
        return storedEvidenceReviews.enumerated()
            .filter { $0.element.taskID == taskID }
            .sorted { lhs, rhs in
                lhs.element.updatedAt == rhs.element.updatedAt
                    ? lhs.offset > rhs.offset
                    : lhs.element.updatedAt > rhs.element.updatedAt
            }
            .map(\.element)
    }

    func markCitationStale(_ citationID: String) {
        _ = pruneExpiredState()
        var didChange = false
        storedSessions = storedSessions.map { session in
            var next = session
            next.turns = session.turns.map { turn in
                guard !turn.requiresRefresh,
                      turn.response.citations.contains(where: {
                          $0.id == citationID
                      }) else {
                    return turn
                }
                didChange = true
                return AgentSessionTurn(
                    id: turn.id,
                    objective: turn.objective,
                    response: turn.response,
                    createdAt: turn.createdAt,
                    requiresRefresh: true,
                    feedback: turn.feedback,
                    feedbackUpdatedAt: turn.feedbackUpdatedAt,
                    images: turn.images, canonicalWire: turn.canonicalWire
                )
            }
            return next
        }
        if didChange { persist() }
    }

    func markTaskStale(_ taskID: String) {
        _ = pruneExpiredState()
        var didChange = false
        storedSessions = storedSessions.map { session in
            var next = session
            next.turns = session.turns.map { turn in
                guard !turn.requiresRefresh,
                      turn.response.taskID == taskID else {
                    return turn
                }
                didChange = true
                return AgentSessionTurn(
                    id: turn.id,
                    objective: turn.objective,
                    response: turn.response,
                    createdAt: turn.createdAt,
                    requiresRefresh: true,
                    feedback: turn.feedback,
                    feedbackUpdatedAt: turn.feedbackUpdatedAt,
                    images: turn.images, canonicalWire: turn.canonicalWire
                )
            }
            return next
        }
        if didChange { persist() }
    }

    func validationTargets() -> [AgentSessionValidationTarget] {
        pruneExpired()
        return storedSessions.flatMap { session in
            session.turns.compactMap { turn in
                guard !turn.requiresRefresh,
                      !turn.response.citations.isEmpty,
                      let personID = session.personID,
                      let relationshipContextID = session.relationshipContextID else {
                    return nil
                }
                return AgentSessionValidationTarget(
                    taskID: turn.response.taskID,
                    personID: personID,
                    relationshipContextID: relationshipContextID,
                    response: turn.response
                )
            }
        }
    }

    func pruneExpired() {
        if pruneExpiredState() {
            persistCurrentState()
        }
        scheduleNextExpiration()
    }

    @discardableResult
    func deleteAll() -> Bool {
        syncGeneration = UUID()
        guard let persistence else {
            expirationTask?.cancel()
            activeEvidenceReviewKeys = []
            transientSupersededEvidenceReviewKeys = []
            evidenceReviewAuthorityReadbackKeys = []
            storedSessions = []
            drafts = []
            storedGlobalDraft = nil
            storedContactProposals = []
            retiredContactProposalIntentHashes = []
            storedEvidenceReviews = []
            persistenceNotice = nil
            return true
        }
        do {
            try persistence.beginDeletion()
        } catch {
            persistenceNotice = "Sign out paused because protected Agent history could not be scheduled for deletion."
            return false
        }
        expirationTask?.cancel()
        activeEvidenceReviewKeys = []
        transientSupersededEvidenceReviewKeys = []
        evidenceReviewAuthorityReadbackKeys = []
        storedSessions = []
        drafts = []
        storedGlobalDraft = nil
        storedContactProposals = []
        retiredContactProposalIntentHashes = []
        storedEvidenceReviews = []
        do {
            try persistence.completeDeletion()
            persistenceNotice = nil
            return true
        } catch {
            persistenceNotice = "Sign out paused. Agent history remains unavailable while deletion is retried."
            return false
        }
    }

    private func sortSessions() {
        storedSessions.sort { $0.updatedAt > $1.updatedAt }
    }

    @discardableResult
    private func persist() -> Bool {
        _ = pruneExpiredState()
        let didPersist = persistCurrentState()
        scheduleNextExpiration()
        return didPersist
    }

    @discardableResult
    private func persistCurrentState() -> Bool {
        guard let persistence else { return true }
        do {
            let envelope = PersistedAgentSessionEnvelope(
                version: 8,
                sessions: storedSessions.map(PersistedAgentSession.init),
                drafts: drafts,
                globalDraft: storedGlobalDraft,
                evidenceReviews: storedEvidenceReviews,
                contactProposal: nil,
                contactProposals: storedContactProposals,
                syncRevisions: syncRevisions,
                syncTombstones: syncTombstones,
                syncDigests: syncDigests,
                retiredContactProposalIntentHashes: retiredContactProposalIntentHashes.sorted()
            )
            try persistence.save(try JSONEncoder.agentSession.encode(envelope))
            persistenceNotice = nil
            return true
        } catch {
            persistenceNotice = "Agent session changes are not saved on this device."
            return false
        }
    }

    private func pruneExpiredState() -> Bool {
        let sessionCutoff = now().addingTimeInterval(-Self.sessionRetention)
        let draftCutoff = now().addingTimeInterval(-Self.draftRetention)
        var retainedSessions = storedSessions.filter { $0.retentionDeadline > now() }
        for index in retainedSessions.indices {
            if retainedSessions[index].composerDraft != nil,
               (retainedSessions[index].composerDraftUpdatedAt ?? retainedSessions[index].updatedAt) <= draftCutoff {
                retainedSessions[index].composerDraft = nil
                retainedSessions[index].composerDraftUpdatedAt = nil
            }
        }
        let retainedDrafts = drafts.filter { $0.updatedAt > draftCutoff }
        let retainedGlobalDraft = storedGlobalDraft.flatMap {
            $0.updatedAt > draftCutoff ? $0 : nil
        }
        let retainedEvidenceReviews = storedEvidenceReviews.filter {
            $0.updatedAt > sessionCutoff
        }
        let retainedContactProposals = storedContactProposals.compactMap { proposal -> AgentContactProposalDraft? in
            if let sessionID = proposal.sessionID,
               !retainedSessions.contains(where: { $0.id == sessionID }) {
                retiredContactProposalIntentHashes.insert(Self.contactProposalIntentHash(proposal.idempotencyKey))
                return nil
            }
            let expiration = proposal.expiresAt ?? proposal.updatedAt.addingTimeInterval(Self.draftRetention)
            guard expiration <= now() else { return proposal }
            if proposal.pendingTarget != nil { return proposal }
            retiredContactProposalIntentHashes.insert(Self.contactProposalIntentHash(proposal.idempotencyKey))
            // The immutable source turn survives; expired fields and retry tokens are removed.
            if proposal.isActive, let sessionID = proposal.sessionID, let sourceID = proposal.sourceMessageID,
               let index = retainedSessions.firstIndex(where: { $0.id == sessionID }),
               let turnIndex = retainedSessions[index].turns.firstIndex(where: { $0.id == sourceID }) {
                retainedSessions[index].turns[turnIndex] = Self.contactProposalStatusTurn(retainedSessions[index].turns[turnIndex], status: .expired)
            }
            return nil
        }
        let didChange = retainedSessions != storedSessions
            || retainedDrafts.count != drafts.count
            || retainedGlobalDraft != storedGlobalDraft
            || retainedEvidenceReviews.count != storedEvidenceReviews.count
            || retainedContactProposals != storedContactProposals
        guard didChange else { return false }
        storedSessions = retainedSessions
        drafts = retainedDrafts
        storedGlobalDraft = retainedGlobalDraft
        storedContactProposals = retainedContactProposals
        storedEvidenceReviews = retainedEvidenceReviews
        let retainedReviewKeys = Set(
            retainedEvidenceReviews.map(\.idempotencyKey)
        )
        activeEvidenceReviewKeys.formIntersection(retainedReviewKeys)
        transientSupersededEvidenceReviewKeys.formIntersection(
            retainedReviewKeys
        )
        evidenceReviewAuthorityReadbackKeys.formIntersection(
            retainedReviewKeys
        )
        return true
    }

    private func scheduleNextExpiration() {
        expirationTask?.cancel()
        let sessionExpirations = storedSessions.map(\.retentionDeadline)
        let draftExpirations = drafts.map {
            $0.updatedAt.addingTimeInterval(Self.draftRetention)
        } + storedSessions.compactMap { session -> Date? in
            guard session.composerDraft != nil else { return nil }
            return (session.composerDraftUpdatedAt ?? session.updatedAt).addingTimeInterval(Self.draftRetention)
        }
        let globalDraftExpirations = storedGlobalDraft.map {
            [$0.updatedAt.addingTimeInterval(Self.draftRetention)]
        } ?? []
        let evidenceReviewExpirations = storedEvidenceReviews.map {
            $0.updatedAt.addingTimeInterval(Self.sessionRetention)
        }
        let contactProposalExpirations = storedContactProposals.filter { $0.pendingTarget == nil }.map {
            $0.expiresAt ?? $0.updatedAt.addingTimeInterval(Self.draftRetention)
        }
        guard let nextExpiration = (
            sessionExpirations + draftExpirations + globalDraftExpirations
                + evidenceReviewExpirations
                + contactProposalExpirations
        ).min() else {
            expirationTask = nil
            return
        }
        let delay = max(0, nextExpiration.timeIntervalSince(now()))
        let nanoseconds = UInt64(min(delay * 1_000_000_000, Double(UInt64.max)))
        expirationTask = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(nanoseconds: nanoseconds)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            self?.pruneExpired()
        }
    }

    private static func sessionTitle(from objective: String) -> String {
        if let title = canonicalSessionTitle(from: objective) { return title }
        return objective.range(of: "\\p{Script=Han}", options: .regularExpression) == nil
            ? "Quick hello"
            : "简单聊两句"
    }

    private static func canonicalSessionTitle(from value: String) -> String? {
        let controlSafe = value.unicodeScalars.reduce(into: "") { result, scalar in
            let isC0OrC1Control = scalar.value <= 0x1F
                || (0x7F...0x9F).contains(scalar.value)
            if CharacterSet.whitespacesAndNewlines.contains(scalar) || isC0OrC1Control {
                result.append(" ")
            } else {
                // Preserve format scalars such as zero-width joiners because
                // they are part of one user-perceived emoji grapheme.
                result.append(contentsOf: String(scalar))
            }
        }
        let oneLine = controlSafe.split(whereSeparator: { $0.isWhitespace })
            .map(String.init)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var bounded = ""
        var codePointCount = 0
        for character in oneLine {
            let characterCodePoints = String(character).unicodeScalars.count
            guard bounded.count < 32,
                  codePointCount + characterCodePoints <= 256 else { break }
            bounded.append(character)
            codePointCount += characterCodePoints
        }
        bounded = bounded.trimmingCharacters(in: .whitespacesAndNewlines)
        let comparable = bounded.lowercased().trimmingCharacters(
            in: CharacterSet.whitespacesAndNewlines
                .union(.punctuationCharacters)
                .union(.symbols)
        )
        let generic: Set<String> = [
            "reply", "answer", "hello", "hi", "chat", "conversation", "response", "greeting",
            "回复", "回答", "你好", "您好", "嗨", "工作台对话", "对话", "聊天", "会话",
        ]
        guard !bounded.isEmpty, !comparable.isEmpty, !generic.contains(comparable) else {
            return nil
        }
        return bounded
    }

    private static func contactSessionTitle(
        outcome: AgentContactReceipt.Outcome,
        personDisplayLabel: String
    ) -> String {
        switch outcome {
        case .createdPerson:
            return "Added \(personDisplayLabel)"
        case .matchedExisting:
            return "Updated \(personDisplayLabel)"
        case .identityReview:
            return "Review \(personDisplayLabel)’s identity"
        }
    }

    @discardableResult
    private func updateEvidenceReview(
        _ idempotencyKey: String,
        allowSupersededMutation: Bool = false,
        update: (inout AgentEvidenceReviewOperation) -> Void
    ) -> Bool {
        _ = pruneExpiredState()
        guard let index = storedEvidenceReviews.firstIndex(where: {
            $0.idempotencyKey == idempotencyKey
        }) else { return false }
        let prior = storedEvidenceReviews[index]
        guard allowSupersededMutation
                || (prior.state != .superseded
                    && !transientSupersededEvidenceReviewKeys.contains(
                        idempotencyKey
                    )) else {
            return false
        }
        update(&storedEvidenceReviews[index])
        storedEvidenceReviews[index].updatedAt = now()
        guard persist() else {
            storedEvidenceReviews[index] = prior
            scheduleNextExpiration()
            return false
        }
        return true
    }
}

extension AgentSessionStore {
    func draft(sessionID: UUID) -> String { session(id: sessionID)?.composerDraft ?? "" }

    @discardableResult
    func saveDraft(_ value: String, sessionID: UUID) -> Bool {
        guard value.count <= 12000,
              let index = storedSessions.firstIndex(where: { $0.id == sessionID }) else { return false }
        let proposed = value.isEmpty ? nil : value
        guard storedSessions[index].composerDraft != proposed else { return true }
        let prior = storedSessions[index]
        storedSessions[index].composerDraft = proposed
        storedSessions[index].composerDraftUpdatedAt = proposed == nil ? nil : now()
        storedSessions[index].updatedAt = now()
        guard persist() else { storedSessions[index] = prior; return false }
        return true
    }

    @discardableResult
    func clearDraft(sessionID: UUID) -> Bool { saveDraft("", sessionID: sessionID) }

    @discardableResult
    func beginSession(person: WorkspacePerson, context: WorkspacePerson.Context, objective: String, id: UUID = UUID()) -> UUID? {
        guard person.contexts.contains(where: { $0.id == context.id }) else { return nil }
        if let existing = session(id: id) {
            return existing.scope.matches(personID: person.id, relationshipContextID: context.id) ? id : nil
        }
        let prior = storedSessions
        storedSessions.append(AgentSession(
            id: id, scope: .relationship(personID: person.id, relationshipContextID: context.id,
                                         personDisplayLabel: person.displayLabel, contextDisplayLabel: context.displayLabel),
            title: Self.sessionTitle(from: objective), turns: [], contactReceipts: [],
            pendingObjective: objective, updatedAt: now(), isUnread: false, createdAt: now()
        ))
        sortSessions()
        guard persist() else { storedSessions = prior; return nil }
        return id
    }

    func screenshotAdmissionNotice(sessionID: UUID?) -> String? {
        guard let sessionID, let session = storedSessions.first(where: { $0.id == sessionID }),
              session.screenshotTaskIDs.count >= 20 else { return nil }
        return "This Session has reached its screenshot limit. Open Session actions and choose Fork Session to continue with your selected images."
    }

    /// Reserve a screenshot admission before sending bytes. Recovery keeps only identity hashes and its stable token.
    func beginScreenshotAdmission(sessionID: UUID, objective: String, requestIdentity: String, proposedIdempotencyKey: String, capturedAt: Date? = nil) -> String? {
        _ = pruneExpiredState()
        guard requestIdentity.utf8.count == 64,
              requestIdentity.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              !proposedIdempotencyKey.isEmpty, proposedIdempotencyKey.count <= 200,
              let index = storedSessions.firstIndex(where: { $0.id == sessionID }) else { return nil }
        let prior = storedSessions[index]
        if let key = prior.pendingScreenshotIdempotencyKey {
            return prior.pendingObjective == objective && prior.pendingScreenshotRequestIdentity == requestIdentity
                && prior.pendingScreenshotCapturedAt != nil ? key : nil
        }
        guard prior.screenshotTaskIDs.count < 20,
              !prior.hasPendingUnscopedChat, !prior.hasPendingPersonResearch,
              prior.pendingScopedAskIdempotencyKey == nil else { return nil }
        storedSessions[index].pendingObjective = objective
        storedSessions[index].pendingScreenshotIdempotencyKey = proposedIdempotencyKey
        storedSessions[index].pendingScreenshotRequestIdentity = requestIdentity
        storedSessions[index].pendingScreenshotCapturedAt = Self.stableContactCaptureDate(capturedAt ?? now())
        storedSessions[index].updatedAt = now()
        guard persist() else { storedSessions[index] = prior; return nil }
        return proposedIdempotencyKey
    }

    @discardableResult
    func recordScreenshotTask(
        sessionID: UUID,
        taskID: String,
        objective: String,
        summary: String,
        status: String,
        admissionIdempotencyKey: String? = nil,
        clearsMatchingPendingObjective: Bool = true
    ) -> Bool {
        _ = pruneExpiredState()
        guard let index = storedSessions.firstIndex(where: { $0.id == sessionID }) else { return false }
        guard !storedSessions[index].readOnlyScreenshotTaskIDs.contains(taskID) else { return false }
        let isAdmittedRecovery = admissionIdempotencyKey != nil
            && storedSessions[index].pendingScreenshotIdempotencyKey == admissionIdempotencyKey
        guard storedSessions[index].screenshotTaskIDs.contains(taskID)
                || storedSessions[index].screenshotTaskIDs.count < 20
                || (isAdmittedRecovery && storedSessions[index].screenshotTaskIDs.count == 20) else { return false }
        let prior = storedSessions[index]
        let existing = storedSessions[index].turns.first { $0.response.taskID == taskID }
        let createdAt = existing?.createdAt ?? now()
        let turn = AgentSessionTurn(
            id: existing?.id ?? UUID(), objective: existing?.objective ?? objective,
            response: RelationshipAskResponse(
                contractVersion: TalentSignalAPIContract.version, taskID: taskID,
                contextManifestID: "none-unbound-conversation", knowledgeSnapshotID: "none-unbound-conversation",
                disposition: "screenshot_processing", blocks: [.init(
                    id: "screenshot-\(taskID)", kind: "screenshot_processing", title: "Screenshot",
                    body: summary.isEmpty ? status : summary, status: status,
                    citationDependencyIDs: [], requiresUserDecision: false
                )], media: [], createdAt: ISO8601DateFormatter().string(from: createdAt), citations: []
            ), createdAt: createdAt, requiresRefresh: false,
            feedback: existing?.feedback, feedbackUpdatedAt: existing?.feedbackUpdatedAt
        )
        if let turnIndex = storedSessions[index].turns.firstIndex(where: { $0.id == turn.id }) {
            storedSessions[index].turns[turnIndex] = turn
        } else { storedSessions[index].turns.append(turn) }
        if !storedSessions[index].screenshotTaskIDs.contains(taskID) { storedSessions[index].screenshotTaskIDs.append(taskID) }
        if let admissionIdempotencyKey,
           storedSessions[index].pendingScreenshotIdempotencyKey == admissionIdempotencyKey {
            storedSessions[index].pendingScreenshotIdempotencyKey = nil
            storedSessions[index].pendingScreenshotRequestIdentity = nil
            storedSessions[index].pendingScreenshotCapturedAt = nil
            storedSessions[index].pendingObjective = nil
        } else if clearsMatchingPendingObjective,
                  !storedSessions[index].hasPendingScreenshotAdmission,
                  storedSessions[index].pendingObjective == objective {
            storedSessions[index].pendingObjective = nil
        }
        storedSessions[index].updatedAt = now()
        let exceededSyncCapacity = storedSessions[index].screenshotTaskIDs.count > 20
        guard persist() else {
            if let rollbackIndex = storedSessions.firstIndex(where: { $0.id == sessionID }) { storedSessions[rollbackIndex] = prior }
            return false
        }
        guard storedSessions.contains(where: { $0.id == sessionID }) else { return false }
        if exceededSyncCapacity {
            sessionSyncNotices[sessionID] = screenshotAdmissionNotice(sessionID: sessionID)
        }
        return true
    }

    @discardableResult
    func toggleFeedback(sessionID: UUID, turnID: UUID, feedback: AgentSessionFeedback) -> Bool {
        guard let index = storedSessions.firstIndex(where: { $0.id == sessionID }),
              let turnIndex = storedSessions[index].turns.firstIndex(where: { $0.id == turnID }) else { return false }
        let prior = storedSessions[index]
        storedSessions[index].turns[turnIndex].feedback = storedSessions[index].turns[turnIndex].feedback == feedback ? nil : feedback
        storedSessions[index].turns[turnIndex].feedbackUpdatedAt = now()
        storedSessions[index].updatedAt = now()
        guard persist() else { storedSessions[index] = prior; return false }
        return true
    }

    @discardableResult
    func forkSession(_ id: UUID, throughTurnID: UUID? = nil) -> UUID? {
        guard let original = session(id: id), !original.turns.isEmpty else { return nil }
        let endIndex: Int
        if let throughTurnID {
            guard let index = original.turns.firstIndex(where: { $0.id == throughTurnID }) else { return nil }
            endIndex = index + 1
        } else { endIndex = original.turns.count }
        var turns: [AgentSessionTurn] = []
        var byteCount = 0
        var inheritedScreenshotIDs = Set<String>()
        for turn in original.turns.prefix(endIndex).suffix(40).reversed() {
            let screenshotID = original.screenshotTaskIDs.contains(turn.response.taskID) ? turn.response.taskID : nil
            if let screenshotID, !inheritedScreenshotIDs.contains(screenshotID), inheritedScreenshotIDs.count >= 19 { continue }
            let copied = AgentSessionTurn(id: UUID(), objective: turn.objective,
                response: AgentSessionContextPolicy.readOnlyResponse(turn.response),
                createdAt: turn.createdAt, requiresRefresh: true)
            guard let data = try? JSONEncoder.agentSession.encode(PersistedAgentSessionTurn(copied)),
                  byteCount + data.count <= 128 * 1024 else { continue }
            byteCount += data.count
            if let screenshotID { inheritedScreenshotIDs.insert(screenshotID) }
            turns.insert(copied, at: 0)
        }
        let fork = AgentSession(
            id: UUID(), scope: original.scope, title: original.title, turns: turns,
            contactReceipts: [], updatedAt: now(), isUnread: false,
            originSessionID: id, originTurnID: throughTurnID ?? original.turns.last?.id,
            originKind: syncDigests[id.uuidString.lowercased()] == Self.syncDigest(syncPayload(original)) ? nil : "local",
            screenshotTaskIDs: original.screenshotTaskIDs.filter { inheritedScreenshotIDs.contains($0) },
            inheritedScreenshotTaskIDs: original.screenshotTaskIDs.filter { inheritedScreenshotIDs.contains($0) },
            createdAt: now(), retentionExpiresAt: original.retentionDeadline,
            contextWasTrimmed: turns.count < endIndex
        )
        let prior = storedSessions
        storedSessions.append(fork)
        sortSessions()
        guard persist() else { storedSessions = prior; return nil }
        return fork.id
    }

    func exportMarkdown(sessionID: UUID, language: AppLanguage) -> String? {
        session(id: sessionID).map { AgentSessionContextPolicy.exportMarkdown($0, language: language) }
    }

    func recordIfOwned(sessionID: UUID, objective: String, response: RelationshipAskResponse,
                       person: WorkspacePerson, context: WorkspacePerson.Context,
                       createdAt: Date = Date(), sourceMessageID: UUID? = nil) -> UUID? {
        pruneExpired()
        guard syncTombstones[sessionID.uuidString.lowercased()] == nil,
              let owner = storedSessions.first(where: { $0.id == sessionID }),
              owner.isUnresolvedIntent || owner.scope.matches(personID: person.id, relationshipContextID: context.id) else { return nil }
        let result = record(sessionID: sessionID, objective: objective, response: response,
                            person: person, context: context, createdAt: createdAt, sourceMessageID: sourceMessageID)
        return storedSessions.first(where: { $0.id == result })?.turns.contains(where: { $0.response.taskID == response.taskID }) == true ? result : nil
    }

    /// Uploads readable history only. Pending exact-effect approval remains on its originating device.
    private func syncPayload(_ session: AgentSession) -> PersistedAgentSession {
        var payload = PersistedAgentSession(session)
        payload.retentionExpiresAt = nil
        payload.pendingImageConversation = nil // Device-local recovery is not a backend payload field.
        payload.backgroundCapturePendingAdmission = nil
        if session.pendingImageConversation != nil { payload.pendingObjective = nil }
        if let proposal = storedContactProposals.first(where: { $0.sessionID == session.id }) {
            payload.contactProposal = AgentContactProposalDraft(
                draft: proposal.draft, idempotencyKey: proposal.idempotencyKey,
                capturedAt: proposal.capturedAt, pendingTarget: nil, pendingConfirmIdentityClue: nil,
                updatedAt: proposal.updatedAt, sessionID: proposal.sessionID,
                sourceMessageID: proposal.sourceMessageID, sourceText: proposal.sourceText,
                expiresAt: proposal.expiresAt, status: proposal.status
            )
        }
        return payload
    }

    /// Reconcile immutable message identity by union; never use last-writer-wins for a transcript.
    private func mergeRemote(_ remote: PersistedAgentSession, into local: AgentSession?) throws -> AgentSession {
        let remoteSession = try remote.value()
        guard let local else { return remoteSession }
        var merged = local.updatedAt >= remoteSession.updatedAt ? local : remoteSession
        // Server immutable time repairs legacy whole-second local encodings.
        merged.createdAt = remoteSession.originalCreatedAt
        var turns = local.turns
        for incoming in remoteSession.turns {
            if let index = turns.firstIndex(where: { $0.id == incoming.id }) {
                guard turns[index].objective == incoming.objective,
                      turns[index].response.taskID == incoming.response.taskID,
                      abs(turns[index].createdAt.timeIntervalSince(incoming.createdAt)) < 1 else {
                    throw AgentSessionSyncError.transcriptConflict
                }
                // A newer server revision may have invalidated evidence-backed display text.
                let existing = turns[index]
                let old = AgentSessionTurn(
                    id: existing.id, objective: existing.objective, response: existing.response,
                    createdAt: incoming.createdAt, requiresRefresh: existing.requiresRefresh,
                    feedback: existing.feedback, feedbackUpdatedAt: existing.feedbackUpdatedAt,
                    images: incoming.images, canonicalWire: incoming.canonicalWire
                )
                let unchangedDisplay = AgentSessionContextPolicy.readOnlyResponse(old.response)
                    == AgentSessionContextPolicy.readOnlyResponse(incoming.response)
                turns[index] = unchangedDisplay ? old : incoming
                if (old.feedbackUpdatedAt ?? .distantPast) > (incoming.feedbackUpdatedAt ?? .distantPast) {
                    turns[index].feedback = old.feedback
                    turns[index].feedbackUpdatedAt = old.feedbackUpdatedAt
                } else {
                    turns[index].feedback = incoming.feedback
                    turns[index].feedbackUpdatedAt = incoming.feedbackUpdatedAt
                }
            } else { turns.append(incoming) }
        }
        let remoteIDs = Set(remoteSession.turns.map(\.id))
        merged.turns = remoteSession.turns.compactMap { incoming in turns.first { $0.id == incoming.id } }
            + turns.filter { !remoteIDs.contains($0.id) }
        merged.contactReceipts = local.contactReceipts + remoteSession.contactReceipts.filter { incoming in
            !local.contactReceipts.contains(where: { $0.id == incoming.id || $0.operationKey == incoming.operationKey })
        }
        merged.screenshotTaskIDs = Array(Set(local.screenshotTaskIDs + remoteSession.screenshotTaskIDs)).sorted()
        if local.originSessionID != nil || remoteSession.originSessionID != nil {
            merged.inheritedScreenshotTaskIDs = Array(local.readOnlyScreenshotTaskIDs.union(remoteSession.readOnlyScreenshotTaskIDs)).sorted()
        }
        if let pending = local.pendingImageConversation,
           !remoteSession.turns.contains(where: { $0.id == pending.messageID }) {
            merged.pendingImageConversation = pending
        } else {
            merged.pendingImageConversation = nil
            if let pending = local.pendingImageConversation, merged.pendingObjective == pending.objective {
                merged.pendingObjective = nil
            }
        }
        // A locally pending operation keeps its stable recovery token across a remote read.
        if local.hasPendingUnscopedChat || local.hasPendingPersonResearch || local.pendingScopedAskIdempotencyKey != nil || local.hasPendingScreenshotAdmission {
            merged.pendingObjective = local.pendingObjective
            merged.pendingUnscopedChatIdempotencyKey = local.pendingUnscopedChatIdempotencyKey
            merged.pendingPersonResearchIdempotencyKey = local.pendingPersonResearchIdempotencyKey
            merged.pendingPersonResearchRequestIdentity = local.pendingPersonResearchRequestIdentity
            merged.pendingScopedAskIdempotencyKey = local.pendingScopedAskIdempotencyKey
            merged.pendingScopedAskRequestIdentity = local.pendingScopedAskRequestIdentity
            merged.pendingScreenshotIdempotencyKey = local.pendingScreenshotIdempotencyKey
            merged.pendingScreenshotRequestIdentity = local.pendingScreenshotRequestIdentity
            merged.pendingScreenshotCapturedAt = local.pendingScreenshotCapturedAt
        }
        return merged
    }

    private func applyRemote(_ record: AgentSessionRemoteRecord) throws {
        let key = record.sessionID.uuidString.lowercased()
        guard record.revision >= (syncRevisions[key] ?? 0) else { return }
        if record.payload == nil || record.deletedAt != nil || record.expiresAt <= now() {
            storedSessions.removeAll { $0.id == record.sessionID }
            storedContactProposals.removeAll { $0.sessionID == record.sessionID }
            syncRevisions[key] = record.revision
            syncTombstones[key] = record.revision
            return
        }
        if let pendingDeletion = syncTombstones[key] {
            if pendingDeletion < 0 { syncTombstones[key] = -(record.revision + 1) }
            syncRevisions[key] = record.revision
            return
        }
        guard let payload = record.payload, payload.id == record.sessionID else { return }
        if record.revision == syncRevisions[key] {
            // Older clients persisted whole-second dates after recording this
            // revision. Repair those immutable fields even when the server
            // revision has not changed, without replacing local draft/state.
            guard let index = storedSessions.firstIndex(where: { $0.id == record.sessionID }) else { return }
            let remote = try payload.value()
            var repaired = storedSessions[index]
            guard abs(repaired.originalCreatedAt.timeIntervalSince(remote.originalCreatedAt)) < 1 else {
                throw AgentSessionSyncError.transcriptConflict
            }
            repaired.createdAt = remote.originalCreatedAt
            repaired.turns = try repaired.turns.map { existing in
                guard let incoming = remote.turns.first(where: { $0.id == existing.id }) else { return existing }
                guard existing.objective == incoming.objective,
                      existing.response.taskID == incoming.response.taskID,
                      abs(existing.createdAt.timeIntervalSince(incoming.createdAt)) < 1 else {
                    throw AgentSessionSyncError.transcriptConflict
                }
                return AgentSessionTurn(
                    id: existing.id, objective: existing.objective, response: existing.response,
                    createdAt: incoming.createdAt, requiresRefresh: existing.requiresRefresh,
                    feedback: existing.feedback, feedbackUpdatedAt: existing.feedbackUpdatedAt,
                    images: incoming.images, canonicalWire: incoming.canonicalWire
                )
            }
            storedSessions[index] = repaired
            return
        }
        syncDigests[key] = Self.syncDigest(payload)
        let local = storedSessions.first { $0.id == record.sessionID }
        var merged = try mergeRemote(payload, into: local)
        merged.retentionExpiresAt = min(local?.retentionDeadline ?? .distantFuture, record.expiresAt)
        storedSessions.removeAll { $0.id == record.sessionID }
        storedSessions.append(merged)
        if payload.contactProposal == nil, payload.turns.contains(where: {
            $0.response.savedBlocks == nil && $0.response.unboundConversationBlocks == nil
                && $0.response.unboundPersonResearchBlocks == nil
        }) {
            // A source retraction removes derived proposals, including their local raw excerpts.
            for proposal in storedContactProposals where proposal.sessionID == record.sessionID {
                retiredContactProposalIntentHashes.insert(Self.contactProposalIntentHash(proposal.idempotencyKey))
            }
            storedContactProposals.removeAll { $0.sessionID == record.sessionID }
        }
        if let incoming = payload.contactProposal,
           !retiredContactProposalIntentHashes.contains(Self.contactProposalIntentHash(incoming.idempotencyKey)) {
            let localProposal = storedContactProposals.first { $0.sessionID == record.sessionID }
            if localProposal == nil || (localProposal!.pendingTarget == nil && incoming.updatedAt > localProposal!.updatedAt) {
                storedContactProposals.removeAll { $0.sessionID == record.sessionID }
                storedContactProposals.append(incoming)
            }
        }
        syncRevisions[key] = record.revision
    }

    private static func syncDigest(_ payload: PersistedAgentSession) -> String? {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(payload) else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    func syncNotice(sessionID: UUID?) -> String? {
        guard let sessionID else { return syncNotice }
        return sessionSyncNotices[sessionID] ?? (hasGlobalSyncFailure ? syncNotice : nil)
    }

    private static func syncLimitNotice(_ payload: PersistedAgentSession) -> String? {
        guard payload.turns.count <= 200, (payload.screenshotTaskIDs?.count ?? 0) <= 20,
              let data = try? JSONEncoder.agentSession.encode(payload),
              data.count <= 230 * 1024 else {
            return "This Session is too large to sync. Fork its recent context to continue; the original history stays here."
        }
        return nil
    }

    private static func isGlobalSyncError(_ error: Error) -> Bool {
        guard let syncError = error as? AgentSessionSyncError else { return true }
        switch syncError {
        case .unavailable(let status): return status == 401 || status == 403 || status >= 500
        case .invalidResponse: return true
        case .conflict, .transcriptConflict: return false
        }
    }


    func activateSynchronizationScope(isCurrent: @escaping () -> Bool) {
        syncGeneration = UUID()
        isSynchronizing = false
        synchronizationScopeIsCurrent = isCurrent
        synchronizationScopeActive = true
    }

    /// Account/endpoint/token/workspace lifetime change: advance the sync
    /// generation so every in-flight request drops its completion BEFORE any
    /// applyRemote/persist/put/delete. No stored user data is deleted here.
    func invalidateSynchronizationScope() {
        syncGeneration = UUID()
        synchronizationScopeActive = false
        isSynchronizing = false
    }

    func synchronize(using client: AgentSessionSyncServing, requiredSessionID: UUID? = nil) async -> Bool {
        guard synchronizationScopeActive, synchronizationScopeIsCurrent(), !isSynchronizing else { return false }
        isSynchronizing = true
        sessionSyncNotices = [:]
        hasGlobalSyncFailure = false
        let generation = syncGeneration
        var syncedIDs = Set<UUID>()
        // A stale task can never clear a newer task's in-flight ownership.
        defer { if generation == syncGeneration && synchronizationScopeActive && synchronizationScopeIsCurrent() { isSynchronizing = false } }
        do {
            var cursor: String? = nil
            var visited = Set<String>()
            repeat {
                let page = try await client.list(after: cursor)
                guard generation == syncGeneration && synchronizationScopeActive && synchronizationScopeIsCurrent(), !Task.isCancelled else { return false }
                for record in page.sessions {
                    do { try applyRemote(record) }
                    catch {
                        // Failure publication is fenced like success.
                        if generation == syncGeneration && synchronizationScopeActive && synchronizationScopeIsCurrent() {
                            sessionSyncNotices[record.sessionID] = error.localizedDescription
                        }
                    }
                }
                sortSessions()
                guard persist() else { throw AgentSessionSyncError.invalidResponse }
                if page.complete { break }
                guard let next = page.nextCursor, visited.insert(next).inserted else {
                    throw AgentSessionSyncError.invalidResponse
                }
                cursor = next
            } while true

            for (key, revision) in syncTombstones.sorted(by: { $0.key < $1.key }) {
                guard generation == syncGeneration && synchronizationScopeActive && synchronizationScopeIsCurrent(), !Task.isCancelled else { return false }
                guard let id = UUID(uuidString: key), revision < 0 else { continue }
                do {
                    let result = try await client.delete(id: id, expectedRevision: -revision - 1, idempotencyKey: UUID())
                    guard generation == syncGeneration && synchronizationScopeActive && synchronizationScopeIsCurrent() else { return false }
                    try applyRemote(result)
                    guard persist() else { throw AgentSessionSyncError.invalidResponse }
                } catch {
                    guard generation == syncGeneration, synchronizationScopeActive, synchronizationScopeIsCurrent(), !Task.isCancelled else { return false }
                    if Self.isGlobalSyncError(error) { throw error }
                    if generation == syncGeneration && synchronizationScopeActive && synchronizationScopeIsCurrent() {
                        sessionSyncNotices[id] = error.localizedDescription
                    }
                }
            }
            let ids = storedSessions.map(\.id)
            for id in ids {
                guard generation == syncGeneration && synchronizationScopeActive && synchronizationScopeIsCurrent(), !Task.isCancelled else { return false }
                guard sessionSyncNotices[id] == nil,
                      let current = storedSessions.first(where: { $0.id == id }) else { continue }
                let key = id.uuidString.lowercased()
                // A protected capture placeholder is not an independent
                // Session creator. Its OS admission owns expectedRevision=0.
                if current.backgroundCapturePendingAdmission && syncRevisions[key] == nil { continue }
                let payload = syncPayload(current)
                if let limit = Self.syncLimitNotice(payload) {
                    sessionSyncNotices[id] = limit
                    continue
                }
                if syncDigests[key] == Self.syncDigest(payload) {
                    syncedIDs.insert(id)
                    continue
                }
                do {
                    let result = try await client.put(payload, expectedRevision: syncRevisions[key] ?? 0, idempotencyKey: UUID())
                    guard generation == syncGeneration && synchronizationScopeActive && synchronizationScopeIsCurrent() else { return false }
                    try applyRemote(result)
                    guard persist() else { throw AgentSessionSyncError.invalidResponse }
                    if storedSessions.contains(where: { $0.id == id }), syncTombstones[key] == nil {
                        syncedIDs.insert(id)
                    }
                } catch {
                    guard generation == syncGeneration, synchronizationScopeActive, synchronizationScopeIsCurrent(), !Task.isCancelled else { return false }
                    if Self.isGlobalSyncError(error) { throw error }
                    sessionSyncNotices[id] = error.localizedDescription
                }
            }
            syncNotice = sessionSyncNotices.isEmpty ? nil : "Some Sessions need attention before they can sync."
            if let requiredSessionID {
                let available = syncedIDs.contains(requiredSessionID)
                    && syncTombstones[requiredSessionID.uuidString.lowercased()] == nil
                    && storedSessions.contains { $0.id == requiredSessionID }
                if !available, sessionSyncNotices[requiredSessionID] == nil {
                    sessionSyncNotices[requiredSessionID] = "This Session is no longer available. Start a new Session to continue."
                }
                return available && sessionSyncNotices[requiredSessionID] == nil
            }
            return sessionSyncNotices.isEmpty
        } catch {
            guard generation == syncGeneration, synchronizationScopeActive, synchronizationScopeIsCurrent(), !Task.isCancelled else { return false }
            hasGlobalSyncFailure = true
            syncNotice = error.localizedDescription
            return false
        }
    }

}

enum AgentSessionPersistenceError: LocalizedError, Equatable {
    case unsupportedVersion
    case invalidSessionScope
    case deletionCouldNotBeVerified
    case evidenceReviewRecoveryUnavailable
    case evidenceReviewSuperseded
    case evidenceReviewAuthorityReadbackRequired

    var errorDescription: String? {
        switch self {
        case .unsupportedVersion:
            "Saved Agent sessions use an unsupported version."
        case .invalidSessionScope:
            "Saved Agent session scope is incomplete."
        case .deletionCouldNotBeVerified:
            "Saved Agent sessions could not be deleted safely."
        case .evidenceReviewRecoveryUnavailable:
            "Source review was not attempted because protected recovery could not be saved. No canonical source change was sent."
        case .evidenceReviewSuperseded:
            "A newer source decision is current. This older operation cannot be retried."
        case .evidenceReviewAuthorityReadbackRequired:
            "Check current source authority before retrying this restored operation."
        }
    }
}

extension JSONEncoder {
    /// Fractional-second ISO-8601: the backend enforces Date.parse equality
    /// for immutable creation times, so encoding MUST preserve the
    /// millisecond precision the decoder accepted (legacy whole seconds and
    /// longer fractional fractions both round-trip within Date precision).
    static let agentSession: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var container = encoder.singleValueContainer()
            try container.encode(formatter.string(from: date))
        }
        return encoder
    }()
}

extension JSONDecoder {
    static let agentSession: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid Session timestamp."))
        }
        return decoder
    }()
}

extension AgentSessionStore {
    static func preview(
        snapshot: PursuitWorkspaceSnapshot,
        sessionCount: Int = 2,
        now: @escaping () -> Date = Date.init
    ) -> AgentSessionStore {
        let people = snapshot.people
        guard let first = people.first,
              let firstContext = first.contexts.first else {
            return AgentSessionStore(now: now)
        }

        let response = RelationshipAskResponse(
            contractVersion: "preview",
            taskID: "preview-session-task",
            contextManifestID: "preview-session-manifest",
            knowledgeSnapshotID: "preview-session-snapshot",
            disposition: "proposal_only",
            blocks: [
                .init(
                    id: "preview-session-block",
                    kind: "brief",
                    title: "What changed",
                    body: "The location model is still unresolved. One cited Proposal needs recruiter review before it can change the Pursuit.",
                    status: "needs_review",
                    citationDependencyIDs: ["preview-evidence"],
                    requiresUserDecision: true
                ),
            ],
            createdAt: "2026-08-25T08:30:00.000Z",
            citations: [
                .init(
                    id: "preview-evidence",
                    dependencyType: "evidence_fragment",
                    personID: "preview",
                    relationshipContextID: "preview",
                    inclusionReason: "Exact preview fragment for this relationship question.",
                    authorizationScope: "person:preview:relationship-context:preview",
                    availability: "available",
                    unavailableReason: nil,
                    resourceID: "preview-resource",
                    sourceName: "WhatsApp screenshot",
                    observedAt: "2026-08-24T10:30:00.000Z",
                    sourceTimezone: "Asia/Singapore",
                    captureVersion: 1,
                    fragmentKind: "message",
                    sequence: 0,
                    exactExcerpt: "I could do Singapore, but not full-time relocation.",
                    attribution: .init(actorKind: "candidate", status: "confirmed"),
                    reviewStatus: "reviewed",
                    parser: .init(name: "preview", version: "1"),
                    contentHash: String(repeating: "0", count: 64),
                    fragmentCreatedAt: "2026-08-24T10:31:00.000Z",
                    lastReviewID: "preview-review",
                    lastReviewedAt: "2026-08-24T10:35:00.000Z",
                    lastReviewedBy: "Preview recruiter"
                ),
            ]
        )
        // Synthetic sessions must age from this preview's clock, not a fixed
        // fixture date that eventually expires under the real retention policy.
        let previewDate = now()
        let primary = AgentSession(
            id: UUID(uuidString: "90000000-0000-4000-8000-000000000001")!,
            scope: .relationship(
                personID: first.id,
                relationshipContextID: firstContext.id,
                personDisplayLabel: first.displayLabel,
                contextDisplayLabel: firstContext.displayLabel
            ),
            title: "What changed with the location model?",
            turns: [
                AgentSessionTurn(
                    id: UUID(uuidString: "91000000-0000-4000-8000-000000000001")!,
                    objective: "What changed with the location model?",
                    response: response,
                    createdAt: previewDate,
                    requiresRefresh: false
                ),
            ],
            contactReceipts: [],
            updatedAt: previewDate,
            isUnread: false
        )

        guard people.count > 1,
              let secondContext = people[1].contexts.first else {
            return AgentSessionStore(sessions: [primary], now: now)
        }
        let secondary = AgentSession(
            id: UUID(uuidString: "90000000-0000-4000-8000-000000000002")!,
            scope: .relationship(
                personID: people[1].id,
                relationshipContextID: secondContext.id,
                personDisplayLabel: people[1].displayLabel,
                contextDisplayLabel: secondContext.displayLabel
            ),
            title: "Prepare the next conversation",
            turns: [],
            contactReceipts: [],
            updatedAt: previewDate.addingTimeInterval(-7_200),
            isUnread: false
        )
        var sessions = [primary, secondary]
        if sessionCount > sessions.count {
            sessions.append(contentsOf: (sessions.count..<sessionCount).map { index in
                let sequence = index + 1
                return AgentSession(
                    id: UUID(
                        uuidString: String(
                            format: "90000000-0000-4000-8000-%012d",
                            sequence
                        )
                    )!,
                    scope: secondary.scope,
                    title: String(format: "Continuity session %02d", sequence),
                    turns: [],
                    contactReceipts: [],
                    updatedAt: previewDate.addingTimeInterval(Double(-3_600 * sequence)),
                    isUnread: sequence.isMultiple(of: 3)
                )
            })
        }
        return AgentSessionStore(sessions: sessions, now: now)
    }
}

enum RelationshipAttentionState: String {
    case changed = "Changed"
    case needsReview = "Needs review"
    case waiting = "Waiting"
    case noAction = "No action"
    case identityReview = "Identity review"
}

struct RelationshipArchivePerson: Identifiable, Hashable {
    let id: String
    let name: String
    let initials: String
    let role: String
    let company: String
    let relationship: String
    let dependency: String
    let recency: String
    let state: RelationshipAttentionState
    let evidence: String
    let provenance: String
    let previousState: String
    let proposedState: String
    let nextStep: String
}

extension RelationshipArchivePerson {
    static let leila = RelationshipArchivePerson(
        id: "leila",
        name: "Leila Hartmann",
        initials: "LH",
        role: "VP Product",
        company: "Meridian Labs",
        relationship: "Chief Product Officer search",
        dependency: "Remote policy waits on the client.",
        recency: "2h",
        state: .changed,
        evidence: "I could do Singapore, but not full-time relocation.",
        provenance: "Leila / WhatsApp screenshot / Thu 22:18 / Recruiter reviewed",
        previousState: "Remote policy assumed flexible",
        proposedState: "Full-time relocation unresolved",
        nextStep: "Ask the client one exact remote-policy question."
    )

    static let nia = RelationshipArchivePerson(
        id: "nia",
        name: "Nia Williams",
        initials: "NW",
        role: "Independent board director",
        company: "Portfolio relationship",
        relationship: "Board search",
        dependency: "Two sources disagree on travel limits.",
        recency: "5h",
        state: .needsReview,
        evidence: "Monthly travel is workable, but I would not want a weekly international cadence.",
        provenance: "Nia / Call note / Today 08:40 / Conflicts with earlier email",
        previousState: "Quarterly travel",
        proposedState: "Current travel cadence unresolved",
        nextStep: "Ask Nia which travel cadence is current."
    )

    static let maya = RelationshipArchivePerson(
        id: "maya",
        name: "Maya Ortiz",
        initials: "MO",
        role: "Operating Partner",
        company: "Northlight Capital",
        relationship: "Fractional CFO search",
        dependency: "Founder meeting is ready to schedule.",
        recency: "1d",
        state: .waiting,
        evidence: "I can meet the founder next Tuesday if we settle the timezone.",
        provenance: "Maya / Recruiter note / Yesterday 17:20 / Draft context",
        previousState: "Meeting not scheduled",
        proposedState: "Tuesday offered; timezone unresolved",
        nextStep: "Confirm one timezone before scheduling."
    )

    static let amir = RelationshipArchivePerson(
        id: "amir",
        name: "Amir Okafor",
        initials: "AO",
        role: "VP Engineering",
        company: "Rubicon Health",
        relationship: "CTO succession",
        dependency: "Stay quiet until the board responds.",
        recency: "4d",
        state: .noAction,
        evidence: "The board will come back after its succession session.",
        provenance: "Amir / Recruiter note / Monday 09:10 / Recruiter reviewed",
        previousState: "Follow-up timing unknown",
        proposedState: "No action until board response",
        nextStep: "No action. Return when the board responds."
    )

    static let wei = RelationshipArchivePerson(
        id: "wei",
        name: "张伟 / Wei Zhang-Sørensen",
        initials: "伟",
        role: "Chief People Officer",
        company: "Independent",
        relationship: "Leadership network",
        dependency: "Identity evidence is not sufficient.",
        recency: "2w",
        state: .identityReview,
        evidence: "This source contains a handle previously associated with another person.",
        provenance: "Imported screenshot / Historical clue / Identity unresolved",
        previousState: "No current owner selected",
        proposedState: "Preserve for identity review",
        nextStep: "Compare current and historical evidence without preselection."
    )

    static let samples: [RelationshipArchivePerson] = [
        .leila,
        .nia,
        .maya,
        .amir,
        .wei,
    ]
}

enum RelationshipArchiveSheet: Identifiable {
    case review(RelationshipArchivePerson)
    case resume(RelationshipArchivePerson)
    case detail(RelationshipArchivePerson)
    case pursuit(WorkspacePursuit)
    case workspacePerson(WorkspacePerson, [WorkspacePersonRole])
    case proposal(WorkspaceProposal)
    case internalTesting

    var id: String {
        switch self {
        case let .review(person):
            return "review-\(person.id)"
        case let .resume(person):
            return "resume-\(person.id)"
        case let .detail(person):
            return "detail-\(person.id)"
        case let .pursuit(pursuit):
            return "pursuit-\(pursuit.id)"
        case let .workspacePerson(person, _):
            return "workspace-person-\(person.id)"
        case let .proposal(proposal):
            return "proposal-\(proposal.id)"
        case .internalTesting:
            return "internal-testing"
        }
    }
}

struct WorkspacePersonRole: Equatable, Identifiable {
    let pursuitID: String
    let pursuitTitle: String
    let roleID: String
    let roleType: String
    let status: String
    let confidence: String
    let evidenceCount: Int
    let evidenceState: WorkspaceEvidenceState

    var id: String { "\(pursuitID)-\(roleID)" }
}

struct WorkspacePersonRetrievalMetadata: Equatable {
    let headline: String?
    let roleType: String?
    let pursuitTitle: String?
    let lastActivityAt: Date?
}

enum AgentSessionRetrievalScope: String, CaseIterable, Identifiable {
    case all, unread, needsAttention

    var id: String { rawValue }

    func displayLabel(in language: AppLanguage) -> String {
        switch self {
        case .all: return language.text("All sessions")
        case .unread: return language.text("Unread")
        case .needsAttention: return language.text("Needs attention")
        }
    }
}

enum AgentSessionRetrievalPolicy {
    // Search the same local retrieval metadata the row presents. Do not expose
    // private message bodies, stale answers, or another relationship's evidence.
    static func filteredSessions(
        _ sessions: [AgentSession],
        query: String,
        scope: AgentSessionRetrievalScope,
        language: AppLanguage
    ) -> [AgentSession] {
        let words = normalize(query).split(whereSeparator: \.isWhitespace)
        return sessions.filter { session in
            switch scope {
            case .all: break
            case .unread: guard session.isUnread else { return false }
            case .needsAttention:
                guard session.retrievalAttention != nil else { return false }
            }
            let metadata = normalize([
                session.displayTitle(in: language),
                session.personDisplayLabel,
                session.displayContextLabel(in: language),
            ].joined(separator: " "))
            return words.allSatisfy { metadata.contains($0) }
        }
    }

    private static func normalize(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive],
                      locale: Locale(identifier: "en_US_POSIX"))
    }
}

enum WorkspacePeopleScope: Equatable, Identifiable {
    case all
    case pursuit(id: String, title: String)
    case unassigned

    var id: String {
        switch self {
        case .all: return "all"
        case let .pursuit(id, _): return "pursuit-\(id)"
        case .unassigned: return "unassigned"
        }
    }

    func displayLabel(in language: AppLanguage) -> String {
        switch self {
        case .all: return language.text("All people")
        case let .pursuit(_, title): return title
        case .unassigned: return language.text("Not in a Pursuit")
        }
    }
}

enum WorkspacePeopleRetrievalPolicy {
    static func filteredPeople(
        in snapshot: PursuitWorkspaceSnapshot,
        query: String,
        scope: WorkspacePeopleScope,
        language: AppLanguage = .english
    ) -> [WorkspacePerson] {
        let normalizedQuery = normalize(
            query.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        let assignedPersonIDs = Set(
            snapshot.pursuits.flatMap { pursuit in
                pursuit.personRoles.map(\.subjectRef.id)
            }
        )

        return snapshot.people.filter { person in
            let isInScope: Bool
            switch scope {
            case .all:
                isInScope = true
            case let .pursuit(id, _):
                isInScope = snapshot.pursuit(id: id)?.personRoles.contains {
                    $0.subjectRef.id == person.id
                } == true
            case .unassigned:
                isInScope = !assignedPersonIDs.contains(person.id)
            }
            guard isInScope else { return false }
            guard !normalizedQuery.isEmpty else { return true }

            let roleSearchValues = snapshot.pursuits.flatMap { pursuit in
                pursuit.personRoles
                    .filter { $0.subjectRef.id == person.id }
                    .flatMap {
                        [
                            pursuit.title,
                            $0.roleType.replacingOccurrences(of: "_", with: " "),
                            language.text($0.roleType.humanized),
                        ]
                    }
            }
            let searchableValues = [
                person.displayLabel,
                person.profile?.headline,
            ].compactMap { $0 }
                + person.contexts.map(\.displayLabel)
                + roleSearchValues
            return searchableValues.contains {
                normalize($0).contains(normalizedQuery)
            }
        }
    }

    static func metadata(
        for person: WorkspacePerson,
        in snapshot: PursuitWorkspaceSnapshot,
        scope: WorkspacePeopleScope
    ) -> WorkspacePersonRetrievalMetadata {
        let matches: [(pursuit: WorkspacePursuit, role: WorkspaceRole)] =
            snapshot.pursuits.flatMap { pursuit in
                pursuit.personRoles
                    .filter { $0.subjectRef.id == person.id }
                    .map { (pursuit, $0) }
            }
        let scopedMatches: [(pursuit: WorkspacePursuit, role: WorkspaceRole)]
        switch scope {
        case let .pursuit(id, _):
            scopedMatches = matches.filter { $0.pursuit.id == id }
        case .all, .unassigned:
            scopedMatches = matches
        }
        let selectedMatch = scopedMatches.first(where: {
            $0.role.status == "active"
        }) ?? scopedMatches.first
        let headline = person.profile?.headline.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        return WorkspacePersonRetrievalMetadata(
            headline: headline?.isEmpty == false ? headline : nil,
            roleType: selectedMatch?.role.roleType,
            pursuitTitle: selectedMatch?.pursuit.title,
            lastActivityAt: parseDate(person.lastActivityAt)
        )
    }

    static func hasUnassignedPeople(in snapshot: PursuitWorkspaceSnapshot) -> Bool {
        let assignedPersonIDs = Set(
            snapshot.pursuits.flatMap { pursuit in
                pursuit.personRoles.map(\.subjectRef.id)
            }
        )
        return snapshot.people.contains { !assignedPersonIDs.contains($0.id) }
    }

    private static func normalize(_ value: String) -> String {
        value.folding(
            options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
            locale: Locale(identifier: "en_US_POSIX")
        )
    }

    private static let fractionalDateParser: ISO8601DateFormatter = {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional
    }()

    private static let standardDateParser: ISO8601DateFormatter = {
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard
    }()

    private static func parseDate(_ value: String) -> Date? {
        fractionalDateParser.date(from: value) ?? standardDateParser.date(from: value)
    }
}

// Inline image recovery is device-owned. The backend receives only canonical
// Session history, then owns admission and execution of the protected message.
extension AgentSessionStore {
    func beginImageConversation(sessionID: UUID, objective: String,
        images: [ConversationImageManifest], messageID: UUID = UUID()) -> PendingImageConversation? {
        guard (!images.isEmpty || !objective.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty), images.count <= 10,
              let index = storedSessions.firstIndex(where: { $0.id == sessionID }),
              !storedSessions[index].hasPendingScreenshotAdmission,
              !storedSessions[index].hasPendingUnscopedChat,
              !storedSessions[index].hasPendingPersonResearch,
              storedSessions[index].pendingScopedAskIdempotencyKey == nil else { return nil }
        if let prior = storedSessions[index].pendingImageConversation {
            return prior.matches(objective: objective, images: images) ? prior : nil
        }
        let before = storedSessions[index]
        let pending = PendingImageConversation(messageID: messageID,
            idempotencyKey: "ios:image-conversation:\(messageID.uuidString.lowercased())",
            objective: objective, images: images, createdAt: now(), timeZone: TimeZone.current.identifier, state: .prepared)
        storedSessions[index].pendingImageConversation = pending
        storedSessions[index].pendingObjective = nil
        storedSessions[index].updatedAt = now()
        guard persist() else { storedSessions[index] = before; return nil }
        return pending
    }

    @discardableResult
    func recordImageAdmission(sessionID: UUID, messageID: UUID, receipt: ConversationImageAdmission) -> Bool {
        guard receipt.sessionID == sessionID, receipt.messageID == messageID,
              let index = storedSessions.firstIndex(where: { $0.id == sessionID }),
              var pending = storedSessions[index].pendingImageConversation,
              pending.messageID == messageID,
              pending.queueEntryID == nil || pending.queueEntryID == receipt.queueEntryID else { return false }
        let before = storedSessions[index]
        pending.queueEntryID = receipt.queueEntryID; pending.state = .admitted
        storedSessions[index].pendingImageConversation = pending
        guard persist() else { storedSessions[index] = before; return false }
        return true
    }

    @discardableResult
    func markImageObservationUnknown(sessionID: UUID, messageID: UUID) -> Bool {
        guard let index = storedSessions.firstIndex(where: { $0.id == sessionID }),
              var pending = storedSessions[index].pendingImageConversation,
              pending.messageID == messageID else { return false }
        let before = storedSessions[index]
        pending.state = .unknown; storedSessions[index].pendingImageConversation = pending
        guard persist() else { storedSessions[index] = before; return false }
        return true
    }

    func recordImageConversationFailure(sessionID: UUID, messageID: UUID, error: Error,
        admissionAttempted: Bool) -> String {
        let inputRejected = (error as? ImageConversationError) == .invalidInput
            || (error as? ImageConversationError) == .changedIntent
        if admissionAttempted, !inputRejected {
            markImageObservationUnknown(sessionID: sessionID, messageID: messageID)
        }
        return ImageConversationError.recoveryMessage(for: error, admissionAttempted: admissionAttempted)
    }

    func observeImageConversation(sessionID: UUID, messageID: UUID,
        observation: ConversationImageObservation) throws -> ImageConversationReadback {
        guard let index = storedSessions.firstIndex(where: { $0.id == sessionID }),
              let pending = storedSessions[index].pendingImageConversation,
              pending.messageID == messageID, observation.record.sessionID == sessionID,
              observation.record.deletedAt == nil, observation.record.expiresAt > now(),
              let payload = observation.record.payload, payload.id == sessionID,
              try payload.value().scope == storedSessions[index].scope else {
            throw ImageConversationError.invalidReadback
        }
        if let entry = observation.entry {
            guard entry.messageID == messageID,
                  pending.queueEntryID == nil || entry.queueEntryID == pending.queueEntryID,
                  entry.images == pending.images else { throw ImageConversationError.invalidReadback }
            if ["failed", "interrupted", "cancelled"].contains(entry.status) {
                var stopped = pending; stopped.state = .stopped
                storedSessions[index].pendingImageConversation = stopped
                guard persist() else { throw ImageConversationError.persistence }
                return .stopped
            }
        }
        if let turn = payload.turns.first(where: { $0.id == messageID }) {
            guard turn.objective == pending.objective, turn.images == pending.images,
                  turn.canonicalWire != nil else { throw ImageConversationError.invalidReadback }
            let before = storedSessions
            let beforeRevisions = syncRevisions, beforeDigests = syncDigests, beforeTombstones = syncTombstones
            let beforeProposals = storedContactProposals, beforeRetired = retiredContactProposalIntentHashes
            do {
                try applyRemote(observation.record)
                sortSessions()
                guard persist() else { throw ImageConversationError.persistence }
            } catch {
                storedSessions = before; syncRevisions = beforeRevisions
                syncDigests = beforeDigests; syncTombstones = beforeTombstones
                storedContactProposals = beforeProposals; retiredContactProposalIntentHashes = beforeRetired
                scheduleNextExpiration()
                throw error
            }
            if UUID(uuidString: turn.response.taskID) == nil
                || turn.response.value.blocks.contains(where: { $0.status == "failed" }) { return .stopped }
            return .completed
        }
        return observation.entry == nil ? .unknown : .waiting
    }
}
