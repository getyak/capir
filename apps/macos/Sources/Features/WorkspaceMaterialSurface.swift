import AppKit
import WebKit

/// Native material supplies the desktop colors beneath transparent Web chrome.
/// Web content owns its
/// opaque reading canvas and exposes this backing only for chrome and popovers.
@MainActor
final class WorkspaceMaterialSurface: NSView {
    let material = NSVisualEffectView()
    let webView: WKWebView
    private let onTitlebarLayout: ((Double) -> Void)?
    private var previousTitlebarHeight: Double?
    var preference: WorkspaceAppearance {
        didSet { applyAppearance() }
    }
    private(set) var reducesTransparency = false

    init(webView: WKWebView, preference: WorkspaceAppearance = .system,
         onTitlebarLayout: ((Double) -> Void)? = nil) {
        self.webView = webView
        self.onTitlebarLayout = onTitlebarLayout
        self.preference = preference
        super.init(frame: .zero)
        material.material = .sidebar
        material.blendingMode = .behindWindow
        material.state = .followsWindowActiveState
        material.autoresizingMask = [.width, .height]
        addSubview(material)
        webView.autoresizingMask = [.width, .height]
        addSubview(webView)
        Self.enableTransparentBacking(webView)
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(accessibilityChanged),
            name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
        accessibilityChanged()
    }

    required init?(coder: NSCoder) { nil }

    deinit { NSWorkspace.shared.notificationCenter.removeObserver(self) }

    override func viewWillMove(toWindow newWindow: NSWindow?) {
        if newWindow !== window { window?.appearance = nil }
        super.viewWillMove(toWindow: newWindow)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        applyAppearance()
    }

    private func applyAppearance() {
        appearance = preference.nativeAppearance
        window?.appearance = preference.nativeAppearance
        needsDisplay = true
    }

    @objc private func accessibilityChanged() {
        setReducedTransparency(NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency)
    }

    func setReducedTransparency(_ reduced: Bool) {
        reducesTransparency = reduced
        material.isHidden = reduced
        needsDisplay = true
    }

    override var isOpaque: Bool { reducesTransparency }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if reducesTransparency {
            NSColor.windowBackgroundColor.setFill()
            dirtyRect.fill()
        }
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }

    override func layout() {
        super.layout()
        material.frame = bounds
        // Only the material extends beneath AppKit's standard titlebar. The
        // WebView's complete hit region stays inside the system layout guide,
        // including full-screen transitions and content zoom.
        let content = window.map { bounds.intersection(convert($0.contentLayoutRect, from: nil)) } ?? bounds
        webView.frame = content.isNull ? .zero : content
        let zoom = webView.pageZoom.isFinite && webView.pageZoom > 0 ? webView.pageZoom : 1
        let height = min(128, max(0, Double(bounds.maxY - webView.frame.maxY) / zoom))
        if previousTitlebarHeight != height {
            previousTitlebarHeight = height
            onTitlebarLayout?(height)
        }
    }

    /// WebKit has no public document-backing transparency setter on macOS.
    /// This single, guarded SPI is isolated here; if unavailable, WebKit stays
    /// opaque. underPageBackgroundColor is public but covers overscroll only.
    @discardableResult
    static func enableTransparentBacking(_ webView: WKWebView) -> Bool {
        webView.underPageBackgroundColor = .clear
        guard webView.responds(to: NSSelectorFromString("_setDrawsBackground:")) else { return false }
        webView.setValue(false, forKey: "drawsBackground")
        return true
    }
}
