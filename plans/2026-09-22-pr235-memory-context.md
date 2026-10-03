# PR 235: grounded memory context

## Outcome and boundary

Make accepted private self memory and verified assistant response preferences
available before a workspace Agent answers, while preserving source, time,
conflict, owner scope, and invalidation. Update existing PR 235, not a new PR.
This implements the context-loading slice of the three-layer design: L1 indexing,
dreaming, new retention policy, and automatic research remain future work.
Existing review/commit/undo semantics remain authoritative.

## Evidence and approach

- Baseline: PR head e6b9dcf3757e6afca888b4395e69bc579f96a923.
- Workspace recall currently loses speaker, time, conflicts and evidence.
- Self memory and typed response preference depend on optional model tool calls.
- The existing preference store is user-owned and revisioned; reuse it rather
  than infer service instructions from self-memory prose.
- Root checkout contains unrelated user work; implementation is isolated here.
- Use bounded host-compiled data with explicit coverage, retain read-on-demand,
  and validate loaded versions and source availability before accepting a reply.
- Never promote recalled text to instruction authority or real citation IDs.

## Milestones

1. Complete: implement common grounded memory projection, self bootstrap and
   verified preference injection, with lifecycle guards.
2. Complete: synthetic database and provider-wire tests for no-tool responses,
   ownership, business isolation, overflow, correction and source revocation.
3. Code, diff review and final documentation checks complete; publish this
   follow-up on PR 235 and preserve its draft acceptance boundary.
   Local TestFlight redeployment was attempted but is blocked by the missing
   Infisical CLI; deployment remains outstanding.

## Completion evidence

Focused tests plus Agent/backend builds and documentation checks. Use a
dedicated synthetic PostgreSQL database. Preserve incomplete paid-model
acceptance already recorded in PR 235; no release/merge or paid rerun implied.
Backend AGENTS.md requires local TestFlight redeployment; report any concrete
environment blocker without presenting deployment as successful.

## Observed results

Agent: 296 passed, 1 skipped. Focused backend suites: 141 passed. Backend build,
Agent/Web typechecks, and documentation/architecture checks passed.
See [the follow-up report](https://github.com/getyak/capir-evals/blob/main/evidence/get40/memory-context-followup.md)
for scope, reproduction and limits. Existing iOS CI failed on an unrelated
accessibility-audit timeout. No paid-model rerun, merge or production deployment.
