# PRD-02: Durable Signal capture

## Problem and user outcome

A recruiter must be able to preserve a short, purpose-bound text Signal before
the operating system interrupts them, then know whether it is local, queued,
synced, failed, or deleted without treating upload as analysis or confirmation.

## In-scope requirements

- `V1-CAP-001` and the text path of `V1-CAP-002`;
- capture-path contributions to `V1-EVI-003`, `V1-EVI-004`, and `V1-SEC-001`;
- an idempotent bridge from an identity-bound capture to a staged Pursuit
  Proposal.

## Out of scope

- screenshot, photo, file, audio, and recording capture;
- automatic identity merge, background microphone use, or external sending;
- a model deciding confirmed state.

## Personas and entrypoints

An independent recruiter uses the global Capture entrypoint, records a short
text Signal, selects or reviews its Person and Pursuit scope, and leaves the
app. Inbox is the recovery entrypoint for queued, ambiguous, failed, or deleted
items.

## Screen and interaction states

The client must distinguish editing, saved locally, identity review, queued,
uploading, staged for review, failed with retry, deleted, and offline. “Saved”
means durable local storage only; “synced” requires canonical server readback.

## Canonical owner and data model

The iOS outbox owns only an encrypted local command and its retry metadata.
Backend Capture, source resource, evidence fragment, retention receipt, and
Pursuit Proposal own server state. A stable client capture ID and content hash
connect retries and deletion lineage without making the device a second CRM.

## State transitions and invariants

- editing → saved_local → queued → uploading → staged_for_review;
- uploading may return to queued or failed, never confirmed;
- identity ambiguity routes to review and never guesses by display name;
- duplicate retry returns the same capture and lineage;
- deletion removes local payload and invokes governed server deletion when a
  server receipt exists.

## HTTP, event, and tool contracts

Existing governed capture/resource endpoints remain the evidence owner. PRD-04
adds the Pursuit Proposal staging endpoint after identity and evidence review.
No Agent tool can create a Capture or mutate a Pursuit.

## Permission and privacy boundary

Text is purpose-bound, account scoped, and excluded from logs and evaluation
artifacts. Agent staging accepts only active, authorized, reviewed evidence
with confirmed attribution from the selected identity-bound capture.

## Failure, retry, conflict, and delete behavior

The local command is written before upload. Retries use one idempotency key.
Timeout does not imply success. Relaunch reconstructs from the outbox and
server readback. Deletion is recoverable only while the governed retention
policy says the source still exists.

## Deterministic tests

Tests cover two-second local persistence, duplicate retry, offline relaunch,
same-name ambiguity, authorization revocation, source deletion propagation,
and payload removal after successful deletion.

## Agent SDK evaluation cases

The Agent receives a bounded evidence snapshot only after capture and identity
review. Prompt content cannot alter the tool allowlist or claim confirmation.

## Simulator and full-stack journeys

Proof requires Capture → force quit → Inbox recovery → upload → Proposal
readback on the small-phone simulator, plus offline, retry, and deletion paths.

## Metrics, rollout, and rollback

Hard gates are zero lost saved text, duplicate canonical captures, silent
identity merge, raw text in logs, or false synced/confirmed presentation.
Rollout begins with synthetic text only. The feature flag can disable upload
while preserving recoverable local commands.

## Open decisions and falsifiers

Production storage region, retention defaults, and device encryption policy
remain unresolved. Real-source rollout is blocked until those decisions are
recorded; synthetic implementation and tests may continue.

## Implementation checkpoint — 2026-08-24

The synthetic text slice is implemented end to end. A recruiter can save exact
text locally before any network write, relaunch into the same durable command,
explicitly bind Person and Pursuit scope, retry the same idempotent command,
stage an evidence-backed Proposal without mutating the Pursuit, and complete a
governed server deletion before local payload removal.

Observable proof:

- [runtime evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-08-24-v1-prd-02/text-signal-runtime.json)
  records the canonical capture, Proposal, identity, evidence, and deletion
  readbacks;
- [saved-local](https://github.com/getyak/capir-evals/blob/main/evidence/2026-08-24-v1-prd-02/ios-text-signal-saved-local.png),
  [Proposal readback](https://github.com/getyak/capir-evals/blob/main/evidence/2026-08-24-v1-prd-02/ios-text-signal-proposal-readback.png),
  [offline recovery](https://github.com/getyak/capir-evals/blob/main/evidence/2026-08-24-v1-prd-02/ios-text-signal-offline-recovery.png),
  and [deletion receipt](https://github.com/getyak/capir-evals/blob/main/evidence/2026-08-24-v1-prd-02/ios-text-signal-deletion-receipt.png)
  preserve the tested Simulator surfaces;
- the full iPhone 17 Pro gate passed its Release build, 41 Swift tests, and 19
  UI tests with zero failures and one documented legacy-fixture skip;
- the recycled-identity runtime evaluator blocked historical ownership,
  required an explicit current-owner choice, removed authority with the
  deleted source, and returned no cross-account results.

Truth boundary: local persistence is not sync; timeout is not success;
candidate-attributed text remains reviewed evidence; the derived milestone is
an inference in a `needs_review` Proposal; and the canonical Pursuit remains
unchanged until PRD-04 review applies a revisioned decision.

The slice remains synthetic-only. Real-source rollout is still blocked on the
production storage region, retention defaults, authenticated non-loopback
transport, and physical-device file-protection proof. Same-name and revoked
authorization handling is not yet exercised as a full-stack Text Signal UI
journey, and the legacy port-8787 localhost-sync test is not self-contained.
