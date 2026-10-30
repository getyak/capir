# GET-342 — Avoid repeating a person's name in Time activity rows

## Outcome and scope

Recover only the useful unpublished Time row refinement on current remote main
3afb9d7f6a0ded46b3a5cc7cc152b5d2da19a534. When a non-empty person label equals
the activity title after trimming, render the title once and retain the localized
summary. Different labels keep their existing prefix. Do not change the activity
payload, identity rules, schema, date/count/status localization or selection.

The old Pi worktree remains untouched. Its broader locale changes already have
main coverage. The source database projection can produce identical title and
person_label for person_created; this is source evidence, not observed live proof.

## Ownership and verification

Parent owns this plan, serial tests, commits/PR/CI/merge and clean deployment.
Assigned worker first owns only the current time-workspace-views.test.tsx RED;
no production edit before parent observes a meaningful rendered assertion failure.
Then the smallest component guard, exact/trim-equal/distinct and summary controls,
current locale tests, independent review and latest applicable CI before merge.
A clean Web deployment with real revision/behavior readback is required before
closing GET-342. No account, model or data mutation is required/authorized here.

Reuse existing same-lock dependency/build artifacts where exact; do not install or
start another service/browser/build. Check pause/resources/audit before tests.
The shared machine's warning does not authorize unrelated kills, restart or prune.

## Context and recovery

Read-only source review and fixture:
runtime/release-148af253/local-time-label-candidate-final-triage.json/.md in the
parent video-review evidence directory. Remote main was independently read back
as3afb; local canonical branch235282ec is not the remote deployment source.
Known GET329 Web owner compact reports completed; do not send cross-chat messages
or borrow its account. Preserve any newer source/live changes before publishing.

Status: plan and isolated worktree prepared; component RED has not yet run.

## Parent observed verification

The real current component RED ran5 tests: exact-equal and trim-equal subtitle
assertions failed,3 controls passed. Log SHA256
5d73f0f9ab1c4cd28f42a544b32837f19512c4131ee51b5549ee9b14cd941dd7.
The smallest component change suppresses only the redundant display prefix;
it keeps the raw heading, distinct raw label, localized summary and original
selection payload. The current row and both locale suites then passed23 tests
across3 files, log SHA256
bc1b3b21eb45235f7f85fcf4808efc257ccf9d3a51233c6634dd449fe3b08910.
Reused exact-lock existing dependencies and contract build through two temporary
references; no install or build. Formal registered artifact is
/private/tmp/ai-test-GET-342-time-label.T7P3au. Independent review/latest CI and
clean resident Web/live behavior are separate outstanding gates.
