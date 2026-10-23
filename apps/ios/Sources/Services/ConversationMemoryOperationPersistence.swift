import Foundation
import CryptoKit
import Security

/// Only the current account/Session/proposal key can retrieve this bounded
/// local intent. It contains no bearer token or review credential.
protocol ConversationMemoryOperationPersisting {
    func load(key: String) throws -> Data?
    func save(_ data: Data, key: String) throws
    func remove(key: String) throws
    func removeExpired(now: Date) throws
    func removeAccount(prefix: String) throws
}

extension ConversationMemoryOperationPersisting {
    func removeExpired(now: Date) throws {}
    func removeAccount(prefix: String) throws {}
}

enum ConversationMemoryIntentRetention {
    static let interval: TimeInterval = 24 * 60 * 60
    struct Metadata { let key: String; let modifiedAt: Date }
    static func expiredKeys(_ entries: [Metadata], now: Date) -> [String] {
        entries.filter { now.timeIntervalSince($0.modifiedAt) >= interval }.map(\.key)
    }
    static func accountPrefix(binding: String) -> String {
        let hash = SHA256.hash(data: Data(binding.utf8)).map { String(format: "%02x", $0) }.joined()
        return "talent-signal.memory-operation.v2.\(hash)."
    }
}

struct KeychainConversationMemoryOperationStore: ConversationMemoryOperationPersisting {
    private let service = "com.talentsignal.conversation-memory-intent.v1"
    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: key,
         kSecAttrSynchronizable as String: false]
    }
    func load(key: String) throws -> Data? {
        try removeExpired(now: Date())
        var request = query(key)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let bytes = value as? Data else { throw ConversationMemoryReviewError.unavailable }
        return bytes
    }
    func save(_ data: Data, key: String) throws {
        try removeExpired(now: Date())
        let status = SecItemUpdate(query(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query(key)
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw ConversationMemoryReviewError.unavailable }
        } else if status != errSecSuccess { throw ConversationMemoryReviewError.unavailable }
        guard try load(key: key) == data else { throw ConversationMemoryReviewError.unavailable }
    }
    func remove(key: String) throws {
        let status = SecItemDelete(query(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw ConversationMemoryReviewError.unavailable }
    }
    private func metadata() throws -> [[String: Any]] {
        // Only this dedicated service's attributes are requested. Never read
        // other accounts' private request bodies to enforce retention.
        let request: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrSynchronizable as String: false,
            kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess, let entries = result as? [[String: Any]] else { throw ConversationMemoryReviewError.unavailable }
        return entries
    }
    func removeExpired(now: Date) throws {
        let entries = try metadata().compactMap { attributes -> ConversationMemoryIntentRetention.Metadata? in
            guard let key = attributes[kSecAttrAccount as String] as? String,
                  let modifiedAt = attributes[kSecAttrModificationDate as String] as? Date else { return nil }
            return .init(key: key, modifiedAt: modifiedAt)
        }
        for key in ConversationMemoryIntentRetention.expiredKeys(entries, now: now) { try remove(key: key) }
    }
    func removeAccount(prefix: String) throws {
        guard prefix.hasPrefix("talent-signal.memory-operation.v2."), prefix.hasSuffix(".") else {
            throw ConversationMemoryReviewError.invalidScope
        }
        for attributes in try metadata() {
            if let key = attributes[kSecAttrAccount as String] as? String, key.hasPrefix(prefix) { try remove(key: key) }
        }
    }
}

struct ConversationMemoryPendingIntent: Codable {
    let operationKey: String
    let createdAt: Date
    let contact: ConversationMemoryCommit?
    let item: ConversationMemoryItemDecision?
    let rebase: ConversationMemoryRebase?

    init(operationKey: String, contact: ConversationMemoryCommit? = nil,
         item: ConversationMemoryItemDecision? = nil, rebase: ConversationMemoryRebase? = nil) {
        self.operationKey = operationKey; createdAt = Date()
        self.contact = contact; self.item = item; self.rebase = rebase
    }
    var isWithinRetention: Bool { Date().timeIntervalSince(createdAt) < ConversationMemoryIntentRetention.interval }
}
