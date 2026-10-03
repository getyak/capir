import SwiftUI
import UniformTypeIdentifiers

struct ContextCapsuleView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selectedText = ""
    @State private var isPickingFile = false
    @FocusState private var isTextFocused: Bool

    let compact: Bool
    let showsIntake: Bool

    init(compact: Bool, showsIntake: Bool = true) {
        self.compact = compact
        self.showsIntake = showsIntake
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    SectionLabel(text: "Included context")
                    Text("Only items visible here can be considered for this task.")
                        .font(.subheadline)
                        .foregroundStyle(TSBrand.secondaryInk)
                }
                Spacer()
                Text("Draft v\(model.capsule.version)")
                .font(.caption.monospacedDigit())
                    .foregroundStyle(TSBrand.secondaryInk)
            }

            if let notice = model.localRecoveryNotice {
                Label(notice, systemImage: "lock.rotation")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("capsule.recoveryNotice")
            }

            if let receipt = model.intakeControlReceipt {
                Label(receipt, systemImage: "stop.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("capsule.intakeControlReceipt")
            }

            if let receipt = model.windowCaptureReceipt {
                Label(receipt, systemImage: model.isSelectingWindow ? "rectangle.dashed.badge.record" : "rectangle.on.rectangle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("capsule.windowCaptureReceipt")
            }

            if let receipt = model.fileIngestReceipt {
                Label(receipt, systemImage: "doc.text.magnifyingglass")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("capsule.fileIngestReceipt")
            }

            if showsIntake {
                TextEditor(text: $selectedText)
                    .font(.body)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(minHeight: compact ? 72 : 88, maxHeight: compact ? 100 : 130)
                    .background(TSBrand.raisedSurface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(TSBrand.hairline))
                    .focused($isTextFocused)
                    .accessibilityLabel("User-selected text")
                    .accessibilityHint("Nothing is captured automatically. Enter only the text you intend to review.")
                    .accessibilityIdentifier("capsule.textEditor")

                HStack {
                    Button("Add selected text", systemImage: "text.badge.plus") {
                        model.addSelectedText(selectedText)
                        if model.errorMessage == nil { selectedText = "" }
                    }
                    .keyboardShortcut(.return, modifiers: [.command])
                    .disabled(
                        selectedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                            model.isPaused || model.isImportingFiles || model.isSelectingWindow
                    )
                    .accessibilityIdentifier("capsule.addText")

                    Button(model.isImportingFiles ? "Reading locally…" : "Choose screenshot or document…", systemImage: "doc.viewfinder") {
                        isPickingFile = true
                    }
                    .disabled(model.isPaused || model.isImportingFiles || model.isSelectingWindow)
                    .accessibilityHint("Reads only the chosen image, PDF, or text document on this Mac; nothing is uploaded")
                    .accessibilityIdentifier("capsule.addFile")

                    Button(
                        model.isSelectingWindow ? "Cancel window choice" : "Choose window…",
                        systemImage: model.isSelectingWindow ? "xmark.circle" : "macwindow.badge.plus"
                    ) {
                        if model.isSelectingWindow {
                            model.cancelSystemSelectedWindow()
                        } else {
                            Task { await model.addSystemSelectedWindow() }
                        }
                    }
                    .disabled(model.isPaused || model.isImportingFiles)
                    .accessibilityHint(model.isSelectingWindow
                        ? "Cancels the macOS picker without capturing or retaining a window"
                        : "Opens the macOS single-window picker, then captures one still frame with no cursor or audio")
                    .accessibilityIdentifier("capsule.addWindow")

                    Spacer()
                    Text(model.isPaused ? "Intake paused" : "Explicit intake only")
                        .font(.caption)
                        .foregroundStyle(model.isPaused ? TSBrand.seam : .secondary)
                }
            }

            if model.capsule.items.isEmpty {
                CapsuleEmptyState()
            } else {
                VStack(spacing: 10) {
                    ForEach(model.capsule.items) { item in
                        CapsuleItemRow(item: item)
                    }
                }
            }

            if let errorMessage = model.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(TSBrand.seam)
                    .accessibilityIdentifier("capsule.error")
            }

            CapsuleBoundarySummary()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("capsule.section")
        .fileImporter(
            isPresented: $isPickingFile,
            allowedContentTypes: [.plainText, .pdf, .image],
            allowsMultipleSelection: true
        ) { result in
            if case .success(let urls) = result {
                Task { await model.addFiles(urls) }
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard !urls.isEmpty else { return false }
            Task { await model.addFiles(urls) }
            return true
        }
        .onAppear { if compact { isTextFocused = true } }
    }
}

private struct CapsuleEmptyState: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "viewfinder")
                .font(.title2)
            Text("Nothing has been captured")
                .font(.headline)
            Text("Paste selected text, choose a file, drop one here, or explicitly open the macOS single-window picker. Opening this panel never reads the current window or clipboard.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 440)
        }
        .frame(maxWidth: .infinity, minHeight: 110)
        .padding()
        .background(TSBrand.surface, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .stroke(TSBrand.hairline, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        }
        .accessibilityIdentifier("capsule.empty")
    }
}

private struct CapsuleItemRow: View {
    @EnvironmentObject private var model: AppModel
    @State private var isRedacting = false
    @State private var redactionTerms = ""
    let item: ContextCapsuleItem

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: sourceIcon)
                    .foregroundStyle(TSBrand.evidence)
                    .frame(width: 20)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.displayName)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                    Text(item.preview.isEmpty ? "No reviewable text was recognized. The raw file remains local-only." : item.preview)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                    Text(item.acquisition)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    Text("Speaker position: not represented by this source · author attribution is reviewed separately below")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                Spacer(minLength: 8)
                Button("Redact…", systemImage: "eye.slash") {
                    isRedacting = true
                }
                .buttonStyle(.borderless)
                .accessibilityHint("Masks exact visible terms locally before this item can be submitted")
                .accessibilityIdentifier("capsule.redact.\(item.id.uuidString)")
                Button("Remove", systemImage: "xmark") {
                    model.removeCapsuleItem(id: item.id)
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .help("Remove this item before submission")
                .accessibilityIdentifier("capsule.remove.\(item.id.uuidString)")
            }

            HStack(spacing: 16) {
                Toggle("Keep on this Mac only", isOn: Binding(
                    get: { item.localOnly },
                    set: { model.setLocalOnly(id: item.id, value: $0) }
                ))
                .toggleStyle(.switch)
                .controlSize(.small)
                .disabled(!item.hasReviewedTextDerivative)
                .help(item.hasReviewedTextDerivative ? "Controls whether the reviewed text derivative may be submitted" : "No reviewed text derivative is available to submit")
                .accessibilityIdentifier("capsule.localOnly.\(item.id.uuidString)")

                Picker("Raw retention", selection: Binding(
                    get: { item.retention },
                    set: { model.setRetention(id: item.id, value: $0) }
                )) {
                    ForEach(CapsuleRetention.allCases) { retention in
                        Text(retention.title).tag(retention)
                    }
                }
                .labelsHidden()
                .frame(maxWidth: 210)
                .accessibilityLabel("Raw retention for \(item.displayName)")
                .accessibilityIdentifier("capsule.retention.\(item.id.uuidString)")

                if item.redactionCount > 0 {
                    Label("\(item.redactionCount) local redaction\(item.redactionCount == 1 ? "" : "s")", systemImage: "eye.slash.fill")
                        .font(.caption)
                        .foregroundStyle(TSBrand.evidence)
                        .accessibilityIdentifier("capsule.redactionReceipt.\(item.id.uuidString)")
                }
            }

            HStack(spacing: 12) {
                Picker("Who authored or spoke this excerpt?", selection: Binding<CapsuleActorKind?>(
                    get: { item.actorKind },
                    set: { model.setAttribution(id: item.id, actorKind: $0) }
                )) {
                    Text("Unresolved — do not attribute").tag(Optional<CapsuleActorKind>.none)
                    ForEach(CapsuleActorKind.allCases) { actor in
                        Text(actor.title).tag(Optional(actor))
                    }
                }
                .frame(maxWidth: 290)
                .accessibilityHint("Relationship scope does not identify the author. Choose only when the visible source proves it.")
                .accessibilityIdentifier("capsule.attribution.\(item.id.uuidString)")

                if item.hasConfirmedAttribution {
                    Label("Attribution confirmed", systemImage: "person.text.rectangle.fill")
                        .font(.caption)
                        .foregroundStyle(TSBrand.evidence)
                        .accessibilityIdentifier("capsule.attributionReceipt.\(item.id.uuidString)")
                } else {
                    Button("Confirm attribution") {
                        model.confirmAttribution(id: item.id)
                    }
                    .disabled(item.actorKind == nil)
                    .accessibilityHint("Confirms only who authored this excerpt; it does not confirm a fact or approve an action")
                    .accessibilityIdentifier("capsule.confirmAttribution.\(item.id.uuidString)")
                }
            }
        }
        .padding(14)
        .tsSurface()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("capsule.item.\(item.id.uuidString)")
        .sheet(isPresented: $isRedacting) {
            VStack(alignment: .leading, spacing: 16) {
                Text("Redact exact terms")
                    .font(.title3.weight(.semibold))
                Text("Enter names, addresses, or other exact visible terms separated by commas. capri replaces matching text locally with [REDACTED].")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                TextField("Exact terms, separated by commas", text: $redactionTerms)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("capsule.redactionTerms")
                HStack {
                    Button("Cancel") { isRedacting = false }
                    Spacer()
                    Button("Apply local redaction") {
                        model.redactCapsuleItem(
                            id: item.id,
                            exactTerms: redactionTerms.split(separator: ",").map(String.init)
                        )
                        if model.errorMessage == nil {
                            redactionTerms = ""
                            isRedacting = false
                        }
                    }
                    .buttonStyle(TSPrimaryButtonStyle())
                    .disabled(redactionTerms.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("capsule.applyRedaction")
                }
            }
            .padding(22)
            .frame(width: 480)
        }
    }

    private var sourceIcon: String {
        switch item.kind {
        case .file: "doc"
        case .selectedText: "text.quote"
        case .window: "macwindow"
        }
    }
}

private struct CapsuleBoundarySummary: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lock.shield")
                .foregroundStyle(TSBrand.evidence)
            VStack(alignment: .leading, spacing: 3) {
                Text("Upload boundary")
                    .font(.caption.weight(.semibold))
                Text("\(model.capsule.sharedItems.count) reviewed, candidate-attributed item(s) eligible for this person-bound MVP task · \(model.capsule.items.count - model.capsule.sharedItems.count) local-only, unsupported, or unresolved. Raw content is ephemeral; nothing becomes memory automatically.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if !model.capsule.sharedItems.isEmpty {
                    Text("Shared reviewed text derivative: canonical source authorization expires within \(sharedDerivativeTTL). Deleting or revoking it sooner prevents later decision use.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(14)
        .background(TSBrand.evidenceTint.opacity(0.42), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(TSBrand.evidence.opacity(0.18))
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("capsule.boundary")
    }

    private var sharedDerivativeTTL: String {
        model.capsule.sharedItems.contains { $0.retention == .twentyFourHours }
            ? "24 hours"
            : "1 hour"
    }
}
