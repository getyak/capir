import AppKit
import SwiftUI

private enum PreviewTool: String, CaseIterable {
    case crop = "裁剪"
    case redact = "遮挡"
}

struct CapturePreviewView: View {
    @ObservedObject var coordinator: CaptureCoordinator
    let close: () -> Void
    @State private var tool: PreviewTool = .redact
    @State private var crop: CGRect?
    @State private var redactions: [CGRect] = []
    @State private var pending: CGRect?
    @State private var dragStart: CGPoint?
    @State private var busy = false
    @State private var error: String?
    @State private var displaySize: CGSize = .zero

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("先预览这次截图").font(.headline)
                Spacer()
                Button("取消") { coordinator.discardPreview(); close() }
            }
            if let image = coordinator.previewImage {
                GeometryReader { proxy in
                    let available = proxy.size
                    let scale = min(available.width / CGFloat(image.width), available.height / CGFloat(image.height))
                    let display = CGSize(width: CGFloat(image.width) * scale, height: CGFloat(image.height) * scale)
                    ZStack(alignment: .topLeading) {
                        Image(decorative: image, scale: 1)
                            .resizable()
                            .frame(width: display.width, height: display.height)
                        ForEach(Array(redactions.enumerated()), id: \.offset) { _, rect in
                            Rectangle().fill(.black).frame(width: rect.width, height: rect.height)
                                .position(x: rect.midX, y: rect.midY)
                        }
                        if let crop {
                            Rectangle().strokeBorder(.white, lineWidth: 2)
                                .background(.white.opacity(0.08))
                                .frame(width: crop.width, height: crop.height)
                                .position(x: crop.midX, y: crop.midY)
                        }
                        if let pending {
                            Rectangle().fill(tool == .redact ? .black : .white.opacity(0.12))
                                .overlay { Rectangle().strokeBorder(.white, lineWidth: 1) }
                                .frame(width: pending.width, height: pending.height)
                                .position(x: pending.midX, y: pending.midY)
                        }
                    }
                    .frame(width: display.width, height: display.height)
                    .contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 3)
                        .onChanged { value in
                            if dragStart == nil { dragStart = value.startLocation }
                            let start = dragStart ?? value.startLocation
                            pending = CGRect(x: min(start.x, value.location.x), y: min(start.y, value.location.y),
                                             width: abs(start.x - value.location.x), height: abs(start.y - value.location.y))
                        }
                        .onEnded { value in
                            defer { dragStart = nil; pending = nil }
                            guard let selection = pending, selection.width > 3, selection.height > 3,
                                  selection.minX >= 0, selection.minY >= 0,
                                  selection.maxX <= display.width, selection.maxY <= display.height else { return }
                            if tool == .crop { crop = selection }
                            else { redactions.append(selection) }
                        })
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .overlay(alignment: .bottomTrailing) { Text("仅这块选区会发送").font(.caption).padding(8)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8)) }
                    .accessibilityLabel("待发送截图；选择裁剪或遮挡后拖动来修改")
                    .onAppear { displaySize = display }
                    .onChange(of: display) { _, new in
                        // A resized window changes the image-to-point mapping.
                        // Clear old coordinates rather than apply them elsewhere.
                        if displaySize != new { crop = nil; redactions = []; displaySize = new }
                    }
                }
                .frame(minHeight: 280)
            } else {
                ContentUnavailableView("截图已关闭", systemImage: "photo")
            }
            HStack(spacing: 12) {
                Picker("编辑方式", selection: $tool) {
                    ForEach(PreviewTool.allCases, id: \.self) { item in Text(item.rawValue).tag(item) }
                }.pickerStyle(.segmented).frame(width: 180)
                Button("清除编辑") { crop = nil; redactions = [] }
                Spacer()
                if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
                Button("发送截图") { submit() }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy || coordinator.previewImage == nil)
            }
        }
        .padding(20)
        .frame(minWidth: 640, minHeight: 440)
    }

    private func submit() {
        guard let source = coordinator.previewImage else { return }
        busy = true
        let logical = displaySize == .zero
            ? CGSize(width: CGFloat(source.width), height: CGFloat(source.height)) : displaySize
        do {
            let edited = try CapturePreviewImage.render(source, logicalSize: logical, crop: crop, redactions: redactions)
            Task { await coordinator.submitPreview(edited); close() }
        } catch {
            busy = false
            self.error = "编辑后的截图暂时无法生成，请重试。"
        }
    }
}

@MainActor
final class CapturePreviewWindowController: NSObject, NSWindowDelegate {
    private var window: NSWindow?
    private weak var coordinator: CaptureCoordinator?

    func show(coordinator: CaptureCoordinator) {
        if let window, self.coordinator === coordinator { window.makeKeyAndOrderFront(nil); return }
        dismiss()
        let new = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 560),
                           styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        new.animationBehavior = .none
        new.isReleasedWhenClosed = false
        new.title = "Talent Signal · 截图预览"
        self.coordinator = coordinator
        new.delegate = self
        new.contentViewController = NSHostingController(rootView: CapturePreviewView(coordinator: coordinator) { [weak self] in
            self?.window?.close(); self?.window = nil
        })
        new.center()
        window = new
        NSApp.activate(ignoringOtherApps: true)
        new.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) {
        if case .previewReady = coordinator?.presentation { coordinator?.discardPreview() }
        window = nil
        coordinator = nil
    }

    func dismiss() {
        window?.close()
        window = nil
        coordinator = nil
    }
}
