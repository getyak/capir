import CoreTransferable
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct SelectedConversationImage: Transferable, Equatable {
    let data: Data

    init(importedData: Data) throws {
        guard !importedData.isEmpty, UIImage(data: importedData) != nil else {
            throw SelectedConversationImageError.unreadableImage
        }
        data = importedData
    }

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(importedContentType: .image) { data in
            try SelectedConversationImage(importedData: data)
        }
    }
}

enum SelectedConversationImageError: LocalizedError, Equatable {
    case unreadableImage

    var errorDescription: String? {
        "The selected item is not a readable image. No review state changed."
    }
}

enum CandidateSignalEntryMode {
    case workbench
    case conversationImage
}

@MainActor
struct CandidateSignalView: View {
    @StateObject private var store: CandidateSignalStore
    @StateObject private var captureHandoff = CaptureHandoffStore.shared
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var importedImage: UIImage?
    @State private var photoImportTask: Task<Void, Never>?
    @State private var localhostExpanded = false
    @State private var showingTextSignal = false
    @State private var showingPhotoPicker = false
    @State private var didRequestInitialPhotoPicker = false
    @State private var pendingTextSignal: TextSignalOutboxRecord?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.appLanguage) private var appLanguage
    private let onClose: (() -> Void)?
    private let onContinueInAgent: ((RelationshipCaptureCompletion) -> Void)?
    private let showsFixtureTools: Bool
    private let authenticatedBackendURL: URL?
    private let authenticatedAccessToken: String?
    private let authenticatedWorkspaceID: String?
    private let runtimeScope: String?
    private let entryMode: CandidateSignalEntryMode

    init(
        backendURL: URL? = nil,
        accessToken: String? = nil,
        workspaceID: String? = nil,
        runtimeScope: String? = nil,
        entryMode: CandidateSignalEntryMode = .workbench,
        onClose: (() -> Void)? = nil,
        onContinueInAgent: ((RelationshipCaptureCompletion) -> Void)? = nil
    ) {
        _store = StateObject(wrappedValue: CandidateSignalStore())
        self.onClose = onClose
        self.onContinueInAgent = onContinueInAgent
        authenticatedBackendURL = backendURL
        authenticatedAccessToken = accessToken
        authenticatedWorkspaceID = workspaceID
        self.runtimeScope = runtimeScope
        self.entryMode = entryMode
        showsFixtureTools = TalentSignalRootRoute.opensReviewWorkbench(
            arguments: ProcessInfo.processInfo.arguments
        )
    }

    init(store: CandidateSignalStore, onClose: (() -> Void)? = nil) {
        _store = StateObject(wrappedValue: store)
        self.onClose = onClose
        onContinueInAgent = nil
        authenticatedBackendURL = nil
        authenticatedAccessToken = nil
        authenticatedWorkspaceID = nil
        runtimeScope = nil
        entryMode = .workbench
        showsFixtureTools = true
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.tsCanvas.ignoresSafeArea()
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 24) {
                            Group {
                                if case .idle = store.stage, !showsFixtureTools {
                                    if entryMode == .conversationImage {
                                        conversationImageHeader
                                    } else {
                                        captureHeader
                                    }
                                } else {
                                    BrandHeader()
                                }
                            }
                            .id("screen-top")

                            switch store.stage {
                            case .idle:
                                if entryMode == .conversationImage {
                                    conversationImageIdleContent
                                } else {
                                    idleContent
                                }
                            case let .importing(kind):
                                importingContent(kind)
                            case let .importCancelled(kind):
                                cancelledContent(kind)
                            case let .importFailed(failure):
                                failedContent(failure)
                            case .reviewingUnboundImage:
                                unboundImageContent
                            case .reviewingFixture:
                                fixtureReviewContent
                            case .actionPreview:
                                actionPreviewContent
                            case let .outcome(outcome):
                                outcomeContent(outcome)
                            }

                            PrivacyBoundaryNote()
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 14)
                        .padding(.bottom, 40)
                    }
                    .clipped()
                    .accessibilityIdentifier("capture-review-scroll")
#if DEBUG
                    .overlay {
                        if ProcessInfo.processInfo.environment["TS_IOS_UI_TEST_DISPLAY_PROBE"] == "true" {
                            GeometryReader { geometry in
                                let frame = geometry.frame(in: .global)
                                Color.clear.frame(width: 1, height: 1)
                                    .accessibilityElement()
                                    .accessibilityIdentifier("review-visible-viewport")
                                    .accessibilityValue("\(frame.minX)|\(frame.minY)|\(frame.width)|\(frame.height)")
                            }
                            .allowsHitTesting(false)
                        }
                    }
#endif
                    .onChange(of: store.stage) { _ in
                        Task { @MainActor in
                            proxy.scrollTo("screen-top", anchor: .top)
                        }
                    }
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                Color.tsCanvas
                    .frame(height: 1)
                    .background(Color.tsCanvas.ignoresSafeArea(edges: .top))
                    .accessibilityHidden(true)
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let onClose {
                HStack {
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Color.tsInk)
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Close capture workbench")
                    Spacer()
                    Text("Capture")
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                    Spacer()
                    Color.clear.frame(width: 44, height: 44)
                }
                .padding(.horizontal, 12)
                .background(Color.tsCanvas)
            } else {
                Color.tsCanvas
                    .frame(height: 8)
                    .accessibilityHidden(true)
            }
        }
        .tint(.tsVermilion)
        .onChange(of: selectedPhoto) { item in
            loadSelectedPhoto(item)
        }
        .photosPicker(
            isPresented: $showingPhotoPicker,
            selection: $selectedPhoto,
            matching: .images
        )
        .onDisappear {
            photoImportTask?.cancel()
        }
        .task {
            await refreshPendingTextSignal()
            requestInitialPhotoPickerIfNeeded()
        }
        .sheet(isPresented: $showingTextSignal) {
            TextSignalCaptureView(
                backendURL: effectiveBackendURL,
                accessToken: authenticatedAccessToken,
                workspaceID: authenticatedWorkspaceID,
                    runtimeScope: runtimeScope,
                initialRecord: pendingTextSignal
            ) {
                Task { await refreshPendingTextSignal() }
            }
        }
        .fullScreenCover(item: $captureHandoff.pendingSeed) { seed in
            RelationshipCaptureView(
                seed: seed,
                backendURL: effectiveBackendURL,
                accessToken: authenticatedAccessToken,
                workspaceID: authenticatedWorkspaceID,
                    runtimeScope: runtimeScope,
                initialDraft: captureHandoff.initialDraft
            ) { disposition in
                selectedPhoto = nil
                switch disposition {
                case .keepForLater:
                    captureHandoff.keepForLater()
                case .discard, .finished:
                    Task {
                        await captureHandoff.advanceToNextCapture()
                    }
                case let .continueInAgent(completion):
                    Task {
                        await captureHandoff.advanceToNextCapture()
                        onContinueInAgent?(completion)
                    }
                }
            }
        }
        .labDiagnosticPresentation()
    }

    private var effectiveBackendURL: URL {
        authenticatedBackendURL
            ?? URL(string: store.backendAddress)
            ?? URL(string: "http://127.0.0.1:4317")!
    }

    private var captureHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Remember a moment")
                .foregroundStyle(Color.tsVermilion)
            Text("Bring one source into review.")
                .font(.custom("Georgia", size: 36, relativeTo: .largeTitle))
                .foregroundStyle(Color.tsInk)
                .tracking(-0.8)
                .fixedSize(horizontal: false, vertical: true)
            Text("Choose only the conversation evidence you intend to use. You will review text, identity, and relationship scope before anything becomes current state.")
                .font(.body)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("capture-entry-header")
    }

    private var conversationImageHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: appLanguage.text("Conversation screenshot"))
                .foregroundStyle(Color.tsVermilion)
            Text(appLanguage.text("Choose one conversation image"))
                .font(.custom("Georgia", size: 36, relativeTo: .largeTitle))
                .foregroundStyle(Color.tsInk)
                .tracking(-0.8)
                .fixedSize(horizontal: false, vertical: true)
            Text(
                appLanguage.text(
                    "Selection starts an Agent Session. It processes the screenshot in the background and asks only when a decision is required."
                )
            )
            .font(.body)
            .foregroundStyle(Color.tsMutedInk)
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("capture-entry-header")
    }

    private var conversationImageIdleContent: some View {
        VStack(alignment: .leading, spacing: 22) {
            Button {
                showingPhotoPicker = true
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: "photo.badge.plus")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Color.tsVermilion)
                        .frame(width: 30, height: 44)
                    Text(appLanguage.text("Open Photos"))
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsMutedInk)
                }
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .overlay(alignment: .top) {
                Rectangle().fill(Color.tsLine).frame(height: 1)
            }
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.tsLine).frame(height: 1)
            }
            .accessibilityIdentifier("choose-image")
            .accessibilityHint(
                appLanguage.text(
                    "Opens the system photo picker, then starts an Agent Session."
                )
            )

            Text(
                appLanguage.text(
                    "The original image stays on this device in the current slice. No contact, message, meeting, ATS, CRM, or reminder is written from selection alone."
                )
            )
            .font(.caption)
            .foregroundStyle(Color.tsMutedInk)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func requestInitialPhotoPickerIfNeeded() {
        guard entryMode == .conversationImage,
              !didRequestInitialPhotoPicker,
              captureHandoff.savedSeed == nil,
              captureHandoff.pendingSeed == nil,
              case .idle = store.stage else {
            return
        }
        didRequestInitialPhotoPicker = true
        Task { @MainActor in
            await Task.yield()
            showingPhotoPicker = true
        }
    }

    private var idleContent: some View {
        VStack(alignment: .leading, spacing: 20) {
            if showsFixtureTools {
                SourceNotice(text: store.sourceNotice)
            }

            VStack(alignment: .leading, spacing: 14) {
                SectionLabel(text: pendingTextSignal == nil ? "Fastest safe capture" : "Recoverable text Signal")
                Text(pendingTextSignal == nil ? "Write one exact Signal" : "Continue the saved Signal")
                    .font(.headline)
                    .foregroundStyle(Color.tsInk)
                Text(
                    pendingTextSignal == nil
                        ? "Text is durably saved before sync. You choose Pursuit, Person role, and speaker; no model or external write runs here."
                        : "The protected local command still owns its original Signal ID and retry history."
                )
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
                Button(pendingTextSignal == nil ? "Write text Signal" : "Resume text Signal") {
                    showingTextSignal = true
                }
                .buttonStyle(TSPrimaryButtonStyle())
                .accessibilityIdentifier(
                    pendingTextSignal == nil
                        ? "write-text-signal"
                        : "resume-text-signal"
                )
            }
            .tsCard()

            if let savedSeed = captureHandoff.savedSeed,
               captureHandoff.pendingSeed == nil {
                VStack(alignment: .leading, spacing: 14) {
                    SectionLabel(text: "Pending review")
                    Text("Continue \(savedSeed.fileName)")
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                    Text("The screenshot and your reviewed draft remain on this device. No person was changed.")
                        .font(.subheadline)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Resume capture review") {
                        captureHandoff.resume()
                    }
                    .buttonStyle(TSPrimaryButtonStyle())
                    .accessibilityIdentifier("resume-capture-review")
                }
                .tsCard()
            }

            VStack(alignment: .leading, spacing: 16) {
                SectionLabel(text: "Device-owned source")

                PhotosPicker(selection: $selectedPhoto, matching: .images) {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Choose one conversation image")
                                .font(.headline)
                                .foregroundStyle(Color.tsInk)
                            Text("Review on-device text, compare identity evidence, then attach it to one relationship Wiki.")
                                .font(.subheadline)
                                .foregroundStyle(Color.tsMutedInk)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    } icon: {
                        Image(systemName: "photo.badge.plus")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Color.tsVermilion)
                    }
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("choose-image")
                .accessibilityHint("Opens the system photo picker, then starts text and identity review.")

                Text("The original image stays on this device in the current slice. No contact, message, meeting, ATS, CRM, or reminder is written from selection alone.")
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .tsCard()

            if showsFixtureTools {
                VStack(alignment: .leading, spacing: 16) {
                    SectionLabel(text: "Deterministic review fixtures")

                    if let fixtureSuite = store.suite {
                        Picker("Fixture case", selection: $store.selectedFixtureID) {
                            ForEach(fixtureSuite.cases) { fixture in
                                Text("\(fixture.id) · \(fixture.title)")
                                    .tag(fixture.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .accessibilityIdentifier("fixture-picker")

                        Text("Fixture data is synthetic and intentionally selected. It is never inferred from the image above.")
                            .font(.subheadline)
                            .foregroundStyle(Color.tsMutedInk)
                            .fixedSize(horizontal: false, vertical: true)

                        Button {
                            store.beginFixtureImport()
                        } label: {
                            Label("Open selected synthetic case", systemImage: "doc.text.magnifyingglass")
                        }
                        .buttonStyle(TSPrimaryButtonStyle())
                        .accessibilityIdentifier("open-fixture")
                    } else {
                        Text("Evaluation cases are unavailable in this build. Device-owned capture and live review remain available.")
                            .font(.subheadline)
                            .foregroundStyle(Color.tsMutedInk)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("fixture-corpus-unavailable")
                    }
                }
                .tsCard()
                .accessibilityIdentifier("fixture-review-tools")

                DisclosureGroup(isExpanded: $localhostExpanded) {
                    VStack(alignment: .leading, spacing: 14) {
                        TextField("http://127.0.0.1:8787/fixtures.json", text: $store.localhostAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityLabel("Local fixture server address")
                            .accessibilityIdentifier("localhost-address")

                        Text("Read-only sync accepts only localhost or loopback addresses and requires the same eight-case fixture contract.")
                            .font(.subheadline)
                            .foregroundStyle(Color.tsMutedInk)
                            .fixedSize(horizontal: false, vertical: true)

                        Button("Sync and open selected case") {
                            store.syncFromLocalhost()
                        }
                        .buttonStyle(TSSecondaryButtonStyle())
                        .accessibilityIdentifier("sync-localhost")
                    }
                    .padding(.top, 14)
                } label: {
                    Label("Configure localhost fixture sync", systemImage: "network")
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                }
                .tsCard()
            }
        }
    }

    private func importingContent(_ kind: ImportKind) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            SectionLabel(text: "Importing")
                .accessibilityIdentifier("importing-state")
            ProgressView()
                .controlSize(.large)
                .accessibilityLabel(kind.title)
            Text(kind.title)
                .font(.title2.weight(.semibold))
                .foregroundStyle(Color.tsInk)
            Text("No fact or action is available until this step finishes. Cancelling leaves candidate state unchanged.")
                .font(.body)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)

            Button("Cancel import") {
                photoImportTask?.cancel()
                store.cancelImport()
            }
            .buttonStyle(TSSecondaryButtonStyle())
            .accessibilityIdentifier("cancel-import")
        }
        .tsCard()
    }

    private func cancelledContent(_ kind: ImportKind) -> some View {
        StateMessage(
            eyebrow: "Import cancelled",
            icon: "xmark.circle",
            title: "\(kind.title) was cancelled",
            detail: "No evidence was interpreted, no fact was proposed, and no external record changed."
        ) {
            Button("Return to import") {
                clearImageAndReset()
            }
            .buttonStyle(TSPrimaryButtonStyle())
            .accessibilityIdentifier("cancelled-recovery")
        }
    }

    private func failedContent(_ failure: ImportFailure) -> some View {
        StateMessage(
            eyebrow: "Import failed",
            icon: "exclamationmark.triangle",
            title: "Nothing was changed",
            detail: failure.message
        ) {
            VStack(alignment: .leading, spacing: 12) {
                if store.suite == nil {
                    Text("The synthetic evaluation corpus is not bundled in this build.")
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("fixture-corpus-unavailable")
                }
                if failure.kind == .localhost || failure.kind == .backend {
                    Button(
                        failure.kind == .backend
                            ? "Retry canonical state read"
                            : "Retry localhost sync"
                    ) {
                        store.retryImport()
                    }
                    .buttonStyle(TSPrimaryButtonStyle())
                    .accessibilityIdentifier("retry-import")
                }

                Button("Return to import") {
                    clearImageAndReset()
                }
                .buttonStyle(TSSecondaryButtonStyle())
                .accessibilityIdentifier("failed-recovery")
            }
        }
    }

    private var unboundImageContent: some View {
        VStack(alignment: .leading, spacing: 20) {
            SourceNotice(text: store.sourceNotice)

            if let importedImage {
                Image(uiImage: importedImage)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 260)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .accessibilityLabel("The user-selected, unbound image")
            } else {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.tsSurfaceMuted)
                    .frame(height: 180)
                    .overlay {
                        Image(systemName: "photo")
                            .font(.largeTitle)
                            .foregroundStyle(Color.tsMutedInk)
                    }
                    .accessibilityLabel("Simulated user-selected, unbound image")
            }

            StateMessage(
                eyebrow: "Unbound evidence",
                icon: "link.badge.plus",
                title: "Unrelated image selected",
                detail: "No fixture facts are shown. This prototype does not OCR, identify a person, or bind arbitrary images to a candidate."
            ) {
                Button("Remove image and return") {
                    clearImageAndReset()
                }
                .buttonStyle(TSPrimaryButtonStyle())
            }
        }
    }

    @ViewBuilder
    private var fixtureReviewContent: some View {
        if let session = store.session {
            FixtureReviewView(
                session: session,
                sourceNotice: store.sourceNotice,
                dynamicTypeSize: dynamicTypeSize,
                onConfirm: { _ = store.confirmFact(id: $0) },
                onEdit: { _ = store.editFact(id: $0, value: $1) },
                onDismiss: { _ = store.dismissFact(id: $0) },
                onPreviewAction: { _ = store.showActionPreview() },
                onFinishWithoutAction: store.finishWithoutAction,
                onCancelReview: clearImageAndReset
            )
        } else {
            StateMessage(
                eyebrow: "Review unavailable",
                icon: "exclamationmark.triangle",
                title: "No fixture is open",
                detail: "Return to import and intentionally choose a synthetic case."
            ) {
                Button("Return to import", action: clearImageAndReset)
                    .buttonStyle(TSPrimaryButtonStyle())
            }
        }
    }

    @ViewBuilder
    private var actionPreviewContent: some View {
        if let session = store.session {
            ActionPreviewView(
                session: session,
                sourceNotice: store.sourceNotice,
                dynamicTypeSize: dynamicTypeSize,
                onApproveAction: { _ = store.approveAction(id: $0) },
                onDismissAction: { _ = store.dismissAction(id: $0) },
                onReturnToReview: store.returnToReview,
                onCompleteHandoff: store.completeLocalHandoff
            )
        }
    }

    private func outcomeContent(_ outcome: ReviewOutcome) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            if let insight = store.session?.momentumInsight {
                MomentumInsightView(
                    insight: insight,
                    eyebrow: "Confirmed-context insight"
                )
            }

            StateMessage(
                eyebrow: "Outcome",
                icon: outcome.kind == .refused ? "hand.raised" : "checkmark.circle",
                title: outcome.title,
                detail: outcome.detail
            ) {
                VStack(alignment: .leading, spacing: 14) {
                    Label("No external changes", systemImage: "lock.shield")
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                        .accessibilityIdentifier("no-external-changes")

                    Button("Review another synthetic case") {
                        clearImageAndReset()
                    }
                    .buttonStyle(TSPrimaryButtonStyle())
                    .accessibilityIdentifier("review-another")
                }
            }
        }
    }

    private func loadSelectedPhoto(_ item: PhotosPickerItem?) {
        photoImportTask?.cancel()
        guard let item else { return }

        store.beginSelectedImageImport()
        photoImportTask = Task {
            do {
                guard let imported = try await item.loadTransferable(
                    type: SelectedConversationImage.self
                ) else {
                    store.failSelectedImageImport(
                        message: "The selected item did not provide image data. No review state changed."
                    )
                    return
                }
                try Task.checkCancellation()
                let contentType = item.supportedContentTypes.first ?? .image
                let mediaType = contentType.preferredMIMEType ?? "image/*"
                let fileExtension = contentType.preferredFilenameExtension ?? "image"
                let seed = try await PendingCaptureInbox.shared.stage(
                    imageData: imported.data,
                    fileName: "conversation-\(Int(Date().timeIntervalSince1970)).\(fileExtension)",
                    mediaType: mediaType,
                    origin: .photosPicker
                )
                try Task.checkCancellation()
                if let runtimeScope { try await PendingCaptureInbox.shared.claim(id: seed.id, scope: runtimeScope) }
                try Task.checkCancellation()
                store.reset()
                if entryMode == .conversationImage {
                    captureHandoff.enqueueForAgentProcessing(
                        seed,
                        expectedScope: runtimeScope
                    )
                    onClose?()
                } else {
                    captureHandoff.present(seed, expectedScope: runtimeScope)
                }
            } catch is CancellationError {
                return
            } catch {
                store.failSelectedImageImport(
                    message: "The selected image could not be imported. No review state changed."
                )
            }
        }
    }

    private func clearImageAndReset() {
        photoImportTask?.cancel()
        photoImportTask = nil
        importedImage = nil
        selectedPhoto = nil
        store.reset()
    }

    private func refreshPendingTextSignal() async {
        let baseURL = effectiveBackendURL
        do {
            let catalog = try await URLTextSignalSyncClient(baseURL: baseURL, accessToken: authenticatedAccessToken,
                workspaceID: authenticatedWorkspaceID).loadScopes()
            pendingTextSignal = try await TextSignalOutbox.scoped(runtimeScope, backendURL: baseURL,
                workspaceID: catalog.workspaceID).oldest(
                workspaceID: catalog.workspaceID
            )
        } catch {
            pendingTextSignal = nil
        }
    }
}

#Preview("Idle") {
    CandidateSignalView(
        store: CandidateSignalStore(
            importDelayNanoseconds: 0,
            launchConfiguration: AppLaunchConfiguration(scenario: .idle, endpoint: nil)
        )
    )
}

#Preview("TS-CORE-01 review") {
    CandidateSignalView(
        store: CandidateSignalStore(
            importDelayNanoseconds: 0,
            launchConfiguration: AppLaunchConfiguration(
                scenario: .fixture("TS-CORE-01"),
                endpoint: nil
            )
        )
    )
}

#Preview("Import failure") {
    CandidateSignalView(
        store: CandidateSignalStore(
            importDelayNanoseconds: 0,
            launchConfiguration: AppLaunchConfiguration(
                scenario: .importFailed,
                endpoint: nil
            )
        )
    )
}
