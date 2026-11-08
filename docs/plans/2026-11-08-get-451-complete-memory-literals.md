# GET-451 — Preserve complete reviewed Memory literals

Parent GET-439 / historical C05. [GitHub #528](https://github.com/getyak/capir/issues/528),
[Linear GET-451](https://linear.app/getyak/issue/GET-451).
Isolated branch `codex/get-451-complete-memory-literals`, PR530. Original guard
PR525 merged as3dc908f3; current source work will normally merge that main.

## Outcome and boundary

Preserve exact reviewed statements and minimum supporting excerpts through
proposal, human editing/confirmation, atomic commit, receipt and authoritative
readback. Explicit `literal-v2` preserves decoded text without trim, Unicode
normalization or newline rewriting. Missing protocol remains historical v1;
historical normalized text cannot be reconstructed as exact original text.

Approved limits: statement32KiB UTF-8, excerpt64KiB, all actual literal copies
in one request256KiB, encoded JSON1MiB; content pages16KiB text/64KiB encoded.
Existing scope, source revocation/TTL, 24000-character core and Run budgets stay.
No provider/configuration/auth/legacy Chat/queue/history changes, dependency
installation, local build/PG/native/browser work or paid calls. Root owns fresh
migration identity, independent review, commit/PR/CI and resident verification.

## Design and current evidence

The approved C05 design is retained in the code-sync ops reports. Existing
stage normalizes literals, edit paths slice text, range fields are not exact
provenance, and enlarged recall must not resend every excerpt to the model.
Current accepted minimum evidence outlives natural raw-source TTL; explicit
withdrawal still invalidates it. A source reference or digest grants no access.

Worktree/source isolation is verified. Before pure tests the resource guard
reported10.62GiB free and15.95GiB swap, audit no outside-allowlist simulators or
Compose projects. Registered artifact:
`/private/tmp/ai-test-GET-451-complete-memory-literals.gtsIMv`.
Existing pure baseline:20/20 in3files with Node22.23.2/Vitest5.0.5 and installed
read-only peers; no install/build or database. TypeScript package metadata says
6.0.2 but its loaded compiler API is6.0.3 (realpath retained in the artifact);
Zod4.6.7. These local peers are not full pinned Hosted acceptance.

## Milestones

1. Foundation implemented: protocol/Unicode/UTF-8 limits, independent golden
   vectors, strict host-bound UTF-16 half-open ranges, separate proposal,
   evidence and accepted manifests, and bounded canonical/draft content refs.
   Migration113 and its populated-upgrade SQL tests await actual Hosted PG.
2. Apply the same durable version/manifest/confirmation contract through real
   backend stage/append/regenerate/draft/commit/correct/read/recall and Agent
   scope-bound content pages. No isolated schema-only capacity increase.
3. Web/native complete selection, tail access, edit preservation, confirmation
   invalidation and durable receipt/readback. Unknown protocol remains visible
   and unconfirmable; errors never masquerade as empty content.
4. Root review and exact-head Hosted PG/browser/native/CI, then affected clean
   resident revision/behavior verification. Codec/mock green is not completion.

## Verification

Independent Unicode/hash/count golden vectors, paired safe UTF-16 offsets,
scalar boundaries, exact substring and current host message/revision/hash;
duplicates require an explicit position. Reject lone surrogates/NUL/oversize
whole requests, preserving drafts; document/image do not invent message ranges.
Exercise actual owner entry points, transaction/replay/withdrawal and all
literal copies. Preview/ref pages retain scope and coverage, never transcript
authority or artificial source lifetime. Human explicit confirmation binds the
exact final literal and source manifest; viewing/scrolling is not confirmation.

## Remaining work

Phase1 now contains lossless byte/statistics/request/page helpers, a versioned
literal manifest/digest and the explicit-v2 grounding path. Baseline20 passed;
first pure-v2 counterexamples failed21/passed22 before production edits. Later
the changing protocol accessor case failed1/passed64 before single-capture
repair. Independent review then found hash metadata could coerce nonstrings;
nine new cases failed before three strict string checks, now74/74 pure tests
pass. The unchanged normal literal/legacy cases still pass. These are helper/policy tests, not HTTP or
database exploit reproduction or feature acceptance. Six selected source roots
typechecked with actual compiler API6.0.3/exactSDK declarations at zero diagnostics.
The later independent evidence/accepted manifest and read-reference helpers
passed172 tests with12 selected typecheck roots at their recorded hashes.
New draft references first produced10 failures/173 passes against the previous
helper, then the pre-move eight-file host selection passed183/183. The latest
draft delta has no fresh full typecheck or actual SQL evidence yet. Empty
unfinished edits retain exact bytes and zero counts; canonical statements still
require nonempty text and their stored v2 proof. A draft ref binds its current
draft/revision/review-scope/item and never claims an accepted manifest.

Migration113 adds conditional integrity columns/checks without rewriting legacy
text or certifying old normalized originals. Its three digest roles are
distinct. The v2 draft storage envelope newly allows at most200 keys and32KiB
per edit, including empty unfinished values. Multiple bounded saves may exceed
256KiB durable state; the256KiB request budget is not a whole-row storage cap.
Existing legacy JSON is not tightened or silently filtered. Independent SQL
and five-path draft/PG-source reviews closed their confirmed findings.

The dedicated Hosted suite is expected to collect45 cases but has not executed.
It requires an exclusive empty loopback talent_signal_get451_literal_* database,
applies the real old manifest prefix, seeds populated legacy rows and calls
production migrate() for113. A real UPDATE observer includes a positive control;
negative writes require their exact SQLSTATE/constraint. It has no resident URL
fallback, no database reset/drop and no permission/substring/source-authorization
claim. Root registers113, advances the reviewed frozen manifest digest without
changing its115 old SQL files, and selects this suite with REQUIRED=1.

The actual0f7 Hosted build stopped before PG: the contracts package intentionally
has no Node/Vitest test dependencies but its production TS glob collected three
new tests. Those tests now belong to Backend, which already owns those peers
and typechecks/collects them by default. They consume the existing public
contracts exports and the identical golden JSON; bodies/assertions are unchanged.
No dependency, TS exclusion, compiler flag or CI gate was added or relaxed.
The three current names are memoryLiteralProtocol, memoryAcceptedLiteralProtocol
and memoryLiteralReferenceSchemas under Backend modules. Independent source
review closed the move; historical183 does not replace the new full Hosted build.

Stage/commit/read/recall wire integration, Web/native, exact-head full gates and
resident/runtime acceptance remain incomplete. Keep original worktrees/evidence.
