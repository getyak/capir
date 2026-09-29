import AppKit
import Combine
import SwiftUI

enum CaptureRecentConversation: Equatable {
    case checking
    case available(UUID)
    case empty
    case needsSignIn
    case unavailable

    var canContinue: Bool {
        if case .available = self { return true }
        return false
    }

    var menuTitle: String {
        switch self {
        case .checking: "正在查找最近会话"
        case .available: "继续上次会话"
        case .empty: "暂无可继续的会话"
        case .needsSignIn: "登录后可继续会话"
        case .unavailable: "暂时无法读取上次会话"
        }
    }
}

/** One device-owned capture runtime; Web Session data remains server-owned. */
@MainActor
final class CaptureRuntime: ObservableObject {
    static let shared = CaptureRuntime()

    let preferences = CapturePreferences()
    @Published private(set) var coordinator: CaptureCoordinator?
    @Published private(set) var shortcutError: String?
    @Published private(set) var recentConversation: CaptureRecentConversation = .checking
    @Published private(set) var captureOwnerVerified = false

    private let shortcut = CaptureHotKeyController()
    private let recoveryStore: CaptureRecoveryStore
    private let previewWindow = CapturePreviewWindowController()
    private let onboardingWindow = CaptureOnboardingWindowController()
    private let hint = CaptureHintController()
    private var browser: CaptureWebSession?
    private var connectionObserver: AnyCancellable?
    private var shortcutObserver: AnyCancellable?
    private var presentationObserver: AnyCancellable?
    private var openWorkspace: (() -> Void)?
    private var started = false
    private var shortcutInitiated = false
    private var registeredShortcut: CaptureShortcutPreference?
    private var restoringShortcut = false
    private var recentRequestRevision = 0
    private var resumingBrowser: CaptureWebSession?
    private var expiryTask: Task<Void, Never>?
    private var wakeObserver: NSObjectProtocol?

    init(recoveryStore: CaptureRecoveryStore = CaptureRecoveryStore()) {
        self.recoveryStore = recoveryStore
    }

    func start() {
        guard !started else { return }
        started = true
        expireDueLocalImages()
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.expireDueLocalImages() }
        }
        connectionObserver = WorkspaceConnection.shared.$origin.sink { [weak self] origin in
            self?.configure(origin: origin)
        }
        shortcutObserver = preferences.$shortcut.sink { [weak self] choice in
            self?.register(choice)
        }
    }

    func setOpenWorkspace(_ open: @escaping () -> Void) { openWorkspace = open }

    private func configure(origin: WorkspaceOrigin?) {
        if browser?.origin != origin {
            CaptureOverlayController.shared.cancel()
            previewWindow.dismiss()
            onboardingWindow.dismiss()
            hint.dismiss()
            shortcutInitiated = false
        }
        guard let origin else {
            captureOwnerVerified = false
            recentRequestRevision += 1
            recentConversation = .unavailable
            resumingBrowser = nil
            browser = nil; coordinator = nil; presentationObserver = nil
            rescheduleLocalExpiry()
            return
        }
        if browser?.origin == origin { return }
        captureOwnerVerified = false
        recentRequestRevision += 1
        recentConversation = .checking
        resumingBrowser = nil
        let next = CaptureWebSession(origin: origin)
        browser = next
        let coordinator = CaptureCoordinator(transport: next, selector: CaptureOverlayController.shared,
                                             recovery: recoveryStore, preferences: preferences,
                                             onRecoveryChanged: { [weak self] in self?.rescheduleLocalExpiry() },
                                             onVerifiedContext: { [weak self, weak next] _ in
                                                 guard let self, self.browser === next else { return }
                                                 self.captureOwnerVerified = true
                                             })
        self.coordinator = coordinator
        rescheduleLocalExpiry()
        presentationObserver = coordinator.$presentation.sink { [weak self, weak coordinator] state in
            guard let self, let coordinator else { return }
            if case .previewReady = state { self.previewWindow.show(coordinator: coordinator) }
            else { self.previewWindow.dismiss() }
            if self.shortcutInitiated {
                switch state {
                case .needsDisclosure, .needsSignIn, .failed:
                    self.onboardingWindow.show(coordinator: coordinator) { [weak self] in self?.openWorkspace?() }
                case .selecting, .previewReady, .uploading, .processing, .viewable, .unknown, .deletionFailed:
                    self.shortcutInitiated = false
                case .idle: break
                }
            }
            self.hint.show(state, topActivity: self.preferences.topActivityHint == .on) { [weak self] sessionID in
                self?.openSession(sessionID)
            }
        }
        Task { await coordinator.restoreRecovery() }
        Task { await refreshRecentConversation() }
    }

    func expireDueLocalImages() {
        let current = Date()
        coordinator?.expireLocalImages(at: current)
        try? recoveryStore.purgeExpired(now: current)
        rescheduleLocalExpiry()
    }

    private func rescheduleLocalExpiry() {
        expiryTask?.cancel()
        let diskExpiry: Date?
        do { diskExpiry = try recoveryStore.nextExpiry() }
        catch { diskExpiry = Date().addingTimeInterval(60) }
        guard let next = [diskExpiry, coordinator?.nextLocalExpiry].compactMap({ $0 }).min() else {
            expiryTask = nil
            return
        }
        // Retry a failed deletion at a bounded cadence, but wake exactly at
        // the original deadline for a healthy staged image or preview.
        let remaining = next.timeIntervalSinceNow
        let delay = remaining > 0 ? remaining : 60
        expiryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.expireDueLocalImages()
        }
    }

    private func register(_ choice: CaptureShortcutPreference) {
        if restoringShortcut { return }
        do {
            try shortcut.register(choice) { [weak self] in
                guard let self else { return }
                self.shortcutInitiated = true
                if let coordinator = self.coordinator { Task { await coordinator.startCapture() } }
                else { self.openWorkspace?() }
            }
            registeredShortcut = choice
            shortcutError = nil
        } catch {
            shortcutError = (error as? LocalizedError)?.errorDescription ?? "截图快捷键暂时不可用。"
            if let previous = registeredShortcut {
                restoringShortcut = true
                try? preferences.setShortcut(previous)
                restoringShortcut = false
            } else if choice != .defaultShortcut {
                do {
                    try shortcut.register(.defaultShortcut) { [weak self] in
                        guard let self else { return }
                        self.shortcutInitiated = true
                        if let coordinator = self.coordinator { Task { await coordinator.startCapture() } }
                        else { self.openWorkspace?() }
                    }
                    registeredShortcut = .defaultShortcut
                    restoringShortcut = true
                    try? preferences.setShortcut(.defaultShortcut)
                    restoringShortcut = false
                } catch { /* Menu action remains available; show the conflict. */ }
            }
        }
    }

    func openSession(_ sessionID: UUID) {
        Task { await openSessionAfterOwnerReadback(sessionID) }
    }

    private func openSessionAfterOwnerReadback(_ sessionID: UUID) async {
        guard let browser else { return }
        let ownerRevision = coordinator?.currentOwnerRevision
        captureOwnerVerified = false
        do {
            let current = try await browser.context()
            guard self.browser === browser, coordinator?.currentOwnerRevision == ownerRevision else { return }
            if reconcileCaptureOwner(current) { return }
            guard WorkspaceConnection.shared.origin == browser.origin else { return }
            captureOwnerVerified = true
            WorkspaceNavigation.shared.pendingURL = browser.origin.url
                .appendingPathComponent("workspace/sessions/\(sessionID.uuidString.lowercased())")
            openWorkspace?()
            NSApp.activate(ignoringOtherApps: true)
        } catch CaptureTransportError.server(401, _) {
            if self.browser === browser, coordinator?.currentOwnerRevision == ownerRevision { handleSignedOutOwner() }
        } catch {
            if self.browser === browser, coordinator?.currentOwnerRevision == ownerRevision { captureOwnerVerified = false }
        }
    }

    private func handleSignedOutOwner() {
        captureOwnerVerified = false
        coordinator?.rebindOwner(to: nil)
        previewWindow.dismiss()
        onboardingWindow.dismiss()
        hint.dismiss()
        recentConversation = .needsSignIn
    }

    /// Returns true when a previously bound owner changed, so an old result
    /// click cannot navigate before the new owner's recovery is loaded.
    private func reconcileCaptureOwner(_ current: CaptureContext) -> Bool {
        let priorOwner = coordinator?.boundOwnerScope
        let changed = coordinator?.rebindOwner(to: current) == true
        if changed {
            previewWindow.dismiss()
            onboardingWindow.dismiss()
            hint.dismiss()
            if let coordinator { Task { await coordinator.restoreRecovery() } }
        }
        captureOwnerVerified = true
        return changed && priorOwner != nil
    }

    func resumeRecentConversation() async {
        guard recentConversation.canContinue, let browser, resumingBrowser == nil else { return }
        resumingBrowser = browser
        defer { if resumingBrowser === browser { resumingBrowser = nil } }
        let revision = recentRequestRevision + 1
        recentRequestRevision = revision
        let ownerRevision = coordinator?.currentOwnerRevision
        recentConversation = .checking
        captureOwnerVerified = false
        do {
            let current = try await browser.context()
            guard self.browser === browser, recentRequestRevision == revision,
                  coordinator?.currentOwnerRevision == ownerRevision else { return }
            if reconcileCaptureOwner(current) {
                Task { await refreshRecentConversation() }
                return
            }
            let verifiedOwnerRevision = coordinator?.currentOwnerRevision
            let session = try await browser.recentSession(context: current)
            guard self.browser === browser, recentRequestRevision == revision,
                  coordinator?.currentOwnerRevision == verifiedOwnerRevision else { return }
            if let session {
                recentConversation = .available(session)
                openSession(session)
            } else {
                recentConversation = .empty
            }
        } catch CaptureTransportError.server(401, _) {
            if self.browser === browser, recentRequestRevision == revision,
               coordinator?.currentOwnerRevision == ownerRevision { handleSignedOutOwner() }
        } catch {
            if self.browser === browser, recentRequestRevision == revision,
               coordinator?.currentOwnerRevision == ownerRevision {
                captureOwnerVerified = false
                recentConversation = .unavailable
            }
        }
    }

    func refreshRecentConversation() async {
        guard let browser else { recentConversation = .unavailable; return }
        // A passive menu refresh cannot cancel a click that the user already
        // made. A real origin change clears resumingBrowser and starts fresh.
        guard resumingBrowser !== browser else { return }
        let revision = recentRequestRevision + 1
        recentRequestRevision = revision
        let ownerRevision = coordinator?.currentOwnerRevision
        recentConversation = .checking
        captureOwnerVerified = false
        do {
            let current = try await browser.context()
            guard self.browser === browser, recentRequestRevision == revision,
                  coordinator?.currentOwnerRevision == ownerRevision else { return }
            _ = reconcileCaptureOwner(current)
            let verifiedOwnerRevision = coordinator?.currentOwnerRevision
            let session = try await browser.recentSession(context: current)
            guard self.browser === browser, recentRequestRevision == revision,
                  coordinator?.currentOwnerRevision == verifiedOwnerRevision else { return }
            recentConversation = session.map(CaptureRecentConversation.available) ?? .empty
        } catch CaptureTransportError.server(401, _) {
            if self.browser === browser, recentRequestRevision == revision,
               coordinator?.currentOwnerRevision == ownerRevision { handleSignedOutOwner() }
        } catch {
            if self.browser === browser, recentRequestRevision == revision,
               coordinator?.currentOwnerRevision == ownerRevision {
                captureOwnerVerified = false
                recentConversation = .unavailable
            }
        }
    }
}

private struct CaptureHintView: View {
    let title: String
    let detail: String
    let canOpen: Bool
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 10) {
                TSBrandMark(size: 22, monochrome: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 13, weight: .medium))
                    Text(detail).font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                if canOpen { Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(.secondary) }
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .frame(width: 310)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 13))
        }
        .buttonStyle(.plain)
        .disabled(!canOpen)
        .accessibilityLabel(canOpen ? "\(title)，查看会话" : title)
    }
}

@MainActor
private final class CaptureHintController {
    private var panel: NSPanel?
    private var dismissal: Task<Void, Never>?

    func dismiss() {
        dismissal?.cancel()
        dismissal = nil
        panel?.orderOut(nil)
        panel = nil
    }

    func show(_ state: CapturePresentation, topActivity: Bool, open: @escaping (UUID) -> Void) {
        dismiss()
        let title: String
        let detail: String
        var target: UUID?
        switch state {
        case .uploading: title = "正在上传截图"; detail = "仅这次选区"
        case .processing(let session): title = "Agent 正在处理"; detail = "完成后可继续会话"; target = session
        case .viewable(let session): title = "可以查看了"; detail = "继续这次会话"; target = session
        case .unknown: title = "送达状态待确认"; detail = "从菜单栏核对并重试"
        case .failed: title = "截图未完成"; detail = "从菜单栏查看恢复方式"
        case .deletionFailed: title = "本机删除未完成"; detail = "从菜单栏重试删除"
        default: return
        }
        // A region is usually released on the screen the pointer occupies.
        // Keep feedback there instead of always jumping to the primary display.
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) })
            ?? NSScreen.main else { return }
        let content = CaptureHintView(title: title, detail: detail, canOpen: target != nil) {
            if let target { open(target) }
        }
        let width: CGFloat = 310, height: CGFloat = 66
        let insets = screen.safeAreaInsets
        let safeFrame = CGRect(x: screen.frame.minX + insets.left,
                               y: screen.frame.minY + insets.bottom,
                               width: screen.frame.width - insets.left - insets.right,
                               height: screen.frame.height - insets.top - insets.bottom)
        let hasCameraHousing = screen.auxiliaryTopLeftArea?.isEmpty == false ||
            screen.auxiliaryTopRightArea?.isEmpty == false
        guard let frame = CaptureHintPlacement.frame(visible: screen.visibleFrame, safe: safeFrame,
                                                     size: CGSize(width: width, height: height),
                                                     prefersTop: topActivity, hasCameraHousing: hasCameraHousing,
                                                     fullScreen: NSApp.currentSystemPresentationOptions.contains(.fullScreen))
        else { return }
        let next = NSPanel(contentRect: frame,
                           styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        next.level = .statusBar
        next.collectionBehavior = [.canJoinAllSpaces]
        next.backgroundColor = .clear
        next.isOpaque = false
        next.contentViewController = NSHostingController(rootView: content)
        next.orderFrontRegardless()
        panel = next
        dismissal = Task { [weak self] in
            try? await Task.sleep(for: .seconds(state == .processing(target ?? UUID()) ? 5 : 9))
            guard !Task.isCancelled else { return }
            self?.panel?.orderOut(nil)
            self?.panel = nil
        }
    }
}

/// Screen-local placement for a brief, content-free processing hint.
/// A Mac camera housing permits the optional centered capsule; an external
/// display uses the ordinary menu-edge toast. Full-screen work stays quiet.
enum CaptureHintPlacement {
    static func frame(visible: CGRect, safe: CGRect, size: CGSize,
                      prefersTop: Bool, hasCameraHousing: Bool, fullScreen: Bool) -> CGRect? {
        // AppKit exposes the active application's full-screen presentation
        // globally, not per display. Suppress rather than guess a Space from
        // visibleFrame (which only describes menu bar and Dock reservations).
        guard !fullScreen else { return nil }
        let available = visible.intersection(safe).insetBy(dx: 12, dy: 8)
        guard !available.isNull, available.width >= size.width, available.height >= size.height else { return nil }
        let x = prefersTop && hasCameraHousing ? available.midX - size.width / 2 : available.maxX - size.width
        return CGRect(x: x, y: available.maxY - size.height, width: size.width, height: size.height)
    }
}
