# Conversation run diagnostics and execution deadline

## Outcome and boundary

Diagnose the image-send incident, preserve original bytes/base64 input, associate
background execution and LLM replies with product monitoring, and replace the
unexplained fixed 60-second Claude deadline with a configurable bounded budget.
No private screenshot replay, contact write, or unrelated workspace edits.

## Evidence and decision

See [incident evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-25-conversation-diagnostics/README.md)
and [operational contract](../docs/operations/product-feedback.md).
The failed run has no captured exception; exact historical cause cannot be
recovered. Queue admission/storage worked. Two synthetic live provider probes
passed in about 19 seconds. Keep durable queue semantics and one total deadline;
use 180 seconds provisionally, with stage/usage telemetry for later tuning.

## Milestones

1. Complete: incident readback, deployed chain audit and synthetic provider probes.
2. Complete: safe per-attempt capture, canonical reply correlation, persistence-only
   replay identity, failure metadata lifecycle, configurable deadline and validation.
3. Complete: 110 targeted tests including disposable PostgreSQL integration, backend
   typecheck, docs/architecture checks and independent review.
4. Active: push final revision, check its CI, deliver internal runtime and verify
   real synthetic queue run plus local monitor/Opik destination.

## Review and validation

Independent reviewer checked deadline/cancellation and capture source boundaries.
Closed findings: late provider completion after abort; shared image/Claude budget
regression; failed metadata cleanup; SDK session ID naming; false binding log.
No outstanding P0/P1. Tests cover retry attempts, persistence-only replay, source
revocation, diagnostic outages and failed metadata retention/expiry.
A replay can restore canonical output, not missing original SDK spans.

## Operational state

Worktree: `/Users/cubxxw/data/talent-signal-image-queue-diagnostics`.
PR: https://github.com/getyak/talent-signal/pull/250 (draft).
The affected account was added to the existing Infisical staging backend Opik
policy. Runtime reload/readback remains pending. Existing synthetic Opik transport
probe confirmed write, destination readback and deletion readback with zero models.
An isolated disposable local PostgreSQL container owns test data; remove it after
delivery and preserve concise evidence before removing registered test artifacts.
Pi delegation produced no source edits after a bounded attempt; parent took over.

## Deployment follow-through

Revision `27d30e5a` is healthy in the internal API; the affected account policy
and 180000 ms deadline are loaded. Synthetic font-free image admission took
35 ms and completion 13.51 s. Original byte hash matched, the canonical answer
and both Ark/Claude LLM spans were visible through the authenticated monitor API.
Opik trace `b9a0e855-c2a5-7710-ab37-487050691f98` returned HTTP 200 with the same
product run `d75e0348-4f6d-4788-b7ab-18b1c915195d` and expected synthetic answer.
The probe's first receipt selector used native run identity instead of projection
source identity; independent destination readback corrected the test harness.

Deployment exposed old deletion tombstones whose full policy digest changed
when account scope expanded. Preserve exact destination checks, but permit
existing same-target deletion receipts to finish their cleanup obligation.
29 observation tests pass; independent review confirms orphan tombstones and
old pending content remain strict. Final image and post-cleanup readback pending.
