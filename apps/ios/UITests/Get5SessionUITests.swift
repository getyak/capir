import XCTest
import UIKit

@MainActor
final class Get5SessionUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchEnvironment["TS_IOS_UI_TEST_PREVIEW_WORKSPACE"] = "true"
        app.launchArguments = [
            "--preview-workspace", "--persist-preview-agent", "--reset-preview-agent",
            "--fixture-get-5-markdown", "--deterministic-voice-input",
            "-voice-input-cloud-disclosure-v1", "YES",
            "-talent-signal.interface-language", "en",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
    }

    func testContinuousSessionMarkdownControlsForkAndNativeBack() {
        app.launch()
        openNewComposer()
        XCTAssertTrue(app.buttons["ask-close"].exists)
        send("Create a review plan from this synthetic note.")
        let firstBlockID = waitForNewResponseBlock(excluding: [])
        XCTAssertTrue(answerBody.exists)
        XCTAssertFalse(app.staticTexts["Agent answer"].exists)
        XCTAssertFalse(app.buttons["ask-close"].exists)
        XCTAssertTrue(app.navigationBars.buttons.firstMatch.exists)
        XCTAssertTrue(app.buttons["ask-session-menu"].exists)
        XCTAssertTrue(element("agent-markdown-table").exists)
        XCTAssertTrue(element("agent-markdown-code").exists)
        capture("GET-5 structured Markdown response")

        send("Keep the original message and explain the next step.")
        let secondBlockID = waitForNewResponseBlock(excluding: [firstBlockID])
        let secondTurn = responseTurn(containing: secondBlockID)
        let copy = secondTurn.buttons["ask-copy"]
        reveal(copy)
        for identifier in ["ask-regenerate", "ask-copy", "ask-feedback-helpful", "ask-feedback-unhelpful"] {
            let control = secondTurn.buttons[identifier]
            XCTAssertGreaterThanOrEqual(control.frame.width, 44)
            XCTAssertGreaterThanOrEqual(control.frame.height, 44)
        }
        copy.tap()
        XCTAssertEqual(copy.label, "Copied")
        let helpful = secondTurn.buttons["ask-feedback-helpful"]
        helpful.tap()
        XCTAssertEqual(helpful.value as? String, "Selected")
        helpful.tap()
        XCTAssertNotEqual(helpful.value as? String, "Selected")
        let priorFeedback = secondTurn.buttons["ask-feedback-unhelpful"]
        priorFeedback.tap()
        XCTAssertEqual(priorFeedback.value as? String, "Selected")
        capture("GET-5 compact response controls")
        secondTurn.buttons["ask-regenerate"].tap()
        let regeneratedBlockID = waitForNewResponseBlock(excluding: [firstBlockID, secondBlockID])
        XCTAssertNotEqual(regeneratedBlockID, secondBlockID)
        revealEarlier(priorFeedback)
        XCTAssertEqual(priorFeedback.value as? String, "Selected",
                       "Regeneration must preserve feedback on the prior response.")
        XCTAssertTrue(element(secondBlockID).exists)
        let originalSource = app.staticTexts["Create a review plan from this synthetic note."]
        revealEarlier(originalSource)
        XCTAssertTrue(originalSource.exists, "Regeneration must retain the exact original source message.")
        XCTAssertTrue(element(firstBlockID).exists)
        capture("GET-5 regenerate keeps original source and prior feedback")

        app.buttons["ask-session-menu"].tap()
        XCTAssertTrue(app.buttons["ask-share-session"].waitForExistence(timeout: 3))
        app.buttons["ask-fork-session"].tap()
        // A lazy conversation need not expose all offscreen rows at once. Each
        // original response identity must still be reachable in the fork.
        revealEarlier(element(firstBlockID))
        for blockID in [firstBlockID, secondBlockID, regeneratedBlockID] {
            reveal(element(blockID))
            XCTAssertTrue(element(blockID).exists)
        }
        reveal(element("ask-source-review-notice"))
        capture("GET-5 fork preserves source messages and regenerated reply")

        // Exercise UIKit's native interactive-pop transition from the screen edge.
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.45))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.82, dy: 0.45))
        start.press(forDuration: 0.1, thenDragTo: end)
        XCTAssertTrue(app.buttons["archive-tab-sessions"].waitForExistence(timeout: 5))
        app.buttons["archive-tab-sessions"].tap()
        let sessions = app.buttons.matching(NSPredicate(format: "identifier MATCHES %@", "agent-session-[0-9A-Fa-f-]{36}"))
        XCTAssertEqual(sessions.count, 2, "Fork adds one Session; the original remains available.")
        XCTAssertEqual(sessions.matching(NSPredicate(format: "label CONTAINS %@", "Forked Session")).count, 1,
                       "Only the fork has a persistent visible and accessible branch identity.")
        XCTAssertEqual(sessions.matching(NSPredicate(format: "NOT (label CONTAINS %@)", "Forked Session")).count, 1)
        capture("GET-5 original and fork in Sessions")
    }

    func testShareSessionUsesReviewedSummaryCardAndExplicitConversationScope() {
        app.launchArguments.append("--fixture-get-27-long-share-summary")
        app.launch()
        openNewComposer()
        send("Create a review plan from this synthetic note.")
        _ = waitForNewResponseBlock(excluding: [])

        app.buttons["ask-session-menu"].tap()
        XCTAssertTrue(app.buttons["ask-share-session"].waitForExistence(timeout: 3))
        app.buttons["ask-share-session"].tap()
        XCTAssertTrue(element("ask-share-review-sheet").waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["ask-share-scope-summary"].exists)
        XCTAssertEqual(app.buttons["ask-share-scope-summary"].isSelected, true)
        XCTAssertTrue(element("ask-share-preview").exists)
        let excerpt = element("ask-share-preview-excerpt")
        XCTAssertTrue(excerpt.exists)
        XCTAssertGreaterThan(
            excerpt.frame.height,
            200,
            "The review card must lay out every character exported by the summary text representation."
        )
        XCTAssertTrue(element("ask-share-safety-disclosure").exists)
        XCTAssertTrue(element("ask-share-link").waitForExistence(timeout: 3))
        capture("GET-27 reviewed summary card")

        app.buttons["ask-share-scope-conversation"].tap()
        XCTAssertTrue(element("ask-share-conversation-preview").waitForExistence(timeout: 3))
        XCTAssertTrue(element("ask-share-link").exists)
        XCTAssertTrue(element("ask-share-safety-disclosure").exists)
        capture("GET-27 explicit readable conversation")
        app.buttons["ask-share-close"].tap()
        XCTAssertTrue(element("ask-share-review-sheet").waitForNonExistence(timeout: 3))
    }

    func testOrdinaryEmptyEditorTapKeepsTextInputAndNeverStartsVoice() {
        app.launch()
        openNewComposer()
        let composer = app.textFields["ask-composer"]
        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(composer.exists)
        XCTAssertFalse(element("ask-active-voice-ribbon").exists)
        composer.typeText("An ordinary tap opens text input.")
        XCTAssertEqual(composer.value as? String, "An ordinary tap opens text input.")
        XCTAssertFalse(element("ask-active-voice-ribbon").exists)
        XCTAssertTrue(app.buttons["ask-send"].exists)
        capture("GET-5 ordinary empty-input tap preserves native typing")
    }

    func testHoldingEmptyTextRegionCreatesEditableVoiceDraft() {
        app.launch()
        openNewComposer()
        let composer = app.textFields["ask-composer"]
        composer.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.55)).press(forDuration: 0.7)
        XCTAssertTrue(app.buttons["ask-send"].waitForExistence(timeout: 8))
        XCTAssertEqual(composer.value as? String, "What changed in this search?")
        XCTAssertFalse(element("ask-response-turn").exists)
        XCTAssertFalse(element("ask-active-voice-ribbon").exists)
        capture("GET-5 whole empty input hold produces reviewable words")
    }

    func testHoldingTypedTextNeverReplacesTheDraft() {
        app.launch()
        openNewComposer()
        let composer = app.textFields["ask-composer"]
        composer.tap()
        composer.typeText("Preserve these exact words.")
        composer.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.7)
        XCTAssertFalse(element("ask-active-voice-ribbon").exists)
        XCTAssertEqual(composer.value as? String, "Preserve these exact words.")
        XCTAssertTrue(app.buttons["ask-send"].exists)
    }

    func testMissingRelationshipContactCanBeDeclinedWithoutLosingTheMessage() {
        app.launchArguments.removeAll { $0 == "--fixture-get-5-markdown" }
        app.launchArguments.append("--fixture-agent-contact-proposal")
        app.launch()
        openNewComposer()
        send("Add contact Alex Rivera, email alex@example.com")
        let proposal = element("contact-proposal-card")
        XCTAssertTrue(proposal.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Relationship needed"].exists)
        XCTAssertFalse(app.buttons["contact-confirm-save"].isEnabled)
        for identifier in ["contact-dismiss-proposal", "contact-edit-details"] {
            XCTAssertGreaterThanOrEqual(app.buttons[identifier].frame.width, 44)
            XCTAssertGreaterThanOrEqual(app.buttons[identifier].frame.height, 44)
        }
        XCTAssertTrue(element("ask-user-message").exists)
        app.buttons["contact-dismiss-proposal"].tap()
        XCTAssertTrue(proposal.waitForNonExistence(timeout: 5))
        XCTAssertTrue(element("ask-user-message").exists)
        XCTAssertTrue(app.buttons["ask-session-menu"].exists)
        capture("GET-5 declining contact preserves the Session source")
    }

    func testInterruptedScreenshotRestoresReattachmentGateWithoutTextReplay() {
        app.launchArguments.append("--fixture-get-5-interrupted-screenshot")
        app.launch()
        openNewComposer()
        XCTAssertTrue(element("ask-screenshot-admission-recovery").waitForExistence(timeout: 5))
        XCTAssertFalse(element("ask-response-turn").exists)
        XCTAssertFalse(app.textFields["ask-composer"].isEnabled)
        let reattach = app.buttons["ask-reattach-admission-screenshots"]
        XCTAssertTrue(reattach.exists)
        XCTAssertGreaterThanOrEqual(reattach.frame.width, 44)
        XCTAssertGreaterThanOrEqual(reattach.frame.height, 44)
        capture("GET-5 interrupted screenshot preserves a typed recovery gate")
        app.terminate()
        app.launchArguments.removeAll { $0 == "--reset-preview-agent" || $0 == "--fixture-get-5-interrupted-screenshot" }
        app.launch()
        app.buttons["archive-tab-sessions"].tap()
        let saved = app.buttons.matching(NSPredicate(format: "identifier MATCHES %@", "agent-session-[0-9A-Fa-f-]{36}")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        saved.tap()
        XCTAssertTrue(element("ask-screenshot-admission-recovery").waitForExistence(timeout: 5))
        XCTAssertFalse(element("ask-response-turn").exists)
        XCTAssertFalse(app.textFields["ask-composer"].isEnabled)
    }

    func testMarkdownChineseDarkAX5ReducedMotionRemainsReachable() {
        app.launchArguments = [
            "--preview-workspace", "--persist-preview-agent", "--reset-preview-agent", "--fixture-get-5-markdown",
            "--fixture-get-5-accessibility5", "--fixture-get-5-reduced-motion",
            "--force-dark", "-AppleInterfaceStyle", "Dark",
            "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN",
            "-talent-signal.interface-language", "zh-Hans",
            "-UIPreferredContentSizeCategoryName", UIContentSizeCategory.accessibilityExtraExtraExtraLarge.rawValue,
            "-UIAccessibilityReduceMotionEnabled", "YES",
        ]
        app.launchEnvironment["TS_IOS_UI_TEST_DISPLAY_PROBE"] = "true"
        app.launch()
        app.assertEffectiveAccessibility5()
        openNewComposer()
        send("Review this synthetic note.")
        XCTAssertTrue(element("ask-response-turn").waitForExistence(timeout: 8))
        XCTAssertTrue(answerBody.exists)
        XCTAssertFalse(app.staticTexts["Agent 回答"].exists)
        capture("GET-5 Chinese dark AX5 Markdown heading")
        for identifier in ["agent-markdown-table", "agent-markdown-code"] {
            let target = element(identifier)
            frameTopForCapture(target)
            if identifier == "agent-markdown-table" {
                assertTableUsesVerticalFields(target)
            }
            capture("GET-5 Chinese dark AX5 \(identifier)")
        }
        app.buttons["ask-session-menu"].tap()
        XCTAssertTrue(app.buttons["ask-share-session"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["ask-fork-session"].exists)
        capture("GET-5 Chinese dark AX5 Session menu reduced motion")
        // This verifies rendered layout and reachability, not device VoiceOver behavior.
    }

    func testCompletedScreenshotStaysInlineAndFollowupKeepsTheSameSession() {
        app.launchArguments.append("--fixture-get-5-completed-screenshot")
        app.launchEnvironment["TS_IOS_UI_TEST_GET5_COMPLETED_SCREENSHOT"] = "true"
        app.launch()
        openNewComposer()
        XCTAssertTrue(element("ask-screenshot-result").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Review this synthetic screenshot."].exists)
        XCTAssertFalse(element("screenshot-contact-card").exists, "Detailed processing history stays secondary until requested.")
        capture("GET-5 completed screenshot is one inline Session message")

        let disclosure = app.buttons["Sources and processing details"]
        XCTAssertTrue(disclosure.waitForExistence(timeout: 3))
        disclosure.tap()
        let card = element("screenshot-contact-card")
        XCTAssertTrue(card.waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Screenshot summary"].exists)
        let evidence = app.buttons["Chat evidence"]
        reveal(evidence)
        evidence.tap()
        XCTAssertTrue(app.staticTexts["Could we review the draft on Friday?"].waitForExistence(timeout: 3))
        capture("GET-5 screenshot detail uses the production source renderer")

        let screenshotBlockIDs = responseBlockIDs
        send("Keep the screenshot context and explain what is still uncertain.")
        _ = waitForNewResponseBlock(excluding: screenshotBlockIDs)
        revealEarlier(element("ask-screenshot-result"))
        XCTAssertTrue(element("ask-screenshot-result").exists)
        capture("GET-5 screenshot and text followup share one conversation")
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.buttons["archive-tab-sessions"].waitForExistence(timeout: 5))
        app.buttons["archive-tab-sessions"].tap()
        let sessions = app.buttons.matching(NSPredicate(format: "identifier MATCHES %@", "agent-session-[0-9A-Fa-f-]{36}"))
        XCTAssertEqual(sessions.count, 1, "The screenshot and followup must not create separate Sessions.")
    }

    func testEndedOpenContactProposalCannotBeEditedOrSaved() {
        app.launchArguments.removeAll { $0 == "--fixture-get-5-markdown" }
        app.launchArguments += ["--fixture-agent-contact-proposal", "--fixture-get-5-ended-contact-proposal"]
        app.launch()
        openNewComposer()
        send("Add contact Alex Rivera, email alex@example.com")
        XCTAssertTrue(element("contact-proposal-ended").waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["contact-confirm-save"].exists)
        XCTAssertFalse(app.buttons["contact-edit-details"].exists)
        XCTAssertTrue(element("contact-proposal-source").exists)
        XCTAssertTrue(element("ask-user-message").exists)
        app.buttons["contact-dismiss-proposal"].tap()
        XCTAssertTrue(element("contact-proposal-card").waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.textFields["ask-composer"].isEnabled)
        XCTAssertTrue(element("ask-user-message").exists)
    }

    private func openNewComposer() {
        let guide = app.buttons["relationship-guide"]
        XCTAssertTrue(guide.waitForExistence(timeout: 8))
        guide.tap()
        XCTAssertTrue(app.textFields["ask-composer"].waitForExistence(timeout: 5))
    }

    private func send(_ text: String) {
        let composer = app.textFields["ask-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText(text)
        app.buttons["ask-send"].tap()
    }

    private func lastButton(_ identifier: String) -> XCUIElement {
        let matches = app.buttons.matching(identifier: identifier)
        return matches.element(boundBy: max(0, matches.count - 1))
    }

    private var answerBody: XCUIElement {
        app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "ask-response-block-answer-")
        ).firstMatch
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private var responseBlockIDs: Set<String> {
        let query = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "ask-response-block-")
        )
        return Set(query.allElementsBoundByIndex.map(\.identifier))
    }

    private func waitForNewResponseBlock(excluding known: Set<String>) -> String {
        var newID: String?
        let appeared = expectation(for: NSPredicate { _, _ in
            newID = self.responseBlockIDs.subtracting(known).first
            return newID != nil
        }, evaluatedWith: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [appeared], timeout: 8), .completed,
                       "A new response must have its own task and block identity.")
        return newID ?? "missing-response-block"
    }

    private func responseTurn(containing blockID: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "ask-response-turn")
            .containing(.any, identifier: blockID).firstMatch
    }

    private func reveal(_ target: XCUIElement) {
        for _ in 0..<6 where !target.isHittable {
            element("ask-conversation").swipeUp()
        }
        XCTAssertTrue(target.isHittable)
    }

    private func revealEarlier(_ target: XCUIElement) {
        for _ in 0..<14 where !target.isHittable {
            element("ask-conversation").swipeDown()
        }
        XCTAssertTrue(target.isHittable)
    }

    private func frameTopForCapture(_ target: XCUIElement) {
        XCTAssertTrue(target.waitForExistence(timeout: 3))
        let conversation = element("ask-conversation")
        let composer = element("ask-message-composer")
        let visibleTop = max(conversation.frame.minY, app.navigationBars.firstMatch.frame.maxY)
        let visibleBottom = min(conversation.frame.maxY, composer.frame.minY)
        let top = visibleTop + 16
        let bottom = visibleBottom - 16
        XCTAssertGreaterThan(bottom, top + 80)
        var previousTop: CGFloat?
        for _ in 0..<10 {
            let targetTop = target.frame.minY
            if targetTop >= top - 4, targetTop <= top + 36 { break }
            if let previousTop, abs(previousTop - targetTop) < 1 { break }
            previousTop = targetTop
            let distance = min(abs(targetTop - top), (bottom - top) * 0.65)
            let startY = targetTop > top ? bottom : top
            let endY = targetTop > top ? startY - distance : startY + distance
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: conversation.frame.midX, dy: startY))
            let end = origin.withOffset(CGVector(dx: conversation.frame.midX, dy: endY))
            start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.35)
        }
        let neededVisibleHeight = min(target.frame.height, min(220, (bottom - top) * 0.7))
        XCTAssertGreaterThanOrEqual(target.frame.minY, visibleTop,
                                    "The capture must show this section's beginning below the navigation bar.")
        XCTAssertLessThanOrEqual(target.frame.minY + neededVisibleHeight, visibleBottom,
                                 "The section's first content must be visible above the composer.")
    }

    private func assertTableUsesVerticalFields(_ table: XCUIElement) {
        let step = table.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Step", "Source")
        ).firstMatch
        let state = table.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "State", "Available")
        ).firstMatch
        XCTAssertTrue(step.exists)
        XCTAssertTrue(state.exists)
        XCTAssertGreaterThanOrEqual(state.frame.minY, step.frame.maxY,
                                   "AX5 tables must stack fields vertically rather than compress columns.")
        XCTAssertEqual(step.frame.minX, state.frame.minX, accuracy: 2)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
