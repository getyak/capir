import ActivityKit
import Foundation

enum CaptureActivityPhase: String, Codable, Hashable {
    case saved, uploading, queued, processing, review, failed, paused
    var title: String {
        switch self {
        case .saved: return "Saved on this iPhone"
        case .uploading: return "Sending screenshot"
        case .queued: return "Waiting to process"
        case .processing: return "Processing"
        case .review: return "Ready to review"
        case .failed: return "Couldn't process"
        case .paused: return "Waiting to continue"
        }
    }
    var isWorking: Bool { [.uploading, .processing].contains(self) }
}

struct CaptureActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let phase: CaptureActivityPhase
        let eventRevision: Int64
        let updatedAtEpochSeconds: Double
    }
    let workspaceID: String
    let sessionID: String
    let activityInstanceID: String

    var askIdentity: AgentAskActivityIdentity {
        .init(workspaceID: workspaceID, sessionID: sessionID, activityInstanceID: activityInstanceID)
    }
}
