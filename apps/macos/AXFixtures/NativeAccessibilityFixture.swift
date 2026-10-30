import AppKit
import SwiftUI

/// CI-only presentation executable. The production App entry/delegate is not
/// part of this target. Capture mode uses only synthetic pixels and injected
/// in-memory effects; no account, screen capture, updater or browser is started.
@main
struct NativeAccessibilityFixtureApp: App {
    var body: some Scene {
        WindowGroup("Native accessibility fixture") {
            if ProcessInfo.processInfo.arguments.contains("--synthetic-capture-fixture") {
                NativeCaptureFixtureRoot()
            } else if ProcessInfo.processInfo.arguments.contains("--synthetic-workspace-status-fixture") {
                NativeWorkspaceFixtureRoot(mode: .status)
            } else if ProcessInfo.processInfo.arguments.contains("--synthetic-workspace-recovery-fixture") {
                NativeWorkspaceFixtureRoot(mode: .recovery)
            } else if ProcessInfo.processInfo.arguments.contains("--synthetic-workspace-settings-fixture") {
                NativeWorkspaceFixtureRoot(mode: .settings)
            } else {
                NativePresentationFixtureRoot()
            }
        }.defaultSize(width: 900, height: 700)
    }
}

private struct NativePresentationFixtureRoot: View {
    @StateObject private var fixture = NativeAccessibilityFixtureModel()

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Synthetic presentation fixture")
                Spacer()
                Text(fixture.phaseName).accessibilityIdentifier("fixture.phase")
                Button("Next phase") { fixture.nextPhase() }
                    .accessibilityIdentifier("fixture.next")
            }
            HStack(alignment: .top) {
                DesktopBrowserLoginSurface(phase: fixture.phase, matchingHint: "AbC-42",
                                           canCheckResult: fixture.phaseIndex == 6,
                                           onStart: {}, onCancel: {}, onCheckResult: {})
                    .frame(minWidth: 560, maxWidth: .infinity, minHeight: 520)
                VStack {
                    NativePetFixtureHost(fixture: fixture).frame(width: 100, height: 100)
                    Text(String(fixture.opens)).accessibilityIdentifier("fixture.opens")
                    Button("Invoke child default AX action") { fixture.pressActualChild() }
                        .accessibilityIdentifier("fixture.press")
                    Text(fixture.pressResult).accessibilityIdentifier("fixture.pressResult")
                    Text(fixture.invariantsPreserved ? "preserved" : "changed")
                        .accessibilityIdentifier("fixture.invariants")
                }.frame(width: 140)
            }
            HStack {
                Text(fixture.cleaned ? "cleaned" : "active")
                    .accessibilityIdentifier("fixture.preferences")
                Spacer()
                Button("Clear fixture preferences") { fixture.cleanup() }
                    .accessibilityIdentifier("fixture.cleanup")
            }
        }.padding(16).frame(minWidth: 760, minHeight: 620)
    }
}

@MainActor
private final class NativeAccessibilityFixtureModel: ObservableObject {
    static let rawError = "原始返回错误：do not translate %@"
    let suite: String
    let defaults: UserDefaults
    let pet: DesktopPetController
    let preferencesBefore: NSDictionary?
    let destinationBefore: WorkspaceDestination?
    let urlBefore: URL?
    weak var petHost: NSHostingView<DesktopPetArtworkView>?
    @Published var pressResult = "not-run"
    @Published var opens = 0
    @Published var phaseIndex = 0
    @Published var cleaned = false

    init() {
        let name = "com.getyak.acceptance.native-ax.\(UUID().uuidString)"
        suite = name
        let isolated = UserDefaults(suiteName: name)!
        isolated.set(false, forKey: "desktopPet.motion")
        defaults = isolated
        pet = DesktopPetController(defaults: isolated)
        preferencesBefore = isolated.persistentDomain(forName: name) as NSDictionary?
        destinationBefore = WorkspaceNavigation.shared.pending
        urlBefore = WorkspaceNavigation.shared.pendingURL
        pet.openWorkspaceWindow = { [weak self] in self?.opens += 1 }
    }

    var phaseName: String {
        ["idle", "preparing", "waiting", "exchanging", "completed", "cancelled",
         "unresolved-check", "unresolved-restart", "failed"][phaseIndex]
    }
    var phase: DesktopBrowserLoginPhase {
        switch phaseIndex {
        case 0: .idle
        case 1: .preparing
        case 2: .waiting
        case 3: .exchanging
        case 4: .completed(accountID: "fixture-account", userID: "fixture-user")
        case 5: .cancelled
        case 6, 7: .unresolved
        default: .failed(Self.rawError)
        }
    }
    var invariantsPreserved: Bool {
        WorkspaceNavigation.shared.pending == destinationBefore &&
        WorkspaceNavigation.shared.pendingURL == urlBefore &&
        (defaults.persistentDomain(forName: suite) as NSDictionary?) == preferencesBefore
    }
    /// XCTest has already requested the real virtual button. Invoke that
    /// node's public server-side AX handler without granting the UI runner
    /// cross-application CoreAX authority. No controller or parent-press fallback.
    func pressActualChild() {
        guard let host = petHost else { pressResult = "missing-host"; return }
        func attribute(_ node: NSObject, _ modern: String, _ legacyName: String) -> Any? {
            let getter = NSSelectorFromString(modern)
            if node.responds(to: getter), let value = node.perform(getter)?.takeUnretainedValue() {
                if let array = value as? [Any], array.isEmpty { }
                else if let string = value as? String, string.isEmpty { }
                else { return value }
            }
            let legacy = NSSelectorFromString("accessibilityAttributeValue:")
            return node.responds(to: legacy) ? node.perform(legacy, with: legacyName)?.takeUnretainedValue() : nil
        }
        func find(_ node: NSObject, depth: Int = 0) -> NSObject? {
            guard depth < 16 else { return nil }
            if attribute(node, "accessibilityIdentifier", "AXIdentifier") as? String == "desktopPet.openWorkspace" { return node }
            let children = attribute(node, "accessibilityChildren", "AXChildren") as? [Any] ?? []
            for child in children.compactMap({ $0 as? NSObject }) {
                if let value = find(child, depth: depth + 1) { return value }
            }
            return nil
        }
        var actual = find(host)
        if actual == nil, let window = host.window {
            let point = window.convertPoint(toScreen: host.convert(NSPoint(x: host.bounds.midX, y: host.bounds.midY), to: nil))
            actual = host.accessibilityHitTest(point) as? NSObject
        }
        guard let node = actual, node !== host,
              attribute(node, "accessibilityIdentifier", "AXIdentifier") as? String == "desktopPet.openWorkspace",
              attribute(node, "accessibilityRole", "AXRole") as? String == "AXButton" else {
            pressResult = "missing-actual-virtual-child"; return
        }
        let actions = NSSelectorFromString("accessibilityActionNames")
        let legacyPress = NSSelectorFromString("accessibilityPerformAction:")
        let names = node.responds(to: actions) ? node.perform(actions)?.takeUnretainedValue() as? [String] : nil
        if names?.contains("AXPress") == true && node.responds(to: legacyPress) {
            typealias Press = @convention(c) (AnyObject, Selector, NSString) -> Void
            unsafeBitCast(node.method(for: legacyPress), to: Press.self)(node, legacyPress, "AXPress")
            pressResult = "performed"
        } else {
            let selector = NSSelectorFromString("accessibilityPerformPress")
            guard node.responds(to: selector) else { pressResult = "missing-default-action"; return }
            typealias Press = @convention(c) (AnyObject, Selector) -> Bool
            let triggered = unsafeBitCast(node.method(for: selector), to: Press.self)(node, selector)
            pressResult = triggered ? "performed" : "default-action-rejected"
        }
    }
    func nextPhase() { phaseIndex = min(phaseIndex + 1, 8) }
    func cleanup() {
        defaults.removePersistentDomain(forName: suite)
        cleaned = defaults.persistentDomain(forName: suite) == nil
    }
}

/// Plain hosting view: it has no product interaction view's AppKit press override.
private struct NativePetFixtureHost: NSViewRepresentable {
    let fixture: NativeAccessibilityFixtureModel
    func makeNSView(context: Context) -> NSHostingView<DesktopPetArtworkView> {
        let host = NSHostingView(rootView: DesktopPetArtworkView(controller: fixture.pet))
        fixture.petHost = host
        return host
    }
    func updateNSView(_ host: NSHostingView<DesktopPetArtworkView>, context: Context) {
        host.rootView = DesktopPetArtworkView(controller: fixture.pet)
    }
}

/// This branch hosts the product selection NSView and preview controller, but
/// replaces the entire permission/screen, transport, recovery and login-item
/// effect boundary. It never constructs CaptureRuntime or a product App model.
private struct NativeCaptureFixtureRoot: View {
    @StateObject private var fixture = NativeCaptureFixtureModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("SYNTHETIC CAPTURE FIXTURE — no screen or network access")
                .font(.headline)
            HStack {
                Button("Start synthetic capture") { fixture.start() }
                    .accessibilityIdentifier("fixture.capture.start")
                Text(fixture.stage).accessibilityIdentifier("fixture.capture.stage")
            }
            NativeCaptureSelectionHost(fixture: fixture).frame(width: 640, height: 320)
            HStack {
                Text(fixture.windowPreview).accessibilityIdentifier("fixture.capture.windowPreview")
                Text(String(fixture.windowRequests)).accessibilityIdentifier("fixture.capture.windowRequests")
                Text(String(fixture.submissions)).accessibilityIdentifier("fixture.capture.submissions")
            }
            HStack {
                Text(fixture.pngSize).accessibilityIdentifier("fixture.capture.pngSize")
                Text(fixture.maskRGB).accessibilityIdentifier("fixture.capture.maskRGB")
                Text(fixture.clearRGB).accessibilityIdentifier("fixture.capture.clearRGB")
            }
            Text(fixture.effectsPreserved ? "synthetic-only" : "unexpected-effect")
                .accessibilityIdentifier("fixture.capture.effects")
            HStack {
                Text(fixture.cleaned ? "cleaned" : "active")
                    .accessibilityIdentifier("fixture.preferences")
                Spacer()
                Button("Clear fixture preferences") { fixture.cleanup() }
                    .accessibilityIdentifier("fixture.cleanup")
            }
        }.padding(16).frame(minWidth: 760, minHeight: 620)
    }
}

@MainActor
private final class NativeCaptureFixtureModel: ObservableObject {
    static let instant = Date(timeIntervalSince1970: 1_800_000_000)
    let suite: String
    let defaults: UserDefaults
    let loginItem: NativeCaptureLoginItem
    let selector: NativeCaptureSelector
    let recovery: NativeCaptureRecovery
    let transport: NativeCaptureTransport
    let coordinator: CaptureCoordinator
    private let preview = CapturePreviewWindowController()
    weak var selectionView: CaptureSelectionView?
    @Published var stage = "idle"
    @Published var windowPreview = "not-requested"
    @Published var windowRequests = 0
    @Published var submissions = 0
    @Published var pngSize = "not-sent"
    @Published var maskRGB = "not-sent"
    @Published var clearRGB = "not-sent"
    @Published var cleaned = false

    init() {
        suite = "com.getyak.acceptance.native-ax.capture.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)!
        loginItem = NativeCaptureLoginItem()
        // The selector is the permission/screen substitute. No OS permission
        // probe or request is made, even when this synthetic input is allowed.
        selector = NativeCaptureSelector(permissionAllowed: true)
        recovery = NativeCaptureRecovery()
        let context = CaptureContext(origin: "https://synthetic-capture.invalid", ownerScope: "synthetic-owner",
            loginBinding: "synthetic-login", expiresAt: Self.instant.addingTimeInterval(300),
            processing: .init(policyVersion: "synthetic-policy", workspaceLabel: "Synthetic fixture",
                              processorLabels: ["In-memory recorder"], sourceRetentionDays: 1, available: true))
        transport = NativeCaptureTransport(context: context)
        let preferences = CapturePreferences(store: defaults, loginItem: loginItem)
        preferences.afterSelection = .direct
        preferences.acknowledgeProcessingScope(origin: context.origin, ownerScope: context.ownerScope,
            policyVersion: context.processing.policyVersion, at: Self.instant)
        coordinator = CaptureCoordinator(transport: transport, selector: selector, recovery: recovery,
                                         preferences: preferences, now: { Self.instant })
        selector.onSelecting = { [weak self] in
            self?.stage = "focusing-selection"
            DispatchQueue.main.async { [weak self] in
                guard let self, let view = self.selectionView, let window = view.window else { return }
                let accepted = window.makeFirstResponder(view)
                self.stage = accepted && window.firstResponder === view ? "selecting" : "selection-focus-failed"
            }
        }
        transport.onRecorded = { [weak self] data, count in
            guard let self else { return }
            self.submissions = count
            guard let bitmap = NSBitmapImageRep(data: data) else {
                self.pngSize = "invalid-png"; return
            }
            self.pngSize = "\(bitmap.pixelsWide)x\(bitmap.pixelsHigh)"
            self.maskRGB = Self.rgb(bitmap, x: bitmap.pixelsWide / 2, y: bitmap.pixelsHigh / 2)
            self.clearRGB = Self.rgb(bitmap, x: bitmap.pixelsWide * 9 / 10, y: bitmap.pixelsHigh * 9 / 10)
        }
    }

    var effectsPreserved: Bool { loginItem.calls == 0 && selector.systemAccesses == 0 }

    func start() {
        guard stage == "idle" else { return }
        stage = "starting"
        Task {
            await coordinator.startCapture()
            guard coordinator.presentation == .previewReady else { stage = "no-preview"; return }
            stage = "positioning-preview"
            preview.show(coordinator: coordinator)
            // Resolve initial fitting before arranging only this fixture's
            // window. The failed 1024-point CI capture placed its right-hand
            // controls outside the display; keep space for the later drag.
            DispatchQueue.main.async { [weak self] in
                guard let self,
                      let window = NSApp.windows.first(where: { $0.title == "capri · 截图预览" }),
                      let visible = window.screen?.visibleFrame ?? NSScreen.main?.visibleFrame else { return }
                window.contentView?.layoutSubtreeIfNeeded()
                let desired = window.frameRect(forContentRect: NSRect(x: 0, y: 0, width: 760, height: 560)).size
                let size = NSSize(width: min(desired.width, visible.width - 128),
                                  height: min(desired.height, visible.height - 96))
                window.setFrame(NSRect(x: visible.minX + 24, y: visible.maxY - size.height - 24,
                                       width: size.width, height: size.height), display: true)
                window.contentView?.layoutSubtreeIfNeeded()
                window.makeKeyAndOrderFront(nil)
                self.stage = visible.contains(window.frame) ? "preview-ready" : "preview-offscreen"
            }
        }
    }

    func requestedWindow(preview: Bool) {
        windowRequests += 1
        windowPreview = String(preview)
        selector.finish(image: selector.image, preview: preview)
    }

    func cleanup() {
        preview.dismiss()
        selector.cancel()
        coordinator.discardPreview()
        recovery.saved.removeAll()
        transport.clear()
        defaults.removePersistentDomain(forName: suite)
        cleaned = defaults.persistentDomain(forName: suite) == nil && recovery.saved.isEmpty && transport.isEmpty
    }

    private static func rgb(_ bitmap: NSBitmapImageRep, x: Int, y: Int) -> String {
        guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { return "invalid-pixel" }
        return [color.redComponent, color.greenComponent, color.blueComponent]
            .map { String(Int(($0 * 255).rounded())) }.joined(separator: ",")
    }
}

private struct NativeCaptureSelectionHost: NSViewRepresentable {
    let fixture: NativeCaptureFixtureModel

    func makeNSView(context: Context) -> CaptureSelectionView {
        let view = CaptureSelectionView(frame: CGRect(x: 0, y: 0, width: 640, height: 320), image: fixture.selector.image)
        view.setAccessibilityIdentifier("fixture.capture.selection")
        view.setAccessibilityLabel("Synthetic frozen image selection")
        view.didRequestWindow = { [weak fixture] in fixture?.requestedWindow(preview: $0) }
        view.didSelect = { [weak fixture, weak view] area, preview in
            guard let fixture, let view,
                  let pixels = CaptureSelectionGeometry.pixelRect(selection: area, overlaySize: view.bounds.size,
                      imagePixelSize: CGSize(width: fixture.selector.image.width, height: fixture.selector.image.height)),
                  let image = fixture.selector.image.cropping(to: pixels) else { return }
            fixture.selector.finish(image: image, preview: preview)
        }
        view.didCancel = { [weak fixture] in fixture?.selector.cancel() }
        fixture.selectionView = view
        return view
    }

    func updateNSView(_ view: CaptureSelectionView, context: Context) {}
}

private final class NativeCaptureLoginItem: LoginItemRegistering {
    var state: LoginItemState { .notRegistered }
    private(set) var calls = 0
    func register() throws { calls += 1 }
    func unregister() throws { calls += 1 }
}

@MainActor
private final class NativeCaptureSelector: CaptureSelecting {
    let image: CGImage
    let permissionAllowed: Bool
    // This fake deliberately has no system access implementation.
    let systemAccesses = 0
    var onSelecting: (() -> Void)?
    private var pending: CheckedContinuation<CaptureSelectionResult, Error>?

    init(permissionAllowed: Bool) {
        self.permissionAllowed = permissionAllowed
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
        let canvas = CGContext(data: nil, width: 800, height: 400, bitsPerComponent: 8, bytesPerRow: 800 * 4,
            space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        canvas.setFillColor(NSColor.white.cgColor)
        canvas.fill(CGRect(x: 0, y: 0, width: 800, height: 400))
        canvas.setFillColor(NSColor.darkGray.cgColor)
        canvas.fill(CGRect(x: 0, y: 352, width: 800, height: 48))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: canvas, flipped: false)
        ("SYNTHETIC CAPTURE FIXTURE" as NSString).draw(at: CGPoint(x: 20, y: 365),
            withAttributes: [.font: NSFont.systemFont(ofSize: 18), .foregroundColor: NSColor.white])
        NSGraphicsContext.restoreGraphicsState()
        // A unique, synthetic-only bitmap border lets XCTest locate the actual
        // rendered image in its own window PNG, independent of AX union frames.
        // Generic RGB magenta becomes (255,64,255) on the CI display. Give
        // marker production and screenshot sampling the same explicit sRGB.
        canvas.setFillColor(CGColor(colorSpace: colorSpace, components: [1, 0, 1, 1])!)
        for edge in [CGRect(x: 0, y: 0, width: 800, height: 8), CGRect(x: 0, y: 392, width: 800, height: 8),
                     CGRect(x: 0, y: 0, width: 8, height: 400), CGRect(x: 792, y: 0, width: 8, height: 400)] {
            canvas.fill(edge)
        }
        image = canvas.makeImage()!
    }

    func select() async throws -> CaptureSelectionResult {
        guard permissionAllowed else { throw CaptureSelectionError.displayUnavailable }
        return try await withCheckedThrowingContinuation {
            pending = $0
            onSelecting?()
        }
    }

    func finish(image: CGImage, preview: Bool) {
        let continuation = pending
        pending = nil
        continuation?.resume(returning: .init(image: image, capturedAt: NativeCaptureFixtureModel.instant, preview: preview))
    }

    func cancel() {
        let continuation = pending
        pending = nil
        continuation?.resume(throwing: CaptureSelectionError.cancelled)
    }
}

private final class NativeCaptureRecovery: CaptureRecoveryPersisting {
    var saved: [CaptureIntent] = []
    func save(_ intent: CaptureIntent) throws {
        saved.removeAll { $0.id == intent.id }
        saved.append(intent)
    }
    func load(origin: String, ownerScope: String, now: Date) throws -> [CaptureIntent] {
        saved.filter { $0.origin == origin && $0.ownerScope == ownerScope && !$0.isLocallyExpired(at: now) }
    }
    func remove(_ intent: CaptureIntent) throws { saved.removeAll { $0.id == intent.id } }
}

/// A recorder is deliberately not backend acceptance. Its receipt is generated
/// solely to let the real coordinator finish its local preview submission path.
@MainActor
private final class NativeCaptureTransport: CaptureTransporting {
    let current: CaptureContext
    var onRecorded: ((Data, Int) -> Void)?
    private var submissions = 0
    private var recordedPNG: Data?
    private var canonical: CaptureReceipt?

    init(context: CaptureContext) { current = context }
    func context() async throws -> CaptureContext { current }
    func admit(_ intent: CaptureIntent, context: CaptureContext) async throws -> CaptureAdmission {
        guard context == current, intent.canSubmit(context: current, now: NativeCaptureFixtureModel.instant)
        else { throw CaptureTransportError.staleOrigin }
        submissions += 1
        recordedPNG = intent.imagePNG
        canonical = CaptureReceipt(sessionId: intent.sessionId, messageId: intent.messageId, queueEntryId: UUID(),
            status: "queued", imageManifest: [.init(attachmentId: intent.attachmentId,
                byteSize: intent.imageByteSize, contentHash: intent.contentHash)], resultRecorded: false)
        onRecorded?(intent.imagePNG, submissions)
        return CaptureAdmission(sessionId: intent.sessionId, messageId: intent.messageId,
                                queueEntryId: canonical!.queueEntryId, status: "queued")
    }
    func receipt(for intent: CaptureIntent, context: CaptureContext) async throws -> CaptureReceipt? { canonical }
    var isEmpty: Bool { recordedPNG == nil && canonical == nil }
    func clear() { recordedPNG = nil; canonical = nil }
}

private enum NativeWorkspaceFixtureMode: String {
    case status, recovery, settings
}

/// Only the value-driven production presentation is mounted here. In
/// particular, WorkspaceDesktopSettings and ConnectedQuietWorkspace are not
/// constructed: their real browser, updater and permission effects stay out.
private struct NativeWorkspaceFixtureRoot: View {
    let mode: NativeWorkspaceFixtureMode
    @StateObject private var fixture = NativeWorkspaceFixtureModel()
    @FocusState private var focusedSection: WorkspaceSettingsSection?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("SYNTHETIC NATIVE PRESENTATION · \(mode.rawValue)")
                    .font(.caption).accessibilityIdentifier("fixture.workspace.ready")
                Spacer()
                if mode == .recovery {
                    Button("Show synthetic restoring state") { fixture.restoring = true }
                        .accessibilityIdentifier("fixture.workspace.restore")
                }
            }.padding(12)
            Divider()
            surface
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 12) {
                    Text(String(fixture.workbenchCalls)).accessibilityIdentifier("fixture.workspace.workbenchCalls")
                    Text(String(fixture.accountCalls)).accessibilityIdentifier("fixture.workspace.accountCalls")
                    Text(String(fixture.calendarCalls)).accessibilityIdentifier("fixture.workspace.calendarCalls")
                    Text(String(fixture.contentCalls)).accessibilityIdentifier("fixture.workspace.contentCalls")
                    Text(String(fixture.reloadCalls)).accessibilityIdentifier("fixture.workspace.reloadCalls")
                    Text(String(fixture.connectionCalls)).accessibilityIdentifier("fixture.workspace.connectionCalls")
                    Text(fixture.restoring ? "restoring" : "failed").accessibilityIdentifier("fixture.workspace.recoveryMode")
                }
                HStack(spacing: 12) {
                    Text(fixture.selection.rawValue).accessibilityIdentifier("fixture.settings.selection")
                    Text(String(fixture.selectionCalls)).accessibilityIdentifier("fixture.settings.selectionCalls")
                    Text(fixture.activated).accessibilityIdentifier("fixture.settings.activated")
                    Text(String(fixture.floating)).accessibilityIdentifier("fixture.settings.floating")
                    Text(fixture.cleaned ? "cleaned" : "active").accessibilityIdentifier("fixture.preferences")
                    Spacer()
                    Button("Clear fixture state") { fixture.cleanup() }.accessibilityIdentifier("fixture.cleanup")
                }
            }.font(.caption).padding(12)
        }.frame(minWidth: 640, minHeight: 300)
    }

    @ViewBuilder private var surface: some View {
        switch mode {
        case .status:
            WorkspaceStatusLayout(loading: true, notices: fixture.notices) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Synthetic workspace content stays below native notices")
                        .accessibilityIdentifier("fixture.workspace.contentHeading")
                    Button("Record synthetic content action") { fixture.contentCalls += 1 }
                        .accessibilityIdentifier("fixture.workspace.contentAction")
                    Spacer(minLength: 0)
                }.padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        case .recovery:
            WorkspaceRecoverySurface(presentation: fixture.restoring ? .restoringSignIn : .failed(NativeWorkspaceFixtureModel.reason),
                                     reload: { fixture.reloadCalls += 1 },
                                     connectionSettings: { fixture.connectionCalls += 1 })
        case .settings:
            settings
        }
    }

    private var settings: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                // This field only supplies isolated input to the real static
                // search catalog/results. It is not the product search owner.
                TextField("Synthetic settings query", text: Binding(
                    get: { fixture.search.query }, set: { fixture.search.update($0) }))
                    .textFieldStyle(.roundedBorder).accessibilityIdentifier("fixture.settings.query")
                ScrollView {
                    WorkspaceSettingsSections(selection: fixture.selection, focus: $focusedSection) { section in
                        fixture.select(section)
                        focusedSection = section
                    }
                }
                .accessibilityIdentifier("fixture.settings.sections")
            }.padding(12).frame(width: 232).background(.bar)
            Divider()
            WorkspaceSettingsContent(searching: fixture.search.isSearching) {
                WorkspaceSettingsPage(title: fixture.selection.title, summary: "Synthetic page; values remain in memory.") {
                    if fixture.selection == .general {
                        WorkspaceGeneralControls(zoom: $fixture.zoom, floating: $fixture.floating)
                    } else {
                        Text("Synthetic section destination only: \(fixture.selection.rawValue)")
                            .accessibilityIdentifier("fixture.settings.destination")
                    }
                }
                .accessibilityIdentifier("fixture.settings.pane")
            } search: {
                WorkspaceSettingsSearchResults(query: fixture.search.query, results: fixture.search.results,
                    activeID: fixture.search.activeEntry?.id, message: fixture.searchMessage,
                    activate: fixture.activate, dismiss: { fixture.search.reset() })
            }
        }
    }
}

@MainActor
private final class NativeWorkspaceFixtureModel: ObservableObject {
    static let messages = [
        "SYNTHETIC workspace notice: the draft is local. Keep raw text %@ and its separate recovery action visible while other notices remain.",
        "SYNTHETIC account notice: the browser handoff was not confirmed. This fixture records a click only; no browser or account is opened.",
        "SYNTHETIC calendar notice: a fictional file needs attention. This fixture records a click only; no calendar file is opened or imported."
    ]
    static let reason = Array(repeating: "SYNTHETIC failure detail — preserve raw %@ text. No account, network, saved sign-in or real connection is read by this presentation fixture.", count: 8).joined(separator: "\n")
    @Published var workbenchCalls = 0
    @Published var accountCalls = 0
    @Published var calendarCalls = 0
    @Published var contentCalls = 0
    @Published var reloadCalls = 0
    @Published var connectionCalls = 0
    @Published var restoring = false
    @Published var selection: WorkspaceSettingsSection = .general
    @Published var selectionCalls = 0
    @Published var activated = "none"
    @Published var zoom = 1.0
    @Published var floating = false
    @Published var search = WorkspaceSettingsSearchState()
    @Published var searchMessage: String?
    @Published var cleaned = false

    var notices: [WorkspaceStatusNotice] {
        [
            .init(kind: .workbench, message: Self.messages[0], actions: [
                .init(id: "record", title: "Record synthetic workspace action", perform: { [weak self] in self?.workbenchCalls += 1 })]),
            .init(kind: .accountBrowser, message: Self.messages[1], actions: [
                .init(id: "record", title: "Record synthetic account action", perform: { [weak self] in self?.accountCalls += 1 })]),
            .init(kind: .calendarDownload, message: Self.messages[2], actions: [
                .init(id: "record", title: "Record synthetic calendar action", perform: { [weak self] in self?.calendarCalls += 1 })])
        ]
    }

    func select(_ section: WorkspaceSettingsSection) {
        selection = section
        selectionCalls += 1
        search.reset()
        searchMessage = nil
    }

    func activate(_ entry: WorkspaceSettingsSearchEntry) {
        activated = entry.id
        if case .section(let section) = entry.action { select(section) }
        else { searchMessage = "Synthetic external destination recorded; no system effect." }
    }

    func cleanup() {
        search.reset()
        searchMessage = nil
        zoom = 1
        floating = false
        cleaned = true
    }
}
