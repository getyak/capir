import SwiftUI

struct MenuBarPresenceView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Open Quick Panel") {
            openWindow(id: "quick-panel")
        }
        .keyboardShortcut(.space, modifiers: [.command, .shift])

        Button("Open Relationship Workspace") {
            model.selectedNavigation = .workspace
            openWindow(id: "workspace")
        }

        if model.hasActionCenterWork {
            Button("Open Action Center") {
                model.selectedNavigation = .actionCenter
                openWindow(id: "workspace")
            }
        }

        Divider()

        Button(model.isPaused ? "Resume context intake" : "Pause context intake") {
            model.togglePause()
        }
        .disabled(model.isSignedOut)

        Button("Stop local context intake", role: .destructive) {
            model.stopContextIntake()
        }
        .disabled(model.isSignedOut || model.isPaused || (model.capsule.items.isEmpty && model.mode != .working))

        Button("Clear local context", role: .destructive) {
            model.clearLocalContext()
        }
        .disabled(model.capsule.items.isEmpty)

        Button("Sign out and clear local recovery", role: .destructive) {
            Task { await model.signOutAndClearLocalData() }
        }
        .disabled(model.isSignedOut)

        Divider()

        Text(model.menuBarPrivacySummary)
        Text("Status: \(model.isSignedOut ? "Signed out" : (model.isPaused ? "Paused" : model.mode.title))")
        Text("Notifications: off in this MVP")

        Divider()

        Button("Quit capri") {
            NSApplication.shared.terminate(nil)
        }
        .keyboardShortcut("q")
    }
}
