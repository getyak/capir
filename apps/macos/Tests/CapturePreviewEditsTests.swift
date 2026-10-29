import AppKit
import XCTest
@testable import TalentSignalMac

final class CapturePreviewEditsTests: XCTestCase {
    func testResizeKeepsRedactionOnTheSameImagePixels() throws {
        var edits = CapturePreviewEdits()
        edits.resize(to: CGSize(width: 80, height: 80))
        edits.addRedaction(CGRect(x: 20, y: 20, width: 40, height: 40))
        let original = try whiteImage()
        let before = try edits.render(original)

        edits.resize(to: CGSize(width: 160, height: 160))

        XCTAssertEqual(edits.redactions, [CGRect(x: 40, y: 40, width: 80, height: 80)])
        let after = try edits.render(original)
        try assertPixel(after, x: 4, y: 4, isBlack: true)
        try assertPixel(after, x: 0, y: 0, isBlack: false)
        XCTAssertEqual(after.dataProvider?.data as Data?, before.dataProvider?.data as Data?)
    }

    func testResizeKeepsCropAndRedactionTogetherWithoutRestoringExcludedContent() throws {
        var edits = CapturePreviewEdits()
        edits.resize(to: CGSize(width: 80, height: 80))
        edits.setCrop(CGRect(x: 10, y: 10, width: 60, height: 60))
        edits.addRedaction(CGRect(x: 20, y: 20, width: 40, height: 40))
        let original = try whiteImage()
        let before = try edits.render(original)

        edits.resize(to: CGSize(width: 40, height: 40))

        XCTAssertEqual(edits.crop, CGRect(x: 5, y: 5, width: 30, height: 30))
        let after = try edits.render(original)
        XCTAssertEqual(after.width, 6)
        XCTAssertEqual(after.height, 6)
        try assertPixel(after, x: 2, y: 2, isBlack: true)
        try assertPixel(after, x: 0, y: 0, isBlack: false)
        XCTAssertEqual(after.dataProvider?.data as Data?, before.dataProvider?.data as Data?)
    }

    func testTemporaryZeroSizeDoesNotEraseCommittedEdits() throws {
        var edits = CapturePreviewEdits()
        edits.resize(to: CGSize(width: 80, height: 80))
        edits.setCrop(CGRect(x: 10, y: 10, width: 60, height: 60))
        edits.addRedaction(CGRect(x: 20, y: 20, width: 40, height: 40))

        edits.resize(to: .zero)
        edits.resize(to: CGSize(width: 160, height: 160))

        XCTAssertEqual(edits.crop, CGRect(x: 20, y: 20, width: 120, height: 120))
        XCTAssertEqual(edits.redactions, [CGRect(x: 40, y: 40, width: 80, height: 80)])
        let after = try edits.render(whiteImage())
        XCTAssertEqual(after.width, 6)
        try assertPixel(after, x: 2, y: 2, isBlack: true)
    }

    func testNonFiniteLayoutCannotClearOrReplaceCommittedEdits() throws {
        var edits = CapturePreviewEdits()
        edits.resize(to: CGSize(width: 80, height: 80))
        edits.setCrop(CGRect(x: 10, y: 10, width: 60, height: 60))
        edits.addRedaction(CGRect(x: 20, y: 20, width: 40, height: 40))
        let before = try edits.render(whiteImage())

        edits.resize(to: CGSize(width: CGFloat.nan, height: CGFloat.infinity))
        edits.setCrop(CGRect(x: 0, y: 0, width: 1, height: 1))
        edits.addRedaction(CGRect(x: 0, y: 0, width: 1, height: 1))
        let whileUnavailable = try edits.render(whiteImage())
        edits.resize(to: CGSize(width: 80, height: 80))

        XCTAssertEqual(edits.crop, CGRect(x: 10, y: 10, width: 60, height: 60))
        XCTAssertEqual(edits.redactions, [CGRect(x: 20, y: 20, width: 40, height: 40)])
        XCTAssertEqual(whileUnavailable.dataProvider?.data as Data?, before.dataProvider?.data as Data?)
    }

    func testRepeatedFractionalResizesDoNotAccumulateCoordinateDrift() throws {
        var edits = CapturePreviewEdits()
        edits.resize(to: CGSize(width: 80, height: 80))
        edits.setCrop(CGRect(x: 10, y: 10, width: 60, height: 60))
        edits.addRedaction(CGRect(x: 20, y: 20, width: 40, height: 40))
        let before = try edits.render(whiteImage())

        for width in [143.5, 280.125, 64.75, 80] {
            edits.resize(to: CGSize(width: width, height: width))
        }

        XCTAssertEqual(edits.crop, CGRect(x: 10, y: 10, width: 60, height: 60))
        XCTAssertEqual(edits.redactions, [CGRect(x: 20, y: 20, width: 40, height: 40)])
        XCTAssertEqual(try edits.render(whiteImage()).dataProvider?.data as Data?, before.dataProvider?.data as Data?)
    }

    func testOnlyExplicitClearRemovesCommittedEdits() throws {
        var edits = CapturePreviewEdits()
        edits.resize(to: CGSize(width: 80, height: 80))
        edits.setCrop(CGRect(x: 10, y: 10, width: 60, height: 60))
        edits.addRedaction(CGRect(x: 20, y: 20, width: 40, height: 40))

        edits.clear()
        edits.resize(to: CGSize(width: 160, height: 160))

        XCTAssertNil(edits.crop)
        XCTAssertEqual(edits.redactions, [])
        let after = try edits.render(whiteImage())
        XCTAssertEqual(after.width, 8)
        try assertPixel(after, x: 4, y: 4, isBlack: false)
    }

    func testRedactionTouchingImageEdgeSurvivesFractionalCoordinateNormalization() throws {
        var edits = CapturePreviewEdits()
        edits.resize(to: CGSize(width: 300.42857142857144, height: 300.42857142857144))
        edits.addRedaction(CGRect(x: 33.04714285714286, y: 0,
                                 width: 267.3814285714286, height: 300.42857142857144))

        let after = try edits.render(whiteImage())

        try assertPixel(after, x: 7, y: 4, isBlack: true)
        edits.resize(to: CGSize(width: 600.8571428571429, height: 600.8571428571429))
        let resized = try edits.render(whiteImage())
        XCTAssertEqual(resized.dataProvider?.data as Data?, after.dataProvider?.data as Data?)
    }

    private func whiteImage() throws -> CGImage {
        let provider = try XCTUnwrap(CGDataProvider(data: Data(repeating: 255, count: 8 * 8 * 4) as CFData))
        return try XCTUnwrap(CGImage(width: 8, height: 8, bitsPerComponent: 8, bitsPerPixel: 32,
                                    bytesPerRow: 32, space: CGColorSpaceCreateDeviceRGB(),
                                    bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                                    provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
    }

    private func assertPixel(_ image: CGImage, x: Int, y: Int, isBlack: Bool,
                             file: StaticString = #filePath, line: UInt = #line) throws {
        let bitmap = NSBitmapImageRep(cgImage: image)
        let color = try XCTUnwrap(bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB), file: file, line: line)
        if isBlack { XCTAssertLessThan(color.redComponent, 0.05, file: file, line: line) }
        else { XCTAssertGreaterThan(color.redComponent, 0.9, file: file, line: line) }
    }
}
