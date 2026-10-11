# Project health audit — 2026-10-12

## Active delivery

- Status: in progress. Owner: Codex for scope, independent review, integration,
  revision-bound verification, deployment, PR and merge; Pi for sequential
  implementation in isolated worktrees.
- Outcome: repair the confirmed correctness/privacy/security defects, retire
  proven dead Web code, archive obsolete scaffolding, and enforce knowledge/tool
  ownership without changing applied SQL or unrelated work.
- Integration branch: `codex/project-health-oct12`, based on remote main
  `e751b37a8692a33387b7325004d7532face32021`.
- Accepted so far: audit inventory, independent synthetic before-change probes,
  dependency safety batch `81324609` after independent clean-install checks,
  immutable research state `1f5d50a1` after independent review and 133 host tests,
  and research allowance/sequencing `273ed9a1` after 414 Agent and 142 host tests
  plus actual same-Run process-interruption probes.
  Resident deployment and final delivery remain outstanding.
- Next Pi batch: backend error logging and Web admission. Research allowance
  recovery `20261012-050607-5d7531a8` passed review after two bounded parent
  corrections; search/fetch/profile each dispatched once at a maximum of one
  across actual command process death and same-Run recovery.
- Remaining order: error logging/Web admission; durable diagnostic privacy;
  model-context diagnostic privacy; dead Web retirement/meeting identity
  admission; knowledge/tooling ownership. Review and verify each diff before
  integration.
- Completion evidence: final local checks and real surface acceptance; latest
  PR-head applicable CI/security/branch gates; confirmed merge; clean committed
  resident API, Agent Host, Web and changed browser-executor revisions verified
  live; isolated test-account and temporary-resource cleanup read back.
- Boundary: the audit establishes these findings and checked scenarios, not an
  absence of unknown defects. Unpublished upstream braces remediation stays
  explicitly identified as a local mitigation.

## Frozen Pi audit observation

- Scope: full tracked repository at frozen base `4ee04b1883b50d7d708e72378a5aa39487a7834f` (audit only; this report is the only created file).
- Method: inventory and ownership scan of every tracked top-level area, deterministic read-only checks, static scans (imports, references, dependency usage, doc-command consistency), and detailed traces of representative risky entrypoints (Web API admission, unauthenticated model forwarding, backend lifecycle sweeps, lab account deletion, migration runner, CLI auth). No code, test, or documentation was modified; nothing was committed.
- Honest limit: 2,882 tracked files were inventoried and statically scanned; a minority of risky entrypoints were traced in detail. This report does not claim every line was manually reviewed or that all defects are found. Large files are recorded as debt, not defects.

## Verification performed

| Check | Result |
| --- | --- |
| `node scripts/check-docs.mjs` | PASS — 11 canonical documents, 445 Markdown files |
| `node scripts/wiki.mjs check` | PASS — 4 published pages |
| `node scripts/check-repository-hygiene.mjs` | PASS |
| `node scripts/check-brand-assets.mjs` | PASS — 5 SVG, 20 PNG |
| `node scripts/check-architecture-diagrams.mjs` | PASS — 3 scenes checked (see PA-2026-10-12-08 for the 2 unchecked) |
| `node scripts/check-architecture-boundaries.mjs` | BLOCKED — requires `typescript` from `node_modules`; dependency installation was out of scope (not a repository defect) |
| `node --test scripts/wiki.test.mjs` | PASS 8/0 |
| `node --test scripts/check-repository-hygiene.test.mjs` | PASS 7/0 |
| `node --test scripts/ai-workspace-entry.test.mjs` | PASS 6/0, 1 skipped (existing skip) |
| `node --test scripts/evaluation/*.test.mjs` | PASS 6/0 |
| `node --test scripts/prompts/library.test.mjs` | PASS 5/0 (but never executed by CI — see PA-2026-10-12-07) |
| Doc-vs-code claim spot checks (session title 32 chars, follow-up region cap 24, seven-/thirty-day retention language, `capir test create --preset daily`, all documented `pnpm`/`scripts/` paths) | consistent |
| TODO/FIXME/HACK/XXX scan over `apps/`, `packages/`, `scripts/`, `deploy/` | none outside tests |

Skipped honestly: `pnpm install`, typecheck/lint/build and all package test suites (dependency installation prohibited), backend/database runs, service startup, iOS/macOS/native builds (prohibited), evaluation harness runs (private `capir-evals` repository), and any model calls.

## Coverage per owner area

| Owner | Inventory | Static scan | Detailed trace | Unknowns / blockers |
| --- | --- | --- | --- | --- |
| Web (`apps/web`, 892 files) | full | imports/references for every `app`/`lib`/`components` file; all 103 API routes auth-pattern screened; dependency usage of all 25 runtime deps | `proxy.ts` admission boundary; `/api/analyze` model-forwarding path; dead-component family incl. mount points (`app/workspace/meetings/page.tsx` → `TimeWorkspace`); `lib/server/ai-analysis.ts` gating | runtime behavior of live pages unverified (no build); single-quote/dynamic-import edge cases mitigated by two independent scans |
| Backend / domain / migrations (`apps/backend`, `packages/domain`, 478 files) | full | module reference scan (only entrypoints unimported, expected); SQL interpolation sites reviewed | `database/migrate.ts` + manifest integrity; `sourceLifecycle.ts` sweep wiring vs `docs/architecture.md` claims; `agentSessions` retention sweep registration; `labWorkspaces.ts` account-graph deletion (table allowlist, fail-closed schema guard, readback); `harnessSessions.ts` savepoints | no live DB exercised; integration tests not run (deps) |
| Agent / host (`apps/agent`, `apps/agent-host`, 159 files) | full | package manifests, dependency usage, entrypoint scan | `screenshotPreprocess.ts` region-limit constant vs `docs/agent-system.md`; prompt registry entry (`prompts:sync` wiring) | SDK runtime behavior unverified |
| CLI (`apps/cli`, 73 files) | full | manifest; `auth.ts`/`authV2.ts` relationship; `browser-runner.ts` spawn wiring | `help.ts` vs `docs/operations/capir-cli.md` examples | binary behavior unverified (no build) |
| Contracts / shared UI (`packages/contracts`, `packages/workspace-ui`, 54 files) | full | manifest and version-pin consistency (react 19.3.0, typescript6 6.0.2 aligned across workspaces) | `packages/domain` placeholder ownership | — |
| iOS / macOS / hybrid (`apps/ios`, `apps/macos`, `apps/macos-hybrid`, 473 files) | full | structure, manifest, `scripts/macos/check.sh` test wiring (unittest discover, `node --test` pairs) | `scripts/macos` release-tool reference graph | native builds/tests prohibited; Swift file-level dead-code analysis not possible statically |
| Scripts / deploy / CI (126 files) | full | every documented and CI-referenced script path exists; CI `node --test` globs mapped to test files | `scripts/ci` scope scripts, `deploy/nango/configure-connect-ui.mjs` patch guard | release workflows not executed |
| Docs / research / ADRs / `_index` / plans / plugins (371 files) | full | link and wiki checks; documented-command consistency; ADR numbering; plan inventory (220 files) | ADR 0017 duplication; `plugins/talent-signal` vs `.agents/skills` overlap; `evals/README.md` migration record classified as historical | subjective doc-quality beyond consistency not judged |

## Confirmed findings

### PA-2026-10-12-01 — Superseded Web components retained dead, with tests that assert dead source (Medium)

- Owner area: Web. Root cause: superseded implementations were never retired, and their source-assertion tests were left running against unmounted files.
- Exact paths / verified lines:
  - `apps/web/components/integrated-workspace-app.tsx:112` (`export function IntegratedWorkspaceApp`) — 1,397 lines, not mounted by any route or component (repo-wide reference search matches only its own file plus two tests).
  - `apps/web/components/workspace-meetings.tsx:64` (`export function WorkspaceMeetings`) — 239 lines; `app/workspace/meetings/page.tsx:5` mounts `TimeWorkspace` instead; the live meeting surface is `time-workspace.tsx` → `time-meeting-inspector.tsx` → `meeting-month-grid.tsx` / `meeting-draft-actions.tsx`.
  - `apps/web/components/redline-workbench.tsx:246` — 455 lines, zero references.
  - `apps/web/components/hero-signal-preview.tsx:27` — 208 lines, zero references.
  - `apps/web/components/login-portraits.tsx:18` — 55 lines, zero references; builds the avatar path at `login-portraits.tsx:43`.
  - `apps/web/components/faq-list.tsx:3` — 26 lines, zero references.
  - `apps/web/lib/candidates.ts:17,33` (`CandidateRecord`, `candidateRecords`) — 216 lines, zero importers (verified by identifier search; `identity_candidates` matches elsewhere are unrelated strings).
  - Dead-only assets: `apps/web/public/concepts/relationships/avatars/welcome-5.png` … `welcome-11.png` (7 files, ~1.5 MB) referenced only from `login-portraits.tsx:12-15`.
  - Tests asserting dead source: `apps/web/lib/meeting-calendar.test.ts:56-58` (reads `workspace-meetings.tsx` and asserts strings in it), `apps/web/lib/integrationEvidenceNavigation.test.ts:5-11` (entirely about `integrated-workspace-app.tsx`), `apps/web/lib/workspaceLandmarks.test.ts:19-21` (one `it.each` case on `integrated-workspace-app.tsx`).
- Triggering scenario: any developer trusts green CI as coverage of the workspace meetings view or integration evidence navigation; or any consumer of `public/concepts/relationships/avatars/` assumes the welcome portraits are live product assets.
- Consequence: 2,596 dead lines plus ~1.5 MB dead assets drift from live conventions; three test files provide green coverage over unmounted code and will keep passing when the real surface (`time-workspace.tsx`) regresses.
- Proof/reproduction: two independent reference scans (import-specifier scan with both quote styles, then identifier-name search across `apps/`, including `grep -rln` repo-wide) agree that each listed file is referenced only by itself and the named tests; mount-point trace above shows `workspace-meetings.tsx` is not the meetings page.
- Proposed small repair: delete the seven files and the seven PNGs; remove the dead-file assertions from the three tests (keep `meeting-calendar.test.ts` assertions on live `meeting-draft-actions.tsx`, or re-point them at `time-meeting-inspector.tsx`); keep `welcome-1…4` iOS portraits untouched (they are separate platform bundles).
- Relevant tests: `apps/web/lib/meeting-calendar.test.ts`, `apps/web/lib/integrationEvidenceNavigation.test.ts`, `apps/web/lib/workspaceLandmarks.test.ts`; acceptance via `pnpm --filter @talent-signal/web test` and `pnpm --filter @talent-signal/web build`.
- Native/deployment implications: none for iOS/macOS. Per `AGENTS.md` work-to-proof rule 3 this is a Web runtime change and authorizes/needs a clean-source redeploy of the resident Web service by the delivery owner.

### PA-2026-10-12-02 — Two decision records share stable ID `0017` (Low)

- Owner area: docs/ADRs.
- Paths / lines: `docs/decisions/0017-desktop-maintenance-controls.md:1` and `docs/decisions/0017-three-scope-memory-review.md:1`.
- Scenario: prose references such as “ADR 0017” (`docs/architecture.md:26`, `docs/decisions/2026-09-24-one-click-desktop-updates.md:12`, `docs/decisions/0016-shared-desktop-workspace-surface.md:3`) resolve to a number that names two different decisions.
- Consequence: the stable-ID contract the repository relies on for review and synthesis is ambiguous; a reviewer citing “ADR 0017” can silently mean the other record.
- Proof: both titles in the files above; `docs/decisions/` numbering runs 0001–0023 plus dated records, with `0024` free.
- Proposed small repair: renumber `0017-three-scope-memory-review.md` to `0024-three-scope-memory-review.md`, update its inbound links (search `0017-three-scope`), and run `node scripts/check-docs.mjs`.
- Tests: `node scripts/check-docs.mjs` (link integrity).
- Native/deployment: none.

### PA-2026-10-12-03 — Duplicate and gapped migration numeric prefixes (Low)

- Owner area: backend/migrations.
- Paths / lines: `apps/backend/src/database/migration-manifest.json` entries at positions 47–48 (`047_proposed_extracted_text`, `047_screenshot_contact_tasks`), 59–63 (`058_product_run_monitor`, `058_account_management`, `059_lab_account_cleanup`, `058_claude_harness_sessions`, `059_harness_identity_lifecycle`), 77–78 (`073_conversation_queue`, `073_account_onboarding`); sequence jumps `086` → `088` (no `087`).
- Scenario: a reviewer, incident response, or migration note says “migration 058” or “073”.
- Consequence: the reference names up to three different migrations. Execution itself is safe (see checked suspicions), but human audit trails become ambiguous.
- Proof: manifest positions listed above; directory listing shows the same duplicated prefixes and the 087 gap.
- Proposed small repair (no renaming of applied migrations — see safety note in checked suspicions): add a forward-only uniqueness rule (new migration files must use a unique prefix) as an assertion in `apps/backend/src/database/schema.test.ts` or `scripts/check-repository-hygiene.mjs`, and one line in `apps/backend/AGENTS.md` or the migration manifest noting that the manifest array is the order authority and prefixes are historical labels only.
- Tests: `node --test scripts/check-repository-hygiene.test.mjs` or backend `schema.test` after the assertion is added.
- Native/deployment: none (no migration bytes change).

### PA-2026-10-12-04 — Root `task.md` is a stale task artifact outside the documented plan surfaces (Low)

- Owner area: docs/plans hygiene.
- Path / lines: `task.md:1-12` (224-line slice definition, “Agent-first contact orchestration”, iOS composer outcome).
- Scenario: a contributor reads the repository root and treats `task.md` as current scope, or replans work already delivered.
- Consequence: `docs/documentation.md` requires task artifacts to be “consolidated, archived, or removed when the task ends”; `PLANS.md` is the documented plan contract and `plans/` the dated home. The file was added in `aa9e3302` (“Add Agent-first relationship CRM (#107)”) and never revised; its subject area is covered by `plans/2026-08-28-conversation-first-contact-intake.md`, which ends with completed, verified evidence.
- Proof: `git log --oneline --all -- task.md` shows exactly one commit; no repository reference to `task.md` outside itself.
- Proposed small repair: merge any still-unachieved outcome (e.g., the physical-device Foundation Models run that `plans/2026-08-28-…:317-320` still lists as a boundary) into the owning dated plan, then delete `task.md`, or move it under `plans/` with its date and completed status.
- Tests: `node scripts/check-docs.mjs` after the move.
- Native/deployment: none.

### PA-2026-10-12-05 — `.top1-design/` is unreferenced working scaffolding (Low)

- Owner area: abandoned temporary artifacts.
- Paths: `.top1-design/` (11 tracked files: `GOAL.md`, `TASTE.md`, `QUALITY_TREE.json`, empty `ledger.jsonl`, `EVALUATION.example.json`, `PAIRS.example.jsonl`, `REFERENCE_CARD.example.json`, two `.gitkeep` directories, `references/rapid-home-sprint.md`).
- Scenario: the directory is read as an active design-evaluation system (`Status: active` in `GOAL.md:3`) although no script, skill, doc, CI job, or plan references it.
- Consequence: an empty ledger and example-only inputs present an abandoned workflow as active state; future agents may treat `QUALITY_TREE.json` as binding design policy with no owning process.
- Proof: repo-wide search for `top1-design`/`top1` outside the directory finds no reference (the single plan-line hit is unrelated text).
- Proposed small repair: if the design-taste workflow is retired, delete the directory; if it is owned by an external skill, move it out of the tracked tree and record the home in `docs/documentation.md`’s routing. Decision belongs to the design owner.
- Tests: `node scripts/check-repository-hygiene.mjs`, `node scripts/check-docs.mjs`.
- Native/deployment: none.

### PA-2026-10-12-06 — Two candidate-signal skills with divergent output contracts and no stated ownership relation (Low)

- Owner area: skills/plugins.
- Paths / lines: `plugins/talent-signal/skills/analyze-candidate-signal/SKILL.md:1-62` with `references/output-contract.md` (input `authorization`/`messages`, output `prepare_question` proposal or `no_action`) versus `.agents/skills/candidate-signal-analysis/SKILL.md:1-23` with `references/output-contract.md` (output `facts`/`action_cards` (`create_contact`, `update_contact`, `create_meeting`) plus `verdict` `advance|resolve_blocker|at_risk|wait`).
- Scenario: an agent or reviewer applies the wrong contract to the same input; the plugin contract forbids contact writes while the repo skill contract emits `create_contact`/`update_contact` cards and a momentum verdict.
- Consequence: two “authoritative” shapes for one claim domain; artifacts validated against one contract are invalid under the other; guardrail wording (e.g., verdict vocabulary) diverges over time.
- Proof: `plugins/talent-signal/.codex-plugin/plugin.json` describes the plugin as distributable, but nothing in `docs/`, `.agents/`, `.claude/`, `scripts/`, or CI states how the two relate; `docs/documentation.md` demands one authoritative home per claim.
- Proposed small repair (small): add a short “relationship to `.agents/skills/candidate-signal-analysis`” section to the plugin SKILL (or a pointer in `docs/README.md`) stating which surface owns which contract. Larger unification is a proposal (see batches).
- Tests: `node scripts/check-docs.mjs` after doc edits.
- Native/deployment: none.

### PA-2026-10-12-07 — `scripts/prompts/library.test.mjs` is never executed (Low)

- Owner area: scripts/CI.
- Path: `scripts/prompts/library.test.mjs` (tests `scripts/prompts/library.mjs`, the content-hash/version validation used by `scripts/prompts/opik.mjs` for prompt sync/import).
- Scenario: a regression in prompt version validation lands; CI stays green.
- Consequence: the prompt-release path (`prompts:sync`/`prompts:import`, which feeds the bundled prompt contract in ADR 0013) loses its deterministic guard silently.
- Proof: the file is referenced by no package script and no workflow. `ci.yml` wires tests explicitly (`ci.yml:164-169`, `:203`, `:290-294`, `:343`, `release-macos.yml:66`) and none covers `scripts/prompts/`; the test passes standalone (5/0), confirming it is runnable but unwired.
- Proposed small repair: add `scripts/prompts/library.test.mjs` to the `ci.yml:164` `node --test` list or to the `secrets:check:test` script list in `package.json:77`.
- Tests: `node --test scripts/prompts/library.test.mjs`.
- Native/deployment: none.

### PA-2026-10-12-08 — Agent architecture diagrams: unwired generator, unchecked sources (Low)

- Owner area: docs/automation.
- Paths / lines: `package.json:18` (`architecture:generate` runs only `scripts/generate-architecture-diagrams.mjs`, which emits `talent-signal-product-architecture.excalidraw` and `talent-signal-system-architecture.excalidraw`, see `scripts/generate-architecture-diagrams.mjs:1458-1462`); `scripts/generate-agent-architecture-diagrams.mjs:1560-1568` emits the three agent scenes but is referenced by no package script, CI job, or doc; `scripts/check-architecture-diagrams.mjs:205,238,288-292` checks only product, system, and `talent-signal-agent-module-blueprint`.
- Scenario: `docs/talent-signal-agent-control-plane.png` or `talent-signal-agent-runtime-flow.png` (both embedded in `docs/agent-system.md`) drift from their `.excalidraw` sources, or an editor changes those two sources.
- Consequence: two of five checked-in diagram sources have no deterministic drift check and no documented regeneration path, contradicting the REVIEW.md principle “Are generated views rebuildable?”.
- Proof: the three `checkScene` config entries above; `architecture:diagrams:check` output lists exactly three scenes; no reference to `generate-agent-architecture-diagrams` anywhere in `package.json`, `.github/`, `docs/`, or `scripts/`.
- Proposed small repair: add `"architecture:agent-generate": "node scripts/generate-agent-architecture-diagrams.mjs"` (and an `architecture:generate` composition), and extend `check-architecture-diagrams.mjs` with scenes for `talent-signal-agent-control-plane.excalidraw` and `talent-signal-agent-runtime-flow.excalidraw` (phrase/font thresholds per existing pattern).
- Tests: `node scripts/check-architecture-diagrams.mjs`.
- Native/deployment: none.

### PA-2026-10-12-09 — Unauthenticated model-forwarding endpoint: production gate and trust inputs undocumented (Low, becomes Medium if the public demo is enabled on a resident deployment)

- Owner area: Web (privacy/cost boundary).
- Paths / lines: `apps/web/app/api/analyze/route.ts:23-28` (`sameOrigin` returns true when the `Origin` header is absent or `NODE_ENV !== "production"`), `:39-44` (rate-limit identity from client-controllable `x-forwarded-for`/`x-real-ip`, fallback `"local"`), `:78-82` (forwards up to 12,000 chars of conversation text to a model); `apps/web/lib/server/ai-analysis.ts:36-50` (production enablement requires `TALENT_SIGNAL_ALLOW_PUBLIC_AI_DEMO === "true"` alongside `TALENT_SIGNAL_AI_ENABLED` and `OPENROUTER_API_KEY`); `apps/web/proxy.ts:8-9` documents the deliberate separate admission boundary.
- Scenario: a deployment sets `TALENT_SIGNAL_ALLOW_PUBLIC_AI_DEMO=true` (the flag pair is registered in the Infisical contract, `config/infisical-secrets.json:141-143`). Any unauthenticated caller without an `Origin` header can POST arbitrary conversation text to a third-party model endpoint; the 8-requests-per-minute limit is keyed on a spoofable header.
- Consequence: cost abuse is unauthenticated, and conversation content a visitor submits leaves to OpenRouter with no account, purpose record, or retention disclosure on the surface. The gate design itself is deliberate and fail-closed when unset; the defect is the missing operational documentation and the weak rate-limit identity.
- Proof: code lines above; `docs/operations/secrets.md` and `.env.example` describe `OPENROUTER_API_KEY` but never `TALENT_SIGNAL_AI_ENABLED` or `TALENT_SIGNAL_ALLOW_PUBLIC_AI_DEMO`; tests (`apps/web/lib/server/bigModel.test.ts`) cover the flag for analysis but not the abuse path.
- Proposed small repair: document both flags and the privacy boundary in `docs/operations/secrets.md` and `.env.example`; in `route.ts`, rate-limit on a non-spoofable identity (e.g., edge rate limiting or a signed demo session) and treat a missing `Origin` on POST as cross-origin in production. Whether the public demo keeps raw conversation input at all is a product choice (see proposals).
- Tests: add a route test for missing-`Origin` in production and for rate-limit identity; existing `apps/web/lib/server/ai-analysis.test.ts`-family remains the gate evidence.
- Native/deployment: any change to `apps/web` triggers the standard resident-Web redeploy requirement (delivery owner).

### PA-2026-10-12-10 — `packages/domain` is a README-only placeholder with superseded intent (Low)

- Owner area: contracts/shared.
- Path / lines: `packages/domain/README.md:1-3` (“Keep Candidate, Evidence, ActionCard, and Insight contracts platform-neutral. Add code only after the iOS client and API agree on the first stable shape.”).
- Scenario: a contributor looking for the platform-neutral domain contracts finds this package first, although `packages/contracts` (TypeBox schemas consumed by Web, backend, CLI, evaluation) has since become the actual contract home, and iOS carries its own `Sources/Domain` models.
- Consequence: unclear ownership of the word “domain”; the stated gate (“after the iOS client and API agree”) is stale, since agreement is now expressed in `packages/contracts` and backend contract tests (`apps/backend/src/contracts.test.ts`).
- Proof: `packages/domain` contains exactly one tracked file and no `package.json` (not a workspace package); no import references it.
- Proposed small repair: delete the directory or convert the README into a two-line pointer to `packages/contracts` and `apps/ios/Sources/Domain` naming the current owner of each contract class.
- Tests: `node scripts/check-docs.mjs` if the README is rewritten in place.
- Native/deployment: none.

## Checked suspicions that are not defects

- Migration runner safety despite duplicate prefixes: `apps/backend/src/database/migrate.ts:13-58` applies migrations in `migration-manifest.json` array order with per-file SHA-256 checksums recorded in `schema_migrations`; the manifest is complete and in bijection with the 102 `.sql` files (verified). Renaming applied migrations would change the version key/checksum and is therefore explicitly not proposed.
- `labWorkspaces.ts:270` interpolated `DELETE FROM "${t}"` statement: table names come from `this.tables()` (`labWorkspaces.ts:41-53`), which validates `^[a-z][a-z0-9_]*$`, requires the `lab_test_workspace_write_guard` trigger, and fails closed (503) on any unknown schema table. Not injectable as written.
- `harnessSessions.ts:44-46` savepoint names: `harness_${randomUUID()}` — safe identifier interpolation.
- Lifecycle sweep coverage matches documentation: `sourceLifecycle.ts:33-36` sweeps source retention, source authorization expiry, and identity-handle freshness; `app.ts:3178-3195` registers contact-task retention, source-lifecycle, and desktop-browser-login sweeps on `retentionSweepIntervalMs`; agent-session retention runs via `agentSessionRoutes.ts:171`; MCP OAuth cleanup has a restart-safe pump (`app.ts:3197-3200`). No orphaned lifecycle claim found in `docs/architecture.md`.
- CLI `auth.ts` vs `authV2.ts`: complementary (`auth.ts` = `auth status`/`auth logout` commands; `authV2.ts` = versioned keyring protocol client), not duplicate implementations.
- `apps/chrome-extension/` (2 files): thin repackaging of `apps/browser-extension/load-unpacked/` with an integrated test barrel; not abandoned.
- `scripts/macos/validate_appcast_test.py` and other `*_test.py`: executed via `python3 -m unittest discover -p '*_test.py'` in `scripts/macos/check.sh:14`. `scripts/macos/prove-release-boundaries.mjs` is a manual proof tool — flagged as minor documentation gap only, not counted as a defect.
- `/api/dev/agent-stream` (`route.ts:11-13`): returns 404 in production. Properly gated.
- Welcome portraits duplicated across `apps/web/public/...` and `apps/ios/Resources/Assets.xcassets/...` with identical bytes: per-platform bundling, and iOS `WelcomePortrait1-4` are live there; only the Web copies listed in PA-2026-10-12-01 are dead.
- `design-qa.md` (root, 2,165 lines): actively referenced by `plans/v1/04-proposal-review-apply.md:141`, `plans/2026-09-02-ios-today-inline-decisions.md:62`, and `plans/2026-08-28-conversation-first-contact-intake.md:329,381` as the design-adjudication record. Historical record in active use, not obsolete guidance.
- `evals/README.md`: an accurate historical/compatibility record of the GET-134 extraction (paths and digests preserved, private-repo boundary explicit). Keep.
- Root `index.html` + `css/opening.css` + `js/opening.js`: a tracked, intentionally archived design prototype from `159c6402` (#241), self-contained and not linked from any runtime surface. Borderline, but classified as a deliberate historical prototype; no action recommended beyond an owner decision if root cleanliness is desired.
- Documented executable surface: every `pnpm <script>` named in docs/README/AGENTS/CONTRIBUTING resolves to a `package.json` script; every `./scripts/…` path named in docs resolves to a tracked file; every script path referenced by `.github/workflows` exists.
- Dependency manifests: all 25 Web runtime dependencies and every backend/agent/CLI/workspace package dependency has at least one real import; workspace version pins (react 19.3.0, typescript6 6.0.2, playwright 1.63.0, typebox ^0.34.41) are consistent across packages.
- Web API auth screen: all 103 `route.ts` handlers either call a session helper or delegate to `lib/server/*` route helpers that own authentication; the residual unauthenticated set is the documented separate-boundary family (`proxy.ts:8-25`: `/api/analyze`, `/api/mcp`, `/api/desktop-auth`, `/api/capir/*` POST, `/api/auth`, `/api/browser-extension`, `/api/dev`) plus thin delegates verified to authenticate inside `memoryReview`/`conversationQueue`/`timeWorkspace` helpers.
- Large-file debt without defect claims: `apps/ios/Resources/Localizable.xcstrings` (784 KB), `apps/ios/Sources/Features/RelationshipAskView.swift` (378 KB), `apps/ios/UITests/CandidateSignalUITests.swift` (329 KB), `apps/web/app/globals.css` (304 KB), `apps/backend/src/modules/memoryReview.integration.test.ts` (200 KB). Size alone; no defect claimed.

## Ordered implementation batches

Batch 1 — Web dead-code retirement (concrete, fixable). Files owned: delete `apps/web/components/{integrated-workspace-app,workspace-meetings,redline-workbench,hero-signal-preview,login-portraits,faq-list}.tsx`, `apps/web/lib/candidates.ts`, `apps/web/public/concepts/relationships/avatars/welcome-{5,6,7,8,9,10,11}.png`; edit `apps/web/lib/meeting-calendar.test.ts`, `apps/web/lib/integrationEvidenceNavigation.test.ts`, `apps/web/lib/workspaceLandmarks.test.ts` (remove/re-point dead-file assertions only — never weaken assertions on live files).
Acceptance: `pnpm install && pnpm --filter @talent-signal/web test && pnpm --filter @talent-signal/web lint && pnpm --filter @talent-signal/web build && node scripts/check-repository-hygiene.mjs` plus a grep proving zero remaining references to the deleted basenames.

Batch 2 — Stable-ID hygiene (concrete, fixable). Files owned: `docs/decisions/0017-three-scope-memory-review.md` (renumber to `0024-…`), its inbound linkers, `apps/backend/src/database/schema.test.ts` or `scripts/check-repository-hygiene.mjs` (forward-only unique-prefix assertion), one note in `apps/backend/AGENTS.md` stating the manifest is the order authority. Do not rename or re-checksum applied migrations.
Acceptance: `node scripts/check-docs.mjs && node scripts/wiki.mjs check && node --test scripts/check-repository-hygiene.test.mjs` and the touched backend test.

Batch 3 — Test/tooling wiring (concrete, fixable). Files owned: `.github/workflows/ci.yml` or `package.json` (wire `scripts/prompts/library.test.mjs`), `package.json` (add `architecture:agent-generate`), `scripts/check-architecture-diagrams.mjs` (cover `talent-signal-agent-control-plane.excalidraw` and `talent-signal-agent-runtime-flow.excalidraw`).
Acceptance: `node --test scripts/prompts/library.test.mjs scripts/check-architecture-boundaries.test.mjs` (after `pnpm install`), `node scripts/check-architecture-diagrams.mjs`, `pnpm docs:check`.

Batch 4 — Documentation of the public-AI boundary (concrete, fixable). Files owned: `docs/operations/secrets.md`, `.env.example` (document `TALENT_SIGNAL_AI_ENABLED`, `TALENT_SIGNAL_ALLOW_PUBLIC_AI_DEMO`, and the unauthenticated-forwarding boundary). Rate-limit/`Origin` hardening in `apps/web/app/api/analyze/route.ts` with its tests is a follow-up that touches runtime.
Acceptance: `node scripts/check-docs.mjs && node scripts/wiki.mjs check`, and if the route changes: `pnpm --filter @talent-signal/web test && pnpm --filter @talent-signal/web build` plus the resident-Web redeploy by the delivery owner.

Proposals requiring a larger architectural or owner choice (not concrete fixes):
- Disposition of `task.md` and `.top1-design/` (PA-04, PA-05): delete, archive under `plans/`, or declare an owner — requires the design/workflow owner’s decision on whether the top1 design-evaluation flow is still active.
- Unification of the two candidate-signal contracts (PA-06): converging `plugins/talent-signal` and `.agents/skills/candidate-signal-analysis` on one output contract changes a distributable plugin interface and a repo skill contract simultaneously; only the pointer documentation is a small fix.
- Whether the public demo should keep raw conversation input at all (PA-09): removing it changes a marketed surface (`Try the synthetic demo` in `README.md`) and needs a product decision; the gate, once documented, is already fail-closed.
- Fate of `packages/domain` (PA-10): delete versus pointer depends on whether the “platform-neutral domain contracts” are expected to grow beyond `packages/contracts`.

## Coverage honesty statement

This audit covered every tracked owner area at inventory and static-scan depth and traced the risky entrypoints named above in detail. It does not establish that every line was manually reviewed, does not rule out runtime-only defects in the un-executed test suites and services, and carries the environment blockers listed in Verification as explicit unknowns. No high-severity correctness, security, privacy, or lifecycle defect was confirmed in the traced entrypoints; the Medium finding is maintenance/coverage integrity (PA-2026-10-12-01). All findings above are specific, path- and line-bounded, and independently reviewable; none was produced to meet a quota.


## Independent delivery-owner findings

The Pi report above is a frozen audit observation, not a delivery verdict.
Independent synthetic probes and full dependency inspection add the following
findings. These override any impression that the initial static audit established
an absence of high-priority defects. No real-person data was used.

| ID | Priority | Confirmed problem and proof | Repair and acceptance |
| --- | --- | --- | --- |
| PH-01 | P1 | `apps/agent-host/src/localResearchStore.ts` and `localPersonResearchStore.ts` read before unconditional atomic rename. Ten synthetic competing starts and ten conflicting terminal pairs were both accepted in 10/10 trials; the final writer replaces the earlier identity or receipt. | Exclusive immutable publication shared by both stores; conflict/readback, true concurrent-process, corruption, cleanup and restart tests. Preserve mutable checkpoint behavior and authorization/budget boundaries. |
| PH-02 | P1 | `apps/backend/src/lib/requestLogger.ts` lacks a bounded error serializer. A real Fastify/Pino error carrying a synthetic private-content canary retains its message/stack despite body-field redaction; the production error handler logs raw `err`. | Central privacy-preserving error serialization plus actual logger/error-handler tests. Keep safe correlation and closed diagnostic codes. |
| PH-03 | P2 | `scripts/check-docs.mjs` scans arbitrary filesystem Markdown. An ignored `output/` fixture with a missing local link fails the documentation gate. | Git index/tracked inventory with explicit failure handling; test tracked broken links, staged additions and ignored artifacts. |
| PH-04 | P2 | Public analysis and screenshot-analysis routes duplicate unbounded Maps. Expired unique forwarded-address keys are never removed unless reused. | Shared bounded expiring limiter, finite keys, fail-closed capacity and preserved route limits/auth order; document trusted proxy and origin assumptions. |
| PH-05 | P2 | `docs/architecture.md` still calls recruiting the flagship template; `docs/design-system.md` applies candidate terminology to general person/relationship pages. Current product/principles define the broader personal Agent. | Narrow canonical wording correction; retain dated recruiting research as history. |
| PH-06 | P2 | `CONTRIBUTING.md` and `docs/operations/ci-cd.md` still direct contributors toward Codex-first model review. | One canonical current-head local MiMo review procedure, with independent Codex judgment and deterministic gates preserved. |
| PH-07 | P1/P2 | Frozen production graph reports 1 high and 12 moderate advisory entries; the entire graph adds 2 high development advisories. Existing dependency review scans changed dependencies, not the complete resident graph. Resolved packages and upstream availability were checked independently. Presence is not proof of product exploitability. | Compatible dependency repairs, remove unused Mammoth CLI-only argparse graph, mitigate unpublished braces fix without fabricated versions or broad ignores, and add mandatory whole production graph audit. |

Unavailable upstream versions matter: npm has no `sprintf-js@1.1.4` or
`braces@3.0.4` at this audit date. Mammoth library use is separate from its unused
CLI dependency. Any local braces mitigation must remain identified as a local
patch; an upstream advisory may remain visible despite mitigation. Never report
an audit suppression as a fixed upstream release.

## Delivery-owner disposition

Implementation order: dependency safety and gate; immutable research state;
private error logging and Web admission resource bounds; confirmed dead Web
code; deterministic knowledge/tooling ownership and stale guidance. Codex reviews
each Pi diff and evidence before integration. Applied migration names/checksums
remain stable. Historical design/evaluation records remain evidence, and large
native files remain debt unless an observable failure justifies a native change.

Final accepted dispositions and revision-bound checks will be recorded here
before PR delivery. The initial report's proposed batches are recommendations;
the actual contracts and final acceptance are owned by Codex.


### Independent reference-graph correction and additional boundary finding

A TypeScript AST/module-resolution traversal of 508 non-test Web modules from
160 Next route/layout entrypoints found 17 unreachable component/helper modules
(3,651 lines), after explicitly excluding Next metadata entrypoints and build
configuration from dead-code conclusions. There were no nonliteral dynamic
imports. The seven directly unreferenced modules in PA-01 are the roots of a
larger dead closure: old meeting helpers, SignalJourney/reduced-motion hook,
legacy Plugs UI/helpers, and synthetic integration/browser-handoff helpers.
Five exclusively imported CSS modules add 4,102 dead lines. Actual native/
marketing image consumers were checked independently; shared SignalJourney
images and workspace-meetings CSS stay in use and must remain.

The initial Pi trace mistakenly calls `meeting-month-grid.tsx` live: it is
referenced only by the unmounted `workspace-meetings.tsx`. The live Time
workspace uses its own grid. CalendarDraftReview state does remount during
TimeMeetingInspector's loading boundary, so absence of an explicit React key
alone is not a demonstrated state-leak defect.

PH-08 (P2): `apps/web/components/time-meeting-inspector.tsx` validates the
response's schema but not its draft identity against the selected/requested
ID. A synthetic actual React render requested draft B and accepted a valid
draft A into actionable CalendarDraftReview while persistence remained bound
to B. The observation probe passed in the shipped happy-dom/React surface;
its temporary test was removed after evidence capture. The backend normally
filters by identity, so this is a missing client admission check, not proof of
an exploited cross-account read. Repair with exact identity/revision admission
and live-surface regression tests in the dead-code retirement batch.

Both diagram generators were executed in a task-owned temporary directory.
All five generated Excalidraw sources matched the committed bytes exactly.
PA-08 is a wiring/coverage gap, not a confirmed current diagram-source drift.


PH-09 (P2): failure metadata is a second private-data boundary. A synthetic
shipped `uploadChatMediaContent` invocation proved that an arbitrary storage
`Error.message` is persisted verbatim as `chat_media_assets.failure_reason`,
although the client receives a fixed retry message. The same static pattern
occurs in source-authorization compilation responses/job errors, public research
warnings/retry metadata and MCP continuation outbox errors. Adjacent socket/tool
adapters admit arbitrary code-shaped strings into failure responses/detail;
uppercase or a prefix is not a closed diagnostic vocabulary. A second actual `createWorkspacePublicResearch.execute` synthetic probe showed a code-shaped private Error message copied into both model-facing error detail and attempt metadata. A separate Pi batch
will replace untyped failure content with fixed operation diagnostics, preserve
provenance/retry/lease/idempotency behavior, and exercise the actual producer and
consumer boundaries with synthetic canaries. No real-person or credential leak
was observed; historical stored metadata is outside this prevention change.

The additional native sign-out controller reentrancy suspicion was not promoted
to a defect: production callsites acquire the shared maintenance barrier and
set the root store's `isWorking` before suspension. UI retries and environment
activation honor that barrier. No native source change or simulator run is
justified by this rejected suspicion.


PH-10 (P2): the control-plane evaluator's `liveTrials` receipts report a
hardcoded SDK version `0.3.241` in both missing-proof and completed branches,
while the installed, validated SDK is `0.3.287`. This misattributes otherwise
reviewable evaluation evidence. The tooling batch will reuse the existing
package-manifest-derived `CLAUDE_SDK_VERSION` authority for both receipts, rather
than substitute another drifting literal. Credential/model gates and actual
trial outcomes remain unchanged; no new live model trial is authorized by
this metadata repair.

## Accepted dependency repair and independent receipt

- Integrated `81324609`: compatible dependency repairs, removal of Mammoth's
  unused CLI-only argparse graph, a frozen local braces depth patch, and a
  mandatory full production audit in the existing Security required gate.
- Codex reviewed all six files including untracked patch/tests, and required
  the patch test to bind the active install to the current frozen digest while
  tolerating unrelated stale package directories. No audit suppression added.
- Pi repair: frozen offline install, production audit (zero advisories), Agent
  and backend typechecks, real DOCX extraction 3/3, patch regressions 10/10,
  workflow policy 6/6, docs check all passed.
- Codex independent integration: an incremental frozen install retained old
  unpatched package content under the new digest directory; the regression
  gate correctly failed four tests. A clean minimal install reproduced proper
  patch application, then a fresh complete frozen offline install passed
  22/22 patch, workflow and existing CI scope-policy tests. Deployment must
  use clean dependency trees and verify actual patch behavior. The failed run
  is retained as evidence and is not counted as a pass.
- Backend Docker dependency layer now includes `patches/` before install;
  final clean image remains unverified. Codex real portable capir packaging
  passes 6/6 tests: official Node download and SHA verification, production
  dependency closure, confined archive extraction and relocated execution.
  The patch regression gate still passes 10/10 after deploy-tree restoration.
- Full graph still reports the development-only upstream braces advisory;
  the local patch deliberately rejects nesting above 100 and is a mitigation,
  not an upstream released fix. Product production graph is clean.
- Full baseline Web lint passes with six unused-symbol warnings; those exact
  bindings are assigned to the Web retirement batch without removing proof
  reads or authentication behavior. ESLint10 peer-range warnings are a known
  compatibility boundary: current Next configs already use @eslint/compat
  and actual lint passes. No lint downgrade or suppression is planned.

## Extended model-context diagnostic proof (PH-09)

Two further actual synthetic probes confirm arbitrary error content reaches
model-facing tool results: `currentImageInspection.execute` preserves a private
`IMAGE_INSPECTION_*` string, and `runPublicResearchAgent` returns a generic
gateway exception message to the actual scripted provider callback. Both
observations pass in the corrected narrow probe (2/2). The initial probe also
incorrectly expected that message in persisted journal output; it failed that
assertion. Journal events/outputs are actually bounded and remain free of the
canary, which the corrected probe explicitly verifies. No journal leak is
claimed for this generic tool error.

Static producer traces show untyped transport messages interpolated into typed
search/direct-fetch/Firecrawl errors, then relayed by local gateways. PH-09 scope
now includes fixed unknown-error fallbacks in all three Agent runners, a finite
image diagnostic vocabulary, and fixed transport failures at those actual host
producers. Existing typed policy feedback, approved evidence, cancellation,
source revocation, budgets and terminal semantics remain required. No external
provider was called. Temporary source probes were removed after evidence capture.

The owned baseline browser was gracefully stopped after its rendered daily
workspace receipt was retained. The baseline test run was then stopped and read
back as `deleted`, with no cleanup error; capir confirmed removal of the local
run credential. Its private credential projection was deleted after the
sanitary lifecycle receipt was retained. Final deployment acceptance will use
a fresh isolated run, followed by its own stop/readback cleanup.

The newly confirmed model-context paths are assigned to a separate sequential
`model-context` Pi batch after durable diagnostic retention. It owns the three
Agent runner fallbacks, current image inspection and three host transport
producers/tests. This keeps each reviewed change bounded while preserving one
writer and one integration/review owner. The overall delivery remains pending.


## Persistence review checkpoint — changes requested

The first Pi implementation adds immutable hard-link publication and per-Run
SQLite admission around the real CLI and person-image entrypoints. Its own
118-test suite passes, but the runner initially stopped at scope validation:
a strict TypeScript declaration companion to the owned MJS process fixture was
necessary. The delivery owner inspected and narrowly approved that test-only
companion; provider/model, base, limits and cumulative accounting are unchanged.
This is not an accepted implementation receipt.

Independent exact-source snapshots and synthetic probes reproduce further
repair requirements in the new code:

- Opening a FIFO with blocking `O_RDONLY` stalls before the regular-file check;
  the owned probe child exited only at its explicit kill deadline.
- Both writers delete a pre-existing, unowned temporary sentinel when exclusive
  creation fails with `EEXIST`. Cleanup must follow successful ownership.
- The person store accepts invalid nested candidates and manifest members;
  terminal parsing accepts `artifact_created` without an artifact ID. These are
  corrupt deserialization successes. The service response schema separately
  rejects invalid artifact output; no escaped confirmed identity is claimed.
- The test build fixture steals a lock based only on age and lacks general
  owned-child cleanup before deleting temporary state after assertion failures.
- The shared fingerprint guard newly accepts uppercase digests, unlike the
  original canonical lowercase validators.

Pi is repairing these five findings in the same task. Acceptance requires
meaningful regressions, unfiltered required checks, and delivery-owner re-review
and integration proof. No later implementation batch or PR has started.


## Interrupted research-call budget recovery proof (PH-11, P2)

Three additional synthetic probes use the shipped compiled public CLI and
person-image entrypoints, real local stores, scripted models and mock provider
callbacks. Each authorizes at most one operation, waits at an IPC barrier after
the operation has been dispatched, kills only the owned child, waits for exit,
and recovers the same immutable Run from a fresh child. Search, Web fetch and
person-profile lookup each dispatch twice against a cap of one. Fetch preserves
a checkpoint with `fetchCalls: 0`; search/person have no checkpoint yet. No
external provider or model service was called. The first probe setup omitted
an explicit synthetic fetch gateway and correctly hit the existing Firecrawl
credential gate before any dispatch; that setup failure is not a source defect.

The actual runners increment call counters in memory before dispatch but save
checkpoints only after a tool result. A process interruption therefore loses a
consumed allowance. Immutable files and kernel-owned live-process admission do
not independently repair this counter boundary. A separate sequential Pi batch
after persistence will save the existing checkpoint/counters before authorized
search/fetch/profile dispatch, fail closed if that save fails, and conservatively
keep possibly dispatched operations consumed after interruption. Existing
checkpoint schemas, journal sequence, cap-denial codes and terminal semantics
remain the authority; no automatic allowance refund or retry authorization is
added. Actual forked command recovery and runner checkpoint-failure regressions
are required. This finding concerns those call caps, not an exactly-once remote
effect or cumulative model-billing guarantee.


## Concurrent research-tool journal ordering proof (PH-12, P2)

Synthetic providers enqueue two valid callbacks through the supported provider
interface with `Promise.allSettled`. Both shipped public CLI and person-image
commands use real stores, with a checkpoint wrapper holding the first write
until the second has completed. Two operations are authorized and dispatched,
but each command fails with a journal sequence mismatch. This is a reproducible
callback-concurrency scenario; no live SDK/provider or production incident is
claimed. The Claude adapter passes those callbacks independently and does not
provide a Run serialization barrier.

The research recovery batch will serialize whole tool execution within each Run
through counter reservation, gateway dispatch, checkpoint and journal append,
then drain admitted work before provider/terminal settlement. Different Runs
remain independent; fatal execution rejection blocks later queued work. This
ordering is also needed to keep PH-11's pre-dispatch checkpoints from replacing
newer counter snapshots during concurrent callbacks. Existing denial, abort and
terminal semantics remain covered by tests. The before probes intentionally
require concurrent writes and are not valid after-fix tests; new regressions
will explicitly verify queued execution and ordered journal results.

## Accepted persistence repair

- Integrated commit: `1f5d50a1`; Pi task `20261012-030523-ed97720c`, frozen
  base `bbf75013b3980b4e1d85bc40742efac9aa91b2cd`.
- Immutable run/artifact/no-action/terminal records publish complete exclusive
  temporary files with no replacement; equivalent retries retain original IDs,
  bytes and timestamps. Checkpoints alone remain mutable.
- Both shipped research commands hold kernel-owned per-Run SQLite admission
  before terminal replay/provider construction. Contention rejects; process
  death releases admission without stale-lock stealing. Corrupt records fail
  with content-free errors; FIFOs and symlinks are rejected.
- Independent review required five Pi corrections (nonblocking reads, owned
  temporary cleanup, nested/terminal validation, test-fixture lifecycle,
  canonical digest case), then three bounded parent fixes: nonnegative safe
  integer checkpoint counts, ownership transfer immediately after rename, and
  canonical nil/max UUID compatibility for missing evidence references.
- Parent verification of the final changed source: Agent build, host typecheck,
  host build, all 133 host tests in 18 files, documentation check. Integration
  replay/admission command checks passed. Synthetic SIGKILL probes confirmed
  PH-11 still occurs after admission: search/fetch/profile each dispatched twice
  with authorization maximum one. That separate finding remains for the next
  batch; immutable publication does not imply durable call-budget reservation.
- Scope remains local filesystem/process interruption, not distributed locking
  or power-loss durability. Resident rollout remains pending final delivery.
