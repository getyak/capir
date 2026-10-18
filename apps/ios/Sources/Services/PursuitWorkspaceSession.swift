import Foundation

struct PursuitWorkspaceSession: Equatable {
    let baseURL: URL
    let accountSlug: String
    let userEmail: String
    let accessToken: String?
    let accountID: String?
    let userID: String?
    let userDisplayName: String?
    var expiresAt: Date? = nil

    var persistenceScope: String {
        RuntimeEndpoint.scope(baseURL, accountID: accountID ?? accountSlug, userID: userID ?? userEmail)
    }

    static func authenticated(_ session: TalentSignalSession) -> PursuitWorkspaceSession {
        PursuitWorkspaceSession(
            baseURL: session.baseURL,
            accountSlug: session.account.slug,
            userEmail: session.user.email,
            accessToken: session.accessToken,
            accountID: session.account.id,
            userID: session.user.id,
            userDisplayName: session.user.displayName,
            expiresAt: session.expiresAt
        )
    }

    static func configured(arguments: [String]) -> PursuitWorkspaceSession? {
#if DEBUG
        guard let backend = value(after: "--workspace-backend-url", in: arguments),
              let baseURL = URL(string: backend),
              URLFixtureLoader.isLoopback(baseURL) else {
            return nil
        }
        return PursuitWorkspaceSession(
            baseURL: baseURL,
            accountSlug: value(after: "--workspace-account-slug", in: arguments)
                ?? "fixture-alpha",
            userEmail: value(after: "--workspace-user-email", in: arguments)
                ?? "recruiter@alpha.local",
            accessToken: nil,
            accountID: value(after: "--workspace-account-id", in: arguments),
            userID: nil,
            userDisplayName: nil
        )
#else
        return nil
#endif
    }

    private static func value(after argument: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: argument),
              arguments.indices.contains(index + 1) else {
            return nil
        }
        return arguments[index + 1]
    }
}
