import AppKit
import SwiftUI

/// Device-only appearance. These names refer to artwork bundled with the app,
/// never to a person, account, or inferred relationship state.
enum DesktopPet: String, CaseIterable, Identifiable {
    case pigeon, stone, owl, cat, sprout, robot

    var id: String { rawValue }

    var name: String {
        switch self {
        case .pigeon: "信鸽"
        case .stone: "小石头"
        case .owl: "猫头鹰"
        case .cat: "小猫"
        case .sprout: "嫩芽"
        case .robot: "小机器人"
        }
    }

    var note: String {
        switch self {
        case .pigeon: "安静地陪你等一封回信"
        case .stone: "稳稳地待在桌面一角"
        case .owl: "适合需要专注的时刻"
        case .cat: "轻巧又有自己的节奏"
        case .sprout: "一点温柔的生长感"
        case .robot: "清晰、简洁的小伙伴"
        }
    }

    var image: NSImage? {
        guard let url = Bundle.main.url(forResource: rawValue, withExtension: "png") else {
            return nil
        }
        return NSImage(contentsOf: url)
    }
}

enum DesktopPetEdge: String, CaseIterable, Identifiable {
    case left, right
    var id: String { rawValue }
    var title: String { self == .left ? "左下" : "右下" }
}

/// The pet has no background feed. It only displays local controls and an
/// honest unavailable state until the workspace exposes a scoped task source.
@MainActor
final class DesktopPetController: ObservableObject {
    static let shared = DesktopPetController()

    private enum Key {
        static let pet = "desktopPet.selection"
        static let visible = "desktopPet.visible"
        static let edge = "desktopPet.edge"
        static let motion = "desktopPet.motion"
    }

    @Published var selectedPet: DesktopPet {
        didSet { UserDefaults.standard.set(selectedPet.rawValue, forKey: Key.pet) }
    }
    @Published var isVisible: Bool {
        didSet {
            UserDefaults.standard.set(isVisible, forKey: Key.visible)
            updateVisibility()
        }
    }
    @Published var edge: DesktopPetEdge {
        didSet {
            UserDefaults.standard.set(edge.rawValue, forKey: Key.edge)
            positionPanel()
        }
    }
    @Published var motionEnabled: Bool {
        didSet { UserDefaults.standard.set(motionEnabled, forKey: Key.motion) }
    }

    private var artworkPanel: NSPanel?
    private var controlsPanel: DesktopPetPanel?
    var openWorkspaceWindow: (() -> Void)?

    private init() {
        let defaults = UserDefaults.standard
        selectedPet = DesktopPet(rawValue: defaults.string(forKey: Key.pet) ?? "") ?? .pigeon
        isVisible = defaults.object(forKey: Key.visible) as? Bool ?? false
        edge = DesktopPetEdge(rawValue: defaults.string(forKey: Key.edge) ?? "") ?? .right
        motionEnabled = defaults.object(forKey: Key.motion) as? Bool ?? true
    }

    func start() {
        guard controlsPanel == nil else { return }
        let artwork = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 132, height: 132),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        artwork.ignoresMouseEvents = true
        artwork.contentView = NSHostingView(rootView: DesktopPetArtworkView(controller: self))
        configure(artwork)
        artworkPanel = artwork

        let controls = DesktopPetPanel(
            contentRect: NSRect(x: 0, y: 0, width: 176, height: 40),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        controls.contentView = NSHostingView(rootView: DesktopPetControlsView(controller: self))
        configure(controls)
        controls.hasShadow = true
        controlsPanel = controls
        positionPanel()
        updateVisibility()
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.positionPanel() }
        }
    }

    private func configure(_ panel: NSPanel) {
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
    }

    private func updateVisibility() {
        guard let artworkPanel, let controlsPanel else { return }
        if isVisible {
            positionPanel()
            artworkPanel.orderFrontRegardless()
            controlsPanel.orderFrontRegardless()
        } else {
            artworkPanel.orderOut(nil)
            controlsPanel.orderOut(nil)
        }
    }

    private func positionPanel() {
        guard let artworkPanel, let controlsPanel,
              let screen = NSScreen.main ?? NSScreen.screens.first else { return }
        let frame = screen.visibleFrame
        let x = edge == .right ? frame.maxX - controlsPanel.frame.width - 24 : frame.minX + 24
        let y = frame.minY + 20
        controlsPanel.setFrameOrigin(NSPoint(x: x, y: y))
        artworkPanel.setFrameOrigin(NSPoint(
            x: x + (controlsPanel.frame.width - artworkPanel.frame.width) / 2,
            y: y + controlsPanel.frame.height + 4
        ))
    }

    func openWorkspace() {
        openWorkspaceWindow?()
        NSApp.activate(ignoringOtherApps: true)
    }
}

/// Capture the scene-owned open action while the main workspace is present.
/// The closure remains available after its window closes, so the pet can bring
/// that same scene back without navigating or discarding a draft.
struct DesktopPetWorkspaceLink: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Color.clear.frame(width: 0, height: 0)
            .onAppear {
                DesktopPetController.shared.openWorkspaceWindow = { openWindow(id: "workspace") }
            }
    }
}

struct DesktopPetCommands: Commands {
    @ObservedObject private var pet = DesktopPetController.shared

    var body: some Commands {
        CommandMenu("桌面伙伴") {
            Button(pet.isVisible ? "隐藏伙伴" : "显示伙伴") {
                pet.isVisible.toggle()
            }
            .keyboardShortcut("p", modifiers: [.command, .shift])
        }
    }
}

private final class DesktopPetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

private struct PetArtwork: View {
    let pet: DesktopPet
    let size: CGFloat
    let motionEnabled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    var body: some View {
        Group {
            if let image = pet.image {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
            } else {
                Image(systemName: "bird.fill")
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(.tint)
            }
        }
        .frame(width: size, height: size)
        .scaleEffect(breathing && motionEnabled && !reduceMotion ? 1.035 : 1)
        .animation(motionEnabled && !reduceMotion ? .easeInOut(duration: 2.8).repeatForever(autoreverses: true) : nil,
                   value: breathing)
        .onAppear { breathing = true }
        .accessibilityLabel("\(pet.name)桌面伙伴")
    }
}

private struct DesktopPetArtworkView: View {
    @ObservedObject var controller: DesktopPetController

    var body: some View {
        PetArtwork(pet: controller.selectedPet, size: 120, motionEnabled: controller.motionEnabled)
            .frame(width: 132, height: 132)
            .allowsHitTesting(false)
    }
}

private struct DesktopPetControlsView: View {
    @ObservedObject var controller: DesktopPetController
    @State private var showingWork = false

    var body: some View {
        HStack(spacing: 0) {
                Button {
                    controller.openWorkspace()
                } label: {
                    Label("工作区", systemImage: "arrow.up.right")
                }
                .help("打开 Talent Signal 工作区")
                Divider().frame(height: 17).padding(.horizontal, 9)
                Button {
                    showingWork = true
                } label: {
                    Image(systemName: "tray")
                }
                .accessibilityLabel("查看事项")
                .help("查看事项状态")
                .popover(isPresented: $showingWork, arrowEdge: .top) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("事项").font(.headline)
                        Text("当前没有可核验的任务摘要")
                            .font(.subheadline.weight(.medium))
                        Text("此 Mac 尚未收到可靠的事项状态。请在工作区查看当前进度。")
                            .font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("打开工作区") {
                            showingWork = false
                            controller.openWorkspace()
                        }
                    }
                    .padding(18)
                    .frame(width: 260, alignment: .leading)
                }
                Divider().frame(height: 17).padding(.horizontal, 9)
                Button {
                    controller.isVisible = false
                } label: {
                    Image(systemName: "eye.slash")
                }
                .accessibilityLabel("隐藏桌面伙伴")
                .help("隐藏桌面伙伴，可在此 Mac 设置中恢复")
        }
        .buttonStyle(.plain)
        .font(.system(size: 12, weight: .medium))
        .padding(.horizontal, 12)
        .frame(width: 176, height: 40)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.primary.opacity(0.08)))
    }
}

struct DesktopPetSettingsView: View {
    @ObservedObject private var pet = DesktopPetController.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 23) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("桌面伙伴").font(.title2.weight(.semibold))
                    Text("一个安静的桌面入口。你可以随时隐藏，选择会保留在这台 Mac。")
                        .font(.callout).foregroundStyle(.secondary)
                    Button(pet.isVisible ? "隐藏伙伴" : "显示伙伴") {
                        pet.isVisible.toggle()
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("desktopPet.visibility")
                    .padding(.top, 6)
                }

                VStack(spacing: 10) {
                    PetArtwork(pet: pet.selectedPet, size: 132, motionEnabled: pet.motionEnabled)
                        .frame(height: 150)
                    Text(pet.selectedPet.name).font(.headline)
                    Text(pet.selectedPet.note).font(.caption).foregroundStyle(.secondary)
                    Text(pet.isVisible ? "显示在桌面边缘" : "已隐藏 · 你的选择已保留")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(pet.isVisible ? Color.accentColor : .secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
                .background(Color.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.primary.opacity(0.09)))

                VStack(alignment: .leading, spacing: 12) {
                    Text("选择伙伴").font(.headline)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                        ForEach(DesktopPet.allCases) { option in
                            Button {
                                pet.selectedPet = option
                            } label: {
                                VStack(spacing: 5) {
                                    PetArtwork(pet: option, size: 58, motionEnabled: false)
                                    Text(option.name).font(.caption.weight(.medium))
                                }
                                .frame(maxWidth: .infinity)
                                .frame(height: 95)
                                .background(pet.selectedPet == option ? Color.accentColor.opacity(0.09) : Color.primary.opacity(0.025),
                                            in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(pet.selectedPet == option ? Color.accentColor.opacity(0.6) : Color.primary.opacity(0.07)))
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("desktopPet.option.\(option.rawValue)")
                            .accessibilityAddTraits(pet.selectedPet == option ? .isSelected : [])
                        }
                    }
                }

                HStack {
                    Picker("桌面位置", selection: $pet.edge) {
                        ForEach(DesktopPetEdge.allCases) { edge in Text(edge.title).tag(edge) }
                    }
                    .frame(maxWidth: 230)
                    Spacer()
                    Toggle("轻微呼吸动画", isOn: $pet.motionEnabled)
                        .toggleStyle(.switch)
                }
                Text("事项状态只来自已验证的工作区数据；没有可靠来源时不会显示进度或数量。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(32)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(.background)
    }
}
