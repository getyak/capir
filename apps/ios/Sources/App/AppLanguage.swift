import Foundation
import SwiftUI

enum AppLanguage: String, CaseIterable, Identifiable {
    case system
    case english = "en"
    case simplifiedChinese = "zh-Hans"

    static let storageKey = "talent-signal.interface-language"

    var id: String { rawValue }

    static func stored(_ rawValue: String?) -> AppLanguage {
        rawValue.flatMap(AppLanguage.init(rawValue:)) ?? .system
    }

    var locale: Locale {
        switch self {
        case .system:
            return .autoupdatingCurrent
        case .english:
            return Locale(identifier: "en")
        case .simplifiedChinese:
            return Locale(identifier: "zh-Hans")
        }
    }

    func usesSimplifiedChinese(
        preferredLanguages: [String] = Locale.preferredLanguages
    ) -> Bool {
        switch self {
        case .simplifiedChinese:
            return true
        case .english:
            return false
        case .system:
            return preferredLanguages.first?.lowercased().hasPrefix("zh") == true
        }
    }

    func text(
        _ key: String,
        preferredLanguages: [String] = Locale.preferredLanguages
    ) -> String {
        let localization = usesSimplifiedChinese(
            preferredLanguages: preferredLanguages
        ) ? "zh-Hans" : "en"
        guard let path = Bundle.main.path(
            forResource: localization,
            ofType: "lproj"
        ), let bundle = Bundle(path: path) else {
            return key
        }
        return bundle.localizedString(forKey: key, value: key, table: nil)
    }

    /// Transitional compatibility for the original inline bilingual calls.
    /// New interface copy belongs in `Localizable.xcstrings` and uses
    /// `text(_:preferredLanguages:)` without a second sentence in the view.
    func text(
        _ english: String,
        zhHans: String,
        preferredLanguages: [String] = Locale.preferredLanguages
    ) -> String {
        let localized = text(
            english,
            preferredLanguages: preferredLanguages
        )
        guard usesSimplifiedChinese(preferredLanguages: preferredLanguages),
              localized == english else {
            return localized
        }
        return zhHans
    }

    func displayName(in interfaceLanguage: AppLanguage) -> String {
        switch self {
        case .system:
            return interfaceLanguage.text("Follow System")
        case .english:
            return "English"
        case .simplifiedChinese:
            return "简体中文"
        }
    }

    func description(in interfaceLanguage: AppLanguage) -> String {
        switch self {
        case .system:
            return interfaceLanguage.text(
                "Match the language selected on this iPhone."
            )
        case .english:
            return interfaceLanguage.text(
                "Use English for capri controls and guidance."
            )
        case .simplifiedChinese:
            return interfaceLanguage.text(
                "Use Simplified Chinese for capri controls and guidance."
            )
        }
    }

    func workspaceTerm(_ english: String) -> String {
        text(english)
    }

    func workspaceValue(_ rawValue: String) -> String {
        workspaceTerm(rawValue.humanized)
    }

    func shortDate(_ value: String) -> String {
        let source = DateFormatter()
        source.locale = Locale(identifier: "en_US_POSIX")
        source.calendar = Calendar(identifier: .gregorian)
        source.timeZone = TimeZone(secondsFromGMT: 0)
        source.dateFormat = "yyyy-MM-dd"

        let output = DateFormatter()
        output.locale = locale
        output.calendar = Calendar(identifier: .gregorian)
        output.timeZone = TimeZone(secondsFromGMT: 0)
        output.setLocalizedDateFormatFromTemplate("yMMMd")

        let day = String(value.prefix(10))
        return source.date(from: day).map(output.string) ?? day
    }

    func dueDate(_ value: String, prefixed: Bool = false) -> String {
        let format = prefixed ? text(" · due %@") : text("Due %@")
        return String(format: format, locale: locale, shortDate(value))
    }

    func recordedDate(
        at value: String,
        sourceTimezone: String?
    ) -> String {
        guard usesSimplifiedChinese() else {
            return WorkspaceDate.recorded(
                at: value,
                sourceTimezone: sourceTimezone
            )
        }
        guard let date = workspaceISO8601Date(value) else {
            return String(
                format: text("Recorded %@"),
                locale: locale,
                value
            )
        }

        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = sourceTimezone.flatMap(TimeZone.init(identifier:))
            ?? .current
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjmm")
        return String(
            format: text("Recorded %@"),
            locale: locale,
            formatter.string(from: date)
        )
    }

    func evidenceFreshness(
        observedAt value: String,
        sourceTimezone: String?
    ) -> String {
        guard let date = workspaceISO8601Date(value) else {
            return String(
                format: text("Observed at an unparsed source time: %@"),
                locale: locale,
                value
            )
        }

        let relative = RelativeDateTimeFormatter()
        relative.locale = locale
        relative.unitsStyle = .full
        let age = relative.localizedString(for: date, relativeTo: Date())
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = sourceTimezone.flatMap(TimeZone.init(identifier:))
            ?? TimeZone(secondsFromGMT: 0)
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjmm")
        return String(
            format: text("Observed %1$@ · %2$@ · %3$@"),
            locale: locale,
            age,
            formatter.string(from: date),
            sourceTimezone ?? "UTC"
        )
    }

    func evidenceAttentionLabel(_ state: WorkspaceEvidenceState) -> String {
        text(state.attentionLabel)
    }

    func evidenceExplanation(_ state: WorkspaceEvidenceState) -> String {
        let key: String
        let values: [CVarArg]
        switch state.availability {
        case "available":
            key = state.availableReferenceCount == 1
                ? "%lld reviewed evidence reference"
                : "%lld reviewed evidence references"
            values = [state.availableReferenceCount]
        case "partial":
            key = "%1$lld of %2$lld evidence references remain authoritative"
            values = [state.availableReferenceCount, state.referenceCount]
        case "not_required":
            return text(
                "Explicitly recorded by the recruiter; no evidence authority is claimed"
            )
        default:
            return text(
                "No cited evidence remains authoritative; a new reviewed source is required"
            )
        }
        return String(
            format: text(key),
            locale: locale,
            arguments: values
        )
    }

    private func workspaceISO8601Date(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return fractional.date(from: value) ?? standard.date(from: value)
    }
}

private struct AppLanguageEnvironmentKey: EnvironmentKey {
    static let defaultValue = AppLanguage.system
}

extension EnvironmentValues {
    var appLanguage: AppLanguage {
        get { self[AppLanguageEnvironmentKey.self] }
        set { self[AppLanguageEnvironmentKey.self] = newValue }
    }
}
