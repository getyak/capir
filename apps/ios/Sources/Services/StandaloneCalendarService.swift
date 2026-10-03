import Foundation

enum StandaloneCalendarWindow: String, Codable, CaseIterable, Identifiable {
    case recent = "Past 14 days"
    case upcoming = "Next 14 days"
    case recentAndUpcoming = "Past + next 14 days (28 days total)"

    var id: String { rawValue }

    func interval(now: Date, calendar: Calendar = .current) -> DateInterval {
        let start = self == .upcoming
            ? now
            : (calendar.date(byAdding: .day, value: -14, to: now) ?? now)
        let end = self == .recent
            ? now
            : (calendar.date(byAdding: .day, value: 14, to: now) ?? now)
        return DateInterval(start: start, end: end)
    }
}

enum StandaloneCalendarFixture {
    static func demoMeeting(now: Date = Date()) -> StandaloneMeeting {
        let start = Calendar.current.date(byAdding: .hour, value: -2, to: now) ?? now
        return StandaloneMeeting(
            id: "demo-meeting-mina-v1",
            eventIdentifier: nil,
            title: "Candidate catch-up with Mina",
            startsAt: start,
            endsAt: start.addingTimeInterval(30 * 60),
            calendarTitle: "capri Demo",
            isDemo: true
        )
    }
}
