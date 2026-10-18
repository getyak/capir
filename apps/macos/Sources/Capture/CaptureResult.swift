import Foundation

struct CaptureImageManifest: Decodable, Sendable {
    let attachmentId: UUID
    let byteSize: Int
    let contentHash: String
}

struct CaptureTextClue: Decodable, Sendable, Equatable {
    enum Kind: String, Decodable, Sendable { case person, company }
    let kind: Kind
    let text: String
    let sourceExcerpt: String
}

struct CaptureImageObservation: Decodable, Sendable {
    enum ConversationKind: String, Decodable, Sendable { case direct, group, unknown }
    let artifactId: String
    let contentHash: String
    let model: String
    let inspectionRequestId: String
    let conversationKind: ConversationKind
    let pending: Bool
    let clues: [CaptureTextClue]
    let sourceWarning: String?
}

struct CaptureResult: Decodable, Sendable {
    let sessionId: UUID
    let messageId: UUID
    let queueEntryId: UUID
    let resultVersion: String
    let source: CaptureImageManifest
    let observation: CaptureImageObservation?
    let observedAt: String

    func matches(intent: CaptureIntent, queueEntryID: UUID?) -> Bool {
        guard sessionId == intent.sessionId, messageId == intent.messageId,
              queueEntryID == nil || queueEntryId == queueEntryID,
              source.attachmentId == intent.attachmentId, source.contentHash == intent.contentHash,
              source.byteSize == intent.imageByteSize,
              resultVersion.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return false }
        guard let observation else { return true }
        guard observation.pending, observation.clues.count <= 6,
              observation.contentHash == intent.contentHash,
              observation.artifactId == "conversation-image-\(intent.messageId.uuidString.lowercased())-0-\(intent.attachmentId.uuidString.lowercased())",
              !observation.model.isEmpty, observation.model.utf16.count <= 200,
              !observation.inspectionRequestId.isEmpty, observation.inspectionRequestId.utf16.count <= 200,
              observation.sourceWarning == nil || observation.sourceWarning == "ai_generated_or_fictional" else { return false }
        return observation.clues.allSatisfy { clue in
            !clue.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && clue.text.utf16.count <= 80 &&
                clue.sourceExcerpt.utf16.count <= 240 && clue.sourceExcerpt.contains(clue.text) &&
                clue.text.range(of: "[\\x{0000}-\\x{001f}\\x{007f}-\\x{009f}\\x{202a}-\\x{202e}\\x{2066}-\\x{2069}]",
                                options: .regularExpression) == nil
        }
    }
}
