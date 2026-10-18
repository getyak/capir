# GET-42: Allowed user-provided identity context — implementation plan

## Outcome and boundary

Deliver the allowed GET-42 identity-clue slice on the EXISTING Web workspace
conversation controller and the existing public research tools: image plus an
explicit user-authored research name (Chinese or English) and an optional
canonical public homepage registers one bounded host subject, runs the existing
bounded search and same-run fetch, and yields a useful cited TENTATIVE answer.
The answer never confirms the identity of a person in a photo, never infers a
relationship from a selfie, and never writes contact or Memory state
automatically.

Chosen OR slice only: user-provided name/homepage identity clues. The
alternative known-contact photo-context slice (contact-agent filing, Memory
confirm/skip) is future work, not a requirement or delivered claim here. The
known-contact selection path in `/contact-agent` is untouched; no second
identity system and no unrelated native/queue wiring was built.

Ownership: implementation is this worktree's writes in the listed scope only.
Parent owns public GET-37 source-safe diagnostics, the private evaluator,
reviews, CI, Git, Linear, deploy and live acceptance. GET-39/130 native work
stays untouched.

## Accepted scope

- `apps/agent/src/publicSubjectRegistry.ts` (+ tests): the positive authored
  objective parser now accepts complete bounded Chinese or English names,
  rejects Chinese generic/pronoun/time targets beyond removing the Latin rule,
  consumes only a legitimate terminal suffix (hostile tails reject the whole
  target), separates an explicit homepage from the name, binds each name to
  its own URL (mixed/repeated assignment rejects the target), keeps URL-only
  targets unresolved, and rejects a name+homepage target that cannot fit the
  existing 100-character query bound. New host-owned `authoredHomepage` on
  `AuthorizedPublicSubject`, set ONLY by that parser; the pure strict
  `admitAuthoredPublicHomepage` validator admits canonical public HTTPS roots
  plus the exact legacy platform profile rules and rejects raw hostile forms
  (controls, backslashes, encoding, userinfo/contacts, query/fragment,
  dot-segments, IP alternate forms, local/internal/pseudo suffixes,
  instructions) before parser normalization. `registerImage`,
  `registerCounterparty` and `registerTentative` cannot set the authority.
- `apps/backend/src/modules/workspacePublicResearch.ts` (+ tests):
  `WorkspacePublicResearchSubject.authoredHomepage` is forwarded by the host,
  re-validated in the adapter, and joins the derived query and provenance
  anchors unconditionally. An invalid or over-limit homepage fails honestly
  with `PUBLIC_RESEARCH_QUERY_INVALID` before any dispatch; it never silently
  degrades into name-only research. Tool arguments still accept only
  `subject_id`. The URL is a search query anchor, never direct fetch
  permission; the transport stays the existing LocalContactResearchClient to
  AgentHost contactResearchService (fixed Exa search/contents), with no new
  direct URL fetch.
- `apps/backend/src/modules/workspaceConversationAgent.ts` (+ tests): the core
  forwards the explicit homepage field. Every user-authored source is FROZEN
  at admission (Run start or steering admission) to its exact messageID/text
  identity (hash-compared, text never re-emitted), and each complete-clue
  subject's currency guard composes `input.assertCurrent` with that frozen
  binding, so a later text change or removal revokes the original authority
  and can never be revived by re-registering the same clue. Only EXACT
  identical complete clues dedup guards across sources; tentative proposals
  keep their own binding and never borrow a name+homepage authority. Steering
  no-search and cancellation are preserved.
- `apps/backend/src/modules/workspaceConversationIdentityAcceptance.test.ts`
  (new): the acceptance matrix on the real controller with a fake
  ContactResearchClient and a TEST-ONLY provider adapter that consumes the real
  `request.supplementalTools`, reads host subject ids from the actual tool
  descriptions or inspection receipts, and calls each tool's real `execute`.
- `docs/operations/user-provided-public-identity.md`, this plan.

Explicit non-goals: no schema/DB/platform/photo-parser work, no `invokeTool`
research path, no ScriptedAgentProvider change, no widened
`admitPublicContextAnchor` handle rules, no query-limit increase, no
humanGold semantics, no release approval, no production fixes without a
reproduced failure.

## Deterministic evidence (this worktree, frozen base 5dc8961f)

- Dependency closure: owned `node_modules` directories with owned
  `@talent-signal` aliases resolving to THIS worktree (`agent -> ../../../agent`,
  `contracts/evaluation -> ../../../../packages/*`), external registry
  packages reused read-only through the shared `.pnpm` store symlink; contracts
  → agent → evaluation rebuilt inside this worktree only.
- Meaningful RED first on the real registry/controller (logs kept):
  `red-agent-registry.log` 6 failed / 14 passed; `red-backend-research.log`
  3 failed / 33 passed (over-limit subject silently searched name-only);
  `red-acceptance.log` 9 failed / 6 passed; `red-lifecycle.log` 2 failed.
- GREEN after the smallest fix: agent suite 549 passed / 14 skipped (45
  files); backend suite excluding DB integration 1116 passed / 3 skipped (110
  files), including 15 acceptance tests and the preserved
  workspacePublicResearch/workspaceConversationAgent/workspaceImageIntent/
  firstContactResearch regressions (146 focused). Fake research client only;
  zero real provider calls, zero writes asserted in every matrix case.
- `tsc6 --noEmit` clean for agent and backend; `git diff --check` clean;
  `node scripts/check-docs.mjs` passes.

## Matrix covered by the acceptance test

Chinese/English names, name+homepage binding, positive then explicit no-search
(zero dispatch), unrelated contact never registered, plain image/two-people/no
identity clarifies, hostile image and model-supplied unknown subjects or forged
URL arguments fail honestly with zero dispatch, URL-only stays unresolved,
same-name results reported as ambiguous and tentative, foreign/stale image
never registers, revoked image or message source stops the fetch before any
further provider read, a hostile final citation without a fetch establishes no
receipt/identity/write, steering no-search revokes mid-run, and cancellation
stops cleanly.

## Mapping to future isolated live Web acceptance (parent-owned)

The deterministic results above are the pre-deploy contract for one future
isolated live Web acceptance on a clean resident deployment from committed
source after CI and normal merge:

1. In the Web workspace conversation, send one image plus `研究 张三 的背景`
   and the English form; expect a clarification-free cited tentative answer
   whose links match real fetched receipts, and no contact/Memory card change.
2. Repeat with name plus homepage; the answer cites real receipts and no page
   is fetched merely because the homepage was typed.
3. Verify honest clarification for a plain two-person photo and for URL-only
   input, and no search after `不要搜索` (message and live steering).
4. Verify a same-name answer reports ambiguity and tentative identity.
5. Verify revocation (deleted/edited source message, expired image) blocks
   further reads in the same Run.
6. Finish with a zero-write and cleanup pass (no staged proposals, no contact
   or Memory changes, no external effects) and record the live revision.

No semantic humanGold, evaluator, release or live-acceptance claim is made
here; those gates remain parent-owned.

## Repair 1 — review R1 (same-name clue/source isolation)

Independent review (`implementation-independent-review.md`, P2 R1) reproduced
one defect: subject ids were name-derived, so same-name/different-homepage
authorities collided; the core OR'd unrelated source guards while keeping the
first homepage, and discovered receipts re-bound across authorities. One
authored input with conflicting clauses also silently picked the last
homepage.

Settled fix, verified on the real core and the real supplemental `.execute`
paths:

- The registry binds each subject to its COMPLETE clue (bounded name plus its
  own canonical homepage, or its own anchors), so different clues always get
  distinct ids, guards and receipts. In ONE authored input, one name with
  conflicting clues fails closed for that name (no dispatch, no name-only
  downgrade); independent names are unaffected. Identical complete clues
  dedup onto one authority.
- The core freezes each source admission at Run start or steering admission
  (exact messageID/text hash) and composes `input.assertCurrent` with that
  frozen binding; removal OR text/hash mutation of a source revokes its
  authority before search or blocks any further fetch, even while a same-name
  sibling authority stays valid. Identical complete clues supported by
  multiple current messages stay researchable while supported; a different
  homepage (different authority) can never revive an old receipt. Only exact
  identical complete clues merge guards; anything else fails closed.
- Discovered sources stay bound to the complete-clue authority that first
  discovered them in the run; later fetches never switch authority. A
  name-only first-contact/tentative proposal never borrows a name+homepage
  authority; image/counterparty/tentative authorities and the existing
  first-contact flows keep their own ids and guards.

Repair evidence (logs prefixed `repair1-` in the task artifact):

- Meaningful RED first: registry 2 failed / 21 passed; research 1 failed /
  36 passed; acceptance 6 failed / 16 passed (the 7th new case, image vs
  objective authority, correctly passed at RED as a preservation guard). RED
  failures were product defects: wrong-clue query dispatched after source
  removal, old receipt fetched after removal/mutation, conflicted name
  silently registered, old receipt revived under a different URL, and a
  tentative proposal borrowing the name+homepage authority.
- GREEN: registry 23 passed; research 37 passed; acceptance 22 passed (all 15
  prior cases preserved, zero writes); focused backend 154 passed; full
  backend unit suite 1124 passed / 3 skipped (110 files); agent suite 552
  passed / 14 skipped (45 files). `tsc6 --noEmit` clean for agent and backend.
- The reviewer's unchanged probe now exits 1 at its first buggy assertion
  (zero provider dispatch after the withdraw-before-search removal), so the
  reported reproduction no longer occurs (`repair1-reviewer-probe-after-fix.log`).

## Repair 2 — exact-head CodeQL structure fixes (PR372 head 329b62fe)

Exact-head CodeQL on PR372 reported three findings over the delivered slice
(`initial-codeql.sarif.json`; authoritative diagnosis
`codeql-alert-109-independent-diagnosis.md`). None was an observed security
bypass; each was a structural misreading that the source must express
accurately. No suppression, dismissal, removed guard, renamed security symbol
or widened bound was used.

- **109 `js/user-controlled-bypass`** (`publicSubjectRegistry.ts` L200): the
  `if(clause.length>512)continue` skip guarded the pure validation call
  `admitAuthoredPublicHomepage` (the CodeQL 2.27.2 SensitiveActions `auth`
  heuristic misreads "Authored" as an authorization call). The official
  conditional-bypass query recognizes `return`/`throw` early abort but not
  `continue`, so the loop skip looked like a bypassable limit even though an
  oversize clause contributes no registration. Source-backed resolution:
  each full authored research clause is now parsed by the PURE helper
  `parseAuthoredResearchClause`, which returns `[]` — a complete rejection —
  on every oversize/invalid/ambiguous/over-limit input and returns only a
  fully validated target array. All rejections are early `return []` aborts
  inside the helper (recognized guard structure), the outer registry only
  merges complete valid helper results, and the exact 512 raw-clause bound,
  no-truncation rule, decline semantics, whole-target validation, canonical
  URL rules, per-input same-name conflicting-clue fail-closed behavior and
  independent unrelated clauses are unchanged. Input bounds and the
  security-symbol names stay as they are; source guards and complete-clue
  authority are untouched.
- **107/108 `js/incomplete-url-substring-sanitization`** (acceptance test
  L821/822): authority identification used `attempt.query?.includes(domain)`.
  Resolution: exact equality against the complete expected queries
  (`Simon Willison https://simonwillison.net/` and
  `Simon Willison https://craigmod.com/`), and the fake-provider router now
  also matches complete queries exactly — no URL substring stands in for host
  validation anywhere in the test file. Real URL policy is unchanged.
- **Boundary regressions added** for the extracted clause: exactly-512 raw
  clause with a valid name+homepage still parses while 513 fails closed; a
  ≥513 clause carrying a valid homepage and a hostile tail registers zero;
  the hostile tail is never clipped to launder a target at or below the bound;
  an overlong clause beside an independent valid clause registers only that
  valid complete clue; and a long raw target is never normalized down to a
  valid name even when whitespace collapsing would yield one.

Repair-2 evidence (logs prefixed `repair2-` in the task artifact; all earlier
RED/GREEN logs and the batch-1 nine-file hash freeze records are preserved):
contracts/agent/evaluation builds OK in this worktree; `tsc6 --noEmit` clean
for agent and backend; agent registry + currentImageInspection 40 passed; the
backend five relevant files 154 passed (all R1 and original acceptance
regressions preserved); docs/wiki/architecture checks and `git diff --check`
pass. Hosted CodeQL on the new head is parent-owned and must rerun before any
passing claim.

## Repair 3 — narrow romanized surname targets (MiMo P3, COMMENT 5562528427)

One confirmed small functional issue: the generic Latin pronoun/time filter
(`/i`) rejected legitimate capitalized romanized surnames — `He Wei`,
`He Ping`, `She Ping` (何/佘) — even though the complete Latin-name grammar
accepted them (bounded=true, target=false, zero subjects).

Conservative fix in `isBoundedPublicNameTarget` only: a leading EXACT
capitalized `He`/`She` word is exempt from the pronoun filter when every
remaining word satisfies the existing complete Latin-name grammar and no
generic/pronoun/time target remains. Single-name minimum, lowercase forms,
pronoun/time tails, non-leading `He`/`She` occurrences, hostile tails, Chinese
generic rules and every source/homepage binding are unchanged — the filter is
never globally relaxed and no arbitrary generic target is admitted. This is
name-form checking only, not identity validation.

RED/GREEN (`repair3-red-registry.log` / `repair3-green-registry.log`): the
admission case failed on the old filter (1 failed / 29 passed — all rejection
examples already held), then registry + currentImageInspection 43 passed.
Builds (contracts/agent/evaluation), agent/backend typechecks, the backend
five focused files (154 passed), docs/wiki/architecture/diagrams and
`git diff --check` all pass (`repair3-*` logs).

MiMo P0 (raw regex) and P2 (hostResult) claims were independently disproven
on an isolated 329b snapshot with four actual fake-core probes; the
production `hostResult` fallback is deliberately UNCHANGED and those
false-positive findings are not reported as source fixes.

Scope note: the runner's FAILED160repair2 verdict stands as the historical
record; it failed only on scope accounting for 15 already-merged main8eb
files (byte-verified in `repair-2-evidence/freeze-and-scope-amendment.json`),
which are immutable read-only here and were hashed unchanged before and after
this delta. Hosted CodeQL on the new head still awaits the parent push and is
not claimed passed.
