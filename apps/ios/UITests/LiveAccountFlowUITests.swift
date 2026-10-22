import XCTest

/// Run after the live conversation journey; never substitutes a fixture session.
@MainActor
final class LiveAccountFlowUITests: XCTestCase {
    override func tearDown() {
        capture(XCUIApplication(), "Live account journey final screen")
        super.tearDown()
    }

    func testLiveNavigationAndSignOut() throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        guard let backend = environment["TS_IOS_LIVE_BACKEND_URL"],
              let email = environment["TS_IOS_LIVE_EMAIL"] else {
            throw XCTSkip("Requires the explicit live-account acceptance workflow.")
        }
        let app = XCUIApplication()
        app.launchArguments = ["--auth-backend-url", backend,
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-talent-signal.interface-language", "en"]
        app.launch()
        XCTAssertTrue(app.buttons["relationship-guide"].waitForExistence(timeout: 60))
        selectTab(app, "archive-tab-people")
        XCTAssertTrue(element(app, "workspace-people-list").waitForExistence(timeout: 60))
        XCTAssertTrue(app.buttons.matching(NSPredicate(
            format: "identifier BEGINSWITH %@", "workspace-person-")).firstMatch.exists)
        capture(app, "Live People loaded")
        selectTab(app, "archive-tab-sessions")
        XCTAssertTrue(element(app, "agent-session-list").waitForExistence(timeout: 60))
        capture(app, "Live Sessions loaded")
        selectTab(app, "archive-tab-meetings")
        XCTAssertTrue(element(app, "relationship-calendar").waitForExistence(timeout: 30))
        capture(app, "Live calendar opened")
        selectTab(app, "archive-tab-today")
        XCTAssertTrue(app.buttons["relationship-guide"].exists)
        XCTAssertTrue(element(app, "canonical-pursuit-today").waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Reading your arrangements…"].waitForNonExistence(timeout: 30))
        if app.buttons["today-schedule-retry"].exists {
            app.buttons["today-schedule-retry"].tap()
            XCTAssertTrue(app.buttons["today-schedule-retry"].waitForNonExistence(timeout: 30))
        }
        XCTAssertTrue(element(app, "workspace-loading").waitForNonExistence(timeout: 30))
        XCTAssertFalse(element(app, "workspace-failed").exists)
        capture(app, "Live Today completed its reads")
        app.buttons["relationship-agent-studio"].tap()
        XCTAssertTrue(app.buttons["agent-settings"].waitForExistence(timeout: 5))
        app.buttons["agent-settings"].tap()
        XCTAssertTrue(app.buttons["open-account-settings"].waitForExistence(timeout: 5))
        app.buttons["open-account-settings"].tap()
        let identity = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", email)).firstMatch
        XCTAssertTrue(identity.waitForExistence(timeout: 10))
        XCTAssertTrue(identity.label.split(whereSeparator: { $0.isWhitespace || $0 == "," })
            .contains(Substring(email)))
        capture(app, "Live native account identity")
        let signOut = app.buttons["sign-out"]
        for _ in 0..<8 where !signOut.isHittable { app.swipeUp() }
        XCTAssertTrue(signOut.isHittable)
        signOut.tap()
        XCTAssertTrue(app.buttons["sign-in-with-email"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["relationship-guide"].exists)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["sign-in-with-email"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["relationship-guide"].exists)
        capture(app, "Sign-out survives relaunch")
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func selectTab(_ app: XCUIApplication, _ id: String) {
        let tab = app.buttons[id]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        for attempt in 0..<2 {
            if tab.isSelected { return }
            tab.tap()
            let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == true"), object: tab)
            if XCTWaiter.wait(for: [selected], timeout: 3) == .completed { return }
            if attempt == 0 {
                let note = XCTAttachment(string: "The first native tab tap did not change selection: \(id). Retrying the same read-only navigation once.")
                note.lifetime = .keepAlways
                add(note)
            }
        }
        XCTFail("Native tab selection did not reach \(id)")
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
