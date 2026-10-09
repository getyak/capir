import SwiftUI
import XCTest
@testable import TalentSignal

/// Small self-contained synthetic unit fixtures. They exercise review shape,
/// provenance, review, no-action, and ambiguity behavior only; they are not,
/// and must never become, the private eight-case evaluation corpus.
final class CandidateSignalTests: XCTestCase {
    // MARK: - Synthetic unit fixtures

    private func syntheticAction(
        target: String = "synthetic dependency"
    ) -> FixtureAction {
        FixtureAction(
            type: "prepare_question",
            owner: "recruiter",
            target: target,
            reason: "Synthetic bounded reason.",
            due: "synthetic due window",
            evidenceMessageIDs: ["m1"]
        )
    }

    private func syntheticCase(
        id: String = "TS-CORE-01",
        candidate: String? = "Synthetic Person",
        candidateOptions: [String]? = nil,
        disposition: FixtureDisposition = .proposeAction,
        assertions: [FixtureAssertion] = [],
        action: FixtureAction? = nil,
        mustNot: [String] = []
    ) -> FixtureCase {
        FixtureCase(
            id: id,
            title: "Synthetic unit case",
            context: FixtureContext(
                capturedAt: "2026-01-01T09:00:00+08:00",
                sourceTimezone: "Asia/Singapore",
                candidate: candidate,
                assignment: "Synthetic Assignment",
                notes: nil,
                priorState: nil,
                candidateOptions: candidateOptions,
                requestedOutput: nil
            ),
            messages: [
                FixtureMessage(
                    id: "m1",
                    speaker: "candidate",
                    text: "Synthetic unit message."
                )
            ],
            expected: FixtureExpected(
                disposition: disposition,
                assertions: assertions,
                action: action,
                mustNot: mustNot
            )
        )
    }

    private func proposedAssertion(
        field: String = "availability",
        status: AssertionStatus = .proposed,
        value: String = "synthetic window"
    ) -> FixtureAssertion {
        FixtureAssertion(
            field: field,
            status: status,
            value: value,
            evidenceMessageID: "m1",
            evidenceQuote: "Synthetic"
        )
    }

    private func proposeCase() -> FixtureCase {
        syntheticCase(
            assertions: [
                proposedAssertion(),
                proposedAssertion(
                    field: "decision_deadline",
                    value: "synthetic deadline"
                )
            ],
            action: syntheticAction()
        )
    }

    private func noActionCase() -> FixtureCase {
        syntheticCase(
            id: "TS-CORE-02",
            disposition: .noAction
        )
    }

    private func ambiguousCase() -> FixtureCase {
        syntheticCase(
            id: "TS-CORE-03",
            disposition: .clarify,
            assertions: [
                proposedAssertion(
                    status: .ambiguous,
                    value: "synthetic relative window"
                )
            ]
        )
    }

    private func identityAmbiguousCase() -> FixtureCase {
        syntheticCase(
            id: "TS-ID-01",
            candidate: nil,
            candidateOptions: [
                "Synthetic Person — First context",
                "Synthetic Person — Second context"
            ],
            disposition: .clarify
        )
    }

    private func blockedCase() -> FixtureCase {
        syntheticCase(
            id: "TS-BOUND-01",
            disposition: .block,
            mustNot: ["synthetic boundary"]
        )
    }

    private func syntheticSuite(cases: [FixtureCase]) -> FixtureSuite {
        FixtureSuite(
            suiteID: FixtureCatalog.suiteID,
            version: FixtureCatalog.version,
            purpose: "Synthetic unit suite",
            surfaces: ["plugin", "web", "ios"],
            cases: cases
        )
    }

    /// Eight minimal synthetic cases so the frozen contract's size check can be
    /// exercised without any benchmark payload.
    private func eightCaseSyntheticSuite() -> FixtureSuite {
        let ids = [
            "TS-CORE-01", "TS-CORE-02", "TS-CORE-03", "TS-CORE-04",
            "TS-ID-01", "TS-ID-03", "TS-ACT-01", "TS-BOUND-01"
        ]
        return syntheticSuite(
            cases: ids.map { id in
                syntheticCase(
                    id: id,
                    assertions: [proposedAssertion()],
                    action: syntheticAction()
                )
            }
        )
    }

    private func makeTemporaryBundle() throws -> (bundle: Bundle, cleanup: () -> Void) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("capir-fixture-bundle-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: directory.appendingPathComponent("Resources"),
            withIntermediateDirectories: true
        )
        let bundle = try XCTUnwrap(Bundle(url: directory))
        return (bundle, {
            try? FileManager.default.removeItem(at: directory)
        })
    }

    private func writeResource(
        _ data: Data?,
        into directory: URL
    ) throws {
        let locations = [
            directory.appendingPathComponent("candidate-momentum-v1.json"),
            directory
                .appendingPathComponent("Resources")
                .appendingPathComponent("candidate-momentum-v1.json")
        ]
        for location in locations {
            if let data {
                try data.write(to: location)
            }
        }
    }

    // MARK: - Optional resource catalog

    func testResourceCatalogIsUnavailableWithoutTheInjectedCorpus() throws {
        let (bundle, cleanup) = try makeTemporaryBundle()
        defer { cleanup() }

        XCTAssertNil(FixtureCatalog.loadResourceSuite(in: bundle))
    }

    func testResourceCatalogRejectsMalformedOrOffContractPayloads() throws {
        let (bundle, cleanup) = try makeTemporaryBundle()
        defer { cleanup() }
        let directory = bundle.bundleURL

        try writeResource(Data("not json".utf8), into: directory)
        XCTAssertNil(FixtureCatalog.loadResourceSuite(in: bundle))

        try writeResource(
            JSONEncoder().encode(
                syntheticSuite(cases: [proposeCase(), noActionCase()])
            ),
            into: directory
        )
        XCTAssertNil(FixtureCatalog.loadResourceSuite(in: bundle))

        try writeResource(
            JSONEncoder().encode(
                FixtureSuite(
                    suiteID: "some-other-suite",
                    version: FixtureCatalog.version,
                    purpose: "Synthetic unit suite",
                    surfaces: ["plugin", "web", "ios"],
                    cases: eightCaseSyntheticSuite().cases
                )
            ),
            into: directory
        )
        XCTAssertNil(FixtureCatalog.loadResourceSuite(in: bundle))
    }

    func testResourceCatalogDecodesAValidatedInjectedCorpus() throws {
        let (bundle, cleanup) = try makeTemporaryBundle()
        defer { cleanup() }
        try writeResource(
            JSONEncoder().encode(eightCaseSyntheticSuite()),
            into: bundle.bundleURL
        )

        let suite = try XCTUnwrap(FixtureCatalog.loadResourceSuite(in: bundle))
        XCTAssertEqual(suite.suiteID, FixtureCatalog.suiteID)
        XCTAssertEqual(suite.version, FixtureCatalog.version)
        XCTAssertEqual(suite.cases.count, 8)
        XCTAssertNotNil(FixtureCatalog.fixture(id: "TS-CORE-01", in: suite))
        XCTAssertNil(FixtureCatalog.fixture(id: "TS-NOT-THERE", in: suite))
    }

    func testValidatedContractRejectsWrongSizeOrMissingIOSurface() throws {
        XCTAssertThrowsError(
            try syntheticSuite(cases: [proposeCase()]).validated()
        )
        XCTAssertThrowsError(
            try FixtureSuite(
                suiteID: FixtureCatalog.suiteID,
                version: FixtureCatalog.version,
                purpose: "Synthetic unit suite",
                surfaces: ["plugin", "web"],
                cases: eightCaseSyntheticSuite().cases
            ).validated()
        )
        let duplicated = syntheticSuite(
            cases: (0..<8).map { _ in proposeCase() }
        )
        XCTAssertThrowsError(try duplicated.validated())
        XCTAssertNoThrow(try eightCaseSyntheticSuite().validated())
    }

    func testValidatedContractRejectsChangedRevisionUnknownIDsAndMissingEvidence() throws {
        let original = eightCaseSyntheticSuite()
        let changedRevision = FixtureSuite(
            suiteID: original.suiteID, version: "unsupported-revision",
            purpose: original.purpose, surfaces: original.surfaces, cases: original.cases
        )
        XCTAssertThrowsError(try changedRevision.validated())

        var unknownCases = original.cases
        unknownCases[0] = syntheticCase(
            id: "UNKNOWN", assertions: [proposedAssertion()], action: syntheticAction()
        )
        XCTAssertThrowsError(try syntheticSuite(cases: unknownCases).validated())

        var brokenCases = original.cases
        brokenCases[0] = syntheticCase(
            assertions: [FixtureAssertion(
                field: "availability", status: .proposed, value: "synthetic window",
                evidenceMessageID: "missing", evidenceQuote: "Synthetic"
            )], action: syntheticAction()
        )
        XCTAssertThrowsError(try syntheticSuite(cases: brokenCases).validated())
    }

    // MARK: - Review shape and provenance

    func testProposalsStartPendingAndRequireReviewedFacts() throws {
        let fixture = proposeCase()
        var review = ReviewSession(fixture: fixture)

        XCTAssertEqual(review.facts.count, 2)
        XCTAssertEqual(review.facts.map(\.id), [
            "availability-m1",
            "decision_deadline-m1"
        ])
        XCTAssertEqual(review.facts.first?.assertion.evidenceMessageID, "m1")
        XCTAssertEqual(review.facts.first?.assertion.evidenceQuote, "Synthetic")
        XCTAssertTrue(review.facts.allSatisfy { $0.decision == .pending })
        XCTAssertFalse(review.allFactsReviewed)
        XCTAssertFalse(review.canPreviewAction)
        XCTAssertNil(review.makeActionPreview())

        for fact in review.facts {
            XCTAssertTrue(review.confirm(factID: fact.id))
        }

        XCTAssertTrue(review.allFactsReviewed)
        XCTAssertTrue(review.canPreviewAction)
        let preview = try XCTUnwrap(review.makeActionPreview())
        XCTAssertEqual(preview.action.target, "synthetic dependency")
        XCTAssertTrue(preview.exactEffect.contains("No message, meeting, contact"))
        XCTAssertTrue(review.isPreviewCurrent)
    }

    func testReviewedFactDecisionsPreserveProvenance() {
        let pending = ReviewedFact(assertion: proposedAssertion())
        XCTAssertEqual(pending.id, "availability-m1")
        XCTAssertNil(pending.acceptedValue)

        var confirmed = pending
        confirmed.decision = .confirmed
        XCTAssertEqual(confirmed.acceptedValue, "synthetic window")

        var edited = pending
        edited.decision = .edited
        edited.editedValue = "Synthetic edit"
        XCTAssertEqual(edited.acceptedValue, "Synthetic edit")

        var dismissed = pending
        dismissed.decision = .dismissed
        XCTAssertNil(dismissed.acceptedValue)
        XCTAssertEqual(dismissed.assertion.evidenceQuote, "Synthetic")
    }

    func testEditingAfterPreviewInvalidatesStaleAction() throws {
        let fixture = proposeCase()
        var review = ReviewSession(fixture: fixture)
        for fact in review.facts {
            XCTAssertTrue(review.confirm(factID: fact.id))
        }
        XCTAssertNotNil(review.makeActionPreview())

        let first = try XCTUnwrap(review.facts.first)
        XCTAssertTrue(review.edit(factID: first.id, value: "Synthetic correction"))

        XCTAssertNil(review.preview)
        XCTAssertFalse(review.isPreviewCurrent)
    }

    func testAmbiguousAssertionsCannotBeConfirmedWithoutEditing() throws {
        var review = ReviewSession(fixture: ambiguousCase())
        let fact = try XCTUnwrap(review.facts.first)

        XCTAssertEqual(fact.assertion.status, .ambiguous)
        XCTAssertFalse(review.confirm(factID: fact.id))
        XCTAssertTrue(
            review.edit(factID: fact.id, value: "Synthetic exact window")
        )
        XCTAssertEqual(review.facts.first?.acceptedValue, "Synthetic exact window")
        XCTAssertNil(review.fixture.expected.action)
        XCTAssertFalse(review.canPreviewAction)
    }

    func testDismissedFactsKeepEvidenceButContributeNothing() {
        var review = ReviewSession(fixture: proposeCase())
        let first = review.facts[0].id
        let second = review.facts[1].id

        XCTAssertTrue(review.dismiss(factID: first))
        XCTAssertTrue(review.confirm(factID: second))
        XCTAssertTrue(review.allFactsReviewed)
        XCTAssertEqual(review.acceptedFacts.map(\.id), [second])
        XCTAssertEqual(review.facts[0].assertion.evidenceQuote, "Synthetic")
    }

    // MARK: - No-action, block, and identity boundaries

    @MainActor
    func testEmptyInjectedCorpusStaysUnavailable() {
        let store = CandidateSignalStore(
            fixtureSuite: syntheticSuite(cases: []),
            launchConfiguration: AppLaunchConfiguration(scenario: .fixture("TS-CORE-01"), endpoint: nil)
        )
        XCTAssertFalse(store.fixtureCorpusAvailable)
        XCTAssertNil(store.session)
    }

    func testNoActionCasesNeverProduceAnActionPreview() {
        var review = ReviewSession(fixture: noActionCase())

        XCTAssertTrue(review.allFactsReviewed)
        XCTAssertFalse(review.canPreviewAction)
        XCTAssertNil(review.makeActionPreview())
    }

    func testIdentityAmbiguityStaysUnbound() {
        let fixture = identityAmbiguousCase()
        let review = ReviewSession(fixture: fixture)

        XCTAssertNil(fixture.context.candidate)
        XCTAssertEqual(fixture.context.candidateOptions?.count, 2)
        XCTAssertTrue(review.hasUnresolvedIdentity)
        XCTAssertTrue(review.facts.isEmpty)
        XCTAssertFalse(review.canPreviewAction)
    }

    @MainActor
    func testUnavailableCorpusProducesExplicitImportFailure() {
        let store = CandidateSignalStore(
            importDelayNanoseconds: 0,
            fixtureSuite: nil,
            launchConfiguration: AppLaunchConfiguration(
                scenario: .fixture("TS-CORE-01"),
                endpoint: nil
            )
        )

        XCTAssertFalse(store.fixtureCorpusAvailable)
        XCTAssertEqual(
            store.stage,
            .importFailed(
                ImportFailure(
                    kind: .fixture("TS-CORE-01"),
                    message: StoreError.fixtureCorpusUnavailable.localizedDescription
                )
            )
        )
        XCTAssertNil(store.session)
        XCTAssertTrue(store.sourceNotice.contains("unavailable"))

        store.beginFixtureImport()
        XCTAssertNil(store.session)

        store.reset()
        XCTAssertEqual(store.stage, .idle)
    }

    @MainActor
    func testStalePreviewScenarioFailsClearlyWithoutTheCorpus() {
        let store = CandidateSignalStore(
            importDelayNanoseconds: 0,
            fixtureSuite: nil,
            launchConfiguration: AppLaunchConfiguration(
                scenario: .stalePreview,
                endpoint: nil
            )
        )

        XCTAssertNil(store.session)
        XCTAssertEqual(
            store.stage,
            .importFailed(
                ImportFailure(
                    kind: .fixture("TS-CORE-01"),
                    message: StoreError.fixtureCorpusUnavailable.localizedDescription
                )
            )
        )
        XCTAssertTrue(store.sourceNotice.contains("unavailable"))
    }

    @MainActor
    func testInjectedSyntheticCorpusDrivesTheReviewLifecycle() {
        let store = CandidateSignalStore(
            importDelayNanoseconds: 0,
            fixtureSuite: syntheticSuite(cases: [proposeCase()]),
            launchConfiguration: AppLaunchConfiguration(
                scenario: .fixture("TS-CORE-01"),
                endpoint: nil
            )
        )

        XCTAssertTrue(store.fixtureCorpusAvailable)
        XCTAssertEqual(store.stage, .reviewingFixture)
        XCTAssertNotNil(store.session)
        XCTAssertTrue(store.sourceNotice.contains("cases"))

        XCTAssertTrue(store.confirmFact(id: "availability-m1"))
        XCTAssertTrue(store.confirmFact(id: "decision_deadline-m1"))
        XCTAssertTrue(store.showActionPreview())
        XCTAssertEqual(store.stage, .actionPreview)
    }

    @MainActor
    func testImportCancellationLeavesNoSession() {
        let store = CandidateSignalStore(
            importDelayNanoseconds: 1_000_000_000,
            fixtureSuite: syntheticSuite(cases: [proposeCase()]),
            launchConfiguration: AppLaunchConfiguration(scenario: .idle, endpoint: nil)
        )

        store.beginFixtureImport()
        XCTAssertEqual(store.stage, .importing(.fixture("TS-CORE-01")))
        store.cancelImport()

        XCTAssertEqual(store.stage, .importCancelled(.fixture("TS-CORE-01")))
        XCTAssertNil(store.session)
    }

    @MainActor
    func testNoActionAndBlockDispositionsFinishTruthfully() {
        let noActionStore = CandidateSignalStore(
            importDelayNanoseconds: 0,
            fixtureSuite: syntheticSuite(cases: [noActionCase()]),
            launchConfiguration: AppLaunchConfiguration(
                scenario: .fixture("TS-CORE-02"),
                endpoint: nil
            )
        )
        noActionStore.finishWithoutAction()
        XCTAssertEqual(noActionStore.stage, .outcome(ReviewOutcome(
            kind: .noAction,
            title: "No action is the result",
            detail: "The evidence is preserved for this local review without manufacturing urgency or a follow-up task."
        )))

        let blockedStore = CandidateSignalStore(
            importDelayNanoseconds: 0,
            fixtureSuite: syntheticSuite(cases: [blockedCase()]),
            launchConfiguration: AppLaunchConfiguration(
                scenario: .fixture("TS-BOUND-01"),
                endpoint: nil
            )
        )
        blockedStore.finishWithoutAction()
        XCTAssertEqual(blockedStore.stage, .outcome(ReviewOutcome(
            kind: .refused,
            title: "Candidate scoring was refused",
            detail: "Response speed, tone, and shared interests are not evidence for culture fit, candidate quality, or acceptance likelihood."
        )))
    }

    // MARK: - Unchanged generic surface tests

    @MainActor
    func testUnrelatedImageStateNeverCarriesFixtureFacts() {
        let store = CandidateSignalStore(
            importDelayNanoseconds: 0,
            fixtureSuite: nil,
            launchConfiguration: AppLaunchConfiguration(
                scenario: .unrelatedImage,
                endpoint: nil
            )
        )

        XCTAssertEqual(store.stage, .reviewingUnboundImage)
        XCTAssertNil(store.session)
        XCTAssertTrue(store.sourceNotice.contains("unbound"))
    }

    func testLoopbackValidationRejectsRemoteHosts() {
        XCTAssertTrue(URLFixtureLoader.isLoopback(URL(string: "http://127.0.0.1:8787/fixtures.json")!))
        XCTAssertTrue(URLFixtureLoader.isLoopback(URL(string: "http://localhost:8787/fixtures.json")!))
        XCTAssertTrue(URLFixtureLoader.isLoopback(URL(string: "http://[::1]:8787/fixtures.json")!))
        XCTAssertFalse(URLFixtureLoader.isLoopback(URL(string: "https://example.com/fixtures.json")!))
        XCTAssertFalse(URLFixtureLoader.isLoopback(URL(string: "file:///tmp/fixtures.json")!))
    }

    func testEvidencePaletteHasEnhancedDarkContrast() {
        let darkTraits = UITraitCollection(userInterfaceStyle: .dark)
        let ink = UIColor(Color.tsInk).resolvedColor(with: darkTraits)
        let mutedInk = UIColor(Color.tsMutedInk).resolvedColor(with: darkTraits)
        let evidence = UIColor(Color.tsEvidence).resolvedColor(with: darkTraits)
        let surface = UIColor(Color.tsSurface).resolvedColor(with: darkTraits)
        let canvas = UIColor(Color.tsCanvas).resolvedColor(with: darkTraits)

        XCTAssertGreaterThanOrEqual(contrastRatio(ink, evidence), 7)
        XCTAssertGreaterThanOrEqual(contrastRatio(mutedInk, evidence), 7)
        XCTAssertGreaterThanOrEqual(contrastRatio(mutedInk, surface), 7)
        XCTAssertGreaterThanOrEqual(contrastRatio(mutedInk, canvas), 7)
    }

    func testLaunchScenariosAreDeterministic() {
        XCTAssertEqual(
            AppLaunchConfiguration.parse(
                arguments: ["TalentSignal", "--fixture-id", "TS-CORE-01"]
            ),
            AppLaunchConfiguration(scenario: .fixture("TS-CORE-01"), endpoint: nil)
        )
        XCTAssertEqual(
            AppLaunchConfiguration.parse(
                arguments: ["TalentSignal", "--scenario", "unrelated-image"]
            ).scenario,
            .unrelatedImage
        )
        XCTAssertEqual(
            AppLaunchConfiguration.parse(
                arguments: ["TalentSignal", "--scenario", "stale-preview"]
            ).scenario,
            .stalePreview
        )
        XCTAssertEqual(
            AppLaunchConfiguration.parse(
                arguments: [
                    "TalentSignal",
                    "--backend-url", "http://127.0.0.1:4317"
                ]
            ),
            AppLaunchConfiguration(
                scenario: .backend,
                endpoint: nil,
                backendEndpoint: "http://127.0.0.1:4317"
            )
        )
    }

    private func contrastRatio(_ first: UIColor, _ second: UIColor) -> CGFloat {
        let firstLuminance = relativeLuminance(first)
        let secondLuminance = relativeLuminance(second)
        let lighter = max(firstLuminance, secondLuminance)
        let darker = min(firstLuminance, secondLuminance)
        return (lighter + 0.05) / (darker + 0.05)
    }

    private func relativeLuminance(_ color: UIColor) -> CGFloat {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        XCTAssertTrue(color.getRed(&red, green: &green, blue: &blue, alpha: &alpha))

        return 0.2126 * linearized(red)
            + 0.7152 * linearized(green)
            + 0.0722 * linearized(blue)
    }

    private func linearized(_ component: CGFloat) -> CGFloat {
        component <= 0.04045
            ? component / 12.92
            : pow((component + 0.055) / 1.055, 2.4)
    }
}
