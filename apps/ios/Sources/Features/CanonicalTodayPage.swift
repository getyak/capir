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

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Color.tsInk)
                        .frame(width: 42, height: 42)
                    Image(systemName: "sparkles")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsSurface)
                }
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 4) {
                    Text(session.displayTitle(in: appLanguage))
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                        .lineLimit(1)
                    Text(
                        "\(session.personDisplayLabel) · \(session.displayContextLabel(in: appLanguage))"
                    )
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                if remainingCount > 0 {
                    Text("+\(remainingCount)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsMutedInk)
                }
                Circle()
                    .fill(Color.tsVermilion)
                    .frame(width: 7, height: 7)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 66)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            appLanguage.text(
                "Unread session: \(session.displayTitle(in: appLanguage)), \(session.personDisplayLabel)",
                zhHans: "未读会话：\(session.displayTitle(in: appLanguage))，\(session.personDisplayLabel)"
            )
        )
        .accessibilityIdentifier("today-unread-session")
    }
}
