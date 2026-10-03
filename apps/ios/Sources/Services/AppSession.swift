import CryptoKit
import Foundation
import Security

struct TalentSignalSession: Codable, Equatable {
    let baseURL: URL
    let accessToken: String
    let expiresAt: Date
    let account: Account
    let user: User

    struct Account: Codable, Equatable {
        let id: String
        let slug: String
        let name: String
    }

    struct User: Codable, Equatable {
        let id: String
        let email: String
        let displayName: String
        let kind: String
    }
}

struct AppleLoginChallenge: Decodable, Equatable {
    let contractVersion: String
    let id: String
    let nonce: String
    let expiresAt: Date

    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version"
        case id = "challenge_id"
        case nonce
        case expiresAt = "expires_at"
    }
}

protocol TalentSignalSessionPersisting {
    func load() throws -> TalentSignalSession?
    func save(_ session: TalentSignalSession) throws
    func delete() throws
    func removeMatching(_ expected: TalentSignalSession) throws -> Bool
    func removeEndingCredential(_ ending: AppSessionEnding) throws -> Bool
}

extension TalentSignalSessionPersisting {
    func removeMatching(_ expected: TalentSignalSession) throws -> Bool {
        try removeEndingCredential(AppSessionEnding(session: expected))
    }
    func removeEndingCredential(_ ending: AppSessionEnding) throws -> Bool {
        if let saved = try load(), AppSessionEnding.fingerprint(saved) == ending.credentialFingerprint { try delete() }
        return try load().map { AppSessionEnding.fingerprint($0) != ending.credentialFingerprint } ?? true
    }
}

final class KeychainTalentSignalSessionStore: TalentSignalSessionPersisting {
    private let service: String
    private let baseURL: URL?
    private let prefix: String
    private var pointerKey: String { prefix + ".current" }

    init(baseURL: URL? = nil, service: String = "com.talentsignal.app.session") {
        self.service = service
        self.baseURL = baseURL
        prefix = baseURL.map { "environment." + RuntimeEndpoint.scope($0) } ?? "legacy"
    }

    func load() throws -> TalentSignalSession? {
        guard let baseURL else { return try readLegacy() }
        guard let pointer = try data(for: pointerKey) else {
            // Migrate only after verifying the legacy session belongs to this endpoint.
            guard let legacy = try readLegacy(), RuntimeEndpoint.same(legacy.baseURL, baseURL) else { return nil }
            if service == "com.talentsignal.app.session" { RuntimeLegacyBindings.bind(legacy) }
            try save(legacy)
            try remove("current")
            return legacy
        }
        guard let key = try? JSONDecoder().decode(String.self, from: pointer),
              key.hasPrefix(prefix + ".identity."), let data = try data(for: key),
              let session = try? JSONDecoder.appSession.decode(TalentSignalSession.self, from: data),
              RuntimeEndpoint.same(session.baseURL, baseURL), key == identityKey(session) else {
            throw AppSessionError.invalidStoredSession
        }
        return session
    }

    func save(_ session: TalentSignalSession) throws {
        guard let baseURL else {
            try upsert(try JSONEncoder.appSession.encode(session), key: "current")
            return
        }
        guard RuntimeEndpoint.same(session.baseURL, baseURL) else { throw AppSessionError.scopeMismatch }
        let previous = try data(for: pointerKey).flatMap { try? JSONDecoder().decode(String.self, from: $0) }
        let key = identityKey(session)
        // Write a scoped credential before atomically changing the environment's active pointer.
        try upsert(try JSONEncoder.appSession.encode(session), key: key)
        try upsert(try JSONEncoder().encode(key), key: pointerKey)
        if let previous, previous != key, previous.hasPrefix(prefix + ".identity.") { try remove(previous) }
    }

    func delete() throws {
        guard baseURL != nil else { try remove("current"); return }
        if let pointer = try data(for: pointerKey), let key = try? JSONDecoder().decode(String.self, from: pointer),
           key.hasPrefix(prefix + ".identity.") { try remove(key) }
        try remove(pointerKey)
        if let legacy = try readLegacy(), let baseURL, RuntimeEndpoint.same(legacy.baseURL, baseURL) { try remove("current") }
    }

    func removeMatching(_ expected: TalentSignalSession) throws -> Bool {
        try removeEndingCredential(AppSessionEnding(session: expected))
    }

    func removeEndingCredential(_ ending: AppSessionEnding) throws -> Bool {
        guard let baseURL else {
            if let current = try readLegacy(), AppSessionEnding.fingerprint(current) == ending.credentialFingerprint { try remove("current") }
            return try readLegacy().map { AppSessionEnding.fingerprint($0) != ending.credentialFingerprint } ?? true
        }
        guard ending.endpointScope == RuntimeEndpoint.scope(baseURL),
              ending.identityFingerprint.count == 64 else { throw AppSessionError.scopeMismatch }
        let key = prefix + ".identity." + ending.identityFingerprint, fingerprint = ending.credentialFingerprint
        func matches(_ key: String) throws -> Bool {
            guard let data = try data(for: key) else { return false }
            let value = try JSONDecoder.appSession.decode(TalentSignalSession.self, from: data)
            return AppSessionEnding.fingerprint(value) == fingerprint
        }
        if try matches(key) {
            try remove(key)
            if let pointer = try data(for: pointerKey), (try? JSONDecoder().decode(String.self, from: pointer)) == key { try remove(pointerKey) }
        } else if try data(for: key) == nil,
                  let pointer = try data(for: pointerKey), (try? JSONDecoder().decode(String.self, from: pointer)) == key {
            try remove(pointerKey)
        }
        if try matches("current") { try remove("current") }
        return try !matches(key) && !matches("current")
    }

    private func identityKey(_ session: TalentSignalSession) -> String {
        prefix + ".identity." + SHA256.hex(session.account.id + "|" + session.user.id)
    }
    private func readLegacy() throws -> TalentSignalSession? {
        guard let data = try data(for: "current") else { return nil }
        guard let value = try? JSONDecoder.appSession.decode(TalentSignalSession.self, from: data) else {
            throw AppSessionError.invalidStoredSession
        }
        return value
    }
    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: key]
    }
    private func data(for key: String) throws -> Data? {
        var request = query(key)
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        request[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw AppSessionError.keychain(status) }
        return data
    }
    private func upsert(_ data: Data, key: String) throws {
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query(key) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let added = SecItemAdd(query(key).merging(attributes) { _, new in new } as CFDictionary, nil)
            guard added == errSecSuccess else { throw AppSessionError.keychain(added) }
        } else if status != errSecSuccess { throw AppSessionError.keychain(status) }
    }
    private func remove(_ key: String) throws {
        let status = SecItemDelete(query(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw AppSessionError.keychain(status) }
    }
}

protocol AppAuthenticationServing {
    func googleChallenge() async throws -> AppleLoginChallenge
    func signInGoogle(identityToken: String, challengeID: String) async throws -> TalentSignalSession
    func signInEmail(email: String, password: String, registering: Bool) async throws -> TalentSignalSession
    /// Verified signup: starts delivery only. The response is generic and the
    /// code never leaves the server; the owner confirms from their email.
    func startRegistration(email: String, password: String) async throws
    /// The intentional confirmation of the emailed verification code.
    func confirmRegistration(secret: String) async throws -> TalentSignalSession
    func challenge() async throws -> AppleLoginChallenge
    func signIn(
        identityToken: String,
        challengeID: String,
        givenName: String?,
        familyName: String?
    ) async throws -> TalentSignalSession
    func validate(_ stored: TalentSignalSession) async throws -> TalentSignalSession
    func logout(_ stored: TalentSignalSession) async throws
}

extension AppAuthenticationServing {
    func googleChallenge() async throws -> AppleLoginChallenge { throw GoogleSignInError.unavailable }
    func signInGoogle(identityToken: String, challengeID: String) async throws -> TalentSignalSession { throw GoogleSignInError.unavailable }
    func signInEmail(email: String, password: String, registering: Bool) async throws -> TalentSignalSession { throw GoogleSignInError.unavailable }
    func startRegistration(email: String, password: String) async throws { throw GoogleSignInError.unavailable }
    func confirmRegistration(secret: String) async throws -> TalentSignalSession { throw GoogleSignInError.unavailable }
}

actor AppAuthenticationClient: AppAuthenticationServing {
    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL, session: URLSession = TalentSignalNetworking.session) {
        self.baseURL = baseURL
        self.session = session
    }

    func googleChallenge() async throws -> AppleLoginChallenge {
        try await request(path: "v1/auth/google/challenges", method: "POST", token: nil,
                          body: ["client_label": "ios"])
    }

    func signInGoogle(identityToken: String, challengeID: String) async throws -> TalentSignalSession {
        let envelope: AppSessionEnvelope = try await request(path: "v1/auth/google", method: "POST", token: nil,
            body: ["identity_token": identityToken, "challenge_id": challengeID, "client_label": "ios"])
        return try session(from: envelope)
    }

    func signInEmail(email: String, password: String, registering: Bool) async throws -> TalentSignalSession {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let body = registering
            ? ["username": "u" + UUID().uuidString.replacingOccurrences(of: "-", with: ""),
               "email": normalized, "display_name": String(normalized.split(separator: "@").first ?? "capri"),
               "password": password, "client_label": "ios"]
            : ["identifier": normalized, "password": password, "client_label": "ios"]
        let envelope: AppSessionEnvelope = try await request(path: registering ? "v1/auth/password/register" : "v1/auth/password/login",
            method: "POST", token: nil, body: body)
        return try session(from: envelope)
    }

    struct AppRegistrationStartReceipt: Decodable {
        let contractVersion: String
        let status: String
    }

    func startRegistration(email: String, password: String) async throws {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let receipt: AppRegistrationStartReceipt = try await request(
            path: "v1/auth/password/register",
            method: "POST",
            token: nil,
            body: [
                "username": "u" + UUID().uuidString.replacingOccurrences(of: "-", with: ""),
                "email": normalized,
                "display_name": String(normalized.split(separator: "@").first ?? "capri"),
                "password": password,
                "client_label": "ios",
            ]
        )
        guard receipt.status == "verification_sent" else { throw AppSessionError.invalidResponse }
    }

    func confirmRegistration(secret: String) async throws -> TalentSignalSession {
        let envelope: AppSessionEnvelope = try await request(
            path: "v1/auth/password/register/confirm",
            method: "POST",
            token: nil,
            body: [
                "verification_secret": secret.trimmingCharacters(in: .whitespacesAndNewlines),
                "client_label": "ios",
            ]
        )
        return try session(from: envelope)
    }

    private func session(from response: AppSessionEnvelope) throws -> TalentSignalSession {
        guard response.contractVersion == TalentSignalAPIContract.version else { throw AppSessionError.contractMismatch }
        return TalentSignalSession(baseURL: baseURL, accessToken: response.accessToken, expiresAt: response.expiresAt,
            account: .init(id: response.account.id, slug: response.account.slug, name: response.account.name),
            user: .init(id: response.user.id, email: response.user.email, displayName: response.user.displayName, kind: response.user.kind))
    }

    func challenge() async throws -> AppleLoginChallenge {
        try await request(
            path: "v1/auth/apple/challenges",
            method: "POST",
            token: nil,
            body: AppleChallengeBody(clientLabel: "ios")
        )
    }

    func signIn(
        identityToken: String,
        challengeID: String,
        givenName: String?,
        familyName: String?
    ) async throws -> TalentSignalSession {
        let response: AppSessionEnvelope = try await request(
            path: "v1/auth/apple",
            method: "POST",
            token: nil,
            body: AppleLoginBody(
                challengeID: challengeID,
                identityToken: identityToken,
                clientLabel: "ios",
                givenName: givenName,
                familyName: familyName
            )
        )
        guard response.contractVersion == TalentSignalAPIContract.version else {
            throw AppSessionError.contractMismatch
        }
        return TalentSignalSession(
            baseURL: baseURL,
            accessToken: response.accessToken,
            expiresAt: response.expiresAt,
            account: .init(
                id: response.account.id,
                slug: response.account.slug,
                name: response.account.name
            ),
            user: .init(
                id: response.user.id,
                email: response.user.email,
                displayName: response.user.displayName,
                kind: response.user.kind
            )
        )
    }

    func validate(_ stored: TalentSignalSession) async throws -> TalentSignalSession {
        guard RuntimeEndpoint.same(stored.baseURL, baseURL) else { throw AppSessionError.scopeMismatch }
        let response: CurrentSessionEnvelope = try await request(
            path: "v1/auth/session",
            method: "GET",
            token: stored.accessToken,
            body: Optional<EmptySessionBody>.none
        )
        guard response.contractVersion == TalentSignalAPIContract.version,
              response.account.id == stored.account.id,
              response.user.id == stored.user.id else {
            throw AppSessionError.scopeMismatch
        }
        return TalentSignalSession(
            baseURL: baseURL,
            accessToken: stored.accessToken,
            expiresAt: response.expiresAt,
            account: .init(
                id: response.account.id,
                slug: response.account.slug,
                name: response.account.name
            ),
            user: .init(
                id: response.user.id,
                email: response.user.email,
                displayName: response.user.displayName,
                kind: response.user.kind
            )
        )
    }

    func logout(_ stored: TalentSignalSession) async throws {
        guard RuntimeEndpoint.same(stored.baseURL, baseURL) else { throw AppSessionError.scopeMismatch }
        let response: LogoutEnvelope = try await request(
            path: "v1/auth/logout",
            method: "POST",
            token: stored.accessToken,
            body: Optional<EmptySessionBody>.none
        )
        guard response.contractVersion == TalentSignalAPIContract.version else {
            throw AppSessionError.contractMismatch
        }
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        token: String?,
        body: Body?
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder.appSession.encode(body)
        }
        let (data, response) = try await TalentSignalNetworking.data(for: request, using: session)
        guard let http = response as? HTTPURLResponse else {
            throw AppSessionError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            let envelope = try? JSONDecoder.appSession.decode(
                AppSessionErrorEnvelope.self,
                from: data
            )
            throw AppSessionError.backend(
                status: http.statusCode,
                code: envelope?.error.code ?? "HTTP_\(http.statusCode)",
                message: envelope?.error.message ?? "Authentication was rejected."
            )
        }
        do {
            return try JSONDecoder.appSession.decode(Response.self, from: data)
        } catch {
            throw AppSessionError.invalidResponse
        }
    }
}

enum AppSessionError: LocalizedError {
    case backend(status: Int, code: String, message: String)
    case contractMismatch
    case invalidIdentityToken
    case invalidResponse
    case invalidStoredSession
    case keychain(OSStatus)
    case scopeMismatch

    var errorDescription: String? {
        switch self {
        case let .backend(_, code, message):
            return "\(message) (\(code))"
        case .contractMismatch:
            return "The service contract changed. Update capri and try again."
        case .invalidIdentityToken:
            return "Apple did not return a readable identity token."
        case .invalidResponse:
            return "The authentication response could not be verified."
        case .invalidStoredSession:
            return "The saved session could not be read and was removed."
        case let .keychain(status):
            return "The secure session store is unavailable (\(status))."
        case .scopeMismatch:
            return "The session readback did not match the saved account."
        }
    }

    var invalidatesSession: Bool {
        guard case let .backend(status, code, _) = self else { return false }
        return status == 401 || ["SESSION_INVALID", "AUTHENTICATION_REQUIRED"].contains(code)
    }
}

extension SHA256 {
    static func hex(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}

private extension JSONDecoder {
    static var appSession: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private extension JSONEncoder {
    static var appSession: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private struct AppleChallengeBody: Encodable {
    let clientLabel: String
    enum CodingKeys: String, CodingKey { case clientLabel = "client_label" }
}

private struct AppleLoginBody: Encodable {
    let challengeID: String
    let identityToken: String
    let clientLabel: String
    let givenName: String?
    let familyName: String?

    enum CodingKeys: String, CodingKey {
        case challengeID = "challenge_id"
        case identityToken = "identity_token"
        case clientLabel = "client_label"
        case givenName = "given_name"
        case familyName = "family_name"
    }
}

private struct EmptySessionBody: Encodable {}

private struct AppSessionEnvelope: Decodable {
    let contractVersion: String
    let accessToken: String
    let expiresAt: Date
    let account: Account
    let user: User

    struct Account: Decodable { let id: String; let slug: String; let name: String }
    struct User: Decodable {
        let id: String
        let email: String
        let displayName: String
        let kind: String
        enum CodingKeys: String, CodingKey {
            case id, email, kind
            case displayName = "display_name"
        }
    }

    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version"
        case accessToken = "access_token"
        case expiresAt = "expires_at"
        case account, user
    }
}

private struct CurrentSessionEnvelope: Decodable {
    let contractVersion: String
    let expiresAt: Date
    let account: AppSessionEnvelope.Account
    let user: AppSessionEnvelope.User

    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version"
        case expiresAt = "expires_at"
        case account, user
    }
}

private struct LogoutEnvelope: Decodable {
    let contractVersion: String
    enum CodingKeys: String, CodingKey { case contractVersion = "contract_version" }
}

private struct AppSessionErrorEnvelope: Decodable {
    struct ErrorBody: Decodable { let code: String; let message: String }
    let error: ErrorBody
}
