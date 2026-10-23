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
4. Primary proof at 27c95988: build, 110 focused tests and seven deterministic
   primary-device UI cases passed. Compact layout proof remains incomplete;
   its Simulator runner failed before entering a test body.
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

Native Memory, progress and integration source are implemented and independently
reviewed; all confirmed P0/P1 findings are closed. Build-for-testing attempt 6
and 109 focused native tests passed on native source at 82142db. Subsequent
commits through 81ccb05c changed documentation/CI selection only. The complete
docs:check passed again after merging main. AskView fits the unchanged 8820-line
architecture limit.

Primary-device UI attempt 1 ran all seven cases, but every case stopped before
the fixture mounted. The captured accessibility hierarchy showed the new-session
composer: its entry predicate bypassed the fixture's conversation branch. A
DEBUG-preview-only predicate correction passed build 7. UI attempt 2 reached
the actual fixture: one case passed and six failed. Direct screenshot and
accessibility-tree inspection found invisible dark-mode primary-button text,
undersized secondary/recovery targets, and child image identifiers/bounds
overridden by container/unclipped-image semantics. The synthetic fixture also
hit protected-write failure through a Keychain dependency in the unsigned local
test build. The fixture now uses a DEBUG-only in-memory operation adapter;
production persistence remains protected. Button labels and bounded media
surfaces are corrected. Build 8 passed; UI attempt 3 passed five of seven cases,
including both reading directions, original-image access, pending status,
AX5/dark mode and unavailable recovery. The remaining two assertions queried
receipt child text after successful actions. The receipt now has an explicit
accessibility container; existing assertions remain unchanged. Build 9 passed,
with 110 focused unit tests and all seven primary-device UI cases passing on
native source 27c95988. The same interaction assertions were retained. Compact
verification reused this build for the justified long-image/keyboard/AX5 layout
cases; CoreSimulator stalled at installation/runner launch and never entered a
test body. Main canceled only its verified driver PID 60557 with SIGINT under
renewed resource pressure. The guarded session ended and shut down its owned
device; no simulator data was erased. This is not a compact passing result.
CI also exposed
two obsolete policy-test assumptions (maximum ten cases and two old test classes);
the bounded quick 14/smoke 15 policy correction passed 18 policy tests and its
focused selector regression. Neither failure is waived.

Pi media task 20261022-220909-decb4775 stalled on one model response without
source changes, was cancelled, and its managed PIDs 93921/93926 were verified
absent. Artifacts and source remain recoverable. Media ownership transferred to
native_progress after cancellation; no concurrent writers remain in that slice.

Main resource/artifact record: ~/.codex/artifacts/ios-conversation-experience-20261022/.
Registered rebuildable output: /private/tmp/ai-test-ios-conversation-experience-20261022.kmczFu.
A pinned docs command auto-installed workspace dependencies; these are owned
rebuildable task outputs to remove only after formal evidence is preserved.
One isolated daily test run acea8a63-ec2d-4051-8414-a7c6aebba8fb was created via
capir under the verified test@cubxxw.com authorization. Its --open web browser
launch timed out; run status readback succeeded. Reuse request
ed268276-57c5-4eee-9e0f-37c0e117b732 until the run's expiry. Its four-hour lifetime
elapsed before a product upload occurred. Stop/expiry cleanup readback is still
required before provisioning another bounded acceptance run. Private credentials
remain in the private artifact/keyring only. During a backend transport failure,
CLI refresh became uncertain; do not replay that credential. The user approved
recovering exactly this staging grant on 2026-10-23. Standard logout confirmed
remote revocation of grant 95150c8b-306a-4291-b478-c2bc05e202da and exact local
removal. Normal browser re-login was submitted, but renewed API readiness
timeouts prevented completion; no new grant or replacement test run is claimed.
Live Memory behavior, direct VoiceOver/Chinese input checks,
device latency and installed TestFlight fidelity still require proof. The
primary native UI result uses synthetic data and does not prove these paths.
Draft PR #405 is open:
https://github.com/getyak/capir/pull/405. Latest-head required CI and real-provider
acceptance remain pending; no merge, deployment or release is claimed.

## Source review checkpoint

All source slices are frozen for native verification. Independent review closed
all confirmed P0/P1, including historical and canonical steering provenance,
scoped relationship Ask snake-case proposal decoding and purpose isolation,
protected exact intent replay, source revocation/expiry cleanup and incremental
contact/item decisions. Source review is not runtime or release proof.

The new-contact layout is identity-first: name/context/source and Add contact
precede a collapsed suggestion preview; pending Memory editors follow actual
contact confirmation. Editorial and compact directions share the same behavior.
Source inspection and suspension preserve edits while the same review store
survives. Protected submitted operations can recover after store recreation;
unsent name/context fields are not included in the server draft contract and
are not preserved after store destruction or app termination. That broader
draft-continuity behavior remains deferred, not an unmeasured completed feature.
Seven deterministic UI cases and one opt-in real-provider image/contact journey
are present. Build 6 and focused unit evidence are recorded above; the main agent
owns build 9 and its passing primary UI rerun. Documentation/architecture and
localization gates passed. Pending compact, provider and installed-build
evidence cannot be replaced by source review or synthetic primary results.

The complete source-based symptom, cross-platform and prioritized improvement
register is [the dated UX audit](../docs/research/ios-conversation-ux-audit-2026-10-22.md).
Its proposed local-feedback timing target is not a measured result. The main
agent inspected the same native content and selected editorial presentation:
it keeps the identity fields and primary decision prominent while fitting the
secondary actions on one row; compact insets added a vertical action stack.
Eight selected synthetic screenshots and the inspected selection rationale are retained in
the private task artifact. No installed-build quality score or real-provider
success is inferred from synthetic tests.

Historical CI at c1b10dab passed repository policy, security, Web, backend,
CLI and control-plane checks; native smoke reproduced the receipt-text query
failure. At fixed source 27c95988, all applicable checks except the still-running
native smoke have passed. Final consistency review also found two Host failure
actions with the old outer-frame touch-target pattern. Their labels now own the
44pt frame and content shape, matching the card treatment already exercised.
This narrow native delta requires new-head CI; the earlier local results remain
bound to 27c95988. Renewed host pressure and the prior installation failure mean
no additional local Simulator run is claimed. Only the latest applicable job
result can close the CI gate.
The audit is classified under docs/research; repository hygiene remains intact.
The existing backend recovered without intervention: scoped health/readiness
and HTTP revision were verified on 2026-10-23. Prior transport-failure cause is
unknown; health does not establish model completion or the native save path.

## Latest verification and security follow-through

At ad037092, CI completed successfully: 754 unit tests with one skipped and no
failures, plus all 14 quick UI cases. The compact retry reused build 9 at
27c95988 and passed its two selected long-image/editing and AX5-dark cases;
the first infrastructure failure remains recorded. These results do not prove
provider, physical-device or TestFlight behavior.

The independent Security workflow then reported GHSA-rxp7-6hxx-x8q5 in the
existing ip-address 10.7.1 override. The narrow patch moves that package to
10.7.4 without any unrelated lockfile changes. Production audit and independent
source/integrity review passed. Latest-head checks remain required after this
commit. Because the package is in the existing backend/Agent runtime closure,
the native-only deployment exemption no longer applies: prepare clean committed
canonical API/research, browser-executor and Web releases, verify no active
work before switching, and require the existing deployment/readback gates.
Preserve unrelated legacy stacks and the shared database. Recheck host resource
pressure before serial builds; no global VM restart or unrelated process kill.
