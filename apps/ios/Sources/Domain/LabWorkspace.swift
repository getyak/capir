import Foundation

struct LabWorkspace: Codable, Equatable, Identifiable {
    enum State: String, Codable { case active, expired, deleting, deleted }
    let id: UUID
    let ownerAccountID: String
    let ownerUserID: String
    let accountID: String
    let userID: String
    let name: String
    let state: State
    let createdAt: Date
    let emptyVerifiedAt: Date?
    let expiresAt: Date
    let durationHours: Int
    let stopID: UUID?
    let stopReason: String?
    let stoppedAt: Date?
    let deletedAt: Date?
    let cleanupError: String?
    let dataRows: Int?
    let activeSessions: Int
    let pendingMediaWrites: Int
    let scope: String

    var isEmptyAndIsolated: Bool {
        scope == "isolated_test_account" && emptyVerifiedAt != nil && dataRows == 0
    }

    enum CodingKeys: String, CodingKey {
        case id, name, state, scope
        case ownerAccountID = "owner_account_id"
        case ownerUserID = "owner_user_id"
        case accountID = "account_id"
        case userID = "user_id"
        case createdAt = "created_at"
        case emptyVerifiedAt = "empty_verified_at"
        case expiresAt = "expires_at"
        case durationHours = "duration_hours"
        case stopID = "stop_id"
        case stopReason = "stop_reason"
        case stoppedAt = "stopped_at"
        case deletedAt = "deleted_at"
        case cleanupError = "cleanup_error"
        case dataRows = "data_rows"
        case activeSessions = "active_sessions"
        case pendingMediaWrites = "pending_media_writes"
    }
}

struct LabWorkspaceEntry: Codable, Equatable, Identifiable {
    enum State: String, Codable { case active, expired, revoked }
    struct Session: Codable, Equatable {
        let contractVersion: String
        let expiresAt: Date
        let account: Account
        let user: User
        struct Account: Codable, Equatable { let id: String; let slug: String; let name: String }
        struct User: Codable, Equatable {
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
            case expiresAt = "expires_at"
            case account, user
        }
    }
    let id: UUID
    let workspaceID: UUID
    let sessionID: UUID
    let expiresAt: Date
    let revokedAt: Date?
    let state: State
    let session: Session?

    enum CodingKeys: String, CodingKey {
        case id, state, session
        case workspaceID = "workspace_id"
        case sessionID = "session_id"
        case expiresAt = "expires_at"
        case revokedAt = "revoked_at"
    }
}

struct LabWorkspaceJourney: Codable, Equatable, Identifiable {
    enum Phase: String, Codable {
        case preparing
        case entryReady
        case childActive
        case returning
        case ownerActive
        case stopPending
        case deleting
        case finished
    }

    let id: UUID
    let endpointScope: String
    let ownerAccountID: String
    let ownerUserID: String
    let entryID: UUID
    let durationHours: Int
    let startedAt: Date
    var phase: Phase
    var originalSession: TalentSignalSession?
    var childAccessToken: String?
    var targetAccountID: String?
    var targetUserID: String?
    var entryExpiresAt: Date?
    var leavePending: Bool
    var stopID: UUID?
    var workspace: LabWorkspace?
    var updatedAt: Date

    var hasReturnCredential: Bool { originalSession != nil }
    var stopRequested: Bool { stopID != nil }
    var isOpen: Bool { phase != .finished }
    var isChildPhase: Bool { [.entryReady, .childActive, .returning].contains(phase) }

    init(owner: TalentSignalSession, durationHours: Int, now: Date = .now,
         workspaceID: UUID = UUID(), entryID: UUID = UUID(), accessToken: String) {
        id = workspaceID
        endpointScope = RuntimeEndpoint.scope(owner.baseURL)
        ownerAccountID = owner.account.id
        ownerUserID = owner.user.id
        self.entryID = entryID
        self.durationHours = durationHours
        startedAt = now
        phase = .preparing
        originalSession = owner
        childAccessToken = accessToken
        leavePending = false
        updatedAt = now
    }
}

struct LabWorkspaceReceipt: Codable, Equatable, Identifiable {
    let id: UUID
    let state: LabWorkspace.State
    let stoppedAt: Date?
    let deletedAt: Date?
    let cleanupError: String?
    let dataRows: Int?
}

enum LabWorkspaceError: LocalizedError, Equatable {
    case unavailable
    case authenticationRequired
    case wrongAccount
    case invalidResponse
    case contractMismatch
    case secureStore
    case busy
    case notEmpty
    case closed
    case backend(status: Int, code: String, message: String)

    var errorDescription: String? {
        switch self {
        case .unavailable: "Test workspaces are unavailable for this backend."
        case .authenticationRequired: "Sign in to the original account to continue this test-workspace operation."
        case .wrongAccount: "Return with the original account used to create this test workspace."
        case .invalidResponse: "The test-workspace response could not be verified."
        case .contractMismatch: "The test-workspace contract changed. Update capri and try again."
        case .secureStore: "Protected test-workspace recovery is unavailable. Account content remains closed."
        case .busy: "Finish active requests or recording before changing workspaces."
        case .notEmpty: "The server did not verify this test workspace as empty and isolated."
        case .closed: "This test workspace is closed or expired. Return to the original account."
        case let .backend(_, code, message): "\(message) (\(code))"
        }
    }
}
