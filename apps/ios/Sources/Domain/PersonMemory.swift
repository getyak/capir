import Foundation

/// A read projection. Saving a source statement never promotes it to a fact.
struct PersonMemoryItem: Decodable, Equatable, Identifiable {
    let id: String
    let scope: String
    let statement_kind: String
    let display_text: String
    let original_display_text: String
    let subject_id: String?
    let relationship_context_id: String?
    let speaker: String?
    let reporter: String?
    let valid_time: String?
    let observed_time: String?
    let time_status: String
    let sensitivity: String
    let version: Int
    let conflict_group_id: String?
    let evidence_retained: Bool
    let evidence_refs: [Evidence]
    let created_at: String

    struct Evidence: Decodable, Equatable {
        let excerpt: String
        let locator: Locator
        let capture_id: String?
        let source_resource_id: String?
        let source_session_id: String?
        let source_message_id: String?

        struct Locator: Decodable, Equatable {
            let kind: String
            let session_id: String?
            let message_id: String?
            let image_index: Int?
        }
    }

    func belongs(to personID: String, contextID: String?) -> Bool {
        guard UUID(uuidString: personID) != nil, UUID(uuidString: id) != nil,
              UUID(uuidString: subject_id ?? "") == UUID(uuidString: personID),
              ["fact", "source_statement", "user_opinion"].contains(statement_kind),
              ["known", "unknown", "future", "past"].contains(time_status),
              !display_text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              display_text.count <= 1_000, original_display_text.count <= 1_000,
              version > 0, evidence_retained, !evidence_refs.isEmpty,
              ["normal", "sensitive"].contains(sensitivity),
              evidence_refs.count <= 10,
              evidence_refs.allSatisfy({ !$0.excerpt.isEmpty && $0.excerpt.count <= 4_000 }) else {
            return false
        }
        switch scope {
        case "person": return relationship_context_id == nil
        case "relationship":
            guard let contextID else { return false }
            return UUID(uuidString: relationship_context_id ?? "") == UUID(uuidString: contextID)
        default: return false // Private self Memory never belongs on a contact page.
        }
    }
}

struct PersonMemoryPage: Decodable {
    let contract_version: String
    let surface: String
    let person_id: String?
    let relationship_context_id: String?
    let items: [PersonMemoryItem]
    let has_more: Bool?
    let next_cursor: String?

    func validate(personID: String, contextID: String?) throws {
        guard UUID(uuidString: personID) != nil,
              contextID == nil || UUID(uuidString: contextID ?? "") != nil,
              contract_version == TalentSignalAPIContract.version,
              surface == (contextID == nil ? "people" : "relationship"),
              UUID(uuidString: person_id ?? "") == UUID(uuidString: personID),
              (contextID == nil && relationship_context_id == nil)
                || (contextID != nil && UUID(uuidString: relationship_context_id ?? "") == UUID(uuidString: contextID ?? "")),
              items.count <= 100, Set(items.map(\.id)).count == items.count,
              items.allSatisfy({ $0.belongs(to: personID, contextID: contextID) }),
              has_more != true || (next_cursor.map { !$0.isEmpty && $0.count <= 500 } ?? false)
        else { throw ConversationMemoryReviewError.invalidScope }
    }
}

enum PersonHandbookPolicy {
    static func roles(for personID: String, in snapshot: PursuitWorkspaceSnapshot?) -> [WorkspacePersonRole] {
        snapshot?.pursuits.flatMap { pursuit in
            pursuit.personRoles.filter { $0.subjectRef.id == personID }.map {
                WorkspacePersonRole(pursuitID: pursuit.id, pursuitTitle: pursuit.title,
                    roleID: $0.id, roleType: $0.roleType, status: $0.status,
                    confidence: $0.confidence, evidenceCount: $0.evidenceRefs.count,
                    evidenceState: $0.evidenceState)
            }
        } ?? []
    }
    /// Multiple relationships require a decision; array order is not authority.
    static func initialContextID(for person: WorkspacePerson) -> String? {
        person.contexts.count == 1 ? person.contexts.first?.id : nil
    }

    static func excerpt(in items: [PersonMemoryItem]) -> PersonMemoryItem? {
        // Do not broadcast sensitive or contested material on the overview.
        items.first { $0.scope == "person" && $0.sensitivity == "normal" && $0.conflict_group_id == nil }
            ?? items.first { $0.sensitivity == "normal" && $0.conflict_group_id == nil }
    }

    /// This is explicitly a person-linked Pursuit, not an inferred relationship
    /// association. With several active Pursuits, disclose the list instead.
    static func work(for personID: String, in snapshot: PursuitWorkspaceSnapshot?)
        -> (pursuit: WorkspacePursuit, action: WorkspaceAction)? {
        let pursuits = snapshot?.pursuits.filter { pursuit in
            pursuit.status == "active" && pursuit.personRoles.contains {
                $0.subjectRef.id == personID && $0.status == "active"
                    && $0.confidence == "confirmed"
                    && ["available", "not_required"].contains($0.evidenceState.availability)
            }
        } ?? []
        guard pursuits.count == 1, let pursuit = pursuits.first,
              let action = pursuit.actions.first(where: { !["completed", "cancelled"].contains($0.status) })
        else { return nil }
        return (pursuit, action)
    }
}

enum PersonMemoryPresentation {
    static func kindKey(_ item: PersonMemoryItem) -> String {
        switch item.statement_kind {
        case "source_statement": "Source statement"
        case "user_opinion": "Recorded view"
        default: "Saved fact"
        }
    }

    static func timeKey(_ item: PersonMemoryItem) -> String? {
        switch item.time_status {
        case "known": nil
        case "future": "Future statement"
        case "past": "Past statement"
        default: "Timing unknown"
        }
    }

    static func caption(_ item: PersonMemoryItem, language: AppLanguage) -> String {
        var parts = [language.text(kindKey(item))]
        if let speaker = item.speaker, !speaker.isEmpty { parts.append(speaker) }
        if let key = timeKey(item) { parts.append(language.text(key)) }
        if item.conflict_group_id != nil { parts.append(language.text("Conflicting records need review.")) }
        return parts.joined(separator: " · ")
    }

    static func actionKey(_ status: String) -> String {
        switch status {
        case "drafted": "Drafted"
        case "awaiting_confirmation": "Awaiting Confirmation"
        case "scheduled": "Scheduled"
        case "in_progress": "In Progress"
        case "completed": "Completed"
        case "cancelled": "Cancelled"
        case "failed": "Failed"
        default: "Status unavailable"
        }
    }
}
