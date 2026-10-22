import Foundation
import SwiftUI

/// Ephemeral presentation for the protected message. It never changes delivery
/// identity, persists an outcome, or authorizes a retry/admission.
struct ConversationImageProgressState: Equatable {
    enum Phase: Equatable {
        case prepared, sending, checking, waiting, queued, paused, running, stopping, readback, unknown, failed, stopped
    }

    let messageID: UUID
    let phase: Phase
    let textKey: String
    let elapsedSince: Date?
    let showsActivity: Bool
    let canCheck: Bool

    static func derive(pending: PendingImageConversation, isSending: Bool, isChecking: Bool,
        entry: ConversationImageQueueEntry? = nil, paused: Bool = false, observedAt: Date? = nil,
        observedStage: ConversationImageRunStage? = nil, now: Date = Date()) -> Self {
        func state(_ phase: Phase, _ text: String, activity: Bool = false,
            elapsed: Date? = nil, check: Bool = false) -> Self {
            Self(messageID: pending.messageID, phase: phase, textKey: text,
                elapsedSince: elapsed.flatMap { $0 <= now ? $0 : nil }, showsActivity: activity, canCheck: check)
        }

        // An unbound or old observation is never evidence that this message is
        // processing. Stream connections last at most 60s and require renewal.
        let matches = entry.map { candidate in
            candidate.messageID == pending.messageID && candidate.images == pending.images
                && (pending.queueEntryID == nil || pending.queueEntryID == candidate.queueEntryID)
        } ?? true
        let fresh = observedAt.map { now.timeIntervalSince($0) >= -5 && now.timeIntervalSince($0) <= 65 } ?? false
        if pending.state == .stopped, entry?.queueStatus.isTerminal != true {
            return state(.stopped, "Processing stopped", check: true)
        }
        if let entry, matches, fresh {
            switch entry.queueStatus {
            case .queued:
                return paused ? state(.paused, "Processing is paused")
                    : state(.queued, "Queued for processing", activity: true)
            case .running:
                if entry.cancelRequested { return state(.stopping, "Stopping processing…", activity: true) }
                return state(.running, stageText(observedStage ?? entry.progressStage), activity: true, elapsed: entry.startedAt)
            case .completed:
                return state(.readback, "Reading the saved reply…", activity: isChecking)
            case .failed, .interrupted:
                return state(.failed, entry.failureCode == "MODEL_RUN_TIMEOUT"
                    ? "Processing timed out. Check the original message." : "Processing did not finish. Check its status.", check: true)
            case .cancelled:
                return state(.stopped, "Processing stopped", check: true)
            }
        }
        if !matches { return state(.unknown, "Reply status could not be verified", check: true) }
        // A previously observed running row is no longer live evidence when the
        // feed is stale. Never leave it animating indefinitely after reopening.
        if entry != nil && !fresh { return state(.unknown, "Reply status needs checking", check: true) }
        switch pending.state {
        case .prepared:
            return isSending ? state(.sending, "Sending your message…", activity: true)
                : state(.prepared, "Message is ready to send", check: true)
        case .admitted:
            return isChecking ? state(.waiting, "Message received. Waiting for reply status…", activity: true)
                : state(.unknown, "Message received. Check the reply status.", check: true)
        case .unknown:
            return isChecking ? state(.checking, "Checking the original message…", activity: true)
                : state(.unknown, "Delivery is unconfirmed. Check before sending again.", check: true)
        case .stopped:
            return state(.stopped, "Processing stopped", check: true)
        }
    }

    private static func stageText(_ stage: ConversationImageRunStage?) -> String {
        switch stage {
        case .queued: return "Waiting to start"
        case .preparing: return "Preparing a reply…"
        case .contactLookup: return "Looking up relevant people…"
        case .contactRead: return "Reading relevant records…"
        case .calendarDraft: return "Preparing a calendar draft…"
        case .answer, .responding: return "Writing a reply…"
        case .persisting: return "Saving the reply…"
        case .thinking, .running, nil: return "Processing your message…"
        }
    }

    func elapsedText(at date: Date) -> String? {
        guard let elapsedSince else { return nil }
        let seconds = Int(max(0, date.timeIntervalSince(elapsedSince)))
        guard seconds >= 10 else { return nil }
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

/// One quiet line below the originating message, with one recovery action.
/// This component intentionally has no card, synthetic steps or percentages.
struct ConversationImageProgressView: View {
    let state: ConversationImageProgressState
    let language: AppLanguage
    let onCheck: () -> Void

    var body: some View {
        Group {
            if state.showsActivity, state.elapsedSince != nil {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    statusLine(at: context.date)
                }
            } else {
                statusLine(at: Date())
            }
        }
        .accessibilityIdentifier("conversation-image-progress-\(state.messageID.uuidString.lowercased())")
    }

    private func statusLine(at date: Date) -> some View {
        HStack(alignment: .center, spacing: 8) {
            if state.showsActivity {
                ProgressView().controlSize(.mini)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(language.text(state.textKey))
                    .fixedSize(horizontal: false, vertical: true)
                if let elapsed = state.elapsedText(at: date) {
                    Text(verbatim: language.text("Elapsed") + " " + elapsed)
                        .monospacedDigit()
                        .foregroundStyle(Color.tsMutedInk)
                }
            }
            .font(.footnote)
            .foregroundStyle(Color.tsMutedInk)
            .frame(maxWidth: .infinity, alignment: .leading)
            if state.canCheck {
                Button(language.text("Check status"), action: onCheck)
                    .font(.footnote.weight(.medium))
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityHint(language.text("Check the same message without sending it again"))
            }
        }
        .accessibilityElement(children: .contain)
    }
}
