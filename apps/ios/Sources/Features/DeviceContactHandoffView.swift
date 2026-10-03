import Contacts
import ContactsUI
import SwiftUI

struct DeviceContactDraft: Identifiable, Equatable {
    let id: String
    let displayName: String
    let handleType: IdentityHandleType
    let handleValue: String

    init(
        sourceID: String,
        displayName: String,
        handleType: IdentityHandleType,
        handleValue: String
    ) {
        id = sourceID
        self.displayName = displayName.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        self.handleType = handleType
        self.handleValue = handleValue.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
    }

    var isComplete: Bool {
        !displayName.isEmpty
    }

    var handleLabel: String {
        handleType.label
    }

    func makeContact() -> CNMutableContact {
        let contact = CNMutableContact()
        contact.givenName = displayName
        guard !handleValue.isEmpty else { return contact }
        switch handleType {
        case .phone:
            contact.phoneNumbers = [
                CNLabeledValue(
                    label: CNLabelPhoneNumberMobile,
                    value: CNPhoneNumber(stringValue: handleValue)
                ),
            ]
        case .email:
            contact.emailAddresses = [
                CNLabeledValue(
                    label: CNLabelWork,
                    value: handleValue as NSString
                ),
            ]
        case .wechat:
            contact.socialProfiles = [
                CNLabeledValue(
                    label: "WeChat",
                    value: CNSocialProfile(
                        urlString: nil,
                        username: handleValue,
                        userIdentifier: nil,
                        service: "WeChat"
                    )
                ),
            ]
        }
        return contact
    }
}

private enum DeviceContactHandoffResult: Equatable {
    case notStarted
    case cancelled
    case saved(identifier: String)
}

struct DeviceContactHandoffView: View {
    let draft: DeviceContactDraft
    let relationshipLabel: String

    @State private var editorDraft: DeviceContactDraft?
    @State private var result: DeviceContactHandoffResult = .notStarted

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 14) {
                Circle()
                    .fill(Color.tsVermilion.opacity(0.12))
                    .frame(width: 52, height: 52)
                    .overlay {
                        Text(initials)
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(Color.tsVermilion)
                    }
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 4) {
                    SectionLabel(text: "Contact handoff")
                    Text(draft.displayName)
                        .font(.headline)
                        .foregroundStyle(Color.tsInk)
                    Text(relationshipLabel)
                        .font(.caption)
                        .foregroundStyle(Color.tsMutedInk)
                }
                Spacer(minLength: 0)
            }

            Divider().overlay(Color.tsLine)

            contactField(label: "Name", value: draft.displayName)
            if !draft.handleValue.isEmpty {
                contactField(label: draft.handleLabel, value: draft.handleValue)
            }

            Text(
                "Only the fields above open in Apple's contact editor. Relationship context and screenshot evidence stay in capri."
            )
            .font(.caption)
            .foregroundStyle(Color.tsMutedInk)
            .fixedSize(horizontal: false, vertical: true)

            resultView

            Button {
                editorDraft = draft
            } label: {
                Label(
                    result.isSaved ? "Contact saved" : "Review and add in Contacts",
                    systemImage: result.isSaved
                        ? "checkmark.circle.fill"
                        : "person.crop.circle.badge.plus"
                )
            }
            .buttonStyle(TSSecondaryButtonStyle())
            .disabled(result.isSaved)
            .accessibilityIdentifier("review-device-contact")
            .accessibilityHint(
                "Opens Apple's editor. Nothing is saved until you confirm there."
            )
        }
        .tsCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("device-contact-handoff")
        .sheet(item: $editorDraft) { draft in
            DeviceContactEditorSheet(draft: draft) { completion in
                switch completion {
                case let .saved(identifier):
                    result = .saved(identifier: identifier)
                case .cancelled:
                    result = .cancelled
                }
            }
        }
    }

    private var initials: String {
        String(
            draft.displayName
                .split(separator: " ")
                .prefix(2)
                .compactMap(\.first)
        )
        .uppercased()
    }

    @ViewBuilder
    private var resultView: some View {
        switch result {
        case .notStarted:
            Label("No Contacts write has been attempted", systemImage: "lock.shield")
                .foregroundStyle(Color.tsMutedInk)
        case .cancelled:
            Label("Contact editor closed without a saved contact", systemImage: "xmark.circle")
                .foregroundStyle(Color.tsMutedInk)
                .accessibilityIdentifier("device-contact-cancelled")
        case let .saved(identifier):
            Label(
                "Saved in Contacts · receipt \(identifier.prefix(8))",
                systemImage: "checkmark.seal.fill"
            )
            .foregroundStyle(Color.tsConfirmed)
            .accessibilityIdentifier("device-contact-saved")
        }
    }

    private func contactField(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.tsMutedInk)
                .frame(width: 62, alignment: .leading)
            Text(value)
                .font(.subheadline)
                .foregroundStyle(Color.tsInk)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

private extension DeviceContactHandoffResult {
    var isSaved: Bool {
        if case .saved = self { return true }
        return false
    }
}

private enum DeviceContactEditorCompletion {
    case saved(identifier: String)
    case cancelled
}

private struct DeviceContactEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    let draft: DeviceContactDraft
    let onComplete: (DeviceContactEditorCompletion) -> Void

    var body: some View {
        DeviceContactEditorController(draft: draft) { completion in
            onComplete(completion)
            dismiss()
        }
        .ignoresSafeArea()
        .interactiveDismissDisabled()
    }
}

private struct DeviceContactEditorController: UIViewControllerRepresentable {
    let draft: DeviceContactDraft
    let onComplete: (DeviceContactEditorCompletion) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onComplete: onComplete)
    }

    func makeUIViewController(context: Context) -> UINavigationController {
        let contact = draft.makeContact()
        let controller = CNContactViewController(forNewContact: contact)
        controller.delegate = context.coordinator
        controller.allowsActions = false
        let navigation = UINavigationController(rootViewController: controller)
        navigation.presentationController?.delegate = context.coordinator
        return navigation
    }

    func updateUIViewController(
        _ uiViewController: UINavigationController,
        context: Context
    ) {}

    final class Coordinator: NSObject, CNContactViewControllerDelegate,
        UIAdaptivePresentationControllerDelegate {
        private let onComplete: (DeviceContactEditorCompletion) -> Void
        private var completed = false

        init(onComplete: @escaping (DeviceContactEditorCompletion) -> Void) {
            self.onComplete = onComplete
        }

        func contactViewController(
            _ viewController: CNContactViewController,
            didCompleteWith contact: CNContact?
        ) {
            guard !completed else { return }
            completed = true
            if let contact, !contact.identifier.isEmpty {
                onComplete(.saved(identifier: contact.identifier))
            } else {
                onComplete(.cancelled)
            }
        }

        func presentationControllerDidDismiss(
            _ presentationController: UIPresentationController
        ) {
            guard !completed else { return }
            completed = true
            onComplete(.cancelled)
        }
    }
}

#Preview("Contact handoff") {
    ScrollView {
        DeviceContactHandoffView(
            draft: DeviceContactDraft(
                sourceID: "synthetic-capture",
                displayName: "Alex Chen",
                handleType: .wechat,
                handleValue: "alex_synthetic"
            ),
            relationshipLabel: "Staff Product Designer"
        )
        .padding()
    }
    .background(Color.tsSurface)
}
