import XCTest
import Sparkle
@testable import TalentSignalMac

@MainActor
final class DesktopUpdateSessionTests: XCTestCase {
    func testDiscoveryWaitsForOneExplicitClickThenRelaunchesWithoutAnotherDecision() {
        let session = DesktopUpdateSession()
        var choices: [SPUUserUpdateChoice] = []
        session.configure(); session.checking()
        session.offer(version: "0.2 (12)", verified: true, informationOnly: false) { choices.append($0) }
        XCTAssertTrue(choices.isEmpty)
        XCTAssertTrue(session.state.canInstall)
        session.install(offerID: session.state.offerID); session.install(offerID: session.state.offerID)
        XCTAssertEqual(choices, [.install])
        session.extracting()
        session.ready { choices.append($0) }
        XCTAssertEqual(choices, [.install, .install])
        XCTAssertEqual(session.state.phase, .installing)
    }
    func testCheckBeforeDiscoveryNeverPreauthorizesTheLaterVersion() {
        let session = DesktopUpdateSession()
        session.configure(); session.checking(); session.install(offerID: session.state.offerID)
        var choices: [SPUUserUpdateChoice] = []
        session.offer(version: "2", verified: true, informationOnly: false) { choices.append($0) }
        XCTAssertTrue(choices.isEmpty)
        session.ready { choices.append($0) }
        XCTAssertEqual(choices, [.skip])
    }
    func testUnsignedAndInformationalItemsCannotBecomeInstallable() {
        for (verified, information) in [(false, false), (true, true)] {
            let session = DesktopUpdateSession()
            var choices: [SPUUserUpdateChoice] = []
            session.offer(version: "2", verified: verified, informationOnly: information) { choices.append($0) }
            session.install(offerID: session.state.offerID)
            XCTAssertFalse(session.state.canInstall)
            XCTAssertNil(session.state.version)
            XCTAssertEqual(choices, [.dismiss])
        }
    }
    func testFailureRevokesConsentAndStaleReadyCallbackCannotRestart() {
        let session = DesktopUpdateSession()
        session.offer(version: "2", verified: true, informationOnly: false) { _ in }
        session.install(offerID: session.state.offerID); session.fail(); session.dismiss()
        XCTAssertEqual(session.state.phase, .failed)
        session.ready { XCTAssertEqual($0, .skip) }
        session.downloadProgress(50)
        XCTAssertEqual(session.state.phase, .failed)
        session.checking()
        var choices: [SPUUserUpdateChoice] = []
        session.offer(version: "3", verified: true, informationOnly: false) { choices.append($0) }
        XCTAssertTrue(choices.isEmpty)
    }
    func testDuplicateOfferDoesNotReplaceTheVersionTheUserSaw() {
        let session = DesktopUpdateSession()
        var original: [SPUUserUpdateChoice] = []
        session.offer(version: "2", verified: true, informationOnly: false) { original.append($0) }
        session.offer(version: "3", verified: true, informationOnly: false) { XCTAssertEqual($0, .dismiss) }
        XCTAssertEqual(session.state.version, "2")
        session.install(offerID: session.state.offerID)
        XCTAssertEqual(original, [.install])
    }
    func testExpiredOfferTokenCannotAuthorizeAReplacementUpdate() {
        let session = DesktopUpdateSession()
        session.offer(version: "2", verified: true, informationOnly: false) { _ in }
        let oldOffer = session.state.offerID
        session.fail()
        var choices: [SPUUserUpdateChoice] = []
        session.offer(version: "3", verified: true, informationOnly: false) { choices.append($0) }
        session.install(offerID: oldOffer)
        session.install(offerID: nil)
        XCTAssertTrue(choices.isEmpty)
        XCTAssertEqual(session.state.version, "3")
        session.install(offerID: session.state.offerID)
        session.ready { choices.append($0) }
        session.ready { choices.append($0) }
        XCTAssertEqual(choices, [.install, .install, .skip])
    }
    func testProgressRequiresConsentAndClampsInvalidLengthEstimates() {
        let session = DesktopUpdateSession()
        session.downloadProgress(70)
        XCTAssertNil(session.state.progress)
        session.offer(version: "2", verified: true, informationOnly: false) { _ in }
        session.install(offerID: session.state.offerID); session.downloadProgress(140)
        XCTAssertEqual(session.state.progress, 100)
        session.downloadProgress(-1)
        XCTAssertEqual(session.state.progress, 0)
        session.extracting(); session.downloadProgress(40)
        XCTAssertNil(session.state.progress)
    }
    func testDownloadedOfferResumesInstallationOnlyAfterItsOwnClick() {
        let session = DesktopUpdateSession()
        var choices: [SPUUserUpdateChoice] = []
        session.offer(version: "2", verified: true, informationOnly: false, stage: .downloaded) { choices.append($0) }
        XCTAssertTrue(choices.isEmpty)
        session.install(offerID: session.state.offerID)
        XCTAssertEqual(session.state.phase, .installing)
        XCTAssertEqual(choices, [.install])
    }
    func testUnverifiedCheckNeverClaimsLatestOrAdvancesVerifiedCheckTime() {
        let session = DesktopUpdateSession()
        session.noUpdate(status: "当前已是最新版本", verified: false)
        XCTAssertEqual(session.state.phase, .failed)
        XCTAssertNil(session.state.lastChecked)
        XCTAssertFalse(session.state.status.contains("最新"))
        session.noUpdate(status: "新版本暂不支持这台 Mac", verified: true)
        XCTAssertEqual(session.state.phase, .idle)
        XCTAssertNotNil(session.state.lastChecked)
        XCTAssertEqual(session.state.status, "新版本暂不支持这台 Mac")
    }
    func testStatusProducersUseTheMainBundleLanguageAndKeepDynamicValues() throws {
        func text(_ key: String) -> String { Bundle.main.localizedString(forKey: key, value: key, table: nil) }
        let session = DesktopUpdateSession()
        XCTAssertEqual(session.state.status, text("Signed updates are not enabled in this preview"))
        session.configure()
        XCTAssertEqual(session.state.status, text("New versions appear at the lower left"))
        session.checking()
        XCTAssertEqual(session.state.status, text("Checking for updates…"))
        var choices: [SPUUserUpdateChoice] = []
        session.offer(version: "0.2.41 (212)", verified: true, informationOnly: false) { choices.append($0) }
        XCTAssertEqual(session.state.status, String(format: text("%@ is available. Click to update and restart"), "0.2.41 (212)"))
        XCTAssertTrue(choices.isEmpty)
        session.install(offerID: UUID())
        XCTAssertTrue(choices.isEmpty)
        session.install(offerID: session.state.offerID)
        XCTAssertEqual(choices, [.install])
        XCTAssertEqual(session.state.status, text("Downloading update…"))
        for (input, expected) in [(-1, 0), (37, 37), (140, 100)] {
            session.downloadProgress(input)
            XCTAssertEqual(session.state.status, String(format: text("Downloading update %lld%%"), Int64(expected)))
        }
        session.downloadProgress(nil)
        XCTAssertEqual(session.state.status, text("Downloading update…"))
        session.extracting()
        XCTAssertEqual(session.state.status, text("Verifying and preparing the update…"))
        session.ready { choices.append($0) }
        XCTAssertEqual(session.state.status, text("Updating and restarting…"))
        session.waitingForQuit()
        XCTAssertEqual(session.state.status, text("Waiting for the app to quit. If quitting was cancelled, try restarting again."))
        session.dismiss()
        XCTAssertEqual(session.state.status, text("Update ended. You can check for updates again"))
        session.fail()
        XCTAssertEqual(session.state.status, text("The update could not be completed. Your current version remains usable. Check for updates again."))
        session.ready { choices.append($0) }
        XCTAssertEqual(choices, [.install, .install, .skip])
    }

    func testVerificationAndInformationStatusesRemainLocalizedWithoutGrantingConsent() {
        func text(_ key: String) -> String { Bundle.main.localizedString(forKey: key, value: key, table: nil) }
        let session = DesktopUpdateSession()
        session.offer(version: "2", verified: false, informationOnly: false) { XCTAssertEqual($0, .dismiss) }
        XCTAssertEqual(session.state.status, text("Update information failed signature verification. Your current version remains usable."))
        session.noUpdate(status: "synthetic status", verified: false)
        XCTAssertEqual(session.state.status, text("Update information could not be verified. Your current version remains usable. Try again later."))
        XCTAssertNil(session.state.lastChecked)
        session.offer(version: "2", verified: true, informationOnly: true) { XCTAssertEqual($0, .dismiss) }
        XCTAssertEqual(session.state.status, text("A release announcement is available in the release history. It contains no installable update."))
        XCTAssertNil(session.state.offerID)
        XCTAssertFalse(session.state.canInstall)
        let downloaded = DesktopUpdateSession()
        downloaded.offer(version: "2", verified: true, informationOnly: false, stage: .downloaded) { XCTAssertEqual($0, .install) }
        downloaded.install(offerID: downloaded.state.offerID)
        XCTAssertEqual(downloaded.state.status, text("Updating and restarting…"))
    }

}
