import AppKit
import Foundation
import SwiftUI
import XCTest
@testable import TalentSignalMac

final class NativeCommandLocalizationTests: XCTestCase {
    private let keys: Set<String> = [
        "New Chat", "Back", "Forward", "Reload", "Zoom In", "Zoom Out", "Actual Size",
        "Workspace Appearance", "Go", "People", "Time", "This Mac Settings…",
        "Companion", "Companion Settings…", "Update and Restart", "Check for Updates",
        "System", "Light", "Dark", "Workspace Unavailable",
        "Unable to open the workspace. Check the network, Tailscale, and workspace service, then retry.",
        "The workspace request failed (HTTP %lld). Reload later or check connection settings.",
        "The page paused. Reload it; saved conversations remain in the workspace.",
        "Appearance saving could not be confirmed. Reload and check it.",
        "Workspace notice",
        "Calendar file",
        "Loading workspace…",
        "Restoring sign-in…",
        "Checking this Mac’s saved sign-in.",
        "Copy retained text",
        "Copy text %lld",
        "Text copied. Paste it into the conversation and review before sending.",
        "Text was not copied. Check sign-in, draft retention or clipboard permission, then retry.",
        "Discard this recovery",
        "Close",
        "Workspace window",
        "Update status",
        "Automatic updates",
        "Discard recovery %lld",
        "Unable to restore sign-in. Unlock your login keychain, check the network, or retry later. Your sign-in credential and drafts are preserved.",
        "Unable to save sign-out state. Check local storage and retry.",
        "Workspace on this Mac",
        "Sign in to capri",
        "Confirm your account in the browser",
        "Return to this Mac",
        "Preparing sign-in…",
        "Confirm your account in the browser, then return to this Mac.",
        "Matching code",
        "Waiting for browser confirmation…",
        "Verifying sign-in on this Mac…",
        "Opening your workspace…",
        "Sign-in was cancelled. You can start again at any time.",
        "Choose an account in the browser. Your workspace opens after sign-in.",
        "We cannot confirm whether this Mac finished signing in. Check the result or start again.",
        "We cannot confirm whether this Mac finished signing in. Start sign-in again.",
        "Check sign-in result",
        "Restart sign-in (⌥↩)",
        "Sign in with browser",
        "Cancel sign-in",
        "General",
        "Permissions",
        "Connection and Diagnostics",
        "Software Updates",
        "This Mac",
        "Support",
        "Account settings opened in the default browser.",
        "Account settings could not be opened in the default browser.",
        "The previous conversation location could not be confirmed. The main window returned to the workspace home; unsaved input may not have been retained.",
        "Back history was unavailable. The last workspace address was reloaded; unsaved input may not have been retained.",
        "This Mac Settings",
        "This Mac · %@",
        "Update available",
        "Search settings",
        "Account and Preferences ↗",
        "Opens in the default browser using the account signed in there",
        "Connect to a workspace before opening account settings in the browser.",
        "The browser uses its own signed-in account, which may differ from this app's account.",
        "No workspace is connected, so account settings cannot be opened yet.",
        "The default browser could not be opened. Check your default browser and try again.",
        "Retry",
        "Clear search",
        "These controls affect only this Mac and remain available offline.",
        "Content Size",
        "Keep the workspace window on top",
        "Keyboard Shortcuts",
        "Zoom In / Zoom Out / Actual Size",
        "People / Time",
        "Screenshots and documents require Screen Recording permission managed by macOS. The status shown is current; permission can only be granted in System Settings.",
        "Screen Recording",
        "Allowed",
        "Not Allowed",
        "Open System Settings",
        "Check Again",
        "Opening System Settings only opens the macOS pane; it does not change permission. Check again after returning.",
        "Managed by macOS",
        "Local controls do not require a connection. Open the browser to read or save account settings.",
        "Advanced Diagnostics",
        "Current Workspace",
        "Not Connected",
        "Checking…",
        "Test Connection",
        "Diagnostics check only this Mac's connection to the workspace. They contain no credentials, tokens or account identifiers.",
        "Current Version",
        "Last Verified Update Source",
        "Retry Relaunch",
        "Automatically check for updates",
        "Receive preview releases",
        "New versions appear at the lower left. Update and Restart downloads, verifies and reopens the app without another confirmation. Nothing is installed or restarted until you click it.",
        "Release History and Installation Help",
        "Signed updates are not configured yet. Published installers are available in the release history.",
        "Esc Close",
        "No settings match “%@”.",
        "Try General, Permissions, Connection, Software Updates, Account, or Screenshots and Documents. Relationship records are not included in settings search.",
        "The default browser could not be opened. Account settings were not opened.",
        "Connect to a workspace before opening this workspace page.",
        "macOS System Settings could not be opened. Open Privacy & Security → Screen Recording manually.",
        "Requested macOS System Settings. Check permission again after returning.",
        "Pigeon",
        "Little Stone",
        "Owl",
        "Cat",
        "Sprout",
        "Little Robot",
        "Quiet company while you wait for a reply",
        "Steady in a corner of your desktop",
        "For moments that need focus",
        "Light, with a rhythm of its own",
        "A little gentle growth",
        "A clear, simple companion",
        "Send a screenshot to Agent",
        "Open workspace",
        "%@ companion",
        "Click to open the workspace; drag to reposition",
        "A quiet companion in a corner of your desktop. Drag to move it; click to open the main window.",
        "Hide companion",
        "Show companion",
        "Choose a companion",
        "Desktop preview",
        "Leave room for what you are doing.",
        "%@ companion preview",
        "Drag to move · Click to open workspace · No private text",
        "Hidden · Selection and position are kept",
        "Gentle floating animation",
        "Work status comes only from verified workspace data. Without a reliable source, progress and counts are not shown.",
        "Menu Bar and Screenshots",
        "Select an area of your screen and send it directly to the Agent in your current workspace.",
        "Show capri in the menu bar",
        "Screenshot Shortcut",
        "Press a shortcut · Esc to cancel",
        "Record screenshot shortcut, currently %@",
        "After Selection",
        "Send directly to Agent",
        "Always preview first",
        "Press P while taking a screenshot to preview, crop or redact it first.",
        "Top Activity Hint",
        "Off",
        "On",
        "Briefly shows general processing status without names or messages.",
        "Start at Login",
        "macOS has not finished setting up the login item. Check System Settings.",
        "Screenshot Processing and Retention",
        "Only the area you explicitly select is uploaded. Processors follow the current workspace settings shown when first enabled; changes require another review.",
        "Screenshots not yet uploaded are encrypted on this Mac for up to 24 hours. Delivered screenshots follow workspace session retention and source deletion rules.",
        "This key does not support global screenshots yet. Choose another shortcut.",
        "This shortcut is already used by the system or another app. Choose another shortcut.",
        "The screenshot shortcut is temporarily unavailable.",
        "Signed updates are not enabled in this preview",
        "New versions appear at the lower left",
        "Checking for updates…",
        "Update information failed signature verification. Your current version remains usable.",
        "A release announcement is available in the release history. It contains no installable update.",
        "%@ is available. Click to update and restart",
        "Downloading update…",
        "Updating and restarting…",
        "Downloading update %lld%%",
        "Verifying and preparing the update…",
        "Waiting for the app to quit. If quitting was cancelled, try restarting again.",
        "Update information could not be verified. Your current version remains usable. Try again later.",
        "The update could not be completed. Your current version remains usable. Check for updates again.",
        "Update ended. You can check for updates again",
        "Update checking could not start. Your current version remains usable. Reopen the app and try again.",
        "You are up to date",
        "Your version is newer than the update source",
        "The new version does not support this Mac yet. Your current version remains usable",
        "No applicable update was found",
        "Content size, workspace window, and keyboard shortcuts.",
        "This Mac only",
        "Settings · General",
        "Choose, show or hide a companion, and adjust its position and gentle animation.",
        "Settings · Companion",
        "Screen Recording and other permissions managed by macOS.",
        "This device",
        "Settings · Permissions",
        "Local connection settings, connection checks, and protected workspace pages.",
        "This Mac and current workspace",
        "Settings · Connection and Diagnostics",
        "Current version, update source, and automatic checks on this Mac.",
        "This Mac only · Saved locally",
        "Settings · Software Updates",
        "Account and Preferences",
        "Manage your profile, account security, and preferences in the default browser.",
        "Account · Browser",
        "Browser · Account and Preferences",
        "Using screenshots as sources",
        "Import screenshots and documents, and check their sources and ownership.",
        "Current workspace",
        "Sources · Screenshots and Documents",
        "Screen Recording Permission",
        "Managed by macOS; check the status again after returning.",
        "Settings · Permissions · Open macOS System Settings",
        "When screenshot processing fails",
        "Run diagnostics in Connection and Diagnostics to check device permissions and connection status.",
        "Workspace Address",
        "Will use: %@",
        "Paste a full workspace link. HTTPS only, without an account or password.",
        "Checking connection",
        "Test Connection First",
        "Optional: check whether the service is reachable before opening the workspace.",
        "An HTTPS workspace address is required.",
        "Enter an HTTPS workspace address.",
        "Private workspaces require Tailscale first. Get the address from the workspace owner.",
        "Switch workspace service?",
        "Switch and Reload",
        "Cancel",
        "Finish current input or uploads first. %@ will open; sign-in to the existing service will be kept.",
        "Save Connection",
        "Connect to your workspace",
        "Connection and Debugging",
        "Continue the same conversations, people, and schedule on this Mac.",
        "View or change the workspace service connected to this Mac.",
        "Allow local development services",
        "HTTP is allowed only for localhost, 127.0.0.1, or ::1; remote services always use HTTPS.",
        "Fill Local Development Address",
        "Enable Web Inspector",
        "When enabled, inspect this window from Safari’s Develop menu. Enable only for debugging.",
        "Client %@",
        "Copy Diagnostic Summary",
        "Copied · The summary omits service addresses, accounts, credentials, and conversation content.",
        "Switching services reloads the page. Sign-in states are saved separately for each service.",
        "Development and Diagnostics",
        "No web response received",
        "Confirm that this is the workspace web entry point.",
        "Service is reachable",
        "Service is not ready",
        "HTTP %lld · Reachability does not mean you are signed in or that backend business services are healthy.",
        "Connection timed out. Check Tailscale, the proxy, and service ports.",
        "Unable to resolve the address. Check the spelling and Tailscale connection.",
        "Secure connection verification failed. Check the service certificate.",
        "Check cancelled.",
        "Check the network and workspace service, then retry.",
        "Unable to connect right now"

    ]
    private let languages = ["en", "zh-Hans", "zh-Hant", "ja", "ko"]

    private func applicationBundle() throws -> Bundle {
        let bundle = Bundle(for: WorkspaceAppearanceBridge.self)
        XCTAssertEqual(bundle.bundleURL.pathExtension, "app", "Read the built application, not the test/source directory")
        // macos-distribution.md requires a distinct local test identity while
        // the signed client owns its registry. CI/release keep the production
        // identity guard unless an explicit acceptance identity is supplied.
        if let acceptanceID = ProcessInfo.processInfo.environment["MACOS_TEST_APPLICATION_BUNDLE_ID"] {
            XCTAssertTrue(acceptanceID.hasPrefix("com.getyak.acceptance."))
            XCTAssertEqual(bundle.bundleIdentifier, acceptanceID)
        } else {
            XCTAssertEqual(bundle.bundleIdentifier, "com.talentsignal.macos")
        }
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
            (["en-CN", "zh-Hans-CN"], "en", ["Go", "Companion", "System", "Light", "Dark"]),
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

    func testBuiltNativeSurfaceFormatsPreserveEveryPlaceholderType() throws {
        let app = try applicationBundle()
        let pattern = try NSRegularExpression(pattern: "%(@|lld|d|%)")
        func placeholders(_ value: String) -> [String] {
            pattern.matches(in: value, range: NSRange(value.startIndex..., in: value)).map {
                String(value[Range($0.range, in: value)!])
            }.sorted()
        }
        for language in languages {
            let localized = try languageBundle(language, in: app)
            for key in keys {
                let value = localized.localizedString(forKey: key, value: "__missing__", table: nil)
                XCTAssertEqual(placeholders(value), placeholders(key), "\(language): \(key)")
            }
        }
    }

    func testComputedDeviceAndCompanionLabelsUseTheBuiltAppLanguage() throws {
        let app = try applicationBundle()
        let language = try XCTUnwrap(app.preferredLocalizations.first)
        let localized = try languageBundle(language, in: app)
        let sectionKeys = ["General", "Companion", "Permissions", "Connection and Diagnostics", "Software Updates"]
        XCTAssertEqual(WorkspaceSettingsSection.allCases.map(\.title), sectionKeys.map {
            localized.localizedString(forKey: $0, value: "__missing__", table: nil)
        })
        XCTAssertEqual(WorkspaceSettingsSection.groups.map(\.title), ["This Mac", "Support"].map {
            localized.localizedString(forKey: $0, value: "__missing__", table: nil)
        })
        let petKeys = ["Pigeon", "Little Stone", "Owl", "Cat", "Sprout", "Little Robot"]
        XCTAssertEqual(DesktopPet.allCases.map(\.name), petKeys.map {
            localized.localizedString(forKey: $0, value: "__missing__", table: nil)
        })
        for text in DesktopPet.allCases.map(\.note) {
            XCTAssertFalse(text.isEmpty)
            if language == "en" {
                XCTAssertFalse(text.unicodeScalars.contains { (0x4E00...0x9FFF).contains($0.value) })
            }
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

    func testComputedRecoveryTextUsesTheBuiltAppLanguageAndPreservesHTTPStatus() throws {
        let app = try applicationBundle()
        let titles = ["en": "Workspace Unavailable", "zh-Hans": "工作区暂不可用", "zh-Hant": "工作區暫時無法使用", "ja": "ワークスペースを開けません", "ko": "워크스페이스를 열 수 없습니다"]
        let language = try XCTUnwrap(app.preferredLocalizations.first)
        XCTAssertEqual(WorkspaceRecoveryText.title, try XCTUnwrap(titles[language]))
        for text in [WorkspaceRecoveryText.unavailable, WorkspaceRecoveryText.paused, WorkspaceRecoveryText.appearanceUnconfirmed] {
            XCTAssertFalse(text.isEmpty)
            if language == "en" {
                XCTAssertFalse(text.unicodeScalars.contains { (0x4E00...0x9FFF).contains($0.value) })
            }
        }
        XCTAssertTrue(WorkspaceRecoveryText.httpFailure(503).contains("503"))
        XCTAssertFalse(WorkspaceRecoveryText.httpFailure(503).contains("%lld"))
    }
    func testCaptureShortcutErrorsUseTheCompiledApplicationLanguage() throws {
        let app = try applicationBundle()
        let localized = try languageBundle(try XCTUnwrap(app.preferredLocalizations.first), in: app)
        for (error, key) in [
            (CaptureShortcutRegistrationError.unsupportedKey, "This key does not support global screenshots yet. Choose another shortcut."),
            (.conflict, "This shortcut is already used by the system or another app. Choose another shortcut.")
        ] {
            XCTAssertEqual(error.errorDescription, localized.localizedString(forKey: key, value: "__missing__", table: nil))
        }
    }

    func testBuiltCaptureShortcutAccessibilityFormatKeepsTheRecordedChord() throws {
        let app = try applicationBundle()
        for language in languages {
            let localized = try languageBundle(language, in: app)
            let format = localized.localizedString(forKey: "Record screenshot shortcut, currently %@", value: "__missing__", table: nil)
            let label = String(format: format, "⌃⌥S")
            XCTAssertTrue(label.contains("⌃⌥S"), language)
            XCTAssertFalse(label.contains("%@"), language)
            XCTAssertNotEqual(label, "__missing__", language)
        }
    }

}
