# GET-298: preserve an explicitly chosen Memory draft target

## Outcome and boundary

An ordinary `@` choice remains a directory/text reference. Its popover offers an explicit `Prepare a Memory draft for this person` action. That action chooses one existing Person for the current authored message, with a visible removable target. Send snapshots the exact text and target into the same immutable outbox/queue message. The host revalidates the Person under the authenticated account and may stage only a reviewable Memory proposal for that target and the current text source.

The choice does not verify real-world identity, bind the persistent Session, read private Memory, approve saved Memory, or authorize an external effect. Current image-excerpt verification remains unchanged. No ID is inserted into prose. Historical targets never grant scope to a later Run.

## Current evidence

A bounded isolated browser run selected one existing directory Person and sent a complete authored Memory request. Canonical readback preserved the text but had no target binding; a new contact-only proposal instead referenced an older image. The old full POST field set was not retained. Source inspection confirms the composer currently keeps mention IDs only in presentation state and admits only objective/images. Sanitized run evidence remains outside the repository in the task's video-review artifact directory.

Base: `234c24a3`, the latest fetched `origin/main` when this worktree was created. Other accepted UI work is being delivered independently. Preserve concurrent edits.

## Shared contract and ownership

- Wire: optional `memory_draft_target: { person_id: UUID }` on queue admission and queue entry readback.
- Targeted admission uses dedicated Web and backend `/conversation-queue/memory-draft` POST paths. An older Web or backend returns a refusal instead of stripping an unknown target field and accepting ordinary work. The optional target echo appears only on targeted receipts; missing/mismatched echoes and same-ID scope mismatches retain an unconfirmed original outbox intention with visible bounded feedback.
- Canonical original human turn: optional `memoryDraftTarget: { person_id: UUID }`, historical presentation only.
- Exactly one target per message. A targeted admission requires nonempty current authored text and no uploaded images; images remain in the composer until sent separately. The server validates existence/current account ownership; target changes cannot reuse message/idempotency identity.
- Targeted messages remain independent queued tasks and never steer the currently running task. Queued text edits retain the original target; changing target requires cancelling/removing that intention and sending a new message.
- Frontend owner: composer/reference UX, five locales, contract schemas/types, durable outbox/admission/retry, message target presentation, related tests, and this plan.
- Backend/Agent owner: `person_fix`; source validation, target-only staging scope, queue persistence/scrub/retry/steering, canonical readback, and backend/Agent tests. Do not convert this target into `humanIdentityBinding` or recall authority.
- Parent owner: integration, independent review, CI, all affected resident deployments, real-surface acceptance and Linear closure.

## Milestones

1. Complete: freeze the shared wire and implement the explicit, reversible frontend choice with five locales.
2. Complete: preserve target/text snapshots through durable writes, retries, reload and same-message receipt readback; clear cancelled/edited/account-changed choices without clearing later intent.
3. Active: finish host/database integration proofs and preserve both PR #470 inspection-reading intent and this draft-clear intent when combining branches. Independent feature review reported no remaining confirmed P0/P1/P2 findings.
4. Pending: clean committed-source resident deployment and isolated browser/AI acceptance, including the exact proposal target/current text, human save, destination reload, and no Person/Memory prefetch when opening the reference popover. Keep local checks, CI, merge, deployment and native/device evidence separate.

## Verification

The initial outbox regression failed 2 of 4 cases before implementation: malformed explicit targets were restored as ordinary messages, and image-only targets with no authored text were restored. The implementation passed the expanded 5-case suite, including exact reference-span edits and authored text beyond a bare reference.

The parent then passed 73 affected tests across six suites and 50 narrow tests across four suites. Coverage includes ordinary `@` without scope, exact same-name directory choice, visible cancellation, account-binding ABA, text-only refusal, original target/text recovery and retry, queued editing, missing target echo, and a same-ID unbound receipt followed by detail 404. That last case exposed and now prevents an incorrect resend: a known same-ID receipt remains evidence even when the later detail read fails.

The final frontend checks passed on the frozen source, with a single test worker and existing compiled dependencies:

- Two final component suites: 10 of 10 tests passed. These use the real composer and submit/outbox path with synthetic transport; they are host component checks, not real browser or model acceptance.
- `pnpm --filter @talent-signal/web exec tsc6 --noEmit`: passed.
- `pnpm --filter @talent-signal/web lint`: passed.
- `git diff --check`: passed.
- `pnpm docs:check`: documentation and wiki checks passed; the combined architecture gate is blocked by one backend-owned unfrozen migration-manifest entry. The parent must freeze the reviewed migration and rerun the gate before merge.

Final sanitized log (mode 0600): `/Users/cubxxw/.codex/visualizations/2026/10/28/01a18337-fc2e-79e0-8deb-d92f1f7eae3d/video-review/runtime/get298-frontend-final-check.log`.

Unsupported dedicated routes remain definitive retained rejections, distinct from network loss or a missing 202 target echo. Both paths keep the original target and never fall back to ordinary admission. A same-ID mismatched server message shows the original local target with an explicit delivery-check control. Committed layout effects and explicit editor/target events advance the draft-intent fence; speculative renders do not mutate it.

New Web historical reads opt into `x-conversation-memory-draft-target: 1`; older strict AgentSession readers receive their legacy DTO. This is display-only negotiation. Backend preservation of canonical targets across older readers/writers is owned and verified separately from the frontend checks.

The existing reference popover's explicit Person-profile link sets `prefetch={false}`. Installed Next code otherwise enables viewport/hover/touch prefetch, and the destination reads Person Memory. The narrow navigation-contract regression preserves explicit click-through; actual network verification remains pending.

## Remaining evidence boundaries

The parent owns database integration, CI, clean-source deployments, resource checks and isolated browser/model acceptance. No local component test establishes a saved Memory or a production outcome. No native or physical-device acceptance is claimed. This work does not weaken the image excerpt/source gate or widen historical image-read authority.
