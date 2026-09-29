import AppKit
import Foundation
import WebKit
import XCTest
@testable import TalentSignalMac

@MainActor
private final class SyntheticProofSelection: CaptureSelecting {
    let image: CGImage
    init() {
        let pixels = Data(repeating: 216, count: 4 * 4 * 4)
        let provider = CGDataProvider(data: pixels as CFData)!
        image = CGImage(width: 4, height: 4, bitsPerComponent: 8, bitsPerPixel: 32,
                        bytesPerRow: 16, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                        provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
    }
    func select() async throws -> CaptureSelectionResult {
        .init(image: image, capturedAt: Date(), preview: false)
    }
    func cancel() {}
}

private struct SyntheticProofKey: CapsuleKeyProviding {
    func key(accountID: String) throws -> Data { Data(repeating: 42, count: 32) }
    func deleteKey(accountID: String) throws -> Bool { true }
}

/// Runs only against the explicitly disposable local Web/backend proof host.
/// The cookie is for a seeded synthetic account and never enters test output.
final class CaptureWebSessionIntegrationTests: XCTestCase {
    private struct ProofCookie: Decodable {
        let origin: String
        let cookieName: String
        let cookieValue: String
        let accountId: String
    }

    @MainActor
    func testNativeIsolatedWebKitAdmitsAndReadsExactSyntheticImage() async throws {
        let path = ProcessInfo.processInfo.environment["DESKTOP_CAPTURE_PROOF_COOKIE_FILE"] ??
            "/private/tmp/ts-capture-proof-cookie.json"
        guard FileManager.default.fileExists(atPath: path) else {
            throw XCTSkip("Explicit disposable proof cookie is required.")
        }
        guard path.hasPrefix("/private/tmp/ts-capture-proof-") else {
            return XCTFail("Only a disposable proof cookie file is allowed.")
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        let proof = try JSONDecoder().decode(ProofCookie.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        XCTAssertEqual(proof.cookieName, "talent-signal.session-v2")
        let origin = try XCTUnwrap(WorkspaceOrigin(proof.origin, allowLocalDevelopment: true))
        XCTAssertEqual(origin.url.host, "127.0.0.1")
        XCTAssertEqual(origin.url.scheme, "http")
        XCTAssertTrue(WorkspaceConnection.shared.save(proof.origin, allowLocalDevelopment: true))
        let cookie = try XCTUnwrap(HTTPCookie(properties: [
            .domain: "127.0.0.1", .path: "/", .name: proof.cookieName,
            .value: proof.cookieValue, .expires: Date().addingTimeInterval(3600),
        ]))
        let store = WKWebsiteDataStore(forIdentifier: origin.dataStoreIdentifier).httpCookieStore
        await withCheckedContinuation { continuation in
            store.setCookie(cookie) { continuation.resume() }
        }
        defer { store.delete(cookie) {} }

        let transport = CaptureWebSession(origin: origin)
        async let firstContext = transport.context()
        async let concurrentContext = transport.context()
        let (context, secondContext) = try await (firstContext, concurrentContext)
        // The BFF sets a fresh five-minute expiry on each response, so compare
        // the stable authorization/policy fields rather than wall-clock expiry.
        XCTAssertEqual(context.origin, secondContext.origin)
        XCTAssertEqual(context.ownerScope, secondContext.ownerScope)
        XCTAssertEqual(context.workspaceAccountID, secondContext.workspaceAccountID)
        XCTAssertEqual(context.loginBinding, secondContext.loginBinding)
        XCTAssertEqual(context.processing, secondContext.processing)
        XCTAssertGreaterThan(context.expiresAt, Date())
        XCTAssertGreaterThan(secondContext.expiresAt, Date())
        XCTAssertEqual(context.workspaceAccountID, proof.accountId)
        XCTAssertTrue(context.processing.available)
        let pixels = Data(repeating: 216, count: 4 * 4 * 4)
        let provider = try XCTUnwrap(CGDataProvider(data: pixels as CFData))
        let image = try XCTUnwrap(CGImage(width: 4, height: 4, bitsPerComponent: 8, bitsPerPixel: 32,
                                        bytesPerRow: 16, space: CGColorSpaceCreateDeviceRGB(),
                                        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                                        provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
        let encoded = try CaptureImageEncoder.encodePNG(image)
        XCTAssertEqual(encoded.pixelWidth, 4)
        XCTAssertEqual(encoded.pixelHeight, 4)
        let intent = try CaptureIntent(imagePNG: encoded.data, context: context)
        let admission = try await transport.admit(intent, context: context)
        XCTAssertEqual(admission.sessionId, intent.sessionId)
        XCTAssertEqual(admission.messageId, intent.messageId)

        var receipt: CaptureReceipt?
        for _ in 0..<40 {
            receipt = try await transport.receipt(for: intent, context: context)
            if receipt?.resultRecorded == true { break }
            try await Task.sleep(for: .milliseconds(500))
        }
        let recorded = try XCTUnwrap(receipt)
        XCTAssertTrue(recorded.resultRecorded)
        XCTAssertEqual(recorded.sessionId, intent.sessionId)
        XCTAssertEqual(recorded.messageId, intent.messageId)
        XCTAssertEqual(recorded.imageManifest.count, 1)
        XCTAssertEqual(recorded.imageManifest[0].attachmentId, intent.attachmentId)
        XCTAssertEqual(recorded.imageManifest[0].contentHash, intent.contentHash)
        XCTAssertEqual(recorded.imageManifest[0].byteSize, intent.imageByteSize)
    }

    @MainActor
    func testCoordinatorUsesProductionUploadRecoveryAndResultPathWithSyntheticPixels() async throws {
        let path = ProcessInfo.processInfo.environment["DESKTOP_CAPTURE_PROOF_COOKIE_FILE"] ??
            "/private/tmp/ts-capture-proof-cookie.json"
        guard FileManager.default.fileExists(atPath: path) else {
            throw XCTSkip("Explicit disposable proof cookie is required.")
        }
        guard path.hasPrefix("/private/tmp/ts-capture-proof-") else {
            return XCTFail("Only a disposable proof cookie file is allowed.")
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        let proof = try JSONDecoder().decode(ProofCookie.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        XCTAssertEqual(proof.cookieName, "talent-signal.session-v2")
        let origin = try XCTUnwrap(WorkspaceOrigin(proof.origin, allowLocalDevelopment: true))
        XCTAssertEqual(origin.url.host, "127.0.0.1")
        XCTAssertEqual(origin.url.scheme, "http")
        XCTAssertTrue(WorkspaceConnection.shared.save(proof.origin, allowLocalDevelopment: true))
        let cookie = try XCTUnwrap(HTTPCookie(properties: [
            .domain: "127.0.0.1", .path: "/", .name: proof.cookieName,
            .value: proof.cookieValue, .expires: Date().addingTimeInterval(3600),
        ]))
        let cookieStore = WKWebsiteDataStore(forIdentifier: origin.dataStoreIdentifier).httpCookieStore
        await withCheckedContinuation { continuation in
            cookieStore.setCookie(cookie) { continuation.resume() }
        }
        defer { cookieStore.delete(cookie) {} }

        let transport = CaptureWebSession(origin: origin)
        let context = try await transport.context()
        XCTAssertEqual(context.workspaceAccountID, proof.accountId)
        let suite = "desktop-capture-proof-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = CapturePreferences(store: defaults)
        preferences.acknowledgeProcessingScope(origin: context.origin, ownerScope: context.ownerScope,
                                               policyVersion: context.processing.policyVersion, at: Date())
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ts-capture-proof-recovery-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let recovery = CaptureRecoveryStore(directory: directory, keyProvider: SyntheticProofKey())
        let coordinator = CaptureCoordinator(transport: transport, selector: SyntheticProofSelection(),
                                             recovery: recovery, preferences: preferences)
        await coordinator.startCapture()
        for _ in 0..<40 {
            if case .viewable = coordinator.presentation { break }
            await coordinator.refreshCurrentStatus()
            try await Task.sleep(for: .milliseconds(500))
        }
        guard case .viewable(let sessionID) = coordinator.presentation else {
            return XCTFail("The exact canonical Session result must become viewable.")
        }
        XCTAssertNotEqual(sessionID, UUID(uuidString: "00000000-0000-0000-0000-000000000000"))
        XCTAssertTrue(try recovery.load(origin: context.origin, ownerScope: context.ownerScope).isEmpty,
                      "A verified canonical image receipt must release the local raw screenshot.")
    }

    @MainActor
    func testConcurrentHostWaitersFailRecoverablyWhenLocalServiceIsUnavailable() async throws {
        let path = ProcessInfo.processInfo.environment["DESKTOP_CAPTURE_PROOF_COOKIE_FILE"] ??
            "/private/tmp/ts-capture-proof-cookie.json"
        guard FileManager.default.fileExists(atPath: path) else {
            throw XCTSkip("Explicit disposable proof cookie is required.")
        }
        let proof = try JSONDecoder().decode(ProofCookie.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        let unavailable = try XCTUnwrap(WorkspaceOrigin("http://127.0.0.1:1", allowLocalDevelopment: true))
        XCTAssertTrue(WorkspaceConnection.shared.save(unavailable.url.absoluteString, allowLocalDevelopment: true))
        defer { _ = WorkspaceConnection.shared.save(proof.origin, allowLocalDevelopment: true) }
        let transport = CaptureWebSession(origin: unavailable)
        let first = Task { try await transport.context() }
        let second = Task { try await transport.context() }
        let started = Date()
        for request in [first, second] {
            do {
                _ = try await request.value
                XCTFail("An unavailable host must not return a capture context.")
            } catch {
                XCTAssertLessThan(Date().timeIntervalSince(started), 20,
                                  "Every waiter must receive a recoverable navigation failure or timeout.")
            }
        }
    }
}
