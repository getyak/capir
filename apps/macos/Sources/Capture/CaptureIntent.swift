import CryptoKit
import Foundation

struct CaptureProcessing: Codable, Equatable, Sendable {
    let policyVersion: String
    let workspaceLabel: String
    let processorLabels: [String]
    let sourceRetentionDays: Int
    let available: Bool

    init(policyVersion: String, workspaceLabel: String, processorLabels: [String],
         sourceRetentionDays: Int, available: Bool) {
        self.policyVersion = policyVersion
        self.workspaceLabel = workspaceLabel
        self.processorLabels = processorLabels
        self.sourceRetentionDays = sourceRetentionDays
        self.available = available
    }

    private enum CodingKeys: String, CodingKey {
        case policyVersion, workspaceLabel, processorLabels, sourceRetentionDays, available
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        policyVersion = try values.decode(String.self, forKey: .policyVersion)
        workspaceLabel = try values.decodeIfPresent(String.self, forKey: .workspaceLabel) ?? ""
        processorLabels = try values.decode([String].self, forKey: .processorLabels)
        sourceRetentionDays = try values.decode(Int.self, forKey: .sourceRetentionDays)
        available = try values.decode(Bool.self, forKey: .available)
    }
}

struct CaptureContext: Equatable, Sendable {
    let origin: String
    let ownerScope: String
    let workspaceAccountID: String
    let loginBinding: String
    let expiresAt: Date
    let processing: CaptureProcessing

    private struct Wire: Decodable {
        let protocolVersion: Int
        let ownerScope: String
        let workspaceAccountId: String?
        let loginBinding: String
        let expiresAt: String
        let processing: CaptureProcessing
    }

    init(origin: String, ownerScope: String, loginBinding: String, expiresAt: Date,
         processing: CaptureProcessing, workspaceAccountID: String = "") {
        self.origin = origin
        self.ownerScope = ownerScope
        self.workspaceAccountID = workspaceAccountID
        self.loginBinding = loginBinding
        self.expiresAt = expiresAt
        self.processing = processing
    }

    static func decode(_ data: Data, origin: String) throws -> CaptureContext {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let wire = try decoder.decode(Wire.self, from: data)
        guard wire.protocolVersion == 1, !wire.ownerScope.isEmpty, !wire.loginBinding.isEmpty,
              !wire.processing.policyVersion.isEmpty,
              !wire.processing.available || (!wire.processing.workspaceLabel.isEmpty && !(wire.workspaceAccountId ?? "").isEmpty)
        else { throw CaptureIntentError.invalidContext }
        let withFractions = ISO8601DateFormatter()
        withFractions.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let withoutFractions = ISO8601DateFormatter()
        guard let expiry = withFractions.date(from: wire.expiresAt) ?? withoutFractions.date(from: wire.expiresAt)
        else { throw CaptureIntentError.invalidContext }
        return CaptureContext(origin: origin, ownerScope: wire.ownerScope, loginBinding: wire.loginBinding,
                              expiresAt: expiry, processing: wire.processing,
                              workspaceAccountID: wire.workspaceAccountId ?? "")
    }
}

enum CapturePhase: String, Codable, Sendable {
    case staged, uploading, unknown, admitted, viewable, failed
}

enum CaptureIntentError: Error {
    case invalidContext, emptyImage, imageTooLarge
}

/** One immutable image and one stable message identity across retries. */
struct CaptureIntent: Codable, Equatable, Sendable {
    let id: UUID
    let sessionId: UUID
    let messageId: UUID
    let attachmentId: UUID
    let origin: String
    let ownerScope: String
    /// Optional only so an intent staged by an earlier build remains readable.
    /// A missing binding cannot authorize a new upload.
    let loginBinding: String?
    /// Set only after an explicit retry has confirmed the old message absent
    /// under the same owner. The original binding remains available for audit.
    var authorizedReplayLoginBinding: String?
    let policyVersion: String
    let capturedAt: Date
    var imagePNG: Data
    /// Retains exact receipt matching after verified admission releases pixels.
    /// Optional so recovery files written before this field existed still load.
    var recordedImageByteSize: Int?
    let contentHash: String
    var phase: CapturePhase
    var queueEntryId: UUID?

    init(imagePNG: Data, context: CaptureContext, capturedAt: Date = Date(),
         id: UUID = UUID(), sessionId: UUID = UUID(), messageId: UUID = UUID(), attachmentId: UUID = UUID()) throws {
        guard context.processing.available, !context.ownerScope.isEmpty, !context.loginBinding.isEmpty,
              !context.processing.policyVersion.isEmpty
        else { throw CaptureIntentError.invalidContext }
        guard !imagePNG.isEmpty else { throw CaptureIntentError.emptyImage }
        guard imagePNG.count <= 10_000_000 else { throw CaptureIntentError.imageTooLarge }
        self.id = id
        self.sessionId = sessionId
        self.messageId = messageId
        self.attachmentId = attachmentId
        self.origin = context.origin
        self.ownerScope = context.ownerScope
        self.loginBinding = context.loginBinding
        self.authorizedReplayLoginBinding = nil
        self.policyVersion = context.processing.policyVersion
        self.capturedAt = capturedAt
        self.imagePNG = imagePNG
        recordedImageByteSize = nil
        contentHash = SHA256.hash(data: imagePNG).map { String(format: "%02x", $0) }.joined()
        phase = .staged
        queueEntryId = nil
    }

    var idempotencyKey: String { messageId.uuidString.lowercased() }
    var imageByteSize: Int { recordedImageByteSize ?? imagePNG.count }
    var hasRawImage: Bool { !imagePNG.isEmpty }
    var localRecoveryDeadline: Date { capturedAt.addingTimeInterval(86_400) }
    func isLocallyExpired(at date: Date) -> Bool { date >= localRecoveryDeadline }

    func withoutRawImage() -> CaptureIntent {
        var admitted = self
        admitted.recordedImageByteSize = imageByteSize
        admitted.imagePNG = Data()
        admitted.phase = .admitted
        return admitted
    }

    func canSubmit(context: CaptureContext, now: Date) -> Bool {
        canExplicitlyReplay(context: context, now: now) &&
            (authorizedReplayLoginBinding ?? loginBinding) == context.loginBinding
    }

    func canExplicitlyReplay(context: CaptureContext, now: Date) -> Bool {
        hasRawImage && loginBinding != nil && canReadback(context: context, now: now) && context.processing.available &&
            policyVersion == context.processing.policyVersion && !isLocallyExpired(at: now)
    }

    func canReadback(context: CaptureContext, now: Date) -> Bool {
        origin == context.origin && ownerScope == context.ownerScope && context.expiresAt > now
    }
}
