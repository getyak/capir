# Merge-time queue proof repair

The UI PR #274 passed every applicable latest-head gate and merged as
`a911bfcf19bbe863c751e4764e441a59cccec824`. Its main run
[37007639753](https://github.com/getyak/talent-signal/actions/runs/37007639753)
then timed out in the abort-ignoring provider cancellation integration test.
The CSS source is unchanged by this repair.

## Cause and bounded correction

An active claim can be observed before provider selection force-closes
unsupported steering intake. That real constructor path advances the queue's
optimistic revision. The test read its stop snapshot too early, then awaited
provider startup while keeping the old revision. A rejected stop could enter
cleanup while the deliberately uncooperative provider was still held. The
previous cleanup never released that provider, masking the original failure
as the 20-second test timeout.

The corrected fixture uses the real selector with a controlled gate to force
claim-before-selection timing. It waits for actual provider invocation before
reading the stop revision, explicitly proves the old revision is rejected,
and then exercises the ordinary stop mutation with the current revision.
Both held gates release before runner shutdown even if an assertion fails.
The timeout and stale-result assertions remain intact: cancellation is durable,
no late answer is persisted, the stopped turn is truthful, and stored result
remains null. No production code, retry policy or authority fence changes.

## Verification

- Both queue/stream host suites passed 59 tests with the selection/cleanup fix.
- The final stale-revision rejection assertion passed five targeted repetitions
  against the isolated local PostgreSQL database.
- Backend typecheck and diff validation passed.
- Independent re-review found no P0/P1/P2 and confirmed the stale-result assertions remain intact.
- Exact-head remote gates are recorded during delivery.

Private failure logs are kept out of the repository. The public failed job and
local safe test logs remain in the formal evaluation archive. GET-129 remains
In Progress while its resident/capir/native login acceptance is incomplete.
