import CoreGraphics
import Foundation

enum CaptureSelectionError: LocalizedError {
    case busy, cancelled, empty, outsideDisplay, displayUnavailable

    var errorDescription: String? {
        switch self {
        case .busy: "已有一次截图正在进行。"
        case .cancelled: "截图已取消，没有上传任何内容。"
        case .empty: "请先框选要截取的区域。"
        case .outsideDisplay: "选区超出了当前显示器，请在一块屏幕内重试。"
        case .displayUnavailable: "显示器内容暂时无法获取，请重试截图。"
        }
    }
}

enum CaptureSelectionGeometry {
    /// Selection is measured from the overlay's upper-left corner, then mapped
    /// to the exact captured image. Reject cross-display drags and empty crops.
    static func pixelRect(selection: CGRect, overlaySize: CGSize, imagePixelSize: CGSize) -> CGRect? {
        guard overlaySize.width > 0, overlaySize.height > 0, imagePixelSize.width > 0, imagePixelSize.height > 0,
              selection.width > 0, selection.height > 0, selection.minX >= 0, selection.minY >= 0,
              selection.maxX <= overlaySize.width, selection.maxY <= overlaySize.height else { return nil }
        let scaleX = imagePixelSize.width / overlaySize.width
        let scaleY = imagePixelSize.height / overlaySize.height
        let left = floor(selection.minX * scaleX)
        let top = floor(selection.minY * scaleY)
        let right = ceil(selection.maxX * scaleX)
        let bottom = ceil(selection.maxY * scaleY)
        guard right > left, bottom > top else { return nil }
        return CGRect(x: left, y: top, width: right - left, height: bottom - top)
    }
}

struct CaptureSelectionResult {
    let image: CGImage
    let capturedAt: Date
    let preview: Bool
    /// Ephemeral geometry for an explicit region only; never serialized.
    let origin: CaptureRegionOrigin?

    init(image: CGImage, capturedAt: Date, preview: Bool, origin: CaptureRegionOrigin? = nil) {
        self.image = image
        self.capturedAt = capturedAt
        self.preview = preview
        self.origin = origin
    }
}

@MainActor
protocol CaptureSelecting {
    func select() async throws -> CaptureSelectionResult
    func cancel()
}
