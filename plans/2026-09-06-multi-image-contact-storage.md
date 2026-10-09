# Multi-image conversation intake and source storage

## Outcome and boundary

Send up to ten ordered screenshots through Web and iOS as one contact task,
remove routine explanatory notices, and persist original task inputs in the
existing private S3-compatible storage boundary. Preserve legacy single-image
requests, task idempotency, source provenance, scoped access, and deletion.
No candidate-facing effects or new cloud bucket are requested. The follow-up
explicitly authorizes PR merge and TestFlight publication. Existing unrelated
uncommitted work is preserved in the original development directory.

## Evidence and direction

The iOS picker already accepts ten images but unscoped routing rejects batches.
The contact-agent Web UI, API, and extraction runner accept one image only and
discard its bytes. The backend already implements local and private encrypted
S3 object storage. Reuse that adapter, store ordered manifests outside model
state, checkpoint per-image extraction, and recover from stored sources.
Never silently merge differing visible contact identities or discard images.

## Milestones

1. Complete: bounded request contract, durable object lifecycle, extraction and
   message-to-image provenance, retry and deletion tests.
2. Complete: Web multi-selection/preview/removal and native multi-image Send;
   quiet routine states, actionable errors, source inspection.
3. Complete: focused tests, browser/native verification, local backend redeploy,
   concise canonical documentation and handoff of actual proof/limitations.

## Completion evidence

Database-backed batch/replay/recovery/access/expiry tests; storage failure and
S3 adapter checks; rendered Web upload/send/readback; native build and routing
checks; backend/Web typechecks and targeted lint; documentation check; deployed
backend health and source verification. Live S3 is claimed only if a configured
bucket is exercised; local storage proof is labeled separately.

## Completion

The [evaluation record](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-multi-image-contact/README.md)
contains browser, provider, database, native-test, and deployment evidence.
The real two-image task recovered from provider 429 using stored originals,
then reused the contact and stored six source-linked messages. Ten-image
encoding and limits passed deterministic checks. The original source endpoints
returned hash-matching bytes. The local backend is deployed; live S3 remains
unconfigured and no new native TestFlight binary was published. These are
environment/release boundaries, not claims of completed cloud/native rollout.
The broader secret-inventory scan has pre-existing ownership gaps, recorded in
the evaluation; all required in-scope checks and the production Web build pass.

## Authorized release follow-up — complete

The subsequent request explicitly authorized update, PR merge, and TestFlight
publication. [PR #140](https://github.com/getyak/talent-signal/pull/140) merged
after required CI and Security passed, including the Release build, 459 native
unit tests, and nine UI smoke journeys. The release branch retained newer main
behavior and proposed-source authority while preserving the original dirty
workspace. Merged-tree equality with the tested PR was verified.

The deployed backend matches the integrated revision and passed health, auth,
voice/chat, and HTTPS probes. An explicit main-only release dispatch retained
the normal signing, upload, attestation, and independent processing gates.
TestFlight `0.1.59 (20260906062355)` is processed, and a read-only audit confirms
that exact build is valid and available to the configured internal testing
group. No invitations or tester relationships were changed.

The [integrated release record](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-multi-image-contact/release.md)
owns the CI proof, deployed source hashes, Apple receipt, and access readback.
Live S3 remains unconfigured; the private local adapter is deployed. This is a
remaining environment boundary, not a claim of live S3 or device installation.
