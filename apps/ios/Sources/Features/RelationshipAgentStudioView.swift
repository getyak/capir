import SwiftUI

enum TalentSignalAgentPreference {
    static let aliasKey = "talent-signal.agent.alias"
    static let linkedInURLKey = "talent-signal.agent.linkedin-url"
}

@MainActor
struct RelationshipAgentStudioView: View {
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    @ObservedObject var sessionStore: AgentSessionStore
    let isCanonical: Bool
    let workspaceID: String?
    let workspaceLabel: String?
    let accountName: String?
    let accountEmail: String?
    let proposals: [WorkspaceProposal]
    let signOutNotice: String?
    let onOpenProposal: (WorkspaceProposal) -> Void
    let internalTestingStatus: String?
    let onOpenInternalTesting: (() -> Void)?
    let onSignOut: (() async -> Bool)?

    @Environment(\.appLanguage) private var appLanguage
    @AppStorage(TalentSignalAgentPreference.aliasKey)
    private var storedAlias = "Signal"
    @AppStorage(TalentSignalAgentPreference.linkedInURLKey)
    private var legacyLinkedInURL = ""
    @AppStorage(TalentSignalSetupPreference.actionButtonCompleteKey)
    private var isActionButtonSetupComplete = false
    @AppStorage(TalentSignalSetupPreference.screenshotShortcutReceivedAtKey)
    private var screenshotShortcutReceivedAt = 0.0
    @AppStorage(CalendarSyncPreference.isEnabledKey)
    private var isCalendarSyncEnabled = true
    @StateObject private var profileReferenceStore: AgentProfileReferenceStore

    init(
        workspaceStore: PursuitWorkspaceStore,
        sessionStore: AgentSessionStore,
        isCanonical: Bool,
        workspaceID: String?,
        runtimeScope: String? = nil,
        workspaceLabel: String?,
        accountName: String?,
        accountEmail: String?,
        proposals: [WorkspaceProposal],
        signOutNotice: String?,
        onOpenProposal: @escaping (WorkspaceProposal) -> Void,
        internalTestingStatus: String? = nil,
        onOpenInternalTesting: (() -> Void)? = nil,
        onSignOut: (() async -> Bool)?
    ) {
        self.workspaceStore = workspaceStore
        self.sessionStore = sessionStore
        self.isCanonical = isCanonical
        self.workspaceID = workspaceID
        self.workspaceLabel = workspaceLabel
        self.accountName = accountName
        self.accountEmail = accountEmail
        self.proposals = proposals
        self.signOutNotice = signOutNotice
        self.onOpenProposal = onOpenProposal
        self.internalTestingStatus = internalTestingStatus
        self.onOpenInternalTesting = onOpenInternalTesting
        self.onSignOut = onSignOut
        _profileReferenceStore = StateObject(
            wrappedValue: AgentProfileReferenceStore(workspaceID: workspaceID, runtimeScope: runtimeScope)
        )
    }

    private var sourceSummary: String {
        var parts: [String] = []
        if !profileReferenceStore.references.isEmpty {
            parts.append(
                String(
                    format: appLanguage.text("%lld profile references"),
                    locale: appLanguage.locale,
                    Int64(profileReferenceStore.references.count)
                )
            )
        }
        if screenshotShortcutReceivedAt > 0 || isActionButtonSetupComplete {
            parts.append(
                appLanguage.text(
                    screenshotShortcutReceivedAt > 0
                        ? "Shortcut received"
                        : "Shortcut assigned"
                )
            )
        }
        parts.append(appLanguage.text("File import ready"))
        return parts.joined(separator: " · ")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                identityHeader
                destinationList
                approvalBoundary
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 36)
        }
        .scrollIndicators(.hidden)
        .background(Color.tsSurface.ignoresSafeArea())
        .navigationTitle(appLanguage.text("Agent"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    RelationshipMenuView(
                        isCanonical: isCanonical,
                        workspaceID: workspaceID,
                        workspaceLabel: workspaceLabel,
                        accountName: accountName,
                        accountEmail: accountEmail,
                        proposals: proposals,
                        signOutNotice: signOutNotice,
                        onOpenProposal: onOpenProposal,
                        internalTestingStatus: internalTestingStatus,
                        onOpenInternalTesting: onOpenInternalTesting,
                        onSignOut: onSignOut
                    )
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel(appLanguage.text("Open workspace settings"))
                .accessibilityIdentifier("agent-settings")
            }
        }
        .tint(.tsInk)
        .accessibilityIdentifier("agent-studio")
        .task {
            let legacy = legacyLinkedInURL.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            guard !legacy.isEmpty else { return }
            if profileReferenceStore.migrateLegacyLinkedIn(legacy) {
                legacyLinkedInURL = ""
            }
        }
    }

    private var identityHeader: some View {
        HStack(alignment: .center, spacing: 16) {
            RelationshipSignalOrb()
                .frame(width: 58, height: 58)
                .padding(11)
                .background(Color.tsCanvas, in: Circle())
                .overlay {
                    Circle().stroke(Color.tsLine, lineWidth: 1)
                }

            VStack(alignment: .leading, spacing: 5) {
                Text(appLanguage.text("YOUR AGENT"))
                    .font(.caption2.weight(.semibold))
                    .tracking(1.2)
                    .foregroundStyle(Color.tsMutedInk)

                TextField(appLanguage.text("Agent display name"), text: $storedAlias)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .font(.custom("Georgia", size: 32, relativeTo: .title))
                    .foregroundStyle(Color.tsInk)
                    .accessibilityLabel(appLanguage.text("Agent display name"))
                    .accessibilityIdentifier("agent-alias")

                Text(appLanguage.text("Turns captured signals into reviewable relationship work."))
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 2)
    }

    private var destinationList: some View {
        VStack(spacing: 0) {
            NavigationLink {
                AgentMemoryOverviewView(workspaceStore: workspaceStore)
            } label: {
                AgentDestinationRow(
                    systemImage: "brain.head.profile",
                    title: appLanguage.text("Memory"),
                    detail: appLanguage.text("Reviewed relationship context only"),
                    status: appLanguage.text("Scoped"),
                    tone: .active
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("agent-open-memory")

            AgentRowDivider()

            NavigationLink {
                AccountSettingsView(
                    isCanonical: isCanonical,
                    workspaceID: workspaceID,
                    workspaceLabel: workspaceLabel,
                    accountName: accountName,
                    accountEmail: accountEmail,
                    signOutNotice: signOutNotice,
                    onSignOut: onSignOut
                )
            } label: {
                AgentDestinationRow(
                    systemImage: "person.crop.circle",
                    title: appLanguage.text("About you"),
                    detail: accountName ?? appLanguage.text("Account and workspace identity"),
                    status: nil,
                    tone: .muted
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("agent-open-profile")

            AgentRowDivider()

            NavigationLink {
                AgentSourceSettingsView(
                    profileReferenceStore: profileReferenceStore,
                    workspaceStore: workspaceStore,
                    sessionStore: sessionStore,
                    isActionButtonSetupComplete: isActionButtonSetupComplete,
                    screenshotShortcutReceivedAt: screenshotShortcutReceivedAt,
                    isCalendarSyncEnabled: isCalendarSyncEnabled
                )
            } label: {
                AgentDestinationRow(
                    systemImage: "arrow.down.doc",
                    title: appLanguage.text("Sources & imports"),
                    detail: sourceSummary,
                    status: nil,
                    tone: .muted
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("agent-open-sources")

            AgentRowDivider()

            NavigationLink {
                ApprovalSettingsView()
            } label: {
                AgentDestinationRow(
                    systemImage: "hand.raised",
                    title: appLanguage.text("Action permissions"),
                    detail: appLanguage.text(
                        "Contact, calendar, message, and CRM writes ask first"
                    ),
                    status: appLanguage.text("Approval"),
                    tone: .review
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("agent-open-permissions")
        }
        .padding(.horizontal, 17)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 24))
        .overlay {
            RoundedRectangle(cornerRadius: 24)
                .stroke(Color.tsLine, lineWidth: 1)
        }
    }

    private var approvalBoundary: some View {
        Label {
            Text(
                appLanguage.text(
                    "The Agent can find, interpret, and prepare. You confirm every consequential change."
                )
            )
            .font(.caption)
            .foregroundStyle(Color.tsMutedInk)
            .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "lock.shield")
                .foregroundStyle(Color.tsMutedInk)
        }
        .padding(.horizontal, 4)
    }
}

private struct AgentMemoryOverviewView: View {
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        List {
            Section {
                NavigationLink {
                    AgentResponsePreferenceView(workspaceStore: workspaceStore)
                } label: {
                    Text(appLanguage.text("Reply preference"))
                }
                .accessibilityIdentifier("agent-open-reply-preference")
            }
            Section {
                AgentCapabilityRow(
                    title: appLanguage.text("Relationship context"),
                    detail: appLanguage.text(
                        "The Agent can use reviewed People and relationship evidence only when the current task brings that person into scope."
                    ),
                    status: appLanguage.text("Available"),
                    tone: .active
                )

                AgentCapabilityRow(
                    title: appLanguage.text("Personal memory"),
                    detail: appLanguage.text(
                        "A reviewable personal-memory registry is not connected yet. No local switch pretends to change Agent behavior."
                    ),
                    status: appLanguage.text("Not available"),
                    tone: .muted
                )

                AgentCapabilityRow(
                    title: appLanguage.text("Derived patterns"),
                    detail: appLanguage.text(
                        "Habit and preference patterns will stay proposed until their source, scope, and deletion path are visible."
                    ),
                    status: appLanguage.text("Planned"),
                    tone: .muted
                )
            } header: {
                Text(appLanguage.text("Memory scope"))
            } footer: {
                Text(
                    appLanguage.text(
                        "Memory can shape a proposal. It can never authorize an external action."
                    )
                )
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.tsSurface)
        .navigationTitle(appLanguage.text("Memory"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("agent-memory")
    }
}

private enum AgentStatusTone {
    case active
    case review
    case muted

    var foreground: Color {
        switch self {
        case .active:
            return .tsConfirmed
        case .review:
            return .tsVermilion
        case .muted:
            return .tsMutedInk
        }
    }

    var background: Color {
        switch self {
        case .active:
            return .tsConfirmed.opacity(0.12)
        case .review:
            return .tsVermilion.opacity(0.12)
        case .muted:
            return .tsSurfaceMuted
        }
    }
}

private struct AgentDestinationRow: View {
    let systemImage: String
    let title: String
    let detail: String
    let status: String?
    let tone: AgentStatusTone

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Color.tsInk)
                .frame(width: 30, height: 30)
                .background(Color.tsSurfaceMuted, in: Circle())

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Color.tsInk)

                    Spacer(minLength: 4)

                    if let status {
                        Text(status)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(tone.foreground)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(tone.background, in: Capsule())
                    }
                }

                Text(detail)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .lineLimit(2)
            }

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
        }
        .padding(.vertical, 15)
        .contentShape(Rectangle())
    }
}

private struct AgentCapabilityRow: View {
    let title: String
    let detail: String
    let status: String
    let tone: AgentStatusTone

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)

                Spacer(minLength: 8)

                Text(status)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(tone.foreground)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(tone.background, in: Capsule())
            }

            Text(detail)
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
    }
}

private struct AgentRowDivider: View {
    var body: some View {
        Divider()
            .overlay(Color.tsLine)
            .padding(.leading, 44)
    }
}
