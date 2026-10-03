import AppKit
import SwiftUI

struct WorkspaceConnectionForm: View {
    enum Mode {
        case firstRun
        case settings
    }

    var mode: Mode = .settings
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

    private var isFirstRun: Bool { mode == .firstRun }
    private var parsed: WorkspaceOrigin? { WorkspaceConnection.parseInput(address, allowLocalDevelopment: localDevelopment) }
    private var trimmedAddress: String { address.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.bottom, isFirstRun ? 32 : 24)

            Text("工作区地址")
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
                .onSubmit { requestSave() }
                .padding(.top, 8)

            if let parsed, parsed.url.absoluteString != trimmedAddress {
                Text("将使用：\(parsed.url.absoluteString)")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .textSelection(.enabled)
                    .padding(.top, 8)
            } else if isFirstRun {
                Text("可粘贴完整工作区链接。仅 HTTPS，不含账号或密码。")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .padding(.top, 8)
            }

            if parsed != nil {
                Button(action: testConnection) {
                    HStack(spacing: 5) {
                        if probing {
                            ProgressView().controlSize(.mini)
                                .accessibilityLabel("正在检查连接")
                        }
                        Text(probing ? "检查中…" : (isFirstRun ? "先测试连接" : "测试连接"))
                            .underline(!probing, color: TSBrand.hairline)
                    }
                    .font(.subheadline.weight(.medium))
                }
                .buttonStyle(.plain)
                .foregroundStyle(TSBrand.ink.opacity(0.72))
                .disabled(probing)
                .padding(.top, 6)
                .accessibilityIdentifier("connection.test")
                .accessibilityHint("可选：先检查服务是否可访问，再打开工作区。")
            }

            if let error {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(TSBrand.seam)
                    .padding(.top, 14)
                    .fixedSize(horizontal: false, vertical: true)
            } else if !trimmedAddress.isEmpty && parsed == nil {
                Text(isFirstRun ? "需要 HTTPS 工作区地址。" : "请输入 HTTPS 工作区地址。")
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
                Button(isFirstRun ? "打开工作区" : "保存连接", action: requestSave)
                    .buttonStyle(TSPrimaryButtonStyle())
                    .disabled(parsed == nil)
                    .accessibilityIdentifier("connection.save")
            }
            .padding(.top, 22)

            if isFirstRun {
                Text("私有工作区需先连接 Tailscale。向工作区所有者获取地址。")
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
        .onAppear {
            address = connection.origin?.url.absoluteString ?? ""
            localDevelopment = connection.allowsLocalDevelopment
        }
        .onChange(of: address) { _, _ in invalidateProbe() }
        .onChange(of: localDevelopment) { _, _ in invalidateProbe() }
        .onDisappear { invalidateProbe() }
        .confirmationDialog("切换工作区服务？", isPresented: $confirmSwitch, titleVisibility: .visible) {
            Button("切换并重新载入") { save() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("请先完成当前输入或上传。将打开 \(parsed?.url.absoluteString ?? "")，现有服务的登录状态会保留。")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            if isFirstRun {
                HStack(alignment: .center, spacing: 12) {
                    TSBrandMark(size: 28)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("capri")
                    Text("连接你的工作区")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(TSBrand.ink)
                        .tracking(-0.3)
                }
            } else {
                Text("连接与调试")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(TSBrand.ink)
                    .tracking(-0.25)
            }
            Text(isFirstRun ? "同一份对话、人物和日程，在这台 Mac 上继续。" : "查看或更改本机连接到的工作区服务。")
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
                Toggle("允许本机开发服务", isOn: $localDevelopment)
                Text("仅允许 localhost、127.0.0.1 或 ::1 使用 HTTP；远端始终使用 HTTPS。")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                Button("填入本机开发地址") {
                    localDevelopment = true
                    address = "http://127.0.0.1:3000"
                }
                Toggle("启用网页检查器", isOn: $connection.inspectorEnabled)
                Text("开启后，可通过 Safari 的开发菜单检查此窗口。仅在调试时开启。")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                HStack {
                    Text("客户端 \(DesktopUpdater.shared.appVersion)")
                        .font(.caption)
                        .foregroundStyle(TSBrand.secondaryInk)
                    Spacer()
                    Button("复制诊断摘要") {
                        let summary = "capri \(DesktopUpdater.shared.appVersion)\nmacOS \(ProcessInfo.processInfo.operatingSystemVersionString)\nConnection: \(result?.summary ?? "Not checked")\n\(result?.detail ?? "")\nLocal development: \(localDevelopment)\nInspector: \(connection.inspectorEnabled)\nWorkspace address, cookies and content omitted."
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(summary, forType: .string)
                        copied = true
                    }
                }
                if copied {
                    Text("已复制 · 摘要不含服务地址、账号、凭据或对话内容。")
                        .font(.caption)
                        .foregroundStyle(TSBrand.secondaryInk)
                }
                Text("切换服务后会重新载入页面。不同服务的登录状态单独保存。")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
            }
            .padding(.top, 14)
            .padding(.horizontal, 4)
        } label: {
            Text("开发与诊断")
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
        guard let origin = parsed else { return }
        invalidateProbe(); probing = true
        let id = probeID
        probeTask = Task {
            let observed = await WorkspaceConnectionProbe(origin: origin).run()
            guard !Task.isCancelled, probeID == id else { return }
            result = observed; probing = false
        }
    }

    private func requestSave() {
        guard parsed != nil else {
            error = "请输入 HTTPS 工作区地址。"
            return
        }
        if let current = connection.origin, let parsed, current != parsed { confirmSwitch = true }
        else { save() }
    }

    private func save() {
        guard connection.save(address, allowLocalDevelopment: localDevelopment) else { return }
        onConnected()
    }
}
