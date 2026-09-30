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
2. [x] Implement and locally verify one integrated slice with Pi + MiMo.
3. [ ] Independent subagent review, fix confirmed findings, rendered comparison and behavioral acceptance.
4. [ ] PR, current-head CI gates, merge/readback, issue acceptance/readback.
## Verification
Focused queue/render/projection lifecycle tests; Web lint/typecheck/build and docs checks; real rendered empty/populated/streaming/stopped/review states at 1280x820, collapsed, dark, narrow and reduced motion; preserve scroll and IME. Synthetic fixtures only. Verify macOS resident surface wiring separately from pure browser proof.
## Acceptance checkpoints
- GET-128 must be checked against the original issue, including delivering queued interruption context after the current tool completes and merging rapid fragments before processing. A next-turn-only implementation is not automatically equivalent; trace the actual provider dispatch and record/fix any gap before closure.
- An entry marked completed is not by itself enough to claim canonical answer readback. Pending decisions must reflect current proposal/draft review status rather than mere presence of an object.
- Forming output and interrupted output remain bounded, ephemeral drafts unless existing governed retention establishes the canonical record. Do not invent evidence or tool success in execution cards.
## Integration ownership
- Pi owns the conversation projection, queue presentation and sidebar implementation in its separate checkout.
- Integration owner adds an opt-in inline layout to `workspace-composer.tsx` and its CSS in the integration checkout (outside Pi's file ownership). Connect it after importing the reviewed Pi patch. It keeps send limits, intake and suggestion behavior while lowering the initial field to 62px.
- Integration owner also adjusts the authenticated Web theme adapter: white light canvas, explicit warm user/Agent bubble variables, and actual 64px rail token. Existing shared token fallback remained 56px, so changing only its fallback in shell CSS would not satisfy the Figma rail.
- Inline composer implementation typecheck passed before integration; repeat integrated verification after wiring.
## Runtime proof setup
- Installed `/Users/cubxxw/Applications/Talent Signal.app` opens the authenticated resident Web origin on Tailscale port 10443; native toolbar and companion remain native. Actual current home verified without sending or exporting customer data.
- Disposable local Postgres/backend/Next environment uses synthetic seed accounts and a deterministic no-network model. Baseline empty/home and completed-conversation screenshots captured; intended render comparison at 1280x820.
- Implementation task: Pi `20260930-234844-771978b9` on separate frozen branch. Integration owner retains PR, independent review, rendered acceptance and issue verification.
## Risks and decisions
Existing durable queue and SSE remain authority; stage transitions must never imply a tool succeeded. Progress preview is ephemeral, not source evidence. Do not introduce a new Agent SDK or AG-UI transport just to restyle proven execution. Native and production effects remain outside scope.


## Integration acceptance corrections (2026-10-01)

- Independent review of e506810 identified a blocking GET-128 backend steering
  gap. New Pi task 20261001-012056-f7347ec9 owns Agent/queue/backend/contracts;
  integration owner retains Web and any necessary producer adapter outside
  that frozen task scope. No issue closure or PR delivery before the gap closes.
- Integrated inline composer, actual white/warm theme tokens, 20px Agent mark,
  semantic final bubbles and the full expanded search trigger. Real synthetic
  browser measured 248/64px sidebar, 68px title and 880x62px composer.
- Removed arbitrary text splitting/truncation from live reply presentation.
  Whole forming Markdown stays inside folded draft detail; only a short neutral
  acknowledgement is dialogue. Stage observations are not tool successes.
- Queued and failure entries now project a transcript execution record with
  stable message identity. Retain session-local observations after completion;
  durable actual tool completion metadata remains backend acceptance.
- Governed memory/calendar cards report current pending/resolved/unknown
  readback. Verified calendar dismissal clears waiting-review on the same
  execution surface; historical references do not assert pending status.
- Browser proof found a retained draft locator sending New back to old history.
  Guard admitted bootstrap reinitialization and give a listener-free New click
  a fresh server draft id. A real second click opened an empty new conversation;
  the old conversation and its failed entry remained preserved.
- Synthetic failure retained the human message and failure record; Escape
  preserved canonical partial output, paused later input, and Continue resumed.
  390px dark and 1280x480 screens retain the composer without horizontal
  overflow. A mobile search trigger collision was found and corrected.

## Backend checkpoint correction ownership

- A frozen provisional snapshot of Pi's backend candidate is integrated for
  review; the private manifest records exact source hashes. Pi continues its
  own first tests in its separate checkout. Integration owns subsequent
  corrections; never overwrite them with a later full Pi patch.
- Read-only independent pre-review found early intake closure before the first
  tool, delivery before SDK consumption, non-accumulating image batch bounds
  and unsupported-only closure loops. These are blocking and remain open.
- The pinned SDK supports PostToolBatch before the next model call and Stop
  context feedback. Use those primary-run checkpoints, preserve intake on an
  empty tool checkpoint, and close only at a final checkpoint. A staged batch
  needs a later model-consumption acknowledgment before canonical folding.

## Final integration checkpoint

- Parent corrected the provisional implementation: primary PostToolBatch/Stop
  context, later consumption acknowledgment, capability selection window, whole
  unsupported-image detachment and bounded fragment intake. Original backend P1
  requires frozen-SHA re-review before delivery.
- Dynamic grounding keeps each source separate. Queue-owned metadata and answer
  blocks are immutable to public Session writes; only the fenced internal writer
  can add them. Stop/result races recheck owned cancellation before terminal save.
- Local proof: Agent 332 pass/1 existing skip, Web 1616 pass/1 existing skip,
  isolated PostgreSQL 188 pass, all relevant typechecks and docs checks pass.
  Synthetic screenshots now live in the evaluation directory.
- Pi's second attempt failed its frozen file-scope audit; its result was never
  treated as verified delivery. Integration retains ownership of accepted bridges
  and independent corrections. No paid retry or provider switch was performed.
- Remaining: independent review, latest-head gates, merge, actual resident Web
  and backend update/readback, Linear Done readback, precise task cleanup.
