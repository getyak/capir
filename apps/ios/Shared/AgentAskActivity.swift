import ActivityKit
import Foundation

enum AgentAskActivityPhase: String, Codable, Hashable {
    case thinking
    case review
    case failed
    case timedOut

    var isTerminal: Bool { self != .thinking }
}

struct AgentAskActivityAttributes: ActivityAttributes, Hashable {
    static let currentSchemaVersion = 1

    struct ContentState: Codable, Hashable {
        let phase: AgentAskActivityPhase
        let eventRevision: Int64
        let updatedAt: Date
    }

    let schemaVersion: Int
    let workspaceID: String
    let sessionID: String
    let activityInstanceID: String
}

struct AgentAskActivityIdentity: Codable, Equatable, Hashable {
    let workspaceID: String
    let sessionID: String
    let activityInstanceID: String
}

enum AgentAskActivityAction: String, Equatable {
    case open
    case retry
}

struct AgentAskActivityViewState: Equatable {
    let phase: AgentAskActivityPhase
    let title: String
    let compactTitle: String?
    let actionTitle: String?
    let action: AgentAskActivityAction?
    let accessibilityLabel: String
}

enum AgentAskActivityProjector {
    static func presentation(
        _ state: AgentAskActivityAttributes.ContentState,
        isSystemStale: Bool,
        locale: Locale = .autoupdatingCurrent
    ) -> AgentAskActivityViewState {
        let phase: AgentAskActivityPhase = isSystemStale && state.phase == .thinking
            ? .timedOut
            : state.phase
        switch phase {
        case .thinking:
            return .init(
                phase: phase,
                title: localized("Agent", locale: locale),
                compactTitle: nil,
                actionTitle: nil,
                action: .open,
                accessibilityLabel: localized(
                    "capri Agent is preparing a response.",
                    locale: locale
                )
            )
        case .review:
            return .init(
                phase: phase,
                title: "Review",
                compactTitle: "Review",
                actionTitle: localized("Open", locale: locale),
                action: .open,
                accessibilityLabel: localized(
                    "capri Agent response is ready to review.",
                    locale: locale
                )
            )
        case .failed:
            return .init(
                phase: phase,
                title: localized("Couldn't connect", locale: locale),
                compactTitle: nil,
                actionTitle: localized("Retry", locale: locale),
                action: .retry,
                accessibilityLabel: localized(
                    "capri Agent did not connect. Open the protected Session to retry.",
                    locale: locale
                )
            )
        case .timedOut:
            return .init(
                phase: phase,
                title: localized("Still waiting", locale: locale),
                compactTitle: nil,
                actionTitle: localized("Retry", locale: locale),
                action: .retry,
                accessibilityLabel: localized(
                    "capri Agent response is delayed. Open the protected Session to check or retry.",
                    locale: locale
                )
            )
        }
    }

    private static func localized(_ key: String, locale: Locale) -> String {
        guard locale.identifier.lowercased().hasPrefix("zh") else { return key }
        guard let path = Bundle.main.path(forResource: "zh-Hans", ofType: "lproj"),
              let bundle = Bundle(path: path) else { return key }
        return bundle.localizedString(forKey: key, value: key, table: nil)
    }
}

enum AgentAskActivityPayloadViolation: Error, Equatable {
    case unsupportedSchema(Int)
    case invalidOpaqueIdentifier(field: String)
    case invalidRevision(Int64)
    case exceedsMaximumBytes(Int)
}

enum AgentAskActivityPayloadContract {
    static let maximumEncodedBytes = 4_096
    private static let maximumIdentifierLength = 96
    private static let opaqueCharacters = CharacterSet(
        charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_."
    )

    private struct Envelope: Codable {
        let attributes: AgentAskActivityAttributes
        let state: AgentAskActivityAttributes.ContentState
    }

    static func validate(
        attributes: AgentAskActivityAttributes,
        state: AgentAskActivityAttributes.ContentState
    ) throws {
        guard attributes.schemaVersion == AgentAskActivityAttributes.currentSchemaVersion else {
            throw AgentAskActivityPayloadViolation.unsupportedSchema(attributes.schemaVersion)
        }
        for (field, value) in [
            ("workspaceID", attributes.workspaceID),
            ("sessionID", attributes.sessionID),
            ("activityInstanceID", attributes.activityInstanceID),
        ] {
            guard !value.isEmpty,
                  value.count <= maximumIdentifierLength,
                  value.unicodeScalars.allSatisfy(opaqueCharacters.contains) else {
                throw AgentAskActivityPayloadViolation.invalidOpaqueIdentifier(field: field)
            }
        }
        guard state.eventRevision > 0 else {
            throw AgentAskActivityPayloadViolation.invalidRevision(state.eventRevision)
        }
        let bytes = try JSONEncoder().encode(Envelope(attributes: attributes, state: state)).count
        guard bytes <= maximumEncodedBytes else {
            throw AgentAskActivityPayloadViolation.exceedsMaximumBytes(bytes)
        }
    }
}

enum AgentAskActivityTransitionDecision: Equatable {
    case apply
    case noOp
    case ignoreOlder
    case sameRevisionConflict
    case terminalRegression
}

enum AgentAskActivityTransitionPolicy {
    static func decision(
        from current: AgentAskActivityAttributes.ContentState,
        to proposed: AgentAskActivityAttributes.ContentState
    ) -> AgentAskActivityTransitionDecision {
        if proposed.eventRevision < current.eventRevision { return .ignoreOlder }
        if proposed.eventRevision == current.eventRevision {
            return proposed == current ? .noOp : .sameRevisionConflict
        }
        if current.phase.isTerminal && proposed.phase != current.phase {
            return .terminalRegression
        }
        return .apply
    }
}
