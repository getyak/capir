import ActivityKit
import SwiftUI
import WidgetKit

struct CaptureLiveActivity: Widget {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CaptureActivityAttributes.self) { context in
            HStack(spacing: 12) {
                mark(context)
                Text(LocalizedStringKey(phase(context).title)).font(.headline)
                Spacer(minLength: 8)
                if let url = destination(context) { Link("Open", destination: url).frame(minWidth: 44, minHeight: 44) }
            }
            .padding(16)
            .activityBackgroundTint(Color.signalActivityBackground)
            .activitySystemActionForegroundColor(.white)
            .widgetURL(destination(context))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { mark(context) }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(LocalizedStringKey(phase(context).title)).font(.headline)
                        Spacer(minLength: 8)
                        if let url = destination(context) { Link("Open", destination: url).frame(minWidth: 44, minHeight: 44) }
                    }
                }
            } compactLeading: { mark(context) }
              compactTrailing: {
                  if phase(context) == .review { Text("Review").font(.caption2) }
                  else if phase(context).isWorking { ProgressView().tint(.white).controlSize(.mini) }
              }
              minimal: { mark(context) }
              .widgetURL(destination(context))
              .keylineTint(.white.opacity(0.5))
        }
    }
    private func phase(_ context: ActivityViewContext<CaptureActivityAttributes>) -> CaptureActivityPhase {
        context.isStale && [.saved, .uploading, .queued, .processing].contains(context.state.phase) ? .paused : context.state.phase
    }
    private func mark(_ context: ActivityViewContext<CaptureActivityAttributes>) -> some View {
        let value = phase(context)
        return LivingConnectionMark(phase: value == .review ? .review : value == .failed ? .failed : value == .paused ? .timedOut : .thinking,
            size: 22, ink: .white.opacity(0.92), signal: .signalActivityAccent,
            reduceMotion: reduceMotion || !value.isWorking)
            .accessibilityLabel(LocalizedStringKey(phase(context).title))
    }
    private func destination(_ context: ActivityViewContext<CaptureActivityAttributes>) -> URL? {
        AgentAskDeepLink.url(identity: context.attributes.askIdentity,
            destination: phase(context) == .review ? .review : .status)
    }
}
