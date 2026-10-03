import SwiftUI

struct RelationshipWorkspaceView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            if model.isSyntheticFixture { SyntheticFixtureBanner() }

            NavigationSplitView {
                WorkspaceSidebar()
            } detail: {
                Group {
                    switch model.selectedNavigation ?? .today {
                    case .today:
                        TodayView()
                    case .actionCenter:
                        if model.hasActionCenterWork {
                            ActionCenterView()
                        } else {
                            TodayView()
                        }
                    case .workspace:
                        if let item = model.focusedTodayAttentionItem {
                            TodayRelationshipDetailView(item: item)
                        } else {
                            RelationshipDetailView()
                        }
                    }
                }
                .background(TSBrand.canvas)
            }
            .navigationSplitViewStyle(.balanced)
            .navigationSplitViewColumnWidth(min: 220, ideal: 236, max: 270)
        }
        .animation((reduceMotion || model.isReducedMotionPreview) ? nil : .easeInOut(duration: 0.18), value: model.mode)
        .toolbar {
            ToolbarItemGroup {
                StatusPill()
                if model.isSyntheticFixture {
                    Menu("Fixture state", systemImage: "testtube.2") {
                        ForEach(WorkspaceMode.allCases) { state in
                            Button(state.title) { model.selectFixtureState(state) }
                                .accessibilityIdentifier("fixture.state.\(state.rawValue)")
                        }
                    }
                    .accessibilityIdentifier("fixture.stateMenu")
                }
            }
        }
        .accessibilityIdentifier("workspace.root")
    }
}

private struct WorkspaceSidebar: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                TSBrandMark(size: 23)
                VStack(alignment: .leading, spacing: 1) {
                    Text("capri")
                        .font(.headline)
                        .foregroundStyle(TSBrand.ink)
                    Text("Workspace")
                        .font(.caption)
                        .foregroundStyle(TSBrand.secondaryInk)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 22)

            SectionLabel(text: "Workspace")
                .padding(.horizontal, 17)
                .padding(.bottom, 7)

            VStack(spacing: 4) {
                ForEach(NavigationDestination.allCases.filter { $0 != .actionCenter || model.hasActionCenterWork }) { item in
                    SidebarNavigationButton(item: item)
                }
            }
            .padding(.horizontal, 8)

            if model.scopeReviewStatus == .confirmed {
                ActivePursuitSummary()
                    .padding(.horizontal, 12)
                    .padding(.top, 24)
            }

            Spacer(minLength: 20)

            if let item = model.focusedTodayAttentionItem {
                FocusedTodaySidebarSummary(item: item)
                    .padding(12)
            } else if let decision = model.pendingDecision {
                DecisionGateSidebarSummary(decision: decision)
                    .padding(12)
            } else if model.canonicalReceipt != nil {
                SavedResultSidebarSummary()
                    .padding(12)
            } else {
                IntakeControl()
                    .padding(12)
            }
        }
        .frame(minWidth: 220, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(TSBrand.sidebar)
        .overlay(alignment: .trailing) {
            Rectangle().fill(TSBrand.hairline.opacity(0.75)).frame(width: 1)
        }
        .accessibilityIdentifier("workspace.navigation")
    }
}

private struct SavedResultSidebarSummary: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Saved result", systemImage: "checkmark.circle.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.evidence)
            Text("Relationship updated")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.ink)
            Text("The reviewed changes were saved together.")
                .font(.caption)
                .foregroundStyle(TSBrand.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
            Label("Nothing was sent", systemImage: "hand.raised")
                .font(.caption2.weight(.medium))
                .foregroundStyle(TSBrand.secondaryInk)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(TSBrand.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(TSBrand.evidence.opacity(0.32))
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("canonical.sidebarSavedResult")
    }
}

private struct DecisionGateSidebarSummary: View {
    let decision: CanonicalProposalReview

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Decision gate", systemImage: "checklist")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.seam)
            Text("\(decision.items.count) proposed change\(decision.items.count == 1 ? "" : "s")")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.ink)
            Text("Nothing is saved until every item has an explicit decision.")
                .font(.caption)
                .foregroundStyle(TSBrand.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
            Label("Exact evidence attached", systemImage: "checkmark.shield")
                .font(.caption2.weight(.medium))
                .foregroundStyle(TSBrand.evidence)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(TSBrand.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(TSBrand.hairline.opacity(0.55))
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("canonical.sidebarDecisionGate")
    }
}

private struct SidebarNavigationButton: View {
    @EnvironmentObject private var model: AppModel
    let item: NavigationDestination

    private var isSelected: Bool { model.selectedNavigation == item }

    var body: some View {
        Button {
            model.selectedNavigation = item
        } label: {
            HStack(spacing: 10) {
                Image(systemName: item.icon)
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 18)
                    .foregroundStyle(isSelected ? TSBrand.seam : TSBrand.secondaryInk)
                Text(item.rawValue)
                    .font(.subheadline.weight(isSelected ? .semibold : .medium))
                    .foregroundStyle(TSBrand.ink)
                Spacer(minLength: 8)
                if item == .actionCenter {
                    Text("\(model.actionCenterCount)")
                        .font(.caption2.monospacedDigit().weight(.semibold))
                        .foregroundStyle(TSBrand.secondaryInk)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(TSBrand.surface, in: Capsule())
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? TSBrand.selection : .clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(alignment: .leading) {
                if isSelected {
                    Capsule().fill(TSBrand.seam).frame(width: 3, height: 18).padding(.leading, 2)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("navigation.\(item.rawValue.replacingOccurrences(of: " ", with: "-"))")
    }
}

private struct ActivePursuitSummary: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                SectionLabel(text: "Current pursuit")
                Spacer()
                Circle().fill(TSBrand.evidence).frame(width: 6, height: 6)
                    .accessibilityHidden(true)
            }
            Text(model.presentation.pursuitTitle)
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.ink)
                .lineLimit(2)
            Text(model.presentation.candidateName)
                .font(.caption)
                .foregroundStyle(TSBrand.secondaryInk)
                .lineLimit(2)
        }
        .padding(12)
        .background(TSBrand.surface.opacity(0.66), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(TSBrand.hairline.opacity(0.55))
        }
        .accessibilityElement(children: .combine)
    }
}

private struct FocusedTodaySidebarSummary: View {
    let item: TodayAttentionItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Read-only Today view", systemImage: "eye")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.secondaryInk)
            Text(item.pursuitTitle)
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.ink)
                .lineLimit(2)
            if let personLabel = item.personLabel {
                Text(personLabel)
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .lineLimit(2)
            }
            Label(
                "Evidence \(item.evidenceAvailability.replacingOccurrences(of: "_", with: " "))",
                systemImage: item.evidenceAvailability == "available" ? "checkmark.shield" : "exclamationmark.shield"
            )
            .font(.caption2.weight(.medium))
            .foregroundStyle(item.evidenceAvailability == "available" ? TSBrand.evidence : TSBrand.seam)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(TSBrand.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(TSBrand.hairline.opacity(0.55))
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("today.detail.sidebar")
    }
}

private struct IntakeControl: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: model.isPaused ? "pause.circle.fill" : "lock.open")
                Text(model.isPaused ? "Context intake paused" : "Manual intake")
                    .font(.caption.weight(.semibold))
            }
            Button(model.isPaused ? "Resume intake" : "Pause intake") {
                model.togglePause()
            }
            .buttonStyle(.borderless)
            .keyboardShortcut("p", modifiers: [.command, .option])
            .accessibilityIdentifier("intake.pause")

            Button("Stop and delete local intake", role: .destructive) {
                model.stopContextIntake()
            }
            .buttonStyle(.borderless)
            .disabled(model.isSignedOut || model.isPaused || (model.capsule.items.isEmpty && model.mode != .working))
            .accessibilityHint("Stops only local context intake and deletes unsubmitted local Capsule items; it does not cancel a canonical Task")
            .accessibilityIdentifier("intake.stop")

            Button("Clear local context", role: .destructive) {
                model.clearLocalContext()
            }
            .buttonStyle(.borderless)
            .disabled(model.capsule.items.isEmpty)
            .accessibilityIdentifier("intake.clear")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(TSBrand.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(TSBrand.hairline.opacity(0.55))
        }
    }
}

private struct StatusPill: View {
    @EnvironmentObject private var model: AppModel

    private var currentTitle: String {
        if let item = model.focusedTodayAttentionItem {
            return statusTitle(item.kind)
        }
        return model.isPaused ? "Paused" : model.mode.title
    }

    private var currentIdentity: String {
        if let item = model.focusedTodayAttentionItem {
            return "today-\(item.id)-\(item.kind.rawValue)"
        }
        return "workspace-\(model.isPaused ? "paused" : model.mode.rawValue)"
    }

    var body: some View {
        Group {
            if let item = model.focusedTodayAttentionItem {
                TSStatusBadge(
                    title: statusTitle(item.kind),
                    systemImage: statusIcon(item.kind),
                    isAttention: item.kind == .proposalReview
                )
            } else {
                TSStatusBadge(
                    title: model.isPaused ? "Paused" : model.mode.title,
                    systemImage: model.isPaused ? "pause.circle" : model.mode.systemImage,
                    isAttention: model.mode == .needsDecision || model.mode == .failed || model.mode == .outcomeUnknown
                )
            }
        }
            .id(currentIdentity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(currentTitle)
            .accessibilityIdentifier("workspace.state")
    }

    private func statusTitle(_ kind: TodayAttentionItem.Kind) -> String {
        switch kind {
        case .proposalReview: "Review"
        case .ownedAction: "Owned action"
        case .openGap: "Open dependency"
        }
    }

    private func statusIcon(_ kind: TodayAttentionItem.Kind) -> String {
        switch kind {
        case .proposalReview: "checklist"
        case .ownedAction: "arrow.forward.circle"
        case .openGap: "circle.dashed"
        }
    }
}

private struct TodayRelationshipDetailView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow
    let item: TodayAttentionItem

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                relationshipHeader
                attentionSummary
                exactEvidence
                nextStep
                relationshipContext
                Divider()
                footerActions
            }
            .frame(maxWidth: 1_060, alignment: .leading)
            .padding(.horizontal, 48)
            .padding(.vertical, 38)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .navigationTitle(item.personLabel ?? item.pursuitTitle)
        .background(TSBrand.canvas)
        .accessibilityIdentifier("today.relationshipDetail")
    }

    @ViewBuilder
    private var exactEvidence: some View {
        if item.kind == .proposalReview {
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel(text: "Exact evidence")

                if item.evidence.isEmpty {
                    Label(
                        "The exact source is not included in this Today readback. Open the canonical review before relying on the proposal.",
                        systemImage: "text.quote"
                    )
                    .font(.callout)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(item.evidence.prefix(2)) { evidence in
                        VStack(alignment: .leading, spacing: 9) {
                            Text("“\(evidence.text)”")
                                .font(.body)
                                .foregroundStyle(TSBrand.ink)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)

                            Text(evidenceMetadata(evidence))
                                .font(.caption)
                                .foregroundStyle(TSBrand.secondaryInk)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(16)
                        .tsSurface(accent: TSBrand.evidence)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("today.detail.evidence")
        }
    }

    private var relationshipHeader: some View {
        HStack(alignment: .top, spacing: 22) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(TSBrand.seam)
                .frame(width: 4, height: 76)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 7) {
                SectionLabel(text: item.pursuitTitle)
                Text(item.personLabel ?? "Relationship follow-up")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(TSBrand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Current Today view · read-only until you review the exact relationship and source")
                    .font(.subheadline)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 16)

            TSStatusBadge(
                title: statusTitle,
                systemImage: statusIcon,
                isAttention: item.kind == .proposalReview
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.detail.header")
    }

    private var attentionSummary: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "What needs attention")
                Text(item.whyNow)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(TSBrand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(item.unresolved)
                    .font(.body)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider()

            Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 10) {
                GridRow {
                    detailLabel("Owner")
                    Text(item.owner)
                }
                GridRow {
                    detailLabel("Due")
                    Text(item.dueAt?.formatted(date: .abbreviated, time: .shortened) ?? item.dueFallback)
                }
                GridRow {
                    detailLabel("Evidence")
                    Label(
                        item.evidenceAvailability.replacingOccurrences(of: "_", with: " ").capitalized,
                        systemImage: item.evidenceAvailability == "available" ? "checkmark.shield" : "exclamationmark.shield"
                    )
                    .foregroundStyle(item.evidenceAvailability == "available" ? TSBrand.evidence : TSBrand.seam)
                }
            }
            .font(.callout)
        }
        .padding(20)
        .tsSurface(raised: true, accent: TSBrand.seam)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.detail.attention")
    }

    private var nextStep: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Smallest next step")
            Text(item.nextMove)
                .font(.title3.weight(.semibold))
                .foregroundStyle(TSBrand.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("This overview does not mark the work complete or change the relationship.")
                .font(.callout)
                .foregroundStyle(TSBrand.secondaryInk)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("today.detail.nextStep")
    }

    @ViewBuilder
    private var relationshipContext: some View {
        if let scope = model.focusedTodayRelationshipScopeOption {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(text: "Canonical relationship")
                Text(scope.personDisplayLabel)
                    .font(.headline)
                    .foregroundStyle(TSBrand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(scope.relationshipContextLabel)
                    .font(.callout)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)

                if let preflight = scope.consequencePreflight {
                    Divider()
                    LabeledContent("Milestone", value: preflight.milestone)
                    LabeledContent("Target", value: preflight.targetDate)
                    LabeledContent(
                        "Source",
                        value: "Evidence \(preflight.evidenceAvailability.replacingOccurrences(of: "_", with: " "))"
                    )
                }

                Label("Viewing this match did not select or confirm it.", systemImage: "lock.open.display")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
            }
            .padding(18)
            .tsSurface()
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("today.detail.canonicalRelationship")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Label("Relationship match still needs review", systemImage: "person.crop.circle.badge.questionmark")
                    .font(.headline)
                    .foregroundStyle(TSBrand.ink)
                Text("Today can name the current Pursuit, but this readback cannot safely choose one Person relationship. Nothing was selected or confirmed.")
                    .font(.callout)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(18)
            .tsSurface()
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("today.detail.unresolvedRelationship")
        }
    }

    private var footerActions: some View {
        HStack(spacing: 12) {
            Button("Back to Today", systemImage: "arrow.left") {
                model.selectedNavigation = .today
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("today.detail.back")

            if item.kind == .proposalReview, item.proposalID != nil {
                Button("Review proposed changes", systemImage: "checklist") {
                    Task { await model.reviewFocusedTodayProposal() }
                }
                .buttonStyle(TSPrimaryButtonStyle())
                .accessibilityHint("Opens the exact current decision gate. No choice is preselected and nothing is saved until every proposed change is reviewed.")
                .accessibilityIdentifier("today.detail.openProposalReview")
            } else {
                Button("Review a conversation", systemImage: "text.quote") {
                    openWindow(id: "quick-panel")
                }
                .buttonStyle(TSPrimaryButtonStyle())
                .accessibilityHint("Opens the Quick Panel for deliberately selected source evidence; it does not read another app or the clipboard automatically")
                .accessibilityIdentifier("today.detail.openQuickPanel")
            }
        }
    }

    private func detailLabel(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(TSBrand.secondaryInk)
            .frame(width: 76, alignment: .leading)
    }

    private func evidenceMetadata(_ evidence: TodayAttentionEvidence) -> String {
        let actor = evidence.attributedActor.replacingOccurrences(of: "_", with: " ").capitalized
        guard let date = ISO8601DateFormatter().date(from: evidence.observedAt) else {
            return "\(actor) · \(evidence.source)"
        }
        return "\(actor) · \(date.formatted(date: .abbreviated, time: .shortened)) · \(evidence.source)"
    }

    private var statusTitle: String {
        switch item.kind {
        case .proposalReview: "Review"
        case .ownedAction: "Owned action"
        case .openGap: "Open dependency"
        }
    }

    private var statusIcon: String {
        switch item.kind {
        case .proposalReview: "checklist"
        case .ownedAction: "arrow.forward.circle"
        case .openGap: "circle.dashed"
        }
    }
}

private struct RelationshipDetailView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: dynamicTypeSize.isAccessibilitySize ? 20 : 26) {
                RelationshipHeader()
                if model.scopeReviewStatus == .proposed {
                    RelationshipScopeReviewView()
                }
                StateContentView()
                if let runAudit = model.runAudit {
                    RunBoundaryView(run: runAudit)
                }
                if model.mode != .needsDecision && model.mode != .receipt {
                    Divider()
                    ContextCapsuleView(compact: false)
                }
            }
            .frame(maxWidth: 1_160, alignment: .leading)
            .padding(.horizontal, dynamicTypeSize.isAccessibilitySize ? 24 : 48)
            .padding(.top, dynamicTypeSize.isAccessibilitySize ? 24 : 36)
            .padding(.bottom, dynamicTypeSize.isAccessibilitySize ? 220 : 36)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .navigationTitle("Relationship Workspace")
        .background(TSBrand.canvas)
        .accessibilityIdentifier("workspace.relationship")
    }
}

struct RelationshipHeaderIdentity: Equatable {
    let primaryName: String
    let descriptor: String?

    init(displayLabel: String) {
        let separators = [" — ", " – "]
        guard let separator = separators.first(where: { displayLabel.contains($0) }),
              let range = displayLabel.range(of: separator) else {
            primaryName = displayLabel
            descriptor = nil
            return
        }

        let name = displayLabel[..<range.lowerBound].trimmingCharacters(in: .whitespacesAndNewlines)
        let detail = displayLabel[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
        primaryName = name.isEmpty ? displayLabel : name
        descriptor = detail.isEmpty ? nil : detail
    }
}

private struct RunBoundaryView: View {
    let run: RunAuditSummary
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 9) {
                Text(run.objective)
                    .font(.callout)
                LabeledContent("Context") {
                    Text("\(run.evidenceFragmentIDs.count) pinned evidence fragment(s) · digest \(run.evidenceManifestDigest.prefix(12))…")
                }
                LabeledContent("Budget") {
                    Text("\(run.maxTurns) turns · \(run.maxToolCalls) tool calls · \(run.maxDurationMilliseconds) ms · \(run.maxTaskTokens) tokens · ≤ $\(run.maximumEstimatedUSD, format: .number.precision(.fractionLength(2)))")
                }
                LabeledContent("Eligible capabilities") {
                    Text(run.eligibleCapabilities.joined(separator: ", "))
                }
                LabeledContent("Source authority") {
                    Text("\(run.sourceAccessState) · \(run.sourceAuthorizationState)\(run.sourceAuthorizationExpiresAt.map { " · expires \($0)" } ?? "")")
                }
                LabeledContent("External effects") {
                    Text("\(run.externalEffects.count)")
                }
                Text("Run \(run.runID)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            .padding(.top, 10)
        } label: {
            Label("Bounded Run history", systemImage: "clock.arrow.trianglehead.counterclockwise.rotate.90")
                .font(.headline)
        }
        .padding(18)
        .tsSurface()
        .accessibilityIdentifier("run.boundary")
    }
}

private struct RelationshipHeader: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                accessibilityHeader
            } else {
                standardHeader
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspace.title")
    }

    private var standardHeader: some View {
        HStack(alignment: .top, spacing: 22) {
            headerSeam

            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: model.presentation.pursuitTitle)
                Text(model.presentation.candidateName)
                    .font(.system(size: 26, weight: .semibold, design: .default))
                    .foregroundStyle(TSBrand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("workspace.candidateName")
                Text(model.presentation.relationshipContext)
                    .font(.subheadline)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
                identityTagsBlock
            }
            Spacer(minLength: 16)
            statusBadge
        }
    }

    private var accessibilityHeader: some View {
        HStack(alignment: .top, spacing: 18) {
            headerSeam

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    SectionLabel(text: model.presentation.pursuitTitle)
                    Spacer(minLength: 8)
                    statusBadge
                }

                let identity = RelationshipHeaderIdentity(displayLabel: model.presentation.candidateName)
                Text(identity.primaryName)
                    .font(.title.weight(.semibold))
                    .foregroundStyle(TSBrand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(model.presentation.candidateName)
                    .accessibilityIdentifier("workspace.candidateName")

                if let descriptor = identity.descriptor {
                    Text(descriptor)
                        .font(.title3.weight(.medium))
                        .foregroundStyle(TSBrand.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityHidden(true)
                }

                Text(model.presentation.relationshipContext)
                    .font(.subheadline)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
                identityTagsBlock
            }
        }
    }

    private var headerSeam: some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(TSBrand.seam)
            .frame(width: 4, height: 76)
            .accessibilityHidden(true)
    }

    private var statusBadge: some View {
        TSStatusBadge(
            title: model.mode.title,
            systemImage: model.mode.systemImage,
            isAttention: model.mode == .needsDecision || model.mode == .failed || model.mode == .outcomeUnknown
        )
    }

    @ViewBuilder
    private var identityTagsBlock: some View {
        if !model.identityTags.isEmpty {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 7) { identityTags }
                VStack(alignment: .leading, spacing: 6) { identityTags }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workspace.identityTags")
        }
    }

    @ViewBuilder
    private var identityTags: some View {
        ForEach(model.identityTags, id: \.self) { tag in
            Text(tag)
                .font(.caption.weight(.medium))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .foregroundStyle(TSBrand.secondaryInk)
                .background(TSBrand.selection, in: Capsule())
        }
    }
}

private struct StateContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            switch model.mode {
            case .empty:
                if model.isSignedOut {
                    CalmStateView(
                        icon: "person.crop.circle.badge.xmark",
                        title: "Signed out and local recovery cleared",
                        body: model.deletionReceipt ?? "The session ended and no prior relationship content remains available in this window."
                    )
                } else {
                    CalmStateView(
                        icon: "viewfinder",
                        title: "Choose the context aperture",
                        body: "Nothing is being monitored. Add selected text or a file below, then review exactly what may leave this Mac."
                    )
                }
            case .ready:
                if model.scopeReviewStatus != .confirmed {
                    CalmStateView(
                        icon: "hand.raised",
                        title: "Context remains local while scope is unresolved",
                        body: "Choose the exact Pursuit, Person, and relationship context above, or preserve an unresolved outcome. Nothing has been submitted."
                    )
                } else if model.capsule.items.isEmpty {
                    CalmStateView(
                        icon: "hand.raised",
                        title: "Connected, with no submitted context",
                        body: "The relationship scope is ready. Add one explicit source below; opening capri did not capture another app."
                    )
                } else {
                    ReadyStateView()
                }
            case .working:
                CalmStateView(
                    icon: "hourglass",
                    title: "Working within the reviewed Capsule",
                    body: "The task cannot gain newly added context. You can pause intake or keep working elsewhere while the canonical status is checked."
                ) {
                    ProgressView().controlSize(.small)
                }
            case .needsDecision:
                if model.pendingDecision != nil {
                    CanonicalDecisionView()
                } else {
                    EvidenceDecisionView()
                }
            case .noAction:
                NoActionResultView()
            case .receipt:
                CanonicalReceiptView()
            case .clarification:
                ClarificationView()
            case .ambiguousIdentity:
                AmbiguousIdentityView()
            case .identityReviewSaved:
                IdentityReviewSavedView()
            case .stale:
                CalmStateView(
                    icon: "clock.arrow.circlepath",
                    title: "The source or Pursuit changed",
                    body: "This proposal no longer has current authority. Review the changed evidence and create a new immutable Task version before deciding."
                )
            case .failed:
                VStack(alignment: .leading, spacing: 12) {
                    CalmStateView(
                        icon: "exclamationmark.triangle",
                        title: "The task failed without changing relationship state",
                        body: model.errorMessage ?? "Keep the Capsule local and inspect the failure. No automatic retry is authorized."
                    )
                    Button("Review local Capsule — no retry", systemImage: "arrow.left") {
                        model.returnToCapsuleAfterFailure()
                    }
                    .accessibilityHint("Returns to local review without creating a Task, decision, or external effect")
                    .accessibilityIdentifier("failure.reviewCapsule")
                }
            case .outcomeUnknown:
                VStack(alignment: .leading, spacing: 12) {
                    CalmStateView(
                        icon: "questionmark.circle",
                        title: "Outcome unknown",
                        body: "Do not retry yet. Reconcile the original operation ID and canonical readback so the same intent cannot create duplicate work."
                    )
                    Button("Reconcile original operation", systemImage: "arrow.triangle.2.circlepath") {
                        Task { await model.reconcileCanonicalDecision() }
                    }
                    .accessibilityIdentifier("canonical.reconcile")
                }
            case .deleted:
                CalmStateView(
                    icon: "trash",
                    title: "Local context deleted",
                    body: model.deletionReceipt ?? "Local Capsule derivatives were cleared. Canonical history, if any, was not silently rewritten."
                )
            }
        }
    }
}

private struct NoActionResultView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var continuingOwnedAction: ActionProjection? {
        model.presentation.actionProjections.first {
            $0.authority.contains("Existing owned action")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 7) {
                SectionLabel(text: "First response")
                Label(
                    continuingOwnedAction == nil
                        ? "No new action is the useful result"
                        : "No duplicate action was created",
                    systemImage: "checkmark.circle"
                )
                .font(.title3.weight(.semibold))
                Text(model.presentation.changedSummary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("noAction.summary")
                Text(model.presentation.dependency)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("noAction.dependency")
            }

            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 12) {
                    evidencePanel
                    continuationPanel
                }
            } else {
                HStack(alignment: .top, spacing: 14) {
                    evidencePanel
                    continuationPanel
                }
            }

            Label(
                "No message, calendar event, or duplicate task was created.",
                systemImage: "hand.raised"
            )
            .font(.callout.weight(.medium))
            .foregroundStyle(TSBrand.secondaryInk)
            .accessibilityIdentifier("noAction.noExternalEffect")
        }
        .accessibilityIdentifier("noAction.result")
    }

    private var evidencePanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Exact reviewed evidence", systemImage: "quote.opening")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.evidence)
            Text(model.presentation.evidenceQuote)
                .font(.system(size: 17, weight: .medium, design: .serif))
                .foregroundStyle(TSBrand.ink)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("noAction.evidence")
            Text(model.presentation.evidenceSource)
                .font(.caption)
                .foregroundStyle(TSBrand.secondaryInk)
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(TSBrand.evidenceTint.opacity(0.35), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(TSBrand.evidence.opacity(0.22))
        }
    }

    @ViewBuilder
    private var continuationPanel: some View {
        if let action = continuingOwnedAction {
            VStack(alignment: .leading, spacing: 8) {
                Label("Continue owned work", systemImage: "arrow.forward.circle")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TSBrand.secondaryInk)
                Text(action.objectName)
                    .font(.headline)
                    .foregroundStyle(TSBrand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("noAction.ownedAction.title")
                Text(action.consequence)
                    .font(.callout)
                Text(action.authority)
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                Text("Next: \(action.nextOperation)")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                Button("Open canonical Task and evidence") {
                    Task { await model.openActionProjection(action) }
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("noAction.ownedAction.open")
            }
            .padding(18)
            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
            .tsSurface(raised: true)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("noAction.ownedAction")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: "Continue")
                Text(model.presentation.proposal)
                    .font(.callout)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(18)
            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
            .tsSurface()
        }
    }
}

private struct ClarificationView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 7) {
                SectionLabel(text: "Exact clarification required")
                Text("Confirm time before any meeting action")
                    .font(.title3.weight(.semibold))
                Text(model.presentation.proposal)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("clarification.question")
                Text(model.presentation.dependency)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("clarification.reason")
            }

            Label("No calendar write or message send occurred.", systemImage: "hand.raised")
                .font(.callout.weight(.medium))
                .foregroundStyle(.secondary)

            Text("Add the exact date, timezone, duration, and meeting consent to a new reviewed Capsule. The current Task has no authority to infer them.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }
}

private struct CanonicalDecisionView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        if let review = model.pendingDecision {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 7) {
                    SectionLabel(text: "Review proposed changes")
                    Text(review.summary)
                        .font(.title3.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(review.dependency)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)

                    DisclosureGroup("Review details") {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.isSyntheticFixture ? "Synthetic fixture — no relationship will be changed" : "Current reviewed proposal")
                            Text("Available until \(review.expiresAt)")
                            Text("Relationship version \(review.baseRevision)")
                        }
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                    }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("canonical.reviewDetails")
                }

                ForEach(review.items) { item in
                    CanonicalProposalItemView(
                        item: item,
                        evidence: review.evidence.filter { item.evidenceRefs.contains($0.id) }
                    )
                }

                HStack(alignment: .center, spacing: 12) {
                    Button("Save reviewed changes", systemImage: "checkmark.seal") {
                        Task { await model.resolveCanonicalDecision() }
                    }
                    .buttonStyle(TSPrimaryButtonStyle())
                    .disabled(!model.canResolveCanonicalDecision)
                    .accessibilityHint("Saves every reviewed relationship change together. It does not send a message or create an external action.")
                    .accessibilityIdentifier("canonical.resolve")

                    Text("No message, calendar event, purchase, deletion, or other external effect is authorized.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

private struct CanonicalProposalItemView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AccessibilityFocusState private var accessibilityFocusedChoice: CanonicalDecisionChoice?
    let item: CanonicalProposalReview.Item
    let evidence: [CanonicalProposalReview.Evidence]

    private var selection: Binding<CanonicalDecisionChoice?> {
        Binding(
            get: { model.decisionSelections[item.id] },
            set: { choice in
                if let choice { model.setDecision(itemID: item.id, choice: choice) }
            }
        )
    }

    private var humanReadableKey: String {
        item.key
            .replacingOccurrences(of: ":", with: " · ")
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    SectionLabel(text: item.changeKind.replacingOccurrences(of: "_", with: " "))
                    Text(humanReadableKey)
                        .font(.headline)
                }
                Spacer()
                Text("Evidence \(item.evidenceAvailability)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TSBrand.evidence)
            }

            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 0) {
                    CanonicalEvidencePane(evidence: evidence)
                        .padding(18)
                    Rectangle()
                        .fill(TSBrand.seam)
                        .frame(height: 3)
                        .accessibilityHidden(true)
                    CanonicalChangePane(item: item, isVertical: true)
                        .padding(18)
                }
                .tsSurface(raised: true)
            } else {
                HStack(alignment: .top, spacing: 0) {
                    CanonicalEvidencePane(evidence: evidence)
                        .padding(20)
                        .frame(minWidth: 300, maxWidth: 410, alignment: .topLeading)
                        .background(TSBrand.evidenceTint.opacity(0.30))

                    ZStack {
                        Rectangle().fill(TSBrand.seam).frame(width: 3)
                        Circle()
                            .fill(TSBrand.seam)
                            .frame(width: 9, height: 9)
                            .overlay(Circle().stroke(TSBrand.raisedSurface, lineWidth: 2))
                    }
                    .frame(width: 17)
                    .frame(maxHeight: .infinity)
                    .accessibilityHidden(true)

                    CanonicalChangePane(item: item, isVertical: false)
                        .padding(20)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
                .tsSurface(raised: true)
            }

            Label("Decision context reviewed in order", systemImage: "ear.badge.checkmark")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.evidence)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(decisionContextAccessibilityLabel)
                .accessibilityHint("The decision control follows this context. No choice is preselected.")
                .accessibilityIdentifier("canonical.decisionContext.\(item.id)")

            VStack(alignment: .leading, spacing: 7) {
                Text("Decision")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 7) {
                        ForEach(CanonicalDecisionChoice.allCases) { choice in
                            decisionChoiceButton(choice)
                        }
                    }
                    VStack(spacing: 7) {
                        ForEach(CanonicalDecisionChoice.allCases) { choice in
                            decisionChoiceButton(choice)
                        }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("canonical.decision.\(item.id)")
            .task {
                guard
                    ProcessInfo.processInfo.arguments.contains("--ui-testing"),
                    ProcessInfo.processInfo.arguments.contains("--voiceover-focus-decision")
                else { return }
                // The runtime probe moves the real VoiceOver cursor onto the
                // same actionable element verified by the keyboard journey.
                // It does not select or submit a choice.
                try? await Task.sleep(for: .milliseconds(800))
                accessibilityFocusedChoice = .accept
            }
        }
        .padding(18)
        .background(TSBrand.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(TSBrand.hairline.opacity(0.7)))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("canonical.item.\(item.id)")
    }

    private var decisionContextAccessibilityLabel: String {
        let review = model.pendingDecision
        let evidence = review?.evidence
            .filter { item.evidenceRefs.contains($0.id) }
            .map { "\($0.attributedActor) \($0.attributionStatus): \($0.text)" }
            .joined(separator: "; ") ?? "Evidence unavailable"
        return [
            "Identity \(accessibleIdentitySummary)",
            "Relationship \(accessibleRelationshipSummary)",
            "Claim \(decisionClaimSummary)",
            "Uncertainty \(item.epistemicStatus); evidence \(item.evidenceAvailability)",
            "Evidence \(evidence)",
            "Consequence \(decisionConsequenceSummary)"
        ].joined(separator: ". ")
    }

    private var accessibleIdentitySummary: String {
        model.presentation.candidateName
            .components(separatedBy: " — ")
            .first ?? model.presentation.candidateName
    }

    private var accessibleRelationshipSummary: String {
        let fullRelationship = model.presentation.relationshipContext
            .components(separatedBy: " · identity")
            .first ?? model.presentation.relationshipContext
        let role = fullRelationship
            .components(separatedBy: " in this Pursuit")
            .first ?? fullRelationship
        let pursuit = model.presentation.pursuitTitle
            .replacingOccurrences(of: " · ", with: " ")
            .replacingOccurrences(of: " platform ", with: " ")
        return "\(role); \(pursuit)"
    }

    private var decisionClaimSummary: String {
        let fields = item.proposedValue.components(separatedBy: " · ")
        if let title = fields.first(where: {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
                .hasPrefix("title:")
        }), let separator = title.firstIndex(of: ":") {
            return String(title[title.index(after: separator)...])
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return humanReadableKey
    }

    private var decisionConsequenceSummary: String {
        item.effectSummary
            .replacingOccurrences(of: "Would add one ", with: "Add ")
            .replacingOccurrences(of: " for human review only", with: "; review only")
    }

    private func decisionChoiceButton(_ choice: CanonicalDecisionChoice) -> some View {
        let isSelected = selection.wrappedValue == choice
        return Button {
            selection.wrappedValue = choice
        } label: {
            HStack(spacing: 7) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.caption)
                Text(choice.title)
                    .frame(maxWidth: .infinity)
            }
            .padding(.vertical, 9)
            .padding(.horizontal, 10)
            .background(
                isSelected ? TSBrand.ink : TSBrand.selection.opacity(0.72),
                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
            )
            .foregroundStyle(isSelected ? TSBrand.raisedSurface : TSBrand.ink)
        }
        .buttonStyle(.plain)
        // The actionable element owns the entire ordered consequence. A
        // segmented Picker can expose this in an AX snapshot while VoiceOver
        // still lands on an anonymous toggle segment at runtime.
        .accessibilityLabel("\(decisionContextAccessibilityLabel). Choice \(choice.title)")
        .accessibilityValue(isSelected ? "Selected" : "Not selected")
        .accessibilityHint("Selects \(choice.title) for \(humanReadableKey). Nothing is saved until Save reviewed changes is activated.")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityFocused($accessibilityFocusedChoice, equals: choice)
        .accessibilityIdentifier("canonical.choice.\(choice.rawValue).\(item.id)")
    }
}

private struct CanonicalEvidencePane: View {
    let evidence: [CanonicalProposalReview.Evidence]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Exact reviewed evidence", systemImage: "quote.opening")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.evidence)

            if evidence.isEmpty {
                Text("Evidence unavailable")
                    .font(.headline)
                Text("This proposal cannot be confirmed until current source authority is restored.")
                    .font(.callout)
                    .foregroundStyle(TSBrand.secondaryInk)
            } else {
                ForEach(evidence) { fragment in
                    VStack(alignment: .leading, spacing: 9) {
                        Text(fragment.text)
                            .font(.system(size: 17, weight: .medium, design: .serif))
                            .foregroundStyle(TSBrand.ink)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("canonical.evidence.\(fragment.id)")
                        Text("\(fragment.source) · \(fragment.observedAt)")
                            .font(.caption)
                            .foregroundStyle(TSBrand.secondaryInk)
                        Label(
                            "\(fragment.attributedActor) · \(fragment.attributionStatus) · \(fragment.reviewStatus)",
                            systemImage: "person.text.rectangle"
                        )
                        .font(.caption)
                        .foregroundStyle(TSBrand.evidence)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

private struct CanonicalChangePane: View {
    let item: CanonicalProposalReview.Item
    let isVertical: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Proposed relationship change", systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.seam)

            if isVertical {
                VStack(alignment: .leading, spacing: 12) {
                    DecisionValueColumn(label: "Before", value: item.beforeValue)
                    Image(systemName: "arrow.down")
                        .foregroundStyle(TSBrand.seam)
                    DecisionValueColumn(label: "Proposed", value: item.proposedValue)
                }
            } else {
                HStack(alignment: .top, spacing: 12) {
                    DecisionValueColumn(label: "Before", value: item.beforeValue)
                        .frame(maxWidth: 150)
                    Image(systemName: "arrow.right")
                        .foregroundStyle(TSBrand.seam)
                        .padding(.top, 22)
                    DecisionValueColumn(label: "Proposed", value: item.proposedValue)
                }
            }

            Divider()
            Text(item.reason)
                .font(.callout)
                .foregroundStyle(TSBrand.ink)
            Text("Effect: \(item.effectSummary)")
                .font(.callout.weight(.semibold))
                .foregroundStyle(TSBrand.ink)
            Text("\(item.epistemicStatus.capitalized) · \(item.evidenceRefs.count) evidence reference(s)")
                .font(.caption)
                .foregroundStyle(TSBrand.secondaryInk)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

private struct DecisionValueColumn: View {
    let label: String
    let value: String

    private var lines: [String] {
        value.components(separatedBy: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            SectionLabel(text: label)
            ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    if lines.count > 1 {
                        Circle()
                            .fill(TSBrand.evidence.opacity(0.72))
                            .frame(width: 4, height: 4)
                    }
                    Text(line)
                        .font(.body.weight(index == 0 ? .semibold : .regular))
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

private struct IdentityReviewSavedView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        if let receipt = model.identityReviewReceipt {
            VStack(alignment: .leading, spacing: 10) {
                Label("Identity remains unresolved", systemImage: "person.crop.circle.badge.checkmark")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(TSBrand.evidence)
                    .accessibilityIdentifier("identity.unresolvedReceipt")
                Text(receipt.summary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Review receipt \(receipt.id)\(receipt.taskID.map { " · canonical task \($0)" } ?? "")")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                Text("This receipt records a non-binding review outcome. It is not a Person match, fact confirmation, or action approval.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(18)
            .background(TSBrand.surface, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(TSBrand.evidence.opacity(0.36)))
        } else {
            CalmStateView(
                icon: "exclamationmark.triangle",
                title: "Identity review receipt unavailable",
                body: "No person has been bound. Return to the unresolved review before continuing."
            )
        }
    }
}

private struct CanonicalReceiptView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if let receipt = model.canonicalReceipt {
            VStack(alignment: .leading, spacing: 16) {
                Label("Relationship updated after your review", systemImage: "checkmark.seal.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(TSBrand.evidence)
                    .accessibilityIdentifier("canonical.receipt")
                Text(receipt.changedFields.isEmpty
                     ? "Your review was saved without changing the relationship."
                     : "Your reviewed changes are now part of this relationship.")
                    .font(.body.weight(.medium))
                    .fixedSize(horizontal: false, vertical: true)
                Label("Nothing was sent or scheduled.", systemImage: "hand.raised")
                    .font(.callout)
                    .foregroundStyle(TSBrand.secondaryInk)

                DisclosureGroup("Details") {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(receipt.summary)
                            .font(.callout)
                            .fixedSize(horizontal: false, vertical: true)

                        if dynamicTypeSize.isAccessibilitySize {
                            VStack(alignment: .leading, spacing: 12) {
                                ReceiptDatum(label: "Outcome", value: receipt.outcome.replacingOccurrences(of: "_", with: " "))
                                ReceiptDatum(label: "Relationship version", value: "\(receipt.beforeRevision) → \(receipt.afterRevision)")
                                ReceiptDatum(label: "External effects", value: "\(receipt.externalEffects.count)")
                            }
                        } else {
                            HStack(spacing: 24) {
                                ReceiptDatum(label: "Outcome", value: receipt.outcome.replacingOccurrences(of: "_", with: " "))
                                ReceiptDatum(label: "Relationship version", value: "\(receipt.beforeRevision) → \(receipt.afterRevision)")
                                ReceiptDatum(label: "External effects", value: "\(receipt.externalEffects.count)")
                            }
                        }

                        if !receipt.changedFields.isEmpty {
                            Text("Changed fields: \(receipt.changedFields.joined(separator: ", "))")
                                .font(.callout)
                        }
                        Text("Receipt \(receipt.id) · operation \(receipt.operationID) · \(receipt.occurredAt)")
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    .padding(.top, 4)
                }
                .accessibilityIdentifier("canonical.receiptDetails")

                Divider()
                LocalDraftHandoffView()
            }
            .padding(18)
            .background(TSBrand.surface, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(TSBrand.evidence.opacity(0.36)))
        } else {
            CalmStateView(
                icon: "exclamationmark.triangle",
                title: "Receipt unavailable",
                body: "The interface will not claim success until the canonical receipt can be read back."
            )
        }
    }
}

private struct ReceiptDatum: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: label)
            Text(value).font(.headline.monospacedDigit())
        }
    }
}

private struct CalmStateView<Accessory: View>: View {
    let icon: String
    let title: String
    let bodyText: String
    @ViewBuilder let accessory: Accessory

    init(icon: String, title: String, body: String, @ViewBuilder accessory: () -> Accessory) {
        self.icon = icon
        self.title = title
        self.bodyText = body
        self.accessory = accessory()
    }

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(TSBrand.evidence)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 7) {
                Text(title).font(.title3.weight(.semibold))
                Text(bodyText)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                accessory
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private extension CalmStateView where Accessory == EmptyView {
    init(icon: String, title: String, body: String) {
        self.init(icon: icon, title: title, body: body) { EmptyView() }
    }
}

private struct ReadyStateView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Capsule ready for your review", systemImage: "checkmark.circle")
                .font(.title3.weight(.semibold))
            Text("\(model.capsule.sharedItems.count) item(s) may enter this bounded Task. Local-only items remain on this Mac and are excluded from the immutable manifest.")
                .foregroundStyle(.secondary)
            Button("Review with capri", systemImage: "arrow.right") {
                Task { await model.submitCapsule() }
            }
            .buttonStyle(TSPrimaryButtonStyle())
            .disabled(!model.canSubmitCapsule)
            .keyboardShortcut(.return, modifiers: [.command, .shift])
            .accessibilityIdentifier("capsule.submit")
        }
    }
}

struct RelationshipScopeReviewView: View {
    @EnvironmentObject private var model: AppModel
    let compact: Bool

    init(compact: Bool = false) {
        self.compact = compact
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    SectionLabel(text: compact ? "Who is this about?" : "Review relationship scope")
                    Text(model.selectedScopeOptionID == nil
                        ? (compact ? "Choose the exact relationship" : "No identity is selected yet")
                        : (compact ? "Ready for your confirmation" : "Selected for explicit confirmation"))
                        .font(.headline)
                }
                Spacer()
                Label(compact ? "Not confirmed" : "Proposed", systemImage: "circle")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 8) {
                ForEach(model.relationshipScopeOptions) { option in
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            model.selectRelationshipScopeOption(id: option.id)
                        } label: {
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: model.selectedScopeOptionID == option.id ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(model.selectedScopeOptionID == option.id ? TSBrand.evidence : .secondary)
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 7) {
                                        Text(option.pursuitTitle)
                                            .font(.subheadline.weight(.semibold))
                                        if model.suggestedRelationshipScopeOption?.id == option.id {
                                            Text("Possible match")
                                                .font(.caption2.weight(.semibold))
                                                .foregroundStyle(TSBrand.evidence)
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 2)
                                                .background(TSBrand.evidenceTint, in: Capsule())
                                        }
                                    }
                                    Text(option.personDisplayLabel)
                                    Text(option.relationshipContextLabel)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                            .padding(11)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(option.pursuitTitle), \(option.personDisplayLabel), \(option.relationshipContextLabel). \(model.selectedScopeOptionID == option.id ? "Selected for confirmation" : "Not selected")")
                        .accessibilityIdentifier("scope.option.\(option.id)")

                        if !compact,
                           model.selectedScopeOptionID == option.id,
                           let preflight = option.consequencePreflight {
                            consequencePreflight(preflight)
                                .padding(.horizontal, 11)
                                .padding(.bottom, 11)
                        }
                    }
                    .background(Color.secondary.opacity(0.055), in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(
                        model.selectedScopeOptionID == option.id ? TSBrand.evidence.opacity(0.55) : Color.secondary.opacity(0.15)
                    ))
                }
            }

            Text("Confirm only if this exact Pursuit, Person, and relationship context own the selected source. Keeping it unresolved creates no binding, fact, or action authority.")
                .font(compact ? .caption : .callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                Button("Keep identity unresolved") {
                    model.keepRelationshipScopeUnresolved()
                }
                .accessibilityIdentifier("scope.keepUnresolved")
                Spacer()
                Button(compact ? "Confirm relationship" : "Confirm this exact scope", systemImage: "checkmark") {
                    Task { await model.confirmRelationshipScope() }
                }
                .buttonStyle(TSPrimaryButtonStyle())
                .disabled(model.selectedScopeOptionID == nil)
                .accessibilityIdentifier("scope.confirm")
            }
        }
        .padding(compact ? 13 : 16)
        .background(TSBrand.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.secondary.opacity(0.22)))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("scope.review")
    }

    private func consequencePreflight(_ preflight: RelationshipConsequencePreflight) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Label("Read-only canonical context · selection is not confirmation", systemImage: "lock.open.display")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.secondaryInk)
            Text("Milestone · \(preflight.milestone)")
                .font(.caption)
            Text("Target · \(preflight.targetDate) · Evidence \(preflight.evidenceAvailability)")
                .font(.caption)
                .foregroundStyle(TSBrand.secondaryInk)

            if preflight.openActions.isEmpty {
                Text("No open user-owned action in the current Pursuit readback.")
                    .font(.caption)
                    .foregroundStyle(TSBrand.evidence)
            } else {
                Text("Open user-owned actions")
                    .font(.caption.weight(.semibold))
                ForEach(preflight.openActions) { action in
                    Text("• \(action.title) · \(action.owner)\(action.dueAt.map { " · \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "")")
                        .font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if !preflight.openGaps.isEmpty {
                Text("Open gaps")
                    .font(.caption.weight(.semibold))
                ForEach(preflight.openGaps) { gap in
                    Text("• \(gap.title) — \(gap.closeCondition) · Evidence \(gap.evidenceAvailability)")
                        .font(.caption)
                        .foregroundStyle(TSBrand.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(10)
        .background(TSBrand.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .accessibilityIdentifier("scope.consequencePreflight")
    }
}

private struct EvidenceDecisionView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: "What changed")
                Text(model.presentation.changedSummary)
                    .font(.title3.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(model.presentation.dependency)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 7) {
                    SectionLabel(text: "Exact evidence")
                    Text(model.presentation.evidenceQuote)
                        .font(.body)
                        .textSelection(.enabled)
                    Text(model.presentation.evidenceSource)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                Rectangle()
                    .fill(TSBrand.seam)
                    .frame(width: 3)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 7) {
                    SectionLabel(text: "Proposed relationship change")
                    Text("Decision deadline: previously unknown → Wednesday")
                        .font(.body.weight(.medium))
                    Text("Proposed is not confirmed state.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .background(TSBrand.surface, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.secondary.opacity(0.18)))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("decision.evidenceChange")

            DecisionLayer(
                eyebrow: "Decision 1 · fact review",
                title: model.factReviewStatus == .proposed ? "Should this become confirmed relationship state?" : "Fact review: \(model.factReviewStatus.rawValue)",
                detail: "This decision changes only the governed fact. It grants no permission to prepare, copy, or send a message."
            ) {
                Button("Confirm fact") { model.confirmFactProposal() }
                    .disabled(model.factReviewStatus != .proposed)
                    .accessibilityIdentifier("decision.confirmFact")
                Button("Dismiss") { model.dismissFactProposal() }
                    .disabled(model.factReviewStatus != .proposed)
                    .accessibilityIdentifier("decision.dismissFact")
            }

            LocalDraftHandoffView()
        }
    }
}

private struct LocalDraftHandoffView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        DecisionLayer(
            eyebrow: "Separate local handoff",
            title: model.localDraftStatus == .awaitingDecision
                ? "Prepare a response draft on this Mac?"
                : "Local draft \(model.localDraftStatus.rawValue)",
            detail: "Prepared and copied are local receipts. Neither means sent, scheduled, delivered, or approved for delivery."
        ) {
            Button(model.localDraftStatus == .awaitingDecision ? "Prepare local draft" : "Draft \(model.localDraftStatus.rawValue)") {
                model.prepareLocalDraft()
            }
            .disabled(model.localDraftStatus != .awaitingDecision)
            .accessibilityHint("Creates editable text only on this Mac and performs no external effect")
            .accessibilityIdentifier("decision.prepareDraft")
            Button("Copy prepared draft") { model.copyPreparedDraft() }
                .disabled(model.localDraftStatus == .awaitingDecision)
                .accessibilityHint("Copies the prepared text to the clipboard; it does not send the message")
                .accessibilityIdentifier("decision.copyDraft")
        }
    }
}

private struct DecisionLayer<Actions: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let eyebrow: String
    let title: String
    let detail: String
    @ViewBuilder let actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: eyebrow)
            Text(title).font(.headline).fixedSize(horizontal: false, vertical: true)
            Text(detail)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) { actions }
            } else {
                HStack { actions }
            }
        }
        .padding(16)
        .background(Color.secondary.opacity(0.055), in: RoundedRectangle(cornerRadius: 9))
    }
}

private struct AmbiguousIdentityView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Identity must be resolved before evidence can bind", systemImage: "person.2.badge.questionmark")
                .font(.title3.weight(.semibold))
            Text("Two temporal owners share a clue. Neither is selected, and no fact or action can be confirmed from this state.")
                .foregroundStyle(.secondary)

            VStack(spacing: 0) {
                IdentityOption(label: "Current clue", name: "Alexandra 陈嘉宁-Sørensen", detail: "Current source-linked email · relationship controls available after explicit selection")
                Divider()
                IdentityOption(label: "Historical clue", name: "Alex Chen — archived consulting context", detail: "Expired clue · visible for comparison, attachment disabled")
            }
            .background(TSBrand.surface, in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.secondary.opacity(0.18)))

            Button("Save for identity review") {
                model.saveIdentityForReview()
            }
                .accessibilityIdentifier("identity.saveUnresolved")
            Text("Create new person is unavailable while this current-owner conflict exists.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct IdentityOption: View {
    let label: String
    let name: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "circle")
                .foregroundStyle(.secondary)
                .accessibilityLabel("Not selected")
            VStack(alignment: .leading, spacing: 4) {
                SectionLabel(text: label)
                Text(name).font(.headline).fixedSize(horizontal: false, vertical: true)
                Text(detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
