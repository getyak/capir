import XCTest

/// Opt-in visual acceptance: the answer is present only in the inspected image.
/// This test sends once; failures are investigated by exact message readback.
@MainActor
final class LiveImageQuestionUITests: XCTestCase {
    func testInspectedVisualAnswerFollowupAndRelaunch() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let marker = env["TS_IOS_LIVE_QUESTION_MARKER"], marker.hasPrefix("ios-vision-"),
              let word = env["TS_IOS_LIVE_QUESTION_WORD"], !word.isEmpty,
              let code = env["TS_IOS_LIVE_QUESTION_CODE"], !code.isEmpty else {
            throw XCTSkip("Explicit synthetic visual challenge inputs are required.")
        }
        let inspection = try inspectionRequest()
        let app = try configuredAndVerifiedApp()
        let photos = app.buttons["home-attachment-photos"]
        if !photos.exists {
            let attachments = app.buttons["open-agent-attachments"]
            XCTAssertTrue(attachments.waitForExistence(timeout: 15)); attachments.tap()
        }
        XCTAssertTrue(photos.waitForExistence(timeout: 5)); photos.tap()
        XCTAssertTrue(app.staticTexts["Loading..."].waitForNonExistence(timeout: 15))
        let closeIntroduction = app.buttons["Close"].firstMatch
        if closeIntroduction.exists { closeIntroduction.tap() }
        let photo = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 15))
        photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let add = app.buttons["Add"].firstMatch
        if add.waitForExistence(timeout: 3) { add.tap() }
        XCTAssertTrue(element(app, "ask-media-draft-tray").waitForExistence(timeout: 20))
        capture(app, "Inspect visual challenge before its only upload")
        try await inspect(app.screenshot().pngRepresentation, request: inspection)
        XCTAssertTrue(element(app, "ask-media-draft-tray").exists)
        let composer = app.textFields["ask-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        let question = "\(marker): Read the large word and three-digit code in the BLUE panel of this synthetic image. Reply with that word and code only. Analyze only; do not create people, memories, tasks, reminders, or external actions."
        XCTAssertFalse(question.contains(word)); XCTAssertFalse(question.contains(code))
        composer.tap(); composer.typeText(question)
        let send = app.buttons["ask-send"]
        XCTAssertTrue(send.isEnabled); send.tap() // Exactly one image submission.
        XCTAssertFalse((composer.value as? String ?? "").contains(marker))
        let turn = try responseTurn(app, marker: marker, timeout: 240)
        XCTAssertTrue(turn.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", word)).firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(turn.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", code)).firstMatch.exists)
        XCTAssertFalse(element(app, "ask-error").exists)
        capture(app, "Actual visual answer from the inspected source")

        let followup = "Follow-up \(marker): Now read the word and three-digit code from the RED panel of that same image. Reply with the red word and code only. Do not create records or actions."
        let redWord = "COMET", redCode = "219"
        XCTAssertFalse(followup.contains(redWord)); XCTAssertFalse(followup.contains(redCode))
        composer.tap(); composer.typeText(followup)
        XCTAssertTrue(send.isEnabled); send.tap()
        let nextTurn = try responseTurn(app, marker: "Follow-up " + marker, timeout: 240)
        XCTAssertTrue(nextTurn.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", redCode)).firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(nextTurn.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", redWord)).firstMatch.exists)
        capture(app, "Text follow-up uses the same visual conversation")

        let unsent = "Unsent visual draft " + marker
        composer.tap(); composer.typeText(unsent)
        let close = app.buttons["ask-close"]
        XCTAssertTrue(close.exists); close.tap()
        selectSessions(app)
        let latest = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "agent-session-")).firstMatch
        XCTAssertTrue(latest.waitForExistence(timeout: 60))
        let sessionIdentifier = latest.identifier
        let sessionReceipt = XCTAttachment(string: sessionIdentifier)
        sessionReceipt.name = "visual-question-native-session-id"; sessionReceipt.lifetime = .keepAlways; self.add(sessionReceipt)
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["archive-tab-sessions"].waitForExistence(timeout: 60))
        selectSessions(app)
        let sameSession = app.buttons[sessionIdentifier]
        XCTAssertTrue(sameSession.waitForExistence(timeout: 60)); sameSession.tap()
        XCTAssertTrue(composer.waitForExistence(timeout: 10)); XCTAssertEqual(composer.value as? String, unsent)
        app.swipeDown()
        let restored = try responseTurn(app, marker: marker, timeout: 30)
        XCTAssertTrue(restored.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", word)).firstMatch.exists)
        XCTAssertTrue(restored.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", code)).firstMatch.exists)
        capture(app, "Same image answer and unsent draft survive relaunch")
        try inspectOriginal(app, turn: restored)
    }

    /// Reopen an existing receipt without another upload or model retry.
    func testExistingVisualReplyRecovery() throws {
        let env = ProcessInfo.processInfo.environment
        guard let rawID = env["TS_IOS_LIVE_IMAGE_SESSION_ID"], let sessionID = UUID(uuidString: rawID),
              let marker = env["TS_IOS_LIVE_QUESTION_MARKER"], marker.hasPrefix("ios-vision-"),
              let word = env["TS_IOS_LIVE_QUESTION_WORD"], let code = env["TS_IOS_LIVE_QUESTION_CODE"] else {
            throw XCTSkip("Requires the exact existing visual question Session.")
        }
        let app = try configuredAndVerifiedApp()
        app.terminate(); app.launch()
        selectSessions(app)
        let row = app.buttons["agent-session-\(sessionID.uuidString)"]
        XCTAssertTrue(row.waitForExistence(timeout: 60)); row.tap()
        let composer = app.textFields["ask-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        XCTAssertEqual(composer.value as? String, "Unsent visual draft " + marker)
        app.swipeDown()
        let turn = try responseTurn(app, marker: marker, timeout: 30)
        XCTAssertTrue(turn.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", word)).firstMatch.exists)
        XCTAssertTrue(turn.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", code)).firstMatch.exists)
        let followup = try responseTurn(app, marker: "Follow-up " + marker, timeout: 30)
        XCTAssertTrue(followup.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "COMET")).firstMatch.exists)
        XCTAssertTrue(followup.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "219")).firstMatch.exists)
        capture(app, "Existing visual replies and unsent draft recovered without resend")
        try inspectOriginal(app, turn: turn)
    }

    private func openStudio(_ app: XCUIApplication) throws {
        let studio = app.buttons["relationship-agent-studio"]
        XCTAssertTrue(studio.waitForExistence(timeout: 15))
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: studio)
        guard XCTWaiter.wait(for: [ready], timeout: 10) == .completed else {
            XCTFail("Agent Studio navigation is not hittable")
            throw URLError(.cannotOpenFile)
        }
        studio.tap()
        if !app.buttons["agent-settings"].waitForExistence(timeout: 5), studio.isHittable {
            XCTContext.runActivity(named: "Cold Studio tap needed one read-only navigation retry") { _ in studio.tap() }
        }
        guard app.buttons["agent-settings"].waitForExistence(timeout: 10) else {
            XCTFail("Native navigation did not open Agent Studio")
            throw URLError(.cannotOpenFile)
        }
    }

    private func selectSessions(_ app: XCUIApplication) {
        let tab = app.buttons["archive-tab-sessions"]
        XCTAssertTrue(tab.waitForExistence(timeout: 15))
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: tab)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed)
        for attempt in 0..<2 {
            if tab.isSelected { return }
            tab.tap()
            let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == true"), object: tab)
            if XCTWaiter.wait(for: [selected], timeout: 3) == .completed { return }
            if attempt == 0 {
                XCTContext.runActivity(named: "Session tab needed one read-only navigation retry") { _ in }
            }
        }
        XCTFail("Native navigation did not select Sessions")
    }

    private func inspectOriginal(_ app: XCUIApplication, turn: XCUIElement) throws {
        let original = turn.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "conversation-image-")).firstMatch
        for _ in 0..<6 where !original.isHittable { app.swipeDown() }
        XCTAssertTrue(original.isHittable); original.tap()
        let preview = element(app, "conversation-original-image")
        XCTAssertTrue(preview.waitForExistence(timeout: 20))
        capture(app, "Original visual challenge restored through authenticated readback")
        preview.doubleTap()
        capture(app, "Original visual challenge supports native zoom")
        app.buttons["Done"].tap()
    }

    private func responseTurn(_ app: XCUIApplication, marker: String, timeout: TimeInterval) throws -> XCUIElement {
        var result: XCUIElement?
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            result = app.descendants(matching: .any).matching(identifier: "ask-response-turn")
                .allElementsBoundByIndex.first {
                    $0.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", marker + ":")).firstMatch.exists
                }
            return result != nil
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed)
        return try XCTUnwrap(result)
    }

    private func inspectionRequest() throws -> URLRequest {
        let environment = ProcessInfo.processInfo.environment
        guard let raw = environment["TS_IOS_LIVE_INSPECTION_URL"],
              let url = URL(string: raw), url.scheme == "http",
              url.host == "127.0.0.1", url.port != nil,
              url.path == "/image-inspection", url.query == nil, url.fragment == nil,
              let nonce = environment["TS_IOS_LIVE_INSPECTION_NONCE"], nonce.count >= 32 else {
            throw XCTSkip("An explicit loopback inspection session is required before image selection.")
        }
        var request = URLRequest(url: url)
        request.setValue(nonce, forHTTPHeaderField: "X-IOS-Test-Nonce")
        request.timeoutInterval = 10
        return request
    }

    private func inspect(_ screenshot: Data, request original: URLRequest) async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        let session = URLSession(configuration: configuration,
                                 delegate: QuestionInspectionRedirectGuard(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = original
        request.httpMethod = "POST"
        request.httpBody = screenshot
        request.setValue("image/png", forHTTPHeaderField: "Content-Type")
        let (_, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        request.httpMethod = "GET"
        request.httpBody = nil
        for _ in 0..<240 {
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            if (try JSONSerialization.jsonObject(with: data) as? [String: Bool])?["confirmed"] == true { return }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        XCTFail("The selected image was not confirmed; nothing was uploaded to the product.")
        throw URLError(.timedOut)
    }

    private func configuredAndVerifiedApp() throws -> XCUIApplication {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        guard let backend = environment["TS_IOS_LIVE_BACKEND_URL"],
              let email = environment["TS_IOS_LIVE_EMAIL"], !email.isEmpty,
              environment["TS_IOS_LIVE_STAGE_IMAGE"] == "synthetic-visual-question" else {
            throw XCTSkip("Requires explicit live account workflow and a staged synthetic source.")
        }
        let app = XCUIApplication()
        app.launchArguments = ["--auth-backend-url", backend,
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-talent-signal.interface-language", "en"]
        // A fresh launch applies the explicit endpoint, rather than inheriting
        // whichever environment a previously running app happened to use.
        app.launch()
        XCTAssertTrue(app.buttons["relationship-guide"].waitForExistence(timeout: 60))
        try openStudio(app)
        let settings = app.buttons["agent-settings"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: settings)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed)
        settings.tap()
        if !app.buttons["open-account-settings"].waitForExistence(timeout: 5), settings.isHittable {
            XCTContext.runActivity(named: "Cold settings tap needed one read-only retry") { _ in settings.tap() }
        }
        capture(app, "Account navigation after settings transition")
        XCTAssertTrue(app.buttons["open-account-settings"].waitForExistence(timeout: 10))
        app.buttons["open-account-settings"].tap()
        let identity = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", email)).firstMatch
        XCTAssertTrue(identity.waitForExistence(timeout: 10))
        XCTAssertTrue(identity.label.split(whereSeparator: { $0.isWhitespace || $0 == "," })
            .contains(Substring(email)), "The native account must exactly match the authorized identity.")
        app.navigationBars["Account"].buttons["Workspace"].tap()
        XCTAssertTrue(app.buttons["close-relationship-menu"].waitForExistence(timeout: 5))
        app.buttons["close-relationship-menu"].tap()
        XCTAssertTrue(app.buttons["Close Agent"].waitForExistence(timeout: 5))
        app.buttons["Close Agent"].tap()
        XCTAssertTrue(app.buttons["relationship-guide"].waitForExistence(timeout: 5))
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

private final class QuestionInspectionRedirectGuard: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
