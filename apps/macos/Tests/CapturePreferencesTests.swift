import XCTest
@testable import TalentSignalMac

/// Focused tests for the independent capture preference module.
///
/// They pin the four approved defaults, prove persistence across a simulated
/// relaunch, and treat two boundaries as first-class requirements:
/// hiding the menu bar is presentation-only (it never stops capture and never
/// quits), and the login-item state is read from the system service instead of
/// being mirrored into a fabricated saved Boolean.
final class CapturePreferencesTests: XCTestCase {
    // MARK: Defaults

    @MainActor
    func testDefaultsMatchTheApprovedPreferences() {
        let preferences = makePreferences()

        XCTAssertTrue(preferences.showMenuBar, "Show in menu bar is on by default")
        XCTAssertEqual(preferences.afterSelection, .direct)
        XCTAssertEqual(preferences.topActivityHint, .off)
        XCTAssertEqual(preferences.shortcut, .defaultShortcut)
        XCTAssertEqual(preferences.shortcut, CaptureShortcutPreference(key: "s", modifiers: [.control, .option]))
        XCTAssertEqual(preferences.shortcut.displayString, "⌃⌥S")
        XCTAssertTrue(preferences.shortcut.isValid)
        XCTAssertNil(preferences.onboardingAcknowledgement)
        XCTAssertFalse(preferences.isStartAtLoginEnabled)
    }

    // MARK: Persistence

    @MainActor
    func testPreferencesPersistAcrossRelaunch() throws {
        let store = TestPreferenceStore()
        let first = CapturePreferences(store: store, loginItem: TestLoginItem())
        first.showMenuBar = false
        first.afterSelection = .preview
        first.topActivityHint = .on
        try first.setShortcut(CaptureShortcutPreference(key: "P", modifiers: [.control, .shift]))

        // A new instance over the same store models a relaunch.
        let second = CapturePreferences(store: store, loginItem: TestLoginItem())
        XCTAssertFalse(second.showMenuBar)
        XCTAssertEqual(second.afterSelection, .preview)
        XCTAssertEqual(second.topActivityHint, .on)
        XCTAssertEqual(second.shortcut, CaptureShortcutPreference(key: "p", modifiers: [.control, .shift]))
        XCTAssertEqual(second.shortcut.displayString, "⌃⇧P")
    }

    @MainActor
    func testMenuBarVisibilityTogglesImmediatelyAndPersists() {
        let store = TestPreferenceStore()
        let preferences = CapturePreferences(store: store, loginItem: TestLoginItem())
        XCTAssertEqual(store.object(forKey: CapturePreferences.StorageKey.showMenuBar) as? Bool, nil)

        preferences.showMenuBar = false
        XCTAssertEqual(store.object(forKey: CapturePreferences.StorageKey.showMenuBar) as? Bool, false)

        preferences.showMenuBar = true
        XCTAssertEqual(store.object(forKey: CapturePreferences.StorageKey.showMenuBar) as? Bool, true)
        XCTAssertTrue(CapturePreferences(store: store, loginItem: TestLoginItem()).showMenuBar)
    }

    @MainActor
    func testCorruptOrStaleStoredValuesFallBackToDefaults() {
        let store = TestPreferenceStore()
        store.set("not-a-bool", forKey: CapturePreferences.StorageKey.showMenuBar)
        store.set("direct-ish", forKey: CapturePreferences.StorageKey.afterSelection)
        store.set("maybe", forKey: CapturePreferences.StorageKey.topActivityHint)
        store.set(Data("not json".utf8), forKey: CapturePreferences.StorageKey.shortcut)
        store.set(Data("not json".utf8), forKey: CapturePreferences.StorageKey.onboarding)

        let preferences = CapturePreferences(store: store, loginItem: TestLoginItem())

        XCTAssertTrue(preferences.showMenuBar)
        XCTAssertEqual(preferences.afterSelection, .direct)
        XCTAssertEqual(preferences.topActivityHint, .off)
        XCTAssertEqual(preferences.shortcut, .defaultShortcut)
        XCTAssertNil(preferences.onboardingAcknowledgement)
    }

    @MainActor
    func testStoredShortcutWithoutAModifierIsIgnoredInFavourOfTheDefault() {
        let store = TestPreferenceStore()
        store.set(try! JSONEncoder().encode(CaptureShortcutPreference(key: "s", modifiers: [])),
                  forKey: CapturePreferences.StorageKey.shortcut)

        XCTAssertEqual(CapturePreferences(store: store, loginItem: TestLoginItem()).shortcut, .defaultShortcut)
    }

    // MARK: Shortcut validation

    func testShortcutValidationRejectsUnusableCombinations() {
        XCTAssertEqual(CaptureShortcutPreference(key: "", modifiers: [.control]).validationError, .emptyKey)
        XCTAssertEqual(CaptureShortcutPreference(key: " ", modifiers: [.control]).validationError, .emptyKey)
        XCTAssertEqual(CaptureShortcutPreference(key: "ff", modifiers: [.control]).validationError, .emptyKey)
        XCTAssertEqual(CaptureShortcutPreference(key: "s", modifiers: []).validationError, .requiresShortcutModifier)
        XCTAssertEqual(CaptureShortcutPreference(key: "s", modifiers: [.shift]).validationError, .requiresShortcutModifier)

        XCTAssertNil(CaptureShortcutPreference(key: "s", modifiers: [.control]).validationError)
        XCTAssertNil(CaptureShortcutPreference(key: "s", modifiers: [.option, .command]).validationError)
        XCTAssertNil(CaptureShortcutPreference(key: "f5", modifiers: [.control, .option]).validationError)
        XCTAssertTrue(CaptureShortcutPreference(key: "S", modifiers: [.control]).key == "s",
                      "Recording a shifted letter still stores the base key")
    }

    func testShortcutDisplayStringUsesMacModifierOrder() {
        XCTAssertEqual(CaptureShortcutPreference(key: "s", modifiers: []).displayString, "S")
        XCTAssertEqual(CaptureShortcutPreference(key: "s", modifiers: [.command, .shift, .option, .control]).displayString, "⌃⌥⇧⌘S")
        XCTAssertEqual(CaptureShortcutPreference(key: "f5", modifiers: [.command]).displayString, "⌘F5")
    }

    @MainActor
    func testSettingAnInvalidShortcutThrowsAndPreservesTheStoredValue() throws {
        let store = TestPreferenceStore()
        let preferences = CapturePreferences(store: store, loginItem: TestLoginItem())

        XCTAssertThrowsError(try preferences.setShortcut(CaptureShortcutPreference(key: "s", modifiers: []))) { error in
            XCTAssertEqual(error as? CaptureShortcutValidationError, .requiresShortcutModifier)
        }
        XCTAssertThrowsError(try preferences.setShortcut(CaptureShortcutPreference(key: "", modifiers: [.control]))) { error in
            XCTAssertEqual(error as? CaptureShortcutValidationError, .emptyKey)
        }

        XCTAssertEqual(preferences.shortcut, .defaultShortcut)
        XCTAssertEqual(CapturePreferences(store: store, loginItem: TestLoginItem()).shortcut, .defaultShortcut)
    }

    // MARK: Hiding the menu is presentation-only

    func testHidingTheMenuBarIsPresentationOnlyAndNeverStopsCaptureOrQuits() {
        // The contract is explicit: the only thing a visibility change affects is
        // the menu bar presentation.
        let effect = CapturePreferenceEffect.menuBarVisibilityChange
        XCTAssertEqual(effect, [.menuBarPresentation])
        XCTAssertTrue(effect.isDisjoint(with: CapturePreferenceEffect.menuBarChangeMustNotAffect))
        for effect: CapturePreferenceEffect in [.captureShortcut, .captureWork, .workspaceSession,
                                                .applicationLifetime, .dockPresence] {
            XCTAssertFalse(CapturePreferenceEffect.menuBarChangeMustNotAffect.isDisjoint(with: effect))
        }
    }

    @MainActor
    func testHidingTheMenuBarLeavesTheShortcutSubmissionAndConsentIntact() throws {
        let store = TestPreferenceStore()
        let preferences = CapturePreferences(store: store, loginItem: TestLoginItem())
        try preferences.setShortcut(CaptureShortcutPreference(key: "p", modifiers: [.control, .option]))
        preferences.afterSelection = .preview
        preferences.topActivityHint = .on
        preferences.acknowledgeProcessingScope(origin: "https://workspace.example",
                                               ownerScope: "owner-a", policyVersion: "policy-1")

        preferences.showMenuBar = false

        // Hiding the menu does not stop capture, does not reset the capture
        // gesture, and does not revoke the processing disclosure.
        XCTAssertEqual(preferences.shortcut, CaptureShortcutPreference(key: "p", modifiers: [.control, .option]))
        XCTAssertEqual(preferences.afterSelection, .preview)
        XCTAssertEqual(preferences.topActivityHint, .on)
        XCTAssertTrue(preferences.hasAcknowledgedProcessingScope(origin: "https://workspace.example",
                                                                 ownerScope: "owner-a", policyVersion: "policy-1"))
        XCTAssertEqual(CapturePreferenceEffect.menuBarVisibilityChange, [.menuBarPresentation])
    }

    // MARK: Onboarding consent is bound to origin, owner and policy

    @MainActor
    func testOnboardingConsentIsBoundToOriginOwnerAndPolicy() {
        let preferences = makePreferences()
        preferences.acknowledgeProcessingScope(origin: "https://workspace.example",
                                               ownerScope: "owner-a", policyVersion: "policy-1")

        XCTAssertTrue(preferences.hasAcknowledgedProcessingScope(origin: "https://workspace.example",
                                                                 ownerScope: "owner-a", policyVersion: "policy-1"))
        XCTAssertFalse(preferences.hasAcknowledgedProcessingScope(origin: "https://other.example",
                                                                  ownerScope: "owner-a", policyVersion: "policy-1"),
                       "A different workspace origin is a different disclosure")
        XCTAssertFalse(preferences.hasAcknowledgedProcessingScope(origin: "https://workspace.example",
                                                                  ownerScope: "owner-b", policyVersion: "policy-1"),
                       "A different account is a different disclosure")
        XCTAssertFalse(preferences.hasAcknowledgedProcessingScope(origin: "https://workspace.example",
                                                                  ownerScope: "owner-a", policyVersion: "policy-2"),
                       "A changed processing policy is a different disclosure")
    }

    @MainActor
    func testIncompleteConsentIsNeverRecorded() {
        let preferences = makePreferences()
        preferences.acknowledgeProcessingScope(origin: "", ownerScope: "owner-a", policyVersion: "policy-1")
        preferences.acknowledgeProcessingScope(origin: "https://workspace.example", ownerScope: "", policyVersion: "policy-1")
        preferences.acknowledgeProcessingScope(origin: "https://workspace.example", ownerScope: "owner-a", policyVersion: "")

        XCTAssertNil(preferences.onboardingAcknowledgement)
    }

    @MainActor
    func testChangingPresentationPreferencesDoesNotInvalidateConsent() {
        let preferences = makePreferences()
        preferences.acknowledgeProcessingScope(origin: "https://workspace.example",
                                               ownerScope: "owner-a", policyVersion: "policy-1")

        preferences.showMenuBar = false
        preferences.afterSelection = .preview
        preferences.topActivityHint = .on
        try? preferences.setShortcut(CaptureShortcutPreference(key: "p", modifiers: [.control]))

        XCTAssertTrue(preferences.hasAcknowledgedProcessingScope(origin: "https://workspace.example",
                                                                 ownerScope: "owner-a", policyVersion: "policy-1"))
    }

    @MainActor
    func testConsentPersistsAcrossRelaunchAndRevocationRemovesIt() {
        let store = TestPreferenceStore()
        let first = CapturePreferences(store: store, loginItem: TestLoginItem())
        let acknowledgedAt = Date(timeIntervalSince1970: 1_700_000_000)
        first.acknowledgeProcessingScope(origin: "https://workspace.example",
                                         ownerScope: "owner-a", policyVersion: "policy-1", at: acknowledgedAt)

        let second = CapturePreferences(store: store, loginItem: TestLoginItem())
        XCTAssertEqual(second.onboardingAcknowledgement?.acknowledgedAt, acknowledgedAt)
        XCTAssertTrue(second.hasAcknowledgedProcessingScope(origin: "https://workspace.example",
                                                            ownerScope: "owner-a", policyVersion: "policy-1"))

        second.revokeProcessingScopeAcknowledgement()
        XCTAssertNil(second.onboardingAcknowledgement)
        XCTAssertNil(CapturePreferences(store: store, loginItem: TestLoginItem()).onboardingAcknowledgement)
        XCTAssertNil(store.object(forKey: CapturePreferences.StorageKey.onboarding))
    }

    // MARK: Login item is owned by the system service

    @MainActor
    func testLoginItemStateIsReadFromTheSystemServiceNotAStoredBoolean() throws {
        let store = TestPreferenceStore()
        let loginItem = TestLoginItem(state: .requiresApproval)
        let preferences = CapturePreferences(store: store, loginItem: loginItem)

        // A pending OS approval is truthfully not enabled, even though the
        // recruiter asked for it and a naive implementation would have saved true.
        XCTAssertEqual(preferences.loginItemState, .requiresApproval)
        XCTAssertFalse(preferences.isStartAtLoginEnabled)

        loginItem.state = .enabled
        XCTAssertEqual(preferences.loginItemState, .enabled)
        XCTAssertTrue(preferences.isStartAtLoginEnabled)

        try preferences.setStartAtLogin(false)
        XCTAssertEqual(preferences.loginItemState, .notRegistered)
        XCTAssertFalse(preferences.isStartAtLoginEnabled)

        // No login-item Boolean is ever written into preferences.
        XCTAssertTrue(store.keys.allSatisfy { !$0.lowercased().contains("login") },
                      "Login-item state must not be mirrored into UserDefaults: \(store.keys)")
        XCTAssertTrue(store.keys.allSatisfy { !$0.lowercased().contains("startatlogin") })
    }

    @MainActor
    func testDeclinedLoginItemRegistrationNeverBecomesAnEnabledPreference() {
        let store = TestPreferenceStore()
        let loginItem = TestLoginItem(state: .notRegistered, registrationError: LoginItemDenied())
        let preferences = CapturePreferences(store: store, loginItem: loginItem)

        XCTAssertThrowsError(try preferences.setStartAtLogin(true))
        XCTAssertFalse(preferences.isStartAtLoginEnabled)
        XCTAssertEqual(loginItem.registerCalls, 1)
        XCTAssertTrue(store.keys.isEmpty, "A declined registration writes no preference: \(store.keys)")
    }

    @MainActor
    func testLoginItemRegistrationStatusDrivesTheOnlySourceOfTruth() throws {
        let loginItem = TestLoginItem(state: .notRegistered)
        let preferences = CapturePreferences(store: TestPreferenceStore(), loginItem: loginItem)

        XCTAssertEqual(try preferences.setStartAtLogin(true), .enabled)
        XCTAssertEqual(loginItem.registerCalls, 1)
        XCTAssertEqual(loginItem.unregisterCalls, 0)

        XCTAssertEqual(try preferences.setStartAtLogin(false), .notRegistered)
        XCTAssertEqual(loginItem.unregisterCalls, 1)
    }

    // MARK: Helpers

    @MainActor
    private func makePreferences() -> CapturePreferences {
        CapturePreferences(store: TestPreferenceStore(), loginItem: TestLoginItem())
    }
}

// MARK: - Test doubles

private final class TestPreferenceStore: CapturePreferenceStore {
    private(set) var values: [String: Any] = [:]

    var keys: Set<String> { Set(values.keys) }

    func object(forKey key: String) -> Any? { values[key] }

    func set(_ value: Any?, forKey key: String) {
        if let value {
            values[key] = value
        } else {
            values.removeValue(forKey: key)
        }
    }

    func removeObject(forKey key: String) {
        values.removeValue(forKey: key)
    }
}

private struct LoginItemDenied: Error {}

private final class TestLoginItem: LoginItemRegistering {
    var state: LoginItemState
    var registrationError: Error?
    private(set) var registerCalls = 0
    private(set) var unregisterCalls = 0

    init(state: LoginItemState = .notRegistered, registrationError: Error? = nil) {
        self.state = state
        self.registrationError = registrationError
    }

    func register() throws {
        registerCalls += 1
        if let registrationError { throw registrationError }
        state = .enabled
    }

    func unregister() throws {
        unregisterCalls += 1
        state = .notRegistered
    }
}
