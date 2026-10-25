import Foundation

/// Typed client for the credential-change and verified-signup endpoints
/// (ADR 0018). The attempt secret is returned exactly once and is held only in
/// memory for the current attempt; nothing here writes tokens to disk or logs.
enum AccountLoginMethodsError: Error, Equatable {
    case invalidInput
    case invalidResponse
    case attemptInvalid
    case stepUpFailed
    case lastLoginMethod
    case conflict(String)
    case emailOwnershipUnresolved
    case deliveryUnavailable
    case unavailable
}

struct AccountCredentialAttemptResponse: Decodable {
    struct ProviderChallenge: Decodable {
        let challenge_id: String
        let nonce: String
        let expires_at: String
    }
    let contract_version: String
    let attempt_id: String
    let attempt_secret: String
    let intent: String
    let provider: String?
    let expires_at: String
    let provider_challenge: ProviderChallenge?
}

struct AccountProviderChallengeResponse: Decodable {
    let contract_version: String
    let challenge_id: String
    let nonce: String
    let expires_at: String
}

struct AccountCredentialCompleteResponse: Decodable {
    let contract_version: String
    let status: String
    let settings: AccountSettingsProjection
}

struct AccountDeviceSession: Decodable, Equatable, Sendable {
    let id: String
    let client_label: String
    let created_at: String
    let expires_at: String
    let is_current: Bool
    var persistent: Bool? = nil
}

struct AccountSettingsProjection: Decodable {
    struct User: Decodable {
        let id: String
        let revision: Int
        let email_verified_at: String?
    }
    struct Workspace: Decodable {
        let id: String
        let revision: Int
    }
    struct Method: Decodable {
        let provider: String
        let state: String
        let hint: String?
        let can_unlink: Bool
    }
    let user: User
    let workspace: Workspace
    let sign_in_methods: [Method]
    let email_ownership_state: String
    let sessions: [AccountDeviceSession]

    var actor: AccountOperationActor {
        AccountOperationActor(
            accountID: workspace.id,
            userID: user.id,
            accountRevision: workspace.revision,
            userRevision: user.revision
        )
    }

    var snapshot: AccountCredentialsSnapshot {
        AccountCredentialsSnapshot(
            account_id: workspace.id,
            user_id: user.id,
            account_revision: workspace.revision,
            user_revision: user.revision,
            methods: sign_in_methods.compactMap { method in
                guard let provider = AccountLoginProvider(rawValue: method.provider),
                      let state = AccountLoginMethodState(rawValue: method.state)
                else { return nil }
                return AccountSignInMethod(
                    provider: provider,
                    state: state,
                    hint: method.hint,
                    can_unlink: method.can_unlink
                )
            },
            email_ownership_state: email_ownership_state
        )
    }
}

struct AccountPasswordStartRequest: Encodable {
    let username: String
    let email: String
    let display_name: String
    let password: String
    let client_label: String
}

struct AccountPasswordConfirmRequest: Encodable {
    let verification_secret: String
    let client_label: String
}

protocol AccountLoginMethodsServing: Sendable {
    func settings() async throws -> (AccountCredentialsSnapshot, [AccountDeviceSession])
    func revokeDeviceSession(id: String, expectedAccountRevision: Int) async throws -> (AccountCredentialsSnapshot, [AccountDeviceSession])
    /// Provider challenge for a linked-identity reauthentication or a NEW
    /// provider binding; the nonce is what native authorization must use.
    func createChallenge(provider: AccountLoginProvider) async throws -> ProviderChallengeRef
    func startChange(
        intent: AccountCredentialIntent,
        provider: AccountLoginProvider?,
        stepUp: AccountStepUpProof,
        clientLabel: String,
        expectedAccountRevision: Int,
        expectedUserRevision: Int
    ) async throws -> AccountCredentialAttempt
    func completeChange(
        attemptID: String,
        attemptSecret: String,
        password: String?,
        identityToken: String?
    ) async throws -> (status: String, snapshot: AccountCredentialsSnapshot)
    func startRegistration(
        username: String,
        email: String,
        displayName: String,
        password: String
    ) async throws
    func confirmRegistration(secret: String) async throws
}

struct AccountLoginMethodsClient: AccountLoginMethodsServing {
    var baseURL: URL
    var bearerToken: String
    var session: URLSession = TalentSignalNetworking.session

    private static let platform = "ios"

    private func request(_ path: String, method: String, body: Data?) -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if !bearerToken.isEmpty {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        request.setValue(Self.platform, forHTTPHeaderField: "x-talent-signal-platform")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return request
    }

    private func send(_ request: URLRequest) async throws -> (Data, Int) {
        let (data, response) = try await TalentSignalNetworking.data(for: request, using: session)
        guard let http = response as? HTTPURLResponse else {
            throw AccountLoginMethodsError.invalidResponse
        }
        return (data, http.statusCode)
    }

    private func mapFailure(_ status: Int, _ data: Data) -> AccountLoginMethodsError {
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let code = (body?["error"] as? [String: Any])?["code"] as? String ?? ""
        switch (status, code) {
        case (_, "STEP_UP_FAILED"):
            return .stepUpFailed
        case (_, "LAST_LOGIN_METHOD"):
            return .lastLoginMethod
        case (_, "EMAIL_OWNERSHIP_UNRESOLVED"):
            return .emailOwnershipUnresolved
        case (_, "CREDENTIAL_ATTEMPT_INVALID"), (_, "CREDENTIAL_ATTEMPT_STALE"), (404, _):
            return .attemptInvalid
        case (_, "EMAIL_DELIVERY_UNAVAILABLE"), (_, "EMAIL_DELIVERY_FAILED"):
            return .deliveryUnavailable
        case (400, _):
            // A deterministic contract rejection: the backend guarantees no
            // write happened, so this is conclusively rejected.
            return .invalidInput
        case (409, _):
            return .conflict(code)
        default:
            // A generic 5xx/transport failure is UNKNOWN, never automatically
            // an email-delivery failure.
            return .unavailable
        }
    }

    func settings() async throws -> (AccountCredentialsSnapshot, [AccountDeviceSession]) {
        let (data, status) = try await send(request("v1/account/settings", method: "GET", body: nil))
        guard (200...299).contains(status) else { throw mapFailure(status, data) }
        let projection = try JSONDecoder().decode(AccountSettingsProjection.self, from: data)
        return (projection.snapshot, projection.sessions)
    }

    func revokeDeviceSession(id: String, expectedAccountRevision: Int) async throws -> (AccountCredentialsSnapshot, [AccountDeviceSession]) {
        struct RevokeRequest: Encodable {
            let id: String
            let kind = "revoke_session"
            let session_id: String
        }
        let body = try JSONEncoder().encode(RevokeRequest(
            id: UUID().uuidString.lowercased(),
            session_id: id
        ))
        let (data, status) = try await send(
            request("v1/account/settings", method: "POST", body: body)
        )
        guard (200...299).contains(status) else { throw mapFailure(status, data) }
        let projection = try JSONDecoder().decode(AccountSettingsProjection.self, from: data)
        return (projection.snapshot, projection.sessions)
    }

    func createChallenge(provider: AccountLoginProvider) async throws -> ProviderChallengeRef {
        guard provider.isFederated else { throw AccountLoginMethodsError.invalidResponse }
        let body = try JSONEncoder().encode(["client_label": "ios"])
        let (data, status) = try await send(
            request("v1/auth/\(provider.rawValue)/challenges", method: "POST", body: body)
        )
        guard (200...299).contains(status) else { throw mapFailure(status, data) }
        let challenge = try JSONDecoder().decode(AccountProviderChallengeResponse.self, from: data)
        guard challenge.contract_version == TalentSignalAPIContract.version else {
            throw AccountLoginMethodsError.invalidResponse
        }
        return ProviderChallengeRef(challenge_id: challenge.challenge_id, nonce: challenge.nonce)
    }

    func startChange(
        intent: AccountCredentialIntent,
        provider: AccountLoginProvider?,
        stepUp: AccountStepUpProof,
        clientLabel: String,
        expectedAccountRevision: Int,
        expectedUserRevision: Int
    ) async throws -> AccountCredentialAttempt {
        struct StepUpPassword: Encodable {
            let kind = "password"
            let password: String
        }
        struct StepUpProvider: Encodable {
            let kind = "provider"
            let provider: String
            let challenge_id: String
            let identity_token: String
        }
        struct StartRequest: Encodable {
            let id: String
            let intent: String
            let provider: String?
            let origin: String
            let client_label: String
            let step_up_password: StepUpPassword?
            let step_up_provider: StepUpProvider?
            let expected_account_revision: Int
            let expected_user_revision: Int
        }
        let passwordProof: StepUpPassword?
        let providerProof: StepUpProvider?
        switch stepUp {
        case let .password(value):
            passwordProof = StepUpPassword(password: value)
            providerProof = nil
        case let .linkedProvider(provider, challengeID, identityToken):
            passwordProof = nil
            providerProof = StepUpProvider(
                provider: provider.rawValue,
                challenge_id: challengeID,
                identity_token: identityToken
            )
        }
        struct EncodableStart: Encodable {
            let id: String
            let intent: String
            let provider: String?
            let origin: String
            let client_label: String
            let step_up: AnyEncodable
            let expected_account_revision: Int
            let expected_user_revision: Int
        }
        let stepUpValue = providerProof.map(AnyEncodable.init) ?? AnyEncodable(passwordProof!)
        // The backend rejects a provider on password intents: normalize at the
        // client boundary as well as the view/model, so no caller can leak one.
        let wireProvider: AccountLoginProvider? =
            (intent == .linkProvider || intent == .unlinkProvider) ? provider : nil
        let body = try JSONEncoder().encode(EncodableStart(
            id: UUID().uuidString.lowercased(),
            intent: intent.rawValue,
            provider: wireProvider?.rawValue,
            origin: "client:\(clientLabel)",
            client_label: clientLabel,
            step_up: stepUpValue,
            expected_account_revision: expectedAccountRevision,
            expected_user_revision: expectedUserRevision
        ))
        let (data, status) = try await send(
            request("v1/account/login-methods/attempts", method: "POST", body: body)
        )
        guard (200...299).contains(status) else { throw mapFailure(status, data) }
        let response = try JSONDecoder().decode(AccountCredentialAttemptResponse.self, from: data)
        guard response.contract_version == TalentSignalAPIContract.version else {
            throw AccountLoginMethodsError.invalidResponse
        }
        return AccountCredentialAttempt(
            attempt_id: response.attempt_id,
            attempt_secret: response.attempt_secret,
            intent: intent,
            provider: response.provider.flatMap(AccountLoginProvider.init(rawValue:)),
            expires_at: response.expires_at,
            providerChallenge: response.provider_challenge.map {
                ProviderChallengeRef(challenge_id: $0.challenge_id, nonce: $0.nonce)
            }
        )
    }

    func completeChange(
        attemptID: String,
        attemptSecret: String,
        password: String?,
        identityToken: String?
    ) async throws -> (status: String, snapshot: AccountCredentialsSnapshot) {
        struct CompleteRequest: Encodable {
            let attempt_id: String
            let attempt_secret: String
            let origin: String
            let password: String?
            let identity_token: String?
        }
        let body = try JSONEncoder().encode(CompleteRequest(
            attempt_id: attemptID,
            attempt_secret: attemptSecret,
            origin: "client:\(Self.platform)",
            password: password,
            identity_token: identityToken
        ))
        let (data, status) = try await send(
            request("v1/account/login-methods/complete", method: "POST", body: body)
        )
        guard (200...299).contains(status) else { throw mapFailure(status, data) }
        let response = try JSONDecoder().decode(AccountCredentialCompleteResponse.self, from: data)
        guard response.contract_version == TalentSignalAPIContract.version else {
            throw AccountLoginMethodsError.invalidResponse
        }
        return (response.status, response.settings.snapshot)
    }

    func startRegistration(
        username: String,
        email: String,
        displayName: String,
        password: String
    ) async throws {
        let body = try JSONEncoder().encode(AccountPasswordStartRequest(
            username: username,
            email: email,
            display_name: displayName,
            password: password,
            client_label: Self.platform
        ))
        let (data, status) = try await send(
            request("v1/auth/password/register", method: "POST", body: body)
        )
        guard (200...299).contains(status) else { throw mapFailure(status, data) }
    }

    func confirmRegistration(secret: String) async throws {
        let body = try JSONEncoder().encode(AccountPasswordConfirmRequest(
            verification_secret: secret,
            client_label: Self.platform
        ))
        let (data, status) = try await send(
            request("v1/auth/password/register/confirm", method: "POST", body: body)
        )
        guard (200...299).contains(status) else { throw mapFailure(status, data) }
    }
}

/// Small type-erased encoder for the step_up union.
struct AnyEncodable: Encodable {
    private let encodeValue: (Encoder) throws -> Void
    init<T: Encodable>(_ value: T) {
        encodeValue = { encoder in
            var container = encoder.singleValueContainer()
            try container.encode(value)
        }
    }
    func encode(to encoder: Encoder) throws {
        try encodeValue(encoder)
    }
}

/// In-memory test double; keeps no secrets and records only opaque request
/// shapes so tests can assert the step-up/attempt protocol.
final class AccountLoginMethodsStub: AccountLoginMethodsServing, @unchecked Sendable {
    var snapshot: AccountCredentialsSnapshot
    var startPassword: String?
    var stepUps: [AccountStepUpProof] = []
    var completed: [(attemptID: String, password: String?, identityToken: String?)] = []
    var startError: AccountLoginMethodsError?
    var completeError: AccountLoginMethodsError?
    private let lock = NSLock()

    init(snapshot: AccountCredentialsSnapshot) {
        self.snapshot = snapshot
    }

    var deviceSessions: [AccountDeviceSession] = []

       func settings() async throws -> (AccountCredentialsSnapshot, [AccountDeviceSession]) {
        (snapshot, deviceSessions)
    }

    func revokeDeviceSession(id: String, expectedAccountRevision: Int) async throws -> (AccountCredentialsSnapshot, [AccountDeviceSession]) {
        deviceSessions.removeAll { $0.id == id }
        return (snapshot, deviceSessions)
    }

    var challengeNonce = "fixture-challenge-nonce"

    func createChallenge(provider: AccountLoginProvider) async throws -> ProviderChallengeRef {
        ProviderChallengeRef(challenge_id: "challenge-1", nonce: challengeNonce)
    }

    func startChange(
        intent: AccountCredentialIntent,
        provider: AccountLoginProvider?,
        stepUp: AccountStepUpProof,
        clientLabel: String,
        expectedAccountRevision: Int,
        expectedUserRevision: Int
    ) async throws -> AccountCredentialAttempt {
        if let startError { throw startError }
        lock.lock()
        if case let .password(value) = stepUp { startPassword = value }
        stepUps.append(stepUp)
        lock.unlock()
        return AccountCredentialAttempt(
            attempt_id: "attempt-1",
            attempt_secret: "secret-held-in-memory-only",
            intent: intent,
            provider: provider,
            expires_at: "2030-01-01T00:00:00.000Z",
            providerChallenge: intent == .linkProvider
                ? ProviderChallengeRef(challenge_id: "challenge-1", nonce: challengeNonce)
                : nil
        )
    }

    func completeChange(
        attemptID: String,
        attemptSecret: String,
        password: String?,
        identityToken: String?
    ) async throws -> (status: String, snapshot: AccountCredentialsSnapshot) {
        if let completeError { throw completeError }
        lock.lock()
        completed.append((attemptID, password, identityToken))
        lock.unlock()
        return ("password_set", snapshot)
    }

    func startRegistration(username: String, email: String, displayName: String, password: String) async throws {}
    func confirmRegistration(secret: String) async throws {}
}
