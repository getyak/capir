import AuthenticationServices
import CryptoKit
import SwiftUI

/// The trusted Web settings origin for authenticated account recovery.
/// It decodes the BUNDLED build API pair, independent of runtime overrides: a
/// switched runtime profile is unavailable unless it has its own explicit
/// mapping. Release requires HTTPS; Debug additionally permits the exact
/// loopback development origin. Non-origin paths are rejected, never stripped.
enum TrustedWebSettings {
    private static let recoveryPath = "/workspace/settings"

    /// The bundled build API endpoint from Info.plist, decoded independently
    /// of any runtime `--auth-backend-url` override.
    static var bundledBuildAPI: URL? {
        guard let encoded = Bundle.main.object(forInfoDictionaryKey: "TalentSignalAPIBaseURLBase64URL") as? String,
              let data = decodeBase64URL(encoded),
              let value = String(data: data, encoding: .utf8),
              let url = URL(string: value), url.host != nil else { return nil }
        return url
    }

    private static func decodeBase64URL(_ value: String) -> Data? {
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64.append("=") }
        return Data(base64Encoded: base64)
    }

    static func origin(currentEndpoint: URL?) -> URL? {
        guard let currentEndpoint, let bundledBuildAPI,
              RuntimeEndpoint.same(currentEndpoint, bundledBuildAPI) else { return nil }
        return configuredOrigin
    }

    private static var configuredOrigin: URL? {
        guard let encoded = Bundle.main.object(forInfoDictionaryKey: "TalentSignalWebOriginBase64URL") as? String else { return nil }
        let trimmed = encoded.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard let data = decodeBase64URL(trimmed),
              let value = String(data: data, encoding: .utf8),
              var components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(), let host = components.host?.lowercased(),
              !host.isEmpty, components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil else { return nil }
        let isLoopback = ["127.0.0.1", "localhost", "::1"].contains(host)
        #if DEBUG
        guard scheme == "https" || (scheme == "http" && isLoopback) else { return nil }
        #else
        guard scheme == "https" else { return nil }
        #endif
        // Non-origin paths are rejected, not silently stripped.
        guard components.path.isEmpty || components.path == "/" else { return nil }
        guard let origin = components.url else { return nil }
        return origin.appending(path: recoveryPath)
    }
}

/// Native Settings sign-in methods. The view renders
/// `AccountSignInMethodsModel` and supplies native provider authorization
/// results bound to immutable rounds; every async result is validated against
/// its captured round and the live session before it can change state.
struct AccountSignInMethodsView: View {
    @EnvironmentObject var store: AppSessionStore
    @Environment(\.appLanguage) private var language
    @StateObject private var model: AccountSignInMethodsModel
    @State private var currentPassword = ""
    @State private var newPassword = ""

    /// The returned round of an explicit verification selection. The view
    /// never re-reads a shared round after an await.

    init() {
        _model = StateObject(
            wrappedValue: AccountSignInMethodsModel(
                serviceFactory: AccountSignInMethodsModel.realServiceFactory()
            )
        )
    }

    var body: some View {
        Section {
            if let snapshot = model.snapshot {
                ForEach(snapshot.methods, id: \.provider) { method in
                    methodRow(method)
                }
            } else if !model.failureNotice.isEmpty {
                Text(language.text(model.failureNotice))
                    .font(.caption).foregroundStyle(Color.tsMutedInk)
                    .accessibilityIdentifier("sign-in-methods-unavailable")
            } else {
                ProgressView()
            }
            controls
            syncRow
            devicesRows
            conflictHandoff
        } header: {
            Text(language.text("Sign-in methods"))
        } footer: {
            Text(language.text("One account, several ways to sign in. Adding or removing a method verifies your current identity first."))
        }
        .task(id: liveScope) {
            model.attachLiveSession { [weak store] in
                guard let store, case let .signedIn(session) = store.phase else { return nil }
                return (session.baseURL, session.accessToken, session.account.id, session.user.id)
            }
            model.invalidate()
            currentPassword = ""
            newPassword = ""
            await model.reload()
        }
    }

    private var liveScope: AccountOperationScope? {
        guard case let .signedIn(session) = store.phase else { return nil }
        return .init(baseURL: session.baseURL, accessToken: session.accessToken,
                     accountID: session.account.id, userID: session.user.id)
    }

    @ViewBuilder
    private func methodRow(_ method: AccountSignInMethod) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(AccountLoginMethodsReducer.label(for: method.provider))
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(language.text(AccountLoginMethodsReducer.stateLabel(method.state)))
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .accessibilityIdentifier("sign-in-method-state-\(method.provider.rawValue)")
            }
            if let hint = method.hint, method.state == .connected {
                Text(hint).font(.caption).foregroundStyle(Color.tsMutedInk)
            }
            HStack(spacing: 8) {
                if method.state == .unconnected {
                    if method.provider == .password {
                        Button(language.text("Set password")) {
                            Task { await beginOperation(.setPassword, provider: .password) }
                        }
                        .accessibilityIdentifier("sign-in-method-set-password")
                    } else {
                        Button(language.text("Connect")) {
                            Task { await beginOperation(.linkProvider, provider: method.provider) }
                        }
                        .accessibilityIdentifier("sign-in-method-connect-\(method.provider.rawValue)")
                    }
                }
                if method.state == .connected, method.provider == .password {
                    Button(language.text("Change password")) {
                        Task { await beginOperation(.changePassword, provider: .password) }
                    }
                    .accessibilityIdentifier("sign-in-method-change-password")
                }
                if method.state != .unconnected, method.can_unlink {
                    Button(language.text("Remove")) {
                        Task { await beginOperation(.unlinkProvider, provider: method.provider) }
                    }
                    .accessibilityIdentifier("sign-in-method-remove-\(method.provider.rawValue)")
                } else if method.state == .connected {
                    Text(language.text("Keep at least one sign-in method"))
                        .font(.caption).foregroundStyle(Color.tsMutedInk)
                }
            }
            .frame(minHeight: 44)
            .disabled(model.working)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var controls: some View {
        if let intent = model.activeIntent {
            VStack(alignment: .leading, spacing: 8) {
                Text(language.text("Verify current identity"))
                    .font(.subheadline.weight(.semibold))
                Text(language.text(operationTitle(intent)))
                    .font(.caption).foregroundStyle(Color.tsMutedInk)
                if !model.awaitingNewPassword && model.awaitingTargetProvider == nil {
                    // Explicit current-identity verification selection:
                    // password, Apple and Google are all first-class choices.
                    if hasPassword {
                        SecureField(language.text("Current password"), text: $currentPassword)
                            .textContentType(.password)
                            .accessibilityIdentifier("sign-in-method-current-password")
                        Button(language.text("Verify current identity")) {
                            let password = currentPassword
                            currentPassword = ""
                            Task { await model.startWithPasswordProof(password) }
                        }
                        .frame(minHeight: 44)
                        .disabled(model.working || currentPassword.isEmpty)
                        .accessibilityIdentifier("sign-in-method-verify")
                    }
                    if connectedFederatedProviders.contains(.apple) {
                        if let round = model.currentRound, round.provider == .apple,
                           round.purpose == .currentIdentity {
                            appleButton(round: round, label: "sign-in-method-verify-apple")
                        } else if model.challengeFailed && model.currentAuthProvider == .apple {
                            Text(language.text("Apple verification needs its challenge. Retry."))
                                .font(.caption2).foregroundStyle(Color.tsMutedInk)
                            Button(language.text("Retry")) {
                                Task {
                                    _ = await model.selectCurrentVerification(.apple)
                                }
                            }
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("sign-in-method-apple-challenge-retry")
                        } else {
                            Button(language.text("Verify with Apple")) {
                                Task {
                                    _ = await model.selectCurrentVerification(.apple)
                                }
                            }
                            .frame(minHeight: 44)
                            .disabled(model.working)
                            .accessibilityIdentifier("sign-in-method-verify-apple-select")
                        }
                    }
                    if connectedFederatedProviders.contains(.google) {
                        Button(language.text("Verify with Google")) {
                            Task {
                                guard let intent = model.activeIntent else { return }
                                await model.beginGoogle(
                                    intent: intent,
                                    provider: model.activeProvider
                                ) { round in
                                    try await GoogleSignInFlow().identityToken(nonce: round.nonce)
                                }
                            }
                        }
                        .frame(minHeight: 44)
                        .disabled(model.working)
                        .accessibilityIdentifier("sign-in-method-verify-google")
                    }
                }
                if model.awaitingNewPassword {
                    SecureField(language.text("New password"), text: $newPassword)
                        .textContentType(.newPassword)
                        .accessibilityIdentifier("sign-in-method-new-password")
                    Button(language.text("Save password")) {
                        Task { await saveNewPassword() }
                    }
                    .frame(minHeight: 44)
                    .disabled(model.working || newPassword.count < 8)
                    .accessibilityIdentifier("sign-in-method-save-password")
                }
                if let provider = model.awaitingTargetProvider {
                    if provider == .google {
                        Button(language.text("Continue with Google")) {
                            Task {
                                await model.beginGoogleTargetAuth { round in
                                    try await GoogleSignInFlow().identityToken(nonce: round.nonce)
                                }
                            }
                        }
                        .frame(minHeight: 44)
                        .disabled(model.working)
                        .accessibilityIdentifier("sign-in-method-link-google")
                    } else if let round = model.currentRound, round.purpose == .targetProvider,
                              round.provider == .apple {
                        appleButton(round: round, label: "sign-in-method-link-apple")
                    }
                }
                Button(language.text("Cancel")) {
                    model.cancelOperation()
                }
                .frame(minHeight: 44)
                .disabled(model.working)
                .accessibilityIdentifier("sign-in-method-cancel")
            }
        }
        if !model.notice.isEmpty {
            Text(language.text(model.notice)).font(.caption).foregroundStyle(Color.tsMutedInk)
                .accessibilityIdentifier("sign-in-method-notice")
        }
        if !model.failureNotice.isEmpty {
            Text(language.text(model.failureNotice)).font(.caption).foregroundStyle(Color.tsMutedInk)
                .accessibilityIdentifier("sign-in-method-failure")
        }
        if model.outcomeUnknown {
            // Read-only reconciliation: the write is never repeated.
            Button(language.text("Check result again")) {
                Task { await model.checkResultAgain() }
            }
            .frame(minHeight: 44)
            .disabled(model.working)
            .accessibilityIdentifier("sign-in-method-check-result")
        }
        if model.settingsLoadFailed {
            Button(language.text("Reload")) {
                Task { await model.reload() }
            }
            .frame(minHeight: 44)
            .disabled(model.working)
            .accessibilityIdentifier("sign-in-method-reload")
        }
    }

    private func appleButton(round: ProviderRound, label: String) -> some View {
        SignInWithAppleButton(.continue) { request in
            request.requestedScopes = []
            // onRequest is synchronous: the captured round already carries the
            // challenge and nonce.
            request.nonce = SHA256.hex(round.nonce)
        } onCompletion: { result in
            let outcome = result
            Task {
                switch outcome {
                case let .success(authorization):
                    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                          let raw = credential.identityToken,
                          let token = String(data: raw, encoding: .utf8) else {
                        // A no-token result returns ITS round and can never
                        // cancel a newer flow.
                        await model.failProof(round: round, cancelled: true)
                        return
                    }
                    if round.purpose == .currentIdentity {
                        await model.acceptCurrentProof(round: round, identityToken: token)
                    } else {
                        await model.acceptTargetProof(round: round, identityToken: token)
                    }
                case .failure:
                    await model.failProof(round: round, cancelled: true)
                }
            }
        }
        .frame(minHeight: 44)
        .accessibilityIdentifier(label)
    }

    private func saveNewPassword() async {
        let password = newPassword
        newPassword = ""
        await model.finishWithPassword(password)
    }

    private func beginOperation(_ intent: AccountCredentialIntent, provider: AccountLoginProvider?) async {
        // The click that starts an operation chooses its current-identity
        // provider: password when present, otherwise an already linked
        // provider (the panel can switch to the other one explicitly).
        let authProvider: AccountLoginProvider =
            hasPassword ? .password : (connectedFederatedProviders.first ?? .password)
        await model.begin(intent: intent, provider: provider, currentAuthProvider: authProvider)
    }

    private var hasPassword: Bool {
        (model.snapshot?.methods ?? []).contains { $0.provider == .password && $0.state != .unconnected }
    }

    private func operationTitle(_ intent: AccountCredentialIntent) -> String {
        switch intent {
        case .linkProvider: return "Adding a sign-in method creates no workspace and moves no records."
        case .unlinkProvider: return "Removing a sign-in method keeps at least one usable method."
        case .setPassword: return "Set a password for this account."
        case .changePassword: return "Change the password for this account."
        }
    }

    private var connectedFederatedProviders: [AccountLoginProvider] {
        (model.snapshot?.methods ?? []).filter { $0.state == .connected && $0.provider.isFederated }.map(\.provider)
    }

    @ViewBuilder
    private var syncRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(language.text("Contacts and conversations sync automatically to your devices."))
                .font(.caption).foregroundStyle(Color.tsMutedInk)
            if model.offline {
                Text(language.text("Loading or offline. Retry when connected."))
                    .font(.caption2).foregroundStyle(Color.tsMutedInk)
                    .accessibilityIdentifier("sign-in-method-sync-pending")
            } else {
                Text(language.text("Sync runs in the background on this device; no per-message confirmation is shown here."))
                    .font(.caption2).foregroundStyle(Color.tsMutedInk)
                    .accessibilityIdentifier("sign-in-method-sync-description")
            }
        }
    }

    @ViewBuilder
    private var devicesRows: some View {
        if !model.deviceSessions.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(language.text("Devices")).font(.subheadline.weight(.semibold))
                ForEach(model.deviceSessions, id: \.id) { device in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(device.client_label).font(.caption)
                            if device.is_current {
                                Text(language.text("Current session"))
                                    .font(.caption2).foregroundStyle(Color.tsMutedInk)
                            }
                            if device.persistent == true {
                                Text(language.text("Stays signed in"))
                                    .font(.caption2).foregroundStyle(Color.tsMutedInk)
                                    .accessibilityIdentifier(device.is_current ? "sign-in-method-current-device-persistent" : "sign-in-method-other-device-persistent")
                            }
                        }
                        Spacer()
                        if !device.is_current {
                            Button(language.text("Remove")) {
                                Task { await model.revokeDevice(device.id) }
                            }
                            .frame(minHeight: 44)
                            .disabled(model.working)
                            .accessibilityIdentifier("sign-in-method-device-revoke")
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var conflictHandoff: some View {
        if model.snapshot?.email_ownership_state == "conflict" {
            VStack(alignment: .leading, spacing: 6) {
                Text(language.text("This email is linked to two historical accounts with separate data. Nothing is merged automatically."))
                    .font(.caption).foregroundStyle(Color.tsMutedInk)
                if let origin = TrustedWebSettings.origin(currentEndpoint: store.baseURL) {
                    Link(destination: origin) {
                        Text(language.text("Open account recovery in your browser"))
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("sign-in-method-conflict-handoff")
                    Text(language.text("Sign in there with THIS account: "))
                        .font(.caption2).foregroundStyle(Color.tsMutedInk)
                    Text(verbatim: "\(model.snapshot?.user_id ?? "") · \(model.snapshot?.account_id ?? "")")
                        .font(.caption2).foregroundStyle(Color.tsMutedInk)
                        .textSelection(.enabled)
                } else {
                    Text(language.text("Account recovery needs the configured web address for this connection, which this build does not have. Retry after configuration."))
                        .font(.caption2).foregroundStyle(Color.tsMutedInk)
                        .accessibilityIdentifier("sign-in-method-conflict-unavailable")
                    Button(language.text("Retry")) { Task { await model.reload() } }
                        .frame(minHeight: 44)
                }
            }
        }
    }
}
