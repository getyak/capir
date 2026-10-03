import Foundation
import SwiftUI
import UIKit

@MainActor
struct RelationshipArchiveView: View {
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
    @StateObject private var captureHandoff = CaptureHandoffStore.shared
    @StateObject private var captureIntentRouter = CaptureIntentRouter.shared
    @StateObject private var askDeepLinkRouter = AgentAskDeepLinkRouter.shared
    @StateObject private var workspaceStore: PursuitWorkspaceStore
    @StateObject private var sessionStore: AgentSessionStore
    @StateObject private var labStore: TalentSignalLabStore
    @State private var selectedPage: RelationshipArchivePage = .today
    // Published changes update only the header, not the workspace.
    // https://developer.apple.com/documentation/swiftui/state#Store-observable-objects
    @State private var pageMotion = RelationshipPageMotion()
    @State private var sessionScrollPosition: UUID?
    @State private var peopleScrollPosition: String?
    @State private var sessionRestorationPosition: UUID?
    @State private var peopleRestorationPosition: String?
    @State private var presentedSheet: RelationshipArchiveSheet?
    @State private var askPresentation: RelationshipAskPresentation?
    /// Shared active-refresh registration for the REAL open Agent Session (or
    /// the directory-level Session list when no conversation is open).
    @State private var activeRefreshRegistration: WorkspaceActiveRefresh.Registration?
    @State private var capturePresentation: RelationshipCapturePresentation?
    @State private var intakePresentation: AgentIntakePresentation?
    @State private var isCaptureInboxPresented = false
    @State private var calendarLaunchRequest: RelationshipCalendarLaunchRequest?
    @State private var relationshipCalendarActivities: [RelationshipCalendarActivity] = []
    @State private var deferredIntakePresentation: AgentIntakePresentation?
    @State private var deferredArchiveSheet: RelationshipArchiveSheet?
    @State private var deferredAskPresentation: RelationshipAskPresentation?
    @State private var deferredCapturePresentation: RelationshipCapturePresentation?
    private let readScopeIsCurrent: () -> Bool
    private let reviewBaseURL: URL?
    private let authenticatedAccessToken: String?
    private let authenticatedUserID: String?
    private let accountEmail: String?
    private let workspaceLabel: String?
    private let onSignOut: (() async -> Bool)?
    private let runtimeScope: String?
    private let legacyAccountID: String?
    private let labExperimentService: (any LabExperimentServing)?

    init(
        session: PursuitWorkspaceSession? = nil,
        service: PursuitWorkspaceServing? = nil,
        labService: TalentSignalLabServing? = nil,
        onSignOut: (() async -> Bool)? = nil,
        currentIdentity: (() -> AccountOperationScope?)? = nil
    ) {
#if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        let previewSnapshot: PursuitWorkspaceSnapshot
        if arguments.contains("--preview-long-people-list") {
            previewSnapshot = .previewLongPeople
        } else if arguments.contains("--preview-multi-context-person") {
            previewSnapshot = .previewMultiContextPerson
        } else {
            previewSnapshot = .preview
        }
        let previewSessionCount = arguments.contains("--preview-long-session-list")
            ? 50
            : 2
#else
        let previewSnapshot: PursuitWorkspaceSnapshot = .preview
        let previewSessionCount = 2
#endif
        let expectedIdentity = session.map {
            AccountOperationScope(baseURL: $0.baseURL, accessToken: $0.accessToken ?? "",
                                  accountID: $0.accountID ?? "", userID: $0.userID ?? "")
        }
        let scopeIsCurrent: () -> Bool = {
            guard let currentIdentity else { return true }
            return currentIdentity() == expectedIdentity
        }
        self.readScopeIsCurrent = scopeIsCurrent
        let resolvedService = service ?? session.map {
            URLPursuitWorkspaceClient(
                baseURL: $0.baseURL,
                accountSlug: $0.accountSlug,
                userEmail: $0.userEmail,
                accessToken: $0.accessToken,
                accountID: $0.accountID,
                userID: $0.userID,
                userDisplayName: $0.userDisplayName
            )
        }
        _workspaceStore = StateObject(
            wrappedValue: PursuitWorkspaceStore(
                service: resolvedService,
                actionCompletions: session.map {
                    FilePursuitActionCompletionStore(accountID: $0.persistenceScope, legacyAccountID: $0.accountID)
                } ?? UserDefaultsPursuitActionCompletionStore(),
                previewSnapshot: previewSnapshot,
                readScopeIsCurrent: scopeIsCurrent
            )
        )
        // Keep loading, migration, and test resets inside StateObject's lazy
        // creation. Rebuilding this View must not instantiate another store.
        _sessionStore = StateObject(wrappedValue: {
            let resolvedSessionStore: AgentSessionStore
#if DEBUG
            let usesPersistentPreview = ProcessInfo.processInfo.arguments.contains(
                "--persist-preview-agent"
            )
            if resolvedService == nil, usesPersistentPreview {
                let previewStore = AgentSessionStore(
                    persistence: FileAgentSessionPersistence(
                        accountID: "ui-test-preview-agent"
                    )
                )
                if ProcessInfo.processInfo.arguments.contains(
                    "--reset-preview-agent"
                ) {
                    _ = previewStore.deleteAll()
                }
                resolvedSessionStore = previewStore
            } else if resolvedService == nil {
                resolvedSessionStore = AgentSessionStore.preview(
                    snapshot: previewSnapshot,
                    sessionCount: previewSessionCount
                )
            } else {
                let canonicalStore = AgentSessionStore(
                    persistence: session.map {
                        FileAgentSessionPersistence(accountID: $0.persistenceScope, legacyAccountID: $0.accountID)
                    }
                )
                if ProcessInfo.processInfo.arguments.contains(
                    "--reset-agent-sessions"
                ) {
                    _ = canonicalStore.deleteAll()
                }
                resolvedSessionStore = canonicalStore
            }
#else
            if resolvedService == nil {
                resolvedSessionStore = AgentSessionStore.preview(
                    snapshot: previewSnapshot,
                    sessionCount: previewSessionCount
                )
            } else {
                resolvedSessionStore = AgentSessionStore(
                    persistence: session.map {
                        FileAgentSessionPersistence(accountID: $0.persistenceScope, legacyAccountID: $0.accountID)
                    }
                )
            }
#endif
            return resolvedSessionStore
        }())
        let resolvedLabService = labService ?? session.map {
            URLTalentSignalLabClient(
                baseURL: $0.baseURL,
                accountSlug: $0.accountSlug,
                userEmail: $0.userEmail,
                accessToken: $0.accessToken
            )
        }
        _labStore = StateObject(
            wrappedValue: TalentSignalLabStore(service: resolvedLabService)
        )
        labExperimentService = resolvedLabService as? any LabExperimentServing
        runtimeScope = session?.persistenceScope
        legacyAccountID = session?.accountID
        authenticatedUserID = session?.userID
        reviewBaseURL = session?.baseURL
        authenticatedAccessToken = session?.accessToken
        accountEmail = session?.userEmail
        workspaceLabel = session?.accountSlug
        self.onSignOut = onSignOut
#if DEBUG
        if arguments.contains("--capture-inbox-open-hub") {
            _intakePresentation = State(
                initialValue: AgentIntakePresentation(initialDestination: .hub)
            )
        }
#endif
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.tsSurface.ignoresSafeArea()
                pageContent
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 0) {
                    RelationshipArchiveHeader(
                        selectedPage: Binding(
                            get: { selectedPage },
                            set: { selectPage($0) }
                        ),
                        motion: pageMotion,
                        onOpenCalendar: openRelationshipCalendar,
                        onOpenAgentStudio: {
                            clearTransientRetrievalIntent()
                            presentedSheet = .agentStudio
                        }
                    )
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                guideRail
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(isPresented: Binding(
                get: { askPresentation != nil },
                set: { if !$0 { askPresentation = nil } }
            )) {
                if let presentation = askPresentation {
                    askDestination(presentation)
                }
            }
        }
        .modifier(activeRefreshModifier)
        .onChange(of: askPresentation?.id) { presentationID in
            if presentationID == nil { completeDeferredTransition() }
        }
        .environment(\.layoutDirection, pageLayoutDirection)
        .overlay(alignment: .top) {
            if let notice = workspaceStore.refreshNotice {
                PursuitWorkspaceRefreshNotice(message: notice)
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
#if DEBUG
        .overlay(alignment: .bottomTrailing) {
            if ProcessInfo.processInfo.arguments.contains(
                "--fixture-record-retrieval-anchor"
            ) {
                Text(sessionScrollPosition?.uuidString.lowercased() ?? "none")
                    .font(.system(size: 1))
                    .foregroundStyle(Color.clear)
                    .frame(width: 1, height: 1)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(appLanguage.text("Session scroll anchor"))
                    .accessibilityValue(
                        sessionScrollPosition?.uuidString.lowercased() ?? "none"
                    )
                    .accessibilityIdentifier("session-scroll-anchor-probe")
                Text(peopleScrollPosition ?? "none")
                    .font(.system(size: 1))
                    .foregroundStyle(Color.clear)
                    .frame(width: 1, height: 1)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(appLanguage.text("People scroll anchor"))
                    .accessibilityValue(peopleScrollPosition ?? "none")
                    .accessibilityIdentifier("people-scroll-anchor-probe")
            }
        }
#endif
        .sheet(item: $presentedSheet, onDismiss: reloadCanonicalWorkspace) { destination in
            switch destination {
            case let .review(person):
                RelationshipChangeReviewView(person: person)
            case let .resume(person):
                RelationshipResumeView(person: person)
            case let .detail(person):
                RelationshipDetailView(person: person)
            case let .pursuit(pursuit):
                PursuitDetailView(
                    pursuit: pursuit,
                    snapshot: workspaceStore.snapshot,
                    currentUserID: workspaceStore.snapshot?.currentUserID,
                    workspaceStore: workspaceStore,
                    onOpenProposal: { proposal in
                        presentedSheet = nil
                        Task { @MainActor in
                            await Task.yield()
                            presentedSheet = .proposal(proposal)
                        }
                    }
                )
            case let .workspacePerson(person, roles):
                WorkspacePersonDetailView(person: person, roles: roles, workspaceStore: workspaceStore)
            case let .proposal(proposal):
                RelationshipChangeReviewView(
                    person: previewPerson(for: proposal),
                    reviewSession: reviewBaseURL.map {
                        PursuitProposalReviewSession(
                            baseURL: $0,
                            proposalID: proposal.id,
                            accessToken: authenticatedAccessToken
                        )
                    },
                    actorDisplayName: workspaceStore.snapshot?.currentUserName
                        ?? "Current user"
                )
            case .agentStudio:
                RelationshipAgentStudioView(
                    workspaceStore: workspaceStore,
                    sessionStore: sessionStore,
                    isCanonical: workspaceStore.isCanonical,
                    workspaceID: workspaceStore.snapshot?.workspaceID,
                    runtimeScope: runtimeScope,
                    workspaceLabel: workspaceLabel,
                    accountName: workspaceStore.snapshot?.currentUserName,
                    accountEmail: accountEmail,
                    proposals: workspaceStore.snapshot?.openProposals ?? [],
                    signOutNotice: sessionStore.persistenceNotice,
                    onOpenProposal: { proposal in
                        Task { @MainActor in
                            await Task.yield()
                            presentedSheet = .proposal(proposal)
                        }
                    },
                    internalTestingStatus: internalTestingStatus,
                    onOpenInternalTesting: internalTestingAction,
                    // Protected drafts and operation IDs remain owned by this
                    // account. Closing a session is not a request to delete them.
                    onSignOut: onSignOut
                )
            case .menu:
                RelationshipMenuView(
                    isCanonical: workspaceStore.isCanonical,
                    workspaceID: workspaceStore.snapshot?.workspaceID,
                    workspaceLabel: workspaceLabel,
                    accountName: workspaceStore.snapshot?.currentUserName,
                    accountEmail: accountEmail,
                    proposals: workspaceStore.snapshot?.openProposals ?? [],
                    signOutNotice: sessionStore.persistenceNotice,
                    onOpenProposal: { proposal in
                        Task { @MainActor in
                            await Task.yield()
                            presentedSheet = .proposal(proposal)
                        }
                    },
                    internalTestingStatus: internalTestingStatus,
                    onOpenInternalTesting: internalTestingAction,
                    // Protected drafts and operation IDs remain owned by this
                    // account. Closing a session is not a request to delete them.
                    onSignOut: onSignOut
                )
            case .internalTesting:
                ProductLabView(
                    deterministic: labStore,
                    service: labExperimentService,
                    baseURL: reviewBaseURL,
                    workspace: workspaceLabel,
                    userScope: accountEmail,
                    runtimeScope: runtimeScope,
                    onSignOut: onSignOut,
                    refreshWorkspace: workspaceStore.isCanonical
                        ? { await workspaceStore.refreshForLab() }
                        : nil
                )
            }
        }
        .onChange(of: workspaceStore.snapshot?.workspaceID) { workspaceID in
            if let workspaceID, let runtimeScope, let legacyAccountID,
               RuntimeLegacyBindings.authorizes(accountID: legacyAccountID, scope: runtimeScope) {
                RuntimeLegacyBindings.bindAlias(workspaceID, scope: runtimeScope)
            }
        }
        .task(id: workspaceStore.snapshot?.workspaceID) {
            if let workspaceID = workspaceStore.snapshot?.workspaceID, let runtimeScope, let legacyAccountID,
               RuntimeLegacyBindings.authorizes(accountID: legacyAccountID, scope: runtimeScope) {
                RuntimeLegacyBindings.bindAlias(workspaceID, scope: runtimeScope)
            }
        }
        .fullScreenCover(
            item: $capturePresentation,
            onDismiss: completeDeferredTransition
        ) { presentation in
            switch presentation {
            case .screenshot:
                CandidateSignalView(
                    backendURL: reviewBaseURL,
                    accessToken: authenticatedAccessToken,
                    workspaceID: workspaceStore.snapshot?.workspaceID,
                    runtimeScope: runtimeScope,
                    entryMode: .conversationImage,
                    onClose: { capturePresentation = nil },
                    onContinueInAgent: continueCaptureInAgent
                )
            }
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else {
                clearTransientRetrievalIntent()
                return
            }
            Task {
                sessionStore.pruneExpired()
                reloadRelationshipCalendarActivities()
                await revalidateSessionEvidence()
                await labStore.load(force: true)
                await captureHandoff.processPendingCaptures(
                    sessionStore: sessionStore,
                    service: captureProcessingService
                )
            }
        }
        .onChange(of: captureHandoff.inboxItems) { items in
            guard items.contains(where: {
                $0.processingState == .queued || $0.processingState == .processing
            }) else { return }
            Task {
                await captureHandoff.processPendingCaptures(
                    sessionStore: sessionStore,
                    service: captureProcessingService
                )
            }
        }
        .sheet(
            item: $intakePresentation,
            onDismiss: completeDeferredTransition
        ) { presentation in
            SignalCaptureHubView(
                backendURL: reviewBaseURL,
                accessToken: authenticatedAccessToken,
                workspaceID: workspaceStore.snapshot?.workspaceID,
                    runtimeScope: runtimeScope,
                initialDestination: presentation.initialDestination,
                onDismiss: { intakePresentation = nil },
                onContinueInAgent: continueCaptureInAgent
            )
        }
        .sheet(
            isPresented: $isCaptureInboxPresented,
            onDismiss: completeDeferredTransition
        ) {
            CaptureInboxView(
                backendURL: reviewBaseURL,
                accessToken: authenticatedAccessToken,
                workspaceID: workspaceStore.snapshot?.workspaceID,
                runtimeScope: runtimeScope,
                onDismiss: { isCaptureInboxPresented = false },
                onContinueInAgent: continueCaptureInAgent
            )
        }
        .onReceive(captureHandoff.$pendingSeed) { seed in
            guard let seed else { return }
            guard !isCaptureInboxPresented else { return }
            if intakePresentation != nil {
                if seed.origin == .appShortcut {
                    deferredCapturePresentation = .screenshot
                    intakePresentation = nil
                }
                return
            }
            guard capturePresentation == nil else { return }
            capturePresentation = .screenshot
        }
        .onReceive(captureIntentRouter.$request) { request in
            guard let request else { return }
            switch request.destination {
            case .hub, .foregroundAudio:
                intakePresentation = .init(initialDestination: request.destination)
            case .latestProposal:
                if let proposal = workspaceStore.snapshot?.openProposals.first {
                    presentedSheet = .proposal(proposal)
                }
            case let .pursuit(id):
                if let pursuit = workspaceStore.snapshot?.pursuits.first(where: { $0.id == id }) {
                    presentedSheet = .pursuit(pursuit)
                }
            }
            captureIntentRouter.consume(request.id)
        }
        .onReceive(askDeepLinkRouter.$link) { link in
            guard let link,
                  link.identity.workspaceID == workspaceStore.snapshot?.workspaceID,
                  let sessionID = UUID(uuidString: link.identity.sessionID) else { return }
            clearTransientRetrievalIntent()
            selectedPage = .sessions
            askPresentation = .init(
                sessionID: sessionID,
                seed: nil,
                preferredPersonID: nil,
                preferredPersonLabel: nil,
                entryMode: .text
            )
            askDeepLinkRouter.consume(link.identity)
            Task {
                await AgentAskActivityController.shared.endActivities(
                    sessionID: link.identity.sessionID
                )
            }
        }
        .onOpenURL { url in
            guard url.scheme == "talent-signal-capture" else { return }
            switch url.host {
            case "audio":
                intakePresentation = .init(initialDestination: .foregroundAudio)
            default:
                intakePresentation = .init(initialDestination: nil)
            }
        }
        .task {
            await workspaceStore.load()
            reloadRelationshipCalendarActivities()
            await revalidateSessionEvidence()
            await captureHandoff.processPendingCaptures(
                sessionStore: sessionStore,
                service: captureProcessingService
            )
        }
        .task {
            await labStore.load()
        }
        .tint(.tsVermilion)
    }

    private var composerVoiceTranscriber: (any VoiceTranscriptionServing)? {
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--deterministic-voice-input") {
            return DeterministicVoiceTranscriber()
        }
        if let baseURL = reviewBaseURL,
           URLFixtureLoader.isLoopback(baseURL),
           authenticatedAccessToken == nil {
            return URLSimulatedVoiceTranscriptionClient(
                baseURL: baseURL,
                accountSlug: workspaceLabel ?? "fixture-alpha",
                userEmail: accountEmail ?? "recruiter@alpha.local"
            )
        }
#endif
        return reviewBaseURL.flatMap { baseURL in
            authenticatedAccessToken.map { accessToken in
                URLVoiceTranscriptionClient(
                    baseURL: baseURL,
                    accessToken: accessToken
                )
            }
        }
    }

    private var internalTestingAvailable: Bool {
        labStore.isEnabled || DeviceLabAvailability.enabled
    }

    private var internalTestingStatus: String? {
        if labStore.session != nil {
            return appLanguage.text("Active", zhHans: "进行中")
        }
        return appLanguage.text("Internal", zhHans: "内部")
    }

    private var internalTestingAction: (() -> Void)? {
        guard internalTestingAvailable else { return nil }
        return { openInternalTesting() }
    }

    private func openInternalTesting() {
        clearTransientRetrievalIntent()
        presentedSheet = .internalTesting
    }

    private var captureProcessingService: (any RelationshipCaptureServing)? {
        reviewBaseURL.map {
            URLRelationshipCaptureClient(
                baseURL: $0,
                accessToken: authenticatedAccessToken,
                runtimeScope: runtimeScope
            )
        }
    }

    private var guideRail: some View {
        RelationshipGuideRail(
            onGuide: {
                clearTransientRetrievalIntent()
                askPresentation = .init(
                    sessionID: nil,
                    seed: nil,
                    preferredPersonID: nil,
                    preferredPersonLabel: nil,
                    entryMode: .text
                )
            },
            onAttach: {
                clearTransientRetrievalIntent()
                askPresentation = .init(
                    sessionID: nil,
                    seed: nil,
                    preferredPersonID: nil,
                    preferredPersonLabel: nil,
                    entryMode: .attachment
                )
            },
            onVoice: {
                clearTransientRetrievalIntent()
                askPresentation = .init(
                    sessionID: nil,
                    seed: nil,
                    preferredPersonID: nil,
                    preferredPersonLabel: nil,
                    entryMode: .voice
                )
            }
        )
    }

    @ViewBuilder
    private var pageContent: some View {
        TabView(
            selection: Binding(
                get: { selectedPage },
                set: { selectPage($0) }
            )
        ) {
            ForEach(RelationshipArchivePage.allCases) { page in
                archivePage(page) {
                    pageContent(for: page)
                }
                .tag(page)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .indexViewStyle(.page(backgroundDisplayMode: .never))
        .coordinateSpace(name: Self.pageCoordinateSpace)
        .onPreferenceChange(RelationshipPageMeasurementKey.self) { measurements in
            updatePageProgress(from: measurements)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func pageContent(for page: RelationshipArchivePage) -> some View {
        switch workspaceStore.phase {
        case .loading:
            PursuitWorkspaceLoadingView()
        case let .failed(message):
            PursuitWorkspaceFailureView(
                message: message,
                isRetrying: workspaceStore.isReadInFlight,
                completedReadCount: workspaceStore.completedReadCount
            ) {
                Task { await workspaceStore.load() }
            }
        case .empty:
            PursuitWorkspaceEmptyView(
                selectedPage: page,
                pendingCaptureCount: captureHandoff.attentionCount,
                onOpenCaptureInbox: {
                    clearTransientRetrievalIntent()
                    isCaptureInboxPresented = true
                }
            )
        case let .preview(snapshot), let .loaded(snapshot):
            loadedPage(page, snapshot: snapshot)
        }
    }

    @ViewBuilder
    private func loadedPage(
        _ page: RelationshipArchivePage,
        snapshot: PursuitWorkspaceSnapshot
    ) -> some View {
        switch page {
        case .today:
            PursuitTodayView(
                snapshot: snapshot,
                isPreview: !workspaceStore.isCanonical,
                calendarActivities: relationshipCalendarActivities,
                unreadSessions: sessionStore.unreadSessions,
                actionRecovery: workspaceStore.latestActionRecovery(in: snapshot),
                onOpenSession: openSession,
                onOpenCalendar: {
                    openRelationshipCalendar(.overview)
                },
                onOpenAttention: openAttention,
                onOpenPursuit: { presentedSheet = .pursuit($0) },
                onOpenActionRecovery: { pursuitID in
                    guard let pursuit = snapshot.pursuit(id: pursuitID) else {
                        return
                    }
                    presentedSheet = .pursuit(pursuit)
                },
                pendingCaptureCount: captureHandoff.attentionCount,
                onOpenCaptureInbox: {
                    clearTransientRetrievalIntent()
                    isCaptureInboxPresented = true
                }
            )
        case .sessions:
            AgentSessionListView(
                sessions: sessionStore.sessions,
                people: Dictionary(
                    uniqueKeysWithValues: snapshot.people.map { ($0.id, $0) }
                ),
                isPreview: !workspaceStore.isCanonical,
                persistenceNotice: sessionStore.persistenceNotice ?? sessionStore.syncNotice,
                restorationPosition: sessionRestorationPosition,
                scrollPosition: Binding(
                    get: { sessionScrollPosition },
                    set: { newPosition in
                        if let newPosition {
                            sessionScrollPosition = newPosition
                        }
                    }
                ),
                onOpen: openSession,
                onMarkRead: { id in
                    sessionStore.markRead(id)
                    Task { _ = await synchronizeAgentSessions() }
                },
                onMarkUnread: { id in
                    sessionStore.markUnread(id)
                    Task { _ = await synchronizeAgentSessions() }
                },
                onDelete: { id in
                    let deleted = sessionStore.delete(id)
                    if deleted { Task { _ = await synchronizeAgentSessions() } }
                    return deleted
                }
            )
        case .people:
            WorkspacePeopleView(
                snapshot: snapshot,
                isPreview: !workspaceStore.isCanonical,
                restorationPosition: peopleRestorationPosition,
                scrollPosition: Binding(
                    get: { peopleScrollPosition },
                    set: { newPosition in
                        if let newPosition {
                            peopleScrollPosition = newPosition
                        }
                    }
                ),
                onSelect: { person in
                    presentedSheet = .workspacePerson(
                        person,
                        roles(for: person.id, in: snapshot)
                    )
                },
                onAsk: askAboutPerson
            )
        case .meetings:
            RelationshipCalendarView(
                snapshot: snapshot,
                isPreview: !workspaceStore.isCanonical,
                initialActivities: relationshipCalendarActivities,
                isEmbedded: true,
                isActive: selectedPage == .meetings,
                launchRequest: calendarLaunchRequest,
                onActivitiesChange: { activities in
                    if relationshipCalendarActivities != activities {
                        relationshipCalendarActivities = activities
                    }
                },
                personDetail: { personID in
                    guard let current = workspaceStore.snapshot,
                          let person = current.person(id: personID) else { return nil }
                    return AnyView(WorkspacePersonDetailView(
                        person: person, roles: roles(for: person.id, in: current),
                        workspaceStore: workspaceStore
                    ))
                },
                onRecordNotes: { stageCalendarSession($0, intent: .notes) },
                onPrepare: { stageCalendarSession($0, intent: .preparation) }
            )
        }
    }

    @ViewBuilder
    private func archivePage<Content: View>(
        _ page: RelationshipArchivePage,
        @ViewBuilder content: () -> Content
    ) -> some View {
        content()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background {
                GeometryReader { geometry in
                    Color.clear.preference(
                        key: RelationshipPageMeasurementKey.self,
                        value: [
                            page.id: RelationshipPageMeasurement(
                                minX: geometry.frame(
                                    in: .named(Self.pageCoordinateSpace)
                                ).minX,
                                width: geometry.size.width
                            ),
                        ]
                    )
                }
            }
    }

    private func openSession(_ session: AgentSession) {
        clearTransientRetrievalIntent()
        sessionStore.markRead(session.id)
        askPresentation = .init(
            sessionID: session.id,
            seed: nil,
            preferredPersonID: nil,
            preferredPersonLabel: nil,
            entryMode: .text
        )
    }

    private func askAboutPerson(_ person: WorkspacePerson) {
        clearTransientRetrievalIntent()
        askPresentation = .init(
            sessionID: nil,
            seed: nil,
            preferredPersonID: person.id,
            preferredPersonLabel: person.displayLabel,
            entryMode: .text
        )
    }

    private func selectPage(_ page: RelationshipArchivePage) {
        guard page != selectedPage else {
            clearTransientRetrievalIntent()
            return
        }
        captureRetrievalPositions()
        selectedPage = page
    }

    private func updatePageProgress(
        from measurements: [String: RelationshipPageMeasurement]
    ) {
        pageMotion.update(from: measurements, layoutDirection: pageLayoutDirection)
    }

    private func clearTransientRetrievalIntent() {
        captureRetrievalPositions()
    }

    private func captureRetrievalPositions() {
        sessionRestorationPosition = sessionScrollPosition
        peopleRestorationPosition = peopleScrollPosition
    }

    private func stageCalendarSession(
        _ activity: RelationshipCalendarActivity,
        intent: RelationshipMeetingIntent
    ) {
        // Calendar labels alone never authorize a different Person or context.
        guard let snapshot = workspaceStore.snapshot,
              let person = snapshot.person(id: activity.personID),
              person.contexts.contains(where: { $0.id == activity.relationshipContextID }) else { return }
        let objective = intent.draft(for: activity, language: appLanguage)
        let matchingSession = sessionStore.sessions.first {
            $0.personID == activity.personID
                && $0.relationshipContextID == activity.relationshipContextID
        }
        if let matchingSession {
            let existingDraft = sessionStore.draft(sessionID: matchingSession.id)
            if existingDraft.isEmpty, matchingSession.pendingObjective == nil {
                guard sessionStore.saveDraft(objective, sessionID: matchingSession.id) else {
                    return
                }
            }
            askPresentation = .init(
                sessionID: matchingSession.id,
                seed: nil,
                preferredPersonID: nil,
                preferredPersonLabel: nil,
                entryMode: .text
            )
        } else {
            askPresentation = .init(
                sessionID: nil,
                seed: .meetingPreparation(
                    personID: activity.personID,
                    relationshipContextID: activity.relationshipContextID,
                    suggestedObjective: objective
                ),
                preferredPersonID: nil,
                preferredPersonLabel: nil,
                entryMode: .text
            )
        }
    }

    private func reloadRelationshipCalendarActivities() {
        guard let snapshot = workspaceStore.snapshot else {
            relationshipCalendarActivities = []
            return
        }
        let projected = RelationshipCalendarProjection.activities(
            snapshot: snapshot,
            isPreview: !workspaceStore.isCanonical
        )
        let stored: [RelationshipCalendarActivity]
        if workspaceStore.isCanonical {
            stored = (try? FileRelationshipCalendarActivityStore(
                accountID: snapshot.workspaceID
            ).activities(in: snapshot)) ?? []
        } else {
            stored = []
        }
        var merged = projected
        for activity in stored where !merged.contains(where: { $0.id == activity.id }) {
            merged.append(activity)
        }
        relationshipCalendarActivities = merged.sorted { $0.startDate < $1.startDate }
    }

    @ViewBuilder
    private func askDestination(_ presentation: RelationshipAskPresentation) -> some View {
        if let snapshot = workspaceStore.snapshot {
            RelationshipAskView(
                snapshot: snapshot,
                isCanonical: workspaceStore.isCanonical,
                workspaceStore: workspaceStore,
                sessionStore: sessionStore,
                sessionID: presentation.sessionID,
                initialSeed: presentation.seed,
                preferredPersonID: presentation.preferredPersonID,
                preferredPersonLabel: presentation.preferredPersonLabel,
                initialEntryMode: presentation.entryMode,
                ask: { objective, personID, contextID, idempotencyKey, mediaIDs, sessionID, messageID in
                    try await workspaceStore.ask(
                        objective: objective,
                        personID: personID,
                        relationshipContextID: contextID,
                        idempotencyKey: idempotencyKey,
                        mediaIDs: mediaIDs,
                        sessionID: sessionID,
                        messageID: messageID
                    )
                },
                saveContact: {
                    draft,
                    target,
                    confirmIdentityClue,
                    capturedAt,
                    idempotencyKey in
                    try await workspaceStore.saveContactDraft(
                        draft,
                        target: target,
                        confirmIdentityClue: confirmIdentityClue,
                        capturedAt: capturedAt,
                        idempotencyKey: idempotencyKey
                    )
                },
                reviewEvidence: {
                    fragmentID,
                    expectedReviewStatus,
                    expectedLastReviewID,
                    decision,
                    reason,
                    idempotencyKey in
                    return try await workspaceStore.reviewEvidence(
                        fragmentID: fragmentID,
                        expectedReviewStatus: expectedReviewStatus,
                        expectedLastReviewID: expectedLastReviewID,
                        decision: decision,
                        reason: reason,
                        idempotencyKey: idempotencyKey
                    )
                },
                revalidateSessions: {
                    await revalidateSessionEvidence()
                },
                synchronizeSessions: synchronizeAgentSessions,
                answerFeedbackClient: workspaceStore.isCanonical ? reviewBaseURL.flatMap { url in
                    authenticatedAccessToken.map { AnswerFeedbackClient(baseURL: url, bearerToken: $0) }
                } : nil,
                onOpenProposal: { proposal in
                    deferredArchiveSheet = .proposal(proposal)
                    askPresentation = nil
                },
                onCapture: { destination in
                    switch destination {
                    case .screenshotReview:
                        deferredCapturePresentation = .screenshot
                    case .foregroundAudio:
                        deferredIntakePresentation = .init(
                            initialDestination: .foregroundAudio
                        )
                    }
                    askPresentation = nil
                },
                onOpenPerson: { personID in
                    guard let currentSnapshot = workspaceStore.snapshot,
                          let person = currentSnapshot.people.first(where: {
                            $0.id == personID
                          }) else { return }
                    deferredArchiveSheet = .workspacePerson(
                        person,
                        roles(for: person.id, in: currentSnapshot)
                    )
                    askPresentation = nil
                },
                voiceTranscriber: composerVoiceTranscriber
            )
#if DEBUG
            .dynamicTypeSize(ProcessInfo.processInfo.arguments.contains("--fixture-get-5-accessibility5") ? .accessibility5 : dynamicTypeSize)
            .environment(\.labReduceMotion,
                         ProcessInfo.processInfo.arguments.contains("--fixture-get-5-reduced-motion") || accessibilityReduceMotion)
#endif
        } else {
            PursuitWorkspaceLoadingView()
        }
    }

    /// The real open-Session refresh work: the same authenticated synchronize
    /// path the UI uses, fenced by the coordinator generation and coalesced
    /// inside AgentSessionStore.
    private var activeRefreshModifier: AgentSessionActiveRefreshModifier {
        // The lease binds the ACTUAL endpoint/token/account/user identity of
        // this scope; the consumer owns request authority until release.
        let lease = AgentSessionActiveRefreshConsumer.lease(
            endpoint: reviewBaseURL,
            accessToken: authenticatedAccessToken ?? "",
            accountID: legacyAccountID ?? "",
            userID: authenticatedUserID ?? "",
            openSessionID: askPresentation?.sessionID
        )
        let workspace = workspaceStore
        let sessions = sessionStore
        return AgentSessionActiveRefreshModifier(
            lease: lease,
            sessions: sessions,
            people: workspace,
            syncService: { workspace.sessionSyncService },
            isCanonical: { workspace.isCanonical },
            isScopeCurrent: readScopeIsCurrent
        )
    }

    private func synchronizeAgentSessions(_ requiredSessionID: UUID? = nil) async -> Bool {
        guard readScopeIsCurrent() else { return false }
        guard workspaceStore.isCanonical else { return true }
        // Use the same authenticated client as chat, including loopback fixtures
        // whose login is established after the workspace view is initialized.
        guard let client = workspaceStore.sessionSyncService else { return false }
        while sessionStore.isSynchronizing {
            do { try await Task.sleep(for: .milliseconds(50)) } catch { return false }
        }
        guard !Task.isCancelled else { return false }
        return await sessionStore.synchronize(using: client, requiredSessionID: requiredSessionID)
    }

    private func revalidateSessionEvidence() async {
        guard workspaceStore.isCanonical else { return }
        _ = await synchronizeAgentSessions()
        for target in sessionStore.validationTargets() {
            do {
                try await workspaceStore.revalidateAsk(
                    response: target.response,
                    personID: target.personID,
                    relationshipContextID: target.relationshipContextID
                )
            } catch {
                sessionStore.markTaskStale(target.taskID)
            }
        }
    }

    private func completeDeferredTransition() {
        if let deferredAskPresentation {
            askPresentation = deferredAskPresentation
            self.deferredAskPresentation = nil
        }
        if let deferredCapturePresentation {
            capturePresentation = deferredCapturePresentation
            self.deferredCapturePresentation = nil
        }
        if let deferredArchiveSheet {
            presentedSheet = deferredArchiveSheet
            self.deferredArchiveSheet = nil
        }
        if let deferredIntakePresentation {
            intakePresentation = deferredIntakePresentation
            self.deferredIntakePresentation = nil
        }
    }

    private func continueCaptureInAgent(
        _ completion: RelationshipCaptureCompletion
    ) {
        guard let personID = completion.personID,
              let relationshipContextID = completion.relationshipContextID else {
            return
        }
        let seed = AgentSessionSeed.reviewedCapture(
            personID: personID,
            relationshipContextID: relationshipContextID
        )
        Task {
            await workspaceStore.load()
            deferredAskPresentation = .init(
                sessionID: nil,
                seed: seed,
                preferredPersonID: nil,
                preferredPersonLabel: nil,
                entryMode: .text
            )
            capturePresentation = nil
            intakePresentation = nil
            isCaptureInboxPresented = false
        }
    }

    private func openAttention(_ item: PursuitAttentionItem) {
        guard let snapshot = workspaceStore.snapshot else { return }
        if let proposalID = item.proposalID,
           let proposal = snapshot.proposals.first(where: { $0.id == proposalID }) {
            presentedSheet = .proposal(proposal)
        } else if let pursuit = snapshot.pursuit(id: item.pursuitID) {
            presentedSheet = .pursuit(pursuit)
        }
    }

    private func roles(
        for personID: String,
        in snapshot: PursuitWorkspaceSnapshot
    ) -> [WorkspacePersonRole] {
        snapshot.pursuits.flatMap { pursuit in
            pursuit.personRoles
                .filter { $0.subjectRef.id == personID }
                .map {
                    WorkspacePersonRole(
                        pursuitID: pursuit.id,
                        pursuitTitle: pursuit.title,
                        roleID: $0.id,
                        roleType: $0.roleType,
                        status: $0.status,
                        confidence: $0.confidence,
                        evidenceCount: $0.evidenceRefs.count,
                        evidenceState: $0.evidenceState
                    )
                }
        }
    }

    private func previewPerson(for proposal: WorkspaceProposal) -> RelationshipArchivePerson {
        RelationshipArchivePerson(
            id: proposal.reviewContext.subject.displayLabel,
            name: proposal.subjectDisplayLabel,
            initials: String(proposal.subjectDisplayLabel.prefix(2)).uppercased(),
            role: "Pursuit participant",
            company: "Canonical workspace",
            relationship: workspaceStore.snapshot?.pursuit(id: proposal.pursuitID)?.title
                ?? "Pursuit review",
            dependency: proposal.summary,
            recency: "Now",
            state: .needsReview,
            evidence: "Load the canonical Proposal to review its exact evidence.",
            provenance: "Canonical Proposal · revision \(proposal.baseRevision)",
            previousState: "Canonical value",
            proposedState: "Pending item review",
            nextStep: "Review each item before any Pursuit change."
        )
    }

    private func reloadCanonicalWorkspace() {
        guard workspaceStore.isCanonical else { return }
        Task { await workspaceStore.load() }
    }

    private func openRelationshipCalendar(
        _ intent: RelationshipCalendarLaunchIntent
    ) {
        clearTransientRetrievalIntent()
        calendarLaunchRequest = .init(intent: intent)
        if accessibilityReduceMotion {
            selectPage(.meetings)
        } else {
            withAnimation(.easeInOut(duration: 0.28)) { selectPage(.meetings) }
        }
    }

    private var pageLayoutDirection: LayoutDirection {
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains(
            "--force-right-to-left-layout"
        ) {
            return .rightToLeft
        }
#endif
        return layoutDirection
    }

    private static let pageCoordinateSpace = "relationship-page-space"
}

struct RelationshipPageMeasurement: Equatable {
    let minX: CGFloat
    let width: CGFloat
}

private struct RelationshipPageMeasurementKey: PreferenceKey {
    static let defaultValue: [String: RelationshipPageMeasurement] = [:]

    static func reduce(
        value: inout [String: RelationshipPageMeasurement],
        nextValue: () -> [String: RelationshipPageMeasurement]
    ) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

private struct RelationshipAskPresentation: Identifiable {
    let id = UUID()
    let sessionID: UUID?
    let seed: AgentSessionSeed?
    let preferredPersonID: String?
    let preferredPersonLabel: String?
    let entryMode: RelationshipAskEntryMode
}

private enum RelationshipCapturePresentation: Identifiable {
    case screenshot

    var id: String {
        switch self {
        case .screenshot:
            return "screenshot"
        }
    }
}

private struct AgentIntakePresentation: Identifiable {
    let id = UUID()
    let initialDestination: CaptureIntentDestination?
}

struct PursuitWorkspaceRefreshNotice: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsVermilion)
                .accessibilityHidden(true)
            Text(message)
                .font(.caption)
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.tsSurface)
                .shadow(color: Color.black.opacity(0.08), radius: 16, y: 6)
        )
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("workspace-refresh-notice")
    }
}

/// Only the navigation observes continuous progress. Relationship content does not.
@MainActor
final class RelationshipPageMotion: ObservableObject {
    @Published private(set) var progress: CGFloat = 0

    func update(
        from measurements: [String: RelationshipPageMeasurement],
        layoutDirection: LayoutDirection
    ) {
        guard let nearest = measurements.filter({
            $0.value.width > 0 && $0.value.width.isFinite && $0.value.minX.isFinite
                && RelationshipArchivePage(rawValue: $0.key) != nil
        }).min(by: { abs($0.value.minX) < abs($1.value.minX) }),
              let page = RelationshipArchivePage(rawValue: nearest.key) else { return }
        let direction: CGFloat = layoutDirection == .rightToLeft ? -1 : 1
        let raw = CGFloat(page.pageIndex) - direction * nearest.value.minX / nearest.value.width
        let resolved = min(max(raw, 0), CGFloat(RelationshipArchivePage.allCases.count - 1))
        if abs(resolved - progress) > 0.001 { progress = resolved }
    }

    static func emphasis(for page: RelationshipArchivePage, progress: CGFloat) -> CGFloat {
        max(0, 1 - abs(CGFloat(page.pageIndex) - progress))
    }
}

private struct RelationshipArchiveHeader: View {
    @Binding var selectedPage: RelationshipArchivePage
    @ObservedObject var motion: RelationshipPageMotion
    let onOpenCalendar: (RelationshipCalendarLaunchIntent) -> Void
    let onOpenAgentStudio: () -> Void
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.talentSignalReduceMotion) private var reduceMotion

    private var selectionAnimation: Animation {
        .interactiveSpring(
            response: 0.22,
            dampingFraction: 0.82,
            blendDuration: 0.08
        )
    }

    var body: some View {
        GeometryReader { headerGeometry in
            let compact = headerGeometry.size.width < 360
            HStack(spacing: compact ? 8 : 16) {
                Button(action: onOpenAgentStudio) {
                    RelationshipSignalOrb()
                        .frame(width: 22, height: 22)
                        .opacity(0.8)
                        .frame(width: 44, height: 48)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(appLanguage.text("Open Agent Studio"))
                .accessibilityIdentifier("relationship-agent-studio")

                GeometryReader { geometry in
                    let progress = reduceMotion ? CGFloat(selectedPage.pageIndex) : motion.progress
                    let slotWidth = geometry.size.width
                        / CGFloat(RelationshipArchivePage.allCases.count)
                    // The four destinations begin as equal units. Selection
                    // borrows space from one adjacent unit, so the pair keeps
                    // its total width and distant destinations stay still.
                    let activeWidth = min(
                        compact ? 96 : 104,
                        slotWidth * 2 - 44
                    )
                    let compressedWidth = slotWidth * 2 - activeWidth
                    let donorPage = adjacentDonor(for: selectedPage)
                    let itemWidths = RelationshipArchivePage.allCases.map { page in
                        if page == selectedPage { return activeWidth }
                        if page == donorPage { return compressedWidth }
                        return slotWidth
                    }
                    HStack(spacing: 0) {
                        ForEach(RelationshipArchivePage.allCases) { page in
                            let emphasis = RelationshipPageMotion.emphasis(
                                for: page,
                                progress: progress
                            )
                            let isSelected = selectedPage == page
                            let itemWidth = itemWidths[page.pageIndex]
                            if page == .meetings {
                                pageButton(
                                    page,
                                    emphasis: emphasis,
                                    isSelected: isSelected,
                                    activeVisualWidth: activeWidth - 4,
                                    itemWidth: itemWidth
                                )
                                    .zIndex(isSelected ? 1 : 0)
                                    .contextMenu { calendarShortcuts }
                                    .accessibilityAction(named: Text(appLanguage.text("This week"))) {
                                        onOpenCalendar(.thisWeek)
                                    }
                                    .accessibilityAction(named: Text(appLanguage.text("Add activity"))) {
                                        onOpenCalendar(.addActivity)
                                    }
                            } else {
                                pageButton(
                                    page,
                                    emphasis: emphasis,
                                    isSelected: isSelected,
                                    activeVisualWidth: activeWidth - 4,
                                    itemWidth: itemWidth
                                )
                                    .zIndex(isSelected ? 1 : 0)
                            }
                        }
                    }
                    .animation(
                        reduceMotion ? nil : selectionAnimation,
                        value: selectedPage
                    )
                }
                .frame(height: 48)
                .accessibilityElement(children: .contain)
            }
            .padding(.horizontal, compact ? 16 : 24)
            .frame(height: 52)
        }
        .frame(height: 52)
        .background(Color.tsSurface)
    }

    private var calendarShortcuts: some View {
        Group {
            Button { onOpenCalendar(.overview) } label: {
                Label(appLanguage.text("Open calendar"), systemImage: "calendar")
            }.accessibilityIdentifier("calendar-shortcut-open")
            Button { onOpenCalendar(.today) } label: {
                Label(appLanguage.text("Today"), systemImage: "calendar.badge.clock")
            }.accessibilityIdentifier("calendar-shortcut-today")
            Button { onOpenCalendar(.thisWeek) } label: {
                Label(appLanguage.text("This week"), systemImage: "calendar")
            }.accessibilityIdentifier("calendar-shortcut-this-week")
            Button { onOpenCalendar(.addActivity) } label: {
                Label(appLanguage.text("Add activity"), systemImage: "plus")
            }.accessibilityIdentifier("calendar-shortcut-add-activity")
        }
    }

    private func pageButton(
        _ page: RelationshipArchivePage,
        emphasis: CGFloat,
        isSelected: Bool,
        activeVisualWidth: CGFloat,
        itemWidth: CGFloat
    ) -> some View {
        let inactiveVisualWidth = min(42, itemWidth - 2)
        let capsuleWidth = isSelected ? activeVisualWidth : inactiveVisualWidth

        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            if reduceMotion { selectedPage = page }
            else {
                withAnimation(selectionAnimation) { selectedPage = page }
            }
        } label: {
            HStack(spacing: 10.5) {
                Image(systemName: page.symbolName)
                    .resizable()
                    .scaledToFit()
                    .symbolVariant(isSelected ? .fill : .none)
                    .fontWeight(isSelected ? .medium : .regular)
                    // Variant and weight must swap atomically inside the capsule's spring.
                    // Keep the animated frame and scale outside this glyph transaction.
                    // https://developer.apple.com/documentation/swiftui/view/transaction(_:)
                    .transaction { $0.animation = nil }
                    .frame(width: 24, height: 24)
                    .scaleEffect(0.92 + emphasis * 0.08)
                    .layoutPriority(2)

                Text(page.title(in: appLanguage))
                    .font(.system(size: 16, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .allowsTightening(true)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .layoutPriority(1)
            }
            .foregroundStyle(Color.tsInk.opacity(0.48 + emphasis * 0.42))
            .padding(.leading, 9)
            .padding(.trailing, 4)
            // Keep every title mounted. The rounded boundary reveals the new
            // title and truncates the old one while their local capsules morph.
            .frame(width: activeVisualWidth, height: 40, alignment: .leading)
            .frame(width: capsuleWidth, height: 40, alignment: .leading)
            .background(
                Color.tsSurfaceMuted.opacity(0.38 + emphasis * 0.50),
                in: Capsule()
            )
            .clipShape(Capsule())
            .frame(width: itemWidth, height: 44)
            .frame(height: 48)
            .contentShape(Rectangle())
            .accessibilityHidden(true)
        }
        .buttonStyle(RelationshipNavigationButtonStyle(reduceMotion: reduceMotion))
        .accessibilityLabel(page.title(in: appLanguage))
        .accessibilityAddTraits(selectedPage == page ? .isSelected : [])
        .accessibilityIdentifier("archive-tab-\(page.accessibilityIdentifier)")
        .accessibilityShowsLargeContentViewer { Text(page.title(in: appLanguage)) }
    }

    private func adjacentDonor(
        for page: RelationshipArchivePage
    ) -> RelationshipArchivePage {
        let pages = RelationshipArchivePage.allCases
        let donorIndex = page.pageIndex == pages.count - 1
            ? page.pageIndex - 1
            : page.pageIndex + 1
        return pages[donorIndex]
    }
}

private struct RelationshipNavigationButtonStyle: ButtonStyle {
    let reduceMotion: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.965 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(
                reduceMotion
                    ? nil
                    : .interactiveSpring(
                        response: 0.18,
                        dampingFraction: 0.78,
                        blendDuration: 0.04
                    ),
                value: configuration.isPressed
            )
    }
}

struct PursuitTodayView: View {
    let snapshot: PursuitWorkspaceSnapshot
    let isPreview: Bool
    let calendarActivities: [RelationshipCalendarActivity]
    let unreadSessions: [AgentSession]
    let actionRecovery: PursuitActionRecoveryItem?
    let onOpenSession: (AgentSession) -> Void
    let onOpenCalendar: () -> Void
    let onOpenAttention: (PursuitAttentionItem) -> Void
    let onOpenPursuit: (WorkspacePursuit) -> Void
    let onOpenActionRecovery: (String) -> Void
    let pendingCaptureCount: Int
    let onOpenCaptureInbox: () -> Void
    @State private var showsAllAttention = false
    @State private var decisionStates: [String: TodayInlineDecisionStatus] = [:]
    @State private var decisionOverrides: [String: TodayInlineDecision] = [:]
    @State private var expandedEvidenceDecisionID: String?
    @State private var editingDecision: TodayInlineDecision?
    @Environment(\.appLanguage) private var appLanguage

    init(
        snapshot: PursuitWorkspaceSnapshot,
        isPreview: Bool,
        calendarActivities: [RelationshipCalendarActivity],
        unreadSessions: [AgentSession],
        actionRecovery: PursuitActionRecoveryItem?,
        onOpenSession: @escaping (AgentSession) -> Void,
        onOpenCalendar: @escaping () -> Void,
        onOpenAttention: @escaping (PursuitAttentionItem) -> Void,
        onOpenPursuit: @escaping (WorkspacePursuit) -> Void,
        onOpenActionRecovery: @escaping (String) -> Void,
        pendingCaptureCount: Int = 0,
        onOpenCaptureInbox: @escaping () -> Void = {}
    ) {
        self.snapshot = snapshot
        self.isPreview = isPreview
        self.calendarActivities = calendarActivities
        self.unreadSessions = unreadSessions
        self.actionRecovery = actionRecovery
        self.onOpenSession = onOpenSession
        self.onOpenCalendar = onOpenCalendar
        self.onOpenAttention = onOpenAttention
        self.onOpenPursuit = onOpenPursuit
        self.onOpenActionRecovery = onOpenActionRecovery
        self.pendingCaptureCount = pendingCaptureCount
        self.onOpenCaptureInbox = onOpenCaptureInbox
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(formattedToday)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.tsMutedInk)
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    if isPreview {
                        PursuitPreviewBoundary(compact: true)
                    }
                }
                TodayRelationshipCalendarPeek(
                    activities: calendarActivities,
                    onOpen: onOpenCalendar
                )
                .padding(.top, 14)

                if pendingCaptureCount > 0 {
                    TodayCaptureInboxRow(
                        count: pendingCaptureCount,
                        action: onOpenCaptureInbox
                    )
                    .padding(.top, 14)
                }

                if isPreview {
                    previewDecisionContent
                } else {
                    canonicalAttentionContent
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 28)
        }
        .scrollIndicators(.hidden)
        .relationshipContentBounce()
        .accessibilityIdentifier(
            isPreview ? "editorial-today" : "canonical-pursuit-today"
        )
        .sheet(item: $editingDecision) { decision in
            TodayInlineDecisionEditor(decision: decision) { updated in
                decisionOverrides[decision.id] = updated
                editingDecision = nil
            }
        }
    }

    private var previewDecisionContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(
                String(
                    format: appLanguage.text("Needs your decision · %d"),
                    locale: appLanguage.locale,
                    pendingDecisionCount
                )
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.tsMutedInk)
            .padding(.top, 24)
            .accessibilityIdentifier("today-attention-summary")

            ForEach(Array(previewDecisions.enumerated()), id: \.element.id) {
                index,
                decision in
                let current = decisionOverrides[decision.id] ?? decision
                let state = decisionStates[decision.id] ?? .pending
                TodayInlineDecisionCard(
                    decision: current,
                    status: state,
                    showsEvidence: expandedEvidenceDecisionID == decision.id,
                    onApprove: {
                        decisionStates[decision.id] = .approved
                        expandedEvidenceDecisionID = nil
                    },
                    onEdit: { editingDecision = current },
                    onDismiss: {
                        decisionStates[decision.id] = .dismissed
                        expandedEvidenceDecisionID = nil
                    },
                    onToggleEvidence: {
                        expandedEvidenceDecisionID = expandedEvidenceDecisionID == decision.id
                            ? nil
                            : decision.id
                    },
                    onRestore: { decisionStates[decision.id] = .pending }
                )
                .padding(.top, index == 0 ? 12 : 10)
                .accessibilityIdentifier(
                    index == 0 ? "today-focus" : "today-inline-decision-\(decision.id)"
                )
            }

            if let firstAttention = attentionItems.first {
                Button { openPrimary(firstAttention) } label: {
                    HStack(spacing: 8) {
                        Text(
                            String(
                                format: appLanguage.text("%d more to handle later"),
                                locale: appLanguage.locale,
                                attentionItems.count
                            )
                        )
                        .font(.caption)
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(Color.tsMutedInk)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, 8)
                .accessibilityIdentifier(
                    firstAttention.kind == .review
                        ? "today-review-proposal-\(firstAttention.pursuitID)"
                        : "today-attention-pursuit-\(firstAttention.pursuitID)"
                )
            }
        }
    }

    @ViewBuilder
    private var canonicalAttentionContent: some View {
        if let unread = unreadSessions.first {
                    Text(
                        appLanguage.text(
                            unreadSessions.count == 1
                                ? "Unread session"
                                : "Unread sessions",
                            zhHans: "未读会话"
                        )
                    )
                    .font(.caption.weight(.bold))
                    .tracking(1.1)
                    .foregroundStyle(Color.tsMutedInk)
                    .padding(.top, 34)

                    TodayUnreadSessionRow(
                        session: unread,
                        remainingCount: max(unreadSessions.count - 1, 0),
                        action: { onOpenSession(unread) }
                    )
                    .padding(.top, 6)
        }

        if let actionRecovery = attentionRecovery {
                    Text(
                        appLanguage.text(
                            actionRecovery.status == .recorded
                                ? "Recent outcome"
                                : "Recovery in progress",
                            zhHans: actionRecovery.status == .recorded
                                ? "近期结果"
                                : "正在恢复"
                        )
                    )
                    .font(.caption.weight(.bold))
                    .tracking(1.1)
                    .foregroundStyle(Color.tsMutedInk)
                    .padding(.top, unreadSessions.isEmpty ? 30 : 24)

                    TodayActionRecoveryCard(
                        item: actionRecovery,
                        action: {
                            onOpenActionRecovery(actionRecovery.pursuitID)
                        }
                    )
                    .padding(.top, 6)
        }

        if attentionItems.isEmpty {
            if attentionRecovery == nil, pendingCaptureCount == 0 {
                PursuitNoActionView()
                    .padding(.top, topWorkSpacing)
            }
        } else if let focus = attentionItems.first {
                    Text(
                        appLanguage.text(
                            "Needs your decision",
                            zhHans: "待处理"
                        )
                    )
                    .font(.caption.weight(.bold))
                    .tracking(1.1)
                    .foregroundStyle(Color.tsMutedInk)
                    .padding(.top, topWorkSpacing)

                    TodayFocusCard(
                        item: focus,
                        pursuit: snapshot.pursuit(id: focus.pursuitID),
                        primaryAction: { openPrimary(focus) },
                        proposalAction: { onOpenAttention(focus) },
                        pursuitAction: {
                            if let pursuit = snapshot.pursuit(id: focus.pursuitID) {
                                onOpenPursuit(pursuit)
                            }
                        }
                    )
                    .padding(.top, 6)

                    if attentionItems.count > 1 {
                        Text(appLanguage.text("Next", zhHans: "接下来"))
                            .font(.caption.weight(.bold))
                            .tracking(1.1)
                            .foregroundStyle(Color.tsMutedInk)
                            .padding(.top, 38)
                            .padding(.bottom, 4)
                        ForEach(visibleContinuationItems) { item in
                            TodayContinuationRow(
                                item: item,
                                pursuit: snapshot.pursuit(id: item.pursuitID),
                                primaryAction: { openPrimary(item) },
                                proposalAction: { onOpenAttention(item) }
                            )
                        }
                        if hiddenAttentionCount > 0 || showsAllAttention {
                            Button {
                                showsAllAttention.toggle()
                            } label: {
                                HStack {
                                    Text(attentionDisclosureLabel)
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    Image(
                                        systemName: showsAllAttention
                                            ? "chevron.up"
                                            : "chevron.down"
                                    )
                                }
                                .foregroundStyle(Color.tsInk)
                                .frame(minHeight: 48)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("today-attention-disclosure")
                        }
                    }
        }
    }

    private var previewDecisions: [TodayInlineDecision] {
        TodayInlineDecision.preview(in: appLanguage)
    }

    private var pendingDecisionCount: Int {
        previewDecisions.filter {
            (decisionStates[$0.id] ?? .pending) == .pending
        }.count
    }

    private var topWorkSpacing: CGFloat {
        unreadSessions.isEmpty && attentionRecovery == nil ? 34 : 24
    }

    private var formattedToday: String {
        if appLanguage.usesSimplifiedChinese() {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "zh-Hans")
            formatter.dateFormat = "M月d日 · EEE"
            return formatter.string(from: .now)
        }
        return Date.now.formatted(
            Date.FormatStyle()
                .weekday(.wide)
                .month(.wide)
                .day()
                .locale(appLanguage.locale)
        )
    }

    private var visibleContinuationItems: [PursuitAttentionItem] {
        let continuation = Array(attentionItems.dropFirst())
        return showsAllAttention ? continuation : Array(continuation.prefix(4))
    }

    private var hiddenAttentionCount: Int {
        max(attentionItems.count - 5, 0)
    }

    private var attentionItems: [PursuitAttentionItem] {
        guard let actionRecovery = attentionRecovery else { return snapshot.todayItems }
        return snapshot.todayItems.filter {
            $0.pursuitID != actionRecovery.pursuitID
        }
    }

    private var attentionRecovery: PursuitActionRecoveryItem? {
        return actionRecovery
    }

    private var attentionDisclosureLabel: String {
        if showsAllAttention {
            return appLanguage.text("Show fewer", zhHans: "收起")
        }
        return appLanguage.text(
            "Show \(hiddenAttentionCount) more",
            zhHans: "再显示 \(hiddenAttentionCount) 件"
        )
    }

    private func openPrimary(_ item: PursuitAttentionItem) {
        guard let pursuit = snapshot.pursuit(id: item.pursuitID) else { return }
        if item.kind == .review {
            onOpenAttention(item)
        } else {
            onOpenPursuit(pursuit)
        }
    }

}

private struct TodayCaptureInboxRow: View {
    let count: Int
    let action: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: "rectangle.stack")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.tsVermilion)
                    .frame(width: 44, height: 44)
                    .background(Color.tsSurfaceMuted, in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(appLanguage.text("Capture Sessions"))
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                    Text(countLabel)
                        .font(.subheadline)
                        .foregroundStyle(Color.tsMutedInk)
                }
                Spacer(minLength: 8)
                Text(verbatim: "\(count)")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Color.tsVermilion)
                    .monospacedDigit()
                    .frame(minWidth: 30, minHeight: 30)
                    .background(Color.tsVermilion.opacity(0.1), in: Capsule())
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.tsMutedInk)
            }
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .tsCard()
        .accessibilityLabel(
            appLanguage.text("Capture Sessions") + ", " + countLabel
        )
        .accessibilityHint(
            appLanguage.text(
                "Opens capture decisions that need your input"
            )
        )
        .accessibilityIdentifier("today-capture-inbox")
    }

    private var countLabel: String {
        String(
            format: appLanguage.text("%lld need your input"),
            locale: appLanguage.locale,
            Int64(count)
        )
    }
}

private enum TodayInlineDecisionStatus: Equatable {
    case pending
    case approved
    case dismissed
}

private struct TodayInlineDecision: Identifiable, Equatable {
    enum Kind: Equatable {
        case contact
        case calendar

        func title(in language: AppLanguage) -> String {
            switch self {
            case .contact:
                return language.usesSimplifiedChinese() ? "联系人" : "Contact"
            case .calendar:
                return language.usesSimplifiedChinese() ? "日程" : "Calendar"
            }
        }

        func destination(in language: AppLanguage) -> String {
            switch self {
            case .contact:
                return language.text("Contacts")
            case .calendar:
                return language.text("Apple Calendar")
            }
        }
    }

    let id: String
    let kind: Kind
    var question: String
    var effectPrimary: String
    var effectSecondary: String
    let evidenceLabel: String
    let evidenceQuote: String

    static func preview(in language: AppLanguage) -> [TodayInlineDecision] {
        [
            TodayInlineDecision(
                id: "preview-contact",
                kind: .contact,
                question: language.text("Add Maya Ortiz?"),
                effectPrimary: "maya@example.test",
                effectSecondary: language.text("Create new contact"),
                evidenceLabel: language.text("Conversation evidence · 1"),
                evidenceQuote: "Maya Ortiz · maya@example.test"
            ),
            TodayInlineDecision(
                id: "preview-calendar",
                kind: .calendar,
                question: language.text("Add a video call with Alex Chen?"),
                effectPrimary: language.text("Tomorrow 15:00–15:30"),
                effectSecondary: language.text(
                    "Singapore time · Apple Calendar"
                ),
                evidenceLabel: language.text("Conversation evidence · 1"),
                evidenceQuote: language.text(
                    "Tomorrow at 3pm Singapore time works for a 30-minute video call."
                )
            ),
        ]
    }
}

private struct TodayInlineDecisionCard: View {
    let decision: TodayInlineDecision
    let status: TodayInlineDecisionStatus
    let showsEvidence: Bool
    let onApprove: () -> Void
    let onEdit: () -> Void
    let onDismiss: () -> Void
    let onToggleEvidence: () -> Void
    let onRestore: () -> Void

    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if status == .pending {
                proposal
            } else {
                receipt
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.tsCanvas,
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.tsLine, lineWidth: 1)
        }
        .modifier(LabLayoutOutline())
        .accessibilityElement(children: .contain)
    }

    private var proposal: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(decision.kind.title(in: appLanguage))
                .font(.caption.weight(.bold))
                .tracking(0.2)
                .foregroundStyle(Color.tsMutedInk)

            Text(decision.question)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)

            VStack(alignment: .leading, spacing: 0) {
                effectCopy
            }
                .padding(.top, 7)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("today-decision-effect-\(decision.id)")

            Button(action: onToggleEvidence) {
                HStack(spacing: 10) {
                    Image(systemName: "text.bubble")
                        .font(.subheadline.weight(.semibold))
                        .accessibilityHidden(true)
                    Text(decision.evidenceLabel)
                        .font(.caption)
                    Spacer(minLength: 8)
                    Image(systemName: showsEvidence ? "chevron.up" : "chevron.right")
                        .font(.caption.weight(.semibold))
                        .accessibilityHidden(true)
                }
                .foregroundStyle(Color.tsMutedInk)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 6)
            .accessibilityLabel(decision.evidenceLabel)
            .accessibilityValue(
                appLanguage.text(showsEvidence ? "Expanded" : "Collapsed")
            )
            .accessibilityIdentifier("today-decision-evidence-\(decision.id)")

            if showsEvidence {
                Text(verbatim: "“\(decision.evidenceQuote)”")
                    .font(.caption)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        Color.tsEvidence,
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
                    .padding(.bottom, 8)
                    .accessibilityIdentifier(
                        "today-decision-evidence-quote-\(decision.id)"
                    )
            }

            Divider().overlay(Color.tsLine)
            decisionActions
                .padding(.top, 10)
        }
    }

    @ViewBuilder
    private var decisionActions: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(spacing: 8) {
                approveButton
                editButton
                dismissButton
            }
        } else {
            HStack(spacing: 9) {
                approveButton
                editButton
                dismissButton
            }
        }
    }

    @ViewBuilder
    private var effectCopy: some View {
        if decision.kind == .calendar {
            VStack(alignment: .leading, spacing: 3) {
                Text(decision.effectPrimary)
                Text(decision.effectSecondary)
                    .foregroundStyle(Color.tsMutedInk.opacity(0.88))
            }
            .font(.subheadline)
            .foregroundStyle(Color.tsMutedInk)
            .fixedSize(horizontal: false, vertical: true)
        } else {
            Text(verbatim: "\(decision.effectPrimary) · \(decision.effectSecondary)")
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var approveButton: some View {
        Button(action: onApprove) {
            Text(appLanguage.text("Add"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.tsSurface)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(
                    Color.tsInk,
                    in: RoundedRectangle(cornerRadius: 13, style: .continuous)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            String(
                format: appLanguage.text("Approve this %@ proposal"),
                locale: appLanguage.locale,
                decision.kind.title(in: appLanguage).lowercased()
            )
        )
        .accessibilityHint(
            appLanguage.text(
                "Records a preview decision only. No external write occurs."
            )
        )
        .accessibilityIdentifier("today-decision-add-\(decision.id)")
    }

    private var editButton: some View {
        Button(action: onEdit) {
            Text(appLanguage.usesSimplifiedChinese() ? "编辑" : "Edit")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("today-decision-edit-\(decision.id)")
    }

    private var dismissButton: some View {
        Button(role: .destructive, action: onDismiss) {
            Text(appLanguage.usesSimplifiedChinese() ? "忽略" : "Dismiss")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.tsMutedInk)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("today-decision-dismiss-\(decision.id)")
    }

    private var receipt: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(
                systemName: status == .approved
                    ? "checkmark.circle.fill"
                    : "minus.circle"
            )
            .font(.title3)
            .foregroundStyle(
                status == .approved ? Color.tsConfirmed : Color.tsMutedInk
            )
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(
                    status == .approved
                        ? appLanguage.text("Preview decision recorded")
                        : appLanguage.text("Proposal dismissed")
                )
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                .accessibilityIdentifier(
                    "today-decision-receipt-\(decision.id)"
                )
                Text(
                    String(
                        format: appLanguage.text("No write was made to %@."),
                        locale: appLanguage.locale,
                        decision.kind.destination(in: appLanguage)
                    )
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
            }

            Spacer(minLength: 8)

            Button(action: onRestore) {
                Text(appLanguage.text("Undo"))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
                .buttonStyle(.plain)
                .accessibilityIdentifier("today-decision-restore-\(decision.id)")
        }
    }
}

private struct TodayInlineDecisionEditor: View {
    let decision: TodayInlineDecision
    let onSave: (TodayInlineDecision) -> Void

    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dismiss) private var dismiss
    @State private var question: String
    @State private var effectPrimary: String
    @State private var effectSecondary: String

    init(
        decision: TodayInlineDecision,
        onSave: @escaping (TodayInlineDecision) -> Void
    ) {
        self.decision = decision
        self.onSave = onSave
        _question = State(initialValue: decision.question)
        _effectPrimary = State(initialValue: decision.effectPrimary)
        _effectSecondary = State(initialValue: decision.effectSecondary)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(appLanguage.text("Proposal")) {
                    TextField(
                        appLanguage.text("Decision question"),
                        text: $question,
                        axis: .vertical
                    )
                    .accessibilityIdentifier("today-decision-editor-question")
                }

                Section(appLanguage.text("Exact effect")) {
                    TextField(
                        appLanguage.text("Primary detail"),
                        text: $effectPrimary,
                        axis: .vertical
                    )
                    .accessibilityIdentifier("today-decision-editor-primary")
                    TextField(
                        appLanguage.text("Destination"),
                        text: $effectSecondary,
                        axis: .vertical
                    )
                    .accessibilityIdentifier("today-decision-editor-secondary")
                }

                Section {
                    Text(
                        appLanguage.text(
                            "Editing changes this proposal only. The preview cannot write to an external app."
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                }
            }
            .navigationTitle(appLanguage.text("Edit proposal"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(appLanguage.text("Cancel")) {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(appLanguage.text("Save")) {
                        var updated = decision
                        updated.question = question.trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                        updated.effectPrimary = effectPrimary.trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                        updated.effectSecondary = effectSecondary.trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                        onSave(updated)
                    }
                    .disabled(!canSave)
                    .accessibilityIdentifier("today-decision-editor-save")
                }
            }
        }
        .accessibilityIdentifier("today-decision-editor")
    }

    private var canSave: Bool {
        !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !effectPrimary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !effectSecondary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

private struct TodayActionRecoveryCard: View {
    let item: PursuitActionRecoveryItem
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Label(
                        item.status == .recorded
                            ? "Outcome recorded"
                            : "Checking canonical result",
                        systemImage: item.status == .recorded
                            ? "checkmark.seal"
                            : "arrow.triangle.2.circlepath"
                    )
                    .font(.headline)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.bold))
                }
                Text(item.actionTitle)
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(item.outcomeSummary)
                    .font(.subheadline)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(item.pursuitTitle) · Owner: \(item.ownerDisplayName)")
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                Label(
                    "No message, calendar event, or external write",
                    systemImage: "lock.shield"
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
            }
            .foregroundStyle(Color.tsInk)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 16))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("today-action-recovery-\(item.actionID)")
    }
}

private struct TodayUnreadSessionRow: View {
    let session: AgentSession
    let remainingCount: Int
    let action: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Color.tsInk)
                        .frame(width: 42, height: 42)
                    Image(systemName: "sparkles")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsSurface)
                }
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 4) {
                    Text(session.displayTitle(in: appLanguage))
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                        .lineLimit(1)
                    Text(
                        "\(session.personDisplayLabel) · \(session.displayContextLabel(in: appLanguage))"
                    )
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                if remainingCount > 0 {
                    Text("+\(remainingCount)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsMutedInk)
                }
                Circle()
                    .fill(Color.tsVermilion)
                    .frame(width: 7, height: 7)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 66)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            appLanguage.text(
                "Unread session: \(session.displayTitle(in: appLanguage)), \(session.personDisplayLabel)",
                zhHans: "未读会话：\(session.displayTitle(in: appLanguage))，\(session.personDisplayLabel)"
            )
        )
        .accessibilityIdentifier("today-unread-session")
    }
}

private struct TodayFocusCard: View {
    let item: PursuitAttentionItem
    let pursuit: WorkspacePursuit?
    let primaryAction: () -> Void
    let proposalAction: () -> Void
    let pursuitAction: () -> Void
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                RelationshipEyebrow(
                    item.kind == .review
                        ? appLanguage.text("Review proposal")
                        : appLanguage.workspaceTerm(item.eyebrow)
                )
                Spacer(minLength: 10)
                if let due = item.due {
                    Text(appLanguage.dueDate(due))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsMutedInk)
                }
            }
            Text(
                item.subjectDisplayLabel
                    ?? pursuit?.title
                    ?? appLanguage.text("Pursuit", zhHans: "目标")
            )
                .font(.title2.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 12)
            if item.subjectDisplayLabel != nil, let pursuit {
                Text(pursuit.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 5)
            }
            Text(item.title)
                .font(.body)
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)

            if dynamicTypeSize.isAccessibilitySize {
                primaryActionButton
                    .padding(.top, 20)
            }

            TodayDecisionContextLine(
                label: appLanguage.text("Target outcome", zhHans: "目标结果"),
                value: item.targetOutcome
            )
                .padding(.top, 10)
            TodayDecisionContextLine(
                label: appLanguage.text("Target date", zhHans: "目标日期"),
                value: item.targetDate
            )
            if let blocker = item.blocker {
                TodayDecisionContextLine(
                    label: appLanguage.text("Blocker", zhHans: "阻碍"),
                    value: blocker
                )
            }

            HStack(spacing: 12) {
                if let owner = item.owner {
                    Label(owner, systemImage: "person")
                }
                if let evidence = localizedEvidenceSummary {
                    Label(evidence, systemImage: "link")
                }
            }
            .font(.caption)
            .foregroundStyle(Color.tsMutedInk)
            .lineLimit(1)
            .padding(.top, 14)

            if !dynamicTypeSize.isAccessibilitySize {
                primaryActionButton
                    .padding(.top, 20)
            }

            if item.proposalID != nil, item.proposedAction != nil, item.kind != .review {
                Button(action: proposalAction) {
                    Text(appLanguage.text("Review proposal", zhHans: "审阅提议"))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
                .accessibilityLabel(
                    appLanguage.text(
                        "Review proposal for \(pursuit?.title ?? item.title)",
                        zhHans: "审阅 \(pursuit?.title ?? item.title) 的提议"
                    )
                )
                .accessibilityIdentifier("today-review-proposal-\(item.pursuitID)")
            } else if item.kind == .review {
                Button(action: pursuitAction) {
                    Text(appLanguage.text("Open Pursuit", zhHans: "打开目标"))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("today-open-pursuit")
            }
        }
        .padding(20)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 22))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today-focus")
    }

    private var primaryActionButton: some View {
        Button(action: primaryAction) {
            HStack {
                Text(appLanguage.workspaceTerm(item.actionLabel))
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Image(systemName: "arrow.right")
            }
            .foregroundStyle(Color.tsSurface)
            .frame(minHeight: 48)
            .padding(.horizontal, 16)
            .background(Color.tsInk, in: RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            appLanguage.text(
                "\(item.actionLabel) for \(item.subjectDisplayLabel ?? pursuit?.title ?? item.title). \(item.title)",
                zhHans: "为 \(item.subjectDisplayLabel ?? pursuit?.title ?? item.title) \(item.actionLabel)：\(item.title)"
            )
        )
        .accessibilityIdentifier(
            item.kind == .review
                ? "today-review-proposal-\(item.pursuitID)"
                : "today-attention-pursuit-\(item.pursuitID)"
        )
    }

    private func shortEvidence(_ value: String) -> String {
        value.components(separatedBy: " · ").first ?? value
    }

    private var localizedEvidenceSummary: String? {
        if let state = item.evidenceState, state.availability != "available" {
            return appLanguage.evidenceAttentionLabel(state)
        }
        if let observedAt = item.evidenceObservedAt {
            return shortEvidence(
                appLanguage.evidenceFreshness(
                    observedAt: observedAt,
                    sourceTimezone: item.evidenceSourceTimezone
                )
            )
        }
        return item.evidenceState.map(appLanguage.evidenceExplanation)
    }
}

private struct TodayContinuationRow: View {
    let item: PursuitAttentionItem
    let pursuit: WorkspacePursuit?
    let primaryAction: () -> Void
    let proposalAction: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: primaryAction) {
                HStack(alignment: .center, spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(pursuit?.title ?? appLanguage.text("Pursuit", zhHans: "目标"))
                            .font(.headline)
                            .foregroundStyle(Color.tsInk)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(item.title)
                            .font(.caption)
                            .foregroundStyle(Color.tsMutedInk)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 7) {
                        Text(
                            [
                                item.owner,
                                item.due.map { appLanguage.dueDate($0) }
                                    ?? appLanguage.workspaceTerm(item.eyebrow),
                            ]
                                .compactMap { $0 }
                                .joined(separator: " · ")
                        )
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.tsMutedInk)
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(Color.tsMutedInk)
                    }
                }
                .frame(minHeight: 82)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(
                item.kind == .review
                    ? "today-review-proposal-\(item.pursuitID)"
                    : "today-attention-pursuit-\(item.pursuitID)"
            )

            if item.proposalID != nil, item.kind != .review {
                Button(action: proposalAction) {
                    Text(appLanguage.text("Review proposal", zhHans: "审阅提议"))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    appLanguage.text(
                        "Review proposal for \(pursuit?.title ?? item.title)",
                        zhHans: "审阅 \(pursuit?.title ?? item.title) 的提议"
                    )
                )
                .accessibilityIdentifier("today-review-proposal-\(item.pursuitID)")
            }
        }
        .overlay(alignment: .bottom) { Divider().overlay(Color.tsLine) }
    }
}

private struct PursuitAttentionRow: View {
    let item: PursuitAttentionItem
    let pursuit: WorkspacePursuit?
    let primaryAction: () -> Void
    let proposalAction: () -> Void
    @State private var isExpanded = false
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                RelationshipEyebrow(appLanguage.workspaceTerm(item.eyebrow))
                Spacer(minLength: 8)
                if let due = item.due {
                    Text(appLanguage.dueDate(due))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.tsMutedInk)
                }
            }
            .padding(.top, 18)
            Text(
                pursuit?.title
                    ?? appLanguage.text(
                        "Pursuit unavailable",
                        zhHans: "目标不可用"
                    )
            )
                .font(.custom("Georgia", size: 22, relativeTo: .headline))
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            Text(item.title)
                .font(.subheadline)
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 7)
            TodayDecisionContextLine(
                label: appLanguage.text("Target outcome", zhHans: "目标结果"),
                value: item.targetOutcome
            )
                .padding(.top, 8)
            TodayDecisionContextLine(
                label: appLanguage.text("Target date", zhHans: "目标日期"),
                value: item.targetDate
            )
            if let owner = item.owner {
                TodayDecisionContextLine(
                    label: appLanguage.text("Owner", zhHans: "负责人"),
                    value: "\(owner)\(item.due.map { appLanguage.dueDate($0, prefixed: true) } ?? "")"
                )
            }
            if let blocker = item.blocker {
                TodayDecisionContextLine(
                    label: appLanguage.text("Blocker", zhHans: "阻碍"),
                    value: blocker
                )
            }
            if let evidenceFreshness = localizedEvidenceSummary {
                TodayDecisionContextLine(
                    label: appLanguage.text("Evidence", zhHans: "证据"),
                    value: evidenceFreshness
                )
            }
            DisclosureGroup(isExpanded: $isExpanded) {
                Text(item.reason)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
                if let pursuit {
                    TodayDecisionContextLine(
                        label: appLanguage.text(
                            "Current milestone",
                            zhHans: "当前里程碑"
                        ),
                        value: "\(pursuit.milestone.humanized) · \(pursuit.milestoneAuthority.evidenceState.attentionLabel.lowercased()) · revision \(pursuit.revision)"
                    )
                }
            } label: {
                Text(
                    isExpanded
                        ? appLanguage.text("Hide full context", zhHans: "收起完整背景")
                        : appLanguage.text("Show full context", zhHans: "查看完整背景")
                )
                    .font(.caption.weight(.semibold))
            }
            .padding(.top, 8)
            .accessibilityIdentifier("today-context-\(item.pursuitID)")
            Button(action: primaryAction) {
                HStack(spacing: 12) {
                    Text(appLanguage.workspaceTerm(item.actionLabel))
                        .font(.subheadline.weight(.semibold))
                    Image(systemName: "arrow.right")
                }
                .foregroundStyle(Color.tsInk)
                .frame(minHeight: 44)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(Color.tsInk).frame(height: 1)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(
                item.kind == .review
                    ? "today-review-proposal-\(item.pursuitID)"
                    : "today-attention-\(item.id)"
            )
            .padding(.top, 12)
            if item.proposalID != nil, item.proposedAction != nil {
                Button(action: proposalAction) {
                    Text(appLanguage.text("Review proposal", zhHans: "审阅提议"))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsMutedInk)
                        .frame(
                            maxWidth: .infinity,
                            minHeight: 44,
                            alignment: .leading
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("today-review-proposal-\(item.pursuitID)")
            }
        }
        .padding(.bottom, 22)
        .overlay(alignment: .bottom) { Divider().overlay(Color.tsLine) }
    }

    private var localizedEvidenceSummary: String? {
        if let state = item.evidenceState, state.availability != "available" {
            return appLanguage.evidenceAttentionLabel(state)
        }
        if let observedAt = item.evidenceObservedAt {
            return appLanguage.evidenceFreshness(
                observedAt: observedAt,
                sourceTimezone: item.evidenceSourceTimezone
            )
        }
        return item.evidenceState.map(appLanguage.evidenceExplanation)
    }
}

private struct TodayDecisionContextLine: View {
    let label: String
    let value: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 4) {
                    labelView
                    valueView
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    labelView.frame(minWidth: 64, alignment: .leading)
                    valueView
                }
            }
        }
        .padding(.top, 7)
        .accessibilityElement(children: .combine)
    }

    private var labelView: some View {
        Text(label.uppercased())
            .font(.caption2.weight(.bold))
            .tracking(1.1)
            .foregroundStyle(Color.tsMutedInk)
            .fixedSize(horizontal: true, vertical: false)
    }

    private var valueView: some View {
        Text(value)
            .font(.caption)
            .foregroundStyle(Color.tsInk)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct RelationshipRetrievalMetadataLabelStyle: LabelStyle {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            configuration.icon
                .font(.system(size: dynamicTypeSize.isAccessibilitySize ? 20 : 12))
            configuration.title
        }
    }
}

private struct RelationshipRetrievalIndex: View {
    let count: Int
    let noun: String
    let isPreview: Bool
    @Environment(\.appLanguage) private var appLanguage
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                countLabel.fixedSize()
                Spacer(minLength: 12)
                previewLabel.fixedSize()
            }
            VStack(alignment: .leading, spacing: 4) {
                countLabel
                previewLabel
            }
        }
        .font(.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .accessibilityElement(children: .contain)
    }

    private var countLabel: some View {
        Text(count.formatted() + " " + noun)
            .foregroundStyle(Color.tsMutedInk)
            .accessibilityShowsLargeContentViewer {
                Text(count.formatted() + " " + noun)
            }
    }

    @ViewBuilder
    private var previewLabel: some View {
        if isPreview {
            Text(appLanguage.text("Synthetic preview"))
                .foregroundStyle(Color.tsMutedInk)
                .accessibilityIdentifier("workspace-preview-boundary")
                .accessibilityShowsLargeContentViewer {
                    Text(appLanguage.text("Synthetic preview"))
                }
        }
    }
}

// Shared retrieval controls keep search distinct from the global Agent composer.
private struct RelationshipRetrievalSearchField: View {
    let placeholder: String
    let identifier: String
    @Binding var text: String
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.colorSchemeContrast) private var contrast
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(Color.tsMutedInk)
                .accessibilityHidden(true)
            TextField(
                "", text: $text,
                prompt: Text(placeholder).foregroundColor(.tsMutedInk)
            )
                .font(.subheadline)
                .foregroundStyle(Color.tsInk)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($isFocused)
                .frame(minHeight: 46)
                .accessibilityLabel(placeholder)
                .accessibilityIdentifier("\(identifier)-search-field")
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.body)
                        .foregroundStyle(Color.tsMutedInk)
                        .frame(width: 44, height: 46)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(appLanguage.text("Clear search"))
                .accessibilityIdentifier("\(identifier)-search-clear")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, text.isEmpty ? 16 : 2)
        .background(Color.tsInk.opacity(0.04), in: Capsule())
        .overlay {
            Capsule().strokeBorder(
                Color.tsMutedInk.opacity(isFocused || contrast == .increased ? 0.45 : 0),
                lineWidth: 1
            )
        }
        .contentShape(Capsule())
        .onTapGesture { isFocused = true }
    }
}

private struct RelationshipRetrievalFilterLabel: View {
    let isActive: Bool
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        Image(systemName: isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease")
            .font(.system(size: 19, weight: .regular))
            .foregroundStyle(isActive ? Color.tsInk : Color.tsMutedInk)
            .frame(width: 46, height: 46)
            .background(Color.tsInk.opacity(isActive ? 0.08 : 0.04), in: Circle())
            .overlay {
                Circle().strokeBorder(Color.tsLine.opacity(contrast == .increased ? 1 : 0), lineWidth: 1)
            }
            .contentShape(Circle())
    }
}

private struct RelationshipRetrievalSelection: View {
    let title: String
    let identifier: String
    let reset: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        Button(action: reset) {
            HStack(spacing: 8) {
                Text(title)
                    .font(.caption.weight(.medium))
                    .fixedSize(horizontal: false, vertical: true)
                Image(systemName: "xmark")
                    .font(.caption2.weight(.semibold))
            }
            .foregroundStyle(Color.tsMutedInk)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(Color.tsInk.opacity(0.04), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel([title, appLanguage.text("Clear filter")].joined(separator: ", "))
        .accessibilityIdentifier(identifier)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct RelationshipRetrievalSurface: ViewModifier {
    var isUnread = false
    var isDirectory = false
    @Environment(\.workspaceCardDensity) private var cardDensity
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        content
            .padding(.horizontal, 16)
            .padding(.vertical, cardDensity.cardPadding + 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                if isUnread {
                    shape.fill(colorScheme == .dark ? Color.tsSurfaceMuted : Color.tsEvidence)
                        .shadow(color: Color.black.opacity(colorScheme == .dark ? 0.22 : 0.07),
                                radius: 12, x: 0, y: 4)
                }
            }
            .overlay(alignment: .bottom) {
                if !isUnread {
                    Rectangle()
                        .fill(Color.tsLine.opacity(contrast == .increased ? 1 : 0.5))
                        .frame(height: 0.5)
                        .padding(.leading, isDirectory && !dynamicTypeSize.isAccessibilitySize ? 72 : 16)
                        .padding(.trailing, 16)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(shape)
            .modifier(LabLayoutOutline())
    }
}

private extension View {
    @ViewBuilder
    func retrievalScrollEdge() -> some View {
        // Native diffusion preserves readable controls as content passes beneath.
        if #available(iOS 26.0, *) {
            self.scrollEdgeEffectStyle(.soft, for: .top)
        } else {
            self
        }
    }
}

struct AgentSessionListView: View {
    let sessions: [AgentSession]
    let people: [String: WorkspacePerson]
    let isPreview: Bool
    let persistenceNotice: String?
    let restorationPosition: UUID?
    @Binding var scrollPosition: UUID?
    let onOpen: (AgentSession) -> Void
    let onMarkRead: (UUID) -> Void
    let onMarkUnread: (UUID) -> Void
    let onDelete: (UUID) -> Bool
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.workspaceCardDensity) private var cardDensity
    @State private var presentedAlert: AgentSessionAlert?
    @State private var isRestoringScroll = false
    @State private var scrollViewport: CGRect = .zero
    @State private var searchText = ""
    @State private var selectedScope: AgentSessionRetrievalScope = .all

    var body: some View {
        VStack(spacing: 0) {
            retrievalIndex
                .dynamicTypeSize(...DynamicTypeSize.accessibility1)

            if let persistenceNotice {
                Label(persistenceNotice, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .padding(.horizontal, 20)
                    .padding(.top, isPreview ? 0 : 14)
                    .padding(.bottom, 8)
                    .accessibilityIdentifier("agent-session-persistence-notice")
            }

            if sessions.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.title2)
                        .foregroundStyle(Color.tsMutedInk)
                    Text(appLanguage.text("No sessions yet", zhHans: "还没有会话"))
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                    Text(
                        appLanguage.text("Use the field below to begin.")
                    )
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(.horizontal, 24)
                .padding(.top, 42)
                .accessibilityIdentifier("agent-sessions-empty")
            } else {
                sessionList
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { retrievalRail }
        .background(Color.tsSurface)
        .alert(sessionAlertTitle, isPresented: Binding(
            get: { presentedAlert != nil },
            set: { if !$0 { presentedAlert = nil } }
        ), presenting: presentedAlert) { alert in
            switch alert {
            case let .delete(session):
                Button(deleteActionTitle, role: .destructive) {
                    guard !onDelete(session.id) else {
                        if scrollPosition == session.id { scrollPosition = nil }
                        return
                    }
                    Task { @MainActor in
                        await Task.yield()
                        presentedAlert = .failure
                    }
                }
                .accessibilityIdentifier("confirm-delete-session")
                Button(appLanguage.text("Cancel"), role: .cancel) {}
                    .accessibilityIdentifier("cancel-delete-session")
            case .failure:
                Button(appLanguage.text("OK"), role: .cancel) {}
            }
        } message: { alert in
            switch alert {
            case .delete:
                Text(deleteScopeMessage)
                    .accessibilityIdentifier("delete-session-scope")
            case .failure:
                Text(appLanguage.text("The local save failed, so the original session is still here. Nothing was removed."))
            }
        }
    }

    private var deleteActionTitle: String {
        appLanguage.text(isPreview ? "Delete session history from this device" : "Delete Session across devices")
    }

    private var sessionAlertTitle: String {
        if case .failure = presentedAlert { return appLanguage.text("Session history was not deleted") }
        return appLanguage.text(isPreview ? "Delete this session history from this device?" : "Delete this Session across your devices?")
    }

    private var deleteScopeMessage: String {
        appLanguage.text(isPreview
            ? "This removes this preview Session, its messages, and its unsaved drafts from this device. Other Sessions and saved contacts stay unchanged."
            : "This deletes this Session, its messages, and its unsaved drafts across your devices. Screenshots retained only by this Session are also removed. Saved contacts and other Sessions stay unchanged.")
    }

    private var filteredSessions: [AgentSession] {
        AgentSessionRetrievalPolicy.filteredSessions(
            sessions, query: searchText, scope: selectedScope, language: appLanguage
        )
    }

    private var retrievalRail: some View {
        VStack(spacing: 2) {
            HStack(spacing: 10) {
                RelationshipRetrievalSearchField(
                    placeholder: appLanguage.text("Search sessions"),
                    identifier: "sessions", text: $searchText
                )
                Menu {
                    ForEach(AgentSessionRetrievalScope.allCases) { scope in
                        Button { selectedScope = scope } label: {
                            if selectedScope == scope {
                                Label(scope.displayLabel(in: appLanguage), systemImage: "checkmark")
                            } else {
                                Text(scope.displayLabel(in: appLanguage))
                            }
                        }
                        .accessibilityIdentifier("sessions-filter-\(scope.id)")
                    }
                } label: {
                    RelationshipRetrievalFilterLabel(isActive: selectedScope != .all)
                }
                .accessibilityLabel([appLanguage.text("Filter sessions"), selectedScope.displayLabel(in: appLanguage)].joined(separator: ", "))
                .accessibilityIdentifier("sessions-filter-menu")
            }
            if selectedScope != .all {
                RelationshipRetrievalSelection(
                    title: selectedScope.displayLabel(in: appLanguage),
                    identifier: "sessions-filter-clear"
                ) { selectedScope = .all }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .background(Color.tsSurface)
    }

    private var noMatchesView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(appLanguage.text("No matching sessions"))
                .font(.headline)
                .foregroundStyle(Color.tsInk)
                .accessibilityIdentifier("sessions-no-matches")
            Button {
                searchText = ""
                selectedScope = .all
            } label: {
                Text(appLanguage.text("Clear search and filter"))
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 14)
                    .frame(minHeight: 44)
                    .background(Color.tsInk.opacity(0.045), in: Capsule())
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.tsInk)
            .accessibilityIdentifier("sessions-filter-reset")
        }
        .padding(.vertical, 20)
    }

    private var sessionList: some View {
        ScrollViewReader { proxy in
            sessionListContent
                .onAppear {
                    guard let restorationPosition else { return }
                    isRestoringScroll = true
                    DispatchQueue.main.async {
                        withAnimation(nil) {
                            proxy.scrollTo(restorationPosition, anchor: .top)
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                            scrollPosition = restorationPosition
                            isRestoringScroll = false
                        }
                    }
                }
        }
    }

    private var retrievalIndex: some View {
        RelationshipRetrievalIndex(
            count: filteredSessions.count,
            noun: appLanguage.text(filteredSessions.count == 1 ? "session" : "sessions"),
            isPreview: isPreview
        )
    }

    private var sessionListContent: some View {
                List {
                    if filteredSessions.isEmpty {
                        noMatchesView
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                    ForEach(filteredSessions) { session in
                        ZStack(alignment: .topTrailing) {
                            Button { onOpen(session) } label: {
                                AgentSessionRow(
                                    session: session,
                                    person: session.personID.flatMap { people[$0] }
                                )
                            }
                            .buttonStyle(RelationshipRetrievalButtonStyle())
                            .accessibilityIdentifier(
                                "agent-session-\(session.id.uuidString)"
                            )

                            Menu {
                                sessionActions(for: session)
                            } label: {
                                Image(systemName: "ellipsis")
                                    .font(.system(size: 17, weight: .regular))
                                    .foregroundStyle(Color.tsMutedInk)
                                    .frame(width: 44, height: 44)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .padding(.trailing, 6)
                            .padding(.top, 8)
                            .accessibilityLabel(
                                appLanguage.text("More session actions")
                            )
                            .accessibilityIdentifier(
                                "session-actions-\(session.id.uuidString)"
                            )
                        }
                        .modifier(RelationshipRowAnchor(
                            id: session.id,
                            viewport: scrollViewport
                        ))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(
                            EdgeInsets(
                                top: cardDensity.rowVerticalInset + 1,
                                leading: 16,
                                bottom: cardDensity.rowVerticalInset + 1,
                                trailing: 16
                            )
                        )
                        .contextMenu {
                            sessionActions(for: session)
                        }
                        .accessibilityAction(
                            named: Text(appLanguage.text("Open session"))
                        ) {
                            onOpen(session)
                        }
                        .accessibilityAction(
                            named: Text(
                                session.isUnread
                                    ? appLanguage.text("Mark as read")
                                    : appLanguage.text("Mark as unread")
                            )
                        ) {
                            toggleReadState(for: session)
                        }
                        .accessibilityAction(
                            named: Text(
                                deleteActionTitle
                            )
                        ) {
                            presentedAlert = .delete(session)
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .background(Color.tsSurface)
                .relationshipContentBounce()
                .scrollDismissesKeyboard(.interactively)
                .retrievalScrollEdge()
                .coordinateSpace(name: Self.scrollCoordinateSpace)
                .onGeometryChange(for: CGRect.self) { geometry in
                    geometry.relationshipScrollViewport
                } action: { scrollViewport = $0 }
                .onPreferenceChange(RelationshipRowAnchorKey<UUID>.self) { candidates in
                    guard !isRestoringScroll else { return }
                    let anchor = filteredSessions.first { candidates.fullyVisible.contains($0.id) }?.id
                        ?? filteredSessions.first { candidates.partiallyVisible.contains($0.id) }?.id
                    if let anchor, anchor != scrollPosition {
                        scrollPosition = anchor
                    }
                }
                .accessibilityIdentifier("agent-session-list")
    }

    private static let scrollCoordinateSpace = "relationship-session-viewport"

    private func toggleReadState(for session: AgentSession) {
        if session.isUnread {
            onMarkRead(session.id)
        } else {
            onMarkUnread(session.id)
        }
    }

    @ViewBuilder
    private func sessionActions(for session: AgentSession) -> some View {
        Button {
            onOpen(session)
        } label: {
            Label(
                appLanguage.text("Open session"),
                systemImage: "arrow.up.right"
            )
        }
        Button {
            toggleReadState(for: session)
        } label: {
            Label(
                session.isUnread
                    ? appLanguage.text("Mark as read")
                    : appLanguage.text("Mark as unread"),
                systemImage: session.isUnread ? "circle" : "circle.fill"
            )
        }
        Button(role: .destructive) {
            presentedAlert = .delete(session)
        } label: {
            Label(
                deleteActionTitle,
                systemImage: "trash"
            )
        }
        .accessibilityIdentifier("delete-session-history")
    }
}

private enum AgentSessionAlert: Identifiable {
    case delete(AgentSession)
    case failure

    var id: String {
        switch self {
        case let .delete(session):
            return "delete-\(session.id.uuidString)"
        case .failure:
            return "failure"
        }
    }
}

private struct AgentSessionRow: View {
    let session: AgentSession
    let person: WorkspacePerson?
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.workspaceCardDensity) private var cardDensity

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                accessibilityLayout
            } else {
                compactLayout
            }
        }
        .modifier(RelationshipRetrievalSurface(isUnread: session.isUnread))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(sessionAccessibilityLabel)
    }

    private var compactLayout: some View {
        VStack(alignment: .leading, spacing: 8) {
            sessionTitle
                .padding(.trailing, 36)
            participantContext
                .padding(.trailing, 4)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                relativeTime
                forkState
                unreadState
                if session.retrievalAttention != nil {
                    Text(verbatim: "·").foregroundStyle(Color.tsMutedInk)
                        .accessibilityHidden(true)
                    attentionState
                }
                Spacer(minLength: 0)
            }
        }
    }

    private var accessibilityLayout: some View {
        VStack(alignment: .leading, spacing: 10) {
            sessionTitle
                .padding(.trailing, 36)
            participantContext
            attentionState
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                relativeTime
                forkState
                unreadState
            }
        }
    }

    @ViewBuilder
    private var forkState: some View {
        if session.originSessionID != nil {
            Label(appLanguage.text("Fork"), systemImage: "arrow.triangle.branch")
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
        }
    }

    @ViewBuilder
    private var unreadState: some View {
        if session.isUnread {
            Text(verbatim: "·").font(.caption).foregroundStyle(Color.tsMutedInk)
                .accessibilityHidden(true)
            Text(appLanguage.text("Unread"))
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
        }
    }

    private var sessionTitle: some View {
        Text(session.displayTitle(in: appLanguage))
            .font(.body.weight(session.isUnread ? .semibold : .medium))
            .foregroundStyle(Color.tsInk)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var relativeTime: some View {
        Text(
            session.updatedAt.formatted(
                .relative(presentation: .numeric, unitsStyle: .abbreviated)
            )
        )
        .font(.caption)
        .foregroundStyle(Color.tsMutedInk)
        .fixedSize()
    }

    private var participantContext: some View {
        Text(dynamicTypeSize.isAccessibilitySize && !session.isUnresolvedIntent && !session.isIdentityReview
            ? "\(session.personDisplayLabel)\n\(session.displayContextLabel(in: appLanguage))"
            : participantContextLabel)
            .font(.subheadline)
            .foregroundStyle(Color.tsMutedInk)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
            .fixedSize(
                horizontal: false,
                vertical: dynamicTypeSize.isAccessibilitySize
            )
            .accessibilityIdentifier(
                "agent-session-summary-\(session.id.uuidString)"
            )
    }

    @ViewBuilder
    private var attentionState: some View {
        if let attention = session.retrievalAttention {
            switch attention {
            case .needsJudgment:
                Label(
                    appLanguage.text("Review needed"),
                    systemImage: "circle.dotted"
                )
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.tsVermilion)
                .labelStyle(RelationshipRetrievalMetadataLabelStyle())
            case .waitingToContinue:
                Label(
                    appLanguage.text("Waiting to continue"),
                    systemImage: "clock"
                )
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.tsMutedInk)
            case .refreshNeeded:
                Label(
                    appLanguage.text("Refresh needed"),
                    systemImage: "clock.arrow.trianglehead.counterclockwise.rotate.90"
                )
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.tsMutedInk)
            }
        }
    }

    private var participantContextLabel: String {
        if session.isUnresolvedIntent {
            return session.displayContextLabel(in: appLanguage)
        }
        if session.isIdentityReview {
            return session.personDisplayLabel
        }
        return "\(session.personDisplayLabel) · \(session.displayContextLabel(in: appLanguage))"
    }

    private var attentionAccessibilityLabel: String? {
        guard let attention = session.retrievalAttention else { return nil }
        switch attention {
        case .needsJudgment: return appLanguage.text("Review needed")
        case .waitingToContinue: return appLanguage.text("Waiting to continue")
        case .refreshNeeded: return appLanguage.text("Refresh needed")
        }
    }

    private var sessionAccessibilityLabel: String {
        [
            session.displayTitle(in: appLanguage),
            session.originSessionID != nil ? appLanguage.text("Forked Session") : nil,
            participantContextLabel,
            session.updatedAt.formatted(.relative(presentation: .numeric, unitsStyle: .abbreviated)),
            attentionAccessibilityLabel,
            session.isUnread ? appLanguage.text("Unread") : appLanguage.text("Read session"),
        ]
        .compactMap { $0 }
        .joined(separator: ", ")
    }
}

private struct PursuitListView: View {
    let snapshot: PursuitWorkspaceSnapshot
    let isPreview: Bool
    let onSelect: (WorkspacePursuit) -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                RelationshipPageIntro(
                    eyebrow: appLanguage.text(
                        "Outcome rooms · \(snapshot.pursuits.count)",
                        zhHans: "目标空间 · \(snapshot.pursuits.count)"
                    ),
                    title: appLanguage.text("Pursuits", zhHans: "目标"),
                    summary: appLanguage.text(
                        "Each room keeps one outcome, its current gap, and owned action together.",
                        zhHans: "每个空间将一个目标结果、当前缺口与已负责行动集中呈现。"
                    )
                )
                .padding(.bottom, 24)
                if isPreview { PursuitPreviewBoundary() }
                ForEach(snapshot.pursuits) { pursuit in
                    Button { onSelect(pursuit) } label: {
                        PursuitListRow(
                            pursuit: pursuit,
                            pendingReviewCount: snapshot.openProposals.filter {
                                $0.pursuitID == pursuit.id
                            }.count
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("pursuit-row-\(pursuit.id)")
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 24)
            .padding(.bottom, 28)
        }
        .scrollIndicators(.hidden)
        .accessibilityIdentifier("pursuit-list")
    }
}

private struct PursuitListRow: View {
    let pursuit: WorkspacePursuit
    let pendingReviewCount: Int
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                RelationshipEyebrow(pursuit.status.humanized)
                Spacer()
                Text(
                    appLanguage.text(
                        "Rev \(pursuit.revision)",
                        zhHans: "版本 \(pursuit.revision)"
                    )
                )
                    .font(.caption2)
                    .foregroundStyle(Color.tsMutedInk)
            }
            Text(pursuit.title)
                .font(.custom("Georgia", size: 21, relativeTo: .headline))
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
            Text(
                appLanguage.text(
                    "Target outcome: \(pursuit.targetOutcome.workspacePhrase)",
                    zhHans: "目标结果：\(pursuit.targetOutcome.workspacePhrase)"
                )
            )
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 12) {
                Label(pursuit.milestone.humanized, systemImage: "flag")
                Label(
                    appLanguage.text(
                        "\(pursuit.openGapCount) gaps",
                        zhHans: "\(pursuit.openGapCount) 个缺口"
                    ),
                    systemImage: "questionmark.circle"
                )
                if pendingReviewCount > 0 {
                    Label(
                        appLanguage.text(
                            "\(pendingReviewCount) review",
                            zhHans: "\(pendingReviewCount) 项待审阅"
                        ),
                        systemImage: "checklist"
                    )
                }
            }
            .font(.caption)
            .foregroundStyle(Color.tsMutedInk)
        }
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) { Divider().overlay(Color.tsLine) }
    }
}

struct WorkspacePeopleView: View {
    let snapshot: PursuitWorkspaceSnapshot
    let isPreview: Bool
    let restorationPosition: String?
    @Binding var scrollPosition: String?
    let onSelect: (WorkspacePerson) -> Void
    let onAsk: (WorkspacePerson) -> Void
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.workspaceCardDensity) private var cardDensity
    @State private var isRestoringScroll = false
    @State private var scrollViewport: CGRect = .zero
    @State private var searchText = ""
    @State private var selectedScope: WorkspacePeopleScope = .all

    var body: some View {
        VStack(spacing: 0) {
            RelationshipRetrievalIndex(
                count: filteredPeople.count,
                noun: appLanguage.text(filteredPeople.count == 1 ? "person" : "people"),
                isPreview: isPreview
            )
            .dynamicTypeSize(...DynamicTypeSize.accessibility1)
            peopleList
        }
        .safeAreaInset(edge: .top, spacing: 0) { retrievalRail }
        .background(Color.tsSurface)
        .background(alignment: .topLeading) {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityLabel(appLanguage.text("People"))
                .accessibilityIdentifier("relationship-people")
        }
    }

    private var retrievalRail: some View {
        VStack(spacing: 2) {
            HStack(spacing: 10) {
                RelationshipRetrievalSearchField(
                    placeholder: appLanguage.text("Search people"),
                    identifier: "people", text: $searchText
                )
                scopeMenu
            }
            if selectedScope != .all {
                RelationshipRetrievalSelection(
                    title: selectedScope.displayLabel(in: appLanguage),
                    identifier: "people-filter-clear"
                ) { selectedScope = .all }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .background(Color.tsSurface)
    }

    private var scopeMenu: some View {
        Menu {
            Button {
                selectedScope = .all
            } label: {
                scopeMenuItem(
                    title: appLanguage.text("All people"),
                    isSelected: selectedScope == .all
                )
            }
            .accessibilityIdentifier("people-filter-all")

            if !snapshot.pursuits.isEmpty {
                Section(appLanguage.text("Pursuits")) {
                    ForEach(snapshot.pursuits) { pursuit in
                        let scope = WorkspacePeopleScope.pursuit(
                            id: pursuit.id,
                            title: pursuit.title
                        )
                        Button { selectedScope = scope } label: {
                            scopeMenuItem(
                                title: pursuit.title,
                                isSelected: selectedScope == scope
                            )
                        }
                        .accessibilityIdentifier(
                            "people-filter-pursuit-\(pursuit.id)"
                        )
                    }
                }
            }

            if WorkspacePeopleRetrievalPolicy.hasUnassignedPeople(in: snapshot) {
                Button { selectedScope = .unassigned } label: {
                    scopeMenuItem(
                        title: appLanguage.text("Not in a Pursuit"),
                        isSelected: selectedScope == .unassigned
                    )
                }
                .accessibilityIdentifier("people-filter-unassigned")
            }
        } label: {
            RelationshipRetrievalFilterLabel(isActive: selectedScope != .all)
        }
        .accessibilityLabel(
            "\(appLanguage.text("Filter people")), \(selectedScope.displayLabel(in: appLanguage))"
        )
        .accessibilityIdentifier("people-filter-menu")
    }

    @ViewBuilder
    private func scopeMenuItem(title: String, isSelected: Bool) -> some View {
        if isSelected {
            Label(title, systemImage: "checkmark")
        } else {
            Text(title)
        }
    }

    private var filteredPeople: [WorkspacePerson] {
        WorkspacePeopleRetrievalPolicy.filteredPeople(
            in: snapshot,
            query: searchText,
            scope: selectedScope,
            language: appLanguage
        )
    }

    private var peopleList: some View {
        ScrollViewReader { proxy in
            peopleListContent
                .onAppear {
                    guard let restorationPosition else { return }
                    isRestoringScroll = true
                    DispatchQueue.main.async {
                        withAnimation(nil) {
                            proxy.scrollTo(restorationPosition, anchor: .top)
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                            scrollPosition = restorationPosition
                            isRestoringScroll = false
                        }
                    }
                }
        }
    }

    private var peopleListContent: some View {
        List {
                if filteredPeople.isEmpty {
                    noMatchesView
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(
                            EdgeInsets(top: 18, leading: 16, bottom: 8, trailing: 16)
                        )
                }
                ForEach(filteredPeople) { person in
                    ZStack(alignment: .topTrailing) {
                        Button { onSelect(person) } label: {
                            WorkspacePersonRow(
                                person: person,
                                metadata: WorkspacePeopleRetrievalPolicy.metadata(
                                    for: person,
                                    in: snapshot,
                                    scope: selectedScope
                                )
                            )
                        }
                        .buttonStyle(RelationshipRetrievalButtonStyle())
                        .accessibilityIdentifier("workspace-person-\(person.id)")

                        Menu {
                            personActions(for: person)
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 17, weight: .regular))
                                .foregroundStyle(Color.tsMutedInk)
                                .frame(width: 44, height: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .padding(.trailing, 6)
                        .padding(.top, 8)
                        .accessibilityLabel(
                            appLanguage.text("More person actions")
                        )
                        .accessibilityIdentifier("person-actions-\(person.id)")
                    }
                    .modifier(RelationshipRowAnchor(
                        id: person.id,
                        viewport: scrollViewport
                    ))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(
                        EdgeInsets(
                            top: cardDensity.rowVerticalInset + 1,
                            leading: 16,
                            bottom: cardDensity.rowVerticalInset + 1,
                            trailing: 16
                        )
                    )
                    .contextMenu {
                        personActions(for: person)
                    }
                    .accessibilityAction(
                        named: Text(appLanguage.text("Open person"))
                    ) {
                        onSelect(person)
                    }
                    .accessibilityAction(
                        named: Text(
                            appLanguage.text("Ask about this person")
                        )
                    ) {
                        onAsk(person)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.tsSurface)
            .relationshipContentBounce()
            .scrollDismissesKeyboard(.interactively)
            .retrievalScrollEdge()
            .coordinateSpace(name: Self.scrollCoordinateSpace)
            .onGeometryChange(for: CGRect.self) { geometry in
                geometry.relationshipScrollViewport
            } action: { scrollViewport = $0 }
            .accessibilityIdentifier("workspace-people-list")
            .onPreferenceChange(RelationshipRowAnchorKey<String>.self) { candidates in
                guard !isRestoringScroll else { return }
                let anchor = filteredPeople.first { candidates.fullyVisible.contains($0.id) }?.id
                    ?? filteredPeople.first { candidates.partiallyVisible.contains($0.id) }?.id
                if let anchor, anchor != scrollPosition {
                    scrollPosition = anchor
                }
            }
    }

    @ViewBuilder
    private func personActions(for person: WorkspacePerson) -> some View {
        Button {
            onSelect(person)
        } label: {
            Label(
                appLanguage.text("Open person"),
                systemImage: "person.crop.circle"
            )
        }
        Button {
            onAsk(person)
        } label: {
            Label(
                appLanguage.text("Ask about this person"),
                systemImage: "bubble.left.and.text.bubble.right"
            )
        }
    }

    private static let scrollCoordinateSpace = "relationship-people-viewport"

    private var noMatchesView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(appLanguage.text(snapshot.people.isEmpty ? "No people yet" : "No matching people"))
                .font(.headline)
                .foregroundStyle(Color.tsInk)
                .accessibilityIdentifier("people-no-matches")
            if !snapshot.people.isEmpty {
                Button {
                    searchText = ""
                    selectedScope = .all
                } label: {
                    Text(appLanguage.text("Clear search and filter"))
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 14)
                        .frame(minHeight: 44)
                        .background(Color.tsInk.opacity(0.045), in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.tsInk)
                .accessibilityIdentifier("people-filter-reset")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct WorkspacePersonRow: View {
    let person: WorkspacePerson
    let metadata: WorkspacePersonRetrievalMetadata
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.workspaceCardDensity) private var cardDensity

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                accessibilityLayout
            } else {
                compactLayout
            }
        }
        .modifier(RelationshipRetrievalSurface(isDirectory: true))
        .accessibilityElement(children: .combine)
    }

    private var compactLayout: some View {
        HStack(alignment: .top, spacing: 12) {
            WorkspacePersonAvatar(person: person, size: cardDensity.personAvatarSize + 8)
                .padding(.top, 2)
            metadataStack
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var accessibilityLayout: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(person.displayLabel)
                .font(.headline)
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.trailing, 36)
            if let headline = metadata.headline {
                Text(headline)
                    .font(.subheadline)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("workspace-person-headline-\(person.id)")
            }
            roleAndPursuit
            activityTime
        }
    }

    private var metadataStack: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(person.displayLabel)
                .font(.headline)
                .foregroundStyle(Color.tsInk)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.trailing, 36)
            if let headline = metadata.headline {
                Text(headline)
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("workspace-person-headline-\(person.id)")
            }
            if let pursuitTitle = metadata.pursuitTitle {
                Text(pursuitTitle)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityHidden(true)
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let role = metadata.roleType {
                    Text(appLanguage.text(role.humanized))
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                }
                if metadata.roleType != nil, metadata.lastActivityAt != nil {
                    Text(verbatim: "·").font(.caption).foregroundStyle(Color.tsMutedInk)
                        .accessibilityHidden(true)
                }
                activityTime
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel([metadata.roleType.map { appLanguage.text($0.humanized) }, metadata.pursuitTitle,
                metadata.lastActivityAt?.formatted(.relative(presentation: .numeric, unitsStyle: .abbreviated))]
                .compactMap { $0 }.joined(separator: " · "))
            .accessibilityIdentifier("workspace-person-context-\(person.id)")
        }
        .layoutPriority(1)
    }

    @ViewBuilder
    private var roleAndPursuit: some View {
        let values = [metadata.roleType.map { appLanguage.text($0.humanized) }, metadata.pursuitTitle].compactMap { $0 }
        if !values.isEmpty {
            Text(values.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(values.joined(separator: " · "))
                .accessibilityIdentifier("workspace-person-context-\(person.id)")
        }
    }

    @ViewBuilder
    private var activityTime: some View {
        if let lastActivityAt = metadata.lastActivityAt {
            Text(
                lastActivityAt.formatted(
                    .relative(presentation: .numeric, unitsStyle: .abbreviated)
                )
            )
            .font(.caption2)
            .foregroundStyle(Color.tsMutedInk)
            .fixedSize()
            .accessibilityIdentifier("workspace-person-activity-\(person.id)")
        }
    }

}

private struct WorkspacePersonAvatar: View {
    let person: WorkspacePerson
    let size: CGFloat

    private var avatarURL: URL? {
        guard let value = person.avatar?.url,
              let url = URL(string: value),
              url.scheme?.lowercased() == "https",
              url.host != nil else { return nil }
        return url
    }

    var body: some View {
        Group {
            if let avatarURL {
                AsyncImage(url: avatarURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initials
                }
                .frame(width: size, height: size)
                .clipShape(Circle())
                .overlay { Circle().stroke(Color.tsLine, lineWidth: 1) }
            } else {
                initials
            }
        }
        .accessibilityHidden(true)
    }

    private var initials: some View {
        let words = person.displayLabel.split(whereSeparator: \.isWhitespace)
        let letters = words.count > 1
            ? words.prefix(2).compactMap(\.first).map(String.init).joined()
            : String(person.displayLabel.prefix(2))
        return Text(letters.uppercased())
            .font(.system(size: size * 0.34, weight: .medium, design: .rounded))
            .foregroundStyle(Color.tsMutedInk)
            .frame(width: size, height: size)
            .background(Color.tsInk.opacity(0.055), in: Circle())
    }
}

private struct RelationshipRowAnchorCandidates<ID: Hashable>: Equatable {
    var fullyVisible: Set<ID> = []
    var partiallyVisible: Set<ID> = []
}

private struct RelationshipRowAnchorKey<ID: Hashable>: PreferenceKey {
    static var defaultValue: RelationshipRowAnchorCandidates<ID> { .init() }

    static func reduce(
        value: inout RelationshipRowAnchorCandidates<ID>,
        nextValue: () -> RelationshipRowAnchorCandidates<ID>
    ) {
        let next = nextValue()
        value.fullyVisible.formUnion(next.fullyVisible)
        value.partiallyVisible.formUnion(next.partiallyVisible)
    }
}

private struct RelationshipRowAnchor<ID: Hashable>: ViewModifier {
    let id: ID
    let viewport: CGRect
    @State private var visibility = Visibility.hidden

    private enum Visibility: Equatable {
        case hidden, partial, full
    }

    func body(content: Content) -> some View {
        content
            // Transform continuous geometry into edge crossings before touching
            // SwiftUI state. Pixel offsets never propagate through the shell.
            .onGeometryChange(for: Visibility.self) { geometry in
                // UIKit-backed List cells and their viewport must share a
                // coordinate system, including safe-area and pager offsets.
                let row = geometry.frame(in: .global)
                guard viewport.width > 0, viewport.height > 0,
                      row.intersects(viewport) else { return .hidden }
                return viewport.contains(row) ? .full : .partial
            } action: { visibility = $0 }
            .preference(
                key: RelationshipRowAnchorKey<ID>.self,
                value: RelationshipRowAnchorCandidates(
                    fullyVisible: visibility == .full ? [id] : [],
                    partiallyVisible: visibility == .partial ? [id] : []
                )
            )
    }
}

private extension GeometryProxy {
    var relationshipScrollViewport: CGRect {
        let bounds = frame(in: .global)
        return CGRect(
            x: bounds.minX + safeAreaInsets.leading,
            y: bounds.minY + safeAreaInsets.top,
            width: max(0, bounds.width - safeAreaInsets.leading - safeAreaInsets.trailing),
            height: max(0, bounds.height - safeAreaInsets.top - safeAreaInsets.bottom)
        )
    }
}

extension View {
    @ViewBuilder
    func relationshipContentBounce() -> some View {
        if #available(iOS 16.4, *) {
            scrollBounceBehavior(.basedOnSize, axes: .vertical)
        } else {
            self
        }
    }
}

private struct RelationshipRetrievalButtonStyle: ButtonStyle {
    @Environment(\.talentSignalReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(
                reduceMotion ? nil : .easeOut(duration: 0.1),
                value: configuration.isPressed
            )
    }
}

private struct PursuitPreviewBoundary: View {
    var compact = false
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        Label(
            appLanguage.text(
                compact
                    ? "Synthetic preview"
                    : "Synthetic preview · canonical backend not connected",
                zhHans: compact
                    ? "合成预览"
                    : "合成预览 · 尚未连接权威后端"
            ),
            systemImage: "eye.trianglebadge.exclamationmark"
        )
        .font((compact ? Font.caption2 : Font.caption).weight(.semibold))
        .foregroundStyle(Color.tsMutedInk)
        .padding(.vertical, compact ? 0 : 12)
        .frame(maxWidth: compact ? nil : .infinity, alignment: .leading)
        .overlay(alignment: .top) {
            if !compact {
                Rectangle()
                    .fill(Color.tsLine)
                    .frame(height: 1)
            }
        }
        .overlay(alignment: .bottom) {
            if !compact {
                Rectangle()
                    .fill(Color.tsLine)
                    .frame(height: 1)
            }
        }
        .accessibilityIdentifier("workspace-preview-boundary")
    }
}

private struct PursuitNoActionView: View {
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        Label(appLanguage.text("Nothing needs attention"), systemImage: "checkmark.circle")
            .font(.headline)
            .foregroundStyle(Color.tsMutedInk)
            .padding(.vertical, 20)
            .accessibilityIdentifier("today-no-action")
    }
}

struct PursuitWorkspaceLoadingView: View {
    var isSynthetic = false
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(spacing: 14) {
            ProgressView()
            Text(isSynthetic ? appLanguage.text("Reading the synthetic workspace…") :
                appLanguage.text(
                    "Reading canonical Pursuits…",
                    zhHans: "正在读取权威目标…"
                )
            )
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
            Text(isSynthetic ? appLanguage.text("Only the isolated fixture transport is used for this read.") :
                appLanguage.text(
                    "No preview facts are shown while this read is unresolved.",
                    zhHans: "读取尚未完成时，不会展示任何预览事实。"
                )
            )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("workspace-loading")
    }
}

struct PursuitWorkspaceFailureView: View {
    let message: String
    let isRetrying: Bool
    let completedReadCount: Int
    var isSynthetic = false
    let retry: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            RelationshipEyebrow(
                appLanguage.text("Read failed", zhHans: "读取失败")
            )
            Text(isSynthetic ? appLanguage.text("Synthetic workspace unavailable") :
                appLanguage.text(
                    "Canonical workspace unavailable",
                    zhHans: "权威工作区不可用"
                )
            )
                .font(.custom("Georgia", size: 28, relativeTo: .title2))
                .foregroundStyle(Color.tsInk)
                .accessibilityIdentifier("workspace-failed")
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
            Text(isSynthetic ? appLanguage.text("No partial fixture response is substituted for a verified read.") :
                appLanguage.text(
                    "No cached or synthetic candidate facts are being substituted.",
                    zhHans: "不会用缓存或合成的候选人事实替代当前状态。"
                )
            )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
            Text(isSynthetic ? appLanguage.text("Inspect the synthetic error, then retry this fixture.") :
                completedReadCount > 1
                    ? appLanguage.text(
                        "Last retry finished · canonical state is still unavailable.",
                        zhHans: "上次重试已结束 · 权威状态仍不可用。"
                    )
                    : appLanguage.text(
                        "Initial read finished · canonical state is unavailable.",
                        zhHans: "首次读取已结束 · 权威状态不可用。"
                    )
            )
                .font(.caption2)
                .foregroundStyle(Color.tsMutedInk.opacity(0.82))
                .accessibilityIdentifier(
                    "workspace-failed-attempt-\(completedReadCount)"
                )
            if isRetrying {
                HStack(spacing: 10) {
                    ProgressView()
                    Text(isSynthetic ? appLanguage.text("Retrying the synthetic read…") :
                        appLanguage.text(
                            "Retrying canonical read…",
                            zhHans: "正在重试权威读取…"
                        )
                    )
                        .font(.subheadline.weight(.semibold))
                }
                .frame(minHeight: 44)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("workspace-retrying")
            } else {
                Button(action: retry) {
                    Text(appLanguage.text("Retry read", zhHans: "重新读取"))
                        .font(.subheadline.weight(.semibold))
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }.accessibilityIdentifier("retry-workspace-read")
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }
}

struct PursuitWorkspaceEmptyView: View {
    let selectedPage: RelationshipArchivePage
    let pendingCaptureCount: Int
    let onOpenCaptureInbox: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    init(
        selectedPage: RelationshipArchivePage,
        pendingCaptureCount: Int = 0,
        onOpenCaptureInbox: @escaping () -> Void = {}
    ) {
        self.selectedPage = selectedPage
        self.pendingCaptureCount = pendingCaptureCount
        self.onOpenCaptureInbox = onOpenCaptureInbox
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            RelationshipEyebrow(
                appLanguage.text(
                    "Canonical workspace",
                    zhHans: "权威工作区"
                )
            )
            Text(
                emptyTitle
            )
                .font(.custom("Georgia", size: 31, relativeTo: .title2))
                .foregroundStyle(Color.tsInk)
            Text(
                appLanguage.text(
                    "Capture can preserve a Signal, but it will not invent an identity or Pursuit.",
                    zhHans: "捕捉可以保留信号，但不会凭空创建身份或目标。"
                )
            )
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
            if selectedPage == .today, pendingCaptureCount > 0 {
                TodayCaptureInboxRow(
                    count: pendingCaptureCount,
                    action: onOpenCaptureInbox
                )
                .padding(.top, 8)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityIdentifier("workspace-empty")
    }

    private var emptyTitle: String {
        switch selectedPage {
        case .today:
            return pendingCaptureCount > 0
                ? appLanguage.text(
                    "A capture decision is waiting"
                )
                : appLanguage.text("Nothing needs attention", zhHans: "暂无待处理事项")
        case .sessions:
            return appLanguage.text("No sessions yet", zhHans: "还没有会话")
        case .people:
            return appLanguage.text("No people yet", zhHans: "还没有人物")
        case .meetings:
            return appLanguage.text("No meetings yet")
        }
    }
}

struct PursuitDetailView: View {
    @State private var pursuit: WorkspacePursuit
    let snapshot: PursuitWorkspaceSnapshot?
    let currentUserID: String?
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    let targetActionID: String?
    let onOpenProposal: (WorkspaceProposal) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var completingActionID: String?

    init(
        pursuit: WorkspacePursuit,
        snapshot: PursuitWorkspaceSnapshot?,
        currentUserID: String?,
        workspaceStore: PursuitWorkspaceStore,
        targetActionID: String? = nil,
        onOpenProposal: @escaping (WorkspaceProposal) -> Void
    ) {
        _pursuit = State(initialValue: pursuit)
        self.snapshot = snapshot
        self.currentUserID = currentUserID
        self.workspaceStore = workspaceStore
        self.targetActionID = targetActionID
        self.onOpenProposal = onOpenProposal
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                    RelationshipEyebrow("\(pursuit.status.humanized) · revision \(pursuit.revision)")
                        .padding(.top, 26)
                    Text(pursuit.title)
                        .font(.custom("Georgia", size: 36, relativeTo: .largeTitle))
                        .foregroundStyle(Color.tsInk)
                        .tracking(-0.8)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 10)
                    Text("Target outcome: \(pursuit.targetOutcome.workspacePhrase)")
                        .font(.body)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)

                    PursuitDefinitionSection(
                        title: "Current frame",
                        rows: [
                            ("Milestone", pursuit.milestone.humanized),
                            (
                                "Milestone authority",
                                "\(pursuit.milestoneAuthority.kind.humanized) · \(pursuit.milestoneAuthority.evidenceState.attentionLabel)"
                            ),
                            (
                                "Confirmed",
                                milestoneConfirmationSummary
                            ),
                            ("Target date", WorkspaceDate.short(pursuit.targetDate)),
                            ("Type", pursuit.type.humanized),
                        ]
                    )

                    if ["partial", "unavailable"].contains(
                        pursuit.milestoneAuthority.evidenceState.availability
                    ) {
                        VStack(alignment: .leading, spacing: 8) {
                            Label(
                                "Milestone source authority changed",
                                systemImage: "exclamationmark.shield"
                            )
                            .font(.headline)
                            .foregroundStyle(Color.tsVermilion)
                            Text(
                                "The recruiter-confirmed decision and revision remain in history, but \(pursuit.milestoneAuthority.evidenceState.explanation.lowercased()). Review or correct the milestone before treating it as current evidence-backed truth."
                            )
                            .font(.subheadline)
                            .foregroundStyle(Color.tsMutedInk)
                            .fixedSize(horizontal: false, vertical: true)
                            if let receiptID = pursuit.milestoneAuthority.receiptID {
                                Text("Decision receipt \(receiptID.prefix(8))")
                                    .font(.caption)
                                    .foregroundStyle(Color.tsMutedInk)
                            }
                        }
                        .padding(14)
                        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 14))
                        .padding(.top, 16)
                        .accessibilityIdentifier("milestone-authority-warning")
                    }

                    if !pendingProposals.isEmpty {
                        RelationshipEyebrow("Waiting for review")
                            .padding(.top, 30)
                        ForEach(pendingProposals) { proposal in
                            Button { onOpenProposal(proposal) } label: {
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(proposal.summary)
                                        .font(.headline)
                                        .foregroundStyle(Color.tsInk)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Text("\(proposal.subjectDisplayLabel) · \(proposal.status.humanized) · base revision \(proposal.baseRevision)")
                                        .font(.caption)
                                        .foregroundStyle(Color.tsMutedInk)
                                }
                                .padding(.vertical, 16)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .overlay(alignment: .bottom) { Divider().overlay(Color.tsLine) }
                            .accessibilityIdentifier("pursuit-proposal-\(proposal.id)")
                        }
                    }

                    if !staleProposals.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Label(
                                "Proposal is out of date",
                                systemImage: "clock.badge.exclamationmark"
                            )
                            .font(.headline)
                            .foregroundStyle(Color.tsVermilion)
                            Text(
                                "This Pursuit is now revision \(currentPursuitRevision). An older Proposal cannot be reviewed and has no execution authority. Current workspace readback will replace it."
                            )
                            .font(.subheadline)
                            .foregroundStyle(Color.tsMutedInk)
                            .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(14)
                        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 14))
                        .padding(.top, 24)
                        .accessibilityIdentifier("pursuit-stale-proposal")
                    }

                    RelationshipEyebrow("Open gaps")
                        .padding(.top, 30)
                    if pursuit.gaps.filter({ $0.status == "open" }).isEmpty {
                        Text("No open gap is recorded.")
                            .font(.subheadline)
                            .foregroundStyle(Color.tsMutedInk)
                            .padding(.top, 12)
                    } else {
                        ForEach(pursuit.gaps.filter { $0.status == "open" }) { gap in
                            VStack(alignment: .leading, spacing: 7) {
                                Text(gap.title)
                                    .font(.headline)
                                    .foregroundStyle(Color.tsInk)
                                Text("\(gap.basis.temporalAuthorityLabel) · \(gap.basis.evidenceState.attentionLabel)")
                                    .font(.caption)
                                    .foregroundStyle(
                                        gap.basis.evidenceState.availability == "available"
                                            ? Color.tsMutedInk
                                            : Color.tsVermilion
                                    )
                                Text(gap.basis.evidenceState.explanation)
                                    .font(.caption2)
                                    .foregroundStyle(Color.tsMutedInk)
                                Text(gap.basis.summary)
                                    .font(.subheadline)
                                    .foregroundStyle(Color.tsMutedInk)
                                Text("Close when: \(gap.closeCondition)")
                                    .font(.caption)
                                    .foregroundStyle(Color.tsMutedInk)
                            }
                            .padding(.vertical, 16)
                            .overlay(alignment: .bottom) { Divider().overlay(Color.tsLine) }
                        }
                    }

                    RelationshipEyebrow("Owned internal actions")
                        .padding(.top, 30)
                    if let completion = recordedActionCompletion {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("Observed outcome recorded", systemImage: "checkmark.seal")
                                .font(.headline)
                            Text(completion.action.title)
                                .font(.subheadline.weight(.semibold))
                            Text("Owner: \(completion.action.ownerDisplayName) · \(WorkspaceDate.recorded(at: completion.result.receipt.occurredAt, sourceTimezone: TimeZone.current.identifier))")
                                .font(.caption)
                                .foregroundStyle(Color.tsMutedInk)
                            Text("Canonical revision \(completion.result.receipt.entityRef.beforeRevision) → \(completion.result.receipt.entityRef.afterRevision)")
                                .font(.caption)
                                .foregroundStyle(Color.tsMutedInk)
                            DisclosureGroup("Audit details") {
                                Text("Operation \(completion.result.receipt.operationID.prefix(8)) · receipt \(completion.result.receipt.id.prefix(8))")
                                    .font(.caption2)
                                    .foregroundStyle(Color.tsMutedInk)
                            }
                            Label("No message, calendar event, or external write", systemImage: "lock.shield")
                                .font(.caption)
                                .foregroundStyle(Color.tsMutedInk)
                        }
                        .padding(14)
                        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 14))
                        .accessibilityIdentifier("pursuit-action-completion-receipt")
                    }
                    if pursuit.actions.isEmpty {
                        Text("No action is recorded.")
                            .font(.subheadline)
                            .foregroundStyle(Color.tsMutedInk)
                            .padding(.top, 12)
                    } else {
                        ForEach(pursuit.actions) { action in
                            VStack(alignment: .leading, spacing: 7) {
                                if action.id == targetActionID {
                                    Label(
                                        "Referenced in Ask",
                                        systemImage: "arrow.down.right.circle.fill"
                                    )
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Color.tsVermilion)
                                    .accessibilityIdentifier(
                                        "pursuit-target-action-\(action.id)"
                                    )
                                }
                                Text(action.title)
                                    .font(.headline)
                                    .foregroundStyle(Color.tsInk)
                                Text("\(action.status.humanized) · \(action.dueAt.map(WorkspaceDate.short) ?? "no due date")")
                                    .font(.caption)
                                    .foregroundStyle(Color.tsMutedInk)
                                Text("Owner: \(action.ownerDisplayName)")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Color.tsInk)
                                    .accessibilityIdentifier("pursuit-action-owner-\(action.id)")
                                if let outcome = action.outcomeSummary,
                                   let completedAt = action.completedAt {
                                    Text("Observed outcome: \(outcome)")
                                        .font(.subheadline)
                                        .foregroundStyle(Color.tsInk)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Text(WorkspaceDate.recorded(at: completedAt, sourceTimezone: TimeZone.current.identifier))
                                        .font(.caption2)
                                        .foregroundStyle(Color.tsMutedInk)
                                }
                                Label(
                                    action.externalEffects.isEmpty
                                        ? "No message, calendar event, or external write"
                                        : "External effect requires separate verification",
                                    systemImage: "lock.shield"
                                )
                                .font(.caption)
                                .foregroundStyle(Color.tsMutedInk)

                                if !["completed", "cancelled"].contains(action.status),
                                   action.ownerUserID == currentUserID {
                                    if completingActionID == action.id {
                                        actionCompletionControls(for: action)
                                    } else {
                                        Button("Record observed outcome") {
                                            completingActionID = action.id
                                            Task {
                                                await workspaceStore.prepareActionCompletion(
                                                    pursuit: pursuit,
                                                    action: action
                                                )
                                                syncRecordedAction()
                                            }
                                        }
                                        .font(.subheadline.weight(.semibold))
                                        .frame(minHeight: 44)
                                        .accessibilityIdentifier("open-pursuit-action-completion-\(action.id)")
                                    }
                                }
                            }
                            .padding(.vertical, 16)
                            .padding(.horizontal, action.id == targetActionID ? 12 : 0)
                            .background(
                                action.id == targetActionID
                                    ? Color.tsCanvas
                                    : Color.clear,
                                in: RoundedRectangle(cornerRadius: 14)
                            )
                            .overlay {
                                if action.id == targetActionID {
                                    RoundedRectangle(cornerRadius: 14)
                                        .stroke(Color.tsVermilion.opacity(0.55), lineWidth: 1)
                                }
                            }
                            .overlay(alignment: .bottom) { Divider().overlay(Color.tsLine) }
                            .id(action.id)
                        }
                    }
                    }
                    .padding(.horizontal, 22)
                    .padding(.bottom, 40)
                }
                .background(Color.tsSurface.ignoresSafeArea())
                .navigationTitle("Pursuit")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Close", action: dismiss.callAsFunction)
                    }
                }
                .task {
                    if let targetActionID,
                       pursuit.actions.contains(where: { $0.id == targetActionID }) {
                        await Task.yield()
                        proxy.scrollTo(targetActionID, anchor: .center)
                    }
                    for action in pursuit.actions
                    where workspaceStore.hasSavedActionCompletion(actionID: action.id) {
                        completingActionID = action.id
                        await workspaceStore.prepareActionCompletion(
                            pursuit: pursuit,
                            action: action
                        )
                        syncRecordedAction()
                    }
                }
            }
        }
        .accessibilityIdentifier("pursuit-detail")
    }

    private var pendingProposals: [WorkspaceProposal] {
        workspaceStore.snapshot?.openProposals.filter {
            $0.pursuitID == pursuit.id
                && $0.baseRevision == currentPursuitRevision
        } ?? []
    }

    private var staleProposals: [WorkspaceProposal] {
        workspaceStore.snapshot?.openProposals.filter {
            $0.pursuitID == pursuit.id
                && $0.baseRevision != currentPursuitRevision
        } ?? []
    }

    private var currentPursuitRevision: Int {
        recordedActionCompletion?.result.pursuit.revision
            ?? workspaceStore.snapshot?.pursuit(id: pursuit.id)?.revision
            ?? pursuit.revision
    }

    private var milestoneConfirmationSummary: String {
        let actor: String
        if let confirmedBy = pursuit.milestoneAuthority.confirmedByUserID,
           confirmedBy == snapshot?.currentUserID {
            actor = snapshot?.currentUserName ?? "Current user"
        } else if pursuit.milestoneAuthority.confirmedByUserID != nil {
            actor = "Workspace member"
        } else {
            actor = "Actor unavailable"
        }
        let confirmation = pursuit.milestoneAuthority.confirmedAt.map {
            WorkspaceDate.recorded(
                at: $0,
                sourceTimezone: TimeZone.current.identifier
            )
        } ?? "Time unavailable"
        return "\(actor) · \(confirmation)"
    }

    private var recordedActionCompletion: (
        action: WorkspaceAction,
        result: PursuitActionCompletionResult
    )? {
        for action in pursuit.actions {
            if case let .recorded(result) = workspaceStore.actionCompletionPhase(
                actionID: action.id
            ), let canonicalAction = result.pursuit.actions.first(where: {
                $0.id == action.id
            }) {
                return (canonicalAction, result)
            }
        }
        return nil
    }

    @ViewBuilder
    private func actionCompletionControls(for action: WorkspaceAction) -> some View {
        let phase = workspaceStore.actionCompletionPhase(actionID: action.id)
        switch phase {
        case .confirming:
            Label(
                "Recording with one saved recovery reference. Success waits for canonical readback.",
                systemImage: "arrow.triangle.2.circlepath"
            )
            .font(.caption)
            .foregroundStyle(Color.tsMutedInk)
            .accessibilityIdentifier("pursuit-action-confirming")
        case let .unknownLocked(operationID):
            VStack(alignment: .leading, spacing: 10) {
                Label(
                    "Outcome unknown — operation locked",
                    systemImage: "exclamationmark.shield"
                )
                .font(.subheadline.weight(.semibold))
                Text("The saved recovery reference will be checked before another write is allowed.")
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                DisclosureGroup("Audit details") {
                    Text("Recovery reference \(operationID.uuidString.lowercased())")
                        .font(.caption2)
                        .foregroundStyle(Color.tsMutedInk)
                }
                Button("Check canonical result") {
                    Task {
                        await workspaceStore.reconcileActionCompletion(
                            actionID: action.id
                        )
                        syncRecordedAction()
                    }
                }
                .frame(minHeight: 44)
                .accessibilityIdentifier("reconcile-pursuit-action-\(action.id)")
            }
            .accessibilityIdentifier("pursuit-action-unknown-locked")
        case .recorded:
            EmptyView()
        case let .conflict(message), let .failed(message):
            completionEditor(for: action, message: message)
        case .idle, .editing:
            completionEditor(for: action, message: nil)
        }
    }

    private func completionEditor(
        for action: WorkspaceAction,
        message: String?
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Directly observed outcome")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsInk)
            TextField(
                "What was directly observed?",
                text: Binding(
                    get: {
                        workspaceStore.actionOutcomeDrafts[action.id] ?? ""
                    },
                    set: { value in
                        workspaceStore.updateActionOutcomeDraft(
                            pursuit: pursuit,
                            action: action,
                            value: value
                        )
                    }
                ),
                axis: .vertical
            )
            .textFieldStyle(.roundedBorder)
            .accessibilityIdentifier("pursuit-action-outcome-\(action.id)")
            if let message {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(Color.tsVermilion)
            }
            HStack(spacing: 12) {
                Button("Cancel") {
                    workspaceStore.cancelActionCompletion(actionID: action.id)
                    completingActionID = nil
                }
                .frame(minHeight: 44)
                Button("Record outcome") {
                    recordOutcome(for: action)
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    (workspaceStore.actionOutcomeDrafts[action.id] ?? "")
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                        .isEmpty
                )
                .accessibilityIdentifier("complete-pursuit-action-\(action.id)")
            }
        }
    }

    private func recordOutcome(for action: WorkspaceAction) {
        Task {
            await workspaceStore.submitActionCompletion(
                pursuit: pursuit,
                action: action
            )
            syncRecordedAction()
        }
    }

    private func syncRecordedAction() {
        guard let completingActionID,
              case let .recorded(result) = workspaceStore.actionCompletionPhase(
                actionID: completingActionID
              ) else { return }
        pursuit = result.pursuit
    }
}

private struct PursuitDefinitionSection: View {
    let title: String
    let rows: [(String, String)]

    var body: some View {
        VStack(spacing: 0) {
            RelationshipEyebrow(title)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 30)
                .padding(.bottom, 8)
            Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { entry in
                    let row = entry.element
                    let rowIdentifier = "definition-\(title.lowercased().replacingOccurrences(of: " ", with: "-"))-row-\(entry.offset)"
                    GridRow(alignment: .top) {
                        Text(row.0)
                            .font(.caption)
                            .foregroundStyle(Color.tsMutedInk)
                            .gridColumnAlignment(.leading)
                            .accessibilityIdentifier("\(rowIdentifier)-label")
                        Text(row.1)
                            .font(.subheadline)
                            .foregroundStyle(Color.tsInk)
                            .fixedSize(horizontal: false, vertical: true)
                            .gridColumnAlignment(.leading)
                            .accessibilityIdentifier("\(rowIdentifier)-value")
                    }
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .bottom) {
                        Divider().overlay(Color.tsLine)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct WorkspacePersonDetailView: View {
    let person: WorkspacePerson
    let roles: [WorkspacePersonRole]
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    @State private var sourceTasks: [ScreenshotContactTask] = []
    @State private var sourceError: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    RelationshipEyebrow(appLanguage.text("Stable person identity"))
                        .padding(.top, 26)
                    HStack(alignment: .center, spacing: 14) {
                        WorkspacePersonAvatar(person: person, size: 54)
                        Text(person.displayLabel)
                            .font(.custom("Georgia", size: 34, relativeTo: .largeTitle))
                            .foregroundStyle(Color.tsInk)
                            .tracking(-0.7)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 10)
                    Text(
                        appLanguage.text(
                            "Roles below are contextual. They do not redefine identity or rank this person."
                        )
                    )
                        .font(.body)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)

                    if let profile = person.profile {
                        RelationshipEyebrow(appLanguage.text("About"))
                            .padding(.top, 30)
                        Text(profile.headline)
                            .font(.headline)
                            .foregroundStyle(Color.tsInk)
                            .padding(.top, 12)
                        Text(profile.summary)
                            .font(.body)
                            .foregroundStyle(Color.tsInk)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 8)
                        Label(
                            profile.provenanceKind == "reviewed_public_source"
                                ? appLanguage.text("Confirmed from a reviewed public source")
                                : appLanguage.text("Written by the workspace owner"),
                            systemImage: profile.provenanceKind == "reviewed_public_source"
                                ? "link.badge.plus"
                                : "person.crop.circle.badge.checkmark"
                        )
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .padding(.top, 10)
                        if let sourceURL = profile.sourceProfileURL,
                           let url = URL(string: sourceURL),
                           url.scheme?.lowercased() == "https" {
                            Link(destination: url) {
                                Label(
                                    profile.sourcePlatform ?? appLanguage.text("Public source"),
                                    systemImage: "arrow.up.right.square"
                                )
                                .font(.caption.weight(.semibold))
                                .frame(minHeight: 44)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Color.tsInk)
                        }
                    }

                    if !sourceTasks.isEmpty {
                        RelationshipEyebrow(appLanguage.text("Conversation and sourced context"))
                            .padding(.top, 30)
                        ForEach(sourceTasks) { task in
                            ScreenshotContactCard(task: task, language: appLanguage,
                                onLoadImage: { index in try await workspaceStore.loadScreenshotContactImage(taskID: task.taskID, index: index) }).padding(.top, 16)
                        }
                    }
                    if let sourceError { Text(sourceError).font(.caption).foregroundStyle(Color.tsMutedInk).padding(.top, 16) }

                    RelationshipEyebrow(appLanguage.text("Pursuit roles"))
                        .padding(.top, 30)
                    if roles.isEmpty {
                        Text(appLanguage.text("No active Pursuit role is recorded."))
                            .font(.subheadline)
                            .foregroundStyle(Color.tsMutedInk)
                            .padding(.top, 12)
                    } else {
                        ForEach(roles) { role in
                            VStack(alignment: .leading, spacing: 7) {
                                Text(role.pursuitTitle)
                                    .font(.headline)
                                    .foregroundStyle(Color.tsInk)
                                Text("\(role.roleType.humanized) · \(role.status.humanized) · \(role.confidence.humanized)")
                                    .font(.caption)
                                    .foregroundStyle(Color.tsMutedInk)
                                Text(role.evidenceState.explanation)
                                    .font(.caption2)
                                    .foregroundStyle(
                                        role.evidenceState.availability == "unavailable"
                                            ? Color.tsVermilion
                                            : Color.tsMutedInk
                                    )
                            }
                            .padding(.vertical, 16)
                            .overlay(alignment: .bottom) { Divider().overlay(Color.tsLine) }
                        }
                    }

                    PursuitDefinitionSection(
                        title: appLanguage.text("Governed identity"),
                        rows: [
                            (appLanguage.text("Sources"), "\(person.captureCount)"),
                            (appLanguage.text("Identity clues"), "\(person.confirmedIdentityCount)"),
                            (appLanguage.text("Contexts"), "\(person.contextCount)"),
                        ]
                    )
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 40)
            }
            .background(Color.tsSurface.ignoresSafeArea())
            .navigationTitle(appLanguage.text("Person"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(appLanguage.text("Close"), action: dismiss.callAsFunction)
                }
            }
        }
        .accessibilityIdentifier("workspace-person-detail")
        .task(id: person.id) {
            guard workspaceStore.isCanonical else { return }
            do {
                var results: [ScreenshotContactTask] = []
                for context in person.contexts {
                    let envelope = try await workspaceStore.loadContactIntelligence(personID: person.id, contextID: context.id)
                    results.append(contentsOf: envelope.tasks)
                }
                sourceTasks = Array(results.prefix(20))
            } catch { sourceError = appLanguage.text("Source context could not be refreshed.") }
        }
    }
}

private struct RelationshipGuideRail: View {
    let onGuide: () -> Void
    let onAttach: () -> Void
    let onVoice: () -> Void
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.talentSignalReduceMotion) private var reduceMotion
    @State private var isHoldingForVoice = false
    @State private var voiceLongPressTriggered = false
    @State private var voiceHoldTask: Task<Void, Never>?

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onAttach) {
                ZStack {
                    Color.clear
                    Image(systemName: "plus")
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(Color.tsInk)
                }
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(width: 44, height: 44)
            .accessibilityLabel(
                appLanguage.text("Choose what to add to an Agent message")
            )
            .accessibilityIdentifier("open-agent-attachments")
            .accessibilityShowsLargeContentViewer {
                Label(appLanguage.text("Choose what to add to an Agent message"), systemImage: "plus")
            }

            Button {
                guard !voiceLongPressTriggered else { return }
                onGuide()
            } label: {
                HStack(spacing: 10) {
                    Text(
                        isHoldingForVoice
                            ? appLanguage.text(
                                "Keep holding for voice…"
                            )
                            : appLanguage.text("Ask anything", zhHans: "问点什么")
                    )
                    .font(.subheadline)
                    .foregroundStyle(
                        isHoldingForVoice ? Color.tsInk : Color.tsMutedInk
                    )
                    Spacer(minLength: 6)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.leading, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(
                isHoldingForVoice ? Color.tsSurfaceMuted.opacity(0.72) : Color.clear,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .scaleEffect(isHoldingForVoice && !reduceMotion ? 0.985 : 1)
            .animation(
                reduceMotion ? nil : .easeOut(duration: 0.12),
                value: isHoldingForVoice
            )
            .simultaneousGesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .local)
                    .onChanged { _ in beginVoiceHoldIfNeeded() }
                    .onEnded { _ in endVoiceHold() }
            )
            .accessibilityLabel(
                appLanguage.text("Open a new Agent session", zhHans: "打开新的 Agent 会话")
            )
            .accessibilityHint(
                appLanguage.text(
                    "Double tap to type. Touch and hold to start voice input."
                )
            )
            .accessibilityAction(
                named: Text(
                    appLanguage.text(
                        "Start voice input"
                    )
                )
            ) { onVoice() }
            // This control reserves touch-and-hold for voice input.
            .accessibilityIdentifier("relationship-guide")

            Button(action: onVoice) {
                ZStack {
                    Color.clear
                    Image(systemName: "waveform")
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(Color.tsInk)
                }
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(width: 44, height: 44)
            .accessibilityLabel(
                appLanguage.text(
                    "Dictate an Agent message",
                    zhHans: "用语音输入 Agent 消息"
                )
            )
            .accessibilityIdentifier("dictate-agent-message")
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 6)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .modifier(RelationshipGuideMaterialModifier())
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }

    private func beginVoice() {
        let generator = UIImpactFeedbackGenerator(style: .soft)
        generator.prepare()
        generator.impactOccurred()
        onVoice()
    }

    private func beginVoiceHoldIfNeeded() {
        guard voiceHoldTask == nil, !voiceLongPressTriggered else { return }
        isHoldingForVoice = true
        voiceHoldTask = Task { @MainActor in
            do {
                try await Task.sleep(for: .milliseconds(550))
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            voiceHoldTask = nil
            voiceLongPressTriggered = true
            beginVoice()
        }
    }

    private func endVoiceHold() {
        voiceHoldTask?.cancel()
        voiceHoldTask = nil
        isHoldingForVoice = false
        guard voiceLongPressTriggered else { return }
        Task { @MainActor in
            await Task.yield()
            voiceLongPressTriggered = false
        }
    }
}

private struct RelationshipGuideMaterialModifier: ViewModifier {
    @Environment(\.talentSignalReduceTransparency) private var reduceTransparency

    private var usesOpaqueSurface: Bool {
#if DEBUG
        reduceTransparency || ProcessInfo.processInfo.arguments.contains(
            "--simulate-reduce-transparency"
        )
#else
        reduceTransparency
#endif
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if usesOpaqueSurface {
            content
                .background(Color.tsCanvas, in: Capsule())
                .overlay {
                    Capsule().stroke(Color.tsLine, lineWidth: 1)
                }
        } else {
            content
                .background(.regularMaterial, in: Capsule())
                .overlay {
                    Capsule().stroke(Color.tsLine.opacity(0.5), lineWidth: 0.5)
                }
        }
    }
}

private extension View {
    // XcodeGen enables this condition only for iOS 27 device and Simulator SDKs.
    // Older SDKs must not parse the beta SwiftUI toolbar symbols.
    @ViewBuilder
    func relationshipNavigationMinimization() -> some View {
#if TS_IOS27_SDK
        if #available(iOS 27.0, *) {
            self
                .toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)
                .toolbarMinimizationRestoration(.automatic, for: .navigationBar)
        } else {
            self
        }
#else
        self
#endif
    }
}

private struct RelationshipPageIntro: View {
    let eyebrow: String
    let title: String
    let summary: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RelationshipEyebrow(eyebrow, color: .tsInk)
                .accessibilityIdentifier("workspace-page-eyebrow")
            Text(title)
                .font(.custom("Georgia", size: 52, relativeTo: .largeTitle))
                .foregroundStyle(Color.tsInk)
                .tracking(-1.8)
                .padding(.top, 8)
            Text(summary)
                .font(.body)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 9)
        }
    }
}

private struct RelationshipEyebrow: View {
    let text: String
    let color: Color

    init(_ text: String, color: Color = .tsVermilion) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text.uppercased())
            .font(.caption2.weight(.bold))
            .tracking(1.15)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct RelationshipInitials: View {
    let initials: String
    let size: CGFloat

    var body: some View {
        Text(initials)
            .font(.custom("Georgia", size: size * 0.32, relativeTo: .body))
            .foregroundStyle(Color.tsMutedInk)
            .frame(width: size, height: size)
            .background(Color.tsCanvas, in: Circle())
            .overlay { Circle().stroke(Color.tsLine, lineWidth: 1) }
            .accessibilityHidden(true)
    }
}

struct RelationshipSignalOrb: View {
    var body: some View {
        TalentSignalBrandMark()
    }
}

#Preview("Editorial Today") {
    RelationshipArchiveView()
}

extension String {
    var humanized: String {
        replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { word in
                guard let first = word.first else { return "" }
                return first.uppercased() + word.dropFirst()
            }
            .joined(separator: " ")
    }

    var workspacePhrase: String {
        contains("_") ? humanized : self
    }
}

private extension WorkspaceGap.Basis {
    var temporalAuthorityLabel: String {
        if kind == "evidence_supported", evidenceState.availability != "available" {
            return "Originally evidence-supported"
        }
        return kind.humanized
    }
}

/// Keeps the archive body type-checkable: one shared refresh registration for
/// the real open Agent Session or the directory-level Session list.
private struct AgentSessionActiveRefreshModifier: ViewModifier {
    let lease: AgentSessionActiveRefreshConsumer.Lease?
    let sessions: AgentSessionStore
    let people: PursuitWorkspaceStore?
    let syncService: @MainActor () -> (any AgentSessionSyncServing)?
    let isCanonical: @MainActor () -> Bool
    let isScopeCurrent: @MainActor () -> Bool
    @State private var consumer: AgentSessionActiveRefreshConsumer?
    @State private var registration: WorkspaceActiveRefresh.Registration?

    func body(content: Content) -> some View {
        content
            .task(id: lease) {
                release()
                guard let lease else { return }
                let consumer = AgentSessionActiveRefreshConsumer(
                    lease: lease,
                    sessions: sessions,
                    people: people,
                    syncService: syncService,
                    isCanonical: isCanonical,
                    isScopeCurrent: isScopeCurrent
                )
                self.consumer = consumer
                registration = WorkspaceActiveRefresh.shared.register(
                    scope: consumer.registryScope
                ) { generation in
                    await consumer.refresh(generation: generation)
                }
            }
            .onDisappear { release() }
    }

    private func release() {
        if let registration {
            WorkspaceActiveRefresh.shared.unregister(registration)
            self.registration = nil
        }
        consumer?.release()
        consumer = nil
    }
}
