import XCTest

final class WorkspaceSettingsUITests: XCTestCase {
    func testSettingsIsOneIndependentWindowWithOfflineDeviceControls() {
        let app = XCUIApplication()
        // Command-line defaults affect this launch only. No production origin or login.
        app.launchArguments = [
            "-workspace.web.origin", "http://127.0.0.1:1",
            "-workspace.connection.localDevelopment", "YES"
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
            "-workspace.connection.localDevelopment", "YES"
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
    /// The account row is a real browser handoff against the synthetic loopback
    /// server. The server log attributes each request to its client, so a
    /// post-click `GET /workspace/settings` with a browser user agent is evidence
    /// that the default browser navigated, not that the app merely asked it to.
    /// This test also carries an unsent draft through the whole round trip.
    func testAccountRowHandsOffToTheDefaultBrowserAndKeepsTheDraft() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing", "--fixture-state", "canonical",
            "-workspace.web.origin", "http://127.0.0.1:4400",
            "-workspace.connection.localDevelopment", "YES"
        ]
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 20))
        let main = app.windows.firstMatch

        // An unsent draft typed into the app's own draft editor.
        let draft = "未发送的问题 round trip \(UUID().uuidString.prefix(6))"
        app.typeKey("n", modifierFlags: [.command, .option])
        let editor = app.descendants(matching: .any)["quick.draftEditor"]
        let hasDraftSurface = editor.waitForExistence(timeout: 15)
        XCTAssertTrue(hasDraftSurface, "The app's own draft editor must be reachable")
        if hasDraftSurface {
            editor.click()
            editor.typeKey("a", modifierFlags: .command)
            editor.typeText(draft)
            app.typeKey(.escape, modifierFlags: [])
        }

        app.typeKey(",", modifierFlags: [.command])
        let row = app.buttons["settings.account.browser"]
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        XCTAssertEqual(app.windows.count, 2)
        row.click()
        XCTAssertFalse(
            app.descendants(matching: .any)["workspace.browserLaunchFailure"].waitForExistence(timeout: 8),
            "The default browser launch was refused"
        )
        XCTAssertTrue(app.buttons["settings.section.general"].exists)
        XCTAssertEqual(app.windows.count, 2, "The handoff must not open a native settings pane")

        // Back to the workbench: the main window is still the same one.
        app.typeKey("w", modifierFlags: [.command])
        XCTAssertTrue(main.waitForExistence(timeout: 10))
        XCTAssertEqual(app.windows.count, 1)

        if hasDraftSurface {
            app.typeKey("n", modifierFlags: [.command, .option])
            XCTAssertTrue(editor.waitForExistence(timeout: 10))
            XCTAssertEqual((editor.value as? String)?.contains(draft), true,
                           "The unsent draft must survive the settings round trip")
        }
        let screen = XCTAttachment(screenshot: app.screenshot())
        screen.name = "Account row handed off to the default browser"
        screen.lifetime = .keepAlways
        add(screen)
        app.terminate()
    }
}
