import AppKit
import WebKit
import XCTest
@testable import TalentSignalMac

final class WorkspaceMaterialSurfaceTests: XCTestCase {
    @MainActor
    func testUsesNativeBehindWindowMaterialWithoutReplacingWebView() {
        let webView = WKWebView()
        let surface = WorkspaceMaterialSurface(webView: webView)
        XCTAssertTrue(surface.webView === webView)
        XCTAssertEqual(surface.material.material, .sidebar)
        XCTAssertEqual(surface.material.blendingMode, .behindWindow)
        XCTAssertEqual(surface.material.state, .followsWindowActiveState)
        XCTAssertEqual(surface.subviews.count, 2)
    }

    @MainActor
    func testGuardedTransparencyAndLayout() {
        let webView = WKWebView()
        let surface = WorkspaceMaterialSurface(webView: webView)
        surface.frame = NSRect(x: 0, y: 0, width: 900, height: 600)
        surface.layout()
        XCTAssertEqual(surface.material.frame, surface.bounds)
        XCTAssertEqual(webView.frame, surface.bounds)
        if webView.responds(to: NSSelectorFromString("_setDrawsBackground:")) {
            XCTAssertEqual(webView.value(forKey: "drawsBackground") as? Bool, false)
        }
    }
}
