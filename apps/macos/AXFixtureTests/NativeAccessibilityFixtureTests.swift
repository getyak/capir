import AppKit
import XCTest

/// An actual out-of-process accessibility client requests SwiftUI's virtual
/// nodes. Direct NSHostingView children alone expose only AppKit containers.
final class NativeAccessibilityFixtureTests: XCTestCase {
    private var client: XCUIApplication?

    override func tearDown() {
        if let client {
            let preview = client.windows["capri · 截图预览"]
            if preview.exists, preview.buttons["取消"].exists { preview.buttons["取消"].click() }
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

    private func launch(capture: Bool = false) throws -> XCUIApplication {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["CAPIR_NATIVE_AX_DISPOSABLE_HOST"] == "1" else {
            throw XCTSkip("Use native-accessibility-acceptance.sh on a disposable hosted Mac.")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN",
                               "-ApplePersistenceIgnoreState", "YES"]
        if capture { app.launchArguments.append("--synthetic-capture-fixture") }
        client = app
        app.launch()
        XCTAssertTrue(app.buttons[capture ? "fixture.capture.start" : "fixture.next"].waitForExistence(timeout: 15))
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

    func testCaptureSelectionPThenSpaceKeepsPreviewIntentWithoutSending() throws {
        let app = try launch(capture: true)
        let preview = try openSyntheticPreview(app)
        XCTAssertEqual(text(app.staticTexts["fixture.capture.windowRequests"]), "1")
        XCTAssertEqual(text(app.staticTexts["fixture.capture.windowPreview"]), "true")
        XCTAssertEqual(text(app.staticTexts["fixture.capture.submissions"]), "0")
        XCTAssertEqual(text(app.staticTexts["fixture.capture.effects"]), "synthetic-only")
        retainWindow(preview, name: "synthetic-capture-p-space-preview")
        preview.buttons["取消"].click()
        waitForDismissal(preview)
        XCTAssertEqual(text(app.staticTexts["fixture.capture.submissions"]), "0", "Cancelling preview must not send.")
    }

    func testCapturePreviewCropAndMaskSurviveActualWindowResizeUntilExplicitSend() throws {
        let app = try launch(capture: true)
        let preview = try openSyntheticPreview(app)
        let canvas = preview.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", "待发送截图；选择裁剪或遮挡后拖动来修改")).firstMatch
        XCTAssertTrue(canvas.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(canvas.frame.width, 100)
        XCTAssertGreaterThan(canvas.frame.height, 100)

        try selectTool("裁剪", in: preview)
        drag(in: canvas, from: 0.25, to: 0.75)
        try selectTool("遮挡", in: preview)
        drag(in: canvas, from: 0.375, to: 0.625)
        XCTAssertEqual(text(app.staticTexts["fixture.capture.submissions"]), "0")
        retainWindow(preview, name: "synthetic-capture-crop-mask-before-resize")

        // Resize the actual AppKit window with a native pointer drag. No edit
        // helper, model setter or replacement hosting view supplies the result.
        let before = preview.frame
        let corner = preview.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1))
            .withOffset(CGVector(dx: -1, dy: -1))
        corner.click(forDuration: 0.2, thenDragTo: corner.withOffset(CGVector(dx: 80, dy: 50)))
        let resized = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            preview.frame.width > before.width + 30 && preview.frame.height > before.height + 20
        }, object: preview)
        XCTAssertEqual(XCTWaiter.wait(for: [resized], timeout: 5), .completed)
        retainWindow(preview, name: "synthetic-capture-crop-mask-after-resize")
        XCTAssertEqual(text(app.staticTexts["fixture.capture.submissions"]), "0", "Editing and resizing cannot send.")

        preview.buttons["发送截图"].click()
        waitForText(app.staticTexts["fixture.capture.submissions"], "1")
        waitForDismissal(preview)
        let dimensions = text(app.staticTexts["fixture.capture.pngSize"]).split(separator: "x").compactMap { Double($0) }
        XCTAssertEqual(dimensions.count, 2)
        // Native pointer positions are rounded to display pixels. A maximum
        // three-source-pixel tolerance covers those endpoints; an erased crop
        // would instead restore the original 800×400 image and fail this check.
        XCTAssertEqual(try XCTUnwrap(dimensions.first), 400, accuracy: 3)
        XCTAssertEqual(try XCTUnwrap(dimensions.last), 200, accuracy: 3)
        XCTAssertEqual(text(app.staticTexts["fixture.capture.maskRGB"]), "0,0,0")
        XCTAssertEqual(text(app.staticTexts["fixture.capture.clearRGB"]), "255,255,255")
        XCTAssertEqual(text(app.staticTexts["fixture.capture.submissions"]), "1")
        XCTAssertEqual(text(app.staticTexts["fixture.capture.effects"]), "synthetic-only")
        let report = XCTAttachment(string: "In-memory recorder only; no backend proof. PNG: " +
            text(app.staticTexts["fixture.capture.pngSize"]) + "; center RGB: " +
            text(app.staticTexts["fixture.capture.maskRGB"]) + "; clear RGB: " +
            text(app.staticTexts["fixture.capture.clearRGB"]) + "; submissions: " +
            text(app.staticTexts["fixture.capture.submissions"]))
        report.name = "synthetic-capture-recorder-report"
        report.lifetime = .keepAlways
        add(report)
    }

    private func openSyntheticPreview(_ app: XCUIApplication) throws -> XCUIElement {
        XCTAssertEqual(text(app.staticTexts["fixture.capture.submissions"]), "0")
        app.buttons["fixture.capture.start"].click()
        waitForText(app.staticTexts["fixture.capture.stage"], "selecting")
        // The fixture makes the actual selection NSView first responder. These
        // keys travel through AppKit keyDown and its real intent callback.
        app.typeKey("p", modifierFlags: [])
        app.typeKey(XCUIKeyboardKey.space, modifierFlags: [])
        let preview = app.windows["capri · 截图预览"]
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        waitForText(app.staticTexts["fixture.capture.stage"], "preview-ready")
        XCTAssertEqual(text(app.staticTexts["fixture.capture.submissions"]), "0")
        return preview
    }

    private func selectTool(_ title: String, in preview: XCUIElement) throws {
        // AppKit exposes SwiftUI's segmented Picker as radio buttons on some
        // supported macOS versions and buttons on others. Both are real nodes.
        let radio = preview.radioButtons[title]
        let button = preview.buttons[title]
        let control = radio.exists ? radio : button
        XCTAssertTrue(control.waitForExistence(timeout: 5), "Missing actual preview tool: \(title)")
        control.click()
    }

    private func drag(in canvas: XCUIElement, from start: CGFloat, to end: CGFloat) {
        // The labelled element is the viewport. Match the real aspect-fitted
        // 800×400 image inside it, including any centred letterbox margins.
        let scale = min(canvas.frame.width / 800, canvas.frame.height / 400)
        let size = CGSize(width: 800 * scale, height: 400 * scale)
        let center = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let first = center.withOffset(CGVector(dx: (start - 0.5) * size.width, dy: (start - 0.5) * size.height))
        let last = center.withOffset(CGVector(dx: (end - 0.5) * size.width, dy: (end - 0.5) * size.height))
        first.click(forDuration: 0.2, thenDragTo: last)
    }

    private func waitForText(_ node: XCUIElement, _ expected: String) {
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@ OR value == %@", expected, expected),
                                                object: node)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed)
    }

    private func waitForDismissal(_ window: XCUIElement) {
        let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: window)
        XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 5), .completed)
    }

    private func retainWindow(_ window: XCUIElement, name: String) {
        // Only this launch-verified fixture's own window is captured. Never
        // request a display, desktop, another process, or an external screenshot.
        let attachment = XCTAttachment(screenshot: window.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func text(_ node: XCUIElement) -> String {
        node.label.isEmpty ? (node.value as? String ?? "") : node.label
    }

}
