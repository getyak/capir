import AppKit
import ApplicationServices
import XCTest

/// An actual out-of-process accessibility client requests SwiftUI's virtual
/// nodes. Direct NSHostingView children alone expose only AppKit containers.
final class NativeAccessibilityFixtureTests: XCTestCase {
    private var client: XCUIApplication?
    private var axDiagnostics: [String] = []

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
        let running = try XCTUnwrap(NSRunningApplication.runningApplications(withBundleIdentifier: "com.getyak.acceptance.native-ax").first)
        let root = AXUIElementCreateApplication(running.processIdentifier)
        let button = try XCTUnwrap(find(root, identifier: "desktopPet.openWorkspace"),
                                   "CoreAX trusted=\(AXIsProcessTrusted()); \(axDiagnostics.joined(separator: " | "))")
        XCTAssertEqual(string(button, attribute: kAXRoleAttribute), kAXButtonRole)
        var actions: CFArray?
        XCTAssertEqual(AXUIElementCopyActionNames(button, &actions), .success)
        XCTAssertTrue((actions as? [String])?.contains(kAXPressAction) == true)
        // This performs the virtual child's default AX action, not a physical
        // mouse click, hosting-view override or direct controller call.
        XCTAssertEqual(AXUIElementPerformAction(button, kAXPressAction as CFString), .success)
        let opened = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == '1' OR value == '1'"),
                                              object: app.staticTexts["fixture.opens"])
        XCTAssertEqual(XCTWaiter.wait(for: [opened], timeout: 5), .completed)
        XCTAssertEqual(text(app.staticTexts["fixture.opens"]), "1")
        XCTAssertEqual(text(app.staticTexts["fixture.invariants"]), "preserved")
    }

    private func text(_ node: XCUIElement) -> String {
        node.label.isEmpty ? (node.value as? String ?? "") : node.label
    }

    private func string(_ node: AXUIElement, attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(node, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }
    private func find(_ node: AXUIElement, identifier: String, depth: Int = 0) -> AXUIElement? {
        guard depth < 24 else { return nil }
        if string(node, attribute: kAXIdentifierAttribute) == identifier { return node }
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(node, kAXChildrenAttribute as CFString, &value)
        if axDiagnostics.count < 40 {
            axDiagnostics.append("depth=\(depth) role=\(string(node, attribute: kAXRoleAttribute) ?? "nil") id=\(string(node, attribute: kAXIdentifierAttribute) ?? "nil") childrenResult=\(result.rawValue) count=\((value as? [AXUIElement])?.count ?? -1)")
        }
        guard result == .success, let children = value as? [AXUIElement] else { return nil }
        for child in children {
            if let found = find(child, identifier: identifier, depth: depth + 1) { return found }
        }
        return nil
    }
}
