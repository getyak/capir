# GET-38: Conversation image intake

Superseded: the user rejected the source-intake modal on 2026-09-21. PR #231
merged as `224cd374`, but its outcome is not acceptance of GET-38. Continue in
[the inline chat correction plan](2026-09-21-get-38-inline-chat-images.md).

## Outcome and scope

Make image intake reachable from the ordinary conversation: file selection,
drop, and image paste lead to a visible, editable multi-image preview and the
existing durable contact-source save flow. Preserve the conversation draft,
show failures honestly, and let the user inspect saved originals.

Issue: https://linear.app/getyak/issue/GET-38
Read from the authenticated Linear screenshot on 2026-09-21: image sending
appears broken; support image dragging, elegant display, and storage.

## Baseline and approach

- Frozen remote main: `643175d208b2c61ec3fbe34ad9d20bcc77a5e1bd`.
- The live queue composer has no file drop/image paste integration. Its add
  menu invokes the older single-image CapturePanel that explicitly discards
  originals after review.
- Reuse ContactAgentWorkspace and its existing authenticated multi-image task
  admission, retained originals, expiry, deletion, and retry semantics. A
  source-intake dialog retains conversation context; source admission is not a
  text queue reply or confirmation of extracted facts.
- No new raw-image local persistence, model provider, or collection scope.
  Do not change private text-only chat or native iOS flows.
- Main checkout contains unrelated changes and remains untouched.

## Milestones

1. [x] Read issue, establish baseline, inspect intake boundaries.
2. [x] Implement and test composer handoff, previews, and protected recovery.
3. [x] Independently review; verify real browser flow with synthetic images.
4. [x] Pass latest-head CI, merge, read back, and update Linear for this historical implementation.

## Completion evidence

Exercise chooser, drop and image paste, normal text paste, invalid/oversized
batches, image removal, duplicate submission, unknown response retry, closing
and reopening intake, draft/focus preservation, account teardown, retained
source retrieval, narrow and dark layouts. No live candidate data is needed.
Run narrow Web tests, lint/typecheck/build and documentation checks. The macOS
Web shell shares this UI; distinguish browser evidence from native runtime
verification. Native iOS testing is outside this Web-only change.

## Status

Pi task `20260921-133523-d73df7e1` passed local verification. The parent added
Strict Mode preview recovery and closed the review's confirmation-close and
unknown-attempt file-append gaps. Independent final review passed with no
unresolved P0/P1/P2; 114 affected tests passed for this historical scope.
Existing backend storage passed an isolated synthetic save/original-image
readback, and the real UI passed the labeled local fixture; see the
[verification record](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-21-get38-input/README.md).
PR #231 merged as `224cd374` and was activated in the resident Web release.
Linear reached Done before the user's correction. That delivery does not meet
the clarified inline-message requirement; the correction plan owns remaining
implementation, verification, and issue-state readback.
