import Foundation

/// Date labels preserve the canonical record's zone and exclusive all-day end.
enum TodayScheduleFormatting {
    static func interval(start: Date, end: Date, zone: String, allDay: Bool,
                         locale: Locale, allDayLabel: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = TimeZone(identifier: zone)
        formatter.dateStyle = .medium
        formatter.timeStyle = allDay ? .none : .short
        let first = formatter.string(from: start)
        if allDay {
            let last = formatter.string(from: end.addingTimeInterval(-0.001))
            return "\(first)\(first == last ? "" : " – \(last)") · \(allDayLabel)"
        }
        return "\(first) – \(formatter.string(from: end))"
    }
}
