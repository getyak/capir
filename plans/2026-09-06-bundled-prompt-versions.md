# Bundled prompts with Opik version mirroring

## Outcome and boundary

Formal prompts ship with the application and load locally. Opik remains an
owner-operated version library and experiment surface. Prompt changes take
effect through source review, build and deployment. No startup or request may
require Opik, even if old registry environment settings remain configured.

Keep current prompt wording and unrelated changes. Preserve frozen historical
tasks and Lab snapshots; do not enable new model tracing or Playground accounts.

## Decisions

Use one source file per prompt, a static catalogue and immutable local snapshots.
Remove remote retrieval rather than retain a second runtime mode. Explicit CLI
sync mirrors source versions; importing a selected Opik version changes only its
source file and produces a reviewable diff. Version receipts link exact content
hashes to Git state and Opik version IDs. Existing Opik publications no longer
control running services.

## Milestones

1. Complete: replace dynamic runtime loading with bundled source snapshots and
   remove application Opik connection settings/network dependencies.
2. Complete: implement and verify explicit source sync and draft import with
   exact version receipts and no silent overwrites of unrelated work.
3. Complete: run focused tests, update authoritative operations and decisions,
   rebuild and deploy the local TestFlight backend, and prove offline startup
   and actual model dispatch.

## Proof

Verify all current source texts retain their hashes. Exercise hostile string
escaping, rejected incompatible versions, source/import idempotency and version
readback. Test no network access even with an unreachable registry configured.
Verify deployed source identity, new local prompt snapshots, health and real
provider probes. Record results in the existing Opik evaluation evidence folder.

## Completion evidence

[Verification](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-opik-prompts/bundled-runtime.md)
contains version mirrors, exact import/restore receipts, 335 matching deployed
source/compiled files and an isolated runtime loading all prompts with zero
network calls. The original TestFlight deployment passed real model, voice,
authentication and HTTPS probes. Opik is healthy and its obsolete shared network
was removed; the application uses only its own network.

Focused suites passed 57 Agent, 71 backend/Lab, 12 Web and five CLI tests; eight
wiki tests, compilation, type and documentation/architecture checks passed.
The checked wrapper commands work against the actual library.

Docker Hub metadata failed and the Docker compiler was OOM-killed. Verified
unchanged dependencies were reused after successful host compilation, then the
image was deployed with the original script. Opik reported ClickHouse connection-pool
timeouts during network cleanup; restarting its backend restored health
without changing persistent data. The failed build container was removed.
Rollback images and local `/tmp/ts-bundled-*` proof/build artifacts are retained;
no application credentials or candidate data were copied into them.

Review confirms one formal source, explicit draft import, historical snapshot
compatibility, no remote runtime override, exact content provenance and unchanged
tool/evidence/authorization boundaries. Current ownership is recorded in the
Agent system document, operations and ADR 0013; earlier live-registry evidence is
marked historical. No unrelated source changes were reverted.
