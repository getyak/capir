import AppKit
import XCTest
@testable import TalentSignalMac

final class CapturePreviewImageTests: XCTestCase {
    func testOpaqueRedactionRemovesOriginalPixelsFromFinalImage() throws {
        let bytes = [UInt8](repeating: 255, count: 8 * 8 * 4)
        let provider = try XCTUnwrap(CGDataProvider(data: Data(bytes) as CFData))
        let original = try XCTUnwrap(CGImage(width: 8, height: 8, bitsPerComponent: 8, bitsPerPixel: 32,
                                            bytesPerRow: 32, space: CGColorSpaceCreateDeviceRGB(),
                                            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                                            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
        let changed = try CapturePreviewImage.render(original, logicalSize: CGSize(width: 8, height: 8),
                                                     crop: nil, redactions: [CGRect(x: 2, y: 2, width: 4, height: 4)])
        let bitmap = NSBitmapImageRep(cgImage: changed)
        let covered = try XCTUnwrap(bitmap.colorAt(x: 4, y: 4)?.usingColorSpace(.deviceRGB))
        let outside = try XCTUnwrap(bitmap.colorAt(x: 0, y: 0)?.usingColorSpace(.deviceRGB))
        XCTAssertLessThan(covered.redComponent, 0.05)
        XCTAssertGreaterThan(outside.redComponent, 0.9)
    }
}
