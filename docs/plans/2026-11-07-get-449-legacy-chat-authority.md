# Keep legacy Chat within its original authority

Tracking: GET-449, GitHub issue523. Parent: GET-439. Related: GET-298,
GET-445 and GET-447. Status: source audit and design; not implemented or
accepted. Starting main:28cc0f9fe1f418d3a898677d62848f0e42863535.

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
This is a source-derived counterexample, not an executed red test.

Only source inspection has run. A late-authority regression, disconnect
ownership, pool starvation and restart outcome still require executable red
cases. Before coding, map every current provider/tool await, admission write,
readback predicate, idempotency identity and source-availability function.
Inspect the current native transport so status can be resolved even if the
original admission reply was lost. Determine the next unused migration identity
from the full migration manifest, not from an old numeric prefix.

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

## Milestones

1. Active: the current-source ownership, transaction, native and idempotency
   map is complete. Write and execute the real buildApp/Auth/PostgreSQL
   late-login counterexample first, with a deferred synthetic provider and
   guaranteed cleanup. Then prove one-client starvation, actual TCP disconnect,
   owner-versus-duplicate cancellation, process restart/same-key uncertainty and
   lawful completed-result readback. Freeze the original-authority model and
   scoped transaction/source-DTO decomposition for independent review.
2. Implement the reviewed short-transaction lifecycle and fresh migration;
   retain old-client response/readback compatibility and explicit truthful
   status/cancel/recovery behavior.
3. Run pure and real Hosted PostgreSQL authority, concurrency, disconnect,
   restart, retention and one-client-pool checks. Independently review storage,
   authority and effect replay before normal PR/merge.
4. Deploy every affected existing resident from clean committed source through
   the owning operational workflow, verify live revision and changed behavior,
   and complete native acceptance. Keep the issue open for any missing proof.

## Completion evidence

Record exact source hashes, actual test commands/results, migration identity,
PR/merge readback, resident versions and isolated acceptance cleanup. Prove
that original login/source expiry blocks late writes without extra provider
fallback; duplicates dispatch once; disconnect cancels only its owner; restart
does not auto-replay; one-client heartbeat/finalization works; and current lawful
readers retain access to completed content. Preserve original WIP and sensitive
historical sources; never use archived credentials or raw private conversations
as fixtures.
