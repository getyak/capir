# Conversation send, durable queue, streaming, and recovery

Base: `e631705c4ad80b78655588f0414ce0215d7eefdf`.
Ownership: Pi implemented the initial backend, agent, contracts, and migration.
Codex implemented the Web experience and independently reviewed the complete
change, including subsequent privacy, shutdown, and admission-handoff fixes.
The final Pi resume was blocked by another task holding the repository writer
lock; Codex owns the remaining fixes and delivery. Unrelated main-checkout edits
remain untouched.

## Outcome

Sending a Web conversation message shows the user bubble immediately and
releases the composer. Admission is a short durable server transaction; model
execution runs in a bounded backend runner, one run at a time per Session, with
a server-authoritative FIFO queue. The user can edit or withdraw an unclaimed
queued item, stop the active run, retry a failed run explicitly, and continue a
paused queue. Refresh and disconnect never lose an accepted message, resubmit a
run, or clear a newer draft. The legacy synchronous
`/v1/chat/unscoped-tasks` endpoint stays compatible.

## Key decisions

- **Admission is separate from execution.** `POST
  /v1/agent-sessions/:id/conversation-queue` commits one queue row plus a
  monotonic state revision and returns a 202 receipt before any provider call.
- **Cross-process serialization** uses a per-Session advisory lock during claim
  plus a durable `running` row with a lease, heartbeat, and monotonic
  `lease_generation`. Every authoritative write is fenced on the generation, so
  a stale worker cannot publish text, overwrite a result, or append a Session
  turn after another runner recovered the entry.
- **No persisted preview tokens.** Live preview lives in the runner process and
  is broadcast on an in-process bus. A restart truthfully reports an
  interrupted run instead of replaying stale text. The snapshot revision is
  durable and monotonic.
- **Ordered, idempotent completion.** Current source validity, then a live
  claim, then exactly-once lineage/audit, then canonical Session history.
  A failure after provider success preserves the stored result so an explicit
  retry or lease recovery replays persistence without a second model call.
- **Truthful terminal states.** User stop pauses the queue and preserves the
  admitted user turn with an owned partial or a stopped-before-reply state.
  Late callbacks after cancellation are discarded. Revocation, expiry, stale lease, and shutdown never store a
  partial answer. Only an explicit Continue clears a pause; ordinary completion
  never does.
- **Objective is not evidence.** Terminal non-retryable states replace the
  objective with a privacy-safe tombstone (`content_state='scrubbed'`). The
  Lab write guard and manifest classification are added in the same migration.
- **Canonical user timestamp.** The Session user turn keeps the queue row's
  accepted timestamp; only the response records completion time.
- **Lab parity.** The queue runner selects providers through the configured Lab
  trial service and shares the frozen reference clock, so Web does not lose
  experiment arms.
- **Character limit.** The supported server bound of 1000 characters is kept.

## Modules

- `conversationQueueState.ts` — storage, snapshot, claim, lease/fencing.
- `conversationQueueAdmission.ts` — admission and client mutations.
- `conversationQueueCompletion.ts` — governed lineage and canonical write.
- `conversationQueueRunner.ts` — bounded worker, preview, recovery.
- `conversationQueueRoutes.ts` — HTTP routes and narrow non-mutating validation.
- `conversationQueueSweep.ts` — retention and revocation cascade.
- `conversationQueue.ts` — barrel re-export.

## Milestones

1. [x] Agent seam: `onVisibleText`/`onProgress`, incremental
   `VisibleTextFilter`, provider threading, cancellation composition.
2. [x] Additive contracts for admission, snapshot, mutation, and client calls.
3. [x] Backend queue module split, migration `073_conversation_queue`, runner,
   SSE observation, recovery, retention sweeps, App close hook.
4. [x] Route-level non-mutating validation for the mutation union plus a stock
   Fastify `inject` regression across all five mutation kinds.
5. [x] Web outbox/controller, editable queue, streamed transcript, and composer.
6. [x] Desktop browser checks and 360 px queue/continuation acceptance using
   synthetic data. Three rapid admissions survive navigation and preserve a
   newer draft; an additional Stop-during-handoff timing has React coverage.
7. [x] Disposable-database integration suite (18 cases), three SSE regressions and focused agent tests.
8. [x] Concise canonical documentation notes and this plan.

## Verification and release state

See [the evidence record](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-20-conversation-send/implementation-evidence.md)
for exact checks and their boundaries. Backend type checking, the production Web
build, focused client tests, 541 backend unit tests, and 21 queue/SSE tests pass. Independent HTTP proof
covers ten admission, streaming, cancellation, and recovery properties.

PR #217 merged as `7ae47717`. The original implementation evidence predates
resident rollout. Web and backend were subsequently released from `9b4ea5fe`
on September 21; the follow-up below records runtime proof and the remaining
legacy home compatibility fix.

## Follow-up: legacy home draft trapped the queue (2026-09-21)

A pre-queue `conversation-home` record permanently selected the blocking home
controller. Authenticated-ready home now renders the queue immediately, including
SSR, regardless of old storage. Its full account/binding key resets all queue
state on account changes. The not-ready legacy shell remains disabled.

A compact notice preserves the exact old text and original expiry. Missing or
false `attempted` flags mean UNKNOWN, never permission to replay or re-key.
Original durable request identity stays untouched. The notice offers only text
readback: the old Session controller cannot be used as a safe recovery target,
because it rebases home intents into ordinary drafts and can later assign a new
request ID. No link into that controller is provided. New messages remain usable.
A scoped storage listener and an expiry timer remove stale displayed recovery;
reset/remount never extends retention or duplicates the notice.

Regression coverage seeds real partitioned storage, delays admission, and proves
immediate echo/composer release through `/conversation-queue`, no old replay,
unchanged original identity, SSR, account remount, storage denial, original
whitespace, reset, cross-tab removal, and live expiry. Existing shell assertions
now expect the queue surface. Local full Web tests, typecheck, lint and docs
checks passed (979 full-suite passes plus one skipped case; 15 focused
assertions passed after the final navigation removal). Independent review
closed the account isolation, recovery-target and retention findings, with no
remaining P0/P1. Exact-head CI, merge and resident readback remain delivery gates.

Resident release follow-up: the previous handoff opened an older resident build.
On September 21, Web and backend were deployed from merged `9b4ea5fe`, with both
073 migrations present. Authenticated browser testing confirmed immediate user
message echo, a second message queued while the first ran, sequential completion,
and draft recovery after reload. This proves the merged queue release; this
legacy-draft patch still requires its own merge and resident revision readback.

## Follow-up: admission must preserve the live composer (2026-09-21)

Resident verification of `56ab027d` confirmed immediate echo, then exposed a
second interruption: admission used `router.replace`, which unmounted the
composer while the canonical Session page awaited server reads. Under a real
detail/auth query timeout, continued typing lost its target. The model reply
was persisted and eventually readable, but input continuity failed.

Admission now updates the canonical URL through Next's supported native History
API and keeps the same queue controller, DOM input, focus, selection and draft.
The admitted conversation shows its own header, while reload still resolves the
canonical Session. Link navigation intent, programmatic composer navigation and
browser history traversal prevent a late admission from replacing a pending
destination. A deferred
admission regression types a second draft before the receipt, models the old
route fallback, and proves focus/caret preservation plus a second admission to
the same Session. This avoids blocking input on route reads; it does not claim
to fix the separate transient PostgreSQL query timeout.

Review follow-up: admission handoff runs once and removes the shared Home
pointer only when it still belongs to this Session. Another tab can create a
new Home before or after that receipt without losing draft recovery. Deletion
and the brand Home link explicitly reset the retained Home controller.
Regressions cover both tab timings, pending path and query-only Link transitions
whose URL has not committed, and sending with a fresh Session after deletion.

## Open risks

- Live preview is per-process; multi-process deployments show durable state but
  not another process's forming text until it completes.
- The queue path does not use Claude SDK session continuation because that
  requires holding a transaction across model work; canonical conversation
  history is still supplied to the governed agent.
- Preview text is bounded to 12,000 characters. Longer replies finish through
  validated canonical readback; raw preview tokens are not stored for replay.
- The local outbox has a 24-hour maximum lifetime, bounded further by Session
  expiry; admitted messages live under the server's Session retention policy.
- Early browser runs encountered host load around 31, database timeouts, and
  browser-bridge failures. The core desktop and narrow-screen flow passed after
  recovery. No production latency percentile, full accessibility/theme matrix,
  or live external-provider result is claimed.
