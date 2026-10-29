import XCTest

@MainActor
final class LabFaultUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOneShotFailuresAndInterruptedResponseRecoverThroughRealPages() {
        let app = launch()
        for preset in ["One 401 response", "One 429 response", "One 500 response", "Interrupt one response"] {
            choose(preset, app)
            app.buttons["lab-fault-open"].tap()
            let failure = app.staticTexts["workspace-failed"]
            XCTAssertTrue(failure.waitForExistence(timeout: 8))
            XCTAssertFalse(person(app).exists, "An unresolved first read must not substitute synthetic rows")
            if preset == "One 500 response" { capture("lab-fault-500-failure") }
            let retry = app.buttons["retry-workspace-read"]
            XCTAssertTrue(retry.isHittable)
            XCTAssertGreaterThanOrEqual(retry.frame.height + 0.001, 44)
            retry.tap()
            XCTAssertTrue(person(app).waitForExistence(timeout: 8))
            XCTAssertFalse(failure.exists)
            XCTAssertTrue(app.staticTexts["lab-fault-boundary"].exists)
            if preset == "One 500 response" {
                app.buttons["lab-fault-trace"].tap()
                XCTAssertTrue(app.staticTexts["people · 500"].waitForExistence(timeout: 5))
                capture("lab-fault-request-trace")
                app.buttons["lab-fault-trace-done"].tap()
                XCTAssertTrue(person(app).waitForExistence(timeout: 5))
            }
            if preset == "Interrupt one response" { capture("lab-fault-interrupted-recovered") }
            close(app)
        }
    }

    func testOfflineStopLatencyCancellationAndExpiredEvidence() {
        let app = launch()
        app.buttons["lab-fault-open"].tap()
        XCTAssertTrue(app.staticTexts["workspace-failed"].waitForExistence(timeout: 8))
        app.buttons["lab-fault-stop"].tap()
        XCTAssertTrue(app.buttons["lab-fault-reload"].waitForExistence(timeout: 5))
        app.buttons["lab-fault-reload"].tap()
        XCTAssertTrue(person(app).waitForExistence(timeout: 8))
        capture("lab-fault-offline-restored")
        close(app)
        choose("Add two seconds of latency", app)
        app.buttons["lab-fault-open"].tap()
        XCTAssertTrue(app.buttons["lab-fault-close"].waitForExistence(timeout: 5))
        // Closing must cancel the pending fixture read and leave a usable configuration page.
        close(app)
        choose("Expired evidence references", app)
        app.buttons["lab-fault-open"].tap()
        XCTAssertTrue(person(app).waitForExistence(timeout: 8))
        app.segmentedControls.buttons["Today"].tap()
        let unavailable = app.staticTexts["Evidence unavailable"].firstMatch
        XCTAssertTrue(unavailable.waitForExistence(timeout: 5))
        capture("lab-fault-expired-evidence")
        app.buttons["lab-fault-stop"].tap()
        app.buttons["lab-fault-reload"].tap()
        let review = app.buttons["today-review-proposal-lab-fault-pursuit"]
        XCTAssertTrue(review.waitForExistence(timeout: 5))
        XCTAssertFalse(unavailable.exists)
        capture("lab-fault-evidence-restored")
        close(app)
    }

    func testBackgroundStopsInjectionAndChineseControlsRemainReachable() {
        let app = launch(language: "zh-Hans", accessibility: true)
        app.buttons["lab-fault-open"].tap()
        XCTAssertTrue(app.staticTexts["workspace-failed"].waitForExistence(timeout: 8))
        let closeButton = app.buttons["lab-fault-close"]
        XCTAssertGreaterThanOrEqual(closeButton.frame.height + 0.001, 44)
        XCTAssertGreaterThanOrEqual(closeButton.frame.width + 0.001, 44)
        capture("lab-fault-chinese-ax5")
        let content = app.scrollViews["lab-fault-read-content"]
        let reason = app.staticTexts["workspace-failed-attempt-1"]
        let retry = app.buttons["retry-workspace-read"]
        XCTAssertTrue(content.exists)
        XCTAssertTrue(reason.exists)
        for _ in 0..<8 where !retry.isHittable { content.swipeUp() }
        XCTAssertTrue(retry.isHittable, "Recovery must stay reachable beneath the AX5 diagnostic controls")
        XCTAssertEqual(retry.label, "重试", "A workspace retry must not be described as asking a new question")
        XCTAssertGreaterThanOrEqual(retry.frame.height + 0.001, 44)
        XCTAssertGreaterThanOrEqual(reason.frame.minY, content.frame.minY - 1)
        XCTAssertLessThanOrEqual(reason.frame.maxY, content.frame.maxY + 1,
                                "The full failure explanation must be readable, not only present in AX")
        capture("lab-fault-chinese-ax5-reason-and-retry")
        XCUIDevice.shared.press(.home); app.activate()
        let actions = app.buttons["lab-fault-actions"]
        XCTAssertTrue(actions.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(actions.frame.width + 0.001, 44)
        XCTAssertGreaterThanOrEqual(actions.frame.height + 0.001, 44)
        actions.tap()
        XCTAssertTrue(app.buttons["lab-fault-stop"].waitForNonExistence(timeout: 5))
        let reload = app.buttons["lab-fault-reload"]
        XCTAssertTrue(reload.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(reload.frame.height + 0.001, 44)
        reload.tap()
        XCTAssertTrue(person(app).waitForExistence(timeout: 8))
        capture("lab-fault-background-recovery")
        close(app)
    }

    private func launch(language: String = "en", accessibility: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--preview-workspace", "-talent-signal.interface-language", language]
        if accessibility { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        app.launch()
        app.openProductLabFromSettings()
        let diagnostics = app.buttons["product-lab-diagnostics"]; reveal(diagnostics, app); diagnostics.tap()
        let faults = app.buttons["lab-diagnostics-faults"]; reveal(faults, app); faults.tap()
        let open = app.buttons["lab-fault-open"]; reveal(open, app)
        return app
    }
    private func choose(_ value: String, _ app: XCUIApplication) {
        let picker = app.buttons["lab-fault-preset"]
        reveal(picker, app, up: true); picker.tap()
        let option = app.collectionViews.buttons[value].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 4)); option.tap()
        reveal(app.buttons["lab-fault-open"], app)
    }
    private func close(_ app: XCUIApplication) {
        let button = app.buttons["lab-fault-close"]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["lab-fault-open"].waitForExistence(timeout: 5))
    }
    private func person(_ app: XCUIApplication) -> XCUIElement { app.buttons["workspace-person-lab-fault-person"] }
    private func reveal(_ element: XCUIElement, _ app: XCUIApplication, up: Bool = false) {
        for _ in 0..<16 {
            if element.isHittable { return }
            if up { app.swipeDown() } else { app.swipeUp() }
        }
        XCTAssertTrue(element.isHittable)
    }
    private func capture(_ name: String) {
        Thread.sleep(forTimeInterval: 0.6)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
