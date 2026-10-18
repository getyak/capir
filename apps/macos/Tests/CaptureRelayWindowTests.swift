import AppKit
import XCTest
@testable import TalentSignalMac

private final class WindowMemoryPreferences: CapturePreferenceStore {
    var values: [String: Any] = [:]
    func object(forKey key: String) -> Any? { values[key] }
    func set(_ value: Any?, forKey key: String) { values[key] = value }
    func removeObject(forKey key: String) { values.removeValue(forKey: key) }
}

private final class WindowMemoryRecovery: CaptureRecoveryPersisting {
    func save(_ intent: CaptureIntent) throws {}
    func load(origin: String, ownerScope: String, now: Date) throws -> [CaptureIntent] { [] }
    func remove(_ intent: CaptureIntent) throws {}
}

@MainActor private final class WindowNoTransport: CaptureTransporting {
    func context() async throws -> CaptureContext { throw CaptureTransportError.unavailable }
    func admit(_ intent: CaptureIntent, context: CaptureContext) async throws -> CaptureAdmission {
        throw CaptureTransportError.unavailable
    }
    func receipt(for intent: CaptureIntent, context: CaptureContext) async throws -> CaptureReceipt? { nil }
}

@MainActor private final class WindowNoSelector: CaptureSelecting {
    func select() async throws -> CaptureSelectionResult { throw CaptureSelectionError.cancelled }
    func cancel() {}
}

/// These AppKit window checks run in the disposable native test host. They do
/// not request screen capture, access a login, or change OS accessibility settings.
final class CaptureRelayWindowTests: XCTestCase {
    @MainActor func testQuietSnapshotCancelsAnActiveFlightBeforeTheMonitorAndKeepsThePanelBounded() throws {
        let pet = DesktopPetController.shared
        let oldVisible = pet.isVisible, oldMotion = pet.motionEnabled
        let quiet = QuietFixture()
        let controller = CaptureRelayWindowController(accessibility: {
            .init(reduceMotion: quiet.value, reduceTransparency: false)
        })
        defer {
            controller.dismiss()
            pet.isVisible = oldVisible; pet.motionEnabled = oldMotion
        }
        pet.start(); pet.isVisible = true; pet.motionEnabled = true
        let display = try XCTUnwrap(pet.captureAnchor?.display)
        let coordinator = CaptureCoordinator(transport: WindowNoTransport(), selector: WindowNoSelector(),
            recovery: WindowMemoryRecovery(), preferences: CapturePreferences(store: WindowMemoryPreferences()))
        let image = try XCTUnwrap(CGContext(data: nil, width: 4, height: 3, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)?.makeImage())
        let snapshot = CaptureRelaySnapshot(intentID: UUID(), sessionID: UUID(), ownerRevision: 0,
            origin: .init(rect: CGRect(x: display.frame.minX + 40, y: display.frame.minY + 80, width: 120, height: 90), display: display),
            thumbnail: image, expiresAt: Date().addingTimeInterval(300), phase: .processing)
        let originalWindows = Set(NSApp.windows.map(ObjectIdentifier.init))
        controller.show(snapshot, coordinator: coordinator, openSession: { _ in }, inspectSource: {})
        let panel = try XCTUnwrap(NSApp.windows.first {
            !originalWindows.contains(ObjectIdentifier($0)) && $0.title == "截图接力"
        })
        panel.contentView?.layoutSubtreeIfNeeded()
        XCTAssertTrue(display.visibleFrame.contains(panel.frame), "SwiftUI must not grow the panel below the display")
        XCTAssertLessThanOrEqual(panel.frame.height, 480)
        controller.measuredSlot(.init(rect: CGRect(x: display.frame.maxX - 240, y: display.frame.minY + 200,
            width: 72, height: 54), display: display), intentID: snapshot.intentID, ownerRevision: 0)
        let flight = try XCTUnwrap(NSApp.windows.first {
            !originalWindows.contains(ObjectIdentifier($0)) && $0.isVisible && $0.ignoresMouseEvents && $0.frame == display.frame
        })
        XCTAssertFalse(controller.arrived)
        quiet.value = true
        // Intentionally no RunLoop/timer advance: the snapshot wins the race.
        controller.show(snapshot, coordinator: coordinator, openSession: { _ in }, inspectSource: {})
        XCTAssertTrue(controller.arrived)
        XCTAssertFalse(controller.scanActive)
        XCTAssertFalse(flight.isVisible)
        XCTAssertEqual(pet.captureNod, 0)
    }

    private final class QuietFixture { var value = false }
}
