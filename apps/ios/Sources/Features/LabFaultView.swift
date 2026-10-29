import SwiftUI

struct LabFaultView: View {
    @StateObject private var store = LabFaultStore()
    @Environment(\.appLanguage) private var language
    @State private var preset = LabFaultPreset.offline
    @State private var minutes = 1
    @State private var showingPreview = false
    var body: some View {
        Form {
            Section {
                Text(language.text("Test failure and recovery through the real workspace client and pages, using only an isolated synthetic transport."))
                Picker(language.text("Fault preset"), selection: $preset) {
                    ForEach(LabFaultPreset.allCases) { Text(language.text($0.title)).tag($0) }
                }.accessibilityIdentifier("lab-fault-preset")
                Text(language.text(preset.explanation)).font(.footnote).foregroundStyle(Color.tsMutedInk)
                Picker(language.text("Fault duration"), selection: $minutes) {
                    ForEach([1, 5], id: \.self) { Text(String(format: language.text("%lld minutes"), Int64($0))).tag($0) }
                }
                Button(language.text("Open isolated test")) {
                    Task { await store.start(preset, minutes: minutes); showingPreview = store.workspace != nil }
                }.disabled(!store.isEnabled || store.isWorking || store.isOpening).accessibilityIdentifier("lab-fault-open")
                if !store.isEnabled { Text(language.text("Fault simulation requires an internal device-tools build.")) }
                if let error = store.error { Text(language.text(error)).foregroundStyle(Color.tsVermilion) }
            } footer: {
                Text(language.text("No real account, server, source or permission is changed. Faults affect only this preview. Closing discards the session; background stops new injections."))
            }
        }
        .navigationTitle(language.text("Isolated fault tests"))
        .fullScreenCover(isPresented: $showingPreview) {
            if let workspace = store.workspace, let id = store.sessionID {
                LabFaultPreview(store: store, workspace: workspace, id: id).id(id)
            }
        }
    }
}

private struct LabFaultPreview: View {
    @ObservedObject var store: LabFaultStore
    @ObservedObject var workspace: PursuitWorkspaceStore
    let id: UUID
    @Environment(\.appLanguage) private var language
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showsDetails = false
    @State private var page = 0
    @State private var peoplePosition: String?
    @State private var showsTrace = false
    @State private var selected: String?
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { Task { await store.close(ifSessionID: id); dismiss() } } label: {
                    Image(systemName: "xmark").font(.system(size: 20, weight: .semibold)).frame(width: 44, height: 44).contentShape(Rectangle())
                }.accessibilityLabel(language.text("Close preview")).accessibilityIdentifier("lab-fault-close")
                Text(language.text("Fault test")).font(.headline).frame(maxWidth: .infinity)
                Button { showsTrace = true } label: {
                    Image(systemName: "list.bullet.rectangle").font(.system(size: 20, weight: .semibold)).frame(width: 44, height: 44).contentShape(Rectangle())
                }.accessibilityLabel(language.text("Fixture request trace")).accessibilityIdentifier("lab-fault-trace")
            }.buttonStyle(.plain).padding(.horizontal, 12)
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .center, spacing: 12) {
                    Text(language.text("Synthetic test"))
                        .font(.caption.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel(language.text("SYNTHETIC TRANSPORT · No connection to your backend"))
                        .accessibilityIdentifier("lab-fault-boundary")
                    if dynamicTypeSize.isAccessibilitySize {
                        Spacer(minLength: 0)
                        Menu { faultActions } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 20, weight: .medium))
                                .frame(width: 44, height: 44)
                                .contentShape(Rectangle())
                        }
                        .accessibilityLabel(language.text("Fault controls"))
                        .accessibilityIdentifier("lab-fault-actions")
                    }
                }
                if let state = store.state {
                    DisclosureGroup(isExpanded: $showsDetails) {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(language.text(state.preset.title))
                                Text(language.text(state.preset.explanation))
                                Text(state.expiresAt, style: .time)
                            }.fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
                        }.frame(maxHeight: 130)
                    } label: {
                        Text(language.text(state.ended == nil ? "Fault active" : state.ended == .expired ? "Fault expired" : "Fault stopped"))
                            .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("lab-fault-status")
                    }
                }
                if !dynamicTypeSize.isAccessibilitySize {
                    HStack(spacing: 20) { faultActions; Spacer(minLength: 0) }
                }
                Picker(language.text("Page"), selection: $page) {
                    Text(language.text("People")).tag(0)
                    Text(language.text("Today")).tag(1)
                }.pickerStyle(.segmented).accessibilityIdentifier("lab-fault-page")
            }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Color.tsSurface)
            if workspace.refreshNotice != nil {
                PursuitWorkspaceRefreshNotice(message: language.text("Fixture refresh failed. The last synthetic read remains visible until a successful retry."))
            }
            readContent.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color.tsSurface).tint(Color.tsVermilion)
        .onChange(of: scenePhase) { phase in if phase == .background { Task { await store.stop(.background) } } }
        .onDisappear { Task { await store.close(ifSessionID: id) } }
        .sheet(isPresented: $showsTrace) {
            NavigationStack {
                List {
                    if let state = store.state {
                        Text(language.text("These are synthetic transport outcomes, not real server failures. Only read routes are allowed."))
                        ForEach(state.events) { event in
                            LabInfoRow(label: "\(event.route.rawValue) · \(event.status.map(String.init) ?? "—")",
                                value: "\(event.result.rawValue) · +\(String(format: "%.0f ms", event.offsetMilliseconds)) · \(language.text(event.injected ? "Injected fault" : "Healthy fixture"))")
                        }
                        if state.droppedEvents > 0 { Text(language.text("The trace limit was reached. Some events are omitted.")) }
                    }
                }.navigationTitle(language.text("Fixture request trace")).navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button(language.text("Done")) { showsTrace = false }.accessibilityIdentifier("lab-fault-trace-done") } }
            }
        }
        .alert(language.text("Synthetic inspection"), isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } })) {
            Button(language.text("Done")) { selected = nil }
        } message: { Text(selected ?? "") }
    }
    @ViewBuilder private var faultActions: some View {
        if store.state?.ended == nil {
            Button { Task { await store.stop() } } label: {
                Text(language.text("Stop fault")).fixedSize(horizontal: false, vertical: true)
                    .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }.accessibilityIdentifier("lab-fault-stop")
        }
        if store.isWorking {
            Button { Task { await store.cancelRead() } } label: {
                Text(language.text("Cancel read")).fixedSize(horizontal: false, vertical: true)
                    .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }.accessibilityIdentifier("lab-fault-cancel")
        } else {
            Button { store.reload() } label: {
                Text(language.text("Reload fixture")).fixedSize(horizontal: false, vertical: true)
                    .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }.accessibilityIdentifier("lab-fault-reload")
        }
    }
    @ViewBuilder private var readContent: some View {
        switch workspace.phase {
        case .loading: PursuitWorkspaceLoadingView(isSynthetic: true)
        case .failed(let message):
            ScrollView {
                PursuitWorkspaceFailureView(message: language.text(message == "The canonical workspace could not be loaded." ? "The isolated fixture read did not complete. Inspect its request trace, then retry." : message), isRetrying: workspace.isReadInFlight,
                    completedReadCount: workspace.completedReadCount, isSynthetic: true) { store.reload() }
            }
            .accessibilityIdentifier("lab-fault-read-content")
        case .empty: PursuitWorkspaceEmptyView(selectedPage: page == 0 ? .people : .today)
        case .loaded(let snapshot), .preview(let snapshot):
            if page == 0 {
                WorkspacePeopleView(snapshot: snapshot, isPreview: false, restorationPosition: nil, scrollPosition: $peoplePosition,
                    onSelect: { selected = $0.displayLabel }, onAsk: { _ in selected = language.text("This fixture provides read-only inspection. No model or external action runs.") })
            } else {
                // The canonical rendering branch consumes the transported snapshot;
                // the standalone demo branch would substitute its own fixed decisions.
                PursuitTodayView(snapshot: snapshot, isPreview: false, calendarActivities: [], unreadSessions: [], actionRecovery: nil,
                    onOpenSession: { _ in }, onOpenCalendar: {},
                    onOpenAttention: { item in selected = language.text(item.evidenceState?.explanation ?? "No source reference is available") },
                    onOpenPursuit: { _ in selected = language.text("This fixture provides read-only inspection. No model or external action runs.") },
                    onOpenActionRecovery: { _ in })
            }
        }
    }
}
