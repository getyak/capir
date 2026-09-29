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
    /// The account row hands account pages to the default browser. The per-run
    /// origin port is the attribution marker: a document request for
    /// `/workspace/settings` on that port comes from the browser AppKit opened,
    /// because the embed never loads the Web account routes.
    func testAccountRowHandsOffToTheDefaultBrowser() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-workspace.web.origin", "http://127.0.0.1:4402",
            "-workspace.connection.localDevelopment", "YES"
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
            app.descendants(matching: .any)["workspace.browserLaunchFailure"].waitForExistence(timeout: 8),
            "The default browser launch was refused"
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
}
