# Overnight cross-surface execution plan

## Outcome

Produce one frozen, inspectable localhost journey across six review objects:

1. Codex plugin;
2. Chrome browser extension;
3. Web;
4. iOS;
5. shared backend and control plane;
6. the integrated localhost user journey.

The journey uses `TS-CORE-01` and must show:

```text
intentional Chrome active-tab capture
→ explicit Submit
→ local simulated login
→ account-scoped evidence and proposed state
→ human fact confirmation
→ the same confirmed state on Web and iOS
→ separate action preview and approval
→ one idempotent local effect
→ observed destination readback
→ safe recovery, denial, and deletion
```

Passing means the evidence demonstrates the behavior. A branch, build, screenshot,
score, model response, or optimistic success message is not completion by itself.

## Boundaries

### In scope

- the existing eight synthetic candidate-momentum cases as the small behavioral
  core;
- deterministic schemas and validators;
- local-only simulated authentication and account isolation;
- local backend persistence and restart/readback;
- one Chrome capture-to-submit flow;
- Web/iOS confirmed-state parity;
- local simulated effects with idempotency and observed readback;
- offline, timeout-after-effect, permission-revocation, deletion-cascade, and
  cross-account-denial tests;
- direct Web/browser craft review and independent specialist review;
- accepted source commits, frozen artifacts, and local integration evidence.

### Out of scope

- live candidate conversations, screenshots, accounts, databases, or credentials;
- production OAuth, telemetry, model providers, or external connectors;
- contacts, calendar, ATS, CRM, message, notification, or other live writes;
- ambient browsing or background capture;
- candidate quality, fit, personality, protected-trait, sentiment, engagement,
  or acceptance scoring;
- deployment, publishing, marketplace submission, push, or pull request;
- broad product expansion while correcting a release gate.

All visible and persisted data must be labeled synthetic, fixture, demo,
simulated, or local-only at the point where it could be mistaken for live state.

## Frozen baseline

- base commit:
  `f66581cbf8a1b1154156fc25231a6ff82f11c61f`;
- core fixture:
  [`evals/candidate-momentum-v1.json`](https://github.com/getyak/capir-evals/blob/main/evals/candidate-momentum-v1.json);
- cross-surface contract:
  [`evals/overnight-cross-surface-v1.json`](https://github.com/getyak/capir-evals/blob/main/evals/overnight-cross-surface-v1.json);
- Web/browser craft rubric:
  [`evals/web-browser-craft-v1.json`](https://github.com/getyak/capir-evals/blob/main/evals/web-browser-craft-v1.json);
- release standard:
  [`docs/evaluations/overnight-cross-surface-standard-2026-08-05.md`](https://github.com/getyak/capir-evals/blob/main/evidence/overnight-cross-surface-standard-2026-08-05.md);
- manifest schema:
  [`evals/schemas/overnight-run-manifest.schema.json`](https://github.com/getyak/capir-evals/blob/main/evals/schemas/overnight-run-manifest.schema.json);
- craft-review schema:
  [`evals/schemas/web-browser-craft-review.schema.json`](https://github.com/getyak/capir-evals/blob/main/evals/schemas/web-browser-craft-review.schema.json).

The eight core case IDs and `TS-CORE-01` source sentence, assertion fields,
action target, and `must_not` boundaries are frozen. New cross-surface behavior
belongs in the separate contract, not in extra happy-path fixtures.

## Exact ownership

One worktree owns each source root. No agent may change another worktree's source
or use another worktree's uncommitted files as evidence.

| Owner | May edit | May write evaluation artifacts | Must not edit |
| --- | --- | --- | --- |
| Codex plugin | `plugins/talent-signal/**` | `docs/evaluations/overnight/plugin/**` | Chrome, Web, iOS, backend, root scripts or lockfiles |
| Chrome browser extension | `apps/chrome-extension/**` | `docs/evaluations/overnight/chrome/**` | Plugin, Web, iOS, backend, root scripts or lockfiles |
| Web | `apps/web/**` | `docs/evaluations/overnight/web/**` | Plugin, Chrome, iOS, backend, root scripts or lockfiles |
| iOS | `apps/ios/**`, `scripts/ios/**` | `docs/evaluations/overnight/ios/**` | Plugin, Chrome, Web, backend, root scripts or lockfiles |
| Backend/control plane | `apps/control-plane/**` | `docs/evaluations/overnight/backend/**` | Plugin, Chrome, Web, iOS, root scripts or lockfiles |
| Evaluation coordinator | `evals/**`, `scripts/evals/**`, this plan, the dated standard, `docs/evaluations/overnight/final/**` | `docs/evaluations/overnight/final/**` | `package.json`, lockfiles, `apps/**`, `packages/**`, `plugins/**`, canonical docs, or Skills |

The integrated localhost journey has no source-code owner. The coordinator
checks out accepted result commits in integration order, runs them, and records
only final evaluation artifacts. Any source correction returns to its original
owner.

## Current evidence and unknowns

The contract, schemas, examples, and validator can be proven in the coordinator
worktree. Surface behavior cannot be credited until the corresponding owner
provides:

- a full result commit SHA based on the frozen commit;
- a schema-valid run manifest;
- exact commands and exit status;
- artifact locators and SHA-256 digests;
- direct assertion evidence;
- a list of untested behavior.

The local plugin marketplace, Chrome extension build directory, backend Compose
stack, local auth simulator, and integrated effect endpoint are implementation
deliverables. Their commands are frozen in the contract, but this coordinator
slice does not install, load, start, or claim those artifacts before the source
commits arrive.

## Execution milestones

### Milestone 0 — Contract baseline

Pass condition:

- `pnpm eval:core` accepts exactly eight cases, six review objects, nine
  cross-surface assertions, twelve craft dimensions, two schemas, and four
  examples;
- the independent product-adjudicator validator accepts the specialist and panel
  examples;
- `pnpm docs:check` passes;
- the diff contains only coordinator-owned paths.

### Milestone 1 — Independent review-object handoff

Each owner runs only its declared commands from the cross-surface contract and
produces one manifest matching
[`overnight-run-manifest.schema.json`](https://github.com/getyak/capir-evals/blob/main/evals/schemas/overnight-run-manifest.schema.json).

Pass condition:

- base and result commits are full SHAs;
- every required command is present with exact command text, status, exit code,
  and output locator;
- all eight core case IDs have a deterministic result and evidence locator, or
  an exact failed/not-run gap;
- every artifact has a digest;
- data classification is `synthetic_fixture_only`;
- `contains_live_candidate_data` and `live_external_writes` are both `false`;
- failed or unrun assertions name the exact gap rather than receiving credit.

### Milestone 2 — Backend authority before client fan-in

The backend/control-plane commit is integrated first and must prove:

- local simulated `account-a` authentication;
- account-scoped persistence across restart or new session;
- `account-b` denial without object-existence leakage;
- separate fact-confirmation and action-approval event types;
- one idempotency key across a timeout/retry pair;
- exactly one local destination object and matching readback;
- permission revalidation at execution;
- retrieval revocation before derivative deletion completes.

No client may be credited for canonical state while it still owns a separate
fixture store.

### Milestone 3 — Client integration

Integrate accepted clients one at a time:

1. Web, because it is the primary inspection and conflict-resolution surface;
2. iOS, then compare its confirmed-state projection to Web and backend;
3. Chrome, then prove active-tab capture and explicit Submit into the same
   account;
4. Codex plugin, kept read/propose-only and evaluated independently from the
   browser extension.

After each commit:

- inspect the changed paths against ownership;
- rerun its focused commands;
- rerun `pnpm eval:core`;
- stop if its state or API contract differs from the already accepted backend.

### Milestone 4 — Frozen `TS-CORE-01` journey

Run the journey once with one accepted commit set and one trace ID,
`TS-CORE-01-localhost`. Do not splice screenshots or logs from different builds.

Required artifacts:

| Artifact ID | Required locator |
| --- | --- |
| `chrome-capture-recording` | `docs/evaluations/overnight/chrome/TS-CORE-01-active-tab-submit.*` |
| `backend-canonical-trace` | `docs/evaluations/overnight/backend/TS-CORE-01-canonical-trace.json` |
| `web-review-sequence` | `docs/evaluations/overnight/web/TS-CORE-01-review.*` |
| `ios-review-sequence` | `docs/evaluations/overnight/ios/TS-CORE-01-review.*` |
| `state-parity` | `docs/evaluations/overnight/final/TS-CORE-01-state-parity.json` |
| `approval-separation` | `docs/evaluations/overnight/final/TS-CORE-01-approval-separation.json` |
| `effect-readback` | `docs/evaluations/overnight/final/TS-CORE-01-effect-readback.json` |
| `recovery-matrix` | `docs/evaluations/overnight/final/TS-CORE-01-recovery-matrix.json` |

The three machine-readable final artifacts must prove:

- Web, iOS, and backend have identical `account_id`, `episode_id`,
  `assignment_id`, `confirmed_state_id`, `confirmed_state_version`, four
  confirmed fields, values, statuses, and evidence message IDs;
- fact confirmation and action approval have distinct event IDs and scopes;
  fact confirmation creates zero effects, the action remains unapproved, and
  declining it leaves confirmed facts intact;
- two attempts share one idempotency key, both reconcile to one local object,
  and UI success follows matching readback;
- all five recovery variants pass with no false success or duplicate effect.

Run:

```sh
node scripts/evals/verify-localhost-journey.mjs \
  docs/evaluations/overnight/final/run-manifest.json
```

### Milestone 5 — Independent review and adjudication

Freeze the commit set and evidence index before scoring. Reviewers see the same
artifact and do not see prior scores.

- `recruiter-workflow-reviewer`: complete operational loop and fallback cost;
- `evidence-safety-reviewer`: identity, provenance, account scope,
  authorization, result truth, privacy, deletion;
- `mobile-ux-reviewer`: iOS and responsive Web task completion,
  accessibility, interruption, and recovery;
- `candidate-experience-guardrail`: agency, communication, timing, and humane
  failure;
- `selection-science-auditor`: eval integrity and prohibited candidate
  assessment boundary;
- `design-talent-signal`: product-specific meaning, provenance states,
  attention hierarchy, and visual-system conformance without replacing the
  common specialist packet.

The five specialist packets retain their own 0–4 scores and lowest material
dimensions. They are validated with:

```sh
python3 .agents/skills/product-adjudicator/scripts/validate_review.py \
  path/to/review.json
```

The separate Web/browser craft packet uses twelve 0–100 dimensions. There is no
mean, composite, or translation between the two systems.

### Milestone 6 — Final gate

Pass condition:

- no active veto;
- all nine cross-surface assertions pass with direct evidence;
- every in-scope Web/browser craft dimension is at least 98 with direct evidence;
- the independent integrated-journey score is at least 95 with direct evidence;
- any below-target score names the exact behavior and evidence gap;
- the final panel contract is valid;
- the final summary has no more than three findings, each with owner, evidence,
  next step, and pass condition;
- `pnpm eval:core` and `pnpm docs:check` pass on the final commit set.

Validate the submitted manifest and craft packet directly:

```sh
node scripts/evals/validate-candidate-momentum.mjs \
  --manifest docs/evaluations/overnight/final/run-manifest.json \
  --craft-review docs/evaluations/overnight/final/web-browser-craft-review.json
```

## Exact local verification

These steps are part of integration evidence, not actions authorized for the
coordinator's contract-only commit.

### Codex plugin install

Use a disposable Codex profile. Record the JSON output and installed plugin
version:

```sh
node plugins/talent-signal/scripts/validate-plugin.mjs
codex plugin marketplace add ./plugins/talent-signal/marketplace --json
codex plugin add talent-signal@talent-signal-local --json
node plugins/talent-signal/scripts/run-fixture.mjs \
  evals/candidate-momentum-v1.json
```

The installed plugin must expose only fixture/user-authorized read and proposal
behavior. Installation does not authorize external writes.

### Chrome load-unpacked

1. Run `node --test apps/chrome-extension/tests/*.test.mjs`.
2. Run `node apps/chrome-extension/scripts/build.mjs`.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Choose **Load unpacked**.
6. Select `apps/chrome-extension/dist`.
7. Record the extension ID and loaded-version screenshot.
8. Record the `TS-CORE-01` active-tab invocation, preview, and explicit Submit
   with the Network panel visible.

No credit is given for unit tests alone; the loaded extension must prove no
submission occurred before Submit.

### Local Docker and simulated login

```sh
docker compose -f apps/control-plane/compose.yaml up --build --detach
docker compose -f apps/control-plane/compose.yaml ps --format json
curl --fail --silent --show-error http://127.0.0.1:8787/health
docker compose -f apps/control-plane/compose.yaml run --rm api test
pnpm --filter @talent-signal/web dev
```

Web and iOS use the backend's local simulator to establish `account-a`. The
visible login state must say Local simulation or Demo, and the network trace
must contain no production OAuth request. After the run, retain the Compose
status and test output in the backend artifact directory. Cleanup is allowed
only after all destination readback and deletion evidence has been captured.

## Correction-round policy

The initial frozen review is round 0. At most two bounded correction rounds may
follow for each review object.

### Round 1 — Gates and truthful completion

Only correct:

- identity, provenance, account scope, authorization, privacy, accessibility,
  assessment-boundary, false-success, duplicate-effect, deletion, or state
  parity failures;
- broken build/test/install/load/start behavior that prevents direct evidence.

Rerun the affected deterministic assertion and every specialist whose veto or
assumption depends on it.

### Round 2 — Exact residual gap

Only correct:

- remaining non-veto workflow or craft gaps tied to a recorded finding;
- an in-scope craft dimension below 98;
- the integrated journey below 95.

No new feature, abstraction, integration, dependency, or unrelated polish is
allowed. Every change gets a new result commit and artifact digest.

If the same gate remains after round 2, stop. Mark the object `fail` or
`needs_evidence`, preserve the last useful artifact, and carry the exact gap
into the final three findings. Do not stack a third patch or average around the
failure.

## Integration order and conflict policy

1. coordinator contract commit;
2. backend/control-plane result commit;
3. Web result commit;
4. iOS result commit;
5. Chrome-extension result commit;
6. Codex-plugin result commit;
7. integrated manifests and frozen artifacts;
8. affected specialist packets;
9. craft packet;
10. final adjudication and summary.

Cherry-pick one accepted full SHA at a time. After each pick, inspect path
ownership and run the narrowest checks. A source conflict returns to the source
owner; the coordinator does not improvise changes in another owner's files. A
semantic conflict with the backend truth/approval contract blocks later client
integration.

## Final artifact index

The final directory follows
[`docs/evaluations/overnight/final/README.md`](https://github.com/getyak/capir-evals/blob/main/evidence/overnight/final/README.md).
It must contain:

- accepted commit set and environment;
- schema-valid integrated run manifest;
- artifact index with digests;
- the four required machine-readable `TS-CORE-01` final artifacts;
- assertion results;
- Web/browser craft packet;
- contract-valid specialist packets;
- contract-valid panel adjudication;
- a human summary with at most three findings.

Examples are labeled `EXAMPLE` and never count as release evidence.

## Progress

- Contract baseline: complete in the coordinator worktree. `pnpm eval:core`,
  the product-adjudicator self-test and example checks, the integrated-validator
  self-test, and `pnpm docs:check` pass.
- Independent surface handoffs: not integrated and not claimed.
- Localhost journey: not run and not claimed.
- Final adjudication: not started.
