# User-authored workspace prompt refresh

## Outcome

Deploy the user-authored companion prompt to the existing remote M4 resident
services, preserve the earlier contact-creation implementation, and include
merged main commit `6210af5fd7635b5ada72de881926dbd5de44589c` (PR 384).
Verify the bundled prompt hash and real conversation behavior, then stop the
owned isolated test account. No unrelated original-checkout edits are included.

## Current state

The source prompt and its test are edited in the original dirty main checkout.
Both files were snapshotted with hashes in ignored task evidence. Existing
resident Web is `ce434ba0`; backend/Agent Host is `a03f84e5`.
The attached task worktree started clean at `b34faf07`. Main was fetched and
PR 384 is verified merged. Integration preserves its safe SDK diagnostics and
other merged fixes. Manual merge resolution keeps the earlier removal of
contact eligibility gates and durable historical-source handling, while keeping
upstream capture preview and inspection admission changes.

The user confirmed keeping their companion voice while removing the stale
authored name-only ban and restoring arbitrary/historical screenshot drafts.
The final prompt is their exact snapshot plus these scoped changes and the
existing-record lookup instruction. Integration review also found an existing
contact-only refusal gap, missed explicit search opt-outs and an email suffix
incorrectly admitted as a public handle. Narrow corrections honor refusals
without restoring eligibility gates, and keep private contact values out of
public research. Their new regressions failed on the old implementation.

## Milestones

1. Complete: integrated main and the user-approved prompt resolution.
2. Active: final checks; independent source review reports no remaining concrete deployment blocker.
3. Pending: clean-source remote build, coordinated deployment, Opik mirror/hash
   readback, actual Web acceptance and owned test cleanup.

## Proof boundary

Only synthetic QA input is authorized. Test light conversation, arbitrary and
historical screenshots, namesake creation, no-save intent and persistence
readback. Keep the user's original edits and unrelated dirty files intact.
Use the resident runbook and existing recovery controls, never seed shared data.

## Verification so far

Final Agent suite: 585 pass, 16 skipped; focused backend: 216 pass. Full Web:
2556 pass. Web types/lint and backend types passed. The first broad Agent run
had three five-second load timeouts; the entire bounded-worker rerun passed.
Email/lookup opt-out regressions were observed failing before correction.
One old database test expected every primary-model image contact to be blocked
without a supplementary processor. It now checks the intended boundary: reject
unverified Memory claims, permit a zero-item editable contact draft, save no
Person/Memory automatically, and do not invoke the supplementary processor.
The unchanged original feature's source revocation and historical-source tests
remain in the database suite. Deployment is not yet activated.
