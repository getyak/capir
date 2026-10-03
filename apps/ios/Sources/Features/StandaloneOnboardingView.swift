import AppIntents
import SwiftUI
import UIKit

struct StandaloneOnboardingView: View {
    private enum CaptureMode: String, CaseIterable, Identifiable {
        case voice = "Voice"
        case text = "Text"
        var id: String { rawValue }
    }

    private enum TodayDetail: String, Identifiable {
        case pursuit
        case source
        case signal
        case proposal
        var id: String { rawValue }
    }

    @StateObject private var store: StandaloneOnboardingStore
    @StateObject private var voiceService = StandaloneVoiceCaptureService()
    @StateObject private var captureHandoff = CaptureHandoffStore.shared
    @ObservedObject private var intentRouter = CaptureIntentRouter.shared
    @ObservedObject private var demoResets = LabResetStore.demo
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.talentSignalReduceMotion) private var reduceMotion
    @Environment(\.labReduceMotion) private var labReduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.appLanguage) private var appLanguage
    @FocusState private var signalTextFocused: Bool

    @State private var displayName = ""
    @State private var selectedTemplate = "Build a partnership"
    @State private var outcome = ""
    @State private var hasTargetDate = false
    @State private var targetDate = Date().addingTimeInterval(30 * 24 * 60 * 60)
    @State private var captureMode: CaptureMode = .text
    @State private var captureAuthorized = false
    @State private var todayDetail: TodayDetail?
    @State private var showsSettings = false
    @State private var showsDeleteImportedSourceConfirmation = false
    @State private var pendingSharedCaptureDeletion: SharedCaptureEnvelope?
    @State private var retainedSharedCaptures: [SharedCaptureEnvelope] = []
    @State private var sharedCaptureNotice: String?
    @State private var showsWelcomeQueuedShortcutDeletion = false
    @State private var showsSettingsQueuedShortcutDeletion = false
    @State private var editingFactID: UUID?
    @State private var factDraftValue = ""
    @State private var showsAdvancedReview = false
    @State private var expandedUnknownID: UUID?

    private let forceDemoEngine: Bool
    private let simulatesActionButton: Bool
    private let pendingShortcutFixtureID: UUID?
    private let clearsPendingShortcutFixtures: Bool
    private let initialURL: URL?
    private let labPreview: Bool

    init(
        arguments: [String] = ProcessInfo.processInfo.arguments,
        initialURL: URL? = nil,
        labPreview: Bool = false,
        labPreviewStartsInReview: Bool = false,
        labPreviewExpandedEvidence: Bool = false
    ) {
        self.labPreview = labPreview
        _showsAdvancedReview = State(initialValue: labPreview && labPreviewExpandedEvidence)
        let reset = arguments.contains("--standalone-onboarding-reset")
        _store = StateObject(wrappedValue: labPreview
            ? StandaloneOnboardingStore(persistence: LabOnboardingMemoryStore(startsInReview: labPreviewStartsInReview))
            : StandaloneOnboardingStore(reset: reset))
        _retainedSharedCaptures = State(
            initialValue: labPreview ? [] : (try? SharedCaptureInbox().retained()) ?? []
        )
        forceDemoEngine = arguments.contains("--demo-proposal-engine")
            || arguments.contains("--standalone-demo")
        simulatesActionButton = arguments.contains("--simulate-action-button")
            || arguments.contains("--standalone-demo")
#if DEBUG
        pendingShortcutFixtureID = Self.value(
            after: "--standalone-pending-shortcut-fixture",
            in: arguments
        ).flatMap(UUID.init(uuidString:))
        clearsPendingShortcutFixtures = arguments.contains(
            "--standalone-clear-pending-shortcut-fixtures"
        )
#else
        pendingShortcutFixtureID = nil
        clearsPendingShortcutFixtures = false
#endif
        self.initialURL = initialURL
    }

    private var usesAccessibilityLayout: Bool {
        dynamicTypeSize.isAccessibilitySize
            || UIApplication.shared.preferredContentSizeCategory.isAccessibilityCategory
    }

    var body: some View {
        ZStack {
            Color.tsCanvas.ignoresSafeArea()
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityLabel(localized("Standalone appearance"))
                .accessibilityValue(colorScheme == .dark ? "dark" : "light")
                .accessibilityIdentifier("standalone-appearance")
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityLabel(localized("Standalone content size"))
                .accessibilityValue(
                    usesAccessibilityLayout ? "accessibility" : "standard"
                )
                .accessibilityIdentifier("standalone-content-size")
            VStack(spacing: 0) {
                if store.state.route != .today {
                    progressHeader
                }
                ScrollView {
                    routeContent
                        .frame(maxWidth: 620, alignment: .leading)
                        .padding(.horizontal, 22)
                        .padding(
                            .top,
                            store.state.route == .today && usesAccessibilityLayout ? 12 : 24
                        )
                        .padding(.bottom, 40)
                }
                .id(store.state.route)
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .foregroundStyle(Color.tsInk)
        .tint(.tsVermilion)
        .animation(reduceMotion || labReduceMotion ? nil : .easeInOut(duration: 0.22), value: store.state.route)
        .onChange(of: voiceService.phase) { phase in
            switch phase {
            case .idle: break
            case .requestingPermission:
                store.updateCaptureState(.requestingPermission)
            case .recording:
                store.updateCaptureState(.recording)
                consumeLiveActivityStopRequestIfNeeded()
            case .transcribing:
                store.updateCaptureState(.transcribing)
            case let .ready(fileName):
                store.updateCaptureState(.readyToProcess, audioFileName: fileName)
            case let .failed(message):
                store.updateCaptureState(.failedRecoverable, error: message)
                captureMode = .text
            }
        }
        .onChange(of: captureHandoff.pendingSeed?.id) { _ in
            Task { await importPendingIntentCapture() }
        }
        .onChange(of: voiceService.elapsedSeconds) { _ in
            consumeLiveActivityStopRequestIfNeeded()
        }
        .onChange(of: store.state.route) { route in
            if route != .capture, voiceService.isRecording {
                voiceService.stopForInterruption()
            }
        }
        .onChange(of: store.state.pursuit?.id) { _ in
            guard !labPreview else { return }
            importNextSharedCapture()
            Task {
                await captureHandoff.restorePendingCapture()
                captureHandoff.resume()
                await importPendingIntentCapture()
            }
        }
        .onChange(of: intentRouter.request) { request in
            guard !labPreview else { return }
            guard let request else { return }
            if store.state.route == .actionButtonPractice,
               store.state.actionPracticeState == .practiceWindowOpened,
               request.destination == .hub {
                store.completePractice(simulated: false)
            } else {
                switch request.destination {
                case .hub:
                    captureMode = .text
                    store.requestSystemCapture(.text)
                case .foregroundAudio:
                    captureMode = .voice
                    store.requestSystemCapture(.voice)
                case .latestProposal:
                    store.showLatestProposal()
                case let .pursuit(id):
                    store.openPursuit(id: id)
                }
            }
            intentRouter.consume(request.id)
        }
        .onChange(of: scenePhase) { phase in
            guard !labPreview else { return }
            if phase == .active {
                importNextSharedCapture()
                consumeLiveActivityStopRequestIfNeeded()
                Task {
                    await captureHandoff.restorePendingCapture()
                    captureHandoff.resume()
                    await importPendingIntentCapture()
                    await voiceService.reconcileOrphanedLiveActivities()
                }
            } else if phase != .active, voiceService.isRecording {
                voiceService.stopForInterruption()
            }
        }
        .task {
            guard !labPreview else { return }
            await clearPendingShortcutFixturesIfNeeded()
            await seedPendingShortcutFixtureIfNeeded()
            importNextSharedCapture()
            await CaptureHandoffStore.shared.restorePendingCapture()
            captureHandoff.resume()
            await importPendingIntentCapture()
            await voiceService.reconcileOrphanedLiveActivities()
            if let initialURL { handleDeepLink(initialURL) }
        }
        .sheet(item: $todayDetail) { detail in
            todayDetailSheet(detail)
        }
        .sheet(isPresented: $showsSettings) {
            standaloneSettings
        }
        .alert(
            localized("Delete queued Shortcut capture?"),
            isPresented: $showsWelcomeQueuedShortcutDeletion
        ) {
            Button(localized("Cancel"), role: .cancel) {}
            Button(localized("Delete Queued Capture"), role: .destructive) {
                Task { await deletePendingShortcutCapture() }
            }
        } message: {
            Text(localized("This removes the protected screenshot waiting for a Pursuit. It does not delete the original image from Photos or Files."))
        }
        .onOpenURL { url in
            handleDeepLink(url)
        }
    }

    private var progressHeader: some View {
        HStack {
            TalentSignalBrandMark().frame(width: 28, height: 28)
            Text(localized("TALENT SIGNAL"))
                .font(.caption.weight(.bold))
                .tracking(1.4)
            Spacer()
        }
        .padding(.horizontal, 22)
        .padding(.top, 14)
        .padding(.bottom, 8)
        .background(Color.tsCanvas)
    }

    @ViewBuilder
    private var routeContent: some View {
        if labPreview {
            switch store.state.route {
            case .welcome: welcome
            case .proposalReview: proposalReview
            case .verifiedProgress: verifiedProgress
            default:
                VStack(alignment: .leading, spacing: 20) {
                    Text(localized("Onboarding preview complete"))
                        .font(.title2.weight(.semibold))
                    Text(localized("Only this isolated example changed. Your account, sources and system permissions are unchanged."))
                    Button(localized("Replay onboarding")) { store.replayOnboarding() }
                        .buttonStyle(TSPrimaryButtonStyle())
                }
            }
        } else {
        switch store.state.route {
        case .welcome: welcome
        case .identity: identity
        case .pursuit: pursuit
        case .productDemo: productDemo
        case .sourceChoice: sourceChoice
        case .calendarExplanation, .meetingSelection: sourceChoice
        case .capture: capture
        case .processing: processing
        case .proposalReview: proposalReview
        case .verifiedProgress: verifiedProgress
        case .actionButtonOffer: actionButtonOffer
        case .actionButtonPractice: actionButtonPractice
        case .today: today
        }
        }
    }

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 24) {
            Spacer(minLength: 38)
            Text(localized("START · 1 OF 3"))
                .font(.caption.weight(.bold))
                .tracking(1.4)
                .foregroundStyle(Color.tsVermilion)
            Text(localized("Turn one conversation into a next move you can trust."))
                .font(.system(.largeTitle, design: .serif, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
            Text(localized("Review a real example. Nothing becomes current or gets sent until you confirm."))
                .font(.title3)
                .foregroundStyle(Color.tsMutedInk)
            Button(localized("Try a 30-second example")) {
                store.startFirstProgressExample()
            }
                .buttonStyle(TSPrimaryButtonStyle())
                .accessibilityIdentifier("standalone-start-example")
            if !labPreview { Button(localized("Use my own Signal")) {
                store.startOwnSignalSetup()
            }
            .buttonStyle(TSSecondaryButtonStyle())
            .accessibilityIdentifier("standalone-use-own-signal")
            }
            trustNote("Nothing becomes current until you confirm. Nothing is sent.")
                .accessibilityIdentifier("standalone-trust-line")
            if !labPreview && (captureHandoff.savedSeed != nil || !retainedSharedCaptures.isEmpty || !demoResets.operations.isEmpty) {
                Button { openSettings() } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(localized(retainedSharedCaptures.isEmpty && captureHandoff.savedSeed == nil ? "Review Demo reset" : "Manage retained sources"))
                            .font(.body.weight(.semibold))
                        Text(localized(retainedSharedCaptures.isEmpty && captureHandoff.savedSeed == nil ? "Review saved reset results or start the example again." : "Review or delete imported Share and Shortcut evidence."))
                            .font(.footnote)
                            .foregroundStyle(Color.tsMutedInk)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(TSTextButtonStyle())
                .accessibilityIdentifier("standalone-manage-retained-sources")
            }
            if !labPreview && captureHandoff.savedSeed != nil {
                VStack(alignment: .leading, spacing: 8) {
                    Label(localized("Shortcut screenshot queued"), systemImage: "lock.doc")
                        .font(.body.weight(.semibold))
                    Text(localized("It remains protected on this device. Create a Pursuit to import it, or delete it now."))
                        .font(.footnote)
                        .foregroundStyle(Color.tsMutedInk)
                    Button(localized("Delete Queued Capture"), role: .destructive) {
                        showsWelcomeQueuedShortcutDeletion = true
                    }
                    .accessibilityIdentifier("standalone-delete-queued-shortcut-welcome")
                }
                .padding(14)
                .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 14))
                .overlay { RoundedRectangle(cornerRadius: 14).stroke(Color.tsLine) }
                .accessibilityIdentifier("standalone-queued-shortcut-source")
            }
        }
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: 22) {
            pageTitle("Your work stays yours", eyebrow: "LOCAL IDENTITY")
            Text(localized("A display name is enough to keep local decisions attributable. No email or contact import is required."))
                .foregroundStyle(Color.tsMutedInk)
            VStack(alignment: .leading, spacing: 8) {
                Text(localized("Display name")).font(.subheadline.weight(.semibold))
                TextField("Your name", text: $displayName)
                    .textContentType(.name)
                    .padding(14)
                    .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 14))
                    .overlay { RoundedRectangle(cornerRadius: 14).stroke(Color.tsLine) }
                    .accessibilityIdentifier("standalone-display-name")
            }
            trustNote("This local identity is not Sign in with Apple and never becomes candidate evidence.")
            Button(localized("Use This Local Identity")) {
                store.begin(displayName: displayName, demoAccount: false)
            }
            .buttonStyle(TSPrimaryButtonStyle())
            .accessibilityIdentifier("standalone-use-identity")
        }
    }

    private var pursuit: some View {
        VStack(alignment: .leading, spacing: 22) {
            pageTitle("What are you moving forward?", eyebrow: "PURSUIT")
            Text(localized("Start with the outcome. People and evidence can arrive later."))
                .foregroundStyle(Color.tsMutedInk)
            VStack(spacing: 10) {
                ForEach(["Build a partnership", "Win an opportunity", "Hire someone", "Something else"], id: \.self) { template in
                    choiceRow(
                        title: template,
                        detail: nil,
                        selected: selectedTemplate == template
                    ) {
                        selectedTemplate = template
                        if template == "Hire someone", outcome.isEmpty {
                            outcome = "Hire a VP of Engineering"
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(localized("Outcome")).font(.subheadline.weight(.semibold))
                TextField(localized("Prepare the next conversation"), text: $outcome, axis: .vertical)
                    .lineLimit(2 ... 4)
                    .padding(14)
                    .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 14))
                    .overlay { RoundedRectangle(cornerRadius: 14).stroke(Color.tsLine) }
                    .accessibilityIdentifier("standalone-pursuit-outcome")
                Toggle("Add a target date", isOn: $hasTargetDate)
                if hasTargetDate {
                    DatePicker("Target date", selection: $targetDate, displayedComponents: .date)
                }
            }
            notice
            Button(localized("Create This Pursuit")) {
                store.createPursuit(
                    template: selectedTemplate,
                    outcome: outcome,
                    targetDate: hasTargetDate ? targetDate : nil
                )
                Task { await importPendingIntentCapture() }
            }
            .buttonStyle(TSPrimaryButtonStyle())
            .accessibilityIdentifier("standalone-create-pursuit")
        }
        .onAppear {
            if let existing = store.state.pursuit {
                selectedTemplate = existing.template
                outcome = existing.outcome
                hasTargetDate = existing.targetDate != nil
                targetDate = existing.targetDate ?? targetDate
            }
        }
    }

    private var productDemo: some View {
        VStack(alignment: .leading, spacing: 22) {
            pageTitle("From conversation to a next move", eyebrow: "20-SECOND DEMO")
            demoBadge("SYNTHETIC · DOES NOT UPDATE YOUR PURSUIT")
            causalBlock(
                label: "SOURCE",
                icon: "calendar",
                title: "Candidate catch-up",
                body: "“Prefers remote; availability may be three weeks. Visa status is unclear.”"
            )
            Rectangle().fill(Color.tsVermilion).frame(width: 2, height: 28).padding(.leading, 21)
                .accessibilityHidden(true)
            causalBlock(
                label: "PROPOSAL",
                icon: "sparkles",
                title: "Record what is supported",
                body: "Remote preference is proposed as fact. Visa status stays unresolved. You can confirm, edit, or decline."
            )
            trustNote("A Proposal has no authority. Only your review can create verified progress.")
            Button(localized("Try It With My Signal")) { store.finishProductDemo() }
                .buttonStyle(TSPrimaryButtonStyle())
                .accessibilityIdentifier("standalone-finish-demo")
        }
    }

    private var sourceChoice: some View {
        VStack(alignment: .leading, spacing: 22) {
            pageTitle("Give capri one place to listen", eyebrow: "FIRST SOURCE")
            sourceChoiceButton(
                icon: "text.cursor",
                title: "Type a Signal",
                detail: "Start without any permission",
                badge: "Recommended"
            ) {
                captureMode = .text
                store.chooseSource(.text)
            }
            sourceChoiceButton(
                icon: "waveform",
                title: "Voice",
                detail: "Capture what you just learned",
                badge: nil
            ) {
                captureMode = .voice
                store.chooseSource(.voice)
            }
            Text(localized("Available now: Share Extension · Later: Contacts · Gmail"))
                .font(.footnote)
                .foregroundStyle(Color.tsMutedInk)
        }
    }

    private var capture: some View {
        VStack(alignment: .leading, spacing: 22) {
            pageTitle("What changed after this conversation?", eyebrow: "SIGNAL")
            sourceSummary
            Picker("Input mode", selection: $captureMode) {
                ForEach(CaptureMode.allCases) { mode in Text(mode.rawValue).tag(mode) }
            }
            .pickerStyle(.segmented)
            .disabled(voiceService.isRecording)
            if captureMode == .voice { voiceCapture } else { textCapture }
            notice
            Button(localized("Review the Signal")) {
                Task {
                    await store.process(
                        using: AdaptiveStandaloneProposalEngine(forceDemo: forceDemoEngine)
                    )
                }
            }
            .buttonStyle(TSPrimaryButtonStyle())
            .disabled(
                voiceService.isRecording
                    || store.state.captureDraft?.text
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                        .isEmpty != false
            )
            .accessibilityIdentifier("standalone-process-signal")
            Button(localized("Review Without AI")) {
                Task {
                    await store.process(using: ManualStandaloneProposalEngine())
                }
            }
            .buttonStyle(TSSecondaryButtonStyle())
            .disabled(
                voiceService.isRecording
                    || store.state.captureDraft?.text
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                        .isEmpty != false
            )
            .accessibilityIdentifier("standalone-review-without-ai")
            Text(localized("The Source and Draft are already saved locally. Either route creates a Proposal, not a fact; the manual route copies your exact Signal without model interpretation."))
                .font(.footnote)
                .foregroundStyle(Color.tsMutedInk)
        }
    }

    private var textCapture: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(localized(
                    store.state.captureDraft?.sharedPayloadKind == nil
                        ? "SIGNAL · EDITABLE"
                        : "WORKING SIGNAL · EDITABLE"
                ))
                .font(.caption.weight(.bold))
                .tracking(1)
                .foregroundStyle(Color.tsMutedInk)
                Spacer()
                if signalTextFocused {
                    Button(localized("Done")) { signalTextFocused = false }
                        .font(.body.weight(.semibold))
                        .accessibilityIdentifier("standalone-dismiss-signal-keyboard")
                }
            }
            TextEditor(
                text: Binding(
                    get: { store.state.captureDraft?.text ?? "" },
                    set: { store.updateDraftText($0) }
                )
            )
            .frame(minHeight: 170)
            .padding(10)
            .scrollContentBackground(.hidden)
            .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 16))
            .overlay { RoundedRectangle(cornerRadius: 16).stroke(Color.tsLine) }
            .accessibilityLabel(localized("Signal text"))
            .accessibilityIdentifier("standalone-signal-text")
            .focused($signalTextFocused)
            Button(localized("Use the showcase Signal")) {
                store.updateDraftText(StandaloneDemoProposalCatalog.showcaseSignal)
            }
            .buttonStyle(TSTextButtonStyle())
            .accessibilityIdentifier("standalone-use-example-signal")
        }
    }

    private var voiceCapture: some View {
        VStack(alignment: .leading, spacing: 14) {
            Toggle(
                "I have permission to capture this purpose-bound conversation",
                isOn: $captureAuthorized
            )
            .font(.subheadline)
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: voiceService.isRecording ? "waveform.circle.fill" : "mic.circle")
                        .font(.largeTitle)
                        .foregroundStyle(voiceService.isRecording ? Color.tsVermilion : Color.tsInk)
                    VStack(alignment: .leading) {
                        Text(voicePhaseTitle).font(.headline)
                        Text(timeLabel).font(.body.monospacedDigit()).foregroundStyle(Color.tsMutedInk)
                    }
                    Spacer()
                }
                if voiceService.isRecording {
                    HStack {
                        Button(localized("Stop")) {
                            Task { await finishVoiceRecording() }
                        }
                        .buttonStyle(TSPrimaryButtonStyle())
                        Button(localized("Cancel")) {
                            voiceService.cancel()
                            store.updateCaptureState(.cancelled)
                        }
                            .buttonStyle(TSSecondaryButtonStyle())
                    }
                } else {
                    Button(localized("Start Foreground Recording")) {
                        guard let draftID = store.state.captureDraft?.id else { return }
                        Task {
                            await voiceService.start(
                                draftID: draftID,
                                authorizationConfirmed: captureAuthorized
                            )
                        }
                    }
                    .buttonStyle(TSSecondaryButtonStyle())
                }
            }
            .tsCard()
            if !voiceService.transcript.isEmpty {
                Text(localized("ON-DEVICE TRANSCRIPT")).font(.caption.weight(.bold)).tracking(1)
                Text(voiceService.transcript)
                    .textSelection(.enabled)
                    .padding(14)
                    .background(Color.tsEvidence, in: RoundedRectangle(cornerRadius: 14))
            } else {
                Text(localized("On iOS 26+, SpeechAnalyzer progressively transcribes while the foreground recording is active. If live Speech is unavailable, the recording remains local and you can type the Signal without losing the Draft."))
                    .font(.footnote)
                    .foregroundStyle(Color.tsMutedInk)
            }
            textCapture
        }
    }

    private var processing: some View {
        VStack(alignment: .leading, spacing: 24) {
            pageTitle("Organizing the Signal", eyebrow: "PROPOSAL")
            ProgressView().controlSize(.large)
            Text(localized("Separating supported facts, inference, unknowns, and one possible next action."))
                .font(.title3)
            trustNote("Nothing is being sent and the Pursuit has not changed.")
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue("Processing a local Proposal")
    }

    private var proposalReview: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text(localized("Review · 2 of 3"))
                .font(.caption.weight(.bold))
                .tracking(1.4)
                .foregroundStyle(Color.tsVermilion)
            Text(localized("What changed?"))
                .font(.system(.largeTitle, design: .serif, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
            if let proposal = store.state.proposal {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(localized("SOURCE"))
                            .font(.caption.weight(.bold))
                            .tracking(1)
                            .foregroundStyle(Color.tsMutedInk)
                        Spacer()
                        Text(proposal.engineLabel.uppercased())
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.tsMutedInk)
                    }
                    if store.state.captureDraft?.sharedPayloadKind == nil {
                        Text("“\(store.state.captureDraft?.text ?? proposal.sourceSummary)”")
                            .font(.system(.title3, design: .serif, weight: .medium))
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    } else {
                        sharedProvenanceDetails
                        sharedImagePreview
                        if let workingSignal = store.state.captureDraft?.text,
                           !workingSignal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            provenanceText(
                                label: "WORKING SIGNAL USED FOR PROPOSAL",
                                value: workingSignal,
                                icon: "doc.text.magnifyingglass"
                            )
                        }
                    }
                    HStack(spacing: 6) {
                        Image(systemName: "scope")
                        Text(localized("Matched to") + " " + (store.state.pursuit?.outcome ?? localized("Unknown Pursuit")))
                        Spacer()
                        Button(localized("Change")) { store.markWrongPursuit() }
                            .font(.subheadline.weight(.semibold))
                    }
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                }

                VStack(spacing: 0) {
                    Circle().fill(Color.tsVermilion).frame(width: 8, height: 8)
                    Rectangle().fill(Color.tsVermilion).frame(width: 2, height: 34)
                }
                .frame(maxWidth: .infinity)
                .accessibilityHidden(true)

                if let fact = proposal.facts.first {
                    focusedFactReview(fact)
                } else {
                    emptyState(
                        title: "No supported fact was proposed",
                        body: "The Signal remains saved. Keep the uncertainty visible or return to edit the source."
                    )
                }

                if let unknown = proposal.unknowns.first {
                    Button {
                        expandedUnknownID = expandedUnknownID == unknown.id ? nil : unknown.id
                    } label: {
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Label(localized("Next:") + " " + unknown.question, systemImage: "questionmark.circle")
                                    .font(.subheadline.weight(.semibold))
                                Spacer()
                                Image(systemName: expandedUnknownID == unknown.id ? "chevron.up" : "chevron.down")
                            }
                            if expandedUnknownID == unknown.id {
                                Text(unknown.whyUnresolved)
                                    .font(.footnote)
                                    .foregroundStyle(Color.tsMutedInk)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .padding(16)
                    .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 16))
                    .overlay { RoundedRectangle(cornerRadius: 16).stroke(Color.tsLine) }
                }

                notice
                trustNote("Nothing becomes current until you confirm. Nothing is sent.")

                DisclosureGroup(
                    localized("Review inference and next action"),
                    isExpanded: $showsAdvancedReview
                ) {
                    VStack(alignment: .leading, spacing: 16) {
                        ForEach(proposal.inferences) { inference in
                            reviewSection("INFERENCE · NOT A FACT", icon: "lightbulb") {
                                Text(inference.statement).font(.headline)
                                Text(inference.basis).foregroundStyle(Color.tsMutedInk)
                            }
                        }
                        ForEach(proposal.nextActions) { action in actionReview(action) }
                        Button(localized("Discard Proposal")) { store.discardProposal() }
                            .buttonStyle(TSTextButtonStyle())
                        Text(proposal.modelDisclaimer)
                            .font(.footnote)
                            .foregroundStyle(Color.tsMutedInk)
                    }
                    .padding(.top, 14)
                }
                .font(.subheadline.weight(.semibold))
            }
        }
        .onChange(of: store.state.proposal?.id) { _ in
            editingFactID = nil
            factDraftValue = ""
            showsAdvancedReview = false
            expandedUnknownID = nil
        }
    }

    private var verifiedProgress: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text(localized("DONE · 3 OF 3"))
                .font(.caption.weight(.bold))
                .tracking(1.4)
                .foregroundStyle(Color.tsVermilion)
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 54))
                .foregroundStyle(Color.tsConfirmed)
            Text(localized("One fact is now current."))
                .font(.system(.largeTitle, design: .serif, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
            if let progress = store.state.progress {
                ForEach(progress.confirmedFacts) { fact in
                    summaryRow(label: fact.field, value: fact.proposedValue, icon: "checkmark")
                }
                ForEach(progress.acceptedActions) { action in
                    summaryRow(label: "Accepted next action", value: action.title, icon: "arrow.right")
                }
                ForEach(progress.unresolved) { unknown in
                    summaryRow(label: "Still unresolved", value: unknown.question, icon: "questionmark")
                }
                trustNote("Source: \(progress.sourceSummary). Your confirmation changed only local Pursuit state. Nothing was sent.")
            }
            Button(localized("See It in Today")) { store.enterToday() }
                .buttonStyle(TSPrimaryButtonStyle())
                .accessibilityIdentifier("standalone-see-today")
            Button(localized("Use my own Signal")) { store.startOwnSignalSetup() }
                .buttonStyle(TSSecondaryButtonStyle())
                .accessibilityIdentifier("standalone-use-own-signal-after-example")
        }
    }

    private var actionButtonOffer: some View {
        VStack(alignment: .leading, spacing: 22) {
            pageTitle("Capture the next Signal without leaving the moment", eyebrow: "APP SHORTCUT")
            Text(localized("Capture Signal and Record Signal are App Shortcuts. Review screenshot is an action for a personal two-action Shortcut. Only you can map a Shortcut to the Action Button in Settings."))
                .foregroundStyle(Color.tsMutedInk)
            ShortcutsLink()
                .shortcutsLinkStyle(.automaticOutline)
                .frame(maxWidth: .infinity, minHeight: 52)
                .accessibilityIdentifier("standalone-open-shortcuts")
            trustNote("The app cannot set or reliably read your Action Button mapping.")
            Button(localized("Practice Capture Signal")) { store.openPractice() }
                .buttonStyle(TSPrimaryButtonStyle())
                .accessibilityIdentifier("standalone-practice-capture")
            Button(localized("Do This Later")) { store.skipPractice() }
                .buttonStyle(TSSecondaryButtonStyle())
        }
    }

    private var actionButtonPractice: some View {
        VStack(alignment: .leading, spacing: 22) {
            pageTitle("Practice without changing your Pursuit", eyebrow: "PRACTICE SESSION")
            Text(localized("Invoke Capture Signal from the Action Button or Shortcuts now. During this practice window it records only a local practice event—no microphone, Proposal, or Pursuit write."))
                .foregroundStyle(Color.tsMutedInk)
            if [.intentReceivedInPractice, .simulated].contains(store.state.actionPracticeState) {
                summaryRow(
                    label: store.state.actionPracticeState == .simulated ? "Simulated Action Button" : "App Shortcut received",
                    value: "Action Button Ready",
                    icon: "checkmark.circle.fill"
                )
                Button(localized("Enter Today")) { store.enterToday() }
                    .buttonStyle(TSPrimaryButtonStyle())
                    .accessibilityIdentifier("standalone-enter-today")
            } else {
                ProgressView("Waiting for Capture Signal…")
#if DEBUG
                if simulatesActionButton {
                    Button(localized("Simulate Action Button")) { store.completePractice(simulated: true) }
                        .buttonStyle(TSPrimaryButtonStyle())
                        .accessibilityIdentifier("standalone-simulate-action-button")
                    demoBadge("SIMULATED · NOT A HARDWARE EVENT")
                }
#endif
                Button(localized("Skip Practice")) { store.skipPractice() }
                    .buttonStyle(TSSecondaryButtonStyle())
            }
        }
    }

    private var today: some View {
        VStack(alignment: .leading, spacing: usesAccessibilityLayout ? 16 : 22) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(localized("Today"))
                        .font(usesAccessibilityLayout ? .title2.bold() : .largeTitle.bold())
                    if !usesAccessibilityLayout {
                        Text(localized("One supported move, with its evidence still attached."))
                            .font(.body)
                        .foregroundStyle(Color.tsMutedInk)
                    }
                }
                Spacer()
                Button { openSettings() } label: {
                    Image(systemName: "gearshape")
                        .frame(width: 44, height: 44)
                        .background(Color.tsSurface, in: Circle())
                }
                .accessibilityLabel(localized("Settings"))
                .accessibilityIdentifier("standalone-open-settings")
            }
            if let pursuit = store.state.pursuit, let progress = store.state.progress {
                VStack(alignment: .leading, spacing: usesAccessibilityLayout ? 14 : 18) {
                    Text(pursuit.outcome)
                        .font(usesAccessibilityLayout ? .headline.bold() : .title2.bold())
                        .accessibilityIdentifier("standalone-today-primary-card")
                    Button { todayDetail = .source } label: {
                        if usesAccessibilityLayout {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(localized(sourceEvidenceLabel))
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Color.tsMutedInk)
                                Text(localized("Open the retained source and full provenance"))
                                    .font(.footnote.weight(.semibold))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color.tsEvidence, in: RoundedRectangle(cornerRadius: 14))
                        } else {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: "quote.opening")
                                    .frame(width: 26)
                                    .foregroundStyle(Color.tsConfirmed)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(localized(sourceEvidenceLabel))
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(Color.tsMutedInk)
                                    Text(progress.sourceSummary)
                                        .font(.body.weight(.semibold))
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(Color.tsMutedInk)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color.tsEvidence, in: RoundedRectangle(cornerRadius: 14))
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(localized("\(sourceEvidenceLabel), \(progress.sourceSummary)"))
                    .accessibilityHint(localized("Opens the retained source"))
                    .accessibilityIdentifier("standalone-today-evidence-link")
                    ForEach(progress.confirmedFacts.prefix(1)) { fact in
                        summaryRow(label: "Verified progress", value: fact.proposedValue, icon: "checkmark.seal")
                    }
                    ForEach(progress.unresolved.prefix(1)) { unknown in
                        summaryRow(label: "Unresolved", value: unknown.question, icon: "questionmark.circle")
                    }
                    if let action = progress.acceptedActions.first {
                        summaryRow(label: "Next action", value: action.title, icon: "arrow.right.circle")
                    }
                }
                .tsCard()
                LazyVGrid(
                    columns: Array(
                        repeating: GridItem(.flexible(), spacing: 10),
                        count: usesAccessibilityLayout ? 1 : 2
                    ),
                    spacing: 10
                ) {
                    todayLink("Pursuit", .pursuit)
                    todayLink("Source", .source)
                    todayLink("Signal", .signal)
                    todayLink("Proposal", .proposal)
                }
                capabilitySummary
            } else {
                emptyState(title: "No verified progress yet", body: "Replay onboarding to review one Signal and confirm a supported change.")
            }
        }
    }

    private var standaloneSettings: some View {
        NavigationView {
            Form {
                Section("Onboarding") {
                    Button(localized("Replay Onboarding")) {
                        store.replayOnboarding()
                        showsSettings = false
                    }
                    NavigationLink {
                        LabResetView(refreshWorkspace: nil, demoOnly: true, onboarding: store.resetPersistence)
                            .onDisappear { store.reloadAfterMaintenance() }
                    } label: {
                        Text(localized("Reset Demo Data"))
                    }
                    .accessibilityIdentifier("standalone-reset-demo-data")
                }
                Section(localized("Retained imported sources")) {
                    if captureHandoff.savedSeed != nil {
                        Button(role: .destructive) {
                            showsSettingsQueuedShortcutDeletion = true
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(localized("Delete queued Shortcut capture"))
                                Text(localized("Protected locally · not imported into a Pursuit"))
                                    .font(.caption)
                                    .foregroundStyle(Color.tsMutedInk)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .accessibilityIdentifier("standalone-delete-queued-shortcut-settings")
                    }
                    if retainedSharedCaptures.isEmpty {
                        Text(localized("No retained Share or Shortcut sources"))
                            .foregroundStyle(Color.tsMutedInk)
                            .accessibilityIdentifier("standalone-no-retained-sources")
                    } else {
                        ForEach(retainedSharedCaptures) { envelope in
                            Button(role: .destructive) {
                                pendingSharedCaptureDeletion = envelope
                                showsDeleteImportedSourceConfirmation = true
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(retainedSourceDeleteLabel(envelope.kind))
                                    Text(envelope.createdAt.formatted(date: .abbreviated, time: .shortened))
                                        .font(.caption)
                                        .foregroundStyle(Color.tsMutedInk)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .accessibilityIdentifier(
                                "standalone-delete-retained-source-\(envelope.id.uuidString.lowercased())"
                            )
                        }
                    }
                }
                Section("Boundary") {
                    Text(localized("Reset removes only standalone local onboarding records. It does not change Calendar permissions or user events."))
                    Text(localized("Imported and queued Share or Shortcut sources remain listed here after reset until you delete them individually."))
                }
            }
            .onAppear {
                refreshRetainedSharedCaptures()
            }
            .navigationTitle(localized("Settings"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(localized("Done")) { showsSettings = false }
                }
            }
            .alert(
                localized("Delete imported source?"),
                isPresented: $showsDeleteImportedSourceConfirmation
            ) {
                Button(localized("Cancel"), role: .cancel) {}
                Button(localized("Delete Source and Derived State"), role: .destructive) {
                    guard let envelope = pendingSharedCaptureDeletion else { return }
                    do {
                        let inbox = try SharedCaptureInbox()
                        store.deleteRetainedCapture(envelope.id, using: inbox)
                        refreshRetainedSharedCaptures()
                    } catch {
                        sharedCaptureNotice = "The imported source was not deleted: \(error.localizedDescription)"
                    }
                }
            } message: {
                Text(localized("This removes the retained Share or Shortcut item and the local Draft, Proposal, and verified progress derived from it. It does not delete the original item from the source app."))
            }
            .confirmationDialog(
                localized("Delete queued Shortcut capture?"),
                isPresented: $showsSettingsQueuedShortcutDeletion,
                titleVisibility: .visible
            ) {
                Button(localized("Delete Queued Capture"), role: .destructive) {
                    Task { await deletePendingShortcutCapture() }
                }
                Button(localized("Cancel"), role: .cancel) {}
            } message: {
                Text(localized("This removes the protected screenshot waiting for a Pursuit. It does not delete the original image from Photos or Files."))
            }
        }
    }

    @ViewBuilder
    private func todayDetailSheet(_ detail: TodayDetail) -> some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    switch detail {
                    case .pursuit:
                        pageTitle(store.state.pursuit?.outcome ?? "Pursuit", eyebrow: "PURSUIT")
                        Text(localized("Activation: \(store.state.activationStatus.rawValue)"))
                    case .source:
                        pageTitle(store.state.progress?.sourceSummary ?? "Source", eyebrow: "SOURCE")
                        if store.state.captureDraft?.sharedPayloadKind == nil {
                            Text(store.state.selectedMeeting?.isDemo == true ? "Demo Meeting" : "User-selected source")
                        } else {
                            sharedProvenanceDetails
                            sharedImagePreview
                        }
                    case .signal:
                        pageTitle("Captured Signal", eyebrow: "SIGNAL")
                        Text(store.state.captureDraft?.text ?? "Unavailable").textSelection(.enabled)
                    case .proposal:
                        pageTitle("Reviewed Proposal", eyebrow: store.state.proposal?.engineLabel.uppercased() ?? "PROPOSAL")
                        Text(localized("Facts, inferences, unknowns, and next action remain distinct in the saved review."))
                    }
                }
                .padding(22)
            }
            .background(Color.tsCanvas)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(localized("Done")) { todayDetail = nil } } }
        }
    }

    private var capabilitySummary: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(localized("CAPABILITIES")).font(.caption.weight(.bold)).tracking(1)
            capability("Calendar", value: calendarCapability)
            capability("Signal capture", value: store.state.captureDraft?.sourceKind == .voice ? "Voice used" : "Text ready")
            capability("Action Button", value: actionCapability)
        }
        .padding(.top, 8)
    }

    private var calendarCapability: String {
        if store.state.selectedMeeting?.isDemo == true {
            return "Demo meeting · not connected"
        }
        return "Outbound only · no calendar import"
    }

    private var sourceEvidenceLabel: String {
        store.state.selectedMeeting?.isDemo == true
            ? "DEMO SOURCE EVIDENCE"
            : "SOURCE EVIDENCE"
    }

    private var actionCapability: String {
        switch store.state.actionPracticeState {
        case .intentReceivedInPractice: return "Practiced on this device"
        case .simulated: return "Simulator practice only"
        case .skipped: return "Available later"
        default: return "Available in App Shortcuts"
        }
    }

    @ViewBuilder
    private var sourceSummary: some View {
        if let kind = store.state.captureDraft?.sharedPayloadKind {
            VStack(alignment: .leading, spacing: 12) {
                causalBlock(
                    label: "SHARE SHEET SOURCE",
                    icon: kind == .image ? "photo" : (kind == .url ? "link" : "text.quote"),
                    title: "Shared \(kind.rawValue.capitalized)",
                    body: "Imported through the App Group inbox · original source retained locally"
                )
                sharedProvenanceDetails
                sharedImagePreview
            }
        } else if let meeting = store.state.selectedMeeting {
            causalBlock(
                label: meeting.isDemo ? "DEMO MEETING" : "CALENDAR MEETING",
                icon: "calendar",
                title: meeting.title,
                body: "\(StandaloneOnboardingDate.short.string(from: meeting.startsAt)) · \(meeting.calendarTitle)"
            )
        } else {
            causalBlock(
                label: "LOCAL DRAFT",
                icon: store.state.selectedSource == .voice ? "waveform" : "text.cursor",
                title: store.state.selectedSource == .voice ? "Voice Signal" : "Typed Signal",
                body: "Draft \(store.state.captureDraft?.id.uuidString.prefix(8) ?? "pending") · saved before permission or processing"
            )
        }
    }

    @ViewBuilder
    private var sharedProvenanceDetails: some View {
        if let sourceText = store.state.captureDraft?.sharedSourceText,
           !sourceText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            provenanceText(
                label: store.state.captureDraft?.sharedPayloadKind == .image
                    ? "EXTRACTED SOURCE TEXT · VERIFY AGAINST IMAGE"
                    : "SHARED SOURCE TEXT",
                value: sourceText,
                icon: "doc.text"
            )
        }
        if let recruiterNote = store.state.captureDraft?.sharedRecruiterNote,
           !recruiterNote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            provenanceText(
                label: "RECRUITER NOTE",
                value: recruiterNote,
                icon: "pencil.line"
            )
        }
        if let sourceURL = store.state.captureDraft?.sharedSourceURL {
            provenanceText(
                label: "SHARED URL",
                value: sourceURL.absoluteString,
                icon: "link"
            )
        }
    }

    private func provenanceText(label: String, value: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(localized(label), systemImage: icon)
                .font(.caption.weight(.bold))
                .tracking(0.8)
                .foregroundStyle(Color.tsMutedInk)
            Text(value)
                .font(.body)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 14))
        .overlay { RoundedRectangle(cornerRadius: 14).stroke(Color.tsLine) }
    }

    private var voicePhaseTitle: String {
        switch voiceService.phase {
        case .idle: return "Ready when you are"
        case .requestingPermission: return "Requesting microphone permission"
        case .recording: return "Recording locally"
        case .transcribing: return "Transcribing on device"
        case .ready: return "Local recording saved"
        case .failed: return "Use typed input"
        }
    }

    private var timeLabel: String {
        String(format: "%02d:%02d", voiceService.elapsedSeconds / 60, voiceService.elapsedSeconds % 60)
    }

    @ViewBuilder
    private var notice: some View {
        if let message = store.state.lastRecoverableError ?? store.persistenceNotice ?? sharedCaptureNotice {
            Label(message, systemImage: "info.circle")
                .font(.footnote)
                .foregroundStyle(Color.tsWarning)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var sharedImagePreview: some View {
        if let fileName = store.state.captureDraft?.sharedPayloadFileName,
           let inbox = try? SharedCaptureInbox(),
           let url = inbox.payloadURL(fileName: fileName),
           let image = UIImage(contentsOfFile: url.path) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxHeight: 220)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .accessibilityLabel(localized("Shared image retained as source evidence"))
                .accessibilityValue(localized(
                    store.state.captureDraft?.sharedSourceText
                        ?? "No text equivalent was extracted. Do not confirm image-based facts without inspecting the retained source."
                ))
        }
    }

    private func importNextSharedCapture() {
        guard !labPreview else { return }
        do {
            let inbox = try SharedCaptureInbox()
            try store.reconcileSharedCaptureTransactions(using: inbox)
            for envelope in try inbox.pending() {
                if store.state.importedSharedEnvelopeIDs.contains(envelope.id) {
                    try inbox.markImported(envelope.id)
                    continue
                }
                guard store.importSharedCapture(envelope) else { return }
                try inbox.markImported(envelope.id)
                sharedCaptureNotice = nil
                return
            }
        } catch SharedCaptureInboxError.appGroupUnavailable {
            sharedCaptureNotice = nil
        } catch {
            sharedCaptureNotice = "A shared item is still safely queued and will retry: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func importPendingIntentCapture() async {
        guard !labPreview else { return }
        guard let seed = captureHandoff.pendingSeed else { return }
        guard store.state.pursuit != nil else {
            sharedCaptureNotice = "A Shortcut screenshot is safely queued. Create a Pursuit before importing it."
            return
        }
        do {
            let inbox = try SharedCaptureInbox()
            try store.reconcileSharedCaptureTransactions(using: inbox)
            let envelope = try StandaloneShortcutCaptureBridge.stage(seed, in: inbox)
            if !store.state.importedSharedEnvelopeIDs.contains(envelope.id) {
                guard store.importSharedCapture(envelope) else { return }
            }
            try inbox.markImported(envelope.id)
            try await PendingCaptureInbox.shared.remove(id: seed.id)
            await captureHandoff.advanceToNextCapture()
            captureHandoff.resume()
            sharedCaptureNotice = nil
        } catch {
            sharedCaptureNotice = "The Shortcut screenshot remains queued and will retry: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func deletePendingShortcutCapture() async {
        guard let seed = captureHandoff.savedSeed else { return }
        do {
            try await PendingCaptureInbox.shared.remove(id: seed.id)
            await captureHandoff.advanceToNextCapture()
            captureHandoff.resume()
            sharedCaptureNotice = captureHandoff.savedSeed == nil
                ? nil
                : localized("Another Shortcut screenshot remains safely queued.")
        } catch {
            sharedCaptureNotice = "The queued Shortcut screenshot was not deleted: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func seedPendingShortcutFixtureIfNeeded() async {
#if DEBUG
        guard let pendingShortcutFixtureID else { return }
        do {
            let data = Data(
                "synthetic-pending-shortcut-\(pendingShortcutFixtureID.uuidString)".utf8
            )
            let seed = try await PendingCaptureInbox.shared.stage(
                imageData: data,
                fileName: "synthetic-pending-shortcut.png",
                mediaType: "image/png",
                origin: .appShortcut
            )
            captureHandoff.present(seed)
        } catch {
            sharedCaptureNotice = "The synthetic queued Shortcut fixture could not be prepared: \(error.localizedDescription)"
        }
#endif
    }

    @MainActor
    private func clearPendingShortcutFixturesIfNeeded() async {
#if DEBUG
        guard clearsPendingShortcutFixtures else { return }
        do {
            try await PendingCaptureInbox.shared.removeAllForTesting()
            await captureHandoff.advanceToNextCapture()
        } catch {
            sharedCaptureNotice = "The synthetic Shortcut fixture queue could not be cleared: \(error.localizedDescription)"
        }
#endif
    }

    private func finishVoiceRecording() async {
        if let transcript = await voiceService.stopAndTranscribe() {
            store.updateDraftText(transcript)
        }
    }

    private func consumeLiveActivityStopRequestIfNeeded() {
        guard voiceService.isRecording,
              let draftID = store.state.captureDraft?.id else { return }
        do {
            guard try LiveActivityStopRequestBridge.consume(
                draftID: draftID,
                recordingStartedAt: voiceService.recordingStartedAt
            ) else { return }
            Task { await finishVoiceRecording() }
        } catch {
            sharedCaptureNotice = "The lock-screen Stop request could not be read. Recording remains under foreground control: \(error.localizedDescription)"
        }
    }

    private func openSettings() {
        refreshRetainedSharedCaptures()
        showsSettings = true
    }

    private func refreshRetainedSharedCaptures() {
        do {
            let inbox = try SharedCaptureInbox()
            try store.reconcileSharedCaptureTransactions(using: inbox)
            retainedSharedCaptures = try inbox.retained()
        } catch SharedCaptureInboxError.appGroupUnavailable {
            retainedSharedCaptures = []
        } catch {
            sharedCaptureNotice = "Retained imported sources could not be inventoried: \(error.localizedDescription)"
        }
    }

    private func retainedSourceDeleteLabel(_ kind: SharedCapturePayloadKind) -> String {
        switch kind {
        case .image: return localized("Delete retained image source")
        case .text: return localized("Delete retained text source")
        case .url: return localized("Delete retained URL source")
        }
    }

    private static func value(after flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag),
              arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    private func handleDeepLink(_ url: URL) {
        guard !labPreview else { return }
        guard url.scheme == "talentsignal", url.host == "standalone" else { return }
        if url.path == "/proposal" { store.showLatestProposal() }
        if url.path == "/share" { importNextSharedCapture() }
    }

    private func pageTitle(_ title: String, eyebrow: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(eyebrow).font(.caption.weight(.bold)).tracking(1.4).foregroundStyle(Color.tsVermilion)
            Text(title).font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func demoBadge(_ text: String) -> some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .tracking(0.8)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(Color.tsWarning.opacity(0.12), in: Capsule())
            .overlay { Capsule().stroke(Color.tsWarning.opacity(0.35)) }
            .accessibilityLabel(text)
    }

    private func trustNote(_ text: String) -> some View {
        Label(text, systemImage: "lock.shield")
            .font(.footnote)
            .foregroundStyle(Color.tsMutedInk)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func causalBlock(label: String, icon: String, title: String, body: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.headline)
                .frame(width: 44, height: 44)
                .background(Color.tsSurfaceMuted, in: Circle())
            VStack(alignment: .leading, spacing: 6) {
                Text(label).font(.caption.weight(.bold)).tracking(1).foregroundStyle(Color.tsMutedInk)
                Text(title).font(.headline)
                Text(body).font(.subheadline).foregroundStyle(Color.tsMutedInk)
            }
        }
        .tsCard()
    }

    private func choiceRow(title: String, detail: String?, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(selected ? Color.tsConfirmed : Color.tsMutedInk)
                VStack(alignment: .leading) {
                    Text(title).font(.headline)
                    if let detail { Text(detail).font(.caption).foregroundStyle(Color.tsMutedInk) }
                }
                Spacer()
            }
            .padding(15)
            .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).stroke(selected ? Color.tsInk : Color.tsLine) }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func sourceChoiceButton(icon: String, title: String, detail: String, badge: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.title3).frame(width: 44, height: 44).background(Color.tsSurfaceMuted, in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    HStack { Text(title).font(.headline); if let badge { demoBadge(badge.uppercased()) } }
                    Text(detail).font(.subheadline).foregroundStyle(Color.tsMutedInk)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Color.tsMutedInk)
            }
            .padding(16)
            .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 18))
            .overlay { RoundedRectangle(cornerRadius: 18).stroke(Color.tsLine) }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("standalone-source-\(title.lowercased().replacingOccurrences(of: " ", with: "-"))")
    }

    private func permissionLine(_ text: String, icon: String) -> some View {
        Label(text, systemImage: icon).font(.subheadline)
    }

    private func meetingButton(_ meeting: StandaloneMeeting) -> some View {
        Button { store.chooseMeeting(meeting) } label: {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: meeting.isDemo ? "calendar.badge.plus" : "calendar")
                    .frame(width: 44, height: 44).background(Color.tsSurfaceMuted, in: Circle())
                VStack(alignment: .leading, spacing: 5) {
                    HStack { Text(meeting.title).font(.headline); if meeting.isDemo { demoBadge("DEMO MEETING") } }
                    Text(StandaloneOnboardingDate.short.string(from: meeting.startsAt)).font(.subheadline).foregroundStyle(Color.tsMutedInk)
                    Text(meeting.calendarTitle).font(.caption).foregroundStyle(Color.tsMutedInk)
                }
                Spacer()
            }
            .padding(16)
            .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 18))
            .overlay { RoundedRectangle(cornerRadius: 18).stroke(Color.tsLine) }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(meeting.isDemo ? "standalone-use-demo-meeting" : "standalone-meeting-\(meeting.id)")
    }

    private func emptyState(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            Text(body).font(.subheadline).foregroundStyle(Color.tsMutedInk)
        }
        .tsCard()
    }

    private func reviewSection<Content: View>(_ label: String, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(label, systemImage: icon).font(.caption.weight(.bold)).tracking(0.8).foregroundStyle(Color.tsMutedInk)
            content()
        }
        .tsCard()
    }

    private func focusedFactReview(_ fact: StandaloneProposalFact) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                Text(localized("PROPOSED FACT"))
                    .font(.caption.weight(.bold))
                    .tracking(1)
                    .foregroundStyle(Color.tsVermilion)
                Spacer()
                Text(fact.confidenceBand)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsMutedInk)
            }
            Text(fact.field)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)

            if editingFactID == fact.id {
                TextField("Proposed value", text: $factDraftValue, axis: .vertical)
                    .font(.title3.weight(.semibold))
                    .lineLimit(2 ... 5)
                    .padding(13)
                    .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 12))
                    .overlay { RoundedRectangle(cornerRadius: 12).stroke(Color.tsInk) }
                    .accessibilityIdentifier("standalone-focused-fact-editor")
                HStack {
                    Button(localized("Save edit")) {
                        store.editFact(fact.id, value: factDraftValue)
                        editingFactID = nil
                    }
                    .buttonStyle(TSPrimaryButtonStyle())
                    .accessibilityIdentifier("standalone-save-fact-edit")
                    Button(localized("Cancel")) {
                        editingFactID = nil
                        factDraftValue = ""
                    }
                    .buttonStyle(TSSecondaryButtonStyle())
                }
            } else {
                Text(currentFactValue(fact))
                    .font(.title3.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: 10) {
                    Button(localized("Confirm")) {
                        store.selectFact(fact.id, selected: true)
                        store.confirm()
                    }
                    .buttonStyle(TSPrimaryButtonStyle())
                    .accessibilityIdentifier("standalone-focused-confirm")
                    Button(localized("Edit")) {
                        factDraftValue = currentFactValue(fact)
                        editingFactID = fact.id
                    }
                    .buttonStyle(TSSecondaryButtonStyle())
                    .accessibilityIdentifier("standalone-focused-edit")
                    Button(localized("Keep unresolved")) {
                        store.keepUnresolvedOnly()
                    }
                    .buttonStyle(TSSecondaryButtonStyle())
                    .accessibilityIdentifier("standalone-focused-unresolved")
                }
            }
        }
        .padding(18)
        .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.tsLine, lineWidth: 1.5)
        }
    }

    private func currentFactValue(_ fact: StandaloneProposalFact) -> String {
        store.state.proposal?.facts.first(where: { $0.id == fact.id })?.proposedValue
            ?? fact.proposedValue
    }

    private func factReview(_ fact: StandaloneProposalFact) -> some View {
        reviewSection("FACT FROM THE CONVERSATION", icon: "quote.bubble") {
            Toggle(
                "Confirm this sourced change",
                isOn: Binding(
                    get: { store.state.selectedFactIDs.contains(fact.id) },
                    set: { store.selectFact(fact.id, selected: $0) }
                )
            )
            .font(.subheadline.weight(.semibold))
            Text(fact.field).font(.caption).foregroundStyle(Color.tsMutedInk)
            TextField(
                "Proposed value",
                text: Binding(
                    get: { store.state.proposal?.facts.first(where: { $0.id == fact.id })?.proposedValue ?? fact.proposedValue },
                    set: { store.editFact(fact.id, value: $0) }
                ),
                axis: .vertical
            )
            .font(.headline)
            Text(localized("“\(fact.evidenceExcerpt)”"))
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
                .textSelection(.enabled)
            Text(fact.confidenceBand).font(.caption).foregroundStyle(Color.tsMutedInk)
        }
    }

    private func actionReview(_ action: StandaloneProposalAction) -> some View {
        reviewSection("PROPOSED NEXT ACTION", icon: "arrow.right.circle") {
            Toggle(
                "Accept this internal next action",
                isOn: Binding(
                    get: { store.state.acceptedActionIDs.contains(action.id) },
                    set: { store.acceptAction(action.id, accepted: $0) }
                )
            )
            .font(.subheadline.weight(.semibold))
            Text(action.title).font(.headline)
            Text(action.rationale).font(.subheadline).foregroundStyle(Color.tsMutedInk)
        }
    }

    private func summaryRow(label: String, value: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).frame(width: 26).foregroundStyle(Color.tsConfirmed)
            VStack(alignment: .leading, spacing: 3) {
                Text(label).font(.caption.weight(.semibold)).foregroundStyle(Color.tsMutedInk)
                Text(value).font(.body.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }

    private func todayLink(_ title: String, _ detail: TodayDetail) -> some View {
        Button { todayDetail = detail } label: {
            Label(title, systemImage: todayLinkIcon(detail))
                .frame(maxWidth: .infinity)
        }
            .buttonStyle(TSSecondaryButtonStyle())
    }

    private func todayLinkIcon(_ detail: TodayDetail) -> String {
        switch detail {
        case .pursuit: return "scope"
        case .source: return "quote.opening"
        case .signal: return "waveform"
        case .proposal: return "doc.text.magnifyingglass"
        }
    }

    private func capability(_ label: String, value: String) -> some View {
        HStack { Text(label).foregroundStyle(Color.tsMutedInk); Spacer(); Text(value).fontWeight(.semibold) }
            .font(.subheadline)
    }

    private func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    private func localized(_ key: String) -> String {
        appLanguage.text(key)
    }
}
