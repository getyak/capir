# ADR 0023: Private evaluation repository, credential-free public CI

Status: accepted, 2026-10-03 (GET-134).

## Context

The product repository tracked about 3,755 evaluation files: a synthetic case
corpus (`evals/`), dated review evidence (`docs/evaluations/`), the evaluation
runner (`apps/eval-runner/`), and evaluation scripts (`scripts/evals/`). Frozen
evidence, generated snapshots, and live product source shared one history and
one CI surface. Public CI ran catalog and harness suites whose inputs were
private case material, and historical receipts accumulated faster than the
knowledge they support.

The evaluation corpus and its evidence contain purpose-bound private material.
They must be auditable and reproducible, but they do not belong in public
product history, and no public CI job may need credentials to read them.

## Decision

Extract evaluation assets into the private `getyak/capir-evals` repository,
byte-preserved with unchanged relative fixture identities:

| Product path (before) | Private path |
| --- | --- |
| `evals/` | `evals/` |
| `docs/evaluations/` | `evidence/` |
| `apps/eval-runner/` | `harness/apps/eval-runner/` |
| `scripts/evals/` | `harness/scripts/evals/` |
| Embedded Web/iOS eight-case corpus | Optional private development loader/resources |
| Extension bundled corpus | Private snapshot injection from the canonical case bank |
| Screenshot gold/live evaluator | Private `evals/` and `harness/apps/web/` |
| Backend eight-case evaluator | Private `harness/apps/eval-runner/src/legacyBackendEvaluation.ts` |

Historical evidence bytes, case fixture paths, and fixture digests never
change. Removed evidence is never replaced by fabricated stub receipts.

The product keeps the runtime evaluation package (`packages/evaluation`, used
by `labCIVerifier` and `runtimeManifest`), the backend Lab storage and feedback
SQL, and a minimal authenticated Lab regression consumer
(`apps/backend/src/evaluation`). Self-contained backend integration checks for
authorization, retention, recovery, identity and database state also stay with
the implementation they verify; they do not import the private case bank.
Product image assets and isolated synthetic unit fixtures remain product
source. A filename containing `evaluation` alone is not a reason to delete a
runtime contract or its tests. Main keeps the `eval:*` alias commands through
`scripts/evaluation/run-private.mjs`, which requires an absolute external
`CAPIR_EVAL_REPO` with the `.capir-evaluation.json` marker, pins the committed
product revision, and forwards to the private runner. A missing or
misconfigured evaluation repository is a failure, never a pass, and the wrapper
never clones anything.

Public CI is credential-free: runtime and control-plane package tests, the
backend Lab regression consumer tests, and repository policy. The phase-one job
states explicitly that private case, semantic, and release evaluations are
`not_run`. Private CI owns the extracted harness and fixture suites against the
pinned product revision. The deterministic repository hygiene check
(`scripts/check-repository-hygiene.mjs`) rejects tracked evaluation payloads,
harness files, and generated bundle/media/database artifacts by inspecting
`git ls-files`, so `git add -f` cannot bypass it.

Product runtime source identity (`phaseOneImplementationSourceDigest`) freezes
product source, manifests, lockfile and CI workflow. The private executor
compares every resolved product dependency node before installing harness-only
additions, then restores the canonical product lock. Private signed Phase One
proofs separately bind the private revision and actual harness/case bytes; a
changed product graph or evaluator invalidates old proof.

## Consequences

- Evaluation commands in the product fail clearly without a configured private
  checkout. The legacy backend corpus evaluator and screenshot gold/live
  evaluator also live in private harness paths; their public aliases forward
  through the same bridge.
- Documentation links to extracted artifacts point at
  `github.com/getyak/capir-evals` (blob/tree), and new run output goes to the
  private ignored `runs/` or the product's ignored `output/evaluation/`.
- The Backend quality job keeps the step name `Consume the selected Lab
  regression`, the artifact name `lab-regression-consumption-<run>-<attempt>`,
  and its trust semantics, so existing Lab UI CI verification stays valid.
- The Dockerfile no longer copies private evaluation fixtures.

## Reconsider when

- Private evaluation runs must be reproducible by public contributors without
  corpus access.
- A signed proof cannot be regenerated for the source it names.
- The hygiene check rejects a legitimate brand, architecture, migration,
  fixture, or release-source asset.

Related: [ADR 0015](0015-private-evaluation-and-delegated-prompt-improvement.md),
[evaluations index](../../evals/README.md),
[GET-134 plan](../../plans/2026-10-03-get-134-private-evaluation.md).
