import XCTest

/// Opt-in real-provider proof. One upload and one explicit identity confirmation;
/// a supplied Session ID recovers existing work without another send.
@MainActor
final class LiveContactReviewUITests: XCTestCase {
    func testInspectedImageContactReviewSaveAndRelaunch() async throws {
        continueAfterFailure = false
        guard let marker = value("CONTACT_MARKER"), marker.hasPrefix("ios-contact-"),
              let name = value("CONTACT_NAME"), !name.isEmpty,
              let backend = value("BACKEND_URL"), let email = value("EMAIL"),
              let password = value("PASSWORD"), !email.isEmpty, !password.isEmpty else {
            throw XCTSkip("Explicit isolated live account and synthetic contact challenge are required.")
        }
        let existingID = value("CONTACT_SESSION_ID")
        let inspection = existingID == nil ? try inspectionRequest() : nil
        attachReceipt(marker: marker, sessionID: existingID)
        let app = try authenticatedApp(backend: backend, email: email, password: password)
        var sessionIdentifier: String?
        if let existingID {
            guard let id = UUID(uuidString: existingID) else { throw URLError(.badURL) }
            sessionIdentifier = "agent-session-" + id.uuidString
            try openSession(app, identifier: sessionIdentifier!)
        } else {
            try selectImage(app)
            capture(app, "Inspect the selected synthetic contact source before its only upload")
            try await inspect(app.screenshot().pngRepresentation, request: try XCTUnwrap(inspection))
            let composer = app.textFields["ask-composer"]
            XCTAssertTrue(composer.waitForExistence(timeout: 10))
            let existingText = composer.value as? String ?? ""
            XCTAssertTrue(existingText.isEmpty || ["Reply…", "Ask about anyone or anything…"].contains(existingText),
                          "Do not overwrite an unrelated saved draft.")
            let prompt = "\(marker): This is an isolated synthetic contact-review acceptance check. From this image, prepare an editable NEW contact review for the clearly named person. Do not save it yet. Do not create or save memories, tasks, reminders, calendar entries, or perform external actions. I will review and confirm the contact in the native card."
            XCTAssertFalse(prompt.contains(name), "The expected name must be read from the inspected image.")
            composer.tap(); composer.typeText(prompt)
            let send = app.buttons["ask-send"]
            XCTAssertTrue(send.isEnabled); send.tap() // The only image submission.
            XCTAssertFalse((composer.value as? String ?? "").contains(marker))
        }

        let review = element(app, "conversation.memory.review")
        XCTAssertTrue(review.waitForExistence(timeout: 300), "A real structured review must arrive; never resend on timeout.")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", marker + ":")).firstMatch.exists)
        let saved = element(app, "conversation.memory.saved")
        if !saved.exists {
            let field = app.textFields["conversation.memory.name"]
            reveal(field, in: app)
            XCTAssertEqual(field.value as? String, name)
            XCTAssertTrue(field.isEnabled)
            capture(app, "Real editable contact review from the inspected image")
            let save = app.buttons["conversation.memory.save"]
            reveal(save, in: app)
            XCTAssertEqual(save.label, "Add contact", "Only a new-contact identity confirmation is authorized.")
            XCTAssertTrue(save.isEnabled); save.tap() // Exactly one save; no memory selection.
            XCTAssertTrue(saved.waitForExistence(timeout: 60))
        }
        XCTAssertTrue(saved.staticTexts["Contact added"].exists)
        XCTAssertTrue(saved.staticTexts[name].exists)
        XCTAssertFalse(saved.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "details saved")).firstMatch.exists)
        capture(app, "Actual contact-added readback after one explicit confirmation")

        if sessionIdentifier == nil {
            app.buttons["ask-close"].tap()
            selectSessions(app)
            let latest = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "agent-session-")).firstMatch
            XCTAssertTrue(latest.waitForExistence(timeout: 30)); sessionIdentifier = latest.identifier
            latest.tap()
        }
        let identifier = try XCTUnwrap(sessionIdentifier)
        attachReceipt(marker: marker, sessionID: String(identifier.dropFirst("agent-session-".count)))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", marker + ":")).firstMatch.waitForExistence(timeout: 30))
        let viewContact = app.buttons["View contact"]
        reveal(viewContact, in: app); viewContact.tap()
        XCTAssertTrue(element(app, "workspace-person-detail").waitForExistence(timeout: 30))
        XCTAssertEqual(element(app, "person-detail-name").label, name)
        capture(app, "View contact reaches the actual saved destination")

        app.terminate(); app.launch()
        try openSession(app, identifier: identifier)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", marker + ":")).firstMatch.waitForExistence(timeout: 30))
        XCTAssertTrue(saved.waitForExistence(timeout: 60))
        XCTAssertTrue(saved.staticTexts["Contact added"].exists)
        XCTAssertTrue(saved.staticTexts[name].exists)
        XCTAssertFalse(app.buttons["conversation.memory.save"].exists, "Reopening cannot silently offer a duplicate contact save.")
        reveal(app.buttons["View contact"], in: app)
        capture(app, "Same Session and confirmed contact survive relaunch without resend")
    }

    private func value(_ suffix: String) -> String? {
        let env = ProcessInfo.processInfo.environment, key = "TS_IOS_LIVE_" + suffix
        return env[key] ?? env["TEST_RUNNER_" + key]
    }

    private func authenticatedApp(backend: String, email: String, password: String) throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--auth-backend-url", backend, "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
                               "-talent-signal.interface-language", "en"]
        app.launch()
        if !app.buttons["relationship-guide"].waitForExistence(timeout: 15) {
            if app.buttons["welcome-skip"].exists { app.buttons["welcome-skip"].tap() }
            let entry = app.buttons["sign-in-with-email"]
            XCTAssertTrue(entry.waitForExistence(timeout: 15)); entry.tap()
            let emailField = app.textFields["login-email"], passwordField = app.secureTextFields["login-password"]
            XCTAssertTrue(emailField.waitForExistence(timeout: 5)); emailField.tap(); emailField.typeText(email)
            XCTAssertTrue(passwordField.exists); passwordField.tap(); passwordField.typeText(password)
            app.buttons["login-email-submit"].tap()
        }
        XCTAssertTrue(app.buttons["relationship-guide"].waitForExistence(timeout: 60))
        let passwords = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
        if passwords.staticTexts["Save Password?"].waitForExistence(timeout: 2) { passwords.buttons["Not Now"].tap() }
        let studio = app.buttons["relationship-agent-studio"]
        XCTAssertTrue(studio.waitForExistence(timeout: 10)); studio.tap()
        let settings = app.buttons["agent-settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10)); reveal(settings, in: app); settings.tap()
        let account = app.buttons["open-account-settings"]
        if !account.waitForExistence(timeout: 5), settings.isHittable { settings.tap() }
        XCTAssertTrue(account.waitForExistence(timeout: 10)); account.tap()
        let identity = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", email)).firstMatch
        XCTAssertTrue(identity.waitForExistence(timeout: 10), "Native identity must be visible before any upload.")
        XCTAssertTrue(identity.label.split(whereSeparator: { $0.isWhitespace || $0 == "," }).contains(Substring(email)),
                      "Stop on a different native account; never sign it out or continue under it.")
        app.navigationBars["Account"].buttons["Workspace"].tap()
        XCTAssertTrue(app.navigationBars["Workspace"].buttons["Agent"].waitForExistence(timeout: 5))
        app.navigationBars["Workspace"].buttons["Agent"].tap()
        app.navigationBars["Agent"].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["relationship-guide"].waitForExistence(timeout: 10))
        return app
    }

    private func selectImage(_ app: XCUIApplication) throws {
        let photos = app.buttons["home-attachment-photos"]
        if !photos.exists {
            let attachments = app.buttons["open-agent-attachments"]
            if !attachments.exists { app.buttons["relationship-guide"].tap() }
            XCTAssertTrue(attachments.waitForExistence(timeout: 10)); attachments.tap()
        }
        XCTAssertTrue(photos.waitForExistence(timeout: 5)); photos.tap()
        XCTAssertTrue(app.staticTexts["Loading..."].waitForNonExistence(timeout: 15))
        let introduction = app.buttons["Close"].firstMatch
        if introduction.exists { introduction.tap() }
        let photo = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 15))
        photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let add = app.buttons["Add"].firstMatch
        if add.waitForExistence(timeout: 3) { add.tap() }
        XCTAssertTrue(element(app, "ask-media-draft-tray").waitForExistence(timeout: 20))
    }

    private func openSession(_ app: XCUIApplication, identifier: String) throws {
        XCTAssertTrue(app.buttons["archive-tab-sessions"].waitForExistence(timeout: 60)); selectSessions(app)
        let row = app.buttons[identifier]
        XCTAssertTrue(row.waitForExistence(timeout: 60)); row.tap()
        XCTAssertTrue(app.textFields["ask-composer"].waitForExistence(timeout: 10))
    }

    private func selectSessions(_ app: XCUIApplication) {
        let tab = app.buttons["archive-tab-sessions"]
        XCTAssertTrue(tab.waitForExistence(timeout: 15))
        for _ in 0..<2 where !tab.isSelected { tab.tap() }
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == true"), object: tab)
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 5), .completed)
    }

    private func reveal(_ target: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<10 where !target.isHittable { app.swipeUp() }
        XCTAssertTrue(target.isHittable)
    }

    private func inspectionRequest() throws -> URLRequest {
        guard let raw = value("INSPECTION_URL"), let url = URL(string: raw), url.scheme == "http",
              url.host == "127.0.0.1", url.port != nil, url.path == "/image-inspection", url.query == nil, url.fragment == nil,
              let nonce = value("INSPECTION_NONCE"), nonce.count >= 32 else {
            throw XCTSkip("Explicit loopback inspection approval is required before image selection.")
        }
        var request = URLRequest(url: url); request.setValue(nonce, forHTTPHeaderField: "X-IOS-Test-Nonce")
        request.timeoutInterval = 10; return request
    }

    private func inspect(_ screenshot: Data, request original: URLRequest) async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCache = nil
        let session = URLSession(configuration: configuration, delegate: ContactInspectionRedirectGuard(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = original; request.httpMethod = "POST"; request.httpBody = screenshot
        request.setValue("image/png", forHTTPHeaderField: "Content-Type")
        let (_, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        request.httpMethod = "GET"; request.httpBody = nil
        for _ in 0..<240 {
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            if (try JSONSerialization.jsonObject(with: data) as? [String: Bool])?["confirmed"] == true { return }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        XCTFail("Selected source was not approved. Nothing was uploaded to the product.")
        throw URLError(.timedOut)
    }

    private func attachReceipt(marker: String, sessionID: String?) {
        let receipt = XCTAttachment(string: "marker=" + marker + "\nsession_id=" + (sessionID ?? "not-yet-observed"))
        receipt.name = "live-contact-native-recovery-receipt"; receipt.lifetime = .keepAlways; add(receipt)
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}

private final class ContactInspectionRedirectGuard: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
