import Foundation

struct PursuitWorkspaceSnapshot: Equatable {
    let workspaceID: String
    let currentUserID: String
    let currentUserName: String
    let pursuits: [WorkspacePursuit]
    let people: [WorkspacePerson]
    let proposals: [WorkspaceProposal]
    let loadedAt: Date

    var activePursuits: [WorkspacePursuit] {
        pursuits.filter { $0.status == "active" || $0.status == "paused" }
    }

    var openProposals: [WorkspaceProposal] {
        proposals.filter {
            ["needs_review", "confirming", "conflict", "failed"].contains($0.status)
        }
    }

    var todayItems: [PursuitAttentionItem] {
        activePursuits.compactMap { pursuit in
            let proposal = openProposals.first(where: { $0.pursuitID == pursuit.id })
            let action = pursuit.actions
                .filter({
                    $0.ownerUserID == currentUserID
                        && !["completed", "cancelled"].contains($0.status)
                })
                .sorted(by: WorkspaceAction.attentionOrder)
                .first
            let gap = pursuit.gaps.first(where: {
                $0.status == "open" && $0.basis.kind == "evidence_supported"
            })
            guard proposal != nil || action != nil || gap != nil else { return nil }

            let dueAction = action?.dueAt != nil
            let kind: PursuitAttentionKind = dueAction
                ? .action
                : proposal != nil ? .review : action != nil ? .action : .gap
            let priority = dueAction ? 0 : proposal != nil ? 1 : action != nil ? 2 : 3
            let evidenceState = proposal?.evidenceState ?? gap?.basis.evidenceState
            let evidenceAvailable = evidenceState?.availability == "available"
            let eyebrow: String
            if dueAction {
                eyebrow = "Due action · review context"
            } else if let proposal {
                eyebrow = evidenceAvailable
                    ? (proposal.status == "needs_review" ? "Review" : "Review interrupted")
                    : proposal.evidenceState.attentionLabel
            } else if action != nil {
                eyebrow = "Owned action"
            } else {
                eyebrow = evidenceState?.attentionLabel ?? "Current gap"
            }
            let title = action?.title
                ?? proposal?.items.first?.reason
                ?? gap?.title
                ?? pursuit.targetOutcome
            let reason = proposal.map {
                $0.evidenceState.availability == "available"
                    ? "\($0.subjectDisplayLabel) · \($0.items.first?.effectSummary ?? $0.summary)"
                    : $0.evidenceState.explanation
            } ?? gap.map {
                "\($0.basis.summary) · close when \($0.closeCondition)"
            } ?? "Owned internal action; no external effect"
            return PursuitAttentionItem(
                id: "pursuit-\(pursuit.id)",
                priority: priority,
                sortKey: action?.dueAt ?? proposal?.updatedAt ?? pursuit.updatedAt,
                kind: kind,
                pursuitID: pursuit.id,
                proposalID: proposal?.id,
                subjectDisplayLabel: proposal?.subjectDisplayLabel,
                eyebrow: eyebrow,
                title: title,
                reason: reason,
                targetOutcome: pursuit.targetOutcome.workspacePhrase,
                targetDate: pursuit.targetDate,
                blocker: gap.map {
                    "\($0.title) · \($0.basis.evidenceState.explanation) · close when \($0.closeCondition)"
                },
                evidenceObservedAt: proposal?.latestEvidence?.observedAt,
                evidenceSourceTimezone: proposal?.latestEvidence?.sourceTimezone,
                evidenceState: proposal?.evidenceState ?? gap?.basis.evidenceState,
                owner: action?.ownerDisplayName,
                due: action?.dueAt,
                proposedAction: action?.title,
                actionLabel: kind == .review
                    ? "Review proposal"
                    : kind == .action ? "Record owned action outcome" : "Open Pursuit"
            )
        }
        .sorted {
            if $0.priority != $1.priority { return $0.priority < $1.priority }
            if $0.sortKey != $1.sortKey {
                return $0.kind == .action
                    ? $0.sortKey < $1.sortKey
                    : $0.sortKey > $1.sortKey
            }
            return $0.id < $1.id
        }
    }

    var noActionPursuitCount: Int {
        let attentionIDs = Set(todayItems.map(\.pursuitID))
        return activePursuits.filter { !attentionIDs.contains($0.id) }.count
    }

    func pursuit(id: String) -> WorkspacePursuit? {
        pursuits.first { $0.id == id }
    }

    func person(id: String) -> WorkspacePerson? {
        people.first { $0.id == id }
    }

    static let preview = PursuitWorkspaceSnapshot(
        workspaceID: "preview-workspace",
        currentUserID: "10000000-0000-4000-8000-000000000001",
        currentUserName: "Preview recruiter",
        pursuits: [.previewSearch, .previewBoardSearch],
        people: [.previewLeila, .previewNia],
        proposals: [.previewProposal],
        loadedAt: Date(timeIntervalSince1970: 1_787_515_200)
    )

#if DEBUG
    static let previewMultiContextPerson: PursuitWorkspaceSnapshot = {
        let existing = preview.people[0]
        let secondContext = WorkspacePerson.Context(
            id: "21000000-0000-4000-8000-000000000003",
            displayLabel: "Portfolio advisory relationship",
            lastActivityAt: "2026-08-22T16:00:00.000Z"
        )
        let multiContextPerson = WorkspacePerson(
            id: existing.id,
            displayLabel: existing.displayLabel,
            contextCount: existing.contexts.count + 1,
            captureCount: existing.captureCount,
            confirmedIdentityCount: existing.confirmedIdentityCount,
            lastActivityAt: existing.lastActivityAt,
            profile: existing.profile,
            contexts: existing.contexts + [secondContext],
            identityMatches: existing.identityMatches
        )
        return PursuitWorkspaceSnapshot(
            workspaceID: preview.workspaceID,
            currentUserID: preview.currentUserID,
            currentUserName: preview.currentUserName,
            pursuits: preview.pursuits,
            people: [multiContextPerson] + preview.people.dropFirst(),
            proposals: preview.proposals,
            loadedAt: preview.loadedAt
        )
    }()

    static let previewLongPeople: PursuitWorkspaceSnapshot = {
        let additionalPeople = (3...50).map { sequence in
            WorkspacePerson(
                id: String(
                    format: "20000000-0000-4000-8000-%012d",
                    sequence
                ),
                displayLabel: String(format: "Continuity person %02d", sequence),
                contextCount: 1,
                captureCount: sequence % 4,
                confirmedIdentityCount: sequence % 2,
                lastActivityAt: "2026-08-20T12:00:00.000Z",
                profile: nil,
                contexts: [
                    WorkspacePerson.Context(
                        id: String(
                            format: "21000000-0000-4000-8000-%012d",
                            sequence + 1_000
                        ),
                        displayLabel: "Continuity relationship",
                        lastActivityAt: "2026-08-20T12:00:00.000Z"
                    ),
                ],
                identityMatches: []
            )
        }
        return PursuitWorkspaceSnapshot(
            workspaceID: preview.workspaceID,
            currentUserID: preview.currentUserID,
            currentUserName: preview.currentUserName,
            pursuits: preview.pursuits,
            people: preview.people + additionalPeople,
            proposals: preview.proposals,
            loadedAt: preview.loadedAt
        )
    }()
#endif
}

struct WorkspacePursuit: Decodable, Equatable, Identifiable {
    let id: String
    let workspaceID: String
    let type: String
    let title: String
    let targetOutcome: String
    let targetDate: String
    let status: String
    let milestone: String
    let milestoneAuthority: MilestoneAuthority
    let revision: Int
    let roles: [WorkspaceRole]
    let criteria: [WorkspaceCriterion]
    let gaps: [WorkspaceGap]
    let actions: [WorkspaceAction]
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, type, title, status, milestone, revision, roles, criteria, gaps, actions
        case workspaceID = "workspace_id"
        case targetOutcome = "target_outcome"
        case targetDate = "target_date"
        case milestoneAuthority = "milestone_authority"
        case updatedAt = "updated_at"
    }

    var personRoles: [WorkspaceRole] {
        roles.filter { $0.subjectRef.type == "person" && $0.status != "removed" }
    }

    var openGapCount: Int { gaps.filter { $0.status == "open" }.count }

    var openActionCount: Int {
        actions.filter { !["completed", "cancelled"].contains($0.status) }.count
    }
}

struct MilestoneAuthority: Decodable, Equatable {
    let kind: String
    let evidenceRefs: [String]
    let evidenceState: WorkspaceEvidenceState
    let confirmedByUserID: String?
    let confirmedAt: String?
    let proposalID: String?
    let receiptID: String?

    enum CodingKeys: String, CodingKey {
        case kind
        case evidenceRefs = "evidence_refs"
        case evidenceState = "evidence_state"
        case confirmedByUserID = "confirmed_by_user_id"
        case confirmedAt = "confirmed_at"
        case proposalID = "proposal_id"
        case receiptID = "receipt_id"
    }
}

struct WorkspaceRole: Decodable, Equatable, Identifiable {
    let id: String
    let subjectRef: SubjectRef
    let roleType: String
    let status: String
    let confidence: String
    let basis: Basis
    let evidenceRefs: [String]
    let evidenceState: WorkspaceEvidenceState

    struct Basis: Decodable, Equatable {
        let kind: String
        let attributedByUserID: String?

        enum CodingKeys: String, CodingKey {
            case kind
            case attributedByUserID = "attributed_by_user_id"
        }
    }

    struct SubjectRef: Decodable, Equatable {
        let type: String
        let id: String
    }

    enum CodingKeys: String, CodingKey {
        case id, status, confidence, basis
        case subjectRef = "subject_ref"
        case roleType = "role_type"
        case evidenceRefs = "evidence_refs"
        case evidenceState = "evidence_state"
    }
}

struct WorkspaceCriterion: Decodable, Equatable, Identifiable {
    let id: String
    let label: String
    let requirement: String
    let status: String
}

struct WorkspaceGap: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let status: String
    let basis: Basis
    let closeCondition: String

    struct Basis: Decodable, Equatable {
        let kind: String
        let summary: String
        let evidenceRefs: [String]
        let attributedByUserID: String?
        let evidenceState: WorkspaceEvidenceState

        enum CodingKeys: String, CodingKey {
            case kind, summary
            case evidenceRefs = "evidence_refs"
            case attributedByUserID = "attributed_by_user_id"
            case evidenceState = "evidence_state"
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, title, status, basis
        case closeCondition = "close_condition"
    }
}

struct WorkspaceAction: Decodable, Equatable, Identifiable {
    let id: String
    let gapID: String?
    let title: String
    let ownerUserID: String
    let ownerDisplayName: String
    let status: String
    let dueAt: String?
    let outcomeSummary: String?
    let completedAt: String?
    let externalEffects: [String]
    let revision: Int

    enum CodingKeys: String, CodingKey {
        case id, title, status, revision
        case gapID = "gap_id"
        case ownerUserID = "owner_user_id"
        case ownerDisplayName = "owner_display_name"
        case dueAt = "due_at"
        case outcomeSummary = "outcome_summary"
        case completedAt = "completed_at"
        case externalEffects = "external_effects"
    }

    static func attentionOrder(_ lhs: WorkspaceAction, _ rhs: WorkspaceAction) -> Bool {
        switch (lhs.dueAt, rhs.dueAt) {
        case let (left?, right?): return left == right ? lhs.id < rhs.id : left < right
        case (.some, .none): return true
        case (.none, .some): return false
        case (.none, .none): return lhs.id < rhs.id
        }
    }
}

struct WorkspacePerson: Decodable, Equatable, Identifiable {
    let id: String
    let displayLabel: String
    let contextCount: Int
    let captureCount: Int
    let confirmedIdentityCount: Int
    let lastActivityAt: String
    let profile: Profile?
    let avatar: Avatar?
    let contexts: [Context]
    var identityMatches: [IdentityMatch] = []

    init(
        id: String,
        displayLabel: String,
        contextCount: Int,
        captureCount: Int,
        confirmedIdentityCount: Int,
        lastActivityAt: String,
        profile: Profile?,
        avatar: Avatar? = nil,
        contexts: [Context],
        identityMatches: [IdentityMatch] = []
    ) {
        self.id = id
        self.displayLabel = displayLabel
        self.contextCount = contextCount
        self.captureCount = captureCount
        self.confirmedIdentityCount = confirmedIdentityCount
        self.lastActivityAt = lastActivityAt
        self.profile = profile
        self.avatar = avatar
        self.contexts = contexts
        self.identityMatches = identityMatches
    }

    struct IdentityMatch: Decodable, Equatable {
        let kind: String
        let handleType: String?
        let displayHint: String?
        let sourceResourceID: String?
        let expiredAt: String?

        enum CodingKeys: String, CodingKey {
            case kind
            case handleType = "handle_type"
            case displayHint = "display_hint"
            case sourceResourceID = "source_resource_id"
            case expiredAt = "expired_at"
        }
    }

    struct Profile: Decodable, Equatable {
        let headline: String
        let summary: String
        let provenanceKind: String
        let authoredByUserID: String
        let sourceProfileURL: String?
        let sourcePlatform: String?
        let revision: Int
        let updatedAt: String

        init(
            headline: String,
            summary: String,
            provenanceKind: String,
            authoredByUserID: String,
            sourceProfileURL: String? = nil,
            sourcePlatform: String? = nil,
            revision: Int,
            updatedAt: String
        ) {
            self.headline = headline
            self.summary = summary
            self.provenanceKind = provenanceKind
            self.authoredByUserID = authoredByUserID
            self.sourceProfileURL = sourceProfileURL
            self.sourcePlatform = sourcePlatform
            self.revision = revision
            self.updatedAt = updatedAt
        }

        enum CodingKeys: String, CodingKey {
            case headline, summary, revision
            case provenanceKind = "provenance_kind"
            case authoredByUserID = "authored_by_user_id"
            case sourceProfileURL = "source_profile_url"
            case sourcePlatform = "source_platform"
            case updatedAt = "updated_at"
        }
    }

    struct Avatar: Decodable, Equatable {
        let url: String
        let sourceProfileURL: String
        let sourcePlatform: String
        let retrievedAt: String
        let confirmedAt: String

        enum CodingKeys: String, CodingKey {
            case url
            case sourceProfileURL = "source_profile_url"
            case sourcePlatform = "source_platform"
            case retrievedAt = "retrieved_at"
            case confirmedAt = "confirmed_at"
        }
    }

    struct Context: Decodable, Equatable, Identifiable {
        let id: String
        let displayLabel: String
        let lastActivityAt: String

        enum CodingKeys: String, CodingKey {
            case id
            case displayLabel = "display_label"
            case lastActivityAt = "last_activity_at"
        }
    }

    enum CodingKeys: String, CodingKey {
        case id
        case displayLabel = "display_label"
        case contextCount = "context_count"
        case captureCount = "capture_count"
        case confirmedIdentityCount = "confirmed_identity_count"
        case lastActivityAt = "last_activity_at"
        case profile
        case avatar
        case contexts
        case identityMatches = "identity_matches"
    }
}

struct WorkspaceProposal: Decodable, Equatable, Identifiable {
    let id: String
    let pursuitID: String
    let baseRevision: Int
    let summary: String
    let status: String
    let evidenceState: WorkspaceEvidenceState
    let reviewContext: ReviewContext
    let items: [Item]
    let updatedAt: String

    struct ReviewContext: Decodable, Equatable {
        let subject: Subject
        let evidence: [Evidence]

        struct Subject: Decodable, Equatable {
            let displayLabel: String

            enum CodingKeys: String, CodingKey {
                case displayLabel = "display_label"
            }
        }

        struct Evidence: Decodable, Equatable {
            let observedAt: String
            let sourceTimezone: String?

            enum CodingKeys: String, CodingKey {
                case observedAt = "observed_at"
                case sourceTimezone = "source_timezone"
            }
        }
    }

    struct Item: Decodable, Equatable {
        let id: String
        let epistemicStatus: String
        let evidenceRefs: [String]
        let evidenceState: WorkspaceEvidenceState
        let reason: String
        let effectSummary: String

        enum CodingKeys: String, CodingKey {
            case id, reason
            case epistemicStatus = "epistemic_status"
            case evidenceRefs = "evidence_refs"
            case evidenceState = "evidence_state"
            case effectSummary = "effect_summary"
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, summary, status, items
        case pursuitID = "pursuit_id"
        case baseRevision = "base_revision"
        case reviewContext = "review_context"
        case evidenceState = "evidence_state"
        case updatedAt = "updated_at"
    }

    var subjectDisplayLabel: String { reviewContext.subject.displayLabel }
    var evidenceCount: Int { Set(items.flatMap(\.evidenceRefs)).count }
    var latestEvidence: ReviewContext.Evidence? {
        reviewContext.evidence.max { $0.observedAt < $1.observedAt }
    }
}

struct WorkspaceEvidenceState: Decodable, Equatable {
    let availability: String
    let referenceCount: Int
    let availableReferenceCount: Int
    let unavailableReferenceCount: Int

    enum CodingKeys: String, CodingKey {
        case availability
        case referenceCount = "reference_count"
        case availableReferenceCount = "available_reference_count"
        case unavailableReferenceCount = "unavailable_reference_count"
    }

    var attentionLabel: String {
        switch availability {
        case "available": return "Evidence-backed gap"
        case "partial": return "Evidence partly unavailable"
        case "not_required": return "Recruiter-authored"
        default: return "Evidence unavailable"
        }
    }

    var explanation: String {
        switch availability {
        case "available":
            return "\(availableReferenceCount) reviewed evidence reference\(availableReferenceCount == 1 ? "" : "s")"
        case "partial":
            return "\(availableReferenceCount) of \(referenceCount) evidence references remain authoritative"
        case "not_required":
            return "Explicitly recorded by the recruiter; no evidence authority is claimed"
        default:
            return "No cited evidence remains authoritative; a new reviewed source is required"
        }
    }

    static let availableOne = WorkspaceEvidenceState(
        availability: "available",
        referenceCount: 1,
        availableReferenceCount: 1,
        unavailableReferenceCount: 0
    )

    static let availableTwo = WorkspaceEvidenceState(
        availability: "available",
        referenceCount: 2,
        availableReferenceCount: 2,
        unavailableReferenceCount: 0
    )
}

enum PursuitAttentionKind: String, Equatable {
    case review
    case action
    case gap
}

struct PursuitAttentionItem: Equatable, Identifiable {
    let id: String
    let priority: Int
    let sortKey: String
    let kind: PursuitAttentionKind
    let pursuitID: String
    let proposalID: String?
    let subjectDisplayLabel: String?
    let eyebrow: String
    let title: String
    let reason: String
    let targetOutcome: String
    let targetDate: String
    let blocker: String?
    let evidenceObservedAt: String?
    let evidenceSourceTimezone: String?
    let evidenceState: WorkspaceEvidenceState?
    let owner: String?
    let due: String?
    let proposedAction: String?
    let actionLabel: String
}

enum WorkspaceDate {
    static func short(_ value: String) -> String {
        let source = DateFormatter()
        source.locale = Locale(identifier: "en_US_POSIX")
        source.calendar = Calendar(identifier: .gregorian)
        source.timeZone = TimeZone(secondsFromGMT: 0)
        source.dateFormat = "yyyy-MM-dd"

        let output = DateFormatter()
        output.locale = Locale(identifier: "en_US_POSIX")
        output.calendar = Calendar(identifier: .gregorian)
        output.timeZone = TimeZone(secondsFromGMT: 0)
        output.dateFormat = "MMM d, yyyy"

        let day = String(value.prefix(10))
        return source.date(from: day).map(output.string) ?? day
    }

    static func evidenceFreshness(
        observedAt value: String,
        sourceTimezone: String?
    ) -> String {
        timestamp(value, sourceTimezone: sourceTimezone, prefix: "Observed")
    }

    static func recorded(
        at value: String,
        sourceTimezone: String?
    ) -> String {
        timestamp(value, sourceTimezone: sourceTimezone, prefix: "Recorded")
    }

    private static func timestamp(
        _ value: String,
        sourceTimezone: String?,
        prefix: String
    ) -> String {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        guard let date = fractional.date(from: value) ?? standard.date(from: value) else {
            return "\(prefix) at an unparsed source time: \(value)\(sourceTimezone.map { " · \($0)" } ?? "")"
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = sourceTimezone.flatMap(TimeZone.init(identifier:))
            ?? TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "MMM d, yyyy h:mm a"
        let age = RelativeDateTimeFormatter().localizedString(
            for: date,
            relativeTo: Date()
        )
        let zone = sourceTimezone ?? "UTC"
        return "\(prefix) \(age) · \(formatter.string(from: date)) · \(zone)"
    }
}

fileprivate extension WorkspacePerson {
    static let previewLeila = WorkspacePerson(
        id: "20000000-0000-4000-8000-000000000001",
        displayLabel: "Leila Hartmann",
        contextCount: 1,
        captureCount: 1,
        confirmedIdentityCount: 1,
        lastActivityAt: "2026-08-23T18:00:00.000Z",
        profile: .init(
            headline: "VP Product · Meridian Labs",
            summary: "Product leader in a recruiter-authored synthetic preview.",
            provenanceKind: "user_authored",
            authoredByUserID: "10000000-0000-4000-8000-000000000001",
            revision: 1,
            updatedAt: "2026-08-23T18:00:00.000Z"
        ),
        contexts: [
            .init(
                id: "21000000-0000-4000-8000-000000000001",
                displayLabel: "Chief Product Officer search",
                lastActivityAt: "2026-08-23T18:00:00.000Z"
            ),
        ]
    )

    static let previewNia = WorkspacePerson(
        id: "20000000-0000-4000-8000-000000000002",
        displayLabel: "Nia Williams",
        contextCount: 1,
        captureCount: 1,
        confirmedIdentityCount: 1,
        lastActivityAt: "2026-08-23T15:00:00.000Z",
        profile: .init(
            headline: "Operating Partner · Northlight Capital",
            summary: "Board adviser in a recruiter-authored synthetic preview.",
            provenanceKind: "user_authored",
            authoredByUserID: "10000000-0000-4000-8000-000000000001",
            revision: 1,
            updatedAt: "2026-08-23T15:00:00.000Z"
        ),
        contexts: [
            .init(
                id: "21000000-0000-4000-8000-000000000002",
                displayLabel: "Board search",
                lastActivityAt: "2026-08-23T15:00:00.000Z"
            ),
        ]
    )
}

fileprivate extension WorkspacePursuit {
    static let previewSearch = WorkspacePursuit(
        id: "30000000-0000-4000-8000-000000000001",
        workspaceID: "preview-workspace",
        type: "recruiting",
        title: "Chief Product Officer search",
        targetOutcome: "A mutual final decision with the selected candidate",
        targetDate: "2026-09-18",
        status: "active",
        milestone: "client_alignment",
        milestoneAuthority: .init(
            kind: "evidence_supported",
            evidenceRefs: ["50000000-0000-4000-8000-000000000001"],
            evidenceState: .availableOne,
            confirmedByUserID: "10000000-0000-4000-8000-000000000001",
            confirmedAt: "2026-08-23T18:00:00.000Z",
            proposalID: "80000000-0000-4000-8000-000000000001",
            receiptID: "81000000-0000-4000-8000-000000000001"
        ),
        revision: 3,
        roles: [
            WorkspaceRole(
                id: "40000000-0000-4000-8000-000000000001",
                subjectRef: .init(type: "person", id: WorkspacePerson.previewLeila.id),
                roleType: "candidate",
                status: "active",
                confidence: "confirmed",
                basis: .init(kind: "evidence_supported", attributedByUserID: nil),
                evidenceRefs: ["50000000-0000-4000-8000-000000000001"],
                evidenceState: .availableOne
            )
        ],
        criteria: [
            WorkspaceCriterion(
                id: "60000000-0000-4000-8000-000000000001",
                label: "Location",
                requirement: "Agree a workable leadership location model",
                status: "active"
            )
        ],
        gaps: [],
        actions: [],
        updatedAt: "2026-08-23T18:00:00.000Z"
    )

    static let previewBoardSearch = WorkspacePursuit(
        id: "30000000-0000-4000-8000-000000000002",
        workspaceID: "preview-workspace",
        type: "recruiting",
        title: "Independent board director search",
        targetOutcome: "Present an evidence-backed shortlist to the chair",
        targetDate: "2026-10-02",
        status: "active",
        milestone: "evidence_review",
        milestoneAuthority: .init(
            kind: "user_authored",
            evidenceRefs: [],
            evidenceState: .init(
                availability: "not_required",
                referenceCount: 0,
                availableReferenceCount: 0,
                unavailableReferenceCount: 0
            ),
            confirmedByUserID: "10000000-0000-4000-8000-000000000001",
            confirmedAt: "2026-08-23T15:00:00.000Z",
            proposalID: nil,
            receiptID: nil
        ),
        revision: 2,
        roles: [
            WorkspaceRole(
                id: "40000000-0000-4000-8000-000000000002",
                subjectRef: .init(type: "person", id: WorkspacePerson.previewNia.id),
                roleType: "candidate",
                status: "active",
                confidence: "confirmed",
                basis: .init(
                    kind: "user_authored",
                    attributedByUserID: "10000000-0000-4000-8000-000000000001"
                ),
                evidenceRefs: [],
                evidenceState: .init(
                    availability: "not_required",
                    referenceCount: 0,
                    availableReferenceCount: 0,
                    unavailableReferenceCount: 0
                )
            )
        ],
        criteria: [],
        gaps: [
            WorkspaceGap(
                id: "70000000-0000-4000-8000-000000000001",
                title: "Current travel cadence is unresolved",
                status: "open",
                basis: .init(
                    kind: "evidence_supported",
                    summary: "Two reviewed sources disagree.",
                    evidenceRefs: [
                        "50000000-0000-4000-8000-000000000002",
                        "50000000-0000-4000-8000-000000000003"
                    ],
                    attributedByUserID: nil,
                    evidenceState: .availableTwo
                ),
                closeCondition: "Nia confirms the current cadence"
            )
        ],
        actions: [],
        updatedAt: "2026-08-23T15:00:00.000Z"
    )
}

fileprivate extension WorkspaceProposal {
    static let previewProposal = WorkspaceProposal(
        id: "80000000-0000-4000-8000-000000000001",
        pursuitID: WorkspacePursuit.previewSearch.id,
        baseRevision: 3,
        summary: "Remote-work dependency may have changed",
        status: "needs_review",
        evidenceState: .availableOne,
        reviewContext: .init(
            subject: .init(displayLabel: "Leila Hartmann"),
            evidence: [
                .init(
                    observedAt: "2026-08-23T18:00:00.000Z",
                    sourceTimezone: "Europe/Berlin"
                )
            ]
        ),
        items: [
            .init(
                id: "90000000-0000-4000-8000-000000000001",
                epistemicStatus: "inference",
                evidenceRefs: ["50000000-0000-4000-8000-000000000001"],
                evidenceState: .availableOne,
                reason: "The candidate described a location constraint.",
                effectSummary: "Would update only this Pursuit after review."
            )
        ],
        updatedAt: "2026-08-23T18:00:00.000Z"
    )
}
