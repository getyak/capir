import ActivityKit
import Foundation

enum ResearchActivityExecution: String, Codable, Hashable {
    case running
    case completed
    case cancelled

    var isTerminal: Bool {
        self != .running
    }
}

enum ResearchActivityStage: String, Codable, Hashable {
    case readingApprovedPages
    case pagesReadyForReview
    case ended
}

struct ResearchActivityAttributes: ActivityAttributes, Hashable {
    static let currentSchemaVersion = 1

    struct ContentState: Codable, Hashable {
        let execution: ResearchActivityExecution
        let stage: ResearchActivityStage
        let eventRevision: Int64
        let updatedAt: Date
    }

    let schemaVersion: Int
    let scopeID: String
    let taskID: String
    let activityInstanceID: String
}

enum ResearchActivityAction: String, Codable, Hashable {
    case openStatus
    case openReview

    var title: String {
        switch self {
        case .openStatus: return researchLocalized("Open status")
        case .openReview: return researchLocalized("Open review")
        }
    }
}

struct ResearchActivityViewState: Equatable, Hashable {
    let eyebrow: String
    let title: String
    let supportingText: String
    let boundaryText: String
    let action: ResearchActivityAction?
    let accessibilityLabel: String
    let isTerminal: Bool
    let displayStatus: LiveActivityDisplayStatus
}

enum ResearchActivityProjectionError: Error, Equatable {
    case unsupportedCombination(
        execution: ResearchActivityExecution,
        stage: ResearchActivityStage
    )
}

enum ResearchActivityProjector {
    static func presentation(
        _ state: ResearchActivityAttributes.ContentState,
        isSystemStale: Bool
    ) -> ResearchActivityViewState {
        guard let view = try? project(state) else {
            return viewState(
                eyebrow: researchLocalized("CHECK STATUS"),
                title: researchLocalized("Open capri"),
                supportingText: researchLocalized("This update needs review"),
                boundaryText: researchLocalized("Nothing used automatically"),
                action: nil,
                isTerminal: false,
                displayStatus: .attention
            )
        }
        guard view.action != nil, isSystemStale else { return view }
        return viewState(
            eyebrow: view.eyebrow,
            title: researchLocalized("Update delayed"),
            supportingText: researchLocalized("Open the app for current status"),
            boundaryText: view.boundaryText,
            action: view.action,
            isTerminal: view.isTerminal,
            displayStatus: .delayed
        )
    }

    static func project(
        _ state: ResearchActivityAttributes.ContentState
    ) throws -> ResearchActivityViewState {
        switch (state.execution, state.stage) {
        case (.running, .readingApprovedPages):
            return viewState(
                eyebrow: researchLocalized("SYNTHETIC RESEARCH"),
                title: researchLocalized("Reading approved pages"),
                supportingText: researchLocalized("You can leave"),
                boundaryText: researchLocalized("Public sources only"),
                action: .openStatus,
                isTerminal: false,
                displayStatus: .working
            )
        case (.completed, .pagesReadyForReview):
            return viewState(
                eyebrow: researchLocalized("RESEARCH READY"),
                title: researchLocalized("Pages ready for review"),
                supportingText: researchLocalized("Review required before use"),
                boundaryText: researchLocalized("Nothing used automatically"),
                action: .openReview,
                isTerminal: true,
                displayStatus: .review
            )
        case (.cancelled, .ended):
            return viewState(
                eyebrow: researchLocalized("ENDED"),
                title: researchLocalized("Research showcase ended"),
                supportingText: researchLocalized("No review is pending"),
                boundaryText: researchLocalized("Nothing used automatically"),
                action: nil,
                isTerminal: true,
                displayStatus: .ended
            )
        default:
            throw ResearchActivityProjectionError.unsupportedCombination(
                execution: state.execution,
                stage: state.stage
            )
        }
    }

    private static func viewState(
        eyebrow: String,
        title: String,
        supportingText: String,
        boundaryText: String,
        action: ResearchActivityAction?,
        isTerminal: Bool,
        displayStatus: LiveActivityDisplayStatus
    ) -> ResearchActivityViewState {
        ResearchActivityViewState(
            eyebrow: eyebrow,
            title: title,
            supportingText: supportingText,
            boundaryText: boundaryText,
            action: action,
            accessibilityLabel: [
                researchLocalized("capri Research"),
                title,
                supportingText,
                boundaryText,
            ].joined(separator: ". "),
            isTerminal: isTerminal,
            displayStatus: displayStatus
        )
    }
}

func researchLocalized(_ resource: LocalizedStringResource) -> String {
    String(localized: resource)
}

enum ResearchActivityPayloadViolation: Error, Equatable {
    case unsupportedSchema(Int)
    case invalidOpaqueIdentifier(field: String)
    case invalidRevision(Int64)
    case exceedsMaximumBytes(Int)
}

enum ResearchActivityPayloadContract {
    static let maximumEncodedBytes = 4_096
    private static let maximumIdentifierLength = 96
    private static let opaqueIdentifierCharacters = CharacterSet(
        charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_."
    )

    private struct PayloadEnvelope: Codable {
        let attributes: ResearchActivityAttributes
        let contentState: ResearchActivityAttributes.ContentState
    }

    static func validate(
        attributes: ResearchActivityAttributes,
        contentState: ResearchActivityAttributes.ContentState
    ) throws {
        guard attributes.schemaVersion == ResearchActivityAttributes.currentSchemaVersion else {
            throw ResearchActivityPayloadViolation.unsupportedSchema(
                attributes.schemaVersion
            )
        }
        try validateOpaque(attributes.scopeID, field: "scopeID")
        try validateOpaque(attributes.taskID, field: "taskID")
        try validateOpaque(
            attributes.activityInstanceID,
            field: "activityInstanceID"
        )
        guard contentState.eventRevision > 0 else {
            throw ResearchActivityPayloadViolation.invalidRevision(
                contentState.eventRevision
            )
        }
        _ = try ResearchActivityProjector.project(contentState)

        let size = try JSONEncoder().encode(
            PayloadEnvelope(attributes: attributes, contentState: contentState)
        ).count
        guard size <= maximumEncodedBytes else {
            throw ResearchActivityPayloadViolation.exceedsMaximumBytes(size)
        }
    }

    static func encodedByteCount(
        attributes: ResearchActivityAttributes,
        contentState: ResearchActivityAttributes.ContentState
    ) throws -> Int {
        try JSONEncoder().encode(
            PayloadEnvelope(attributes: attributes, contentState: contentState)
        ).count
    }

    static func isValidOpaqueIdentifier(_ value: String) -> Bool {
        !value.isEmpty
            && value.count <= maximumIdentifierLength
            && value.unicodeScalars.allSatisfy(opaqueIdentifierCharacters.contains)
    }

    private static func validateOpaque(_ value: String, field: String) throws {
        guard isValidOpaqueIdentifier(value) else {
            throw ResearchActivityPayloadViolation.invalidOpaqueIdentifier(
                field: field
            )
        }
    }
}

enum ResearchActivityTransitionDecision: Equatable {
    case apply
    case noOp
    case ignoreOlder
    case identityMismatch
    case sameRevisionConflict
    case terminalRegression
}

enum ResearchActivityTransitionPolicy {
    static func decision(
        currentAttributes: ResearchActivityAttributes,
        currentState: ResearchActivityAttributes.ContentState,
        proposedAttributes: ResearchActivityAttributes,
        proposedState: ResearchActivityAttributes.ContentState
    ) -> ResearchActivityTransitionDecision {
        guard currentAttributes == proposedAttributes else {
            return .identityMismatch
        }
        if proposedState.eventRevision < currentState.eventRevision {
            return .ignoreOlder
        }
        if proposedState.eventRevision == currentState.eventRevision {
            return proposedState == currentState ? .noOp : .sameRevisionConflict
        }
        if currentState.execution.isTerminal && !proposedState.execution.isTerminal {
            return .terminalRegression
        }
        return .apply
    }
}
