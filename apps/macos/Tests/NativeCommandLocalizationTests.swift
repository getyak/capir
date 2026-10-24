import Foundation
import XCTest
@testable import TalentSignalMac

final class NativeCommandLocalizationTests: XCTestCase {
    private let keys: Set<String> = [
        "New Chat", "Back", "Forward", "Reload", "Zoom In", "Zoom Out", "Actual Size",
        "Workspace Appearance", "Go", "People", "Time", "This Mac Settings…",
        "Companion", "Companion Settings…", "Update and Restart", "Check for Updates",
        "System", "Light", "Dark"
    ]
    private let languages = ["en", "zh-Hans", "zh-Hant", "ja", "ko"]

    private func applicationBundle() throws -> Bundle {
        let bundle = Bundle(for: WorkspaceAppearanceBridge.self)
        XCTAssertEqual(bundle.bundleURL.pathExtension, "app", "Read the built application, not the test/source directory")
        XCTAssertEqual(bundle.bundleIdentifier, "com.talentsignal.macos")
        return bundle
    }

    private func languageBundle(_ language: String, in app: Bundle) throws -> Bundle {
        let path = try XCTUnwrap(app.path(forResource: language, ofType: "lproj"), "Missing compiled \(language) resources")
        return try XCTUnwrap(Bundle(path: path))
    }

    func testBuiltApplicationContainsEveryCommandKeyInAllFiveLanguageTables() throws {
        let app = try applicationBundle()
        for language in languages {
            let localized = try languageBundle(language, in: app)
            let resource = try XCTUnwrap(localized.url(forResource: "Localizable", withExtension: "strings"))
            let data = try Data(contentsOf: resource)
            let table = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String])
            XCTAssertEqual(Set(table.keys), keys, "The compiled \(language) table must cover every owned command")
            for key in keys {
                let value = localized.localizedString(forKey: key, value: "__missing__", table: nil)
                XCTAssertNotEqual(value, "__missing__", "\(language): \(key) must resolve from the built bundle")
                XCTAssertFalse(value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, "\(language): \(key)")
            }
        }
    }

    func testRegionalDeviceLanguagesChooseTheFirstSupportedCommandLocalization() throws {
        let app = try applicationBundle()
        let cases: [([String], String, [String])] = [
            (["en-SG", "zh-Hans-SG"], "en", ["Go", "Companion", "System", "Light", "Dark"]),
            (["zh-Hans-SG", "en-SG"], "zh-Hans", ["前往", "桌面伙伴", "跟随系统", "浅色", "深色"]),
            (["zh-Hant-TW", "en"], "zh-Hant", ["前往", "桌面夥伴", "跟隨系統", "淺色", "深色"]),
            (["ja-JP", "en"], "ja", ["移動", "デスクトップの相棒", "システム", "ライト", "ダーク"]),
            (["ko-KR", "en"], "ko", ["이동", "데스크톱 친구", "시스템", "라이트", "다크"])
        ]
        for (preferences, expectedLanguage, expectedLabels) in cases {
            let selected = try XCTUnwrap(Bundle.preferredLocalizations(from: app.localizations, forPreferences: preferences).first)
            XCTAssertEqual(selected, expectedLanguage)
            let localized = try languageBundle(selected, in: app)
            let actual = ["Go", "Companion", "System", "Light", "Dark"].map {
                localized.localizedString(forKey: $0, value: "__missing__", table: nil)
            }
            XCTAssertEqual(actual, expectedLabels, "Regional language selection must use the compiled app tables")
        }
    }

    func testComputedAppearanceTitlesUseTheAppBundleLanguageRatherThanVerbatimChinese() throws {
        let app = try applicationBundle()
        let expected: [String: [String]] = [
            "en": ["System", "Light", "Dark"],
            "zh-Hans": ["跟随系统", "浅色", "深色"],
            "zh-Hant": ["跟隨系統", "淺色", "深色"],
            "ja": ["システム", "ライト", "ダーク"],
            "ko": ["시스템", "라이트", "다크"]
        ]
        let language = try XCTUnwrap(app.preferredLocalizations.first)
        XCTAssertEqual(WorkspaceAppearance.allCases.map(\.title), try XCTUnwrap(expected[language]))
    }
}
