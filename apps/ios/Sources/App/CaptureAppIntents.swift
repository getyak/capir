import AppIntents
import Combine
import Foundation
import ImageIO
import OSLog
import UniformTypeIdentifiers

enum CaptureIntentDestination: Equatable, Sendable {
    case hub
    case foregroundAudio
    case latestProposal
    case pursuit(String)
}

struct PursuitEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Pursuit")
    static let defaultQuery = PursuitEntityQuery()

    let id: String
    let displayName: String
    let lifecycleState: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(displayName)",
            subtitle: "\(lifecycleState)"
        )
    }
}

struct PursuitEntityQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [PursuitEntity] {
        let wanted = Set(identifiers)
        return try availableEntities().filter { wanted.contains($0.id) }
    }

    func suggestedEntities() async throws -> [PursuitEntity] {
        try availableEntities()
    }

    private func availableEntities() throws -> [PursuitEntity] {
        guard StandaloneSharedCaptureConfiguration.isEnabled else { return [] }
        guard let state = try FileStandaloneOnboardingStore().load(),
              let pursuit = state.pursuit else { return [] }
        return [
            PursuitEntity(
                id: pursuit.id.uuidString,
                displayName: pursuit.outcome,
                lifecycleState: state.isActivated ? "Verified progress" : "Active"
            ),
        ]
    }
}

@MainActor
final class CaptureIntentRouter: ObservableObject {
    struct Request: Identifiable, Equatable {
        let id = UUID()
        let destination: CaptureIntentDestination
    }

    static let shared = CaptureIntentRouter()

    @Published private(set) var request: Request?

    private init() {}

    func route(to destination: CaptureIntentDestination) {
        request = Request(destination: destination)
    }

    func consume(_ id: UUID) {
        guard request?.id == id else { return }
        request = nil
    }
}

struct CaptureSignalIntent: AppIntent {
    static let title: LocalizedStringResource = "Capture Signal"
    static let description = IntentDescription(
        "Open capri to choose a purpose-bound text, screenshot, or foreground audio capture."
    )

    @available(iOS 26.0, *)
    static let supportedModes: IntentModes = .foreground(.immediate)

    // Compatibility for iOS 16–25. `supportedModes` replaces this on iOS 26.
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        await MainActor.run {
            CaptureIntentRouter.shared.route(to: .hub)
        }
        return .result(
            dialog: "capri opened to Capture. Nothing has been recorded or uploaded."
        )
    }
}

struct RecordSignalIntent: AppIntent {
    static let title: LocalizedStringResource = "Record Signal"
    static let description = IntentDescription(
        "Open capri before requesting microphone permission or starting a recording."
    )

    @available(iOS 26.0, *)
    static let supportedModes: IntentModes = .foreground(.immediate)

    // Compatibility for iOS 16–25. Recording never runs inside the intent.
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        await MainActor.run {
            CaptureIntentRouter.shared.route(to: .foregroundAudio)
        }
        return .result(
            dialog: "capri opened for foreground recording. Recording has not started."
        )
    }
}

struct ReviewLatestProposalIntent: AppIntent {
    static let title: LocalizedStringResource = "Review Signal"
    static let description = IntentDescription(
        "Open the latest pending Proposal for human review."
    )

    @available(iOS 26.0, *)
    static let supportedModes: IntentModes = .foreground(.immediate)

    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        await MainActor.run {
            CaptureIntentRouter.shared.route(to: .latestProposal)
        }
        return .result(dialog: "Opening the latest Proposal. Nothing is confirmed automatically.")
    }
}

struct OpenPursuitIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Pursuit"
    static let description = IntentDescription("Open one stable Pursuit by its local identifier.")

    @Parameter(title: "Pursuit")
    var pursuit: PursuitEntity

    @available(iOS 26.0, *)
    static let supportedModes: IntentModes = .foreground(.immediate)

    static let openAppWhenRun = true

    init() {}

    init(pursuit: PursuitEntity) {
        self.pursuit = pursuit
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        await MainActor.run {
            CaptureIntentRouter.shared.route(to: .pursuit(pursuit.id))
        }
        return .result(dialog: "Opening \(pursuit.displayName).")
    }
}

struct ImportConversationScreenshotIntent: AppIntent {
    static let title: LocalizedStringResource = "Process screenshot"
    static let description = IntentDescription(
        "Receive one screenshot, save it on this device, create a protected Agent Session, and ask only when processing needs a decision."
    )

    @available(iOS 26.0, *)
    static let supportedModes: IntentModes = .background

    // Compatibility for iOS 16–25. `supportedModes` replaces this on iOS 26.
    static let openAppWhenRun = false

    @Parameter(
        title: "Screenshot",
        requestValueDialog: "Choose a screenshot to process."
    )
    var screenshot: IntentFile

    static var parameterSummary: some ParameterSummary {
        Summary("Process \(\.$screenshot)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let trace = CaptureIntentTrace()
        trace.mark("intent_received")
        let input = try loadInput()
        trace.mark("input_loaded")
        _ = try await ConversationScreenshotImporter().stage(
            input
        )
        trace.mark("persisted")
        trace.mark("setup_receipt_recorded")
        trace.mark("session_enqueued")
        trace.mark("intent_returning")
        return .result(
            dialog: "Agent Session created. Processing will continue securely; capri will ask only if a decision is needed."
        )
    }

    private func loadInput() throws -> ScreenshotInput {
        if let url = screenshot.fileURL {
            let didStartAccess = url.startAccessingSecurityScopedResource()
            defer {
                if didStartAccess {
                    url.stopAccessingSecurityScopedResource()
                }
            }

            let values = try url.resourceValues(
                forKeys: [.contentTypeKey, .fileSizeKey]
            )
            if let fileSize = values.fileSize,
               fileSize > ConversationScreenshotInputValidator.maximumByteCount {
                throw CaptureAppIntentError.imageTooLarge
            }
            let data = try Data(contentsOf: url, options: .mappedIfSafe)
            guard !data.isEmpty else {
                throw CaptureAppIntentError.fileUnavailable
            }
            return ScreenshotInput(
                data: data,
                fileName: url.lastPathComponent.isEmpty
                    ? screenshot.filename
                    : url.lastPathComponent
            )
        }

        let data = screenshot.data
        guard !data.isEmpty else {
            throw CaptureAppIntentError.fileUnavailable
        }
        return ScreenshotInput(
            data: data,
            fileName: screenshot.filename.isEmpty
                ? "conversation-screenshot"
                : screenshot.filename
        )
    }
}

struct TalentSignalShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptureSignalIntent(),
            phrases: [
                "Capture Signal with \(.applicationName)",
                "Remember a Signal in \(.applicationName)"
            ],
            shortTitle: "Capture Signal",
            systemImageName: "waveform.badge.plus"
        )
        AppShortcut(
            intent: ReviewLatestProposalIntent(),
            phrases: [
                "Review Signal in \(.applicationName)",
                "Review the latest Proposal in \(.applicationName)"
            ],
            shortTitle: "Review Signal",
            systemImageName: "checkmark.bubble"
        )
        AppShortcut(
            intent: OpenPursuitIntent(),
            phrases: [
                "Open a Pursuit in \(.applicationName)",
                "Show my Pursuit in \(.applicationName)"
            ],
            shortTitle: "Open Pursuit",
            systemImageName: "scope"
        )
        AppShortcut(
            intent: RecordSignalIntent(),
            phrases: [
                "Record a Signal with \(.applicationName)",
                "Open Signal recorder in \(.applicationName)"
            ],
            shortTitle: "Record Signal",
            systemImageName: "mic"
        )
    }
}

enum CaptureAppIntentError: LocalizedError, Equatable {
    case fileUnavailable
    case imageTooLarge
    case notAnImage

    var errorDescription: String? {
        switch self {
        case .fileUnavailable:
            return "The screenshot could not be read. Choose an image and try again."
        case .imageTooLarge:
            return "The screenshot is too large to review safely. Choose a smaller image."
        case .notAnImage:
            return "Choose an image file for conversation review."
        }
    }
}

struct ConversationScreenshotInputValidator {
    static let maximumByteCount = 25 * 1_024 * 1_024
    static let maximumPixelCount: Int64 = 80_000_000

    static func detectedImageType(for data: Data) throws -> UTType {
        guard !data.isEmpty else {
            throw CaptureAppIntentError.fileUnavailable
        }
        guard data.count <= maximumByteCount else {
            throw CaptureAppIntentError.imageTooLarge
        }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) > 0,
              let typeIdentifier = CGImageSourceGetType(source),
              let imageType = UTType(typeIdentifier as String),
              imageType.conforms(to: .image),
              let properties = CGImageSourceCopyPropertiesAtIndex(
                  source,
                  0,
                  nil
              ) as NSDictionary?,
              let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.int64Value,
              let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.int64Value,
              width > 0,
              height > 0 else {
            throw CaptureAppIntentError.notAnImage
        }

        try validatePixelDimensions(width: width, height: height)

        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 64,
            kCGImageSourceShouldCacheImmediately: false,
        ]
        guard CGImageSourceCreateThumbnailAtIndex(
            source,
            0,
            thumbnailOptions as CFDictionary
        ) != nil else {
            throw CaptureAppIntentError.notAnImage
        }
        return imageType
    }

    static func validatePixelDimensions(
        width: Int64,
        height: Int64
    ) throws {
        guard width > 0, height > 0 else {
            throw CaptureAppIntentError.notAnImage
        }
        let (pixelCount, overflowed) = width.multipliedReportingOverflow(by: height)
        guard !overflowed, pixelCount <= maximumPixelCount else {
            throw CaptureAppIntentError.imageTooLarge
        }
    }
}

struct ConversationScreenshotImporter {
    let inbox: PendingCaptureInbox
    let defaults: UserDefaults
    let validate: (Data) throws -> UTType

    init(
        inbox: PendingCaptureInbox = .shared,
        defaults: UserDefaults = .standard,
        validate: @escaping (Data) throws -> UTType =
            ConversationScreenshotInputValidator.detectedImageType
    ) {
        self.inbox = inbox
        self.defaults = defaults
        self.validate = validate
    }

    func stage(_ input: ScreenshotInput) async throws -> PendingCaptureSeed {
        let type = try validate(input.data)
        let seed = try await inbox.stage(
            imageData: input.data,
            fileName: input.fileName,
            mediaType: type.preferredMIMEType ?? "image/*",
            origin: .appShortcut
        )
        TalentSignalSetupPreference.recordScreenshotShortcutReceived(
            defaults: defaults
        )
        return seed
    }
}

struct ScreenshotInput {
    let data: Data
    let fileName: String
}

private struct CaptureIntentTrace {
    private static let logger = Logger(
        subsystem: "com.talentsignal.app",
        category: "shortcut-capture"
    )

    private let startedAt = Date()

    func mark(_ event: String) {
        let elapsedMilliseconds = Date().timeIntervalSince(startedAt) * 1_000
        Self.logger.notice(
            "shortcut_capture event=\(event, privacy: .public) elapsed_ms=\(elapsedMilliseconds, privacy: .public)"
        )
    }
}
