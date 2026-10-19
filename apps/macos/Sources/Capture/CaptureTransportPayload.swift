import Foundation

enum CaptureTransportPayload {
    static func encode(_ intent: CaptureIntent) throws -> Data {
        guard intent.hasRawImage, intent.imagePNG.count == intent.imageByteSize else {
            throw CaptureIntentError.emptyImage
        }
        let image: [String: Any] = [
            "attachment_id": intent.attachmentId.uuidString.lowercased(),
            "file_name": "capture.png",
            "media_type": "image/png",
            "byte_size": intent.imageByteSize,
            "content_hash": intent.contentHash,
            "data_base64": intent.imagePNG.base64EncodedString(),
        ]
        let body: [String: Any] = [
            "policy_version": intent.policyVersion,
            "owner_scope": intent.ownerScope,
            "idempotency_key": intent.idempotencyKey,
            "session_id": intent.sessionId.uuidString.lowercased(),
            "message_id": intent.messageId.uuidString.lowercased(),
            "objective": intent.objective ?? "",
            "images": [image],
        ]
        return try JSONSerialization.data(withJSONObject: body)
    }
}
