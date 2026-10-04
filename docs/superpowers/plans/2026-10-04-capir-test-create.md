# capir test account creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Pi/MiMo is the user-selected coding executor; Codex owns orchestration, independent review and delivery. Steps use checkbox syntax for tracking.

**Goal:** Make `capir test create` create a genuinely usable expiring test user,
return its generated password, initialize synthetic data and enter the deployed
Web workspace without a prerequisite human login.

**Architecture:** Extend Lab with exclusive human/operator ownership and entry
lineage. A scoped provisioning principal creates atomic, versioned test runs;
normal password login admits their sessions through the same canonical Lab
authority. The CLI retains exact operation intent and generated credentials in
private stores, while a one-use Web handoff opens the matching test account.

**Tech Stack:** Node >=22.19.0, TypeScript, TypeBox contracts, Fastify,
PostgreSQL, existing salted scrypt, native OS keyring, Next.js and Playwright.

**Spec:** [Approved design](../specs/2026-10-04-capir-test-create-design.md).
The user confirmed the written design with `okk` on 2026-10-04.

## Global Constraints

- Product base: `98f566d1aba45c762c5949f54dd1bfff5c2c0fba`; managed worktree
  `/Users/cubxxw/.codex/worktrees/capir-test-create/talent-signal`.
- Reviewed existing CLI source: `4cc57bf3a81a7868f25609070167858f16485841` in
  `/Users/cubxxw/.codex/worktrees/capir-cli/talent-signal`. Copy only relevant
  source/configuration; no wholesale stale-branch merge or historical evidence.
- Preserve current MCP, Desktop login, identity reservations, human Lab authority,
  strict replay, exact-effect approvals, host budgets and unrelated dirty work.
- CLI syntax: `test create|status|stop`, `help test create`, `--json`, `--env`,
  `--username`, exclusive `--password|--password-stdin`, `--expires-in`,
  `--preset`, `--open web`, `--request-id`.
- Presets: `daily` (12 fictional contacts, 30 observations, 4 tasks), `empty`.
  Creation invokes zero models, email deliveries and OAuth flows.
- Default lifetime `4h`; accept `1h`, `4h`, `24h`, equivalent `1d`. Generated
  passwords have >=128 bits of cryptographic entropy. Use existing password limits.
- Generated emails use `lab.invalid`; email-shaped usernames in other domains
  fail. Actual username/email collision arbitration cannot disturb real login.
- Operator credentials authorize only their own internal test runs. Exact origin
  pair, principal generation, bounded quotas and expiry are enforced server-side.
- Return a generated password only through the dedicated successful CLI output.
  Tokens and passwords never enter logs, errors, URLs, journals or proof receipts.
- Use existing table manifest/write guards and append-only migrations; no old
  migration checksum changes. Unknown cleanup schema fails closed.
- Pi: Xiaomi Token Plan `mimo-v2.6-pro`, no recursive delegation or external
  writes. Codex owns principal provisioning, PRs, merges, deployment and Notion.
- Pure Web/backend task: no local iOS Simulator. Storage floor is 30 GiB. Formal
  proof goes in ignored `output/evaluation/`; retain failed and passing receipts.

## Review Focus

1. A chosen username collides with another user's email: reject before allocation,
   preserving that user's ordinary password login (Task 1).
2. Stop or deadline wins while password verification is running: do not mint a
   usable session; previously issued sessions also fail immediately (Task 1).
3. Credential/keyring/stdout failure after an uncertain create response: preserve
   one recoverable allocation and the original generated password (Task 2).
4. Principal rotation or mismatched origin revokes an otherwise active run: deny
   access without silently entering a real account (Tasks 1 and 2).
5. Machine-readable help includes hostile/secret-like arguments: allocate nothing,
   read no credential/stdin and echo no supplied password (Task 2).

---

## Task 1: Usable test identities and canonical lifecycle

**Owner:** First bounded Pi batch; one writer for backend and shared contracts.

**Files:**
- Create `apps/backend/src/modules/capirTests.ts`, `capirTestRoutes.ts`,
  `capirTestSessions.ts` and `capirTests.integration.test.ts`.
- Create `apps/backend/src/database/096_capir_test_provisioning.sql` (recheck
  latest main before allocation; choose the next unused append-only number).
- Create `packages/contracts/src/capirTestSchemas.ts`.
- Integrate relevant reviewed `capir*.ts`, `capirSchemas.ts` and exact historical
  `087_capir.sql` infrastructure where required; preserve checksums and current
  construction/authentication instead of copying the old app/config wholesale.
- Modify `apps/backend/src/app.ts`, `config.ts`, `modules/auth.ts`,
  `modules/labWorkspaceAccess.ts`, `modules/labWorkspaces.ts`,
  `database/migration-manifest.json`, `packages/contracts/src/index.ts`,
  `labWorkspaceSchemas.ts`, `client.ts` and the existing cleanup/account manifests.
- Modify deployment Compose environment wiring and secret contract only for the
  new configured server capabilities, with defaults disabled.

**Interfaces:**
- `CapirTestCreateRequest`: `request_id`, `username`, `password`,
  `preset: 'daily'|'empty'`, `duration_hours: 1|4|24`, `web_origin`.
- `CapirTestRun`: `id`, `request_id`, `account_id`, `user_id`, `username`,
  `email`, `preset`, `preset_version`, `preset_digest`, `counts`, `state`,
  `expires_at`, `cleanup_error`, `login_url`; contains no password or bearer token.
- `CapirTestsService.create(principal, request): Promise<CapirTestRun>`;
  `status(principal, id)`, `stop(principal, id, requestId)` return the same type.
- `admitLabPasswordSession(client, config, identity, clientLabel)` returns the
  existing `SessionResponse` only after session/entry admission in that transaction.
- New HTTP routes: `POST /v1/capir/tests`, `GET /v1/capir/tests/:id`,
  `POST /v1/capir/tests/:id/stop`, `POST /v1/capir/tests/:id/handoffs`.
  Public capabilities disclose actual enabled scopes without revealing keys.
- Private handoff exchange verifies trusted Web consumer key and yields the
  existing session type; its one-use secret never appears in a public URL.

- [x] **Step 1: Add failing production-router PostgreSQL tests.** Pin generated
  and supplied identity creation, canonical preset counts, zero side effects,
  exact request replay, changed-password conflict, quota and cross-principal/origin
  denial. Add `username_email_collision_preserves_real_login`,
  `password_login_has_matching_lab_entry`, `deadline_denies_before_sweep`,
  `stop_races_password_login`, `principal_generation_revokes_session` and
  `unknown_schema_refuses_cleanup`. Tests call real construction/routes.
- [x] **Step 2: Run those tests against one guard-owned disposable DB.** Expected:
  failures identify missing real routes/admission, not substituted helper output.
- [x] **Step 3: Implement append-only operator ownership and entry lineage.**
  Classify `capir_test_provisioners` and operation records as control scope.
  Preserve existing owner FKs; nullable human fields are legal only for a matching
  operator lineage. Expose truthful nullable/discriminated ownership to updated
  Web contracts. No fabricated ordinary human session is permitted.
- [x] **Step 4: Implement atomic create, replay and password admission.** Reuse
  existing scrypt and scenario resource-intake path. Lock normalized login
  identities, the operation, principal and run consistently. Replay verifies the
  stored scrypt password. Session/entry deadlines are no later than run expiry.
  Every authenticated Lab read uses the shared human/operator authority predicate.
- [x] **Step 5: Implement stop, sweep and private handoff.** Access is revoked
  before cleanup; local data/password/session deletion and pending broker effects
  are distinguished. Enforce exact operator ownership and origin/generation at
  every admission/publication boundary, including response-loss recovery.
- [x] **Step 6: Run focused tests and relevant regression groups.** Commands:
  `pnpm --filter @talent-signal/contracts build`;
  `pnpm --filter @talent-signal/backend typecheck`;
  `pnpm --filter @talent-signal/backend exec vitest run capirTests` plus affected
  Lab/password/identity/MCP lifecycle suites with their disposable DB variables.
  Preserve sanitized assertion receipts; no live provider is used in these tests.
- [x] **Step 7: Commit the independently testable backend slice.** Review source,
  ownership diff and route-to-state traces before approving Task 2's integration.


Checkpoint (2026-10-04): the adopted backend/contracts slice passed independent contracts build, backend typecheck, diff check, and **24/24** focused tests with zero skips on an owned database containing the exact historical staging `087_capir` migration. Existing human Lab lifecycle also passed. App composition remains below the existing 3208-line architecture limit. The broader affected MCP authority regression is recorded for root while Task 2 implements against these frozen interfaces; the pre-existing identity baseline remains 28 passed / 11 failed. No deployment or CLI acceptance is claimed.

## Task 2: CLI, human/AI help and authenticated Web entry

**Owner:** Second Pi batch after Task 1 interfaces are fixed; root preserves and
adopts both batches without overlapping writers.

**Files:**
- Adopt `apps/cli/package.json`, TS configs, relevant existing `src/` and tests from
  frozen reviewed CLI source, preserving existing model/auth/sandbox behavior.
  Update root workspace scripts, lockfile and computed architecture contract.
- Create `apps/cli/src/test.ts`, `testCredentials.ts`, `testHelp.ts` and
  `apps/cli/test/test-create.test.mjs`, `test-help.test.mjs`.
- Modify `apps/cli/src/args.ts`, `run.ts`, `cli.ts`, `help.ts`, `http.ts`,
  `keyring.ts`, `journal.ts`, `output.ts`, `model/args.ts`.
- Create/adapt `apps/web/app/capir/test-entry/page.tsx`, its private exchange route
  and `apps/web/lib/server/capir-test-entry.ts` with focused route tests.
- Modify `apps/web/auth.ts`, `lib/test-workspace-session.ts`, workspace banner
  and testing page only where canonical operator-run login/entry requires it.
- Update `AGENTS.md`, authoritative account operations, CLI wiki source and its
  generated page; add only the approved small recurring command reference.

**Interfaces:**
- `runTestCreate(args, deps)` returns public run, optional generated credential
  success projection and independent browser-ready status. `deps` includes
  operator store, run-password store, journal, HTTP client, stdin and runner.
- `TestCredentialStore` keys are bound to exact origin pair, principal and
  request ID; `get/set/delete` never silently replace another operation's value.
- HTTP bodies implement Task 1 schemas; human/JSON result fields have identical
  run state. Only the generated-password success projection permits disclosure.
- `renderTestHelp(path, format)` is offline, accepts `test`/`test create`/status/
  stop, and renders executable examples, defaults, argument schemas and next steps.
- Web entry exchanges a one-use handoff through private POST, installs only the
  target test session and verifies canonical identity before opening workspace.

- [x] **Step 1: Add failing built-CLI and Web-entry tests.** Cover nested/JSON
  help without environment/keyring/stdin access; random password entropy and
  defaults; chosen username/password; stdin exclusivity; duration/preset parsing;
  no model fallback; command/output/error secret handling.
  Add `response_loss_reuses_password_and_request`, `keyring_conflict_no_overwrite`,
  `stdout_failure_keeps_recovery`, `browser_failure_keeps_ready_run`,
  `cross_origin_handoff_no_cookie` and `direct_password_login_test_banner`.
- [x] **Step 2: Run targeted tests and retain the genuine failing observations.**
  Expected: missing command/help/entry fails without allocating public accounts.
- [x] **Step 3: Implement parser, offline help and command dispatch.** Default
  create preset/lifetime are daily/4h; `1d` canonicalizes to 24h. Missing named
  environment is an actionable error. Help prints readable examples by default;
  `--json` is explicitly supported for existing machine callers. Preserve other
  commands' JSON contracts and actual capability/unsupported discovery.
- [x] **Step 4: Implement credential-safe exact recovery and output.** Persist
  generated password in run keyring before sending; plaintext never enters the
  journal. Return it only after verified ready state. Keep it through delivered or
  recoverable success until stop/expiry; prune expired local items on later use.
  A missing item never causes silent password rotation or allocation retry.
- [x] **Step 5: Wire private browser entry and canonical banner.** Direct
  password login and CLI handoff both resolve the same live Lab account and
  deadline. An expired/revoked entry never falls through into a real workspace.
  Fresh browser contexts contain synthetic data; tokens never appear in URLs.
- [x] **Step 6: Run built CLI tests and focused Web/auth tests.** Commands:
  `pnpm --filter @talent-signal/cli build`;
  `pnpm --filter @talent-signal/cli test`;
  `pnpm --filter @talent-signal/web typecheck`;
  focused `vitest` selectors for capir test entry, auth and workspace-session tests;
  `pnpm docs:check`; `git diff --check`. No raw credential output in test reports.
- [ ] **Step 7: Commit and perform independent whole-branch review.** Root binds
  review evidence to the exact revision and fixes all confirmed P0/P1. Re-review
  affected findings; do not claim a reviewed design is implemented acceptance.

## Task 3: Real installed-command acceptance and release

**Owner:** Codex. Pi never provisions external credentials, deploys or writes PRs.

**Files/evidence:** Updated active plan; ignored
`output/evaluation/capir-test-create-20261004/`; deployed immutable release
receipts; accurate Notion MCP/service chapter only.

- [ ] **Step 1: Preflight one owned isolated integration environment.** Audit
  storage, select loopback ports and disposable DB/artifact paths, and verify
  the relevant historical migration checksum and new table classification. Use
  synthetic inputs; preserve other users' databases, evidence and live services.
- [ ] **Step 2: Run the actual built CLI from no browser login.** Create daily
  default credentials and supplied credentials, verify returned passwords through
  real password login and canonical Web/BFF reads, exact dataset counts, private
  handoff, mobile/desktop banner, history and refresh. Keep raw secret stdout
  private; publish only sanitized receipt metadata.
- [ ] **Step 3: Exercise actual failure, expiry and cleanup.** Confirm exact
  request recovery, conflict, response loss and browser launch failure. For a
  disposable test fixture, admit a near deadline through the actual producer;
  observe expired password login/session denial before sweep and canonical
  cleanup afterward. Production TTL is not reduced to accelerate tests.
- [ ] **Step 4: Create/attach a PR and close latest applicable gates.** Root
  publishes reviewable source only, waits for all current-head CI/security and
  applicable deployment checks, fixes failures and merges under normal protection.
  Read back the merge; no Linear issue is invented.
- [ ] **Step 5: Provision/install and deploy the reviewed release.** Inject the
  dedicated operator credential privately into configured server/CLI stores;
  never use a Pi coding key. Build clean immutable Colima-visible backend/Web
  checkouts; run `scripts/deploy/testflight-local.sh`, Web build/activation and
  existing deployment probes. Update installed CLI and exact environment config.
  Serialize keeper recovery image/revision/pointer changes and restore it.
- [ ] **Step 6: Run actual staging CLI-to-Web proof.** Show global/nested/JSON
  help, create/readback/password login, username/data/TTL and cleanup on deployed
  service. Use this valid synthetic test identity for the outstanding MCP chat
  and catalog acceptance; real vendor OAuth consent remains human-owned. Update
  Notion addresses and proof limits, then read back.
- [ ] **Step 7: Classify evidence and clean owned resources.** Save passing and
  failing sanitized receipts, stop exact owned runs/processes, verify DB/keyring
  cleanup and remove owned temporary artifact copies. Keep immutable live/rollback
  releases and other task assets. Close only after requested acceptance holds.

## Current state and execution handoff

- [x] Written design approved by user; independent design review closed identified
  operator-lineage, real-login, identifier-collision and replay requirements.
- [x] Implementation plan drafted and self-reviewed against every spec section.
- [x] Human review of this written implementation plan: user explicitly approved
  implementation on 2026-10-04; Pi/MiMo remains the selected coding method.
- [x] Task 1 implementation and local verification; final review and deployment remain Task 3.
- [x] Task 2 implementation and verification; independent whole-branch review remains pending.
- [ ] Task 3 review, installed-command proof, deployment and final acceptance.

Do not start coding contracts until the plan review is received. On approval,
read `superpowers:executing-plans`, preflight the single Pi writer lock, and issue
the first bounded contract without changing frozen provider/model/budget values.

### Execution started

Ruling: Pi/MiMo owns bounded coding batches, while Codex retains the execution ledger,
independent review and delivery. This preserves the user-selected method over the
inline-only wording of executing-plans; it does not waive review or acceptance.
Ruling: Adopt the reviewed CLI client and only required backend infrastructure;
do not restore the unrelated entire stale Stage A backend branch. Discovery must
describe actual supported test provisioning and any unavailable legacy scopes.
Historical schema/checksums still require comparison with the deployed database.

Preflight: baseline remains current origin/main98f566d1; isolated task branch is
clean, no active Pi writer, storage51GiB against30GiB floor. Existing shared artifact
registry warnings are outside this task and are not approval to clean other work.
Owned disposable PostgreSQL database and role are capir_test_create_20261004.
Private media/config/artifacts are under /private/tmp/ai-test-capir-test-create.VfCizc.

Task1 Pi batch: `20261004-103155-4faef287`, frozen source `b69d10d2`,
Xiaomi Token Plan MiMo Pro. Base99 migrations and passwordCredential2/2 passed.
Installed CLI baseline confirmed global readable and nested test help fail;
sanitized red receipts are retained in the owned private artifact.

Root Task 1 verification after adoption: all 26 provisioning/password/client
checks passed on the owned PostgreSQL database with the exact historical staging
087 schema, and all 151 affected queue/MCP checks passed without skipped tests.
Backend typecheck and diff checks passed. Two independently reproduced issues
were corrected: heartbeat now acquires the account retirement fence before its
queue row, preventing the observed account/claim lock inversion; private handoff
exchange verifies both origins against the serving instance before consuming
the one-use secret. Real PostgreSQL lock barriers and wrong-instance HTTP tests
retain their failing and passing receipts. Existing account-identity baseline
failures remain separately classified; these results are not deployment proof.

Independent backend review closed four subsequent findings after real database
counterexamples: failed-password bookkeeping now tracks its second transaction
and acquires canonical admission locks before credential writes; exact replay
holds principal/workspace/operation/credential authority across scrypt; operator
password admission and both session/MCP bearer resolvers enforce the enabled
serving origin pair. The shared resolver scope contains no credentials. Final
backend checks passed 33/33 provisioning/password/client tests and 151/151
queue/MCP tests, with no skips, plus backend typecheck and the existing human Lab
lifecycle (parent records preserved; zero external model/business writes).
The reviewer closed all four findings with no new confirmed P0/P1. CLI/Web and
the final whole-branch review, delivery and deployed acceptance remain pending.

Root Task 2 checkpoint (2026-10-04): adopted 77 CLI/Web/documentation/CI files without replacing the reviewed backend. The Pi runner correctly rejected two mechanical wiki-routing files outside its original list; root inspected and explicitly accepted only those required documentation changes. Root checks passed: CLI 162/162 (zero skips), full Web 1737/1737, Web typecheck/lint, docs:check, and 10 executable CI-scope tests. The CI aggregate now denies failed/cancelled/missing/skipped runtime CLI jobs, and the MCP retry test waits for actual Web Crypto dispatch rather than a fixed microtask count. Web loopback transport preserves the separately registered backend origin, private cookies are bounded by both deadlines, and the public test entry has a themed responsive layout. These are local implementation results; installed staging CLI/Web/MCP and Notion acceptance remain Task 3.

Whole-branch review of `906582e3` identified a generated-password recovery
window between keyring persistence and journal mode persistence. Root retained
the failing production CLI regression and fixed exact-intent recovery without
adopting orphan credentials. Real HTTP/PostgreSQL counterexamples also admitted
Lab credential-change attempts and reconciliation proposals; no transfer into a
real account was executed. Locked user-kind guards now reject permanent
credential changes and either reconciliation direction. Newly provisioned
identities skip onboarding, and cleanup failures return an incomplete receipt
with the original recovery id. CLI checks passed 164/164, ordinary-account
credential regressions passed 10/10, and the reviewer independently passed the
three crash/cleanup/orphan checks. The complete provisioning suite passed 30/30
after assigning explicit deadlines to multi-instance and real-lock tests that
had retained the runner's five-second default. All original assertions remain.
Backend typecheck and regenerated wiki/docs checks passed. Source-frozen review
closure remains pending before PR delivery and deployed acceptance.
