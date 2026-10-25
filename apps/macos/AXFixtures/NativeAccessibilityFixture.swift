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
                        DesktopPetArtworkView(controller: fixture.pet)
                        Text(String(fixture.opens)).accessibilityIdentifier("fixture.opens")
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
    func nextPhase() { phaseIndex = min(phaseIndex + 1, 8) }
    func cleanup() {
        defaults.removePersistentDomain(forName: suite)
        cleaned = defaults.persistentDomain(forName: suite) == nil
    }
}
