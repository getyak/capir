import XCTest
import WebKit
@testable import TalentSignalMac

final class WorkspaceSettingsTests: XCTestCase {
    func testOnlySameOriginSettingsRoutesSelectNativeSections() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example:10443"))
        for section in WorkspaceSettingsSection.allCases where section.isWeb {
            XCTAssertEqual(WorkspaceSettingsSection.resolve(section.url(in: origin), origin: origin), section)
        }
        XCTAssertEqual(WorkspaceSettingsSection.resolve(URL(string: "https://workspace.example:10443/workspace/settings?section=overview")!, origin: origin), .profile)
        for url in ["https://workspace.example/workspace/settings", "https://other.example/workspace/settings", "https://workspace.example:10443/workspace/settings-evil", "https://workspace.example:10443/workspace/settings?section=device", "https://workspace.example:10443/workspace/settings?section=updates", "https://workspace.example:10443/workspace/settings?section=advanced", "https://workspace.example:10443/workspace/settings?section=testing", "https://workspace.example:10443/workspace/settings?section=unknown", "https://workspace.example:10443/workspace/settings/diagnostics"] {
            XCTAssertNil(WorkspaceSettingsSection.resolve(URL(string: url)!, origin: origin), url)
        }
    }

    func testHelpAndDiagnosticsReplacesTheVagueMoreSettingsLabel() {
        XCTAssertEqual(WorkspaceSettingsSection.advanced.title, "帮助与诊断")
        XCTAssertEqual(WorkspaceSettingsSection.advanced.rawValue, "advanced")
        XCTAssertFalse(WorkspaceSettingsSection.allCases.contains { $0.title == "更多设置" })
        // The group heading and its rows must not read the same.
        XCTAssertEqual(WorkspaceSettingsSection.groups.last?.title, "支持")
        XCTAssertEqual(WorkspaceSettingsSection.groups.last?.sections, [.versions, .advanced])
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

    func testVersionsSectionIsWebOwnedAndUpdatesIsNativelyLabeled() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        XCTAssertEqual(WorkspaceSettingsSection.versions.title, "版本与状态")
        XCTAssertTrue(WorkspaceSettingsSection.versions.isWeb)
        XCTAssertEqual(WorkspaceSettingsSection.versions.url(in: origin).query, "section=versions")
        XCTAssertEqual(WorkspaceSettingsSection.resolve(
            WorkspaceSettingsSection.versions.url(in: origin), origin: origin), .versions)
        XCTAssertEqual(WorkspaceSettingsPane.resolve(selection: .versions, connected: true), .web(.versions))
        XCTAssertEqual(WorkspaceSettingsPane.resolve(selection: .versions, connected: false), .requiresConnection(.versions))

        // Updates keeps its native/offline pane but no longer shares an
        // ambiguous version title with the Web versions section.
        XCTAssertEqual(WorkspaceSettingsSection.updates.title, "Mac 软件更新")
        XCTAssertFalse(WorkspaceSettingsSection.updates.isWeb)
        XCTAssertEqual(WorkspaceSettingsSection.updates.scope, "仅此 Mac · 本机保存")
        XCTAssertNotEqual(WorkspaceSettingsSection.updates.title, WorkspaceSettingsSection.versions.title)
    }

    func testAdvancedHelpIsANativeOfflineSupportPane() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        XCTAssertFalse(WorkspaceSettingsSection.advanced.isWeb)
        XCTAssertEqual(WorkspaceSettingsSection.advanced.title, "帮助与诊断")
        let pane = WorkspaceSettingsPane.resolve(selection: .advanced, connected: false)
        XCTAssertEqual(pane, .support)
        XCTAssertTrue(pane.isNativeSupport)
        XCTAssertEqual(pane.title, "帮助与诊断")
        XCTAssertFalse(pane.showsWebContent)
        // A native support pane never embeds the Web advanced subpage.
        XCTAssertNil(WorkspaceSettingsSection.resolve(
            WorkspaceSettingsSection.advanced.url(in: origin), origin: origin))
    }

    func testSupportHandoffDestinationsAreExactAndSameOrigin() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let destinations = WorkspaceSettingsSection.supportDestinations
        XCTAssertEqual(destinations.map(\.id), ["diagnostics", "monitor", "boundaries"])
        XCTAssertEqual(destinations.map(\.path), [
            "/workspace/settings/diagnostics",
            "/workspace/monitor",
            "/workspace/boundaries",
        ])
        for destination in destinations {
            let url = try XCTUnwrap(destination.url(in: origin))
            XCTAssertTrue(origin.contains(url), destination.id)
            XCTAssertEqual(url, origin.url.appending(path: destination.path))
        }
        // The diagnostics handoff is settings-owned and the other two are
        // ordinary workspace routes; all are opened in the main window.
        let diagnostics = try XCTUnwrap(destinations[0].url(in: origin))
        XCTAssertTrue(WorkspaceSurfacePolicy.isSettingsOwned(diagnostics))
        XCTAssertFalse(WorkspaceSurfacePolicy.isOrdinaryWorkspaceDestination(diagnostics))
        for destination in destinations.dropFirst() {
            let url = try XCTUnwrap(destination.url(in: origin))
            XCTAssertTrue(WorkspaceSurfacePolicy.isOrdinaryWorkspaceDestination(url), destination.id)
        }
    }

    func testDesktopChromePayloadCarriesAppVersionAndUpdateState() {
        var presentation = DesktopUpdatePresentation()
        presentation.phase = .available
        presentation.version = "0.2.0"
        presentation.progress = 42
        let payload = WorkspaceSurfacePolicy.desktopChromePayload(
            surface: "settings", presentation: presentation, appVersion: "0.1.0 (29)")
        XCTAssertEqual(payload["protocolVersion"] as? Int, 1)
        XCTAssertEqual(payload["surface"] as? String, "settings")
        XCTAssertEqual(payload["appVersion"] as? String, "0.1.0 (29)")
        XCTAssertEqual(payload["availableVersion"] as? String, "0.2.0")
        XCTAssertEqual(payload["phase"] as? String, "available")
        XCTAssertEqual(payload["progress"] as? Int, 42)
        XCTAssertTrue(payload["offerID"] is NSNull)
        XCTAssertNoThrow(try JSONSerialization.data(withJSONObject: payload))
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

    func testSearchFindsVersionsAndLocalMacUpdateWithExactDestinations() throws {
        let versions = try XCTUnwrap(WorkspaceSettingsSearchEntry.search("版本与状态").first { $0.id == "versions" })
        XCTAssertEqual(versions.action, .section(.versions))
        XCTAssertEqual(versions.destination, "设置 · 版本与状态")
        XCTAssertEqual(versions.scope, "各组件分别显示")
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("后端版本").first?.id, "versions")

        let updates = try XCTUnwrap(WorkspaceSettingsSearchEntry.search("Mac 软件更新").first { $0.id == "updates" })
        XCTAssertEqual(updates.action, .section(.updates))
        XCTAssertEqual(updates.destination, "设置 · Mac 软件更新")
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("本机更新").first?.id, "updates")
        // The two version/update destinations stay distinct.
        XCTAssertNotEqual(versions.action, updates.action)
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

    func testWorkbenchSettingsTransitionClassifiesClientSideSettingsRoutes() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let workbench = origin.url.appending(path: "/workspace")
        XCTAssertEqual(
            WorkspaceSurfacePolicy.workbenchSettingsTransition(
                from: workbench, to: WorkspaceSettingsSection.connections.url(in: origin), origin: origin),
            .init(section: .connections, restoreURL: workbench))
        XCTAssertEqual(
            WorkspaceSurfacePolicy.workbenchSettingsTransition(
                from: workbench, to: URL(string: "https://workspace.example/workspace/settings")!, origin: origin),
            .init(section: .profile, restoreURL: workbench))
        XCTAssertEqual(
            WorkspaceSurfacePolicy.workbenchSettingsTransition(
                from: workbench, to: URL(string: "https://workspace.example/workspace/settings?section=overview")!, origin: origin),
            .init(section: .profile, restoreURL: workbench))
        // A deep workbench URL survives as the restore target.
        let person = origin.url.appending(path: "/workspace/people/abc")
        XCTAssertEqual(
            WorkspaceSurfacePolicy.workbenchSettingsTransition(
                from: person, to: WorkspaceSettingsSection.appearance.url(in: origin), origin: origin),
            .init(section: .appearance, restoreURL: person))
        // No prior workbench state still opens Settings with nothing to restore.
        XCTAssertEqual(
            WorkspaceSurfacePolicy.workbenchSettingsTransition(
                from: nil, to: WorkspaceSettingsSection.account.url(in: origin), origin: origin),
            .init(section: .account, restoreURL: nil))
        // A Settings URL is never a valid restore target.
        XCTAssertEqual(
            WorkspaceSurfacePolicy.workbenchSettingsTransition(
                from: WorkspaceSettingsSection.account.url(in: origin),
                to: WorkspaceSettingsSection.connections.url(in: origin), origin: origin),
            .init(section: .connections, restoreURL: nil))
        // Native-only sections, unknown sections, settings-owned subpages and
        // foreign origins must not be intercepted as client-side transitions.
        for value in [
            "https://workspace.example/workspace/settings?section=device",
            "https://workspace.example/workspace/settings?section=updates",
            "https://workspace.example/workspace/settings?section=testing",
            "https://workspace.example/workspace/settings?section=unknown",
            "https://workspace.example/workspace/settings/diagnostics",
            "https://workspace.example/workspace/settings/testing",
            "https://workspace.example/workspace/settings/link-complete",
            "https://evil.example/workspace/settings",
        ] {
            XCTAssertNil(WorkspaceSurfacePolicy.workbenchSettingsTransition(
                from: workbench, to: URL(string: value)!, origin: origin), value)
        }
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

    // MARK: WebKit client-side navigation evidence

    /// Proves `WKWebView.url` KVO observes `history.pushState` on a normally
    /// loaded (HTTP-like) document, and that a same-document restore returns
    /// the WebView to the prior workbench URL. This is the evidence behind the
    /// narrow compatibility fallback.
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
        let toSettings = WorkspaceSettingsSection.connections.url(in: origin)
        XCTAssertEqual(
            WorkspaceSurfacePolicy.workbenchSettingsTransition(from: onboarding, to: toSettings, origin: origin),
            .init(section: .connections, restoreURL: nil))
        XCTAssertEqual(
            WorkspaceSurfacePolicy.workbenchSettingsTransition(from: login, to: toSettings, origin: origin),
            .init(section: .connections, restoreURL: nil))
        XCTAssertEqual(
            WorkspaceSurfacePolicy.workbenchSettingsTransition(from: workbench, to: toSettings, origin: origin),
            .init(section: .connections, restoreURL: workbench))
    }

    func testWorkbenchRestorePlanUsesBackItemWithoutTimer() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let workbench = origin.url.appending(path: "/workspace")
        let transition = try XCTUnwrap(WorkspaceSurfacePolicy.workbenchSettingsTransition(
            from: workbench, to: WorkspaceSettingsSection.connections.url(in: origin), origin: origin))
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
            from: nil, to: WorkspaceSettingsSection.account.url(in: origin), origin: origin))
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
        browser.requestSettingsOpen(.connections)
        XCTAssertEqual(WorkspaceSettingsNavigation.shared.selection, .connections)
        var opened = 0
        browser.openSettings = { opened += 1 }
        XCTAssertEqual(opened, 1, "a deferred cold-load request must flush once wired")
        browser.requestSettingsOpen(.appearance)
        XCTAssertEqual(opened, 2)
        XCTAssertEqual(WorkspaceSettingsNavigation.shared.selection, .appearance)
        // Omitting the section preserves the current selection.
        browser.requestSettingsOpen()
        XCTAssertEqual(opened, 3)
        XCTAssertEqual(WorkspaceSettingsNavigation.shared.selection, .appearance)
    }

    // MARK: Settings Web compatibility gate

    func testSettingsSurfaceStatusRequiresCleanProvenProof() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let settings = URL(string: "https://workspace.example/workspace/settings")!
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: settings, hasSettingsRootMarker: true,
                       innerNavigationHidden: true, workspaceChromeHidden: true),
            origin: origin), .supported)
        // Marker present but the settings nav or the workspace chrome still shows.
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: settings, hasSettingsRootMarker: true,
                       innerNavigationHidden: false, workspaceChromeHidden: true),
            origin: origin), .unsupported)
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: settings, hasSettingsRootMarker: true,
                       innerNavigationHidden: true, workspaceChromeHidden: false),
            origin: origin), .unsupported)
        // Old release: no marker at all on the exact settings route.
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: settings, hasSettingsRootMarker: false,
                       innerNavigationHidden: true, workspaceChromeHidden: true),
            origin: origin), .unsupported)
        // Cross-origin and unparseable URLs never render.
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: URL(string: "https://evil.example/workspace/settings")!, hasSettingsRootMarker: true,
                       innerNavigationHidden: true, workspaceChromeHidden: true),
            origin: origin), .unknown)
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: nil, hasSettingsRootMarker: true,
                       innerNavigationHidden: true, workspaceChromeHidden: true),
            origin: origin), .unknown)
    }

    func testSettingsSurfaceStatusRoutesLoginAndSubpagesToHandoff() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let login = URL(string: "https://workspace.example/login?callbackUrl=%2Fworkspace%2Fsettings")!
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: login, hasSettingsRootMarker: false,
                       innerNavigationHidden: true, workspaceChromeHidden: true),
            origin: origin), .loginRequired(login))

        let diagnostics = URL(string: "https://workspace.example/workspace/settings/diagnostics")!
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: diagnostics, hasSettingsRootMarker: false,
                       innerNavigationHidden: true, workspaceChromeHidden: true),
            origin: origin), .handoff(diagnostics))
        // A clean proof still renders a settings-owned subpage.
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: diagnostics, hasSettingsRootMarker: true,
                       innerNavigationHidden: true, workspaceChromeHidden: true),
            origin: origin), .supported)
        // An unknown settings section is settings-owned but not a native section.
        let testing = URL(string: "https://workspace.example/workspace/settings?section=testing")!
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: testing, hasSettingsRootMarker: false,
                       innerNavigationHidden: true, workspaceChromeHidden: true),
            origin: origin), .handoff(testing))
        // A non-settings same-origin route is unsupported, never a handoff.
        let people = URL(string: "https://workspace.example/workspace/people")!
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: people, hasSettingsRootMarker: false,
                       innerNavigationHidden: true, workspaceChromeHidden: true),
            origin: origin), .unsupported)
    }

    func testSettingsSurfaceProbeParsesJavaScriptResult() throws {
        let result: [String: Any] = [
            "href": "https://workspace.example/workspace/settings?section=connections",
            "hasMarker": true, "innerNavHidden": false, "workspaceChromeHidden": true,
        ]
        let probe = try XCTUnwrap(WorkspaceSurfacePolicy.settingsSurfaceProbe(fromJavaScriptResult: result))
        XCTAssertEqual(probe.url, URL(string: "https://workspace.example/workspace/settings?section=connections"))
        XCTAssertTrue(probe.hasSettingsRootMarker)
        XCTAssertFalse(probe.innerNavigationHidden)
        XCTAssertTrue(probe.workspaceChromeHidden)
        XCTAssertNil(WorkspaceSurfacePolicy.settingsSurfaceProbe(fromJavaScriptResult: ["nope": 1]))
        XCTAssertNil(WorkspaceSurfacePolicy.settingsSurfaceProbe(fromJavaScriptResult: nil))
    }

    func testCompatibilityHandoffTargetsAreNotReinterceptedAsNativeSettings() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        // The unsupported/old-release next action opens the workbench entry; the
        // main browser must load it instead of bouncing back to native Settings.
        XCTAssertNil(WorkspaceSettingsSection.resolve(origin.entryURL, origin: origin))
        // Subpage, unknown-section and login handoffs are likewise not native
        // settings routes, so the main window renders them directly.
        for value in [
            "https://workspace.example/workspace/settings/diagnostics",
            "https://workspace.example/workspace/settings?section=testing",
            "https://workspace.example/workspace/settings/link-complete",
            "https://workspace.example/login?callbackUrl=%2Fworkspace%2Fsettings",
        ] {
            XCTAssertNil(WorkspaceSettingsSection.resolve(URL(string: value)!, origin: origin), value)
        }
    }

    func testSettingsProbeIsCurrentRejectsStaleDocuments() throws {
        let expected = URL(string: "https://workspace.example/workspace/settings?section=connections")!
        let other = URL(string: "https://workspace.example/workspace/settings?section=appearance")!
        XCTAssertTrue(WorkspaceSurfacePolicy.settingsProbeIsCurrent(
            generation: 3, currentGeneration: 3, loading: false,
            expectedURL: expected, currentURL: expected, probeURL: expected))
        // A completion from an older document invocation is ignored even when
        // the URL happens to match.
        XCTAssertFalse(WorkspaceSurfacePolicy.settingsProbeIsCurrent(
            generation: 2, currentGeneration: 3, loading: false,
            expectedURL: expected, currentURL: expected, probeURL: expected))
        // A navigation in flight must never be revealed.
        XCTAssertFalse(WorkspaceSurfacePolicy.settingsProbeIsCurrent(
            generation: 3, currentGeneration: 3, loading: true,
            expectedURL: expected, currentURL: expected, probeURL: expected))
        // The current URL moved on (SPA or new load): the old result is stale.
        XCTAssertFalse(WorkspaceSurfacePolicy.settingsProbeIsCurrent(
            generation: 3, currentGeneration: 3, loading: false,
            expectedURL: expected, currentURL: other, probeURL: expected))
        // The result reports a different document than the invocation expected.
        XCTAssertFalse(WorkspaceSurfacePolicy.settingsProbeIsCurrent(
            generation: 3, currentGeneration: 3, loading: false,
            expectedURL: expected, currentURL: expected, probeURL: other))
        XCTAssertFalse(WorkspaceSurfacePolicy.settingsProbeIsCurrent(
            generation: 3, currentGeneration: 3, loading: false,
            expectedURL: nil, currentURL: expected, probeURL: expected))
        // No usable result from a current invocation may still retry.
        XCTAssertTrue(WorkspaceSurfacePolicy.settingsProbeIsCurrent(
            generation: 3, currentGeneration: 3, loading: false,
            expectedURL: expected, currentURL: expected, probeURL: nil))
    }

    func testSettingsSurfaceStatusForProbeSupportsOnlyCurrentDocument() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let current = URL(string: "https://workspace.example/workspace/settings?section=connections")!
        let clean = WorkspaceSurfacePolicy.SettingsWebSurfaceProbe(
            url: current, hasSettingsRootMarker: true,
            innerNavigationHidden: true, workspaceChromeHidden: true)
        // A clean probe from an older invocation must not reveal the WebView.
        XCTAssertNil(WorkspaceSurfacePolicy.settingsSurfaceStatusForProbe(
            generation: 1, currentGeneration: 2, loading: false,
            expectedURL: current, currentURL: current, probe: clean, origin: origin))
        XCTAssertNil(WorkspaceSurfacePolicy.settingsSurfaceStatusForProbe(
            generation: 2, currentGeneration: 2, loading: true,
            expectedURL: current, currentURL: current, probe: clean, origin: origin))
        XCTAssertNil(WorkspaceSurfacePolicy.settingsSurfaceStatusForProbe(
            generation: 2, currentGeneration: 2, loading: false,
            expectedURL: current, currentURL: current,
            probe: .init(url: URL(string: "https://workspace.example/workspace/settings?section=appearance")!,
                         hasSettingsRootMarker: true, innerNavigationHidden: true, workspaceChromeHidden: true),
            origin: origin))
        // Current invocation: the clean proof is accepted.
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatusForProbe(
            generation: 2, currentGeneration: 2, loading: false,
            expectedURL: current, currentURL: current, probe: clean, origin: origin), .supported)
        // Current invocation with an old release is classified honestly.
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatusForProbe(
            generation: 2, currentGeneration: 2, loading: false,
            expectedURL: current, currentURL: current,
            probe: .init(url: current, hasSettingsRootMarker: false,
                         innerNavigationHidden: true, workspaceChromeHidden: true),
            origin: origin), .unsupported)
        // A missing result is retryable, not a reveal.
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatusForProbe(
            generation: 2, currentGeneration: 2, loading: false,
            expectedURL: current, currentURL: current, probe: nil, origin: origin), .unknown)
    }

    func testSettingsProbeOutcomeRetriesAbsentMarkerWithinTheBound() throws {
        // An absent root marker (old or still-streaming content) gets the same
        // bounded retry window as a marker whose chrome is not hidden yet.
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsProbeOutcome(
            status: .unsupported, attempts: 1, maxAttempts: 5), .retry)
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsProbeOutcome(
            status: .unsupported, attempts: 4, maxAttempts: 5), .retry)
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsProbeOutcome(
            status: .unsupported, attempts: 5, maxAttempts: 5), .apply(.unsupported))
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsProbeOutcome(
            status: .unknown, attempts: 1, maxAttempts: 5), .retry)
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsProbeOutcome(
            status: .unknown, attempts: 5, maxAttempts: 5), .apply(.unknown))
        // Definitive outcomes apply immediately.
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsProbeOutcome(
            status: .supported, attempts: 1, maxAttempts: 5), .apply(.supported))
        let login = URL(string: "https://workspace.example/login")!
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsProbeOutcome(
            status: .loginRequired(login), attempts: 1, maxAttempts: 5), .apply(.loginRequired(login)))
    }

    @MainActor
    func testSettingsSurfaceProbeDetectsCleanSupportedRelease() async throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let handler = FixtureSchemeHandler()
        handler.routes["/workspace/settings"] = Self.supportedFixture
        let flags = try await runSettingsProbe(handler: handler, path: "/workspace/settings")
        XCTAssertTrue(flags.hasMarker)
        XCTAssertTrue(flags.innerNavHidden)
        XCTAssertTrue(flags.chromeHidden)
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: URL(string: "https://workspace.example/workspace/settings")!,
                       hasSettingsRootMarker: flags.hasMarker, innerNavigationHidden: flags.innerNavHidden,
                       workspaceChromeHidden: flags.chromeHidden),
            origin: origin), .supported)
    }

    @MainActor
    func testSettingsSurfaceProbeRejectsOldReleaseAndPartialChrome() async throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let settings = URL(string: "https://workspace.example/workspace/settings")!

        let oldHandler = FixtureSchemeHandler()
        oldHandler.routes["/workspace/settings"] = Self.oldFixture
        let oldFlags = try await runSettingsProbe(handler: oldHandler, path: "/workspace/settings")
        XCTAssertFalse(oldFlags.hasMarker)
        XCTAssertFalse(oldFlags.chromeHidden)
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: settings, hasSettingsRootMarker: oldFlags.hasMarker,
                       innerNavigationHidden: oldFlags.innerNavHidden, workspaceChromeHidden: oldFlags.chromeHidden),
            origin: origin), .unsupported)
        // The same old document classifies login and subpages honestly.
        let login = URL(string: "https://workspace.example/login")!
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: login, hasSettingsRootMarker: oldFlags.hasMarker,
                       innerNavigationHidden: oldFlags.innerNavHidden, workspaceChromeHidden: oldFlags.chromeHidden),
            origin: origin), .loginRequired(login))
        let diagnostics = URL(string: "https://workspace.example/workspace/settings/diagnostics")!
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: diagnostics, hasSettingsRootMarker: oldFlags.hasMarker,
                       innerNavigationHidden: oldFlags.innerNavHidden, workspaceChromeHidden: oldFlags.chromeHidden),
            origin: origin), .handoff(diagnostics))

        // Marker present but the workspace chrome is still visible: not supported.
        let partialHandler = FixtureSchemeHandler()
        partialHandler.routes["/workspace/settings"] = Self.partialFixture
        let partialFlags = try await runSettingsProbe(handler: partialHandler, path: "/workspace/settings")
        XCTAssertTrue(partialFlags.hasMarker)
        XCTAssertFalse(partialFlags.chromeHidden)
        XCTAssertEqual(WorkspaceSurfacePolicy.settingsSurfaceStatus(
            for: .init(url: settings, hasSettingsRootMarker: partialFlags.hasMarker,
                       innerNavigationHidden: partialFlags.innerNavHidden, workspaceChromeHidden: partialFlags.chromeHidden),
            origin: origin), .unsupported)
    }

    private static let supportedFixture = """
    <!doctype html><html><head><meta charset="utf-8"><style>
      aside[aria-label="Talent Signal 工作台"] { display: none; }
      nav[aria-label="工作台导航"] { display: none; }
      [data-settings-navigation] { display: none; }
    </style></head><body>
      <aside aria-label="Talent Signal 工作台"><nav aria-label="工作台导航">rail</nav></aside>
      <div id="workspace-content">
        <main id="main-content" data-desktop-settings-surface="1">
          <div data-settings-navigation>设置分区</div>
          <h2>连接与权限</h2>
        </main>
      </div>
    </body></html>
    """

    private static let oldFixture = """
    <!doctype html><html><head><meta charset="utf-8"></head><body>
      <aside aria-label="Talent Signal 工作台"><nav aria-label="工作台导航">rail</nav></aside>
      <div id="workspace-content">
        <main id="main-content"><h2>设置</h2><div data-settings-navigation>设置分区</div></main>
      </div>
    </body></html>
    """

    private static let partialFixture = """
    <!doctype html><html><head><meta charset="utf-8"></head><body>
      <aside aria-label="Talent Signal 工作台"><nav aria-label="工作台导航">rail</nav></aside>
      <div id="workspace-content">
        <main id="main-content" data-desktop-settings-surface="1">
          <div data-settings-navigation>设置分区</div>
        </main>
      </div>
    </body></html>
    """

    @MainActor
    private func runSettingsProbe(handler: FixtureSchemeHandler, path: String) async throws -> SettingsProbeFlags {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(handler, forURLScheme: "get51test")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        let probe = TestNavigationProbe()
        webView.navigationDelegate = probe
        let loaded = expectation(description: "fixture loaded")
        probe.onFinish = { loaded.fulfill() }
        webView.load(URLRequest(url: URL(string: "get51test://workspace.test\(path)")!))
        await fulfillment(of: [loaded], timeout: 15)
        let result = try await webView.evaluateJavaScript(WorkspaceBrowser.settingsSurfaceProbeScript)
        let parsed = try XCTUnwrap(WorkspaceSurfacePolicy.settingsSurfaceProbe(fromJavaScriptResult: result))
        withExtendedLifetime(handler) {}
        return SettingsProbeFlags(hasMarker: parsed.hasSettingsRootMarker,
                                  innerNavHidden: parsed.innerNavigationHidden,
                                  chromeHidden: parsed.workspaceChromeHidden)
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
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let body = "<!doctype html><meta charset=utf-8><title>workbench</title><body>workbench</body>"
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

private struct SettingsProbeFlags {
    let hasMarker: Bool
    let innerNavHidden: Bool
    let chromeHidden: Bool
}

/// Serves per-path HTML fixtures so the settings-surface probe can be exercised
/// against a real WebKit document with real computed styles.
private final class FixtureSchemeHandler: NSObject, WKURLSchemeHandler, @unchecked Sendable {
    var routes: [String: String] = [:]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                             headerFields: ["Content-Type": "text/html; charset=utf-8"]) else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        let body = routes[url.path] ?? "<!doctype html><meta charset=utf-8><title>missing</title><body>missing</body>"
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(Data(body.utf8))
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
