import XCTest
import Security
@testable import TalentSignal

@MainActor
final class LiveProtectedStorageTests: XCTestCase {
    func testAuthorizedEndpointProtectedJournalIsReadable() throws {
        guard let value = ProcessInfo.processInfo.environment["TS_IOS_LIVE_BACKEND_URL"],
              let endpoint = URL(string: value) else {
            throw XCTSkip("Requires an explicit live acceptance endpoint.")
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: KeychainLabWorkspaceJourneyStore.defaultService,
            kSecAttrAccount as String: RuntimeEndpoint.scope(endpoint),
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        let attachment = XCTAttachment(string:
            "keychain_status=\(status); byte_count=\((result as? Data)?.count ?? 0)")
        attachment.name = "Protected journal metadata only"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertTrue(status == errSecSuccess || status == errSecItemNotFound,
                      "Protected storage status \(status)")
        XCTAssertNoThrow(try KeychainLabWorkspaceJourneyStore(endpoint: endpoint).load(),
                         "The exact endpoint journal must be readable; existing data is preserved.")
    }
}
