import XCTest
import AppKit
import WebKit
@testable import TalentSignalMac

@MainActor
final class DesktopPersistentSessionTests: XCTestCase {
    func testHTTPFixtureWaitsForStartupLongerThanTwoSeconds() async throws {
        let h = PersistentHarness()
        let fixture = try PersistentHTTPFixture(receipt: h.receipt, startupDelay: 2.2)
        defer { fixture.stop() }
        let started = ProcessInfo.processInfo.systemUptime
        _ = try await fixture.start()
        XCTAssertGreaterThanOrEqual(ProcessInfo.processInfo.systemUptime - started, 2)
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - started, 11)
    }

    func testHTTPFixtureCreatesEmptyLedgerBeforeLaunchingPython() throws {
        let fixture = try PersistentHTTPFixture(receipt: PersistentHarness().receipt)
        defer { fixture.stop() }
        let metadata = try Data(contentsOf: fixture.directory.appendingPathComponent("requests.json"))
        let records = try XCTUnwrap(JSONSerialization.jsonObject(with: metadata) as? [[String: Any]])
        XCTAssertTrue(records.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.directory.appendingPathComponent("ready.json").path))
    }

    func testHTTPFixtureStartupTimeoutHasDistinctStageAndRemainsBounded() async throws {
        let fixture = try PersistentHTTPFixture(receipt: PersistentHarness().receipt, startupDelay: 4, readinessTimeout: 0.2)
        defer { fixture.stop() }
        let started = ProcessInfo.processInfo.systemUptime
        do { _ = try await fixture.start(); XCTFail("The deliberately delayed fixture must exceed its short readiness deadline") }
        catch let error as PersistentHTTPFixture.StartupError { XCTAssertEqual(error, .timedOut) }
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - started, 2)
    }

    func testHTTPFixturePublishesEmptyLedgerBeforeAnyRequest() async throws {
        let h = PersistentHarness()
        let fixture = try PersistentHTTPFixture(receipt: h.receipt)
        defer { fixture.stop() }
        _ = try await fixture.start()
        let metadata = try Data(contentsOf: fixture.directory.appendingPathComponent("requests.json"))
        let records = try XCTUnwrap(JSONSerialization.jsonObject(with: metadata) as? [[String: Any]])
        XCTAssertTrue(records.isEmpty, "A ready fixture must expose a valid empty ledger before the first HTTP request")
    }

    func testHealthyCookieEnrolsPersistedCredentialBeforeDispatch() async throws {
        let h = PersistentHarness()
        h.transport.live = h.receipt
        h.transport.beforeSubmit = { action in
            XCTAssertEqual(action, "enroll")
            XCTAssertNotNil(h.vault.value)
            XCTAssertFalse(h.vault.value!.enrolled)
        }
        let outcome1 = await h.coordinator.restore(in: h.origin)
        XCTAssertEqual(outcome1, .authenticated(h.receipt))
        XCTAssertEqual(h.transport.actions, ["enroll"])
        XCTAssertTrue(h.vault.value!.enrolled)
        XCTAssertEqual(h.transport.statusReads, 2)
    }

    func testVeryOldCredentialRestoresAfterProcessReconstruction() async throws {
        let h = PersistentHarness()
        h.vault.value = h.credential(enrolled: true)
        h.transport.live = .init(status: "signed_out")
        h.transport.submitted = h.receipt
        h.transport.afterSubmit = { h.transport.live = h.receipt }
        let fresh = h.newCoordinator()
        let outcome2 = await fresh.restore(in: h.origin)
        XCTAssertEqual(outcome2, .authenticated(h.receipt))
        XCTAssertEqual(h.transport.actions, ["renew"])
        XCTAssertEqual(try h.registry.selection(for: h.origin.url.absoluteString).storeIdentifier, h.selection.storeIdentifier)
    }

    func testResponseLossRetainsPendingSecretAndRecoversWithoutEnrolmentReplay() async throws {
        let h = PersistentHarness()
        h.transport.live = h.receipt
        h.transport.failure = URLError(.networkConnectionLost)
        let outcome3 = await h.coordinator.restore(in: h.origin)
        XCTAssertEqual(outcome3, .unavailable)
        XCTAssertNotNil(h.vault.value)
        h.transport.failure = nil
        h.transport.submitted = h.receipt
        let outcome4 = await h.newCoordinator().restore(in: h.origin)
        XCTAssertEqual(outcome4, .authenticated(h.receipt))
        XCTAssertEqual(h.transport.actions, ["enroll", "renew"])
    }

    func testTerminalRevocationDeletesCredentialAndNeverEnrolsAgain() async throws {
        let h = PersistentHarness()
        h.vault.value = h.credential(enrolled: true)
        h.transport.submitted = .init(status: "revoked")
        let outcome5 = await h.coordinator.restore(in: h.origin)
        XCTAssertEqual(outcome5, .needsLogin)
        XCTAssertNil(h.vault.value)
        XCTAssertEqual(h.transport.actions, ["renew"])
    }

    func testTransientAndLockedKeychainNeverBecomeSignedOut() async throws {
        let h = PersistentHarness()
        h.vault.value = h.credential(enrolled: true)
        h.transport.submitted = .init(status: "unavailable")
        let outcome6 = await h.coordinator.restore(in: h.origin)
        XCTAssertEqual(outcome6, .unavailable)
        XCTAssertNotNil(h.vault.value)
        h.vault.failure = DesktopDeviceCredentialError.keychainUnavailable
        let outcome7 = await h.coordinator.restore(in: h.origin)
        XCTAssertEqual(outcome7, .unavailable)
        XCTAssertNotNil(h.vault.value)
    }

    func testLostOrCorruptLocalCredentialRequiresFreshLogin() async throws {
        let h = PersistentHarness()
        h.vault.failure = DesktopDeviceCredentialError.invalidRecord
        let outcome = await h.coordinator.restore(in: h.origin)
        XCTAssertEqual(outcome, .needsLogin)
        XCTAssertEqual(h.transport.actions, [])
    }

    func testPersistedCredentialRejectsWrongLengthRenewalSecrets() throws {
        let h = PersistentHarness()
        for count in [32, 44] {
            let credential = DesktopDeviceCredential(origin: h.selection.origin, storeIdentifier: h.selection.storeIdentifier,
                epoch: h.selection.epoch, accountID: h.receipt.account_id!, userID: h.receipt.user_id!,
                sessionID: h.receipt.session_id!, secret: String(repeating: "s", count: count), enrolled: true)
            let corrupt = try JSONDecoder().decode(DesktopDeviceCredential.self, from: JSONEncoder().encode(credential))
            XCTAssertFalse(corrupt.matches(h.selection), "A JSON-valid corrupt capability must fail local validation before HTTP dispatch")
        }
        XCTAssertTrue(h.credential(enrolled: true).matches(h.selection))
    }

    func testSignOutRotatesPersistedStoreBeforeLateRenewalCanComplete() async throws {
        let h = PersistentHarness()
        h.vault.value = h.credential(enrolled: true)
        h.transport.suspend = true
        let running = Task { await h.coordinator.restore(in: h.origin) }
        while h.transport.pending == nil { await Task.yield() }
        try h.coordinator.signOut(in: h.origin)
        let after = try h.registry.selection(for: h.origin.url.absoluteString)
        XCTAssertNotEqual(after.storeIdentifier, h.selection.storeIdentifier)
        XCTAssertGreaterThan(after.epoch, h.selection.epoch)
        XCTAssertFalse(after.unresolved)
        XCTAssertNil(h.vault.value)
        h.transport.pending?.resume(returning: h.receipt); h.transport.pending = nil
        let outcome8 = await running.value
        XCTAssertEqual(outcome8, .cancelled)
        XCTAssertNil(h.vault.value)
    }

    func testWrongReadbackIdentityNeverOpensWorkspaceOrOverwritesCredential() async throws {
        let h = PersistentHarness()
        h.vault.value = h.credential(enrolled: true)
        h.transport.submitted = h.receipt
        h.transport.live = .init(status: "authenticated", account_id: UUID().uuidString, user_id: UUID().uuidString,
            session_id: UUID().uuidString, session_expires_at: h.receipt.session_expires_at)
        let outcome9 = await h.coordinator.restore(in: h.origin)
        XCTAssertEqual(outcome9, .unavailable)
        XCTAssertEqual(h.vault.value?.accountID, h.receipt.account_id)
    }

    func testConcurrentHostsShareOneRenewalAndIndependentReadback() async throws {
        let h = PersistentHarness()
        h.vault.value = h.credential(enrolled: true)
        h.transport.live = h.receipt; h.transport.suspend = true
        let first = Task { await h.coordinator.restore(in: h.origin) }
        while h.transport.pending == nil { await Task.yield() }
        let second = Task { await h.coordinator.restore(in: h.origin) }
        await Task.yield()
        XCTAssertEqual(h.transport.actions, ["renew"])
        h.transport.pending?.resume(returning: h.receipt); h.transport.pending = nil
        let firstResult = await first.value, secondResult = await second.value
        XCTAssertEqual(firstResult, .authenticated(h.receipt))
        XCTAssertEqual(secondResult, .authenticated(h.receipt))
        XCTAssertEqual(h.transport.statusReads, 1)
    }

    func testActualWorkspaceBrowserOwnsStartupRecoveryAndExpiryRetry() async throws {
        let h = PersistentHarness()
        h.vault.value = h.credential(enrolled: true)
        h.transport.submitted = h.receipt; h.transport.live = h.receipt
        let browser = WorkspaceBrowser(origin: h.origin, registry: h.registry, persistentSession: h.coordinator)
        for _ in 0..<100 where browser.restoringSession { await Task.yield() }
        XCTAssertEqual(h.transport.actions, ["renew"])
        XCTAssertFalse(browser.signedOut)
        XCTAssertFalse(browser.restoringSession)
        XCTAssertTrue(browser.enterSignedOut(at: h.origin.url.appendingPathComponent("login")))
        for _ in 0..<100 where browser.restoringSession { await Task.yield() }
        XCTAssertEqual(h.transport.actions, ["renew", "renew"])
        NotificationCenter.default.post(name: NSApplication.didBecomeActiveNotification, object: nil)
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(h.transport.actions, ["renew", "renew", "renew"])
        browser.retire()
    }

    func testActualBrowserRecoversInitialOutageOnForegroundWithoutManualRetry() async throws {
        let h = PersistentHarness()
        h.vault.value = h.credential(enrolled: true)
        h.transport.failure = URLError(.notConnectedToInternet)
        let browser = WorkspaceBrowser(origin: h.origin, registry: h.registry, persistentSession: h.coordinator)
        for _ in 0..<100 where browser.restoringSession { await Task.yield() }
        XCTAssertNotNil(browser.failure)
        XCTAssertFalse(browser.signedOut, "An outage does not establish sign-out")
        h.transport.failure = nil; h.transport.submitted = h.receipt; h.transport.live = h.receipt
        NotificationCenter.default.post(name: NSApplication.didBecomeActiveNotification, object: nil)
        for _ in 0..<100 { await Task.yield() }
        XCTAssertEqual(h.transport.actions, ["renew", "renew"])
        XCTAssertNil(browser.failure)
        XCTAssertFalse(browser.signedOut)
        XCTAssertTrue(browser.loading, "Foreground recovery dispatches the initial workspace load")
        browser.retire()
    }

    func testActualBrowserClearsOutageOverlayWhenRevocationIsConfirmed() async throws {
        let h = PersistentHarness()
        h.vault.value = h.credential(enrolled: true)
        h.transport.failure = URLError(.notConnectedToInternet)
        let browser = WorkspaceBrowser(origin: h.origin, registry: h.registry, persistentSession: h.coordinator)
        for _ in 0..<100 where browser.restoringSession { await Task.yield() }
        XCTAssertNotNil(browser.failure)
        h.transport.failure = nil; h.transport.submitted = .init(status: "revoked")
        NotificationCenter.default.post(name: NSApplication.didBecomeActiveNotification, object: nil)
        for _ in 0..<100 { await Task.yield() }
        XCTAssertTrue(browser.signedOut)
        XCTAssertFalse(browser.restoringSession)
        XCTAssertNil(browser.failure, "A confirmed revocation must expose browser login, not the old outage overlay")
        XCTAssertNil(h.vault.value)
        browser.retire()
    }

    func testFreshPrimaryLoginWaitsForPersistentEnrollmentBeforeWorkspaceAdmission() async throws {
        let h = PersistentHarness()
        let fresh = try h.registry.beginFreshPrimaryLogin(for: h.origin.url.absoluteString)
        let browser = WorkspaceBrowser(origin: h.origin, registry: h.registry, persistentSession: h.coordinator)
        defer { browser.retire() }
        h.transport.live = h.receipt; h.transport.suspend = true
        try h.registry.resolveLogin(for: fresh.origin, epoch: fresh.epoch)
        let target = h.origin.url.appendingPathComponent("workspace/sessions/\(UUID().uuidString)")
        browser.completeBrowserLogin(returnTarget: target)
        while h.transport.pending == nil { await Task.yield() }
        XCTAssertEqual(h.transport.actions, ["enroll"])
        XCTAssertTrue(browser.restoringSession)
        XCTAssertNil(browser.webView.url, "No business document can observe the pre-enrollment session binding")
        XCTAssertEqual(browser.loginReturnTarget, target)
        h.transport.pending?.resume(returning: h.receipt); h.transport.pending = nil
        for _ in 0..<100 where browser.restoringSession { await Task.yield() }
        XCTAssertFalse(browser.restoringSession)
        XCTAssertFalse(browser.signedOut)
        XCTAssertTrue(h.vault.value!.enrolled)
        XCTAssertEqual(browser.loginReturnTarget, target)
    }

    func testRealWKTransportPostsStrictOriginAndReadsJSONInSelectedStore() async throws {
        let h = PersistentHarness()
        let fixture = try PersistentHTTPFixture(receipt: h.receipt)
        defer { fixture.stop() }
        let origin = try await fixture.start()
        let registry = LoginStoreRegistry(persistence: MemoryLoginPersistence(), lockURL: fixture.directory.appendingPathComponent("registry.lock"))
        let selection = try registry.selection(for: origin.url.absoluteString)
        let credential = DesktopDeviceCredential(origin: selection.origin, storeIdentifier: selection.storeIdentifier, epoch: selection.epoch,
            accountID: h.receipt.account_id!, userID: h.receipt.user_id!, sessionID: h.receipt.session_id!,
            secret: String(repeating: "p", count: 43), enrolled: true)
        let transport = DesktopPersistentSessionWKTransport(origin: origin, registry: registry)
        defer { transport.cancel() }
        let posted = try await transport.submit("renew", credential: credential, selection: selection)
        XCTAssertEqual(posted, h.receipt)
        let live = try await transport.status(selection: selection)
        XCTAssertEqual(live, h.receipt, "Independent GET requires the synthetic HttpOnly cookie installed by POST")
        let evidence = try JSONSerialization.jsonObject(with: Data(contentsOf: fixture.directory.appendingPathComponent("requests.json"))) as! [[String: Any]]
        XCTAssertEqual(evidence.count, 2)
        XCTAssertEqual(evidence[0]["origin"] as? String, origin.url.absoluteString)
        XCTAssertEqual(evidence[0]["native_header"] as? String, "1")
        XCTAssertEqual(evidence[0]["content_type"] as? String, "application/json")
        XCTAssertEqual(evidence[1]["cookie_present"] as? Bool, true)
    }

    func testMenuBarCaptureContextRenewsAndRetriesOnlyTheRead() async throws {
        let h = PersistentHarness()
        let fixture = try PersistentHTTPFixture(receipt: h.receipt)
        defer { fixture.stop() }
        let origin = try await fixture.start()
        let registry = LoginStoreRegistry(persistence: MemoryLoginPersistence(), lockURL: fixture.directory.appendingPathComponent("registry.lock"))
        let selection = try registry.selection(for: origin.url.absoluteString)
        let vault = MemoryCredentialVault()
        vault.value = DesktopDeviceCredential(origin: selection.origin, storeIdentifier: selection.storeIdentifier, epoch: selection.epoch,
            accountID: h.receipt.account_id!, userID: h.receipt.user_id!, sessionID: h.receipt.session_id!,
            secret: String(repeating: "p", count: 43), enrolled: true)
        let persistent = DesktopPersistentSessionCoordinator(registry: registry, vault: vault)
        let capture = CaptureWebSession(origin: origin, registry: registry, persistentSession: persistent, originProvider: { origin })
        defer { capture.retire() }
        let context = try await capture.context()
        XCTAssertEqual(context.workspaceAccountID, h.receipt.account_id)
        XCTAssertEqual(context.origin, origin.url.absoluteString)
        // Simulate the short cookie expiring while the menu-bar host remains
        // alive, without changing a real account or the resident service.
        let dataStore = WKWebsiteDataStore(forIdentifier: selection.storeIdentifier)
        defer { withExtendedLifetime(dataStore) {} }
        let cookieStore = dataStore.httpCookieStore
        let cookies: [HTTPCookie] = await withCheckedContinuation { continuation in cookieStore.getAllCookies { continuation.resume(returning: $0) } }
        for cookie in cookies where cookie.name == "capri-persistent-proof" {
            await withCheckedContinuation { continuation in cookieStore.delete(cookie) { continuation.resume() } }
        }
        let restored = try await capture.context()
        XCTAssertEqual(restored.workspaceAccountID, context.workspaceAccountID)
        let ledger = try JSONSerialization.jsonObject(with: Data(contentsOf: fixture.directory.appendingPathComponent("requests.json"))) as! [[String: Any]]
        let contextReads = ledger.filter { $0["path"] as? String == "/api/desktop-capture/context" }
        XCTAssertEqual(contextReads.count, 3)
        XCTAssertEqual(contextReads[1]["cookie_present"] as? Bool, false)
        XCTAssertEqual(contextReads.last?["cookie_present"] as? Bool, true)
        let posts = ledger.filter { $0["method"] as? String == "POST" }
        XCTAssertEqual(posts.count, 2)
        XCTAssertTrue(posts.allSatisfy { $0["path"] as? String == "/api/desktop-auth/persistent" }, "No capture upload/admission is replayed")
    }

    func testHealthyMenuBarOnlyCookieEnrollsBeforeFirstCaptureContextRead() async throws {
        for unresolvedDuringConstruction in [false, true] {
            let h = PersistentHarness()
            let fixture = try PersistentHTTPFixture(receipt: h.receipt)
            defer { fixture.stop() }
            let origin = try await fixture.start()
            let registry = LoginStoreRegistry(persistence: MemoryLoginPersistence(), lockURL: fixture.directory.appendingPathComponent("registry.lock"))
            let selection = try (unresolvedDuringConstruction
                ? registry.beginFreshPrimaryLogin(for: origin.url.absoluteString)
                : registry.selection(for: origin.url.absoluteString))
            let dataStore = WKWebsiteDataStore(forIdentifier: selection.storeIdentifier)
            defer { withExtendedLifetime(dataStore) {} }
            let store = dataStore.httpCookieStore
            let cookie = HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "capri-persistent-proof",
                .value: "1", .expires: Date().addingTimeInterval(3600)])!
            await withCheckedContinuation { continuation in store.setCookie(cookie) { continuation.resume() } }
            let seeded: [HTTPCookie] = await withCheckedContinuation { continuation in store.getAllCookies { continuation.resume(returning: $0) } }
            XCTAssertTrue(seeded.contains { $0.name == "capri-persistent-proof" }, "The synthetic healthy-cookie precondition must be read back before product execution")
            let vault = MemoryCredentialVault()
            let persistent = DesktopPersistentSessionCoordinator(registry: registry, vault: vault)
            let capture = CaptureWebSession(origin: origin, registry: registry, persistentSession: persistent, originProvider: { origin })
            defer { capture.retire() }
            if unresolvedDuringConstruction {
                for _ in 0..<20 { await Task.yield() }
                try registry.resolveLogin(for: selection.origin, epoch: selection.epoch)
            }
            let context = try await capture.context()
            XCTAssertEqual(context.workspaceAccountID, h.receipt.account_id)
            XCTAssertTrue(vault.value!.enrolled)
            let ledger = try JSONSerialization.jsonObject(with: Data(contentsOf: fixture.directory.appendingPathComponent("requests.json"))) as! [[String: Any]]
            let enroll = try XCTUnwrap(ledger.firstIndex { $0["action"] as? String == "enroll" })
            let contextRead = try XCTUnwrap(ledger.firstIndex { $0["path"] as? String == "/api/desktop-capture/context" })
            XCTAssertLessThan(enroll, contextRead)
            XCTAssertTrue(ledger[..<contextRead].contains { $0["method"] as? String == "GET" && $0["path"] as? String == "/api/desktop-auth/persistent" })
        }
    }

    func testMenuBarCaptureTransientRenewalIsUnavailableWhileRevocationIsSignedOut() async throws {
        for status in ["unavailable", "revoked"] {
            let h = PersistentHarness()
            let fixture = try PersistentHTTPFixture(receipt: h.receipt)
            defer { fixture.stop() }
            let origin = try await fixture.start()
            let registry = LoginStoreRegistry(persistence: MemoryLoginPersistence(), lockURL: fixture.directory.appendingPathComponent("registry.lock"))
            let selection = try registry.selection(for: origin.url.absoluteString)
            let vault = MemoryCredentialVault()
            vault.value = DesktopDeviceCredential(origin: selection.origin, storeIdentifier: selection.storeIdentifier, epoch: selection.epoch,
                accountID: h.receipt.account_id!, userID: h.receipt.user_id!, sessionID: h.receipt.session_id!,
                secret: String(repeating: "p", count: 43), enrolled: true)
            h.transport.submitted = .init(status: status)
            let persistent = DesktopPersistentSessionCoordinator(registry: registry, vault: vault, transportFactory: { _ in h.transport })
            let capture = CaptureWebSession(origin: origin, registry: registry, persistentSession: persistent, originProvider: { origin })
            defer { capture.retire() }
            do { _ = try await capture.context(); XCTFail("Expected capture context recovery to stop") }
            catch let error as CaptureTransportError {
                if status == "unavailable" {
                    XCTAssertEqual(error, .unavailable)
                    XCTAssertNotNil(vault.value)
                } else {
                    XCTAssertEqual(error, .server(401, "backend_session_expired"))
                    XCTAssertNil(vault.value)
                }
            }
            let ledgerData = (try? Data(contentsOf: fixture.directory.appendingPathComponent("requests.json"))) ?? Data("[]".utf8)
            let ledger = try JSONSerialization.jsonObject(with: ledgerData) as! [[String: Any]]
            XCTAssertEqual(ledger.filter { $0["path"] as? String == "/api/desktop-capture/context" }.count, status == "unavailable" ? 0 : 1)
        }
    }
}

@MainActor
private final class PersistentHarness {
    let origin = WorkspaceOrigin("https://persistent-session.test")!
    let registry: LoginStoreRegistry
    let selection: LoginStoreSelection
    let vault = MemoryCredentialVault()
    let transport = FakePersistentTransport()
    let receipt = DesktopPersistentSessionReceipt(status: "authenticated", account_id: UUID().uuidString,
        user_id: UUID().uuidString, session_id: UUID().uuidString,
        session_expires_at: ISO8601DateFormatter().string(from: Date().addingTimeInterval(28800)))
    lazy var coordinator = newCoordinator()
    init() {
        registry = LoginStoreRegistry(persistence: MemoryLoginPersistence(),
            lockURL: FileManager.default.temporaryDirectory.appendingPathComponent("persistent-test-\(UUID().uuidString).lock"))
        selection = try! registry.selection(for: origin.url.absoluteString)
    }
    func credential(enrolled: Bool) -> DesktopDeviceCredential {
        .init(origin: origin.url.absoluteString, storeIdentifier: selection.storeIdentifier, epoch: selection.epoch,
            accountID: receipt.account_id!, userID: receipt.user_id!, sessionID: receipt.session_id!,
            secret: String(repeating: "s", count: 43), enrolled: enrolled)
    }
    func newCoordinator() -> DesktopPersistentSessionCoordinator {
        DesktopPersistentSessionCoordinator(registry: registry, vault: vault, transportFactory: { _ in self.transport })
    }
}

private final class MemoryLoginPersistence: LoginStoreRegistryPersisting {
    var data: Data?
    func read() throws -> Data? { data }
    func write(_ data: Data) throws { self.data = data }
}
private final class MemoryCredentialVault: DesktopDeviceCredentialStoring {
    var value: DesktopDeviceCredential?
    var failure: Error?
    func read(for selection: LoginStoreSelection) throws -> DesktopDeviceCredential? {
        if let failure { throw failure }; return value?.matches(selection) == true ? value : nil
    }
    func write(_ credential: DesktopDeviceCredential, for selection: LoginStoreSelection) throws {
        if let failure { throw failure }; value = credential
    }
    func remove(for selection: LoginStoreSelection) throws { if let failure { throw failure }; value = nil }
}
@MainActor
private final class FakePersistentTransport: DesktopPersistentSessionTransporting {
    var live = DesktopPersistentSessionReceipt(status: "signed_out")
    var submitted: DesktopPersistentSessionReceipt?
    var actions: [String] = []
    var statusReads = 0
    var beforeSubmit: ((String) -> Void)?
    var afterSubmit: (() -> Void)?
    var failure: Error?
    var suspend = false
    var pending: CheckedContinuation<DesktopPersistentSessionReceipt, Never>?
    func status(selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt {
        statusReads += 1; return live
    }
    func submit(_ action: String, credential: DesktopDeviceCredential, selection: LoginStoreSelection) async throws -> DesktopPersistentSessionReceipt {
        actions.append(action); beforeSubmit?(action)
        if action == "revoke" { return .init(status: "revoked") }
        if suspend { return await withCheckedContinuation { pending = $0 } }
        if let failure { throw failure }
        afterSubmit?(); return submitted ?? live
    }
    func cancel() {}
}

/// An owned loopback fixture exercises actual WK POST navigation, its Origin
/// header, JSON-document readback and shared persistent-cookie installation.
/// Its retained ledger contains metadata only, never the submitted secret.
@MainActor
private final class PersistentHTTPFixture {
    enum StartupError: Error, Equatable, CustomStringConvertible {
        case couldNotLaunch, exitedBeforeReady(Int32), invalidReadiness, timedOut
        var description: String {
            switch self {
            case .couldNotLaunch: return "persistent_http_fixture_startup_launch_failed"
            case .exitedBeforeReady(let code): return "persistent_http_fixture_startup_exited_\(code)"
            case .invalidReadiness: return "persistent_http_fixture_startup_invalid_readiness"
            case .timedOut: return "persistent_http_fixture_startup_timed_out"
            }
        }
    }
    let directory: URL
    private let process = Process()
    private let receipt: DesktopPersistentSessionReceipt
    private let startupDelay: TimeInterval
    private let readinessTimeout: TimeInterval
    init(receipt: DesktopPersistentSessionReceipt, startupDelay: TimeInterval = 0, readinessTimeout: TimeInterval = 10) throws {
        self.receipt = receipt
        self.startupDelay = startupDelay
        self.readinessTimeout = readinessTimeout
        let root = ProcessInfo.processInfo.environment["MACOS_PERSISTENT_PROOF_ARTIFACTS"].map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.temporaryDirectory
        directory = root.appendingPathComponent("persistent-http-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("[]".utf8).write(to: directory.appendingPathComponent("requests.json"), options: .atomic)
    }
    func start() async throws -> WorkspaceOrigin {
        let body: [String: String] = ["status": receipt.status, "account_id": receipt.account_id!, "user_id": receipt.user_id!,
                                    "session_id": receipt.session_id!, "session_expires_at": receipt.session_expires_at!]
        let script = #"""
import sys,time
time.sleep(float(sys.argv[3]))
import http.server,json,pathlib
from datetime import datetime,timezone,timedelta
root=pathlib.Path(sys.argv[1]); response=json.loads(sys.argv[2]); records=[]; enrolled_secret=None
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def answer(self,status,payload,cookie=False):
  records[-1]['status']=status;(root/'requests.json').write_text(json.dumps(records))
  data=json.dumps(payload).encode(); self.send_response(status)
  self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)))
  self.send_header('Cache-Control','no-store')
  if cookie:self.send_header('Set-Cookie','capri-persistent-proof=1; HttpOnly; SameSite=Lax; Path=/')
  self.end_headers();self.wfile.write(data)
 def record(self):
  records.append({'method':self.command,'path':self.path,'origin':self.headers.get('Origin'),
   'native_header':self.headers.get('x-capri-desktop-session'),'content_type':self.headers.get('Content-Type'),
   'cookie_present':'capri-persistent-proof=1' in self.headers.get('Cookie','')})
  (root/'requests.json').write_text(json.dumps(records))
 def do_POST(self):
  global enrolled_secret
  self.record(); data=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
  records[-1]['action']=data.get('action');(root/'requests.json').write_text(json.dumps(records))
  expected='http://127.0.0.1:'+str(self.server.server_port)
  if self.headers.get('Origin')!=expected or self.headers.get('x-capri-desktop-session')!='1' or self.headers.get('Content-Type')!='application/json':
   return self.answer(403,{'status':'ineligible'})
  if data.get('action')=='enroll':
   if 'capri-persistent-proof=1' not in self.headers.get('Cookie','') or len(data.get('device_secret',''))!=43:return self.answer(403,{'status':'ineligible'})
   enrolled_secret=data['device_secret']
  elif data.get('action')!='renew' or data.get('device_secret')!=(enrolled_secret or 'p'*43):return self.answer(401,{'status':'revoked'})
  self.answer(200,response,True)
 def do_GET(self):
  self.record()
  if self.path=='/api/desktop-capture/host':
   records[-1]['status']=200;(root/'requests.json').write_text(json.dumps(records))
   data=b'<!doctype html><html><body></body></html>';self.send_response(200)
   self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(data)))
   self.send_header('Content-Security-Policy',"default-src 'none'; connect-src 'self'")
   self.end_headers();self.wfile.write(data);return
  if self.path=='/api/desktop-capture/context':
   if 'capri-persistent-proof=1' not in self.headers.get('Cookie',''):return self.answer(401,{'code':'backend_session_expired'})
   return self.answer(200,{'protocol_version':1,'owner_scope':'synthetic-owner','workspace_account_id':response['account_id'],
    'login_binding':'synthetic-binding','expires_at':(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat(),
    'processing':{'policy_version':'synthetic-policy','workspace_label':'Synthetic proof','processor_labels':['Synthetic processor'],
     'source_retention_days':30,'available':True}})
  if 'capri-persistent-proof=1' not in self.headers.get('Cookie',''):return self.answer(401,{'status':'signed_out'})
  self.answer(200,response)
server=http.server.HTTPServer(('127.0.0.1',0),Handler)
(root/'ready.tmp').write_text(json.dumps({'port':server.server_port}))
(root/'ready.tmp').replace(root/'ready.json')
server.serve_forever()
"""#
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = ["-c", script, directory.path, String(data: try JSONSerialization.data(withJSONObject: body), encoding: .utf8)!, String(startupDelay)]
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        let started = ProcessInfo.processInfo.systemUptime
        var startupStatus = "waiting"
        defer { attachStartupMetadata(started: started, status: Task.isCancelled ? "cancelled" : startupStatus) }
        do { try process.run() }
        catch { startupStatus = "launch_failed"; throw StartupError.couldNotLaunch }
        let deadline = started + readinessTimeout
        let ready = directory.appendingPathComponent("ready.json")
        while ProcessInfo.processInfo.systemUptime < deadline {
            if FileManager.default.fileExists(atPath: ready.path) {
                guard let data = try? Data(contentsOf: ready),
                      let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Int],
                      let port = parsed["port"], (1...65535).contains(port),
                      let origin = WorkspaceOrigin("http://127.0.0.1:\(port)", allowLocalDevelopment: true)
                else { startupStatus = "invalid_readiness"; throw StartupError.invalidReadiness }
                startupStatus = "ready"
                return origin
            }
            guard process.isRunning else {
                startupStatus = "exited_before_ready_\(process.terminationStatus)"
                throw StartupError.exitedBeforeReady(process.terminationStatus)
            }
            try await Task.sleep(for: .milliseconds(20))
        }
        startupStatus = "timed_out"
        throw StartupError.timedOut
    }

    private func attachStartupMetadata(started: TimeInterval, status: String) {
        let metadata: [String: Any] = [
            "process_running": process.isRunning,
            "ready": FileManager.default.fileExists(atPath: directory.appendingPathComponent("ready.json").path),
            "ledger": FileManager.default.fileExists(atPath: directory.appendingPathComponent("requests.json").path),
            "elapsed_ms": max(0, Int((ProcessInfo.processInfo.systemUptime - started) * 1000)),
            "status": status,
        ]
        let attachment = XCTAttachment(data: try! JSONSerialization.data(withJSONObject: metadata), uniformTypeIdentifier: "public.json")
        attachment.name = "persistent-http-startup-metadata"
        attachment.lifetime = .keepAlways
        XCTContext.runActivity(named: "Persistent HTTP fixture startup") { $0.add(attachment) }
    }
    func stop() {
        if process.isRunning { process.terminate(); process.waitUntilExit() }
        // Cloud failures must retain the observed native navigation/fetch
        // sequence before this owned fixture directory is removed. The ledger
        // deliberately contains metadata only, never request bodies or secrets.
        let ledgerURL = directory.appendingPathComponent("requests.json")
        if FileManager.default.fileExists(atPath: ledgerURL.path),
           let metadata = try? Data(contentsOf: ledgerURL), metadata.count <= 65_536,
           let records = (try? JSONSerialization.jsonObject(with: metadata)) as? [[String: Any]] {
            let permitted: Set<String> = ["method", "path", "status", "action", "origin", "cookie_present"]
            let bounded = records.prefix(32).map { record in
                record.filter { permitted.contains($0.key) }
            }
            let attachment = XCTAttachment(data: try! JSONSerialization.data(withJSONObject: bounded), uniformTypeIdentifier: "public.json")
            attachment.name = "persistent-http-sanitized-request-metadata"
            attachment.lifetime = .keepAlways
            XCTContext.runActivity(named: "Persistent HTTP transport metadata") { $0.add(attachment) }
        }
        if ProcessInfo.processInfo.environment["MACOS_PERSISTENT_PROOF_ARTIFACTS"] == nil { try? FileManager.default.removeItem(at: directory) }
    }
}
