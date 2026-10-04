# Opik-managed product prompts

> Historical implementation evidence. The owner has superseded live prompt
> retrieval with [bundled source releases](../docs/operations/opik-prompts.md).

## Outcome

The owner can edit and version product prompts in Opik and publish a selected
version to the running application without rebuilding it. Main conversation
guidance supports natural, general conversation. Preserve unrelated work.

## Scope and decisions

Opik owns editable server prompt text. The application owns tool capabilities,
output schemas, authorization and source validation. Use the existing tested
Opik 2.2.45 interface, an explicit production environment, bounded retrieval,
cached published text and bundled fallback. A running request keeps one prompt
snapshot; Lab comparisons must not silently change templates mid-trial.

The previous local Opik test stack was removed; its source and images remain.
Create a persistent owner-local instance with a loopback UI and durable volumes.
Only prompt templates and synthetic verification material enter this instance.
Native offline prompts remain packaged with iOS; no app binary release is part
of this server integration. No new vendor account, public ingress or raw private
conversation tracing is introduced.

## Milestones

1. Complete: persistent Opik 2.2.45 is running with ten published prompts,
   durable volumes, pinned images and a loopback owner UI.
2. Complete: server consumers resolve published prompt snapshots; contact and
   Pursuit tasks and Lab comparisons retain reproducible versions.
3. Complete: actual UI editing, real model dispatch, publication and rollback
   were verified. TestFlight API and Agent Host are deployed; the owner workflow
   is documented in [operations](../docs/operations/opik-prompts.md).

## Completion evidence

The [verification report](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-opik-prompts/README.md)
contains the actual UI, ten-version receipt, GLM-5.3 synthetic response,
production rollback and live deployment readbacks. All production bindings are
back on their intended v1. Focused suites pass 160 tests; builds, type checks,
changed Web lint, eight wiki tests and documentation checks pass.

The broader Infisical inventory test still reports twelve pre-existing undeclared
names; the four registry settings are registered. Docker Hub metadata failed, so
the verified unchanged dependencies were reused for a source rebuild before the
original deployment script completed. The disposable test database was removed.

Review confirmed that runtime retrieval sends configuration identifiers only,
preserves host authorization and schemas, and keeps bounded cache/fallback
behavior. Editing and rollback are visible in Opik. Native offline prompts remain
packaged with iOS; Web source is integrated, but this deployment covers the API
and Agent Host. Playground model connections and Python workers are not enabled.
