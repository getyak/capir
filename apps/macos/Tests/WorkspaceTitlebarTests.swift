import AppKit
import SwiftUI
import WebKit
import XCTest
@testable import TalentSignalMac

final class WorkspaceTitlebarTests: XCTestCase {
    @MainActor
    func testConnectedWindowExtendsMaterialWithoutReplacingNativeControls() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 720),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "Synthetic craft workspace"
        let close = window.standardWindowButton(.closeButton)
        let behavior = WorkspaceWindowBehavior.View()
        window.contentView = behavior
        behavior.configureWindow()
        XCTAssertTrue(window.styleMask.contains(.fullSizeContentView))
        XCTAssertTrue(window.titlebarAppearsTransparent)
        XCTAssertEqual(window.titlebarSeparatorStyle, .none)
        XCTAssertFalse(window.isOpaque)
        XCTAssertFalse(window.isMovableByWindowBackground,
                       "Selecting Web text must never drag the window")
        XCTAssertTrue(window.standardWindowButton(.closeButton) === close)
        XCTAssertEqual(window.title, "Synthetic craft workspace")
        window.contentView = nil
    }

    @MainActor
    func testWebControlsStayInsideSystemContentLayoutWhileMaterialCoversTheTitlebar() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 720),
                              styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        let webView = WKWebView()
        let surface = WorkspaceMaterialSurface(webView: webView)
        window.contentView = surface
        surface.layoutSubtreeIfNeeded()
        surface.layout()
        let unobscured = surface.convert(window.contentLayoutRect, from: nil)
        XCTAssertEqual(surface.material.frame, surface.bounds)
        XCTAssertLessThanOrEqual(webView.frame.maxY, unobscured.maxY + 0.5)
        XCTAssertGreaterThan(webView.frame.height, 0)
        XCTAssertGreaterThan(surface.bounds.maxY - webView.frame.maxY, 0,
                             "The native titlebar must retain its own hit region")
        surface.setReducedTransparency(true)
        surface.layout()
        XCTAssertTrue(surface.material.isHidden)
        XCTAssertLessThanOrEqual(webView.frame.maxY, unobscured.maxY + 0.5)
        XCTAssertTrue(surface.webView === webView)
        window.contentView = nil
    }

    @MainActor
    func testHeaderBudgetUsesCssPixelsAndOnlyPublishesChangedGeometry() throws {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 720),
                              styleMask: [.titled, .closable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        let webView = WKWebView()
        var observed: [Double] = []
        let surface = WorkspaceMaterialSurface(webView: webView, onTitlebarLayout: { observed.append($0) })
        window.contentView = surface
        surface.layout()
        let original = try XCTUnwrap(observed.last)
        XCTAssertGreaterThan(original, 0)
        let count = observed.count
        surface.layout()
        XCTAssertEqual(observed.count, count, "Unchanged native geometry cannot cause script churn")
        webView.pageZoom = 2
        surface.layout()
        XCTAssertEqual(try XCTUnwrap(observed.last), original / 2, accuracy: 0.01)
        XCTAssertTrue(surface.webView === webView)
        window.contentView = nil
    }

    @MainActor
    func testProductionRepresentableHonorsSystemHitRegionInsideSwiftUIHost() async throws {
        let origin = try XCTUnwrap(WorkspaceOrigin("https://titlebar-host.invalid"))
        let browser = WorkspaceBrowser(origin: origin)
        browser.retire()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 720),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        let host = NSHostingView(rootView:
            WorkspaceWebSurface(browser: browser, zoom: 1, appearance: .light)
                .ignoresSafeArea(.container, edges: .top)
                .background(WorkspaceWindowBehavior(floating: false)))
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil); window.contentView = nil }
        func surface(in view: NSView) -> WorkspaceMaterialSurface? {
            if let result = view as? WorkspaceMaterialSurface { return result }
            return view.subviews.lazy.compactMap { surface(in: $0) }.first
        }
        for _ in 0..<100 {
            host.layoutSubtreeIfNeeded()
            if let material = surface(in: host), material.bounds.height > 0,
               window.styleMask.contains(.fullSizeContentView) { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let material = try XCTUnwrap(surface(in: host))
        material.layout()
        let safe = material.convert(window.contentLayoutRect, from: nil)
        XCTAssertTrue(window.styleMask.contains(.fullSizeContentView))
        XCTAssertTrue(material.webView === browser.webView)
        XCTAssertGreaterThan(material.webView.frame.height, 0)
        XCTAssertLessThanOrEqual(material.webView.frame.maxY, safe.maxY + 0.5)
        XCTAssertEqual(material.material.frame, material.bounds)
        XCTAssertFalse(window.isMovableByWindowBackground)
    }
}
