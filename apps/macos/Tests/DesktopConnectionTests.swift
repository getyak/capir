import XCTest
@testable import TalentSignalMac

@MainActor
final class DesktopConnectionTests: XCTestCase {
    func testDiagnosticsRetireOldEndpointRequestsAndCompletedResults() async throws {
        let a = try XCTUnwrap(WorkspaceOrigin("https://a.example"))
        let b = try XCTUnwrap(WorkspaceOrigin("https://b.example"))
        let started = [expectation(description: "A started"), expectation(description: "B started")]
        let finished = [expectation(description: "A returned"), expectation(description: "B returned")]
        let pending = PendingConnectionProbes(started: started, finished: finished)
        defer { pending.finishAll() }
        let model = WorkspaceConnectionProbeController { await pending.run($0) }
        model.check(a)
        await fulfillment(of: [started[0]], timeout: 3)
        XCTAssertTrue(model.isChecking(for: a))

        model.reset(for: b)
        XCTAssertNil(model.result(for: a))
        XCTAssertFalse(model.isChecking(for: b))
        model.check(b)
        model.check(b)
        await fulfillment(of: [started[1]], timeout: 3)
        XCTAssertEqual(pending.origins, [a, b], "Repeated clicks must not start another check")
        pending.finish(0, result: .init(reachable: true, summary: "A", detail: "old"))
        await fulfillment(of: [finished[0]], timeout: 3)
        XCTAssertNil(model.result(for: b))
        XCTAssertTrue(model.isChecking(for: b), "A must not end B's pending check")

        let current = ConnectionProbeResult(reachable: false, summary: "B", detail: "current")
        pending.finish(1, result: current)
        await fulfillment(of: [finished[1]], timeout: 3)
        XCTAssertEqual(model.result(for: b), current)
        XCTAssertFalse(model.isChecking(for: b))
        XCTAssertNil(model.result(for: a), "Presentation rejects the old result before onChange runs")
        model.reset(for: a)
        XCTAssertNil(model.result(for: a), "Changing endpoint clears even a completed check")
    }

    func testRevisitingAnEndpointAndClosingSettingsCannotReviveAnOldCheck() async throws {
        let a = try XCTUnwrap(WorkspaceOrigin("https://a.example"))
        let b = try XCTUnwrap(WorkspaceOrigin("https://b.example"))
        let started = [expectation(description: "first A started"), expectation(description: "new A started")]
        let finished = [expectation(description: "old A returned"), expectation(description: "new A returned")]
        let pending = PendingConnectionProbes(started: started, finished: finished)
        defer { pending.finishAll() }
        let model = WorkspaceConnectionProbeController { await pending.run($0) }
        model.check(a)
        await fulfillment(of: [started[0]], timeout: 3)
        model.reset(for: b)
        model.reset(for: a)
        model.check(a)
        await fulfillment(of: [started[1]], timeout: 3)
        pending.finish(0, result: .init(reachable: true, summary: "old A", detail: "stale"))
        await fulfillment(of: [finished[0]], timeout: 3)
        XCTAssertNil(model.result(for: a))
        XCTAssertTrue(model.isChecking(for: a))

        model.reset(for: nil)
        pending.finish(1, result: .init(reachable: true, summary: "new A", detail: "closed"))
        await fulfillment(of: [finished[1]], timeout: 3)
        XCTAssertNil(model.result(for: a))
        XCTAssertNil(model.result(for: nil))
        XCTAssertFalse(model.isChecking(for: a))
    }

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

/// Deliberately ignores task cancellation so the production controller must
/// enforce ownership even when a transport returns after cancellation.
@MainActor
private final class PendingConnectionProbes {
    let started: [XCTestExpectation]
    let finished: [XCTestExpectation]
    private(set) var origins: [WorkspaceOrigin] = []
    private var pending: [Int: CheckedContinuation<ConnectionProbeResult, Never>] = [:]

    init(started: [XCTestExpectation], finished: [XCTestExpectation]) {
        self.started = started
        self.finished = finished
    }

    func run(_ origin: WorkspaceOrigin) async -> ConnectionProbeResult {
        let index = origins.count
        origins.append(origin)
        let result = await withCheckedContinuation { continuation in
            pending[index] = continuation
            if started.indices.contains(index) { started[index].fulfill() }
        }
        if finished.indices.contains(index) { finished[index].fulfill() }
        return result
    }

    func finish(_ index: Int, result: ConnectionProbeResult) {
        let continuation = pending.removeValue(forKey: index)
        XCTAssertNotNil(continuation)
        continuation?.resume(returning: result)
    }

    func finishAll() {
        let remaining = Array(pending.values)
        pending.removeAll()
        for continuation in remaining {
            continuation.resume(returning: .init(reachable: false, summary: "test cleanup", detail: ""))
        }
    }
}
