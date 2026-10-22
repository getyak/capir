import Foundation

/// A durable locator, never permission to mutate a saved conversation.
struct ConversationMemoryProposalReference: Codable, Equatable, Hashable {
    let proposal_id: String
    let revision: Int
    var isValid: Bool { UUID(uuidString: proposal_id) != nil && revision > 0 }
}

/// Chosen from the trusted answer producer and its canonical Session, never
/// from a visual contact selection. A queue turn remains private Chat even
/// when that Session also has a selected relationship.
enum ConversationMemoryReviewScope: Codable, Equatable, Hashable {
    case chat
    case relationship(personID: String, contextID: String)

    var purpose: String { if case .chat = self { return "chat" }; return "relationship" }
    var allowedScope: String { if case .chat = self { return "all" }; return "relationship" }
    var personID: String? { if case let .relationship(id, _) = self { return id }; return nil }
    var contextID: String? { if case let .relationship(_, id) = self { return id }; return nil }
    var allowsIdentityChanges: Bool { self == .chat }
    var isValid: Bool {
        if case let .relationship(person, context) = self { return UUID(uuidString: person) != nil && UUID(uuidString: context) != nil }
        return true
    }
    var bindingKey: String { "\(purpose)|\(personID ?? "")|\(contextID ?? "")" }
}

struct ConversationMemoryOpenReviewRequest: Encodable {
    let purpose: String
    let session_id: String
    let person_id: String?
    let relationship_context_id: String?
    init(scope: ConversationMemoryReviewScope, sessionID: UUID) {
        purpose = scope.purpose; session_id = sessionID.uuidString.lowercased()
        person_id = scope.personID; relationship_context_id = scope.contextID
    }
}

struct ConversationMemoryReview: Decodable, Equatable {
    let contract_version: String
    let review_scope_id: String
    let review_revision: Int
    let purpose: String
    let allowed_scope: String
    let proposal_id: String
    let proposal_revision: Int
    let person_id: String?
    let relationship_context_id: String?
    let person_display_label: String?
    let relationship_display_label: String?
    let source_session_id: String?
    let source_message_id: String?
    let contact_decision: String
    let contact_status: String
    let status: String
    let expires_at: String
    let source_status: String
    let items: [ConversationMemoryItem]
    let draft: ConversationMemoryDraft?

    func validate(proposal: ConversationMemoryProposalReference, sessionID: UUID, messageID: UUID?,
                  sourceMessageIDs: Set<UUID>? = nil, scope: ConversationMemoryReviewScope = .chat) throws {
        let admittedMessages = sourceMessageIDs ?? messageID.map { Set([$0]) }
        guard contract_version == TalentSignalAPIContract.version,
              UUID(uuidString: review_scope_id) != nil,
              UUID(uuidString: proposal_id) == UUID(uuidString: proposal.proposal_id),
              proposal_revision >= proposal.revision, review_revision >= 0,
              scope.isValid, purpose == scope.purpose, allowed_scope == scope.allowedScope,
              UUID(uuidString: source_session_id ?? "") == sessionID,
              let actualSourceMessage = UUID(uuidString: source_message_id ?? ""),
              admittedMessages == nil || admittedMessages?.contains(actualSourceMessage) == true,
              ["new", "existing", "none"].contains(contact_decision),
              ["pending", "resolved", "ambiguous"].contains(contact_status),
              items.count <= 200, Set(items.map(\.id)).count == items.count,
              items.allSatisfy({ item in
                  item.isValid
                      && (item.source_locator.session_id == nil || UUID(uuidString: item.source_locator.session_id ?? "") == sessionID)
                      && (item.source_locator.message_id == nil || UUID(uuidString: item.source_locator.message_id ?? "") == UUID(uuidString: source_message_id ?? ""))
              }),
              ["available", "unavailable"].contains(source_status) else {
            throw ConversationMemoryReviewError.invalidScope
        }
        if case let .relationship(person, context) = scope {
            guard UUID(uuidString: person_id ?? "") == UUID(uuidString: person),
                  UUID(uuidString: relationship_context_id ?? "") == UUID(uuidString: context),
                  contact_decision == "existing", contact_status == "resolved",
                  items.allSatisfy({ item in
                      item.scope == "relationship"
                          && UUID(uuidString: item.subject_id ?? "") == UUID(uuidString: person)
                          && UUID(uuidString: item.relationship_context_id ?? "") == UUID(uuidString: context)
                  }) else { throw ConversationMemoryReviewError.invalidScope }
        }
    }

    var isCurrent: Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: expires_at) ?? ISO8601DateFormatter().date(from: expires_at)
        return ["open", "partially_committed"].contains(status) && (date.map { $0 > Date() } ?? false)
    }
}

struct ConversationMemoryItem: Decodable, Equatable, Identifiable {
    let id: String
    let scope: String
    let subject_id: String?
    let relationship_context_id: String?
    let operation: String
    let statement_kind: String
    let display_text: String
    let previous_text: String?
    let previous_revision: Int?
    let admission_status: String
    let judgment_kind: String
    let judgment_reason: String?
    let default_selected: Bool
    let source_excerpt: String
    let source_locator: Locator
    let added_revision: Int
    let status: String

    struct Locator: Decodable, Equatable {
        let kind: String
        let session_id: String?
        let message_id: String?
        let image_index: Int?
        let artifact_id: String?
    }
    var isValid: Bool {
        UUID(uuidString: id) != nil && added_revision > 0 && !display_text.isEmpty
            && display_text.utf16.count <= 1_000 && source_excerpt.utf16.count <= 4_000
            && ["self", "person", "relationship"].contains(scope)
            && ["eligible", "needs_judgment", "ineligible"].contains(admission_status)
            && ["pending", "committed", "skipped"].contains(status)
            && ["message", "image_region", "document"].contains(source_locator.kind)
            && (source_locator.image_index.map { (0...9).contains($0) } ?? true)
    }
    var requiresJudgment: Bool { admission_status == "needs_judgment" || judgment_kind != "ordinary" }
    var canSelect: Bool { status == "pending" && admission_status != "ineligible" }
}

struct ConversationMemoryDraft: Decodable, Equatable {
    let contact_decision: String
    let selected_item_ids: [String]
    let edited_text: [String: String]
    let item_decisions: [String: String]
    let revision: Int
}

struct ConversationMemoryDraftUpdate: Encodable {
    let expected_review_revision: Int
    let contact_decision: String
    let selected_item_ids: [String]
    let edited_text: [String: String]
    let item_decisions: [String: String]
}

struct ConversationMemoryReviewEnvelope: Decodable {
    let contract_version: String
    let review_credential: String?
    let review: ConversationMemoryReview
}

struct ConversationMemoryReceipt: Decodable, Equatable {
    let contract_version: String
    let commit_id: String
    let operation_key: String
    let proposal_id: String
    let proposal_revision: Int
    let status: String
    let contact_decision: String
    let created_person_id: String?
    let person_display_label: String?
    let created_relationship_context_id: String?
    let applied_item_count: Int
    let created_item_ids: [String]
    let updated_item_ids: [String]
}

struct ConversationMemoryOperationView: Decodable {
    let contract_version: String
    let operation_key: String
    let state: String
    let purpose: String
    let person_id: String?
    let relationship_context_id: String?
    let source_session_id: String?
    let visible_receipt: ConversationMemoryReceipt?
}

struct ConversationMemoryDestination: Equatable {
    let personID: String?
    let personDisplayLabel: String?
    let savedItemCount: Int
    let operationKey: String
    var contactWasCreated: Bool = false
}

struct ConversationMemoryItemDecision: Codable {
    let idempotency_key: String
    let expected_proposal_revision: Int
    let expected_review_revision: Int
    let item_id: String
    let expected_item_added_revision: Int
    let expected_item_version: Int?
    let contact_decision: String
    let decision: String
    let edited_text: String
    let reason: String = "User explicitly confirmed this source-linked detail in the conversation."
}

struct ConversationMemoryItemDecisionResponse: Decodable {
    let contract_version: String
    let kind: String
    let item_id: String
    let receipt: ConversationMemoryReceipt?
    let proposal_revision: Int
    let remaining_pending_item_count: Int
}

struct ConversationMemoryPerson: Decodable, Equatable, Identifiable {
    let id: String
    let display_label: String
    let contexts: [Context]
    let identity_matches: [IdentityMatch]?
    struct Context: Decodable, Equatable, Identifiable {
        let id: String
        let display_label: String
    }
    struct IdentityMatch: Decodable, Equatable {
        let kind: String
        let display_hint: String?
    }
}

struct ConversationMemoryCommit: Codable, Equatable {
    let idempotency_key: String
    let expected_proposal_revision: Int
    let contact_decision: String
    let identity_authority: String
    let person_id: String?
    let relationship_context_id: String?
    let selected_item_ids: [String]
    let edited_text: [String: String]
    let item_decisions: [String: String]
    let expected_item_versions: [String: Int]
    let new_contact: NewContact?
    let reason: String
    struct NewContact: Codable, Equatable {
        let display_label: String
        let relationship_context: String
    }
}

struct ConversationMemoryRebase: Codable {
    let idempotency_key: String
    let expected_proposal_revision: Int
    let contact_decision: String
    let identity_authority: String = "human_selection"
    let person_id: String?
    let relationship_context_id: String?
    let new_contact: ConversationMemoryCommit.NewContact?
    let reason: String = "User explicitly corrected the contact in the conversation review."
}

struct ConversationMemoryRebaseResponse: Decodable {
    let contract_version: String
    let proposal: Proposal
    struct Proposal: Decodable { let proposal_id: String; let revision: Int }
}

enum ConversationMemoryReviewError: Error, Equatable {
    case invalidScope
    case unavailable
    case backend(status: Int, code: String, operationKey: String?)

    var requiresReopen: Bool {
        guard case let .backend(_, code, _) = self else { return self == .invalidScope }
        return code.contains("STALE") || code.contains("REBASE") || code.contains("EXPIRED")
            || code.contains("SCOPE") || code.contains("REVISION") || code.contains("REVOKED")
            || code.contains("SOURCE_UNAVAILABLE")
    }
}
