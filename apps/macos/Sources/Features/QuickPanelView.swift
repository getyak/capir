import SwiftUI
import UniformTypeIdentifiers

struct QuickPanelView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismissWindow) private var dismissWindow
    @State private var reviewIntent: ConsequenceIntent?

    var body: some View {
        VStack(spacing: 0) {
            if model.isSyntheticFixture { SyntheticFixtureBanner() }

            ScrollView {
                VStack(
                    alignment: .leading,
                    spacing: model.provisionalInsight == nil ? 20 : 14
                ) {
                    header
                    QuickConversationIntake()

                    if let insight = model.provisionalInsight {
                        if let reviewIntent {
                            QuickConsequenceReview(intent: reviewIntent, insight: insight) {
                                model.recordConsequenceReviewAbandoned()
                                self.reviewIntent = nil
                            }
                        } else if model.localDraftStatus != .awaitingDecision {
                            QuickDraftContext(insight: insight)
                            QuickDraftEditor()

                            if model.shouldShowCompanionTrialFeedback {
                                QuickTrialFeedback()
                            }
                        } else {
                            QuickInsightCard(insight: insight) { intent in
                                if intent == .prepareDraft {
                                    model.prepareLocalDraft()
                                } else if intent == .prepareClientQuestion {
                                    model.prepareClientQuestion()
                                } else {
                                    model.recordConsequenceReviewStarted()
                                    if intent == .reminder {
                                        model.beginReminderPreparation()
                                    }
                                    withAnimation(.easeOut(duration: model.isReducedMotionPreview ? 0 : 0.18)) {
                                        reviewIntent = intent
                                    }
                                }
                            }

                            if model.shouldShowCompanionTrialFeedback {
                                QuickTrialFeedback()
                            }
                        }
                    } else {
                        QuickEmptyState()
                    }

                    if let errorMessage = model.errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .font(.callout)
                            .foregroundStyle(TSBrand.seam)
                            .accessibilityIdentifier("quick.error")
                    }

                    if let recovery = model.localRecoveryNotice {
                        Label(recovery, systemImage: "arrow.counterclockwise.circle")
                            .font(.caption)
                            .foregroundStyle(TSBrand.evidence)
                            .accessibilityIdentifier("quick.localRecoveryNotice")
                    }

                    if let recovery = model.reminderRecoveryNotice, reviewIntent == nil {
                        Label(recovery, systemImage: "arrow.triangle.2.circlepath.circle")
                            .font(.caption)
                            .foregroundStyle(TSBrand.evidence)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("quick.reminderRecoveryNotice")
                    }

                    if let receipt = model.intakeControlReceipt {
                        Label(receipt, systemImage: "checkmark.circle")
                            .font(.caption)
                            .foregroundStyle(TSBrand.secondaryInk)
                            .accessibilityIdentifier("quick.localControlReceipt")
                    }

                    footer
                }
                .padding(model.provisionalInsight == nil ? 24 : 18)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
        }
        .background(TSBrand.canvas)
        .accessibilityIdentifier("quick.panel")
        .onAppear { restoreRelevantIntent() }
        .onChange(of: model.quickPanelNavigationRequest) { _, request in
            if request != nil { restoreRelevantIntent() }
        }
        .onChange(of: model.mode) { _, _ in restoreRelevantIntent() }
        .onChange(of: model.reminderOperationState) { _, _ in restoreRelevantIntent() }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            TSBrandMark(size: model.provisionalInsight == nil ? 32 : 24)
            if model.provisionalInsight == nil {
                VStack(alignment: .leading, spacing: 5) {
                    SectionLabel(text: "Candidate follow-up companion")
                    Text("What changed—and what should happen next?")
                        .font(.system(size: 25, weight: .semibold))
                        .foregroundStyle(TSBrand.ink)
                    Text("Use one conversation you deliberately select. The first review stays on this Mac.")
                        .font(.callout)
                        .foregroundStyle(TSBrand.secondaryInk)
                }
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    SectionLabel(text: "Candidate follow-up companion")
                    Text("One conversation · one next step")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(TSBrand.ink)
                }
            }
            Spacer(minLength: 12)
            Button("Close", systemImage: "xmark") {
                dismissWindow(id: "quick-panel")
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
        }
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Image(systemName: "hand.raised")
            Text("No ambient monitoring · no clipboard polling · no message is sent from this panel")
        }
        .font(.caption)
        .foregroundStyle(TSBrand.secondaryInk)
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.top, 2)
    }

    private func restoreRelevantIntent() {
        if let request = model.quickPanelNavigationRequest {
            switch request.destination {
            case .insight:
                reviewIntent = nil
            case .reminder:
                reviewIntent = .reminder
            }
            model.consumeQuickPanelNavigationRequest(id: request.id)
            return
        }
        if model.localDraftStatus != .awaitingDecision {
            reviewIntent = nil
            return
        }
        if model.reminderNeedsActionCenter {
            reviewIntent = .reminder
            return
        }
        if model.pendingDecision != nil ||
            model.canonicalReceipt != nil ||
            [.noAction, .outcomeUnknown, .stale].contains(model.mode) ||
            (model.lastSubmittedManifest != nil && [.working, .failed].contains(model.mode)) {
            reviewIntent = .save
        }
    }
}

private struct QuickTrialFeedback: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Brief trial check")
            Text("Did “What changed” make sense?")
                .font(.headline)

            HStack(spacing: 8) {
                understandingButton("Yes", judgment: .yes)
                understandingButton("No", judgment: .no)
                understandingButton("Not sure", judgment: .unsure)
            }

            Text("Would you choose this companion again for a real follow-up?")
                .font(.headline)

            HStack(spacing: 8) {
                reuseButton("Yes", intent: .yes)
                reuseButton("No", intent: .no)
                reuseButton("Not sure", intent: .unsure)
            }

            DisclosureGroup("Privacy-safe session measures") {
                VStack(alignment: .leading, spacing: 9) {
                    Text("Only elapsed times, review answers, action adoption/editing, and completed action types are included. Conversation text, names, relationship IDs, drafts, and reminder IDs are excluded.")
                        .font(.caption)
                        .foregroundStyle(TSBrand.secondaryInk)
                    Button("Copy session measures", systemImage: "doc.on.doc") {
                        model.copyCompanionTrialExport()
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("quick.copyTrialMeasures")
                    if let receipt = model.companionTrialExportReceipt {
                        Label(receipt, systemImage: "checkmark.circle")
                            .font(.caption)
                            .foregroundStyle(TSBrand.evidence)
                    }
                }
                .padding(.top, 8)
            }
            .font(.callout.weight(.semibold))
        }
        .padding(16)
        .tsSurface(raised: true)
        .accessibilityIdentifier("quick.trialFeedback")
    }

    private func understandingButton(
        _ title: String,
        judgment: ChangeUnderstandingJudgment
    ) -> some View {
        Button(title) { model.recordChangeUnderstanding(judgment) }
            .buttonStyle(.bordered)
            .tint(model.companionTrialMetrics.changeUnderstanding == judgment ? TSBrand.evidence : nil)
            .accessibilityAddTraits(model.companionTrialMetrics.changeUnderstanding == judgment ? .isSelected : [])
            .accessibilityLabel("What changed made sense: \(title)")
            .accessibilityIdentifier("quick.changeUnderstanding.\(judgment.rawValue)")
    }

    private func reuseButton(_ title: String, intent: CompanionReuseIntent) -> some View {
        Button(title) { model.recordReuseIntent(intent) }
            .buttonStyle(.bordered)
            .tint(model.companionTrialMetrics.reuseIntent == intent ? TSBrand.evidence : nil)
            .accessibilityAddTraits(model.companionTrialMetrics.reuseIntent == intent ? .isSelected : [])
            .accessibilityLabel("Would use again: \(title)")
    }
}

private enum ConsequenceIntent: Equatable {
    case prepareDraft
    case prepareClientQuestion
    case reminder
    case save
}

private struct QuickConversationIntake: View {
    @EnvironmentObject private var model: AppModel
    @State private var selectedText = ""
    @State private var isPickingFile = false
    @State private var isExpanded = true
    @FocusState private var isFocused: Bool

    var body: some View {
        Group {
            if shouldShowExpanded {
                expandedIntake
            } else {
                compactIntake
            }
        }
        .animation(.easeOut(duration: model.isReducedMotionPreview ? 0 : 0.16), value: shouldShowExpanded)
        .fileImporter(
            isPresented: $isPickingFile,
            allowedContentTypes: [.plainText, .pdf, .image],
            allowsMultipleSelection: true
        ) { result in
            if case .success(let urls) = result {
                Task { await model.addFiles(urls) }
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard !urls.isEmpty else { return false }
            Task { await model.addFiles(urls) }
            return true
        }
        .onAppear {
            isExpanded = model.provisionalInsight == nil
            isFocused = model.provisionalInsight == nil
        }
        .onChange(of: model.provisionalInsight?.sourceItemID) { _, sourceItemID in
            if sourceItemID == nil {
                isExpanded = true
                isFocused = true
            } else if selectedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      !model.isImportingFiles,
                      !model.isSelectingWindow {
                isExpanded = false
                isFocused = false
            }
        }
    }

    private var expandedIntake: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    SectionLabel(text: model.provisionalInsight == nil ? "Selected conversation" : "Review another selection")
                    Text(model.provisionalInsight == nil ? "Paste the part that may change the follow-up." : "The newest selection drives the preview; earlier sources remain in details until you remove them.")
                        .font(.callout)
                        .foregroundStyle(TSBrand.secondaryInk)
                }
                Spacer()
                Label("Local preview", systemImage: "lock")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TSBrand.evidence)
            }

            TextEditor(text: $selectedText)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(9)
                .frame(minHeight: 82, maxHeight: 124)
                .background(TSBrand.raisedSurface, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(TSBrand.hairline))
                .focused($isFocused)
                .accessibilityLabel("Selected candidate conversation")
                .accessibilityHint("Paste only text you deliberately chose. capri does not read the clipboard automatically.")
                .accessibilityIdentifier("quick.selectedText")

            HStack {
                Button(model.provisionalInsight == nil ? "Show what changed" : "Review newest selection", systemImage: "sparkles") {
                    let previousSourceID = model.provisionalInsight?.sourceItemID
                    model.addSelectedText(selectedText)
                    if model.errorMessage == nil,
                       model.provisionalInsight?.sourceItemID != previousSourceID {
                        selectedText = ""
                        isExpanded = false
                        isFocused = false
                    }
                }
                .buttonStyle(TSPrimaryButtonStyle())
                .keyboardShortcut(.return, modifiers: [.command])
                .disabled(
                    selectedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                        model.isPaused || model.isImportingFiles || model.isSelectingWindow
                )
                .accessibilityIdentifier("quick.analyze")

                Spacer()
                Text("⌘↩")
                    .font(.caption.monospaced())
                    .foregroundStyle(TSBrand.secondaryInk)
            }

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 14) { explicitSourceButtons }
                VStack(alignment: .leading, spacing: 8) { explicitSourceButtons }
            }

            if model.isImportingFiles {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Reading the chosen file locally…")
                        .font(.caption)
                        .foregroundStyle(TSBrand.secondaryInk)
                }
                .accessibilityIdentifier("quick.fileImportProgress")
            }

            if let receipt = model.fileIngestReceipt {
                Label(receipt, systemImage: "doc.text.magnifyingglass")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("quick.fileIngestReceipt")
            }

            if let receipt = model.windowCaptureReceipt {
                Label(receipt, systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("quick.windowCaptureReceipt")
            }
        }
        .padding(16)
        .tsSurface(raised: true)
    }

    private var compactIntake: some View {
        HStack(spacing: 11) {
            Image(systemName: currentSourceIcon)
                .font(.callout.weight(.semibold))
                .foregroundStyle(TSBrand.evidence)
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 2) {
                SectionLabel(text: "Included source")
                Text(currentSourceTitle)
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(TSBrand.ink)
                    .lineLimit(1)
                    .accessibilityIdentifier("quick.intakeSummary")
                Text("Reviewed locally · exact evidence is shown below")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Button("Review another…", systemImage: "plus") {
                isExpanded = true
                Task { @MainActor in isFocused = true }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .accessibilityIdentifier("quick.reviewAnother")
        }
        .padding(.vertical, 3)
    }

    private var shouldShowExpanded: Bool {
        model.provisionalInsight == nil || isExpanded || model.isImportingFiles || model.isSelectingWindow
    }

    private var currentSource: ContextCapsuleItem? {
        guard let sourceItemID = model.provisionalInsight?.sourceItemID else { return nil }
        return model.capsule.items.first(where: { $0.id == sourceItemID })
    }

    private var currentSourceTitle: String {
        guard let source = currentSource else { return "Reviewed selection" }
        return switch source.kind {
        case .selectedText: "Selected conversation"
        case .file: source.displayName
        case .window: "Chosen window"
        }
    }

    private var currentSourceIcon: String {
        guard let source = currentSource else { return "text.quote" }
        return switch source.kind {
        case .selectedText: "text.quote"
        case .file: "doc.text"
        case .window: "macwindow"
        }
    }

    @ViewBuilder
    private var explicitSourceButtons: some View {
        Button(
            model.isImportingFiles ? "Reading locally…" : "Choose screenshot or document…",
            systemImage: "doc.viewfinder"
        ) {
            isPickingFile = true
        }
        .buttonStyle(.borderless)
        .disabled(model.isPaused || model.isImportingFiles || model.isSelectingWindow)
        .accessibilityHint("Reads only the chosen image, PDF, or text document on this Mac; nothing is uploaded")
        .accessibilityIdentifier("quick.addFile")

        Button(
            model.isSelectingWindow ? "Cancel window choice" : "Choose one window…",
            systemImage: model.isSelectingWindow ? "xmark.circle" : "macwindow.badge.plus"
        ) {
            if model.isSelectingWindow {
                model.cancelSystemSelectedWindow()
            } else {
                Task { await model.addSystemSelectedWindow() }
            }
        }
        .buttonStyle(.borderless)
        .disabled(model.isPaused || model.isImportingFiles)
        .accessibilityHint(model.isSelectingWindow
            ? "Cancels the macOS picker without capturing or retaining a window"
            : "Uses the macOS picker for one still frame; no cursor, audio, or background capture")
        .accessibilityIdentifier("quick.addWindow")
    }
}

private struct QuickEmptyState: View {
    @State private var settingsOpenFailed = false

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "text.quote")
                .font(.title2)
                .foregroundStyle(TSBrand.evidence)
            Text("One deliberate selection is enough")
                .font(.headline)
            Text("You’ll see what changed, the exact evidence, what is still unresolved, and the smallest safe next step—before choosing a person or pursuit.")
                .font(.callout)
                .foregroundStyle(TSBrand.secondaryInk)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)

            Divider()
                .padding(.horizontal, 8)

            HStack(alignment: .top, spacing: 11) {
                Image(systemName: "keyboard.badge.ellipsis")
                    .font(.title3)
                    .foregroundStyle(TSBrand.seam)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Select anywhere, review here")
                        .font(.callout.weight(.semibold))
                    Text("Once in macOS Services › Text, enable “\(SelectionServiceSetup.menuItemTitle)” and assign your preferred shortcut.")
                        .font(.caption)
                        .foregroundStyle(TSBrand.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("capri can open the setting, but cannot enable it for you.")
                        .font(.caption2)
                        .foregroundStyle(TSBrand.secondaryInk)
                }

                Spacer(minLength: 8)

                Button("Set up…") {
                    settingsOpenFailed = !SelectionServiceSetup.openKeyboardShortcutSettings()
                }
                .buttonStyle(.bordered)
                .accessibilityHint("Opens macOS Keyboard Shortcuts. Choose Services, then Text, without changing any setting automatically.")
                .accessibilityIdentifier("quick.openSelectionServiceSettings")
            }

            if settingsOpenFailed {
                Label("Keyboard settings did not open. Open System Settings › Keyboard › Keyboard Shortcuts › Services › Text.", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(TSBrand.seam)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 190)
        .padding()
        .background(TSBrand.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(TSBrand.hairline, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        }
        .accessibilityIdentifier("capsule.empty")
    }
}

private struct QuickInsightCard: View {
    @EnvironmentObject private var model: AppModel
    @State private var isReviewExpanded = false
    let insight: ProvisionalFollowUpInsight
    let onIntent: (ConsequenceIntent) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    SectionLabel(text: "What changed")
                    Text(insight.change)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(TSBrand.ink)
                }
                Spacer()
                TSStatusBadge(title: statusTitle, systemImage: statusIcon, isAttention: insight.status == .needsReview)
            }

            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    SectionLabel(text: "Exact evidence")
                    Spacer()
                    Text(insight.modalityTitle)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(TSBrand.evidence)
                }
                Text("“\(insight.exactEvidence)”")
                    .font(.body)
                    .textSelection(.enabled)
                    .foregroundStyle(TSBrand.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(13)
            .background(TSBrand.evidenceTint.opacity(0.65), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(TSBrand.evidence.opacity(0.22)))
            .accessibilityIdentifier("quick.evidence")

            VStack(alignment: .leading, spacing: 7) {
                SectionLabel(text: "Still unresolved")
                Label(insight.primaryUnresolved, systemImage: "circle.dashed")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(TSBrand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("quick.primaryUnresolved")
            }

            if let nextStep = insight.smallestNextStep {
                VStack(alignment: .leading, spacing: 5) {
                    SectionLabel(text: "Smallest next step")
                    Text(nextStep)
                        .font(.headline)
                        .foregroundStyle(TSBrand.ink)
                        .accessibilityIdentifier("quick.nextStep")
                }

                Divider()

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { actionButtons }
                    VStack(alignment: .leading, spacing: 9) { actionButtons }
                }
            } else {
                Label("No new action proposed", systemImage: "checkmark.circle")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(TSBrand.evidence)
            }

            DisclosureGroup(isExpanded: $isReviewExpanded) {
                VStack(alignment: .leading, spacing: 14) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 10) {
                            differenceBefore
                            differenceArrow("arrow.right", topPadding: 29)
                            differenceProposed
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            differenceBefore
                            differenceArrow("arrow.down", topPadding: 0)
                            differenceProposed
                        }
                    }

                    if !secondaryReviewChecks.isEmpty || model.scopeReviewStatus != .confirmed {
                        VStack(alignment: .leading, spacing: 7) {
                            SectionLabel(text: "Review checks")
                            ForEach(secondaryReviewChecks, id: \.self) { item in
                                Label(item, systemImage: "circle.dashed")
                                    .font(.callout)
                                    .foregroundStyle(TSBrand.secondaryInk)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if model.scopeReviewStatus != .confirmed {
                                Label(scopeHistoryCheck, systemImage: "clock.badge.questionmark")
                                    .font(.callout)
                                    .foregroundStyle(TSBrand.secondaryInk)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if let suggestion = model.suggestedRelationshipScopeOption {
                                Label(scopeSuggestionText(suggestion), systemImage: "person.crop.circle.badge.questionmark")
                                    .font(.callout.weight(.semibold))
                                    .foregroundStyle(TSBrand.evidence)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .accessibilityIdentifier("quick.scopeSuggestion")
                            }
                        }
                    }

                    Divider()
                    VStack(alignment: .leading, spacing: 7) {
                        Text("Does the exact evidence support this preview?")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(TSBrand.secondaryInk)
                        HStack(spacing: 8) {
                            evidenceReviewButton("Yes", judgment: .supported)
                            evidenceReviewButton("No", judgment: .unsupported)
                            evidenceReviewButton("Not sure", judgment: .unsure)
                        }
                    }
                }
                .padding(.top, 12)
            } label: {
                Label("Review interpretation", systemImage: "list.bullet.clipboard")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(TSBrand.secondaryInk)
            }
        }
        .padding(16)
        .tsSurface(raised: true)
        .overlay(alignment: .leading) {
            Capsule()
                .fill(insight.status == .noSignal ? TSBrand.evidence : TSBrand.seam)
                .frame(width: 3)
                .padding(.vertical, 16)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("quick.insight")
        .onChange(of: insight.sourceItemID) { _, _ in
            isReviewExpanded = false
        }
    }

    private var statusTitle: String {
        switch insight.status {
        case .ready: "Ready to review"
        case .needsReview: "Needs clarification"
        case .noSignal: "No action"
        }
    }

    private var statusIcon: String {
        switch insight.status {
        case .ready: "eye"
        case .needsReview: "questionmark.circle"
        case .noSignal: "checkmark.circle"
        }
    }

    private var primaryIntent: ConsequenceIntent {
        insight.suggestedAction == .createReminder ? .reminder : .prepareDraft
    }

    private var primaryActionTitle: String {
        switch insight.suggestedAction {
        case .prepareClientQuestion: "Prepare client question"
        case .prepareCandidateFollowUp: "Prepare follow-up"
        case .createReminder: "Create reminder"
        case nil: "Prepare draft"
        }
    }

    private var compactPrimaryActionTitle: String {
        switch insight.suggestedAction {
        case .prepareClientQuestion: "Client question"
        case .prepareCandidateFollowUp: "Follow-up"
        case .createReminder: "Reminder"
        case nil: "Draft"
        }
    }

    private var primaryActionIcon: String {
        primaryIntent == .reminder ? "calendar.badge.plus" : "square.and.pencil"
    }

    private var secondaryReviewChecks: [String] {
        var seen = Set<String>()
        return insight.unresolved.filter { item in
            item != insight.primaryUnresolved && seen.insert(item).inserted
        }
    }

    private var scopeHistoryCheck: String {
        insight.language == .chinese
            ? "尚未检查已有的关系历史和重复行动。"
            : "Existing relationship history and duplicate actions have not been checked yet."
    }

    private func scopeSuggestionText(_ suggestion: RelationshipScopeOption) -> String {
        insight.language == .chinese
            ? "可能匹配：\(suggestion.personDisplayLabel) · \(suggestion.pursuitTitle)。仅在保存或创建提醒时审核。"
            : "Possible match: \(suggestion.personDisplayLabel) · \(suggestion.pursuitTitle). Review it only when you save or create a reminder."
    }

    private func evidenceReviewButton(
        _ title: String,
        judgment: EvidenceSupportJudgment
    ) -> some View {
        Button(title) {
            model.recordEvidenceSupport(judgment)
        }
        .buttonStyle(.bordered)
        .tint(model.companionTrialMetrics.evidenceSupport == judgment ? TSBrand.evidence : nil)
        .accessibilityAddTraits(model.companionTrialMetrics.evidenceSupport == judgment ? .isSelected : [])
        .accessibilityIdentifier("quick.evidenceSupport.\(judgment.rawValue)")
    }

    private var differenceBefore: some View {
        StateDifferenceColumn(label: "Before", text: insight.before, proposed: false)
    }

    private var differenceProposed: some View {
        StateDifferenceColumn(label: "Proposed · not saved", text: insight.proposed, proposed: true)
    }

    private func differenceArrow(_ name: String, topPadding: CGFloat) -> some View {
        Image(systemName: name)
            .font(.caption.weight(.bold))
            .foregroundStyle(TSBrand.seam)
            .padding(.top, topPadding)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var actionButtons: some View {
        Button(compactPrimaryActionTitle, systemImage: primaryActionIcon) {
            onIntent(primaryIntent)
        }
        .buttonStyle(TSPrimaryButtonStyle())
        .accessibilityLabel(primaryActionTitle)
        .accessibilityIdentifier("quick.primaryAction")

        if primaryIntent == .reminder {
            Button("Client question", systemImage: "square.and.pencil") {
                onIntent(.prepareClientQuestion)
            }
            .accessibilityLabel("Prepare client question")
            .accessibilityIdentifier("quick.prepareClientQuestion")
        } else {
            Button("Reminder", systemImage: "calendar.badge.plus") {
                onIntent(.reminder)
            }
            .accessibilityLabel("Create reminder")
            .accessibilityIdentifier("quick.prepareReminder")
        }

        Button("Save", systemImage: "person.crop.circle.badge.checkmark") {
            onIntent(.save)
        }
        .accessibilityLabel("Save to relationship")
        .accessibilityIdentifier("quick.prepareRelationshipSave")
    }
}

private struct StateDifferenceColumn: View {
    let label: String
    let text: String
    let proposed: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(proposed ? TSBrand.seam : TSBrand.secondaryInk)
            Text(text)
                .font(.callout)
                .foregroundStyle(TSBrand.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(proposed ? TSBrand.seamTint.opacity(0.45) : TSBrand.surface, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }
}

private struct QuickDraftContext: View {
    let insight: ProvisionalFollowUpInsight

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                SectionLabel(text: "Next step in progress")
                Spacer()
                Label("Evidence linked", systemImage: "checkmark.shield")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TSBrand.evidence)
            }

            Text(insight.smallestNextStep ?? "Review the prepared local draft.")
                .font(.callout.weight(.semibold))
                .foregroundStyle(TSBrand.ink)
                .fixedSize(horizontal: false, vertical: true)

            Text("Evidence · “\(insight.exactEvidence)”")
                .font(.caption)
                .foregroundStyle(TSBrand.ink)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(TSBrand.evidenceTint.opacity(0.65), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

            Label(insight.primaryUnresolved, systemImage: "circle.dashed")
                .font(.caption)
                .foregroundStyle(TSBrand.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(11)
        .tsSurface(accent: TSBrand.evidence)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("quick.draftContext")
    }
}

private struct QuickDraftEditor: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                SectionLabel(text: "Editable draft")
                Menu {
                    ForEach(PreparedDraftKind.allCases) { kind in
                        Button {
                            model.prepareDraft(kind: kind)
                        } label: {
                            Label(
                                kind.title(language: model.provisionalInsight?.language ?? .english),
                                systemImage: model.preparedDraftKind == kind ? "checkmark" : "circle"
                            )
                        }
                    }
                } label: {
                    Label(
                        model.preparedDraftKind?.title(language: model.provisionalInsight?.language ?? .english) ?? "Draft purpose",
                        systemImage: "arrow.left.arrow.right"
                    )
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .accessibilityLabel("Draft purpose")
                .accessibilityValue(
                    model.preparedDraftKind?.title(language: model.provisionalInsight?.language ?? .english) ?? "Not selected"
                )
                .accessibilityHint("Choosing another purpose replaces only this unsent local draft")
                .accessibilityIdentifier("quick.draftKind")
                Spacer()
                TSStatusBadge(
                    title: model.localDraftStatus == .copied ? "Copied · not sent" : "Local · not sent",
                    systemImage: model.localDraftStatus == .copied ? "doc.on.clipboard" : "pencil"
                )
            }

            TextEditor(text: $model.editableFollowUpDraft)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(9)
                .frame(minHeight: 76)
                .background(TSBrand.raisedSurface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(TSBrand.hairline))
                .accessibilityIdentifier("quick.draftEditor")
                .onChange(of: model.editableFollowUpDraft) { _, _ in
                    model.markPreparedDraftEdited()
                    model.markMailDraftEdited()
                }

            TextField("Mail subject", text: $model.editableMailSubject)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("quick.mailSubject")
                .onChange(of: model.editableMailSubject) { _, _ in
                    model.markPreparedDraftEdited()
                    model.markMailDraftEdited()
                }

            HStack { draftActions }

            switch model.mailDraftHandoffStatus {
            case .notOpened:
                Text("Mail opens without a recipient. Nothing is sent.")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
            case .opened(let receipt):
                Label("Mail draft opened — nothing was sent", systemImage: "envelope.open")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TSBrand.evidence)
                    .accessibilityIdentifier("quick.mailDraftReceipt")
                    .help("Opened with subject: \(receipt.subject)")
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(TSBrand.seam)
            }
        }
        .padding(13)
        .tsSurface(raised: true)
    }

    @ViewBuilder
    private var draftActions: some View {
        Button("Discard", systemImage: "trash") {
            model.discardPreparedDraft()
        }
        .buttonStyle(.borderless)
        .accessibilityHint("Deletes this unsent local draft and performs no external action")
        .accessibilityIdentifier("quick.discardDraft")
        Spacer()
        Button("Copy draft", systemImage: "doc.on.doc") {
            model.copyPreparedDraft()
        }
        .buttonStyle(.bordered)
        .disabled(model.editableFollowUpDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        .accessibilityIdentifier("quick.copyDraft")

        Button("Open in Mail…", systemImage: "envelope.open") {
            model.openPreparedMailDraft()
        }
        .buttonStyle(TSPrimaryButtonStyle())
        .disabled(model.editableFollowUpDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        .accessibilityHint("Opens an editable system mail draft with no recipient; it does not send a message")
        .accessibilityIdentifier("quick.openMailDraft")
    }
}

private struct QuickConsequenceReview: View {
    @EnvironmentObject private var model: AppModel
    @State private var isSourceReviewExpanded = false
    let intent: ConsequenceIntent
    let insight: ProvisionalFollowUpInsight
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    SectionLabel(text: headerEyebrow)
                    Text(headerTitle)
                        .font(.title3.weight(.semibold))
                    Text(headerDetail)
                        .font(.callout)
                        .foregroundStyle(TSBrand.secondaryInk)
                }
                Spacer()
                Button("Cancel", action: onCancel)
                    .buttonStyle(.borderless)
            }

            VStack(alignment: .leading, spacing: 7) {
                SectionLabel(text: "Based on this exact evidence")
                Text("“\(insight.exactEvidence)”")
                    .font(.callout)
                    .foregroundStyle(TSBrand.ink)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                Label(insight.primaryUnresolved, systemImage: "circle.dashed")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .background(TSBrand.evidenceTint.opacity(0.58), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(TSBrand.evidence.opacity(0.20)))
            .accessibilityIdentifier("quick.consequenceContext")

            if intent == .reminder {
                QuickReminderProposalEditor()
            }

            if showsGovernance {
                if model.scopeReviewStatus == .proposed {
                    RelationshipScopeReviewView(compact: true)
                } else if model.scopeReviewStatus == .unresolved {
                    Label("Identity remains unresolved. Nothing can be saved or executed until it is reviewed.", systemImage: "person.crop.circle.badge.questionmark")
                        .font(.callout)
                        .foregroundStyle(TSBrand.seam)
                }

                DisclosureGroup(isExpanded: $isSourceReviewExpanded) {
                    QuickSourceAuthorityReview(sourceID: insight.sourceItemID)
                        .padding(.top, 12)
                } label: {
                    HStack(spacing: 8) {
                        Label("Who said this?", systemImage: "person.text.rectangle")
                        Spacer()
                        Text(sourceReviewComplete ? "Candidate confirmed" : "Needs review")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(sourceReviewComplete ? TSBrand.evidence : TSBrand.seam)
                    }
                }
                .font(.callout.weight(.semibold))
                .accessibilityIdentifier("quick.sourceReview")
            }

            if intent == .reminder {
                QuickReminderReview()
            }

            if intent == .save {
                QuickRelationshipSaveFlow()
            }
        }
        .padding(16)
        .tsSurface(raised: true, accent: TSBrand.seam)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("quick.consequenceReview")
    }

    private var saveFlowActive: Bool {
        intent == .save && model.currentInsightHasSubmittedManifest && (
            model.pendingDecision != nil ||
                model.canonicalReceipt != nil ||
                [.working, .noAction, .outcomeUnknown, .failed, .stale].contains(model.mode)
        )
    }

    private var showsGovernance: Bool {
        intent == .reminder || !saveFlowActive
    }

    private var headerEyebrow: String {
        if intent == .reminder { return "Review before creating" }
        return saveFlowActive ? "Relationship review" : "Review before saving"
    }

    private var headerTitle: String {
        if intent == .reminder { return "Create a reminder" }
        return saveFlowActive ? "Finish this review" : "Save to this relationship"
    }

    private var headerDetail: String {
        if saveFlowActive {
            return "Evidence, proposed state, your decision, and the verified result stay together here."
        }
        return "Confirm the exact relationship, source, and effect. Nothing happens until your final approval."
    }

    private var sourceReviewComplete: Bool {
        guard let source = model.capsule.items.first(where: { $0.id == insight.sourceItemID }) else {
            return false
        }
        return source.actorKind == .candidate && source.hasConfirmedAttribution && !source.localOnly
    }
}

private struct QuickSourceAuthorityReview: View {
    @EnvironmentObject private var model: AppModel
    @State private var isShowingPrivacy = false
    @State private var isRedacting = false
    @State private var redactionTerms = ""
    let sourceID: UUID

    @ViewBuilder
    var body: some View {
        if let source = model.capsule.items.first(where: { $0.id == sourceID }) {
            VStack(alignment: .leading, spacing: 11) {
                Label(source.displayName, systemImage: "text.quote")
                    .font(.callout.weight(.semibold))

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { authorControls(source) }
                    VStack(alignment: .leading, spacing: 8) { authorControls(source) }
                }

                Text("Confirm only who authored the selected excerpt. This does not confirm a fact or approve the reminder.")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)

                DisclosureGroup(isExpanded: $isShowingPrivacy) {
                    VStack(alignment: .leading, spacing: 10) {
                        Toggle("Keep this source on this Mac only", isOn: Binding(
                            get: { source.localOnly },
                            set: { model.setLocalOnly(id: source.id, value: $0) }
                        ))
                        .toggleStyle(.switch)
                        .controlSize(.small)
                        .disabled(!source.hasReviewedTextDerivative)
                        .accessibilityIdentifier("capsule.localOnly.\(source.id.uuidString)")

                        Picker("Delete source", selection: Binding(
                            get: { source.retention },
                            set: { model.setRetention(id: source.id, value: $0) }
                        )) {
                            ForEach(CapsuleRetention.allCases) { retention in
                                Text(retention.title).tag(retention)
                            }
                        }
                        .accessibilityIdentifier("capsule.retention.\(source.id.uuidString)")

                        HStack {
                            Text("Raw source stays within the selected retention window and never becomes relationship memory automatically.")
                                .font(.caption)
                                .foregroundStyle(TSBrand.secondaryInk)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 8)
                            Button("Redact…", systemImage: "eye.slash") {
                                isRedacting = true
                            }
                            .buttonStyle(.borderless)
                            .accessibilityIdentifier("capsule.redact.\(source.id.uuidString)")
                        }
                    }
                    .padding(.top, 9)
                } label: {
                    Label("Privacy and retention", systemImage: "lock.shield")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(TSBrand.secondaryInk)
                }
            }
            .padding(12)
            .background(TSBrand.surface, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(TSBrand.hairline))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("quick.sourceAuthority")
            .sheet(isPresented: $isRedacting) {
                redactionSheet(source: source)
            }
        } else {
            Label("The selected evidence is no longer available. Nothing can be saved or created.", systemImage: "exclamationmark.triangle")
                .font(.callout)
                .foregroundStyle(TSBrand.seam)
        }
    }

    @ViewBuilder
    private func authorControls(_ source: ContextCapsuleItem) -> some View {
        Picker("Source author", selection: Binding<CapsuleActorKind?>(
            get: { source.actorKind },
            set: { model.setAttribution(id: source.id, actorKind: $0) }
        )) {
            Text("Choose author…").tag(Optional<CapsuleActorKind>.none)
            ForEach(CapsuleActorKind.allCases) { actor in
                Text(actor.title).tag(Optional(actor))
            }
        }
        .frame(maxWidth: 300)
        .accessibilityIdentifier("capsule.attribution.\(source.id.uuidString)")

        if source.hasConfirmedAttribution {
            Label(
                source.actorKind == .candidate ? "Candidate source confirmed" : "Source author confirmed",
                systemImage: "checkmark.circle.fill"
            )
            .font(.caption.weight(.semibold))
            .foregroundStyle(source.actorKind == .candidate ? TSBrand.evidence : TSBrand.seam)
            .accessibilityIdentifier("capsule.attributionReceipt.\(source.id.uuidString)")
        } else {
            Button("Confirm source author") {
                model.confirmAttribution(id: source.id)
            }
            .buttonStyle(.bordered)
            .disabled(source.actorKind == nil)
            .accessibilityIdentifier("capsule.confirmAttribution.\(source.id.uuidString)")
        }
    }

    private func redactionSheet(source: ContextCapsuleItem) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Redact exact terms")
                .font(.title3.weight(.semibold))
            Text("Enter names, addresses, or other exact visible terms separated by commas. Matching text is replaced locally before this source can be used.")
                .foregroundStyle(TSBrand.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Exact terms, separated by commas", text: $redactionTerms)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("capsule.redactionTerms")
            HStack {
                Button("Cancel") { isRedacting = false }
                Spacer()
                Button("Apply local redaction") {
                    model.redactCapsuleItem(
                        id: source.id,
                        exactTerms: redactionTerms.split(separator: ",").map(String.init)
                    )
                    if model.errorMessage == nil {
                        redactionTerms = ""
                        isRedacting = false
                    }
                }
                .buttonStyle(TSPrimaryButtonStyle())
                .disabled(redactionTerms.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("capsule.applyRedaction")
            }
        }
        .padding(22)
        .frame(width: 480)
    }
}

private struct QuickRelationshipSaveFlow: View {
    @EnvironmentObject private var model: AppModel

    @ViewBuilder
    var body: some View {
        if !model.currentInsightHasSubmittedManifest {
            initialSubmit
        } else if let decision = model.pendingDecision {
            QuickRelationshipDecision(decision: decision)
        } else {
            switch model.mode {
            case .working:
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Reviewing the selected evidence. Nothing is being saved automatically…")
                        .font(.callout.weight(.semibold))
                }
                .accessibilityIdentifier("quick.relationshipWorking")
            case .receipt:
                relationshipReceipt
            case .noAction:
                noActionResult
            case .outcomeUnknown:
                outcomeUnknown
            case .failed:
                failureResult
            case .stale:
                staleResult
            case .ambiguousIdentity, .identityReviewSaved:
                Label(
                    "Identity remains unresolved. The local insight is still available, but no relationship change can be saved.",
                    systemImage: "person.crop.circle.badge.questionmark"
                )
                .font(.callout)
                .foregroundStyle(TSBrand.seam)
                .fixedSize(horizontal: false, vertical: true)
            default:
                initialSubmit
            }
        }
    }

    private var initialSubmit: some View {
        HStack {
            Label("Nothing is saved before review", systemImage: "lock")
                .font(.caption)
                .foregroundStyle(TSBrand.secondaryInk)
            Spacer()
            Button("Review save proposal", systemImage: "arrow.right") {
                Task { await model.submitCurrentInsight() }
            }
            .buttonStyle(TSPrimaryButtonStyle())
            .keyboardShortcut(.return, modifiers: [.command, .shift])
            .disabled(!model.canSubmitCurrentInsight)
            .accessibilityHint("Submits only the reviewed, candidate-attributed text shown above; no relationship fact is confirmed automatically")
            .accessibilityIdentifier("capsule.submit")
        }
    }

    @ViewBuilder
    private var relationshipReceipt: some View {
        if let receipt = model.canonicalReceipt {
            VStack(alignment: .leading, spacing: 10) {
                Label(
                    receipt.changedFields.isEmpty ? "Review saved — relationship unchanged" : "Relationship updated after your review",
                    systemImage: "checkmark.seal.fill"
                )
                .font(.headline)
                .foregroundStyle(TSBrand.evidence)
                .accessibilityIdentifier("quick.relationshipReceipt")
                Text(receipt.summary)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                Label(
                    receipt.externalEffects.isEmpty ? "Nothing was sent" : "External effects are recorded below",
                    systemImage: receipt.externalEffects.isEmpty ? "paperplane.slash" : "exclamationmark.shield"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(receipt.externalEffects.isEmpty ? TSBrand.secondaryInk : TSBrand.seam)

                DisclosureGroup("Details and recovery receipt") {
                    VStack(alignment: .leading, spacing: 7) {
                        if !receipt.changedFields.isEmpty {
                            LabeledContent("Changed") {
                                Text(receipt.changedFields.joined(separator: ", "))
                            }
                        }
                        if !receipt.externalEffects.isEmpty {
                            LabeledContent("External effects") {
                                Text(receipt.externalEffects.joined(separator: ", "))
                            }
                        }
                        Text("Revision \(receipt.beforeRevision) → \(receipt.afterRevision)")
                        Text("Receipt \(receipt.id) · operation \(receipt.operationID)")
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                    }
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .padding(.top, 8)
                }
            }
            .padding(13)
            .background(TSBrand.evidenceTint.opacity(0.55), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        } else {
            Label("The relationship result could not be read back, so success is not being claimed.", systemImage: "questionmark.diamond")
                .font(.callout)
                .foregroundStyle(TSBrand.seam)
        }
    }

    private var noActionResult: some View {
        VStack(alignment: .leading, spacing: 9) {
            Label("No relationship update was needed", systemImage: "checkmark.circle")
                .font(.headline)
                .foregroundStyle(TSBrand.evidence)
                .accessibilityIdentifier("quick.relationshipNoAction")
            Text(model.presentation.changedSummary)
                .font(.callout)
            Text(model.presentation.dependency)
                .font(.callout)
                .foregroundStyle(TSBrand.secondaryInk)
            if let existing = model.presentation.actionProjections.first {
                VStack(alignment: .leading, spacing: 3) {
                    SectionLabel(text: "Existing next step")
                    Text(existing.objectName)
                        .font(.callout.weight(.semibold))
                    Text(existing.nextOperation)
                        .font(.caption)
                        .foregroundStyle(TSBrand.secondaryInk)
                }
            }
            Label("Nothing new was created or sent", systemImage: "paperplane.slash")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TSBrand.secondaryInk)
        }
        .padding(13)
        .background(TSBrand.evidenceTint.opacity(0.45), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var outcomeUnknown: some View {
        VStack(alignment: .leading, spacing: 9) {
            Label("We couldn’t verify whether the relationship review was saved", systemImage: "questionmark.diamond")
                .font(.headline)
                .foregroundStyle(TSBrand.seam)
            Text("Check the original operation before trying again. capri will not submit a second change blindly.")
                .font(.callout)
                .foregroundStyle(TSBrand.secondaryInk)
            Button("Check what happened", systemImage: "arrow.triangle.2.circlepath") {
                Task { await model.reconcileCanonicalDecision() }
            }
            .buttonStyle(TSPrimaryButtonStyle())
            .accessibilityIdentifier("quick.relationshipReconcile")
        }
    }

    private var failureResult: some View {
        VStack(alignment: .leading, spacing: 9) {
            Label("Relationship review failed safely", systemImage: "exclamationmark.triangle")
                .font(.headline)
                .foregroundStyle(TSBrand.seam)
            Text(model.errorMessage ?? "Nothing was saved.")
                .font(.callout)
                .foregroundStyle(TSBrand.secondaryInk)
            Button("Return to selected context") {
                model.returnToCapsuleAfterFailure()
            }
        }
    }

    private var staleResult: some View {
        VStack(alignment: .leading, spacing: 9) {
            Label("The supporting source is no longer current", systemImage: "clock.arrow.circlepath")
                .font(.headline)
                .foregroundStyle(TSBrand.seam)
            Text("Review the changed evidence before creating a new save proposal. The earlier proposal cannot be confirmed.")
                .font(.callout)
                .foregroundStyle(TSBrand.secondaryInk)
        }
    }
}

private struct QuickRelationshipDecision: View {
    @EnvironmentObject private var model: AppModel
    let decision: CanonicalProposalReview

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                SectionLabel(text: "Review before saving")
                Text(decision.summary)
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                Text(decision.dependency)
                    .font(.callout)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }

            ForEach(decision.items) { item in
                QuickRelationshipProposalItem(
                    item: item,
                    evidence: decision.evidence.filter { item.evidenceRefs.contains($0.id) }
                )
            }

            HStack(alignment: .center, spacing: 10) {
                Label("No message or reminder is authorized by this decision", systemImage: "paperplane.slash")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                Spacer()
                Button("Save reviewed decisions", systemImage: "checkmark") {
                    Task { await model.resolveCanonicalDecision() }
                }
                .buttonStyle(TSPrimaryButtonStyle())
                .disabled(!model.canResolveCanonicalDecision)
                .accessibilityIdentifier("canonical.resolve")
            }
        }
        .padding(13)
        .background(TSBrand.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(TSBrand.hairline))
        .accessibilityIdentifier("quick.relationshipDecision")
    }
}

private struct QuickRelationshipProposalItem: View {
    @EnvironmentObject private var model: AppModel
    let item: CanonicalProposalReview.Item
    let evidence: [CanonicalProposalReview.Evidence]

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack {
                Text(humanReadableKey)
                    .font(.callout.weight(.semibold))
                Spacer()
                Text(item.epistemicStatus.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TSBrand.evidence)
            }

            VStack(alignment: .leading, spacing: 7) {
                SectionLabel(text: "Exact evidence")
                if evidence.isEmpty {
                    Text("Current evidence is unavailable. Keep this proposal unresolved.")
                        .font(.callout)
                        .foregroundStyle(TSBrand.seam)
                } else {
                    ForEach(evidence) { fragment in
                        Text("“\(fragment.text)”")
                            .font(.callout)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(10)
            .background(TSBrand.evidenceTint.opacity(0.50), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 8) {
                    quickDecisionValue("Before", item.beforeValue, proposed: false)
                    Image(systemName: "arrow.right")
                        .foregroundStyle(TSBrand.seam)
                        .padding(.top, 23)
                    quickDecisionValue("Proposed · not saved", item.proposedValue, proposed: true)
                }
                VStack(alignment: .leading, spacing: 7) {
                    quickDecisionValue("Before", item.beforeValue, proposed: false)
                    Image(systemName: "arrow.down")
                        .foregroundStyle(TSBrand.seam)
                    quickDecisionValue("Proposed · not saved", item.proposedValue, proposed: true)
                }
            }

            Text(item.effectSummary)
                .font(.caption)
                .foregroundStyle(TSBrand.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 7) { decisionButtons }
                VStack(alignment: .leading, spacing: 7) { decisionButtons }
            }
        }
        .padding(12)
        .background(TSBrand.raisedSurface, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(TSBrand.hairline.opacity(0.75)))
        .accessibilityIdentifier("quick.relationshipItem.\(item.id)")
    }

    private var humanReadableKey: String {
        item.key
            .replacingOccurrences(of: ":", with: " · ")
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }

    private func quickDecisionValue(_ label: String, _ value: String, proposed: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(proposed ? TSBrand.seam : TSBrand.secondaryInk)
            Text(value)
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(proposed ? TSBrand.seamTint.opacity(0.42) : TSBrand.surface, in: RoundedRectangle(cornerRadius: 7))
    }

    @ViewBuilder
    private var decisionButtons: some View {
        ForEach(CanonicalDecisionChoice.allCases) { choice in
            let selected = model.decisionSelections[item.id] == choice
            Button {
                model.setDecision(itemID: item.id, choice: choice)
            } label: {
                Label(choice.title, systemImage: selected ? "checkmark.circle.fill" : "circle")
            }
            .buttonStyle(.bordered)
            .tint(selected ? TSBrand.evidence : nil)
            .accessibilityAddTraits(selected ? .isSelected : [])
            .accessibilityIdentifier("canonical.choice.\(choice.rawValue).\(item.id)")
        }
    }
}

private struct QuickReminderProposalEditor: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack {
                SectionLabel(text: "Exact reminder")
                Spacer()
                Label("Not created", systemImage: "circle")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TSBrand.secondaryInk)
            }

            TextField("Reminder title", text: $model.reminderTitle)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("quick.reminderTitle")
                .onChange(of: model.reminderTitle) { _, _ in
                    model.markReminderEdited()
                }

            DatePicker(
                "Remind me",
                selection: $model.reminderDueAt,
                in: Date()...,
                displayedComponents: [.date, .hourAndMinute]
            )
            .accessibilityIdentifier("quick.reminderDueAt")
            .onChange(of: model.reminderDueAt) { _, _ in
                model.markReminderEdited()
            }
        }
        .padding(13)
        .background(TSBrand.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(TSBrand.hairline))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("quick.reminderProposal")
    }
}

private struct QuickReminderReview: View {
    @EnvironmentObject private var model: AppModel
    @State private var removalCandidate: FollowUpReminderReceipt?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Destination and final approval")

            if let recovery = model.reminderRecoveryNotice {
                Label(recovery, systemImage: "arrow.triangle.2.circlepath.circle")
                    .font(.caption)
                    .foregroundStyle(TSBrand.evidence)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("quick.reminderRecoveryNotice")
            }

            if !model.hasReviewedReminderAuthority {
                Label("Confirm the relationship and candidate source above. The reminder remains a local proposal if you cancel.", systemImage: "person.text.rectangle")
                    .font(.caption)
                    .foregroundStyle(TSBrand.seam)
                    .fixedSize(horizontal: false, vertical: true)
            }

            duplicateActionBoundary

            if model.reminderDuplicateActionDecision != .useExistingAction {
                reminderState
            }
        }
        .padding(13)
        .background(TSBrand.surface, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(TSBrand.hairline))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("quick.reminderReview")
        .confirmationDialog(
            "Remove this reminder from Apple Reminders?",
            isPresented: Binding(
                get: { removalCandidate != nil },
                set: { if !$0 { removalCandidate = nil } }
            )
        ) {
            Button("Remove reminder", role: .destructive) {
                guard let receipt = removalCandidate else { return }
                removalCandidate = nil
                Task { await model.removeVerifiedReminder(receipt) }
            }
            Button("Keep reminder", role: .cancel) {
                removalCandidate = nil
            }
        } message: {
            Text("capri will remove only the reminder proven by this receipt, then verify that it is absent.")
        }
    }

    @ViewBuilder
    private var duplicateActionBoundary: some View {
        switch model.reminderDuplicateActionDecision {
        case .unavailable:
            Label("Canonical Pursuit context is unavailable. Reminder preview stays blocked.", systemImage: "exclamationmark.shield")
                .font(.caption)
                .foregroundStyle(TSBrand.seam)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("quick.reminderDuplicateUnavailable")
        case .notRequired:
            Label("No open user-owned action in the current canonical Pursuit readback.", systemImage: "checkmark.shield")
                .font(.caption)
                .foregroundStyle(TSBrand.evidence)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("quick.reminderDuplicateClear")
        case .unreviewed:
            if let preflight = model.selectedRelationshipConsequencePreflight {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Review existing user-owned work", systemImage: "arrow.triangle.branch")
                        .font(.callout.weight(.semibold))
                    Text("A new reminder may duplicate an open canonical action. Review the current readback before continuing.")
                        .font(.caption)
                        .foregroundStyle(TSBrand.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                    existingActionRows(preflight.openActions)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { duplicateDecisionButtons }
                        VStack(alignment: .leading, spacing: 8) { duplicateDecisionButtons }
                    }
                }
                .padding(10)
                .background(TSBrand.seamTint.opacity(0.34), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityIdentifier("quick.reminderDuplicateReview")
            }
        case .separateReminderConfirmed:
            VStack(alignment: .leading, spacing: 7) {
                Label("Existing action reviewed · this reminder is separate", systemImage: "checkmark.shield.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TSBrand.evidence)
                if let actions = model.selectedRelationshipConsequencePreflight?.openActions {
                    existingActionRows(actions)
                }
                Button("Reconsider") {
                    model.reconsiderReminderDuplicateActionDecision()
                }
                .buttonStyle(.borderless)
            }
            .accessibilityIdentifier("quick.reminderDuplicateSeparate")
        case .useExistingAction:
            VStack(alignment: .leading, spacing: 7) {
                Label("Using the existing user-owned action", systemImage: "arrow.uturn.backward.circle.fill")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(TSBrand.evidence)
                Text("No Apple Reminder was created. Any earlier destination preview was discarded.")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                Button("Reconsider and prepare a separate reminder") {
                    model.reconsiderReminderDuplicateActionDecision()
                }
                .buttonStyle(.borderless)
            }
            .padding(10)
            .background(TSBrand.evidenceTint.opacity(0.48), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityIdentifier("quick.reminderUseExistingAction")
        }
    }

    @ViewBuilder
    private func existingActionRows(_ actions: [RelationshipConsequencePreflight.OpenAction]) -> some View {
        ForEach(actions) { action in
            VStack(alignment: .leading, spacing: 2) {
                Text(action.title)
                    .font(.caption.weight(.semibold))
                Text("Owner · \(action.owner)\(action.dueAt.map { " · Due \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "")")
                    .font(.caption2)
                    .foregroundStyle(TSBrand.secondaryInk)
            }
        }
    }

    @ViewBuilder
    private var duplicateDecisionButtons: some View {
        Button("Use existing action") {
            model.useExistingOwnedActionInstead()
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("quick.reminderUseExisting")

        Button("This reminder is separate") {
            model.confirmSeparateReminderAfterExistingActionReview()
        }
        .buttonStyle(TSPrimaryButtonStyle())
        .accessibilityIdentifier("quick.reminderSeparate")
    }

    @ViewBuilder
    private var reminderState: some View {
        switch model.reminderOperationState {
        case .notPrepared:
            previewDestinationButton
        case .loadingDestination:
            HStack(spacing: 9) {
                ProgressView()
                Text("Reading the default Apple Reminders list…")
                    .font(.callout)
            }
        case .readyForApproval:
            if let destination = model.reminderDestination {
                VStack(alignment: .leading, spacing: 9) {
                    HStack {
                        Label(destination.title, systemImage: "list.bullet.rectangle")
                            .font(.headline)
                        Spacer()
                        TSStatusBadge(title: "Apple Reminders", systemImage: "checkmark.circle")
                    }
                    Text(model.reminderTitle)
                        .font(.callout.weight(.semibold))
                    Text(model.reminderDueAt, format: .dateTime.weekday().month().day().hour().minute())
                        .font(.callout)
                        .foregroundStyle(TSBrand.secondaryInk)
                    Text("Only this title and due date will be written. A non-sensitive recovery reference prevents duplicate retries.")
                        .font(.caption)
                        .foregroundStyle(TSBrand.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack {
                        Button("Refresh destination") {
                            Task { await model.loadReminderDestinationPreview() }
                        }
                        .buttonStyle(.borderless)
                        Spacer()
                        Button("Approve and create", systemImage: "checkmark") {
                            Task { await model.approveAndCreateReminder() }
                        }
                        .buttonStyle(TSPrimaryButtonStyle())
                        .accessibilityHint("Creates exactly the reminder previewed here, then verifies it from Apple Reminders")
                        .accessibilityIdentifier("quick.reminderApprove")
                    }
                }
                .padding(12)
                .background(TSBrand.evidenceTint.opacity(0.55), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .accessibilityIdentifier("quick.reminderDestinationPreview")
            }
        case .executing:
            HStack(spacing: 9) {
                ProgressView()
                Text("Writing once, then reading the destination back…")
                    .font(.callout.weight(.semibold))
            }
        case .saved(let receipt):
            VStack(alignment: .leading, spacing: 6) {
                Label("Reminder verified in \(receipt.destinationTitle)", systemImage: "checkmark.seal.fill")
                    .font(.headline)
                    .foregroundStyle(TSBrand.evidence)
                Text(receipt.title)
                    .font(.callout.weight(.semibold))
                Text(receipt.dueAt, format: .dateTime.weekday().month().day().hour().minute())
                    .font(.callout)
                    .foregroundStyle(TSBrand.secondaryInk)
                Text("Apple Reminders readback matched the approved title, date, and list.")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                Button("Remove reminder…", role: .destructive) {
                    removalCandidate = receipt
                }
                .buttonStyle(.borderless)
                .accessibilityIdentifier("quick.reminderRemove")
            }
            .accessibilityIdentifier("quick.reminderReceipt")
        case .failed(let message):
            VStack(alignment: .leading, spacing: 8) {
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(TSBrand.seam)
                    .fixedSize(horizontal: false, vertical: true)
                previewDestinationButton
            }
        case .unknown(let message):
            VStack(alignment: .leading, spacing: 8) {
                Label("Reminder outcome unknown", systemImage: "questionmark.diamond")
                    .font(.headline)
                    .foregroundStyle(TSBrand.seam)
                Text(message)
                    .font(.callout)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Reconcile with Apple Reminders", systemImage: "arrow.triangle.2.circlepath") {
                    Task { await model.reconcileReminderOutcome() }
                }
                .disabled(!model.canReconcileReminderOutcome)
                .accessibilityIdentifier("quick.reminderReconcile")
            }
        case .removing:
            HStack(spacing: 9) {
                ProgressView()
                Text("Removing the verified reminder, then checking the destination…")
                    .font(.callout.weight(.semibold))
            }
        case .removed(let receipt):
            VStack(alignment: .leading, spacing: 6) {
                Label("Reminder removal verified", systemImage: "trash.circle.fill")
                    .font(.headline)
                    .foregroundStyle(TSBrand.evidence)
                Text(receipt.wasAlreadyAbsent
                    ? "The verified reminder was already absent from \(receipt.destinationTitle)."
                    : "The verified reminder is no longer present in \(receipt.destinationTitle).")
                    .font(.callout)
                    .foregroundStyle(TSBrand.secondaryInk)
            }
            .accessibilityIdentifier("quick.reminderRemovalReceipt")
        case .removalFailed(let receipt, let message):
            VStack(alignment: .leading, spacing: 8) {
                Label("Reminder was not removed", systemImage: "exclamationmark.triangle")
                    .font(.headline)
                    .foregroundStyle(TSBrand.seam)
                Text(message)
                    .font(.callout)
                    .foregroundStyle(TSBrand.secondaryInk)
                Button("Review removal again") {
                    removalCandidate = receipt
                }
            }
        case .removalUnknown(let receipt, let message):
            VStack(alignment: .leading, spacing: 8) {
                Label("Removal outcome unknown", systemImage: "questionmark.diamond")
                    .font(.headline)
                    .foregroundStyle(TSBrand.seam)
                Text(message)
                    .font(.callout)
                    .foregroundStyle(TSBrand.secondaryInk)
                Button("Reconcile removal", systemImage: "arrow.triangle.2.circlepath") {
                    Task { await model.reconcileReminderRemoval(receipt) }
                }
                .accessibilityIdentifier("quick.reminderRemovalReconcile")
            }
        }
    }

    private var previewDestinationButton: some View {
        HStack {
            Text("No Apple Reminders write has occurred.")
                .font(.caption)
                .foregroundStyle(TSBrand.secondaryInk)
            Spacer()
            Button("Preview destination", systemImage: "eye") {
                Task { await model.loadReminderDestinationPreview() }
            }
            .buttonStyle(TSPrimaryButtonStyle())
            .disabled(!model.canPreviewReminderDestination)
            .accessibilityIdentifier("quick.reminderPreview")
        }
    }
}
