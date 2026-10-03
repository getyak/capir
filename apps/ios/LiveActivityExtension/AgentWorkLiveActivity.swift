import ActivityKit
import SwiftUI
import WidgetKit

struct AgentWorkLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AgentWorkActivityAttributes.self) { context in
            let view = presentation(context)
            ActivityHandoffLockScreen(
                name: agentWorkLocalized("capri Agent"),
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
        _ context: ActivityViewContext<AgentWorkActivityAttributes>
    ) -> AgentWorkActivityViewState {
        AgentWorkActivityProjector.presentation(context.state, isSystemStale: context.isStale)
    }

    private func content(
        _ context: ActivityViewContext<AgentWorkActivityAttributes>,
        view: AgentWorkActivityViewState
    ) -> ActivityHandoffContent {
        ActivityHandoffContent(
            title: view.title,
            detail: view.displayStatus == .review || view.displayStatus == .partial
                ? view.supportingText : nil,
            boundary: view.boundaryText,
            status: view.displayStatus,
            symbol: view.displayStatus == .working
                ? view.glyph.systemImageName : view.displayStatus.systemImageName,
            actionTitle: view.isStale ? agentWorkLocalized("Check status") : view.action?.title,
            url: destinationURL(context, view: view)
        )
    }

    private func destinationURL(
        _ context: ActivityViewContext<AgentWorkActivityAttributes>,
        view: AgentWorkActivityViewState
    ) -> URL? {
        guard let action = view.action else { return nil }
        let destination: AgentWorkDeepLinkDestination
        switch action {
        case .openStatus: destination = .status
        case .openActions: destination = .actions
        case .resolve: destination = .resolve
        }
        return AgentWorkDeepLink.url(
            identity: AgentWorkActivityIdentity(
                scopeID: context.attributes.scopeID,
                taskID: context.attributes.taskID,
                activityInstanceID: context.attributes.activityInstanceID
            ),
            destination: destination
        )
    }
}

// Shared system-surface vocabulary. The content contains no candidate details.
struct ActivityHandoffContent {
    let title: String
    let detail: String?
    let boundary: String
    let status: LiveActivityDisplayStatus
    let symbol: String
    let actionTitle: String?
    let url: URL?
}

struct ActivityStatusMark: View {
    let status: LiveActivityDisplayStatus
    let symbol: String
    let size: CGFloat

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.72, weight: .medium))
            .foregroundStyle(status.needsAttention ? Color.signalActivityAccent : .white.opacity(0.9))
            .frame(width: size, height: size)
    }
}

struct ActivityStatusLabel: View {
    let status: LiveActivityDisplayStatus

    var body: some View {
        Text(status.title)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.white.opacity(status.needsAttention ? 1 : 0.8))
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
    }
}

struct ActivityHandoffLockScreen: View {
    let name: String
    let content: ActivityHandoffContent

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ActivityStatusMark(status: content.status, symbol: content.symbol, size: 22)
                    .accessibilityHidden(true)
                Text(name)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white.opacity(0.72))
                    .lineLimit(1)
                Spacer(minLength: 8)
                ActivityStatusLabel(status: content.status)
            }
            ActivityHandoffBody(content: content)
        }
        .padding(16)
        .accessibilityElement(children: .contain)
    }
}

struct ActivityHandoffBody: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let content: ActivityHandoffContent

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(content.title)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail = content.detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.78))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .combine)

            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 6) {
                    boundary
                    action
                }
            } else {
                HStack(alignment: .center, spacing: 12) {
                    boundary
                    Spacer(minLength: 0)
                    action
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 2)
        .accessibilityElement(children: .contain)
    }

    private var boundary: some View {
        Text(content.boundary)
            .font(.caption)
            .foregroundStyle(.white.opacity(0.72))
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var action: some View {
        if let title = content.actionTitle, let url = content.url {
            Link(destination: url) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 14)
                    .frame(minWidth: 44, minHeight: 44)
                    .foregroundStyle(.black)
                    .background(.white, in: Capsule())
            }
            .buttonStyle(.plain)
            .fixedSize(horizontal: !dynamicTypeSize.isAccessibilitySize, vertical: false)
        }
    }
}

extension Color {
    static let signalActivityAccent = Color(red: 0.95, green: 0.36, blue: 0.27)
    static let signalActivityBackground = Color(red: 0.055, green: 0.052, blue: 0.048)
}
