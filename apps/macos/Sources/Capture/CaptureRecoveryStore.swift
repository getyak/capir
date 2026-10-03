import CryptoKit
import Foundation

enum CaptureRecoveryError: Error {
    case invalidImage, encryptionFailed, ownershipMismatch
}

protocol CaptureRecoveryPersisting {
    func save(_ intent: CaptureIntent) throws
    func load(origin: String, ownerScope: String, now: Date) throws -> [CaptureIntent]
    func remove(_ intent: CaptureIntent) throws
}

/** Device-only, account-partitioned screenshot recovery. Never a second CRM. */
final class CaptureRecoveryStore: CaptureRecoveryPersisting {
    private let directory: URL
    private let keyProvider: CapsuleKeyProviding
    private let fileManager: FileManager

    init(directory: URL? = nil, keyProvider: CapsuleKeyProviding = KeychainCapsuleKeyProvider(),
         fileManager: FileManager = .default) {
        self.directory = directory ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "TalentSignal/Captures", directoryHint: .isDirectory)
        self.keyProvider = keyProvider
        self.fileManager = fileManager
    }

    private func partition(origin: String, ownerScope: String) -> String {
        SHA256.hash(data: Data((origin + "\0" + ownerScope).utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    private func directoryURL(origin: String, ownerScope: String) -> URL {
        directory.appending(path: partition(origin: origin, ownerScope: ownerScope), directoryHint: .isDirectory)
    }

    func fileURL(for intent: CaptureIntent) -> URL? {
        directoryURL(origin: intent.origin, ownerScope: intent.ownerScope)
            .appending(path: "\(Int(intent.capturedAt.timeIntervalSince1970))-\(intent.id.uuidString.lowercased()).capture")
    }

    private func deadline(for file: URL) -> Date? {
        let stamp = file.deletingPathExtension().lastPathComponent.split(separator: "-", maxSplits: 1).first
        guard let stamp, let epoch = TimeInterval(stamp), epoch.isFinite else { return nil }
        return Date(timeIntervalSince1970: epoch + 86_400)
    }

    /// The runtime sleeps until the earliest device-owned raw image expires,
    /// including partitions that are no longer the active workspace.
    func nextExpiry(now: Date = Date()) throws -> Date? {
        guard fileManager.fileExists(atPath: directory.path) else { return nil }
        var next: Date?
        for folder in try fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey]) {
            guard try folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else { continue }
            for file in try fileManager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            where file.pathExtension == "capture" {
                let candidate = deadline(for: file) ?? now
                if next.map({ candidate < $0 }) ?? true { next = candidate }
            }
        }
        return next
    }

    /// Sweep every capture partition without opening another account's key or
    /// extending retention through a retry's file modification time.
    func purgeExpired(now: Date = Date()) throws {
        guard fileManager.fileExists(atPath: directory.path) else { return }
        for folder in try fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey]) {
            guard try folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else { continue }
            for file in try fileManager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            where file.pathExtension == "capture" {
                if deadline(for: file).map({ $0 <= now }) ?? true { try fileManager.removeItem(at: file) }
            }
        }
    }

    private func key(origin: String, ownerScope: String) throws -> SymmetricKey {
        let account = "desktop-capture-v1:" + partition(origin: origin, ownerScope: ownerScope)
        return SymmetricKey(data: try keyProvider.key(accountID: account))
    }

    func save(_ intent: CaptureIntent) throws {
        guard !intent.imagePNG.isEmpty,
              SHA256.hash(data: intent.imagePNG).map({ String(format: "%02x", $0) }).joined() == intent.contentHash
        else { throw CaptureRecoveryError.invalidImage }
        let folder = directoryURL(origin: intent.origin, ownerScope: intent.ownerScope)
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: folder.path)
        var folderValues = URLResourceValues()
        folderValues.isExcludedFromBackup = true
        var mutableFolder = folder
        try mutableFolder.setResourceValues(folderValues)

        let clear = try JSONEncoder().encode(intent)
        let sealed = try AES.GCM.seal(clear, using: key(origin: intent.origin, ownerScope: intent.ownerScope))
        guard let bytes = sealed.combined, let path = fileURL(for: intent) else { throw CaptureRecoveryError.encryptionFailed }
        try bytes.write(to: path, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        var fileValues = URLResourceValues()
        fileValues.isExcludedFromBackup = true
        var mutablePath = path
        try mutablePath.setResourceValues(fileValues)
    }

    func load(origin: String, ownerScope: String, now: Date = Date()) throws -> [CaptureIntent] {
        let folder = directoryURL(origin: origin, ownerScope: ownerScope)
        guard fileManager.fileExists(atPath: folder.path) else { return [] }
        let paths = try fileManager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "capture" }
        let decryptionKey = try key(origin: origin, ownerScope: ownerScope)
        var retained: [CaptureIntent] = []
        for path in paths {
            let sealed = try AES.GCM.SealedBox(combined: Data(contentsOf: path))
            let clear = try AES.GCM.open(sealed, using: decryptionKey)
            let intent = try JSONDecoder().decode(CaptureIntent.self, from: clear)
            guard intent.origin == origin, intent.ownerScope == ownerScope,
                  fileURL(for: intent)?.standardizedFileURL.path == path.standardizedFileURL.path
            else { throw CaptureRecoveryError.ownershipMismatch }
            if intent.isLocallyExpired(at: now) {
                try fileManager.removeItem(at: path)
                continue
            }
            guard SHA256.hash(data: intent.imagePNG).map({ String(format: "%02x", $0) }).joined() == intent.contentHash
            else { throw CaptureRecoveryError.invalidImage }
            retained.append(intent)
        }
        return retained.sorted { $0.capturedAt < $1.capturedAt }
    }

    func remove(_ intent: CaptureIntent) throws {
        guard let path = fileURL(for: intent) else { return }
        if fileManager.fileExists(atPath: path.path) { try fileManager.removeItem(at: path) }
    }
}
