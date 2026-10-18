import XCTest
@testable import TalentSignal

@MainActor
final class TodayScheduleTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-10-18T02:00:00Z")!
    private let zone = TimeZone(identifier: "Asia/Shanghai")!
    private let sourceID = UUID(uuidString: "00000000-0000-4000-8000-000000000001")!

    func testAllDayIntervalNamesEveryAttendedLocalDateAndExcludesEndMidnight() throws {
        let start = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-17T16:00:00Z"))
        let end = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-20T16:00:00Z"))
        XCTAssertEqual(TodayScheduleFormatting.interval(start: start, end: end, zone: "Asia/Shanghai",
            allDay: true, locale: Locale(identifier: "en_US_POSIX"), allDayLabel: "All day"),
            "Oct 18, 2026 – Oct 20, 2026 · All day")
        XCTAssertEqual(TodayScheduleFormatting.interval(start: start, end: start.addingTimeInterval(86400),
            zone: "Asia/Shanghai", allDay: true, locale: Locale(identifier: "en_US_POSIX"), allDayLabel: "All day"),
            "Oct 18, 2026 · All day")
    }

    private func activity(_ changes: [String: Any] = [:]) throws -> TodayScheduleActivity {
        var wire: [String: Any] = [
            "id": "schedule:\(sourceID.uuidString.lowercased())", "kind": "schedule",
            "source_id": sourceID.uuidString, "source_revision": 2,
            "title": "Synthetic shared arrangement", "summary": "User-authored intent",
            "occurred_at": "2026-10-18T03:00:00Z", "recorded_at": "2026-10-17T00:00:00Z",
            "ends_at": "2026-10-18T04:00:00Z", "local_day": "2026-10-18",
            "time_zone": "Asia/Shanghai", "all_day": false,
            "person_id": NSNull(), "person_label": NSNull(), "relationship_context_id": NSNull(),
            "context_label": NSNull(), "session_id": NSNull(), "status": "planned",
            "authority": "user_authored", "external_effect": "none"
        ]
        wire.merge(changes) { _, new in new }
        return try JSONDecoder.agentSession.decode(TodayScheduleActivity.self, from: JSONSerialization.data(withJSONObject: wire))
    }
    private func scope() throws -> TodayScheduleScope { try .make(now: now, timeZone: zone) }
    private func page(_ rows: [TodayScheduleActivity] = [], complete: Bool = true, cursor: String? = nil,
                      scope: TodayScheduleScope? = nil) throws -> TodaySchedulePage {
        TodaySchedulePage(contractVersion: TalentSignalAPIContract.version, scope: try scope ?? self.scope(),
                          activities: rows, complete: complete, nextCursor: cursor)
    }

    func testSevenLocalDatesCrossDSTWithoutUTCSubstitution() throws {
        let instant = ISO8601DateFormatter().date(from: "2026-03-08T07:30:00Z")!
        let result = try TodayScheduleScope.make(now: instant, timeZone: TimeZone(identifier: "America/Los_Angeles")!)
        XCTAssertEqual(result.from, "2026-03-07")
        XCTAssertEqual(result.to, "2026-03-14")
        XCTAssertEqual(result.timeZone, "America/Los_Angeles")
        XCTAssertEqual(try scope().from, "2026-10-18")
    }

    func testNextCanonicalArrangementKeepsIdentityRevisionAndAuthority() throws {
        let next = try activity()
        let later = try activity(["source_id": UUID().uuidString, "occurred_at": "2026-10-19T03:00:00Z", "ends_at": "2026-10-19T04:00:00Z"])
        let result = try TodayScheduleProjection.make(pages: [page([later, next])], scope: scope(), now: now)
        XCTAssertEqual(result.item?.sourceID, sourceID)
        XCTAssertEqual(result.item?.sourceRevision, 2)
        XCTAssertEqual(result.item?.authority, "user_authored")
        XCTAssertEqual(result.coverage, .complete)
    }

    func testCompletedCancelledDraftAndSystemRecordsDoNotBecomeArrangements() throws {
        for patch in [["status": "cancelled"], ["status": "completed"], ["status": "needs_review"],
                      ["authority": "unconfirmed"], ["authority": "system_record"], ["kind": "meeting_draft"]] {
            XCTAssertNil(try TodayScheduleProjection.make(pages: [page([activity(patch)])], scope: scope(), now: now).item)
        }
    }

    func testOngoingAllDayAndElapsedBoundaries() throws {
        let ongoing = try activity(["occurred_at": "2026-10-18T01:00:00Z"])
        XCTAssertNotNil(try TodayScheduleProjection.make(pages: [page([ongoing])], scope: scope(), now: now).item)
        let allDay = try activity(["occurred_at": "2026-10-17T16:00:00Z", "ends_at": "2026-10-18T16:00:00Z", "all_day": true])
        XCTAssertEqual(try TodayScheduleProjection.make(pages: [page([allDay])], scope: scope(), now: now).item?.allDay, true)
        let ended = try activity(["occurred_at": "2026-10-18T01:00:00Z", "ends_at": "2026-10-18T02:00:00Z"])
        XCTAssertNil(try TodayScheduleProjection.make(pages: [page([ended])], scope: scope(), now: now).item)
    }

    func testCompleteEmptyAndBoundedPartialRemainDifferent() throws {
        XCTAssertEqual(try TodayScheduleProjection.make(pages: [page()], scope: scope(), now: now).coverage, .complete)
        XCTAssertEqual(try TodayScheduleProjection.make(pages: [page(complete: false, cursor: "next")], scope: scope(), now: now).coverage, .partial)
        XCTAssertThrowsError(try TodayScheduleProjection.make(pages: [], scope: scope(), now: now))
        XCTAssertThrowsError(try TodayScheduleProjection.make(pages: Array(repeating: page(), count: 4), scope: scope(), now: now))
    }

    func testChangedScopeRepeatedCursorAndBrokenContractFailClosed() throws {
        let changed = TodayScheduleScope(from: "2026-10-18", to: "2026-10-25", timeZone: "UTC")
        XCTAssertThrowsError(try TodayScheduleProjection.make(pages: [page(scope: changed)], scope: scope(), now: now))
        let repeated = try page(complete: false, cursor: "repeat")
        XCTAssertThrowsError(try TodayScheduleProjection.make(pages: [repeated, repeated], scope: scope(), now: now))
        XCTAssertThrowsError(try TodayScheduleProjection.make(pages: [page(complete: true, cursor: "wrong")], scope: scope(), now: now))
        let malformed = TodaySchedulePage(contractVersion: "unknown", scope: try scope(), activities: [], complete: true, nextCursor: nil)
        XCTAssertThrowsError(try TodayScheduleProjection.make(pages: [malformed], scope: scope(), now: now))
    }

    func testLaterCancellationRevisionWinsAcrossPages() throws {
        let first = try page([activity()], complete: false, cursor: "second")
        let cancellation = try page([activity(["source_revision": 3, "status": "cancelled"])])
        XCTAssertNil(try TodayScheduleProjection.make(pages: [first, cancellation], scope: scope(), now: now).item)
    }

    final class Service: TodayScheduleServing {
        var pages: [TodaySchedulePage] = []
        var listCalls = 0
        var listFailure: Error?
        var readCalls = 0
        var deferred = false
        var pending: CheckedContinuation<TodaySchedulePage, Error>?
        var detailRecord: TodayScheduleRecord?
        var deferredDetail = false
        var pendingDetail: CheckedContinuation<TodayScheduleRecord, Error>?
        func list(scope: TodayScheduleScope, after: String?) async throws -> TodaySchedulePage {
            listCalls += 1
            if let listFailure { throw listFailure }
            if deferred { return try await withCheckedThrowingContinuation { pending = $0 } }
            guard !pages.isEmpty else { throw URLError(.timedOut) }
            return pages.removeFirst()
        }
        func read(id: UUID) async throws -> TodayScheduleRecord {
            readCalls += 1
            if deferredDetail { return try await withCheckedThrowingContinuation { pendingDetail = $0 } }
            guard let detailRecord else { throw URLError(.resourceUnavailable) }
            return detailRecord
        }
        func entered() async throws {
            for _ in 0..<200 { if pending != nil { return }; try await Task.sleep(nanoseconds: 5_000_000) }
            XCTFail("The real read owner never entered the deferred service")
        }
    }

    func testRealStoreBoundsToThreePagesAndPreservesPartialCoverage() async throws {
        let service = Service()
        service.pages = try (1...3).map { try page([activity()], complete: false, cursor: "page-\($0)") }
        let store = TodayScheduleStore(currentDate: { self.now }, currentTimeZone: { self.zone })
        store.activate(scopeID: "A", service: service, expiresAt: nil, isCurrent: { true })
        await store.refresh(now: now, timeZone: zone)
        XCTAssertEqual(service.listCalls, 3)
        XCTAssertEqual(store.item?.sourceID, sourceID)
        XCTAssertEqual(store.coverage, .partial)
        store.invalidate()
    }

    func testSourceOutagePreservesOnlyCurrentPartialReadAndCanRecoverToVerifiedEmpty() async throws {
        let service = Service(); service.pages = [try page([activity()], complete: false, cursor: "second")]
        let store = TodayScheduleStore(currentDate: { self.now }, currentTimeZone: { self.zone })
        store.activate(scopeID: "A", service: service, expiresAt: nil, isCurrent: { true })
        await store.refresh(now: now, timeZone: zone)
        XCTAssertEqual(store.item?.sourceID, sourceID); XCTAssertEqual(store.coverage, .partial)
        service.pages = [try page()]
        await store.refresh(now: now, timeZone: zone)
        XCTAssertNil(store.item); XCTAssertEqual(store.coverage, .complete)
        store.invalidate()
    }

    func testReleasedAndCopiedCallbacksCannotPublishOrReadOldIdentity() async throws {
        let service = Service(); service.deferred = true
        let store = TodayScheduleStore(currentDate: { self.now }, currentTimeZone: { self.zone })
        store.activate(scopeID: "A", service: service, expiresAt: nil, isCurrent: { true })
        let task = Task { await store.refresh(now: self.now, timeZone: self.zone) }
        try await service.entered(); store.invalidate()
        service.pending?.resume(returning: try page([activity()])); service.pending = nil
        await task.value
        XCTAssertNil(store.item); XCTAssertEqual(store.coverage, .unavailable)
        await store.refresh(now: now, timeZone: zone)
        XCTAssertEqual(service.listCalls, 1)
    }

    func testLatePageCannotRepaintAfterMidnightOrDeviceZoneChange() async throws {
        for changesZone in [false, true] {
            let service = Service(); service.deferred = true
            var instant = now
            var liveZone = zone
            let store = TodayScheduleStore(currentDate: { instant }, currentTimeZone: { liveZone })
            store.activate(scopeID: "A", service: service, expiresAt: nil, isCurrent: { true })
            let request = Task { await store.refresh() }
            try await service.entered()
            if changesZone { liveZone = TimeZone(identifier: "America/Los_Angeles")! }
            else { instant = now.addingTimeInterval(86400) }
            service.pending?.resume(returning: try page([activity()])); service.pending = nil
            await request.value
            XCTAssertNil(store.item, "The prior date/zone page must not repaint after the live scope changed")
            XCTAssertEqual(store.coverage, .loading)
            XCTAssertEqual(store.clock, instant)
            service.deferred = false
            let nextScope = try TodayScheduleScope.make(now: instant, timeZone: liveZone)
            service.pages = [try page(scope: nextScope)]
            await store.refresh()
            XCTAssertEqual(store.coverage, .complete)
            XCTAssertEqual(service.listCalls, 2)
            store.invalidate()
        }
    }

    func testSameDayLatePageDoesNotRestoreAnArrangementThatEndedWhileReading() async throws {
        let service = Service(); service.deferred = true
        var instant = now
        let store = TodayScheduleStore(currentDate: { instant }, currentTimeZone: { self.zone })
        store.activate(scopeID: "A", service: service, expiresAt: nil, isCurrent: { true })
        let read = Task { await store.refresh() }
        try await service.entered()
        instant = now.addingTimeInterval(3 * 3600)
        service.pending?.resume(returning: try page([activity()])); service.pending = nil
        await read.value
        XCTAssertNil(store.item, "The arrangement ended before this response arrived")
        XCTAssertEqual(store.coverage, .complete)
        XCTAssertEqual(store.clock, instant)
        store.invalidate()
    }

    func testChangedLiveIdentityAndExpiredCredentialClearClaims() async throws {
        let service = Service(); service.pages = [try page([activity()])]
        let store = TodayScheduleStore(currentDate: { self.now }, currentTimeZone: { self.zone }); var current = true
        store.activate(scopeID: "A", service: service, expiresAt: now.addingTimeInterval(5), isCurrent: { current })
        await store.refresh(now: now, timeZone: zone); XCTAssertNotNil(store.item)
        current = false
        await store.refresh(now: now, timeZone: zone); XCTAssertNil(store.item)
        current = true; service.pages = [try page([activity()])]
        store.activate(scopeID: "B", service: service, expiresAt: now.addingTimeInterval(5), isCurrent: { current })
        await store.refresh(now: now.addingTimeInterval(6), timeZone: zone)
        XCTAssertNil(store.item); XCTAssertEqual(store.coverage, .unavailable)
        XCTAssertEqual(service.listCalls, 1)
    }

    func testConcurrentRefreshesCoalesceAndClockStillAdvances() async throws {
        let service = Service(); service.deferred = true
        let store = TodayScheduleStore(currentDate: { self.now }, currentTimeZone: { self.zone })
        store.activate(scopeID: "A", service: service, expiresAt: nil, isCurrent: { true })
        let first = Task { await store.refresh(now: self.now, timeZone: self.zone) }
        try await service.entered()
        let second = Task { await store.refresh(now: self.now.addingTimeInterval(1), timeZone: self.zone) }
        await Task.yield(); XCTAssertEqual(service.listCalls, 1)
        service.pending?.resume(returning: try page([activity()])); service.pending = nil
        await first.value; await second.value
        XCTAssertEqual(store.clock, now.addingTimeInterval(1))
        XCTAssertEqual(store.item?.sourceID, sourceID)
        store.invalidate()
    }

    private func detail(_ patch: [String: Any] = [:]) throws -> TodayScheduleRecord {
        var row: [String: Any] = ["id": sourceID.uuidString, "revision": 3, "status": "planned", "content_available": true,
            "title": "Fresh arrangement", "starts_at": "2026-10-18T03:00:00Z", "ends_at": "2026-10-18T04:00:00Z",
            "time_zone": "Asia/Shanghai", "all_day": false, "authority": "user_authored", "external_effect": "none"]
        row.merge(patch) { _, new in new }
        return try JSONDecoder.agentSession.decode(TodayScheduleRecord.self, from: JSONSerialization.data(withJSONObject: row))
    }

    func testOpeningDetailReadsFreshRevisionAndRefreshRevalidatesTheOpenSource() async throws {
        let service = Service(); service.pages = [try page([activity()])]; service.detailRecord = try detail()
        let store = TodayScheduleStore(currentDate: { self.now }, currentTimeZone: { self.zone })
        store.activate(scopeID: "A", service: service, expiresAt: nil, isCurrent: { true })
        await store.refresh(now: now, timeZone: zone)
        await store.openDetail(id: sourceID)
        XCTAssertEqual(store.detail, .ready(try detail()))
        XCTAssertEqual(service.readCalls, 1)
        service.pages = [try page()]; service.detailRecord = try detail(["status": "cancelled"])
        await store.refresh(now: now, timeZone: zone)
        XCTAssertEqual(service.readCalls, 2)
        XCTAssertEqual(store.detail, .unavailable)
        XCTAssertNil(store.item)
        store.invalidate()
    }

    func testElapsedArrangementWithdrawsOpenDetailBeforePendingRefreshReturns() async throws {
        let service = Service(); service.pages = [try page([activity()])]; service.detailRecord = try detail()
        var instant = now
        let store = TodayScheduleStore(currentDate: { instant }, currentTimeZone: { self.zone })
        store.activate(scopeID: "A", service: service, expiresAt: nil, isCurrent: { true })
        await store.refresh()
        await store.openDetail(id: sourceID)
        XCTAssertEqual(store.detail, .ready(try detail()))

        instant = ISO8601DateFormatter().date(from: "2026-10-18T04:00:00Z")!
        service.deferred = true
        let refresh = Task { await store.refresh() }
        try await service.entered()
        XCTAssertNil(store.item)
        XCTAssertEqual(store.detail, .unavailable,
            "A known elapsed detail must be withdrawn before the new list response arrives")

        service.pending?.resume(returning: try page()); service.pending = nil
        await refresh.value
        store.invalidate()
    }

    func testListPermissionRevocationFencesAnOlderInFlightDetailResponse() async throws {
        let service = Service(); service.pages = [try page([activity()])]
        let store = TodayScheduleStore(currentDate: { self.now }, currentTimeZone: { self.zone })
        store.activate(scopeID: "A", service: service, expiresAt: nil, isCurrent: { true })
        await store.refresh()
        service.deferredDetail = true
        let open = Task { await store.openDetail(id: self.sourceID) }
        for _ in 0..<200 {
            if service.pendingDetail != nil { break }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        let pending = try XCTUnwrap(service.pendingDetail)
        service.listFailure = TodayScheduleError.unavailable(403)
        await store.refresh()
        XCTAssertEqual(store.detail, .unavailable)
        pending.resume(returning: try detail()); service.pendingDetail = nil
        await open.value
        XCTAssertEqual(store.detail, .unavailable, "An older successful detail cannot restore revoked schedule content")
        XCTAssertNil(store.item)
        XCTAssertTrue(store.hasActiveReadScope, "A calendar403 does not revoke independent producers")
        store.invalidate()
    }

    func testNewListForcesFreshDetailInsteadOfCoalescingWithAnOlderRead() async throws {
        let service = Service(); service.pages = [try page([activity()])]
        let store = TodayScheduleStore(currentDate: { self.now }, currentTimeZone: { self.zone })
        store.activate(scopeID: "A", service: service, expiresAt: nil, isCurrent: { true })
        await store.refresh()
        service.deferredDetail = true
        let old = Task { await store.openDetail(id: self.sourceID) }
        for _ in 0..<200 {
            if service.pendingDetail != nil { break }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        let pending = try XCTUnwrap(service.pendingDetail)
        service.deferredDetail = false
        service.detailRecord = try detail(["status": "cancelled"])
        service.pages = [try page()]
        let refresh = Task { await store.refresh() }
        for _ in 0..<40 {
            if service.readCalls >= 2 { break }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTAssertEqual(service.readCalls, 2, "A new list validation requires a new detail read")
        pending.resume(returning: try detail()); service.pendingDetail = nil
        await old.value; await refresh.value
        XCTAssertEqual(store.detail, .unavailable)
        XCTAssertNil(store.item)
        store.invalidate()
    }

    func testDismissedAndReleasedDetailDropsLatePrivateContent() async throws {
        let service = Service(); service.deferredDetail = true
        let store = TodayScheduleStore(currentDate: { self.now }, currentTimeZone: { self.zone })
        store.activate(scopeID: "A", service: service, expiresAt: nil, isCurrent: { true })
        let read = Task { await store.openDetail(id: self.sourceID) }
        for _ in 0..<200 { if service.pendingDetail != nil { break }; try await Task.sleep(nanoseconds: 5_000_000) }
        XCTAssertEqual(service.readCalls, 1)
        store.invalidate()
        service.pendingDetail?.resume(returning: try detail()); service.pendingDetail = nil
        await read.value
        XCTAssertEqual(store.detail, .unavailable)
        XCTAssertNil(store.item)
    }

    func testCalendarPermissionFailureDoesNotRevokeOtherSourcesButCredentialLossDoes() async {
        let service = Service(); service.listFailure = TodayScheduleError.unavailable(403)
        let store = TodayScheduleStore(currentDate: { self.now }, currentTimeZone: { self.zone })
        store.activate(scopeID: "A", service: service, expiresAt: nil, isCurrent: { true })
        await store.refresh(now: now, timeZone: zone)
        XCTAssertEqual(store.coverage, .unavailable)
        XCTAssertTrue(store.hasActiveReadScope)
        service.listFailure = TodayScheduleError.unavailable(401)
        await store.refresh(now: now, timeZone: zone)
        XCTAssertFalse(store.hasActiveReadScope)
        XCTAssertNil(store.item)
    }
}
