import SwiftUI

struct CaptureDeviceSettings: View {
    @ObservedObject private var preferences = CaptureRuntime.shared.preferences
    @ObservedObject private var runtime = CaptureRuntime.shared
    @State private var loginError: String?
    @State private var recordingShortcut = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Menu Bar and Screenshots").font(.headline)
            Text("Select an area of your screen and send it directly to the Agent in your current workspace.")
                .font(.callout).foregroundStyle(.secondary)

            Toggle("Show capri in the menu bar", isOn: $preferences.showMenuBar)
                .accessibilityIdentifier("capture.settings.menuBar")
            HStack {
                Text("Screenshot Shortcut")
                Spacer()
                if recordingShortcut {
                    CaptureShortcutRecorder(recorded: { choice in
                        do { try preferences.setShortcut(choice) }
                        catch { NSSound.beep() }
                        recordingShortcut = false
                    }, cancelled: { recordingShortcut = false })
                    .frame(width: 180, height: 28)
                    .overlay { RoundedRectangle(cornerRadius: 6).strokeBorder(.secondary) }
                    .overlay { Text("Press a shortcut · Esc to cancel").font(.caption).allowsHitTesting(false) }
                } else {
                    Button(preferences.shortcut.displayString) { recordingShortcut = true }
                        .accessibilityLabel(String(format: String(localized: "Record screenshot shortcut, currently %@", bundle: .main), preferences.shortcut.displayString))
                }
            }
            .accessibilityIdentifier("capture.settings.shortcut")
            if let issue = runtime.shortcutError { Text(issue).font(.caption).foregroundStyle(.orange) }

            Picker("After Selection", selection: $preferences.afterSelection) {
                Text("Send directly to Agent").tag(CaptureAfterSelection.direct)
                Text("Always preview first").tag(CaptureAfterSelection.preview)
            }
            Text("Press P while taking a screenshot to preview, crop or redact it first.")
                .font(.caption).foregroundStyle(.secondary)

            Picker("Top Activity Hint", selection: $preferences.topActivityHint) {
                Text("Off").tag(CaptureTopActivityHint.off)
                Text("On").tag(CaptureTopActivityHint.on)
            }
            Text("Briefly shows general processing status without names or messages.")
                .font(.caption).foregroundStyle(.secondary)

            Toggle("Start at Login", isOn: Binding(get: { preferences.isStartAtLoginEnabled }, set: { next in
                do { _ = try preferences.setStartAtLogin(next); loginError = nil }
                catch { loginError = String(localized: "macOS has not finished setting up the login item. Check System Settings.", bundle: .main) }
            }))
            if let loginError { Text(loginError).font(.caption).foregroundStyle(.orange) }
            DisclosureGroup("Screenshot Processing and Retention") {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Only the area you explicitly select is uploaded. Processors follow the current workspace settings shown when first enabled; changes require another review.")
                    Text("Screenshots not yet uploaded are encrypted on this Mac for up to 24 hours. Delivered screenshots follow workspace session retention and source deletion rules.")
                }.font(.caption).foregroundStyle(.secondary).padding(.top, 7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { preferences.refreshLoginItemState() }
    }
}
