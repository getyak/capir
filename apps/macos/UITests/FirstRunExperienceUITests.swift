import XCTest
import AppKit
import CryptoKit

/// Runs only on the disposable CI desktop. A supplied URL selects the unchanged
/// downloaded signed app; otherwise this exercises the PR's compiled app.
final class FirstRunExperienceUITests: XCTestCase {
    private var app: XCUIApplication?

    override func tearDown() {
        app?.terminate()
        app = nil
        super.tearDown()
    }

    private func launch() throws -> XCUIApplication {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["CAPIR_FIRST_RUN_DISPOSABLE_HOST"] == "1" else {
            throw XCTSkip("Use first-run-acceptance.sh on the disposable hosted Mac; never launch this against a local product profile.")
        }
        let suppliedPath = ProcessInfo.processInfo.environment["CAPIR_FIRST_RUN_APP_PATH"] ?? ""
        let client: XCUIApplication
        if suppliedPath.isEmpty {
            client = XCUIApplication()
        } else {
            XCTAssertTrue(FileManager.default.fileExists(atPath: suppliedPath), "The actual published app must exist.")
            client = XCUIApplication(url: URL(fileURLWithPath: suppliedPath))
        }
        client.launchArguments = ["-ApplePersistenceIgnoreState", "YES", "-desktopPet.visible", "NO",
                                  "-SUEnableAutomaticChecks", "NO", "--reduced-motion-preview"]
        app = client
        client.launch()
        XCTAssertTrue(client.buttons["firstRun.connect"].waitForExistence(timeout: 10))
        if !suppliedPath.isEmpty {
            let expected = URL(fileURLWithPath: suppliedPath).resolvingSymlinksInPath()
            let bundle = try XCTUnwrap(Bundle(url: expected))
            let identifier = try XCTUnwrap(bundle.bundleIdentifier)
            let running = NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
            XCTAssertEqual(running.count, 1, "A second/default-target app cannot substitute for the published app.")
            let actual = try XCTUnwrap(running.first?.bundleURL).resolvingSymlinksInPath()
            XCTAssertEqual(actual, expected)
            let executable = try XCTUnwrap(bundle.executableURL)
            let hash = SHA256.hash(data: try Data(contentsOf: executable)).map { String(format: "%02x", $0) }.joined()
            let receipt = ["requestedApp": expected.path, "runningApp": actual.path,
                           "identifier": identifier, "executableSHA256": hash,
                           "version": bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
                           "build": bundle.infoDictionary?["CFBundleVersion"] as? String ?? ""]
            let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]),
                                           uniformTypeIdentifier: "public.json")
            attachment.name = "actual-published-app-identity"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        return client
    }

    private func reveal(_ element: XCUIElement, in client: XCUIApplication) {
        let scroll = client.scrollViews["firstRun.experience"]
        for _ in 0..<4 {
            if element.isHittable { break }
            scroll.swipeUp()
        }
        XCTAssertTrue(element.isHittable)
    }

    private func capture(_ name: String, in client: XCUIApplication) {
        let screenshot = XCTAttachment(screenshot: client.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testKeyboardCanOpenTheOptionalExampleInspectAndExplicitlyCorrectIt() throws {
        let client = try launch()
        // The invitation gives initial focus to Connect. The next native button
        // must be reachable using real Tab/Space with Keyboard Navigation on.
        client.typeKey(.tab, modifierFlags: [])
        client.typeKey(.space, modifierFlags: [])
        XCTAssertTrue(client.buttons["sample.reveal"].waitForExistence(timeout: 5))
        client.typeKey(.space, modifierFlags: [])
        XCTAssertTrue(client.buttons["sample.insight.dependency"].waitForExistence(timeout: 5),
                      "Entering the example must focus Reveal so the next Space exposes its interpretations.")
        client.typeKey(.space, modifierFlags: [])
        XCTAssertTrue(client.buttons["sample.edit"].waitForExistence(timeout: 5),
                      "Revealing the interpretations must focus the first insight so Space opens its source.")
        client.typeKey(.tab, modifierFlags: [])
        client.typeKey(.space, modifierFlags: [])
        let quote = client.descendants(matching: .any)["sample.selectedSource"]
        XCTAssertTrue(quote.waitForExistence(timeout: 5))
        XCTAssertTrue(quote.label.contains("周四我们再聊") || (quote.value as? String)?.contains("周四我们再聊") == true)
        reveal(client.buttons["sample.edit"], in: client)
        client.buttons["sample.edit"].click()
        let editor = client.textViews["sample.correction"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.click()
        client.typeKey("a", modifierFlags: [.command])
        editor.typeText("Confirm Thursday before preparing a draft.")
        client.typeKey(.return, modifierFlags: [.command])
        XCTAssertTrue(client.buttons["sample.insight.agreement"].label.contains("Confirm Thursday before preparing a draft."))
        XCTAssertTrue(client.buttons["sample.insight.dependency"].label.contains("预算尚待确认。"))
        capture("source-backed-keyboard-correction", in: client)
        client.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(client.buttons["firstRun.connect"].waitForExistence(timeout: 5))
    }

    func testHiddenConnectionCannotReceiveKeysOrSaveWhenReturnReopensIt() throws {
        let client = try launch()
        client.typeKey(.return, modifierFlags: [])
        let address = client.textFields["connection.address"]
        XCTAssertTrue(address.waitForExistence(timeout: 5))
        address.click()
        address.typeText("https://work.example")
        client.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(client.buttons["firstRun.connect"].waitForExistence(timeout: 5))
        client.typeKey("x", modifierFlags: [])
        client.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(address.waitForExistence(timeout: 5), "Return must only show the form, not save a hidden address.")
        XCTAssertEqual(address.value as? String, "https://work.example")
        capture("hidden-address-remains-unchanged", in: client)
    }

    func testConnectionEscapeIgnoresAnUnappliedHiddenExampleEdit() throws {
        let client = try launch()
        client.buttons["firstRun.tryExample"].click()
        client.buttons["sample.reveal"].click()
        client.buttons["sample.insight.agreement"].click()
        reveal(client.buttons["sample.edit"], in: client)
        client.buttons["sample.edit"].click()
        let editor = client.textViews["sample.correction"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.click()
        client.typeKey("a", modifierFlags: [.command])
        editor.typeText("Unapplied local draft")
        client.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(client.buttons["sample.edit"].waitForExistence(timeout: 5), "Escape cancels only the visible editor.")
        client.buttons["sample.edit"].click()
        let scroll = client.scrollViews["firstRun.experience"]
        for _ in 0..<3 { scroll.swipeUp() }
        client.buttons["sample.connect"].click()
        XCTAssertTrue(client.textFields["connection.address"].waitForExistence(timeout: 5))
        client.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(client.buttons["firstRun.connect"].waitForExistence(timeout: 5), "Connection Escape must not cancel a hidden sample draft instead.")
        capture("connection-escape-returns-invitation", in: client)
    }
}
