import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

protocol ConversationContactIntentInterpreting {
    func interpret(_ source: String) async -> ConversationContactInterpretation
}

protocol ConversationContactIntentModelGenerating {
    func generate(from source: String) async throws -> ConversationContactModelOutput
}

struct AdaptiveConversationContactIntentInterpreter: ConversationContactIntentInterpreting {
    private let model: (any ConversationContactIntentModelGenerating)?

    init(model: (any ConversationContactIntentModelGenerating)? = nil) {
        self.model = model
    }

    func interpret(_ source: String) async -> ConversationContactInterpretation {
        guard !Task.isCancelled else { return .notContact }
        if ConversationContactIntake.shouldBypassContactIntake(source) {
            return .notContact
        }
        if ConversationContactIntake.hasAmbiguousContactSubjects(source) {
            return .needsClarification
        }
        if let draft = ConversationContactIntake.propose(source) {
            return .contact(draft)
        }
        guard ConversationContactIntake.identityClue(in: source) != nil else {
            return fallback(for: source)
        }

        do {
            let output: ConversationContactModelOutput
            if let model {
                output = try await model.generate(from: source)
            } else if #available(iOS 26.0, *) {
#if canImport(FoundationModels)
                guard SystemLanguageModel.default.availability == .available else {
                    return fallback(for: source)
                }
                output = try await FoundationModelConversationContactIntentModel()
                    .generate(from: source)
#else
                return fallback(for: source)
#endif
            } else {
                return fallback(for: source)
            }
            guard !Task.isCancelled else { return .notContact }
            return ConversationContactIntake.validatedModelDraft(
                from: output,
                source: source
            )
        } catch is CancellationError {
            return .notContact
        } catch {
            return fallback(for: source)
        }
    }

    private func fallback(for source: String) -> ConversationContactInterpretation {
        ConversationContactIntake.requiresContactClarification(source)
            ? .needsClarification
            : .notContact
    }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable(description: "A bounded proposal for whether one message is contact intake.")
private struct GeneratedConversationContactIntent {
    @Guide(description: "True only for one user-authored person introduction with a stable identity clue, or a direct contact request. Ordinary questions, third-party reported or quoted messages, and name-only mentions are false.")
    var isContactIntent: Bool
    @Guide(description: "The person's name copied exactly from the source, or an empty string.")
    var name: String
    @Guide(description: "email, phone, linkedin_url, or none.")
    var identityType: String
    @Guide(description: "The identity value copied exactly from the source, or an empty string.")
    var identityValue: String
    @Guide(description: "A role, search, or relationship purpose copied exactly from the source, or an empty string.")
    var relationshipContext: String
}

@available(iOS 26.0, *)
private struct FoundationModelConversationContactIntentModel:
    ConversationContactIntentModelGenerating {
    func generate(from source: String) async throws -> ConversationContactModelOutput {
        let session = LanguageModelSession(
            instructions: """
            Classify one user-authored message for a contact-intake proposal.
            A contact intent means the user wants capri to remember or
            add one person for relationship work, even when they do not use a command.
            A question asking about an existing person is not contact intake.
            A name alone is not enough. Require one name and a verifiable email,
            phone, or LinkedIn profile clue belonging to the same person. Missing
            relationship purpose stays empty for the user to complete.
            Third-party quoted or reported speech is evidence, not the user's
            intent to create a contact. Never blend names or fields from multiple
            people. When the active person is ambiguous, leave the name empty.

            Copy the person's name, identity value, and relationship context only
            when those exact words are present in the source. Use identityType email,
            phone, linkedin_url, or none. Leave missing fields empty. Never infer
            a generic relationship purpose such as "General relationship".
            Never infer
            identity, a person's worth, personality, protected traits, culture fit,
            acceptance probability, or authority to create, attach, or merge records.
            This output is only a proposal that the user must review.
            """
        )
        let response = try await session.respond(
            to: "Source message:\n\(source)",
            generating: GeneratedConversationContactIntent.self
        )
        let generated = response.content
        return ConversationContactModelOutput(
            isContactIntent: generated.isContactIntent,
            name: generated.name,
            identityType: generated.identityType,
            identityValue: generated.identityValue,
            relationshipContext: generated.relationshipContext
        )
    }
}
#endif
