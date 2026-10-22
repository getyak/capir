import Foundation

/// Saved and copied messages retain readable context, never live action authority.
enum AgentSessionContextPolicy {
    static func classifiedBlock(
        _ block: RelationshipAskResponse.Block,
        requireExistingShareClassification: Bool = false
    ) -> RelationshipAskResponse.Block {
        let allowsStaticShare = AgentSessionSharePolicy.isSafeAnswerBlock(block)
            && (!requireExistingShareClassification || block.allowsStaticShare == true)
        return .init(
            id: block.id,
            kind: block.kind,
            title: block.title,
            body: block.body,
            status: block.status,
            citationDependencyIDs: block.citationDependencyIDs,
            requiresUserDecision: block.requiresUserDecision,
            targetRef: block.targetRef,
            publicSources: block.publicSources,
            calendarDraft: block.calendarDraft,
            allowsStaticShare: allowsStaticShare
        )
    }

    static func classifiedResponse(
        _ response: RelationshipAskResponse,
        requireExistingShareClassification: Bool = false
    ) -> RelationshipAskResponse {
        .init(
            contractVersion: response.contractVersion,
            taskID: response.taskID,
            contextManifestID: response.contextManifestID,
            knowledgeSnapshotID: response.knowledgeSnapshotID,
            disposition: response.disposition,
            blocks: response.blocks.map {
                classifiedBlock(
                    $0,
                    requireExistingShareClassification: requireExistingShareClassification
                )
            },
            media: response.media,
            createdAt: response.createdAt,
            sessionTitle: response.sessionTitle,
            citations: response.citations,
            labFeatureReceipt: response.labFeatureReceipt,
            memoryProposal: response.memoryProposal
        )
    }

    static func readOnlyBlock(
        _ block: RelationshipAskResponse.Block,
        requireExistingShareClassification: Bool = false
    ) -> RelationshipAskResponse.Block {
        let classified = classifiedBlock(
            block,
            requireExistingShareClassification: requireExistingShareClassification
        )
        return .init(id: classified.id, kind: classified.kind, title: classified.title, body: classified.body, status: classified.status,
              citationDependencyIDs: [], requiresUserDecision: false, targetRef: nil,
              publicSources: classified.publicSources, allowsStaticShare: classified.allowsStaticShare)
    }

    static func readOnlyResponse(_ response: RelationshipAskResponse) -> RelationshipAskResponse {
        .init(contractVersion: response.contractVersion, taskID: response.taskID,
              contextManifestID: response.contextManifestID, knowledgeSnapshotID: response.knowledgeSnapshotID,
              disposition: response.disposition, blocks: response.blocks.map { readOnlyBlock($0) }, media: [],
              createdAt: response.createdAt, sessionTitle: response.sessionTitle, citations: [])
    }

    static func exportMarkdown(_ session: AgentSession, language: AppLanguage) -> String {
        var lines = ["# \(session.displayTitle(in: language))", ""]
        if session.originSessionID != nil {
            lines += [language.text("Copied conversation context; sources need refresh."), ""]
        }
        struct Entry {
            let date: Date
            let order: Int
            let text: [String]
        }
        let turns = session.turns.enumerated().map { index, turn in
            var text = ["## \(language.text("You"))", "", turn.objective, "",
                        "## \(language.text("Agent"))", ""]
            text += turn.response.blocks.flatMap { [$0.title, "", $0.body, ""] }
            if turn.requiresRefresh {
                text += [language.text("Saved context — verify current sources before acting."), ""]
            }
            return Entry(date: turn.createdAt, order: index, text: text)
        }
        let receipts = session.contactReceipts.enumerated().map { index, receipt in
            let label: String
            switch receipt.outcome {
            case .createdPerson: label = language.text("Contact created")
            case .matchedExisting: label = language.text("Contact updated")
            case .identityReview: label = language.text("Identity needs review")
            }
            return Entry(date: receipt.createdAt, order: session.turns.count + index,
                         text: ["## \(label)", "", receipt.personDisplayLabel, ""])
        }
        lines += (turns + receipts).sorted {
            $0.date == $1.date ? $0.order < $1.order : $0.date < $1.date
        }.flatMap(\.text)
        if let pending = session.pendingObjective {
            lines += ["## \(language.text("Waiting to continue"))", "", pending, ""]
        }
        return lines.joined(separator: "\n")
    }
}

/// The two copies a recruiter may deliberately export from a Session.
///
/// The default is always the bounded summary card. The readable conversation
/// requires an explicit second choice and is never offered for identity-review
/// Sessions.
enum AgentSessionShareScope: String, CaseIterable, Identifiable, Equatable {
    case summary
    case conversation

    var id: String { rawValue }
}

/// A static, bounded copy of a Session built only from safe saved answers.
///
/// It carries no pending objective, no contact execution metadata, no action or
/// target block, no citation/media, and no identifier or authority. Generated
/// copies can never continue a conversation or trigger an external write.
struct AgentSessionShareSnapshot: Equatable {
    let scope: AgentSessionShareScope
    let title: String
    let contextLabel: String
    let excerpt: String
    let updatedLabel: String
    let statusLabel: String
    let conversationLines: [AgentSessionShareConversationLine]
    let conversationWasTruncated: Bool

    var isSummary: Bool { scope == .summary }
}

struct AgentSessionShareConversationLine: Equatable, Identifiable {
    let id: String
    let isObjective: Bool
    let text: String
}

/// Pure snapshot and export policy for the GET-27 Session sharing slice.
///
/// It sits beside `AgentSessionContextPolicy` so a shared artifact can never
/// promote interpretation to authority, widen candidate-data exposure, or lose
/// the boundary that nothing here mutates Session state.
enum AgentSessionSharePolicy {
    /// Bounded visible excerpt so a card cannot silently carry a whole answer.
    static let excerptLimit = 280
    static let titleLimit = 30
    static let conversationLineLimit = 12
    static let conversationCharacterLimit = 4_000

    /// Kinds that may appear in a shared copy. Anything projected as a live
    /// action, proposal, processing state, or research result is excluded.
    static let safeBlockKind = "answer"
    static let safeBlockStatuses: Set<String> = ["informational", "ready"]

    /// The only block shape that may be copied: a completed informational
    /// answer that asks for no decision and points at no external target.
    static func isSafeAnswerBlock(
        _ block: RelationshipAskResponse.Block,
        requiresPersistedClassification: Bool = false
    ) -> Bool {
        block.kind == safeBlockKind
            && safeBlockStatuses.contains(block.status)
            && !block.requiresUserDecision
            && block.targetRef == nil
            && block.calendarDraft == nil
            && block.allowsStaticShare != false
            && (!requiresPersistedClassification || block.allowsStaticShare == true)
    }

    /// Identity review never discloses the person label and never offers the
    /// readable conversation, even after an explicit choice.
    static func allowsConversation(_ session: AgentSession) -> Bool {
        !session.isIdentityReview
    }

    static func isShareable(_ session: AgentSession) -> Bool {
        latestSafeAnswer(in: session) != nil
    }

    static func availability(
        for session: AgentSession,
        scope: AgentSessionShareScope,
        language: AppLanguage
    ) -> AgentSessionShareAvailability {
        guard isShareable(session) else {
            return .unavailable(
                language.text("This Session has no saved answer to share yet.")
            )
        }
        if scope == .conversation, !allowsConversation(session) {
            return .unavailable(
                language.text("Identity-review Sessions cannot share the conversation.")
            )
        }
        return .available(snapshot(for: session, scope: scope, language: language))
    }

    static func snapshot(
        for session: AgentSession,
        scope: AgentSessionShareScope,
        language: AppLanguage
    ) -> AgentSessionShareSnapshot {
        let title = safeTitle(for: session, language: language)
        let contextLabel = safeContextLabel(for: session, language: language)
        let safeAnswer = latestSafeAnswer(in: session)
        let answer = session.isIdentityReview
            ? language.text("Identity is still unresolved. Conversation details are not included.")
            : safeAnswer?.body ?? ""
        let conversation = scope == .conversation
            ? boundedConversation(
                for: session,
                title: title,
                contextLabel: contextLabel,
                language: language
            )
            : (
                lines: [],
                wasTruncated: false,
                updatedLabel: updatedLabel(
                    for: safeAnswer?.createdAt ?? session.updatedAt,
                    language: language
                ),
                statusLabel: statusLabel(
                    for: session,
                    needsRefresh: safeAnswer?.requiresRefresh ?? false,
                    language: language
                )
            )
        return AgentSessionShareSnapshot(
            scope: scope,
            title: title,
            contextLabel: contextLabel,
            excerpt: cardExcerpt(answer),
            updatedLabel: conversation.updatedLabel,
            statusLabel: conversation.statusLabel,
            conversationLines: conversation.lines,
            conversationWasTruncated: conversation.wasTruncated
        )
    }

    /// Plain-text alternate description handed to the system share sheet
    /// alongside the rendered card image.
    static func alternateText(
        _ snapshot: AgentSessionShareSnapshot,
        language: AppLanguage
    ) -> String {
        var lines = [snapshot.title, snapshot.contextLabel, ""]
        if snapshot.isSummary {
            lines += [
                language.text("Static copy — sources, pending decisions, and action authority are omitted."),
                "",
                snapshot.excerpt,
                "",
                "\(snapshot.updatedLabel) · \(snapshot.statusLabel)"
            ]
        } else {
            return conversationAlternateText(
                title: snapshot.title,
                contextLabel: snapshot.contextLabel,
                conversationLines: snapshot.conversationLines,
                conversationWasTruncated: snapshot.conversationWasTruncated,
                updatedLabel: snapshot.updatedLabel,
                statusLabel: snapshot.statusLabel,
                language: language
            )
        }
        return lines.joined(separator: "\n")
    }

    private static func conversationAlternateText(
        title: String,
        contextLabel: String,
        conversationLines: [AgentSessionShareConversationLine],
        conversationWasTruncated: Bool,
        updatedLabel: String,
        statusLabel: String,
        language: AppLanguage
    ) -> String {
        var lines = [
            title,
            contextLabel,
            "",
            language.text("Static copy — sources, pending decisions, and action authority are omitted."),
            "",
        ]
        lines += conversationLines.map { line in
            line.isObjective
                ? "\(language.text("You")): \(line.text)"
                : "\(language.text("Agent")): \(line.text)"
        }
        if conversationWasTruncated {
            lines += ["", conversationLimitLabel(language: language)]
        }
        lines += ["", updatedLabel, statusLabel]
        return lines.joined(separator: "\n")
    }

    static func boundedExcerpt(_ body: String) -> String {
        let collapsed = body
            .replacingOccurrences(of: "\r\n", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard collapsed.count > excerptLimit else { return collapsed }
        let end = collapsed.index(collapsed.startIndex, offsetBy: excerptLimit)
        return String(collapsed[..<end]).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }

    /// Turn structured Markdown into a glanceable card sentence without
    /// copying tables or code. The readable-conversation option retains the
    /// original safe answer for people who explicitly choose it.
    static func cardExcerpt(_ body: String) -> String {
        var isInsideCodeFence = false
        var lines: [String] = []
        for rawLine in body.components(separatedBy: .newlines) {
            var line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.hasPrefix("```") {
                isInsideCodeFence.toggle()
                continue
            }
            guard !isInsideCodeFence, !line.isEmpty, !line.contains("|") else {
                continue
            }
            while line.hasPrefix("#") {
                line.removeFirst()
                line = line.trimmingCharacters(in: .whitespaces)
            }
            for prefix in ["- [x] ", "- [X] ", "- [ ] ", "- ", "* ", "+ "]
            where line.hasPrefix(prefix) {
                line.removeFirst(prefix.count)
                break
            }
            guard !line.isEmpty else { continue }
            lines.append(line)
            if lines.count == 3 { break }
        }
        return boundedExcerpt(lines.joined(separator: " · "))
    }

    static func conversationLimitLabel(language: AppLanguage) -> String {
        String(
            format: language.text("Export limited to the first %d safe messages and %d characters."),
            locale: language.locale,
            conversationLineLimit,
            conversationCharacterLimit
        )
    }

    /// Chronological user objectives plus only safe answer bodies, bounded so
    /// the complete exported scope can be inspected in the review sheet.
    private static func boundedConversation(
        for session: AgentSession,
        title: String,
        contextLabel: String,
        language: AppLanguage
    ) -> (
        lines: [AgentSessionShareConversationLine],
        wasTruncated: Bool,
        updatedLabel: String,
        statusLabel: String
    ) {
        struct DatedLine {
            let line: AgentSessionShareConversationLine
            let createdAt: Date
            let requiresRefresh: Bool
        }
        var candidates: [DatedLine] = []
        for (index, turn) in chronologicalTurns(session).enumerated() {
            let safeBlocks = turn.response.blocks.filter {
                isSafeAnswerBlock(
                    $0,
                    requiresPersistedClassification: turn.requiresRefresh
                )
            }
            guard !safeBlocks.isEmpty else { continue }
            let objective = turn.objective.trimmingCharacters(in: .whitespacesAndNewlines)
            if !objective.isEmpty {
                candidates.append(.init(
                    line: .init(id: "objective-\(index)", isObjective: true, text: objective),
                    createdAt: turn.createdAt,
                    requiresRefresh: turn.requiresRefresh
                ))
            }
            for (blockIndex, block) in safeBlocks.enumerated() {
                let body = block.body.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !body.isEmpty else { continue }
                candidates.append(.init(
                    line: .init(
                        id: "answer-\(index)-\(blockIndex)",
                        isObjective: false,
                        text: body
                    ),
                    createdAt: turn.createdAt,
                    requiresRefresh: turn.requiresRefresh
                ))
            }
        }

        var lines = Array(candidates.prefix(conversationLineLimit))
        var wasTruncated = candidates.count > lines.count
        if wasTruncated, lines.last?.line.isObjective == true {
            lines.removeLast()
        }

        func includedUpdatedLabel(_ candidateLines: [DatedLine]) -> String {
            updatedLabel(
                for: candidateLines.last?.createdAt
                    ?? latestSafeAnswer(in: session)?.createdAt
                    ?? session.updatedAt,
                language: language
            )
        }

        func export(_ candidateLines: [DatedLine], truncated: Bool) -> String {
            conversationAlternateText(
                title: title,
                contextLabel: contextLabel,
                conversationLines: candidateLines.map(\.line),
                conversationWasTruncated: truncated,
                updatedLabel: includedUpdatedLabel(candidateLines),
                statusLabel: statusLabel(
                    for: session,
                    needsRefresh: candidateLines.contains(where: \.requiresRefresh),
                    language: language
                ),
                language: language
            )
        }

        var exportedText = export(lines, truncated: wasTruncated)
        while exportedText.count > conversationCharacterLimit,
              let longestIndex = lines.indices.max(by: {
                  lines[$0].line.text.count < lines[$1].line.text.count
            }) {
            wasTruncated = true
            let longest = lines[longestIndex]
            let excess = exportedText.count - conversationCharacterLimit
            if longest.line.text.count > 1 {
                let prefixCount = max(0, longest.line.text.count - excess - 1)
                lines[longestIndex] = .init(
                    line: .init(
                        id: longest.line.id,
                        isObjective: longest.line.isObjective,
                        text: String(longest.line.text.prefix(prefixCount))
                            .trimmingCharacters(in: .whitespacesAndNewlines) + "…"
                    ),
                    createdAt: longest.createdAt,
                    requiresRefresh: longest.requiresRefresh
                )
            } else {
                // The fixed envelope plus twelve one-character lines is well
                // below the cap. This fallback only protects future copy from
                // turning an unexpected localization expansion into a loop.
                lines.removeLast()
            }
            exportedText = export(lines, truncated: true)
        }
        return (
            lines.map(\.line),
            wasTruncated,
            includedUpdatedLabel(lines),
            statusLabel(
                for: session,
                needsRefresh: lines.contains(where: \.requiresRefresh),
                language: language
            )
        )
    }

    /// Latest saved answer the user can safely stand behind.
    private struct SafeAnswer {
        let body: String
        let createdAt: Date
        let requiresRefresh: Bool
    }

    private static func latestSafeAnswer(in session: AgentSession) -> SafeAnswer? {
        for turn in chronologicalTurns(session).reversed() {
            let safeBodies = turn.response.blocks
                .filter {
                    isSafeAnswerBlock(
                        $0,
                        requiresPersistedClassification: turn.requiresRefresh
                    )
                }
                .map(\.body)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            if let body = safeBodies.last {
                return .init(
                    body: body,
                    createdAt: turn.createdAt,
                    requiresRefresh: turn.requiresRefresh
                )
            }
        }
        return nil
    }

    private static func chronologicalTurns(_ session: AgentSession) -> [AgentSessionTurn] {
        session.turns.enumerated().sorted { lhs, rhs in
            lhs.element.createdAt == rhs.element.createdAt
                ? lhs.offset < rhs.offset
                : lhs.element.createdAt < rhs.element.createdAt
        }.map(\.element)
    }

    private static func safeTitle(for session: AgentSession, language: AppLanguage) -> String {
        if session.isIdentityReview {
            return language.text("Identity review session")
        }
        let trimmed = session.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = trimmed.isEmpty
            ? language.text("Session")
            : trimmed
        return boundedTitle(title)
    }

    static func boundedTitle(_ title: String) -> String {
        guard title.count > titleLimit else { return title }
        let end = title.index(title.startIndex, offsetBy: titleLimit)
        return String(title[..<end]).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }

    private static func safeContextLabel(for session: AgentSession, language: AppLanguage) -> String {
        if session.isIdentityReview {
            return language.text("Identity review")
        }
        if case .relationship = session.scope {
            return "\(session.personDisplayLabel) · \(session.displayContextLabel(in: language))"
        }
        return language.text("Agent Session")
    }

    private static func updatedLabel(for date: Date, language: AppLanguage) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjm")
        return String(
            format: language.text("Updated %@"),
            locale: language.locale,
            formatter.string(from: date)
        )
    }

    private static func statusLabel(
        for session: AgentSession,
        needsRefresh: Bool,
        language: AppLanguage
    ) -> String {
        if session.originSessionID != nil, needsRefresh {
            return language.text("Forked copy · sources may need refresh")
        }
        if needsRefresh {
            return language.text("Saved copy · sources may need refresh")
        }
        if session.originSessionID != nil {
            return language.text("Forked copy")
        }
        return language.text("Saved copy")
    }
}

enum AgentSessionShareAvailability: Equatable {
    case available(AgentSessionShareSnapshot)
    case unavailable(String)

    var snapshot: AgentSessionShareSnapshot? {
        if case let .available(snapshot) = self { return snapshot }
        return nil
    }

    var unavailableReason: String? {
        if case let .unavailable(reason) = self { return reason }
        return nil
    }
}
