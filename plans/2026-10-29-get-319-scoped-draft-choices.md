# GET-319 — Respect separate contact and Memory draft choices

## Outcome and boundary

A current authored Memory refusal must preserve a separately requested contact
review through an explicit, source-checked `contact_workspace` or
`memory_review` new-contact proposal with no Memory items. The host must not
infer permission to create a contact from prose, image intake, an empty tool
request, or the absence of a contact refusal. Unqualified no-action requests
still constrain all proposals. Preserve identity, current sources, account
scope, review, withdrawal, idempotency and external-action authorization.

## Current state

PR #483 merged as `584f75894212b37f8f0b224b76a9f910704d8c62` after its required
CI and Security passed. Before activation, further independent analysis found
that its positive request parser could promote status statements such as a
prepared contact draft into permission for a new host card. This follow-up
removes that parser and both automatic contact paths when Memory is declined.
The typed contact tool paths remain available and retain their source checks.

Current branch: `codex/get-319-explicit-contact-tools`, based on current merged
main `584f7589`. The source helper contains only refusal classification.

Actual residents remain on `1e6cc3e11c3b6a66792305ca571efd0d333a4068`, five roles
on image `sha256:2e95793d529f30f871be74514b494746f44a3a8f1f50a05f35c8261c86e5eb97`.
GET-316's owner has completed its release and is idle. No candidate activation
has happened in this follow-up.

## Proof and next gates

1. Completed: parent verified 8 expected failures through the actual governed
   host/tool seam before edits, then all 260 focused tests passed. Coverage
   includes Memory-only refusals, explicit typed contact proposals, empty tool
   calls, provider-only replies, current image defaults, quoted/formatted input,
   mixed effects and steering withdrawal.
2. Completed: independent evidence-safety review passed the final changed-file
   hashes relative to main584. Parent serializes type/docs checks, committing,
   PR creation, current CI/Security, merge and deployment.
3. Active: create a linked follow-up PR with the Linear English title. Keep
   GET-319 In Progress after any merge automation. Wait for required current
   commit CI and Security, and then the resulting main gates.
4. Prepare the final clean backend source/image only after the correction is
   committed and reviewed. Retain the suspended584 OCI download and its parts
   as superseded evidence; do not import or deploy that backend artifact.
5. The clean approved584 Web build includes GET-320 and is complete (BuildID
   `QSqXwwRZI3cS8Bkp-ZBnp`). This follow-up changes backend policy, tests and docs
   only. Reuse that Web build after independently verifying no Web/shared/
   contract/dependency delta and current source ownership. Bind the backend
   source/recovery pair separately to the final corrected backend revision.
6. Before activation, independently review the new parameterized adapter,
   exact source roles/config/networks/mounts, actual target image/native proof,
   115 required migration checksums plus preserved history, fresh three-DB
   backups, keeper/mutex, host minimum30GiB and independent Docker VM reserve.
   No data rollback, old occupied intent, stale role ID, global prune or
   unconditional keeper restoration is permitted.
7. After runtime activation, verify genuine manifests, readiness, dependencies,
   IPC and changed behavior. Unit/CI/model output does not complete acceptance.

## Acceptance authorization

The only authorized isolated run was stopped before expiry and read back as
`deleted`, with no cleanup error and its credential removed. Its image request
completed without a contact proposal; no contact confirmation or Memory
request/save was performed. The private controller and credential directory
were removed. No second account/image is authorized. Further isolated real
contact/Memory, cross-window, subscription-restart and native acceptance remains
incomplete and needs a new scoped human authorization after delivery is ready.

## Ownership and evidence

Parent owns this branch, serial verification, PR/CI/merge and all runtime writes.
Independent reviewers are read-only. The deployment worker owns only its draft
adapter directory and cannot execute it. Preserve concurrent work and current/
rollback services, data, sources and images.

Private evidence and current checkpoint:
`/Users/cubxxw/.codex/visualizations/2026/10/28/01a18337-fc2e-79e0-8deb-d92f1f7eae3d/video-review/`.
Registered test output: `/private/tmp/ai-test-get-319-scoped-drafts.TLE3j9/`.
No original video, real conversation, credential or raw request body is published.
