import AppKit
import CryptoKit
import Foundation
import ScreenCaptureKit
import Vision

struct WindowCapturePayload: Equatable, Sendable {
    let recognizedText: String
    let imagePNG: Data
    let pixelWidth: Int
    let pixelHeight: Int
    let sourceFingerprint: String
    let localTextRecognition: LocalTextRecognitionStatus
}

enum LocalTextRecognitionStatus: Equatable, Sendable {
    case available
    case unavailable
}

@MainActor
protocol WindowCapturing {
    func captureOneWindow() async throws -> WindowCapturePayload
    func cancelCapture()
}

extension WindowCapturing {
    func cancelCapture() { }
}

enum WindowCaptureError: LocalizedError {
    case alreadySelecting
    case cancelled
    case emptyImage

    var errorDescription: String? {
        switch self {
        case .alreadySelecting:
            "A system window choice is already in progress."
        case .cancelled:
            "Window selection was cancelled. Nothing was captured."
        case .emptyImage:
            "The selected window did not return a readable image. Nothing was added."
        }
    }
}

@MainActor
final class SystemWindowCaptureService: NSObject, WindowCapturing, @preconcurrency SCContentSharingPickerObserver {
    static let shared = SystemWindowCaptureService()

    private var continuation: CheckedContinuation<SCContentFilter, Error>?

    func captureOneWindow() async throws -> WindowCapturePayload {
        try await captureOneWindow(maximumDimension: 2_560)
    }

    func captureOneWindow(maximumDimension: CGFloat?) async throws -> WindowCapturePayload {
        guard continuation == nil else { throw WindowCaptureError.alreadySelecting }

        let filter = try await chooseOneWindow()
        let configuration = SCStreamConfiguration()
        let contentSize = filter.contentRect.size
        let pixelScale = max(CGFloat(filter.pointPixelScale), 1)
        let uncappedWidth = max(contentSize.width * pixelScale, 1)
        let uncappedHeight = max(contentSize.height * pixelScale, 1)
        let downscale = maximumDimension.map { min(1, $0 / max(uncappedWidth, uncappedHeight)) } ?? 1
        configuration.width = max(1, Int((uncappedWidth * downscale).rounded()))
        configuration.height = max(1, Int((uncappedHeight * downscale).rounded()))
        configuration.showsCursor = false
        configuration.capturesAudio = false
        configuration.scalesToFit = true
        configuration.preservesAspectRatio = true

        let image = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: configuration
        )
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let imagePNG = bitmap.representation(using: .png, properties: [:]), !imagePNG.isEmpty else {
            throw WindowCaptureError.emptyImage
        }
        let recognized: (String, LocalTextRecognitionStatus)
        do {
            recognized = (try LocalWindowTextRecognizer.recognizeText(in: image), .available)
        } catch {
            // OCR is an optional local fast path. A Vision failure does not
            // discard the user-authorized still or cause a cloud fallback;
            // the raw image remains encrypted and local-only.
            recognized = ("", .unavailable)
        }
        let fingerprint = SHA256.hash(data: imagePNG)
            .map { String(format: "%02x", $0) }
            .joined()

        return WindowCapturePayload(
            recognizedText: recognized.0,
            imagePNG: imagePNG,
            pixelWidth: image.width,
            pixelHeight: image.height,
            sourceFingerprint: fingerprint,
            localTextRecognition: recognized.1
        )
    }

    private func chooseOneWindow() async throws -> SCContentFilter {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let picker = SCContentSharingPicker.shared
            var configuration = SCContentSharingPickerConfiguration()
            configuration.allowedPickerModes = .singleWindow
            configuration.allowsChangingSelectedContent = false
            if let ownBundleID = Bundle.main.bundleIdentifier {
                configuration.excludedBundleIDs = [ownBundleID]
            }
            picker.configuration = configuration
            picker.add(self)
            picker.isActive = true
            picker.present(using: .window)
        }
    }

    private func finishPicker(_ result: Result<SCContentFilter, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        let picker = SCContentSharingPicker.shared
        picker.isActive = false
        picker.remove(self)
        continuation.resume(with: result)
    }

    func cancelCapture() {
        finishPicker(.failure(WindowCaptureError.cancelled))
    }

    func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didUpdateWith filter: SCContentFilter,
        for stream: SCStream?
    ) {
        finishPicker(.success(filter))
    }

    func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        finishPicker(.failure(WindowCaptureError.cancelled))
    }

    func contentSharingPickerStartDidFailWithError(_ error: any Error) {
        finishPicker(.failure(error))
    }
}

/// Deterministic, on-device OCR for the one frame the user chose. Vision's
/// result array is explicitly ordered into reading order so a chat screenshot
/// cannot silently invert later and earlier messages before review.
enum LocalWindowTextRecognizer {
    static func recognizeText(in image: CGImage) throws -> String {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.automaticallyDetectsLanguage = true
        let handler = VNImageRequestHandler(cgImage: image)
        try handler.perform([request])
        return (request.results ?? [])
            .sorted(by: precedesInReadingOrder)
            .compactMap { $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
            .prefix(20_000)
            .description
    }

    private static func precedesInReadingOrder(
        _ lhs: VNRecognizedTextObservation,
        _ rhs: VNRecognizedTextObservation
    ) -> Bool {
        let verticalTolerance: CGFloat = 0.02
        let verticalDifference = lhs.boundingBox.midY - rhs.boundingBox.midY
        if abs(verticalDifference) > verticalTolerance {
            return verticalDifference > 0
        }
        return lhs.boundingBox.minX < rhs.boundingBox.minX
    }
}
