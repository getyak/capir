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

    @MainActor
    func testSelectionCallbacksReleaseTheFullDisplayViewAfterSelectionOrCancel() throws {
        let bytes = Data(repeating: 255, count: 4 * 4 * 4)
        let provider = try XCTUnwrap(CGDataProvider(data: bytes as CFData))
        let image = try XCTUnwrap(CGImage(width: 4, height: 4, bitsPerComponent: 8, bitsPerPixel: 32,
                                        bytesPerRow: 16, space: CGColorSpaceCreateDeviceRGB(),
                                        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                                        provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
        let selector = CaptureOverlayController()
        for cancel in [false, true] {
            weak var releasedView: CaptureSelectionView?
            autoreleasepool {
                let view = CaptureSelectionView(frame: CGRect(x: 0, y: 0, width: 4, height: 4), image: image)
                selector.bindSelectionCallbacks(to: view, image: image)
                releasedView = view
                if cancel { view.didCancel?() }
                else { view.didSelect?(CGRect(x: 0, y: 0, width: 2, height: 2), false) }
            }
            XCTAssertNil(releasedView, "The callback must not retain its owning full-display view")
        }
    }
}
