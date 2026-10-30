import Foundation

actor LabFaultEngine {
    struct Response {
        let id: UUID
        let status: Int?
        let data: Data
        let failure: URLError.Code?
        let interrupted: Bool
        let delaySeconds: Double
    }
    let host: String
    private let preset: LabFaultPreset
    private let expiresAt: Date
    private let deadline: Double
    private let started: Double
    private let clock: () -> Double
    private var ended: LabFaultEnd?
    private var closed = false
    private var consumed = false
    private var events: [LabFaultTrace] = []
    private var droppedEvents = 0
    init(preset: LabFaultPreset, seconds: Double, now: Date = Date(), clock: @escaping () -> Double = LabDiagnosticsEngine.clock) {
        self.preset = preset; self.clock = clock; started = clock(); deadline = started + seconds
        expiresAt = now.addingTimeInterval(seconds); host = "\(UUID().uuidString.lowercased()).lab.invalid"
    }
    func state() -> LabFaultState {
        expire()
        return .init(preset: preset, expiresAt: expiresAt, ended: ended, events: events, droppedEvents: droppedEvents)
    }
    func end(_ reason: LabFaultEnd) {
        if ended == nil { ended = reason }
        if reason == .closed {
            closed = true
            for index in events.indices where events[index].result == .pending { events[index].result = .cancelled }
        }
    }
    private func expire() { if ended == nil, clock() >= deadline { ended = .expired } }
    func prepare(_ request: URLRequest) throws -> Response {
        expire()
        let route: LabFaultRoute
        switch request.url?.path {
        case "/v1/people": route = .people
        case "/v1/pursuits": route = .pursuits
        case "/v1/pursuit-proposals": route = .proposals
        default: route = .rejected
        }
        guard !closed, request.url?.scheme == "lab-fixture", request.url?.host == host,
              request.url?.port == nil, request.url?.query == nil, request.url?.fragment == nil,
              request.url?.user == nil, request.url?.password == nil,
              (request.httpMethod ?? "GET") == "GET", request.httpBody == nil, request.httpBodyStream == nil,
              request.value(forHTTPHeaderField: "Authorization") == "Bearer \(LabFaultFixtures.token)", route != .rejected else {
            add(.init(id: UUID(), route: .rejected, offsetMilliseconds: offset, injected: false, status: nil, result: .rejected))
            throw URLError(.unsupportedURL)
        }
        let active = ended == nil
        var status = 200, failure: URLError.Code?, interrupted = false, delay = 0.0, injected = false
        if active {
            switch preset {
            case .offline: failure = .notConnectedToInternet; injected = true
            case .latency: delay = 2; injected = true
            case .unauthorizedOnce, .rateLimitedOnce, .serverErrorOnce, .interruptedOnce:
                if route == .people, !consumed {
                    consumed = true; injected = true
                    switch preset {
                    case .unauthorizedOnce: status = 401
                    case .rateLimitedOnce: status = 429
                    case .serverErrorOnce: status = 500
                    default: interrupted = true
                    }
                }
            case .staleEvidence: injected = route == .proposals
            }
        }
        let data = try status == 200 ? LabFaultFixtures.data(route: route, expiredEvidence: active && preset == .staleEvidence) : LabFaultFixtures.error(status: status)
        let id = UUID()
        add(.init(id: id, route: route, offsetMilliseconds: offset, injected: injected, status: failure == nil ? status : nil, result: .pending))
        return .init(id: id, status: failure == nil ? status : nil, data: data, failure: failure, interrupted: interrupted, delaySeconds: delay)
    }
    func finish(_ id: UUID, result: LabFaultTrace.Result) {
        guard !closed, let index = events.firstIndex(where: { $0.id == id }) else { return }
        events[index].result = result
    }
    func permitsDelivery() -> Bool { !closed }
    private var offset: Double { max(0, clock() - started) * 1000 }
    private func add(_ event: LabFaultTrace) { if events.count < 120 { events.append(event) } else { droppedEvents += 1 } }
}

// This registry is consulted only by URLSessions explicitly configured with this
// protocol. No URLProtocol.registerClass, shared-session mutation or fallback IO.
final class LabFaultRegistry: @unchecked Sendable {
    static let shared = LabFaultRegistry()
    private let lock = NSLock()
    private var engines: [String: LabFaultEngine] = [:]
    func add(_ engine: LabFaultEngine, host: String) { lock.lock(); engines[host] = engine; lock.unlock() }
    func remove(host: String) { lock.lock(); engines.removeValue(forKey: host); lock.unlock() }
    func engine(host: String?) -> LabFaultEngine? { lock.lock(); defer { lock.unlock() }; return host.flatMap { engines[$0] } }
}

final class LabFaultURLProtocol: URLProtocol, @unchecked Sendable {
    private let delivery = DispatchQueue(label: "lab-fault-protocol")
    private var work: Task<Void, Never>?
    private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    static func isIsolated(_ session: URLSession) -> Bool {
        session.configuration.protocolClasses?.contains { $0 == LabFaultURLProtocol.self } == true
    }
    static func permits(_ request: URLRequest) -> Bool {
        guard let url = request.url, url.scheme == "lab-fixture", url.port == nil,
              url.query == nil, url.fragment == nil, url.user == nil, url.password == nil,
              (request.httpMethod ?? "GET") == "GET", request.httpBody == nil, request.httpBodyStream == nil,
              request.value(forHTTPHeaderField: "Authorization") == "Bearer \(LabFaultFixtures.token)",
              ["/v1/people", "/v1/pursuits", "/v1/pursuit-proposals"].contains(url.path) else { return false }
        return LabFaultRegistry.shared.engine(host: url.host) != nil
    }
    override func startLoading() {
        self.delivery.async { [self] in
            guard !self.stopped else { return }
            guard let engine = LabFaultRegistry.shared.engine(host: self.request.url?.host) else {
                self.client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
            }
            self.work = Task { [self] in
                do {
                    let plan = try await engine.prepare(self.request)
                    do {
                        if plan.delaySeconds > 0 { try await Task.sleep(for: .seconds(plan.delaySeconds)) }
                        try Task.checkCancellation()
                        guard await engine.permitsDelivery() else { throw CancellationError() }
                        self.delivery.async { [self] in
                            guard !self.stopped else {
                                Task { await engine.finish(plan.id, result: .cancelled) }
                                return
                            }
                            if let failure = plan.failure {
                                self.client?.urlProtocol(self, didFailWithError: URLError(failure))
                                Task { await engine.finish(plan.id, result: .failed) }
                                return
                            }
                            guard let url = self.request.url, let response = HTTPURLResponse(url: url, statusCode: plan.status ?? 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]) else { return }
                            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                            if plan.interrupted {
                                self.client?.urlProtocol(self, didLoad: Data(plan.data.prefix(12)))
                                self.client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
                                Task { await engine.finish(plan.id, result: .interrupted) }
                            } else {
                                self.client?.urlProtocol(self, didLoad: plan.data)
                                self.client?.urlProtocolDidFinishLoading(self)
                                Task { await engine.finish(plan.id, result: .delivered) }
                            }
                        }
                    } catch {
                        await engine.finish(plan.id, result: .cancelled)
                        throw error
                    }
                } catch {
                    self.delivery.async { [self] in
                        if !self.stopped { self.client?.urlProtocol(self, didFailWithError: error) }
                    }
                }
            }
        }
    }
    override func stopLoading() {
        self.delivery.async { [self] in
            self.stopped = true
            self.work?.cancel()
            self.work = nil
        }
    }
}

/// Owns complete workspace operations, including their structured request
/// children. Admission and registration happen before the first suspension.
actor LabFaultSessionLifecycle {
    private let onClose: @Sendable () async -> Void
    private var reads: [UUID: Task<PursuitWorkspaceSnapshot, Error>] = [:]
    private var closeTask: Task<Void, Never>?

    init(onClose: @escaping @Sendable () async -> Void) { self.onClose = onClose }

    func load(_ operation: @escaping @Sendable () async throws -> PursuitWorkspaceSnapshot) async throws -> PursuitWorkspaceSnapshot {
        guard closeTask == nil else { throw URLError(.unsupportedURL) }
        try Task.checkCancellation()
        let id = UUID()
        let task = Task {
            try Task.checkCancellation()
            return try await operation()
        }
        reads[id] = task
        defer { reads.removeValue(forKey: id) }
        return try await withTaskCancellationHandler {
            try await task.value
        } onCancel: {
            task.cancel()
        }
    }

    func close() async {
        if let closeTask { await closeTask.value; return }
        let admitted = Array(reads.values), onClose = onClose
        // Installing the task closes admission before any await. A cancelled
        // waiter cannot cancel this shared cleanup operation.
        let task = Task {
            for read in admitted { _ = await read.result }
            await onClose()
        }
        closeTask = task
        admitted.forEach { $0.cancel() }
        await task.value
    }
}

/// The lifecycle's cleanup closure retains these resources until admitted
/// reads settle. Deinit provides the same one-time cleanup if close was omitted.
private final class LabFaultSessionResources: @unchecked Sendable {
    private let session: URLSession
    private let host: String
    private let lock = NSLock()
    private var invalidated = false

    init(session: URLSession, host: String) { self.session = session; self.host = host }
    deinit { invalidate() }

    func invalidate() {
        lock.lock()
        guard !invalidated else { lock.unlock(); return }
        invalidated = true
        lock.unlock()
        session.invalidateAndCancel()
        LabFaultRegistry.shared.remove(host: host)
    }
}

final class LabFaultWorkspaceService: PursuitWorkspaceServing {
    let engine: LabFaultEngine
    let baseURL: URL
    private let client: URLPursuitWorkspaceClient
    private let lifecycle: LabFaultSessionLifecycle
    init(preset: LabFaultPreset, seconds: Double, enabled: Bool = DeviceLabAvailability.enabled,
         clock: @escaping () -> Double = LabDiagnosticsEngine.clock) throws {
        guard enabled, seconds > 0, seconds <= 300 else { throw URLError(.unsupportedURL) }
        let engine = LabFaultEngine(preset: preset, seconds: seconds, clock: clock)
        self.engine = engine
        // An unsupported-by-default scheme also prevents accidental DNS/network fallback.
        baseURL = URL(string: "lab-fixture://\(engine.host)")!
        LabFaultRegistry.shared.add(engine, host: engine.host)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LabFaultURLProtocol.self]
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil; configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 10
        let session = URLSession(configuration: configuration, delegate: RuntimeRedirectGuard(), delegateQueue: nil)
        let resources = LabFaultSessionResources(session: session, host: engine.host)
        client = URLPursuitWorkspaceClient(baseURL: baseURL, accessToken: LabFaultFixtures.token,
            accountID: LabFaultFixtures.workspaceID, userID: LabFaultFixtures.userID, userDisplayName: "Lab tester", session: session)
        lifecycle = LabFaultSessionLifecycle { [engine, resources] in
            await engine.end(.closed)
            resources.invalidate()
        }
    }
    func loadWorkspace() async throws -> PursuitWorkspaceSnapshot {
        let client = client
        return try await lifecycle.load { try await client.loadWorkspace() }
    }
    func end(_ reason: LabFaultEnd) async { await engine.end(reason) }
    func close() async { await lifecycle.close() }
}
