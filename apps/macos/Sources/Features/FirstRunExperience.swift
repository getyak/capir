import SwiftUI

/// Presentation is local. The existing form remains the connection owner and
/// stays mounted while hidden, preserving an unfinished address/probe draft.
struct FirstRunExperience: View {
    var reduceMotionPreview = false
    private enum Screen: Equatable { case invitation, example, connection }
    private enum Focus: Hashable {
        case connect, exampleBack, connectionBack, correction, reveal
        case insight(FirstRunSample.Kind)
    }
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    private var reduceMotion: Bool { systemReduceMotion || reduceMotionPreview }
    @State private var screen: Screen = .invitation
    @State private var sample = FirstRunSample()
    @State private var arrived = false
    @FocusState private var focus: Focus?

    var body: some View {
        ScrollView {
            ZStack(alignment: .topLeading) {
                if screen == .invitation { invitation.transition(.opacity) }
                if screen == .example { example.transition(.opacity) }
                VStack(alignment: .leading, spacing: 26) {
                    Button("返回", systemImage: "chevron.left") { show(.invitation) }
                        .buttonStyle(.plain)
                        .keyboardShortcut(.cancelAction)
                        .focused($focus, equals: .connectionBack)
                        .accessibilityIdentifier("firstRun.connectionBack")
                    WorkspaceConnectionForm(mode: .firstRun, isActive: screen == .connection, onConnected: {})
                }
                .frame(maxWidth: 460)
                .frame(height: screen == .connection ? nil : 0, alignment: .top)
                .clipped()
                .opacity(screen == .connection ? 1 : 0)
                .allowsHitTesting(screen == .connection)
                .disabled(screen != .connection)
                .accessibilityHidden(screen != .connection)
            }
            .frame(maxWidth: 560, alignment: .leading)
            .padding(.horizontal, 44)
            .padding(.vertical, 36)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .foregroundStyle(TSBrand.ink)
        .background(TSBrand.canvas)
        .onExitCommand {
            if screen == .example && sample.editing != nil {
                sample.cancelCorrection()
                focus = sample.selected.map(Focus.insight)
            }
            else { show(.invitation) }
        }
        .task {
            // SwiftUI's real accessibility environment controls the entrance:
            // https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion
            if reduceMotion { arrived = true }
            else { withAnimation(.easeOut(duration: 0.75)) { arrived = true } }
            focus = .connect
        }
        .accessibilityIdentifier("firstRun.experience")
    }

    private var invitation: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 10) {
                    TSBrandMark(size: 32).accessibilityHidden(true)
                    Text("capri").font(.title3.weight(.semibold))
                }
                Text("让每一次重要对话，\n都有下文。")
                    .font(.system(size: 32, weight: .medium))
                    .tracking(-0.6)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("firstRun.invitation")
                Text("从一段话开始，看清值得继续的事。")
                    .font(.body)
                    .foregroundStyle(TSBrand.secondaryInk)
            }
            .opacity(arrived ? 1 : 0)
            VStack(alignment: .leading, spacing: 10) {
                Text("“\(FirstRunSample.source)”")
                    .font(.system(size: 17))
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
                Text("虚构示例 · 可在本机体验")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
            }
            .padding(.leading, 18)
            .overlay(alignment: .leading) { Rectangle().fill(TSBrand.hairline).frame(width: 2) }
            .padding(.vertical, 32)
            Button("连接你的工作区") { show(.connection) }
                .buttonStyle(FirstRunPrimaryButtonStyle())
                .focused($focus, equals: .connect)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("firstRun.connect")
            Button("先体验一个示例 →") { show(.example) }
                .buttonStyle(.plain)
                .padding(.vertical, 18)
                .accessibilityIdentifier("firstRun.tryExample")
            Text("已有工作区？继续原来的对话、人物与下一步。")
                .font(.caption)
                .foregroundStyle(TSBrand.secondaryInk)
        }
        .accessibilityElement(children: .contain)
    }

    private var example: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack {
                if sample.editing == nil {
                    exampleBack.keyboardShortcut(.cancelAction)
                } else {
                    exampleBack
                }
                Spacer()
                Text("虚构示例 · 只在本机")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
            }
            Text("一句话，接住下一步。")
                .font(.title2.weight(.medium))
                .accessibilityAddTraits(.isHeader)
            Text("“\(FirstRunSample.source)”")
                .font(.system(size: 18))
                .lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .accessibilityIdentifier("sample.source")
            if !sample.revealed {
                Button("看看下一步") {
                    sample.reveal()
                    focus = .insight(.dependency)
                }
                    .buttonStyle(FirstRunPrimaryButtonStyle())
                        .focused($focus, equals: .reveal)
                    .accessibilityIdentifier("sample.reveal")
                Text("这是一份预先写好的演示，点击后可核对和修改。")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(sample.items) { item in
                        Button { sample.inspect(item.id) } label: {
                            VStack(alignment: .leading, spacing: 7) {
                                HStack {
                                    Text(item.title).font(.caption.weight(.medium))
                                    Spacer()
                                    Text(item.corrected ? "你的示例解释" : "待核对的示例解释")
                                        .font(.caption2)
                                }
                                .foregroundStyle(TSBrand.secondaryInk)
                                Text(item.detail)
                                    .font(.body)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(14)
                            .contentShape(Rectangle())
                            .background(sample.selected == item.id ? TSBrand.selection : .clear,
                                        in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                        .focused($focus, equals: .insight(item.id))
                        .accessibilityHint("查看这条解释对应的原话")
                        .accessibilityIdentifier("sample.insight.\(item.id.rawValue)")
                        if item.id != .suggestion { Divider().overlay(TSBrand.hairline) }
                    }
                }
                if let quote = sample.selectedQuote, let selected = sample.selected {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("对应原话").font(.caption.weight(.medium)).foregroundStyle(TSBrand.secondaryInk)
                        Text("“\(quote)”").textSelection(.enabled)
                            .accessibilityIdentifier("sample.selectedSource")
                        if sample.editing != nil {
                            TextEditor(text: $sample.correctionDraft)
                                .font(.body)
                                .frame(height: 88)
                                .focused($focus, equals: .correction)
                                .accessibilityLabel("修改示例解释")
                                .accessibilityIdentifier("sample.correction")
                            if let error = sample.correctionError {
                                Text(error).font(.caption).accessibilityIdentifier("sample.correctionError")
                            }
                            HStack(spacing: 18) {
                                Button("应用到示例") {
                                    if sample.applyCorrection() { focus = sample.selected.map(Focus.insight) }
                                }
                                    .buttonStyle(FirstRunPrimaryButtonStyle())
                                    .keyboardShortcut(.return, modifiers: [.command])
                                    .accessibilityIdentifier("sample.applyCorrection")
                                Button("取消") {
                                    sample.cancelCorrection()
                                    focus = sample.selected.map(Focus.insight)
                                }
                                    .buttonStyle(.plain)
                                    .keyboardShortcut(.cancelAction)
                                    .accessibilityIdentifier("sample.cancelCorrection")
                            }
                        } else {
                            Button {
                                sample.beginCorrection(selected)
                                focus = .correction
                            } label: {
                                Text("修改这条解释").underline()
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("sample.edit")
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(TSBrand.raisedSurface, in: RoundedRectangle(cornerRadius: 10))
                }
                Text("解释可以修改；是否跟进，由你决定。示例不会发送消息或创建日程。")
                    .font(.caption)
                    .foregroundStyle(TSBrand.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 22) {
                    Button("连接你的工作区") { show(.connection) }
                        .buttonStyle(FirstRunPrimaryButtonStyle())
                        .accessibilityIdentifier("sample.connect")
                    Button("重新体验") {
                        sample.reset()
                        focus = .reveal
                    }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("sample.reset")
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var exampleBack: some View {
        Button("返回", systemImage: "chevron.left") { show(.invitation) }
            .buttonStyle(.plain)
            .focused($focus, equals: .exampleBack)
            .accessibilityIdentifier("sample.back")
    }

    private func show(_ destination: Screen) {
        // The address form stays mounted; only visibility changes. Moving focus
        // out of its hidden controls prevents typing into an invisible draft.
        if reduceMotion { screen = destination }
        else { withAnimation(.easeInOut(duration: 0.75)) { screen = destination } }
        switch destination {
        case .invitation: focus = .connect
        case .example: focus = sample.revealed ? .insight(sample.selected ?? .dependency) : .reveal
        case .connection: focus = nil
        }
    }
}

struct FirstRunPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .foregroundStyle(isEnabled ? TSBrand.canvas : TSBrand.secondaryInk)
            .background(isEnabled ? TSBrand.ink : TSBrand.selection, in: RoundedRectangle(cornerRadius: 9))
            .opacity(isEnabled && configuration.isPressed ? 0.78 : 1)
            .contentShape(RoundedRectangle(cornerRadius: 9))
    }
}
