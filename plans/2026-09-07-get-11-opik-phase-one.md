# GET-11: Opik phase-one improvement loop

## Outcome and boundary

Implement the connected correction → frozen case → paired evaluation → bounded
candidate generation → independent verification → delegated release/readback →
observation loop described by [GET-11](https://linear.app/getyak/issue/GET-11).
Local execution remains authoritative when the optional Opik projection fails.
Prompts continue to ship with code; an Opik label never changes running code.

The issue permits private complete-content evaluation and Codex release review
within the owner's delegated scope. Candidate generators and development scorers
have no access to independent holdouts or release credentials. The separately
calibrated final judge receives frozen evaluation material only through the
trusted independent executor; it has no business-action or release authority. No per-case privacy gate is added. Credentials stay
out of evaluation content. The [GET-12 parameter receipt](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-21-get-12/README.md)
now records CNY with explicitly unlimited per-run/monthly money, DeepSeek Flash
and production-inclusive scope. Provider/controller preparation, exact audience
binding and live acceptance remain with GET-18/20. Implementation, deterministic proof and the existing baseline
TestFlight backend update proceed under the current delivery authorization.

## Current evidence

- GET-11 and all ten children were read in the authenticated Linear UI on
  2026-09-07. Scope: GET-13 local-first export; GET-14 private runtime observation;
  GET-15 correction cases; GET-16 paired comparisons and splits; GET-17 budget;
  GET-18 candidate worker; GET-19 independent CI; GET-20 release/readback;
  GET-21 post-release learning; GET-12 execution parameters.
- The implementation used `/Users/cubxxw/data/talent-signal-get11`, branch
  `codex/get-11-opik-phase-one`, initially based on `9041aaa3`. The CI repair
  and delivery-record branches each start from freshly updated main. Current
  delivery-record branch: `codex/get-11-delivery-receipts`, base `2b712e62`.
  Concurrent GET-8 changes in the original worktree remain outside this task's ownership.
- Existing private Opik at `http://localhost:5173/api` responds with version
  `2.2.45`. Existing containers and volumes are reused, not redeployed.
- Node dependencies installed with the frozen lockfile. Opik SDK is pinned to
  `2.2.45`; repository minimum Node version is `22.19.0`.
- GET-13's remote preflight dependency is removed: immutable local completion
  precedes optional projection, and typed retries do not execute another model.
- Existing GET-5 feedback and Lab reruns will be extended, not replaced.
- Projection recovery and deletion were exercised against the existing private
  instance with synthetic data and zero model calls. The backend's pre-existing
  unhealthy state was repaired by restarting only that process, preserving volumes.
- Native correction entry, authenticated feedback/Lab integration, source
  invalidation, SQLite budget and shared production candidate configuration are
  implemented. Simulator and isolated PostgreSQL tests cover their state transitions.
- Both independent reviews closed their confirmed P0/P1 findings, including
  deletion/late writes, crash remnants, cross-device retry, private demonstrations,
  unknown budget usage, reviewer independence and actual release scope/build.
- Native feedback and Lab: 21 Simulator tests passed. Isolated feedback lifecycle:
  11 PostgreSQL tests passed. Private Opik observation: two traces/ten spans and
  image content read back, then deletion confirmed; earlier probe cleanup also
  completed. The fixed eight-group CI verification passed with no paid credentials.

## Ownership

One shared isolated worktree has non-overlapping owners. Root owns integration,
CLI coordination, dependency/CI edits, docs, real-surface verification and final
synthesis. Workers own projection recovery, feedback/Lab, SQLite budget ledger,
optimizer/product adapter, paired/independent release contracts, and observation
outbox/runtime integration respectively. Independent review follows integration.

## Milestones

1. **Complete:** retrieve scope, preserve concurrent work, identify instance and
   missing execution parameters.
2. **Complete:** implement each bounded slice with real entry-point tests and
   durable failure/retry/deletion evidence; integrate shared contracts.
3. **Complete:** task-level CLI, semantic/release controllers,
   source-lifecycle bridge, credential-free CI and private runtime-content readback.
4. **Complete:** verify implementation and main-branch delivery. [PR 153](https://github.com/getyak/talent-signal/pull/153)
   merged as `5dffa3d32dd41da79663afbd33faa28a00b85981`; its baseline backend
   deployment passed all 35 scoped readback checks, and TestFlight v0.1.64 /
   build `20260907152335` was confirmed processed for that revision. The
   installed-artifact check is not authenticated running-API configuration proof.
   [PR 155](https://github.com/getyak/talent-signal/pull/155) then repaired Swift
   CodeQL build duration and one enclosing test deadline. It merged as
   `2b712e62c7a4894ea60c7c1b398ecfc994d1c0e9` after independent actual-diff
   review with no confirmed open P0/P1, complete PR CI and real final-head
   Swift analysis passed. All 158 iOS product Swift compile paths were verified;
   Release build, 532 Debug unit tests, nine UI smoke tests and 201 runner tests
   passed. The latest tested and merged trees are identical.
   Main CI `34148228404` passed, including iOS smoke. Release classifier
   `34150103081` verified the same SHA and correctly required no new TestFlight
   build. Actual main Security `34148228407` also passed, including successful
   Swift build, Analyze and processed analysis `1737292249` on the merge SHA,
   with no Swift errors, warnings or results.
   The [delivery recovery record](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-07-get-11-opik/delivery-recovery.md)
   owns failure history, exact receipts and coverage limits. Delivery-record
   [PR 157](https://github.com/getyak/talent-signal/pull/157) also corrects one
   enclosing five-behavior controller/replay test deadline after its own CI
   exceeded five seconds; its updated review and latest-head hosted checks
   remain the gate for that follow-up, with final receipts maintained on the PR.
   GET-13/14/15/16/17/19 are Done with acceptance receipts. GET-11 remains
   In Progress with GET-12/18/20/21 unaccepted; an integration's automatic
   Done transition after PR 155 was restored to the actual acceptance state.
5. **Pending:** funded real optimization and scoped release/rollback using the
   recorded GET-12 parameters; report any unavailable external proof honestly.

The current user has authorized branch publication, PR creation, remediation,
merge after all applicable checks pass, and closing corresponding Linear issues
only after their actual acceptance conditions are met. The monetary parameter
request was answered on 2026-09-21; this does not certify funded optimization or block the existing baseline
TestFlight implementation deployment. Do not use a PR closing keyword to
prematurely complete GET-11's unobserved live-optimization acceptance.

## Completion evidence

Require immutable local results during Opik outages, export-only replay without
new model calls, complete source/attempt/version lineage, atomic concurrent
budget reservations, unknown billed outcomes retained, frozen and independent
validation, critical-regression vetoes, stale-decision rejection, loaded-version
readback for release/rollback, and feedback deletion winning late results.
Synthetic provider checks prove plumbing; they do not prove paid-model semantic
quality or a production release. Record reviewed evidence under
`docs/evaluations/2026-09-07-get-11-opik/` and run `pnpm docs:check`.
