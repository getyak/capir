import Foundation

/// A support draft may be handed to the OS only after the existing native
/// confirmation. Never accept arbitrary recipients, bodies or mail headers.
enum WorkspaceSupportHandoff {
    static func allows(_ target: URL, sourceIsTrusted: Bool,
                       mainFrame: Bool, userActivated: Bool) -> Bool {
        guard sourceIsTrusted, mainFrame, userActivated,
              target.scheme == "mailto", target.host == nil,
              target.user == nil, target.password == nil, target.port == nil,
              target.fragment == nil,
              let parts = URLComponents(url: target, resolvingAgainstBaseURL: false),
              parts.path == "hello@talentsignal.ai" else { return false }
        let items = parts.queryItems ?? []
        guard items.count <= 1 else { return false }
        if let item = items.first {
            guard item.name == "subject", let subject = item.value,
                  subject.count <= 200,
                  subject.rangeOfCharacter(from: .controlCharacters) == nil else { return false }
        }
        return true
    }
}
