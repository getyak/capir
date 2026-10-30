# GET-291 — Keep keyboard focus inside an image being reread

## Outcome and boundary

A keyboard user rereading one failed image must keep focus on a connected
control or surface inside that exact inline evidence preview while its bytes
are pending. Removing the focused Retry must not drop keyboard ownership out
of the preview. Existing image, zoom, navigation, Escape and source-return
semantics stay owned by the current inspection.

This is a narrow continuation of GET-291, not a new issue. It recovers one
useful behavior from an older dirty image-viewer draft while retaining the
current inline presentation. The old modal, broad retry state, CSS and search
changes are not copied into this slice.

## Source and ownership

- Worktree: `/Users/cubxxw/.codex/worktrees/get-291-image-retry-focus/talent-signal`.
- Branch: `codex/get-291-image-retry-focus`.
- Initial clean source: `e3a7fcef7aabcbeb11b2f58205e3a40788d0da25`.
- Source writer initially owns only this plan and
  `apps/web/components/conversation/conversation-images.test.tsx`.
- After parent confirmed actual RED, ownership extended only to
  `apps/web/components/conversation/conversation-images.tsx` for this correction.
- Parent owns the existing dependency install (session11520), serialized
  build/tests, independent review, commit/PR/CI, deployment and acceptance.
- Reuse `/private/tmp/ai-test-GET-291-image-retry-focus.FHF7ZR` for parent test
  evidence. Do not duplicate installation, builds, tests or services.
- Other agents own GET-337 and other worktrees. Do not modify or revert them.

## Evidence and unknowns

At the fixed source, `retryOne` synchronously clears `failed[position]` before
awaiting a protected or local reread. The inline Retry is rendered only while
that flag is true, so it is removed while the request is still pending. The
preview remains open. Its open-focus effect does not rerun on this transition;
the desktop removed-action guard tracks other controls, and the inspection
owner governs scrolling rather than this retry-focus path.

The existing image tests verify eventual reread results and manifest position,
but did not hold a reread pending while observing keyboard ownership. Parent
ran the new real-component happy-dom counterexample and observed actual RED:
`preview.contains(document.activeElement)` was false while the connected
preview and connected active-element preconditions had passed. The selected
test failed; the other34 tests were skipped by the test-name filter.

Evidence: `/private/tmp/ai-test-GET-291-image-retry-focus.FHF7ZR/retry-pending-focus-red.log`,
SHA256`e045489b864ca058bcda81897f3c0f49af623100a8b12165241f53ebf59f1274`.
Initial RED test-file SHA256 was
`da1878179bd2c6dc6717061f65539f3d9c61213a36c1b6984098f20bddefd75a`.
The source writer did not rerun the counterexample.

Parent's first focused GREEN attempt reported41 cases:39 passed and2 failed
in the new close/reopen negative cases, before the old read was released.
The failing test oracle expected the first thumbnail, but the real opener had
been removed by decode failure and the established return policy prefers the
connected Expand control. This was not evidence of a late-callback focus steal.
The test now captures that exact Expand element before opening, asserts natural
return to it without moving focus, and explicitly clicks the first thumbnail
only when starting a new inspection. Production source remains frozen.

Failed attempt retained at
`/private/tmp/ai-test-GET-291-image-retry-focus.FHF7ZR/retry-focus-and-handoff-green.log`,
SHA256`6c155035a7e1c0585afae63ee0813b4967ed92ed8167de29ab6e5a2c2c483aec`.

Parent subsequently reported41 GREEN after correcting that oracle. Independent
review identified a P2 in the negative-case completion boundary: a fixed flush
could finish before the released response had completed `blob()` and applied
its URL, especially when the inspected image was closed or switched. The prior
GREEN remains evidence only for its original waiting window; it does not close
that P2, and the original review evidence is retained unchanged.

All four negative cases now capture the URL-producer count before releasing
their exact retry response, then use bounded `waitFor` with an `act` microtask
drain to require exactly one new object URL. They also verify the URL belongs
to the second attachment's thumbnail before the final manifest/focus checks.
The retry-route call count remains exact. No additional fixed sleep or
production behavior was added. Parent's stricter rerun and P2 re-review are
pending; the source writer did not run them.

Detailed source-only analysis and proposed negative cases are in
`/Users/cubxxw/.codex/visualizations/2026/10/28/01a18337-fc2e-79e0-8deb-d92f1f7eae3d/video-review/runtime/capir-two-ui-recovery-candidates-20261030.json`.
That analysis has `readyToMerge=false`; it is not runtime evidence.

## Chosen approach

First establish an actual RED on the current real component. If confirmed,
prefer the smallest synchronous focus transfer to an already connected
preview/stage before removing a Retry that still owns focus. Do not add an
asynchronous read/decode focus handoff unless necessary. Keeping the same busy
Retry connected is a possible stronger design, not the minimum requirement.

Preserve the complete identity key, captured binding, local/server origin,
generation checks, exact attachment position, protected byte path, URL cleanup,
native inspection-only boundary and explicit original-byte actions. No backend,
schema, provider, account or model changes belong to this slice.

## Milestones

1. **Complete:** parent preserved the actual RED above on the real component.
2. **Active:** the smallest synchronous correction is written: only the
   currently focused Retry inside the connected preview transfers focus to
   that preview, with preventScroll, before its failure flag is cleared.
   There is no new asynchronous read/load/decode focus callback. Four focused
   negative cases cover moved focus, close, switch and reopen when earlier
   bytes finish, including the visible current image's load event.
3. Parent runs focused image/inspection checks, applicable quality gates and
   independent review. Rebase and recheck if the applicable main changes.
4. Associate the new PR with GET-291, pass the latest applicable CI, and merge.
   Deploy every affected resident from clean committed source following
   `docs/operations/testflight-local-backend.md`; verify exact live revision
   and changed behavior. A Web-only slice does not imply a native binary change.

## Completion evidence and recovery

The final component checks must demonstrate connected preview focus while a
reread is pending, then preserve a newer focus choice after close, step,
reopen or moved focus when earlier bytes/decode arrive. Existing Escape/IME,
zoom, origin/binding, manifest-order and URL cleanup checks must remain valid.

Actual live/native behavior is a separate acceptance gate. This change grants
no new isolated account, image upload, model request, Memory request or save;
the parent must respect the existing authorization ledger and service owners.
Never use a synthetic component test as proof of native or device behavior.

Current checkpoint: the original RED case remains unchanged; the synchronous
focus guard and four negative cases are written. Production changes are limited
to this one image component; no key, fetch, storage, origin, scroll-management
or CSS code changed. Actual scroll continuity remains an acceptance check.
The source writer has not run tests, builds, browser, model,
service, commit or deployment operations. Parent GREEN and independent review
are pending after the test-oracle and URL-producer completion corrections;
the writer stops here for those gates. The source writer did not rerun the
parent attempts.
