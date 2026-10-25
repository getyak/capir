import Foundation

/// A retry first reconciles both authenticated history and the queue. Failure
/// to read either cannot authorize a resend; a known receipt stays received.
@MainActor
enum ConversationImageRetry {
    static func reconcile(pending: PendingImageConversation, sessionID: UUID,
        store: AgentSessionStore, progress: ConversationImageProgressTracker,
        read: () async throws -> ConversationImageObservation,
        isCurrent: () -> Bool) async throws -> ImageConversationReadback {
        guard isCurrent() else { throw CancellationError() }
        progress.beginChecking(messageID: pending.messageID)
        defer { if isCurrent() { progress.finishChecking(messageID: pending.messageID) } }
        let observation = try await read()
        try Task.checkCancellation()
        guard isCurrent() else { throw CancellationError() }
        let result: ImageConversationReadback
        do {
            result = try store.observeImageConversation(sessionID: sessionID,
                messageID: pending.messageID, observation: observation)
        } catch ImageConversationError.persistence {
            // Reconciliation may have found a received message or saved reply.
            // A local persistence failure cannot claim that nothing was sent.
            throw ImageConversationError.replyPersistence
        }
        if result == .unknown, pending.queueEntryID != nil { throw ImageConversationError.unknown }
        return result
    }
}
