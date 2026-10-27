import AppKit
import Combine
import Sparkle

struct DesktopUpdateConfiguration {
    static let productionFeed = "https://github.com/getyak/talent-signal/releases/download/macos-updates/appcast.xml"

    static func isValid(feed: String, publicKey: String, allowsLocalFeed: Bool = false) -> Bool {
        guard let key = Data(base64Encoded: publicKey), key.count == 32 else { return false }
        if feed == productionFeed { return true }
        #if DEBUG
        if allowsLocalFeed, let url = URL(string: feed), url.scheme == "http", url.host == "127.0.0.1",
           url.user == nil, url.password == nil, url.query == nil, url.fragment == nil { return true }
        #endif
        return false
    }
}

@MainActor
final class DesktopUpdater: NSObject, ObservableObject, SPUUpdaterDelegate, SPUUserDriver {
    static let shared = DesktopUpdater()
    @Published private(set) var presentation = DesktopUpdatePresentation()
    @Published private(set) var canCheck = false
    @Published private(set) var sessionInProgress = false
    @Published private(set) var canRetryRelaunch = false
    @Published var automaticChecks = false {
        didSet {
            if started, updater.automaticallyChecksForUpdates != automaticChecks {
                updater.automaticallyChecksForUpdates = automaticChecks
            }
        }
    }
    @Published var includesPreview = UserDefaults.standard.bool(forKey: "workspace.updates.preview") {
        didSet { UserDefaults.standard.set(includesPreview, forKey: "workspace.updates.preview") }
    }
    private let session = DesktopUpdateSession()
    private var started = false
    private var verifiedFeed = false
    private var expectedBytes: UInt64 = 0
    private var receivedBytes: UInt64 = 0
    private var retryQuit: (() -> Void)?
    private lazy var updater = SPUUpdater(hostBundle: .main, applicationBundle: .main,
                                         userDriver: self, delegate: self)
    override init() {
        super.init()
        session.onChange = { [weak self] state in self?.presentation = state }
    }
    var availableVersion: String? { presentation.version }
    var status: String { presentation.status }
    var isConfigured: Bool {
        var rehearsal = false
        #if DEBUG
        rehearsal = Bundle.main.object(forInfoDictionaryKey: "TalentSignalUpdateRehearsal") as? Bool == true
        #endif
        return DesktopUpdateConfiguration.isValid(
            feed: Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String ?? "",
            publicKey: Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String ?? "",
            allowsLocalFeed: rehearsal)
    }
    var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
        return "\(version) (\(build))"
    }
    func start() {
        guard !started, isConfigured, !ProcessInfo.processInfo.arguments.contains("--ui-testing") else { return }
        updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheck)
        updater.publisher(for: \.sessionInProgress).assign(to: &$sessionInProgress)
        do {
            try updater.start()
            started = true
            automaticChecks = updater.automaticallyChecksForUpdates
            updater.automaticallyDownloadsUpdates = false
            session.configure()
            if automaticChecks { updater.checkForUpdatesInBackground() }
        } catch { session.fail(String(localized: "Update checking could not start. Your current version remains usable. Reopen the app and try again.", bundle: .main)) }
    }
    /// A generic check never consents to a version that has not been shown yet.
    func checkForUpdates() {
        start()
        guard started, canCheck, !presentation.canInstall, !presentation.busy else { return }
        verifiedFeed = false; session.checking(); updater.checkForUpdates()
    }
    func installUpdate(offerID: UUID) { session.install(offerID: offerID) }
    func retryRelaunch() { retryQuit?() }
    func allowedChannels(for updater: SPUUpdater) -> Set<String> { includesPreview ? ["preview"] : [] }
    func updater(_ updater: SPUUpdater, didFinishLoading appcast: SUAppcast) {
        verifiedFeed = appcast.signingValidationStatus == .succeeded
    }
    func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
        handle(error)
    }
    private func handle(_ error: Error) {
        let value = error as NSError
        if value.domain == SUSparkleErrorDomain, value.code == SUError.noUpdateError.rawValue {
            let reason = (value.userInfo[SPUNoUpdateFoundReasonKey] as? NSNumber)?.intValue
            let message: String
            switch reason {
            case Int(SPUNoUpdateFoundReason.onLatestVersion.rawValue): message = String(localized: "You are up to date", bundle: .main)
            case Int(SPUNoUpdateFoundReason.onNewerThanLatestVersion.rawValue): message = String(localized: "Your version is newer than the update source", bundle: .main)
            case Int(SPUNoUpdateFoundReason.systemIsTooOld.rawValue), Int(SPUNoUpdateFoundReason.systemIsTooNew.rawValue), Int(SPUNoUpdateFoundReason.hardwareDoesNotSupportARM64.rawValue):
                message = String(localized: "The new version does not support this Mac yet. Your current version remains usable", bundle: .main)
            default: message = String(localized: "No applicable update was found", bundle: .main)
            }
            session.noUpdate(status: message, verified: verifiedFeed)
        } else { session.fail() }
        retryQuit = nil; canRetryRelaunch = false
    }

    // Custom user driver follows Sparkle 2.10 callbacks. Only session.install()
    // grants consent; ready() continues that same decision without another dialog.
    // https://sparkle-project.org/documentation/api-reference/Protocols/SPUUserDriver.html
    func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) {
        reply(SUUpdatePermissionResponse(automaticUpdateChecks: automaticChecks,
                                        automaticUpdateDownloading: false, sendSystemProfile: false))
    }
    func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) { session.checking() }
    func showUpdateFound(with appcastItem: SUAppcastItem, state: SPUUserUpdateState,
                         reply: @escaping (SPUUserUpdateChoice) -> Void) {
        session.offer(version: "\(appcastItem.displayVersionString) (\(appcastItem.versionString))",
                      verified: appcastItem.signingValidationStatus == .succeeded,
                      informationOnly: appcastItem.isInformationOnlyUpdate, stage: state.stage, reply: reply)
    }
    func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}
    func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {}
    func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) {
        handle(error); acknowledgement()
    }
    func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) {
        handle(error); acknowledgement()
    }
    func showDownloadInitiated(cancellation: @escaping () -> Void) {
        expectedBytes = 0; receivedBytes = 0; session.downloadProgress(nil)
    }
    func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
        expectedBytes = expectedContentLength; publishDownloadProgress()
    }
    func showDownloadDidReceiveData(ofLength length: UInt64) {
        let sum = receivedBytes.addingReportingOverflow(length)
        receivedBytes = sum.overflow ? UInt64.max : sum.partialValue
        publishDownloadProgress()
    }
    private func publishDownloadProgress() {
        session.downloadProgress(expectedBytes > 0 ? Int(min(100, Double(receivedBytes) / Double(expectedBytes) * 100)) : nil)
    }
    func showDownloadDidStartExtractingUpdate() { session.extracting() }
    func showExtractionReceivedProgress(_ progress: Double) {}
    func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) { session.ready(reply: reply) }
    func showInstallingUpdate(withApplicationTerminated applicationTerminated: Bool,
                             retryTerminatingApplication: @escaping () -> Void) {
        retryQuit = applicationTerminated ? nil : retryTerminatingApplication
        canRetryRelaunch = !applicationTerminated
        if !applicationTerminated { session.waitingForQuit() }
    }
    func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
        session.dismiss(); acknowledgement()
    }
    func dismissUpdateInstallation() {
        session.dismiss(); retryQuit = nil; canRetryRelaunch = false
    }
    func showUpdateInFocus() { NSApp.activate(ignoringOtherApps: true) }
}
