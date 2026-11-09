# Fence captured Session history with original Memory proofs

## Outcome, spec and scope

This bounded GET-455 milestone protects a real public SDK-branch request that
already consumed captured canonical assistant text. Loss or invalidation of its
original Memory proof must terminate that actual owner and prevent successful
publication. A fresh Run must retain authorized human prose and independent
history. The binding feature spec remains GET-455 and the parent plan
`2026-11-08-saved-memory-discovery-withdrawal.md`; current executable acceptance
is `savedMemoryCapturedHistory.integration.test.ts`. The source audit at
`/Users/cubxxw/ops/runs/code-sync-20261107/get455-captured-history-next-source-audit.md`
records the precise existing seams, not passing runtime evidence.

Stage response COMMIT ordering is a separate prerequisite. Reviewed Main PR543
source b5977b3e was normally integrated into this feature branch; Main PR status
and resident delivery are separate. Its original route actually failed both
pre-COMMIT HTTP cases, and its new Main cases actually passed. The current
feature head still needs its own exact-head Runtime15/Discovery6/captured2 and
both distinct Stage2 invocations. Never substitute Main evidence for this tree.

## Task 1: Bind captured history to the real current owner

Read this task as the complete bounded requirements. The controller owns
commits, push, PR and live-service actions; implementer owns only the source
changes below and its private report, until the controller explicitly freezes
that source for independent review.

### Global Constraints

- Work only in `/Users/cubxxw/.codex/worktrees/get-455-saved-memory-discovery/capir`
  on `codex/get-455-saved-memory-discovery`. Do not modify other worktrees,
  credentials, resident services, databases or account/provider settings.
- Do not spawn agents, commit, stage, push, merge, deploy, send messages through
  external services, install dependencies, or run local Node/PG/Swift/Simulator
  tests. Pure Python/source/Git read checks are allowed. The controller runs
  exact-head Hosted checks after freezing and independently reviewing changes.
- Preserve the original Runtime15, Discovery6 and two captured-history HTTP
  case bodies, assertions and budgets. Preserve both Stage2 files and required
  selectors, all existing guards and public transport/schema contracts. New
  meaningful private-receipt/negative tests may be added separately.
- Preserve all released Main117 migrations and unreleased114/115 SQL/manifest
  bytes and current119 order/digest. No schema rewrite, proof backfill from old
  untracked data, fabricated successful DB/auth/result/proof, or new provider
  permission. Synthetic remote-model replacements in existing real fixtures
  are the permitted test seam.
- Preserve original source/credential/Lab/query/Run horizons and their units.
  Never mint `now+TTL`, adopt a later epoch, widen a source floor, attach an old
  query/login TTL to durable retained history, or replace a genuine NULL
  canonical-retention deadline with an invented finite one. Keep the inline
  six-turn/last12-message selection and complete200-turn/4400-message/1MiB
  body/text and existing source bounds. Oversized metadata must refuse the
  complete capability, not truncate it and call it complete.
- Keep original human prose, independent/genuine-empty V2 replies, lawful
  finite V1 compatibility and old markerfalse/no-lineage history. A required
  missing proof must never fall back to old compatibility. Finite V1 cannot
  satisfy a new required V2 claim.
- Source/meta receipts remain backend-private, immutable and opaque. No raw
  private text, credential, SQL parameter or proof DTO goes into model tool
  input, logs or reports. The history tool stays untrusted conversation data,
  with existing UTF16 selectors/cursors/windows and no account/Session selector.
- Do not activate SDK Memory search, queue/scoped/Lab/image producers, final
  HTTP lifecycle or maintenance beyond this captured-owner milestone. They
  remain explicit parent-feature work; this task cannot mark C03 complete or
  make PR536 ready. Preserve their current qualification boundaries.

### Required behavior and implementation boundary

1. Capture original canonical assistant text and original proof metadata in the
   SAME authoritative SQL result. Retain exact actual completion row/operation,
   marker, original body digest, lineage classification, full original proof
   and dependency set/digest, source retention and actor binding. Do not read
   old text and later authorize it with a newly queried epoch or proof. Keep
   projected result bytes and metadata admission bounded before transport.
2. Track the explicit set of actually retained canonical assistant messages.
   `historyTaskIDs` also contains human-only/withheld, screenshot, host-result,
   queue and non-UUID legacy provenance; it is not the Memory domain. Deriving
   the domain from role, UUID shape or message ID alone is insufficient. The
   canonical reader must supply genuine private mapping. Human/independent and
   existing screenshot/host source domains remain intact.
3. Bind that capture to the actual Legacy credential/source owner, actual
   account/actor/login/product Session and actual private database. Reuse the
   genuine pool-or-unique-current-activeGuarded lease rule and private source
   handle, with checks across every awaited query, ACK and returned frame.
   Raw/forwarding/clone/reused/foreign handles are not authority; foreign-first
   refusal must not poison a recipient owner's phase, clock or latches.
4. Before every tool exposure and final successful publication, the real owner
   uses fixed server SQL to join its ORIGINAL accepted credential branch and
   current actor/account/product Session/Lab/source/stamp/generation, original
   captured claim/body/proof/dependencies and current Memory qualification at
   ONE statement tick. Compare original tuples/counts/digests/nullable source
   clocks exactly; same text or version restored under a new epoch does not
   authorize the capture. Old untracked captures must retain their original
   untracked state/body rather than adopting newly appeared lineage.
5. Register this fixed captured domain with the ACTUAL owner. A callback
   throwing a generic409 is not a new authorization grant or a durable failure
   latch. Own proof loss/expiry/rebind permanently terminates that request;
   a provider that swallows the tool error and returns a neutral answer still
   cannot publish201 or select fallback. Preserve existing abort, lock,
   transaction, COMMIT/ACK and unknown-result behavior for other paths.
6. Charge the full final query/ACK interval against original horizons before
   returning, using the owner's existing monotonic/original-precision pattern.
   A SQL-time flag that was true before delayed ACK is insufficient. Floors
   only narrow; do not create a grace period after the last post-read guard.
7. Wire the real public password-owned SDK Session/message entry through the
   actual owner and private source binding before model/tool construction.
   Do not label an issuer qualified merely by provider name, or mint authority
   from a mock callback, exported DTO, arbitrary SQL, wrapper or caller client.
   Existing source owner, final writer and failure handling must all consume
   the same fixed domain; no new path may silently omit it.

### Preservation ruling and acceptance

Once the model actually read an old assistant, a later projection cannot undo
that exposure. Terminate the stale Run; preserve durable human prose and
independent replies through a freshly captured Run. Do not invent a dynamic
same-Run refresh or erase original Session turns to make the tests pass.

The existing two actual HTTP cases are the minimum executable acceptance:
normal password/Memory/Session produces a genuine V2; the real SDK branch
constructs and initially reads its history tool; negative deletion of actual
dependency or lineage metadata leaves original required marker, auth, Session
stamp/generation and Memory tuple unchanged; a second read refuses stale text,
model error swallowing cannot publish a successful claim, and a fresh request
can still read human/independent history. These are synthetic-model/real-HTTP/PG
proofs, not actual remote SDK-provider or device acceptance.

Before production edits, read the controller's exact integration-head Hosted
baseline when available and confirm the captured cases reached their intended
failure. While it is pending, inspect/design and prepare negative test ideas;
do not replace an unreached case with a claimed RED. Ask the controller for
missing actual evidence or a necessary interface ruling instead of fabricating
one. No human check-in is needed for already-authorized reversible code work.

Add focused meaningful tests for original proof loss/rebind, foreign isolation,
real lease ownership and delayed final ACK/original finite horizons where the
existing genuine fixtures support them. A missing genuine finite producer is a
reported gap, not permission to insert a positive grant. Preserve old Runtime15,
Discovery6, source/Legacy/ACK/history-reader contracts and Main regression cases.

Likely owned surfaces: backend `sessionHistorySnapshot.ts`, `agentSessions.ts`,
`legacyChatAuthority.ts`, `unscopedChat.ts`, a focused new private capture module
and separate tests. Use existing inline `savedMemorySessionHistory.ts` and
`legacySavedMemoryDomain.ts` as identity/joint-query references without changing
inline limits or C05 semantics. If a necessary change extends the scope, report
its exact need to the controller before applying it. No broad refactor.

Write the full implementation/self-review/TDD evidence and frozen file hashes
into the task report. Report only a short status and the report path to the
controller. Do not claim DONE runtime evidence that only Hosted can establish;
use DONE_WITH_CONCERNS for a source-ready candidate awaiting controller checks.
