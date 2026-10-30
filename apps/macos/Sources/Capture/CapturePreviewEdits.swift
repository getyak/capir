import CoreGraphics

/// Committed edits use the frozen image's normalized coordinates. Window
/// points are only a projection; resizing must never restore excluded pixels.
struct CapturePreviewEdits {
    private(set) var displaySize: CGSize = .zero
    private var imageCrop: ImageRegion?
    private var imageRedactions: [ImageRegion] = []

    var crop: CGRect? { imageCrop.flatMap(project) }
    var redactions: [CGRect] { imageRedactions.compactMap(project) }

    mutating func resize(to size: CGSize) {
        displaySize = Self.valid(size) ? size : .zero
    }

    mutating func setCrop(_ rect: CGRect) {
        guard let normalized = normalize(rect) else { return }
        imageCrop = normalized
    }

    mutating func addRedaction(_ rect: CGRect) {
        guard let normalized = normalize(rect) else { return }
        imageRedactions.append(normalized)
    }

    mutating func clear() {
        imageCrop = nil
        imageRedactions = []
    }

    func render(_ original: CGImage) throws -> CGImage {
        let size = CGSize(width: original.width, height: original.height)
        return try CapturePreviewImage.render(original, logicalSize: size,
                                              crop: imageCrop?.pixels(in: size),
                                              redactions: imageRedactions.map { $0.pixels(in: size) })
    }

    private func normalize(_ rect: CGRect) -> ImageRegion? {
        guard Self.valid(displaySize), CaptureRelayGeometry.valid(rect),
              CGRect(origin: .zero, size: displaySize).contains(rect) else { return nil }
        return ImageRegion(left: rect.minX / displaySize.width, top: rect.minY / displaySize.height,
                           right: rect.maxX / displaySize.width, bottom: rect.maxY / displaySize.height)
    }

    private func project(_ region: ImageRegion) -> CGRect? {
        guard Self.valid(displaySize) else { return nil }
        return region.rect(in: displaySize)
    }

    private static func valid(_ size: CGSize) -> Bool {
        size.width.isFinite && size.height.isFinite && size.width > 0 && size.height > 0
    }

    /// Keep endpoints independently. Adding normalized x + width can round
    /// beyond 1 at an image edge and cause the renderer to reject a redaction.
    private struct ImageRegion {
        let left: CGFloat
        let top: CGFloat
        let right: CGFloat
        let bottom: CGFloat

        func rect(in size: CGSize) -> CGRect {
            CGRect(x: left * size.width, y: top * size.height,
                   width: (right - left) * size.width, height: (bottom - top) * size.height)
        }

        func pixels(in size: CGSize) -> CGRect {
            let x = floor(left * size.width)
            let y = floor(top * size.height)
            let maxX = ceil(right * size.width)
            let maxY = ceil(bottom * size.height)
            return CGRect(x: x, y: y, width: maxX - x, height: maxY - y)
        }
    }
}
