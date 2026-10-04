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
- A changed screenshot answer has no inherited rating. Each historical feedback
  event retains its answer version only while that source generation is admitted.
- Web follow-ups pass the preceding task ID. The backend retrieves that owner's
  original question and answer in the same relationship using its bounded
  conversation-history policy; the composer contains only the user's request.

## Evaluation use

The detail pane exports the captured execution for review. Relationship text
runs with intact captured model inputs can also become development cases in the
existing Lab regression library. A reviewer writes an expected behavior, then
compares two admitted model/prompt configurations in Lab. The actual original
input is frozen; a thumb or correction is never silently treated as a gold
answer, a semantic pass, or proof of improvement. Unrated cases can be saved too.

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
startup and tools: `TALENT_SIGNAL_CONVERSATION_TIMEOUT_MS`, default `180000`,
validated range `30000`–`300000`. Ark retains its own 40-second ceiling within
that deadline. Claude token limits remain 96,000 for image requests and 32,000
for text requests; turn, tool and dollar limits are unchanged. The deadline is
independent of HTTP admission or the 55-second SSE reconnect. Cancellation and
source revocation remain immediate. The 180-second default is provisional;
use measured stage timings and timeout rates before tuning it further.

Local product capture and native Opik export are separate. Opik requires the
account in `TALENT_SIGNAL_OPIK_RUNTIME_POLICY`, a runtime reload, and actual
request/destination readback; a healthy endpoint alone is insufficient.
Existing deletion receipts continue at their exact endpoint/workspace/project
after account-scope changes. Orphan tombstones and old full-content exports still
require the original frozen policy; never rewrite their policy to resend them.
See the [incident evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-25-conversation-diagnostics/README.md).

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
