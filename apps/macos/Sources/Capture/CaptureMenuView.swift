import AppKit
import SwiftUI

struct CaptureMenuView: View {
    @ObservedObject private var runtime = CaptureRuntime.shared
    @ObservedObject private var preferences = CaptureRuntime.shared.preferences
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings
    @State private var menuWindow: NSWindow?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                TSBrandMark(size: 19, monochrome: true)
                Text("Talent Signal").font(.system(size: 13, weight: .medium))
                Spacer()
            }
            .padding(.horizontal, 15).padding(.top, 14).padding(.bottom, 12)

            if let coordinator = runtime.coordinator {
                CaptureMenuActions(coordinator: coordinator, preferences: preferences,
                                   recentConversation: runtime.recentConversation,
                                   ownerVerified: runtime.captureOwnerVerified,
                                   dismissMenu: dismissMenu,
                                   openWorkspace: { openWindow(id: "workspace") },
                                   continueRecent: { Task { await runtime.resumeRecentConversation() } })
            } else {
                Button { openWindow(id: "workspace") } label: {
                    Label("连接工作区后截图", systemImage: "viewfinder")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }.buttonStyle(.plain)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 9))
                    .padding(.horizontal, 8)
            }

            Divider().padding(.horizontal, 15).padding(.top, 10)
            HStack {
                Button {
                    WorkspaceSettingsNavigation.shared.selection = .device
                    openSettings()
                } label: { Label("设置…", systemImage: "gearshape") }
                .accessibilityIdentifier("capture.menu.settings")
                Spacer()
                Button("退出") { NSApplication.shared.terminate(nil) }
                    .keyboardShortcut("q")
            }
            .font(.system(size: 12))
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 17).padding(.vertical, 13)
        }
        .frame(width: 320)
        .background(.regularMaterial)
        .background(CaptureMenuWindowReader { window in
            guard menuWindow !== window else { return }
            menuWindow = window
        })
        .onAppear {
            runtime.start()
            runtime.setOpenWorkspace { openWindow(id: "workspace") }
            Task { await runtime.refreshRecentConversation() }
        }
    }

    private func dismissMenu() {
        // Close exactly this menu popover. Global-shortcut capture does not
        // hide the user's workspace window.
        menuWindow?.orderOut(nil)
        menuWindow = nil
    }
}

private struct CaptureMenuWindowReader: NSViewRepresentable {
    let found: (NSWindow) -> Void
    func makeNSView(context: Context) -> CaptureMenuProbeView {
        let view = CaptureMenuProbeView(frame: .zero)
        view.found = found
        return view
    }
    func updateNSView(_ view: CaptureMenuProbeView, context: Context) {
        view.found = found
        if let window = view.window { DispatchQueue.main.async { found(window) } }
    }
}

private final class CaptureMenuProbeView: NSView {
    var found: ((NSWindow) -> Void)?
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let window { DispatchQueue.main.async { [weak self] in self?.found?(window) } }
    }
}

private struct CaptureMenuActions: View {
    @ObservedObject var coordinator: CaptureCoordinator
    @ObservedObject var preferences: CapturePreferences
    let recentConversation: CaptureRecentConversation
    let ownerVerified: Bool
    let dismissMenu: () -> Void
    let openWorkspace: () -> Void
    let continueRecent: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                Task { await coordinator.startCapture(prepareToSelect: dismissMenu) }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "viewfinder")
                        .font(.system(size: 20, weight: .regular)).frame(width: 24)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("截图交给 Agent").font(.system(size: 14, weight: .medium))
                        Text("框选后自动处理").font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(preferences.shortcut.displayString)
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 13).padding(.vertical, 11)
                .background(Color.primary.opacity(0.065), in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("capture.menu.start")
            .padding(.horizontal, 8)

            if !ownerVerified && coordinator.boundOwnerScope != nil {
                Text(recentConversation == .checking ? "正在确认当前工作区…" : "暂时无法确认当前工作区。")
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(.horizontal, 17).padding(.top, 9)
            } else {
            switch coordinator.presentation {
            case .needsDisclosure(let context): disclosure(context)
            case .needsSignIn:
                inlineNote("请先在工作区登录，然后重试截图。", action: "打开工作区", onAction: openWorkspace)
            case .unknown(let intentID):
                let hasRawImage = coordinator.hasLocalImage(intentID: intentID)
                inlineNote(hasRawImage ? "送达状态未确认，原截图仍在本机。" : "送达状态未确认，本机原图已清除。",
                           action: hasRawImage ? "核对并重试" : "核对状态") {
                    Task { await coordinator.retry(intentID: intentID) }
                }
                if hasRawImage {
                    Button("删除本机截图") { coordinator.discardLocal(intentID: intentID) }
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                        .buttonStyle(.plain).padding(.horizontal, 16).padding(.top, 6)
                }
            case .deletionFailed(let intentID):
                inlineNote("本机截图删除未完成；不会再次上传。", action: "重试删除") {
                    coordinator.discardLocal(intentID: intentID)
                }
            case .failed(let intentID, let message):
                inlineNote(message, action: intentID.flatMap(coordinator.failedSession) != nil ? "查看会话" :
                           intentID == nil ? "重新截图" :
                           intentID.map({ coordinator.hasLocalImage(intentID: $0) }) == true ? "核对并重试" : "核对状态") {
                    if let intentID, let sessionID = coordinator.failedSession(intentID: intentID) {
                        CaptureRuntime.shared.openSession(sessionID)
                    } else if let intentID { Task { await coordinator.retry(intentID: intentID) } }
                    else { Task { await coordinator.startCapture(prepareToSelect: dismissMenu) } }
                }
                if let intentID, coordinator.failedSession(intentID: intentID) == nil,
                   coordinator.hasLocalImage(intentID: intentID) {
                    Button("删除本机截图") { coordinator.discardLocal(intentID: intentID) }
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                        .buttonStyle(.plain).padding(.horizontal, 16).padding(.top, 6)
                }
            case .processing(let sessionID), .viewable(let sessionID):
                inlineNote(coordinator.presentation == .viewable(sessionID) ? "可以查看了。" : "Agent 正在处理。",
                           action: "查看会话") { CaptureRuntime.shared.openSession(sessionID) }
            case .selecting, .uploading: Text("正在继续这次截图…").font(.caption).foregroundStyle(.secondary)
                .padding(.horizontal, 17).padding(.top, 9)
            case .previewReady: Text("截图留在预览中，发送前可以裁剪或遮挡。")
                .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 17).padding(.top, 9)
            case .idle: EmptyView()
            }
            }

            Divider().padding(.horizontal, 15).padding(.vertical, 10)
            Button(action: continueRecent) {
                Label(recentConversation.menuTitle, systemImage: "bubble.left")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .disabled(!recentConversation.canContinue)
            .accessibilityIdentifier("capture.menu.continue")
            Button(action: openWorkspace) {
                Label("打开工作区", systemImage: "arrow.up.right")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityIdentifier("capture.menu.workspace")
            .buttonStyle(.plain)
            .font(.system(size: 13))
            .padding(.horizontal, 17).padding(.vertical, 8)
        }
    }

    private func disclosure(_ context: CaptureContext) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("首次使用截图").font(.system(size: 13, weight: .medium))
            Text("松开选区后，截图会上传到「\(context.processing.workspaceLabel)」，交由 \(context.processing.processorLabels.joined(separator: "、")) 处理。")
                .font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)
            Text("只上传所选区域；分析不会自动发消息或修改资料。原图保留遵循工作区的 \(context.processing.sourceRetentionDays) 天会话期限。")
                .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button("开启截图") {
                Task { await coordinator.acknowledgeAndCapture(prepareToSelect: dismissMenu) }
            }
                .buttonStyle(.borderedProminent)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 8).padding(.top, 8)
    }

    private func inlineNote(_ message: String, action: String, onAction: @escaping () -> Void) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(message).font(.system(size: 11)).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action, action: onAction).font(.system(size: 11, weight: .medium)).buttonStyle(.plain)
        }
        .padding(.horizontal, 16).padding(.top, 9)
    }
}
