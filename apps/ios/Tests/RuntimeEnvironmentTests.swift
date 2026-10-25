import CryptoKit
import Foundation
import XCTest
@testable import TalentSignal

@MainActor
final class RuntimeEnvironmentTests: XCTestCase {
    private let firstURL = URL(string: "https://first.example.test")!
    private let secondURL = URL(string: "https://second.example.test")!

    func testDirectoryAcceptsOnlyApprovedTargetsAndRestoresSelection() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let target = RuntimeEnvironmentProfile(id: "second", name: "Second", endpoint: secondURL, expectedDeploymentID: "second-deploy")
        let bad = RuntimeEnvironmentProfile(id: "bad", name: "Bad", endpoint: URL(string: "https://secret@other.test")!, expectedDeploymentID: nil)
        let info: [String: Any] = ["TalentSignalEnvironmentProfilesBase64URL": try JSONEncoder().encode([target, bad]).base64EncodedString()]
        let directory = RuntimeEnvironmentDirectory(buildEndpoint: firstURL, info: info, defaults: defaults, allowsLoopbackHTTP: false)
        XCTAssertEqual(directory.profiles.count, 2)
        try directory.saveSelection(target)
        XCTAssertEqual(RuntimeEnvironmentDirectory(buildEndpoint: firstURL, info: info, defaults: defaults).selected, target)
        XCTAssertThrowsError(try directory.saveSelection(bad))
        XCTAssertFalse(RuntimeEndpoint.permitted(URL(string: "http://192.168.1.2")!, allowsLoopbackHTTP: true))
        XCTAssertTrue(RuntimeEndpoint.same(firstURL, URL(string: "https://FIRST.example.test:443/")!))
    }

    func testSecureCredentialsCannotCrossEnvironmentsOrIdentitySlots() throws {
        let service = "lab-runtime-unit-" + UUID().uuidString
        let first = KeychainTalentSignalSessionStore(baseURL: firstURL, service: service)
        let second = KeychainTalentSignalSessionStore(baseURL: secondURL, service: service)
        defer { try? first.delete(); try? second.delete() }
        let a = session(firstURL, token: "fixture-a")
        let b = session(secondURL, token: "fixture-b")
        try first.save(a)
        XCTAssertNil(try second.load())
        XCTAssertThrowsError(try second.save(a))
        try second.save(b)
        XCTAssertEqual(try first.load(), a)
        XCTAssertEqual(try second.load(), b)
        try first.delete()
        XCTAssertNil(try first.load())
        XCTAssertEqual(try second.load(), b)
    }

    func testLegacyCredentialMigratesOnlyIntoItsVerifiedEndpoint() throws {
        let service = "lab-runtime-migration-" + UUID().uuidString
        let legacy = KeychainTalentSignalSessionStore(service: service)
        let a = KeychainTalentSignalSessionStore(baseURL: firstURL, service: service)
        let b = KeychainTalentSignalSessionStore(baseURL: secondURL, service: service)
        defer { try? legacy.delete(); try? a.delete(); try? b.delete() }
        let original = session(firstURL, token: "legacy-fixture")
        try legacy.save(original)
        XCTAssertNil(try b.load())
        XCTAssertEqual(try legacy.load(), original)
        XCTAssertEqual(try a.load(), original)
        XCTAssertNil(try legacy.load())
    }

    func testLateOldEnvironmentResponseCannotOverwriteNewWorkspace() async throws {
        let a = session(firstURL, token: "fixture-a")
        let b = session(secondURL, token: "fixture-b")
        let firstPersistence = RuntimeMemorySession(a)
        let secondPersistence = RuntimeMemorySession(b)
        let firstClient = RuntimeAuthenticationStub()
        firstClient.suspend = true
        let secondClient = RuntimeAuthenticationStub()
        let store = AppSessionStore(baseURL: firstURL, persistence: firstPersistence, client: firstClient,
            endingFactory: { _ in MemoryAppSessionEndings() }, clientFactory: { _ in secondClient }, persistenceFactory: { _ in secondPersistence })
        let restoring = Task { await store.restore() }
        let deadline = Date().addingTimeInterval(5)
        while firstClient.continuation == nil && Date() < deadline { await Task.yield() }
        guard firstClient.continuation != nil else { restoring.cancel(); XCTFail("Old environment validation did not start within 5 seconds"); return }
        let oldGeneration = store.contextGeneration
        try await store.activateEnvironment(secondURL)
        XCTAssertEqual(store.phase, .signedIn(b))
        XCTAssertNotEqual(store.contextGeneration, oldGeneration)
        firstClient.continuation?.resume(returning: a)
        await restoring.value
        XCTAssertEqual(store.phase, .signedIn(b))
        XCTAssertEqual(store.baseURL, secondURL)
        XCTAssertEqual(firstPersistence.saveCount, 0)
        XCTAssertEqual(secondPersistence.saveCount, 1)
    }

    func testTargetOfflineNeverDisplaysUnvalidatedSavedWorkspace() async throws {
        let target = RuntimeMemorySession(session(secondURL, token: "fixture-b"))
        let client = RuntimeAuthenticationStub()
        client.failure = URLError(.notConnectedToInternet)
        let store = AppSessionStore(baseURL: firstURL, persistence: RuntimeMemorySession(nil), client: RuntimeAuthenticationStub(),
            endingFactory: { _ in MemoryAppSessionEndings() }, clientFactory: { _ in client }, persistenceFactory: { _ in target })
        try await store.activateEnvironment(secondURL)
        XCTAssertEqual(store.phase, .restoring, "An offline target remains retryable without credential loss")
        XCTAssertEqual(store.baseURL, secondURL)
        XCTAssertNotNil(target.value)
        XCTAssertNotNil(store.notice)
    }

    func testMismatchedStoredEndpointIsRejectedBeforeSendingAToken() async {
        let client = RuntimeAuthenticationStub()
        let store = AppSessionStore(baseURL: firstURL, persistence: RuntimeMemorySession(session(secondURL, token: "must-not-send")), client: client, endings: MemoryAppSessionEndings())
        await store.restore()
        XCTAssertEqual(client.validations, 0)
        XCTAssertEqual(store.phase, .restoring, "A scope mismatch withholds content and preserves the record for recovery")
    }

    func testRedirectGuardRefusesCredentialForwarding() async throws {
        let network = URLSession(configuration: .ephemeral)
        let request = URLRequest(url: firstURL)
        let task = network.dataTask(with: request)
        let response = HTTPURLResponse(url: firstURL, statusCode: 307, httpVersion: nil, headerFields: ["Location": secondURL.absoluteString])!
        let guardDelegate = RuntimeRedirectGuard()
        var redirected = true
        guardDelegate.urlSession(network, task: task, willPerformHTTPRedirection: response,
            newRequest: URLRequest(url: secondURL)) { redirected = $0 != nil }
        XCTAssertFalse(redirected)
        network.invalidateAndCancel()
    }

    func testSwitchIsReverifiedBlockedDuringWorkAndRestoresScopedSession() async throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let target = RuntimeEnvironmentProfile(id: "second", name: "Second", endpoint: secondURL, expectedDeploymentID: "second-deploy")
        let directory = RuntimeEnvironmentDirectory(buildEndpoint: firstURL, info: [
            "TalentSignalEnvironmentProfilesBase64URL": try JSONEncoder().encode([target]).base64EncodedString()], defaults: defaults)
        let a = session(firstURL, token: "fixture-a")
        let b = session(secondURL, token: "fixture-b")
        let first = RuntimeMemorySession(a), second = RuntimeMemorySession(b)
        let client = RuntimeAuthenticationStub()
        let store = AppSessionStore(baseURL: firstURL, persistence: first, client: client,
            endingFactory: { _ in MemoryAppSessionEndings() }, clientFactory: { _ in client }, persistenceFactory: { RuntimeEndpoint.same($0!, self.firstURL) ? first : second })
        await store.restore()
        let verifier = RuntimePreflightStub()
        let runtime = LabRuntimeStore(directory: directory, sessionStore: store, preflight: verifier, defaults: defaults)
        await runtime.inspect(target)
        let active = try RuntimeWorkRegistry.shared.begin(.recording)
        await runtime.activateVerifiedTarget()
        XCTAssertEqual(store.phase, .signedIn(a))
        XCTAssertEqual(directory.selected?.id, "build-default")
        RuntimeWorkRegistry.shared.end(active)
        await runtime.activateVerifiedTarget()
        XCTAssertEqual(store.phase, .signedIn(b))
        XCTAssertEqual(directory.selected, target)
        XCTAssertEqual(verifier.calls, 2)
        let restored = LabRuntimeStore(directory: directory, sessionStore: store, preflight: verifier, defaults: defaults)
        XCTAssertEqual(restored.receipt, runtime.receipt)
        await runtime.inspect(directory.profiles[0])
        await runtime.activateVerifiedTarget()
        XCTAssertEqual(store.phase, .signedIn(a))
        XCTAssertEqual(first.value, a)
        XCTAssertEqual(second.value, b)
    }

    func testChangedDeploymentAndFailedRelaunchNeverSendStoredCredentials() async throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let target = RuntimeEnvironmentProfile(id: "second", name: "Second", endpoint: secondURL, expectedDeploymentID: "second-deploy")
        let directory = RuntimeEnvironmentDirectory(buildEndpoint: firstURL, info: [
            "TalentSignalEnvironmentProfilesBase64URL": try JSONEncoder().encode([target]).base64EncodedString()], defaults: defaults)
        let client = RuntimeAuthenticationStub()
        let store = AppSessionStore(baseURL: firstURL, persistence: RuntimeMemorySession(nil), client: client, endings: MemoryAppSessionEndings())
        let verifier = RuntimePreflightStub()
        let runtime = LabRuntimeStore(directory: directory, sessionStore: store, preflight: verifier, defaults: defaults)
        await runtime.inspect(target)
        verifier.revision = "changed"
        await runtime.activateVerifiedTarget()
        XCTAssertEqual(store.baseURL, firstURL)
        XCTAssertEqual(directory.selected?.id, "build-default")
        XCTAssertNotNil(runtime.error)
        try directory.saveSelection(target)
        verifier.failure = RuntimeEnvironmentError.identityMismatch
        let targetStore = AppSessionStore(baseURL: secondURL, persistence: RuntimeMemorySession(session(secondURL, token: "must-not-send")), client: client, endings: MemoryAppSessionEndings())
        let relaunched = LabRuntimeStore(directory: directory, sessionStore: targetStore, preflight: verifier, defaults: defaults)
        await relaunched.restoreSelectedEnvironment()
        await targetStore.prepareChallenge()
        XCTAssertEqual(client.validations, 0)
        XCTAssertEqual(client.challenges, 0)
        XCTAssertEqual(targetStore.phase, .signedOut)
    }

    func testCaptureOwnershipRetainsOriginalOperationAndRejectsCrossScopeDrafts() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let inbox = PendingCaptureInbox(directoryURL: directory)
        let seed = try await inbox.stage(imageData: Data([1, 2, 3]), fileName: "synthetic.png", mediaType: "image/png", origin: .appShortcut)
        try await inbox.claim(id: seed.id, scope: "environment-a")
        try await inbox.saveDraft(.empty, for: seed.id, scope: "environment-a")
        let wrong = try await inbox.load(scope: "environment-b")
        let unassigned = try await inbox.load()
        XCTAssertNil(wrong); XCTAssertNil(unassigned)
        do { try await inbox.claim(id: seed.id, scope: "environment-b"); XCTFail("Ownership must remain with A") } catch {}
        do { try await inbox.saveDraft(.empty, for: seed.id, scope: "environment-b"); XCTFail("B must not overwrite A") } catch {}
        let restored = try await PendingCaptureInbox(directoryURL: directory).load(scope: "environment-a")
        XCTAssertEqual(restored?.id, seed.id)
        XCTAssertEqual(restored?.imageData, seed.imageData)
    }

    func testLegacyFileMigrationRequiresOriginBindingAndPreservesDeletionIntent() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let a = session(firstURL, token: "fixture")
        let scope = RuntimeEndpoint.scope(firstURL, accountID: a.account.id, userID: a.user.id)
        let source = directory.appending(path: SHA256.hex(a.account.id) + ".json")
        let target = directory.appending(path: SHA256.hex(scope) + ".json")
        try Data("synthetic".utf8).write(to: source)
        try Data().write(to: source.appendingPathExtension("deletion-pending"))
        try RuntimeLegacyBindings.migrateFile(legacyAccountID: a.account.id, scope: scope, directory: directory, destination: target, defaults: defaults)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        RuntimeLegacyBindings.bind(a, defaults: defaults)
        try RuntimeLegacyBindings.migrateFile(legacyAccountID: a.account.id, scope: scope, directory: directory, destination: target, defaults: defaults)
        XCTAssertTrue(FileManager.default.fileExists(atPath: target.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: target.appendingPathExtension("deletion-pending").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: source.path))
        try FileManager.default.removeItem(at: target)
        try RuntimeLegacyBindings.migrateFile(legacyAccountID: a.account.id, scope: scope, directory: directory, destination: target, defaults: defaults)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path), "Deleted data must not resurrect")
    }

    func testProfileReferencesDoNotFollowMatchingWorkspaceIDsAcrossBackends() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let a = AgentProfileReferenceStore(workspaceID: "same-id", runtimeScope: "environment-a", defaults: defaults)
        XCTAssertTrue(a.upsert(platform: .linkedIn, value: "https://www.linkedin.com/in/synthetic-person"))
        let b = AgentProfileReferenceStore(workspaceID: "same-id", runtimeScope: "environment-b", defaults: defaults)
        XCTAssertTrue(b.references.isEmpty)
        XCTAssertFalse(b.migrateLegacyLinkedIn("https://www.linkedin.com/in/legacy-person"))
        XCTAssertTrue(AgentProfileReferenceStore.deleteAll(workspaceID: "same-id", runtimeScope: "environment-b", defaults: defaults))
        XCTAssertEqual(AgentProfileReferenceStore(workspaceID: "same-id", runtimeScope: "environment-a", defaults: defaults).references.count, 1)
    }

    func testConflictingLegacyDirectoryCannotOverwriteOrResurrectScopedContent() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let source = root.appending(path: "legacy/records")
        let destination = root.appending(path: "scoped/records")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        let a = source.appending(path: "same-id.json"), b = destination.appending(path: "same-id.json")
        try Data("original".utf8).write(to: a)
        try Data("changed".utf8).write(to: b)
        XCTAssertThrowsError(try RuntimeLegacyBindings.migrateDirectory(source: source, destination: destination))
        XCTAssertEqual(try Data(contentsOf: a), Data("original".utf8))
        XCTAssertEqual(try Data(contentsOf: b), Data("changed".utf8))
        try Data("original".utf8).write(to: b)
        try RuntimeLegacyBindings.migrateDirectory(source: source, destination: destination)
        XCTAssertFalse(FileManager.default.fileExists(atPath: source.path))
        try FileManager.default.removeItem(at: b)
        try RuntimeLegacyBindings.migrateDirectory(source: source, destination: destination)
        XCTAssertFalse(FileManager.default.fileExists(atPath: b.path))
    }

    private func session(_ url: URL, token: String) -> TalentSignalSession {
        .init(baseURL: url, accessToken: token, expiresAt: Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970) + 3600),
            account: .init(id: "same-account-id", slug: "same-slug", name: "Fixture"),
            user: .init(id: "same-user-id", email: "fixture@example.test", displayName: "Fixture", kind: "simulated_human"))
    }
}

private final class RuntimeMemorySession: TalentSignalSessionPersisting {
    var value: TalentSignalSession?
    var saveCount = 0
    init(_ value: TalentSignalSession?) { self.value = value }
    func load() throws -> TalentSignalSession? { value }
    func save(_ session: TalentSignalSession) throws { value = session; saveCount += 1 }
    func delete() throws { value = nil }
}

private final class RuntimeAuthenticationStub: AppAuthenticationServing {
    var validations = 0
    var challenges = 0
    var suspend = false
    var continuation: CheckedContinuation<TalentSignalSession, Never>?
    var failure: Error?
    func challenge() async throws -> AppleLoginChallenge {
        challenges += 1
        return .init(contractVersion: TalentSignalAPIContract.version, id: "fixture", nonce: "fixture", expiresAt: .now.addingTimeInterval(100))
    }
    func signIn(identityToken: String, challengeID: String, givenName: String?, familyName: String?) async throws -> TalentSignalSession {
        throw AppSessionError.invalidIdentityToken
    }
    func validate(_ stored: TalentSignalSession) async throws -> TalentSignalSession {
        validations += 1
        if let failure { throw failure }
        if suspend { return await withCheckedContinuation { continuation = $0 } }
        return stored
    }
    func logout(_ stored: TalentSignalSession) async throws { if let failure { throw failure } }
}


private final class RuntimePreflightStub: RuntimePreflighting {
    var calls = 0
    var revision = "fixture-revision"
    var failure: Error?
    func verify(_ target: RuntimeEnvironmentProfile) async throws -> VerifiedRuntimeTarget {
        calls += 1
        if let failure { throw failure }
        return .init(profile: target, manifest: .init(service: "talent-signal",
            contract_version: TalentSignalAPIContract.version, deployment_id: target.expectedDeploymentID ?? "first-deploy",
            revision: revision, data_domain: "synthetic", internal_lab_enabled: true,
            authentication: .init(apple: true, password: false, simulated: false)), checkedAt: .now)
    }
}
