# Wait for Memory proposal commits before HTTP success

Linear: [GET-457](https://linear.app/getyak/issue/GET-457), child of GET-455.

## Outcome and scope

Fresh proposal and idempotent replay HTTP success must follow the normal
transaction COMMIT/ACK. Preserve the original status, body, header behavior,
authentication, SQL and idempotency. This does not add a retry, new Memory
protocol, C03 migration, provider, source authority or schema change.

## Evidence and active milestone

Main e179d00d and C03 0ab216d4 have byte-identical stage route code. Independent
source review found both reply.send paths inside the transaction callback;
Fastify's Reply thenable resolves after response completion, before the helper
can dispatch COMMIT. The original C03 Hosted StageACK experiment actually failed
both fresh/replay cases: while the real target driver COMMIT was paused before
dispatch, independent PostgreSQL visibility remained fresh0/0 or replay1/1 and
HTTP success had already settled. This establishes early HTTP response; it does
not prove the cause of two separate review404 observations in other suites.
The operational source audit and exact old-run evidence are retained in the
code-sync run directory.

The active repair returns plain body/status/header facts from the callback and
sends only after the transaction returns. A Main-only fixture uses normal
password login, actual Chat/Session/proposal/review HTTP and an answer-only
synthetic provider. Only account/password setup is SQL. It imports no C03
fixture or unreleased114/115 migration. Fresh/replay tests preserve the original
15-second budgets and use the same real-driver pre-COMMIT barrier and independent
visibility checks. A required serialized PostgreSQL selector still executes
unless the job was cancelled; it does not make any earlier failed gate green.

## Completion evidence

1. Independent review and applicable current-head Hosted checks, including both
   real PostgreSQL commit-order cases and unchanged original regressions.
2. Normal matched-head Main merge and post-merge checks; preserve failed first
   attempts and distinguish configured skips from executed cases.
3. Deploy affected existing resident backend through the normal clean-source
   path, then verify revision and changed HTTP behavior. Original Infisical
   reauthentication is pending; source merge alone cannot close this issue.

No local Node/PG/Swift/Simulator tests or dependency installation were run for
this source batch. The immutable e179 post-merge Hosted baseline is already
verified; the new head still needs its own actual checks and resident readback.
