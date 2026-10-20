import AppKit
import Combine
import SwiftUI
import WebKit

enum WorkspaceAppearance: String, CaseIterable {
    case system, light, dark

    var title: String {
        switch self {
        case .system: "跟随系统"
        case .light: "浅色"
        case .dark: "深色"
        }
    }

    var nativeAppearance: NSAppearance? {
        switch self {
        case .system: nil
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// Keep SwiftUI's platform host in sync as well as the window. A nil
/// presentation preference can leave its previous color scheme cached, so
/// System's environment follows the application's effective appearance.
struct WorkspaceAppearancePresentation: ViewModifier {
    let preference: WorkspaceAppearance?
    @State private var systemScheme: ColorScheme =
        NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? .dark : .light

    func body(content: Content) -> some View {
        content
            .preferredColorScheme(preference?.colorScheme)
            .environment(\.colorScheme, preference?.colorScheme ?? systemScheme)
            .onReceive(NSApp.publisher(for: \.effectiveAppearance, options: [.initial, .new])
                .map { $0.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? ColorScheme.dark : .light }
                .removeDuplicates()
                .receive(on: RunLoop.main)) { scheme in
                if systemScheme != scheme { systemScheme = scheme }
            }
    }
}

/// Display-only, main-frame preference synchronization. Never mirror the
/// resolved color as a permanent override: System must release NSWindow's
/// appearance so WebKit's media query can follow the OS again.
@MainActor
final class WorkspaceAppearanceBridge: NSObject, WKScriptMessageHandler {
    static let world = WKContentWorld.world(name: "TalentSignalAppearance")
    static let name = "workspaceAppearance"
    private let origin: WorkspaceOrigin
    private let onChange: (WorkspaceAppearance) -> Void

    init(controller: WKUserContentController, origin: WorkspaceOrigin,
         onChange: @escaping (WorkspaceAppearance) -> Void) {
        self.origin = origin
        self.onChange = onChange
        super.init()
        controller.add(self, contentWorld: Self.world, name: Self.name)
    }

    // The isolated world shares DOM/storage, but exposes no native API to page
    // JavaScript. Only a fixed appearance enum crosses the boundary.
    static let scriptSource = """
    (() => {
      const key = 'talent-signal-theme';
      const media = matchMedia('(prefers-color-scheme: dark)');
      let previous;
      function preference() {
        try {
          const value = localStorage.getItem(key);
          return value === 'light' || value === 'dark' ? value : 'system';
        } catch (_) { return 'system'; }
      }
      function publish(force) {
        const value = preference();
        if (value === previous && force !== true) return;
        previous = value;
        window.webkit.messageHandlers.workspaceAppearance.postMessage(value);
      }
      function followSystem() {
        if (preference() !== 'system' || !document.documentElement) return;
        document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
        window.dispatchEvent(new Event('talent-signal:theme-change'));
        publish();
      }
      function install() {
        if (!document.documentElement) return;
        new MutationObserver(publish).observe(document.documentElement,
          { attributes: true, attributeFilter: ['data-theme'] });
        publish();
      }
      window.addEventListener('talent-signal:theme-change', publish);
      window.addEventListener('storage', publish);
      // At document start WebKit may not yet expose the committed URL to the
      // native origin gate. Reconcile again once that navigation is visible.
      window.addEventListener('pageshow', () => publish(true));
      media.addEventListener('change', followSystem);
      if (document.documentElement) install();
      else document.addEventListener('DOMContentLoaded', install, { once: true });
    })();
    """

    static var userScript: WKUserScript {
        WKUserScript(source: scriptSource, injectionTime: .atDocumentStart,
                     forMainFrameOnly: true, in: world)
    }

    static func accepts(source: URL?, current: URL?, mainFrame: Bool, origin: WorkspaceOrigin) -> Bool {
        guard mainFrame, let source, let current else { return false }
        return origin.contains(source) && origin.contains(current)
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == Self.name, message.world == Self.world,
              Self.accepts(source: message.frameInfo.request.url, current: message.webView?.url,
                           mainFrame: message.frameInfo.isMainFrame, origin: origin),
              let raw = message.body as? String,
              let value = WorkspaceAppearance(rawValue: raw) else { return }
        onChange(value)
    }

    /// Runs in the page world so existing theme subscribers receive the event.
    /// The choice is a closed enum; the origin is passed as a JS argument.
    static let selectionScript = """
    if (location.origin !== expectedOrigin) return false;
    try {
      if (preference === 'system') localStorage.removeItem('talent-signal-theme');
      else localStorage.setItem('talent-signal-theme', preference);
    } catch (_) { return false; }
    document.documentElement.dataset.theme = preference === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preference;
    window.dispatchEvent(new Event('talent-signal:theme-change'));
    return true;
    """
}
