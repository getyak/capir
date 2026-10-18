# Screenshot evaluation usage diagnostics

Source-safe, bounded diagnostics for Volcano Ark screenshot preprocessing make
provider usage honestly observable after ordinary task checkpoints. Raw
screenshots, provider bodies and full raw spans stay under their original
exact-generation fence; this surface exposes counters only. It is metering and
acceptance evidence, not billing: a counter is not an invoice.

## Known versus unknown counters

One `contact.screenshot.preprocess.usage` span is written per successful Ark
receipt of a screenshot task, and one `harness.sdk.assistant` leaf span per
observed Claude SDK assistant frame. Their metadata distinguishes:

- `raw_usage_known: true` — the provider response explicitly reported both
  `prompt_tokens` and `completion_tokens` as safe non-negative integers. Then
  `raw_prompt_tokens` / `raw_completion_tokens` hold those exact values,
  including an explicit provider-reported zero.
- `raw_usage_known: false` — raw usage was missing, null, negative, fractional,
  a string, an unsafe integer, or only half-observed. Then
  `raw_prompt_tokens` / `raw_completion_tokens` are `null`. Absent or invalid
  usage is never reported as zero.

`model` is the pinned requested model. `reported_model` is the identity the
provider response reported (validated equal to the requested model before the
receipt is admitted). `request_id_sha256` is a SHA-256 digest of the provider
request id, matching the `sdk_message_id_sha256` precedent; raw request ids,
nested usage objects, reply text, URLs, source ids, credentials and error
stacks never ride this metadata path.

The SDK leaf carries the same known/unknown rule per field:
`sdk_input_tokens`, `sdk_output_tokens`, `sdk_cache_read_input_tokens`,
`sdk_cache_creation_input_tokens` and `sdk_total_input_tokens` are safe
non-negative integers or explicit `null`; `sdk_message_id_sha256` is the
lowercase SHA-256 of the SDK message id (the raw id is never retained here);
`sdk_usage_basis` is the fixed value
`per_message_provider_reported_input_excludes_cache`; `sdk_stop_reason` is one
of `end_turn`, `tool_use`, `max_tokens`, `stop_sequence`, `pause_turn`,
`refusal`, or `null`. The observed `model` is provider identity evidence, not a
release approval. Leaves are counted once per hashed message id; never sum
aggregate receipts into leaves or infer a missing leaf from an aggregate.

The task packet (`GET /v1/contact-agent/tasks/:id` → `preprocessing.usage` and
`preprocessing.request_receipts[]`) keeps its frozen `screenshot-preprocess.v3`
normalized counters: invalid fields map to zero and valid fields keep their
value. Those normalized values cannot prove a known zero; only the
`raw_usage_known` / `raw_*` counters above carry that claim. Existing
`sdk_*` message-hash and flat usage diagnostics are unchanged.

## Endpoint shape

`GET /v1/product-runs/tasks/:id` (same owner, `account_id + user_id + task_id`)
returns `spans[]` including:

```json
{
  "id": "<derived span uuid>",
  "parent_id": null,
  "name": "contact.screenshot.preprocess.usage",
  "kind": "llm",
  "status": "completed",
  "input": { "status": "unavailable", "original_bytes": 0, "retained_bytes": 0, "sha256": null },
  "output": { "status": "unavailable", "original_bytes": 0, "retained_bytes": 0, "sha256": null },
  "metadata": {
    "provider": "volcano_ark",
    "model": "doubao-seed-2-0-lite-260215",
    "reported_model": "doubao-seed-2-0-lite-260215",
    "raw_usage_known": true,
    "raw_prompt_tokens": 12,
    "raw_completion_tokens": 8,
    "source_image_index": 0,
    "request_id_sha256": "<64 hex>"
  },
  "error": null
}
```

The run bound by the initial `POST /v1/contact-agent/tasks` response header
`x-talent-signal-run-id` is the canonical run; a task has exactly one. Span
identity is derived from task id + provider request id, so repeated admitted
checkpoints upsert one span per receipt instead of duplicating counters. Do not
add `request_receipts` aggregates to these counters; each receipt is counted
once.

The SDK leaf has the same shape with `name: "harness.sdk.assistant"`,
`kind: "llm"` and the metadata key set
`provider`, `model`, `sdk_message_id_sha256`, `sdk_input_tokens`,
`sdk_output_tokens`, `sdk_cache_read_input_tokens`,
`sdk_cache_creation_input_tokens`, `sdk_total_input_tokens`, `sdk_usage_basis`,
`sdk_stop_reason`. Both spans always carry `input`/`output` with
`status: "unavailable"` on every metadata-only projection.

## Admitted reads versus usage-diagnostic reads

The strict sanitizer behind all four surfaces (detail projection, cleanup
preservation, the generation rebind purge and admitted writes) only accepts the
two span shapes above with exact provider literals, bounded model identifier
shapes, 64-hex hashes, safe counts and allowed stop reasons. A span with any
invalid required identity field is dropped entirely; an invalid optional field
becomes explicit `null`.

`GET /v1/product-runs/tasks/:id` distinguishes three states:

- `run.content_available: true` — the exact-generation source fence admits the
  run. Spans are returned as admitted.
- `run.content_available: false` with usage diagnostics present — only the
  strictly sanitized `contact.screenshot.preprocess.usage` and
  `harness.sdk.assistant` spans are returned; `input`, `output`, `history` and
  every other span stay unavailable. Diagnostics visibility requires the
  canonical same-owner screenshot run and task to be bound and live (creator
  ownership, active user, run/task retention expiry), the task to be un-deleted,
  un-cancelled and free of deletion intent, no task retraction, a current
  directory, and a current capture chain: active capture/person/context and a
  source retention receipt that is either available, or the product's retained
  reviewed transport state (`purged` + `review_completed`). Revoked, deleted,
  authorization-expired, retention-expired or directory-lost sources are never
  authorized by this exception, and only unrelated account generation drift is
  ignored. Raw `content_available` is never set by this exception.
- everything else — `spans: []`.

A task linked to a capture whose receipt later revokes or purges is deleted by
the product's own invalidation trigger; its diagnostics then disappear with the
task. The existing iOS preprocessing protocol can link a still-live completed
`preprocess_only` task after ephemeral capture review has already completed.
That exact request-seed/resource/idempotency binding keeps its narrow counters
while raw content stays hidden. This does not revive a retired task or grant
ordinary tasks a new capture-link path.

## Source privacy and lifecycle

- Diagnostics carry flat primitive counters only. The metadata fallback is a
  strict subset of the shared span metadata allowlist and cannot recreate
  revoked, expired or private content, arbitrary prose, nested usage objects or
  raw identifiers.
- Every diagnostic write revalidates the canonical same-owner screenshot run
  and task through the narrow lifecycle admission above. Raw writes retain
  their original exact-generation check.
- Ordinary same-task checkpoints advance the account source generation and the
  run rebind purges prior-generation span metadata. Bounded diagnostics are
  refreshed after that purge; raw `input`/`output` values are not and stay
  rejected by the exact-generation flush fence.
- Source deletion, revocation and expiry remain effective: cleanup deletes the
  run's spans, later diagnostics writes are refused, and a late append/flush
  cannot restore raw content or counters.
- Reads are same-account, same-user only; unavailable sources hide span content
  per the existing product-run rules.

## HTTP run binding and recovery

The initial `POST /v1/contact-agent/tasks` starts background work only after the
HTTP reply actually completed with status 201 (create) or 200 (idempotent
replay) and the canonical admitted product run is committed and bound to the
task for the same owner. A failed serialization or `onSend`/binding failure
(HTTP 500), a rejected stream, or a premature close of the response never
starts background work and never dispatches a provider call. The runner then
observes the bound run and its own capture sink; it never falls back to the
response-lifetime request sink. Idempotent replays and concurrent same-key
admissions keep the same run (`attempts` counts admissions) and never re-execute
the provider.

GET recovery and explicit resume use the same finished-reply and canonical-run
gate. A successful read or resume of an orphan left by a failed initial reply
cannot dispatch provider work. A normal canonical task can still resume, with
its supplied image forwarded unchanged. Deliberate internal non-HTTP runner
callers retain their existing contract.

## Known limits

- Full raw spans (image views, provider bodies) do not persist across normal
  screenshot checkpoint chains: their promotion still requires the original
  exact source generation. Only the bounded counters above are guaranteed
  readable after ordinary checkpoints.
- The usage-diagnostics exception is defined for canonical screenshot runs
  (`task_kind='screenshot'` with a bound task). Chat runs keep their existing
  task-less/failed metadata policy.
- An admitted later checkpoint rebinds the run and may again expose the latest
  checkpointed task response by product design; it never restores raw pixels,
  provider bodies or span content, and cleanup of a truly invalidated source
  removes even the counters.
- A failed or aborted provider call may still be billed but produces no receipt;
  no diagnostic span is invented for it. Absence of a counter is not a claim of
  zero cost, and counters are never an invoice. Model identity fields are
  observed evidence, not release approval.
