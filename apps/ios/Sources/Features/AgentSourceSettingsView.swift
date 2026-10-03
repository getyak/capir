import CryptoKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class AgentProfileReferenceStore: ObservableObject {
    @Published private(set) var references: [AgentProfileReference]
    @Published private(set) var persistenceError: String?

    private let defaults: UserDefaults
    private let key: String
    private let allowsLegacyMigration: Bool

    init(workspaceID: String?, runtimeScope: String? = nil, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        key = Self.storageKey(workspaceID: runtimeScope ?? workspaceID)
        allowsLegacyMigration = runtimeScope == nil || workspaceID.map {
            RuntimeLegacyBindings.authorizes(accountID: $0, scope: runtimeScope!, defaults: defaults)
        } == true
        if runtimeScope != nil, let workspaceID, allowsLegacyMigration {
            let oldKey = Self.storageKey(workspaceID: workspaceID)
            if defaults.data(forKey: key) == nil, let old = defaults.data(forKey: oldKey) {
                defaults.set(old, forKey: key)
                if defaults.data(forKey: key) == old { defaults.removeObject(forKey: oldKey) }
            }
        }
        references = AgentProfileReferenceCodec.decode(defaults.data(forKey: key))
    }

    static func deleteAll(
        workspaceID: String?,
        runtimeScope: String? = nil,
        defaults: UserDefaults = .standard
    ) -> Bool {
        let key = storageKey(workspaceID: runtimeScope ?? workspaceID)
        defaults.removeObject(forKey: key)
        if runtimeScope == nil || workspaceID.map({ RuntimeLegacyBindings.authorizes(
            accountID: $0, scope: runtimeScope!, defaults: defaults) }) == true {
            defaults.removeObject(forKey: TalentSignalAgentPreference.linkedInURLKey)
        }
        return defaults.data(forKey: key) == nil
    }

    @discardableResult
    func upsert(platform: AgentProfilePlatform, value: String) -> Bool {
        do {
            let reference = try AgentProfileReference(platform: platform, value: value)
            let next = AgentProfileReferenceCodec.upserting(reference, in: references)
            try defaults.set(AgentProfileReferenceCodec.encode(next), forKey: key)
            guard defaults.data(forKey: key) != nil else { throw CocoaError(.fileWriteUnknown) }
            references = next
            persistenceError = nil
            return true
        } catch {
            persistenceError = (error as? LocalizedError)?.errorDescription
                ?? "The reference could not be saved."
            return false
        }
    }

    @discardableResult
    func remove(platform: AgentProfilePlatform) -> Bool {
        let next = references.filter { $0.platform != platform }
        do {
            if next.isEmpty {
                defaults.removeObject(forKey: key)
            } else {
                try defaults.set(AgentProfileReferenceCodec.encode(next), forKey: key)
            }
            references = next
            persistenceError = nil
            return true
        } catch {
            persistenceError = "The reference could not be removed."
            return false
        }
    }

    @discardableResult
    func migrateLegacyLinkedIn(_ value: String) -> Bool {
        guard allowsLegacyMigration else { return false }
        guard !references.contains(where: { $0.platform == .linkedIn }) else {
            return true
        }
        return upsert(platform: .linkedIn, value: value)
    }

    private static func storageKey(workspaceID: String?) -> String {
        let scope = workspaceID ?? "local-preview"
        let digest = SHA256.hash(data: Data(scope.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return "talent-signal.agent.profile-references.v1.\(digest.prefix(24))"
    }
}

private struct ProfileReferenceEditorRoute: Identifiable {
    let existing: AgentProfileReference?
    let id = UUID()
}

@MainActor
struct AgentSourceSettingsView: View {
    @ObservedObject var profileReferenceStore: AgentProfileReferenceStore
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    @ObservedObject var sessionStore: AgentSessionStore
    let isActionButtonSetupComplete: Bool
    let screenshotShortcutReceivedAt: Double
    let isCalendarSyncEnabled: Bool

    @Environment(\.talentSignalReduceTransparency) private var reduceTransparency
    @Environment(\.appLanguage) private var appLanguage
    @State private var editorRoute: ProfileReferenceEditorRoute?
    @State private var selectedImportKind: ContactImportSourceKind?
    @State private var isFileImporterPresented = false
    @State private var isReadingFile = false
    @State private var importDraft: ContactImportDraft?
    @State private var importError: String?

    private static let contactFileTypes: [UTType] = [
        .commaSeparatedText,
        .tabSeparatedText,
        .vCard,
        .plainText,
    ]

    var body: some View {
        List {
            importSection
            referenceSection
            deviceSection
            accountConnectionSection
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.tsSurface)
        .navigationTitle(appLanguage.text("Sources & imports"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("agent-sources")
        .overlay {
            if isReadingFile {
                ProgressView(appLanguage.text("Reading contacts on this device…"))
                    .padding(20)
                    .background(reduceTransparency ? AnyShapeStyle(Color.tsSurface) : AnyShapeStyle(.regularMaterial), in: RoundedRectangle(cornerRadius: 18))
                    .accessibilityIdentifier("agent-import-reading")
            }
        }
        .fileImporter(
            isPresented: $isFileImporterPresented,
            allowedContentTypes: Self.contactFileTypes,
            allowsMultipleSelection: false,
            onCompletion: receiveSelectedFiles
        )
        .sheet(item: $editorRoute) { route in
            AgentProfileReferenceEditorView(
                existing: route.existing,
                onSave: { platform, value in
                    profileReferenceStore.upsert(platform: platform, value: value)
                },
                onDelete: route.existing.map { existing in
                    { profileReferenceStore.remove(platform: existing.platform) }
                }
            )
        }
        .sheet(item: $importDraft) { draft in
            ContactImportReviewView(
                draft: draft,
                workspaceStore: workspaceStore,
                sessionStore: sessionStore
            )
        }
        .alert(
            appLanguage.text("This file could not be reviewed"),
            isPresented: Binding(
                get: { importError != nil },
                set: { if !$0 { importError = nil } }
            )
        ) {
            Button(appLanguage.text("OK"), role: .cancel) { importError = nil }
        } message: {
            Text(importError ?? "")
        }
    }

    private var importSection: some View {
        Section {
            Button {
                chooseFile(for: .contactsFile)
            } label: {
                AgentSourceActionRow(
                    systemImage: "person.crop.rectangle.stack",
                    title: appLanguage.text("Contacts file"),
                    detail: appLanguage.text("Review a CSV or vCard before adding people."),
                    status: appLanguage.text("Choose file")
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("agent-import-contacts-file")

            Button {
                chooseFile(for: .linkedInConnections)
            } label: {
                AgentSourceActionRow(
                    systemImage: "arrow.down.doc",
                    title: appLanguage.text("LinkedIn connections"),
                    detail: appLanguage.text(
                        "Select Connections.csv from your member-requested export."
                    ),
                    status: appLanguage.text("File snapshot")
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("agent-import-linkedin")

            if let pending = sessionStore.contactProposalDraft {
                Label {
                    Text(
                        String(
                            format: appLanguage.text("Finish the protected review for %@ before importing another person."),
                            locale: appLanguage.locale,
                            pending.name
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                } icon: {
                    Image(systemName: "clock.arrow.circlepath")
                        .foregroundStyle(Color.tsVermilion)
                }
                .accessibilityIdentifier("agent-import-pending-review")
            }
        } header: {
            Text(appLanguage.text("Bring people in"))
        } footer: {
            Text(
                appLanguage.text(
                    "The file is parsed on this device and discarded after review. Nothing is merged on name alone."
                )
            )
        }
    }

    private var referenceSection: some View {
        Section {
            ForEach(profileReferenceStore.references) { reference in
                Button {
                    editorRoute = .init(existing: reference)
                } label: {
                    AgentProfileReferenceRow(reference: reference)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("agent-reference-\(reference.platform.rawValue)")
            }

            Button {
                editorRoute = .init(existing: nil)
            } label: {
                Label(
                    appLanguage.text("Add profile reference"),
                    systemImage: "plus"
                )
            }
            .accessibilityIdentifier("agent-add-profile-reference")

            if let persistenceError = profileReferenceStore.persistenceError {
                Text(appLanguage.text(persistenceError))
                    .font(.caption)
                    .foregroundStyle(Color.tsVermilion)
            }
        } header: {
            Text(appLanguage.text("Your profile references"))
        } footer: {
            Text(
                appLanguage.text(
                    "These references describe how you identify yourself. They grant no account access, contact access, or background sync."
                )
            )
        }
    }

    private var deviceSection: some View {
        Section {
            NavigationLink {
                ActionButtonSetupView()
            } label: {
                AgentSourceActionRow(
                    systemImage: "button.programmable",
                    title: appLanguage.text("Action Button & Shortcuts"),
                    detail: appLanguage.text("Stages a selected screenshot for ordinary review."),
                    status: screenshotShortcutReceivedAt > 0
                        ? appLanguage.text("Local receipt")
                        : isActionButtonSetupComplete
                            ? appLanguage.text("Assigned")
                            : appLanguage.text("Set up")
                )
            }
            .accessibilityIdentifier("agent-open-action-button")

            NavigationLink {
                CalendarSyncSettingsView()
            } label: {
                AgentSourceActionRow(
                    systemImage: "calendar",
                    title: appLanguage.text("Apple Calendar"),
                    detail: appLanguage.text(
                        "One-way projection of confirmed events; each write stays reviewable."
                    ),
                    status: isCalendarSyncEnabled
                        ? appLanguage.text("Projection on")
                        : appLanguage.text("Projection off")
                )
            }
            .accessibilityIdentifier("agent-open-calendar")
        } header: {
            Text(appLanguage.text("Device capabilities"))
        }
    }

    private var accountConnectionSection: some View {
        Section {
            AgentSourceAvailabilityRow(
                title: appLanguage.text("Google Contacts"),
                detail: appLanguage.text("No Google account access has been granted."),
                status: appLanguage.text("Not connected")
            )
            AgentSourceAvailabilityRow(
                title: appLanguage.text("Microsoft 365"),
                detail: appLanguage.text("No Microsoft account access has been granted."),
                status: appLanguage.text("Not connected")
            )
            AgentSourceAvailabilityRow(
                title: appLanguage.text("Another CRM"),
                detail: appLanguage.text("Use its CSV export for a reviewable snapshot today."),
                status: appLanguage.text("Use file")
            )
        } header: {
            Text(appLanguage.text("Account connections"))
        } footer: {
            Text(
                appLanguage.text(
                    "A live connection will show its exact read scope, last successful access, and revoke control here."
                )
            )
        }
    }

    private func chooseFile(for kind: ContactImportSourceKind) {
        selectedImportKind = kind
        importError = nil
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--fixture-agent-contact-import") {
            loadFixtureImportIfRequested()
            return
        }
#endif
        isFileImporterPresented = true
    }

    private func receiveSelectedFiles(_ result: Result<[URL], Error>) {
        guard let kind = selectedImportKind else { return }
        switch result {
        case let .success(urls):
            guard let url = urls.first else { return }
            isReadingFile = true
            Task {
                do {
                    let draft = try await Task.detached(priority: .userInitiated) {
                        let accessed = url.startAccessingSecurityScopedResource()
                        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                        let handle = try FileHandle(forReadingFrom: url)
                        defer { try? handle.close() }
                        var data = Data()
                        while data.count <= ContactImportParser.maximumByteCount {
                            let remaining = ContactImportParser.maximumByteCount + 1
                                - data.count
                            guard let chunk = try handle.read(
                                upToCount: min(64 * 1_024, remaining)
                            ), !chunk.isEmpty else { break }
                            data.append(chunk)
                        }
                        return try ContactImportParser.parse(
                            data: data,
                            fileName: url.lastPathComponent,
                            sourceKind: kind
                        )
                    }.value
                    importDraft = draft
                } catch {
                    importError = localizedImportError(error)
                }
                isReadingFile = false
            }
        case let .failure(error):
            importError = localizedImportError(error)
        }
    }

    private func localizedImportError(_ error: Error) -> String {
        switch error as? ContactImportParserError {
        case .empty: return appLanguage.text("The selected file is empty.")
        case .tooLarge: return appLanguage.text("Choose a contacts file smaller than 10 MB.")
        case .unsupportedEncoding:
            return appLanguage.text("The file encoding could not be read safely.")
        case .malformedCSV:
            return appLanguage.text("The CSV contains an unfinished quoted field.")
        case .missingHeader:
            return appLanguage.text("The contacts file needs a recognizable header row.")
        case .tooManyRows:
            return appLanguage.text("This import supports up to 5,000 rows at a time.")
        case .tooManyColumns:
            return appLanguage.text("This contacts file has too many columns.")
        case .fieldTooLarge:
            return appLanguage.text("A contact field is too large to review safely.")
        case .unsupportedFile:
            return appLanguage.text("Choose a CSV, tab-separated text, or vCard file.")
        case .invalidVCard:
            return appLanguage.text("The vCard could not be read safely.")
        case nil:
            return (error as? LocalizedError)?.errorDescription
                ?? appLanguage.text("The selected file could not be read.")
        }
    }

    private func loadFixtureImportIfRequested() {
#if DEBUG
        guard ProcessInfo.processInfo.arguments.contains("--fixture-agent-contact-import"),
              importDraft == nil else { return }
        let csv = """
        First Name,Last Name,URL,Email Address,Company,Position,Private note
        Maya,Chen,https://www.linkedin.com/in/maya,maya@example.com,Northstar,VP Product,excluded
        Maya,Duplicate,https://www.linkedin.com/in/maya,maya@example.com,Northstar,VP Product,excluded
        ,,https://www.linkedin.com/in/missing,,Unknown,,excluded
        """
        importDraft = try? ContactImportParser.parse(
            data: Data(csv.utf8),
            fileName: "Connections.csv",
            sourceKind: .linkedInConnections,
            importedAt: Date(timeIntervalSince1970: 1_788_451_200)
        )
#endif
    }
}

private struct AgentSourceActionRow: View {
    let systemImage: String
    let title: String
    let detail: String
    let status: String

    var body: some View {
        HStack(spacing: 13) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Color.tsInk)
                .frame(width: 30, height: 30)
                .background(Color.tsSurfaceMuted, in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                    Spacer(minLength: 4)
                    Text(status)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.tsMutedInk)
                }
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }
}

private struct AgentSourceAvailabilityRow: View {
    let title: String
    let detail: String
    let status: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                Spacer(minLength: 4)
                Text(status)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Color.tsMutedInk)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.tsSurfaceMuted, in: Capsule())
            }
            Text(detail)
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
        }
        .padding(.vertical, 4)
    }
}

private struct AgentProfileReferenceRow: View {
    let reference: AgentProfileReference
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        HStack(spacing: 13) {
            Image(systemName: reference.platform.systemImage)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Color.tsInk)
                .frame(width: 30, height: 30)
                .background(Color.tsSurfaceMuted, in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(appLanguage.text(reference.platform.title))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                Text(reference.value)
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Text(appLanguage.text("Reference"))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.tsSurfaceMuted, in: Capsule())
        }
        .contentShape(Rectangle())
    }
}

private struct AgentProfileReferenceEditorView: View {
    let existing: AgentProfileReference?
    let onSave: (AgentProfilePlatform, String) -> Bool
    let onDelete: (() -> Bool)?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLanguage) private var appLanguage
    @State private var platform: AgentProfilePlatform
    @State private var value: String
    @State private var errorMessage: String?

    init(
        existing: AgentProfileReference?,
        onSave: @escaping (AgentProfilePlatform, String) -> Bool,
        onDelete: (() -> Bool)?
    ) {
        self.existing = existing
        self.onSave = onSave
        self.onDelete = onDelete
        _platform = State(initialValue: existing?.platform ?? .linkedIn)
        _value = State(initialValue: existing?.value ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(appLanguage.text("Platform"), selection: $platform) {
                        ForEach(AgentProfilePlatform.allCases) { platform in
                            Text(appLanguage.text(platform.title)).tag(platform)
                        }
                    }
                    .disabled(existing != nil)

                    TextField(platform.example, text: $value)
                        .textInputAutocapitalization(.never)
                        .keyboardType(platform == .weChat ? .default : .URL)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("agent-reference-value")

                    if let url = existing?.url {
                        Link(destination: url) {
                            Label(
                                appLanguage.text("Open saved reference"),
                                systemImage: "arrow.up.right.square"
                            )
                        }
                    }

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(Color.tsVermilion)
                    }
                } footer: {
                    Text(
                        appLanguage.text(
                            "This is an identity reference only. capri will not sign in, sync, or publish through it."
                        )
                    )
                }

                if onDelete != nil {
                    Section {
                        Button(role: .destructive) {
                            if onDelete?() == true {
                                dismiss()
                            } else {
                                errorMessage = appLanguage.text(
                                    "The reference could not be removed."
                                )
                            }
                        } label: {
                            Label(appLanguage.text("Remove reference"), systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle(
                existing == nil
                    ? appLanguage.text("Add reference")
                    : appLanguage.text("Edit reference")
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(appLanguage.text("Cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(appLanguage.text("Save")) { save() }
                        .disabled(value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("agent-save-profile-reference")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        do {
            _ = try AgentProfileReference(platform: platform, value: value)
            if onSave(platform, value) {
                dismiss()
            } else {
                errorMessage = appLanguage.text("The reference could not be saved.")
            }
        } catch AgentProfileReferenceError.empty {
            errorMessage = appLanguage.text("Enter a profile link or handle.")
        } catch AgentProfileReferenceError.wrongPlatform {
            errorMessage = appLanguage.text("This link belongs to a different platform.")
        } catch {
            errorMessage = appLanguage.text("This link or handle is not valid for that platform.")
        }
    }
}

private struct ContactImportRowReceipt: Equatable {
    let resourceID: String
    let outcome: AgentContactReceipt.Outcome
    let isSessionHistoryAvailable: Bool
}

@MainActor
private struct ContactImportReviewView: View {
    let draft: ContactImportDraft
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    @ObservedObject var sessionStore: AgentSessionStore

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLanguage) private var appLanguage
    @State private var receipts: [String: ContactImportRowReceipt] = [:]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    importSummary
                } footer: {
                    Text(
                        appLanguage.text(
                            "Only mapped fields are held in this review. The selected raw file is not stored by capri."
                        )
                    )
                }

                if !draft.unmappedColumns.isEmpty {
                    Section {
                        Text(draft.unmappedColumns.joined(separator: ", "))
                            .font(.subheadline)
                            .foregroundStyle(Color.tsInk)
                    } header: {
                        Text(appLanguage.text("Not mapped"))
                    } footer: {
                        Text(
                            appLanguage.text(
                                "These column names remain visible for review, but their values are not imported."
                            )
                        )
                    }
                }

                Section {
                    ForEach(draft.records) { record in
                        if record.isReviewable {
                            NavigationLink {
                                ContactImportRecordReviewView(
                                    source: draft,
                                    record: record,
                                    workspaceStore: workspaceStore,
                                    sessionStore: sessionStore,
                                    existingReceipt: receipts[record.id],
                                    onComplete: { receipt in
                                        receipts[record.id] = receipt
                                    }
                                )
                            } label: {
                                ContactImportRecordRow(
                                    record: record,
                                    receipt: receipts[record.id]
                                )
                            }
                        } else {
                            ContactImportRecordRow(record: record, receipt: nil)
                        }
                    }
                } header: {
                    Text(appLanguage.text("People found"))
                } footer: {
                    Text(
                        appLanguage.text(
                            "Open one person to check identity and choose create, attach, or leave unresolved. No person is preselected."
                        )
                    )
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color.tsSurface)
            .navigationTitle(appLanguage.text("Review import"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(appLanguage.text("Done")) { dismiss() }
                }
            }
            .accessibilityIdentifier("agent-import-review")
        }
    }

    private var importSummary: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(draft.fileName)
                    .font(.headline)
                    .foregroundStyle(Color.tsInk)
                Spacer(minLength: 8)
                Text(appLanguage.text("On-device review"))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Color.tsConfirmed)
            }
            HStack(spacing: 18) {
                ImportCount(value: draft.reviewableCount, label: appLanguage.text("Reviewable"))
                ImportCount(value: draft.blockedCount, label: appLanguage.text("Blocked"))
                ImportCount(value: receipts.count, label: appLanguage.text("Saved"))
            }
            Text(
                String(
                    format: appLanguage.text("Source fingerprint %@"),
                    locale: appLanguage.locale,
                    String(draft.contentHash.prefix(12))
                )
            )
            .font(.caption.monospaced())
            .foregroundStyle(Color.tsMutedInk)
        }
        .padding(.vertical, 4)
    }
}

private struct ImportCount: View {
    let value: Int
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value.formatted())
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.tsInk)
            Text(label)
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
        }
    }
}

private struct ContactImportRecordRow: View {
    let record: ContactImportRecord
    let receipt: ContactImportRowReceipt?
    @Environment(\.appLanguage) private var appLanguage

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(Color.tsSurfaceMuted)
                .frame(width: 34, height: 34)
                .overlay {
                    Text(initials)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                }
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(record.displayName.isEmpty
                    ? appLanguage.text("Missing name")
                    : record.displayName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                if let context = [record.jobTitle, record.organization]
                    .compactMap({ $0 }).joined(separator: " · ").nonEmpty {
                    Text(context)
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                }
                if let clue = record.identityClue {
                    Text("\(clue.label) · \(clue.value)")
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                        .lineLimit(1)
                }
                if let duplicate = record.duplicateOfRow {
                    Text(
                        String(
                            format: appLanguage.text("Exact duplicate of row %lld"),
                            locale: appLanguage.locale,
                            Int64(duplicate)
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsVermilion)
                }
            }
            Spacer(minLength: 4)
            Text(status)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(statusColor)
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }

    private var initials: String {
        String(record.displayName.split(separator: " ").prefix(2).compactMap(\.first))
            .uppercased()
    }

    private var status: String {
        if receipt != nil { return appLanguage.text("Saved") }
        if record.duplicateOfRow != nil { return appLanguage.text("Duplicate") }
        if !record.isReviewable { return appLanguage.text("Blocked") }
        return appLanguage.text("Review")
    }

    private var statusColor: Color {
        receipt != nil ? .tsConfirmed : record.isReviewable ? .tsMutedInk : .tsVermilion
    }
}

private enum ImportContextChoice: Hashable {
    case unselected
    case new
    case existing(String)
}

private enum ImportIdentityLookupPhase: Equatable {
    case idle
    case checking
    case complete
    case failed(String)
}

@MainActor
private struct ContactImportRecordReviewView: View {
    let source: ContactImportDraft
    let record: ContactImportRecord
    @ObservedObject var workspaceStore: PursuitWorkspaceStore
    @ObservedObject var sessionStore: AgentSessionStore
    let existingReceipt: ContactImportRowReceipt?
    let onComplete: (ContactImportRowReceipt) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLanguage) private var appLanguage
    @State private var editedName: String
    @State private var relationshipContext: String
    @State private var confirmIdentityClue = false
    @State private var candidates: [WorkspacePerson] = []
    @State private var lookupPhase: ImportIdentityLookupPhase = .idle
    @State private var selectedPersonID: String?
    @State private var contextChoice: ImportContextChoice = .unselected
    @State private var createSeparatePerson = false
    @State private var saveUnresolved = false
    @State private var isSaving = false
    @State private var operationKey: String?
    @State private var lockedDraft: ConversationContactDraft?
    @State private var lockedTarget: ConversationContactTarget?
    @State private var lockedConfirmIdentityClue: Bool?
    @State private var receipt: ContactImportRowReceipt?
    @State private var saveError: String?
    @State private var recoveryClearFailed = false

    init(
        source: ContactImportDraft,
        record: ContactImportRecord,
        workspaceStore: PursuitWorkspaceStore,
        sessionStore: AgentSessionStore,
        existingReceipt: ContactImportRowReceipt?,
        onComplete: @escaping (ContactImportRowReceipt) -> Void
    ) {
        self.source = source
        self.record = record
        self.workspaceStore = workspaceStore
        self.sessionStore = sessionStore
        self.existingReceipt = existingReceipt
        self.onComplete = onComplete
        _editedName = State(initialValue: record.displayName)
        _relationshipContext = State(initialValue: "General relationship")
        _receipt = State(initialValue: existingReceipt)
    }

    var body: some View {
        List {
            sourceSection
            reviewedFieldsSection
            warningSection
            identitySection
            decisionSection
            resultSection
            actionSection
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.tsSurface)
        .navigationTitle(appLanguage.text("Review person"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await checkIdentity() }
        .onChange(of: editedName) { _ in
            guard operationKey == nil else { return }
            resetIdentityDecision()
        }
        .accessibilityIdentifier("agent-import-person-review")
    }

    private var sourceSection: some View {
        Section {
            LabeledContent(appLanguage.text("Source"), value: source.fileName)
            LabeledContent(
                appLanguage.text("Row"),
                value: record.rowNumber.formatted()
            )
            LabeledContent(
                appLanguage.text("Raw file"),
                value: appLanguage.text("Not retained")
            )
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("agent-import-raw-file-status")
        } footer: {
            Text(
                appLanguage.text(
                    "This review can create one Person, attach the source to one existing Person, or preserve an unresolved identity case."
                )
            )
        }
    }

    private var reviewedFieldsSection: some View {
        Section {
            TextField(appLanguage.text("Name"), text: $editedName)
                .disabled(operationKey != nil || receipt != nil)
                .accessibilityIdentifier("agent-import-person-name")
            TextField(
                appLanguage.text("Relationship context"),
                text: $relationshipContext
            )
            .disabled(operationKey != nil || usesExistingContext || receipt != nil)

            if let organization = record.organization {
                LabeledContent(appLanguage.text("Organization"), value: organization)
            }
            if let title = record.jobTitle {
                LabeledContent(appLanguage.text("Position"), value: title)
            }
        } header: {
            Text(appLanguage.text("Reviewed fields"))
        } footer: {
            Text(
                appLanguage.text(
                    "Organization and position remain source evidence in this slice; they are not silently promoted to confirmed profile fields."
                )
            )
        }
    }

    @ViewBuilder
    private var warningSection: some View {
        if !record.warnings.isEmpty {
            Section {
                ForEach(record.warnings, id: \.rawValue) { warning in
                    Label(warningText(warning), systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(Color.tsVermilion)
                }
            } header: {
                Text(appLanguage.text("Needs attention"))
            }
        }
    }

    private var identitySection: some View {
        Section {
            if let clue = record.identityClue {
                LabeledContent(clue.label, value: clue.value)
                Toggle(
                    appLanguage.text("Confirm this identity clue"),
                    isOn: $confirmIdentityClue
                )
                .disabled(operationKey != nil || receipt != nil)
            } else {
                Label(
                    appLanguage.text("No valid email, phone, or HTTPS profile link was found."),
                    systemImage: "questionmark.circle"
                )
                .foregroundStyle(Color.tsMutedInk)
            }

            switch lookupPhase {
            case .idle:
                Button(appLanguage.text("Check identity again")) {
                    Task { await checkIdentity() }
                }
            case .checking:
                HStack(spacing: 10) {
                    ProgressView()
                    Text(appLanguage.text("Checking current and historical identity…"))
                        .foregroundStyle(Color.tsMutedInk)
                }
            case .complete:
                if candidates.isEmpty {
                    Label(
                        appLanguage.text("No supported match was found."),
                        systemImage: "person.crop.circle.badge.questionmark"
                    )
                    .foregroundStyle(Color.tsMutedInk)
                } else {
                    ForEach(candidates) { person in
                        candidateButton(person)
                    }
                }
            case let .failed(message):
                Text(message)
                    .font(.caption)
                    .foregroundStyle(Color.tsVermilion)
                Button(appLanguage.text("Retry identity check")) {
                    Task { await checkIdentity() }
                }
            }
        } header: {
            Text(appLanguage.text("Identity"))
        } footer: {
            Text(
                appLanguage.text(
                    "Name-only matches are suggestions. Current or historical handle ownership stays visible and no match is selected for you."
                )
            )
        }
    }

    private var decisionSection: some View {
        Section {
            if let selectedPerson {
                Picker(appLanguage.text("Relationship"), selection: $contextChoice) {
                    Text(appLanguage.text("Choose a relationship"))
                        .tag(ImportContextChoice.unselected)
                    Text(appLanguage.text("Create a new relationship context"))
                        .tag(ImportContextChoice.new)
                    ForEach(selectedPerson.contexts) { context in
                        Text(context.displayLabel)
                            .tag(ImportContextChoice.existing(context.id))
                    }
                }
                .disabled(operationKey != nil || receipt != nil)
            }

            Toggle(
                candidates.isEmpty
                    ? appLanguage.text("Create a new person")
                    : appLanguage.text("Create a separate person"),
                isOn: Binding(
                    get: { createSeparatePerson },
                    set: { value in
                        createSeparatePerson = value
                        if value {
                            selectedPersonID = nil
                            contextChoice = .unselected
                            saveUnresolved = false
                        }
                    }
                )
            )
            .disabled(
                lookupPhase != .complete
                    || hasCurrentHistoricalConflict
                    || operationKey != nil
                    || receipt != nil
            )

            if !candidates.isEmpty {
                Toggle(
                    appLanguage.text("Leave identity unresolved"),
                    isOn: Binding(
                        get: { saveUnresolved },
                        set: { value in
                            saveUnresolved = value
                            if value {
                                selectedPersonID = nil
                                contextChoice = .unselected
                                createSeparatePerson = false
                            }
                        }
                    )
                )
                .disabled(operationKey != nil || receipt != nil)
            }
        } header: {
            Text(appLanguage.text("Your decision"))
        } footer: {
            Text(decisionExplanation)
        }
    }

    @ViewBuilder
    private var resultSection: some View {
        if let receipt {
            Section {
                Label(
                    receiptTitle(receipt),
                    systemImage: "checkmark.seal.fill"
                )
                .foregroundStyle(Color.tsConfirmed)
                Text(
                    String(
                        format: appLanguage.text("Resource receipt %@"),
                        locale: appLanguage.locale,
                        String(receipt.resourceID.suffix(8))
                    )
                )
                .font(.caption.monospaced())
                .foregroundStyle(Color.tsMutedInk)
                if recoveryClearFailed {
                    Text(
                        appLanguage.text(
                            "The canonical save succeeded, but protected local recovery could not be cleared. Reopening still uses the same operation."
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsVermilion)
                }
                if !receipt.isSessionHistoryAvailable {
                    Text(
                        appLanguage.text(
                            "The canonical save succeeded, but Session history could not be protected on this device."
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsVermilion)
                }
            }
        } else if let saveError {
            Section {
                Text(saveError)
                    .font(.caption)
                    .foregroundStyle(Color.tsVermilion)
                if operationKey != nil {
                    Text(
                        appLanguage.text(
                            "The result is not assumed. Retry uses the same protected decision and cannot create a second operation."
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                }
            }
        }
    }

    private var actionSection: some View {
        Section {
            if receipt != nil {
                Button(appLanguage.text("Done")) { dismiss() }
                    .frame(maxWidth: .infinity)
            } else {
                Button {
                    submit()
                } label: {
                    if isSaving {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text(operationKey == nil
                            ? appLanguage.text("Review and save one person")
                            : appLanguage.text("Retry the same decision"))
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(!canSubmit || isSaving)
                .accessibilityIdentifier("agent-import-save-person")

                if !workspaceStore.isCanonical {
                    Text(
                        appLanguage.text(
                            "Preview workspace: file review works, but no canonical Person can be saved."
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                }
            }
        }
    }

    private var selectedPerson: WorkspacePerson? {
        guard let selectedPersonID else { return nil }
        return candidates.first { $0.id == selectedPersonID }
    }

    private var usesExistingContext: Bool {
        if case .existing = contextChoice { return true }
        return false
    }

    private var hasCurrentHistoricalConflict: Bool {
        ConversationContactMatchPolicy.hasCurrentHistoricalConflict(in: candidates)
    }

    private var canSubmit: Bool {
        guard workspaceStore.isCanonical,
              lookupPhase == .complete,
              receipt == nil,
              !editedName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              lockedTarget != nil || currentTarget != nil else { return false }
        if lockedTarget != nil { return true }
        if currentTargetRequiresNewContext {
            return !relationshipContext.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).isEmpty
        }
        return true
    }

    private var currentTargetRequiresNewContext: Bool {
        guard !saveUnresolved else { return false }
        if createSeparatePerson { return true }
        if selectedPersonID != nil, contextChoice == .new { return true }
        return false
    }

    private var currentTarget: ConversationContactTarget? {
        if saveUnresolved { return .unresolved }
        if createSeparatePerson { return .newPerson }
        guard let selectedPersonID else { return nil }
        switch contextChoice {
        case .unselected: return nil
        case .new:
            return .existingPerson(
                personID: selectedPersonID,
                relationshipContextID: nil
            )
        case let .existing(contextID):
            return .existingPerson(
                personID: selectedPersonID,
                relationshipContextID: contextID
            )
        }
    }

    private var decisionExplanation: String {
        if hasCurrentHistoricalConflict {
            return appLanguage.text(
                "A current and historical owner conflict is active. Choose the current owner, remove the clue, or preserve an unresolved identity review."
            )
        }
        if saveUnresolved {
            return appLanguage.text("The source will be kept for identity review without creating or attaching a Person.")
        }
        if createSeparatePerson {
            return appLanguage.text("One new Person and relationship context will be created after this exact review.")
        }
        if selectedPersonID != nil {
            return appLanguage.text("The reviewed source will attach to the selected Person and relationship.")
        }
        return appLanguage.text("Choose what this one reviewed source should change.")
    }

    private func candidateButton(_ person: WorkspacePerson) -> some View {
        let canSelect = ConversationContactMatchPolicy.canSelect(person, among: candidates)
        let isSelected = selectedPersonID == person.id
        return Button {
            guard canSelect, operationKey == nil, receipt == nil else { return }
            selectedPersonID = isSelected ? nil : person.id
            contextChoice = .unselected
            createSeparatePerson = false
            saveUnresolved = false
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? Color.tsConfirmed : Color.tsMutedInk)
                VStack(alignment: .leading, spacing: 3) {
                    Text(person.displayLabel)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.tsInk)
                    Text(candidateStatus(person))
                        .font(.caption)
                        .foregroundStyle(canSelect ? Color.tsMutedInk : Color.tsVermilion)
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!canSelect || operationKey != nil || receipt != nil)
    }

    private func candidateStatus(_ person: WorkspacePerson) -> String {
        if person.identityMatches.contains(where: { $0.kind == "confirmed_handle" }) {
            return appLanguage.text("Current clue · source-linked")
        }
        if person.identityMatches.contains(where: { $0.kind == "expired_handle" }) {
            return hasCurrentHistoricalConflict
                ? appLanguage.text("Historical clue · comparison only")
                : appLanguage.text("Historical clue · requires reconfirmation")
        }
        return appLanguage.text("Same name only · not an identity match")
    }

    private func checkIdentity() async {
        guard operationKey == nil, receipt == nil else { return }
        lookupPhase = .checking
        resetDecisionOnly()
        let proposed = record.contactDraft(
            displayName: editedName.trimmingCharacters(in: .whitespacesAndNewlines),
            relationshipContext: relationshipContext,
            fileName: source.fileName
        )
        let nameMatches = workspaceStore.snapshot.map {
            ConversationContactMatchPolicy.sameNameReview(for: proposed, in: $0.people)
        } ?? []
        guard workspaceStore.isCanonical, let clue = proposed.identityClue else {
            candidates = nameMatches
            lookupPhase = .complete
            return
        }
        do {
            let authoritative = try await workspaceStore.findContactMatches(
                identityClue: clue
            )
            let ids = Set(authoritative.map(\.id))
            candidates = authoritative + nameMatches.filter { !ids.contains($0.id) }
            lookupPhase = .complete
        } catch {
            candidates = []
            lookupPhase = .failed(
                (error as? LocalizedError)?.errorDescription
                    ?? appLanguage.text("Identity checking is temporarily unavailable.")
            )
        }
    }

    private func resetIdentityDecision() {
        lookupPhase = .idle
        candidates = []
        resetDecisionOnly()
    }

    private func resetDecisionOnly() {
        selectedPersonID = nil
        contextChoice = .unselected
        createSeparatePerson = false
        saveUnresolved = false
        saveError = nil
    }

    private func submit() {
        guard !isSaving else { return }
        let target = lockedTarget ?? currentTarget
        guard let target else { return }
        let contactDraft = lockedDraft ?? record.contactDraft(
            displayName: editedName.trimmingCharacters(in: .whitespacesAndNewlines),
            relationshipContext: relationshipContext.trimmingCharacters(
                in: .whitespacesAndNewlines
            ),
            fileName: source.fileName
        )
        let confirmedClue = lockedConfirmIdentityClue ?? confirmIdentityClue
        let key = operationKey ?? makeOperationKey(
            draft: contactDraft,
            target: target,
            confirmIdentityClue: confirmedClue
        )
        if let pending = sessionStore.contactProposalOperationKey, pending != key {
            saveError = appLanguage.text(
                "Finish the existing protected contact review before starting another import decision."
            )
            return
        }
        guard sessionStore.saveContactProposal(
            contactDraft,
            idempotencyKey: key,
            pendingTarget: target,
            pendingConfirmIdentityClue: confirmedClue
        ) else {
            saveError = appLanguage.text(
                "This decision could not be protected for a safe retry. Nothing was sent."
            )
            return
        }
        operationKey = key
        lockedDraft = contactDraft
        lockedTarget = target
        lockedConfirmIdentityClue = confirmedClue
        isSaving = true
        saveError = nil
        let capturedAt = sessionStore.contactProposalCapturedAt ?? source.importedAt
        Task {
            do {
                let result = try await workspaceStore.saveContactDraft(
                    contactDraft,
                    target: target,
                    confirmIdentityClue: confirmedClue,
                    capturedAt: capturedAt,
                    idempotencyKey: key
                )
                let outcome: AgentContactReceipt.Outcome
                switch target {
                case .newPerson: outcome = .createdPerson
                case .existingPerson: outcome = .matchedExisting
                case .unresolved: outcome = .identityReview
                }
                let canonicalPerson = result.identity.personID.flatMap { personID in
                    workspaceStore.snapshot?.people.first { $0.id == personID }
                }
                let canonicalContext = result.identity.relationshipContextID.flatMap {
                    contextID in
                    canonicalPerson?.contexts.first { $0.id == contextID }
                }
                let receiptSessionID = sessionStore.recordContactReceipt(
                    operationKey: key,
                    outcome: outcome,
                    result: result,
                    personDisplayLabel: canonicalPerson?.displayLabel ?? contactDraft.name,
                    contextDisplayLabel: canonicalContext?.displayLabel
                        ?? (outcome == .identityReview
                            ? nil
                            : contactDraft.relationshipContext)
                )
                let completed = ContactImportRowReceipt(
                    resourceID: result.resource.id,
                    outcome: outcome,
                    isSessionHistoryAvailable: receiptSessionID != nil
                )
                recoveryClearFailed = !sessionStore.clearContactProposal()
                receipt = completed
                onComplete(completed)
            } catch {
                saveError = (error as? LocalizedError)?.errorDescription
                    ?? appLanguage.text(
                        "The result is unknown. Retry the same protected decision."
                    )
            }
            isSaving = false
        }
    }

    private func makeOperationKey(
        draft: ConversationContactDraft,
        target: ConversationContactTarget,
        confirmIdentityClue: Bool
    ) -> String {
        let targetValue: String
        switch target {
        case .newPerson: targetValue = "new"
        case let .existingPerson(personID, contextID):
            targetValue = "existing:\(personID):\(contextID ?? "new-context")"
        case .unresolved: targetValue = "unresolved"
        }
        let decision = [
            source.contentHash,
            record.rowNumber.formatted(.number.grouping(.never)),
            draft.name,
            draft.relationshipContext,
            targetValue,
            confirmIdentityClue ? "confirm-clue" : "source-only",
        ].joined(separator: "|")
        let digest = SHA256.hash(data: Data(decision.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return "ios:file-contact:\(digest)"
    }

    private func receiptTitle(_ receipt: ContactImportRowReceipt) -> String {
        switch receipt.outcome {
        case .createdPerson: return appLanguage.text("Person created from reviewed source")
        case .matchedExisting: return appLanguage.text("Source attached to selected Person")
        case .identityReview: return appLanguage.text("Saved for identity review")
        }
    }

    private func warningText(_ warning: ContactImportWarning) -> String {
        switch warning {
        case .missingName:
            return appLanguage.text("A name is required before this row can be reviewed.")
        case .invalidEmail:
            return appLanguage.text("The invalid email will not be used as an identity clue.")
        case .invalidPhone:
            return appLanguage.text("The invalid phone will not be used as an identity clue.")
        case .insecureProfileURL:
            return appLanguage.text("A non-HTTPS profile link will not be used as an identity clue.")
        case .notesExcluded:
            return appLanguage.text("Imported notes are excluded until a separate evidence review exists.")
        case .exactDuplicate:
            return appLanguage.text("This exact identity clue already appears earlier in the file.")
        }
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
