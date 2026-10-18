import AppKit
import WebKit

/** Explicit source inspection through the current WebKit login store. No
 * cookies/tokens are exported and no page receives a native capture bridge. */
@MainActor
final class CaptureOriginalWindowController: NSObject, WKNavigationDelegate, NSWindowDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var allowedURL: URL?
    private var selection: LoginStoreSelection?

    func show(request: URLRequest, selection: LoginStoreSelection) {
        dismiss()
        guard LoginStoreRegistry.shared.isCurrent(selection), let url = request.url else { return }
        self.selection = selection; allowedURL = url
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: selection.storeIdentifier)
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.allowsBackForwardNavigationGestures = false
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 860, height: 640),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "本次截图原图 · 待核对"; window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = view; window.center()
        self.window = window; webView = view
        view.load(request)
        NSApp.activate(ignoringOtherApps: true) // This action is an explicit source-inspect click.
        window.makeKeyAndOrderFront(nil)
    }

    func dismiss() {
        let oldWindow = window
        window = nil
        webView?.stopLoading(); webView?.navigationDelegate = nil
        oldWindow?.delegate = nil; oldWindow?.contentView = nil; oldWindow?.close()
        webView = nil; allowedURL = nil; selection = nil
    }

    func windowWillClose(_ notification: Notification) {
        guard let closing = notification.object as? NSWindow, closing === window else { return }
        webView?.stopLoading(); webView?.navigationDelegate = nil; closing.contentView = nil
        webView = nil; window = nil; allowedURL = nil; selection = nil
    }

    private var current: Bool {
        selection.map { LoginStoreRegistry.shared.isCurrent($0) } == true
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard current && action.targetFrame?.isMainFrame == true && action.request.url == allowedURL else {
            decisionHandler(.cancel); showUnavailable(); return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard current, response.isForMainFrame, response.response.url == allowedURL,
              let http = response.response as? HTTPURLResponse, http.statusCode == 200,
              ["image/png", "image/jpeg", "image/webp"].contains(http.mimeType ?? ""),
              http.expectedContentLength <= 10_000_000 else {
            decisionHandler(.cancel); showUnavailable(); return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showUnavailable() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showUnavailable() }

    private func showUnavailable() {
        guard let window else { return }
        let text = NSTextField(wrappingLabelWithString: "原图暂时无法读取，或来源已失效。请返回原会话重新核对。")
        text.frame = CGRect(x: 24, y: 24, width: 600, height: 60)
        let content = NSView(frame: window.contentLayoutRect)
        content.addSubview(text); window.contentView = content
        webView?.stopLoading(); webView?.navigationDelegate = nil; webView = nil
    }
}
