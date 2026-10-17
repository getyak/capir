import CoreGraphics

enum CaptureSelectedImage {
    /// CGImage.cropping can retain the full display's backing provider. Copy
    /// only selected pixels before the overlay releases its frozen desktop.
    static func copyRegion(_ image: CGImage, pixels: CGRect) -> CGImage? {
        guard CaptureRelayGeometry.valid(pixels), pixels == pixels.integral,
              CGRect(x: 0, y: 0, width: image.width, height: image.height).contains(pixels),
              let selected = image.cropping(to: pixels),
              let canvas = CGContext(data: nil, width: selected.width, height: selected.height,
                  bitsPerComponent: 8, bytesPerRow: 0,
                  space: selected.colorSpace?.model == .rgb ? selected.colorSpace! : CGColorSpaceCreateDeviceRGB(),
                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        canvas.draw(selected, in: CGRect(x: 0, y: 0, width: selected.width, height: selected.height))
        return canvas.makeImage()
    }
}
