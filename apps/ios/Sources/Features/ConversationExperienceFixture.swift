import SwiftUI
import UIKit

#if DEBUG
/// Explicitly synthetic and preview-only: exercises the production review and
/// image controls without accessing an account or invoking a model.
struct ConversationExperienceFixtureView: View {
    let language: AppLanguage
    let mode: String
    let compact: Bool
    let onSource: () -> Void
    private let source: AskMediaDraft
    @StateObject private var reviewStore: ConversationMemoryReviewStore

    init(language: AppLanguage, mode: String, compact: Bool, onSource: @escaping () -> Void) {
        self.language = language; self.mode = mode; self.compact = compact
        self.onSource = onSource
        source = Self.makeSource()
        let client = ConversationExperienceFixtureClient(failsOpen: mode == "error")
        let defaults = UserDefaults(suiteName: "talent-signal.conversation-experience.preview") ?? .standard
        _reviewStore = StateObject(wrappedValue: ConversationMemoryReviewStore(
            proposal: .init(proposal_id: ConversationExperienceFixtureClient.proposalID, revision: 1),
            sessionID: ConversationExperienceFixtureClient.sessionID,
            sourceMessageID: ConversationExperienceFixtureClient.messageID,
            client: client, defaults: defaults,
            intentPersistence: ConversationExperienceMemoryIntents()
        ))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
                Text(language.text("Synthetic preview · no account data changes"))
                    .font(.caption).foregroundStyle(Color.tsMutedInk)
                    .accessibilityIdentifier("conversation-experience-synthetic-boundary")
                ConversationPendingImageSources(drafts: [source], language: language)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .id("conversation-experience-source")
                if mode == "processing" {
                    ConversationImageProgressView(state: processingState, language: language, onCheck: {})
                } else {
                    Text(language.text("Review the contact and the detail you want to keep."))
                        .font(.body).fixedSize(horizontal: false, vertical: true)
                    ConversationMemoryReviewCard(store: reviewStore, language: language,
                        presentation: compact ? .compact : .editorial,
                        onSource: onSource)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("conversation-experience-fixture")
    }

    private var processingState: ConversationImageProgressState {
        let manifest = try? ConversationImageUpload(id: source.id, data: source.data,
            fileName: source.fileName, mediaType: source.mediaType).manifest
        let pending = PendingImageConversation(messageID: ConversationExperienceFixtureClient.messageID,
            idempotencyKey: "synthetic-preview-only", objective: "", images: manifest.map { [$0] } ?? [],
            createdAt: Date(), timeZone: "Asia/Shanghai", queueEntryID: nil, state: .admitted)
        return .derive(pending: pending, isSending: false, isChecking: true)
    }

    private static func makeSource() -> AskMediaDraft {
        let size = CGSize(width: 360, height: 840)
        let image = UIGraphicsImageRenderer(size: size).image { context in
            UIColor(white: 0.95, alpha: 1).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            func label(_ text: String, in rect: CGRect, size: CGFloat = 19, bold: Bool = false) {
                (text as NSString).draw(in: rect, withAttributes: [
                    .font: bold ? UIFont.boldSystemFont(ofSize: size) : UIFont.systemFont(ofSize: size),
                    .foregroundColor: UIColor.black
                ])
            }
            label("Lin Zhou", in: CGRect(x: 22, y: 28, width: 310, height: 36), bold: true)
            label("Synthetic conversation", in: CGRect(x: 22, y: 68, width: 310, height: 30), size: 14)
            let messages = ["Could we review the design draft on Friday?", "Friday works for me.",
                "Great. I will bring the updated screens.", "See you then."]
            for (index, text) in messages.enumerated() {
                let y = CGFloat(138 + index * 144)
                let rect = CGRect(x: index.isMultiple(of: 2) ? 22 : 72, y: y, width: 264, height: 104)
                (index.isMultiple(of: 2) ? UIColor.white : UIColor(red: 0.84, green: 0.9, blue: 0.82, alpha: 1)).setFill()
                UIBezierPath(roundedRect: rect, cornerRadius: 14).fill()
                label(text, in: rect.insetBy(dx: 14, dy: 14))
            }
            label("PREVIEW ONLY", in: CGRect(x: 22, y: 772, width: 310, height: 28), size: 14)
        }
        return AskMediaDraft(id: UUID(uuidString: "a0000000-0000-4000-8000-000000000001")!,
            data: image.pngData() ?? Data(), preview: image, fileName: "synthetic-conversation.png",
            mediaType: "image/png", width: Int(size.width), height: Int(size.height), phase: .ready)
    }
}

/// The preview never depends on device Keychain entitlements. This adapter
/// uses the production operation contract and remains confined to DEBUG data.
private final class ConversationExperienceMemoryIntents: ConversationMemoryOperationPersisting {
    private var values: [String: Data] = [:]
    private var modifiedDates: [String: Date] = [:]
    func load(key: String) throws -> Data? { values[key] }
    func save(_ data: Data, key: String) throws { values[key] = data; modifiedDates[key] = Date() }
    func remove(key: String) throws { values.removeValue(forKey: key); modifiedDates.removeValue(forKey: key) }
    func removeExpired(now: Date) throws {
        let entries = modifiedDates.map { ConversationMemoryIntentRetention.Metadata(key: $0.key, modifiedAt: $0.value) }
        for key in ConversationMemoryIntentRetention.expiredKeys(entries, now: now) { try remove(key: key) }
    }
    func removeAccount(prefix: String) throws {
        for key in Array(values.keys) where key.hasPrefix(prefix) { try remove(key: key) }
    }
}

private actor ConversationExperienceFixtureClient: ConversationMemoryReviewServing {
    static let proposalID = "a0000000-0000-4000-8000-000000000002"
    static let sessionID = UUID(uuidString: "a0000000-0000-4000-8000-000000000003")!
    static let messageID = UUID(uuidString: "a0000000-0000-4000-8000-000000000004")!
    private static let reviewID = "a0000000-0000-4000-8000-000000000006"
    private static let personID = "a0000000-0000-4000-8000-000000000008"
    private static let contextID = "a0000000-0000-4000-8000-000000000009"
    private static let credential = "synthetic-preview-credential-only"
    nonisolated let accountBinding = "synthetic-conversation-preview-\(UUID().uuidString)"
    private let failsOpen: Bool
    private var proposalRevision = 1
    private var reviewRevision = 1
    private var displayName = "Lin Zhou"
    private var relationshipName = "Design collaboration"
    private var contactAdded = false
    private var dismissed = false
    private var savedItems = Set<String>()
    private var draft: ConversationMemoryDraft?
    private var receipts: [String: ConversationMemoryReceipt] = [:]
    private var rebases: [String: Int] = [:]

    init(failsOpen: Bool) { self.failsOpen = failsOpen }

    private func envelope() -> ConversationMemoryReviewEnvelope {
        let texts = ["Review the design draft on Friday.", "Bring the updated screens to the review."]
        let items = texts.enumerated().map { index, text in
            let id = index == 0 ? "a0000000-0000-4000-8000-000000000005" : "a0000000-0000-4000-8000-000000000007"
            return ConversationMemoryItem(id: id, scope: "relationship", subject_id: contactAdded ? Self.personID : nil,
                relationship_context_id: contactAdded ? Self.contextID : nil, operation: "add", statement_kind: "fact",
                display_text: text, previous_text: nil, previous_revision: nil, admission_status: "eligible",
                judgment_kind: "ordinary", judgment_reason: nil, default_selected: false,
                source_excerpt: index == 0 ? "Could we review the design draft on Friday? Friday works for me." : "I will bring the updated screens.",
                source_locator: .init(kind: "image_region", session_id: Self.sessionID.uuidString,
                    message_id: Self.messageID.uuidString, image_index: 0, artifact_id: nil),
                added_revision: 1, status: savedItems.contains(id) ? "committed" : "pending")
        }
        return .init(contract_version: TalentSignalAPIContract.version, review_credential: Self.credential,
            review: .init(contract_version: TalentSignalAPIContract.version, review_scope_id: Self.reviewID,
                review_revision: reviewRevision, purpose: "chat", allowed_scope: "all", proposal_id: Self.proposalID,
                proposal_revision: proposalRevision, person_id: contactAdded ? Self.personID : nil,
                relationship_context_id: contactAdded ? Self.contextID : nil, person_display_label: displayName,
                relationship_display_label: relationshipName, source_session_id: Self.sessionID.uuidString,
                source_message_id: Self.messageID.uuidString, contact_decision: contactAdded ? "existing" : "new",
                contact_status: contactAdded ? "resolved" : "pending", status: contactAdded ? "partially_committed" : "open",
                expires_at: ISO8601DateFormatter().string(from: Date().addingTimeInterval(3_600)),
                source_status: "available", items: items, draft: draft))
    }

    func open(proposalID: String, sessionID: UUID) async throws -> ConversationMemoryReviewEnvelope {
        guard !failsOpen else { throw ConversationMemoryReviewError.unavailable }
        guard proposalID == Self.proposalID, sessionID == Self.sessionID else { throw ConversationMemoryReviewError.invalidScope }
        if dismissed { throw ConversationMemoryReviewError.backend(status: 409, code: "MEMORY_REVIEW_DISMISSED", operationKey: nil) }
        return envelope()
    }

    func saveDraft(reviewID: String, credential: String, body: ConversationMemoryDraftUpdate) async throws -> ConversationMemoryReviewEnvelope {
        try authorize(reviewID: reviewID, credential: credential)
        guard body.expected_review_revision == reviewRevision else { throw stale() }
        reviewRevision += 1
        draft = .init(contact_decision: body.contact_decision, selected_item_ids: body.selected_item_ids,
            edited_text: body.edited_text, item_decisions: body.item_decisions, revision: reviewRevision)
        return envelope()
    }

    func commit(reviewID: String, credential: String, body: ConversationMemoryCommit) async throws -> ConversationMemoryReceipt {
        // Aggregate commits deliberately fail: these scenarios verify that the
        // actual store uses separate contact and single-item decisions.
        throw ConversationMemoryReviewError.backend(status: 403, code: "SYNTHETIC_AGGREGATE_NOT_ALLOWED", operationKey: nil)
    }

    func commitContact(reviewID: String, credential: String, body: ConversationMemoryCommit) async throws -> ConversationMemoryReceipt {
        try authorize(reviewID: reviewID, credential: credential)
        if let receipt = receipts[body.idempotency_key] { return receipt }
        guard !contactAdded, body.expected_proposal_revision == proposalRevision,
              body.contact_decision == "new", body.selected_item_ids.isEmpty,
              let contact = body.new_contact, contact.display_label == displayName,
              contact.relationship_context == relationshipName else { throw stale() }
        contactAdded = true; proposalRevision += 1; reviewRevision += 1; draft = nil
        return receipt(key: body.idempotency_key, createdContact: true, itemID: nil)
    }

    func decideItem(reviewID: String, credential: String, body: ConversationMemoryItemDecision) async throws -> ConversationMemoryItemDecisionResponse {
        try authorize(reviewID: reviewID, credential: credential)
        if let receipt = receipts[body.idempotency_key] {
            return .init(contract_version: TalentSignalAPIContract.version, kind: "committed", item_id: body.item_id,
                receipt: receipt, proposal_revision: receipt.proposal_revision, remaining_pending_item_count: 2 - savedItems.count)
        }
        guard contactAdded, body.expected_proposal_revision == proposalRevision,
              body.expected_review_revision == reviewRevision, body.expected_item_added_revision == 1,
              body.contact_decision == "existing", body.decision == "accept",
              envelope().review.items.contains(where: { $0.id == body.item_id && $0.status == "pending" }) else { throw stale() }
        savedItems.insert(body.item_id); proposalRevision += 1; reviewRevision += 1; draft = nil
        let receipt = receipt(key: body.idempotency_key, createdContact: false, itemID: body.item_id)
        return .init(contract_version: TalentSignalAPIContract.version, kind: "committed", item_id: body.item_id,
            receipt: receipt, proposal_revision: proposalRevision, remaining_pending_item_count: 2 - savedItems.count)
    }

    func operation(key: String, sessionID: UUID, personID: String?) async throws -> ConversationMemoryOperationView {
        guard sessionID == Self.sessionID else { throw ConversationMemoryReviewError.invalidScope }
        return .init(contract_version: TalentSignalAPIContract.version, operation_key: key,
            state: receipts[key] == nil ? "unavailable" : "applied", purpose: "chat",
            person_id: contactAdded ? Self.personID : nil, relationship_context_id: contactAdded ? Self.contextID : nil,
            source_session_id: Self.sessionID.uuidString,
            visible_receipt: receipts[key])
    }

    func dismiss(reviewID: String, credential: String, revision: Int, operationKey: String) async throws {
        try authorize(reviewID: reviewID, credential: credential)
        guard revision == reviewRevision else { throw stale() }
        dismissed = true
    }

    func rebase(proposalID: String, body: ConversationMemoryRebase) async throws -> ConversationMemoryRebaseResponse {
        guard proposalID == Self.proposalID else { throw ConversationMemoryReviewError.invalidScope }
        if let revision = rebases[body.idempotency_key] {
            return .init(contract_version: TalentSignalAPIContract.version, proposal: .init(proposal_id: proposalID, revision: revision))
        }
        guard body.expected_proposal_revision == proposalRevision, !contactAdded,
              body.contact_decision == "new", let contact = body.new_contact,
              !contact.display_label.isEmpty else { throw stale() }
        displayName = contact.display_label; relationshipName = contact.relationship_context
        proposalRevision += 1; reviewRevision += 1; draft = nil
        rebases[body.idempotency_key] = proposalRevision
        return .init(contract_version: TalentSignalAPIContract.version,
            proposal: .init(proposal_id: proposalID, revision: proposalRevision))
    }

    func searchPeople(query: String) async throws -> [ConversationMemoryPerson] { [] }
    func verifyPerson(id: String) async throws -> ConversationMemoryPerson {
        guard contactAdded, id == Self.personID else { throw ConversationMemoryReviewError.invalidScope }
        return .init(id: id, display_label: displayName,
            contexts: [.init(id: Self.contextID, display_label: relationshipName)], identity_matches: nil)
    }

    private func receipt(key: String, createdContact: Bool, itemID: String?) -> ConversationMemoryReceipt {
        let receipt = ConversationMemoryReceipt(contract_version: TalentSignalAPIContract.version,
            commit_id: UUID().uuidString.lowercased(), operation_key: key, proposal_id: Self.proposalID,
            proposal_revision: proposalRevision, status: "applied", contact_decision: createdContact ? "new" : "existing",
            created_person_id: createdContact ? Self.personID : nil, person_display_label: displayName,
            created_relationship_context_id: createdContact ? Self.contextID : nil, applied_item_count: itemID == nil ? 0 : 1,
            created_item_ids: itemID.map { [$0] } ?? [], updated_item_ids: [])
        receipts[key] = receipt
        return receipt
    }

    private func authorize(reviewID: String, credential: String) throws {
        guard reviewID == Self.reviewID, credential == Self.credential, !dismissed else { throw ConversationMemoryReviewError.invalidScope }
    }
    private func stale() -> ConversationMemoryReviewError { .backend(status: 409, code: "MEMORY_REVIEW_STALE", operationKey: nil) }
}
#endif
