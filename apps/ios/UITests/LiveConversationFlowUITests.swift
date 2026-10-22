import XCTest

/// Opt-in product acceptance. Credentials belong only in private runner configuration.
@MainActor
final class LiveConversationFlowUITests: XCTestCase {
    override func tearDown() {
        capture(XCUIApplication(), "Live flow final screen")
        super.tearDown()
    }

    private func authenticatedApp(requirePasswordLogin: Bool = false) throws -> XCUIApplication {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        guard let backend = environment["TS_IOS_LIVE_BACKEND_URL"],
              let email = environment["TS_IOS_LIVE_EMAIL"],
              let password = environment["TS_IOS_LIVE_PASSWORD"],
              !backend.isEmpty, !email.isEmpty, !password.isEmpty else {
            throw XCTSkip("Explicit live backend and account credentials are required.")
        }
        let app = XCUIApplication()
        app.launchArguments = ["--auth-backend-url", backend,
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-talent-signal.interface-language", "en"]
        app.launch()
        var enteredCredentials = false
        if !app.buttons["relationship-guide"].waitForExistence(timeout: 15) {
            let entry = app.buttons["sign-in-with-email"]
            if !entry.exists {
                if app.buttons["welcome-skip"].exists { app.buttons["welcome-skip"].tap() }
            }
            XCTAssertTrue(entry.waitForExistence(timeout: 15))
            entry.tap()
            let emailField = app.textFields["login-email"]
            XCTAssertTrue(emailField.waitForExistence(timeout: 5))
            emailField.tap()
            emailField.typeText(email + "\n")
            app.typeText(password + "\n")
            enteredCredentials = true
        }
        XCTAssertTrue(app.buttons["relationship-guide"].waitForExistence(timeout: 60))
        // Keyboard submission may trigger the system Passwords save prompt.
        // Keep test credentials out of the shared password store.
        let passwords = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
        if passwords.staticTexts["Save Password?"].waitForExistence(timeout: 3) {
            passwords.buttons["Not Now"].tap()
            XCTAssertTrue(passwords.staticTexts["Save Password?"].waitForNonExistence(timeout: 5))
        }
        let workspaceReady = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "hittable == true"), object: app.buttons["relationship-guide"])
        XCTAssertEqual(XCTWaiter.wait(for: [workspaceReady], timeout: 5), .completed)
        if requirePasswordLogin { XCTAssertTrue(enteredCredentials, "Run this check from signed-out state.") }

        // Verify the native account before creating even synthetic chat content.
        app.buttons["relationship-agent-studio"].tap()
        XCTAssertTrue(app.buttons["agent-settings"].waitForExistence(timeout: 5))
        let settings = app.buttons["agent-settings"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: settings)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed)
        settings.tap()
        if !app.buttons["open-account-settings"].waitForExistence(timeout: 5), settings.isHittable {
            XCTContext.runActivity(named: "Cold settings tap needed one read-only retry") { _ in settings.tap() }
        }
        capture(app, "Account navigation after settings transition")
        XCTAssertTrue(app.buttons["open-account-settings"].waitForExistence(timeout: 10))
        app.buttons["open-account-settings"].tap()
        let identity = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", email)).firstMatch
        XCTAssertTrue(identity.waitForExistence(timeout: 10))
        XCTAssertTrue(identity.label.split(whereSeparator: { $0.isWhitespace || $0 == "," })
            .contains(Substring(email)))
        app.navigationBars["Account"].buttons["Workspace"].tap()
        XCTAssertTrue(app.buttons["close-relationship-menu"].waitForExistence(timeout: 5))
        app.buttons["close-relationship-menu"].tap()
        XCTAssertTrue(app.buttons["Close Agent"].waitForExistence(timeout: 5))
        app.buttons["Close Agent"].tap()
        XCTAssertTrue(app.buttons["relationship-guide"].waitForExistence(timeout: 5))
        return app
    }

    func testLiveExistingIdentityReadback() throws {
        let app = try authenticatedApp()
        capture(app, "Existing native login has the exact authorized identity")
    }

    func testLiveKeyboardSignInAndIdentity() throws {
        let app = try authenticatedApp(requirePasswordLogin: true)
        capture(app, "Live keyboard sign-in reached the verified workspace")
    }

    func testLiveTextRoundTripAndDraftRecovery() throws {
        let app = try authenticatedApp()
        app.buttons["relationship-guide"].tap()

        let composer = app.textFields["ask-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        let marker = "ios-flow-" + String(UUID().uuidString.lowercased().prefix(8))
        let question = "\(marker): Reply only 'Received \(marker)'. This is a synthetic iOS acceptance check. Do not create contacts, memories, tasks, reminders or external actions."
        composer.tap()
        composer.typeText(question)
        let send = app.buttons["ask-send"]
        XCTAssertTrue(send.isEnabled)
        send.tap()
        XCTAssertFalse((composer.value as? String ?? "").contains(marker),
                       "Sending should release the composer immediately.")
        let reply = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier BEGINSWITH %@", "ask-response-block-"))
            .descendants(matching: .staticText).matching(NSPredicate(
                format: "label CONTAINS %@", String(marker))).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 180),
                      "A live rendered reply for this unique request is required.")
        XCTAssertFalse(app.descendants(matching: .any)["ask-error"].firstMatch.exists)
        capture(app, "Live text response rendered")

        let unsent = "Unsent draft \(marker)"
        composer.tap()
        composer.typeText(unsent)
        // A normal navigation boundary flushes the draft before termination.
        let back = app.buttons["ask-close"]
        if back.exists { back.tap() }
        else { app.navigationBars.buttons.firstMatch.tap() }
        XCTAssertTrue(app.buttons["archive-tab-sessions"].waitForExistence(timeout: 5))
        app.buttons["archive-tab-sessions"].tap()
        let latest = app.buttons.matching(NSPredicate(
            format: "identifier BEGINSWITH %@", "agent-session-")).firstMatch
        XCTAssertTrue(latest.waitForExistence(timeout: 60))
        // Titles can be summarized by the Agent. Preserve the native row's
        // identity, then prove its contents below instead of guessing its title.
        let sessionIdentifier = latest.identifier
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["archive-tab-sessions"].waitForExistence(timeout: 60))
        app.buttons["archive-tab-sessions"].tap()
        let row = app.buttons[sessionIdentifier]
        XCTAssertTrue(row.waitForExistence(timeout: 60),
                      "The same sent conversation must survive a normal relaunch.")
        row.tap()
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        XCTAssertEqual(composer.value as? String, unsent)
        XCTAssertTrue(reply.waitForExistence(timeout: 15))
        capture(app, "Sent response and unsent draft restored")
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
