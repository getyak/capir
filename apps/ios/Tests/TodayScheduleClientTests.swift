import XCTest
@testable import TalentSignal

@MainActor
final class TodayScheduleClientTests: XCTestCase {
    final class ScriptedProtocol: URLProtocol, @unchecked Sendable {
        static let lock = NSLock()
        static var status = 200
        static var body = Data()
        static var observed: URLRequest?
        static func script(_ value: [String: Any], status: Int = 200) throws {
            lock.lock(); defer { lock.unlock() }
            self.body = try JSONSerialization.data(withJSONObject: value)
            self.status = status; observed = nil
        }
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            Self.lock.lock(); Self.observed = request; let data = Self.body, status = Self.status; Self.lock.unlock()
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["content-type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
        override func stopLoading() {}
    }

    private let id = UUID(uuidString: "00000000-0000-4000-8000-000000000001")!
    private let scope = TodayScheduleScope(from: "2026-10-18", to: "2026-10-25", timeZone: "Asia/Shanghai")
    private func client() -> TodayScheduleClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ScriptedProtocol.self]
        return .init(baseURL: URL(string: "https://example.invalid")!, bearerToken: "synthetic-read-only", session: URLSession(configuration: configuration))
    }
    private func page(_ patch: [String: Any] = [:]) -> [String: Any] {
        var wire: [String: Any] = ["contract_version": TalentSignalAPIContract.version,
            "scope": ["from": scope.from, "to": scope.to, "time_zone": scope.timeZone, "kind": "schedule"],
            "activities": [], "complete": true, "next_cursor": NSNull(),
            "snapshot_at": "2026-10-18T02:00:00Z", "coverage_note": "Current range"]
        wire.merge(patch) { _, new in new }; return wire
    }
    private func record(_ patch: [String: Any] = [:]) -> [String: Any] {
        var row: [String: Any] = ["id": id.uuidString, "revision": 3, "status": "planned", "content_available": true,
            "title": "Fresh user arrangement", "starts_at": "2026-10-18T03:00:00Z", "ends_at": "2026-10-18T04:00:00Z",
            "time_zone": "Asia/Shanghai", "all_day": false, "authority": "user_authored", "external_effect": "none"]
        row.merge(patch) { _, new in new }; return ["contract_version": TalentSignalAPIContract.version, "schedule": row]
    }

    func testRealClientUsesOnlyBoundAuthenticatedMetadataGETWithExplicitScopeAndDeadline() async throws {
        try ScriptedProtocol.script(page())
        _ = try await client().list(scope: scope, after: "opaque-cursor")
        let request = try XCTUnwrap(ScriptedProtocol.observed)
        XCTAssertEqual(request.url?.path, "/v1/time/activities")
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: query.map { ($0.name, $0.value!) }),
                       ["from": "2026-10-18", "to": "2026-10-25", "time_zone": "Asia/Shanghai", "kind": "schedule", "after": "opaque-cursor"])
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertNil(request.httpBody)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-read-only")
        XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertEqual(request.timeoutInterval, 15)
    }

    func testUnknownContractScopeChangeAndIncompleteWithoutCursorAreRejected() async throws {
        for wire in [page(["contract_version": "future"]),
                     page(["scope": ["from": scope.from, "to": scope.to, "time_zone": "UTC", "kind": "schedule"]]),
                     page(["complete": false])] {
            try ScriptedProtocol.script(wire)
            do { _ = try await client().list(scope: scope, after: nil); XCTFail("Invalid metadata was admitted") }
            catch TodayScheduleError.invalidResponse { }
        }
    }

    func testRevokedCredentialIsNotAnEmptyCalendar() async throws {
        try ScriptedProtocol.script(["error": "unauthorized"], status: 401)
        do { _ = try await client().list(scope: scope, after: nil); XCTFail("Revocation was admitted") }
        catch TodayScheduleError.unavailable(let status) { XCTAssertEqual(status, 401) }
    }

    func testDetailReadsExactSourceAgainWithoutWriteOrCalendarEffect() async throws {
        try ScriptedProtocol.script(record())
        let fresh = try await client().read(id: id)
        XCTAssertEqual(fresh.id, id); XCTAssertEqual(fresh.revision, 3)
        XCTAssertEqual(fresh.authority, "user_authored"); XCTAssertEqual(fresh.externalEffect, "none")
        XCTAssertEqual(ScriptedProtocol.observed?.url?.path, "/v1/time/schedules/\(id.uuidString.lowercased())")
        XCTAssertEqual(ScriptedProtocol.observed?.httpMethod, "GET")
        XCTAssertNil(ScriptedProtocol.observed?.httpBody)
    }

    func testWrongIdentityAndInventedExecutionAuthorityFailClosed() async throws {
        for patch: [String: Any] in [["id": UUID().uuidString], ["authority": "unconfirmed"], ["external_effect": "sent"]] {
            try ScriptedProtocol.script(record(patch))
            do { _ = try await client().read(id: id); XCTFail("Foreign or ungoverned detail admitted") }
            catch TodayScheduleError.invalidResponse { }
        }
    }
}
