import AppKit
import XCTest
@testable import TalentSignalMac

final class CaptureImageEncoderTests: XCTestCase {
    func testEncoderKeepsReadablePixelDimensionsAndExactDigest() throws {
        let bytes = [UInt8](repeating: 255, count: 4 * 6 * 4)
        let data = Data(bytes)
        let provider = try XCTUnwrap(CGDataProvider(data: data as CFData))
        let image = try XCTUnwrap(CGImage(width: 4, height: 6, bitsPerComponent: 8, bitsPerPixel: 32,
                                         bytesPerRow: 16, space: CGColorSpaceCreateDeviceRGB(),
                                         bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                                         provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
        let encoded = try CaptureImageEncoder.encodePNG(image)
        XCTAssertEqual(encoded.pixelWidth, 4)
        XCTAssertEqual(encoded.pixelHeight, 6)
        XCTAssertEqual(encoded.contentHash.count, 64)
        XCTAssertEqual(Data(encoded.data.prefix(8)), Data([137, 80, 78, 71, 13, 10, 26, 10]))
        XCTAssertEqual(NSBitmapImageRep(data: encoded.data)?.pixelsWide, 4)
    }
}
