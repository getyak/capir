import Foundation
import WebKit

/// Prevents Web account settings from ever being painted inside the app.
///
/// A client-side `Next.js` route change (`history.pushState`) never reaches
/// `WKNavigationDelegate.decidePolicyFor`, and WebKit delivers the matching
/// `WKWebView.url` KVO callback on a later runloop turn. Native handoff alone
/// therefore leaves a window in which the embedded workbench could render
/// account settings before the browser opens and the workbench is restored.
///
/// This guard runs at document start in the page's main world and marks the
/// document as blocked in the *same* JavaScript turn as the route change, so no
/// settings frame is ever displayed. It unblocks itself on `popstate`, which is
/// exactly the same-document back navigation the native restore uses, so unsent
/// state held by the Web app survives and becomes visible again.
///
/// Failure direction is always "visible". A guard that cannot install, a
/// `history` call that throws (unserializable state, cross-origin URL), or any
/// unexpected page shape leaves the workbench unblocked: the app may briefly show
/// a settings frame, but it can never replace the error overlay with a permanent
/// blank surface.
///
/// It is a display guard only: it grants no capability, reads no data, and
/// changes no navigation. The native side still performs the browser handoff and
/// the workbench restore.
enum WorkspaceSettingsPaintGuard {
    static let settingsPath = "/workspace/settings"
    static let blockedAttribute = "data-ts-settings-blocked"

    /// Kept as plain source so tests can install the exact production script.
    static let scriptSource = """
    (function () {
      var SETTINGS_PATH = '\(settingsPath)';
      var ATTRIBUTE = '\(blockedAttribute)';
      function root() { return document.documentElement || null; }
      function parse(value) {
        try { return new URL(value, location.href); } catch (error) { return null; }
      }
      function isSettings(url) {
        if (url === null || url.origin !== location.origin) { return false; }
        return url.pathname === SETTINGS_PATH || url.pathname.indexOf(SETTINGS_PATH + '/') === 0;
      }
      function unblock() {
        var element = root();
        if (element !== null) { element.removeAttribute(ATTRIBUTE); }
      }
      function apply(value) {
        var element = root();
        if (element === null) { return; }
        if (isSettings(parse(value === undefined ? location.href : value))) {
          element.setAttribute(ATTRIBUTE, '');
        } else {
          element.removeAttribute(ATTRIBUTE);
        }
      }
      try {
        if (window.__tsSettingsPaintGuard === true) { return; }
        window.__tsSettingsPaintGuard = true;
        window.__tsSettingsPaintGuardIsSettings = function (value) {
          try { return isSettings(parse(value)); } catch (error) { return false; }
        };
        window.__tsSettingsPaintGuardUnblock = function () {
          try { unblock(); } catch (error) {}
        };
        ['pushState', 'replaceState'].forEach(function (name) {
          var original = history[name];
          history[name] = function (state, title, url) {
            try {
              return original.apply(this, arguments);
            } finally {
              // Reconcile with the URL that actually committed: a history call
              // that throws changes nothing and must not blank the workbench.
              apply(location.href);
            }
          };
        });
        window.addEventListener('popstate', function () { apply(location.href); });
        window.addEventListener('hashchange', function () { apply(location.href); });
        apply(location.href);
      } catch (error) {
        // A guard that cannot run must never hide the app.
        try { unblock(); } catch (ignored) {}
      }
    })();
    """

    /// Inline CSS keeps the document hidden even if the page later rewrites the
    /// root element's `style` attribute during hydration.
    static let styleSource = """
    html[\(blockedAttribute)] { visibility: hidden !important; }
    """

    static var userScript: WKUserScript {
        WKUserScript(source: scriptSource, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    static var styleScript: WKUserScript {
        WKUserScript(source: """
        (function () {
          var CSS = \(javaScriptString(styleSource));
          function install() {
            try {
              if (document.getElementById('ts-settings-paint-guard') !== null) { return; }
              var style = document.createElement('style');
              style.id = 'ts-settings-paint-guard';
              style.textContent = CSS;
              var parent = document.head || document.documentElement;
              if (parent !== null) { parent.appendChild(style); }
            } catch (error) {}
          }
          install();
          // `document.head` may not exist yet when this runs; retry once the
          // parser has produced a place to put the stylesheet.
          if (document.getElementById('ts-settings-paint-guard') === null) {
            document.addEventListener('DOMContentLoaded', install, { once: true });
            window.addEventListener('load', install, { once: true });
          }
        })();
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    /// Serializes CSS to a JavaScript string literal without hand-escaping.
    private static func javaScriptString(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value])
        guard let data,
              let array = String(data: data, encoding: .utf8),
              array.count >= 2 else { return "\"\"" }
        return String(array.dropFirst().dropLast())
    }

    /// Both halves, in the order every workbench web view must carry them. The
    /// chrome publisher removes all user scripts before reinstalling its own, so
    /// this list is the single definition of what survives that reset.
    static var userScripts: [WKUserScript] { [userScript, styleScript] }

    /// Installs both halves of the guard on a configuration that has not been
    /// used to build a web view yet.
    static func install(on controller: WKUserContentController) {
        for script in userScripts { controller.addUserScript(script) }
    }

    /// True when `url` is a Web account settings route on `origin`. Mirrors the
    /// JavaScript predicate so the native side and the page agree.
    static func isSettings(url: URL, origin: WorkspaceOrigin) -> Bool {
        guard origin.contains(url) else { return false }
        let path = url.path
        return path == settingsPath || path.hasPrefix(settingsPath + "/")
    }
}
