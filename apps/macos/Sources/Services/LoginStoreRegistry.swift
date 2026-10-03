import Foundation
import CryptoKit
import Combine

struct LoginStoreSelection: Codable, Equatable {
    let origin: String
    var storeIdentifier: UUID
    var epoch: UInt64
    var unresolved: Bool
    var updatedAt: Date
}

protocol LoginStoreRegistryPersisting: AnyObject {
    func read() throws -> Data?
    func write(_ data: Data) throws
}

final class FileLoginStoreRegistryPersistence: LoginStoreRegistryPersisting {
    private let fileURL: URL
    init(fileURL: URL) { self.fileURL = fileURL }

    func read() throws -> Data? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        return try Data(contentsOf: fileURL)
    }

    func write(_ data: Data) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try data.write(to: fileURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
        let handle = try FileHandle(forWritingTo: fileURL)
        defer { try? handle.close() }
        try handle.synchronize()
    }

    func quarantine(_ data: Data) throws {
        let url = fileURL.appendingPathExtension("quarantine-\(UUID().uuidString)")
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}

enum LoginStoreRegistryError: Error {
    case persistenceUnavailable, corruptedRegistry, anotherInstance, staleSelection
}

/// One process owns this application's store registry for its entire lifetime.
/// A second instance cannot dispatch through cached routing state. A fresh
/// primary login commits a new UUID and unresolved marker before any request;
/// old cookies, local storage, drafts and stores are never copied or deleted.
@MainActor
final class LoginStoreRegistry {
    static let shared = LoginStoreRegistry()
    let changes = PassthroughSubject<LoginStoreSelection, Never>()
    private let persistence: LoginStoreRegistryPersisting
    private let lockURL: URL
    private var lockHandle: FileHandle?
    private var loaded = false
    private var cached: [String: LoginStoreSelection] = [:]
    private var corruptData: Data?
    private var loadFailure: Error?

    static var defaultLockURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "com.talentsignal.macos")
            .appendingPathComponent("LoginStoreRegistry/registry.lock")
    }

    init(persistence: LoginStoreRegistryPersisting? = nil, lockURL: URL? = nil) {
        let url = lockURL ?? Self.defaultLockURL
        self.lockURL = url
        self.persistence = persistence ?? FileLoginStoreRegistryPersistence(
            fileURL: url.deletingPathExtension().appendingPathExtension("json"))
    }

    deinit { try? lockHandle?.close() }

    private func own() throws {
        if lockHandle == nil {
            try FileManager.default.createDirectory(at: lockURL.deletingLastPathComponent(),
                                                   withIntermediateDirectories: true,
                                                   attributes: [.posixPermissions: 0o700])
            let descriptor = open(lockURL.path, O_CREAT | O_RDWR, 0o600)
            guard descriptor >= 0 else { throw LoginStoreRegistryError.persistenceUnavailable }
            guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
                close(descriptor)
                throw LoginStoreRegistryError.anotherInstance
            }
            lockHandle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        }
        guard !loaded else { return }
        loaded = true
        do {
            guard let data = try persistence.read() else { return }
            guard data.count <= 1_048_576,
                  let entries = try? JSONDecoder().decode([String: LoginStoreSelection].self, from: data),
                  entries.allSatisfy({ key, value in key == value.origin && URL(string: key)?.host != nil })
            else {
                corruptData = data
                throw LoginStoreRegistryError.corruptedRegistry
            }
            cached = entries
        } catch { loadFailure = error; throw error }
    }

    private func commit(_ entries: [String: LoginStoreSelection], publish selection: LoginStoreSelection?) throws {
        // Never publish a selection that the next process cannot recover.
        try persistence.write(JSONEncoder().encode(entries))
        cached = entries
        if let selection { changes.send(selection) }
    }

    func selection(for origin: String) throws -> LoginStoreSelection {
        try own()
        if let loadFailure { throw loadFailure }
        if let current = cached[origin] { return current }
        let adopted = LoginStoreSelection(origin: origin,
            storeIdentifier: Self.legacyDeterministicStore(for: origin), epoch: 0,
            unresolved: false, updatedAt: Date())
        var next = cached; next[origin] = adopted
        try commit(next, publish: nil)
        return adopted
    }

    func storeIdentifierIfHealthy(for origin: String) -> UUID? {
        try? selection(for: origin).storeIdentifier
    }
    func selectedStore(for origin: String) -> UUID? { storeIdentifierIfHealthy(for: origin) }
    func hasUnresolvedLogin(for origin: String) -> Bool {
        guard let selection = try? selection(for: origin) else { return true }
        return selection.unresolved
    }
    func isCurrent(_ selection: LoginStoreSelection) -> Bool {
        guard let current = try? self.selection(for: selection.origin) else { return false }
        return current.storeIdentifier == selection.storeIdentifier && current.epoch == selection.epoch
    }

    /// Deliberate login can recover a corrupt index only by successfully
    /// committing a fresh, unresolved store. It never falls back to legacy.
    func beginFreshPrimaryLogin(for origin: String) throws -> LoginStoreSelection {
        do { try own() }
        catch LoginStoreRegistryError.corruptedRegistry { /* fresh recovery below */ }
        if let loadFailure, corruptData == nil { throw loadFailure }
        if let data = corruptData, let file = persistence as? FileLoginStoreRegistryPersistence {
            try file.quarantine(data)
        }
        let prior = cached[origin]
        guard prior?.epoch != UInt64.max else { throw LoginStoreRegistryError.corruptedRegistry }
        let fresh = LoginStoreSelection(origin: origin, storeIdentifier: UUID(),
            epoch: (prior?.epoch ?? 0) + 1, unresolved: true, updatedAt: Date())
        var next = cached; next[origin] = fresh
        try commit(next, publish: nil)
        corruptData = nil; loadFailure = nil
        changes.send(fresh)
        return fresh
    }

    func resolveLogin(for origin: String, epoch: UInt64) throws {
        var current = try selection(for: origin)
        guard current.epoch == epoch else { throw LoginStoreRegistryError.staleSelection }
        current.unresolved = false; current.updatedAt = Date()
        var next = cached; next[origin] = current
        try commit(next, publish: nil)
    }

    static func legacyDeterministicStore(for origin: String) -> UUID {
        let bytes = Array(SHA256.hash(data: Data(origin.utf8)).prefix(16))
        return UUID(uuid: (bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],
                           bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]))
    }
}
