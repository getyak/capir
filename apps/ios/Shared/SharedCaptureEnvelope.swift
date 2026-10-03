import Foundation

enum StandaloneSharedCaptureConfiguration {
    static var isEnabled: Bool {
#if DEBUG
        true
#else
        false
#endif
    }
}

enum SharedCapturePayloadKind: String, Codable, CaseIterable, Sendable {
    case image
    case text
    case url
}

struct SharedCaptureEnvelope: Codable, Equatable, Identifiable, Sendable {
    static let schemaVersion = 2
    static let supportedSchemaVersions: Set<Int> = [1, schemaVersion]

    let id: UUID
    let schemaVersion: Int
    let kind: SharedCapturePayloadKind
    let createdAt: Date
    let sourceApplication: String?
    let sourceText: String?
    let recruiterNote: String?
    let url: URL?
    let payloadFileName: String?
    let mediaType: String?

    init(
        id: UUID = UUID(),
        kind: SharedCapturePayloadKind,
        createdAt: Date = Date(),
        sourceApplication: String? = nil,
        sourceText: String? = nil,
        recruiterNote: String? = nil,
        url: URL? = nil,
        payloadFileName: String? = nil,
        mediaType: String? = nil
    ) {
        self.id = id
        schemaVersion = Self.schemaVersion
        self.kind = kind
        self.createdAt = createdAt
        self.sourceApplication = sourceApplication
        self.sourceText = sourceText
        self.recruiterNote = recruiterNote
        self.url = url
        self.payloadFileName = payloadFileName
        self.mediaType = mediaType
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case schemaVersion
        case kind
        case createdAt
        case sourceApplication
        case sourceText
        case recruiterNote
        case legacyText = "text"
        case url
        case payloadFileName
        case mediaType
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        kind = try container.decode(SharedCapturePayloadKind.self, forKey: .kind)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        sourceApplication = try container.decodeIfPresent(String.self, forKey: .sourceApplication)
        url = try container.decodeIfPresent(URL.self, forKey: .url)
        payloadFileName = try container.decodeIfPresent(String.self, forKey: .payloadFileName)
        mediaType = try container.decodeIfPresent(String.self, forKey: .mediaType)

        let legacyText = try container.decodeIfPresent(String.self, forKey: .legacyText)
        if let explicitSource = try container.decodeIfPresent(String.self, forKey: .sourceText) {
            sourceText = explicitSource
        } else if schemaVersion == 1, kind == .text {
            sourceText = legacyText
        } else {
            sourceText = nil
        }
        if let explicitNote = try container.decodeIfPresent(String.self, forKey: .recruiterNote) {
            recruiterNote = explicitNote
        } else if schemaVersion == 1, kind != .text {
            recruiterNote = legacyText
        } else {
            recruiterNote = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(kind, forKey: .kind)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(sourceApplication, forKey: .sourceApplication)
        try container.encodeIfPresent(sourceText, forKey: .sourceText)
        try container.encodeIfPresent(recruiterNote, forKey: .recruiterNote)
        try container.encodeIfPresent(url, forKey: .url)
        try container.encodeIfPresent(payloadFileName, forKey: .payloadFileName)
        try container.encodeIfPresent(mediaType, forKey: .mediaType)
    }
}

struct SharedCaptureInbox {
    static let appGroupIdentifier = "group.com.talentsignal.app"

    private let rootURL: URL
    private let fileManager: FileManager

#if DEBUG
    private static var retainedSourceFixtureID: UUID? {
        fixtureID(after: "--standalone-retained-source-fixture")
    }

    private static var pendingShortcutFixtureID: UUID? {
        fixtureID(after: "--standalone-pending-shortcut-fixture")
    }

    private static var debugFixtureRootID: UUID? {
        retainedSourceFixtureID ?? pendingShortcutFixtureID
    }

    private static func fixtureID(after flag: String) -> UUID? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: flag),
              arguments.indices.contains(index + 1) else { return nil }
        return UUID(uuidString: arguments[index + 1])
    }
#endif

    init(
        rootURL: URL? = nil,
        fileManager: FileManager = .default
    ) throws {
        self.fileManager = fileManager
#if DEBUG
        let debugFixtureRootURL = Self.debugFixtureRootID.map { fixtureID in
            fileManager.temporaryDirectory
                .appending(
                    path: "StandaloneSharedCaptureUITest",
                    directoryHint: .isDirectory
                )
                .appending(
                    path: fixtureID.uuidString.lowercased(),
                    directoryHint: .isDirectory
                )
        }
#else
        let debugFixtureRootURL: URL? = nil
#endif
        if let rootURL {
            self.rootURL = rootURL
        } else if let debugFixtureRootURL {
            self.rootURL = debugFixtureRootURL
        } else if let container = fileManager.containerURL(
            forSecurityApplicationGroupIdentifier: Self.appGroupIdentifier
        ) {
            self.rootURL = container.appending(
                path: "StandaloneSharedCapture",
                directoryHint: .isDirectory
            )
        } else {
            throw SharedCaptureInboxError.appGroupUnavailable
        }
        try prepareDirectories()
        try recoverPendingTransactions()
#if DEBUG
        try seedRetainedSourceFixtureIfNeeded()
#endif
    }

#if DEBUG
    private func seedRetainedSourceFixtureIfNeeded() throws {
        guard let fixtureID = Self.retainedSourceFixtureID else { return }
        let marker = rootURL.appending(path: ".retained-source-fixture-seeded")
        guard !fileManager.fileExists(atPath: marker.path) else { return }
        if try envelope(id: fixtureID) == nil {
            _ = try appendImage(
                id: fixtureID,
                data: Data("synthetic-retained-source".utf8),
                fileExtension: "png",
                mediaType: "image/png",
                sourceText: "Synthetic retained source for UI deletion proof",
                sourceApplication: "Round 7 UI fixture",
                now: Date(timeIntervalSince1970: 42)
            )
        }
        try markImported(fixtureID)
        try Data().write(to: marker, options: [.atomic, .completeFileProtection])
    }
#endif

    @discardableResult
    func appendText(
        _ text: String,
        note: String? = nil,
        sourceApplication: String? = nil,
        now: Date = Date()
    ) throws -> SharedCaptureEnvelope {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw SharedCaptureInboxError.emptyPayload }
        let envelope = SharedCaptureEnvelope(
            kind: .text,
            createdAt: now,
            sourceApplication: sourceApplication,
            sourceText: trimmed,
            recruiterNote: note?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        )
        try append(envelope)
        return envelope
    }

    @discardableResult
    func appendURL(
        _ url: URL,
        note: String? = nil,
        sourceApplication: String? = nil,
        now: Date = Date()
    ) throws -> SharedCaptureEnvelope {
        guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme) else {
            throw SharedCaptureInboxError.unsupportedURL
        }
        let envelope = SharedCaptureEnvelope(
            kind: .url,
            createdAt: now,
            sourceApplication: sourceApplication,
            recruiterNote: note?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            url: url
        )
        try append(envelope)
        return envelope
    }

    @discardableResult
    func appendImage(
        id: UUID = UUID(),
        data: Data,
        fileExtension: String,
        mediaType: String,
        sourceText: String? = nil,
        note: String? = nil,
        sourceApplication: String? = nil,
        now: Date = Date()
    ) throws -> SharedCaptureEnvelope {
        guard !data.isEmpty else { throw SharedCaptureInboxError.emptyPayload }
        let safeExtension = fileExtension
            .lowercased()
            .filter { $0.isLetter || $0.isNumber }
        let payloadFileName = "\(id.uuidString.lowercased()).\(safeExtension.isEmpty ? "image" : safeExtension)"
        let finalURL = payloadsDirectory.appending(path: payloadFileName)
        let envelope = SharedCaptureEnvelope(
            id: id,
            kind: .image,
            createdAt: now,
            sourceApplication: sourceApplication,
            sourceText: sourceText?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            recruiterNote: note?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            payloadFileName: payloadFileName,
            mediaType: mediaType
        )
        let temporaryPayloadURL = temporaryDirectory.appending(path: "\(payloadFileName).tmp")
        let temporaryEnvelopeURL = transactionEnvelopeURL(for: id)
        let finalEnvelopeURL = envelopeURL(for: id, in: inboxDirectory)
        do {
            guard !fileManager.fileExists(atPath: finalEnvelopeURL.path) else {
                throw SharedCaptureInboxError.duplicateEnvelope
            }
            try Self.encoder.encode(envelope).write(
                to: temporaryEnvelopeURL,
                options: [.atomic, .completeFileProtection]
            )
            try data.write(
                to: temporaryPayloadURL,
                options: [.atomic, .completeFileProtection]
            )
            try fileManager.moveItem(at: temporaryPayloadURL, to: finalURL)
            try fileManager.moveItem(at: temporaryEnvelopeURL, to: finalEnvelopeURL)
        } catch {
            try? fileManager.removeItem(at: temporaryEnvelopeURL)
            try? fileManager.removeItem(at: temporaryPayloadURL)
            try? fileManager.removeItem(at: finalURL)
            throw error
        }
        return envelope
    }

    func pending() throws -> [SharedCaptureEnvelope] {
        try envelopes(in: inboxDirectory)
    }

    func retained() throws -> [SharedCaptureEnvelope] {
        try envelopes(in: importedDirectory)
    }

    func reconcileDeletionTransactions(retainedEnvelopeIDs: Set<UUID>) throws {
        for directory in try fileManager.contentsOfDirectory(
            at: deletingDirectory,
            includingPropertiesForKeys: [.isDirectoryKey]
        ) where (try? directory.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
            if fileManager.fileExists(atPath: directory.appending(path: "committed").path) {
                try fileManager.removeItem(at: directory)
                continue
            }
            guard let manifest = try deletionManifest(at: directory) else {
                continue
            }
            if retainedEnvelopeIDs.contains(manifest.id) {
                try recoverDeletion(at: directory)
            } else {
                try fileManager.removeItem(at: directory)
            }
        }
    }

    private func envelopes(in directory: URL) throws -> [SharedCaptureEnvelope] {
        try fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        )
        .filter { $0.pathExtension == "json" }
        .map { url in
            let envelope: SharedCaptureEnvelope
            do {
                envelope = try Self.decoder.decode(
                    SharedCaptureEnvelope.self,
                    from: Data(contentsOf: url)
                )
            } catch {
                throw SharedCaptureInboxError.corruptEnvelope(url.lastPathComponent)
            }
            guard SharedCaptureEnvelope.supportedSchemaVersions.contains(envelope.schemaVersion) else {
                throw SharedCaptureInboxError.unsupportedSchema(envelope.schemaVersion)
            }
            return envelope
        }
        .sorted {
            if $0.createdAt == $1.createdAt { return $0.id.uuidString < $1.id.uuidString }
            return $0.createdAt < $1.createdAt
        }
    }

    func envelope(id: UUID) throws -> SharedCaptureEnvelope? {
        for directory in [inboxDirectory, importedDirectory] {
            let url = envelopeURL(for: id, in: directory)
            guard fileManager.fileExists(atPath: url.path) else { continue }
            let envelope = try Self.decoder.decode(
                SharedCaptureEnvelope.self,
                from: Data(contentsOf: url)
            )
            guard SharedCaptureEnvelope.supportedSchemaVersions.contains(envelope.schemaVersion) else {
                throw SharedCaptureInboxError.unsupportedSchema(envelope.schemaVersion)
            }
            return envelope
        }
        return nil
    }

    func markImported(_ id: UUID) throws {
        let source = envelopeURL(for: id, in: inboxDirectory)
        guard fileManager.fileExists(atPath: source.path) else { return }
        let destination = envelopeURL(for: id, in: importedDirectory)
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: source)
        } else {
            try fileManager.moveItem(at: source, to: destination)
        }
    }

    func stageDeletion(_ id: UUID) throws -> SharedCaptureDeletionTransaction {
        guard let envelope = try envelope(id: id) else {
            throw SharedCaptureInboxError.captureNotFound(id)
        }
        let directoryName = id.uuidString.lowercased()
        let transactionDirectory = deletingDirectory.appending(
            path: directoryName,
            directoryHint: .isDirectory
        )
        if fileManager.fileExists(atPath: transactionDirectory.path) {
            throw SharedCaptureInboxError.deletionAlreadyInProgress(id)
        }
        try fileManager.createDirectory(
            at: transactionDirectory,
            withIntermediateDirectories: false,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
        var sourcePaths = [
            "Inbox/\(id.uuidString.lowercased()).json",
            "Imported/\(id.uuidString.lowercased()).json",
            "Temporary/\(id.uuidString.lowercased()).json.tmp",
        ]
        if let payloadFileName = envelope.payloadFileName {
            sourcePaths.append("Payloads/\(payloadFileName)")
            sourcePaths.append("Temporary/\(payloadFileName).tmp")
        }
        let moves = sourcePaths.enumerated().compactMap { index, relativePath -> DeletionMove? in
            let source = rootURL.appending(path: relativePath)
            guard fileManager.fileExists(atPath: source.path) else { return nil }
            return DeletionMove(
                sourceRelativePath: relativePath,
                stagedFileName: "\(index)-\(source.lastPathComponent)"
            )
        }
        guard !moves.isEmpty else {
            try fileManager.removeItem(at: transactionDirectory)
            throw SharedCaptureInboxError.captureNotFound(id)
        }
        let manifest = DeletionManifest(id: id, moves: moves)
        let manifestURL = transactionDirectory.appending(path: "manifest.json")
        do {
            try Self.encoder.encode(manifest).write(
                to: manifestURL,
                options: [.atomic, .completeFileProtection]
            )
            for move in moves {
                try fileManager.moveItem(
                    at: rootURL.appending(path: move.sourceRelativePath),
                    to: transactionDirectory.appending(path: move.stagedFileName)
                )
            }
        } catch {
            try? recoverDeletion(at: transactionDirectory)
            throw error
        }
        return SharedCaptureDeletionTransaction(id: id, directoryName: directoryName)
    }

    func commitDeletion(_ transaction: SharedCaptureDeletionTransaction) throws {
        let directory = deletingDirectory.appending(
            path: transaction.directoryName,
            directoryHint: .isDirectory
        )
        guard fileManager.fileExists(atPath: directory.path) else { return }
        try Data().write(
            to: directory.appending(path: "committed"),
            options: [.atomic, .completeFileProtection]
        )
        try fileManager.removeItem(at: directory)
    }

    func rollbackDeletion(_ transaction: SharedCaptureDeletionTransaction) throws {
        try recoverDeletion(
            at: deletingDirectory.appending(
                path: transaction.directoryName,
                directoryHint: .isDirectory
            )
        )
    }

    func reset() throws {
        if fileManager.fileExists(atPath: rootURL.path) {
            try fileManager.removeItem(at: rootURL)
        }
    }

    func payloadURL(for envelope: SharedCaptureEnvelope) -> URL? {
        guard let payloadFileName = envelope.payloadFileName else { return nil }
        return payloadURL(fileName: payloadFileName)
    }

    func payloadURL(fileName: String) -> URL? {
        let candidate = payloadsDirectory.appending(path: fileName)
        return fileManager.fileExists(atPath: candidate.path) ? candidate : nil
    }

    private func append(_ envelope: SharedCaptureEnvelope) throws {
        let finalURL = envelopeURL(for: envelope.id, in: inboxDirectory)
        guard !fileManager.fileExists(atPath: finalURL.path) else {
            throw SharedCaptureInboxError.duplicateEnvelope
        }
        let temporaryURL = temporaryDirectory.appending(
            path: "\(envelope.id.uuidString.lowercased()).json.tmp"
        )
        try Self.encoder.encode(envelope).write(
            to: temporaryURL,
            options: [.completeFileProtection]
        )
        try fileManager.moveItem(at: temporaryURL, to: finalURL)
    }

    private func prepareDirectories() throws {
        for directory in [
            rootURL,
            inboxDirectory,
            importedDirectory,
            payloadsDirectory,
            temporaryDirectory,
            deletingDirectory,
        ] {
            try fileManager.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
        }
    }

    private func recoverDeletion(at directory: URL) throws {
        guard fileManager.fileExists(atPath: directory.path) else { return }
        guard let manifest = try deletionManifest(at: directory) else { return }
        for move in manifest.moves.reversed() {
            let staged = directory.appending(path: move.stagedFileName)
            guard fileManager.fileExists(atPath: staged.path) else { continue }
            let source = rootURL.appending(path: move.sourceRelativePath)
            guard !fileManager.fileExists(atPath: source.path) else {
                throw SharedCaptureInboxError.deletionRollbackConflict(move.sourceRelativePath)
            }
            try fileManager.moveItem(at: staged, to: source)
        }
        try fileManager.removeItem(at: directory)
    }

    private func deletionManifest(at directory: URL) throws -> DeletionManifest? {
        let manifestURL = directory.appending(path: "manifest.json")
        guard fileManager.fileExists(atPath: manifestURL.path) else {
            if try fileManager.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: nil
            ).isEmpty {
                try fileManager.removeItem(at: directory)
                return nil
            }
            throw SharedCaptureInboxError.corruptDeletionTransaction(directory.lastPathComponent)
        }
        return try Self.decoder.decode(
            DeletionManifest.self,
            from: Data(contentsOf: manifestURL)
        )
    }

    private func recoverPendingTransactions() throws {
        let transactionURLs = try fileManager.contentsOfDirectory(
            at: temporaryDirectory,
            includingPropertiesForKeys: nil
        )
        .filter { $0.lastPathComponent.hasSuffix(".json.tmp") }

        for transactionURL in transactionURLs {
            let envelope: SharedCaptureEnvelope
            do {
                envelope = try Self.decoder.decode(
                    SharedCaptureEnvelope.self,
                    from: Data(contentsOf: transactionURL)
                )
            } catch {
                throw SharedCaptureInboxError.corruptEnvelope(transactionURL.lastPathComponent)
            }
            guard SharedCaptureEnvelope.supportedSchemaVersions.contains(envelope.schemaVersion) else {
                throw SharedCaptureInboxError.unsupportedSchema(envelope.schemaVersion)
            }
            let finalEnvelopeURL = envelopeURL(for: envelope.id, in: inboxDirectory)
            if fileManager.fileExists(atPath: finalEnvelopeURL.path) {
                try fileManager.removeItem(at: transactionURL)
                continue
            }
            if envelope.kind == .image {
                guard let payloadFileName = envelope.payloadFileName else {
                    throw SharedCaptureInboxError.incompleteTransaction(envelope.id)
                }
                let temporaryPayloadURL = temporaryDirectory.appending(path: "\(payloadFileName).tmp")
                let finalPayloadURL = payloadsDirectory.appending(path: payloadFileName)
                if !fileManager.fileExists(atPath: finalPayloadURL.path),
                   fileManager.fileExists(atPath: temporaryPayloadURL.path) {
                    try fileManager.moveItem(at: temporaryPayloadURL, to: finalPayloadURL)
                }
                guard fileManager.fileExists(atPath: finalPayloadURL.path) else {
                    throw SharedCaptureInboxError.incompleteTransaction(envelope.id)
                }
            }
            try fileManager.moveItem(at: transactionURL, to: finalEnvelopeURL)
        }
    }

    private var inboxDirectory: URL {
        rootURL.appending(path: "Inbox", directoryHint: .isDirectory)
    }

    private var importedDirectory: URL {
        rootURL.appending(path: "Imported", directoryHint: .isDirectory)
    }

    private var payloadsDirectory: URL {
        rootURL.appending(path: "Payloads", directoryHint: .isDirectory)
    }

    private var temporaryDirectory: URL {
        rootURL.appending(path: "Temporary", directoryHint: .isDirectory)
    }

    private var deletingDirectory: URL {
        rootURL.appending(path: "Deleting", directoryHint: .isDirectory)
    }

    private func envelopeURL(for id: UUID, in directory: URL) -> URL {
        directory.appending(path: "\(id.uuidString.lowercased()).json")
    }

    private func transactionEnvelopeURL(for id: UUID) -> URL {
        temporaryDirectory.appending(path: "\(id.uuidString.lowercased()).json.tmp")
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    private struct DeletionManifest: Codable {
        let id: UUID
        let moves: [DeletionMove]
    }

    private struct DeletionMove: Codable {
        let sourceRelativePath: String
        let stagedFileName: String
    }
}

struct SharedCaptureDeletionTransaction {
    let id: UUID
    fileprivate let directoryName: String
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

enum SharedCaptureInboxError: LocalizedError {
    case appGroupUnavailable
    case unavailableInRelease
    case duplicateEnvelope
    case corruptEnvelope(String)
    case unsupportedSchema(Int)
    case incompleteTransaction(UUID)
    case emptyPayload
    case unsupportedURL
    case captureNotFound(UUID)
    case corruptDeletionTransaction(String)
    case deletionRollbackConflict(String)
    case deletionAlreadyInProgress(UUID)

    var errorDescription: String? {
        switch self {
        case .appGroupUnavailable:
            return "The shared capture container is unavailable."
        case .unavailableInRelease:
            return "Standalone Share capture is unavailable in this Release build."
        case .duplicateEnvelope:
            return "This capture envelope already exists."
        case let .corruptEnvelope(fileName):
            return "Shared capture metadata \(fileName) is damaged. The item was not discarded; Reset can remove it safely."
        case let .unsupportedSchema(version):
            return "Shared capture metadata uses unsupported schema version \(version). The item remains queued."
        case let .incompleteTransaction(id):
            return "Shared capture \(id.uuidString) is incomplete. The item remains queued for recovery or Reset."
        case .emptyPayload:
            return "The shared item is empty."
        case .unsupportedURL:
            return "Only http and https links can be shared."
        case let .captureNotFound(id):
            return "Shared capture \(id.uuidString) was not found. Nothing was deleted."
        case let .corruptDeletionTransaction(name):
            return "Shared capture deletion \(name) cannot be verified. The staged files were retained."
        case let .deletionRollbackConflict(path):
            return "Shared capture deletion could not roll back because \(path) already exists. Both copies were retained for recovery."
        case let .deletionAlreadyInProgress(id):
            return "Shared capture \(id.uuidString) already has a protected deletion in progress. Relaunch capri to reconcile it before retrying."
        }
    }
}
