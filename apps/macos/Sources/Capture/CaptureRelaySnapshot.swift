import CoreGraphics
import Foundation

enum CaptureRelayPhase: Equatable { case uploading, processing, ready, unknown, failed }

/// A bounded, ephemeral projection of the coordinator. It owns no submission
/// authority, full-size image, independent queue, or persistent coordinates.
struct CaptureRelaySnapshot {
    let intentID: UUID
    let sessionID: UUID
    let ownerRevision: Int
    let origin: CaptureRegionOrigin?
    let thumbnail: CGImage?
    let expiresAt: Date
    var phase: CaptureRelayPhase
    var result: CaptureResult?

    static func thumbnail(_ image: CGImage) -> CGImage? {
        let scale = min(1, 320 / CGFloat(max(image.width, image.height)))
        let width = max(1, Int(CGFloat(image.width) * scale)), height = max(1, Int(CGFloat(image.height) * scale))
        guard let canvas = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                     space: CGColorSpaceCreateDeviceRGB(),
                                     bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        canvas.interpolationQuality = .high
        canvas.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return canvas.makeImage()
    }
}
