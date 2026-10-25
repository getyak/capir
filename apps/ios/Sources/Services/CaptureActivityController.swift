import ActivityKit
import Foundation

@MainActor
final class CaptureActivityController {
    static let shared = CaptureActivityController()
    private var tokenObservers: [UUID: Task<Void, Never>] = [:]
    nonisolated static var pushEnvironment: String {
#if DEBUG
        "sandbox"
#else
        "production"
#endif
    }
    func start(_ record: BackgroundCaptureRecord) async {
        guard #available(iOS 17.0, *), ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = CaptureActivityAttributes(workspaceID: record.accountID,
            sessionID: record.sessionID.uuidString.lowercased(), activityInstanceID: record.activityInstanceID.uuidString.lowercased())
        do {
            let activity = try Activity.request(attributes: attributes,
                content: content(.saved, revision: 1), pushType: .token)
            await observe(activity, record: record)
        } catch { /* Activity permission/limits never block source delivery. */ }
    }
    func reattach(_ records: [BackgroundCaptureRecord]) async {
        guard #available(iOS 17.0, *) else { return }
        for record in records where record.stage != .cancelled {
            if let activity = activity(record) { await observe(activity, record: record) }
        }
    }
    @available(iOS 17.0, *)
    private func observe(_ activity: Activity<CaptureActivityAttributes>, record: BackgroundCaptureRecord) async {
        guard tokenObservers[record.id] == nil else { return }
        // Existing activities can already have a token before a cold launch
        // subscribes. Persist it first; network registration runs independently.
        if let token = activity.pushToken { await persist(token, recordID: record.id) }
        tokenObservers[record.id] = Task { [weak self] in
            for await token in activity.pushTokenUpdates {
                guard !Task.isCancelled, let self else { break }
                await self.persist(token, recordID: record.id)
            }
        }
    }
    private func persist(_ token: Data, recordID: UUID) async {
        let encoded = token.map { String(format: "%02x", $0) }.joined()
        await BackgroundCaptureDelivery.shared.recordActivityToken(recordID: recordID, token: encoded)
        Task { await BackgroundCaptureDelivery.shared.registerToken(recordID) }
    }
    func update(_ record: BackgroundCaptureRecord, phase: CaptureActivityPhase) async {
        guard #available(iOS 17.0, *), let activity = activity(record),
              activity.content.state.eventRevision < 100 else { return }
        let revision = min(Int64(99), Int64(record.revision ?? 1))
        guard revision > activity.content.state.eventRevision else { return }
        await activity.update(content(phase, revision: revision))
    }
    func endAll() async {
        tokenObservers.values.forEach { $0.cancel() }; tokenObservers.removeAll()
        guard #available(iOS 17.0, *) else { return }
        for activity in Activity<CaptureActivityAttributes>.activities {
            await activity.end(activity.content, dismissalPolicy: .immediate)
        }
    }
    @available(iOS 17.0, *)
    private func activity(_ record: BackgroundCaptureRecord) -> Activity<CaptureActivityAttributes>? {
        Activity<CaptureActivityAttributes>.activities.first {
            $0.attributes.workspaceID == record.accountID && $0.attributes.sessionID == record.sessionID.uuidString.lowercased()
                && $0.attributes.activityInstanceID == record.activityInstanceID.uuidString.lowercased()
        }
    }
    @available(iOS 17.0, *)
    private func content(_ phase: CaptureActivityPhase, revision: Int64) -> ActivityContent<CaptureActivityAttributes.ContentState> {
        .init(state: .init(phase: phase, eventRevision: revision, updatedAtEpochSeconds: Date().timeIntervalSince1970),
              staleDate: Date().addingTimeInterval(90))
    }
}
