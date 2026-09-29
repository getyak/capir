import XCTest

final class WorkspaceSettingsUITests: XCTestCase {
    func testCompanionSelectionAndVisibilityInNativeSettings() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-workspace.web.origin", "http://127.0.0.1:1",
            "-workspace.connection.localDevelopment", "YES",
            "-desktopPet.visible", "NO",
            "-ApplePersistenceIgnoreState", "YES"
        ]
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 20))
        app.typeKey(",", modifierFlags: [.command])
        let section = app.buttons["settings.section.companion"]
        XCTAssertTrue(section.waitForExistence(timeout: 20))
        section.click()

        let visibility = app.buttons["desktopPet.visibility"]
        XCTAssertTrue(visibility.waitForExistence(timeout: 10))
        XCTAssertEqual(visibility.label, "显示伙伴")
        app.buttons["desktopPet.option.owl"].click()
        XCTAssertTrue(app.descendants(matching: .any)["猫头鹰桌面伙伴预览"].exists)

        visibility.click()
        XCTAssertEqual(visibility.label, "隐藏伙伴")
        XCTAssertTrue(app.buttons["隐藏桌面伙伴"].waitForExistence(timeout: 10))
        app.buttons["隐藏桌面伙伴"].click()
        XCTAssertEqual(visibility.label, "显示伙伴")
        app.terminate()
    }

    func testSettingsIsOneIndependentWindowWithOfflineDeviceControls() {
        let app = XCUIApplication()
        // Command-line defaults affect this launch only. No production origin or login.
        app.launchArguments = [
            "-workspace.web.origin", "http://127.0.0.1:1",
            "-workspace.connection.localDevelopment", "YES",
            "-desktopPet.visible", "NO",
            "-ApplePersistenceIgnoreState", "YES"
        ]
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 20))
        let main = app.windows.firstMatch
        let mainTitle = main.label

        app.typeKey(",", modifierFlags: [.command])
        let device = app.buttons["settings.section.general"]
        XCTAssertTrue(device.waitForExistence(timeout: 20))
        XCTAssertEqual(app.windows.count, 2)
        device.click()
        XCTAssertTrue(app.staticTexts["内容大小"].waitForExistence(timeout: 10))
        app.buttons["settings.section.updates"].click()
        XCTAssertTrue(app.buttons["updates.check"].waitForExistence(timeout: 10))
        app.typeKey(",", modifierFlags: [.command])
        XCTAssertEqual(app.windows.count, 2, "Settings reuses its existing window.")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Independent settings window"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        app.typeKey("w", modifierFlags: [.command])
        XCTAssertTrue(main.waitForExistence(timeout: 10))
        XCTAssertEqual(app.windows.count, 1)
        XCTAssertEqual(main.label, mainTitle)
        app.typeKey(",", modifierFlags: [.command])
        XCTAssertTrue(device.waitForExistence(timeout: 10))
        XCTAssertEqual(app.windows.count, 2)
        app.terminate()
    }

    func testDeviceSettingsAndNativeSearchStayUsableOffline() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-workspace.web.origin", "http://127.0.0.1:1",
            "-workspace.connection.localDevelopment", "YES",
            "-desktopPet.visible", "NO",
            "-ApplePersistenceIgnoreState", "YES"
        ]
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 20))
        app.typeKey(",", modifierFlags: [.command])

        let updates = app.buttons["settings.section.updates"]
        XCTAssertTrue(updates.waitForExistence(timeout: 20))
        XCTAssertEqual(updates.label, "软件更新")
        // Removed embedded-settings rows must not linger in the native rail.
        XCTAssertFalse(app.buttons["settings.section.advanced"].exists)
        XCTAssertFalse(app.buttons["settings.section.profile"].exists)
        // Account settings are browser-owned and say so before the click.
        XCTAssertTrue(app.buttons["settings.account.browser"].exists)
        XCTAssertEqual(app.buttons["settings.account.browser"].label, "账号与偏好 ↗")

        let field = app.textFields["settings.search.field"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.click()
        field.typeText("截图")
        XCTAssertTrue(app.buttons["settings.search.result.captures"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["settings.search.result.screen-recording"].exists)

        app.typeKey(.escape, modifierFlags: [])
        XCTAssertFalse(app.buttons["settings.search.result.captures"].waitForExistence(timeout: 2))
        app.terminate()
    }
    /// The account row hands account pages to the default browser. The per-run
    /// origin port is the attribution marker: a document request for
    /// `/workspace/settings` on that port comes from the browser AppKit opened,
    /// because the embed never loads the Web account routes.
    func testAccountRowHandsOffToTheDefaultBrowser() throws {
        let handoffOrigin = ProcessInfo.processInfo.environment["TS_HANDOFF_ORIGIN"]
        try XCTSkipUnless(handoffOrigin != nil,
                          "Needs the task-owned synthetic origin and its logging proxy; see the handoff section of docs/superpowers/plans/2026-09-29-macos-personal-settings.md")
        let app = XCUIApplication()
        app.launchArguments = [
            "-workspace.web.origin", handoffOrigin ?? "http://127.0.0.1:4403",
            "-workspace.connection.localDevelopment", "YES",
            "-desktopPet.visible", "NO",
            "-ApplePersistenceIgnoreState", "YES"
        ]
        app.launch()
        if !app.windows.firstMatch.waitForExistence(timeout: 30) {
            let state = app.state.rawValue
            let tree = app.debugDescription
            let note = XCTAttachment(string: "state=\(state)\n\(tree.prefix(4000))")
            note.name = "Launch diagnostics"
            note.lifetime = .keepAlways
            add(note)
            XCTFail("The main window did not appear with the synthetic origin (state=\(state))")
        }
        let main = app.windows.firstMatch

        app.typeKey(",", modifierFlags: [.command])
        let row = app.buttons["settings.account.browser"]
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        XCTAssertEqual(app.windows.count, 2)
        row.click()
        XCTAssertFalse(
            app.buttons["settings.account.retry"].waitForExistence(timeout: 8),
            "The native account row reported that the browser launch was refused"
        )
        XCTAssertEqual(app.windows.count, 2, "The handoff must not open a native settings pane")
        XCTAssertTrue(app.buttons["settings.section.general"].exists)

        app.typeKey("w", modifierFlags: [.command])
        XCTAssertTrue(main.waitForExistence(timeout: 10))
        XCTAssertEqual(app.windows.count, 1)
        let screen = XCTAttachment(screenshot: app.screenshot())
        screen.name = "Account row handed off to the default browser"
        screen.lifetime = .keepAlways
        add(screen)
        app.terminate()
    }

    func testMainConversationDraftSurvivesAccountSettingsHandoff() throws {
        let origin = ProcessInfo.processInfo.environment["TS_DRAFT_ORIGIN"]
        let cookieFile = ProcessInfo.processInfo.environment["TS_DRAFT_COOKIE_FILE"]
        try XCTSkipUnless(origin != nil && cookieFile != nil,
                          "Requires an isolated synthetic Web origin and cookie file")
        let cookie = try String(contentsOfFile: cookieFile!, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertFalse(cookie.isEmpty)

        let app = XCUIApplication()
        app.launchArguments = [
            "-workspace.web.origin", origin!,
            "-workspace.connection.localDevelopment", "YES",
            "-desktopPet.visible", "NO",
            "-ApplePersistenceIgnoreState", "YES",
            "--web-workspace-testing"
        ]
        app.launchEnvironment["TS_TEST_SESSION_COOKIE"] =
            "name=talent-signal.session-v2;value=\(cookie);domain=127.0.0.1;path=/"
        app.launch()

        // WebKit exposes this textarea as a TextView titled “消息”; its HTML id
        // does not become an XCTest accessibility identifier on macOS.
        let composer = app.webViews.textViews["消息"]
        guard composer.waitForExistence(timeout: 45) else {
            XCTFail("The signed-in main Web conversation must show its composer")
            return
        }
        let editable = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "enabled == true"), object: composer)
        guard XCTWaiter.wait(for: [editable], timeout: 60) == .completed else {
            XCTFail("The main conversation composer did not become editable")
            return
        }
        let draft = "Unsent settings handoff draft"
        composer.click()
        composer.typeText(draft)
        XCTAssertTrue((composer.value as? String)?.contains(draft) == true)

        app.typeKey(",", modifierFlags: [.command])
        let accountRow = app.buttons["settings.account.browser"]
        XCTAssertTrue(accountRow.waitForExistence(timeout: 15))
        accountRow.click()
        app.activate()
        XCTAssertFalse(app.descendants(matching: .any)["workspace.browserLaunchFailure"].exists)
        XCTAssertTrue((composer.value as? String)?.contains(draft) == true,
                      "Opening account settings must not discard the main conversation draft")
        app.typeKey("w", modifierFlags: [.command])
        XCTAssertTrue(composer.waitForExistence(timeout: 15))
        XCTAssertTrue((composer.value as? String)?.contains(draft) == true,
                      "The draft must still be present after returning to the main window")
        app.terminate()
    }
}
