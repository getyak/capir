import AppKit
import XCTest
@testable import TalentSignalMac

@MainActor
final class SelectedTextServiceProviderTests: XCTestCase {
    func testProviderExposesTheSelectorDeclaredByNSServices() {
        XCTAssertTrue(
            SelectedTextServiceProvider.shared.responds(
                to: NSSelectorFromString("reviewSelection:userData:error:")
            )
        )
    }

    func testServiceMetadataAcceptsModernAndLegacyPlainText() throws {
        let services = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "NSServices") as? [[String: Any]])
        let service = try XCTUnwrap(services.first)
        let menu = try XCTUnwrap(service["NSMenuItem"] as? [String: String])
        let sendTypes = try XCTUnwrap(service["NSSendTypes"] as? [String])

        XCTAssertEqual(menu["default"], SelectionServiceSetup.menuItemTitle)
        XCTAssertEqual(service["NSMessage"] as? String, "reviewSelection")
        XCTAssertEqual(service["NSPortName"] as? String, "TalentSignalMac")
        XCTAssertEqual(service["NSRestricted"] as? Bool, false)
        XCTAssertTrue(sendTypes.contains(NSPasteboard.PasteboardType.string.rawValue))
        XCTAssertTrue(sendTypes.contains("NSStringPboardType"))
    }

    func testProviderTransfersOnlyExplicitServicePasteboardText() throws {
        let pasteboard = NSPasteboard(name: NSPasteboard.Name("talent-signal.service-test.\(UUID().uuidString)"))
        pasteboard.clearContents()
        pasteboard.setString("  Candidate needs the exact remote-work policy.  ", forType: .string)

        let expectation = expectation(forNotification: .talentSignalSelectedTextServiceRequest, object: nil)
        var receivedRequest: SelectedTextServiceRequest?
        let observer = NotificationCenter.default.addObserver(
            forName: .talentSignalSelectedTextServiceRequest,
            object: nil,
            queue: .main
        ) { notification in
            receivedRequest = notification.object as? SelectedTextServiceRequest
        }
        defer { NotificationCenter.default.removeObserver(observer) }

        var error: NSString?
        SelectedTextServiceProvider.shared.reviewSelection(
            pasteboard,
            userData: nil,
            error: &error
        )

        wait(for: [expectation], timeout: 1)
        XCTAssertNil(error)
        XCTAssertEqual(receivedRequest?.text, "Candidate needs the exact remote-work policy.")
    }

    func testProviderRejectsAnEmptyExplicitServicePasteboard() {
        let pasteboard = NSPasteboard(name: NSPasteboard.Name("talent-signal.service-test.empty.\(UUID().uuidString)"))
        pasteboard.clearContents()

        var error: NSString?
        SelectedTextServiceProvider.shared.reviewSelection(
            pasteboard,
            userData: nil,
            error: &error
        )

        XCTAssertEqual(error as String?, "Select text before choosing Review Selection with capri.")
    }
}
