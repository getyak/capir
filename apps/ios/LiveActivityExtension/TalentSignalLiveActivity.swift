import ActivityKit
import SwiftUI
import WidgetKit

@main
struct TalentSignalLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        SignalRecordingLiveActivity()
        AgentAskLiveActivity()
        AgentWorkLiveActivity()
        ResearchLiveActivity()
    }
}

struct SignalRecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SignalRecordingActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    mark(context)
                    Text("capri")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white.opacity(0.72))
                    Spacer(minLength: 8)
                    if isRecording(context) { timer(context).font(.subheadline) }
                }
                recordingBody(context)
            }
            .padding(16)
            .activityBackgroundTint(Color.signalActivityBackground)
            .activitySystemActionForegroundColor(.white)
            .widgetURL(reviewURL(draftID: context.state.draftID))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    mark(context)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if isRecording(context) {
                        timer(context).font(.subheadline)
                            .padding(.trailing, 10)
                    } else {
                        Text(context.isStale ? String(localized: "Delayed") : status(context.state.phase))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.8))
                            .padding(.trailing, 10)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    recordingBody(context)
                }
            } compactLeading: {
                mark(context)
                    .accessibilityLabel(title(context))
            } compactTrailing: {
                if isRecording(context) {
                    timer(context)
                        .font(.caption.monospacedDigit())
                        .frame(width: 58)
                } else {
                    Text(context.isStale ? String(localized: "Delayed") : status(context.state.phase))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: true, vertical: false)
                }
            } minimal: {
                mark(context)
                    .accessibilityLabel(title(context))
            }
            .widgetURL(reviewURL(draftID: context.state.draftID))
            .keylineTint(Color.signalActivityAccent)
        }
    }

    private func recordingBody(
        _ context: ActivityViewContext<SignalRecordingActivityAttributes>
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title(context))
                .font(.headline)
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 12) {
                Text(context.isStale
                     ? String(localized: "Open the app for current status")
                     : subtitle(for: context.state.phase))
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.72))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if isRecording(context) {
                    Button(intent: StopStandaloneSignalRecordingIntent(draftID: context.state.draftID)) {
                        Label("Stop and save", systemImage: "stop.fill")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 12)
                            .frame(minWidth: 44, minHeight: 44)
                            .foregroundStyle(.black)
                            .background(.white, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Stop and save Signal recording")
                } else if let url = reviewURL(draftID: context.state.draftID) {
                    Link(destination: url) {
                        Text(context.isStale ? String(localized: "Check status") : String(localized: "Open review"))
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 12)
                            .frame(minWidth: 44, minHeight: 44)
                            .foregroundStyle(.black)
                            .background(.white, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.top, 2)
        .accessibilityElement(children: .contain)
    }

    private func isRecording(_ context: ActivityViewContext<SignalRecordingActivityAttributes>) -> Bool {
        context.state.phase == .recording && !context.isStale
    }

    private func timer(_ context: ActivityViewContext<SignalRecordingActivityAttributes>) -> some View {
        Text(timerInterval: context.state.startedAt ... Date.distantFuture, countsDown: false)
            .monospacedDigit()
            .foregroundStyle(.white)
    }

    private func mark(_ context: ActivityViewContext<SignalRecordingActivityAttributes>) -> some View {
        Image(systemName: context.isStale ? "clock.badge.exclamationmark" : icon(for: context.state.phase))
            .font(.system(size: 17, weight: .medium))
            .foregroundStyle(context.isStale ? .white.opacity(0.8) : Color.signalActivityAccent)
            .frame(width: 22, height: 22)
    }

    private func title(_ context: ActivityViewContext<SignalRecordingActivityAttributes>) -> String {
        if context.isStale { return String(localized: "Update delayed") }
        switch context.state.phase {
        case .recording: return String(localized: "Recording Signal")
        case .organizing: return String(localized: "Saved · Organizing")
        case .readyToReview: return String(localized: "Ready to Review")
        }
    }

    private func status(_ phase: SignalRecordingActivityAttributes.ContentState.Phase) -> String {
        switch phase {
        case .recording: return String(localized: "Recording")
        case .organizing: return String(localized: "Working")
        case .readyToReview: return String(localized: "To review")
        }
    }

    private func subtitle(for phase: SignalRecordingActivityAttributes.ContentState.Phase) -> String {
        switch phase {
        case .recording: return String(localized: "On-device recording")
        case .organizing, .readyToReview: return String(localized: "The local recording is saved")
        }
    }

    private func icon(for phase: SignalRecordingActivityAttributes.ContentState.Phase) -> String {
        switch phase {
        case .recording: return "waveform"
        case .organizing: return "text.magnifyingglass"
        case .readyToReview: return "doc.text"
        }
    }

    private func reviewURL(draftID: UUID) -> URL? {
        URL(string: "talentsignal://standalone/proposal?draft=\(draftID.uuidString)")
    }
}
