# Evaluation assets live in the private capir-evals repository

The evaluation corpus, historical evidence, and the evaluation harness were
extracted from this product repository in GET-134. They now live in the private
[getyak/capir-evals](https://github.com/getyak/capir-evals) repository and are
never checked out by public CI.

Migration mapping (byte-preserved, relative identities unchanged):

| Product path (before GET-134) | Private path |
| --- | --- |
| `evals/` | [`evals/`](https://github.com/getyak/capir-evals/tree/main/evals) |
| `docs/evaluations/` | [`evidence/`](https://github.com/getyak/capir-evals/tree/main/evidence) |
| `apps/eval-runner/` | [`harness/apps/eval-runner/`](https://github.com/getyak/capir-evals/tree/main/harness/apps/eval-runner) |
| `scripts/evals/` | [`harness/scripts/evals/`](https://github.com/getyak/capir-evals/tree/main/harness/scripts/evals) |

Historical evidence bytes, case fixture paths, and fixture digests must never
change. Historical evidence is never replaced by stub receipts.

## Lifecycle and the runtime database

Evaluation assets are frozen inputs and recorded outputs, not product runtime
state:

- Case fixtures, rubrics, suites, and profiles are versioned in the private
  repository and identified by content digest. They change only through
  reviewed migration with a new revision.
- Historical run outputs and evidence receipts are append-only records in the
  private repository. New run outputs are written to the private ignored
  `runs/` directory by the private executor, never back into product paths.
- The Lab product runtime database (regressions, experiment jobs, feedback,
  and observation records) remains a product concern: its SQL, storage, and
  verification stay in `apps/backend`. The database stores governed Lab state,
  not evaluation corpus files; saved Lab regressions are consumed through the
  authenticated consumer in `apps/backend/src/evaluation`, and no model calls
  or release authority come from consuming a record.

## Running evaluations

Main keeps the `eval:*` alias commands as a thin wrapper,
`scripts/evaluation/run-private.mjs`, that forwards to the private runner. The
wrapper never clones the private repository and never treats an unavailable
evaluation as a pass.

```bash
export CAPIR_EVAL_REPO=/absolute/path/to/capir-evals
pnpm eval:core
```

Contract:

- `CAPIR_EVAL_REPO` must be an absolute path to an existing directory outside
  this checkout that contains the repo marker `.capir-evaluation.json`
  (`{"schemaVersion": "capir-private-evaluation.v1", "repository": "getyak/capir-evals"}`) and the runner entry `scripts/run.mjs`.
- The wrapper refuses to run from a checkout with uncommitted tracked changes;
  commit the product source first so the private executor can pin the exact
  revision.
- The wrapper invokes
  `node "$CAPIR_EVAL_REPO/scripts/run.mjs" --source <product-root> --revision <git HEAD> --command <eval:alias> -- <args>`
  and propagates its exit status.

## Precise main-branch limitations

- This repository tracks no versioned Eval corpus, historical evaluation evidence,
  or dedicated corpus evaluation harness. Product unit fixtures and runtime
  integrity checks remain self-contained. `evals/` holds only this index file.
- Public CI runs only credential-free product verification: runtime and
  control-plane package tests, backend Lab regression consumer tests, and
  repository policy. Private case, semantic, and release evaluations are
  explicitly `not_run` on main and are executed by private CI against the
  pinned product revision.
- `pnpm eval:*` commands fail with an actionable error unless a private
  `capir-evals` checkout is configured. This is intentional: missing
  evaluation is never a passing result.
- `pnpm eval:backend` invokes the legacy corpus-backed evaluator in private
  `harness/apps/eval-runner/src/legacyBackendEvaluation.ts`;
  `pnpm eval:screenshot:live` requires explicit live-provider opt-in.
- Signed proofs recorded before GET-134 are historical evidence for the
  sources they name. Product source identity is frozen independently of the
  removed harness, so old signed proofs are not valid for changed source.
