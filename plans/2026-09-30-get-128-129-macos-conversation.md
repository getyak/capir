# GET-128 / GET-129 — macOS home and conversation
## Outcome and boundary
Deliver the referenced Figma desktop conversation composition and a quiet IM-style Agent execution surface on the resident Web workspace used by macOS. Keep shared Web behavior coherent. No iOS or native permissions/auth changes, no live customer records, and no execution authority from generated text.
## Baseline and references
- Fresh origin/main: 794ec2617a540f5ab6cbbe05a4d1c44b6857ccec; separate managed worktree preserves source changes.
- Linear GetYak workspace verified: 8c969130-4eed-4049-85f9-ae04796db4be; GET-128 and GET-129 started.
- Official Figma MCP quota blocked. Figwright connected after selecting the existing Talent Signal file. Full design trees saved beside this plan for 31:135, 404:2268 and 404:2307.
- Screenshots: /Users/cubxxw/.codex/visualizations/2026/09/30/01a0f2fa-2c4e-7cc0-80d2-6937819ac959/figma-reference/
- Current reference: 248px sidebar; 64px collapsed rail; single-line sessions; 68px floating title; 880px shared reading/composer axis; centered timestamps; trailing user bubbles; leading semantic Agent bubbles; folded execution detail.
- Earlier R6 alternatives compared: centered shared-axis A chosen over left-aligned B because it preserves reading/composer alignment.
## Requirements
GET-129: refine home, sidebar, row/avatar density, title, borders, spacing and light/dark/compact behavior. Preserve all supported destinations, account controls, current default collapsed recent-history group and native chrome.
GET-128: immediate acknowledgement; separate execution from dialogue; coalesced in-place updates (>=500ms); real observed milestones; explicit queued/running/waiting-review/failed/completed/interrupted states; elapsed time without fabricated percentage; semantic message units without splitting code/lists/tables; standalone final result; usable input while running; meaningful supplement/fragment handling; Stop/Escape retaining completed work and explicit continuation; notifications only for final results or human decisions.
## Milestones
1. [x] Inspect issue requirements, canonical design, real Figma tree and current runtime.
2. [ ] Implement and locally verify one integrated slice with Pi + MiMo.
3. [ ] Independent subagent review, fix confirmed findings, rendered comparison and behavioral acceptance.
4. [ ] PR, current-head CI gates, merge/readback, issue acceptance/readback.
## Verification
Focused queue/render/projection lifecycle tests; Web lint/typecheck/build and docs checks; real rendered empty/populated/streaming/stopped/review states at 1280x820, collapsed, dark, narrow and reduced motion; preserve scroll and IME. Synthetic fixtures only. Verify macOS resident surface wiring separately from pure browser proof.
## Risks and decisions
Existing durable queue and SSE remain authority; stage transitions must never imply a tool succeeded. Progress preview is ephemeral, not source evidence. Do not introduce a new Agent SDK or AG-UI transport just to restyle proven execution. Native and production effects remain outside scope.

