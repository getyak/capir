# GET-9: shared Claude Agent SDK harness

## Outcome and authority

Implement [GET-9](https://linear.app/getyak/issue/GET-9) across Web, iOS and
Chrome capture: Claude Agent SDK owns planning, tool iteration, multimodal
understanding and work continuation. Product services own account scope,
canonical contacts/Memory, approvals and observed effects. Natural conversation
does not require model-authored JSON; durable writes use typed product tools.

The issue was read from the authenticated Linear desktop application on
2026-09-09. Its embedded credential is deliberately excluded from this plan.
The requested gateway is `https://api.hao.ai/anthropic`, with the requested
model identifier `anthropic/claude-sonnet-5.0`. These are configuration inputs,
not verified capability, price, or provider-identity claims. Verify actual SDK
compatibility with synthetic inputs before admitting private evidence.

## Baseline and findings

### Requirement completeness correction — 2026-09-10

PR #172 merged as `65afe690`; its tree matches the deployed `cc1220`.
An independent review against the original issue found missing scope despite
passing PR gates. Follow-up branch `codex/get-9-harness-completeness` starts
from that merged main. GET-9 remains In Progress.

1. **Implemented; Web acceptance passed, native/extension pending:** provide bounded original-image region reads and clear long-image
   tiles with coordinates/hash provenance, running-task authority and no new
   image retention; verify profile, direct/group/forward and comments classes.
2. **File/computation and browser implemented; browser verification active:** admit scoped capabilities.
   Screenshot source-review delegation is implemented and independently verified
   through the real product SDK path; file/computation has live product and Web
   and native saving proof. Browser has actual SDK/HTTP/socket/Chromium/PG proof;
   dedicated-daemon boundary/recovery passes; production admission remains open. Verify
   invoked capabilities, delegation isolation, budgets and recovery rather
   than counting configurable interfaces as delivery.
3. **Implemented; Web acceptance passed, native/extension pending:** durable Memory-to-original-image
   traversal passes a real fresh-session HTTP/SDK/PG scenario and revoked-source
   denial. Independent quality 4/4/4; recovery not exercised. See the
   [Memory-image review](https://github.com/getyak/capir-evals/blob/main/evidence/get9-harness/completeness-memory-image-review.md).
4. **Pending:** independent review, new-head CI, merge, deployment and exact
   VALID TestFlight release/readback. Preserve the pending installed-Chrome
   permission boundary and previously reviewed README correction.

Apply the original-requirement completeness check in [REVIEW.md](../REVIEW.md).
The dated [image capability evidence](https://github.com/getyak/capir-evals/blob/main/evidence/get9-harness/completeness-image-review.md)
retains failed attempts and the distinction between unit, real SDK and full
product acceptance. Prior failures remain evidence; no threshold relaxation or
guessed completion is permitted.

Image implementation references: [sharp constructor limits](https://sharp.pixelplumbing.com/api-constructor/),
[extract coordinates](https://sharp.pixelplumbing.com/api-resize/#extract),
[MCP image content](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).
Use pinned sharp `0.35.4`, already present transitively, as a declared dependency.
SDK subagent reference: [scoped SDK agents](https://code.claude.com/docs/en/agent-sdk/subagents).

- Isolated worktree: `/Users/cubxxw/data/talent-signal-get9`.
- Branch: `codex/get-9-harness`; initial upstream baseline: `56292d3c`.
- `apps/agent` pins Claude Agent SDK `0.3.260`. `claudeProvider.ts` disables
  images, SDK persistence, Skills, subagents and all built-in tools. It expects
  terminal JSON for every run and only selects pursuit/public-research schemas.
- Natural chat uses a separate Zhipu completion loop. Screenshot contact tasks
  always call `extract()` before their independent model/tool loop; subsequent
  decisions cannot inspect the original image.
- Existing product services already enforce account identity, reviewed writes,
  source deletion, idempotency, task leases and destination receipts. Preserve
  these boundaries while replacing model orchestration.
- Agent-host owns public search/profile credentials. Infisical is the canonical
  store; `/operations` contains the Linear integration credential.
- Both prototype browser-extension and integrated Chrome-extension directories
  exist. Validate the integrated product path, without mistaking fixture-only
  tests for cross-surface production proof.

## Scope and approach

Use one injectable SDK execution primitive, explicit server-owned configuration,
typed tool registration, cancellation/budgets, natural text output and image
inputs. Product adapters supply scoped tools and verify every effect at the
tool entry point. Curated Skills and focused subagents load by capability;
ambient user plugins, credentials and filesystem access do not become product
permissions. Tool errors return actionable observations to the SDK loop.

SDK continuation is account/session-bound working context, with invalidation
on revoked/deleted sources. Long-term product Memory remains provenance-aware
database state; a new Session can retrieve it without the old transcript.
Screenshot understanding starts with original images and user intent. OCR is
optional, and extraction remains an unconfirmed, reviewable artifact.

Reject a second planning loop around the SDK, a separate Memory platform,
unrestricted host shell/browser access, silent provider fallback and relaxation
of safety checks to improve evaluation scores. External messages and calendar
writes retain exact-effect human authorization.

## Milestones

1. **Complete — design and baseline:** map six issue scenarios to current paths,
   verify SDK/gateway interfaces, record a concrete design and evaluation rubric.
2. **Implemented, verification active — shared runtime/configuration:** SDK executor, scoped capability
   registration, original-image support, work continuation and provider probes.
3. **Implemented, surface acceptance active — product adapters:** migrate conversational and screenshot flows,
   connect Memory/research/calendar draft tools, verify Web/iOS/Chrome contracts.
4. **Active — evaluation and independent review:** execute synthetic adversarial
   and real-model cases, fix failures, review consequential boundaries and close
   all confirmed P0/P1 findings with reviewer readback.
5. **Pending final acceptance — delivery:** draft PR178 linked to GET-9, latest-head CI and repository
   gates, merge/readback, local TestFlight backend deployment and applicable
   post-merge proof, then Linear completion/readback.

## Evaluation contract

| Case | Required observation |
| --- | --- |
| E01 | Natural supportive response using authorized history; no forced contact workflow or fabricated memory. |
| E02 | Original social-profile image reaches main Agent; editable contact draft accurately cites name/company/account. |
| E04 | Stable account clue resolves existing person; person count unchanged and relationship Memory preserved. |
| E05 | Autonomous search/read handles current official source, old interview and namesake; cited draft distinguishes time and identity, with no confirmed-state overwrite. |
| E07 | Fresh Session retrieves sourced commitment and response preference from durable Memory without old dialogue in the request. |
| E10 | Frozen reference date 2026-09-09 and Asia/Shanghai produce 2026-09-10 15:00–15:30 draft; no external write before confirmation; verified receipt after confirmation. |

Each scenario must pass deterministic state invariants and a repeated live-model
trial. Score task completion, grounding, naturalness and recovery independently
on a published 0–4 rubric, targeting at least 3 per dimension with no safety
failure. Report actual attempts, variance, failures and missing evidence;
synthetic fixtures and mocked SDK results are not live quality evidence.

Adversarial coverage: namesake ambiguity, injected image/web instructions,
unauthorized scope/tool, missing/revoked credentials, provider mismatch,
timeout/cancellation, malformed output, stale/deleted source, duplicate request,
resumption after interruption and unknown external result. Checks include
`pnpm eval:ci`, relevant agent/backend/client tests, `pnpm docs:check`, SDK
gateway probe and real-surface evidence. Additional checks follow changed paths.

## Current delivery state (2026-09-10 07:03)

- PR172 at `630961ea` passed all applicable CI, including iOS, but four unresolved
  GitHub review threads prevented merge. Auto-merge was disabled while repairing
  two confirmed P1s and two P2s; old green checks do not cover the new delta.
- Request-specific calendar clocks now live in current context, outside stable
  prompt/tool fingerprints. The real Hao SDK resumed one identity across three
  turns, recalled an earlier synthetic code without resupplying it, and staged
  the correct 2027-01-01 calendar draft from the year-end request clock.
- All Calendar confirmation paths honor sync-off. Protected, backup-excluded
  endpoint/account/user stores replace global candidate scheduling details.
  Expiry and sign-out remove details while retaining content-free duplicate
  guards; retrying an old sign-out preserves newer receipts. The native delta
  passes 47 unit tests and two actual confirmation/sync-off UI paths.
- Chrome preserves minimal recovery identity before submission and after success,
  including when panel replies are lost. Restart recovery uses an authenticated,
  read-only lookup by the original key, with no retained pixels or resubmission.
  The bounded local journal keeps up to 20 records for 30 days; only completed
  records may be evicted for capacity. Unknown writes remain protected.
- Agent 158 plus one explicit skip, PostgreSQL screenshot/recovery tests 18/18,
  and extension contracts 41/41 pass. Independent review closes all four findings;
  final delta has no remaining confirmed P0/P1. Latest-head CI is still required. See [PR review verification](https://github.com/getyak/capir-evals/blob/main/evidence/get9-harness/pr-review-verification.json)
  and [independent review](https://github.com/getyak/capir-evals/blob/main/evidence/get9-harness/pr-blocking-review.md).
- Earlier E01/E02/E04/E05/E07/E10 rubric batches remain historical checkpoints,
  not new scores for this delta. The real clock probe and native tests establish
  their stated paths only; earlier failures are preserved.
- TestFlight backend currently reports `630961ea` with immutable image
  `sha256:43eeb04c97f006340ed52f62d523c33f773ac129d177214d091ae5f6cf6990da`.
  Commit/review this delta, redeploy, re-run exact-head gates, merge and verify
  the main-branch iOS release before delivery completion.
- Installed Chrome handoff remains an unverified manual browser boundary; do not
  bypass the pending installation permission. Physical TestFlight use also
  remains unverified. Keep GET-9 In Progress until its acceptance is complete.

## Implementation checkpoint (2026-09-09)

- `claudeHarness.ts` now owns one SDK loop with natural text or opt-in artifact
  schemas, original image blocks, curated plugin Skills, read-only subagent
  tool subsets, isolated temporary HOME/configuration/debug output, usage and
  tool budgets, cancellation and cleanup. Product request adapters are still
  being completed; this is not yet the sole deployed execution path.
- `claudeHarnessConfiguration.ts` validates endpoint and exactly one auth mode;
  its diagnostic receipt excludes credentials. The existing dev Anthropic key
  targets a different gateway. Staging `/shared` has no Anthropic/Claude key.
  The credential supplied in GET-9 was securely imported into the new
  `dev:/shared:HAO_ANTHROPIC_API_KEY` variable. The one-time loopback import
  helper kept the value out of commands/logs, removed its mode-0600 temporary
  file, and shut down. This dedicated key is required for the Hao endpoint;
  generic credentials from the other gateway are never reused there.
- `ClaudeChatProvider` is selectable with `TALENT_SIGNAL_CHAT_PROVIDER=claude`.
  It preserves the product's contact proposal/selection receipts while allowing
  model prose. Prompt/evaluation metadata and observation integration still need
  completion before production selection.
- `ClaudeContactAgentModel` plus the `runSDK` backend branch remove the external
  model planning loop and compulsory OCR pass. The Agent records per-image
  understanding through a tool; existing deterministic merging preserves
  cross-image identity conflicts. All product operations retain transaction,
  source and lease gates. Lease renewal is independent of slow public reads.
- Independent reviews found and fixed two primitive P1s (post-authority
  cancellation and terminal-only token-budget checks) and two screenshot P1s
  (flattened multi-image identity and lost execution signals in queued tools).
  Core and screenshot fixes independently rechecked and closed.
- New focused Agent tests: 13 passed across four files. Agent-wide tests at an
  earlier checkpoint: 108 passed, 1 skipped. Backend typecheck passed before
  latest regression additions. Re-run the relevant full checks at final head.
- Real PostgreSQL screenshot integration: **12/12 passed**, including SDK
  no-OCR/reuse, conflicting image/resume denial and queued write cancellation.
  Dedicated disposable database: container `ts-get9-harness-eval`, loopback
  port `32773`, synthetic `get9_eval` database. It uses tmpfs because the first
  disk-backed attempt timed out on initial schema creation. No production data
  or database was used. Remove this task-owned container after verification.
- `pnpm eval:ci` exited 0; its existing proof still reports
  `releaseReadiness=needs_review`. Log: `/tmp/get9-eval-baseline.log`.
  `pnpm docs:check` passed. Test-generated historical runtime timestamps were
  restored rather than included as a product change.
- Linear API credential in `dev:/operations` belongs to the DayPage workspace,
  not GetYak. GET-9 was read through the authenticated native Linear app; use
  that app for issue status/readback until a correct connector is available.

### Profile and client checkpoint

- Added profile-only understanding and an editable source-linked `contact_draft`.
  No contact/capture is written until the dedicated human
  `/profile-confirmation` route receives the exact current revision and decision.
  Agent tools cannot invoke that route. Explicit selected scope is preserved.
- Confirmed account matches are rechecked inside the save transaction. Existing
  people are reused; same-name ambiguity returns candidates; competing confirmed
  account owners block the write. Edits are recruiter-reviewed contact-field
  evidence; original image excerpts remain separate and no fake chat messages
  are created. Profile filing does not overwrite product Memory.
- Web and iOS now offer editable name/company/account fields and exact sources.
  iOS dispatch reuses existing task-owner/cancellation checks. Browser extension
  still blocks real image handoff; its fixture-only packaging is insufficient.
- Independent review found one profile P1: mixed-platform account namespaces
  could be flattened to the first image platform. Cross-platform batches are now
  rejected before drafting; UI shows the platform. Reviewer closed the P1 and
  independently passed the three pure provenance regression tests. No other
  P0/P1 found in this slice; this is not full GET-9 review.
- Latest local screenshot integration: **13/13 passed** after explicitly warming
  four test database connections. First Docker forwarded-port connection was
  measured at 8,204 ms while a query took 142 ms. Five-second business-test
  limits remain unchanged. Independent full runs still had timing failures
  (6/12 and later 9/13; assertions in the new profile case passed). The iOS
  compiler ran concurrently with the latest independent DB run. Re-run with
  exclusive machine resources; do not report the independent runs as green.
- Agent/backend/Web typechecks passed before the newest platform display change;
  rerun final-head checks. iOS localization check passed; `pnpm ios:check` is
  running with log `/tmp/get9-ios-check.log` (session 56297). It uses the standard
  machine-wide lock and disposable derived data. New localizations preserve the
  original catalog order. No production configuration or secret was changed.

### Remaining implementation gates

1. Profile screenshot drafts now have a dedicated human confirmation path and
   Web/iOS editing. Complete client visual/interaction proof, more conflict and
   source-lifecycle regressions, and the integrated Chrome image handoff.
2. Scoped durable SDK continuation requires an account/owner/session/provider
   configuration/source-generation mapping, an atomic tombstone, cancellation
   and physical cleanup of local, mirrored and subagent copies. Do not enable
   `persistSession` ahead of these gates. SDK SessionStore is dual-write.
3. Wire durable sourced Memory, account response preference and calendar draft
   tools, then verify their real client paths and destination receipts.
4. Complete evaluation metadata/Opik parity and actual gateway probes before
   selecting the new runtime in deployment; run all six live scenarios and
   cross-surface proof before PR delivery.

### Frozen quality rubric

Run each of E01/E02/E04/E05/E07/E10 three times against the same synthetic
fixture and configuration snapshot. For each dimension, 0 means absent or
contradictory, 1 materially incorrect/incomplete, 2 useful but requiring a
substantial correction, 3 correct with only minor friction, and 4 complete and
clear without material correction. Apply these anchors independently to task
completion, source grounding, conversational clarity and recovery. A scenario
passes only if every trial scores at least 3 in every applicable dimension and
all deterministic safety invariants pass. Mark non-applicable dimensions with
the reason instead of assigning free points. Report retries and all first-run
failures; no safety failure may be averaged away. An independent reviewer
checks the frozen inputs, tool receipts, responses and scoring rationale.

## Sources

- [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [SDK loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- [SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- Installed SDK TypeScript declarations are the version-specific API authority.

### Gateway verification checkpoint

- Linear GET-9 is now **In Progress**, read back from the authenticated native
  app. No issue completion is claimed.
- Hao credential import succeeded and metadata-only readback confirmed the new
  variable is available. Active production provider/model settings are unchanged.
- The issue's `anthropic/claude-sonnet-5.0` identifier returned HTTP 404
  `model_not_found` twice. [Hao's current catalog](https://hao.ai/models/category/chat)
  names the same Sonnet 5 model `anthropic/claude-sonnet-5`. This is an explicit
  identifier correction, not an automatic provider/model fallback.
- Corrected native Messages request returned HTTP 200, `model=claude-sonnet-5`,
  synthetic output `OK`, 52 input and 4 output tokens, request ID
  `msg_011Cesr7W4htgtUvCgt1Njuj`. No private source was sent.
- `scripts/evals/probe-claude-harness.mjs` now tests an unpredictable synthetic
  tool receipt through the real SDK loop, recording requested and reported model
  identifiers separately. The first run passed: one tool call, exact unpredictable marker returned,
  1,727 input / 63 output tokens, 32,655 ms, SDK estimated cost USD 0.004084
  (not the gateway invoice). Log: `/tmp/get9-hao-sdk-probe.log`. The SDK usage
  map labels its entry with the requested model alias; subsequent probes collect
  `assistant.message.model` separately instead of calling a usage-map key an
  actual provider model. The probe never exposes credentials or response prose.
- Official protocol reference: https://hao.ai/docs/api/anthropic/messages .

### Continuation and evaluation checkpoint

- Agent-wide regression: **120 passed, 1 skipped**. Lab configuration: **13/13**.
  Backend typecheck passed before the latest host-commit rollback addition.
- Natural prompts remove only the exact formal legacy JSON transport clauses;
  frozen Lab presets use the same effective text/hash as execution. Trials retain
  requested and reported model names separately, allow only the verified Hao
  namespace alias, reject substituted models, and report SDK transport attempts
  as unknown. SDK response count is not labeled request count.
- Policy-gated private observation now records each SDK assistant receipt once
  by message ID, preserves provider usage, and treats MCP `isError` as a tool
  failure. These are receipt-time events, not measured network latency; absent
  per-request inputs/retries/cost remain unavailable. Root and product source
  lineage use the existing outbox deletion mechanism. Independent review found
  no P0/P1 in this slice. Partial usage on nonterminal SDK interruption remains
  a P2 limitation; failed terminal results already retain usage/classification.
- Repeated real Hao SDK tool probe passed with reported `claude-sonnet-5`, one
  exact marker tool receipt, 1,728 input / 69 output tokens, 44,529 ms, SDK cost
  estimate USD 0.004146. Log `/tmp/get9-hao-sdk-probe-final.log`.
- Real two-turn SDK continuation probe passed: the second request contained no
  previous code, the same SDK Session recalled it exactly from 16 mirrored
  entries, and no task-owned resumed transcript remained on disk. Total 13,639 ms;
  runs used 340/5 and 459/27 input/output tokens. Log
  `/tmp/get9-hao-continuation-probe.log`. The mirror in this probe is synthetic
  in-memory storage; separate PostgreSQL lifecycle tests cover persistence.
- Added host-issued continuation leases and an account/user/product-Session/
  configuration/scope/generation-bound PostgreSQL SessionStore. Mirroring shares
  the product transaction; savepoints discard failed turns while preserving the
  last committed checkpoint. A transaction advisory lock permits one writer;
  short final source/session fences close the validation-to-commit race.
  SDK UUIDs are server-owned. Entry retries are deduplicated and conflicting
  UUID bodies rejected. Main/subagent copies share bounded retention and purge.
- Migration 058 conservatively invalidates account SDK derivatives on source
  correction/revocation/deletion; product Session deletion, old-turn removal,
  scope changes and expiry erase copies. No product Memory is deleted by this
  cache invalidation. A host-provided source expiry further limits retention.
  Dedicated PostgreSQL tests passed **4/4**, and combined with Lab **17/17**.
- Pinned SDK source inspection found resume materialization ignores subprocess
  TMPDIR and writes a parent-temp `claude-resume-*` copy. Resume now uses SDK
  `startup()` and its awaited async disposer, tracks this run's SessionStart
  path, and explicitly removes that copy before releasing the host lease.
  See the crash recovery checkpoint below for subsequent ownership/purge proof.
- Web/iOS text Chat host paths are being wired to this store; raw-image
  persistence remains unadmitted until full media lineage/cleanup proof. No
  deployed provider selection changed. Product-level rollback and independent
  persistence review have since passed; overall acceptance remains pending.
- `pnpm ios:check` remains running (session 56297). Three failures observed so
  far: AgentSourceImport contact-file review (line 27), authentication error text
  (line 63), and pending screenshot discard button (line 927). One AnswerFeedback
  test skipped because its owned proof server was absent. Preserve the full
  results and diagnose; do not call the suite green. Result bundles are under
  `/var/folders/qk/yyffbdsn4gz71wd9gf_3rb8r0000gn/T/talent-signal-ios-results.DYqvLK`.

### Identity, crash recovery and verification checkpoint

- Reviewer identified and closed the identity-lifecycle P1 after migration 059
  added handle/profile invalidation and every continuation capability checked
  dynamic person identity deadlines. Seven independent PostgreSQL tests passed,
  including clock expiry without a worker, rebinding purge and concurrent
  revocation before the final commit. Source deadlines only shrink.
- A successful SDK result rejected by the product no longer commits a checkpoint.
  The real product transaction regression passed. Claude failures use a local
  unavailable response; a second host-level remote fallback would bypass the
  SDK's source gate and reset its budget. Feedback receipts preserve unreported
  model identity and SDK transport counts as unknown. Combined backend focused
  result: **14/14 passed**, `/tmp/get9-session-focused.log`.
- SDK temporary workspaces now journal their owner, deadline and exact resume
  project before releasing mirrored data. Startup, per-Run admission and a
  service sweep reclaim owned crash leftovers. A live Hao probe SIGKILLed an
  isolated child after SDK resume materialization and before SessionStart:
  one Run directory and one resume directory were present, then zero remained.
  Latest probe: 24,730 ms, 274 input/5 output, SDK estimate USD 0.000598;
  `/tmp/get9-hao-crash-cleanup-probe-final.log`.
- Independent review then reproduced a partial-deletion P1: removing a project
  or owner marker before a permission error destroyed retry ownership. Resume
  roots now retain journaled device/inode identity, and the Run marker is removed
  only after all payload children. Two real permission-failure/recovery tests
  pass; focused Agent result **15/15**, `/tmp/get9-workspace-tests.log`.
  Reviewer independently passed the cleanup/continuation/authority 11 tests and
  unscoped Chat 5 tests, then closed this P1. No new P0/P1 in that slice.
- Real two-turn continuation still passes with ownership tracking: exact recall,
  16 mirrored entries and zero residual resume copies, 26,891 ms total;
  `/tmp/get9-hao-continuation-cleanup-probe.log`. Agent-wide result before the
  final permission-retry patch: **123 passed, 1 skipped**; subsequent full Agent
  rerun passed **125 with 1 skipped**. Backend build/typecheck and docs check pass.
- `project-knowledge-steward` routed the SDK/product ownership distinction,
  identity deadlines, derivative invalidation and crash recovery to the existing
  authoritative `docs/agent-system.md`, replacing the old extraction-loop claim.
  Deterministic counterexamples remain in tests; gateway values remain in this
  temporary plan and secret delivery, not foundational documentation.
- The initial iOS full suite is still running (session 56297), now with at least
  ten failures and one skipped proof-server test. Eight diagnosed test failures
  have patches for the current ephemeral backend port, renamed retention copy,
  stable seeded Session selection and native Back navigation. Contact-import
  fixture presentation now follows its actual import button after navigation.
  These fixes require a rebuilt UI rerun. Completed initial bundles are being
  preserved in `/tmp/get9-ios-initial-results`; the active runner removes its
  original temporary output when it exits. No full iOS pass is claimed.

### Live E01 checkpoint

- Added `scripts/evals/evaluate-claude-conversation.mjs`, using the actual
  workspace conversation core and shared SDK with synthetic dialogue. Each
  attempt retains prompt/configuration/usage/output and requires independent
  quality review. It is not database or client proof.
- First three trials: two deterministic envelope/tool checks passed, one failed
  after 37,023 ms. The failure is consistent with the 35-second workspace budget
  but its original generic error does not prove the cause. All three fail the
  frozen quality gate: independent completion/grounding/naturalness scores were
  3/2/3, 0/0/0 and 2/2/2. Recovery was not exercised, not awarded a fictitious
  score. Preserve [the complete first attempt](https://github.com/getyak/capir-evals/blob/main/evidence/get9-harness/e01-first-attempt.json).
- Revised the shared conversation/workspace prompts to honor a request for
  company, acknowledge only stated experience, avoid diagnosing motives/body,
  and ask at most one easy question. The budget remains unchanged. A separate
  second three-trial run is active: `/tmp/get9-e01-live-revision2.json`, log
  `/tmp/get9-e01-live-revision2.log`, session 12732. It records effective prompt
  hash and safe failure classification; first failures are not overwritten.
- The iOS initial full suite has additional canonical-path failures. Exported
  AX shows `INTERNAL_ERROR`; fixture backend logs independently show PostgreSQL
  `Query read timeout` in authGuard and Session retention sweeping. Readiness
  reports migration 057, as expected for the image built before Session work.
  Only one idle connection and no blocked SQL were visible in a later snapshot;
  sustained database contention is not established. Retain the failures and
  diagnose fixture timing before treating this as a product regression or
  increasing timeouts. Fourteen failures observed by test 084; suite still active.

Next implementation: durable sourced Memory/preference and calendar draft tools,
integrated Chrome image handoff, client profile proof, actual text streaming,
six scenarios with three live trials each, remaining review and latest-head
checks, PR/CI/merge, required TestFlight-local deploy and Linear acceptance.

### Source admission and live conversation checkpoint (21:58 local)

- Independent review identified and closed a P1 where source compilation preceded
  SDK continuation generation capture. `harnessSourceGuard.ts` now captures the
  account generation and Session context stamp before history/snapshot/image
  reads. The shared SDK checks that same admission before observation, startup,
  prompt delivery, tool use/result release and final output, with a two-second
  in-flight recheck. Host and database clocks both enforce source deadlines.
- The reviewer found an additional no-Session identity-expiry gap: observation
  ownership was incorrectly also the owner of dynamic source scope. Ephemeral
  contact reads now add people to a separate Run authority set, even when no
  observation can be retained. Actual product lookup plus clock expiry without
  a worker and shared SDK result withholding are covered. Reviewer closed both
  P1s after independent Backend **16/16** and Agent focused **9/9** checks.
  Root Agent full suite: **128 passed, 1 skipped**; backend typecheck passed.
- The third live E01 attempt passed execution checks but only 2/3 quality trials.
  The fourth passed all three measured quality dimensions in 3/3 trials, scores
  4/4/3, 4/4/3, 4/3/3 (completion/grounding/naturalness). Recovery remains
  `not_exercised`. All four attempts and independent reviews are retained under
  `docs/evaluations/get9-harness/`; no failed attempt was replaced by a rerun.
  Further shared prompt changes still need latest-release validation.
- Added `read_relationship_memory` to natural relationship Chat: it returns the
  already authorized current database snapshot with block status and evidence
  IDs, on demand, independently of Session history. Its fresh-Session unit
  passes. This does **not** complete E07: durable response preference, live
  database/client proof and repeated live-model trials remain outstanding.
- Stopped the owned initial iOS full run after 101 completed parts and an
  interrupted 102nd part (197 UI journeys in the full gate). Repeated canonical
  failures showed backend 500/Query read timeout. Completed results and bootstrap
  failures are preserved under `/tmp/get9-ios-initial-results`, full log at
  `/tmp/get9-ios-check.log`; helper processes/containers were cleaned by the
  runner. No full pass is claimed. Rebuilt focused UI checks remain necessary.
- Concurrent DB tests initially timed out at the unchanged five-second test
  boundary; retained `/tmp/get9-source-guard-backend-during-ios.log`. After
  stopping the failing iOS run, root Backend **16/16** and independent repeat
  **16/16** passed. This association is not proof of the exact infrastructure
  cause. A standalone host-to-DB probe measured 854 ms connect then 1–3 ms queries.

### Memory, preference and deployment checkpoint (22:38 local)

- Added user-owned response preference (migration 060, GET/PUT API, revision and
  idempotency checks, audit/readback, SDK invalidation on reset). Web and iOS
  expose save/reload controls. Only the configured Claude chat adapter admits
  this preference API; a legacy runtime cannot misleadingly report usage.
  Independent checks: DB 1/1, Web 3/3, chat provider 6/6. Real client proof remains.
- E07 now uses real HTTP routes, PostgreSQL, reviewed synthetic source, published
  Memory, persisted preference and three fresh empty Sessions per attempt.
  First quality scores: 2/2/2, 0/0/0, 2/2/2; second: 2/4/2, 3/4/2, 3/4/2.
  All fail at least one dimension. Third attempt has two execution passes and
  one failure; independent review pending. Preserve all artifacts under
  `docs/evaluations/get9-harness/`. Recovery remains `not_exercised`.
- A personal-note fixture variation was rejected by existing intake rules because
  it was proposed rather than explicitly reviewed on intake. No product gate was
  changed. The E07 reruns retain the original conversation source and its
  unconfirmed report status. Prompt changes answer what the record says before
  explaining uncertainty; they do not promote reports to confirmed facts.
- Deployment validation now imports the same configuration-only TypeScript
  authority directly using the repository's Node >=22.19 runtime. TestFlight
  API and person-research containers, and optional production API configuration,
  carry endpoint-bound Claude settings. Hao key is declared in Infisical's
  canonical shared manifest. Staging selection/key import and deployment remain
  pending; no production provider switch has occurred. Deployment/manifest 10/10.
- The artifact adapter now binds configuration at construction from the supplied
  environment; later ambient changes cannot redirect its credential. Original
  images are admitted only by an explicit vision capability. Agent-host uses the
  same validator and rejects ambient OAuth/another gateway's key. Independent
  configuration review found no P0/P1; final image test and typecheck pass.
- SDK interruptions retain unique observed token counts as a lower bound, use
  null for unknown cost/turns, and preserve a safe failure code. Chat Lab evidence
  reads this partial receipt. Related tests 26/26 and new interruption checks
  7/7. Other product aggregate usage paths still require final audit before
  claiming complete failure accounting.
- Focused iOS run (session 44416) passed Release build, completed its backend
  image build and is building Debug tests. The previous compile error used the
  iOS-17 onChange overload despite target iOS 16; corrected to the supported
  single-value overload. Do not claim UI tests have passed yet.
- E02/E04 runner and deterministic synthetic profile image added. Initial fixture
  run stopped before model work because its subject-count query referenced a
  nonexistent kind column (42703); corrected against the actual schema. Second
  run active (session 70318, /tmp/get9-profile-live-second.json/log). Current
  Docker-backed operations are slow during iOS setup; no latency cause is proven.

### Calendar and profile proof checkpoint (23:28 local)

- E07 fourth attempt passed three real HTTP/DB/SDK trials and independent quality
  review (4/4/3 each; recovery not exercised). All prior failures are retained.
- E02/E04 fourth profile attempt completed all six SDK runs. Earlier attempts
  exposed two evaluator sequencing bugs (waiting on SDK/product receipt before
  submitting the current draft revision); their partial results are not quality
  passes. Independent final review lives in
  `docs/evaluations/get9-harness/e02-e04-quality-review.json`.
- E04 supplemental current HTTP Memory readback passes in all three accounts:
  original reviewed source remains active and scoped, current published Memory
  contains the commitment with its same source dependency, and the historical
  snapshot content hash is unchanged after normalizing only the legitimate
  superseded lifecycle field and using the HTTP schema serializer. A complete
  before-row snapshot was not captured in this attempt; do not claim that audit.
  E02 scores 4/4/3/not_exercised; E04 scores 4/4/3/4, with recovery covering only
  the observed CONTACT_UNDERSTANDING_REQUIRED tool rejection and correction.
- Calendar draft tool now uses host reference time, client timezone and literal
  user excerpt; typed drafts carry no execution authority. Web exports only
  title/UTC time through an explicitly downloaded ICS; native confirmation uses
  the existing EventKit service. Title/start/end are editable; original evidence
  remains separate. Web rejects DST gaps/overlaps instead of guessing an offset.
- E10 first and second attempts each had one success and two interruptions. The
  second proves WORKSPACE_CONVERSATION_TIMEOUT at the legacy 35-second outer
  deadline. SDK workspace Chat now uses the existing shared 60-second ceiling;
  legacy adapters retain 35 seconds. Native Chat POST transport now admits 120
  seconds for execution plus cleanup/persistence, while ordinary requests retain
  their previous limits. Third live attempt is running; no repeated pass yet.
- Failed unscoped requests now say they did not complete, rather than replying
  with an unrelated greeting. Backend focused checks 33/33, Web Calendar 3/3 and
  Web typecheck pass. Backend build passes.
- A real Simulator Calendar proof passed using the first E10 attempt's successful
  draft and the production confirmation button/service: independent EventKit
  readback matches title, timezone and 15:00–15:30; count=1; only the owned local
  synthetic calendar was removed and cleanup verified. Artifact:
  `docs/evaluations/get9-harness/e10-native-first-proof.json`. This is component
  projection proof, not a full live Chat UI journey. First native attempt failed
  to handle the OS permission prompt; corrected test passed 6 native unit checks
  plus the real UI proof. Latest receipt/edit changes still need rerun.
- Independent review found and closed duplicate-write-after-unknown and false
  product-save text paths. The native gate now claims an exclusive durable file
  before EventKit; unknown/pending survives reconstruction and does not retry a
  create. Actual successful event payload is now persisted atomically and used
  by saved UI; legacy receipts without payload do not invent title/time. Final
  reviewer closure and latest native tests pending.
- Focused earlier native checks also passed contact-file import, welcome swipe,
  Session menu parity and exact Session delete confirmation. The initial full
  iOS suite remains incomplete; do not claim all iOS gates passed.
- Still outstanding: E05 live autonomous public research, integrated Chrome
  original-image handoff (current legacy path is synthetic/selected-text only),
  full profile/preference/client proof, final prompt reruns and failure usage
  audit, final independent review/CI/PR/merge, staging configuration and required
  local TestFlight deployment. No commit, PR, merge or Linear closure yet.

### Chrome and research checkpoint (2026-09-10 00:00 local)

- Native Calendar fourth verification passed 6 unit tests and the real EventKit
  UI proof after the latest durable receipt changes. Clean before-confirmation
  and independent-readback PNGs are retained with `e10-native-latest-proof.json`.
  This remains one model draft/component proof, not three complete E10 journeys.
- Chrome now explicitly hands reviewed image bytes to the shared screenshot
  task via a same-origin Web tab. Credentials stay in Web. An opaque HMAC binds
  the exact reviewed account/user/token/expiry; POST and readback recheck it
  against the same claims used for upstream authorization. Changed-account and
  same-user-new-login regressions pass 3/3. Old async receipts cannot overwrite
  a new review generation. Cancel/reset discards the retained retry envelope.
  Independent review closed the P1 and two P2 findings. Extension tests 40/40.
- Browser source title and locator are retained with the task; query/fragment
  and credential-bearing URLs are excluded, and saved resources carry the
  browser_extension channel and source locator. This addition still needs
  independent review and database provenance proof.
- E05 second attempt retained as `e05-second-attempt.json`: all three failed
  under the 80k aggregate token limit, despite useful internal filing/search.
  The first used 89,360 input tokens across seven responses before fetch. Fixed
  current-state feedback and preloaded tools reduce dead ends. Budget is now
  240k aggregate tokens, retaining 18 turns/24 calls/300 seconds/$2; third attempt
  is running. No previous failure has been reclassified. Controlled source pages
  are synthetic and do not claim real Exa responses.
- A separate live Exa staging search and fetch passed against public Anthropic
  documentation with vendor request IDs (`exa-staging-live-probe.json`). Dev
  shared and agent-host scopes have no Exa key. No secret values were exported.
- Harness now supports actual provisional main-session SDK text deltas through
  onText, checking source authority before each callback and excluding tool JSON,
  subagents and structured output. Independent 10/10 tests and review pass.
  Official source: https://code.claude.com/docs/en/agent-sdk/streaming-output .
  Client consumption of these deltas remains outstanding.
- Screenshot DB suite: 8 passed, 5 default-5-second timeouts plus shutdown hook
  timeout. Inspection showed idle ClientRead connections, not proven SQL locks;
  local Docker transport remains variable. Do not call this a product pass.
- Real Web proof uses only the owned synthetic DB and localhost Web 3344/API
  3345. Synthetic account registration succeeded; preference save is in flight.
  The new services must be stopped after proof. Existing other-task services and
  user tabs were left unchanged. No commit/PR/merge/deployment/Linear closure yet.

### Isolated database recovery (2026-09-10 00:14 local)

- Docker queries reached 77 seconds and login 57 seconds with only a 20 MB
  synthetic DB (29 accounts/122 screenshot tasks at inspection); no SQL lock
  cause was established. Downloaded Postgres.app 2.9.6 / PostgreSQL 18.6 from
  its official release, verified disk image and strict code signature, and ran
  only its CLI binaries from `/tmp/get9-postgres-mount`. No system installation.
  Source: https://postgresapp.com/downloads.html .
- Owned native instance: 127.0.0.1:32774, database/user get9_eval; data directory
  `/tmp/get9-native-pgdata`, server log `/tmp/get9-native-postgres.log`. Both host
  and local socket require SCRAM; max connections 40/shared buffers 32 MB.
  Restored only the owned synthetic Docker dump, leaving the original intact.
  Stop this instance with its pg_ctl and detach the image after acceptance.
- On native PostgreSQL, the same screenshot authority suite passes **13/13 in
  1.38 seconds**, including new persisted browser_source, changed-locator
  idempotency rejection, and exact chat/profile source channel/locator readback.
  Web/API proof now points to native DB; current API PID 87856, port 3345.
- Browser localhost cookies conflicted with parallel local app sessions. Moved
  GET-9 proof to http://127.0.0.1:3344 and signed into the same synthetic account.
  Preference save/re-read passed; unstyled form discovered through screenshot,
  corrected with shared scoped CSS and checked in light/dark themes. This is a
  small restoration of expected product styling, not a new design direction.
- Browser policy explicitly rejected chrome://extensions and forbids alternate
  workarounds. User input is pending to manually load the built unpacked bundle.
  No further extension-install attempt may bypass that policy.
- E10 sixth (native DB) and E05 fourth (native DB, 240k aggregate token budget,
  clearer exact-quote recovery instructions) are running. E05 third on Docker
  remains in flight; its first trial fetched/cited current and historical pages
  but incorrectly concatenated message quotes in finish; rejected correctly.
  Earlier failures remain failures. Person artifact output-schema regression
  now passes with the exact tool-returned person_research_artifact fingerprint.

- Native Session/source/preference checks also pass 12/12 (5.83 seconds). E05
  fourth first two trials pass all execution checks (~120/117 seconds); final
  trial and independent quality scoring pending.
- A new retry bug was identified: SDK failure fallback was committed as a 201
  idempotent answer, trapping client Retry on the cached failure. SDK product
  route now returns typed 503 and rolls back the failed intent; only a successful
  answer is cached. It does not retry automatically. Real DB regression passed:
  failure -> same-key explicit retry -> exact successful replay, two provider
  calls total. Independent review and live recovery trials still pending.
- Calendar evaluator now records at most one explicit simulated-user same-key
  Retry after that typed 503, preserving every failed attempt and its usage.
  This is a revised recovery scenario and cannot retroactively turn previous
  failed attempts into passes.
- Chrome upload also lacks the ChatGPT extension's file-URL permission; user was
  given the documented enablement steps. No file-upload success is claimed.
  A synthetic task created through the existing authenticated API is being used
  only to validate Web profile review. Task 11bd937b-cb3b-4913-b387-678efcdbd52d:
  edited company to LatticeWorks Studio while source quote stayed exactly
  "产品设计师 · LatticeWorks"; explicit UI confirmation submitted, readback pending.

### Cross-surface readback and independent quality corrections (2026-09-10)

- Real Web profile review confirmed the edited company and preserved the original
  quote, but the saved task omitted its reviewed fields. Added a separate
  `reviewed_profile` receipt snapshot on Web/iOS, labeled as this review's saved
  details rather than current canonical profile or original source text. Source
  revocation still removes it with the whole task response. New DB assertions
  read the saved value and original quote separately; 13/13 pass.
- E05 fourth independent quality: 1/3 passes. Trials 2/3 incorrectly attributed
  the owner's acknowledgment to the contact; trial 3 stored literal backslash-n.
  Added speaker-label verification to the SDK Skill and the existing candidate
  analysis skill; finish now rejects escaped newline text with a recovery hint.
  Fifth full live attempt is in flight. Do not call execution checks a quality pass.
- E10 seventh preserved: trial 1 passes, trial 2 exhausts one explicit retry,
  trial 3 incorrectly follows ambient SDK date. Calendar capability now explicitly
  supplies the server reference local date and its precedence over environment
  dates. Chat uses measured `medium` effort; continuation fingerprints include
  effort. Reference: https://platform.claude.com/docs/en/build-with-claude/effort .
  E10 eighth: all three draft checks pass; independent quality and corresponding
  three native confirmations remain pending. E01 sixth at medium: 2/3 pass,
  one timeout; no reliability claim or release approval follows from that result.
- Aggregate Agent artifact usage is now nullable when no provider receipt exists;
  public, person and pursuit runners no longer represent failure as free usage.
  Contracts updated; 36 targeted tests, Agent/host checks and Web types pass.
- Full backend first run: 471/472 pass, one old fallback expectation corrected.
  Isolated retry/Session test accounts avoid intentional generation invalidations
  racing across suites. Full second run during Xcode recompilation had resource
  and connection timeouts and is not a pass; rerun with two workers separately.
- Full iOS check is running with its machine-wide lock. TikHub credential probe
  was blocked by Infisical transport EOF before any TikHub request; retry pending.
  No commit, PR, merge, deployment, or issue closure has occurred.

### Live product entry-point verification (2026-09-10, 01:29 local)

- Backend rerun with two workers passes 55 files / 472 tests. Web prior suite
  passes 366 tests (one skipped); eval CI and secret contract checks pass.
  Full iOS Release build and 539 unit tests pass; the complete UI suite remains
  in progress with its owned Simulator/lock. No full iOS pass is claimed yet.
- TikHub staging credential and health checks pass; no live profile retrieval
  was exercised. Exa live search/fetch proof remains separate from E05's
  controlled fictional public-page responses.
- E01 seventh independent quality passes 3/3. E10 eighth exact live drafts now
  each have matching production-component confirmation and independent EventKit
  readback/cleanup. Combined independent review passes 3/3 within that composed
  boundary. It does not prove a full live Chat-to-device journey or manual human
  action, and the failed first SDK attempt in trial 2 remains retained.
- E05 seventh completes all SDK runs but passes quality only 1/3: two profile
  fields had incomplete citation coverage or contained excluded namesake details.
  Eighth fixes those completed-output findings (trials 2/3 quality 4/4/3/4), but
  trial 1 exhausts its unchanged token budget after separate per-field updates.
  Added a tool instruction to batch independently cited fields; no gate or
  budget was relaxed. Ninth live trial group has not started yet.
- Real Web profile review proves `LatticeWorks Studio` saved separately from
  the original `产品设计师 · LatticeWorks` source quote. Evidence is in
  `web-profile-reviewed-readback.json`; the task was API-created, not uploaded
  through Chrome. Extension installation/upload permissions remain pending.
- Real Web homepage inspection exposed a missed adapter: the unscoped input
  still rejected ordinary conversation. Added authenticated `/api/workspace-chat`,
  canonical Session task-reference persistence, same-intent retry, account/scope
  cancellation, natural response and editable calendar rendering. Empty accounts
  now retain their account identity when no default fixture capture exists.
  Fifteen targeted Web tests pass; real Web request and independent review pending.
- Scoped chat's remaining audit usage fallback now records null, not zero, and
  SDK timing explicitly means first completed assistant content-block receipt,
  not TTFB or whole-response completion. Independent reviewer closed both P2s.
- Predeploy host audit passes: existing Talent Signal Serve root targets loopback
  4317; `/ops-health` and HTTPS 8443 belong to other services and must be preserved.
  No staging provider cutover, commit, PR, merge, or deployment has happened.

### 2026-09-10 02:05 — Web account boundary and latest evaluation

- Added initiating-login HMAC checks to unscoped chat and preference GET/PUT,
  including save readback. Clients carry a non-authoritative binding; routes
  construct the backend client from the same verified claims. Independent
  review closed the chat P1 and found no preference P0/P1. Actual two-account
  browser journeys rejected stale requests before backend/SDK access; owned
  PostgreSQL readback preserved both preferences. Evidence: `web-stale-login-proof.json`
  and `web-preference-login-proof.json` in the GET-9 evaluation directory.
- Web full suite passed 387 tests with one existing skip. The subsequent
  preference boundary tests passed 10/10; TypeScript, lint and docs checks pass.
  Responsive empty workspace was inspected at 390x844 and viewport reset;
  latest responsive completed calendar and scope-return journeys remain pending.
- E02/E04 fifth medium-effort live run passed all six execution/readback checks;
  independent quality scoring is active. E05 ninth passed execution 3/3 but
  independent quality only 2/3: trial 2 mentioned m3 while citing m1/m2 and used
  an ambiguous speaker. Corrected misleading tool-description message examples
  to actual IDs, explicit speakers, and omission of immaterial exchange findings.
  Tenth run is active; ninth and all prior failed groups remain retained.
- iOS Release build and 539 unit tests passed. Full UI suite is still running
  with two observed failures: RTL Session-to-People paging at line 1400 and
  Session-open p95 3562.46ms against the existing 1200ms gate. Persistent original
  xcresult copies are `/tmp/get9-ios-rtl-failure.xcresult` and
  `/tmp/get9-ios-latency-failure.xcresult`; latency attachment is retained as
  `ios-full-first-latency-failure.json`. Do not classify as infrastructure or
  relax gates without isolated evidence. No Swift edits during this full run.
- Remote main advanced to `e9bbaa5b` (GET-25). Integration, latest-head review,
  production build/CI, provider cutover/deployment, PR merge and issue closure
  remain outstanding. Chrome manual unpacked-extension load remains pending
  user action due to browser URL security policy; no bypass is authorized.

### 2026-09-10 02:25 — delivery checkpoint and revocation correction

- Implementation checkpoint `5a71aa5e` is committed; GET-25 merged cleanly as
  `fc0a023c`. Merged Web verification passed 398 tests (one existing skip),
  typecheck and lint. No PR, push, deployment or issue closure yet.
- E05 tenth and E07 fifth both passed execution 3/3 but quality only 2/3.
  E05 added unsupported participation/transfer claims; E07 added unsolicited
  contact verification to simple recall. Both groups remain retained. Profile
  source statements now require a literal field value (validated URL exception
  retained), with explicit qualified inference still supported. Actual mixed
  batch rollback, literal, inference and URL checks pass locally. E05 eleventh
  completed execution 3/3 and awaits independent scoring. E07 next run awaits
  current build and source-lifecycle review.
- Stopped the original iOS full suite after failures accumulated. All completed
  parts were APFS-cloned to `/tmp/get9-ios-first-full.parts` (3.3GB); original
  log and `ios-full-first-interrupted.json` retain pass/failure denominator.
  Release and 539 unit passes stand; the full UI gate is NOT passed. Exact
  aligned logs show roughly 9s/12s Today reads and source-write lock timeouts,
  not proof of a missing canonical workspace or a harmless test flake.
- Independent review confirmed P1: a long mirror transaction can delay source
  revocation beyond its write timeout. An initial same-client savepoint probe
  was rejected by review: it can roll back concurrent successful appends and
  cannot detect a new uncommitted generation row. That intermediate patch was
  never delivered. Current correction uses an independent autocommit Pool
  probe with bounded queue wait, preserves the final transaction fence, and
  initializes generation with account creation plus migration 061 backfill.
  First/resumed revocation and concurrent append/probe regressions are active;
  P1 stays open until independent retest closes it. Source metadata-trigger
  serialization is a separate performance concern, not claimed fixed.
- Preparing a separate `get9_ios_eval` database on the owned native PG18 server
  for equivalent deterministic iOS fixtures, to diagnose failed paths before
  resuming the remaining UI cases. Do not alter Swift, weaken timing gates or
  use Simulator-only evidence as physical TestFlight proof.


### 2026-09-10 02:38 — independent closure and native Session diagnosis

- Two revocation/append P1s independently closed; latest backend 477/477 across
  main plus explicit environment-gated DB runs, Agent 144/144 plus one skip.
  Regression tests, rather than broad always-on rules, own the interleaving
  counterexamples. Canonical agent guidance now requires revocation liveness
  and no unrelated transaction rollback. `docs:check` passes at the 320-line cap.
- E05 eleventh and E07 seventh independently pass 3/3 each. E07 sixth retains
  two pre-first-response 60-second timeouts; identical prompt/fixture/budget in
  seventh. No gateway-cause or reliability claim. See the new evidence README.
- Web return-to-conversation actual UI retains the same Session, prior calendar
  draft and accurate follow-up. User bubble contrast corrected and DOM-read
  back. Production build passed with an ephemeral process-only build AUTH_SECRET;
  first missing-secret build failure retained. Lint and types pass.
- Native iOS retry uses isolated `get9_ios_eval` on native PostgreSQL and owned
  API 3347 (3346 belongs to unrelated Next work and was not touched). Canonical
  workspace reads now complete in milliseconds. Ask nevertheless returns 404:
  loopback fixture login occurs inside URLPursuitWorkspaceClient, but the view
  skips Session sync because its initializer has no access token. This is an
  identified client defect, distinct from prior database lock observations.
- Native five-case retry interrupted after reproducing the missing-session
  failure; `/tmp/get9-ios-native-five.log` and result bundle retained. A current
  fix routes Session sync through the same authenticated workspace client and
  fails closed when a canonical service cannot sync. Added loopback credential
  reuse and remote-login-denial unit checks; build/test/review pending.
- No deployment, PR, merge or Linear closure yet. Staging provider remains
  unchanged. Actual Chrome extension installation and physical-device proof
  remain unverified, not converted into fixture passes.


### 2026-09-10 02:44 — staging preparation and incoming GET-23

- Securely copied only the dedicated Hao credential plus six allowlisted Harness
  selectors/options into staging/shared. Readback validation passes. Existing
  privacy admissions and Exa/TikHub configuration remain unchanged. Running
  TestFlight containers still use their previous environment until deployment.
- Origin main advanced to `6dc16355` (GET-23 #170), touching product-run capture,
  chat, iOS feedback and migrations. Integrate after the in-flight native build
  to avoid mixing source revisions inside one Xcode result; re-review affected
  boundaries and run current-head checks before PR delivery.
- New iOS sync fix release build passes; selected unit/native execution remains
  active in `/tmp/get9-ios-sync-fixed-first.log`.


### 2026-09-10 03:00 — GET-23 integration boundary repairs in progress

- Checkpoint `276327b3`; incoming GET-23 merged with explicit conflict resolution
  into `02a22813`. Preserved both complete migration slugs, both iOS project
  additions/localizations, timezone and prior-task requests, capture wrapper
  plus Harness guards. Pre-repair merged backend build passes.
- Native pre-merge sync proof: six focused unit tests and RTL passed; latency
  budget passed unchanged (200-second test). Actual Session PUT followed by
  same-session chat POST 201 fixes the missing-session defect. Remaining citation
  assertion failed because this isolated API deliberately has remote chat off
  and the unscoped response is the local greeting. Keep this failure; next run
  must configure actual Hao for the canonical relationship journeys rather
  than dropping the citation assertion. Result `/tmp/get9-ios-sync-fixed-first.xcresult`.
- Independent integration review confirmed: failed/null-task product-run capture
  could retain revoked material outside the rolled-back product transaction;
  previous-task history lacked runtime/final expiry checks; Lab manifest omitted
  the four new account tables and the new-account generation baseline breaks its
  zero-row assertion. Pending Lab stop also needs independent heartbeat checks.
- UNCOMMITTED DRAFTS, not reviewed/passed: 062 classifies/guards four Harness tables
  and only permits source-delete trigger bypass for an exact transaction-local
  cleanup account, deleting Lab workspace and revoked lab user. Lab create admits
  exactly its one zero-generation baseline; cleanup still requires zero rows.
  Lab source guards/continuation probes now reject pending-stop locks through
  an independent autocommit NOWAIT query. Need real stop/rollback/cleanup probe.
- 063 draft binds product-run content to source generation and a nonfailed,
  committed task. productRunCapture removes original image bytes/error prose;
  productRunSink writes metadata first and buffers up to 16MB content until
  source revalidation after commit. onSend holds request text in memory until
  task binding. Dynamic and final previous-run checks use a fresh pool statement.
- IMPORTANT remaining draft gaps before review: finish late background output
  persistence protection, successful screenshot monitor compatibility (its own
  source writes advance account generation), source expiry propagation, pending
  span cleanup/late append races, exact source/data-loss regressions and all three
  migration baselines (GET9, GET23, empty). Current draft has had one metadata
  generic type error fixed; latest rebuild not yet verified. No 062/063 migration
  applied yet. No claim of P1 closure, PR readiness, deployment or overall pass.

### 2026-09-10 03:31 — integrated lifecycle proof and native latency failure

- Existing merged backend suite passed 487/487; after the new regression cases,
  491/491 passed. Agent 146 passed plus one explicit skip. Web 398 passed plus one
  skip after updating stale function-name and platform-header expectations; lint
  and types pass. Latest build and final affected checks remain active.
- Real Lab creation/retained SDK/stop/cleanup regression passes. A stop-intent
  advisory lock, checked by the independent autocommit heartbeat, rejects the
  pending stop before product rollback. Independent probe confirms old main and
  subagent entries plus preferences reach zero rows. Earlier NOWAIT-only failure
  and the first UUID/text cast failure remain in the review evidence.
- Previous-run root and parent-Session expiry pass four independent dynamic/host
  final checks, with no new manifest committed. The repository's host-only
  previous-run expiry regression and full feedback suite pass 23/23.
- Two additional screenshot P1s were found: generation refresh could revive old
  spans, and canonical candidate caches could outlive directory deletion. Draft
  migrations 064/065 purge old-generation derivative contents, preserve only a
  content-free admission envelope, clear unfiled screenshot directory caches on
  source changes while preserving original images/extraction, and advance the
  lease/revision so stale decisions require reread. Late output is checked against
  the actual screenshot revision before locking/rebinding its diagnostic run.
  Sinks fix their admission generation before execution, preventing late flush
  from authorizing an earlier generation. Independent closure remains pending.
- Added screenshot/capture-generation/late-output/Lab regressions: latest targeted
  26/26 pass. Empty and GET-23 6dc16355 migration baselines both reach all 68 full
  migration names and repeated application passes. Owned GET-9 databases also
  upgrade; no existing applied checksum is changed. Failed 065 SQL parsing was
  rolled back before correction and retained in /tmp/get9-migration-065.log.
- Native integrated Release build and all 543 unit tests pass. Three real-Hao
  canonical UI tests failed their existing waits. First observed path spends
  17.9 seconds resolving an unscoped contact, then starts a second scoped model
  request; the combined path exceeds the 60-second UI wait. Other failures are
  retained in /tmp/get9-ios-integrated-hao.xcresult. This is not a complete native
  acceptance pass or a demonstrated provider outage. One unchanged-gate retry
  on the updated owned API is active; do not mask the first result.
- Current integration changes remain uncommitted, no PR/deployment/merge/Linear
  closure. Staging's new provider secrets/selectors are prepared, but running
  TestFlight containers have not been replaced. Chrome install and physical
  TestFlight device proof remain unverified.

### 2026-09-10 03:50 — draft PR and honest live-routing checkpoint

- Committed/pushed integration fixes as `fc900819`; independent review closes all
  confirmed integration P0/P1. Draft PR #172 exists; no merge or Linear closure.
- Latest-head CI backend failed only the new Lab generation baseline display
  count. Reviewed fix excludes that coordination row from displayed data rows;
  raw creation and deletion invariants remain unchanged. Actual full Lab eval
  passes, retains 222 original workspace rows and verifies zero rows on cleanup.
- Agent tests pass 146 with one explicit skip; Lab/workspace selected tests pass
  29. Web, repository/docs, security and phase-one cloud checks pass; cloud iOS
  smoke is still running. A new push is required for the backend fix.
- Native second real-Hao batch still fails all three canonical UI journeys. One
  model skipped named-contact lookup and returned no evidence; two requests
  exceeded the existing waits. Reviewed prompt now requires current-name search
  and unique read, then finishes routing without claiming evidence is absent.
- New instrumented live lookup third batch is 2/3: first times out at 62 seconds
  (one response, zero tools, three API retries, unknown HTTP status); second uses
  two tools; third recovers from two invalid calls with four total tools. Host
  replaces incorrect SDK prose with verified handoff. No scoped/native pass.
- E07 eighth is 2/3, with one 60-second pre-response timeout. Preserve every
  failed batch; no gate, budget or quality threshold is relaxed. Serialize
  upcoming model evaluations to isolate concurrency without claiming causality.
- Running TestFlight containers are still old; deployment, native acceptance and
  installed Chrome proof remain outstanding. The latest native check will reuse
  the unchanged Release binary already proved by the second run; only backend
  code changed. No claim of a fresh Release build for that focused retry.

### 2026-09-10 04:06 — deployed backend and isolated transport finding

- Current committed head is `421c02d6`; CI backend/Web/security/phase-one/docs
  pass, cloud iOS remains running. TestFlight deployment script completed at
  that revision: migration 065, Docker synthetic Hao citation probe (7747/299
  tokens), silent voice probe, Apple keys/challenge and HTTPS all pass. Serve
  root4317, ops-health9188 and port8443:5678 are unchanged. Physical device is
  unverified; no merge or Linear close.
- Third serial native batch fails all three original canonical tests (76.990,
  91.718,81.331 seconds). Existing Release binary was reused, no Swift changes.
  No waiting database lock observed; final zero idle-in-transaction. Failures
  remain in ios-canonical-third.json and /tmp result/logs.
- Host IPv4 Hao TLS/request returns401 in2.58s, IPv6 TLS times out at10s. This
  does not prove model-timeout causality. SDK native subprocess explicitly
  replaces ambient environment, excluding the Mac's existing HTTP loopback
  HTTPS proxy. A one-variable live proxy experiment has zero API retries in
  all three trials (12.193,8.995,16.750s), but only one handoff: trial2 stops after search; trial3 makes two invalid
  read calls (missing context, then extra reason) and does not recover.
  Transport and task-quality failures are separate.
- Stop-hook mechanism experiment is2/3 overall: first timeout, then successful
  read hooks stop in5ms/2ms with zero subsequent model responses/tools. Not
  production-ready; independent reviewer requires host post-tool source proof,
  exact tool identity, failure priority, unchanged cleanup/finish, fingerprint
  and post-stop domain guards. No stop-hook production change was made.
- UNCOMMITTED: explicit frozen TALENT_SIGNAL_CLAUDE_HTTPS_PROXY config, HTTP(S)
  no credentials/path/query/fragment/control; no ambient/ALL_PROXY/bypass/TLS
  inheritance. Proxy digest enters continuation fingerprint; diagnostics only
  mode. Tool descriptions now explain exact two-ID read and scoped handoff.
  Agent147pass1skip; backend build passes; independent review in progress.
- Next native run uses this explicit proxy in the owned3347 API with unchanged
  SDK identity/continuation implementation, model, budgets and UI assertions.
  If accepted, commit/redeploy updated source and recheck latest PR head.

### 2026-09-10 04:20 — native success and final operation boundaries

- Committed explicit transport as68528232. New strict operation tools reuse
  each ContactWorkspaceInputSchema branch and the same host contact seam, with
  required readIDs and fixed server operation. Actual flat lookup3/3 passes
  in12.906/17.114/10.958s, each search+read with no retries or tool errors.
- First flat compile hit a TypeScript union.omit signature error; type-only
  common ZodObject assertion fixes it. Executed JS SHA256 is identical before
  and after correction; second full backend build passes. Preserve first log.
- Native fourth (proxy plus improved union description)2/3 passes; first lacks
  citation. Native fifth (strict operation tools)3/3 passes unchanged UI waits
  and citation/Chinese dark AX5 assertions in41.816/52.612/45.467s. Both reuse
  unchanged, previously verified Release binary. All failures stay indexed.
- Independent review found SDK MCP shape reconstruction strips unknown keys
  before handler validation. Added PreToolUse original-argument schema check;
  true MCP regression distinguishes strict model denial from safe direct-MCP
  stripping into the same fixed read operation. Independent P2 now closed; no
  newP0/P1. Full Agent149pass1skip, independent32/32 and typecheck pass. Old
  read_evidence test used invalid{}; corrected to legal evidence_refs, keeping
  invalid-input rejection separately tested.
- E01 eighth3/3 and E07 ninth3/3 actual latest-runtime checks pass through
  explicit host proxy. E01 independent quality meets every applicable>=3
  dimension, with minor unsupported beverage generalizations deducted. E07
  independent quality pending. Native sixth will include final raw-input hook.
- Optional proxy now reaches all existing Anthropic Compose blocks and is
  owned by Infisical shared; no actual staging proxy value is set. Deployment
  manifest/validator10tests pass; rendered staging Compose validation passes.
  Secret scan272files8knowncredentials0matches. origin/main remains6dc16355.
- Current source repairs/evidence still need final commit/push, new deployment
  and latest-head CI. First actual TestFlight deployment421c02d6 is healthy;
  final revisions are not yet in its containers. Chrome manual installation,
  final Web proof, PR merge and post-merge iOS release remain pending.

### 2026-09-10 09:15 — original-image follow-up verified

- Current image slice: agent 169 pass / one explicit skip, PostgreSQL 29 pass,
  agent typecheck and full backend build pass. Seventh real SDK/HTTP/PG/storage
  trial passes all 16 execution checks; independent quality is task 4, grounding
  3, naturalness 3, recovery not exercised. Preserve six earlier attempts and
  their documented failures; no general or installed-client acceptance implied.
- Main CI 34420817264 and Security 34420817212 succeeded for baseline 65afe690.
  TestFlight release 34423962903 has archived/uploaded and is waiting for exact
  build validity. It does not contain this follow-up; do not count it as final.
- Open: scoped general capabilities, Memory-original trace, client proof, final
  delivery and release. GET-9 remains In Progress.

### 2026-09-10 09:38 — Memory-original traversal reviewed

- Image slice committed as 01239571. Current uncommitted Memory slice passes
  independent code review (all confirmed P1/P2 closed), focused independent36/36,
  Agent177pass1skip, PG21/21, typecheck and backend build. Second actual
  HTTP/SDK/PG/storage trial passes13checks in17.263s and independent4/4/4;
  recovery not exercised. Preserve first failed fixture and its distinct causes.
- Baseline TestFlight34423962903 succeeded. Exact receipt verifies version0.1.71,
  build20260910010517, commit65afe690ea4c6588289b84fc289177a5d1f70562,
  processed2026-09-10T01:25:36Z. GitHub prereleasev0.1.71 exists. It excludes
  both follow-up slices and does not satisfy final follow-up delivery.
- Open: usable scoped file/code/browser tools, installed-client proof, current
  branch CI/review/delivery/deployment/release. GET-9 remains In Progress.

### 2026-09-10 10:36 — scoped computation and file artifacts reviewed

- Memory-original slice committed as 8b10c396; canonical budget fix d5809eb0.
  File/computation slice is implemented but uncommitted. Independent review has
  closed QuickJS P2s, artifact parent/replay P1s and Web late-download P1.
- Fourth real HTTP/SDK/QuickJS/PG/CSV trial passes15checks in16.858s; independent
  task4/grounding4/naturalness3/recovery3. It proves actual VM addition and repair
  of a denied filename. Earlier failures and weaker third-trial arithmetic proof
  remain in the evaluation review. No quality threshold or gate was lowered.
- Agent195pass1skip; PG24/24 (latest file/session23/23); Web7/7 plus lint/types;
  iOS focused7/7; backend build passes. Web real save acceptance is in progress;
  first older-contact attempt shows failure recovery, with no file. Independent
  reviewed synthetic work-log fixture is now open for focused UI acceptance.
- Latest coordinated baseline release is v0.1.72/build20260910015226 at ba16cf5f
  (GET23). It excludes all current follow-up code. Browser capability, client
  acceptance and follow-up CI/merge/deployment/release remain open; GET-9 stays
  In Progress. Chrome installation still requires the previously stated approval.

### 2026-09-10 10:55 — file slice committed; native recovery defect found

- File/computation slice committed as829b5248. Actual Web task and click saved
  a71-byte CSV in Downloads; rows5/12/17 and hash match canonical artifact.
  Independent reviewer separately read the downloaded file and confirmed it.
- Native unit-test binary had no signing entitlement and failed Keychain recovery;
  signed Debug rebuild restored normal login. No application guard was bypassed.
  The same synthetic account now reaches its real contacts and scoped chat.
- Native readback correctly requires a last_review_id; the authored fixture's
  reviewed flag alone is insufficient. Actual UI then exposed a P2: the source
  review sheet immediately dismisses because failed replies are not saved turns.
- Uncommitted fix retains a temporary validation response and exact citation,
  binds the original account/user/Session/scope, and refreshes canonical readback
  before display/submission and periodically. It does not create a successful
  turn or bypass source/review CAS. Independent review caught a remote-login P1
  omission and same-Session scope-change P2; both repaired, re-review pending.
- First focused native run9/9 passes; second expands to remote-zero-request and
  actual Session-scope/retention regression. Native source review and system file
  save acceptance remain active. Browser/delivery/Chrome permission stay open.

### 2026-09-10 11:17 — native review recovery and system save verified

- Native full recovery regression107/107 passes. Independent review closes all
  confirmed P1/P2: temporary source-review authority is refreshed and owner-bound;
  applied review plus matching old ask-key retirement persists atomically across
  retries/restarts. Draft remains and user explicitly Sends again.
- Actual signed Simulator completes review→Send→Chinese17h answer. Generated
  artifact remains available, but its UI entry was absent. Grouping answer and
  file view in one lazy item plus visible list loading/retry restores the entry.
  Actual system exporter saves66bytes with5/12/17 and canonical SHA256 match;
  independent reviewer separately reads the file. Layout test8/8 passes.
- Reviewer found local proposals would show a futile Retry. Entry admission now
  requires canonical task and manifest UUIDs, with proposal/unbound/preview
  exclusion tests. Re-review closes P2; latest9/9 passes, and docs:check passes.
- Durable native receipt preserves failures and limits. Restored Session still
  shows needs-refresh; do not count the file receipt as cross-device sync proof.
  Browser capability, original-image client proof, Chrome permission and final
  delivery/release remain open. GET-9 is still In Progress.

### 2026-09-10 11:54 — isolated browser implementation under acceptance

- Native recovery and actual system-save slice committed463c6b59. Browser is
  now implemented, uncommitted and not admitted to production: shared SDK tool
  accepts a source discovered by this task after capture/public-research consent.
  The Unix-socket agent host creates a fresh immutable-image Chromium container
  with no network/host mounts/credentials. Host-brokered public GETs recheck
  same-origin and pinned public DNS; returned sources preserve browser provenance.
- Independent review found and closed robots alternate-port and stalled-DNS P1s.
  Added owner/process-instance labels, automatic removal, verified cleanup and
  startup orphan sweep; inspect-disappearance P2 is fixed with a regression,
  re-review pending. Host46/46, Agent195pass1skip, scoped PG2/2 pass; backend builds.
- Preserve all four actual Docker suite reports. First run failed cleanup and
  blocked later admission. Second exposed a trailing-space fixture assertion
  plus real redirect and cleanup failures. Third kept redirect failure. Fourth
  passes JS/resource rendering, no prior storage, cross-origin/private/POST/WS
  refusal, cancellation and actual public HTTPS example.com; redirect fails
  because Chromium's error-page commit interrupts the next navigation.
- The corrected worker closes the old page before navigating each host-admitted
  redirect target. Fifth actual suite is active. Product-level SDK/HTTP/Unix-
  socket/browser/PG evaluation is prepared; it uses controlled search discovery
  and real example.com browser fetch. No Exa network or installed-client claim.
- Runtime limits and configuration live in agent-host/browser/README.md. HTTP
  count/byte budget includes robots; startup and cleanup are outside execution
  timers. Browser admission, client image proof, Chrome permission and final
  delivery/release remain open. GET-9 stays In Progress.

### 2026-09-12 16:35 — browser product proof and current-state revalidation

- Previous turn made progress: worker request exhaustion now closes Chromium
  before reporting failure. The actual second recovery suite passes4/4 with
  fresh runs after both runaway JavaScript and request flooding. Independent
  review closes the change with no new P0/P1/P2.
- First actual product run passes12checks and independent quality4/4/3/3.
  The evaluator now requires no profile fields at all, closing a source-alias
  blind spot; historical receipt remains unchanged and satisfies the stronger
  offline check. Empty-account state is not existing-state preservation proof.
- Today’s seventh boundary and second product runs fail during browser lifecycle.
  Eighth single suite is6/7 with a late-resource timeout. Third product run
  passes12/12 in64.673s. All attempts are retained; shared Colima reports44
  running containers on4CPU/6GB with delayed inventory and high VM CPU. No
  unrelated containers were changed. Shutdown-order review remains active.
- Host46/46 and docs:check pass. Browser remains uncommitted while final review
  closes. Origin/main is now87ee93fa, including Chrome pipeline PR175 and native
  Keychain PR177. Commit this isolated slice, merge current main, then complete
  client image acceptance and exact-head delivery checks. GET-9 remains open.

### 2026-09-12 17:08 — merged baseline and actual Web image proof

- Browser slice committed254fc2f1; main87ee93fa merged asbe7b2075, preserving
  Chrome PR175 and Keychain PR177. Independent conflict review has no P0/P1/P2.
  Agent199pass1skip, PG screenshot28/28, Web411pass1skip, extension41/41,
  backend build, agent types and docs:check pass on the merged tree.
- Current uncommitted browser diagnostics and shutdown corrections reviewed
  with no new P0/P1/P2. Dedicated Colima context preserves the default daemon;
  latest immutable image83b1d943 passes boundaries8/8 and recovery4/4.
  Product fourth passes12/12 in42.776s; quality4/3/3, recovery not exercised.
  Old failures retained; daemon contention is not a proven sole root cause.
- Actual Web file upload→main/child original regions→identity question passes
  10checks, quality4/3/3. Actual Web Memory→overview→tile6→citation passes
  11checks, quality4/4/3. Source setup for the latter is scripted synthetic
  ingestion plus actual review, while chat uses real SDK. Both have screenshots
  and authenticated readback; neither claims native/installed-extension proof.
- Simulator control recovered. Signed merged-head native build is active,
  scoped to the owned device and using the machine build lock. Native image
  acceptance, current-head PR/CI/merge/deployment/TestFlight and Linear closure
  remain open. The prior Chrome installation rejection has not been bypassed.

### 2026-09-12 — native quality regression and deployment gap

- Follow-up PR178 is draft at ce6e7fd5. Browser lifecycle evidence and Web
  image proof are committed. Native localization catalog, source-lifecycle
  test mocks/cleanup-failure coverage, and a schema-only Web import with lazy
  QuickJS resolution fix the subsequent CI failures. Current Backend, Web,
  Security and both actual Vercel deployments pass; iOS smoke remains pending.
- Native Memory→overview→tile→citation passes12checks, independent4/4/3.
  Citation sheet opens the reviewed excerpt. An earlier wrong-input attempt
  and SwiftUI stall remain failures; restarting the owned app is not a fix.
- Active milestone: native original-image quality. Execution10/10 but
  independent3/2/3: the main Agent records its resolved reading error as a
  source ambiguity. Preserve the failed receipt, repair the persistence
  boundary without concealing genuine ambiguity, then run a new native trial
  and independent review. Existing prompt-only guidance was insufficient.
- Deployment inspection found the real Compose research sidecar has neither
  a Docker CLI nor a browser executor route. Host-only browser tests therefore
  do not complete deployment. A narrow authenticated executor outside the
  credentialed sidecar must retain public-fetch mediation, scoped operations,
  bounded lifecycle and verified cleanup. Do not mount the primary Docker
  socket or expose model/DB credentials to the executor. The transport and
  actual Compose acceptance remain to be implemented and reviewed.
- GET-9 remains In Progress. Native quality/stall, actual executor deployment,
  installed Chrome acceptance and current-head merge/deployment/exact
  TestFlight proof remain open. No old or skipped check substitutes for them.

### 2026-09-12 18:00 — native source quality repaired; iOS CI next

- Source-review correction independently passes after P1 cross-field and P2
  denied-delegation fixes. Current-Run/reader receipts, neutral child selectors,
  structured uncertainty and post-child rereads reject resolved-reading/source
  contradictions before persistence. Model visual correctness still requires
  evaluation. Agent211pass/one skip, focused46/46, independent35/35, types/build
  pass. Canonical documentation remains inside its320-line budget.
- Eighth real SDK trial failed on an actual MCP-array hook shape, exhausting the
  unchanged token budget without recording. Ninth uses that observed shape,
  passes15/15 in43.247s, quality4/4/3/3. Failed evidence remains unchanged.
- Second actual native Photos→Send trial passes14/14, quality4/4/3/3. Original
  DOCIOS-e82012c6/62,723bytes preserved. Two actual validation errors recover
  through original-pixel reread and corrected understanding; no false uncertainty,
  contact or external effect remains. Signed clientbe7b2075, reviewed backend
  dist hashes recorded. Earlier native failure and SwiftUI stall remain history;
  the stall itself has not been diagnosed or fixed.
- Active milestone: current PR iOS CI failure. ce6e7fd5 Backend/Web/Security and
  both Vercel deployments pass, but iOS smoke fails one hosted feedback-source
  load test and the AX5 dark-mode contrast audit. Inspect the actual failing
  surface and repair before release; do not suppress the audit or extend waits
  without evidence. Executor deployment, installed Chrome acceptance, remaining
  native recovery and final merge/deployment/exact TestFlight remain open.

### 2026-09-12 — actual AX5 and executor transport investigation

- HEAD204bccfa passed Backend/Web/Security and both Vercel builds; its iOS
  job later failed only the old AX5 audit (557 unit tests passed). The old CI34685890291 artifact was downloaded in
  verified ranges after two slow downloads, ZIP CRC-checked and inspected.
  Its contrast crop contains the clipped upper half of the review heading.
- The feedback render test now explicitly mounts and lays out its hosting view
  in a foreground-active scene, retaining the real `.task` and10-second source
  assertion. Independent review passes; local AnswerFeedbackTests10/10 passes,
  render0.724s. The preceding XCTest bootstrap timeout remains an infrastructure
  failure, not a repaired product lifecycle defect.
- A live display probe exposed a false premise: the old AX5 launch string
  rendered `large`. UIKit's typed raw value renders `accessibility5`. True AX5
  cannot keep source and review sections in one viewport. Work in progress uses
  actual clipping geometry and separate audited views; failed trials remain in
  `/tmp/get9-ios-ax5-*`. Eleven other uses of the invalid AX5 string were corrected with actual
  display-probe assertions; their earlier results do not prove AX5 coverage. Do not close
  the accessibility milestone before full text/result coverage and review pass.
- Executor transport feasibility: a temporary HTTP listener bound only to Mac
  127.0.0.1 returned the expected nonce from the existing TestFlight research
  sidecar through192.168.5.2, resolved independently in the default Lima guest.
  `host.lima.internal` and `host.docker.internal` are absent in that container.
  This is connectivity proof only; the deployed sidecar image has changed to
  `opik-20260912-v2` through other work and must be preserved/reconciled.
- Reviewed executor direction: a private authenticated browse-only RPC to a
  trusted Mac process with no model/DB environment, using the dedicated Docker
  socket and pinned daemon/image identity for run/inspect/rm/health. Fail closed
  without configuration; never fall back to the default context. Bound identity,
  request/response bytes, deadline, concurrency, deduplication and ledger TTL;
  premature response close cancels and verifies cleanup before capacity returns.
  Keep source/lease checks before and after RPC and before persistence. Enforce
  one executor instance, sweep abandoned containers on startup, and prove the
  actual Compose path including cancellation, revocation and daemon recovery.
  Empty environment is not Mac filesystem isolation. No implementation or
  deployment acceptance is claimed yet.


### 2026-09-12 19:18 — executor transport delivered; actual AX5 remains open

- Independent commit `f72ac347` adds the production browse-only RPC, clean Mac
  executor, authenticated readiness, pinned Docker socket/daemon/image, bounded
  identity/deadline/bytes, shared concurrent calls and verified cancellation.
  No confirmed P0/P1/P2 remains after independent review. Agent-host57/57 passed
  before the final health-race correction; the correction's focused3/3 and
  typecheck pass. `pnpm docs:check` passes. See
  [executor evidence](https://github.com/getyak/capir-evals/blob/main/evidence/get9-harness/completeness-executor-review.md).
- Existing TestFlight sidecar transport reached real Chromium through the
  private host route in5.150seconds;401/ready200 verified. Live cancellation and
  deduplication10/10 included an observed running worker, one worker for duplicate
  calls,409 conflicts, disappearance after abort, successful fresh call, and
  zero final workers. Wrong daemon/image/socket reject; the daemon was not
  stopped, and its actual outage/restart acceptance remains open. The deployed
  sidecar application/configuration remains unchanged, preserving parallel Opik
  work. The task-owned executor currently listens on loopback4319 with a0600
  token file outside the repository; this is not final managed deployment.
- Actual AX5 trial10:5/12 pass,7 fail. Trial11:Today now passes after removing
  unsafe coordinate fallback from `tapWhenVisible`; three other cases fail.
  The helper previously clicked the fixed composer instead of the covered
  target; the capture journey also swiped an above-screen target farther away.
  Bidirectional scrolling and real hittability now replace that fallback.
  Other helper methods have not all been audited and are not claimed repaired.
- Audio's added state readback finds Toggle value0 after a nominal tap. Video
  shows only the top of its multi-screen label while its actual switch is still
  below the viewport. Trial12 centers that control before clicking and reads its
  value; it is pending. AgentStudio trial11 never acquired the display probe
  and showed a default English/normal-size preview, so that failure is not AX5
  product evidence. Trial12 explicitly terminates the prior app in test setup
  before launching the requested fixture; its cause/recovery remain unproven.
- Core audit trials10/11 fail with XCTest accessibilityAudit-56, including the
  allowed one retry. Do not suppress the error, delete contrast checks or claim
  AX5 completion. Trial12 is running with source/heading/name/message/action
  viewports preserved; the seventh remaining acceptance failures still need
  diagnosis and verification. Failed artifacts and summaries remain in
  [actual AX5 trials](https://github.com/getyak/capir-evals/blob/main/evidence/get9-harness/completeness-ios-actual-ax5-trials.json).
- No merge, new production backend release, TestFlight release or Linear closure
  has occurred; these partial proofs do not satisfy the remaining gates. Continue all original GET-9 acceptance,
  including deployed RPC revocation/recovery, installed Chrome, native recovery,
  current-head CI and exact processed build/internal-group receipt.

### 2026-09-12 — recovery proven; actual AX5 diagnostics continue

- Rebuilt `f72ac347` executor passes real recovery14/14: actual paused-worker
  orphan survives executor SIGKILL, restart removes it before admission; an
  idle dedicated daemon outage rejects readiness/browse, restart restores a
  successful fresh browse in the same executor, final inventory empty. Trial1
  failed an incorrect503 expectation (actual protocol502), retained separately.
  Active-cleanup daemon loss and managed deployment are not covered.
- Real RPC source revocation passes9/9 with deterministic model/search:
  Chromium returns public HTTPS evidence, then the source receipt is revoked
  before the backend checkpoint. The result is fenced, task is deleted and
  persisted state/input erased. This is boundary proof, not model quality or
  production deployment. See the updated executor evidence report.
- AX5 trial12: AgentStudio31.289s and Audio33.725s pass; core226.555s fails at
  final Dynamic Type audit. Its pre-audit result is fully visible; the reported
  `PROPOSED FACTS` heading was elsewhere, then clipped in the audit-generated
  screenshot. No Dynamic Type exception was added. Trial15 adds fully visible
  heading/deadline audits; the heading passes, remaining stages are running.
- AX5 trial13: original contact Session recovery79.375s and canonical workspace
 88.976s pass. Relationship capture134.184s failed the obsolete Close-button
  assertion; current navigation uses Session BackButton. Trial14 reaches the BackButton query but fails old flattened query order;
  its post-failure return is unverified (see the correction below).
  Two exported fixed AX trees retain scope-before-composer-before-send. The
  helper also matches a zero-size Other with the composer's ID. Independent
  review recommends one immutable hierarchy with exact control types; this
  correction is pending verification, not an established VoiceOver focus test.
- Trial14 core12.920s never acquired the effective display probe, matching an
  earlier first-test startup anomaly. Trial15 uses test-without-building and
  reaches actual AX5 audits, but this does not prove the startup cause fixed.
- Independent review found no confirmed P0/P1/P2 in the prior incremental
  corrections. Snapshot changes, new evaluation script and current-head CI still
  require review/verification. PR178 remains draft; no release/Linear closure.
- Follow-up review required an explicit no-result-exposed assertion in the RPC
  revocation evaluation. Trial2 passes10/10 including `CONTACT_TASK_LEASE_LOST`
  and absent model result; corresponding P2s are independently closed.
- AX5 trial15 passes the fully visible proposed-facts heading, then fails
  contrast at the deadline-heading audit249.782s. Its audit failure screenshot
  is blank and has no resolvable issue element; do not classify it as a proven
  product color issue or suppress it. Trial16 catches a compile error from a
  non-public snapshot property; the attachment now uses public index/type/id/
  frame attributes. Trial17 compiles and is running the corrected snapshot
  code. No Dynamic Type/contrast gate has been removed.
- Real SDK through the production RPC client passes12/12 in73.652s; independent
  quality4/3/3/not_exercised. The reviewer flags overbroad negative-search
  phrasing and verbosity; no career fact was inferred. Recovery/delegation are
  not scored on this successful path. The new Infisical URL/token were absent,
  then migrated only to staging:/agent-host and exact readback passed2/2; the
  existing sidecar remains unchanged. Manifest validation passes.
- AX5 trial17: fixed hierarchy-order check passed; Back return after failure
  is unverified, and the
  relationship journey145.292s fails Dynamic Type on the person's label child.
  The existing button had full label/value/hint but did not explicitly ignore
  redundant children. Trial20 adds that single-button semantic boundary and
  removes the old child-text Dynamic Type exception; visual text still requires
  screenshot review. Core trial19 passed eight regions before an offscreen,
  previously audited instruction was reported clipped during confirmation.
- Trial20 scopes duplicate Dynamic Type coverage to unchanged UI stages and
  exact identity/value/configuration/dimensions; confirmation clears coverage
  and reaudits the source/proposal context. Every audit type repositions and
  freezes a fresh snapshot. This is pending independent review and device
  verification. Trial18's availability compile error was corrected before19.
- Latest remote main is `ab20fb9b` (PR179: private product observation defaults).
  PR178 currently reports conflicts against it. Preserve and reconcile that
  parallel work before final CI/deployment; current live RPC proofs precede
  that merge. Trial20 core116.428s fails an unfiltered captured-time contrast
  finding after confirmation; the failure is retained, not an AX5 pass.

### 2026-09-12 20:20 — main reconciled, managed executor verified, AX5 still open

- `6d11a17a` merges main `ab20fb9b` without losing the new product observation
  outbox, deployment policy or original-image return path. Agent217pass/1skip,
  focused reconciliation54/54, new backend projection/probe6/6 after rebuilding
  shared contracts, and full agent-host58/58 pass. Independent reconciliation
  review found no P0/P1/P2. PR178 is now mergeable; Web/backend/security checks
  passed on this exact head while iOS CI remained running at the last readback.
- Active-daemon-loss evidence11/11 now proves the in-flight RPC rejects,
  unverified cleanup keeps admission closed across daemon restart, and executor
  restart verifies inventory before new successful work. Managed launch-agent
  evidence18/18 binds a separate pinned6d11 checkout to the exact daemon/image,
  persistent token, PID replacement77070→77120, authenticated readiness,
  Chromium and zero workers. Main-release rollout and the new production
  caller remain pending; the prior Opik sidecar image was not replaced.
- Actual AX5 trial21 retains core50.146s timeout and relationship147.972s failure
  from an invalid no-StaticText-descendants assertion. Public AX snapshots do
  not establish VoiceOver focus stops; that assertion was removed. Eight
  unfinished contrast analysis threads were observed in the owned simulator's
  testmanagerd sample. The in-process timeout retry was removed; after that
  test ended, only the task-owned simulator was shut down and booted. This is
  test-environment recovery, not product lifecycle or a confirmed Apple root cause.
- Fresh trial22 core26.203s failed a duplicate timestamp AX identity after three
  anchors passed all four audit types. Hiding the decorative clock and removing
  its one-text parent's combine resolves that duplicate. Trial23 then audits
  complete time successfully in both states, but core222.517s still fails on the
  original-message child at the deadline audit. Trial24 directly audits an
  independently identified original Text instead of inheriting parent coverage.
- Relationship trial23 verifies unique button/order, full name/context, unsent
  value before audit, but141.156s still fails unfiltered Dynamic Type on the
  visible person's name. Screenshot shows no visible truncation. Trial24 uses
  explicit caption-relative scaling, matching the existing context-label
  mechanism; verification is pending. No audit error is ignored to pass it.
- The same full screenshot reveals draft text squeezed into a narrow column by
  three adjacent controls. An accessibility-layout-only change gives the draft
  its full line width and moves controls below it, preserving the editable value
  and Send/Voice actions. This later increment is not in trial24's binary and
  needs its own review, real viewport checks and interaction regression pass.
- Keep GET-9 In Progress. Native lifecycle recovery, installed Chrome, current
  final-head review/CI, main deployment/Opik readback and exact processed
  TestFlight/internal-group receipt remain required. No overall completion.

### 2026-09-12 — audit evidence correction and focused continuation

- Retract partial keyboard/Back success claims made from failed relationship
  trials. XCTest continues logging queries after an accessibility failure while
  suppressing UI events; trial25's keyboard screenshot is blank and its later
  taps have no event synthesis. These logs prove no keyboard or navigation
  action. Complete PASS contact/workspace cases retain their separate scope.
- Trial24's explicit name scaling and trial25's single attributed scope Text
  both retain the unfiltered Dynamic Type failure. The latter screenshot shows
  the full-width composer improvement, but real editing remains unverified.
  The isolated nine-case calibration reproduces the two-label pattern outside
  the product; it establishes recurrence only and grants no audit exemption.
- Core trial25 fails223.948s at an offscreen source-label value mismatch.
  Trial26 fails33.305s with audit timeout -56; a continuing contrast thread was
  sampled after completion, then only the owned simulator was restarted.
  Trial27 fails226.765s on offscreen original-message value mismatch after its
  own four-type audits passed. String bridging normalization alone did not
  resolve every mismatch. The failure is retained and no coverage is broadened.
- Trial27 confirms first-audit-failure short circuit: immediate teardown, no
  later UI action. Independent review found remaining ordinary-assertion
  short-circuit gaps; these will also become terminating guards. Trial28 tests
  natural Button labels and performs keyboard/long-draft checks before audit.
- PR178 exact4ffcee34 Web/backend/security are green; iOS CI is still running.
  GET-9 remains In Progress with the previously listed delivery gates open.

- Follow-up independent review closes the ordinary-assertion guard gaps and
  confirms snapshot-to-snapshot value comparison preserves the strict coverage
  boundary; live values are checked separately. Trial29 fails34.108s at an
  earlier contrast timeout, so it cannot verify the later mismatch repair.
- Trial28 relationship fails138.193s at the same unfiltered Dynamic Type finding
  with natural Button semantics. Real pre-audit editing/Send/restore events and
  screenshots now establish those limited actions. The full application image
  after chooser dismissal has no visible status bar, Session title or Back;
  keyboard-open context is partly clipped behind the composer. These remain
  incomplete viewport evidence, not accepted navigation or a known root cause.
- Trial30 runs the reviewed snapshot comparison and a single semantic-caption
  AX scope label, preserving full name/context and natural Button semantics.
  Navigation must be visible/hittable/in-window after keyboard dismissal before
  audit. If this label still fails, stop swapping text representations and
  inspect actual scale/input evidence. The owned simulator was recovered only
  after trial29 ended and its continuing contrast thread was sampled.

### 2026-09-12 — separate interaction evidence from unresolved tool audits

- Trial30 core244.220s reaches the final confirmed result: snapshot values now
  match and deadline passes all four audit types. Final Dynamic Type reports
  unsupported text with no element; the audit-generated image is blank while
  the pre-audit result is visible. Relationship139.751s still fails partial
  Dynamic Type with ordinary caption text. No more blind font replacements.
- Trial30's awaited Back geometry and pre-audit image show the complete status
  bar, Session navigation, name/context and composer after keyboard dismissal.
  Trial28's missing-navigation application image remains a transient observation
  without a confirmed root cause. Full-screen/control geometry witnesses were
  added for the next independent interaction run.
- The original AX5 test still executes every unfiltered scoped audit. A separate
  AX5 interaction test shares its complete journey but does not run that audit;
  its outcome cannot close the raw audit failure. Independent review approved
  the split and closed all first-failure/Back guard gaps.
- Review found two remaining old value-only scope assertions. Their migration
  retains the exact same selector, full person/context requirements and reads
  both native label and explicit value. Focused entry/restore checks follow.
- Trial31 was a compile failure in the new diagnostic closure, corrected with
  explicit self. Trial32 People26.338s and Calendar13.638s pass; AX interaction
 132.422s fails exact draft replacement after a synthesized Cmd-A. It does not
  prove Back or restoration. Trial33 uses the visible system Select All action
  and repeats identity/restore checks; exact draft expectations are unchanged.


### 2026-09-12 — actual SDK input boundary and CI failure

- Trial33 preferred-context entry passes23.737s. Contact fails54.197s before
  proposal, with real SDK trace `dc886b9e-c29d-4a04-954d-0d94814f3653` under
  `/tmp/get9-ui-harness-traces`: MCP rejects omitted `maximum_results`; a later
  source quote becomes `DesignUntrusted`, then the existing token budget stops
  the run. This is a new Harness defect, not a scope-label assertion failure.
- Pinned SDK0.3.260 reconstructs its tool input object and rejects omitted
  Zod4.5.4 default fields. A direct SDK tools/call probe reproduces this;
  removing the transport default and exposing an optional input succeeds.
  Canonical host schema and raw model-argument authorization remain intact,
  applying the same default and rejecting invalid bounds/extra authority fields.
  Contact JSON Schema now describes input requiredness explicitly. Adjacent
  objective/context text blocks get a two-newline separator so the context
  heading cannot adjoin the final exact source word. Budget is unchanged.
- Trial33 AX interaction fails135.176s at the system Select All menu. The
  full-screen attachment and AX tree show a visible Forward overflow button.
  Trial34 follows that observed action with at most three menu pages, retaining
  exact draft replacement/restoration checks and first-failure termination.
- Visible AX5 fact headings previously broke short words beside their status.
  Accessibility sizes now place the full heading above its full status; normal
  sizes retain the existing horizontal row. This fixes visible compression,
  and is not claimed as a repair for the unresolved nil-element audit finding.
- Exact4ffcee34 CI completed: Web/backend/security pass, iOS smoke8/9 with core
  audit failure. Run34694013507 records both -56 timeout and contrast failure
  across its isolated attempts; artifact10299140764 is retained. GET-9 remains
  In Progress, PR178 remains draft, no merge/deployment/TestFlight completion.


### 2026-09-12 — user-requested handoff; stop further execution

- User requested a quick wrap-up and concise unfinished-work summary in GET-9.
  No further implementation or test reruns are scheduled by this handoff.
- Latest local checks: Agent219 passed/1 pre-existing skip; typecheck and backend
  build passed; docs check passed. Independent reviewer ran41 focused tests and
  found no confirmed P0/P1/P2 in the latest SDK/default/context and AX layout
  increment. Real-device/client acceptance is not implied by those checks.
- Trial34 failed its initial reviewed-OCR visibility assertion before reaching
  the modified edit menu. The owned xcodebuild was interrupted on user wrap-up;
  preserve the interrupted xcresult and do not count later logged UI actions.
- Remaining: (1) iOS raw AX5 audits, exact draft/Back interaction and native
  Memory stall/lifecycle recovery; (2) same-budget real SDK contact flow on the
  rebuilt API (the still-running3345 process has the older loaded source);
  (3) installed Chrome extension and required file access; (4) final-head review,
  full applicable CI and merge; (5) production caller/executor and Opik readback,
  processed VALID TestFlight build and internal-group receipt.
- Keep GET-9 In Progress and PR178 draft. No release or completed-evaluation
  claim. Local synthetic services and managed executor remain available for
  later continuation; only this owned test run was stopped.
