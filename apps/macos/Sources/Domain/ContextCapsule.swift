import Foundation

enum CapsuleSourceKind: String, Codable, CaseIterable, Sendable {
    case selectedText = "Selected text"
    case file = "File"
    case window = "System-selected window"
}

enum CapsuleRetention: String, Codable, CaseIterable, Identifiable, Sendable {
    case taskOnly
    case oneHour
    case twentyFourHours

    var id: String { rawValue }

    var title: String {
        switch self {
        case .taskOnly: "Delete when task ends"
        case .oneHour: "Keep locally for 1 hour"
        case .twentyFourHours: "Keep locally for 24 hours"
        }
    }

    var apiValue: String { "ephemeral" }
}

/// The person or party who authored the reviewed excerpt. Relationship scope
/// and source attribution are deliberately separate: selecting a Person does
/// not make arbitrary pasted or OCR text that person's words.
enum CapsuleActorKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case candidate
    case recruiter
    case client
    case documentAuthor = "document_author"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .candidate: "Candidate"
        case .recruiter: "Recruiter"
        case .client: "Client"
        case .documentAuthor: "Document author"
        }
    }
}

struct ContextCapsuleItem: Identifiable, Equatable, Codable, Sendable {
    let id: UUID
    let kind: CapsuleSourceKind
    let displayName: String
    var preview: String
    let acquisition: String
    let capturedAt: Date
    var localOnly: Bool
    var retention: CapsuleRetention
    var redactionCount: Int
    let sourceFingerprint: String?
    let localAssetData: Data?
    let localAssetMediaType: String?
    /// Optional for backward-compatible decoding of drafts written before
    /// file extraction existed. Metadata-only files remain fail-closed.
    let textDerivativeIsReviewable: Bool?
    /// Nil is the fail-closed, unresolved default. Optional fields preserve
    /// decoding of encrypted drafts written by earlier builds.
    var actorKind: CapsuleActorKind?
    var attributionConfirmedAt: Date?

    init(
        id: UUID = UUID(),
        kind: CapsuleSourceKind,
        displayName: String,
        preview: String,
        acquisition: String,
        capturedAt: Date = Date(),
        localOnly: Bool = false,
        retention: CapsuleRetention = .taskOnly,
        redactionCount: Int = 0,
        sourceFingerprint: String? = nil,
        localAssetData: Data? = nil,
        localAssetMediaType: String? = nil,
        textDerivativeIsReviewable: Bool? = nil,
        actorKind: CapsuleActorKind? = nil,
        attributionConfirmedAt: Date? = nil
    ) {
        self.id = id
        self.kind = kind
        self.displayName = displayName
        self.preview = preview
        self.acquisition = acquisition
        self.capturedAt = capturedAt
        self.localOnly = localOnly
        self.retention = retention
        self.redactionCount = redactionCount
        self.sourceFingerprint = sourceFingerprint
        self.localAssetData = localAssetData
        self.localAssetMediaType = localAssetMediaType
        self.textDerivativeIsReviewable = textDerivativeIsReviewable
        self.actorKind = actorKind
        self.attributionConfirmedAt = attributionConfirmedAt
    }

    var hasReviewedTextDerivative: Bool {
        switch kind {
        case .selectedText:
            return !preview.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .window:
            return !preview.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .file:
            return textDerivativeIsReviewable == true &&
                !preview.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    var hasConfirmedAttribution: Bool {
        actorKind != nil && attributionConfirmedAt != nil
    }
}

struct ContextCapsuleDraft: Equatable, Codable, Sendable {
    var id = UUID()
    var version = 1
    var purpose = "Understand what changed and propose the smallest safe next step."
    var items: [ContextCapsuleItem] = []
    /// Encrypted with the account-scoped Capsule but never included in a
    /// submitted manifest. Copy/open receipts are intentionally not durable.
    var localPreparedDraft: LocalPreparedDraftRecovery?

    var sharedItems: [ContextCapsuleItem] {
        items.filter {
            !$0.localOnly &&
                $0.hasReviewedTextDerivative &&
                $0.hasConfirmedAttribution &&
                $0.actorKind == .candidate
        }
    }
    var canSubmit: Bool { !purpose.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !sharedItems.isEmpty }

    func canSubmit(sourceItemID: UUID) -> Bool {
        !purpose.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            sharedItems.contains(where: { $0.id == sourceItemID })
    }

    mutating func addSelectedText(_ text: String, now: Date = Date()) {
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return }
        items.append(
            ContextCapsuleItem(
                kind: .selectedText,
                displayName: "User-selected text",
                preview: normalized,
                acquisition: "Explicit text entry",
                capturedAt: now
            )
        )
        version += 1
    }

    mutating func addFile(url: URL, size: Int64?, now: Date = Date()) {
        let sizeDescription = size.map { ByteCountFormatter.string(fromByteCount: $0, countStyle: .file) } ?? "Size unavailable"
        items.append(
            ContextCapsuleItem(
                kind: .file,
                displayName: url.lastPathComponent,
                preview: sizeDescription,
                acquisition: "Explicit file picker or drag and drop",
                capturedAt: now,
                localOnly: true
            )
        )
        version += 1
    }

    mutating func addProcessedFile(
        displayName: String,
        reviewedText: String,
        rawData: Data,
        mediaType: String,
        acquisition: String,
        sourceFingerprint: String,
        now: Date = Date()
    ) {
        let normalized = reviewedText.trimmingCharacters(in: .whitespacesAndNewlines)
        items.append(
            ContextCapsuleItem(
                kind: .file,
                displayName: displayName,
                preview: normalized,
                acquisition: acquisition,
                capturedAt: now,
                localOnly: true,
                sourceFingerprint: sourceFingerprint,
                localAssetData: rawData,
                localAssetMediaType: mediaType,
                textDerivativeIsReviewable: !normalized.isEmpty
            )
        )
        version += 1
    }

    mutating func addWindowCapture(
        recognizedText: String,
        imagePNG: Data,
        pixelWidth: Int,
        pixelHeight: Int,
        sourceFingerprint: String,
        now: Date = Date()
    ) {
        let reviewedText = recognizedText.trimmingCharacters(in: .whitespacesAndNewlines)
        items.append(
            ContextCapsuleItem(
                kind: .window,
                displayName: "System-selected window · \(pixelWidth)×\(pixelHeight)",
                preview: reviewedText,
                acquisition: "System picker · single window · one frame · local OCR",
                capturedAt: now,
                localOnly: true,
                sourceFingerprint: sourceFingerprint,
                localAssetData: imagePNG,
                localAssetMediaType: "image/png"
            )
        )
        version += 1
    }

    mutating func remove(id: UUID) {
        items.removeAll { $0.id == id }
        if localPreparedDraft?.sourceItemID == id {
            localPreparedDraft = nil
        }
        version += 1
    }

    mutating func setLocalOnly(id: UUID, value: Bool) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        guard value || items[index].hasReviewedTextDerivative else { return }
        items[index].localOnly = value
        version += 1
    }

    mutating func setRetention(id: UUID, value: CapsuleRetention) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].retention = value
        version += 1
    }

    mutating func setActorKind(id: UUID, value: CapsuleActorKind?) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].actorKind = value
        // Any change invalidates the earlier human confirmation.
        items[index].attributionConfirmedAt = nil
        version += 1
    }

    mutating func confirmAttribution(id: UUID, now: Date = Date()) {
        guard let index = items.firstIndex(where: { $0.id == id }),
              items[index].actorKind != nil else { return }
        items[index].attributionConfirmedAt = now
        version += 1
    }

    @discardableResult
    mutating func redact(id: UUID, exactTerms: [String]) -> Int {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return 0 }
        let terms = exactTerms
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !terms.isEmpty else { return 0 }

        var reviewed = items[index].preview
        var total = 0
        for term in Set(terms) {
            let pattern = NSRegularExpression.escapedPattern(for: term)
            guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            let range = NSRange(reviewed.startIndex..<reviewed.endIndex, in: reviewed)
            let matches = expression.numberOfMatches(in: reviewed, range: range)
            guard matches > 0 else { continue }
            reviewed = expression.stringByReplacingMatches(
                in: reviewed,
                range: range,
                withTemplate: "[REDACTED]"
            )
            total += matches
        }
        guard total > 0 else { return 0 }
        items[index].preview = reviewed
        items[index].redactionCount += total
        version += 1
        return total
    }

    @discardableResult
    mutating func purgeTaskOnlyItems() -> Int {
        let before = items.count
        items.removeAll { $0.retention == .taskOnly }
        let removed = before - items.count
        if removed > 0 {
            if let sourceID = localPreparedDraft?.sourceItemID,
               !items.contains(where: { $0.id == sourceID }) {
                localPreparedDraft = nil
            }
            version += 1
        }
        return removed
    }

    func freeze(
        accountID: String,
        pursuitID: String?,
        personID: String?,
        sourceItemID: UUID? = nil,
        now: Date = Date()
    ) throws -> SubmittedContextManifest {
        let selectedSharedItems = sourceItemID.map { sourceID in
            sharedItems.filter { $0.id == sourceID }
        } ?? sharedItems
        guard !purpose.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !selectedSharedItems.isEmpty else {
            throw CapsuleValidationError.noReviewedSharedContext
        }
        return SubmittedContextManifest(
            capsuleID: id.uuidString,
            version: version,
            accountID: accountID,
            pursuitID: pursuitID,
            personID: personID,
            purpose: purpose.trimmingCharacters(in: .whitespacesAndNewlines),
            submittedAt: now,
            idempotencyKey: "mac-capsule-\(id.uuidString)-v\(version)" +
                (sourceItemID.map { "-source-\($0.uuidString)" } ?? ""),
            selectedItems: selectedSharedItems.map {
                SubmittedContextItem(
                    sourceID: $0.id.uuidString,
                    kind: $0.kind,
                    displayName: $0.displayName,
                    reviewedContent: $0.preview,
                    acquisition: $0.acquisition,
                    retention: $0.retention,
                    sourceFingerprint: $0.sourceFingerprint,
                    actorKind: $0.actorKind!,
                    attributionConfirmedAt: $0.attributionConfirmedAt!
                )
            }
        )
    }
}

struct LocalPreparedDraftRecovery: Equatable, Codable, Sendable {
    let sourceItemID: UUID
    let sourceDigest: String
    /// Binds an unsent draft to the exact local interpretation rules that
    /// produced it. Older drafts fail closed when compiler behavior changes.
    let derivationVersion: String?
    /// Optional for backward-compatible recovery of drafts saved before the
    /// four communication purposes were introduced.
    let kind: PreparedDraftKind?
    let subject: String
    let body: String
    let savedAt: Date
    let expiresAt: Date

    init(
        sourceItemID: UUID,
        sourceDigest: String,
        derivationVersion: String? = nil,
        kind: PreparedDraftKind? = nil,
        subject: String,
        body: String,
        savedAt: Date,
        expiresAt: Date
    ) {
        self.sourceItemID = sourceItemID
        self.sourceDigest = sourceDigest
        self.derivationVersion = derivationVersion
        self.kind = kind
        self.subject = subject
        self.body = body
        self.savedAt = savedAt
        self.expiresAt = expiresAt
    }
}

enum CapsuleValidationError: LocalizedError, Equatable {
    case noReviewedSharedContext

    var errorDescription: String? {
        "Add at least one reviewed item, confirm its source attribution separately, and allow its text derivative to leave this Mac."
    }
}

struct SubmittedContextItem: Equatable, Sendable {
    let sourceID: String
    let kind: CapsuleSourceKind
    let displayName: String
    let reviewedContent: String
    let acquisition: String
    let retention: CapsuleRetention
    let sourceFingerprint: String?
    let actorKind: CapsuleActorKind
    let attributionConfirmedAt: Date
}

struct SubmittedContextManifest: Equatable, Sendable {
    let capsuleID: String
    let version: Int
    let accountID: String
    let pursuitID: String?
    let personID: String?
    let purpose: String
    let submittedAt: Date
    let idempotencyKey: String
    let selectedItems: [SubmittedContextItem]
}
