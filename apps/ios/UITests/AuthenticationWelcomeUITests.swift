import XCTest

final class AuthenticationWelcomeUITests: XCTestCase {
    func testSourcePullCanReverseThenCommitAndReplay() {
        let app = XCUIApplication()
        app.launchArguments = ["--auth-backend-url", "http://127.0.0.1:4799",
            "--welcome-first-meeting", "-talent-signal.interface-language", "zh-Hans"]
        app.launch()
        let source = app.buttons["welcome-link"]
        XCTAssertTrue(source.waitForExistence(timeout: 15))
        save(app, "09-source-at-rest")
        let origin = source.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.83))
        origin.press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: 90, dy: -20)))
        XCTAssertTrue(app.buttons["welcome-enter"].exists)
        origin.press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: 0, dy: -32)))
        XCTAssertTrue(app.buttons["welcome-enter"].exists)
        XCTAssertFalse(app.buttons["sign-in-with-email"].exists)
        save(app, "10-source-returned")
        origin.press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: 0, dy: -180)),
                     withVelocity: .slow, thenHoldForDuration: 0.5)
        XCTAssertTrue(app.buttons["sign-in-with-email"].waitForExistence(timeout: 5))
        save(app, "11-source-connected")
        app.buttons["welcome-skip"].tap()
        XCTAssertTrue(source.waitForExistence(timeout: 3))
        source.tap()
        XCTAssertTrue(app.buttons["sign-in-with-email"].waitForExistence(timeout: 5))
    }

    func testFirstMeetingSwipeRevealAndEmailRecovery() {
        let app = XCUIApplication()
        app.launchArguments = ["--auth-backend-url", fixtureBackendURL, "-talent-signal.interface-language", "zh-Hans", "--welcome-first-meeting"]
        app.launch()
        let skip = app.buttons["welcome-skip"]
        XCTAssertTrue(skip.waitForExistence(timeout: 15))
        if !app.buttons["welcome-enter"].exists { skip.tap() }
        let invitation = app.buttons["welcome-enter"]
        XCTAssertTrue(invitation.waitForExistence(timeout: 3))
        XCTAssertFalse(app.buttons["sign-in-with-google"].exists)
        save(app, "01-first-meeting")
        // A short exploratory tug must not commit, even with a flick prediction.
        let origin = invitation.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        origin.press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: 0, dy: -32)))
        XCTAssertTrue(invitation.exists)
        XCTAssertFalse(app.buttons["sign-in-with-google"].exists)
        save(app, "01b-small-pull-return")
        XCTAssertFalse(app.buttons["login-product-lab"].exists)
        XCTAssertFalse(app.buttons["login-ending-recovery"].exists)
        invitation.swipeUp()
        let google = app.buttons["sign-in-with-google"]
        XCTAssertTrue(google.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["sign-in-with-email"].exists)
        save(app, "02-emergence")
        XCTAssertFalse(app.staticTexts["留住来时的线索，让下一步自然发生。"].exists)
        XCTAssertFalse(app.buttons["login-ending-recovery"].exists)
        app.buttons["sign-in-with-email"].tap()
        let email = app.textFields["login-email"]
        XCTAssertTrue(email.waitForExistence(timeout: 3))
        email.tap(); email.typeText("get6-unregistered@example.invalid")
        let password = app.secureTextFields["login-password"]
        password.tap(); password.typeText("wrong-fixture-password")
        app.buttons["login-email-submit"].tap()
        XCTAssertTrue(app.navigationBars.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["邮箱或密码不正确，请重试。"].waitForExistence(timeout: 8))
        save(app, "03-email-recovery")
        let cancel = app.buttons["Cancel"].exists ? app.buttons["Cancel"] : app.buttons["取消"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        let ready = NSPredicate(format: "enabled == true")
        expectation(for: ready, evaluatedWith: cancel)
        waitForExpectations(timeout: 15)
        cancel.tap()
        let passwordPrompt = app.buttons["Not Now"]
        if passwordPrompt.waitForExistence(timeout: 2) { passwordPrompt.tap() }
        XCTAssertTrue(google.waitForExistence(timeout: 3))
        skip.tap()
        XCTAssertTrue(invitation.waitForExistence(timeout: 3))
        XCTAssertFalse(google.exists)
        save(app, "04-replay-reset")
    }
    func testReducedMotionDarkEntryRemainsAccessible() {
        let app = XCUIApplication()
        app.launchArguments = ["--auth-backend-url", "http://127.0.0.1:4341", "-talent-signal.interface-language", "zh-Hans", "--welcome-first-meeting", "--force-dark", "--reduce-motion"]
        app.launch()
        let skip = app.buttons["welcome-skip"]
        XCTAssertTrue(skip.waitForExistence(timeout: 15))
        if !app.buttons["welcome-enter"].exists { skip.tap() }
        save(app, "05-dark-first-meeting")
        app.buttons["welcome-enter"].tap()
        XCTAssertTrue(app.buttons["sign-in-with-google"].waitForExistence(timeout: 5))
        save(app, "07-dark-reduced-motion")
    }

    func testOfflineRetryAndAccessibilityEntryRemainReachable() {
        let app = XCUIApplication()
        app.launchArguments = ["--auth-backend-url", "http://127.0.0.1:4799", "--welcome-first-meeting",
            "--reduce-motion", "--force-dark", "-talent-signal.interface-language", "zh-Hans",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.buttons["welcome-skip"].waitForExistence(timeout: 15))
        save(app, "08a-accessibility-source")
        app.buttons["welcome-skip"].tap()
        let retry = app.buttons["retry-apple-challenge"]
        for _ in 0..<6 where !retry.isHittable { app.swipeUp() }
        XCTAssertTrue(retry.waitForExistence(timeout: 10))
        XCTAssertTrue(retry.isHittable)
        XCTAssertTrue(app.buttons["sign-in-with-email"].exists)
        retry.tap()
        XCTAssertTrue(app.staticTexts["authentication-notice"].waitForExistence(timeout: 10))
        let email = app.buttons["sign-in-with-email"]
        for _ in 0..<6 where !email.isHittable { app.swipeUp() }
        XCTAssertTrue(email.isHittable)
        XCTAssertFalse(app.staticTexts["接住重要的人，\n接着未完的事。"].exists)
        save(app, "08-offline-accessibility-recovery")
    }

    private var fixtureBackendURL: String {
        // The current test bundle owns the ephemeral backend port. A reused
        // Simulator test daemon can retain an earlier invocation's environment.
        if let value = Bundle(for: AuthenticationWelcomeUITests.self)
            .object(forInfoDictionaryKey: "TS_IOS_BACKEND_URL") as? String,
           !value.isEmpty, !value.contains("$(") { return value }
        return ProcessInfo.processInfo.environment["TS_IOS_BACKEND_URL"]
            ?? "http://127.0.0.1:4341"
    }

    private func save(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
