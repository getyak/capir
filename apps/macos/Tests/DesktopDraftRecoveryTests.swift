import XCTest
import WebKit
@testable import TalentSignalMac

final class DesktopDraftRecoveryTests: XCTestCase {
    @MainActor
    func testSuspendedReadSettlesAndIgnoresLateCompletion() async {
        var late: ((String?) -> Void)?
        let result = await DesktopDraftScriptRead.read(timeout: .milliseconds(1)) { late = $0 }
        XCTAssertNil(result)
        late?("late private text")
        let next = await DesktopDraftScriptRead.read { $0("current text") }
        XCTAssertEqual(next, "current text")
    }

    func testDraftKeepsOriginalExpiryAndRejectsOversizedOrExpiredContent() throws {
        let now = Date()
        let valid = DesktopDraftRecovery.Draft(value: "Synthetic text", updatedAt: ISO8601DateFormatter().string(from: now),
                                               expiresAt: now.addingTimeInterval(60).timeIntervalSince1970 * 1000, writer: "writer")
        let encoded = try XCTUnwrap(String(data: JSONEncoder().encode(valid), encoding: .utf8))
        XCTAssertEqual(DesktopDraftRecovery.readDraft(encoded, now: now)?.expiresAt, valid.expiresAt)
        XCTAssertNil(DesktopDraftRecovery.readDraft(encoded, now: now.addingTimeInterval(61)))
        for value in ["", String(repeating: "🙂", count: 6_001)] {
            let rejected = DesktopDraftRecovery.Draft(value: value, updatedAt: valid.updatedAt, expiresAt: valid.expiresAt, writer: "writer")
            XCTAssertFalse(rejected.valid(at: now))
        }
        XCTAssertFalse(DesktopDraftRecovery.Draft(value: "text", updatedAt: "wrong", expiresAt: valid.expiresAt, writer: "writer").valid(at: now))
        XCTAssertFalse(DesktopDraftRecovery.Draft(value: "text", updatedAt: valid.updatedAt,
            expiresAt: now.addingTimeInterval(90_000).timeIntervalSince1970 * 1000, writer: "writer").valid(at: now))
    }

    func testLocatorIsOneExactUUIDRatherThanAStorageInventory() {
        let id = "11111111-1111-4111-8111-111111111111"
        XCTAssertEqual(DesktopDraftRecovery.sessionID(in: URL(string: "https://web.test/workspace?draft_session=\(id)")!), id)
        XCTAssertEqual(DesktopDraftRecovery.sessionID(in: URL(string: "https://web.test/workspace/sessions/\(id)")!), id)
        for suffix in ["workspace", "workspace?draft_session=wrong", "workspace?draft_session=\(id)&draft_session=\(id)", "workspace/people/\(id)"] {
            XCTAssertNil(DesktopDraftRecovery.sessionID(in: URL(string: "https://web.test/\(suffix)")!))
        }
    }

    func testOwnerRequiresAuthenticatedUnexpiredServerSchema() throws {
        let object: [String: Any] = ["status":"authenticated", "accountID":"11111111-1111-4111-8111-111111111111",
            "userID":"22222222-2222-4222-8222-222222222222", "storageScope":String(repeating:"a",count:64),
            "expiresAt":ISO8601DateFormatter().string(from: Date().addingTimeInterval(300))]
        func text(_ object: [String: Any]) throws -> String { String(data: try JSONSerialization.data(withJSONObject: object), encoding: .utf8)! }
        XCTAssertNotNil(DesktopDraftRecovery.readOwner(try text(object)))
        for (key, value) in [("status","unauthenticated"),("accountID","wrong"),("storageScope","dom-scope"),("expiresAt","2000-01-01T00:00:00Z")] {
            var rejected = object; rejected[key] = value
            XCTAssertNil(DesktopDraftRecovery.readOwner(try text(rejected)))
        }
    }

    @MainActor
    func testActualIsolatedWebKitDraftReadRestoreConflictAndPartialWrite() async throws {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        let probe = DraftNavigationProbe()
        let loaded = expectation(description: "owned in-memory recovery document")
        probe.finished = { loaded.fulfill() }
        view.navigationDelegate = probe
        view.loadHTMLString("<!doctype html><title>synthetic draft recovery</title>", baseURL: URL(string: "https://draft.test")!)
        await fulfillment(of: [loaded], timeout: 15)
        defer { view.stopLoading(); view.navigationDelegate = nil }
        let scope = String(repeating: "a", count: 64), session = UUID().uuidString.lowercased()
        let draft = DesktopDraftRecovery.Draft(value: "synthetic text 🙂", updatedAt: ISO8601DateFormatter().string(from: Date()),
            expiresAt: Date().addingTimeInterval(300).timeIntervalSince1970 * 1000, writer: "fixture")
        let value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft))
        let arguments: [String: Any] = ["scope": scope, "session": session, "value": value, "home": true]
        let restored = try await view.callAsyncJavaScript(DesktopDraftRecovery.restoreScript, arguments: arguments,
            in: nil, contentWorld: DesktopDraftRecovery.world)
        XCTAssertEqual(restored as? Bool, true)
        let exported = try await view.callAsyncJavaScript(DesktopDraftRecovery.readScript,
            arguments: ["scope": scope, "session": session], in: nil, contentWorld: DesktopDraftRecovery.world)
        let decoded = DesktopDraftRecovery.readDraft(try XCTUnwrap(exported as? String))
        XCTAssertEqual(decoded?.value, draft.value); XCTAssertEqual(decoded?.expiresAt, draft.expiresAt)

        var conflicting = arguments
        conflicting["value"] = ["value": "another unsent draft", "updatedAt": draft.updatedAt,
            "expiresAt": draft.expiresAt, "writer": "different"] as [String: Any]
        do {
            _ = try await view.callAsyncJavaScript(DesktopDraftRecovery.restoreScript, arguments: conflicting,
                in: nil, contentWorld: DesktopDraftRecovery.world)
            XCTFail("A different live draft must never be overwritten")
        } catch { }
        let preserved = try await view.callAsyncJavaScript(DesktopDraftRecovery.readScript,
            arguments: ["scope": scope, "session": session], in: nil, contentWorld: DesktopDraftRecovery.world)
        XCTAssertEqual(DesktopDraftRecovery.readDraft(try XCTUnwrap(preserved as? String))?.value, draft.value)

        // Inject a Home-pointer storage failure in this isolated test world.
        _ = try await view.callAsyncJavaScript("""
        localStorage.clear();
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.endsWith(':home')) throw new DOMException('synthetic quota failure','QuotaExceededError');
          return original.call(this,key,value);
        };
        return true;
        """, arguments: [:], in: nil, contentWorld: DesktopDraftRecovery.world)
        do {
            _ = try await view.callAsyncJavaScript(DesktopDraftRecovery.restoreScript, arguments: arguments,
                in: nil, contentWorld: DesktopDraftRecovery.world)
            XCTFail("Partial restore must not claim complete readback")
        } catch { }
        let partial = try await view.callAsyncJavaScript(DesktopDraftRecovery.readScript,
            arguments: ["scope": scope, "session": session], in: nil, contentWorld: DesktopDraftRecovery.world)
        XCTAssertEqual(DesktopDraftRecovery.readDraft(try XCTUnwrap(partial as? String))?.value, draft.value)
        withExtendedLifetime(probe) {}
    }
}

@MainActor
private final class DraftNavigationProbe: NSObject, WKNavigationDelegate {
    var finished: (() -> Void)?
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finished?() }
}
