import Foundation

@MainActor
final class AudioSignalCaptureStore: ObservableObject {
    enum MissingRequirement: Equatable {
        case purpose
        case authorizingParty
        case authorizationBasis
        case authorizationAttestation
    }

    enum Phase: Equatable {
        case idle
        case requestingPermission
        case preparing
        case recording(startedAt: Date)
        case saved(AudioSignalLocalReceipt)
        case failed(String)
        case deleting
        case deleted
    }

    @Published var purpose = "Preserve an authorized conversation moment for your review"
    @Published var authorizationBasis = ""
    @Published var authorizingParty = ""
    @Published var authorizationConfirmed = false
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var notice: String?
    @Published private(set) var microphonePermission: AudioSignalPermission

    private let recorder: AudioSignalRecordingServing
    private var activeID = UUID()

    init(recorder: AudioSignalRecordingServing) {
        self.recorder = recorder
        microphonePermission = recorder.permissionStatus()
    }

    convenience init() {
        self.init(recorder: AudioSignalRecorder())
    }

    var canStart: Bool {
        guard missingRequirement == nil else {
            return false
        }
        switch phase {
        case .idle, .failed, .deleted: return true
        default: return false
        }
    }

    var missingRequirement: MissingRequirement? {
        if purpose.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .purpose
        }
        if authorizingParty.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .authorizingParty
        }
        if authorizationBasis.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .authorizationBasis
        }
        if !authorizationConfirmed {
            return .authorizationAttestation
        }
        return nil
    }

    var isRecording: Bool {
        if case .recording = phase { return true }
        return false
    }

    func restore() {
        guard phase == .idle else { return }
        refreshPermissionStatus()
        do {
            if let receipt = try recorder.latestReceipt() {
                phase = .saved(receipt)
            }
        } catch {
            phase = .failed("Local recording metadata could not be verified: \(error.localizedDescription)")
        }
    }

    func refreshPermissionStatus() {
        microphonePermission = recorder.permissionStatus()
    }

    func explainMissingRequirement() {
        guard let missingRequirement else {
            notice = nil
            return
        }
        switch missingRequirement {
        case .purpose:
            notice = "Add the purpose for this recording before the microphone starts."
        case .authorizingParty:
            notice = "Name the person or accountable party who authorized this recording."
        case .authorizationBasis:
            notice = "Record how authorization was given, such as direct verbal permission."
        case .authorizationAttestation:
            notice = "Confirm that the recorded authorization covers the purpose above."
        }
    }

    func start(sceneIsActive: Bool) async {
        await LabClientDiagnostics.observe(.audioSessionPreparation) {
            await self.startRecorded(sceneIsActive: sceneIsActive)
        }
    }

    private func startRecorded(sceneIsActive: Bool) async -> LabClientSpan.Outcome {
        guard canStart else {
            explainMissingRequirement()
            return .skipped
        }
        guard sceneIsActive else {
            phase = .failed("Open capri in the foreground before recording. No recording started.")
            return .skipped
        }
        notice = nil
        var permission = recorder.permissionStatus()
        if permission == .undetermined {
            phase = .requestingPermission
            permission = await recorder.requestPermission()
        }
        microphonePermission = permission
        guard permission == .granted else {
            phase = .failed("Microphone permission was not granted. No recording started.")
            return .failed
        }
        phase = .preparing
        do {
            activeID = UUID()
            try recorder.start(
                recordID: activeID,
                purpose: purpose.trimmingCharacters(in: .whitespacesAndNewlines),
                authorization: .init(
                    basis: authorizationBasis.trimmingCharacters(in: .whitespacesAndNewlines),
                    authorizingParty: authorizingParty.trimmingCharacters(in: .whitespacesAndNewlines),
                    attestedBy: "Current local user",
                    scope: purpose.trimmingCharacters(in: .whitespacesAndNewlines),
                    recordedAt: Date()
                )
            )
            phase = .recording(startedAt: Date())
            return .completed
        } catch {
            try? recorder.discardActiveRecording()
            phase = .failed(error.localizedDescription)
            return LabClientDiagnostics.failure(error)
        }
    }

    func stop() {
        guard isRecording else { return }
        LabClientDiagnostics.observeSync(.audioPayloadFinalization) {
            do {
                phase = .saved(try recorder.stop())
                return .completed
            } catch {
                try? recorder.discardActiveRecording()
                phase = .failed("Recording stopped without a durable receipt: \(error.localizedDescription)")
                return LabClientDiagnostics.failure(error)
            }
        }
    }

    func stopForForegroundLoss() {
        guard isRecording else { return }
        LabClientDiagnostics.observeSync(.audioPayloadFinalization) {
            do {
                let receipt = try recorder.stop()
                notice = "Recording stopped because capri left the foreground. The completed local payload is recoverable."
                phase = .saved(receipt)
                return .completed
            } catch {
                try? recorder.discardActiveRecording()
                phase = .failed("The foreground recording was interrupted and no verified payload was saved.")
                return LabClientDiagnostics.failure(error)
            }
        }
    }

    func delete() {
        guard case let .saved(receipt) = phase else { return }
        phase = .deleting
        do {
            try recorder.delete(receipt)
            purpose = "Preserve an authorized conversation moment for your review"
            authorizationBasis = ""
            authorizingParty = ""
            authorizationConfirmed = false
            refreshPermissionStatus()
            notice = nil
            phase = .deleted
        } catch {
            phase = .failed("The local recording was not deleted: \(error.localizedDescription)")
        }
    }
}
