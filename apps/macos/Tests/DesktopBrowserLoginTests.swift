import XCTest
import Combine
import CryptoKit
@testable import TalentSignalMac

@MainActor
final class DesktopBrowserLoginTests: XCTestCase {
    func testCallbackAcceptsOnlyExactShape() {
        let id = UUID().uuidString.lowercased(), code = String(repeating: "c", count: 43), state = String(repeating: "s", count: 43)
        let valid = "com.talentsignal.macos.auth://complete?attempt=\(id)&code=\(code)&state=\(state)"
        XCTAssertEqual(DesktopBrowserLoginCallback.parse(URL(string: valid)!)?.attempt, id)
        for rejected in [valid + "&extra=1", valid + "&state=\(state)", valid + "#fragment",
                         valid.replacingOccurrences(of: "complete?", with: "complete/path?"),
                         valid.replacingOccurrences(of: "com.talentsignal.macos.auth", with: "https"),
                         valid.replacingOccurrences(of: "complete?", with: "other?"),
                         valid.replacingOccurrences(of: id, with: "wrong-id"),
                         valid.replacingOccurrences(of: code, with: "short")] {
            XCTAssertNil(DesktopBrowserLoginCallback.parse(URL(string: rejected)!))
        }
    }
    func testSecretsUseIndependentRandomnessAndExactS256() throws {
        let first = try DesktopBrowserLoginCoordinator.newSecrets(), second = try DesktopBrowserLoginCoordinator.newSecrets()
        XCTAssertNotEqual(first.verifier, second.verifier); XCTAssertNotEqual(first.state, second.state)
        XCTAssertNotEqual(first.state, first.cancelSecret)
        let s256 = Data(SHA256.hash(data: Data(first.verifier.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        XCTAssertEqual(first.challenge, s256)
    }
    func testRealCoordinatorWaitsForReadbackAndRestoresSafeTarget() async throws {
        let harness = Harness()
        let target = harness.origin.url.appendingPathComponent("workspace/sessions/123")
        harness.coordinator.start(in: harness.origin, returningTo: target)
        try await wait { harness.coordinator.phase == .waiting }
        XCTAssertTrue(harness.registry.hasUnresolvedLogin(for: harness.origin.url.absoluteString))
        harness.confirm()
        try await wait { harness.exchanger.exchangeCount == 1 }
        XCTAssertEqual(harness.coordinator.phase, .exchanging)
        XCTAssertTrue(harness.registry.hasUnresolvedLogin(for: harness.origin.url.absoluteString))
        harness.exchanger.complete()
        try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
        XCTAssertFalse(harness.registry.hasUnresolvedLogin(for: harness.origin.url.absoluteString))
        XCTAssertEqual(harness.coordinator.returnTarget, target)
    }
    func testCancelAndFreshLoginIgnoreLateCallbackAndExchange() async throws {
        let harness = Harness()
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        let oldCallback = harness.callback!, oldOperation = harness.coordinator.operation!
        harness.coordinator.cancel()
        XCTAssertEqual(harness.coordinator.phase, .cancelled)
        oldCallback(harness.url(for: oldOperation), nil)
        await Task.yield()
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        XCTAssertNotEqual(harness.coordinator.operation!.storeIdentifier, oldOperation.storeIdentifier)
        harness.confirm()
        try await wait { harness.exchanger.exchangeCount == 1 }
        harness.coordinator.cancel()
        harness.exchanger.complete()
        await Task.yield()
        XCTAssertEqual(harness.coordinator.phase, .unresolved)
        XCTAssertTrue(harness.registry.hasUnresolvedLogin(for: harness.origin.url.absoluteString))
    }
    func testUnknownOutcomeChecksExistingSessionWithoutReplayingExchange() async throws {
        let harness = Harness()
        harness.exchanger.fail = true
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        harness.confirm()
        try await wait { harness.coordinator.phase == .unresolved }
        harness.transport.consumed = true
        harness.coordinator.checkResult()
        try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
        XCTAssertEqual(harness.exchanger.exchangeCount, 1)
        XCTAssertEqual(harness.exchanger.readCount, 1)
    }
    func testWrongStateAndChangedOriginNeverDispatchExchange() async throws {
        let harness = Harness()
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        let operation = harness.coordinator.operation!
        harness.callback?(URL(string: harness.url(for: operation).absoluteString.replacingOccurrences(of: operation.state, with: String(repeating: "x", count: 43)))!, nil)
        try await wait { harness.coordinator.phase != .waiting }
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
        harness.coordinator.start(in: harness.origin, returningTo: nil)
        try await wait { harness.coordinator.phase == .waiting }
        harness.currentOrigin = WorkspaceOrigin("https://elsewhere.test")!
        harness.confirm(); await Task.yield()
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
    }
    private func wait(_ condition: @escaping () -> Bool) async throws {
        for _ in 0..<200 { if condition() { return }; try await Task.sleep(for: .milliseconds(10)) }
        XCTFail("Production transition did not reach expected state"); throw URLError(.timedOut)
    }
}

@MainActor
private final class Harness {
    let origin = WorkspaceOrigin("https://web.test")!
    var currentOrigin: WorkspaceOrigin
    let registry = LoginStoreRegistry(persistence: MemoryRegistryPersistence(), lockURL: testLock())
    let transport = FakeLoginTransport()
    let exchanger = FakeExchanger()
    var callback: ((URL?, Error?) -> Void)?
    lazy var coordinator = DesktopBrowserLoginCoordinator(registry: registry, originProvider: { [unowned self] in currentOrigin },
        transportFactory: { [unowned self] _ in transport }, exchangerFactory: { [unowned self] in exchanger },
        launchOverride: { [unowned self] _, completion in callback = completion; return true })
    init() { currentOrigin = origin }
    func url(for operation: DesktopBrowserLoginOperation) -> URL {
        URL(string: "com.talentsignal.macos.auth://complete?attempt=\(operation.attemptID)&code=\(String(repeating: "c", count: 43))&state=\(operation.state)")!
    }
    func confirm() { callback?(url(for: coordinator.operation!), nil) }
}
private final class FakeLoginTransport: DesktopLoginTransporting {
    var consumed = false
    func prepare(challenge: String, state: String, cancelSecret: String) async throws -> DesktopPreparedGrant {
        let id = UUID().uuidString.lowercased()
        return .init(attempt_id: id, authorization_url: "https://web.test/desktop-auth/authorize?attempt=\(id)&state=\(state)",
                     expires_at: ISO8601DateFormatter().string(from: Date().addingTimeInterval(300)), matching_hint: "ABCD-12")
    }
    func result(operation: DesktopBrowserLoginOperation) async throws -> DesktopGrantResult {
        .init(attempt_id: operation.attemptID, state: consumed ? "consumed" : "approved",
              account_id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222", committed: consumed)
    }
    func cancel(operation: DesktopBrowserLoginOperation) async throws {}
}
@MainActor
private final class FakeExchanger: DesktopLoginExchanging {
    var fail = false, exchangeCount = 0, readCount = 0
    var pending: CheckedContinuation<DesktopLoginIdentity, Error>?
    var identity: DesktopLoginIdentity?
    func exchange(operation: DesktopBrowserLoginOperation, code: String, expected: DesktopLoginIdentity) async throws -> DesktopLoginIdentity {
        exchangeCount += 1; identity = expected
        if fail { throw URLError(.networkConnectionLost) }
        return try await withCheckedThrowingContinuation { pending = $0 }
    }
    func complete() { pending?.resume(returning: identity!); pending = nil }
    func readStatus(operation: DesktopBrowserLoginOperation, expected: DesktopLoginIdentity) async throws -> DesktopLoginIdentity { readCount += 1; return expected }
    func cancel() { /* Deliberately complete late to exercise the production fence. */ }
}

@MainActor
final class LoginStoreRegistryTests: XCTestCase {
    func testAdoptionFreshEpochAndPublicationAreDurable() throws {
        let memory = MemoryRegistryPersistence(), registry = LoginStoreRegistry(persistence: memory, lockURL: testLock())
        let origin = "https://web.test"
        let legacy = try registry.selection(for: origin)
        XCTAssertEqual(legacy.storeIdentifier, LoginStoreRegistry.legacyDeterministicStore(for: origin))
        var epochs: [UInt64] = []
        let subscription = registry.changes.sink { epochs.append($0.epoch) }
        defer { subscription.cancel() }
        let fresh = try registry.beginFreshPrimaryLogin(for: origin)
        XCTAssertNotEqual(fresh.storeIdentifier, legacy.storeIdentifier)
        XCTAssertTrue(fresh.unresolved)
        XCTAssertEqual(try JSONDecoder().decode([String: LoginStoreSelection].self, from: memory.data!)[origin], fresh)
        try registry.resolveLogin(for: origin, epoch: fresh.epoch)
        let next = try registry.beginFreshPrimaryLogin(for: origin)
        XCTAssertFalse(registry.isCurrent(fresh)); XCTAssertEqual(next.epoch, 2)
        XCTAssertEqual(epochs, [1, 2])
        XCTAssertThrowsError(try registry.resolveLogin(for: origin, epoch: 1))
    }
    func testRestartPreservesUnresolvedAndSecondInstanceCannotDispatch() throws {
        let memory = MemoryRegistryPersistence(), lock = testLock(), origin = "https://web.test"
        do {
            let first = LoginStoreRegistry(persistence: memory, lockURL: lock)
            let selection = try first.beginFreshPrimaryLogin(for: origin)
            let rival = LoginStoreRegistry(persistence: memory, lockURL: lock)
            XCTAssertThrowsError(try rival.beginFreshPrimaryLogin(for: origin))
            XCTAssertTrue(first.isCurrent(selection))
        }
        let restarted = LoginStoreRegistry(persistence: memory, lockURL: lock)
        XCTAssertTrue(restarted.hasUnresolvedLogin(for: origin))
    }
    func testWriteFailureNeverPublishesFreshSelection() throws {
        let memory = MemoryRegistryPersistence(), registry = LoginStoreRegistry(persistence: memory, lockURL: testLock())
        let origin = "https://web.test", legacy = try registry.selection(for: origin)
        memory.failWrites = true
        XCTAssertThrowsError(try registry.beginFreshPrimaryLogin(for: origin))
        XCTAssertTrue(registry.isCurrent(legacy))
    }
    func testCorruptionCanOnlyRecoverThroughFreshDurableUnresolvedStore() throws {
        let memory = MemoryRegistryPersistence(); memory.data = Data("broken".utf8)
        let registry = LoginStoreRegistry(persistence: memory, lockURL: testLock()), origin = "https://web.test"
        XCTAssertNil(registry.selectedStore(for: origin))
        let fresh = try registry.beginFreshPrimaryLogin(for: origin)
        XCTAssertTrue(fresh.unresolved)
        XCTAssertNotEqual(fresh.storeIdentifier, LoginStoreRegistry.legacyDeterministicStore(for: origin))
    }
}
private func testLock() -> URL {
    URL(fileURLWithPath: ProcessInfo.processInfo.environment["DESKTOP_LOGIN_TEST_ARTIFACT"] ?? NSTemporaryDirectory())
        .appendingPathComponent("registry-\(UUID().uuidString).lock")
}
final class MemoryRegistryPersistence: LoginStoreRegistryPersisting {
    var data: Data?, failWrites = false
    func read() -> Data? { data }
    func write(_ data: Data) throws {
        if failWrites { throw LoginStoreRegistryError.persistenceUnavailable }
        self.data = data
    }
}
