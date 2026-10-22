import Foundation
import SwiftUI
import UIKit

/// Device-local recovery identity. Bytes stay in the selected attachment until
/// admitted; history retains only governed metadata and authenticated readback.
struct PendingImageConversation: Codable, Equatable {
    enum State: String, Codable, Equatable { case prepared, admitted, unknown, stopped }
    let messageID: UUID
    let idempotencyKey: String
    let objective: String
    let images: [ConversationImageManifest]
    let createdAt: Date
    let timeZone: String
    var queueEntryID: UUID?
    var state: State

    func matches(objective: String, images incoming: [ConversationImageManifest]) -> Bool {
        self.objective == objective && images.count == incoming.count
            && zip(images, incoming).allSatisfy { before, after in
                before.contentHash == after.contentHash && before.mediaType == after.mediaType
                    && before.byteSize == after.byteSize && before.fileName == after.fileName
            }
    }
}

enum ImageConversationReadback: Equatable { case completed, waiting, stopped, unknown }

enum ImageConversationError: LocalizedError {
    case persistence, changedIntent, invalidReadback, unknown, stopped
    var errorDescription: String? {
        switch self {
        case .persistence: return "The image question could not be protected. Nothing was sent."
        case .changedIntent: return "Check the original image question before sending another message."
        case .invalidReadback: return "The image reply could not be matched to its original message."
        case .unknown: return "The image question may still be processing. Check its reply without sending it again."
        case .stopped: return "Image processing stopped. Its original message has not been sent again."
        }
    }
}

struct ConversationImageAlbum: View {
    let messageID: UUID
    let images: [ConversationImageManifest]
    let load: (Int, ConversationImageManifest) async throws -> ChatMediaContent
    @Environment(\.appLanguage) private var language

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(Array(images.enumerated()), id: \.element.attachmentID) { index, manifest in
                    ConversationImageTile(messageID: messageID, index: index,
                        manifest: manifest, load: { try await load(index, manifest) })
                }
            }
        }
        .frame(height: 180)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversation-image-album-\(messageID.uuidString.lowercased())")
    }
}

private struct ConversationImageTile: View {
    let messageID: UUID
    let index: Int
    let manifest: ConversationImageManifest
    let load: () async throws -> ChatMediaContent
    @Environment(\.appLanguage) private var language
    @State private var image: UIImage?
    @State private var failed = false
    @State private var showOriginal = false

    var body: some View {
        Button { if image != nil { showOriginal = true } } label: {
            ZStack {
                Color.tsCanvas
                if let image { Image(uiImage: image).resizable().scaledToFit() }
                else if failed { Image(systemName: "photo.badge.exclamationmark") }
                else { ProgressView() }
            }
            .frame(width: 230, height: 180)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(language.text("Original image") + " \(index + 1)")
        .accessibilityIdentifier("conversation-image-\(messageID.uuidString.lowercased())-\(index)")
        .task(id: manifest.contentHash) {
            do {
                let content = try await load()
                try Task.checkCancellation()
                guard let decoded = UIImage(data: content.data) else { throw ImageConversationError.invalidReadback }
                image = decoded
            } catch is CancellationError { }
            catch { failed = true }
        }
        .sheet(isPresented: $showOriginal) {
            NavigationStack {
                ZStack {
                    Color.black.ignoresSafeArea()
                    if let image {
                        ZoomableCaptureImage(image: image)
                            .accessibilityIdentifier("conversation-original-image")
                    }
                }
                .navigationTitle(language.text("Original image"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbarColorScheme(.dark, for: .navigationBar)
                .toolbar { ToolbarItem(placement: .topBarTrailing) {
                    Button(language.text("Done")) { showOriginal = false }
                } }
            }
        }
    }
}
