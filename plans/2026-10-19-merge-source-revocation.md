# Contact-only source revocation before merge

## Outcome and boundary

Repair the confirmed pending-source revocation defect in product PR 387 while
preserving the primary dirty checkout. A separate thread monitor follows PRs
386/387 and private archive PR 21 until merged; human merge authorization is
distinct from inspection and repairs. Existing source/identity safeguards remain; no
contact-creation business prerequisites are restored.

## Confirmed blocker

Independent review found that an image proposal with zero Memory items could
pass pending-source validation after its artifact was explicitly revoked.
The source verifier checked revocation only per item, while the new primary
image contact-only path deliberately has no item. Save can then create a Person.
The fix belongs in proposal-level source verification, using the exact Session
and immutable source artifacts even when the item list is empty.

## Milestones

1. Done: reproduced with real producer, review credential and PostgreSQL Save;
   include artifact/session revoke, valid-source and account-isolation controls.
2. Done: proposal-level revocation validation and independent follow-up review.
   The old implementation failed both revoke cases while both controls passed;
   the repair passed all 167 database integration tests, 144 focused unit tests
   and the backend build. Publish the repair in the existing draft PR.
3. Active: deploy affected resident services from clean reviewed source, verify
   version and behavior in the actual Linux image with isolated PostgreSQL 18,
   then resume merge readiness only after required CI and review.

A 15-minute thread monitor is active. Original PR heads and decisions remain in
ignored task evidence. Do not upload raw conversations, screenshots, tokens or
private operational history.

## Review decision

The proposal root already binds every ordered image of one original message.
Existing count/order/hash checks reject physical image withdrawal for that root;
explicit artifact revocation now has the same effect. Other messages and other
accounts are unaffected. Accepted Memory retention uses separate read paths.
Keep the existing source-row locking order; production Session deletion locks
the same source row before writing its tombstone, and image mutation conflicts
with the resolver's image locks. No additional advisory lock is introduced.
