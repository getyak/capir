import Foundation
import SwiftUI
import Darwin

@MainActor
final class LabDisplayStore: ObservableObject {
    struct Session: Equatable {
        let id: UUID
        let configuration: LabDisplayConfiguration
        let expiresAt: Date
        let deadline: TimeInterval
    }
    private struct PresetFile: Codable { let version: Int; let presets: [LabDisplayPreset] }
    @Published private(set) var active: Session?
    @Published private(set) var presets: [LabDisplayPreset] = []
    @Published private(set) var notice: String?
    @Published private(set) var error: String?
    static let presetsKey = "talent-signal.lab.display-presets.v1"
    static let themeKey = "talent-signal.display.appearance"
    private let defaults: UserDefaults
    private let enabled: Bool
    private let uptime: () -> TimeInterval
    private let now: () -> Date
    private var expiryTask: Task<Void, Never>?
    private var presetsReadable = true
    var canApply: Bool { enabled }
    var canSavePreset: Bool { enabled && presetsReadable && presets.count < 10 }

    init(defaults: UserDefaults = .standard, enabled: Bool = DeviceLabAvailability.enabled,
         uptime: @escaping () -> TimeInterval = { Double(clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)) / 1_000_000_000 }, now: @escaping () -> Date = Date.init) {
        self.defaults = defaults; self.enabled = enabled; self.uptime = uptime; self.now = now
        loadPresets()
    }
    deinit { expiryTask?.cancel() }
    func apply(_ configuration: LabDisplayConfiguration, minutes: Int) {
        guard enabled, [5, 15, 30, 60].contains(minutes) else { return }
        expiryTask?.cancel()
        let session = Session(id: UUID(), configuration: configuration, expiresAt: now().addingTimeInterval(Double(minutes * 60)), deadline: uptime() + Double(minutes * 60))
        active = session; notice = "Temporary display settings applied"; error = nil
        expiryTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(minutes * 60)) } catch { return }
            guard let self, self.active?.id == session.id else { return }
            self.stop(message: "Display trial expired. Saved preferences restored.")
        }
    }
    func expireIfNeeded() {
        if let active, uptime() >= active.deadline { stop(message: "Display trial expired. Saved preferences restored.") }
    }
    func stop(message: String = "Saved display preferences restored") {
        expiryTask?.cancel(); expiryTask = nil; active = nil; notice = message
    }
    func contextChanged() { if active != nil { stop(message: "Display trial ended when the account or environment changed.") } }
    func restoreDefaults() -> Bool {
        guard enabled else { return false }
        stop()
        let keys = [Self.themeKey, AppLanguage.storageKey, WorkspaceTextSizePreference.storageKey, WorkspaceCardDensityPreference.storageKey]
        for key in keys { defaults.removeObject(forKey: key) }
        let verified = keys.allSatisfy { defaults.object(forKey: $0) == nil }
        error = verified ? nil : "Display defaults could not be fully restored. Review current settings and retry."
        if verified { notice = "Display defaults restored. Saved Lab presets were preserved." }
        return verified
    }
    func loadPresets() {
        do {
            if let saved = defaults.object(forKey: Self.presetsKey) {
                guard let data = saved as? Data, data.count < 32_000 else { throw TalentSignalLabClientError.invalidResponse }
                let file = try JSONDecoder().decode(PresetFile.self, from: data)
                guard file.version == 1, file.presets.count <= 10, Set(file.presets.map(\.id)).count == file.presets.count,
                      file.presets.allSatisfy({ !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.name.count <= 60 }) else { throw TalentSignalLabClientError.invalidResponse }
                presets = file.presets
            } else { presets = [] }
            presetsReadable = true; error = nil
        } catch { presetsReadable = false; self.error = "Display presets could not be read. Existing saved data was preserved." }
    }
    func savePreset(name: String, configuration: LabDisplayConfiguration) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard enabled, presetsReadable, !name.isEmpty, name.count <= 60, presets.count < 10 else { return }
        persist(presets + [.init(id: UUID(), name: name, configuration: configuration)])
    }
    func deletePreset(_ id: UUID) { guard enabled, presetsReadable else { return }; persist(presets.filter { $0.id != id }) }
    private func persist(_ values: [LabDisplayPreset]) {
        do {
            let data = try JSONEncoder().encode(PresetFile(version: 1, presets: values)); defaults.set(data, forKey: Self.presetsKey)
            guard defaults.data(forKey: Self.presetsKey) == data else { throw TalentSignalLabClientError.invalidResponse }
            presets = values; notice = "Display presets saved on this device"; error = nil
        } catch { presetsReadable = false; self.error = "Display presets could not be saved. Refresh before trying again." }
    }
    func savePersonalPreferences(_ configuration: LabDisplayConfiguration) {
        guard enabled else { return }
        var preferences = [Self.themeKey: configuration.theme.rawValue]
        if let language = configuration.language.value { preferences[AppLanguage.storageKey] = language.rawValue }
        if let density = configuration.density.value { preferences[WorkspaceCardDensityPreference.storageKey] = density.rawValue }
        for (key, value) in preferences { defaults.set(value, forKey: key) }
        guard preferences.allSatisfy({ defaults.string(forKey: $0.key) == $0.value }) else {
            notice = nil; error = "Some display preferences could not be saved. Check your current settings before retrying."
            return
        }
        error = nil
        notice = "Theme, language and card density saved. Simulated accessibility settings stay temporary."
    }
}

private struct LabDisplayStoreKey: EnvironmentKey { static let defaultValue: LabDisplayStore? = nil }
private struct LabDisplayConfigurationKey: EnvironmentKey { static let defaultValue = LabDisplayConfiguration.standard }
extension EnvironmentValues {
    var labDisplayStore: LabDisplayStore? {
        get { self[LabDisplayStoreKey.self] }
        set { self[LabDisplayStoreKey.self] = newValue }
    }
    var labDisplayConfiguration: LabDisplayConfiguration {
        get { self[LabDisplayConfigurationKey.self] }
        set { self[LabDisplayConfigurationKey.self] = newValue }
    }
    var talentSignalReduceMotion: Bool { accessibilityReduceMotion || labReduceMotion || labDisplayConfiguration.reduceMotion }
    var talentSignalReduceTransparency: Bool { accessibilityReduceTransparency || labDisplayConfiguration.reduceTransparency }
}

struct LabDisplayModifier: ViewModifier {
    @Environment(\.dynamicTypeSize) private var inheritedType
    @Environment(\.appLanguage) private var inheritedLanguage
    @Environment(\.workspaceCardDensity) private var inheritedDensity
    let configuration: LabDisplayConfiguration
    var appliesTheme = true
    @ViewBuilder func body(content: Content) -> some View {
        if appliesTheme { configured(content).preferredColorScheme(configuration.theme.colorScheme) }
        else { configured(content) }
    }
    private func configured(_ content: Content) -> some View {
        content
            .environment(\.labDisplayConfiguration, configuration)
            .environment(\.dynamicTypeSize, configuration.textSize.resolved(inheritedType))
            .environment(\.workspaceCardDensity, configuration.density.value ?? inheritedDensity)
            .environment(\.appLanguage, configuration.language.value ?? inheritedLanguage)
            .environment(\.locale, (configuration.language.value ?? inheritedLanguage).locale)
            // An explicit rendering simulation, not a change to the system's contrast setting.
            .contrast(configuration.contrastBoost ? 1.18 : 1)
            .transaction { if configuration.reduceMotion { $0.disablesAnimations = true; $0.animation = nil } }
    }
}

struct LabLayoutOutline: ViewModifier {
    @Environment(\.labDisplayConfiguration) private var display
    func body(content: Content) -> some View {
        content.overlay {
            if display.layoutBounds { Rectangle().strokeBorder(Color.tsVermilion, style: StrokeStyle(lineWidth: 1, dash: [4, 3])).allowsHitTesting(false).accessibilityHidden(true) }
        }
    }
}

struct LabDisplaySessionRoot<Content: View>: View {
    @ObservedObject var store: LabDisplayStore
    @Environment(\.appLanguage) private var language
    @Environment(\.scenePhase) private var scenePhase
    @ViewBuilder let content: () -> Content
    private var displayLanguage: AppLanguage { store.active?.configuration.language.value ?? language }
    var body: some View {
        // Reserve physical layout space outside each page's NavigationStack.
        // A root safeAreaInset can overlap a page's own navigation inset.
        VStack(spacing: 0) {
            if let active = store.active {
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(displayLanguage.text("DISPLAY TRIAL")).font(.caption.weight(.semibold))
                            .accessibilityIdentifier("lab-display-active")
                        Text(active.expiresAt, style: .time).font(.caption)
                    }
                    Spacer(minLength: 0)
                    Button { store.stop() } label: {
                        Text(displayLanguage.text("Restore display"))
                            .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).foregroundStyle(Color.tsVermilion)
                    .accessibilityIdentifier("lab-display-stop")
                }
                .padding(.horizontal, 16).background(Color.tsSurface)
            }
            content()
                .overlay(alignment: .bottomLeading) {
#if DEBUG
                    if ProcessInfo.processInfo.environment["TS_IOS_UI_TEST_DISPLAY_PROBE"] == "true" { LabEffectiveDisplayProbe() }
#endif
                }
                .modifier(LabDisplayModifier(configuration: store.active?.configuration ?? .standard, appliesTheme: false))
                .environment(\.labDisplayStore, store)
        }
        .onChange(of: scenePhase) { if $0 == .active { store.expireIfNeeded() } }
    }
}

#if DEBUG
struct LabEffectiveDisplayProbe: View {
    var identifier = "lab-effective-display"
    @Environment(\.appLanguage) private var language
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.workspaceCardDensity) private var density
    @Environment(\.talentSignalReduceMotion) private var reduceMotion
    private var value: String { "\(language.rawValue)|\(colorScheme == .dark ? "dark" : "light")|\(textSize)|\(density.rawValue)" }
    var body: some View {
        Color.clear.frame(width: 1, height: 1).accessibilityElement()
            .accessibilityLabel(Text(verbatim: reduceMotion ? "effective-reduce-motion:on" : "effective-reduce-motion:off"))
            .accessibilityValue(value)
            .accessibilityIdentifier(identifier)
    }
}
#endif
