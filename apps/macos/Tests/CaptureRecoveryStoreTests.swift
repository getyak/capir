import CryptoKit
import Foundation
import XCTest
@testable import TalentSignalMac

private struct FixtureCaptureKey: CapsuleKeyProviding {
    func key(accountID: String) throws -> Data { Data(repeating: 7, count: 32) }
    func deleteKey(accountID: String) throws -> Bool { true }
}

final class CaptureRecoveryStoreTests: XCTestCase {
    private let at = Date(timeIntervalSince1970: 1_800_000_000)

    func testEncryptedRecoverySurvivesRelaunchAndFencesOtherOwners() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = CaptureRecoveryStore(directory: directory, keyProvider: FixtureCaptureKey())
        let context = CaptureContext(origin: "https://workspace.example", ownerScope: "owner-one",
                                     loginBinding: "login-one", expiresAt: at.addingTimeInterval(300),
                                     processing: CaptureProcessing(policyVersion: "policy-one", workspaceLabel: "Workspace",
                                                                   processorLabels: ["Claude · sonnet"], sourceRetentionDays: 30, available: true))
        let image = Data([137, 80, 78, 71, 13, 10, 26, 10, 44, 55])
        let intent = try CaptureIntent(imagePNG: image, context: context, capturedAt: at)
        try store.save(intent)
        let restored = try CaptureRecoveryStore(directory: directory, keyProvider: FixtureCaptureKey())
            .load(origin: context.origin, ownerScope: context.ownerScope, now: at.addingTimeInterval(30))
        XCTAssertEqual(restored, [intent])
        XCTAssertEqual(try store.load(origin: context.origin, ownerScope: "owner-two", now: at), [])
        let raw = try Data(contentsOf: try XCTUnwrap(store.fileURL(for: intent)))
        XCTAssertFalse(raw.range(of: image) != nil, "The local screenshot must be encrypted")
    }

    func testExpiredLocalScreenshotIsRemovedWithoutExtendingItsDeadline() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let context = CaptureContext(origin: "https://workspace.example", ownerScope: "owner-one",
                                     loginBinding: "login-one", expiresAt: at.addingTimeInterval(300),
                                     processing: CaptureProcessing(policyVersion: "policy-one", workspaceLabel: "Workspace",
                                                                   processorLabels: ["Claude · sonnet"], sourceRetentionDays: 30, available: true))
        let store = CaptureRecoveryStore(directory: directory, keyProvider: FixtureCaptureKey())
        let intent = try CaptureIntent(imagePNG: Data([1, 2, 3]), context: context, capturedAt: at)
        try store.save(intent)
        XCTAssertEqual(try store.load(origin: context.origin, ownerScope: context.ownerScope,
                                      now: at.addingTimeInterval(86_400)), [])
        XCTAssertFalse(FileManager.default.fileExists(atPath: try XCTUnwrap(store.fileURL(for: intent)).path))
    }

    func testExpirySweepRemovesUnopenedOwnerPartitions() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = CaptureRecoveryStore(directory: directory, keyProvider: FixtureCaptureKey())
        for owner in ["owner-one", "owner-two"] {
            let context = CaptureContext(origin: "https://workspace.example", ownerScope: owner,
                                         loginBinding: "login", expiresAt: at.addingTimeInterval(300),
                                         processing: .init(policyVersion: "policy", workspaceLabel: "Workspace",
                                                           processorLabels: ["Claude · sonnet"], sourceRetentionDays: 30, available: true))
            try store.save(CaptureIntent(imagePNG: Data([1, 2, 3]), context: context, capturedAt: at))
        }
        try store.purgeExpired(now: at.addingTimeInterval(86_400))
        XCTAssertTrue(try store.load(origin: "https://workspace.example", ownerScope: "owner-one", now: at).isEmpty)
        XCTAssertTrue(try store.load(origin: "https://workspace.example", ownerScope: "owner-two", now: at).isEmpty)
    }

    func testNextExpiryTracksTheOriginalTimestampAcrossOwnerPartitions() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = CaptureRecoveryStore(directory: directory, keyProvider: FixtureCaptureKey())
        for (owner, offset) in [("owner-one", 90.0), ("owner-two", 30.0)] {
            let context = CaptureContext(origin: "https://workspace.example", ownerScope: owner,
                                         loginBinding: "login", expiresAt: at.addingTimeInterval(300),
                                         processing: .init(policyVersion: "policy", workspaceLabel: "Workspace",
                                                           processorLabels: ["Claude · sonnet"], sourceRetentionDays: 30, available: true))
            try store.save(CaptureIntent(imagePNG: Data([1, 2, 3]), context: context,
                                         capturedAt: at.addingTimeInterval(offset)))
        }
        XCTAssertEqual(try store.nextExpiry(now: at), at.addingTimeInterval(30 + 86_400))
        try store.purgeExpired(now: at.addingTimeInterval(30 + 86_400))
        XCTAssertEqual(try store.nextExpiry(now: at), at.addingTimeInterval(90 + 86_400))
    }

    @MainActor
    func testRunningAppRemovesRawRecoveryAtTheCaptureDeadline() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = CaptureRecoveryStore(directory: directory, keyProvider: FixtureCaptureKey())
        let current = Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970))
        let captured = current.addingTimeInterval(-86_400 + 2)
        let context = CaptureContext(origin: "https://workspace.example", ownerScope: "proof-owner",
                                     loginBinding: "proof-login", expiresAt: current.addingTimeInterval(300),
                                     processing: .init(policyVersion: "proof-policy", workspaceLabel: "Proof",
                                                       processorLabels: ["Synthetic"], sourceRetentionDays: 30, available: true))
        let intent = try CaptureIntent(imagePNG: Data([1, 2, 3]), context: context, capturedAt: captured)
        try store.save(intent)
        let path = try XCTUnwrap(store.fileURL(for: intent))
        XCTAssertTrue(FileManager.default.fileExists(atPath: path.path))
        let runtime = CaptureRuntime(recoveryStore: store)
        runtime.expireDueLocalImages()
        for _ in 0..<50 where FileManager.default.fileExists(atPath: path.path) {
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: path.path),
                       "A running app must erase the encrypted raw image without a restart or owner reload")
    }
}
