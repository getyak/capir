# GET-282 — Impeccable and the quiet workspace

## Outcome and boundary

Install the project-scoped Cursor Impeccable skill, initialize it from the
existing canonical product/design documents, and apply distill, quieter,
clarify and polish to the shared Web/macOS conversation workspace. Empty
Working should have breathing room, near-white content and lightweight chrome.
Ordinary controls should describe user actions rather than runtime mechanics.
Identity, evidence, approvals, failure/recovery and draft continuity stay intact.

No new Agent capability, provider, external action, account migration, or iOS
change is in scope. Native macOS shares the hosted Web workspace; native
presentation must be checked separately from browser emulation.

## Starting evidence and unknowns

- Clean isolated branch `codex/get-282-impeccable-ui` starts at `0f6fe610`.
- Full issue retrieved from native Linear and the parent snapshot on 2026-10-29.
- Exact branch and title searches have not found an existing GET-282 PR yet.
- Resource audit: 77 GiB free; high Node count and swap require serial work.
- Resident Web observed at `680bb6cc`; ownership and revision must be checked
  again before any shared activation.
- Existing 880px conversation axis, mobile controls, native titlebar budget and
  disclosure/recovery behavior are contracts, not redesign opportunities.

## Approach and milestones

1. **Complete:** install/read Impeccable; establish detector and rendered baseline;
   initialize context by linking authoritative docs rather than duplicating them.
2. **Complete:** apply a small complete visual/copy slice; compare two rendered directions at
   matching content, viewport and theme against the Ambi/Linear references.
3. **Active:** run focused interaction tests, type/lint/build and detector; obtain independent
   review and fix confirmed findings. Recheck latest remote and current-head CI.
4. Reuse/create the single canonical PR, link Linear, merge normally after gates,
   deploy affected resident Web from clean committed source with ownership checks,
   then verify live revision and Web/native changed behavior.
5. Verify isolated test-account cleanup, update Linear only after acceptance, and
   preserve evidence plus the Symphony handoff event.

## Completion evidence

- Installation provenance/version; initialized product/design pointers; explicit
  record of each requested Impeccable pass.
- Before/after empty and populated workspace screenshots; responsive, theme,
  keyboard, error/recovery and native checks appropriate to the changed surface.
- Detector findings and resolution with scope/rule limits stated honestly.
- Independent review, latest-head applicable CI, merge readback, clean deployment
  receipt, live revision and behavior, Linear state readback.

## Progress

2026-10-29: Impeccable 4.8.0 installed by the requested project-scoped command,
with its engine pinned to 0.1.18, Cursor hook and upstream Apache license.
`PRODUCT.md` routes init to the already confirmed repository context; existing
`design.md` remains the visual routing adapter. No new product inference or
workflow preference was invented.

The four requested passes:

- **Distill:** remove the two repeated prompt buttons beneath the composer;
  draft starters remain under Add → Tools and skills. The ordinary path is
  an invitation and one editor, without a new panel or nested card.
- **Quieter:** near-white retrieval chrome, a smaller identity mark/title and
  shorter welcome copy. Keep body text and the populated 880px reading axis.
- **Clarify:** replace internal queue/steering jargon in all five catalogs;
  keep locked edits, failures, pauses, source and approval behavior intact.
- **Polish:** align the light native opaque roles with shared tokens, keep
  placeholder contrast at the full muted color, preserve focus and responsive
  controls, and remove obsolete starter styles.

## Verification so far

- Web typecheck, lint and docs checks passed.
- Conversation, queue/failure/recovery, add-menu, navigation and locale checks:
  38 files / 481 tests passed. Updated only the changed accessible label in
  existing queue assertions; identity, ordering and locked-edit checks remain.
- Shared workspace UI: 18 tests passed; hybrid host: 14 tests passed; hybrid UI
  build passed. Full native macOS app build passed (two compile jobs).
- Web production build passed with the normal staging Web configuration.
- Impeccable source baseline and current rendered empty workspace CDP scan
  returned `[]` (zero primary findings); this is not a whole-product audit.
- Browser baseline: 1440×1000, isolated `daily` run. The centered experimental
  invitation and selected aligned invitation used the same content/viewport.
  The selected composition keeps the mark and text on the editor's reading axis;
  centering added a second axis and unnecessary vertical separation.
- Real macOS WebKit: isolated debug app bundle
  `com.getyak.acceptance.get282`, task-only loopback origin and test-session
  cookie. Empty/narrow and expanded desktop, light/dark, visible editor focus,
  Add → Tools → Prepare meeting questions (draft only), People sidebar browsing,
  and reload retaining the unsent draft were observed. These checks do not
  establish a signed app release or real-account login/renewal acceptance.

Reference readback used [Ambi's public features](https://www.ambi.ai/en/features)
and [Linear's official UI redesign](https://linear.app/changelog/2024-03-20-new-linear-ui).
Ambi's authenticated workspace was unavailable; its public presentation informs
restraint only. No ambient collection or autonomous execution was borrowed.

## Evidence and remaining work

Durable screenshots:
`/Users/cubxxw/.codex/visualizations/2026/10/29/01a1857f-2a90-71b1-9e47-4b396f6deaec/get282/`.
Native screenshots/AX observations are retained in this chat. Private credentials,
browser state, logs, the isolated app and reproducible builds stay in the registered
temporary artifact `/private/tmp/ai-test-GET-282.oBNxTi` and must not be committed.

Initial test run `f70b2513-5ca5-40ed-8304-5b61a7278119`, request
`08bde9ec-9b5a-454e-b5c2-cb9de653251e`, was stopped: both stop and status
read back `deleted` with `cleanup_error=null`. Its invalidated credential and
browser-state files were removed; formal evidence and source were preserved.
Initial Chromium absence, incomplete TLS downloads, missing package builds and
a missing build-time AUTH_SECRET were diagnosed and recovered. The abandoned
tail-origin-to-dev browser proxy is harness evidence, not an acceptance pass.
Unadmitted empty drafts already produce expected detail 404 probes; report this
separately from runtime errors.

Independent review of the business change and installation entry returned no
confirmed P0/P1/P2. Imported reference Markdown subsequently received only
whitespace normalization and a documentation-link correction; docs checks pass.
Browser reload initially read the draft before hydration settled; a later
readback found the full staged draft and an enabled editor. The resumed harness
must wait for the actual ready state before judging recovery.

The controller authorized continuation on 2026-10-29 under the same generation
and workspace. Current remote `8d4816f` (including the already merged GET-275 and
GET-262 changes) was merged without conflicts. Recheck the integrated revision;
prior evidence does not certify untested new code. GET-262 is still completing
acceptance on the resident `8d4816f` Web release: verify its ownership and cleanup
before activation. Keep test data, ports and browser contexts separate.

Responsive/theme/keyboard browser checks, latest-head CI, canonical PR/merge,
clean resident activation and live acceptance, the new test run's cleanup and
Linear readback remain open. UI acceptance does not require paid generation;
the separately recorded Hao HTTP 402 must not be retried or bypassed here.


Resumed integrated verification: Web typecheck, 38 focused files / 483 tests and
production build passed. Real browser checks covered Add → Tools drafting without
sending, sidebar navigation/reload retaining the ready draft, keyboard return,
390px fresh entry without overflow, and reduced-motion light/dark themes.
The first resize screenshot retained a stale painted header; a fresh entry had
correct geometry and bottom navigation. A theme screenshot captured a pending
0.01ms reduced-motion color transition. Bringing the page forward and waiting for
the actual heading color settled light/dark in 76/43ms; no CSS change was needed.
Both failed captures remain evidence alongside the corrected captures.

Initial full CI found two server-render tests still expecting the old welcome
copy (3,493 other tests passed). Their assertions now expect the new heading;
the two files / 35 tests pass. Backend, CLI, hybrid boundary, native build/tests,
repository policy/docs and Security required passed on the previous head. Latest
head CI must still pass after this correction. Optional Vercel Web preview was
rate limited; do not retry or change its account/billing scope.
