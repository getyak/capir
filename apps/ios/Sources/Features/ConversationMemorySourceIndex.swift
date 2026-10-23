import Foundation

/// The response producer chooses the review surface. A selected relationship
/// cannot upgrade an unbound queue reply into relationship write authority.
enum ConversationMemoryReviewScopePolicy {
    static func resolve(contextManifestID: String, sessionScope: AgentSessionScope) -> ConversationMemoryReviewScope? {
        if contextManifestID.isEmpty || contextManifestID == "none-unbound-conversation" { return .chat }
        guard UUID(uuidString: contextManifestID) != nil,
              case let .relationship(personID, contextID, _, _) = sessionScope,
              UUID(uuidString: personID) != nil, UUID(uuidString: contextID) != nil else { return nil }
        return .relationship(personID: personID, contextID: contextID)
    }
}

/// A view-only index of actual human messages retained by the current Session.
/// Folded steering text keeps its own identity and routes to its parent turn;
/// it never inherits that turn's images or host-authored result authority.
struct ConversationMemorySourceIndex {
    struct Target: Equatable {
        let parentTurnID: UUID
        let images: [ConversationImageManifest]
        let supplementalText: String?
    }
    private var targets: [UUID: Target] = [:]
    var messageIDs: Set<UUID> { Set(targets.keys) }
    subscript(_ messageID: UUID) -> Target? { targets[messageID] }

    init(turns: [AgentSessionTurn]) {
        let ownIDs = Set(turns.map(\.id))
        var supplemental: [(UUID, Target)] = []
        for turn in turns {
            let raw: [String: JSONValue]?
            if case let .object(value)? = turn.canonicalWire { raw = value } else { raw = nil }
            let hostResult: Bool
            if case let .object(response)? = raw?["response"], case .object? = response["hostResult"] {
                hostResult = true
            } else { hostResult = false }
            if !hostResult {
                targets[turn.id] = Target(parentTurnID: turn.id, images: turn.images, supplementalText: nil)
            }
            guard let raw, case let .string(rawID)? = raw["id"], UUID(uuidString: rawID) == turn.id,
                  case let .string(objective)? = raw["objective"], objective == turn.objective,
                  case let .string(stamp)? = raw["createdAt"], let created = ConversationImageTimestamp.parse(stamp),
                  abs(created.timeIntervalSince(turn.createdAt)) < 0.001,
                  case let .object(response)? = raw["response"],
                  case let .string(taskID)? = response["taskID"], taskID.lowercased() == turn.response.taskID.lowercased(),
                  case let .array(messages)? = raw["steeredMessages"], messages.count <= 20 else { continue }
            for value in messages {
                guard case let .object(message) = value,
                      case let .string(rawID)? = message["id"], let id = UUID(uuidString: rawID),
                      case let .string(text)? = message["objective"], text.utf16.count <= 12_000,
                      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      case let .string(stamp)? = message["createdAt"], ConversationImageTimestamp.parse(stamp) != nil else { continue }
                // The current host explicitly rejects image steering. Never
                // borrow the initial image for a later text-only human message.
                if let images = message["images"], images != .array([]) { continue }
                supplemental.append((id, Target(parentTurnID: turn.id, images: [], supplementalText: text)))
            }
        }
        let counts = Dictionary(grouping: supplemental, by: { $0.0 }).mapValues(\.count)
        for (id, target) in supplemental where !ownIDs.contains(id) && counts[id] == 1 { targets[id] = target }
    }
}
