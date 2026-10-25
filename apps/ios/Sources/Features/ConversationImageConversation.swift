import CryptoKit
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

enum ImageConversationError: LocalizedError, Equatable {
    case invalidInput, persistence, replyPersistence, changedIntent, invalidReadback, unknown, stopped
    var errorDescription: String? {
        switch self {
        case .invalidInput: return "Check the image question and attachments. Nothing was sent."
        case .persistence: return "The image question could not be protected. Nothing was sent."
        case .replyPersistence: return "The image reply could not be saved. Check its original message before continuing."
        case .changedIntent: return "Check the original image question before sending another message."
        case .invalidReadback: return "The image reply could not be matched to its original message."
        case .unknown: return "Image delivery is unconfirmed. The original message is kept. Check and retry; reattach the same images if needed."
        case .stopped: return "Image processing stopped. Its original message has not been sent again."
        }
    }

    static func recoveryMessage(for error: Error, admissionAttempted: Bool, admissionConfirmed: Bool = false) -> String {
        if admissionConfirmed, (error as? ImageConversationError) == .unknown {
            return "The image was received, but its reply status could not be checked. Check reply again."
        }
        if let imageError = error as? ImageConversationError {
            if imageError == .persistence, admissionAttempted {
                return ImageConversationError.replyPersistence.errorDescription!
            }
            return imageError.errorDescription!
        }
        if admissionConfirmed {
            return "The image was received, but its reply status could not be checked. Check reply again."
        }
        if let requestError = error as? ConversationImageRequestError, case let .http(status) = requestError {
            if status >= 500 {
                return "Image sending encountered a server error. Delivery is unconfirmed. Check and retry the original message."
            }
            return "The server refused this image request. Check the original message and images, then retry."
        }
        return admissionAttempted ? ImageConversationError.unknown.errorDescription!
            : "The Session could not be synced. Try again."
    }
}

/// One geometry rule for pending and authenticated source previews.
struct ConversationImagePresentation: Equatable {
    let width: CGFloat
    let height: CGFloat
    let isLong: Bool

    static func layout(imageSize: CGSize, availableWidth: CGFloat, isMultiple: Bool = false) -> Self {
        let safeWidth = availableWidth.isFinite && availableWidth > 0 ? availableWidth : 280
        let aspect = imageSize.width.isFinite && imageSize.height.isFinite
            && imageSize.width > 0 && imageSize.height > 0 ? imageSize.width / imageSize.height : 1
        let isLong = aspect < 0.65
        let maxWidth = min(safeWidth, isMultiple ? 180 : (isLong ? 280 : 310))
        let maxHeight: CGFloat = isMultiple ? 220 : 340
        let height = min(maxHeight, maxWidth / aspect)
        return Self(width: isLong ? maxWidth : height * aspect, height: height, isLong: isLong)
    }

    static func hasMessage(_ text: String) -> Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    static func neighbor(of index: Int, offset: Int, count: Int) -> Int? {
        guard count > 0, (0..<count).contains(index) else { return nil }
        let target = index + offset
        return (0..<count).contains(target) ? target : nil
    }
}

/// The fixed surface owns layout. The full-size image is drawing content only;
/// neither its intrinsic height nor its unclipped accessibility bounds may
/// expand the preview's button. The parent supplies the image's accessible action.
struct ConversationImageBoundedPreview: View {
    let image: UIImage
    let layout: ConversationImagePresentation

    var body: some View {
        Rectangle()
            .fill(Color.tsSurfaceMuted)
            .frame(width: layout.width, height: layout.height)
            .overlay(alignment: .top) {
                Image(uiImage: image)
                    .resizable().scaledToFill()
                    .frame(width: layout.width, height: layout.height, alignment: .top)
            }
            .clipped()
            .accessibilityHidden(true)
    }
}

/// Local previews are presentation only. The authenticated original replaces
/// them only after byte identity and decode checks, and only in the same binding.
@MainActor
final class ConversationImageAlbumModel: ObservableObject {
    @Published private(set) var images: [UUID: UIImage]
    @Published private(set) var verified: Set<UUID> = []
    @Published private(set) var failures: Set<UUID> = []
    @Published private(set) var loading: Set<UUID> = []
    private var messageID: UUID
    private var manifests: [ConversationImageManifest]
    private var requests: [UUID: UUID] = [:]

    init(messageID: UUID, manifests: [ConversationImageManifest], initialImages: [UUID: UIImage] = [:]) {
        self.messageID = messageID; self.manifests = manifests
        images = initialImages.filter { key, _ in manifests.contains { $0.attachmentID == key } }
    }

    func configure(messageID: UUID, manifests: [ConversationImageManifest], initialImages: [UUID: UIImage]) {
        guard self.messageID != messageID || self.manifests != manifests else { return }
        self.messageID = messageID; self.manifests = manifests
        requests = [:]; verified = []; failures = []; loading = []
        images = initialImages.filter { key, _ in manifests.contains { $0.attachmentID == key } }
    }

    func load(messageID: UUID, index: Int, manifest: ConversationImageManifest,
        using loader: () async throws -> ChatMediaContent, onAuthenticatedLoad: ((UUID) -> Void)? = nil) async {
        let id = manifest.attachmentID
        guard self.messageID == messageID, manifests.indices.contains(index), manifests[index] == manifest,
              !verified.contains(id), requests[id] == nil else { return }
        let token = UUID(); requests[id] = token; loading.insert(id); failures.remove(id)
        defer {
            if requests[id] == token { requests.removeValue(forKey: id); loading.remove(id) }
        }
        do {
            try Task.checkCancellation()
            let content = try await loader()
            try Task.checkCancellation()
            guard self.messageID == messageID, requests[id] == token, manifests.indices.contains(index),
                  manifests[index] == manifest else { return }
            guard content.mediaType == manifest.mediaType, content.data.count == manifest.byteSize,
                  SHA256.hash(data: content.data).map({ String(format: "%02x", $0) }).joined() == manifest.contentHash,
                  let decoded = UIImage(data: content.data) else { throw ImageConversationError.invalidReadback }
            images[id] = decoded; verified.insert(id); failures.remove(id)
            onAuthenticatedLoad?(id)
        } catch {
            guard !Task.isCancelled, self.messageID == messageID, requests[id] == token else { return }
            failures.insert(id)
        }
    }
}

@MainActor
struct ConversationImageAlbum: View {
    let messageID: UUID
    let images: [ConversationImageManifest]
    var initialImages: [UUID: UIImage] = [:]
    let load: (Int, ConversationImageManifest) async throws -> ChatMediaContent
    var onAuthenticatedLoad: ((UUID) -> Void)? = nil
    @Environment(\.appLanguage) private var language
    @StateObject private var model: ConversationImageAlbumModel
    @State private var availableWidth: CGFloat = 310
    @State private var selectedIndex: Int?

    init(messageID: UUID, images: [ConversationImageManifest], initialImages: [UUID: UIImage] = [:],
        load: @escaping (Int, ConversationImageManifest) async throws -> ChatMediaContent,
        onAuthenticatedLoad: ((UUID) -> Void)? = nil) {
        self.messageID = messageID; self.images = images; self.initialImages = initialImages
        self.load = load; self.onAuthenticatedLoad = onAuthenticatedLoad
        _model = StateObject(wrappedValue: ConversationImageAlbumModel(messageID: messageID, manifests: images, initialImages: initialImages))
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if images.count == 1, let manifest = images.first {
                tile(index: 0, manifest: manifest)
            } else if !images.isEmpty {
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: 8) {
                        ForEach(Array(images.enumerated()), id: \.element.attachmentID) { index, manifest in
                            tile(index: index, manifest: manifest)
                        }
                    }
                }
                .scrollIndicators(.hidden)
                Text(String(images.count) + " · " + language.text("Images"))
                    .font(.caption).foregroundStyle(Color.tsMutedInk)
            }
        }
        .frame(maxWidth: 310, alignment: .trailing)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { availableWidth = max(1, $0) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversation-image-album-\(messageID.uuidString.lowercased())")
        .sheet(isPresented: Binding(get: { selectedIndex != nil }, set: { if !$0 { selectedIndex = nil } })) {
            ConversationImageViewer(messageID: messageID, manifests: images, initialImages: initialImages,
                model: model, selection: Binding(get: { selectedIndex ?? 0 }, set: { selectedIndex = $0 }),
                load: load, onAuthenticatedLoad: onAuthenticatedLoad, onClose: { selectedIndex = nil })
        }
    }

    private func tile(index: Int, manifest: ConversationImageManifest) -> some View {
        ConversationImageTile(messageID: messageID, index: index, total: images.count,
            manifest: manifest, manifests: images, initialImages: initialImages, availableWidth: availableWidth,
            model: model, load: { try await load(index, manifest) },
            onAuthenticatedLoad: onAuthenticatedLoad, onOpen: { selectedIndex = index })
    }
}

@MainActor
private struct ConversationImageTile: View {
    let messageID: UUID
    let index: Int
    let total: Int
    let manifest: ConversationImageManifest
    let manifests: [ConversationImageManifest]
    let initialImages: [UUID: UIImage]
    let availableWidth: CGFloat
    @ObservedObject var model: ConversationImageAlbumModel
    let load: () async throws -> ChatMediaContent
    let onAuthenticatedLoad: ((UUID) -> Void)?
    let onOpen: () -> Void
    @Environment(\.appLanguage) private var language
    @State private var attempt = 0
    private var image: UIImage? { model.images[manifest.attachmentID] }
    private var failed: Bool { model.failures.contains(manifest.attachmentID) }
    private var layout: ConversationImagePresentation {
        .layout(imageSize: image?.size ?? CGSize(width: 1, height: 1), availableWidth: availableWidth, isMultiple: total > 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onOpen) {
                ZStack(alignment: .bottom) {
                    Color.tsSurfaceMuted
                    if let image {
                        ConversationImageBoundedPreview(image: image, layout: layout)
                        if layout.isLong {
                            LinearGradient(colors: [.clear, .black.opacity(0.25)], startPoint: .top, endPoint: .bottom)
                                .frame(height: 32)
                        }
                    } else if !failed {
                        ProgressView().accessibilityLabel(language.text("Loading image…"))
                    } else {
                        Image(systemName: "photo.badge.exclamationmark").foregroundStyle(Color.tsMutedInk)
                    }
                }
                .frame(width: layout.width, height: layout.height)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(image == nil)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(language.text("Image") + " \(index + 1) " + language.text("of") + " \(total)")
            .accessibilityHint(language.text("View full image"))
            .accessibilityIdentifier("conversation-image-\(messageID.uuidString.lowercased())-\(index)")
            if failed {
                Button { attempt += 1 } label: {
                    Label(language.text("Retry loading image"), systemImage: "arrow.clockwise")
                        .font(.caption).frame(maxWidth: .infinity, minHeight: 44)
                }
                .accessibilityIdentifier("conversation-image-retry-\(index)")
            } else if layout.isLong || total > 1 {
                HStack(spacing: 6) {
                    Text((layout.isLong ? language.text("Long image") + " · " + language.text("View full image") : language.text("Image"))
                        + (total > 1 ? " · \(index + 1)/\(total)" : ""))
                    Spacer(minLength: 4)
                    Image(systemName: "arrow.up.left.and.arrow.down.right").accessibilityHidden(true)
                }
                .font(.caption).foregroundStyle(Color.tsMutedInk)
                .padding(.horizontal, 10).frame(minHeight: 36)
                .accessibilityHidden(true)
            }
        }
        .frame(width: layout.width)
        .background(Color.tsSurfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 16).stroke(Color.tsLine, lineWidth: 0.5) }
        .task(id: "\(messageID):\(manifest.attachmentID):\(manifest.contentHash):\(attempt)") {
            model.configure(messageID: messageID, manifests: manifests, initialImages: initialImages)
            await model.load(messageID: messageID, index: index, manifest: manifest, using: load,
                onAuthenticatedLoad: onAuthenticatedLoad)
        }
    }
}

@MainActor
private struct ConversationImageViewer: View {
    let messageID: UUID
    let manifests: [ConversationImageManifest]
    let initialImages: [UUID: UIImage]
    @ObservedObject var model: ConversationImageAlbumModel
    @Binding var selection: Int
    let load: (Int, ConversationImageManifest) async throws -> ChatMediaContent
    let onAuthenticatedLoad: ((UUID) -> Void)?
    let onClose: () -> Void
    @Environment(\.appLanguage) private var language
    @State private var attempt = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TabView(selection: $selection) {
                    ForEach(Array(manifests.enumerated()), id: \.element.attachmentID) { index, manifest in
                        page(index: index, manifest: manifest).tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                if manifests.count > 1 {
                    HStack {
                        navigation(offset: -1, key: "Previous image", symbol: "chevron.left")
                        Spacer()
                        Text("\(selection + 1) " + language.text("of") + " \(manifests.count)").monospacedDigit()
                        Spacer()
                        navigation(offset: 1, key: "Next image", symbol: "chevron.right")
                    }
                    .font(.subheadline).foregroundStyle(.white).padding(.horizontal, 20).padding(.bottom, 8)
                }
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle(language.text("Original image"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(language.text("Done"), action: onClose) } }
        }
    }

    private func page(index: Int, manifest: ConversationImageManifest) -> some View {
        ZStack {
            if let image = model.images[manifest.attachmentID] {
                ZoomableCaptureImage(image: image)
                    .id(manifest.attachmentID)
                    .accessibilityLabel(language.text("Image") + " \(index + 1) " + language.text("of") + " \(manifests.count)")
                    .accessibilityIdentifier("conversation-original-image")
            }
            if model.failures.contains(manifest.attachmentID) {
                VStack(spacing: 8) {
                    Text(language.text("Original image could not be loaded"))
                    Button(language.text("Retry")) { attempt += 1 }.frame(minHeight: 44)
                }
                .font(.subheadline).foregroundStyle(.white).padding(16)
                .background(.black.opacity(0.76), in: RoundedRectangle(cornerRadius: 14))
            } else if !model.verified.contains(manifest.attachmentID) {
                ProgressView(language.text("Loading original…"))
                    .tint(.white).foregroundStyle(.white).padding(16)
                    .background(.black.opacity(0.76), in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .task(id: "\(messageID):\(manifest.attachmentID):\(manifest.contentHash):\(attempt)") {
            model.configure(messageID: messageID, manifests: manifests, initialImages: initialImages)
            await model.load(messageID: messageID, index: index, manifest: manifest,
                using: { try await load(index, manifest) }, onAuthenticatedLoad: onAuthenticatedLoad)
        }
    }

    private func navigation(offset: Int, key: String, symbol: String) -> some View {
        Button {
            if let next = ConversationImagePresentation.neighbor(of: selection, offset: offset, count: manifests.count) { selection = next }
        } label: { Image(systemName: symbol).frame(width: 44, height: 44) }
        .disabled(ConversationImagePresentation.neighbor(of: selection, offset: offset, count: manifests.count) == nil)
        .accessibilityLabel(language.text(key))
    }
}
