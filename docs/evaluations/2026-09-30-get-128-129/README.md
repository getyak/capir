# GET-128 / GET-129 — macOS conversation delivery evaluation

Date: 2026-09-30
Plan: [`plans/2026-09-30-get-128-129-macos-conversation.md`](../../../plans/2026-09-30-get-128-129-macos-conversation.md)
Scope: production conversation surface, desktop shell composition, focused
tests, canonical design notes. No backend change was required.

## Outcome

The resident Web workspace used by macOS now renders the referenced desktop
conversation composition (248px/64px sidebar, 40px one-line Session rows,
68px floating Session title, 880px shared reading/composer axis) and a quiet
IM-style Agent execution surface. Execution is presented from the existing
durable conversation queue and canonical Session history only: real observed
stage events, a collapsible execution record with elapsed observed time, and a
final semantic result that appears only after persisted terminal readback.

## Chosen semantic model

1. **Run states are projected, never inferred.** `apps/web/lib/conversation-execution.ts`
   maps the observed queue entry and history readback to one phase:
   `queued`, `running`, `stopping`, `waiting-review`, `completed`, `failed`,
   `interrupted`. A completed phase is only claimed after canonical history
   readback; an entry alone never proves completion. A completed run with an
   unresolved memory or calendar decision is `waiting-review`, so a pending
   decision can never read as finished execution.
2. **Milestone-only dialogue updates are separate from the result.** While a
   run forms output, the transcript shows short ephemeral update bubbles built
   from the run's real visible text (sentence/line units, bounded, most recent
   only) plus a neutral observed-stage stand-in while silence holds. Nothing in
   this stream is persisted or authoritative; it is replaced wholesale by the
   persisted semantic result at terminal readback. Stage entries are labelled
   "observed", so no list implies that an earlier phase succeeded.
3. **The execution record is folded and in place.** One collapsible record per
   run (and one collapsed record above each readback turn) reports state,
   elapsed observed time and observed stage times. Elapsed time comes only from
   observed timestamps (admission → terminal readback) and is pinned at the
   terminal moment; there is no percentage because total work is unknown.
4. **The final result stands alone.** Semantic blocks (title/lead, Markdown
   body with code, lists and tables intact, provenance line) render outside the
   execution record. Memory and calendar decisions render as their own review
   blocks after the result.
5. **Pace, fence, and keep silence valid.** Forming text paints at most once
   per 600ms (500–1000ms budget) while terminal states and errors commit
   immediately. Snapshot/preview frames fence session identity, run identity
   and revision order; a stale or out-of-order frame can never repaint. Empty
   assistant content renders as valid silence with no fabricated placeholder.

## Coverage — GET-128 (behavioral)

| Requirement | Where | Evidence |
| --- | --- | --- |
| Existing `useConversation`/SSE/durable queue stay authority; no SDK/transport change | unchanged queue hook and stream | diff contains no transport change |
| Stable message/run IDs, real stage events, true terminal readback | projection keyed by `message_id`/`run_id`; stages from stream; result from history | `session-message-parts.test.tsx`, `conversation-execution.test.ts` |
| No manufactured tool successes or inferred phase success | neutral observed-stage milestones | `conversation-execution.test.ts` (`conversationObservedMilestone`) |
| In-place collapsible execution card, real states, elapsed time, no unknown-total percentage | `session-execution-card.tsx` | `session-execution-card.test.tsx`, render assertions in `queued-conversation-transcript.test.ts` |
| Milestone-only short dialogue updates separate from final semantic blocks | `talent-signal.run-update` vs `talent-signal.answer-block` parts | `session-message-parts.test.tsx`, `conversation-execution.test.ts` |
| Silence/empty assistant content valid | empty content renders without placeholder | `session-message-parts.test.tsx` |
| Code/list/table intact | Markdown (GFM) for updates and result | existing `conversation-response` behavior, unchanged plugins |
| Final result standalone; memory/calendar decisions distinct from completed execution | execution record above result; decision cards after it | `session-message-parts.test.tsx`, `queued-conversation-transcript.test.ts` |
| Instant send/typing acknowledgement <1s; input usable during run | existing local outbox; composer enabled mid-run | `use-conversation.test.ts`, `queued-conversation-run-control.test.ts` |
| Presentation updates 500–1000ms; terminal states/errors prompt | `use-preview-pacing.ts` at 600ms with trailing edge | `use-preview-pacing.test.ts`, `conversation-execution.test.ts` |
| Stale/out-of-order/cross-account events fenced | stream acceptors + presentation step fencing | `conversation-delivery.test.ts`, `conversation-execution.test.ts`, `use-preview-pacing.test.ts` |
| Supplementation default; rapid fragments keep identity, receipts, images, retry safety | unchanged queue entry semantics | existing queue/delivery tests (`use-conversation.test.ts`, `queued-conversation-send-supplements.test.ts`) |
| Stop and Escape pause queue; completed results and partial draft preserved; explicit Continue; safe restart/retry/withdraw/delete | Escape → `stop` mutation, IME guarded; queue panel controls unchanged | `queued-conversation-run-control.test.ts`, `conversation-execution.test.ts` |
| Reader scroll preserved when upward | unchanged follow-reader logic | existing conversation scroll helpers |
| IME composition owns Enter/Escape | composer key decision unchanged; canvas Escape ignores composing events | `queued-conversation-run-control.test.ts` |
| Only final result or human decision notifies; no new native notification permission | Web conversation adds no notification surface | source inspection: no notification API in conversation paths |
| Readback never grants source authority to previews | preview parts are ephemeral; provenance only from readback blocks | `session-message-parts.test.tsx` |
| Interrupted runs read truthfully | stopped run identified only by its persisted `cancelled-<message>` task identity | `conversation-execution.test.ts`, `session-message-parts.test.tsx` |

## Coverage — GET-129 (composition)

| Requirement | Where | Evidence |
| --- | --- | --- |
| 248px expanded sidebar / 64px collapsed rail | `workspace-shell.module.css` tokens | stylesheet; visual acceptance parent-owned |
| 40px one-line Session rows, full accessible titles | `sessionRow` + `sessionTitle` | `workspace-recent-sessions` markup keeps full title text and `title` |
| 24/28px avatars in practical controls, real dynamic identity only | `PersonDirectoryAvatar` at 24px in rows; brand mark when no person | `workspace-recent-sessions.test.ts` (identity projection, no fixture people) |
| 68px centered lightweight 15px floating Session title with details disclosure | conversation header | `queued-conversation-transcript.test.ts` (heading), stylesheet |
| 880px readable axis shared by transcript and composer | `content`/`dock` geometry | stylesheet |
| Centered per-send timestamps | `SessionSendTime` above each send | `session-execution-card.test.tsx`, `queued-conversation-transcript.test.ts` |
| Trailing user bubbles; leading Agent semantic blocks | `userRow`/`userMessage`, `answer` grid with 24px brand-mark column | `queued-conversation-transcript.test.ts` (identity + content order) |
| Supported destinations, account controls, native chrome preserved | navigation and account code untouched | diff |
| Recent-history default collapsed behavior preserved | `WorkspaceRecentSessions` behavior unchanged | existing `workspace-chrome-states.test.ts` |
| Light/dark, mobile controls, narrow/large text, long messages, low height | token-based styling, existing responsive blocks retained | stylesheet review |

## Verification performed

Commands run in the frozen worktree:

- `pnpm install --frozen-lockfile` — dependencies at lockfile state.
- `pnpm --filter @talent-signal/web typecheck` — passed.
- `pnpm --filter @talent-signal/web test` — 215 files, 1605 tests passed
  (1 skipped, pre-existing), including the new projection, pacing, milestone,
  execution-card, keyboard and transcript composition tests.
- `pnpm --filter @talent-signal/web lint` — 0 errors (6 pre-existing warnings
  in out-of-scope files).
- `pnpm docs:check` — documentation, wiki and architecture checks passed.
- `AUTH_SECRET=… pnpm --filter @talent-signal/web build` — production build
  passed (the build requires an `AUTH_SECRET` at page-data collection; that
  failure mode is environmental and pre-existing).

Rendered proof for this round is the deterministic happy-dom transcript
composition test (`queued-conversation-transcript.test.ts`): send times,
trailing user content, milestone updates, `running` and `waiting-review`
execution records with elapsed time, standalone result blocks and the pending
calendar decision block. Browser and macOS resident-surface acceptance remain
parent-owned per the delivery contract.

## Known limitations

- Real browser rendered comparison at 1280×820, collapsed, dark, narrow and
  reduced-motion states, plus IME and scroll behavior on a live surface, are
  not executed here; they remain in the parent's acceptance milestone.
- The live run's elapsed clock is measured from message admission, so it
  includes queue wait; the record states this as "用时" from send, and terminal
  records pin `开始`/`结束` observed times. A dedicated run-start timestamp is
  not exposed by the queue contract; adding one would be a contract change.
- Milestone updates show the run's real visible output in short form. Long
  forming output beyond the recent units stays invisible until terminal
  readback shows the complete result.
- Notification policy (final result or genuine human decision only) is
  preserved by adding no Web notification surface; the native macOS side is
  out of scope for this change.
- No backend or queue schema change was needed; `packages/contracts`,
  `apps/backend/src/modules/conversationQueue*` are untouched, so existing
  queue tests remain the execution evidence for those modules.

## Design grounding

Measured layout and type values used from the read-only Figma node trees are
recorded in [`design-measurements.md`](design-measurements.md). The trees and
screenshots stay read-only references and are not copied into this directory.
