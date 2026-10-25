import Foundation
import Security
import XCTest
@testable import TalentSignal

@MainActor
final class AppSessionEndingTests: XCTestCase {
    private let endpoint = URL(string: "https://session-ending-" + UUID().uuidString.lowercased() + ".example.test")!
    private func session(token: String = "synthetic-original") -> TalentSignalSession {
        .init(baseURL: endpoint, accessToken: token, expiresAt: Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970) + 3600),
            account: .init(id: "fixture-account", slug: "fixture-account", name: "Synthetic account"),
            user: .init(id: "fixture-user", email: "fixture@example.test", displayName: "Synthetic user", kind: "simulated_human"))
    }
    func testRecoveryAttentionEndsOnlyAfterVerifiedRetry() async throws {
        let saved = session(), local = EndingSessionMemory(), journal = MemoryAppSessionEndings(), client = EndingAuthentication()
        local.value = saved; client.response = saved; client.logoutFailure = URLError(.notConnectedToInternet)
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: journal)
        await store.restore()
        let ending = await store.signOut()
        let result = try XCTUnwrap(ending)
        XCTAssertTrue(store.needsSignOutRecovery)
        client.logoutFailure = nil
        await store.retrySignOut(result.id)
        XCTAssertFalse(store.needsSignOutRecovery)
        XCTAssertNil(store.notice, "Successful sign-out must leave the ordinary login quiet")
        XCTAssertEqual(store.endingReceipts.count, 1, "History remains available in recovery tools")
    }

    func testSignOutClearsCalendarDetailsButPreservesUncertainWriteGuard() async throws {
        let saved = session(), local = EndingSessionMemory(), journal = MemoryAppSessionEndings(), client = EndingAuthentication()
        local.value = saved; client.response = saved
        let scope = RuntimeEndpoint.scope(saved.baseURL, accountID: saved.account.id, userID: saved.user.id)
        let directory = RuntimeScopedDirectories.directory("CalendarWriteAttempts", scope: scope)
        defer { try? FileManager.default.removeItem(at: directory) }
        let receipts = DeviceCalendarReceiptStore(scope: scope), source = UUID().uuidString
        XCTAssertTrue(receipts.recordSaved(sourceID: source, eventIdentifier: "synthetic-event"))
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: journal)
        await store.restore(); let result = await store.signOut()
        XCTAssertTrue(result?.settled == true)
        XCTAssertNil(receipts.receipt(for: source)); XCTAssertTrue(receipts.hasPendingWrite(for: source))
    }

    func testUnreadableRecoveryJournalRetainsRecoveryEntry() async {
        let journal = MemoryAppSessionEndings()
        journal.failsLoad = true
        let store = AppSessionStore(baseURL: endpoint, persistence: EndingSessionMemory(),
            client: EndingAuthentication(), endings: journal)
        await store.restore()
        XCTAssertTrue(store.needsSignOutRecovery)
        XCTAssertEqual(store.phase, .restoring, "An unreadable protected journal withholds content without asking for a new login")
        journal.failsLoad = false
        store.refreshSignOutReceipts()
        XCTAssertFalse(store.needsSignOutRecovery)
    }

    func testLateValidationCannotReopenSignedOutSession() async throws {
        let saved = session(), local = EndingSessionMemory(), journal = MemoryAppSessionEndings(), client = EndingAuthentication()
        local.value = saved; client.response = saved; client.suspendsValidation = true
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: journal)
        let restoring = Task { await store.restore() }
        let deadline = Date().addingTimeInterval(5)
        while client.validation == nil && Date() < deadline { await Task.yield() }
        guard client.validation != nil else { restoring.cancel(); XCTFail("Validation did not reach the expected suspension within 5 seconds"); return }
        XCTAssertEqual(store.phase, .signedIn(saved))
        let generation = store.contextGeneration
        let result = await store.signOut()
        XCTAssertEqual(result?.local, .removed); XCTAssertEqual(result?.remote, .revoked)
        XCTAssertNotEqual(store.contextGeneration, generation)
        client.validation?.resume(returning: saved); client.validation = nil
        await restoring.value
        XCTAssertEqual(store.phase, .signedOut); XCTAssertNil(local.value)
        XCTAssertNil(journal.values.first?.credential)
    }
    func testIntentBeforeEffectsSurvivesRelaunchAndNeverRestoresOfflineContent() async throws {
        let saved = session(), local = EndingSessionMemory(), journal = MemoryAppSessionEndings(), client = EndingAuthentication()
        local.value = saved; local.failsDelete = true; client.response = saved; client.logoutFailure = URLError(.notConnectedToInternet)
        let first = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: journal)
        await first.restore(); let ending = await first.signOut(); let result = try XCTUnwrap(ending)
        XCTAssertEqual(result.local, .failed); XCTAssertEqual(result.remote, .unverified)
        XCTAssertEqual(first.phase, .signedOut); XCTAssertNotNil(local.value)
        let restored = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: journal)
        let validationCount = client.validations
        await restored.restore()
        XCTAssertEqual(restored.phase, .signedOut); XCTAssertEqual(client.validations, validationCount)
        let closedGeneration = restored.contextGeneration
        local.failsDelete = false; client.logoutFailure = nil
        let completed = await restored.retrySignOut(result.id)
        XCTAssertEqual(completed?.id, result.id); XCTAssertEqual(completed?.local, .removed)
        XCTAssertEqual(completed?.remote, .revoked); XCTAssertNil(local.value)
        XCTAssertEqual(restored.contextGeneration, closedGeneration, "Retry keeps its already signed-out recovery screen mounted")
    }
    func testRetryOldEndingPreservesNewerSignInAndCredential() async throws {
        let saved = session(), local = EndingSessionMemory(), journal = MemoryAppSessionEndings(), client = EndingAuthentication()
        local.value = saved; client.response = saved; client.logoutFailure = URLError(.notConnectedToInternet)
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: journal)
        await store.restore(); let ending = await store.signOut(); let previous = try XCTUnwrap(ending)
        let newer = session(token: "synthetic-newer")
        client.response = newer
        await store.signIn(identityToken: Data("synthetic-identity".utf8), fullName: nil)
        XCTAssertEqual(store.phase, .signedIn(newer))
        let generation = store.contextGeneration, deletions = local.deletions
        client.logoutFailure = nil
        let result = await store.retrySignOut(previous.id)
        XCTAssertEqual(result?.remote, .revoked)
        XCTAssertEqual(store.phase, .signedIn(newer)); XCTAssertEqual(local.value, newer)
        XCTAssertEqual(store.contextGeneration, generation); XCTAssertEqual(local.deletions, deletions)
        XCTAssertEqual(client.loggedOutTokens, [saved.accessToken, saved.accessToken])
    }
    func testInterruptedPersistenceResumesSameOperationWithoutRepeatingUnissuedLogout() async throws {
        let saved = session(), local = EndingSessionMemory(), journal = MemoryAppSessionEndings(), client = EndingAuthentication()
        local.value = saved; client.response = saved; journal.failAt = [2]
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: journal)
        await store.restore(); let ending = await store.signOut(); XCTAssertNil(ending)
        XCTAssertEqual(store.phase, .signedOut); XCTAssertNil(local.value)
        XCTAssertEqual(client.loggedOutTokens.count, 0)
        let id = try XCTUnwrap(journal.values.first?.id)
        journal.failAt = []
        let result = await store.retrySignOut(id)
        XCTAssertEqual(result?.id, id); XCTAssertEqual(result?.remote, .revoked)
        XCTAssertEqual(journal.values.count, 1); XCTAssertEqual(client.loggedOutTokens.count, 1)
    }
    func testLostFinalReceiptUsesSessionInvalidReadbackOnRetry() async throws {
        let saved = session(), local = EndingSessionMemory(), journal = MemoryAppSessionEndings(), client = EndingAuthentication()
        local.value = saved; client.response = saved; journal.failAt = [3]
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: journal)
        await store.restore(); let ending = await store.signOut(); XCTAssertNil(ending)
        XCTAssertEqual(client.loggedOutTokens.count, 1)
        let id = try XCTUnwrap(journal.values.first?.id)
        journal.failAt = []; client.logoutFailure = AppSessionError.backend(status: 401, code: "SESSION_INVALID", message: "synthetic")
        let result = await store.retrySignOut(id)
        XCTAssertEqual(result?.remote, .alreadyInvalid); XCTAssertNil(journal.values.first?.credential)
    }
    func testMaintenanceRejectsUnrelatedWritesRecordingAndStalePermit() throws {
        let registry = RuntimeWorkRegistry.shared
        let permit = try registry.beginMaintenance()
        defer { registry.endMaintenance(permit) }
        XCTAssertThrowsError(try registry.beginWrite())
        XCTAssertThrowsError(try registry.begin(.recording))
        XCTAssertThrowsError(try registry.beginWrite(maintenance: UUID()))
        registry.endTransition()
        XCTAssertThrowsError(try registry.beginWrite(), "An unrelated transition cannot release maintenance")
        let owned = try registry.beginWrite(maintenance: permit); registry.end(owned)
    }
    func testKeychainJournalExpiryAndTargetedRemovalPreserveAnotherCredential() throws {
        let service = "com.talentsignal.test-ending." + UUID().uuidString
        defer { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary) }
        let stored = KeychainTalentSignalSessionStore(baseURL: endpoint, service: service)
        let old = session(), newer = session(token: "synthetic-newer")
        try stored.save(old); try stored.save(newer)
        XCTAssertTrue(try stored.removeMatching(old)); XCTAssertEqual(try stored.load(), newer)
        let endings = KeychainAppSessionEndingStore(endpoint: endpoint, service: service)
        var record = AppSessionEnding(session: old)
        try endings.save([record]); XCTAssertEqual(try endings.load().first?.credential, old)
        record.credential = nil; record.local = .removed; record.remote = .revoked
        try endings.save([record]); XCTAssertNil(try endings.load().first?.credential)
        XCTAssertEqual(try stored.load(), newer)
        let expired = TalentSignalSession(baseURL: endpoint, accessToken: "expired", expiresAt: Date() - 1, account: old.account, user: old.user)
        try endings.save([AppSessionEnding(session: expired)])
        XCTAssertEqual(try endings.load().first?.remote, .expired)
        XCTAssertNil(try endings.load().first?.credential)
    }

    func testRemovalFindsOldIdentityAfterRevocationCredentialWasDiscarded() throws {
        let service = "com.talentsignal.test-ending." + UUID().uuidString
        defer { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary) }
        let stored = KeychainTalentSignalSessionStore(baseURL: endpoint, service: service)
        let old = session(), newer = TalentSignalSession(baseURL: endpoint, accessToken: "new-account-token",
            expiresAt: old.expiresAt, account: .init(id: "second-account", slug: "fixture-second", name: "Second fixture"), user: old.user)
        try stored.save(newer)
        var ending = AppSessionEnding(session: old)
        ending.credential = nil; ending.remote = .revoked; ending.local = .failed
        // A previous identity may remain after its pointer changed and cleanup
        // failed. Its removal cannot depend on the active pointer or raw token.
        let key = "environment." + RuntimeEndpoint.scope(endpoint) + ".identity." + ending.identityFingerprint
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: key]
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        XCTAssertEqual(SecItemAdd(query.merging([kSecValueData as String: try encoder.encode(old)]) { _, new in new } as CFDictionary, nil), errSecSuccess)
        XCTAssertTrue(try stored.removeEndingCredential(ending))
        XCTAssertEqual(SecItemCopyMatching(query as CFDictionary, nil), errSecItemNotFound)
        XCTAssertEqual(try stored.load()?.accessToken, newer.accessToken)
    }

    func testIntentFailureAndActiveWorkKeepCurrentAccountUntouched() async throws {
        let local = EndingSessionMemory(), journal = MemoryAppSessionEndings(), client = EndingAuthentication(), saved = session()
        local.value = saved; client.response = saved
        var closedCount = 0
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: journal,
            closeSessionSurfaces: { closedCount += 1 })
        await store.restore()
        let generation = store.contextGeneration
        journal.failAt = [1]
        let denied = await store.signOut()
        XCTAssertNil(denied); XCTAssertEqual(store.phase, .signedIn(saved)); XCTAssertEqual(local.deletions, 0)
        XCTAssertEqual(store.contextGeneration, generation); XCTAssertEqual(closedCount, 0)
        journal.failAt = []
        let recording = try RuntimeWorkRegistry.shared.begin(.recording)
        let blocked = await store.signOut()
        RuntimeWorkRegistry.shared.end(recording)
        XCTAssertNil(blocked); XCTAssertTrue(journal.values.isEmpty); XCTAssertEqual(client.loggedOutTokens.count, 0)
        await store.signOut(); XCTAssertEqual(closedCount, 1)
    }

    func testMaintenancePermitOnlyReachesLogoutThroughActualNetworking() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [EndingURLProtocol.self]
        let network = URLSession(configuration: config)
        defer { network.invalidateAndCancel() }
        let registry = RuntimeWorkRegistry.shared, permit = try RuntimeWorkRegistry.shared.beginMaintenance()
        defer { registry.endMaintenance(permit) }
        var logout = URLRequest(url: endpoint.appending(path: "v1/auth/logout")); logout.httpMethod = "POST"
        let response = try await RuntimeMaintenanceContext.$logoutPermit.withValue(permit) {
            try await TalentSignalNetworking.data(for: logout, using: network)
        }
        XCTAssertEqual((response.1 as? HTTPURLResponse)?.statusCode, 200)
        var business = URLRequest(url: endpoint.appending(path: "v1/chat")); business.httpMethod = "POST"
        do {
            _ = try await RuntimeMaintenanceContext.$logoutPermit.withValue(permit) {
                try await TalentSignalNetworking.data(for: business, using: network)
            }
            XCTFail("Maintenance permit must not authorize a business request")
        } catch { XCTAssertTrue(error is RuntimeEnvironmentError) }
        do { _ = try await TalentSignalNetworking.data(for: logout, using: network); XCTFail("Unowned logout must remain blocked") }
        catch { XCTAssertTrue(error is RuntimeEnvironmentError) }
    }
}

private final class EndingURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class MemoryAppSessionEndings: AppSessionEndingPersisting {
    var values: [AppSessionEnding] = []
    var writes = 0
    var failAt = Set<Int>()
    var failsLoad = false
    func load() throws -> [AppSessionEnding] {
        if failsLoad { throw AppSessionEndingError.unreadable }
        return values
    }
    func save(_ values: [AppSessionEnding]) throws {
        writes += 1
        if failAt.contains(writes) { throw CocoaError(.fileWriteNoPermission) }
        self.values = values
    }
}
private final class EndingSessionMemory: TalentSignalSessionPersisting {
    var value: TalentSignalSession?
    var failsDelete = false
    var deletions = 0
    func load() throws -> TalentSignalSession? { value }
    func save(_ value: TalentSignalSession) throws { self.value = value }
    func delete() throws { deletions += 1; if failsDelete { throw CocoaError(.fileWriteNoPermission) }; value = nil }
}
private final class EndingAuthentication: AppAuthenticationServing {
    var response: TalentSignalSession?
    var logoutFailure: Error?
    var loggedOutTokens: [String] = []
    var suspendsValidation = false
    var validations = 0
    var validation: CheckedContinuation<TalentSignalSession, Error>?
    func challenge() async throws -> AppleLoginChallenge {
        .init(contractVersion: TalentSignalAPIContract.version, id: "fixture-challenge", nonce: "fixture", expiresAt: Date() + 300)
    }
    func signIn(identityToken: String, challengeID: String, givenName: String?, familyName: String?) async throws -> TalentSignalSession { response! }
    func validate(_ stored: TalentSignalSession) async throws -> TalentSignalSession {
        validations += 1
        if suspendsValidation { return try await withCheckedThrowingContinuation { validation = $0 } }
        return stored
    }
    func logout(_ stored: TalentSignalSession) async throws { loggedOutTokens.append(stored.accessToken); if let logoutFailure { throw logoutFailure } }
}

final class AuthenticationWelcomeGestureTests: XCTestCase {
    func testPullTracksDirectlyThenResistsOverpullWithoutOvershoot() {
        XCTAssertEqual(AuthenticationWelcomeGesture.progress(pull: -20, travel: 200), 0)
        XCTAssertEqual(AuthenticationWelcomeGesture.progress(pull: 30, travel: 200), 0.15, accuracy: 0.001)
        XCTAssertEqual(AuthenticationWelcomeGesture.progress(pull: 124, travel: 200), 0.62, accuracy: 0.001)
        let longPull = AuthenticationWelcomeGesture.progress(pull: 200, travel: 200)
        let overpull = AuthenticationWelcomeGesture.progress(pull: 400, travel: 200)
        XCTAssertGreaterThan(longPull, 0.62)
        XCTAssertGreaterThan(overpull, longPull)
        XCTAssertLessThan(overpull, 1)
        XCTAssertLessThan(overpull - longPull, longPull - 0.62)
        XCTAssertEqual(AuthenticationWelcomeGesture.progress(pull: 100, travel: 0), 0)
    }

    func testExploratoryAndSidewaysPullsDoNotCommit() {
        XCTAssertFalse(AuthenticationWelcomeGesture.shouldEnter(translation: CGSize(width: 0, height: -32),
            predicted: CGSize(width: 0, height: -400), travel: 210))
        XCTAssertFalse(AuthenticationWelcomeGesture.shouldEnter(translation: CGSize(width: 180, height: -150),
            predicted: CGSize(width: 220, height: -300), travel: 210))
        XCTAssertFalse(AuthenticationWelcomeGesture.shouldEnter(translation: CGSize(width: 0, height: 120),
            predicted: CGSize(width: 0, height: 200), travel: 210))
    }
    func testDeliberatePullAndFlingBothEnter() {
        XCTAssertTrue(AuthenticationWelcomeGesture.shouldEnter(translation: CGSize(width: 8, height: -160),
            predicted: CGSize(width: 8, height: -160), travel: 210))
        XCTAssertTrue(AuthenticationWelcomeGesture.shouldEnter(translation: CGSize(width: 0, height: -80),
            predicted: CGSize(width: 0, height: -240), travel: 210))
    }
}
