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
    let observationExpiresAt: Date?

    private static let observationLifetime: TimeInterval = 65
    private static let futureObservationTolerance: TimeInterval = 5

    static func derive(pending: PendingImageConversation, isSending: Bool, isChecking: Bool,
        entry: ConversationImageQueueEntry? = nil, paused: Bool = false, observedAt: Date? = nil,
        observedStage: ConversationImageRunStage? = nil, now: Date = Date()) -> Self {
        func state(_ phase: Phase, _ text: String, activity: Bool = false,
            elapsed: Date? = nil, check: Bool = false, expiresAt: Date? = nil) -> Self {
            Self(messageID: pending.messageID, phase: phase, textKey: text,
                elapsedSince: elapsed.flatMap { $0 <= now ? $0 : nil }, showsActivity: activity,
                canCheck: check, observationExpiresAt: expiresAt)
        }

        // An unbound or old observation is never evidence that this message is
        // processing. Stream connections last at most 60s and require renewal.
        let matches = entry.map { candidate in
            candidate.messageID == pending.messageID && candidate.images == pending.images
                && (pending.queueEntryID == nil || pending.queueEntryID == candidate.queueEntryID)
        } ?? true
        let fresh = observedAt.map { now.timeIntervalSince($0) >= -Self.futureObservationTolerance
            && now.timeIntervalSince($0) <= Self.observationLifetime } ?? false
        let expiresAt = observedAt?.addingTimeInterval(Self.observationLifetime)
        if pending.state == .stopped, entry?.queueStatus.isTerminal != true {
            return state(.stopped, "Processing stopped", check: true)
        }
        if let entry, matches, fresh {
            switch entry.queueStatus {
            case .queued:
                return paused ? state(.paused, "Processing is paused", expiresAt: expiresAt)
                    : state(.queued, "Queued for processing", activity: true, expiresAt: expiresAt)
            case .running:
                if entry.cancelRequested { return state(.stopping, "Stopping processing…", activity: true, expiresAt: expiresAt) }
                return state(.running, stageText(observedStage ?? entry.progressStage), activity: true,
                    elapsed: entry.startedAt, expiresAt: expiresAt)
            case .completed:
                // Queue completion does not establish that this Session has
                // its canonical reply. A failed/finished check stays recoverable
                // until that reply actually removes the protected pending row.
                return isChecking ? state(.readback, "Reading the saved reply…", activity: true)
                    : state(.unknown, "Reply status needs checking", check: true)
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
            if isChecking { return state(.checking, "Checking the original message…", activity: true) }
            return isSending ? state(.sending, "Sending your message…", activity: true)
                : state(.prepared, "Message is ready to send", check: true)
        case .admitted:
            return isChecking ? state(.waiting, "Message received. Waiting for reply status…", activity: true)
                : state(.unknown, "Message received. Check the reply status.", check: true)
        case .unknown:
            return isChecking ? state(.checking, "Checking the original message…", activity: true)
                : isSending ? state(.sending, "Sending your message…", activity: true)
                : state(.unknown, "Delivery is unconfirmed. Check before sending again.", check: true)
        case .stopped:
            return state(.stopped, "Processing stopped", check: true)
        }
    }

    /// Recheck a message-bound observation as time passes, even when no store
    /// event follows a failed request. Local sends and terminal readback are
    /// unaffected; this only retires the live processing claim.
    func presentation(at date: Date) -> Self {
        guard let observationExpiresAt else { return self }
        let validFrom = observationExpiresAt.addingTimeInterval(
            -Self.observationLifetime - Self.futureObservationTolerance)
        guard date >= validFrom, date <= observationExpiresAt else {
            return Self(messageID: messageID, phase: .unknown, textKey: "Reply status needs checking",
                elapsedSince: nil, showsActivity: false, canCheck: true, observationExpiresAt: nil)
        }
        return self
    }

    var requiresTimeline: Bool {
        observationExpiresAt != nil || (showsActivity && elapsedSince != nil)
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
            if state.requiresTimeline {
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
        let presentation = state.presentation(at: date)
        return HStack(alignment: .center, spacing: 8) {
            if presentation.showsActivity {
                ProgressView().controlSize(.mini)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(language.text(presentation.textKey))
                    .fixedSize(horizontal: false, vertical: true)
                if let elapsed = presentation.elapsedText(at: date) {
                    Text(verbatim: language.text("Elapsed") + " " + elapsed)
                        .monospacedDigit()
                        .foregroundStyle(Color.tsMutedInk)
                }
            }
            .font(.footnote)
            .foregroundStyle(Color.tsMutedInk)
            .frame(maxWidth: .infinity, alignment: .leading)
            if presentation.canCheck {
                Button(action: onCheck) {
                    Text(language.text("Check status"))
                        .font(.footnote.weight(.medium))
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityHint(language.text("Check the same message without sending it again"))
            }
        }
        .accessibilityElement(children: .contain)
    }
}
