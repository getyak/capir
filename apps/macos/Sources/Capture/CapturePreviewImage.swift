import AppKit

enum CapturePreviewImage {
    /// Crop and draw opaque rectangles into a new bitmap before any upload.
    /// The returned image has no hidden layer carrying the covered pixels.
    static func render(_ original: CGImage, logicalSize: CGSize, crop: CGRect?, redactions: [CGRect]) throws -> CGImage {
        let full = CGRect(x: 0, y: 0, width: original.width, height: original.height)
        let target: CGRect
        if let crop {
            guard let pixelCrop = CaptureSelectionGeometry.pixelRect(selection: crop, overlaySize: logicalSize,
                                                                     imagePixelSize: full.size) else {
                throw CaptureSelectionError.outsideDisplay
            }
            target = pixelCrop
        } else { target = full }
        guard let image = original.cropping(to: target) else { throw CaptureSelectionError.empty }
        guard let bitmap = CGContext(data: nil, width: image.width, height: image.height,
                                     bitsPerComponent: 8, bytesPerRow: image.width * 4,
                                     space: CGColorSpaceCreateDeviceRGB(),
                                     bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw CaptureSelectionError.empty
        }
        bitmap.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        bitmap.setFillColor(NSColor.black.cgColor)
        for proposed in redactions {
            guard let rect = CaptureSelectionGeometry.pixelRect(selection: proposed, overlaySize: logicalSize,
                                                                imagePixelSize: full.size) else { continue }
            let covered = rect.intersection(target)
            if covered.isNull || covered.isEmpty { continue }
            let localX = covered.minX - target.minX
            let top = covered.minY - target.minY
            bitmap.fill(CGRect(x: localX, y: CGFloat(image.height) - top - covered.height,
                               width: covered.width, height: covered.height))
        }
        guard let rendered = bitmap.makeImage() else { throw CaptureSelectionError.empty }
        return rendered
    }
}
