import SwiftUI

@MainActor
struct PersonMemoryListView: View {
    @ObservedObject var memory: PersonMemoryStore
    let person: WorkspacePerson
    let context: WorkspacePerson.Context?
    let reload: (String?) async -> Void
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.scenePhase) private var scenePhase
    @State private var isVisible = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let context {
                    Text(context.displayLabel).font(.subheadline).foregroundStyle(Color.tsMutedInk)
                }
                if memory.phase == .loading || memory.phase == .idle { ProgressView() }
                else if memory.phase == .unavailable {
                    Button(appLanguage.text("Reload Memory")) { Task { await reload(nil) } }
                        .frame(minHeight: 44)
                } else if memory.items.isEmpty {
                    Text(appLanguage.text("No saved Memory here yet."))
                        .foregroundStyle(Color.tsMutedInk)
                } else {
                    ForEach(memory.items) { item in
                        NavigationLink {
                            PersonMemoryDetailView(memory: memory, itemID: item.id, context: context,
                                reload: { await reload(item.id) })
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(appLanguage.text(item.scope == "person" ? "About this person" : "Between us"))
                                    .font(.caption).foregroundStyle(Color.tsMutedInk)
                                Text(item.display_text).font(.body).foregroundStyle(Color.tsInk)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(PersonMemoryPresentation.caption(item, language: appLanguage))
                                    .font(.caption).foregroundStyle(Color.tsMutedInk)
                                HStack {
                                    Text(appLanguage.text("View source"))
                                    Image(systemName: "chevron.right")
                                }
                                .font(.caption).foregroundStyle(Color.tsMutedInk)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(.vertical, 8).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("person-memory-\(item.id)")
                        Divider().overlay(Color.tsLine)
                    }
                    if memory.nextCursor != nil {
                        Button(appLanguage.text("Load more")) { Task { await memory.loadMore() } }
                            .frame(minHeight: 44).disabled(memory.loadingMore)
                    }
                }
            }
            .padding(22)
        }
        .background(Color.tsSurface.ignoresSafeArea())
        .navigationTitle(appLanguage.text("Memory"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("person-memory-list")
        .task { await reload(nil) }
        .onAppear { isVisible = true }
        .onDisappear { isVisible = false }
        .onChange(of: scenePhase) { phase in
            if phase == .active, isVisible { Task { await reload(nil) } }
        }
        .refreshable { await reload(nil) }
    }
}

@MainActor
struct PersonMemoryDetailView: View {
    @ObservedObject var memory: PersonMemoryStore
    let itemID: String
    let context: WorkspacePerson.Context?
    let reload: () async -> Void
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.scenePhase) private var scenePhase
    @State private var isVisible = false

    private var item: PersonMemoryItem? { memory.items.first { $0.id == itemID } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if memory.phase == .loading || memory.phase == .idle { ProgressView() }
                else if let item {
                    Text(appLanguage.text(item.scope == "person" ? "About this person" : "Between us"))
                        .font(.caption).foregroundStyle(Color.tsMutedInk)
                    if item.scope == "relationship", let context {
                        Text(context.displayLabel).font(.subheadline)
                    }
                    Text(item.display_text).font(.title3)
                        .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                    Text(PersonMemoryPresentation.caption(item, language: appLanguage))
                        .font(.subheadline).foregroundStyle(Color.tsMutedInk)
                    if item.conflict_group_id != nil {
                        Text(appLanguage.text("Conflicting records need review."))
                            .font(.subheadline).foregroundStyle(Color.tsVermilion)
                    }
                    metadata(appLanguage.text("Speaker"), item.speaker)
                    if item.reporter != item.speaker { metadata(appLanguage.text("Recorded by"), item.reporter) }
                    metadata(appLanguage.text("Recorded"), date(item.created_at))
                    metadata(appLanguage.text("Observed"), item.observed_time.flatMap(date))
                    metadata(appLanguage.text("Valid at"), item.valid_time.flatMap(date))
                    if item.original_display_text != item.display_text {
                        DisclosureGroup(appLanguage.text("Original wording")) {
                            Text(item.original_display_text).textSelection(.enabled).padding(.top, 10)
                        }
                    }
                    Divider().overlay(Color.tsLine)
                    Text(appLanguage.text("Source"))
                        .font(.headline).accessibilityAddTraits(.isHeader)
                    ForEach(Array(item.evidence_refs.enumerated()), id: \.offset) { _, evidence in
                        Text(evidence.excerpt).font(.body).textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.vertical, 8)
                    }
                } else {
                    Text(appLanguage.text("This Memory could not be refreshed."))
                    Button(appLanguage.text("Reload Memory")) { Task { await reload() } }
                        .frame(minHeight: 44)
                }
            }
            .foregroundStyle(Color.tsInk)
            .frame(maxWidth: .infinity, alignment: .leading).padding(22)
        }
        .background(Color.tsSurface.ignoresSafeArea())
        .navigationTitle(appLanguage.text("Memory"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("person-memory-detail")
        .task { await reload() }
        .onAppear { isVisible = true }
        .onDisappear { isVisible = false }
        .onChange(of: scenePhase) { phase in
            if phase == .active, isVisible { Task { await reload() } }
        }
        .refreshable { await reload() }
    }

    @ViewBuilder private func metadata(_ title: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.caption).foregroundStyle(Color.tsMutedInk)
                Text(value).font(.subheadline).textSelection(.enabled)
            }
        }
    }
    private func date(_ value: String) -> String? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let parsed = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = appLanguage.locale
        formatter.dateStyle = .medium; formatter.timeStyle = .short
        return formatter.string(from: parsed) + " · " + TimeZone.current.identifier
    }
}

@MainActor
struct PersonWorkDetailView: View {
    let pursuitID: String
    let actionID: String
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let pursuit = workspaceStore.snapshot?.pursuit(id: pursuitID),
                   let action = pursuit.actions.first(where: { $0.id == actionID }) {
                    Text(pursuit.title).font(.subheadline).foregroundStyle(Color.tsMutedInk)
                    Text(action.title).font(.title2).fixedSize(horizontal: false, vertical: true)
                    Text(appLanguage.text(PersonMemoryPresentation.actionKey(action.status))).font(.subheadline)
                    Text(pursuit.targetOutcome).font(.body)
                    Text(action.ownerDisplayName).font(.subheadline).foregroundStyle(Color.tsMutedInk)
                    if let dueAt = action.dueAt {
                        // This is the stored Action date, never a parsed Memory deadline.
                        Text(appLanguage.text("Planned time")).font(.caption)
                        Text(plannedTime(dueAt))
                            .font(.subheadline).foregroundStyle(Color.tsMutedInk)
                    }
                    if let outcome = action.outcomeSummary { Text(outcome).textSelection(.enabled) }
                    if let notice = workspaceStore.refreshNotice {
                        Text(notice).font(.footnote).foregroundStyle(Color.tsMutedInk)
                    }
                } else {
                    Text(appLanguage.text("This work item is no longer available."))
                }
            }
            .foregroundStyle(Color.tsInk).frame(maxWidth: .infinity, alignment: .leading).padding(22)
        }
        .background(Color.tsSurface.ignoresSafeArea())
        .navigationTitle(appLanguage.text("Details"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("person-work-detail")
        .task { if workspaceStore.isCanonical { await workspaceStore.load() } }
        .refreshable { await workspaceStore.load() }
    }

    private func plannedTime(_ value: String) -> String {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) else {
            return appLanguage.text("Time unavailable")
        }
        let formatter = DateFormatter()
        formatter.locale = appLanguage.locale
        formatter.dateStyle = .medium; formatter.timeStyle = .short
        return formatter.string(from: date) + " · " + TimeZone.current.identifier
    }
}

@MainActor
struct PersonInformationView: View {
    let person: WorkspacePerson
    let roles: [WorkspacePersonRole]
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    @State private var sourceGroups: [(context: String, tasks: [ScreenshotContactTask])] = []
    @State private var sourceFailed = false
    @State private var sourceGeneration = 0
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.scenePhase) private var scenePhase

    private var currentRoles: [WorkspacePersonRole] {
        workspaceStore.isCanonical ? PersonHandbookPolicy.roles(for: person.id, in: workspaceStore.snapshot) : roles
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let profile = workspaceStore.snapshot?.person(id: person.id)?.profile ?? (workspaceStore.isCanonical ? nil : person.profile) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(appLanguage.text("About"))
                            .font(.headline).accessibilityIdentifier("person-detail-about")
                        Text(profile.headline).font(.headline)
                        Text(profile.summary).font(.body).textSelection(.enabled)
                        Text(appLanguage.text(profile.provenanceKind == "reviewed_public_source"
                            ? "Confirmed from a reviewed public source" : "Written by the workspace owner"))
                            .font(.caption).foregroundStyle(Color.tsMutedInk)
                            .accessibilityIdentifier("person-detail-profile-provenance")
                        if let source = profile.sourceProfileURL, let url = URL(string: source),
                           url.scheme?.lowercased() == "https", url.host != nil {
                            Link(appLanguage.text("Public source"), destination: url).frame(minHeight: 44)
                        }
                    }
                }
                ForEach(currentRoles) { role in
                    NavigationLink {
                        PersonRelatedWorkView(pursuitID: role.pursuitID, workspaceStore: workspaceStore)
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(role.pursuitTitle).font(.headline)
                                .accessibilityIdentifier("person-detail-role-title-\(role.id)")
                            Text(WorkspacePersonRolePresentation.summary(for: role, language: appLanguage))
                                .font(.subheadline).foregroundStyle(Color.tsMutedInk)
                            Text(appLanguage.text(PersonMemoryPresentation.evidenceKey(role.evidenceState.availability)))
                                .font(.caption).foregroundStyle(Color.tsMutedInk)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                }
                ForEach(Array(sourceGroups.enumerated()), id: \.offset) { _, group in
                    VStack(alignment: .leading, spacing: 14) {
                        Text(group.context).font(.headline)
                        ForEach(group.tasks) { task in
                            ScreenshotContactCard(task: task, language: appLanguage,
                                onLoadImage: { index in
                                    try await workspaceStore.loadScreenshotContactImage(taskID: task.taskID, index: index)
                                })
                        }
                    }
                }
                if sourceFailed {
                    Button(appLanguage.text("Reload source details")) { Task { await loadSources() } }
                        .frame(minHeight: 44)
                }
                if person.profile == nil, currentRoles.isEmpty, sourceGroups.isEmpty, !sourceFailed {
                    Text(appLanguage.text("No additional details yet.")).foregroundStyle(Color.tsMutedInk)
                }
            }
            .foregroundStyle(Color.tsInk).frame(maxWidth: .infinity, alignment: .leading).padding(22)
        }
        .background(Color.tsSurface.ignoresSafeArea())
        .navigationTitle(appLanguage.text("Contact details"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("person-information")
        .task { await loadSources() }
        .onChange(of: scenePhase) { phase in
            if phase != .active { sourceGeneration += 1; sourceGroups = [] }
            else { Task { await loadSources() } }
        }
        .onDisappear { sourceGeneration += 1; sourceGroups = [] }
    }

    private func loadSources() async {
        sourceGeneration += 1
        let epoch = sourceGeneration
        sourceGroups = []; sourceFailed = false
        guard workspaceStore.isCanonical else { return }
        do {
            let lease = try await workspaceStore.memoryReviewClient()
            var groups: [(context: String, tasks: [ScreenshotContactTask])] = []
            guard let current = workspaceStore.snapshot?.person(id: person.id) else { return }
            for context in current.contexts {
                if groups.reduce(0, { $0 + $1.tasks.count }) >= 20 { break }
                try Task.checkCancellation()
                let envelope = try await workspaceStore.loadContactIntelligence(personID: person.id, contextID: context.id)
                let isCurrent = await lease.isCurrentScope()
                guard epoch == sourceGeneration, scenePhase == .active, isCurrent else { return }
                let remaining = 20 - groups.reduce(0, { $0 + $1.tasks.count })
                let tasks = Array(envelope.tasks.prefix(remaining))
                if !tasks.isEmpty { groups.append((context.displayLabel, tasks)) }
            }
            try Task.checkCancellation()
            let isCurrent = await lease.isCurrentScope()
            guard epoch == sourceGeneration, scenePhase == .active, isCurrent else { return }
            sourceGroups = groups
        } catch is CancellationError { }
        catch { if epoch == sourceGeneration { sourceFailed = true } }
    }
}

@MainActor
private struct PersonRelatedWorkView: View {
    let pursuitID: String
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let pursuit = workspaceStore.snapshot?.pursuit(id: pursuitID) {
                    Text(pursuit.title).font(.title2)
                    Text(pursuit.targetOutcome).font(.body)
                    ForEach(pursuit.actions) { action in
                        NavigationLink {
                            PersonWorkDetailView(pursuitID: pursuit.id, actionID: action.id,
                                workspaceStore: workspaceStore)
                        } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(action.title).font(.headline)
                                Text(appLanguage.text(PersonMemoryPresentation.actionKey(action.status)))
                                    .font(.subheadline).foregroundStyle(Color.tsMutedInk)
                            }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }.foregroundStyle(Color.tsInk).padding(22)
        }
        .background(Color.tsSurface.ignoresSafeArea())
        .navigationTitle(appLanguage.text("Details"))
        .navigationBarTitleDisplayMode(.inline)
    }
}
