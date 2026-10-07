# Product runs and feedback

The Web workspace's **Run feedback** navigation opens `/workspace/monitor`.
Signed-in owners can inspect Web and iOS runs from the same account identity.
New requests are captured before execution, without requiring a rating. This
starts at deployment; historical answers without captured executions are not
backfilled or invented.

## User flow

- Thumbs up/down saves immediately. Reasons, a comment, selected passage (Web),
  and a correction are optional. Tapping the selected thumb withdraws it.
- Controls show the saved server state. Failed submissions retain their exact
  idempotency key; conflicting edits retain the intended rating but ask the user
  to review the current answer before retrying against its new version.
- The monitor separates helpful, unhelpful, and unrated runs, with platform,
  outcome, question search, paginated history, answer previews, original input,
  context/model calls, tool calls, and versioned feedback history.
- Refresh controls are explicit and truthful. An auto-refresh toggle and a
  5/10/30-second interval selector (default 10 seconds) drive authenticated GET
  reads only; polling never starts provider or job execution and creates no
  schedule. Automatic polling runs only while the monitor tab is the visible
  tab. Latest-page list polling pauses during historical pagination, while the
  selected detail polls on its own; the manual refresh reads the latest list
  page and the selected detail and resumes latest-page polling. List and detail
  carry separate freshness, failure and stale labels, and a visibility resume
  issues one bounded immediate fetch per stream instead of replaying missed
  ticks. Overlapping reads are skipped and stale responses are fenced by
  generation; appended pages deduplicate run IDs and disable load-more in
  flight. A filter change clears the old list immediately, including while the
  next read is debounced or pending.
- The trace view keeps recorded truth. Status labels stay exact and unknown
  statuses are shown verbatim rather than folded into "completed"; terminal
  indicators distinguish completed, failed, cancelled, interrupted, waiting,
  partial and fallback states. A missing or malformed timestamp reads as an
  unknown duration on terminal states and "in progress" only while actually
  running. The failed-tool count is displayed separately from the final run
  status, so a completed run with failed tool spans shows both; total recorded
  spans, the reported model, and run attempts are separate facts. Parent
  hierarchy is compact indentation with explicit parent names instead of a
  fabricated sequential chain. Input/output bodies name their captured size
  state (redacted, truncated, unavailable) explicitly. When the source is
  withdrawn the metadata trace remains visible while bodies, originals and
  feedback stay hidden; a later read never restores a previously shown body.
- Conversation originals appear inline only for conversation runs whose
  persisted input keeps content available with a validated session and message
  identity and validated image manifests. The captured session must match the
  run's own persisted session, and a manifest batch is rejected wholesale (no
  partial list, no renumbering) when it is invalid, duplicated, or beyond the
  conversation contract of 10 images / 30 MB. Images are read through the
  existing authenticated
  `/api/workspace-sessions/:id/conversation-images/:messageId/:index` route in
  immutable manifest order; screenshot-task runs keep their existing task image
  route. There is no fallback to another session or message, and file names are
  labels, never identity. Bytes arrive only as object URLs through the
  authenticated readback and are bound to the exact source route and login
  binding. The resident page supplies the opaque credential binding and remounts
  the monitor when it changes; credentials never become component props.
  A withdrawn login or changed source removes displayed bytes in the
  same commit, and no base64 enters the DOM or logs. No input image is shown
  when the context is absent.
- A changed screenshot answer has no inherited rating. Each historical feedback
  event retains its answer version only while that source generation is admitted.
- Web follow-ups pass the preceding task ID. The backend retrieves that owner's
  original question and answer in the same relationship using its bounded
  conversation-history policy; the composer contains only the user's request.

## Evaluation use

The detail pane exports the captured execution for review under an explicit
purpose label (`product-run-review-and-case-design`) together with the exact
captured output hash and run ID; the export carries the same captured version it
reviews. Feedback inside an export or a saved case is user feedback, never gold
labels.

Relationship text runs with intact captured model inputs can also become
development cases in the existing Lab regression library. A reviewer writes an
expected behavior, then compares two admitted model/prompt configurations in
Lab. The actual original input is frozen; a thumb or correction is never
silently treated as a gold answer, a semantic pass, or proof of improvement.
Unrated cases can be saved too.

A saved regression case binds to one exact run output version: capture state
resets when the run ID or the exact output hash changes, and a missing or blank
output hash disables capture until a version exists. Replay support mirrors the
canonical Lab capture policy: a completed answer span with a complete captured
input and output body that proves the answer carried no images. An older text
record without an images key or an explicit empty batch is proven image-free; a
malformed or unprovable capture is never treated as replayable. Image runs stay
non-replayable and the UI names that limitation explicitly.

Screenshot and person-research details can be inspected/exported, but their
end-to-end automatic replay is not implemented by this adapter. The UI names
that limitation explicitly. Existing Opik trace/experiment integration remains
available through its configured runtime policy; this local monitor does not
require Opik to capture admitted product requests. Internal testing deployment
also projects already captured, source-available runs into the private
`<runtime-project>-product-runs` Opik project every 30 seconds. It preserves
original timestamps and missing details; it never invokes a model to backfill
history. Active Lab workspaces inherit only their admitted owner account scope.
Unbound failures remain metadata-only in the local monitor.

The private evaluation harness implements Promptfoo's JavaScript provider
interface in
[`harness/apps/eval-runner/src/promptfooProvider.ts`](https://github.com/getyak/capir-evals/blob/main/harness/apps/eval-runner/src/promptfooProvider.ts)
and delegates to the existing Lab job service. Configure two
provider entries with `configurationIndex` 0 and 1, the same `backendURL`,
`runKey`, and two `configurations` (`model`, `prompt_preset`). Pass a JSON prompt
containing the saved regression's `id` and `content_hash`. Supply the signed-in
backend token transiently through `TALENT_SIGNAL_EVAL_TOKEN`.

Use `evaluateOptions.maxConcurrency: 1` and disable Promptfoo response caching
for fresh comparisons. Both provider entries reuse the same persisted Lab job;
reuse a `runKey` for a retry and choose a new one for a new experiment. The
adapter also waits within a bounded deadline if another Lab experiment owns the
account. Provider errors remain errors, not evaluable answers. The returned
metadata names the case input hash, attempt, actual model/prompt and existing
hard checks; semantic assertions remain independently defined by the reviewer.

## Runtime and lifecycle

Migration `065_screenshot_directory_authority` is required by readiness. Capture covers
admitted relationship Chat, unscoped Chat, screenshot tasks and person research.
Request-local context keeps concurrent runs separate; queued span writes avoid
waiting for a second database connection inside a product transaction.
Screenshot resumes restore capture from the persisted task-to-run association.
Model and tool bodies have explicit content-size states. Original image bytes are
excluded; failed or unbound runs retain metadata only. Diagnostic content stays
request-local until a committed task and its source generation admit it, with a
2 MB per-content and 16 MB aggregate span limit. Unrecorded details do not prove
that no operation occurred. A screenshot checkpoint cannot restore earlier
spans or feedback content after source changes. Directory changes clear cached
candidates, preserve the original image/extraction, and require a fresh lookup;
late outputs must satisfy the current canonical task revision.

Original content follows the existing canonical session, screenshot, source and
retention predicates, with a seven-day maximum here. Expired/withdrawn content
is hidden immediately; background cleanup removes payloads while retaining
run metadata and feedback counts. Regression and descendant rerun access follows
the same source availability. This preserves source/version meaning without
introducing another approval step.

## Background conversation diagnostics

`POST /v1/agent-sessions/:id/conversation-queue` admits the message and original
image bytes atomically; it does not await the model. The runner claims the next
message, restores original bytes as base64, runs configured Ark image inspection,
then Claude with the original base64 and inspection context, and finally commits
the answer to the canonical session. Images are not converted into text-only
model input. Queueing preserves ordering, idempotency and recoverability.

Admission logs correlate `session_id`, `message_id` and `queue_entry_id`.
Execution adds `run_id`, `task_id` and `attempt`. Each model attempt has one
local product run. A retry invokes a new run; persistence-only replay links the
stored reply to its original task ID without invoking another model. Successful
committed replies expose captured LLM/context/tool spans in the monitor. Replay
cannot reconstruct spans released after an earlier persistence failure.

Failure events retain a whitelisted code, elapsed duration, observed response,
tool and token counts, retry/status metadata and SDK timing when available.
`sdk_session_id` identifies the SDK session, not an upstream HTTP request.
Unknown errors have a fixed generic code; raw exception prose, screenshots and
base64 are excluded from ordinary logs. Failed/unbound local spans remain
metadata-only through cleanup and expire with the run. Missing capture must
never turn a successful product request into a failure.

Workspace Claude has one total deadline, including image inspection, SDK
startup and tools: `TALENT_SIGNAL_CONVERSATION_TIMEOUT_MS`, default `1800000`,
validated range `30000`–`1800000`. Ark retains its own 40-second ceiling within
that deadline. Admitted current and historical images have a cumulative Claude
allowance of 100,000,000 tokens, including repeated context and cache usage
across tool rounds. This is not a single context-window or output limit.
Ordinary text remains at 32,000 tokens; MCP-only context retains 96,000.
Turn, tool and dollar limits are unchanged. The deadline is independent of
HTTP admission or the 55-second SSE reconnect. Cancellation and source
revocation remain immediate; source expiry can end a run earlier.

Token exhaustion is persisted as `MODEL_RUN_TOKEN_BUDGET_EXHAUSTED`, separately
from `MODEL_RUN_TIMEOUT`. Queue warnings keep the original whitelisted harness
`failure_code` and expose the queue classification as `queue_failure_code`.
The failed-message view distinguishes these reasons while retaining the input
and explicit retry/removal controls. Unknown errors retain a generic failure;
no raw provider prose or private input enters the diagnostic codes.

Local product capture and native Opik export are separate. Opik requires the
account in `TALENT_SIGNAL_OPIK_RUNTIME_POLICY`, a runtime reload, and actual
request/destination readback; a healthy endpoint alone is insufficient.
Existing deletion receipts continue at their exact endpoint/workspace/project
after account-scope changes. Orphan tombstones and old full-content exports still
require the original frozen policy; never rewrite their policy to resend them.
See the [incident evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-25-conversation-diagnostics/README.md).

Deletion is durable and terminal. A `deleted` receipt keeps its tombstone,
attempt count and recorded span ids and is never reprocessed: repeated flushes,
repeated deletions and process reloads issue zero transport requests, while the
tombstone keeps blocking late attempts and resumes. Only genuinely new known
recorded spans reopen a completed deletion. A failed deletion — including an
unverified remote readback — stays `deletion_pending` on a persisted bounded
retry schedule (retry streak, 5 seconds doubling to a 5-minute ceiling), never
by historical attempt count, and success clears the retry metadata. Tombstones
without a receipt acquire one before their first attempt. Deletion resolves the
exact configured project name through a bounded exact-match project search and
uses the project-scoped batch trace delete; the trace and every recorded child
must return GET 404 before the receipt becomes `deleted`. A missing, ambiguous
or unresolvable project fails closed, and unknown remote results are never
reported as deleted.

For incident readback, inspect each governed outbox root, including the
`deployment-probes` child directory. Product-run projection derives exactly
`<runtime-project>-product-runs` while keeping the same endpoint and workspace;
verify each receipt at its frozen target rather than retargeting it to the base
project. Require nonempty receipt/trace cohorts and HTTP 404 for all recorded
traces and spans, discarding response bodies. Compare a fixed terminal cohort's
attempt counts and update times across at least two background intervals;
legitimate newly completed deletions must not be confused with churn in the
existing cohort. Endpoint health and a partial-project audit do not prove
complete deletion.

Exporter locks never move across process namespaces and never expire by age
alone: a namespace mismatch is not proof of death, and a foreign or unproven
owner is left in place even when it looks stale. Recovering proven dead
old-container locks is a serialized deployment step: verify that the lock's
writer namespace is absent from the Docker container inventory for the mounted
volume, then remove only that exact owner's lock file. No code path steals a
lock on time alone. Use the operator helper from the clean deployment checkout:

```sh
node scripts/deploy/recover-runtime-observation-locks.mjs talent-signal-testflight-local-api-1 --dry-run
node scripts/deploy/recover-runtime-observation-locks.mjs talent-signal-testflight-local-api-1 --apply
```

The helper freezes owner records before rechecking Docker identity, validates the
owned volume, and preserves replacements, symlinks and unknown owners. It emits
only aggregate counts and fixed failures, never container environment values.
An existing `.operator-recovery.guard` fails closed; inspect the interrupted
operation before removing that guard. Its counterexamples run in
[`repository CI tests`](../../scripts/ci/recover-runtime-observation-locks.test.mjs).

## Verification

See [GET-23 delivery evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-09-get-23/plan.md). Focused
PostgreSQL tests run through `PRODUCT_RUN_TEST_DATABASE_URL` in an explicitly
owned `get23_proof` / `opik_capture_test` or CI `lab_regression_ci` database. Existing feedback tests
exercise a captured unrated product run through actual Lab admission and rerun.
Native tests cover conflict intent, response loss, note restoration and
withdrawal. UI evidence distinguishes genuine client/server interaction with a
controlled provider from a live external model execution.

API references: [Fastify hooks](https://fastify.dev/docs/latest/Reference/Hooks/),
[Node AsyncLocalStorage](https://nodejs.org/api/async_context.html),
[Promptfoo JavaScript provider](https://www.promptfoo.dev/docs/providers/custom-api/).

## Internal testing delivery default

Treat local run capture, durable retry storage, private Opik connectivity and
destination readback as part of configuring product testing. A healthy Opik UI
alone does not prove instrumentation. Store the scoped policy in
`staging:/backend/TALENT_SIGNAL_OPIK_RUNTIME_POLICY`; keep `product_run` in its
scope alongside the admitted native provider scopes. Use seven days or the
source's earlier expiry. Never expand this default to public exposure, other
accounts, another model provider, credential content or indefinite retention.

The TestFlight deployment starts the pinned Opik service and requires a
synthetic write/read/delete transport probe from inside the API container.
After instrumentation changes, also verify a real authenticated product request
by its `x-talent-signal-run-id`, local spans, retained outbox receipt and exact
Opik trace. A transport-only probe cannot prove model instrumentation. Claude
SDK diagnostics identify host-supplied context separately from observed SDK
messages; neither claims access to an unobserved provider wire request.

When reporting a deployment, name missing task-family coverage or unavailable
fields explicitly. Product-run projections retain captured provider payloads but
do not reinterpret SDK aggregate usage as separately billed model leaves.
