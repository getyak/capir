import AppKit
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
}
