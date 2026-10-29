import AppKit

/// Decode the selected window and the intent captured before its picker opens.
struct CaptureWindowSelection {
    let capturedAt: Date
    let preview: Bool

    func decode(_ imagePNG: Data) throws -> CaptureSelectionResult {
        guard let bitmap = NSBitmapImageRep(data: imagePNG), let image = bitmap.cgImage else {
            throw CaptureSelectionError.empty
        }
        return CaptureSelectionResult(image: image, capturedAt: capturedAt, preview: preview)
    }
}
