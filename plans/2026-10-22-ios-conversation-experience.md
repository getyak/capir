# iOS conversation completion and reading experience

## Outcome

Make an intentional screenshot handoff feel immediate, legible and complete:
send once, understand the observed processing state, inspect a real editable
contact/Memory proposal, confirm only the intended change, and reopen the same
result after interruption. Ordinary visual questions keep their actual answer.

The primary user question is: "Did you receive this, what did you understand,
and what can I do with the result?" The target is a calm native reading surface
with one meaningful next decision, not a collection of progress cards.

## Scope and evidence

- Base: remote main c52bcad4, including PRs 401–403. Main checkout has unrelated
  untracked evidence and is preserved. All writes use this isolated worktree.
- User screenshots show a tiny long-image preview, an empty-looking bubble,
  a promised contact review without a visible card, saved-response copy and an
  ambiguous ring-like composer control. Source identifies the idle ring as a
  static voice action, not evidence of a running network request.
- The backend persists `response.memoryProposal`; Web renders its authoritative
  proposal ID/revision through MemoryReviewCard. The native response model has
  no corresponding field. Existing native intake is a different legacy path.
- Native image observation reads queue and Session sequentially, then waits
  two seconds. It cannot expose stages that its decoder does not retain.
- ConversationImageTile uses 230x180 with fit; pure image turns still mount an
  empty text bubble. Existing zoomable-original support should be preserved.
- Source review is not proof of installed-build behavior or measured latency.

In scope: native proposal contract/readback and review, image presentation,
honest message-local processing and recovery, focused navigation/copy,
deterministic tests and primary/compact device evidence. Backend/Web changes
only if an existing native contract cannot complete the same safe operation.
No screenshot/person-data expansion, automatic identity confirmation, automatic
external effects, new product taxonomy, or unrelated navigation rewrite.

## Design decisions and standards

1. Message receipt is visible immediately. Local presentation is explicitly
   sending until admission; no animation establishes server success.
2. Status belongs under its message. Use one short observed state, expanded
   details only when useful. Never invent percentages, stages or elapsed ETA.
3. A real decision object owns its space. Contact review shows a readable name,
   pending status, editable values, source access and one primary action.
   Loading/failure cannot masquerade as a prepared card or a completed save.
4. Single images respect their aspect ratio within bounded phone geometry.
   Long screenshots use a recognizable preview and explicit full-image access;
   no large empty landscape mat. Multiple images retain order and count.
5. Identity uses authorized photos or readable stable fallbacks. Do not crop
   private screenshot avatars into permanent contact records.
6. Prose has body typography; routine headings and feedback remain secondary.
   Remove empty messages and redundant success/AI labels before reducing size.
7. Stop, unknown, failed, stale, rejected and unavailable have distinct safe
   next steps. Retries reconcile the same message/operation before resending.
8. Reopening a proposal always reauthorizes current scope and revision. A saved
   reference is not action authority. Shared/forked exports strip live review
   authority; old history remains readable and backward compatible.
9. VoiceOver, 44pt controls, Dynamic Type, dark mode and reduced motion apply
   to the actual decision path, not only static screenshots.

Two native reading directions will be compared with identical synthetic content:
compact conversation-aligned review versus a wider editorial review. Select on
five-second clarity, source readability, next-action prominence and small-screen
fit. Do not pick on ornamental polish or an aggregate score alone.

## Ownership and execution

The main agent owns architecture, user-facing design, acceptance, integration
judgment, builds, Simulator sessions, release decisions and final review.
Workers do not build, start Simulators, deploy, message externally or commit.
They preserve all other edits and work only inside their assigned files.

- Memory worker: new native Memory review domain/client/store/card and focused
  tests; response and persistence projection in PursuitWorkspaceClient,
  RelationshipArchiveModels and AgentSessionContextPolicy. Exposes a small
  session/proposal-bound card API. Does not edit RelationshipAskView.
- Media worker: ConversationImageConversation, RelationshipAskMedia,
  RelationshipAskTurnSupport and focused layout tests. No transport/store edits.
- Progress worker: ConversationImageClient, new progress presentation/policy
  files and transport tests. Does not edit archive models or RelationshipAskView.
- Integration worker: RelationshipAskView and focused UI acceptance only;
  coordinates the three public interfaces and avoids parallel edits elsewhere.
- Independent reviewer: read-only review of current source and proof, with
  all confirmed P0/P1 resolved and rechecked before delivery.

User explicitly authorized 4–5 workers and main-owned builds/Simulator despite
the existing global operations pause on 2026-10-22. Preserve the global marker;
recheck resources and the single iOS session before heavyweight operations.

## Milestones

1. Complete: freeze native contracts, UX states and worker ownership.
2. Complete: implement the non-overlapping slices and integrate one complete conversation.
3. Source review complete: independent reviewer rechecked all confirmed P0/P1 fixes.
4. Device proof at 27c95988: build, 110 focused tests, seven deterministic
   primary-device UI cases and two compact layout/AX5 cases passed. The earlier
   compact installation failure is retained separately, not counted as a pass.
5. Current-head CI, applicable resident deployment if runtime changes, native
   release/acceptance evidence and precise resource closeout.

## Verification

- Decode actual canonical history including memoryProposal; preserve proposal
  reference through current classified/persisted projections, and strip it
  from copied/shared read-only authority.
- Open/confirm through existing authenticated Memory routes, exact proposal,
  revision, review credential and operation identity. Read back destination.
- Failure, response loss, stale revision, account/session change and duplicate
  press must not report false success or duplicate writes.
- Image-only turns produce no empty bubble. Long/landscape/square and multi
  images render legibly; original zoom, close, failed read and retry work.
- Pending states reflect real queue observations. Unknown transport results
  do not become failed admissions or authorize a new send.
- Same synthetic input across native and Web establishes contract parity;
  no raw private screenshot or credential is committed or logged.
- Use dev-storage-guard artifacts and dev-ios-session. Keep formal sanitized
  evidence before removing rebuildable task artifacts. Native and live-provider
  proof are reported separately.
- Run relevant Swift tests and UI smoke, localization, docs:check and gates
  applicable to changed source. Syntax parsing alone is insufficient.

## Current status and unknowns

Native source is frozen at cf1dc3c9f after independent re-review of both final
progress corrections. Main-owned build-for-testing 12 passed and matches the
three-file source freeze in the private task evidence. Current-head CI remains
required; source/build review is not a substitute for its result or live proof.
The latest status and exact-head checks are recorded under the private task
artifact listed below rather than copied into a second chronological log.

The identity-first editorial direction was selected against the compact option
using identical native synthetic content. Name, context, source and Add contact
precede a collapsed suggestion preview. Contact confirmation and each Memory
item remain separate decisions. Correcting identity requires refreshed review
and another confirmation. Protected submitted operations recover with their
same identity. Unsent name/context survives source-viewer return only while the
same Store survives; Store destruction/app termination continuity is deferred.
Authorized photos or readable initials identify people; private screenshot
avatars are not automatically imported as permanent contact photos.

## Verification evidence and boundaries

- At 27c95988, build 9, 110 focused tests, seven primary UI cases and two compact
  layout/AX5 cases passed. Earlier infrastructure failures and their cancellation
  are retained separately. Main inspected the actual synthetic native surfaces.
- At 21dab6ec, all applicable CI/Security/package checks passed, including 754
  unit tests (one skipped, no failures) and 14 quick UI cases. Build 10 passed.
  These remain historical source-bound results, not the latest-head result.
- The final silent-feed correction adds seven unit cases and a real natural-
  expiry UI scenario. The component updates even without a new Store/network
  event, including queued/running observations with no startedAt. Overdue
  observations stop animating and offer the same-message status check.
- The final canonical-readback correction adds a production Tracker transition
  regression. A queue-completed row stays readback only while checking; after
  an unsuccessful check it becomes recoverable unknown. Only the canonical
  same-message reply removes pending state. Queue completion is not that reply.
- Quick/smoke now include 15/16 explicit journeys and retain the natural-expiry
  scenario. Both strict policy budgets and discovery/deduplication guards were
  updated; 34 targeted script/policy checks and docs:check passed. Their first
  missing-budget failure is preserved rather than waived.
- Build 11 passed the first progress fix; build 12 passed both. The local expiry
  attempt was cancelled before any test-case body or live upload when Simulator
  cold boot raised swap to 19GiB and lowered free disk to 27GiB. Its owned device
  was shut down and read back as Shutdown. This interrupted attempt is no pass.

The source-based cross-platform symptom map remains in the
[dated audit](../docs/research/ios-conversation-ux-audit-2026-10-22.md).
The private Chinese report now contains 31 prioritized recommendations. Its
local-feedback timing target is proposed, not a measured P95. Direct VoiceOver,
Chinese IME, physical-device/TestFlight, global avatars, next-message drafting,
reading-position retention and broader unsent-draft continuity remain distinct
follow-ups. The macOS primary workspace reuses Web; the screenshot's brand ring
is an idle voice action, not proof of an active network request.

## Runtime and live acceptance

The existing ip-address advisory was patched narrowly to 10.7.4 with matching
lockfile integrity and strict dependency expectations. There is no evidence
that this advisory caused the observed runtime timeouts.

A separate clean runtime source, 1dbb74dcc6358d17277fa799b1d42824a3d50732,
preserves the deployed unmerged Web/backend ancestry. It passed applicable
CI/Security, 146 focused Web checks, lint/typecheck/build and Linux/macOS SDK
execution. Main activated API, research sidecar, Web and browser executor through
the supported gates. Live revision, immutable image identity and installed
dependency readback passed; synthetic provider/ASR deployment probes passed.
Default Docker context, Tailscale exposure and unrelated resident stacks were
preserved. Do not redeploy the native branch over this different live ancestry.

The user-approved uncertain staging grant was revoked and same-scope normal
login recovered. The earlier expired test run was verified deleted. A fresh
isolated daily run was provisioned under the approved test account. Main saw its
real Web workspace and complete People directory. A canonical People/Memory
baseline was captured before any native upload; that helper revoked only its
own temporary session and verified HTTP401. Two earlier password-login timeouts
remain recorded with unknown cause. Current scoped metadata did not prove a
lock or sustained CPU saturation; a later login took238ms. No raw personal
screenshot was uploaded.

Real-provider native image -> review -> one contact confirmation -> destination
and relaunch remains incomplete. Both owned isolated runs were canonically
verified deleted and their generated credentials removed. Continuation requires
a fresh isolated run, a new canonical baseline and a fresh loopback inspection
challenge; the closed run journal is historical evidence, not a usable login.
Never replay an uncertain one-use credential or silently resend an image. On
handoff stop the isolated run and verify deleted/cleanup-error state; retain
sanitized evidence and remove only its own generated credentials after cleanup.

## Resource and delivery checkpoint

The global operations pause is preserved under the user's explicit task
exception. Only main builds/runs Simulator. The user approved a temporary
reduction of the existing browser VM from 4GiB to 2GiB, followed by restoration.
Both settings passed a real public-page browser probe. The original 4GiB
configuration, its hash, Docker context and resident container identities were
verified restored after the attempt. Two superseded Web releases outside the
retained five had four unreferenced generated directories removed, accounting
for 2.37GiB of directory allocation; exclusive physical recovery is unknown.
Primary cold boot completed, but free disk fell to 26.14GiB. Main interrupted
the guarded session before any test case, new isolated run, upload or contact
save, then verified the owned device was Shutdown. Source, active runtimes,
databases, rollback versions and unique evidence remain protected. Recheck
actual headroom and ownership before any further Simulator attempt.

On 2026-10-23 the user explicitly authorized merging
https://github.com/getyak/capir/pull/405, superseding the earlier draft-only
delivery choice. Merge must satisfy the repository's strict up-to-date
CI/Security rules and independent review without bypass. The merge preparation
integrated main's permanent chat-media deletion fix; native frozen source was
unchanged and the integration review found no new P0/P1. Read actual merge
state and current-head check receipts from GitHub and the private journal.
Merge authorization does not establish the outstanding native provider journey,
production Keychain write, physical-device acceptance or TestFlight delivery.

Private formal task evidence and current journal:
`~/.codex/artifacts/ios-conversation-experience-20261022/`.
Registered rebuildable output:
`/private/tmp/ai-test-ios-conversation-experience-20261022.kmczFu`.
Preserve build12 products, source and unique evidence while acceptance is open.
Only precisely owned cleanup is authorized; do not infer task completion from
age or ready_for_review. Pi media task20261022-220909-decb4775 was cancelled
without source edits; its verified PIDs93921/93926 were stopped and ownership
transferred. All later process/resource actions are recorded in resources.json.
