# GET-275: complete bounded MCP discovery

## Outcome and boundary

An ordinary workspace Run can discover every admitted tool in a verified
connection, retrieve a structurally intact bounded schema, and distinguish
partial coverage from absence. Remote metadata remains untrusted. Every remote
call keeps exact single-use approval; no providers, accounts or paid capabilities
are added.

## Baseline and remaining gaps

Fresh origin/main is `0f6fe610466de2a14f089dea7675b7a222abe018`.
GET-234 already supplies capability guidance, the curated four-service directory,
host snapshots, account/tool pagination and read_tool. Do not duplicate them.
Inspection found connect still silently cuts at 30 tools, read_tool rewrites
schema property names containing token/secret into strings, and image/JSON eager
context is intentional but absent from the Run's model-visible context.
Handshake pagination also needs regression evidence for tools beyond 30 and
invalid continuation metadata, rather than assuming a successful first page.

## Milestones

1. Complete: add failing regressions, then fix coverage and schema projection;
   make the intentional tool-context policy observable without broadening it.
2. Active: run affected host tests/typechecks and documentation checks; independent
   review, then address findings. Reuse one canonical GET-275 PR.
3. Refresh main, verify current-head applicable CI and ordinary merge. Deploy
   affected resident services from clean committed source with ownership and
   capacity checks, verify revision and behavior, then update/read back Linear.

## Verification

- A >30-tool paginated server retains and exposes the last tool and >4k schema.
- Connect/list coverage identifies the next page; account fencing stays intact.
- Schema structure/required/refs survive, secret-bearing annotations are redacted,
  and invalid or unavailable schemas fail explicitly.
- Text uses bounded discovery; image/JSON explicitly advertise intentional eager
  loading. Subagent bounded admission remains rejected.
- Exact-call approval, stale schema checks and no automatic retry stay intact.
- Keep local tests, CI, merge, deployment and actual acceptance evidence distinct.

## Resources and delivery evidence

No global pause marker at start. Host free disk 81 GiB; Docker data filesystem
has about 12 GiB available, which requires a separate reserve check before any
image build/import. Registered temporary artifacts:
`/private/tmp/ai-test-GET-275.mDG4NV`. Only this task's resources may be closed.

## Verification progress

- Red: 11 backend and 3 provider regressions reproduced before the fixes.
- Host backend CI script passed: contracts/Agent/evaluation/backend typechecks and
  builds, Agent 596 passing tests, backend 1,382 passing tests. Database-dependent
  and explicit opt-in tests remain separately classified, not counted as passing.
- Isolated PostgreSQL plus real MCP HTTP: 139 passing tests across discovery,
  persistence, exact-call approval and queued conversation continuation.
- Independent review exposed schema graph/redaction edge cases; all findings
  were fixed with counterexamples. Final read-only re-review found no remaining
  actionable issue. The last nested-data change has 22 passing adapter tests.
- `pnpm --config.verify-deps-before-run=false docs:check` passed. The option
  prevents pnpm11 from implicitly installing unrelated Web packages after an
  explicit filtered frozen install; all normal documentation gates still ran.
- Local pinned SDK native binary reused from an existing install at version
  0.3.310; SHA256 matches another existing install. No manifest/lockfile changes.
- No resident deployment or Linear completion claimed yet.
