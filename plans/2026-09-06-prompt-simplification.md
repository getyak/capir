# Prompt simplification and useful autonomy

> Historical implementation evidence. The owner has superseded live prompt
> retrieval with [bundled source releases](../docs/operations/opik-prompts.md).

Follow-up: the owner subsequently requested human editing in Opik. The
[Opik integration](2026-09-06-opik-prompt-management.md) supersedes this plan's
source-module-only management choice; its original measurement remains historical.

## Outcome and boundary

Make the current product prompts smaller, easier to maintain, and more useful:
answer supported portions, develop labeled interpretations and drafts, and use
authorized tools without unnecessary clarification. Preserve source integrity,
identity uncertainty, scoped access, and exact authorization for consequential
effects. The user explicitly requests implementation and comparison with good
projects, not only recommendations.

Work against the current working tree, preserving substantial existing edits.
Do not change model credentials, broaden data collection, remove runtime gates,
or expand tool capabilities as a side effect of prompt editing. Remote quality
checks use synthetic inputs only. Backend changes require the existing local
TestFlight deployment script before handoff (apps/backend/AGENTS.md).

## Evidence and approach

The previous source audit found repeated workspace instructions in the provider
adapter, premature clarification in relationship Ask, a large screenshot-filing
prompt, and task-specific instructions scattered through provider code. Native
JSON/tool contracts and host-side checks already own much of the protocol.
Prompt length alone is not evidence of model quality.

Research primary project sources, keep task boundaries distinct, consolidate
common language once, and move tool-specific operational guidance to its owning
tool description. Prefer a small source module over a prompt framework or
editable prompt database. Preserve necessary extraction details and runtime
contracts; avoid exchanging fewer characters for ambiguous authority.

## Milestones

1. Complete: inspect primary references, capture baseline prompts, and settle the
   minimal composition and behavior changes.
2. Complete: refactor prompts and retain output validation; add
   meaningful positive-autonomy and boundary regression coverage.
3. Complete: compare synthetic behavior, run focused checks, deploy and verify
   the local backend, and record measured results and remaining limitations.

## Completion evidence

- Source inventory and before/after rendered prompt character counts, including
  provider additions rather than only base constants.
- Regression evidence for partial answers, general advice, named-contact
  lookup, ambiguity, unsupported citations, unauthorized writes, and truthful
  completion where relevant.
- Type/build checks for affected packages, native checks if Swift changes,
  docs/wiki checks, scoped diff review, local TestFlight health and prompt
  readback after deployment.
- Synthetic model observations labeled separately from deterministic tests;
  no claim that a small trial proves general superiority.

## Progress

- Read the knowledge map, Agent System, plan/review contracts, backend and web
  local instructions, and evidence-safety, conventions, and knowledge skills.
- The reviewed research favors concise task guidance, clear tool interfaces,
  and observation-driven progress. Exact source records and implementation
  decisions will be linked with the final evidence.
- The core prompt module and shared terminal protocol replace inline task
  strings and repeated adapter rules. Tool-specific filing and proposal details
  have one tool-description owner. Web extraction shares a pure prompt subpath;
  screenshot prompt revision is v6. Native intent and proposal wording is aligned.
- Current initial checks: Agent 55 tests; backend 54 tests; Web 36 tests;
  backend build/typecheck and Web typecheck passed. Additional positive-autonomy
  tests are added and awaiting the final run. Live paired synthetic comparison
  is running against the admitted provider without database or tools.
- Native check.sh stopped before building because the existing workspace has
  213 raw SwiftUI literals against an allowance of 210. Prompt-only edits contain
  no UI literal additions. Run targeted native compilation/tests independently
  and report this unrelated full-script gate rather than changing its allowance.

## Completion

- [Evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-prompt-simplification/README.md)
  records the primary sources, all three paired trials, size measurements,
  deterministic/native results, and deployed prompt fingerprints.
- 235 relevant tests passed across Agent (55), backend (58), Web (36), isolated
  PostgreSQL (7), and native (79); Wiki tests (8) and documentation checks passed.
- Nine measured task templates are 35.8% shorter. Final paired model input is
  18.1% fewer tokens; the old fixed question cap is demonstrably removed. The
  new variant took longer in this small trial; no latency benefit is claimed.
- New model-output evidence justified a concise explicit source-status rule.
  The final trial attributes unconfirmed reports and uses draft placeholders.
- Docker Hub metadata timed out twice. Identical lockfile and dependency
  declarations justified an offline source rebuild over the prior immutable
  runtime image. The original deployment script then completed with image reuse;
  live readiness, remote probes, and exact prompt hashes passed.
- No runtime capability, data access, model parameters, or authorization gates
  were expanded. No private candidate material was used in testing. The temporary
  PostgreSQL container is removed after proof; native prompt changes are source
  changes for the next iOS release, not a published TestFlight binary.
