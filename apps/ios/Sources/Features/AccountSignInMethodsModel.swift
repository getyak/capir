import Foundation

/// The immutable identity of one async call's live session. Every request is
/// issued through a service built for THIS snapshot; no client survives a
/// URL/token/account/user change.
struct AccountOperationScope: Hashable, Sendable {
    var baseURL: URL
    var accessToken: String
    var accountID: String
    var userID: String
    private var family: String?

    init(baseURL: URL, accessToken: String, accountID: String, userID: String) {
        self.baseURL = baseURL; self.accessToken = accessToken
        self.accountID = accountID; self.userID = userID
        family = IOSSessionFamilyRegistry.shared.family(endpoint: baseURL, token: accessToken)
    }
    static func == (lhs: Self, rhs: Self) -> Bool {
        RuntimeEndpoint.same(lhs.baseURL, rhs.baseURL) && lhs.accountID == rhs.accountID && lhs.userID == rhs.userID
            && (lhs.family ?? lhs.accessToken) == (rhs.family ?? rhs.accessToken)
    }
    func hash(into hasher: inout Hasher) {
        hasher.combine(RuntimeEndpoint.scope(baseURL)); hasher.combine(accountID)
        hasher.combine(userID); hasher.combine(family ?? accessToken)
    }
}

/// The immutable context of one provider authorization round. The round is
/// returned by preparation and carried through the native authorization; a
/// result is accepted only with the exact round, scope and phase it belongs to.
struct ProviderRound: Equatable, Sendable {
    enum Purpose: Equatable, Sendable {
        case currentIdentity
        case targetProvider
    }
    var roundID: String
    var requestID: String
    var operationID: String
    var scope: AccountOperationScope
    var purpose: Purpose
    var provider: AccountLoginProvider
    var challengeID: String
    var nonce: String
}

/// Typed, non-secret reconciliation state for a dispatched mutation.
enum PendingOutcome: Equatable, Sendable {
    case credential(
        intent: AccountCredentialIntent,
        provider: AccountLoginProvider?,
        originalActor: AccountOperationActor,
        beforeRevision: Int,
        acknowledged: Bool
    )
    case revokeDevice(sessionID: String, originalActor: AccountOperationActor)

    var originalActor: AccountOperationActor {
        switch self {
        case let .credential(_, _, actor, _, _): return actor
        case let .revokeDevice(_, actor): return actor
        }
    }
}

enum AccountOperationError: Error, Equatable {
    case staleScope
    case invalidInput
    case operationReplaced
}

/// The Settings operation model the Settings view itself renders. The service
/// factory builds a REAL client per captured scope; every async continuation
/// revalidates scope, operation and request identity before it touches state.
@MainActor
final class AccountSignInMethodsModel: ObservableObject {
    typealias LiveSessionReader = () -> (baseURL: URL, accessToken: String, accountID: String, userID: String)?
    typealias ServiceFactory = (AccountOperationScope) -> AccountLoginMethodsServing
    typealias CurrentAuthorizer = (ProviderRound) async throws -> String

    @Published private(set) var snapshot: AccountCredentialsSnapshot?
    @Published private(set) var deviceSessions: [AccountDeviceSession] = []
    @Published private(set) var actor: AccountOperationActor?
    @Published private(set) var notice = ""
    @Published private(set) var failureNotice = ""
    @Published private(set) var working = false
    @Published private(set) var offline = false
    @Published private(set) var settingsLoadFailed = false
    @Published private(set) var outcomeUnknown = false
    @Published private(set) var pendingOutcome: PendingOutcome?
    @Published private(set) var activeIntent: AccountCredentialIntent?
    @Published private(set) var activeProvider: AccountLoginProvider?
    @Published private(set) var currentAuthProvider: AccountLoginProvider?
    @Published private(set) var awaitingNewPassword = false
    @Published private(set) var awaitingTargetProvider: AccountLoginProvider?
    @Published private(set) var currentRound: ProviderRound?
    @Published private(set) var challengeFailed = false

    private(set) var generation = 0
    private var operationID = UUID().uuidString
    private var requestSeq = 0
    private var reloadRequestID = UUID().uuidString
    private var pendingAttempt: (
        attempt: AccountCredentialAttempt,
        operationID: String,
        scope: AccountOperationScope,
        intent: AccountCredentialIntent,
        provider: AccountLoginProvider?
    )?
    private let serviceFactory: ServiceFactory
    private var liveSession: LiveSessionReader = { nil }

    init(
        serviceFactory: @escaping ServiceFactory,
        liveSession: @escaping LiveSessionReader = { nil }
    ) {
        self.serviceFactory = serviceFactory
        self.liveSession = liveSession
    }

    func attachLiveSession(_ reader: @escaping LiveSessionReader) {
        liveSession = reader
    }

    /// Production factory: a fresh REAL client bound to the exact scope.
    static func realServiceFactory(
        session: URLSession = TalentSignalNetworking.session
    ) -> ServiceFactory {
        { scope in
            AccountLoginMethodsClient(
                baseURL: scope.baseURL,
                bearerToken: scope.accessToken,
                session: session
            )
        }
    }

    private func currentScope() -> AccountOperationScope? {
        guard let live = liveSession() else { return nil }
        return AccountOperationScope(
            baseURL: live.baseURL,
            accessToken: live.accessToken,
            accountID: live.accountID,
            userID: live.userID
        )
    }

    private func nextRequestID() -> String {
        requestSeq += 1
        return "\(operationID)#\(requestSeq)"
    }

    /// After EVERY await (including nested helpers): the captured scope must
    /// still be the live identity and the operation must not have advanced.
    private func stillCurrent(
        scope: AccountOperationScope,
        operationID: String? = nil,
        requestID: String? = nil
    ) -> Bool {
        guard let live = currentScope(), live == scope else { return false }
        if let operationID, operationID != self.operationID { return false }
        if let requestID, requestID != self.currentRequestID { return false }
        return true
    }

    private var currentRequestID: String = ""

    /// Store phase/endpoint/token/account changes invalidate every in-flight
    /// callback and wipe per-operation state without deleting user data.
    func invalidate() {
        generation += 1
        operationID = UUID().uuidString
        reloadRequestID = UUID().uuidString
        currentRequestID = ""
        wipeOperationState()
        outcomeUnknown = false
        pendingOutcome = nil
        snapshot = nil
        actor = nil
        deviceSessions = []
        working = false
    }

    private func wipeOperationState() {
        pendingAttempt = nil
        awaitingNewPassword = false
        awaitingTargetProvider = nil
        currentRound = nil
        activeIntent = nil
        activeProvider = nil
        currentAuthProvider = nil
        challengeFailed = false
    }

    func reload() async {
        guard let scope = currentScope() else {
            failureNotice = "Settings need a signed-in session."
            return
        }
        let requestID = "reload-\(UUID().uuidString)"
        reloadRequestID = requestID
        currentRequestID = requestID
        working = true
        do {
            let service = serviceFactory(scope)
            let (fresh, sessions) = try await service.settings()
            // The response must describe the captured live account/user and
            // the newest reload before anything is published.
            guard reloadRequestID == requestID,
                  stillCurrent(scope: scope, requestID: requestID) else { return }
            guard fresh.account_id == scope.accountID,
                  fresh.user_id == scope.userID else {
                failureNotice = "The readback describes a different account. Nothing was applied here."
                settingsLoadFailed = true
                working = false
                return
            }
            self.snapshot = fresh
            self.deviceSessions = sessions
            self.actor = AccountOperationActor(
                accountID: fresh.account_id,
                userID: fresh.user_id,
                accountRevision: fresh.account_revision,
                userRevision: fresh.user_revision
            )
            self.settingsLoadFailed = false
            self.offline = false
            self.failureNotice = ""
            working = false
        } catch {
            guard reloadRequestID == requestID,
                  stillCurrent(scope: scope, requestID: requestID) else { return }
            self.offline = true
            self.settingsLoadFailed = true
            self.failureNotice = "Settings are temporarily unavailable."
            working = false
        }
    }

    /// Start an operation. The current-identity verification method is chosen
    /// EXPLICITLY by the caller; a password+Apple account can select either.
    func begin(
        intent: AccountCredentialIntent,
        provider: AccountLoginProvider?,
        currentAuthProvider: AccountLoginProvider
    ) async {
        guard !working, let scope = currentScope(), stillCurrent(scope: scope) else {
            failureNotice = "The account changed on this screen. Reload and start again."
            return
        }
        wipeOperationState()
        generation += 1
        operationID = UUID().uuidString
        reloadRequestID = UUID().uuidString
        currentRequestID = ""
        outcomeUnknown = false
        pendingOutcome = nil
        notice = ""
        failureNotice = ""
        activeIntent = intent
        activeProvider = provider
        self.currentAuthProvider = currentAuthProvider
    }

    func cancelOperation() {
        generation += 1
        operationID = UUID().uuidString
        currentRequestID = ""
        wipeOperationState()
        outcomeUnknown = false
        pendingOutcome = nil
        notice = "Cancelled. Nothing changed."
    }

    /// Explicit current-verification selection. Prepares that provider's
    /// challenge and RETURNS the exact round; callers never re-read global
    /// state after an await.
    @discardableResult
    func selectCurrentVerification(
        _ provider: AccountLoginProvider
    ) async -> ProviderRound? {
        guard provider != .password else { return nil }
        currentAuthProvider = provider
        challengeFailed = false
        return await prepareCurrentChallenge(provider: provider)
    }

    /// Prepare (or retry) a current-proof challenge for one provider. The
    /// returned round is the only authority for its authorization.
    @discardableResult
    func prepareCurrentChallenge(provider: AccountLoginProvider) async -> ProviderRound? {
        guard let scope = currentScope(), activeIntent != nil, awaitingTargetProvider == nil
        else { return nil }
        let operationID = self.operationID
        let requestID = nextRequestID()
        currentRequestID = requestID
        challengeFailed = false
        do {
            let service = serviceFactory(scope)
            let challenge = try await service.createChallenge(provider: provider)
            // A late challenge never lands on a newer request, a target stage
            // or a different chosen provider.
            guard stillCurrent(scope: scope, operationID: operationID, requestID: requestID),
                  activeIntent != nil,
                  awaitingTargetProvider == nil,
                  currentAuthProvider == provider else { return nil }
            let round = ProviderRound(
                roundID: UUID().uuidString,
                requestID: requestID,
                operationID: operationID,
                scope: scope,
                purpose: .currentIdentity,
                provider: provider,
                challengeID: challenge.challenge_id,
                nonce: challenge.nonce
            )
            currentRound = round
            return round
        } catch {
            guard stillCurrent(scope: scope, operationID: operationID, requestID: requestID) else {
                return nil
            }
            challengeFailed = true
            return nil
        }
    }

    /// The Google click: select Google, prepare the GOOGLE challenge and
    /// continue the authorization in that same click with the returned round.
    func beginGoogle(
        intent: AccountCredentialIntent,
        provider: AccountLoginProvider?,
        authorize: CurrentAuthorizer
    ) async {
        await begin(intent: intent, provider: provider, currentAuthProvider: .google)
        guard let round = await selectCurrentVerification(.google) else { return }
        do {
            let token = try await authorize(round)
            await acceptCurrentProof(round: round, identityToken: token)
        } catch {
            await failProof(round: round, cancelled: true)
        }
    }

    func beginGoogleTargetAuth(authorize: CurrentAuthorizer) async {
        guard let round = currentRound, round.purpose == .targetProvider,
              round.provider == .google else { return }
        do {
            let token = try await authorize(round)
            await acceptTargetProof(round: round, identityToken: token)
        } catch {
            await failProof(round: round, cancelled: true)
        }
    }

    private func roundIsCurrent(_ round: ProviderRound) -> Bool {
        guard let current = currentRound, current == round,
              round.operationID == operationID,
              round.requestID == currentRequestID,
              let live = currentScope(), live == round.scope else { return false }
        switch round.purpose {
        case .currentIdentity:
            return awaitingTargetProvider == nil && activeIntent != nil
                && currentAuthProvider == round.provider
        case .targetProvider:
            return awaitingTargetProvider == round.provider
        }
    }

    func acceptCurrentProof(round: ProviderRound, identityToken: String) async {
        guard roundIsCurrent(round), !identityToken.isEmpty else { return }
        // Consuming a current round retires it before the stage advances.
        currentRound = nil
        await startChange(
            stepUp: .linkedProvider(
                provider: round.provider,
                challengeID: round.challengeID,
                identityToken: identityToken
            ),
            round: round
        )
    }

    func failProof(round: ProviderRound, cancelled: Bool) async {
        guard roundIsCurrent(round) else { return }
        if cancelled {
            notice = "Cancelled. Nothing changed."
            generation += 1
            operationID = UUID().uuidString
            currentRequestID = ""
            wipeOperationState()
            outcomeUnknown = false
            pendingOutcome = nil
        }
    }

    func startWithPasswordProof(_ password: String) async {
        await startChange(stepUp: .password(password), round: nil)
    }

    private func startChange(stepUp: AccountStepUpProof, round: ProviderRound?) async {
        guard let scope = currentScope(), let intent = activeIntent,
              let snapshot,
              stillCurrent(scope: scope) else {
            failureNotice = "The account changed on this screen. Nothing was modified."
            return
        }
        let provider = activeProvider
        let operationID = self.operationID
        let requestID = nextRequestID()
        currentRequestID = requestID
        working = true
        do {
            let service = serviceFactory(scope)
            let attempt = try await service.startChange(
                intent: intent,
                provider: (intent == .linkProvider || intent == .unlinkProvider) ? provider : nil,
                stepUp: stepUp,
                clientLabel: "ios",
                expectedAccountRevision: snapshot.account_revision,
                expectedUserRevision: snapshot.user_revision
            )
            guard stillCurrent(scope: scope, operationID: operationID, requestID: requestID) else {
                return
            }
            pendingAttempt = (attempt, operationID, scope, intent, provider)
            if intent == .setPassword || intent == .changePassword {
                awaitingNewPassword = true
            } else if intent == .linkProvider, let provider = provider ?? attempt.provider,
                      let challenge = attempt.providerChallenge {
                awaitingTargetProvider = provider
                currentRound = ProviderRound(
                    roundID: UUID().uuidString,
                    requestID: requestID,
                    operationID: operationID,
                    scope: scope,
                    purpose: .targetProvider,
                    provider: provider,
                    challengeID: challenge.challenge_id,
                    nonce: challenge.nonce
                )
            } else {
                await complete(identityToken: nil, password: nil, round: round)
                return // The nested request owns its own busy state.
            }
            if stillCurrent(scope: scope, operationID: operationID, requestID: requestID) { working = false }
        } catch {
            guard stillCurrent(scope: scope, operationID: operationID, requestID: requestID) else {
                return
            }
            handleRejected(error)
            working = false
        }
    }

    func finishWithPassword(_ password: String) async {
        await complete(identityToken: nil, password: password, round: nil)
    }

    func acceptTargetProof(round: ProviderRound, identityToken: String) async {
        guard roundIsCurrent(round), !identityToken.isEmpty else { return }
        currentRound = nil
        await complete(identityToken: identityToken, password: nil, round: round)
    }

    private func complete(identityToken: String?, password: String?, round: ProviderRound?) async {
        guard let pending = pendingAttempt,
              pending.operationID == operationID,
              pending.intent == activeIntent,
              (pending.provider == activeProvider || activeProvider == nil),
              let live = currentScope(), live == pending.scope else {
            failureNotice = "This form belongs to another operation. Nothing was modified."
            wipeOperationState()
            return
        }
        let scope = pending.scope
        let operationID = self.operationID
        let requestID = nextRequestID()
        currentRequestID = requestID
        let intended = pending.intent
        let targetProvider = pending.provider
        let beforeRevision = snapshot?.account_revision ?? 0
        guard let actor else { return }
        working = true
        do {
            let service = serviceFactory(scope)
            let (status, _) = try await service.completeChange(
                attemptID: pending.attempt.attempt_id,
                attemptSecret: pending.attempt.attempt_secret,
                password: password,
                identityToken: identityToken
            )
            guard stillCurrent(scope: scope, operationID: operationID, requestID: requestID) else {
                return
            }
            self.pendingAttempt = nil
            awaitingNewPassword = false
            awaitingTargetProvider = nil
            await confirmOutcome(
                status: status,
                intended: intended,
                targetProvider: targetProvider,
                originalActor: actor,
                beforeRevision: beforeRevision,
                scope: scope,
                requestID: requestID
            )
            if stillCurrent(scope: scope, operationID: operationID, requestID: requestID) { working = false }
        } catch {
            guard stillCurrent(scope: scope, operationID: operationID, requestID: requestID) else {
                return
            }
            self.pendingAttempt = nil
            awaitingNewPassword = false
            awaitingTargetProvider = nil
            switch error as? AccountLoginMethodsError {
            case .stepUpFailed, .lastLoginMethod, .attemptInvalid, .emailOwnershipUnresolved, .invalidInput:
                handleRejected(error)
            default:
                outcomeUnknown = true
                pendingOutcome = .credential(
                    intent: intended,
                    provider: targetProvider,
                    originalActor: actor,
                    beforeRevision: beforeRevision,
                    acknowledged: false
                )
                activeIntent = nil
                failureNotice = "The result is not yet confirmed. Use \"Check result again\"; the write was not repeated."
            }
            working = false
        }
    }

    private func handleRejected(_ error: Error) {
        switch error as? AccountLoginMethodsError {
        case .stepUpFailed:
            failureNotice = "Current identity could not be verified. Try again."
        case .lastLoginMethod:
            failureNotice = "Keep at least one sign-in method. Set another one first."
        case .attemptInvalid:
            failureNotice = "This change expired or changed. Start again from Settings."
        case .emailOwnershipUnresolved:
            failureNotice = "This email has a historical conflict. Resolve it first."
        case .invalidInput:
            failureNotice = "This request was rejected as invalid and no change was written."
        case .deliveryUnavailable:
            failureNotice = "Verification email is temporarily unavailable. No account was created."
        default:
            failureNotice = "This change did not complete. Your account was not modified."
        }
        wipeOperationState()
    }

    private func confirmOutcome(
        status: String,
        intended: AccountCredentialIntent,
        targetProvider: AccountLoginProvider?,
        originalActor: AccountOperationActor,
        beforeRevision: Int,
        scope: AccountOperationScope,
        requestID: String
    ) async {
        do {
            let service = serviceFactory(scope)
            let (fresh, sessions) = try await service.settings()
            guard stillCurrent(scope: scope, requestID: requestID) else { return }
            if fresh.account_id != originalActor.accountID || fresh.user_id != originalActor.userID {
                outcomeUnknown = true
                pendingOutcome = .credential(
                    intent: intended,
                    provider: targetProvider,
                    originalActor: originalActor,
                    beforeRevision: beforeRevision,
                    acknowledged: true
                )
                activeIntent = nil
                failureNotice = "The readback describes a different account. Nothing was applied here."
                return
            }
            self.snapshot = fresh
            self.deviceSessions = sessions
            self.actor = AccountOperationActor(
                accountID: fresh.account_id,
                userID: fresh.user_id,
                accountRevision: fresh.account_revision,
                userRevision: fresh.user_revision
            )
            activeIntent = nil
            let verified: Bool
            switch intended {
            case .linkProvider:
                verified = targetProvider.map { fresh.method($0)?.state == .connected } ?? false
            case .unlinkProvider:
                verified = targetProvider.map { fresh.method($0)?.state == .connected } == false
                    && !fresh.connectedProviders.isEmpty
            case .setPassword, .changePassword:
                verified = status == "password_set"
                    && fresh.method(.password)?.state == .connected
            }
            if verified {
                pendingOutcome = nil
                outcomeUnknown = false
                notice = "Saved and verified."
            } else {
                outcomeUnknown = true
                pendingOutcome = .credential(
                    intent: intended,
                    provider: targetProvider,
                    originalActor: originalActor,
                    beforeRevision: beforeRevision,
                    acknowledged: status == "password_set"
                )
                notice = "The operation finished, but the intended method state is not confirmed. Review the rows above."
            }
        } catch {
            guard stillCurrent(scope: scope, requestID: requestID) else { return }
            activeIntent = nil
            outcomeUnknown = true
            pendingOutcome = .credential(
                intent: intended,
                provider: targetProvider,
                originalActor: originalActor,
                beforeRevision: beforeRevision,
                acknowledged: status == "password_set"
            )
            failureNotice = "The write completed but its result is awaiting confirmation. Use \"Check result again\"; nothing was written twice."
        }
    }

    /// Read-only reconciliation: the mutation is never repeated.
    func checkResultAgain() async {
        guard let outcome = pendingOutcome, let scope = currentScope() else { return }
        let requestID = nextRequestID()
        currentRequestID = requestID
        let originalActor = outcome.originalActor
        working = true
        do {
            let service = serviceFactory(scope)
            let (fresh, sessions) = try await service.settings()
            guard stillCurrent(scope: scope, requestID: requestID) else { return }
            if fresh.account_id != originalActor.accountID || fresh.user_id != originalActor.userID {
                failureNotice = "The readback describes a different account. The result is still unknown."
                working = false
                return
            }
            self.snapshot = fresh
            self.deviceSessions = sessions
            self.actor = AccountOperationActor(
                accountID: fresh.account_id,
                userID: fresh.user_id,
                accountRevision: fresh.account_revision,
                userRevision: fresh.user_revision
            )
            let confirmed: Bool
            switch outcome {
            case let .credential(intent, provider, _, _, acknowledged):
                switch intent {
                case .linkProvider:
                    confirmed = provider.map { fresh.method($0)?.state == .connected } ?? false
                case .unlinkProvider:
                    confirmed = provider.map { fresh.method($0)?.state == .connected } == false
                case .setPassword, .changePassword:
                    confirmed = acknowledged && fresh.method(.password)?.state == .connected
                }
            case let .revokeDevice(sessionID, _):
                confirmed = !deviceSessions.contains(where: { $0.id == sessionID })
                    && !sessions.contains(where: { $0.id == sessionID })
            }
            self.deviceSessions = sessions
            if confirmed {
                outcomeUnknown = false
                pendingOutcome = nil
                failureNotice = ""
                notice = "Checked: the intended change is present in the current account state."
            } else {
                outcomeUnknown = true
                notice = "Checked: the intended change is NOT confirmed in the current account state. Review before retrying."
            }
            working = false
        } catch {
            guard stillCurrent(scope: scope, requestID: requestID) else { return }
            failureNotice = "The result is still unknown; the readback failed. Try checking again."
            working = false
        }
    }

    func revokeDevice(_ id: String) async {
        guard let scope = currentScope(), let snapshot, let actor,
              stillCurrent(scope: scope) else { return }
        let requestID = nextRequestID()
        currentRequestID = requestID
        working = true
        do {
            let service = serviceFactory(scope)
            let (fresh, sessions) = try await service.revokeDeviceSession(
                id: id,
                expectedAccountRevision: snapshot.account_revision
            )
            guard stillCurrent(scope: scope, requestID: requestID) else { return }
            guard fresh.account_id == scope.accountID, fresh.user_id == scope.userID else {
                outcomeUnknown = true
                pendingOutcome = .revokeDevice(sessionID: id, originalActor: actor)
                failureNotice = "The readback describes a different account. Check the result again."
                working = false
                return
            }
            self.snapshot = fresh
            self.deviceSessions = sessions
            notice = sessions.contains(where: { $0.id == id })
                ? "The device is still listed. Review before retrying."
                : "Saved and verified."
            working = false
        } catch {
            guard stillCurrent(scope: scope, requestID: requestID) else { return }
            outcomeUnknown = true
            pendingOutcome = .revokeDevice(sessionID: id, originalActor: actor)
            failureNotice = "The revocation result is not yet confirmed. Use \"Check result again\"; it was not repeated."
            working = false
        }
    }
}
