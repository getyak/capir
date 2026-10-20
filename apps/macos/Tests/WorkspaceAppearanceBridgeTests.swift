import AppKit
import SwiftUI
import WebKit
import XCTest
@testable import TalentSignalMac

final class WorkspaceAppearanceBridgeTests: XCTestCase {
    func testOnlyClosedAppearanceValuesAreAccepted() {
        XCTAssertEqual(WorkspaceAppearance.allCases.map(\.rawValue), ["system", "light", "dark"])
        XCTAssertNil(WorkspaceAppearance(rawValue: "auto"))
        XCTAssertNil(WorkspaceAppearance(rawValue: "dark; window.close()"))
        XCTAssertNil(WorkspaceAppearance.system.nativeAppearance)
        XCTAssertEqual(WorkspaceAppearance.light.nativeAppearance?.name, .aqua)
        XCTAssertEqual(WorkspaceAppearance.dark.nativeAppearance?.name, .darkAqua)
    }

    @MainActor
    func testOriginFrameAndCurrentNavigationAreAllRequired() throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let own = origin.entryURL
        let foreign = URL(string: "https://foreign.example/workspace")!
        for (source, current, mainFrame, expected): (URL?, URL?, Bool, Bool) in [
            (own, own, true, true),
            (own, own, false, false),
            (foreign, own, true, false),
            (own, foreign, true, false),
            (nil, own, true, false),
            (own, nil, true, false),
            (URL(string: "http://workspace.example/workspace"), own, true, false),
            (URL(string: "https://workspace.example:444/workspace"), own, true, false),
            (URL(string: "https://user@workspace.example/workspace"), own, true, false),
        ] {
            XCTAssertEqual(WorkspaceAppearanceBridge.accepts(
                source: source, current: current, mainFrame: mainFrame, origin: origin), expected)
        }
    }

    @MainActor
    func testAppearanceObserverSurvivesDesktopChromeRepublishingInIsolatedWorld() {
        let scripts = WorkspaceBrowser.workbenchUserScripts(chromeScript: "void 0")
        let appearance = scripts.filter { $0.source == WorkspaceAppearanceBridge.scriptSource }
        XCTAssertEqual(appearance.count, 1)
        XCTAssertTrue(appearance[0].isForMainFrameOnly)
        XCTAssertTrue(scripts.contains { $0.source == WorkspaceSettingsPaintGuard.scriptSource })
        XCTAssertTrue(scripts.contains { $0.source == DesktopUpdateClickBridge.script })
    }

    @MainActor
    func testAppearanceHandlerIsAvailableOnlyInItsIsolatedWorld() async throws {
        let configuration = WKWebViewConfiguration()
        let origin = try XCTUnwrap(WorkspaceOrigin("https://workspace.example"))
        let bridge = WorkspaceAppearanceBridge(controller: configuration.userContentController,
                                               origin: origin) { _ in }
        configuration.userContentController.addUserScript(WorkspaceAppearanceBridge.userScript)
        let webView = WKWebView(frame: .zero, configuration: configuration)
        let probe = AppearanceNavigationProbe()
        webView.navigationDelegate = probe
        let loaded = expectation(description: "local appearance document")
        probe.onFinish = { loaded.fulfill() }
        webView.loadHTMLString("<!doctype html><title>appearance test</title>", baseURL: origin.url)
        await fulfillment(of: [loaded], timeout: 15)
        let expression = "typeof window.webkit?.messageHandlers?.workspaceAppearance"
        let page = try await webView.evaluateJavaScript(expression) as? String
        let isolated = try await webView.evaluateJavaScript(expression, in: nil,
                                                            contentWorld: WorkspaceAppearanceBridge.world) as? String
        XCTAssertEqual(page, "undefined", "Page JavaScript must not receive the native handler")
        XCTAssertEqual(isolated, "object")
        withExtendedLifetime(bridge) {}
    }

    @MainActor
    func testWindowAndSurfaceReleaseExplicitAppearanceAndRestoreOnReattach() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 720),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        let surface = WorkspaceMaterialSurface(webView: WKWebView(), preference: .dark)
        window.contentView = surface
        XCTAssertEqual(window.appearance?.name, .darkAqua)
        XCTAssertEqual(surface.appearance?.name, .darkAqua)
        surface.preference = .light
        XCTAssertEqual(window.appearance?.name, .aqua)
        surface.preference = .system
        XCTAssertNil(window.appearance, "System must not pin today's resolved color")
        XCTAssertNil(surface.appearance)
        surface.preference = .dark
        window.contentView = NSView()
        XCTAssertNil(window.appearance, "A detached Web surface must not tint sign-in or recovery")
        window.contentView = surface
        XCTAssertEqual(window.appearance?.name, .darkAqua)
        window.contentView = nil
    }

    @MainActor
    func testSwiftUIHostReconcilesAppearanceWithoutReplacingWebView() async throws {
        let originalAppearance = NSApp.appearance
        NSApp.appearance = NSAppearance(named: .aqua)
        defer { NSApp.appearance = originalAppearance }
        let origin = try XCTUnwrap(WorkspaceOrigin("https://appearance-host.invalid"))
        let browser = WorkspaceBrowser(origin: origin)
        browser.retire()
        let state = AppearanceHostState()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 720),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        let host = NSHostingView(rootView: AppearanceHost(browser: browser, state: state).preferredColorScheme(nil))
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil); window.contentView = nil }
        let probe = AppearanceNavigationProbe()
        let loaded = expectation(description: "synthetic host document")
        probe.onFinish = { loaded.fulfill() }
        browser.webView.navigationDelegate = probe
        browser.webView.configuration.userContentController.removeAllUserScripts()
        browser.webView.loadHTMLString("<!doctype html><textarea id='draft'>unsent fixture</textarea>", baseURL: origin.url)
        await fulfillment(of: [loaded], timeout: 15)
        func surface(in view: NSView) -> WorkspaceMaterialSurface? {
            if let value = view as? WorkspaceMaterialSurface { return value }
            return view.subviews.lazy.compactMap { surface(in: $0) }.first
        }
        let material = try XCTUnwrap(surface(in: host))
        let webView = browser.webView
        for preference: WorkspaceAppearance in [.dark, .light, .dark, .system] {
            // Change the value input through SwiftUI; never set surface.preference.
            // Origin/bridge contracts are tested separately and on the signed app.
            state.preference = preference
            var dark: Bool?
            for _ in 0..<100 {
                dark = try await webView.evaluateJavaScript("matchMedia('(prefers-color-scheme: dark)').matches") as? Bool
                if material.preference == preference && dark == (preference == .dark) { break }
                try await Task.sleep(for: .milliseconds(20))
            }
            XCTAssertEqual(material.preference, preference)
            XCTAssertEqual(material.appearance?.name, preference.nativeAppearance?.name)
            XCTAssertEqual(window.appearance?.name, preference.nativeAppearance?.name)
            let expected = preference == .dark ? NSAppearance.Name.darkAqua : .aqua
            XCTAssertEqual(material.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]), expected)
            XCTAssertEqual(host.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]), expected)
            XCTAssertEqual(dark, preference == .dark)
            XCTAssertTrue(material.webView === webView, "Theme changes must retain the live WebView")
            let draft = try await webView.evaluateJavaScript("document.getElementById('draft').value") as? String
            XCTAssertEqual(draft, "unsent fixture")
        }
    }

    @MainActor
    func testReducedTransparencyUsesOpaqueBackingAndRestoresActiveStateMaterial() {
        let surface = WorkspaceMaterialSurface(webView: WKWebView())
        surface.setReducedTransparency(true)
        XCTAssertTrue(surface.isOpaque)
        XCTAssertTrue(surface.material.isHidden)
        surface.preference = .dark
        XCTAssertTrue(surface.isOpaque)
        surface.setReducedTransparency(false)
        XCTAssertFalse(surface.isOpaque)
        XCTAssertFalse(surface.material.isHidden)
        XCTAssertEqual(surface.material.state, .followsWindowActiveState)
    }

    @MainActor
    func testChromeKeepsSystemButtonsAndDoesNotMakeContentDraggable() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 720),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "capri"
        let behavior = WorkspaceWindowBehavior.View()
        window.contentView = behavior
        XCTAssertEqual(window.title, "capri", "Window-menu and accessibility identity remain")
        XCTAssertEqual(window.titleVisibility, .hidden)
        XCTAssertTrue(window.titlebarAppearsTransparent)
        XCTAssertFalse(window.isMovableByWindowBackground)
        for button: NSWindow.ButtonType in [.closeButton, .miniaturizeButton, .zoomButton] {
            XCTAssertNotNil(window.standardWindowButton(button))
        }
        XCTAssertFalse(window.styleMask.contains(.fullSizeContentView),
                       "Web controls must stay below the native drag region")
        window.contentView = nil
    }
}

private final class AppearanceHostState: ObservableObject {
    @Published var preference: WorkspaceAppearance = .system
}

private struct AppearanceHost: View {
    let browser: WorkspaceBrowser
    @ObservedObject var state: AppearanceHostState
    var body: some View {
        WorkspaceWebSurface(browser: browser, zoom: 1, appearance: state.preference)
    }
}

@MainActor
private final class AppearanceNavigationProbe: NSObject, WKNavigationDelegate {
    var onFinish: (() -> Void)?
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onFinish?()
    }
}
