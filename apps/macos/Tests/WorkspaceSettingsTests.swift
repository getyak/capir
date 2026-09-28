import XCTest
@testable import TalentSignalMac

final class WorkspaceSettingsTests: XCTestCase {
    func testOnlySameOriginSettingsRoutesSelectNativeSections() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example:10443"))
        for section in WorkspaceSettingsSection.allCases where section.isWeb {
            XCTAssertEqual(WorkspaceSettingsSection.resolve(section.url(in: origin), origin: origin), section)
        }
        XCTAssertEqual(WorkspaceSettingsSection.resolve(URL(string: "https://workspace.example:10443/workspace/settings?section=overview")!, origin: origin), .profile)
        for url in ["https://workspace.example/workspace/settings", "https://other.example/workspace/settings", "https://workspace.example:10443/workspace/settings-evil", "https://workspace.example:10443/workspace/settings?section=device", "https://workspace.example:10443/workspace/settings?section=updates", "https://workspace.example:10443/workspace/settings?section=testing", "https://workspace.example:10443/workspace/settings?section=unknown", "https://workspace.example:10443/workspace/settings/diagnostics"] {
            XCTAssertNil(WorkspaceSettingsSection.resolve(URL(string: url)!, origin: origin), url)
        }
    }

    func testHelpAndDiagnosticsReplacesTheVagueMoreSettingsLabel() {
        XCTAssertEqual(WorkspaceSettingsSection.advanced.title, "帮助与诊断")
        XCTAssertEqual(WorkspaceSettingsSection.advanced.rawValue, "advanced")
        XCTAssertFalse(WorkspaceSettingsSection.allCases.contains { $0.title == "更多设置" })
        // The group heading and its only row must not read the same.
        XCTAssertEqual(WorkspaceSettingsSection.groups.last?.title, "支持")
        XCTAssertEqual(WorkspaceSettingsSection.groups.last?.sections, [.advanced])
    }

    func testProfileScopeStatesMixedAccountAndLocalAvatar() {
        XCTAssertEqual(WorkspaceSettingsSection.profile.scope, "账号 · 头像仅此设备")
        XCTAssertEqual(WorkspaceSettingsSection.account.scope, "账号")
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("个人资料").first?.scope, "账号 · 头像仅此设备")
        // Local-only surfaces stay local; workspace surfaces stay workspace-scoped.
        XCTAssertEqual(WorkspaceSettingsSection.appearance.scope, "仅此 Mac")
        XCTAssertEqual(WorkspaceSettingsSection.connections.scope, "当前空间")
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

    // MARK: Offline device state

    func testOfflineWebSelectionNeverShowsAMismatchedDevicePane() {
        XCTAssertEqual(
            WorkspaceSettingsPane.resolve(selection: .connections, connected: false),
            .requiresConnection(.connections))
        XCTAssertEqual(
            WorkspaceSettingsPane.resolve(selection: .connections, connected: false).title,
            "连接与权限")
        XCTAssertEqual(WorkspaceSettingsPane.resolve(selection: .appearance, connected: true), .web(.appearance))
        XCTAssertEqual(WorkspaceSettingsPane.resolve(selection: .profile, connected: true), .web(.profile))
    }

    func testThisDeviceAndUpdatesStayNativeWithoutAnOrigin() {
        for selection in [WorkspaceSettingsSection.device, .updates] {
            let pane = WorkspaceSettingsPane.resolve(selection: selection, connected: false)
            XCTAssertTrue(pane.isNativeDeviceControl, "\(selection) must not need the Web origin")
            XCTAssertEqual(pane.title, selection.title)
            XCTAssertFalse(pane.showsWebContent)
        }
        XCTAssertFalse(WorkspaceSettingsSection.device.isWeb)
        XCTAssertFalse(WorkspaceSettingsSection.updates.isWeb)
    }

    // MARK: Search mapping

    func testSearchFindsScreenshotAliasesWithExactScopeAndDestination() {
        for query in ["截图", "截屏", "屏幕录制", "录屏", "screenshot", "屏幕快照"] {
            let results = WorkspaceSettingsSearchEntry.search(query)
            XCTAssertTrue(results.contains { $0.id == "captures" }, "“\(query)” must reach captures")
        }
        let results = WorkspaceSettingsSearchEntry.search("截图")
        XCTAssertTrue(results.contains { $0.id == "screen-recording" })
        XCTAssertTrue(results.contains { $0.id == "capture-failure" })

        let screenRecording = results.first { $0.id == "screen-recording" }!
        XCTAssertEqual(screenRecording.scope, "此设备")
        XCTAssertEqual(screenRecording.destination, "此设备 · 打开 macOS 系统设置")

        let captures = WorkspaceSettingsSearchEntry.search("截屏").first { $0.id == "captures" }!
        XCTAssertEqual(captures.scope, "当前空间")
        XCTAssertEqual(captures.destination, "资料 · 截图与文档")
    }

    func testSearchFindsNativeSectionsAndDestinations() {
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("跟随系统").first?.id, "appearance")
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("此设备").first?.id, "device")
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("软件更新").first?.id, "updates")
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("运行记录").first?.id, "monitor")
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("功能实验室").first?.id, "lab")
        // Full-width and spaced Latin input folds to the same alias.
        XCTAssertEqual(WorkspaceSettingsSearchEntry.normalized("  SCREEN  Shot "), "screenshot")
        XCTAssertTrue(WorkspaceSettingsSearchEntry.search("ＳＣＲＥＥＮ SＨＯＴ").contains { $0.id == "captures" })
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
            case .systemSettings(let value):
                XCTAssertNotNil(URL(string: value))
            }
        }
        // An unsupported destination resolves to nil instead of a mismatched row.
        let unsupported = WorkspaceSettingsSearchEntry(
            id: "unsupported", title: "x", detail: "x", scope: "x", destination: "x", keywords: [],
            action: .workspacePath("/admin/secret"))
        XCTAssertNil(unsupported.resolvedURL(in: origin))
        XCTAssertNil(WorkspaceSettingsSearchEntry.search("没有这个设置").first)
    }

    func testSearchKeyboardWrapsClearsAndKeepsMissingResultsUnselectable() {
        var state = WorkspaceSettingsSearchState()
        state.update("截图")
        XCTAssertGreaterThanOrEqual(state.results.count, 3)
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

    // MARK: Settings to main workspace handoff

    func testSettingsURLObservationClassifiesClientSideRoutes() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        XCTAssertEqual(
            WorkspaceSurfacePolicy.classifySettingsURL(
                URL(string: "https://workspace.example/workspace/settings?section=connections")!, origin: origin),
            .settingsSection(.connections))
        XCTAssertEqual(
            WorkspaceSurfacePolicy.classifySettingsURL(
                URL(string: "https://workspace.example/workspace/settings/diagnostics")!, origin: origin),
            .settingsOwnedSubpage)
        XCTAssertEqual(
            WorkspaceSurfacePolicy.classifySettingsURL(
                URL(string: "https://workspace.example/workspace/settings/link-complete")!, origin: origin),
            .settingsOwnedSubpage)
        let extensions = origin.url.appending(path: "/workspace/extensions")
        XCTAssertEqual(WorkspaceSurfacePolicy.classifySettingsURL(extensions, origin: origin),
                       .unexpectedRoute(extensions))
        let accountEdit = URL(string: "https://workspace.example/onboarding?edit=true&callbackUrl=%2Fworkspace%2Fsettings")!
        XCTAssertEqual(WorkspaceSurfacePolicy.classifySettingsURL(accountEdit, origin: origin),
                       .unexpectedRoute(accountEdit))
        XCTAssertEqual(
            WorkspaceSurfacePolicy.classifySettingsURL(
                URL(string: "https://evil.example/workspace/extensions")!, origin: origin), .ignore)
        XCTAssertEqual(
            WorkspaceSurfacePolicy.classifySettingsURL(
                URL(string: "https://workspace.example/login?callbackUrl=%2Fworkspace%2Fsettings")!, origin: origin), .ignore)
        // Recovery reloads the last valid section, never the unexpected route.
        let restore = WorkspaceSettingsSection.connections.url(in: origin)
        XCTAssertEqual(restore.path, "/workspace/settings")
        XCTAssertTrue(WorkspaceSurfacePolicy.isSettingsOwned(restore))
    }

    func testAccountEditRouteHandsOffToMainWindowPreservingCallback() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let edit = URL(string: "https://workspace.example/onboarding?edit=true&callbackUrl=%2Fworkspace%2Fsettings")!
        XCTAssertEqual(WorkspaceSurfacePolicy.accountEditHandoffURL(
            for: edit, origin: origin, isSettingsSurface: true,
            mainFrame: true, targetsMainFrame: true, userActivated: true), edit)
        // The exact callback survives, including a settings section query.
        let sectionEdit = URL(string: "https://workspace.example/onboarding?edit=true&callbackUrl=%2Fworkspace%2Fsettings%3Fsection%3Daccount")!
        XCTAssertEqual(WorkspaceSurfacePolicy.accountEditHandoffURL(
            for: sectionEdit, origin: origin, isSettingsSurface: true,
            mainFrame: true, targetsMainFrame: true, userActivated: true), sectionEdit)
    }

    func testAccountEditHandoffRejectsBroadenedRootRoutes() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let rejected = [
            "https://workspace.example/onboarding?callbackUrl=%2Fworkspace%2Fsettings",
            "https://workspace.example/onboarding?edit=true",
            "https://workspace.example/onboarding?edit=false&callbackUrl=%2Fworkspace%2Fsettings",
            "https://workspace.example/onboarding?edit=true&callbackUrl=%2Fworkspace%2Fpeople",
            "https://workspace.example/onboarding?edit=true&callbackUrl=%2Fonboarding%3Fedit%3Dtrue",
            "https://workspace.example/onboarding?edit=true&callbackUrl=https%3A%2F%2Fevil.example%2Fx",
            "https://workspace.example/onboarding/extra?edit=true&callbackUrl=%2Fworkspace%2Fsettings",
            "https://workspace.example/onboarding2?edit=true&callbackUrl=%2Fworkspace%2Fsettings",
        ]
        for value in rejected {
            let url = URL(string: value)!
            XCTAssertNil(WorkspaceSurfacePolicy.accountEditHandoffURL(
                for: url, origin: origin, isSettingsSurface: true,
                mainFrame: true, targetsMainFrame: true, userActivated: true), value)
        }
        let edit = URL(string: "https://workspace.example/onboarding?edit=true&callbackUrl=%2Fworkspace%2Fsettings")!
        XCTAssertNil(WorkspaceSurfacePolicy.accountEditHandoffURL(
            for: edit, origin: origin, isSettingsSurface: false,
            mainFrame: true, targetsMainFrame: true, userActivated: true))
        XCTAssertNil(WorkspaceSurfacePolicy.accountEditHandoffURL(
            for: edit, origin: origin, isSettingsSurface: true,
            mainFrame: true, targetsMainFrame: true, userActivated: false))
        XCTAssertNil(WorkspaceSurfacePolicy.accountEditHandoffURL(
            for: edit, origin: origin, isSettingsSurface: true,
            mainFrame: false, targetsMainFrame: true, userActivated: true))
        XCTAssertNil(WorkspaceSurfacePolicy.accountEditHandoffURL(
            for: edit, origin: origin, isSettingsSurface: true,
            mainFrame: true, targetsMainFrame: false, userActivated: true))
    }

    func testAccountEditNavigationIsBlockedInsideSettingsWithoutHandoff() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let edit = URL(string: "https://workspace.example/onboarding?edit=true&callbackUrl=%2Fworkspace%2Fsettings")!
        // The trusted click hands off first; the non-handoff fallback blocks.
        XCTAssertNotNil(WorkspaceSurfacePolicy.accountEditHandoffURL(
            for: edit, origin: origin, isSettingsSurface: true,
            mainFrame: true, targetsMainFrame: true, userActivated: true))
        XCTAssertTrue(WorkspaceSurfacePolicy.blocksAccountEditNavigation(
            url: edit, origin: origin, isSettingsSurface: true,
            mainFrame: true, targetsMainFrame: true))

        // Account/auth and unrelated routes are preserved.
        let preserved = [
            "https://workspace.example/login?callbackUrl=%2Fworkspace%2Fsettings",
            "https://workspace.example/workspace/settings/link-complete",
            "https://workspace.example/workspace/settings?section=account",
            "https://workspace.example/workspace/settings/diagnostics",
            "https://workspace.example/onboarding?callbackUrl=%2Fworkspace%2Fsettings",
            "https://workspace.example/onboarding?edit=false&callbackUrl=%2Fworkspace%2Fsettings",
        ]
        for value in preserved {
            XCTAssertFalse(WorkspaceSurfacePolicy.blocksAccountEditNavigation(
                url: URL(string: value)!, origin: origin, isSettingsSurface: true,
                mainFrame: true, targetsMainFrame: true), value)
        }
        // Cross-origin, non-settings surface, iframe and lookalike roots are not blocked.
        XCTAssertFalse(WorkspaceSurfacePolicy.blocksAccountEditNavigation(
            url: URL(string: "https://evil.example/onboarding?edit=true&callbackUrl=%2Fworkspace%2Fsettings")!,
            origin: origin, isSettingsSurface: true, mainFrame: true, targetsMainFrame: true))
        XCTAssertFalse(WorkspaceSurfacePolicy.blocksAccountEditNavigation(
            url: edit, origin: origin, isSettingsSurface: false, mainFrame: true, targetsMainFrame: true))
        XCTAssertFalse(WorkspaceSurfacePolicy.blocksAccountEditNavigation(
            url: edit, origin: origin, isSettingsSurface: true, mainFrame: false, targetsMainFrame: true))
        XCTAssertFalse(WorkspaceSurfacePolicy.blocksAccountEditNavigation(
            url: edit, origin: origin, isSettingsSurface: true, mainFrame: true, targetsMainFrame: false))
        XCTAssertFalse(WorkspaceSurfacePolicy.blocksAccountEditNavigation(
            url: URL(string: "https://workspace.example/onboarding2?edit=true&callbackUrl=%2Fworkspace%2Fsettings")!,
            origin: origin, isSettingsSurface: true, mainFrame: true, targetsMainFrame: true))
    }

    func testSettingsRetryNeverReloadsAnUnexpectedRoute() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let extensions = origin.url.appending(path: "/workspace/extensions")
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsRetryURL(
            currentURL: extensions, origin: origin, lastSection: .connections),
            WorkspaceSettingsSection.connections.url(in: origin))
        let accountEdit = URL(string: "https://workspace.example/onboarding?edit=true&callbackUrl=%2Fworkspace%2Fsettings")!
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsRetryURL(
            currentURL: accountEdit, origin: origin, lastSection: .appearance),
            WorkspaceSettingsSection.appearance.url(in: origin))
        // A valid settings URL and an unrelated login route pass through.
        let connections = WorkspaceSettingsSection.connections.url(in: origin)
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsRetryURL(
            currentURL: connections, origin: origin, lastSection: .appearance), connections)
        let login = URL(string: "https://workspace.example/login")!
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsRetryURL(
            currentURL: login, origin: origin, lastSection: .appearance), login)
        XCTAssertNil(WorkspaceSurfacePolicy.settingsRetryURL(currentURL: nil, origin: origin, lastSection: .appearance))
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsRetryURL(
            currentURL: extensions, origin: origin, lastSection: nil),
            WorkspaceSettingsSection.profile.url(in: origin))
    }

    func testSettingsLinkToOrdinaryDestinationHandsOffToMainWindow() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let ordinary = ["/workspace", "/workspace/extensions", "/workspace/captures",
                        "/workspace/monitor", "/workspace/boundaries", "/workspace/lab",
                        "/workspace/preferences", "/workspace/people"]
        for path in ordinary {
            let url = origin.url.appending(path: path)
            XCTAssertEqual(
                WorkspaceSurfacePolicy.mainWindowHandoffURL(
                    for: url, origin: origin, isSettingsSurface: true,
                    mainFrame: true, targetsMainFrame: true, userActivated: true),
                url, path)
            XCTAssertTrue(WorkspaceSurfacePolicy.blocksWorkbenchNavigation(
                url: url, origin: origin, isSettingsSurface: true,
                mainFrame: true, targetsMainFrame: true), path)
        }
    }

    func testSettingsOwnedAndCrossOriginRoutesStayInsideSettings() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let settingsURLs = [
            "https://workspace.example/workspace/settings",
            "https://workspace.example/workspace/settings?section=connections",
            "https://workspace.example/workspace/settings?section=device",
            "https://workspace.example/workspace/settings/diagnostics",
            "https://workspace.example/workspace/settings/testing",
            "https://workspace.example/workspace/settings/login-methods",
            "https://workspace.example/workspace/settings/conflict",
            "https://workspace.example/workspace/settings/link-complete",
        ]
        for value in settingsURLs {
            let url = URL(string: value)!
            XCTAssertTrue(WorkspaceSurfacePolicy.isSettingsOwned(url), value)
            XCTAssertNil(WorkspaceSurfacePolicy.mainWindowHandoffURL(
                for: url, origin: origin, isSettingsSurface: true,
                mainFrame: true, targetsMainFrame: true, userActivated: true), value)
            XCTAssertFalse(WorkspaceSurfacePolicy.blocksWorkbenchNavigation(
                url: url, origin: origin, isSettingsSurface: true,
                mainFrame: true, targetsMainFrame: true), value)
        }
        // Cross-origin, non-main-frame, non-activated and non-settings links never hand off.
        let crossOrigin = URL(string: "https://evil.example/workspace/extensions")!
        XCTAssertNil(WorkspaceSurfacePolicy.mainWindowHandoffURL(
            for: crossOrigin, origin: origin, isSettingsSurface: true,
            mainFrame: true, targetsMainFrame: true, userActivated: true))
        let extensions = origin.url.appending(path: "/workspace/extensions")
        XCTAssertNil(WorkspaceSurfacePolicy.mainWindowHandoffURL(
            for: extensions, origin: origin, isSettingsSurface: true,
            mainFrame: true, targetsMainFrame: true, userActivated: false))
        XCTAssertNil(WorkspaceSurfacePolicy.mainWindowHandoffURL(
            for: extensions, origin: origin, isSettingsSurface: false,
            mainFrame: true, targetsMainFrame: true, userActivated: true))
        XCTAssertNil(WorkspaceSurfacePolicy.mainWindowHandoffURL(
            for: extensions, origin: origin, isSettingsSurface: true,
            mainFrame: false, targetsMainFrame: true, userActivated: true))
        XCTAssertFalse(WorkspaceSurfacePolicy.blocksWorkbenchNavigation(
            url: extensions, origin: origin, isSettingsSurface: false,
            mainFrame: true, targetsMainFrame: true))
        // Auth recovery routes are not workspace destinations and never hand off.
        let login = URL(string: "https://workspace.example/login?callbackUrl=%2Fworkspace%2Fsettings")!
        XCTAssertNil(WorkspaceSurfacePolicy.mainWindowHandoffURL(
            for: login, origin: origin, isSettingsSurface: true,
            mainFrame: true, targetsMainFrame: true, userActivated: true))
    }

    @MainActor
    func testPendingHandoffURLIsOriginValidatedBeforeTheMainWindowLoadsIt() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let navigation = WorkspaceNavigation.shared
        navigation.pendingURL = origin.url.appending(path: "/workspace/extensions")
        XCTAssertTrue(origin.contains(try XCTUnwrap(navigation.pendingURL)))
        navigation.pendingURL = URL(string: "https://evil.example/workspace/extensions")
        XCTAssertFalse(origin.contains(try XCTUnwrap(navigation.pendingURL)))
        navigation.pendingURL = nil
    }

    // MARK: Single settings surface

    func testDesktopChromeSettingsAndUpdatesConvergeOnTheOneSettingsWindow() throws {
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
        XCTAssertEqual(browser.webView.url, before)
        XCTAssertFalse(browser.isSettingsSurface)
        let settings = WorkspaceBrowser(origin: origin, settings: true, initialURL: WorkspaceSettingsSection.profile.url(in: origin))
        settings.webView.stopLoading()
        XCTAssertTrue(settings.isSettingsSurface)
        XCTAssertEqual(settings.webView.configuration.websiteDataStore.identifier, browser.webView.configuration.websiteDataStore.identifier)
    }

    @MainActor
    func testWorkspaceSettingsShortcutTargetsTheWorkspaceSection() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let browser = WorkspaceBrowser(origin: origin)
        browser.webView.stopLoading()
        var opened = 0
        browser.openSettings = { opened += 1 }
        // The Shift-Command-comma command pre-selects Workspace, then opens the
        // one Settings window; opening must not clobber that selection.
        WorkspaceSettingsNavigation.shared.selection = .workspace
        browser.navigate(.settings)
        XCTAssertEqual(opened, 1)
        XCTAssertEqual(WorkspaceSettingsNavigation.shared.selection, .workspace)
    }

    @MainActor
    func testSettingsWindowKeepsTheSameSelectionAcrossEntryPoints() throws {
        let navigation = WorkspaceSettingsNavigation.shared
        navigation.selection = .profile
        XCTAssertEqual(WorkspaceSettingsNavigation.shared.selection, .profile)
        // The rail and the content pane read one shared selection owner.
        XCTAssertEqual(WorkspaceSettingsPane.resolve(selection: navigation.selection, connected: false).section,
                       navigation.selection)
    }
}
