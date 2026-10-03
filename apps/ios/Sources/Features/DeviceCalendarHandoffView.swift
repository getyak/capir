import EventKit
import CryptoKit
import SwiftUI

struct DeviceCalendarWriteReceipt: Codable, Equatable {
    let sourceID: String
    let eventIdentifier: String?
    let savedAt: Date
    var savedEvent: DeviceCalendarSavedEvent? = nil
}

private struct CalendarReceiptScopeKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    var calendarReceiptScope: String? {
        get { self[CalendarReceiptScopeKey.self] }
        set { self[CalendarReceiptScopeKey.self] = newValue }
    }
}

struct DeviceCalendarReceiptStore {
    private let attemptDirectory: URL?
    private let legacyDirectory: URL?
    private static let marker = Data("{\"state\":\"pending_or_unknown\"}".utf8)
    private static let retention: TimeInterval = 30 * 86_400

    init(defaults: UserDefaults = .standard, attemptDirectory: URL? = nil, scope: String? = nil) {
        self.legacyDirectory = attemptDirectory == nil ? Self.legacyDirectory : nil
        if attemptDirectory == nil {
            do { try Self.clearLegacyPrivateDetails(defaults: defaults) }
            catch { self.attemptDirectory = nil; return }
        }
        self.attemptDirectory = attemptDirectory ?? scope.map { RuntimeScopedDirectories.directory("CalendarWriteAttempts", scope: $0) }
        try? expirePrivateDetails()

    }

    private static var legacyDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("CalendarWriteAttempts", isDirectory: true)
    }

    /// Legacy ownership cannot be inferred. Retain only content-free duplicate
    /// guards, never migrate candidate details into an arbitrary signed-in account.
    static func clearLegacyPrivateDetails(defaults: UserDefaults = .standard) throws {
        let key = "talent-signal.calendar-handoff-receipts.v1"
        let legacy = DeviceCalendarReceiptStore(attemptDirectory: legacyDirectory)
        if let data = defaults.data(forKey: key) {
            let receipts = try JSONDecoder().decode([String: DeviceCalendarWriteReceipt].self, from: data)
            _ = try legacy.prepareDirectory()
            for sourceID in receipts.keys {
                try protectedWrite(marker, to: legacy.attemptURL(sourceID)!)
            }
            defaults.removeObject(forKey: key)
            guard defaults.data(forKey: key) == nil else { throw CocoaError(.fileWriteUnknown) }
        }
        try legacy.clearPrivateDetails()
    }

    private func attemptURL(_ sourceID: String) -> URL? {
        attemptDirectory?.appendingPathComponent(SHA256.hex(sourceID) + ".json")
    }

    private func prepareDirectory() throws -> URL {
        guard var directory = attemptDirectory else { throw CocoaError(.fileWriteNoPermission) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete])
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: directory.path)
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        return directory
    }

    func hasPendingWrite(for sourceID: String) -> Bool {
        guard let url = attemptURL(sourceID) else { return true } // No authorized owner: fail closed.
        return FileManager.default.fileExists(atPath: url.path) || legacyDirectory.map {
            FileManager.default.fileExists(atPath: $0.appendingPathComponent(SHA256.hex(sourceID) + ".json").path)
        } == true
    }

    /// Only an opaque filename and state exist before EventKit. Never expire
    /// this deduplication marker: an unknown save may have committed.
    func claimWrite(for proposal: DeviceCalendarProposal) throws -> Bool {
        _ = try prepareDirectory()
        guard let url = attemptURL(proposal.sourceID), !hasPendingWrite(for: proposal.sourceID) else { return false }
        try Self.protectedWrite(Self.marker, to: url, exclusive: true)
        return true
    }

    func clearDefiniteNoWrite(for sourceID: String) {
        if let url = attemptURL(sourceID) { try? FileManager.default.removeItem(at: url) }
    }

    func receipt(for sourceID: String, now: Date = Date()) -> DeviceCalendarWriteReceipt? {
        guard let url = attemptURL(sourceID), let data = try? Data(contentsOf: url),
              let saved = try? JSONDecoder().decode(DeviceCalendarWriteReceipt.self, from: data), saved.sourceID == sourceID else { return nil }
        guard now.timeIntervalSince(saved.savedAt) <= Self.retention else {
            try? Self.protectedWrite(Self.marker, to: url)
            return nil
        }
        return saved
    }

    @discardableResult func recordSaved(sourceID: String, eventIdentifier: String?, savedAt: Date = Date(),
                                       savedEvent: DeviceCalendarSavedEvent? = nil) -> Bool {
        do {
            _ = try prepareDirectory()
            guard let url = attemptURL(sourceID) else { return false }
            let receipt = DeviceCalendarWriteReceipt(sourceID: sourceID, eventIdentifier: eventIdentifier, savedAt: savedAt, savedEvent: savedEvent)
            try Self.protectedWrite(JSONEncoder().encode(receipt), to: url)
            return true
        } catch { return false }
    }

    private static func protectedWrite(_ data: Data, to url: URL, exclusive: Bool = false) throws {
        try data.write(to: url, options: exclusive ? [.withoutOverwriting, .completeFileProtection] : [.atomic, .completeFileProtection])
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
    }

    private func expirePrivateDetails(now: Date = Date()) throws {
        guard let directory = attemptDirectory, FileManager.default.fileExists(atPath: directory.path) else { return }
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            where file.pathExtension == "json" {
            if let saved = try? JSONDecoder().decode(DeviceCalendarWriteReceipt.self, from: Data(contentsOf: file)),
               now.timeIntervalSince(saved.savedAt) > Self.retention {
                try Self.protectedWrite(Self.marker, to: file)
            }
        }
    }

    /// Sign-out removes scheduling details while keeping content-free markers
    /// so reopening the same source cannot create a second uncertain event.
    func clearPrivateDetails(savedBefore cutoff: Date = .distantFuture) throws {
        guard let directory = attemptDirectory, FileManager.default.fileExists(atPath: directory.path) else { return }
        _ = try prepareDirectory()
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            where file.pathExtension == "json" {
            if let saved = try? JSONDecoder().decode(DeviceCalendarWriteReceipt.self, from: Data(contentsOf: file)), saved.savedAt > cutoff { continue }
            try Self.protectedWrite(Self.marker, to: file)
        }
    }
}

private enum DeviceCalendarHandoffResult: Equatable {
    case notStarted
    case dismissed
    case syncing
    case failed(String)
    case unknown(String)
    case savedInApp
    case saved(DeviceCalendarWriteReceipt)
}

enum DeviceCalendarSyncFailure: Error, Equatable {
    case permissionDenied
    case noDefaultCalendar
    case eventNotFound
    case unsupportedOS
    case saveFailed(String)
}

@MainActor
protocol DeviceCalendarSyncing: AnyObject {
    func createEvent(from proposal: DeviceCalendarProposal) async
        -> Result<DeviceCalendarSavedEvent, DeviceCalendarSyncFailure>
    func updateEvent(
        eventIdentifier: String,
        from proposal: DeviceCalendarProposal
    ) async -> Result<DeviceCalendarSavedEvent, DeviceCalendarSyncFailure>
}

@MainActor
final class EventKitDeviceCalendarSyncService: DeviceCalendarSyncing {
    private let eventStore: EKEventStore
    private let destinationCalendar: EKCalendar?

    init(eventStore: EKEventStore = EKEventStore(), destinationCalendar: EKCalendar? = nil) {
        self.eventStore = eventStore
        self.destinationCalendar = destinationCalendar
    }

    func createEvent(
        from proposal: DeviceCalendarProposal
    ) async -> Result<DeviceCalendarSavedEvent, DeviceCalendarSyncFailure> {
        guard #available(iOS 17.0, *) else {
            return .failure(.unsupportedOS)
        }
        do {
            guard try await ensureWriteAccess() else {
                return .failure(.permissionDenied)
            }
            guard let destination = destinationCalendar ?? eventStore.defaultCalendarForNewEvents else {
                return .failure(.noDefaultCalendar)
            }

            let event = EKEvent(eventStore: eventStore)
            event.calendar = destination
            event.title = proposal.title
            event.startDate = proposal.startDate
            event.endDate = proposal.endDate
            event.timeZone = TimeZone(identifier: proposal.timeZoneIdentifier)
            try eventStore.save(event, span: .thisEvent, commit: true)
            guard let identifier = event.eventIdentifier, !identifier.isEmpty else {
                return .failure(.saveFailed("Calendar returned no event identifier."))
            }

            return .success(
                DeviceCalendarSavedEvent(
                    identifier: identifier,
                    title: event.title,
                    startDate: event.startDate,
                    endDate: event.endDate,
                    timeZoneIdentifier: event.timeZone?.identifier ?? proposal.timeZoneIdentifier
                )
            )
        } catch {
            return .failure(.saveFailed(error.localizedDescription))
        }
    }

    func updateEvent(
        eventIdentifier: String,
        from proposal: DeviceCalendarProposal
    ) async -> Result<DeviceCalendarSavedEvent, DeviceCalendarSyncFailure> {
        guard #available(iOS 17.0, *) else {
            return .failure(.unsupportedOS)
        }
        do {
            guard try await ensureFullAccess() else {
                return .failure(.permissionDenied)
            }
            guard !eventIdentifier.isEmpty,
                  let event = eventStore.event(withIdentifier: eventIdentifier) else {
                return .failure(.eventNotFound)
            }

            event.title = proposal.title
            event.startDate = proposal.startDate
            event.endDate = proposal.endDate
            event.timeZone = TimeZone(identifier: proposal.timeZoneIdentifier)
            try eventStore.save(event, span: .thisEvent, commit: true)

            let savedIdentifier = event.eventIdentifier ?? eventIdentifier
            guard let readback = eventStore.event(withIdentifier: savedIdentifier),
                  readback.title == proposal.title,
                  readback.startDate == proposal.startDate,
                  readback.endDate == proposal.endDate,
                  readback.timeZone?.identifier == proposal.timeZoneIdentifier else {
                return .failure(
                    .saveFailed("Apple Calendar did not return the updated event.")
                )
            }

            return .success(
                DeviceCalendarSavedEvent(
                    identifier: savedIdentifier,
                    title: readback.title,
                    startDate: readback.startDate,
                    endDate: readback.endDate,
                    timeZoneIdentifier: readback.timeZone?.identifier
                        ?? proposal.timeZoneIdentifier
                )
            )
        } catch {
            return .failure(.saveFailed(error.localizedDescription))
        }
    }

    private func ensureWriteAccess() async throws -> Bool {
        let status = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) {
            switch status {
            case .writeOnly, .fullAccess, .authorized:
                return true
            case .notDetermined:
                return try await eventStore.requestWriteOnlyAccessToEvents()
            case .denied, .restricted:
                return false
            @unknown default:
                return false
            }
        }

        return false
    }

    @available(iOS 17.0, *)
    private func ensureFullAccess() async throws -> Bool {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess, .authorized:
            return true
        case .notDetermined, .writeOnly:
            return try await eventStore.requestFullAccessToEvents()
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }
}

struct DeviceCalendarHandoffView: View {
    @State private var proposal: DeviceCalendarProposal
    private let allowsEditing: Bool

    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AppStorage(CalendarSyncPreference.isEnabledKey)
    private var isCalendarSyncEnabled = true
    @State private var showsEvidence = false
    @State private var result: DeviceCalendarHandoffResult
    @State private var canonicalSaved = false

    @Environment(\.calendarReceiptScope) private var receiptScope
    private let suppliedReceiptStore: DeviceCalendarReceiptStore?
    private var receiptStore: DeviceCalendarReceiptStore { suppliedReceiptStore ?? DeviceCalendarReceiptStore(scope: receiptScope) }
    private let calendarSync: any DeviceCalendarSyncing
    private let activityStore: (any RelationshipCalendarActivityPersisting)?
    private let canonicalActivity: RelationshipCalendarActivity?

    init(
        proposal: DeviceCalendarProposal,
        allowsEditing: Bool = false,
        receiptStore: DeviceCalendarReceiptStore? = nil,
        calendarSync: (any DeviceCalendarSyncing)? = nil,
        activityStore: (any RelationshipCalendarActivityPersisting)? = nil,
        canonicalActivity: RelationshipCalendarActivity? = nil
    ) {
        _proposal = State(initialValue: proposal)
        self.allowsEditing = allowsEditing
        self.suppliedReceiptStore = receiptStore
        self.calendarSync = calendarSync ?? EventKitDeviceCalendarSyncService()
        self.activityStore = activityStore
        self.canonicalActivity = canonicalActivity
        if let receipt = receiptStore?.receipt(for: proposal.sourceID) {
            _result = State(initialValue: .saved(receipt))
        } else if receiptStore?.hasPendingWrite(for: proposal.sourceID) == true {
            _result = State(initialValue: .unknown("Apple Calendar returned an uncertain result. Check Apple Calendar before taking any further action."))
        } else {
            _result = State(initialValue: .notStarted)
        }
    }

    var body: some View {
        Group {
            switch result {
            case .dismissed:
                dismissedContent
            case let .saved(receipt):
                savedContent(receipt)
            case .syncing:
                syncingContent
            case let .failed(message):
                failedContent(message)
            case let .unknown(message):
                unknownContent(message)
            case .savedInApp:
                savedInAppContent
            case .notStarted:
                proposalContent
            }
        }
        .tsCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("device-calendar-handoff")
        .onAppear {
            if let receipt = receiptStore.receipt(for: proposal.sourceID) { result = .saved(receipt) }
            else if receiptStore.hasPendingWrite(for: proposal.sourceID) { result = .unknown(uncertainResultMessage(providerMessage: "")) }
        }
    }

    private var proposalContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: "calendar.badge.plus")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.tsVermilion)
                    .frame(width: 36, height: 36)
                    .background(Color.tsSurfaceMuted, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    SectionLabel(text: appLanguage.text("Agent proposal"))
                    Text(proposal.title)
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                }
                Spacer(minLength: 0)
            }

            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(dateText)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                Text(verbatim: "· \(durationText)")
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
            }
            .accessibilityElement(children: .combine)

            Text(verbatim: proposal.timeZoneIdentifier)
                .font(.caption).foregroundStyle(Color.tsMutedInk)
            if allowsEditing {
                DisclosureGroup(appLanguage.text("Edit")) {
                    TextField(appLanguage.text("Title"), text: Binding(get: { proposal.title }, set: { revise(title: $0) }))
                        .textFieldStyle(.roundedBorder).accessibilityIdentifier("calendar-draft-title")
                    DatePicker(appLanguage.text("Start"), selection: Binding(get: { proposal.startDate }, set: { revise(start: $0) }))
                        .accessibilityIdentifier("calendar-draft-start")
                    DatePicker(appLanguage.text("End time"), selection: Binding(get: { proposal.endDate }, set: { revise(end: $0) }))
                        .accessibilityIdentifier("calendar-draft-end")
                }
                .environment(\.timeZone, TimeZone(identifier: proposal.timeZoneIdentifier) ?? .current)
            }

            HStack(spacing: 8) {
                Label(
                    appLanguage.text("Only title and time"),
                    systemImage: "lock.shield"
                )
                Spacer(minLength: 0)
                Button(
                    appLanguage.text(showsEvidence ? "Hide source" : "View source")
                ) {
                    showsEvidence.toggle()
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.tsVermilion)
                .accessibilityIdentifier("toggle-calendar-evidence")
            }
            .font(.caption)
            .foregroundStyle(Color.tsMutedInk)

            if showsEvidence {
                Text(verbatim: "“\(proposal.evidenceQuote)”")
                    .font(.subheadline)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        Color.tsEvidence,
                        in: RoundedRectangle(cornerRadius: 12)
                    )
                    .accessibilityIdentifier("calendar-proposal-evidence")
            }

            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(spacing: 10) { proposalActions }
                } else {
                    HStack(spacing: 10) { proposalActions }
                }
            }
        }
    }

    @ViewBuilder
    private var proposalActions: some View {
        Button {
            sync()
        } label: {
            Text(appLanguage.text("Confirm"))
        }
        .buttonStyle(TSPrimaryButtonStyle())
        .accessibilityLabel(appLanguage.text("Confirm calendar event"))
        .accessibilityHint(
            appLanguage.text("Saves this event and syncs it to Apple Calendar.")
        )
        .accessibilityIdentifier("add-calendar-proposal")
        .disabled(proposal.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || proposal.title.count > 200
            || proposal.endDate <= proposal.startDate || proposal.endDate.timeIntervalSince(proposal.startDate) > 7 * 86_400)

        Button(role: .destructive) {
            result = .dismissed
        } label: {
            Text(appLanguage.text("Dismiss"))
        }
        .buttonStyle(TSSecondaryButtonStyle())
        .accessibilityLabel(appLanguage.text("Dismiss proposal"))
        .accessibilityIdentifier("dismiss-calendar-proposal")
    }

    private var dismissedContent: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "calendar.badge.minus")
                .foregroundStyle(Color.tsMutedInk)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(appLanguage.text("Calendar proposal dismissed"))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                Text(dateText)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
            }
            Spacer(minLength: 0)
            Button(appLanguage.text("Restore")) {
                result = .notStarted
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.tsVermilion)
            .accessibilityIdentifier("restore-calendar-proposal")
        }
    }

    private var syncingContent: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text(appLanguage.text("Syncing to Calendar…"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.tsInk)
        }
        .accessibilityIdentifier("calendar-syncing")
    }

    private var savedInAppContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(
                appLanguage.text("Saved in capri"),
                systemImage: "checkmark.circle.fill"
            )
                .font(.headline)
                .foregroundStyle(Color.tsConfirmed)
            Text(
                appLanguage.text(
                    "Calendar sync is off. You can change this in Settings."
                )
            )
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
        }
        .accessibilityIdentifier("calendar-saved-in-app")
    }

    private func failedContent(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(
                appLanguage.text(canonicalSaved
                    ? "Saved in capri · Calendar sync failed" : "Calendar sync failed"),
                systemImage: "exclamationmark.shield"
            )
                .font(.headline)
                .foregroundStyle(Color.tsWarning)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
            Button(appLanguage.text("Try Calendar sync again")) {
                sync()
            }
            .buttonStyle(TSSecondaryButtonStyle())
        }
        .accessibilityIdentifier("calendar-sync-failed")
    }

    private func unknownContent(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(
                appLanguage.text("Calendar sync result unknown"),
                systemImage: "questionmark.diamond"
            )
                .font(.headline)
                .foregroundStyle(Color.tsWarning)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityIdentifier("calendar-sync-unknown")
    }

    private func savedContent(
        _ receipt: DeviceCalendarWriteReceipt
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(
                appLanguage.text("Saved to Calendar"),
                systemImage: "checkmark.seal.fill"
            )
            .font(.headline)
            .foregroundStyle(Color.tsConfirmed)
            .accessibilityIdentifier("calendar-saved")
            if let saved = receipt.savedEvent {
            Text(saved.title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.tsInk)
            Text(calendarDateText(saved.startDate, timeZone: saved.timeZoneIdentifier))
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
            Text(calendarDateText(saved.endDate, timeZone: saved.timeZoneIdentifier))
                .font(.subheadline).foregroundStyle(Color.tsMutedInk)
            Text(verbatim: saved.timeZoneIdentifier)
                .font(.caption).foregroundStyle(Color.tsMutedInk)
            }
            if let identifier = receipt.eventIdentifier, !identifier.isEmpty {
                Text(
                    verbatim: "\(appLanguage.text("Receipt")) \(identifier.prefix(8))"
                )
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .accessibilityIdentifier("calendar-save-receipt")
            }
        }
    }

    private var durationMinutes: Int {
        max(1, Int(proposal.endDate.timeIntervalSince(proposal.startDate) / 60))
    }

    private func revise(title: String? = nil, start: Date? = nil, end: Date? = nil) {
        proposal = DeviceCalendarProposal(sourceID: proposal.sourceID, personDisplayName: proposal.personDisplayName,
            title: title ?? proposal.title, startDate: start ?? proposal.startDate, endDate: end ?? proposal.endDate,
            timeZoneIdentifier: proposal.timeZoneIdentifier, evidenceQuote: proposal.evidenceQuote,
            detectedDateText: proposal.detectedDateText, durationWasExplicit: true)
    }

    private var durationText: String {
        let editableSuffix = proposal.durationWasExplicit
            ? ""
            : " · \(appLanguage.text("Editable"))"
        if appLanguage.usesSimplifiedChinese() {
            return "\(durationMinutes) 分钟\(editableSuffix)"
        }
        return "\(durationMinutes) min\(editableSuffix)"
    }

    private var dateText: String {
        calendarDateText(proposal.startDate, timeZone: proposal.timeZoneIdentifier)
    }

    private func calendarDateText(_ date: Date, timeZone: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = appLanguage.locale
        formatter.timeZone = TimeZone(identifier: timeZone)
            ?? .current
        formatter.setLocalizedDateFormatFromTemplate("y EEE MMM d HH:mm")
        return formatter.string(from: date)
    }

    private func sync() {
        guard result != .syncing else { return }
        if let receipt = receiptStore.receipt(for: proposal.sourceID) { result = .saved(receipt); return }
        guard !receiptStore.hasPendingWrite(for: proposal.sourceID) else {
            result = .unknown(uncertainResultMessage(providerMessage: "")); return
        }
        if var canonicalActivity, let activityStore {
            canonicalActivity.calendarSyncState = isCalendarSyncEnabled
                ? .syncing
                : .disabled
            canonicalActivity.lastCalendarSyncAttempt = isCalendarSyncEnabled
                ? Date()
                : nil
            do {
                try activityStore.save(canonicalActivity)
                canonicalSaved = true
            } catch {
                result = .failed(
                    appLanguage.text(
                        "The event could not be saved in capri. Nothing was added to Apple Calendar."
                    )
                )
                return
            }
            if !isCalendarSyncEnabled {
                result = .savedInApp
                return
            }
        }
        guard isCalendarSyncEnabled else {
            result = .failed(appLanguage.text("Calendar sync is off. This draft has not been added to Apple Calendar.", zhHans: "日历同步已关闭。此草稿尚未添加到 Apple 日历。"))
            return
        }
        let operation: UUID
        do { operation = try RuntimeWorkRegistry.shared.begin(.apiWrite) }
        catch { result = .failed(appLanguage.text("Finish switching accounts before confirming this draft.", zhHans: "请完成账户切换后再确认此草稿。")); return }
        do {
            guard try receiptStore.claimWrite(for: proposal) else {
                RuntimeWorkRegistry.shared.end(operation)
                result = .unknown(uncertainResultMessage(providerMessage: "")); return
            }
        } catch {
            RuntimeWorkRegistry.shared.end(operation)
            result = .unknown(uncertainResultMessage(providerMessage: "")); return
        }
        result = .syncing
        Task { @MainActor in
            defer { RuntimeWorkRegistry.shared.end(operation) }
            switch await calendarSync.createEvent(from: proposal) {
            case let .success(event):
                if let canonicalActivity, let activityStore {
                    try? activityStore.save(
                        canonicalActivity.updatingCalendarSync(
                            .synced,
                            eventIdentifier: event.identifier
                        )
                    )
                }
                guard receiptStore.recordSaved(
                    sourceID: proposal.sourceID,
                    eventIdentifier: event.identifier,
                    savedEvent: event
                ) else { result = .unknown(uncertainResultMessage(providerMessage: "")); return }
                result = .saved(
                    DeviceCalendarWriteReceipt(
                        sourceID: proposal.sourceID,
                        eventIdentifier: event.identifier,
                        savedAt: Date(),
                        savedEvent: event
                    )
                )
            case let .failure(.saveFailed(message)):
                if let canonicalActivity, let activityStore {
                    try? activityStore.save(
                        canonicalActivity.updatingCalendarSync(.unknown)
                    )
                }
                result = .unknown(
                    uncertainResultMessage(providerMessage: message)
                )
            case let .failure(failure):
                receiptStore.clearDefiniteNoWrite(for: proposal.sourceID)
                if let canonicalActivity, let activityStore {
                    try? activityStore.save(
                        canonicalActivity.updatingCalendarSync(.failed)
                    )
                }
                result = .failed(failureMessage(failure))
            }
        }
    }

    private func failureMessage(_ failure: DeviceCalendarSyncFailure) -> String {
        let appState = canonicalSaved
            ? appLanguage.text("The event is saved in capri.") + " "
            : ""
        switch failure {
        case .permissionDenied:
            return appState + appLanguage.text(
                "Allow Calendar write access in Settings, then try again."
            )
        case .noDefaultCalendar:
            return appState + appLanguage.text(
                "Choose a default calendar in Apple Calendar, then try again."
            )
        case .eventNotFound:
            return appState + appLanguage.text("The linked Apple Calendar event could not be found. Nothing new was created.")
        case .unsupportedOS:
            return appState + appLanguage.text(
                "One-way Calendar sync requires iOS 17 or later."
            )
        case .saveFailed:
            return appState + appLanguage.text(
                "Apple Calendar could not save the event."
            )
        }
    }

    private func uncertainResultMessage(providerMessage _: String) -> String {
        let appState = canonicalSaved
            ? appLanguage.text("The event is saved in capri.") + " "
            : ""
        return appState + appLanguage.text(
            "Apple Calendar returned an uncertain result. Check Apple Calendar before taking any further action."
        )
    }
}

#if DEBUG
@MainActor
private final class DeterministicDeviceCalendarSyncService: DeviceCalendarSyncing {
    func createEvent(
        from proposal: DeviceCalendarProposal
    ) async -> Result<DeviceCalendarSavedEvent, DeviceCalendarSyncFailure> {
        .success(
            DeviceCalendarSavedEvent(
                identifier: "synthetic-\(proposal.sourceID)",
                title: proposal.title,
                startDate: proposal.startDate,
                endDate: proposal.endDate,
                timeZoneIdentifier: proposal.timeZoneIdentifier
            )
        )
    }

    func updateEvent(
        eventIdentifier: String,
        from proposal: DeviceCalendarProposal
    ) async -> Result<DeviceCalendarSavedEvent, DeviceCalendarSyncFailure> {
        .success(
            DeviceCalendarSavedEvent(
                identifier: eventIdentifier,
                title: proposal.title,
                startDate: proposal.startDate,
                endDate: proposal.endDate,
                timeZoneIdentifier: proposal.timeZoneIdentifier
            )
        )
    }
}

struct DeviceCalendarHandoffScenarioView: View {
    private let proposal = DeviceCalendarProposal(
        sourceID: "calendar-handoff-ui-\(ProcessInfo.processInfo.processIdentifier)",
        personDisplayName: "Leila Hassan",
        title: "Interview · Leila Hassan",
        startDate: Date(timeIntervalSince1970: 1_819_954_800),
        endDate: Date(timeIntervalSince1970: 1_819_956_600),
        timeZoneIdentifier: "Asia/Singapore",
        evidenceQuote: "Interview September 3, 2027 at 3:00 PM.",
        detectedDateText: "September 3, 2027 at 3:00 PM",
        durationWasExplicit: false
    )

    var body: some View {
        NavigationStack {
            ScrollView {
                #if targetEnvironment(simulator)
                if let data = ProcessInfo.processInfo.environment["TS_GET9_CALENDAR_DRAFT"]?.data(using: .utf8),
                   let draft = try? JSONDecoder().decode(AgentCalendarDraft.self, from: data),
                   let liveProposal = draft.deviceProposal {
                    GET9CalendarProofView(proposal: liveProposal)
                } else {
                    scenarioCard
                }
                #else
                scenarioCard
                #endif
            }
            .background(Color.tsCanvas)
            .navigationTitle("Screenshot reviewed")
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("calendar-handoff-scenario")
        }
    }

    private var scenarioCard: some View {
                DeviceCalendarHandoffView(
                    proposal: proposal,
                    receiptStore: DeviceCalendarReceiptStore(attemptDirectory: FileManager.default.temporaryDirectory
                        .appendingPathComponent("calendar-scenario-\(ProcessInfo.processInfo.processIdentifier)")),
                    calendarSync: DeterministicDeviceCalendarSyncService()
                )
                    .padding(20)
    }
}

#if targetEnvironment(simulator)
/// Debug Simulator proof only: the production button/service saves to an owned
/// local calendar, then a separate EventKit store verifies the actual event.
@MainActor
private final class GET9CalendarProofService: ObservableObject, DeviceCalendarSyncing {
    @Published var state = "before_confirmation"
    private let store = EKEventStore()
    private var ownedCalendar: EKCalendar?
    private var proof: [String: Any] = [:]
    private var sourceID: String?

    func createEvent(from proposal: DeviceCalendarProposal) async -> Result<DeviceCalendarSavedEvent, DeviceCalendarSyncFailure> {
        guard state == "before_confirmation", #available(iOS 17.0, *) else { return .failure(.unsupportedOS) }
        sourceID = proposal.sourceID
        state = "confirming"
        do {
            guard try await store.requestFullAccessToEvents() else { state = "permission_denied"; return .failure(.permissionDenied) }
            guard let local = store.sources.first(where: { $0.sourceType == .local }) else {
                state = "no_local_calendar_source"; return .failure(.noDefaultCalendar)
            }
            let calendar = EKCalendar(for: .event, eventStore: store)
            calendar.title = "GET-9 synthetic \(proposal.sourceID)"
            calendar.source = local
            try store.saveCalendar(calendar, commit: true)
            ownedCalendar = calendar
            let service = EventKitDeviceCalendarSyncService(eventStore: store, destinationCalendar: calendar)
            let outcome = await service.createEvent(from: proposal)
            guard case let .success(receipt) = outcome else { state = "save_failed"; return outcome }
            let readback = EKEventStore()
            guard let event = readback.event(withIdentifier: receipt.identifier),
                  event.calendar.calendarIdentifier == calendar.calendarIdentifier,
                  event.title == proposal.title, event.startDate == proposal.startDate,
                  event.endDate == proposal.endDate, event.timeZone?.identifier == proposal.timeZoneIdentifier,
                  event.notes == nil, event.attendees?.isEmpty != false, event.alarms?.isEmpty != false else {
                state = "readback_mismatch"; return .failure(.saveFailed("Synthetic Calendar readback failed."))
            }
            let predicate = readback.predicateForEvents(withStart: proposal.startDate.addingTimeInterval(-1),
                end: proposal.endDate.addingTimeInterval(1), calendars: [event.calendar])
            let count = readback.events(matching: predicate).count
            guard count == 1 else { state = "duplicate_event"; return .failure(.saveFailed("Synthetic Calendar count mismatch.")) }
            proof = ["dataClass": "synthetic", "sourceID": proposal.sourceID, "confirmedByProductionButton": true,
                "eventIdentifier": receipt.identifier, "calendarIdentifier": calendar.calendarIdentifier,
                "title": event.title ?? "", "startsAt": ISO8601DateFormatter().string(from: event.startDate),
                "endsAt": ISO8601DateFormatter().string(from: event.endDate), "timeZone": proposal.timeZoneIdentifier,
                "independentEventKitReadback": true, "eventCount": count, "sourceQuoteExported": false,
                "attendees": 0, "alarms": 0, "cleanupVerified": false]
            try persistProof()
            state = "verified"
            return outcome
        } catch { state = "proof_failed"; return .failure(.saveFailed(error.localizedDescription)) }
    }

    func updateEvent(eventIdentifier: String, from proposal: DeviceCalendarProposal) async -> Result<DeviceCalendarSavedEvent, DeviceCalendarSyncFailure> {
        .failure(.eventNotFound)
    }

    func cleanup() {
        guard let calendar = ownedCalendar else { return }
        do {
            let id = calendar.calendarIdentifier
            try store.removeCalendar(calendar, commit: true)
            guard EKEventStore().calendar(withIdentifier: id) == nil else { state = "cleanup_failed"; return }
            ownedCalendar = nil
            proof["cleanupVerified"] = true
            try persistProof()
            state = "cleaned"
        } catch { state = "cleanup_failed" }
    }

    private func persistProof() throws {
        guard let sourceID, UUID(uuidString: sourceID) != nil else { return }
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("GET9CalendarProof", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: proof, options: [.prettyPrinted, .sortedKeys])
            .write(to: directory.appendingPathComponent("\(sourceID).json"), options: .atomic)
    }
}

private struct GET9CalendarProofView: View {
    let proposal: DeviceCalendarProposal
    @StateObject private var service = GET9CalendarProofService()

    var body: some View {
        VStack(spacing: 20) {
            DeviceCalendarHandoffView(proposal: proposal,
                receiptStore: DeviceCalendarReceiptStore(defaults: UserDefaults(suiteName: "get9-calendar-\(ProcessInfo.processInfo.processIdentifier)")!,
                    attemptDirectory: FileManager.default.temporaryDirectory.appendingPathComponent("get9-calendar-\(ProcessInfo.processInfo.processIdentifier)")),
                calendarSync: service)
            Text(verbatim: service.state).accessibilityIdentifier("get9-calendar-proof-state")
            Button(action: service.cleanup) { Text(verbatim: "Remove synthetic calendar") }
                .accessibilityIdentifier("get9-calendar-cleanup")
        }.padding(20)
    }
}
#endif
#endif

struct DeviceCalendarSavedEvent: Codable, Equatable {
    let identifier: String
    let title: String
    let startDate: Date
    let endDate: Date
    let timeZoneIdentifier: String
}

#Preview("Calendar proposal") {
    ScrollView {
        DeviceCalendarHandoffView(
            proposal: DeviceCalendarProposal(
                sourceID: "synthetic-calendar-proposal",
                personDisplayName: "Leila Hassan",
                title: "面试 · Leila Hassan",
                startDate: Date(timeIntervalSince1970: 1_788_421_200),
                endDate: Date(timeIntervalSince1970: 1_788_423_000),
                timeZoneIdentifier: "Asia/Singapore",
                evidenceQuote: "9月3日下午3点可以，我们视频面试吧。",
                detectedDateText: "9月3日下午3点",
                durationWasExplicit: false
            ),
            receiptStore: DeviceCalendarReceiptStore(
                defaults: UserDefaults(suiteName: "calendar-preview")!
            )
        )
        .padding()
    }
    .background(Color.tsCanvas)
}
