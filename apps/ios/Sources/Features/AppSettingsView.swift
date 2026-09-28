import AppIntents
import SwiftUI

enum TalentSignalSetupPreference {
    static let actionButtonCompleteKey =
        "talent-signal.setup.action-button-complete"
    static let screenshotShortcutReceivedAtKey =
        "talent-signal.setup.screenshot-shortcut-received-at"
    static let shortcutEditorURL = URL(string: "shortcuts://create-shortcut")!

    static func recordScreenshotShortcutReceived(
        at date: Date = Date(),
        defaults: UserDefaults = .standard
    ) {
        defaults.set(
            date.timeIntervalSince1970,
            forKey: screenshotShortcutReceivedAtKey
        )
    }
}

enum WorkspaceTextSizePreference: String, CaseIterable, Identifiable {
    case compact
    case system
    case comfortable

    static let storageKey = "talent-signal.display.text-size"
    var id: String { rawValue }

    static func stored(_ value: String) -> Self {
        Self(rawValue: value) ?? .system
    }

    func adjusted(_ systemSize: DynamicTypeSize) -> DynamicTypeSize {
        guard !systemSize.isAccessibilitySize else { return systemSize }
        let sizes: [DynamicTypeSize] = [
            .xSmall, .small, .medium, .large, .xLarge, .xxLarge, .xxxLarge,
        ]
        guard let current = sizes.firstIndex(of: systemSize) else {
            return systemSize
        }
        let offset: Int
        switch self {
        case .compact: offset = -1
        case .system: offset = 0
        case .comfortable: offset = 1
        }
        return sizes[min(max(current + offset, 0), sizes.count - 1)]
    }

    func displayName(in language: AppLanguage) -> String {
        switch self {
        case .compact: return language.text("Small")
        case .system: return language.text("System")
        case .comfortable: return language.text("Large")
        }
    }
}

enum WorkspaceCardDensityPreference: String, CaseIterable, Identifiable {
    case compact
    case standard
    case comfortable

    static let storageKey = "talent-signal.display.card-density"
    var id: String { rawValue }

    static func stored(_ value: String) -> Self {
        Self(rawValue: value) ?? .compact
    }

    func displayName(in language: AppLanguage) -> String {
        switch self {
        case .compact: return language.text("Compact")
        case .standard: return language.text("Standard")
        case .comfortable: return language.text("Comfortable")
        }
    }

    var rowVerticalInset: CGFloat {
        switch self {
        case .compact: return 3
        case .standard: return 5
        case .comfortable: return 7
        }
    }

    var cardPadding: CGFloat {
        switch self {
        case .compact: return 10
        case .standard: return 12
        case .comfortable: return 15
        }
    }

    var cardCornerRadius: CGFloat {
        switch self {
        case .compact: return 14
        case .standard: return 16
        case .comfortable: return 18
        }
    }

    var personAvatarSize: CGFloat {
        switch self {
        case .compact: return 34
        case .standard: return 38
        case .comfortable: return 44
        }
    }

    var sessionAvatarSize: CGFloat {
        switch self {
        case .compact: return 26
        case .standard: return 30
        case .comfortable: return 34
        }
    }
}

private struct WorkspaceCardDensityPreferenceKey: EnvironmentKey {
    static let defaultValue = WorkspaceCardDensityPreference.compact
}

extension EnvironmentValues {
    var workspaceCardDensity: WorkspaceCardDensityPreference {
        get { self[WorkspaceCardDensityPreferenceKey.self] }
        set { self[WorkspaceCardDensityPreferenceKey.self] = newValue }
    }
}

struct WorkspaceDisplayPreferencesRoot<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var systemDynamicTypeSize

    private let textSize: WorkspaceTextSizePreference
    private let cardDensity: WorkspaceCardDensityPreference
    private let content: Content

    init(
        textSize: WorkspaceTextSizePreference,
        cardDensity: WorkspaceCardDensityPreference,
        @ViewBuilder content: () -> Content
    ) {
        self.textSize = textSize
        self.cardDensity = cardDensity
        self.content = content()
    }

    var body: some View {
        content
            .environment(
                \.dynamicTypeSize,
                textSize.adjusted(systemDynamicTypeSize)
            )
            .environment(\.workspaceCardDensity, cardDensity)
    }
}

struct AppSettingsView: View {
    @AppStorage(AppLanguage.storageKey) private var storedLanguage =
        AppLanguage.system.rawValue
    @Environment(\.appLanguage) private var interfaceLanguage

    private var selectedLanguage: AppLanguage {
        AppLanguage.stored(storedLanguage)
    }

    var body: some View {
        List {
            Section {
                ForEach(AppLanguage.allCases) { language in
                    AppLanguageOptionRow(
                        language: language,
                        interfaceLanguage: interfaceLanguage,
                        isSelected: language == selectedLanguage
                    ) {
                        storedLanguage = language.rawValue
                    }
                }
            } header: {
                Text(interfaceLanguage.text("Interface language"))
            } footer: {
                Text(
                    interfaceLanguage.text(
                        "Changes apply immediately and remain on this device."
                    )
                )
            }

            Section {
                SettingsExplanationRow(
                    systemImage: "text.bubble",
                    title: interfaceLanguage.text("Interface language only"),
                    detail: interfaceLanguage.text(
                        "Candidate names, quoted evidence, and source-authored content stay in their original language."
                    )
                )
            } header: {
                Text(interfaceLanguage.text("Evidence boundary"))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.tsSurface)
        .navigationTitle(interfaceLanguage.text("Language"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("app-settings")
    }
}

enum InstalledAppVersion {
    static func label(in bundle: Bundle = .main) -> String? {
        guard let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
              !version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        return build.flatMap { $0.isEmpty ? nil : "\(version) (\($0))" } ?? version
    }
}

struct AppVersionStatusView: View {
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        List {
            Section {
                LabeledContent(appLanguage.text("Installed iOS app")) {
                    Text(InstalledAppVersion.label() ?? appLanguage.text("Unavailable"))
                        .accessibilityIdentifier("ios-installed-version")
                }
                LabeledContent(appLanguage.text("Update status")) {
                    Text(appLanguage.text("Not verified"))
                        .foregroundStyle(.secondary)
                }
            } footer: {
                Text(appLanguage.text(
                    "This is the build installed on this device. Check TestFlight or the App Store for a newer release; this screen does not infer updates from another device."
                ))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.tsSurface)
        .navigationTitle(appLanguage.text("Version & status"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("ios-version-status")
    }
}

struct DisplaySettingsView: View {
    @AppStorage(LabDisplayStore.themeKey) private var theme = LabDisplayConfiguration.Theme.system.rawValue
    @AppStorage(WorkspaceTextSizePreference.storageKey)
    private var storedTextSize = WorkspaceTextSizePreference.system.rawValue
    @AppStorage(WorkspaceCardDensityPreference.storageKey)
    private var storedCardDensity = WorkspaceCardDensityPreference.compact.rawValue
    @Environment(\.appLanguage) private var appLanguage

    private var textSize: WorkspaceTextSizePreference {
        WorkspaceTextSizePreference.stored(storedTextSize)
    }

    private var cardDensity: WorkspaceCardDensityPreference {
        WorkspaceCardDensityPreference.stored(storedCardDensity)
    }

    var body: some View {
        List {
            Section(appLanguage.text("Appearance")) {
                Picker(appLanguage.text("Appearance"), selection: $theme) {
                    ForEach(LabDisplayConfiguration.Theme.allCases, id: \.self) { Text(appLanguage.text($0.title)).tag($0.rawValue) }
                }.accessibilityIdentifier("display-saved-theme")
            }
            Section {
                DisplayPreferencePreview()
                    .environment(\.workspaceCardDensity, cardDensity)
                    .id(cardDensity)
            } header: {
                Text(appLanguage.text("Preview"))
            }

            Section {
                ForEach(WorkspaceTextSizePreference.allCases) { preference in
                    DisplayPreferenceRow(
                        title: preference.displayName(in: appLanguage),
                        isSelected: preference == textSize,
                        identifier: "text-size-\(preference.rawValue)"
                    ) {
                        storedTextSize = preference.rawValue
                    }
                }
            } header: {
                Text(appLanguage.text("Text size"))
            } footer: {
                Text(
                    appLanguage.text(
                        "Relative to your iPhone text size. Accessibility sizes are never reduced."
                    )
                )
            }

            Section {
                ForEach(WorkspaceCardDensityPreference.allCases) { preference in
                    DisplayPreferenceRow(
                        title: preference.displayName(in: appLanguage),
                        isSelected: preference == cardDensity,
                        identifier: "card-density-\(preference.rawValue)"
                    ) {
                        storedCardDensity = preference.rawValue
                    }
                }
            } header: {
                Text(appLanguage.text("Card density"))
            } footer: {
                Text(
                    appLanguage.text(
                        "Changes card spacing and avatar size without shrinking controls below their accessible target."
                    )
                )
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.tsSurface)
        .navigationTitle(appLanguage.text("Display & text"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("display-settings")
    }
}

private struct DisplayPreferenceRow: View {
    @Environment(\.appLanguage) private var appLanguage

    let title: String
    let isSelected: Bool
    let identifier: String
    let select: () -> Void

    var body: some View {
        Button(action: select) {
            HStack(spacing: 12) {
                Text(title)
                    .font(.body)
                    .foregroundStyle(Color.tsInk)
                Spacer(minLength: 12)
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? Color.tsInk : Color.tsLine)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(
            appLanguage.text(isSelected ? "Selected" : "Not selected")
        )
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(identifier)
    }
}

private struct DisplayPreferencePreview: View {
    @Environment(\.workspaceCardDensity) private var density
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        HStack(spacing: 10) {
            AccountInitialsAvatar(
                label: appLanguage.text("Preview person"),
                size: density.personAvatarSize
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(appLanguage.text("Preview person"))
                    .font(.headline)
                    .foregroundStyle(Color.tsInk)
                Text(appLanguage.text("Role · Pursuit"))
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
            }
            Spacer(minLength: 8)
            Text(appLanguage.text("Now"))
                .font(.caption2)
                .foregroundStyle(Color.tsMutedInk)
        }
        .padding(density.cardPadding)
        .background(
            Color.tsCanvas,
            in: RoundedRectangle(
                cornerRadius: density.cardCornerRadius,
                style: .continuous
            )
        )
        .overlay {
            RoundedRectangle(
                cornerRadius: density.cardCornerRadius,
                style: .continuous
            )
            .stroke(Color.tsLine, lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(density.displayName(in: appLanguage))
        .accessibilityIdentifier("display-settings-preview")
    }
}

struct ActionButtonSetupView: View {
    @AppStorage(TalentSignalSetupPreference.actionButtonCompleteKey)
    private var isSetupComplete = false
    @AppStorage(TalentSignalSetupPreference.screenshotShortcutReceivedAtKey)
    private var screenshotShortcutReceivedAt = 0.0
    @Environment(\.appLanguage) private var appLanguage

    private var hasReceivedScreenshotShortcut: Bool {
        screenshotShortcutReceivedAt > 0
    }

    var body: some View {
        List {
            Section {
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: "button.programmable")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                        .frame(width: 44, height: 44)
                        .background(Color.tsCanvas, in: Circle())
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 5) {
                        Text(appLanguage.text("Make the Next Capture Instant"))
                            .font(.headline)
                            .foregroundStyle(Color.tsInk)
                        Text(
                            appLanguage.text(
                                "Build it once. Then press and hold without leaving the conversation."
                            )
                        )
                        .font(.subheadline)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.vertical, 6)
            }

            Section {
                ScreenshotShortcutRecipeRow(
                    number: 1,
                    systemImage: "camera.viewfinder",
                    title: appLanguage.text("Take Screenshot"),
                    owner: appLanguage.text("System action")
                )
                ScreenshotShortcutRecipeRow(
                    number: 2,
                    systemImage: "text.viewfinder",
                    title: appLanguage.text("Review screenshot"),
                    owner: appLanguage.text("Talent Signal action")
                )

                SettingsExplanationRow(
                    systemImage: "lock.shield",
                    title: appLanguage.text("Local before you decide"),
                    detail: appLanguage.text(
                        "Capture only a conversation you are authorized to use. The screenshot stays local until you review it. Reviewed text is sent only after you tap Save and check identity."
                    )
                )
                .accessibilityIdentifier("shortcut-local-boundary")

                Link(destination: TalentSignalSetupPreference.shortcutEditorURL) {
                    Label(
                        appLanguage.text("Open Shortcut editor"),
                        systemImage: "plus"
                    )
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(TSPrimaryButtonStyle())
                .accessibilityIdentifier("build-screenshot-shortcut")
                .accessibilityLabel(
                    appLanguage.text("Open Shortcut editor")
                )
            } header: {
                Text(appLanguage.text("Build the two-action Shortcut"))
            } footer: {
                Text(
                    appLanguage.text(
                        "Opens an empty Shortcut editor. Add the two actions above in order, then give it a short name."
                    )
                )
            }

            Section {
                SettingsStepRow(
                    number: 1,
                    text: appLanguage.text(
                        "Open Settings and choose Action Button."
                    )
                )
                SettingsStepRow(
                    number: 2,
                    text: appLanguage.text(
                        "Swipe to Shortcut, then choose the personal Shortcut you just named."
                    )
                )

                Button {
                    isSetupComplete.toggle()
                } label: {
                    Label(
                        appLanguage.text(
                            isSetupComplete
                                ? "Show setup reminder again"
                                : "I've assigned the Shortcut"
                        ),
                        systemImage: isSetupComplete
                            ? "checkmark.circle.fill"
                            : "circle"
                    )
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.tsInk)
                .accessibilityIdentifier("confirm-action-button-setup")
            } header: {
                Text(appLanguage.text("Assign the Shortcut"))
            } footer: {
                Text(
                    appLanguage.text(
                        "Only you can assign it in Settings. Talent Signal cannot read or change the Action Button binding."
                    )
                )
            }

            Section {
                ScreenshotShortcutVerificationRow(
                    isVerified: hasReceivedScreenshotShortcut,
                    isAssignmentConfirmed: isSetupComplete,
                    appLanguage: appLanguage
                )
            } header: {
                Text(appLanguage.text("First capture"))
            } footer: {
                Text(
                    appLanguage.text(
                        "A screenshot received through this Shortcut confirms only the local handoff. It does not prove the current Action Button assignment."
                    )
                )
            }

            Section {
                SettingsExplanationRow(
                    systemImage: "waveform.badge.plus",
                    title: appLanguage.text("Capture Signal"),
                    detail: appLanguage.text(
                        "Choose text, photo, or foreground voice in the app."
                    )
                )
                SettingsExplanationRow(
                    systemImage: "mic",
                    title: appLanguage.text("Record Signal"),
                    detail: appLanguage.text(
                        "Open foreground recording; the microphone does not start automatically."
                    )
                )
                SettingsExplanationRow(
                    systemImage: "text.viewfinder",
                    title: appLanguage.text("Review screenshot"),
                    detail: appLanguage.text(
                        "Save one image on this iPhone for later text and identity review."
                    )
                )

                ShortcutsLink()
                    .shortcutsLinkStyle(.automaticOutline)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .accessibilityIdentifier("open-app-shortcuts")
            } header: {
                Text(appLanguage.text("Other shortcuts"))
            } footer: {
                Text(
                    appLanguage.text(
                        "Shortcuts opens your existing shortcuts and Talent Signal app actions."
                    )
                )
            }

            Section {
                SettingsExplanationRow(
                    systemImage: "lock.shield",
                    title: appLanguage.text("Safety boundary"),
                    detail: appLanguage.text(
                        "The button saves locally. Reviewed text is sent only after you tap Save and check identity; no candidate fact or external action is confirmed automatically."
                    )
                )
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.tsSurface)
        .navigationTitle(appLanguage.text("Action Button & Shortcuts"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("action-button-settings")
    }
}

private struct ScreenshotShortcutRecipeRow: View {
    let number: Int
    let systemImage: String
    let title: String
    let owner: String

    var body: some View {
        HStack(spacing: 14) {
            Text(verbatim: "\(number)")
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.tsSurface)
                .frame(width: 28, height: 28)
                .background(Color.tsInk, in: Circle())
                .accessibilityHidden(true)
            Image(systemName: systemImage)
                .font(.body.weight(.medium))
                .foregroundStyle(Color.tsInk)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                Text(owner)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 52)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(number). \(title)"))
        .accessibilityValue(owner)
        .accessibilityIdentifier("screenshot-shortcut-step-\(number)")
    }
}

private struct ScreenshotShortcutVerificationRow: View {
    let isVerified: Bool
    let isAssignmentConfirmed: Bool
    let appLanguage: AppLanguage

    private var title: String {
        if isVerified {
            return appLanguage.text("Screenshot received via Shortcuts")
        }
        if isAssignmentConfirmed {
            return appLanguage.text("Ready for the first capture")
        }
        return appLanguage.text("Not set up")
    }

    private var detail: String {
        if isVerified {
            return appLanguage.text(
                "Talent Signal received a screenshot through Shortcuts. It stays in the local review queue until you review or delete it."
            )
        }
        if isAssignmentConfirmed {
            return appLanguage.text(
                "Your assignment is noted. Talent Signal will verify its own capture path when the first screenshot arrives."
            )
        }
        return appLanguage.text(
            "No screenshot is captured or uploaded during setup."
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: isVerified ? "checkmark.circle.fill" : "circle.dashed")
                .font(.title3.weight(.semibold))
                .foregroundStyle(isVerified ? Color.tsConfirmed : Color.tsMutedInk)
                .frame(width: 32, height: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityValue(detail)
        .accessibilityIdentifier("screenshot-shortcut-verification")
    }
}

struct AccountSettingsView: View {
    let isCanonical: Bool
    let workspaceID: String?
    let workspaceLabel: String?
    let accountName: String?
    let accountEmail: String?
    let signOutNotice: String?
    let onSignOut: (() async -> Bool)?

    @Environment(\.appLanguage) private var appLanguage
    @State private var isSigningOut = false
    @State private var signOutFailed = false

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    AccountInitialsAvatar(label: displayName, size: 48)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(displayName)
                            .font(.headline)
                            .foregroundStyle(Color.tsInk)
                        Text(
                            appLanguage.text(
                                isCanonical
                                    ? "Canonical workspace"
                                    : "Synthetic preview"
                            )
                        )
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                    }
                }
                .padding(.vertical, 6)
            }

            Section {
                AccountValueRow(
                    label: appLanguage.text("Name"),
                    value: displayName
                )
                if let accountEmail {
                    AccountValueRow(
                        label: appLanguage.text("Email"),
                        value: accountEmail
                    )
                }
                AccountValueRow(
                    label: appLanguage.text("Workspace scope"),
                    value: workspaceLabel
                        ?? workspaceID
                        ?? appLanguage.text("Synthetic preview")
                )
            } header: {
                Text(appLanguage.text("Account details"))
            } footer: {
                Text(
                    appLanguage.text(
                        "Account identity is read-only on this device."
                    )
                )
            }

            AccountSignInMethodsView()

            Section {
                SettingsExplanationRow(
                    systemImage: "lock.shield",
                    title: appLanguage.text("Privacy & approvals"),
                    detail: boundaryCopy
                )
                if let signOutNotice {
                    Label(signOutNotice, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .accessibilityIdentifier("sign-out-local-deletion-notice")
                }
            }

            if let onSignOut {
                Section {
                    if signOutFailed {
                        Text(appLanguage.text("Sign-out did not complete. Review the account state and try again."))
                            .font(.caption).foregroundStyle(Color.tsVermilion)
                    }
                    Button(role: .destructive) {
                        guard !isSigningOut else { return }
                        isSigningOut = true
                        Task {
                            signOutFailed = !(await onSignOut())
                            isSigningOut = false
                        }
                    } label: {
                        HStack {
                            Label(
                                appLanguage.text("Sign out"),
                                systemImage: "rectangle.portrait.and.arrow.right"
                            )
                            Spacer()
                            if isSigningOut { ProgressView() }
                        }
                    }
                    .disabled(isSigningOut)
                    .accessibilityIdentifier("sign-out")
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.tsSurface)
        .navigationTitle(appLanguage.text("Account"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("account-settings")
    }

    private var displayName: String {
        accountName ?? "Talent Signal"
    }

    private var boundaryCopy: String {
        if isCanonical {
            return appLanguage.text(
                "Relationship changes stay in account scope. Every external effect requires separate approval and verified readback."
            )
        }
        return appLanguage.text(
            "No candidate data is stored in this synthetic preview. Nothing shown here has execution authority."
        )
    }
}

struct ApprovalSettingsView: View {
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        List {
            Section {
                SettingsExplanationRow(
                    systemImage: "quote.bubble",
                    title: appLanguage.text("Evidence review"),
                    detail: appLanguage.text(
                        "Confirm or correct evidence before it becomes current relationship state."
                    )
                )
                SettingsExplanationRow(
                    systemImage: "hand.raised",
                    title: appLanguage.text("External actions"),
                    detail: appLanguage.text(
                        "Messages, meetings, contacts, notifications, ATS, and CRM writes require a separate exact-effect approval."
                    )
                )
                SettingsExplanationRow(
                    systemImage: "checkmark.seal",
                    title: appLanguage.text("Verified results"),
                    detail: appLanguage.text(
                        "A success state appears only after canonical readback confirms the result."
                    )
                )
            } header: {
                Text(appLanguage.text("Fixed product boundary"))
            } footer: {
                Text(
                    appLanguage.text(
                        "These safeguards cannot be disabled in settings."
                    )
                )
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.tsSurface)
        .navigationTitle(appLanguage.text("Approval & data"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("approval-settings")
    }
}

struct CalendarSyncSettingsView: View {
    @AppStorage(CalendarSyncPreference.isEnabledKey)
    private var isCalendarSyncEnabled = true
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        List {
            Section {
                Toggle(
                    appLanguage.text("Sync new confirmed events"),
                    isOn: $isCalendarSyncEnabled
                )
                .accessibilityIdentifier("calendar-sync-toggle")

                AccountValueRow(
                    label: appLanguage.text("Destination"),
                    value: appLanguage.text("Apple Calendar · default calendar")
                )
            } header: {
                Text(appLanguage.text("Calendar sync"))
            } footer: {
                Text(
                    appLanguage.text("New events sync outbound after confirmation. Talent Signal never imports or browses Apple Calendar; after you review an edit to a linked event, it reads only that saved identifier to update and verify that event.")
                )
            }

            Section {
                SettingsExplanationRow(
                    systemImage: "arrow.up.forward.app",
                    title: appLanguage.text("Outbound only"),
                    detail: appLanguage.text("Turning sync off keeps new events in Talent Signal. A reviewed edit to an already linked event still updates that event only.")
                )
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.tsSurface)
        .navigationTitle(appLanguage.text("Calendar sync"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("calendar-sync-settings")
    }
}

struct AccountInitialsAvatar: View {
    let label: String
    let size: CGFloat

    private var initials: String {
        let initials = label.split(separator: " ")
            .prefix(2)
            .compactMap(\.first)
            .map(String.init)
            .joined()
            .uppercased()
        return initials.isEmpty ? "TS" : initials
    }

    var body: some View {
        Text(initials)
            .font(.custom("Georgia", size: size * 0.33, relativeTo: .body))
            .foregroundStyle(Color.tsInk)
            .frame(width: size, height: size)
            .background(Color.tsCanvas, in: Circle())
            .overlay { Circle().stroke(Color.tsLine, lineWidth: 1) }
            .accessibilityHidden(true)
    }
}

private struct AppLanguageOptionRow: View {
    let language: AppLanguage
    let interfaceLanguage: AppLanguage
    let isSelected: Bool
    let select: () -> Void

    var body: some View {
        Button(action: select) {
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(language.displayName(in: interfaceLanguage))
                        .font(.body.weight(.medium))
                        .foregroundStyle(Color.tsInk)
                    Text(language.description(in: interfaceLanguage))
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 12)

                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.body)
                    .foregroundStyle(isSelected ? Color.tsInk : Color.tsLine)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 54)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(language.displayName(in: interfaceLanguage))
        .accessibilityValue(
            isSelected
                ? interfaceLanguage.text("Selected")
                : interfaceLanguage.text("Not selected")
        )
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("language-option-\(language.rawValue)")
    }
}

private struct SettingsStepRow: View {
    let number: Int
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.tsInk)
                .frame(width: 26, height: 26)
                .background(Color.tsCanvas, in: Circle())
                .accessibilityHidden(true)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Color.tsInk)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 26)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct SettingsExplanationRow: View {
    let systemImage: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: systemImage)
                .font(.body.weight(.medium))
                .foregroundStyle(Color.tsMutedInk)
                .frame(width: 28, height: 28)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

private struct AccountValueRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
            Spacer(minLength: 20)
            Text(value)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.tsInk)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

#Preview("Language") {
    NavigationStack {
        AppSettingsView()
    }
    .environment(\.appLanguage, .english)
}

#Preview("Action Button") {
    NavigationStack {
        ActionButtonSetupView()
    }
    .environment(\.appLanguage, .english)
}

#Preview("Calendar sync") {
    NavigationStack {
        CalendarSyncSettingsView()
    }
    .environment(\.appLanguage, .english)
}
