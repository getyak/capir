# Contact draft compatibility with the updated main branch

Status: Active.

## Outcome and boundary

Finish contact PR 387 against the current main branch, with compatible resident
Web, API and Agent Host releases and fresh required checks before the authorized
merge. Preserve the unrelated primary checkout and the private evidence boundary.

Main advanced from `1c7c9891` to `1701a12c` when another owner merged PR 385.
This task does not merge that PR or restart its stopped GET-40 funded evaluation.
Its Memory tool-contract changes are now an existing integration dependency.
Do not equate engineering or deployment health probes with that task's remaining
model-quality or human-utility acceptance.

## Current evidence

- Contact head `1707ec39` passed its full CI rerun. Security could not start
  because of an explicit GitHub internal service error during the Actions incident.
- The new main changes the Claude provider and Memory SDK schema. The contact
  branch touches both files; the merge preview is clean, but compatibility still
  requires review and tests.
- M4 API and Agent Host still run `53d994ab`; Web runs `20c0d64a`. The new
  combined Agent source changes runtime inputs, so the earlier source-equivalence
  receipt alone cannot complete the updated release.
- The contact source-revocation repair already passed 167 database checks and
  four actual-image PostgreSQL 18 controls. Original sanitized receipts remain
  outside Git; local deployment readback is in `output/local-work-audit/`.

## Milestones

1. Done: merge the current main into the isolated contact branch; inspect the
   overlapping provider/schema paths and run Agent/native protocol, affected
   backend/Web and documentation checks. Agent: 589 passed, 24 explicit skips;
   separate genuine native SDK protocol: 13 passed with no remote model;
   backend: 199 passed; Agent Host: 203 passed; affected Web: 59 passed.
   Agent/Web/Host types, backend/Host builds and documentation/architecture pass.
   The first attempt used an inoperable Homebrew Node 22 executable and never
   started tests; the recorded successful runs use the available NVM Node 22.
2. Active: deploy all affected existing resident services from clean committed
   combined source using the canonical runbook. Verify the actual revision,
   image identity, source-revocation behavior and service health; retain rollback
   and existing observation/account boundaries.
3. Pending: require fresh exact-head CI/security and resolved review threads,
   then merge only PR 387 with the user's existing authorization. Verify all
   three requested PR merge commits, main containment and runtime compatibility,
   then stop the native monitor.

## Compatibility review

The committed merge tree matches the clean preview. Image and JSON requests keep
the existing Memory interface; ordinary-text requests use the new per-operation
SDK schema while dispatching through the same strict host union. A contact-only
new draft still permits an empty item list with an admitted root locator, and
source verification and manual Save remain unchanged. The native loopback
controls cover truthful required fields, independent self proposals, rejected
invalid calls, calendar discovery and source/lease withdrawal without model calls.

## Completion evidence

Record test results, exact source and runtime revisions, immutable image IDs,
live health readback and merge containment separately. A new main advance,
conflict, regression, changed resident state or persistent GitHub service failure
requires a new checkpoint instead of reusing old checks or overwriting work.
