import AppKit
import Foundation

struct SelectedTextServiceRequest: Sendable {
    let id: UUID
    let text: String
}

extension Notification.Name {
    static let talentSignalSelectedTextServiceRequest = Notification.Name(
        "talent-signal.macos.selected-text-service-request"
    )
}

/// Receives text only when the user explicitly invokes the macOS Service from
/// another app's selected-text menu. It never reads the general pasteboard.
@MainActor
final class SelectedTextServiceProvider: NSObject {
    static let shared = SelectedTextServiceProvider()

    @objc(reviewSelection:userData:error:)
    func reviewSelection(
        _ pasteboard: NSPasteboard,
        userData _: String?,
        error errorPointer: AutoreleasingUnsafeMutablePointer<NSString?>
    ) {
        guard let selectedText = pasteboard.string(forType: .string)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !selectedText.isEmpty else {
            errorPointer.pointee = "Select text before choosing Review Selection with Talent Signal." as NSString
            return
        }
        let request = SelectedTextServiceRequest(id: UUID(), text: selectedText)
        NotificationCenter.default.post(
            name: .talentSignalSelectedTextServiceRequest,
            object: request
        )
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
}

final class TalentSignalMacAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.servicesProvider = SelectedTextServiceProvider.shared
        Task { @MainActor in DesktopPetController.shared.start() }
    }
}
