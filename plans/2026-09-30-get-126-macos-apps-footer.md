# GET-126 macOS workspace footer delivery plan

## Outcome and boundary

Deliver the Linear GET-126 design and implementation: avatar, Connect apps,
width-exchanging download/update utility, actual offered-version tooltip,
avatar-menu update action, read-only weekly usage, mobile access and useful
support. Retain the quiet workspace language and the existing account/native
settings distinction. No fake multi-account or public iOS install capability.

No candidate evidence, original issue screenshots or credentials enter fixtures,
logs or artifacts. Hover never performs an effect. Updates retain the existing
host-owned trusted offer/activation flow; email still requires native confirmation
and a human send decision. A weekly reference allowance does not change admission,
billing or retention. Account, member and session changes hide old usage.

## Recorded decisions

- Selected A: constant 216px footer, 40/120/40 controls and two 8px gaps;
  220ms width exchange with keyboard equivalence and reduced motion.
- Menu utilities precede preferences; expanded support stays inline and can
  scroll within a viewport-bounded menu. Footer renders only in a hosted view.
- Current ISO week uses Asia/Shanghai, Monday-to-Monday half-open bounds.
  Count unique retained run IDs for the authenticated account/member, excluding
  future records. Default weekly reference allowance: configurable 1000.
- Usage proxy validates the rendered account fingerprint and opaque member/session
  binding. Failure remains unavailable/retry; it never becomes a made-up zero.
- Older hosts copy the support email; a capability-advertising new host confirms
  an allowlisted mail draft. iOS download surface states preview availability
  and offers a real request-access path.

## Proof and handoff

Implementation, editable Figma, real PostgreSQL aggregate proof, Chromium and
native WK presentation/cancel proof are recorded in the
[dated evaluation](../docs/evaluations/2026-09-30-get-126/README.md).
Independent review closes all P0/P1 and scores this checked slice 96/100.
The evaluation is the authoritative home for test counts, observations,
remaining deductions and limitations; this plan does not duplicate those receipts.

Before delivery, run docs:check, Web lint/typecheck/focused tests and backend
typecheck/weekly tests. PR creation follows independent review. Remote delivery
requires all applicable latest-head CI including Check macOS, repository gates,
merge read-back, and a final Linear read-back. The linked issue and PR retain
those mutable outcomes rather than a speculative completed checkbox here.

Local resources are task-scoped. Preserve formal synthetic evidence before
removing the registered temporary artifact and stopping only this task's
servers/apps. Do not touch the main checkout's unrelated untracked Figma audit,
other Docker stacks or shared simulator state.
