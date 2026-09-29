import Combine
import Foundation
import ServiceManagement

// MARK: - Persisted preference values

/// What happens when a released region selection becomes work.
///
/// The default is `direct`: release is the submission gesture and the normal
/// path has no second Send. `preview` keeps the bytes local until the recruiter
/// explicitly submits them.
enum CaptureAfterSelection: String, CaseIterable, Codable, Sendable {
    case direct
    case preview

    static let `default`: CaptureAfterSelection = .direct
}

/// The optional always-on-top activity capsule. Off by default; it is a
/// presentation choice over the same capture work, never a second task surface.
enum CaptureTopActivityHint: String, CaseIterable, Codable, Sendable {
    case off
    case on

    static let `default`: CaptureTopActivityHint = .off
}

/// Modifier flags for the configurable global capture shortcut.
struct CaptureShortcutModifiers: OptionSet, Hashable, Sendable, Codable {
    let rawValue: Int

    static let control = CaptureShortcutModifiers(rawValue: 1 << 0)
    static let option = CaptureShortcutModifiers(rawValue: 1 << 1)
    static let shift = CaptureShortcutModifiers(rawValue: 1 << 2)
    static let command = CaptureShortcutModifiers(rawValue: 1 << 3)

    /// Modifiers that can justify a global shortcut on their own.
    ///
    /// Shift is deliberately excluded: a shift-only chord would shadow ordinary
    /// typing in every application.
    static let shortcutCapable: CaptureShortcutModifiers = [.control, .option, .command]

    init(rawValue: Int) { self.rawValue = rawValue }

    init(from decoder: Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(Int.self)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

enum CaptureShortcutValidationError: Error, Equatable {
    /// The recorded key is empty, multi-character other than `f1`…`f20`, or not a
    /// key this preference can represent.
    case emptyKey
    /// A global shortcut needs at least one of Control, Option or Command.
    case requiresShortcutModifier
}

/// The persisted, user-recorded global capture shortcut.
///
/// This is the immutable preference value only. Registering it with the system
/// hot-key facility and reporting conflicts belongs to the capture shortcut
/// registrar, not to preferences.
struct CaptureShortcutPreference: Equatable, Hashable, Codable, Sendable {
    /// A single character (`"s"`) or a function key (`"f5"`), stored lowercase so
    /// equality and storage stay stable regardless of how the recorder reported it.
    let key: String
    let modifiers: CaptureShortcutModifiers

    /// Control-Option-S, the approved default.
    static let defaultShortcut = CaptureShortcutPreference(key: "s", modifiers: [.control, .option])

    init(key: String, modifiers: CaptureShortcutModifiers) {
        self.key = key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        self.modifiers = modifiers
    }

    var validationError: CaptureShortcutValidationError? {
        guard Self.isRepresentableKey(key) else { return .emptyKey }
        guard !modifiers.intersection(CaptureShortcutModifiers.shortcutCapable).isEmpty else {
            return .requiresShortcutModifier
        }
        return nil
    }

    var isValid: Bool { validationError == nil }

    /// A stable, order-independent rendering such as `⌃⌥S` for the approved default.
    var displayString: String {
        var rendered = ""
        if modifiers.contains(.control) { rendered += "⌃" }
        if modifiers.contains(.option) { rendered += "⌥" }
        if modifiers.contains(.shift) { rendered += "⇧" }
        if modifiers.contains(.command) { rendered += "⌘" }
        return rendered + key.uppercased()
    }

    private static let letterKeys = "abcdefghijklmnopqrstuvwxyz"
    private static let digitKeys = "0123456789"
    private static let punctuationKeys = "`-=[]\\;',./"
    private static let functionKeyNumbers = 1...20

    private static func isRepresentableKey(_ key: String) -> Bool {
        if key.count == 1 {
            return letterKeys.contains(key) || digitKeys.contains(key) || punctuationKeys.contains(key)
        }
        guard key.first == "f", let number = Int(key.dropFirst()) else { return false }
        return functionKeyNumbers.contains(number)
    }
}

/// Proof that a specific origin, owner and processing policy were disclosed and
/// acknowledged. The acknowledgement is stored as that exact triple, so a
/// changed workspace, account or processor policy is a new disclosure instead of
/// a silently inherited one.
struct CaptureOnboardingAcknowledgement: Equatable, Codable, Sendable {
    let origin: String
    let ownerScope: String
    let policyVersion: String
    let acknowledgedAt: Date

    var isComplete: Bool {
        !origin.isEmpty && !ownerScope.isEmpty && !policyVersion.isEmpty
    }
}

// MARK: - Effect contract

/// The complete set of surfaces a capture preference change is allowed to affect.
///
/// This exists so the menu-bar visibility choice cannot quietly grow into a
/// capture-stop or a quit. Hiding the menu is presentation only: staging,
/// admission, recovery, the authenticated session and the running application
/// are separate operations with their own explicit controls.
struct CapturePreferenceEffect: OptionSet, Equatable, Sendable {
    let rawValue: Int

    /// Inserting or removing the menu bar item and its settings presentation.
    static let menuBarPresentation = CapturePreferenceEffect(rawValue: 1 << 0)
    /// Which gesture submits a released selection (`direct` versus `preview`).
    static let submissionGesture = CapturePreferenceEffect(rawValue: 1 << 1)
    /// The optional top activity capsule.
    static let activityPresentation = CapturePreferenceEffect(rawValue: 1 << 2)
    /// The configurable global capture shortcut.
    static let captureShortcut = CapturePreferenceEffect(rawValue: 1 << 3)
    /// Staged screenshots, recovery items and in-flight admission.
    static let captureWork = CapturePreferenceEffect(rawValue: 1 << 4)
    /// The authenticated workspace session and login item.
    static let workspaceSession = CapturePreferenceEffect(rawValue: 1 << 5)
    /// Whether the application keeps running.
    static let applicationLifetime = CapturePreferenceEffect(rawValue: 1 << 6)
    /// Dock presence.
    static let dockPresence = CapturePreferenceEffect(rawValue: 1 << 7)

    /// The exact effect of changing menu-bar visibility.
    ///
    /// Always presentation only. Stopping capture intake, cancelling staged or
    /// admitted work, ending the session and quitting are separate, explicit
    /// operations; none of them is a consequence of this preference.
    static let menuBarVisibilityChange: CapturePreferenceEffect = [.menuBarPresentation]

    /// Everything a menu-bar visibility change must leave untouched.
    static let menuBarChangeMustNotAffect: CapturePreferenceEffect = [
        .captureShortcut, .captureWork, .workspaceSession, .applicationLifetime, .dockPresence,
    ]
}

// MARK: - Login item

/// The observed login-item state. The sole source of truth is the system
/// service, so a decline, a pending approval or an OS removal is never
/// misreported as an enabled preference.
enum LoginItemState: Equatable, Sendable {
    case notRegistered
    case enabled
    case requiresApproval
    case unavailable

    var isEnabled: Bool { self == .enabled }
}

/// The narrow surface preferences need from the login-item facility.
///
/// Conforming types own `SMAppService`; preferences never persist a parallel
/// Boolean, because the user's actual decision lives in System Settings.
protocol LoginItemRegistering: AnyObject {
    var state: LoginItemState { get }
    func register() throws
    func unregister() throws
}

/// The real login item, backed by `SMAppService.mainApp`.
final class SystemLoginItem: LoginItemRegistering {
    private let service: SMAppService

    init(service: SMAppService = .mainApp) {
        self.service = service
    }

    var state: LoginItemState {
        switch service.status {
        case .notRegistered: return .notRegistered
        case .enabled: return .enabled
        case .requiresApproval: return .requiresApproval
        case .notFound: return .unavailable
        @unknown default: return .unavailable
        }
    }

    func register() throws {
        try service.register()
    }

    func unregister() throws {
        try service.unregister()
    }
}

// MARK: - Storage

/// The storage surface preferences need, satisfied directly by `UserDefaults`.
///
/// Injecting it keeps reload/relaunch behaviour testable without touching the
/// recruiter's real defaults.
protocol CapturePreferenceStore: AnyObject {
    func object(forKey key: String) -> Any?
    func set(_ value: Any?, forKey key: String)
    func removeObject(forKey key: String)
}

extension UserDefaults: CapturePreferenceStore {}

// MARK: - Preferences

/// The independent, locally persisted capture preferences.
///
/// One instance owns the four approved defaults, the origin/owner/policy-bound
/// onboarding acknowledgement and the login-item bridge. It deliberately owns no
/// capture state: hiding the menu never stops capture and never quits.
@MainActor
final class CapturePreferences: ObservableObject {
    /// The versioned `UserDefaults` keys this module alone writes.
    enum StorageKey {
        static let showMenuBar = "capture.preferences.v1.showMenuBar"
        static let shortcut = "capture.preferences.v1.shortcut"
        static let afterSelection = "capture.preferences.v1.afterSelection"
        static let topActivityHint = "capture.preferences.v1.topActivityHint"
        static let onboarding = "capture.preferences.v1.onboardingAcknowledgement"

        static let all = [showMenuBar, shortcut, afterSelection, topActivityHint, onboarding]
    }

    /// Show Talent Signal in the menu bar. Defaults to `true` and is applied
    /// immediately by the owner of the menu scene.
    @Published var showMenuBar: Bool {
        didSet { store.set(showMenuBar, forKey: StorageKey.showMenuBar) }
    }

    /// What a released selection does. Defaults to direct submission.
    @Published var afterSelection: CaptureAfterSelection {
        didSet { store.set(afterSelection.rawValue, forKey: StorageKey.afterSelection) }
    }

    /// The optional top activity capsule. Off by default.
    @Published var topActivityHint: CaptureTopActivityHint {
        didSet { store.set(topActivityHint.rawValue, forKey: StorageKey.topActivityHint) }
    }

    /// The validated global capture shortcut. Use `setShortcut(_:)` so an
    /// unusable chord is never persisted.
    @Published private(set) var shortcut: CaptureShortcutPreference

    /// The disclosure acknowledged for the current origin, owner and policy.
    @Published private(set) var onboardingAcknowledgement: CaptureOnboardingAcknowledgement?

    private let store: any CapturePreferenceStore
    private let loginItem: any LoginItemRegistering

    init(store: any CapturePreferenceStore = UserDefaults.standard,
         loginItem: any LoginItemRegistering = SystemLoginItem()) {
        self.store = store
        self.loginItem = loginItem
        // Property observers do not fire during initialization, so loading here
        // does not rewrite the stored values.
        self.showMenuBar = (store.object(forKey: StorageKey.showMenuBar) as? Bool) ?? true
        self.shortcut = Self.loadShortcut(from: store)
        self.afterSelection = (store.object(forKey: StorageKey.afterSelection) as? String)
            .flatMap(CaptureAfterSelection.init(rawValue:)) ?? .default
        self.topActivityHint = (store.object(forKey: StorageKey.topActivityHint) as? String)
            .flatMap(CaptureTopActivityHint.init(rawValue:)) ?? .default
        self.onboardingAcknowledgement = Self.loadOnboarding(from: store)
    }

    // MARK: Shortcut

    /// Applies a recorded shortcut after validation. An unusable chord leaves the
    /// previously stored value untouched and reports why.
    func setShortcut(_ candidate: CaptureShortcutPreference) throws {
        if let error = candidate.validationError { throw error }
        shortcut = candidate
        guard let encoded = try? JSONEncoder().encode(candidate) else { return }
        store.set(encoded, forKey: StorageKey.shortcut)
    }

    /// Returns the shortcut to Control-Option-S.
    func resetShortcut() {
        try? setShortcut(.defaultShortcut)
    }

    // MARK: Onboarding consent

    /// Records that the recruiter saw the current origin, owner scope and
    /// processing-policy version. Incomplete input is ignored rather than stored
    /// as a partial consent.
    func acknowledgeProcessingScope(origin: String,
                                    ownerScope: String,
                                    policyVersion: String,
                                    at date: Date = Date()) {
        let acknowledgement = CaptureOnboardingAcknowledgement(origin: origin,
                                                               ownerScope: ownerScope,
                                                               policyVersion: policyVersion,
                                                               acknowledgedAt: date)
        guard acknowledgement.isComplete else { return }
        onboardingAcknowledgement = acknowledgement
        guard let encoded = try? JSONEncoder().encode(acknowledgement) else { return }
        store.set(encoded, forKey: StorageKey.onboarding)
    }

    /// True only for the exact origin, owner and processing policy that were
    /// acknowledged. Anything else needs a fresh disclosure.
    func hasAcknowledgedProcessingScope(origin: String, ownerScope: String, policyVersion: String) -> Bool {
        guard let acknowledgement = onboardingAcknowledgement else { return false }
        return acknowledgement.origin == origin
            && acknowledgement.ownerScope == ownerScope
            && acknowledgement.policyVersion == policyVersion
    }

    /// Sign-out, workspace change or account deletion clears the disclosure. It
    /// is never inherited by the next account.
    func revokeProcessingScopeAcknowledgement() {
        onboardingAcknowledgement = nil
        store.removeObject(forKey: StorageKey.onboarding)
    }

    // MARK: Login item

    /// The live system state, read through on every access.
    var loginItemState: LoginItemState { loginItem.state }

    /// True only when the OS confirms the login item is enabled.
    var isStartAtLoginEnabled: Bool { loginItemState.isEnabled }

    /// Registers or removes the login item through the system service, then
    /// returns the resulting system state. A user decline or a pending approval
    /// surfaces as a non-enabled state instead of a saved `true`.
    @discardableResult
    func setStartAtLogin(_ enabled: Bool) throws -> LoginItemState {
        if enabled {
            try loginItem.register()
        } else {
            try loginItem.unregister()
        }
        objectWillChange.send()
        return loginItemState
    }

    /// Re-reads the system state, for example after the recruiter changed it in
    /// System Settings.
    func refreshLoginItemState() {
        objectWillChange.send()
    }

    // MARK: Loading

    private static func loadShortcut(from store: any CapturePreferenceStore) -> CaptureShortcutPreference {
        guard let data = store.object(forKey: StorageKey.shortcut) as? Data,
              let decoded = try? JSONDecoder().decode(CaptureShortcutPreference.self, from: data),
              decoded.isValid else {
            return .defaultShortcut
        }
        return decoded
    }

    private static func loadOnboarding(from store: any CapturePreferenceStore) -> CaptureOnboardingAcknowledgement? {
        guard let data = store.object(forKey: StorageKey.onboarding) as? Data,
              let decoded = try? JSONDecoder().decode(CaptureOnboardingAcknowledgement.self, from: data),
              decoded.isComplete else {
            return nil
        }
        return decoded
    }
}
