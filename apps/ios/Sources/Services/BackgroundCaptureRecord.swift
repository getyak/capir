import Foundation

/// Owns intake identity before any remote state exists. Contains no credential.
struct BackgroundCaptureRecord: Codable, Identifiable {
    enum Stage: String, Codable { case saved, creatingSession, sessionReady, transferring, admitted, needsSignIn, failed, cancelled }
    let id: UUID
    let sessionID: UUID
    let messageID: UUID
    let attachmentID: UUID
    let sessionOperationID: UUID
    let activityInstanceID: UUID
    let baseURL: URL
    let accountID: String
    let userID: String
    let createdAt: Date
    let timeZone: String
    var stage: Stage = .saved
    var activityToken: String?
    var tokenRegistered = false
    var images: [ConversationImageManifest]? = nil
    var queueEntryID: UUID? = nil
    var usesSingleAdmission: Bool? = true
    var revision: Int? = 0
    var tokenGeneration: Int? = 0
    var registrationCredentialFingerprint: String? = nil
    var localDeletionEpoch: Int? = nil
    var registrationRetries: Int? = 0
    var recoveryAttempts: Int? = 0
    var sessionPayload: PersistedAgentSession
    var idempotencyKey: String { "ios-capture:\(id.uuidString.lowercased())" }
    var runtimeScope: String { RuntimeEndpoint.scope(baseURL, accountID: accountID, userID: userID) }

    init(session: TalentSignalSession, now: Date = Date()) {
        id = UUID(); sessionID = UUID(); messageID = UUID(); attachmentID = UUID()
        sessionOperationID = UUID(); activityInstanceID = UUID()
        baseURL = session.baseURL; accountID = session.account.id; userID = session.user.id
        createdAt = now; timeZone = TimeZone.current.identifier
        sessionPayload = PersistedAgentSession(AgentSession(id: sessionID, scope: .unresolvedIntent,
            title: "Screenshot", turns: [], contactReceipts: [], updatedAt: now,
            isUnread: false, createdAt: now))
    }
    func belongs(to session: TalentSignalSession) -> Bool {
        RuntimeEndpoint.same(baseURL, session.baseURL) && accountID == session.account.id && userID == session.user.id
    }

    var localSessionPayload: PersistedAgentSession {
        var payload = sessionPayload
        payload.backgroundCapturePendingAdmission = stage != .admitted
        if let images, !images.isEmpty {
            payload.pendingImageConversation = PendingImageConversation(messageID: messageID,
                idempotencyKey: idempotencyKey, objective: "", images: images, createdAt: createdAt,
                timeZone: timeZone, queueEntryID: queueEntryID,
                state: stage == .admitted ? .admitted : stage == .saved || stage == .sessionReady ? .prepared : .unknown)
        }
        return payload
    }
}
