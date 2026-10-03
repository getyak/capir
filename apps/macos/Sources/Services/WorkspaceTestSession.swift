#if DEBUG
import Foundation

/// Seeds a synthetic session into the app's own per-origin web store so the
/// ordinary Web conversation can be exercised on the real surface.
///
/// This exists for the UI-test harness only. It never runs in a release build
/// (`#if DEBUG`) and it never contains credentials of its own: the value has to
/// be supplied by the harness environment as a cookie specification, so the app
/// gains no production sign-in bypass and no hard-coded account.
enum WorkspaceTestSession {
    /// `name=<cookie>;value=<value>;domain=<host>;path=/[;secure=true]`
    static func cookieSpec(from environment: String?, origin: WorkspaceOrigin,
                           arguments: [String]) -> HTTPCookie? {
        guard arguments.contains("--web-workspace-testing"),
              origin.url.scheme == "http",
              ["127.0.0.1", "localhost", "::1"].contains(origin.url.host ?? "") else { return nil }
        guard let environment, !environment.isEmpty else { return nil }
        var fields: [String: String] = [:]
        for field in environment.split(separator: ";") {
            let trimmed = field.trimmingCharacters(in: .whitespaces)
            guard let separator = trimmed.firstIndex(of: "=") else { continue }
            let key = trimmed[trimmed.startIndex..<separator].lowercased()
            fields[key] = String(trimmed[trimmed.index(after: separator)...])
        }
        guard let name = fields["name"], name == "talent-signal.session-v2",
              let value = fields["value"], !value.isEmpty,
              let domain = fields["domain"], domain == origin.url.host,
              let path = fields["path"], path == "/",
              fields["secure"] != "true" else { return nil }
        let properties: [HTTPCookiePropertyKey: Any] = [
            .name: name,
            .value: value,
            .domain: domain,
            .path: path,
        ]
        return HTTPCookie(properties: properties)
    }

    /// The harness variable the UI tests fill in from their own environment.
    static let cookieEnvironmentKey = "TS_TEST_SESSION_COOKIE"
}
#endif
