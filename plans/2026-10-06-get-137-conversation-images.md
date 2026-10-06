# GET-137: Web conversation images and exact-image viewer

## Outcome and scope

Make sent images in the existing Web conversation (including the embedded
desktop Web) elegant and inspectable: no prominent outer text bubble frame
around image-bearing sends, one directly visible image, several images as
folded overlapping cards with a count and explicit expand/collapse, and a
viewer that opens exactly the clicked image with previous/next navigation in
the original manifest order. The viewer keeps a compact rounded zoom
percentage (fit/100% toggle), open, download and close controls top-right, the
small original file name and count at the bottom, and closes on blank full-screen
space only.

Authorization, ordering, identity, and object URL cleanup are preserved: bytes
still arrive only through the scoped protected proxy or the local durable
store, never through a bare `<img src>` pointing at a sensitive URL. Open and
download are blob-only and require an explicit user click; download always
names the original file. Partial, unavailable and decode failures stay honest
and retryable without renumbering, and a rejected local durable read ends in a
retryable state instead of endless loading. Escape and arrow keys work, the
Radix focus trap and restoration stay, and fit remains usable on narrow
screens, in light/dark, reduced motion, and forced colors.

In scope (isolated worktree, frozen baseline `277a7a48`):

- `apps/web/components/conversation/conversation-images*`
- `apps/web/components/conversation/queued-conversation.module.css`
- `apps/web/components/conversation/session-message-parts.tsx` and its test
- `plans/2026-10-06-get-137-conversation-images.md`

Out of scope and unchanged: telemetry (none added), backend, data, and model
changes, protected proxy routes, the dependency lockfile, and every other
surface. Independent review, browser acceptance, PR, CI/merge, deploy, and
Linear closure remain parent-owned. No commit, push, PR, merge, deploy,
release, or Linear/GitHub write was performed, and no iOS simulator was used.

## Acceptance criteria

1. Image-bearing user sends have no prominent outer text bubble frame; a
   single image is directly visible; several images are tasteful overlapping
   folded cards with a count and explicit expand/collapse. Mixed text stays
   readable and text-only messages are unchanged.
2. Clicking an exact thumbnail opens only that image; previous/next (buttons
   and arrow keys) follow the original manifest order.
3. Viewer: top-right compact rounded zoom percentage with a useful fit/100%
   toggle, open, download and close; blob-only open/download with the correct
   original filename on explicit clicks; bottom small original file name and
   count; blank-space click closes, image/control clicks do not; Escape works;
   Radix focus trap and restoration stay.
4. Partial, unavailable and decode failures remain honest and retryable, keep
   their manifest position (no renumbering), and a rejected local durable read
   never leaves an indefinite loading placeholder.
5. New sensitive URLs never bypass the protected proxy; bytes stay in scoped
   proxy or IndexedDB blobs with existing object URL lifecycle.
6. The same reusable strip serves history, queued, and local pending messages.
7. Meaningful happy, error, navigation, blank-close, focus, order, download and
   lifecycle tests in the existing Vitest happy-dom style.

## Evidence and approach

The baseline already owned `ConversationImageStrip` (scoped proxy/IndexedDB
blobs, per-mount object URLs revoked on unmount and identity change, remount
keyed retry) and projected user images from history, the active run and the
queue through `talent-signal.user-images`. This change keeps that identity and
lifecycle contract and reworks presentation and viewing only.

Implementation:

- `conversation-images.tsx`: the strip renders one image as a directly visible
  rounded card (`data-layout="single"`), several as folded overlapping cards
  (`data-layout="folded"`, every card still clickable on its visible edge) with
  a `N 张图片` count and an `aria-expanded` `展开图片`/`收起图片` toggle, and a
  full grid when expanded. Clicking thumbnail *i* opens the viewer at manifest
  index *i* only. The Radix viewer shows exactly one image with wrapped
  previous/next (buttons + ArrowLeft/ArrowRight) in manifest order, a top-right
  compact rounded toolbar (zoom percentage, open, download, close), and a
  bottom `Dialog.Title` with the original file name plus `index / count`.
  Zoom toggles fit/100%, showing the measured fit percentage when layout is
  measurable and `适应` otherwise. Open calls `window.open` and download creates
  a one-shot anchor with `download = file_name`, both from the mounted object
  URL only and only inside a click handler. Blank dialog/stage clicks close via
  a `target === currentTarget` guard, so image and control clicks never do;
  Escape and the focus trap are Radix-owned; close explicitly restores focus to the clicked thumbnail (or a surviving strip control if decode failure removed it). Image `onError` revokes and clears the exact object URL and marks
  the exact position failed; the viewer shows `这张图片暂时无法读取。` with a
  per-image `重新读取` retry that reloads only that index (revoking the
  superseded object URL), while the existing strip-level `重新读取图片` remount
  retry is preserved. The local durable read is wrapped so a thrown or rejected
  store ends in the same explicit `图片暂时无法读取` + retry state.
- `queued-conversation.module.css`: single/folded/expanded layouts, the
  toolbar/stage/meta/nav styling with 44px touch targets, and the narrow-screen,
  reduced-motion, reduced-transparency and forced-colors rules for the new
  controls. `.userMessage:has(> .images)` narrowly drops the bubble frame for
  the local pending wrapper in `queued-conversation.tsx` (which this scope
  cannot restructure), keeping its mixed text readable and its images
  frameless; text-only and non-image bubbles are untouched.
- `session-message-parts.tsx`: `SessionUserMessage` now renders text parts as
  their own readable bubble and image parts directly beneath it through a
  second `MessagePrimitive.Parts` pass, so history/queued/active image sends
  never grow an outer text bubble frame, image-only sends show the image with
  no empty bubble (the synthetic empty text part renders nothing), and
  text-only sends keep the original single bubble.

Verification performed in this worktree:

- `pnpm --filter @talent-signal/web exec vitest run components/conversation/conversation-images.test.tsx components/conversation/queued-conversation-images.test.ts components/conversation/session-message-parts.test.tsx` — 21 tests pass (10 new viewer/strip tests, 1 new projection test, 10 pre-existing).
- Full Web suite `vitest run` after `pnpm --filter @talent-signal/web typecheck` builds the workspace packages: 236 files, 1822 tests pass (the first run without built workspace deps failed only on `@talent-signal/contracts` resolution, an environment condition also present at baseline).
- `pnpm --filter @talent-signal/web typecheck` — clean.
- `pnpm --filter @talent-signal/web lint` — 0 errors; 6 pre-existing unused-symbol warnings in out-of-scope files (`app/login/actions.test.ts`, `app/workspace/settings/conflict/actions.ts`, `app/workspace/settings/link-complete/route.ts`, `lib/account-recovery-flow.test.ts`, `lib/server/desktopCapture.ts`), left unrepaired per scope.
- `pnpm docs:check` — passed.
- Test-mutation sanity checks: removing the blank-close handler fails exactly the blank-close test, and reverting the user-bubble split fails exactly the bubble test; both restored afterwards.

New tests (`conversation-images.test.tsx`, happy-dom + `createRoot` + `act`,
the existing style): single image direct render with blob-only `<img>` and
protected-proxy readback including the `x-workspace-session` header; folded
cards with count and expand/collapse; exact-thumbnail open plus manifest-order
navigation with arrows and buttons; blank-close versus image/control clicks;
fit/100% zoom toggle; blob-only download with the original file name and open
on explicit clicks only; unavailable image kept in place (`2 / 3`), honest and
retryable inside the viewer; rejected local durable read ending retryable;
object URL revocation on unmount; and a whole-surface render proving mixed,
text-only and image-only bubble behavior. `session-message-parts.test.tsx`
gains a projection test keeping image manifest order and message identity for
history, active and queued messages.

Known nuance: in the transient local pending row (out-of-scope composer file)
mixed text renders readable plain text beside the frameless strip instead of
its own inner bubble; the history/queued transcript shows the text bubble plus
frameless images.

Independent review corrections (parent-owned):

- Decode failure now revokes the failed object URL, renders the honest per-image
  retry, disables open/download, and preserves the selected manifest index.
- Viewer close restores focus to the exact clicked thumbnail; an Escape test
  proves the dialog closes and focus returns.
- The text bubble's max-width applies once inside the new stack, including the
  existing 90% narrow-screen constraint.
- Navigation controls sit outside stage layout. Fit uses the stage's actual
  width capped at 1100px, while auto margins allow 100% overflow to scroll from
  the top-left edge instead of clipping negative centered overflow.
- Single strips have an explicit responsive card width, avoiding cyclic intrinsic
  percentage sizing and keeping both loading and ready cards right-aligned.
- Folded lists scroll within their strip for the supported maximum of ten images
  on narrow screens; expand/retry controls retain 44px mobile touch targets.
- The focused suite now passes 24 tests, including decode-error/retry, focus
  restoration, and stopping further reads after unmount. Parent reran Web typecheck successfully; lint/docs receipts are
  collected separately before delivery.

## Milestones and acceptance

1. Complete: scoped implementation with preserved authorization, identity,
   ordering and object URL lifecycle.
2. Complete: 21 focused Web tests including the previously missing
   `conversation-images.test.tsx`, full 1822-test Web suite, typecheck, lint
   and docs checks as above.
3. Pending (parent-owned): independent review and browser acceptance across
   light/dark, reduced motion, forced colors and narrow screens.
4. Pending (parent-owned): PR, CI/security gates, protected merge and deploy
   readback, then GET-137 closure on Linear with the final receipts.

Implementation, a passing local suite or this plan is not completion; record
final CI, merge and deployment receipts on the GET-137 issue before marking it
Done.
