import SwiftUI

/// Today composes independent current producers. An empty or failed Pursuit
/// read cannot turn a known arrangement or unread conversation into no work.
@MainActor
struct CanonicalTodayPage<Attention: View>: View {
    @ObservedObject var workspace: PursuitWorkspaceStore
    @ObservedObject var schedules: TodayScheduleStore
    let context: TodayScheduleContext?
    let isActive: Bool
    let unreadSessions: [AgentSession]
    let allowsLegacyScope: Bool
    let legacyReadScopeIsCurrent: () -> Bool
    let onOpenSession: (AgentSession) -> Void
    @ViewBuilder let attention: (PursuitWorkspaceSnapshot) -> Attention
    @Environment(\.appLanguage) private var language

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                TodayScheduleSection(context: context, isActive: isActive, store: schedules)
                if readScopeAvailable {
                    if let unread = unreadSessions.first {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(language.text("Unread session"))
                                .font(.caption.weight(.semibold)).foregroundStyle(Color.tsMutedInk)
                            TodayUnreadSessionRow(session: unread,
                                remainingCount: max(unreadSessions.count - 1, 0),
                                action: { onOpenSession(unread) })
                        }
                    }
                    attentionContent
                } else if schedules.coverage == .unavailable, !allowsLegacyScope {
                    Text(language.text("Sign in again to view today's private items."))
                        .font(.subheadline).foregroundStyle(Color.tsMutedInk)
                }
            }
            .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 28)
        }
        .scrollIndicators(.hidden)
        .relationshipContentBounce()
        .accessibilityIdentifier("canonical-pursuit-today")
    }

    private var readScopeAvailable: Bool {
        // Only legacy loopback fixtures lack a primary credential. Real
        // sessions share the current credential's expiry/revocation fence.
        allowsLegacyScope ? legacyReadScopeIsCurrent() : schedules.hasActiveReadScope
    }

    @ViewBuilder
    private var attentionContent: some View {
        switch workspace.phase {
        case .loading:
            PursuitWorkspaceLoadingView()
        case .failed(let message):
            PursuitWorkspaceFailureView(message: message, isRetrying: workspace.isReadInFlight,
                completedReadCount: workspace.completedReadCount,
                producerTitle: language.text("Goals are temporarily unavailable")) {
                Task { await workspace.load() }
            }
        case .loaded(let snapshot), .empty(let snapshot):
            attention(snapshot)
        case .preview:
            EmptyView()
        }
    }
}

struct TodayUnreadSessionRow: View {
    let session: AgentSession
    let remainingCount: Int
    let action: () -> Void
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Button(action: action) {
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 10) {
                        conversationContext
                        if remainingCount > 0 { remainingSessions }
                    }
                } else {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "bubble.left.and.text.bubble.right")
                            .font(.body)
                            .foregroundStyle(Color.tsMutedInk)
                            .frame(width: 36, height: 36)
                            .background(Color.tsSurfaceMuted, in: Circle())
                            .accessibilityHidden(true)
                        conversationContext
                        if remainingCount > 0 {
                            Text(verbatim: "+\(remainingCount)")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(Color.tsMutedInk)
                                .fixedSize()
                        }
                        Circle()
                            .fill(Color.tsVermilion)
                            .frame(width: 7, height: 7)
                            .padding(.top, 6)
                            .accessibilityHidden(true)
                    }
                }
            }
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(minHeight: 66)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityIdentifier("today-unread-session")
    }

    private var conversationContext: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(session.displayTitle(in: appLanguage))
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                .fixedSize(horizontal: false, vertical: true)
            Text(participantContext)
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var participantContext: String {
        if session.isUnresolvedIntent { return session.displayContextLabel(in: appLanguage) }
        if session.isIdentityReview { return session.personDisplayLabel }
        return "\(session.personDisplayLabel) · \(session.displayContextLabel(in: appLanguage))"
    }

    private var remainingSessions: some View {
        Text(remainingSessionsLabel)
            .font(.caption)
            .foregroundStyle(Color.tsMutedInk)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var remainingSessionsLabel: String {
        String(format: appLanguage.text(remainingCount == 1 ? "%d more unread session" : "%d more unread sessions"),
               locale: appLanguage.locale, remainingCount)
    }

    private var accessibilityLabel: String {
        [appLanguage.text("Unread session"), session.displayTitle(in: appLanguage), participantContext,
         remainingCount > 0 ? remainingSessionsLabel : nil]
            .compactMap { $0 }.joined(separator: ", ")
    }
}
