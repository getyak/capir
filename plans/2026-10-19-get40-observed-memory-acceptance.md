# Observed Memory acceptance continuation

Owner: current chat. Base product57e77912; private evaluationfcd1130.
Method: inline execution with test-driven fixes and final independent review.

## Outcome and boundary

Complete GET-40's existing20-case synthetic Memory acceptance, including at
least5 no-update cases and the required real save/recall/correct/delete surfaces.
The owner explicitly requested continuing tests and finishing Linear tasks after
the successful host SDK diagnostic. This resumes the defined acceptance work;
it does not turn the completed two-request or one-SDK diagnostics into an
unlimited grant. Preserve the old stopped phase, known estimate and every
unknown operation. Use a newly frozen linked continuation, not a cleared ledger.
One failed retry per case and40case executions remain the outer bounds; stop
immediately on new unknown usage. Do not switch model/provider or broaden data.

The original Linear GET-40 design/acceptance and the existing20-case bank are
the spec. Generated test data does not authorize real business or external writes.
Actual human quality/effort judgments remain distinct from machine verification.

## Required slice before funded acceptance

The SDK diagnostic proved transport availability, but the formal evaluator still
suppresses its observer and drops exporter environment. Production retry receipts
also omit safe error categories and connection hints. A503 terminal fixture was
rejected with the misleading error name CLAUDE_HARNESS_SUCCESS. Fix these proven
gaps first; do not rerun the whole batch merely because a tiny request passed.

## Task 1: safe SDK failure diagnostics and bounded retry policy

Files: apps/agent/src/claudeHarness.ts; focused diagnostics helper if needed;
apps/agent/src/claudeHarness.test.ts; relevant offline SDK fixture/test only.

- Write failing tests for an is_error terminal with success subtype: reject as
  provider error, preserve actual usage, never emit a success-named error.
- Test bounded safe retry category/cause collection through the real harness;
  arbitrary vendor text/credentials must not enter receipts or metadata.
- Add optional host-owned apiRetryLimit, integer0..10; absent preserves current
  configuration, invalid rejects before SDK launch,0 reaches native SDK env.
- Run focused RED/GREEN, full Agent checks and meaningful native-SDK loopback
  characterization. Expected: provider refusal has the right failure code,
  unknown usage stays unknown, and no paid request is made by these checks.

## Task 2: explicit observation for the formal private evaluator

Files: capir-evals/harness/scripts/evals/get40/evaluate-model.mjs,
get40-policy.mjs, focused evaluation tests and source-bound execution controls.

- Preserve exact model, input/oracle separation and per-attempt remaining budget.
- Admit only an explicit owner-bound synthetic Opik configuration and durable
  outbox; do not import production exporter flags or enable business collection.
- Fix a single source-bound export path for actual harness observations, retaining
  run/case/stage, source revisions and safe failure metadata before cleanup.
- Link a new continuation to immutable historical journals and all prior unknowns;
  prevent a fresh permit/state directory from silently resetting resource counts.
- Run private complete checks and exact-source offline/real-PG preflight. These
  checks must invoke no remote provider and cannot claim semantic quality.

## Task 3: review, clean-source delivery and actual acceptance

- Review source/evidence against full original scope, close confirmed important
  findings, pass exact-head CI/security and merge through normal protections.
- Deploy every affected resident service from clean committed source; verify
  actual revision/behavior, preserve live/rollback and other work.
- Freeze exact linked acceptance scope, run one real full Memory case first,
  inspect its canonical queue/proposal and Opik receipt, then continue within
  the20-case/40-execution boundary. A new unknown stops funded dispatch.
- Complete actual Web lifecycle and original scope/readback checks through an
  expiring capir test account, keeping credential output sanitized and verifying
  test stop cleanup. Do not substitute localStorage or a static mock.
- Only close the issue if all original required evidence is present. Update
  dependent parent tasks from this evidence without declaring them all complete.

## Review focus

- A terminal error must not become zero complete usage merely because the SDK
  emits a success subtype or an empty aggregate.
- A secret or private vendor message must not escape through new diagnostics.
- Retry policy and observation config must be host/permit-owned, never model input.
- A new continuation must preserve historical unknowns and cumulative limits.
- A passing helper/SDK call must not replace real queue, persistence or UI proof.

## Current state

Task1 implemented: 49 focused harness tests, 576 Agent tests and 203 Agent Host
tests pass; typechecks and builds pass. The real pinned SDK loopback503 case
made exactly one request with apiRetryLimit0 and returned the provider failure
code/status. Documentation and architecture checks pass. Independent source
review is running. Logs remain in the task-owned ignored delivery output.

Task2 implemented in the separate private branch: 43 bounded-evaluator tests
pass, including explicit synthetic observation forwarding, verified-export
failure stopping further dispatch, and immutable continuation linkage preserving
old unknowns and consumed attempts. Complete private/source-bound checks remain.

The primary425-file dirty work remains separate. No new acceptance case or paid
provider request has been made under this continuation yet. GET-40 remains open.
