import Foundation
import Security
import XCTest
@testable import TalentSignal

@MainActor
final class IOSPersistentSessionTests: XCTestCase {
    private let endpoint = URL(string: "https://persistent-ios.example.test")!
    private let sessionID = UUID().uuidString.lowercased()

    override func tearDown() { PersistentAuthenticationURLProtocol.handler = nil; PersistentAuthenticationURLProtocol.streamBody = nil; super.tearDown() }

    private func login(token: String? = nil, expires: Date = Date().addingTimeInterval(3600),
                       kind: String = "password_human") -> TalentSignalSession {
        .init(baseURL: endpoint, accessToken: token ?? "synthetic-access-" + sessionID, expiresAt: expires,
              account: .init(id: "fixture-account", slug: "fixture-persistent", name: "Synthetic"),
              user: .init(id: "fixture-user", email: "fixture@example.test", displayName: "Synthetic", kind: kind), sessionID: sessionID)
    }

    private func persistent(_ value: TalentSignalSession, enrolled: Bool = true) throws -> TalentSignalSession {
        var result = value
        result.persistent = try IOSPersistentSessionCredential.pending(session: value)
        result.persistent?.enrolled = enrolled
        return result
    }

    private func response(token: String = "synthetic-renewed", kind: String = "password_human") -> [String: Any] {
        ["contract_version": TalentSignalAPIContract.version, "session_id": sessionID,
         "access_token": token, "expires_at": ISO8601DateFormatter().string(from: Date().addingTimeInterval(8 * 3600)),
         "account": ["id": "fixture-account", "slug": "fixture-persistent", "name": "Synthetic"],
         "user": ["id": "fixture-user", "email": "fixture@example.test", "display_name": "Synthetic", "kind": kind]]
    }

    private func network() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PersistentAuthenticationURLProtocol.self]
        return URLSession(configuration: configuration, delegate: RuntimeRedirectGuard(), delegateQueue: nil)
    }

    func testRealPasswordProducerPersistsPendingBeforeEnrollmentAndKeepsFamilyOnExpiredRestore() async throws {
        let local = PersistentMemorySessions(), endings = MemoryAppSessionEndings(), events = PersistentRouteRecorder()
        let initial = response(token: "synthetic-initial")
        let renewed = response()
        PersistentAuthenticationURLProtocol.handler = { request in
            events.append(request.url!.path)
            switch request.url!.path {
            case "/v1/auth/password/login": return (200, initial)
            case "/v1/auth/session":
                var current = initial; current.removeValue(forKey: "access_token"); return (200, current)
            case "/v1/auth/persistent/renew":
                let saved = try XCTUnwrap(local.value)
                let proof = try self.body(request)
                XCTAssertEqual(proof["session_id"] as? String, self.sessionID)
                XCTAssertEqual(proof["renewal_secret"] as? String, saved.persistent?.secret)
                if saved.persistent?.enrolled == false { return (401, ["error": ["code": "PERSISTENT_SESSION_REVOKED", "message": "Synthetic absent enrollment"]]) }
                return (200, renewed)
            case "/v1/auth/persistent/enroll":
                let saved = try XCTUnwrap(local.value)
                XCTAssertEqual(saved.persistent?.enrolled, false, "Pending capability must already be protected before enrollment dispatch")
                XCTAssertEqual(try self.body(request)["renewal_secret"] as? String, saved.persistent?.secret)
                XCTAssertEqual(try self.body(request)["client_kind"] as? String, "ios")
                return (200, renewed)
            default: throw URLError(.badURL)
            }
        }
        let transport = network(); defer { transport.invalidateAndCancel() }
        let client = AppAuthenticationClient(baseURL: endpoint, session: transport)
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: endings)
        await store.signInWithEmail(email: "fixture@example.test", password: "synthetic-password", registering: false)
        let saved = try XCTUnwrap(store.currentSession)
        XCTAssertEqual(saved.user.kind, "password_human", "Use the backend's real producer kind")
        XCTAssertEqual(saved.persistent?.enrolled, true)
        XCTAssertEqual(events.paths.filter { $0 == "/v1/auth/persistent/enroll" }.count, 1)
        XCTAssertEqual(events.paths.filter { $0 == "/v1/auth/persistent/renew" }.count, 1)
        let stableIdentity = saved.loginIdentity, capability = saved.persistent?.secret
        var expired = saved
        expired = .init(baseURL: saved.baseURL, accessToken: saved.accessToken, expiresAt: Date() - 1,
            account: saved.account, user: saved.user, sessionID: saved.sessionID, persistent: saved.persistent)
        local.value = expired
        let relaunched = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: endings)
        await relaunched.restore()
        XCTAssertEqual(relaunched.currentSession?.loginIdentity, stableIdentity)
        XCTAssertEqual(relaunched.currentSession?.persistent?.secret, capability)
        XCTAssertTrue(try XCTUnwrap(relaunched.currentSession).expiresAt > Date())
        XCTAssertEqual(events.paths.filter { $0 == "/v1/auth/persistent/enroll" }.count, 1, "Expired access restores by the same capability, without fresh enrollment")
    }

    func testRealProviderKindsAreEligibleAndLabKindsStayBounded() {
        for kind in ["password_human", "apple_human", "google_human"] { XCTAssertTrue(login(kind: kind).isRealUserSession) }
        for kind in ["lab_human", "simulated_human", "human", "unknown"] { XCTAssertFalse(login(kind: kind).isRealUserSession) }
    }

    func testMissingCanonicalIDKeepsVerifiedOrdinaryReceiptWithoutInventingCapability() async throws {
        var legacy = response(token: "synthetic-idless-" + sessionID)
        legacy.removeValue(forKey: "session_id")
        let local = PersistentMemorySessions(), events = PersistentRouteRecorder()
        PersistentAuthenticationURLProtocol.handler = { request in
            events.append(request.url!.path)
            return (200, legacy)
        }
        let transport = network(); defer { transport.invalidateAndCancel() }
        let store = AppSessionStore(baseURL: endpoint, persistence: local,
            client: AppAuthenticationClient(baseURL: endpoint, session: transport), endings: MemoryAppSessionEndings())
        await store.signInWithEmail(email: "fixture@example.test", password: "synthetic-password", registering: false)
        XCTAssertEqual(store.phase, .restoring, "Missing new metadata exposes a retry, not fresh credential entry")
        XCTAssertNotNil(local.value)
        XCTAssertEqual(local.value?.user.kind, "password_human")
        XCTAssertNil(local.value?.sessionID)
        XCTAssertNil(local.value?.persistent)
        XCTAssertFalse(events.paths.contains("/v1/auth/persistent/enroll"))
    }

    func testLostEnrollmentResponseRecoversPendingWithExpiredAccessWithoutFallback() async throws {
        let pending = try persistent(login(expires: Date() - 3600), enrolled: false)
        let local = PersistentMemorySessions(pending), events = PersistentRouteRecorder()
        let renewed = response()
        PersistentAuthenticationURLProtocol.handler = { request in events.append(request.url!.path); return (200, renewed) }
        let transport = network(); defer { transport.invalidateAndCancel() }
        let store = AppSessionStore(baseURL: endpoint, persistence: local,
            client: AppAuthenticationClient(baseURL: endpoint, session: transport), endings: MemoryAppSessionEndings())
        await store.restore()
        XCTAssertEqual(store.currentSession?.persistent?.secret, pending.persistent?.secret)
        XCTAssertEqual(store.currentSession?.persistent?.enrolled, true)
        XCTAssertEqual(events.paths, ["/v1/auth/persistent/renew"])
    }

    func testConfirmedRevocationSignsOutButUnknown401PreservesProtectedCapability() async throws {
        for (code, terminal) in [("PROXY_AUTHENTICATION_REQUIRED", false), ("PERSISTENT_SESSION_REVOKED", true)] {
            let saved = try persistent(login(expires: Date() - 1))
            let local = PersistentMemorySessions(saved), endings = MemoryAppSessionEndings()
            PersistentAuthenticationURLProtocol.handler = { request in
                if request.url!.path == "/v1/auth/apple/challenges" { throw URLError(.notConnectedToInternet) }
                return (401, ["error": ["code": code, "message": "Synthetic refusal"]])
            }
            let transport = network(); defer { transport.invalidateAndCancel() }
            let store = AppSessionStore(baseURL: endpoint, persistence: local,
                client: AppAuthenticationClient(baseURL: endpoint, session: transport), endings: endings)
            await store.restore()
            if terminal { XCTAssertEqual(store.phase, .signedOut); XCTAssertNil(local.value) }
            else { XCTAssertEqual(store.currentSession?.persistent?.secret, saved.persistent?.secret); XCTAssertNotNil(local.value) }
        }
    }

    func testOfflineAndLockedStorageDoNotBecomeFreshLogin() async throws {
        let saved = try persistent(login(expires: Date() - 1)), local = PersistentMemorySessions(saved)
        let client = PersistentAuthenticationStub(response: saved)
        client.failure = URLError(.notConnectedToInternet)
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: MemoryAppSessionEndings())
        await store.restore()
        XCTAssertEqual(store.currentSession, saved); XCTAssertEqual(local.value, saved)
        local.readFailure = AppSessionError.keychain(errSecInteractionNotAllowed)
        let relaunched = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: MemoryAppSessionEndings())
        await relaunched.restore()
        XCTAssertEqual(relaunched.phase, .restoring, "Locked credentials expose retry, without a new sign-in form")
        XCTAssertNotNil(local.value)
        local.readFailure = nil
        client.failure = nil
        client.response = .init(baseURL: saved.baseURL, accessToken: "synthetic-unlocked-" + sessionID,
            expiresAt: Date() + 8 * 3600, account: saved.account, user: saved.user,
            sessionID: saved.sessionID, persistent: saved.persistent)
        await relaunched.refreshIfNeeded(force: true)
        XCTAssertEqual(relaunched.currentSession?.persistent?.secret, saved.persistent?.secret)
        XCTAssertTrue(try XCTUnwrap(relaunched.currentSession).expiresAt > Date(), "Unlock/foreground must resume renewal without credential entry")
    }

    func testConcurrentRenewalCoalescesAndLateReplyCannotResurrectLogout() async throws {
        let saved = try persistent(login()), local = PersistentMemorySessions(saved), endings = MemoryAppSessionEndings()
        let client = PersistentAuthenticationStub(response: saved)
        client.suspend = true
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let coordinator = IOSPersistentSessionCoordinator(mirror: .init(directory: directory))
        let first = Task { try await coordinator.resolve(saved, persistence: local, endings: endings, client: client, force: true) }
        let deadline = Date().addingTimeInterval(5)
        while client.continuation == nil && Date() < deadline { await Task.yield() }
        guard client.continuation != nil else { first.cancel(); XCTFail("Renewal did not start within 5 seconds"); return }
        let second = Task { try await coordinator.resolve(saved, persistence: local, endings: endings, client: client, force: true) }
        // The second request enters the same actor before retirement is queued.
        await Task.yield()
        endings.values = [AppSessionEnding(session: saved)]
        await coordinator.retire(saved)
        local.value = nil
        client.continuation?.resume(returning: saved); client.continuation = nil
        do { _ = try await first.value; XCTFail("Late renewal must stay fenced") } catch { }
        do { _ = try await second.value; XCTFail("Concurrent renewal must stay fenced") } catch { }
        XCTAssertEqual(client.validations, 1)
        XCTAssertNil(local.value)
    }

    func testRenewableSignOutRetainsRevocationAfterAccessExpiryAndBlocksOldTokens() async throws {
        let saved = try persistent(login(expires: Date() - 1)), local = PersistentMemorySessions(saved)
        let journal = MemoryAppSessionEndings(), client = PersistentAuthenticationStub(response: saved)
        let controller = AppSessionEndingController(endpoint: endpoint, sessions: local, endings: journal, client: client)
        let operation = try controller.prepare(saved)
        client.failure = URLError(.notConnectedToInternet)
        let failed = try await controller.run(operation.id)
        XCTAssertEqual(failed.remote, .unverified)
        XCTAssertEqual(failed.credential?.persistent?.secret, saved.persistent?.secret)
        XCTAssertTrue(failed.blocks(saved))
        XCTAssertTrue(failed.blockedCredentialFingerprints?.contains(IOSPersistentSessionCredential.tokenFingerprint(saved.accessToken, endpoint: endpoint)) == true)
        client.failure = nil
        let finished = try await controller.run(operation.id)
        XCTAssertEqual(finished.remote, .revoked)
        XCTAssertNil(finished.credential)
        XCTAssertEqual(client.logouts, 2)
    }

    func testStableFamilyKeepsWorkspaceAndAccountOperationIdentityAcrossRotation() throws {
        let first = try persistent(login()), secondToken = "synthetic-second"
        var second = TalentSignalSession(baseURL: first.baseURL, accessToken: secondToken, expiresAt: Date() + 8 * 3600,
            account: first.account, user: first.user, sessionID: first.sessionID, persistent: first.persistent)
        second.persistent?.remember(token: secondToken, endpoint: endpoint)
        IOSSessionFamilyRegistry.shared.remember(first)
        let before = AccountOperationScope(baseURL: endpoint, accessToken: first.accessToken, accountID: first.account.id, userID: first.user.id)
        IOSSessionFamilyRegistry.shared.remember(second)
        let after = AccountOperationScope(baseURL: endpoint, accessToken: second.accessToken, accountID: second.account.id, userID: second.user.id)
        XCTAssertEqual(first.loginIdentity, second.loginIdentity)
        XCTAssertEqual(before, after); XCTAssertEqual(before.hashValue, after.hashValue)
        var newer = second; newer.sessionID = UUID().uuidString
        newer.persistent = .init(secret: String(repeating: "A", count: 43), sessionID: newer.sessionID!, enrolled: true, accessFingerprints: [])
        newer = .init(baseURL: newer.baseURL, accessToken: "new-login", expiresAt: newer.expiresAt, account: newer.account,
            user: newer.user, sessionID: newer.sessionID, persistent: newer.persistent)
        IOSSessionFamilyRegistry.shared.remember(newer)
        XCTAssertNotEqual(before, AccountOperationScope(baseURL: endpoint, accessToken: newer.accessToken, accountID: newer.account.id, userID: newer.user.id))
    }

    func testActualNetworkingRejectsCachedWriteAfterOfflineSignOutWithNoActiveItem() async throws {
        let saved = try persistent(login()), local = PersistentMemorySessions(saved), endings = MemoryAppSessionEndings()
        let client = PersistentAuthenticationStub(response: saved); client.failure = URLError(.notConnectedToInternet)
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let coordinator = IOSPersistentSessionCoordinator(mirror: .init(directory: directory), endpointProvider: { self.endpoint },
            persistenceProvider: { _ in local }, endingsProvider: { _ in endings }, clientProvider: { _ in client })
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: endings, coordinator: coordinator)
        await store.restore()
        let receipt = await store.signOut()
        XCTAssertEqual(receipt?.remote, .unverified); XCTAssertNil(local.value)
        let events = PersistentRouteRecorder()
        PersistentAuthenticationURLProtocol.handler = { request in events.append(request.url!.path); return (200, [:]) }
        let transport = network(); defer { transport.invalidateAndCancel() }
        var stale = URLRequest(url: endpoint.appending(path: "v1/chat")); stale.httpMethod = "POST"
        stale.setValue("Bearer \(saved.accessToken)", forHTTPHeaderField: "authorization")
        do {
            _ = try await IOSSessionRequestResolution.$coordinator.withValue(coordinator) {
                try await TalentSignalNetworking.data(for: stale, using: transport)
            }
            XCTFail("Offline sign-out must fence a cached business writer")
        } catch { }
        XCTAssertTrue(events.paths.isEmpty, "The actual shared networking entry must dispatch zero business requests")
    }

    func testMonotonicRevocationSurvivesFailedProtectedCleanupAndOfflineColdStart() async throws {
        let saved = try persistent(login()), local = PersistentMemorySessions(saved)
        local.deleteFailure = AppSessionError.keychain(errSecInteractionNotAllowed)
        let endings = MemoryAppSessionEndings(); endings.failAt = Set(1...10)
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let mirror = CaptureLogoutDenyMirror(directory: directory)
        let first = IOSPersistentSessionCoordinator(mirror: mirror)
        let revoked = PersistentAuthenticationStub(response: saved)
        revoked.failure = AppSessionError.backend(status: 401, code: "PERSISTENT_SESSION_REVOKED", message: "Synthetic revoked")
        do { _ = try await first.resolve(saved, persistence: local, endings: endings, client: revoked, force: true); XCTFail("Revocation must fail closed") } catch { }
        XCTAssertNotNil(local.value, "Fixture intentionally leaves the protected active item behind")
        XCTAssertTrue(endings.values.isEmpty, "Fixture intentionally fails the protected journal write")
        XCTAssertTrue(try mirror.isDenied(endpoint: endpoint, fingerprint: AppSessionEnding.fingerprint(saved)))
        let offline = PersistentAuthenticationStub(response: saved); offline.failure = URLError(.notConnectedToInternet)
        let fresh = IOSPersistentSessionCoordinator(mirror: mirror)
        let relaunched = AppSessionStore(baseURL: endpoint, persistence: local, client: offline, endings: endings, coordinator: fresh)
        await relaunched.restore()
        XCTAssertEqual(relaunched.phase, .signedOut)
        XCTAssertNil(relaunched.currentSession)
        XCTAssertEqual(offline.validations, 0, "The durable deny is authoritative before an offline validation attempt")
    }

    func testCachedSSEStreamUsesRenewedBearerAtActualDispatch() async throws {
        let saved = try persistent(login()), local = PersistentMemorySessions(saved), endings = MemoryAppSessionEndings()
        var fresh = TalentSignalSession(baseURL: saved.baseURL, accessToken: "synthetic-new-stream-access", expiresAt: Date() + 8 * 3600,
            account: saved.account, user: saved.user, sessionID: saved.sessionID, persistent: saved.persistent)
        let freshToken = fresh.accessToken
        fresh.persistent?.remember(token: freshToken, endpoint: endpoint)
        let client = PersistentAuthenticationStub(response: fresh), events = PersistentRouteRecorder()
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let coordinator = IOSPersistentSessionCoordinator(mirror: .init(directory: directory), endpointProvider: { self.endpoint },
            persistenceProvider: { _ in local }, endingsProvider: { _ in endings }, clientProvider: { _ in client })
        PersistentAuthenticationURLProtocol.streamBody = ": heartbeat\n\n"
        PersistentAuthenticationURLProtocol.handler = { request in
            events.append(request.url!.path)
            XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer synthetic-new-stream-access")
            return (200, [:])
        }
        let transport = network(); defer { transport.invalidateAndCancel() }
        let cached = ConversationImageTransport(baseURL: endpoint, token: saved.accessToken, session: transport)
        try await IOSSessionRequestResolution.$coordinator.withValue(coordinator) {
            for try await _ in cached.conversationImageUpdates(sessionID: UUID(), messageID: UUID()) { }
        }
        XCTAssertEqual(events.paths.count, 1)
        XCTAssertEqual(client.validations, 1)
        XCTAssertEqual(local.value?.accessToken, fresh.accessToken)
    }

    func testPrefixedAuthenticationBypassesPreflightAndLogoutPermitStaysOriginBound() async throws {
        let prefix = endpoint.appending(path: "api")
        let coordinator = IOSPersistentSessionCoordinator(endpointProvider: { prefix },
            persistenceProvider: { _ in XCTFail("Auth dispatch must not recursively read the active family"); return PersistentMemorySessions() })
        let transport = network(); defer { transport.invalidateAndCancel() }
        let events = PersistentRouteRecorder()
        PersistentAuthenticationURLProtocol.handler = { request in
            events.append(request.url!.path)
            XCTAssertEqual(request.url?.path, "/api/v1/auth/persistent/revoke"); return (200, ["revoked": true])
        }
        let permit = try RuntimeWorkRegistry.shared.beginMaintenance()
        defer { RuntimeWorkRegistry.shared.endMaintenance(permit) }
        var request = URLRequest(url: prefix.appending(path: "v1/auth/persistent/revoke")); request.httpMethod = "POST"
        request.setValue("Bearer synthetic-auth", forHTTPHeaderField: "authorization")
        let result = try await RuntimeMaintenanceContext.$logoutPermit.withValue(permit) {
            try await RuntimeMaintenanceContext.$logoutEndpoint.withValue(prefix) {
                try await IOSSessionRequestResolution.$coordinator.withValue(coordinator) {
                    try await TalentSignalNetworking.data(for: request, using: transport)
                }
            }
        }
        XCTAssertEqual((result.1 as? HTTPURLResponse)?.statusCode, 200)
        var foreign = URLRequest(url: URL(string: "https://persistent-ios.example.test:444/v1/auth/logout")!)
        foreign.httpMethod = "POST"
        do {
            _ = try await RuntimeMaintenanceContext.$logoutPermit.withValue(permit) {
                try await RuntimeMaintenanceContext.$logoutEndpoint.withValue(prefix) {
                    try await IOSSessionRequestResolution.$coordinator.withValue(coordinator) {
                        try await TalentSignalNetworking.data(for: foreign, using: transport)
                    }
                }
            }
            XCTFail("An approved prefixed logout cannot lend its maintenance permit to a foreign origin")
        } catch { XCTAssertTrue(error is RuntimeEnvironmentError) }
        XCTAssertEqual(events.paths, ["/api/v1/auth/persistent/revoke"], "Foreign logout must never dispatch")
        XCTAssertEqual(RuntimeEndpoint.relativeRoute(prefix.appending(path: "v1/auth/session"), endpoint: prefix), "/v1/auth/session")
        XCTAssertNil(RuntimeEndpoint.relativeRoute(endpoint.appending(path: "api-unrelated/v1/auth/session"), endpoint: prefix))
        XCTAssertEqual(RuntimeEndpoint.relativeRoute(URL(string: "https://persistent-ios.example.test:443/api/v1/auth/session")!, endpoint: prefix), "/v1/auth/session")
        XCTAssertNil(RuntimeEndpoint.relativeRoute(URL(string: "https://persistent-ios.example.test:444/api/v1/auth/session")!, endpoint: prefix))
    }

    func testConcurrentLegacyRestorationKeepsCommittedPendingSecretAfterLostResponse() async throws {
        var original = login(); original.sessionID = nil
        let local = PersistentMemorySessions(original), endings = MemoryAppSessionEndings()
        let client = PersistentLegacyMigrationStub(sessionID: sessionID)
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: endings)
        let first = Task { await store.restore() }
        let deadline = Date().addingTimeInterval(5)
        while client.legacyReadback == nil && Date() < deadline { await Task.yield() }
        guard client.legacyReadback != nil else { first.cancel(); XCTFail("Legacy validation did not start within 5 seconds"); return }
        let second = Task { await store.restore() }
        var verified = original; verified.sessionID = sessionID
        client.legacyReadback?.resume(returning: verified); client.legacyReadback = nil
        await first.value; await second.value
        XCTAssertEqual(client.legacyReads, 1, "One restoration owner must admit the legacy migration")
        let pending = try XCTUnwrap(local.value)
        XCTAssertEqual(pending.persistent?.secret, client.committedSecret)
        XCTAssertEqual(pending.persistent?.enrolled, false, "Fixture loses the first committed response")
        local.value = .init(baseURL: pending.baseURL, accessToken: pending.accessToken, expiresAt: Date() - 1,
            account: pending.account, user: pending.user, sessionID: pending.sessionID, persistent: pending.persistent)
        let relaunched = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: endings)
        await relaunched.restore()
        XCTAssertEqual(relaunched.currentSession?.persistent?.secret, client.committedSecret)
        XCTAssertEqual(relaunched.currentSession?.persistent?.enrolled, true)
        XCTAssertEqual(client.legacyReads, 1, "Expired pending recovery must not request new legacy authority")
    }

    func testProtectedLabReturnRenewsOnlyItsBoundCandidateThroughActualNetworking() async throws {
        let original = try persistent(login(expires: Date() - 1)), local = PersistentMemorySessions(), endings = MemoryAppSessionEndings()
        let childID = UUID().uuidString.lowercased()
        let child = TalentSignalSession(baseURL: endpoint, accessToken: "synthetic-child-" + sessionID, expiresAt: Date() + 3600,
            account: .init(id: "child-account", slug: "fixture-child", name: "Child"),
            user: .init(id: "child-user", email: "child@example.test", displayName: "Child", kind: "lab_human"), sessionID: childID)
        local.value = child
        let events = PersistentRouteRecorder(), renewed = response(token: "synthetic-owner-return-" + sessionID)
        PersistentAuthenticationURLProtocol.handler = { request in
            events.append(request.url!.path)
            if request.url!.path == "/v1/auth/session" {
                return (200, ["contract_version": TalentSignalAPIContract.version, "session_id": childID,
                    "expires_at": ISO8601DateFormatter().string(from: child.expiresAt),
                    "account": ["id": child.account.id, "slug": child.account.slug, "name": child.account.name],
                    "user": ["id": child.user.id, "email": child.user.email, "display_name": child.user.displayName, "kind": child.user.kind]])
            }
            XCTAssertEqual(request.url!.path, "/v1/auth/persistent/renew")
            XCTAssertNil(request.value(forHTTPHeaderField: "authorization"))
            XCTAssertEqual(try self.body(request)["session_id"] as? String, original.sessionID)
            return (200, renewed)
        }
        let transport = network(); defer { transport.invalidateAndCancel() }
        let client = AppAuthenticationClient(baseURL: endpoint, session: transport)
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let coordinator = IOSPersistentSessionCoordinator(mirror: .init(directory: directory))
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: client, endings: endings, coordinator: coordinator)
        await store.restore()
        XCTAssertEqual(store.currentSession?.user.kind, "lab_human")
        let permit = try RuntimeWorkRegistry.shared.beginMaintenance()
        defer { RuntimeWorkRegistry.shared.endMaintenance(permit) }
        let returned = try await store.replaceWithValidatedProtectedSession(original, expectedCurrent: child, maintenancePermit: permit)
        XCTAssertEqual(returned.persistent?.secret, original.persistent?.secret)
        XCTAssertEqual(local.value, returned)
        XCTAssertEqual(store.currentSession, returned)
        XCTAssertEqual(events.paths, ["/v1/auth/session", "/v1/auth/persistent/renew"])
        let permission = try XCTUnwrap(RuntimePersistentRenewalPermission(owner: permit, session: original))
        let proof: [String: String] = ["renewal_secret": original.persistent!.secret, "account_id": original.account.id,
            "user_id": original.user.id, "session_id": original.sessionID!]
        var requests: [URLRequest] = []
        for path in ["v1/chat", "v1/auth/persistent/enroll", "v1/auth/persistent/renew"] {
            var request = URLRequest(url: endpoint.appending(path: path)); request.httpMethod = "POST"
            var body = proof
            if path.hasSuffix("/renew") { body["session_id"] = UUID().uuidString.lowercased() }
            request.httpBody = try JSONEncoder().encode(body)
            requests.append(request)
        }
        var foreign = URLRequest(url: URL(string: "https://persistent-ios.example.test:444/v1/auth/persistent/renew")!)
        foreign.httpMethod = "POST"; foreign.httpBody = try JSONEncoder().encode(proof); requests.append(foreign)
        for request in requests {
            do {
                _ = try await RuntimeMaintenanceContext.$persistentRenewal.withValue(permission) {
                    try await TalentSignalNetworking.data(for: request, using: transport)
                }
                XCTFail("A candidate-bound renewal permit must reject business, enrollment, foreign origin and wrong family")
            } catch { XCTAssertTrue(error is RuntimeEnvironmentError) }
        }
        XCTAssertEqual(events.paths.count, 2, "Rejected maintenance writes must never dispatch")
        RuntimeWorkRegistry.shared.endMaintenance(permit)
        let differentOwner = try RuntimeWorkRegistry.shared.beginMaintenance()
        defer { RuntimeWorkRegistry.shared.endMaintenance(differentOwner) }
        var late = URLRequest(url: endpoint.appending(path: "v1/auth/persistent/renew")); late.httpMethod = "POST"
        late.httpBody = try JSONEncoder().encode(proof)
        do {
            _ = try await RuntimeMaintenanceContext.$persistentRenewal.withValue(permission) {
                try await TalentSignalNetworking.data(for: late, using: transport)
            }
            XCTFail("An ended owner must not lend its renewal permission to a new maintenance operation")
        } catch { XCTAssertTrue(error is RuntimeEnvironmentError) }
        XCTAssertEqual(events.paths.count, 2)
    }

    func testLabWorkspaceResetRenewsWithoutGrantingBusinessWriteAuthority() async throws {
        let saved = try persistent(login()), local = PersistentMemorySessions(saved), endings = MemoryAppSessionEndings()
        let initial = PersistentAuthenticationStub(response: saved)
        let transport = network(); defer { transport.invalidateAndCancel() }
        let real = AppAuthenticationClient(baseURL: endpoint, session: transport), events = PersistentRouteRecorder()
        let renewed = response(token: "synthetic-reset-access-" + sessionID)
        PersistentAuthenticationURLProtocol.handler = { request in
            events.append(request.url!.path)
            return request.url!.path == "/v1/auth/persistent/renew" ? (200, renewed) : (200, [:])
        }
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let coordinator = IOSPersistentSessionCoordinator(mirror: .init(directory: directory), endpointProvider: { self.endpoint },
            persistenceProvider: { _ in local }, endingsProvider: { _ in endings }, clientProvider: { _ in real })
        let store = AppSessionStore(baseURL: endpoint, persistence: local, client: initial, endings: endings, coordinator: coordinator)
        await store.restore()
        let runner = LabResetExecutor(session: store, display: nil, refreshWorkspace: {
            var request = URLRequest(url: self.endpoint.appending(path: "v1/workspace"))
            request.setValue("Bearer \(saved.accessToken)", forHTTPHeaderField: "authorization")
            do {
                let result = try await IOSSessionRequestResolution.$coordinator.withValue(coordinator) {
                    try await TalentSignalNetworking.data(for: request, using: transport)
                }
                return (result.1 as? HTTPURLResponse)?.statusCode == 200
            } catch { return false }
        })
        let operation = LabResetOperation(id: UUID(), startedAt: Date(), context: runner.context, steps: [.init(action: .workspace)])
        let result = try await runner.perform(.workspace, operation: operation)
        XCTAssertTrue(result.verified)
        XCTAssertEqual(events.paths, ["/v1/auth/persistent/renew", "/v1/workspace"])
    }

    func testPendingLogoutRetainsOriginalProofUntilAtomicRevokeIsConfirmed() async throws {
        let pending = try persistent(login(token: String(repeating: "B", count: 43), expires: Date() - 1), enrolled: false)
        let local = PersistentMemorySessions(pending), endings = MemoryAppSessionEndings(), events = PersistentRouteRecorder()
        var confirmed = false
        PersistentAuthenticationURLProtocol.handler = { request in
            events.append(request.url!.path)
            XCTAssertEqual(request.url!.path, "/v1/auth/persistent/revoke")
            XCTAssertNil(request.value(forHTTPHeaderField: "authorization"))
            let proof = try self.body(request)
            XCTAssertEqual(proof["original_access_token"] as? String, pending.accessToken)
            XCTAssertEqual(proof["renewal_secret"] as? String, pending.persistent?.secret)
            return confirmed ? (200, ["revoked": true]) : (401, ["error": ["code": "PERSISTENT_SESSION_REVOKED", "message": "Synthetic capability not yet visible"]])
        }
        let transport = network(); defer { transport.invalidateAndCancel() }
        let controller = AppSessionEndingController(endpoint: endpoint, sessions: local, endings: endings,
            client: AppAuthenticationClient(baseURL: endpoint, session: transport))
        let operation = try controller.prepare(pending)
        let absent = try await controller.run(operation.id)
        XCTAssertEqual(absent.remote, .unverified)
        XCTAssertEqual(absent.credential?.accessToken, pending.accessToken)
        XCTAssertEqual(absent.credential?.persistent?.secret, pending.persistent?.secret)
        confirmed = true
        let revoked = try await controller.run(operation.id)
        XCTAssertEqual(revoked.remote, .revoked)
        XCTAssertNil(revoked.credential)
        XCTAssertEqual(events.paths.count, 2)
    }

    func testKnownFamilyCannotWriteAfterLabNewPrimaryOrEnvironmentSwitch() async throws {
        let original = try persistent(login(expires: Date() + 8 * 3600)), local = PersistentMemorySessions(original), endings = MemoryAppSessionEndings()
        IOSSessionFamilyRegistry.shared.remember(original)
        let selection = PersistentEndpointSelection(endpoint)
        let client = PersistentAuthenticationStub(response: original), events = PersistentRouteRecorder()
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let coordinator = IOSPersistentSessionCoordinator(mirror: .init(directory: directory), endpointProvider: { selection.endpoint },
            persistenceProvider: { _ in local }, endingsProvider: { _ in endings }, clientProvider: { _ in client })
        PersistentAuthenticationURLProtocol.handler = { request in events.append(request.url!.path); return (200, [:]) }
        let transport = network(); defer { transport.invalidateAndCancel() }
        var stale = URLRequest(url: endpoint.appending(path: "v1/chat")); stale.httpMethod = "POST"
        stale.setValue("Bearer \(original.accessToken)", forHTTPHeaderField: "authorization")
        var child = login(token: "synthetic-lab-" + sessionID, kind: "lab_human"); child.sessionID = UUID().uuidString.lowercased()
        var newer = try persistent(login(token: "synthetic-new-primary-" + sessionID, expires: Date() + 8 * 3600))
        newer.sessionID = UUID().uuidString.lowercased()
        newer.persistent = .init(secret: String(repeating: "C", count: 43), sessionID: newer.sessionID!, enrolled: true, accessFingerprints: [])
        for target in [child, newer] {
            local.value = target
            IOSSessionFamilyRegistry.shared.remember(target)
            do {
                _ = try await IOSSessionRequestResolution.$coordinator.withValue(coordinator) { try await TalentSignalNetworking.data(for: stale, using: transport) }
                XCTFail("A cached owner writer cannot follow a different active family")
            } catch { }
        }
        selection.endpoint = endpoint.appending(path: "alternate")
        local.value = .init(baseURL: selection.endpoint, accessToken: "synthetic-alt-" + sessionID, expiresAt: Date() + 8 * 3600,
            account: newer.account, user: newer.user, sessionID: newer.sessionID, persistent: newer.persistent)
        do {
            _ = try await IOSSessionRequestResolution.$coordinator.withValue(coordinator) { try await TalentSignalNetworking.data(for: stale, using: transport) }
            XCTFail("A cached owner writer cannot follow a different selected environment")
        } catch { }
        XCTAssertTrue(events.paths.isEmpty)
        let current = try XCTUnwrap(local.value)
        IOSSessionFamilyRegistry.shared.remember(current)
        var fresh = URLRequest(url: selection.endpoint.appending(path: "v1/workspace"))
        fresh.setValue("Bearer \(current.accessToken)", forHTTPHeaderField: "authorization")
        _ = try await IOSSessionRequestResolution.$coordinator.withValue(coordinator) { try await TalentSignalNetworking.data(for: fresh, using: transport) }
        XCTAssertEqual(events.paths, ["/alternate/v1/workspace"])
    }

    func testMountedClientAliasSurvivesSixHundredAccessGenerations() async throws {
        let original = try persistent(login(expires: Date() + 8 * 3600))
        IOSSessionFamilyRegistry.shared.remember(original)
        var current = original
        for generation in 1...600 {
            let token = "synthetic-generation-\(generation)-" + sessionID
            var capability = current.persistent!
            capability.remember(token: token, endpoint: endpoint)
            current = .init(baseURL: endpoint, accessToken: token, expiresAt: Date() + 8 * 3600,
                account: original.account, user: original.user, sessionID: sessionID, persistent: capability)
            IOSSessionFamilyRegistry.shared.remember(current)
        }
        XCTAssertEqual(current.persistent?.accessFingerprints.count, 64)
        XCTAssertFalse(current.persistent!.accessFingerprints.contains(IOSPersistentSessionCredential.tokenFingerprint(original.accessToken, endpoint: endpoint)))
        let local = PersistentMemorySessions(current), client = PersistentAuthenticationStub(response: current), endings = MemoryAppSessionEndings()
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let coordinator = IOSPersistentSessionCoordinator(mirror: .init(directory: directory), endpointProvider: { self.endpoint },
            persistenceProvider: { _ in local }, endingsProvider: { _ in endings }, clientProvider: { _ in client })
        let expected = current.accessToken, events = PersistentRouteRecorder()
        PersistentAuthenticationURLProtocol.handler = { request in
            events.append(request.url!.path); XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer \(expected)")
            return (200, [:])
        }
        let transport = network(); defer { transport.invalidateAndCancel() }
        var request = URLRequest(url: endpoint.appending(path: "v1/workspace")); request.setValue("Bearer \(original.accessToken)", forHTTPHeaderField: "authorization")
        _ = try await IOSSessionRequestResolution.$coordinator.withValue(coordinator) { try await TalentSignalNetworking.data(for: request, using: transport) }
        XCTAssertEqual(events.paths.count, 1)
        XCTAssertEqual(client.validations, 0, "A fresh current generation needs no extra renewal to serve the old mounted client")
    }

    func testActiveRefreshFamilyKeepsActualProtectedIntentDraftAndReadScopeUntilNewLogin() async throws {
        let original = try persistent(login())
        IOSSessionFamilyRegistry.shared.remember(original)
        let openID = UUID()
        let first = try XCTUnwrap(AgentSessionActiveRefreshConsumer.lease(endpoint: endpoint, accessToken: original.accessToken,
            accountID: original.account.id, userID: original.user.id, openSessionID: openID))
        let service = URLPursuitWorkspaceClient(baseURL: endpoint, accessToken: original.accessToken,
            accountID: original.account.id, userID: original.user.id, userDisplayName: original.user.displayName)
        let people = PursuitWorkspaceStore(service: service), sessions = AgentSessionStore()
        sessions.saveGlobalDraft("Synthetic draft retained across access rotation")
        let consumer = AgentSessionActiveRefreshConsumer(lease: first, sessions: sessions, people: people,
            syncService: { nil }, isCanonical: { true })
        let memoryClient = try await people.memoryReviewClient()
        let key = ConversationMemoryIntentRetention.accountPrefix(binding: memoryClient.accountBinding) + UUID().uuidString.lowercased()
        let operation = UUID().uuidString.lowercased()
        let item = ConversationMemoryItemDecision(idempotency_key: operation, expected_proposal_revision: 1,
            expected_review_revision: 1, item_id: UUID().uuidString.lowercased(), expected_item_added_revision: 1,
            expected_item_version: 1, contact_decision: "skip", decision: "confirm", edited_text: "Synthetic source-linked detail")
        let protected = try JSONEncoder().encode(ConversationMemoryPendingIntent(operationKey: operation, item: item))
        let intents = KeychainConversationMemoryOperationStore()
        defer { try? intents.remove(key: key); consumer.release() }
        try intents.save(protected, key: key)
        var capability = original.persistent!
        let nextToken = "synthetic-lease-next-" + sessionID
        capability.remember(token: nextToken, endpoint: endpoint)
        let rotated = TalentSignalSession(baseURL: endpoint, accessToken: nextToken, expiresAt: Date() + 8 * 3600,
            account: original.account, user: original.user, sessionID: sessionID, persistent: capability)
        IOSSessionFamilyRegistry.shared.remember(rotated)
        let next = try XCTUnwrap(AgentSessionActiveRefreshConsumer.lease(endpoint: endpoint, accessToken: nextToken,
            accountID: original.account.id, userID: original.user.id, openSessionID: openID))
        XCTAssertEqual(first, next, "The actual SwiftUI task identity must not restart on access rotation")
        XCTAssertEqual(first.hashValue, next.hashValue)
        XCTAssertEqual(consumer.registryScope, next.scopeID)
        XCTAssertFalse(consumer.isReleased)
        let stillCurrent = await memoryClient.isCurrentScope()
        XCTAssertTrue(stillCurrent)
        XCTAssertEqual(try intents.load(key: key), protected)
        XCTAssertEqual(sessions.globalDraft(), "Synthetic draft retained across access rotation")
        let newID = UUID().uuidString.lowercased(), newToken = "synthetic-another-login-" + sessionID
        let different = TalentSignalSession(baseURL: endpoint, accessToken: newToken, expiresAt: Date() + 8 * 3600,
            account: original.account, user: original.user, sessionID: newID,
            persistent: .init(secret: String(repeating: "D", count: 43), sessionID: newID, enrolled: true, accessFingerprints: []))
        IOSSessionFamilyRegistry.shared.remember(different)
        let changed = try XCTUnwrap(AgentSessionActiveRefreshConsumer.lease(endpoint: endpoint, accessToken: newToken,
            accountID: original.account.id, userID: original.user.id, openSessionID: openID))
        XCTAssertNotEqual(first, changed)
        consumer.release()
        let oldScopeStillCurrent = await memoryClient.isCurrentScope()
        XCTAssertFalse(oldScopeStillCurrent)
        XCTAssertNil(try intents.load(key: key), "A real scope release still retires only its protected operation authority")
        XCTAssertEqual(sessions.globalDraft(), "Synthetic draft retained across access rotation")
    }

    func testLegacyEndingRemovesItsMigratedPendingSlotAndPreservesNewLogin() throws {
        let service = "persistent-legacy-removal-" + UUID().uuidString
        let keychain = KeychainTalentSignalSessionStore(baseURL: endpoint, service: service)
        defer { try? keychain.delete() }
        var original = login(); original.sessionID = nil
        let ending = AppSessionEnding(session: original)
        var migrated = original; migrated.sessionID = sessionID
        migrated.persistent = try IOSPersistentSessionCredential.pending(session: migrated)
        try keychain.save(migrated)
        XCTAssertTrue(try keychain.removeEndingCredential(ending))
        XCTAssertNil(try keychain.load(), "A raw-token ending must find the exact slot after pending migration")
        // The production Keychain codec uses ISO-8601 whole seconds. Keep this
        // fixture at that precision so full equality still verifies every
        // identity, token, capability and active-slot field after readback.
        let expiry = Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970) + 3600)
        var newer = try persistent(login(token: "synthetic-distinct-login-" + sessionID, expires: expiry))
        let newID = UUID().uuidString.lowercased()
        newer.sessionID = newID
        newer.persistent = .init(secret: String(repeating: "E", count: 43), sessionID: newID, enrolled: true, accessFingerprints: [])
        try keychain.save(newer)
        XCTAssertTrue(try keychain.removeEndingCredential(ending))
        XCTAssertEqual(try keychain.load(), newer, "Removal of the old ending must preserve a new primary login for the same person")
    }

    private nonisolated func body(_ request: URLRequest) throws -> [String: Any] {
        var bytes = request.httpBody
        if bytes == nil, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var data = Data(), buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; data.append(buffer, count: n) }
            bytes = data
        }
        return try JSONSerialization.jsonObject(with: XCTUnwrap(bytes)) as! [String: Any]
    }
}

private final class PersistentMemorySessions: TalentSignalSessionPersisting, @unchecked Sendable {
    var value: TalentSignalSession?
    var readFailure: Error?
    var deleteFailure: Error?
    init(_ value: TalentSignalSession? = nil) { self.value = value }
    func load() throws -> TalentSignalSession? { if let readFailure { throw readFailure }; return value }
    func save(_ session: TalentSignalSession) throws { value = session }
    func delete() throws { if let deleteFailure { throw deleteFailure }; value = nil }
}

private final class PersistentRouteRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String] = []
    var paths: [String] { lock.lock(); defer { lock.unlock() }; return values }
    func append(_ path: String) { lock.lock(); defer { lock.unlock() }; values.append(path) }
}

private final class PersistentEndpointSelection: @unchecked Sendable {
    var endpoint: URL
    init(_ endpoint: URL) { self.endpoint = endpoint }
}

private final class PersistentAuthenticationStub: AppAuthenticationServing {
    let supportsPersistentSessions = true
    var response: TalentSignalSession
    var failure: Error?
    var suspend = false
    var validations = 0, logouts = 0
    var continuation: CheckedContinuation<TalentSignalSession, Error>?
    init(response: TalentSignalSession) { self.response = response }
    func challenge() async throws -> AppleLoginChallenge { throw URLError(.notConnectedToInternet) }
    func signIn(identityToken: String, challengeID: String, givenName: String?, familyName: String?) async throws -> TalentSignalSession { response }
    func validate(_ stored: TalentSignalSession) async throws -> TalentSignalSession {
        validations += 1
        if let failure { throw failure }
        if suspend { return try await withCheckedThrowingContinuation { continuation = $0 } }
        return response
    }
    func logout(_ stored: TalentSignalSession) async throws { logouts += 1; if let failure { throw failure } }
}

private final class PersistentLegacyMigrationStub: AppAuthenticationServing {
    let supportsPersistentSessions = true
    let sessionID: String
    var legacyReads = 0
    var committedSecret: String?
    var legacyReadback: CheckedContinuation<TalentSignalSession, Error>?
    init(sessionID: String) { self.sessionID = sessionID }
    func challenge() async throws -> AppleLoginChallenge { throw URLError(.notConnectedToInternet) }
    func signIn(identityToken: String, challengeID: String, givenName: String?, familyName: String?) async throws -> TalentSignalSession { throw URLError(.unsupportedURL) }
    func validate(_ stored: TalentSignalSession) async throws -> TalentSignalSession {
        guard var capability = stored.persistent else {
            legacyReads += 1
            return try await withCheckedThrowingContinuation { legacyReadback = $0 }
        }
        guard let committedSecret else {
            self.committedSecret = capability.secret
            throw URLError(.networkConnectionLost)
        }
        guard committedSecret == capability.secret else { throw AppSessionError.scopeMismatch }
        capability.enrolled = true
        return .init(baseURL: stored.baseURL, accessToken: "synthetic-after-lost-response", expiresAt: Date() + 8 * 3600,
            account: stored.account, user: stored.user, sessionID: sessionID, persistent: capability)
    }
    func logout(_ stored: TalentSignalSession) async throws { }
}

private final class PersistentAuthenticationURLProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (Int, [String: Any]))?
    static var streamBody: String?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "persistent-ios.example.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let handler = Self.handler else { throw URLError(.badURL) }
            let (status, object) = try handler(request)
            let stream = request.url!.path.hasSuffix("/stream") ? Self.streamBody : nil
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["content-type": stream == nil ? "application/json" : "text/event-stream"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try stream.map { Data($0.utf8) } ?? JSONSerialization.data(withJSONObject: object))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}
