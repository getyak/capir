import Foundation

protocol ConversationMemoryReviewClientProviding {
    func memoryReviewClient() async throws -> ConversationMemoryReviewClient
}

protocol ConversationMemoryReviewServing {
    var accountBinding: String { get }
    var reviewScope: ConversationMemoryReviewScope { get }
    func open(proposalID: String, sessionID: UUID) async throws -> ConversationMemoryReviewEnvelope
    func commit(reviewID: String, credential: String, body: ConversationMemoryCommit) async throws -> ConversationMemoryReceipt
    func commitContact(reviewID: String, credential: String, body: ConversationMemoryCommit) async throws -> ConversationMemoryReceipt
    func decideItem(reviewID: String, credential: String, body: ConversationMemoryItemDecision) async throws -> ConversationMemoryItemDecisionResponse
    func operation(key: String, sessionID: UUID, personID: String?) async throws -> ConversationMemoryOperationView
    func dismiss(reviewID: String, credential: String, revision: Int, operationKey: String) async throws
    func rebase(proposalID: String, body: ConversationMemoryRebase) async throws -> ConversationMemoryRebaseResponse
    func searchPeople(query: String) async throws -> [ConversationMemoryPerson]
    func verifyPerson(id: String) async throws -> ConversationMemoryPerson
    func saveDraft(reviewID: String, credential: String, body: ConversationMemoryDraftUpdate) async throws -> ConversationMemoryReviewEnvelope
    func destinationPersonID(receipt: ConversationMemoryReceipt) async throws -> String?
    func isCurrentScope() async -> Bool
}

extension ConversationMemoryReviewServing {
    var reviewScope: ConversationMemoryReviewScope { .chat }
    func destinationPersonID(receipt: ConversationMemoryReceipt) async throws -> String? { nil }
    func isCurrentScope() async -> Bool { true }
}

/// Credentials remain private and transient. Every response crosses the same
/// current-login lease as the request, including requests already in flight.
struct ConversationMemoryReviewClient: ConversationMemoryReviewServing, PersonMemoryServing {
    private struct Failure: Decodable {
        let code: String?
        let details: Details?
        let error: Nested?
        struct Details: Decodable { let operation_key: String? }
        struct Nested: Decodable { let code: String?; let details: Details? }
    }
    let accountBinding: String
    private(set) var reviewScope: ConversationMemoryReviewScope = .chat
    private let baseURL: URL
    private let bearerToken: String
    private let session: URLSession
    private var isCurrent: @MainActor @Sendable () -> Bool = { true }

    init(baseURL: URL, bearerToken: String, accountBinding: String,
         session: URLSession = TalentSignalNetworking.session) {
        self.baseURL = baseURL; self.bearerToken = bearerToken
        self.accountBinding = accountBinding; self.session = session
    }

    func boundToCurrentScope(_ isCurrent: @escaping @MainActor @Sendable () -> Bool) -> Self {
        var copy = self; copy.isCurrent = isCurrent; return copy
    }
    func forReviewScope(_ scope: ConversationMemoryReviewScope) throws -> Self {
        guard scope.isValid else { throw ConversationMemoryReviewError.invalidScope }
        var copy = self; copy.reviewScope = scope; return copy
    }
    func isCurrentScope() async -> Bool { await isCurrent() }

    func recallPersonMemory(personID: String, contextID: String?, cursor: String? = nil) async throws -> PersonMemoryPage {
        let person = try identifier(personID)
        let context = try contextID.map { try identifier($0) }
        var query = [URLQueryItem(name: "surface", value: context == nil ? "people" : "relationship"),
                     URLQueryItem(name: "person_id", value: person),
                     URLQueryItem(name: "limit", value: "50")]
        if let context {
            query.append(.init(name: "relationship_context_id", value: context))
        } else {
            // A multi-context contact has no implicit relationship selection.
            query.append(.init(name: "scope", value: "person"))
        }
        if let cursor {
            guard !cursor.isEmpty, cursor.count <= 500 else { throw ConversationMemoryReviewError.invalidScope }
            query.append(.init(name: "cursor", value: cursor))
        }
        let page: PersonMemoryPage = try await request("v1/memory/items", method: "GET", query: query)
        try page.validate(personID: person, contextID: context)
        return page
    }

    private func requireCurrentScope() async throws {
        guard await isCurrent() else {
            try? KeychainConversationMemoryOperationStore().removeAccount(
                prefix: ConversationMemoryIntentRetention.accountPrefix(binding: accountBinding))
            throw ConversationMemoryReviewError.invalidScope
        }
    }

    func open(proposalID: String, sessionID: UUID) async throws -> ConversationMemoryReviewEnvelope {
        return try await request("v1/memory/proposals/\(try identifier(proposalID))/reviews", method: "POST",
            body: JSONEncoder().encode(ConversationMemoryOpenReviewRequest(scope: reviewScope, sessionID: sessionID)))
    }

    func commit(reviewID: String, credential: String, body: ConversationMemoryCommit) async throws -> ConversationMemoryReceipt {
        struct Response: Decodable { let contract_version: String; let receipt: ConversationMemoryReceipt }
        let result: Response = try await request("v1/memory/reviews/\(try identifier(reviewID))/commits",
            method: "POST", body: JSONEncoder().encode(body), credential: credential)
        guard result.contract_version == TalentSignalAPIContract.version else { throw ConversationMemoryReviewError.invalidScope }
        return result.receipt
    }

    func commitContact(reviewID: String, credential: String, body: ConversationMemoryCommit) async throws -> ConversationMemoryReceipt {
        struct Body: Encodable {
            let idempotency_key: String; let expected_proposal_revision: Int
            let display_label: String; let relationship_context: String; let reason: String
        }
        struct Response: Decodable { let contract_version: String; let receipt: ConversationMemoryReceipt }
        guard reviewScope.allowsIdentityChanges, body.contact_decision == "new", body.selected_item_ids.isEmpty, let contact = body.new_contact else {
            throw ConversationMemoryReviewError.invalidScope
        }
        let response: Response = try await request("v1/memory/reviews/\(try identifier(reviewID))/contact-decisions", method: "POST",
            body: JSONEncoder().encode(Body(idempotency_key: body.idempotency_key,
                expected_proposal_revision: body.expected_proposal_revision, display_label: contact.display_label,
                relationship_context: contact.relationship_context, reason: body.reason)), credential: credential)
        guard response.contract_version == TalentSignalAPIContract.version else { throw ConversationMemoryReviewError.invalidScope }
        return response.receipt
    }

    func decideItem(reviewID: String, credential: String, body: ConversationMemoryItemDecision) async throws -> ConversationMemoryItemDecisionResponse {
        try await request("v1/memory/reviews/\(try identifier(reviewID))/item-decisions", method: "POST",
            body: JSONEncoder().encode(body), credential: credential)
    }

    func operation(key: String, sessionID: UUID, personID: String?) async throws -> ConversationMemoryOperationView {
        var query: [URLQueryItem] = [.init(name: "purpose", value: reviewScope.purpose), .init(name: "session_id", value: sessionID.uuidString.lowercased())]
        if let scopedPerson = reviewScope.personID {
            guard personID == nil || UUID(uuidString: personID ?? "") == UUID(uuidString: scopedPerson) else { throw ConversationMemoryReviewError.invalidScope }
            query.append(.init(name: "person_id", value: try identifier(scopedPerson)))
        } else if let personID { query.append(.init(name: "person_id", value: try identifier(personID))) }
        if let contextID = reviewScope.contextID { query.append(.init(name: "relationship_context_id", value: try identifier(contextID))) }
        return try await request("v1/memory/operation-views/\(try identifier(key))", method: "GET", query: query)
    }

    func dismiss(reviewID: String, credential: String, revision: Int, operationKey: String) async throws {
        struct Body: Encodable {
            let idempotency_key: String; let expected_review_revision: Int
            let item_ids: [String] = []; let reason = "User chose not to save this conversation proposal."
        }
        struct Response: Decodable { let contract_version: String; let proposal_status: String }
        let response: Response = try await request("v1/memory/reviews/\(try identifier(reviewID))/dismissals",
            method: "POST", body: JSONEncoder().encode(Body(idempotency_key: operationKey, expected_review_revision: revision)),
            credential: credential)
        guard response.contract_version == TalentSignalAPIContract.version,
              ["dismissed", "partially_committed"].contains(response.proposal_status) else {
            throw ConversationMemoryReviewError.invalidScope
        }
    }

    func rebase(proposalID: String, body: ConversationMemoryRebase) async throws -> ConversationMemoryRebaseResponse {
        guard reviewScope.allowsIdentityChanges else { throw ConversationMemoryReviewError.invalidScope }
        return try await request("v1/memory/proposals/\(try identifier(proposalID))/rebases", method: "POST", body: JSONEncoder().encode(body))
    }

    func searchPeople(query: String) async throws -> [ConversationMemoryPerson] {
        struct Body: Encodable { let query: String }
        struct Response: Decodable { let contract_version: String; let people: [ConversationMemoryPerson] }
        let value = query.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.utf16.count <= 500 else { throw ConversationMemoryReviewError.unavailable }
        let response: Response = try await request("v1/people/search", method: "POST", body: JSONEncoder().encode(Body(query: value)))
        guard response.contract_version == TalentSignalAPIContract.version,
              response.people.count <= 200, response.people.allSatisfy({ UUID(uuidString: $0.id) != nil }) else {
            throw ConversationMemoryReviewError.invalidScope
        }
        return response.people
    }

    func verifyPerson(id: String) async throws -> ConversationMemoryPerson {
        struct Response: Decodable { let contract_version: String; let person: ConversationMemoryPerson }
        let response: Response = try await request("v1/people/\(try identifier(id))", method: "GET")
        guard response.contract_version == TalentSignalAPIContract.version,
              UUID(uuidString: response.person.id) == UUID(uuidString: id) else { throw ConversationMemoryReviewError.invalidScope }
        return response.person
    }

    func saveDraft(reviewID: String, credential: String, body: ConversationMemoryDraftUpdate) async throws -> ConversationMemoryReviewEnvelope {
        try await request("v1/memory/reviews/\(try identifier(reviewID))/draft", method: "PUT",
            body: JSONEncoder().encode(body), credential: credential)
    }

    func destinationPersonID(receipt: ConversationMemoryReceipt) async throws -> String? {
        struct Scope: Decodable { let scope: String; let person_id: String? }
        for id in receipt.created_item_ids + receipt.updated_item_ids {
            let scope: Scope = try await request("v1/memory/items/\(try identifier(id))/scope", method: "GET")
            if ["person", "relationship"].contains(scope.scope), let personID = scope.person_id {
                return try identifier(personID)
            }
        }
        return nil
    }

    private func identifier(_ value: String) throws -> String {
        guard let id = UUID(uuidString: value) else { throw ConversationMemoryReviewError.invalidScope }
        return id.uuidString.lowercased()
    }

    private func request<Response: Decodable>(_ path: String, method: String, body: Data? = nil,
        credential: String? = nil, query: [URLQueryItem] = []) async throws -> Response {
        try await requireCurrentScope()
        guard !bearerToken.isEmpty else { throw ConversationMemoryReviewError.invalidScope }
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw ConversationMemoryReviewError.invalidScope }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = method; request.httpBody = body; request.timeoutInterval = 45
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let credential {
            guard (16...200).contains(credential.count) else { throw ConversationMemoryReviewError.invalidScope }
            request.setValue(credential, forHTTPHeaderField: "x-memory-review-credential")
        }
        let (data, response) = try await TalentSignalNetworking.data(for: request, using: session)
        try await requireCurrentScope()
        guard let http = response as? HTTPURLResponse else { throw ConversationMemoryReviewError.invalidScope }
        guard (200..<300).contains(http.statusCode) else {
            // Decode only closed error metadata; never show/log raw server text.
            let failure = try? JSONDecoder().decode(Failure.self, from: data)
            throw ConversationMemoryReviewError.backend(status: http.statusCode,
                code: failure?.code ?? failure?.error?.code ?? "MEMORY_UNAVAILABLE",
                operationKey: failure?.details?.operation_key ?? failure?.error?.details?.operation_key)
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}
