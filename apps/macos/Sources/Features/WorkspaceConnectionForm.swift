import AppKit
import SwiftUI

struct WorkspaceConnectionForm: View {
    enum Mode {
        case firstRun
        case settings
    }

    var mode: Mode = .settings
    var isActive = true
    var onConnected: () -> Void
    @ObservedObject private var connection = WorkspaceConnection.shared
    @State private var address = ""
    @State private var localDevelopment = false
    @State private var advanced = false
    @State private var result: ConnectionProbeResult?
    @State private var probing = false
    @State private var probeID = UUID()
    @State private var probeTask: Task<Void, Never>?
    @State private var error: String?
    @State private var confirmSwitch = false
    @State private var copied = false
    @FocusState private var addressFocused: Bool

    private var isFirstRun: Bool { mode == .firstRun }
    private var parsed: WorkspaceOrigin? { WorkspaceConnection.parseInput(address, allowLocalDevelopment: localDevelopment) }
    private var trimmedAddress: String { address.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.bottom, isFirstRun ? 32 : 24)

            Text(String(localized: "Workspace Address", bundle: .main))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(TSBrand.ink)

            TextField("https://workspace.example.com", text: $address)
                .textFieldStyle(.plain)
                .font(.body)
                .foregroundStyle(TSBrand.ink)
                .padding(.horizontal, 12)
                .padding(.vertical, 11)
                .background(TSBrand.raisedSurface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(TSBrand.hairline.opacity(0.9), lineWidth: 1)
                }
                .accessibilityIdentifier("connection.address")
                .focused($addressFocused)
                .onSubmit { requestSave() }
                .padding(.top, 8)

            if let parsed, parsed.url.absoluteString != trimmedAddress {
                Text(String(format: String(localized: "Will use: %@", bundle: .main), parsed.url.absoluteString))
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .textSelection(.enabled)
                    .padding(.top, 8)
            } else if isFirstRun {
                Text(String(localized: "Paste a full workspace link. HTTPS only, without an account or password.", bundle: .main))
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .padding(.top, 8)
            }

            if parsed != nil {
                Button(action: testConnection) {
                    HStack(spacing: 5) {
                        if probing {
                            ProgressView().controlSize(.mini)
                                .accessibilityLabel(String(localized: "Checking connection", bundle: .main))
                        }
                        Text(probing ? String(localized: "Checking…", bundle: .main) : (isFirstRun ? String(localized: "Test Connection First", bundle: .main) : String(localized: "Test Connection", bundle: .main)))
                            .underline(!probing, color: TSBrand.hairline)
                    }
                    .font(.subheadline.weight(.medium))
                }
                .buttonStyle(.plain)
                .foregroundStyle(TSBrand.ink.opacity(0.72))
                .disabled(probing)
                .padding(.top, 6)
                .accessibilityIdentifier("connection.test")
                .accessibilityHint(String(localized: "Optional: check whether the service is reachable before opening the workspace.", bundle: .main))
            }

            if let error {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(TSBrand.seam)
                    .padding(.top, 14)
                    .fixedSize(horizontal: false, vertical: true)
            } else if !trimmedAddress.isEmpty && parsed == nil {
                Text(isFirstRun ? String(localized: "An HTTPS workspace address is required.", bundle: .main) : String(localized: "Enter an HTTPS workspace address.", bundle: .main))
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .padding(.top, 12)
            }

            if let result {
                probeResult(result)
                    .padding(.top, 14)
            }

            HStack {
                Spacer(minLength: 0)
                saveButton
                    .disabled(parsed == nil)
                    .accessibilityIdentifier("connection.save")
            }
            .padding(.top, 22)

            if isFirstRun {
                Text(String(localized: "Private workspaces require Tailscale first. Get the address from the workspace owner.", bundle: .main))
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .padding(.top, 18)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                advancedBlock
                    .padding(.top, 28)
            }
        }
        .padding(isFirstRun ? 0 : 4)
        .disabled(!isActive)
        .onAppear {
            address = connection.origin?.url.absoluteString ?? ""
            localDevelopment = connection.allowsLocalDevelopment
        }
        .onChange(of: address) { _, _ in invalidateProbe() }
        .onChange(of: localDevelopment) { _, _ in invalidateProbe() }
        .onChange(of: isActive) { _, active in
            if !active {
                addressFocused = false
                invalidateProbe()
            }
        }
        .onDisappear { invalidateProbe() }
        .confirmationDialog(String(localized: "Switch workspace service?", bundle: .main), isPresented: $confirmSwitch, titleVisibility: .visible) {
            Button(String(localized: "Switch and Reload", bundle: .main)) { save() }
            Button(String(localized: "Cancel", bundle: .main), role: .cancel) {}
        } message: {
            Text(String(format: String(localized: "Finish current input or uploads first. %@ will open; sign-in to the existing service will be kept.", bundle: .main), parsed?.url.absoluteString ?? ""))
        }
    }

    @ViewBuilder private var saveButton: some View {
        if isFirstRun {
            Button(String(localized: "Open workspace", bundle: .main), action: requestSave)
                .buttonStyle(FirstRunPrimaryButtonStyle())
        } else {
            Button(String(localized: "Save Connection", bundle: .main), action: requestSave)
                .buttonStyle(TSPrimaryButtonStyle())
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            if isFirstRun {
                HStack(alignment: .center, spacing: 12) {
                    TSBrandMark(size: 28)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("capri")
                    Text(String(localized: "Connect to your workspace", bundle: .main))
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(TSBrand.ink)
                        .tracking(-0.3)
                }
            } else {
                Text(String(localized: "Connection and Debugging", bundle: .main))
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(TSBrand.ink)
                    .tracking(-0.25)
            }
            Text(isFirstRun ? String(localized: "Continue the same conversations, people, and schedule on this Mac.", bundle: .main) : String(localized: "View or change the workspace service connected to this Mac.", bundle: .main))
                .font(.body)
                .foregroundStyle(TSBrand.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, isFirstRun ? 40 : 0)
        }
    }

    private func probeResult(_ result: ConnectionProbeResult) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: result.reachable ? "checkmark.circle" : "exclamationmark.circle")
                .foregroundStyle(result.reachable ? TSBrand.evidence : TSBrand.seam)
                .font(.body)
            VStack(alignment: .leading, spacing: 4) {
                Text(result.summary)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(TSBrand.ink)
                Text(result.detail)
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            result.reachable ? TSBrand.evidenceTint : TSBrand.seamTint,
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("connection.result")
    }

    private var advancedBlock: some View {
        DisclosureGroup(isExpanded: $advanced) {
            VStack(alignment: .leading, spacing: 12) {
                Toggle(String(localized: "Allow local development services", bundle: .main), isOn: $localDevelopment)
                Text(String(localized: "HTTP is allowed only for localhost, 127.0.0.1, or ::1; remote services always use HTTPS.", bundle: .main))
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                Button(String(localized: "Fill Local Development Address", bundle: .main)) {
                    localDevelopment = true
                    address = "http://127.0.0.1:3000"
                }
                Toggle(String(localized: "Enable Web Inspector", bundle: .main), isOn: $connection.inspectorEnabled)
                Text(String(localized: "When enabled, inspect this window from Safari’s Develop menu. Enable only for debugging.", bundle: .main))
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                HStack {
                    Text(String(format: String(localized: "Client %@", bundle: .main), DesktopUpdater.shared.appVersion))
                        .font(.caption)
                        .foregroundStyle(TSBrand.secondaryInk)
                    Spacer()
                    Button(String(localized: "Copy Diagnostic Summary", bundle: .main)) {
                        let summary = "capri \(DesktopUpdater.shared.appVersion)\nmacOS \(ProcessInfo.processInfo.operatingSystemVersionString)\nConnection: \(result?.summary ?? "Not checked")\n\(result?.detail ?? "")\nLocal development: \(localDevelopment)\nInspector: \(connection.inspectorEnabled)\nWorkspace address, cookies and content omitted."
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(summary, forType: .string)
                        copied = true
                    }
                }
                if copied {
                    Text(String(localized: "Copied · The summary omits service addresses, accounts, credentials, and conversation content.", bundle: .main))
                        .font(.caption)
                        .foregroundStyle(TSBrand.secondaryInk)
                }
                Text(String(localized: "Switching services reloads the page. Sign-in states are saved separately for each service.", bundle: .main))
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
            }
            .padding(.top, 14)
            .padding(.horizontal, 4)
        } label: {
            Text(String(localized: "Development and Diagnostics", bundle: .main))
                .font(.callout.weight(.medium))
                .foregroundStyle(TSBrand.secondaryInk)
        }
        .font(.callout)
        .tsSurface()
        .padding(.horizontal, 2)
    }

    private func invalidateProbe() {
        probeTask?.cancel(); probeTask = nil
        probeID = UUID(); probing = false; result = nil; error = nil; copied = false
    }

    private func testConnection() {
        guard isActive, let origin = parsed else { return }
        invalidateProbe(); probing = true
        let id = probeID
        probeTask = Task {
            let observed = await WorkspaceConnectionProbe(origin: origin).run()
            guard !Task.isCancelled, probeID == id else { return }
            result = observed; probing = false
        }
    }

    private func requestSave() {
        guard isActive else { return }
        guard parsed != nil else {
            error = String(localized: "Enter an HTTPS workspace address.", bundle: .main)
            return
        }
        if let current = connection.origin, let parsed, current != parsed { confirmSwitch = true }
        else { save() }
    }

    private func save() {
        guard isActive else { return }
        guard connection.save(address, allowLocalDevelopment: localDevelopment) else { return }
        onConnected()
    }
}
