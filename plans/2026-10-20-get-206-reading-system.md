# GET-206 — Complete the workspace reading system

## Outcome and boundary

Make remaining working surfaces use the existing shared reading hierarchy:
comfortable substantive text, subordinate metadata, and legible controls.
Keep business meaning, data, authorization, routing, and interaction behavior
unchanged. Public marketing compositions and native SwiftUI are outside this
CSS migration. Do not introduce a second design system.

The authoritative issue is
[GET-206](https://linear.app/getyak/issue/GET-206).
The baseline is `30b41f32` on the isolated `codex/get-206-work` checkout.
The source checkout is never modified. `.symphony/` is private local state.

## Inventory and migration order

| Priority | Owner | Observed drift | Implemented candidate |
| --- | --- | --- | --- |
| 1 | Shared theme / Web adapter | The adapter repeats five type values already owned by `workspace-ui`; line rhythm is independently repeated. | Alias the existing scale and add shared reading/metadata line heights. |
| 1 | Queued and restored Session conversation | User text is 14px; queued text/editing and recovery are 12–13px; narrow rules repeat the smaller type. | Migrate substantive text to body, metadata to meta, controls to nav; preserve wrapping and state distinctions. |
| 1 | Semantic response | Milestones and tables shrink to 14px, provenance to 12px; canvas overrides compete with base rules. | One body rhythm; retain bounded code/table scrolling and explicit list presentation. |
| 2 | Session directory, review and legacy utilities | Locally declared small type survives in empty/error states, source/review details and utility controls. | Migrate by meaning, with readable explanations and full control targets. |
| 2 | Legacy relationship conversation global CSS | Three generations of type declarations plus host overrides compete. | Consolidate the selected legacy reading selectors at their original owner; remove superseded type-only overrides. |
| 2 | Pursuit room / Agent rail, legacy Meetings, new conversation recovery | Evidence, explanations, draft fields and recovery text still used small local display values. | Explicit body, metadata and control mappings; narrow editable fields retain the platform-safe input size. |
| 2 | Account sign-in methods, system health and disconnected state | Small recovery prose; account methods also used fixed light-only surfaces and text. | Existing reading roles and host theme colors; preserve all authentication and recovery behavior. |
| Retain | Already polished Today, Time, People, Settings, Person; public concepts/marketing | Existing shared scale or intentionally separate display composition. | Check representative continuity; avoid a whole-file numeric replacement. |

## Delivery batches

1. Shared scale: retain the existing token owner, use rem roles and shared line
   rhythm, alias the Web adapter and consolidate superseded legacy overrides.
2. Conversation surfaces: align reading, metadata, composers and recovery controls.
3. Remaining utilities: account sign-in, contextual panels, review, meetings and
   health/recovery surfaces, together with the design-system documentation.

Keep these as separate commits and use a merge commit so each migration batch
can be reverted independently. Refresh the main baseline before creating the PR.

## Verification and acceptance

Host takeover on2026-10-20 replaces the restricted worker execution; Symphony
remains paused. Prior worker evidence is preserved in the ignored
output/evaluation/get-206 directory and the host takeover evidence directory.

- Independent review found no confirmed P0/P1/P2 in the original migration.
- A real browser check reproduced large-root clipping in both conversation
  titles: 32px root led to30px type in a23px box, with35px glyph bounds.
- Corrected the12 remaining fixed-pixel line heights paired with rem reading
  roles across three affected stylesheets. Headings/meta now use the existing
  shared line-height tokens. At32px root, title boxes are42px for35px glyphs;
  at16px root they are21px for17px glyphs. No clipping remains in those samples.
- Independent review rechecked this small correction and closed the confirmed P2.
-38 focused tests across five files pass after the correction; whitespace
  validation passes. Earlier worker evidence records184 tests across17files.
- Pending: actual matched light/dark/forced-color and narrow Web comparisons,
  long Chinese/English/multilingual content and focus/disabled/retry geometry.
  Controlled rendering samples must remain distinct from live/native evidence.
- Pending: current-head CI, normal merge and clean resident Web deployment,
  live revision/behavior readback and required acceptance before Linear Done.

This CSS migration does not alter data, business meaning, authentication,
permissions, navigation or native SwiftUI. Keep unverified acceptance explicit.
