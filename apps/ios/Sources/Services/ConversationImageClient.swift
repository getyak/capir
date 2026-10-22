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

struct ConversationImageQueueEntry: Decodable {
    static let statuses: Set<String> = ["queued", "running", "completed", "failed", "cancelled", "interrupted"]
    let queueEntryID: UUID
    let messageID: UUID
    let status: String
    let images: [ConversationImageManifest]
    let failureCode: String?
    let runID: UUID?
    enum CodingKeys: String, CodingKey {
        case queueEntryID = "queue_entry_id", messageID = "message_id", status, images
        case failureCode = "failure_code", runID = "run_id"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        queueEntryID = try c.decode(UUID.self, forKey: .queueEntryID)
        messageID = try c.decode(UUID.self, forKey: .messageID)
        status = try c.decode(String.self, forKey: .status)
        images = try c.decodeIfPresent([ConversationImageManifest].self, forKey: .images) ?? []
        failureCode = try c.decodeIfPresent(String.self, forKey: .failureCode)
        runID = try c.decodeIfPresent(UUID.self, forKey: .runID)
        guard Self.statuses.contains(status), images.count <= 10, images.allSatisfy(\.isValid) else {
            throw PursuitWorkspaceClientError.invalidResponse
        }
    }
}

struct ConversationImageObservation {
    let record: AgentSessionRemoteRecord
    let entry: ConversationImageQueueEntry?
}

struct ConversationImageSnapshot: Decodable {
    let contractVersion: String
    let sessionID: UUID
    let active: ConversationImageQueueEntry?
    let queued: [ConversationImageQueueEntry]
    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version", sessionID = "session_id", active, queued
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
        let path = "v1/agent-sessions/\(sessionID.uuidString.lowercased())"
        let snapshot: ConversationImageSnapshot = try await request(path: path + "/conversation-queue", token: token)
        guard snapshot.contractVersion == TalentSignalAPIContract.version, snapshot.sessionID == sessionID else {
            throw PursuitWorkspaceClientError.invalidResponse
        }
        var request = URLRequest(url: baseURL.appending(path: path))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await TalentSignalNetworking.data(for: request, using: session)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw PursuitWorkspaceClientError.invalidResponse
        }
        struct Envelope: Decodable {
            let contractVersion: String
            let session: AgentSessionRemoteRecord
            enum CodingKeys: String, CodingKey { case contractVersion = "contract_version", session }
        }
        let envelope = try JSONDecoder.agentSession.decode(Envelope.self, from: data)
        guard envelope.contractVersion == TalentSignalAPIContract.version, envelope.session.sessionID == sessionID,
              envelope.session.deletedAt == nil, envelope.session.expiresAt > Date(),
              envelope.session.payload?.id == sessionID else { throw PursuitWorkspaceClientError.invalidResponse }
        let matches = ([snapshot.active].compactMap { $0 } + snapshot.queued).filter { $0.messageID == messageID }
        guard matches.count <= 1 else { throw PursuitWorkspaceClientError.invalidResponse }
        return ConversationImageObservation(record: envelope.session, entry: matches.first)
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
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) != nil || ISO8601DateFormatter().date(from: value) != nil
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
