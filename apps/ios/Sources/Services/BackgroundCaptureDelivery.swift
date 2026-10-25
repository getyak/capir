import ActivityKit
import CryptoKit
import Foundation
import Security
import UIKit

enum BackgroundCaptureError: LocalizedError {
    case signIn, enableSending, unavailable
    var errorDescription: String? {
        switch self {
        case .signIn: return "Open capri to restore your secure sign-in before sending a screenshot."
        case .enableSending: return "Open Action Button & Shortcuts in capri and enable screenshot sending first."
        case .unavailable: return "Open capri to check this capture and continue."
        }
    }
}

enum BackgroundCaptureAuthorization {
    static func currentSession() throws -> TalentSignalSession {
        let directory = RuntimeEnvironmentDirectory(buildEndpoint: TalentSignalAuthenticationConfiguration.baseURL(arguments: ProcessInfo.processInfo.arguments))
        guard let endpoint = directory.selected?.endpoint else { throw BackgroundCaptureError.signIn }
        return try validatedSession(endpoint: endpoint, sessions: KeychainTalentSignalSessionStore(baseURL: endpoint),
            endings: KeychainAppSessionEndingStore(endpoint: endpoint))
    }
    static func validatedSession(endpoint: URL, sessions: any TalentSignalSessionPersisting,
                                 endings: any AppSessionEndingPersisting) throws -> TalentSignalSession {
        guard let session = try sessions.load(), session.expiresAt > Date(), RuntimeEndpoint.same(session.baseURL, endpoint) else {
            throw BackgroundCaptureError.signIn
        }
        guard try !endings.load().contains(where: { $0.blocks(session) }) else { throw BackgroundCaptureError.signIn }
        return session
    }
    static func assertNoEnding(endpoint: URL, token: String, endings: any AppSessionEndingPersisting) throws {
        let fingerprint = SHA256.hex(RuntimeEndpoint.scope(endpoint) + "|" + token)
        guard try !endings.load().contains(where: { $0.credentialFingerprint == fingerprint || ($0.blockedCredentialFingerprints ?? []).contains(fingerprint) }) else {
            throw BackgroundCaptureError.signIn
        }
    }
    static func renewedCurrentSession() async throws -> TalentSignalSession {
        let directory = RuntimeEnvironmentDirectory(buildEndpoint: TalentSignalAuthenticationConfiguration.baseURL(arguments: ProcessInfo.processInfo.arguments))
        guard let endpoint = directory.selected?.endpoint else { throw BackgroundCaptureError.signIn }
        let sessions = KeychainTalentSignalSessionStore(baseURL: endpoint)
        let endings = KeychainAppSessionEndingStore(endpoint: endpoint)
        // Reading the WhenUnlocked item is required for NEW authority. Locked
        // continuation below continues only an already frozen OS credential.
        guard let stored = try sessions.load(), RuntimeEndpoint.same(stored.baseURL, endpoint),
              try !endings.load().contains(where: { $0.blocks(stored) }) else { throw BackgroundCaptureError.signIn }
        if stored.persistent != nil {
            return try await IOSPersistentSessionCoordinator.shared.resolve(stored, persistence: sessions,
                endings: endings, client: AppAuthenticationClient(baseURL: endpoint))
        }
        return try validatedSession(endpoint: endpoint, sessions: sessions, endings: endings)
    }
    static func enabled(_ session: TalentSignalSession) -> Bool {
        UserDefaults.standard.bool(forKey: key(session))
    }
    static func enabled(scope: String) -> Bool {
        UserDefaults.standard.bool(forKey: "talent-signal.capture.send-enabled." + scope)
    }
    static func enable(_ session: TalentSignalSession) { UserDefaults.standard.set(true, forKey: key(session)) }
    private static func key(_ session: TalentSignalSession) -> String {
        "talent-signal.capture.send-enabled." + PursuitWorkspaceSession.authenticated(session).persistenceScope
    }
}

actor BackgroundCaptureDelivery {
    static let shared = BackgroundCaptureDelivery()
    private let directory: URL
    private var active = Set<UUID>()
    // A frozen OS transfer may finish while WhenUnlocked keychain access is
    // unavailable. This memory-only credential is scoped to its exact capture;
    // it is never persisted by the app and the server revalidates its login.
    private var transferCredentials: [UUID: String] = [:]
    private let sessionPersistence: ((String) -> any AgentSessionPersisting)?
    private let authorizationReader: (() throws -> TalentSignalSession)?
    private let selectedEndpointReader: (() -> URL?)?
    private let logoutDenyMirror: CaptureLogoutDenyMirror
    private let sessionDenials: CaptureSessionDenyStore
    private let credentialProvider: ((BackgroundCaptureRecord) throws -> String)?
    private let registrationScheduler: ((URLRequest, URL, UUID, String) async -> Void)?
    private let recoveryReader: ((BackgroundCaptureRecord, String) async throws -> ConversationImageObservation)?
    private let immediateSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 6; config.timeoutIntervalForResource = 12
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false; config.urlCredentialStorage = nil
        return URLSession(configuration: config, delegate: RuntimeRedirectGuard(), delegateQueue: nil)
    }()
    init(directory: URL? = nil,
         credentialProvider: ((BackgroundCaptureRecord) throws -> String)? = nil,
         recoveryReader: ((BackgroundCaptureRecord, String) async throws -> ConversationImageObservation)? = nil,
         registrationScheduler: ((URLRequest, URL, UUID, String) async -> Void)? = nil,
         authorizationReader: (() throws -> TalentSignalSession)? = nil,
         selectedEndpointReader: (() -> URL?)? = nil,
         logoutDenyMirror: CaptureLogoutDenyMirror = .init(), sessionDenials: CaptureSessionDenyStore = .init(),
         sessionPersistence: ((String) -> any AgentSessionPersisting)? = nil) {
        self.sessionPersistence = sessionPersistence
        self.authorizationReader = authorizationReader; self.selectedEndpointReader = selectedEndpointReader
        self.logoutDenyMirror = logoutDenyMirror; self.sessionDenials = sessionDenials
        self.registrationScheduler = registrationScheduler
        self.recoveryReader = recoveryReader
        self.credentialProvider = credentialProvider
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "TalentSignal/BackgroundCapture", directoryHint: .isDirectory)
    }
    private func metadata(_ id: UUID) -> URL { directory.appending(path: id.uuidString + ".json") }
    func bodyURL(_ id: UUID) -> URL { directory.appending(path: id.uuidString + ".upload") }
    func activityBodyURL(_ id: UUID, generation: Int) -> URL { directory.appending(path: id.uuidString + ".activity-\(generation)-upload") }
    private func sessionBodyURL(_ id: UUID) -> URL { directory.appending(path: id.uuidString + ".session-upload") }
    @discardableResult
    private func save(_ record: BackgroundCaptureRecord) throws -> BackgroundCaptureRecord {
        if FileManager.default.fileExists(atPath: metadata(record.id).path) {
            let current = try load(record.id)
            guard (current.revision ?? 0) == (record.revision ?? 0),
                  current.stage != .cancelled || record.stage == .cancelled else { throw BackgroundCaptureError.unavailable }
        }
        var next = record
        next.revision = (record.revision ?? 0) + 1
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var target = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try target.setResourceValues(values)
        try JSONEncoder.agentSession.encode(next).write(to: metadata(record.id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return next
    }
    private func load(_ id: UUID) throws -> BackgroundCaptureRecord {
        try JSONDecoder.agentSession.decode(BackgroundCaptureRecord.self, from: Data(contentsOf: metadata(id)))
    }
    func records() throws -> [BackgroundCaptureRecord] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .map { try JSONDecoder.agentSession.decode(BackgroundCaptureRecord.self, from: Data(contentsOf: $0)) }
            .sorted { $0.createdAt < $1.createdAt }
    }

    func capture(_ input: ScreenshotInput) async throws -> BackgroundCaptureRecord {
        let session = try await BackgroundCaptureAuthorization.renewedCurrentSession()
        guard BackgroundCaptureAuthorization.enabled(session) else { throw BackgroundCaptureError.enableSending }
        try logoutDenyMirror.prepare(endpoint: session.baseURL,
            fingerprints: KeychainAppSessionEndingStore(endpoint: session.baseURL).load().map(\.credentialFingerprint))
        try logoutDenyMirror.assertAllowed(endpoint: session.baseURL, fingerprint: AppSessionEnding.fingerprint(session))
        let type = try ConversationScreenshotInputValidator.detectedImageType(for: input.data)
        let image = try ScreenshotPreprocessingUploadNormalizer.normalize(data: input.data, mediaType: type.preferredMIMEType ?? "image/png")
        var record = BackgroundCaptureRecord(session: session)
        let priorEpoch = try? sessionDenials.epoch(scope: record.runtimeScope)
        _ = try currentOwner(record)
        let epoch: Int
        if let priorEpoch { epoch = priorEpoch }
        else { epoch = try sessionDenials.initializeFresh(scope: record.runtimeScope) }
        record.localDeletionEpoch = epoch
        try sessionDenials.assertAllowed(scope: record.runtimeScope, sessionID: record.sessionID, epoch: epoch)
        transferCredentials[record.id] = session.accessToken
        record = try save(record)
        let upload = try ConversationImageUpload(id: record.attachmentID, data: image.data,
            fileName: "screenshot.\(image.mediaType == "image/png" ? "png" : "jpg")", mediaType: image.mediaType)
        record.images = [upload.manifest]; record = try save(record)
        if #available(iOS 17.0, *) { await CaptureActivityController.shared.start(record) }
        record = try load(record.id)
        let imageObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(upload))
        let message: [String: Any] = ["session_id": record.sessionID.uuidString.lowercased(),
            "message_id": record.messageID.uuidString.lowercased(), "idempotency_key": record.idempotencyKey,
            "objective": "", "time_zone": record.timeZone, "images": [imageObject]]
        let initial = try JSONSerialization.jsonObject(with: JSONEncoder.agentSession.encode(record.sessionPayload))
        var body: [String: Any] = ["session_operation_id": record.sessionOperationID.uuidString.lowercased(),
            "initial_session": initial, "message": message]
        if let token = record.activityToken {
            record.registrationCredentialFingerprint = IOSPersistentSessionCredential.tokenFingerprint(session.accessToken, endpoint: session.baseURL)
            record = try save(record)
            body["capture_activity"] = ["activity_instance_id": record.activityInstanceID.uuidString.lowercased(),
                "token": token, "token_generation": max(1, record.tokenGeneration ?? 1),
                "environment": CaptureActivityController.pushEnvironment]
        }
        try JSONSerialization.data(withJSONObject: body).write(to: bodyURL(record.id),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        TalentSignalSetupPreference.recordScreenshotShortcutReceived()
        await deliver(record.id)
        return (try? load(record.id)) ?? record
    }

    private func removeCaptureBodies(_ id: UUID) {
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for file in files where file.lastPathComponent.hasPrefix(id.uuidString + ".") && file.lastPathComponent.hasSuffix("upload") {
            try? FileManager.default.removeItem(at: file)
        }
    }
    func resume() async {
        guard let records = try? records() else { return }
        await CaptureActivityController.shared.reattach(records)
        for snapshot in records {
            guard var record = try? load(snapshot.id) else { continue }
            if Date().timeIntervalSince(record.createdAt) > 7 * 86400 {
                await BackgroundCaptureTransfer.shared.cancel(recordID: record.id)
                removeCaptureBodies(record.id)
                try? FileManager.default.removeItem(at: metadata(record.id))
                continue
            }
            if [.creatingSession, .transferring].contains(record.stage) {
                if await BackgroundCaptureTransfer.shared.hasTask(recordID: record.id) { continue }
                guard let latest = try? load(record.id), latest.stage != .cancelled else { continue }
                record = latest
                record.stage = record.stage == .creatingSession ? .saved : .sessionReady
                guard let saved = try? save(record) else { continue }
                record = saved
            }
            if record.stage == .admitted {
                record.tokenRegistered = false; _ = try? save(record)
                await registerToken(record.id)
            }
            else if record.stage != .cancelled { await deliver(record.id) }
        }
    }

    @MainActor
    func restoreLocalSessions(into sessions: AgentSessionStore, scope: String?) async {
        guard let records = try? await records() else { return }
        for record in records where record.runtimeScope == scope && record.stage != .cancelled {
            sessions.importBackgroundCapture(record.localSessionPayload)
        }
    }

    private func currentOwner(_ record: BackgroundCaptureRecord) throws -> TalentSignalSession {
        let session = try authorizationReader?() ?? BackgroundCaptureAuthorization.currentSession()
        guard record.belongs(to: session), BackgroundCaptureAuthorization.enabled(session) else { throw BackgroundCaptureError.signIn }
        if let family = record.credentialFamilyFingerprint {
            guard family == AppSessionEnding.fingerprint(session) else { throw BackgroundCaptureError.signIn }
        }
        try validateLocalScope(record)
        return session
    }
    private func validateLocalScope(_ record: BackgroundCaptureRecord) throws {
        let persistence: any AgentSessionPersisting = sessionPersistence?(record.runtimeScope) ?? FileAgentSessionPersistence(accountID: record.runtimeScope)
        guard try !persistence.deletionPending() else { throw BackgroundCaptureError.unavailable }
        if let data = try persistence.load() {
            let envelope = try JSONDecoder.agentSession.decode(PersistedAgentSessionEnvelope.self, from: data)
            guard (1...8).contains(envelope.version) else { throw BackgroundCaptureError.unavailable }
            if envelope.syncTombstones?[record.sessionID.uuidString.lowercased()] != nil { throw BackgroundCaptureError.unavailable }
        }
    }
    private func credential(_ record: BackgroundCaptureRecord) throws -> String {
        if let credentialProvider { return try credentialProvider(record) }
        do {
            // Existing records only read existing authority, even unlocked.
            // Losing and recreating a mirror can never grant an old capture.
            let epoch = try sessionDenials.epoch(scope: record.runtimeScope)
            let session = try currentOwner(record)
            guard record.localDeletionEpoch == epoch else { throw BackgroundCaptureError.unavailable }
            try sessionDenials.assertAllowed(scope: record.runtimeScope, sessionID: record.sessionID, epoch: epoch)
            try logoutDenyMirror.prepare(endpoint: session.baseURL,
                fingerprints: KeychainAppSessionEndingStore(endpoint: session.baseURL).load().map(\.credentialFingerprint))
            try logoutDenyMirror.assertAllowed(endpoint: session.baseURL, fingerprint: AppSessionEnding.fingerprint(session))
            transferCredentials[record.id] = session.accessToken
            return session.accessToken
        }
        catch AppSessionError.keychain(let status) where status == errSecInteractionNotAllowed || status == errSecNotAvailable {
            let directory = RuntimeEnvironmentDirectory(buildEndpoint: TalentSignalAuthenticationConfiguration.baseURL(arguments: ProcessInfo.processInfo.arguments))
            let selectedEndpoint = selectedEndpointReader.map { $0() } ?? directory.selected?.endpoint
            guard let selected = selectedEndpoint, RuntimeEndpoint.same(selected, record.baseURL),
                  BackgroundCaptureAuthorization.enabled(scope: record.runtimeScope),
                  record.stage != .needsSignIn, record.stage != .cancelled,
                  let frozen = transferCredentials[record.id] else { throw BackgroundCaptureError.signIn }
            // This grants no new capture authority. It only continues the
            // exact capture's frozen OS authorization when its monotonic deny
            // mirror is readable and has no matching logout fingerprint.
            guard let epoch = record.localDeletionEpoch else { throw BackgroundCaptureError.unavailable }
            try sessionDenials.assertAllowed(scope: record.runtimeScope, sessionID: record.sessionID, epoch: epoch)
            try logoutDenyMirror.assertAllowed(endpoint: record.baseURL,
                fingerprint: SHA256.hex(RuntimeEndpoint.scope(record.baseURL) + "|" + frozen))
            if let family = record.credentialFamilyFingerprint {
                try logoutDenyMirror.assertAllowed(endpoint: record.baseURL, fingerprint: family)
            }
            return frozen
        }
    }
    func deliver(_ id: UUID) async {
        guard !active.contains(id), var record = try? load(id), record.stage != .admitted, record.stage != .cancelled else { return }
        active.insert(id); defer { active.remove(id) }
        do {
            if credentialProvider == nil && authorizationReader == nil {
                // Refresh only while the normal WhenUnlocked authority is
                // readable. A locked read falls through to the exact frozen
                // OS credential path; it never loads a refresh capability.
                do { _ = try await BackgroundCaptureAuthorization.renewedCurrentSession() }
                catch AppSessionError.keychain(let status) where status == errSecInteractionNotAllowed || status == errSecNotAvailable { }
            }
            let token = try credential(record)
            if record.usesSingleAdmission != true && (record.stage == .saved || record.stage == .needsSignIn || record.stage == .failed) {
                var created = false
                do {
                    _ = try await AgentSessionSyncClient(baseURL: record.baseURL, bearerToken: token, session: immediateSession)
                        .put(record.sessionPayload, expectedRevision: 0, idempotencyKey: record.sessionOperationID)
                    created = true
                } catch {
                    if let failure = error as? AgentSessionSyncError {
                        switch failure {
                        case .unavailable(let status) where (400..<500).contains(status): throw error
                        case .conflict:
                            guard try await initialSessionMatches(record, token: token) else { throw error }
                            created = true
                        case .transcriptConflict: throw error
                        default: break
                        }
                    }
                    if !created {
                        record = try load(id)
                        _ = try credential(record)
                        guard record.stage != .cancelled, record.stage != .needsSignIn else { return }
                        struct SessionBody: Encodable {
                            let expected_revision = 0
                            let idempotency_key: UUID
                            let payload: PersistedAgentSession
                        }
                        let body = SessionBody(idempotency_key: record.sessionOperationID, payload: record.sessionPayload)
                        try JSONEncoder.agentSession.encode(body).write(to: sessionBodyURL(id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                        var request = URLRequest(url: record.baseURL.appending(path: "v1/agent-sessions/\(record.sessionID.uuidString.lowercased())"))
                        request.httpMethod = "PUT"; request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                        record.stage = .creatingSession; record = try save(record)
                        await BackgroundCaptureTransfer.shared.enqueue(request: request, file: sessionBodyURL(id), recordID: id, kind: "session")
                        return
                    }
                }
                record = try load(id)
                _ = try credential(record)
                guard record.stage != .cancelled, record.stage != .needsSignIn else { return }
                record.stage = .sessionReady; record = try save(record)
            }
            if record.stage == .creatingSession { return }
            _ = try credential(record)
            record.stage = .transferring; record = try save(record)
            await CaptureActivityController.shared.update(record, phase: .uploading)
            record = try load(id)
            guard record.stage == .transferring else { return }
            _ = try credential(record)
            let path = record.usesSingleAdmission == true ? "v1/capture-admissions/\(record.sessionID.uuidString.lowercased())"
                : "v1/agent-sessions/\(record.sessionID.uuidString.lowercased())/conversation-queue"
            var request = URLRequest(url: record.baseURL.appending(path: path))
            request.httpMethod = "POST"; request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.cachePolicy = .reloadIgnoringLocalCacheData
            // Try immediately inside the Intent's bounded runtime. The file
            // remains authoritative if the OS must take over after timeout.
            do {
                var immediate = request
                immediate.timeoutInterval = 6
                immediate.httpBody = try Data(contentsOf: bodyURL(id))
                let (bytes, response) = try await TalentSignalNetworking.data(for: immediate, using: immediateSession)
                await transferred(id: id, status: (response as? HTTPURLResponse)?.statusCode, data: bytes, failed: false,
                    authorization: token, requestURL: request.url)
                return
            } catch {
                record = try load(id)
                guard record.stage == .transferring else { return }
                _ = try credential(record)
            }
            await BackgroundCaptureTransfer.shared.enqueue(request: request, file: bodyURL(id), recordID: id)
        } catch {
            guard var current = try? load(id), current.stage != .cancelled, current.stage != .admitted else { return }
            current.stage = error is BackgroundCaptureError || error is AppSessionError || error is AppSessionEndingError ? .needsSignIn : .failed
            guard let saved = try? save(current) else { return }
            await CaptureActivityController.shared.update(saved, phase: .paused)
        }
    }

    private func initialSessionMatches(_ record: BackgroundCaptureRecord, token: String) async throws -> Bool {
        struct Envelope: Decodable { let contract_version: String; let session: AgentSessionRemoteRecord }
        var request = URLRequest(url: record.baseURL.appending(path: "v1/agent-sessions/\(record.sessionID.uuidString.lowercased())"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (bytes, response) = try await TalentSignalNetworking.data(for: request, using: immediateSession)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let value = try? JSONDecoder.agentSession.decode(Envelope.self, from: bytes),
              value.contract_version == TalentSignalAPIContract.version,
              value.session.sessionID == record.sessionID, value.session.deletedAt == nil, value.session.expiresAt > Date(),
              let payload = value.session.payload else { return false }
        return payload.id == record.sessionID && payload.scopeKind == "unresolved_intent"
            && payload.createdAt == record.sessionPayload.createdAt
    }

    func transferred(id: UUID, status: Int?, data: Data, failed: Bool, kind: String = "message",
                     authorization: String? = nil, requestURL: URL? = nil) async {
        if kind.hasPrefix("activity-"), let generation = Int(kind.dropFirst(9)), generation > 0 {
            await registrationTransferred(id: id, generation: generation, status: status, failed: failed,
                authorization: authorization, requestURL: requestURL)
            return
        }
        guard var record = try? load(id), record.stage != .cancelled, record.stage != .needsSignIn, record.stage != .admitted else { return }
        let expected = record.baseURL.appending(path: record.usesSingleAdmission == true && kind != "session"
            ? "v1/capture-admissions/\(record.sessionID.uuidString.lowercased())"
            : "v1/agent-sessions/\(record.sessionID.uuidString.lowercased())" + (kind == "session" ? "" : "/conversation-queue"))
        if let authorization, requestURL == expected, record.stage != .needsSignIn { transferCredentials[id] = authorization }
        if kind == "session" {
            if status == 409, let token = try? credential(record), (try? await initialSessionMatches(record, token: token)) == true {
                guard var current = try? load(id), current.stage != .cancelled, current.stage != .needsSignIn else { return }
                current.stage = .sessionReady
                guard (try? save(current)) != nil else { return }
                try? FileManager.default.removeItem(at: sessionBodyURL(id))
                await deliver(id); return
            }
            record = (try? load(id)) ?? record
            guard record.stage != .cancelled, record.stage != .needsSignIn else { return }
            struct Envelope: Decodable { let contract_version: String; let session: AgentSessionRemoteRecord }
            guard !failed, [200,201].contains(status ?? 0),
                  let receipt = try? JSONDecoder.agentSession.decode(Envelope.self, from: data),
                  receipt.contract_version == TalentSignalAPIContract.version,
                  receipt.session.sessionID == record.sessionID, receipt.session.deletedAt == nil,
                  receipt.session.expiresAt > Date() else {
                record.stage = [401,403].contains(status ?? 0) ? .needsSignIn : .failed
                guard let saved = try? save(record) else { return }
                await CaptureActivityController.shared.update(saved, phase: .paused); return
            }
            record.stage = .sessionReady; guard let saved = try? save(record) else { return }; record = saved
            try? FileManager.default.removeItem(at: sessionBodyURL(id))
            await deliver(id)
            return
        }
        guard !failed, status == 202,
              let receipt = try? JSONDecoder().decode(ConversationImageAdmission.self, from: data),
              receipt.contractVersion == TalentSignalAPIContract.version,
              receipt.sessionID == record.sessionID, receipt.messageID == record.messageID,
              receipt.revision > 0, receipt.sequence > 0,
              ConversationImageQueueEntry.statuses.contains(receipt.status),
              ConversationImageTimestamp.parse(receipt.acceptedAt) != nil else {
            // A lost response may already have admitted the original message.
            // Keep its exact body and ID for idempotent reconciliation.
            record.stage = [401,403].contains(status ?? 0) ? .needsSignIn : .failed
            guard let saved = try? save(record) else { return }; record = saved
            await CaptureActivityController.shared.update(record, phase: .paused)
            if failed || status == nil || ([408,429].contains(status ?? 0) || (500...599).contains(status ?? 0)) { await recoverUnknown(id) }
            return
        }
        record.stage = .admitted; record.queueEntryID = receipt.queueEntryID
        do { record = try save(record) } catch { return }
        try? FileManager.default.removeItem(at: bodyURL(id))
        await CaptureActivityController.shared.update(record, phase: .queued)
        await registerToken(id)
    }

    private func recoverUnknown(_ id: UUID) async {
        guard var record = try? load(id), record.stage == .failed, (record.recoveryAttempts ?? 0) < 2 else { return }
        do {
            let token = try credential(record)
            record.recoveryAttempts = (record.recoveryAttempts ?? 0) + 1
            record = try save(record)
            let observation: ConversationImageObservation
            if let recoveryReader { observation = try await recoveryReader(record, token) }
            else { observation = try await ConversationImageTransport(baseURL: record.baseURL, token: token, session: immediateSession)
                .readConversationImageState(sessionID: record.sessionID, messageID: record.messageID) }
            guard var current = try? load(id), current.stage == .failed else { return }
            _ = try credential(current)
            if let entry = observation.entry, observation.record.sessionID == current.sessionID,
               observation.record.deletedAt == nil, observation.record.expiresAt > Date(),
               entry.messageID == current.messageID, entry.images == current.images {
                current.stage = .admitted; current.queueEntryID = entry.queueEntryID
                current = try save(current)
                try? FileManager.default.removeItem(at: bodyURL(id))
                let phase: CaptureActivityPhase = entry.status == "completed" ? .review
                    : entry.status == "running" ? .processing : entry.status == "queued" ? .queued
                    : entry.status == "failed" ? .failed : .paused
                await CaptureActivityController.shared.update(current, phase: phase)
                await registerToken(id)
                return
            }
        } catch { /* Unknown readback keeps the original source and identity. */ }
        // A bounded read attempt is followed by a durable OS replay of the
        // frozen file, even when the read response was lost. No polling Task.
        guard var current = try? load(id), current.stage == .failed,
              FileManager.default.fileExists(atPath: bodyURL(id).path),
              let token = try? credential(current) else { return }
        let path = current.usesSingleAdmission == true ? "v1/capture-admissions/\(current.sessionID.uuidString.lowercased())"
            : "v1/agent-sessions/\(current.sessionID.uuidString.lowercased())/conversation-queue"
        var request = URLRequest(url: current.baseURL.appending(path: path))
        request.httpMethod = "POST"; request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        current.stage = .transferring
        guard (try? save(current)) != nil else { return }
        await BackgroundCaptureTransfer.shared.enqueue(request: request, file: bodyURL(id), recordID: id)
    }

    func registerToken(_ id: UUID) async {
        guard var record = try? load(id), record.stage == .admitted,
              !record.tokenRegistered, let token = record.activityToken else { return }
        do {
            if credentialProvider == nil && authorizationReader == nil {
                do { _ = try await BackgroundCaptureAuthorization.renewedCurrentSession() }
                catch AppSessionError.keychain(let status) where status == errSecInteractionNotAllowed || status == errSecNotAvailable { }
            }
            let authorization = try credential(record)
            let fingerprint = SHA256.hex(RuntimeEndpoint.scope(record.baseURL) + "|" + authorization)
            if record.registrationCredentialFingerprint != fingerprint {
                record.registrationCredentialFingerprint = fingerprint
                record.tokenGeneration = (record.tokenGeneration ?? 0) + 1
                record.registrationRetries = 0
                record = try save(record)
            }
            let generation = record.tokenGeneration ?? 1
            var request = registrationRequest(record, authorization: authorization)
            request.httpBody = try JSONSerialization.data(withJSONObject: ["message_id": record.messageID.uuidString.lowercased(),
                "activity_instance_id": record.activityInstanceID.uuidString.lowercased(), "token": token,
                "token_generation": generation, "environment": CaptureActivityController.pushEnvironment], options: [.sortedKeys])
            let file = activityBodyURL(id, generation: generation)
            // This file remains immutable for its generation and is owned by
            // the OS transfer as soon as a token becomes available.
            if FileManager.default.fileExists(atPath: file.path) {
                guard try Data(contentsOf: file) == request.httpBody else { throw BackgroundCaptureError.unavailable }
            } else {
                try request.httpBody!.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
            // Late tokens go directly to the OS. An ephemeral POST first
            // would leave a suspension window before durable ownership.
            guard let latest = try? load(id), latest.stage == .admitted, latest.tokenGeneration == generation,
                  latest.activityToken == token, !latest.tokenRegistered else { return }
            _ = try credential(latest)
            request.httpBody = nil
            await scheduleRegistration(request, file: file, id: id, generation: generation)
        } catch { /* Safe authorization recovery waits for an unlocked owner. */ }
    }
    private func registrationRequest(_ record: BackgroundCaptureRecord, authorization: String) -> URLRequest {
        var request = URLRequest(url: record.baseURL.appending(path: "v1/agent-sessions/\(record.sessionID.uuidString.lowercased())/capture-activity"))
        request.httpMethod = "POST"; request.setValue("Bearer \(authorization)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }
    private func scheduleRegistration(_ request: URLRequest, file: URL, id: UUID, generation: Int) async {
        let kind = "activity-\(generation)"
        if let registrationScheduler { await registrationScheduler(request, file, id, kind) }
        else {
            let attempts = (try? load(id).registrationRetries) ?? 0
            await BackgroundCaptureTransfer.shared.enqueue(request: request, file: file, recordID: id, kind: kind,
                notBefore: Date().addingTimeInterval(min(60, pow(2, Double(attempts)) * 5)))
        }
    }
    private func registrationTransferred(id: UUID, generation: Int, status: Int?, failed: Bool,
                                         authorization: String?, requestURL: URL?) async {
        let file = activityBodyURL(id, generation: generation)
        guard var current = try? load(id), current.stage == .admitted,
              current.tokenGeneration == generation,
              let authorization, requestURL == registrationRequest(current, authorization: authorization).url,
              let bytes = try? Data(contentsOf: file), bytes.count <= 4096,
              let body = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              body["token"] as? String == current.activityToken,
              body["token_generation"] as? Int == generation,
              body["message_id"] as? String == current.messageID.uuidString.lowercased(),
              body["activity_instance_id"] as? String == current.activityInstanceID.uuidString.lowercased(),
              current.registrationCredentialFingerprint == SHA256.hex(RuntimeEndpoint.scope(current.baseURL) + "|" + authorization) else { return }
        transferCredentials[id] = authorization
        // Even an OS callback cannot bypass a logout or local deletion. Normal
        // authorization reads Keychain; locked continuation reads the deny mirror.
        guard (try? credential(current)) != nil else { return }
        if !failed, status == 200 {
            current.tokenRegistered = true
            guard (try? save(current)) != nil else { return }
            try? FileManager.default.removeItem(at: file)
        } else if (failed || status == nil || ([408,429].contains(status ?? 0) || (500...599).contains(status ?? 0))), (current.registrationRetries ?? 0) < 2 {
            current.registrationRetries = (current.registrationRetries ?? 0) + 1
            guard (try? save(current)) != nil else { return }
            let request = registrationRequest(current, authorization: authorization)
            await scheduleRegistration(request, file: file, id: id, generation: generation)
        }
    }

    func pauseAll() async {
        transferCredentials.removeAll()
        await BackgroundCaptureTransfer.shared.cancelAll()
        guard let records = try? records() else { return }
        for snapshot in records {
            guard var record = try? load(snapshot.id), record.stage != .admitted, record.stage != .cancelled else { continue }
            record.stage = .needsSignIn
            guard let saved = try? save(record) else { continue }
            await CaptureActivityController.shared.update(saved, phase: .paused)
        }
    }

    func recordActivityToken(recordID: UUID, token: String) async {
        guard var record = try? load(recordID), record.stage != .cancelled else { return }
        if record.activityToken != token {
            record.activityToken = token; record.tokenRegistered = false
            record.tokenGeneration = (record.tokenGeneration ?? 0) + 1
            record.registrationRetries = 0
            _ = try? save(record)
        }
    }

    func cancelSession(_ sessionID: UUID) async {
        guard let records = try? records() else { return }
        for snapshot in records where snapshot.sessionID == sessionID {
            guard var record = try? load(snapshot.id) else { continue }
            record.stage = .cancelled; record.activityToken = nil; record.tokenRegistered = false
            guard let saved = try? save(record) else { continue }; record = saved
            transferCredentials.removeValue(forKey: record.id)
            await BackgroundCaptureTransfer.shared.cancel(recordID: record.id)
            removeCaptureBodies(record.id)
            await CaptureActivityController.shared.update(record, phase: .paused)
        }
    }
}

/// The OS owns the file-backed transfer after perform() returns. Redirects
/// never carry bearer credentials to an unapproved origin.
final class BackgroundCaptureTransfer: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let shared = BackgroundCaptureTransfer()
    static let identifier = "com.talentsignal.capture-upload.v1"
    private let lock = NSLock()
    private var responses: [Int: Data] = [:]
    private var completion: (() -> Void)?
    private var cancelledIDs = Set<UUID>()
    private var schedulingGeneration = 0
    private let deliveries = DispatchGroup()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        config.isDiscretionary = false; config.sessionSendsLaunchEvents = true
        config.timeoutIntervalForResource = 7 * 86400
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    func enqueue(request: URLRequest, file: URL, recordID: UUID, kind: String = "message", notBefore: Date? = nil) async {
        let generation = lock.withLock { schedulingGeneration }
        let tasks = await session.allTasks
        let description = recordID.uuidString + "|" + kind
        lock.withLock {
            guard generation == schedulingGeneration, !cancelledIDs.contains(recordID),
                  !tasks.contains(where: { $0.state != .completed && $0.taskDescription == description }) else { return }
            let task = session.uploadTask(with: request, fromFile: file)
            task.taskDescription = description; task.earliestBeginDate = notBefore; task.resume()
        }
    }
    func cancelAll() async {
        lock.withLock { schedulingGeneration += 1 }
        for task in await session.allTasks { task.cancel() }
    }
    func hasTask(recordID: UUID) async -> Bool {
        await session.allTasks.contains { $0.state != .completed && $0.taskDescription?.hasPrefix(recordID.uuidString + "|") == true }
    }
    func cancel(recordID: UUID) async {
        _ = lock.withLock { cancelledIDs.insert(recordID) }
        for task in await session.allTasks where task.taskDescription?.hasPrefix(recordID.uuidString + "|") == true { task.cancel() }
    }
    func restore(completion: @escaping () -> Void) { lock.lock(); self.completion = completion; lock.unlock(); _ = session }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock(); defer { lock.unlock() }
        if (responses[dataTask.taskIdentifier]?.count ?? 0) + data.count <= 16384 { responses[dataTask.taskIdentifier, default: Data()].append(data) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock(); let bytes = responses.removeValue(forKey: task.taskIdentifier) ?? Data(); lock.unlock()
        let status = (task.response as? HTTPURLResponse)?.statusCode
        let header = task.originalRequest?.value(forHTTPHeaderField: "Authorization")
        let authorization = header?.hasPrefix("Bearer ") == true ? String(header!.dropFirst(7)) : nil
        let requestURL = task.originalRequest?.url
        deliveries.enter()
        Task {
            await Self.dispatchCompletion(description: task.taskDescription, status: status, data: bytes, failed: error != nil,
                authorization: authorization, requestURL: requestURL)
            deliveries.leave()
        }
    }
    static func dispatchCompletion(description: String?, status: Int?, data: Data, failed: Bool,
                                   authorization: String?, requestURL: URL?, delivery: BackgroundCaptureDelivery = .shared) async {
        guard let parts = description?.split(separator: "|"), parts.count == 2,
              let id = UUID(uuidString: String(parts[0])) else { return }
        if let records = try? await delivery.records() { await CaptureActivityController.shared.reattach(records) }
        await delivery.transferred(id: id, status: status, data: data, failed: failed, kind: String(parts[1]),
            authorization: authorization, requestURL: requestURL)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        deliveries.notify(queue: .main) { [self] in
            lock.lock(); let handler = completion; completion = nil; lock.unlock(); handler?()
        }
    }
}

final class CaptureUploadAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        guard identifier == BackgroundCaptureTransfer.identifier else { completionHandler(); return }
        BackgroundCaptureTransfer.shared.restore(completion: completionHandler)
    }
}
