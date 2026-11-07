# Release the database connection during answer-only legacy Chat

Tracking: GET-449, GitHub issue523, parent GET-439. This continuation is stacked
on the original-credential guard at965805a0. PR525 has not merged at this
starting point. Full C02, resident deployment and native recovery remain open.

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
The new regression is source-indicated, not yet executed against PostgreSQL.
Its normal pure lane skips it; only the explicit Hosted PG lane supplies proof.
The fresh isolated branch baseline passed145 affected pure tests. No local
database, dependency installation, Simulator, service or native build is used.

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

No migration has been allocated. The manifest had115 identities/highest111;
112 is only a candidate pending a fresh full remote/concurrent check. A new
account-scoped table must join the exact Lab manifest/write guard/cleanup and
real startup/periodic retirement owners. Existing migration bytes stay frozen.

## Required evidence before delivery

First reproduce the real one-client red, then implement and independently
review the bounded ledger/DTO/lock protocol. Prove same-pool heartbeat and
duplicate waiting, real owner-versus-waiter TCP disconnect, child-process
crash before/after dispatch and checkpoint, commit-ack ambiguity, same-key
readback under current ownership, expiry/revocation/rotation/Lab/account races,
and exact cleanup with actual PostgreSQL. Preserve original14 authority and42
feedback regressions. Full current gates, clean resident deployment/live
revision and changed behavior, and native recovery evidence remain separate
requirements; the first regression or guard merge is not full C02 completion.
