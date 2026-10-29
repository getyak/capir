# GET-259 — Quiet People rows and named navigation

## Outcome and boundary

At rest, People sidebar rows lead with the person's name and one context line.
Arrange controls appear on pointer hover, keyboard focus, or explicit Arrange
mode. Expanded navigation always names all four destinations and distinguishes
the selection. Preserve existing account-local ordering, drag, keyboard menu
moves, search restrictions, narrow-screen navigation and accessibility.

No changes to relationship evidence, provider calls, backend state or native
application code. GET-251's shared shell remains the visual baseline.

## Evidence and approach

- Dedicated clean Symphony workspace, branch `codex/get-259-chrome`.
- Latest remote main at start: `8d4816f` (includes GET-262).
- Existing People rows mount `ListOrderMenu`; its 44px handle is always painted.
- Expanded rail only paints the selected destination's label. Search competes
  for the same row. Move expanded Search beside the brand utilities and show
  four short text destinations; retain deliberate collapsed and mobile icons.
- Keep hidden order controls mounted and keyboard reachable. Explicit Arrange
  mode gives touch users a discoverable route without sticky hover behavior.
- Resource audit: no host pause marker, over 69 GiB free; high swap/process count
  requires serial checks/builds. Do not touch other tasks' resources.

## Milestones

1. **Done:** implement scoped disclosure and navigation; focused tests pass (60).
2. **Done:** render desktop/narrow, pointer, keyboard, touch, themes and reduced motion;
   retain sanitized synthetic evidence outside source.
3. **Active:** independent review, address findings, create the sole linked PR, verify latest
   applicable checks and repository gates, then ordinary merge.
4. Serialize affected resident Web deployment from clean merged source; verify
   revision and behavior, clean owned temporary resources, update/read back Linear.

## Completion proof

Focused and applicable host checks, browser screenshots and interaction readback,
independent review, canonical PR, latest-head CI, merge readback, live Web release
revision and scoped acceptance, test-account cleanup and Linear state readback.
CI, local browser evidence and resident acceptance remain separate observations.

## Verification observations

- Typecheck, lint and docs checks passed before final disclosure refinements;
  the final combined check is running. Focused 60-test run passed after them.
- Desktop browser: static/hover/focus, keyboard Move down, pointer drag, reload,
  explicit Arrange/Done, reset, global search/Escape and collapsed rail passed.
- 390px navigation, dark/reduced-motion and forced-colors rendered successfully.
- Independent review found one P2 (visible/accessibility label mismatch); fixed
  and read-only re-reviewed with no remaining confirmed findings.
- Keyboard disclosure uses focus-visible so a touch on the trailing part of a
  person link does not reveal a new target underneath that same tap.
- Browser console recorded an intermittent system-health 503; list reads and
  ordering stayed functional. No model was invoked.
- A broad Web run was interrupted after source changed during it; its stale
  assertions are not completion evidence. The final focused rerun passed;
  latest-head applicable CI remains required.
- Sanitized screenshots and interaction receipts will be retained in the task
  visualization directory; private credentials/browser state stay temporary.
- Japanese navigation is complete at sidebar widths 236, 224 and 200px.
  Touch checks passed for a resting row's trailing edge opening the exact Person,
  explicit Arrange/menu moves, and a real touch drag. The test account retains
  its system display-language preference; browser locale supplied Japanese.
- Canonical PR: https://github.com/getyak/capir/pull/479 (linked/read back in Linear).
- Final release and cleanup receipts supplement this plan in the task's external
  delivery evidence after merge; they must not be inferred from the checkboxes.
- Full Web CI exposed one remaining legacy assertion placing Search inside the
  primary row (3,496 tests passed). It now checks that Search remains before the
  row beside the brand, while the row preserves the four destination order.
