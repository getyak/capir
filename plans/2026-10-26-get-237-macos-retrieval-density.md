# GET-237: Installed macOS retrieval density

## Outcome and scope

The user explicitly selected **macOS: the locally installed capri client** as
the intended delivery target. Make Sessions and People easier to scan in that
client through smaller retrieval labels and tighter directory rows. Preserve
conversation reading size, user zoom, selected/filter/scroll state, labels,
identity, drafts, and responsive controls. No account/provider/Memory/Pinned
redesign, conversation send, or real-contact mutation is authorized.

The original Linear issue description says iOS. Preserve that historical text
and record the user's platform clarification in the delivery evidence; do not
claim iOS/TestFlight acceptance from macOS verification.

## Source and delivery

- Only write source in this issue workspace; branch is
  `codex/get-237-ios-session` (historical name).
- Refreshed main base: `7bd5b0a35d8ee2fdfa54a0dfae02c26b9738b35c`.
- Draft PR: https://github.com/getyak/capir/pull/449. Its temporary iOS baseline
  harness commit `c38cd37` is being reverted without rewriting history.
- The reviewed but unverified iOS implementation is preserved on local branch
  `codex/get-237-ios-density-preserved`; exact SHA is in
  `.symphony/evidence/get237-ios-preserved-sha.txt`. It is not the active delivery.
- Cancelled only the obsolete task-owned baseline CI `40283383043`; cancellation
  is not a passing gate. Do not interrupt unrelated project jobs/devices.

## Verified installed surface

- App: `/Users/cubxxw/Applications/Talent Signal.app`, bundle
  `com.talentsignal.macos`, version 0.2.36 (202), process 25389.
- Native window 493 is 1123x864; Web area is 1123x832. Accessibility and screen
  capture permissions are available. Bind PID/window/foreground before captures.
- Resident Web revision `285bfd8b08c4432f3d0911f44208ee90b7ad5c49`, build ID
  `NbW8lgwI0eNdyNcBBOQia`. Its four affected CSS files match the refreshed base.
- The initial installed window showed a Web loading error. One native Reload
  recovered it; retain the original sample separately, not as a layout result.
- The selected origin's native registry owner matches the authorized default
  `test@cubxxw.com` account/user. Native inspection is read-only list navigation;
  no real Session is opened/marked read and no real Person is edited.
- Native Sessions baseline: main row AX height 73pt, pitch 74pt; sidebar 40pt.
  Original private screenshots and sanitized geometry are retained in the task
  artifact and `.symphony/evidence/` respectively.

## Chosen implementation

Use the existing 14px navigation role for retrieval titles/names/context. Keep
13px metadata and 15px conversation body. Sessions directory minimum row goes
72→60px, People 83→64px. Sidebar People removes surplus padding (44px minimum)
and gap; sidebar Sessions keep their hit region. Keep semantic markup, URLs,
interaction logic, avatar editing targets, errors, focus and mobile adaptations.
Changes belong to the four owning CSS modules, not new global overrides.

## Verification and milestones

1. Native before captures complete: Sessions main 73pt/sidebar 40pt; People
   main 83pt/sidebar 51pt. At 1123x832, native main lists show 8 Sessions or
   6 People fully. Preserve the initially unsettled People capture separately.
2. Complete: 51 tests across 6 affected Web suites, docs:check, and independent
   review pass; no P0/P1 and no residual iOS diff. Missing local contract output
   was built before the successful test run; keep its initial failure log.
3. **Active:** latest-head CI/security/readback, normal merge, then build and deploy the
   affected resident Web service from clean committed source using the canonical
   local deployment procedure. Backend runtime is unaffected.
4. Confirm live revision/build ID and verify changed layout in the existing
   installed Mac app: ordinary/narrow/zoom, search, row actions, navigation/return,
   long mixed-script labels, themes/reduced motion and state continuity as relevant.
   Report physical VoiceOver or unavailable checks honestly.
5. Stop the owned test run and verify deletion/credential removal. Mark Linear
   Done only after the clarified macOS outcome, merge and runtime acceptance;
   preserve exact evidence and source/recovery references.

## Test isolation and resources

- Registered artifact: `/private/tmp/ai-test-GET-237.nTChJh`.
- Owned expiring run: `16295ed4-f9f7-4c5e-b524-c160367e011d`; target account
  `c83365f9-3f32-4731-a166-19ad3be9fb1b`; owner verified through capir auth.
  Reuse the frozen request/run; private credentials exist only in the artifact
  and managed keyring. Never print or publish them.
- `capir test create --preset daily --open web` created the run but its bundled
  browser executable was missing. Preserve the ready run. Playwright MCP also
  lacked its browser extension. Browser plugin is absent; use existing installed
  Chrome with existing Playwright, an isolated task profile, no new installation.
- Browser helper/script ownership and native screenshots remain task-local.
  Close only owned contexts/processes, then remove registered rebuildable data
  after formal evidence is saved. Preserve source branch, original requests,
  claim generation and cumulative counts.
