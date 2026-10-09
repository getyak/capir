import XCTest
@testable import TalentSignalMac

final class WorkspaceSupportHandoffTests: XCTestCase {
    func testOnlyExplicitTrustedMainFrameSupportDraftIsAllowed() {
        for value in ["mailto:hello@talentsignal.ai", "mailto:hello@talentsignal.ai?subject=Talent%20Signal"] {
            let url = URL(string: value)!
            XCTAssertTrue(WorkspaceSupportHandoff.allows(url, sourceIsTrusted: true, mainFrame: true, userActivated: true))
            XCTAssertFalse(WorkspaceSupportHandoff.allows(url, sourceIsTrusted: false, mainFrame: true, userActivated: true))
            XCTAssertFalse(WorkspaceSupportHandoff.allows(url, sourceIsTrusted: true, mainFrame: false, userActivated: true))
            XCTAssertFalse(WorkspaceSupportHandoff.allows(url, sourceIsTrusted: true, mainFrame: true, userActivated: false))
        }
    }

    func testRejectsRecipientsBodiesHeadersAndOtherSchemes() {
        for value in ["mailto:other@example.test", "mailto:hello@talentsignal.ai,other@example.test",
                      "mailto:hello@talentsignal.ai?body=private", "mailto:hello@talentsignal.ai?cc=other@example.test",
                      "mailto:hello@talentsignal.ai?subject=a&subject=b", "mailto:hello@talentsignal.ai?subject=a%0D%0Abcc:x",
                      "mailto:hello@talentsignal.ai#fragment", "https://talentsignal.ai", "file:///tmp/mail"] {
            XCTAssertFalse(WorkspaceSupportHandoff.allows(URL(string: value)!, sourceIsTrusted: true,
                mainFrame: true, userActivated: true), value)
        }
    }

    func testWebKitNSURLBridgeKeepsOpaqueMailRecipient() {
        // WebKit supplies NSURL-backed non-hierarchical URLs, whose URL.path
        // may be empty even though URLComponents.path retains the recipient.
        let url = NSURL(string: "mailto:hello@talentsignal.ai?subject=Talent%20Signal%20%E6%94%AF%E6%8C%81")! as URL
        XCTAssertTrue(WorkspaceSupportHandoff.allows(url, sourceIsTrusted: true,
            mainFrame: true, userActivated: true))
        let foreign = NSURL(string: "mailto:other@example.test?subject=Support")! as URL
        XCTAssertFalse(WorkspaceSupportHandoff.allows(foreign, sourceIsTrusted: true,
            mainFrame: true, userActivated: true))
    }
}
