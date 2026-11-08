# GET-449: recheck the original source immediately before COMMIT

## Outcome and boundary

Prevent a durable Chat owner from sending its state-changing COMMIT after its
original source's observed deadline has elapsed during the final credential
query. Preserve acknowledged-commit facts and the separate current-reader replay
policy. No authority, proof, source snapshot, checkpoint, SQL, route, provider,
CI or C05/C03 behavior is redesigned.

## Observed failure

The exact GET-452 head `35f5569e15c19a8389c72709b9b3edbe65a4c931`
Backend log recorded 49/50 PG cases passing. The credential/crossExpiry case in
`legacyChatSessionContinuity.integration.test.ts:306` observed publication
COMMIT entered when it expected false. HTTP 409 had already passed. The later
ACK, canonical state, lineage and audit assertions did not execute; that run
does not prove whether the attempted COMMIT was acknowledged or published.

`advance` checks the original source inside its callback, but
`LegacyChatAuthority.withClient` then awaits another real credential query.
The database facade previously sent COMMIT directly after that await. Timer
delivery is not a synchronous deadline check.

## Minimal change

1. Add an optional server-only synchronous `beforeCommit` callback to
   `createLegacyChatDatabase.run`, preserving existing operation/transaction
   arguments. After `withClient` fully returns, invoke the callback and
   `authority.throwIfTerminated()` synchronously, then set `commitSent` and send
   COMMIT without another await in between.
2. Every `advance` transaction (dispatch, lease, checkpoint and final
   publication) supplies its real original source's `assertLive`. Recovery
   adoption supplies its restored original source too. No callback is accepted
   from HTTP/model data. Default facade transactions still check their own
   authority immediately before COMMIT; current-reader publication does not
   inherit a dead original source.
3. Keep all existing post-COMMIT source checks and current-reader delivery
   checks. A delayed acknowledged COMMIT is a committed fact with refused late
   delivery; an unknown COMMIT remains unknown. A synchronous pre-COMMIT failure
   leaves `commitSent=false` so the existing rollback path executes.
4. Keep the four actual source/credential/COMMIT windows, exact three-query
   barrier, original 5-second DB expiry, waits, assertions and case budgets.
   Before their post-response assertions, record a real control-connection
   snapshot containing only a fixed schema, window/expiry booleans, COMMIT
   entered/ACK booleans, a closed canonical-state classification, body presence,
   and lineage/audit counts. Never emit body, identifiers, credentials, proof,
   SQL or error details.

## Verification and status

Source candidate only. No local tests, TypeScript compiler, PG, child, provider,
service or browser is run. Root owns independent review, normal publication and
the existing actual PG target containing all 50 cases; no selector is narrowed.
The expected repaired credential/crossExpiry case must refuse delivery, never
enter publication COMMIT, and leave no completed body/lineage/audit. Its early
release positive must still publish once. The COMMIT/crossExpiry case must
continue to observe a real acknowledged completed fact and refuse late delivery.
Original noSession, process-death, recovery and strict-v2 tests remain applicable.

Completion still requires exact-head applicable gates plus clean committed
resident deployment and live revision/behavior readback under repository AGENTS.
These have not been performed by this source-only task.
