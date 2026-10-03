import Social
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        title = StandaloneSharedCaptureConfiguration.isEnabled
            ? "Save Signal Source"
            : "Standalone capture unavailable"
        placeholder = StandaloneSharedCaptureConfiguration.isEnabled
            ? "Optional note about what changed"
            : "Use the signed-in capri app."
    }

    override func isContentValid() -> Bool {
        guard StandaloneSharedCaptureConfiguration.isEnabled else { return false }
        return supportedProvider != nil
            || !contentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    override func didSelectPost() {
        guard StandaloneSharedCaptureConfiguration.isEnabled else {
            extensionContext?.cancelRequest(withError: SharedCaptureInboxError.unavailableInRelease)
            return
        }
        let note = contentText.trimmingCharacters(in: .whitespacesAndNewlines)
        Task { @MainActor in
            do {
                let inbox = try SharedCaptureInbox()
                if let provider = supportedProvider {
                    try await stage(provider: provider, note: note, inbox: inbox)
                } else {
                    _ = try inbox.appendText(note)
                }
                if let url = URL(string: "talentsignal://standalone/share") {
                    _ = await extensionContext?.open(url)
                    extensionContext?.completeRequest(returningItems: nil)
                } else {
                    extensionContext?.completeRequest(returningItems: nil)
                }
            } catch {
                extensionContext?.cancelRequest(withError: error)
            }
        }
    }

    override func configurationItems() -> [Any]! { [] }

    private var supportedProvider: NSItemProvider? {
        extensionContext?.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] }
            .first { provider in
                provider.hasItemConformingToTypeIdentifier(UTType.image.identifier)
                    || provider.hasItemConformingToTypeIdentifier(UTType.url.identifier)
                    || provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
            }
    }

    private func stage(
        provider: NSItemProvider,
        note: String,
        inbox: SharedCaptureInbox
    ) async throws {
        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            let data = try await provider.loadImageData()
            let registeredType = provider.registeredTypeIdentifiers
                .compactMap(UTType.init)
                .first { $0.conforms(to: .image) }
            _ = try inbox.appendImage(
                data: data,
                fileExtension: registeredType?.preferredFilenameExtension ?? "image",
                mediaType: registeredType?.preferredMIMEType ?? "image/*",
                note: note
            )
            return
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            let url = try await provider.loadURL()
            _ = try inbox.appendURL(url, note: note)
            return
        }
        let sharedText = try await provider.loadText()
        _ = try inbox.appendText(sharedText, note: note)
    }

}

private extension NSItemProvider {
    func loadImageData() async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let data, !data.isEmpty {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: SharedCaptureInboxError.emptyPayload)
                }
            }
        }
    }

    func loadURL() async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let url = item as? URL {
                    continuation.resume(returning: url)
                } else if let data = item as? Data,
                          let url = URL(dataRepresentation: data, relativeTo: nil) {
                    continuation.resume(returning: url)
                } else {
                    continuation.resume(throwing: SharedCaptureInboxError.emptyPayload)
                }
            }
        }
    }

    func loadText() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let text = item as? String {
                    continuation.resume(returning: text)
                } else if let text = item as? NSString {
                    continuation.resume(returning: text as String)
                } else if let data = item as? Data,
                          let text = String(data: data, encoding: .utf8) {
                    continuation.resume(returning: text)
                } else {
                    continuation.resume(throwing: SharedCaptureInboxError.emptyPayload)
                }
            }
        }
    }
}
