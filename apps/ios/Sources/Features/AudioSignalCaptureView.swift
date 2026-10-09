import AVFAudio
import SwiftUI
import UIKit

@MainActor
struct AudioSignalCaptureView: View {
    @StateObject private var store: AudioSignalCaptureStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var focusedField: AudioSignalField?
    let onDismiss: () -> Void

    init(runtimeScope: String? = nil, onDismiss: @escaping () -> Void = {}) {
        _store = StateObject(wrappedValue: AudioSignalCaptureStore(recorder: AudioSignalRecorder(
            directoryURL: runtimeScope.map { RuntimeScopedDirectories.directory("AudioSignalOutbox", scope: $0) })))
        self.onDismiss = onDismiss
    }

    init(
        store: AudioSignalCaptureStore,
        onDismiss: @escaping () -> Void = {}
    ) {
        _store = StateObject(wrappedValue: store)
        self.onDismiss = onDismiss
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    intro
                    purpose
                    authorization
                    if let notice = store.notice { interruptionNotice(notice) }
                    status
                    actions
                    privacyBoundary
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 24)
            }
            .background(Color.tsCanvas.ignoresSafeArea())
            .navigationTitle(appLanguage.text("Audio Signal"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        if store.isRecording { store.stop() }
                        onDismiss()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark").frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(appLanguage.text("Close audio Signal"))
                }
            }
        }
        .task { store.restore() }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                store.refreshPermissionStatus()
            } else {
                store.stopForForegroundLoss()
            }
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: AVAudioSession.interruptionNotification
            )
        ) { _ in
            store.stopForForegroundLoss()
        }
        .interactiveDismissDisabled(store.isRecording)
        .tint(.tsVermilion)
        .labDiagnosticPresentation()
        .accessibilityIdentifier("audio-signal-capture")
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(appLanguage.text("FOREGROUND ONLY"))
                .font(.caption.weight(.bold))
                .tracking(1.8)
                .foregroundStyle(Color.tsVermilion)
            Text(appLanguage.text("Record only after permission and authorization."))
                .font(.custom("Georgia", size: 34, relativeTo: .largeTitle))
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
            Text(
                appLanguage.text(
                    "Opening this page does not start the microphone. A visible recording state appears only after the audio session succeeds."
                )
            )
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var purpose: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(appLanguage.text("PURPOSE"))
                .font(.caption.weight(.bold))
                .tracking(1.6)
                .foregroundStyle(Color.tsVermilion)
            TextField(
                appLanguage.text("Why is this recording needed?"),
                text: $store.purpose,
                axis: .vertical
            )
                .textFieldStyle(.roundedBorder)
                .focused($focusedField, equals: .purpose)
                .disabled(store.isRecording)
                .accessibilityIdentifier("audio-signal-purpose")
        }
    }

    private var authorization: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(appLanguage.text("AUTHORIZING PARTY"))
                    .font(.caption.weight(.bold))
                    .tracking(1.2)
                    .foregroundStyle(Color.tsMutedInk)
                Spacer()
                if focusedField != nil {
                    Button(appLanguage.text("Done")) { focusedField = nil }
                        .font(.body.weight(.semibold))
                        .accessibilityIdentifier("dismiss-audio-signal-keyboard")
                }
            }
            TextField(
                appLanguage.text("Name or accountable party"),
                text: $store.authorizingParty,
                axis: .vertical
            )
            .textFieldStyle(.roundedBorder)
            .focused($focusedField, equals: .authorizingParty)
            .submitLabel(.next)
            .onSubmit { focusedField = .authorizationBasis }
            .disabled(store.isRecording)
            .accessibilityLabel(appLanguage.text("Who authorized this recording?"))
            .accessibilityIdentifier("audio-signal-authorizing-party")

            Text(appLanguage.text("AUTHORIZATION BASIS"))
                .font(.caption.weight(.bold))
                .tracking(1.2)
                .foregroundStyle(Color.tsMutedInk)
            TextField(
                appLanguage.text("For example, direct verbal permission"),
                text: $store.authorizationBasis,
                axis: .vertical
            )
            .textFieldStyle(.roundedBorder)
            .focused($focusedField, equals: .authorizationBasis)
            .submitLabel(.done)
            .onSubmit { focusedField = nil }
            .disabled(store.isRecording)
            .accessibilityLabel(appLanguage.text("Authorization basis"))
            .accessibilityIdentifier("audio-signal-authorization-basis")

            Toggle(isOn: $store.authorizationConfirmed) {
                Text(
                    appLanguage.text(
                        "I attest that this authorization covers the purpose above."
                    )
                )
                    .font(.subheadline)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .disabled(store.isRecording)
            .accessibilityIdentifier("audio-signal-authorization")
        }
    }

    @ViewBuilder
    private var status: some View {
        switch store.phase {
        case .idle:
            AudioSignalStatusCard(
                icon: "mic.slash",
                title: appLanguage.text("Not recording"),
                detail: appLanguage.text(
                    "No microphone session or local audio payload exists."
                )
            )
            .accessibilityIdentifier("audio-signal-idle")
        case .requestingPermission:
            AudioSignalStatusCard(
                icon: "hand.raised",
                title: appLanguage.text("Waiting for permission"),
                detail: appLanguage.text("Recording has not started.")
            )
            .accessibilityIdentifier("audio-signal-requesting-permission")
        case .preparing:
            AudioSignalStatusCard(
                icon: "waveform",
                title: appLanguage.text("Preparing microphone"),
                detail: appLanguage.text(
                    "Recording is not presented as active until the audio session succeeds."
                )
            )
            .accessibilityIdentifier("audio-signal-preparing")
        case let .recording(startedAt):
            VStack(alignment: .leading, spacing: 12) {
                Label(
                    appLanguage.text("Recording now"),
                    systemImage: "record.circle.fill"
                )
                    .font(.headline)
                    .foregroundStyle(Color.tsVermilion)
                Text(startedAt, style: .timer)
                    .font(.system(.title, design: .monospaced).weight(.medium))
                    .foregroundStyle(Color.tsInk)
                Text(
                    appLanguage.text(
                        "Keep capri in the foreground. Leaving the app stops and seals the local payload."
                    )
                )
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
            .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 18))
            .overlay { RoundedRectangle(cornerRadius: 18).stroke(Color.tsVermilion, lineWidth: 1) }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("audio-signal-recording")
        case let .saved(receipt):
            VStack(alignment: .leading, spacing: 10) {
                AudioSignalStatusCard(
                    icon: "checkmark.shield",
                    title: appLanguage.text("Saved only on this device"),
                    detail: "\(format(receipt.durationSeconds)) · \(receipt.byteCount) bytes · protected local payload · no upload"
                )
                Text(authorizationReceipt(receipt))
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("audio-signal-authorization-receipt")
            }
            .accessibilityIdentifier("audio-signal-saved-local")
        case let .failed(message):
            AudioSignalStatusCard(
                icon: "exclamationmark.triangle",
                title: appLanguage.text("Not recording"),
                detail: message
            )
            .accessibilityIdentifier("audio-signal-failed")
        case .deleting:
            AudioSignalStatusCard(
                icon: "trash",
                title: appLanguage.text("Deleting local payload"),
                detail: appLanguage.text(
                    "No upload or external write is being attempted."
                )
            )
        case .deleted:
            AudioSignalStatusCard(
                icon: "checkmark",
                title: appLanguage.text("Local recording deleted"),
                detail: appLanguage.text(
                    "The audio payload and its local metadata were removed."
                )
            )
            .accessibilityIdentifier("audio-signal-deleted")
        }
    }

    @ViewBuilder
    private var actions: some View {
        if store.isRecording {
            Button(appLanguage.text("Stop and save locally")) { store.stop() }
                .buttonStyle(TSPrimaryButtonStyle())
                .accessibilityIdentifier("stop-audio-signal")
        } else if case .saved = store.phase {
            Button(
                appLanguage.text("Revoke authorization and delete recording"),
                role: .destructive
            ) {
                store.delete()
            }
                .buttonStyle(TSSecondaryButtonStyle())
                .accessibilityIdentifier("delete-audio-signal")
        } else if case .deleting = store.phase {
            ProgressView().frame(maxWidth: .infinity, minHeight: 44)
        } else if store.microphonePermission == .denied {
            VStack(spacing: 10) {
                Button(appLanguage.text("Open Microphone Settings")) {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else {
                        return
                    }
                    openURL(url)
                }
                .buttonStyle(TSPrimaryButtonStyle())
                .accessibilityIdentifier("open-microphone-settings")

                Button(appLanguage.text("Check permission again")) {
                    store.refreshPermissionStatus()
                }
                .buttonStyle(TSSecondaryButtonStyle())
                .accessibilityIdentifier("refresh-microphone-permission")
            }
        } else {
            Button(
                appLanguage.text(
                    store.canStart
                        ? "Start foreground recording"
                        : "Review authorization to record"
                )
            ) {
                if let requirement = store.missingRequirement {
                    store.explainMissingRequirement()
                    focus(requirement)
                } else {
                    Task { await store.start(sceneIsActive: scenePhase == .active) }
                }
            }
            .buttonStyle(TSPrimaryButtonStyle())
            .accessibilityIdentifier("start-audio-signal")
        }
    }

    private var privacyBoundary: some View {
        Label(
            appLanguage.text(
                "Audio remains local and untranscribed. It creates no Proposal, confirmed state, message, meeting, or external write."
            ),
            systemImage: "lock.shield"
        )
        .font(.caption)
        .foregroundStyle(Color.tsMutedInk)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func interruptionNotice(_ value: String) -> some View {
        Text(appLanguage.text(value))
            .font(.subheadline)
            .foregroundStyle(Color.tsInk)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 14))
            .accessibilityIdentifier("audio-signal-interruption-notice")
    }

    private func format(_ duration: TimeInterval) -> String {
        let seconds = max(0, Int(duration.rounded()))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    private func authorizationReceipt(_ receipt: AudioSignalLocalReceipt) -> String {
        [
            "\(appLanguage.text("Authorized by")) \(receipt.authorization.authorizingParty)",
            "\(appLanguage.text("basis")): \(receipt.authorization.basis)",
            "\(appLanguage.text("scope")): \(receipt.authorization.scope)",
            "\(appLanguage.text("attested by")): \(receipt.authorization.attestedBy)",
            receipt.authorization.recordedAt.formatted(
                date: .abbreviated,
                time: .standard
            ),
        ].joined(separator: " · ")
    }

    private func focus(_ requirement: AudioSignalCaptureStore.MissingRequirement) {
        switch requirement {
        case .purpose:
            focusedField = .purpose
        case .authorizingParty:
            focusedField = .authorizingParty
        case .authorizationBasis:
            focusedField = .authorizationBasis
        case .authorizationAttestation:
            focusedField = nil
        }
    }
}

private enum AudioSignalField: Hashable {
    case purpose
    case authorizingParty
    case authorizationBasis
}

private struct AudioSignalStatusCard: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.title3.weight(.semibold))
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.headline)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .foregroundStyle(Color.tsInk)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).stroke(Color.tsLine, lineWidth: 1) }
        .accessibilityElement(children: .combine)
    }
}
