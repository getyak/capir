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

    private static let images: [DesktopPet: NSImage] = {
        var loaded: [DesktopPet: NSImage] = [:]
        for pet in allCases {
            guard let url = Bundle.main.url(forResource: pet.rawValue, withExtension: "png"),
                  let image = NSImage(contentsOf: url) else { continue }
            loaded[pet] = image
        }
        return loaded
    }()

    var image: NSImage? { Self.images[self] }
}

/// Persist a relative location so unplugging a display or changing its usable
/// area cannot strand the companion outside the desktop.
struct DesktopPetPlacement {
    static func clamped(_ point: NSPoint, in frame: NSRect, size: NSSize) -> NSPoint {
        NSPoint(
            x: min(max(point.x, frame.minX), max(frame.minX, frame.maxX - size.width)),
            y: min(max(point.y, frame.minY), max(frame.minY, frame.maxY - size.height))
        )
    }

    static func relative(_ point: NSPoint, in frame: NSRect, size: NSSize) -> NSPoint {
        let clampedPoint = clamped(point, in: frame, size: size)
        let width = max(frame.width - size.width, 1)
        let height = max(frame.height - size.height, 1)
        return NSPoint(x: (clampedPoint.x - frame.minX) / width,
                       y: (clampedPoint.y - frame.minY) / height)
    }

    static func origin(_ relative: NSPoint, in frame: NSRect, size: NSSize) -> NSPoint {
        let x = relative.x.isFinite ? min(max(relative.x, 0), 1) : 0.95
        let y = relative.y.isFinite ? min(max(relative.y, 0), 1) : 0.04
        return clamped(NSPoint(x: frame.minX + x * max(frame.width - size.width, 0),
                               y: frame.minY + y * max(frame.height - size.height, 0)),
                       in: frame, size: size)
    }
}

/// The pet has no background feed. Its appearance is stored only on this Mac.
@MainActor
final class DesktopPetController: ObservableObject {
    static let shared = DesktopPetController()

    private enum Key {
        static let pet = "desktopPet.selection"
        static let visible = "desktopPet.visible"
        static let x = "desktopPet.location.x"
        static let y = "desktopPet.location.y"
        static let display = "desktopPet.location.display"
        static let legacyEdge = "desktopPet.edge"
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
    @Published var motionEnabled: Bool {
        didSet { UserDefaults.standard.set(motionEnabled, forKey: Key.motion) }
    }

    private let artworkSize = NSSize(width: 100, height: 100)
    private var artworkPanel: DesktopPetPanel?
    var openWorkspaceWindow: (() -> Void)?

    private init() {
        let defaults = UserDefaults.standard
        selectedPet = DesktopPet(rawValue: defaults.string(forKey: Key.pet) ?? "") ?? .pigeon
        isVisible = defaults.object(forKey: Key.visible) as? Bool ?? false
        motionEnabled = defaults.object(forKey: Key.motion) as? Bool ?? true
    }

    func start() {
        guard artworkPanel == nil else { return }
        let artwork = DesktopPetPanel(
            contentRect: NSRect(origin: .zero, size: artworkSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        let artworkView = DesktopPetInteractionView(rootView: DesktopPetArtworkView(controller: self))
        artworkView.controller = self
        artwork.contentView = artworkView
        configure(artwork)
        artworkPanel = artwork
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
        guard let artworkPanel else { return }
        if isVisible {
            positionPanel()
            artworkPanel.orderFrontRegardless()
        } else {
            artworkPanel.orderOut(nil)
        }
    }

    private func positionPanel() {
        guard let artworkPanel else { return }
        let defaults = UserDefaults.standard
        let savedDisplay = (defaults.object(forKey: Key.display) as? NSNumber)?.uint32Value
        let screen = NSScreen.screens.first { $0.displayID == savedDisplay }
            ?? NSScreen.main ?? NSScreen.screens.first
        guard let screen else { return }
        let frame = screen.visibleFrame
        let relative: NSPoint
        if defaults.object(forKey: Key.x) != nil && defaults.object(forKey: Key.y) != nil {
            relative = NSPoint(x: defaults.double(forKey: Key.x), y: defaults.double(forKey: Key.y))
        } else {
            let legacyLeft = defaults.string(forKey: Key.legacyEdge) == "left"
            relative = DesktopPetPlacement.relative(
                NSPoint(x: legacyLeft ? frame.minX + 24 : frame.maxX - artworkSize.width - 24,
                        y: frame.minY + 20), in: frame, size: artworkSize)
        }
        artworkPanel.setFrameOrigin(DesktopPetPlacement.origin(relative, in: frame, size: artworkSize))
    }

    func moveArtwork(to origin: NSPoint) {
        guard let artworkPanel else { return }
        let center = NSPoint(x: origin.x + artworkSize.width / 2,
                             y: origin.y + artworkSize.height / 2)
        let screen = NSScreen.screens.first { $0.frame.contains(center) }
            ?? artworkPanel.screen ?? NSScreen.main ?? NSScreen.screens.first
        guard let screen else { return }
        artworkPanel.setFrameOrigin(DesktopPetPlacement.clamped(origin, in: screen.visibleFrame,
                                                                 size: artworkSize))
    }

    func savePosition() {
        guard let artworkPanel else { return }
        let center = NSPoint(x: artworkPanel.frame.midX, y: artworkPanel.frame.midY)
        let screen = NSScreen.screens.first { $0.frame.contains(center) }
            ?? artworkPanel.screen ?? NSScreen.main ?? NSScreen.screens.first
        guard let screen else { return }
        let point = DesktopPetPlacement.relative(artworkPanel.frame.origin,
                                                  in: screen.visibleFrame, size: artworkSize)
        let defaults = UserDefaults.standard
        defaults.set(Double(point.x), forKey: Key.x)
        defaults.set(Double(point.y), forKey: Key.y)
        if let displayID = screen.displayID { defaults.set(displayID, forKey: Key.display) }
    }

    func openWorkspace() {
        openWorkspaceWindow?()
        NSApp.activate(ignoringOtherApps: true)
    }
}

/// Capture the scene-owned open action while the main workspace is present.
/// The closure remains available after its window closes. Reusing the main
/// scene preserves its current page and any unsent draft.
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
    @Environment(\.openSettings) private var openSettings

    var body: some Commands {
        CommandMenu("桌面伙伴") {
            Button("桌面伙伴设置…") {
                WorkspaceSettingsNavigation.shared.selection = .companion
                openSettings()
            }
            .keyboardShortcut("p", modifiers: [.command, .shift])
        }
    }
}

private final class DesktopPetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

private extension NSScreen {
    var displayID: UInt32? {
        (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
    }
}

/// AppKit handles the tap/drag distinction before the SwiftUI artwork can
/// claim the gesture. A small drag threshold keeps ordinary clicks reliable.
private final class DesktopPetInteractionView: NSHostingView<DesktopPetArtworkView> {
    weak var controller: DesktopPetController?
    private var mouseStart: NSPoint?
    private var frameStart: NSPoint?
    private var didDrag = false

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        mouseStart = NSEvent.mouseLocation
        frameStart = window?.frame.origin
        didDrag = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let mouseStart, let frameStart else { return }
        let now = NSEvent.mouseLocation
        let dx = now.x - mouseStart.x
        let dy = now.y - mouseStart.y
        if !didDrag && hypot(dx, dy) < 4 { return }
        didDrag = true
        controller?.moveArtwork(to: NSPoint(x: frameStart.x + dx, y: frameStart.y + dy))
    }

    override func mouseUp(with event: NSEvent) {
        if didDrag { controller?.savePosition() }
        else { controller?.openWorkspace() }
        mouseStart = nil
        frameStart = nil
    }

    override func resetCursorRects() {
        super.resetCursorRects()
        addCursorRect(bounds, cursor: .openHand)
    }

    override func accessibilityPerformPress() -> Bool {
        controller?.openWorkspace()
        return true
    }
}

private struct PetArtwork: View {
    let pet: DesktopPet
    let size: CGFloat
    let motionEnabled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24.0,
                                paused: !motionEnabled || reduceMotion)) { timeline in
            let wave = motionEnabled && !reduceMotion
                ? sin(timeline.date.timeIntervalSinceReferenceDate * .pi / 2.4) : -1
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
            .scaleEffect(1.015 + 0.015 * wave)
            .offset(y: -0.5 - 1.5 * wave)
        }
        .accessibilityLabel("\(pet.name)桌面伙伴")
    }
}

private struct DesktopPetArtworkView: View {
    @ObservedObject var controller: DesktopPetController

    var body: some View {
        PetArtwork(pet: controller.selectedPet, size: 92,
                   motionEnabled: controller.motionEnabled && controller.isVisible)
            .frame(width: 100, height: 100)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(controller.selectedPet.name)桌面伙伴")
            .accessibilityHint("点击打开工作区，拖动调整桌面位置")
            .accessibilityAddTraits(.isButton)
    }
}

struct DesktopPetSettingsView: View {
    @ObservedObject private var pet = DesktopPetController.shared

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    if geometry.size.width >= 640 {
                        HStack(alignment: .top, spacing: 24) {
                            titleBlock.frame(maxWidth: .infinity, alignment: .leading)
                            visibilityButton
                        }
                        HStack(alignment: .top, spacing: 28) {
                            choices
                            preview
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            titleBlock
                            visibilityButton
                        }
                        choices
                        preview
                    }
                }
                .padding(32)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
        }
        .background(.background)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("桌面伙伴").font(.title2.weight(.semibold))
            Text("轻轻陪在桌面一角。拖动调整位置，点击打开主窗口。")
                .font(.callout).foregroundStyle(.secondary)
        }
    }

    private var visibilityButton: some View {
        Button(pet.isVisible ? "隐藏伙伴" : "显示伙伴") {
            pet.isVisible.toggle()
        }
        .buttonStyle(.bordered)
        .fixedSize()
        .accessibilityIdentifier("desktopPet.visibility")
    }

    private var choices: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("选择伙伴").font(.headline).padding(.bottom, 2)
            ForEach(DesktopPet.allCases) { option in
                Button {
                    pet.selectedPet = option
                } label: {
                    HStack(spacing: 11) {
                        PetArtwork(pet: option, size: 48, motionEnabled: false)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(option.name).font(.subheadline.weight(.medium))
                            Text(option.note).font(.caption).foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 4)
                        Image(systemName: pet.selectedPet == option ? "largecircle.fill.circle" : "circle")
                            .font(.system(size: 14))
                            .foregroundStyle(pet.selectedPet == option ? Color.primary : .secondary)
                            .accessibilityHidden(true)
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 65)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(pet.selectedPet == option ? Color.primary.opacity(0.055) : Color.clear,
                                in: RoundedRectangle(cornerRadius: 11))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("desktopPet.option.\(option.rawValue)")
                .accessibilityAddTraits(pet.selectedPet == option ? .isSelected : [])
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 13) {
            Text("在桌面上的样子").font(.headline)
            ZStack(alignment: .bottomTrailing) {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color(red: 0.90, green: 0.92, blue: 0.88))
                RoundedRectangle(cornerRadius: 7)
                    .fill(Color.white.opacity(0.88))
                    .frame(width: 160, height: 78)
                    .overlay(alignment: .topLeading) {
                        Text("给正在做的事留空间。")
                            .font(.system(size: 10, weight: .medium))
                            .padding(11)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                PetArtwork(pet: pet.selectedPet, size: 56, motionEnabled: pet.motionEnabled)
                    .padding(8)
            }
            .frame(height: 180)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(pet.selectedPet.name)桌面伙伴预览")

            Text(pet.selectedPet.name).font(.title3.weight(.semibold))
            Text(pet.selectedPet.note).font(.callout).foregroundStyle(.secondary)
            Text(pet.isVisible ? "可拖动 · 点击打开工作区 · 不展示私人文字" : "已隐藏 · 选择和位置已保留")
                .font(.caption).foregroundStyle(.secondary)

            Divider()
            Toggle("轻微浮动动画", isOn: $pet.motionEnabled)
                .toggleStyle(.switch)
            Text("事项状态只来自已验证的工作区数据；没有可靠来源时不会显示进度或数量。")
                .font(.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
