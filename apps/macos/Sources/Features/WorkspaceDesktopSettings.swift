import AppKit
import SwiftUI

enum WorkspaceDestination: String, CaseIterable {
    case home = "", people = "people", calendar = "meetings", settings = "settings"

    func url(in origin: WorkspaceOrigin) -> URL {
        rawValue.isEmpty ? origin.entryURL : origin.entryURL.appendingPathComponent(rawValue)
    }
}

@MainActor
final class WorkspaceNavigation: ObservableObject {
    static let shared = WorkspaceNavigation()
    @Published var pending: WorkspaceDestination?
    /// A same-origin workspace URL requested by a trusted link in Settings.
    /// The main workspace window consumes it; Settings must not render it.
    @Published var pendingURL: URL?
}

struct WorkspaceDesktopCommands: Commands {
    @FocusedObject private var browser: WorkspaceBrowser?

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("新对话") { browser?.navigate(.home) }
                .keyboardShortcut("n").disabled(browser == nil)
        }
        CommandGroup(after: .toolbar) {
            Divider()
            Button("返回") { browser?.webView.goBack() }
                .keyboardShortcut("[").disabled(browser?.webView.canGoBack != true)
            Button("前进") { browser?.webView.goForward() }
                .keyboardShortcut("]").disabled(browser?.webView.canGoForward != true)
            Button("重新载入") { browser?.retry() }
                .keyboardShortcut("r").disabled(browser == nil)
        }
        CommandMenu("前往") {
            Button("人物") { browser?.navigate(.people) }
                .keyboardShortcut("1").disabled(browser == nil)
            Button("时间") { browser?.navigate(.calendar) }
                .keyboardShortcut("2").disabled(browser == nil)
            Button("工作区设置") {
                WorkspaceSettingsNavigation.shared.selection = .workspace
                browser?.openSettings?()
            }
            .keyboardShortcut(",", modifiers: [.command, .shift]).disabled(browser == nil)
        }
    }
}

/// One native settings schema. Raw values map to the Web section query so a
/// selected rail row, the loaded Web route and the Web page title stay equal.
enum WorkspaceSettingsSection: String, CaseIterable, Identifiable {
    case profile, account, appearance, workspace, connections, device, updates, advanced

    var id: String { rawValue }

    var title: String {
        switch self {
        case .profile: "个人资料"
        case .account: "账号与安全"
        case .appearance: "外观与偏好"
        case .workspace: "工作空间"
        case .connections: "连接与权限"
        case .device: "此设备"
        case .updates: "软件更新"
        case .advanced: "帮助与诊断"
        }
    }

    var symbol: String {
        switch self {
        case .profile: "person.crop.circle"
        case .account: "lock"
        case .appearance: "circle.lefthalf.filled"
        case .workspace: "person.2"
        case .connections: "link"
        case .device: "laptopcomputer"
        case .updates: "arrow.down.circle"
        case .advanced: "lifepreserver"
        }
    }

    /// Where the preference or authorization actually applies. Profile mixes an
    /// account display name with avatar choices stored only on this Mac.
    var scope: String {
        switch self {
        case .profile: "账号 · 头像仅此设备"
        case .account: "账号"
        case .appearance: "仅此 Mac"
        case .device, .updates: "仅此 Mac · 本机保存"
        case .connections, .workspace, .advanced: "当前空间"
        }
    }

    /// Device-owned sections stay native and never need the Web origin.
    var isWeb: Bool { self != .device && self != .updates }

    func url(in origin: WorkspaceOrigin) -> URL {
        var parts = URLComponents(url: origin.url.appendingPathComponent("workspace/settings"), resolvingAgainstBaseURL: false)!
        if self != .profile { parts.queryItems = [URLQueryItem(name: "section", value: rawValue)] }
        return parts.url!
    }

    /// Only a same-origin Web settings route selects a native section.
    static func resolve(_ url: URL, origin: WorkspaceOrigin) -> Self? {
        guard origin.contains(url), url.path == "/workspace/settings" || url.path == "/workspace/settings/" else { return nil }
        let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "section" })?.value
        if value == nil || value == "overview" { return .profile }
        guard let section = Self(rawValue: value!), section.isWeb else { return nil }
        return section
    }
}

struct WorkspaceSettingsSectionGroup: Identifiable {
    let title: String
    let sections: [WorkspaceSettingsSection]
    var id: String { title }
}

extension WorkspaceSettingsSection {
    /// Visible rail groups; the last group owns Help & Diagnostics.
    static let groups: [WorkspaceSettingsSectionGroup] = [
        .init(title: "个人", sections: [.profile, .account, .appearance]),
        .init(title: "工作与信任", sections: [.connections, .workspace]),
        .init(title: "此设备", sections: [.device, .updates]),
        .init(title: "支持", sections: [.advanced]),
    ]
}

/// The single pane a selection shows. Resolving it here keeps the rail row and
/// the displayed title identical, including when the Web origin is unavailable.
enum WorkspaceSettingsPane: Equatable {
    case web(WorkspaceSettingsSection)
    case device
    case updates
    case requiresConnection(WorkspaceSettingsSection)

    static func resolve(selection: WorkspaceSettingsSection, connected: Bool) -> WorkspaceSettingsPane {
        switch selection {
        case .device: .device
        case .updates: .updates
        default: connected ? .web(selection) : .requiresConnection(selection)
        }
    }

    var section: WorkspaceSettingsSection {
        switch self {
        case .web(let section), .requiresConnection(let section): section
        case .device: .device
        case .updates: .updates
        }
    }

    var title: String { section.title }

    var showsWebContent: Bool {
        if case .web = self { return true }
        return false
    }

    /// Device and Updates stay usable without a service connection.
    var isNativeDeviceControl: Bool { self == .device || self == .updates }
}

/// Classifies same-origin navigation so Settings and the main workspace keep
/// distinct owners. Pure and origin-validated, so it is cheap to unit test and
/// impossible to widen with an unchecked URL.
enum WorkspaceSurfacePolicy {
    /// Settings-owned routes stay inside the settings window: the section page,
    /// diagnostics, testing, login-method, conflict and account-linking flows.
    static func isSettingsOwned(_ url: URL) -> Bool {
        let path = url.path
        return path == "/workspace/settings" || path.hasPrefix("/workspace/settings/")
    }

    /// Ordinary workspace destinations own the full workbench chrome.
    static func isOrdinaryWorkspaceDestination(_ url: URL) -> Bool {
        let path = url.path
        guard path == "/workspace" || path.hasPrefix("/workspace/") else { return false }
        return !isSettingsOwned(url)
    }

    /// A trusted user-clicked same-origin link to an ordinary workspace route
    /// must open the main workspace window at that exact URL.
    static func mainWindowHandoffURL(for url: URL, origin: WorkspaceOrigin,
                                     isSettingsSurface: Bool, mainFrame: Bool,
                                     targetsMainFrame: Bool, userActivated: Bool) -> URL? {
        guard isSettingsSurface, mainFrame, targetsMainFrame, userActivated,
              origin.contains(url), isOrdinaryWorkspaceDestination(url) else { return nil }
        return url
    }

    /// The account profile editor is a same-origin root route (`/onboarding`)
    /// linked from Settings and returns through a Settings callback. It must
    /// open in the main window so its full-page chrome and callback stay
    /// coherent, but the allowance is keyed to the exact edit route plus a
    /// settings-owned callback. Arbitrary root routes are never widened.
    static func isAccountEditRoute(_ url: URL) -> Bool {
        guard url.path == "/onboarding",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return false }
        return items.contains { $0.name == "edit" && $0.value == "true" }
    }

    static func accountEditHandoffURL(for url: URL, origin: WorkspaceOrigin,
                                      isSettingsSurface: Bool, mainFrame: Bool,
                                      targetsMainFrame: Bool, userActivated: Bool) -> URL? {
        guard isSettingsSurface, mainFrame, targetsMainFrame, userActivated,
              origin.contains(url), isAccountEditRoute(url),
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let callback = items.first(where: { $0.name == "callbackUrl" })?.value,
              let callbackURL = URL(string: callback, relativeTo: origin.url)?.absoluteURL,
              origin.contains(callbackURL), isSettingsOwned(callbackURL) else { return nil }
        return url
    }

    /// Retry inside Settings must never reload an unexpected workbench route
    /// (or the account editor) and re-trap it. It restores the last valid
    /// Settings section instead; unrelated same-origin URLs pass through.
    static func settingsRetryURL(currentURL: URL?, origin: WorkspaceOrigin,
                                 lastSection: WorkspaceSettingsSection?) -> URL? {
        guard let currentURL else { return nil }
        guard case .unexpectedRoute = classifySettingsURL(currentURL, origin: origin) else { return currentURL }
        return (lastSection ?? .profile).url(in: origin)
    }

    /// A same-origin main-frame navigation inside Settings that would render
    /// the workbench without a trusted user click is cancelled instead of
    /// trapping the full workspace inside the settings window.
    static func blocksWorkbenchNavigation(url: URL, origin: WorkspaceOrigin,
                                          isSettingsSurface: Bool, mainFrame: Bool,
                                          targetsMainFrame: Bool) -> Bool {
        guard isSettingsSurface, mainFrame, targetsMainFrame, origin.contains(url) else { return false }
        return isOrdinaryWorkspaceDestination(url)
    }

    /// A full navigation to the account editor that did not qualify for the
    /// trusted handoff (for example a server redirect, scripted load or
    /// new-window fallback) is cancelled instead of transiently rendering the
    /// editor inside Settings until the URL observer recovers. Only the exact
    /// `/onboarding?edit=true` route matches, so `/login` and settings-owned
    /// auth flows are untouched; arbitrary root routes are never blocked.
    static func blocksAccountEditNavigation(url: URL, origin: WorkspaceOrigin,
                                            isSettingsSurface: Bool, mainFrame: Bool,
                                            targetsMainFrame: Bool) -> Bool {
        guard isSettingsSurface, mainFrame, targetsMainFrame, origin.contains(url) else { return false }
        return isAccountEditRoute(url)
    }

    /// What the settings WebView URL actually is. Next.js `Link` can push an
    /// ordinary workspace route through the History API, bypassing
    /// `WKNavigationDelegate`; the observer uses this to recover instead of
    /// letting the workbench render inside Settings.
    enum SettingsURLObservation: Equatable {
        case settingsSection(WorkspaceSettingsSection)
        case settingsOwnedSubpage
        case unexpectedRoute(URL)
        case ignore
    }

    static func classifySettingsURL(_ url: URL, origin: WorkspaceOrigin) -> SettingsURLObservation {
        guard origin.contains(url) else { return .ignore }
        if let section = WorkspaceSettingsSection.resolve(url, origin: origin) { return .settingsSection(section) }
        if isSettingsOwned(url) { return .settingsOwnedSubpage }
        if isOrdinaryWorkspaceDestination(url) || isAccountEditRoute(url) { return .unexpectedRoute(url) }
        return .ignore
    }
}

enum WorkspaceSettingsSearchAction: Equatable {
    case section(WorkspaceSettingsSection)
    case workspacePath(String)
    case systemSettings(String)
}

/// One searchable destination. Results are declared statically, so a query can
/// never surface a person, conversation, credential or relationship record.
struct WorkspaceSettingsSearchEntry: Identifiable, Equatable {
    let id: String
    let title: String
    let detail: String
    let scope: String
    let destination: String
    let keywords: [String]
    let action: WorkspaceSettingsSearchAction

    /// NFKC width folding and whitespace removal make Chinese, full-width and
    /// spaced variants match the same alias.
    static func normalized(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
                      locale: Locale(identifier: "zh_CN"))
            .components(separatedBy: .whitespacesAndNewlines)
            .joined()
    }

    func matches(_ normalizedQuery: String) -> Bool {
        matchScore(normalizedQuery) != nil
    }

    /// Title matches rank first, then keyword/destination, then supporting copy.
    /// A positive score is the only way an entry becomes searchable.
    func matchScore(_ normalizedQuery: String) -> Int? {
        guard !normalizedQuery.isEmpty else { return nil }
        if Self.normalized(title).contains(normalizedQuery) { return 3 }
        if keywords.contains(where: { Self.normalized($0).contains(normalizedQuery) }) { return 2 }
        if Self.normalized(destination).contains(normalizedQuery) { return 2 }
        if Self.normalized(detail).contains(normalizedQuery) { return 1 }
        if Self.normalized(scope).contains(normalizedQuery) { return 1 }
        return nil
    }

    static func search(_ query: String) -> [WorkspaceSettingsSearchEntry] {
        let normalizedQuery = normalized(query)
        guard !normalizedQuery.isEmpty else { return [] }
        return all.enumerated()
            .compactMap { index, entry -> (index: Int, entry: WorkspaceSettingsSearchEntry, score: Int)? in
                guard let score = entry.matchScore(normalizedQuery) else { return nil }
                return (index, entry, score)
            }
            .sorted { $0.score == $1.score ? $0.index < $1.index : $0.score > $1.score }
            .map(\.entry)
    }

    /// A same-origin workspace URL for a handoff destination, or nil when the
    /// entry is native/system-owned or the origin cannot authorize the route.
    func resolvedURL(in origin: WorkspaceOrigin) -> URL? {
        switch action {
        case .workspacePath(let path):
            guard path == "/workspace" || path.hasPrefix("/workspace/"),
                  WorkspaceSurfacePolicy.isOrdinaryWorkspaceDestination(origin.url.appending(path: path)) else { return nil }
            let url = origin.url.appending(path: path)
            guard origin.contains(url) else { return nil }
            return url
        case .systemSettings(let value):
            return URL(string: value)
        case .section:
            return nil
        }
    }
}

extension WorkspaceSettingsSearchEntry {
    /// Static inventory of existing setting owners plus the workspace pages the
    /// settings panes link to. Counts, permissions and connection state are
    /// never asserted here.
    static let all: [WorkspaceSettingsSearchEntry] = [
        .init(id: "profile", title: "个人资料",
              detail: "头像、显示名称与个人介绍。", scope: "账号 · 头像仅此设备", destination: "设置 · 个人资料",
              keywords: ["个人资料", "头像", "名字", "显示名称", "个人介绍", "身份", "profile"],
              action: .section(.profile)),
        .init(id: "account", title: "账号与安全",
              detail: "登录方式、邮箱验证与已登录设备。", scope: "账号", destination: "设置 · 账号与安全",
              keywords: ["账号", "安全", "登录", "密码", "邮箱", "设备", "会话", "退出", "第三方登录"],
              action: .section(.account)),
        .init(id: "workspace", title: "工作空间",
              detail: "空间名称、成员与所有权。", scope: "当前空间", destination: "设置 · 工作空间",
              keywords: ["空间", "工作区", "成员", "所有权", "角色", "权限"],
              action: .section(.workspace)),
        .init(id: "appearance", title: "外观与偏好",
              detail: "界面主题与本机头像默认风格。", scope: "仅此 Mac", destination: "设置 · 外观与偏好",
              keywords: ["外观", "主题", "深色", "浅色", "跟随系统", "夜间", "头像风格", "语言", "时区"],
              action: .section(.appearance)),
        .init(id: "connections", title: "连接与权限",
              detail: "资料从哪里来，助手能做到哪一步。", scope: "当前空间", destination: "设置 · 连接与权限",
              keywords: ["连接", "权限", "来源", "授权", "资料", "数据", "外部服务", "边界"],
              action: .section(.connections)),
        .init(id: "advanced", title: "帮助与诊断",
              detail: "连接诊断、运行记录与数据边界。", scope: "当前空间", destination: "设置 · 帮助与诊断",
              keywords: ["帮助", "诊断", "问题", "排查", "运行记录", "边界", "权限"],
              action: .section(.advanced)),
        .init(id: "device", title: "此设备",
              detail: "内容大小、工作窗口、菜单栏与截图。", scope: "仅此 Mac · 本机保存", destination: "设置 · 此设备",
              keywords: ["此设备", "本机", "内容大小", "窗口", "缩放", "显示", "保持最前", "键盘快捷键", "菜单栏", "截图"],
              action: .section(.device)),
        .init(id: "updates", title: "软件更新",
              detail: "当前版本、更新源与自动检查。", scope: "仅此 Mac · 本机保存", destination: "设置 · 软件更新",
              keywords: ["更新", "升级", "版本", "自动检查", "预览版本", "软件更新", "update"],
              action: .section(.updates)),
        .init(id: "screen-recording", title: "屏幕录制权限",
              detail: "由 macOS 管理；返回后重新检查状态。", scope: "此设备", destination: "此设备 · 打开 macOS 系统设置",
              keywords: ["截图", "截屏", "屏幕录制", "录屏", "屏幕快照", "屏幕截图", "权限", "screenshot", "capture"],
              action: .systemSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")),
        .init(id: "captures", title: "截图作为资料的使用范围",
              detail: "导入截图与文档，并核对来源与归属。", scope: "当前空间", destination: "资料 · 截图与文档",
              keywords: ["截图", "截屏", "屏幕录制", "录屏", "屏幕快照", "屏幕截图", "screenshot", "capture", "文档", "导入", "资料", "来源"],
              action: .workspacePath("/workspace/captures")),
        .init(id: "capture-failure", title: "截图处理失败时怎么办",
              detail: "在帮助与诊断中查看故障恢复。", scope: "当前空间", destination: "设置 · 帮助与诊断",
              keywords: ["截图", "截屏", "屏幕录制", "失败", "故障", "恢复", "处理"],
              action: .section(.advanced)),
        .init(id: "extensions", title: "连接服务",
              detail: "查看可用扩展与真实连接状态。", scope: "当前空间", destination: "资料 · 连接服务",
              keywords: ["连接", "扩展", "外部服务", "集成", "浏览器收集", "浏览器扩展"],
              action: .workspacePath("/workspace/extensions")),
        .init(id: "preferences", title: "回复偏好",
              detail: "在单独页面管理助手的回复方式。", scope: "账号", destination: "Agent · 回复偏好",
              keywords: ["回复", "偏好", "回答", "回复方式", "回复顺序"],
              action: .workspacePath("/workspace/preferences")),
        .init(id: "monitor", title: "运行记录",
              detail: "查看任务进度与需要处理的问题。", scope: "当前空间", destination: "工作区 · 运行记录",
              keywords: ["运行记录", "任务", "进度", "监控", "monitor", "日志"],
              action: .workspacePath("/workspace/monitor")),
        .init(id: "boundaries", title: "数据与操作边界",
              detail: "了解资料访问与操作授权范围。", scope: "当前空间", destination: "工作区 · 数据与操作边界",
              keywords: ["边界", "数据", "操作", "授权", "权限"],
              action: .workspacePath("/workspace/boundaries")),
        .init(id: "lab", title: "功能实验室",
              detail: "查看当前启用的实验功能。", scope: "当前空间", destination: "工作区 · 功能实验室",
              keywords: ["实验室", "实验", "功能", "lab"],
              action: .workspacePath("/workspace/lab")),
        .init(id: "diagnostics", title: "连接诊断",
              detail: "遇到加载或连接问题时，检查服务状态。", scope: "当前空间", destination: "设置 · 帮助与诊断 · 连接诊断",
              keywords: ["诊断", "连接", "服务状态", "加载", "排查"],
              action: .section(.advanced)),
    ]
}

/// Pure search state so keyboard, focus and empty-result behavior can be
/// verified without a running window.
struct WorkspaceSettingsSearchState: Equatable {
    private(set) var query = ""
    private(set) var activeIndex = -1

    var results: [WorkspaceSettingsSearchEntry] { WorkspaceSettingsSearchEntry.search(query) }
    var isSearching: Bool { !WorkspaceSettingsSearchEntry.normalized(query).isEmpty }
    var isEmptyResult: Bool { isSearching && results.isEmpty }

    mutating func update(_ value: String) {
        query = value
        activeIndex = -1
    }

    mutating func clearQuery() {
        query = ""
        activeIndex = -1
    }

    mutating func reset() {
        query = ""
        activeIndex = -1
    }

    mutating func moveDown() {
        guard !results.isEmpty else { activeIndex = -1; return }
        activeIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % results.count
    }

    mutating func moveUp() {
        guard !results.isEmpty else { activeIndex = -1; return }
        activeIndex = activeIndex <= 0 ? results.count - 1 : activeIndex - 1
    }

    var activeEntry: WorkspaceSettingsSearchEntry? {
        results.indices.contains(activeIndex) ? results[activeIndex] : nil
    }
}

@MainActor
final class WorkspaceSettingsNavigation: ObservableObject {
    static let shared = WorkspaceSettingsNavigation()
    @Published var selection: WorkspaceSettingsSection = .profile
}

/// A second view of the same origin-specific data store, never a reload of the conversation.
private struct ConnectedSettingsSurface: View {
    @StateObject private var browser: WorkspaceBrowser
    @ObservedObject private var navigation = WorkspaceSettingsNavigation.shared
    @ObservedObject private var connection = WorkspaceConnection.shared
    @AppStorage("workspace.desktop.zoom") private var zoom = 1.0
    @Environment(\.openSettings) private var openSettings
    @Environment(\.openWindow) private var openWindow

    init(origin: WorkspaceOrigin) {
        let section = WorkspaceSettingsNavigation.shared.selection
        _browser = StateObject(wrappedValue: WorkspaceBrowser(origin: origin, settings: true,
            initialURL: (section.isWeb ? section : .profile).url(in: origin)))
    }
    var body: some View {
        ZStack {
            WorkspaceWebSurface(browser: browser, zoom: zoom)
            if let failure = browser.failure {
                VStack(spacing: 16) {
                    Text("设置暂不可用").font(.title2)
                    Text(failure).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Button("重新载入", action: browser.retry)
                    Button("检查本机连接") { navigation.selection = .device }
                }.padding(40).frame(maxWidth: .infinity, maxHeight: .infinity).background(.background)
            } else if browser.loading {
                ProgressView().controlSize(.small).frame(maxHeight: .infinity, alignment: .top).padding(12).allowsHitTesting(false)
            }
        }
        .onAppear {
            browser.openSettings = { openSettings() }
            // Handoff never loads the workbench here; the main window owns it.
            browser.openWorkspace = { openWindow(id: "workspace") }
        }
        .onChange(of: navigation.selection) { _, section in
            browser.settingsRecovery = nil
            guard section.isWeb else { return }
            let destination = section.url(in: browser.origin)
            guard browser.webView.url != destination else { return }
            browser.webView.load(URLRequest(url: destination))
        }
        .overlay(alignment: .bottom) {
            if let recovery = browser.settingsRecovery {
                VStack(alignment: .leading, spacing: 10) {
                    Label(recovery.message, systemImage: "exclamationmark.triangle")
                        .font(.callout)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 12) {
                        Button("在主窗口打开") {
                            WorkspaceNavigation.shared.pendingURL = recovery.destination
                            openWindow(id: "workspace")
                            browser.settingsRecovery = nil
                        }
                        Button("关闭") { browser.settingsRecovery = nil }
                    }
                }
                .padding(14)
                .frame(maxWidth: 520, alignment: .leading)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.12)))
                .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
                .padding(16)
                .accessibilityIdentifier("settings.recovery")
            }
        }
        .onChange(of: connection.inspectorEnabled) { _, enabled in browser.webView.isInspectable = enabled }
        .alert("在浏览器中打开？", isPresented: Binding(get: { browser.externalURL != nil }, set: { if !$0 { browser.externalURL = nil } })) {
            Button("打开") { if let url = browser.externalURL { NSWorkspace.shared.open(url) }; browser.externalURL = nil }
            Button("取消", role: .cancel) { browser.externalURL = nil }
        } message: { Text(browser.externalURL?.host ?? "此链接位于工作区之外。") }
    }
}

struct WorkspaceDesktopSettings: View {
    @AppStorage("workspace.desktop.zoom") private var zoom = 1.0
    @AppStorage("workspace.desktop.floating") private var floating = false
    @ObservedObject private var updater = DesktopUpdater.shared
    @ObservedObject private var connection = WorkspaceConnection.shared
    @ObservedObject private var navigation = WorkspaceSettingsNavigation.shared
    @Environment(\.openWindow) private var openWindow
    @State private var search = WorkspaceSettingsSearchState()
    @State private var searchMessage: String?
    @FocusState private var searchFocused: Bool

    private var pane: WorkspaceSettingsPane {
        WorkspaceSettingsPane.resolve(selection: navigation.selection, connected: connection.origin != nil)
    }

    var body: some View {
        HStack(spacing: 0) {
            rail
            Divider()
            content
        }
        .frame(minWidth: 860, idealWidth: 940, maxWidth: .infinity, minHeight: 620, idealHeight: 700, maxHeight: .infinity)
        .task { updater.start() }
    }

    // MARK: Rail

    private var rail: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("设置")
                .font(.title3.weight(.semibold))
                .padding(.horizontal, 18).padding(.top, 20).padding(.bottom, 12)

            searchField
                .padding(.horizontal, 12)
                .padding(.bottom, 16)

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(WorkspaceSettingsSection.groups) { group in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(group.title)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 14).padding(.bottom, 3)
                            ForEach(group.sections) { section in
                                railButton(section)
                            }
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 20)
            }

            Spacer(minLength: 0)

            Button("搜索设置") { searchFocused = true }
                .keyboardShortcut("f", modifiers: [.command])
                .frame(width: 0, height: 0)
                .opacity(0)
                .accessibilityHidden(true)
        }
        .frame(width: 224)
        .frame(maxHeight: .infinity)
        .background(.bar)
        .onMoveCommand { direction in
            switch direction {
            case .down: search.moveDown()
            case .up: search.moveUp()
            default: break
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            TextField("搜索设置", text: Binding(
                get: { search.query },
                set: { search.update($0); searchMessage = nil }
            ))
            .textFieldStyle(.plain)
            .focused($searchFocused)
            .accessibilityLabel("搜索设置")
            .accessibilityIdentifier("settings.search.field")
            .onSubmit { activate(search.activeEntry) }
            .onKeyPress(.downArrow) { search.moveDown(); return .handled }
            .onKeyPress(.upArrow) { search.moveUp(); return .handled }
            .onKeyPress(.escape) {
                if search.isSearching { search.clearQuery() } else { searchFocused = false }
                searchMessage = nil
                return .handled
            }
            if search.query.isEmpty {
                Text("⌘F")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            } else {
                Button {
                    search.reset(); searchMessage = nil
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 12))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.tertiary)
                .accessibilityLabel("清除搜索")
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 8))
    }

    private func railButton(_ section: WorkspaceSettingsSection) -> some View {
        let selected = navigation.selection == section
        return Button {
            navigation.selection = section
            search.reset()
            searchMessage = nil
        } label: {
            Text(section.title)
                .font(.system(size: 13, weight: selected ? .medium : .regular))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(selected ? Color.primary.opacity(0.075) : Color.clear, in: RoundedRectangle(cornerRadius: 7))
                .overlay(alignment: .leading) {
                    if selected {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color.accentColor)
                            .frame(width: 3, height: 15)
                            .offset(x: 2)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.section.\(section.rawValue)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: Content

    private var content: some View {
        ZStack(alignment: .top) {
            paneContent
            if search.isSearching {
                searchOverlay
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var paneContent: some View {
        ZStack {
            if let origin = connection.origin {
                // Kept mounted across selection changes so the Web surface and
                // its one Settings navigation never reload on a rail change.
                ConnectedSettingsSurface(origin: origin).id(origin.url)
                    .opacity(pane.showsWebContent ? 1 : 0)
                    .allowsHitTesting(pane.showsWebContent)
                    .accessibilityHidden(!pane.showsWebContent)
            }
            switch pane {
            case .device: devicePane
            case .updates: updatesPane
            case .requiresConnection(let section): offlinePane(section)
            case .web: EmptyView()
            }
        }
    }

    private var devicePane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("此设备").font(.title2.weight(.semibold))
                Text("本机控制在工作空间断线时仍然可用。")
                    .font(.callout).foregroundStyle(.secondary)

                if connection.origin == nil {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "bolt.horizontal.circle").foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("尚未连接工作区").font(.callout.weight(.medium))
                            Text("下方本机控制不受影响；需要读取或保存账号设置时再连接。")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
                }

                VStack(alignment: .leading, spacing: 16) {
                    Picker("内容大小", selection: $zoom) {
                        Text("90%").tag(0.9); Text("100%").tag(1.0); Text("110%").tag(1.1)
                        Text("125%").tag(1.25); Text("150%").tag(1.5)
                    }
                    Toggle("工作窗口保持在最前", isOn: $floating)
                }
                Divider()
                CaptureDeviceSettings()
                Divider()
                WorkspaceConnectionForm(mode: .settings) { openWindow(id: "workspace") }
                DisclosureGroup("键盘快捷键") {
                    VStack(spacing: 12) {
                        LabeledContent("新对话", value: "⌘ N")
                        LabeledContent("人物 / 日程", value: "⌘ 1 / ⌘ 2")
                        LabeledContent("设置", value: "⌘ ,")
                        LabeledContent("重新载入", value: "⌘ R")
                    }.padding(.top, 12)
                }
            }.padding(32).frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
        }.background(.background)
    }

    private func offlinePane(_ section: WorkspaceSettingsSection) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(section.title).font(.title2.weight(.semibold))
                Text("这部分设置需要连接工作区后才能读取或保存。此设备与软件更新仍可离线使用。")
                    .font(.callout).foregroundStyle(.secondary)
                Button("前往此设备") { navigation.selection = .device }
                    .buttonStyle(.borderedProminent)
                Divider()
                WorkspaceConnectionForm(mode: .settings) { openWindow(id: "workspace") }
            }.padding(32).frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
        }.background(.background)
    }

    private var updatesPane: some View {
            Form {
                Section {
                    LabeledContent("当前版本", value: updater.appVersion)
                    Text(updater.status).foregroundStyle(.secondary)
                    if let checked = updater.presentation.lastChecked {
                        LabeledContent("上次验证更新源", value: checked.formatted(date: .abbreviated, time: .shortened))
                    }
                    if let offerID = updater.presentation.offerID {
                        Button("更新并重启") { updater.installUpdate(offerID: offerID) }
                            .accessibilityIdentifier("updates.install")
                    } else {
                        Button("检查更新") { updater.checkForUpdates() }
                            .disabled(!updater.isConfigured || !updater.canCheck || updater.presentation.busy)
                            .accessibilityIdentifier("updates.check")
                    }
                    if updater.canRetryRelaunch {
                        Button("再次尝试重启") { updater.retryRelaunch() }
                    }
                }
                Section {
                    Toggle("自动检查更新", isOn: $updater.automaticChecks).disabled(!updater.isConfigured)
                    Toggle("接收预览版本", isOn: $updater.includesPreview)
                        .disabled(!updater.isConfigured || updater.sessionInProgress)
                } footer: {
                    Text("新版本会在左下角提醒。点击“更新并重启”后，会下载、校验并重新打开应用，不再弹出确认。未点击时不会安装或重启。")
                }
                Section {
                    Link("版本记录与安装帮助", destination: URL(string: "https://github.com/getyak/talent-signal/releases?q=macos-")!)
                    if !updater.isConfigured {
                        Text("正式签名更新尚未配置。可从版本记录下载已发布的安装包。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }.formStyle(.grouped)

    }

    // MARK: Search

    private var searchOverlay: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("搜索设置").font(.headline)
                Spacer()
                Text("Esc 关闭").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 10)

            if search.results.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("没有找到“\(search.query.trimmingCharacters(in: .whitespacesAndNewlines))”对应的设置。")
                        .font(.callout)
                    Text("可以试试账号、外观、连接、工作空间、此设备或截图与文档。关系资料不会出现在设置搜索中。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 20).padding(.bottom, 18)
            } else {
                Text("匹配结果").font(.caption).foregroundStyle(.secondary)
                    .padding(.horizontal, 20).padding(.bottom, 6)
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(search.results.indices, id: \.self) { index in
                            searchResultRow(search.results[index], index: index)
                        }
                    }
                    .padding(.horizontal, 12).padding(.bottom, 16)
                }
            }

            if let searchMessage {
                Text(searchMessage).font(.caption).foregroundStyle(.red)
                    .padding(.horizontal, 20).padding(.bottom, 14)
            }
        }
        .frame(maxWidth: 580, maxHeight: 440, alignment: .topLeading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.primary.opacity(0.1)))
        .shadow(color: .black.opacity(0.18), radius: 18, y: 8)
        .padding(.top, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.black.opacity(0.05))
    }

    private func searchResultRow(_ entry: WorkspaceSettingsSearchEntry, index: Int) -> some View {
        Button {
            activate(entry)
        } label: {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(entry.title)
                        .font(.system(size: 13, weight: index == search.activeIndex ? .semibold : .regular))
                        .foregroundStyle(.primary)
                    Text(entry.detail)
                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 3) {
                    Text(entry.scope).font(.caption2).foregroundStyle(.secondary)
                    Text(entry.destination).font(.caption2).foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(index == search.activeIndex ? Color.accentColor.opacity(0.1) : Color.clear,
                        in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.search.result.\(entry.id)")
    }

    /// Routing never invents a privileged bridge: native sections select the
    /// rail, system settings open the OS pane, and workspace destinations hand
    /// off to the main window only after the origin authorizes the URL.
    private func activate(_ entry: WorkspaceSettingsSearchEntry?) {
        guard let entry else { return }
        switch entry.action {
        case .section(let section):
            navigation.selection = section
            search.reset(); searchMessage = nil; searchFocused = false
        case .workspacePath:
            guard let origin = connection.origin, let url = entry.resolvedURL(in: origin) else {
                searchMessage = "需要先连接工作区，才能打开“\(entry.title)”。"
                return
            }
            WorkspaceNavigation.shared.pendingURL = url
            openWindow(id: "workspace")
            search.reset(); searchMessage = nil; searchFocused = false
        case .systemSettings(let value):
            guard let url = URL(string: value) else { return }
            // Only claim System Settings opened, never that permission was granted.
            if NSWorkspace.shared.open(url) {
                search.reset(); searchMessage = nil; searchFocused = false
            } else {
                searchMessage = "无法打开 macOS 系统设置。请手动打开“系统设置 → 隐私与安全性”，返回后重新检查屏幕录制权限。"
            }
        }
    }
}

struct WorkspaceWindowBehavior: NSViewRepresentable {
    let floating: Bool

    final class View: NSView {
        var floating = false
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            window?.level = floating ? .floating : .normal
        }
    }

    func makeNSView(context: Context) -> View { View() }
    func updateNSView(_ view: View, context: Context) {
        view.floating = floating
        view.window?.level = floating ? .floating : .normal
    }
}
