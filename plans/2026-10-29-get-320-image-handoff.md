# GET-320: Keep an original image open when a reply finishes

## Outcome and boundary

Keep one admitted original image open at its chosen zoom and pan while its
message moves from an active run through delayed detail readback into history.
Preserve real local outbox behavior and account, Session, artifact/hash,
withdrawal, deletion and byte-lease boundaries.

Issue: https://linear.app/getyak/issue/GET-320/keep-an-original-image-open-when-a-reply-finishes

## Evidence

The authorized isolated image was open at 100% during a real running task on
34e6ea60. A real wheel moved its preview from 0 to 280px; exactly one image
remained visible. The outer feed moved from 0 to 6px, so perfect position
retention is not proven. After completion the image was collapsed without a
close action. The subsequent expanded-region lookup timed out before reaching
its close step. Preserve these failures.

Independent source review found stable message IDs but a concrete provenance
handoff defect: retained server entries become handoff messages, whose images
are hard-coded as local. The viewer key includes local, causing a
remote/local/remote remount and losing expansion, zoom, pan and lease state.
This matches the observed failure; no runtime mount trace establishes it as
the sole cause.

Private evidence and the one-run authorization ledger remain in the parent
video-review directory; no original video or real conversation leaves the Mac.

## Approach

Carry the actual image origin through handoff instead of removing a source
boundary from the key. Keep real pending/unknown local images local. Exercise
the actual conversation state handoff, deliberately delaying history readback;
do not replace it with a test that merely duplicates the implementation.

## Milestones

1. Completed: parent verified the expected server-handoff RED while the local
   outbox control passed, before production edits.
2. Completed locally: the minimal provenance patch passed 84 focused/related
   checks, typecheck, lint, docs/architecture and independent code review on
   main 1e6cc3e1. Real runtime and native acceptance remain separate.
3. **Active:** Rebased onto main 1e6cc3e1; create the linked PR with this
   issue's title, repair CI, review and merge after gates pass.
4. Deploy affected resident services from clean committed source, preserving
   newer unrelated work. Verify actual revision and behavior before completion.
5. Reuse the original isolated run/admitted image for permitted remaining
   checks. Do not upload another synthetic image or create another account
   without new authority. Keep unavailable active-completion/native scenarios
   explicit; tests do not replace real acceptance. Preserve evidence and verify
   cleanup before issue completion/readback and inactive-worktree archival.

## Ownership

Worker owns conversation image provenance/handoff implementation and tests.
Parent owns this plan, serial checks, PR/CI/merge, deployment and final acceptance.
Independent review must inspect source/identity changes and local-only, hash,
account-switch and withdrawal controls. Do not revert concurrent work.

## Verification records

Expected RED and 84/84 GREEN, dependency setup, latest-main rebase and quality
receipts are retained in `/private/tmp/ai-test-get-320-image-handoff.chKNLR/`.
The independent code review binds the two production files and regression by
SHA256; it does not claim deployment, active completion or native acceptance.
A second image upload would require additional authority under the current
once-only isolated acceptance grant.
