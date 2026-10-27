import AppKit
import XCTest

/// An actual out-of-process accessibility client requests SwiftUI's virtual
/// nodes. Direct NSHostingView children alone expose only AppKit containers.
final class NativeAccessibilityFixtureTests: XCTestCase {
    private var client: XCUIApplication?

    override func tearDown() {
        if let client {
            let cleanup = client.buttons["fixture.cleanup"]
            if cleanup.exists {
                cleanup.click()
                XCTAssertEqual(text(client.staticTexts["fixture.preferences"]), "cleaned")
            }
            client.terminate()
        }
        client = nil
        super.tearDown()
    }

    private func launch() throws -> XCUIApplication {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["CAPIR_NATIVE_AX_DISPOSABLE_HOST"] == "1" else {
            throw XCTSkip("Use native-accessibility-acceptance.sh on a disposable hosted Mac.")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN",
                               "-ApplePersistenceIgnoreState", "YES"]
        client = app
        app.launch()
        XCTAssertTrue(app.buttons["fixture.next"].waitForExistence(timeout: 15))
        let expected = try XCTUnwrap(ProcessInfo.processInfo.environment["CAPIR_NATIVE_AX_APP_PATH"])
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: "com.getyak.acceptance.native-ax")
        XCTAssertEqual(running.count, 1)
        XCTAssertEqual(running.first?.bundleURL?.resolvingSymlinksInPath(),
                       URL(fileURLWithPath: expected).resolvingSymlinksInPath())
        return app
    }

    func testBrowserLoginSurfaceLocalizesOwnedPhasesAndKeepsReturnedTextVerbatim() throws {
        let app = try launch()
        let path = try XCTUnwrap(ProcessInfo.processInfo.environment["CAPIR_NATIVE_AX_APP_PATH"])
        let bundle = try XCTUnwrap(Bundle(path: path))
        let localePath = try XCTUnwrap(bundle.path(forResource: "zh-Hans", ofType: "lproj"))
        let chinese = try XCTUnwrap(Bundle(path: localePath))
        let cases: [(String, String, String)] = [
            ("idle", "desktop.login.message", "Choose an account in the browser. Your workspace opens after sign-in."),
            ("preparing", "desktop.login.progress", "Preparing sign-in…"),
            ("waiting", "desktop.login.progress", "Waiting for browser confirmation…"),
            ("exchanging", "desktop.login.progress", "Verifying sign-in on this Mac…"),
            ("completed", "desktop.login.progress", "Opening your workspace…"),
            ("cancelled", "desktop.login.message", "Sign-in was cancelled. You can start again at any time."),
            ("unresolved-check", "desktop.login.message", "We cannot confirm whether this Mac finished signing in. Check the result or start again."),
            ("unresolved-restart", "desktop.login.message", "We cannot confirm whether this Mac finished signing in. Start sign-in again."),
            ("failed", "desktop.login.message", "原始返回错误：do not translate %@")
        ]
        for (index, item) in cases.enumerated() {
            XCTAssertEqual(text(app.staticTexts["fixture.phase"]), item.0)
            let node = app.descendants(matching: .any).matching(identifier: item.1).firstMatch
            XCTAssertTrue(node.waitForExistence(timeout: 5))
            let expected = index == 8 ? item.2 : chinese.localizedString(forKey: item.2, value: nil, table: nil)
            if index != 8 { XCTAssertNotEqual(expected, item.2, "The Chinese catalog must supply this owned phase.") }
            XCTAssertTrue(node.label == expected || node.value as? String == expected,
                          "Rendered phase \(item.0) must localize owned text and preserve raw errors.")
            if index == 2 {
                let hint = app.descendants(matching: .any).matching(identifier: "desktop.login.matchingHint").firstMatch
                XCTAssertTrue(hint.label == "AbC-42" || hint.value as? String == "AbC-42")
            }
            if index + 1 < cases.count { app.buttons["fixture.next"].click() }
        }
    }

    func testDesktopPetVirtualButtonDefaultPressOpensExistingWorkspaceOnce() throws {
        let app = try launch()
        XCTAssertTrue(app.buttons["desktopPet.openWorkspace"].waitForExistence(timeout: 10))
        // The disposable runner cannot acquire additional CoreAX authority.
        // After its actual AX client exposes the button, ask the fixture to
        // invoke that exact child's public AppKit handler, with no parent or
        // controller shortcut. Full cross-process AX transport remains manual.
        app.buttons["fixture.press"].click()
        XCTAssertEqual(text(app.staticTexts["fixture.pressResult"]), "performed")
        let opened = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == '1' OR value == '1'"),
                                              object: app.staticTexts["fixture.opens"])
        XCTAssertEqual(XCTWaiter.wait(for: [opened], timeout: 5), .completed)
        XCTAssertEqual(text(app.staticTexts["fixture.opens"]), "1")
        XCTAssertEqual(text(app.staticTexts["fixture.invariants"]), "preserved")
    }

    private func text(_ node: XCUIElement) -> String {
        node.label.isEmpty ? (node.value as? String ?? "") : node.label
    }

}
