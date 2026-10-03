import AppKit
import SwiftUI

@main
struct TalentSignalMacApp: App {
    @NSApplicationDelegateAdaptor(TalentSignalMacAppDelegate.self) private var appDelegate
    @StateObject private var updater = DesktopUpdater.shared
    @StateObject private var model = AppModel.bootstrap()
    @StateObject private var capturePreferences = CaptureRuntime.shared.preferences

    private var isQuickPanelPreview: Bool {
        ProcessInfo.processInfo.arguments.contains("--quick-panel-preview")
    }

    private var menuBarInsertion: Binding<Bool> {
        Binding(
            get: { capturePreferences.showMenuBar },
            set: { isInserted in
                // AppKit reports the current insertion state during scene
                // reconciliation. Publishing that same value would schedule
                // another scene update and keep the app's main thread busy.
                guard capturePreferences.showMenuBar != isInserted else { return }
                capturePreferences.showMenuBar = isInserted
            }
        )
    }

    var body: some Scene {
        Window("capri", id: "workspace") {
            ApplicationZoomContainer(enabled: model.isAccessibilityZoomPreview) {
                Group {
                    if isQuickPanelPreview {
                        QuickPanelView()
                            .frame(width: 560, height: 640)
                    } else if ProcessInfo.processInfo.arguments.contains("--native-tools-preview") ||
                                ProcessInfo.processInfo.arguments.contains("--ui-testing") {
                        RelationshipWorkspaceView()
                    } else {
                        QuietWorkspaceView()
                    }
                }
                    .environmentObject(model)
                    .environment(\.dynamicTypeSize, model.isAccessibilityZoomPreview ? .accessibility2 : .large)
                    .preferredColorScheme(model.isDarkAppearancePreview ? .dark : nil)
                    .task {
                        CaptureRuntime.shared.start()
                        updater.start()
                        _ = await model.ensureInitialized()
                    }
                    .background(SelectedTextServiceBridge().environmentObject(model))
                    .background(DesktopPetWorkspaceLink())
                    .background(DesktopBrowserLoginWorkspaceLink())
            }
            .frame(
                minWidth: isQuickPanelPreview ? 520 : 760,
                minHeight: isQuickPanelPreview ? 580 : 540
            )
        }
        .defaultSize(
            width: isQuickPanelPreview ? 560 : 1_280,
            height: isQuickPanelPreview ? 640 : 820
        )
        .windowResizability(isQuickPanelPreview ? .contentSize : .automatic)
        .windowToolbarStyle(.unifiedCompact)
        .commands {
            WorkspaceDesktopCommands()
            DesktopPetCommands()
            CommandGroup(after: .appInfo) {
                if let offerID = updater.presentation.offerID {
                    Button("更新并重启") { updater.installUpdate(offerID: offerID) }
                } else {
                    Button("检查更新") { updater.checkForUpdates() }
                        .disabled(!updater.isConfigured || !updater.canCheck || updater.presentation.busy)
                }
            }
            TalentSignalCommands(model: model)
        }

        Settings { WorkspaceDesktopSettings() }

        Window("本机工具", id: "native-tools") {
            NativeInitializationBoundary { RelationshipWorkspaceView() }
                .environmentObject(model)
                .frame(minWidth: 900, minHeight: 640)
        }
        .defaultSize(width: 1180, height: 820)

        Window("Quick Panel", id: "quick-panel") {
            ApplicationZoomContainer(enabled: model.isAccessibilityZoomPreview) {
                NativeInitializationBoundary { QuickPanelView() }
                    .environmentObject(model)
                    .environment(\.dynamicTypeSize, model.isAccessibilityZoomPreview ? .accessibility2 : .large)
                    .preferredColorScheme(model.isDarkAppearancePreview ? .dark : nil)
            }
            .frame(minWidth: 520, idealWidth: 560, minHeight: 580, idealHeight: 640)
        }
        .defaultSize(width: 560, height: 640)
        .windowResizability(.contentSize)

        MenuBarExtra(isInserted: menuBarInsertion) {
            CaptureMenuView()
        } label: {
            TSBrandMark(size: 22, monochrome: true)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("capri")
        }
        .menuBarExtraStyle(.window)
    }
}

/// Retain only the fixed scene action so a browser approval can restore a
/// closed workspace window. The login coordinator validates the callback
/// before invoking this action; this view adds no URL or credential authority.
private struct DesktopBrowserLoginWorkspaceLink: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Color.clear.frame(width: 0, height: 0)
            .onAppear {
                DesktopBrowserLoginCoordinator.shared.setWorkspacePresenter {
                    openWindow(id: "workspace")
                    NSApp.activate(ignoringOtherApps: true)
                }
            }
    }
}

private struct ApplicationZoomContainer<Content: View>: View {
    let enabled: Bool
    @ViewBuilder let content: Content

    var body: some View {
        GeometryReader { proxy in
            let scale = enabled ? 2.0 : 1.0
            content
                .frame(
                    width: proxy.size.width / scale,
                    height: proxy.size.height / scale,
                    alignment: .topLeading
                )
                .scaleEffect(scale, anchor: .topLeading)
        }
    }
}

private struct TalentSignalCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    @ObservedObject var model: AppModel

    var body: some Commands {
        CommandMenu("capri") {
            Button("Open Quick Panel") {
                openWindow(id: "quick-panel")
            }
            .keyboardShortcut(.space, modifiers: [.command, .shift])

            Button("Open Today") {
                model.selectedNavigation = .today
                openWindow(id: "native-tools")
            }
            .keyboardShortcut("1", modifiers: [.command, .shift])

            Button("Open Relationship Workspace") {
                model.selectedNavigation = .workspace
                openWindow(id: "native-tools")
            }
            .keyboardShortcut("2", modifiers: [.command, .shift])

            Button("Open first relationship follow-up") {
                model.openFirstTodayAttentionFromKeyboard()
                openWindow(id: "native-tools")
            }
            .keyboardShortcut(.downArrow, modifiers: [.command, .option])
            .disabled(model.selectedNavigation != .today || model.todayAttention.items.isEmpty)

            Button("Prepare current conversation next step") {
                model.prepareCurrentConversationNextStep()
                if model.errorMessage == nil {
                    openWindow(id: "quick-panel")
                }
            }
            .keyboardShortcut("n", modifiers: [.command, .option])
            .disabled(model.selectedNavigation != .today || !model.canPrepareCurrentConversationNextStep)

            Button("Review current proposed changes") {
                Task { await model.reviewFocusedTodayProposal() }
            }
            .keyboardShortcut("r", modifiers: [.command, .option])
            .disabled(
                model.focusedTodayAttentionItem?.kind != .proposalReview ||
                    model.focusedTodayAttentionItem?.proposalID == nil
            )

            Button("Set Up Selection Service…") {
                SelectionServiceSetup.openKeyboardShortcutSettings()
            }

            Divider()

            Button("Select first available relationship scope") {
                model.selectFirstRelationshipScopeFromKeyboard()
            }
            .keyboardShortcut("1", modifiers: [.command, .option])
            .disabled(model.scopeReviewStatus != .proposed || model.relationshipScopeOptions.isEmpty || model.selectedScopeOptionID != nil)

            Button("Confirm selected relationship scope") {
                Task { await model.confirmRelationshipScope() }
            }
            .keyboardShortcut("c", modifiers: [.command, .option])
            .disabled(model.scopeReviewStatus != .proposed || model.selectedScopeOptionID == nil)

            Button("Keep identity unresolved") {
                model.keepRelationshipScopeUnresolved()
            }
            .keyboardShortcut("u", modifiers: [.command, .option])
            .disabled(model.scopeReviewStatus != .proposed)

            Divider()

            Button("Attribute first unresolved source to candidate") {
                model.attributeFirstUnresolvedItemToCandidate()
            }
            .keyboardShortcut("a", modifiers: [.command, .shift])
            .disabled(model.capsule.items.first(where: { !$0.hasConfirmedAttribution }) == nil)

            Button("Confirm first pending source attribution") {
                model.confirmFirstPendingAttribution()
            }
            .keyboardShortcut("a", modifiers: [.command, .option, .shift])
            .disabled(model.capsule.items.first(where: {
                $0.actorKind != nil && !$0.hasConfirmedAttribution
            }) == nil)

            Divider()

            Button("Confirm next unreviewed proposal item") {
                model.decideNextCanonicalItem(.accept)
            }
            .keyboardShortcut("1", modifiers: [.command, .option, .shift])
            .disabled(model.pendingDecision?.items.first(where: { model.decisionSelections[$0.id] == nil }) == nil)

            Button("Reject next unreviewed proposal item") {
                model.decideNextCanonicalItem(.reject)
            }
            .keyboardShortcut("2", modifiers: [.command, .option, .shift])
            .disabled(model.pendingDecision?.items.first(where: { model.decisionSelections[$0.id] == nil }) == nil)

            Button("Keep next proposal item unresolved") {
                model.decideNextCanonicalItem(.keepUnresolved)
            }
            .keyboardShortcut("3", modifiers: [.command, .option, .shift])
            .disabled(model.pendingDecision?.items.first(where: { model.decisionSelections[$0.id] == nil }) == nil)

            Button("Save reviewed changes") {
                Task { await model.resolveCanonicalDecision() }
            }
            .keyboardShortcut(.return, modifiers: [.command, .option])
            .disabled(!model.canResolveCanonicalDecision)

            Divider()

            Button(model.isPaused ? "Resume context intake" : "Pause context intake") {
                model.togglePause()
            }
            .keyboardShortcut("p", modifiers: [.command, .option])
            .disabled(model.isSignedOut)

            Button("Stop and delete local intake") {
                model.stopContextIntake()
            }
            .keyboardShortcut("x", modifiers: [.command, .option])
            .disabled(model.isSignedOut || model.isPaused || (model.capsule.items.isEmpty && model.mode != .working))

            Button("Clear local context") {
                model.clearLocalContext()
            }
            .keyboardShortcut(.delete, modifiers: [.command, .option])
            .disabled(model.capsule.items.isEmpty)

            Divider()

            Button(model.isAccessibilityZoomPreview ? "End 200% text preview" : "Preview 200% text") {
                model.toggleAccessibilityZoomPreview()
            }
            .keyboardShortcut("0", modifiers: [.command, .option])
            .disabled(!model.isSyntheticFixture)

            Button(model.isReducedMotionPreview ? "End Reduced Motion preview" : "Preview Reduced Motion") {
                model.toggleReducedMotionPreview()
            }
            .keyboardShortcut("9", modifiers: [.command, .option])
            .disabled(!model.isSyntheticFixture)
        }
    }
}

private struct NativeInitializationBoundary<Content: View>: View {
    @EnvironmentObject private var model: AppModel
    @State private var ready = false
    @State private var attempt = 0
    @ViewBuilder let content: Content
    var body: some View {
        Group {
            if ready { content }
            else {
                VStack(spacing: 16) {
                    if let message = model.errorMessage {
                        Text(message).foregroundStyle(.secondary)
                        Button("重试连接") { attempt += 1 }
                    } else { ProgressView("连接本机工具…") }
                }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }.task(id: attempt) { ready = await model.ensureInitialized() }
    }
}
