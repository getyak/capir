import SwiftUI

struct CaptureDeviceSettings: View {
    @ObservedObject private var preferences = CaptureRuntime.shared.preferences
    @ObservedObject private var runtime = CaptureRuntime.shared
    @State private var loginError: String?
    @State private var recordingShortcut = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("菜单栏与截图").font(.headline)
            Text("从正在使用的屏幕选择一块内容，直接交给当前工作区的 Agent。")
                .font(.callout).foregroundStyle(.secondary)

            Toggle("在菜单栏显示 Talent Signal", isOn: $preferences.showMenuBar)
                .accessibilityIdentifier("capture.settings.menuBar")
            HStack {
                Text("截图快捷键")
                Spacer()
                if recordingShortcut {
                    CaptureShortcutRecorder(recorded: { choice in
                        do { try preferences.setShortcut(choice) }
                        catch { NSSound.beep() }
                        recordingShortcut = false
                    }, cancelled: { recordingShortcut = false })
                    .frame(width: 180, height: 28)
                    .overlay { RoundedRectangle(cornerRadius: 6).strokeBorder(.secondary) }
                    .overlay { Text("按下组合键 · Esc 取消").font(.caption).allowsHitTesting(false) }
                } else {
                    Button(preferences.shortcut.displayString) { recordingShortcut = true }
                        .accessibilityLabel("录入截图快捷键，当前 \(preferences.shortcut.displayString)")
                }
            }
            .accessibilityIdentifier("capture.settings.shortcut")
            if let issue = runtime.shortcutError { Text(issue).font(.caption).foregroundStyle(.orange) }

            Picker("框选后", selection: $preferences.afterSelection) {
                Text("自动交给 Agent").tag(CaptureAfterSelection.direct)
                Text("总是先预览").tag(CaptureAfterSelection.preview)
            }
            Text("截图时按 P 也可以临时先预览、裁剪或遮挡。")
                .font(.caption).foregroundStyle(.secondary)

            Picker("顶部活动提示", selection: $preferences.topActivityHint) {
                Text("关闭").tag(CaptureTopActivityHint.off)
                Text("开启").tag(CaptureTopActivityHint.on)
            }
            Text("仅短暂显示通用处理状态，不显示人名或消息。")
                .font(.caption).foregroundStyle(.secondary)

            Toggle("登录时启动", isOn: Binding(get: { preferences.isStartAtLoginEnabled }, set: { next in
                do { _ = try preferences.setStartAtLogin(next); loginError = nil }
                catch { loginError = "macOS 尚未完成登录项设置，请在系统设置中检查。" }
            }))
            if let loginError { Text(loginError).font(.caption).foregroundStyle(.orange) }
            DisclosureGroup("截图处理与保留") {
                VStack(alignment: .leading, spacing: 5) {
                    Text("每次只上传明确框选的区域。处理方以首次启用时显示的当前工作区设置为准；设置改变会要求重新查看。")
                    Text("未上传的本机截图加密保留最多 24 小时；已送达的截图遵循工作区会话保留和来源删除规则。")
                }.font(.caption).foregroundStyle(.secondary).padding(.top, 7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { preferences.refreshLoginItemState() }
    }
}
