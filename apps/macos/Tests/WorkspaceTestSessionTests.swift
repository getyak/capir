import XCTest
@testable import TalentSignalMac

/// The harness session seed must stay narrow: no value, no cookie; it can never
/// invent one, and it never marks a loopback cookie as secure.
final class WorkspaceTestSessionTests: XCTestCase {
    private let origin = WorkspaceOrigin("http://127.0.0.1:4404", allowLocalDevelopment: true)!
    private let testingArguments = ["TalentSignalMac", "--web-workspace-testing"]

    func testSpecIsParsedFromTheHarnessValue() {
        let cookie = WorkspaceTestSession.cookieSpec(
            from: "name=talent-signal.session-v2;value=abc.def.ghi;domain=127.0.0.1;path=/",
            origin: origin, arguments: testingArguments)
        XCTAssertEqual(cookie?.name, "talent-signal.session-v2")
        XCTAssertEqual(cookie?.value, "abc.def.ghi")
        XCTAssertEqual(cookie?.domain, "127.0.0.1")
        XCTAssertEqual(cookie?.path, "/")
        XCTAssertFalse(cookie?.isSecure ?? true)
    }

    func testOnlyExplicitLoopbackTestLaunchCanSeedItsOwnOrigin() {
        let cookie = WorkspaceTestSession.cookieSpec(
            from: "NAME=talent-signal.session-v2;VALUE=b;Domain=127.0.0.1;Path=/",
            origin: origin, arguments: testingArguments)
        XCTAssertEqual(cookie?.value, "b")
        XCTAssertNil(WorkspaceTestSession.cookieSpec(
            from: "name=talent-signal.session-v2;value=b;domain=127.0.0.1;path=/",
            origin: origin, arguments: ["TalentSignalMac"]))
        XCTAssertNil(WorkspaceTestSession.cookieSpec(
            from: "name=talent-signal.session-v2;value=b;domain=example.test;path=/",
            origin: origin, arguments: testingArguments))
        XCTAssertNil(WorkspaceTestSession.cookieSpec(
            from: "name=other;value=b;domain=127.0.0.1;path=/",
            origin: origin, arguments: testingArguments))
        XCTAssertNil(WorkspaceTestSession.cookieSpec(
            from: "name=talent-signal.session-v2;value=b;domain=127.0.0.1;path=/",
            origin: WorkspaceOrigin("https://example.test")!, arguments: testingArguments))
    }

    func testIncompleteValuesNeverProduceACookie() {
        for spec in [nil, "", "name=a;value=b", "name=a;value=b;domain=;path=/",
                     "value=b;domain=host;path=/", "name=talent-signal.session-v2;value=b;domain=127.0.0.1;path=/other",
                     "name=talent-signal.session-v2;value=b;domain=127.0.0.1;path=/;secure=true"] {
            XCTAssertNil(WorkspaceTestSession.cookieSpec(from: spec, origin: origin,
                                                          arguments: testingArguments))
        }
    }

    /// Values may contain `=` (base64 padding), so only the first separator counts.
    func testValueMayContainEqualsSigns() {
        let cookie = WorkspaceTestSession.cookieSpec(
            from: "name=talent-signal.session-v2;value=a=b=c;domain=127.0.0.1;path=/",
            origin: origin, arguments: testingArguments)
        XCTAssertEqual(cookie?.value, "a=b=c")
    }
}
