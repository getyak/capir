# GET-128 / GET-129 — macOS home and conversation
## Installed Mac follow-up (2026-10-18)

The signed/notarized installed Mac 0.2.8 (125), resident Web 44e1757, and the
authorized default test workspace now have direct home, 248/72px sidebar,
person-context readback and Escape-to-opener evidence. Fixtures are explicitly
synthetic, with an empty saved conversation and no model request. They do not
establish GET-128's real-provider steering acceptance.

Independent review found dark sidebar labels at approximately 2.8:1 after a
68% Web tint composited over light AppKit material. This follow-up makes the
dark native tint dominant while retaining the light theme and opaque
reduced-transparency fallback. Delivery still requires current-head CI, a clean
resident Web deployment, and installed Mac contrast/motion revalidation.

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

## Frozen-review corrections

- Review of 35096742 found one P1 and two P2: force-close mutation after lost
  ownership, pre-execution-record canonical recovery, and observed tool receipts
  lost in a Stop/failure race. All are corrected; 56 queue DB tests and backend
  typecheck pass. Three stale ownership cases change no member or queue revision;
  legacy recovery compares the exact owned response and rejects body tampering.
- Full Memory DB regression: 86 passed. Backend unit regression: 825 passed,
  393 optional fixture skips. No provisional failure was counted as success.

## Bounded SDK usage diagnostics follow-up (2026-10-18)

- First real-provider steering attempt recorded, not passed. Installed Mac
  0.2.8 (125) with resident Web/backend 7f5dd62 observed two distinct SDK
  assistant events; aggregate 39295 input / 9 output tokens hit the unchanged
  32000 maxTaskTokens cap after 33s (`MODEL_RUN_TOKEN_BUDGET_EXHAUSTED`).
  Supplements B/C were admitted into the same Run and stayed dispatching;
  none was delivered and no final turn followed. There is no evidence yet of
  double counting, and this record claims no root cause.
- Confirmed evidence gap only: `claudeHarness.ts` flushes each assistant frame
  with nested `metadata.usage` and raw `sdk_message_id`, while
  `metadataOnlyProductSpan`/cleanupSQL retain only whitelisted flat primitive
  values. Failed or source-less receipts therefore permanently lose per-frame
  raw/cache usage and stable SDK identity.
- This slice adds bounded flat primitive diagnostic keys beside the unchanged
  full-source fields: `sdk_message_id_sha256` (lowercase 64-hex SHA-256 of the
  actual SDK message ID, never the raw ID), `sdk_input_tokens` (provider raw
  input excluding cache per the Anthropic contract), `sdk_output_tokens`,
  `sdk_cache_read_input_tokens`, `sdk_cache_creation_input_tokens`,
  `sdk_total_input_tokens` (raw+read+creation only when all three are
  explicitly known and the sum is safe, otherwise null), fixed
  `sdk_usage_basis`, and `sdk_stop_reason` from the known stop enum or null.
  Missing or invalid values stay null; a genuine zero stays zero. The raw ID,
  nested `metadata.usage`, full-source bodies and the existing
  message-ID-upsert deduplication are unchanged.
- Unchanged on purpose: `messageUsage` map/aggregate high-water accounting,
  all runtime budgets and the 32000 maxTaskTokens cap, tool capabilities,
  model/default selection, observation policy/exposure and retention/expiry.
  No usage ledger, counter or fetch changes.
- Focused red/green tests cover distinct and repeated SDK message IDs, hashed
  identity, raw-vs-total counts, genuine-zero vs absent-null, unsafe-sum-null,
  unknown/absent stop reasons, the failed-run leaf path, backend
  metadataOnly/cleanup shared keys and unchanged aggregate exhaustion.
- Next: independent review, resident deployment, then one diagnosed actual
  retry at the unchanged 32000 budget before deciding functional fix vs
  blocker.

## Preparation fast-stop generation fix (2026-10-18)

- Confirmed separate bug, not a claim about the earlier arithmetic 32000
  failure: `claudeHarness` latched `preparationSuperseded` permanently when
  text steering was admitted. `calendar.discard` invalidated the old draft,
  but a newly staged valid `finish_preparation:true` draft could never use
  the PostToolBatch fast-stop; the existing test only rebuilt a
  `finish_preparation:false` draft.
- Resolved strictly by host generation, never by resetting the latch after
  unrelated tools. `ClaudeHarnessRequest.preparationRevision?: () => number`
  (optional and backwards compatible) is exposed by `calendarDraftCapability`
  and supplied by both production `ClaudeChatProvider` call sites (answer and
  natural-mode runInternal; the JSON adapter stays unchanged). The calendar
  generation starts at 0 and advances atomically together with draft and
  finishing state only on accepted staging or discard; rejected, failed and
  duplicate staging never advance it. The write tool stays nondelegable.
- The harness observes generations as nonnegative safe integers, monotonically.
  Each admitted steering batch calls the existing discard first, then captures
  that generation as the invalidated floor. The fast-stop re-arms only for a
  strictly newer valid generation with `preparationReady()` true, with every
  existing primary/tool-failure/outputSchema/current-source/lease/abort/budget
  gate intact. Legacy hosts without a callback stay fail-closed after steering
  exactly as before; invalid, unsafe, constant-old or regressing generations
  cannot re-arm, and opaque draft IDs are never trusted. Generation and
  readiness are re-read after the async source/budget fences immediately before
  stopping. Behavior before the first supersession is unchanged.
- Focused red/green tests run through the actual mocked SDK hooks and the actual
  calendar capability: old finishing draft -> steering discards -> new finishing
  draft quoted from the latest original -> fast-stop before another model call;
  old draft, constant readiness/revision and unrelated primary success cannot
  stop; repeated steering invalidates each new current preparation again; failed
  staging never advances or re-arms; invalid, negative, fractional, unsafe and
  regressing generations fail closed; legacy hosts remain safe; outputSchema,
  failed-tool, source/lease, cancel and budget gates still block a re-armed
  preparation. Steering tests pin discard-then-capture floor ordering at every
  admitted batch and the Stop-admission re-arm path. Provider tests verify both
  call sites actually supply the generation function while the JSON adapter
  stays unchanged; calendar tests pin the generation lifecycle.
- Unchanged on purpose: budgets and the 32000 maxTaskTokens cap, tool
  capabilities and prompts, sticky `preparationToolFailed`, token aggregation,
  SDK parameters, provisional/final text behavior and all d07e937e diagnostic
  metadata. No retries, truth stores or grants were added.
- Local verification: focused Agent tests (calendarDraft,
  claudeHarnessPreparation, claudeHarnessSteering, claudeHarness) 96 passed,
  Agent typecheck and docs checks pass. Remaining live acceptance stays open:
  independent review, combined GET-128PR with current-head CI including
  allAgent+backend+DB, resident backend deployment/readback, and the
  parent-owned one unchanged-32000 diagnosed retry. No overallDone.

## Bounded tool context discovery follow-up (2026-10-18)

- Direction and diagnosis stayed as the parent settled them: resident run
  9c30d331 failed at the unchanged 32000 maxTaskTokens cap with two distinct
  provider messages (18529 and 20715 total input, 2 + 4 output) while the
  plain-text workspace conversation eagerly loaded contact_workspace
  variants, the memory_review union, mcp_connections and every other
  capability (`alwaysLoad:true`). No duplicate accounting was ever observed;
  no budget, ceiling, model or authorization was changed.
- Implementation uses only the pinned @anthropic-ai/claude-agent-sdk 0.3.287 /
  bundled CLI 2.1.287 native bounded discovery. New narrow policy module
  `claudeToolContextPolicy.ts` pins `ToolSearch`, a single `"bounded"` opt-in
  mode, and a bounded supported input contract (`select:<name,...>`, keyword
  and `+required` queries, query ≤ 4000 chars, `max_results` 1–50, no unknown
  keys). `ClaudeHarnessRequest.toolDiscovery` is the only harness surface. It
  is admitted only for Runs without subagent child manifests; an opt-in that
  cannot be proven is rejected with `CLAUDE_HARNESS_TOOL_DISCOVERY_NOT_ADMITTED`
  before the SDK stream opens, and every unflagged Run keeps legacy behavior.
- Only for admitted opt-ins does the harness add `ToolSearch` to the explicit
  SDK `tools`/`allowedTools` lists and set `ENABLE_TOOL_SEARCH=true` in the
  isolated subprocess env, so a third-party baseUrl cannot silently inflate all
  schemas. Legacy Runs never see either. `settingSources:[]`, the single
  `talent_signal` in-process MCP catalog, the forbidden-builtin denials, the
  isolated cwd/env allowlist and every tool gate are unchanged.
- Discovery governance: the PreToolUse gate runs the existing abort/source/
  lease/token-budget checks plus the bounded query validation before any
  discovery, counts each actual invocation exactly once against the same
  `maxToolCalls` cap (over-cap denies and fails the Run on
  `CLAUDE_HARNESS_TOOL_BUDGET` exactly like product tools), denies hostile
  keys, unbounded values and delegated children, and PostToolUse never treats
  `ToolSearch` as a product-tool completion: no receipt, no
  `preparationReady`/fast-stop satisfaction, no business effect authority.
  Discovery never reaches the host `invokeTool` seam.
- Provider opt-in is limited to ordinary-text workspace conversation
  (`runInternal`, non-JSON, no images): the large admitted catalog
  (contact_workspace variants, memory_review, mcp_connections) defers
  (`alwaysLoad:false`) while response preference and calendar preparation stay
  upfront (`alwaysLoad:true`). Relationship answers, JSON adapter and image
  Runs keep the legacy eager context, as do subagent configurations.

### Actual wire measurements (installed SDK + loopback deterministic SSE peer)

Real `ClaudeChatProvider` + `runClaudeHarness` + pinned native CLI against the
loopback peer from `testing/claudeToolContextSSEFixture.mjs`, public
`assistant/conversation` prompt text, synthetic credentials only. Evidence
receipts (full request/tool byte tables, protocol traces, source hashes) are in
the registered local artifact directory
`/private/tmp/ai-test-get-128-tool-context.25LoSf/tool-context-evidence/`
(baseline `tool-context-u3u8Hv/`, delivered `tool-context-AQXv1i/`). Bytes are
not token, billing or semantic proof.

- Before (baseline ea0ee480, ordinary-text workspace conversation, first
  Messages request): body 30,444 bytes; system 4,535; tools 23,298; messages
  2,168. All 8 tools eager: contact_workspace_propose_create 417+1735,
  propose_update 275+2329, read 374+599, search 520+1427, mcp_connections
  1201+1405, memory_review 1375+8058, read_response_preference 204+85,
  stage_calendar_draft 1418+1189 (description + schema bytes).
- After (same configuration, bounded discovery): first request body 12,434
  bytes (−59%); tools 4,723 bytes (−80%). Upfront only ToolSearch 992+406,
  read_response_preference 204+85, stage_calendar_draft 1418+1189 and one
  deferred placeholder 85+33. The six catalog tools' 4,162 description and
  15,553 schema bytes are absent from the first request while all six remain
  visible by their actual original names for discovery.
- Genuine discovery protocol (CLI-local over the registered Run-only catalog,
  never fabricated by the peer): keyword `"contact memory review"` returned
  `tool_reference` blocks for memory_review and all four contact_workspace
  operations (operation semantics); `select:` by exact original name loaded
  mcp_connections/read/propose_create/propose_update; `NotRegisteredTool`
  resolved to nothing (registered-only). Referenced tools then carry their
  schemas in later requests flagged `defer_loading:true` (the API tool-context
  contract's out-of-window representation).
- Governed execution: a hostile `{query, exfiltrate}` call was denied
  `TOOL_INPUT_INVALID: input: unrecognized_keys` before execution and never
  reached the host seam; the valid `contact_workspace_search` executed exactly
  once through `invokeTool` with an authentic completion receipt; `toolCalls`
  was 3 (two searches counted once each plus one capability call), completions
  were only `['contact_workspace_search']`, and the single final answer was the
  latest scripted text.
- Legacy unchanged on the wire: the JSON adapter's first request is
  byte-identical before/after (body 29,851; tools 23,298), and relationship
  answers keep eager cite_evidence/read_relationship_memory (tools 1,554
  bytes), no ToolSearch and no `ENABLE_TOOL_SEARCH`.
- The unchanged 32000 cap still fails the real 39244+4 evidence with discovery
  enabled (focused red/green unit test replays the two 9c30d331 message
  usages). Tool search adds `advanced-tool-use-2025-11-20` to the request betas
  in this CLI build; the `tool_reference`/deferred wire shape was observed
  directly at the peer.
- Focused verification: the contract's verify queue (claudeHarness,
  claudeHarnessPreparation, claudeHarnessSteering, claudeChatProvider) 133
  passed; claudeToolContextPolicy and the neighboring harness suites
  (Workspace, Authority, Continuation, capture) 25 passed;
  Agent typecheck, docs:check and `git diff --check` pass. The real-SDK
  suite `claudeHarnessToolContext.offline.test.ts` runs 3 loopback cases
  (legacy relationship answer, legacy JSON adapter, bounded multi-step
  discovery regression) 3/3 passed.

### Honest remaining validation (never GET-128 Done)

- Byte/schema footprint reduction is not token, billing or semantic proof.
  Later requests after discovery carry the referenced schemas with
  `defer_loading:true`; only a live provider/proxy acceptance can prove how
  `api.hao.ai` and the upstream account `defer_loading`/`tool_reference`
  context. The parent owns one post-fix real proxy compatibility/live
  acceptance after independent review and deployment.
- A proxy that does not forward `tool_reference`/deferred tool loading must
  fail honestly: no fallback model, budget bump, automatic retry or
  eager-schema expansion was added. The pinned CLI's own stream recovery is
  unchanged.
- The single parent-owned diagnosed retry at the unchanged 32000 budget,
  independent review, combined PR with current-head CI (allAgent + backend +
  DB), resident deployment/readback and issue acceptance all remain open.


### GET-128 parent authority review repair (2026-10-18)

Independent review found a real pinned-SDK boundary failure: a PreToolUse authority exception was treated as non-fatal by the CLI. The actual loopback source and host-issued continuation lease regressions each observed five Messages requests after revocation. Merely aborting the SDK was insufficient because its stdin-EOF shutdown grants a two-second grace window.

The final repair latches the original authority failure and returns the documented PreToolUse stop-and-deny response before aborting on the next SDK frame/terminal. The host always fails with that original error; hook_stopped cannot become a successful product completion. Ordinary validation denials and all budgets are unchanged. No custom subprocess management was retained.

Actual SDK 0.3.287 / native CLI loopback checks: all five context/authority cases pass. Source and lease revocation each permit exactly one Messages request, zero tool references, zero business calls, failed lease finalization and complete owned workspace cleanup. Both essential tool names are now asserted present with full schemas; every deferred catalog name is asserted visible. Three legacy/bounded context cases also pass. The affected 107 deterministic tests and agent TypeScript checks pass. An earlier full Agent run had 539 passes, 12 skips and one unchanged five-second configuration-test timeout on the resource-constrained Mac; it is retained as failed evidence, not waived. Current-head CI remains required.

These local protocol/wire results do not prove Hao compatibility, remote token savings, or completion of the real native same-budget steering acceptance. Those remain required before GET-128 can close.

The final acknowledgement fence also encloses its second source/lease check. An independently reproduced one-shot failure during pending steering now stops and fails the Run even if later checks recover; its hook-driver assertions live outside the SDK callback to prevent masked assertion failures. All 108 affected tests pass. The real five-case pinned-SDK matrix now runs explicitly in credential-free CI (synthetic loopback peer) with bounded JSON-only receipts, so these regressions are exercised rather than left skipped by default. The previously observed local configuration timeout cleared in a subsequent full Agent run (540 passed, 14 optional integration cases skipped); the final acknowledgement change was then rechecked by the 108 focused tests, all five actual SDK cases, build and typecheck.
