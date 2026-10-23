import CryptoKit
import Foundation

/// A recovery fingerprint contains only normalized metadata. Image bytes remain
/// in the current composer and must be selected again after relaunch.
enum AskScreenshotAdmissionPolicy {
    private struct ImageIdentity: Encodable {
        let mediaType: String
        let byteSize: Int
        let contentHash: String
    }

    private struct RequestIdentity: Encodable {
        let objective: String
        let personID: String?
        let relationshipContextID: String?
        let images: [ImageIdentity]
    }

    static func requestIdentity(
        images: [ScreenshotContactTaskBody.Image],
        objective: String,
        personID: String?,
        relationshipContextID: String?
    ) -> String? {
        guard !images.isEmpty, images.count <= 10 else { return nil }
        let identity = RequestIdentity(
            objective: objective, personID: personID,
            relationshipContextID: relationshipContextID,
            images: images.map {
                ImageIdentity(mediaType: $0.mediaType, byteSize: $0.byteSize, contentHash: $0.contentHash)
            }
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(identity) else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// A protected admission may already exist on the server. Capacity applies
    /// only to new intent; recovery still has to pass the exact-image/key gate.
    static func newAdmissionCapacityNotice(hasAttachments: Bool, hasPendingScreenshotAdmission: Bool, capacityNotice: String?) -> String? {
        guard hasAttachments, !hasPendingScreenshotAdmission else { return nil }
        return capacityNotice
    }

    static func canResumeAsText(hasPendingScreenshotAdmission: Bool, hasPendingPersonResearch: Bool,
        hasPendingImageConversation: Bool = false) -> Bool {
        !hasPendingScreenshotAdmission && !hasPendingPersonResearch && !hasPendingImageConversation
    }
}

/// A completion belongs to the Session and (for readback) exact task that
/// started it. Changing the visible Session cannot transfer its authority.
struct AskScreenshotResponseOwner {
    let sessionID: UUID
    let taskID: String?

    func accepts(currentSessionID: UUID?, responseTaskID: String, readOnlyTaskIDs: Set<String> = []) -> Bool {
        currentSessionID == sessionID
            && (taskID == nil || taskID == responseTaskID)
            && !readOnlyTaskIDs.contains(responseTaskID)
    }
}
