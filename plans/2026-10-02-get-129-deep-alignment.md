# GET-129: current Figma alignment refinement

## Outcome and boundary

Refine the existing Web conversation workspace against the visible current Figma section 31:68, preserving account fences, provenance, draft/send behavior, and native authentication boundaries. This follow-up does not claim completion of the outstanding signed native login acceptance.

## Grounded direction

Compare baseline A (main b0912030) with direction B (current Figma fidelity). Figwright source receipts and screenshots are held at `/Users/cubxxw/.codex/visualizations/2026/10/02/get-129-deep-alignment`.

- Canvas 404:2307: 68 px centered header; 880 px shared transcript/composer axis; centered send timestamps before user messages; 20 px assistant mark with 14 px gap.
- Sidebar 404:2268: 248 px expanded / 72 px rail; quiet warm selection and available width for related-person labels.
- Drawer 31:696 / 537:3423: 336 px full-height warm chrome with content beginning 68 + 24 px below the top; 24 px horizontal padding; readable 12/20 provenance. Narrow screens retain modal focus management and 44 px targets.
- Keep Talent Signal branding and authorized dynamic identities rather than copying Figma demo identities. Do not redesign search based solely on a comment without a matching settled frame.

## Ownership and state

- Parent: source interpretation, panel geometry and reversible motion, real-surface verification, independent review, PR/CI/merge, issue status.
- Pi/MiMo batch 20261002-163000-a9a93e58 was cancelled after research without a source diff. The parent implemented the bounded conversation and sidebar refinement; no second paid batch or provider fallback.
- Independent reviewers: required code review and fresh visual review after implementation.
- Baseline Web typecheck passed. Storage audit reports 94 GiB available; no Simulator required for this Web-only change.

## Completion evidence

Focused regression checks, baseline/enhanced synthetic Web screenshots, desktop/narrow/dark/reduced-motion/keyboard and zoom checks, and independent review findings tied to the delivered revision. Run documentation checks for this plan and final receipt. Latest PR-head CI and applicable security gates must pass before merge. Keep GET-129 In Progress until its separate native login acceptance is actually complete.

## Implementation and review progress

Centered 68 px legacy header, named 44 px controls, send timestamps retaining ISO dates and years, leading assistant identity, flat warm selection, wider related-person chips, and full-height context chrome with 12 px provenance are implemented. Existing scope, draft, retry, and privacy fences remain intact. Closing the panel immediately removes its content; no exit-motion claim.

Independent code review found no P0/P1 and identified a classic-scrollbar alignment P2. Both conversation renderers now reserve symmetric transcript gutters and measure their actual occupied width with a shared ResizeObserver hook. Composer width subtracts that same inset while leaving floating menus unclipped. Overlay-scrollbar and custom classic-scrollbar geometry must be verified from the browser before final review.

Visual review additionally identified a partially clipped short-window close
control and an older 14/22 shared response override. The parent restored actual
assistant body/list type to 15/25 and made the drawer heading sticky with an
inset derived from the existing desktop/mobile padding. Final evidence is
captured from a production server with the same explicit authenticated-backend
mode used by the resident launcher. This configuration is required for the
People directory; an initial production probe with that flag omitted correctly
returned local_integration_disabled and was not accepted as proof.

## Verified local completion

Production build and actual production-mode browser acceptance passed. All
recorded Escape/focus, unchanged draft, closed-content removal, narrow reflow,
short-window destination/close and dark/reduced-motion checks passed. Controlled
Chromium custom scrollbars reserve 32px symmetrically and both renderers align at
1280/1024/820/640/390px; the add menu remains unclipped. Focused regression:
50/50 across nine files; typecheck, production build and lint (zero errors,
six pre-existing warnings) passed. Independent code re-review has no unresolved
P0/P1/P2; independent visual re-review is 98/100. See the
[evaluation](../docs/evaluations/2026-10-02-get-129-deep-alignment/README.md).
PR/latest-head gates, merge and resident Web activation are the remaining delivery
steps; separate signed native acceptance keeps the issue In Progress.

## CI repair

Original PR head 8e160047 passed Web/security/Vercel but failed an existing
backend prioritize integration test. The test now waits for provider selection,
asserts the mutation's transaction-returned snapshot and actual invocation
order, avoiding transient flags and scrubbed objective polling. Production
logic is unchanged. Final isolated PostgreSQL checks: 59/59 plus five targeted
repetitions; backend typecheck and independent test re-review passed. The
supplemental MiMo run was stopped without a final validated output, with private
evidence preserved and no paid restart. Latest-head CI must run again.
