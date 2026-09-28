import AppKit
import Combine
import SwiftUI

/** One device-owned capture runtime; Web Session data remains server-owned. */
@MainActor
final class CaptureRuntime: ObservableObject {
    static let shared = CaptureRuntime()

    let preferences = CapturePreferences()
    @Published private(set) var coordinator: CaptureCoordinator?
    @Published private(set) var shortcutError: String?

    private let shortcut = CaptureHotKeyController()
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

    func start() {
        guard !started else { return }
        started = true
        try? CaptureRecoveryStore().purgeExpired()
        connectionObserver = WorkspaceConnection.shared.$origin.sink { [weak self] origin in
            self?.configure(origin: origin)
        }
        shortcutObserver = preferences.$shortcut.sink { [weak self] choice in
            self?.register(choice)
        }
    }

    func setOpenWorkspace(_ open: @escaping () -> Void) { openWorkspace = open }

    private func configure(origin: WorkspaceOrigin?) {
        guard let origin else {
            browser = nil; coordinator = nil; presentationObserver = nil; return
        }
        if browser?.origin == origin { return }
        let next = CaptureWebSession(origin: origin)
        browser = next
        let coordinator = CaptureCoordinator(transport: next, selector: CaptureOverlayController.shared,
                                             recovery: CaptureRecoveryStore(), preferences: preferences)
        self.coordinator = coordinator
        presentationObserver = coordinator.$presentation.sink { [weak self, weak coordinator] state in
            guard let self, let coordinator else { return }
            if case .previewReady = state { self.previewWindow.show(coordinator: coordinator) }
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
        guard let origin = WorkspaceConnection.shared.origin else { return }
        WorkspaceNavigation.shared.pendingURL = origin.url
            .appendingPathComponent("workspace/sessions/\(sessionID.uuidString.lowercased())")
        openWorkspace?()
        NSApp.activate(ignoringOtherApps: true)
    }

    func resumeRecentConversation() async {
        guard let browser else { openWorkspace?(); return }
        do {
            if let session = try await browser.recentSession() { openSession(session) }
            else { openWorkspace?() }
        } catch { openWorkspace?() }
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

    func show(_ state: CapturePresentation, topActivity: Bool, open: @escaping (UUID) -> Void) {
        dismissal?.cancel()
        panel?.orderOut(nil)
        panel = nil
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
        guard let screen = NSScreen.main else { return }
        let content = CaptureHintView(title: title, detail: detail, canOpen: target != nil) {
            if let target { open(target) }
        }
        let width: CGFloat = 310, height: CGFloat = 66
        let x = topActivity ? screen.visibleFrame.midX - width / 2 : screen.visibleFrame.maxX - width - 16
        let y = screen.visibleFrame.maxY - height - 8
        let next = NSPanel(contentRect: CGRect(x: x, y: y, width: width, height: height),
                           styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        next.level = .statusBar
        next.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
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
