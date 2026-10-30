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
    @AppStorage("workspace.desktop.zoom") private var zoom = 1.0

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Chat") { browser?.startNewConversation() }
                .keyboardShortcut("n")
                .disabled(browser == nil || browser?.signedOut == true || browser?.loading == true)
        }
        CommandGroup(after: .toolbar) {
            Divider()
            Button("Back") { browser?.webView.goBack() }
                .keyboardShortcut("[").disabled(browser?.webView.canGoBack != true)
            Button("Forward") { browser?.webView.goForward() }
                .keyboardShortcut("]").disabled(browser?.webView.canGoForward != true)
            Button("Reload") { browser?.retry() }
                .keyboardShortcut("r").disabled(browser == nil)
            Divider()
            Button("Zoom In") { zoom = WorkspaceContentZoom.step(zoom, direction: 1) }
                .keyboardShortcut("+", modifiers: [.command])
                .disabled(browser == nil || WorkspaceContentZoom.clamp(zoom) >= 2)
            Button("Zoom Out") { zoom = WorkspaceContentZoom.step(zoom, direction: -1) }
                .keyboardShortcut("-", modifiers: [.command])
                .disabled(browser == nil || WorkspaceContentZoom.clamp(zoom) <= 0.9)
            Button("Actual Size") { zoom = 1 }
                .keyboardShortcut("0", modifiers: [.command]).disabled(browser == nil)
            Menu("Workspace Appearance") {
                Picker("Workspace Appearance", selection: Binding(
                    get: { browser?.appearancePreference ?? .system },
                    set: { browser?.selectAppearance($0) }
                )) {
                    ForEach(WorkspaceAppearance.allCases, id: \.self) { preference in
                        Text(preference.title).tag(preference)
                    }
                }
                .pickerStyle(.inline)
            }
            .disabled(browser == nil || browser?.signedOut == true ||
                      browser?.loading == true || browser?.savingAppearance == true)
        }
        CommandMenu("Go") {
            Button("People") { browser?.navigate(.people) }
                .keyboardShortcut("1").disabled(browser == nil)
            Button("Time") { browser?.navigate(.calendar) }
                .keyboardShortcut("2").disabled(browser == nil)
            Button("This Mac Settings…") { browser?.requestSettingsOpen() }
                .keyboardShortcut(",", modifiers: [.command, .shift]).disabled(browser == nil)
        }
    }
}

/// One scale for the View menu, Settings and WebKit. Invalid persisted values
/// recover to actual size rather than propagating NaN to the renderer.
enum WorkspaceContentZoom {
    static let steps: [Double] = [0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
    static func clamp(_ value: Double) -> Double { value.isFinite ? min(2, max(0.9, value)) : 1 }
    static func step(_ value: Double, direction: Int) -> Double {
        let current = clamp(value)
        if direction > 0 { return steps.first { $0 > current + 0.001 } ?? 2 }
        if direction < 0 { return steps.last { $0 < current - 0.001 } ?? 0.9 }
        return current
    }
}

enum WorkspaceNewConversation {
    static let script = "return !window.dispatchEvent(new Event('talent-signal:new-conversation', { cancelable: true }));"
    static func url(in origin: WorkspaceOrigin, id: UUID = UUID()) -> URL {
        var components = URLComponents(url: origin.entryURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "draft_session", value: id.uuidString.lowercased()),
                                 URLQueryItem(name: "intent", value: "compose")]
        return components.url!
    }
}

/// The one native settings schema. Every case is owned by this Mac or macOS,
/// never by account data that only the browser can read or write.
enum WorkspaceSettingsSection: String, CaseIterable, Identifiable {
    case general, companion, permissions, connection, updates

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: String(localized: "General", bundle: .main)
        case .companion: String(localized: "Companion", bundle: .main)
        case .permissions: String(localized: "Permissions", bundle: .main)
        case .connection: String(localized: "Connection and Diagnostics", bundle: .main)
        case .updates: String(localized: "Software Updates", bundle: .main)
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
        .init(title: String(localized: "This Mac", bundle: .main), sections: [.general, .companion, .permissions, .updates]),
        .init(title: String(localized: "Support", bundle: .main), sections: [.connection]),
    ]

    func moved(by offset: Int) -> WorkspaceSettingsSection {
        let order = Self.groups.flatMap(\.sections)
        guard let index = order.firstIndex(of: self) else { return self }
        return order[min(order.count - 1, max(0, index + offset))]
    }
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
         "supportMailHandoff": true,
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
            ? String(localized: "Account settings opened in the default browser.", bundle: .main)
            : String(localized: "Account settings could not be opened in the default browser.", bundle: .main)
        let restoreStatus = transition.restoreURL == nil
            ? String(localized: "The previous conversation location could not be confirmed. The main window returned to the workspace home; unsaved input may not have been retained.", bundle: .main)
            : String(localized: "Back history was unavailable. The last workspace address was reloaded; unsaved input may not have been retained.", bundle: .main)
        let notice = "\(browserStatus) \(restoreStatus)"
        return .load(safe, notice: notice)
    }
}

@MainActor
final class WorkspaceSettingsNavigation: ObservableObject {
    static let shared = WorkspaceSettingsNavigation()
    @Published var selection: WorkspaceSettingsSection = .general
}

struct WorkspaceSettingsPage<Content: View>: View {
    let title: String?
    let summary: String?
    let content: Content

    init(title: String? = nil, summary: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.summary = summary
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if title != nil || summary != nil {
                    VStack(alignment: .leading, spacing: 8) {
                        if let title {
                            Text(title).font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
                        }
                        if let summary {
                            Text(summary).font(.callout).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                content
            }
            .padding(28)
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(.background)
    }
}

/// Value-driven native controls, shared by Settings and its isolated GUI host.
struct WorkspaceGeneralControls: View {
    @Binding var zoom: Double
    @Binding var floating: Bool

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 16) {
                Picker(String(localized: "Content Size", bundle: .main), selection: $zoom) {
                    ForEach(WorkspaceContentZoom.steps, id: \.self) { value in
                        Text("\(Int((value * 100).rounded()))%").tag(value)
                    }
                }
                .accessibilityIdentifier("settings.general.contentSize")
                Toggle(String(localized: "Keep the workspace window on top", bundle: .main), isOn: $floating)
                    .accessibilityIdentifier("settings.general.floating")
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            Text(String(localized: "Workspace window", bundle: .main)).font(.headline)
        }
    }
}

struct WorkspaceSettingsSearchResults: View {
    let query: String
    let results: [WorkspaceSettingsSearchEntry]
    let activeID: String?
    let message: String?
    let activate: (WorkspaceSettingsSearchEntry) -> Void
    let dismiss: () -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack(alignment: .firstTextBaseline, spacing: 16) {
                        Text(String(localized: "Search settings", bundle: .main))
                            .font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
                        Spacer(minLength: 0)
                        Button(String(localized: "Close", bundle: .main), action: dismiss)
                            .accessibilityIdentifier("settings.search.close")
                            .help(String(localized: "Esc Close", bundle: .main))
                    }
                    if results.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(String(format: String(localized: "No settings match “%@”.", bundle: .main), query.trimmingCharacters(in: .whitespacesAndNewlines)))
                                .font(.body)
                            Text(String(localized: "Try General, Permissions, Connection, Software Updates, Account, or Screenshots and Documents. Relationship records are not included in settings search.", bundle: .main))
                                .font(.callout).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityIdentifier("settings.search.empty")
                    } else {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(results) { entry in
                                row(entry).id(entry.id)
                            }
                        }
                    }
                    if let message {
                        Text(message).font(.callout).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                            .accessibilityIdentifier("settings.search.message")
                    }
                }
                .padding(28)
                .frame(maxWidth: 680, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .top)
            }
            .scrollBounceBehavior(.basedOnSize)
            .onChange(of: activeID) { _, id in if let id { proxy.scrollTo(id, anchor: .center) } }
            .onChange(of: query) { _, _ in if let activeID { proxy.scrollTo(activeID, anchor: .center) } }
        }
        .background(.background)
        .onExitCommand(perform: dismiss)
        .accessibilityIdentifier("settings.search.results")
    }

    private func row(_ entry: WorkspaceSettingsSearchEntry) -> some View {
        let active = entry.id == activeID
        return Button { activate(entry) } label: {
            VStack(alignment: .leading, spacing: 5) {
                Text(entry.title).font(.body.weight(.medium))
                Text(entry.detail).font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(entry.scope) · \(entry.destination)")
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(active ? Color.accentColor.opacity(0.12) : Color.clear,
                        in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.search.result.\(entry.id)")
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

/// The actual section controls share the caller's focus binding; no settings
/// service or preference store is needed to present or exercise this rail.
struct WorkspaceSettingsSections: View {
    let selection: WorkspaceSettingsSection
    let focus: FocusState<WorkspaceSettingsSection?>.Binding
    let select: (WorkspaceSettingsSection) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ForEach(WorkspaceSettingsSection.groups) { group in
                VStack(alignment: .leading, spacing: 3) {
                    Text(group.title).font(.caption).foregroundStyle(.secondary)
                        .padding(.horizontal, 14).padding(.bottom, 3)
                    ForEach(group.sections) { section in
                        row(section)
                    }
                }
            }
        }
    }

    private func row(_ section: WorkspaceSettingsSection) -> some View {
        let selected = selection == section
        return Button { select(section) } label: {
            HStack(spacing: 10) {
                Image(systemName: section.symbol).frame(width: 18).foregroundStyle(.secondary)
                Text(section.title).font(.body.weight(selected ? .medium : .regular))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(selected ? Color.primary.opacity(0.075) : Color.clear,
                        in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focusable()
        .focused(focus, equals: section)
        .accessibilityIdentifier("settings.section.\(section.rawValue)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Search owns the visible pane while preserving the mounted pane's local
/// input. Hidden device controls cannot receive pointer, keyboard or AX input.
struct WorkspaceSettingsContent<Pane: View, Search: View>: View {
    let searching: Bool
    let pane: Pane
    let search: Search

    init(searching: Bool, @ViewBuilder pane: () -> Pane, @ViewBuilder search: () -> Search) {
        self.searching = searching
        self.pane = pane()
        self.search = search()
    }

    var body: some View {
        ZStack(alignment: .top) {
            pane.opacity(searching ? 0 : 1)
                .disabled(searching)
                .allowsHitTesting(!searching)
                .accessibilityHidden(searching)
            if searching { search }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
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
    @StateObject private var connectionProbe = WorkspaceConnectionProbeController()
    @State private var accountLaunchFailed = false
    @State private var screenRecordingAllowed = CGPreflightScreenCaptureAccess()
    @FocusState private var searchFocused: Bool
    @FocusState private var focusedSection: WorkspaceSettingsSection?

    private var pane: WorkspaceSettingsPane {
        WorkspaceSettingsPane.resolve(selection: navigation.selection)
    }

    var body: some View {
        HStack(spacing: 0) {
            rail
            Divider()
            content
        }
        .frame(minWidth: 760,
               idealWidth: navigation.selection == .companion ? 1040 : 900,
               maxWidth: .infinity, minHeight: 520, idealHeight: 680, maxHeight: .infinity)
        .background(SettingsWindowTitle(title: String(localized: "This Mac Settings", bundle: .main)))
        .task { updater.start() }
        .onAppear { connectionProbe.reset(for: connection.origin) }
        .onChange(of: connection.origin) { _, origin in connectionProbe.reset(for: origin) }
        .onDisappear { connectionProbe.reset(for: nil) }
    }

    private var rail: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(String(localized: "This Mac Settings", bundle: .main))
                .font(.title3.weight(.semibold))
                .padding(.horizontal, 18).padding(.top, 20).padding(.bottom, 12)

            searchField
                .padding(.horizontal, 12)
                .padding(.bottom, 16)

            GeometryReader { geometry in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        WorkspaceSettingsSections(selection: navigation.selection, focus: $focusedSection,
                                                  select: selectSection)
                        .padding(.horizontal, 8)
                        Spacer(minLength: 20)
                        Divider().padding(.horizontal, 16)
                        accountRow.padding(.horizontal, 16).padding(.vertical, 14)
                        Divider().padding(.horizontal, 16)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(String(format: String(localized: "This Mac · %@", bundle: .main), updater.appVersion))
                                .font(.caption).foregroundStyle(.secondary)
                            if updater.presentation.offerID != nil {
                                Text(String(localized: "Update available", bundle: .main))
                                    .font(.caption).foregroundStyle(.primary)
                            }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 14)
                        .accessibilityIdentifier("settings.installedVersion")
                    }
                    .frame(minHeight: max(0, geometry.size.height), alignment: .top)
                }
                .scrollBounceBehavior(.basedOnSize)
            }

            Button(String(localized: "Search settings", bundle: .main)) { searchFocused = true }
                .keyboardShortcut("f", modifiers: [.command])
                .frame(width: 0, height: 0)
                .opacity(0)
                .accessibilityHidden(true)
        }
        .frame(width: 228)
        .frame(maxHeight: .infinity)
        .background(.bar)
        .onMoveCommand { direction in
            if search.isSearching {
                switch direction {
                case .down: search.moveDown()
                case .up: search.moveUp()
                default: break
                }
            } else if !searchFocused, direction == .down || direction == .up {
                let next = (focusedSection ?? navigation.selection).moved(by: direction == .down ? 1 : -1)
                navigation.selection = next
                focusedSection = next
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
                    Text(String(localized: "Account and Preferences ↗", bundle: .main))
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("settings.account.browser")
            .accessibilityHint(String(localized: "Opens in the default browser using the account signed in there", bundle: .main))
            Text(connection.origin == nil
                 ? String(localized: "Connect to a workspace before opening account settings in the browser.", bundle: .main)
                 : String(localized: "The browser uses its own signed-in account, which may differ from this app's account.", bundle: .main))
                .font(.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if accountLaunchFailed {
                Text(connection.origin == nil
                     ? String(localized: "No workspace is connected, so account settings cannot be opened yet.", bundle: .main)
                     : String(localized: "The default browser could not be opened. Check your default browser and try again.", bundle: .main))
                    .font(.caption).foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                if connection.origin != nil {
                    Button(String(localized: "Retry", bundle: .main)) { openAccountSettings(.overview) }
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
            TextField(String(localized: "Search settings", bundle: .main), text: Binding(
                get: { search.query },
                set: { search.update($0); searchMessage = nil }
            ))
            .textFieldStyle(.plain)
            .focused($searchFocused)
            .accessibilityLabel(String(localized: "Search settings", bundle: .main))
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
                Text("⌘F").font(.caption).foregroundStyle(.secondary)
            } else {
                Button { search.reset(); searchMessage = nil; searchFocused = true } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 12))
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain).foregroundStyle(.tertiary)
                .accessibilityLabel(String(localized: "Clear search", bundle: .main))
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 8))
    }

    private var content: some View {
        WorkspaceSettingsContent(searching: search.isSearching) {
            paneContent
        } search: {
            searchOverlay
        }
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
        WorkspaceSettingsPage(title: String(localized: "General", bundle: .main),
                              summary: String(localized: "These controls affect only this Mac and remain available offline.", bundle: .main)) {
                WorkspaceGeneralControls(zoom: $zoom, floating: $floating)
                Divider()
                CaptureDeviceSettings()
                Divider()
                DisclosureGroup(String(localized: "Keyboard Shortcuts", bundle: .main)) {
                    VStack(spacing: 12) {
                        LabeledContent(String(localized: "New Chat", bundle: .main), value: "⌘ N")
                        LabeledContent(String(localized: "Zoom In / Zoom Out / Actual Size", bundle: .main), value: "⌘ + / ⌘ − / ⌘ 0")
                        LabeledContent(String(localized: "People / Time", bundle: .main), value: "⌘ 1 / ⌘ 2")
                        LabeledContent(String(localized: "This Mac Settings", bundle: .main), value: "⌘ ,")
                        LabeledContent(String(localized: "Reload", bundle: .main), value: "⌘ R")
                    }.padding(.top, 12)
                }
        }
    }

    /// Real macOS permission status plus an intentional System Settings link.
    /// The app never claims a permission was granted from the link click alone.
    private var permissionsPane: some View {
        WorkspaceSettingsPage(title: String(localized: "Permissions", bundle: .main),
                              summary: String(localized: "Screenshots and documents require Screen Recording permission managed by macOS. The status shown is current; permission can only be granted in System Settings.", bundle: .main)) {
                GroupBox {
                    VStack(alignment: .leading, spacing: 12) {
                        LabeledContent(String(localized: "Screen Recording", bundle: .main)) {
                            Label(screenRecordingAllowed ? String(localized: "Allowed", bundle: .main) : String(localized: "Not Allowed", bundle: .main),
                                  systemImage: screenRecordingAllowed ? "checkmark.circle" : "exclamationmark.circle")
                                .foregroundStyle(screenRecordingAllowed ? Color.secondary : Color.orange)
                        }
                        HStack(spacing: 12) {
                            Button(String(localized: "Open System Settings", bundle: .main)) {
                                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
                                    _ = NSWorkspace.shared.open(url)
                                }
                            }
                            .accessibilityIdentifier("permissions.systemSettings")
                            Button(String(localized: "Check Again", bundle: .main)) { screenRecordingAllowed = CGPreflightScreenCaptureAccess() }
                                .accessibilityIdentifier("permissions.recheck")
                        }
                        Text(String(localized: "Opening System Settings only opens the macOS pane; it does not change permission. Check again after returning.", bundle: .main))
                            .font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }.padding(6)
                } label: {
                    Text(String(localized: "Managed by macOS", bundle: .main)).font(.callout.weight(.medium))
                }
        }
    }

    /// Connection and diagnostics live under an advanced disclosure and never
    /// print secrets. Account reading and saving happen in the browser.
    private var connectionPane: some View {
        WorkspaceSettingsPage {
                WorkspaceConnectionForm(mode: .settings) { openWindow(id: "workspace") }
                Divider()
                Text(String(localized: "Local controls do not require a connection. Open the browser to read or save account settings.", bundle: .main))
                    .font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                DisclosureGroup(String(localized: "Advanced Diagnostics", bundle: .main)) {
                    VStack(alignment: .leading, spacing: 12) {
                        LabeledContent(String(localized: "Current Workspace", bundle: .main), value: connection.origin?.url.host ?? String(localized: "Not Connected", bundle: .main))
                        Button(connectionProbe.isChecking(for: connection.origin) ? String(localized: "Checking…", bundle: .main) : String(localized: "Test Connection", bundle: .main)) {
                            connectionProbe.check(connection.origin)
                        }
                            .disabled(connection.origin == nil || connectionProbe.isChecking(for: connection.origin))
                            .accessibilityIdentifier("connection.probe")
                        if let result = connectionProbe.result(for: connection.origin) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.summary).font(.callout.weight(.medium))
                                Text(result.detail).font(.caption).foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Text(String(localized: "Diagnostics check only this Mac's connection to the workspace. They contain no credentials, tokens or account identifiers.", bundle: .main))
                            .font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }.padding(.top, 12)
                }
        }
    }

    private var updatesPane: some View {
        WorkspaceSettingsPage(title: String(localized: "Software Updates", bundle: .main)) {
            GroupBox {
                VStack(alignment: .leading, spacing: 14) {
                    LabeledContent(String(localized: "Current Version", bundle: .main), value: updater.appVersion)
                    Text(updater.status).font(.callout).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                    if let checked = updater.presentation.lastChecked {
                        LabeledContent(String(localized: "Last Verified Update Source", bundle: .main), value: checked.formatted(date: .abbreviated, time: .shortened))
                    }
                    if let offerID = updater.presentation.offerID {
                        Button(String(localized: "Update and Restart", bundle: .main)) { updater.installUpdate(offerID: offerID) }
                            .buttonStyle(.borderedProminent)
                            .accessibilityIdentifier("updates.install")
                    } else {
                        Button(String(localized: "Check for Updates", bundle: .main)) { updater.checkForUpdates() }
                            .disabled(!updater.isConfigured || !updater.canCheck || updater.presentation.busy)
                            .accessibilityIdentifier("updates.check")
                    }
                    if updater.canRetryRelaunch { Button(String(localized: "Retry Relaunch", bundle: .main)) { updater.retryRelaunch() } }
                }
                .padding(8).frame(maxWidth: .infinity, alignment: .leading)
            } label: {
                Text(String(localized: "Update status", bundle: .main)).font(.headline)
            }
            GroupBox {
                VStack(alignment: .leading, spacing: 14) {
                    Toggle(String(localized: "Automatically check for updates", bundle: .main), isOn: $updater.automaticChecks).disabled(!updater.isConfigured)
                    Toggle(String(localized: "Receive preview releases", bundle: .main), isOn: $updater.includesPreview)
                        .disabled(!updater.isConfigured || updater.sessionInProgress)
                    Text(String(localized: "New versions appear at the lower left. Update and Restart downloads, verifies and reopens the app without another confirmation. Nothing is installed or restarted until you click it.", bundle: .main))
                        .font(.callout).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(8).frame(maxWidth: .infinity, alignment: .leading)
            } label: {
                Text(String(localized: "Automatic updates", bundle: .main)).font(.headline)
            }
            VStack(alignment: .leading, spacing: 8) {
                Link(String(localized: "Release History and Installation Help", bundle: .main), destination: URL(string: "https://github.com/getyak/talent-signal/releases")!)
                if !updater.isConfigured {
                    Text(String(localized: "Signed updates are not configured yet. Published installers are available in the release history.", bundle: .main))
                        .font(.callout).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var searchOverlay: some View {
        WorkspaceSettingsSearchResults(query: search.query, results: search.results,
                                      activeID: search.activeEntry?.id, message: searchMessage,
                                      activate: { activate($0) }) {
            search.reset()
            searchMessage = nil
            searchFocused = true
        }
    }

    /// Routes a search result to its real owner. Native sections stay in place;
    /// browser, workspace and macOS destinations each get an explicit handoff,
    /// and every failure is reported instead of silently doing nothing.
    private func activate(_ entry: WorkspaceSettingsSearchEntry?) {
        guard let entry else { return }
        switch entry.action {
        case .section(let section):
            selectSection(section)
        case .accountBrowser(let destination):
            searchMessage = nil
            accountLaunchFailed = false
            if !AccountSettingsBrowser.shared.open(destination, in: connection.origin) {
                searchMessage = connection.origin == nil
                    ? String(localized: "Connect to a workspace before opening account settings in the browser.", bundle: .main)
                    : String(localized: "The default browser could not be opened. Account settings were not opened.", bundle: .main)
            }
        case .workspacePath:
            guard let url = entry.resolvedURL(in: connection.origin) else {
                searchMessage = String(localized: "Connect to a workspace before opening this workspace page.", bundle: .main)
                return
            }
            WorkspaceNavigation.shared.pendingURL = url
            openWindow(id: "workspace")
            searchMessage = nil
        case .systemSettings(let value):
            guard let url = URL(string: value), NSWorkspace.shared.open(url) else {
                searchMessage = String(localized: "macOS System Settings could not be opened. Open Privacy & Security → Screen Recording manually.", bundle: .main)
                return
            }
            searchMessage = String(localized: "Requested macOS System Settings. Check permission again after returning.", bundle: .main)
        }
    }

    private func selectSection(_ section: WorkspaceSettingsSection) {
        searchFocused = false
        navigation.selection = section
        focusedSection = section
        search.reset()
        searchMessage = nil
    }
}

struct WorkspaceWindowBehavior: NSViewRepresentable {
    let floating: Bool

    final class View: NSView {
        var floating = false
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            configureWindow()
        }

        func configureWindow() {
            window?.level = floating ? .floating : .normal
            // AppKit keeps its ordinary title-bar drag region and traffic lights.
            // The Web sidebar owns branding; retain the window title for menus/AX.
            window?.titleVisibility = .hidden
            window?.titlebarAppearsTransparent = true
            window?.styleMask.insert(.fullSizeContentView)
            window?.titlebarSeparatorStyle = .none
            window?.isOpaque = false
            window?.backgroundColor = .clear
            window?.isMovableByWindowBackground = false
        }
    }

    func makeNSView(context: Context) -> View { View() }
    func updateNSView(_ view: View, context: Context) {
        view.floating = floating
        view.configureWindow()
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
