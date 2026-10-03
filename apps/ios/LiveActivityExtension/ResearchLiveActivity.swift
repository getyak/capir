import ActivityKit
import SwiftUI
import WidgetKit

struct ResearchLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ResearchActivityAttributes.self) { context in
            let view = presentation(context)
            ActivityHandoffLockScreen(
                name: researchLocalized("capri Research"),
                content: content(context, view: view)
            )
            .activityBackgroundTint(Color.signalActivityBackground)
            .activitySystemActionForegroundColor(.white)
            .widgetURL(destinationURL(context, view: view))
        } dynamicIsland: { context in
            let view = presentation(context)
            let content = content(context, view: view)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ActivityStatusMark(status: content.status, symbol: content.symbol, size: 24)
                        .accessibilityHidden(true)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ActivityStatusLabel(status: content.status)
                        .padding(.trailing, 10)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ActivityHandoffBody(content: content)
                }
            } compactLeading: {
                ActivityStatusMark(status: content.status, symbol: content.symbol, size: 22)
                    .accessibilityLabel(view.title)
            } compactTrailing: {
                ActivityStatusLabel(status: content.status)
            } minimal: {
                ActivityStatusMark(status: content.status, symbol: content.symbol, size: 20)
                    .accessibilityLabel(view.accessibilityLabel)
            }
            .widgetURL(content.url)
            .keylineTint(content.status.needsAttention ? .signalActivityAccent : .white.opacity(0.65))
        }
    }

    private func presentation(
        _ context: ActivityViewContext<ResearchActivityAttributes>
    ) -> ResearchActivityViewState {
        ResearchActivityProjector.presentation(context.state, isSystemStale: context.isStale)
    }

    private func content(
        _ context: ActivityViewContext<ResearchActivityAttributes>,
        view: ResearchActivityViewState
    ) -> ActivityHandoffContent {
        ActivityHandoffContent(
            title: view.title,
            detail: nil,
            boundary: view.boundaryText,
            status: view.displayStatus,
            symbol: view.displayStatus.systemImageName,
            actionTitle: view.displayStatus == .delayed
                ? researchLocalized("Check status") : view.action?.title,
            url: destinationURL(context, view: view)
        )
    }

    private func destinationURL(
        _ context: ActivityViewContext<ResearchActivityAttributes>,
        view: ResearchActivityViewState
    ) -> URL? {
        guard let action = view.action else { return nil }
        return ResearchDeepLink.url(
            identity: ResearchActivityIdentity(
                scopeID: context.attributes.scopeID,
                taskID: context.attributes.taskID,
                activityInstanceID: context.attributes.activityInstanceID
            ),
            destination: action == .openReview ? .review : .status
        )
    }
}
