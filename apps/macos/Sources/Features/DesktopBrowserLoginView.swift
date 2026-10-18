import SwiftUI

/// The coordinator retains all authentication and exact-origin authority.
struct DesktopBrowserLoginView: View {
    let origin: WorkspaceOrigin
    let returnTarget: URL?
    @ObservedObject var coordinator: DesktopBrowserLoginCoordinator

    var body: some View {
        DesktopBrowserLoginSurface(
            phase: coordinator.phase,
            matchingHint: coordinator.matchingHint,
            canCheckResult: coordinator.canCheckResult,
            onStart: { coordinator.start(in: origin, returningTo: returnTarget) },
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

                    Text("这台 Mac 的工作区")
                        .font(.system(size: 12))
                        .foregroundStyle(TSBrand.secondaryInk)
                        .padding(.bottom, 8)
                    Text("登录 capri")
                        .font(.system(size: 28, weight: .medium))
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("desktop.login.title")
                        .padding(.bottom, 16)

                    stateContent
                        .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 16) {
                        Divider().overlay(TSBrand.hairline)
                        HStack(spacing: 12) {
                            Text("浏览器确认账号")
                                .foregroundStyle(TSBrand.ink)
                            Image(systemName: "arrow.right")
                                .imageScale(.small)
                                .accessibilityHidden(true)
                            Text("回到这台 Mac")
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
                progress("正在准备登录…")
                cancelButton
            case .waiting:
                message("请在浏览器中确认账号，然后回到这台 Mac。")
                if let matchingHint {
                    HStack(alignment: .firstTextBaseline, spacing: 20) {
                        Text("匹配码").foregroundStyle(TSBrand.secondaryInk)
                        Spacer(minLength: 0)
                        Text(matchingHint)
                            .font(.system(size: 22, design: .monospaced))
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("desktop.login.matchingHint")
                    }
                    .padding(.vertical, 8)
                }
                progress("等待浏览器确认…")
                cancelButton
            case .exchanging:
                progress("正在验证这台 Mac 的登录…")
                cancelButton
            case .completed:
                progress("正在打开工作区…")
            case .idle, .cancelled:
                message(phase == .cancelled ? "登录已取消。可以随时重新开始。" : "在浏览器中选择账号。登录后会自动打开工作区。")
                primaryLoginButton
            case .failed(let text):
                message(text)
                primaryLoginButton
            case .unresolved:
                message(canCheckResult
                    ? "还不能确认这台 Mac 是否已完成登录。可以先检查结果，或重新开始。"
                    : "还不能确认这台 Mac 是否已完成登录。请重新开始登录。")
                if canCheckResult {
                    Button("检查登录结果", action: onCheckResult)
                        .buttonStyle(.borderedProminent)
                        .tint(TSBrand.ink)
                        .foregroundStyle(TSBrand.canvas)
                        .controlSize(.large)
                        .keyboardShortcut(.defaultAction)
                        .accessibilityIdentifier("desktop.login.checkResult")
                    loginButton
                        .buttonStyle(.link)
                        .keyboardShortcut(.return, modifiers: [.option])
                        .help("重新开始登录（⌥↩）")
                } else {
                    primaryLoginButton
                }
            }
        }
    }

    private var loginButton: some View {
        Button(action: onStart) {
            HStack(spacing: 12) {
                Text("在浏览器中登录")
                Image(systemName: "arrow.up.right")
                    .imageScale(.small)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityLabel("在浏览器中登录")
        .accessibilityIdentifier("desktop.login.start")
    }

    private var primaryLoginButton: some View {
        loginButton
            .buttonStyle(.borderedProminent)
            .tint(TSBrand.ink)
            .foregroundStyle(TSBrand.canvas)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
    }

    private var cancelButton: some View {
        Button("取消登录", action: onCancel)
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
