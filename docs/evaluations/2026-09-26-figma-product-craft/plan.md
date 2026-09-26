# Figma-led product craft

Status: active — Figma module authoring and first implementation batch.

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
4. Independently review code and compare real UI against the updated designs.
   Exercise navigation, populated/empty/error states, keyboard, narrow layout,
   light/dark appearance, and reduced motion as relevant. Fix confirmed defects.
5. Complete appropriate lint, type checks, tests, build, and `pnpm docs:check`;
   record exactly what is complete and any remaining platform limitations.

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
