import XCTest

/// Native geometry and screenshots of the same safe, populated retrieval lists.
/// Attachments are observations, not physical VoiceOver or device acceptance.
@MainActor
final class RetrievalDensityUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchEnvironment["TS_IOS_UI_TEST_PREVIEW_WORKSPACE"] = "true"
        app.launchArguments = [
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-talent-signal.interface-language", "en",
            "--preview-long-session-list", "--preview-long-people-list",
            "-UICTContentSizeCategoryName", "UICTContentSizeCategoryL",
        ]
    }

    func testOrdinaryRetrievalGeometry() throws {
        try captureLists()
    }

    func testDarkAccessibilityRetrievalGeometry() throws {
        app.launchArguments += ["--force-dark", "-UICTContentSizeCategoryName",
                                "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launchEnvironment["TS_IOS_UI_TEST_TEXT_SIZE"] = "compact"
        try captureLists()
    }

    func testLongMixedScriptRetrievalGeometry() throws {
        app.launchArguments += ["--preview-retrieval-content-extremes"]
        try captureLists(contentExtremes: true)
    }

    func testLongMixedScriptDarkAccessibilityRetrievalGeometry() throws {
        app.launchArguments += ["--preview-retrieval-content-extremes", "--force-dark",
            "-UICTContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launchEnvironment["TS_IOS_UI_TEST_TEXT_SIZE"] = "compact"
        try captureLists(contentExtremes: true, accessibility: true)
    }

    func testExplicitComfortablePreferencesRemainAvailable() throws {
        app.launchEnvironment["TS_IOS_UI_TEST_TEXT_SIZE"] = "comfortable"
        app.launchEnvironment["TS_IOS_UI_TEST_CARD_DENSITY"] = "comfortable"
        try captureLists()
    }

    private func captureLists(contentExtremes: Bool = false, accessibility: Bool = false) throws {
        app.launch()
        defer { app.terminate() }
        for (tab, listID, rowPrefix, actionPrefix) in [
            ("sessions", "agent-session-list", "agent-session-", "session-actions-"),
            ("people", "workspace-people-list", "workspace-person-", "person-actions-"),
        ] {
            let destination = app.buttons["archive-tab-\(tab)"]
            XCTAssertTrue(destination.waitForExistence(timeout: 10))
            destination.tap()
            let list = app.descendants(matching: .any)[listID].firstMatch
            XCTAssertTrue(list.waitForExistence(timeout: 5))
            let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", rowPrefix))
                .allElementsBoundByIndex.filter { $0.frame.intersects(list.frame) }
            XCTAssertFalse(rows.isEmpty)
            for row in rows {
                XCTAssertGreaterThanOrEqual(row.frame.height, 44 - 0.001)
                XCTAssertFalse(row.label.isEmpty)
            }
            if contentExtremes {
                let firstID = tab == "sessions" ? "90000000-0000-4000-8000-000000000001"
                    : "20000000-0000-4000-8000-000000000001"
                let first = app.buttons[rowPrefix + firstID]
                XCTAssertTrue(first.label.contains("陈晓雨 Alexandra Chen 🌏 产品与合作"))
                if accessibility { XCTAssertGreaterThan(first.frame.height, 128) }
            }
            let actions = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", actionPrefix))
                .allElementsBoundByIndex.filter { $0.isHittable }
            XCTAssertFalse(actions.isEmpty)
            for action in actions {
                XCTAssertGreaterThanOrEqual(action.frame.width, 44 - 0.001)
                XCTAssertGreaterThanOrEqual(action.frame.height, 44 - 0.001)
            }
            let geometry: [String: Any] = [
                "surface": tab, "viewport": rectangle(list.frame),
                "fullyVisibleRows": rows.filter { list.frame.contains($0.frame) }.count,
                "rows": rows.map { ["id": $0.identifier, "label": $0.label, "frame": rectangle($0.frame)] },
                "text": app.staticTexts.allElementsBoundByIndex.filter { $0.frame.intersects(list.frame) }
                    .map { ["label": $0.label, "frame": rectangle($0.frame)] },
                "controls": actions.map { ["id": $0.identifier, "frame": rectangle($0.frame)] },
            ]
            let data = try JSONSerialization.data(withJSONObject: geometry, options: [.prettyPrinted, .sortedKeys])
            let metrics = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            metrics.name = "retrieval-\(tab)-geometry"
            metrics.lifetime = .keepAlways
            add(metrics)
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "retrieval-\(tab)"
            screenshot.lifetime = .keepAlways
            add(screenshot)
        }
    }

    private func rectangle(_ value: CGRect) -> [String: Double] {
        ["x": value.minX, "y": value.minY, "width": value.width, "height": value.height]
    }
}
