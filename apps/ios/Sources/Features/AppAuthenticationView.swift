import AuthenticationServices
import CryptoKit
import SwiftUI

@MainActor
final class AppSessionStore: ObservableObject {
    enum Phase: Equatable {
        case restoring
        case signedOut
        case signedIn(TalentSignalSession)
    }

    @Published private(set) var phase: Phase = .restoring
    @Published private(set) var challenge: AppleLoginChallenge?
    @Published private(set) var isWorking = false
    @Published private(set) var baseURL: URL?
    @Published private(set) var contextGeneration = UUID()
    @Published var notice: String?
    @Published private(set) var endingReceipts: [AppSessionEndingReceipt] = []
    @Published private(set) var signOutRecoveryReadFailed = false
    var needsSignOutRecovery: Bool { signOutRecoveryReadFailed || endingReceipts.contains { !$0.settled } }
    private var authenticationAllowed = true

    private var client: (any AppAuthenticationServing)?
    private var persistence: TalentSignalSessionPersisting
    private var endingPersistence: any AppSessionEndingPersisting
    private let endingFactory: (URL?) -> any AppSessionEndingPersisting
    private let clientFactory: (URL) -> any AppAuthenticationServing
    private let persistenceFactory: (URL?) -> any TalentSignalSessionPersisting
    private let closeSessionSurfaces: () async -> Void
    private let coordinator: IOSPersistentSessionCoordinator
    private var restoration: (id: UUID, generation: UUID, task: Task<Void, Never>)?
    private var stagedSignInFingerprint: String?

    init(
        baseURL: URL?,
        persistence: TalentSignalSessionPersisting? = nil,
        client: (any AppAuthenticationServing)? = nil,
        endings: (any AppSessionEndingPersisting)? = nil,
        endingFactory: @escaping (URL?) -> any AppSessionEndingPersisting = { KeychainAppSessionEndingStore(endpoint: $0) },
        clientFactory: @escaping (URL) -> any AppAuthenticationServing = { AppAuthenticationClient(baseURL: $0) },
        persistenceFactory: @escaping (URL?) -> any TalentSignalSessionPersisting = { KeychainTalentSignalSessionStore(baseURL: $0) },
        closeSessionSurfaces: @escaping () async -> Void = {},
        coordinator: IOSPersistentSessionCoordinator = .shared
    ) {
        self.baseURL = baseURL
        self.endingFactory = endingFactory
        self.endingPersistence = endings ?? endingFactory(baseURL)
        self.clientFactory = clientFactory
        self.persistenceFactory = persistenceFactory
        self.persistence = persistence ?? persistenceFactory(baseURL)
        self.client = client ?? baseURL.map(clientFactory)
        self.closeSessionSurfaces = closeSessionSurfaces
        self.coordinator = coordinator
    }

    func requireEnvironmentVerification(_ message: String) {
        authenticationAllowed = false
        phase = .signedOut
        challenge = nil
        notice = message
    }

    func activateEnvironment(_ target: URL) async throws {
        guard !isWorking else { throw RuntimeEnvironmentError.busy }
        try RuntimeWorkRegistry.shared.beginTransition()
        authenticationAllowed = true
        contextGeneration = UUID()
        baseURL = target
        client = clientFactory(target)
        persistence = persistenceFactory(target)
        endingPersistence = endingFactory(target)
        endingReceipts = []
        signOutRecoveryReadFailed = false
        challenge = nil
        notice = nil
        phase = .restoring
        RuntimeWorkRegistry.shared.endTransition()
        // Returning to a saved target never shows its content until this target verifies the account.
        await restore(allowOfflineWorkspace: false)
    }

    func restore(allowOfflineWorkspace: Bool = true) async {
        if let restoration, restoration.generation == contextGeneration {
            await restoration.task.value
            return
        }
        guard !isWorking else { return }
        let id = UUID(), generation = contextGeneration
        let task = Task { [weak self] in
            guard let self, self.contextGeneration == generation else { return }
            await self.restoreOnce(allowOfflineWorkspace: allowOfflineWorkspace)
        }
        restoration = (id, generation, task)
        await task.value
        if restoration?.id == id { restoration = nil }
    }

    private func restoreOnce(allowOfflineWorkspace: Bool) async {
        guard !isWorking else { return }
        let generation = contextGeneration
        let persistence = persistence
        guard let client, let baseURL else {
            phase = .signedOut
            notice = "Set TALENT_SIGNAL_API_BASE_URL for this build."
            return
        }
        do {
            if let current = currentSession { try await coordinator.assertRestorable(current) }
            let endingRecords: [AppSessionEnding]
            do {
                endingRecords = try endingPersistence.load()
                signOutRecoveryReadFailed = false
            } catch {
                signOutRecoveryReadFailed = true
                throw error
            }
            endingReceipts = endingRecords.map(AppSessionEndingReceipt.init)
            guard var stored = try persistence.load() else {
                phase = .signedOut
                await prepareChallenge()
                return
            }
            if endingRecords.contains(where: { $0.blocks(stored) }) {
                phase = .signedOut
                await prepareChallenge()
                notice = "This session was signed out. Protected removal or remote revocation can be reviewed in Lab."
                return
            }
            guard RuntimeEndpoint.same(stored.baseURL, baseURL) else { throw AppSessionError.scopeMismatch }
            try await coordinator.assertRestorable(stored)
            guard stored.persistent != nil || stored.expiresAt > .now else {
                _ = try persistence.removeMatching(stored)
                phase = .signedOut
                await prepareChallenge()
                notice = "This older sign-in expired before automatic renewal was enabled. Sign in once to keep this device signed in."
                return
            }
            IOSSessionFamilyRegistry.shared.remember(stored)
            if allowOfflineWorkspace { phase = .signedIn(stored) }
            do {
                let validated: TalentSignalSession
                if client.supportsPersistentSessions, stored.isRealUserSession {
                    if stored.persistent == nil {
                        // A healthy legacy session is verified before a pending
                        // capability is persisted. Expired legacy access grants
                        // no authority to manufacture a new permanent login.
                        let original = stored
                        stored = try await client.validate(stored)
                        guard generation == contextGeneration else { return }
                        try verify(stored, endpoint: baseURL)
                        guard let current = try persistence.load(), RuntimeEndpoint.same(current.baseURL, baseURL),
                              current.account.id == stored.account.id, current.user.id == stored.user.id else { throw CancellationError() }
                        if current.persistent != nil {
                            guard current.persistent?.sessionID == stored.sessionID else { throw CancellationError() }
                            stored = current
                        } else {
                            guard current.accessToken == original.accessToken else { throw CancellationError() }
                            stored.persistent = try IOSPersistentSessionCredential.pending(session: stored)
                            try persistence.save(stored)
                        }
                    }
                    validated = try await coordinator.resolve(stored,
                        persistence: persistence, endings: endingPersistence, client: client, force: true)
                } else { validated = try await client.validate(stored) }
                guard generation == contextGeneration else { return }
                try verify(validated, endpoint: baseURL)
                guard validated.account.id == stored.account.id, validated.user.id == stored.user.id,
                      try !endingPersistence.load().contains(where: { $0.blocks(validated) }) else { throw AppSessionError.scopeMismatch }
                try persistence.save(validated)
                IOSSessionFamilyRegistry.shared.remember(validated)
                phase = .signedIn(validated)
                notice = nil
            } catch let error as AppSessionError where error.invalidatesSession {
                guard generation == contextGeneration else { return }
                _ = try? persistence.removeMatching(stored)
                contextGeneration = UUID()
                phase = .signedOut
                await closeSessionSurfaces()
                await prepareChallenge()
                notice = "This device session was revoked. Sign in again to continue."
            } catch {
                guard generation == contextGeneration else { return }
                if error is CancellationError { return }
                if allowOfflineWorkspace {
                    phase = .signedIn(stored)
                    notice = "Saved sign-in kept on this device. Automatic renewal will retry when secure storage and the service are available."
                } else {
                    phase = .restoring
                    notice = error.localizedDescription
                }
            }
        } catch {
            guard generation == contextGeneration else { return }
            if let failure = error as? AppSessionError, failure.invalidatesSession {
                contextGeneration = UUID()
                phase = .signedOut
                await closeSessionSurfaces()
                await prepareChallenge()
                notice = "This device session was revoked. Sign in again to continue."
                return
            }
            // A locked/corrupt secure store is unavailable, not a signed-out
            // identity. Preserve its bytes and expose an explicit retry.
            if currentSession == nil { phase = .restoring }
            notice = error.localizedDescription
        }
    }

    func prepareChallenge() async {
        guard authenticationAllowed, let client, !isWorking else { return }
        let generation = contextGeneration
        isWorking = true
        defer { if generation == contextGeneration { isWorking = false } }
        do {
            let challenge = try await client.challenge()
            guard generation == contextGeneration else { return }
            guard challenge.expiresAt > .now,
                  challenge.contractVersion == TalentSignalAPIContract.version else {
                throw AppSessionError.contractMismatch
            }
            self.challenge = challenge
            notice = nil
        } catch {
            guard generation == contextGeneration else { return }
            challenge = nil
            notice = error.localizedDescription
        }
    }

    func signIn(identityToken: Data?, fullName: PersonNameComponents?) async {
        guard authenticationAllowed, !isWorking, let identityToken, let token = String(data: identityToken, encoding: .utf8),
              let challenge, let client, let baseURL else {
            notice = AppSessionError.invalidIdentityToken.localizedDescription
            return
        }
        stagedSignInFingerprint = nil
        let generation = contextGeneration
        let persistence = persistence
        isWorking = true
        defer { if generation == contextGeneration { isWorking = false } }
        do {
            let session = try await client.signIn(identityToken: token, challengeID: challenge.id,
                givenName: fullName?.givenName, familyName: fullName?.familyName)
            guard generation == contextGeneration else { return }
            try verify(session, endpoint: baseURL)
            guard try !endingPersistence.load().contains(where: { $0.blocks(session) }) else {
                throw AppSessionError.scopeMismatch
            }
            let admitted = try await persistAuthenticatedSession(session)
            guard generation == contextGeneration else { return }
            self.challenge = nil
            notice = nil
            phase = .signedIn(admitted)
        } catch {
            guard generation == contextGeneration else { return }
            if retainPendingSignIn() { return }
            self.challenge = nil
            let signInNotice = self.signInNotice(error)
            isWorking = false
            await prepareChallenge()
            guard generation == contextGeneration else { return }
            if self.challenge != nil { notice = signInNotice }
        }
    }

    func signInWithGoogle() async {
        guard authenticationAllowed, !isWorking, let client, let baseURL else { return }
        stagedSignInFingerprint = nil
        let generation = contextGeneration
        isWorking = true; notice = nil
        defer { if generation == contextGeneration { isWorking = false } }
        do {
            let challenge = try await client.googleChallenge()
            guard challenge.contractVersion == TalentSignalAPIContract.version, challenge.expiresAt > .now else { throw AppSessionError.contractMismatch }
            let flow = GoogleSignInFlow()
            let token = try await flow.identityToken(nonce: challenge.nonce)
            guard generation == contextGeneration else { return }
            let session = try await client.signInGoogle(identityToken: token, challengeID: challenge.id)
            guard generation == contextGeneration else { return }
            try verify(session, endpoint: baseURL)
            let validated = try await client.validate(session)
            guard generation == contextGeneration else { return }
            try verify(validated, endpoint: baseURL)
            guard validated.account.id == session.account.id, validated.user.id == session.user.id else { throw AppSessionError.scopeMismatch }
            guard try !endingPersistence.load().contains(where: { $0.blocks(validated) }) else { throw AppSessionError.scopeMismatch }
            let admitted = try await persistAuthenticatedSession(validated)
            guard generation == contextGeneration else { return }
            phase = .signedIn(admitted); self.challenge = nil
        } catch {
            guard generation == contextGeneration else { return }
            if retainPendingSignIn() { return }
            if (error as? ASWebAuthenticationSessionError)?.code != .canceledLogin { notice = signInNotice(error) }
        }
    }

    func signInWithEmail(email: String, password: String, registering: Bool) async {
        guard authenticationAllowed, !isWorking, let client, let baseURL else { return }
        stagedSignInFingerprint = nil
        let generation = contextGeneration
        isWorking = true; notice = nil
        defer { if generation == contextGeneration { isWorking = false } }
        do {
            let session = try await client.signInEmail(email: email, password: password, registering: registering)
            guard generation == contextGeneration else { return }
            try verify(session, endpoint: baseURL)
            let validated = try await client.validate(session)
            guard generation == contextGeneration else { return }
            try verify(validated, endpoint: baseURL)
            guard validated.account.id == session.account.id, validated.user.id == session.user.id else { throw AppSessionError.scopeMismatch }
            guard try !endingPersistence.load().contains(where: { $0.blocks(validated) }) else { throw AppSessionError.scopeMismatch }
            let admitted = try await persistAuthenticatedSession(validated)
            guard generation == contextGeneration else { return }
            phase = .signedIn(admitted); challenge = nil
        } catch {
            guard generation == contextGeneration else { return }
            if retainPendingSignIn() { return }
            notice = signInNotice(error)
        }
    }

    /// Verified signup: start delivery only. The generic response never
    /// contains a code; the owner confirms from their email.
    func startRegistration(email: String, password: String) async -> Bool {
        guard authenticationAllowed, !isWorking, let client else { return false }
        let generation = contextGeneration
        isWorking = true; notice = nil
        defer { if generation == contextGeneration { isWorking = false } }
        do {
            try await client.startRegistration(email: email, password: password)
            return generation == contextGeneration
        } catch {
            guard generation == contextGeneration else { return false }
            notice = signInNotice(error)
            return false
        }
    }

    /// Intentional completion of the emailed verification opens the verified
    /// account session; a scanner or a plain link never signs in.
    func confirmRegistration(secret: String) async {
        guard authenticationAllowed, !isWorking, let client, let baseURL else { return }
        stagedSignInFingerprint = nil
        let generation = contextGeneration
        isWorking = true; notice = nil
        defer { if generation == contextGeneration { isWorking = false } }
        do {
            let session = try await client.confirmRegistration(secret: secret)
            guard generation == contextGeneration else { return }
            try verify(session, endpoint: baseURL)
            let validated = try await client.validate(session)
            guard generation == contextGeneration else { return }
            try verify(validated, endpoint: baseURL)
            guard validated.account.id == session.account.id, validated.user.id == session.user.id else { throw AppSessionError.scopeMismatch }
            guard try !endingPersistence.load().contains(where: { $0.blocks(validated) }) else { throw AppSessionError.scopeMismatch }
            let admitted = try await persistAuthenticatedSession(validated)
            guard generation == contextGeneration else { return }
            phase = .signedIn(admitted); challenge = nil
        } catch {
            guard generation == contextGeneration else { return }
            if retainPendingSignIn() { return }
            notice = signInNotice(error)
        }
    }

    private func persistAuthenticatedSession(_ session: TalentSignalSession) async throws -> TalentSignalSession {
        guard let client, let baseURL else { throw AppSessionError.scopeMismatch }
        let generation = contextGeneration
        var pending = session
        if client.supportsPersistentSessions, session.isRealUserSession, session.persistent == nil {
            if pending.sessionID == nil {
                // Older compatible deployments can omit the new optional ID.
                // Retain this verified ordinary receipt while its canonical
                // readback is unavailable; never invent a permanent family.
                guard try !endingPersistence.load().contains(where: { $0.blocks(session) }) else { throw AppSessionError.scopeMismatch }
                try persistence.save(session)
                stagedSignInFingerprint = AppSessionEnding.fingerprint(session)
                pending = try await client.validate(session)
                guard generation == contextGeneration else { throw CancellationError() }
                guard pending.account.id == session.account.id, pending.user.id == session.user.id else { throw AppSessionError.scopeMismatch }
            }
            try verify(pending, endpoint: baseURL)
            pending.persistent = try IOSPersistentSessionCredential.pending(session: pending)
        }
        guard try !endingPersistence.load().contains(where: { $0.blocks(pending) }) else { throw AppSessionError.scopeMismatch }
        try persistence.save(pending)
        stagedSignInFingerprint = AppSessionEnding.fingerprint(pending)
        guard pending.persistent != nil else { stagedSignInFingerprint = nil; return pending }
        // A failed enrollment retains this exact protected pending capability.
        // Relaunch/foreground resumes it rather than minting another family.
        let admitted = try await coordinator.resolve(pending,
            persistence: persistence, endings: endingPersistence, client: client, force: true)
        IOSSessionFamilyRegistry.shared.remember(admitted)
        stagedSignInFingerprint = nil
        return admitted
    }

    private func retainPendingSignIn() -> Bool {
        guard let stagedSignInFingerprint, let stored = try? persistence.load(),
              AppSessionEnding.fingerprint(stored) == stagedSignInFingerprint,
              (try? endingPersistence.load().contains(where: { $0.blocks(stored) })) == false else { return false }
        phase = .restoring
        challenge = nil
        notice = "Your sign-in is saved securely. Automatic renewal could not finish; retry when the service and secure storage are available."
        return true
    }

    func refreshIfNeeded(force: Bool = false) async {
        if !isWorking, phase == .restoring, force || notice != nil {
            // Unlock/foreground resumes unavailable protected storage through
            // the same owner. Keep strict account admission for a target that
            // has not yet completed its online identity readback.
            await restore(allowOfflineWorkspace: false)
            return
        }
        guard !isWorking, let current = currentSession, current.persistent != nil,
              force || current.expiresAt.timeIntervalSinceNow <= 4 * 3600 else { return }
        await restore()
    }

    func adoptRenewedSession(_ session: TalentSignalSession) {
        guard let current = currentSession, current.loginIdentity == session.loginIdentity else { return }
        IOSSessionFamilyRegistry.shared.remember(session)
        phase = .signedIn(session)
        notice = nil
    }

    func observeRevocation(_ identity: String) async {
        guard currentSession?.loginIdentity == identity else { return }
        contextGeneration = UUID()
        phase = .signedOut
        await closeSessionSurfaces()
        await prepareChallenge()
        notice = "This device session was revoked. Sign in again to continue."
    }

    private func signInNotice(_ error: Error) -> String {
        guard case let AppSessionError.backend(_, code, _) = error else { return error.localizedDescription }
        switch code {
        case "PASSWORD_SIGN_IN_FAILED": return "The email or password is not recognized."
        case "PASSWORD_ACCOUNT_EXISTS": return "This email already has an account. Please sign in."
        case "GOOGLE_ACCOUNT_LINK_REQUIRED", "APPLE_ACCOUNT_LINK_REQUIRED": return "This email already has a workspace. Use its existing sign-in method."
        case "APPLE_CHALLENGE_INVALID", "APPLE_CHALLENGE_REPLAYED", "APPLE_TOKEN_REPLAYED", "APPLE_TOKEN_INVALID", "APPLE_NONCE_MISMATCH", "APPLE_AUDIENCE_MISMATCH": return "Apple sign-in expired or could not be verified. Please try again."
        case "GOOGLE_CHALLENGE_INVALID", "GOOGLE_TOKEN_REPLAYED", "GOOGLE_TOKEN_INVALID": return "Google sign-in expired. Please try again."
        case "VERIFICATION_INVALID": return "This verification code is invalid or has expired. Start again to get a new email."
        case "EMAIL_DELIVERY_UNAVAILABLE", "EMAIL_DELIVERY_FAILED": return "Verification email could not be sent. No account was created. Try again shortly."
        default: return "Sign-in is temporarily unavailable. Please try again."
        }
    }

    @discardableResult
    func signOut() async -> AppSessionEndingReceipt? {
        guard !isWorking, case let .signedIn(session) = phase, let baseURL, let client else { return nil }
        let controller = AppSessionEndingController(endpoint: baseURL, sessions: persistence, endings: endingPersistence, client: client)
        return await endSession(controller: controller, prepare: { try controller.prepare(session).id })
    }

    @discardableResult
    func retrySignOut(_ id: UUID) async -> AppSessionEndingReceipt? {
        guard !isWorking, let baseURL, let client else { return nil }
        let controller = AppSessionEndingController(endpoint: baseURL, sessions: persistence, endings: endingPersistence, client: client)
        return await endSession(controller: controller, prepare: {
            guard try self.endingPersistence.load().contains(where: { $0.id == id && $0.endpointScope == RuntimeEndpoint.scope(baseURL) }) else { throw AppSessionError.scopeMismatch }
            return id
        })
    }

    func refreshSignOutReceipts() {
        guard !isWorking else { return }
        do {
            endingReceipts = try endingPersistence.load().map(AppSessionEndingReceipt.init)
            signOutRecoveryReadFailed = false
        } catch {
            signOutRecoveryReadFailed = true
            notice = AppSessionEndingError.unreadable.localizedDescription
        }
    }

    func finishResetSignOut(fingerprint: String) async -> AppSessionEndingReceipt? {
        guard !isWorking else { return nil }
        do {
            if let ending = try endingPersistence.load().first(where: { $0.credentialFingerprint == fingerprint }) {
                return await retrySignOut(ending.id)
            }
            guard case let .signedIn(current) = phase, AppSessionEnding.fingerprint(current) == fingerprint else { return nil }
            return await signOut()
        } catch { notice = AppSessionEndingError.unreadable.localizedDescription; return nil }
    }

    var currentSession: TalentSignalSession? {
        guard case let .signedIn(value) = phase else { return nil }
        return value
    }

    /// Adopts a credential retained by a protected, endpoint-scoped recovery
    /// operation. The target is verified online before any current content or
    /// credential changes, and the caller must own the maintenance barrier.
    func replaceWithValidatedProtectedSession(
        _ candidate: TalentSignalSession,
        expectedCurrent: TalentSignalSession?,
        maintenancePermit: UUID
    ) async throws -> TalentSignalSession {
        guard RuntimeWorkRegistry.shared.ownsMaintenance(maintenancePermit),
              !isWorking, let baseURL, let client else { throw LabWorkspaceError.busy }
        if let expectedCurrent {
            guard case let .signedIn(current) = phase,
                  AppSessionEnding.fingerprint(current) == AppSessionEnding.fingerprint(expectedCurrent) else {
                throw LabWorkspaceError.wrongAccount
            }
        } else if phase != .signedOut {
            throw LabWorkspaceError.wrongAccount
        }
        guard RuntimeEndpoint.same(candidate.baseURL, baseURL), candidate.persistent != nil || candidate.expiresAt > Date() else {
            throw AppSessionError.scopeMismatch
        }
        let generation = contextGeneration
        isWorking = true
        defer { if generation == contextGeneration { isWorking = false } }
        try await coordinator.assertRestorable(candidate)
        guard generation == contextGeneration else { throw LabWorkspaceError.busy }
        let permission = RuntimePersistentRenewalPermission(owner: maintenancePermit, session: candidate)
        let validated = try await RuntimeMaintenanceContext.$persistentRenewal.withValue(permission) { try await client.validate(candidate) }
        guard generation == contextGeneration else { throw LabWorkspaceError.busy }
        try await coordinator.assertRestorable(validated)
        guard generation == contextGeneration else { throw LabWorkspaceError.busy }
        try verify(validated, endpoint: baseURL)
        guard validated.account.id == candidate.account.id,
              validated.user.id == candidate.user.id,
              try !endingPersistence.load().contains(where: {
                  $0.blocks(validated)
              }) else { throw LabWorkspaceError.wrongAccount }
        try persistence.save(validated)
        guard let saved = try persistence.load(),
              AppSessionEnding.fingerprint(saved) == AppSessionEnding.fingerprint(validated) else {
            throw LabWorkspaceError.secureStore
        }
        contextGeneration = UUID()
        IOSSessionFamilyRegistry.shared.remember(validated)
        challenge = nil
        notice = nil
        phase = .signedIn(validated)
        isWorking = false
        await closeSessionSurfaces()
        return validated
    }

    private func endSession(controller: AppSessionEndingController, prepare: () throws -> UUID) async -> AppSessionEndingReceipt? {
        let permit: UUID
        do { permit = try RuntimeWorkRegistry.shared.beginMaintenance() }
        catch { notice = RuntimeEnvironmentError.busy.localizedDescription; return nil }
        isWorking = true
        var result: AppSessionEndingReceipt?
        var endingNotice: String?
        var closed = false
        do {
            try Task.checkCancellation()
            let id = try prepare()
            let records = try endingPersistence.load()
            endingReceipts = records.map(AppSessionEndingReceipt.init)
            // The protected intent exists before old content is closed. Every
            // earlier validate/sign-in completion now belongs to an old root.
            let target = records.first { $0.id == id }
            if let credential = target?.credential {
                await coordinator.retire(credential)
            }
            try DeviceCalendarReceiptStore.clearLegacyPrivateDetails()
            if let session = target?.credential {
                try DeviceCalendarReceiptStore(scope: RuntimeEndpoint.scope(session.baseURL,
                    accountID: session.account.id, userID: session.user.id)).clearPrivateDetails(savedBefore: target!.startedAt)
            }
            if case let .signedIn(current) = phase,
               target?.credentialFingerprint != AppSessionEnding.fingerprint(current) {
                closed = false
            } else if phase == .signedOut {
                // Retrying an already closed session must leave its recovery
                // screen mounted so the user can read the resulting receipt.
                closed = true
            } else {
                contextGeneration = UUID(); challenge = nil; phase = .signedOut; closed = true
                await closeSessionSurfaces()
            }
            let record = try await RuntimeMaintenanceContext.$logoutPermit.withValue(permit) {
                try await RuntimeMaintenanceContext.$logoutEndpoint.withValue(baseURL) { try await controller.run(id) }
            }
            result = AppSessionEndingReceipt(record)
            endingReceipts = try endingPersistence.load().map(AppSessionEndingReceipt.init)
            if record.local == .removed {
                switch record.remote {
                case .revoked, .alreadyInvalid, .expired: endingNotice = nil
                default: endingNotice = "Signed out on this device. The remote session could not be revoked. Review and retry the retained revocation-only recovery in Lab."
                }
            } else if record.remoteSettled {
                endingNotice = "Signed out. The server revoked or expired this session, but its protected local record could not be removed. Restoration is blocked; retry removal in Lab."
            } else {
                endingNotice = "Sign out is incomplete. This account is closed on this device; protected local removal and remote revocation need retry in Lab."
            }
        } catch {
            endingNotice = closed
                ? "The account view is closed. Sign-out recovery could not be fully saved; review the retained operation in Lab before leaving this device."
                : "Sign out could not start safely. Finish active work or retry protected storage before leaving this device."
        }
        RuntimeWorkRegistry.shared.endMaintenance(permit)
        isWorking = false
        refreshSignOutReceipts()
        if closed {
            await prepareChallenge()
            notice = endingNotice ?? notice
        } else if result != nil {
            notice = "The earlier sign-out was reviewed. Your current sign-in was preserved."
        } else { notice = endingNotice }
        return result
    }

    private func verify(_ session: TalentSignalSession, endpoint: URL) throws {
        guard RuntimeEndpoint.same(session.baseURL, endpoint), session.expiresAt > .now,
              !session.accessToken.isEmpty, !session.account.id.isEmpty, !session.user.id.isEmpty else {
            throw AppSessionError.scopeMismatch
        }
    }
}

struct AppAuthenticationView: View {
    @ObservedObject var store: AppSessionStore
    var openLab: (() -> Void)? = nil
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.appLanguage) private var appLanguage
    @State private var showsSignOutRecovery = false
    @State private var showsEmail = false

    var body: some View {
        AuthenticationWelcomeView(openLab: openLab, needsRecovery: store.needsSignOutRecovery) {
            VStack(spacing: 10) {
                if GoogleSignInFlow.clientID != nil {
                    Button { Task { await store.signInWithGoogle() } } label: {
                        HStack(spacing: 12) {
                            Image("GoogleSignInMark").resizable().frame(width: 20, height: 20)
                            Text(appLanguage.text("Continue with Google")).font(.headline)
                            if store.isWorking { ProgressView() }
                        }
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .foregroundStyle(Color(red: 0.12, green: 0.12, blue: 0.12))
                        .background(Color.white, in: Capsule())
                        .overlay(Capsule().stroke(Color.tsLine, lineWidth: 0.7))
                    }
                    .buttonStyle(.plain)
                    .disabled(store.isWorking)
                    .accessibilityIdentifier("sign-in-with-google")
                }
                if store.challenge != nil {
                    SignInWithAppleButton(.continue) { request in
                        request.requestedScopes = [.fullName, .email]
                        request.nonce = store.challenge.map { SHA256.hex($0.nonce) }
                    } onCompletion: { result in
                        switch result {
                        case let .success(authorization):
                            guard let credential = authorization.credential
                                as? ASAuthorizationAppleIDCredential else {
                                store.notice = AppSessionError.invalidIdentityToken
                                    .localizedDescription
                                return
                            }
                            Task {
                                await store.signIn(
                                    identityToken: credential.identityToken,
                                    fullName: credential.fullName
                                )
                            }
                        case let .failure(error):
                            if (error as? ASAuthorizationError)?.code != .canceled {
                                store.notice = "Apple sign-in could not finish. Check your Apple Account in Settings, then try again."
                            }
                        }
                    }
                    .signInWithAppleButtonStyle(
                        colorScheme == .dark ? .white : .black
                    )
                    .frame(height: 52)
                    .clipShape(Capsule())
                    .disabled(store.isWorking)
                    .accessibilityIdentifier("sign-in-with-apple")
                } else {
                    Button {
                        Task { await store.prepareChallenge() }
                    } label: {
                        HStack {
                            if store.isWorking { ProgressView() }
                            Text(store.isWorking ? "Connecting…" : "Retry")
                                .font(.headline)
                        }
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.plain)
                    .disabled(store.isWorking || store.baseURL == nil)
                    .accessibilityIdentifier("retry-apple-challenge")
                }

                Button(appLanguage.text("Continue with email")) { showsEmail = true }
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .disabled(store.isWorking)
                    .accessibilityIdentifier("sign-in-with-email")

                if let notice = store.notice {
                    Text(appLanguage.text(notice))
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 14)
                        .accessibilityIdentifier("authentication-notice")
                }

                if store.needsSignOutRecovery {
                    Button(appLanguage.text("Sign-in & recovery")) { showsSignOutRecovery = true }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("login-ending-recovery")
                }
            }
        }
        .task {
            if store.phase == .signedOut, store.challenge == nil {
                await store.prepareChallenge()
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("authentication-screen")
        .sheet(isPresented: $showsEmail) { AuthenticationEmailView(store: store) }
        .sheet(isPresented: $showsSignOutRecovery) {
            NavigationStack {
                LabSessionEndingsView(store: store)
                    .toolbar { ToolbarItem(placement: .topBarTrailing) {
                        Button(appLanguage.text("Done")) { showsSignOutRecovery = false }
                    } }
            }
        }
    }
}
