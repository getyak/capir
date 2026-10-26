import Foundation
import Sparkle

struct DesktopUpdatePresentation: Equatable {
    enum Phase: String { case disabled, idle, checking, available, downloading, installing, failed, information }
    var phase: Phase = .disabled
    var version: String?
    var offerID: UUID?
    var progress: Int?
    var status = String(localized: "Signed updates are not enabled in this preview", bundle: .main)
    var lastChecked: Date?
    var canInstall: Bool { phase == .available }
    var busy: Bool { phase == .checking || phase == .downloading || phase == .installing }
}

/// One click authorizes only the offered update, including its eventual relaunch.
/// Sparkle retains all archive verification and installation responsibilities.
@MainActor
final class DesktopUpdateSession {
    private(set) var state = DesktopUpdatePresentation() {
        didSet { onChange?(state) }
    }
    var onChange: ((DesktopUpdatePresentation) -> Void)?
    private var pending: ((SPUUserUpdateChoice) -> Void)?
    private var authorized = false
    private var repliedToReady = false
    private var offeredStage: SPUUserUpdateStage = .notDownloaded

    func configure() { state.phase = .idle; state.status = String(localized: "New versions appear at the lower left", bundle: .main) }
    func checking() {
        guard pending == nil, !authorized else { return }
        state.phase = .checking; state.status = String(localized: "Checking for updates…", bundle: .main)
    }
    func offer(version: String, verified: Bool, informationOnly: Bool, stage: SPUUserUpdateStage = .notDownloaded,
               reply: @escaping (SPUUserUpdateChoice) -> Void) {
        guard pending == nil, !authorized else { reply(.dismiss); return }
        guard verified else { fail(String(localized: "Update information failed signature verification. Your current version remains usable.", bundle: .main)); reply(.dismiss); return }
        state.lastChecked = Date()
        guard !informationOnly else {
            state.phase = .information; state.version = nil
            state.status = String(localized: "A release announcement is available in the release history. It contains no installable update.", bundle: .main)
            reply(.dismiss); return
        }
        pending = reply; offeredStage = stage
        state.offerID = UUID()
        state.version = version; state.progress = nil
        state.phase = .available; state.status = String(format: String(localized: "%@ is available. Click to update and restart", bundle: .main), version)
    }
    func install(offerID: UUID?) {
        guard let offerID, offerID == state.offerID, state.canInstall, let reply = pending else { return }
        pending = nil; authorized = true; repliedToReady = false
        state.offerID = nil
        state.phase = offeredStage == .notDownloaded ? .downloading : .installing
        state.status = offeredStage == .notDownloaded ? String(localized: "Downloading update…", bundle: .main) : String(localized: "Updating and restarting…", bundle: .main)
        reply(.install)
    }
    func downloadProgress(_ percent: Int?) {
        guard authorized, state.phase == .downloading else { return }
        state.progress = percent.map { max(0, min(100, $0)) }
        state.status = state.progress.map { String(format: String(localized: "Downloading update %lld%%", bundle: .main), Int64($0)) } ?? String(localized: "Downloading update…", bundle: .main)
    }
    func extracting() {
        guard authorized else { return }
        state.phase = .installing; state.progress = nil; state.status = String(localized: "Verifying and preparing the update…", bundle: .main)
    }
    func ready(reply: (SPUUserUpdateChoice) -> Void) {
        guard authorized, !repliedToReady, state.phase == .downloading || state.phase == .installing else {
            // Skip cancels staged installation; dismiss could still install on quit.
            reply(.skip); return
        }
        repliedToReady = true
        state.phase = .installing; state.progress = nil; state.status = String(localized: "Updating and restarting…", bundle: .main)
        reply(.install)
    }
    func waitingForQuit() {
        guard authorized else { return }
        state.status = String(localized: "Waiting for the app to quit. If quitting was cancelled, try restarting again.", bundle: .main)
    }
    func noUpdate(status: String, verified: Bool) {
        guard verified else { fail(String(localized: "Update information could not be verified. Your current version remains usable. Try again later.", bundle: .main)); return }
        pending = nil; authorized = false; repliedToReady = false
        state.offerID = nil
        state.phase = .idle; state.version = nil; state.progress = nil
        state.lastChecked = Date(); state.status = status
    }
    func fail(_ message: String = String(localized: "The update could not be completed. Your current version remains usable. Check for updates again.", bundle: .main)) {
        let reply = pending
        pending = nil; authorized = false; repliedToReady = false
        state.offerID = nil
        state.phase = .failed; state.version = nil; state.progress = nil; state.status = message
        reply?(.dismiss)
    }
    func dismiss() {
        pending = nil; authorized = false; repliedToReady = false
        state.offerID = nil
        if state.phase == .available || state.phase == .downloading || state.phase == .installing {
            state.phase = .idle; state.version = nil; state.progress = nil
            state.status = String(localized: "Update ended. You can check for updates again", bundle: .main)
        }
    }
}
