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
        // The strict size bound is the only failing rule here: every decoded
        // field is individually valid and the shape is exact.
        let wide = "com.talentsignal.macos.auth://complete?attempt=\(id)&code=\(String(repeating: "z", count: 256))&state=\(String(repeating: "y", count: 256))"
        XCTAssertNotNil(DesktopBrowserLoginCallback.parse(URL(string: wide)!))
        let inflated = wide.replacingOccurrences(of: "z", with: "%7A")
        XCTAssertGreaterThan(URL(string: inflated)!.absoluteString.count, DesktopBrowserLoginCallback.maximumCallbackLength)
        XCTAssertNil(DesktopBrowserLoginCallback.parse(URL(string: inflated)!))
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
        harness.coordinator.start(in: harness.origin, returningTo: target, captureDraft: {
            DesktopDraftRecovery(owner: harness.owner, target: target, sessionID: nil, draft: nil)
        })
        try await wait { harness.coordinator.phase == .waiting }
        // The default-browser seam receives the validated authorization URL.
        XCTAssertEqual(harness.openedURLs, [harness.authorization(for: harness.coordinator.operation!)])
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
        let oldOperation = harness.coordinator.operation!
        harness.coordinator.cancel()
        XCTAssertEqual(harness.coordinator.phase, .cancelled)
        harness.coordinator.handleIncomingURL(harness.url(for: oldOperation))
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
    func testRetryKeepsFirstVerifiedTextAndTargetAcrossStoreRotation() async throws {
        let harness = Harness()
        let id = UUID().uuidString.lowercased()
        let target = URL(string: "https://web.test/workspace?draft_session=\(id)")!
        let draft = DesktopDraftRecovery.Draft(value: "Synthetic unsent text", updatedAt: ISO8601DateFormatter().string(from: Date()),
                                               expiresAt: Date().addingTimeInterval(300).timeIntervalSince1970 * 1000, writer: "writer")
        var captures = 0
        harness.coordinator.start(in: harness.origin, returningTo: target, captureDraft: {
            captures += 1
            return DesktopDraftRecovery(owner: harness.owner, target: target, sessionID: id, draft: draft)
        })
        try await wait { harness.coordinator.phase == .waiting }
        harness.coordinator.cancel()
        harness.coordinator.start(in: harness.origin, returningTo: harness.origin.entryURL, captureDraft: { captures += 1; return nil })
        try await wait { harness.coordinator.phase == .waiting }
        harness.confirm(); try await wait { harness.exchanger.exchangeCount == 1 }
        harness.exchanger.complete()
        try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
        XCTAssertEqual(captures, 1)
        XCTAssertEqual(harness.coordinator.returnTarget, target)
        XCTAssertEqual(harness.exchanger.restored?.draft?.value, draft.value)
        XCTAssertEqual(try harness.registry.selection(for: harness.origin.url.absoluteString).verifiedDraftOwner, harness.owner)
    }
    func testChangedVerifiedPartitionNeverImportsOldTextOrPrivateTarget() async throws {
        let harness = Harness()
        let id = UUID().uuidString.lowercased()
        let target = URL(string: "https://web.test/workspace?draft_session=\(id)")!
        let draft = DesktopDraftRecovery.Draft(value: "Private synthetic draft", updatedAt: ISO8601DateFormatter().string(from: Date()),
            expiresAt: Date().addingTimeInterval(300).timeIntervalSince1970 * 1000, writer: "writer")
        harness.coordinator.start(in: harness.origin, returningTo: target, captureDraft: {
            DesktopDraftRecovery(owner: harness.owner, target: target, sessionID: id, draft: draft)
        })
        try await wait { harness.coordinator.phase == .waiting }
        harness.exchanger.storageScope = String(repeating: "b", count: 64)
        harness.confirm(); try await wait { harness.exchanger.exchangeCount == 1 }; harness.exchanger.complete()
        try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
        XCTAssertNil(harness.coordinator.returnTarget)
        XCTAssertNil(harness.exchanger.restored)
        XCTAssertNotNil(harness.coordinator.recoveryNotice)
    }
    func testCancelledSlowCaptureCannotRotateAStoreOrReplaceARetry() async throws {
        let harness = Harness()
        let before = try harness.registry.selection(for: harness.origin.url.absoluteString)
        let target = harness.origin.url.appendingPathComponent("workspace/people/synthetic-person")
        var pending: CheckedContinuation<DesktopDraftRecovery?, Never>?
        harness.coordinator.start(in: harness.origin, returningTo: target, captureDraft: {
            await withCheckedContinuation { pending = $0 }
        })
        try await wait { pending != nil }
        harness.coordinator.cancel()
        pending?.resume(returning: nil)
        await Task.yield()
        XCTAssertEqual(try harness.registry.selection(for: harness.origin.url.absoluteString).storeIdentifier, before.storeIdentifier)
        XCTAssertEqual(harness.coordinator.phase, .cancelled)
        XCTAssertEqual(harness.openedURLs.count, 0)
        var reacquired = false
        harness.coordinator.start(in: harness.origin, returningTo: harness.origin.entryURL, captureDraft: {
            reacquired = true
            return DesktopDraftRecovery(owner: harness.owner, target: target, sessionID: nil, draft: nil)
        })
        try await wait { harness.coordinator.phase == .waiting }
        XCTAssertTrue(reacquired)
        harness.confirm(); try await wait { harness.exchanger.exchangeCount == 1 }; harness.exchanger.complete()
        try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
        XCTAssertEqual(harness.coordinator.returnTarget, target)
    }
    func testLocalRestoreFailureNeverBlocksVerifiedLoginOrResultCheck() async throws {
        for uncertain in [false, true] {
            let harness = Harness()
            let id = UUID().uuidString.lowercased()
            let target = URL(string: "https://web.test/workspace?draft_session=\(id)")!
            let draft = DesktopDraftRecovery.Draft(value: "Synthetic recoverable text", updatedAt: ISO8601DateFormatter().string(from: Date()),
                expiresAt: Date().addingTimeInterval(300).timeIntervalSince1970 * 1000, writer: "writer")
            harness.coordinator.start(in: harness.origin, returningTo: target, captureDraft: {
                DesktopDraftRecovery(owner: harness.owner, target: target, sessionID: id, draft: draft)
            })
            try await wait { harness.coordinator.phase == .waiting }
            harness.exchanger.restoreFailure = true
            harness.exchanger.fail = uncertain
            harness.confirm()
            if uncertain {
                try await wait { harness.coordinator.phase == .unresolved }
                harness.transport.consumed = true
                harness.coordinator.checkResult()
            } else {
                try await wait { harness.exchanger.exchangeCount == 1 }; harness.exchanger.complete()
            }
            try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
            XCTAssertFalse(harness.registry.hasUnresolvedLogin(for: harness.origin.url.absoluteString))
            XCTAssertEqual(harness.coordinator.visibleRetainedDrafts.count, 1)
            let retained = try XCTUnwrap(harness.coordinator.visibleRetainedDrafts.first)
            let wrong = DesktopDraftOwner(accountID: harness.owner.accountID, userID: harness.owner.userID, storageScope: String(repeating: "b", count: 64))
            let refused = await harness.coordinator.copyRetainedDraft(retained.id, verifying: { wrong })
            XCTAssertFalse(refused); XCTAssertNil(harness.copiedText)
            XCTAssertEqual(harness.coordinator.visibleRetainedDrafts.count, 1)
            let copied = await harness.coordinator.copyRetainedDraft(retained.id, verifying: { harness.owner })
            XCTAssertTrue(copied); XCTAssertEqual(harness.copiedText, draft.value)
            XCTAssertTrue(harness.coordinator.visibleRetainedDrafts.isEmpty)
            XCTAssertEqual(harness.exchanger.exchangeCount, 1)
        }
    }
    func testExplicitSignOutDropsFailedCapsulesWhileExpiryKeepsThem() async throws {
        for explicit in [true, false] {
            let harness = Harness()
            harness.exchanger.restoreFailure = true
            let target = URL(string: "https://web.test/workspace?draft_session=33333333-3333-4333-8333-333333333333")!
            let draft = DesktopDraftRecovery.Draft(value: "synthetic logout boundary", updatedAt: ISO8601DateFormatter().string(from: Date()),
                expiresAt: Date().addingTimeInterval(300).timeIntervalSince1970 * 1000, writer: "fixture")
            harness.coordinator.start(in: harness.origin, returningTo: target, captureDraft: {
                DesktopDraftRecovery(owner: harness.owner, target: target, sessionID: DesktopDraftRecovery.sessionID(in: target), draft: draft)
            })
            try await wait { harness.coordinator.phase == .waiting }
            harness.confirm(); try await wait { harness.exchanger.pending != nil }; harness.exchanger.complete()
            try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
            XCTAssertEqual(harness.coordinator.visibleRetainedDrafts.count, 1)
            let retainedID = try XCTUnwrap(harness.coordinator.visibleRetainedDrafts.first?.id)
            var releaseCopy: CheckedContinuation<DesktopDraftOwner?, Never>?
            let copying = Task { await harness.coordinator.copyRetainedDraft(retainedID, verifying: {
                await withCheckedContinuation { releaseCopy = $0 }
            }) }
            try await wait { releaseCopy != nil }
            if explicit { harness.coordinator.explicitlySignedOut(in: harness.origin) }
            else { harness.coordinator.signedOut(in: harness.origin) }
            releaseCopy?.resume(returning: harness.owner)
            let copiedAfterLogout = await copying.value
            XCTAssertFalse(copiedAfterLogout); XCTAssertNil(harness.copiedText)
            XCTAssertTrue(harness.coordinator.visibleRetainedDrafts.isEmpty)
            harness.coordinator.start(in: harness.origin, returningTo: nil)
            try await wait { harness.coordinator.phase == .waiting }
            harness.confirm(); try await wait { harness.exchanger.pending != nil }; harness.exchanger.complete()
            try await wait { if case .completed = harness.coordinator.phase { return true }; return false }
            XCTAssertEqual(harness.coordinator.visibleRetainedDrafts.count, explicit ? 0 : 1)
        }
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
        harness.coordinator.handleIncomingURL(harness.callback(attempt: operation.attemptID, state: String(repeating: "x", count: 43)))
        try await Task.sleep(for: .milliseconds(20))
        // A wrong-state event is ignored; the pending login stays untouched.
        XCTAssertEqual(harness.coordinator.phase, .waiting)
        XCTAssertEqual(harness.coordinator.operation, operation)
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
        harness.currentOrigin = WorkspaceOrigin("https://elsewhere.test")!
        harness.confirm(); await Task.yield()
        // A foreign configured origin refuses the exact callback untouched.
        XCTAssertEqual(harness.exchanger.exchangeCount, 0)
        XCTAssertEqual(harness.coordinator.phase, .waiting)
        XCTAssertEqual(harness.coordinator.operation, operation)
        XCTAssertEqual(harness.transport.resultCount, 0)
    }
    private func wait(_ condition: @escaping () -> Bool) async throws {
        for _ in 0..<200 { if condition() { return }; try await Task.sleep(for: .milliseconds(10)) }
        XCTFail("Production transition did not reach expected state"); throw URLError(.timedOut)
    }
}

@MainActor
final class Harness {
    let origin = WorkspaceOrigin("https://web.test")!
    var currentOrigin: WorkspaceOrigin
    let registry = LoginStoreRegistry(persistence: MemoryRegistryPersistence(), lockURL: testLock())
    let transport = FakeLoginTransport()
    let exchanger = FakeExchanger()
    var openedURLs: [URL] = []
    var browserAccepted = true
    var copiedText: String?
    var owner: DesktopDraftOwner { DesktopDraftOwner(accountID: "11111111-1111-4111-8111-111111111111", userID: "22222222-2222-4222-8222-222222222222", storageScope: String(repeating: "a", count: 64)) }
    lazy var coordinator = DesktopBrowserLoginCoordinator(registry: registry, originProvider: { [unowned self] in currentOrigin },
        transportFactory: { [unowned self] _ in transport }, exchangerFactory: { [unowned self] in exchanger },
        browserOpener: { [unowned self] url in openedURLs.append(url); return browserAccepted },
        copyText: { [unowned self] text in copiedText = text; return true })
    init() { currentOrigin = origin }
    func callback(attempt: String, state: String, code: String = String(repeating: "c", count: 43)) -> URL {
        URL(string: "com.talentsignal.macos.auth://complete?attempt=\(attempt)&code=\(code)&state=\(state)")!
    }
    func url(for operation: DesktopBrowserLoginOperation) -> URL {
        callback(attempt: operation.attemptID, state: operation.state)
    }
    func authorization(for operation: DesktopBrowserLoginOperation) -> URL {
        URL(string: "https://web.test/desktop-auth/authorize?attempt=\(operation.attemptID)&state=\(operation.state)")!
    }
    /// Delivers through the same production URL-entry method the app delegate
    /// uses; no completion callback is faked.
    func confirm() { coordinator.handleIncomingURL(url(for: coordinator.operation!)) }
}
final class FakeLoginTransport: DesktopLoginTransporting {
    var consumed = false
    var grantLifetime: TimeInterval = 300
    private(set) var resultCount = 0
    private(set) var cancelCount = 0
    func prepare(challenge: String, state: String, cancelSecret: String) async throws -> DesktopPreparedGrant {
        let id = UUID().uuidString.lowercased()
        return .init(attempt_id: id, authorization_url: "https://web.test/desktop-auth/authorize?attempt=\(id)&state=\(state)",
                     expires_at: ISO8601DateFormatter().string(from: Date().addingTimeInterval(grantLifetime)), matching_hint: "ABCD-12")
    }
    func result(operation: DesktopBrowserLoginOperation) async throws -> DesktopGrantResult {
        resultCount += 1
        return .init(attempt_id: operation.attemptID, state: consumed ? "consumed" : "approved",
              account_id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222", committed: consumed)
    }
    func cancel(operation: DesktopBrowserLoginOperation) async throws { cancelCount += 1 }
}
@MainActor
final class FakeExchanger: DesktopLoginExchanging {
    var fail = false, exchangeCount = 0, readCount = 0
    var pending: CheckedContinuation<DesktopLoginIdentity, Error>?
    var identity: DesktopLoginIdentity?
    var storageScope = String(repeating: "a", count: 64)
    var restored: DesktopDraftRecovery?
    var restoreFailure = false
    func exchange(operation: DesktopBrowserLoginOperation, code: String, expected: DesktopLoginIdentity) async throws -> DesktopLoginIdentity {
        exchangeCount += 1; identity = expected; identity?.draftStorageScope = storageScope
        if fail { throw URLError(.networkConnectionLost) }
        return try await withCheckedThrowingContinuation { pending = $0 }
    }
    func complete() { pending?.resume(returning: identity!); pending = nil }
    func readStatus(operation: DesktopBrowserLoginOperation, expected: DesktopLoginIdentity) async throws -> DesktopLoginIdentity {
        readCount += 1
        return DesktopLoginIdentity(accountID: expected.accountID, userID: expected.userID, draftStorageScope: storageScope)
    }
    func restoreDraft(_ recovery: DesktopDraftRecovery, operation: DesktopBrowserLoginOperation) async throws {
        if restoreFailure { throw URLError(.cannotCreateFile) }
        restored = recovery
    }
    func cancel() { /* Deliberately complete late to exercise the production fence. */ }
}

@MainActor
final class LoginStoreRegistryTests: XCTestCase {
    func testVerifiedOwnerIsDurableImmutableAndCannotBeWrittenToRetiredStore() throws {
        let memory = MemoryRegistryPersistence(), registry = LoginStoreRegistry(persistence: memory, lockURL: testLock())
        let selection = try registry.beginFreshPrimaryLogin(for: "https://web.test")
        let owner = DesktopDraftOwner(accountID: "11111111-1111-4111-8111-111111111111",
            userID: "22222222-2222-4222-8222-222222222222", storageScope: String(repeating: "a", count: 64))
        try registry.recordVerifiedDraftOwner(owner, selection: selection)
        XCTAssertEqual(try JSONDecoder().decode([String: LoginStoreSelection].self, from: memory.data!)[selection.origin]?.verifiedDraftOwner, owner)
        XCTAssertTrue(registry.hasUnresolvedLogin(for: selection.origin), "Owner observation cannot settle authentication")
        let other = DesktopDraftOwner(accountID: owner.accountID, userID: owner.userID, storageScope: String(repeating: "b", count: 64))
        XCTAssertThrowsError(try registry.recordVerifiedDraftOwner(other, selection: selection))
        memory.failWrites = true
        XCTAssertThrowsError(try registry.recordVerifiedDraftOwner(owner, selection: selection))
        memory.failWrites = false
        let next = try registry.beginFreshPrimaryLogin(for: selection.origin)
        XCTAssertNil(next.verifiedDraftOwner)
        XCTAssertThrowsError(try registry.recordVerifiedDraftOwner(owner, selection: selection))
    }

    func testLegacyRegistryWithoutDraftOwnerStillDecodes() throws {
        let selection = LoginStoreSelection(origin: "https://web.test", storeIdentifier: UUID(), epoch: 1, unresolved: false, updatedAt: Date())
        let data = try JSONEncoder().encode(selection)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object.removeValue(forKey: "verifiedDraftOwner")
        let decoded = try JSONDecoder().decode(LoginStoreSelection.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertNil(decoded.verifiedDraftOwner)
        XCTAssertEqual(decoded.storeIdentifier, selection.storeIdentifier)
    }

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
