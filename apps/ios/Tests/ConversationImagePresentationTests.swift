import Foundation
import UIKit
import XCTest
@testable import TalentSignal

@MainActor
final class ConversationImagePresentationTests: XCTestCase {
    private let bytes = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3f8AAAAASUVORK5CYII=")!

    func testOrdinaryImagesRetainAspectAndFitNarrowWidths() {
        for width: CGFloat in [170, 240, 288, 390] {
            for size in [CGSize(width: 800, height: 800), CGSize(width: 1600, height: 900), CGSize(width: 800, height: 1000)] {
                let result = ConversationImagePresentation.layout(imageSize: size, availableWidth: width)
                XCTAssertFalse(result.isLong)
                XCTAssertLessThanOrEqual(result.width, min(width, 310))
                XCTAssertLessThanOrEqual(result.height, 340)
                XCTAssertEqual(result.width / result.height, size.width / size.height, accuracy: 0.001)
            }
        }
    }

    func testLongScreenshotKeepsReadableWidthAndBoundedTopPreview() {
        let source = CGSize(width: 1206, height: 9000)
        for width: CGFloat in [170, 240, 288, 390] {
            let result = ConversationImagePresentation.layout(imageSize: source, availableWidth: width)
            XCTAssertTrue(result.isLong)
            XCTAssertEqual(result.width, min(width, 280))
            XCTAssertEqual(result.height, 340)
            XCTAssertGreaterThan(result.width / result.height, source.width / source.height,
                "Only the preview is cropped; the exact original remains a separate full-size read.")
        }
        let invalid = ConversationImagePresentation.layout(imageSize: CGSize(width: CGFloat.nan, height: 0), availableWidth: CGFloat.infinity)
        XCTAssertTrue(invalid.width.isFinite && invalid.height.isFinite)
        XCTAssertGreaterThan(invalid.width, 0); XCTAssertGreaterThan(invalid.height, 0)
    }

    func testAlbumNavigationPreservesOrderWithoutWrappingAtEnds() {
        let images = (0..<10).map { _ in UUID() }
        var selected = 0
        XCTAssertNil(ConversationImagePresentation.neighbor(of: selected, offset: -1, count: images.count))
        for expected in 1..<images.count {
            selected = ConversationImagePresentation.neighbor(of: selected, offset: 1, count: images.count)!
            XCTAssertEqual(images[selected], images[expected])
        }
        XCTAssertNil(ConversationImagePresentation.neighbor(of: selected, offset: 1, count: images.count))
        XCTAssertNil(ConversationImagePresentation.neighbor(of: 0, offset: 1, count: 0))
    }

    func testWhitespaceOnlyImageMessageHasNoTextSurface() {
        for message in ["", " ", "\n\t", "\u{3000}\r\n"] { XCTAssertFalse(ConversationImagePresentation.hasMessage(message)) }
        XCTAssertTrue(ConversationImagePresentation.hasMessage("\n这是谁？ "))
    }

    func testLocalPreviewSurvivesFailureAndIsReleasedOnlyAfterVerifiedOriginal() async throws {
        let sid = UUID(), manifest = try manifest()
        let local = try XCTUnwrap(UIImage(data: bytes))
        let model = ConversationImageAlbumModel(messageID: sid, manifests: [manifest], initialImages: [manifest.attachmentID: local])
        var released: [UUID] = []
        await model.load(messageID: sid, index: 0, manifest: manifest,
            using: { throw URLError(.notConnectedToInternet) }, onAuthenticatedLoad: { released.append($0) })
        XCTAssertTrue(model.images[manifest.attachmentID] === local)
        XCTAssertTrue(model.failures.contains(manifest.attachmentID))
        XCTAssertTrue(released.isEmpty)
        await model.load(messageID: sid, index: 0, manifest: manifest,
            using: { ChatMediaContent(data: self.bytes, mediaType: "image/png") }, onAuthenticatedLoad: { released.append($0) })
        XCTAssertTrue(model.verified.contains(manifest.attachmentID)); XCTAssertTrue(model.failures.isEmpty)
        XCTAssertEqual(released, [manifest.attachmentID])
        var duplicateReads = 0
        await model.load(messageID: sid, index: 0, manifest: manifest,
            using: { duplicateReads += 1; return ChatMediaContent(data: self.bytes, mediaType: "image/png") })
        XCTAssertEqual(duplicateReads, 0)
    }

    func testMismatchedOriginalCannotReplacePreviewOrReleaseProtectedBytes() async throws {
        let sid = UUID(), manifest = try manifest(), local = try XCTUnwrap(UIImage(data: bytes))
        let model = ConversationImageAlbumModel(messageID: sid, manifests: [manifest], initialImages: [manifest.attachmentID: local])
        var released = false
        await model.load(messageID: sid, index: 0, manifest: manifest,
            using: { ChatMediaContent(data: self.bytes, mediaType: "image/jpeg") }, onAuthenticatedLoad: { _ in released = true })
        XCTAssertTrue(model.images[manifest.attachmentID] === local)
        XCTAssertTrue(model.failures.contains(manifest.attachmentID)); XCTAssertFalse(released)
        XCTAssertFalse(model.verified.contains(manifest.attachmentID))
    }

    func testLateReadAfterMessageChangeCannotPublishOldImage() async throws {
        let sid = UUID(), nextID = UUID(), manifest = try manifest()
        let model = ConversationImageAlbumModel(messageID: sid, manifests: [manifest])
        var reply: CheckedContinuation<ChatMediaContent, Error>?
        var released = false
        let started = expectation(description: "Original request started")
        let work = Task { @MainActor in
            await model.load(messageID: sid, index: 0, manifest: manifest, using: {
                try await withCheckedThrowingContinuation { reply = $0; started.fulfill() }
            }, onAuthenticatedLoad: { _ in released = true })
        }
        await fulfillment(of: [started], timeout: 2)
        model.configure(messageID: nextID, manifests: [], initialImages: [:])
        reply?.resume(returning: ChatMediaContent(data: bytes, mediaType: "image/png"))
        await work.value
        XCTAssertTrue(model.images.isEmpty); XCTAssertTrue(model.failures.isEmpty)
        XCTAssertTrue(model.verified.isEmpty); XCTAssertFalse(released)
    }

    func testCancelledReadStaysRetryableWithoutPublishingFailureOrSuccess() async throws {
        let sid = UUID(), manifest = try manifest()
        let model = ConversationImageAlbumModel(messageID: sid, manifests: [manifest])
        var reply: CheckedContinuation<ChatMediaContent, Error>?
        let started = expectation(description: "Cancellable image read started")
        let work = Task { @MainActor in
            await model.load(messageID: sid, index: 0, manifest: manifest, using: {
                try await withCheckedThrowingContinuation { reply = $0; started.fulfill() }
            })
        }
        await fulfillment(of: [started], timeout: 2)
        work.cancel()
        reply?.resume(returning: ChatMediaContent(data: bytes, mediaType: "image/png"))
        await work.value
        XCTAssertTrue(model.images.isEmpty); XCTAssertTrue(model.failures.isEmpty); XCTAssertTrue(model.loading.isEmpty)
        await model.load(messageID: sid, index: 0, manifest: manifest,
            using: { ChatMediaContent(data: self.bytes, mediaType: "image/png") })
        XCTAssertTrue(model.verified.contains(manifest.attachmentID))
    }

    private func manifest() throws -> ConversationImageManifest {
        try ConversationImageUpload(id: UUID(), data: bytes, fileName: "synthetic.png", mediaType: "image/png").manifest
    }
}
