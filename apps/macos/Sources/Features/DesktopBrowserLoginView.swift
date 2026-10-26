import SwiftUI

/// The coordinator retains all authentication and exact-origin authority.
struct DesktopBrowserLoginView: View {
    let origin: WorkspaceOrigin
    let returnTarget: URL?
    @ObservedObject var coordinator: DesktopBrowserLoginCoordinator
    let captureDraft: () async -> DesktopDraftRecovery?

    var body: some View {
        DesktopBrowserLoginSurface(
            phase: coordinator.phase,
            matchingHint: coordinator.matchingHint,
            canCheckResult: coordinator.canCheckResult,
            onStart: { coordinator.start(in: origin, returningTo: returnTarget, captureDraft: captureDraft) },
            onCancel: { coordinator.cancel() },
            onCheckResult: { coordinator.checkResult() }
        )
    }
}

/// Presentation has no credentials, networking, or independent execution authority.
struct DesktopBrowserLoginSurface: View {
    let phase: DesktopBrowserLoginPhase
    let matchingHint: String?
    let canCheckResult: Bool
    let onStart: () -> Void
    let onCancel: () -> Void
    let onCheckResult: () -> Void

    var body: some View {
        GeometryReader { viewport in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 9) {
                        TSBrandMark(size: 34).accessibilityHidden(true)
                        Text("capri")
                            .font(.system(size: 19, weight: .semibold))
                    }
                    .padding(.bottom, 36)

                    Text(String(localized: "Workspace on this Mac", bundle: .main))
                        .font(.system(size: 12))
                        .foregroundStyle(TSBrand.secondaryInk)
                        .padding(.bottom, 8)
                    Text(String(localized: "Sign in to capri", bundle: .main))
                        .font(.system(size: 28, weight: .medium))
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("desktop.login.title")
                        .padding(.bottom, 16)

                    stateContent
                        .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 16) {
                        Divider().overlay(TSBrand.hairline)
                        HStack(spacing: 12) {
                            Text(String(localized: "Confirm your account in the browser", bundle: .main))
                                .foregroundStyle(TSBrand.ink)
                            Image(systemName: "arrow.right")
                                .imageScale(.small)
                                .accessibilityHidden(true)
                            Text(String(localized: "Return to this Mac", bundle: .main))
                        }
                        .font(.system(size: 12))
                        .foregroundStyle(TSBrand.secondaryInk)
                        .accessibilityElement(children: .combine)
                    }
                    .padding(.top, 32)
                }
                .font(.system(size: 14))
                .foregroundStyle(TSBrand.ink)
                .lineSpacing(4)
                .frame(maxWidth: 400, alignment: .leading)
                .padding(32)
                .frame(maxWidth: .infinity, minHeight: viewport.size.height)
            }
        }
        .background(TSBrand.canvas)
        .accessibilityIdentifier("desktop.login.browserOwned")
    }

    private var stateContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            switch phase {
            case .preparing:
                progress(String(localized: "Preparing sign-in…", bundle: .main))
                cancelButton
            case .waiting:
                message(String(localized: "Confirm your account in the browser, then return to this Mac.", bundle: .main))
                if let matchingHint {
                    HStack(alignment: .firstTextBaseline, spacing: 20) {
                        Text(String(localized: "Matching code", bundle: .main)).foregroundStyle(TSBrand.secondaryInk)
                        Spacer(minLength: 0)
                        Text(matchingHint)
                            .font(.system(size: 22, design: .monospaced))
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("desktop.login.matchingHint")
                    }
                    .padding(.vertical, 8)
                }
                progress(String(localized: "Waiting for browser confirmation…", bundle: .main))
                cancelButton
            case .exchanging:
                progress(String(localized: "Verifying sign-in on this Mac…", bundle: .main))
                cancelButton
            case .completed:
                progress(String(localized: "Opening your workspace…", bundle: .main))
            case .idle, .cancelled:
                message(phase == .cancelled ? String(localized: "Sign-in was cancelled. You can start again at any time.", bundle: .main) : String(localized: "Choose an account in the browser. Your workspace opens after sign-in.", bundle: .main))
                primaryLoginButton
            case .failed(let text):
                message(text)
                primaryLoginButton
            case .unresolved:
                message(canCheckResult
                    ? String(localized: "We cannot confirm whether this Mac finished signing in. Check the result or start again.", bundle: .main)
                    : String(localized: "We cannot confirm whether this Mac finished signing in. Start sign-in again.", bundle: .main))
                if canCheckResult {
                    Button(String(localized: "Check sign-in result", bundle: .main), action: onCheckResult)
                        .buttonStyle(TSPrimaryButtonStyle())
                        .controlSize(.large)
                        .keyboardShortcut(.defaultAction)
                        .accessibilityIdentifier("desktop.login.checkResult")
                    loginButton
                        .buttonStyle(.link)
                        .keyboardShortcut(.return, modifiers: [.option])
                        .help(String(localized: "Restart sign-in (⌥↩)", bundle: .main))
                } else {
                    primaryLoginButton
                }
            }
        }
    }

    private var loginButton: some View {
        Button(action: onStart) {
            HStack(spacing: 12) {
                Text(String(localized: "Sign in with browser", bundle: .main))
                Image(systemName: "arrow.up.right")
                    .imageScale(.small)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityLabel(String(localized: "Sign in with browser", bundle: .main))
        .accessibilityIdentifier("desktop.login.start")
    }

    private var primaryLoginButton: some View {
        loginButton
            .buttonStyle(TSPrimaryButtonStyle())
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
    }

    private var cancelButton: some View {
        Button(String(localized: "Cancel sign-in", bundle: .main), action: onCancel)
            .buttonStyle(.link)
            .keyboardShortcut(.cancelAction)
            .accessibilityIdentifier("desktop.login.cancel")
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .foregroundStyle(TSBrand.secondaryInk)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("desktop.login.message")
    }

    private func progress(_ text: String) -> some View {
        HStack(spacing: 10) {
            ProgressView().controlSize(.mini).accessibilityHidden(true)
            Text(text).foregroundStyle(TSBrand.secondaryInk)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("desktop.login.progress")
    }
}
