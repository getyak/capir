import CoreGraphics
import AppKit
import XCTest
@testable import TalentSignalMac

final class CaptureSelectedImageTests: XCTestCase {
    func testDetachedSelectionKeepsTheTopAndBottomTextRowsInTheirOriginalOrder() throws {
        var rgba: [UInt8] = []
        for y in 0..<4 { for _ in 0..<4 { rgba += y < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255] } }
        let provider = try XCTUnwrap(CGDataProvider(data: Data(rgba) as CFData))
        let source = try XCTUnwrap(CGImage(width: 4, height: 4, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: 16,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
        let selected = try XCTUnwrap(CaptureSelectedImage.copyRegion(source, pixels: CGRect(x: 0, y: 0, width: 2, height: 3)))
        let bitmap = NSBitmapImageRep(cgImage: selected)
        XCTAssertGreaterThan(try XCTUnwrap(bitmap.colorAt(x: 0, y: 0)?.usingColorSpace(.deviceRGB)).redComponent, 0.9)
        XCTAssertGreaterThan(try XCTUnwrap(bitmap.colorAt(x: 0, y: 2)?.usingColorSpace(.deviceRGB)).blueComponent, 0.9)
    }
    func testSelectedPixelsOwnABoundedBufferRatherThanTheWholeDesktopProvider() throws {
        let data = Data(repeating: 127, count: 128 * 128 * 4)
        let provider = try XCTUnwrap(CGDataProvider(data: data as CFData))
        let full = try XCTUnwrap(CGImage(width: 128, height: 128, bitsPerComponent: 8, bitsPerPixel: 32,
            bytesPerRow: 512, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider,
            decode: nil, shouldInterpolate: false, intent: .defaultIntent))
        let selected = try XCTUnwrap(CaptureSelectedImage.copyRegion(full, pixels: CGRect(x: 10, y: 10, width: 8, height: 8)))
        XCTAssertEqual(selected.width, 8)
        XCTAssertEqual(selected.height, 8)
        XCTAssertLessThan(CFDataGetLength(try XCTUnwrap(selected.dataProvider?.data)), data.count / 8)
        XCTAssertNil(CaptureSelectedImage.copyRegion(full, pixels: CGRect(x: 127, y: 1, width: 8, height: 8)))
    }
}
