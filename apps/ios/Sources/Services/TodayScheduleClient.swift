import Foundation

enum TodayScheduleError: Error { case invalidResponse, unavailable(Int) }
enum TodayScheduleCoverage: Equatable { case loading, complete, partial, unavailable }

struct TodayScheduleScope: Codable, Equatable {
    let from: String
    let to: String
    let timeZone: String
    var kind: String = "schedule"
    var personID: UUID? = nil
    enum CodingKeys: String, CodingKey { case from, to, timeZone = "time_zone", kind, personID = "person_id" }
    static func make(now: Date, timeZone: TimeZone) throws -> Self {
        guard now.timeIntervalSince1970.isFinite else { throw TodayScheduleError.invalidResponse }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let start = calendar.startOfDay(for: now)
        guard let end = calendar.date(byAdding: .day, value: 7, to: start) else { throw TodayScheduleError.invalidResponse }
        return .init(from: day(start, timeZone: timeZone), to: day(end, timeZone: timeZone), timeZone: timeZone.identifier)
    }
    static func day(_ date: Date, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

struct TodayScheduleActivity: Decodable, Equatable, Identifiable {
    let id: String
    let kind: String
    let sourceID: UUID
    let sourceRevision: Int
    let title: String
    let occurredAt: Date
    let endsAt: Date?
    let localDay: String
    let timeZone: String
    let allDay: Bool
    let status: String
    let authority: String
    let externalEffect: String
    enum CodingKeys: String, CodingKey {
        case id, kind, title, status, authority
        case sourceID = "source_id", sourceRevision = "source_revision", occurredAt = "occurred_at"
        case endsAt = "ends_at", localDay = "local_day", timeZone = "time_zone", allDay = "all_day", externalEffect = "external_effect"
    }
}

struct TodaySchedulePage: Decodable {
    let contractVersion: String
    let scope: TodayScheduleScope
    let activities: [TodayScheduleActivity]
    let complete: Bool
    let nextCursor: String?
    enum CodingKeys: String, CodingKey { case contractVersion = "contract_version", scope, activities, complete, nextCursor = "next_cursor" }
}

struct TodayScheduleRecord: Decodable, Equatable {
    let id: UUID
    let revision: Int
    let status: String
    let contentAvailable: Bool
    let title: String?
    let startsAt: Date?
    let endsAt: Date?
    let timeZone: String?
    let allDay: Bool
    let authority: String
    let externalEffect: String
    enum CodingKeys: String, CodingKey {
        case id, revision, status, title, authority
        case contentAvailable = "content_available", startsAt = "starts_at", endsAt = "ends_at"
        case timeZone = "time_zone", allDay = "all_day", externalEffect = "external_effect"
    }
}

struct TodayScheduleProjection {
    let item: TodayScheduleActivity?
    let coverage: TodayScheduleCoverage
    static func make(pages: [TodaySchedulePage], scope: TodayScheduleScope, now: Date) throws -> Self {
        guard !pages.isEmpty, pages.count <= 3, let zone = TimeZone(identifier: scope.timeZone),
              now.timeIntervalSince1970.isFinite else { throw TodayScheduleError.invalidResponse }
        var records: [UUID: TodayScheduleActivity] = [:]
        var cursors = Set<String>()
        var complete = false
        for page in pages {
            guard !complete, page.contractVersion == TalentSignalAPIContract.version, page.scope == scope,
                  page.activities.count <= 100, page.complete == (page.nextCursor == nil) else { throw TodayScheduleError.invalidResponse }
            if let cursor = page.nextCursor {
                guard !cursor.isEmpty, cursor.count <= 2048, cursors.insert(cursor).inserted else { throw TodayScheduleError.invalidResponse }
            }
            complete = page.complete
            for row in page.activities {
                guard row.sourceRevision >= 1, !row.title.isEmpty, row.title.count <= 500,
                      TimeZone(identifier: row.timeZone) != nil, row.externalEffect == "none",
                      ["schedule", "meeting_draft", "session_activity", "person_created"].contains(row.kind),
                      ["planned", "cancelled", "completed", "recorded", "needs_review"].contains(row.status),
                      ["user_authored", "system_record", "unconfirmed"].contains(row.authority) else { throw TodayScheduleError.invalidResponse }
                if (records[row.sourceID]?.sourceRevision ?? 0) < row.sourceRevision { records[row.sourceID] = row }
            }
        }
        let item = records.values.filter { row in
            guard row.kind == "schedule", row.authority == "user_authored", row.status == "planned",
                  let end = row.endsAt, end > now, end > row.occurredAt else { return false }
            return TodayScheduleScope.day(row.occurredAt, timeZone: zone) < scope.to && TodayScheduleScope.day(end, timeZone: zone) >= scope.from
        }.sorted { a, b in
            a.occurredAt == b.occurredAt ? a.sourceID.uuidString < b.sourceID.uuidString : a.occurredAt < b.occurredAt
        }.first
        return .init(item: item, coverage: complete ? .complete : .partial)
    }
}

@MainActor
protocol TodayScheduleServing {
    func list(scope: TodayScheduleScope, after: String?) async throws -> TodaySchedulePage
    func read(id: UUID) async throws -> TodayScheduleRecord
}

struct TodayScheduleClient: TodayScheduleServing {
    private let baseURL: URL
    private let bearerToken: String
    private let transport: TalentSignalHTTPTransport
    init(baseURL: URL, bearerToken: String, session: URLSession = TalentSignalNetworking.session) {
        self.baseURL = baseURL
        self.bearerToken = bearerToken
        self.transport = TalentSignalHTTPTransport(session: session)
    }
    func list(scope: TodayScheduleScope, after: String?) async throws -> TodaySchedulePage {
        var query = [URLQueryItem(name: "from", value: scope.from), URLQueryItem(name: "to", value: scope.to),
                     URLQueryItem(name: "time_zone", value: scope.timeZone), URLQueryItem(name: "kind", value: "schedule")]
        if let after { query.append(URLQueryItem(name: "after", value: after)) }
        let page: TodaySchedulePage = try await get("v1/time/activities", query: query)
        _ = try TodayScheduleProjection.make(pages: [page], scope: scope, now: Date())
        return page
    }
    func read(id: UUID) async throws -> TodayScheduleRecord {
        let envelope: Envelope = try await get("v1/time/schedules/\(id.uuidString.lowercased())")
        let record = envelope.schedule
        guard envelope.contractVersion == TalentSignalAPIContract.version, record.id == id, record.revision >= 1,
              record.authority == "user_authored", record.externalEffect == "none",
              ["planned", "cancelled", "completed", "deleted"].contains(record.status) else { throw TodayScheduleError.invalidResponse }
        if record.contentAvailable {
            guard record.status != "deleted", let title = record.title, !title.isEmpty, title.count <= 200,
                  let start = record.startsAt, let end = record.endsAt, end > start,
                  let zone = record.timeZone, TimeZone(identifier: zone) != nil else { throw TodayScheduleError.invalidResponse }
        } else {
            guard record.status == "deleted", record.title == nil, record.startsAt == nil,
                  record.endsAt == nil, record.timeZone == nil else { throw TodayScheduleError.invalidResponse }
        }
        return record
    }
    private struct Envelope: Decodable {
        let contractVersion: String
        let schedule: TodayScheduleRecord
        enum CodingKeys: String, CodingKey { case contractVersion = "contract_version", schedule }
    }
    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        let response = try await transport.send(baseURL: baseURL, path: path, queryItems: query,
            method: "GET", bearerToken: bearerToken, body: Optional<String>.none,
            timeoutInterval: 15, cachePolicy: .reloadIgnoringLocalCacheData)
        guard response.isSuccessful else { throw TodayScheduleError.unavailable(response.statusCode) }
        do { return try JSONDecoder.agentSession.decode(T.self, from: response.data) }
        catch { throw TodayScheduleError.invalidResponse }
    }
}
