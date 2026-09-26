# Figma-led product craft

Status: restoration implemented and verified — PR pending.

## Outcome and boundary

Unify Talent Signal's product presentation, improve the editable Figma source,
and implement the resulting module designs on `codex/figma-product-craft`.
The user's reference is [the product design file](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=28-139).
The delivery must include module-specific design links, working interactions,
independent review, and matching-viewport visual evidence. Aesthetic improvement
is a reasoned design judgment, not a claim established by tests or a numeric score.

Preserve canonical identity, evidence, proposals, approvals, recovery, and
deletion semantics. Use synthetic fixtures for design verification. Existing
native-only proposals and exploration boards are not automatically implemented
features. Do not modify the resident deployment, unrelated worktrees, or live
relationship data as part of visual verification.

## Baseline and evidence

- Frozen code baseline: `0baab0cf`, freshly fetched `origin/main` on 2026-09-26.
- Isolated worktree: `/Users/cubxxw/data/talent-signal-worktrees/figma-product-craft`.
- Formal file is editable in Figma Desktop; Figwright 0.5.0 end-to-end ping
  reaches page `10:62`. Desktop UI identifies the exact reference file.
- Figma pages: Guide `10:62`, Desktop/Web `0:1`, Mobile `28:62`, Explore `34:1404`.
- Source inventories and original exports are held outside the repository in
  `/Users/cubxxw/.local/share/figwright/artifacts/product-craft-20260926`.
- Current direction includes conversation `31:135`, context `31:584`, People
  `28:137`, person `28:138`, settings proposal `34:2976`, mobile Sessions
  `32:798`, People `34:1562`, and person `32:800`.

## Design read

Primary surface: desktop relationship knowledge workspace, with mobile
adaptation. Audience: people maintaining client, partner, collaboration, or
recruiting relationships. The question is: what changed, what matters now,
and what is the smallest supported next step?

Retain the warm neutral notebook character, readable operational typography,
and scarce vermilion attention. Prefer coherent page rhythm, purposeful open
space, stable navigation, exact sources, and clear state transitions. Design
decisions remain provisional until current screenshots and interaction agree.

## Milestones

1. **Active:** inspect Figma and the running fixture product; map module and
   implementation ownership, capture baseline screenshots, and identify actual
   gaps rather than replacing established patterns arbitrarily.
2. Compare two rendered compositions for consequential visual changes. Choose
   against product clarity, recognizable character, density, and accessibility;
   improve Figma with reusable assets and record node links by module.
3. Delegate settled implementation batches to Pi + MiMo, preserving one writer
   per owned area and Codex ownership of Figma and final integration. Read back
   the optimized Figma before applying the corresponding implementation.
   **Restoration pass (2026-09-27):** Figma editing is frozen; the R4 frames are
   the source of truth. `restoration-spec.md` converts them into per-module
   implementation contracts. Five parallel batches (today/pursuit,
   people/person, time/sources, extensions/settings, conversation) run with
   disjoint file ownership; the integrator owns shared tokens
   (`packages/workspace-ui`), the Web theme adapter, shell CSS, verification
   tooling, docs and the branch.
4. Independently review code and compare real UI against the updated designs.
   Exercise navigation, populated/empty/error states, keyboard, narrow layout,
   light/dark appearance, and reduced motion as relevant. Fix confirmed defects.
5. Complete appropriate lint, type checks, tests, build, and `pnpm docs:check`;
   record exactly what is complete and any remaining platform limitations.
   **2026-09-27 verification:** Web 1399 tests + workspace-ui 18 + macos-hybrid
   14 green, `tsc6 --noEmit` clean, ESLint 0 errors (5 pre-existing warnings in
   untouched files), production `next build` passes with a local `AUTH_SECRET`,
   `pnpm docs:check` passes. Compared each of the nine frames plus the dark
   people frame against live fixture screenshots at 1280x820 and a 900px
   narrow viewport; DOM measurements prove the shared frame (236px sidebar,
   1040px content, 8/12px radii, 24/22/18/15/13 scale).

## Decisions and unknowns

- User granted design edits and implementation in an independent branch.
- Clarification pending: “Zeplin” may name the design handoff platform or the
  existing Pi + MiMo implementation workflow. No Zeplin tool was discovered.
- Mobile source frames and desktop source frames require separate coverage;
  shared Web verification cannot establish native iOS acceptance.
- Before adding any new module, establish its canonical owner and existing
  supported behavior. A design proposal must not imply a backend capability.
- Selected People A after exporting and viewing both compositions; 9 editable
  module frames are linked in the design contract. Final refinement is active.
- Pi foundation batch: `20260926-192733-9cdd2855`, frozen base `4af6de96`.
- Parent owns deadline presentation and product-facing pursuit copy. Four
  deadline regression cases plus six projection cases passed; integration and
  final visual review remain open.
- Synthetic runtime exposes intermittent database read/connection timeouts.
  Liveness remains responsive; Time activity source-redaction SQL has a recorded
  57014 statement timeout. This is not proven to be caused by visual changes.
  Diagnostic receipts are under the external artifact runtime directory.
- No release or complete product acceptance has been recorded yet.
- Shared foundation landed on the branch: canonical tokens now match the
  contract palette (light canvas #FCFBF7 / chrome #F4F3EF / accent #BC3827,
  warm dark #171816/#20211E/#F18F7D), type scale 24/22/18/15/13, radii 8/12.
  `workspace-ui` (18) and `macos-hybrid` (14) tests stay green after the token
  change; DOM measurement at 1280x820 confirms sidebar 236px, canvas/ink/
  accent/divider and radii on the live fixture app.
- Visual review channel caveat: batched image reads can deliver stale or
  shifted screenshots; screenshots are burned with file labels
  (`/tmp/ui-craft/label.mjs`) and structure is verified through DOM
  measurements (`/tmp/ui-craft/verify-dom.mjs`), not eyes alone.
- First parallel batch pass (2026-09-27) exhausted its 45-minute budget in
  analysis-heavy exploration; all five were revived with tight implementation
  budgets. Partial work already in the worktree: people directory + person
  memory CSS/TSX, time workspace, extensions. The R4 frame list in Figma matches
  `design-frames.json` exactly (Today 63:1453 … Settings 63:2075, People dark
  63:2414); one batch briefly suspected extra frame versions — there are none.
