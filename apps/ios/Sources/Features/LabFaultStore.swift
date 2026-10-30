import SwiftUI

@MainActor
final class LabFaultStore: ObservableObject {
    @Published private(set) var workspace: PursuitWorkspaceStore?
    @Published private(set) var state: LabFaultState?
    @Published private(set) var sessionID: UUID?
    @Published private(set) var isWorking = false
    @Published private(set) var isOpening = false
    @Published private(set) var error: String?
    private var service: LabFaultWorkspaceService?
    private var read: Task<Void, Never>?
    private var polling: Task<Void, Never>?
    private let enabled: Bool
    private var generation = UUID()
    var isEnabled: Bool { enabled }
    init(enabled: Bool = DeviceLabAvailability.enabled) { self.enabled = enabled }
    deinit { read?.cancel(); polling?.cancel() }
    func start(_ preset: LabFaultPreset, minutes: Int) async {
        guard enabled, !isOpening, !isWorking, [1, 5].contains(minutes) else { return }
        isOpening = true
        defer { isOpening = false }
        await close()
        do {
            let service = try LabFaultWorkspaceService(preset: preset, seconds: Double(minutes * 60), enabled: enabled)
            self.service = service
            // One-shot faults remain available to inspect until the person
            // retries. Shared foreground/interval refresh must not consume them.
            workspace = PursuitWorkspaceStore(service: service,
                actionCompletions: LabFaultMemoryCompletions(), activeRefreshEnabled: false)
            sessionID = UUID(); generation = sessionID!; error = nil
            state = await service.engine.state()
            let current = generation
            polling = Task { [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(1)) } catch { return }
                    guard let self, let service = self.service else { return }
                    let state = await service.engine.state()
                    guard !Task.isCancelled, self.generation == current else { return }
                    self.state = state
                }
            }
            reload()
        } catch { self.error = "The isolated fault session could not be opened." }
    }
    func reload() {
        guard !isWorking, let workspace, let service else { return }
        isWorking = true
        let current = generation
        read = Task { [weak self] in
            await workspace.load()
            let state = await service.engine.state()
            guard let self, self.generation == current else { return }
            self.state = state
            self.isWorking = false; self.read = nil
        }
    }
    func cancelRead() async {
        let current = generation, task = read
        task?.cancel()
        await task?.value
        if current == generation { read = nil; isWorking = false }
    }
    func stop(_ reason: LabFaultEnd = .stopped) async {
        guard let service else { return }
        let current = generation
        await service.end(reason)
        guard current == generation else { return }
        await cancelRead()
        let state = await service.engine.state()
        if current == generation { self.state = state }
    }
    func close(ifSessionID expected: UUID? = nil) async {
        if let expected, expected != sessionID { return }
        generation = UUID(); polling?.cancel(); polling = nil
        let oldRead = read, oldService = service
        read = nil; isWorking = false
        service = nil; workspace = nil; state = nil; sessionID = nil; error = nil
        oldRead?.cancel()
        await oldRead?.value
        await oldService?.close()
    }
}

private final class LabFaultMemoryCompletions: PursuitActionCompletionPersisting {
    func entry(for actionID: String) throws -> PersistedPursuitActionCompletion? { nil }
    func allEntries() throws -> [PersistedPursuitActionCompletion] { [] }
    func save(_ entry: PersistedPursuitActionCompletion) throws { throw PursuitWorkspaceClientError.actionCompletionUnavailable }
    func remove(actionID: String) throws {}
    func deleteAll() throws {}
}
