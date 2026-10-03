import Foundation

/// Where a search result actually routes. Native sections select the rail,
/// account entries ask the OS to open the browser, workspace paths hand off to
/// the main window and system settings open the macOS pane.
enum WorkspaceSettingsSearchAction: Equatable {
    case section(WorkspaceSettingsSection)
    case accountBrowser(AccountSettingsDestination)
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
    /// entry is native/system/browser-owned or the origin cannot authorize it.
    func resolvedURL(in origin: WorkspaceOrigin?) -> URL? {
        switch action {
        case .workspacePath(let path):
            guard let origin,
                  path == "/workspace" || path.hasPrefix("/workspace/"),
                  WorkspaceSurfacePolicy.isOrdinaryWorkspaceDestination(origin.url.appending(path: path)) else { return nil }
            let url = origin.url.appending(path: path)
            guard origin.contains(url) else { return nil }
            return url
        case .systemSettings(let value):
            return URL(string: value)
        case .section, .accountBrowser:
            return nil
        }
    }
}

extension WorkspaceSettingsSearchEntry {
    /// Static inventory of the setting owners this Mac can act on. Counts,
    /// permissions and connection state are never asserted here.
    static let all: [WorkspaceSettingsSearchEntry] = [
        .init(id: "general", title: "通用",
              detail: "内容大小、工作窗口与键盘快捷键。", scope: "仅此 Mac", destination: "设置 · 通用",
              keywords: ["通用", "内容大小", "窗口", "缩放", "显示", "保持最前", "键盘快捷键", "菜单栏", "general"],
              action: .section(.general)),
        .init(id: "companion", title: "桌面伙伴",
              detail: "选择伙伴、显示或隐藏，以及拖动位置与轻微动画。", scope: "仅此 Mac", destination: "设置 · 桌面伙伴",
              keywords: ["桌面伙伴", "宠物", "显示伙伴", "隐藏伙伴", "mini", "pet", "动画", "位置", "拖动"],
              action: .section(.companion)),
        .init(id: "permissions", title: "权限",
              detail: "屏幕录制等由 macOS 管理的权限状态。", scope: "此设备", destination: "设置 · 权限",
              keywords: ["权限", "屏幕录制", "录屏", "系统权限", "系统设置", "隐私", "permission"],
              action: .section(.permissions)),
        .init(id: "connection", title: "连接与诊断",
              detail: "本机连接配置、测试连接与受保护的工作区页面。", scope: "本机与当前空间", destination: "设置 · 连接与诊断",
              keywords: ["连接", "诊断", "问题", "排查", "服务", "地址", "来源", "边界", "运行记录"],
              action: .section(.connection)),
        .init(id: "updates", title: "软件更新",
              detail: "本机当前版本、更新源与自动检查。", scope: "仅此 Mac · 本机保存", destination: "设置 · 软件更新",
              keywords: ["更新", "升级", "版本", "自动检查", "预览版本", "软件更新", "update"],
              action: .section(.updates)),
        .init(id: "account", title: "账号与偏好",
              detail: "在默认浏览器中管理个人资料、账号安全与偏好。", scope: "账号 · 浏览器", destination: "浏览器 · 账号与偏好",
              keywords: ["账号", "偏好", "个人资料", "安全", "登录", "密码", "邮箱", "外观", "主题", "浏览器", "account", "profile"],
              action: .accountBrowser(.overview)),
        .init(id: "captures", title: "截图作为资料的使用范围",
              detail: "导入截图与文档，并核对来源与归属。", scope: "当前空间", destination: "资料 · 截图与文档",
              keywords: ["截图", "截屏", "屏幕录制", "录屏", "屏幕快照", "屏幕截图", "screenshot", "capture", "文档", "导入", "资料", "来源"],
              action: .workspacePath("/workspace/captures")),
        .init(id: "screen-recording", title: "屏幕录制权限",
              detail: "由 macOS 管理；返回后重新检查状态。", scope: "此设备", destination: "设置 · 权限 · 打开 macOS 系统设置",
              keywords: ["截图", "截屏", "屏幕录制", "录屏", "屏幕快照", "屏幕截图", "权限", "screenshot", "capture"],
              action: .systemSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")),
        // Restored from the previous search inventory (build 33 / origin/main):
        // capture-failure recovery must stay findable. Its old "帮助与诊断"
        // section no longer exists natively, so it now opens the native
        // diagnostics pane, which works with no Web origin at all.
        .init(id: "capture-failure", title: "截图处理失败时怎么办",
              detail: "在连接与诊断中运行排查，查看设备权限与连接状态。", scope: "此设备", destination: "设置 · 连接与诊断",
              keywords: ["截图", "截屏", "屏幕录制", "失败", "故障", "恢复", "处理"],
              action: .section(.connection)),
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
