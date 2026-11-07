# Keep legacy Chat within its original authority

Tracking: GET-449, GitHub issue523. Parent: GET-439. Related: GET-298,
GET-445 and GET-447. Status: actual first regression red reproduced; original-credential guard
implementation active. Full lifecycle is neither implemented nor accepted. Starting main:28cc0f9fe1f418d3a898677d62848f0e42863535.

## Outcome and boundaries

A native legacy Chat attempt must stop using an expired or withdrawn original
login, grant or selected source. Re-login cannot renew that attempt. Completed
lawfully retained replies remain readable under their current content policy.
Slow providers must not hold the product transaction or starve a one-client
pool. Cancellation and retirement belong to an exact intent/attempt/request,
never an entire account. Uncertain work after restart must not automatically
replay a provider or tool effect.

The authorized work is forward migration of historical C02 intent, not reuse of
obsolete migrations. Preserve the current queue, selected-person Memory
admission, history tool and nullable provider-usage behavior. No real paid
provider probe, live database experiment or deployment has occurred in this
task. Resident changes remain required before completion under AGENTS.md.

## Current evidence and unknowns

At the starting main, app.ts registers POST /v1/chat/tasks and
/v1/chat/unscoped-tasks with authenticate, then awaits createChatTask or
createUnscopedChatTask. The functions enter inTransaction at chat.ts:810 and
unscopedChat.ts:459. The latter already accepts a signal in its lower-level
executor and has a Claude-specific source guard; this is not evidence that all
legacy HTTP attempts own an original-authority lease or durable lifecycle.
The existing readback checks and source withdrawal behavior must be retained.

The 2026-11-08 independent audit mapped43 exact source files. The first concrete
counterexample is an ordinary authenticated unscoped request without a product
Session: hold an injected provider answer, revoke the original login through a
second test connection, prove the old token is rejected, then release the answer.
The current wrapper has no late-login check before completing the old intent.
At exact541c1ec1bd06e270f2392409a39b67ed51832450, Hosted run42394097203
actually executed this case against disposable PostgreSQL: the positive control
returned201; fresh authentication returned401 after exact-session revocation;
the held original request nevertheless returned201 with the answer and one
completed-success receipt. Those three safety assertions failed while the
positive/provider/withdrawal controls passed. Root independently read the full
test and actual job log. This is a genuine product regression, not a setup red.

The43-source ownership map and original-credential design are complete enough
for the first guard slice. Actual TCP disconnect, one-client starvation,
duplicate ownership, restart uncertainty and full lawful retention scenarios
remain unexecuted. No real provider or resident deployment was used. Determine
the next unused migration identity from a fresh full remote manifest before
any ledger creation; no migration is authorized by the guard-only milestone.

The real iOS transport waits up to120 seconds and decodes the existing reply
body. Preserve successful201 responses; substituting202/status would break that
decoder. Status recovery must also work by the original client-known key when
the admission reply is lost. Existing queue and agent-task tables require
different canonical parents and cannot be reused by inventing a product Session.

## Proposed minimal design to review

Keep one durable original intent and immutable attempt generations. Capture
the exact original login, actor, account, source scope and bounded deadlines at
admission. Separate current execution authority from lawful result retention.
The admission proof must identify the token generation actually accepted by the
real authenticator, including its existing previous-token grace and original
deadline. Do not substitute an already renewed session's later expiry. Compute
any required one-way binding only inside the authenticated host boundary; never
persist or log the original bearer or accept authority from a request body.
Use short admission/finalization transactions and run provider work outside
them. Recheck original authority before dispatch and around awaited tools and
final publication; preserve current source guards as independent enforcement.

Bind disconnect cancellation only to the attempt admitted by that request.
An idempotent reader or duplicate waiter must not cancel somebody else's active
attempt. Status must distinguish completed, failed, cancelled and uncertain
work without inventing a successful reply. Explicit recovery must not replay
an uncertain consequential tool effect or replace original authority with a
new login. Exact recovery semantics and compatibility with old clients remain
an open design gate.

Startup and periodic maintenance must use exact owner/generation/deadline
predicates, immutable failure reasons and bounded batches. Do not retire
unrelated active queue work or turn execution expiry into content deletion.
Use existing current-source relations and retention functions rather than
creating a second, weaker authorization policy.

The audit found115 migration identities with highest prefix111 at this base.
A new execution ledger appears necessary;112 is only a candidate until a fresh
remote manifest check. Define exact account/source deletion, retained-result and
uncertain-dispatch lifecycles before creating it. Do not roll back or rename an
older migration, and do not manufacture another idempotency identity by adding
the login Session to the original operation/key.

## Phase2 review conditions (not implementation authorization)

The independent31-source review narrows the first short-transaction slice to
no product Session and an actual answer-only provider (production DeepSeek) or
disabled result. No Session alone is insufficient: Zhipu also exposes run and
can stage Memory, so that branch keeps the current phase1 atomic transaction.
Freeze the selected provider/configuration at admission, never reselect after
an uncertain dispatch or a new login.

Reuse the existing exact idempotency tuple as stable intent and canonical201;
one account-scoped execution table can hold the single immutable attempt and
owner generation. A legacy completed record without the new row still replays
lawfully; legacy processing without a row stays conservatively unavailable,
never receives a replacement attempt. Durable dispatch_started precedes the
actual RPC, and uncertainty cannot delete the key or dispatch again.

Execution progress requires original authority. Current-owner explicit cancel
and internal expiry/withdrawal cleanup only reduce authority and must still
work after the original credential dies. Private checkpoints are bounded
whitelisted final DTOs, not whole execution/prompt snapshots;1MiB is not a
proven limit for every Agent branch. Complete metadata/Unicode/usage/byte
bounds, exact Lab classification/writeguard/cleanup and real startup/periodic
retirement must be reviewed before fresh migration allocation.

Short final transactions and duplicate readers use the same passed client;
no pool probe or waiter holds the only connection across await. Lock order
must compose with the frozen phase1 Lab/account/source protocol before taking
idempotency and execution rows. Actual pool1/TCP/child-restart/cleanup cases
remain required. Runtime cutover must drain old unledgered requests honestly;
the new ledger cannot reconstruct historic unknown dispatches.

## Continuation-store review repair

The first independent phase1 review found that the wrapper named get/list/clear
instead of the actual SDK store load/listSubkeys/delete methods. A late provider
postcheck could reject the HTTP response after mirror data had already reached
the adapter. The guard now enumerates append/load/listSubkeys/delete and the
pinned SDK's optional listSessions/listSessionSummaries with an exhaustive typed
map against the owning HarnessContinuation store contract. Only actual callable
methods are wrapped; absent capabilities stay absent. Future SDK method additions
cannot silently bypass review.

Twelve pure cases check each method both before and during withdrawal,
including its original receiver and whether any return value reached the
adapter before the outer provider boundary. The original wrapper produced six
failures; the first four-method repair passed187 cases. Independent review of
the exact pinned0.3.312 declaration then found the two optional methods; the
exact-source compiler rejected the four-key map and four new callback cases
failed. The six-method repair passed the expanded191-case pure suite and
seven-root TypeScript6.0.3 check mapped to the exact pinned declaration. This
checks the locked store shape with existing peer dependencies, not a full
installed pinned-dependency build; Hosted remains required. The added
real HTTP/PG case requires a lawful committed mirror and resumed identity before
revoking the actual login, then checks zero delivered rows before the final409.
At37902a26 the explicit12-case PG suite ran:10passed,2failed. The actual
continuation-mirror positive/resume/withdrawal/non-delivery case passed. Both
scoped lawful201 controls returned409 before their provider; the new fixture
had manually inserted only no_action, while the existing responseBlocks owner
requires identity_context. That exact error code is source-derived, not printed
by the original status-only failure. The fixture repair uses the production
relationship compiler and requires naturally published/gold/all-pass gates and
both blocks. No production authority, source verifier or positive assertion is
relaxed. Two status assertions add only bounded error-code/provider-count
diagnostics. The repaired fixture still requires a new exact-head12-case PG run;
its14pure tests and one-root static check do not substitute for that result.

At68b57b5c the canonical fixture passed all12 real PG cases. The broader
feedback suite then found two existing scoped-source contracts returning the
new generic authority code instead of CHAT_COMPLETION_SOURCE_CHANGED. Preserve
that route-owned public code for the exact existing409/HARNESS_SOURCE_CHANGED
source-owner rejection, while keeping LegacyChatTerminated, abort, first-failure
latching and no fallback. Credential, database and unknown source failures
retain the generic authority code; original error prose/details are not copied.
Only the scoped HTTP route selects its fixed internal code. Four additional
pure cases check known-source terminal behavior and unknown/auth/DB separation;
independent review also caught dispose-first late source rejection replacing
the already-aborted reason. Disposal now locks the first terminal instance
without throwing, and both source-first/dispose-first same-instance cases pass.
The full six-file197 cases and exact-SDK three changed-root check pass. The
existing real feedback contracts must still rerun on the published repair.

Two dedicated Lab HTTP cases are also source-reviewed: real grant withdrawal
with individually live child credentials, and human workspace stop. The latter
must first observe canonical advisory stop intent while workspace/child/auth
are still live, then release the provider so its independent source probe
rolls back the old transaction. Waiting for committed deleting/401 before
release deadlocks against the original idempotency workspace SHARE lock.
After release require stop completion, child401, exact cleanup and parent200.
Original2s/15s budgets and all prior12 cases remain; the final14 PG cases have
not yet executed and do not establish operator-principal race acceptance.

## Milestones

1. Active: implement and verify only the original-credential guard on both
   legacy routes and every enabled awaited provider/tool/fallback/final boundary.
   Freeze the accepted current/previous-token branch and original expiry, never
   a renewed deadline. Auth/source/DB authority failures are terminal and cannot
   select another provider. Admission must not hold a new session lock across
   slow work; the final write segment must lock/recheck in the existing order
   so a concurrent original-session revocation serializes with publication.
   Add real PG positive/late-revoke/expiry/rotation/previous-token cases. This
   slice deliberately retains current product transactions and does not solve
   starvation, disconnect, restart or the full C02 lifecycle.
2. Independently review the proposed ordinary-unscoped short-transaction ledger,
   exact idempotency/unknown-dispatch behavior, source cleanup and one-client
   cases before authorizing schema/production implementation. Candidate112 is
   not allocated until the latest remote manifest is checked.
3. Preserve current atomic publication for scoped Memory staging and manifests.
   Do not convert it to early independently committed partial effects. A real
   attempt-private pending-publication protocol with truthful typed receipts,
   SDK mirror CAS and unchanged queue authority requires separate review.
4. Execute all seven actual scenario groups, preserve201/native compatibility,
   independently review latest storage/authority/effect replay, and pass current
   applicable gates before normal merge. Initial guard success is not delivery
   of the whole lifecycle.
5. Deploy every affected existing resident from clean committed source through
   the owning operational workflow, verify live revision and changed behavior,
   and complete native acceptance. Keep the issue open for missing evidence.

## Completion evidence

Record exact source hashes, actual test commands/results, migration identity,
PR/merge readback, resident versions and isolated acceptance cleanup. Prove
that original login/source expiry blocks late writes without extra provider
fallback; duplicates dispatch once; disconnect cancels only its owner; restart
does not auto-replay; one-client heartbeat/finalization works; and current lawful
readers retain access to completed content. Preserve original WIP and sensitive
historical sources; never use archived credentials or raw private conversations
as fixtures.
