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
3. Complete: [PR #304](https://github.com/getyak/capir/pull/304) merged as
   `0ac4d89021b7af8ae60a4d1ab1f1801f64321321`. Every applicable CI, security
   and Vercel gate passed on final head `1c1ffaf1` (CI run `37574117529`,
   Security run `37574117495`). MiMo's single PR-review invocation timed out
   at 1,800 seconds without a validated report; it was neither published nor
   retried. Independent review passed. Web Crypto timing counterexamples in
   two MCP test suites received bounded waits with their original assertions;
   product code did not change. Targeted MCP tests passed 23 tests, main Web
   passed 1,878, and the actual prepared resident Web passed 1,897 tests.
4. Complete: API and Agent Host run clean committed backend release
   `3d95200cdf05293755098ab4831ec3fb5211d6c6`; Web runs clean committed release
   `b266e22c688e0adc7e375b7147694f9a9db9f3d8` with build ID
   `3aIjEV5vhcYNm9zc8KARk`. Both preserve their approved resident parents.
   Opik configuration was deployed, and running ClickHouse reads back
   `warning / 10M / 3`. The frozen runtime policy hash remains unchanged.
   Recovery image/revision and backend-current pointer were persisted together;
   the backend keeper and Web restart receipts passed. Exactly 22 proven-dead
   container locks were recovered with the reviewed operator helper.
5. Complete: synthetic terminal deletion passed five flushes, two delete calls
   and reconstructed outbox with zero extra network requests; tombstones and
   attempt counts remain intact, late enqueue is blocked, and local content
   is purged. The concrete orphan transport proved trace 404 / span 200 before
   cleanup and both 404 afterward. Authenticated synthetic Web workspace passed
   before and after Web/API restarts; the owned test space is deleted with
   readback. All 131 traces and 421 known spans at the two frozen project
   targets returned HTTP 404 (552 total, zero unknown/mismatched targets).
   Three samples over 63.963 seconds cover two background intervals: all 131
   terminal receipts retain identical attempts and update times; pending,
   errors and locks are zero. Historical max attempts stays 103,387 and total
   attempts stays 2,688,758. API, Agent Host, Opik and ClickHouse remained
   running with no OOM flags; ClickHouse CPU samples were 5.37%, 4.71%, 3.11%,
   and server log directory growth was 8 KiB. These bounded observations do
   not establish long-term load or resolve host swap, Infisical or Nango health.
   Private aggregate evidence is retained under
   `~/.local/state/talent-signal-get-138/2026-10-07/`; generated credentials were
   excluded. The registered temporary artifact was removed, no simulators
   were started or deleted, and unrelated artifacts were preserved. Final
   documentation delivery and Linear closure use the verified core merge and
   runtime acceptance receipts.

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
source-specific verification. Both active release revisions were read back
after activation and controlled restarts.

## Acceptance deviations

The first canonical Relationship Ask probe failed with an unsupported result
(missing required synthetic citation). A diagnostic rerun using the same input
and unmodified acceptance gate passed with the required citation; the initial
failure remains classified in private evidence. No model gate was relaxed.

After deployment, eight pending records remained in the canonical
`deployment-probes` child root. Two scoped one-shot attempts did not perform
cleanup: the first had no stdin and yielded no operation; the second refused
pending/temporary/lock files before receipt scan or transport. API restart and
keeper restoration were followed by zero pending records. The exact cleanup
trigger was not logged, so completion is attributed to state and destination
readback, never to the unexecuted one-shot. The first remote audit correctly
rejected 45 receipts in the explicitly derived `-product-runs` project; a
reviewed exact two-project scope preserves their endpoint, workspace and
project targets. The complete two-project audit passed;
partial-project 404 results were not accepted as completion.
