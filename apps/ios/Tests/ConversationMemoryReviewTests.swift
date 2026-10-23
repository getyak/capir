import Foundation
import XCTest
@testable import TalentSignal

@MainActor
final class ConversationMemoryReviewTests: XCTestCase {
    func testRelationshipOpenRequestEncodesActualRestrictedWireContract() throws {
        let person = UUID().uuidString.lowercased(), context = UUID().uuidString.lowercased(), session = UUID()
        let scope = ConversationMemoryReviewScope.relationship(personID: person, contextID: context)
        let body = ConversationMemoryOpenReviewRequest(scope: scope, sessionID: session)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        XCTAssertEqual(Set(json.keys), ["purpose", "session_id", "person_id", "relationship_context_id"])
        XCTAssertEqual(json["purpose"] as? String, "relationship")
        XCTAssertEqual(json["person_id"] as? String, person)
        XCTAssertEqual(json["relationship_context_id"] as? String, context)
        XCTAssertEqual(json["session_id"] as? String, session.uuidString.lowercased())
        let privateChat = try XCTUnwrap(JSONSerialization.jsonObject(with:
            JSONEncoder().encode(ConversationMemoryOpenReviewRequest(scope: .chat, sessionID: session))) as? [String: Any])
        XCTAssertEqual(privateChat["purpose"] as? String, "chat")
        XCTAssertNil(privateChat["person_id"])
        XCTAssertNil(privateChat["relationship_context_id"])
    }

    func testRestrictedRelationshipReviewRequiresExactTargetsAndRejectsSelfItems() async {
        let service = MemoryFixtureService(); service.hasItem = true; service.contactCreated = true
        service.reviewScope = .relationship(personID: service.personID, contextID: service.contextID)
        let store = makeStore(service)
        await store.open()
        XCTAssertEqual(store.phase, .review)
        XCTAssertEqual(store.review?.allowed_scope, "relationship")
        XCTAssertFalse(store.allowsIdentityChanges)
        await store.chooseNewContact(name: "Another person", relationship: "")
        XCTAssertTrue(service.rebaseKeys.isEmpty)
        let selfService = MemoryFixtureService(); selfService.hasItem = true; selfService.contactCreated = true
        selfService.reviewScope = .relationship(personID: selfService.personID, contextID: selfService.contextID)
        selfService.emitSelfItem = true
        let unsafe = makeStore(selfService)
        await unsafe.open()
        XCTAssertNil(unsafe.review)
        XCTAssertFalse(unsafe.canSave)
        let wrong = MemoryFixtureService(); wrong.hasItem = true; wrong.contactCreated = true
        wrong.reviewScope = .relationship(personID: wrong.personID, contextID: UUID().uuidString)
        let mismatch = makeStore(wrong)
        await mismatch.open()
        XCTAssertNil(mismatch.review)
        XCTAssertFalse(mismatch.canSave)
    }

    func testRestrictedRelationshipReviewRejectsBroaderAllowedScope() async {
        let service = MemoryFixtureService(); service.contactCreated = true
        service.reviewScope = .relationship(personID: service.personID, contextID: service.contextID)
        service.allowedScopeOverride = "all"
        let store = makeStore(service)
        await store.open()
        XCTAssertNil(store.review)
        XCTAssertFalse(store.canSave)
    }

    func testRestrictedRelationshipItemCompletesWithinSameTargetScope() async throws {
        let service = MemoryFixtureService(); service.hasItem = true; service.contactCreated = true
        service.reviewScope = .relationship(personID: service.personID, contextID: service.contextID)
        let store = makeStore(service)
        await store.open()
        let item = try XCTUnwrap(store.pendingItems.first)
        store.selectedItemIDs.insert(item.id)
        await store.save()
        XCTAssertEqual(service.itemCommits, 1)
        XCTAssertEqual(service.contactCommits, 0)
        XCTAssertEqual(service.lastItemBody?.contact_decision, "existing")
        XCTAssertEqual(store.phase, .saved)
        XCTAssertEqual(store.destination?.personID, service.personID)
        XCTAssertEqual(store.destination?.savedItemCount, 1)
    }

    func testHTTPTaskDecodesActualSnakeCaseMemoryProposal() throws {
        let proposalID = UUID().uuidString.lowercased()
        let payload: [String: Any] = ["contract_version": TalentSignalAPIContract.version,
            "task_id": UUID().uuidString, "context_manifest_id": "", "knowledge_snapshot_id": "",
            "disposition": "answer", "blocks": [], "created_at": "2026-10-22T12:00:00Z",
            "memory_proposal": ["proposal_id": proposalID, "revision": 2]]
        let response = try JSONDecoder().decode(RelationshipAskResponse.self,
            from: JSONSerialization.data(withJSONObject: payload))
        XCTAssertEqual(response.memoryProposal, .init(proposal_id: proposalID, revision: 2))
    }

    func testItemDecisionEncodesActualSingleItemWireContract() throws {
        let key = UUID().uuidString.lowercased()
        let itemID = UUID().uuidString.lowercased()
        let body = ConversationMemoryItemDecision(idempotency_key: key, expected_proposal_revision: 3,
            expected_review_revision: 7, item_id: itemID, expected_item_added_revision: 2,
            expected_item_version: 4, contact_decision: "existing", decision: "accept_new",
            edited_text: "An explicitly corrected source statement.")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        XCTAssertEqual(Set(json.keys), ["idempotency_key", "expected_proposal_revision", "expected_review_revision",
            "item_id", "expected_item_added_revision", "expected_item_version", "contact_decision", "decision", "edited_text", "reason"])
        XCTAssertEqual(json["idempotency_key"] as? String, key)
        XCTAssertEqual(json["item_id"] as? String, itemID)
        XCTAssertEqual(json["expected_review_revision"] as? Int, 7)
        XCTAssertEqual(json["expected_item_version"] as? Int, 4)
        XCTAssertNil(json["selected_item_ids"], "The native Session must not silently complete a batch review.")
    }

    func testCanonicalProposalReferenceSurvivesClassifiedPersistenceButNotReadOnlyCopy() throws {
        let ref = ConversationMemoryProposalReference(proposal_id: UUID().uuidString.lowercased(), revision: 3)
        let response = RelationshipAskResponse(contractVersion: TalentSignalAPIContract.version,
            taskID: UUID().uuidString, contextManifestID: "none-unbound-conversation", knowledgeSnapshotID: "",
            disposition: "answer", blocks: [], createdAt: "2026-10-22T12:00:00Z", memoryProposal: ref)
        let persisted = PersistedRelationshipAskResponse(response)
        let restored = try JSONDecoder().decode(PersistedRelationshipAskResponse.self, from: JSONEncoder().encode(persisted)).value
        XCTAssertEqual(restored.memoryProposal, ref)
        XCTAssertEqual(AgentSessionContextPolicy.classifiedResponse(response).memoryProposal, ref)
        XCTAssertNil(AgentSessionContextPolicy.readOnlyResponse(response).memoryProposal)
        XCTAssertEqual(try JSONDecoder().decode(ConversationMemoryProposalReference.self, from: JSONEncoder().encode(ref)), ref)
    }

    func testCanonicalWireKeepsExactProposalReferenceWithoutReencodingAuthority() throws {
        let fixture = MemoryFixtureService()
        let wire: [String: Any] = ["id": fixture.message.uuidString, "objective": "", "createdAt": "2026-10-22T12:00:00Z",
            "response": ["contractVersion": TalentSignalAPIContract.version, "taskID": UUID().uuidString,
                "contextManifestID": "", "knowledgeSnapshotID": "", "disposition": "answer", "createdAt": "2026-10-22T12:00:00Z",
                "unboundConversationBlocks": [], "execution": ["state": "completed"],
                "memoryProposal": ["proposal_id": fixture.proposal.proposal_id, "revision": 1]]]
        let bytes = try JSONSerialization.data(withJSONObject: wire)
        let persisted = try JSONDecoder.agentSession.decode(PersistedAgentSessionTurn.self, from: bytes)
        XCTAssertEqual(persisted.value.response.memoryProposal, fixture.proposal)
        let after = try JSONSerialization.jsonObject(with: JSONEncoder.agentSession.encode(PersistedAgentSessionTurn(persisted.value))) as? NSDictionary
        XCTAssertEqual(after, wire as NSDictionary)
    }

    func testContactOnlyUsesDedicatedDecisionAndRequiresDestinationReadback() async throws {
        let service = MemoryFixtureService()
        let store = makeStore(service)
        await store.open()
        XCTAssertTrue(store.canSave)
        await store.save()
        XCTAssertEqual(service.contactCommits, 1)
        XCTAssertEqual(service.batchCommits, 0)
        XCTAssertEqual(service.personReads, 1)
        XCTAssertEqual(store.phase, .saved)
        XCTAssertEqual(store.destination?.personID, service.personID)
    }

    func testContactOnlyDoesNotRequireDecidingSensitiveMemoryFromPriorDraft() async throws {
        let service = MemoryFixtureService()
        service.hasItem = true; service.sensitiveDraftSelected = true
        let store = makeStore(service)
        await store.open()
        let item = try XCTUnwrap(store.pendingItems.first)
        XCTAssertTrue(item.requiresJudgment)
        XCTAssertTrue(store.selectedItemIDs.contains(item.id))
        XCTAssertNil(store.decisions[item.id])
        XCTAssertTrue(store.canSave, "The independent contact decision must remain available.")
        await store.save()
        XCTAssertEqual(service.contactCommits, 1)
        XCTAssertEqual(service.itemCommits, 0)
        XCTAssertEqual(service.batchCommits, 0)
        XCTAssertEqual(store.phase, .review)
        XCTAssertEqual(store.pendingItems.count, 1)
        XCTAssertFalse(store.canSave, "After adding the contact, selected sensitive Memory still requires its own decision.")
    }

    func testLostSaveResponseFreezesExactOperationAcrossReopenAndNeverSendsAgain() async throws {
        let service = MemoryFixtureService()
        service.failCommitAfterApply = true
        service.operationState = "pending"
        let defaults = isolatedDefaults()
        let store = makeStore(service, defaults: defaults)
        await store.open(); await store.save()
        XCTAssertEqual(store.phase, .unknown)
        XCTAssertFalse(store.canSave)
        let operation = try XCTUnwrap(service.lastOperation)
        await store.save()
        XCTAssertEqual(service.contactCommits, 1)
        let restored = makeStore(service, defaults: defaults)
        await restored.open()
        XCTAssertEqual(restored.phase, .unknown)
        XCTAssertEqual(service.lastReadOperation, operation)
        service.operationState = "applied"
        await restored.reconcile()
        XCTAssertEqual(restored.phase, .saved)
        XCTAssertEqual(service.contactCommits, 1)
        XCTAssertEqual(service.lastReadOperation, operation)
        let allStoredValues = defaults.dictionaryRepresentation().values.map { String(describing: $0) }.joined()
        XCTAssertFalse(allStoredValues.contains("private-review-credential"))
    }

    func testPredispatchOfflineContactResumesExactProtectedIntentAfterRecreation() async throws {
        let service = MemoryFixtureService(); service.preDispatchFailures = 1; service.operationState = "unavailable"
        let defaults = isolatedDefaults()
        let store = makeStore(service, defaults: defaults)
        await store.open(); await store.save()
        XCTAssertEqual(store.phase, .unknown)
        XCTAssertFalse(store.canSave)
        let originalKey = try XCTUnwrap(service.contactKeys.first)
        let restored = makeStore(service, defaults: defaults)
        await restored.open()
        XCTAssertEqual(restored.phase, .saved)
        XCTAssertEqual(service.contactKeys, [originalKey, originalKey])
        XCTAssertEqual(service.appliedOperationKeys, [originalKey])
        XCTAssertFalse(defaults.dictionaryRepresentation().description.contains("Synthetic Contact"))
    }

    func testHistoricalImageSourceBelongsToSessionWithoutMatchingAnswerTurn() async {
        let service = MemoryFixtureService()
        let answerTurn = UUID()
        let store = ConversationMemoryReviewStore(proposal: service.proposal, sessionID: service.session,
            sourceMessageID: answerTurn, sourceMessageIDs: [service.message, answerTurn], client: service,
            defaults: isolatedDefaults(), intentPersistence: service.intentPersistence)
        await store.open()
        XCTAssertEqual(store.phase, .review)
        XCTAssertTrue(store.canSave)
        XCTAssertEqual(UUID(uuidString: store.review?.source_message_id ?? ""), service.message)
    }

    func testPredispatchOfflineItemReplaysSameProtectedTextAndKey() async throws {
        let service = MemoryFixtureService(); service.hasItem = true; service.secondItem = true
        let defaults = isolatedDefaults()
        let store = makeStore(service, defaults: defaults)
        await store.open(); await store.save()
        let item = try XCTUnwrap(store.pendingItems.first)
        store.selectedItemIDs.insert(item.id)
        store.editedText[item.id] = "Explicit source correction."
        service.itemPredispatchFailures = 1; service.operationState = "unavailable"
        await store.save()
        XCTAssertEqual(store.phase, .unknown)
        let key = try XCTUnwrap(service.lastItemBody?.idempotency_key)
        let restored = makeStore(service, defaults: defaults)
        await restored.open()
        XCTAssertEqual(restored.phase, .review)
        XCTAssertEqual(service.itemKeys, [key, key])
        XCTAssertEqual(service.appliedIDs, [item.id])
        XCTAssertEqual(service.lastItemBody?.edited_text, "Explicit source correction.")
        XCTAssertEqual(restored.pendingItems.count, 1)
    }

    func testOriginalCompletionBetweenPendingReadAndReauthorizationKeepsOperationIdentity() async throws {
        let service = MemoryFixtureService(); service.failCommitAfterApply = true; service.operationState = "pending"
        let store = makeStore(service)
        await store.open(); await store.save()
        let key = try XCTUnwrap(service.lastOperation)
        service.completeBeforeNextReplay = true
        await store.reconcile()
        XCTAssertEqual(store.phase, .saved)
        XCTAssertEqual(store.destination?.operationKey, key)
        XCTAssertEqual(service.contactCommits, 1)
        XCTAssertEqual(service.lastReadOperation, key)
    }

    func testReadbackFailureNeverReportsSaveSuccessAndKeepsOperation() async {
        let service = MemoryFixtureService(); service.failPersonRead = true
        let store = makeStore(service)
        await store.open(); await store.save()
        XCTAssertEqual(store.phase, .unknown)
        XCTAssertNil(store.destination)
        let operation = service.lastOperation
        service.failPersonRead = false
        await store.reconcile()
        XCTAssertEqual(store.phase, .saved)
        XCTAssertEqual(operation, service.lastReadOperation)
        XCTAssertEqual(service.contactCommits, 1)
    }

    func testChangedSourceMessageOrSessionCannotAcquireAuthority() async {
        let service = MemoryFixtureService()
        let wrongMessage = ConversationMemoryReviewStore(proposal: service.proposal, sessionID: service.session,
            sourceMessageID: UUID(), client: service, defaults: isolatedDefaults())
        await wrongMessage.open()
        XCTAssertFalse(wrongMessage.canSave)
        XCTAssertNil(wrongMessage.review)
        let wrongSession = ConversationMemoryReviewStore(proposal: service.proposal, sessionID: UUID(),
            sourceMessageID: service.message, client: service, defaults: isolatedDefaults())
        await wrongSession.open(); await wrongSession.save()
        XCTAssertFalse(wrongSession.canSave)
        XCTAssertEqual(service.contactCommits, 0)
    }

    func testAmbiguousIdentityHasNoDefaultSaveAndNeedsExplicitChoice() async {
        let service = MemoryFixtureService(); service.contactStatus = "ambiguous"
        let store = makeStore(service)
        await store.open(); await store.save()
        XCTAssertTrue(store.needsIdentityChoice)
        XCTAssertFalse(store.canSave)
        XCTAssertEqual(service.contactCommits, 0)
    }

    func testStaleRevisionRejectsOldMutationAndRequiresNewReview() async {
        let service = MemoryFixtureService()
        service.commitFailure = .backend(status: 409, code: "MEMORY_REVIEW_REBASE_REQUIRED", operationKey: nil)
        let store = makeStore(service)
        await store.open(); await store.save()
        XCTAssertEqual(store.phase, .stale)
        XCTAssertNil(store.destination)
        XCTAssertFalse(store.canSave)
        service.commitFailure = nil; service.revision = 2
        await store.open()
        XCTAssertEqual(store.review?.proposal_revision, 2)
        XCTAssertTrue(store.canSave)
    }

    func testProcessedAndDismissedTerminalMetadataDoNotCreateAnotherWrite() async {
        let service = MemoryFixtureService()
        service.lastOperation = UUID().uuidString.lowercased()
        service.openFailure = .backend(status: 409, code: "MEMORY_REVIEW_PROCESSED", operationKey: service.lastOperation)
        let store = makeStore(service)
        await store.open()
        XCTAssertEqual(store.phase, .saved)
        XCTAssertEqual(service.contactCommits, 0)
        let dismissedService = MemoryFixtureService()
        dismissedService.openFailure = .backend(status: 409, code: "MEMORY_REVIEW_DISMISSED", operationKey: nil)
        let dismissed = makeStore(dismissedService)
        await dismissed.open()
        XCTAssertEqual(dismissed.phase, .dismissed)
        XCTAssertEqual(dismissedService.contactCommits, 0)
    }

    func testItemBearingDecisionPreservesUnselectedItemsAndExpectedVersions() async throws {
        let service = MemoryFixtureService(); service.hasItem = true; service.secondItem = true
        let store = makeStore(service)
        await store.open()
        XCTAssertEqual(store.selectedCount, 0)
        await store.save() // Contact only; both Memory siblings remain pending.
        XCTAssertEqual(service.contactCommits, 1)
        XCTAssertEqual(store.phase, .review)
        XCTAssertEqual(store.pendingItems.count, 2)
        XCTAssertNotNil(store.destination)
        let item = try XCTUnwrap(store.pendingItems.first)
        store.selectedItemIDs.insert(item.id)
        store.editedText[item.id] = "The source says the project is paused."
        await store.save()
        XCTAssertEqual(service.itemCommits, 1)
        XCTAssertEqual(service.batchCommits, 0)
        XCTAssertEqual(service.lastItemBody?.expected_item_version, 4)
        XCTAssertEqual(service.lastItemBody?.edited_text, "The source says the project is paused.")
        XCTAssertEqual(store.destination?.savedItemCount, 1)
        XCTAssertEqual(store.phase, .review)
        XCTAssertEqual(store.pendingItems.count, 1, "Saving one item must not skip the other.")
    }

    func testOrdinarySourceNavigationPreservesDraftButReauthorizes() async {
        let service = MemoryFixtureService()
        let store = makeStore(service)
        await store.open()
        store.displayName = "Corrected local name"
        store.suspend()
        XCTAssertEqual(store.phase, .idle)
        XCTAssertFalse(store.canSave)
        await store.open()
        XCTAssertEqual(store.phase, .review)
        XCTAssertEqual(store.displayName, "Corrected local name")
    }

    func testUncertainIdentityChangeCannotUnlockOldRevisionAfterRecreation() async {
        let service = MemoryFixtureService(); service.failRebase = true
        let defaults = isolatedDefaults()
        let store = makeStore(service, defaults: defaults)
        await store.open()
        await store.chooseNewContact(name: "Corrected contact", relationship: "")
        XCTAssertEqual(store.phase, .unknown)
        let restored = makeStore(service, defaults: defaults)
        await restored.open()
        XCTAssertEqual(restored.phase, .unknown)
        XCTAssertFalse(restored.canSave)
        await restored.save()
        XCTAssertEqual(service.contactCommits, 0)
        service.revision = 2
        await restored.reconcile()
        XCTAssertEqual(restored.phase, .review)
        XCTAssertTrue(restored.canSave)
        XCTAssertEqual(service.rebaseKeys.count, 1, "Recovery must not send a different identity operation.")
    }

    func testPredispatchIdentityChangeReplaysSameProtectedBodyAndKey() async throws {
        let service = MemoryFixtureService(); service.failRebase = true
        let defaults = isolatedDefaults()
        let store = makeStore(service, defaults: defaults)
        await store.open(); await store.chooseNewContact(name: "Corrected contact", relationship: "Project partner")
        let originalKey = try XCTUnwrap(service.rebaseKeys.first)
        let restored = makeStore(service, defaults: defaults)
        await restored.open()
        XCTAssertEqual(restored.phase, .unknown)
        service.failRebase = false
        await restored.reconcile()
        XCTAssertEqual(restored.phase, .review)
        XCTAssertEqual(service.rebaseKeys, [originalKey, originalKey])
        XCTAssertFalse(defaults.dictionaryRepresentation().description.contains("Project partner"))
    }

    func testUncertainDismissalReplaysExactOriginalKeyAndScope() async throws {
        let service = MemoryFixtureService(); service.dismissFailuresRemaining = 1
        let defaults = isolatedDefaults()
        let store = makeStore(service, defaults: defaults)
        await store.open(); await store.dismiss()
        XCTAssertEqual(store.phase, .unknown)
        let originalKey = try XCTUnwrap(service.dismissKeys.first)
        let restored = makeStore(service, defaults: defaults)
        await restored.open()
        XCTAssertEqual(restored.phase, .dismissed)
        XCTAssertEqual(service.dismissKeys, [originalKey, originalKey])
    }

    func testUnavailableSourceAndInvalidationBlockMutations() async {
        let service = MemoryFixtureService(); service.sourceAvailable = false
        let store = makeStore(service)
        await store.open(); await store.save()
        XCTAssertFalse(store.canSave)
        XCTAssertEqual(store.phase, .unavailable)
        XCTAssertEqual(service.contactCommits, 0)
        store.invalidate()
        XCTAssertNil(store.review)
        XCTAssertNil(store.destination)
        XCTAssertEqual(store.phase, .stale)
    }

    func testRevokedSourceScrubsProtectedIntentButRetainsSafeOperationLocator() async {
        let service = MemoryFixtureService(); service.failCommitAfterApply = true
        let defaults = isolatedDefaults()
        let store = makeStore(service, defaults: defaults)
        await store.open(); await store.save()
        XCTAssertEqual(store.phase, .unknown)
        XCTAssertEqual(service.intentPersistence.count, 1)
        service.operationState = "source_revoked"
        await store.reconcile()
        XCTAssertEqual(store.phase, .stale)
        XCTAssertEqual(service.intentPersistence.count, 0)
        XCTAssertNil(store.review)
        XCTAssertTrue(defaults.dictionaryRepresentation().keys.contains { $0.hasPrefix("talent-signal.memory-operation.v2.") })
    }

    func testScopeInvalidationScrubsOnlyCurrentAccountProtectedIntents() async throws {
        let service = MemoryFixtureService(); service.failCommitAfterApply = true
        let store = makeStore(service)
        await store.open(); await store.save()
        let otherPrefix = ConversationMemoryIntentRetention.accountPrefix(binding: "another-account")
        try service.intentPersistence.save(Data("other protected intent".utf8), key: otherPrefix + "unrelated")
        XCTAssertEqual(service.intentPersistence.count, 2)
        store.invalidate()
        XCTAssertEqual(service.intentPersistence.count, 1)
        XCTAssertNotNil(try service.intentPersistence.load(key: otherPrefix + "unrelated"))
    }

    func testProtectedIntentExpiryRemovesExactExpiredEntryAtBoundary() throws {
        let persistence = InMemoryConversationMemoryIntents()
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        persistence.seed(Data("expired private draft".utf8), key: "expired", modifiedAt: now.addingTimeInterval(-86_400))
        persistence.seed(Data("active private draft".utf8), key: "active", modifiedAt: now.addingTimeInterval(-86_399))
        try persistence.removeExpired(now: now)
        XCTAssertNil(try persistence.load(key: "expired"))
        XCTAssertNotNil(try persistence.load(key: "active"))
        XCTAssertEqual(persistence.count, 1)
    }

    func testStoreEntrySweepsExpiredPrivateIntentAndPreservesActiveEntry() throws {
        let service = MemoryFixtureService()
        let now = Date()
        service.intentPersistence.seed(Data("expired".utf8), key: "expired-service-entry", modifiedAt: now.addingTimeInterval(-86_401))
        service.intentPersistence.seed(Data("active".utf8), key: "active-service-entry", modifiedAt: now)
        _ = makeStore(service)
        XCTAssertNil(try service.intentPersistence.load(key: "expired-service-entry"))
        XCTAssertNotNil(try service.intentPersistence.load(key: "active-service-entry"))
    }

    private func isolatedDefaults() -> UserDefaults {
        let name = "conversation-memory-tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        return defaults
    }
    private func makeStore(_ service: MemoryFixtureService, defaults: UserDefaults? = nil) -> ConversationMemoryReviewStore {
        .init(proposal: service.proposal, sessionID: service.session, sourceMessageID: service.message,
            client: service, defaults: defaults ?? isolatedDefaults(), intentPersistence: service.intentPersistence)
    }
}

private final class MemoryFixtureService: ConversationMemoryReviewServing {
    let intentPersistence = InMemoryConversationMemoryIntents()
    let accountBinding = UUID().uuidString
    var reviewScope: ConversationMemoryReviewScope = .chat
    var allowedScopeOverride: String?
    var emitSelfItem = false
    let proposal = ConversationMemoryProposalReference(proposal_id: UUID().uuidString.lowercased(), revision: 1)
    let session = UUID(); let message = UUID(); let personID = UUID().uuidString.lowercased(); let itemID = UUID().uuidString.lowercased()
    let contextID = UUID().uuidString.lowercased()
    var revision = 1; var reviewRevision = 0; var contactStatus = "pending"; var sourceAvailable = true; var hasItem = false
    var secondItem = false; var contactCreated = false; var appliedIDs = Set<String>()
    var sensitiveDraftSelected = false
    let secondItemID = UUID().uuidString.lowercased()
    var lastItemBody: ConversationMemoryItemDecision?; var itemCommits = 0
    var lastWasContact = true; var dismissFailuresRemaining = 0; var dismissKeys: [String] = []; var dismissed = false
    var failRebase = false; var rebaseKeys: [String] = []
    var openFailure: ConversationMemoryReviewError?; var commitFailure: ConversationMemoryReviewError?
    var failCommitAfterApply = false; var failPersonRead = false; var operationState = "applied"
    var preDispatchFailures = 0; var contactKeys: [String] = []; var appliedOperationKeys = Set<String>()
    var itemPredispatchFailures = 0; var itemKeys: [String] = []
    var completeBeforeNextReplay = false
    var contactCommits = 0; var batchCommits = 0; var personReads = 0
    var lastOperation: String?; var lastReadOperation: String?; var lastBody: ConversationMemoryCommit?
    private let reviewID = UUID().uuidString.lowercased()
    private let commitID = UUID().uuidString.lowercased()

    func open(proposalID: String, sessionID: UUID) async throws -> ConversationMemoryReviewEnvelope {
        if let openFailure { throw openFailure }
        if dismissed { throw ConversationMemoryReviewError.backend(status: 409, code: "MEMORY_REVIEW_DISMISSED", operationKey: nil) }
        var items: [[String: Any]] = []
        if hasItem {
            items = (secondItem ? [itemID, secondItemID] : [itemID]).map { id in
                ["id": id, "scope": emitSelfItem ? "self" : reviewScope == .chat ? "person" : "relationship",
                "subject_id": personID, "relationship_context_id": contextID,
                "operation": "update", "statement_kind": "source_statement",
                "display_text": "The source says the project may be paused.", "previous_text": "The project was active.",
                "previous_revision": 4, "admission_status": sensitiveDraftSelected ? "needs_judgment" : "eligible",
                "judgment_kind": sensitiveDraftSelected ? "sensitive" : "ordinary", "default_selected": true,
                "source_excerpt": "We paused the project.", "source_locator": ["kind": "message", "session_id": session.uuidString, "message_id": message.uuidString],
                "added_revision": 1, "status": appliedIDs.contains(id) ? "committed" : "pending"]
            }
        }
        return try decode(["contract_version": TalentSignalAPIContract.version, "review_credential": "private-review-credential-for-tests",
            "review": ["contract_version": TalentSignalAPIContract.version, "review_scope_id": reviewID, "review_revision": reviewRevision,
                "purpose": reviewScope.purpose, "allowed_scope": allowedScopeOverride ?? reviewScope.allowedScope,
                "proposal_id": proposal.proposal_id, "proposal_revision": revision,
                "person_display_label": "Synthetic Contact", "source_session_id": session.uuidString,
                "person_id": contactCreated ? personID as Any : NSNull(),
                "relationship_context_id": reviewScope == .chat ? NSNull() : contextID as Any,
                "source_message_id": message.uuidString, "contact_decision": contactCreated ? "existing" : "new",
                "contact_status": contactCreated ? "resolved" : contactStatus,
                "status": "open", "expires_at": "2099-10-22T12:00:00Z", "source_status": sourceAvailable ? "available" : "unavailable",
                "items": items,
                "draft": sensitiveDraftSelected ? ["contact_decision": contactCreated ? "existing" : "new",
                    "selected_item_ids": [itemID], "edited_text": [:], "item_decisions": [:], "revision": reviewRevision] as Any : NSNull()]])
    }
    func commit(reviewID: String, credential: String, body: ConversationMemoryCommit) async throws -> ConversationMemoryReceipt {
        batchCommits += 1; return try apply(body)
    }
    func commitContact(reviewID: String, credential: String, body: ConversationMemoryCommit) async throws -> ConversationMemoryReceipt {
        contactCommits += 1; lastWasContact = true; contactKeys.append(body.idempotency_key)
        if preDispatchFailures > 0 { preDispatchFailures -= 1; lastOperation = body.idempotency_key; throw URLError(.notConnectedToInternet) }
        appliedOperationKeys.insert(body.idempotency_key)
        if operationState == "unavailable" { operationState = "applied" }
        let result = try apply(body); return result
    }
    private func apply(_ body: ConversationMemoryCommit) throws -> ConversationMemoryReceipt {
        if let commitFailure { throw commitFailure }
        lastBody = body; lastOperation = body.idempotency_key
        if !contactCreated { revision += 1; contactCreated = true }
        if failCommitAfterApply { throw URLError(.networkConnectionLost) }
        return try receipt()
    }
    private func receipt() throws -> ConversationMemoryReceipt {
        let created = lastWasContact ? [] : lastItemBody.map { [$0.item_id] } ?? []
        return try decode(["contract_version": TalentSignalAPIContract.version, "commit_id": commitID,
            "operation_key": lastOperation ?? UUID().uuidString, "proposal_id": proposal.proposal_id,
            "proposal_revision": revision, "status": "applied", "contact_decision": lastWasContact ? "new" : "existing",
            "created_person_id": lastWasContact ? personID as Any : NSNull(),
            "person_display_label": "Synthetic Contact", "applied_item_count": created.count,
            "created_item_ids": created, "updated_item_ids": []])
    }
    func decideItem(reviewID: String, credential: String, body: ConversationMemoryItemDecision) async throws -> ConversationMemoryItemDecisionResponse {
        itemCommits += 1; lastWasContact = false; lastItemBody = body; lastOperation = body.idempotency_key
        itemKeys.append(body.idempotency_key)
        if itemPredispatchFailures > 0 { itemPredispatchFailures -= 1; throw URLError(.notConnectedToInternet) }
        if operationState == "unavailable" { operationState = "applied" }
        if let commitFailure { throw commitFailure }
        if appliedIDs.insert(body.item_id).inserted { revision += 1 }
        let receiptObject = try receiptObject(key: body.idempotency_key)
        return try decode(["contract_version": TalentSignalAPIContract.version, "kind": "committed", "item_id": body.item_id,
            "receipt": receiptObject, "proposal_revision": revision, "remaining_pending_item_count": secondItem ? 1 : 0])
    }
    private func receiptObject(key: String) throws -> [String: Any] {
        ["contract_version": TalentSignalAPIContract.version, "commit_id": commitID,
            "operation_key": key, "proposal_id": proposal.proposal_id, "proposal_revision": revision,
            "status": "applied", "contact_decision": lastWasContact ? "new" : "existing",
            "created_person_id": lastWasContact ? self.personID as Any : NSNull(),
            "person_display_label": "Synthetic Contact", "applied_item_count": lastWasContact ? 0 : 1,
            "created_item_ids": lastWasContact ? [] : [lastItemBody?.item_id ?? itemID], "updated_item_ids": []]
    }
    func operation(key: String, sessionID: UUID, personID: String?) async throws -> ConversationMemoryOperationView {
        lastReadOperation = key
        let observedState = operationState
        if completeBeforeNextReplay {
            completeBeforeNextReplay = false; operationState = "applied"
            openFailure = .backend(status: 409, code: "MEMORY_REVIEW_PROCESSED", operationKey: key)
        }
        return try decode(["contract_version": TalentSignalAPIContract.version, "operation_key": key,
            "state": observedState, "purpose": reviewScope.purpose, "source_session_id": session.uuidString,
            "relationship_context_id": reviewScope == .chat ? NSNull() : contextID as Any,
            "person_id": personID as Any? ?? NSNull(), "visible_receipt": try receiptObject(key: key)])
    }
    func verifyPerson(id: String) async throws -> ConversationMemoryPerson {
        personReads += 1
        if failPersonRead { throw URLError(.notConnectedToInternet) }
        return try decode(["id": id, "display_label": "Synthetic Contact", "contexts": []])
    }
    func dismiss(reviewID: String, credential: String, revision: Int, operationKey: String) async throws {
        dismissKeys.append(operationKey)
        if dismissFailuresRemaining > 0 { dismissFailuresRemaining -= 1; throw URLError(.notConnectedToInternet) }
        dismissed = true
    }
    func rebase(proposalID: String, body: ConversationMemoryRebase) async throws -> ConversationMemoryRebaseResponse {
        rebaseKeys.append(body.idempotency_key)
        if failRebase { throw URLError(.networkConnectionLost) }
        revision += 1
        return try decode(["contract_version": TalentSignalAPIContract.version, "proposal": ["proposal_id": proposalID, "revision": revision]])
    }
    func searchPeople(query: String) async throws -> [ConversationMemoryPerson] { [] }
    func saveDraft(reviewID: String, credential: String, body: ConversationMemoryDraftUpdate) async throws -> ConversationMemoryReviewEnvelope {
        reviewRevision = body.expected_review_revision + 1
        return try await open(proposalID: proposal.proposal_id, sessionID: session)
    }
    private func decode<T: Decodable>(_ object: Any) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: object))
    }
}

private final class InMemoryConversationMemoryIntents: ConversationMemoryOperationPersisting {
    private var values: [String: Data] = [:]
    private var modifiedDates: [String: Date] = [:]
    var count: Int { values.count }
    func load(key: String) throws -> Data? { values[key] }
    func save(_ data: Data, key: String) throws { seed(data, key: key, modifiedAt: Date()) }
    func remove(key: String) throws { values.removeValue(forKey: key); modifiedDates.removeValue(forKey: key) }
    func seed(_ data: Data, key: String, modifiedAt: Date) { values[key] = data; modifiedDates[key] = modifiedAt }
    func removeExpired(now: Date) throws {
        let metadata = modifiedDates.map { ConversationMemoryIntentRetention.Metadata(key: $0.key, modifiedAt: $0.value) }
        for key in ConversationMemoryIntentRetention.expiredKeys(metadata, now: now) { try remove(key: key) }
    }
    func removeAccount(prefix: String) throws {
        for key in Array(values.keys) where key.hasPrefix(prefix) { try remove(key: key) }
    }
}
