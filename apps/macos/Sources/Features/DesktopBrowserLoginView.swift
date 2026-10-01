import SwiftUI

/// Browser ownership is visible even when preparation or readback fails.
struct DesktopBrowserLoginView: View {
    let origin: WorkspaceOrigin
    let returnTarget: URL?
    @ObservedObject var coordinator: DesktopBrowserLoginCoordinator

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Image(systemName: "person.crop.circle").font(.system(size: 28)).foregroundStyle(.secondary)
            Text("登录 Talent Signal").font(.system(size: 26, weight: .medium))
            switch coordinator.phase {
            case .preparing:
                progress("正在准备登录…")
                cancelButton
            case .waiting:
                Text("请在浏览器中确认账号，然后回到这台 Mac。")
                    .foregroundStyle(.secondary)
                if let hint = coordinator.matchingHint {
                    HStack {
                        Text("匹配码").foregroundStyle(.secondary)
                        Spacer()
                        Text(hint).font(.system(size: 21, design: .monospaced))
                            .accessibilityIdentifier("desktop.login.matchingHint")
                    }.padding(.vertical, 12)
                }
                progress("等待浏览器确认…")
                cancelButton
            case .exchanging:
                progress("正在验证这台 Mac 的登录…")
                cancelButton
            case .completed:
                progress("正在打开工作区…")
            case .idle, .cancelled:
                Text(coordinator.phase == .cancelled ? "登录已取消。可以随时重新开始。" : "在浏览器中选择账号。登录后会自动打开工作区。")
                    .foregroundStyle(.secondary)
                loginButton
            case .failed(let message):
                Text(message).foregroundStyle(.secondary)
                loginButton
            case .unresolved:
                Text("还不能确认这台 Mac 是否已完成登录。可以先检查结果，或重新开始。")
                    .foregroundStyle(.secondary)
                if coordinator.canCheckResult {
                    Button("检查登录结果") { coordinator.checkResult() }
                        .buttonStyle(TSPrimaryButtonStyle())
                }
                loginButton
            }
        }
        .font(.system(size: 14)).lineSpacing(4)
        .frame(maxWidth: 360, alignment: .leading).padding(40)
        .accessibilityIdentifier("desktop.login.browserOwned")
    }
    private var loginButton: some View {
        Button("在浏览器中登录") { coordinator.start(in: origin, returningTo: returnTarget) }
            .buttonStyle(TSPrimaryButtonStyle())
            .accessibilityIdentifier("desktop.login.start")
    }
    private var cancelButton: some View {
        Button("取消登录") { coordinator.cancel() }.buttonStyle(.plain).foregroundStyle(.secondary)
    }
    private func progress(_ message: String) -> some View {
        HStack(spacing: 10) { ProgressView().controlSize(.mini); Text(message).foregroundStyle(.secondary) }
    }
}
