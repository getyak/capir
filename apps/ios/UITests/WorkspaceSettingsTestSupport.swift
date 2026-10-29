import XCTest

@MainActor
extension XCUIApplication {
    func assertEffectiveAccessibility5(identifier: String = "lab-effective-display", file: StaticString = #filePath, line: UInt = #line) {
        let probe = descendants(matching: .any).matching(identifier: identifier)
        let display = probe.element
        XCTAssertTrue(display.waitForExistence(timeout: 8), file: file, line: line)
        XCTAssertEqual(probe.count, 1, "The effective display probe must be unambiguous.", file: file, line: line)
        let value = display.value as? String
        XCTAssertTrue(value?.contains("|accessibility5|") == true,
                      "AX5 must be active in the rendered environment: \(String(describing: value))",
                      file: file, line: line)
    }

    func revealLoginLabMenu() {
        let brand = staticTexts["welcome-brand"]
        XCTAssertTrue(brand.waitForExistence(timeout: 15))
        brand.press(forDuration: 0.7)
        XCTAssertTrue(buttons["login-product-lab"].waitForExistence(timeout: 5))
    }

    func openProductLabFromSettings(
        timeout: TimeInterval = 15,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertFalse(
            buttons["talent-signal-lab-capsule"].exists,
            "Internal testing must not occupy the primary navigation.",
            file: file,
            line: line
        )

        let agent = buttons["relationship-agent-studio"]
        XCTAssertTrue(
            agent.waitForExistence(timeout: timeout),
            "The Agent entry is required to reach workspace settings.",
            file: file,
            line: line
        )
        agent.tap()

        let settings = buttons["agent-settings"]
        XCTAssertTrue(
            settings.waitForExistence(timeout: 8),
            "Workspace settings were not reachable from Agent Studio.",
            file: file,
            line: line
        )
        settings.tap()

        let internalTesting = buttons["open-internal-testing"]
        for _ in 0..<18 where !internalTesting.isHittable {
            swipeUp()
        }
        XCTAssertTrue(
            internalTesting.isHittable,
            "Internal testing was not available in workspace settings.",
            file: file,
            line: line
        )
        internalTesting.tap()

        XCTAssertTrue(
            buttons["product-lab-done"].waitForExistence(timeout: 10),
            "Internal testing did not open from workspace settings.",
            file: file,
            line: line
        )
    }
}
