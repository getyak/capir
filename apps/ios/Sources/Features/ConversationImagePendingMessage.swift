import SwiftUI
import UIKit
import Combine

/// Bytes live only until this message's authenticated original is readable.
/// Attachment identities come from the protected manifest, including a retry
/// that reattaches identical bytes under newly selected local draft IDs.
@MainActor
final class ConversationImageLocalPreviewStore: ObservableObject {
    private struct Message {
        let order: [UUID]
        var drafts: [UUID: AskMediaDraft]
    }
    @Published private var messages: [UUID: Message] = [:]

    func retain(messageID: UUID, manifests: [ConversationImageManifest], drafts: [AskMediaDraft]) {
        guard manifests.count == drafts.count else { return }
        messages[messageID] = Message(order: manifests.map(\.attachmentID),
            drafts: Dictionary(uniqueKeysWithValues: zip(manifests, drafts).map { ($0.attachmentID, $1) }))
    }

    func drafts(for messageID: UUID) -> [AskMediaDraft] {
        guard let message = messages[messageID] else { return [] }
        return message.order.compactMap { message.drafts[$0] }
    }

    func previews(for messageID: UUID) -> [UUID: UIImage] {
        messages[messageID]?.drafts.mapValues(\.preview) ?? [:]
    }

    func authenticatedLoad(messageID: UUID, attachmentID: UUID) {
        messages[messageID]?.drafts.removeValue(forKey: attachmentID)
        if messages[messageID]?.drafts.isEmpty == true { messages.removeValue(forKey: messageID) }
    }
}

/// Ephemeral observations from both channels share one monotonic reduction.
/// This owns presentation only; it cannot admit, retry or complete a message.
@MainActor
final class ConversationImageProgressTracker: ObservableObject {
    @Published private(set) var messageID: UUID?
    @Published private var entry: ConversationImageQueueEntry?
    @Published private var observedAt: Date?
    @Published private var observedStage: ConversationImageRunStage?
    @Published private var paused = false
    @Published private var isChecking = false
    private var revision = -1

    func reset(for messageID: UUID) {
        self.messageID = messageID; entry = nil; observedAt = nil
        observedStage = nil; revision = -1; paused = false; isChecking = false
    }

    func beginChecking(messageID: UUID) {
        if self.messageID != messageID { reset(for: messageID) }
        isChecking = true
    }

    func finishChecking(messageID: UUID) {
        if self.messageID == messageID { isChecking = false }
    }

    func state(for pending: PendingImageConversation, isSending: Bool) -> ConversationImageProgressState {
        let matches = messageID == pending.messageID
        return .derive(pending: pending, isSending: isSending, isChecking: matches && isChecking,
            entry: matches ? entry : nil, paused: matches && paused,
            observedAt: matches ? observedAt : nil, observedStage: matches ? observedStage : nil)
    }

    func apply(_ update: ConversationImageQueueUpdate) {
        guard update.messageID == messageID else { return }
        accept(entry: update.entry, revision: update.revision, paused: update.paused,
            observedAt: update.observedAt, stage: update.observedStage)
    }

    func apply(_ observation: ConversationImageObservation, messageID: UUID) {
        guard self.messageID == messageID else { return }
        accept(entry: observation.entry, revision: observation.revision, paused: observation.paused,
            observedAt: observation.observedAt, stage: observation.entry?.progressStage)
    }

    private func accept(entry incoming: ConversationImageQueueEntry?, revision incomingRevision: Int?,
        paused: Bool, observedAt: Date, stage: ConversationImageRunStage?) {
        guard incomingRevision.map({ $0 >= revision }) ?? (revision < 0) else { return }
        // A poll at the same queue revision must not erase a newer verified
        // stream stage simply because its snapshot has no stage field.
        let keepsStage = incomingRevision == revision && incoming?.queueEntryID == entry?.queueEntryID
            && incoming?.runID == entry?.runID && incoming?.queueStatus == .running && incoming?.cancelRequested == false
        observedStage = stage ?? (keepsStage ? observedStage : nil)
        revision = incomingRevision ?? revision
        entry = incoming; self.paused = paused; self.observedAt = observedAt
    }
}

/// Message presentation has no delivery authority. Every recovery callback is
/// supplied by the Session owner and reconciles the same protected identity.
struct ConversationImagePendingMessage: View {
    let pending: PendingImageConversation
    let localDrafts: [AskMediaDraft]
    let language: AppLanguage
    let progress: ConversationImageProgressState
    let isSending: Bool
    let errorMessage: String?
    let canCheckOriginalSend: Bool
    let loadImage: (Int, ConversationImageManifest) async throws -> ChatMediaContent
    let onCheck: () -> Void
    let onCheckOriginalSend: () -> Void
    let onChoosePhotos: () -> Void
    let onChooseFiles: () -> Void
    let onNewSession: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .trailing, spacing: 8) {
                if !localDrafts.isEmpty {
                    ConversationPendingImageSources(drafts: localDrafts, language: language)
                } else if !pending.images.isEmpty, pending.queueEntryID != nil {
                    ConversationImageAlbum(messageID: pending.messageID, images: pending.images, load: loadImage)
                        .frame(maxWidth: 310)
                } else if !pending.images.isEmpty {
                    Label(language.text("Original image") + " · \(pending.images.count)", systemImage: "photo")
                        .font(.footnote).foregroundStyle(Color.tsMutedInk).padding(12)
                        .background(Color.tsSurfaceMuted, in: RoundedRectangle(cornerRadius: 16))
                }
                if !pending.objective.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    AskUserMessageBubble(message: pending.objective)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)

            ConversationImageProgressView(state: progress, language: language, onCheck: onCheck)
                .disabled(isSending)

            if !isSending {
                if let errorMessage {
                    Text(errorMessage).font(.footnote).foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Menu {
                    if pending.state != .stopped {
                        if canCheckOriginalSend {
                            Button(language.text("Check original send"), action: onCheckOriginalSend)
                        } else {
                            Button(language.text("Photos"), action: onChoosePhotos)
                            Button(language.text("Files"), action: onChooseFiles)
                        }
                    }
                    Button(language.text("Start new Session"), action: onNewSession)
                } label: {
                    Label(language.text("More options"), systemImage: "ellipsis")
                        .font(.footnote).frame(minHeight: 44)
                }
                .accessibilityIdentifier("image-conversation-recovery-options")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("image-conversation-pending-message")
    }
}

/// The sent message keeps a usable source preview while admission/readback is
/// pending. It is intentionally separate from the removable composer tray.
struct ConversationPendingImageSources: View {
    let drafts: [AskMediaDraft]
    let language: AppLanguage
    @State private var selectedImage: UUID?

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if drafts.count == 1, let draft = drafts.first {
                tile(draft)
            } else {
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: 8) {
                        ForEach(drafts) { draft in tile(draft) }
                    }
                }
                .scrollIndicators(.hidden)
                .frame(maxWidth: 310)
                Text(String(drafts.count) + " · " + language.text("Images"))
                    .font(.caption).foregroundStyle(Color.tsMutedInk)
            }
        }
        .accessibilityIdentifier("conversation-local-image-message")
        .sheet(isPresented: Binding(get: { selectedImage != nil }, set: { if !$0 { selectedImage = nil } })) {
            NavigationStack {
                ZStack {
                    Color.black.ignoresSafeArea()
                    if let image = drafts.first(where: { $0.id == selectedImage })?.preview {
                        ZoomableCaptureImage(image: image)
                            .accessibilityIdentifier("conversation-original-image")
                    }
                }
                .navigationTitle(language.text("Original image"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbarColorScheme(.dark, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(language.text("Done")) { selectedImage = nil }
                    }
                }
            }
        }
    }

    private func tile(_ draft: AskMediaDraft) -> some View {
        let layout = ConversationImagePresentation.layout(
            imageSize: CGSize(width: CGFloat(max(1, draft.width)), height: CGFloat(max(1, draft.height))),
            availableWidth: 310, isMultiple: drafts.count > 1)
        let isLong = layout.isLong, width = layout.width, height = layout.height
        return Button { selectedImage = draft.id } label: {
            VStack(alignment: .leading, spacing: 0) {
                Image(uiImage: draft.preview)
                    .resizable().scaledToFill()
                    .frame(width: width, height: height, alignment: .top)
                    .clipped()
                if isLong {
                    Label(language.text("View full image"), systemImage: "arrow.up.left.and.arrow.down.right")
                        .font(.caption).foregroundStyle(Color.tsMutedInk)
                        .padding(.horizontal, 12).frame(width: width, alignment: .leading).frame(minHeight: 36)
                        .background(Color.tsSurfaceMuted)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 16).stroke(Color.tsLine, lineWidth: 0.5) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(language.text("Original image") + " \((drafts.firstIndex { $0.id == draft.id } ?? 0) + 1)")
        .accessibilityIdentifier("conversation-local-image-\(draft.id.uuidString.lowercased())")
    }
}
