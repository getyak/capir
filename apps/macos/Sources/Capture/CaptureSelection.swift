import AppKit
import ScreenCaptureKit

enum CaptureSelectionError: LocalizedError {
    case busy, cancelled, empty, outsideDisplay, displayUnavailable

    var errorDescription: String? {
        switch self {
        case .busy: "已有一次截图正在进行。"
        case .cancelled: "截图已取消，没有上传任何内容。"
        case .empty: "请先框选要截取的区域。"
        case .outsideDisplay: "选区超出了当前显示器，请在一块屏幕内重试。"
        case .displayUnavailable: "显示器内容暂时无法获取，请重试截图。"
        }
    }
}

enum CaptureSelectionGeometry {
    /// Selection is measured from the overlay's upper-left corner, then mapped
    /// to the exact captured image. Reject cross-display drags and empty crops.
    static func pixelRect(selection: CGRect, overlaySize: CGSize, imagePixelSize: CGSize) -> CGRect? {
        guard overlaySize.width > 0, overlaySize.height > 0, imagePixelSize.width > 0, imagePixelSize.height > 0,
              selection.width > 0, selection.height > 0, selection.minX >= 0, selection.minY >= 0,
              selection.maxX <= overlaySize.width, selection.maxY <= overlaySize.height else { return nil }
        let scaleX = imagePixelSize.width / overlaySize.width
        let scaleY = imagePixelSize.height / overlaySize.height
        let left = floor(selection.minX * scaleX)
        let top = floor(selection.minY * scaleY)
        let right = ceil(selection.maxX * scaleX)
        let bottom = ceil(selection.maxY * scaleY)
        guard right > left, bottom > top else { return nil }
        return CGRect(x: left, y: top, width: right - left, height: bottom - top)
    }
}

struct CaptureSelectionResult {
    let image: CGImage
    let capturedAt: Date
    let preview: Bool
}

@MainActor
protocol CaptureSelecting {
    func select() async throws -> CaptureSelectionResult
    func cancel()
}

private final class CaptureSelectionPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

private final class CaptureSelectionView: NSView {
    let source: CGImage
    var selection: CGRect = .zero { didSet { needsDisplay = true } }
    var preview = false
    var didSelect: ((CGRect, Bool) -> Void)?
    var didCancel: (() -> Void)?
    var didRequestWindow: (() -> Void)?
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
        case 49: didRequestWindow?() // Space
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

    func select() async throws -> CaptureSelectionResult {
        guard !selecting, continuation == nil else { throw CaptureSelectionError.busy }
        selecting = true
        defer { selecting = false }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
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
            pairs.append((screen, image))
        }
        guard !pairs.isEmpty else { throw CaptureSelectionError.displayUnavailable }
        capturedAt = Date()
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            for (screen, image) in pairs {
                let panel = CaptureSelectionPanel(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
                panel.level = .screenSaver
                panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
                panel.backgroundColor = .clear
                panel.isOpaque = false
                let view = CaptureSelectionView(frame: CGRect(origin: .zero, size: screen.frame.size), image: image)
                view.didSelect = { [weak self] area, preview in
                    guard let self else { return }
                    guard let pixels = CaptureSelectionGeometry.pixelRect(selection: area, overlaySize: view.bounds.size,
                                                                             imagePixelSize: CGSize(width: image.width, height: image.height)),
                          let cropped = image.cropping(to: pixels) else {
                        self.finish(.failure(area.isEmpty ? CaptureSelectionError.empty : CaptureSelectionError.outsideDisplay))
                        return
                    }
                    self.finish(.success(.init(image: cropped, capturedAt: self.capturedAt, preview: preview)))
                }
                view.didCancel = { [weak self] in self?.finish(.failure(CaptureSelectionError.cancelled)) }
                view.didRequestWindow = { [weak self] in self?.selectWindowInstead() }
                panel.contentView = view
                panels.append(panel)
                images[ObjectIdentifier(panel)] = image
                panel.makeKeyAndOrderFront(nil)
                panel.makeFirstResponder(view)
            }
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func selectWindowInstead() {
        for panel in panels { panel.orderOut(nil) }
        panels.removeAll()
        images.removeAll()
        Task { @MainActor in
            do {
                // Agent intake needs readable text, so this route retains the
                // native window pixels. The existing local tool keeps its
                // historical 2560-pixel default.
                let payload = try await SystemWindowCaptureService.shared.captureOneWindow(maximumDimension: nil)
                guard let bitmap = NSBitmapImageRep(data: payload.imagePNG), let image = bitmap.cgImage else {
                    throw CaptureSelectionError.empty
                }
                finish(.success(.init(image: image, capturedAt: capturedAt, preview: false)))
            } catch { finish(.failure(error)) }
        }
    }

    func cancel() { finish(.failure(CaptureSelectionError.cancelled)) }

    private func finish(_ outcome: Result<CaptureSelectionResult, Error>) {
        for panel in panels { panel.orderOut(nil) }
        panels.removeAll()
        images.removeAll()
        let pending = continuation
        continuation = nil
        pending?.resume(with: outcome)
    }
}
