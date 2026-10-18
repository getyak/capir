import XCTest
@testable import TalentSignalMac

final class CaptureRelayMotionTests: XCTestCase {
    func testProcessingScansOnlyAfterAdmissionAndAtMostTwicePerIntent() {
        let id = UUID()
        var gate = CaptureRelayMotionGate()
        gate.bind(intentID: id, ownerRevision: 3)
        XCTAssertEqual(gate.scans(intentID: id, ownerRevision: 3, admitted: false, quiet: false), 0)
        XCTAssertEqual(gate.scans(intentID: id, ownerRevision: 3, admitted: true, quiet: false), 2)
        XCTAssertEqual(gate.scans(intentID: id, ownerRevision: 3, admitted: true, quiet: false), 0)
        XCTAssertEqual(gate.scans(intentID: id, ownerRevision: 3, admitted: true, quiet: true), 0)
    }

    func testLandingAndResultVersionNeverReplayAndQuietConsumesTheirMotion() {
        let id = UUID()
        var gate = CaptureRelayMotionGate()
        gate.bind(intentID: id, ownerRevision: 3)
        XCTAssertTrue(gate.land(intentID: id, ownerRevision: 3, quiet: false))
        XCTAssertFalse(gate.land(intentID: id, ownerRevision: 3, quiet: false))
        XCTAssertTrue(gate.reveal(intentID: id, ownerRevision: 3, version: "host-result-1", quiet: false))
        XCTAssertFalse(gate.reveal(intentID: id, ownerRevision: 3, version: "host-result-1", quiet: false))
        XCTAssertFalse(gate.reveal(intentID: id, ownerRevision: 3, version: "host-result-2", quiet: true))
        XCTAssertFalse(gate.reveal(intentID: id, ownerRevision: 3, version: "host-result-2", quiet: false))
    }

    func testOwnerChangeAndSupersedingIntentRejectEveryOldAnimationCallback() {
        let old = UUID(), current = UUID()
        var gate = CaptureRelayMotionGate()
        gate.bind(intentID: old, ownerRevision: 3)
        gate.bind(intentID: current, ownerRevision: 4)
        XCTAssertFalse(gate.land(intentID: old, ownerRevision: 3, quiet: false))
        XCTAssertEqual(gate.scans(intentID: old, ownerRevision: 3, admitted: true, quiet: false), 0)
        XCTAssertFalse(gate.reveal(intentID: old, ownerRevision: 3, version: "old", quiet: false))
        XCTAssertTrue(gate.land(intentID: current, ownerRevision: 4, quiet: false))
        gate.clear()
        XCTAssertFalse(gate.reveal(intentID: current, ownerRevision: 4, version: "late", quiet: false))
    }
}
