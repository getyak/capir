import AppKit

/// The only account-management destinations the native app may hand to the
/// default browser. Every case maps to an existing allowlisted Web Settings
/// section, so a caller can never smuggle in an arbitrary destination string.
enum AccountSettingsDestination: String, CaseIterable, Identifiable {
    case overview, account, appearance, connections

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: "个人资料"
        case .account: "账号与安全"
        case .appearance: "外观与偏好"
        case .connections: "连接与权限"
        }
    }

    /// Builds `/workspace/settings` plus the fixed section query from the
    /// already validated configured origin. No identity, token, email or
    /// account identifier is ever placed in the handoff URL.
    func url(in origin: WorkspaceOrigin) -> URL {
        var parts = URLComponents(url: origin.url.appendingPathComponent("workspace/settings"),
                                  resolvingAgainstBaseURL: false)!
        if self != .overview {
            parts.queryItems = [URLQueryItem(name: "section", value: rawValue)]
        }
        return parts.url!
    }
}

/// Asks the operating system to open an approved account destination in the
/// user's default browser. It is a thin, testable seam: it never probes the
/// Web, never embeds a WebView and never claims the page loaded.
@MainActor
final class AccountSettingsBrowser {
    static let shared = AccountSettingsBrowser()

    private let openURL: (URL) -> Bool

    init(openURL: @escaping (URL) -> Bool = { NSWorkspace.shared.open($0) }) {
        self.openURL = openURL
    }

    /// Returns only the OS acceptance of the launch request. `false` means the
    /// launch failed or no origin is configured; it is never a product claim.
    @discardableResult
    func open(_ destination: AccountSettingsDestination, in origin: WorkspaceOrigin?) -> Bool {
        guard let origin else { return false }
        let url = destination.url(in: origin)
        // Defence in depth: the constructed URL must stay on the trusted origin
        // and on the fixed settings path before the OS sees it.
        guard origin.contains(url), url.path == "/workspace/settings" else { return false }
        return openURL(url)
    }
}
