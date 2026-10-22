import Foundation
import XCTest
@testable import TalentSignal

final class ConversationMemorySourceIndexTests: XCTestCase {
    func testReviewSurfaceComesFromProducerAndExactCanonicalRelationshipScope() {
        let person = UUID().uuidString, context = UUID().uuidString
        let scope = AgentSessionScope.relationship(personID: person, relationshipContextID: context,
            personDisplayLabel: "Synthetic person", contextDisplayLabel: "Synthetic relationship")
        XCTAssertEqual(ConversationMemoryReviewScopePolicy.resolve(contextManifestID: "none-unbound-conversation", sessionScope: scope), .chat)
        XCTAssertEqual(ConversationMemoryReviewScopePolicy.resolve(contextManifestID: "", sessionScope: scope), .chat)
        XCTAssertEqual(ConversationMemoryReviewScopePolicy.resolve(contextManifestID: UUID().uuidString, sessionScope: scope),
                       .relationship(personID: person, contextID: context))
        XCTAssertNil(ConversationMemoryReviewScopePolicy.resolve(contextManifestID: UUID().uuidString, sessionScope: .unresolvedIntent))
        XCTAssertNil(ConversationMemoryReviewScopePolicy.resolve(contextManifestID: "none-unbound-person-research", sessionScope: scope))
        let invalid = AgentSessionScope.relationship(personID: "unverified", relationshipContextID: context,
            personDisplayLabel: "Synthetic person", contextDisplayLabel: "Synthetic relationship")
        XCTAssertNil(ConversationMemoryReviewScopePolicy.resolve(contextManifestID: UUID().uuidString, sessionScope: invalid))
    }

    func testCanonicalSupplementalTextKeepsItsIdentityAndRoutesToItsParent() {
        let parent = UUID(), source = UUID()
        let turn = makeTurn(id: parent, messages: [message(id: source)])
        let index = ConversationMemorySourceIndex(turns: [turn])
        XCTAssertEqual(index.messageIDs, [parent, source])
        XCTAssertEqual(index[source]?.parentTurnID, parent)
        XCTAssertEqual(index[source]?.supplementalText, "Add this person after reviewing the source.")
        XCTAssertEqual(index[source]?.images, [], "A text-only steering message cannot borrow an earlier screenshot.")
    }

    func testUnboundMalformedOrImageSteeringCannotBecomeAReviewSource() {
        let source = UUID()
        var wrongParent = makeTurn(messages: [message(id: source)])
        if case var .object(raw)? = wrongParent.canonicalWire {
            raw["id"] = .string(UUID().uuidString)
            wrongParent.canonicalWire = .object(raw)
        }
        XCTAssertNil(ConversationMemorySourceIndex(turns: [wrongParent])[source])
        var invalid = message(id: source)
        if case var .object(raw) = invalid {
            raw["images"] = .array([.object(["attachment_id": .string(UUID().uuidString)])])
            invalid = .object(raw)
        }
        XCTAssertNil(ConversationMemorySourceIndex(turns: [makeTurn(messages: [invalid])])[source])
        if case var .object(raw) = message(id: source) {
            raw["createdAt"] = .string("unverified-time")
            XCTAssertNil(ConversationMemorySourceIndex(turns: [makeTurn(messages: [.object(raw)])])[source])
        }
    }

    func testHostResultOwnIdentityAndCollidingSupplementalIdentitiesAreExcluded() {
        let hostID = UUID(), source = UUID()
        let host = makeTurn(id: hostID, messages: [message(id: source)], hostResult: true)
        let index = ConversationMemorySourceIndex(turns: [host])
        XCTAssertNil(index[hostID], "A host result is not a human-authored message.")
        XCTAssertEqual(index[source]?.parentTurnID, hostID)
        let duplicate = makeTurn(messages: [message(id: source)])
        XCTAssertNil(ConversationMemorySourceIndex(turns: [host, duplicate])[source],
                     "A conflicting identity must not be arbitrarily assigned to the first turn.")
    }

    private func message(id: UUID) -> JSONValue {
        .object(["id": .string(id.uuidString), "objective": .string("Add this person after reviewing the source."),
            "createdAt": .string("2026-10-22T10:00:01Z"), "images": .array([])])
    }

    private func makeTurn(id: UUID = UUID(), messages: [JSONValue], hostResult: Bool = false) -> AgentSessionTurn {
        let taskID = UUID().uuidString
        let response = RelationshipAskResponse(contractVersion: TalentSignalAPIContract.version, taskID: taskID,
            contextManifestID: "none-unbound-conversation", knowledgeSnapshotID: "none-unbound-conversation",
            disposition: "answer", blocks: [], createdAt: "2026-10-22T10:00:00Z")
        var wireResponse: [String: JSONValue] = ["taskID": .string(taskID)]
        if hostResult { wireResponse["hostResult"] = .object(["outcome": .string("confirmed")]) }
        return AgentSessionTurn(id: id, objective: "Synthetic source", response: response,
            createdAt: ISO8601DateFormatter().date(from: "2026-10-22T10:00:00Z")!, requiresRefresh: false,
            canonicalWire: .object(["id": .string(id.uuidString), "objective": .string("Synthetic source"),
                "createdAt": .string("2026-10-22T10:00:00Z"), "response": .object(wireResponse),
                "steeredMessages": .array(messages)]))
    }
}
