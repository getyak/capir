# ADR 0012: Join Device Tools with Real Product Experiments

## Status

Accepted for device experiments, durable batches, saved regressions, runtime environments, and session model trials. Extends
ADR 0011; its deterministic scenario
and receipt contracts remain valid.

[ADR 0015](0015-private-evaluation-and-delegated-prompt-improvement.md) extends
the synthetic-only experiment input boundary for authorized private evaluation
and adds delegated candidate review. Device diagnostics and business-effect
isolation retain their original scope.

## Context

Fixed output replay helps verify presentation and boundaries, but cannot show
whether a model change improves an answer. Hiding every tool behind a healthy
backend also makes Lab unavailable when testers most need connection and
recovery help. The owner requested a useful Lab with real model validation,
build information, appearance tools, diagnostics, and clean testing journeys.

## Decision

Use three recognizable paths: real AI experiments, device tools, and explicitly
named deterministic scenarios. Device capability is a build decision; remote
experiment capability remains an authenticated server decision. Public Release
builds do not enable offline device tools by default.

Experiments compare two server-approved model/prompt configurations over
registered synthetic cases through the product's existing Chat adapter. Freeze
inputs, case revisions, configurations, repetitions, limits, reference time,
and instrument identity before execution. Record actual output and configuration,
provider duration, reported usage, hard checks, and a separate review.
Case coverage and repeated samples answer different questions. Same-model and
same-prompt runs measure repeatability. Execution success is not semantic correctness.

Commit a stable batch ID and its attempt matrix before provider execution.
Duplicate requests recover the same record, including after catalog changes;
different settings conflict. Database leases prevent duplicate workers.
Reserve each call durably before dispatch and enforce both batch and workspace
daily limits. A disconnected phone may read back completion. Cancellation stops
unissued work while retaining completed output. Graceful shutdown may resume
unissued attempts; a lost worker's dispatched attempt becomes unknown and is
never automatically paid-retried. Database time owns expiry consistently across
dispatch, cancellation, readback, and scrubbing. Content expires after seven
days; non-content ID tombstones prevent late replay. Legacy single-case records
remain recoverable under their original two-call contract.

A human may save a particular issued attempt as an immutable regression case.
Retain its frozen input, original reference time, observed output and separate
expected behavior. Reruns use the product runner and current admitted
configurations; reviewer notes and expectations never enter the target model's
input. Saved content has its own disclosed retention and recursively owned
deletion boundary. Export creates an explicit independent copy rather than
execution or release authority. The shared evaluation gates can consume a
recorded rerun, preserving failed, unknown and unresolved semantic outcomes.
An inspected failure is development evidence even if its original case was
held out. Actual CI consumption and release enforcement require independent,
case-and-revision-bound proof; a saved flag or local report cannot substitute.

CI provenance is a separate read-only check: admit repository identity, source
branches and workflow content; verify the completed attempt and its artifact;
recompute the report against current scoped records. Keep the CI consumer's
revision distinct from the product rerun's revision. A verified record can
contain failed integrity checks and never grants quality or release authority.
Short-lived freshness and changed-trust invalidation limit reuse; source
deletion wins over an in-flight verification. Operator configuration belongs
in the [CI verification playbook](../operations/lab-ci-verification.md).

Device tools display build and backend information, probe a read-only request,
inspect compiled page states and temporary app display settings, clear only
rebuildable URL cache, and offer scoped session recovery.
Onboarding preview has independent in-memory persistence and cannot consume
pending sources or modify saved onboarding progress. Cache cleanup reports its
observed remaining size instead of assuming removal is synchronous.

Reviewed maintenance is a resumable operation with separate intent, effect and
readback. Cache cleanup cannot delete drafts or pending operation IDs. Session
closure, local credential removal and remote revocation remain distinct; an
uncertain result stays recoverable without reopening old content or deleting a
new sign-in. Saved onboarding progress can return to Welcome independently of
its retained sources and recordings. A local restart does not claim to create
an empty server workspace or reset system permissions.

Demo identity alone cannot authorize deletion of co-located capture. Reset only
a recognized synthetic projection, bind review to its exact saved revision, and
preserve media, source ownership and queued work. Edited or mixed-source state
requires its normal source-specific controls. An atomic replacement carries the
operation identity so a lost receipt can be reconciled without erasing work
created afterward. Global activity queues have no inferred Demo ownership.

An empty product-flow test uses a separate, short-lived server account instead
of erasing or relabeling the owner's workspace. A server record binds that
account to its creator, expiry, media-storage scope, entry intents, and deletion
receipt. Child authority cannot outlive the parent session that issued it.
Closing the workspace precedes cleanup, blocks late business writes, and revokes
all child sessions. Every account-scoped table must be registered and guarded;
an unknown schema fails closed. Physical media absence and zero scoped database
rows are independent readbacks. An ambiguous object PUT leaves cleanup pending.
The minimal synthetic account/identity tombstone remains so late requests cannot
recreate or retarget the deleted scope.

Device display experiments reuse the compiled product components with synthetic
fixtures and memory-only callbacks. A named preset is a device preference,
not an activated trial. Temporary app overrides have an explicit duration and
restore action and end across account/environment transitions or relaunch.
System accessibility protections are a floor, never a configurable experiment
flag. Rendering simulations label their limits instead of claiming a system
setting or a completed accessibility audit.

Personal model trials use task-specific admitted capabilities, curated prompts,
an explicit duration, and one authenticated session as their boundary. Resolve
the selection only for a new product task, after its idempotency replay check.
Keep the existing Agent tools, scope, and human authorization boundaries. Stop
and expiry restore new tasks to the default; retry cannot reactivate a stopped
trial. Record provider execution separately from product adoption and quality.
Metadata is persisted after the product transaction releases its connection,
so diagnostics cannot deadlock a successful task by exhausting the same pool.

A current-session trial may become a controlled observation only after the
tester freezes its question, window, unique-request sample target, success
metric, adverse-outcome guardrail, stop threshold, and rollback target. Product
idempotency replay cannot create another sample. Every summary remains
descriptive and explicitly forbids a causal claim. Guardrail, expiry, manual
stop, or replacement restores the task default for new work. This mechanism is
an authenticated-session opt-in; it does not perform online assignment.

## Boundaries and consequences

- No candidate evidence, raw screenshots, arbitrary prompts, arbitrary provider
  endpoints, provider credentials, or hidden reasoning enter the experiment UI.
- Reviews stay in quality state. They neither promote a release gate nor change
  the app's normal model. Existing deterministic receipt promotion remains a
  separate explicit task.
- Runtime switching uses a compiled approved directory, unauthenticated
  deployment/contract/readiness preflight, and a generation-safe root replacement.
  Credentials, drafts, and recovery belong to endpoint/account/user together.
  Workspace-only identifiers do not establish environment ownership. Legacy
  migration requires a known origin binding and preserves deletion intent;
  conflicting records fail closed. Redirects never forward credentials.
  Active requests and recording block a transition. A switch selects an already
  deployed backend, with separate target authentication and a durable receipt.
- Connection and provider timings are real measurements. Frame rate, CPU,
  energy, full Instruments integration, and controlled online experiments are
  later work.
- Durable worker leases and attempt records now support batches independently
  of a phone or one API request. A separate worker deployment may later improve
  operational scaling without changing execution ownership. Pricing remains unavailable until a maintained price
  source can support an honest estimate.

## Evidence and reconsideration

See the [first delivery evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-v2/README.md)
and [runtime extension evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-runtime/README.md),
plus [session-trial evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-task-trials/README.md).
The [controlled-observation evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-controlled-observation/README.md)
verifies the frozen plan, unique sampling, descriptive summary, guardrail stop,
and default restoration through a normal product task.
The [test-workspace backend evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-workspaces/README.md)
verifies isolated creation, delegated-session invalidation, write closure,
local-media and database cleanup, schema fail-closed behavior, and expiry.
The [native test-workspace evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-workspace-native/README.md)
verifies protected Keychain recovery, generation-safe account adoption, persistent
isolation labeling, original-account return, and deletion readback on Simulator.
The [batch evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-batches/README.md) verifies
durable worker ownership, cancellation, recovery and actual native model output.
The [regression evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-regressions/README.md)
verifies saved-case recovery, reruns, deletion and shared evaluation consumption.
The [appearance evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-appearance/README.md)
verifies device presets, app trial restoration and compiled page states.
Reconsider scenario coverage when real model failures cannot be represented
with the existing synthetic cases. Expand model configuration only with
provider admission and repeatable evidence of product benefit.


Device diagnostics are an explicit, bounded session with a visible stop path.
Capture typed metadata before persistence; never rely on export-time redaction
of raw logs. Request tokens bind late results to the original session, and the
metrics delegate retains the runtime redirect restriction. Background/context
changes end capture; checkpoints recover as interrupted, never as a resumed
recording. Retention, deletion, corruption and export are device-owned. Measured
request phases and callback cadence remain distinct from model stages, rendered
FPS and causal diagnosis. A reviewed export is an independent file, not an
automatically submitted issue.

Automatic diagnostic correlation uses closed stage labels and a random request
identity. Client task ancestry is local to the async operation; server capture
is local to the authenticated request. Retain only validated, bounded metadata,
never arbitrary trace baggage or provider errors. Clocks and overlapping stages
remain distinct; adapter completion, first-token delivery, store publication
and usable UI are different observations. Late work cannot complete a stopped
recording or another request. Unsupported instrumentation remains unavailable.

Fault reproduction belongs to a separate synthetic transport that reuses the
real read client and product rendering. Use a session-local protocol and an
unsupported-by-default URL scheme; validate the closed route and credential
set before dispatch. This keeps accidental network fallback, global
interception and real account state outside the experiment. A fault session
has explicit expiry, cancellation and disposal. Its measurements retain their
synthetic origin instead of becoming evidence about backend performance.


MetricKit history is a separate explicit device subscription. Convert system
payloads directly to a bounded typed projection before any retention or export;
never retain raw call stacks, exception text or arbitrary metadata. A missing
metric is unavailable, and a synthetic layout is never historical evidence.
Do not infer per-model causality from app-wide reporting windows. Reception has
a time/process boundary; saved history has independent retention. Clearing
requires a durable watermark as well as cancellation because the system can
retain and redeliver an earlier payload. System deletion and app-copy deletion
remain separate effects.
