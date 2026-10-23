import CryptoKit
import Foundation

struct ConversationImageManifest: Codable, Equatable {
    let attachmentID: UUID
    let fileName: String
    let mediaType: String
    let byteSize: Int
    let contentHash: String
    enum CodingKeys: String, CodingKey {
        case attachmentID = "attachment_id", fileName = "file_name", mediaType = "media_type"
        case byteSize = "byte_size", contentHash = "content_hash"
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(attachmentID.uuidString.lowercased(), forKey: .attachmentID)
        try c.encode(fileName, forKey: .fileName); try c.encode(mediaType, forKey: .mediaType)
        try c.encode(byteSize, forKey: .byteSize); try c.encode(contentHash, forKey: .contentHash)
    }
    var isValid: Bool {
        !fileName.isEmpty && fileName.utf16.count <= 200
            && ["image/png", "image/jpeg", "image/webp"].contains(mediaType)
            && (1...10_000_000).contains(byteSize)
            && contentHash.count == 64 && contentHash.allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }
}

struct ConversationImageUpload: Encodable {
    let manifest: ConversationImageManifest
    private let data: Data
    init(id: UUID, data: Data, fileName: String, mediaType: String) throws {
        manifest = ConversationImageManifest(attachmentID: id, fileName: fileName,
            mediaType: mediaType, byteSize: data.count,
            contentHash: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
        guard manifest.isValid else { throw ImageConversationError.invalidInput }
        self.data = data
    }

    static func validateQuestion(objective: String, images: [Self]) throws {
        guard (!images.isEmpty || !objective.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
              images.count <= 10, images.map(\.manifest).allSatisfy(\.isValid),
              Set(images.map { $0.manifest.attachmentID }).count == images.count,
              images.reduce(0, { $0 + $1.manifest.byteSize }) <= 30_000_000,
              objective.utf16.count <= 1000 else { throw ImageConversationError.invalidInput }
    }
    private enum CodingKeys: String, CodingKey {
        case attachmentID = "attachment_id", fileName = "file_name", mediaType = "media_type"
        case byteSize = "byte_size", contentHash = "content_hash", dataBase64 = "data_base64"
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(manifest.attachmentID.uuidString.lowercased(), forKey: .attachmentID)
        try c.encode(manifest.fileName, forKey: .fileName); try c.encode(manifest.mediaType, forKey: .mediaType)
        try c.encode(manifest.byteSize, forKey: .byteSize); try c.encode(manifest.contentHash, forKey: .contentHash)
        try c.encode(data.base64EncodedString(), forKey: .dataBase64)
    }
}

struct ConversationImageAdmission: Decodable {
    let contractVersion: String
    let sessionID: UUID
    let messageID: UUID
    let queueEntryID: UUID
    let runID: UUID?
    let status: String
    let sequence: Int
    let revision: Int
    let acceptedAt: String
    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version", sessionID = "session_id", messageID = "message_id"
        case queueEntryID = "queue_entry_id", runID = "run_id", status, sequence, revision, acceptedAt = "accepted_at"
    }
}

enum ConversationImageQueueStatus: String, Decodable, CaseIterable {
    case queued, running, completed, failed, cancelled, interrupted

    var isTerminal: Bool { self != .queued && self != .running }
}

/// Only server-observed, understood stages are eligible for interface copy.
enum ConversationImageRunStage: String, Decodable {
    case queued, preparing, thinking, contactLookup = "contact_lookup", contactRead = "contact_read"
    case calendarDraft = "calendar_draft", answer, responding, persisting, running
}

struct ConversationImageQueueEntry: Decodable {
    static let statuses = Set(ConversationImageQueueStatus.allCases.map(\.rawValue))
    let queueEntryID: UUID
    let messageID: UUID
    let status: String
    let images: [ConversationImageManifest]
    let failureCode: String?
    let runID: UUID?
    let stage: String?
    let createdAt: Date?
    let updatedAt: Date?
    let startedAt: Date?
    let revision: Int?
    let cancelRequested: Bool
    var queueStatus: ConversationImageQueueStatus { ConversationImageQueueStatus(rawValue: status)! }
    var progressStage: ConversationImageRunStage? { stage.flatMap(ConversationImageRunStage.init(rawValue:)) }
    enum CodingKeys: String, CodingKey {
        case queueEntryID = "queue_entry_id", messageID = "message_id", status, images
        case failureCode = "failure_code", runID = "run_id"
        case stage, createdAt = "created_at", updatedAt = "updated_at", startedAt = "started_at"
        case revision, cancelRequested = "cancel_requested"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        queueEntryID = try c.decode(UUID.self, forKey: .queueEntryID)
        messageID = try c.decode(UUID.self, forKey: .messageID)
        status = try c.decode(String.self, forKey: .status)
        images = try c.decodeIfPresent([ConversationImageManifest].self, forKey: .images) ?? []
        failureCode = try c.decodeIfPresent(String.self, forKey: .failureCode)
        runID = try c.decodeIfPresent(UUID.self, forKey: .runID)
        stage = try c.decodeIfPresent(String.self, forKey: .stage)
        createdAt = try Self.timestamp(c, key: .createdAt)
        updatedAt = try Self.timestamp(c, key: .updatedAt)
        startedAt = try Self.timestamp(c, key: .startedAt)
        revision = try c.decodeIfPresent(Int.self, forKey: .revision)
        cancelRequested = try c.decodeIfPresent(Bool.self, forKey: .cancelRequested) ?? false
        guard Self.statuses.contains(status), images.count <= 10, images.allSatisfy(\.isValid),
              Set(images.map(\.attachmentID)).count == images.count,
              stage.map({ !$0.isEmpty && $0.utf16.count <= 40 }) ?? true,
              revision.map({ $0 > 0 }) ?? true else {
            throw PursuitWorkspaceClientError.invalidResponse
        }
    }

    private static func timestamp(_ container: KeyedDecodingContainer<CodingKeys>, key: CodingKeys) throws -> Date? {
        guard let value = try container.decodeIfPresent(String.self, forKey: key) else { return nil }
        guard let date = ConversationImageTimestamp.parse(value) else { throw PursuitWorkspaceClientError.invalidResponse }
        return date
    }
}

struct ConversationImageObservation {
    let record: AgentSessionRemoteRecord
    let entry: ConversationImageQueueEntry?
    var paused = false
    var observedAt = Date()
    var revision: Int?
}

struct ConversationImageSnapshot: Decodable {
    let contractVersion: String
    let sessionID: UUID
    let active: ConversationImageQueueEntry?
    let queued: [ConversationImageQueueEntry]
    let revision: Int?
    let paused: Bool?
    let preview: ConversationImageStagePreview?
    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version", sessionID = "session_id", active, queued, revision, paused, preview
    }

    func validate(sessionID expectedSessionID: UUID) throws {
        let entries = [active].compactMap { $0 } + queued
        guard contractVersion == TalentSignalAPIContract.version, sessionID == expectedSessionID,
              queued.count <= 50, revision.map({ $0 >= 0 }) ?? true,
              Set(entries.map(\.queueEntryID)).count == entries.count,
              Set(entries.map(\.messageID)).count == entries.count else {
            throw PursuitWorkspaceClientError.invalidResponse
        }
    }

    func entry(messageID: UUID) -> ConversationImageQueueEntry? {
        ([active].compactMap { $0 } + queued).first { $0.messageID == messageID }
    }
}

/// Deliberately excludes text and tool output. A stage never authorizes an answer.
struct ConversationImageStagePreview: Decodable {
    let runID: UUID
    let messageID: UUID
    let stage: String?
    let revision: Int
    enum CodingKeys: String, CodingKey { case runID = "run_id", messageID = "message_id", stage, revision }
}

struct ConversationImageQueueUpdate {
    let sessionID: UUID
    let messageID: UUID
    let entry: ConversationImageQueueEntry?
    let paused: Bool
    let revision: Int
    let observedAt: Date
    let observedStage: ConversationImageRunStage?
}

protocol ConversationImageStreaming {
    func conversationImageUpdates(sessionID: UUID, messageID: UUID) async throws -> AsyncThrowingStream<ConversationImageQueueUpdate, Error>
}

enum ConversationImageStreamError: Error, Equatable {
    case unavailable(Int), invalidFrame, reconnect
}

enum ConversationImageTimestamp {
    static func parse(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

struct ConversationImageBody: Encodable {
    let sessionID: String
    let messageID: String
    let idempotencyKey: String
    let objective: String
    let images: [ConversationImageUpload]
    let timeZone: String
    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id", messageID = "message_id", idempotencyKey = "idempotency_key"
        case objective, images, timeZone = "time_zone"
    }
}

struct ConversationImageTransport {
    private let baseURL: URL
    private let token: String
    private let session: URLSession
    init(baseURL: URL, token: String, session: URLSession) {
        self.baseURL = baseURL; self.token = token; self.session = session
    }

    func admitConversationImages(sessionID: UUID, messageID: UUID, idempotencyKey: String,
        objective: String, images: [ConversationImageUpload], timeZone: String = TimeZone.current.identifier) async throws -> ConversationImageAdmission {
        try ConversationImageUpload.validateQuestion(objective: objective, images: images)
        guard !idempotencyKey.isEmpty, idempotencyKey.count <= 128,
              !timeZone.isEmpty, timeZone.utf16.count <= 100 else {
            throw PursuitWorkspaceClientError.invalidResponse
        }
        let receipt: ConversationImageAdmission = try await post(
            path: "v1/agent-sessions/\(sessionID.uuidString.lowercased())/conversation-queue",
            token: token, body: ConversationImageBody(sessionID: sessionID.uuidString.lowercased(),
                messageID: messageID.uuidString.lowercased(), idempotencyKey: idempotencyKey,
                objective: objective, images: images, timeZone: timeZone))
        guard receipt.contractVersion == TalentSignalAPIContract.version,
              receipt.sessionID == sessionID, receipt.messageID == messageID,
              receipt.sequence > 0, receipt.revision > 0, Self.isVerifiedTimestamp(receipt.acceptedAt),
              ConversationImageQueueEntry.statuses.contains(receipt.status) else {
            throw PursuitWorkspaceClientError.invalidResponse
        }
        return receipt
    }

    func readConversationImageState(sessionID: UUID, messageID: UUID) async throws -> ConversationImageObservation {
        try Task.checkCancellation()
        let path = "v1/agent-sessions/\(sessionID.uuidString.lowercased())"
        // Independent authenticated reads need not add their latencies together.
        async let queueRead: ConversationImageSnapshot = request(path: path + "/conversation-queue", token: token)
        async let sessionRead: ConversationImageSessionEnvelope = request(path: path, token: token)
        let (snapshot, envelope) = try await (queueRead, sessionRead)
        try Task.checkCancellation()
        try snapshot.validate(sessionID: sessionID)
        guard envelope.contractVersion == TalentSignalAPIContract.version, envelope.session.sessionID == sessionID,
              envelope.session.deletedAt == nil, envelope.session.expiresAt > Date(),
              envelope.session.payload?.id == sessionID else { throw PursuitWorkspaceClientError.invalidResponse }
        return ConversationImageObservation(record: envelope.session, entry: snapshot.entry(messageID: messageID),
            paused: snapshot.paused ?? false, observedAt: Date(), revision: snapshot.revision)
    }

    /// Read-only observation. EOF, timeout or failure must fall back to a
    /// canonical same-message read; none establishes a failed model run.
    func conversationImageUpdates(sessionID: UUID, messageID: UUID) -> AsyncThrowingStream<ConversationImageQueueUpdate, Error> {
        AsyncThrowingStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            let worker = Task {
                do {
                    try await withThrowingTaskGroup(of: Void.self) { group in
                        group.addTask { try await consumeImageUpdates(sessionID: sessionID, messageID: messageID, continuation: continuation) }
                        group.addTask {
                            try await Task.sleep(nanoseconds: 60_000_000_000)
                            throw ConversationImageStreamError.reconnect
                        }
                        defer { group.cancelAll() }
                        _ = try await group.next()
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { @Sendable _ in worker.cancel() }
        }
    }

    private func consumeImageUpdates(sessionID: UUID, messageID: UUID,
        continuation: AsyncThrowingStream<ConversationImageQueueUpdate, Error>.Continuation) async throws {
        try Task.checkCancellation()
        var request = URLRequest(url: baseURL.appending(path: "v1/agent-sessions/\(sessionID.uuidString.lowercased())/conversation-queue/stream"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 60
        if LabFaultURLProtocol.isIsolated(session), !LabFaultURLProtocol.permits(request) { throw URLError(.unsupportedURL) }
        // A task delegate also protects injected/test sessions from forwarding credentials.
        let (bytes, response) = try await session.bytes(for: request, delegate: RuntimeRedirectGuard())
        defer { bytes.task.cancel() }
        guard let http = response as? HTTPURLResponse else { throw PursuitWorkspaceClientError.invalidResponse }
        guard http.statusCode == 200 else { throw ConversationImageStreamError.unavailable(http.statusCode) }
        guard http.mimeType == "text/event-stream" else { throw ConversationImageStreamError.invalidFrame }
        var parser = ConversationImageEventParser()
        var accumulator = ConversationImageStreamAccumulator(sessionID: sessionID, messageID: messageID)
        var received = 0
        try await withTaskCancellationHandler {
            for try await byte in bytes {
                try Task.checkCancellation()
                received += 1
                // Reconnect/read back rather than accumulate an unbounded stream.
                guard received <= 1_048_576 else { throw ConversationImageStreamError.reconnect }
                if let frame = try parser.push(byte) {
                    if frame.event == "unavailable" { throw ConversationImageStreamError.unavailable(410) }
                    if frame.event == "reconnect" { return }
                    if let update = try accumulator.accept(frame) { continuation.yield(update) }
                }
            }
        } onCancel: {
            bytes.task.cancel()
        }
        try Task.checkCancellation()
    }

    func loadConversationImage(sessionID: UUID, messageID: UUID, index: Int,
        manifest: ConversationImageManifest) async throws -> ChatMediaContent {
        guard (0..<10).contains(index), manifest.isValid else { throw PursuitWorkspaceClientError.invalidResponse }
        var request = URLRequest(url: baseURL.appending(path: "v1/agent-sessions/\(sessionID.uuidString.lowercased())/conversation-images/\(messageID.uuidString.lowercased())/\(index)"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await TalentSignalNetworking.data(for: request, using: session)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.mimeType == manifest.mediaType, data.count == manifest.byteSize,
              SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == manifest.contentHash else {
            throw PursuitWorkspaceClientError.invalidResponse
        }
        return ChatMediaContent(data: data, mediaType: manifest.mediaType)
    }
    private static func isVerifiedTimestamp(_ value: String) -> Bool {
        ConversationImageTimestamp.parse(value) != nil
    }
    private func request<Response: Decodable>(path: String, token: String) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return try await decoded(request)
    }
    private func post<Response: Decodable, Body: Encodable>(path: String, token: String, body: Body) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("ios", forHTTPHeaderField: "x-talent-signal-platform")
        request.httpBody = try JSONEncoder().encode(body)
        return try await decoded(request)
    }
    private func decoded<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, response) = try await TalentSignalNetworking.data(for: request, using: session)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw PursuitWorkspaceClientError.invalidResponse
        }
        return try JSONDecoder.agentSession.decode(Response.self, from: data)
    }

}

private struct ConversationImageSessionEnvelope: Decodable {
    let contractVersion: String
    let session: AgentSessionRemoteRecord
    enum CodingKeys: String, CodingKey { case contractVersion = "contract_version", session }
}

struct ConversationImageEventFrame {
    let event: String
    let data: Data
}

/// Byte-bound parsing also limits a server line without a newline. No text is
/// kept after its frame is decoded; preview text has no native model field.
struct ConversationImageEventParser {
    private var line = Data()
    private var event = "message"
    private var payload = Data()
    private var frameSize = 0
    mutating func push(_ byte: UInt8) throws -> ConversationImageEventFrame? {
        frameSize += 1
        guard frameSize <= 262_144 else { throw ConversationImageStreamError.invalidFrame }
        guard byte == 10 else { line.append(byte); return nil }
        if line.last == 13 { line.removeLast() }
        let completedLine = line
        line.removeAll(keepingCapacity: true)
        if completedLine.isEmpty {
            let frame = payload.isEmpty ? nil : ConversationImageEventFrame(event: event, data: payload)
            event = "message"; payload = Data(); frameSize = 0
            return frame
        }
        guard let value = String(data: completedLine, encoding: .utf8) else { throw ConversationImageStreamError.invalidFrame }
        if value.hasPrefix("event:") {
            event = String(value.dropFirst(6)).trimmingCharacters(in: .whitespaces)
        } else if value.hasPrefix("data:") {
            var data = value.dropFirst(5)
            if data.first == " " { data = data.dropFirst() }
            if !payload.isEmpty { payload.append(10) }
            payload.append(contentsOf: data.utf8)
        }
        return nil
    }
}

/// Preview metadata is useful only inside the latest verified active run.
/// Late snapshots/preview frames cannot restart old work or publish a stage
/// from another message. Completion is left to canonical Session readback.
struct ConversationImageStreamAccumulator {
    let sessionID: UUID
    let messageID: UUID
    private var snapshot: ConversationImageSnapshot?
    private var previewRevision = -1
    private var previewRunID: UUID?
    private var stage: ConversationImageRunStage?

    init(sessionID: UUID, messageID: UUID) { self.sessionID = sessionID; self.messageID = messageID }

    mutating func accept(_ frame: ConversationImageEventFrame, now: Date = Date()) throws -> ConversationImageQueueUpdate? {
        if frame.event == "snapshot" {
            let next = try JSONDecoder().decode(ConversationImageSnapshot.self, from: frame.data)
            try next.validate(sessionID: sessionID)
            guard let revision = next.revision, next.paused != nil else { throw ConversationImageStreamError.invalidFrame }
            guard revision > (snapshot?.revision ?? -1) else { return nil }
            if next.active?.runID != previewRunID || next.active?.messageID != messageID
                || next.active?.queueStatus != .running || next.active?.cancelRequested == true {
                previewRevision = -1; previewRunID = nil; stage = nil
            }
            snapshot = next
            if let preview = next.preview { acceptStage(preview) }
        } else if frame.event == "preview" {
            let preview = try JSONDecoder().decode(ConversationImageStagePreview.self, from: frame.data)
            guard acceptStage(preview) else { return nil }
        } else { return nil }
        guard let snapshot, let revision = snapshot.revision, let paused = snapshot.paused else { return nil }
        let entry = snapshot.entry(messageID: messageID)
        return ConversationImageQueueUpdate(sessionID: sessionID, messageID: messageID, entry: entry,
            paused: paused, revision: revision, observedAt: now,
            observedStage: entry?.queueStatus == .running && entry?.cancelRequested == false ? stage ?? entry?.progressStage : nil)
    }

    @discardableResult
    private mutating func acceptStage(_ preview: ConversationImageStagePreview) -> Bool {
        guard let active = snapshot?.active, active.messageID == messageID, active.queueStatus == .running,
              !active.cancelRequested, active.runID == preview.runID, preview.messageID == messageID,
              preview.revision > 0, preview.revision > previewRevision,
              preview.stage.map({ !$0.isEmpty && $0.utf16.count <= 40 }) ?? true else { return false }
        previewRunID = preview.runID; previewRevision = preview.revision
        stage = preview.stage.flatMap(ConversationImageRunStage.init(rawValue:))
        return true
    }
}

extension URLPursuitWorkspaceClient {
    func admitConversationImages(sessionID: UUID, messageID: UUID, idempotencyKey: String,
        objective: String, images: [ConversationImageUpload], timeZone: String = TimeZone.current.identifier) async throws -> ConversationImageAdmission {
        try await imageConversationTransport().admitConversationImages(sessionID: sessionID, messageID: messageID,
            idempotencyKey: idempotencyKey, objective: objective, images: images, timeZone: timeZone)
    }
    func readConversationImageState(sessionID: UUID, messageID: UUID) async throws -> ConversationImageObservation {
        try await imageConversationTransport().readConversationImageState(sessionID: sessionID, messageID: messageID)
    }
    func loadConversationImage(sessionID: UUID, messageID: UUID, index: Int,
        manifest: ConversationImageManifest) async throws -> ChatMediaContent {
        try await imageConversationTransport().loadConversationImage(sessionID: sessionID,
            messageID: messageID, index: index, manifest: manifest)
    }
}

extension URLPursuitWorkspaceClient: ConversationImageStreaming {
    func conversationImageUpdates(sessionID: UUID, messageID: UUID) async throws -> AsyncThrowingStream<ConversationImageQueueUpdate, Error> {
        try Task.checkCancellation()
        return try await imageConversationTransport().conversationImageUpdates(sessionID: sessionID, messageID: messageID)
    }
}
