# GET-37: source-safe screenshot usage and canonical HTTP admission

## Outcome and boundary

Keep exact Ark and Claude SDK usage diagnostics readable after ordinary
screenshot checkpoints and unrelated task generation drift. Every HTTP start,
including GET recovery and explicit resume, requires a completed successful
reply and a committed same-owner canonical run. Raw screenshots, provider
bodies and full traces keep their original exact-generation fence.

This is a prerequisite for the private GET-37 evaluator. Human per-image review,
semantic quality, vendor invoices and GET-37 completion are not established by
these synthetic tests. Parent owns Git/CI/merge, clean resident deployment,
private schema/pin integration and any bounded real preliminary run.

## Reproduced failures

- Normal checkpoints purged raw spans and all SDK leaf metadata. Ark packet
  normalization mapped missing counters to zero, hiding the distinction from
  an explicitly reported zero.
- A second ordinary task advanced the account generation. A direct read of the
  first task hid its counters and cleanup deleted them, although its own
  source remained current. Replaying the first task masked this failure.
- Initial response failure or premature close still started the runner.
  A later actual GET and resume could also dispatch through the no-run
  internal fallback after a failed initial response left an unbound run.

## Implementation

1. Ark results and receipts retain explicit reported identity and raw-known
   counters. Missing, invalid or partial usage stays null; frozen v3 packet
   normalization is unchanged.
2. Forward migration `100_screenshot_usage_diagnostics.sql` defines narrow
   canonical screenshot admission and a bounded SQL sanitizer. The manifest
   and reviewed frozen history digest append this migration without editing
   applied SQL. Only unrelated account generation drift is ignored; task,
   creator, user, expiry, deletion/cancel, retraction, directory and capture
   authorization/retention are revalidated.
3. Detail projection, cleanup, generation rebind and admitted diagnostic writes
   preserve only `contact.screenshot.preprocess.usage` and
   `harness.sdk.assistant` metadata. Counts are safe integers or null, identities
   are bounded, request/message ids are hashed. Raw input/output, nested usage,
   arbitrary prose and other spans never gain this exception. SDK leaves carry
   no per-leaf USD, and aggregates must not be added to leaves.
4. Initial POST, GET recovery and resume share one successful finished-reply
   gate followed by canonical same-owner run lookup. Stream rejection,
   premature close, failed responses and unbound orphans do not dispatch.
   Normal canonical replay/resume and deliberate internal runner contracts
   remain available.

The existing iOS protocol permits one narrow post-review link: an exact
`preprocess_only` task with matching iOS seed, capture source resource and
completed intake idempotency receipt can link after ephemeral review. Its
still-live task retains diagnostics with raw content hidden. Receipt revoke or
purge after linkage retires the task through migration 047; retained fragments
elsewhere do not revive it. Ordinary tasks do not gain a new linking path.

## Verification evidence

All local model calls use fake Ark/SDK only, against the disposable
`get37_trace_isolated` PostgreSQL database; real provider calls are zero.

- Initial meaningful RED: raw Ark fields absent, diagnostic spans missing and
  background dispatch before canonical binding.
- Repair-1 RED against byte-exact prior implementation and its old purge:
  five regressions failed (drift, SDK checkpoint, capture lifecycle and failed
  responses). The original and final RED logs are retained separately.
- Independent actual HTTP probe: failed POST 500 left null run task binding;
  GET then invoked fake Ark/SDK, and resume invoked SDK again.
- Parent recovery regression first failed with `starts=1` after GET. After all
  HTTP entries shared the gate, denial through GET/resume passed. A normal
  canonical task still resumed successfully and reused its Ark receipt.
- The capture regression uses actual `createResourceCapture` and
  `linkScreenshotContactTaskCapture`, not a direct SQL task attachment. It
  checks post-review visibility, expiry/directory loss, revoke retirement,
  foreign owner denial, cleanup and refused late writes.
- Final backend focused suite: 100 passed, zero skipped. Agent focused suite:
  31 passed before the parent route/test delta, which does not change Agent
  code. Parent backend typecheck and documentation checks accompany the final
  source receipt. The reviewed migration baseline check and its 13 tests pass.

## Remaining delivery gates

Independent final source review, all applicable latest-head CI/security checks,
normal merge, clean affected resident deployment and observed changed behavior
remain required. The private evaluator must then bind the actual deployed
revision and metadata schema before a real preliminary run. GET-37 and GET-36
remain In Progress while their separate acceptance requirements are unmet.
