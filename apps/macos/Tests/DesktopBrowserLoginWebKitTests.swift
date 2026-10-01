import XCTest
import WebKit
@testable import TalentSignalMac

/// Exercises the production anonymous transport, Web Credentials consume, real
/// persistent WK cookie store, navigation delegate and correlated live status.
/// The browser approval below is a disposable backend fixture; this does not
/// replace separate ASWebAuthenticationSession/user-surface acceptance.
@MainActor
final class DesktopBrowserLoginWebKitTests: XCTestCase {
    private struct Fixture: Decodable {
        let web: String; let backend: String; let identifier: String; let password: String
    }
    func testRealWebKitExchangeAndStoreReopen() async throws {
        guard let path = ProcessInfo.processInfo.environment["DESKTOP_LOGIN_WEBKIT_FIXTURE"],
              path.hasPrefix("/private/tmp/ai-test-") else { throw XCTSkip("Explicit owned disposable fixture required") }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        let origin = try XCTUnwrap(WorkspaceOrigin(fixture.web, allowLocalDevelopment: true))
        let backend = try XCTUnwrap(URL(string: fixture.backend))
        XCTAssertEqual(origin.url.scheme, "http"); XCTAssertEqual(origin.url.host, "127.0.0.1")
        XCTAssertEqual(backend.scheme, "http"); XCTAssertEqual(backend.host, "127.0.0.1")
        let registry = LoginStoreRegistry(persistence: MemoryRegistryPersistence(), lockURL: URL(fileURLWithPath: path + ".lock"))
        let selection = try registry.beginFreshPrimaryLogin(for: origin.url.absoluteString)
        let secrets = try DesktopBrowserLoginCoordinator.newSecrets(), transport = DesktopBrowserLoginTransport(origin: origin)
        let prepared = try await transport.prepare(challenge: secrets.challenge, state: secrets.state, cancelSecret: secrets.cancelSecret)
        let login = try await post(backend.appendingPathComponent("v1/auth/password/login"), body: ["identifier": fixture.identifier, "password": fixture.password, "client_label": "Disposable WK proof"])
        let token = try XCTUnwrap(login["access_token"] as? String)
        let approved = try await post(backend.appendingPathComponent("v1/desktop-browser-login/\(prepared.attempt_id)/approve"), body: ["state": secrets.state, "web_origin": origin.url.absoluteString], token: token)
        let operation = DesktopBrowserLoginOperation(attemptID: prepared.attempt_id, state: secrets.state,
            verifier: secrets.verifier, cancelSecret: secrets.cancelSecret, matchingHint: prepared.matching_hint,
            expiresAt: try XCTUnwrap(desktopLoginDate(prepared.expires_at)), selection: selection)
        let grant = try await transport.result(operation: operation)
        let expected = try XCTUnwrap(grant.identity)
        let exchanger = DesktopBrowserLoginWKExchanger(registry: registry)
        let outcome = try await exchanger.exchange(operation: operation, code: try XCTUnwrap(approved["code"] as? String), expected: expected)
        XCTAssertEqual(outcome, expected)
        let committed = try await transport.result(operation: operation)
        XCTAssertTrue(committed.committed); XCTAssertEqual(committed.state, "consumed")
        try registry.resolveLogin(for: selection.origin, epoch: selection.epoch)
        let reopened = DesktopBrowserLoginWKExchanger(registry: registry)
        let second = try await reopened.readStatus(operation: operation, expected: expected)
        XCTAssertEqual(second, expected)
        // A new deliberate login must fence the old native exchanger/store.
        _ = try registry.beginFreshPrimaryLogin(for: selection.origin)
        do { _ = try await reopened.readStatus(operation: operation, expected: expected); XCTFail("Retired store admitted status") }
        catch DesktopBrowserLoginWKExchanger.ExchangeError.storeChanged { }
        // Preserve quarantined stores; fixture database cleanup belongs to its owner.
    }
    private func post(_ url: URL, body: [String: String], token: String? = nil) async throws -> [String: Any] {
        let config = URLSessionConfiguration.ephemeral; config.httpCookieStorage = nil
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url); request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
