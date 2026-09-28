import AppKit
import SwiftUI

/** First shortcut use needs a real window because the menu is not open. */
struct CaptureOnboardingView: View {
    @ObservedObject var coordinator: CaptureCoordinator
    let openWorkspace: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TSBrandMark(size: 26, monochrome: true)
            switch coordinator.presentation {
            case .needsDisclosure(let context):
                Text("截一下，交给 Agent。").font(.title2.weight(.semibold))
                Text("框选并松手后，所选区域会自动上传到「\(context.processing.workspaceLabel)」，由 \(context.processing.processorLabels.joined(separator: "、")) 处理。")
                Text("只截你选择的区域，不持续录屏；分析不会自动发消息或修改资料。已送达截图遵循工作区 \(context.processing.sourceRetentionDays) 天的会话保留期限。")
                    .font(.callout).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                HStack {
                    Button("暂不") { close() }
                    Spacer()
                    Button("开启截图") {
                        close()
                        Task { await Task.yield(); await coordinator.acknowledgeAndCapture() }
                    }
                        .buttonStyle(.borderedProminent)
                }
            case .needsSignIn:
                Text("先连接工作区").font(.title2.weight(.semibold))
                Text("截图还没有开始。登录后再按快捷键即可选择内容。")
                    .font(.callout).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Button("打开工作区") { openWorkspace(); close() }
                    .buttonStyle(.borderedProminent)
            case .failed(_, let message):
                Text("截图暂不可用").font(.title2.weight(.semibold))
                Text(message).font(.callout).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                HStack {
                    Button("关闭") { close() }
                    Spacer()
                    Button("重试") {
                        close()
                        Task { await Task.yield(); await coordinator.startCapture() }
                    }
                        .buttonStyle(.borderedProminent)
                }
            default:
                EmptyView()
            }
        }
        .padding(26)
        .frame(width: 440, height: 330, alignment: .topLeading)
    }
}

@MainActor
final class CaptureOnboardingWindowController: NSObject, NSWindowDelegate {
    private var window: NSWindow?

    func show(coordinator: CaptureCoordinator, openWorkspace: @escaping () -> Void) {
        if let window { window.makeKeyAndOrderFront(nil); return }
        let next = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 440, height: 330),
                            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        next.title = "Talent Signal · 截图"
        next.delegate = self
        next.contentViewController = NSHostingController(rootView: CaptureOnboardingView(coordinator: coordinator,
                                                                                           openWorkspace: openWorkspace) { [weak self] in
            self?.window?.close()
            self?.window = nil
        })
        next.center()
        window = next
        NSApp.activate(ignoringOtherApps: true)
        next.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) { window = nil }
}
