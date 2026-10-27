import Foundation
import XCTest
@testable import TalentSignalMac

final class NativeSettingsSearchLocalizationTests: XCTestCase {
    func testSearchUsesCurrentLanguageAndPreservesStaticOwners() throws {
        let rows = WorkspaceSettingsSearchEntry.all
        XCTAssertEqual(rows.map(\.id), ["general", "companion", "permissions", "connection", "updates", "account", "captures", "screen-recording", "capture-failure"])
        XCTAssertEqual(rows.map(\.action), [.section(.general), .section(.companion), .section(.permissions), .section(.connection), .section(.updates), .accountBrowser(.overview), .workspacePath("/workspace/captures"), .systemSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"), .section(.connection)])
        let keys = ["General", "Companion", "Permissions", "Connection and Diagnostics", "Software Updates", "Account and Preferences", "Using screenshots as sources", "Screen Recording Permission", "When screenshot processing fails"]
        let metadataKeys: [[String]] = [
            ["Content size, workspace window, and keyboard shortcuts.", "This Mac only", "Settings · General"],
            ["Choose, show or hide a companion, and adjust its position and gentle animation.", "This Mac only", "Settings · Companion"],
            ["Screen Recording and other permissions managed by macOS.", "This device", "Settings · Permissions"],
            ["Local connection settings, connection checks, and protected workspace pages.", "This Mac and current workspace", "Settings · Connection and Diagnostics"],
            ["Current version, update source, and automatic checks on this Mac.", "This Mac only · Saved locally", "Settings · Software Updates"],
            ["Manage your profile, account security, and preferences in the default browser.", "Account · Browser", "Browser · Account and Preferences"],
            ["Import screenshots and documents, and check their sources and ownership.", "Current workspace", "Sources · Screenshots and Documents"],
            ["Managed by macOS; check the status again after returning.", "This device", "Settings · Permissions · Open macOS System Settings"],
            ["Run diagnostics in Connection and Diagnostics to check device permissions and connection status.", "This device", "Settings · Connection and Diagnostics"]
        ]
        for (row, key) in zip(rows, keys) {
            XCTAssertEqual(row.title, String(localized: String.LocalizationValue(key), bundle: .main))
            XCTAssertTrue(WorkspaceSettingsSearchEntry.search(row.title).contains { $0.id == row.id })
        }
        for (row, fields) in zip(rows, metadataKeys) {
            XCTAssertEqual([row.detail, row.scope, row.destination], fields.map { Bundle.main.localizedString(forKey: $0, value: "__missing__", table: nil) })
        }
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("update").first?.title, String(localized: "Software Updates", bundle: .main))
    }

    func testOriginalAliasesWidthFoldingAndRankRemainUsable() {
        for (query, id) in [("此设备", "permissions"), ("软件更新", "updates"), ("运行记录", "connection"), ("隐藏伙伴", "companion"), ("账号", "account"), ("账号与偏好", "account"), ("ＳＣＲＥＥＮ SＨＯＴ", "captures")] {
            XCTAssertEqual(WorkspaceSettingsSearchEntry.search(query).first?.id, id)
        }
        for query in ["截图", "截屏", "屏幕录制", "录屏", "screenshot", "屏幕快照"] {
            XCTAssertTrue(WorkspaceSettingsSearchEntry.search(query).contains { $0.id == "captures" })
        }
        let legacyAliases: [(String, [String])] = [
            ("general", ["通用", "内容大小、工作窗口与键盘快捷键。", "仅此 Mac", "设置 · 通用", "通用", "内容大小", "窗口", "缩放", "显示", "保持最前", "键盘快捷键", "菜单栏", "general"]),
            ("companion", ["桌面伙伴", "选择伙伴、显示或隐藏，以及拖动位置与轻微动画。", "仅此 Mac", "设置 · 桌面伙伴", "桌面伙伴", "宠物", "显示伙伴", "隐藏伙伴", "mini", "pet", "动画", "位置", "拖动"]),
            ("permissions", ["权限", "屏幕录制等由 macOS 管理的权限状态。", "此设备", "设置 · 权限", "权限", "屏幕录制", "录屏", "系统权限", "系统设置", "隐私", "permission"]),
            ("connection", ["连接与诊断", "本机连接配置、测试连接与受保护的工作区页面。", "本机与当前空间", "设置 · 连接与诊断", "连接", "诊断", "问题", "排查", "服务", "地址", "来源", "边界", "运行记录"]),
            ("updates", ["软件更新", "本机当前版本、更新源与自动检查。", "仅此 Mac · 本机保存", "设置 · 软件更新", "更新", "升级", "版本", "自动检查", "预览版本", "软件更新", "update"]),
            ("account", ["账号与偏好", "在默认浏览器中管理个人资料、账号安全与偏好。", "账号 · 浏览器", "浏览器 · 账号与偏好", "账号", "偏好", "个人资料", "安全", "登录", "密码", "邮箱", "外观", "主题", "浏览器", "account", "profile"]),
            ("captures", ["截图作为资料的使用范围", "导入截图与文档，并核对来源与归属。", "当前空间", "资料 · 截图与文档", "截图", "截屏", "屏幕录制", "录屏", "屏幕快照", "屏幕截图", "screenshot", "capture", "文档", "导入", "资料", "来源"]),
            ("screen-recording", ["屏幕录制权限", "由 macOS 管理；返回后重新检查状态。", "此设备", "设置 · 权限 · 打开 macOS 系统设置", "截图", "截屏", "屏幕录制", "录屏", "屏幕快照", "屏幕截图", "权限", "screenshot", "capture"]),
            ("capture-failure", ["截图处理失败时怎么办", "在连接与诊断中运行排查，查看设备权限与连接状态。", "此设备", "设置 · 连接与诊断", "截图", "截屏", "屏幕录制", "失败", "故障", "恢复", "处理"])
        ]
        for (id, aliases) in legacyAliases {
            for alias in aliases {
                XCTAssertTrue(WorkspaceSettingsSearchEntry.search(alias).contains { $0.id == id }, "\(id): \(alias)")
            }
        }
        XCTAssertTrue(WorkspaceSettingsSearchEntry.search(" \n ").isEmpty)
        XCTAssertTrue(WorkspaceSettingsSearchEntry.search("不存在的私人会话").isEmpty)
        let row = WorkspaceSettingsSearchEntry(id: "fixture", title: "title", detail: "detail", scope: "scope", destination: "destination", keywords: ["alias"], action: .section(.general))
        XCTAssertEqual(row.matchScore("title"), 3)
        XCTAssertEqual(row.matchScore("alias"), 2)
        XCTAssertEqual(row.matchScore("destination"), 2)
        XCTAssertEqual(row.matchScore("detail"), 1)
        XCTAssertEqual(row.matchScore("scope"), 1)
        XCTAssertNil(row.matchScore(""))
        XCTAssertEqual(WorkspaceSettingsSearchEntry.search("此设备").map(\.id), ["permissions", "screen-recording", "capture-failure"])
    }

    func testConnectionFormatsKeepAddressesStatusCodesAndClientVersions() {
        let keys = [
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
        for key in keys {
            XCTAssertNotEqual(Bundle.main.localizedString(forKey: key, value: "__missing__", table: nil), "__missing__", key)
        }
        let address = "https://workspace.example:8443"
        let version = "0.2.41 (212)"
        XCTAssertTrue(String(format: String(localized: "Will use: %@", bundle: .main), address).contains(address))
        XCTAssertTrue(String(format: String(localized: "Finish current input or uploads first. %@ will open; sign-in to the existing service will be kept.", bundle: .main), address).contains(address))
        XCTAssertTrue(String(format: String(localized: "Client %@", bundle: .main), version).contains(version))
        let status = String(format: String(localized: "HTTP %lld · Reachability does not mean you are signed in or that backend business services are healthy.", bundle: .main), Int64(503))
        XCTAssertTrue(status.contains("503"))
        XCTAssertFalse(status.contains("%lld"))
    }
    func testCompiledFiveLanguageTablesPreservePlaceholderTypes() throws {
        let pattern = try NSRegularExpression(pattern: "%(@|lld|d|%)")
        func placeholders(_ value: String) -> [String] {
            pattern.matches(in: value, range: NSRange(value.startIndex..., in: value)).map {
                String(value[Range($0.range, in: value)!])
            }.sorted()
        }
        for language in ["en", "zh-Hans", "zh-Hant", "ja", "ko"] {
            let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"))
            let localized = try XCTUnwrap(Bundle(path: path))
            let url = try XCTUnwrap(localized.url(forResource: "Localizable", withExtension: "strings"))
            let data = try Data(contentsOf: url)
            let table = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String])
            for (key, value) in table {
                XCTAssertFalse(value.isEmpty, "\(language): \(key)")
                XCTAssertEqual(placeholders(value), placeholders(key), "\(language): \(key)")
            }
        }
    }

}
