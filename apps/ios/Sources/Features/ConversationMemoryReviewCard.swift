import SwiftUI

enum ConversationMemoryReviewPresentation { case editorial, compact }

/// One actual decision object in the transcript. The same store drives both
/// presentation directions; no UI state establishes authority or success.
struct ConversationMemoryReviewCard: View {
    @StateObject private var store: ConversationMemoryReviewStore
    let language: AppLanguage
    let presentation: ConversationMemoryReviewPresentation
    let onSaved: (ConversationMemoryDestination) -> Void
    let onOpenPerson: (String) -> Void
    let onSource: (() -> Void)?
    let onItemSource: ((ConversationMemoryItem.Locator) -> Void)?
    let onReviewSource: ((UUID, Int?) -> Void)?
    @State private var choosingPerson = false
    @FocusState private var focusedField: String?
    @Environment(\.colorScheme) private var colorScheme

    init(proposal: ConversationMemoryProposalReference, sessionID: UUID, sourceMessageID: UUID? = nil,
         sourceMessageIDs: Set<UUID>? = nil,
         client: ConversationMemoryReviewClient, language: AppLanguage,
         presentation: ConversationMemoryReviewPresentation = .editorial,
         onSaved: @escaping (ConversationMemoryDestination) -> Void = { _ in },
         onOpenPerson: @escaping (String) -> Void = { _ in }, onSource: (() -> Void)? = nil,
         onItemSource: ((ConversationMemoryItem.Locator) -> Void)? = nil,
         onReviewSource: ((UUID, Int?) -> Void)? = nil) {
        self.init(store: ConversationMemoryReviewStore(proposal: proposal, sessionID: sessionID,
            sourceMessageID: sourceMessageID, sourceMessageIDs: sourceMessageIDs, client: client), language: language, presentation: presentation,
            onSaved: onSaved, onOpenPerson: onOpenPerson, onSource: onSource, onItemSource: onItemSource, onReviewSource: onReviewSource)
    }

    init(store: ConversationMemoryReviewStore, language: AppLanguage,
         presentation: ConversationMemoryReviewPresentation = .editorial,
         onSaved: @escaping (ConversationMemoryDestination) -> Void = { _ in },
         onOpenPerson: @escaping (String) -> Void = { _ in }, onSource: (() -> Void)? = nil,
         onItemSource: ((ConversationMemoryItem.Locator) -> Void)? = nil,
         onReviewSource: ((UUID, Int?) -> Void)? = nil) {
        _store = StateObject(wrappedValue: store)
        self.language = language; self.presentation = presentation
        self.onSaved = onSaved; self.onOpenPerson = onOpenPerson; self.onSource = onSource
        self.onItemSource = onItemSource
        self.onReviewSource = onReviewSource
    }

    var body: some View {
        observedSurface
            .onChange(of: store.destination) { destination in
                if let destination { onSaved(destination) }
            }
            .sheet(isPresented: $choosingPerson) { identityChoices }
    }

    private var observedSurface: some View {
        cardSurface
            .task { if store.phase == .idle { await store.open() } }
            .onDisappear { store.suspend() }
            .onChange(of: store.selectedItemIDs) { _ in store.scheduleDraft() }
            .onChange(of: store.editedText) { _ in store.scheduleDraft() }
            .onChange(of: store.decisions) { _ in store.scheduleDraft() }
    }

    private var cardSurface: some View {
        VStack(alignment: .leading, spacing: 16) { phaseContent }
            .font(.body)
            .padding(presentation == .compact ? 16 : 0)
            .background { compactBackground }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("conversation.memory.review")
    }

    @ViewBuilder private var compactBackground: some View {
        if presentation == .compact {
            RoundedRectangle(cornerRadius: 18).fill(Color.primary.opacity(0.035))
        }
    }

    @ViewBuilder private var phaseContent: some View {
        switch store.phase {
        case .idle, .opening:
            loadingReview
        case .saved:
            if let destination = store.destination { saved(destination) }
        case .dismissed:
            dismissedReview
        default:
            activeReview
        }
    }

    private var loadingReview: some View {
        HStack(spacing: 10) {
            ProgressView().accessibilityHidden(true)
            Text(language.text("Loading contact review…"))
        }.foregroundStyle(.secondary).frame(minHeight: 44)
    }

    private var dismissedReview: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let destination = store.destination { saved(destination) }
            Label(dismissedLabel, systemImage: "minus.circle")
                .foregroundStyle(.secondary).frame(minHeight: 44)
        }
    }

    private var dismissedLabel: String {
        language.text(store.destination == nil ? "Not saved" : "Remaining details not saved")
    }

    private var activeReview: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let destination = store.destination {
                saved(destination)
                Divider()
            }
            if let review = store.review { reviewContent(review) }
            if let notice = store.notice {
                Text(language.text(notice)).font(.body).foregroundStyle(.secondary)
                    .accessibilityIdentifier("conversation.memory.notice")
            }
            recovery
        }
    }

    private func reviewContent(_ review: ConversationMemoryReview) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            reviewHeader(review)
            contactDecisionFields(review)
            if review.contact_decision == "new" {
                if store.phase == .review { reviewActions }
                newContactMemoryPreview
            } else {
                pendingMemoryItems(review)
                if store.phase == .review { reviewActions }
            }
        }
    }

    private func reviewHeader(_ review: ConversationMemoryReview) -> some View {
        let name = review.person_display_label ?? language.text("Review contact")
        let initial = String((review.person_display_label ?? "?").prefix(1))
        let stateLabel = language.text(store.needsIdentityChoice ? "Choose who this is before saving" : "Waiting for your review")
        return HStack(alignment: .top, spacing: 12) {
            Text(initial).font(.title3.weight(.medium))
                .frame(width: 44, height: 44)
                .background(Color.primary.opacity(0.06), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(name).font(.headline).fixedSize(horizontal: false, vertical: true)
                Text(stateLabel).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder private func contactDecisionFields(_ review: ConversationMemoryReview) -> some View {
        if store.needsIdentityChoice {
            chooseIdentityButton
        } else if review.contact_decision == "new" {
            newContactFields
        }
    }

    private var chooseIdentityButton: some View {
        Button { choosingPerson = true } label: {
            Label(language.text("Choose contact"), systemImage: "person.crop.circle.badge.questionmark")
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }.buttonStyle(.bordered).disabled(store.isFrozen)
    }

    private var newContactFields: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField(language.text("Contact name"), text: $store.displayName)
                .focused($focusedField, equals: "name")
                .textContentType(.name).submitLabel(.done)
                .accessibilityIdentifier("conversation.memory.name")
                .frame(minHeight: 44)
            Divider()
            TextField(language.text("How you know each other (optional)"), text: $store.relationshipName, axis: .vertical)
                .focused($focusedField, equals: "relationship")
                .lineLimit(1...3).frame(minHeight: 44)
        }
        .padding(.horizontal, 12).padding(.vertical, 4)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 12))
        .disabled(store.isFrozen)
    }

    @ViewBuilder private var newContactMemoryPreview: some View {
        if !store.pendingItems.isEmpty {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 12) {
                    Text(language.text("Add the contact first, then choose which details to remember."))
                        .foregroundStyle(.secondary)
                    ForEach(store.pendingItems) { item in
                        Text(item.display_text).fixedSize(horizontal: false, vertical: true)
                    }
                }.padding(.vertical, 8)
            } label: {
                Text(String(format: language.text("%d suggested details to review next"), store.pendingItems.count))
                    .font(.subheadline).foregroundStyle(.secondary).frame(minHeight: 44)
            }
            .accessibilityIdentifier("conversation.memory.pending-preview")
        }
    }

    private func pendingMemoryItems(_ review: ConversationMemoryReview) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            if review.contact_decision == "new", !store.pendingItems.isEmpty {
                Text(language.text("Add the contact first, then choose which details to remember."))
                    .foregroundStyle(.secondary)
            }
            ForEach(store.pendingItems) { item in itemRow(item) }
        }
    }

    private var reviewActions: some View {
        VStack(alignment: .leading, spacing: 4) {
            saveButton
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 16) { secondaryActions }
                VStack(alignment: .leading, spacing: 0) { secondaryActions }
            }
        }
    }

    private var saveButton: some View {
        Button { Task { await store.save() } } label: {
            Text(primaryLabel).font(.body.weight(.semibold))
                .foregroundColor(colorScheme == .dark ? .black : .white)
                .frame(maxWidth: .infinity, minHeight: 48)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderedProminent).tint(Color.primary).disabled(!store.canSave)
        .accessibilityIdentifier("conversation.memory.save")
    }

    private var primaryLabel: String {
        if let review = store.review, review.contact_decision == "new" {
            if store.displayName.trimmingCharacters(in: .whitespacesAndNewlines) != review.person_display_label
                || store.relationshipName.trimmingCharacters(in: .whitespacesAndNewlines) != (review.relationship_display_label ?? "") {
                return language.text("Review corrected contact")
            }
            return language.text("Add contact")
        }
        return language.text("Save selected details")
    }

    @ViewBuilder private var secondaryActions: some View {
        if onSource != nil || onReviewSource != nil {
            Button {
                focusedField = nil
                if let id = UUID(uuidString: store.review?.source_message_id ?? ""), let onReviewSource {
                    onReviewSource(id, nil)
                } else { onSource?() }
            } label: {
                Label(language.text("View source"), systemImage: "doc.text.magnifyingglass")
                    .frame(minHeight: 44).contentShape(Rectangle())
            }
        }
        if store.allowsIdentityChanges {
            Button { choosingPerson = true } label: { MemoryReviewButtonLabel(title: language.text("Change contact")) }
        }
        Button { Task { await store.dismiss() } } label: { MemoryReviewButtonLabel(title: language.text("Not now")) }
    }

    private func itemRow(_ item: ConversationMemoryItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Button {
                    if store.selectedItemIDs.contains(item.id) { store.selectedItemIDs.remove(item.id) }
                    else { store.selectedItemIDs.insert(item.id) }
                } label: {
                    Image(systemName: store.selectedItemIDs.contains(item.id) ? "checkmark.circle.fill" : "circle")
                        .font(.title3).frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain).disabled(store.isFrozen || !item.canSelect || store.review?.contact_decision == "new")
                .accessibilityLabel(language.text("Select detail") + ": " + item.display_text)
                .accessibilityAddTraits(store.selectedItemIDs.contains(item.id) ? [.isSelected] : [])
                VStack(alignment: .leading, spacing: 4) {
                    Text(language.text(item.scope == "self" ? "About me" : item.scope == "relationship" ? "Between us" : "About this contact"))
                        .font(.subheadline).foregroundStyle(.secondary)
                    if let previous = item.previous_text {
                        Text(previous).foregroundStyle(.secondary).strikethrough()
                    }
                    TextField(language.text("Detail to remember"), text: Binding(
                        get: { store.editedText[item.id] ?? item.display_text },
                        set: { store.editedText[item.id] = $0 }), axis: .vertical)
                        .focused($focusedField, equals: item.id)
                        .lineLimit(1...8).frame(minHeight: 44)
                        .disabled(store.isFrozen || !item.canSelect)
                }
            }
            if item.requiresJudgment {
                Text(language.text(judgmentLabel(item))).foregroundStyle(.secondary)
                if !ConversationMemoryReviewStore.allowedDecisions(for: item).isEmpty {
                    Picker(language.text("Your decision"), selection: Binding(
                        get: { store.decisions[item.id] ?? "" }, set: { store.decisions[item.id] = $0 })) {
                        Text(language.text("Choose a decision")).tag("")
                        ForEach(ConversationMemoryReviewStore.allowedDecisions(for: item), id: \.self) { decision in
                            Text(language.text(decisionLabel(decision))).tag(decision)
                        }
                    }.frame(minHeight: 44).disabled(store.isFrozen)
                }
            }
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.source_excerpt).textSelection(.enabled)
                    if let index = item.source_locator.image_index {
                        Text(String(format: language.text("Image %d"), index + 1)).font(.subheadline).foregroundStyle(.secondary)
                    }
                    if onItemSource != nil || onSource != nil || onReviewSource != nil {
                        Button {
                            focusedField = nil
                            if let id = UUID(uuidString: item.source_locator.message_id ?? store.review?.source_message_id ?? ""), let onReviewSource {
                                onReviewSource(id, item.source_locator.image_index)
                            } else if let onItemSource { onItemSource(item.source_locator) } else { onSource?() }
                        } label: { MemoryReviewButtonLabel(title: language.text("View original source")) }
                    }
                }.padding(.vertical, 8)
            } label: { Text(language.text("Source")).font(.subheadline).frame(minHeight: 44) }
            Divider()
        }
    }

    @ViewBuilder private var recovery: some View {
        switch store.phase {
        case .saving:
            HStack(spacing: 10) {
                ProgressView().accessibilityHidden(true)
                Text(language.text("Saving your decision…"))
            }.frame(minHeight: 44)
        case .unknown:
            Button { Task { await store.reconcile() } } label: { MemoryReviewButtonLabel(title: language.text("Check result")) }
                .buttonStyle(.bordered)
        case .stale, .unavailable:
            Button { Task { await store.open() } } label: { MemoryReviewButtonLabel(title: language.text("Reload review")) }
                .buttonStyle(.bordered)
        default: EmptyView()
        }
    }

    private func saved(_ destination: ConversationMemoryDestination) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(language.text(destination.contactWasCreated ? "Contact added" : "Review decision saved"), systemImage: "checkmark.circle")
                .font(.headline)
            if let label = destination.personDisplayLabel { Text(label).textSelection(.enabled) }
            if destination.savedItemCount > 0 {
                Text(String(format: language.text("%d details saved"), destination.savedItemCount)).foregroundStyle(.secondary)
            }
            if let personID = destination.personID {
                Button { onOpenPerson(personID) } label: { MemoryReviewButtonLabel(title: language.text("View contact")) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversation.memory.saved")
    }

    private var identityChoices: some View {
        ConversationMemoryIdentityChoices(store: store, language: language) { choosingPerson = false }
            .presentationDragIndicator(.visible)
    }

    private func judgmentLabel(_ item: ConversationMemoryItem) -> String {
        switch item.judgment_kind {
        case "conflict": "These details differ from an earlier record. Choose what to keep."
        case "sensitive": "This detail is private. Decide whether it needs to be kept."
        case "ambiguous_attribution": "Who said this is unclear. Correct the source before saving."
        case "stale_target": "The earlier record changed. Reload before saving."
        case "self_scope_escape": "This detail concerns another person. Confirm the contact first."
        default: "Review this detail before saving."
        }
    }
    private func decisionLabel(_ value: String) -> String {
        switch value {
        case "keep_old": "Keep earlier detail"
        case "accept_new": "Use new detail"
        case "retain_conflict": "Keep both accounts"
        default: "Keep this detail"
        }
    }
}

/// Put the size on the Button's label so UIKit's accessibility frame and the
/// tappable region include the full target, rather than surrounding padding.
private struct MemoryReviewButtonLabel: View {
    let title: String
    var body: some View {
        Text(title).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
    }
}

private struct ConversationMemoryIdentityChoices: View {
    @ObservedObject var store: ConversationMemoryReviewStore
    let language: AppLanguage
    let close: () -> Void
    @State private var query = ""
    @State private var newName = ""
    @State private var newRelationship = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(language.text("Name, email, or confirmed contact detail"), text: $query)
                        .submitLabel(.search).onSubmit { search() }
                    Button(action: search) { MemoryReviewButtonLabel(title: language.text("Find existing contact")) }
                        .disabled(store.isSearching || query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if store.isSearching { ProgressView().accessibilityLabel(language.text("Finding contacts…")) }
                    if let notice = store.searchNotice { Text(language.text(notice)).foregroundStyle(.secondary) }
                    ForEach(store.people) { person in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(person.display_label).font(.headline)
                            if let match = person.identity_matches?.first, let hint = match.display_hint {
                                Text(language.text(match.kind == "expired_handle" ? "Historical contact detail" : "Confirmed contact detail") + ": " + hint)
                                    .foregroundStyle(.secondary)
                            } else { Text(language.text("Name match. Check who this is.")).foregroundStyle(.secondary) }
                            if person.contexts.isEmpty {
                                Button { choose(person, contextID: nil) } label: { MemoryReviewButtonLabel(title: language.text("Use this contact")) }
                            } else {
                                ForEach(person.contexts) { context in
                                    Button { choose(person, contextID: context.id) } label: { MemoryReviewButtonLabel(title: context.display_label) }
                                }
                            }
                        }
                    }
                } header: { Text(language.text("Existing contact")) }
                Section {
                    TextField(language.text("Contact name"), text: $newName).textContentType(.name)
                    TextField(language.text("How you know each other (optional)"), text: $newRelationship, axis: .vertical)
                    Button {
                        Task { await store.chooseNewContact(name: newName, relationship: newRelationship); if store.phase == .review { close() } }
                    } label: { MemoryReviewButtonLabel(title: language.text("Review as a new contact")) }
                    .disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } header: { Text(language.text("New contact")) }
                Section {
                    Button {
                        Task { await store.chooseNoContact(); if store.phase == .review { close() } }
                    } label: { MemoryReviewButtonLabel(title: language.text("Continue without a contact")) }
                }
                if let notice = store.notice { Text(language.text(notice)).foregroundStyle(.secondary) }
            }
            .disabled(store.isFrozen)
            .navigationTitle(language.text("Choose contact"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) {
                Button(action: close) { MemoryReviewButtonLabel(title: language.text("Done")) }
            } }
        }
    }
    private func search() { Task { await store.search(query: query) } }
    private func choose(_ person: ConversationMemoryPerson, contextID: String?) {
        Task { await store.chooseExisting(person: person, contextID: contextID); if store.phase == .review { close() } }
    }
}
