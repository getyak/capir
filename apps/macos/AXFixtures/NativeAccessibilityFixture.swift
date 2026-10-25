import AppKit
import SwiftUI

/// CI-only presentation executable. The production App entry/delegate is not
/// part of this target, and no account, capture, updater or browser is started.
@main
struct NativeAccessibilityFixtureApp: App {
    @StateObject private var fixture = NativeAccessibilityFixtureModel()

    var body: some Scene {
        WindowGroup("Native accessibility fixture") {
            VStack(spacing: 12) {
                HStack {
                    Text("Synthetic presentation fixture")
                    Spacer()
                    Text(fixture.phaseName).accessibilityIdentifier("fixture.phase")
                    Button("Next phase") { fixture.nextPhase() }
                        .accessibilityIdentifier("fixture.next")
                }
                HStack(alignment: .top) {
                    DesktopBrowserLoginSurface(phase: fixture.phase, matchingHint: "AbC-42",
                                               canCheckResult: fixture.phaseIndex == 6,
                                               onStart: {}, onCancel: {}, onCheckResult: {})
                        .frame(minWidth: 560, maxWidth: .infinity, minHeight: 520)
                    VStack {
                        NativePetFixtureHost(fixture: fixture).frame(width: 100, height: 100)
                        Text(String(fixture.opens)).accessibilityIdentifier("fixture.opens")
                        Button("Invoke child default AX action") { fixture.pressActualChild() }
                            .accessibilityIdentifier("fixture.press")
                        Text(fixture.pressResult).accessibilityIdentifier("fixture.pressResult")
                        Text(fixture.invariantsPreserved ? "preserved" : "changed")
                            .accessibilityIdentifier("fixture.invariants")
                    }.frame(width: 140)
                }
                HStack {
                    Text(fixture.cleaned ? "cleaned" : "active")
                        .accessibilityIdentifier("fixture.preferences")
                    Spacer()
                    Button("Clear fixture preferences") { fixture.cleanup() }
                        .accessibilityIdentifier("fixture.cleanup")
                }
            }.padding(16).frame(minWidth: 760, minHeight: 620)
        }.defaultSize(width: 900, height: 700)
    }
}

@MainActor
private final class NativeAccessibilityFixtureModel: ObservableObject {
    static let rawError = "原始返回错误：do not translate %@"
    let suite: String
    let defaults: UserDefaults
    let pet: DesktopPetController
    let preferencesBefore: NSDictionary?
    let destinationBefore: WorkspaceDestination?
    let urlBefore: URL?
    weak var petHost: NSHostingView<DesktopPetArtworkView>?
    @Published var pressResult = "not-run"
    @Published var opens = 0
    @Published var phaseIndex = 0
    @Published var cleaned = false

    init() {
        let name = "com.getyak.acceptance.native-ax.\(UUID().uuidString)"
        suite = name
        let isolated = UserDefaults(suiteName: name)!
        isolated.set(false, forKey: "desktopPet.motion")
        defaults = isolated
        pet = DesktopPetController(defaults: isolated)
        preferencesBefore = isolated.persistentDomain(forName: name) as NSDictionary?
        destinationBefore = WorkspaceNavigation.shared.pending
        urlBefore = WorkspaceNavigation.shared.pendingURL
        pet.openWorkspaceWindow = { [weak self] in self?.opens += 1 }
    }

    var phaseName: String {
        ["idle", "preparing", "waiting", "exchanging", "completed", "cancelled",
         "unresolved-check", "unresolved-restart", "failed"][phaseIndex]
    }
    var phase: DesktopBrowserLoginPhase {
        switch phaseIndex {
        case 0: .idle
        case 1: .preparing
        case 2: .waiting
        case 3: .exchanging
        case 4: .completed(accountID: "fixture-account", userID: "fixture-user")
        case 5: .cancelled
        case 6, 7: .unresolved
        default: .failed(Self.rawError)
        }
    }
    var invariantsPreserved: Bool {
        WorkspaceNavigation.shared.pending == destinationBefore &&
        WorkspaceNavigation.shared.pendingURL == urlBefore &&
        (defaults.persistentDomain(forName: suite) as NSDictionary?) == preferencesBefore
    }
    /// XCTest has already requested the real virtual button. Invoke that
    /// node's public server-side AX handler without granting the UI runner
    /// cross-application CoreAX authority. No controller or parent-press fallback.
    func pressActualChild() {
        guard let host = petHost else { pressResult = "missing-host"; return }
        func attribute(_ node: NSObject, _ modern: String, _ legacyName: String) -> Any? {
            let getter = NSSelectorFromString(modern)
            if node.responds(to: getter), let value = node.perform(getter)?.takeUnretainedValue() {
                if let array = value as? [Any], array.isEmpty { }
                else if let string = value as? String, string.isEmpty { }
                else { return value }
            }
            let legacy = NSSelectorFromString("accessibilityAttributeValue:")
            return node.responds(to: legacy) ? node.perform(legacy, with: legacyName)?.takeUnretainedValue() : nil
        }
        func find(_ node: NSObject, depth: Int = 0) -> NSObject? {
            guard depth < 16 else { return nil }
            if attribute(node, "accessibilityIdentifier", "AXIdentifier") as? String == "desktopPet.openWorkspace" { return node }
            let children = attribute(node, "accessibilityChildren", "AXChildren") as? [Any] ?? []
            for child in children.compactMap({ $0 as? NSObject }) {
                if let value = find(child, depth: depth + 1) { return value }
            }
            return nil
        }
        var actual = find(host)
        if actual == nil, let window = host.window {
            let point = window.convertPoint(toScreen: host.convert(NSPoint(x: host.bounds.midX, y: host.bounds.midY), to: nil))
            actual = host.accessibilityHitTest(point) as? NSObject
        }
        guard let node = actual, node !== host,
              attribute(node, "accessibilityIdentifier", "AXIdentifier") as? String == "desktopPet.openWorkspace",
              attribute(node, "accessibilityRole", "AXRole") as? String == "AXButton" else {
            pressResult = "missing-actual-virtual-child"; return
        }
        let actions = NSSelectorFromString("accessibilityActionNames")
        let legacyPress = NSSelectorFromString("accessibilityPerformAction:")
        let names = node.responds(to: actions) ? node.perform(actions)?.takeUnretainedValue() as? [String] : nil
        if names?.contains("AXPress") == true && node.responds(to: legacyPress) {
            typealias Press = @convention(c) (AnyObject, Selector, NSString) -> Void
            unsafeBitCast(node.method(for: legacyPress), to: Press.self)(node, legacyPress, "AXPress")
            pressResult = "performed"
        } else {
            let selector = NSSelectorFromString("accessibilityPerformPress")
            guard node.responds(to: selector) else { pressResult = "missing-default-action"; return }
            typealias Press = @convention(c) (AnyObject, Selector) -> Bool
            let triggered = unsafeBitCast(node.method(for: selector), to: Press.self)(node, selector)
            pressResult = triggered ? "performed" : "default-action-rejected"
        }
    }
    func nextPhase() { phaseIndex = min(phaseIndex + 1, 8) }
    func cleanup() {
        defaults.removePersistentDomain(forName: suite)
        cleaned = defaults.persistentDomain(forName: suite) == nil
    }
}

/// Plain hosting view: it has no product interaction view's AppKit press override.
private struct NativePetFixtureHost: NSViewRepresentable {
    let fixture: NativeAccessibilityFixtureModel
    func makeNSView(context: Context) -> NSHostingView<DesktopPetArtworkView> {
        let host = NSHostingView(rootView: DesktopPetArtworkView(controller: fixture.pet))
        fixture.petHost = host
        return host
    }
    func updateNSView(_ host: NSHostingView<DesktopPetArtworkView>, context: Context) {
        host.rootView = DesktopPetArtworkView(controller: fixture.pet)
    }
}
