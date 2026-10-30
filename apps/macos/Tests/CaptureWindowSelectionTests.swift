import AppKit
import XCTest
@testable import TalentSignalMac

final class CaptureWindowSelectionTests: XCTestCase {
    func testExplicitReviewIntentSurvivesWindowImageDecoding() throws {
        let capturedAt = Date(timeIntervalSince1970: 1_700_000_000)
        let selection = CaptureWindowSelection(capturedAt: capturedAt, preview: true)

        let result = try selection.decode(syntheticPNG())

        XCTAssertTrue(result.preview, "Switching capture modes must not bypass explicitly requested review")
        XCTAssertEqual(result.capturedAt, capturedAt)
        XCTAssertEqual(result.image.width, 8)
        XCTAssertEqual(result.image.height, 8)
        XCTAssertNil(result.origin, "A system-selected window must not inherit display-region provenance")
    }

    func testWindowCaptureWithoutExplicitReviewKeepsItsDefaultIntent() throws {
        let selection = CaptureWindowSelection(capturedAt: Date(timeIntervalSince1970: 1_700_000_000), preview: false)
        XCTAssertFalse(try selection.decode(syntheticPNG()).preview)
    }

    func testUnreadableWindowPayloadDoesNotProduceASelection() {
        let selection = CaptureWindowSelection(capturedAt: Date(), preview: true)
        XCTAssertThrowsError(try selection.decode(Data()))
    }

    private func syntheticPNG() throws -> Data {
        let bitmap = try XCTUnwrap(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 8, pixelsHigh: 8,
                                                  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                                  isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 32, bitsPerPixel: 32))
        bitmap.bitmapData?.initialize(repeating: 255, count: 8 * 8 * 4)
        return try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
    }
}
