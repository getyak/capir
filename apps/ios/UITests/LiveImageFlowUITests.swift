import XCTest

/// One live view preserves the verified scope while a loopback reviewer inspects the attachment.
@MainActor
final class LiveImageFlowUITests: XCTestCase {
    // Ordinary composer images are covered by LiveImageQuestionUITests.
    // Historical screenshot intake is recovered below without resending it.

    /// Read back an already admitted image; this method never uploads or retries it.
    func testExistingImageReceiptAndSourceAreRecoverable() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let rawSession = environment["TS_IOS_LIVE_IMAGE_SESSION_ID"],
              let sessionID = UUID(uuidString: rawSession),
              let rawTask = environment["TS_IOS_LIVE_IMAGE_TASK_ID"],
              let taskID = UUID(uuidString: rawTask),
              let marker = environment["TS_IOS_LIVE_IMAGE_MARKER"], marker.hasPrefix("ios-image-") else {
            throw XCTSkip("Requires the exact existing image Session, task and synthetic marker.")
        }
        let app = try configuredAndVerifiedApp()
        app.buttons["archive-tab-sessions"].tap()
        let row = app.buttons["agent-session-\(sessionID.uuidString)"]
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        row.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", marker))
            .firstMatch.waitForExistence(timeout: 10))
        let block = element(app, "ask-response-block-\(taskID.uuidString.lowercased())-screenshot-\(taskID.uuidString.lowercased())")
        XCTAssertTrue(block.waitForExistence(timeout: 10))
        let turn = try XCTUnwrap(app.descendants(matching: .any)
            .matching(identifier: "ask-response-turn").allElementsBoundByIndex.first {
                $0.descendants(matching: .any).matching(identifier: block.identifier).firstMatch.exists
            })
        XCTAssertTrue(noPersonReceipt(turn).exists)
        capture(app, "Exact admitted image receipt survives relaunch")
        let details = turn.buttons["Sources and processing details"]
        for _ in 0..<5 where !details.isHittable { app.swipeUp() }
        XCTAssertTrue(details.isHittable)
        details.tap()
        let originals = turn.buttons["Original images"]
        for _ in 0..<5 where !originals.isHittable { app.swipeUp() }
        XCTAssertTrue(originals.isHittable)
        originals.tap()
        let image = turn.buttons["Image 1"]
        XCTAssertTrue(image.waitForExistence(timeout: 5))
        image.tap()
        XCTAssertTrue(app.navigationBars["Original image"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.staticTexts["The image could not be read."].exists)
        let preview = element(app, "screenshot-original-image")
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(preview.frame.width, app.frame.width)
        capture(app, "Governed original image reopened")
        preview.doubleTap()
        capture(app, "Original image supports native zoom")
        preview.doubleTap()
        app.buttons["Done"].tap()
    }

    private func responseTurn(_ app: XCUIApplication, marker: String) throws -> XCUIElement {
        var result: XCUIElement?
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            result = app.descendants(matching: .any).matching(identifier: "ask-response-turn")
                .allElementsBoundByIndex.first {
                    $0.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch.exists
                }
            return result != nil
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 30), .completed)
        return try XCTUnwrap(result)
    }

    private func noPersonReceipt(_ turn: XCUIElement) -> XCUIElement {
        turn.descendants(matching: .any).matching(NSPredicate(
            format: "identifier BEGINSWITH %@", "ask-response-block-"))
            .descendants(matching: .staticText).matching(NSPredicate(
                format: "label CONTAINS %@", "未发现可归档的人物")).firstMatch
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
                                 delegate: InspectionRedirectGuard(), delegateQueue: nil)
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
              environment["TS_IOS_LIVE_STAGE_IMAGE"] == "synthetic-app-icon" else {
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
        app.buttons["relationship-agent-studio"].tap()
        XCTAssertTrue(app.buttons["agent-settings"].waitForExistence(timeout: 5))
        app.buttons["agent-settings"].tap()
        XCTAssertTrue(app.buttons["open-account-settings"].waitForExistence(timeout: 5))
        app.buttons["open-account-settings"].tap()
        let identity = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", email)).firstMatch
        XCTAssertTrue(identity.waitForExistence(timeout: 10))
        XCTAssertTrue(identity.label.split(whereSeparator: { $0.isWhitespace || $0 == "," })
            .contains(Substring(email)), "The native account must exactly match the authorized identity.")
        app.navigationBars["Account"].buttons["Workspace"].tap()
        let workspaceBack = app.navigationBars["Workspace"].buttons["Agent"]
        XCTAssertTrue(workspaceBack.waitForExistence(timeout: 5))
        workspaceBack.tap()
        let agentBack = app.navigationBars["Agent"].buttons.element(boundBy: 0)
        XCTAssertTrue(agentBack.waitForExistence(timeout: 5))
        agentBack.tap()
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

private final class InspectionRedirectGuard: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
