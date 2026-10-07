# GET-138: terminal runtime observation deletion

## Outcome and scope

Stop repeated network deletion for verified `deleted` receipts while preserving
anti-resurrection tombstones. Recover incomplete cleanup without misreporting
trace absence as child-span absence. Scope includes the durable runtime outbox,
focused regression tests, retry scheduling, pinned Opik transport, operational
lock recovery and ClickHouse logging. No candidate-content inspection, widened
observation policy, unrelated service cleanup or native simulator testing.

## Evidence and unknowns

- Linear GET-138 reports 742/785 requests from terminal records in 40 seconds.
- Fresh baseline: `56e1a9966313537abaf465405cf922e90972e866`.
- `flush()` processes every tombstone; `deleteRun()` reopens deleted receipts.
- The inspected native outbox has 20 deleted, 2 deletion-pending and 13 retained
  receipts. Four locks name container namespaces absent from `docker ps -a`.
  Recursive inspection confirms 103 deleted, 26 deletion-pending and 19 retained
  receipts; max attempts 103,140. Exactly 22 stale locks pass the recovery
  helper dry-run; live/current namespaces are preserved.
- Pinned Opik 2.2.45 individual span deletion returns 501. Explicit-project
  `POST traces/delete` emits a cascade even when the trace row is absent.
  A real synthetic orphan-child experiment passed: missing trace, existing
  span, explicit-project delete 204, then trace/span 404. No model calls.
- ClickHouse sampled CPU was 120.52%; one sample is not sustained-load proof.

## Approach and milestones

1. Complete: implement terminal receipts, persisted bounded retries and exact-project
   deletion; preserve lock fencing and frozen targets. Pi task
   `20261007-114539-f810dea5`, frozen provider `xiaomi-token-plan-cn`, model
   `mimo-v2.6-pro`. Private receipts live in the runner task directory.
2. Complete: independently inspect implementation and run a separate sub-agent
   review. All confirmed P0/P1 findings are closed.
   Checkpoint review found a P1 where malformed successful GET responses could
   falsely verify absence, and a P2 where slow failures expired retry delays.
   Require actual GET 404 and schedule from failure completion, then re-review.
   The operator helper's eight counterexamples run in the existing repository
   CI test glob; no native simulator scope is needed for this runtime fix.
   Integrated validation: 45 focused runtime tests, 44 CI guard tests, six
   backend consumer tests, Agent and Backend typechecks, Agent build,
   XML validation, repository hygiene and documentation checks passed.
   Pi's broader Agent suite passed 385 tests; the opt-in live test was skipped.
3. Active: [PR #304](https://github.com/getyak/capir/pull/304) is linked to GET-138.
   Independent review passed. MiMo's single PR-review invocation timed out at
   1,800 seconds without a validated report; it was neither published nor
   retried. The first Web CI run exposed microtask-only waiting before Web
   Crypto completed in MCP tests. Bounded waits preserve dispatch, secret
   clearing and request-identity assertions; no product logic changed. A second
   counterexample appeared in the directory test under the prepared resident
   suite and receives the same narrow correction. Verify every applicable gate
   on the final head, merge without bypass, and read back merge state.
4. Serialize resident updates with the backend keeper. Deploy affected API,
   Agent Host, Web and Opik configuration from clean committed source. Recover
   only exact locks whose Docker volume-writer namespace is proven inactive.
5. Verify synthetic normal deletion, orphan span recovery, repeated terminal
   flushes with zero network calls, retry/restart state and aggregate live queue
   progress across at least two background intervals. Record revision, counts,
   bounded load/log samples and real endpoint readiness. Close Linear only after
   acceptance and merge, with destination readback.

## Decisions and limits

Foreign namespace and lock age alone are insufficient proof for lock stealing.
Keep runtime lock behavior strict; operational recovery requires Docker writer
inventory and exact-owner fencing. Do not remove tombstones, raw evidence,
logs or unrelated containers to improve resource measurements. Infisical/Nango
resource observations are independent of this queue fix.

## Resident source preservation

The latest current Web (`86946270`, advanced from `c67e4ef9` during this task)
and backend (`6b9dbfaf`) contain independently
approved local changes not yet on remote main. Build service-specific clean
committed release descendants of those existing revisions with only the
GET-138 fix prepared before and activated after PR merge; retain their existing behavior. Do not
replace them with a main-only release that loses those changes. Record each
actual release revision and re-run its applicable checks before activation.
A pre-activation recheck detected the approved Web keyboard-choice update at
`86946270`; the prepared release was rebased onto it before rebuilding and
source-specific verification. Recheck both services again before activation.
