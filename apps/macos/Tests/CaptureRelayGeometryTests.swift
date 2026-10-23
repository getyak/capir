import Foundation
import CoreGraphics
import XCTest
@testable import TalentSignalMac

final class CaptureRelayGeometryTests: XCTestCase {
    private func display(_ scale: CGFloat = 2) -> CaptureRelayDisplay {
        .init(id: 42, frame: CGRect(x: -1200, y: 300, width: 1200, height: 800),
              visibleFrame: CGRect(x: -1200, y: 300, width: 1200, height: 776), scale: scale)
    }

    private func origin(on screen: CaptureRelayDisplay? = nil) throws -> CaptureRegionOrigin {
        try XCTUnwrap(CaptureRegionOrigin.region(
            selection: CGRect(x: 100, y: 200, width: 240, height: 120), display: screen ?? display()))
    }

    func testFlippedRegionUsesGlobalPointsOnNegativeAndStackedDisplaysWithoutScalingTwice() throws {
        for scale: CGFloat in [1, 2] {
            let source = try origin(on: display(scale))
            XCTAssertEqual(source.rect, CGRect(x: -1100, y: 780, width: 240, height: 120))
            XCTAssertEqual(source.display.scale, scale)
            XCTAssertEqual(source.display.id, 42)
        }
    }

    func testInvalidOrCrossDisplayRegionsCannotSupplyAnOrigin() {
        for rect in [CGRect.zero, CGRect(x: -1, y: 20, width: 20, height: 20),
                     CGRect(x: 1190, y: 20, width: 20, height: 20),
                     CGRect(x: CGFloat.nan, y: 20, width: 20, height: 20)] {
            XCTAssertNil(CaptureRegionOrigin.region(selection: rect, display: display()))
        }
        for scale: CGFloat in [0, -1, .infinity, .nan] {
            XCTAssertNil(CaptureRegionOrigin.region(selection: CGRect(x: 1, y: 1, width: 10, height: 10),
                                                   display: display(scale)))
        }
        var missingID = display()
        missingID.id = 0
        XCTAssertNil(CaptureRegionOrigin.region(selection: CGRect(x: 1, y: 1, width: 10, height: 10),
                                               display: missingID))
    }

    func testFlightUsesActualEndpointsAndFigmaArcWithOrderedTimesAndSafeWholeFrames() throws {
        let source = try origin()
        let destination = CaptureRelayDestination(rect: CGRect(x: -300, y: 450, width: 72, height: 36), display: display())
        let flight = try XCTUnwrap(CaptureRelayGeometry.flight(from: source, to: destination,
                                                              reducedMotion: false, motionEnabled: true))
        XCTAssertEqual(flight.duration, 0.420)
        XCTAssertEqual(flight.frames.first, source.rect)
        XCTAssertEqual(flight.frames.last, destination.rect)
        XCTAssertEqual(flight.keyTimes.first, 0)
        XCTAssertEqual(flight.keyTimes.last, 1)
        XCTAssertEqual(flight.frames.count, flight.keyTimes.count)
        XCTAssertTrue(zip(flight.keyTimes, flight.keyTimes.dropFirst()).allSatisfy { $0 < $1 })
        XCTAssertTrue(flight.frames.allSatisfy { display().frame.contains($0) })
        let middle = flight.frames[flight.frames.count / 2]
        let progress = (middle.midX - source.rect.midX) / (destination.rect.midX - source.rect.midX)
        let straightY = source.rect.midY + progress * (destination.rect.midY - source.rect.midY)
        XCTAssertGreaterThan(middle.midY, straightY, "The arc rises in AppKit coordinates, rather than bending below the source")
    }

    func testUnknownCrossDisplayChangedScaleAndHiddenTargetsFallBackInsteadOfInventingGeometry() throws {
        let source = try origin()
        let destination = CaptureRelayDestination(rect: CGRect(x: -300, y: 450, width: 72, height: 36), display: display())
        XCTAssertNil(CaptureRelayGeometry.flight(from: nil, to: destination, reducedMotion: false, motionEnabled: true))
        XCTAssertNil(CaptureRelayGeometry.flight(from: source, to: nil, reducedMotion: false, motionEnabled: true))
        for alteredDisplay in [CaptureRelayDisplay(id: 99, frame: display().frame, visibleFrame: display().visibleFrame, scale: 2), display(1),
                               CaptureRelayDisplay(id: 42, frame: CGRect(x: -1000, y: 300, width: 1000, height: 800),
                                                   visibleFrame: CGRect(x: -1000, y: 300, width: 1000, height: 776), scale: 2)] {
            XCTAssertNil(CaptureRelayGeometry.flight(from: source,
                to: .init(rect: destination.rect, display: alteredDisplay), reducedMotion: false, motionEnabled: true))
        }
        XCTAssertNil(CaptureRelayGeometry.flight(from: source,
            to: .init(rect: CGRect(x: -40, y: 450, width: 72, height: 36), display: display()),
            reducedMotion: false, motionEnabled: true), "A visible center is insufficient when part of the attachment is offscreen")
    }

    func testQuietAndReduceMotionNeverProduceTravel() throws {
        let source = try origin()
        let target = CaptureRelayDestination(rect: CGRect(x: -300, y: 450, width: 72, height: 36), display: display())
        XCTAssertNil(CaptureRelayGeometry.flight(from: source, to: target, reducedMotion: true, motionEnabled: true))
        XCTAssertNil(CaptureRelayGeometry.flight(from: source, to: target, reducedMotion: false, motionEnabled: false))
    }

    func testTopEdgeWithoutRoomForAnArcFallsBackAndDoesNotClipTheSelectedImage() throws {
        let screen = CaptureRelayDisplay(id: 1, frame: CGRect(x: 0, y: 0, width: 1000, height: 700),
                                         visibleFrame: CGRect(x: 0, y: 0, width: 1000, height: 700), scale: 1)
        let source = try XCTUnwrap(CaptureRegionOrigin.region(
            selection: CGRect(x: 10, y: 0, width: 60, height: 60), display: screen))
        XCTAssertNil(CaptureRelayGeometry.flight(from: source,
            to: .init(rect: CGRect(x: 800, y: 640, width: 60, height: 60), display: screen),
            reducedMotion: false, motionEnabled: true))
    }
}
