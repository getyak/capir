# GET-263: one current execution owner

## Outcome and boundary

The conversation header owns the current observed status and the only visible
Stop. Execution history remains an inline, collapsed disclosure with timing,
verification boundaries, errors and recovery. Stop must target the current
account/session/run; inspecting history cannot cancel a replacement run.

Preserve GET-251 workspace composition, GET-264 evidence and attachments, and
GET-266 governed review-card wording. No native, provider, data or approval
contract changes. One issue, one canonical PR.

## Baseline and resources

- Canonical workspace: `/Users/cubxxw/ops/symphony/runtime/workspaces/GET-263`.
- Clean branch `codex/get-263-working-stop`, fresh `origin/main`:
  `525bb5fb4a3f98690076c40d4b6da650d21a4f20` (GET-266 / PR #456).
- Existing GET-263 PR lookup returned none. Linear reads In Progress.
- Pause marker absent. Initial resources: 30.61 GiB free, 18.13 GiB swap,
  283 Node/npm processes. Recheck before builds. No other task cleanup.
- No services, browsers, simulators or MCP processes started by this task.
- Linear field-notes tool returned unavailable; issue read works.

## Approach

Keep the current observed-task provider as the single projection. Put Stop
beside its header status and remove duplicate composer/detail Stop. Replace
the current live execution summary with a neutral detail label; retain terminal
states. Remove redundant active footer status while preserving connection and
unavailable recovery. Consume Escape within inspected execution records,
including historical records whose disclosure is already closed.

Rejected: deleting status strings without tracing ownership; floating status
panels; moving all errors/decisions into optional details.

## Milestones

1. Completed: three new tests reproduced the ownership bugs, then passed;
   conversation tests (368), lint and Web types passed.
2. Active: host checks and a 14-case actual-component geometry fixture pass.
   Complete full-product rendered desktop/narrow checks
   including keyboard, reduced motion, task/session switches and recovery.
3. Independent native subagent review; fix confirmed P0/P1 and bind closure
   to the current head. Create/reuse one PR, link to Linear, wait for current
   head CI, merge normally and read back.
4. Deploy affected resident Web from clean committed source; verify exact
   revision and changed behavior in the authorized isolated account space.
   Only then set/read back Linear Done. Record resource/permission blockers
   separately and retain In Progress if acceptance remains incomplete.

## Proof

Keep sanitized evidence in `docs/verification/get-263/`. Distinguish host tests,
browser fixtures, real-account acceptance, review, CI, merge and deployment.
Never report a green layer as proof of an unverified layer. Preserve source
and unique evidence while incomplete; reclaim only this task's rebuildable
artifacts after formal evidence is saved. Record the original Symphony
generation/thread result through `project_sessions.py event` at handoff.

## Evidence updates

- The repository hygiene gate rejected raw `.log` files; logs were preserved
  privately and removed from the tracked tree. The 21 policy tests pass.
- Geometry reproduced a 0px status label at 601px before the responsive fix.
  Root-relative layout now passes 14 ordinary/200% text-size combinations;
  this fixture does not replace authenticated runtime acceptance.
