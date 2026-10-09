import AppKit
import WebKit

/// Native material supplies the desktop colors beneath transparent Web chrome.
/// No page messages or native capabilities are added. Web content owns its
/// opaque reading canvas and exposes this backing only for chrome and popovers.
@MainActor
final class WorkspaceMaterialSurface: NSView {
    let material = NSVisualEffectView()
    let webView: WKWebView

    init(webView: WKWebView) {
        self.webView = webView
        super.init(frame: .zero)
        material.material = .sidebar
        material.blendingMode = .behindWindow
        material.state = .followsWindowActiveState
        material.autoresizingMask = [.width, .height]
        addSubview(material)
        webView.autoresizingMask = [.width, .height]
        addSubview(webView)
        Self.enableTransparentBacking(webView)
    }

    required init?(coder: NSCoder) { nil }

    override func layout() {
        super.layout()
        material.frame = bounds
        webView.frame = bounds
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
