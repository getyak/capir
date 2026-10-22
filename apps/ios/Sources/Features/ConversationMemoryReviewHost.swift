import SwiftUI
import UIKit

/// Obtain current account authority before rendering the decision. A saved
/// answer's refresh label does not disable this separate, reauthorized read.
struct ConversationMemoryReviewHost: View {
    let proposal: ConversationMemoryProposalReference
    let sessionID: UUID
    let reviewScope: ConversationMemoryReviewScope?
    let sourceIndex: ConversationMemorySourceIndex
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    let language: AppLanguage
    let onSaved: (ConversationMemoryDestination) -> Void
    let onOpenPerson: (String) -> Void
    let onSource: (UUID, Int?) -> Void
    @State private var client: ConversationMemoryReviewClient?
    @State private var failed = false
    @State private var attempt = 0
    @State private var selectedSource: SourceSelection?
    @State private var sourceUnavailable = false

    private struct SourceSelection: Identifiable {
        let messageID: UUID
        let index: Int?
        let manifest: ConversationImageManifest?
        let text: String?
        var id: String { "\(messageID)|\(index.map(String.init) ?? "text")" }
    }

    var body: some View {
        Group {
            if let client {
                ConversationMemoryReviewCard(proposal: proposal, sessionID: sessionID,
                    sourceMessageIDs: sourceIndex.messageIDs, client: client, language: language,
                    onSaved: onSaved, onOpenPerson: onOpenPerson,
                    onReviewSource: { messageID, index in
                        guard let source = sourceIndex[messageID] else { sourceUnavailable = true; return }
                        onSource(source.parentTurnID, index)
                        if let index {
                            guard source.images.indices.contains(index) else { sourceUnavailable = true; return }
                            selectedSource = SourceSelection(messageID: messageID, index: index, manifest: source.images[index], text: nil)
                        } else if let text = source.supplementalText {
                            selectedSource = SourceSelection(messageID: messageID, index: nil, manifest: nil, text: text)
                        }
                    })
                    .id("\(client.accountBinding)|\(client.reviewScope.bindingKey)|\(sessionID)|\(proposal.proposal_id)")
            } else if failed {
                VStack(alignment: .leading, spacing: 6) {
                    Text(language.text("Contact review could not be loaded."))
                        .font(.body).fixedSize(horizontal: false, vertical: true)
                    Button { attempt += 1 } label: {
                        Text(language.text("Reload review"))
                            .frame(minHeight: 44).contentShape(Rectangle())
                    }
                        .font(.subheadline.weight(.medium))
                        .accessibilityIdentifier("conversation-memory-reload")
                }
                .accessibilityIdentifier("conversation-memory-unavailable")
            } else {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small).accessibilityHidden(true)
                    Text(language.text("Loading contact review…"))
                        .font(.footnote).foregroundStyle(Color.tsMutedInk)
                }
                .frame(minHeight: 44)
            }
        }
        .task(id: "\(attempt)|\(reviewScope?.bindingKey ?? "unavailable")") {
            failed = false
            do {
                guard let reviewScope else { throw ConversationMemoryReviewError.invalidScope }
                let current = try await workspaceStore.memoryReviewClient()
                try Task.checkCancellation()
                client = try current.forReviewScope(reviewScope)
            } catch is CancellationError { }
            catch { client = nil; failed = true }
        }
        .sheet(item: $selectedSource) { source in
            if let index = source.index, let manifest = source.manifest {
                ConversationMemorySourceImage(language: language) {
                    try await workspaceStore.loadConversationImage(sessionID: sessionID,
                        messageID: source.messageID, index: index, manifest: manifest)
                }
            } else if let text = source.text {
                NavigationStack {
                    ScrollView { Text(text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(20) }
                        .navigationTitle(language.text("Source"))
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .confirmationAction) {
                            Button(language.text("Done")) { selectedSource = nil }
                        } }
                }
            }
        }
        .alert(language.text("Source unavailable"), isPresented: $sourceUnavailable) {
            Button(language.text("Done"), role: .cancel) {}
        } message: {
            Text(language.text("Reopen the conversation to check its current source."))
        }
    }
}

private struct ConversationMemorySourceImage: View {
    let language: AppLanguage
    let load: () async throws -> ChatMediaContent
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var failed = false
    @State private var attempt = 0

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if let image {
                    ZoomableCaptureImage(image: image)
                        .accessibilityIdentifier("conversation-original-image")
                } else if failed {
                    VStack(spacing: 12) {
                        Text(language.text("The original image could not be loaded."))
                        Button { attempt += 1 } label: {
                            Text(language.text("Try again"))
                                .frame(minHeight: 44).contentShape(Rectangle())
                        }
                    }.foregroundStyle(.white).padding(24)
                } else { ProgressView().tint(.white) }
            }
            .navigationTitle(language.text("Original image"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(language.text("Done")) { dismiss() } } }
            .task(id: attempt) {
                failed = false
                do {
                    let content = try await load()
                    try Task.checkCancellation()
                    guard let decoded = UIImage(data: content.data) else { throw ImageConversationError.invalidReadback }
                    image = decoded
                } catch is CancellationError { }
                catch { failed = true }
            }
        }
    }
}
