# Calendar progressive disclosure

## Outcome and scope

Refine the native relationship calendar so recruiters can scan time, person,
and activity before encountering secondary controls. Deliver compact day rows,
a real calendar-week time grid, and progressively disclosed filters and event
metadata. Preserve stable person identity, evidence boundaries, preview-only
behavior, explicit calendar confirmation, and unsent Agent preparation.

This work owns the isolated `codex/refine-calendar-disclosure` worktree. It does
not include concurrent Lab/backend changes in the shared checkout. Prior
calendar v1 is already published as 0.1.45; its release proof remains historical.

## Evidence and decisions

- Fresh native v1 screenshots show the first activity below several repeated
  control rows, large cards with duplicated time/status, and a rolling seven-day
  list labeled as a week. Before/after evidence is in
  [the evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-calendar-progressive-disclosure/README.md).
- Use one compact view menu for view selection and date shortcuts; keep person
  filtering in a separate section and show an active filter chip outside it.
- Default day rows remain chronological, with an explicit time rail; row height
  does not imply elapsed duration. Week geometry does represent clock time.
- Keep seven readable day columns horizontally scrollable with a fixed hour
  gutter. Use chronological fallback for accessibility sizes and irregular DST
  days rather than squeezing text or misrepresenting repeated clock hours.
- Fold normal metadata in event details. Preview and sync exceptions remain
  visible. Notion's official view/property-visibility documentation informs
  disclosure, not a claim about recruiter efficacy or its mobile week layout:
  <https://www.notion.com/help/views-filters-and-sorts>.

## Milestones

1. Completed: inspect code, instructions, and fresh native day/week/detail baseline.
2. Completed: compact controls, day rail, actual week grid, and folded metadata.
3. Completed: 17 distinct targeted tests pass, including fresh-Simulator week
   scrolling/hour alignment, filter/person round trips and conflict disclosure.
   Native Chinese/English and dark AX5 captures, preview authority, localization,
   and documentation checks are recorded in the evaluation manifest.
4. Completed: durable guidance and evidence recorded; PR #122 merged as
   `28cf5df`; TestFlight 0.1.46 build `20260904175747` processed and published
   with an automation-owned receipt bound to that exact merge commit.

## Completion evidence

Native before/after captures, tests for true week boundaries and grid collision
layout, filters/view changes/detail disclosure/preview authority, reviewed diff,
required CI gates, and exact remote merge/release receipts. Do not infer Apple
device installation from server processing.


## Completion

The compact calendar and actual week timeline are merged and released. The
passing PR CI run verified the exact source tree merged to `main`; App Store
Connect independently processed that signed build. Evidence does not establish
that a tester installed it or measure recruiter productivity. The next change
should reopen this plan only if real-device use contradicts the density,
disclosure, or horizontal-week decisions recorded here.
