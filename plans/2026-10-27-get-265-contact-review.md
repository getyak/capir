# GET-265 Contact review

## Outcome and boundary

Make the actual Session contact decision readable at a glance: one identity row,
relationship context, nearby evidence, one Add action and secondary operations.
Preserve explicit confirmation, identity comparison, editing, dismissal, source
authorization, recovery, undo and idempotent writes. Do not change the data model,
Memory decisions, native clients or other issues.

## Evidence and approach

- Baseline: clean `codex/get-265-contact` at remote main `d25be6e` (GET-266/263 included).
- Renderer: `SessionMemoryCards` in `memory-item-card.tsx` owns the props;
  `contact-decision-card.tsx` owns presentation; `use-memory-review.ts` owns effects.
- Reference: capir-evals `apps/studio/app/references/10-review.png` inspected locally.
  Borrow its identity-first order, unframed evidence and single dominant confirmation.
  Preserve the compact inline Session surface rather than copy its full-page layout.
- Replace four peer buttons with Add and an explicitly named secondary popover.
  Keep ambiguity, unavailable source and unknown outcomes outside disclosure.
- Existing resident Web release is `acc538f9`; this task requires a new clean
  committed Web release and real isolated-account acceptance before Done.
- Resources initially 34.13 GiB free, 15.48 GiB swap, 294 Node/npm processes.
  Run only affected checks serially; reuse dependencies using APFS clones.

## Milestones

1. Active: implement the card and focused interaction/state tests.
2. Pending: rendered desktop/narrow/theme/keyboard checks and independent review.
3. Pending: canonical PR, current-head CI, merge readback.
4. Pending: resident Web deployment, isolated real-account acceptance, cleanup and Linear readback.

## Completion evidence

Save sanitized review, exact-head tests/CI/merge, rendered captures, deployed
revision, target-account/write/readback/undo and owned-test cleanup in
`docs/verification/2026-10-27-get-265-contact-review.md` or the permanent issue
evidence directory. Passing source checks alone does not complete this plan.
