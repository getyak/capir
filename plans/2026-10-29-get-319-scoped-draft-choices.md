# GET-319: Respect separate contact and Memory draft choices

## Outcome and boundary

Allow an evidence-backed, unsaved contact review when the current user asks for
it while refusing Memory, calendar or external-message work. Preserve every
applicable refusal, unqualified analysis-only/no-save requests, exact sources,
Person identity, account fences, human confirmation and reversible receipts.
An absence of refusal never grants execution authority.

Issue: https://linear.app/getyak/issue/GET-319/respect-separate-contact-and-memory-draft-choices

## Evidence and unknowns

- The isolated video acceptance's only admitted image message completed its
  second queue attempt without a contact proposal. Two contact-create tool
  spans failed. The assistant's fictional-source explanation is not a verified
  rejection reason; raw tool prose and credentials must not enter this plan.
- `analysisOnlyOrNoSave` deterministically interprets `不要保存 Memory` as a
  global refusal. `declinedContact` inherits it. The actual `不创建会议` phrase
  alone does not match the existing negative prefix and is not the confirmed
  trigger. Existing code already separates contact-only refusals from self
  Memory requests; the inverse boundary is missing.
- Image contact-only drafts can use `memory_review` with `items: []`; policy
  must follow the proposed effects, not the tool name.
- Active runtime is another owner's reviewed/CI-green 34e6ea60 candidate; this
  work starts from freshly fetched main 6ddc00ea. Rebase onto the applicable
  merged main before delivery and preserve the newer resident release.

Detailed private evidence and the single-run authorization ledger live in
`/Users/cubxxw/.codex/visualizations/2026/10/28/01a18337-fc2e-79e0-8deb-d92f1f7eae3d/video-review/`.
The original video and private conversations remain local.

## Approach

Separate global refusals from effect-specific refusals. Apply the same result
to staging, default proposals, final presentation and steering withdrawal.
Reject a mixed proposal containing a refused effect rather than silently
discarding evidence or weakening its source checks. Keep quoted source content
and model output outside authored authorization. Avoid prompt-only workarounds,
broader timeouts, synthetic-data exceptions or direct database writes.

## Milestones

1. Completed: parent verified four expected failures through the governed
   Agent seam before production edits, then verified the two additional
   inline-format refusal RED groups before their fixes.
2. Completed locally: verify scoped refusal behavior and conservative
   fallback. The latest parent run passed 260 relevant backend tests and backend
   TypeScript; docs/architecture check passed. Independent final review is being
   requested for the corrective host-fallback guard.
3. Active: linked PR #483 was opened from commit e21a9d22. Its first exact-head
   CI correctly caught a regression: a Memory-only refusal could permit an
   automatic host contact card even without a contact request. The corrective
   code now gates that host fallback on an authored contact-draft request when
   Memory is declined. The former Vercel preview attempt was rate-limited for
   24 hours. Reverify, commit/push the correction and wait on exact-head CI,
   Security, and latest-main rebase before merge.
4. From clean committed source deploy every affected resident service under the
   operations contract; verify runtime revision, dependencies, source/recovery
   pair, keeper, IPC and readiness. Reuse compatible artifacts; no rollback of
   other work or application data.
5. Continue only the already-authorized isolated acceptance with its existing
   run, admitted image and recorded operations; preserve the completed refusal.
   Contact confirmation and Memory request/save limits remain one each. Record
   any necessary recovery text separately; no new account or image upload.
   Verify source/readback/cross-window/restart/native behavior, then cleanup
   and independently read back issue completion. If the account expires first,
   clean it and retain incomplete acceptance instead of creating another.

## Ownership and completion evidence

Worker owns scoped policy implementation and its tests; parent owns this plan,
serial test execution, PR/CI/merge, runtime delivery and acceptance ledger.
Independent reviewer owns consequential-boundary review. No concurrent changes
may be reverted.

Completion requires an expected RED, passing relevant checks, independent
review, merged PR and latest applicable gates, exact clean/live revision,
effect-specific refusals retained, a real requested contact review, approved
save/readback evidence and verified single-run cleanup. Unit tests or a model
explanation alone do not complete this issue.

## Current verification checkpoint

The branch has been updated to main f65ca682, containing the reviewed GET-320
image fix. Initial scope coverage passed 83 checks. Independent review then
found formatted refusals could be lost: the first new RED group had 10 failures
and 2 quoted controls; its patch passed 218 checks. A second review found a
remaining conservative-global gap, reproduced by 8 new failures. Both RED
groups and all previous assertions are retained. The final helper now uses
the original global/contact refusal ranges as well as scoped ranges; the final
GREEN passed 228 checks and backend typecheck passed. Independent code re-review
passed with exact fingerprints. Documentation, CI and runtime delivery remain
separate gates; the initial documentation budget failure is preserved.

Registered verification artifact: `/private/tmp/ai-test-get-319-scoped-drafts.TLE3j9/`.
No additional image, contact confirmation or Memory request/save was performed
while repairing these boundaries.
