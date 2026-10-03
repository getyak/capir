# Complete Lab implementation

## Objective

Implement the full Lab product logic requested after the first delivery. The
first slice is existing evidence, not the definition of completion. Preserve
the complete design direction in `_index/inbox/2026-09-04-lab-v2-product-design.md`
and keep remaining work explicit until verified.

Status: source and Simulator implementation complete. The 2026-09-05
[complete delivery record](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-complete/README.md)
consolidates the final gates. Image/Agent batch parity and automatic capture,
audio, and presentation diagnostic stages are implemented and verified. Online
assignment remains a separate product extension because the implemented
current-session observation has no rollout or causal authority.

## Requirements and proof map

| Requirement | Authoritative completion evidence | Current state |
| --- | --- | --- |
| Runtime environment/version selection | Approved deployment directory; unauthenticated TLS/identity/contract preflight; atomic root/client change; target sign-in/readback; rollback; old-response isolation tests on two endpoints | Implemented; native synthetic endpoints, signed Keychain and isolated authentication tests passed |
| Environment/account/workspace isolation | Scoped secure credentials, cached state, drafts and operation recovery; no token redirects; return to original operation IDs; recording/upload blocker UI | Implemented and tested; live deployment rollout remains a release step |
| Task-specific model/prompt/session configuration | Admitted capability catalog; requested/resolved/actual versions; session-only override and expiry/rollback; real product task uses selection | Implemented; real native product adoption and rollback verified |
| Complete real experiment lifecycle | Immutable definitions and input, suites/repeats, budgets, cancellation/partial/unknown recovery, per-case output and hard checks; persisted verdict/error categories | Relationship text, image understanding and Workspace Agent use the durable batch, review, regression and CI-consumption lifecycle; product adapter and native proofs recorded |
| Failure-to-regression loop | Saved typed failure case, rerun, independent held-out cases, a real CI consumption record; separate saved/enforced status | Saved immutable cases, native reruns/deletion and shared evaluation consumption verified; CI fixture lifecycle configured, hosted case-specific verification remains incomplete |
| Device appearance and page states | Actual compiled components; temporary/session overrides, language/type/density/motion/contrast presets, loading/empty/error/stale states, restore paths | Compiled page catalog, presets and temporary app overrides implemented; native appearance journeys verified |
| Guided diagnostics | Task session start/reproduce/stop, monotonic timeline, sanitized request metrics, frame/memory/thermal sampling, bounded retention, reviewed export, named synthetic fault presets and expiry | Guided capture, typed request phases, sampled device metrics, checkpoints, reviewed export and seven isolated fault presets implemented; automatic client/server, capture, audio and truthful display-callback stages verified; physical-device MetricKit delivery remains a release check |
| Reset and clean testing | Scoped cache and diagnostics reset, display defaults, workspace refresh, local/remote sign-out receipt, independent onboarding/Demo reset, empty test workspace, durable resumable composite reset | Implemented and tested for source/Simulator delivery, including protected native entry, relaunch, return and verified server cleanup; physical-device and deployed-storage proof remain release checks |
| Controlled internal trial | Explicit test-session scope, rollback/expiry, observation window/outcome records; online assignment and stop controls kept distinct from offline comparison, no causal claim without samples | Implemented for current authenticated-session opt-in observation; online assignment remains deliberately unavailable |
| Controlled feature overrides | Closed revisioned catalog; default/override/effective values; session-only expiry and rollback; immutable product adoption receipt | Implemented for relationship evidence presentation; persisted product and native UI proof recorded |
| Native and Web usability | Native end-to-end tasks; Web batch comparison/regression review; truthful unavailable capabilities; offline/login entry; accessibility and failure coverage | Native delivery and authenticated Web batch/regression review are implemented and verified at desktop and 390-pixel mobile widths |
| Delivery and knowledge | Source, migration/configuration guidance, current ADR/docs, build/tests/runtime evidence; no claim of TestFlight or production release without actual release proof | Complete source/Simulator audit and final gates retained; physical-device and published-release checks remain separate |

## Execution sequence

1. Complete for source/Simulator delivery: runtime manifest, trusted target
   registry, secure session partitioning, generation-safe switch, native selector,
   recovery ownership, and deletion-aware legacy migration. Evidence:
   [runtime evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-runtime/README.md).
   Native endpoints are synthetic fixtures; this is not live Apple sign-in or
   a production/TestFlight rollout.
2. Complete for source/Simulator delivery: task configuration catalog and scoped
   real-product model/prompt trial. Evidence: [session trials](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-task-trials/README.md).
3. Complete for source/Simulator delivery: text, image and Workspace Agent use
   the same durable batch, review, regression and CI-consumption contracts.
   Hosted CI remains a release verification step.
4. Complete for source/Simulator scope: appearance, guided capture/export,
   isolated faults, automatic client/server/capture/audio/presentation stages
   and MetricKit history. Real MetricKit delivery and physical microphone/GPU
   behavior remain explicit release checks; previews do not fulfill them.
5. Complete for source/Simulator delivery: local reset, session ending,
   independent Demo reset, server-created empty accounts, and protected native
   entry/relaunch/return/deletion. Evidence: [native test workspace](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-workspace-native/README.md).
6. Complete for source/Simulator delivery: bounded current-session observation
   over normal product tasks, including a frozen plan, unique samples,
   descriptive summaries, guardrail stop, expiry/manual rollback and explicit
   non-causal language. Evidence: [controlled observation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-controlled-observation/README.md).
7. Complete: authenticated Web batch comparison, hard-failure review,
   cancellation, immutable regression save and rerun over the durable backend.
   Evidence: [Web batch review](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-web-batch/README.md).
8. Complete: implement the first controlled, reversible feature override with a
   closed catalog, exact session scope, expiry/rollback, configuration-drift
   stop, lost-response recovery, and frozen relationship-answer adoption receipt.
   Evidence: [feature overrides](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-feature-overrides/README.md).
9. Complete: image/Agent batch parity and diagnostic stage coverage are
   implemented and verified. Keep online assignment unavailable until a
   separate experiment authority and rollout design are authorized.

## Boundaries

User authorization covers implementing the complete logic and bounded synthetic
verification. It does not make real candidate material a Lab dataset, authorize
messages or contact/calendar writes, or turn a model review into execution
authority. Provider capability or external deployment gaps must remain visible.
No arbitrary credential-bearing endpoint, global production model override,
fake Instruments readings, fabricated online benefit, or cosmetic switching.

One owner works in the current tree, preserving prior Lab changes and unrelated
`.pnpm-store/` and MX01 evaluation artifacts. Temporary proof services are owned
and disposable. No subagents are used.

## Current handoff — 2026-09-05

The requested Lab source and Simulator implementation is complete. Controlled
current-session observation is complete; online assignment remains unavailable
and cannot be inferred from this work.

| Milestone | Authoritative evidence |
| --- | --- |
| First useful Lab and real single-case execution, migration 040 | [First delivery](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-v2/README.md) |
| Approved runtime switching and scoped recovery | [Runtime](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-runtime/README.md) |
| Task model/prompt selection and real native adoption/rollback, 041 | [Session trials](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-task-trials/README.md) |
| Durable text suites, budgets, leases and unknown outcomes, 042 | [Batches](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-batches/README.md) |
| Immutable regression cases, rerun, deletion and shared consumption, 043 | [Regressions](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-regressions/README.md) |
| Case-specific read-only CI provenance, 044 | [CI](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-ci/README.md) |
| Compiled pages, appearance presets and temporary overrides | [Appearance](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-appearance/README.md) |
| Guided task diagnostics and reviewed Files export | [Diagnostics](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-diagnostics/README.md) |
| Seven isolated faults and current evidence-authority correction | [Faults](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-faults/README.md) |
| Automatic client/server stages and bounded archive capacity | [Stages](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-stages/README.md) |
| Explicit MetricKit subscription, history and deletion watermark | [MetricKit](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-metrickit/README.md) |
| Reviewed local reset and protected exact-session ending | [Reset](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-reset/README.md) |
| Scoped synthetic Demo reset, retained ownership and same-ID recovery | [Demo reset](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-demo-reset/README.md) |
| Server-created empty workspace, delegated session and verified cleanup | [Test workspace backend](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-workspaces/README.md) |
| Protected native entry, process recovery, original return and deletion receipt | [Native test workspace](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-workspace-native/README.md) |
| Frozen current-session observation, unique sampling, guardrail stop and default rollback | [Controlled observation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-controlled-observation/README.md) |
| Requirement-by-requirement source, UI and release-boundary audit | [Final audit](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-final-audit/README.md) |
| Authenticated Web batch comparison, regression review and mobile layout | [Web batch review](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-web-batch/README.md) |
| Closed, session-scoped feature override and frozen product adoption receipt, 046 | [Feature overrides](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-feature-overrides/README.md) |
| Durable image and Workspace Agent batches, regressions and CI consumption | [Batch task parity](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-batch-task-parity/README.md) |
| Automatic image, capture, audio and truthful presentation diagnostics | [Automatic stages](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-automatic-stages/README.md) |
| Consolidated source, Simulator and Release-build verification | [Complete delivery](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-complete/README.md) |

The reset milestone passed 35 distinct signed checks and three native journeys.
The final 198-file snapshot in `/tmp/talent-signal-lab-v2/reset-source-final`
passed Release, matched all current iOS source hashes and compiled the public
device-Lab flag as NO. Localization passed with 2,065 keys and documentation
with 422 Markdown files. Final manifests, logs and bundles are under
`/tmp/talent-signal-lab-v2/`; the evaluation names the exact proof bundles.

Native shared-cache occupancy remained 144,016 bytes after removal; the result
is deliberately unverified and survives relaunch/stopping. A controlled real
URLCache reached zero in the combined cache/logout test. Do not turn the former
into a success claim or infer all filesystem allocation is cached payload.

Sign-out publishes protected intent before closing the account. Endpoint and
identity-slot hashes allow removal without deleting newer credentials or
retaining a token after remote resolution. Failed revocation keeps only
revocation recovery in Keychain until resolution/expiry. Already signed-out
retry preserves its recovery screen. Settings preserve scoped drafts and
pending operation IDs. Native tests use a UUID namespace for reset files and
synthetic loopback credentials; they do not clear a user's unfinished reset.

The owned loopback proof server on 4341 was closed and the port verified free.
It had no database, external model calls or business writes. No proof service
or database from the completed milestones remains owned and running. No
TestFlight, production deployment, hosted CI run or publication occurred.

## Latest independently verified slice — controlled current-session observation

The signed native observation slice passed one 50.275-second Chinese journey
and seven focused state-contract tests on an iPhone 17 Pro Simulator. A
disposable PostgreSQL evaluation passed 28 deterministic checks through the
real product Agent adapter. The tester freezes a question, window, minimum
unique-product-request count, success metric, guardrail threshold and rollback
before activation. Product request replay does not inflate the sample count;
guardrail, expiry and manual stop restore the task default for new work.

Stored observation data is configuration and execution metadata only. Summary
states expose accepted, fallback, failed and unverified counts and always set
`causal_claim_allowed` to false. Assignment is explicitly limited to the current
authenticated session; `online_assignment` remains false. See the
[controlled-observation evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-controlled-observation/README.md).

## Prior independently verified slice — native test workspace

The signed native workspace slice passed 40 related state and security checks
plus one 33.9-second Chinese journey on an iPhone 17 Pro Simulator. The journey
used a disposable PostgreSQL backend and verified create, empty readback,
generation-safe child adoption, a persistent isolation banner, process death,
online Keychain recovery, original-account restoration, entry revocation,
deletion, zero remaining rows/sessions, and a byte-identical original people
response. See the [native workspace evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-workspace-native/README.md).

The protected journal persists client-only credentials and operation IDs before
mutation. Its storage verifies exact bytes; the application compares the whole
decoded journal after millisecond date normalization so harmless JSON floating
round-off does not masquerade as corruption. Unknown or mismatched protected
state still closes account content. Environment switching stays blocked until
the journey settles. No candidate data, external model call, business-system
write, release publication or live S3 request was involved.

## Prior independently verified slice — synthetic Demo reset

The scoped reset passed 69 signed checks and two native journeys: Chinese
reset/relaunch/same-ID history and Chinese AX5/dark confirmation. It recognizes
unchanged synthetic catalog output, preserves recordings/source ownership/
calendar choices/queued capture, and rejects mixed or edited content. Standalone
Settings and Welcome retain independent recovery. Lost receipt reconciliation
uses replacement identity without clearing subsequently created work. The broad
recording-directory and global activity-request cleanup paths were removed.
See the [Demo reset evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-demo-reset/README.md).

The 201-file `demo-reset-source-delivery` snapshot passed Release with the public
Lab flag NO. All 12 owned source/test/catalog hashes match it. Six unrelated
Live Activity source/test files changed afterward and were preserved; do not
claim the snapshot proves those later changes. Localization passed with 2,074
keys and documentation with 427 Markdown files. All owned test/build processes
are finished. No backend/provider execution was added to Demo reset, and no
release was published. At that milestone the complete-goal requirement map was
still active; the final audit now closes the requested source-delivery scope.

## Latest independently verified slice — controlled feature override

The first admitted override passed a disposable PostgreSQL/Fastify product
evaluation, eight focused native state/readback checks, and a complete iPhone
17 Pro Simulator apply/restore journey. The persisted proof separates the
server value, temporary session override, and frozen product adoption receipt.
Another session cannot observe the override; stop, expiry, catalog drift, or
backend revision drift restores the server value for new tasks. The override
record stores no objective, evidence, citation, or answer. See the
[feature-override evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-feature-overrides/README.md).

## Next independently verifiable slice

Run the retained release checks on a physical internal device and a published
trusted revision: MetricKit callback delivery, microphone/audio-session
behavior, Instruments GPU/CPU/hang traces, deployed storage, external provider
availability, and hosted case-specific CI verification.

## Release gates and separate product extensions

- Hosted case-specific CI consumption is not proved by local fixture reports.
  Follow [the verification playbook](../docs/operations/lab-ci-verification.md)
  and retain source/trust/attempt/artifact identity. A hosted run requires an
  actual published revision; this local delivery did not publish one.
- Current-session observation windows, outcomes and stop controls are complete.
  Online assignment remains a separate, deliberately unavailable capability.
  Do not claim causal product improvement from descriptive samples or the
  earlier two-call real-model proof.
- Web batch comparison/regression review is complete for the authenticated
  source-delivery surface; a hosted release remains a separate deployment act.
- Actual physical-device MetricKit callbacks, microphone/audio-session behavior,
  and GPU rendering remain pending release evidence. MetricKit previews cannot
  prove real receipt, and the first display-link callback is not a per-task
  first-token, pixel delivery, or usable-render metric.
- Protected corrupt reset/sign-out journals preserve bytes and block effects.
  Automatic repair/discard of unknown ending intent is not implemented.
- Physical-device speech cancellation and Keychain behavior need direct proof;
  registry tests and Simulator execution do not substitute for it.

## Verification and ownership reminders

The 2026-09-05 owner-requested design handoff adds an interactive synthetic
preview and an executive journey to the existing design source; evidence lives
in [the design plan](2026-09-04-lab-v2-product-design.md#interactive-design-handoff--2026-09-05).
It does not complete the pending server-created workspace milestone.

Initial workspace investigation found that users belong to one account, ordinary
same-endpoint Keychain save removes the prior identity, and media upload writes
bytes outside the final database transaction. Workspace entry/return needs an
explicit protected recovery path; deletion must close late database and media
writes before claiming cleanup. A disposable loopback PostgreSQL fixture was
migrated through 044 for schema inspection and a rolled-back FK experiment, then
removed. At that design handoff, no workspace migration or product implementation
had resulted. The backend and native workspace evaluations recorded above
supersede that state: migration 045 provides the full-schema deletion boundary,
and the signed iOS journey proves protected entry, relaunch, return and cleanup
for source/Simulator delivery.

Use the installed xcodebuild wrapper and its shared automation lock. Do not
nest locks, bypass the wrapper, kill another owner or run competing Simulator
sessions. Signed Debug execution is required for Keychain tests. Immutable
Release snapshots use public device-Lab flag NO; internal build distribution
is a distinct release action.

Current Simulator proof target is iPhone 17 Pro
`02B4F0C1-A92F-469D-9DCC-5ED13F119507`, iOS 26.5. Preserve unrelated calendar,
scroll-continuity, localization, MX01 and package-store work. Source/receipts,
not chat chronology, own resumable progress. Completed milestone details live
in their evaluations rather than being duplicated in this plan.
