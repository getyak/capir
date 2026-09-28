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
        let device = app.buttons["settings.section.device"]
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

    func testHelpLabelAndNativeSearchStayOnAResolvedDestination() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-workspace.web.origin", "http://127.0.0.1:1",
            "-workspace.connection.localDevelopment", "YES"
        ]
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 20))
        app.typeKey(",", modifierFlags: [.command])

        let help = app.buttons["settings.section.advanced"]
        XCTAssertTrue(help.waitForExistence(timeout: 20))
        XCTAssertEqual(help.label, "帮助与诊断")
        XCTAssertFalse(app.buttons["settings.section.more"].exists)

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
}
