import Foundation
import Combine

@MainActor
final class TodayScheduleStore: ObservableObject {
    private let currentDate: () -> Date
    private let currentTimeZone: () -> TimeZone
    init(currentDate: @escaping () -> Date = Date.init,
         currentTimeZone: @escaping () -> TimeZone = { .autoupdatingCurrent }) {
        self.currentDate = currentDate
        self.currentTimeZone = currentTimeZone
    }
    enum Detail: Equatable { case idle, loading, ready(TodayScheduleRecord), unavailable }
    @Published private(set) var detail: Detail = .idle
    private var selectedID: UUID?
    private var detailEpoch = 0
    private var leaseEpoch = 0
    private var detailTask: Task<Void, Never>?
    func openDetail(id: UUID) async {
        guard active, isCurrent(), expiresAt.map({ currentDate() < $0 }) ?? true, let service else { invalidate(); return }
        if selectedID == id, let detailTask { await detailTask.value; return }
        detailTask?.cancel()
        selectedID = id
        detailEpoch += 1
        let generation = detailEpoch, owner = leaseEpoch
        detail = .loading
        let task = Task<Void, Never> { [weak self] in
            guard let self else { return }
            do {
                let record = try await service.read(id: id)
                guard self.canPublishDetail(generation, owner: owner, id: id) else { return }
                let minimumRevision = self.item.map { $0.sourceID == id ? $0.sourceRevision : 1 } ?? 1
                guard record.id == id, record.revision >= minimumRevision,
                      record.authority == "user_authored", record.externalEffect == "none",
                      record.contentAvailable, record.status == "planned",
                      record.title?.isEmpty == false, let start = record.startsAt, let end = record.endsAt,
                      end > start, end > max(self.currentDate(), self.clock), let zone = record.timeZone, TimeZone(identifier: zone) != nil else {
                    self.detail = .unavailable
                    if self.item?.sourceID == id { self.item = nil; self.coverage = .unavailable }
                    return
                }
                self.detail = .ready(record)
            } catch {
                guard self.canPublishDetail(generation, owner: owner, id: id) else { return }
                if case TodayScheduleError.unavailable(let status) = error {
                    if status == 401 { self.invalidate(); return }
                    if status == 403, self.item?.sourceID == id { self.item = nil; self.coverage = .unavailable }
                }
                self.detail = .unavailable
            }
        }
        detailTask = task
        await task.value
        if detailEpoch == generation { detailTask = nil }
    }
    private func canPublishDetail(_ generation: Int, owner: Int, id: UUID) -> Bool {
        guard active, !Task.isCancelled, detailEpoch == generation, leaseEpoch == owner, selectedID == id else { return false }
        guard isCurrent(), expiresAt.map({ currentDate() < $0 }) ?? true else { invalidate(); return false }
        return true
    }
    func dismissDetail() {
        detailEpoch += 1
        selectedID = nil
        detailTask?.cancel(); detailTask = nil
        detail = .idle
    }
    private func fenceDetailRead(_ state: Detail) {
        guard selectedID != nil else { return }
        detailEpoch += 1
        detailTask?.cancel()
        detailTask = nil
        detail = state
    }
    @Published private(set) var item: TodayScheduleActivity?
    @Published private(set) var coverage: TodayScheduleCoverage = .loading
    @Published private(set) var clock = Date()
    private var service: (any TodayScheduleServing)?
    private var isCurrent: () -> Bool = { false }
    private var expiresAt: Date?
    private var epoch = 0
    private var active = false
    var hasActiveReadScope: Bool { active && isCurrent() && (expiresAt.map { currentDate() < $0 } ?? true) }
    private var readTask: Task<Void, Never>?
    private var readScope: TodayScheduleScope?
    private var expiryTask: Task<Void, Never>?

    func activate(scopeID: String, service: any TodayScheduleServing, expiresAt: Date?, isCurrent: @escaping () -> Bool) {
        invalidate()
        guard !scopeID.isEmpty else { return }
        self.service = service
        self.isCurrent = isCurrent
        self.expiresAt = expiresAt
        active = true
        coverage = .loading
        if let expiresAt {
            expiryTask = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(max(0, expiresAt.timeIntervalSince(self?.currentDate() ?? Date())))) }
                catch { return }
                guard !Task.isCancelled else { return }
                self?.invalidate()
            }
        }
    }

    func refresh(now: Date? = nil, timeZone: TimeZone? = nil) async {
        let now = now ?? currentDate(), timeZone = timeZone ?? currentTimeZone()
        clock = now
        guard active, isCurrent(), expiresAt.map({ now < $0 }) ?? true, let service else { invalidate(); return }
        if let end = item?.endsAt, end <= now { item = nil; coverage = .loading }
        if case .ready(let record) = detail, let end = record.endsAt, end <= now {
            fenceDetailRead(.unavailable)
        }
        guard let scope = try? TodayScheduleScope.make(now: now, timeZone: timeZone) else { item = nil; coverage = .unavailable; return }
        if let readTask, readScope == scope { await readTask.value; return }
        readTask?.cancel()
        if readScope != scope { item = nil; coverage = .loading }
        readScope = scope
        epoch += 1
        let generation = epoch
        let task = Task { [weak self] in
            guard let self else { return }
            var pages: [TodaySchedulePage] = []
            do {
                var cursor: String?
                for index in 0..<3 {
                    let page = try await service.list(scope: scope, after: cursor)
                    guard self.canPublish(generation) else { return }
                    pages.append(page)
                    let projected = try TodayScheduleProjection.make(pages: pages, scope: scope, now: self.clock)
                    if projected.coverage == .complete || index == 2 {
                        self.item = projected.item
                        self.coverage = projected.coverage
                        if let selectedID = self.selectedID {
                            // The new list establishes a new validation point.
                            // An older in-flight detail is not a fresh read.
                            self.fenceDetailRead(.loading)
                            await self.openDetail(id: selectedID)
                        }
                        return
                    }
                    cursor = page.nextCursor
                }
            } catch {
                guard self.canPublish(generation) else { return }
                self.fenceDetailRead(.unavailable)
                if case TodayScheduleError.unavailable(401) = error {
                    self.invalidate()
                    return
                }
                let outage: Bool
                if case TodayScheduleError.unavailable(let status) = error { outage = status >= 500 }
                else { outage = error is URLError }
                if outage, !pages.isEmpty,
                   let partial = try? TodayScheduleProjection.make(pages: pages, scope: scope, now: self.clock) {
                    self.item = partial.item
                    self.coverage = partial.coverage
                } else {
                    self.item = nil
                    self.coverage = .unavailable
                }
            }
        }
        readTask = task
        await task.value
        if epoch == generation { readTask = nil }
    }

    private func canPublish(_ generation: Int) -> Bool {
        guard active, !Task.isCancelled, epoch == generation else { return false }
        guard isCurrent(), expiresAt.map({ currentDate() < $0 }) ?? true else { invalidate(); return false }
        let now = currentDate()
        guard let readScope, let live = try? TodayScheduleScope.make(now: now, timeZone: currentTimeZone()),
              readScope == live else {
            // A foreground interval tick need not have happened yet. Never
            // publish a page for yesterday or the device's previous zone.
            clock = now
            item = nil
            coverage = .loading
            fenceDetailRead(.unavailable)
            return false
        }
        clock = max(clock, now)
        return true
    }

    func invalidate() {
        active = false
        leaseEpoch += 1
        epoch += 1
        readTask?.cancel(); readTask = nil
        expiryTask?.cancel(); expiryTask = nil
        readScope = nil
        service = nil
        isCurrent = { false }
        item = nil
        coverage = .unavailable
        dismissDetail()
        detail = .unavailable
    }
}
