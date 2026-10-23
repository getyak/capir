import SwiftUI
import UniformTypeIdentifiers

struct ScreenshotContactCard: View {
    let task: ScreenshotContactTask
    let language: AppLanguage
    var onOpenPerson: ((String) -> Void)? = nil
    var onResume: ((ScreenshotContactResumeBody) -> Void)? = nil
    var onCancel: (() -> Void)? = nil
    var onLoadImage: ((Int) async throws -> ChatMediaContent)? = nil
    @State private var sourceImage: UIImage?
    @State private var showsSourceImage = false
    @State private var loadingSource = false
    @State private var filingName = ""
    @State private var showsImageRecovery = false
    @State private var recoveryError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 7) {
                    Text(statusLabel).font(.caption).foregroundStyle(Color.tsMutedInk)
                    Text(task.contact?.displayName ?? language.text("Chat screenshot"))
                        .font(.title3.weight(.semibold)).foregroundStyle(Color.tsInk)
                }
                Spacer(minLength: 8)
                if task.status == "running" { ProgressView().accessibilityLabel(statusLabel) }
                if let contact = task.contact, let onOpenPerson {
                    Button { onOpenPerson(contact.personID) } label: {
                        Image(systemName: "person.crop.rectangle").frame(width: 44, height: 44)
                    }
                        .accessibilityLabel(language.text("Open contact"))
                }
            }
            if let contact = task.contact {
                Text(verbatim: "\(contact.disposition == "created" ? language.text("Contact created") : language.text("Existing contact reused")) · \(task.messageCount) \(language.text("messages saved"))")
                    .font(.caption).foregroundStyle(Color.tsMutedInk)
            }
            if !task.summary.isEmpty { AgentMarkdownView(markdown: task.summary) }
            if let draft = task.contactDraft {
                ScreenshotProfileReview(task: task, draft: draft, language: language, onResume: onResume).id(task.taskID)
            }
            if let profile = task.reviewedProfile {
                VStack(alignment: .leading, spacing: 10) {
                    Text(language.text("Details saved in this review")).font(.headline)
                    Text(verbatim: "\(profile.displayName) · \(profile.platform)").font(.caption)
                    ForEach(profile.fields) { field in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(language.text(ScreenshotProfileReview.fieldLabel(field.kind))).font(.caption).foregroundStyle(Color.tsMutedInk)
                            Text(field.value).font(.subheadline)
                            DisclosureGroup(language.text("View screenshot evidence")) {
                                Text(field.sourceExcerpt).font(.caption).textSelection(.enabled)
                                Text(verbatim: "\(language.text("Image")) \(field.sourceImageIndex + 1)").font(.caption2)
                            }.font(.caption)
                        }
                    }
                }
            }
            if let question = task.question, task.contactDraft == nil {
                Text(question).font(.subheadline.weight(.medium))
                ForEach(task.candidates) { candidate in
                    Button {
                        onResume?(.init(expectedRevision: task.revision, selectedPersonID: candidate.personID, selectedRelationshipContextID: candidate.relationshipContextID))
                    } label: {
                        Text(verbatim: candidate.displayName + " · " + candidate.relationshipLabel)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .disabled(onResume == nil)
                }
                if task.captureID == nil, task.extraction != nil, onResume != nil {
                    TextField(language.text("Contact name for filing"), text: $filingName).textFieldStyle(.roundedBorder)
                    Button(language.text("Confirm and continue")) {
                        onResume?(.init(expectedRevision: task.revision, newContactName: filingName.trimmingCharacters(in: .whitespacesAndNewlines)))
                    }.disabled(filingName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            if ["partial", "failed", "cancelled"].contains(task.status), (task.extraction != nil || task.sourceImages?.isEmpty == false), onResume != nil {
                Button(language.text("Continue this task")) { onResume?(.init(expectedRevision: task.revision)) }
            }
            if task.extraction == nil, task.sourceImages?.isEmpty != false, ["waiting_for_user", "failed", "cancelled"].contains(task.status), onResume != nil {
                Button(language.text("Reattach the same screenshot")) { showsImageRecovery = true }
            }
            if let recoveryError { Text(recoveryError).font(.caption).foregroundStyle(Color.tsMutedInk) }
            if task.status == "running", let onCancel {
                Button(action: onCancel) { Text(language.text("Stop")).frame(minHeight: 44) }
                    .font(.caption)
            }
            ForEach(Array(task.findings.enumerated()), id: \.offset) { _, finding in
                VStack(alignment: .leading, spacing: 8) {
                    Text(finding.text).font(.subheadline)
                    DisclosureGroup(finding.epistemicStatus == "inference"
                        ? language.text("Interpretation · view evidence")
                        : language.text("Source statement · view evidence")) {
                        Text(verbatim: "“\(finding.sourceExcerpt)”")
                            .font(.caption).foregroundStyle(Color.tsMutedInk)
                            .textSelection(.enabled)
                        Text(verbatim: finding.messageRefs.joined(separator: ", "))
                            .font(.caption2).foregroundStyle(Color.tsMutedInk)
                    }
                    .font(.caption)
                }.padding(.vertical, 6)
            }
            if !task.profileFields.isEmpty {
                DisclosureGroup(language.text("Sourced professional context")) {
                    ForEach(Array(task.profileFields.enumerated()), id: \.offset) { _, field in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(language.text(profileLabel(field.field))).font(.caption.weight(.medium)).foregroundStyle(Color.tsMutedInk)
                            Text(field.value).font(.subheadline)
                            Text(field.sourceExcerpt).font(.caption).foregroundStyle(Color.tsMutedInk)
                            Text(field.epistemicStatus == "inference" ? language.text("Interpretation") : language.text("Source statement"))
                                .font(.caption2).foregroundStyle(Color.tsMutedInk)
                            ForEach(field.sourceRefs, id: \.self) { ref in
                                if let source = task.publicSources.first(where: { $0.sourceID == ref }), let url = URL(string: source.url), url.scheme == "https" {
                                    Link(source.title, destination: url).font(.caption)
                                } else { Text(verbatim: ref).font(.caption2).foregroundStyle(Color.tsMutedInk) }
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
                    }
                }
            }
            if let sources = task.sourceImages, let onLoadImage, !sources.isEmpty {
                DisclosureGroup(language.text("Original images")) {
                    ForEach(sources, id: \.imageIndex) { source in
                        Button {
                            loadingSource = true
                            Task { defer { loadingSource = false }; do {
                                let content = try await onLoadImage(source.imageIndex)
                                guard let image = UIImage(data: content.data) else { throw PursuitWorkspaceClientError.invalidResponse }
                                sourceImage = image; showsSourceImage = true; recoveryError = nil
                            } catch { recoveryError = language.text("The image could not be read.") } }
                        } label: { Text(verbatim: "\(language.text("Image")) \(source.imageIndex + 1)").frame(minHeight: 44) }
                        .disabled(loadingSource)
                    }
                }
            }
            if let extraction = task.extraction, !extraction.messages.isEmpty {
                DisclosureGroup(language.text("Chat evidence")) {
                    ForEach(extraction.messages) { message in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(verbatim: "\(message.sourceImageIndex.map { "\(language.text("Image")) \($0 + 1) · " } ?? "")\(message.messageID) · \(message.speakerSide == "left" ? language.text("Left side") : message.speakerSide == "right" ? language.text("Right side") : language.text("Speaker unknown"))")
                                .font(.caption2).foregroundStyle(Color.tsMutedInk)
                            Text(message.text).font(.subheadline).textSelection(.enabled)
                            if let time = message.timeText { Text(time).font(.caption2).foregroundStyle(Color.tsMutedInk) }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
                    }
                }
            }
            if !task.publicSources.isEmpty {
                DisclosureGroup(language.text("Public sources explored")) {
                    ForEach(task.publicSources) { source in
                        if let url = URL(string: source.url), url.scheme == "https" {
                            Link(destination: url) { VStack(alignment: .leading, spacing: 4) {
                                Text(source.title).font(.subheadline)
                                Text(verbatim: "\(source.channel) · \(source.stage == "fetched" ? language.text("Content read") : language.text("Possible match"))").font(.caption2)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 7) }
                        }
                    }
                }
            }
            if !task.limitations.isEmpty {
                DisclosureGroup(language.text("Uncertainty and limitations")) {
                    ForEach(Array(task.limitations.enumerated()), id: \.offset) { _, value in Text(value).font(.caption).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 5) }
                }
            }
        }.padding(20).background(Color.tsSurfaceMuted, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.tsLine.opacity(0.7)))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("screenshot-contact-card")
            .sheet(isPresented: $showsSourceImage, onDismiss: { sourceImage = nil }) {
                NavigationStack {
                    ZStack {
                        Color.black.ignoresSafeArea()
                        if let sourceImage {
                            ZoomableCaptureImage(image: sourceImage)
                                .accessibilityLabel(language.text("Original image"))
                                .accessibilityIdentifier("screenshot-original-image")
                        }
                    }
                        .navigationTitle(language.text("Original image"))
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbarBackground(Color.black, for: .navigationBar)
                        .toolbarColorScheme(.dark, for: .navigationBar)
                        .tint(.white)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(language.text("Done")) { showsSourceImage = false } } }
                }
            }
            .fileImporter(isPresented: $showsImageRecovery, allowedContentTypes: [.png, .jpeg, .webP]) { result in
                do {
                    let url = try result.get(); let accessed = url.startAccessingSecurityScopedResource()
                    defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size > 0, size <= 10_000_000 else { recoveryError = language.text("Choose a screenshot under 10 MB."); return }
                    let data = try Data(contentsOf: url)
                    let type = try url.resourceValues(forKeys: [.contentTypeKey]).contentType?.preferredMIMEType ?? "image/jpeg"
                    recoveryError = nil
                    onResume?(.init(expectedRevision: task.revision, image: .init(data: data, mediaType: type)))
                } catch { recoveryError = error.localizedDescription }
            }
    }
    private func profileLabel(_ field: String) -> String {
        ["headline": "Professional headline", "company": "Company", "job_title": "Role", "location": "Location", "professional_background": "Professional background", "professional_topics": "Professional topics", "public_profile": "Public profile"][field] ?? field
    }
    private var statusLabel: String {
        switch task.status {
        case "running": return language.text("Reading the conversation")
        case "completed": return language.text("Screenshot summary")
        case "partial": return language.text("Some items still need review")
        case "waiting_for_user": return language.text("Needs your clarification")
        case "deleted": return language.text("Source unavailable")
        case "cancelled": return language.text("Stopped")
        default: return language.text("Not completed")
        }
    }
}

struct ScreenshotContactHistoryView: View {
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    let onOpenPerson: (String) -> Void
    @Environment(\.appLanguage) private var language
    @Environment(\.dismiss) private var dismiss
    @State private var tasks: [ScreenshotContactTaskSummary] = []
    @State private var selected: ScreenshotContactTask?
    @State private var error: String?
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let error { Text(error).font(.caption).foregroundStyle(Color.tsMutedInk) }
                    if let selected {
                        ScreenshotContactCard(task: selected, language: language, onOpenPerson: { id in dismiss(); onOpenPerson(id) }, onResume: { body in
                            Task { do { self.selected = try await workspaceStore.resumeScreenshotContactTask(id: selected.taskID, body: body) } catch { self.error = error.localizedDescription } }
                        }, onCancel: {
                            Task { do { self.selected = try await workspaceStore.cancelScreenshotContactTask(id: selected.taskID, revision: selected.revision) } catch { self.error = error.localizedDescription } }
                        }, onLoadImage: { index in try await workspaceStore.loadScreenshotContactImage(taskID: selected.taskID, index: index) })
                    }
                    ForEach(tasks) { task in
                        Button { Task { do { selected = try await workspaceStore.loadScreenshotContactTask(id: task.taskID) } catch { self.error = error.localizedDescription } } } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(task.contact?.displayName ?? language.text("Chat screenshot")).font(.headline)
                                Text(task.summary).lineLimit(2).font(.caption).foregroundStyle(Color.tsMutedInk)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12)
                        }
                    }
                    if tasks.isEmpty { Text(language.text("Your screenshot tasks appear here.")).foregroundStyle(Color.tsMutedInk) }
                }.padding(20)
            }.background(Color.tsSurface)
                .navigationTitle(language.text("Screenshot tasks"))
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(language.text("Done")) { dismiss() } } }
                .task { do { tasks = try await workspaceStore.listScreenshotContactTasks().tasks } catch { self.error = error.localizedDescription } }
                .task(id: "\(selected?.taskID ?? ""): \(selected?.status ?? "")") {
                    guard let id = selected?.taskID, selected?.status == "running" else { return }
                    do { while !Task.isCancelled { try await Task.sleep(nanoseconds: 2_000_000_000); let current = try await workspaceStore.loadScreenshotContactTask(id: id); selected = current; if current.status != "running" { break } } }
                    catch { if !Task.isCancelled { self.error = error.localizedDescription } }
                }
        }
    }
}
