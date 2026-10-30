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
        let caption = "待发送截图；选择裁剪或遮挡后拖动来修改"
        let canvas = preview.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@ OR value == %@", caption, caption)).firstMatch
        XCTAssertTrue(canvas.waitForExistence(timeout: 5))
        // macOS exposes the canvas as StaticText.value and its AX frame also
        // unions the bottom-trailing hint. Locate the actual bitmap in the PNG.
        let imageRect = try renderedImageRect(in: preview)

        try selectTool("裁剪", in: preview)
        drag(in: preview, imageRect: imageRect, from: 0.25, to: 0.75)
        try selectTool("遮挡", in: preview)
        drag(in: preview, imageRect: imageRect, from: 0.375, to: 0.625)
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

    func testWorkspaceStatusNoticesRemainSeparateAndReachableInShortWindow() throws {
        let app = try launchWorkspaceFixture("status")
        let window = app.windows["Native accessibility fixture"]
        shortenFixtureWindow(window)
        let notices = ["workspace.settingsRecoveryNotice", "workspace.browserLaunchFailure", "workspace.calendarDownloadNotice"]
        let messages = [
            "SYNTHETIC workspace notice: the draft is local. Keep raw text %@ and its separate recovery action visible while other notices remain.",
            "SYNTHETIC account notice: the browser handoff was not confirmed. This fixture records a click only; no browser or account is opened.",
            "SYNTHETIC calendar notice: a fictional file needs attention. This fixture records a click only; no calendar file is opened or imported."
        ]
        XCTAssertTrue(workspaceNode(app, "workspace.loading").exists)
        for (identifier, message) in zip(notices, messages) {
            XCTAssertEqual(app.descendants(matching: .any).matching(identifier: identifier).count, 1)
            let value = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR value == %@", message, message)).firstMatch
            XCTAssertTrue(value.exists, "Each independent notice must retain its own raw message.")
        }
        let viewport = try fixtureScrollView(in: workspaceNode(app, "workspace.nativeStatusRegion"))
        let heading = app.staticTexts["fixture.workspace.contentHeading"]
        XCTAssertLessThanOrEqual(viewport.frame.maxY, heading.frame.minY + 1, "Native notices must reserve space above content.")
        retainWindow(window, name: "synthetic-workspace-three-notices-short-window")
        for (identifier, counter) in zip(notices, ["workbenchCalls", "accountCalls", "calendarCalls"]) {
            let action = app.buttons[identifier + ".record"]
            revealFixtureElement(action, in: viewport)
            XCTAssertEqual(text(app.staticTexts["fixture.workspace." + counter]), "0")
            action.click()
            waitForText(app.staticTexts["fixture.workspace." + counter], "1")
        }
        app.buttons["fixture.workspace.contentAction"].click()
        waitForText(app.staticTexts["fixture.workspace.contentCalls"], "1")
        for identifier in notices { XCTAssertTrue(workspaceNode(app, identifier).exists) }
        retainWindow(window, name: "synthetic-workspace-last-notice-and-uncovered-content")
    }

    func testWorkspaceRecoveryButtonsStayReachableAndOnlyRecordExplicitCallbacks() throws {
        let app = try launchWorkspaceFixture("recovery")
        let window = app.windows["Native accessibility fixture"]
        shortenFixtureWindow(window)
        let reason = Array(repeating: "SYNTHETIC failure detail — preserve raw %@ text. No account, network, saved sign-in or real connection is read by this presentation fixture.", count: 8).joined(separator: "\n")
        XCTAssertEqual(text(workspaceNode(app, "workspace.recovery.reason")), reason)
        XCTAssertEqual(text(app.staticTexts["fixture.workspace.reloadCalls"]), "0")
        XCTAssertEqual(text(app.staticTexts["fixture.workspace.connectionCalls"]), "0")
        let viewport = try fixtureScrollView(in: workspaceNode(app, "workspace.recovery"))
        retainWindow(window, name: "synthetic-workspace-long-failure-short-window")
        for (identifier, counter) in [("workspace.recovery.reload", "reloadCalls"), ("workspace.recovery.connection", "connectionCalls")] {
            let button = app.buttons[identifier]
            revealFixtureElement(button, in: viewport)
            button.click()
            waitForText(app.staticTexts["fixture.workspace." + counter], "1")
        }
        retainWindow(window, name: "synthetic-workspace-recovery-actions-reachable")
        app.buttons["fixture.workspace.restore"].click()
        waitForText(app.staticTexts["fixture.workspace.recoveryMode"], "restoring")
        XCTAssertFalse(app.buttons["workspace.recovery.reload"].exists)
        XCTAssertFalse(app.buttons["workspace.recovery.connection"].exists)
        XCTAssertFalse(workspaceNode(app, "workspace.recovery.reason").exists)
        XCTAssertEqual(text(app.staticTexts["fixture.workspace.reloadCalls"]), "1")
        XCTAssertEqual(text(app.staticTexts["fixture.workspace.connectionCalls"]), "1")
        retainWindow(window, name: "synthetic-workspace-restoring-has-no-recovery-actions")
    }

    func testSettingsSearchOwnsVisiblePaneAndPreservesIsolatedControlValues() throws {
        let app = try launchWorkspaceFixture("settings")
        let window = app.windows["Native accessibility fixture"]
        shortenFixtureWindow(window)
        let floating = workspaceNode(app, "settings.general.floating")
        let pane = try fixtureScrollView(in: workspaceNode(app, "fixture.settings.pane"))
        revealFixtureElement(floating, in: pane)
        floating.click()
        waitForText(app.staticTexts["fixture.settings.floating"], "true")
        let query = app.textFields["fixture.settings.query"]
        query.click()
        query.typeText("general")
        XCTAssertTrue(workspaceNode(app, "settings.search.results").waitForExistence(timeout: 5))
        XCTAssertFalse(floating.exists, "The mounted device control must leave the AX tree while search owns the pane.")
        retainWindow(window, name: "synthetic-settings-search-hides-mounted-device-controls")
        app.buttons["settings.search.close"].click()
        XCTAssertTrue(floating.waitForExistence(timeout: 5))
        XCTAssertEqual(text(app.staticTexts["fixture.settings.floating"]), "true")
        query.click()
        query.typeText("unmatched-synthetic-329")
        XCTAssertTrue(workspaceNode(app, "settings.search.empty").waitForExistence(timeout: 5))
        XCTAssertFalse(floating.exists)
        retainWindow(window, name: "synthetic-settings-empty-search-has-one-visible-owner")
        app.buttons["settings.search.close"].click()
        XCTAssertTrue(floating.waitForExistence(timeout: 5))
        XCTAssertEqual(text(app.staticTexts["fixture.settings.floating"]), "true")
        XCTAssertEqual(text(app.staticTexts["fixture.settings.selectionCalls"]), "0")
        retainWindow(window, name: "synthetic-settings-local-control-value-restored")
    }

    func testSettingsSearchAndSectionButtonsEmitOnlySelectedFixtureDestination() throws {
        let app = try launchWorkspaceFixture("settings")
        let window = app.windows["Native accessibility fixture"]
        shortenFixtureWindow(window)
        let query = app.textFields["fixture.settings.query"]
        query.click()
        query.typeText("permission")
        let result = app.buttons["settings.search.result.permissions"]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        XCTAssertEqual(text(app.staticTexts["fixture.settings.activated"]), "none")
        result.click()
        waitForText(app.staticTexts["fixture.settings.selection"], "permissions")
        XCTAssertEqual(text(app.staticTexts["fixture.settings.activated"]), "permissions")
        XCTAssertEqual(text(app.staticTexts["fixture.settings.selectionCalls"]), "1")
        XCTAssertTrue(app.buttons["settings.section.permissions"].isSelected)
        XCTAssertFalse(workspaceNode(app, "settings.search.results").exists)
        let sections = try fixtureScrollView(in: workspaceNode(app, "fixture.settings.sections"))
        for (section, count) in [("connection", "2"), ("general", "3")] {
            let button = app.buttons["settings.section." + section]
            revealFixtureElement(button, in: sections)
            button.click()
            waitForText(app.staticTexts["fixture.settings.selection"], section)
            XCTAssertTrue(button.isSelected)
            XCTAssertEqual(text(app.staticTexts["fixture.settings.selectionCalls"]), count)
        }
        XCTAssertTrue(workspaceNode(app, "settings.general.floating").exists)
        retainWindow(window, name: "synthetic-settings-search-and-real-section-selection")
        let report = XCTAttachment(string: "Pure presentation callbacks only. permissions search result → permissions; section buttons → connection → general. No System Settings, permission probe, browser, updater or connection service was constructed.")
        report.name = "synthetic-settings-destination-callback-report"
        report.lifetime = .keepAlways
        add(report)
    }

    private func launchWorkspaceFixture(_ mode: String) throws -> XCUIApplication {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["CAPIR_NATIVE_AX_DISPOSABLE_HOST"] == "1" else {
            throw XCTSkip("Use native-accessibility-acceptance.sh on a disposable hosted Mac.")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN",
                               "-ApplePersistenceIgnoreState", "YES", "--synthetic-workspace-\(mode)-fixture"]
        client = app
        app.launch()
        XCTAssertTrue(app.staticTexts["fixture.workspace.ready"].waitForExistence(timeout: 15))
        let expected = try XCTUnwrap(ProcessInfo.processInfo.environment["CAPIR_NATIVE_AX_APP_PATH"])
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: "com.getyak.acceptance.native-ax")
        XCTAssertEqual(running.count, 1)
        XCTAssertEqual(running.first?.bundleURL?.resolvingSymlinksInPath(),
                       URL(fileURLWithPath: expected).resolvingSymlinksInPath())
        return app
    }

    private func workspaceNode(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func shortenFixtureWindow(_ window: XCUIElement) {
        XCTAssertTrue(window.exists)
        let before = window.frame
        if before.height > 440 {
            let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1)).withOffset(CGVector(dx: -1, dy: -1))
            corner.click(forDuration: 0.2, thenDragTo: corner.withOffset(
                CGVector(dx: min(0, 760 - before.width), dy: 420 - before.height)))
        }
        let short = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in window.frame.height <= 440 }, object: window)
        XCTAssertEqual(XCTWaiter.wait(for: [short], timeout: 5), .completed)
        XCTAssertGreaterThanOrEqual(window.frame.height, 320)
    }

    private func fixtureScrollView(in region: XCUIElement) throws -> XCUIElement {
        XCTAssertTrue(region.waitForExistence(timeout: 5))
        let scroll = region.elementType == .scrollView ? region : region.scrollViews.firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout: 5), "The real short-window surface must provide native scrolling.")
        return scroll
    }

    private func revealFixtureElement(_ target: XCUIElement, in viewport: XCUIElement) {
        // Real wheel events only. Try both directions because the recovery
        // surface's real focus state may already have scrolled to its actions.
        for step in 0..<32 {
            if target.isHittable && viewport.frame.insetBy(dx: -1, dy: -1).contains(target.frame) { return }
            viewport.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                .scroll(byDeltaX: 0, deltaY: step < 16 ? -60 : 60)
        }
        XCTAssertTrue(target.isHittable, "The actual scroll surface must expose this action.")
        XCTAssertTrue(viewport.frame.insetBy(dx: -1, dy: -1).contains(target.frame), "The full action must be inside its scroll viewport.")
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
        let cancel = preview.buttons["取消"]
        let reachable = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: cancel)
        XCTAssertEqual(XCTWaiter.wait(for: [reachable], timeout: 5), .completed)
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

    private func drag(in window: XCUIElement, imageRect: CGRect, from start: CGFloat, to end: CGFloat) {
        let origin = window.coordinate(withNormalizedOffset: .zero)
        let first = origin.withOffset(CGVector(dx: imageRect.minX + start * imageRect.width,
                                               dy: imageRect.minY + start * imageRect.height))
        let last = origin.withOffset(CGVector(dx: imageRect.minX + end * imageRect.width,
                                              dy: imageRect.minY + end * imageRect.height))
        first.click(forDuration: 0.2, thenDragTo: last)
    }

    private func renderedImageRect(in window: XCUIElement) throws -> CGRect {
        let screenshot = window.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "synthetic-capture-rendered-image-location"
        attachment.lifetime = .keepAlways
        add(attachment)
        let bitmap = try XCTUnwrap(NSBitmapImageRep(data: screenshot.pngRepresentation))
        let scaleX = CGFloat(bitmap.pixelsWide) / window.frame.width
        let scaleY = CGFloat(bitmap.pixelsHigh) / window.frame.height
        XCTAssertEqual(scaleX, scaleY, accuracy: 0.01, "The fixture window PNG must not be clipped.")
        var left = bitmap.pixelsWide, top = bitmap.pixelsHigh, right = -1, bottom = -1
        for y in 0..<bitmap.pixelsHigh {
            autoreleasepool {
                for x in 0..<bitmap.pixelsWide {
                    // ICC conversion can add green to a painted magenta marker.
                    // Require bright red/blue and a large chroma gap; white and
                    // blue controls cannot satisfy this source-only predicate.
                    guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.sRGB),
                          color.redComponent > 0.85, color.blueComponent > 0.85,
                          min(color.redComponent, color.blueComponent) - color.greenComponent > 0.6 else { continue }
                    left = min(left, x); top = min(top, y)
                    right = max(right, x); bottom = max(bottom, y)
                }
            }
        }
        XCTAssertGreaterThan(right - left, 100, "The synthetic source border must be painted.")
        XCTAssertGreaterThan(bottom - top, 100)
        let rect = CGRect(x: CGFloat(left) / scaleX, y: CGFloat(top) / scaleY,
                          width: CGFloat(right - left + 1) / scaleX, height: CGFloat(bottom - top + 1) / scaleY)
        XCTAssertEqual(rect.width / rect.height, 2, accuracy: 0.03, "The complete 800×400 source must be visible.")
        let report = XCTAttachment(string: "Fixture window: \(window.frame); PNG pixels: \(bitmap.pixelsWide)×\(bitmap.pixelsHigh); rendered synthetic image in window points: \(rect)")
        report.name = "synthetic-capture-rendered-image-geometry"
        report.lifetime = .keepAlways
        add(report)
        return rect
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
