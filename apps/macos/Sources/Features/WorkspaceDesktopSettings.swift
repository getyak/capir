import AppKit
import CoreGraphics
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
    /// A same-origin workspace URL requested by a trusted handoff. The main
    /// workspace window consumes it; Settings must not render it.
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
            Button("此 Mac 设置…") { browser?.requestSettingsOpen() }
                .keyboardShortcut(",", modifiers: [.command, .shift]).disabled(browser == nil)
        }
    }
}

/// The one native settings schema. Every case is owned by this Mac or macOS,
/// never by account data that only the browser can read or write.
enum WorkspaceSettingsSection: String, CaseIterable, Identifiable {
    case general, companion, permissions, connection, updates

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: "通用"
        case .companion: "桌面伙伴"
        case .permissions: "权限"
        case .connection: "连接与诊断"
        case .updates: "软件更新"
        }
    }

    var symbol: String {
        switch self {
        case .general: "slider.horizontal.3"
        case .companion: "bird"
        case .permissions: "lock.shield"
        case .connection: "network"
        case .updates: "arrow.down.circle"
        }
    }
}

struct WorkspaceSettingsSectionGroup: Identifiable {
    let title: String
    let sections: [WorkspaceSettingsSection]
    var id: String { title }
}

extension WorkspaceSettingsSection {
    static let groups: [WorkspaceSettingsSectionGroup] = [
        .init(title: "此 Mac", sections: [.general, .companion, .permissions, .updates]),
        .init(title: "支持", sections: [.connection]),
    ]
}

/// The single pane a selection shows. Every pane is a native device control and
/// stays usable without a workspace connection.
enum WorkspaceSettingsPane: Equatable, CaseIterable {
    case general, companion, permissions, connection, updates

    static func resolve(selection: WorkspaceSettingsSection) -> WorkspaceSettingsPane {
        switch selection {
        case .general: .general
        case .companion: .companion
        case .permissions: .permissions
        case .connection: .connection
        case .updates: .updates
        }
    }

    var section: WorkspaceSettingsSection {
        switch self {
        case .general: .general
        case .companion: .companion
        case .permissions: .permissions
        case .connection: .connection
        case .updates: .updates
        }
    }

    var title: String { section.title }

    /// Every pane is a native device control and stays usable offline.
    var isNativeDeviceControl: Bool { true }

    /// The stable inventory of panes, used to prove offline availability
    /// without opening a window.
    static var allCases: [WorkspaceSettingsPane] { [.general, .companion, .permissions, .connection, .updates] }
}

/// Classifies same-origin navigation so Settings and the main workspace keep
/// distinct owners. Pure and origin-validated, so it is cheap to unit test and
/// impossible to widen with an unchecked URL.
enum WorkspaceSurfacePolicy {
    /// Settings-owned routes stay out of the main workbench. Web Settings is an
    /// ordinary browser page; inside the desktop app a settings link opens the
    /// native window instead of rendering account settings in the workspace.
    static func isSettingsOwned(_ url: URL) -> Bool {
        let path = url.path
        return path == "/workspace/settings" || path.hasPrefix("/workspace/settings/")
    }

    /// The main window may only remember an ordinary `/workspace` route as a
    /// restore target. Foreign origins, `about:blank`, `/login`, `/onboarding`
    /// and settings-owned routes are never tracked, so a later fallback cannot
    /// reload them.
    static func isTrackableWorkbenchURL(_ url: URL?, origin: WorkspaceOrigin) -> Bool {
        guard let url, origin.contains(url) else { return false }
        return isOrdinaryWorkspaceDestination(url)
    }

    /// The seeded restore target when the main workbench starts. A non-workbench
    /// initial target (for example an `/onboarding` or `/login` callback) must
    /// not become a restore target, so it falls back to the known entry route.
    static func initialWorkbenchURL(initialURL: URL?, origin: WorkspaceOrigin) -> URL {
        guard let initialURL, isTrackableWorkbenchURL(initialURL, origin: origin) else { return origin.entryURL }
        return initialURL
    }

    /// Ordinary workspace destinations own the full workbench chrome.
    static func isOrdinaryWorkspaceDestination(_ url: URL) -> Bool {
        let path = url.path
        guard path == "/workspace" || path.hasPrefix("/workspace/") else { return false }
        return !isSettingsOwned(url)
    }

    /// Display-only desktop chrome projection. The signed host owns truth; this
    /// carries the real bundle-derived app version alongside the update offer so
    /// the Web version pane never has to infer an installed version.
    static func desktopChromePayload(surface: String,
                                     presentation: DesktopUpdatePresentation,
                                     appVersion: String) -> [String: Any] {
        ["protocolVersion": 1,
         "surface": surface,
         "appVersion": appVersion,
         "availableVersion": presentation.version as Any? ?? NSNull(),
         "phase": presentation.phase.rawValue,
         "offerID": presentation.offerID?.uuidString as Any? ?? NSNull(),
         "progress": presentation.progress as Any? ?? NSNull()]
    }

    /// A main-window client-side transition to the Web Settings route that
    /// bypassed the navigation delegate (`Next.js Link` + `pushState`). Account
    /// settings always go to the browser, never into the native device window;
    /// `restoreURL` is the prior same-origin workbench URL, when one is known
    /// and is not itself a Settings route.
    struct WorkbenchSettingsTransition: Equatable {
        let destination: AccountSettingsDestination
        let restoreURL: URL?

        init(destination: AccountSettingsDestination, restoreURL: URL?) {
            self.destination = destination
            self.restoreURL = restoreURL
        }

        init(from url: URL, restoreURL: URL?) {
            self.init(destination: Self.accountDestination(forSettingsURL: url), restoreURL: restoreURL)
        }

        /// Maps a Web Settings URL onto the fixed allowlist of account
        /// destinations the browser may open. Unknown or absent sections fall
        /// back to the settings overview; nothing else in the URL is read, so no
        /// identity, token or arbitrary path can cross the boundary.
        static func accountDestination(forSettingsURL url: URL) -> AccountSettingsDestination {
            guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
                  let value = items.first(where: { $0.name == "section" })?.value,
                  let destination = AccountSettingsDestination(rawValue: value) else { return .overview }
            return destination
        }
    }

    static func workbenchSettingsTransition(from previous: URL?, to current: URL?,
                                            origin: WorkspaceOrigin) -> WorkbenchSettingsTransition? {
        guard let current, origin.contains(current), isSettingsOwned(current) else { return nil }
        return WorkbenchSettingsTransition(
            from: current,
            restoreURL: isTrackableWorkbenchURL(previous, origin: origin) ? previous : nil)
    }

    /// How the main window returns after a client-side Settings hop. A matching
    /// same-document back item is popped without any reload (the URL KVO fires
    /// with `backItem` already set for `pushState`). Otherwise the fallback is
    /// explicit: load a safe URL and say drafts may not have survived.
    enum WorkbenchRestorePlan: Equatable {
        case back(URL)
        case load(URL, notice: String)
    }

    static func workbenchRestorePlan(for transition: WorkbenchSettingsTransition,
                                     canGoBack: Bool, backItemURL: URL?,
                                     entryURL: URL, browserOpened: Bool = true) -> WorkbenchRestorePlan {
        if let target = transition.restoreURL, canGoBack, backItemURL == target {
            return .back(target)
        }
        // No safe prior state or no matching history entry. Do not claim a
        // draft was preserved; be explicit about what the user should check.
        let safe = transition.restoreURL ?? entryURL
        let browserStatus = browserOpened
            ? "账号设置已在默认浏览器中打开。"
            : "账号设置未能在默认浏览器中打开。"
        let restoreStatus = transition.restoreURL == nil
            ? "无法确认先前的对话位置，主窗口已回到工作区首页；未保存的输入可能未保留。"
            : "返回历史不可用，已重新载入上次工作区地址；未保存的输入可能未保留。"
        let notice = browserStatus + restoreStatus
        return .load(safe, notice: notice)
    }
}

@MainActor
final class WorkspaceSettingsNavigation: ObservableObject {
    static let shared = WorkspaceSettingsNavigation()
    @Published var selection: WorkspaceSettingsSection = .general
}

/// Native settings. It never embeds a WebView and never probes the Web, so it
/// stays usable when the workspace service is offline or on an old release.
struct WorkspaceDesktopSettings: View {
    @AppStorage("workspace.desktop.zoom") private var zoom = 1.0
    @AppStorage("workspace.desktop.floating") private var floating = false
    @ObservedObject private var updater = DesktopUpdater.shared
    @ObservedObject private var connection = WorkspaceConnection.shared
    @ObservedObject private var navigation = WorkspaceSettingsNavigation.shared
    @Environment(\.openWindow) private var openWindow
    @State private var search = WorkspaceSettingsSearchState()
    @State private var searchMessage: String?
    @State private var connectionProbe: ConnectionProbeResult?
    @State private var connectionProbing = false
    @State private var accountLaunchFailed = false
    @State private var screenRecordingAllowed = CGPreflightScreenCaptureAccess()
    @FocusState private var searchFocused: Bool

    private var pane: WorkspaceSettingsPane {
        WorkspaceSettingsPane.resolve(selection: navigation.selection)
    }

    var body: some View {
        HStack(spacing: 0) {
            rail
            Divider()
            content
        }
        .frame(minWidth: 820,
               idealWidth: navigation.selection == .companion ? 1040 : 900,
               maxWidth: .infinity, minHeight: 600, idealHeight: 680, maxHeight: .infinity)
        .background(SettingsWindowTitle(title: "此 Mac 设置"))
        .task { updater.start() }
    }

    private var rail: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("此 Mac 设置")
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
                .padding(.bottom, 12)
            }

            Spacer(minLength: 0)

            Divider().padding(.horizontal, 16)
            accountRow.padding(.horizontal, 12).padding(.vertical, 12)
            Divider().padding(.horizontal, 16)
            VStack(alignment: .leading, spacing: 3) {
                Text("此 Mac · \(updater.appVersion)")
                    .font(.caption2).foregroundStyle(.secondary)
                if updater.presentation.offerID != nil {
                    Text("有可用更新").font(.caption2).foregroundStyle(.primary)
                }
            }
            .padding(.horizontal, 18).padding(.vertical, 12)
            .accessibilityIdentifier("settings.installedVersion")

            Button("搜索设置") { searchFocused = true }
                .keyboardShortcut("f", modifiers: [.command])
                .frame(width: 0, height: 0)
                .opacity(0)
                .accessibilityHidden(true)
        }
        .frame(width: 244)
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

    /// Account and preferences are owned by the browser. The label says so
    /// before the click, and the click only asks the OS to open the page.
    private var accountRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { openAccountSettings(.overview) } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up.right.square")
                    Text("账号与偏好 ↗")
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("settings.account.browser")
            .accessibilityHint("在默认浏览器中打开，浏览器使用它自己登录的账号")
            Text(connection.origin == nil
                 ? "需要先连接工作区，浏览器才能打开账号设置。"
                 : "浏览器使用它自己登录的账号，可能与应用内的账号不同。")
                .font(.caption2).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if accountLaunchFailed {
                Text(connection.origin == nil
                     ? "尚未连接工作区，暂时无法打开账号设置。"
                     : "无法打开默认浏览器。请检查默认浏览器，然后重试。")
                    .font(.caption2).foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                if connection.origin != nil {
                    Button("重试") { openAccountSettings(.overview) }
                        .controlSize(.small)
                        .accessibilityIdentifier("settings.account.retry")
                }
            }
        }
    }

    private func openAccountSettings(_ destination: AccountSettingsDestination) {
        accountLaunchFailed = !AccountSettingsBrowser.shared.open(destination, in: connection.origin)
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12)).foregroundStyle(.secondary)
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
                Text("⌘F").font(.system(size: 10)).foregroundStyle(.tertiary)
            } else {
                Button { search.reset(); searchMessage = nil } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 12))
                }
                .buttonStyle(.plain).foregroundStyle(.tertiary)
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
                        RoundedRectangle(cornerRadius: 2).fill(Color.accentColor)
                            .frame(width: 3, height: 15).offset(x: 2)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.section.\(section.rawValue)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var content: some View {
        ZStack(alignment: .top) {
            paneContent
            if search.isSearching { searchOverlay }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var paneContent: some View {
        switch pane {
        case .general: generalPane
        case .companion: DesktopPetSettingsView()
        case .permissions: permissionsPane
        case .connection: connectionPane
        case .updates: updatesPane
        }
    }

    private var generalPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("通用").font(.title2.weight(.semibold))
                Text("这些控制只影响这台 Mac，断线时仍然可用。")
                    .font(.callout).foregroundStyle(.secondary)
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
                DisclosureGroup("键盘快捷键") {
                    VStack(spacing: 12) {
                        LabeledContent("新对话", value: "⌘ N")
                        LabeledContent("人物 / 日程", value: "⌘ 1 / ⌘ 2")
                        LabeledContent("此 Mac 设置", value: "⌘ ,")
                        LabeledContent("重新载入", value: "⌘ R")
                    }.padding(.top, 12)
                }
            }.padding(32).frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
        }.background(.background)
    }

    /// Real macOS permission status plus an intentional System Settings link.
    /// The app never claims a permission was granted from the link click alone.
    private var permissionsPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("权限").font(.title2.weight(.semibold))
                Text("截图与文档功能需要由 macOS 管理的屏幕录制权限。这里显示真实状态，授权只能在系统设置中完成。")
                    .font(.callout).foregroundStyle(.secondary)
                GroupBox {
                    VStack(alignment: .leading, spacing: 12) {
                        LabeledContent("屏幕录制") {
                            Label(screenRecordingAllowed ? "已允许" : "未允许",
                                  systemImage: screenRecordingAllowed ? "checkmark.circle" : "exclamationmark.circle")
                                .foregroundStyle(screenRecordingAllowed ? Color.secondary : Color.orange)
                        }
                        HStack(spacing: 12) {
                            Button("打开系统设置") {
                                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
                                    _ = NSWorkspace.shared.open(url)
                                }
                            }
                            .accessibilityIdentifier("permissions.systemSettings")
                            Button("重新检查") { screenRecordingAllowed = CGPreflightScreenCaptureAccess() }
                                .accessibilityIdentifier("permissions.recheck")
                        }
                        Text("点击“打开系统设置”只会打开 macOS 面板，不代表权限已更改。返回后请重新检查。")
                            .font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }.padding(6)
                } label: {
                    Text("由 macOS 管理").font(.callout.weight(.medium))
                }
            }.padding(32).frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
        }.background(.background)
    }

    /// Connection and diagnostics live under an advanced disclosure and never
    /// print secrets. Account reading and saving happen in the browser.
    private var connectionPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("连接与诊断").font(.title2.weight(.semibold))
                Text("本机控制不依赖连接；需要读取或保存账号设置时，请在浏览器中打开。")
                    .font(.callout).foregroundStyle(.secondary)
                WorkspaceConnectionForm(mode: .settings) { openWindow(id: "workspace") }
                DisclosureGroup("高级诊断") {
                    VStack(alignment: .leading, spacing: 12) {
                        LabeledContent("当前工作区", value: connection.origin?.url.host ?? "尚未连接")
                        Button(connectionProbing ? "正在检查…" : "测试连接") { runConnectionProbe() }
                            .disabled(connection.origin == nil || connectionProbing)
                            .accessibilityIdentifier("connection.probe")
                        if let result = connectionProbe {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.summary).font(.callout.weight(.medium))
                                Text(result.detail).font(.caption).foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Text("诊断只检查本机到工作区的连接，不包含凭据、令牌或账号标识。")
                            .font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }.padding(.top, 12)
                }
            }.padding(32).frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
        }.background(.background)
    }

    private func runConnectionProbe() {
        guard let origin = connection.origin else { return }
        connectionProbing = true
        connectionProbe = nil
        Task { @MainActor in
            connectionProbe = await WorkspaceConnectionProbe(origin: origin).run()
            connectionProbing = false
        }
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
                if updater.canRetryRelaunch { Button("再次尝试重启") { updater.retryRelaunch() } }
            }
            Section {
                Toggle("自动检查更新", isOn: $updater.automaticChecks).disabled(!updater.isConfigured)
                Toggle("接收预览版本", isOn: $updater.includesPreview)
                    .disabled(!updater.isConfigured || updater.sessionInProgress)
            } footer: {
                Text("新版本会在左下角提醒。点击“更新并重启”后，会下载、校验并重新打开应用，不再弹出确认。未点击时不会安装或重启。")
            }
            Section {
                Link("版本记录与安装帮助", destination: URL(string: "https://github.com/getyak/talent-signal/releases")!)
                if !updater.isConfigured {
                    Text("正式签名更新尚未配置。可从版本记录下载已发布的安装包。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }.formStyle(.grouped)
    }

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
                    Text("没有找到与“\(search.query.trimmingCharacters(in: .whitespacesAndNewlines))”匹配的设置。")
                        .font(.callout)
                    Text("可以试试通用、权限、连接、软件更新、账号，或截图与文档。关系资料不会出现在设置搜索中。")
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 20).padding(.bottom, 20)
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(search.results.enumerated()), id: \.element.id) { index, entry in
                            searchRow(entry, active: index == search.activeIndex)
                        }
                    }
                    .padding(.horizontal, 10).padding(.bottom, 12)
                }
            }

            if let searchMessage {
                Text(searchMessage)
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(.horizontal, 20).padding(.bottom, 14)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: 520, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(.separator) }
        .shadow(color: .black.opacity(0.18), radius: 18, y: 8)
        .padding(.top, 24).padding(.horizontal, 24)
    }

    private func searchRow(_ entry: WorkspaceSettingsSearchEntry, active: Bool) -> some View {
        Button { activate(entry) } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(entry.title).font(.system(size: 13, weight: .medium))
                    Text(entry.scope)
                        .font(.system(size: 10)).foregroundStyle(.secondary)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Color.primary.opacity(0.07), in: Capsule())
                }
                Text(entry.detail).font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(entry.destination).font(.system(size: 10)).foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10).padding(.vertical, 8)
            .background(active ? Color.accentColor.opacity(0.14) : Color.clear,
                        in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.search.result.\(entry.id)")
    }

    /// Routes a search result to its real owner. Native sections stay in place;
    /// browser, workspace and macOS destinations each get an explicit handoff,
    /// and every failure is reported instead of silently doing nothing.
    private func activate(_ entry: WorkspaceSettingsSearchEntry?) {
        guard let entry else { return }
        switch entry.action {
        case .section(let section):
            navigation.selection = section
            search.reset()
            searchMessage = nil
        case .accountBrowser(let destination):
            searchMessage = nil
            accountLaunchFailed = false
            if !AccountSettingsBrowser.shared.open(destination, in: connection.origin) {
                searchMessage = connection.origin == nil
                    ? "需要先连接工作区，浏览器才能打开账号设置。"
                    : "无法打开默认浏览器，账号设置未打开。"
            }
        case .workspacePath:
            guard let url = entry.resolvedURL(in: connection.origin) else {
                searchMessage = "需要先连接工作区，才能打开这个工作区页面。"
                return
            }
            WorkspaceNavigation.shared.pendingURL = url
            openWindow(id: "workspace")
            searchMessage = nil
        case .systemSettings(let value):
            guard let url = URL(string: value), NSWorkspace.shared.open(url) else {
                searchMessage = "无法打开 macOS 系统设置，请手动打开“隐私与安全性 → 屏幕录制”。"
                return
            }
            searchMessage = "已请求打开 macOS 系统设置。权限状态返回后请重新检查。"
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

private struct SettingsWindowTitle: NSViewRepresentable {
    let title: String

    final class View: NSView {
        var windowTitle = ""
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if !windowTitle.isEmpty { window?.title = windowTitle }
        }
    }

    func makeNSView(context: Context) -> View { View() }
    func updateNSView(_ view: View, context: Context) {
        view.windowTitle = title
        view.window?.title = title
        DispatchQueue.main.async { [weak view] in view?.window?.title = title }
    }
}
