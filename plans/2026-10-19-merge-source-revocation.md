# Contact-only source revocation before merge

Status: Complete. Source repair, independent review and resident deployment are
verified. Exact-head merge readiness is tracked separately by the thread monitor.

## Outcome and boundary

Repair the confirmed pending-source revocation defect in product PR 387 while
preserving the primary dirty checkout. A separate thread monitor follows PRs
386/387 and private archive PR 21 until merged; the user has authorized automatic
merging after checks and reviews pass. Existing source/identity safeguards remain; no
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
3. Done: deploy API and Agent Host from clean integration source
   `53d994abd3ec3b24be8356c9c298429c7a0a9604`. Both run image
   `sha256:ff15411fc4144edac08ac1c0c9ae77dfa2a05f04b4f2026192abb07554b50056`;
   API readiness, recovery configuration and source pointer were verified.
   Four isolated PostgreSQL 18 cases passed against the compiled production
   image: both revoked sources were blocked and both valid/account-isolation
   controls saved. No production data or model calls were used. The Web remains
   at `20c0d64a84db9e5978f3e06e57b03c03b3a06c55`, with unchanged runtime inputs.
   The actual-image proof is deterministic security verification, not a new
   model-quality or owner-acceptance claim.

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
