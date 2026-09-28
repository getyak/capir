import SwiftUI

struct RelationshipChangeReviewView: View {
    let person: RelationshipArchivePerson
    let actorDisplayName: String
    let sourceTimezone: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLanguage) private var appLanguage
    @StateObject private var reviewStore: PursuitProposalReviewStore

    init(
        person: RelationshipArchivePerson,
        reviewSession: PursuitProposalReviewSession? = nil,
        service: PursuitProposalReviewServing? = nil,
        actorDisplayName: String = "Current recruiter",
        sourceTimezone: String = TimeZone.current.identifier
    ) {
        self.person = person
        self.actorDisplayName = actorDisplayName
        self.sourceTimezone = sourceTimezone
        _reviewStore = StateObject(
            wrappedValue: PursuitProposalReviewStore(
                session: reviewSession,
                service: service
            )
        )
    }

    private var subjectName: String {
        reviewStore.proposal?.reviewContext.subject.displayLabel ?? person.name
    }

    private var displayedEvidence: String {
        guard let proposal = reviewStore.proposal else { return person.evidence }
        return proposal.reviewContext.evidence.first?.text
            ?? appLanguage.text("No reviewable evidence text is available for this Proposal.")
    }

    private var evidenceSourceSummary: String {
        guard let proposal = reviewStore.proposal,
              let evidence = proposal.reviewContext.evidence.first else {
            return person.provenance
        }
        return "\(evidence.sourceDisplayName) · \(appLanguage.evidenceFreshness(observedAt: evidence.observedAt, sourceTimezone: evidence.sourceTimezone))"
    }

    private var relativeDateWarning: String? {
        let normalized = displayedEvidence.lowercased()
        let relativePhrases = [
            "next monday", "next tuesday", "next wednesday", "next thursday",
            "next friday", "next saturday", "next sunday", "tomorrow",
            "this monday", "this tuesday", "this wednesday", "this thursday",
            "this friday", "this weekend",
        ]
        guard relativePhrases.contains(where: normalized.contains) else { return nil }
        return appLanguage.text("This evidence contains a relative date. It remains quoted context, not a scheduled date; confirm the absolute date and timezone before creating a due Action.")
    }

    private var proposalHeadline: String {
        reviewStore.proposal?.summary ?? person.proposedState
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    RelationshipModalEyebrow(appLanguage.text("Evidence"))
                        .padding(.top, 34)

                    RelationshipExactEvidenceSection(
                        text: displayedEvidence,
                        sourceSummary: evidenceSourceSummary,
                        proposal: reviewStore.proposal
                    )
                    .padding(.top, 18)
                    .accessibilityIdentifier("review-exact-evidence")

                    RelationshipCausalSeam()
                        .frame(maxWidth: .infinity)

                    if let relativeDateWarning {
                        RelationshipReviewStatusCard(
                            title: appLanguage.text("Relative time remains unresolved"),
                            detail: relativeDateWarning,
                            systemImage: "calendar.badge.exclamationmark"
                        )
                        .padding(.bottom, 22)
                    }

                    RelationshipModalEyebrow(
                        reviewStore.proposal.map {
                            "\(appLanguage.text("Pursuit")) · \($0.reviewContext.pursuit.title)"
                        } ?? appLanguage.text("Proposed change")
                    )

                    Text(proposalHeadline)
                        .font(.custom("Georgia", size: 29, relativeTo: .title2))
                        .foregroundStyle(Color.tsInk)
                        .tracking(-0.6)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)

                    Text(appLanguage.text("Review each change below. Applying it updates only canonical Pursuit state—no message or external write."))
                        .font(.subheadline)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)

                    if let proposal = reviewStore.proposal,
                       proposal.evidenceState.availability != "available" {
                        RelationshipReviewStatusCard(
                            title: appLanguage.evidenceAttentionLabel(proposal.evidenceState),
                            detail: appLanguage.evidenceExplanation(proposal.evidenceState),
                            systemImage: "exclamationmark.shield"
                        )
                        .padding(.top, 18)
                    }

                    if let proposal = reviewStore.proposal {
                        VStack(alignment: .leading, spacing: 34) {
                            ForEach(Array(proposal.items.enumerated()), id: \.element.id) { index, item in
                                RelationshipProposalReviewItemView(
                                    item: item,
                                    index: index,
                                    totalCount: proposal.items.count,
                                    draft: reviewStore.phase == .ready
                                        ? reviewStore.drafts[item.id]
                                        : nil,
                                    validationMessage: reviewStore.editValidationMessage(for: item)
                                        .map { appLanguage.text($0) },
                                    onSelect: { reviewStore.select($0, for: item.id) },
                                    onEdit: { field, value in
                                        reviewStore.updateEditedField(
                                            field,
                                            value: value,
                                            for: item.id
                                        )
                                    }
                                )
                            }
                        }
                        .padding(.top, 24)
                    }

                    switch reviewStore.phase {
                    case .previewOnly:
                        RelationshipReviewStatusCard(
                            title: appLanguage.text("Canonical review not connected"),
                            detail: appLanguage.text("This synthetic preview has no Proposal ID, so no confirmation control is available and nothing can be presented as applied."),
                            systemImage: "lock.shield"
                        )
                        .padding(.top, 22)
                    case .loading:
                        HStack(spacing: 12) {
                            ProgressView()
                            Text(appLanguage.text("Loading canonical Proposal…"))
                                .font(.subheadline)
                                .foregroundStyle(Color.tsMutedInk)
                        }
                        .padding(.top, 22)
                    case .ready:
                        VStack(alignment: .leading, spacing: 12) {
                            if let notice = reviewStore.notice {
                                Label(appLanguage.text(notice), systemImage: "checkmark.shield")
                                    .font(.caption)
                                    .foregroundStyle(Color.tsMutedInk)
                            }

                            Text(
                                String(
                                    format: appLanguage.text("%1$lld of %2$lld decisions complete"),
                                    locale: appLanguage.locale,
                                    reviewStore.decidedItemCount,
                                    reviewStore.proposal?.items.count ?? 0
                                )
                            )
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.tsMutedInk)

                            if let evidenceBlock = reviewStore.evidenceBlockingMessage {
                                RelationshipReviewStatusCard(
                                    title: appLanguage.text("Evidence no longer reviewable"),
                                    detail: appLanguage.text(evidenceBlock),
                                    systemImage: "exclamationmark.shield"
                                )
                            }

                            Button(appLanguage.text("Apply reviewed decisions")) {
                                Task { await reviewStore.submit() }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.tsInk)
                            .controlSize(.large)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .disabled(!reviewStore.canSubmit)
                            .accessibilityHint(
                                reviewStore.canSubmit
                                    ? appLanguage.text("Records these decisions in canonical Pursuit state. No external action is performed.")
                                    : appLanguage.text("Choose a valid decision for every Proposal item first.")
                            )
                            .accessibilityIdentifier("confirm-relationship-change")
                        }
                        .padding(.top, 22)
                    case .confirming:
                        RelationshipReviewStatusCard(
                            title: appLanguage.text("Confirming with canonical state"),
                            detail: appLanguage.text("One recovery reference is saved until canonical readback finishes. Do not submit this review again."),
                            systemImage: "arrow.triangle.2.circlepath"
                        )
                        .padding(.top, 22)
                    case let .recorded(result):
                            RelationshipReviewReceipt(
                            result: result,
                            actorDisplayName: actorDisplayName,
                            sourceTimezone: sourceTimezone
                        )
                            .padding(.top, 22)
                    case let .conflict(message):
                        RelationshipReviewStatusCard(
                            title: appLanguage.text("Pursuit changed"),
                            detail: "\(appLanguage.text(message)) \(appLanguage.text("Nothing from this review was applied."))",
                            systemImage: "arrow.triangle.branch"
                        )
                        .padding(.top, 22)
                    case let .unknownLocked(operationID):
                        VStack(alignment: .leading, spacing: 12) {
                            RelationshipReviewStatusCard(
                                title: appLanguage.text("Outcome unknown — operation locked"),
                                detail: appLanguage.text("The saved review may or may not have applied. Check canonical readback before trying again; the same recovery reference will be used."),
                                systemImage: "questionmark.diamond"
                            )
                            DisclosureGroup(appLanguage.text("Audit details")) {
                                Text("\(appLanguage.text("Recovery reference")) \(operationID.uuidString.lowercased())")
                                    .font(.caption2)
                                    .foregroundStyle(Color.tsMutedInk)
                            }
                            Button(appLanguage.text("Check canonical status")) {
                                Task { await reviewStore.reconcile() }
                            }
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("reconcile-relationship-review")
                        }
                        .padding(.top, 22)
                    case let .failed(message):
                        VStack(alignment: .leading, spacing: 12) {
                            RelationshipReviewStatusCard(
                                title: appLanguage.text("Review not applied"),
                                detail: appLanguage.text(message),
                                systemImage: "exclamationmark.triangle"
                            )
                            Button(appLanguage.text("Retry loading Proposal")) {
                                Task { await reviewStore.load() }
                            }
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: 44)
                        }
                        .padding(.top, 22)
                    }

                    if reviewStore.proposal == nil {
                        VStack(spacing: 0) {
                            RelationshipDefinitionRow(
                                label: appLanguage.text("Current"),
                                value: person.previousState
                            )
                            RelationshipDefinitionRow(
                                label: appLanguage.text("Proposed"),
                                value: person.proposedState
                            )
                        }
                        .padding(.top, 40)
                    }
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .background(Color.tsSurface.ignoresSafeArea())
            .navigationTitle(appLanguage.text("Review change"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "arrow.left")
                    }
                    .accessibilityLabel(appLanguage.text("Close relationship review"))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    RelationshipReviewIdentityAvatar(label: subjectName)
                }
            }
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarBackground(Color.tsSurface, for: .navigationBar)
        }
        .tint(.tsInk)
        .accessibilityIdentifier("relationship-change-review")
        .task {
            await reviewStore.load()
        }
    }

}

private struct RelationshipExactEvidenceSection: View {
    let text: String
    let sourceSummary: String
    let proposal: PursuitProposalSnapshot?
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "quote.opening")
                .font(.headline.weight(.semibold))
                .foregroundStyle(Color.tsVermilion)

            Text("“\(text)”")
                .font(.custom("Georgia", size: 22, relativeTo: .body))
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)

            Label(sourceSummary, systemImage: "link")
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)

            if let proposal,
               let evidence = proposal.reviewContext.evidence.first {
                DisclosureGroup(appLanguage.text("Source details")) {
                    VStack(spacing: 0) {
                        evidenceDetail(
                            appLanguage.text("Person"),
                            proposal.reviewContext.subject.displayLabel
                        )
                        evidenceDetail(
                            appLanguage.text("Role"),
                            proposal.reviewContext.subject.contextualRoles
                                .map { appLanguage.workspaceValue($0.roleType) }
                                .joined(separator: ", ")
                        )
                        evidenceDetail(
                            appLanguage.text("Speaker"),
                            appLanguage.workspaceValue(evidence.attributedActor)
                        )
                        evidenceDetail(
                            appLanguage.text("Channel"),
                            evidence.inputChannel == "ios_share"
                                ? appLanguage.text("iOS Share")
                                : appLanguage.workspaceValue(evidence.inputChannel)
                        )
                        evidenceDetail(
                            appLanguage.text("Attribution"),
                            appLanguage.workspaceValue(evidence.attributionStatus)
                        )
                        evidenceDetail(
                            appLanguage.text("Review"),
                            appLanguage.workspaceValue(evidence.reviewStatus)
                        )
                        evidenceDetail(
                            appLanguage.text("Reference"),
                            evidence.fragmentID
                        )
                    }
                    .padding(.top, 8)
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                .accessibilityIdentifier("review-source-details")
            }
        }
        .padding(18)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .contain)
    }

    private func evidenceDetail(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(0.5)
                .foregroundStyle(Color.tsMutedInk)
                .frame(minWidth: 76, alignment: .leading)
            Text(value)
                .font(.caption)
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Divider().overlay(Color.tsLine) }
    }
}

struct RelationshipResumeView: View {
    let person: RelationshipArchivePerson
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    RelationshipModalEyebrow("Resume with context")
                        .padding(.top, 28)

                    Text("You stopped while reviewing \(person.name.components(separatedBy: " ").first ?? person.name).")
                        .font(.custom("Georgia", size: 35, relativeTo: .largeTitle))
                        .foregroundStyle(Color.tsInk)
                        .tracking(-0.8)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)

                    Text("Your edits are saved. No message was sent.")
                        .font(.body)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 14)

                    VStack(alignment: .leading, spacing: 18) {
                        HStack {
                            RelationshipInitialsAvatar(person: person, size: 48)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(person.relationship)
                                    .font(.custom("Georgia", size: 18, relativeTo: .headline))
                                    .foregroundStyle(Color.tsInk)
                                Text("Evidence 2 of 3")
                                    .font(.caption)
                                    .foregroundStyle(Color.tsMutedInk)
                            }
                            Spacer()
                        }

                        Text(person.dependency)
                            .font(.body)
                            .foregroundStyle(Color.tsInk)
                            .fixedSize(horizontal: false, vertical: true)

                        NavigationLink {
                            RelationshipChangeReviewView(person: person)
                        } label: {
                            HStack {
                                Text("Continue review")
                                Spacer()
                                Image(systemName: "arrow.right")
                            }
                            .font(.headline)
                            .foregroundStyle(Color.tsInk)
                            .frame(minHeight: 48)
                            .overlay(alignment: .bottom) {
                                Rectangle().fill(Color.tsInk).frame(height: 1)
                            }
                        }
                        .accessibilityIdentifier("continue-preserved-review")
                    }
                    .padding(.top, 36)

                    Label(
                        "Review progress describes preserved work, not candidate quality.",
                        systemImage: "lock.shield"
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 42)
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .background(Color.tsSurface.ignoresSafeArea())
            .navigationTitle("Continue review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .tint(.tsInk)
        .accessibilityIdentifier("relationship-resume-review")
    }
}

struct RelationshipDetailView: View {
    let person: RelationshipArchivePerson
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top, spacing: 16) {
                        RelationshipInitialsAvatar(person: person, size: 64)
                        VStack(alignment: .leading, spacing: 5) {
                            RelationshipModalEyebrow(person.state.rawValue)
                            Text(person.name)
                                .font(.custom("Georgia", size: 30, relativeTo: .title))
                                .foregroundStyle(Color.tsInk)
                            Text("\(person.role) · \(person.company)")
                                .font(.subheadline)
                                .foregroundStyle(Color.tsMutedInk)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.top, 30)

                    RelationshipDefinitionRow(
                        label: "Context",
                        value: person.relationship
                    )
                    .padding(.top, 32)

                    RelationshipModalEyebrow("Current dependency")
                        .padding(.top, 30)
                    Text(person.dependency)
                        .font(.custom("Georgia", size: 28, relativeTo: .title2))
                        .foregroundStyle(Color.tsInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 10)

                    RelationshipModalEyebrow("Exact evidence")
                        .padding(.top, 36)
                    Text("“\(person.evidence)”")
                        .font(.custom("Georgia", size: 21, relativeTo: .title3))
                        .foregroundStyle(Color.tsInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)
                    Text(person.provenance)
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 10)

                    RelationshipModalEyebrow("Smallest supported step")
                        .padding(.top, 36)
                    Text(person.nextStep)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 10)

                    Text("Draft only · Review evidence before confirming any relationship change. External action requires a separate approval.")
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 14)
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .background(Color.tsSurface.ignoresSafeArea())
            .navigationTitle(person.relationship)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .tint(.tsInk)
        .accessibilityIdentifier("relationship-detail-\(person.id)")
    }
}

struct RelationshipMenuView: View {
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
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLanguage) private var appLanguage
    @AppStorage(AppLanguage.storageKey) private var storedLanguage =
        AppLanguage.system.rawValue
    @AppStorage(TalentSignalSetupPreference.actionButtonCompleteKey)
    private var isActionButtonSetupComplete = false
    @AppStorage(TalentSignalSetupPreference.screenshotShortcutReceivedAtKey)
    private var screenshotShortcutReceivedAt = 0.0
    @State private var selectedDetent: PresentationDetent = .medium

    private var selectedLanguage: AppLanguage {
        AppLanguage.stored(storedLanguage)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        expandedDestination(
                            AccountSettingsView(
                                isCanonical: isCanonical,
                                workspaceID: workspaceID,
                                workspaceLabel: workspaceLabel,
                                accountName: accountName,
                                accountEmail: accountEmail,
                                signOutNotice: signOutNotice,
                                onSignOut: wrappedSignOut
                            )
                        )
                    } label: {
                        RelationshipMenuAccountRow(
                            accountName: accountName ?? "Talent Signal",
                            subtitle: accountSubtitle
                        )
                    }
                    .accessibilityIdentifier("open-account-settings")
                }

                if !isActionButtonSetupComplete {
                    Section {
                        NavigationLink {
                            expandedDestination(ActionButtonSetupView())
                        } label: {
                            RelationshipMenuSetupRow()
                        }
                        .accessibilityIdentifier("open-action-button-onboarding")
                    }
                }

                Section {
                    NavigationLink {
                        expandedDestination(DisplaySettingsView())
                    } label: {
                        RelationshipMenuUtilityRow(
                            systemImage: "textformat.size",
                            title: appLanguage.text("Display & text"),
                            detail: appLanguage.text(
                                "Adjust reading size and retrieval-card density."
                            )
                        )
                    }
                    .accessibilityIdentifier("open-display-settings")

                    NavigationLink {
                        expandedDestination(AppSettingsView())
                    } label: {
                        RelationshipMenuUtilityRow(
                            systemImage: "globe",
                            title: appLanguage.text("Interface language"),
                            detail: appLanguage.text(
                                "Choose the language used for controls and guidance."
                            ),
                            value: selectedLanguage.displayName(in: appLanguage)
                        )
                    }
                    .accessibilityIdentifier("open-settings")
                } header: {
                    Text(appLanguage.text("Appearance"))
                }

                Section {
                    NavigationLink {
                        expandedDestination(AppVersionStatusView())
                    } label: {
                        RelationshipMenuUtilityRow(
                            systemImage: "info.circle",
                            title: appLanguage.text("Version & status", zhHans: "版本与状态"),
                            detail: appLanguage.text(
                                "Installed build on this iPhone and update-check source.",
                                zhHans: "查看这台 iPhone 安装的版本与更新核验来源。"
                            ),
                            value: InstalledAppVersion.label()
                        )
                    }
                    .accessibilityIdentifier("open-version-status")
                } header: {
                    Text(appLanguage.text("About this app", zhHans: "关于此应用"))
                }

                Section {
                    if !proposals.isEmpty {
                        NavigationLink {
                            expandedDestination(
                                RelationshipProposalInboxView(
                                    proposals: proposals,
                                    onOpenProposal: openProposal
                                )
                            )
                        } label: {
                            RelationshipMenuUtilityRow(
                                systemImage: "checkmark.bubble",
                                title: appLanguage.text("Review inbox"),
                                detail: appLanguage.text(
                                    "Open exact evidence and proposed changes."
                                ),
                                value: "\(proposals.count)"
                            )
                        }
                        .accessibilityIdentifier("open-review-inbox")
                    }

                    NavigationLink {
                        expandedDestination(ActionButtonSetupView())
                    } label: {
                        RelationshipMenuUtilityRow(
                            systemImage: "button.programmable",
                            title: appLanguage.text("Action Button & Shortcuts"),
                            detail: appLanguage.text(
                                "Capture, record, or review from the system."
                            ),
                            value: screenshotShortcutReceivedAt > 0
                                ? appLanguage.text("Local receipt")
                                : isActionButtonSetupComplete
                                    ? appLanguage.text("Assigned")
                                    : nil
                        )
                    }
                    .accessibilityIdentifier("open-action-button-settings")

                    NavigationLink {
                        expandedDestination(CalendarSyncSettingsView())
                    } label: {
                        RelationshipMenuUtilityRow(
                            systemImage: "calendar.badge.plus",
                            title: appLanguage.text("Calendar sync"),
                            detail: appLanguage.text(
                                "Project confirmed events one way to Apple Calendar."
                            )
                        )
                    }
                    .accessibilityIdentifier("open-calendar-sync-settings")

                    NavigationLink {
                        expandedDestination(ApprovalSettingsView())
                    } label: {
                        RelationshipMenuUtilityRow(
                            systemImage: "lock.shield",
                            title: appLanguage.text("Approval & data"),
                            detail: appLanguage.text(
                                "Every consequential action stays reviewable."
                            )
                        )
                    }
                    .accessibilityIdentifier("open-approval-settings")
                } header: {
                    Text(appLanguage.text("Workspace tools"))
                }

                if onOpenInternalTesting != nil {
                    Section {
                        Button(action: openInternalTesting) {
                            RelationshipMenuUtilityRow(
                                systemImage: "flask",
                                title: appLanguage.text(
                                    "Internal testing",
                                    zhHans: "内部测试"
                                ),
                                detail: appLanguage.text(
                                    "Experiments, diagnostics, and isolated test worlds.",
                                    zhHans: "实验、诊断与隔离测试环境。"
                                ),
                                value: internalTestingStatus
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("open-internal-testing")
                    } header: {
                        Text(
                            appLanguage.text(
                                "Internal build",
                                zhHans: "内部版本"
                            )
                        )
                    } footer: {
                        Text(
                            appLanguage.text(
                                "Available only when this build or workspace enables internal tools.",
                                zhHans: "仅在内部版本或工作区启用测试工具时显示。"
                            )
                        )
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color.tsSurface)
            .navigationTitle(appLanguage.text("Workspace"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Color.tsInk)
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(appLanguage.text("Close"))
                    .accessibilityIdentifier("close-relationship-menu")
                }
            }
        }
        .tint(.tsInk)
        .presentationDetents([.medium, .large], selection: $selectedDetent)
    }

    private var accountSubtitle: String {
        if let accountEmail {
            return accountEmail
        }
        return appLanguage.text(
            isCanonical ? "Canonical workspace" : "Synthetic preview"
        )
    }

    private var wrappedSignOut: (() async -> Bool)? {
        onSignOut.map { signOut in
            {
                let didSignOut = await signOut()
                if didSignOut { dismiss() }
                return didSignOut
            }
        }
    }

    private func openProposal(_ proposal: WorkspaceProposal) {
        dismiss()
        Task { @MainActor in
            await Task.yield()
            onOpenProposal(proposal)
        }
    }

    private func openInternalTesting() {
        guard let onOpenInternalTesting else { return }
        dismiss()
        Task { @MainActor in
            await Task.yield()
            onOpenInternalTesting()
        }
    }

    private func expandedDestination<Destination: View>(
        _ destination: Destination
    ) -> some View {
        destination
            .onAppear { selectedDetent = .large }
            .onDisappear { selectedDetent = .medium }
    }
}

private struct RelationshipMenuAccountRow: View {
    let accountName: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 14) {
            AccountInitialsAvatar(label: accountName, size: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text(accountName)
                    .font(.headline)
                    .foregroundStyle(Color.tsInk)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .lineLimit(1)
            }
        }
        .frame(minHeight: 58)
    }
}

private struct RelationshipMenuSetupRow: View {
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: "button.programmable")
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                .frame(width: 34, height: 34)
                .background(Color.tsCanvas, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(appLanguage.text("Set up quick capture"))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                    Spacer(minLength: 8)
                    Text(appLanguage.text("One-time setup"))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.tsMutedInk)
                }
                Text(
                    appLanguage.text(
                        "Use the iPhone Action Button or Shortcuts without hunting through the app."
                    )
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 5)
    }
}

private struct RelationshipMenuUtilityRow: View {
    let systemImage: String
    let title: String
    let detail: String
    var value: String?

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: systemImage)
                .font(.body.weight(.medium))
                .foregroundStyle(Color.tsMutedInk)
                .frame(width: 28)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.tsInk)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .lineLimit(2)
            }

            Spacer(minLength: 8)

            if let value {
                Text(value)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsMutedInk)
                    .multilineTextAlignment(.trailing)
            }
        }
        .frame(minHeight: 52)
    }
}

private struct RelationshipProposalInboxView: View {
    let proposals: [WorkspaceProposal]
    let onOpenProposal: (WorkspaceProposal) -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        List(proposals) { proposal in
            Button {
                onOpenProposal(proposal)
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    Text(proposal.summary)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.tsInk)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(
                        "\(proposal.subjectDisplayLabel) · \(proposal.status.replacingOccurrences(of: "_", with: " "))"
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                }
                .frame(minHeight: 52, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("inbox-proposal-\(proposal.id)")
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.tsSurface)
        .navigationTitle(appLanguage.text("Review inbox"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("review-inbox")
    }
}

private struct RelationshipReviewIdentityAvatar: View {
    let label: String

    private var initials: String {
        label.split(separator: " ")
            .prefix(2)
            .compactMap(\.first)
            .map(String.init)
            .joined()
            .uppercased()
    }

    var body: some View {
        Text(initials)
            .font(.custom("Georgia", size: 14, relativeTo: .caption))
            .foregroundStyle(Color.tsInk)
            .frame(width: 36, height: 36)
            .background(Color.tsCanvas, in: Circle())
            .overlay { Circle().stroke(Color.tsLine, lineWidth: 1) }
            .accessibilityLabel(label)
    }
}

private struct RelationshipProposalReviewItemView: View {
    let item: PursuitProposalSnapshot.Item
    let index: Int
    let totalCount: Int
    let draft: PursuitProposalDecisionDraft?
    let validationMessage: String?
    let onSelect: (PursuitProposalReviewChoice) -> Void
    let onEdit: (String, String) -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            RelationshipModalEyebrow(changeLabel)

            RelationshipDefinitionRow(
                label: appLanguage.text("Current"),
                value: appLanguage.workspaceTerm(item.beforeValue.displayText),
                accessibilityIdentifier: "proposal-current-\(item.id)"
            )
            RelationshipDefinitionRow(
                label: appLanguage.text("Proposed"),
                value: appLanguage.workspaceTerm(item.proposedValue.displayText),
                accessibilityIdentifier: "proposal-proposed-\(item.id)"
            )

            VStack(alignment: .leading, spacing: 8) {
                Text(appLanguage.text("Why it was suggested"))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                Text(appLanguage.workspaceTerm(item.reason))
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                Text(appLanguage.workspaceTerm(item.effectSummary))
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
            }
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("proposal-reason-\(item.id)")

            Label(
                appLanguage.evidenceExplanation(item.evidenceState),
                systemImage: item.evidenceState.availability == "available"
                    ? "checkmark.shield"
                    : "exclamationmark.shield"
            )
            .font(.caption)
            .foregroundStyle(
                item.evidenceState.availability == "available"
                    ? Color.tsMutedInk
                    : Color.tsVermilion
            )

            if let draft {
                RelationshipProposalItemDecisionEditor(
                    item: item,
                    draft: draft,
                    validationMessage: validationMessage,
                    onSelect: onSelect,
                    onEdit: onEdit
                )
            }
        }
        .padding(.top, 2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("proposal-item-\(item.id)")
    }

    private var changeLabel: String {
        String(
            format: appLanguage.text("Change %1$lld of %2$lld · %3$@"),
            locale: appLanguage.locale,
            index + 1,
            totalCount,
            appLanguage.workspaceValue(item.epistemicStatus)
        )
    }
}

private struct RelationshipProposalItemDecisionEditor: View {
    let item: PursuitProposalSnapshot.Item
    let draft: PursuitProposalDecisionDraft
    let validationMessage: String?
    let onSelect: (PursuitProposalReviewChoice) -> Void
    let onEdit: (String, String) -> Void
    @Environment(\.appLanguage) private var appLanguage

    private var availableChoices: [PursuitProposalReviewChoice] {
        PursuitProposalReviewChoice.allCases.filter { choice in
            choice != .edit || item.proposedValue.editableFields != nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(appLanguage.text("Your decision"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                .accessibilityIdentifier("proposal-decision-heading-\(item.id)")

            VStack(spacing: 8) {
                ForEach(availableChoices) { choice in
                    Button {
                        onSelect(choice)
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(
                                systemName: draft.choice == choice
                                    ? "checkmark.circle.fill"
                                    : "circle"
                            )
                            .font(.title3)
                            .foregroundStyle(
                                draft.choice == choice ? Color.tsInk : Color.tsMutedInk
                            )

                            VStack(alignment: .leading, spacing: 3) {
                                Text(appLanguage.text(choice.label))
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Color.tsInk)
                                Text(choice.detail(in: appLanguage))
                                    .font(.caption)
                                    .foregroundStyle(Color.tsMutedInk)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .background(
                            draft.choice == choice ? Color.tsCanvas : Color.clear,
                            in: RoundedRectangle(cornerRadius: 14)
                        )
                        .overlay {
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(
                                    draft.choice == choice ? Color.tsInk : Color.tsLine,
                                    lineWidth: 1
                                )
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(appLanguage.text(choice.label))
                    .accessibilityHint(choice.detail(in: appLanguage))
                    .accessibilityValue(
                        appLanguage.text(draft.choice == choice ? "Selected" : "Not selected")
                    )
                    .accessibilityIdentifier("proposal-decision-\(choice.rawValue)-\(item.id)")
                }
            }

            if draft.choice == .edit {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(draft.editedFields.keys.sorted(), id: \.self) { field in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(
                                field == "value"
                                    ? appLanguage.text("Corrected value")
                                    : appLanguage.workspaceValue(field)
                            )
                            .font(.caption)
                            .foregroundStyle(Color.tsMutedInk)

                            TextField(
                                appLanguage.text("Required"),
                                text: Binding(
                                    get: { draft.editedFields[field, default: ""] },
                                    set: { onEdit(field, $0) }
                                ),
                                axis: .vertical
                            )
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("proposal-edit-\(field)-\(item.id)")
                        }
                    }

                    if let validationMessage {
                        Label(validationMessage, systemImage: "exclamationmark.circle")
                            .font(.caption)
                            .foregroundStyle(Color.tsVermilion)
                    }
                }
            }
        }
        .padding(.top, 4)
    }
}

private extension PursuitProposalReviewChoice {
    func detail(in language: AppLanguage) -> String {
        switch self {
        case .confirm:
            return language.text("Use the proposed value")
        case .edit:
            return language.text("Correct it before applying")
        case .reject:
            return language.text("Keep the current value")
        case .keepUnresolved:
            return language.text("Leave this for later review")
        }
    }
}

private struct RelationshipReviewReceipt: View {
    let result: PursuitProposalReviewResult
    let actorDisplayName: String
    let sourceTimezone: String
    @Environment(\.appLanguage) private var appLanguage

    private var title: String {
        switch result.receipt.outcome {
        case "canonical_applied":
            return appLanguage.text("Canonical Pursuit updated")
        case "mixed_applied":
            return appLanguage.text("Applied items recorded; unresolved items remain")
        case "kept_unresolved":
            return appLanguage.text("Proposal remains unresolved")
        case "rejected":
            return appLanguage.text("Proposal rejected")
        default:
            return appLanguage.text("Canonical review recorded")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(
                title,
                systemImage: result.receipt.outcome == "canonical_applied"
                    ? "checkmark.seal"
                    : "pause.circle"
            )
            .font(.headline)
            .foregroundStyle(Color.tsInk)

            Text(
                String(
                    format: appLanguage.text(
                        result.receipt.changedFields.count == 1
                            ? "Revision %1$lld → %2$lld · %3$lld changed field"
                            : "Revision %1$lld → %2$lld · %3$lld changed fields"
                    ),
                    locale: appLanguage.locale,
                    result.receipt.entityRef.beforeRevision,
                    result.receipt.entityRef.afterRevision,
                    result.receipt.changedFields.count
                )
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.tsInk)

            Text(result.receipt.summary)
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)

            Text(
                "\(appLanguage.text(actorDisplayName)) · \(appLanguage.recordedDate(at: result.receipt.occurredAt, sourceTimezone: sourceTimezone))"
            )
            .font(.caption)
            .foregroundStyle(Color.tsMutedInk)

            DisclosureGroup(appLanguage.text("Audit details")) {
                Text(
                    "\(appLanguage.text("Operation")) \(result.receipt.operationID) · \(appLanguage.text("receipt")) \(result.receipt.id) · \(appLanguage.text("actor")) \(result.receipt.actorUserID)"
                )
                .font(.caption2)
                .foregroundStyle(Color.tsMutedInk)
            }

            Label(
                appLanguage.text("No message was sent and external effects are empty."),
                systemImage: "lock.shield"
            )
            .font(.caption)
            .foregroundStyle(Color.tsMutedInk)
        }
        .padding(16)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.tsLine, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("relationship-review-receipt")
    }
}

private struct RelationshipReviewStatusCard: View {
    let title: String
    let detail: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: systemImage)
                .font(.headline)
                .foregroundStyle(Color.tsInk)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.tsLine, lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("relationship-review-status")
    }
}

private struct RelationshipCausalSeam: View {
    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(Color.tsVermilion)
                .frame(width: 1, height: 58)
            Circle()
                .fill(Color.tsVermilion)
                .frame(width: 8, height: 8)
        }
        .padding(.vertical, 2)
        .accessibilityHidden(true)
    }
}

private struct RelationshipDefinitionRow: View {
    let label: String
    let value: String
    var accessibilityIdentifier: String? = nil
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) {
                    labelView
                    valueView
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 16) {
                    labelView
                        .frame(minWidth: 78, alignment: .leading)
                    valueView
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(.vertical, 16)
        .overlay(alignment: .bottom) { Divider().overlay(Color.tsLine) }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(accessibilityIdentifier ?? "")
    }

    private var labelView: some View {
        Text(label.uppercased())
            .font(.caption2.weight(.semibold))
            .tracking(0.7)
            .foregroundStyle(Color.tsMutedInk)
            .fixedSize(horizontal: true, vertical: false)
    }

    private var valueView: some View {
        Text(value)
            .font(.subheadline)
            .foregroundStyle(Color.tsInk)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct RelationshipModalEyebrow: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text.uppercased())
            .font(.caption2.weight(.bold))
            .tracking(1.05)
            .foregroundStyle(Color.tsVermilion)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct RelationshipInitialsAvatar: View {
    let person: RelationshipArchivePerson
    let size: CGFloat

    var body: some View {
        Text(person.initials)
            .font(.custom("Georgia", size: size * 0.3, relativeTo: .body))
            .foregroundStyle(Color.tsMutedInk)
            .frame(width: size, height: size)
            .background(Color.tsCanvas, in: Circle())
            .overlay { Circle().stroke(Color.tsLine, lineWidth: 1) }
            .accessibilityLabel(person.name)
    }
}

private struct RelationshipQuietDecisionStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline)
            .foregroundStyle(Color.tsMutedInk)
            .frame(maxWidth: .infinity, minHeight: 48)
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

private struct RelationshipUnderlinedDecisionStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.medium))
            .foregroundStyle(Color.tsInk)
            .frame(maxWidth: .infinity, minHeight: 48)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.tsInk).frame(height: 1)
            }
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

#Preview("Evidence review") {
    RelationshipChangeReviewView(person: .leila)
}
