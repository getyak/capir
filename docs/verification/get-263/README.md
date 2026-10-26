# GET-263: current status and Stop ownership

## Verified implementation boundary

The current observed task owns a header status and its only Stop button. The
composer and execution disclosure no longer add another Stop. The current
live execution summary is a neutral collapsed task record; its timing, draft,
verification boundary and recovery remain available in the transcript.
Completed, stopped, failed and governed review states retain their existing
presentation. GET-266 review wording and GET-264 source/attachment paths are
unchanged.

Stop remains bound to the observed account/session owner and task key. A live
queue slot retains Stop when persisted history arrives before queue cleanup.
Escape within either an open or closed historical execution record never
falls through to the current run's canvas shortcut. Mutation-in-flight also
blocks a duplicate canvas Stop.

## Host evidence

Baseline: fresh `origin/main` at
`525bb5fb4a3f98690076c40d4b6da650d21a4f20`.

| Check | Observed result |
| --- | --- |
| New regression tests before implementation | 3 expected failures: duplicate Stop, historical Escape stops replacement run, missing header owner during early history readback |
| Focused execution/observation checks | 78 tests passed across 4 files |
| Entire conversation test directory | 368 tests passed across 32 files |
| Changed TS/TSX ESLint | Passed |
| Web TypeScript | Passed after contract/Agent/workspace UI builds |
| `pnpm docs:check` | Passed |
| Independent native review of working diff | No confirmed P0/P1; exact commit binding pending |

Two adjacent legacy tests initially required duplicate transcript processing
status. They were updated to assert the real header stage and absence of a
second inline live status; the complete 368-test run then passed. These were
expectation changes for the requested ownership change, not suppressed errors.

## Resource and account boundary

No pause marker was present. Initial resources were 30.61 GiB free, 18.13 GiB
swap and 283 Node/npm processes. Dependencies were prepared by copy-on-write
from an existing exact-lockfile workspace, without modifying its source or
dependency tree. A sample dropped to 29.55 GiB before tests/builds started;
checks paused. A fresh sample recovered above 30 GiB before narrow host checks.
Later free space was 32.35 GiB. No task cleanup caused that recovery and no
reclaimed-space credit is claimed. No iOS Simulator was started or used.

The existing staging CLI grant read back active for `test@cubxxw.com`, with
test-create/status/stop scopes. No new grant, entitlement, provider or account
fallback was added. This is authorization preflight, not product acceptance.

## Remaining delivery evidence

Browser render proof must cover desktop, 601–850px, narrow viewport, 200% text,
reduced motion, running/stopping/failed/history, keyboard focus and owner/task
switches. In particular, verify that the symmetric header tracks leave status
text readable beside Stop before calling layout accepted.

Exact-head review, the canonical PR and current-head CI, actual merge, clean
resident Web deployment revision, real-account isolated-space acceptance and
test-space cleanup are separate gates. None is established by the host results
above. Linear remains In Progress until all required acceptance is verified.

Raw host logs are retained in private `.symphony/evidence/host/`, outside the
tracked tree as required by repository hygiene. The task's private
`.symphony/evidence/` records delivery readbacks; credentials
and browser storage remain only in the registered temporary artifact and are
excluded from this document and Git.
