import CryptoKit
import SwiftUI

enum RelationshipCalendarDeviceWriteTarget: Equatable {
    case create
    case update(eventIdentifier: String)
}

@MainActor
enum RelationshipCalendarDeviceWriter {
    static func execute(
        activity: RelationshipCalendarActivity,
        proposal: DeviceCalendarProposal,
        using calendarSync: any DeviceCalendarSyncing
    ) async -> Result<DeviceCalendarSavedEvent, DeviceCalendarSyncFailure> {
        switch activity.deviceWriteTarget {
        case let .update(eventIdentifier):
            return await calendarSync.updateEvent(
                eventIdentifier: eventIdentifier,
                from: proposal
            )
        case .create:
            return await calendarSync.createEvent(from: proposal)
        }
    }
}

struct RelationshipCalendarActivity: Identifiable, Equatable {
    enum EditableField: String, CaseIterable, Equatable, Hashable {
        case kind
        case title
        case startDate
        case endDate
    }

    enum Kind: String, CaseIterable, Equatable, Identifiable {
        case interview
        case meeting
        case conversation

        var id: String { rawValue }

        func title(in language: AppLanguage) -> String {
            switch self {
            case .interview:
                return language.text("Interview")
            case .meeting:
                return language.text("Meeting")
            case .conversation:
                return language.text("Conversation")
            }
        }

        var symbolName: String {
            switch self {
            case .interview:
                return "person.2"
            case .meeting:
                return "calendar"
            case .conversation:
                return "bubble.left.and.bubble.right"
            }
        }
    }

    enum Source: String, Equatable {
        case governed
        case preview
        case talentSignal
    }

    enum CalendarSyncState: String, Equatable {
        case disabled
        case pending
        case syncing
        case synced
        case failed
        case missing
        case unknown
    }

    enum CalendarSyncFailureReason: String, Codable, Equatable {
        case permissionDenied
        case noDefaultCalendar
        case unsupportedOS
    }

    struct EditSnapshot: Codable, Equatable {
        let kind: String
        let title: String
        let startDate: Date
        let endDate: Date
        let timeZoneIdentifier: String

        init(activity: RelationshipCalendarActivity) {
            kind = activity.kind.rawValue
            title = activity.title
            startDate = activity.startDate
            endDate = activity.endDate
            timeZoneIdentifier = activity.timeZoneIdentifier
        }
    }

    struct EditAuditEntry: Codable, Equatable, Identifiable {
        enum Effect: String, Codable, Equatable {
            case localOnly
            case create
            case update
        }

        enum Status: String, Codable, Equatable {
            case reviewed
            case writing
            case succeeded
            case failed
            case missing
            case unknown
        }

        let id: String
        let activityID: String
        let reviewedByAccountID: String
        let reviewedAt: Date
        let targetEventIdentifier: String?
        let effect: Effect
        let before: EditSnapshot
        let after: EditSnapshot
        var status: Status
        var observedEventIdentifier: String?
        var failureReason: CalendarSyncFailureReason?
        var updatedAt: Date
    }

    let id: String
    let kind: Kind
    let title: String
    let personID: String
    let relationshipContextID: String
    let personDisplayLabel: String
    let contextDisplayLabel: String
    let startDate: Date
    let endDate: Date
    let timeZoneIdentifier: String
    let source: Source
    var eventIdentifier: String?
    var calendarSyncState: CalendarSyncState = .disabled
    var calendarSyncFailureReason: CalendarSyncFailureReason? = nil
    var lastCalendarSyncAttempt: Date? = nil
    var editHistory: [EditAuditEntry] = []

    func displayTitle(in language: AppLanguage) -> String {
        let genericPreviewTitles = [
            "Preview activity",
            "Interview",
            "Meeting",
            "Conversation",
        ]
        return source == .preview
            && id.hasPrefix("preview-calendar-")
            && genericPreviewTitles.contains(title)
            ? kind.title(in: language)
            : title
    }

    func updatingCalendarSync(
        _ state: CalendarSyncState,
        eventIdentifier: String? = nil,
        failureReason: CalendarSyncFailureReason? = nil,
        attemptedAt: Date = Date()
    ) -> RelationshipCalendarActivity {
        var updated = self
        updated.calendarSyncState = state
        updated.calendarSyncFailureReason = state == .failed ? failureReason : nil
        updated.lastCalendarSyncAttempt = attemptedAt
        if let eventIdentifier {
            updated.eventIdentifier = eventIdentifier
        }
        return updated
    }

    func recordingReviewedEdit(
        from original: RelationshipCalendarActivity,
        reviewedByAccountID: String,
        operationID: String = UUID().uuidString.lowercased(),
        reviewedAt: Date = Date()
    ) -> RelationshipCalendarActivity {
        var updated = self
        let effect: EditAuditEntry.Effect
        if original.hasLinkedCalendarEvent {
            effect = .update
        } else if calendarSyncState == .pending {
            effect = .create
        } else {
            effect = .localOnly
        }
        updated.editHistory.append(
            EditAuditEntry(
                id: operationID,
                activityID: id,
                reviewedByAccountID: reviewedByAccountID,
                reviewedAt: reviewedAt,
                targetEventIdentifier: original.eventIdentifier,
                effect: effect,
                before: EditSnapshot(activity: original),
                after: EditSnapshot(activity: self),
                status: effect == .localOnly ? .succeeded : .reviewed,
                observedEventIdentifier: effect == .localOnly
                    ? original.eventIdentifier
                    : nil,
                failureReason: nil,
                updatedAt: reviewedAt
            )
        )
        return updated
    }

    func updatingLatestEditAudit(
        _ status: EditAuditEntry.Status,
        observedEventIdentifier: String? = nil,
        failureReason: CalendarSyncFailureReason? = nil,
        updatedAt: Date = Date()
    ) -> RelationshipCalendarActivity {
        guard let index = editHistory.lastIndex(where: {
            [.reviewed, .writing, .failed].contains($0.status)
        }) else { return self }
        var updated = self
        updated.editHistory[index].status = status
        if let observedEventIdentifier {
            updated.editHistory[index].observedEventIdentifier = observedEventIdentifier
        }
        updated.editHistory[index].failureReason = failureReason
        updated.editHistory[index].updatedAt = updatedAt
        return updated
    }

    var canEditFromCalendar: Bool {
        source != .governed
            && ![.pending, .syncing, .missing, .unknown].contains(calendarSyncState)
    }

    var hasLinkedCalendarEvent: Bool {
        guard let eventIdentifier else { return false }
        return !eventIdentifier.isEmpty
    }

    var canRetryCalendarSync: Bool {
        calendarSyncState == .failed
            && calendarSyncFailureReason != .unsupportedOS
    }

    func canAttemptDeviceWrite(calendarSyncEnabled: Bool) -> Bool {
        source != .preview && (calendarSyncEnabled || hasLinkedCalendarEvent)
    }

    var deviceWriteTarget: RelationshipCalendarDeviceWriteTarget {
        guard hasLinkedCalendarEvent, let eventIdentifier else {
            return .create
        }
        return .update(eventIdentifier: eventIdentifier)
    }

    func revised(
        kind: Kind,
        title: String,
        startDate: Date,
        endDate: Date,
        calendarSyncEnabled: Bool = true
    ) -> RelationshipCalendarActivity {
        let revisedSyncState: CalendarSyncState
        if source == .preview {
            revisedSyncState = .disabled
        } else if hasLinkedCalendarEvent
                    || (calendarSyncState == .failed && calendarSyncEnabled) {
            revisedSyncState = .pending
        } else {
            revisedSyncState = .disabled
        }
        return RelationshipCalendarActivity(
            id: id,
            kind: kind,
            title: title,
            personID: personID,
            relationshipContextID: relationshipContextID,
            personDisplayLabel: personDisplayLabel,
            contextDisplayLabel: contextDisplayLabel,
            startDate: startDate,
            endDate: endDate,
            timeZoneIdentifier: timeZoneIdentifier,
            source: source,
            eventIdentifier: eventIdentifier,
            calendarSyncState: revisedSyncState,
            calendarSyncFailureReason: nil,
            lastCalendarSyncAttempt: nil,
            editHistory: editHistory
        )
    }

    func changedEditableFields(
        from original: RelationshipCalendarActivity
    ) -> [EditableField] {
        EditableField.allCases.filter { field in
            switch field {
            case .kind:
                return kind != original.kind
            case .title:
                return title != original.title
            case .startDate:
                return startDate != original.startDate
            case .endDate:
                return endDate != original.endDate
            }
        }
    }
}

enum CalendarSyncPreference {
    static let isEnabledKey = "talent-signal.calendar-sync.enabled"
}

private struct StoredRelationshipCalendarActivity: Codable, Equatable {
    let id: String
    let kind: String
    let title: String
    let personID: String
    let relationshipContextID: String
    let startDate: Date
    let endDate: Date
    let timeZoneIdentifier: String
    let source: String?
    let eventIdentifier: String?
    let calendarSyncState: String?
    let calendarSyncFailureReason: String?
    let lastCalendarSyncAttempt: Date?
    let editHistory: [RelationshipCalendarActivity.EditAuditEntry]?
    let savedAt: Date
}

protocol RelationshipCalendarActivityPersisting: AnyObject {
    func activities(in snapshot: PursuitWorkspaceSnapshot) throws
        -> [RelationshipCalendarActivity]
    func save(_ activity: RelationshipCalendarActivity) throws
    func remove(activityID: String) throws
}

final class FileRelationshipCalendarActivityStore:
    RelationshipCalendarActivityPersisting {
    private let fileURL: URL

    init(
        accountID: String,
        rootURL: URL? = nil
    ) {
        let digest = SHA256.hash(data: Data(accountID.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        let root = rootURL ?? FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        fileURL = root
            .appending(
                path: "TalentSignal/CalendarActivities",
                directoryHint: .isDirectory
            )
            .appending(path: "\(digest).json")
    }

    func activities(
        in snapshot: PursuitWorkspaceSnapshot
    ) throws -> [RelationshipCalendarActivity] {
        try entries().values.compactMap { stored in
            guard let kind = RelationshipCalendarActivity.Kind(
                rawValue: stored.kind
            ), let person = snapshot.people.first(where: {
                $0.id == stored.personID
            }), let context = person.contexts.first(where: {
                $0.id == stored.relationshipContextID
            }) else {
                return nil
            }
            let decodedSyncState = stored.calendarSyncState.flatMap(
                RelationshipCalendarActivity.CalendarSyncState.init(rawValue:)
            ) ?? (stored.eventIdentifier == nil ? .pending : .synced)
            let decodedFailureReason = stored.calendarSyncFailureReason.flatMap(
                RelationshipCalendarActivity.CalendarSyncFailureReason.init(rawValue:)
            )
            var decodedEditHistory = stored.editHistory ?? []
            if decodedSyncState == .syncing,
               let index = decodedEditHistory.lastIndex(where: {
                   $0.status == .writing
               }) {
                decodedEditHistory[index].status = .unknown
                decodedEditHistory[index].updatedAt = stored.lastCalendarSyncAttempt
                    ?? decodedEditHistory[index].updatedAt
            }
            return RelationshipCalendarActivity(
                id: stored.id,
                kind: kind,
                title: stored.title,
                personID: stored.personID,
                relationshipContextID: stored.relationshipContextID,
                personDisplayLabel: person.displayLabel,
                contextDisplayLabel: context.displayLabel,
                startDate: stored.startDate,
                endDate: stored.endDate,
                timeZoneIdentifier: stored.timeZoneIdentifier,
                source: .talentSignal,
                eventIdentifier: stored.eventIdentifier,
                calendarSyncState: decodedSyncState == .syncing
                    ? .unknown
                    : decodedSyncState,
                calendarSyncFailureReason: decodedFailureReason,
                lastCalendarSyncAttempt: stored.lastCalendarSyncAttempt,
                editHistory: decodedEditHistory
            )
        }
        .sorted { $0.startDate < $1.startDate }
    }

    func save(_ activity: RelationshipCalendarActivity) throws {
        guard activity.source != .preview else {
            return
        }
        var next = try entries()
        next[activity.id] = StoredRelationshipCalendarActivity(
            id: activity.id,
            kind: activity.kind.rawValue,
            title: activity.title,
            personID: activity.personID,
            relationshipContextID: activity.relationshipContextID,
            startDate: activity.startDate,
            endDate: activity.endDate,
            timeZoneIdentifier: activity.timeZoneIdentifier,
            source: activity.source.rawValue,
            eventIdentifier: activity.eventIdentifier,
            calendarSyncState: activity.calendarSyncState.rawValue,
            calendarSyncFailureReason: activity.calendarSyncFailureReason?.rawValue,
            lastCalendarSyncAttempt: activity.lastCalendarSyncAttempt,
            editHistory: activity.editHistory,
            savedAt: Date()
        )
        try write(next)
    }

    func remove(activityID: String) throws {
        var next = try entries()
        next.removeValue(forKey: activityID)
        if next.isEmpty {
            if FileManager.default.fileExists(atPath: fileURL.path) {
                try FileManager.default.removeItem(at: fileURL)
            }
        } else {
            try write(next)
        }
    }

    private func entries() throws -> [String: StoredRelationshipCalendarActivity] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return [:]
        }
        return try JSONDecoder().decode(
            [String: StoredRelationshipCalendarActivity].self,
            from: Data(contentsOf: fileURL)
        )
    }

    private func write(
        _ entries: [String: StoredRelationshipCalendarActivity]
    ) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        var directoryValues = URLResourceValues()
        directoryValues.isExcludedFromBackup = true
        var protectedDirectory = directory
        try protectedDirectory.setResourceValues(directoryValues)
        try JSONEncoder().encode(entries).write(
            to: fileURL,
            options: [.atomic, .completeFileProtectionUnlessOpen]
        )
    }
}

enum RelationshipCalendarProjection {
    static func activities(
        snapshot: PursuitWorkspaceSnapshot,
        isPreview: Bool,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [RelationshipCalendarActivity] {
        guard isPreview else { return [] }
        let scopes = snapshot.people.flatMap { person in
            person.contexts.map { (person, $0) }
        }
        guard let first = scopes.first else { return [] }

        #if DEBUG
        if ProcessInfo.processInfo.environment[
            "TS_IOS_UI_TEST_CALENDAR_EMPTY_STATE"
        ] == "true" {
            let yesterday = calendar.date(
                byAdding: .day,
                value: -1,
                to: calendar.startOfDay(for: now)
            ) ?? now.addingTimeInterval(-24 * 60 * 60)
            let start = calendar.date(
                bySettingHour: 15,
                minute: 0,
                second: 0,
                of: yesterday
            ) ?? yesterday
            return [
                RelationshipCalendarActivity(
                    id: "preview-calendar-past",
                    kind: .conversation,
                    title: "Conversation",
                    personID: first.0.id,
                    relationshipContextID: first.1.id,
                    personDisplayLabel: first.0.displayLabel,
                    contextDisplayLabel: first.1.displayLabel,
                    startDate: start,
                    endDate: start.addingTimeInterval(30 * 60),
                    timeZoneIdentifier: calendar.timeZone.identifier,
                    source: .preview
                ),
            ]
        }
        if ProcessInfo.processInfo.environment["TS_IOS_UI_TEST_CALENDAR_DENSITY"] == "true" {
            let day = calendar.startOfDay(for: now)
            let week = calendar.dateInterval(of: .weekOfYear, for: day)!.start
            let samples: [(String, Int, Date, Int, Int)] = [
                ("preview-calendar-primary", 0, day, 15 * 60, 45),
                ("preview-calendar-secondary", min(1, scopes.count - 1), day, 11 * 60 + 30, 30),
                ("preview-calendar-morning", 0, day, 9 * 60, 30),
                ("preview-calendar-followup", 0, day, 16 * 60, 30),
                ("preview-calendar-overlap", min(1, scopes.count - 1), day, 16 * 60 + 15, 30),
                ("preview-calendar-week-start", 0, week, 10 * 60, 60),
                ("preview-calendar-week-middle", min(1, scopes.count - 1), calendar.date(byAdding: .day, value: 3, to: week)!, 14 * 60, 60),
            ]
            return samples.map { id, index, date, minute, duration in
                let scope = scopes[index]
                let start = calendar.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: date)!
                return RelationshipCalendarActivity(
                    id: id, kind: index == 0 ? .interview : .conversation, title: "Preview activity",
                    personID: scope.0.id, relationshipContextID: scope.1.id,
                    personDisplayLabel: scope.0.displayLabel, contextDisplayLabel: scope.1.displayLabel,
                    startDate: start, endDate: start.addingTimeInterval(Double(duration * 60)),
                    timeZoneIdentifier: calendar.timeZone.identifier, source: .preview
                )
            }.sorted { $0.startDate < $1.startDate }
        }
        #endif

        let today = calendar.startOfDay(for: now)
        let afternoon = calendar.date(
            bySettingHour: 15,
            minute: 0,
            second: 0,
            of: today
        ) ?? now.addingTimeInterval(3_600)
        let firstStart: Date
        if afternoon > now.addingTimeInterval(30 * 60) {
            firstStart = afternoon
        } else {
            let tomorrow = calendar.date(byAdding: .day, value: 1, to: today)
                ?? now.addingTimeInterval(24 * 60 * 60)
            firstStart = calendar.date(
                bySettingHour: 15,
                minute: 0,
                second: 0,
                of: tomorrow
            ) ?? tomorrow
        }

        var result = [
            RelationshipCalendarActivity(
                id: "preview-calendar-primary",
                kind: .interview,
                title: "Interview",
                personID: first.0.id,
                relationshipContextID: first.1.id,
                personDisplayLabel: first.0.displayLabel,
                contextDisplayLabel: first.1.displayLabel,
                startDate: firstStart,
                endDate: firstStart.addingTimeInterval(45 * 60),
                timeZoneIdentifier: "Asia/Singapore",
                source: .preview,
                eventIdentifier: nil
            ),
        ]

        if scopes.count > 1 {
            let secondDay = calendar.date(
                byAdding: .day,
                value: 2,
                to: calendar.startOfDay(for: firstStart)
            ) ?? firstStart.addingTimeInterval(2 * 24 * 60 * 60)
            let secondStart = calendar.date(
                bySettingHour: 11,
                minute: 30,
                second: 0,
                of: secondDay
            ) ?? secondDay
            let second = scopes[1]
            result.append(
                RelationshipCalendarActivity(
                    id: "preview-calendar-secondary",
                    kind: .conversation,
                    title: "Conversation",
                    personID: second.0.id,
                    relationshipContextID: second.1.id,
                    personDisplayLabel: second.0.displayLabel,
                    contextDisplayLabel: second.1.displayLabel,
                    startDate: secondStart,
                    endDate: secondStart.addingTimeInterval(30 * 60),
                    timeZoneIdentifier: "Asia/Singapore",
                    source: .preview,
                    eventIdentifier: nil
                )
            )
        }
        return result.sorted { $0.startDate < $1.startDate }
    }

    static func next(
        in activities: [RelationshipCalendarActivity],
        now: Date = Date()
    ) -> RelationshipCalendarActivity? {
        activities
            .filter { $0.endDate >= now }
            .min { $0.startDate < $1.startDate }
    }
}

enum RelationshipCalendarAgenda {
    enum Mode: String, CaseIterable, Identifiable {
        case day, week
        var id: String { rawValue }
    }

    static func interval(for date: Date, mode: Mode, calendar: Calendar) -> DateInterval {
        if mode == .week, let week = calendar.dateInterval(of: .weekOfYear, for: date) {
            return week
        }
        let start = calendar.startOfDay(for: date)
        let end = calendar.date(byAdding: .day, value: mode == .day ? 1 : 7, to: start)!
        return DateInterval(start: start, end: end)
    }

    static func activities(
        _ activities: [RelationshipCalendarActivity],
        in interval: DateInterval,
        personID: String? = nil
    ) -> [RelationshipCalendarActivity] {
        activities.filter {
            (personID == nil || $0.personID == personID)
                && $0.startDate < interval.end && $0.endDate > interval.start
                && $0.endDate > $0.startDate
        }.sorted {
            $0.startDate == $1.startDate ? $0.id < $1.id : $0.startDate < $1.startDate
        }
    }

    static func overlappingIDs(in activities: [RelationshipCalendarActivity]) -> Set<String> {
        let sorted = activities.filter { $0.endDate > $0.startDate }
            .sorted { $0.startDate < $1.startDate }
        var result: Set<String> = []
        for (index, activity) in sorted.enumerated() {
            for other in sorted.dropFirst(index + 1) {
                guard other.startDate < activity.endDate else { break }
                if other.id != activity.id {
                    result.insert(activity.id)
                    result.insert(other.id)
                }
            }
        }
        return result
    }

    static func suggestedStart(on date: Date, now: Date = Date(), calendar: Calendar) -> Date {
        let morning = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: date) ?? date
        let nextHour = calendar.dateInterval(of: .hour, for: now)?.end ?? now.addingTimeInterval(3600)
        return max(morning, nextHour)
    }
}

enum RelationshipCalendarLaunchIntent: String, Identifiable {
    case overview
    case today
    case thisWeek
    case addActivity

    var id: String { rawValue }
}

struct RelationshipCalendarLaunchRequest: Equatable {
    let id = UUID()
    let intent: RelationshipCalendarLaunchIntent
}

enum RelationshipMeetingIntent {
    case preparation
    case notes

    func draft(for activity: RelationshipCalendarActivity, language: AppLanguage) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.timeZone = TimeZone(identifier: activity.timeZoneIdentifier) ?? .current
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjmm")
        let date = "\(formatter.string(from: activity.startDate)) · \(activity.timeZoneIdentifier)"
        switch self {
        case .preparation:
            return String(
                format: language.text("Prepare for the %1$@ %2$@ with %3$@. Clarify the objective, unresolved evidence, and the three questions that matter most."),
                locale: language.locale, date, activity.kind.title(in: language).lowercased(),
                activity.personDisplayLabel
            )
        case .notes:
            return String(
                format: language.text("Notes from %1$@ with %2$@ (%3$@):"),
                locale: language.locale, activity.displayTitle(in: language),
                activity.personDisplayLabel, date
            ) + "\n\n"
        }
    }
}

struct TodayRelationshipCalendarPeek: View {
    let activities: [RelationshipCalendarActivity]
    let onOpen: () -> Void

    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Button(action: onOpen) {
            Group {
                if nextActivity == nil {
                    emptyStateContent
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 14) {
                            timeMark
                            Spacer(minLength: 8)
                            openMark
                        }
                        momentCopy
                            .layoutPriority(1)
                    }
                }
            }
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(Color.tsLine)
                    .frame(height: 1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint(
            appLanguage.text("Opens the relationship calendar.")
        )
        .accessibilityIdentifier("today-calendar-reminder")
    }

    private var nextActivity: RelationshipCalendarActivity? {
        RelationshipCalendarProjection.next(in: activities)
    }

    private var timeMark: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(nextActivity.map { dayText($0) } ?? "")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.tsMutedInk)
            Text(nextActivity.map { timeText($0.startDate, in: $0) } ?? "—")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.tsInk)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityHidden(true)
    }

    private func dayText(_ activity: RelationshipCalendarActivity) -> String {
        var calendar = Calendar.current
        calendar.timeZone = TimeZone(identifier: activity.timeZoneIdentifier) ?? .current
        if calendar.isDateInToday(activity.startDate) { return appLanguage.text("Today") }
        if calendar.isDateInTomorrow(activity.startDate) { return appLanguage.text("Tomorrow") }
        let formatter = DateFormatter()
        formatter.locale = appLanguage.locale
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: activity.startDate)
    }

    @ViewBuilder
    private var emptyStateContent: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    emptyMark
                    Spacer(minLength: 8)
                    openMark
                }
                emptyCopy
            }
        } else {
            HStack(alignment: .center, spacing: 12) {
                emptyMark
                emptyCopy
                    .frame(maxWidth: .infinity, alignment: .leading)
                openMark
            }
        }
    }

    private var emptyMark: some View {
        Image(systemName: "calendar.badge.checkmark")
            .font(.system(size: 17, weight: .medium))
            .foregroundStyle(Color.tsMutedInk)
            .frame(width: 40, height: 40)
            .background(Color.tsSurfaceMuted, in: Circle())
            .accessibilityHidden(true)
    }

    private var emptyCopy: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(appLanguage.text("Nothing scheduled today"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.tsInk)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var momentCopy: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let nextActivity {
                Text(
                    verbatim: "\(nextActivity.personDisplayLabel) · \(nextActivity.displayTitle(in: appLanguage))"
                )
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                Text(
                    verbatim: "\(contextText(nextActivity)) · \(timeZoneText(nextActivity))"
                )
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var openMark: some View {
        Image(systemName: "chevron.right")
            .font(.caption.weight(.bold))
            .foregroundStyle(Color.tsMutedInk)
        .frame(minWidth: 44, minHeight: 44)
        .accessibilityHidden(true)
    }

    private var accessibilityLabel: String {
        guard let nextActivity else {
            return appLanguage.text(
                "Calendar. Nothing scheduled today. Open Calendar to plan the next relationship moment."
            )
        }
        let nextSummary = String(
            format: appLanguage.text("Calendar. Next: %@, %@, %@."),
            locale: appLanguage.locale,
            nextActivity.personDisplayLabel,
            nextActivity.displayTitle(in: appLanguage),
            dateTimeText(nextActivity.startDate)
        )
        return "\(nextSummary) \(contextText(nextActivity)) · \(timeZoneText(nextActivity))"
    }

    private func timeText(
        _ date: Date,
        in activity: RelationshipCalendarActivity
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = appLanguage.locale
        formatter.timeZone = TimeZone(identifier: activity.timeZoneIdentifier)
            ?? .current
        formatter.setLocalizedDateFormatFromTemplate("j:mm")
        return formatter.string(from: date)
    }

    private func timeZoneText(_ activity: RelationshipCalendarActivity) -> String {
        if activity.timeZoneIdentifier == "Asia/Singapore" {
            return appLanguage.text("Singapore time")
        }
        return activity.timeZoneIdentifier.replacingOccurrences(of: "_", with: " ")
    }

    private func contextText(_ activity: RelationshipCalendarActivity) -> String {
        guard activity.source == .preview,
              appLanguage.usesSimplifiedChinese() else {
            return appLanguage.workspaceTerm(activity.contextDisplayLabel)
        }
        switch activity.contextDisplayLabel {
        case "Chief Product Officer search":
            return "首席产品官搜索"
        case "Board search":
            return "董事会搜寻"
        default:
            return appLanguage.workspaceTerm(activity.contextDisplayLabel)
        }
    }

    private func dateTimeText(_ date: Date) -> String {
        date.formatted(
            Date.FormatStyle()
                .weekday(.wide)
                .hour()
                .minute()
                .locale(appLanguage.locale)
        )
    }
}

@MainActor
struct RelationshipCalendarView: View {
    let snapshot: PursuitWorkspaceSnapshot
    let isPreview: Bool
    let initialActivities: [RelationshipCalendarActivity]
    let onPrepare: (RelationshipCalendarActivity) -> Void
    let onRecordNotes: ((RelationshipCalendarActivity) -> Void)?
    let isEmbedded: Bool
    let isActive: Bool
    let launchRequest: RelationshipCalendarLaunchRequest?
    let onActivitiesChange: (([RelationshipCalendarActivity]) -> Void)?
    let personDetail: ((String) -> AnyView?)?

    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AppStorage(CalendarSyncPreference.isEnabledKey)
    private var isCalendarSyncEnabled = true
    @State private var activities: [RelationshipCalendarActivity]
    @State private var selectedDate: Date
    @State private var agendaMode: RelationshipCalendarAgenda.Mode = .day
    @State private var selectedPersonID: String?
    @State private var isMonthExpanded = false
    @State private var destination: CalendarSheetDestination?
    @State private var calendarNotice: String?
    @State private var syncingActivityIDs: Set<String> = []
    @State private var lastLaunchRequestID: UUID?
    @State private var hasEstablishedAgendaDate: Bool
    @State private var pendingSessionIntent: (RelationshipCalendarActivity, RelationshipMeetingIntent)?

    private let activityStore: (any RelationshipCalendarActivityPersisting)?
    private let calendarSync: any DeviceCalendarSyncing

    init(
        snapshot: PursuitWorkspaceSnapshot,
        isPreview: Bool,
        initialActivities: [RelationshipCalendarActivity],
        launchIntent: RelationshipCalendarLaunchIntent = .overview,
        isEmbedded: Bool = false,
        isActive: Bool = true,
        launchRequest: RelationshipCalendarLaunchRequest? = nil,
        onActivitiesChange: (([RelationshipCalendarActivity]) -> Void)? = nil,
        activityStore: (any RelationshipCalendarActivityPersisting)? = nil,
        calendarSync: (any DeviceCalendarSyncing)? = nil,
        personDetail: ((String) -> AnyView?)? = nil,
        onRecordNotes: ((RelationshipCalendarActivity) -> Void)? = nil,
        onPrepare: @escaping (RelationshipCalendarActivity) -> Void
    ) {
        self.snapshot = snapshot
        self.isPreview = isPreview
        self.onPrepare = onPrepare
        self.onRecordNotes = onRecordNotes
        self.isEmbedded = isEmbedded
        self.isActive = isActive
        self.launchRequest = launchRequest
        self.onActivitiesChange = onActivitiesChange
        self.personDetail = personDetail
        let resolvedStore = activityStore ?? (isPreview
            ? nil
            : FileRelationshipCalendarActivityStore(
                accountID: snapshot.workspaceID
            ))
        self.activityStore = resolvedStore
        self.calendarSync = calendarSync
            ?? EventKitDeviceCalendarSyncService()
        let restored = (try? resolvedStore?.activities(in: snapshot)) ?? []
        var combined = initialActivities
        for activity in restored where !combined.contains(where: {
            $0.id == activity.id
        }) {
            combined.append(activity)
        }
        combined.sort { $0.startDate < $1.startDate }
        self.initialActivities = combined
        _activities = State(initialValue: combined)
        _hasEstablishedAgendaDate = State(initialValue: !combined.isEmpty)
        let next = RelationshipCalendarProjection.next(in: combined)
        let startsAtToday = launchIntent != .overview
        _selectedDate = State(
            initialValue: Calendar.current.startOfDay(
                for: startsAtToday ? Date() : (next?.startDate ?? Date())
            )
        )
        _agendaMode = State(
            initialValue: launchIntent == .thisWeek ? .week : .day
        )
        _destination = State(
            initialValue: launchIntent == .addActivity ? .create : nil
        )
    }

    var body: some View {
        Group {
            if isEmbedded {
                calendarContent
            } else {
                NavigationStack {
                    calendarContent
                        .navigationTitle(appLanguage.text("Calendar"))
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) {
                                Button(appLanguage.text("Close")) { dismiss() }
                                    .accessibilityIdentifier("close-relationship-calendar")
                            }
                            ToolbarItem(placement: .topBarTrailing) { addActivityButton }
                        }
                }
            }
        }
        .tint(.tsInk)
        .sheet(item: $destination, onDismiss: completeSessionHandoff) { destination in
            switch destination {
            case let .detail(activity):
                RelationshipCalendarActivityDetail(
                    activity: activity,
                    hasOverlap: overlappingActivityIDs.contains(activity.id),
                    onEdit: activity.canEditFromCalendar ? {
                        self.destination = .edit(activity)
                    } : nil,
                    onOpenPerson: personDetail == nil ? nil : {
                        self.destination = .person(activity.personID)
                    },
                    onRetryCalendarSync: (activity.calendarSyncState == .pending
                        || activity.canRetryCalendarSync)
                        && activity.canAttemptDeviceWrite(
                            calendarSyncEnabled: isCalendarSyncEnabled
                        )
                        ? { syncToCalendar(activityID: activity.id) }
                        : nil,
                    onPrepare: { prepare(activity) },
                    onRecordNotes: onRecordNotes == nil ? nil : {
                        openSession(activity, intent: .notes)
                    }
                )
            case .create:
                RelationshipCalendarComposer(
                    snapshot: snapshot,
                    syncsToCalendar: isCalendarSyncEnabled && !isPreview,
                    isPreview: isPreview,
                    selectedDate: selectedDate,
                    preferredPersonID: selectedPersonID,
                    original: nil
                ) { activity in
                    confirm(activity, replacing: nil)
                }
            case let .edit(activity):
                RelationshipCalendarComposer(
                    snapshot: snapshot,
                    syncsToCalendar: isCalendarSyncEnabled && !isPreview,
                    isPreview: isPreview,
                    selectedDate: selectedDate,
                    preferredPersonID: activity.personID,
                    original: activity
                ) { revisedActivity in
                    confirm(revisedActivity, replacing: activity)
                }
            case let .person(personID):
                if let detail = personDetail?(personID) {
                    detail
                } else {
                    Text(appLanguage.text("This person is no longer available."))
                        .padding(24)
                }
            case .people:
                RelationshipCalendarPersonFilter(
                    people: snapshot.people,
                    selectedPersonID: selectedPersonID
                ) { personID in
                    selectedPersonID = personID
                    self.destination = nil
                }
            }
        }
        .accessibilityIdentifier("relationship-calendar")
        .task(id: isActive) {
            guard isActive else { return }
            applyLaunchRequest()
            resumePendingCalendarSync()
        }
        .onChange(of: launchRequest) { _ in
            if isActive { applyLaunchRequest() }
        }
        .onChange(of: initialActivities) { incoming in
            if !hasEstablishedAgendaDate, !incoming.isEmpty {
                selectedDate = Calendar.current.startOfDay(for:
                    RelationshipCalendarProjection.next(in: incoming)?.startDate ?? Date())
                hasEstablishedAgendaDate = true
            }
            if activities != incoming { activities = incoming }
        }
        .onChange(of: selectedDate) { _ in hasEstablishedAgendaDate = true }
        .onChange(of: activities) { onActivitiesChange?($0) }
    }

    private var calendarContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                calendarPicker
                if selectedPersonID != nil { agendaControls.padding(.top, 4) }
                agendaHeader.padding(.top, 12)
                agenda.padding(.top, 12)
            }
            .padding(.horizontal, 20)
            .padding(.top, isEmbedded ? 16 : 8)
            .padding(.bottom, 28)
        }
        .scrollIndicators(.hidden)
        .relationshipContentBounce()
        .background(Color.tsSurface)
    }

    private var addActivityButton: some View {
        Button { destination = .create } label: {
            Image(systemName: "plus")
                .font(.system(size: 18, weight: .medium))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(appLanguage.text("Add activity"))
        .accessibilityIdentifier("calendar-add-activity")
    }

    private func applyLaunchRequest() {
        guard let request = launchRequest, lastLaunchRequestID != request.id else { return }
        lastLaunchRequestID = request.id
        hasEstablishedAgendaDate = true
        switch request.intent {
        case .overview:
            selectedDate = Calendar.current.startOfDay(for:
                RelationshipCalendarProjection.next(in: activities)?.startDate ?? Date())
            agendaMode = .day
            selectedPersonID = nil
        case .today:
            selectedDate = Calendar.current.startOfDay(for: Date())
            agendaMode = .day
        case .thisWeek:
            selectedDate = Calendar.current.startOfDay(for: Date())
            agendaMode = .week
        case .addActivity:
            destination = .create
        }
    }

    private func prepare(_ activity: RelationshipCalendarActivity) {
        openSession(activity, intent: .preparation)
    }

    private func openSession(_ activity: RelationshipCalendarActivity, intent: RelationshipMeetingIntent) {
        pendingSessionIntent = (activity, intent)
        if destination != nil { destination = nil }
        else { completeSessionHandoff() }
    }

    private func completeSessionHandoff() {
        guard let (activity, intent) = pendingSessionIntent else { return }
        pendingSessionIntent = nil
        if !isEmbedded { dismiss() }
        switch intent {
        case .preparation: onPrepare(activity)
        case .notes: onRecordNotes?(activity)
        }
    }

    private func confirm(
        _ activity: RelationshipCalendarActivity,
        replacing original: RelationshipCalendarActivity?
    ) {
        let confirmedActivity = original.map {
            activity.recordingReviewedEdit(
                from: $0,
                reviewedByAccountID: snapshot.workspaceID
            )
        } ?? activity
        do {
            try activityStore?.save(confirmedActivity)
        } catch {
            calendarNotice = appLanguage.text(
                "The event could not be saved in capri. Nothing was added to Apple Calendar."
            )
            return
        }

        activities.removeAll { $0.id == confirmedActivity.id }
        activities.append(confirmedActivity)
        activities.sort { $0.startDate < $1.startDate }
        selectedDate = Calendar.current.startOfDay(for: confirmedActivity.startDate)
        if selectedPersonID != nil { selectedPersonID = confirmedActivity.personID }
        destination = .detail(confirmedActivity)
        guard confirmedActivity.calendarSyncState == .pending else { return }
        syncToCalendar(activityID: confirmedActivity.id)
    }

    private func syncToCalendar(activityID: String) {
        guard !isPreview, !syncingActivityIDs.contains(activityID),
              let index = activities.firstIndex(where: { $0.id == activityID }),
              [.pending, .failed].contains(activities[index].calendarSyncState),
              activities[index].canAttemptDeviceWrite(
                  calendarSyncEnabled: isCalendarSyncEnabled
              ) else { return }

        let attemptedAt = Date()
        let syncingActivity = activities[index]
            .updatingCalendarSync(.syncing, attemptedAt: attemptedAt)
            .updatingLatestEditAudit(.writing, updatedAt: attemptedAt)
        do {
            try activityStore?.save(syncingActivity)
        } catch {
            calendarNotice = appLanguage.text(
                "The sync attempt could not be recorded in capri. Nothing was added to Apple Calendar."
            )
            return
        }
        activities[index] = syncingActivity
        destination = .detail(syncingActivity)
        syncingActivityIDs.insert(activityID)
        calendarNotice = nil

        Task { @MainActor in
            let proposal = DeviceCalendarProposal(
                sourceID: syncingActivity.id,
                personDisplayName: syncingActivity.personDisplayLabel,
                title: syncingActivity.title,
                startDate: syncingActivity.startDate,
                endDate: syncingActivity.endDate,
                timeZoneIdentifier: syncingActivity.timeZoneIdentifier,
                evidenceQuote: appLanguage.text(
                    "User-confirmed capri calendar event"
                ),
                detectedDateText: syncingActivity.startDate.ISO8601Format(),
                durationWasExplicit: true
            )
            let result = await RelationshipCalendarDeviceWriter.execute(
                activity: syncingActivity,
                proposal: proposal,
                using: calendarSync
            )
            syncingActivityIDs.remove(activityID)
            guard let index = activities.firstIndex(where: {
                $0.id == activityID
            }) else { return }

            switch result {
            case let .success(event):
                activities[index] = activities[index]
                    .updatingCalendarSync(
                        .synced,
                        eventIdentifier: event.identifier
                    )
                    .updatingLatestEditAudit(
                        .succeeded,
                        observedEventIdentifier: event.identifier
                    )
            case .failure(.saveFailed):
                activities[index] = activities[index]
                    .updatingCalendarSync(.unknown)
                    .updatingLatestEditAudit(.unknown)
                calendarNotice = appLanguage.text(
                    syncingActivity.hasLinkedCalendarEvent
                        ? "The changes are saved in capri. Apple Calendar returned an uncertain update result; check the linked event before editing again."
                        : "The event is saved in capri. Apple Calendar returned an uncertain result; check Apple Calendar before taking any further action.",
                    zhHans: syncingActivity.hasLinkedCalendarEvent
                        ? "修改已保存到 capri，但 Apple 日历的更新结果不确定；再次修改前请先检查已关联日程。"
                        : "日程已保存到 capri，但 Apple 日历返回了不确定结果；继续操作前请先检查 Apple 日历。"
                )
            case .failure(.eventNotFound):
                activities[index] = activities[index]
                    .updatingCalendarSync(.missing)
                    .updatingLatestEditAudit(.missing)
                calendarNotice = appLanguage.text("The changes are saved in capri, but the linked Apple Calendar event could not be found. Nothing new was created.")
            case .failure(.permissionDenied):
                activities[index] = activities[index]
                    .updatingCalendarSync(
                        .failed,
                        failureReason: .permissionDenied
                    )
                    .updatingLatestEditAudit(
                        .failed,
                        failureReason: .permissionDenied
                    )
                calendarNotice = appLanguage.text(
                    syncingActivity.hasLinkedCalendarEvent
                        ? "The changes are saved in capri, but Apple Calendar needs full access to update the linked event. Allow access in Settings, then try again."
                        : "The event is saved in capri. Allow Calendar access in Settings before trying again.",
                    zhHans: syncingActivity.hasLinkedCalendarEvent
                        ? "修改已保存到 capri，但更新已关联日程需要 Apple 日历完整访问权限。请在“设置”中允许访问，然后重试。"
                        : "日程已保存到 capri。请先在“设置”中允许日历访问，然后重试。"
                )
            case .failure(.noDefaultCalendar):
                activities[index] = activities[index]
                    .updatingCalendarSync(
                        .failed,
                        failureReason: .noDefaultCalendar
                    )
                    .updatingLatestEditAudit(
                        .failed,
                        failureReason: .noDefaultCalendar
                    )
                calendarNotice = appLanguage.text("The event is saved in capri. Choose a default calendar in Apple Calendar, then try again.")
            case .failure(.unsupportedOS):
                activities[index] = activities[index]
                    .updatingCalendarSync(
                        .failed,
                        failureReason: .unsupportedOS
                    )
                    .updatingLatestEditAudit(
                        .failed,
                        failureReason: .unsupportedOS
                    )
                calendarNotice = appLanguage.text("The changes are saved in capri. This Apple Calendar operation requires iOS 17 or later.")
            }
            do {
                try activityStore?.save(activities[index])
            } catch {
                calendarNotice = appLanguage.text(
                    "Calendar sync finished, but its receipt could not be saved in capri."
                )
            }
            // A receipt updates an open detail; it must not reopen a dismissed
            // sheet or replace another activity after the recruiter moves on.
            if case let .detail(visibleActivity) = destination,
               visibleActivity.id == activityID {
                destination = .detail(activities[index])
            }
        }
    }

    private func resumePendingCalendarSync() {
        guard !isPreview else { return }
        for activity in activities where activity.calendarSyncState == .pending {
            syncToCalendar(activityID: activity.id)
        }
    }

    private var calendarPicker: some View {
        VStack(spacing: 8) {
            HStack(spacing: 4) {
                Button {
                    updateCalendar {
                        isMonthExpanded.toggle()
                    }
                } label: {
                    HStack(spacing: 7) {
                        Text(selectedDate.formatted(.dateTime.month(.abbreviated).year().locale(appLanguage.locale)))
                            .font(.headline)
                            .lineLimit(1)
                            .foregroundStyle(Color.tsInk)
                        Image(systemName: "chevron.down")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.tsMutedInk)
                            .rotationEffect(.degrees(isMonthExpanded ? 180 : 0))
                            .animation(calendarMotion, value: isMonthExpanded)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    appLanguage.text(isMonthExpanded ? "Collapse month" : "Expand month")
                )
                .accessibilityValue(monthTitle)
                .accessibilityIdentifier("calendar-toggle-month")

                Spacer(minLength: 8)

                viewOptions

                if isMonthExpanded {
                    HStack(spacing: 0) {
                        monthNavigationButton(
                            symbol: "chevron.left",
                            label: appLanguage.text("Previous month"),
                            identifier: "calendar-previous-month",
                            offset: -1
                        )
                        monthNavigationButton(
                            symbol: "chevron.right",
                            label: appLanguage.text("Next month"),
                            identifier: "calendar-next-month",
                            offset: 1
                        )
                    }
                } else {
                    HStack(spacing: 0) {
                        weekNavigationButton(offset: -1)
                        weekNavigationButton(offset: 1)
                    }
                }
                if isEmbedded { addActivityButton }
            }
            if agendaMode == .day || isMonthExpanded || usesWeekList { calendarGrid }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private var viewOptions: some View {
        Menu {
            Section(appLanguage.text("View")) {
                ForEach(RelationshipCalendarAgenda.Mode.allCases) { mode in
                    Button {
                        agendaMode = mode
                    } label: {
                        Label(appLanguage.text(mode == .day ? "Day agenda" : "Week view"),
                              systemImage: agendaMode == mode ? "checkmark" : (mode == .day ? "list.bullet" : "calendar"))
                    }
                    .accessibilityIdentifier("calendar-view-\(mode.rawValue)")
                }
            }
            Section(appLanguage.text("Go to")) {
                Button(appLanguage.text("Today")) { select(Date()) }
                    .accessibilityIdentifier("calendar-return-today")
                Button(appLanguage.text("This week")) { select(Date()); agendaMode = .week }
                    .accessibilityIdentifier("calendar-return-this-week")
            }
            Section(appLanguage.text("Filter")) {
                Button { destination = .people } label: {
                    Label(appLanguage.text("Filter by person"), systemImage: "person.crop.circle")
                }
                .accessibilityIdentifier("calendar-person-filter")
                if selectedPersonID != nil {
                    Button(appLanguage.text("Clear person filter")) { selectedPersonID = nil }
                }
            }
            Section {
                Text(calendar.timeZone.identifier)
                Text(appLanguage.text("Only capri activities are shown."))
            }
        } label: {
            HStack(spacing: 5) {
                if isEmbedded {
                    Image(systemName: agendaMode == .day ? "list.bullet" : "calendar")
                        .font(.system(size: 18, weight: .medium))
                } else {
                    Text(appLanguage.text(agendaMode == .day ? "Day agenda" : "Week view"))
                    Image(systemName: "chevron.down").font(.caption2.weight(.bold))
                }
            }
            .font(.subheadline.weight(.medium))
            .frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel(appLanguage.text("Calendar view and filters"))
        .accessibilityValue(appLanguage.text(agendaMode == .day ? "Day agenda" : "Week view"))
        .accessibilityIdentifier("calendar-view-options")
    }

    private var calendarGrid: some View {
        VStack(spacing: 6) {
            if isMonthExpanded {
                LazyVGrid(columns: monthColumns, spacing: 4) {
                    ForEach(weekdayHeaderDates, id: \.self) { date in
                        Text(weekdayText(for: date))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.tsMutedInk)
                            .frame(maxWidth: .infinity, minHeight: 28)
                            .accessibilityHidden(true)
                    }
                }
            }

            LazyVGrid(columns: monthColumns, spacing: calendarRowSpacing) {
                ForEach(visibleGridDates, id: \.self) { date in
                    monthDayCell(date)
                }
            }
            .transaction { transaction in
                transaction.disablesAnimations = true
            }
            .frame(height: visibleGridHeight, alignment: .top)
            .animation(calendarMotion, value: isMonthExpanded)
            .clipped()
        }
        .padding(.horizontal, 2)
        .padding(.bottom, 3)
    }

    @ViewBuilder
    private func monthDayCell(_ date: Date) -> some View {
        if isDateInteractive(date) {
            Button { select(date) } label: {
                monthDayLabel(date)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(dayAccessibilityLabel(date))
            .accessibilityAddTraits(isSelected(date) ? .isSelected : [])
            .accessibilityIdentifier("calendar-month-day-\(dayIdentifier(date))")
        } else {
            monthDayLabel(date)
                .accessibilityHidden(true)
        }
    }

    private func monthDayLabel(_ date: Date) -> some View {
        VStack(spacing: 0) {
            if !isMonthExpanded {
                Text(weekdayText(for: date))
                    .font(.caption2)
                    .foregroundStyle(Color.tsMutedInk)
            }
            ZStack(alignment: .bottom) {
                Text(verbatim: "\(calendar.component(.day, from: date))")
                    .font(.subheadline.weight(isSelected(date) ? .bold : .medium))
                    .foregroundStyle(isSelected(date) ? Color.tsSurface : Color.tsInk)
                    .frame(width: 36, height: 36)
                    .background(
                        isSelected(date) ? Color.tsInk : Color.clear,
                        in: Circle()
                    )
                    .overlay {
                        if calendar.isDateInToday(date), !isSelected(date) {
                            Circle().stroke(Color.tsLine, lineWidth: 1)
                        }
                    }

                if hasActivity(on: date) {
                    Circle()
                        .fill(isSelected(date) ? Color.tsSurface : Color.tsInk)
                        .frame(width: 4, height: 4)
                        .offset(y: -2)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Rectangle())
        .opacity(dayOpacity(date))
    }

    private var agendaControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Button { destination = .people } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "person.crop.circle")
                        Text(selectedPerson?.displayLabel ?? appLanguage.text("All people"))
                            .lineLimit(1)
                        Image(systemName: "chevron.down").font(.caption2.weight(.bold))
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.tsInk)
                    .frame(minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(appLanguage.text("Filter by person"))
                .accessibilityValue(selectedPerson?.displayLabel ?? appLanguage.text("All people"))
                .accessibilityIdentifier("calendar-active-person-filter")
                Spacer(minLength: 0)
                if selectedPersonID != nil {
                    Button { selectedPersonID = nil } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Color.tsMutedInk)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(appLanguage.text("Clear person filter"))
                    .accessibilityIdentifier("calendar-clear-person")
                }
            }
        }
    }

    private var agendaHeader: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(focusTitle)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                        .accessibilityAddTraits(.isHeader)
                    Text(agendaSummary)
                        .font(.subheadline)
                        .foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("calendar-agenda-summary")
                }
                Spacer(minLength: 8)
                if let activity = focusActivity {
                    Button { prepare(activity) } label: {
                        Label(
                            appLanguage.text("Prepare"),
                            systemImage: "sparkles"
                        )
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                        .padding(.horizontal, 12)
                        .background(
                            Color.tsSurfaceMuted,
                            in: Capsule()
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(
                        String(
                            format: appLanguage.text("Prepare for %@ with Agent"),
                            locale: appLanguage.locale,
                            activity.personDisplayLabel
                        )
                    )
                    .accessibilityHint(
                        appLanguage.text("Opens an editable Session draft. Nothing is sent yet.")
                    )
                    .accessibilityIdentifier("calendar-prepare-next")
                }
            }
            if isPreview {
                Text(appLanguage.text("Preview · Calendar not read"))
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .accessibilityIdentifier("calendar-preview-boundary")
            }
            if agendaMode == .week && usesWeekList {
                Text(appLanguage.text("Week shown as a list for readable times and text."))
                    .font(.caption).foregroundStyle(Color.tsMutedInk)
                    .accessibilityIdentifier("calendar-week-list-notice")
            }
            if let calendarNotice {
                HStack(alignment: .top, spacing: 10) {
                    Rectangle()
                        .fill(Color.tsVermilion)
                        .frame(width: 2)
                        .accessibilityHidden(true)
                    Label(calendarNotice, systemImage: "exclamationmark.shield")
                        .font(.caption)
                        .foregroundStyle(Color.tsInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 8)
                .accessibilityIdentifier("calendar-reconciliation-notice")
            }
        }
    }

    @ViewBuilder
    private var agenda: some View {
        if selectedActivities.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(appLanguage.text(selectedPersonID == nil
                    ? "No activities in this period" : "No activities for this person in this period"))
                    .font(.headline)
                    .foregroundStyle(Color.tsInk)
                Text(appLanguage.text("Only capri activities are shown."))
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                if let next = nextFilteredActivity {
                    Button { select(next.startDate) } label: {
                        Label(appLanguage.text("Go to next activity"), systemImage: "arrow.right")
                            .frame(minHeight: 44)
                    }
                    .accessibilityIdentifier("calendar-next-activity")
                }
                Button { destination = .create } label: {
                    Label(appLanguage.text("Add activity"), systemImage: "plus")
                        .frame(minHeight: 44)
                }
                .accessibilityIdentifier("calendar-empty-add-activity")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 18)
        } else if agendaMode == .week && !usesWeekList {
            RelationshipCalendarWeekGrid(
                activities: selectedActivities, days: agendaDays, selectedDate: selectedDate,
                calendar: calendar, overlappingIDs: overlappingActivityIDs,
                calendarSyncEnabled: isCalendarSyncEnabled,
                onSelectDay: select,
                onOpen: { destination = .detail($0) },
                onEdit: { destination = .edit($0) },
                onRetryCalendarSync: { syncToCalendar(activityID: $0.id) },
                onOpenPerson: { destination = .person($0.personID) },
                onPrepare: prepare
            )
        } else {
            let overlappingIDs = overlappingActivityIDs
            VStack(alignment: .leading, spacing: 22) {
                ForEach(agendaDays, id: \.self) { day in
                    let dayActivities = RelationshipCalendarAgenda.activities(
                        selectedActivities,
                        in: RelationshipCalendarAgenda.interval(for: day, mode: .day, calendar: calendar)
                    )
                    if !dayActivities.isEmpty {
                        VStack(alignment: .leading, spacing: 0) {
                            if agendaMode == .week {
                                Text(day.formatted(.dateTime.weekday(.wide).month().day().locale(appLanguage.locale)))
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Color.tsInk)
                                    .accessibilityAddTraits(.isHeader)
                            }
                            ForEach(dayActivities) { activity in
                                RelationshipCalendarActivityRow(
                                    activity: activity,
                                    day: day,
                                    hasOverlap: overlappingIDs.contains(activity.id),
                                    onOpen: { destination = .detail(activity) },
                                    onEdit: activity.canEditFromCalendar ? {
                                        destination = .edit(activity)
                                    } : nil,
                                    onRetryCalendarSync: activity.canRetryCalendarSync
                                        && activity.canAttemptDeviceWrite(
                                            calendarSyncEnabled: isCalendarSyncEnabled
                                        )
                                        ? { syncToCalendar(activityID: activity.id) }
                                        : nil,
                                    onOpenPerson: {
                                        destination = .person(activity.personID)
                                    },
                                    onPrepare: { prepare(activity) }
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    private var selectedPerson: WorkspacePerson? {
        snapshot.people.first { $0.id == selectedPersonID }
    }

    private var usesWeekList: Bool {
        dynamicTypeSize >= .xxLarge || agendaDays.contains {
            RelationshipCalendarAgenda.interval(for: $0, mode: .day, calendar: calendar).duration != 86400
        }
    }

    private var agendaInterval: DateInterval {
        RelationshipCalendarAgenda.interval(for: selectedDate, mode: agendaMode, calendar: calendar)
    }

    private var agendaDays: [Date] {
        (0..<(agendaMode == .day ? 1 : 7)).compactMap {
            calendar.date(byAdding: .day, value: $0, to: agendaInterval.start)
        }
    }

    private var focusTitle: String {
        if agendaMode == .week {
            return agendaInterval.contains(Date())
                ? appLanguage.text("This week")
                : appLanguage.text("Week")
        }
        if calendar.isDateInToday(selectedDate) {
            return appLanguage.text("Today")
        }
        if calendar.isDateInTomorrow(selectedDate) {
            return appLanguage.text("Tomorrow")
        }
        return selectedDate.formatted(
            .dateTime.weekday(.wide).locale(appLanguage.locale)
        )
    }

    private var agendaSummary: String {
        let count = selectedActivities.count
        let countText = String(
            format: appLanguage.text(
                count == 1 ? "%d activity" : "%d activities",
                zhHans: "%d 项日程"
            ),
            locale: appLanguage.locale,
            count
        )
        return agendaDateRange + " · " + countText
    }

    private var agendaDateRange: String {
        let start = selectedDate.formatted(.dateTime.month(.wide).day().weekday(.wide).locale(appLanguage.locale))
        guard agendaMode == .week, let last = agendaDays.last else { return start }
        return agendaInterval.start.formatted(.dateTime.month().day().locale(appLanguage.locale))
            + " – " + last.formatted(.dateTime.month().day().locale(appLanguage.locale))
    }

    private var focusActivity: RelationshipCalendarActivity? {
        selectedActivities
            .filter { $0.endDate >= Date() }
            .min { $0.startDate < $1.startDate }
    }

    private var overlappingActivityIDs: Set<String> {
        RelationshipCalendarAgenda.overlappingIDs(in: activities)
    }

    private var nextFilteredActivity: RelationshipCalendarActivity? {
        activities.filter {
            (selectedPersonID == nil || $0.personID == selectedPersonID)
                && $0.startDate >= agendaInterval.end
        }.min { $0.startDate < $1.startDate }
    }

    private func weekNavigationButton(offset: Int) -> some View {
        Button {
            if let date = calendar.date(byAdding: .day, value: offset * 7, to: selectedDate) {
                select(date)
            }
        } label: {
            Image(systemName: offset < 0 ? "chevron.left" : "chevron.right")
                .font(.caption.weight(.bold))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(appLanguage.text(offset < 0 ? "Previous week" : "Next week"))
        .accessibilityIdentifier(offset < 0 ? "calendar-previous-week" : "calendar-next-week")
    }

    private var weekdayHeaderDates: [Date] {
        let start = calendar.dateInterval(of: .weekOfYear, for: selectedDate)?.start
            ?? calendar.startOfDay(for: selectedDate)
        return (0..<7).compactMap {
            calendar.date(byAdding: .day, value: $0, to: start)
        }
    }

    private var monthColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(minimum: 36), spacing: 4), count: 7)
    }

    private var calendarRowSpacing: CGFloat { 4 }

    private var calendarRowHeight: CGFloat { 44 }

    private var calendarMotion: Animation? {
        reduceMotion ? nil : .easeInOut(duration: 0.24)
    }

    private var monthGridDates: [Date] {
        guard let monthInterval = calendar.dateInterval(of: .month, for: selectedDate),
              let days = calendar.range(of: .day, in: .month, for: selectedDate) else {
            return []
        }
        let firstDay = calendar.startOfDay(for: monthInterval.start)
        let weekday = calendar.component(.weekday, from: firstDay)
        let leadingCount = (weekday - calendar.firstWeekday + 7) % 7
        let occupiedCells = leadingCount + days.count
        let totalCells = ((occupiedCells + 6) / 7) * 7
        return (0..<totalCells).compactMap { index in
            calendar.date(
                byAdding: .day,
                value: index - leadingCount,
                to: firstDay
            )
        }
    }

    private var selectedWeekIndex: Int {
        guard let selectedIndex = monthGridDates.firstIndex(where: isSelected) else {
            return 0
        }
        return selectedIndex / 7
    }

    private var visibleGridDates: [Date] {
        guard !isMonthExpanded else { return monthGridDates }
        let start = selectedWeekIndex * 7
        let end = min(start + 7, monthGridDates.count)
        guard start < end else { return [] }
        return Array(monthGridDates[start..<end])
    }

    private var expandedGridHeight: CGFloat {
        let rowCount = max(1, monthGridDates.count / 7)
        return CGFloat(rowCount) * calendarRowHeight
            + CGFloat(max(0, rowCount - 1)) * calendarRowSpacing
    }

    private var visibleGridHeight: CGFloat {
        isMonthExpanded ? expandedGridHeight : 54
    }

    private var monthTitle: String {
        selectedDate.formatted(
            Date.FormatStyle()
                .month(.wide)
                .year()
                .locale(appLanguage.locale)
        )
    }

    private var calendar: Calendar {
        var value = Calendar.autoupdatingCurrent
        value.locale = appLanguage.locale
        return value
    }

    private var selectedActivities: [RelationshipCalendarActivity] {
        RelationshipCalendarAgenda.activities(
            activities, in: agendaInterval, personID: selectedPersonID
        )
    }

    private func isSelected(_ date: Date) -> Bool {
        Calendar.current.isDate(date, inSameDayAs: selectedDate)
    }

    private func hasActivity(on date: Date) -> Bool {
        !activities(on: date).isEmpty
    }

    private func activities(on date: Date) -> [RelationshipCalendarActivity] {
        RelationshipCalendarAgenda.activities(
            activities,
            in: RelationshipCalendarAgenda.interval(for: date, mode: .day, calendar: calendar),
            personID: selectedPersonID
        )
    }

    private func isInSelectedMonth(_ date: Date) -> Bool {
        calendar.isDate(date, equalTo: selectedDate, toGranularity: .month)
    }

    private func isInSelectedWeek(_ date: Date) -> Bool {
        calendar.isDate(date, equalTo: selectedDate, toGranularity: .weekOfYear)
    }

    private func isDateInteractive(_ date: Date) -> Bool {
        isMonthExpanded ? isInSelectedMonth(date) : isInSelectedWeek(date)
    }

    private func dayOpacity(_ date: Date) -> Double {
        if isInSelectedMonth(date) {
            return 1
        }
        return isMonthExpanded ? 0 : 0.32
    }

    private func select(_ date: Date) {
        updateCalendar {
            selectedDate = calendar.startOfDay(for: date)
        }
    }

    private func moveMonth(by offset: Int) {
        guard let currentMonth = calendar.dateInterval(of: .month, for: selectedDate)?.start,
              let targetMonth = calendar.date(byAdding: .month, value: offset, to: currentMonth),
              let targetDays = calendar.range(of: .day, in: .month, for: targetMonth) else {
            return
        }
        let preferredDay = calendar.component(.day, from: selectedDate)
        let targetDay = min(preferredDay, targetDays.count)
        guard let target = calendar.date(byAdding: .day, value: targetDay - 1, to: targetMonth) else {
            return
        }
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            selectedDate = calendar.startOfDay(for: target)
        }
    }

    private func monthNavigationButton(
        symbol: String,
        label: String,
        identifier: String,
        offset: Int
    ) -> some View {
        Button { moveMonth(by: offset) } label: {
            Image(systemName: symbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.tsInk)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
    }

    private func weekdayText(for date: Date) -> String {
        let value = date.formatted(
            Date.FormatStyle()
                .weekday(.narrow)
                .locale(appLanguage.locale)
        )
        return appLanguage.usesSimplifiedChinese() ? value : value.uppercased()
    }

    private func updateCalendar(_ update: () -> Void) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            update()
        }
    }

    private func dayAccessibilityLabel(_ date: Date) -> String {
        let formatted = date.formatted(
            Date.FormatStyle()
                .weekday(.wide)
                .month(.wide)
                .day()
                .locale(appLanguage.locale)
        )
        let count = activities(on: date).count
        return String(
            format: appLanguage.text("%@, %d activities"),
            locale: appLanguage.locale,
            formatted,
            count
        )
    }

    private func dayIdentifier(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

private enum CalendarSheetDestination: Identifiable {
    case detail(RelationshipCalendarActivity)
    case create
    case edit(RelationshipCalendarActivity)
    case people
    case person(String)

    var id: String {
        switch self {
        case let .detail(activity):
            return "detail-\(activity.id)"
        case .create:
            return "create"
        case let .edit(activity):
            return "edit-\(activity.id)"
        case .people:
            return "people"
        case let .person(personID):
            return "person-\(personID)"
        }
    }
}

struct RelationshipCalendarActivityShortcuts: ViewModifier {
    let activityID: String
    let onEdit: (() -> Void)?
    let onRetryCalendarSync: (() -> Void)?
    let onOpen: () -> Void
    let onOpenPerson: () -> Void
    let onPrepare: () -> Void

    @Environment(\.appLanguage) private var appLanguage

    func body(content: Content) -> some View {
        content
            .contextMenu {
                shortcutActions
            }
            .modifier(CalendarOptionalEditAccessibilityAction(onEdit: onEdit))
            .modifier(
                CalendarOptionalRetryAccessibilityAction(
                    onRetryCalendarSync: onRetryCalendarSync
                )
            )
            .accessibilityAction(
                named: Text(
                    appLanguage.text("Open activity")
                )
            ) {
                onOpen()
            }
            .accessibilityAction(
                named: Text(appLanguage.text("View person record"))
            ) {
                onOpenPerson()
            }
            .accessibilityAction(
                named: Text(appLanguage.text("Prepare with Agent"))
            ) {
                onPrepare()
            }
    }

    @ViewBuilder
    private var shortcutActions: some View {
        if let onEdit {
            Button(action: onEdit) {
                Label(
                    appLanguage.text("Edit activity"),
                    systemImage: "pencil"
                )
            }
            .accessibilityIdentifier("calendar-context-edit-\(activityID)")
        }

        if let onRetryCalendarSync {
            Button(action: onRetryCalendarSync) {
                Label(
                    appLanguage.text("Try Calendar sync again"),
                    systemImage: "arrow.clockwise"
                )
            }
            .accessibilityIdentifier("calendar-context-retry-\(activityID)")
        }

        Button(action: onOpen) {
            Label(
                appLanguage.text("Open activity"),
                systemImage: "arrow.up.right.square"
            )
        }
        .accessibilityIdentifier("calendar-context-open-\(activityID)")

        Button(action: onOpenPerson) {
            Label(
                appLanguage.text("View person record"),
                systemImage: "person.crop.rectangle"
            )
        }
        .accessibilityIdentifier("calendar-context-person-\(activityID)")

        Button(action: onPrepare) {
            Label(
                appLanguage.text("Prepare with Agent"),
                systemImage: "sparkles"
            )
        }
        .accessibilityIdentifier("calendar-context-prepare-\(activityID)")
    }
}

private struct CalendarOptionalEditAccessibilityAction: ViewModifier {
    let onEdit: (() -> Void)?
    @Environment(\.appLanguage) private var appLanguage

    @ViewBuilder
    func body(content: Content) -> some View {
        if let onEdit {
            content.accessibilityAction(
                named: Text(appLanguage.text("Edit activity")),
                onEdit
            )
        } else {
            content
        }
    }
}

private struct CalendarOptionalRetryAccessibilityAction: ViewModifier {
    let onRetryCalendarSync: (() -> Void)?
    @Environment(\.appLanguage) private var appLanguage

    @ViewBuilder
    func body(content: Content) -> some View {
        if let onRetryCalendarSync {
            content.accessibilityAction(
                named: Text(appLanguage.text("Try Calendar sync again")),
                onRetryCalendarSync
            )
        } else {
            content
        }
    }
}

private struct RelationshipCalendarActivityRow: View {
    let activity: RelationshipCalendarActivity
    let day: Date
    let hasOverlap: Bool
    let onOpen: () -> Void
    let onEdit: (() -> Void)?
    let onRetryCalendarSync: (() -> Void)?
    let onOpenPerson: () -> Void
    let onPrepare: () -> Void

    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(alignment: .top, spacing: 2) {
            activityButton
            actionMenu
        }
    }

    private var activityButton: some View {
        Button(action: onOpen) {
            Group {
                if dynamicTypeSize >= .xxLarge {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(timeRange).font(.subheadline.monospacedDigit())
                        activityCard
                    }
                } else {
                    HStack(alignment: .top, spacing: 12) {
                        timeColumn.frame(width: 54, alignment: .leading)
                        activityCard
                    }
                    .overlay(alignment: .leading) {
                        Rectangle().fill(Color.tsLine).frame(width: 1)
                            .padding(.leading, 62)
                            .allowsHitTesting(false)
                    }
                }
            }
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .contentShape(Rectangle())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim:
            "\(activity.personDisplayLabel), \(activity.displayTitle(in: appLanguage)), \(timeRange), \(activity.contextDisplayLabel), \(statusText)"
                + (hasOverlap ? ", " + appLanguage.text("Overlaps another capri activity") : "")
        ))
        .accessibilityHint(appLanguage.text("Opens activity details."))
        .accessibilityIdentifier("calendar-activity-\(activity.id)")
        .modifier(
            RelationshipCalendarActivityShortcuts(
                activityID: activity.id,
                onEdit: onEdit,
                onRetryCalendarSync: onRetryCalendarSync,
                onOpen: onOpen,
                onOpenPerson: onOpenPerson,
                onPrepare: onPrepare
            )
        )
    }

    private var actionMenu: some View {
        Menu {
            if let onEdit {
                Button(action: onEdit) {
                    Label(
                        appLanguage.text("Edit activity"),
                        systemImage: "pencil"
                    )
                }
            }
            if let onRetryCalendarSync {
                Button(action: onRetryCalendarSync) {
                    Label(
                        appLanguage.text("Try Calendar sync again"),
                        systemImage: "arrow.clockwise"
                    )
                }
            }
            Button(action: onOpen) {
                Label(
                    appLanguage.text("Open activity"),
                    systemImage: "arrow.up.right.square"
                )
            }
            Button(action: onPrepare) {
                Label(appLanguage.text("Prepare with Agent"), systemImage: "sparkles")
            }
            Button(action: onOpenPerson) {
                Label(appLanguage.text("View person record"), systemImage: "person.crop.rectangle")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(appLanguage.text("Activity actions"))
        .accessibilityIdentifier("calendar-actions-\(activity.id)")
    }

    private var timeColumn: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(timeText(max(activity.startDate, Calendar.current.startOfDay(for: day))))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.tsInk)
            Text(continuesFromEarlier ? appLanguage.text("Continued") : timeText(activity.endDate))
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
        }
        .monospacedDigit()
        .fixedSize(horizontal: false, vertical: true)
    }

    private var activityCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(activity.personDisplayLabel)
                    .font(.headline)
                    .foregroundStyle(Color.tsInk)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(activity.displayTitle(in: appLanguage) + " · " + activity.contextDisplayLabel)
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
                .fixedSize(horizontal: false, vertical: true)
            if !Calendar.current.isDate(activity.startDate, inSameDayAs: activity.endDate) {
                Text(timeRange).font(.caption).foregroundStyle(Color.tsMutedInk)
            }
            if [.pending, .syncing, .failed, .missing, .unknown].contains(activity.calendarSyncState) {
                Text(statusText).font(.caption).foregroundStyle(Color.tsVermilion)
            }
            if hasOverlap {
                Label(appLanguage.text("Overlaps another capri activity"), systemImage: "clock.badge.exclamationmark")
                    .font(.caption)
                    .foregroundStyle(Color.tsVermilion)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.leading, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .leading) {
            Capsule().fill(hasOverlap ? Color.tsVermilion : Color.tsInk.opacity(0.35))
                .frame(width: 2, height: 18).frame(maxHeight: .infinity, alignment: .top)
                .padding(.top, 2)
        }
    }

    private var continuesFromEarlier: Bool {
        activity.startDate < Calendar.current.startOfDay(for: day)
    }

    private var statusText: String {
        if activity.source == .preview { return appLanguage.text("Preview activity") }
        switch activity.calendarSyncState {
        case .failed:
            switch activity.calendarSyncFailureReason {
            case .permissionDenied:
                return appLanguage.text("Calendar access required")
            case .noDefaultCalendar:
                return appLanguage.text("Default calendar required")
            case .unsupportedOS:
                return appLanguage.text("Requires iOS 17 or later")
            case nil:
                return appLanguage.text("Calendar sync failed")
            }
        case .missing:
            return appLanguage.text("Linked Calendar event missing")
        case .unknown: return appLanguage.text("Calendar sync unverified")
        case .pending: return appLanguage.text("Waiting to sync")
        case .syncing: return appLanguage.text("Syncing one way")
        case .disabled, .synced:
            return appLanguage.text(activity.source == .talentSignal ? "Saved in capri" : "Linked relationship activity")
        }
    }

    private var timeRange: String {
        let calendar = Calendar.current
        if calendar.isDate(activity.startDate, inSameDayAs: activity.endDate) {
            return "\(timeText(activity.startDate))–\(timeText(activity.endDate))"
        }
        let format = Date.FormatStyle().month().day().hour().minute().locale(appLanguage.locale)
        return activity.startDate.formatted(format) + " – " + activity.endDate.formatted(format)
    }

    private func timeText(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = appLanguage.locale
        formatter.timeZone = .current
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}

private struct RelationshipCalendarPersonFilter: View {
    let people: [WorkspacePerson]
    let selectedPersonID: String?
    let onSelect: (String?) -> Void
    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                Button { onSelect(nil) } label: {
                    HStack {
                        Label(appLanguage.text("All people"), systemImage: "person.2")
                        Spacer()
                        if selectedPersonID == nil { Image(systemName: "checkmark") }
                    }
                    .frame(minHeight: 44)
                }
                .accessibilityIdentifier("calendar-filter-all")
                ForEach(filteredPeople) { person in
                    Button { onSelect(person.id) } label: {
                        HStack(alignment: .top, spacing: 12) {
                            RelationshipPersonMark(displayName: person.displayLabel, size: 36)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(person.displayLabel).font(.headline)
                                Text(person.contexts.map(\.displayLabel).joined(separator: " · "))
                                    .font(.subheadline)
                                    .foregroundStyle(Color.tsMutedInk)
                                if people.filter({ $0.displayLabel == person.displayLabel }).count > 1 {
                                    Text(String(format: appLanguage.text("Person record · %@"), String(person.id.suffix(8))))
                                        .font(.caption).foregroundStyle(Color.tsMutedInk)
                                }
                            }
                            Spacer(minLength: 0)
                            if selectedPersonID == person.id { Image(systemName: "checkmark") }
                        }
                        .frame(minHeight: 44)
                        .padding(.vertical, 4)
                    }
                    .accessibilityIdentifier("calendar-filter-person-\(person.id)")
                }
                if filteredPeople.isEmpty {
                    Text(appLanguage.text("No matching people"))
                        .foregroundStyle(Color.tsMutedInk)
                }
            }
            .searchable(text: $query, prompt: appLanguage.text("Search people or context"))
            .scrollContentBackground(.hidden)
            .background(Color.tsSurface)
            .navigationTitle(appLanguage.text("Filter by person"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(appLanguage.text("Close")) { dismiss() }
                }
            }
        }
        .tint(.tsInk)
        .presentationDetents([.large])
    }

    private var filteredPeople: [WorkspacePerson] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return people.filter {
            trimmed.isEmpty || $0.displayLabel.localizedCaseInsensitiveContains(trimmed)
                || $0.contexts.contains { $0.displayLabel.localizedCaseInsensitiveContains(trimmed) }
        }.sorted {
            $0.displayLabel == $1.displayLabel ? $0.id < $1.id
                : $0.displayLabel.localizedStandardCompare($1.displayLabel) == .orderedAscending
        }
    }
}

private struct RelationshipCalendarActivityDetail: View {
    let activity: RelationshipCalendarActivity
    let hasOverlap: Bool
    let onEdit: (() -> Void)?
    let onOpenPerson: (() -> Void)?
    let onRetryCalendarSync: (() -> Void)?
    let onPrepare: () -> Void
    let onRecordNotes: (() -> Void)?

    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(activity.personDisplayLabel)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                        .padding(.top, 4)
                    Label(
                        activity.displayTitle(in: appLanguage),
                        systemImage: activity.kind.symbolName
                    )
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                        .padding(.top, 8)
                    Text(activity.contextDisplayLabel)
                        .font(.subheadline)
                        .foregroundStyle(Color.tsMutedInk)
                        .padding(.top, 4)

                    if let onOpenPerson {
                        Button(action: onOpenPerson) {
                            Label(appLanguage.text("View person record"), systemImage: "person.crop.rectangle")
                                .font(.subheadline.weight(.semibold))
                                .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 8)
                        .accessibilityIdentifier("calendar-open-person")
                    }

                    detailLine(icon: "clock", label: appLanguage.text("When"), value: dateRange)
                        .padding(.top, 14)
                    if hasOverlap {
                        Label(appLanguage.text("Overlaps another capri activity"), systemImage: "clock.badge.exclamationmark")
                            .font(.subheadline).foregroundStyle(Color.tsVermilion)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 12)
                    }
                    if activity.source == .preview {
                        Text(sourceText)
                            .font(.caption).foregroundStyle(Color.tsMutedInk)
                            .padding(.top, 12)
                    }
                    if showsSyncAttention {
                        detailLine(icon: calendarSyncIcon, label: appLanguage.text("Apple Calendar"), value: calendarSyncText)
                            .padding(.top, 12)
                    }

                    if let onRetryCalendarSync {
                        Button {
                            onRetryCalendarSync()
                            dismiss()
                        } label: {
                            Label(
                                appLanguage.text("Try Calendar sync again"),
                                systemImage: "arrow.clockwise"
                            )
                            .frame(maxWidth: .infinity, minHeight: 48)
                        }
                        .buttonStyle(TSSecondaryButtonStyle())
                        .padding(.top, 20)
                        .accessibilityIdentifier("calendar-retry-sync")
                    }

                    Button(action: onPrepare) {
                        HStack(spacing: 12) {
                            Image(systemName: "sparkles")
                                .font(.system(size: 18, weight: .medium))
                            Text(
                                appLanguage.text("Prepare with Agent")
                            )
                            Spacer()
                            Image(systemName: "arrow.right")
                                .font(.system(size: 18, weight: .semibold))
                        }
                        .font(.headline)
                        .foregroundStyle(Color.tsSurface)
                        .frame(minHeight: 52)
                        .padding(.horizontal, 16)
                        .background(Color.tsInk, in: RoundedRectangle(cornerRadius: 18))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 30)
                    .accessibilityLabel(
                        String(
                            format: appLanguage.text("Prepare for this %@ with Agent"),
                            locale: appLanguage.locale,
                            activity.kind.title(in: appLanguage).lowercased()
                        )
                    )
                    .accessibilityHint(
                        appLanguage.text(
                            "Returns to the linked Session with an editable draft. Nothing is sent yet."
                        )
                    )
                    .accessibilityIdentifier("calendar-prepare-agent")

                    if let onRecordNotes {
                        Button(action: onRecordNotes) {
                            Label(appLanguage.text("Add meeting notes"), systemImage: "square.and.pencil")
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 48)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(appLanguage.text("Returns to the linked Session with an editable draft. Nothing is sent yet."))
                        .accessibilityIdentifier("calendar-record-notes")
                        .padding(.top, 8)
                    }

                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 14) {
                            detailLine(icon: "globe", label: appLanguage.text("Event time zone"), value: eventZoneTime)
                            if activity.source != .preview {
                                detailLine(icon: "checkmark.shield", label: appLanguage.text("Source"), value: sourceText)
                            }
                            if activity.source == .talentSignal && !showsSyncAttention {
                                detailLine(icon: calendarSyncIcon, label: appLanguage.text("Apple Calendar"), value: calendarSyncText)
                            }
                            if let latestEdit = activity.editHistory.last {
                                detailLine(
                                    icon: "clock.arrow.circlepath",
                                    label: appLanguage.text("Latest reviewed change"),
                                    value: editAuditText(latestEdit)
                                )
                            }
                        }
                        .padding(.vertical, 12)
                    } label: {
                        Text(appLanguage.text("Calendar details"))
                            .font(.subheadline.weight(.medium))
                            .frame(minHeight: 44)
                    }
                    .padding(.top, 18)
                    .accessibilityIdentifier("calendar-details-disclosure")

                }
                .padding(24)
            }
            .background(Color.tsSurface.ignoresSafeArea())
            .navigationTitle(appLanguage.text("Activity"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(appLanguage.text("Close")) {
                        dismiss()
                    }
                }
                if let onEdit {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(appLanguage.text("Edit")) {
                            onEdit()
                        }
                        .font(.subheadline.weight(.semibold))
                        .accessibilityIdentifier("calendar-detail-edit")
                    }
                }
            }
        }
        .tint(.tsInk)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("calendar-activity-detail")
    }

    private var showsSyncAttention: Bool {
        activity.source == .talentSignal && [.pending, .syncing, .failed, .missing, .unknown].contains(activity.calendarSyncState)
    }

    private var dateRange: String {
        let zone = TimeZone(identifier: activity.timeZoneIdentifier) ?? .current
        var eventCalendar = Calendar.current
        eventCalendar.timeZone = zone
        let date = activity.startDate.formatted(
            Date.FormatStyle(
                date: .complete,
                time: .omitted,
                locale: appLanguage.locale,
                timeZone: zone
            )
        )
        let start = timeText(activity.startDate)
        let end = timeText(activity.endDate)
        let endLabel = eventCalendar.isDate(
            activity.startDate,
            inSameDayAs: activity.endDate
        ) ? end : activity.endDate.formatted(
            Date.FormatStyle(
                date: .abbreviated,
                time: .shortened,
                locale: appLanguage.locale,
                timeZone: zone
            )
        )
        return "\(date) · \(start)–\(endLabel) · \(zone.identifier)"
    }

    private var eventZoneTime: String {
        guard let zone = TimeZone(identifier: activity.timeZoneIdentifier) else {
            return activity.timeZoneIdentifier
        }
        let format = Date.FormatStyle(date: .abbreviated, time: .shortened,
                                      locale: appLanguage.locale, timeZone: zone)
        return activity.startDate.formatted(format) + " – " + activity.endDate.formatted(format)
            + " · " + zone.identifier
    }

    private var sourceText: String {
        switch activity.source {
        case .governed:
            return appLanguage.text("Linked relationship activity")
        case .preview:
            return appLanguage.text("Synthetic preview · not in Apple Calendar")
        case .talentSignal:
            return appLanguage.text("Confirmed in capri")
        }
    }

    private var calendarSyncText: String {
        switch activity.calendarSyncState {
        case .disabled:
            return appLanguage.text("Off · event stays in capri")
        case .pending:
            return appLanguage.text("Waiting to sync")
        case .syncing:
            return appLanguage.text("Syncing one way")
        case .synced:
            return appLanguage.text("Synced one way")
        case .failed:
            switch activity.calendarSyncFailureReason {
            case .permissionDenied:
                return appLanguage.text("Calendar access required · allow it in Settings, then retry")
            case .noDefaultCalendar:
                return appLanguage.text("Default calendar required · choose one, then retry")
            case .unsupportedOS:
                return appLanguage.text("Requires iOS 17 or later · event kept in capri")
            case nil:
                return appLanguage.text("Sync failed · event kept in capri")
            }
        case .missing:
            return appLanguage.text("Linked event missing · no replacement created")
        case .unknown:
            return appLanguage.text("Sync result unknown · check Apple Calendar")
        }
    }

    private var calendarSyncIcon: String {
        switch activity.calendarSyncState {
        case .disabled:
            return "calendar.badge.minus"
        case .pending:
            return "clock"
        case .syncing:
            return "arrow.up.forward.app"
        case .synced:
            return "checkmark.circle"
        case .failed:
            return "exclamationmark.triangle"
        case .missing:
            return "calendar.badge.exclamationmark"
        case .unknown:
            return "questionmark.diamond"
        }
    }

    private func editAuditText(
        _ audit: RelationshipCalendarActivity.EditAuditEntry
    ) -> String {
        var lines: [String] = []
        if audit.before.kind != audit.after.kind {
            lines.append(
                appLanguage.text("Type") + ": "
                    + editKindTitle(audit.before.kind) + " → "
                    + editKindTitle(audit.after.kind)
            )
        }
        if audit.before.title != audit.after.title {
            lines.append(
                appLanguage.text("Title") + ": "
                    + audit.before.title + " → " + audit.after.title
            )
        }
        if audit.before.startDate != audit.after.startDate
            || audit.before.endDate != audit.after.endDate {
            lines.append(
                appLanguage.text("When") + ": "
                    + auditTimeRange(audit.before) + " → "
                    + auditTimeRange(audit.after)
            )
        }
        lines.append(editAuditEffect(audit) + " · " + editAuditStatus(audit.status))
        lines.append(
            String(
                format: appLanguage.text("Reviewed %@ · operation %@"),
                locale: appLanguage.locale,
                audit.reviewedAt.formatted(
                    .dateTime.month().day().hour().minute().locale(appLanguage.locale)
                ),
                String(audit.id.prefix(8))
            )
        )
        return lines.joined(separator: "\n")
    }

    private func editKindTitle(_ rawValue: String) -> String {
        RelationshipCalendarActivity.Kind(rawValue: rawValue)?.title(in: appLanguage)
            ?? rawValue
    }

    private func auditTimeRange(
        _ snapshot: RelationshipCalendarActivity.EditSnapshot
    ) -> String {
        let timeZone = TimeZone(identifier: snapshot.timeZoneIdentifier) ?? .current
        let style = Date.FormatStyle(
            date: .abbreviated,
            time: .shortened,
            locale: appLanguage.locale,
            timeZone: timeZone
        )
        return snapshot.startDate.formatted(style) + "–"
            + snapshot.endDate.formatted(style)
    }

    private func editAuditEffect(
        _ audit: RelationshipCalendarActivity.EditAuditEntry
    ) -> String {
        switch audit.effect {
        case .localOnly:
            return appLanguage.text("capri only")
        case .create:
            return appLanguage.text("Apple Calendar add")
        case .update:
            return appLanguage.text("Apple Calendar update")
        }
    }

    private func editAuditStatus(
        _ status: RelationshipCalendarActivity.EditAuditEntry.Status
    ) -> String {
        switch status {
        case .reviewed:
            return appLanguage.text("Reviewed · waiting")
        case .writing:
            return appLanguage.text("Updating")
        case .succeeded:
            return appLanguage.text("Verified")
        case .failed:
            return appLanguage.text("Failed · safe to retry")
        case .missing:
            return appLanguage.text("Linked event missing")
        case .unknown:
            return appLanguage.text("Result unknown · check Apple Calendar")
        }
    }

    private func detailLine(icon: String, label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(Color.tsMutedInk)
                .frame(width: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(displayLabel(label))
                    .font(.caption2.weight(.bold))
                    .tracking(appLanguage.usesSimplifiedChinese() ? 0 : 0.8)
                    .foregroundStyle(Color.tsMutedInk)
                Text(value)
                    .font(.subheadline)
                    .foregroundStyle(Color.tsInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func displayLabel(_ label: String) -> String {
        appLanguage.usesSimplifiedChinese() ? label : label.uppercased()
    }

    private func timeText(_ date: Date) -> String {
        let zone = TimeZone(identifier: activity.timeZoneIdentifier) ?? .current
        return date.formatted(
            Date.FormatStyle(
                date: .omitted,
                time: .shortened,
                locale: appLanguage.locale,
                timeZone: zone
            )
        )
    }
}

private struct RelationshipPersonMark: View {
    let displayName: String
    let size: CGFloat

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.28, weight: .semibold, design: .rounded))
            .foregroundStyle(Color.tsInk)
            .frame(width: size, height: size)
            .background(Color.tsSurfaceMuted, in: Circle())
            .overlay {
                Circle()
                    .stroke(Color.tsLine, lineWidth: 1)
            }
            .accessibilityHidden(true)
    }

    private var initials: String {
        let words = displayName.split(whereSeparator: { $0.isWhitespace })
        if words.count > 1 {
            return words.prefix(2).compactMap(\.first).map(String.init).joined()
        }
        return displayName.first.map(String.init) ?? "–"
    }
}

private struct RelationshipCalendarScope: Identifiable, Hashable {
    let personID: String
    let relationshipContextID: String
    let personDisplayLabel: String
    let contextDisplayLabel: String

    var id: String { "\(personID):\(relationshipContextID)" }
}

@MainActor
private struct RelationshipCalendarComposer: View {
    private enum Phase {
        case edit
        case review
    }

    let snapshot: PursuitWorkspaceSnapshot
    let syncsToCalendar: Bool
    let isPreview: Bool
    let original: RelationshipCalendarActivity?
    let onConfirmed: (RelationshipCalendarActivity) -> Void
    private let activityID: String

    @Environment(\.appLanguage) private var appLanguage
    @Environment(\.dismiss) private var dismiss
    @State private var selectedScopeID: String
    @State private var selectedKind: RelationshipCalendarActivity.Kind
    @State private var title: String
    @State private var titleWasEdited: Bool
    @State private var startDate: Date
    @State private var durationMinutes: Int
    @State private var phase: Phase = .edit

    init(
        snapshot: PursuitWorkspaceSnapshot,
        syncsToCalendar: Bool,
        isPreview: Bool,
        selectedDate: Date,
        preferredPersonID: String?,
        original: RelationshipCalendarActivity?,
        onConfirmed: @escaping (RelationshipCalendarActivity) -> Void
    ) {
        self.snapshot = snapshot
        self.syncsToCalendar = syncsToCalendar
        self.isPreview = isPreview
        self.original = original
        self.onConfirmed = onConfirmed
        activityID = original?.id ?? "calendar-\(UUID().uuidString.lowercased())"
        let scopes = Self.scopes(in: snapshot)
        _selectedScopeID = State(initialValue:
            original.map { "\($0.personID):\($0.relationshipContextID)" }
                ?? scopes.first(where: { $0.personID == preferredPersonID })?.id
                ?? scopes.first?.id
                ?? ""
        )
        let initialStart = original?.startDate
            ?? RelationshipCalendarAgenda.suggestedStart(
                on: selectedDate,
                calendar: .current
            )
        _selectedKind = State(initialValue: original?.kind ?? .interview)
        _title = State(initialValue: original?.title ?? "")
        _titleWasEdited = State(initialValue: original != nil)
        _startDate = State(initialValue: initialStart)
        _durationMinutes = State(
            initialValue: original.map {
                max(15, Int(($0.endDate.timeIntervalSince($0.startDate) / 60).rounded()))
            } ?? 30
        )
    }

    var body: some View {
        NavigationStack {
            Group {
                if phase == .review, let original, let activity {
                    editReview(original: original, revised: activity)
                } else {
                    editorForm
                }
            }
            .background(Color.tsSurface)
            .navigationTitle(
                appLanguage.text(
                    phase == .review ? "Review changes" : original == nil
                        ? "Add activity" : "Edit activity",
                    zhHans: phase == .review ? "审阅修改" : original == nil
                        ? "添加日程" : "修改日程"
                )
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(
                        appLanguage.text(
                            phase == .review ? "Back" : "Cancel",
                            zhHans: phase == .review ? "返回" : "取消"
                        )
                    ) {
                        if phase == .review {
                            phase = .edit
                        } else {
                            dismiss()
                        }
                    }
                }
                if phase == .edit {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(
                            appLanguage.text(
                                original == nil ? "Confirm" : "Review",
                                zhHans: original == nil ? "确认" : "审阅"
                            )
                        ) {
                            guard let activity else { return }
                            if original == nil {
                                onConfirmed(activity)
                            } else {
                                phase = .review
                            }
                        }
                        .font(.subheadline.weight(.semibold))
                        .disabled(!canContinue)
                        .accessibilityHint(continueHint)
                        .accessibilityIdentifier(
                            original == nil
                                ? "calendar-confirm-activity"
                                : "calendar-review-activity-edit"
                        )
                    }
                }
            }
        }
        .tint(.tsInk)
        .task { updateDefaultTitleIfNeeded() }
        .onChange(of: selectedScopeID) { _ in
            updateDefaultTitleIfNeeded()
        }
        .onChange(of: selectedKind) { _ in
            updateDefaultTitleIfNeeded()
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("relationship-calendar-composer")
    }

    private var editorForm: some View {
        Form {
            Section(appLanguage.text("Relationship")) {
                if let original {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(original.personDisplayLabel)
                            .font(.subheadline.weight(.semibold))
                        Text(original.contextDisplayLabel)
                            .font(.subheadline)
                            .foregroundStyle(Color.tsMutedInk)
                        Text(
                            appLanguage.text("Relationship stays unchanged when editing from Calendar.")
                        )
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("calendar-edit-locked-scope")
                } else if scopes.isEmpty {
                    Text(appLanguage.text("No confirmed relationship is available."))
                        .foregroundStyle(Color.tsMutedInk)
                } else {
                    Picker(
                        appLanguage.text("Person and context"),
                        selection: $selectedScopeID
                    ) {
                        ForEach(scopes) { scope in
                            Text(verbatim: "\(scope.personDisplayLabel) · \(scope.contextDisplayLabel)")
                                .tag(scope.id)
                        }
                    }
                    if let selectedScope {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(selectedScope.personDisplayLabel)
                                .font(.subheadline.weight(.semibold))
                            Text(selectedScope.contextDisplayLabel)
                                .font(.subheadline)
                                .foregroundStyle(Color.tsMutedInk)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("calendar-selected-scope")
                    }
                }
            }

            Section(appLanguage.text("Activity")) {
                Picker(
                    appLanguage.text("Activity type"),
                    selection: $selectedKind
                ) {
                    ForEach(RelationshipCalendarActivity.Kind.allCases) { kind in
                        Label(kind.title(in: appLanguage), systemImage: kind.symbolName)
                            .tag(kind)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("calendar-activity-kind")
                TextField(
                    appLanguage.text("Title"),
                    text: $title,
                    onEditingChanged: { editing in
                        if editing { titleWasEdited = true }
                    }
                )
                .accessibilityIdentifier("calendar-activity-title")
                DatePicker(
                    appLanguage.text("Starts"),
                    selection: $startDate,
                    displayedComponents: [.date, .hourAndMinute]
                )
                .environment(\.timeZone, editorTimeZone)
                .accessibilityIdentifier("calendar-activity-start")
                Picker(appLanguage.text("Duration"), selection: $durationMinutes) {
                    ForEach(durationOptions, id: \.self) { minutes in
                        Text(durationLabel(minutes)).tag(minutes)
                    }
                }
                .accessibilityIdentifier("calendar-activity-duration")
                Text(TimeZone(identifier: timeZoneIdentifier)?.identifier ?? timeZoneIdentifier)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .accessibilityLabel(
                        appLanguage.text("Event time zone") + ": " + timeZoneIdentifier
                    )
            }

            Section {
                Label(editorBoundaryText, systemImage: editorBoundaryIcon)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("calendar-editor-boundary")
            }
        }
        .scrollContentBackground(.hidden)
    }

    private func editReview(
        original: RelationshipCalendarActivity,
        revised: RelationshipCalendarActivity
    ) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(revised.personDisplayLabel)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                Text(revised.contextDisplayLabel)
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                    .padding(.top, 3)

                Text(appLanguage.text("Changes"))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.tsMutedInk)
                    .textCase(appLanguage.usesSimplifiedChinese() ? nil : .uppercase)
                    .padding(.top, 24)

                VStack(spacing: 0) {
                    ForEach(revised.changedEditableFields(from: original), id: \.rawValue) { field in
                        editChangeRow(field, original: original, revised: revised)
                    }
                }
                .padding(.top, 4)

                Divider().padding(.vertical, 22)

                Label(externalEffectTitle(original), systemImage: externalEffectIcon(original))
                    .font(.headline)
                    .foregroundStyle(Color.tsInk)
                Text(externalEffectDetail(original))
                    .font(.subheadline)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 7)
                    .accessibilityIdentifier("calendar-edit-external-effect")

                Button {
                    onConfirmed(revised)
                } label: {
                    Text(appLanguage.text("Update activity"))
                        .font(.headline)
                        .foregroundStyle(Color.tsSurface)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(Color.tsInk, in: RoundedRectangle(cornerRadius: 18))
                }
                .buttonStyle(.plain)
                .padding(.top, 28)
                .accessibilityHint(confirmEditHint(original))
                .accessibilityIdentifier("calendar-confirm-activity-edit")
            }
            .padding(24)
        }
        .scrollIndicators(.hidden)
        .accessibilityIdentifier("calendar-activity-edit-review")
    }

    private var scopes: [RelationshipCalendarScope] {
        Self.scopes(in: snapshot)
    }

    private var selectedScope: RelationshipCalendarScope? {
        scopes.first { $0.id == selectedScopeID }
    }

    private var activity: RelationshipCalendarActivity? {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else { return nil }
        let endDate = startDate.addingTimeInterval(TimeInterval(durationMinutes * 60))
        if let original {
            return original.revised(
                kind: selectedKind,
                title: trimmedTitle,
                startDate: startDate,
                endDate: endDate,
                calendarSyncEnabled: syncsToCalendar
            )
        }
        guard let selectedScope else { return nil }
        return RelationshipCalendarActivity(
            id: activityID,
            kind: selectedKind,
            title: trimmedTitle,
            personID: selectedScope.personID,
            relationshipContextID: selectedScope.relationshipContextID,
            personDisplayLabel: selectedScope.personDisplayLabel,
            contextDisplayLabel: selectedScope.contextDisplayLabel,
            startDate: startDate,
            endDate: endDate,
            timeZoneIdentifier: timeZoneIdentifier,
            source: isPreview ? .preview : .talentSignal,
            eventIdentifier: nil,
            calendarSyncState: syncsToCalendar && !isPreview ? .pending : .disabled,
            lastCalendarSyncAttempt: nil
        )
    }

    private func updateDefaultTitleIfNeeded() {
        guard original == nil, !titleWasEdited, let selectedScope else { return }
        title = "\(selectedKind.title(in: appLanguage)) · \(selectedScope.personDisplayLabel)"
    }

    private var canContinue: Bool {
        guard let activity else { return false }
        guard let original else { return true }
        return !activity.changedEditableFields(from: original).isEmpty
    }

    private var timeZoneIdentifier: String {
        original?.timeZoneIdentifier ?? TimeZone.current.identifier
    }

    private var editorTimeZone: TimeZone {
        TimeZone(identifier: timeZoneIdentifier) ?? .current
    }

    private var durationOptions: [Int] {
        Array(Set([15, 30, 45, 60, 90, 120, durationMinutes])).sorted()
    }

    private func durationLabel(_ minutes: Int) -> String {
        String(
            format: appLanguage.text("%d min"),
            locale: appLanguage.locale,
            minutes
        )
    }

    private var editorBoundaryText: String {
        if isPreview {
            return appLanguage.text("Preview only · nothing is added to Apple Calendar.")
        }
        if let original {
            if original.hasLinkedCalendarEvent {
                return appLanguage.text("Review the differences before updating the linked Apple Calendar event.")
            }
            if retriesUnlinkedCalendarAdd(original) {
                return appLanguage.text("Review the differences before retrying Apple Calendar with the edited details.")
            }
            return appLanguage.text("This activity has no linked Apple Calendar event; editing changes capri only.")
        }
        return appLanguage.text(
            syncsToCalendar
                ? "Confirm to save here and sync to Apple Calendar."
                : "Confirm to save in capri. Calendar sync is off."
        )
    }

    private var editorBoundaryIcon: String {
        if isPreview { return "eye" }
        if original?.hasLinkedCalendarEvent == true {
            return "arrow.triangle.2.circlepath"
        }
        return syncsToCalendar ? "arrow.up.forward.app" : "checkmark.circle"
    }

    private var continueHint: String {
        if original != nil {
            return appLanguage.text("Shows every changed field and the exact Apple Calendar effect, if any, before updating.")
        }
        return appLanguage.text(
            syncsToCalendar
                ? "Saves in capri, then syncs one way to Apple Calendar."
                : "Saves in capri without changing Apple Calendar."
        )
    }

    private func editChangeRow(
        _ field: RelationshipCalendarActivity.EditableField,
        original: RelationshipCalendarActivity,
        revised: RelationshipCalendarActivity
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(editFieldLabel(field))
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(editFieldValue(field, activity: original))
                    .foregroundStyle(Color.tsMutedInk)
                    .strikethrough()
                Image(systemName: "arrow.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsMutedInk)
                    .accessibilityHidden(true)
                Text(editFieldValue(field, activity: revised))
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.tsInk)
            }
            .font(.subheadline)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("calendar-edit-change-\(field.rawValue)")
    }

    private func editFieldLabel(
        _ field: RelationshipCalendarActivity.EditableField
    ) -> String {
        switch field {
        case .kind: return appLanguage.text("Type")
        case .title: return appLanguage.text("Title")
        case .startDate: return appLanguage.text("Starts")
        case .endDate: return appLanguage.text("Ends")
        }
    }

    private func editFieldValue(
        _ field: RelationshipCalendarActivity.EditableField,
        activity: RelationshipCalendarActivity
    ) -> String {
        switch field {
        case .kind:
            return activity.kind.title(in: appLanguage)
        case .title:
            return activity.title
        case .startDate:
            return editDateTime(activity.startDate)
        case .endDate:
            return editDateTime(activity.endDate)
        }
    }

    private func editDateTime(_ date: Date) -> String {
        date.formatted(
            Date.FormatStyle(
                date: .abbreviated,
                time: .shortened,
                locale: appLanguage.locale,
                timeZone: editorTimeZone
            )
        )
    }

    private func externalEffectTitle(
        _ original: RelationshipCalendarActivity
    ) -> String {
        if isPreview {
            return appLanguage.text("Preview only")
        }
        if original.hasLinkedCalendarEvent {
            return appLanguage.text("Updates the linked Apple Calendar event")
        }
        if retriesUnlinkedCalendarAdd(original) {
            return appLanguage.text("Retries one Apple Calendar event")
        }
        return appLanguage.text("capri only")
    }

    private func externalEffectDetail(
        _ original: RelationshipCalendarActivity
    ) -> String {
        if isPreview {
            return appLanguage.text("The preview changes in this session. No Calendar permission is requested and nothing is written externally.")
        }
        if original.hasLinkedCalendarEvent {
            return appLanguage.text("capri first records this reviewed change, then finds the existing event by its saved identifier and updates that event only. It never creates a replacement.")
        }
        if retriesUnlinkedCalendarAdd(original) {
            return appLanguage.text("The earlier add did not complete. Confirming saves these changes, then retries one Calendar add without changing the relationship.")
        }
        return appLanguage.text("No linked Apple Calendar event exists, so this edit changes the capri activity only.")
    }

    private func externalEffectIcon(
        _ original: RelationshipCalendarActivity
    ) -> String {
        if isPreview { return "eye" }
        if original.hasLinkedCalendarEvent { return "calendar.badge.clock" }
        if retriesUnlinkedCalendarAdd(original) { return "arrow.clockwise" }
        return "checkmark.circle"
    }

    private func confirmEditHint(
        _ original: RelationshipCalendarActivity
    ) -> String {
        if isPreview {
            return appLanguage.text("Saves the reviewed changes in capri without updating an existing Apple Calendar event.")
        }
        if retriesUnlinkedCalendarAdd(original) {
            return appLanguage.text("Saves the reviewed changes, then retries adding one Apple Calendar event.")
        }
        if !original.hasLinkedCalendarEvent {
            return appLanguage.text("Saves the reviewed changes in capri without changing Apple Calendar.")
        }
        return appLanguage.text("Saves the reviewed changes, then updates only the linked Apple Calendar event.")
    }

    private func retriesUnlinkedCalendarAdd(
        _ original: RelationshipCalendarActivity
    ) -> Bool {
        syncsToCalendar
            && original.calendarSyncState == .failed
            && !original.hasLinkedCalendarEvent
    }

    private static func scopes(
        in snapshot: PursuitWorkspaceSnapshot
    ) -> [RelationshipCalendarScope] {
        snapshot.people.flatMap { person in
            person.contexts.map { context in
                RelationshipCalendarScope(
                    personID: person.id,
                    relationshipContextID: context.id,
                    personDisplayLabel: person.displayLabel,
                    contextDisplayLabel: context.displayLabel
                )
            }
        }
    }
}

#Preview("Relationship calendar") {
    let snapshot = PursuitWorkspaceSnapshot.preview
    RelationshipCalendarView(
        snapshot: snapshot,
        isPreview: true,
        initialActivities: RelationshipCalendarProjection.activities(
            snapshot: snapshot,
            isPreview: true
        ),
        onPrepare: { _ in }
    )
}
