# GET-452 — Keep complete directory queries across Web and MCP

Status: In progress. Linear [GET-452](https://linear.app/getyak/issue/GET-452).
Parent GET-439; remaining-intent candidate C16. First milestone only: regression
test source prepared; no local execution and no observed Hosted red yet.

## Outcome and boundary

An admitted directory query must reach the existing search owner in full,
including a distinguishing email/profile/name tail after character 160. An
oversized or malformed query must be explicitly refused, leaving the user's
unsent draft intact. Never search an invented shortened prefix or treat the
directory's 200-result capacity as a text budget.

Use a shared proposed admission budget of 500 Unicode scalar values and 2048 UTF8
bytes, checked on the raw input and its complete NFKC/trim result. Reject NUL
and unpaired surrogates. Keep existing normalization and parameterized SQL,
account/source authority, identity rules, result capacity, IME and navigation.

The existing MCP `talent_signal_people` tool calls `listPeople`, not
`searchPeople`. It remains a scoped read-only name-directory projection with
no contact-handle matching or raw evidence. Fixing truncation must not add an
identity-existence oracle to `people_directory_read`. The Web's explicit
identity POST keeps its current confirmed/expired-handle semantics; an expired
handle can remain a stale review clue without acquiring identity authority.

No schema/migration, dependency, Agent tool, model/provider, Native, authentication,
directory-result capacity or lifecycle expansion belongs to this slice. Existing
Native search keeps its narrower 500-UTF16-unit admission. Do not broaden it by
claiming all clients already share the new scalar policy.

## Current source and unknowns

Baseline: fresh main `3dc908f3efe58af81b289a35c6cb1e899c9f546d`, isolated branch
`codex/get-452-complete-directory-query`.

- Directory SSR and its client submission receipt clip 160; the native input
  also limits 160. REST GET allows 160 while POST search allows 500.
- MCP advertises 160 and clips in its actual runtime helper. The advertised
  schema is not a runtime validator; a provided wrong query type becomes an
  empty directory read today.
- `queryPeople`, typed client and navigation helpers preserve the full received
  query. SQL LIMIT 200 and MCP result limit 20 are independent and remain.
- Fastify's existing body bound is 2 MiB; backend/public MCP bounds are 128 KiB.
  No reviewed directory owner declares a uniform URI/request-target cap. A
  scalar budget does not prove percent-encoded URL/cookie/login-callback capacity.
- Browser plugin not available. Use the repository's Hosted Playwright path
  later; no local browser/server is authorized for this first milestone. The
  available local Next docs are 16.4.2 while this baseline locks 16.4.3; existing
  real App Form tests will resolve the locked version in Hosted CI. No local
  dependency installation or runtime-version claim is made.

## Approach and rejected alternatives

First obtain an actual semantic red from the existing owning entrypoints, not
from importing a helper that has not been implemented. SSR regression source
calls the actual PeoplePage, localBackend adapter and TalentSignalClient; only
credential delivery/backend HTTP responses are synthetic. MCP regression source
uses its actual registry, Fastify route and handler with a captured SQL boundary.
These are deterministic boundary tests, not live auth, real PG or rendered RSC
acceptance. The existing Form harness uses the actual Next App Router Form
branch; its router completion is controlled to expose newer-draft races.

After the real red and review, implement a browser-safe shared bounded policy,
remove clipping/native discard, refuse before request bookkeeping/navigation or
People SQL, and keep invalid-route state distinct from empty results/backend
failure. Check admitted complete input and full normalization output; do not
slice, auto-normalize an unsent draft, turn a wrong type into no query, introduce
an unbounded input/coercion walk, or store queries in a new persistence layer.

The proposed six production paths are contracts `peopleDirectoryQuery.ts` and
its public index; Web people/page and people-directory-search; backend
peopleRoutes and mcpServer. Necessary new error keys may be appended to the five
existing Web locales. This first patch changes none of them. Any additional
owner needs concrete evidence and a separate scope decision.

## Milestones and evidence

1. **Active:** freeze test-only source and this plan for Root review/publication.
   Hosted must first collect and execute the actual Web SSR/MCP tail regressions,
   with ordinary-query positive controls. Source tests exist; no local Vitest,
   typecheck, PG, browser or model has run. A missing dependency, import or test
   setup failure is not the intended truncation red and must be diagnosed first.
2. Pending: after semantic red, implement the admitted scope; run meaningful
   pure/HTTP/Unicode/refusal/draft/IME/history regressions and independent review.
   Tests belong to Backend/Web, never contracts/src with undeclared Node/Vitest
   dependencies. Preserve all existing tests and checks.
3. Pending: real disposable Hosted PG for complete long confirmed-handle
   matching and source/account lifecycle controls; actual rendered long
   typing/paste, same-input focus/history and return-to-Person flow. Verify the
   full admitted worst-case Unicode URI and login/backend-session recovery with
   real HTTP/cookies. Host DOM assignments and callback strings are not browser
   input, network URI or focus evidence.
4. Pending: all applicable latest-head CI, source/authority independent review,
   affected resident deployment from clean committed source and live changed
   behavior/revision readback per AGENTS before acceptance/issue completion.

## First regression source coverage

- Two synthetic email/profile pairs have identical first 160 characters and
  distinct valid tails. The actual SSR adapter/typed POST must preserve both.
  The backend-session and login callbacks must preserve the full admitted clue.
- Actual MCP registry/route/handler must send the whole name query to existing
  listPeople SQL with NULL handle type/hash. A long email remains literal name
  input, not a new handle lookup. Missing query remains an ordinary scoped list;
  authentication precedes any explicit query error.
- Raw 501, excess raw whitespace, NFKC expansion beyond 500, NUL and lone
  surrogate are refused before directory dispatch. MCP also rejects a provided
  wrong query type.500 supplementary scalars must not be counted as 1000 scalars.
- Form tests retain the actual input node, caret and newer oversized unsent
  draft when an older long search settles; reject an oversized submit with no
  navigation/pending receipt; retain provisional IME and full Back/Forward props.
  The native maxlength check is a DOM constraint check, not simulated trusted
  paste. Real browser paste and browser Back/Forward remain required.

Temporary evidence and exact source/hash handoff live in the host GET-439 ops
run, outside this repository. Keep synthetic-only data and do not log tokens,
cookies, request headers, private conversation content or arbitrary error text.
