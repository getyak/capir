# GET-251 quiet workspace

## Outcome and boundary

The conversation and its current object should lead before navigation chrome.
Use the existing near-white canvas and light neutral sidebar, a default sidebar
within 224–248px, 13px retrieval labels, and 16–18px associated-person avatars.
The Person destination has one name line; supporting profile and identity facts
remain available in its reference column. Preserve accessible names, 44px
controls, draft/navigation continuity, recovery, themes and responsive behavior.

This issue does not redesign navigation/order controls, empty Person content,
working-state ownership, attachments, review cards or execution receipts. Those
are the separate related issues linked from GET-251.

## Current evidence

- Fresh `origin/main` and task branch start at `bb585f6b`; the checkout is isolated.
- Linear MCP readback confirms GetYak workspace, GET team and GET-251 In Progress.
  Its attachments and comments are empty. Related issues were read without writes.
- Existing canonical PR lookup by title and task branch found no GET-251 PR.
- The rendered handoff uses a 236px sidebar and 13px navigation labels.
- Existing shell palette already has a white canvas and `#f4f3ef` sidebar.
  Recent Session avatars are 24px, sidebar Person avatars 28px, and the Person
  header uses a 48px editor and stacked supporting text.
- Host resources warn about Node/MCP count and swap. Avoid overlapping builds;
  no Simulator is required for these Web presentation changes.

## Approach

Reuse the existing shared shell, identity and editor components. Reduce chrome
within its owning surface rather than reducing conversation body type or global
avatar defaults. Keep stored sidebar widths and collapse/recovery behavior.
Compare the baseline and candidate with identical synthetic content, viewport,
theme and loading state, plus the handoff reference.

## Milestones

1. **Complete:** implement focused hierarchy and retain navigation/identity behavior.
2. **Active:** run affected tests, lint/type checks and rendered desktop/narrow/theme/focus
   acceptance, including draft restoration and honest failure states.
3. Obtain independent review; fix and re-review confirmed P0/P1 findings.
4. Create/reuse one GET-251 PR, link it to Linear, pass all current-head gates,
   merge normally, deploy the affected resident Web from clean committed source,
   and verify its live revision and changed behavior.
5. Read back completed acceptance and Linear Done, preserve receipts, and clean
   only task-owned rebuildable resources. Missing required evidence stays open.

## Completion evidence

Record exact tested/reviewed head, checks, PR, merge revision, served build ID,
real authenticated surface observations and test-account cleanup separately.
Do not infer installed macOS acceptance from Web checks or green CI.

## Verification so far

- Web typecheck and lint passed; documentation, Wiki and architecture checks passed.
- Seven focused test files passed (71 tests); the subsequent sidebar breakpoint
  change passed its 18 tests, including three saved-width recovery cases.
- The default 236px width retains navigation labels; only widths below 224px
  use the compact label presentation. Existing custom widths remain unchanged.
- The entitled CLI identity is the default test account. Its daily isolated run
  is ready with 12 contacts, 30 observations and four tasks. Browser auto-launch
  lacked the requested local Chromium version; manual isolated acceptance uses
  the installed Chromium and the same run rather than allocating another run.
- Resident Web configuration preflight passed. Deployment, independent review,
  current-head CI and merge remain outstanding.
