import Foundation
import XCTest
@testable import TalentSignal

/// Tests the internal owner used by LabFaultWorkspaceService. Continuations
/// control scheduling at operation boundaries; successful reads still use the
/// actual isolated URLSession, three workspace requests, and JSON decoder.
@MainActor
final class LabFaultSessionLifecycleTests: XCTestCase {
    func testCloseRejectsNewReadsAndDrainsEveryAdmittedReadBeforeInvalidating() async throws {
        let service = try LabFaultWorkspaceService(preset: .staleEvidence, seconds: 60, enabled: true)
        let events = LabFaultLifecycleEvents()
        let first = LabFaultReadBarrier(
            entered: expectation(description: "First read admitted"),
            cancelled: expectation(description: "First read cancelled"))
        let second = LabFaultReadBarrier(
            entered: expectation(description: "Second read admitted"),
            cancelled: expectation(description: "Second read cancelled"))
        let barriers = [first, second]
        var tasks: [LabFaultTestTask] = []
        defer { barriers.forEach { $0.release() }; tasks.forEach { $0.cancel() } }
        let lifecycle = LabFaultSessionLifecycle {
            events.append("invalidate")
            await service.close()
        }
        let firstRead = LabFaultObservedTask("First read completed") {
            try await lifecycle.load {
                defer { events.append("first-settled") }
                await first.pause()
                try Task.checkCancellation()
                return try await service.loadWorkspace()
            }
        }
        tasks.append(firstRead)
        let secondRead = LabFaultObservedTask("Second read completed") {
            try await lifecycle.load {
                defer { events.append("second-settled") }
                await second.pause()
                try Task.checkCancellation()
                return try await service.loadWorkspace()
            }
        }
        tasks.append(secondRead)
        await fulfillment(of: [first.entered, second.entered], timeout: 2)

        let close = LabFaultObservedTask("Close completed") { await lifecycle.close() }
        tasks.append(close)
        await fulfillment(of: [first.cancelled!, second.cancelled!], timeout: 2)
        let closingAdmission = LabFaultObservedTask<PursuitWorkspaceSnapshot>("Closing admission rejected") {
            try await lifecycle.load {
                events.append("late-read-started")
                throw LabFaultAdmissionProbe.operationStarted
            }
        }
        tasks.append(closingAdmission)
        guard await observeCompletion(of: [closingAdmission], all: tasks, releasing: barriers) else { return }
        assertUnsupported(closingAdmission)
        XCTAssertTrue(events.snapshot.isEmpty,
                      "Cancellation must not be mistaken for settled reads")

        first.release()
        guard await observeCompletion(of: [firstRead], all: tasks, releasing: barriers) else { return }
        assertCancelled(firstRead)
        XCTAssertFalse(events.snapshot.contains("invalidate"),
                       "The second admitted read is still suspended")
        second.release()
        guard await observeCompletion(of: [secondRead, close], all: tasks, releasing: barriers) else { return }
        assertCancelled(secondRead)

        let completed = events.snapshot
        XCTAssertEqual(Set(completed), Set(["first-settled", "second-settled", "invalidate"]))
        XCTAssertEqual(completed.last, "invalidate")
        XCTAssertEqual(completed.filter { $0 == "invalidate" }.count, 1)
        XCTAssertNil(LabFaultRegistry.shared.engine(host: service.baseURL.host))
        let closedAdmission = LabFaultObservedTask<PursuitWorkspaceSnapshot>("Closed admission rejected") {
            try await lifecycle.load {
                events.append("post-close-read-started")
                throw LabFaultAdmissionProbe.operationStarted
            }
        }
        tasks.append(closedAdmission)
        guard await observeCompletion(of: [closedAdmission], all: tasks, releasing: barriers) else { return }
        assertUnsupported(closedAdmission)
        XCTAssertFalse(events.snapshot.contains("post-close-read-started"))
    }

    func testConcurrentCloseWaitersShareOneCleanup() async throws {
        let service = try LabFaultWorkspaceService(preset: .staleEvidence, seconds: 60, enabled: true)
        let events = LabFaultLifecycleEvents()
        let cleanup = LabFaultReadBarrier(entered: expectation(description: "Cleanup entered"))
        let barriers = [cleanup]
        var tasks: [LabFaultTestTask] = []
        defer { barriers.forEach { $0.release() }; tasks.forEach { $0.cancel() } }
        let lifecycle = LabFaultSessionLifecycle {
            events.append("cleanup-started")
            await cleanup.pause()
            if Task.isCancelled { events.append("cleanup-cancelled") }
            await service.close()
            events.append("cleanup-finished")
        }
        let firstClose = LabFaultObservedTask("First close completed") {
            await lifecycle.close()
            events.append("first-close-returned")
        }
        tasks.append(firstClose)
        await fulfillment(of: [cleanup.entered], timeout: 2)
        firstClose.cancel()
        let secondClose = LabFaultObservedTask("Second close completed") {
            await lifecycle.close()
            events.append("second-close-returned")
        }
        tasks.append(secondClose)
        let closingAdmission = LabFaultObservedTask<PursuitWorkspaceSnapshot>("Cleanup admission rejected") {
            try await lifecycle.load {
                events.append("late-read-started")
                throw LabFaultAdmissionProbe.operationStarted
            }
        }
        tasks.append(closingAdmission)
        guard await observeCompletion(of: [closingAdmission], all: tasks, releasing: barriers) else { return }
        assertUnsupported(closingAdmission)
        XCTAssertEqual(events.snapshot, ["cleanup-started"])
        cleanup.release()
        guard await observeCompletion(of: [firstClose, secondClose], all: tasks, releasing: barriers) else { return }
        let repeatedClose = LabFaultObservedTask("Repeated close completed") { await lifecycle.close() }
        tasks.append(repeatedClose)
        guard await observeCompletion(of: [repeatedClose], all: tasks, releasing: barriers) else { return }

        let completed = events.snapshot
        XCTAssertEqual(completed.filter { $0 == "cleanup-started" }.count, 1)
        XCTAssertFalse(completed.contains("cleanup-cancelled"),
                       "A cancelled waiter must not cancel shared cleanup")
        let cleanupEnd = try XCTUnwrap(completed.firstIndex(of: "cleanup-finished"))
        XCTAssertGreaterThan(try XCTUnwrap(completed.firstIndex(of: "first-close-returned")), cleanupEnd)
        XCTAssertGreaterThan(try XCTUnwrap(completed.firstIndex(of: "second-close-returned")), cleanupEnd)
        XCTAssertNil(LabFaultRegistry.shared.engine(host: service.baseURL.host))
    }

    func testCallerCancellationReachesOwnedReadAndAllowsRealRetry() async throws {
        XCTAssertFalse(LabFaultURLProtocol.isIsolated(TalentSignalNetworking.session))
        let service = try LabFaultWorkspaceService(preset: .staleEvidence, seconds: 60, enabled: true)
        let events = LabFaultLifecycleEvents()
        let pending = LabFaultReadBarrier(
            entered: expectation(description: "Caller read admitted"),
            cancelled: expectation(description: "Caller cancellation forwarded"))
        let barriers = [pending]
        var tasks: [LabFaultTestTask] = []
        defer { barriers.forEach { $0.release() }; tasks.forEach { $0.cancel() } }
        let lifecycle = LabFaultSessionLifecycle {
            events.append("invalidate")
            await service.close()
        }
        let read = LabFaultObservedTask("Cancelled caller read completed") {
            try await lifecycle.load {
                await pending.pause()
                try Task.checkCancellation()
                return try await service.loadWorkspace()
            }
        }
        tasks.append(read)
        await fulfillment(of: [pending.entered], timeout: 2)
        read.cancel()
        await fulfillment(of: [pending.cancelled!], timeout: 2)
        pending.release()
        guard await observeCompletion(of: [read], all: tasks, releasing: barriers) else { return }
        assertCancelled(read)
        XCTAssertTrue(events.snapshot.isEmpty,
                      "Cancelling one read must not close the session")

        let retry = LabFaultObservedTask("Real transport retry completed") {
            let snapshot = try await lifecycle.load { try await service.loadWorkspace() }
            return (snapshot, await service.engine.state())
        }
        tasks.append(retry)
        guard await observeCompletion(of: [retry], all: tasks, releasing: barriers) else { return }
        if case let .success((snapshot, state))? = retry.result {
            XCTAssertEqual(snapshot.workspaceID, LabFaultFixtures.workspaceID)
            XCTAssertEqual(snapshot.people.first?.id, LabFaultFixtures.personID)
            XCTAssertEqual(state.events.count, 3,
                           "Retry must traverse all three actual transport reads")
            XCTAssertEqual(Set(state.events.map(\.route)), Set([.people, .pursuits, .proposals]))
        } else {
            XCTFail("The real transport retry must return a decoded workspace")
        }
        XCTAssertNotNil(LabFaultRegistry.shared.engine(host: service.baseURL.host))
        let close = LabFaultObservedTask("Retry session close completed") { await lifecycle.close() }
        tasks.append(close)
        guard await observeCompletion(of: [close], all: tasks, releasing: barriers) else { return }
        XCTAssertEqual(events.snapshot, ["invalidate"])
        XCTAssertNil(LabFaultRegistry.shared.engine(host: service.baseURL.host))
        XCTAssertFalse(LabFaultURLProtocol.isIsolated(TalentSignalNetworking.session))
    }

    private func observeCompletion(of observed: [LabFaultTestTask], all tasks: [LabFaultTestTask],
                                   releasing barriers: [LabFaultReadBarrier]) async -> Bool {
        await fulfillment(of: observed.map { $0.completionExpectation() }, timeout: 2)
        guard observed.allSatisfy({ $0.isFinished }) else {
            // Release first: a regressed admission may be waiting for close,
            // which in turn needs one of these test-owned continuations.
            barriers.forEach { $0.release() }
            tasks.forEach { $0.cancel() }
            // Fresh expectations also work for tasks observed earlier. Never
            // await Task.value or use a task-group timeout that must join a
            // non-cooperating child after the timeout fires.
            await fulfillment(of: tasks.map { $0.completionExpectation() }, timeout: 2)
            XCTAssertTrue(tasks.allSatisfy { $0.isFinished },
                          "Owned tasks did not settle after releasing all test barriers and cancellation")
            return false
        }
        return true
    }

    private func assertCancelled(_ read: LabFaultObservedTask<PursuitWorkspaceSnapshot>,
                                 file: StaticString = #filePath, line: UInt = #line) {
        guard case let .failure(error)? = read.result else {
            return XCTFail("The admitted read must settle with cancellation", file: file, line: line)
        }
        XCTAssertTrue(error is CancellationError, file: file, line: line)
    }

    private func assertUnsupported(_ admission: LabFaultObservedTask<PursuitWorkspaceSnapshot>,
                                   file: StaticString = #filePath, line: UInt = #line) {
        guard case let .failure(error)? = admission.result else {
            return XCTFail("Closed admission must reject before entering the operation", file: file, line: line)
        }
        XCTAssertEqual((error as? URLError)?.code, .unsupportedURL, file: file, line: line)
    }
}

private enum LabFaultAdmissionProbe: Error { case operationStarted }

private protocol LabFaultTestTask: AnyObject {
    var isFinished: Bool { get }
    func completionExpectation() -> XCTestExpectation
    func cancel()
}

/// An unstructured task is held explicitly by the test. Waiting observes a
/// completion latch, so releasing a failed test's barriers never depends on
/// returning from the operation being tested.
private final class LabFaultObservedTask<Value>: LabFaultTestTask {
    private let state: LabFaultTaskResult<Value>
    private let task: Task<Void, Never>

    init(_ description: String, operation: @escaping @Sendable () async throws -> Value) {
        let state = LabFaultTaskResult<Value>(description: description)
        self.state = state
        task = Task {
            do { state.finish(.success(try await operation())) }
            catch { state.finish(.failure(error)) }
        }
    }

    var result: Result<Value, Error>? { state.result }
    var isFinished: Bool { result != nil }
    func completionExpectation() -> XCTestExpectation { state.completionExpectation() }
    func cancel() { task.cancel() }
}

private final class LabFaultTaskResult<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private let description: String
    private var outcome: Result<Value, Error>?
    private var waiters: [XCTestExpectation] = []

    init(description: String) { self.description = description }

    var result: Result<Value, Error>? {
        lock.lock(); defer { lock.unlock() }
        return outcome
    }

    func finish(_ result: Result<Value, Error>) {
        lock.lock()
        outcome = result
        let pending = waiters
        waiters.removeAll()
        lock.unlock()
        pending.forEach { $0.fulfill() }
    }

    func completionExpectation() -> XCTestExpectation {
        let completed = XCTestExpectation(description: description)
        lock.lock()
        let alreadyFinished = outcome != nil
        if !alreadyFinished { waiters.append(completed) }
        lock.unlock()
        if alreadyFinished { completed.fulfill() }
        return completed
    }
}

/// Cancellation is observed immediately, but settlement requires release. This
/// models an admitted operation suspended at a boundary without sleeps/retries.
private final class LabFaultReadBarrier: @unchecked Sendable {
    let entered: XCTestExpectation
    let cancelled: XCTestExpectation?
    private let lock = NSLock()
    private var released = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(entered: XCTestExpectation, cancelled: XCTestExpectation? = nil) {
        self.entered = entered
        self.cancelled = cancelled
    }

    func pause() async {
        await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                lock.lock()
                let resumeNow = released
                if !resumeNow { waiters.append(continuation) }
                lock.unlock()
                entered.fulfill()
                if resumeNow { continuation.resume() }
            }
        } onCancel: {
            self.cancelled?.fulfill()
        }
    }

    func release() {
        lock.lock()
        released = true
        let pending = waiters
        waiters.removeAll()
        lock.unlock()
        pending.forEach { $0.resume() }
    }
}

private final class LabFaultLifecycleEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String] = []

    func append(_ event: String) {
        lock.lock(); values.append(event); lock.unlock()
    }

    var snapshot: [String] {
        lock.lock(); defer { lock.unlock() }
        return values
    }
}
