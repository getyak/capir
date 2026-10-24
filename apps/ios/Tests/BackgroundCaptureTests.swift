import XCTest
import Darwin
import Security
@testable import TalentSignal

final class BackgroundCaptureTests: XCTestCase {
    func testCaptureFreezesOwnerAndRequestAcrossRoundTrip() throws {
        let auth = TalentSignalSession(baseURL: URL(string: "https://api.example.test")!, accessToken: "synthetic",
            expiresAt: Date().addingTimeInterval(3600), account: .init(id: "account-a", slug: "a", name: "A"),
            user: .init(id: "user-a", email: "a@example.test", displayName: "A", kind: "human"))
        let original = BackgroundCaptureRecord(session: auth, now: Date(timeIntervalSince1970: 1792800000))
        let restored = try JSONDecoder.agentSession.decode(BackgroundCaptureRecord.self,
            from: JSONEncoder.agentSession.encode(original))
        XCTAssertEqual(restored.sessionID, original.sessionID)
        XCTAssertEqual(restored.messageID, original.messageID)
        XCTAssertEqual(restored.idempotencyKey, original.idempotencyKey)
        XCTAssertTrue(restored.belongs(to: auth))
        let other = TalentSignalSession(baseURL: auth.baseURL, accessToken: "other", expiresAt: auth.expiresAt,
            account: .init(id: "account-b", slug: "b", name: "B"), user: auth.user)
        XCTAssertFalse(restored.belongs(to: other))
    }

    func testActivityPayloadCarriesOnlyOpaqueIdentityAndStage() throws {
        let attributes = CaptureActivityAttributes(workspaceID: UUID().uuidString.lowercased(),
            sessionID: UUID().uuidString.lowercased(), activityInstanceID: UUID().uuidString.lowercased())
        let state = CaptureActivityAttributes.ContentState(phase: .saved, eventRevision: 1, updatedAtEpochSeconds: 1792800000)
        let bytes = try JSONEncoder().encode(state)
        let text = String(decoding: bytes, as: UTF8.self)
        XCTAssertFalse(text.contains("screenshot"))
        XCTAssertFalse(text.contains("name"))
        XCTAssertEqual(attributes.askIdentity.sessionID, attributes.sessionID)
        XCTAssertEqual(CaptureActivityPhase.processing.title, "Processing")
    }

    func testUnknownTransferRetainsBodyAndOriginalIdentity() async throws {
        let (directory, record, delivery) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        await delivery.transferred(id: record.id, status: nil, data: Data(), failed: true)
        let restored = try await delivery.records().first!
        XCTAssertEqual(restored.idempotencyKey, record.idempotencyKey)
        XCTAssertEqual(restored.sessionID, record.sessionID)
        XCTAssertEqual(restored.stage, .failed)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appending(path: record.id.uuidString + ".upload").path))
    }

    func testAdmissionMustMatchExactSessionAndMessageBeforeRemovingPixels() async throws {
        let (directory, record, delivery) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        let wrong = try receipt(record, messageID: UUID())
        await delivery.transferred(id: record.id, status: 202, data: wrong, failed: false)
        let rejected = try await delivery.records().first!
        XCTAssertEqual(rejected.stage, .failed)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appending(path: record.id.uuidString + ".upload").path))
        await delivery.transferred(id: record.id, status: 202, data: try receipt(record), failed: false)
        let admitted = try await delivery.records().first!
        XCTAssertEqual(admitted.stage, .admitted)
        XCTAssertNotNil(admitted.queueEntryID)
        XCTAssertEqual(admitted.sessionID, record.sessionID)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appending(path: record.id.uuidString + ".upload").path))
    }

    func testPendingLogoutJournalBlocksRetainedValidCredential() throws {
        let auth = syntheticSession()
        var ending = AppSessionEnding(session: auth)
        ending.local = .failed; ending.remote = .unverified
        XCTAssertThrowsError(try BackgroundCaptureAuthorization.validatedSession(endpoint: auth.baseURL,
            sessions: CaptureSessionFixture(auth), endings: CaptureEndingFixture([ending])))
        XCTAssertNoThrow(try BackgroundCaptureAuthorization.validatedSession(endpoint: auth.baseURL,
            sessions: CaptureSessionFixture(auth), endings: CaptureEndingFixture([])))
    }

    func testUnreadableLogoutJournalBlocksNormalAndFrozenAuthorization() throws {
        let auth = syntheticSession()
        let journal = CaptureEndingFixture([], unreadable: true)
        XCTAssertThrowsError(try BackgroundCaptureAuthorization.validatedSession(endpoint: auth.baseURL,
            sessions: CaptureSessionFixture(auth), endings: journal))
        XCTAssertThrowsError(try BackgroundCaptureAuthorization.assertNoEnding(endpoint: auth.baseURL,
            token: auth.accessToken, endings: journal))
    }

    func testCancellationWinsOverAnAwaitingOSRegistration() async throws {
        let (directory, initial, _) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        var record = initial; record.stage = .admitted
        try write(record, directory: directory)
        let scheduled = CaptureScheduledRegistrations()
        let delivery = BackgroundCaptureDelivery(directory: directory, credentialProvider: { _ in "synthetic" },
            registrationScheduler: { request, file, id, kind in await scheduled.append(request, file, id, kind) })
        await delivery.recordActivityToken(recordID: record.id, token: "a")
        await delivery.registerToken(record.id)
        let value = await scheduled.first()
        let request = try XCTUnwrap(value)
        await delivery.cancelSession(record.sessionID)
        await BackgroundCaptureTransfer.dispatchCompletion(description: record.id.uuidString + "|" + request.kind,
            status: 200, data: Data(), failed: false, authorization: "synthetic", requestURL: request.request.url, delivery: delivery)
        await delivery.recordActivityToken(recordID: record.id, token: "b")
        let final = try await delivery.records().first!
        XCTAssertEqual(final.stage, .cancelled); XCTAssertNil(final.activityToken); XCTAssertFalse(final.tokenRegistered)
        XCTAssertFalse(FileManager.default.fileExists(atPath: request.file.path))
    }

    @MainActor
    func testForegroundCannotCreatePendingBackgroundSessionWithNewOperation() async throws {
        let record = BackgroundCaptureRecord(session: syntheticSession())
        let sessions = AgentSessionStore(persistence: CaptureMemorySessionPersistence())
        sessions.importBackgroundCapture(record.localSessionPayload)
        let service = CaptureSessionSyncFixture()
        _ = await sessions.synchronize(using: service)
        XCTAssertEqual(service.puts, 0)
        XCTAssertTrue(try XCTUnwrap(sessions.session(id: record.sessionID)).backgroundCapturePendingAdmission)
    }

    func testLostResponseRecoversCanonicalSameMessageWithoutNewAdmission() async throws {
        let (directory, record, _) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        let entry = try JSONDecoder().decode(ConversationImageQueueEntry.self, from: JSONSerialization.data(withJSONObject:
            ["queue_entry_id": UUID().uuidString, "message_id": record.messageID.uuidString, "status": "queued"]))
        let remote = AgentSessionRemoteRecord(sessionID: record.sessionID, revision: 1, updatedAt: Date(),
            expiresAt: Date().addingTimeInterval(3600), deletedAt: nil, payload: record.sessionPayload)
        var prepared = record; prepared.images = []
        try write(prepared, directory: directory)
        let delivery = BackgroundCaptureDelivery(directory: directory, credentialProvider: { _ in "synthetic" },
            recoveryReader: { _, _ in ConversationImageObservation(record: remote, entry: entry) })
        await delivery.transferred(id: record.id, status: nil, data: Data(), failed: true)
        let final = try await delivery.records().first!
        XCTAssertEqual(final.stage, .admitted)
        XCTAssertEqual(final.sessionID, record.sessionID)
        XCTAssertEqual(final.messageID, record.messageID)
        XCTAssertEqual(final.recoveryAttempts, 1)
        XCTAssertEqual(final.queueEntryID, entry.queueEntryID)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appending(path: record.id.uuidString + ".upload").path))
    }

    func testLateTokenUsesActualGenerationOutboxAndOldOSAcknowledgementCannotReplaceRotation() async throws {
        let (directory, initial, _) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        var record = initial; record.stage = .admitted
        try write(record, directory: directory)
        let scheduled = CaptureScheduledRegistrations()
        let delivery = BackgroundCaptureDelivery(directory: directory, credentialProvider: { _ in "synthetic" },
            registrationScheduler: { request, file, id, kind in await scheduled.append(request, file, id, kind) })
        await delivery.recordActivityToken(recordID: record.id, token: "a")
        await delivery.registerToken(record.id)
        let firstScheduled = await scheduled.first()
        let old = try XCTUnwrap(firstScheduled)
        XCTAssertEqual(old.request.httpMethod, "POST")
        XCTAssertEqual(old.request.url?.path, "/v1/agent-sessions/" + record.sessionID.uuidString.lowercased() + "/capture-activity")
        XCTAssertEqual(old.request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic")
        XCTAssertNil(old.request.httpBody)
        XCTAssertEqual(old.id, record.id)
        let oldBody = try JSONSerialization.jsonObject(with: Data(contentsOf: old.file)) as! [String: Any]
        let oldGeneration = try XCTUnwrap(oldBody["token_generation"] as? Int)
        XCTAssertEqual(old.kind, "activity-\(oldGeneration)")
        XCTAssertEqual(oldBody["message_id"] as? String, record.messageID.uuidString.lowercased())
        XCTAssertEqual(oldBody["token"] as? String, "a")
        await delivery.recordActivityToken(recordID: record.id, token: "b")
        await delivery.registerToken(record.id)
        let lastScheduled = await scheduled.last()
        let newest = try XCTUnwrap(lastScheduled)
        await BackgroundCaptureTransfer.dispatchCompletion(description: record.id.uuidString + "|" + old.kind, status: 200, data: Data(), failed: false,
            authorization: "synthetic", requestURL: old.request.url, delivery: delivery)
        var current = try await delivery.records().first!
        XCTAssertEqual(current.activityToken, "b"); XCTAssertFalse(current.tokenRegistered)
        XCTAssertTrue(FileManager.default.fileExists(atPath: newest.file.path))
        for _ in 0..<3 {
            await BackgroundCaptureTransfer.dispatchCompletion(description: record.id.uuidString + "|" + newest.kind,
                status: nil, data: Data(), failed: true, authorization: "synthetic", requestURL: newest.request.url, delivery: delivery)
        }
        let scheduleCount = await scheduled.count()
        XCTAssertEqual(scheduleCount, 4, "Initial two generations plus two bounded retries")
        await BackgroundCaptureTransfer.dispatchCompletion(description: record.id.uuidString + "|" + newest.kind, status: 200, data: Data(), failed: false,
            authorization: "synthetic", requestURL: newest.request.url, delivery: delivery)
        current = try await delivery.records().first!
        XCTAssertTrue(current.tokenRegistered)
        XCTAssertFalse(FileManager.default.fileExists(atPath: newest.file.path))
    }

    func testLogoutDenyMirrorIsMonotonicAndRejectsMissingCorruptOrLockedState() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: "capture-deny-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let endpoint = syntheticSession().baseURL
        let mirror = CaptureLogoutDenyMirror(directory: directory)
        let a = String(repeating: "a", count: 64), b = String(repeating: "b", count: 64)
        XCTAssertThrowsError(try mirror.assertAllowed(endpoint: endpoint, fingerprint: a))
        try mirror.prepare(endpoint: endpoint, fingerprints: [])
        XCTAssertNoThrow(try mirror.assertAllowed(endpoint: endpoint, fingerprint: a))
        try CaptureLogoutDenyMirror(directory: directory).deny(endpoint: endpoint, fingerprints: [a])
        try mirror.prepare(endpoint: endpoint, fingerprints: [b])
        XCTAssertThrowsError(try mirror.assertAllowed(endpoint: endpoint, fingerprint: a))
        XCTAssertThrowsError(try mirror.assertAllowed(endpoint: endpoint, fingerprint: b))
        let lock = directory.appending(path: RuntimeEndpoint.scope(endpoint) + ".json.lock")
        let descriptor = open(lock.path, O_RDWR)
        XCTAssertGreaterThanOrEqual(descriptor, 0)
        XCTAssertEqual(flock(descriptor, LOCK_EX | LOCK_NB), 0)
        XCTAssertThrowsError(try mirror.assertAllowed(endpoint: endpoint, fingerprint: String(repeating: "c", count: 64)))
        flock(descriptor, LOCK_UN); close(descriptor)
        let file = directory.appending(path: RuntimeEndpoint.scope(endpoint) + ".json")
        let bytes = try Data(contentsOf: file)
        XCTAssertFalse(String(decoding: bytes, as: UTF8.self).contains("synthetic"))
        try Data("corrupt".utf8).write(to: file)
        XCTAssertThrowsError(try mirror.prepare(endpoint: endpoint, fingerprints: []))
        XCTAssertThrowsError(try mirror.assertAllowed(endpoint: endpoint, fingerprint: a))
        XCTAssertEqual(try Data(contentsOf: file), Data("corrupt".utf8))
    }

    func testLogoutMirrorFailurePreventsKeychainCommitAndJournalFailureCannotEraseDeny() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: "capture-deny-commit-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let auth = syntheticSession()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let blocked = directory.appending(path: "file-instead-of-directory")
        try Data().write(to: blocked)
        var keychainAttempted = false
        let failedMirrorStore = KeychainAppSessionEndingStore(endpoint: auth.baseURL,
            denyMirror: .init(directory: blocked), beforeProtectedWrite: { keychainAttempted = true })
        XCTAssertThrowsError(try failedMirrorStore.save([AppSessionEnding(session: auth)]))
        XCTAssertFalse(keychainAttempted)
        let mirror = CaptureLogoutDenyMirror(directory: directory.appending(path: "mirror"))
        try mirror.prepare(endpoint: auth.baseURL, fingerprints: [])
        let failedJournalStore = KeychainAppSessionEndingStore(endpoint: auth.baseURL, denyMirror: mirror,
            beforeProtectedWrite: { throw AppSessionEndingError.unreadable })
        XCTAssertThrowsError(try failedJournalStore.save([AppSessionEnding(session: auth)]))
        XCTAssertThrowsError(try mirror.assertAllowed(endpoint: auth.baseURL, fingerprint: AppSessionEnding.fingerprint(auth)))
        try mirror.prepare(endpoint: auth.baseURL, fingerprints: [])
        XCTAssertThrowsError(try mirror.assertAllowed(endpoint: auth.baseURL, fingerprint: AppSessionEnding.fingerprint(auth)))
    }

    func testConcurrentMirrorOwnersMergeWithoutLosingEitherDeny() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: "capture-deny-concurrent-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let endpoint = syntheticSession().baseURL
        let mirror = CaptureLogoutDenyMirror(directory: directory)
        try mirror.prepare(endpoint: endpoint, fingerprints: [])
        let lock = NSLock()
        var successes = 0
        DispatchQueue.concurrentPerform(iterations: 2) { index in
            let owner = CaptureLogoutDenyMirror(directory: directory)
            for _ in 0..<100 {
                do {
                    try owner.deny(endpoint: endpoint, fingerprints: [String(repeating: index == 0 ? "a" : "b", count: 64)])
                    lock.withLock { successes += 1 }; return
                } catch { usleep(1000) }
            }
        }
        XCTAssertEqual(successes, 2)
        XCTAssertThrowsError(try mirror.assertAllowed(endpoint: endpoint, fingerprint: String(repeating: "a", count: 64)))
        XCTAssertThrowsError(try mirror.assertAllowed(endpoint: endpoint, fingerprint: String(repeating: "b", count: 64)))
    }

    func testSessionDeletionDenialFencesOldEpochAndOldCompletion() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "capture-session-deny-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = UUID().uuidString, id = UUID()
        let deny = CaptureSessionDenyStore(rootURL: root)
        let epoch = try deny.initializeFresh(scope: scope)
        XCTAssertNoThrow(try deny.assertAllowed(scope: scope, sessionID: id, epoch: epoch))
        try deny.deny(scope: scope, sessionIDs: [id])
        XCTAssertThrowsError(try deny.assertAllowed(scope: scope, sessionID: id, epoch: epoch))
        let old = FileAgentSessionPersistence(accountID: scope, rootURL: root)
        let newer = FileAgentSessionPersistence(accountID: scope, rootURL: root)
        try old.beginDeletion()
        try newer.beginDeletion()
        XCTAssertThrowsError(try old.completeDeletion())
        XCTAssertTrue(try newer.deletionPending())
        try newer.completeDeletion()
        XCTAssertFalse(try newer.deletionPending())
        XCTAssertThrowsError(try deny.assertAllowed(scope: scope, sessionID: UUID(), epoch: epoch))
        let newEpoch = try deny.epoch(scope: scope)
        XCTAssertGreaterThan(newEpoch, epoch)
        XCTAssertNoThrow(try deny.assertAllowed(scope: scope, sessionID: UUID(), epoch: newEpoch))
    }

    func testFailedPrivateResetWriteRetainsRecoverableDeny() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "capture-session-reset-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = UUID().uuidString
        let persistence = FileAgentSessionPersistence(accountID: scope, rootURL: root)
        let privateDirectory = root.appending(path: "TalentSignal/AgentSessions")
        try FileManager.default.createDirectory(at: privateDirectory.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("block-private-marker-write".utf8).write(to: privateDirectory)
        XCTAssertThrowsError(try persistence.beginDeletion())
        XCTAssertTrue(try persistence.deletionPending())
        XCTAssertThrowsError(try CaptureSessionDenyStore(rootURL: root).epoch(scope: scope))
        // Failure preserves the deny; an explicit retry can finish the exact
        // pending reset without rolling the epoch backwards.
        try FileManager.default.removeItem(at: privateDirectory)
        try FileManager.default.createDirectory(at: privateDirectory, withIntermediateDirectories: true)
        try FileAgentSessionPersistence(accountID: scope, rootURL: root).completeDeletion()
        XCTAssertFalse(try persistence.deletionPending())
        XCTAssertGreaterThan(try CaptureSessionDenyStore(rootURL: root).epoch(scope: scope), 0)
    }

    func testLockedResolverCannotInitializeMissingSessionDenyOrBypassLaterLogout() async throws {
        let (directory, initial, _) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        let auth = TalentSignalSession(baseURL: initial.baseURL, accessToken: "synthetic",
            expiresAt: Date().addingTimeInterval(3600), account: .init(id: initial.accountID, slug: "synthetic", name: "Synthetic"),
            user: .init(id: initial.userID, email: "synthetic@example.invalid", displayName: "Synthetic", kind: "human"))
        BackgroundCaptureAuthorization.enable(auth)
        defer { UserDefaults.standard.removeObject(forKey: "talent-signal.capture.send-enabled." + initial.runtimeScope) }
        let logout = CaptureLogoutDenyMirror(directory: directory.appending(path: "logout"))
        try logout.prepare(endpoint: initial.baseURL, fingerprints: [])
        let local = CaptureSessionDenyStore(rootURL: directory)
        var record = initial; record.localDeletionEpoch = 0; record.activityToken = "a"; record.tokenGeneration = 1
        try write(record, directory: directory)
        let scheduled = CaptureScheduledRegistrations()
        let delivery = BackgroundCaptureDelivery(directory: directory,
            registrationScheduler: { request, file, id, kind in await scheduled.append(request, file, id, kind) },
            authorizationReader: { throw AppSessionError.keychain(errSecInteractionNotAllowed) },
            selectedEndpointReader: { initial.baseURL }, logoutDenyMirror: logout, sessionDenials: local)
        let url = initial.baseURL.appending(path: "v1/capture-admissions/" + initial.sessionID.uuidString.lowercased())
        await BackgroundCaptureTransfer.dispatchCompletion(description: initial.id.uuidString + "|message", status: 202,
            data: try receipt(initial), failed: false, authorization: "synthetic", requestURL: url, delivery: delivery)
        let firstCount = await scheduled.count()
        XCTAssertEqual(firstCount, 0)
        XCTAssertThrowsError(try local.epoch(scope: initial.runtimeScope), "Locked resolver must not initialize missing authority")
        let newEpoch = try local.initializeFresh(scope: initial.runtimeScope)
        await delivery.registerToken(initial.id)
        let rebuiltCount = await scheduled.count()
        XCTAssertEqual(rebuiltCount, 0, "A rebuilt mirror must not match an old capture generation")
        var fresh = BackgroundCaptureRecord(session: auth)
        fresh.localDeletionEpoch = newEpoch; fresh.activityToken = "a"; fresh.tokenGeneration = 1
        try write(fresh, directory: directory)
        let freshURL = fresh.baseURL.appending(path: "v1/capture-admissions/" + fresh.sessionID.uuidString.lowercased())
        await BackgroundCaptureTransfer.dispatchCompletion(description: fresh.id.uuidString + "|message", status: 202,
            data: try receipt(fresh), failed: false, authorization: "synthetic", requestURL: freshURL, delivery: delivery)
        let allowedCount = await scheduled.count()
        XCTAssertEqual(allowedCount, 1, "An existing authorized epoch may continue without reading private history while locked")
        try logout.deny(endpoint: initial.baseURL, fingerprints: [AppSessionEnding.fingerprint(auth)])
        await delivery.recordActivityToken(recordID: fresh.id, token: "b")
        await delivery.registerToken(fresh.id)
        let deniedCount = await scheduled.count()
        XCTAssertEqual(deniedCount, 1, "A later logout denies the exact frozen OS authorization")
    }

    @MainActor
    func testNormalResolverRejectsCorruptAndUnsupportedPrivateSessionState() async throws {
        let (directory, initial, _) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        let auth = TalentSignalSession(baseURL: initial.baseURL, accessToken: "synthetic", expiresAt: Date().addingTimeInterval(3600),
            account: .init(id: initial.accountID, slug: "synthetic", name: "Synthetic"),
            user: .init(id: initial.userID, email: "synthetic@example.invalid", displayName: "Synthetic", kind: "human"))
        BackgroundCaptureAuthorization.enable(auth)
        defer { UserDefaults.standard.removeObject(forKey: "talent-signal.capture.send-enabled." + initial.runtimeScope) }
        let local = CaptureSessionDenyStore(rootURL: directory)
        let epoch = try local.initializeFresh(scope: initial.runtimeScope)
        var record = initial; record.stage = .admitted; record.localDeletionEpoch = epoch
        record.activityToken = "a"; record.tokenGeneration = 1
        try write(record, directory: directory)
        let persistence = CaptureMemorySessionPersistence()
        let store = AgentSessionStore(persistence: persistence)
        store.importBackgroundCapture(record.localSessionPayload)
        var unsupported = try JSONSerialization.jsonObject(with: XCTUnwrap(persistence.data)) as! [String: Any]
        unsupported["version"] = 999
        let cases = [Data("corrupt-private-session".utf8), try JSONSerialization.data(withJSONObject: unsupported)]
        let scheduled = CaptureScheduledRegistrations()
        let delivery = BackgroundCaptureDelivery(directory: directory,
            registrationScheduler: { request, file, id, kind in await scheduled.append(request, file, id, kind) },
            authorizationReader: { auth }, sessionDenials: local, sessionPersistence: { _ in persistence })
        for bytes in cases {
            persistence.data = bytes
            await delivery.registerToken(record.id)
            XCTAssertEqual(persistence.data, bytes)
        }
        let count = await scheduled.count()
        XCTAssertEqual(count, 0)
    }

    private func write(_ record: BackgroundCaptureRecord, directory: URL) throws {
        try JSONEncoder.agentSession.encode(record).write(to: directory.appending(path: record.id.uuidString + ".json"))
    }
    private func syntheticSession() -> TalentSignalSession {
        .init(baseURL: URL(string: "https://capture.example.invalid")!, accessToken: "synthetic",
            expiresAt: Date().addingTimeInterval(3600), account: .init(id: UUID().uuidString, slug: "synthetic", name: "Synthetic"),
            user: .init(id: UUID().uuidString, email: "synthetic@example.invalid", displayName: "Synthetic", kind: "human"))
    }

    private func fixture() throws -> (URL, BackgroundCaptureRecord, BackgroundCaptureDelivery) {
        let directory = FileManager.default.temporaryDirectory.appending(path: "background-capture-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let auth = TalentSignalSession(baseURL: URL(string: "https://capture.example.invalid")!, accessToken: "synthetic",
            expiresAt: Date().addingTimeInterval(3600), account: .init(id: UUID().uuidString, slug: "synthetic", name: "Synthetic"),
            user: .init(id: UUID().uuidString, email: "synthetic@example.invalid", displayName: "Synthetic", kind: "human"))
        let record = BackgroundCaptureRecord(session: auth)
        try JSONEncoder.agentSession.encode(record).write(to: directory.appending(path: record.id.uuidString + ".json"))
        try Data("synthetic-private-source".utf8).write(to: directory.appending(path: record.id.uuidString + ".upload"))
        return (directory, record, BackgroundCaptureDelivery(directory: directory))
    }
    private func receipt(_ record: BackgroundCaptureRecord, messageID: UUID? = nil) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["contract_version": TalentSignalAPIContract.version,
            "session_id": record.sessionID.uuidString, "message_id": (messageID ?? record.messageID).uuidString,
            "queue_entry_id": UUID().uuidString, "status": "queued", "sequence": 1,
            "revision": 1, "accepted_at": "2026-10-24T00:00:00Z"])
    }
}

private final class CaptureSessionFixture: TalentSignalSessionPersisting {
    var session: TalentSignalSession?
    init(_ session: TalentSignalSession) { self.session = session }
    func load() throws -> TalentSignalSession? { session }
    func save(_ session: TalentSignalSession) throws { self.session = session }
    func delete() throws { session = nil }
}
private final class CaptureEndingFixture: AppSessionEndingPersisting {
    var records: [AppSessionEnding]; let unreadable: Bool
    init(_ records: [AppSessionEnding], unreadable: Bool = false) { self.records = records; self.unreadable = unreadable }
    func load() throws -> [AppSessionEnding] { if unreadable { throw AppSessionEndingError.unreadable }; return records }
    func save(_ records: [AppSessionEnding]) throws { self.records = records }
}
private final class CaptureMemorySessionPersistence: AgentSessionPersisting {
    var data: Data?
    func load() throws -> Data? { data }
    func save(_ data: Data) throws { self.data = data }
    func deletionPending() throws -> Bool { false }
    func beginDeletion() throws {}
    func completeDeletion() throws { data = nil }
}
private final class CaptureSessionSyncFixture: AgentSessionSyncServing {
    var puts = 0
    func list(after: String?) async throws -> AgentSessionRemotePage {
        .init(contractVersion: TalentSignalAPIContract.version, sessions: [], complete: true, nextCursor: nil)
    }
    func put(_ payload: PersistedAgentSession, expectedRevision: Int, idempotencyKey: UUID) async throws -> AgentSessionRemoteRecord {
        puts += 1; throw AgentSessionSyncError.conflict
    }
    func delete(id: UUID, expectedRevision: Int, idempotencyKey: UUID) async throws -> AgentSessionRemoteRecord { throw AgentSessionSyncError.conflict }
}

private actor CaptureScheduledRegistrations {
    struct Scheduled { let request: URLRequest; let file: URL; let id: UUID; let kind: String }
    var values: [Scheduled] = []
    func append(_ request: URLRequest, _ file: URL, _ id: UUID, _ kind: String) { values.append(.init(request: request, file: file, id: id, kind: kind)) }
    func first() -> Scheduled? { values.first }
    func last() -> Scheduled? { values.last }
    func count() -> Int { values.count }
}
