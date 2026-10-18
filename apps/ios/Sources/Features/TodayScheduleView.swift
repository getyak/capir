import SwiftUI

@MainActor
struct TodayScheduleContext {
    let scopeID: String
    let service: any TodayScheduleServing
    let expiresAt: Date?
    let isCurrent: () -> Bool
}

/// This surface owns one lease on the existing refresh registry, only while
/// Today is selected. It never owns a polling timer or persisted calendar.
@MainActor
struct TodayScheduleSection: View {
    let context: TodayScheduleContext?
    let isActive: Bool
    @ObservedObject var store: TodayScheduleStore
    @State private var registration: WorkspaceActiveRefresh.Registration?

    var body: some View {
        TodayScheduleView(store: store)
            .task(id: "\(context?.scopeID ?? "unbound"):\(isActive)") {
                release()
                guard isActive, let context else { return }
                store.activate(scopeID: context.scopeID, service: context.service,
                               expiresAt: context.expiresAt, isCurrent: context.isCurrent)
                registration = WorkspaceActiveRefresh.shared.register(scope: "today-schedules-\(context.scopeID)") { generation in
                    guard WorkspaceActiveRefresh.shared.coordinator.isCurrent(generation) else { return }
                    await store.refresh()
                }
                await store.refresh()
            }
            .onDisappear { release() }
    }
    private func release() {
        if let registration { WorkspaceActiveRefresh.shared.unregister(registration); self.registration = nil }
        store.invalidate()
    }
}

@MainActor
private struct TodayScheduleView: View {
    @ObservedObject var store: TodayScheduleStore
    @Environment(\.appLanguage) private var language
    @State private var selection: Selection?
    private struct Selection: Identifiable { let id: UUID }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(store.clock.formatted(.dateTime.year().month(.wide).day().weekday(.wide).locale(language.locale)))
                .font(.title2.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("today-local-date")
            VStack(alignment: .leading, spacing: 10) {
                Text(language.text(store.coverage == .partial ? "Arrangements read so far" : "Next arrangement"))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsMutedInk)
                if let item = store.item, let end = item.endsAt {
                    Button { selection = Selection(id: item.sourceID) } label: {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(item.title).font(.headline).foregroundStyle(Color.tsInk).fixedSize(horizontal: false, vertical: true)
                            Text(TodayScheduleFormatting.interval(start: item.occurredAt, end: end,
                                zone: item.timeZone, allDay: item.allDay,
                                locale: language.locale, allDayLabel: language.text("All day")))
                                .font(.subheadline).foregroundStyle(Color.tsInk)
                            Text(String(format: language.text("Recorded by you · %@"), locale: language.locale, item.timeZone))
                                .font(.caption).foregroundStyle(Color.tsMutedInk)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(language.text("Opens the current read-only arrangement"))
                    .accessibilityIdentifier("today-canonical-arrangement")
                } else {
                    Text(language.text(emptyCopy))
                        .font(.subheadline).foregroundStyle(Color.tsMutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if store.coverage == .partial {
                    Text(language.text("Only part of the next seven local dates has been checked."))
                        .font(.caption).foregroundStyle(Color.tsMutedInk)
                }
                if store.coverage == .unavailable || store.coverage == .partial {
                    Button(language.text("Retry arrangement read")) { Task { await store.refresh() } }
                        .font(.subheadline).frame(minHeight: 44)
                        .accessibilityIdentifier("today-schedule-retry")
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.tsSurface, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.tsMutedInk.opacity(0.18), lineWidth: 0.5))
        }
        .sheet(item: $selection, onDismiss: { store.dismissDetail() }) { selection in
            TodayScheduleDetailView(store: store, sourceID: selection.id)
        }
    }
    private var emptyCopy: String {
        switch store.coverage {
        case .loading: return "Reading your arrangements…"
        case .complete: return "No upcoming arrangements in the next seven days."
        case .partial: return "No upcoming arrangement in the part read so far."
        case .unavailable: return "Arrangements are temporarily unavailable."
        }
    }
}

@MainActor
private struct TodayScheduleDetailView: View {
    @ObservedObject var store: TodayScheduleStore
    let sourceID: UUID
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLanguage) private var language

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    switch store.detail {
                    case .idle, .loading:
                        ProgressView(language.text("Reading the current arrangement…"))
                    case .unavailable:
                        Text(language.text("This arrangement is no longer available or could not be verified."))
                            .foregroundStyle(Color.tsMutedInk)
                        Button(language.text("Retry arrangement read")) { Task { await store.openDetail(id: sourceID) } }
                            .frame(minHeight: 44)
                    case .ready(let record):
                        Text(record.title ?? "").font(.title2.weight(.semibold)).foregroundStyle(Color.tsInk)
                            .accessibilityIdentifier("today-schedule-detail-title")
                        if let start = record.startsAt, let end = record.endsAt, let zone = record.timeZone {
                            Text(TodayScheduleFormatting.interval(start: start, end: end, zone: zone,
                                allDay: record.allDay, locale: language.locale, allDayLabel: language.text("All day")))
                            Text(zone).font(.caption).foregroundStyle(Color.tsMutedInk)
                        }
                        Text(language.text("Recorded by you. Viewing this does not change or export the arrangement."))
                            .font(.subheadline).foregroundStyle(Color.tsMutedInk)
                        DisclosureGroup(language.text("Arrangement source")) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(record.id.uuidString.lowercased()).font(.caption.monospaced()).textSelection(.enabled)
                                Text(String(format: language.text("Revision %lld"), locale: language.locale, Int64(record.revision))).font(.caption)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            .background(Color.tsSurface)
            .navigationTitle(language.text("Your arrangement"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(language.text("Close")) { dismiss() } } }
            .task(id: sourceID) { await store.openDetail(id: sourceID) }
        }
    }
}

