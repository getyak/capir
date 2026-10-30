import AppKit
import SwiftUI
import WebKit
import UniformTypeIdentifiers
import Combine

/// Native recovery chrome follows the app/device language, like its menus.
enum WorkspaceRecoveryText {
    static var title: String { String(localized: "Workspace Unavailable", bundle: .main) }
    static var unavailable: String { String(localized: "Unable to open the workspace. Check the network, Tailscale, and workspace service, then retry.", bundle: .main) }
    static var paused: String { String(localized: "The page paused. Reload it; saved conversations remain in the workspace.", bundle: .main) }
    static var appearanceUnconfirmed: String { String(localized: "Appearance saving could not be confirmed. Reload and check it.", bundle: .main) }
    static func httpFailure(_ status: Int) -> String {
        String(format: String(localized: "The workspace request failed (HTTP %lld). Reload later or check connection settings.", bundle: .main), Int64(status))
    }
}

/// The page receives display-only chrome metadata and appearance synchronization,
/// never native capability APIs.
/// Update consent is captured in an isolated script world from a trusted click.
/// Native intake remains a separate, explicitly opened window with its own scope.
struct WorkspaceOrigin: Equatable {
    let url: URL

    init?(_ value: String, allowLocalDevelopment: Bool = false) {
        guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else { return nil }
        var validScheme = url.scheme == "https"
        if allowLocalDevelopment, url.scheme == "http", ["127.0.0.1", "localhost", "[::1]", "::1"].contains(host) {
            validScheme = true
        }
        guard validScheme else { return nil }
        guard var canonical = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        canonical.scheme = url.scheme?.lowercased()
        canonical.host = canonical.host?.lowercased()
        canonical.path = ""
        if canonical.port == (canonical.scheme == "https" ? 443 : 80) { canonical.port = nil }
        guard let normalized = canonical.url else { return nil }
        self.url = normalized
    }

    static func configured(saved: String, environment: String? = ProcessInfo.processInfo.environment["TALENT_SIGNAL_WEB_ORIGIN"], bundled: String? = Bundle.main.object(forInfoDictionaryKey: "TalentSignalWebOrigin") as? String, allowLocalDevelopment: Bool = false) -> WorkspaceOrigin? {
        WorkspaceOrigin(saved, allowLocalDevelopment: allowLocalDevelopment) ?? WorkspaceOrigin(environment ?? bundled ?? "", allowLocalDevelopment: allowLocalDevelopment)
    }

    static func parseConfigured(_ value: String) -> WorkspaceOrigin? {
        #if DEBUG
        return WorkspaceOrigin(value, allowLocalDevelopment: ProcessInfo.processInfo.arguments.contains("--web-workspace-testing"))
        #else
        return WorkspaceOrigin(value)
        #endif
    }

    /// Only the configured main-frame origin may request a calendar download.
    /// Blob URLs retain their creating origin; file/data/foreign blobs are rejected.
    func allowsCalendarDownload(_ candidate: URL, from source: URL) -> Bool {
        guard contains(source) else { return false }
        if contains(candidate) { return true }
        guard candidate.scheme == "blob",
              let embedded = URL(string: String(candidate.absoluteString.dropFirst(5))) else { return false }
        return contains(embedded)
    }

    var entryURL: URL {
        #if DEBUG
        if Bundle.main.object(forInfoDictionaryKey: "TalentSignalUpdateRehearsal") as? Bool == true {
            return url.appendingPathComponent("dev/desktop-chrome")
        }
        #endif
        return url.appendingPathComponent("workspace")
    }

    func contains(_ candidate: URL) -> Bool {
        candidate.scheme == url.scheme && candidate.host == url.host &&
            (candidate.port ?? (url.scheme == "https" ? 443 : 80)) ==
            (url.port ?? (url.scheme == "https" ? 443 : 80)) &&
            candidate.user == nil && candidate.password == nil
    }
}

@MainActor
final class WorkspaceBrowser: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    let origin: WorkspaceOrigin
    let webView: WKWebView
    @Published var failure: String?
    @Published var loading = true
    @Published var canGoBack = false
    @Published private(set) var appearancePreference: WorkspaceAppearance = .system
    @Published private(set) var savingAppearance = false
    @Published private(set) var appearanceSaveNotice: String?
    @Published var externalURL: URL?
    @Published var downloadStatus: String?
    /// Explicit, honest notice when the main window could not restore the prior
    /// workbench state after a client-side Settings hop.
    @Published var workbenchNotice: String?
    var visibleWorkbenchNotice: String? { workbenchNotice ?? appearanceSaveNotice }

    func dismissWorkbenchNotice() {
        if workbenchNotice != nil { workbenchNotice = nil }
        else { appearanceSaveNotice = nil }
    }
    /// Set only when the OS refuses to open the default browser for account
    /// settings. Device controls stay available; the view offers a retry.
    @Published var browserLaunchFailure: String?
    /// Set when the workspace intercepts the Web /login route: the native app
    /// owns the signed-out browser-login surface and Web never paints its
    /// password, registration or provider forms inside this window.
    @Published var signedOut = false
    @Published private(set) var restoringSession = false
    private var persistentSessionUnavailable = false
    private var persistentWorkbenchRecoveryPending = false
    private var signOutPersistenceFailed = false
    private let loginRegistry: LoginStoreRegistry
    private let persistentSession: DesktopPersistentSessionCoordinator
    private var sessionRestoreTask: Task<Void, Never>?
    private var sessionRenewalTimer: Task<Void, Never>?
    private var activationObserver: NSObjectProtocol?
    private var wakeObserver: NSObjectProtocol?
    private var unlockObserver: NSObjectProtocol?
    private(set) var explicitlySignedOut = false
    var onExplicitSignOut: (() -> Void)?
    var openSettings: (() -> Void)? {
        didSet { flushPendingSettingsOpen() }
    }
    /// Brings the main workspace window forward for a trusted Settings handoff.
    var openWorkspace: (() -> Void)?
    private var updateObservation: AnyCancellable?
    private var calendarDownloads = Set<ObjectIdentifier>()
    private var navigationObservation: NSKeyValueObservation?
    private var locationObservation: NSKeyValueObservation?
    private var lastWorkbenchURL: URL?
    private var isRestoringWorkbench = false
    private var pendingSettingsOpen = false
    private let storeSelection: LoginStoreSelection?
    private var retired = false
    private var draftOwnerReadGeneration = UUID()
    private var documentGeneration = UUID()
    private var titlebarHeight = 0.0
    private var storeObservation: AnyCancellable?
    private let accountBrowser: AccountSettingsBrowser

    /// The exact configuration every workbench web view is built from. Kept as a
    /// factory so the settings paint guard and the per-origin data store cannot
    /// drift from what the app actually runs.
    static func configuration(for origin: WorkspaceOrigin, registry: LoginStoreRegistry? = nil) -> WKWebViewConfiguration? {
        guard let store = (registry ?? .shared).storeIdentifierIfHealthy(for: origin.url.absoluteString) else { return nil }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: store)
        configuration.userContentController = WKUserContentController()
        // Account settings may never paint inside the app, including on a
        // client-side route change that bypasses the navigation delegate.
        WorkspaceSettingsPaintGuard.install(on: configuration.userContentController)
        return configuration
    }

    /// The exact scripts every workbench web view carries once the desktop
    /// chrome is published. Publishing resets the content controller, so the
    /// settings paint guard has to be part of this list or a client-side route
    /// change could paint Web account settings inside the app.
    static func workbenchUserScripts(chromeScript: String) -> [WKUserScript] {
        WorkspaceSettingsPaintGuard.userScripts + [
            DesktopUpdateClickBridge.userScript,
            WorkspaceAppearanceBridge.userScript,
            WKUserScript(source: chromeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true),
        ]
    }

    init(origin: WorkspaceOrigin, initialURL: URL? = nil,
         accountBrowser: AccountSettingsBrowser? = nil, registry: LoginStoreRegistry? = nil,
         persistentSession: DesktopPersistentSessionCoordinator? = nil) {
        self.origin = origin
        let owner = registry ?? .shared
        self.loginRegistry = owner
        self.persistentSession = persistentSession ?? (registry == nil ? .shared : DesktopPersistentSessionCoordinator(registry: owner))
        self.storeSelection = try? owner.selection(for: origin.url.absoluteString)
        // Optional default keeps the main-actor singleton out of the default
        // argument expression, which is evaluated in a nonisolated context.
        self.accountBrowser = accountBrowser ?? .shared
        let configuration = Self.configuration(for: origin, registry: owner) ?? WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        guard storeSelection != nil else {
            // Corrupted store registry or failed persistence write: refuse the
            // surface truthfully instead of loading into an unowned store.
            loading = false
            signedOut = true
            return
        }
        webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 TalentSignalMac/1"
        storeObservation = owner.changes.sink { [weak self] selection in
            guard let self, selection.origin == self.origin.url.absoluteString,
                  selection.storeIdentifier != self.storeSelection?.storeIdentifier else { return }
            self.retire()
        }
        if storeSelection?.unresolved == true {
            signedOut = true; loading = false
        }
        _ = DesktopUpdateClickBridge(controller: configuration.userContentController) { [weak self] url, frame in
            guard let self,
                  case .installUpdate(let offerID) = DesktopChromeAction.resolve(
                    url, source: frame.request.url, origin: self.origin,
                    mainFrame: frame.isMainFrame, userActivated: true) else { return }
            DesktopUpdater.shared.installUpdate(offerID: offerID)
        }
        _ = WorkspaceAppearanceBridge(controller: configuration.userContentController, origin: origin) { [weak self] value in
            guard let self, !self.retired else { return }
            self.appearancePreference = value
        }
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = WorkspaceConnection.shared.inspectorEnabled
        updateObservation = DesktopUpdater.shared.$presentation.sink { [weak self] state in
            self?.publishDesktopChrome(state: state)
        }
        navigationObservation = webView.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.canGoBack = self.webView.canGoBack
            }
        }
        lastWorkbenchURL = WorkspaceSurfacePolicy.initialWorkbenchURL(initialURL: initialURL, origin: origin)
        // KVO observes `history.pushState`/`replaceState` (proved in
        // WorkspaceSettingsTests), so it catches client-side transitions that
        // never reach `decidePolicyFor`.
        locationObservation = webView.observe(\.url, options: [.new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.observeWorkbenchLocationForSettingsTransition()
            }
        }
        publishDesktopChrome(state: DesktopUpdater.shared.presentation)
        let entry = URLRequest(url: initialURL ?? origin.entryURL)
        #if DEBUG
        // UI-test harness only: a synthetic session, supplied by the harness, is
        // seeded into this origin's own store so the ordinary Web conversation can
        // be exercised. Release builds and normal launches never see it. The entry
        // load starts from the store's completion so the first request carries it.
        if let cookie = WorkspaceTestSession.cookieSpec(
            from: ProcessInfo.processInfo.environment[WorkspaceTestSession.cookieEnvironmentKey],
            origin: origin, arguments: ProcessInfo.processInfo.arguments) {
            configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { [weak self] in
                Task { @MainActor in self?.webView.load(entry) }
            }
            return
        }
        #endif
        if !signedOut {
            installSessionLifecycleObservers()
            refreshPersistentSession(resumeWorkbench: true)
        }
    }

    func retire() {
        sessionRestoreTask?.cancel(); sessionRestoreTask = nil
        sessionRenewalTimer?.cancel(); sessionRenewalTimer = nil
        if let activationObserver { NotificationCenter.default.removeObserver(activationObserver) }
        if let wakeObserver { NSWorkspace.shared.notificationCenter.removeObserver(wakeObserver) }
        if let unlockObserver { NSWorkspace.shared.notificationCenter.removeObserver(unlockObserver) }
        activationObserver = nil; wakeObserver = nil; unlockObserver = nil
        if let storeSelection { persistentSession.cancel(selection: storeSelection) }
        retired = true; webView.stopLoading(); webView.navigationDelegate = nil
        webView.uiDelegate = nil; navigationObservation = nil; locationObservation = nil
        updateObservation = nil; webView.configuration.userContentController.removeAllScriptMessageHandlers()
    }

    private func installSessionLifecycleObservers() {
        activationObserver = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refreshPersistentSession(resumeWorkbench: self?.signedOut == true) }
        }
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refreshPersistentSession(resumeWorkbench: self?.signedOut == true) }
        }
        unlockObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.sessionDidBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refreshPersistentSession(resumeWorkbench: self?.signedOut == true || self?.persistentSessionUnavailable == true) }
        }
        sessionRenewalTimer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3 * 60 * 60))
                guard !Task.isCancelled, let self, !self.retired else { return }
                self.refreshPersistentSession(resumeWorkbench: self.signedOut)
            }
        }
    }

    /// Startup and expiry recovery share the production constructor path;
    /// routine renewals leave the current document and its drafts in place.
    func refreshPersistentSession(resumeWorkbench: Bool = false) {
        guard !retired, !explicitlySignedOut,
              let selection = storeSelection, loginRegistry.isCurrent(selection), !loginRegistry.hasUnresolvedLogin(for: selection.origin) else { return }
        // An expiry redirect can arrive during a background renewal. Promote
        // that existing attempt to workbench recovery instead of losing the
        // navigation intent, and retain the intent through transient outages.
        if resumeWorkbench { persistentWorkbenchRecoveryPending = true }
        restoringSession = persistentWorkbenchRecoveryPending
        if restoringSession { loading = true }
        guard sessionRestoreTask == nil else { return }
        sessionRestoreTask = Task { [weak self] in
            guard let self else { return }
            let outcome = await persistentSession.restore(in: origin)
            guard !Task.isCancelled, !retired, loginRegistry.isCurrent(selection), !explicitlySignedOut else { return }
            sessionRestoreTask = nil; restoringSession = false
            switch outcome {
            case .authenticated:
                persistentSessionUnavailable = false
                if persistentWorkbenchRecoveryPending {
                    persistentWorkbenchRecoveryPending = false
                    signedOut = false; failure = nil; loading = true
                    webView.load(URLRequest(url: lastWorkbenchURL ?? origin.entryURL))
                }
            case .needsLogin:
                persistentWorkbenchRecoveryPending = false
                persistentSessionUnavailable = false; failure = nil; signedOut = true; loading = false
            case .unavailable:
                persistentSessionUnavailable = true; loading = false
                if persistentWorkbenchRecoveryPending {
                    failure = String(localized: "Unable to restore sign-in. Unlock your login keychain, check the network, or retry later. Your sign-in credential and drafts are preserved.", bundle: .main)
                }
            case .cancelled: loading = false
            }
        }
    }

    /// Window closure does not revoke ownership or destroy the live host. A
    /// retained SwiftUI scene can reopen during browser login; endpoint/store
    /// replacement still retires the old host permanently.
    func retireIfOwnershipChanged(to configuredOrigin: WorkspaceOrigin?) {
        guard configuredOrigin == origin, let storeSelection,
              loginRegistry.isCurrent(storeSelection) else {
            retire(); return
        }
    }

    var loginReturnTarget: URL? { lastWorkbenchURL }
    @discardableResult
    func enterSignedOut(at url: URL) -> Bool {
        guard !retired, let storeSelection, loginRegistry.isCurrent(storeSelection),
              origin.contains(url), url.path == "/login" else { return false }
        let intents = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.filter { $0.name == "intent" } ?? []
        explicitlySignedOut = intents.count == 1 && intents[0].value == "sign-out"
        if explicitlySignedOut {
            lastWorkbenchURL = nil; workbenchNotice = nil
            do { try persistentSession.signOut(in: origin) }
            catch {
                signOutPersistenceFailed = true
                failure = String(localized: "Unable to save sign-out state. Check local storage and retry.", bundle: .main)
            }
            // Intent can arrive after expiry already set signedOut=true.
            // Deliver it synchronously rather than relying on a Bool change.
            onExplicitSignOut?()
        }
        signedOut = true; loading = false
        if !explicitlySignedOut { refreshPersistentSession(resumeWorkbench: true) }
        return true
    }
    func verifiedCurrentDraftOwner() async -> DesktopDraftOwner? {
        guard !retired, !signedOut, let selection = storeSelection,
              loginRegistry.isCurrent(selection),
              webView.url.map(origin.contains) == true else { return nil }
        let readGeneration = UUID(); draftOwnerReadGeneration = readGeneration
        let result = await DesktopDraftScriptRead.read(timeout: .seconds(6)) { completion in
            webView.callAsyncJavaScript(DesktopDraftRecovery.ownerScript,
                arguments: ["statusURL": origin.url.appendingPathComponent("api/desktop-auth/status").absoluteString],
                in: nil, in: DesktopDraftRecovery.world) { result in
                    completion((try? result.get()) as? String)
                }
        }
            guard !retired, !signedOut, draftOwnerReadGeneration == readGeneration, loginRegistry.isCurrent(selection),
                  webView.url.map(origin.contains) == true, let text = result,
                  let owner = DesktopDraftRecovery.readOwner(text) else { return nil }
            return owner
    }

    private func recordDraftOwnerIfNeeded() async {
        guard let selection = storeSelection,
              (try? loginRegistry.selection(for: selection.origin).verifiedDraftOwner) == nil,
              let owner = await verifiedCurrentDraftOwner() else { return }
        try? loginRegistry.recordVerifiedDraftOwner(owner, selection: selection)
    }

    func captureDraftRecovery() async -> DesktopDraftRecovery? {
        guard !retired, let selection = storeSelection, loginRegistry.isCurrent(selection),
              let owner = try? loginRegistry.selection(for: selection.origin).verifiedDraftOwner,
              owner.valid, let target = lastWorkbenchURL, origin.contains(target),
              WorkspaceSurfacePolicy.isOrdinaryWorkspaceDestination(target),
              target.absoluteString.count <= 4096, webView.url.map(origin.contains) == true else { return nil }
        let id = DesktopDraftRecovery.sessionID(in: target)
        var draft: DesktopDraftRecovery.Draft?
        if let id {
                let result = await DesktopDraftScriptRead.read { completion in
                    webView.callAsyncJavaScript(DesktopDraftRecovery.readScript,
                        arguments: ["scope": owner.storageScope, "session": id], in: nil,
                        in: DesktopDraftRecovery.world) { result in
                            completion((try? result.get()) as? String)
                        }
                }
                guard !retired, loginRegistry.isCurrent(selection),
                      webView.url.map(origin.contains) == true, let text = result else { return nil }
                draft = DesktopDraftRecovery.readDraft(text)
        }
        return DesktopDraftRecovery(owner: owner, target: target, sessionID: id, draft: draft)
    }

    func completeBrowserLogin(returnTarget: URL?, recoveryNotice: String? = nil) {
        guard !retired, let storeSelection, loginRegistry.isCurrent(storeSelection),
              !loginRegistry.hasUnresolvedLogin(for: origin.url.absoluteString) else { return }
        signedOut = false; failure = nil; loading = true
        explicitlySignedOut = false
        if let recoveryNotice { workbenchNotice = recoveryNotice }
        // Enrollment installs the stable persistent-session binding before
        // any workspace document is admitted. Normal renewals never reload it.
        lastWorkbenchURL = returnTarget ?? origin.entryURL
        if activationObserver == nil { installSessionLifecycleObservers() }
        refreshPersistentSession(resumeWorkbench: true)
    }

    func navigate(_ destination: WorkspaceDestination) {
        guard !retired, !signedOut else { return }
        if destination == .settings { requestSettingsOpen(); return }
        webView.load(URLRequest(url: destination.url(in: origin)))
    }

    /// The same explicit intent as the Web plus button, without reloading an
    /// already mounted conversation. A detached callback cannot navigate a
    /// replacement account or a newer document.
    func startNewConversation() {
        guard !retired, !signedOut, !loading, let current = webView.url,
              origin.contains(current), let selection = storeSelection,
              loginRegistry.isCurrent(selection) else { return }
        let generation = documentGeneration
        webView.callAsyncJavaScript(WorkspaceNewConversation.script, arguments: [:],
                                   in: nil, in: .page) { [weak self] result in
            guard let self, !self.retired, !self.signedOut, self.webView.url == current,
                  !self.loading, self.documentGeneration == generation,
                  loginRegistry.isCurrent(selection) else { return }
            // Failure can mean a handler ran before script evaluation failed.
            // Preserve the document instead of issuing a second navigation.
            guard case .success(let value) = result, let handled = value as? Bool else { return }
            if !handled { self.webView.load(URLRequest(url: WorkspaceNewConversation.url(in: self.origin))) }
        }
    }

    /// Opens the one native Settings scene, deferring until the view has wired
    /// `openSettings` if a cold-load KVO fires first.
    func requestSettingsOpen() {
        if let openSettings { openSettings() } else { pendingSettingsOpen = true }
    }

    /// Opens account and preference management in the default browser, never in
    /// an embedded WebView. Returns false and records an honest failure when the
    /// workspace origin is unknown or the OS refuses the open, so the rest of
    /// this Mac's settings stay usable offline.
    @discardableResult
    func requestAccountSettings(_ destination: AccountSettingsDestination = .overview) -> Bool {
        guard accountBrowser.open(destination, in: origin) else {
            browserLaunchFailure = "无法打开默认浏览器。请检查默认浏览器后重试；此 Mac 设置仍可继续使用。"
            return false
        }
        browserLaunchFailure = nil
        return true
    }

    private func flushPendingSettingsOpen() {
        guard pendingSettingsOpen, let openSettings else { return }
        pendingSettingsOpen = false
        openSettings()
    }

    /// Compatibility fallback for a Web revision whose Settings entry uses a
    /// client-side `Next.js Link`/`pushState`. `decidePolicyFor` never sees it,
    /// so the exact Settings route is detected here: open the one native
    /// Settings window and return the workbench to its previous URL with a
    /// same-document back navigation, preserving unsent state where the Web app
    /// keeps it in memory.
    private func observeWorkbenchLocationForSettingsTransition() {
        guard !retired, let url = webView.url else { return }
        if origin.contains(url), url.path == "/login" {
            enterSignedOut(at: url); webView.stopLoading(); return
        }
        guard let transition = WorkspaceSurfacePolicy.workbenchSettingsTransition(
            from: lastWorkbenchURL, to: url, origin: origin) else {
            if WorkspaceSurfacePolicy.isTrackableWorkbenchURL(url, origin: origin) {
                lastWorkbenchURL = url
            }
            isRestoringWorkbench = false
            return
        }
        guard !isRestoringWorkbench else { return }
        // Account settings are owned by the browser; the native window is only
        // opened by an explicit device-settings link.
        let browserOpened = requestAccountSettings(transition.destination)
        restoreWorkbench(after: transition, browserOpened: browserOpened)
    }

    private func restoreWorkbench(after transition: WorkspaceSurfacePolicy.WorkbenchSettingsTransition,
                                  browserOpened: Bool) {
        isRestoringWorkbench = true
        workbenchNotice = nil
        switch WorkspaceSurfacePolicy.workbenchRestorePlan(
            for: transition, canGoBack: webView.canGoBack,
            backItemURL: webView.backForwardList.backItem?.url, entryURL: origin.entryURL,
            browserOpened: browserOpened) {
        case .back:
            // Pop the proven same-document entry; no timer, no reload.
            webView.goBack()
        case .load(let url, let notice):
            workbenchNotice = notice
            webView.load(URLRequest(url: url))
        }
    }

    func retry() {
        failure = nil
        if signOutPersistenceFailed {
            do { try persistentSession.signOut(in: origin); signOutPersistenceFailed = false }
            catch { failure = String(localized: "Unable to save sign-out state. Check local storage and retry.", bundle: .main) }
            return
        }
        if persistentSessionUnavailable {
            refreshPersistentSession(resumeWorkbench: true)
            return
        }
        // A refused browser handoff stays on screen until it succeeds or the
        // reader dismisses it; a plain workbench retry does not retry it.
        if let current = webView.url,
           let transition = WorkspaceSurfacePolicy.workbenchSettingsTransition(
            from: lastWorkbenchURL, to: current, origin: origin) {
            // Retry from a client-side Settings hop re-opens browser account
            // settings and restores the workbench instead of reloading Web
            // Settings.
            let browserOpened = requestAccountSettings(transition.destination)
            restoreWorkbench(after: transition, browserOpened: browserOpened)
            return
        }
        if let current = webView.url, origin.contains(current) { webView.reload() }
        else { webView.load(URLRequest(url: origin.entryURL)) }
    }

    func selectAppearance(_ preference: WorkspaceAppearance) {
        guard !retired, !signedOut, !loading, !savingAppearance,
              let current = webView.url, origin.contains(current) else { return }
        savingAppearance = true
        webView.callAsyncJavaScript(WorkspaceAppearanceBridge.selectionScript,
            arguments: ["preference": preference.rawValue, "expectedOrigin": origin.url.absoluteString],
            in: nil, in: .page) { [weak self] result in
                guard let self else { return }
                self.savingAppearance = false
                guard !self.retired, self.webView.url == current else { return }
                guard case .success(let saved) = result, saved as? Bool == true else {
                    self.appearanceSaveNotice = WorkspaceRecoveryText.appearanceUnconfirmed
                    return
                }
                self.appearanceSaveNotice = nil
                self.appearancePreference = preference
            }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard !retired, let selection = storeSelection, loginRegistry.isCurrent(selection),
              let url = action.request.url else { decisionHandler(.cancel); return }
        if WorkspaceSupportHandoff.allows(url,
            sourceIsTrusted: action.sourceFrame.request.url.map(origin.contains) == true,
            mainFrame: action.sourceFrame.isMainFrame && action.targetFrame?.isMainFrame != false,
            userActivated: action.navigationType == .linkActivated) {
            externalURL = url
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "talentsignal-desktop" {
            if let command = DesktopChromeAction.resolve(url, source: action.sourceFrame.request.url,
                                                        origin: origin, mainFrame: action.sourceFrame.isMainFrame,
                                                        userActivated: action.navigationType == .linkActivated) {
                switch command {
                case .settings:
                    requestSettingsOpen()
                case .accountSettings(let destination):
                    requestAccountSettings(destination)
                case .updates:
                    if DesktopUpdater.shared.presentation.canInstall {
                        WorkspaceSettingsNavigation.shared.selection = .updates
                        requestSettingsOpen()
                    }
                    else { DesktopUpdater.shared.checkForUpdates() }
                // linkActivated also includes synthetic page clicks. Installation
                // is accepted only through the isolated trusted-click handler.
                case .installUpdate: break
                }
            }
            decisionHandler(.cancel)
            return
        }
        if action.shouldPerformDownload, action.sourceFrame.isMainFrame,
           let source = action.sourceFrame.request.url,
           origin.allowsCalendarDownload(url, from: source) {
            decisionHandler(.download)
            return
        }
        if origin.contains(url) {
            let mainFrame = action.sourceFrame.isMainFrame
            let targetsMainFrame = action.targetFrame?.isMainFrame != false
            // The Web Settings route is never rendered inside the workspace
            // WebView, and it is never silently redirected into the native
            // device window: `/workspace/settings` is account management, so it
            // opens the default browser instead. Cancelling the navigation also
            // leaves the conversation and its unsent draft untouched.
            if mainFrame, targetsMainFrame, url.path == "/login" {
                // Native owns the signed-out entry (ADR 0022): intercept the
                // actual /login route and publish the native browser-login UI,
                // so no Web login form can paint inside the app.
                enterSignedOut(at: url)
                decisionHandler(.cancel)
                return
            }
            if mainFrame, targetsMainFrame, WorkspaceSurfacePolicy.isSettingsOwned(url) {
                requestAccountSettings(WorkspaceSurfacePolicy.WorkbenchSettingsTransition
                    .accountDestination(forSettingsURL: url))
                decisionHandler(.cancel)
                return
            }
            if action.targetFrame == nil {
                webView.load(action.request)
                decisionHandler(.cancel)
            } else { decisionHandler(.allow) }
            return
        }
        // Cross-origin auth or source links are never silently launched by a redirect.
        if action.targetFrame?.isMainFrame != false,
           ["https", "http"].contains(url.scheme ?? "") {
            externalURL = url
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, let http = response.response as? HTTPURLResponse,
           http.statusCode >= 400, ![401, 403].contains(http.statusCode) {
            loading = false
            failure = WorkspaceRecoveryText.httpFailure(http.statusCode)
            decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }

    // WebKit's download delegate preserves normal browser isolation. No JS bridge is added.
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        calendarDownloads.insert(ObjectIdentifier(download))
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard calendarDownloads.contains(ObjectIdentifier(download)),
              response.mimeType?.lowercased() == "text/calendar",
              let window = webView.window else {
            calendarDownloads.remove(ObjectIdentifier(download))
            downloadStatus = "只能保存工作区生成的日历文件。"
            completionHandler(nil)
            return
        }
        let panel = NSSavePanel()
        panel.title = "保存日历文件"
        panel.message = "保存后请在日历应用中核对并确认导入。"
        panel.allowedContentTypes = [UTType(filenameExtension: "ics") ?? .data]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = "capri-\(UUID().uuidString.prefix(8)).ics"
        panel.beginSheetModal(for: window) { [weak self] result in
            guard result == .OK, let url = panel.url else {
                self?.calendarDownloads.remove(ObjectIdentifier(download))
                self?.downloadStatus = "已取消保存日历文件。"
                completionHandler(nil)
                return
            }
            // WKDownload requires a new file. Never remove an existing user file.
            guard !FileManager.default.fileExists(atPath: url.path) else {
                self?.calendarDownloads.remove(ObjectIdentifier(download))
                self?.downloadStatus = "此文件已存在，请重新下载并选择新文件名。"
                completionHandler(nil)
                return
            }
            completionHandler(url)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard calendarDownloads.remove(ObjectIdentifier(download)) != nil else { return }
        downloadStatus = "日历文件已保存。请打开文件，在日历应用中核对并确认导入。"
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard calendarDownloads.remove(ObjectIdentifier(download)) != nil else { return }
        downloadStatus = "日历文件未能保存，请重试下载。"
    }

    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        decisionHandler(request.url.map(origin.contains) == true ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        draftOwnerReadGeneration = UUID()
        documentGeneration = UUID()
        loading = true
        failure = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        canGoBack = webView.canGoBack
        publishDesktopChrome(state: DesktopUpdater.shared.presentation)
        Task { @MainActor [weak self] in await self?.recordDraftOwnerIfNeeded() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        recordFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        recordFailure(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loading = false
        failure = WorkspaceRecoveryText.paused
    }

    func updateTitlebarHeight(_ height: Double) {
        guard height.isFinite, height >= 0, height <= 128, titlebarHeight != height else { return }
        titlebarHeight = height
        publishDesktopChrome(state: DesktopUpdater.shared.presentation)
    }

    func publishDesktopChrome(state presentation: DesktopUpdatePresentation) {
        var state = WorkspaceSurfacePolicy.desktopChromePayload(
            surface: "workspace",
            presentation: presentation,
            appVersion: DesktopUpdater.shared.appVersion)
        state["titlebarHeight"] = titlebarHeight
        guard let bytes = try? JSONSerialization.data(withJSONObject: state),
              let json = String(data: bytes, encoding: .utf8),
              let originBytes = try? JSONSerialization.data(withJSONObject: origin.url.absoluteString, options: .fragmentsAllowed),
              let originJSON = String(data: originBytes, encoding: .utf8) else { return }
        // Main-frame display metadata only. The origin check also closes navigation races.
        let script = """
        if (window.location.origin === \(originJSON)) {
          window.talentSignalDesktop = \(json);
          const applyChrome = () => {
            const root = document.documentElement;
            if (!root) return;
            root.dataset.desktopSurface = \(json).surface;
            root.dataset.desktopTitlebar = 'unified';
            root.style.setProperty('--workspace-native-titlebar-height', '\(titlebarHeight)px');
          };
          if (document.documentElement) applyChrome();
          else document.addEventListener('DOMContentLoaded', applyChrome, { once: true });
          window.dispatchEvent(new Event('talent-signal-desktop'));
        }
        """
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        for userScript in Self.workbenchUserScripts(chromeScript: script) {
            controller.addUserScript(userScript)
        }
        if let current = webView.url, origin.contains(current) {
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    private func recordFailure(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        loading = false
        failure = WorkspaceRecoveryText.unavailable
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let url = frame.request.url, origin.contains(url), let window = webView.window else {
            completionHandler(false); return
        }
        let alert = NSAlert()
        alert.messageText = "工作区确认 · \(origin.url.host ?? "capri")"
        alert.informativeText = message
        alert.addButton(withTitle: "确认")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard let url = frame.request.url, origin.contains(url), let window = webView.window else {
            completionHandler(); return
        }
        let alert = NSAlert()
        alert.messageText = "工作区 · \(origin.url.host ?? "capri")"
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard let url = frame.request.url, origin.contains(url), let window = webView.window else {
            completionHandler(nil); return
        }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
}

struct WorkspaceWebSurface: NSViewRepresentable {
    let browser: WorkspaceBrowser
    let zoom: Double
    let appearance: WorkspaceAppearance
    func makeNSView(context: Context) -> WorkspaceMaterialSurface {
        browser.webView.pageZoom = WorkspaceContentZoom.clamp(zoom)
        return WorkspaceMaterialSurface(webView: browser.webView, preference: appearance,
                                        onTitlebarLayout: { [weak browser] in browser?.updateTitlebarHeight($0) })
    }
    func updateNSView(_ nsView: WorkspaceMaterialSurface, context: Context) {
        nsView.webView.pageZoom = WorkspaceContentZoom.clamp(zoom)
        nsView.preference = appearance
        nsView.needsLayout = true
    }
}

struct WorkspaceStatusAction: Identifiable {
    let id: String
    let title: String
    var role: ButtonRole? = nil
    let perform: () -> Void
}

struct WorkspaceStatusNotice: Identifiable {
    enum Kind: String, Hashable {
        case workbench, accountBrowser, calendarDownload

        var title: String {
            switch self {
            case .workbench: String(localized: "Workspace notice", bundle: .main)
            case .accountBrowser: String(localized: "Account and Preferences", bundle: .main)
            case .calendarDownload: String(localized: "Calendar file", bundle: .main)
            }
        }

        var symbol: String {
            switch self {
            case .workbench: "text.badge.checkmark"
            case .accountBrowser: "safari"
            case .calendarDownload: "calendar"
            }
        }

        var identifier: String {
            switch self {
            case .workbench: "workspace.settingsRecoveryNotice"
            case .accountBrowser: "workspace.browserLaunchFailure"
            case .calendarDownload: "workspace.calendarDownloadNotice"
            }
        }
    }

    let kind: Kind
    let message: String
    let actions: [WorkspaceStatusAction]
    var id: Kind { kind }
}

/// One in-flow owner for native status. It respects the window's safe area and
/// reserves space above the work surface instead of covering its header.
struct WorkspaceStatusLayout<Content: View>: View {
    let loading: Bool
    let notices: [WorkspaceStatusNotice]
    let content: Content

    init(loading: Bool, notices: [WorkspaceStatusNotice], @ViewBuilder content: () -> Content) {
        self.loading = loading
        self.notices = notices
        self.content = content()
    }

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                if loading || !notices.isEmpty {
                    WorkspaceStatusStack(loading: loading, notices: notices)
                        .frame(maxHeight: max(0, min(280, geometry.size.height * 0.42)))
                }
                ZStack { content }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}

struct WorkspaceStatusStack: View {
    let loading: Bool
    let notices: [WorkspaceStatusNotice]

    var body: some View {
        ViewThatFits(in: .vertical) {
            rows.fixedSize(horizontal: false, vertical: true)
            ScrollView { rows }
                .scrollBounceBehavior(.basedOnSize)
        }
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspace.nativeStatusRegion")
    }

    private var rows: some View {
        VStack(alignment: .leading, spacing: 14) {
            if loading {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small).accessibilityHidden(true)
                    Text(String(localized: "Loading workspace…", bundle: .main))
                        .font(.callout).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("workspace.loading")
            }
            ForEach(notices) { notice in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: notice.kind.symbol)
                        .font(.body).foregroundStyle(.secondary)
                        .frame(width: 20).padding(.top, 2)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(notice.kind.title).font(.callout.weight(.semibold)).accessibilityAddTraits(.isHeader)
                        Text(notice.message).font(.callout)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 8) { actions(for: notice) }
                            VStack(alignment: .leading, spacing: 8) { actions(for: notice) }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(notice.kind.identifier)
                if notice.id != notices.last?.id { Divider() }
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 12)
        .frame(maxWidth: 880, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private func actions(for notice: WorkspaceStatusNotice) -> some View {
        ForEach(notice.actions) { action in
            Button(role: action.role, action: action.perform) { Text(action.title) }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("\(notice.kind.identifier).\(action.id)")
        }
    }
}

enum WorkspaceRecoveryPresentation: Equatable {
    case restoringSignIn
    case failed(String)

    var isFailure: Bool { if case .failed = self { true } else { false } }
}

struct WorkspaceRecoverySurface: View {
    let presentation: WorkspaceRecoveryPresentation
    let reload: () -> Void
    let connectionSettings: () -> Void
    @FocusState private var reloadFocused: Bool

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    switch presentation {
                    case .restoringSignIn:
                        ProgressView().controlSize(.regular).accessibilityHidden(true)
                        Text(String(localized: "Restoring sign-in…", bundle: .main))
                            .font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
                        Text(String(localized: "Checking this Mac’s saved sign-in.", bundle: .main))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    case .failed(let reason):
                        Image(systemName: "network.slash").font(.title2).foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                        Text(WorkspaceRecoveryText.title).font(.title2.weight(.semibold))
                            .accessibilityAddTraits(.isHeader)
                        Text(reason).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                            .accessibilityIdentifier("workspace.recovery.reason")
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 10) { recoveryActions }
                            VStack(alignment: .leading, spacing: 10) { recoveryActions }
                        }
                    }
                }
                .font(.body)
                .padding(32)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity, minHeight: max(0, geometry.size.height), alignment: .center)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(.background)
        .accessibilityIdentifier("workspace.recovery")
        .onAppear { reloadFocused = presentation.isFailure }
        .onChange(of: presentation) { _, state in reloadFocused = state.isFailure }
    }

    private var recoveryActions: some View {
        Group {
            Button(String(localized: "Reload", bundle: .main), action: reload)
                .buttonStyle(.borderedProminent)
                .focused($reloadFocused)
                .accessibilityIdentifier("workspace.recovery.reload")
            Button(String(localized: "Connection and Diagnostics", bundle: .main), action: connectionSettings)
                .buttonStyle(.bordered)
                .accessibilityIdentifier("workspace.recovery.connection")
        }
    }
}

private struct ConnectedQuietWorkspace: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject private var navigation = WorkspaceNavigation.shared
    @ObservedObject var login: DesktopBrowserLoginCoordinator
    @StateObject private var browser: WorkspaceBrowser
    @Environment(\.openWindow) private var openWindow
    @AppStorage("workspace.desktop.zoom") private var zoom = 1.0
    @ObservedObject private var connection = WorkspaceConnection.shared
    @Environment(\.openSettings) private var openSettings
    @AppStorage("workspace.desktop.floating") private var floating = false

    init(origin: WorkspaceOrigin, login: DesktopBrowserLoginCoordinator) {
        self.login = login
        _browser = StateObject(wrappedValue: WorkspaceBrowser(origin: origin))
    }

    private var presentationAppearance: WorkspaceAppearance? {
        if model.isDarkAppearancePreview { return .dark }
        return browser.signedOut || browser.failure != nil ? nil : browser.appearancePreference
    }

    private func consumeDestination() {
        guard !browser.signedOut else { return }
        if let url = navigation.pendingURL {
            navigation.pendingURL = nil
            // Only the configured origin may be loaded from a handoff.
            if browser.origin.contains(url) {
                browser.webView.load(URLRequest(url: url))
            }
            return
        }
        guard let destination = navigation.pending else { return }
        navigation.pending = nil
        browser.navigate(destination)
    }

    private var nativeNotices: [WorkspaceStatusNotice] {
        var notices: [WorkspaceStatusNotice] = []
        if let message = browser.visibleWorkbenchNotice {
            let drafts = login.visibleRetainedDrafts
            var actions: [WorkspaceStatusAction] = []
            for (index, retained) in drafts.enumerated() {
                let copyTitle = drafts.count == 1
                    ? String(localized: "Copy retained text", bundle: .main)
                    : String(format: String(localized: "Copy text %lld", bundle: .main), Int64(index + 1))
                let discardTitle = drafts.count == 1
                    ? String(localized: "Discard this recovery", bundle: .main)
                    : String(format: String(localized: "Discard recovery %lld", bundle: .main), Int64(index + 1))
                actions.append(WorkspaceStatusAction(id: "copy.\(retained.id)", title: copyTitle) {
                    Task { @MainActor in
                        let copied = await login.copyRetainedDraft(retained.id, verifying: { await browser.verifiedCurrentDraftOwner() })
                        browser.workbenchNotice = copied
                            ? String(localized: "Text copied. Paste it into the conversation and review before sending.", bundle: .main)
                            : String(localized: "Text was not copied. Check sign-in, draft retention or clipboard permission, then retry.", bundle: .main)
                    }
                })
                actions.append(WorkspaceStatusAction(id: "discard.\(retained.id)", title: discardTitle, role: .destructive) {
                    login.discardRetainedDraft(retained.id)
                })
            }
            if drafts.isEmpty {
                actions.append(WorkspaceStatusAction(id: "dismiss", title: String(localized: "Close", bundle: .main)) {
                    browser.dismissWorkbenchNotice()
                })
            }
            notices.append(.init(kind: .workbench, message: message, actions: actions))
        }
        if let message = browser.browserLaunchFailure {
            notices.append(.init(kind: .accountBrowser, message: message, actions: [
                WorkspaceStatusAction(id: "retry", title: String(localized: "Retry", bundle: .main)) { browser.requestAccountSettings() },
                WorkspaceStatusAction(id: "dismiss", title: String(localized: "Close", bundle: .main)) { browser.browserLaunchFailure = nil },
            ]))
        }
        if let message = browser.downloadStatus {
            notices.append(.init(kind: .calendarDownload, message: message, actions: [
                WorkspaceStatusAction(id: "dismiss", title: String(localized: "Close", bundle: .main)) { browser.downloadStatus = nil },
            ]))
        }
        return notices
    }

    var body: some View {
        let notices = nativeNotices
        return WorkspaceStatusLayout(loading: browser.loading && !browser.restoringSession && !browser.signedOut && browser.failure == nil,
                                     notices: notices) {
            // A covering view leaves WebKit controls reachable by accessibility
            // and keyboard. Detach only its presentation; browser retains the
            // same WebView and navigation/session ownership for recovery.
            if !browser.signedOut && browser.failure == nil && !browser.restoringSession {
                WorkspaceWebSurface(browser: browser, zoom: zoom,
                                    appearance: presentationAppearance ?? .system)
                    .ignoresSafeArea(.container, edges: notices.isEmpty && !browser.loading ? .top : [])
            }
            if browser.signedOut && !browser.restoringSession && browser.failure == nil {
                // Native signed-out surface only: the Web login page never
                // paints inside the workspace window.
                DesktopBrowserLoginView(origin: browser.origin, returnTarget: browser.loginReturnTarget,
                                        coordinator: login, captureDraft: { await browser.captureDraftRecovery() })
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(TSBrand.canvas)
            }
            if let failure = browser.failure {
                WorkspaceRecoverySurface(presentation: .failed(failure), reload: browser.retry) {
                    WorkspaceSettingsNavigation.shared.selection = .connection
                    browser.requestSettingsOpen()
                }
            } else if browser.restoringSession {
                WorkspaceRecoverySurface(presentation: .restoringSignIn, reload: {}, connectionSettings: {})
            }
        }
        .modifier(WorkspaceAppearancePresentation(preference: presentationAppearance))
        .focusedSceneObject(browser)
        .background(WorkspaceWindowBehavior(floating: floating))
        .onAppear {
            browser.onExplicitSignOut = { [weak coordinator = login, origin = browser.origin] in
                coordinator?.explicitlySignedOut(in: origin)
            }
            browser.openSettings = { openSettings() }
            CaptureRuntime.shared.start()
            CaptureRuntime.shared.setOpenWorkspace { openWindow(id: "workspace") }
            if browser.signedOut && browser.explicitlySignedOut {
                login.explicitlySignedOut(in: browser.origin)
            } else if case .completed = login.phase {
                // Exchange can finish before the reopened view's phase
                // observer is attached. Consume the current result as well.
                browser.completeBrowserLogin(returnTarget: login.returnTarget, recoveryNotice: login.recoveryNotice)
            } else if browser.signedOut {
                if browser.explicitlySignedOut { login.explicitlySignedOut(in: browser.origin) }
                else { login.signedOut(in: browser.origin) }
            }
            consumeDestination()
        }
        .onDisappear { browser.retireIfOwnershipChanged(to: connection.origin) }
        .onChange(of: browser.signedOut) { _, signedOut in
            if signedOut && !browser.explicitlySignedOut { login.signedOut(in: browser.origin) }
        }
        .onChange(of: login.phase) { _, phase in
            if case .completed = phase { browser.completeBrowserLogin(returnTarget: login.returnTarget, recoveryNotice: login.recoveryNotice); consumeDestination() }
        }
        .onChange(of: connection.inspectorEnabled) { _, enabled in browser.webView.isInspectable = enabled }
        .onChange(of: navigation.pending) { _, _ in consumeDestination() }
        .onChange(of: navigation.pendingURL) { _, _ in consumeDestination() }
        .alert(browser.externalURL?.scheme == "mailto" ? "在邮件应用中准备草稿？" : "在浏览器中打开？", isPresented: Binding(
            get: { browser.externalURL != nil }, set: { if !$0 { browser.externalURL = nil } }
        )) {
            Button("打开") {
                if let url = browser.externalURL { NSWorkspace.shared.open(url) }
                browser.externalURL = nil
            }
            Button("取消", role: .cancel) { browser.externalURL = nil }
        } message: {
            Text(browser.externalURL?.scheme == "mailto"
                ? "收件人：hello@talentsignal.ai。打开后由你编辑和发送；不会自动发送邮件。"
                : browser.externalURL?.host ?? "此链接位于工作区之外。")
        }
    }
}

/// First-run install stays a compact, content-sized window instead of an empty workspace canvas.
private struct FirstRunWindowFit: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            let size = NSSize(width: 720, height: 650)
            window.setContentSize(size)
            window.center()
            window.toolbar = nil
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

struct QuietWorkspaceView: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject private var connection = WorkspaceConnection.shared
    @StateObject private var login = DesktopBrowserLoginCoordinator.shared
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        Group {
        if let origin = connection.origin {
            ConnectedQuietWorkspace(origin: origin, login: login)
                // Retire the whole WebKit host when the store epoch changes:
                // a deliberate new primary login never leaves a stale host
                // signed in or bound to the previous store.
                .id("\(origin.url.absoluteString)-\(connection.storeEpoch)")
        } else {
            FirstRunExperience(reduceMotionPreview: model.isReducedMotionPreview)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(TSBrand.canvas)
            .background(FirstRunWindowFit())
        }
        }.onChange(of: connection.origin) { _, _ in login.originChanged() }
    }
}
