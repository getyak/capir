# GET-448 — Reach every currently authorized Memory proposal

Status: In progress. Linear GET-448; GitHub issue #522. Parent GET-439.

## Outcome and boundary

An older permitted proposal must remain reachable behind more than fifty newer
unrelated proposals. Filter current reader, purpose, Person, relationship and
source eligibility before the existing fifty-candidate budget, then offer
explicit bounded continuation in People and Pursuit. Existing clients retain
their unpaginated response shape. No proposal acquires acceptance or execution
authority through listing.

The existing [Memory decision](../docs/decisions/0024-three-scope-memory-review.md)
owns scope separation. [Account access](../docs/operations/account-access.md)
owns login and Lab lineage. The original source verifier remains authoritative.
No schema, migration, dependency, provider, permission or legacy Chat lifecycle
change belongs to this slice.

## Approach and review decisions

- Apply exact scope and current source eligibility before limiting. Run the
  original verifier for every selected/probe row, and repeat qualification and
  live reader authority before publishing metadata. Any disagreement requires
  an explicit fresh read; no hidden-source frontier or count is exposed.
- Return at most forty-nine rows and one qualified lookahead within the unchanged
  budget. Keep PostgreSQL microseconds, the last returned keyset anchor, original
  creation cutoff and deadline. This is live filtered traversal, not a retained
  historical snapshot or a promise of an immutable total.
- Cursor encoding grants no permission. Its material derives from the current
  bearer digest; current-bearer holders can derive it and mint encodings. Do not
  treat encryption as server-issued authenticity or confidentiality against them.
- Every list form must perform the same initial and final live reader checks;
  the caller cannot disable them by omitting pagination. Preserve legacy JSON
  shape and its fifty-row budget, while using the same server-side login digest
  as a credential-generation fence. Only cursor encoding and page metadata are
  optional. The earlier legacy no-digest-query approach was rejected when
  CodeQL exposed this bypass of the additional reader check.
- Bind the HTTP reader to the credential branch actually accepted. A still-live
  renewed current session does not renew its previous token's original deadline.
  Current row generation and accepted current/previous credential expiry are
  separate fences; preserve both, including empty/unpaginated/explicit-false
  lists, without a body/query opt-out or new authority from a cursor.
- Reuse the existing Lab session predicate at both initial and final authority
  checks. Entry, parent, principal generation, grant and entitlement can cease
  to be valid while the ordinary session row remains active. Executable
  after-await withdrawal counterexamples prevent this review failure from
  recurring; no broader always-on instruction is needed.
- Keep one current Web page and explicit Continue/Read latest. Scope/source/auth
  changes cancel owned requests. Known login-stale metadata uses the existing
  whole-workspace privacy boundary; a late body cannot expire a newer scope.

The existing route authenticator retains deployment/audience admission. Its
server configuration is fixed for the process; normal principal-origin changes
rotate generation, while normal refresh/revoke does not rewrite run/grant
origins. Arbitrary privileged database rewrites are outside this proof. Do not
claim the final query reproduces every deployment predicate.

## Milestones and evidence

1. Completed: current-source reproduction, bounded implementation, independent
   scope/source/cursor/Web review, and the two review corrections above.
2. Completed at03344b97:198/198 real Memory PG cases (101 added,0 skipped),
   full Backend/Web/docs/CLI quality,3864 Web tests,13SDK cases, full Next build
   and all four portable package jobs. Latest JS/TS CodeQL analysis has0 findings;
   both earlier PR findings report fixed, without suppression. The aggregate's
   absent-Swift configuration warning is separate from the successful JS scan.
3. Active before merge: reproduce the previous-token acceptance boundary over
   actual HTTP AuthGuard/currentSession and real disposable PostgreSQL. Three
   list-form cases each cover slot withdrawal and natural original microsecond
   expiry, with legal list200 and fresh old401/current200 controls. Atbdce1fd9, all six flows
   reached their safety assertions and reproduced late200/data despite old401
   and current200;198 prior cases passed. The4-path fix now binds actual accepted
   branch/deadline while preserving current generation/cursor and the original
   source verifier. Root/peer reviews and52 pure/5-root semantic checks pass;
   execute latest Hosted PG and applicable gates before merge. Earlier03344
   green does not cover this boundary.
4. Pending: real browser acceptance, affected resident deployment from clean
   committed source, live revision/behavior readback, and normal source merge
   after all applicable current checks. Keep Linear In Progress until acceptance.

PostgreSQL cases cover mixed/hidden proposals, stable microsecond pages,
cross-scope cursors, live mutations and original source-verifier equivalence.
The original ninety additions include nineteen Lab cases and passed in Hosted.
Eleven new legacy-form authority cases bring additions to101 and the full suite
to198; all ran successfully at03344. The additional accepted-previous HTTP
flows produced3 real red groups atbdce. Post-fix execution remains required. Detailed synthetic
evidence and temporary artifact recovery references are kept in the host's
GET-439 operational run, outside tracked source. No production data, account,
provider or resident process was changed during implementation.

Reconsider the approach if real PG differential checks disagree, query cost
exceeds the unchanged timeout, or an existing normal lifecycle can change
deployment admission without its generation fence. Preserve original source
semantics and fail closed rather than increasing limits or weakening authority.
