import SwiftUI

/// The overview is deliberately small. Provenance and operational state live
/// on the exact record reached from each disclosure, never in a second summary.
@MainActor
struct WorkspacePersonDetailView: View {
    let person: WorkspacePerson
    let roles: [WorkspacePersonRole]
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    var isPushed = false
    var onContinue: ((String?) -> Void)? = nil
    @StateObject private var memory = PersonMemoryStore()
    @State private var contextID: String?
    @State private var isShowingChild = false
    @State private var isVisible = false
    @State private var pendingConversation = false
    @State private var loadGeneration = 0
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase

    init(person: WorkspacePerson, roles: [WorkspacePersonRole], workspaceStore: PursuitWorkspaceStore,
         isPushed: Bool = false, onContinue: ((String?) -> Void)? = nil) {
        self.person = person; self.roles = roles; self.workspaceStore = workspaceStore
        self.isPushed = isPushed; self.onContinue = onContinue
        _contextID = State(initialValue: PersonHandbookPolicy.initialContextID(for: person))
    }

    private var currentPerson: WorkspacePerson? {
        workspaceStore.isCanonical ? workspaceStore.snapshot?.person(id: person.id) : person
    }
    private var context: WorkspacePerson.Context? { currentPerson?.contexts.first { $0.id == contextID } }
    private var currentRoles: [WorkspacePersonRole] {
        workspaceStore.isCanonical ? PersonHandbookPolicy.roles(for: person.id, in: workspaceStore.snapshot) : roles
    }
    private var work: (pursuit: WorkspacePursuit, action: WorkspaceAction)? {
        guard (currentPerson?.contexts.count ?? 0) <= 1 else { return nil }
        return PersonHandbookPolicy.work(for: person.id, in: workspaceStore.snapshot)
    }
    private var subtitle: String? {
        if let headline = currentPerson?.profile?.headline, !headline.isEmpty { return headline }
        // A custom project role may orient the reader, but several roles are
        // not collapsed into an invented universal job title.
        let active = currentRoles.filter { $0.status == "active" && $0.confidence == "confirmed" }
        return active.count == 1 && (currentPerson?.contexts.count ?? 0) <= 1
            ? appLanguage.text(active[0].roleType.humanized) : nil
    }

    var body: some View {
        Group {
            if isPushed { page }
            else {
                NavigationStack {
                    page.toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button(appLanguage.text("Close")) { dismiss() }
                        }
                    }
                }
            }
        }
        .onAppear { isVisible = true }
        .onDisappear {
            isVisible = false
            if pendingConversation {
                pendingConversation = false
                onContinue?(contextID)
            }
        }
        .task(id: "\(person.id)|\(contextID ?? "person")") { await loadMemory() }
        .onChange(of: scenePhase) { phase in
            if phase != .active { loadGeneration += 1; memory.clear() }
            else if isVisible && !isShowingChild { Task { await loadMemory() } }
        }
    }

    private var page: some View {
        ScrollView {
            if let currentPerson {
                VStack(alignment: .leading, spacing: 0) {
                    identity(currentPerson)
                        .padding(.top, 20)
                    contextAndExcerpt(currentPerson)
                        .padding(.top, 38)
                    if let work {
                        NavigationLink {
                            PersonWorkDetailView(pursuitID: work.pursuit.id, actionID: work.action.id,
                                workspaceStore: workspaceStore)
                        } label: {
                            disclosure(title: work.action.title, subtitle: actionLabel(work.action), maxLines: 2)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 34)
                        .accessibilityIdentifier("person-detail-work")
                    }
                    NavigationLink {
                        PersonMemoryListView(memory: memory, person: currentPerson, context: context,
                            reload: { await loadMemory(requiring: $0) })
                            .onAppear { isShowingChild = true }
                            .onDisappear { isShowingChild = false }
                    } label: { disclosure(title: appLanguage.text("Memory")) }
                        .buttonStyle(.plain)
                        .padding(.top, 28)
                        .accessibilityIdentifier("person-detail-memory")
                    Divider().overlay(Color.tsLine)
                    NavigationLink {
                        PersonInformationView(person: currentPerson, roles: currentRoles, workspaceStore: workspaceStore)
                            .onAppear { isShowingChild = true }
                            .onDisappear { isShowingChild = false }
                    } label: { disclosure(title: appLanguage.text("Contact details")) }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("person-detail-information")
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 36)
            } else {
                Text(appLanguage.text("This person is not available in the current workspace."))
                    .padding(22)
            }
        }
        .background(Color.tsSurface.ignoresSafeArea())
        .navigationTitle(Text(verbatim: ""))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(appLanguage.text("Refresh")) { Task { await refresh() } }
                } label: {
                    Image(systemName: "ellipsis").frame(width: 44, height: 44)
                }
                .accessibilityLabel(appLanguage.text("More person actions"))
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if currentPerson != nil, onContinue != nil {
                Button {
                    pendingConversation = true
                    dismiss()
                } label: {
                    HStack(spacing: 14) {
                        TalentSignalBrandMark().frame(width: 26, height: 26)
                        Text(appLanguage.text("Continue conversation"))
                            .font(.body.weight(.medium))
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right").font(.footnote)
                            .foregroundStyle(Color.tsMutedInk)
                    }
                    .foregroundStyle(Color.tsInk)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                    .frame(minHeight: 52)
                    .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 14))
                    .overlay { RoundedRectangle(cornerRadius: 14).stroke(Color.tsLine, lineWidth: 1) }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("person-detail-continue")
                .padding(.horizontal, 22).padding(.vertical, 12)
                .background(Color.tsSurface)
            }
        }
        .refreshable { await refresh() }
        .accessibilityIdentifier("workspace-person-detail")
    }

    private func identity(_ person: WorkspacePerson) -> some View {
        HStack(alignment: .top, spacing: 16) {
            WorkspacePersonAvatar(person: person, size: 52)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(person.displayLabel)
                    .font(.system(.title, design: .default).weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("person-detail-name")
                if let subtitle {
                    Text(subtitle).font(.subheadline).foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func contextAndExcerpt(_ person: WorkspacePerson) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if person.contexts.count > 1 {
                Menu {
                    Button(appLanguage.text("About this person")) { contextID = nil }
                    ForEach(person.contexts) { item in
                        Button(item.displayLabel) { contextID = item.id }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text(context?.displayLabel ?? appLanguage.text("Choose relationship"))
                        Image(systemName: "chevron.down").font(.caption2)
                    }
                    .font(.subheadline).foregroundStyle(Color.tsMutedInk)
                    .frame(minHeight: 44)
                }
                .accessibilityIdentifier("person-detail-context")
            } else if let context {
                Text(context.displayLabel).font(.subheadline).foregroundStyle(Color.tsMutedInk)
            }
            if memory.phase == .loading {
                ProgressView().accessibilityLabel(appLanguage.text("Loading Memory…"))
            } else if memory.phase == .unavailable {
                Button(appLanguage.text("Reload Memory")) { Task { await loadMemory() } }
                    .font(.subheadline).frame(minHeight: 44)
                    .accessibilityIdentifier("person-detail-memory-retry")
            } else if let item = PersonHandbookPolicy.excerpt(in: memory.items) {
                NavigationLink {
                    PersonMemoryDetailView(memory: memory, itemID: item.id, context: context,
                        reload: { await loadMemory(requiring: item.id) })
                        .onAppear { isShowingChild = true }
                        .onDisappear { isShowingChild = false }
                } label: {
                    disclosure(title: item.display_text,
                        subtitle: PersonMemoryPresentation.caption(item, language: appLanguage),
                        font: .title3, maxLines: 3)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("person-detail-excerpt")
            }
        }
    }

    private func disclosure(title: String, subtitle: String? = nil, font: Font = .body,
                            maxLines: Int? = nil) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(font).foregroundStyle(Color.tsInk)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : maxLines)
                    .fixedSize(horizontal: false, vertical: true)
                if let subtitle { Text(subtitle).font(.subheadline).foregroundStyle(Color.tsMutedInk) }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Color.tsMutedInk)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .padding(.vertical, 10).contentShape(Rectangle())
    }

    private func actionLabel(_ action: WorkspaceAction) -> String {
        // Draft remains visible in human language even if its title lacks it.
        if action.status == "drafted" { return appLanguage.text("Draft · internal preparation") }
        return appLanguage.text(PersonMemoryPresentation.actionKey(action.status))
    }

    private func refresh() async {
        if workspaceStore.isCanonical { await workspaceStore.load() }
        await loadMemory()
    }

    private func loadMemory(requiring itemID: String? = nil) async {
        loadGeneration += 1
        let epoch = loadGeneration
        memory.beginLoading()
        guard let currentPerson else { memory.clear(); return }
        let selected = currentPerson.contexts.contains { $0.id == contextID } ? contextID : nil
        if selected != contextID { contextID = selected; return }
        guard workspaceStore.isCanonical else {
            // Demo data is explicitly synthetic; never fallback to it on an API failure.
            await memory.load(personID: currentPerson.id, contextID: selected,
                service: PersonMemoryPreview(person: currentPerson, contextID: selected), requiring: itemID)
            return
        }
        do {
            let client = try await workspaceStore.memoryReviewClient()
            guard !Task.isCancelled, epoch == loadGeneration, selected == contextID else { return }
            await memory.load(personID: currentPerson.id, contextID: selected, service: client, requiring: itemID)
        } catch {
            guard epoch == loadGeneration, !Task.isCancelled else { return }
            memory.markUnavailable()
        }
    }
}

private struct PersonMemoryPreview: PersonMemoryServing {
    let person: WorkspacePerson
    let contextID: String?
    func isCurrentScope() async -> Bool { true }
    func recallPersonMemory(personID: String, contextID: String?, cursor: String?) async throws -> PersonMemoryPage {
        // Profile text is not accepted Memory. An empty demo is preferable to
        // quietly reclassifying a biography as a remembered fact.
        var items: [PersonMemoryItem] = []
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--fixture-contact-memory"),
           ProcessInfo.processInfo.environment["TS_IOS_UI_TEST_PREVIEW_WORKSPACE"] == "true" {
            // Explicit, isolated UI fixture; never used by canonical accounts
            // or as recovery for a failed network request.
            items = [PersonMemoryItem(id: "22000000-0000-4000-8000-000000000001",
                scope: "person", statement_kind: "source_statement",
                display_text: "下周二前确认试点范围。", original_display_text: "下周二前确认试点范围。",
                subject_id: personID, relationship_context_id: nil,
                speaker: person.displayLabel, reporter: nil, valid_time: nil, observed_time: nil,
                time_status: "future", sensitivity: "normal", version: 1, conflict_group_id: nil,
                evidence_retained: true,
                evidence_refs: [.init(excerpt: "Synthetic UI fixture: 下周二前确认试点范围。",
                    locator: .init(kind: "document", session_id: nil, message_id: nil, image_index: nil),
                    capture_id: nil, source_resource_id: nil, source_session_id: nil, source_message_id: nil)],
                created_at: "2026-10-23T08:00:00Z")]
        }
#endif
        return PersonMemoryPage(contract_version: TalentSignalAPIContract.version,
            surface: contextID == nil ? "people" : "relationship", person_id: personID,
            relationship_context_id: contextID, items: items, has_more: false, next_cursor: nil)
    }
}
