import AppKit
import CryptoKit

struct EncodedCapture {
    let data: Data
    let pixelWidth: Int
    let pixelHeight: Int
    let contentHash: String
}

enum CaptureImageEncoder {
    static func encodePNG(_ image: CGImage) throws -> EncodedCapture {
        guard image.width > 0, image.height > 0,
              let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]),
              !data.isEmpty else { throw CaptureIntentError.emptyImage }
        guard data.count <= 10_000_000 else { throw CaptureIntentError.imageTooLarge }
        return .init(data: data, pixelWidth: image.width, pixelHeight: image.height,
                     contentHash: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
    }
}
