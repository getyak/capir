import ActivityKit
import AppIntents
import Foundation

struct SignalRecordingActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        enum Phase: String, Codable, Hashable {
            case recording
            case organizing
            case readyToReview
        }

        let phase: Phase
        let startedAt: Date
        let draftID: UUID
    }

    let sessionID: UUID
}

@available(iOS 17.0, *)
struct StopStandaloneSignalRecordingIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop Signal Recording"
    static let description = IntentDescription(
        "Ask the active capri foreground recorder to stop and save."
    )

    @Parameter(title: "Draft ID")
    var draftID: String

    init() {
        draftID = ""
    }

    init(draftID: UUID) {
        self.draftID = draftID.uuidString
    }

    func perform() async throws -> some IntentResult {
        guard let id = UUID(uuidString: draftID) else { return .result() }
        try LiveActivityStopRequestBridge.write(draftID: id)
        return .result()
    }
}

struct LiveActivityStopRequestBridge {
    private static let maximumRequestAge: TimeInterval = 2 * 60
    private static let clockTolerance: TimeInterval = 5

    private struct StopRequest: Codable {
        let draftID: UUID
        let requestedAt: Date
    }

    static func write(
        draftID: UUID,
        rootURL: URL? = nil,
        now: Date = Date()
    ) throws {
        let directory = try resolvedDirectory(rootURL: rootURL)
        let finalURL = directory.appending(path: "stop-request.json")
        let data = try JSONEncoder().encode(
            StopRequest(draftID: draftID, requestedAt: now)
        )
        try data.write(to: finalURL, options: [.atomic, .completeFileProtection])
    }

    static func consume(
        draftID: UUID,
        rootURL: URL? = nil,
        recordingStartedAt: Date? = nil,
        now: Date = Date()
    ) throws -> Bool {
        let directory = try resolvedDirectory(rootURL: rootURL)
        let finalURL = directory.appending(path: "stop-request.json")
        guard FileManager.default.fileExists(atPath: finalURL.path) else { return false }
        let request = try JSONDecoder().decode(
            StopRequest.self,
            from: Data(contentsOf: finalURL)
        )
        let minimumDate = max(
            now.addingTimeInterval(-maximumRequestAge),
            recordingStartedAt?.addingTimeInterval(-clockTolerance) ?? .distantPast
        )
        guard request.draftID == draftID,
              request.requestedAt >= minimumDate,
              request.requestedAt <= now.addingTimeInterval(clockTolerance) else {
            try FileManager.default.removeItem(at: finalURL)
            return false
        }
        try FileManager.default.removeItem(at: finalURL)
        return true
    }

    static func reset(rootURL: URL? = nil) throws {
        let directory = try resolvedDirectory(rootURL: rootURL)
        let finalURL = directory.appending(path: "stop-request.json")
        if FileManager.default.fileExists(atPath: finalURL.path) {
            try FileManager.default.removeItem(at: finalURL)
        }
    }

    private static func resolvedDirectory(rootURL: URL?) throws -> URL {
        let root: URL
        if let rootURL {
            root = rootURL
        } else if let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SharedCaptureInbox.appGroupIdentifier
        ) {
            root = container.appending(path: "StandaloneLiveActivity", directoryHint: .isDirectory)
        } else {
            throw SharedCaptureInboxError.appGroupUnavailable
        }
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        return root
    }
}
