# Release the database connection during answer-only legacy Chat

Tracking: GET-449, GitHub issue523, parent GET-439, PR529. The original-credential
guard from PR525 merged as3dc908f3. This continuation implements the first
answer-only durable slice. Full C02, resident deployment and native recovery
remain open; a guard merge or a source-only checkpoint is not full delivery.

## First observable regression

The existing synchronous unscoped service holds inTransaction across provider
answer. Use actual buildApp/password authentication and an owned disposable
PostgreSQL database. A genuinely answer-only synthetic adapter must first
produce a lawful201 using a max=1 product Pool, then pause its next answer.
While paused, a heartbeat through that same Pool must acquire its only
connection within the existing two-second bound. Release the provider and
require the original201/body and exactly one call for this held intent.

The independent setup Pool must never serve that heartbeat. No product Session,
Agent run capability, host claim, private source or real provider is fabricated.
The first actual Hosted PostgreSQL run at3818 reproduced the failure: the old
implementation timed out acquiring the heartbeat connection while the answer
was held. Its normal first201, eventual201/body and provider-call observations
passed. The independent setup Pool did not serve that heartbeat. The original14
authority cases passed in that run. This is the observed red, not evidence that
the replacement runtime already passes PostgreSQL.

## Complete first slice and protected boundaries

Limit the short-transaction path to no product Session, no images, no steering,
no continuation/host result/Memory target, and an actual answer-only provider
or the disabled branch. Production Zhipu and Claude expose tools even without
a Session and retain the original atomic transaction. Freeze the selected
provider at canonical intent admission. Do not broaden model capability,
change provider budgets/usage semantics, or partially commit Memory proposals.

The durable design reuses the canonical account/actor/operation/key/request
hash and one immutable attempt. A dispatch-may-have-occurred marker must commit
before the actual call; uncertain dispatch can never acquire a replacement
attempt or automatically call a model again. A bounded whitelisted final DTO
may be checkpointed; objective, history, prompt text, images and tool arguments
do not belong in that ledger. Finalization and readback preserve the original
credential/deadline, source, ownership, retention and response201 contract.

Short transactions use their passed client for every check. Duplicate waiters
release clients and row locks before waiting. Completed legacy records without
a ledger remain lawful replay; old processing records without one remain
unavailable. Fresh login can read lawful completed content or reduce authority
by cancellation, never renew execution. Cleanup must still erase expired
checkpoints after the original credential dies, while retaining the key's
no-redispatch tombstone.

Migration112 now adds one account-scoped execution row per canonical intent,
with an immutable attempt, owner generation/nonce, fixed original deadline,
frozen answer-only descriptor and a private bounded checkpoint. It joins the
Lab manifest/write guard and cleanup owners. The descriptor uses SQL NULL for
the disabled branch, never JSON null. Existing migration bytes stay frozen.
The manifest identity was checked against current remote main and concurrent
work;113 is reserved separately for GET-451.

## Implemented candidate and current evidence

All advancing transactions restore the original credential and source proof,
then check account, source, current reader/Lab, canonical parent and execution
in that order. Provider waiting holds no connection. A committed dispatch
marker precedes the actual frozen answer method; final completion, canonical
reply/audit and checkpoint scrubbing share one transaction. Unknown dispatch
never re-dispatches. Lost final-commit acknowledgement reads the legal canonical
result. A different resolver must still pass its own current-reader envelope
before receiving that result.

The owner serializes database checks and drains a running check before result,
rejection or abort handling. Pool borrowing and SQL/lock waits are bounded;
late-acquired clients are released without SQL. Retirement remains bounded
after the original credential expires. MCP deletion bumps the same source
generation and erases affected active private backfill while preserving the
canonical key/attempt and truthful completed facts. Empty unrelated Sessions
do not bump the source generation. Ready checkpoints may survive owner-lease
loss for same-attempt adoption, but never their original fixed deadline.

Independent source reviews closed the MCP future-backfill, resolver-reader,
retirement-query bound and disabled SQL-NULL findings. Separate review covers
the original-proof/source codec and the JSONB-safe canonical checkpoint codec.
Current host evidence is217 passing affected tests plus the separately passing
disabled-descriptor regression;15 PostgreSQL cases were skipped in that host
run. The new disabled-branch PG case brings the current authored PG selection
to16, all pending execution against the replacement runtime. Actual TypeScript
6.0.3 with pinned SDK0.3.312 declarations reports zero diagnostics for18 selected
roots, including app wiring. This is selected-source evidence, not a full build.

New Lab-stop/grant-withdrawal and owned-child process-death fixtures are being
reviewed separately. They are not included in this candidate's executed counts.
No local database, dependency installation, Simulator, resident service change,
native build, real paid provider or release was used for this implementation.

## Required evidence before delivery

The real one-client red and independent protocol review are recorded above.
Next prove the replacement runtime's same-pool heartbeat and
duplicate waiting, real owner-versus-waiter TCP disconnect, child-process
crash before/after dispatch and checkpoint, commit-ack ambiguity, same-key
readback under current ownership, expiry/revocation/rotation/Lab/account races,
and exact cleanup with actual PostgreSQL. Preserve original14 authority and42
feedback regressions. Full current gates, clean resident deployment/live
revision and changed behavior, and native recovery evidence remain separate
requirements; the first regression or guard merge is not full C02 completion.
Session/tool-capable/Agent/operator-principal phase3 flows remain outside this
first answer-only slice. Resident rollout must drain old unledgered work;
existing processing records without a ledger cannot be treated as recoverable
or as permission to call the provider again.
