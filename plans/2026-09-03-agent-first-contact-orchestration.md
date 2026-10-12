# Agent-first contact orchestration

## Outcome

Replace iOS client-side pre-routing with a bounded conversation Agent that can
choose direct reply or use an account-scoped contact Tool. Contact create and
update remain reviewable proposals and require explicit recruiter confirmation.
The historical product/technical brief is archived at
[`plans/archive/2026-09-03-agent-first-contact-orchestration.md`](archive/2026-09-03-agent-first-contact-orchestration.md).
It records the delivered slice and is not current product authority.

## Boundary

In scope: unscoped iOS Send, contact search/read tool calls, contact-change
proposal events, existing governed confirmation, idempotency, visible tool
receipts, ambiguity/retry/accessibility states.

Out of scope: autonomous writes, contact merging, external messaging/calendar
effects, broad account enumeration, candidate scoring, and redesign of scoped
Pursuit analysis.

## Current evidence

- iOS currently routes unscoped relationship turns through deterministic
  keyword and recency policies before the remote model.
- `/v1/chat/unscoped-tasks` intentionally supplies no tools or context and can
  return only one answer/clarification block.
- `/v1/people/search` already performs authenticated name/identity lookup.
- conversation contact intake already has proposal, explicit target selection,
  idempotent resource capture, canonical readback, and receipt states.
- the provider-neutral Agent catalog has bounded read and proposal patterns but
  no conversation/contact tool family.
- existing iOS build configuration changes are user-owned and must be preserved.

## Chosen approach

1. Add the typed `contact_workspace` capability to the Agent core, with
   operation-specific validation and no apply operation.
2. Add a workspace-conversation provider profile whose terminal outcomes can be
   reply, clarification, or a staged contact proposal; do not force every Run
   to produce a proposal.
3. Evolve the unscoped Chat endpoint into the Agent entry while preserving
   authenticated account scope, idempotency, metadata-only audit, and fallback.
4. Return resolved-context and contact-proposal events in the response contract.
5. Make iOS Send call this entry directly, project events into inline context,
   clarification, and the existing contact proposal/confirmation UI.
6. Remove misleading pre-send Agent-selection copy while retaining manual scope
   choice as recovery.

## Milestones

1. **Completed — Freeze contract and knowledge ownership.** Added the brief
   now archived at `plans/archive/2026-09-03-agent-first-contact-orchestration.md`,
   this resumable plan, ADR 0010, and the canonical product, Agent, and
   integration deltas.
2. **Completed — Implement Agent and backend vertical slice.** Added the Tool
   schema, governed gateway, provider loop, response contract, idempotency, and
   metadata-only audit.
3. **Completed — Implement iOS projection.** Send is Agent-first; resolved
   context, clarification, and proposal events project into existing governed
   UI and confirmation paths.
4. **Completed — Verify failure and safety behavior.** Agent and backend tests
   cover direct reply, exact/ambiguous/no match, grounded create/update,
   provider and Tool limits, response contracts, retry, and atomic proposal
   recovery.
5. **Completed — Verify the real surface and route durable learning.** The
   current Debug build passed 84 iOS core tests and was launched on iPhone 17
   Pro Simulator; proposal UI was inspected at an accessibility text size,
   canonical docs and ADR were updated, and `pnpm docs:check` passed.

## Validation record

- Agent: 8 files, 50 tests passed.
- Backend: 34 files, 247 tests passed; focused workspace Agent: 11 passed.
- iOS: `RelationshipArchiveTests`, 84 passed on iPhone 17 Pro Simulator.
- UI: seven focused Agent-first cases passed across the initial run and the
  targeted rerun, including no required picker, ordinary contact mention,
  proposal recovery, and Chinese dark AX5. The current Debug build was
  installed, launched, and visually inspected.
- Docs and architecture checks passed; `git diff --check` passed.

## Re-plan triggers

- If the provider cannot reliably emit validated tool calls and a terminal
  response within the current timeout, ship the same tool contract behind a
  deterministic fallback and keep the old remote answer path as recovery.
- If contact read cannot compile a minimal governed context without exposing
  unrelated evidence, ship search + clarification + proposals first and keep
  relationship answers scoped through the existing Chat endpoint.
- If the existing contact executor cannot represent updates with revision
  preconditions, keep update proposal cards read-only until that executor is
  extended; never weaken the confirmation boundary.
