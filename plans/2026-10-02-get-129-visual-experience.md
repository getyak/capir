# GET-129 visual experience completion

## Outcome and boundary

Complete the shared authenticated Web/macOS home, sidebar and contact context
experience from the issue's Figma frames, with independent code and visual
review above 97/100 on a documented rubric. Scores are reviewer judgments,
not objective certification. Preserve canonical identity, account scope,
evidence status, draft continuity and explicit human decisions.

Out of scope: unrelated dirty checkout changes, GET-128 runtime redesign,
new provider behavior, native iOS, product-wide rebranding and real customer
content in model or public evidence. The Figma capir wordmark is a design
variation; keep the repository's established product identity.

## Baseline and sources

- Fresh `origin/main`: b5bcce2423275d3f4bdc624920e3194b7daaa490.
- Worktree: `/Users/cubxxw/.codex/worktrees/get-129-visual-experience/talent-signal`.
- Previous implementation PR #267 was merged; its visual measurements did not
  cover the latest compact navigation or contact preview drawer.
- GetYak workspace readback matches 8c969130-4eed-4049-85f9-ae04796db4be.
- Figwright plugin reconnected in the Talent Signal file; full context grounded
  by visible child section after oversized trees returned section plans.
- References: 31:135, 31:137, 551:5816, 31:584; section 527:2816 and drawer
  31:696. Raw trees/screenshots stay in the private task visualization folder.
- Native app now shows an authenticated empty home. Customer content must
  never be copied into delegate prompts or public screenshots.
- Storage audit reports 76 GiB free. Avoid heavyweight native builds and
  unrelated cleanup; shared macOS host uses Web, so verify the Web changes.

## Milestones

1. Implemented: grounded compact navigation, sidebar and contact preview,
   preserving every existing destination and supported interaction.
2. Verified: rendered synthetic fixtures, verify desktop/dark/narrow/keyboard/motion,
   and trace contact preview to the existing canonical person destination.
3. Passed: independent code and visual review (98.0/100); all confirmed findings closed.
4. Active: current-head CI/security, merge, resident Web update and native readback.
5. Close GET-129 only after acceptance and preserve evidence/cleanup receipts.

## Review rubric

Composition and reference fidelity 30; typography/spacing/material 20;
navigation and interaction continuity 20; responsive/accessibility 15;
motion and complete state handling 10; identity/evidence clarity 5.
Any unresolved P0/P1 or unverified required surface prevents acceptance,
regardless of the aggregate score. Screenshots use synthetic records only.

## Verification

Run focused Web tests, lint, typecheck, build and `pnpm docs:check`.
Inspect home, populated Session, People, person preview/destination, footer
and account menu at 1280x820 plus narrow/dark/reduced-motion states. Assert
no unintended horizontal overflow, keyboard access and draft persistence.
Native final acceptance reads the running signed-in app and deployed revision.

## Implementation checkpoint

Pi task `20261002-013821-5cce4441` used the frozen MiMo Pro provider/model.
After an evidence-based resume, the API stalled without completing a turn for
more than seven minutes. The delegate was cancelled, its partial four-file
patch preserved, and Codex took ownership. No fallback provider or budget
expansion was used.

Independent review found and closed authorization downgrade, cross-device
deletion refresh, canonical Session return, Portal theme scope, and Memory
statement labels. The reviewer independently passed 21 tests and found no
remaining P0/P1. Real-browser inspection then added the same exact-ID context
entry to bound legacy Sessions, including mobile. That narrow addition is
under independent re-review.

Local checks so far: focused navigation suite 72 tests; new projection/route/
panel suite 19 tests; TypeScript and docs checks pass. Final lint, expanded
Session regression suite, visual score, production build and external delivery
remain pending. Generated Next development type references are not source
changes and will be restored before commit.

Final focused regression: 103 tests / 16 files pass; independent legacy review
65 tests / 5 files pass. Visual rubric 98.0/100 after stable readback.
