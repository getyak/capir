import AppKit
import SwiftUI
import WebKit
import UniformTypeIdentifiers
import Combine

/// The page receives display-only chrome metadata, never native capability APIs.
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

/// An honest recovery state when a client-side hop tries to render the
/// workbench inside Settings. It carries the destination for an explicit
/// user-opened main-window handoff, never an automatic one.
struct WorkspaceSettingsRecoveryNotice: Equatable {
    let message: String
    let destination: URL
}

@MainActor
final class WorkspaceBrowser: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    let origin: WorkspaceOrigin
    let webView: WKWebView
    let isSettingsSurface: Bool
    @Published var failure: String?
    @Published var loading = true
    @Published var canGoBack = false
    @Published var externalURL: URL?
    @Published var downloadStatus: String?
    /// Set when the settings WebView lands on an ordinary workspace route it
    /// must not render. The view offers an explicit main-window handoff.
    @Published var settingsRecovery: WorkspaceSettingsRecoveryNotice?
    /// Explicit, honest notice when the main window could not restore the prior
    /// workbench state after a client-side Settings hop.
    @Published var workbenchNotice: String?
    var openSettings: (() -> Void)? {
        didSet { flushPendingSettingsOpen() }
    }
    /// Brings the main workspace window forward for a trusted Settings handoff.
    var openWorkspace: (() -> Void)?
    private var updateObservation: AnyCancellable?
    private var calendarDownloads = Set<ObjectIdentifier>()
    private var navigationObservation: NSKeyValueObservation?
    private var locationObservation: NSKeyValueObservation?
    private var lastValidSettingsSection: WorkspaceSettingsSection?
    private var isRestoringSettings = false
    /// Last same-origin workbench URL seen by the main window, used to restore
    /// the conversation after a client-side hop into Web Settings.
    private var lastWorkbenchURL: URL?
    private var isRestoringWorkbench = false
    private var pendingSettingsOpen = false
    /// Gate state for the settings WebView. The WebView is only shown when this
    /// is `.supported`; every other state renders natively.
    @Published var settingsSurfaceStatus: WorkspaceSurfacePolicy.SettingsWebSurfaceStatus = .checking
    private var settingsProbeAttempts = 0
    /// Bumped on every new document load so a stale `evaluateJavaScript`
    /// completion from a previous document can never be applied.
    private var settingsProbeGeneration = 0
    private static let settingsProbeMaxAttempts = 5

    init(origin: WorkspaceOrigin, settings: Bool = false, initialURL: URL? = nil) {
        self.origin = origin
        self.isSettingsSurface = settings
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: origin.dataStoreIdentifier)
        configuration.userContentController = WKUserContentController()
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        _ = DesktopUpdateClickBridge(controller: configuration.userContentController) { [weak self] url, frame in
            guard let self,
                  case .installUpdate(let offerID) = DesktopChromeAction.resolve(
                    url, source: frame.request.url, origin: self.origin,
                    mainFrame: frame.isMainFrame, userActivated: true) else { return }
            DesktopUpdater.shared.installUpdate(offerID: offerID)
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
        if settings {
            lastValidSettingsSection = WorkspaceSettingsNavigation.shared.selection.isWeb
                ? WorkspaceSettingsNavigation.shared.selection : .profile
        } else {
            lastWorkbenchURL = WorkspaceSurfacePolicy.initialWorkbenchURL(initialURL: initialURL, origin: origin)
        }
        // KVO observes `history.pushState`/`replaceState` (proved in
        // WorkspaceSettingsTests), so it catches client-side transitions that
        // never reach `decidePolicyFor`.
        locationObservation = webView.observe(\.url, options: [.new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if self.isSettingsSurface {
                    self.observeSettingsLocationForRecovery()
                } else {
                    self.observeWorkbenchLocationForSettingsTransition()
                }
            }
        }
        publishDesktopChrome(state: DesktopUpdater.shared.presentation)
        webView.load(URLRequest(url: initialURL ?? origin.entryURL))
    }

    func navigate(_ destination: WorkspaceDestination) {
        if destination == .settings, !isSettingsSurface { requestSettingsOpen(); return }
        webView.load(URLRequest(url: destination.url(in: origin)))
    }

    /// Opens the one native Settings scene, deferring until the view has wired
    /// `openSettings` if a cold-load KVO fires first. Passing `section` also
    /// selects it; omitting it preserves the current selection.
    func requestSettingsOpen(_ section: WorkspaceSettingsSection? = nil) {
        if let section { WorkspaceSettingsNavigation.shared.selection = section }
        if let openSettings { openSettings() } else { pendingSettingsOpen = true }
    }

    private func flushPendingSettingsOpen() {
        guard pendingSettingsOpen, let openSettings else { return }
        pendingSettingsOpen = false
        openSettings()
    }

    /// Recovers from a client-side navigation that bypassed the navigation
    /// delegate. It never renders the workbench: it restores the last valid
    /// Settings section and surfaces an explicit main-window handoff.
    private func observeSettingsLocationForRecovery() {
        guard isSettingsSurface, let url = webView.url else { return }
        switch WorkspaceSurfacePolicy.classifySettingsURL(url, origin: origin) {
        case .settingsSection(let section):
            lastValidSettingsSection = section
            if !isRestoringSettings {
                WorkspaceSettingsNavigation.shared.selection = section
                settingsRecovery = nil
            }
            isRestoringSettings = false
            // SPA section changes do not fire `didFinish`; re-verify only when
            // the surface is not already proven, so a stale surface can never
            // stay visible without adding churn to a known-good one.
            if !loading, settingsSurfaceStatus != .supported { probeSettingsSurface() }
        case .settingsOwnedSubpage:
            // Account, diagnostics and linking flows stay in the settings window
            // only when they prove a clean surface; otherwise they are handed off.
            if !loading {
                settingsSurfaceStatus = .checking
                settingsProbeAttempts = 0
                probeSettingsSurface()
            }
        case .unexpectedRoute(let unexpected):
            recoverFromUnexpectedNavigation(to: unexpected)
        case .ignore:
            break
        }
    }

    private func recoverFromUnexpectedNavigation(to url: URL) {
        let section = lastValidSettingsSection
            ?? (WorkspaceSettingsNavigation.shared.selection.isWeb ? WorkspaceSettingsNavigation.shared.selection : .profile)
        let restore = section.url(in: origin)
        isRestoringSettings = true
        settingsRecovery = WorkspaceSettingsRecoveryNotice(
            message: "设置内的这次页面跳转没有经过导航确认；该页面只能在主窗口打开。已恢复到“\(section.title)”。",
            destination: url)
        if webView.url != restore {
            webView.load(URLRequest(url: restore))
        } else {
            isRestoringSettings = false
        }
    }

    /// Compatibility fallback for a Web revision whose Settings entry uses a
    /// client-side `Next.js Link`/`pushState`. `decidePolicyFor` never sees it,
    /// so the exact Settings route is detected here: open the one native
    /// Settings scene and return the workbench to its previous URL with a
    /// same-document back navigation, preserving unsent state where the Web app
    /// keeps it in memory. Only the exact `/workspace/settings` route with a
    /// valid section query is handled; subpages and arbitrary routes are not.
    private func observeWorkbenchLocationForSettingsTransition() {
        guard !isSettingsSurface, let url = webView.url else { return }
        guard let transition = WorkspaceSurfacePolicy.workbenchSettingsTransition(
            from: lastWorkbenchURL, to: url, origin: origin) else {
            if WorkspaceSurfacePolicy.isTrackableWorkbenchURL(url, origin: origin) {
                lastWorkbenchURL = url
            }
            isRestoringWorkbench = false
            return
        }
        guard !isRestoringWorkbench else { return }
        requestSettingsOpen(transition.section)
        restoreWorkbench(after: transition)
    }

    private func restoreWorkbench(after transition: WorkspaceSurfacePolicy.WorkbenchSettingsTransition) {
        isRestoringWorkbench = true
        workbenchNotice = nil
        switch WorkspaceSurfacePolicy.workbenchRestorePlan(
            for: transition, canGoBack: webView.canGoBack,
            backItemURL: webView.backForwardList.backItem?.url, entryURL: origin.entryURL) {
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
        if isSettingsSurface {
            if let target = WorkspaceSurfacePolicy.settingsRetryURL(
                currentURL: webView.url, origin: origin, lastSection: lastValidSettingsSection) {
                webView.load(URLRequest(url: target))
                return
            }
        } else if let current = webView.url,
                  let transition = WorkspaceSurfacePolicy.workbenchSettingsTransition(
                    from: lastWorkbenchURL, to: current, origin: origin) {
            // Retry from a client-side Settings hop re-opens native Settings and
            // restores the workbench instead of reloading Web Settings.
            requestSettingsOpen(transition.section)
            restoreWorkbench(after: transition)
            return
        }
        if let current = webView.url, origin.contains(current) { webView.reload() }
        else { webView.load(URLRequest(url: origin.entryURL)) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "talentsignal-desktop" {
            if let command = DesktopChromeAction.resolve(url, source: action.sourceFrame.request.url,
                                                        origin: origin, mainFrame: action.sourceFrame.isMainFrame,
                                                        userActivated: action.navigationType == .linkActivated) {
                switch command {
                case .settings:
                    requestSettingsOpen(.profile)
                case .updates:
                    if DesktopUpdater.shared.presentation.canInstall {
                        requestSettingsOpen(.updates)
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
            // A trusted Settings link to an ordinary workspace page — or the
            // account profile editor at /onboarding — opens the main window at
            // that URL; the workbench never loads inside Settings.
            if let handoff = WorkspaceSurfacePolicy.mainWindowHandoffURL(
                for: url, origin: origin, isSettingsSurface: isSettingsSurface,
                mainFrame: mainFrame, targetsMainFrame: targetsMainFrame,
                userActivated: action.navigationType == .linkActivated)
                ?? WorkspaceSurfacePolicy.accountEditHandoffURL(
                    for: url, origin: origin, isSettingsSurface: isSettingsSurface,
                    mainFrame: mainFrame, targetsMainFrame: targetsMainFrame,
                    userActivated: action.navigationType == .linkActivated) {
                WorkspaceNavigation.shared.pendingURL = handoff
                openWorkspace?()
                decisionHandler(.cancel)
                return
            }
            // A non-click same-origin navigation that would render the workbench
            // is cancelled rather than trapping it inside the settings window.
            if WorkspaceSurfacePolicy.blocksWorkbenchNavigation(
                url: url, origin: origin, isSettingsSurface: isSettingsSurface,
                mainFrame: mainFrame, targetsMainFrame: targetsMainFrame) {
                decisionHandler(.cancel)
                return
            }
            // A non-handoff full navigation to the account editor must not
            // transiently render it inside Settings; `/login` and
            // settings-owned auth routes stay allowed.
            if WorkspaceSurfacePolicy.blocksAccountEditNavigation(
                url: url, origin: origin, isSettingsSurface: isSettingsSurface,
                mainFrame: mainFrame, targetsMainFrame: targetsMainFrame) {
                decisionHandler(.cancel)
                return
            }
            if !isSettingsSurface, mainFrame, targetsMainFrame,
               let selection = WorkspaceSettingsSection.resolve(url, origin: origin) {
                requestSettingsOpen(selection)
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
            failure = "工作区服务暂时无法完成请求（HTTP \(http.statusCode)）。请稍后重新载入，或检查连接设置。"
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
        panel.nameFieldStringValue = "Talent Signal-\(UUID().uuidString.prefix(8)).ics"
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
        loading = true
        failure = nil
        if isSettingsSurface {
            settingsProbeGeneration += 1
            settingsSurfaceStatus = .checking
            settingsProbeAttempts = 0
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        canGoBack = webView.canGoBack
        publishDesktopChrome(state: DesktopUpdater.shared.presentation)
        if isSettingsSurface { probeSettingsSurface() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if isSettingsSurface { settingsSurfaceStatus = .unknown }
        recordFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if isSettingsSurface { settingsSurfaceStatus = .unknown }
        recordFailure(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loading = false
        if isSettingsSurface { settingsSurfaceStatus = .unknown }
        failure = "页面已暂停，请重新载入。已保存的对话仍保留在工作区。"
    }

    func publishDesktopChrome(state presentation: DesktopUpdatePresentation) {
        let state = WorkspaceSurfacePolicy.desktopChromePayload(
            surface: isSettingsSurface ? "settings" : "workspace",
            presentation: presentation,
            appVersion: DesktopUpdater.shared.appVersion)
        guard let bytes = try? JSONSerialization.data(withJSONObject: state),
              let json = String(data: bytes, encoding: .utf8),
              let originBytes = try? JSONSerialization.data(withJSONObject: origin.url.absoluteString, options: .fragmentsAllowed),
              let originJSON = String(data: originBytes, encoding: .utf8) else { return }
        // Main-frame display metadata only. The origin check also closes navigation races.
        let script = "if (window.location.origin === \(originJSON)) { window.talentSignalDesktop = \(json); if (document.documentElement) document.documentElement.dataset.desktopSurface = \(json).surface; else document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.desktopSurface = \(json).surface; }, { once: true }); window.dispatchEvent(new Event('talent-signal-desktop')); }"
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(DesktopUpdateClickBridge.userScript)
        controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let current = webView.url, origin.contains(current) {
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    private func recordFailure(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        loading = false
        failure = "暂时无法打开工作区。请检查网络、Tailscale 和工作区服务，再重试。"
    }

    // MARK: Settings compatibility gate

    /// Read-only probe. It never exposes a message handler and never navigates.
    /// The stable hooks are the settings root marker, the settings nav data
    /// attribute and the workspace chrome aria labels.
    static let settingsSurfaceProbeScript = """
    (function () {
      function isHidden(element) {
        if (!element) { return true; }
        var style = window.getComputedStyle(element);
        if (!style) { return false; }
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') { return true; }
        return element.getClientRects().length === 0;
      }
      try {
        var main = document.querySelector('main[data-desktop-settings-surface="1"]');
        var innerNav = document.querySelector('[data-settings-navigation]');
        var workspaceNav = document.querySelector('nav[aria-label="工作台导航"]');
        var workspaceAside = document.querySelector('aside[aria-label="Talent Signal 工作台"]');
        var mobileHeader = null;
        var headers = document.querySelectorAll('header');
        for (var i = 0; i < headers.length; i++) {
          if (headers[i].querySelector('a[aria-label="Talent Signal 工作台"]')) { mobileHeader = headers[i]; break; }
        }
        var chromeHidden = isHidden(workspaceNav) && isHidden(workspaceAside) && isHidden(mobileHeader);
        return {
          href: String(window.location.href),
          hasMarker: main !== null,
          innerNavHidden: isHidden(innerNav),
          workspaceChromeHidden: chromeHidden
        };
      } catch (error) {
        return { href: String(window.location.href), error: String(error) };
      }
    })()
    """

    private func probeSettingsSurface() {
        guard isSettingsSurface else { return }
        let generation = settingsProbeGeneration
        let expectedURL = webView.url
        settingsProbeAttempts += 1
        webView.evaluateJavaScript(Self.settingsSurfaceProbeScript) { [weak self] result, error in
            Task { @MainActor [weak self] in
                self?.applySettingsProbe(result: result, error: error,
                                         generation: generation, expectedURL: expectedURL)
            }
        }
    }

    private func applySettingsProbe(result: Any?, error: Error?,
                                    generation: Int, expectedURL: URL?) {
        guard isSettingsSurface else { return }
        let parsed = error == nil
            ? WorkspaceSurfacePolicy.settingsSurfaceProbe(fromJavaScriptResult: result)
            : nil
        // `nil` means the result is stale (older document invocation, a
        // navigation in flight, or a mismatched URL) and must be ignored so it
        // can never reveal the WebView.
        guard let status = WorkspaceSurfacePolicy.settingsSurfaceStatusForProbe(
            generation: generation, currentGeneration: settingsProbeGeneration,
            loading: loading, expectedURL: expectedURL, currentURL: webView.url,
            probe: parsed, origin: origin) else { return }
        switch WorkspaceSurfacePolicy.settingsProbeOutcome(
            status: status, attempts: settingsProbeAttempts,
            maxAttempts: Self.settingsProbeMaxAttempts) {
        case .apply(let final):
            settingsSurfaceStatus = final
        case .retry:
            scheduleSettingsProbeRetry(generation: generation)
        }
    }

    private func scheduleSettingsProbeRetry(generation: Int) {
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(150))
            guard let self, self.settingsProbeGeneration == generation else { return }
            self.probeSettingsSurface()
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let url = frame.request.url, origin.contains(url), let window = webView.window else {
            completionHandler(false); return
        }
        let alert = NSAlert()
        alert.messageText = "工作区确认 · \(origin.url.host ?? "Talent Signal")"
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
        alert.messageText = "工作区 · \(origin.url.host ?? "Talent Signal")"
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard let url = frame.request.url, origin.contains(url) else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.begin { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
}

struct WorkspaceWebSurface: NSViewRepresentable {
    let browser: WorkspaceBrowser
    let zoom: Double
    func makeNSView(context: Context) -> WKWebView {
        browser.webView.pageZoom = min(1.5, max(0.9, zoom))
        return browser.webView
    }
    func updateNSView(_ nsView: WKWebView, context: Context) {
        nsView.pageZoom = min(1.5, max(0.9, zoom))
    }
}

private struct ConnectedQuietWorkspace: View {
    @ObservedObject private var navigation = WorkspaceNavigation.shared
    @StateObject private var browser: WorkspaceBrowser
    @Environment(\.openWindow) private var openWindow
    @AppStorage("workspace.desktop.zoom") private var zoom = 1.0
    @ObservedObject private var connection = WorkspaceConnection.shared
    @Environment(\.openSettings) private var openSettings
    @AppStorage("workspace.desktop.floating") private var floating = false

    init(origin: WorkspaceOrigin) { _browser = StateObject(wrappedValue: WorkspaceBrowser(origin: origin)) }

    private func consumeDestination() {
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

    var body: some View {
        ZStack(alignment: .top) {
            WorkspaceWebSurface(browser: browser, zoom: zoom)
            if browser.loading {
                ProgressView().controlSize(.mini).padding(6)
                    .accessibilityLabel("正在载入工作区").allowsHitTesting(false)
            }
            if let status = browser.downloadStatus {
                HStack {
                    Text(status).font(.callout)
                    Button("关闭") { browser.downloadStatus = nil }
                }.padding(12).background(.regularMaterial).clipShape(RoundedRectangle(cornerRadius: 8))
                    .padding().accessibilityElement(children: .contain)
            }
            if let notice = browser.workbenchNotice {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "exclamationmark.triangle").foregroundStyle(.secondary)
                    Text(notice).font(.callout).fixedSize(horizontal: false, vertical: true)
                    Button("关闭") { browser.workbenchNotice = nil }
                }
                .padding(12)
                .frame(maxWidth: 560, alignment: .leading)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                .padding()
                .accessibilityIdentifier("workspace.settingsRecoveryNotice")
            }
            if let failure = browser.failure {
                VStack(spacing: 18) {
                    Image(systemName: "network.slash").font(.title)
                    Text("工作区暂不可用").font(.title2)
                    Text(failure).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Button("重新载入", action: browser.retry).buttonStyle(TSPrimaryButtonStyle())
                }
                .padding(40).frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(TSBrand.canvas)
            }
        }
        .focusedSceneObject(browser)
        .background(WorkspaceWindowBehavior(floating: floating))
        .onAppear {
            browser.openSettings = { openSettings() }
            CaptureRuntime.shared.start()
            CaptureRuntime.shared.setOpenWorkspace { openWindow(id: "workspace") }
            consumeDestination()
        }
        .onChange(of: connection.inspectorEnabled) { _, enabled in browser.webView.isInspectable = enabled }
        .onChange(of: navigation.pending) { _, _ in consumeDestination() }
        .onChange(of: navigation.pendingURL) { _, _ in consumeDestination() }
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                Button { browser.webView.goBack() } label: { Image(systemName: "chevron.left") }
                    .disabled(!browser.canGoBack).help("返回")
            }
            ToolbarItem {
                Menu {
                    Button("新对话") { browser.navigate(.home) }
                    Button("设置…") { openSettings() }
                    Divider()
                    Button("重新载入", action: browser.retry)
                    Button("本机工具") { openWindow(id: "native-tools") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }.help("工作区操作")
            }
        }
        .alert("在浏览器中打开？", isPresented: Binding(
            get: { browser.externalURL != nil }, set: { if !$0 { browser.externalURL = nil } }
        )) {
            Button("打开") {
                if let url = browser.externalURL { NSWorkspace.shared.open(url) }
                browser.externalURL = nil
            }
            Button("取消", role: .cancel) { browser.externalURL = nil }
        } message: {
            Text(browser.externalURL?.host ?? "此链接位于工作区之外。")
        }
    }
}

/// First-run install stays a compact, content-sized window instead of an empty workspace canvas.
private struct FirstRunWindowFit: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            let size = NSSize(width: 480, height: 500)
            window.setContentSize(size)
            window.center()
            window.toolbar = nil
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

struct QuietWorkspaceView: View {
    @ObservedObject private var connection = WorkspaceConnection.shared
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        if let origin = connection.origin {
            ConnectedQuietWorkspace(origin: origin).id(origin.url)
                .toolbar {
                    ToolbarItem {
                        Button("设置", systemImage: "slider.horizontal.3") { openSettings() }
                            .help("设置（⌘,）")
                    }
                }
        } else {
            VStack(spacing: 0) {
                Spacer(minLength: 28)
                WorkspaceConnectionForm(mode: .firstRun, onConnected: {})
                    .frame(maxWidth: 400)
                    .padding(.horizontal, 44)
                Spacer(minLength: 28)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(TSBrand.canvas)
            .background(FirstRunWindowFit())
        }
    }
}
