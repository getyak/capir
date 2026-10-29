import AppKit
import ScreenCaptureKit

private final class CaptureSelectionPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class CaptureSelectionView: NSView {
    let source: CGImage
    var selection: CGRect = .zero { didSet { needsDisplay = true } }
    var preview = false
    var didSelect: ((CGRect, Bool) -> Void)?
    var didCancel: (() -> Void)?
    var didRequestWindow: ((Bool) -> Void)?
    private var start: CGPoint?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(frame: CGRect, image: CGImage) {
        source = image
        super.init(frame: frame)
        let button = NSButton(title: "先预览  P", target: self, action: #selector(enablePreview))
        button.bezelStyle = .rounded
        button.frame = CGRect(x: max(12, frame.width / 2 - 61), y: max(12, frame.height - 52), width: 122, height: 32)
        button.toolTip = "先预览并遮挡内容；松手后不会自动上传。"
        addSubview(button)
    }

    required init?(coder: NSCoder) { nil }

    @objc private func enablePreview() { preview = true }

    override func draw(_ dirtyRect: NSRect) {
        NSImage(cgImage: source, size: bounds.size).draw(in: bounds)
        NSColor.black.withAlphaComponent(0.38).setFill()
        bounds.fill()
        if !selection.isEmpty {
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(rect: selection).addClip()
            NSImage(cgImage: source, size: bounds.size).draw(in: bounds)
            NSGraphicsContext.restoreGraphicsState()
            NSColor.white.setStroke()
            let outline = NSBezierPath(rect: selection)
            outline.lineWidth = 1.5
            outline.stroke()
        }
    }

    override func mouseDown(with event: NSEvent) {
        start = convert(event.locationInWindow, from: nil)
        selection = .zero
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start else { return }
        let current = convert(event.locationInWindow, from: nil)
        selection = CGRect(x: min(start.x, current.x), y: min(start.y, current.y),
                           width: abs(current.x - start.x), height: abs(current.y - start.y))
    }

    override func mouseUp(with event: NSEvent) {
        guard start != nil else { return }
        mouseDragged(with: event)
        start = nil
        didSelect?(selection, preview)
    }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53: didCancel?()        // Escape
        case 49: didRequestWindow?(preview) // Space
        default:
            if event.charactersIgnoringModifiers?.lowercased() == "p" { preview = true }
            else { super.keyDown(with: event) }
        }
    }
}

/** Screens are frozen once per explicit capture, before drawing our overlay. */
@MainActor
final class CaptureOverlayController: CaptureSelecting {
    static let shared = CaptureOverlayController()
    private var continuation: CheckedContinuation<CaptureSelectionResult, Error>?
    private var panels: [CaptureSelectionPanel] = []
    private var images: [ObjectIdentifier: CGImage] = [:]
    private var capturedAt = Date()
    private var selecting = false
    private var selectionRevision = 0
    private var sourceApplication: NSRunningApplication?

    func select() async throws -> CaptureSelectionResult {
        guard !selecting, continuation == nil else { throw CaptureSelectionError.busy }
        selecting = true
        defer { selecting = false }
        let displayObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.cancel() } }
        defer { NotificationCenter.default.removeObserver(displayObserver) }
        let revision = selectionRevision
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard revision == selectionRevision else { throw CaptureSelectionError.cancelled }
        let screens = NSScreen.screens
        var pairs: [(NSScreen, CGImage)] = []
        for screen in screens {
            guard let displayID = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value,
                  let display = content.displays.first(where: { $0.displayID == displayID }) else { continue }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let configuration = SCStreamConfiguration()
            configuration.width = display.width
            configuration.height = display.height
            configuration.showsCursor = false
            configuration.capturesAudio = false
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
            guard revision == selectionRevision else { throw CaptureSelectionError.cancelled }
            pairs.append((screen, image))
        }
        guard !pairs.isEmpty else { throw CaptureSelectionError.displayUnavailable }
        capturedAt = Date()
        sourceApplication = NSWorkspace.shared.frontmostApplication
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            for (screen, image) in pairs {
                let panel = CaptureSelectionPanel(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
                panel.level = .screenSaver
                panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
                panel.backgroundColor = .clear
                panel.isOpaque = false
                panel.isReleasedWhenClosed = false
                let view = CaptureSelectionView(frame: CGRect(origin: .zero, size: screen.frame.size), image: image)
                let display = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber).map {
                    CaptureRelayDisplay(id: $0.uint32Value, frame: screen.frame,
                                        visibleFrame: screen.visibleFrame, scale: screen.backingScaleFactor)
                }
                bindSelectionCallbacks(to: view, image: image, display: display)
                panel.contentView = view
                panels.append(panel)
                images[ObjectIdentifier(panel)] = image
                panel.makeKeyAndOrderFront(nil)
                panel.makeFirstResponder(view)
            }
            // Panels now own the frozen images. Do not keep a second full
            // desktop array alive in this suspended async selection frame.
            pairs.removeAll()
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    /// Capture geometry by value. The view owns these closures and the full
    /// display image, so a closure that captures the view would retain both
    /// after the selection panel closes.
    func bindSelectionCallbacks(to view: CaptureSelectionView, image: CGImage, display: CaptureRelayDisplay? = nil) {
        let overlaySize = view.bounds.size
        view.didSelect = { [weak self] area, preview in
            guard let self else { return }
            guard let pixels = CaptureSelectionGeometry.pixelRect(selection: area, overlaySize: overlaySize,
                                                                  imagePixelSize: CGSize(width: image.width, height: image.height)),
                  let cropped = CaptureSelectedImage.copyRegion(image, pixels: pixels) else {
                self.finish(.failure(area.isEmpty ? CaptureSelectionError.empty : CaptureSelectionError.outsideDisplay))
                return
            }
            let origin = display.flatMap { CaptureRegionOrigin.region(selection: area, display: $0) }
            self.finish(.success(.init(image: cropped, capturedAt: self.capturedAt, preview: preview, origin: origin)))
        }
        view.didCancel = { [weak self] in self?.finish(.failure(CaptureSelectionError.cancelled)) }
        view.didRequestWindow = { [weak self] preview in self?.selectWindowInstead(preview: preview) }
    }

    private func selectWindowInstead(preview: Bool) {
        let revision = selectionRevision
        let selection = CaptureWindowSelection(capturedAt: capturedAt, preview: preview)
        for panel in panels { panel.contentView = nil; panel.close() }
        panels.removeAll()
        images.removeAll()
        Task { @MainActor in
            do {
                // Agent intake needs readable text, so this route retains the
                // native window pixels. The existing local tool keeps its
                // historical 2560-pixel default.
                let payload = try await SystemWindowCaptureService.shared.captureOneWindow(maximumDimension: nil)
                guard revision == selectionRevision else { return }
                finish(.success(try selection.decode(payload.imagePNG)))
            } catch {
                guard revision == selectionRevision else { return }
                finish(.failure(error))
            }
        }
    }

    func cancel() { finish(.failure(CaptureSelectionError.cancelled)) }

    private func finish(_ outcome: Result<CaptureSelectionResult, Error>) {
        selectionRevision += 1
        // Restore only the app displaced by our selector. A later user focus
        // choice, preview editor, or system window picker owns its own focus.
        let restore = panels.contains(where: \.isKeyWindow) &&
            NSWorkspace.shared.frontmostApplication?.processIdentifier == ProcessInfo.processInfo.processIdentifier
        let previousApplication = sourceApplication
        sourceApplication = nil
        for panel in panels { panel.contentView = nil; panel.close() }
        panels.removeAll()
        images.removeAll()
        let pending = continuation
        continuation = nil
        if restore, let previousApplication,
           previousApplication.processIdentifier != ProcessInfo.processInfo.processIdentifier,
           !previousApplication.isTerminated {
            previousApplication.activate(options: [])
        }
        pending?.resume(with: outcome)
    }
}
