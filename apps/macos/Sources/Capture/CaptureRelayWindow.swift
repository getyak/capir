import AppKit
import Combine
import QuartzCore
import SwiftUI

private final class CaptureRelayPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class CaptureRelayWindowController: ObservableObject {
    @Published private(set) var snapshot: CaptureRelaySnapshot?
    @Published private(set) var arrived = false
    @Published private(set) var scanToken = 0
    @Published private(set) var scanActive = false
    @Published private(set) var animateResult = false
    @Published private(set) var opaque = false
    private let accessibility: @MainActor () -> CaptureRelayAccessibility
    private var panel: NSPanel?
    private var flightPanel: NSPanel?
    private var flightTask: Task<Void, Never>?
    private var scanTask: Task<Void, Never>?
    private var monitor: Timer?
    private var gate = CaptureRelayMotionGate()
    private var destination: CaptureRelayDestination?
    private var anchorFrame: CGRect?
    private var travelled = false
    private var wasQuiet = false
    private weak var coordinator: CaptureCoordinator?
    private var openSession: ((UUID) -> Void)?
    private var inspectSource: (() -> Void)?

    init(accessibility: @escaping @MainActor () -> CaptureRelayAccessibility = {
        .init(reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
              reduceTransparency: NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency)
    }) { self.accessibility = accessibility }

    var isVisible: Bool { panel?.isVisible == true }
    var quiet: Bool { !DesktopPetController.shared.motionEnabled || accessibility().reduceMotion }

    func show(_ next: CaptureRelaySnapshot, coordinator: CaptureCoordinator,
              openSession: @escaping (UUID) -> Void, inspectSource: @escaping () -> Void) {
        guard let anchor = DesktopPetController.shared.captureAnchor else {
            coordinator.dismissRelay(); dismiss(); return
        }
        let changed = snapshot?.intentID != next.intentID || snapshot?.ownerRevision != next.ownerRevision
        if changed {
            dismiss()
            gate.bind(intentID: next.intentID, ownerRevision: next.ownerRevision)
            travelled = false; arrived = false; destination = nil
            wasQuiet = quiet
        }
        reconcileAccessibility()
        self.coordinator = coordinator; self.openSession = openSession; self.inspectSource = inspectSource
        animateResult = next.result.map { gate.reveal(intentID: next.intentID, ownerRevision: next.ownerRevision,
                                                     version: $0.resultVersion, quiet: quiet) } ?? false
        snapshot = next
        if panel == nil {
            let window = CaptureRelayPanel(contentRect: CGRect(x: 0, y: 0, width: 356,
                height: min(480, anchor.display.visibleFrame.height - 24)),
                styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            window.level = .floating
            window.title = "截图接力"
            window.isReleasedWhenClosed = false
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            window.isOpaque = false; window.backgroundColor = .clear; window.hasShadow = true
            window.hidesOnDeactivate = false; window.animationBehavior = .none
            let content = NSHostingView(rootView: CaptureRelayView(controller: self))
            // The bounded panel owns its size. A flexible SwiftUI ScrollView's
            // ideal size must not grow the window below the visible screen.
            content.sizingOptions = []
            content.frame = CGRect(origin: .zero, size: window.frame.size)
            content.autoresizingMask = [.width, .height]
            window.contentView = content
            panel = window
            position(at: anchor.frame, display: anchor.display)
            window.orderFrontRegardless() // Never activate the app or open its workspace.
            monitor = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.checkDestination() }
            }
        }
        if next.phase == .processing {
            let count = gate.scans(intentID: next.intentID, ownerRevision: next.ownerRevision, admitted: true, quiet: quiet)
            if count > 0 {
                scanToken += 1; scanActive = true
                scanTask?.cancel()
                scanTask = Task { [weak self] in
                    try? await Task.sleep(for: .milliseconds(650 * count))
                    guard !Task.isCancelled else { return }
                    self?.scanActive = false
                }
            }
        } else { scanTask?.cancel(); scanActive = false }
    }

    private func position(at frame: CGRect, display: CaptureRelayDisplay) {
        guard let panel else { return }
        anchorFrame = frame
        let size = panel.frame.size, bounds = display.visibleFrame
        let x = frame.midX > bounds.midX ? frame.minX - size.width - 12 : frame.maxX + 12
        let y = frame.minY
        panel.setFrameOrigin(DesktopPetPlacement.clamped(CGPoint(x: x, y: y), in: bounds, size: size))
    }

    private func checkDestination() {
        guard let snapshot else { return }
        reconcileAccessibility()
        guard snapshot.ownerRevision == coordinator?.currentOwnerRevision,
              let anchor = DesktopPetController.shared.captureAnchor, snapshot.expiresAt > Date() else {
            coordinator?.dismissRelay(); dismiss(); return
        }
        if anchorFrame != anchor.frame {
            cancelFlight(); withAnimation(.linear(duration: 0.120)) { arrived = true }
            position(at: anchor.frame, display: anchor.display)
        }
        if let destination, !NSScreen.screens.contains(where: { CaptureRelayDisplay(screen: $0) == destination.display }) {
            cancelFlight(); withAnimation(.linear(duration: 0.120)) { arrived = true }
        }
    }

    private func reconcileAccessibility() {
        let prefersOpaque = accessibility().reduceTransparency
        if opaque != prefersOpaque { opaque = prefersOpaque }
        let prefersQuiet = quiet
        // A new snapshot can arrive before the monitor. Both entry points must
        // consume the transition before replacing its previous value.
        if wasQuiet != prefersQuiet {
            cancelFlight(); scanTask?.cancel(); scanActive = false
            DesktopPetController.shared.resetCaptureNod()
            withAnimation(.linear(duration: 0.120)) { arrived = true }
            wasQuiet = prefersQuiet
        }
    }

    func measuredSlot(_ next: CaptureRelayDestination?, intentID: UUID, ownerRevision: Int) {
        guard snapshot?.intentID == intentID, snapshot?.ownerRevision == ownerRevision else { return }
        if let destination, next != destination, flightPanel != nil { cancelFlight(); arrived = true }
        destination = next
        guard !travelled, let next, let snapshot, panel?.isVisible == true else { return }
        travelled = true
        guard let image = snapshot.thumbnail,
              let flight = CaptureRelayGeometry.flight(from: snapshot.origin, to: next,
                                                        reducedMotion: quiet, motionEnabled: !quiet),
              next.display.visibleFrame.contains(next.rect.insetBy(dx: -2, dy: -6)) else {
            withAnimation(.linear(duration: 0.120)) { arrived = true }
            let nod = gate.land(intentID: snapshot.intentID, ownerRevision: snapshot.ownerRevision, quiet: quiet)
            if nod {
                flightTask = Task { [weak self] in
                    try? await Task.sleep(for: .milliseconds(120))
                    guard !Task.isCancelled, let self, self.snapshot?.intentID == snapshot.intentID,
                          self.snapshot?.ownerRevision == snapshot.ownerRevision, !self.quiet else { return }
                    DesktopPetController.shared.captureNodOnce()
                }
            }
            return
        }
        let overlay = NSPanel(contentRect: next.display.frame, styleMask: [.borderless, .nonactivatingPanel],
                              backing: .buffered, defer: false)
        overlay.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)
        overlay.isReleasedWhenClosed = false
        overlay.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        overlay.isOpaque = false; overlay.backgroundColor = .clear; overlay.hasShadow = false
        overlay.ignoresMouseEvents = true; overlay.hidesOnDeactivate = false; overlay.animationBehavior = .none
        let view = NSView(frame: CGRect(origin: .zero, size: next.display.frame.size))
        view.wantsLayer = true
        let layer = CALayer(); layer.contents = image; layer.contentsGravity = .resizeAspect
        layer.cornerRadius = 10; layer.masksToBounds = true
        let screen = next.display.frame
        let positions = flight.frames.map { CGPoint(x: $0.midX - screen.minX, y: $0.midY - screen.minY) }
        let final = positions.last!
        let path = CAKeyframeAnimation(keyPath: "position")
        path.values = (positions + [CGPoint(x: final.x, y: final.y + 4), final, final]).map { NSValue(point: $0) }
        path.keyTimes = (flight.keyTimes.map { $0 * 0.420 / 0.580 } + [0.480 / 0.580, 0.540 / 0.580, 1]).map(NSNumber.init(value:))
        path.calculationMode = .linear
        path.duration = 0.580
        path.timingFunctions = Array(repeating: CAMediaTimingFunction(name: .linear), count: flight.frames.count - 1) +
            Array(repeating: CAMediaTimingFunction(controlPoints: 0.5, 0, 0.5, 1), count: 3)
        let size = CAKeyframeAnimation(keyPath: "bounds")
        size.values = (flight.frames.map { CGRect(origin: .zero, size: $0.size) } + [
            CGRect(x: 0, y: 0, width: next.rect.width * 1.03, height: next.rect.height * 0.97),
            CGRect(x: 0, y: 0, width: next.rect.width * 0.99, height: next.rect.height * 1.01),
            CGRect(origin: .zero, size: next.rect.size)]).map { NSValue(rect: $0) }
        size.keyTimes = path.keyTimes; size.calculationMode = .linear
        size.duration = 0.580; size.timingFunctions = path.timingFunctions
        let group = CAAnimationGroup(); group.animations = [path, size]; group.duration = 0.580
        layer.position = final; layer.bounds = CGRect(origin: .zero, size: next.rect.size)
        view.layer?.addSublayer(layer); overlay.contentView = view
        flightPanel = overlay; overlay.orderFrontRegardless(); layer.add(group, forKey: "captureRelay")
        flightTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(580))
            guard !Task.isCancelled, let self, self.snapshot?.intentID == snapshot.intentID,
                  self.snapshot?.ownerRevision == snapshot.ownerRevision, self.destination == next else { return }
            self.cancelFlight(); self.arrived = true
            if self.gate.land(intentID: snapshot.intentID, ownerRevision: snapshot.ownerRevision, quiet: self.quiet) {
                DesktopPetController.shared.captureNodOnce()
            }
        }
    }

    func open() { if let snapshot { openSession?(snapshot.sessionID) } }
    func inspect() { inspectSource?() }
    func retry() { if let snapshot { Task { await coordinator?.retry(intentID: snapshot.intentID) } } }
    func collapse() { coordinator?.dismissRelay(); dismiss() }

    private func cancelFlight() {
        flightTask?.cancel(); flightTask = nil
        flightPanel?.contentView = nil; flightPanel?.close(); flightPanel = nil
    }
    func dismiss() {
        cancelFlight(); scanTask?.cancel(); scanTask = nil; monitor?.invalidate(); monitor = nil
        panel?.contentView = nil; panel?.close(); panel = nil
        DesktopPetController.shared.resetCaptureNod()
        snapshot = nil; destination = nil; anchorFrame = nil; gate.clear()
        scanActive = false; animateResult = false; travelled = false
    }
}

extension CaptureRelayDisplay {
    @MainActor init?(screen: NSScreen) {
        guard let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value else { return nil }
        self.init(id: id, frame: screen.frame, visibleFrame: screen.visibleFrame, scale: screen.backingScaleFactor)
    }
}

private struct CaptureSlotProbe: NSViewRepresentable {
    let measured: (CaptureRelayDestination?) -> Void
    func makeNSView(context: Context) -> CaptureSlotProbeView { CaptureSlotProbeView(measured: measured) }
    func updateNSView(_ view: CaptureSlotProbeView, context: Context) { view.measured = measured; view.report() }
}

private final class CaptureSlotProbeView: NSView {
    var measured: (CaptureRelayDestination?) -> Void
    init(measured: @escaping (CaptureRelayDestination?) -> Void) { self.measured = measured; super.init(frame: .zero) }
    required init?(coder: NSCoder) { nil }
    override func layout() { super.layout(); report() }
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); report() }
    func report() {
        // Do not publish SwiftUI state during its layout transaction.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let window, window.isVisible, let screen = window.screen, let display = CaptureRelayDisplay(screen: screen), !bounds.isEmpty {
                measured(.init(rect: window.convertToScreen(convert(bounds, to: nil)), display: display))
            } else { measured(nil) }
        }
    }
}

private struct CaptureRelayView: View {
    @ObservedObject var controller: CaptureRelayWindowController
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @State private var excerpt: String?
    @State private var scanPosition: CGFloat = -1
    @State private var lastScanToken = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let snapshot = controller.snapshot {
                HStack(alignment: .top, spacing: 12) {
                    if let image = snapshot.thumbnail {
                        let scale = 72 / CGFloat(max(image.width, image.height))
                        Image(decorative: image, scale: 1).resizable().interpolation(.high)
                            .frame(width: CGFloat(image.width) * scale, height: CGFloat(image.height) * scale)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .background(CaptureSlotProbe(measured: { destination in
                                controller.measuredSlot(destination, intentID: snapshot.intentID, ownerRevision: snapshot.ownerRevision)
                            }))
                            .opacity(controller.arrived ? 1 : 0)
                            .overlay {
                                if controller.scanActive && !controller.quiet {
                                    GeometryReader { proxy in
                                        LinearGradient(colors: [.clear, .white.opacity(0.4), .clear], startPoint: .leading, endPoint: .trailing)
                                            .frame(width: 20).offset(x: scanPosition * (proxy.size.width + 20))
                                    }.clipped().allowsHitTesting(false)
                                }
                            }
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(title(snapshot)).font(.headline)
                        Text("仅本次选区 · 同一会话").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }.frame(minHeight: 76)
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        if let observation = snapshot.result?.observation, !observation.clues.isEmpty {
                            Text("以下只是图片中的文字，尚未确认身份或关系。").font(.caption).foregroundStyle(.secondary)
                            if observation.sourceWarning != nil {
                                Text("原图可能包含虚构或 AI 生成内容。").font(.caption).foregroundStyle(.secondary)
                            }
                            ForEach(Array(observation.clues.enumerated()), id: \.offset) { index, clue in
                                CaptureClueRow(clue: clue, index: index, animate: controller.animateResult && !controller.quiet) {
                                    excerpt = clue.sourceExcerpt
                                }
                                .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: .command)
                                .help("查看原文摘录（⌘\(index + 1)）")
                            }.id(snapshot.result?.resultVersion)
                        } else if snapshot.phase == .ready && snapshot.result != nil {
                            Text("暂无可核对线索。可以查看原图和会话中的真实回答。").font(.body).foregroundStyle(.secondary)
                        } else {
                            Text(detail(snapshot.phase)).font(.body).foregroundStyle(.secondary)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                if snapshot.phase == .unknown || snapshot.phase == .failed {
                    CaptureRelayAction("核对原请求") { controller.retry() }
                        .keyboardShortcut("r", modifiers: .command).help("核对原请求（⌘R）")
                }
                HStack {
                    CaptureRelayAction("查看会话") { controller.open() }
                        .keyboardShortcut(.return, modifiers: .command).help("查看会话（⌘Return）")
                    if snapshot.result != nil {
                        CaptureRelayAction("查看原图") { controller.inspect() }
                            .keyboardShortcut("o", modifiers: .command).help("查看原图（⌘O）")
                    }
                }
                CaptureRelayAction("收起提示") { controller.collapse() }.keyboardShortcut(.cancelAction)
                Text("收起提示不会停止 Agent；可在原会话查看或停止任务。")
                    .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            if reduceTransparency || controller.opaque { RoundedRectangle(cornerRadius: 18).fill(Color(nsColor: .windowBackgroundColor)) }
            else { RoundedRectangle(cornerRadius: 18).fill(.regularMaterial) }
        }
        .popover(isPresented: Binding(get: { excerpt != nil }, set: { if !$0 { excerpt = nil } })) {
            VStack(alignment: .leading, spacing: 12) {
                Text("原图文字摘录 · 待核对").font(.headline)
                Text(excerpt ?? "").textSelection(.enabled)
                CaptureRelayAction("查看同一张原图") { excerpt = nil; controller.inspect() }
            }.padding(20).frame(width: 300)
        }
        .onAppear { startScanIfAdmitted() }
        .onChange(of: controller.scanToken) { _, _ in startScanIfAdmitted() }
    }

    private func startScanIfAdmitted() {
        guard controller.scanActive, !controller.quiet, lastScanToken != controller.scanToken else { return }
        lastScanToken = controller.scanToken
        scanPosition = -1
        withAnimation(.linear(duration: 0.650).repeatCount(2, autoreverses: false)) { scanPosition = 1 }
    }

    private func title(_ snapshot: CaptureRelaySnapshot) -> String {
        switch snapshot.phase {
        case .uploading: "正在发送截图"
        case .processing: "已受理，正在处理"
        case .ready: snapshot.result == nil ? "正在核对结果" : "本次截图 · 待核对"
        case .unknown: "正在等待状态核对"
        case .failed: "这次处理未完成"
        }
    }
    private func detail(_ phase: CaptureRelayPhase) -> String {
        switch phase {
        case .uploading: "正在发送你选择的图片，还没有开始扫描结果。"
        case .processing: "处理会在后台继续；结果到达后再显示可核对的文字。"
        case .ready: "正在确认同一张图片的来源和处理回执。"
        case .unknown: "尚不能确认原请求的状态。核对后才决定是否重试，避免重复发送。"
        case .failed: "可以打开原会话查看详情；不会把未完成的处理显示为成功。"
        }
    }
}

private struct CaptureRelayAction: View {
    let title: String
    let action: () -> Void
    init(_ title: String, action: @escaping () -> Void) { self.title = title; self.action = action }
    var body: some View {
        Button(action: action) { Text(title).frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle()) }
            .buttonStyle(.bordered)
    }
}

private struct CaptureClueRow: View {
    let clue: CaptureTextClue
    let index: Int
    let animate: Bool
    let inspect: () -> Void
    @State private var visible = false
    var body: some View {
        Button(action: inspect) {
            HStack {
                Text(clue.kind == .person ? "人名文字" : "公司文字").font(.caption).foregroundStyle(.secondary)
                Text(clue.text).font(.body).lineLimit(2)
                Spacer(minLength: 4)
                Image(systemName: "text.quote").foregroundStyle(.secondary)
            }.padding(10).frame(minHeight: 44)
                .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain)
            .accessibilityLabel("\(clue.kind == .person ? "人名" : "公司")文字：\(clue.text)，待核对，查看原文摘录")
            .opacity(visible || !animate ? 1 : 0).offset(y: visible || !animate ? 0 : 12)
            .onAppear {
                if animate { withAnimation(.easeOut(duration: 0.2).delay(Double(index) * 0.060)) { visible = true } }
                else { visible = true }
            }
    }
}
