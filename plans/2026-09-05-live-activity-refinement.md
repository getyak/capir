# Live Activity refinement

## Outcome and scope

Make the existing iOS recording, Agent handoff, and synthetic Research Live
Activities legible at a glance. Compact and minimal presentations must distinguish
work, review, partial results, uncertainty, stale updates, and an ended activity.
Expanded and Lock Screen layouts lead with the task and one safe action.

This is presentation and state-projection work. Candidate content stays out of
system surfaces; exact-instance routes and human review remain authoritative.
The Debug showcases remain synthetic. Production APNs/background execution and
physical-device Always-On validation are outside this slice.

## Evidence and ownership

- The current Research widget derives attention from the presence of a review
  action, causing invalid/ended states to share the working label.
- Research minimal has one fixed symbol, and both widgets ignore system staleness.
- Agent and Research repeat branding, phase, attention, and boundary prose.
- Recording has independent color/type and review-completion symbolism.
- The shared checkout contains unrelated active work. Own only Activity shared
  models, extension views, their tests, narrowly added translations, and this
  plan/evidence. Preserve all other changes. Use a dedicated Simulator and build
  directory, never the active Calendar Simulator.

## Approach

Retain the native black surface and restrained vermilion attention. Use explicit
presentation status rather than inferring success/attention from a link. Honor
ActivityKit staleness without changing domain state. Retain one boundary line
and one independently accessible destination. Reuse a small visual vocabulary
across the existing widgets; do not introduce a new design direction.

## Milestones

1. **Done:** Capture the baseline on an isolated device and map state/route limits.
2. **Done:** Implement clear compact/minimal status and quieter expanded/Lock Screen layouts.
3. **Done:** Verify projection failure/staleness/terminal behavior and real system handoffs;
   capture English and Chinese layouts, then review the diff and document limits.

## Completion evidence

Focused unit and system UI tests, fresh Simulator screenshots of running and
review states, exact-instance return/end verification, targeted boundary cases,
and `pnpm docs:check`. Physical-device claims require physical-device evidence.

## Progress

- Baseline build and exact Research system journey passed on dedicated device
  `432CF099-1379-47F5-93EB-8E87F7B2782C`. Six original screenshots exported to
  `/tmp/talent-signal-island-proof/baseline`; the baseline visibly clips the
  expanded trailing attention text and repeats the task phase.
- Shared display statuses now drive text and symbols. System staleness replaces
  live claims without changing stored business state or the exact-instance route.
  Invalid presentations have no unsupported deep link. Recording uses explicit
  review symbolism and hides a stale live timer.
- Partial Agent results previously offered a completed-review route which the
  App correctly rejected. They now open issue resolution without creating a full
  review session or ending the activity. Only the narrow resolution predicate in
  the already-modified showcase file was edited.
- Focused build and 30 state/lifecycle tests passed. New tests cover invalid,
  stale, partial, and ended presentation plus safe partial handoff.
- Deterministic prevention belongs in these tests (knowledge-steward routing),
  not new global instructions. Fresh UI verification is running.
- First UI iteration passed Agent running/review, all four boundary layouts,
  and Research App fallback. It exposed two verification corrections: old tests
  expected supporting prose intentionally removed from the new design, and
  app-only launch language does not control the extension's system language.
  The final tests assert visible title/boundary/action and run Chinese receipts
  only with Chinese system language. Rounded-corner clipping of trailing labels
  was observed and corrected with an explicit safe inset.
- The next integrated build was blocked by unrelated in-progress
  `RelationshipCaptureStage` cases missing from `RelationshipCaptureView`.
  No unrelated production files were changed. A detached clean-base worktree at
  `/tmp/talent-signal-island-20260905-worktree` carries this slice for independent
  verification. Its source is identical for the owned Activity files; only the
  unrelated custom Reduce Motion environment property stays at its base value.
- Final verification passed: 34 focused unit/lifecycle tests, four English
  system journeys (including all four boundary-return routes), and one Chinese
  dark AX5 journey covering compact, expanded, and Notification Center cards.
  The current shared-workspace App build also passed. Build-for-testing still
  encountered an unrelated in-progress RelationshipCapture test stub; focused
  test receipts are explicitly attributed to the isolated clean-base build.
- The final source, 16 unedited screenshots, and test summaries are recorded in
  [the evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-live-activity-refinement/README.md).
  The system-card screenshots preserve Apple's first-use permission prompt;
  they are not presented as physically locked-device evidence.
- The isolated PR branch was rebased onto current `origin/main`. Its App build,
  the 34 focused tests under an explicit `en-US` test locale, `pnpm docs:check`,
  screenshot hashes, and source manifest all passed before publishing.
- The UI refinement slice is complete. Recording visual capture, system-selected
  minimal, signed-device Always-On, and real background delivery remain separate
  verification limits rather than inferred passes.
