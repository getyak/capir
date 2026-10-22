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
  unexplained composer spinner.
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

1. Active: freeze native contracts, UX states and worker ownership.
2. Implement the non-overlapping slices and integrate one complete conversation.
3. Main review plus independent safety/correctness review; fix confirmed P0/P1.
4. Build once, focused tests and actual primary-device interaction; compact
   only for long-image, keyboard and Dynamic Type layout.
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

Planning and current-source diagnosis complete. Implementation not yet started.
No test, review, deployment or release is claimed. Live Memory route behavior,
native review presentation, device latency and installed TestFlight fidelity
still require proof. No task-owned long-running resources have started.
