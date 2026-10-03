import Foundation

enum ConversationRecognitionError: LocalizedError, Equatable {
    case unreadableImage
    case noText
    case noConversationEvidence
    case sharedPreprocessingUnavailable
    case sharedPreprocessingFailed
    case preprocessingCleanupReceiptUnavailable

    var errorDescription: String? {
        switch self {
        case .unreadableImage:
            return "The selected file is not a readable image."
        case .noText:
            return "No readable conversation text was found. Try a clearer screenshot."
        case .noConversationEvidence:
            return "This image contains profile details but no conversation messages, so it cannot be saved as conversation evidence."
        case .sharedPreprocessingUnavailable:
            return "Shared screenshot preprocessing is unavailable. Reconnect to capri and retry."
        case .sharedPreprocessingFailed:
            return "Shared screenshot preprocessing did not produce reviewable evidence. Retry with the original screenshot."
        case .preprocessingCleanupReceiptUnavailable:
            return "The preprocessing cleanup receipt has not been recovered. Retry processing before removing this capture."
        }
    }
}

struct CaptureDraftBuilder {
    static func makeDraft(from text: String) -> RecognizedCaptureDraft {
        var draft = RecognizedCaptureDraft.empty
        draft.reviewedText = text

        if let email = firstMatch(
            pattern: #"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#,
            in: text,
            options: [.caseInsensitive]
        ) {
            draft.handleType = .email
            draft.handleValue = email
            return draft
        }

        if let phone = firstMatch(
            pattern: #"(?<!\d)(?:\+?\d[\d\s\-()]{6,}\d)(?!\d)"#,
            in: text
        ) {
            draft.handleType = .phone
            draft.handleValue = normalizedPhone(phone)
            return draft
        }

        if let wechat = firstCapturedGroup(
            pattern: #"(?:微信|WeChat|微信号)\s*[:：]?\s*([A-Za-z][A-Za-z0-9_-]{5,19})"#,
            in: text,
            options: [.caseInsensitive]
        ) {
            draft.handleType = .wechat
            draft.handleValue = wechat
        }
        return draft
    }

    private static func normalizedPhone(_ value: String) -> String {
        let hasPlus = value.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("+")
        let digits = value.filter(\.isNumber)
        return hasPlus ? "+\(digits)" : digits
    }

    private static func firstMatch(
        pattern: String,
        in text: String,
        options: NSRegularExpression.Options = []
    ) -> String? {
        guard let expression = try? NSRegularExpression(pattern: pattern, options: options) else {
            return nil
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = expression.firstMatch(in: text, range: range),
              let swiftRange = Range(match.range, in: text) else {
            return nil
        }
        return String(text[swiftRange])
    }

    private static func firstCapturedGroup(
        pattern: String,
        in text: String,
        options: NSRegularExpression.Options = []
    ) -> String? {
        guard let expression = try? NSRegularExpression(pattern: pattern, options: options) else {
            return nil
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = expression.firstMatch(in: text, range: range),
              match.numberOfRanges > 1,
              let swiftRange = Range(match.range(at: 1), in: text) else {
            return nil
        }
        return String(text[swiftRange])
    }
}

enum CaptureSessionDecisionPolicy {
    static func automaticBinding(
        for identityCase: IdentityResolutionCase
    ) -> (candidate: IdentityResolutionCandidate, context: RelationshipContextChoice)? {
        guard identityCase.status == "pending",
              identityCase.candidates.count == 1,
              let candidate = identityCase.candidates.first,
              candidate.temporalRole == .current,
              candidate.relationshipContexts.count == 1,
              let context = candidate.relationshipContexts.first else {
            return nil
        }
        return (candidate, context)
    }

    static func blockers(for draft: RecognizedCaptureDraft) -> [String] {
        var blockers: [String] = []
        if draft.handleValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           draft.displayNameHint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            blockers.append(
                "The Agent could not find a reliable identity clue. Choose the person and relationship for this source."
            )
        } else {
            blockers.append(
                "The Agent found an identity clue but could not resolve it with the available tools. Choose the person and relationship for this source."
            )
        }
        return blockers
    }

    static func blockers(
        for capture: ResourceCaptureResult,
        identityCase: IdentityResolutionCase? = nil
    ) -> [String] {
        var blockers: [String] = []
        if capture.identity.status != "bound" {
            if capture.identity.candidatePersonIDs.count > 1 {
                blockers.append(
                    "The Agent found multiple possible people. Choose who owns this conversation."
                )
            } else if capture.identity.candidatePersonIDs.isEmpty {
                blockers.append(
                    "The Agent could not resolve a person safely. Choose the person and relationship for this source."
                )
            } else if let candidate = identityCase?.candidates.first,
                      candidate.temporalRole != .current {
                blockers.append(
                    "The only identity clue is historical or expired. Confirm the person and relationship before attaching this source."
                )
            } else {
                blockers.append(
                    "The Agent found one person but could not choose one relationship context safely. Choose the relationship for this source."
                )
            }
        }
        return blockers
    }
}
