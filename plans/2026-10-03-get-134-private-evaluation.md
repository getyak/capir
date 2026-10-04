# GET-134: Private evaluation ownership and product cleanup

Outcome: the versioned case bank, dedicated evaluation harness and historical
evidence have one private Git home, [getyak/capir-evals](https://github.com/getyak/capir-evals).
The public product keeps an index, an explicit execution bridge, product runtime
contracts and authenticated Lab storage/verification.

Status: implementation and host verification complete. Current delivery status
and final merged/verification references are recorded in
[GET-134](https://linear.app/getyak/issue/GET-134/evaluation-的管理).
This plan records the implementation and acceptance requirements; it does not
replace the issue's current delivery state. Original dirty checkout is untouched. Product work is isolated
on `codex/get-134-private-evaluation` from `812be601684e705b28b36994f35e772a6d4b0437`.
Decision: [ADR 0023](../docs/decisions/0023-private-evaluation-repository.md).

## Directory decision and preserved evidence

| Previous product path | Private owner |
| --- | --- |
| `evals/` | `evals/` case banks, rubrics, partitions and profiles |
| `docs/evaluations/` | `evidence/` immutable historical reports and captures |
| `apps/eval-runner/` | `harness/apps/eval-runner/` |
| `scripts/evals/` | `harness/scripts/evals/` |
| Dedicated extension fixture contract/capture scripts | `harness/apps/browser-extension/` |
| Screenshot gold/live evaluator | `evals/` and `harness/apps/web/` |
| Legacy backend eight-case evaluator | Private runner `legacyBackendEvaluation.ts` |
| Embedded Web/iOS/extension corpus | Optional explicit private loader/resource injection |

The byte-preserved original import contains 3,755 files. Sixteen additional
original source snapshots preserve the embedded demo, gold and handoff source
before its extraction. The migration manifest now verifies 3,771 entries and
538,577,645 bytes. Original source hashes are checked against the baseline Git
objects; working private harness revisions are reviewed independently.

The product keeps `evals/README.md` as the sole tracked Eval index. No payload is
hidden by ignore rules: tracked trees, dedicated harness paths and duplicated
corpus content are checked in CI. Generated reports, bundles, recordings,
databases and captures are rejected outside explicitly admitted source assets.
Product architecture diagrams, marketing assets, migration SQL, active plans,
isolated unit fixtures and unrelated user work are preserved. Historical Git
commits and existing clones still contain the old blobs; no history rewrite,
force-push or cross-task cleanup was performed.

## Execution and runtime boundaries

- The product bridge requires an absolute external `CAPIR_EVAL_REPO`, the exact
  `.capir-evaluation.json` marker and a clean tracked product checkout. Missing
  private evaluation is an explicit failure. It never clones a private repo.
- The private executor reconstructs the exact product commit and snapshots
  private inputs from a committed Git object, compares every product dependency
  node, installs a frozen harness graph and restores the canonical product lock.
  Fresh direct aliases build workspace runtime exports before dispatch; build
  failure stops the alias and preserves its exit status. Receipts bind both
  Git revisions. Signed private proofs also bind actual harness/case bytes.
- Public CI owns credential-free runtime/control-plane checks and the minimal
  Lab consumer; private case, semantic and release evaluations are `not_run`.
  Private manual CI runs deterministic suites against an explicit product SHA.
  No live provider or paid semantic evaluation was invoked for this task.
- Web loads the private case bank only through a server-only explicitly
  configured development loader. No corpus means an unavailable empty state.
  A case-bank file is always fixture input, never synchronized runtime state.
- iOS optionally decodes the private JSON resource, checking the fixed version,
  complete identity set and evidence references. Missing/empty/invalid resources
  stay unavailable. Generic review and unit tests use independent synthetic data;
  dedicated fixture UI journeys explicitly require the optional corpus.
- The extension starts in live mode without a corpus. Its optional local loader
  enables fixture mode only for renderable, evidence-linked data. Malformed
  payloads never enable a broken fixture UI.
- The browser handoff retains its transport/idempotency checks with independent
  synthetic text and a new key namespace, rather than an embedded Eval case.
- `packages/evaluation`, governed Lab/PostgreSQL state and Opik operational
  volumes remain product/runtime concerns. Self-contained authorization,
  retention, identity and recovery checks stay with the implementation. No
  runtime database, secret, ignored file or uncommitted source was exported.
- Lab CI retains its authenticated readback contract, step/job/artifact names,
  failure semantics and absence of release authority. The moved consumer and
  readback are included in CodeQL. Existing local Lab GitHub credentials and
  workflow trust pin are unconfigured, so no hosted trust pin needs rotation;
  unavailable hosted verification is not reported as passing.

## Verification evidence

Pi implementation receipts remain under the task-owned local state directories.
The parent independently checked integration and the archive:

- Second slice: Web typecheck and 1,682 tests in 223 files, documentation checks,
  extension package validation and 46 tests passed. No local native build or
  simulator acceptance was performed; syntax parsing is not native test proof.
- After review fixes: 32 focused Web tests and 47 extension tests passed; the
  actual private eight-case JSON loads through the selected product adapter,
  and changed frozen source messages are rejected.
- Wrapper, hygiene, architecture, documentation, backend typecheck and Lab
  consumer checks are verified locally; final remote CI remains authoritative
  for the final submitted source and native changes.
- Private revision `1d3ea8c636347f7fb13ae49e4ec75333d2717fbe` against product
  `b460c6aa398cc1fb5e8f649203f07a58c329771f`: workflow
  [37120430144](https://github.com/getyak/capir-evals/actions/runs/37120430144)
  passed fresh direct aliases and the full deterministic suite. Backend startup
  intentionally failed against an unavailable endpoint; that check proves
  entry imports/failure propagation, not backend case behavior.
- Private head changes add canonical Web adapter tests and final source archive
  entries. Final product/private SHA-pair evaluation is still required.

## Delivery acceptance

1. Review the final integrated product and private revisions; close confirmed
   P0/P1 and recheck the input-validation corrections.
2. Push the final product revision, run the private source-bound suite against
   that exact revision, create/attach its GET-134 PR, and require all applicable
   current-head quality, security and native CI checks.
3. Merge both PRs and read back their actual merged state. Verify the merged
   product/private revision pair; main-push native checks retain their scope.
4. Audit storage and rebuild/redeploy the approved merged backend through
   `scripts/deploy/testflight-local.sh`; read back its revision and readiness.
5. Only after acceptance, record merged PR/CI/deployment evidence and mark
   GET-134 complete with readback. Until then it remains In Progress.
