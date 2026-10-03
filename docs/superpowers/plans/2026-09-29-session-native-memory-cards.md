# Session-native contact, Memory and calendar cards implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Web or macOS Session lets a person directly add a contact, decide one Memory change, or export a calendar draft, with each card showing its actual result and recovery in place.

**Architecture:** Keep the existing conversation controller and Memory domain as state owners. Add item-scoped Memory and contact-only decisions that preserve untouched proposal items, then render existing turns through an assistant-ui ExternalStoreRuntime with backend-selected Data UI parts. Reuse the governed meeting-draft revision and export path for the calendar card. The current composer, admission, attachment store, queue, and account session remain authoritative.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Next.js/React, `@assistant-ui/react@0.15.22`, Vitest, macOS WKWebView.

**Spec:** [Session-native result cards with assistant-ui](../specs/2026-09-28-session-native-agent-cards-design.md). The [Figma Session review](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=274-2737) fixes the visible card grammar; canonical domain and evidence rules still govern actions.

**Implementation status (2026-09-29):** Tasks 1–6 are implemented on the isolated `codex/session-agent-cards` branch. Task 7's backend, Web, documentation, and macOS build checks are recorded in the [evaluation](../../evaluations/2026-09-29-session-native-agent-cards/README.md). Actual WKWebView card interaction and calendar save-panel verification remain open because the Mac was locked during inspection.

## Global constraints

- One card represents one decision or one verifiable result. Show one change, a short exact excerpt, and direct effect-specific actions without a mandatory review-opening step.
- A model tool call does not create an authoritative card. The domain backend validates and persists the proposal; the message carries only its narrow reference.
- Existing batch Memory clients keep their current semantics. An item action never skips, selects, or edits a sibling.
- Human confirmation, source authority, account binding, proposal and item revisions, idempotency, and authoritative readback gate every write.
- Keep existing conversation send, queue, attachments, draft recovery, cancellation, login, and synchronization behavior. No conversation sync migration is part of this plan.
- This phase covers contact creation, atomic Memory decisions, and calendar-file export in Web and the macOS Web workspace. Native iOS and external MCP Apps require their own platform slices. Calendar-file generation never claims that another app imported an event.
- Product copy is short and names the effect. Never show a success receipt from an optimistic click or a person's score.

## Review focus

- A new contact with two pending Memory items: adding the contact creates only that Person; each Memory item stays pending until its own decision.
- Two pending Memory items: accepting or passing the first leaves the second pending. A lost response after commit reconciles the original operation key without a second write.
- Source revocation, expired review, stale item version, ambiguous identity or account switch: old buttons disappear or require a fresh choice; no unauthorized write occurs.
- A fast double click or two tabs deciding the same item: one operation wins; the other receives a stale or replay result, never a duplicate Memory row.
- A calendar draft with a changed revision, invalid local time or revoked source cannot export. A generated .ics file is never described as an imported event.
- Long excerpts, narrow viewport, keyboard focus, screen-reader labels, reduced motion, and an active response queue retain direct actions and recovery.

---

### Task 1: Protected item decision and sibling preservation

**Files:**
- Modify: `packages/contracts/src/memorySchemas.ts`, `packages/contracts/src/client.ts`
- Modify: `apps/backend/src/modules/memoryReviewCommit.ts`, `apps/backend/src/modules/memoryReviewRead.ts`, `apps/backend/src/modules/memoryReviewRoutes.ts`, `apps/backend/src/modules/memoryReview.ts`
- Test: `apps/backend/src/modules/memoryReview.test.ts`, `apps/backend/src/modules/memoryReview.integration.test.ts`

**Interfaces:**
- Produces: `MemoryItemDecisionRequest` with `idempotency_key`, `expected_proposal_revision`, `item_id`, `expected_item_version`, `decision`, optional `edited_text`, and current identity binding; `MemoryItemDecisionResponse` with item result, authoritative receipt when committed, current proposal revision, and remaining pending count.
- Produces: `POST /v1/memory/reviews/:reviewScopeId/item-decisions`, authenticated with the existing review credential header. The route calls `decideMemoryReviewItem(pool, auth, scopeId, credential, request)`.
- Consumes: existing review-scope, source, identity, conflict, idempotency, commit, dismissal, operation-readback, and undo checks.

- [ ] **Step 1: Write failing domain tests.** Two pending eligible items; accept item A, assert A committed and B pending; pass B, assert A unchanged; edited accept records the final value; stale version, wrong scope, revoked source, and double-click replay fail or replay as specified.
- [ ] **Step 2: Run** `pnpm --filter @talent-signal/backend exec vitest run src/modules/memoryReview.test.ts` and confirm the new assertions fail. Run the integration file only with `CONTACT_AGENT_TEST_DATABASE_URL` pointing to an isolated synthetic PostgreSQL database.
- [ ] **Step 3: Add the narrow contract and route.** A committed item uses the existing transaction, receipt, and operation readback with an internal `preservePending` mode; a skipped item uses a single-item dismissal with the same frozen scope. The new public body never exposes a `preservePending` switch. Reopen against the incremented proposal revision for surviving siblings. Reject contact-dependent acceptance until its identity is independently confirmed.
- [ ] **Step 4: Run the focused backend tests and contract typecheck.** Confirm sibling preservation, single receipt, source/revision rejection, and old batch behavior.
- [ ] **Step 5: Commit the protected item contract and backend implementation.**

### Task 2: Same-origin account binding and lost-response recovery

**Files:**
- Modify: `apps/web/lib/server/memoryReview.ts`, `apps/web/lib/server/memoryReview.test.ts`
- Modify: `apps/web/components/memory-review/use-memory-review.ts`, `apps/web/components/memory-review/use-memory-review.test.ts`
- Test: `apps/web/components/conversation/queued-conversation-memory-review.test.ts`

**Interfaces:**
- Produces: `useMemoryReview().decideItem({ itemId, expectedItemVersion, decision, editedText? })`, plus `refreshReview()` for sibling readback.
- Consumes: the current account-bound entry capability, protected review credential, and the existing session-only operation locator. No credential enters Session history or storage.

- [ ] **Step 1: Write failing BFF and controller tests.** Reject wrong account/session, foreign proposal lineage, missing credential and stale entry. On a response-loss simulation, retain the same operation key, reconcile before reopening actions, then display the backend receipt. On account switch, clear the former projection and locator.
- [ ] **Step 2: Run** `pnpm --filter @talent-signal/web exec vitest run lib/server/memoryReview.test.ts components/memory-review/use-memory-review.test.ts` and confirm the new assertions fail.
- [ ] **Step 3: Add the route allowlist and `decideItem`.** Reuse the current capability derivation and lineage read; persist an account-bound, text-free operation locator before POST. A known rejection may release the key; an unknown outcome may only reconcile or replay that exact key. Refresh remaining siblings after an accepted or skipped decision.
- [ ] **Step 4: Run the focused tests and Web typecheck.** Existing batch review and recovery cases must still pass.
- [ ] **Step 5: Commit the BFF and controller change.**

### Task 3: assistant-ui transcript adapter without changing execution ownership

**Files:**
- Modify: `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/components/conversation/queued-conversation.tsx`, `apps/web/components/conversation/queued-conversation.module.css`
- Create: `apps/web/components/conversation/session-runtime.tsx`, `apps/web/components/conversation/session-message-parts.tsx`, `apps/web/components/conversation/session-message-parts.test.tsx`
- Test: existing `apps/web/components/conversation/queued-conversation-*.test.ts`

**Interfaces:**
- Produces: `sessionMessages(detail, active, preview)` with stable user and assistant IDs derived from the canonical message ID. The assistant content carries ordinary response blocks and a `talent-signal.memory` Data UI part containing only version, message ID, proposal ID, observed revision and fallback text.
- Consumes: `useConversation` snapshots and current response/attachment renderers. The existing composer calls `chat.submit()`; assistant-ui never persists or sends on its own.

- [ ] **Step 1: Write failing adapter and whole-surface tests.** A text/image turn retains order and accessible images; progress is visibly incomplete; a committed turn mounts one Memory reference; unsupported data names show safe fallback; account change remounts the runtime; queue, draft and send behavior remain intact.
- [ ] **Step 2: Run** `pnpm --filter @talent-signal/web exec vitest run components/conversation/session-message-parts.test.tsx components/conversation/queued-conversation-memory-review.test.ts` and confirm the new assertions fail.
- [ ] **Step 3: Install `@assistant-ui/react@0.15.22` (its declared peers include React 19) and implement `useExternalStoreRuntime`.** Use `ThreadPrimitive.Messages` and `MessagePrimitive.Parts` with named Data UI rendering. Make the assistant-ui viewport the sole transcript scroll owner; preserve near-bottom follow behavior and the current composer outside it. Do not enable assistant-ui persistence, branching, or model-facing tools.
- [ ] **Step 4: Run focused conversation tests, Web typecheck and lint.** Inspect the rendered empty and populated transcript in a browser before accepting the adapter.
- [ ] **Step 5: Commit the transcript adapter.**

### Task 4: Direct Memory cards and truthful receipts

**Files:**
- Create: `apps/web/components/memory-review/memory-item-card.tsx`, `apps/web/components/memory-review/memory-item-card.test.tsx`
- Modify: `apps/web/components/memory-review/memory-review-card.tsx`, `apps/web/components/memory-review/memory-review.module.css`, `apps/web/components/conversation/session-message-parts.tsx`

**Interfaces:**
- Produces: a chat-only card for one visible Memory item, using `decideItem` from Task 2. The existing grouped form remains on People and relationship surfaces until separate review.
- Consumes: current authorized review projection and exact source locator. The card may request source inspection but never treats a citation or a model sentence as permission.

- [ ] **Step 1: Write failing component tests.** Each card shows the change and exact excerpt with direct Remember/Edit/Not now controls; editing stays inline; at most three pending cards show initially; no checkbox is preselected; saving disables only that operation; receipt appears only after canonical readback; unknown, stale, source unavailable and undo conflict retain truthful controls.
- [ ] **Step 2: Run** `pnpm --filter @talent-signal/web exec vitest run components/memory-review/memory-item-card.test.tsx components/memory-review/memory-review-card.test.ts` and confirm the new assertions fail.
- [ ] **Step 3: Implement the chat branch and scoped CSS.** Use the approved Figma hierarchy without decorative rating or generic AI labels. Keep source inspection optional. A card-level “补充一句” action may focus the existing Session composer with an explicit item reference; it must not silently save or broaden authority.
- [ ] **Step 4: Run component, whole-conversation, accessibility and type checks.** Confirm long text, keyboard order, narrow viewport and reduced motion on the rendered surface.
- [ ] **Step 5: Commit the card UI.**

### Task 5: Contact-only decision and Session card

**Files:**
- Modify: `packages/contracts/src/memorySchemas.ts`, `packages/contracts/src/client.ts`
- Modify: `apps/backend/src/modules/memoryReviewCommit.ts`, `apps/backend/src/modules/memoryReviewRoutes.ts`, `apps/backend/src/modules/memoryReview.integration.test.ts`
- Modify: `apps/web/components/memory-review/use-memory-review.ts`, `apps/web/components/conversation/session-message-parts.tsx`
- Create: `apps/web/components/memory-review/contact-decision-card.tsx`, `apps/web/components/memory-review/contact-decision-card.test.tsx`

**Interfaces:**
- Produces: `decideContactOnly({ idempotencyKey, expectedProposalRevision, identityAuthority, displayLabel, identityClue?, relationshipContext })` through the protected review scope. It returns the exact contact receipt and remaining pending Memory count.
- Consumes: existing `resolveIdentityBinding`, same-transaction source/identity checks, scoped operation readback, and Task 1's internal sibling-preserving commit mode. An ambiguous match requires an explicit unselected comparison before creation.

- [ ] **Step 1: Write failing backend and component tests.** A contact-only decision creates one Person, preserves both Memory siblings, returns its real receipt, and replays the same operation after response loss. An ambiguous or stale identity is blocked; Edit/Pass affects only this card.
- [ ] **Step 2: Run the focused backend unit tests and contact-card test; confirm the new assertions fail.** Run the database integration file only with `CONTACT_AGENT_TEST_DATABASE_URL` set to an isolated synthetic database.
- [ ] **Step 3: Extend the protected item-decision service with a contact-only branch and render a direct Add contact/Edit/Not now card.** The card shows only the exact proposed fields and excerpt. It does not select or accept a Memory item, and a stale button cannot authorize a write.
- [ ] **Step 4: Run the focused tests, backend and Web typechecks.** Confirm the old contact-plus-Memory batch path still works.
- [ ] **Step 5: Commit the contact decision and card.**

### Task 6: Calendar-file handoff inside the Session

**Files:**
- Modify: `apps/web/components/calendar-draft-review.tsx`, `apps/web/components/conversation/session-message-parts.tsx`, `apps/web/components/conversation/queued-conversation-memory-review.test.ts`
- Create: `apps/web/components/conversation/session-calendar-draft-card.tsx`, `apps/web/components/conversation/session-calendar-draft-card.test.tsx`
- Reuse: `apps/web/app/api/meeting-drafts/[id]/route.ts`, `apps/web/lib/server/meetingDrafts.ts`, `apps/web/lib/meeting-draft-pending.ts`

**Interfaces:**
- Produces: `SessionCalendarDraftCard({ draftId, sessionVersion, binding })`. It reads the current authorized draft, shows title/local time/IANA zone/source, keeps editing in the card, and offers Download calendar draft/Edit/Not now.
- Consumes: existing revision-checked draft edit, export-readback and .ics generation. The browser or macOS download result is a file handoff, not an event-write receipt.

- [ ] **Step 1: Write failing Session and card tests.** A current draft renders inline with direct actions; edited title/time uses the existing operation key and preserves a conflict; revoked source or invalid DST time blocks export; a successful download says “已生成日历草稿，请在日历应用中确认导入” and never “已加入日历”.
- [ ] **Step 2: Run the focused Web tests and confirm the new assertions fail.**
- [ ] **Step 3: Extract reusable draft controls from `CalendarDraftReview` or embed them with an inline variant.** Fetch via the current account-bound route, re-read immediately before export, keep the card's unknown/conflict state visible, and let the calendar application own import confirmation.
- [ ] **Step 4: Run meeting-draft, Session, Web typecheck and lint checks.** Confirm the existing `/workspace/meetings?draft=` deep link remains valid as recovery, not the primary action.
- [ ] **Step 5: Commit the inline calendar handoff.**

### Task 7: End-to-end proof and review

**Files:**
- Modify: `docs/superpowers/specs/2026-09-28-session-native-agent-cards-design.md` only if implementation evidence forces a corrected claim
- Create: a dated evaluation record under `docs/evaluations/` with synthetic or expressly authorized data
- Test: Web browser, backend integration, and actual macOS WKWebView

- [ ] **Step 1: Run focused backend, Web, contract, and documentation checks.** Include old batch Memory flows, active queue/draft/attachment cases, unknown response, source revocation, stale revision, and account switch.
- [ ] **Step 2: Exercise the production entry path with two synthetic items.** Capture proposal creation, Session render, contact-only add with pending Memory siblings, one direct Memory accept, a passed item, a lost-response reconciliation, authoritative receipt/undo readback, and calendar-file export after fresh source read. Do not substitute a helper fixture for the actual dispatch and transition path.
- [ ] **Step 3: Review Web narrow and wide viewports and the macOS app.** Verify keyboard, screen reader labels, near-bottom following, source inspection, account switching, and the actual macOS download/permission boundary. Check that file generation is never displayed as imported-event success.
- [ ] **Step 4: Record evidence, known limits and follow-on slices.** Native iOS and external MCP Apps remain separate platform slices; do not call a downloaded .ics file an added event. Update the plan and spec if the observed behavior differs from the approved design.
- [ ] **Step 5: Run `pnpm docs:check`, inspect `REVIEW.md` criteria, and commit the evaluation record.**
