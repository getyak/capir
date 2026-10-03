import Foundation

enum ImportKind: Equatable {
    case fixture(String)
    case selectedImage
    case localhost
    case backend

    var title: String {
        switch self {
        case .fixture:
            return "Opening synthetic fixture"
        case .selectedImage:
            return "Reading selected image"
        case .localhost:
            return "Syncing localhost fixtures"
        case .backend:
            return "Reading canonical localhost state"
        }
    }
}

struct ImportFailure: Equatable {
    let kind: ImportKind
    let message: String
}

enum OutcomeKind: Equatable {
    case localHandoff
    case noAction
    case clarification
    case refused
    case noRetainedFacts
}

struct ReviewOutcome: Equatable {
    let kind: OutcomeKind
    let title: String
    let detail: String
}

enum SignalFlowStage: Equatable {
    case idle
    case importing(ImportKind)
    case importCancelled(ImportKind)
    case importFailed(ImportFailure)
    case reviewingFixture
    case reviewingUnboundImage
    case actionPreview
    case outcome(ReviewOutcome)
}

@MainActor
final class CandidateSignalStore: ObservableObject {
    @Published private(set) var stage: SignalFlowStage = .idle
    @Published private(set) var suite: FixtureSuite?
    @Published private(set) var session: ReviewSession?
    @Published var selectedFixtureID = "TS-CORE-01"
    @Published var localhostAddress = "http://127.0.0.1:8787/candidate-momentum-v1.json"
    @Published var backendAddress = "http://127.0.0.1:4317"
    @Published private(set) var sourceNotice: String
    @Published private(set) var backendSnapshot: BackendWorkspaceSnapshot?

    private let resourceSuite: FixtureSuite?
    private let loader: FixtureLoading
    private let backendLoader: BackendWorkspaceLoading
    private let importDelayNanoseconds: UInt64
    private var importTask: Task<Void, Never>?

    init(
        loader: FixtureLoading = URLFixtureLoader(),
        backendLoader: BackendWorkspaceLoading = URLBackendWorkspaceLoader(),
        importDelayNanoseconds: UInt64? = nil,
        fixtureSuite: FixtureSuite? = FixtureCatalog.loadResourceSuite(),
        launchConfiguration: AppLaunchConfiguration = .current
    ) {
        self.loader = loader
        self.backendLoader = backendLoader
        self.importDelayNanoseconds = importDelayNanoseconds
            ?? Self.configuredImportDelayNanoseconds()
        // Explicit injection supports isolated unit cases; an empty injected
        // suite still means unavailable. Production resources are validated.
        let availableSuite: FixtureSuite? = fixtureSuite.flatMap { $0.cases.isEmpty ? nil : $0 }
        resourceSuite = availableSuite
        suite = availableSuite
        sourceNotice = Self.resourceNotice(for: availableSuite)
        apply(launchConfiguration)
    }

    static func resourceNotice(for fixtureSuite: FixtureSuite?) -> String {
        guard let fixtureSuite else {
            return "Evaluation corpus unavailable · no synthetic fixture cases in this build"
        }
        return "Bundled synthetic suite · \(fixtureSuite.cases.count) cases · \(fixtureSuite.version)"
    }

    /// False when the optional evaluation corpus is not part of this build.
    var fixtureCorpusAvailable: Bool {
        suite != nil
    }

    deinit {
        importTask?.cancel()
    }

    func beginFixtureImport() {
        let fixtureID = selectedFixtureID
        guard let suite else {
            stage = .importFailed(
                ImportFailure(
                    kind: .fixture(fixtureID),
                    message: StoreError.fixtureCorpusUnavailable.localizedDescription
                )
            )
            return
        }
        start(kind: .fixture(fixtureID)) { [weak self] in
            guard let self else { return }
            try await Task.sleep(nanoseconds: importDelayNanoseconds)
            try Task.checkCancellation()
            guard let fixture = FixtureCatalog.fixture(id: fixtureID, in: suite) else {
                throw StoreError.fixtureMissing
            }
            open(fixture)
        }
    }

    func beginHeroLoop(recruiterContext: String) {
        let fixture = HeroLoopCatalog.alexDecision(
            recruiterContext: recruiterContext
        )
        start(kind: .fixture(fixture.id)) { [weak self] in
            guard let self else { return }
            try await Task.sleep(nanoseconds: min(importDelayNanoseconds, 450_000_000))
            try Task.checkCancellation()
            sourceNotice = "Synthetic hero conversation · optional recruiter context · no OCR"
            selectedFixtureID = fixture.id
            open(fixture)
        }
    }

    func beginSelectedImageImport() {
        cancelCurrentTask()
        session = nil
        stage = .importing(.selectedImage)
    }

    func finishSelectedImageImport() {
        guard stage == .importing(.selectedImage) else { return }
        session = nil
        sourceNotice = "User-selected image · unbound · no extraction performed"
        stage = .reviewingUnboundImage
    }

    func failSelectedImageImport(message: String) {
        guard stage == .importing(.selectedImage) else { return }
        session = nil
        stage = .importFailed(
            ImportFailure(kind: .selectedImage, message: message)
        )
    }

    func syncFromLocalhost() {
        guard let url = URL(string: localhostAddress) else {
            stage = .importFailed(
                ImportFailure(
                    kind: .localhost,
                    message: FixtureSyncError.invalidAddress.localizedDescription
                )
            )
            return
        }

        start(kind: .localhost) { [weak self] in
            guard let self else { return }
            let loadedSuite = try await loader.load(from: url)
            try Task.checkCancellation()
            suite = loadedSuite
            sourceNotice = "Read-only localhost sync · \(loadedSuite.cases.count) synthetic cases · \(loadedSuite.version)"
            guard let fixture = FixtureCatalog.fixture(id: selectedFixtureID, in: loadedSuite)
                ?? loadedSuite.cases.first else {
                throw StoreError.fixtureMissing
            }
            selectedFixtureID = fixture.id
            open(fixture)
        }
    }

    func syncFromBackend() {
        guard let url = URL(string: backendAddress) else {
            stage = .importFailed(
                ImportFailure(
                    kind: .backend,
                    message: FixtureSyncError.invalidAddress.localizedDescription
                )
            )
            return
        }

        start(kind: .backend) { [weak self] in
            guard let self else { return }
            let snapshot = try await backendLoader.loadWorkspace(
                from: url,
                fixtureCaseID: "TS-CORE-01"
            )
            try Task.checkCancellation()
            let fixture = try snapshot.fixtureCase()
            backendSnapshot = snapshot
            selectedFixtureID = fixture.id
            sourceNotice = [
                "Localhost canonical state",
                snapshot.accountSlug,
                "account \(snapshot.accountID.prefix(8))",
                "state \(snapshot.confirmedState.id.prefix(8))",
                "v\(snapshot.confirmedState.version)"
            ].joined(separator: " · ")
            open(fixture, snapshot: snapshot)
        }
    }

    func cancelImport() {
        guard case let .importing(kind) = stage else { return }
        cancelCurrentTask()
        session = nil
        stage = .importCancelled(kind)
    }

    func retryImport() {
        guard case let .importFailed(failure) = stage else { return }
        switch failure.kind {
        case let .fixture(id):
            selectedFixtureID = id
            beginFixtureImport()
        case .selectedImage:
            reset()
        case .localhost:
            syncFromLocalhost()
        case .backend:
            syncFromBackend()
        }
    }

    func confirmFact(id: String) -> Bool {
        mutateSession { $0.confirm(factID: id) }
    }

    func editFact(id: String, value: String) -> Bool {
        mutateSession { $0.edit(factID: id, value: value) }
    }

    func dismissFact(id: String) -> Bool {
        mutateSession { $0.dismiss(factID: id) }
    }

    func approveAction(id: String) -> Bool {
        mutateSession { $0.approveAction(cardID: id) }
    }

    func dismissAction(id: String) -> Bool {
        mutateSession { $0.dismissAction(cardID: id) }
    }

    func showActionPreview() -> Bool {
        guard var updated = session, updated.makeActionPreview() != nil else {
            return false
        }
        session = updated
        stage = .actionPreview
        return true
    }

    func returnToReview() {
        guard session != nil else { return }
        stage = .reviewingFixture
    }

    func completeLocalHandoff() {
        guard let session, session.isPreviewCurrent else { return }
        if let preview = session.preview,
           !preview.cards.isEmpty,
           !session.allActionCardsReviewed {
            return
        }
        let approvedCount = session.approvedActionCards.count
        stage = .outcome(
            ReviewOutcome(
                kind: .localHandoff,
                title: approvedCount > 0
                    ? "Insight and approved actions are ready"
                    : "Local handoff is ready",
                detail: approvedCount > 0
                    ? "\(approvedCount) approved action card\(approvedCount == 1 ? "" : "s") and the reviewed insight remain local. No message, meeting, contact, ATS record, or reminder was created."
                    : "The reviewed context remains in this demo. No message, meeting, contact, ATS record, or reminder was created."
            )
        )
    }

    func finishWithoutAction() {
        guard let session else { return }

        let outcome: ReviewOutcome
        switch session.fixture.expected.disposition {
        case .noAction:
            outcome = ReviewOutcome(
                kind: .noAction,
                title: "No action is the result",
                detail: "The evidence is preserved for this local review without manufacturing urgency or a follow-up task."
            )
        case .clarify:
            outcome = ReviewOutcome(
                kind: .clarification,
                title: "Clarification is required",
                detail: "Identity, date, or timezone remains unresolved. No candidate fact was persisted and no action was created."
            )
        case .block:
            outcome = ReviewOutcome(
                kind: .refused,
                title: "Candidate scoring was refused",
                detail: "Response speed, tone, and shared interests are not evidence for culture fit, candidate quality, or acceptance likelihood."
            )
        case .proposeAction:
            outcome = ReviewOutcome(
                kind: .noRetainedFacts,
                title: "No reviewed fact remains",
                detail: "All proposed facts were dismissed, so the action proposal was not carried forward."
            )
        }
        stage = .outcome(outcome)
    }

    func reset() {
        cancelCurrentTask()
        session = nil
        suite = resourceSuite
        backendSnapshot = nil
        sourceNotice = Self.resourceNotice(for: resourceSuite)
        stage = .idle
    }

    private func mutateSession(_ mutation: (inout ReviewSession) -> Bool) -> Bool {
        guard var updated = session, mutation(&updated) else {
            return false
        }
        session = updated
        return true
    }

    private func open(
        _ fixture: FixtureCase,
        snapshot: BackendWorkspaceSnapshot? = nil
    ) {
        var review = ReviewSession(fixture: fixture)
        if let snapshot {
            for fact in review.facts {
                let confirmed = snapshot.confirmedState.assertions.first {
                    $0.field == fact.assertion.field
                }
                if let confirmed {
                    if confirmed.value == fact.assertion.value {
                        _ = review.confirm(factID: fact.id)
                    } else {
                        _ = review.edit(factID: fact.id, value: confirmed.value)
                    }
                    continue
                }
                if snapshot.analysis.assertions.first(
                    where: { $0.field == fact.assertion.field }
                )?.reviewStatus == "dismissed" {
                    _ = review.dismiss(factID: fact.id)
                }
            }
        }
        session = review
        stage = .reviewingFixture
    }

    private func start(
        kind: ImportKind,
        operation: @escaping @MainActor () async throws -> Void
    ) {
        cancelCurrentTask()
        session = nil
        stage = .importing(kind)
        importTask = Task { [weak self] in
            do {
                try await operation()
            } catch is CancellationError {
                return
            } catch {
                guard let self, case .importing = self.stage else { return }
                self.stage = .importFailed(
                    ImportFailure(kind: kind, message: error.localizedDescription)
                )
            }
        }
    }

    private func cancelCurrentTask() {
        importTask?.cancel()
        importTask = nil
    }

    private func apply(_ configuration: AppLaunchConfiguration) {
        if let endpoint = configuration.endpoint {
            localhostAddress = endpoint
        }
        if let backendEndpoint = configuration.backendEndpoint {
            backendAddress = backendEndpoint
        }

        switch configuration.scenario {
        case let .fixture(id):
            selectedFixtureID = id
            if let fixture = suite.flatMap({ FixtureCatalog.fixture(id: id, in: $0) }) {
                open(fixture)
            } else {
                stage = .importFailed(
                    ImportFailure(
                        kind: .fixture(id),
                        message: (suite == nil ? StoreError.fixtureCorpusUnavailable : StoreError.fixtureMissing).localizedDescription
                    )
                )
            }
        case .unrelatedImage:
            session = nil
            sourceNotice = "User-selected image · unbound · no extraction performed"
            stage = .reviewingUnboundImage
        case .importCancelled:
            stage = .importCancelled(.selectedImage)
        case .importFailed:
            stage = .importFailed(
                ImportFailure(
                    kind: .localhost,
                    message: "The local fixture server could not be reached. No review state changed."
                )
            )
        case .stalePreview:
            guard let fixture = suite.flatMap({ FixtureCatalog.fixture(id: "TS-CORE-01", in: $0) }) else {
                stage = .importFailed(
                    ImportFailure(
                        kind: .fixture("TS-CORE-01"),
                        message: (suite == nil ? StoreError.fixtureCorpusUnavailable : StoreError.fixtureMissing).localizedDescription
                    )
                )
                return
            }
            var staleSession = ReviewSession(fixture: fixture)
            for fact in staleSession.facts {
                _ = staleSession.confirm(factID: fact.id)
            }
            _ = staleSession.makeActionPreview()
            staleSession.invalidatePreviewForTesting()
            session = staleSession
            selectedFixtureID = fixture.id
            stage = .actionPreview
        case .backend:
            syncFromBackend()
        case .idle:
            break
        }
    }

    private static func configuredImportDelayNanoseconds(
        arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> UInt64 {
        guard let flagIndex = arguments.firstIndex(
            of: "--fixture-import-delay-seconds"
        ),
        arguments.indices.contains(flagIndex + 1),
        let seconds = Double(arguments[flagIndex + 1]),
        (0.1...30).contains(seconds) else {
            return 2_000_000_000
        }
        return UInt64(seconds * 1_000_000_000)
    }
}

enum StoreError: LocalizedError {
    case fixtureMissing
    case fixtureCorpusUnavailable

    var errorDescription: String? {
        switch self {
        case .fixtureMissing:
            return "The selected synthetic fixture is not present in this suite."
        case .fixtureCorpusUnavailable:
            return "Evaluation cases are unavailable in this build. Nothing was changed."
        }
    }
}

struct AppLaunchConfiguration: Equatable {
    enum Scenario: Equatable {
        case idle
        case fixture(String)
        case unrelatedImage
        case importCancelled
        case importFailed
        case stalePreview
        case backend
    }

    let scenario: Scenario
    let endpoint: String?
    let backendEndpoint: String?

    init(
        scenario: Scenario,
        endpoint: String?,
        backendEndpoint: String? = nil
    ) {
        self.scenario = scenario
        self.endpoint = endpoint
        self.backendEndpoint = backendEndpoint
    }

    static var current: AppLaunchConfiguration {
        parse(arguments: ProcessInfo.processInfo.arguments)
    }

    static func parse(arguments: [String]) -> AppLaunchConfiguration {
#if DEBUG
        let fixtureID = value(after: "--fixture-id", in: arguments)
        let scenarioValue = value(after: "--scenario", in: arguments)
        let endpoint = value(after: "--endpoint", in: arguments)
        let backendEndpoint = value(after: "--backend-url", in: arguments)

        let scenario: Scenario
        if backendEndpoint != nil {
            scenario = .backend
        } else if let fixtureID {
            scenario = .fixture(fixtureID)
        } else {
            switch scenarioValue {
            case "unrelated-image":
                scenario = .unrelatedImage
            case "import-cancelled":
                scenario = .importCancelled
            case "import-failed":
                scenario = .importFailed
            case "stale-preview":
                scenario = .stalePreview
            default:
                scenario = .idle
            }
        }
        return AppLaunchConfiguration(
            scenario: scenario,
            endpoint: endpoint,
            backendEndpoint: backendEndpoint
        )
#else
        return AppLaunchConfiguration(
            scenario: .idle,
            endpoint: nil,
            backendEndpoint: nil
        )
#endif
    }

    private static func value(after flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag),
              arguments.indices.contains(index + 1) else {
            return nil
        }
        return arguments[index + 1]
    }
}
