import SwiftUI
import UIKit

struct AskMediaDraft: Identifiable {
    enum Phase: Equatable {
        case waitingForContext
        case uploading
        case ready
        case failed(String)
        case removing
    }

    let id: UUID
    let data: Data
    let preview: UIImage
    let fileName: String
    let mediaType: String
    let width: Int
    let height: Int
    var remoteAsset: ChatMediaAsset?
    var phase: Phase

    var readyMediaID: String? {
        phase == .ready ? remoteAsset?.id : nil
    }
}

enum AskImageConversationRoute: Equatable {
    case notApplicable
    case conversation
    case unsupported
}

enum AskImageConversationRoutingPolicy {
    private static let supportedMediaTypes: Set<String> = [
        "image/jpeg", "image/png", "image/webp",
    ]

    static func route(
        hasSelectedRelationship: Bool,
        mediaTypes: [String]
    ) -> AskImageConversationRoute {
        guard !mediaTypes.isEmpty else { return .notApplicable }
        // A relationship scope does not turn an image question into intake.
        _ = hasSelectedRelationship
        guard mediaTypes.count <= 10,
              mediaTypes.allSatisfy(supportedMediaTypes.contains) else {
            return .unsupported
        }
        return .conversation
    }
}

struct AskMediaDraftTray: View {
    let drafts: [AskMediaDraft]
    let onRetry: (UUID) -> Void
    let onRemove: (UUID) -> Void
    @Environment(\.talentSignalReduceTransparency) private var reduceTransparency
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                ForEach(drafts) { draft in
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: draft.preview)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 74, height: 74)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                            .overlay {
                                RoundedRectangle(cornerRadius: 14)
                                    .stroke(Color.tsLine, lineWidth: 1)
                            }

                        phaseOverlay(draft)

                        Button {
                            onRemove(draft.id)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(Color.tsSurface)
                                .frame(width: 28, height: 28)
                                .background(Color.tsInk.opacity(0.86), in: Circle())
                                .frame(width: 44, height: 44)
                                .contentShape(Rectangle())
                        }
                        .disabled(draft.phase == .removing)
                        .offset(x: 14, y: -14)
                        .accessibilityLabel(
                            appLanguage.text("Remove image") + " \(draft.fileName)"
                        )
                    }
                    .padding(.top, 7)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("ask-media-draft-\(draft.id.uuidString.lowercased())")
                }
            }
            .padding(.horizontal, 3)
        }
        .scrollIndicators(.hidden)
        .accessibilityLabel(appLanguage.text("Task images, not evidence"))
        .accessibilityIdentifier("ask-media-draft-tray")
    }

    @ViewBuilder
    private func phaseOverlay(_ draft: AskMediaDraft) -> some View {
        switch draft.phase {
        case .waitingForContext:
            EmptyView()
        case .uploading, .removing:
            ProgressView()
                .tint(.white)
                .frame(width: 74, height: 74)
                .background(Color.black.opacity(0.34), in: RoundedRectangle(cornerRadius: 14))
                .accessibilityLabel(
                    draft.phase == .removing
                        ? appLanguage.text("Removing image")
                        : appLanguage.text("Uploading image")
                )
        case .ready:
            Image(systemName: "checkmark.circle.fill")
                .font(.title3)
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, Color.green)
                .padding(6)
                .accessibilityLabel(appLanguage.text("Upload complete"))
        case .failed:
            Button {
                onRetry(draft.id)
            } label: {
                VStack(spacing: 3) {
                    Image(systemName: "arrow.clockwise")
                    Text(appLanguage.text("Retry"))
                        .font(.caption2.weight(.semibold))
                }
                .foregroundStyle(.white)
                .frame(width: 74, height: 74)
                .background(Color.black.opacity(0.58), in: RoundedRectangle(cornerRadius: 14))
            }
            .accessibilityLabel(
                appLanguage.text("Retry") + " \(draft.fileName)"
            )
        }
    }
}

struct ChatMediaAlbumBubble: View {
    let media: [ChatMediaAsset]
    let load: (String) async throws -> ChatMediaContent

    @State private var selectedPreview: ChatMediaPreview?
    @Environment(\.appLanguage) private var appLanguage

    private var visibleMedia: [ChatMediaAsset] { Array(media.prefix(4)) }
    private var rowCount: CGFloat { media.count <= 2 ? 1 : 2 }
    private var bubbleHeight: CGFloat { media.count == 1 ? 224 : (media.count == 2 ? 164 : 226) }

    var body: some View {
        GeometryReader { geometry in
            let gap: CGFloat = 3
            let columns: CGFloat = media.count == 1 ? 1 : 2
            let tileWidth = (geometry.size.width - gap * (columns - 1)) / columns
            let tileHeight = (bubbleHeight - gap * (rowCount - 1)) / rowCount

            ZStack(alignment: .topLeading) {
                ForEach(Array(visibleMedia.enumerated()), id: \.element.id) { index, asset in
                    let column = media.count == 1 ? 0 : index % 2
                    let row = media.count <= 2 ? 0 : index / 2
                    ChatMediaTile(
                        asset: asset,
                        index: index,
                        total: media.count,
                        remainder: index == 3 ? max(0, media.count - 4) : 0,
                        load: load,
                        onOpen: { image in
                            selectedPreview = ChatMediaPreview(asset: asset, image: image)
                        }
                    )
                    .frame(width: tileWidth, height: tileHeight)
                    .offset(
                        x: CGFloat(column) * (tileWidth + gap),
                        y: CGFloat(row) * (tileHeight + gap)
                    )
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: bubbleHeight)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.tsLine, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            appLanguage.text("Media album") + ", \(media.count) "
                + appLanguage.text("task images, not evidence")
        )
        .accessibilityIdentifier("ask-media-album")
        .sheet(item: $selectedPreview) { preview in
            NavigationStack {
                ZStack {
                    Color.black.ignoresSafeArea()
                    ZoomableCaptureImage(image: preview.image)
                        .accessibilityLabel(preview.asset.fileName)
                }
                .navigationTitle(preview.asset.fileName)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            selectedPreview = nil
                        } label: {
                            Text(appLanguage.text("Done"))
                        }
                    }
                }
            }
        }
    }
}

private struct ChatMediaPreview: Identifiable {
    let asset: ChatMediaAsset
    let image: UIImage
    var id: String { asset.id }
}

private struct ChatMediaTile: View {
    let asset: ChatMediaAsset
    let index: Int
    let total: Int
    let remainder: Int
    let load: (String) async throws -> ChatMediaContent
    let onOpen: (UIImage) -> Void

    @State private var image: UIImage?
    @State private var loadedAssetID: String?
    @State private var failedAssetID: String?
    @State private var attempt = 0
    @Environment(\.appLanguage) private var appLanguage
    private var displayedImage: UIImage? { loadedAssetID == asset.id ? image : nil }
    private var failed: Bool { failedAssetID == asset.id }

    var body: some View {
        ZStack {
            Button {
                if let displayedImage { onOpen(displayedImage) }
            } label: {
                ZStack {
                    Color.tsCanvas
                    if let displayedImage {
                        Image(uiImage: displayedImage).resizable().scaledToFill()
                    } else if failed {
                        Image(systemName: "photo.badge.exclamationmark")
                            .font(.title2).foregroundStyle(Color.tsMutedInk)
                    } else { ProgressView() }
                    if remainder > 0 {
                        Color.black.opacity(0.52)
                        Text(verbatim: "+\(remainder)").font(.title.weight(.semibold)).foregroundStyle(.white)
                    }
                }
                .clipped().contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(displayedImage == nil)
            if failed {
                Button { attempt += 1 } label: {
                    Label(appLanguage.text("Retry loading image"), systemImage: "arrow.clockwise")
                        .font(.caption).frame(minHeight: 44).padding(.horizontal, 8)
                        .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 10))
                }
                .accessibilityIdentifier("ask-media-retry-\(index)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            appLanguage.text("Image") + " \(index + 1) "
                + appLanguage.text("of") + " \(total), \(asset.fileName)"
        )
        .accessibilityValue(
            remainder > 0
                ? "\(remainder) \(appLanguage.text("more images"))"
                : ""
        )
        .accessibilityHint(appLanguage.text("Opens the stored task image"))
        .accessibilityIdentifier("ask-media-album-item-\(index)")
        .task(id: "\(asset.id):\(attempt)") {
            failedAssetID = nil
            do {
                let content = try await load(asset.id)
                try Task.checkCancellation()
                guard let decoded = UIImage(data: content.data) else { throw ImageConversationError.invalidReadback }
                image = decoded; loadedAssetID = asset.id
            } catch {
                guard !Task.isCancelled else { return }
                failedAssetID = asset.id
            }
        }
    }
}
