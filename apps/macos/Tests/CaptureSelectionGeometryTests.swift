import AppKit
import XCTest
@testable import TalentSignalMac

final class CaptureSelectionGeometryTests: XCTestCase {
    func testRetinaSelectionMapsLogicalPointsToTheExactPixelRegion() {
        let result = CaptureSelectionGeometry.pixelRect(
            selection: CGRect(x: 50, y: 20, width: 220, height: 90),
            overlaySize: CGSize(width: 400, height: 300), imagePixelSize: CGSize(width: 800, height: 600))
        XCTAssertEqual(result, CGRect(x: 100, y: 40, width: 440, height: 180))
    }

    func testSelectionOnSecondDisplayUsesItsOwnScaleAndNeverSpillsAcrossDisplays() {
        let valid = CaptureSelectionGeometry.pixelRect(
            selection: CGRect(x: 30, y: 20, width: 300, height: 180),
            overlaySize: CGSize(width: 1000, height: 600), imagePixelSize: CGSize(width: 1000, height: 600))
        XCTAssertEqual(valid, CGRect(x: 30, y: 20, width: 300, height: 180))
        XCTAssertNil(CaptureSelectionGeometry.pixelRect(
            selection: CGRect(x: 900, y: 20, width: 120, height: 180),
            overlaySize: CGSize(width: 1000, height: 600), imagePixelSize: CGSize(width: 1000, height: 600)))
    }

    func testZeroAreaSelectionNeverCreatesAnImage() {
        XCTAssertNil(CaptureSelectionGeometry.pixelRect(
            selection: CGRect(x: 1, y: 1, width: 0, height: 50),
            overlaySize: CGSize(width: 300, height: 200), imagePixelSize: CGSize(width: 600, height: 400)))
    }
}
