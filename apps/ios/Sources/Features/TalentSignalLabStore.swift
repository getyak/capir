import Combine
import Foundation

enum TalentSignalLabLoadPhase: Equatable {
    case idle
    case loading
    case ready
    case unavailable(String?)
    case failed(String)
}

enum TalentSignalLabPendingOperation: String, Equatable {
    case manifest
    case session
    case run
    case comparison
    case receipt
    case promotion
}

@MainActor
final class TalentSignalLabStore: ObservableObject {
    @Published private(set) var phase: TalentSignalLabLoadPhase = .idle
    @Published private(set) var manifest: LabManifest?
    @Published private(set) var session: LabSession?
    @Published private(set) var run: LabRun?
    @Published private(set) var comparison: LabComparison?
    @Published private(set) var receipt: RealityReceipt?
    @Published private(set) var evalCase: LabEvalCase?
    @Published private(set) var pending: TalentSignalLabPendingOperation?
    @Published var errorMessage: String?

    private let service: TalentSignalLabServing?
    private var idempotencyKeys: [String: String] = [:]

    init(service: TalentSignalLabServing?) {
        self.service = service
    }

    var isEnabled: Bool {
        phase == .ready && manifest?.capability.enabled == true
    }

    var scenarios: [LabScenarioSummary] {
        manifest?.scenarios ?? []
    }

    var currentEnvelope: LabVersionEnvelope? {
        session?.activeEnvelope
    }

    var capsuleAccessibilityValue: String {
        guard let session else {
            return "FAT, no scenario selected, production isolated"
        }
        return [
            session.environment,
            session.testerIdentity,
            session.scenario.title,
            "Agent \(session.activeEnvelope.agentVersion)",
            "production isolated",
        ].joined(separator: ", ")
    }

    func load(force: Bool = false) async {
        guard let service else {
            phase = .unavailable(nil)
            return
        }
        guard force || phase == .idle || isFailurePhase else { return }
        pending = .manifest
        phase = .loading
        errorMessage = nil
        defer { pending = nil }
        do {
            let manifest = try await service.loadManifest()
            self.manifest = manifest
            guard manifest.capability.enabled else {
                session = nil
                run = nil
                phase = .unavailable(manifest.capability.reason)
                return
            }
            guard manifest.capability.internalBuildRequired,
                  manifest.capability.syntheticEvidenceOnly,
                  !manifest.capability.productionDataAccess,
                  !manifest.capability.canonicalWriteAccess,
                  !manifest.capability.externalEffectAccess else {
                throw TalentSignalLabStateError.capabilityBoundaryInvalid
            }
            session = manifest.activeSession
            run = manifest.latestRun
            comparison = nil
            receipt = nil
            evalCase = nil
            phase = .ready
        } catch is CancellationError {
            phase = .idle
        } catch {
            let message = error.localizedDescription
            errorMessage = message
            phase = .failed(message)
        }
    }

    func start(_ scenario: LabScenarioSummary) async {
        guard let service, isEnabled else { return }
        await perform(.session) {
            let operation = "start:\(scenario.id):\(scenario.revision)"
            let created = try await service.startSession(
                scenarioID: scenario.id,
                idempotencyKey: key(for: operation)
            )
            guard created.canonicalIsolation,
                  !created.productionDataAccess,
                  created.writeBoundary == "lab_only" else {
                throw TalentSignalLabStateError.isolationNotVerified
            }
            session = created
            run = nil
            comparison = nil
            receipt = nil
            evalCase = nil
            clearKey(for: operation)
        }
    }

    func replay(_ variant: LabRunVariant = .candidate) async {
        guard let service, let session, isEnabled else { return }
        await perform(.run) {
            let operation = "run:\(session.id):\(variant.rawValue)"
            let created = try await service.run(
                sessionID: session.id,
                variant: variant,
                idempotencyKey: key(for: operation)
            )
            try verifyZeroEffects(created.output)
            guard created.deterministic,
                  created.snapshotHash == session.scenario.snapshotHash,
                  created.canonicalRevisionBefore == created.canonicalRevisionAfter else {
                throw TalentSignalLabStateError.isolationNotVerified
            }
            run = created
            comparison = nil
            receipt = nil
            evalCase = nil
            clearKey(for: operation)
        }
    }

    func compare() async {
        guard let service, let session, isEnabled else { return }
        await perform(.comparison) {
            let operation = "compare:\(session.id)"
            let created = try await service.compare(
                sessionID: session.id,
                idempotencyKey: key(for: operation)
            )
            try verifyZeroEffects(created.baselineRun.output)
            try verifyZeroEffects(created.candidateRun.output)
            guard created.identicalSnapshot,
                  created.canonicalMutationCount == 0,
                  created.externalEffectCount == 0,
                  created.baselineRun.snapshotHash == session.scenario.snapshotHash,
                  created.candidateRun.snapshotHash == session.scenario.snapshotHash else {
                throw TalentSignalLabStateError.comparisonNotVerifiable
            }
            comparison = created
            run = created.candidateRun
            receipt = nil
            evalCase = nil
            clearKey(for: operation)
        }
    }

    func record() async {
        guard let service, let session, let run, isEnabled,
              run.sessionID == session.id else { return }
        await perform(.receipt) {
            let operation = "receipt:\(session.id):\(run.id)"
            let created = try await service.createReceipt(
                sessionID: session.id,
                runID: run.id,
                idempotencyKey: key(for: operation)
            )
            guard created.sessionID == session.id,
                  created.runID == run.id,
                  created.snapshotHash == run.snapshotHash,
                  created.outputHash == run.outputHash,
                  created.redactionApplied,
                  created.screenshotState == "redacted_surface_snapshot" else {
                throw TalentSignalLabStateError.receiptNotVerifiable
            }
            receipt = created
            evalCase = nil
            clearKey(for: operation)
        }
    }

    func promote() async {
        guard let service, let receipt, isEnabled else { return }
        await perform(.promotion) {
            let operation = "promote:\(receipt.id)"
            let created = try await service.promoteReceipt(
                receiptID: receipt.id,
                idempotencyKey: key(for: operation)
            )
            guard created.sourceReceiptID == receipt.id,
                  created.snapshotHash == receipt.snapshotHash,
                  created.adjudication == "human_gold",
                  created.releaseGate == "candidate_blocking" else {
                throw TalentSignalLabStateError.promotionNotVerifiable
            }
            evalCase = created
            clearKey(for: operation)
        }
    }

    func dismissError() {
        errorMessage = nil
    }

    private var isFailurePhase: Bool {
        if case .failed = phase { return true }
        return false
    }

    private func perform(
        _ operation: TalentSignalLabPendingOperation,
        body: () async throws -> Void
    ) async {
        guard pending == nil else { return }
        pending = operation
        errorMessage = nil
        defer { pending = nil }
        do {
            try await body()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func key(for operation: String) -> String {
        if let existing = idempotencyKeys[operation] { return existing }
        let created = "ios:lab:\(operation):\(UUID().uuidString.lowercased())"
        idempotencyKeys[operation] = created
        return created
    }

    private func clearKey(for operation: String) {
        idempotencyKeys[operation] = nil
    }

    private func verifyZeroEffects(_ output: LabScenarioOutput) throws {
        guard output.canonicalMutationCount == 0,
              output.externalEffectCount == 0 else {
            throw TalentSignalLabStateError.isolationNotVerified
        }
    }
}

enum TalentSignalLabStateError: LocalizedError, Equatable {
    case capabilityBoundaryInvalid
    case comparisonNotVerifiable
    case isolationNotVerified
    case promotionNotVerifiable
    case receiptNotVerifiable

    var errorDescription: String? {
        switch self {
        case .capabilityBoundaryInvalid:
            return "capri Lab stayed closed because this backend did not prove its synthetic-only, zero-write capability boundary."
        case .comparisonNotVerifiable:
            return "The comparison could not prove an identical frozen snapshot and zero effects."
        case .isolationNotVerified:
            return "The Lab operation was stopped because canonical isolation could not be verified."
        case .promotionNotVerifiable:
            return "The Eval promotion readback did not match this Reality Receipt."
        case .receiptNotVerifiable:
            return "The Reality Receipt readback did not match this persisted Lab Run."
        }
    }
}
