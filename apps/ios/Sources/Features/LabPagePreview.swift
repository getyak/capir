import SwiftUI

/// Uses the compiled product pages with synthetic values and in-memory callbacks.
/// The catalog makes no canonical reads, mutations or model calls. Review uses
/// StandaloneOnboardingView's isolated Lab route and capture-lifecycle guards.
struct LabPagePreview: View {
    @Binding var configuration: LabDisplayConfiguration
    let page: LabPreviewPage
    let state: LabPreviewState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLanguage) private var inheritedLanguage
    @State private var controls = false
    private var language: AppLanguage { configuration.language.value ?? inheritedLanguage }
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                header
                LabPreviewContents(page: page, state: state)
                    .id("\(page.rawValue)|\(state.rawValue)")
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .overlay(alignment: .bottomLeading) {
#if DEBUG
                if ProcessInfo.processInfo.environment["TS_IOS_UI_TEST_DISPLAY_PROBE"] == "true" {
                    LabEffectiveDisplayProbe(identifier: "lab-preview-effective-display")
                }
#endif
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $controls) {
                NavigationStack {
                    Form { LabDisplayControls(configuration: $configuration) }
                        .navigationTitle(language.text("Preview display"))
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(language.text("Done")) { controls = false } } }
                }
            }
        }
        .modifier(LabDisplayModifier(configuration: configuration))
        .accessibilityIdentifier("lab-preview-page")
    }
    private var header: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 18, weight: .medium))
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .accessibilityLabel(language.text("Close preview"))
                .accessibilityIdentifier("lab-preview-close")
                Text(language.text(page.title)).font(.headline).foregroundStyle(Color.tsInk)
                    .frame(maxWidth: .infinity).multilineTextAlignment(.center)
                Button { controls = true } label: {
                    Image(systemName: "slider.horizontal.3").font(.system(size: 18, weight: .medium))
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .accessibilityLabel(language.text("Display"))
                .accessibilityIdentifier("lab-preview-controls")
            }
            .buttonStyle(.plain).foregroundStyle(Color.tsVermilion)
            .padding(.horizontal, 12).padding(.vertical, 4)
            Text(language.text("SYNTHETIC PAGE · Changes stay in this preview"))
                .font(.caption).foregroundStyle(Color.tsMutedInk)
                .frame(maxWidth: .infinity).padding(10)
        }
        .background(Color.tsSurface)
    }
}

private struct LabPreviewContents: View {
    let page: LabPreviewPage
    let state: LabPreviewState
    @Environment(\.appLanguage) private var language
    @State private var sessionPosition: UUID?
    @State private var peoplePosition: String?
    @State private var selected: String?
    @State private var retried = false
    @State private var sessions: [AgentSession] = []
    private var snapshot: PursuitWorkspaceSnapshot { LabPreviewFixtures.snapshot(state: state) }
    private var archivePage: RelationshipArchivePage { page == .today ? .today : page == .sessions ? .sessions : .people }
    private var unreadFixture: String? {
#if DEBUG
        guard ProcessInfo.processInfo.environment["TS_IOS_UI_TEST_PREVIEW_WORKSPACE"] == "true" else { return nil }
        let value = ProcessInfo.processInfo.environment["TS_IOS_UI_TEST_TODAY_UNREAD"]
        return ["relationship", "identity-review"].contains(value ?? "") ? value : nil
#else
        return nil
#endif
    }
    var body: some View {
        VStack(spacing: 0) {
            if state == .stale {
                PursuitWorkspaceRefreshNotice(message: language.text("The last read is stale. Refresh before relying on this content.")).padding(.horizontal, 16)
            }
            switch state {
            case .loading: PursuitWorkspaceLoadingView(isSynthetic: true)
            case .failed:
                ScrollView {
                    PursuitWorkspaceFailureView(message: language.text("Synthetic connection failure. Retry changes only this preview."), isRetrying: false, completedReadCount: retried ? 2 : 1, isSynthetic: true) { retried = true }
                }
            case .empty: PursuitWorkspaceEmptyView(selectedPage: archivePage)
            default: pageContent
            }
        }
        .background(Color.tsSurface)
        .modifier(LabLayoutOutline())
        .task {
            if page == .sessions || (page == .today && unreadFixture != nil) {
                sessions = AgentSessionStore.preview(snapshot: snapshot, sessionCount: state == .partial ? 1 : 4).sessions
                if state == .longContent {
                    sessions = sessions.map { value in var result = value; result.title = LabPreviewFixtures.longTitle; return result }
                }
#if DEBUG
                if page == .today, let unreadFixture {
                    sessions = LabPreviewFixtures.unreadSessions(from: sessions, identityReview: unreadFixture == "identity-review")
                }
#endif
            }
        }
        .alert(language.text("Preview interaction"), isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } })) {
            Button(language.text("Done")) { selected = nil }
        } message: { Text(selected ?? "") }
    }
    @ViewBuilder private var pageContent: some View {
        switch page {
        case .people:
            WorkspacePeopleView(snapshot: snapshot, isPreview: true, restorationPosition: nil, scrollPosition: $peoplePosition,
                onSelect: { selected = $0.displayLabel }, onAsk: { selected = $0.displayLabel })
        case .sessions:
#if DEBUG
            if ProcessInfo.processInfo.environment["TS_IOS_UI_TEST_PREVIEW_WORKSPACE"] == "true",
               ProcessInfo.processInfo.environment["TS_IOS_UI_TEST_HEADER_GEOMETRY"] == "true" {
                RelationshipHeaderGeometryFixture()
            } else {
                sessionContents
            }
#else
            sessionContents
#endif
        case .today:
            PursuitTodayView(snapshot: snapshot, isPreview: unreadFixture == nil, calendarActivities: [], unreadSessions: unreadFixture == nil ? [] : sessions, actionRecovery: nil,
                onOpenSession: { selected = unreadFixture == nil ? $0.displayTitle(in: language) : $0.id.uuidString }, onOpenCalendar: { selected = language.text("Calendar") },
                onOpenAttention: { _ in selected = language.text("Preview interaction") }, onOpenPursuit: { selected = $0.title }, onOpenActionRecovery: { selected = $0 })
        case .review, .fullReview, .onboarding:
            StandaloneOnboardingView(arguments: [], labPreview: true, labPreviewStartsInReview: page != .onboarding, labPreviewExpandedEvidence: page == .fullReview)
        }
    }

    private var sessionContents: some View {
            AgentSessionListView(sessions: sessions, people: Dictionary(uniqueKeysWithValues: snapshot.people.map { ($0.id, $0) }), isPreview: true,
                persistenceNotice: nil,
                restorationPosition: nil, scrollPosition: $sessionPosition,
                onOpen: { selected = $0.displayTitle(in: language) },
                onMarkRead: { id in if let index = sessions.firstIndex(where: { $0.id == id }) { sessions[index].isUnread = false } },
                onMarkUnread: { id in if let index = sessions.firstIndex(where: { $0.id == id }) { sessions[index].isUnread = true } },
                onDelete: { id in sessions.removeAll { $0.id == id }; return true })
    }
}

enum LabPreviewFixtures {
    static let longTitle = "Alexandra Chen — international engineering leadership, research collaboration and a long unresolved location question / 跨地区合作与工作地点沟通"
#if DEBUG
    static func unreadSessions(from values: [AgentSession], identityReview: Bool) -> [AgentSession] {
        guard var first = values.first else { return [] }
        first.isUnread = true
        first.title = "Review the synthetic design collaboration / 设计协作"
        if identityReview {
            first.scope = .identityReview(resolutionCaseID: "synthetic-identity-review", personDisplayLabel: "Unconfirmed synthetic identity")
            first.title = "Review synthetic identity"
            first.pendingObjective = "PROTECTED_REVIEW_OBJECTIVE"
            first.composerDraft = "PROTECTED_REVIEW_DRAFT"
        } else if let personID = first.personID, let contextID = first.relationshipContextID {
            first.scope = .relationship(personID: personID, relationshipContextID: contextID,
                personDisplayLabel: "Alexandra Chen / 周琳",
                contextDisplayLabel: "Synthetic design collaboration / 跨地区设计协作")
        }
        // Two distinct Sessions intentionally share one participant/context.
        // Exact activation must follow the Session, not the person's label.
        let sibling = AgentSession(id: UUID(uuidString: "90000000-0000-4000-8000-000000000099")!, scope: first.scope,
            title: "A different synthetic design discussion", turns: [], contactReceipts: [], updatedAt: first.updatedAt, isUnread: true)
        return [first, sibling]
    }
#endif
    static func snapshot(state: LabPreviewState) -> PursuitWorkspaceSnapshot {
        let base = PursuitWorkspaceSnapshot.preview
        let people: [WorkspacePerson]
        switch state {
        case .empty: people = []
        case .longContent:
            people = base.people.enumerated().map { index, person in
                WorkspacePerson(id: person.id, displayLabel: index == 0 ? longTitle : person.displayLabel,
                    contextCount: person.contextCount, captureCount: person.captureCount, confirmedIdentityCount: person.confirmedIdentityCount,
                    lastActivityAt: person.lastActivityAt, profile: person.profile, contexts: person.contexts)
            }
        case .partial:
            people = base.people.map { person in
                WorkspacePerson(id: person.id, displayLabel: person.displayLabel, contextCount: 0, captureCount: 0, confirmedIdentityCount: 0,
                    lastActivityAt: "", profile: nil, avatar: nil, contexts: [])
            }
        default: people = base.people
        }
        return .init(workspaceID: base.workspaceID, currentUserID: base.currentUserID, currentUserName: base.currentUserName,
            pursuits: state == .empty ? [] : base.pursuits, people: people, proposals: state == .empty ? [] : base.proposals,
            loadedAt: state == .stale ? Date(timeIntervalSince1970: 1_700_000_000) : base.loadedAt)
    }
}
