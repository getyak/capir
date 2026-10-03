# GET-134: Private evaluation repository extraction

Outcome: evaluation corpus, historical evidence, and the evaluation harness
live in the private [getyak/capir-evals](https://github.com/getyak/capir-evals)
repository; the product keeps credential-free runtime verification, the
authenticated Lab regression consumer, and a failure-safe wrapper for private
evaluation commands.

Status: product worktree complete, local verification passed; external
delivery gates remain parent-owned (see below). Decision record:
[ADR 0023](../docs/decisions/0023-private-evaluation-repository.md).

## Scope

In scope (product worktree only):

- remove tracked evaluation payloads and harness code;
- keep runtime evaluation semantics in `packages/evaluation` and Lab
  storage/verification in `apps/backend`;
- add the private-run wrapper, the backend Lab regression consumer, and the
  repository hygiene check;
- repair documentation links and commands.

Out of scope for this worker: private repository changes, commits, pushes, PRs,
merges, deploys, Linear writes, and any change to the frozen evidence bytes.

## Migration mapping (byte-preserved, identities unchanged)

| Product path (before GET-134) | Private path |
| --- | --- |
| `evals/` (193 files) | `evals/` |
| `docs/evaluations/` (3,380 files) | `evidence/` |
| `apps/eval-runner/` (76 files) | `harness/apps/eval-runner/` |
| `scripts/evals/` (102 files) | `harness/scripts/evals/` |
| `apps/browser-extension/tests/fixture-contract.test.mjs`, `scripts/capture-round-2-evidence.mjs`, `scripts/compose-round-2-panel.mjs`, `scripts/verify-round-2.mjs` | `harness/apps/browser-extension/` |

The product keeps `evals/README.md` as the only tracked file under `evals/`.
All other browser-extension tests and scripts remain in the product. Public
Git history is preserved; no force-push, filter-repo, or history rewriting.

## Audit rationale

- Extraction is the single major cleanup. No other active plan, unrelated
  source, migration, architecture diagram, brand asset, `_index` article, or
  external worktree was deleted.
- Historical evidence is preserved byte-for-byte in the private repository and
  referenced from product documentation through private `blob/main` or
  `tree/main` links. Removed evidence is never replaced by stub receipts.
- Product runtime source identity is frozen independently of the private
  harness (`phaseOneImplementationSourceDigest`); old signed proofs are
  historical evidence for the sources they name and are not presented as valid
  for changed source.
- Case fixture paths and digests are unchanged; the legacy evaluator
  (`apps/backend/src/evaluation/runEvaluation.ts`) resolves
  `evals/candidate-momentum-v1.json` from explicit `CAPIR_EVAL_REPO` and fails
  clearly otherwise. Backend smoke evaluators keep their product integration
  role with default outputs under ignored `output/evaluation/`.
- The backend keeps the exact Lab CI trust contract: step name
  `Consume the selected Lab regression`, job name `Backend quality`, artifact
  `lab-regression-consumption-<run-id>-<attempt>`, report schema
  `lab-regression-consumption.v1`, no release authority, failures never
  swallowed.

## What changed in the product

- `scripts/evaluation/run-private.mjs` + tests: forwards `eval:*` aliases to
  `node $CAPIR_EVAL_REPO/scripts/run.mjs --source <root> --revision <HEAD>
  --command <alias> -- <args>`; requires an absolute external
  `CAPIR_EVAL_REPO` with marker `.capir-evaluation.json` and `scripts/run.mjs`;
  rejects a dirty tracked checkout with an actionable message (ignored
  outputs do not trigger); propagates runner exit status; never clones and
  never treats an unavailable evaluation as a pass.
- `apps/backend/src/evaluation/`: relocated `labRegressionReadback.ts`,
  new `consumeLabRegressionCommand.ts` (reviewed local files or authenticated
  backend readback), and `labRegressionConsumer.test.ts` (consumption gates,
  readback trust, command transports and exit semantics).
- Public CI: credential-free runtime/control-plane verification
  (`packages/evaluation` typecheck/test/build, agent `runtimeObservation`
  tests), backend consumer tests, hygiene check, and an explicit phase-one
  record that private case/semantic/release evaluations are `not_run`.
  Extracted catalog checks were removed from public CI; the Dockerfile no
  longer copies private fixtures; scan exclusions pointing at deleted folders
  were removed.
- `scripts/check-repository-hygiene.mjs` + tests: deterministic `git ls-files`
  rules rejecting tracked eval payloads/harness files and generated
  bundle/media/database artifacts outside admitted brand/design, architecture
  image, product asset, and test fixture paths.
- Documentation: all links to extracted artifacts now point at
  `github.com/getyak/capir-evals`; `docs/documentation.md` policy and the
  operations playbooks describe the wrapper/private workflow; wiki-generated
  pages were left to their `_index` sources (none required regeneration).

## Validation performed (this worktree)

- `pnpm install --frozen-lockfile` — passes after removing the eval-runner
  workspace importer (lockfile updated with `pnpm install --lockfile-only`).
- `pnpm docs:check` — passes (documentation, wiki, architecture boundaries and
  diagrams).
- `node --test scripts/check-architecture-boundaries.test.mjs` — 13 pass.
- `node --test scripts/evaluation/run-private.test.mjs` — 6 pass (missing repo,
  missing marker, escape via nested and symlinked repositories, dirty tracked
  source, ignored outputs allowed, argument forwarding, exit propagation).
- `node --test scripts/check-repository-hygiene.test.mjs` — 6 pass.
- `pnpm --filter @talent-signal/evaluation test` — 63 pass; build passes.
- `pnpm --filter @talent-signal/backend typecheck` — passes.
- `pnpm --filter @talent-signal/backend exec vitest run
  src/modules/labCIVerifier.test.ts src/evaluation/labRegressionConsumer.test.ts`
  — 22 pass.

## Remaining delivery gates (parent-owned)

1. Independent review of this diff; commit and push on the task branch.
2. Full current-head CI on GitHub, including repository policy, web, backend,
   and phase-one jobs.
3. Update `TALENT_SIGNAL_LAB_CI_WORKFLOW_SHA256` after the reviewed workflow
   change; re-read a Lab CI verification end to end.
4. Private CI on `capir-evals`: eval-runner, validate + p0 + legacy and
   relationship fixture suites against the pinned product revision; confirm
   the `.capir-evaluation.json` marker exists in the private repository.
5. Merge and merge readback; Linear completion readback.
6. Open decision (user/parent): whether public Git history should later be
   rewritten to drop the extracted blobs. This change deliberately preserves
   history; no force-push, filter-repo, or gc was performed.

Known follow-up (out of this worker's scope): the iOS UI test
`CandidateSignalUITests.testLocalhostSyncSuccess` still probes
`http://127.0.0.1:8787/evals/candidate-momentum-v1.json`; it skips when the
local fixture server is absent, but the fixture server input now lives in the
private repository.
