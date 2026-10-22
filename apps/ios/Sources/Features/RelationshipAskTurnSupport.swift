import SwiftUI

struct AskPendingMediaStrip: View {
    let drafts: [AskMediaDraft]
    let language: AppLanguage

    private var visibleDrafts: [AskMediaDraft] { Array(drafts.prefix(3)) }

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(visibleDrafts.enumerated()), id: \.element.id) { index, draft in
                Image(uiImage: draft.preview)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 58, height: 58)
                    .clipShape(RoundedRectangle(cornerRadius: 13))
                    .overlay {
                        if index == 2, drafts.count > 3 {
                            RoundedRectangle(cornerRadius: 13)
                                .fill(Color.black.opacity(0.48))
                            Text(verbatim: "+\(drafts.count - 3)")
                                .font(.headline)
                                .foregroundStyle(.white)
                        }
                    }
            }
        }
        .padding(3)
        .background(Color.tsCanvas, in: RoundedRectangle(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.tsLine, lineWidth: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            String(drafts.count) + " · "
                + language.text("Task images, not evidence")
        )
        .accessibilityIdentifier("ask-pending-media")
    }
}


struct AskUserMessageBubble: View {
    let message: String
    var accessibilityIdentifier = "ask-user-message"

    var body: some View {
        ViewThatFits(in: .horizontal) {
            bubble(fixesWidth: true)
            bubble(fixesWidth: false)
                .frame(maxWidth: 330, alignment: .trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(message)
        .accessibilityIdentifier(accessibilityIdentifier)
    }

    private func bubble(fixesWidth: Bool) -> some View {
        Text(message)
            .font(.body)
            .foregroundStyle(Color.tsInk)
            .fixedSize(horizontal: fixesWidth, vertical: true)
            .padding(.horizontal, 15)
            .padding(.vertical, 11)
            .background(
                Color.tsSurfaceMuted,
                in: RoundedRectangle(cornerRadius: 17, style: .continuous)
            )
    }
}


struct AskPendingTurnView: View {
    let message: String
    let mediaDrafts: [AskMediaDraft]
    let language: AppLanguage
    let recallPhase: RelationshipRecallPhase
    let onChooseCandidate: (AgentRelationshipRecallCandidate) -> Void
    let onChangeMatch: () -> Void
    let onContinueWithoutRelationship: () -> Void
    @State private var recallQuery = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .trailing, spacing: 7) {
                if !mediaDrafts.isEmpty {
                    AskPendingMediaStrip(
                        drafts: mediaDrafts,
                        language: language
                    )
                }
                AskUserMessageBubble(message: message)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)

            recallContent
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-pending-turn")
    }

    @ViewBuilder
    private var recallContent: some View {
        switch recallPhase {
        case .idle:
            EmptyView()
        case let .reading(candidate):
            if let candidate { matchedReceipt(candidate, allowsChange: true) }
            activityRow(
                language.text("Reading the current record…")
            )
            .accessibilityIdentifier("ask-loading")
        case .replyingWithoutRelationship:
            activityRow(
                language.text(
                    "Replying without opening a relationship…"
                )
            )
            .accessibilityIdentifier("ask-unscoped-loading")
        case let .ambiguous(candidates, possibleDuplicate):
            candidateDecision(
                candidates: candidates,
                possibleDuplicate: possibleDuplicate,
                isFallback: false
            )
        case let .unresolved(recent):
            candidateDecision(
                candidates: recent,
                possibleDuplicate: false,
                isFallback: true
            )
        }
    }

    private func activityRow(_ label: String) -> some View {
        HStack(spacing: 9) {
            ProgressView()
                .controlSize(.small)
                .tint(Color.tsVermilion)
                .accessibilityHidden(true)
            Text(label)
                .font(.subheadline)
                .foregroundStyle(Color.tsMutedInk)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    private func matchedReceipt(
        _ candidate: AgentRelationshipRecallCandidate,
        allowsChange: Bool
    ) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: "checkmark")
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.tsInk)
                .frame(width: 34, height: 34)
                .background(Color.tsCanvas, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(
                    verbatim: "\(candidate.person.displayLabel) · \(candidate.context.displayLabel)"
                )
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.tsInk)
                Text(
                    language.text("Matched by Agent from your contact workspace")
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
                if allowsChange {
                    Button(language.text("Change")) {
                        onChangeMatch()
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.tsInk)
                    .frame(minHeight: 44, alignment: .leading)
                    .accessibilityIdentifier("ask-recall-change")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ask-recall-match")
    }

    private func candidateDecision(
        candidates: [AgentRelationshipRecallCandidate],
        possibleDuplicate: Bool,
        isFallback: Bool
    ) -> some View {
        let visibleCandidates = recallCandidates(
            from: candidates,
            isFallback: isFallback
        )
        return VStack(alignment: .leading, spacing: 10) {
            Text(
                language.text(
                    possibleDuplicate
                        ? "I found records that may represent the same person."
                        : isFallback
                            ? "I need one detail to find the right relationship."
                            : "I found more than one possible relationship."
                )
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.tsInk)

            if possibleDuplicate {
                Text(
                    language.text(
                        "Choosing below only sets this Session’s working context. Merging requires a separate evidence review."
                    )
                )
                .font(.caption)
                .foregroundStyle(Color.tsMutedInk)
            }

            if isFallback, candidates.count > 6 {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(Color.tsMutedInk)
                        .accessibilityHidden(true)
                    TextField(
                        language.text("Search people or relationships"),
                        text: $recallQuery
                    )
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("ask-recall-search")
                }
                .frame(minHeight: 44)
            }

            if visibleCandidates.isEmpty {
                Text(language.text("No matching relationships"))
                    .font(.caption)
                    .foregroundStyle(Color.tsMutedInk)
                    .accessibilityIdentifier("ask-recall-no-results")
            }

            ForEach(visibleCandidates) { candidate in
                Button {
                    onChooseCandidate(candidate)
                } label: {
                    HStack(alignment: .center, spacing: 10) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(candidate.person.displayLabel)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.tsInk)
                            Text(candidate.context.displayLabel)
                                .font(.caption)
                                .foregroundStyle(Color.tsMutedInk)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.tsMutedInk)
                    }
                    .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) {
                    Divider().foregroundStyle(Color.tsLine)
                }
                .accessibilityIdentifier("ask-recall-candidate-\(candidate.id)")
            }

            if isFallback, mediaDrafts.isEmpty {
                Button(action: onContinueWithoutRelationship) {
                    Text(
                        language.text(
                            "Continue without a relationship"
                        )
                    )
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.tsInk)
                .accessibilityHint(
                    language.text(
                        "Replies without reading candidate or relationship evidence"
                    )
                )
                .accessibilityIdentifier("ask-continue-unscoped")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(
            possibleDuplicate
                ? "ask-recall-possible-duplicate"
                : isFallback
                    ? "ask-recall-unresolved"
                    : "ask-recall-ambiguous"
        )
    }

    private func recallCandidates(
        from candidates: [AgentRelationshipRecallCandidate],
        isFallback: Bool
    ) -> [AgentRelationshipRecallCandidate] {
        guard isFallback else { return candidates }
        let normalizedQuery = recallQuery.trimmingCharacters(
            in: .whitespacesAndNewlines
        ).folding(
            options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
            locale: language.locale
        )
        guard !normalizedQuery.isEmpty else {
            return Array(candidates.prefix(6))
        }
        return candidates.filter { candidate in
            "\(candidate.person.displayLabel) \(candidate.context.displayLabel)"
                .folding(
                    options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
                    locale: language.locale
                )
                .contains(normalizedQuery)
        }
    }
}

