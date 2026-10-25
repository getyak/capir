import Foundation

@MainActor
final class LabResetExecutor: LabResetExecuting {
    private let session: AppSessionStore?
    private let display: LabDisplayStore?
    private let diagnostics: LabDiagnosticsStore
    private let metrics: LabMetricKitStore
    private let onboarding: any StandaloneOnboardingPersisting
    private let device: DeviceLabStore
    private let refreshWorkspace: (() async -> Bool)?
    init(session: AppSessionStore?, display: LabDisplayStore?, device: DeviceLabStore? = nil,
         diagnostics: LabDiagnosticsStore? = nil, metrics: LabMetricKitStore? = nil,
         onboarding: any StandaloneOnboardingPersisting = FileStandaloneOnboardingStore(), refreshWorkspace: (() async -> Bool)? = nil) {
        self.session = session; self.display = display; self.device = device ?? DeviceLabStore()
        self.diagnostics = diagnostics ?? .shared; self.metrics = metrics ?? .shared; self.onboarding = onboarding; self.refreshWorkspace = refreshWorkspace
    }
    var context: LabResetContext {
        let endpoint = session?.baseURL.map { RuntimeEndpoint.scope($0) } ?? "local"
        let demoTarget = try? LabDemoReset.target(onboarding.load())
        if case let .signedIn(current) = session?.phase {
            return .init(endpointScope: endpoint, ownerScope: RuntimeEndpoint.scope(current.baseURL, accountID: current.account.id, userID: current.user.id), credentialFingerprint: AppSessionEnding.fingerprint(current), demoTarget: demoTarget)
        }
        return .init(endpointScope: endpoint, ownerScope: "signed-out", credentialFingerprint: nil, demoTarget: demoTarget)
    }
    func permits(_ operation: LabResetOperation, action: LabResetAction) -> Bool {
        guard context.endpointScope == operation.context.endpointScope else { return false }
        // An old sign-out retries its exact fingerprint and preserves a newer
        // sign-in. Other pending device steps require the original account.
        if action == .signOut { return operation.context.credentialFingerprint != nil && session != nil }
        return context.ownerScope == operation.context.ownerScope
    }
    func perform(_ action: LabResetAction, operation: LabResetOperation) async throws -> LabResetStepResult {
        guard permits(operation, action: action) else { throw LabResetError.contextChanged }
        if action == .signOut {
            guard let session, let fingerprint = operation.context.credentialFingerprint else { throw LabResetError.unavailable }
            let result = await session.finishResetSignOut(fingerprint: fingerprint)
            return .init(verified: result?.settled == true, receiptID: result?.id)
        }
        let registry = RuntimeWorkRegistry.shared, permit = try registry.beginMaintenance()
        defer { registry.endMaintenance(permit) }
        switch action {
        case .networkCache:
            await device.clearCache()
            return .init(verified: device.cacheAfterClear == 0, remainingCacheBytes: device.cacheAfterClear)
        case .display:
            guard let display else { throw LabResetError.unavailable }
            return .init(verified: display.restoreDefaults())
        case .diagnostics:
            guard diagnostics.isEnabled, metrics.enabled else { throw LabResetError.unavailable }
            diagnostics.stop(); diagnostics.clear(); metrics.clear()
            return .init(verified: diagnostics.error == nil && diagnostics.reports.isEmpty && metrics.error == nil && metrics.records.isEmpty)
        case .onboarding:
            guard var state = try onboarding.load() else { return .init(verified: true) }
            guard state.version == StandaloneOnboardingState.flowVersion else { throw LabResetError.unavailable }
            state.replayOnboarding()
            try onboarding.save(state)
            guard try onboarding.load() == state else { throw LabResetError.verification }
            return .init(verified: true)
        case .workspace:
            guard let refreshWorkspace else { throw LabResetError.unavailable }
            let permission = session?.currentSession.flatMap { RuntimePersistentRenewalPermission(owner: permit, session: $0) }
            return await RuntimeMaintenanceContext.$persistentRenewal.withValue(permission) {
                .init(verified: await refreshWorkspace())
            }
        case .demo:
            return try LabDemoReset.perform(operation: operation, persistence: onboarding)
        case .signOut: throw LabResetError.unavailable
        }
    }
}
