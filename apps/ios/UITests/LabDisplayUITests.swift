import XCTest
import UIKit

@MainActor
final class LabDisplayUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(accessibility: Bool = false, unreadFixture: String? = nil, headerFixture: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--preview-workspace", "-talent-signal.interface-language", "en", "-talent-signal.display.appearance", "light",
                               "-talent-signal.display.text-size", "system"]
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", accessibility
            ? UIContentSizeCategory.accessibilityExtraExtraExtraLarge.rawValue : UIContentSizeCategory.large.rawValue]
        app.launchEnvironment["TS_IOS_UI_TEST_DISPLAY_PROBE"] = "true"
        app.launchEnvironment["TS_IOS_UI_TEST_PREVIEW_WORKSPACE"] = "true"
        app.launchEnvironment["TS_IOS_UI_TEST_TODAY_UNREAD"] = unreadFixture
        if headerFixture { app.launchEnvironment["TS_IOS_UI_TEST_HEADER_GEOMETRY"] = "true" }
        app.launch()
        return app
    }
    private func openAppearance(_ app: XCUIApplication) {
        app.openProductLabFromSettings()
        let entry = app.buttons["product-lab-appearance"]
        reveal(entry, app)
        entry.tap()
        XCTAssertTrue(app.navigationBars["Appearance & accessibility"].waitForExistence(timeout: 5))
    }
    private func reveal(_ element: XCUIElement, _ app: XCUIApplication, above: Bool = false) {
        if element.isHittable { return }
        // Scope swipes to the visible Form/ScrollView. A whole-screen downward
        // gesture at AX sizes can dismiss the enclosing Lab sheet instead.
        let surfaces = app.scrollViews.allElementsBoundByIndex + app.collectionViews.allElementsBoundByIndex
        let surface = surfaces.last(where: { $0.isHittable }) ?? app
        for _ in 0..<18 {
            let targetIsAbove = element.exists && !element.frame.isEmpty ? element.frame.midY < app.frame.midY : above
            if targetIsAbove { surface.swipeDown() } else { surface.swipeUp() }
            if element.isHittable { return }
        }
        for _ in 0..<18 { if above { surface.swipeUp() } else { surface.swipeDown() }; if element.isHittable { return } }
        XCTFail("Unreachable control: \(element.identifier)")
    }
    private func choose(_ identifier: String, _ value: String, _ app: XCUIApplication, above: Bool = false) {
        let picker = app.buttons[identifier]
        reveal(picker, app, above: above)
        picker.tap()
        // UIKit presents these Picker choices in a menu collection, separate
        // from equally named workspace tabs behind the Lab presentation.
        let option = app.collectionViews.buttons.matching(identifier: value).firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 3), "Missing option: \(value)")
        option.tap()
        XCTAssertTrue(picker.label.hasSuffix(", \(value)"), "The selected option must read back from the picker label.")
    }
    private func openPreview(_ app: XCUIApplication) {
        let open = app.buttons["product-lab-live-preview"]
        reveal(open, app, above: true); open.tap()
        XCTAssertTrue(app.buttons["lab-preview-close"].waitForExistence(timeout: 5))
    }
    private func closePreview(_ app: XCUIApplication) {
        let close = app.buttons["lab-preview-close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        XCTAssertTrue(close.isHittable)
        // The named element disappears as it dismisses. Tap its observed target
        // and verify the destination instead of re-querying the disappearing button.
        close.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["lab-appearance-page"].waitForExistence(timeout: 5))
    }
    private func capture(_ name: String) {
        // SwiftUI's 0.18-second page crossfade may outlive XCTest's idle signal.
        // Let its final frame render before preserving visual evidence.
        Thread.sleep(forTimeInterval: 0.6)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    func testRealPageStatesAndIsolatedInteractions() {
        let app = launch()
        openAppearance(app)
        choose("lab-appearance-state", "Failed", app)
        openPreview(app)
        XCTAssertTrue(app.staticTexts["workspace-failed"].waitForExistence(timeout: 5))
        capture("lab-appearance-failure-before-retry")
        app.buttons["retry-workspace-read"].tap()
        XCTAssertTrue(app.staticTexts["workspace-failed-attempt-2"].exists)
        capture("lab-appearance-failed-retry")
        closePreview(app)
        choose("lab-appearance-state", "Long names & content", app)
        openPreview(app)
        let person = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'workspace-person-' ")).firstMatch
        XCTAssertTrue(person.waitForExistence(timeout: 5))
        person.tap()
        XCTAssertTrue(app.alerts["Preview interaction"].waitForExistence(timeout: 3))
        app.alerts.buttons["Done"].tap()
        capture("lab-appearance-people-long")
        closePreview(app)
        choose("lab-appearance-page", "Review · full evidence", app)
        openPreview(app)
        XCTAssertTrue(app.descendants(matching: .any)["standalone-content-size"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["standalone-use-own-signal"].isHittable)
        capture("lab-appearance-review-evidence")
        closePreview(app)
        choose("lab-appearance-page", "Sessions", app)
        choose("lab-appearance-state", "Stale read", app)
        openPreview(app)
        XCTAssertTrue(app.descendants(matching: .any)["workspace-refresh-notice"].firstMatch.waitForExistence(timeout: 5))
        capture("lab-appearance-sessions-stale")
    }

    func testActualTodayUnreadRowKeepsContextCountAndExactSessionCallback() {
        let app = launch(unreadFixture: "relationship")
        openAppearance(app)
        choose("lab-appearance-page", "Today", app)
        openPreview(app)
        let probe = app.descendants(matching: .any)["lab-preview-effective-display"].firstMatch
        XCTAssertTrue(probe.waitForExistence(timeout: 5))
        XCTAssertTrue((probe.value as? String)?.hasPrefix("en|light|large|") == true)
        let row = app.buttons["today-unread-session"]
        reveal(row, app)
        XCTAssertTrue(row.label.contains("Alexandra Chen / 周琳"))
        XCTAssertTrue(row.label.contains("Synthetic design collaboration / 跨地区设计协作"))
        XCTAssertTrue(row.label.contains("1 more unread session"))
        XCTAssertGreaterThanOrEqual(row.frame.height, 44)
        capture("Actual Today unread row light context and count")
        row.tap()
        XCTAssertTrue(app.alerts.staticTexts["90000000-0000-4000-8000-000000000001"].waitForExistence(timeout: 5),
                      "Two Sessions share a participant; activation must preserve the exact Session identity")
        app.alerts.buttons.firstMatch.tap()
        closePreview(app)
    }

    func testActualTodayIdentityReviewRowAtChineseDarkAX5KeepsPrivateDraftOut() {
        let app = launch(accessibility: true, unreadFixture: "identity-review")
        openAppearance(app)
        choose("lab-appearance-page", "Today", app)
        choose("lab-display-language", "简体中文", app)
        choose("product-lab-theme", "Dark", app, above: true)
        let motion = app.switches["lab-display-motion"]
        reveal(motion, app)
        if motion.value as? String != "1" {
            // AX5 labels make the combined Switch row much wider than its
            // native thumb. Activate the observed switch at the trailing end.
            motion.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        }
        XCTAssertEqual(motion.value as? String, "1")
        openPreview(app)
        app.assertEffectiveAccessibility5(identifier: "lab-preview-effective-display")
        let probe = app.descendants(matching: .any)["lab-preview-effective-display"].firstMatch
        XCTAssertTrue((probe.value as? String)?.hasPrefix("zh-Hans|dark|accessibility5|") == true)
        XCTAssertEqual(probe.label, "effective-reduce-motion:on")
        let row = app.buttons["today-unread-session"]
        reveal(row, app)
        XCTAssertTrue(row.label.contains("Unconfirmed synthetic identity"))
        XCTAssertFalse(row.label.contains("PROTECTED_REVIEW_OBJECTIVE"))
        XCTAssertFalse(row.label.contains("PROTECTED_REVIEW_DRAFT"))
        XCTAssertFalse(row.label.contains("Synthetic design collaboration"))
        XCTAssertGreaterThanOrEqual(row.frame.height, 44)
        capture("Actual Today identity review row Chinese dark effective AX5")
        row.tap()
        XCTAssertTrue(app.alerts.staticTexts["90000000-0000-4000-8000-000000000001"].waitForExistence(timeout: 5))
        app.alerts.buttons.firstMatch.tap()
        closePreview(app)
    }

    func testActualHeaderSamplesZeroNarrowAndNormalWidthAndKeepsSelection() {
        let app = launch(headerFixture: true)
        openAppearance(app)
        choose("lab-appearance-page", "Sessions", app)
        openPreview(app)
        let samples = app.staticTexts["header-geometry-samples"]
        XCTAssertTrue(samples.waitForExistence(timeout: 5))
        app.buttons["header-width-narrow"].tap()
        waitForHeaderSamples(samples) { $0.contains { $0[0] > 0 && $0[0] < 96 } }
        app.buttons["header-width-normal"].tap()
        waitForHeaderSamples(samples) { $0.last.map { $0[0] >= 176 } == true }
        let header = app.descendants(matching: .any)["header-geometry-fixture"].firstMatch
        for destination in ["today", "sessions", "people", "meetings"] {
            let button = header.buttons["archive-tab-\(destination)"]
            XCTAssertGreaterThanOrEqual(button.frame.width + 0.001, 44)
            XCTAssertGreaterThanOrEqual(button.frame.height + 0.001, 44)
        }
        header.buttons["archive-tab-sessions"].tap()
        XCTAssertTrue(header.buttons["archive-tab-sessions"].isSelected)
        capture("Actual header zero narrow normal numeric samples and native selection")
        let value = (samples.value as? String) ?? samples.label
        let receipt = XCTAttachment(string: value)
        receipt.name = "Actual header numeric samples: input slot active compressed selected inactive"
        receipt.lifetime = .keepAlways
        add(receipt)
        let rows = headerRows(value)
        XCTAssertTrue(rows.contains { abs($0[0]) < 0.001 }, "The real header must receive the zero proposal")
        XCTAssertTrue(rows.allSatisfy { $0.allSatisfy { $0.isFinite && $0 >= 0 } },
                      "Actual geometry-derived fixed frames must be finite and nonnegative: \(value)")
        closePreview(app)
    }

    private func headerRows(_ value: String) -> [[Double]] {
        value.split(separator: ";").map { $0.split(separator: ",").compactMap { Double($0) } }.filter { $0.count == 6 }
    }

    private func waitForHeaderSamples(_ element: XCUIElement, predicate: @escaping ([[Double]]) -> Bool) {
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate { [self] _, _ in
            predicate(headerRows((element.value as? String) ?? element.label))
        }, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expected], timeout: 5), .completed)
    }
    func testTemporaryAppDisplayRestoresAndPresetDoesNotAutoApply() {
        let app = launch()
        let baseline = app.descendants(matching: .any)["lab-effective-display"].firstMatch.value as? String
        openAppearance(app)
        choose("product-lab-theme", "Dark", app)
        choose("lab-display-language", "简体中文", app)
        choose("lab-display-density", "Comfortable", app)
        let save = app.buttons["lab-display-save-preset"]; reveal(save, app); save.tap()
        let name = "Appearance proof \(UUID().uuidString.prefix(6))"
        let nameField = app.alerts.textFields.firstMatch
        XCTAssertTrue(nameField.waitForExistence(timeout: 3))
        nameField.typeText(name)
        app.alerts.buttons["Save"].tap()
        let apply = app.buttons["lab-display-apply"]; reveal(apply, app, above: true); apply.tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["product-lab-done"].tap()
        let probe = app.descendants(matching: .any)["lab-effective-display"].firstMatch
        XCTAssertTrue(app.buttons["lab-display-stop"].waitForExistence(timeout: 5))
        XCTAssertTrue((probe.value as? String)?.contains("zh-Hans|dark|") == true)
        XCTAssertTrue((probe.value as? String)?.hasSuffix("|comfortable") == true)
        XCTAssertGreaterThanOrEqual(app.buttons["lab-display-stop"].frame.height + 0.001, 44)
        XCTAssertTrue(app.buttons["archive-tab-people"].isHittable, "Display trial must preserve workspace navigation.")
        app.buttons["archive-tab-people"].tap()
        XCTAssertTrue(app.buttons["lab-display-stop"].exists)
        app.buttons["archive-tab-today"].tap()
        capture("lab-appearance-current-app-chinese-dark")
        app.buttons["lab-display-stop"].tap()
        XCTAssertEqual(probe.value as? String, baseline)
        openAppearance(app)
        let preset = app.buttons[name]; reveal(preset, app); preset.tap()
        let applyAgain = app.buttons["lab-display-apply"]; reveal(applyAgain, app, above: true); applyAgain.tap()
        app.terminate(); app.launch()
        XCTAssertFalse(app.buttons["lab-display-stop"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["lab-effective-display"].firstMatch.value as? String, baseline)
        openAppearance(app)
        reveal(app.buttons[name], app)
        XCTAssertTrue(app.buttons[name].exists)
        capture("lab-appearance-saved-preset-after-relaunch")
        let delete = app.buttons["Delete preset \(name)"]; delete.tap()
        XCTAssertFalse(app.buttons[name].exists)
    }
    func testSystemAX5PreviewKeepsCloseAndDisplayControlsReachable() {
        let app = launch(accessibility: true)
        openAppearance(app)
        choose("lab-display-text-size", "Large", app)
        choose("lab-display-language", "简体中文", app, above: true)
        choose("product-lab-theme", "Dark", app, above: true)
        choose("lab-appearance-page", "Onboarding", app, above: true)
        openPreview(app)
        let size = app.descendants(matching: .any)["standalone-content-size"].firstMatch
        XCTAssertTrue(size.waitForExistence(timeout: 5))
        XCTAssertEqual(size.value as? String, "accessibility")
        XCTAssertEqual(app.descendants(matching: .any)["standalone-appearance"].firstMatch.value as? String, "dark")
        XCTAssertTrue(app.buttons["lab-preview-close"].isHittable)
        XCTAssertGreaterThanOrEqual(app.buttons["lab-preview-close"].frame.minY, 44, "Preview controls must remain below the device status area.")
        // AX frame subtraction can report 44 points as 43.999999999999986.
        XCTAssertGreaterThanOrEqual(app.buttons["lab-preview-close"].frame.height + 0.001, 44)
        XCTAssertTrue(app.buttons["lab-preview-controls"].isHittable)
        capture("lab-appearance-chinese-dark-system-ax5")
        app.buttons["lab-preview-controls"].tap()
        XCTAssertTrue(app.buttons["product-lab-theme"].waitForExistence(timeout: 5))
    }
}
