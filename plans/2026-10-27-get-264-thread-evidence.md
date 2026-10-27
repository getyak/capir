# GET-264: Evidence belongs to its conversation

## Outcome and boundary

Keep sent image evidence, its original preview, and observed work details on the
same message/response axis. Resizing the Web workspace must preserve that
association, keyboard access, recovery, and the GET-251 quiet sidebar/title
baseline. No native shell, other application, browser extension, provider,
storage authority, or relationship decision changes are authorized here.

## Current evidence

- Linear GetYak/GET-264 and its attachment were read on 2026-10-27. The reference
  is a Chrome Web conversation, not a native application window.
- Baseline: `972de6ace960f545b6ddc75f532264473d4c8adc` (GET-251, PR #454).
- No existing GET-264 PR was found. The isolated branch is
  `codex/get-264-work`; initial Git status was clean.
- `conversation-images.tsx` owns scoped thumbnail bytes and original inspection.
  Its stacked thumbnails and modal preview currently leave the reading grid.
- `session-task-capsule.tsx` duplicates observed work in a header popover. The
  transcript already owns the execution record and recovery paths.
- No mascot or floating translation control was found in the product source.
  Their exact external owner is unverified; do not modify unrelated software.
- Resource diagnostics report high Node count and swap, with 38 GiB free and
  noncritical memory pressure. Serialize checks and reuse existing dependencies
  and services. No resources have been started or claimed for this task.
- Native Linear issue/attachment/comment tools work; its advertised
  `get_agent_context` endpoint returns `Tool get_agent_context not found`.

## Approach

Use aligned, labelled thumbnail rows and an inline original preview. The header
status navigates to the existing message-owned execution disclosure, rather than
opening another floating status surface. Preserve original file order, explicit
download/open, scoped fetches, object URL cleanup, owner guards, and truthful
unconfirmed states. Compare the rendered baseline and final direction using the
same synthetic content and viewport.

## Milestones

1. **Complete:** trace source ownership and implement message-bound evidence and
   status inspection with focused regression coverage.
2. **Complete:** relevant unit, accessibility, failure/retry, responsive browser
   and reload checks. Independent native Codex reviewer closed two P2 findings
   (stale mobile negative margins and Escape ownership across task rollover),
   plus verified focus recovery when collapsing hides the source thumbnail.
   No confirmed findings remain; final commit binding is still required.
3. **Active:** create/reuse the canonical PR, bind review and every applicable CI to its
   latest head, then merge through normal protection gates.
4. Deploy affected resident Web service from clean committed source, read back
   its revision, verify authenticated isolated-space interactions and recovery,
   then set/read back Linear Done. Record Symphony handoff and resource cleanup.

## Completion evidence

Local evidence so far: 41 focused tests and the final full conversation suite
(357 tests across 32 files) passed. Documentation, typecheck and lint passed.
Authenticated browser checks use the one owned `get264-evidence` test run under
the default account's existing CLI authorization. Desktop and 760/390/320px
viewports passed inline inspection, exact trigger focus, persisted image
readback after reload, and no page errors. Browser plugin is unavailable;
Playwright reused existing Chromium 1243 without installing another browser.
The CLI's requested Chromium 1248 was absent; the run itself was read back ready
and reused. An initial picker harness bypassed the required Add files action,
so its text-only send is explicitly not image acceptance. The corrected picker
flow admitted four synthetic images and retained the model's actual reply.
Original stacked thumbnails also intercepted center clicks; baseline preview
was captured after the real Expand control, without forced clicks.

The reviewer role's preset model was unsupported by this account; a default
native Codex sub-agent performed the independent review instead. No new
provider, Token Plan call, or recurring review was introduced. Next rejected an
external dist directory, so its disposable dev output uses the standard ignored
application `.next` directory. Generated development type imports are restored
before commit; they are not product changes.
The 320px painted capture exposed the existing floating Back to latest button
over the inline toolbar; open previews now place that control in the composer
grid. Its final geometry must be read back after deployment.

Retain sanitized, dated artifacts under ignored `output/evaluation/get-264/`
and `.symphony/evidence/`. Final receipts must identify reviewer, PR head, merge
SHA, resident deployment revision, real interaction/reload evidence, test-space
cleanup, and Linear Done readback. Missing release/acceptance evidence leaves
the issue In Progress. No empty PR is created for a blocking-only outcome.
