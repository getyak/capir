import XCTest

@MainActor
final class LabTaskTrialUITests: XCTestCase {
    private let baseURL = "http://127.0.0.1:4329"

    func testSessionSelectionActualProductTaskAndRollback() async throws {
        continueAfterFailure = false
        guard let proof = try? await json("/proof-state"), proof["purpose"] as? String == "owned-native-lab-trial-proof" else {
            throw XCTSkip("Start the explicitly configured, disposable Lab task trial proof service.")
        }
        // One sign-in is shared by Lab and the native product. No token is
        // attached to test output; only sanitized configuration receipts are.
        let login = try await json("/v1/auth/simulated-login", body: ["account_slug": "fixture-alpha",
            "user_email": "reviewer@alpha.local", "client_label": "native-task-trial-" + UUID().uuidString])
        let token = try XCTUnwrap(login["access_token"] as? String)
        let account = try XCTUnwrap(login["account"] as? [String: Any])
        let user = try XCTUnwrap(login["user"] as? [String: Any])
        let fixture: [String: Any] = ["baseURL": baseURL, "accessToken": token,
            "expiresAt": ISO8601DateFormatter().string(from: Date().addingTimeInterval(1800)),
            "account": account, "user": ["id": user["id"]!, "email": user["email"]!,
                "displayName": user["display_name"]!, "kind": user["kind"]!]]
        let app = XCUIApplication()
        app.launchArguments = ["--show-login", "--auth-backend-url", baseURL,
            "--reset-lab-workspace-journey", "-talent-signal.interface-language", "zh-Hans"]
        app.launchEnvironment["TS_IOS_UI_TEST_AUTHENTICATED_SESSION"] = try JSONSerialization.data(withJSONObject: fixture).base64EncodedString()
        app.launch()
        openTrials(app)
        app.buttons["lab-trial-task"].firstMatch.tap()
        app.buttons["工作区对话"].firstMatch.tap()
        app.buttons["lab-trial-preset"].firstMatch.tap()
        app.buttons["简洁回答"].firstMatch.tap()
        capture("task-trial-configured")
        scrollTo(app.buttons["lab-trial-start"], in: app)
        app.buttons["lab-trial-start"].tap()
        app.buttons["lab-trial-confirm-start"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["lab-trial-active-model"].firstMatch.waitForExistence(timeout: 10))
        let configured = try await json("/v1/lab/task-configuration", token: token)
        let trial = try XCTUnwrap((configured["trials"] as? [[String: Any]])?.first { $0["status"] as? String == "active" })
        XCTAssertEqual(trial["task"] as? String, "unscoped_chat")
        XCTAssertEqual(trial["prompt_preset"] as? String, "concise")
        XCTAssertEqual(trial["online_assignment"] as? Bool, false)
        let plan = try XCTUnwrap(trial["observation_plan"] as? [String: Any])
        XCTAssertEqual(plan["question"] as? String, "此配置能否在不触发降级的情况下完成正常产品任务？")
        XCTAssertEqual(plan["minimum_samples"] as? Int, 5)
        XCTAssertEqual(plan["stop_after_adverse_outcomes"] as? Int, 1)
        XCTAssertEqual(plan["sample_unit"] as? String, "unique_product_request")
        capture("task-trial-active")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["product-lab-done"].tap()
        app.buttons["relationship-guide"].tap()
        let composer = app.textFields["ask-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap(); composer.typeText("Hello")
        app.buttons["ask-send"].tap() // Exactly one product submission; no paid retry.
        var observed: [String: Any]?
        for _ in 0..<50 {
            let state = try await json("/v1/lab/task-configuration", token: token)
            observed = (state["observations"] as? [[String: Any]])?.first { $0["trial_id"] as? String == trial["id"] as? String }
            if observed != nil { break }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        let observation = try XCTUnwrap(observed, "The native product must execute in the same authenticated session as the trial")
        let measurement = try XCTUnwrap(observation["measurement"] as? [String: Any])
        XCTAssertEqual(observation["product_outcome"] as? String, "accepted", "A successful provider response alone does not prove product adoption")
        XCTAssertEqual(measurement["status"] as? String, "completed")
        XCTAssertEqual(measurement["execution"] as? String, "remote")
        XCTAssertEqual(measurement["actual_model"] as? String, trial["model"] as? String)
        XCTAssertEqual(measurement["actual_prompt_revision"] as? String, trial["prompt_revision"] as? String)
        let observedState = try await json("/v1/lab/task-configuration", token: token)
        let summary = try XCTUnwrap((observedState["summaries"] as? [[String: Any]])?.first {
            $0["trial_id"] as? String == trial["id"] as? String
        })
        XCTAssertEqual(summary["samples"] as? Int, 1)
        XCTAssertEqual(summary["accepted"] as? Int, 1)
        XCTAssertEqual(summary["evidence_state"] as? String, "collecting")
        XCTAssertEqual(summary["causal_claim_allowed"] as? Bool, false)
        let loading = app.descendants(matching: .any)["ask-loading"].firstMatch
        let ended = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: loading)
        await fulfillment(of: [ended], timeout: 10)
        XCTAssertTrue(app.descendants(matching: .any)["ask-response-turn"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "ask-response-block-answer-")
        ).firstMatch.exists)
        XCTAssertFalse(app.staticTexts["Agent 回答"].exists)
        XCTAssertFalse(app.staticTexts["Local reply"].exists)
        capture("task-trial-native-product-answer")
        app.buttons["ask-close"].tap()
        openTrials(app)
        app.buttons["lab-trial-task"].firstMatch.tap()
        app.buttons["工作区对话"].firstMatch.tap()
        let sampleCount = app.descendants(matching: .any)["lab-trial-summary-samples"].firstMatch
        scrollTo(sampleCount, in: app)
        XCTAssertTrue(sampleCount.label.contains("1"))
        XCTAssertTrue(app.descendants(matching: .any)["lab-trial-no-causal-claim"].firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["lab-trial-summary-state"].firstMatch.exists)
        let execution = app.descendants(matching: .any)["lab-trial-observation-\(observation["id"]!)"].firstMatch
        scrollTo(execution, in: app)
        XCTAssertTrue(execution.exists)
        capture("task-trial-actual-execution")
        // Restore the server default through the actual reviewed native action.
        for _ in 0..<12 {
            if app.buttons["lab-trial-stop"].isHittable { break }
            app.swipeDown()
        }
        app.buttons["lab-trial-stop"].tap()
        app.buttons["lab-trial-confirm-stop"].firstMatch.tap()
        let status = app.descendants(matching: .any)["lab-trial-receipt-status"].firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 8))
        let restored = try await json("/v1/lab/task-trials/\(trial["id"]!)", token: token)
        XCTAssertEqual((restored["trial"] as? [String: Any])?["status"] as? String, "stopped")
        capture("task-trial-restored-default")
        let proofAfter = try await json("/proof-state")
        let receipt = try JSONSerialization.data(withJSONObject: ["trial": trial, "observation": observation,
            "restored": restored, "provider_proof": proofAfter], options: [.prettyPrinted, .sortedKeys])
        let attachment = XCTAttachment(data: receipt, uniformTypeIdentifier: "public.json")
        attachment.name = "task-trial-sanitized-proof"; attachment.lifetime = .keepAlways; add(attachment)
    }

    private func json(_ path: String, token: String? = nil, body: [String: Any]? = nil) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: baseURL + path)!)
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    private func openTrials(_ app: XCUIApplication) {
        app.openProductLabFromSettings()
        app.buttons["product-lab-task-trials"].tap()
        XCTAssertTrue(app.buttons["lab-trial-task"].firstMatch.waitForExistence(timeout: 10))
    }
    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<12 {
            if element.isHittable { return }
            app.swipeUp()
        }
        XCTFail("The expected trial control is unreachable: \(element.identifier)")
    }
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
