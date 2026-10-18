# GET-131: One-person public source sync — implementation plan

## Outcome and boundary

For exactly ONE owner-confirmed Person and ONE already-bound authorized public
URL, let the owner's product re-read that page on an honest 24-hour UTC cadence
and surface genuinely new observations as proposed evidence plus one additive
unconfirmed `public_source_update` calendar activity. Owner confirms the exact
source, the bound person/context, the honest interval (IANA zone display only)
and a required expiry (UI default 30 days); first cycle is due immediately. The
periodic confirmation is structurally separate from the one-shot research
approval. Owner can inspect the latest real status/next run, pause/resume/delete;
an expired grant never silently revive and needs a fresh explicit confirmation.

Out of scope permanently: automatic contact creation, Memory acceptance,
messages/invitations, private-account access, face identity, any external effect
(`external_effect='none'` everywhere), any per-cycle fabricated "human review".

Ownership: implementation is this worktree's write. Parent owns product
acceptance, independent review, CI/PR/deploy, Linear state and issue closure.
GET-39/130 (native Capture/Today + resident native acceptance) and GET-128
current main fixes stay untouched.

## Parent-settled design (frozen)

- Dispatch via the existing research lifecycle with a durable `recurring_run_id`;
  shared-transaction authority gates at dispatch/per-page commit/finalization
  and recovery. No closure-only authority, no second source store/fetcher.
- Immutable per-cycle request freezes the exact canonical URL/domain + the
  ORIGINAL grant actor/authorization revision/time; never the mutable seed
  locator, never a fake per-cycle approval. Source changes require new
  authorization (`PUBLIC_RESEARCH_SCOPE_CHANGED` /
  `PERSON_SOURCE_SYNC_SOURCE_*` stops).
- One non-overlapping cycle per grant with a persistent lease and DB unique
  cycle key; missed days create no catch-up bursts; recovery reconciles the
  same original cycle before any new one.
- Recurring fetch must retain robots/byte/time/redirect limits and public DNS
  pinning. The research `fetchBounded` resolves once before an UNPINNED fetch,
  so recurring cycles reuse the pinned onboarding public HTTP primitive
  (`loadPinnedPublicResearchPage` in `research.ts`, wraps
  `fetchProfileResource`: resolve-once → pinned TLS socket, same-origin
  redirects, robots per hop, byte/time bounds). One-shot research behavior is
  unchanged.
- Per-page capture commit + grant fence + lease check share the ACTUAL database
  transaction via `createResourceCaptureInTransaction` (no outer callback
  around another pool transaction). Lock order: lineage ROOT capture → seed
  capture → grant → cycle row, so a root revoke (which locks the root FOR
  UPDATE before enumerating descendants) serializes with a derived commit in
  either direction.
- Cross-cycle UNCHANGED dedup uses grant/source lineage + canonical locator +
  stable extracted BODY hash (not taskId or volatile fetch metadata). Unchanged
  cycle: success, `new_observations=0`, no duplicate capture/calendar card,
  truthful run audit. Changed body: one new proposed observation.
- New account tables install the 098 `account_retirement_fence` triggers and
  the 045 Lab manifest/write-guard triggers; dispatch re-checks active
  account/person.
- Bounded recovery: max 3 TOTAL attempts per cycle including the first,
  absolute deadline `created_at + 15 minutes`, counted atomically BEFORE
  DNS/authority/fetch/research lease. Exhaustion permits only bounded DB
  receipt/idempotency reconciliation; committed partials persist; outcomes are
  observed `failed`/`partial`/`unknown`; a DB failure leaves the cycle
  unresolved and blocking any new cycle. One-shot global research retry is
  unchanged.

## Implementation (completed in this worktree)

Persistence (`apps/backend/src/database/099_person_source_sync.sql` + manifest):

- `person_source_sync_grants` (owner/account-scoped, revision CAS,
  `last_operation_id`, delete keeps an identity-only redacted receipt, one live
  grant per person via partial unique index over `status IN ('active','paused')`,
  `interval_seconds = 86400` CHECK, required `expires_at`, frozen
  `source_url/allowed_domain/source_capture_id/source_capture_version`),
  `person_source_sync_operations` (idempotency receipts, hash only),
  `person_source_sync_runs` (UNIQUE `(account_id, cycle_key)` and
  `(account_id, grant_id, due_at)`, partial unique one nonterminal cycle per
  grant, 014-style lease CHECKs, `attempt_count 0..3`, immutable frozen cycle
  request columns, observation receipt ids + `observed_body_hash`,
  `warning_codes`/`stop_reason` restricted to fixed content-free codes).
- `research_retrieval_jobs.recurring_run_id` FK round trip.
- `time_activity_content` replaced (same signature) with one additive
  `public_source_update` branch over genuinely committed new observations
  (`run.observed_resource_id IS NOT NULL AND run.new_observations > 0`) that
  re-validates capture/receipt/resource availability live; `public_source_update`
  added to the `time_activity_snapshot_items` kind CHECK.

Backend (`apps/backend/src/modules/`):

- `personSourceSync.ts`: grant CRUD with timeSchedules-pattern advisory locks,
  CAS + idempotency replay + intent-conflict detection, seed eligibility freeze
  at create, honest derived `effective_state` (expired never revives), the live
  authority gate, the shared-transaction cycle hooks
  (`createPersonSourceSyncCycleHooks`), and `runDuePersonSourceSyncs`
  (materialize due cycles → atomic claim → dispatch → honest settle), plus
  bounded DB-only exhaustion reconciliation. Frozen cycle requests are built
  with `maximum_page_count=1`, `maximum_link_depth=0`.
- `personSourceSyncRoutes.ts` (registered in `app.ts`): `GET
  /v1/time/person-source-syncs` (exact person/context + optional seed filters
  only), `GET/PUT/DELETE /v1/time/person-source-syncs/:id`,
  `GET /v1/time/person-source-syncs/:id/runs`; `authenticate`, non-coercing
  body validation, `cache-control: no-store`.
- `research.ts`: `runPublicResearch(..., options)` accepts `recurringRunId` +
  injected `RecurringResearchCycleHooks`; stamps the ORIGINAL grant approval
  (`approved_by_user_id`/`approved_at` from the grant) and audits
  `person_source_sync.dispatched_from_grant` (never a synthetic approval) for
  recurring tasks; stores `recurring_run_id` on the job row; delegates page
  commits and finalization to the hooks; unchanged pages keep the cycle a
  success. `runPendingPublicResearchJobs` and `getLatestPublicResearchTask`
  exclude `recurring_run_id IS NULL`-foreign rows: one-shot behavior unchanged.
- `sourceLifecycle.ts` runs `runDuePersonSourceSyncs` after source-authorization
  expiry inside the existing sweep.

Contracts (`packages/contracts/src/personSourceSyncSchemas.ts`, `client.ts`,
`index.ts`, `timeWorkspaceSchemas.ts`): narrow TypeBox schemas, bounded
rows/fields, fixed diagnostic enums, `public_source_update` activity kind,
client methods.

Web: `app/api/time/person-source-syncs/route.ts` (+ `[id]`, `[id]/runs`) with
`timeAccess` origin/session-binding and strict query checks, wrappers in
`lib/server/timeWorkspace.ts`, and
`components/relationship-workspace/person-source-sync-control.tsx` mounted
beside the composer's one-shot research approval with compact explicit
expiry/source/interval/confirmation/status controls, readable ineligible
reasons, and time-schedule-style response-loss dirty state (stable idempotency
key + expected revision).

### Implementation decisions recorded for review

1. **Recurring recovery is owned solely by the counted dispatcher.**
   `runPendingPublicResearchJobs` skips `recurring_run_id IS NOT NULL` jobs and
   the sync dispatcher passes the stored `recurring_run_id` back into
   `runPublicResearch` on replay. The frozen "count BEFORE research lease"
   invariant makes this necessary: any other worker replaying a recurring job
   would bypass the durable attempt count. One-shot jobs are untouched.
2. **`grant_authorization_revision` = the source authorization revision**
   (`captures.version` of the seed capture at grant time). Any authorization
   transition (revoke/restore/expire) moves that version, so the original grant
   stops (`PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_CHANGED`) until the owner
   confirms a fresh grant — "source changes require new authorization".
3. **Cross-cycle dedup hashes the extracted body text** (`sha256` of the
   normalized extracted text), not raw bytes, so volatile fetch metadata cannot
   fake a change; the capture itself keeps its existing raw `content_hash`.
4. **Run `next_due_at` advances at materialization** to
   `now + 86400s`, keeping intervals ≥ 24h and making catch-up bursts
   impossible after downtime.
5. **Calendar card derivation** keys on the run's committed observation and
   re-validates capture/receipt/resource availability, so deleted or
   deauthorized source content never reappears and unchanged cycles create no
   card.

### Scope-consequence edits (outside the listed scope patterns, flagged)

- `apps/web/lib/time-workspace.ts`: one additive `TIME_KINDS` label entry
  (`public_source_update`). Required because `TIME_KINDS` is
  `Record<TimeActivityKind, string>` and the parent-settled design mandates
  extending `TimeActivityKindSchema`; without it Web typecheck fails.
- `scripts/check-architecture-boundaries.mjs`: advanced
  `FROZEN_MIGRATION_COUNT`/`FROZEN_MIGRATION_DIGEST` for the appended
  `099_person_source_sync` migration. This is the repository's established
  same-change workflow for every appended migration (see history of this
  script) and is required for the `pnpm docs:check` delivery gate; the parent
  review remains the independent freezing step.

## Evidence (actually run in this worktree)

- `pnpm --filter @talent-signal/contracts build` — pass.
- `pnpm --filter @talent-signal/backend exec vitest run src/modules/personSourceSync
  --maxWorkers=2` — 14 unit tests pass; the 11-case isolated-PostgreSQL suite
  `personSourceSync.integration.test.ts` is correctly skipped (no local
  database here).
- `pnpm --filter @talent-signal/backend exec vitest run src/modules/research.test.ts
  src/modules/sourceLifecycle.test.ts src/modules/sourceAuthorization.test.ts` —
  32 tests pass (includes new recurring-hook, unchanged-cycle, recovery-skip and
  sweep-order cases).
- `pnpm --filter @talent-signal/web exec vitest run
  components/relationship-workspace/person-source-sync-control.test.tsx
  --maxWorkers=2` — 8 tests pass.
- `pnpm --filter @talent-signal/web exec vitest run components/time-workspace.test.ts
  components/time-workspace-views.test.tsx app/api/time
  lib/server/timeWorkspace.test.ts components/relationship-workspace` —
  10 files / 118 tests pass (includes new composer, route, wrapper and view
  tests and all pre-existing time workspace tests).
- `pnpm --filter @talent-signal/backend typecheck` — pass.
- `pnpm --filter @talent-signal/web typecheck` — pass.

## Remaining acceptance (parent-owned)

1. Provision a disposable LOCAL PostgreSQL and run
   `pnpm --filter @talent-signal/backend exec vitest run src/modules/personSourceSync
   --maxWorkers=2` with `TIME_WORKSPACE_TEST_DATABASE_URL` set. The integration
   suite covers: duplicate-replica single dispatch/capture, unchanged vs changed
   bodies (calendar card counts), pause/resume/expiry (no revival), one-live-
   grant + owner/account isolation, same-cycle restart replay without duplicate
   captures, pause/revoke concurrency against the real lineage revoke path at
   late commit, person archive + account retirement, attempt counting before
   fetch, 3-attempt/15-minute exhaustion with DB-only receipts, honest unknown
   readback that blocks new cycles, source-deletion redaction + delete receipt
   replay, mutation idempotency/intent conflicts. These tests were written but
   NOT executed here (no database available).
2. Real test-workspace acceptance (`capir test create … --preset daily --open
   web`) per the plan's validation sequence: synthetic person + author public
   page, create grant (30-day expiry), let one real due cycle run, inspect
   run/observation, pause/resume, revoke source authorization, restart mid-cycle,
   delete grant, `capir test stop` cleanup. Not started (browser/test-space
   access is parent-owned).
3. Full test suites, current CI, build, deployment of affected resident
   services from clean committed source (backend + web) and live revision
   checks. `apps/backend/AGENTS.md`'s TestFlight redeploy step is parent-owned
   per the delegation contract (no deploy from this worker).
4. Independent review of the flagged scope-consequence edit
   (`apps/web/lib/time-workspace.ts` label map) and of decision 1
   (recurring-recovery ownership).
5. Linear state and GET-131 closure remain parent-owned; this plan is not a
   Done claim.

## Unknowns kept visible

- The exact multi-replica deployment topology is still parent knowledge; the
  design is safe either way (DB-claimed runs, unique cycle keys, leases).
- The recurring loader's pinned primitive restricts redirects to the same
  origin (stricter than the one-shot loader's same-host rule). This is
  intentional per the parent correction but should be named in review.
- `research_tasks` provenance uses the stamping convention (original grant
  actor/time + `authorization_scope` naming the grant id) rather than new
  columns; a formal "granted at" field can be added later without breaking the
  frozen run request.

## Repair checkpoint 2 — B0/B1/B2/B3 backend fixes (worker evidence)

PostgreSQL time semantics evidence (parent-verified official docs):
https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT
— `now()`/`transaction_timestamp()` are fixed at transaction start;
`clock_timestamp()` advances during the transaction. This is the basis for
B1, not a source-observed regression.

**B0 (real PG red)** — `personSourceSync.ts` `GRANT_COLUMNS`/`GRANT_SOURCE_JOIN`
used the reserved keyword `grant` as a table alias; renamed to `sync_grant`
with every dependent WHERE/ORDER/FOR-UPDATE expression (JS identifiers
untouched). This was only visible against real PostgreSQL; the 11-case
integration file is the regression gate and has NOT been re-run by this
worker (no DB here) — parent re-runs it.

**B1 → `cycleAdmissionRow`, `createPersonSourceSyncCycleHooks.commitPage`,
`.finalize`, claim (`runOnePersonSourceSyncCycle`), `reconcileExhausted-`,
`materializeDuePersonSourceSyncs`, `liveResearchJob`,
`personSourceSyncAuthorityGate`** — every post-lock lease/deadline/expiry
fence now evaluates `clock_timestamp()` (live), including SQL-computed
`grant_expired`/`authorization_expired` flags. `commitPage` revalidates
admission immediately before the protected capture write and the final run
receipt UPDATE is fenced by owner + live lease + immutable deadline with an
affected-row check (0 rows ⇒ abort ⇒ new capture rolled back; earlier
committed pages preserved as partial). `finalize` uses the same fence/row
count; it throws only BEFORE writing (stale owner), never after writing the
truthful receipt.

**B2 → `runPublicResearch` (+ `assertPublicHostname` injectable
`hostnameLookup`), `admitRecurringCycle`, hooks `admit()`/`boundary`,
`runOnePersonSourceSyncCycle.guardedLoader`** — the immutable absolute cycle
boundary (`created_at+15min`) plus a live `admit()` hook pass through the
existing research entry and re-fire after the awaited `loadSeed` read and
immediately before the real DNS lookup and before the research lease claim.
`guardedLoader` recomputes remaining budget AFTER the awaited authority read
and caps transport by `min(12000, remaining_ms)` at the last moment. One-shot
path unchanged (no admission, default lookup).

**B3 → `RecurringCycleOutcome` (hooks `finalize` return), `runPublicResearch`
completion transaction, `mapRecurringCycleOutcome`, `runOnePersonSourceSyncCycle`
metrics** — the authoritative cycle outcome now governs research_tasks status,
idempotency `response_body`, the audit record (`person_source_sync.cycle_settled`
for recurring) and the returned API body in the SAME transaction; `skipped`
maps honestly to `partial`/`failed` in the existing response schema with the
fixed warning, committed pages preserved. Sweep metrics read the terminal run
row (`partial` bucket added) so no surface reports completed for a stopped
cycle.

Worker verification (focused, maxWorkers=2): personSourceSync unit 22+
(new B1/B2/B3 harness cases) + research 35 (incl. B2 DNS-spy/admission-order
and B3 body/task/idempotency/audit propagation) + sourceLifecycle /
sourceAuthorization / timeSchedules / schema regressions all pass; backend
typecheck, web typecheck, web control tests (26, parent-owned), docs:check and
`git diff --check` pass. Isolated-PG cases (two-client BEGIN-before-deadline
barriers, lease-expiry-during-lock-wait, B3 deadline/authority-loss agreement
via real `runPublicResearch`+real hooks, B2 DNS-spy/no-research-lease and
budget-capped transport, plus all prior R1–R7 regressions) are written in
`personSourceSync.integration.test.ts` and remain UNVERIFIED here (17 skipped
without `TIME_WORKSPACE_TEST_DATABASE_URL`); parent runs them on the
disposable PG18 database.


## Parent integration and real PostgreSQL verification

The implementation was fast-forwarded onto `dbe187e0` (GET-128 delivered main).
All 37 feature-file hashes before/after integration matched. The subsequent CI
change explicitly includes the real PostgreSQL integration file in its existing
authority step (maxWorkers=1), rather than relying on the default skipped run. No concurrent
owner files were overwritten. The earlier worker-only claims above describe
historical checkpoints; the following parent evidence supersedes their missing
PostgreSQL status, not the remaining release gates.

Parent fixes include historical operation replay before NEW expiry validation;
one visit per cycle per bounded sweep while allowing other due grants;
retired-account exclusion plus the active-account transaction fence; a final
capture write fence covering lease/deadline/grant/source expiry; authoritative
late-completion status; admission after awaited authority and inside the
research lease transaction; and exhaustion recovery preserving only actually
committed, currently accessible page pointers and the partial count.

Actually executed on an owned, isolated PostgreSQL 18 loopback database:

- Final `personSourceSync.integration.test.ts`: **28 passed**, no skips.
  Includes two-client deadline/lease lock barriers, four capture-creation
  expiry boundaries, actual awaited authority/idempotency SQL boundaries,
  expired historical create/pause replay, fairness across due grants, real
  capture-then-finalization-crash recovery, and available/deleted/revoked
  recovery evidence. No model or remote page request was used by these tests.
- Broadened person-source-sync/research/source-lifecycle/source-authorization:
  **89 passed** at the preceding 26-PG-case snapshot; the two added redaction
  variants then passed in the final 28-PG suite. These counts are distinct.
- Backend typecheck, `pnpm docs:check` (103 immutable migrations), and
  `git diff --check`: passed after main integration.
- Frontend protocol/control/page/app composition: 65 focused tests passed at
  the preceding frozen UI snapshot; later unknown replay additions passed
  their 26-control suite and final two-proof subset. Web typecheck and focused
  ESLint passed. The eight parent UI files remain hash-identical.

Independent review uses the UI-C1..C6 and backend R1/R4..R7/B1..B3 findings;
all confirmed issues must be closed before release. Formal logs/review receipts
are retained in the task's private evidence directory. CI on the eventual PR
head, normal merge, immutable resident Web/backend deployment, real HTTPS
synthetic acceptance and cleanup remain required. No real 24-hour elapsed
recurrence is claimed. DB-unresolved nonterminal cycles block materialization;
settled terminal unknown is an honest outcome, not permanent suspension.


### Full CI retirement regression and repair

PR #368's first head `4505c7d4` passed the new 28-case PostgreSQL file,
backend unit/build, Web quality, dependency/security/package checks, but the
following Memory integration file failed five expiry cases. The global source
expiry sweep selected already retired accounts and its idempotency write hit
the retirement trigger, aborting unrelated active-account cleanup. Two real PG
regressions reproduced retirement before and after selection. The expiry
selection now excludes retired accounts and its system transaction takes the
same account SHARE fence before idempotency; only known typed retirement or
stale outcomes are skipped, ordinary DB errors still fail honestly.

A separate actual PG regression showed the preceding compilation queue had the
same retired-queue starvation. Its candidate now joins active accounts while
retaining `FOR UPDATE OF jobs`; existing write fences and ordinary error
propagation remain. Concurrent retirement can still abort the current tick,
with the next tick filtering the retired account; no blanket error swallowing
or complete absence-of-race claim is made.

After the fixes, the combined six-file suite passed **181 tests**: feature
integration **31**, Memory integration **87**, plus focused source-sync,
research and lifecycle unit regressions. Backend typecheck passed. Independent
incremental review closed all confirmed findings. The first head's failure is
retained as evidence; a fresh PR head must pass all CI gates before merge.
