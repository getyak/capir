import Foundation
import XCTest
@testable import TalentSignal

@MainActor
final class PersonMemoryTests: XCTestCase {
    private let personID = "20000000-0000-4000-8000-000000000001"
    private let contextID = "21000000-0000-4000-8000-000000000001"
    private let otherContext = "21000000-0000-4000-8000-000000000002"

    func testRecallRejectsPrivateWrongPersonWrongContextAndMissingEvidence() throws {
        for item in [
            item(scope: "self"),
            item(person: "20000000-0000-4000-8000-000000000002"),
            item(scope: "relationship", context: otherContext),
            item(retained: false),
            item(evidence: [])
        ] {
            XCTAssertThrowsError(try page([item], context: contextID).validate(personID: personID, contextID: contextID))
        }
        let valid = item(scope: "relationship", context: contextID)
        XCTAssertNoThrow(try page([valid], context: contextID).validate(personID: personID, contextID: contextID))
        XCTAssertThrowsError(try page([valid], context: nil).validate(personID: personID, contextID: nil))
    }

    func testPersonMemoryPreservesSourceStatementAndDoesNotInventADeadline() throws {
        let saved = item()
        try page([saved], context: nil).validate(personID: personID, contextID: nil)
        XCTAssertEqual(saved.statement_kind, "source_statement")
        XCTAssertEqual(saved.speaker, "Synthetic source author")
        XCTAssertNil(saved.valid_time)
        XCTAssertEqual(saved.evidence_refs.first?.excerpt, "A source statement, not an approved task.")
    }

    func testOverviewOmitsSensitiveAndConflictedMemory() {
        let sensitive = item(sensitivity: "sensitive")
        let contested = item(conflict: UUID().uuidString)
        let ordinary = item()
        XCTAssertNil(PersonHandbookPolicy.excerpt(in: [sensitive, contested]))
        XCTAssertEqual(PersonHandbookPolicy.excerpt(in: [sensitive, contested, ordinary])?.id, ordinary.id)
    }

    func testPresentationKeepsAttributionTimeAndConflictDistinct() {
        let future = item(kind: "source_statement", time: "future")
        let view = item(kind: "user_opinion", time: "past", conflict: UUID().uuidString)
        XCTAssertEqual(PersonMemoryPresentation.kindKey(future), "Source statement")
        XCTAssertEqual(PersonMemoryPresentation.timeKey(future), "Future statement")
        XCTAssertEqual(PersonMemoryPresentation.kindKey(view), "Recorded view")
        XCTAssertEqual(PersonMemoryPresentation.timeKey(view), "Past statement")
        XCTAssertEqual(PersonMemoryPresentation.timeKey(item()), "Timing unknown")
        XCTAssertNil(PersonMemoryPresentation.timeKey(item(kind: "fact", time: "known")))
        let caption = PersonMemoryPresentation.caption(view, language: .english)
        XCTAssertTrue(caption.contains("Synthetic source author"))
        XCTAssertTrue(caption.contains("Conflicting records need review."))
        XCTAssertFalse(caption.contains("Your"))
    }

    func testSupportedWorkStatesHaveChineseLabels() {
        for status in ["drafted", "awaiting_confirmation", "scheduled", "in_progress", "completed", "cancelled", "failed"] {
            let key = PersonMemoryPresentation.actionKey(status)
            XCTAssertNotEqual(AppLanguage.simplifiedChinese.text(key), key, status)
        }
    }

    func testMultipleContextsAreNeverChosenByArrayOrder() throws {
        let person = try XCTUnwrap(PursuitWorkspaceSnapshot.preview.people.first)
        let multi = WorkspacePerson(id: person.id, displayLabel: person.displayLabel,
            contextCount: 2, captureCount: person.captureCount, confirmedIdentityCount: person.confirmedIdentityCount,
            lastActivityAt: person.lastActivityAt, profile: person.profile,
            contexts: [.init(id: contextID, displayLabel: "One", lastActivityAt: ""),
                       .init(id: otherContext, displayLabel: "Two", lastActivityAt: "")])
        XCTAssertNil(PersonHandbookPolicy.initialContextID(for: multi))
        XCTAssertEqual(PersonHandbookPolicy.initialContextID(for: person), person.contexts.first?.id)
    }

    func testARevokedLeaseCannotPublishAnOtherwiseValidReply() async {
        let service = Pages(["": page([item()], context: nil)], current: false)
        let store = PersonMemoryStore()
        await store.load(personID: personID, contextID: nil, service: service)
        XCTAssertTrue(store.items.isEmpty)
        XCTAssertEqual(store.phase, .unavailable)
    }

    func testOldRelationshipReadCannotOverwriteNewSelection() async {
        let old = SuspendedPage()
        let store = PersonMemoryStore()
        let first = Task { await store.load(personID: personID, contextID: contextID, service: old) }
        await old.waitForRequest()
        let newer = item(scope: "relationship", context: otherContext)
        await store.load(personID: personID, contextID: otherContext,
            service: Pages(["": page([newer], context: otherContext)]))
        await old.finish(page([item(scope: "relationship", context: contextID)], context: contextID))
        await first.value
        XCTAssertEqual(store.items.map(\.id), [newer.id])
        XCTAssertEqual(store.phase, .loaded)
    }

    func testFailedRefreshRetractsPreviouslyDisplayedExcerpt() async {
        let store = PersonMemoryStore()
        await store.load(personID: personID, contextID: nil, service: Pages(["": page([item()], context: nil)]))
        XCTAssertFalse(store.items.isEmpty)
        await store.load(personID: personID, contextID: nil, service: Pages([:]))
        XCTAssertTrue(store.items.isEmpty)
        XCTAssertEqual(store.phase, .unavailable)
    }

    func testPaginationRejectsWrongScopeInsteadOfAppendingIt() async {
        let store = PersonMemoryStore()
        let service = Pages([
            "": page([item()], context: nil, cursor: "second"),
            "second": page([item(scope: "relationship", context: otherContext)], context: nil)
        ])
        await store.load(personID: personID, contextID: nil, service: service)
        await store.loadMore()
        XCTAssertTrue(store.items.isEmpty)
        XCTAssertEqual(store.phase, .unavailable)
    }

    func testDetailRevalidatesAnItemReachedAfterTheFirstPage() async {
        let store = PersonMemoryStore()
        let selected = item()
        let first = item()
        let service = Pages(["": page([first], context: nil, cursor: "second"),
                             "second": page([selected], context: nil)])
        await store.load(personID: personID, contextID: nil, service: service, requiring: selected.id)
        XCTAssertEqual(store.items.map(\.id), [first.id, selected.id])
        XCTAssertNil(store.nextCursor)
    }

    func testConcreteClientUsesPersonOnlyRecallUntilARelationshipIsChosen() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MemoryURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let payload: [String: Any] = ["contract_version": TalentSignalAPIContract.version,
            "surface": "people", "person_id": personID, "relationship_context_id": NSNull(),
            "items": [], "has_more": false, "next_cursor": NSNull()]
        MemoryURLProtocol.prepare(try JSONSerialization.data(withJSONObject: payload))
        let client = ConversationMemoryReviewClient(baseURL: URL(string: "https://api.example.invalid")!,
            bearerToken: "synthetic-bearer", accountBinding: "synthetic-binding", session: session)
        _ = try await client.recallPersonMemory(personID: personID, contextID: nil)
        let request = try XCTUnwrap(MemoryURLProtocol.requests.first)
        let query = try XCTUnwrap(URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertNil(request.httpBody)
        XCTAssertEqual(request.url?.path, "/v1/memory/items")
        XCTAssertEqual(query.first { $0.name == "scope" }?.value, "person")
        XCTAssertEqual(query.first { $0.name == "surface" }?.value, "people")
        XCTAssertFalse(query.contains { $0.name == "relationship_context_id" })
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cache-Control"), "no-store")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-bearer")
    }

    private func item(scope: String = "person", person: String? = nil, context: String? = nil,
                      kind: String = "source_statement", time: String = "unknown",
                      retained: Bool = true, sensitivity: String = "normal", conflict: String? = nil,
                      evidence: [PersonMemoryItem.Evidence]? = nil) -> PersonMemoryItem {
        PersonMemoryItem(id: UUID().uuidString.lowercased(), scope: scope, statement_kind: kind,
            display_text: "A source statement, not an approved task.", original_display_text: "A source statement, not an approved task.",
            subject_id: person ?? personID, relationship_context_id: context,
            speaker: "Synthetic source author", reporter: "Synthetic source author", valid_time: nil,
            observed_time: nil, time_status: time, sensitivity: sensitivity, version: 1,
            conflict_group_id: conflict, evidence_retained: retained,
            evidence_refs: evidence ?? [.init(excerpt: "A source statement, not an approved task.",
                locator: .init(kind: "document", session_id: nil, message_id: nil, image_index: nil),
                capture_id: nil, source_resource_id: nil, source_session_id: nil, source_message_id: nil)],
            created_at: "2026-10-19T06:06:33Z")
    }
    private func page(_ items: [PersonMemoryItem], context: String?, cursor: String? = nil) -> PersonMemoryPage {
        PersonMemoryPage(contract_version: TalentSignalAPIContract.version,
            surface: context == nil ? "people" : "relationship", person_id: personID,
            relationship_context_id: context, items: items, has_more: cursor != nil, next_cursor: cursor)
    }

    private actor Pages: PersonMemoryServing {
        let pages: [String: PersonMemoryPage]
        let current: Bool
        init(_ pages: [String: PersonMemoryPage], current: Bool = true) { self.pages = pages; self.current = current }
        func isCurrentScope() async -> Bool { current }
        func recallPersonMemory(personID: String, contextID: String?, cursor: String?) async throws -> PersonMemoryPage {
            guard let page = pages[cursor ?? ""] else { throw ConversationMemoryReviewError.invalidScope }
            return page
        }
    }
    private actor SuspendedPage: PersonMemoryServing {
        var pending: CheckedContinuation<PersonMemoryPage, Error>?
        func isCurrentScope() async -> Bool { true }
        func waitForRequest() async { while pending == nil { await Task.yield() } }
        func finish(_ page: PersonMemoryPage) { pending?.resume(returning: page); pending = nil }
        func recallPersonMemory(personID: String, contextID: String?, cursor: String?) async throws -> PersonMemoryPage {
            try await withCheckedThrowingContinuation { pending = $0 }
        }
    }
}

private final class MemoryURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var data = Data()
    private static var observed: [URLRequest] = []
    static var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return observed }
    static func prepare(_ data: Data) { lock.lock(); defer { lock.unlock() }; self.data = data; observed = [] }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.observed.append(request); let data = Self.data; Self.lock.unlock()
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
