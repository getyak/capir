import XCTest
import UIKit

/// Deterministic visual/interaction evidence. These preview-only scenarios do
/// not establish live delivery, provider quality, or an authenticated save.
@MainActor
final class ConversationExperienceUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchEnvironment["TS_IOS_UI_TEST_PREVIEW_WORKSPACE"] = "true"
        app.launchEnvironment["TS_IOS_CONVERSATION_EXPERIENCE"] = "review"
        app.launchArguments = [
            "--preview-workspace", "--reset-preview-agent",
            "-talent-signal.interface-language", "en",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
    }

    func testEditorialReviewHasReadableSourceEditableContactAndOnePrimaryDecision() {
        openFixture()
        assertLongSource()
        capture("Editorial conversation source")
        assertReviewInteraction()
        capture("Editorial contact review after editing")
    }

    func testCompactDirectionUsesTheSameSourceAndDecision() {
        app.launchArguments.append("--fixture-conversation-experience-compact")
        openFixture()
        assertLongSource()
        assertReviewInteraction()
        capture("Compact contact review with identical source and content")
    }

    func testProcessingStatusBelongsToItsImageAndHasNoEmptyMessageBubble() {
        app.launchEnvironment["TS_IOS_CONVERSATION_EXPERIENCE"] = "processing"
        openFixture()
        assertLongSource()
        let progress = element("conversation-image-progress-a0000000-0000-4000-8000-000000000004")
        reveal(progress)
        XCTAssertTrue(progress.exists)
        XCTAssertTrue(app.staticTexts["Message received. Waiting for reply status…"].exists)
        XCTAssertFalse(element("ask-user-message").exists)
        XCTAssertFalse(element("conversation.memory.save").exists)
        capture("Image-local received status without a fabricated processing stage")
    }

    func testUnavailableReviewExplainsRecoveryAndNeverOffersSave() {
        app.launchEnvironment["TS_IOS_CONVERSATION_EXPERIENCE"] = "error"
        openFixture()
        let retry = app.buttons["Reload review"]
        reveal(retry)
        XCTAssertTrue(retry.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(retry.frame.height, 44)
        XCTAssertTrue(element("conversation.memory.notice").exists)
        XCTAssertFalse(element("conversation.memory.save").exists)
        retry.tap()
        XCTAssertTrue(retry.waitForExistence(timeout: 5))
        XCTAssertFalse(element("conversation.memory.save").exists)
        capture("Unavailable contact review retains its source and explicit recovery")
    }

    func testActualReviewNoticeClosePreservesComposerDraftInLightMode() {
        verifyActualReviewNoticeClose(accessibility: false)
    }

    func testActualReviewNoticeClosePreservesDraftAtChineseDarkEffectiveAX5() {
        verifyActualReviewNoticeClose(accessibility: true)
    }

    private func verifyActualReviewNoticeClose(accessibility: Bool) {
        app.launchEnvironment["TS_IOS_CONVERSATION_EXPERIENCE"] = "review-notice"
        app.launchEnvironment["TS_IOS_UI_TEST_DISPLAY_PROBE"] = "true"
        app.launchArguments += ["-talent-signal.display.text-size", "system"]
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", accessibility
            ? UIContentSizeCategory.accessibilityExtraExtraExtraLarge.rawValue : UIContentSizeCategory.large.rawValue]
        if accessibility {
            app.launchArguments = ["--preview-workspace", "--reset-preview-agent", "--force-dark",
                "-AppleInterfaceStyle", "Dark", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN",
                "-talent-signal.interface-language", "zh-Hans", "-talent-signal.display.text-size", "system",
                "-UIAccessibilityReduceMotionEnabled", "YES",
                "-UIPreferredContentSizeCategoryName", UIContentSizeCategory.accessibilityExtraExtraExtraLarge.rawValue]
        }
        openFixture()
        let probe = element("ask-effective-display")
        XCTAssertTrue(probe.waitForExistence(timeout: 5))
        if accessibility {
            app.assertEffectiveAccessibility5(identifier: "ask-effective-display")
            XCTAssertTrue((probe.value as? String)?.hasPrefix("zh-Hans|dark|accessibility5|") == true)
        } else {
            XCTAssertTrue((probe.value as? String)?.contains("|light|large|") == true)
        }
        // The IME monitor shares the field's identifier but has no hit target.
        // Enter and read the draft through the actual native text field.
        let composer = app.textFields["ask-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        XCTAssertTrue(composer.isEnabled)
        let draft = "Keep this synthetic draft after closing the notice."
        composer.tap()
        composer.typeText(draft)
        XCTAssertEqual(composer.value as? String, draft)
        let close = app.buttons["ask-evidence-review-error-dismiss"]
        reveal(close)
        XCTAssertEqual(close.label, accessibility ? "关闭提示" : "Close notice")
        XCTAssertGreaterThanOrEqual(close.frame.width + 0.001, 44)
        XCTAssertGreaterThanOrEqual(close.frame.height + 0.001, 44)
        XCTAssertTrue(element("ask-evidence-review-persistence-error").exists)
        capture("Actual reviewPreparationError and contextual close notice")
        close.tap()
        XCTAssertTrue(element("ask-evidence-review-persistence-error").waitForNonExistence(timeout: 5))
        XCTAssertEqual(composer.value as? String, draft,
                       "The production notice callback may close the error, but must not replace the committed draft")
        XCTAssertTrue(element("conversation-experience-fixture").exists)
        capture("Actual notice dismissed while the exact synthetic draft remains")
    }

    func testQueuedStatusNaturallyExpiresWithoutAnotherObservation() {
        app.launchEnvironment["TS_IOS_CONVERSATION_EXPERIENCE"] = "processing"
        app.launchEnvironment["TS_IOS_UI_TEST_PROGRESS_EXPIRY"] = "queued"
        openFixture()
        let progress = element("conversation-image-progress-a0000000-0000-4000-8000-000000000004")
        reveal(progress)
        XCTAssertTrue(progress.staticTexts["Queued for processing"].exists)
        XCTAssertFalse(progress.buttons["Check status"].exists)
        XCTAssertTrue(progress.staticTexts["Reply status needs checking"].waitForExistence(timeout: 30),
                      "A silent feed must stop claiming that the message is still queued.")
        let check = progress.buttons["Check status"]
        XCTAssertTrue(check.isHittable)
        XCTAssertGreaterThanOrEqual(check.frame.height, 44)
        XCTAssertFalse(progress.staticTexts["Queued for processing"].exists)
        XCTAssertFalse(element("conversation.memory.save").exists)
        capture("Silent queue observation expires into the same-message recovery action")
    }

    func testReviewAtAccessibilitySizeInDarkModeRemainsOperable() {
        app.launchArguments += [
            "--force-dark", "-UIAccessibilityReduceMotionEnabled", "YES",
            "-UIPreferredContentSizeCategoryName", UIContentSizeCategory.accessibilityExtraExtraExtraLarge.rawValue,
        ]
        openFixture()
        let name = app.textFields["conversation.memory.name"]
        reveal(name)
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        let save = app.buttons["conversation.memory.save"]
        reveal(save)
        XCTAssertTrue(save.isHittable)
        XCTAssertGreaterThanOrEqual(save.frame.height, 44)
        XCTAssertLessThanOrEqual(save.frame.maxX, app.frame.maxX)
        capture("Contact review at accessibility size in dark mode")
    }

    func testAddingContactKeepsDetailsPendingAndSavingOneKeepsTheOtherPending() {
        openFixture()
        let first = app.buttons["Select detail: Review the design draft on Friday."]
        let second = app.buttons["Select detail: Bring the updated screens to the review."]
        XCTAssertFalse(first.exists, "Memory editors stay out of the initial identity decision.")
        let save = app.buttons["conversation.memory.save"]
        for _ in 0..<3 where !save.isHittable { element("ask-conversation").swipeUp() }
        XCTAssertTrue(save.isHittable, "The primary identity decision must be reachable without traversing detail editors.")
        XCTAssertEqual(save.label, "Add contact")
        let preview = element("conversation.memory.pending-preview")
        reveal(preview)
        preview.tap()
        XCTAssertFalse(first.exists, "Expanded suggestions remain read-only until identity is confirmed.")
        reveal(save)
        XCTAssertTrue(save.isEnabled)
        waitUntilEnabled(save)
        save.tap()

        let receipt = element("conversation.memory.saved")
        XCTAssertTrue(receipt.waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Contact added"].exists)
        reveal(first)
        XCTAssertTrue(first.isEnabled)
        XCTAssertTrue(second.exists, "Contact-only creation must retain both pending details.")
        XCTAssertFalse(receipt.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "details saved")).firstMatch.exists)
        capture("Contact-only result leaves both details awaiting a decision")

        first.tap()
        reveal(save)
        XCTAssertEqual(save.label, "Save selected details")
        waitUntilEnabled(save)
        save.tap()
        XCTAssertTrue(first.waitForNonExistence(timeout: 8), "Only the selected item should leave the pending review.")
        reveal(second)
        XCTAssertTrue(second.exists)
        XCTAssertTrue(second.isEnabled)
        XCTAssertFalse(second.isSelected)
        XCTAssertTrue(receipt.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "1 ", "saved")).firstMatch.exists)
        capture("One detail is confirmed while its unselected sibling remains pending")
    }

    func testNameCorrectionRequiresFreshReviewAndASecondConfirm() {
        openFixture()
        let name = app.textFields["conversation.memory.name"]
        reveal(name)
        name.tap()
        name.typeText(" Jr.")
        let save = app.buttons["conversation.memory.save"]
        reveal(save)
        XCTAssertEqual(save.label, "Review corrected contact")
        waitUntilEnabled(save)
        save.tap()
        let reloaded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Add contact"), object: save)
        XCTAssertEqual(XCTWaiter.wait(for: [reloaded], timeout: 8), .completed)
        XCTAssertFalse(element("conversation.memory.saved").exists, "Correcting identity must not save a contact as a side effect.")
        XCTAssertTrue(element("conversation.memory.notice").exists)
        capture("Corrected identity is presented for a fresh second decision")
        reveal(save)
        waitUntilEnabled(save)
        save.tap()
        let receipt = element("conversation.memory.saved")
        XCTAssertTrue(receipt.waitForExistence(timeout: 8))
        XCTAssertTrue(receipt.staticTexts["Lin Zhou Jr."].exists)
        XCTAssertTrue(app.buttons["Select detail: Review the design draft on Friday."].exists)
        capture("Second confirmation adds only the explicitly corrected contact")
    }

    private func openFixture() {
        app.launch()
        let guide = app.buttons["relationship-guide"]
        XCTAssertTrue(guide.waitForExistence(timeout: 10))
        guide.tap()
        XCTAssertTrue(element("conversation-experience-fixture").waitForExistence(timeout: 8))
        XCTAssertTrue(element("conversation-experience-synthetic-boundary").exists)
        XCTAssertFalse(app.staticTexts["Agent answer"].exists)
    }

    private func assertLongSource() {
        let source = element("conversation-local-image-a0000000-0000-4000-8000-000000000001")
        XCTAssertTrue(source.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(source.frame.width, 190)
        XCTAssertGreaterThan(source.frame.height, source.frame.width)
        XCTAssertFalse(element("ask-user-message").exists, "An image-only message has no empty text bubble.")
        source.tap()
        let original = element("conversation-original-image")
        XCTAssertTrue(original.waitForExistence(timeout: 5))
        original.doubleTap()
        capture("Long synthetic source is readable in the native original viewer")
        app.buttons["Done"].tap()
    }

    private func assertReviewInteraction() {
        let name = app.textFields["conversation.memory.name"]
        reveal(name)
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        XCTAssertTrue(name.isEnabled)
        name.tap()
        name.typeText(" Jr.")
        XCTAssertTrue((name.value as? String)?.contains("Jr.") == true)
        app.swipeUp()
        let save = app.buttons["conversation.memory.save"]
        reveal(save)
        XCTAssertTrue(save.isHittable)
        XCTAssertEqual(save.label, "Review corrected contact")
        XCTAssertGreaterThanOrEqual(save.frame.height, 44)
        let source = app.buttons["View source"]
        reveal(source)
        XCTAssertTrue(source.isHittable)
        source.tap()
        let image = element("conversation-local-image-a0000000-0000-4000-8000-000000000001")
        XCTAssertTrue(image.exists)
        reveal(name)
        XCTAssertTrue((name.value as? String)?.contains("Jr.") == true,
                      "Reading the source must preserve the current edit.")
        reveal(save)
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func reveal(_ target: XCUIElement) {
        let scroll = element("ask-conversation")
        for _ in 0..<14 where !target.isHittable {
            if target.exists, target.frame.maxY < scroll.frame.minY + 40 { scroll.swipeDown(velocity: .slow) }
            else { scroll.swipeUp(velocity: .slow) }
        }
        XCTAssertTrue(target.isHittable)
    }

    private func waitUntilEnabled(_ target: XCUIElement) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: target)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Synthetic preview · " + name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
