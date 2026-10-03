import SwiftUI

@MainActor
struct TalentSignalLabView: View {
    @ObservedObject var store: TalentSignalLabStore

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLanguage) private var appLanguage
    @State private var showsSignalLens = false
    @State private var showsPromotionDecision = false

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                labScrollContent
                    .modifier(
                        LabRevealOnChangeModifier(
                            proxy: proxy,
                            identifier: store.comparison?.id,
                            target: LabScrollTarget.comparison
                        )
                    )
                    .modifier(
                        LabRevealOnChangeModifier(
                            proxy: proxy,
                            identifier: store.receipt?.id,
                            target: LabScrollTarget.receipt
                        )
                    )
                    .modifier(
                        LabRevealOnChangeModifier(
                            proxy: proxy,
                            identifier: store.evalCase?.id,
                            target: LabScrollTarget.evalCase
                        )
                    )
            }
            .navigationTitle(appLanguage.text("Lab"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(appLanguage.text("Done")) {
                        dismiss()
                    }
                    .accessibilityIdentifier("lab-done")
                }
            }
        }
        .tint(.tsVermilion)
        .task {
            if case .idle = store.phase {
                await store.load()
            }
        }
        .sheet(isPresented: $showsSignalLens) {
            if store.run != nil {
                TalentSignalLensView(store: store)
            }
        }
        .confirmationDialog(
            appLanguage.text("Promote this Reality Receipt?"),
            isPresented: $showsPromotionDecision,
            titleVisibility: .visible
        ) {
            Button(
                appLanguage.text("Promote as candidate-blocking Eval")
            ) {
                Task { await store.promote() }
            }
            .accessibilityIdentifier("lab-confirm-promotion")
            Button(appLanguage.text("Cancel"), role: .cancel) {}
        } message: {
            Text(
                appLanguage.text("This is an explicit human quality decision. It changes only the Eval control plane and performs no relationship or external-system write.")
            )
        }
        .alert(
            appLanguage.text("Lab operation stopped"),
            isPresented: Binding(
                get: { store.errorMessage != nil },
                set: { if !$0 { store.dismissError() } }
            )
        ) {
            Button(appLanguage.text("OK")) {
                store.dismissError()
            }
        } message: {
            Text(store.errorMessage ?? "")
        }
    }

    private var labScrollContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                introduction
                content
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 44)
        }
        .scrollIndicators(.hidden)
        .background(Color.tsSurface.ignoresSafeArea())
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(
                appLanguage.text("INTERNAL PRODUCT LAB")
            )
            .font(.caption.weight(.bold))
            .tracking(1.25)
            .foregroundStyle(Color.tsVermilion)

            Text(appLanguage.text("capri Lab"))
                .font(.custom("Georgia", size: 38, relativeTo: .largeTitle))
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)

            Text(
                appLanguage.text("Enter an isolated world, understand why a result appeared, reproduce the same evidence, and preserve the finding as runnable quality evidence.")
            )
            .font(.body)
            .foregroundStyle(Color.tsMutedInk)
            .fixedSize(horizontal: false, vertical: true)

            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(
                        appLanguage.text("Production isolated")
                    )
                    .font(.subheadline.weight(.semibold))
                    Text(appLanguage.text("0 canonical writes · 0 external effects"))
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                }
            } icon: {
                Image(systemName: "checkmark.shield")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.tsConfirmed)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 16))
            .overlay {
                RoundedRectangle(cornerRadius: 16).stroke(Color.tsLine, lineWidth: 1)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("lab-isolation-seal")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch store.phase {
        case .idle, .loading:
            LabLoadingView()
        case let .unavailable(reason):
            LabUnavailableView(reason: reason)
        case let .failed(message):
            LabFailureView(message: message) {
                Task { await store.load(force: true) }
            }
        case .ready:
            LabTaskList(
                store: store,
                openLens: { showsSignalLens = true }
            )
            LabScenarioList(store: store)
            if let session = store.session {
                LabCurrentWorldSection(
                    store: store,
                    session: session,
                    openLens: { showsSignalLens = true }
                )
            } else {
                LabNoWorldView()
            }
            if let comparison = store.comparison {
                LabComparisonSection(comparison: comparison)
                    .id(LabScrollTarget.comparison)
            }
            if let receipt = store.receipt {
                LabRealityReceiptSection(
                    receipt: receipt,
                    evalCase: store.evalCase,
                    isPending: store.pending != nil,
                    promote: { showsPromotionDecision = true }
                )
                .id(LabScrollTarget.receipt)
            } else if store.run != nil {
                LabReceiptPrompt(
                    isPending: store.pending != nil,
                    record: { Task { await store.record() } }
                )
            }
        }
    }
}

private enum LabScrollTarget {
    static let comparison = "lab-comparison-section"
    static let receipt = "lab-receipt-section"
    static let evalCase = "lab-eval-case"
}

private struct LabRevealOnChangeModifier: ViewModifier {
    let proxy: ScrollViewProxy
    let identifier: String?
    let target: String

    @Environment(\.talentSignalReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .onChange(of: identifier) { value in
                guard value != nil else { return }
                reveal()
            }
    }

    private func reveal() {
        Task { @MainActor in
            await Task.yield()
            if reduceMotion {
                proxy.scrollTo(target, anchor: .top)
            } else {
                withAnimation(.easeInOut(duration: 0.32)) {
                    proxy.scrollTo(target, anchor: .top)
                }
            }
        }
    }
}

private struct LabLoadingView: View {
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text(
                appLanguage.text("Connecting to the Lab control plane…")
            )
            .font(.subheadline)
            .foregroundStyle(Color.tsMutedInk)
        }
        .frame(maxWidth: .infinity, minHeight: 110)
        .accessibilityIdentifier("lab-loading")
    }
}

private struct LabUnavailableView: View {
    let reason: String?
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        LabEmptyPanel(
            systemImage: "lock.shield",
            title: appLanguage.text("This build has no Lab capability"),
            detail: reason ?? appLanguage.text("The server must explicitly enable the internal synthetic-evidence boundary.")
        )
        .accessibilityIdentifier("lab-unavailable")
    }
}

private struct LabFailureView: View {
    let message: String
    let retry: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LabEmptyPanel(
                systemImage: "exclamationmark.triangle",
                title: appLanguage.text("The Lab world could not be verified"),
                detail: message
            )
            Button(
                appLanguage.text("Try again"),
                action: retry
            )
            .buttonStyle(LabSecondaryButtonStyle())
        }
        .accessibilityIdentifier("lab-failure")
    }
}

private struct LabEmptyPanel: View {
    let systemImage: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            Image(systemName: systemImage)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.tsVermilion)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(Color.tsInk)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(17)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20).stroke(Color.tsLine, lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct LabTaskList: View {
    @ObservedObject var store: TalentSignalLabStore
    let openLens: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LabSectionHeading(
                eyebrow: appLanguage.text("LAB TASKS"),
                title: appLanguage.text("Start from the product question")
            )
            VStack(spacing: 0) {
                LabTaskRow(
                    systemImage: "globe.asia.australia",
                    title: appLanguage.text("Current world"),
                    detail: store.session?.scenario.title ?? appLanguage.text("Choose a versioned scenario below"),
                    enabled: false,
                    showsCompletion: store.session != nil,
                    action: {}
                )
                LabTaskDivider()
                LabTaskRow(
                    systemImage: "arrow.counterclockwise",
                    title: appLanguage.text("Replay a scenario"),
                    detail: appLanguage.text("Run the candidate against the frozen evidence snapshot"),
                    enabled: store.session != nil && store.pending == nil,
                    showsCompletion: store.run != nil,
                    action: { Task { await store.replay() } }
                )
                LabTaskDivider()
                LabTaskRow(
                    systemImage: "magnifyingglass",
                    title: appLanguage.text("Inspect why"),
                    detail: appLanguage.text("Observation → interpretation → uncertainty → evidence"),
                    enabled: store.run != nil && store.pending == nil,
                    showsCompletion: false,
                    action: openLens
                )
                LabTaskDivider()
                LabTaskRow(
                    systemImage: "doc.text.magnifyingglass",
                    title: appLanguage.text("Record an issue"),
                    detail: appLanguage.text("Create a redacted, reproducible Reality Receipt"),
                    enabled: store.run != nil && store.receipt == nil && store.pending == nil,
                    showsCompletion: store.receipt != nil,
                    action: { Task { await store.record() } }
                )
            }
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
            .overlay {
                RoundedRectangle(cornerRadius: 20).stroke(Color.tsLine, lineWidth: 1)
            }
        }
    }
}

private struct LabTaskDivider: View {
    var body: some View {
        Rectangle()
            .fill(Color.tsLine)
            .frame(height: 1)
            .padding(.leading, 58)
            .accessibilityHidden(true)
    }
}

private struct LabTaskRow: View {
    let systemImage: String
    let title: String
    let detail: String
    let enabled: Bool
    let showsCompletion: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 13) {
                Image(systemName: systemImage)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(enabled ? Color.tsVermilion : Color.tsMutedInk)
                    .frame(width: 28)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Image(systemName: showsCompletion ? "checkmark.circle.fill" : "chevron.right")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(
                        showsCompletion ? Color.tsConfirmed : Color.tsMutedInk
                    )
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(showsCompletion ? .isSelected : [])
    }
}

private struct LabScenarioList: View {
    @ObservedObject var store: TalentSignalLabStore
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    scenarioHeading
                    Spacer(minLength: 12)
                    scenarioCount
                }
                VStack(alignment: .leading, spacing: 6) {
                    scenarioHeading
                    scenarioCount
                }
            }

            ForEach(Array(store.scenarios.enumerated()), id: \.element.id) { index, scenario in
                LabScenarioRow(
                    index: index + 1,
                    scenario: scenario,
                    selected: store.session?.scenario.id == scenario.id,
                    disabled: store.pending != nil
                ) {
                    Task { await store.start(scenario) }
                }
            }
        }
    }

    private var scenarioHeading: some View {
        LabSectionHeading(
            eyebrow: appLanguage.text("VERSIONED WORLDS"),
            title: appLanguage.text("Choose a product scenario")
        )
    }

    private var scenarioCount: some View {
        Text(
            String(
                format: appLanguage.text("%lld frozen"),
                locale: appLanguage.locale,
                store.scenarios.count
            )
        )
        .font(.caption)
        .foregroundStyle(Color.tsMutedInk)
    }
}

private struct LabScenarioRow: View {
    let index: Int
    let scenario: LabScenarioSummary
    let selected: Bool
    let disabled: Bool
    let action: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Text(String(format: "%02d", index))
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(Color.tsMutedInk)
                    LabStatusPill(
                        systemImage: scenario.riskTier == .blocker
                            ? "hand.raised.fill"
                            : "scope",
                        label: categoryLabel,
                        color: scenario.riskTier == .blocker
                            ? Color.tsVermilion
                            : Color.tsInk
                    )
                    Spacer(minLength: 8)
                    if selected {
                        Label(
                            appLanguage.text("Current"),
                            systemImage: "checkmark.circle.fill"
                        )
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsConfirmed)
                    } else {
                        Image(systemName: "arrow.right")
                            .foregroundStyle(Color.tsMutedInk)
                            .accessibilityHidden(true)
                    }
                }
                Text(scenario.title)
                    .font(.headline)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
                Text(scenario.summary)
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                Text(scenario.revision)
                    .font(.caption.monospaced())
                    .foregroundStyle(Color.tsMutedInk)
            }
            .padding(17)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
            .overlay {
                RoundedRectangle(cornerRadius: 20)
                    .stroke(
                        selected ? Color.tsVermilion.opacity(0.65) : Color.tsLine,
                        lineWidth: selected ? 1.5 : 1
                    )
            }
            .contentShape(RoundedRectangle(cornerRadius: 20))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(scenario.title)
        .accessibilityValue(
            selected
                ? appLanguage.text("Current world")
                : categoryLabel
        )
        .accessibilityHint(scenario.summary)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("lab-scenario-\(scenario.id)")
    }

    private var categoryLabel: String {
        switch scenario.category {
        case .momentum:
            appLanguage.text("Relationship change")
        case .identity:
            appLanguage.text("Identity")
        case .evidence:
            appLanguage.text("Evidence")
        case .authorization:
            appLanguage.text("Authorization")
        case .action:
            appLanguage.text("Action")
        }
    }
}

private struct LabNoWorldView: View {
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        LabEmptyPanel(
            systemImage: "flask",
            title: appLanguage.text("Choose a scenario to enter a test world"),
            detail: appLanguage.text("Lab creates an isolated workspace, frozen evidence snapshot, and version pair. It never reads or changes real contacts.")
        )
        .accessibilityIdentifier("lab-no-world")
    }
}

private struct LabCurrentWorldSection: View {
    @ObservedObject var store: TalentSignalLabStore
    let session: LabSession
    let openLens: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            LabSectionHeading(
                eyebrow: appLanguage.text("CURRENT WORLD"),
                title: session.scenario.title
            )

            VStack(spacing: 0) {
                LabWorldValue(label: appLanguage.text("Environment"), value: session.environment)
                LabValueDivider()
                LabWorldValue(label: appLanguage.text("Test identity"), value: session.testerIdentity)
                LabValueDivider()
                LabWorldValue(
                    label: appLanguage.text("Versions"),
                    value: "Agent \(session.activeEnvelope.agentVersion) · Prompt \(session.activeEnvelope.promptVersion)"
                )
                LabValueDivider()
                LabWorldValue(
                    label: appLanguage.text("Isolation"),
                    value: "\(session.workspaceReference) · production denied",
                    systemImage: "lock.fill"
                )
            }
            .padding(.horizontal, 16)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
            .overlay {
                RoundedRectangle(cornerRadius: 20).stroke(Color.tsLine, lineWidth: 1)
            }

            Text(session.scenario.expectedBehavior)
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { worldActions }
                VStack(spacing: 10) { worldActions }
            }

            if let run = store.run {
                LabRunExperience(
                    run: run,
                    openLens: openLens
                )
            } else {
                LabRunEmptyView(
                    isPending: store.pending != nil,
                    replay: { Task { await store.replay() } }
                )
            }
        }
        .padding(18)
        .background(Color.tsSurfaceMuted, in: RoundedRectangle(cornerRadius: 24))
        .overlay {
            RoundedRectangle(cornerRadius: 24).stroke(Color.tsLine, lineWidth: 1)
        }
    }

    @ViewBuilder
    private var worldActions: some View {
        Button {
            Task { await store.replay() }
        } label: {
            Label(
                store.run == nil
                    ? appLanguage.text("Run Candidate")
                    : appLanguage.text("Replay Candidate"),
                systemImage: "arrow.counterclockwise"
            )
        }
        .buttonStyle(LabSecondaryButtonStyle())
        .disabled(store.pending != nil)
        .accessibilityIdentifier("lab-run-candidate")

        Button {
            Task { await store.compare() }
        } label: {
            Label(
                appLanguage.text("Compare with baseline"),
                systemImage: "arrow.left.arrow.right"
            )
        }
        .buttonStyle(LabSecondaryButtonStyle())
        .disabled(store.pending != nil)
        .accessibilityIdentifier("lab-compare-baseline")
    }
}

private struct LabWorldValue: View {
    let label: String
    let value: String
    var systemImage: String?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(label: String, value: String, systemImage: String? = nil) {
        self.label = label
        self.value = value
        self.systemImage = systemImage
    }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 5) {
                    labelView
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        iconView
                        valueView.multilineTextAlignment(.leading)
                    }
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    labelView.frame(width: 78, alignment: .leading)
                    Spacer(minLength: 0)
                    iconView
                    valueView.multilineTextAlignment(.trailing)
                }
            }
        }
        .padding(.vertical, 11)
        .accessibilityElement(children: .combine)
    }

    private var labelView: some View {
        Text(label)
            .font(.caption)
            .foregroundStyle(Color.tsMutedInk)
    }

    @ViewBuilder
    private var iconView: some View {
        if let systemImage {
            Image(systemName: systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsConfirmed)
                .accessibilityHidden(true)
        }
    }

    private var valueView: some View {
        Text(value)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.tsInk)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct LabValueDivider: View {
    var body: some View {
        Rectangle().fill(Color.tsLine).frame(height: 1).accessibilityHidden(true)
    }
}

private struct LabRunEmptyView: View {
    let isPending: Bool
    let replay: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(
                appLanguage.text("World ready, not yet run"),
                systemImage: "flask"
            )
            .font(.headline)
            .foregroundStyle(Color.tsInk)
            Text(
                appLanguage.text("Candidate and baseline will read the identical evidence snapshot.")
            )
            .font(.subheadline)
            .foregroundStyle(Color.tsMutedInk)
            Button(
                appLanguage.text("Run Candidate"),
                action: replay
            )
            .buttonStyle(LabPrimaryButtonStyle())
            .disabled(isPending)
        }
        .padding(17)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20).stroke(Color.tsLine, lineWidth: 1)
        }
    }
}

private struct LabRunExperience: View {
    let run: LabRun
    let openLens: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 13) {
                HStack {
                    LabLifecyclePill(lifecycle: run.output.lifecycle)
                    Spacer(minLength: 8)
                    Text(run.variant.rawValue)
                        .font(.caption.monospaced().weight(.semibold))
                        .foregroundStyle(Color.tsMutedInk)
                }
                Text(
                    appLanguage.text("What changed in this relationship?")
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
                Text(run.output.headline)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
                Text(run.output.interpretation)
                    .font(.body)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)

                if let uncertainty = run.output.uncertainty {
                    LabInlineNotice(
                        systemImage: "exclamationmark.triangle",
                        label: appLanguage.text("Uncertainty"),
                        value: uncertainty,
                        color: Color.tsWarning
                    )
                }
                if let question = run.output.requiredQuestion {
                    LabInlineNotice(
                        systemImage: "person.crop.circle.badge.questionmark",
                        label: appLanguage.text("Human decision required"),
                        value: question,
                        color: Color.tsVermilion
                    )
                }

                Button(action: openLens) {
                    Label(
                        appLanguage.text("Inspect why"),
                        systemImage: "magnifyingglass"
                    )
                }
                .buttonStyle(LabSecondaryButtonStyle())
                .accessibilityIdentifier("lab-open-signal-lens")

                Label(
                    appLanguage.text("Long-press this result to open Signal Lens"),
                    systemImage: "hand.tap"
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
            }
            .padding(17)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(Color.tsVermilion)
                    .frame(width: 2)
                    .padding(.vertical, 18)
                    .accessibilityHidden(true)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 20).stroke(Color.tsLine, lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 20))
            .onLongPressGesture(minimumDuration: 0.52, perform: openLens)
            .accessibilityAction(
                named: Text(appLanguage.text("Inspect why")),
                openLens
            )

            LabEvidenceSection(run: run)
            LabRunProvenance(run: run)
        }
    }
}

private struct LabInlineNotice: View {
    let systemImage: String
    let label: String
    let value: String
    let color: Color

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(label.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.7)
                    .foregroundStyle(color)
                Text(value)
                    .font(.subheadline)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }
}

private struct LabEvidenceSection: View {
    let run: LabRun
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(appLanguage.text("EVIDENCE STATE"))
                        .font(.caption2.weight(.bold))
                        .tracking(1)
                        .foregroundStyle(Color.tsVermilion)
                    Text(appLanguage.text("Observation before interpretation"))
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                }
                Spacer(minLength: 10)
                Text(verbatim: "\(run.output.evidence.count)")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(Color.tsMutedInk)
            }

            LabEvidenceCounts(summary: run.output.evidenceSummary)

            ForEach(run.output.evidence) { item in
                LabEvidenceRow(item: item)
            }
        }
        .padding(17)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20).stroke(Color.tsLine, lineWidth: 1)
        }
    }
}

private struct LabEvidenceCounts: View {
    let summary: LabEvidenceSummary
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 8) {
            GridRow {
                count(summary.confirmed, appLanguage.text("Confirmed"), "checkmark.circle")
                count(summary.observations, "Observation", "eye")
            }
            GridRow {
                count(summary.conflicts, appLanguage.text("Conflicts"), "arrow.triangle.branch")
                count(summary.unavailable, appLanguage.text("Unavailable"), "nosign")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func count(_ value: Int, _ label: String, _ image: String) -> some View {
        Label {
            Text(verbatim: "\(value) \(label)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsInk)
        } icon: {
            Image(systemName: image)
                .foregroundStyle(Color.tsMutedInk)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct LabEvidenceRow: View {
    let item: LabEvidenceItem
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(color)
                .frame(width: 21)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(item.label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                    Spacer(minLength: 8)
                    Text(statusLabel)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(color)
                }
                Text(item.excerpt)
                    .font(.subheadline)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
                Text(item.sourceLabel)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var icon: String {
        switch item.status {
        case .confirmed: "checkmark.circle"
        case .observation: "eye"
        case .conflict: "arrow.triangle.branch"
        case .unavailable: "nosign"
        }
    }

    private var color: Color {
        switch item.status {
        case .confirmed: .tsConfirmed
        case .observation: .tsInk
        case .conflict: .tsWarning
        case .unavailable: .tsVermilion
        }
    }

    private var statusLabel: String {
        switch item.status {
        case .confirmed: appLanguage.text("Confirmed")
        case .observation: "Observation"
        case .conflict: appLanguage.text("Conflict")
        case .unavailable: appLanguage.text("Unavailable")
        }
    }
}

private struct LabRunProvenance: View {
    let run: LabRun
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        DisclosureGroup {
            VStack(spacing: 0) {
                LabWorldValue(
                    label: appLanguage.text("Snapshot"),
                    value: String(run.snapshotHash.prefix(16))
                )
                LabValueDivider()
                LabWorldValue(
                    label: appLanguage.text("Runtime"),
                    value: "\(run.envelope.iosBuild) · \(run.envelope.backendRevision) · Agent \(run.envelope.agentVersion) · Prompt \(run.envelope.promptVersion)"
                )
                LabValueDivider()
                LabWorldValue(label: "Trace", value: String(run.traceID.prefix(16)))
                LabValueDivider()
                LabWorldValue(
                    label: appLanguage.text("Boundary"),
                    value: "r\(run.canonicalRevisionAfter) · 0 canonical · 0 external",
                    systemImage: "checkmark.shield"
                )
            }
            .padding(.top, 8)
        } label: {
            Label(
                appLanguage.text("Run provenance"),
                systemImage: "point.3.connected.trianglepath.dotted"
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.tsInk)
        }
        .padding(16)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18).stroke(Color.tsLine, lineWidth: 1)
        }
    }
}

private struct LabComparisonSection: View {
    let comparison: LabComparison
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                LabSectionHeading(
                    eyebrow: "COMPARE WITH BASELINE",
                    title: appLanguage.text("One snapshot, two product results"),
                    titleIdentifier: "lab-comparison-heading"
                )
                Spacer(minLength: 8)
                LabStatusPill(
                    systemImage: "checkmark.circle.fill",
                    label: appLanguage.text("Snapshot match"),
                    color: Color.tsConfirmed
                )
            }

            VStack(alignment: .leading, spacing: 12) {
                LabVersionLine(
                    label: "Baseline",
                    envelope: comparison.baselineRun.envelope
                )
                HStack(spacing: 8) {
                    Rectangle().fill(Color.tsLine).frame(height: 1)
                    Image(systemName: "arrow.down")
                        .foregroundStyle(Color.tsMutedInk)
                    Rectangle().fill(Color.tsLine).frame(height: 1)
                }
                .accessibilityHidden(true)
                LabVersionLine(
                    label: "Candidate",
                    envelope: comparison.candidateRun.envelope
                )
            }
            .padding(16)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
            .overlay {
                RoundedRectangle(cornerRadius: 20).stroke(Color.tsLine, lineWidth: 1)
            }

            ForEach(comparison.differences) { difference in
                LabDifferenceCard(difference: difference)
            }

            Label {
                Text(
                    String(
                        format: appLanguage.text("%1$lld improved · %2$lld regressed · %3$lld changed · zero effects"),
                        locale: appLanguage.locale,
                        comparison.improvedCount,
                        comparison.regressedCount,
                        comparison.changedCount
                    )
                )
                .font(.caption.weight(.semibold))
            } icon: {
                Image(systemName: "checkmark.shield")
                    .foregroundStyle(Color.tsConfirmed)
            }
            .foregroundStyle(Color.tsInk)
            .accessibilityElement(children: .combine)
        }
        .padding(18)
        .background(Color.tsSurfaceMuted, in: RoundedRectangle(cornerRadius: 24))
        .overlay {
            RoundedRectangle(cornerRadius: 24).stroke(Color.tsLine, lineWidth: 1)
        }
    }
}

private struct LabVersionLine: View {
    let label: String
    let envelope: LabVersionEnvelope

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption2.weight(.bold))
                .tracking(0.8)
                .foregroundStyle(Color.tsVermilion)
            Text(verbatim: "Agent \(envelope.agentVersion) / Prompt \(envelope.promptVersion)")
                .font(.headline)
                .foregroundStyle(Color.tsInk)
            Text(verbatim: "\(envelope.iosBuild) · \(envelope.backendRevision)")
                .font(.caption.monospaced())
                .foregroundStyle(Color.tsMutedInk)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct LabDifferenceCard: View {
    let difference: LabComparisonDifference
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Label(difference.label, systemImage: icon)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                Spacer(minLength: 8)
                Text(impactLabel)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(color)
            }
            LabDifferenceValue(label: "Baseline", value: difference.baseline)
            Rectangle().fill(Color.tsLine).frame(height: 1).accessibilityHidden(true)
            LabDifferenceValue(label: "Candidate", value: difference.candidate)
        }
        .padding(16)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18).stroke(color.opacity(0.35), lineWidth: 1)
        }
    }

    private var icon: String {
        switch difference.impact {
        case .improved: "arrow.up.right.circle"
        case .regressed: "exclamationmark.triangle"
        case .changed: "arrow.triangle.2.circlepath"
        case .unchanged: "equal.circle"
        }
    }

    private var color: Color {
        switch difference.impact {
        case .improved: .tsConfirmed
        case .regressed: .tsVermilion
        case .changed: .tsWarning
        case .unchanged: .tsMutedInk
        }
    }

    private var impactLabel: String {
        switch difference.impact {
        case .improved: appLanguage.text("Safer / clearer")
        case .regressed: appLanguage.text("Regressed")
        case .changed: appLanguage.text("Changed")
        case .unchanged: appLanguage.text("Unchanged")
        }
    }
}

private struct LabDifferenceValue: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.caption2.weight(.bold))
                .tracking(0.7)
                .foregroundStyle(Color.tsMutedInk)
            Text(value.isEmpty ? "—" : value)
                .font(.subheadline)
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct LabReceiptPrompt: View {
    let isPending: Bool
    let record: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(
                        appLanguage.text("Turn this observation into quality evidence")
                    )
                    .font(.headline)
                    Text(
                        appLanguage.text("Freeze the scenario, versions, Trace, and redacted surface snapshot.")
                    )
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                }
            } icon: {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.tsVermilion)
            }
            Button(action: record) {
                Label(
                    appLanguage.text("Record issue"),
                    systemImage: "doc.badge.plus"
                )
            }
            .buttonStyle(LabPrimaryButtonStyle())
            .disabled(isPending)
            .accessibilityIdentifier("lab-record-receipt")
        }
        .padding(18)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20).stroke(Color.tsLine, lineWidth: 1)
        }
    }
}

private struct LabRealityReceiptSection: View {
    let receipt: RealityReceipt
    let evalCase: LabEvalCase?
    let isPending: Bool
    let promote: () -> Void
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                LabSectionHeading(
                    eyebrow: "REALITY RECEIPT",
                    title: receipt.displayReference,
                    titleIdentifier: "lab-receipt-heading"
                )
                Spacer(minLength: 8)
                LabStatusPill(
                    systemImage: receipt.reproduced
                        ? "checkmark.circle.fill"
                        : "questionmark.circle",
                    label: receipt.reproduced
                        ? appLanguage.text("Reproduced")
                        : appLanguage.text("Needs verification"),
                    color: receipt.reproduced ? .tsConfirmed : .tsWarning
                )
            }

            VStack(spacing: 0) {
                LabReceiptValue(label: "Scenario", value: "\(receipt.scenarioID)@\(receipt.scenarioRevision)")
                LabValueDivider()
                LabReceiptValue(label: "Expected", value: receipt.expected)
                LabValueDivider()
                LabReceiptValue(label: "Actual", value: receipt.actual)
                LabValueDivider()
                LabReceiptValue(
                    label: appLanguage.text("Versions"),
                    value: "\(receipt.envelope.iosBuild) / \(receipt.envelope.backendRevision) / Agent \(receipt.envelope.agentVersion) / Prompt \(receipt.envelope.promptVersion) / \(receipt.envelope.policyVersion)"
                )
                LabValueDivider()
                LabReceiptValue(label: "Trace", value: receipt.traceID)
                LabValueDivider()
                LabReceiptValue(
                    label: appLanguage.text("Boundary"),
                    value: "r\(receipt.canonicalRevision) · Lab isolated · redacted"
                )
            }
            .padding(.horizontal, 16)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 20))
            .overlay {
                RoundedRectangle(cornerRadius: 20).stroke(Color.tsLine, lineWidth: 1)
            }

            if let evalCase {
                Label {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: "\(evalCase.caseReference) · Eval Case v\(evalCase.version)")
                            .font(.headline)
                            .foregroundStyle(Color.tsInk)
                        Text(appLanguage.text("human gold · dev partition · candidate release gate"))
                            .font(.caption)
                            .foregroundStyle(Color.tsMutedInk)
                    }
                } icon: {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Color.tsConfirmed)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.tsConfirmed.opacity(0.08), in: RoundedRectangle(cornerRadius: 18))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("lab-eval-promotion-success")
                .id(LabScrollTarget.evalCase)
            } else {
                VStack(alignment: .leading, spacing: 11) {
                    Text(appLanguage.text("Promote to Eval Case"))
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                    Text(
                        appLanguage.text("A human promotion turns this versioned scenario into a candidate-blocking release gate. It does not execute a product action.")
                    )
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                    Button(action: promote) {
                        Label(
                            appLanguage.text("Review and promote"),
                            systemImage: "checkmark.seal"
                        )
                    }
                    .buttonStyle(LabPrimaryButtonStyle())
                    .disabled(isPending)
                    .accessibilityIdentifier("lab-promote-receipt")
                }
            }
        }
        .padding(18)
        .background(Color.tsSurfaceMuted, in: RoundedRectangle(cornerRadius: 24))
        .overlay {
            RoundedRectangle(cornerRadius: 24).stroke(Color.tsLine, lineWidth: 1)
        }
    }
}

private struct LabReceiptValue: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption2.weight(.bold))
                .tracking(0.7)
                .foregroundStyle(Color.tsMutedInk)
            Text(value)
                .font(label == "Trace" ? .caption.monospaced() : .subheadline)
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct LabSectionHeading: View {
    let eyebrow: String
    let title: String
    var titleIdentifier: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(eyebrow)
                .font(.caption2.weight(.bold))
                .tracking(1)
                .foregroundStyle(Color.tsVermilion)
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
                .modifier(OptionalAccessibilityIdentifier(identifier: titleIdentifier))
        }
    }
}

private struct OptionalAccessibilityIdentifier: ViewModifier {
    let identifier: String?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let identifier {
            content.accessibilityIdentifier(identifier)
        } else {
            content
        }
    }
}

private struct LabStatusPill: View {
    let systemImage: String
    let label: String
    let color: Color

    var body: some View {
        Label(label, systemImage: systemImage)
            .font(.caption2.weight(.bold))
            .foregroundStyle(color)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(color.opacity(0.09), in: Capsule())
            .accessibilityElement(children: .combine)
    }
}

private struct LabLifecyclePill: View {
    let lifecycle: LabLifecycle
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        LabStatusPill(systemImage: icon, label: label, color: color)
    }

    private var icon: String {
        switch lifecycle {
        case .hypothesis: "lightbulb"
        case .abstained: "pause.circle"
        case .blocked: "hand.raised"
        case .unavailable: "nosign"
        case .needsReview: "eye"
        }
    }

    private var label: String {
        switch lifecycle {
        case .hypothesis: "Hypothesis"
        case .abstained: appLanguage.text("Abstained")
        case .blocked: appLanguage.text("Blocked")
        case .unavailable: appLanguage.text("Evidence unavailable")
        case .needsReview: appLanguage.text("Needs review")
        }
    }

    private var color: Color {
        switch lifecycle {
        case .hypothesis, .needsReview: .tsVermilion
        case .abstained, .blocked: .tsWarning
        case .unavailable: .tsMutedInk
        }
    }
}

private struct LabPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.tsCanvas)
            .padding(.horizontal, 15)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(
                configuration.isPressed
                    ? Color.tsInk.opacity(0.78)
                    : Color.tsInk,
                in: RoundedRectangle(cornerRadius: 14)
            )
            .contentShape(RoundedRectangle(cornerRadius: 14))
    }
}

private struct LabSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.tsInk)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(
                configuration.isPressed
                    ? Color.tsInk.opacity(0.08)
                    : Color.tsCanvas,
                in: RoundedRectangle(cornerRadius: 14)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 14).stroke(Color.tsLine, lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 14))
    }
}

@MainActor
private struct TalentSignalLensView: View {
    @ObservedObject var store: TalentSignalLabStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        NavigationStack {
            ScrollView {
                if let run = store.run {
                    VStack(alignment: .leading, spacing: 20) {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(appLanguage.text("SIGNAL LENS"))
                                .font(.caption.weight(.bold))
                                .tracking(1.2)
                                .foregroundStyle(Color.tsVermilion)
                            Text(run.output.headline)
                                .font(.custom("Georgia", size: 32, relativeTo: .title))
                                .foregroundStyle(Color.tsInk)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(
                                appLanguage.text("This explains inspectable product state, not hidden reasoning.")
                            )
                            .font(.subheadline)
                            .foregroundStyle(Color.tsMutedInk)
                        }

                        VStack(spacing: 0) {
                            LabLensStep(
                                index: 1,
                                label: appLanguage.text("Observation"),
                                value: run.output.observation,
                                emphasized: false
                            )
                            LabLensStep(
                                index: 2,
                                label: String(
                                    format: appLanguage.text("System interpretation · %@"),
                                    locale: appLanguage.locale,
                                    run.output.lifecycle.rawValue
                                ),
                                value: run.output.interpretation,
                                emphasized: true
                            )
                            LabLensStep(
                                index: 3,
                                label: appLanguage.text("Uncertainty"),
                                value: run.output.uncertainty ?? appLanguage.text("No additional uncertainty was recorded."),
                                emphasized: false
                            )
                            if let question = run.output.requiredQuestion {
                                LabLensStep(
                                    index: 4,
                                    label: appLanguage.text("Human decision required"),
                                    value: question,
                                    emphasized: false
                                )
                            }
                        }

                        LabEvidenceSection(run: run)
                        LabRunProvenance(run: run)

                        VStack(spacing: 10) {
                            Button {
                                Task { await store.replay() }
                            } label: {
                                Label(
                                    appLanguage.text("Replay this scenario"),
                                    systemImage: "arrow.counterclockwise"
                                )
                            }
                            .buttonStyle(LabSecondaryButtonStyle())
                            .disabled(store.pending != nil)

                            Button {
                                Task { await store.compare() }
                            } label: {
                                Label(
                                    appLanguage.text("Compare with baseline"),
                                    systemImage: "arrow.left.arrow.right"
                                )
                            }
                            .buttonStyle(LabSecondaryButtonStyle())
                            .disabled(store.pending != nil)
                            .accessibilityIdentifier("signal-lens-compare-baseline")

                            Button {
                                Task { await store.record() }
                            } label: {
                                Label(
                                    appLanguage.text("Record issue"),
                                    systemImage: "doc.badge.plus"
                                )
                            }
                            .buttonStyle(LabPrimaryButtonStyle())
                            .disabled(store.pending != nil || store.receipt != nil)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, 44)
                }
            }
            .scrollIndicators(.hidden)
            .background(Color.tsSurface.ignoresSafeArea())
            .navigationTitle(appLanguage.text("Why this appeared"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(appLanguage.text("Done")) {
                        dismiss()
                    }
                    .accessibilityIdentifier("signal-lens-done")
                }
            }
        }
        .tint(.tsVermilion)
    }
}

private struct LabLensStep: View {
    let index: Int
    let label: String
    let value: String
    let emphasized: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            VStack(spacing: 0) {
                ZStack {
                    Circle()
                        .fill(emphasized ? Color.tsVermilion : Color.tsInk)
                    Text(verbatim: "\(index)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color.tsCanvas)
                }
                .frame(width: 24, height: 24)
                Rectangle()
                    .fill(emphasized ? Color.tsVermilion : Color.tsLine)
                    .frame(width: emphasized ? 2 : 1, height: 64)
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(label.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.8)
                    .foregroundStyle(emphasized ? Color.tsVermilion : Color.tsMutedInk)
                Text(value)
                    .font(.body)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.bottom, 16)
        }
        .accessibilityElement(children: .combine)
    }
}
