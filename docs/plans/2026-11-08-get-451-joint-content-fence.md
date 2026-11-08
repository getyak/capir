# GET451 joint content reader: first Review slice

Base: `a827c99d7a727a9521c97c35117077ce29ea3638` (depends on PR535 fixed-clock exports).

Outcome: after all preparation/transaction ACK/readback, deliver already encoded
Memory bytes only after one autocommit statement requalifies actual header,
serving/audience and the whole real domain at one current tick. No caller SQL or
manufactured grant; preserve all legacy GET448 output, SQL and parameters.

- Active: freeze test-only Review regression source for independent review and
  exact-head Hosted availability first-red. No local Node/TSC/test/PG/server/build.
- Next: implement additive `memoryContentReadEnvelope.ts`, closed
  `memoryContentFinalFence.ts` and authority re-export. Extract only the existing
  `memoryReviewRead.ts` passed-client read core, retain its Pool/inTransaction
  wrapper, add real-row/credential/source `prepareMemoryReviewContent` owner.
- Then: exact-head Hosted semantic red/green, including real HTTP source/stage/
  open controls, original bytes, one client, audience/header/domain withdrawal,
  pending TTL across transaction-start and actual COMMIT/final-query ACK windows.
- Required subsequent slices (not dropped): Accepted retained-entry/evidence and
  Operation/receipt/recovery fences, whole literal role integrity, all five
  accepted-plan regression groups, real Lab serving, HTTP/Agent aliases/wiring.

Tests use an owned disposable loopback `lab_regression_ci`, synthetic password
login and actual Session PUT/proposal stage/open; no paid provider, fake auth or
fabricated accepted evidence. Proxy faults delay only acknowledged real queries,
never synthesize rows, deadline, permission, commit result or successful fence.
Missing APIs are explicit availability reds; no source result is claimed here.

Source handoff and immutable manifests are in the GET439 OPS run under
`get451-joint-reader-first-tests-*`. Production routes remain unchanged and no
full literal-wire or resident deployment acceptance follows from this slice.
