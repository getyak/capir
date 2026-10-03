import Foundation

struct FixtureSuite: Codable, Equatable {
    let suiteID: String
    let version: String
    let purpose: String
    let surfaces: [String]
    let cases: [FixtureCase]

    enum CodingKeys: String, CodingKey {
        case suiteID = "suite_id"
        case version
        case purpose
        case surfaces
        case cases
    }

    func validated() throws -> FixtureSuite {
        guard suiteID == FixtureCatalog.suiteID else {
            throw FixtureValidationError.unexpectedSuite
        }
        guard !version.isEmpty, surfaces.contains("ios"), cases.count == 8 else {
            throw FixtureValidationError.incompleteSuite
        }
        guard version == FixtureCatalog.version else {
            throw FixtureValidationError.unexpectedVersion
        }
        guard Set(cases.map(\.id)).count == cases.count else {
            throw FixtureValidationError.duplicateCase
        }
        guard Set(cases.map(\.id)) == FixtureCatalog.caseIDs else {
            throw FixtureValidationError.incompleteSuite
        }
        for fixture in cases {
            let messageIDs = Set(fixture.messages.map(\.id))
            guard !fixture.messages.isEmpty,
                messageIDs.count == fixture.messages.count,
                fixture.messages.allSatisfy({ !$0.id.isEmpty && !$0.text.isEmpty }),
                fixture.expected.assertions.allSatisfy({ assertion in
                    !assertion.evidenceQuote.isEmpty && fixture.messages.contains {
                        $0.id == assertion.evidenceMessageID && $0.text.contains(assertion.evidenceQuote)
                    }
                }),
                (fixture.expected.action != nil) == (fixture.expected.disposition == .proposeAction),
                fixture.expected.action.map({ action in
                    !action.evidenceMessageIDs.isEmpty && action.evidenceMessageIDs.allSatisfy(messageIDs.contains)
                }) ?? true
            else {
                throw FixtureValidationError.invalidEvidence
            }
        }
        return self
    }
}

enum FixtureValidationError: LocalizedError, Equatable {
    case unexpectedSuite
    case incompleteSuite
    case duplicateCase
    case unexpectedVersion
    case invalidEvidence

    var errorDescription: String? {
        switch self {
        case .unexpectedSuite:
            return "The response is not the capri candidate-momentum fixture suite."
        case .incompleteSuite:
            return "The response does not contain all eight iOS fixture cases."
        case .duplicateCase:
            return "The response contains duplicate fixture case IDs."
        case .unexpectedVersion:
            return "The response does not match the supported fixture revision."
        case .invalidEvidence:
            return "The response contains missing or inconsistent fixture evidence."
        }
    }
}

struct FixtureCase: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let context: FixtureContext
    let messages: [FixtureMessage]
    let expected: FixtureExpected
}

struct FixtureContext: Codable, Equatable {
    let capturedAt: String
    let sourceTimezone: String?
    let candidate: String?
    let assignment: String?
    let notes: String?
    let priorState: [String: String]?
    let candidateOptions: [String]?
    let requestedOutput: String?

    enum CodingKeys: String, CodingKey {
        case capturedAt = "captured_at"
        case sourceTimezone = "source_timezone"
        case candidate
        case assignment
        case notes
        case priorState = "prior_state"
        case candidateOptions = "candidate_options"
        case requestedOutput = "requested_output"
    }
}

struct FixtureMessage: Codable, Identifiable, Equatable {
    let id: String
    let speaker: String
    let text: String
}

struct FixtureExpected: Codable, Equatable {
    let disposition: FixtureDisposition
    let assertions: [FixtureAssertion]
    let action: FixtureAction?
    let mustNot: [String]

    enum CodingKeys: String, CodingKey {
        case disposition
        case assertions
        case action
        case mustNot = "must_not"
    }
}

enum FixtureDisposition: String, Codable, Equatable {
    case proposeAction = "propose_action"
    case noAction = "no_action"
    case clarify
    case block

    var title: String {
        switch self {
        case .proposeAction:
            return "Review before one next step"
        case .noAction:
            return "No action proposed"
        case .clarify:
            return "Clarification required"
        case .block:
            return "Request refused"
        }
    }
}

struct FixtureAssertion: Codable, Equatable {
    let field: String
    let status: AssertionStatus
    let value: String
    let evidenceMessageID: String
    let evidenceQuote: String

    enum CodingKeys: String, CodingKey {
        case field
        case status
        case value
        case evidenceMessageID = "evidence_message_id"
        case evidenceQuote = "evidence_quote"
    }

    var label: String {
        field.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

enum AssertionStatus: String, Codable, Equatable {
    case proposed
    case ambiguous
    case superseded

    var title: String {
        switch self {
        case .proposed:
            return "Proposed"
        case .ambiguous:
            return "Ambiguous"
        case .superseded:
            return "Proposed supersession"
        }
    }
}

struct FixtureAction: Codable, Equatable {
    let type: String
    let owner: String
    let target: String
    let reason: String
    let due: String
    let evidenceMessageIDs: [String]

    enum CodingKeys: String, CodingKey {
        case type
        case owner
        case target
        case reason
        case due
        case evidenceMessageIDs = "evidence_message_ids"
    }
}

enum FactDecision: String, Equatable {
    case pending
    case confirmed
    case edited
    case dismissed

    var title: String {
        switch self {
        case .pending:
            return "Awaiting review"
        case .confirmed:
            return "Confirmed locally"
        case .edited:
            return "Edited and confirmed locally"
        case .dismissed:
            return "Dismissed"
        }
    }
}

struct ReviewedFact: Identifiable, Equatable {
    let id: String
    let assertion: FixtureAssertion
    var decision: FactDecision = .pending
    var editedValue: String = ""

    init(assertion: FixtureAssertion) {
        self.id = "\(assertion.field)-\(assertion.evidenceMessageID)"
        self.assertion = assertion
    }

    var acceptedValue: String? {
        switch decision {
        case .confirmed:
            return assertion.value
        case .edited:
            return editedValue
        case .pending, .dismissed:
            return nil
        }
    }
}

struct ActionPreview: Equatable {
    let action: FixtureAction
    let reviewRevision: Int
    var cards: [ReviewedLoopAction]

    var exactEffect: String {
        "Prepare a recruiter-owned question for a local handoff. No message, meeting, contact, ATS record, or reminder will be created."
    }
}

struct ReviewSession: Equatable {
    let fixture: FixtureCase
    var facts: [ReviewedFact]
    private(set) var revision = 0
    private(set) var preview: ActionPreview?

    init(fixture: FixtureCase) {
        self.fixture = fixture
        self.facts = fixture.expected.assertions.map(ReviewedFact.init)
    }

    var allFactsReviewed: Bool {
        facts.allSatisfy { $0.decision != .pending }
    }

    var acceptedFacts: [ReviewedFact] {
        facts.filter { $0.acceptedValue != nil }
    }

    var hasUnresolvedIdentity: Bool {
        fixture.context.candidate == nil
    }

    var hasReviewableNewContactIdentity: Bool {
        guard fixture.id.hasPrefix("TS-HERO-") else {
            return false
        }
        let acceptedFields = Set(acceptedFacts.map(\.assertion.field))
        return acceptedFields.contains("contact_name")
            && !acceptedFields.isDisjoint(with: ["email", "phone"])
    }

    var canPreviewAction: Bool {
        fixture.expected.disposition == .proposeAction &&
            fixture.expected.action != nil &&
            allFactsReviewed &&
            !acceptedFacts.isEmpty &&
            (!hasUnresolvedIdentity || hasReviewableNewContactIdentity)
    }

    var isPreviewCurrent: Bool {
        guard let preview else { return false }
        return preview.reviewRevision == revision
    }

    var allActionCardsReviewed: Bool {
        guard let preview, !preview.cards.isEmpty else { return false }
        return preview.cards.allSatisfy { $0.decision != .pending }
    }

    var approvedActionCards: [ReviewedLoopAction] {
        preview?.cards.filter { $0.decision == .approved } ?? []
    }

    var momentumInsight: MomentumInsight? {
        guard allActionCardsReviewed else { return nil }
        return CandidateMomentumLoopEngine.insight(
            fixture: fixture,
            acceptedFacts: acceptedFacts,
            approvedActions: approvedActionCards
        )
    }

    mutating func confirm(factID: String) -> Bool {
        guard let index = facts.firstIndex(where: { $0.id == factID }) else {
            return false
        }
        guard facts[index].assertion.status != .ambiguous else {
            return false
        }
        facts[index].decision = .confirmed
        facts[index].editedValue = ""
        markReviewChanged()
        return true
    }

    mutating func edit(factID: String, value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let index = facts.firstIndex(where: { $0.id == factID }) else {
            return false
        }
        facts[index].decision = .edited
        facts[index].editedValue = trimmed
        markReviewChanged()
        return true
    }

    mutating func dismiss(factID: String) -> Bool {
        guard let index = facts.firstIndex(where: { $0.id == factID }) else {
            return false
        }
        facts[index].decision = .dismissed
        facts[index].editedValue = ""
        markReviewChanged()
        return true
    }

    mutating func makeActionPreview() -> ActionPreview? {
        guard canPreviewAction, let action = fixture.expected.action else {
            return nil
        }
        let newPreview = ActionPreview(
            action: action,
            reviewRevision: revision,
            cards: CandidateMomentumLoopEngine.actionCards(
                fixture: fixture,
                acceptedFacts: acceptedFacts
            )
        )
        preview = newPreview
        return newPreview
    }

    mutating func approveAction(cardID: String) -> Bool {
        guard var preview,
              preview.reviewRevision == revision,
              let index = preview.cards.firstIndex(where: { $0.id == cardID }) else {
            return false
        }
        preview.cards[index].decision = .approved
        self.preview = preview
        return true
    }

    mutating func dismissAction(cardID: String) -> Bool {
        guard var preview,
              preview.reviewRevision == revision,
              let index = preview.cards.firstIndex(where: { $0.id == cardID }) else {
            return false
        }
        preview.cards[index].decision = .dismissed
        self.preview = preview
        return true
    }

    mutating func invalidatePreviewForTesting() {
        revision += 1
    }

    private mutating func markReviewChanged() {
        revision += 1
        preview = nil
    }
}

enum FixtureCatalog {
    static let suiteID = "talent-signal-candidate-momentum-v1"
    static let version = "2026-08-05.1"
    static let caseIDs: Set<String> = [
        "TS-CORE-01", "TS-CORE-02", "TS-CORE-03", "TS-CORE-04",
        "TS-ID-01", "TS-ID-03", "TS-ACT-01", "TS-BOUND-01"
    ]
    static let resourceFileName = "candidate-momentum-v1"

    /// The eight-case evaluation corpus is not bundled in the public product
    /// (GET-134). Its only authoritative home is the private getyak/capir-evals
    /// repository. Private execution may inject the canonical
    /// `Resources/candidate-momentum-v1.json`; without that optional resource
    /// the catalog is explicitly unavailable and no fixture review opens.
    static func loadResourceSuite(in bundle: Bundle = .main) -> FixtureSuite? {
        guard let url = bundle.url(
            forResource: resourceFileName,
            withExtension: "json"
        ),
            let data = try? Data(contentsOf: url),
            let suite = try? JSONDecoder().decode(FixtureSuite.self, from: data)
        else {
            return nil
        }
        return try? suite.validated()
    }

    static func fixture(id: String, in suite: FixtureSuite) -> FixtureCase? {
        suite.cases.first { $0.id == id }
    }
}
