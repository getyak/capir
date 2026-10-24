import Foundation
import Security
import CryptoKit
import Darwin

protocol AppSessionEndingPersisting {
    func load() throws -> [AppSessionEnding]
    func save(_ records: [AppSessionEnding]) throws
}

final class KeychainAppSessionEndingStore: AppSessionEndingPersisting {
    private let endpoint: URL?
    private let service: String
    private let denyMirror: CaptureLogoutDenyMirror
    private let beforeProtectedWrite: (() throws -> Void)?
    private var account: String { endpoint.map { RuntimeEndpoint.scope($0) } ?? "unconfigured" }
    init(endpoint: URL?, service: String = "com.talentsignal.app.session-ending",
         denyMirror: CaptureLogoutDenyMirror = .init(), beforeProtectedWrite: (() throws -> Void)? = nil) {
        self.endpoint = endpoint; self.service = service; self.denyMirror = denyMirror
        self.beforeProtectedWrite = beforeProtectedWrite
    }
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }
    private func bytes() throws -> Data? {
        var value = query; value[kSecMatchLimit as String] = kSecMatchLimitOne; value[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(value as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw AppSessionError.keychain(status) }
        guard data.count <= 262_144 else { throw AppSessionEndingError.unreadable }
        return data
    }
    func load() throws -> [AppSessionEnding] {
        guard let data = try bytes() else { return [] }
        let value: AppSessionEndingArchive
        do { value = try JSONDecoder().decode(AppSessionEndingArchive.self, from: data) }
        catch { throw AppSessionEndingError.unreadable }
        guard value.version == 1, value.records.count <= 64,
              Set(value.records.map(\.id)).count == value.records.count,
              value.records.allSatisfy({ record in
                  record.endpointScope == account && Self.isDigest(record.credentialFingerprint) && Self.isDigest(record.identityFingerprint)
                    && record.startedAt.timeIntervalSince1970.isFinite && record.expiresAt.timeIntervalSince1970.isFinite
                    && (record.credential.map { session in
                        endpoint.map { RuntimeEndpoint.same(session.baseURL, $0) } == true
                          && AppSessionEnding.fingerprint(session) == record.credentialFingerprint
                          && SHA256.hex(session.account.id + "|" + session.user.id) == record.identityFingerprint
                          && session.expiresAt == record.expiresAt
                    } ?? true)
              }) else { throw AppSessionEndingError.unreadable }
        var records = value.records
        var changed = false
        for index in records.indices where records[index].expiresAt <= Date() && (records[index].credential != nil || !records[index].remoteSettled) {
            records[index].credential = nil
            if !records[index].remoteSettled { records[index].remote = .expired }
            changed = true
        }
        if changed { try save(records) }
        return records
    }
    private static func isDigest(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    func save(_ records: [AppSessionEnding]) throws {
        guard records.count <= 64, records.allSatisfy({ $0.endpointScope == account }) else { throw AppSessionError.scopeMismatch }
        // Deny frozen captures before attempting the protected journal write.
        // A failed journal write may leave a valid credential behind, so this
        // monotonic mirror is never rolled back or cleared by receipt pruning.
        if let endpoint {
            try denyMirror.deny(endpoint: endpoint, fingerprints: records.map(\.credentialFingerprint))
        }
        let data = try JSONEncoder().encode(AppSessionEndingArchive(version: 1, records: records))
        guard data.count <= 262_144 else { throw AppSessionEndingError.unreadable }
        try beforeProtectedWrite?()
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let added = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
            guard added == errSecSuccess else { throw AppSessionError.keychain(added) }
        } else if status != errSecSuccess { throw AppSessionError.keychain(status) }
        guard try bytes() == data else { throw AppSessionEndingError.unreadable }
    }
}

/// Contains only one-way credential fingerprints. It grants no authentication;
/// it only denies continuation of a previously authorized frozen OS request.
/// Missing, unsupported, corrupt or uninitialized state always fails closed.
struct CaptureLogoutDenyMirror {
    private struct State: Codable { var version = 1; var endpointScope: String; var initialized: Bool; var denied: [String] }
    private let directory: URL
    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "TalentSignal/CaptureLogoutDeny", directoryHint: .isDirectory)
    }
    private func file(_ endpoint: URL) -> URL { directory.appending(path: RuntimeEndpoint.scope(endpoint) + ".json") }
    func prepare(endpoint: URL, fingerprints: [String]) throws {
        try mutate(endpoint: endpoint, fingerprints: fingerprints, initialize: true)
    }
    func deny(endpoint: URL, fingerprints: [String]) throws {
        guard !fingerprints.isEmpty else { return }
        try mutate(endpoint: endpoint, fingerprints: fingerprints, initialize: false)
    }
    func assertAllowed(endpoint: URL, fingerprint: String) throws {
        try locked(endpoint, writing: false) {
            let state = try read(endpoint)
            guard state.initialized, !state.denied.contains(fingerprint) else { throw AppSessionEndingError.unreadable }
        }
    }
    private func mutate(endpoint: URL, fingerprints: [String], initialize: Bool) throws {
        guard fingerprints.allSatisfy(Self.valid) else { throw AppSessionEndingError.unreadable }
        try locked(endpoint) {
            var state: State
            if FileManager.default.fileExists(atPath: file(endpoint).path) { state = try read(endpoint) }
            else { state = State(endpointScope: RuntimeEndpoint.scope(endpoint), initialized: false, denied: []) }
            // Locked and merged across processes; stale prepare cannot erase a
            // concurrently committed logout deny. No private account data.
            state.denied = Array(Set(state.denied + fingerprints)).sorted()
            guard state.denied.count <= 4096 else { throw AppSessionEndingError.unreadable }
            state.initialized = state.initialized || initialize
            try JSONEncoder().encode(state).write(to: file(endpoint), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file(endpoint).path)
            // Atomic replacement alone is insufficient before Keychain commit.
            // Persist both the file contents and directory rename first.
            let descriptor = open(file(endpoint).path, O_RDONLY)
            guard descriptor >= 0 else { throw AppSessionEndingError.unreadable }
            let fileResult = fsync(descriptor); close(descriptor)
            guard fileResult == 0 else { throw AppSessionEndingError.unreadable }
            let directoryDescriptor = open(directory.path, O_RDONLY)
            guard directoryDescriptor >= 0 else { throw AppSessionEndingError.unreadable }
            let directoryResult = fsync(directoryDescriptor); close(directoryDescriptor)
            guard directoryResult == 0 else { throw AppSessionEndingError.unreadable }
        }
    }
    private func read(_ endpoint: URL) throws -> State {
        let data = try Data(contentsOf: file(endpoint))
        guard data.count <= 300_000, let state = try? JSONDecoder().decode(State.self, from: data),
              state.version == 1, state.endpointScope == RuntimeEndpoint.scope(endpoint), state.denied.count <= 4096, state.denied.allSatisfy(Self.valid),
              Set(state.denied).count == state.denied.count else { throw AppSessionEndingError.unreadable }
        return state
    }
    private static func valid(_ fingerprint: String) -> Bool {
        fingerprint.utf8.count == 64 && fingerprint.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    private func locked<T>(_ endpoint: URL, writing: Bool = true, operation: () throws -> T) throws -> T {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication, .posixPermissions: 0o700])
        var target = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try target.setResourceValues(values)
        let descriptor = open(file(endpoint).appendingPathExtension("lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw AppSessionEndingError.unreadable }
        defer { close(descriptor) }
        guard flock(descriptor, (writing ? LOCK_EX : LOCK_SH) | LOCK_NB) == 0 else { throw AppSessionEndingError.unreadable }
        defer { flock(descriptor, LOCK_UN) }
        return try operation()
    }
}

/// Minimal deletion authority for frozen capture continuation. The original
/// private Session file retains completeFileProtectionUnlessOpen.
struct CaptureSessionDenyStore {
    private struct State: Codable {
        var version = 1
        let scopeHash: String
        var epoch = Int.random(in: 1...(Int.max / 2))
        var isDeleting = false
        var denied: [String] = []
    }
    private let directory: URL
    init(rootURL: URL? = nil) {
        directory = (rootURL ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0])
            .appending(path: "TalentSignal/CaptureSessionDeny", directoryHint: .isDirectory)
    }
    func initializeFresh(scope: String) throws -> Int {
        try access(scope: scope, initialize: true, writing: true, requireMissing: true) { $0.epoch }
    }
    func epoch(scope: String) throws -> Int {
        try access(scope: scope, initialize: false, writing: false) { state in
            guard !state.isDeleting else { throw AppSessionEndingError.unreadable }
            return state.epoch
        }
    }
    func assertAllowed(scope: String, sessionID: UUID, epoch: Int) throws {
        try access(scope: scope, initialize: false, writing: false) { state in
            guard !state.isDeleting, state.epoch == epoch,
                  !state.denied.contains(SHA256.hex(sessionID.uuidString.lowercased())) else { throw AppSessionEndingError.unreadable }
        }
    }
    func deny(scope: String, sessionIDs: [UUID]) throws {
        guard !sessionIDs.isEmpty else { return }
        try access(scope: scope, initialize: true, writing: true) { state in
            state.denied = Array(Set(state.denied + sessionIDs.map { SHA256.hex($0.uuidString.lowercased()) })).sorted()
            guard state.denied.count <= 4096 else { throw AppSessionEndingError.unreadable }
        }
    }
    func beginDeletion(scope: String) throws -> Int {
        try access(scope: scope, initialize: true, writing: true) { state in
            guard state.epoch < Int.max else { throw AppSessionEndingError.unreadable }
            state.epoch += 1; state.isDeleting = true
            return state.epoch
        }
    }
    func pendingEpoch(scope: String) throws -> Int? {
        let hash = SHA256.hex(scope)
        guard FileManager.default.fileExists(atPath: directory.appending(path: hash + ".json").path) else { return nil }
        return try access(scope: scope, initialize: false, writing: false) { $0.isDeleting ? $0.epoch : nil }
    }
    func completeDeletion(scope: String, epoch: Int, removePrivateData: () throws -> Void) throws {
        try access(scope: scope, initialize: false, writing: true) { state in
            guard state.isDeleting, state.epoch == epoch else { throw AppSessionEndingError.unreadable }
            try removePrivateData()
            state.isDeleting = false
        }
    }
    private func access<T>(scope: String, initialize: Bool, writing: Bool, requireMissing: Bool = false, operation: (inout State) throws -> T) throws -> T {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication, .posixPermissions: 0o700])
        var target = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try target.setResourceValues(values)
        let hash = SHA256.hex(scope), file = directory.appending(path: SHA256.hex(scope) + ".json")
        let descriptor = open(file.appendingPathExtension("lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw AppSessionEndingError.unreadable }
        defer { close(descriptor) }
        guard flock(descriptor, (writing ? LOCK_EX : LOCK_SH) | LOCK_NB) == 0 else { throw AppSessionEndingError.unreadable }
        defer { flock(descriptor, LOCK_UN) }
        var state: State
        if FileManager.default.fileExists(atPath: file.path) {
            guard !requireMissing else { throw AppSessionEndingError.unreadable }
            let bytes = try Data(contentsOf: file)
            guard bytes.count <= 300_000, let decoded = try? JSONDecoder().decode(State.self, from: bytes),
                  decoded.version == 1, decoded.scopeHash == hash, decoded.epoch > 0,
                  decoded.denied.count <= 4096, Set(decoded.denied).count == decoded.denied.count,
                  decoded.denied.allSatisfy({ $0.utf8.count == 64 && $0.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } })
            else { throw AppSessionEndingError.unreadable }
            state = decoded
        } else {
            guard initialize else { throw AppSessionEndingError.unreadable }
            state = State(scopeHash: hash)
        }
        let result = try operation(&state)
        if writing {
            try JSONEncoder().encode(state).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            let dataDescriptor = open(file.path, O_RDONLY)
            guard dataDescriptor >= 0 else { throw AppSessionEndingError.unreadable }
            let dataResult = fsync(dataDescriptor); close(dataDescriptor)
            guard dataResult == 0 else { throw AppSessionEndingError.unreadable }
            let directoryDescriptor = open(directory.path, O_RDONLY)
            guard directoryDescriptor >= 0 else { throw AppSessionEndingError.unreadable }
            let directoryResult = fsync(directoryDescriptor); close(directoryDescriptor)
            guard directoryResult == 0 else { throw AppSessionEndingError.unreadable }
        }
        return result
    }
}
