# GET-135: image conversation limits and failure reasons

## Outcome and scope

Raise the admitted image conversation cumulative allowance to 100,000,000
(tokens across SDK responses, including cached context), and the default Claude
conversation wall-clock deadline to 30 minutes. Preserve token exhaustion
through execution, queue persistence/readback, diagnostics and failed-message
recovery. Keep ordinary text/MCP-only token budgets and turn/tool/dollar limits,
source expiry, cancellation and authorization unchanged.

The historical Memory rejection reason is unknown. This change does not infer
it, replay the user's original task, widen evidence access, or raise a single
context/output window. Only safe synthetic acceptance inputs are used.

## Evidence and approach

Baseline: `a8bc5bec4015d9aa42a44274434fb80ac24edf30` from remote main.
The source workspace contains unrelated native and Web changes; this task owns
an isolated `codex/get-135-conversation-budget` branch/worktree.

The issue establishes token exhaustion after repeated tool rounds and loss of
its reason to `MODEL_RUN_FAILED`. Queue heartbeats renew the lease independently
of model duration and continue to enforce cancellation/source validity.
TestFlight Compose separately supplied a three-minute timeout default; it must
change together with the backend default. No explicit staging timeout override
was configured when read back.

Pi task `20261005-211344-5ffd13d6` used the frozen baseline with MiMo Pro. After
inspection, a narrower feedback checkpoint still produced no patch, so it was
cancelled without source changes and the parent implemented this bounded fix.
Private worker logs remain local and are not product evidence.

The real queue regression uses a migrated, disposable local PostgreSQL database,
not the deployed candidate database. The named `get135-proof` capir test run
owns deployed authentication acceptance and must be stopped after readback.

## Milestones and acceptance

1. Complete: implementation and canonical operational limits updated.
2. Complete: 75 focused backend tests, 61 PostgreSQL queue/stream tests,
   4 Web tests (including rendered recovery), 7 deploy-validator tests, backend
   and Web typechecks, docs/architecture checks. Default thirty-minute
   fake-clock boundary, exact retained image/retry and historical budget passed.
3. Active: independent sub-agent review; resolve all confirmed P0/P1.
4. Pending: associated PR, latest-head CI/security gates, normal protected merge.
5. Pending: clean detached backend/Web deployment, runtime deadline/revision
   readback, authenticated isolated workspace acceptance and exact cleanup.

Record final CI, merge and deployment receipts on
[GET-135](https://linear.app/getyak/issue/GET-135) before marking it Done.
Implementation, a model response or a pending auto-merge is not completion.
