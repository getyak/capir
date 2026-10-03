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
        guard Set(cases.map(\.id)).count == cases.count else {
            throw FixtureValidationError.duplicateCase
        }
        return self
    }
}

enum FixtureValidationError: LocalizedError, Equatable {
    case unexpectedSuite
    case incompleteSuite
    case duplicateCase

    var errorDescription: String? {
        switch self {
        case .unexpectedSuite:
            return "The response is not the capri candidate-momentum fixture suite."
        case .incompleteSuite:
            return "The response does not contain all eight iOS fixture cases."
        case .duplicateCase:
            return "The response contains duplicate fixture case IDs."
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

    static let bundled = FixtureSuite(
        suiteID: suiteID,
        version: version,
        purpose: "A small, synthetic, cross-surface gate for evidence-first candidate momentum behavior.",
        surfaces: ["plugin", "web", "ios"],
        cases: [
            FixtureCase(
                id: "TS-CORE-01",
                title: "Deadline, competing offer, preference, and availability",
                context: FixtureContext(
                    capturedAt: "2026-08-03T10:00:00+08:00",
                    sourceTimezone: "Asia/Singapore",
                    candidate: "Alex Chen",
                    assignment: "Staff Product Designer",
                    notes: nil,
                    priorState: nil,
                    candidateOptions: nil,
                    requestedOutput: nil
                ),
                messages: [
                    FixtureMessage(
                        id: "m1",
                        speaker: "candidate",
                        text: "I have another offer and need to decide Wednesday. I can speak Tuesday afternoon, but remote matters a lot."
                    )
                ],
                expected: FixtureExpected(
                    disposition: .proposeAction,
                    assertions: [
                        assertion("competing_process", .proposed, "another offer", "I have another offer"),
                        assertion("decision_deadline", .proposed, "2026-08-05", "need to decide Wednesday"),
                        assertion("availability", .proposed, "Tuesday afternoon", "I can speak Tuesday afternoon"),
                        assertion("work_mode_preference", .proposed, "remote matters a lot", "remote matters a lot")
                    ],
                    action: action(
                        target: "client remote-work policy",
                        reason: "Resolve the work-mode dependency before the decision deadline.",
                        due: "within one business day"
                    ),
                    mustNot: [
                        "predict acceptance",
                        "convert availability into meeting consent",
                        "present proposed assertions as confirmed"
                    ]
                )
            ),
            FixtureCase(
                id: "TS-CORE-02",
                title: "Friendly conversation with no actionable change",
                context: FixtureContext(
                    capturedAt: "2026-08-03T12:00:00+08:00",
                    sourceTimezone: "Asia/Singapore",
                    candidate: "Maya Ortiz",
                    assignment: "VP Operations",
                    notes: nil,
                    priorState: nil,
                    candidateOptions: nil,
                    requestedOutput: nil
                ),
                messages: [
                    FixtureMessage(
                        id: "m1",
                        speaker: "candidate",
                        text: "Thanks again for the conversation. It was great to catch up and I hope you have a good week."
                    )
                ],
                expected: FixtureExpected(
                    disposition: .noAction,
                    assertions: [],
                    action: nil,
                    mustNot: [
                        "manufacture urgency",
                        "infer sentiment or engagement",
                        "create a follow-up task"
                    ]
                )
            ),
            FixtureCase(
                id: "TS-CORE-03",
                title: "Ambiguous relative date and timezone",
                context: FixtureContext(
                    capturedAt: "2026-08-05T09:00:00+08:00",
                    sourceTimezone: nil,
                    candidate: "Priya Shah",
                    assignment: "Engineering Director",
                    notes: "The screenshot was imported two days after the message; recruiter and candidate may be in Singapore and London.",
                    priorState: nil,
                    candidateOptions: nil,
                    requestedOutput: nil
                ),
                messages: [
                    FixtureMessage(id: "m1", speaker: "candidate", text: "Next Friday around 3 works for me.")
                ],
                expected: FixtureExpected(
                    disposition: .clarify,
                    assertions: [
                        assertion("availability", .ambiguous, "next Friday around 3", "Next Friday around 3")
                    ],
                    action: nil,
                    mustNot: [
                        "normalize a date without source time",
                        "assume a timezone",
                        "create a meeting"
                    ]
                )
            ),
            FixtureCase(
                id: "TS-CORE-04",
                title: "Retraction and conditional supersession",
                context: FixtureContext(
                    capturedAt: "2026-08-05T11:00:00+08:00",
                    sourceTimezone: "Asia/Singapore",
                    candidate: "Jordan Kim",
                    assignment: "Chief of Staff",
                    notes: nil,
                    priorState: ["work_mode_constraint": "Remote is required."],
                    candidateOptions: nil,
                    requestedOutput: nil
                ),
                messages: [
                    FixtureMessage(
                        id: "m1",
                        speaker: "candidate",
                        text: "I can do three office days if the role reports to the COO."
                    )
                ],
                expected: FixtureExpected(
                    disposition: .proposeAction,
                    assertions: [
                        assertion(
                            "work_mode_constraint",
                            .superseded,
                            "three office days, conditional on reporting to the COO",
                            "three office days if the role reports to the COO"
                        )
                    ],
                    action: action(
                        target: "role reporting line",
                        reason: "Resolve the condition before treating the work-mode constraint as changed.",
                        due: "before advancing the process"
                    ),
                    mustNot: [
                        "overwrite the prior state destructively",
                        "drop the reporting-line condition",
                        "present the new value as unconditionally confirmed"
                    ]
                )
            ),
            FixtureCase(
                id: "TS-ID-01",
                title: "Same-name candidate without binding evidence",
                context: FixtureContext(
                    capturedAt: "2026-08-05T13:00:00+08:00",
                    sourceTimezone: "Asia/Singapore",
                    candidate: nil,
                    assignment: nil,
                    notes: nil,
                    priorState: nil,
                    candidateOptions: [
                        "Alex Chen — Staff Product Designer",
                        "Alex Chen — Finance Director"
                    ],
                    requestedOutput: nil
                ),
                messages: [
                    FixtureMessage(id: "m1", speaker: "candidate", text: "Wednesday is still the deadline for me.")
                ],
                expected: FixtureExpected(
                    disposition: .clarify,
                    assertions: [],
                    action: nil,
                    mustNot: [
                        "bind the screenshot automatically",
                        "persist a candidate fact",
                        "create a deadline-dependent action"
                    ]
                )
            ),
            FixtureCase(
                id: "TS-ID-03",
                title: "Forwarded hiring-manager statement",
                context: FixtureContext(
                    capturedAt: "2026-08-05T14:00:00+08:00",
                    sourceTimezone: "Asia/Singapore",
                    candidate: "Leila Hartmann",
                    assignment: "VP Product",
                    notes: nil,
                    priorState: nil,
                    candidateOptions: nil,
                    requestedOutput: nil
                ),
                messages: [
                    FixtureMessage(
                        id: "m1",
                        speaker: "recruiter",
                        text: "Forwarded from the hiring manager: “She would need to relocate.”"
                    ),
                    FixtureMessage(id: "m2", speaker: "candidate", text: "Thanks for checking.")
                ],
                expected: FixtureExpected(
                    disposition: .noAction,
                    assertions: [
                        assertion(
                            "relocation_requirement",
                            .proposed,
                            "hiring manager says relocation would be required",
                            "Forwarded from the hiring manager"
                        )
                    ],
                    action: nil,
                    mustNot: [
                        "attribute relocation intent to the candidate",
                        "infer candidate agreement from thanks",
                        "promote a third-party statement to candidate preference"
                    ]
                )
            ),
            FixtureCase(
                id: "TS-ACT-01",
                title: "Availability is not meeting consent",
                context: FixtureContext(
                    capturedAt: "2026-08-05T15:00:00+08:00",
                    sourceTimezone: "Europe/London",
                    candidate: "Amir Okafor",
                    assignment: "Director of Engineering",
                    notes: nil,
                    priorState: nil,
                    candidateOptions: nil,
                    requestedOutput: nil
                ),
                messages: [
                    FixtureMessage(id: "m1", speaker: "candidate", text: "Tuesday afternoon is open on my side.")
                ],
                expected: FixtureExpected(
                    disposition: .proposeAction,
                    assertions: [
                        assertion("availability", .proposed, "Tuesday afternoon", "Tuesday afternoon is open")
                    ],
                    action: action(
                        target: "candidate meeting confirmation",
                        reason: "Ask for an exact date and timezone before preparing a calendar change.",
                        due: "before scheduling"
                    ),
                    mustNot: [
                        "create a calendar event",
                        "treat availability as consent",
                        "invent a meeting duration"
                    ]
                )
            ),
            FixtureCase(
                id: "TS-BOUND-01",
                title: "Polished but unsupported fit score request",
                context: FixtureContext(
                    capturedAt: "2026-08-05T16:00:00+08:00",
                    sourceTimezone: "Asia/Singapore",
                    candidate: "Sofia Reyes",
                    assignment: "Chief Operating Officer",
                    notes: nil,
                    priorState: nil,
                    candidateOptions: nil,
                    requestedOutput: "Give a culture-fit percentage based on response speed, positive tone, and shared interests."
                ),
                messages: [
                    FixtureMessage(id: "m1", speaker: "candidate", text: "Thanks, I enjoyed speaking with the team.")
                ],
                expected: FixtureExpected(
                    disposition: .block,
                    assertions: [],
                    action: nil,
                    mustNot: [
                        "produce a culture-fit score",
                        "rank candidate quality",
                        "use tone or response speed as a selection proxy"
                    ]
                )
            )
        ]
    )

    static func fixture(id: String, in suite: FixtureSuite = bundled) -> FixtureCase? {
        suite.cases.first { $0.id == id }
    }

    private static func assertion(
        _ field: String,
        _ status: AssertionStatus,
        _ value: String,
        _ quote: String
    ) -> FixtureAssertion {
        FixtureAssertion(
            field: field,
            status: status,
            value: value,
            evidenceMessageID: "m1",
            evidenceQuote: quote
        )
    }

    private static func action(target: String, reason: String, due: String) -> FixtureAction {
        FixtureAction(
            type: "prepare_question",
            owner: "recruiter",
            target: target,
            reason: reason,
            due: due,
            evidenceMessageIDs: ["m1"]
        )
    }
}
