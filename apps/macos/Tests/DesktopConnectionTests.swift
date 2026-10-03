import XCTest
@testable import TalentSignalMac

@MainActor
final class DesktopConnectionTests: XCTestCase {
    func testWorkspaceLinksNormalizeWithoutAdmittingCredentials() throws {
        let link = try XCTUnwrap(WorkspaceConnection.parseInput(" https://WORK.example:443/workspace/today ", allowLocalDevelopment: false))
        XCTAssertEqual(link.url.absoluteString, "https://work.example")
        for value in ["https://user:pass@work.example/workspace", "https://work.example/workspace?token=secret",
                      "https://work.example/workspace#secret", "https://work.example/api", "javascript:alert(1)",
                      "https://work.example/workspace-other", "http://192.168.1.2:3000"] {
            XCTAssertNil(WorkspaceConnection.parseInput(value, allowLocalDevelopment: true), value)
        }
    }

    func testLocalDevelopmentIsAnExplicitLoopbackOnlyChoice() {
        for value in ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"] {
            XCTAssertNil(WorkspaceConnection.parseInput(value, allowLocalDevelopment: false))
            XCTAssertNotNil(WorkspaceConnection.parseInput(value, allowLocalDevelopment: true), value)
        }
        for value in ["http://127.1:3000", "http://localhost.evil.test", "http://0.0.0.0", "http://2130706433"] {
            XCTAssertNil(WorkspaceConnection.parseInput(value, allowLocalDevelopment: true), value)
        }
    }

    func testFailedSavePreservesConnectionAndRelaunchRestoresExactOrigin() throws {
        let suite = "connection-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = WorkspaceConnection(defaults: defaults)
        XCTAssertTrue(model.save("https://work.example:10443/workspace/today", allowLocalDevelopment: false))
        XCTAssertFalse(model.save("https://user:secret@other.example", allowLocalDevelopment: false))
        let restored = WorkspaceConnection(defaults: defaults)
        XCTAssertEqual(restored.origin?.url.absoluteString, "https://work.example:10443")
        XCTAssertFalse(restored.allowsLocalDevelopment)
    }

    @MainActor
    func testSessionStoresPartitionPortsAndCanonicalizeEquivalentOrigins() throws {
        let a = try XCTUnwrap(WorkspaceOrigin("https://work.example"))
        let b = try XCTUnwrap(WorkspaceOrigin("https://WORK.example:443/"))
        let c = try XCTUnwrap(WorkspaceOrigin("https://work.example:10443"))
        XCTAssertEqual(a.dataStoreIdentifier, b.dataStoreIdentifier)
        XCTAssertNotEqual(a.dataStoreIdentifier, c.dataStoreIdentifier)
    }

    func testChromeLinksCannotSetConfigurationOrInstallFromAnotherOrigin() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://work.example:10443"))
        let source = origin.entryURL
        let updates = try XCTUnwrap(URL(string: "talentsignal-desktop://updates"))
        XCTAssertEqual(DesktopChromeAction.resolve(updates, source: source, origin: origin, mainFrame: true, userActivated: true), .updates)
        XCTAssertNil(DesktopChromeAction.resolve(updates, source: source, origin: origin, mainFrame: false, userActivated: true))
        XCTAssertNil(DesktopChromeAction.resolve(updates, source: source, origin: origin, mainFrame: true, userActivated: false))
        XCTAssertNil(DesktopChromeAction.resolve(updates, source: URL(string: "https://work.example"), origin: origin, mainFrame: true, userActivated: true))
        for value in ["talentsignal-desktop://install", "talentsignal-desktop://settings?url=https://evil.test",
                      "talentsignal-desktop://updates/path", "talentsignal-desktop://user@updates", "talentsignal-desktop://updates#x"] {
            XCTAssertNil(DesktopChromeAction.resolve(URL(string: value)!, source: source, origin: origin, mainFrame: true, userActivated: true))
        }
    }

    func testUpdateTrustDoesNotAcceptWorkspaceOrArbitraryFeed() {
        let key = Data(repeating: 1, count: 32).base64EncodedString()
        XCTAssertTrue(DesktopUpdateConfiguration.isValid(feed: DesktopUpdateConfiguration.productionFeed, publicKey: key))
        XCTAssertFalse(DesktopUpdateConfiguration.isValid(feed: DesktopUpdateConfiguration.productionFeed, publicKey: ""))
        XCTAssertFalse(DesktopUpdateConfiguration.isValid(feed: "https://evil.test/appcast.xml", publicKey: key))
        XCTAssertFalse(DesktopUpdateConfiguration.isValid(feed: "http://127.0.0.1:9999/appcast.xml", publicKey: key))
    }

    func testInstallLinkRequiresAnExactOfferAndTheSameOriginHumanGesture() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://work.example:10443"))
        let offer = UUID()
        let target = try XCTUnwrap(URL(string: "talentsignal-desktop://install-update?offer=\(offer.uuidString)"))
        XCTAssertEqual(DesktopChromeAction.resolve(target, source: origin.entryURL, origin: origin, mainFrame: true, userActivated: true), .installUpdate(offer))
        XCTAssertNil(DesktopChromeAction.resolve(target, source: origin.entryURL, origin: origin, mainFrame: false, userActivated: true))
        XCTAssertNil(DesktopChromeAction.resolve(target, source: origin.entryURL, origin: origin, mainFrame: true, userActivated: false))
        XCTAssertNil(DesktopChromeAction.resolve(target, source: URL(string: "https://elsewhere.example"), origin: origin, mainFrame: true, userActivated: true))
        for suffix in ["", "?offer=invalid", "?offer=\(offer.uuidString)&offer=\(offer.uuidString)", "?offer=\(offer.uuidString)&url=https://elsewhere.example"] {
            XCTAssertNil(DesktopChromeAction.resolve(URL(string: "talentsignal-desktop://install-update\(suffix)")!, source: origin.entryURL, origin: origin, mainFrame: true, userActivated: true))
        }
    }
}
