import SwiftUI

/// Clock geometry is used only for regular 24-hour days. Irregular DST days
/// and large text use the chronological agenda in the parent view.
enum RelationshipCalendarWeekLayout {
    static let hourHeight: CGFloat = 80
    static let minimumEventHeight: CGFloat = 48

    struct Placement: Identifiable {
        let activity: RelationshipCalendarActivity
        let startMinute: Double
        let endMinute: Double
        let renderedEndMinute: Double
        let lane: Int
        var laneCount: Int
        var id: String { activity.id }
        var height: CGFloat { CGFloat(renderedEndMinute - startMinute) / 60 * hourHeight }
    }

    static func placements(
        for activities: [RelationshipCalendarActivity], on day: Date, calendar: Calendar
    ) -> [Placement] {
        let interval = RelationshipCalendarAgenda.interval(for: day, mode: .day, calendar: calendar)
        let events = RelationshipCalendarAgenda.activities(activities, in: interval)
        var result: [Placement] = []
        var laneEnds: [Double] = []
        var groupStart = 0
        var groupEnd: Double = -1
        func minute(_ date: Date) -> Double {
            // Parent declines clock geometry on non-24-hour days.
            max(0, min(1440, date.timeIntervalSince(interval.start) / 60))
        }
        for event in events {
            let start = minute(event.startDate)
            let end = minute(event.endDate)
            let renderedEnd = max(end, start + Double(minimumEventHeight / hourHeight) * 60)
            if start >= groupEnd {
                for index in groupStart..<result.count { result[index].laneCount = laneEnds.count }
                groupStart = result.count
                laneEnds = []
            }
            let lane = laneEnds.firstIndex(where: { $0 <= start }) ?? laneEnds.count
            if lane == laneEnds.count { laneEnds.append(renderedEnd) } else { laneEnds[lane] = renderedEnd }
            result.append(Placement(activity: event, startMinute: start, endMinute: end,
                                    renderedEndMinute: renderedEnd, lane: lane, laneCount: 1))
            groupEnd = laneEnds.max() ?? renderedEnd
        }
        for index in groupStart..<result.count { result[index].laneCount = laneEnds.count }
        return result
    }

    static func hourRange(for placements: [Placement]) -> ClosedRange<Int> {
        let first = Int(floor((placements.map(\.startMinute).min() ?? 540) / 60))
        let last = Int(ceil((placements.map(\.endMinute).max() ?? 1020) / 60))
        let start = max(0, min(20, first - 1))
        return start...min(24, max(start + 4, last + 1))
    }
}

struct RelationshipCalendarWeekGrid: View {
    let activities: [RelationshipCalendarActivity]
    let days: [Date]
    let selectedDate: Date
    let calendar: Calendar
    let overlappingIDs: Set<String>
    let calendarSyncEnabled: Bool
    let onSelectDay: (Date) -> Void
    let onOpen: (RelationshipCalendarActivity) -> Void
    let onEdit: (RelationshipCalendarActivity) -> Void
    let onRetryCalendarSync: (RelationshipCalendarActivity) -> Void
    let onOpenPerson: (RelationshipCalendarActivity) -> Void
    let onPrepare: (RelationshipCalendarActivity) -> Void
    @Environment(\.appLanguage) private var appLanguage

    private var layouts: [[RelationshipCalendarWeekLayout.Placement]] {
        days.map { RelationshipCalendarWeekLayout.placements(for: activities, on: $0, calendar: calendar) }
    }
    private var hours: ClosedRange<Int> { RelationshipCalendarWeekLayout.hourRange(for: layouts.flatMap { $0 }) }
    private var gridHeight: CGFloat { CGFloat(hours.upperBound - hours.lowerBound) * RelationshipCalendarWeekLayout.hourHeight }
    private var columnWidth: CGFloat {
        // Keep even dense overlapping events independently tappable.
        max(152, CGFloat(layouts.flatMap { $0 }.map(\.laneCount).max() ?? 1) * 96)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(appLanguage.text("Swipe across to see the week"))
                .font(.caption).foregroundStyle(Color.tsMutedInk)
            HStack(alignment: .top, spacing: 0) {
                hourRail.frame(width: 48)
                ScrollViewReader { proxy in
                    ScrollView(.horizontal) {
                        HStack(alignment: .top, spacing: 0) {
                            ForEach(Array(days.enumerated()), id: \.element) { index, day in
                                dayColumn(day, placements: layouts[index]).id(day)
                            }
                        }
                    }
                    .scrollIndicators(.visible)
                    .onAppear { proxy.scrollTo(calendar.startOfDay(for: selectedDate), anchor: .center) }
                    .onChange(of: selectedDate) { date in
                        proxy.scrollTo(calendar.startOfDay(for: date), anchor: .center)
                    }
                }
                .accessibilityIdentifier("calendar-week-columns")
            }
            Text(calendar.timeZone.identifier + " · " + appLanguage.text("Only capri activities are shown."))
                .font(.caption).foregroundStyle(Color.tsMutedInk)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("calendar-week-grid")
    }

    private var hourRail: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: 52)
            ZStack(alignment: .topLeading) {
                ForEach(Array(hours), id: \.self) { hour in
                    HStack(spacing: 3) {
                        Text(String(format: "%02d:00", hour))
                            .font(.caption2.monospacedDigit()).foregroundStyle(Color.tsMutedInk)
                            .accessibilityIdentifier("calendar-hour-\(hour)")
                        Rectangle().fill(Color.tsLine).frame(width: 5, height: 1)
                    }
                    .offset(y: CGFloat(hour - hours.lowerBound) * RelationshipCalendarWeekLayout.hourHeight - 7)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: gridHeight + RelationshipCalendarWeekLayout.minimumEventHeight, alignment: .top)
        }
        .accessibilityIdentifier("calendar-week-hour-rail")
    }

    private func dayColumn(_ day: Date, placements: [RelationshipCalendarWeekLayout.Placement]) -> some View {
        VStack(spacing: 0) {
            Button { onSelectDay(day) } label: {
                HStack(spacing: 6) {
                    Text(day.formatted(.dateTime.weekday(.abbreviated).locale(appLanguage.locale)))
                        .foregroundStyle(Color.tsMutedInk)
                    Text(String(calendar.component(.day, from: day)))
                        .fontWeight(.semibold)
                        .foregroundStyle(calendar.isDate(day, inSameDayAs: selectedDate) ? Color.tsSurface : Color.tsInk)
                        .frame(width: 28, height: 28)
                        .background(calendar.isDate(day, inSameDayAs: selectedDate) ? Color.tsInk : Color.clear, in: Circle())
                }
                .font(.subheadline).frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).month().day().locale(appLanguage.locale)))
            .accessibilityAddTraits(calendar.isDate(day, inSameDayAs: selectedDate) ? .isSelected : [])
            .padding(.bottom, 8)
            ZStack(alignment: .topLeading) {
                Rectangle().fill(Color.tsLine.opacity(0.7)).frame(width: 0.5)
                ForEach(Array(hours), id: \.self) { hour in
                    Rectangle().fill(Color.tsLine.opacity(0.65)).frame(height: 0.5)
                        .offset(y: CGFloat(hour - hours.lowerBound) * RelationshipCalendarWeekLayout.hourHeight)
                }
                ForEach(placements) { placement in
                    event(placement)
                        .frame(width: columnWidth / CGFloat(placement.laneCount) - 6, height: placement.height - 2, alignment: .topLeading)
                        .offset(x: CGFloat(placement.lane) * columnWidth / CGFloat(placement.laneCount) + 3,
                                y: CGFloat(placement.startMinute / 60 - Double(hours.lowerBound)) * RelationshipCalendarWeekLayout.hourHeight)
                }
            }
            .frame(height: gridHeight + RelationshipCalendarWeekLayout.minimumEventHeight)
        }
        .frame(width: columnWidth)
    }

    private func event(_ placement: RelationshipCalendarWeekLayout.Placement) -> some View {
        let activity = placement.activity
        let needsAttention = overlappingIDs.contains(activity.id) || [.failed, .missing, .unknown].contains(activity.calendarSyncState)
        return Button { onOpen(activity) } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(activity.personDisplayLabel)
                    .font(.subheadline.weight(.semibold)).lineLimit(placement.height >= 66 ? 2 : 1)
                Text(clockRange(placement))
                    .font(.caption2.monospacedDigit()).lineLimit(1)
                if placement.height >= 86 {
                    Text(activity.displayTitle(in: appLanguage))
                        .font(.caption).foregroundStyle(Color.tsMutedInk).lineLimit(1)
                }
            }
            .foregroundStyle(Color.tsInk)
            .padding(.horizontal, 8).padding(.vertical, 6)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 6))
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: 1).fill(needsAttention ? Color.tsVermilion : Color.tsInk.opacity(0.4))
                    .frame(width: 2).padding(.vertical, 5)
            }
            .overlay(alignment: .topTrailing) {
                if needsAttention {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.caption2).foregroundStyle(Color.tsVermilion).padding(3)
                }
            }
            .clipped()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(activity.personDisplayLabel + ", " + activity.displayTitle(in: appLanguage) + ", "
            + activity.contextDisplayLabel + ", " + timeRange(activity)
            + (overlappingIDs.contains(activity.id) ? ", " + appLanguage.text("Overlaps another capri activity") : "")
            + (activity.calendarSyncState == .failed ? ", " + appLanguage.text("Calendar sync failed") : "")
            + (activity.calendarSyncState == .missing ? ", " + appLanguage.text("Linked Calendar event missing") : "")
            + (activity.calendarSyncState == .unknown ? ", " + appLanguage.text("Calendar sync unverified") : ""))
        .accessibilityHint(appLanguage.text("Opens activity details."))
        .accessibilityIdentifier("calendar-activity-\(activity.id)")
        .modifier(
            RelationshipCalendarActivityShortcuts(
                activityID: activity.id,
                onEdit: activity.canEditFromCalendar ? { onEdit(activity) } : nil,
                onRetryCalendarSync: activity.canRetryCalendarSync
                    && activity.canAttemptDeviceWrite(
                        calendarSyncEnabled: calendarSyncEnabled
                    )
                    ? { onRetryCalendarSync(activity) }
                    : nil,
                onOpen: { onOpen(activity) },
                onOpenPerson: { onOpenPerson(activity) },
                onPrepare: { onPrepare(activity) }
            )
        )
    }

    private func timeRange(_ activity: RelationshipCalendarActivity) -> String {
        let format = Date.FormatStyle(date: calendar.isDate(activity.startDate, inSameDayAs: activity.endDate) ? .omitted : .abbreviated,
                                      time: .shortened, locale: appLanguage.locale, timeZone: calendar.timeZone)
        return activity.startDate.formatted(format) + "–" + activity.endDate.formatted(format)
    }

    private func clockRange(_ placement: RelationshipCalendarWeekLayout.Placement) -> String {
        let start = Int(placement.startMinute), end = Int(placement.endMinute)
        return String(format: "%02d:%02d–%02d:%02d", start / 60, start % 60, end / 60, end % 60)
    }
}
