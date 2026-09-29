import XCTest
@testable import TalentSignalMac

@MainActor
final class AccountSettingsBrowserTests: XCTestCase {
    private func origin() throws -> WorkspaceOrigin {
        try XCTUnwrap(WorkspaceOrigin("https://workspace.example:10443"))
    }

    func testDestinationsAreFixedSameOrigin() throws {
        let origin = try origin()
        for destination in AccountSettingsDestination.allCases {
            let url = destination.url(in: origin)
            XCTAssertEqual(url.scheme, "https")
            XCTAssertEqual(url.host, "workspace.example")
            XCTAssertEqual(url.port, 10443)
            XCTAssertEqual(url.path, "/workspace/settings")
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            if destination == .overview {
                XCTAssertTrue(items.isEmpty, "overview keeps the bare settings route")
            } else {
                XCTAssertEqual(items.count, 1)
                XCTAssertEqual(items[0].name, "section")
                XCTAssertEqual(items[0].value, destination.rawValue)
            }
            XCTAssertTrue(origin.contains(url))
        }
    }

    func testNoIdentityInURL() throws {
        let origin = try origin()
        for destination in AccountSettingsDestination.allCases {
            let value = destination.url(in: origin).absoluteString
            XCTAssertFalse(value.contains("@"))
            XCTAssertFalse(value.contains("token"))
            XCTAssertFalse(value.contains("email"))
            XCTAssertFalse(value.contains("accountId"))
            XCTAssertFalse(value.contains("session"))
        }
    }

    func testFailedOpenReturnsFalse() throws {
        let origin = try origin()
        var opened: [URL] = []
        let browser = AccountSettingsBrowser(openURL: { opened.append($0); return false })
        XCTAssertFalse(browser.open(.account, in: origin))
        XCTAssertEqual(opened.count, 1, "the OS still received exactly one approved URL")
    }

    func testMissingOriginDoesNotOpen() throws {
        var opened = 0
        let browser = AccountSettingsBrowser(openURL: { _ in opened += 1; return true })
        XCTAssertFalse(browser.open(.overview, in: nil))
        XCTAssertEqual(opened, 0, "no callback is made when no origin is configured")
    }

    /// The native handoff must never depend on a Web surface probe, so it opens
    /// synchronously against an unreachable origin without any second attempt.
    func testLegacyWebNeedsNoProbe() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://10.255.255.1:10443"))
        var opened: [URL] = []
        let browser = AccountSettingsBrowser(openURL: { opened.append($0); return true })
        XCTAssertTrue(browser.open(.connections, in: origin))
        XCTAssertEqual(opened, [AccountSettingsDestination.connections.url(in: origin)])
        XCTAssertEqual(opened.count, 1)
    }
}
