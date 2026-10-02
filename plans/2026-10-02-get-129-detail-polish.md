# GET-129 detail polish

## Outcome and boundary

Refine the existing Web conversation utilities against current Figwright
measurements: inline composer spacing, quiet menu chrome, person-context
information rhythm and reachable dismissal controls. Preserve sending, IME,
account authorization, draft recovery, provenance and all external-write rules.
Do not add unsupported microphone actions or copy synthetic identities/assets.

The root checkout has concurrent Web and macOS changes and remains untouched.
Use the owned `codex/get-129-detail-polish` branch from verified remote main
`e5e2ae538399a93d9aaf05b5a14267b588b6a613`. Previous PR #273 merged-main CI,
including iOS release smoke, is now confirmed successful.

## Design evidence

Figwright reports `Talent Signal · macOS 工作区视觉方案`; current selection
belongs to Mobile, while read-only IDs confirm the shared Desktop main section
`31:68`. No page navigation or design writes are needed.
Full measured reads and source screenshots are preserved at
`/Users/cubxxw/.codex/visualizations/2026/10/02/get-129-detail-polish/figma`.

- Composer `404:2355`: 62px high, 16px radius, 10px horizontal padding,
  8px gaps and 44px controls.
- Utility popover `31:585`: 18px radius, quiet border, 0/8/24 shadow at 10%
  opacity, 14/22 primary rows and 12/20 secondary text.
- Contact preview `537:3423`: 8px group rhythm, 2px identity/provenance gap,
  32px property rows and 42px history content with 6px inter-row gaps.
- Drawer close `31:699`: 40px desktop control; preserve 44px mobile controls,
  sticky reachability and immediate removal of closed private content.

## Milestones

1. Complete: Pi + MiMo Pro implemented the four contracted CSS modules.
   Parent imported the checked patch and refined review findings in the same scope.
2. Complete: verified final production-mode synthetic Web controls: desktop/mobile,
   multiline/IME, menus, focus recovery, short-window scroll and reduced motion.
   Run narrow existing host checks, production build and docs checks.
3. Complete: independent code review has no unresolved P0/P1/P2. Independent
   visual checkpoint is 98/100 after supplemental normal-motion frame evidence;
   the first score of 97 is retained with its reason in the review record.
4. UI PR #274 merged as `a911bfcf19bbe863c751e4764e441a59cccec824` after
   exact-head CI/Security/Vercel and independent reviews passed. Active:
   repair the exposed main cancellation-proof startup/cleanup race and verify
   its related follow-up gates. Keep GET-129 In Progress while its original
   resident/native/capir acceptance remains absent.

## Acceptance limits and resource ownership

The public `test@gmail.com` fixture applies only to an isolated seeded backend.
Named temporary artifact: `/private/tmp/ai-test-get-129-detail-polish.04Q3x5`.
Use an owned synthetic database and named CLI browser; never reseed the shared
resident backend. Reuse the canonical capir/CLI entry when configured; the
known missing `local-test` environment and failed resident password entry do
not authorize an authentication bypass. No local iOS Simulator is needed.
Preserve formal proof, then remove only this task's disposable resources.

## Review corrections

- Keep the drawer close focus ring inside its target when scrolled to y2.
- Extend opaque sticky chrome above the negatively offset close target.
- Await entry animation before taking stable menu screenshots.
- Preserve 44px mobile utility actions; reserve bottom-navigation space through
  the mobile height range, and move very short-window details beside the summary
  so it can still be clicked to close. Verify 640x220, 320x321 and 640x400.
- Require positive actual panel scroll before claiming mobile bottom-scroll proof.
- Save appearance preferences through the ordinary settings action before route
  navigation; a temporary settings preview is not a persisted dark-mode result.

Production builds need both the isolated AUTH_SECRET and NODE_ENV=production.
Missing/incorrect harness environment attempts were corrected before acceptance.

## Merge-time CI finding

Main run 37007639753 timed out in the abort-ignoring queue-provider proof.
The owned `codex/get-129-main-ci-repair` branch starts from merged main a911bfcf.
Only that integration test and related evidence/plan are owned by this repair;
UI source and its 98/100 assessment stay unchanged. See [the CI repair evaluation](../docs/evaluations/2026-10-02-get-129-detail-polish/ci-repair.md)
for its authoritative cause, counterexample, verification and delivery record.
