import AppKit
import Foundation

@MainActor
enum SelectionServiceSetup {
    static let menuItemTitle = "Review Selection with capri"

    /// macOS intentionally leaves third-party Services disabled until the user
    /// enables them. This only opens Keyboard settings; capri never
    /// changes the user's Services or shortcut preferences itself.
    @discardableResult
    static func openKeyboardShortcutSettings() -> Bool {
        guard let url = URL(
            string: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension?Shortcuts"
        ) else { return false }
        return NSWorkspace.shared.open(url)
    }
}
