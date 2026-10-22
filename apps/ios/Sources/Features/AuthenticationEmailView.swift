import SwiftUI

struct AuthenticationEmailView: View {
    @ObservedObject var store: AppSessionStore
    @Environment(\.appLanguage) private var language
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var registering = false
    @State private var verificationSent = false
    @State private var verificationCode = ""
    @State private var isSubmitting = false
    @FocusState private var focusedField: Field?

    private enum Field: Hashable { case email, password, verification }
    private var isBusy: Bool { store.isWorking || isSubmitting }
    private var canSubmitCredentials: Bool {
        !isBusy && !(registering && verificationSent)
            && email.contains("@") && password.count >= (registering ? 8 : 1)
    }
    private var canConfirmRegistration: Bool {
        !isBusy && registering && verificationSent
            && verificationCode.trimmingCharacters(in: .whitespacesAndNewlines).count >= 32
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(language.text("Email"), text: $email)
                        .textContentType(.emailAddress).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($focusedField, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { if !isBusy { focusedField = .password } }
                        .disabled(isBusy || verificationSent)
                        .accessibilityIdentifier("login-email")
                    SecureField(language.text("Password"), text: $password)
                        .textContentType(registering ? .newPassword : .password)
                        .focused($focusedField, equals: .password)
                        .submitLabel(.go)
                        .onSubmit { submitCredentials() }
                        .disabled(isBusy || verificationSent)
                        .accessibilityIdentifier("login-password")
                } footer: {
                    if registering { Text(language.text("Use at least 8 characters for your password.")) }
                }
                if registering && verificationSent {
                    Section {
                        // Primary: the emailed HTTPS link opens the Web
                        // confirmation page. Returning here, the user
                        // continues with the pending email and password held
                        // only in memory; this opens a separate device session
                        // for the same account.
                        Button {
                            continueAfterVerification()
                        } label: {
                            HStack {
                                Text(language.text("I have verified, continue"))
                                Spacer()
                                if store.isWorking { ProgressView() } else { Image(systemName: "checkmarkmark") }
                            }
                            .frame(minHeight: 44)
                        }
                        .disabled(isBusy)
                        .accessibilityIdentifier("login-verification-continue")
                        TextField(language.text("Verification code"), text: $verificationCode)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .focused($focusedField, equals: .verification)
                            .submitLabel(.go)
                            .onSubmit { confirmRegistration() }
                            .disabled(isBusy)
                            .accessibilityIdentifier("login-verification-code")
                        Button {
                            confirmRegistration()
                        } label: {
                            HStack {
                                Text(language.text("Confirm and sign in"))
                                Spacer()
                                if store.isWorking { ProgressView() } else { Image(systemName: "checkmark") }
                            }
                            .frame(minHeight: 44)
                        }
                        .disabled(!canConfirmRegistration)
                        .accessibilityIdentifier("login-verification-submit")
                    } footer: {
                        Text(language.text("We sent a verification link to your email. Open it and confirm to finish creating your account. Nothing is created until you confirm."))
                    }
                }
                Section {
                    Button {
                        submitCredentials()
                    } label: {
                        HStack {
                            Text(language.text(registering ? "Create workspace" : "Sign in"))
                            Spacer()
                            if store.isWorking { ProgressView() } else { Image(systemName: "arrow.right") }
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(!canSubmitCredentials)
                    .accessibilityIdentifier("login-email-submit")
                    Button(language.text(registering ? "Already have an account? Sign in" : "New here? Create an account")) {
                        registering.toggle(); verificationSent = false; verificationCode = ""; store.notice = nil
                        focusedField = .email
                    }
                    .disabled(isBusy)
                    .frame(minHeight: 44)
                }
                if let notice = store.notice {
                    Section {
                        Text(language.text(notice)).foregroundStyle(Color.tsMutedInk)
                            .accessibilityIdentifier("login-email-notice")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.tsSurface)
            .navigationTitle(language.text("Continue with email"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) {
                Button(language.text("Cancel")) { password = ""; store.notice = nil; dismiss() }.disabled(isBusy)
            } }
            .onAppear { focusedField = .email }
        }
        .interactiveDismissDisabled(isBusy)
    }

    private func submitCredentials() {
        guard canSubmitCredentials else { return }
        isSubmitting = true
        focusedField = nil
        let submittedEmail = email
        let submittedPassword = password
        let isRegistration = registering
        Task {
            if isRegistration {
                if await store.startRegistration(email: submittedEmail, password: submittedPassword) {
                    verificationSent = true
                    focusedField = .verification
                }
            } else {
                await store.signInWithEmail(email: submittedEmail, password: submittedPassword, registering: false)
            }
            isSubmitting = false
        }
    }

    private func continueAfterVerification() {
        guard !isBusy, registering, verificationSent else { return }
        isSubmitting = true
        focusedField = nil
        let submittedEmail = email
        let submittedPassword = password
        Task {
            await store.signInWithEmail(email: submittedEmail, password: submittedPassword, registering: false)
            isSubmitting = false
        }
    }

    private func confirmRegistration() {
        guard canConfirmRegistration else { return }
        isSubmitting = true
        focusedField = nil
        let submittedCode = verificationCode
        Task {
            await store.confirmRegistration(secret: submittedCode)
            isSubmitting = false
        }
    }
}
