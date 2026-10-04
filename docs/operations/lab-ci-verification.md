# Verify CI consumption of a saved Lab case

## Purpose and authority

Lab can verify that a trusted GitHub Actions run consumed one exact saved
regression and its completed product rerun. This is a read-only provenance
check of recorded integrity tests. It does not execute another model call,
judge answer quality, enable branch protection, or approve a release.

The independent producer is the **Consume the selected Lab regression** step
in `.github/workflows/ci.yml`. The backend downloads its report, validates its
origin and archive hash, and recomputes it against the current authenticated
case and rerun using the same `packages/evaluation` consumer as the backend
consumer command (`apps/backend/src/evaluation/consumeLabRegressionCommand.ts`).

## Operator configuration

Apply migrations through `044_lab_ci_verifications`. Internal Lab must be
enabled and the user must be signed in to the owner of the saved case.
Verification remains visibly unavailable until its trust configuration exists.

Backend configuration:

| Variable | Meaning |
| --- | --- |
| `TALENT_SIGNAL_LAB_CI_GITHUB_TOKEN` | Server-owned GitHub credential with Actions read and Contents read permission for the selected repository |
| `TALENT_SIGNAL_LAB_CI_REPOSITORY` | Repository name; default `getyak/talent-signal` |
| `TALENT_SIGNAL_LAB_CI_REPOSITORY_ID` | Immutable repository ID; default `1322192683` |
| `TALENT_SIGNAL_LAB_CI_WORKFLOW_SHA256` | SHA-256 of the exact approved `.github/workflows/ci.yml` bytes; required when a credential is configured |
| `TALENT_SIGNAL_LAB_CI_BRANCHES` | Comma-separated admitted source branches; default `main` |

Compute the workflow fingerprint from the reviewed revision being admitted,
using `shasum -a 256 .github/workflows/ci.yml`. Update it only after reviewing
workflow changes. A changed repository, workflow pin or admitted branch list
invalidates the current status of older receipts. Credential rotation does not
change the trust identity. Never put GitHub credentials in an iOS build.

For case-specific workflow consumption, configure repository variable
`LAB_BACKEND_ORIGIN` with an approved HTTPS backend reachable by its runner,
and repository secret `LAB_EVALUATION_SESSION_TOKEN` with an unexpired session
for a dedicated internal synthetic-data account. This is an ordinary backend
session, not a restricted read-only credential; its account scope and secret
handling therefore matter. Do not use a recruiter account containing private
candidate material. The consumer command performs read operations only, rejects redirects,
bounds responses, and rechecks deletion, but those checks do not narrow the
credential's underlying authority.

## End-to-end operation

1. Save a synthetic failure in Lab and finish a product rerun of that exact
   immutable case. Keep both identifiers.
2. Dispatch the approved CI workflow on an admitted branch, setting
   `regression_case_id` and `regression_run_id`. This step reads the existing
   rerun; it does not rerun the model.
3. Wait for the workflow and **Backend quality** job to finish. The selected
   consumer emits `lab-regression-report.json` and the artifact named
   `lab-regression-consumption-<run-id>-<attempt>` retains it for seven days.
   Raw case input, answers and review notes are not uploaded as artifacts.
4. In iOS, open the saved case, choose **CI verification**, select its matching
   product rerun, and paste the GitHub run URL or ID. Read the integrity result,
   check time, product revision and CI revision separately.
5. Refresh after a CI rerun or before relying on old evidence. A verified
   receipt is current for at most 15 minutes and never beyond source, rerun,
   or artifact expiry. Checks are snapshots; Lab does not continuously watch
   GitHub between verifications.

Only `push` and `workflow_dispatch` runs on admitted branches are accepted.
Pull-request runs are not accepted because their checkout merge revision may
be different from the API's head revision. The automatic disposable fixture
artifact has a different name and cannot prove enrollment of a user's case.
A completed workflow may have failed: Lab verifies execution provenance and
shows failed integrity checks distinctly from successful ones.

## Failure and recovery

A stable verification ID lets iOS recover a lost response by readback. A retry
uses the same request. Dismissing a pending local verification clears only its
recovery intent; it does not change the case, CI run, or server receipt.
Verification does not reserve a paid model call.

Source deletion or expiry wins over an in-flight check. Saved-case deletion
scrubs verification receipt payloads along with the case's derived results.
Non-content request hashes and IDs prevent replay from reviving deleted proof.
An earlier metadata artifact on GitHub expires independently; source deletion
makes it unusable for a new successful backend verification.

The downloader sends GitHub credentials only to the fixed GitHub API origin.
It follows the API's signed artifact link without that credential, restricts
its host and size, and reads one bounded report file in memory. Malformed
archives, altered reports, wrong cases, old attempts and unknown results fail
closed. No archive file is extracted onto the server filesystem.

## Verification evidence and references

The [dated evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-ci/README.md) distinguishes
local protocol/database/native fixtures from actual hosted CI proof. Source
implementation and locally passing tests alone do not prove a hosted run.

GitHub's primary references describe [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs),
[attempt-specific jobs](https://docs.github.com/en/rest/actions/workflow-jobs?apiVersion=2026-03-10),
[artifact digests and signed downloads](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2026-03-10),
and [repository content readback](https://docs.github.com/en/rest/repos/contents?apiVersion=2026-03-10).
