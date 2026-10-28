# GET-298: preserve an explicitly chosen Memory draft target

## Outcome and boundary

An ordinary `@` choice remains a directory/text reference. Its popover offers an explicit `Prepare a Memory draft for this person` action. That action chooses one existing Person for the current authored message, with a visible removable target. Send snapshots the exact text and target into the same immutable outbox/queue message. The host revalidates the Person under the authenticated account and may stage only a reviewable Memory proposal for that target and the current text source.

The choice does not verify real-world identity, bind the persistent Session, read private Memory, approve saved Memory, or authorize an external effect. Current image-excerpt verification remains unchanged. No ID is inserted into prose. Historical targets never grant scope to a later Run.

## Current evidence

A bounded isolated browser run selected one existing directory Person and sent a complete authored Memory request. Canonical readback preserved the text but had no target binding; a new contact-only proposal instead referenced an older image. The old full POST field set was not retained. Source inspection of that baseline confirmed mention IDs stayed in presentation state while admission carried only objective/images. Sanitized run evidence remains outside the repository in the task's video-review artifact directory.

Base: `234c24a3`, the latest fetched `origin/main` when this worktree was created. The accepted UI stack through `680bb6cc` is now integrated by merge `747e7168`; preserve concurrent work.

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
3. Complete: host/database integration proofs and the main integration preserve both PR #470 inspection-reading intent and this draft-clear intent. Independent full-feature and merge reviews reported no remaining confirmed P0/P1/P2 findings.
4. Pending: clean committed-source resident deployment and isolated browser/AI acceptance, including the exact proposal target/current text, human save, destination reload, and no Person/Memory prefetch when opening the reference popover. Keep local checks, CI, merge, deployment and native/device evidence separate.

## Verification

The initial outbox regression failed 2 of 4 cases before implementation: malformed explicit targets were restored as ordinary messages, and image-only targets with no authored text were restored. The implementation passed the expanded 5-case suite, including exact reference-span edits and authored text beyond a bare reference.

The parent then passed 73 affected tests across six suites and 50 narrow tests across four suites. Coverage includes ordinary `@` without scope, exact same-name directory choice, visible cancellation, account-binding ABA, text-only refusal, original target/text recovery and retry, queued editing, missing target echo, and a same-ID unbound receipt followed by detail 404. That last case exposed and now prevents an incorrect resend: a known same-ID receipt remains evidence even when the later detail read fails.

The final frontend checks passed on the frozen source, with a single test worker and existing compiled dependencies:

- Two final component suites: 10 of 10 tests passed. These use the real composer and submit/outbox path with synthetic transport; they are host component checks, not real browser or model acceptance.
- `pnpm --filter @talent-signal/web exec tsc6 --noEmit`: passed.
- `pnpm --filter @talent-signal/web lint`: passed.
- `git diff --check`: passed.
- The initial `pnpm docs:check` reached the intended unfrozen-migration gate. After independent review and real PostgreSQL checks, the parent verified the previous 114 names/order/SQL were unchanged and froze the appended migration. All documentation, wiki, architecture and diagram checks then passed at 115 migrations.

Final sanitized log (mode 0600): `/Users/cubxxw/.codex/visualizations/2026/10/28/01a18337-fc2e-79e0-8deb-d92f1f7eae3d/video-review/runtime/get298-frontend-final-check.log`.

Unsupported dedicated routes remain definitive retained rejections, distinct from network loss or a missing 202 target echo. Both paths keep the original target and never fall back to ordinary admission. A same-ID mismatched server message shows the original local target with an explicit delivery-check control. Committed layout effects and explicit editor/target events advance the draft-intent fence; speculative renders do not mutate it.

New Web historical reads opt into `x-conversation-memory-draft-target: 1`; older strict AgentSession readers receive their legacy DTO. This is display-only negotiation. Backend preservation of canonical targets across older readers/writers is owned and verified separately from the frontend checks.

The existing reference popover's explicit Person-profile link sets `prefetch={false}`. Installed Next code otherwise enables viewport/hover/touch prefetch, and the destination reads Person Memory. The narrow navigation-contract regression preserves explicit click-through; actual network verification remains pending.

The isolated PostgreSQL suite passed all 15 cases through the real admission,
claim/reclaim, producer, completion, review and source-redaction path with a
scripted provider. Direct producer staging before canonical source persistence
remains unreviewable; the completed Runner case establishes the usable review.
Earlier cleanup and legacy-scrub fixture failures are retained separately.
Latest source/legacy-reader checks passed 36 cases, backend impact checks passed
106 cases and backend typecheck passed. Thirteen migration-boundary tests and
the complete documentation gate passed without changing released SQL.

After integrating main, five combined image/inspection/target suites passed all
44 cases. Full Web typecheck, lint and documentation gates passed. The merge
review separately checked both Send-intent fences and a value-preserving
three-way merge of all five locale catalogs. CI now includes the real target
PostgreSQL suite in its own disposable database; current PR CI remains required.

## Deployment and rollback boundary

Deploy the two affected Node API residents before publishing the new Web entry,
preserving their independent databases, configuration and shared IPC volumes.
The database fence prevents an old worker from claiming or reclaiming a targeted
entry as ordinary work, and legacy source scrubbing clears the target. Quiesce
the new entry and drain or withdraw targeted pending work with the new code
before an old-backend rollback. A real old backend can still omit the historical
display marker on Session writes; old-client/new-backend preservation does not
prove that rollback case. Retain that limitation, recovery evidence and current
data; do not roll the database backward.

## Remaining evidence boundaries

The parent owns database integration, CI, clean-source deployments, resource checks and isolated browser/model acceptance. No local component test establishes a saved Memory or a production outcome. No native or physical-device acceptance is claimed. This work does not weaken the image excerpt/source gate or widen historical image-read authority.

### Import experiment fixture compatibility (2026-10-29)

The source-bound cold ARM64 OCI build for d5e3e6c2 passed. Its optional capped import job stopped before starting the nested engine: Python 3.12 adds an empty AST `type_params` field, changing the immutable log-gate fingerprint. Normalize only that empty field in the fixture, explicitly reject nonempty generic parameters, and preserve the original fingerprint and production gate. All 80 synthetic deployment fixtures passed on Python 3.12.14; independent review found no remaining issue. A new exact-source CI/image experiment is required; the earlier failure is not an import or capacity result.

### Final main integration and measured CI recovery (2026-10-29)

Main PR #473 adds the independently reviewed Memory disclosure density change.
Its component/CSS/tests/plan merge is separate from the Memory-target admission
and does not alter that authority boundary. Main `055c19c0` is integrated before
the next GET-298 head pipeline.

CI run `40751023321` attempt 1 exceeded its 60-minute limit after setup/build
(~13m45), unit tests (~2m), and 19 of 23 isolated UI journeys (~43m25).
The single same-source rerun then failed in the first UI case at `app.launch()`,
with exactly one failed test, no pass or skip, and the recorded
`SBMainWorkspace` Busy / application preflight refusal. It did not reach a
product assertion. No third unchanged rerun is used.

Recognize only that full launch-error signature bound to the selected UI method
and explicit 1/0/1/0 counts. Reuse the existing one-recovery limit and identical
journey arguments. Preserve the first native result in a separately uploaded
`infra-failures` artifact even if recovery succeeds; a second failure still
fails the job. Unit failures, ordinary assertions, crashes, missing apps,
different methods/apps/services, mixed results, skips and missing counts remain
failures. Keep all 23 journeys and every assertion, with a measured 90-minute
job budget. Ten host orchestration tests pass using fake Xcode/platform tools;
no local Simulator or build is started. The earlier interrupted-result upload
race is still an unverified limitation, not a claimed fix.

The machine's disk-pressure pause remains active. Heavy local builds and
service activation wait for an evidence-backed resource recovery; cloud CI
and lightweight source/orchestration checks may continue. The prepared
`acc37eea` OCI/Web artifacts belong only to that old head and must not be
relabeled as this final integration. Final source-bound build, current required
gates, clean committed deployments and real-surface acceptance remain pending.
