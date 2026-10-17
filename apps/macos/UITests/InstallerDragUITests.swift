import AppKit
import CryptoKit
import XCTest

/// Separate from first-run regressions: only a real Finder drag may create the app.
final class InstallerDragUITests: XCTestCase {
    private func manifest(_ root: URL) throws -> [String: String] {
        let keys: [URLResourceKey] = [.isRegularFileKey, .isSymbolicLinkKey, .isDirectoryKey]
        var enumerationError: Error?
        guard let entries = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys, options: [],
            errorHandler: { _, error in enumerationError = error; return false }) else {
            throw CocoaError(.fileNoSuchFile)
        }
        var result: [String: String] = [:]
        for case let url as URL in entries {
            let values = try url.resourceValues(forKeys: Set(keys))
            let relative = String(url.path.dropFirst(root.path.count + 1))
            if values.isSymbolicLink == true {
                result[relative] = "symlink:" + (try FileManager.default.destinationOfSymbolicLink(atPath: url.path))
            } else if values.isRegularFile == true {
                result[relative] = SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
            } else if values.isDirectory != true {
                throw CocoaError(.fileReadUnknown)
            }
        }
        if let enumerationError { throw enumerationError }
        return result
    }

    @MainActor
    func testActualFinderDragInstallsTheUnchangedBundle() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard env["CAPIR_INSTALLER_DISPOSABLE_HOST"] == "1", let mount = env["CAPIR_INSTALLER_MOUNT"], !mount.isEmpty else {
            throw XCTSkip("Use installer-drag-acceptance.sh only on a disposable hosted Mac.")
        }
        let source = URL(fileURLWithPath: mount).appendingPathComponent("Talent Signal.app")
        let destination = URL(fileURLWithPath: "/Applications/Talent Signal.app")
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path), "Never overwrite an installed app.")
        XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: mount + "/Applications"), "/Applications")
        let expected = try manifest(source)
        XCTAssertFalse(expected.isEmpty)
        let finder = XCUIApplication(bundleIdentifier: "com.apple.finder")
        finder.activate()
        let window = finder.windows["Talent Signal"]
        XCTAssertTrue(window.waitForExistence(timeout: 15), "Open the real mounted installer, not a staging directory.")
        defer {
            let text = XCTAttachment(string: finder.debugDescription)
            text.name = "actual-finder-final-AX"; text.lifetime = .keepAlways; add(text)
            // Finder's application AX root can have an empty frame even while
            // the real installer window/icons are visible and hittable.
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = "actual-finder-after-drag"; screenshot.lifetime = .keepAlways; add(screenshot)
        }
        // Finder exposes file icons as icons or images depending on the OS build.
        let appIcon = window.icons["Talent Signal"].exists ? window.icons["Talent Signal"] : window.images["Talent Signal"]
        let applications = window.icons["Applications"].exists ? window.icons["Applications"] : window.images["Applications"]
        XCTAssertTrue(appIcon.waitForExistence(timeout: 5)); XCTAssertTrue(applications.waitForExistence(timeout: 5))
        XCTAssertTrue(appIcon.isHittable); XCTAssertTrue(applications.isHittable)
        let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        before.name = "actual-finder-before-drag"; before.lifetime = .keepAlways; add(before)
        let beforeAX = XCTAttachment(string: finder.debugDescription)
        beforeAX.name = "actual-finder-before-AX"; beforeAX.lifetime = .keepAlways; add(beforeAX)
        let sourceFrame = NSStringFromRect(appIcon.frame), targetFrame = NSStringFromRect(applications.frame)
        appIcon.click(forDuration: 1.0, thenDragTo: applications)
        let complete = XCTNSPredicateExpectation(predicate: NSPredicate { [self] _, _ in
            (try? manifest(destination)) == expected
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [complete], timeout: 45), .completed,
                       "The real drag must create every unchanged bundle file; shell Copy is not a fallback.")
        XCTAssertEqual(try manifest(destination), expected)
        let bundle = try XCTUnwrap(Bundle(url: destination))
        let executable = try XCTUnwrap(bundle.executableURL)
        let hash = SHA256.hash(data: try Data(contentsOf: executable)).map { String(format: "%02x", $0) }.joined()
        let receipt: [String: Any] = ["actualFinderDrag": true, "sourceApp": source.path,
            "installedApp": destination.path, "sourceIconFrame": sourceFrame, "applicationsIconFrame": targetFrame,
            "matchingFilesAndSymlinks": expected.count, "installedExecutableSHA256": hash,
            "identifier": bundle.bundleIdentifier ?? "", "version": bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "build": bundle.infoDictionary?["CFBundleVersion"] as? String ?? ""]
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]),
                                       uniformTypeIdentifier: "public.json")
        attachment.name = "actual-finder-drag-install-identity"; attachment.lifetime = .keepAlways; add(attachment)
    }
}
