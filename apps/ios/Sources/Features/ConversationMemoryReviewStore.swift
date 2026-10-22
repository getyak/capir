import CryptoKit
import Combine
import Foundation

@MainActor
final class ConversationMemoryReviewStore: ObservableObject {
    enum Phase: Equatable { case idle, opening, review, saving, unknown, saved, dismissed, stale, unavailable }
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var review: ConversationMemoryReview?
    @Published private(set) var destination: ConversationMemoryDestination?
    @Published private(set) var notice: String?
    @Published var displayName = ""
    @Published var relationshipName = ""
    @Published var selectedItemIDs = Set<String>()
    @Published var editedText: [String: String] = [:]
    @Published var decisions: [String: String] = [:]
    @Published private(set) var people: [ConversationMemoryPerson] = []
    @Published private(set) var isSearching = false
    @Published private(set) var searchNotice: String?
    private(set) var proposal: ConversationMemoryProposalReference
    let sessionID: UUID
    let sourceMessageID: UUID?
    let sourceMessageIDs: Set<UUID>?
    let reviewScope: ConversationMemoryReviewScope
    private let client: any ConversationMemoryReviewServing
    private let defaults: UserDefaults
    private let locatorKey: String
    private let accountIntentPrefix: String
    private let intentPersistence: any ConversationMemoryOperationPersisting
    private var credential: String?
    private var generation = UUID()
    private var pending: Locator?
    private var pendingRebase: ConversationMemoryRebase?
    private var pendingIntent: ConversationMemoryPendingIntent?
    private var draftTask: Task<Void, Never>?
    private var draftIsSaving = false
    private var draftIsDirty = false

    private struct Locator: Codable, Equatable {
        let operationKey: String
        let kind: String
        var personID: String? = nil
        var reviewID: String? = nil
        var reviewRevision: Int? = nil
        var proposalRevision: Int? = nil
        var itemID: String? = nil
    }

    init(proposal: ConversationMemoryProposalReference, sessionID: UUID, sourceMessageID: UUID? = nil,
         sourceMessageIDs: Set<UUID>? = nil,
         client: any ConversationMemoryReviewServing, defaults: UserDefaults = .standard,
         intentPersistence: any ConversationMemoryOperationPersisting = KeychainConversationMemoryOperationStore()) {
        self.proposal = proposal; self.sessionID = sessionID; self.sourceMessageID = sourceMessageID
        self.sourceMessageIDs = sourceMessageIDs
        reviewScope = client.reviewScope
        self.client = client; self.defaults = defaults
        self.intentPersistence = intentPersistence
        accountIntentPrefix = ConversationMemoryIntentRetention.accountPrefix(binding: client.accountBinding)
        let scope = "\(client.accountBinding)|\(sessionID)|\(proposal.proposal_id)|\(client.reviewScope.bindingKey)"
        let hash = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        locatorKey = accountIntentPrefix + hash
        try? intentPersistence.removeExpired(now: Date())
        if let bytes = defaults.data(forKey: locatorKey), let locator = try? JSONDecoder().decode(Locator.self, from: bytes),
           UUID(uuidString: locator.operationKey) != nil, ["commit", "dismiss", "rebase"].contains(locator.kind) {
            pending = locator
            if let bytes = try? intentPersistence.load(key: locatorKey),
               let intent = try? JSONDecoder().decode(ConversationMemoryPendingIntent.self, from: bytes) {
                if intent.operationKey == locator.operationKey, intent.isWithinRetention {
                    pendingIntent = intent; pendingRebase = intent.rebase
                } else { try? intentPersistence.remove(key: locatorKey) }
            }
        }
    }

    var isFrozen: Bool { phase != .review }
    var allowsIdentityChanges: Bool { reviewScope.allowsIdentityChanges }
    var needsIdentityChoice: Bool { review?.contact_status == "ambiguous" }
    var pendingItems: [ConversationMemoryItem] { review?.items.filter { $0.status == "pending" } ?? [] }
    var selectedCount: Int { pendingItems.filter { selectedItemIDs.contains($0.id) && $0.canSelect }.count }
    var canSave: Bool {
        guard phase == .review, let review, review.isCurrent, review.source_status == "available",
              !needsIdentityChoice, pending == nil else { return false }
        if review.contact_decision == "new" {
            // Adding this identity does not decide any sibling Memory, even
            // when another device left a judgment-incomplete draft selected.
            return !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && displayName.utf16.count <= 200 && relationshipName.utf16.count <= 200
        }
        let selected = pendingItems.filter { selectedItemIDs.contains($0.id) }
        guard selected.allSatisfy({ item in
            item.canSelect && !(editedText[item.id] ?? item.display_text).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && (editedText[item.id] ?? item.display_text).utf16.count <= 1_000
                && (!item.requiresJudgment || Self.allowedDecisions(for: item).contains(decisions[item.id] ?? ""))
        }) else { return false }
        return !selected.isEmpty
    }

    static func allowedDecisions(for item: ConversationMemoryItem) -> [String] {
        guard item.admission_status != "ineligible" else { return [] }
        if item.judgment_kind == "conflict" { return ["keep_old", "accept_new", "retain_conflict"] }
        // Attribution and stale-target problems cannot be solved by a blind
        // checkbox. A corrected/rebased source must produce an eligible item.
        if ["ambiguous_attribution", "stale_target", "self_scope_escape"].contains(item.judgment_kind) { return [] }
        return ["accept"]
    }

    func invalidate() {
        draftTask?.cancel(); draftTask = nil
        scrubProtectedIntent(clearDraft: true)
        try? intentPersistence.removeAccount(prefix: accountIntentPrefix)
        generation = UUID(); credential = nil; review = nil; people = []
        selectedItemIDs = []; editedText = [:]; decisions = [:]; destination = nil
        phase = .stale; notice = "Review access changed. Reopen this conversation."
    }

    /// Scrolling to inspect a source is ordinary navigation. Revoke transient
    /// authority while retaining the same local draft for fresh authorization.
    func suspend() {
        draftTask?.cancel(); draftTask = nil
        generation = UUID(); credential = nil; people = []; isSearching = false
        phase = .idle; destination = nil
        Task { [self] in
            if !(await client.isCurrentScope()) {
                scrubProtectedIntent(clearDraft: true)
                try? intentPersistence.removeAccount(prefix: accountIntentPrefix)
            }
        }
    }

    func scheduleDraft() {
        guard phase == .review, pending == nil else { return }
        draftIsDirty = true
        draftTask?.cancel()
        draftTask = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
            guard !Task.isCancelled else { return }
            _ = await self?.flushDraft()
        }
    }

    @discardableResult func flushDraft() async -> Bool {
        guard draftIsDirty else { return true }
        guard !draftIsSaving, phase == .review, let review, let credential, pending == nil else { return false }
        let ticket = generation
        let visible = Set(pendingItems.filter(\.canSelect).map(\.id))
        let body = ConversationMemoryDraftUpdate(expected_review_revision: review.review_revision,
            contact_decision: review.contact_decision,
            selected_item_ids: selectedItemIDs.intersection(visible).sorted(),
            edited_text: editedText.filter { visible.contains($0.key) && $0.value.utf16.count <= 1_000 },
            item_decisions: decisions.filter { visible.contains($0.key) && ["accept", "keep_old", "accept_new", "retain_conflict", "skip"].contains($0.value) })
        draftIsSaving = true; draftIsDirty = false
        defer { draftIsSaving = false }
        do {
            let response = try await client.saveDraft(reviewID: review.review_scope_id, credential: credential, body: body)
            guard ticket == generation else { draftIsDirty = true; return false }
            try response.review.validate(proposal: proposal, sessionID: sessionID, messageID: sourceMessageID, sourceMessageIDs: sourceMessageIDs, scope: reviewScope)
            guard response.contract_version == TalentSignalAPIContract.version,
                  response.review.review_scope_id == review.review_scope_id,
                  response.review.proposal_revision == review.proposal_revision,
                  response.review.review_revision > review.review_revision else { throw ConversationMemoryReviewError.invalidScope }
            self.review = response.review
            if draftIsDirty { return await flushAfterCurrentDraft() }
            return true
        } catch {
            guard ticket == generation else { return false }
            draftIsDirty = true
            notice = "Draft changes are not synced. Retry before leaving."
            return false
        }
    }

    private func flushAfterCurrentDraft() async -> Bool {
        // Release the one-write guard before syncing edits made while the
        // previous snapshot was in flight; preserve the new review revision.
        draftIsSaving = false
        return await flushDraft()
    }

    func open() async {
        guard phase != .opening, phase != .saving else { return }
        let ticket = generation
        phase = .opening; notice = nil; credential = nil
        do {
            guard proposal.isValid else { throw ConversationMemoryReviewError.invalidScope }
            let envelope = try await client.open(proposalID: proposal.proposal_id, sessionID: sessionID)
            guard ticket == generation else { return }
            try accept(envelope)
            if let pending {
                if pending.kind == "commit" { await reconcile(); return }
                if pending.kind == "dismiss" {
                    await reconcileDecision()
                    return
                }
                // An old read can race a still-running identity change. Only
                // advancement beyond the frozen revision invalidates that old
                // mutation and permits a fresh human decision.
                guard let frozenRevision = pending.proposalRevision,
                      envelope.review.proposal_revision > frozenRevision else {
                    credential = nil; phase = .unknown
                    notice = "The contact choice is not confirmed. Check its status before continuing."
                    return
                }
                clearPending(); pendingRebase = nil
                notice = "The review changed. Check the latest details before saving."
            }
            if phase != .unavailable { phase = .review }
        } catch {
            guard ticket == generation else { return }
            await handleOpenError(error)
        }
    }

    private func accept(_ envelope: ConversationMemoryReviewEnvelope) throws {
        guard envelope.contract_version == TalentSignalAPIContract.version else { throw ConversationMemoryReviewError.invalidScope }
        try envelope.review.validate(proposal: proposal, sessionID: sessionID, messageID: sourceMessageID, sourceMessageIDs: sourceMessageIDs, scope: reviewScope)
        guard let credential = envelope.review_credential, (16...200).contains(credential.count),
              envelope.review.isCurrent else { throw ConversationMemoryReviewError.invalidScope }
        let fresh = envelope.review
        // Preserve edits only while all identity, source and revision bindings
        // are unchanged. A different proposal revision starts a new decision.
        let preserveDraft = review?.proposal_revision == fresh.proposal_revision
            && review?.person_id == fresh.person_id && review?.source_message_id == fresh.source_message_id
        self.credential = credential; review = fresh
        if !preserveDraft {
            displayName = fresh.person_display_label ?? ""
            relationshipName = fresh.relationship_display_label ?? ""
            let visible = Set(fresh.items.filter(\.canSelect).map(\.id))
            // An initial Add contact confirms identity only. The user must
            // deliberately select which source details become Memory.
            selectedItemIDs = Set(fresh.draft?.selected_item_ids ?? []).intersection(visible)
            editedText = fresh.draft?.edited_text.filter { visible.contains($0.key) } ?? [:]
            decisions = fresh.draft?.item_decisions.filter { visible.contains($0.key) } ?? [:]
        }
        if fresh.source_status != "available" {
            scrubProtectedIntent(clearDraft: true)
            phase = .unavailable; self.credential = nil
            notice = "The source is unavailable. These details cannot be saved."
        }
    }

    func save() async {
        guard canSave, await flushDraft(), let initial = review else { return }
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let relation = relationshipName.trimmingCharacters(in: .whitespacesAndNewlines)
        if initial.contact_decision == "new" {
            if name != initial.person_display_label || relation != (initial.relationship_display_label ?? "") {
                await chooseNewContact(name: name, relationship: relation)
                return
            }
            // Identity is one independent decision. Do not accept any sibling
            // Memory as a side effect of creating a contact.
            await saveContact(name: name, relationship: relation)
            return
        }
        let selected = pendingItems.filter { selectedItemIDs.contains($0.id) && $0.canSelect }
        let intentText = editedText
        let intentDecisions = decisions
        for original in selected {
            guard phase == .review, let current = review, let credential,
                  let item = current.items.first(where: { $0.id == original.id && $0.status == "pending" }),
                  item.added_revision == original.added_revision,
                  item.display_text == original.display_text, item.source_excerpt == original.source_excerpt else { return }
            let key = UUID().uuidString.lowercased()
            let body = ConversationMemoryItemDecision(idempotency_key: key,
                expected_proposal_revision: current.proposal_revision, expected_review_revision: current.review_revision,
                item_id: item.id, expected_item_added_revision: item.added_revision,
                expected_item_version: item.previous_revision, contact_decision: current.contact_decision,
                decision: intentDecisions[item.id] ?? "accept", edited_text: intentText[item.id] ?? item.display_text)
            guard retain(.init(operationKey: key, kind: "commit", personID: current.person_id,
                reviewID: current.review_scope_id, reviewRevision: current.review_revision,
                proposalRevision: current.proposal_revision, itemID: item.id),
                intent: .init(operationKey: key, item: body)) else { return }
            let ticket = generation; phase = .saving; notice = nil
            do {
                let response = try await client.decideItem(reviewID: current.review_scope_id, credential: credential, body: body)
                guard ticket == generation else { return }
                guard response.contract_version == TalentSignalAPIContract.version,
                      UUID(uuidString: response.item_id) == UUID(uuidString: item.id),
                      response.kind == "committed", let receipt = response.receipt else {
                    throw ConversationMemoryReviewError.invalidScope
                }
                try validate(receipt: receipt, operationKey: key)
                await reconcile()
                guard phase == .review else { return }
            } catch {
                guard ticket == generation else { return }
                handleMutationError(error)
                return
            }
        }
    }

    private func saveContact(name: String, relationship: String) async {
        guard let review, let credential else { return }
        let key = UUID().uuidString.lowercased()
        let body = ConversationMemoryCommit(idempotency_key: key,
            expected_proposal_revision: review.proposal_revision, contact_decision: "new",
            identity_authority: "human_selection", person_id: nil, relationship_context_id: nil,
            selected_item_ids: [], edited_text: [:], item_decisions: [:], expected_item_versions: [:],
            new_contact: .init(display_label: name, relationship_context: relationship),
            reason: "User explicitly confirmed adding this source-linked contact.")
        guard retain(.init(operationKey: key, kind: "commit", personID: nil,
            reviewID: review.review_scope_id, reviewRevision: review.review_revision,
            proposalRevision: review.proposal_revision), intent: .init(operationKey: key, contact: body)) else { return }
        let ticket = generation; phase = .saving; notice = nil
        do {
            let receipt = try await client.commitContact(reviewID: review.review_scope_id, credential: credential, body: body)
            guard ticket == generation else { return }
            try validate(receipt: receipt, operationKey: key)
            await reconcile()
        } catch {
            guard ticket == generation else { return }
            handleMutationError(error)
        }
    }

    private func handleMutationError(_ error: Error) {
        if isDefinitiveRejection(error) {
            clearPending(); credential = nil; phase = .stale
            notice = "The review changed or could not be saved. Refresh and check it again."
        } else {
            phase = .unknown; notice = "The save result is not confirmed. Check its status before trying again."
        }
    }

    func reconcile(allowReplay: Bool = true) async {
        guard let pending else { await open(); return }
        if pending.kind != "commit" { await reconcileDecision(); return }
        let ticket = generation; phase = .unknown
        notice = "Checking the saved result…"
        do {
            let view = try await client.operation(key: pending.operationKey, sessionID: sessionID, personID: pending.personID ?? review?.person_id)
            guard ticket == generation else { return }
            guard view.contract_version == TalentSignalAPIContract.version, view.purpose == reviewScope.purpose,
                  UUID(uuidString: view.operation_key) == UUID(uuidString: pending.operationKey),
                  (view.source_session_id == nil || UUID(uuidString: view.source_session_id ?? "") == sessionID) else { throw ConversationMemoryReviewError.invalidScope }
            if case let .relationship(person, context) = reviewScope {
                guard UUID(uuidString: view.person_id ?? "") == UUID(uuidString: person),
                      UUID(uuidString: view.relationship_context_id ?? "") == UUID(uuidString: context) else {
                    throw ConversationMemoryReviewError.invalidScope
                }
            }
            if view.state == "source_revoked" || view.state == "scope_mismatch" {
                scrubProtectedIntent(clearDraft: true)
                credential = nil; phase = .stale
                notice = "The source or review access changed. Reopen this conversation."
                return
            }
            guard view.state == "applied", let receipt = view.visible_receipt else {
                if view.state == "undone" { clearPending(); phase = .dismissed; notice = "This save was undone." }
                else if allowReplay, ["pending", "unavailable"].contains(view.state), await replayFrozenCommit() {
                    await reconcile(allowReplay: false)
                }
                else { notice = "The save result is not confirmed. Check its status before trying again." }
                return
            }
            guard UUID(uuidString: view.source_session_id ?? "") == sessionID else { throw ConversationMemoryReviewError.invalidScope }
            try validate(receipt: receipt, operationKey: pending.operationKey)
            var personID = receipt.created_person_id ?? view.person_id ?? review?.person_id
            if personID == nil, receipt.contact_decision == "existing" {
                personID = try await client.destinationPersonID(receipt: receipt)
                guard ticket == generation else { return }
            }
            var personLabel = receipt.person_display_label
            if let personID {
                let person = try await client.verifyPerson(id: personID)
                guard ticket == generation, UUID(uuidString: person.id) == UUID(uuidString: personID) else { return }
                personLabel = person.display_label
            } else if receipt.contact_decision == "new" {
                throw ConversationMemoryReviewError.invalidScope
            }
            let previous = destination
            let isNewOperation = previous?.operationKey != pending.operationKey
            destination = .init(personID: personID, personDisplayLabel: personLabel,
                savedItemCount: (previous?.savedItemCount ?? 0) + (isNewOperation ? receipt.applied_item_count : 0),
                operationKey: pending.operationKey,
                contactWasCreated: previous?.contactWasCreated == true || receipt.created_person_id != nil)
            clearPending(); credential = nil; phase = .saved; notice = nil
            await reopenRemaining(after: receipt)
        } catch {
            guard ticket == generation else { return }
            phase = .unknown; notice = "The save result is not confirmed. Check its status before trying again."
        }
    }

    func dismiss() async {
        guard phase == .review, pending == nil, await flushDraft(), let review, let credential else { return }
        let key = UUID().uuidString.lowercased()
        guard retain(.init(operationKey: key, kind: "dismiss", personID: review.person_id,
            reviewID: review.review_scope_id, reviewRevision: review.review_revision,
            proposalRevision: review.proposal_revision)) else { return }
        let ticket = generation; phase = .saving
        do {
            try await client.dismiss(reviewID: review.review_scope_id, credential: credential,
                revision: review.review_revision, operationKey: key)
            guard ticket == generation else { return }
            clearPending(); self.credential = nil; phase = .dismissed; notice = nil
        } catch {
            guard ticket == generation else { return }
            if isDefinitiveRejection(error) { clearPending(); phase = .stale; self.credential = nil }
            else { phase = .unknown }
            notice = "The decision result is not confirmed. Check its status before continuing."
        }
    }

    func chooseNewContact(name: String, relationship: String) async {
        await rebase(decision: "new", personID: nil, contextID: nil,
            contact: .init(display_label: name.trimmingCharacters(in: .whitespacesAndNewlines), relationship_context: relationship))
    }

    func chooseExisting(person: ConversationMemoryPerson, contextID: String?) async {
        guard contextID == nil || person.contexts.contains(where: { $0.id == contextID }) else { return }
        await rebase(decision: "existing", personID: person.id, contextID: contextID, contact: nil)
    }

    func chooseNoContact() async { await rebase(decision: "none", personID: nil, contextID: nil, contact: nil) }

    private func rebase(decision: String, personID: String?, contextID: String?, contact: ConversationMemoryCommit.NewContact?) async {
        guard allowsIdentityChanges, phase == .review, pending == nil, await flushDraft(), let review else { return }
        if let contact, contact.display_label.isEmpty || contact.display_label.utf16.count > 200
            || contact.relationship_context.utf16.count > 200 { return }
        let body = ConversationMemoryRebase(idempotency_key: UUID().uuidString.lowercased(),
            expected_proposal_revision: review.proposal_revision, contact_decision: decision,
            person_id: personID, relationship_context_id: contextID, new_contact: contact)
        guard retain(.init(operationKey: body.idempotency_key, kind: "rebase",
            proposalRevision: review.proposal_revision), intent: .init(operationKey: body.idempotency_key, rebase: body)) else { return }
        pendingRebase = body
        await performRebase(body)
    }

    private func performRebase(_ body: ConversationMemoryRebase) async {
        let ticket = generation; phase = .saving; credential = nil
        do {
            let response = try await client.rebase(proposalID: proposal.proposal_id, body: body)
            guard ticket == generation else { return }
            guard response.contract_version == TalentSignalAPIContract.version,
                  UUID(uuidString: response.proposal.proposal_id) == UUID(uuidString: proposal.proposal_id),
                  response.proposal.revision >= body.expected_proposal_revision else { throw ConversationMemoryReviewError.invalidScope }
            proposal = .init(proposal_id: response.proposal.proposal_id, revision: response.proposal.revision)
            clearPending(); pendingRebase = nil; phase = .idle
            await open()
            if phase == .review { notice = "The review changed. Check the latest details before saving." }
        } catch {
            guard ticket == generation else { return }
            if isDefinitiveRejection(error) { clearPending(); pendingRebase = nil; phase = .stale }
            else { phase = .unknown }
            notice = "The contact choice is not confirmed. Check its status before continuing."
        }
    }

    func search(query: String) async {
        guard allowsIdentityChanges, phase == .review, !isSearching else { return }
        let ticket = generation; isSearching = true; searchNotice = nil
        defer { if ticket == generation { isSearching = false } }
        do {
            let result = try await client.searchPeople(query: query)
            guard ticket == generation else { return }
            people = result
            if result.isEmpty { searchNotice = "No matching contacts. You can create a new contact." }
        } catch {
            guard ticket == generation else { return }
            people = []; searchNotice = "Contacts could not be loaded. Try searching again."
        }
    }

    private func reopenRemaining(after receipt: ConversationMemoryReceipt) async {
        let ticket = generation
        do {
            let envelope = try await client.open(proposalID: proposal.proposal_id, sessionID: sessionID)
            guard ticket == generation else { return }
            try accept(envelope)
            if envelope.review.items.contains(where: { $0.status == "pending" }) {
                if phase != .unavailable { phase = .review }
                if receipt.created_person_id != nil { notice = "Contact added. Choose which details to remember." }
            } else { phase = .saved; credential = nil }
        } catch {
            guard ticket == generation else { return }
            if case let ConversationMemoryReviewError.backend(_, code, _) = error,
               ["MEMORY_REVIEW_PROCESSED", "MEMORY_REVIEW_DISMISSED"].contains(code) {
                phase = .saved; credential = nil
            } else {
                phase = .unavailable; credential = nil
                notice = "Your confirmed change is saved. Reload to review the remaining details."
            }
        }
    }

    private func reconcileDecision() async {
        guard let pending else { return }
        let ticket = generation
        do {
            let envelope = try await client.open(proposalID: proposal.proposal_id, sessionID: sessionID)
            guard ticket == generation else { return }
            try envelope.review.validate(proposal: proposal, sessionID: sessionID, messageID: sourceMessageID, sourceMessageIDs: sourceMessageIDs, scope: reviewScope)
            guard envelope.review.source_status == "available" else {
                scrubProtectedIntent(clearDraft: true); credential = nil; phase = .stale
                notice = "The source is unavailable. These details cannot be saved."
                return
            }
            if pending.kind == "rebase" {
                guard let frozenRevision = pending.proposalRevision else {
                    credential = nil; phase = .unknown
                    notice = "The contact choice is not confirmed. Check its status before continuing."
                    return
                }
                if envelope.review.proposal_revision <= frozenRevision {
                    if let body = pendingRebase { await performRebase(body) }
                    else {
                        credential = nil; phase = .unknown
                        notice = "The contact choice is not confirmed. Check its status before continuing."
                    }
                    return
                }
                try accept(envelope); clearPending(); phase = .review
                notice = "The review changed. Check the latest details before saving."
                return
            }
            guard pending.kind == "dismiss", let reviewID = pending.reviewID,
                  let revision = pending.reviewRevision,
                  envelope.review.review_scope_id == reviewID,
                  envelope.review.proposal_revision == pending.proposalRevision,
                  envelope.review.review_revision == revision,
                  let freshCredential = envelope.review_credential else {
                phase = .unknown
                notice = "The decision result is not confirmed. Check its status before continuing."
                return
            }
            // The exact original request is idempotent. A newly authorized
            // credential can replay it; no new operation or broader scope.
            try await client.dismiss(reviewID: reviewID, credential: freshCredential,
                revision: revision, operationKey: pending.operationKey)
            guard ticket == generation else { return }
            clearPending(); credential = nil; phase = .dismissed; notice = nil
        } catch {
            guard ticket == generation else { return }
            if case let ConversationMemoryReviewError.backend(_, code, _) = error,
               code == "MEMORY_REVIEW_DISMISSED" {
                clearPending(); credential = nil; phase = .dismissed; notice = nil
            } else {
                phase = .unknown; notice = "The decision result is not confirmed. Check its status before continuing."
            }
        }
    }

    private func handleOpenError(_ error: Error) async {
        credential = nil
        if case let ConversationMemoryReviewError.backend(_, code, key) = error {
            if code.contains("SOURCE_REVOKED") || code.contains("SOURCE_UNAVAILABLE") || code.contains("SCOPE_MISMATCH") {
                scrubProtectedIntent(clearDraft: true); phase = .unavailable
                notice = "The source or review access changed. Reopen this conversation."
                return
            }
            if code == "MEMORY_REVIEW_DISMISSED" { clearPending(); phase = .dismissed; notice = nil; return }
            if code == "MEMORY_REVIEW_PROCESSED" {
                if let key, UUID(uuidString: key) != nil {
                    if let pending, pending.kind == "commit", UUID(uuidString: pending.operationKey) != UUID(uuidString: key) {
                        phase = .unknown; notice = "The save result is not confirmed. Check its status before trying again."; return
                    }
                    guard retain(.init(operationKey: key, kind: "commit", personID: pending?.personID ?? review?.person_id)) else { return }
                    await reconcile(); return
                }
                phase = .unavailable; notice = "This review was already processed. Open the contact to check its current state."; return
            }
        }
        if pending != nil { phase = .unknown; notice = "The save result is not confirmed. Check its status before trying again." }
        else { phase = .unavailable; notice = "This review could not be opened. Try loading it again." }
    }

    private func validate(receipt: ConversationMemoryReceipt, operationKey: String) throws {
        guard receipt.contract_version == TalentSignalAPIContract.version,
              UUID(uuidString: receipt.operation_key) == UUID(uuidString: operationKey),
              UUID(uuidString: receipt.proposal_id) == UUID(uuidString: proposal.proposal_id),
              UUID(uuidString: receipt.commit_id) != nil, receipt.status == "applied",
              receipt.proposal_revision >= proposal.revision,
              receipt.applied_item_count >= 0,
              receipt.applied_item_count == receipt.created_item_ids.count + receipt.updated_item_ids.count else {
            throw ConversationMemoryReviewError.invalidScope
        }
    }

    private func replayFrozenCommit() async -> Bool {
        guard let pending, pending.kind == "commit", let intent = pendingIntent,
              intent.operationKey == pending.operationKey, intent.isWithinRetention else { return false }
        let ticket = generation
        do {
            let envelope = try await client.open(proposalID: proposal.proposal_id, sessionID: sessionID)
            guard ticket == generation else { return false }
            try envelope.review.validate(proposal: proposal, sessionID: sessionID, messageID: sourceMessageID, sourceMessageIDs: sourceMessageIDs, scope: reviewScope)
            if envelope.review.source_status != "available" {
                scrubProtectedIntent(clearDraft: true); credential = nil; phase = .stale
                notice = "The source is unavailable. These details cannot be saved."
                return false
            }
            guard envelope.review.source_status == "available", envelope.review.isCurrent,
                  envelope.review.review_scope_id == pending.reviewID,
                  envelope.review.proposal_revision == pending.proposalRevision,
                  envelope.review.review_revision == pending.reviewRevision,
                  let credential = envelope.review_credential else { return false }
            let receipt: ConversationMemoryReceipt
            if let body = intent.contact {
                guard body.idempotency_key == pending.operationKey else { return false }
                receipt = try await client.commitContact(reviewID: envelope.review.review_scope_id, credential: credential, body: body)
            } else if let body = intent.item {
                guard body.idempotency_key == pending.operationKey,
                      envelope.review.items.contains(where: { $0.id == body.item_id && $0.added_revision == body.expected_item_added_revision }) else { return false }
                let response = try await client.decideItem(reviewID: envelope.review.review_scope_id, credential: credential, body: body)
                guard response.contract_version == TalentSignalAPIContract.version, response.item_id == body.item_id,
                      response.kind == "committed", let verifiedReceipt = response.receipt else { return false }
                receipt = verifiedReceipt
            } else { return false }
            guard ticket == generation else { return false }
            try validate(receipt: receipt, operationKey: pending.operationKey)
            return true
        } catch {
            guard ticket == generation else { return false }
            if case let ConversationMemoryReviewError.backend(_, code, key) = error,
               code == "MEMORY_REVIEW_PROCESSED", UUID(uuidString: key ?? "") == UUID(uuidString: pending.operationKey) {
                // The original completed after the earlier pending read. Keep
                // its identity and read it again; it was not a rejection.
                return true
            }
            if isDefinitiveRejection(error) {
                // Rejection of this exact frozen request establishes that it
                // did not execute; the user must review current state anew.
                clearPending(); credential = nil; phase = .stale
                notice = "The review changed or could not be saved. Refresh and check it again."
            }
            return false
        }
    }

    private func retain(_ locator: Locator, intent: ConversationMemoryPendingIntent? = nil) -> Bool {
        guard let bytes = try? JSONEncoder().encode(locator) else { return false }
        if let intent {
            do {
                try intentPersistence.save(JSONEncoder().encode(intent), key: locatorKey)
                pendingIntent = intent
            } catch {
                phase = .unavailable; notice = "Recovery could not be protected. Nothing was sent."; return false
            }
        }
        defaults.set(bytes, forKey: locatorKey)
        guard defaults.data(forKey: locatorKey) == bytes else {
            phase = .unavailable; notice = "Recovery could not be protected. Nothing was sent."; return false
        }
        pending = locator; return true
    }
    private func clearPending() {
        pending = nil; pendingIntent = nil; pendingRebase = nil
        defaults.removeObject(forKey: locatorKey)
        try? intentPersistence.remove(key: locatorKey)
    }
    private func scrubProtectedIntent(clearDraft: Bool = false) {
        pendingIntent = nil; pendingRebase = nil
        try? intentPersistence.remove(key: locatorKey)
        if clearDraft {
            review = nil; selectedItemIDs = []; editedText = [:]; decisions = [:]
            displayName = ""; relationshipName = ""; destination = nil
        }
    }
    private func isDefinitiveRejection(_ error: Error) -> Bool {
        guard case let ConversationMemoryReviewError.backend(status, code, _) = error else { return false }
        return (400..<500).contains(status) && ![408, 429].contains(status) && !code.contains("IN_PROGRESS")
    }
}
