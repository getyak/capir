import XCTest
import WebKit
@testable import TalentSignalMac

final class WorkspaceSettingsTests: XCTestCase {
    // MARK: Native-only surface inventory

    /// Every row in the native window is a device control that needs no Web
    /// origin, which is what makes Settings usable offline.
    func testEverySectionIsANativeDeviceControlAndStaysOffline() {
        XCTAssertEqual(WorkspaceSettingsSection.allCases.map(\.rawValue),
                       ["general", "permissions", "connection", "updates"])
        for section in WorkspaceSettingsSection.allCases {
            let pane = WorkspaceSettingsPane.resolve(selection: section)
            XCTAssertTrue(pane.isNativeDeviceControl, "\(section) must not need the Web origin")
            XCTAssertEqual(pane.section, section)
            XCTAssertEqual(pane.title, section.title)
        }
        XCTAssertEqual(WorkspaceSettingsPane.allCases.count, WorkspaceSettingsSection.allCases.count)
    }

    /// Account, workspace, versions and diagnostics sections are no longer
    /// native rows; they are browser-owned or handed off explicitly.
    func testNoAccountOrWorkspaceSectionsRemainInNativeSettings() {
        let rawValues = Set(WorkspaceSettingsSection.allCases.map(\.rawValue))
        for removed in ["profile", "account", "appearance", "connections", "workspace", "versions", "advanced", "testing"] {
            XCTAssertFalse(rawValues.contains(removed), "\(removed) must not be a native settings row")
        }
        XCTAssertEqual(WorkspaceSettingsSection.groups.map(\.title), ["此 Mac", "支持"])
        XCTAssertEqual(WorkspaceSettingsSection.groups.first?.sections, [.general, .permissions, .updates])
        XCTAssertEqual(WorkspaceSettingsSection.groups.last?.sections, [.connection])
    }

    func testThisDeviceAndUpdatesStayNativeWithoutAnOrigin() {
        for section in [WorkspaceSettingsSection.permissions, .updates] {
            let pane = WorkspaceSettingsPane.resolve(selection: section)
            XCTAssertTrue(pane.isNativeDeviceControl, "\(section) must not need the Web origin")
            XCTAssertEqual(pane.title, section.title)
        }
        // The local updater keeps a distinct title from any Web version pane.
        XCTAssertEqual(WorkspaceSettingsSection.updates.title, "软件更新")
    }

    func testDesktopChromePayloadCarriesAppVersionAndUpdateState() {
        var presentation = DesktopUpdatePresentation()
        presentation.phase = .available
        presentation.version = "0.2.0"
        presentation.progress = 42
        let payload = WorkspaceSurfacePolicy.desktopChromePayload(
            surface: "workspace", presentation: presentation, appVersion: "0.1.0 (29)")
        XCTAssertEqual(payload["protocolVersion"] as? Int, 1)
        XCTAssertEqual(payload["surface"] as? String, "workspace")
        XCTAssertEqual(payload["appVersion"] as? String, "0.1.0 (29)")
        XCTAssertEqual(payload["availableVersion"] as? String, "0.2.0")
        XCTAssertEqual(payload["phase"] as? String, "available")
        XCTAssertEqual(payload["progress"] as? Int, 42)
        XCTAssertTrue(payload["offerID"] is NSNull)
        XCTAssertNoThrow(try JSONSerialization.data(withJSONObject: payload))
    }

    // MARK: Search route integrity

    func testEverySearchWorkspacePathHasARealWebRoute() throws {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let webApp = repoRoot.appending(path: "apps/web/app")
        XCTAssertTrue(FileManager.default.fileExists(atPath: webApp.path),
                      "Web app directory missing at \(webApp.path)")
        var checked = 0
        for entry in WorkspaceSettingsSearchEntry.all {
            guard case .workspacePath(let path) = entry.action else { continue }
            checked += 1
            let isDynamic = path.split(separator: "/").contains { $0.hasPrefix("[") }
            let page = webApp.appending(path: path).appending(path: "page.tsx")
            XCTAssertTrue(isDynamic || FileManager.default.fileExists(atPath: page.path),
                          "\(entry.id) → \(path) has no real page at \(page.path)")
        }
        XCTAssertGreaterThan(checked, 0)
        XCTAssertFalse(WorkspaceSettingsSearchEntry.all.contains { $0.id == "onboarding" },
                       "The removed /workspace/onboarding route must not be advertised")
        XCTAssertFalse(WorkspaceSettingsSearchEntry.search("入门").contains { $0.id == "onboarding" })
    }

    func testScreenRecordingSearchOnlyClaimsSystemSettingsOpened() throws {
        let entry = try XCTUnwrap(WorkspaceSettingsSearchEntry.search("屏幕录制权限").first { $0.id == "screen-recording" })
        XCTAssertEqual(entry.action,
                       .systemSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"))
        XCTAssertTrue(entry.detail.contains("macOS"))
        for claim in ["已授权", "已开启", "已允许"] {
            XCTAssertFalse(entry.detail.contains(claim), "Search must not claim permission grant")
        }
    }

    func testSearchFindsScreenshotAliasesWithExactScopeAndDestination() {
        for query in ["截图", "截屏", "屏幕录制", "录屏", "screenshot", "屏幕快照"] {
            let results = WorkspaceSettingsSearchEntry.search(query)
            XCTAssertTrue(results.contains { $0.id == "captures" }, "“\(query)” must reach captures")
        }
        let results = WorkspaceSettingsSearchEntry.search("截图")
        XCTAssertTrue(results.contains { $0.id == "screen-recording" })

        let screenRecording = results.first { $0.id == "screen-recording" }!
        XCTAssertEqual(screenRecording.scope, "此设备")
        XCTAssertEqual(screenRecording.destination, "设置 · 权限 · 打开 macOS 系统设置")

        let captures = WorkspaceSettingsSearchEntry.search("截屏").first { $0.id == "captures" }!
        XCTAssertEqual(captures.scope, "当前空间")
        XCTAssertEqual(captures.destination, "资料 · 截图与文档")
    }

    func testSearchFindsNativeSectionsAndDestinations() {
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("此设备").first?.id, "permissions")
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("软件更新").first?.id, "updates")
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("运行记录").first?.id, "connection")
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("账号").first?.id, "account")
        // Full-width and spaced Latin input folds to the same alias.
        XCTAssertEqual(WorkspaceSettingsSearchEntry.normalized("  SCREEN  Shot "), "screenshot")
        XCTAssertTrue(WorkspaceSettingsSearchEntry.search("ＳＣＲＥＥＮ SＨＯＴ").contains { $0.id == "captures" })
    }

    /// The account row is browser-owned: it carries no workspace URL and no
    /// native section, so activating it can never render account settings in
    /// the app.
    func testSearchAccountEntryOpensBrowserAndHasNoURL() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let account = try XCTUnwrap(WorkspaceSettingsSearchEntry.search("账号与偏好").first { $0.id == "account" })
        XCTAssertEqual(account.action, .accountBrowser(.overview))
        XCTAssertNil(account.resolvedURL(in: origin))
        XCTAssertEqual(account.scope, "账号 · 浏览器")
        XCTAssertEqual(AccountSettingsDestination.overview.url(in: origin).path, "/workspace/settings")
        XCTAssertEqual(AccountSettingsDestination.connections.url(in: origin).query, "section=connections")
    }

    func testSearchNeverSurfacesUnknownSectionsOrSettingsOwnedHandoffs() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        for entry in WorkspaceSettingsSearchEntry.all {
            switch entry.action {
            case .workspacePath(let path):
                let url = origin.url.appending(path: path)
                XCTAssertTrue(WorkspaceSurfacePolicy.isOrdinaryWorkspaceDestination(url),
                              "\(entry.id) must hand off an ordinary workspace route")
                XCTAssertFalse(WorkspaceSurfacePolicy.isSettingsOwned(url))
                XCTAssertEqual(entry.resolvedURL(in: origin), url)
            case .section:
                XCTAssertNil(entry.resolvedURL(in: origin), "\(entry.id) is native and has no URL")
            case .accountBrowser:
                XCTAssertNil(entry.resolvedURL(in: origin), "\(entry.id) is browser-owned and has no URL")
            case .systemSettings(let value):
                XCTAssertNotNil(URL(string: value))
            }
        }
        // An unsupported destination resolves to nil instead of a mismatched row.
        let unsupported = WorkspaceSettingsSearchEntry(
            id: "unsupported", title: "x", detail: "x", scope: "x", destination: "x", keywords: [],
            action: .workspacePath("/admin/secret"))
        XCTAssertNil(unsupported.resolvedURL(in: origin))
        // A handoff URL is always built on the origin it was resolved against,
        // so it can never point at a hardcoded host or leak past that origin.
        let foreign = try XCTUnwrap(WorkspaceOrigin("https://other.example"))
        let captures = try XCTUnwrap(WorkspaceSettingsSearchEntry.search("截屏").first { $0.id == "captures" })
        let foreignURL = try XCTUnwrap(captures.resolvedURL(in: foreign))
        XCTAssertEqual(foreignURL.host, "other.example")
        XCTAssertTrue(foreign.contains(foreignURL))
        XCTAssertNil(WorkspaceSettingsSearchEntry.search("没有这个设置").first)
    }

    func testSearchKeyboardWrapsClearsAndKeepsMissingResultsUnselectable() {
        var state = WorkspaceSettingsSearchState()
        state.update("截图")
        XCTAssertGreaterThanOrEqual(state.results.count, 2)
        XCTAssertEqual(state.activeIndex, -1)
        XCTAssertNil(state.activeEntry)

        state.moveDown()
        XCTAssertEqual(state.activeIndex, 0)
        XCTAssertNotNil(state.activeEntry)
        for _ in 0..<state.results.count { state.moveDown() }
        XCTAssertEqual(state.activeIndex, 0, "Down wraps through every result")

        state.moveUp()
        XCTAssertEqual(state.activeIndex, state.results.count - 1, "Up wraps backwards")

        state.clearQuery()
        XCTAssertEqual(state.query, "")
        XCTAssertEqual(state.activeIndex, -1)
        XCTAssertFalse(state.isSearching)

        state.update("没有这个设置")
        XCTAssertTrue(state.isEmptyResult)
        state.moveDown()
        XCTAssertEqual(state.activeIndex, -1, "An empty result list cannot select a row")
        XCTAssertNil(state.activeEntry)
    }

    // MARK: Trusted click, browser handoff and the native device window

    /// Only an explicit device-settings link opens the native window.
    func testDesktopChromeSettingsAndUpdatesOpenTheNativeDeviceWindow() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        XCTAssertEqual(DesktopChromeAction.resolve(URL(string: "talentsignal-desktop://settings")!,
            source: origin.url, origin: origin, mainFrame: true, userActivated: true), .settings)
        XCTAssertEqual(DesktopChromeAction.resolve(URL(string: "talentsignal-desktop://updates")!,
            source: origin.url, origin: origin, mainFrame: true, userActivated: true), .updates)
        XCTAssertNil(DesktopChromeAction.resolve(URL(string: "talentsignal-desktop://settings")!,
            source: origin.url, origin: origin, mainFrame: true, userActivated: false))
        XCTAssertNil(DesktopChromeAction.resolve(URL(string: "talentsignal-desktop://settings")!,
            source: URL(string: "https://other.example")!, origin: origin, mainFrame: true, userActivated: true))
    }

    func testDesktopChromeAccountSettingsIsAllowlistedToFixedSections() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        XCTAssertEqual(DesktopChromeAction.resolve(URL(string: "talentsignal-desktop://account-settings")!,
            source: origin.url, origin: origin, mainFrame: true, userActivated: true), .accountSettings(.overview))
        for destination in AccountSettingsDestination.allCases {
            let target = URL(string: "talentsignal-desktop://account-settings?section=\(destination.rawValue)")!
            XCTAssertEqual(DesktopChromeAction.resolve(target, source: origin.url, origin: origin,
                                                       mainFrame: true, userActivated: true),
                           .accountSettings(destination))
        }
    }

    func testDesktopChromeAccountSettingsRejectsBroadenedURLs() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let rejected = [
            "talentsignal-desktop://account-settings?section=device",
            "talentsignal-desktop://account-settings?section=workspace",
            "talentsignal-desktop://account-settings?section=unknown",
            // No identity, token or arbitrary destination may ride along.
            "talentsignal-desktop://account-settings?section=overview&token=abc",
            "talentsignal-desktop://account-settings?email=a%40b.example",
            "talentsignal-desktop://account-settings?next=https://evil.example",
        ]
        for value in rejected {
            XCTAssertNil(DesktopChromeAction.resolve(URL(string: value)!, source: origin.url, origin: origin,
                                                     mainFrame: true, userActivated: true), value)
        }
        // Non-activated or foreign-source clicks are never trusted.
        XCTAssertNil(DesktopChromeAction.resolve(URL(string: "talentsignal-desktop://account-settings")!,
            source: origin.url, origin: origin, mainFrame: true, userActivated: false))
        XCTAssertNil(DesktopChromeAction.resolve(URL(string: "talentsignal-desktop://account-settings")!,
            source: URL(string: "https://other.example")!, origin: origin, mainFrame: true, userActivated: true))
    }

    /// A Web `/workspace/settings` navigation maps onto the browser allowlist
    /// and never onto a native section.
    func testSettingsOwnedRouteOpensBrowserNotNativeWindow() throws {
        let mapping: [(String, AccountSettingsDestination)] = [
            ("https://workspace.example/workspace/settings", .overview),
            ("https://workspace.example/workspace/settings?section=overview", .overview),
            ("https://workspace.example/workspace/settings?section=account", .account),
            ("https://workspace.example/workspace/settings?section=appearance", .appearance),
            ("https://workspace.example/workspace/settings?section=connections", .connections),
            // Web-only sections fall back to the settings overview.
            ("https://workspace.example/workspace/settings?section=workspace", .overview),
            ("https://workspace.example/workspace/settings?section=versions", .overview),
            ("https://workspace.example/workspace/settings?section=advanced", .overview),
            ("https://workspace.example/workspace/settings?section=testing", .overview),
            ("https://workspace.example/workspace/settings?section=unknown", .overview),
            ("https://workspace.example/workspace/settings/diagnostics", .overview),
        ]
        for (value, expected) in mapping {
            let url = URL(string: value)!
            XCTAssertTrue(WorkspaceSurfacePolicy.isSettingsOwned(url), value)
            XCTAssertEqual(WorkspaceSurfacePolicy.WorkbenchSettingsTransition
                .accountDestination(forSettingsURL: url), expected, value)
        }
        // The native window is only reached through the explicit device link.
        for section in WorkspaceSettingsSection.allCases {
            XCTAssertFalse(AccountSettingsDestination.allCases.contains { $0.rawValue == section.rawValue })
        }
    }

    @MainActor
    func testAccountSettingsNeverOpensTheNativeWindow() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        var opened: [URL] = []
        let browser = WorkspaceBrowser(origin: origin,
                                      accountBrowser: AccountSettingsBrowser(openURL: { opened.append($0); return true }))
        browser.webView.stopLoading()
        var nativeOpened = 0
        browser.openSettings = { nativeOpened += 1 }
        XCTAssertTrue(browser.requestAccountSettings(.connections))
        XCTAssertEqual(opened, [AccountSettingsDestination.connections.url(in: origin)])
        XCTAssertEqual(nativeOpened, 0, "Account settings must never open the native device window")
        XCTAssertNil(browser.browserLaunchFailure)
    }

    /// Recovery: when the OS refuses to open the browser, the failure is
    /// recorded honestly and the rest of the device settings stay available.
    @MainActor
    func testBrowserFailureRecordsFailureAndKeepsDeviceControls() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        var allowBrowser = false
        let browser = WorkspaceBrowser(origin: origin,
                                      accountBrowser: AccountSettingsBrowser(openURL: { _ in allowBrowser }))
        browser.webView.stopLoading()
        XCTAssertFalse(browser.requestAccountSettings(.overview))
        let message = try XCTUnwrap(browser.browserLaunchFailure)
        XCTAssertTrue(message.contains("浏览器"))
        XCTAssertTrue(message.contains("仍可继续使用"))
        // The whole native inventory remains a device control with no origin.
        for section in WorkspaceSettingsSection.allCases {
            XCTAssertTrue(WorkspaceSettingsPane.resolve(selection: section).isNativeDeviceControl)
        }
        // A plain workbench retry must not erase a refused browser handoff.
        browser.retry()
        XCTAssertNotNil(browser.browserLaunchFailure)
        // Only a successful handoff clears it.
        allowBrowser = true
        XCTAssertTrue(browser.requestAccountSettings(.overview))
        XCTAssertNil(browser.browserLaunchFailure)
    }

    /// Publishing the desktop chrome resets the content controller. The settings
    /// paint guard has to survive that reset, otherwise a client-side route change
    /// could paint Web account settings inside the embedded workbench.
    @MainActor
    func testPublishingDesktopChromeKeepsThePaintGuard() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let browser = WorkspaceBrowser(origin: origin)
        browser.webView.stopLoading()
        browser.publishDesktopChrome(state: DesktopUpdatePresentation())
        let sources = browser.webView.configuration.userContentController.userScripts.map(\.source)
        XCTAssertTrue(sources.contains(WorkspaceSettingsPaintGuard.scriptSource),
                      "The route-change guard must be reinstalled after chrome is published")
        XCTAssertTrue(sources.contains { $0.contains("ts-settings-paint-guard") },
                      "The hiding stylesheet must be reinstalled after chrome is published")
        XCTAssertTrue(sources.contains { $0.contains("talentSignalDesktop") })
        XCTAssertEqual(sources.count, WorkspaceBrowser.workbenchUserScripts(chromeScript: "x").count)
    }

    // MARK: Draft preservation, handoff and recovery

    @MainActor
    func testSettingsCommandDoesNotNavigateTheConversation() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let browser = WorkspaceBrowser(origin: origin)
        browser.webView.stopLoading()
        let before = browser.webView.url
        var opened = 0
        browser.openSettings = { opened += 1 }
        browser.navigate(.settings)
        browser.navigate(.settings)
        XCTAssertEqual(opened, 2, "Every settings entry reuses the shared Settings scene.")
        XCTAssertEqual(browser.webView.url, before, "Opening settings must not navigate the conversation")
    }

    @MainActor
    func testPendingHandoffURLIsOriginValidatedBeforeTheMainWindowLoadsIt() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let navigation = WorkspaceNavigation.shared
        navigation.pendingURL = origin.url.appending(path: "/workspace/captures")
        XCTAssertTrue(origin.contains(try XCTUnwrap(navigation.pendingURL)))
        navigation.pendingURL = URL(string: "https://evil.example/workspace/captures")
        XCTAssertFalse(origin.contains(try XCTUnwrap(navigation.pendingURL)))
        navigation.pendingURL = nil
    }

    func testTrackableWorkbenchURLExcludesForeignAndSettingsRoutes() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        XCTAssertTrue(WorkspaceSurfacePolicy.isTrackableWorkbenchURL(
            origin.url.appending(path: "/workspace"), origin: origin))
        XCTAssertTrue(WorkspaceSurfacePolicy.isTrackableWorkbenchURL(
            origin.url.appending(path: "/workspace/people/1"), origin: origin))
        // Root auth/onboarding callbacks and Settings routes are never tracked.
        XCTAssertFalse(WorkspaceSurfacePolicy.isTrackableWorkbenchURL(
            URL(string: "https://workspace.example/login")!, origin: origin))
        XCTAssertFalse(WorkspaceSurfacePolicy.isTrackableWorkbenchURL(
            URL(string: "https://workspace.example/onboarding")!, origin: origin))
        XCTAssertFalse(WorkspaceSurfacePolicy.isTrackableWorkbenchURL(
            URL(string: "https://workspace.example/onboarding?edit=true&callbackUrl=%2Fworkspace%2Fsettings")!, origin: origin))
        XCTAssertFalse(WorkspaceSurfacePolicy.isTrackableWorkbenchURL(URL(string: "about:blank")!, origin: origin))
        XCTAssertFalse(WorkspaceSurfacePolicy.isTrackableWorkbenchURL(
            URL(string: "https://evil.example/workspace")!, origin: origin))
        XCTAssertFalse(WorkspaceSurfacePolicy.isTrackableWorkbenchURL(nil, origin: origin))
        XCTAssertFalse(WorkspaceSurfacePolicy.isTrackableWorkbenchURL(
            URL(string: "https://workspace.example/workspace/settings")!, origin: origin))
        XCTAssertFalse(WorkspaceSurfacePolicy.isTrackableWorkbenchURL(
            URL(string: "https://workspace.example/workspace/settings/diagnostics")!, origin: origin))
    }

    func testInitialWorkbenchTargetAndTransitionRejectRootCallbacks() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let workbench = origin.url.appending(path: "/workspace/people/1")
        let onboarding = URL(string: "https://workspace.example/onboarding?edit=true&callbackUrl=%2Fworkspace%2Fsettings")!
        let login = URL(string: "https://workspace.example/login?callbackUrl=%2Fworkspace%2Fsettings")!

        // Initial-target policy: only ordinary /workspace routes seed the target.
        XCTAssertEqual(WorkspaceSurfacePolicy.initialWorkbenchURL(initialURL: workbench, origin: origin), workbench)
        XCTAssertEqual(WorkspaceSurfacePolicy.initialWorkbenchURL(initialURL: onboarding, origin: origin), origin.entryURL)
        XCTAssertEqual(WorkspaceSurfacePolicy.initialWorkbenchURL(initialURL: login, origin: origin), origin.entryURL)
        XCTAssertEqual(WorkspaceSurfacePolicy.initialWorkbenchURL(
            initialURL: URL(string: "https://workspace.example/workspace/settings")!, origin: origin), origin.entryURL)
        XCTAssertEqual(WorkspaceSurfacePolicy.initialWorkbenchURL(initialURL: nil, origin: origin), origin.entryURL)
        XCTAssertEqual(WorkspaceSurfacePolicy.initialWorkbenchURL(
            initialURL: URL(string: "https://evil.example/workspace")!, origin: origin), origin.entryURL)

        // A root callback can never become the transition's restoreURL.
        let toSettings = AccountSettingsDestination.connections.url(in: origin)
        XCTAssertEqual(
            WorkspaceSurfacePolicy.workbenchSettingsTransition(from: onboarding, to: toSettings, origin: origin),
            .init(destination: .connections, restoreURL: nil))
        XCTAssertEqual(
            WorkspaceSurfacePolicy.workbenchSettingsTransition(from: login, to: toSettings, origin: origin),
            .init(destination: .connections, restoreURL: nil))
        XCTAssertEqual(
            WorkspaceSurfacePolicy.workbenchSettingsTransition(from: workbench, to: toSettings, origin: origin),
            .init(destination: .connections, restoreURL: workbench))
        // A foreign or non-settings destination is never a transition.
        XCTAssertNil(WorkspaceSurfacePolicy.workbenchSettingsTransition(
            from: workbench, to: URL(string: "https://evil.example/workspace/settings")!, origin: origin))
        XCTAssertNil(WorkspaceSurfacePolicy.workbenchSettingsTransition(
            from: workbench, to: workbench, origin: origin))
    }

    /// A client-side hop into Web Settings routes to the browser allowlist with
    /// the section preserved, so the workbench can restore the draft.
    func testWorkbenchSettingsTransitionRoutesAccountSettingsToTheBrowser() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let workbench = origin.url.appending(path: "/workspace/people/1")
        let transition = try XCTUnwrap(WorkspaceSurfacePolicy.workbenchSettingsTransition(
            from: workbench,
            to: URL(string: "https://workspace.example/workspace/settings?section=appearance")!,
            origin: origin))
        XCTAssertEqual(transition.destination, .appearance)
        XCTAssertEqual(transition.restoreURL, workbench)
        XCTAssertEqual(transition.destination.url(in: origin).query, "section=appearance")
    }

    func testWorkbenchRestorePlanUsesBackItemWithoutTimer() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let workbench = origin.url.appending(path: "/workspace")
        let transition = try XCTUnwrap(WorkspaceSurfacePolicy.workbenchSettingsTransition(
            from: workbench, to: AccountSettingsDestination.connections.url(in: origin), origin: origin))
        // A matching same-document back item is popped; no reload is scheduled.
        XCTAssertEqual(WorkspaceSurfacePolicy.workbenchRestorePlan(
            for: transition, canGoBack: true, backItemURL: workbench, entryURL: origin.entryURL),
            .back(workbench))
        // No/mismatched back item loads a safe URL with an explicit notice.
        guard case .load(let url, let notice) = WorkspaceSurfacePolicy.workbenchRestorePlan(
            for: transition, canGoBack: false, backItemURL: nil, entryURL: origin.entryURL) else {
            return XCTFail("expected a load fallback when there is no back item")
        }
        XCTAssertEqual(url, workbench)
        XCTAssertTrue(notice.contains("未保存的输入可能未保留"))
        guard case .load(let mismatched, _) = WorkspaceSurfacePolicy.workbenchRestorePlan(
            for: transition, canGoBack: true,
            backItemURL: origin.url.appending(path: "/workspace/people/1"), entryURL: origin.entryURL) else {
            return XCTFail("a mismatched back item must not be popped")
        }
        XCTAssertEqual(mismatched, workbench)
        // No safe prior state restores the entry URL and says the location is unknown.
        let noPrior = try XCTUnwrap(WorkspaceSurfacePolicy.workbenchSettingsTransition(
            from: nil, to: AccountSettingsDestination.account.url(in: origin), origin: origin))
        guard case .load(let entry, let entryNotice) = WorkspaceSurfacePolicy.workbenchRestorePlan(
            for: noPrior, canGoBack: true, backItemURL: workbench, entryURL: origin.entryURL) else {
            return XCTFail("expected the entry-URL fallback with no prior state")
        }
        XCTAssertEqual(entry, origin.entryURL)
        XCTAssertTrue(entryNotice.contains("无法确认先前的对话位置"))
        XCTAssertTrue(entryNotice.contains("未保存的输入可能未保留"))
    }

    @MainActor
    func testColdLoadSettingsOpenDefersUntilWired() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let browser = WorkspaceBrowser(origin: origin)
        browser.webView.stopLoading()
        // A KVO-driven request can arrive before the view wires `openSettings`.
        browser.requestSettingsOpen()
        var opened = 0
        browser.openSettings = { opened += 1 }
        XCTAssertEqual(opened, 1, "a deferred cold-load request must flush once wired")
        browser.requestSettingsOpen()
        XCTAssertEqual(opened, 2)
        // The rail and the content pane read one shared selection owner, and a
        // leftover Web section can never map back onto a native row.
        WorkspaceSettingsNavigation.shared.selection = .permissions
        XCTAssertEqual(WorkspaceSettingsPane.resolve(selection: WorkspaceSettingsNavigation.shared.selection).section,
                       WorkspaceSettingsNavigation.shared.selection)
        XCTAssertNil(WorkspaceSettingsSection(rawValue: "versions"))
    }

    /// What this proves: `WKWebView.url` KVO observes `history.pushState` on a
    /// normally loaded document, and the same-document back navigation returns
    /// the WebView to the prior URL when the URL KVO fires. That is the WebKit
    /// mechanism the compatibility fallback depends on. It is proved on a
    /// standalone WebView; the app-level guarantees (handoff, unsent draft, and
    /// that account settings never paint) are covered by the two tests below.
    @MainActor
    func testWebViewURLKVOObservesClientSidePushStateAndRestores() async throws {
        let configuration = WKWebViewConfiguration()
        let handler = TestSchemeHandler()
        configuration.setURLSchemeHandler(handler, forURLScheme: "get51test")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        let probe = TestNavigationProbe()
        webView.navigationDelegate = probe
        let loaded = expectation(description: "initial load")
        probe.onFinish = { loaded.fulfill() }
        webView.load(URLRequest(url: URL(string: "get51test://workspace.test/workspace")!))
        await fulfillment(of: [loaded], timeout: 15)

        let pushed = expectation(description: "pushState observed by url KVO")
        pushed.assertForOverFulfill = false
        var observed: [URL] = []
        let observation = webView.observe(\.url, options: [.new]) { view, _ in
            guard let url = view.url else { return }
            observed.append(url)
            if url.path == "/workspace/settings" { pushed.fulfill() }
        }
        _ = try await webView.evaluateJavaScript("history.pushState({}, '', '/workspace/settings?section=connections')")
        await fulfillment(of: [pushed], timeout: 5)
        let historyLength = try await webView.evaluateJavaScript("history.length") as? Int ?? -1
        XCTAssertTrue(observed.contains { $0.path == "/workspace/settings" },
                      "WKWebView.url KVO must observe history.pushState")
        XCTAssertEqual(historyLength, 2, "pushState must add one session history entry")
        // Proven history semantics for the no-timer restore: the back item is
        // already the previous workbench URL when the URL KVO fires.
        XCTAssertTrue(webView.canGoBack)
        XCTAssertEqual(webView.backForwardList.backItem?.url.absoluteString,
                       "get51test://workspace.test/workspace")

        webView.goBack()
        var restored = webView.url?.path == "/workspace"
        for _ in 0..<20 where !restored {
            try await Task.sleep(for: .milliseconds(100))
            restored = webView.url?.path == "/workspace"
        }
        if !restored {
            _ = try? await webView.evaluateJavaScript("history.back()")
            for _ in 0..<20 where !restored {
                try await Task.sleep(for: .milliseconds(100))
                restored = webView.url?.path == "/workspace"
            }
        }
        XCTAssertTrue(restored, "a same-document restore must return to the workbench")
        withExtendedLifetime(observation) {}
        withExtendedLifetime(handler) {}
    }

    /// The production main window must install the paint guard, and the guard
    /// must classify exactly the Web account settings routes on this origin.
    @MainActor
    func testProductionBrowserInstallsPaintGuardAndMatchesOnlySettingsRoutes() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let configuration = WorkspaceBrowser.configuration(for: origin)
        let sources = configuration.userContentController.userScripts.map(\.source)
        XCTAssertTrue(sources.contains(WorkspaceSettingsPaintGuard.scriptSource),
                      "the production workbench must install the settings paint guard")
        XCTAssertTrue(sources.contains { $0.contains("ts-settings-paint-guard") },
                      "the guard's style half must be installed too")
        let settings = try XCTUnwrap(URL(string: "https://workspace.example/workspace/settings?section=connections"))
        let drilldown = try XCTUnwrap(URL(string: "https://workspace.example/workspace/settings/link-complete"))
        let similar = try XCTUnwrap(URL(string: "https://workspace.example/workspace/settings-archive"))
        let overview = try XCTUnwrap(URL(string: "https://workspace.example/workspace/settings"))
        let foreign = try XCTUnwrap(URL(string: "https://other.example/workspace/settings"))
        XCTAssertTrue(WorkspaceSettingsPaintGuard.isSettings(url: overview, origin: origin))
        XCTAssertTrue(WorkspaceSettingsPaintGuard.isSettings(url: settings, origin: origin))
        XCTAssertTrue(WorkspaceSettingsPaintGuard.isSettings(url: drilldown, origin: origin))
        XCTAssertFalse(WorkspaceSettingsPaintGuard.isSettings(url: similar, origin: origin))
        XCTAssertFalse(WorkspaceSettingsPaintGuard.isSettings(url: foreign, origin: origin))
    }

    /// The embedded workbench must never be able to display Web account
    /// settings, even on a client-side route change that bypasses the
    /// navigation delegate, and the untouched draft must come back after the
    /// same-document restore.
    @MainActor
    func testEmbeddedWorkbenchNeverPaintsWebAccountSettingsAndKeepsDraft() async throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        // The exact configuration the app runs, so this proves the shipped
        // guard rather than a test-only script.
        let configuration = WorkspaceBrowser.configuration(for: origin)
        let handler = TestSchemeHandler(body: """
        <!doctype html><meta charset=utf-8><title>workbench</title>
        <body><input id="draft" value=""><p>workbench</p></body>
        """)
        configuration.setURLSchemeHandler(handler, forURLScheme: "get51test")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        let probe = TestNavigationProbe()
        webView.navigationDelegate = probe
        let loaded = expectation(description: "initial load")
        probe.onFinish = { loaded.fulfill() }
        webView.load(URLRequest(url: URL(string: "get51test://workspace.test/workspace")!))
        await fulfillment(of: [loaded], timeout: 15)

        _ = try await webView.evaluateJavaScript("document.getElementById('draft').value = 'unsent message'")
        let initiallyBlocked = try await settingsPaintIsBlocked(webView)
        XCTAssertFalse(initiallyBlocked, "the workbench itself must stay paintable")

        _ = try await webView.evaluateJavaScript("history.pushState({}, '', '/workspace/today')")
        let afterOrdinaryNavigation = try await settingsPaintIsBlocked(webView)
        XCTAssertFalse(afterOrdinaryNavigation, "an ordinary route change must not blank the workbench")

        _ = try await webView.evaluateJavaScript(
            "history.pushState({}, '', '/workspace/settings?section=connections')")
        let afterSettingsNavigation = try await settingsPaintIsBlocked(webView)
        XCTAssertTrue(afterSettingsNavigation,
                      "Web account settings must never be paintable inside the app")
        let styleInstalled = try await webView.evaluateJavaScript(
            "document.getElementById('ts-settings-paint-guard') !== null") as? Bool ?? false
        XCTAssertTrue(styleInstalled, "the guard must install its stylesheet at document start")
        let blockedVisibility = try await webView.evaluateJavaScript(
            "getComputedStyle(document.body).visibility") as? String
        XCTAssertEqual(blockedVisibility, "hidden",
                       "a blocked document must actually not paint")

        webView.goBack()
        var restored = webView.url?.path == "/workspace/today"
        for _ in 0..<20 where !restored {
            try await Task.sleep(for: .milliseconds(100))
            restored = webView.url?.path == "/workspace/today"
        }
        XCTAssertTrue(restored, "the same-document restore must return to the workbench")
        let afterRestore = try await settingsPaintIsBlocked(webView)
        XCTAssertFalse(afterRestore, "the workbench must be visible again after the restore")
        let draft = try await webView.evaluateJavaScript("document.getElementById('draft').value") as? String
        XCTAssertEqual(draft, "unsent message", "an unsent draft must survive the settings handoff")
        let restoredVisibility = try await webView.evaluateJavaScript(
            "getComputedStyle(document.body).visibility") as? String
        XCTAssertEqual(restoredVisibility, "visible", "the restored workbench must paint again")

        // A history call that throws changes no URL. It must never be able to
        // leave the workbench blank in place of the real page or error overlay.
        let outcome = try await webView.evaluateJavaScript("""
        (function () {
          try {
            history.pushState({ handler: function () {} }, '', '/workspace/settings');
            return 'no-throw';
          } catch (error) { return 'threw'; }
        })()
        """) as? String
        XCTAssertEqual(outcome, "threw", "an unserializable history state must throw")
        XCTAssertEqual(webView.url?.path, "/workspace/today", "a throwing history call must not navigate")
        let blockedAfterThrow = try await settingsPaintIsBlocked(webView)
        XCTAssertFalse(blockedAfterThrow,
                       "a throwing history call must leave the workbench visible")
        withExtendedLifetime(handler) {}
    }

    @MainActor
    private func settingsPaintIsBlocked(_ webView: WKWebView) async throws -> Bool {
        let value = try await webView.evaluateJavaScript(
            "document.documentElement.hasAttribute('\(WorkspaceSettingsPaintGuard.blockedAttribute)')")
        return value as? Bool ?? false
    }
}

@MainActor
private final class TestNavigationProbe: NSObject, WKNavigationDelegate {
    var onFinish: (() -> Void)?
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onFinish?()
    }
}

private final class TestSchemeHandler: NSObject, WKURLSchemeHandler, @unchecked Sendable {
    private let body: String

    init(body: String = "<!doctype html><meta charset=utf-8><title>workbench</title><body>workbench</body>") {
        self.body = body
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let data = Data(body.utf8)
        guard let url = urlSchemeTask.request.url,
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                             headerFields: ["Content-Type": "text/html; charset=utf-8"]) else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
