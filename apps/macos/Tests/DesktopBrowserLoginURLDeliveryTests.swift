import AppKit
import XCTest
@testable import TalentSignalMac

/// Regression coverage for the real incoming-callback entry: the OS delivers
/// unsolicited global URL events through AppKit into
/// `DesktopBrowserLoginCoordinator.handleIncomingURL`. Only an exactly shaped
/// callback matching the live, nonexpired waiting operation may change state or
/// reach the network; everything else is ignored without cancelling a
/// legitimate pending login.
@MainActor
final class DesktopBrowserLoginURLDeliveryTests: XCTestCase {
    func testMalformedCallbacksLeaveWaitingLoginTimerAndNetworkUntouched() async throws {
        let harness = Harness()
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        let operation = harness.coordinator.operation!
        let valid = harness.url(for: operation).absoluteString
        // Percent-encoding inflates this otherwise exactly shaped callback
        // past the strict size bound.
        let oversized = "com.talentsignal.macos.auth://complete?attempt=\(operation.attemptID)&code=\(String(repeating: "z", count: 256))&state=\(String(repeating: "y", count: 256))"
            .replacingOccurrences(of: "z", with: "%7A")
        for malformed in [
            "https://web.test/complete?attempt=\(operation.attemptID)&code=\(String(repeating: "c", count: 43))&state=\(operation.state)",
            "com.talentsignal.macos.auth://other?attempt=\(operation.attemptID)&code=\(String(repeating: "c", count: 43))&state=\(operation.state)",
            "com.talentsignal.macos.auth://complete/path?attempt=\(operation.attemptID)&code=\(String(repeating: "c", count: 43))&state=\(operation.state)",
            valid + "&extra=1",
            valid + "#fragment",
            "com.talentsignal.macos.auth://complete?attempt=\(operation.attemptID)&code=\(String(repeating: "c", count: 43))",
            "com.talentsignal.macos.auth://complete?attempt=not-a-uuid&code=\(String(repeating: "c", count: 43))&state=\(operation.state)",
            harness.callback(attempt: operation.attemptID, state: operation.state, code: "short").absoluteString,
            oversized,
            "mailto:unknown@example.test",
        ] {
            if let url = URL(string: malformed) { harness.coordinator.handleIncomingURL(url) }
        }
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(harness.coordinator.phase, .waiting)
        XCTAssertEqual(harness.coordinator.operation, operation)
        XCTAssertEqual(harness.openedURLs.count, 1)
        XCTAssertEqual(harness.transport.resultCount, 0)
        XCTAssertEqual(harness.transport.cancelCount, 0)
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
        XCTAssertTrue(harness.registry.hasUnresolvedLogin(for: harness.origin.url.absoluteString))
        // The untouched timer and operation still complete the real callback.
        harness.confirm()
        try await wait { harness.exchanger.exchangeCount == 1 }
        XCTAssertEqual(harness.coordinator.phase, .exchanging)
        harness.exchanger.complete()
        try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
    }

    func testWrongStateAndWrongAttemptNeverDispatchExchangeOrCancel() async throws {
        let harness = Harness()
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        let operation = harness.coordinator.operation!
        harness.coordinator.handleIncomingURL(harness.callback(attempt: operation.attemptID, state: String(repeating: "x", count: 43)))
        harness.coordinator.handleIncomingURL(harness.callback(attempt: UUID().uuidString.lowercased(), state: operation.state))
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(harness.coordinator.phase, .waiting)
        XCTAssertEqual(harness.coordinator.operation, operation)
        XCTAssertEqual(harness.transport.resultCount, 0)
        XCTAssertEqual(harness.transport.cancelCount, 0)
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
        // The refused events never cancelled the pending login: it still works.
        harness.confirm()
        try await wait { harness.exchanger.exchangeCount == 1 }
        XCTAssertEqual(harness.transport.resultCount, 1)
        harness.exchanger.complete()
        try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
    }

    func testRetiredOperationCallbackIsIgnoredWhileFreshLoginWaits() async throws {
        let harness = Harness()
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        let retired = harness.coordinator.operation!
        harness.coordinator.cancel()
        try await wait { harness.transport.cancelCount == 1 }
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        let fresh = harness.coordinator.operation!
        XCTAssertNotEqual(retired.attemptID, fresh.attemptID)
        let cancelsBefore = harness.transport.cancelCount
        // The retired operation's once-valid callback is now an old event.
        harness.coordinator.handleIncomingURL(harness.url(for: retired))
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(harness.coordinator.phase, .waiting)
        XCTAssertEqual(harness.coordinator.operation, fresh)
        XCTAssertEqual(harness.transport.resultCount, 0)
        XCTAssertEqual(harness.transport.cancelCount, cancelsBefore)
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
        harness.confirm()
        try await wait { harness.exchanger.exchangeCount == 1 }
        harness.exchanger.complete()
        try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
    }

    func testDuplicateAndBatchedCallbacksExchangeExactlyOnce() async throws {
        let harness = Harness()
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        let callback = harness.url(for: harness.coordinator.operation!)
        // One batch of identical events plus a late duplicate.
        for _ in 0..<3 { harness.coordinator.handleIncomingURL(callback) }
        harness.coordinator.handleIncomingURL(callback)
        try await wait { harness.exchanger.exchangeCount == 1 }
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(harness.coordinator.phase, .exchanging)
        XCTAssertEqual(harness.exchanger.exchangeCount, 1)
        XCTAssertEqual(harness.transport.resultCount, 1)
        harness.exchanger.complete()
        try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
        XCTAssertEqual(harness.transport.resultCount, 1)
    }

    func testExpiredOperationRefusesMatchingCallbackAndExpiryStillRetires() async throws {
        let harness = Harness()
        harness.transport.grantLifetime = 3
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        let operation = harness.coordinator.operation!
        harness.coordinator.handleIncomingURL(harness.callback(attempt: "not-a-uuid", state: operation.state))
        // Hold the main thread past the expiry instant so the expiry timer
        // cannot retire the operation first: the entry itself must refuse an
        // expired operation even though every other check would pass.
        holdMainThread(until: operation.expiresAt)
        harness.coordinator.handleIncomingURL(harness.url(for: operation))
        XCTAssertEqual(harness.coordinator.phase, .waiting)
        XCTAssertEqual(harness.coordinator.operation, operation)
        XCTAssertEqual(harness.transport.resultCount, 0)
        XCTAssertEqual(harness.transport.cancelCount, 0)
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
        // The preserved expiry surface then retires the login unchanged.
        try await wait { harness.coordinator.phase == .failed("登录请求已过期，请重新登录。") }
        try await wait { harness.transport.cancelCount == 1 }
    }

    func testColdStartCallbackIsIgnoredWithoutAnyRequest() async throws {
        let harness = Harness()
        let callback = harness.callback(attempt: UUID().uuidString.lowercased(), state: String(repeating: "s", count: 43))
        harness.coordinator.handleIncomingURL(callback)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(harness.coordinator.phase, .idle)
        XCTAssertNil(harness.coordinator.operation)
        XCTAssertEqual(harness.openedURLs.count, 0)
        XCTAssertEqual(harness.transport.resultCount, 0)
        XCTAssertEqual(harness.transport.cancelCount, 0)
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
    }

    func testForeignOriginRefusesThenPendingLoginStillCompletes() async throws {
        let harness = Harness()
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        let operation = harness.coordinator.operation!
        harness.currentOrigin = WorkspaceOrigin("https://elsewhere.test")!
        harness.coordinator.handleIncomingURL(harness.url(for: operation))
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(harness.coordinator.phase, .waiting)
        XCTAssertEqual(harness.coordinator.operation, operation)
        XCTAssertEqual(harness.transport.resultCount, 0)
        XCTAssertEqual(harness.transport.cancelCount, 0)
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
        harness.currentOrigin = harness.origin
        harness.confirm()
        try await wait { harness.exchanger.exchangeCount == 1 }
        harness.exchanger.complete()
        try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
    }

    func testStaleSelectionEpochRefusesCallbackWithoutAnyRequest() async throws {
        let harness = Harness()
        harness.transport.grantLifetime = 30
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        let operation = harness.coordinator.operation!
        // A new deliberate login elsewhere advances the registry selection.
        _ = try harness.registry.beginFreshPrimaryLogin(for: harness.origin.url.absoluteString)
        harness.coordinator.handleIncomingURL(harness.url(for: operation))
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(harness.coordinator.phase, .waiting)
        XCTAssertEqual(harness.coordinator.operation, operation)
        XCTAssertEqual(harness.transport.resultCount, 0)
        XCTAssertEqual(harness.transport.cancelCount, 0)
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
    }

    func testBrowserLaunchFailureCancelsPendingOperation() async throws {
        let harness = Harness()
        harness.browserAccepted = false
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .failed("无法打开系统浏览器，请检查默认浏览器后重试。") }
        // The opener Bool only reports OS launch acceptance, never a login.
        XCTAssertEqual(harness.openedURLs.count, 1)
        XCTAssertNil(harness.coordinator.operation)
        try await wait { harness.transport.cancelCount == 1 }
        XCTAssertFalse(harness.registry.hasUnresolvedLogin(for: harness.origin.url.absoluteString))
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
    }

    /// The production delegate dispatch is a plain loop into the same singleton
    /// that owns the operation. With no pending login this exercises the seam
    /// without reading or writing shared user preferences.
    func testAppDelegateForwardsGlobalURLsToTheSharedCoordinator() {
        let shared = DesktopBrowserLoginCoordinator.shared
        XCTAssertEqual(shared.phase, .idle)
        XCTAssertNil(shared.operation)
        let callback = URL(string: "com.talentsignal.macos.auth://complete?attempt=\(UUID().uuidString.lowercased())&code=\(String(repeating: "c", count: 43))&state=\(String(repeating: "s", count: 43))")!
        TalentSignalMacAppDelegate().application(NSApplication.shared, open: [callback, URL(string: "https://unknown.example/link")!])
        XCTAssertEqual(shared.phase, .idle)
        XCTAssertNil(shared.operation)
    }

    private func holdMainThread(until deadline: Date) {
        while Date() <= deadline { Thread.sleep(forTimeInterval: 0.002) }
    }

    func testOnlyAcceptedCallbackPresentsWorkspaceBeforeDispatchExactlyOnce() async throws {
        let harness = Harness()
        var presentations = 0
        harness.coordinator.setWorkspacePresenter {
            presentations += 1
            XCTAssertEqual(harness.coordinator.phase, .exchanging)
            XCTAssertEqual(harness.transport.resultCount, 0)
        }
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        let operation = harness.coordinator.operation!
        harness.coordinator.handleIncomingURL(harness.callback(attempt: operation.attemptID, state: String(repeating: "x", count: 43)))
        XCTAssertEqual(presentations, 0)
        let callback = harness.url(for: operation)
        harness.coordinator.handleIncomingURL(callback)
        XCTAssertEqual(presentations, 1)
        harness.coordinator.handleIncomingURL(callback)
        try await wait { harness.exchanger.exchangeCount == 1 }
        XCTAssertEqual(presentations, 1)
        harness.exchanger.complete()
        try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
    }

    private func wait(_ condition: @escaping () -> Bool) async throws {
        for _ in 0..<200 { if condition() { return }; try await Task.sleep(for: .milliseconds(10)) }
        XCTFail("Production transition did not reach expected state"); throw URLError(.timedOut)
    }
}
