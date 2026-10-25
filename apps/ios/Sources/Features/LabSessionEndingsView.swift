import SwiftUI

struct LabSessionEndingsView: View {
    @ObservedObject var store: AppSessionStore
    @Environment(\.appLanguage) private var language
    @State private var confirmsSignOut = false
    var body: some View {
        List {
            Section {
                LabInfoRow(label: language.text("Backend"), value: store.baseURL?.host ?? language.text("Not connected"))
                if case let .signedIn(session) = store.phase {
                    LabInfoRow(label: language.text("Account"), value: session.account.name)
                    Button(language.text("Sign out of this account"), role: .destructive) { confirmsSignOut = true }
                        .disabled(store.isWorking)
                        .accessibilityIdentifier("lab-ending-sign-out")
                } else {
                    Text(language.text("No account content is open"))
                }
            } header: { Text(language.text("Current environment")) } footer: {
                Text(language.text("Saved drafts, captured sources and pending operation IDs remain protected in their original account. Sign in to that account to recover them."))
            }
            if store.isWorking {
                Section { ProgressView(language.text("Verifying sign-out…")) }
            }
            if let notice = store.notice {
                Section { Text(language.text(notice)).font(.subheadline).foregroundStyle(Color.tsMutedInk) }
            }
            if store.endingReceipts.isEmpty {
                Section { Text(language.text("No recorded sign-out for this environment")) }
            }
            ForEach(store.endingReceipts.sorted { $0.startedAt > $1.startedAt }) { receipt in
                Section {
                    LabInfoRow(label: language.text("Local credential"), value: language.text(localLabel(receipt.local)))
                        .accessibilityIdentifier("lab-ending-local-\(receipt.local.rawValue)")
                    LabInfoRow(label: language.text("Server session"), value: language.text(remoteLabel(receipt.remote)))
                        .accessibilityIdentifier("lab-ending-remote-\(receipt.remote.rawValue)")
                    Text(receipt.startedAt, format: .dateTime.year().month().day().hour().minute())
                        .font(.caption).foregroundStyle(Color.tsMutedInk)
                    Text(receipt.id.uuidString.lowercased()).font(.caption.monospaced()).textSelection(.enabled)
                        .accessibilityLabel(language.text("Sign-out operation"))
                        .accessibilityValue(receipt.id.uuidString.lowercased())
                        .accessibilityIdentifier("lab-ending-operation")
                    if !receipt.settled {
                        Button(language.text("Retry this sign-out")) { Task { await store.retrySignOut(receipt.id) } }
                            .disabled(store.isWorking)
                            .accessibilityIdentifier("lab-ending-retry")
                    }
                } header: {
                    Text(language.text(receipt.settled ? "Sign-out checked" : "Sign-out needs attention"))
                } footer: {
                    if [.pending, .unverified].contains(receipt.remote) {
                        if receipt.renewable {
                            Text(language.text("A protected copy is retained only until server revocation is verified. Short access expiry does not end this renewable session. This copy cannot reopen account content; retry preserves any newer sign-in."))
                        } else {
                            Text(language.text("A protected copy of this old credential is retained only to retry revocation, until its reported expiry. It cannot reopen account content. Retry preserves any newer sign-in."))
                        }
                    } else if receipt.remote == .expired {
                        Text(language.text("The saved expiry has passed. This is not a new server verification."))
                    }
                }
            }
            Section {
                Button(language.text("Refresh sign-out records")) { store.refreshSignOutReceipts() }
                    .disabled(store.isWorking)
            } footer: {
                Text(language.text("Sign-out does not delete an account, change system permissions or sign out of your Apple ID. Recovery credentials are never included in diagnostic exports."))
            }
        }
        .navigationTitle(language.text("Sign-in & recovery"))
        .navigationBarTitleDisplayMode(.inline)
        .task { store.refreshSignOutReceipts() }
        .confirmationDialog(language.text("Sign out of this account?"), isPresented: $confirmsSignOut, titleVisibility: .visible) {
            Button(language.text("Sign out"), role: .destructive) { Task { await store.signOut() } }
        } message: {
            Text(language.text("Close this account, remove its local credential and attempt server revocation. Captures, drafts and recovery records are preserved. The result remains available from the sign-in screen."))
        }
    }
    private func localLabel(_ value: AppSessionEnding.Local) -> String {
        switch value {
        case .pending: "Removal not yet verified"
        case .removed: "Removal verified"
        case .failed: "Removal needs retry"
        }
    }
    private func remoteLabel(_ value: AppSessionEnding.Remote) -> String {
        switch value {
        case .pending: "Revocation not yet verified"
        case .revoked: "Server confirmed revocation"
        case .alreadyInvalid: "Server rejected this old session"
        case .unverified: "Revocation could not be verified"
        case .expired: "Reported expiry has passed"
        }
    }
}
