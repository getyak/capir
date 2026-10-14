import Foundation

/// Localized display of contextual roles; it does not change role state or identity.
enum WorkspacePersonRolePresentation {
    static func summary(for role: WorkspacePersonRole, language: AppLanguage) -> String {
        "\(roleTypeLabel(role.roleType, language: language)) · \(roleStatusLabel(role.status, language: language)) · \(roleConfidenceLabel(role.confidence, language: language))"
    }

    private static func roleTypeLabel(_ roleType: String, language: AppLanguage) -> String {
        switch roleType {
        case "candidate": language.text("Candidate")
        case "client": language.text("Client")
        default: roleType.humanized
        }
    }

    private static func roleStatusLabel(_ status: String, language: AppLanguage) -> String {
        switch status {
        case "active": language.text("Active role")
        case "quiet": language.text("Quiet role")
        case "removed": language.text("Removed role")
        default: status.humanized
        }
    }

    private static func roleConfidenceLabel(_ confidence: String, language: AppLanguage) -> String {
        switch confidence {
        case "confirmed": language.text("Confirmed role")
        case "suggested": language.text("Suggested role")
        default: confidence.humanized
        }
    }

}
