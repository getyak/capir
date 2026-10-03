import AppKit
import XCTest
@testable import TalentSignalMac

final class CaptureHintPlacementTests: XCTestCase {
    func testNotchedScreenCentersInsideVisibleSafeArea() throws {
        let frame = try XCTUnwrap(CaptureHintPlacement.frame(
            visible: CGRect(x: 0, y: 0, width: 1512, height: 945),
            safe: CGRect(x: 0, y: 0, width: 1512, height: 950),
            size: CGSize(width: 310, height: 66), prefersTop: true,
            hasCameraHousing: true, fullScreen: false))
        XCTAssertEqual(frame.midX, 756)
        XCTAssertEqual(frame.maxY, 937)
    }

    func testExternalScreenFallsBackToItsOwnMenuEdge() throws {
        let frame = try XCTUnwrap(CaptureHintPlacement.frame(
            visible: CGRect(x: -1920, y: -100, width: 1920, height: 1050),
            safe: CGRect(x: -1920, y: -100, width: 1920, height: 1080),
            size: CGSize(width: 310, height: 66), prefersTop: true,
            hasCameraHousing: false, fullScreen: false))
        XCTAssertEqual(frame.maxX, -12)
        XCTAssertEqual(frame.maxY, 942)
    }

    func testFullScreenOrInsufficientSafeSpaceSuppressesTransientHint() {
        let visible = CGRect(x: 0, y: 0, width: 600, height: 400)
        let size = CGSize(width: 310, height: 66)
        XCTAssertNil(CaptureHintPlacement.frame(visible: visible, safe: visible, size: size,
                                                prefersTop: true, hasCameraHousing: true, fullScreen: true))
        XCTAssertNil(CaptureHintPlacement.frame(visible: visible, safe: CGRect(x: 0, y: 0, width: 250, height: 400),
                                                size: size, prefersTop: false, hasCameraHousing: false, fullScreen: false))
    }
}
