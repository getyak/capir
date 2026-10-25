import AppIntents
import Foundation
import SwiftUI

@main
struct TalentSignalApp: App {
    @UIApplicationDelegateAdaptor(CaptureUploadAppDelegate.self) private var captureUploadDelegate
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(AppLanguage.storageKey) private var storedLanguage =
        AppLanguage.system.rawValue
    @AppStorage(WorkspaceTextSizePreference.storageKey)
    private var storedTextSize = WorkspaceTextSizePreference.system.rawValue
    @AppStorage(WorkspaceCardDensityPreference.storageKey)
    private var storedCardDensity = WorkspaceCardDensityPreference.compact.rawValue
    @StateObject private var appSessionStore: AppSessionStore
    @StateObject private var labRuntimeStore: LabRuntimeStore
    @StateObject private var labDisplayStore = LabDisplayStore()
    @StateObject private var labDiagnosticsStore = LabDiagnosticsStore.shared
    @StateObject private var labMetricKitStore = LabMetricKitStore.shared
    @AppStorage(LabDisplayStore.themeKey) private var savedTheme = LabDisplayConfiguration.Theme.system.rawValue
    @State private var standaloneOpenURL: URL?
    @State private var agentWorkOpenURL: URL?
    @State private var researchOpenURL: URL?
    @State private var showsLoginLab = false
    @StateObject private var loginLabStore = TalentSignalLabStore(service: nil)

    init() {
#if DEBUG
        let environment = ProcessInfo.processInfo.environment
        if environment[
            TalentSignalAuthenticationConfiguration.previewWorkspaceEnvironmentKey
        ] == "true" {
            UserDefaults.standard.set(
                environment["TS_IOS_UI_TEST_TEXT_SIZE"]
                    ?? WorkspaceTextSizePreference.system.rawValue,
                forKey: WorkspaceTextSizePreference.storageKey
            )
            UserDefaults.standard.set(
                environment["TS_IOS_UI_TEST_CARD_DENSITY"]
                    ?? WorkspaceCardDensityPreference.compact.rawValue,
                forKey: WorkspaceCardDensityPreference.storageKey
            )
        }
#endif
        let directory = RuntimeEnvironmentDirectory(buildEndpoint:
            TalentSignalAuthenticationConfiguration.baseURL(arguments: ProcessInfo.processInfo.arguments))
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--reset-lab-workspace-journey") {
            KeychainLabWorkspaceJourneyStore.resetAllForUITesting()
        }
        if let encoded = ProcessInfo.processInfo.environment["TS_IOS_UI_TEST_AUTHENTICATED_SESSION"],
           let data = Data(base64Encoded: encoded), let endpoint = directory.selected?.endpoint,
           URLFixtureLoader.isLoopback(endpoint) {
            let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
            if let fixture = try? decoder.decode(TalentSignalSession.self, from: data),
               fixture.user.kind == "simulated_human", fixture.account.slug.hasPrefix("fixture-"),
               RuntimeEndpoint.same(fixture.baseURL, endpoint) {
                try? KeychainTalentSignalSessionStore(baseURL: endpoint).save(fixture)
            }
        }
#endif
        let session = AppSessionStore(baseURL: directory.selected?.endpoint, closeSessionSurfaces: {
            await CaptureHandoffStore.shared.changeRuntimeScope(nil)
            await BackgroundCaptureDelivery.shared.pauseAll()
            await CaptureActivityController.shared.endAll()
            await AgentAskActivityController.shared.endAllActivities()
            await AgentWorkActivityController.shared.endAllActivities()
            await ResearchActivityController.shared.endAllActivities()
        })
        _appSessionStore = StateObject(wrappedValue: session)
        _labRuntimeStore = StateObject(wrappedValue: LabRuntimeStore(directory: directory, sessionStore: session))
    }

    private var appLanguage: AppLanguage {
        AppLanguage.stored(storedLanguage)
    }

    private var textSizePreference: WorkspaceTextSizePreference {
        WorkspaceTextSizePreference.stored(storedTextSize)
    }

    private var cardDensityPreference: WorkspaceCardDensityPreference {
        WorkspaceCardDensityPreference.stored(storedCardDensity)
    }

    private var requestedColorScheme: ColorScheme? {
        if let active = labDisplayStore.active { return active.configuration.theme.colorScheme }
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--force-dark") { return .dark }
#endif
        return LabDisplayConfiguration.Theme(rawValue: savedTheme)?.colorScheme
    }

    private var opensReviewWorkbenchDirectly: Bool {
        TalentSignalRootRoute.opensReviewWorkbench(
            arguments: ProcessInfo.processInfo.arguments
        )
    }

    private var standaloneOnboardingRoot: AnyView? {
        let arguments = ProcessInfo.processInfo.arguments
        guard StandaloneOnboardingConfiguration.isEnabled(arguments: arguments)
                || StandaloneOnboardingConfiguration.opens(url: standaloneOpenURL) else {
            return nil
        }
        return AnyView(
            StandaloneOnboardingView(
                arguments: arguments,
                initialURL: standaloneOpenURL
            )
        )
    }

    private var agentWorkShowcaseRoot: AnyView? {
#if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard TalentSignalRootRoute.opensAgentWorkShowcase(arguments: arguments)
                || agentWorkOpenURL.flatMap(AgentWorkDeepLink.parse) != nil else {
            return nil
        }
        return AnyView(AgentWorkShowcaseView(initialURL: agentWorkOpenURL))
#else
        return nil
#endif
    }

    private var researchShowcaseRoot: AnyView? {
#if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard TalentSignalRootRoute.opensResearchShowcase(arguments: arguments)
                || researchOpenURL.flatMap(ResearchDeepLink.parse) != nil else {
            return nil
        }
        return AnyView(ResearchShowcaseView(initialURL: researchOpenURL))
#else
        return nil
#endif
    }

    private var calendarHandoffScenarioRoot: AnyView? {
#if DEBUG
        guard TalentSignalRootRoute.opensCalendarHandoff(
            arguments: ProcessInfo.processInfo.arguments
        ) else {
            return nil
        }
        return AnyView(DeviceCalendarHandoffScenarioView())
#else
        return nil
#endif
    }

    private var pursuitReviewSession: PursuitProposalReviewSession? {
        PursuitProposalReviewSession.configured(
            arguments: ProcessInfo.processInfo.arguments
        )
    }

    private var textSignalSession: TextSignalCaptureSession? {
        TextSignalCaptureSession.configured(
            arguments: ProcessInfo.processInfo.arguments
        )
    }

    private var pursuitWorkspaceSession: PursuitWorkspaceSession? {
        PursuitWorkspaceSession.configured(
            arguments: ProcessInfo.processInfo.arguments
        )
    }

    private var audioSignalStore: AudioSignalCaptureStore? {
#if DEBUG
        guard AudioSignalCaptureSession.configured(
            arguments: ProcessInfo.processInfo.arguments
        ) != nil else { return nil }
        return AudioSignalCaptureStore(recorder: DeterministicAudioSignalRecorder())
#else
        return nil
#endif
    }

    var body: some Scene {
        WindowGroup {
            WorkspaceDisplayPreferencesRoot(
                textSize: textSizePreference,
                cardDensity: cardDensityPreference
            ) {
                LabDisplaySessionRoot(store: labDisplayStore) {
                LabDiagnosticsRoot(store: labDiagnosticsStore) {
                Group {
                    if let researchShowcaseRoot {
                        researchShowcaseRoot
                    } else if let agentWorkShowcaseRoot {
                        agentWorkShowcaseRoot
                    } else if let standaloneOnboardingRoot {
                        standaloneOnboardingRoot
                    } else if requiresAuthentication {
                        authenticatedRoot
                    } else if let calendarHandoffScenarioRoot {
                        calendarHandoffScenarioRoot
                    } else if let audioSignalStore {
                        AudioSignalCaptureView(store: audioSignalStore)
                    } else if let textSignalSession {
                        TextSignalCaptureView(
                            backendURL: textSignalSession.baseURL,
                            recordID: textSignalSession.recordID
                        )
                    } else if let pursuitReviewSession {
                        RelationshipChangeReviewView(
                            person: .leila,
                            reviewSession: pursuitReviewSession
                        )
                    } else if opensReviewWorkbenchDirectly {
                        CandidateSignalView()
                    } else {
                        RelationshipArchiveView(session: pursuitWorkspaceSession)
                    }
                }
                .id(appSessionStore.contextGeneration)
                .environment(\.labRuntime, labRuntimeStore)
                .preferredColorScheme(requestedColorScheme)
#if DEBUG
                // Exercise the reduced-motion rendering branch through the Lab
                // override, without changing Simulator's system preference.
                .transformEnvironment(\.labReduceMotion) { value in
                    value = value || ProcessInfo.processInfo.arguments.contains("--reduce-motion")
                }
#endif
                .task {
                    if requiresAuthentication, appSessionStore.phase == .restoring, !labRuntimeStore.isWorking {
                        if labRuntimeStore.hasActivated { await labRuntimeStore.restoreSelectedEnvironment() }
                        else {
#if DEBUG
                            let fixture = ProcessInfo.processInfo.environment["TS_IOS_UI_TEST_AUTHENTICATED_SESSION"] != nil
                            await appSessionStore.restore(allowOfflineWorkspace:
                                !fixture && !labRuntimeStore.workspaceStore.requiresOnlineRestore)
#else
                            await appSessionStore.restore(allowOfflineWorkspace:
                                !labRuntimeStore.workspaceStore.requiresOnlineRestore)
#endif
                        }
                    }
                    await labRuntimeStore.workspaceStore.reconcile()
#if DEBUG
                    await AgentAskActivityController.shared.configureDeterministicLaunch(
                        arguments: ProcessInfo.processInfo.arguments
                    )
#endif
                    let configured = await CaptureHandoffStore.shared
                        .configureDeterministicLaunch(
                            arguments: ProcessInfo.processInfo.arguments
                        )
                    if !configured, !requiresAuthentication {
                        await CaptureHandoffStore.shared.changeRuntimeScope(pursuitWorkspaceSession?.persistenceScope)
                        await CaptureHandoffStore.shared.restorePendingCapture()
                    }
                    TalentSignalShortcuts.updateAppShortcutParameters()
                }
                .onChange(of: appSessionStore.contextGeneration) { _ in
                    labDisplayStore.contextChanged()
                    labDiagnosticsStore.contextChanged()
                    labMetricKitStore.pause(); labMetricKitStore.closeExport()
                    showsLoginLab = false
                    standaloneOpenURL = nil
                    agentWorkOpenURL = nil
                    researchOpenURL = nil
                }
                .onChange(of: appSessionStore.phase) { _ in
                    Task { await labRuntimeStore.workspaceStore.reconcile() }
                }
                .onReceive(NotificationCenter.default.publisher(for: .iosSessionRenewed).receive(on: RunLoop.main)) { note in
                    if let session = note.object as? TalentSignalSession { appSessionStore.adoptRenewedSession(session) }
                }
                .onReceive(NotificationCenter.default.publisher(for: .iosSessionRevoked).receive(on: RunLoop.main)) { note in
                    if let identity = note.object as? String { Task { await appSessionStore.observeRevocation(identity) } }
                }
                .task(id: scenePhase) {
                    guard scenePhase == .active else { return }
                    await appSessionStore.refreshIfNeeded(force: true)
                    while !Task.isCancelled {
                        do { try await Task.sleep(nanoseconds: 60_000_000_000) } catch { return }
                        await appSessionStore.refreshIfNeeded()
                    }
                }
                .environmentObject(appSessionStore)
                .onChange(of: scenePhase) { phase in
                    // Shared People + open-Session active refresh: foreground
                    // wakes it, background pauses bounded polling.
                    if phase == .active {
                        WorkspaceActiveRefresh.shared.noteSceneActive()
                        WorkspaceActiveRefresh.shared.noteForeground()
                    } else {
                        WorkspaceActiveRefresh.shared.noteSceneBackground()
                    }
                    if phase == .active { labMetricKitStore.refresh() }
                    if phase == .background { labMetricKitStore.closeExport() }
                    guard phase == .active else { return }
                    Task {
                        await AgentAskActivityController.shared.cleanExpired()
                        await CaptureHandoffStore.shared.restorePendingCapture()
                        await labRuntimeStore.workspaceStore.reconcile()
                    }
                }
                .onOpenURL { url in
                    if AgentAskDeepLinkRouter.shared.accept(url) {
                        return
                    } else if ResearchDeepLink.parse(url) != nil {
                        researchOpenURL = url
                    } else if AgentWorkDeepLink.parse(url) != nil {
                        agentWorkOpenURL = url
                    } else if StandaloneOnboardingConfiguration.opens(url: url) {
                        standaloneOpenURL = url
                    }
                }
                }
                }
                .environment(\.appLanguage, appLanguage)
                .environment(\.locale, appLanguage.locale)
            }
        }
    }

    private var requiresAuthentication: Bool {
        labRuntimeStore.hasActivated || TalentSignalAuthenticationConfiguration.requiresAuthentication(
            arguments: ProcessInfo.processInfo.arguments)
    }

    @ViewBuilder
    private var authenticatedRoot: some View {
        switch appSessionStore.phase {
        case .restoring:
            ZStack {
                Color.tsSurface.ignoresSafeArea()
                VStack(spacing: 12) {
                    ProgressView()
                    if let notice = appSessionStore.notice {
                        Text(appLanguage.text(notice))
                        Button(appLanguage.text("Retry")) { Task { await appSessionStore.restore(allowOfflineWorkspace: false) } }
                    }
                }.padding()
            }
            .accessibilityIdentifier("authentication-restoring")
        case .signedOut:
            Group {
                if labRuntimeStore.workspaceStore.secureStoreFailed {
                    LabWorkspaceRecoveryView(store: labRuntimeStore.workspaceStore,
                        sessionStore: appSessionStore)
                } else {
                    AppAuthenticationView(store: appSessionStore,
                        openLab: DeviceLabAvailability.enabled ? { showsLoginLab = true } : nil)
                }
            }
                .task { await CaptureHandoffStore.shared.changeRuntimeScope(nil) }
                .safeAreaInset(edge: .bottom) {
                    VStack(spacing: 6) {
                        if labRuntimeStore.workspaceStore.hasOpenJourney {
                            Button(appLanguage.text("Recover test workspace journey")) {
                                Task { await labRuntimeStore.workspaceStore.recoverOriginalSession() }
                            }
                            .frame(minHeight: 44)
                            .disabled(labRuntimeStore.workspaceStore.isWorking)
                            .accessibilityIdentifier("login-lab-workspace-recovery")
                        }
                    }
                }
                .sheet(isPresented: $showsLoginLab) {
                    ProductLabView(deterministic: loginLabStore, service: nil,
                        baseURL: appSessionStore.baseURL, workspace: nil)
                }
        case let .signedIn(session):
            if labRuntimeStore.workspaceStore.allowsDisplay(session) {
                VStack(spacing: 0) {
                    if session.user.kind == "lab_human" {
                        LabWorkspaceBanner(store: labRuntimeStore.workspaceStore)
                    }
                    RuntimeWorkspaceRoot(session: session) {
                        RelationshipArchiveView(
                            session: .authenticated(session),
                            onSignOut: {
                                await appSessionStore.signOut()
                                return appSessionStore.phase == .signedOut
                            },
                            currentIdentity: { [weak appSessionStore] in
                                guard let appSessionStore,
                                      case let .signedIn(current) = appSessionStore.phase else { return nil }
                                return .init(baseURL: current.baseURL, accessToken: current.accessToken,
                                             accountID: current.account.id, userID: current.user.id)
                            }
                        )
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .id(session.loginIdentity)
            } else {
                LabWorkspaceRecoveryView(store: labRuntimeStore.workspaceStore,
                    sessionStore: appSessionStore)
            }
        }
    }
}

@MainActor
private struct RuntimeWorkspaceRoot<Content: View>: View {
    let session: TalentSignalSession
    @ViewBuilder let content: () -> Content
    @State private var ready = false
    var body: some View {
        Group {
            if ready { content().environment(\.calendarReceiptScope, RuntimeEndpoint.scope(
                session.baseURL, accountID: session.account.id, userID: session.user.id)) }
            else { ProgressView().accessibilityIdentifier("runtime-restoring-captures") }
        }
        .task {
            await CaptureHandoffStore.shared.changeRuntimeScope(RuntimeEndpoint.scope(
                session.baseURL, accountID: session.account.id, userID: session.user.id))
            guard !Task.isCancelled else { return }
            ready = true
        }
    }
}

enum StandaloneOnboardingConfiguration {
    static func isEnabled(arguments: [String]) -> Bool {
#if DEBUG
        arguments.contains("--standalone-onboarding")
            || arguments.contains("--standalone-onboarding-reset")
#else
        false
#endif
    }

    static func opens(url: URL?) -> Bool {
#if DEBUG
        url?.scheme == "talentsignal" && url?.host == "standalone"
#else
        false
#endif
    }
}

enum TalentSignalAuthenticationConfiguration {
    static let previewWorkspaceEnvironmentKey = "TS_IOS_UI_TEST_PREVIEW_WORKSPACE"

    static func requiresAuthentication(
        arguments: [String],
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Bool {
#if DEBUG
        if arguments.contains("--show-login")
            || value(after: "--auth-backend-url", in: arguments) != nil {
            return true
        }
        if PursuitWorkspaceSession.configured(arguments: arguments) != nil {
            return false
        }
        if arguments.contains("--preview-workspace")
            || environment[previewWorkspaceEnvironmentKey] == "true" {
            return false
        }
        if TalentSignalRootRoute.opensReviewWorkbench(arguments: arguments)
            || TalentSignalRootRoute.opensCalendarHandoff(arguments: arguments)
            || TalentSignalRootRoute.opensAgentWorkShowcase(arguments: arguments)
            || TalentSignalRootRoute.opensResearchShowcase(arguments: arguments)
            || StandaloneOnboardingConfiguration.isEnabled(arguments: arguments) {
            return false
        }
        // App-icon relaunches do not keep Xcode scheme arguments. Make the
        // local Debug fallback the preview workspace; the explicit login and
        // authenticated-backend arguments above still take precedence.
        return false
#else
        true
#endif
    }

    static func baseURL(
        arguments: [String],
        infoDictionary: [String: Any] = Bundle.main.infoDictionary ?? [:]
    ) -> URL? {
#if DEBUG
        if let value = value(after: "--auth-backend-url", in: arguments),
           let url = URL(string: value),
           permitted(url, allowsLoopbackHTTP: true) {
            return url
        }
#endif
        guard let encoded = infoDictionary["TalentSignalAPIBaseURLBase64URL"] as? String,
              let data = decodeBase64URL(encoded),
              let value = String(data: data, encoding: .utf8),
              let url = URL(string: value),
              permitted(url, allowsLoopbackHTTP: false) else {
            return nil
        }
        return url
    }

    private static func decodeBase64URL(_ value: String) -> Data? {
        var normalized = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = normalized.count % 4
        guard remainder != 1 else { return nil }
        if remainder > 0 {
            normalized += String(repeating: "=", count: 4 - remainder)
        }
        return Data(base64Encoded: normalized)
    }

    private static func permitted(_ url: URL, allowsLoopbackHTTP: Bool) -> Bool {
        guard url.host != nil,
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil else {
            return false
        }
        if url.scheme == "https" { return true }
        guard allowsLoopbackHTTP, url.scheme == "http" else { return false }
        return ["127.0.0.1", "localhost", "::1"].contains(url.host)
    }

    private static func value(after argument: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: argument),
              arguments.indices.contains(index + 1) else {
            return nil
        }
        return arguments[index + 1]
    }
}

enum TalentSignalRootRoute {
    private static let reviewArguments: Set<String> = [
        "--backend-url",
        "--capture-seed",
        "--endpoint",
        "--fixture-id",
        "--fixture-import-delay-seconds",
        "--scenario",
    ]

    static func opensReviewWorkbench(arguments: [String]) -> Bool {
#if DEBUG
        if let scenario = value(after: "--scenario", in: arguments),
           ["relationship-capture-archive", "capture-inbox"].contains(scenario) {
            return false
        }
        return !reviewArguments.isDisjoint(with: Set(arguments))
#else
        false
#endif
    }

    static func opensCalendarHandoff(arguments: [String]) -> Bool {
#if DEBUG
        value(after: "--scenario", in: arguments) == "calendar-handoff"
#else
        false
#endif
    }

    static func opensAgentWorkShowcase(arguments: [String]) -> Bool {
#if DEBUG
        arguments.contains("--agent-work-showcase")
#else
        false
#endif
    }

    static func opensResearchShowcase(arguments: [String]) -> Bool {
#if DEBUG
        arguments.contains("--synthetic-research-showcase")
#else
        false
#endif
    }

    private static func value(after argument: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: argument),
              arguments.indices.contains(index + 1) else {
            return nil
        }
        return arguments[index + 1]
    }
}
