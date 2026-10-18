# GET-156: visible person references and processing motion

## Outcome and boundary

Selecting a person from the shared composer directory produces a recognizable
reference and a hover/click preview without replacing the native textarea.
Keyboard, touch, IME, undo, draft limits and send semantics remain intact.
Only explicit directory choices earn highlights; ordinary typed names do not
become identities. References are disposable presentation state, not new Person
bindings or permission to read Memory. Previews reuse account-bound directory
labels, avatars and relationship labels; no additional private context is fetched.
Observed active processing gains a restrained text highlight sweep; queued,
stopping, terminal, reduced-motion and forced-color states stay honest and legible.

## Milestones

1. Implement reference spans, native-input highlighting and directory previews.
2. Verify mutation, scope changes, ambiguity, keyboard/touch and processing states.
3. Independent review; resolve confirmed P0/P1 before PR delivery.
4. Verify current-head CI, merge, deploy the changed resident Web, verify the
   real surface, then close Linear with readback.

## Delivery notes

The baseline is fresh origin/main at e751b37a. Existing uncommitted work and a
Pi writer on unrelated Agent durability changes are preserved. The resident Web
also contains an independently deployed research notebook branch; release
composition must retain it rather than overwrite an already available feature.
Evidence and user data stay outside Git. No native or backend behavior changes
are intended; browser acceptance uses an isolated account and existing CLI auth.

## State

Completed: implementation merged in PR #323 (5c345f80). All applicable CI
passed on f65acffd, including 276 Web files / 2,159 tests, Web
lint/typecheck/build, backend and CLI quality, docs/architecture, CodeQL and
security. Independent review and increment rechecks closed duplicate spans,
hover-click toggling, container resizing, touch-leave and keyboard-focus issues;
no open P0/P1 remained.

Resident Web is verified at clean composed revision 383d9064, retaining the
previously deployed research notebook feature. Authenticated browser acceptance
covered 1280px desktop and 390px narrow screens, hover/click, Tab/Escape, editor
focus, native undo, plain typed names, profile navigation, actual wheel scrolling,
container-only resizing, observed processing and terminal states, reduced motion
and forced colors. Console was clean. Owned Web restart recovered with the
expected HTTPS password provider and authenticated Session readback. Existing
Tailscale handlers were unchanged.

The CLI-owned daily fixture was stopped and deletion read back; its browser
runner exited. Generated credential evidence and registered temporary test
artifacts were removed, while sanitized proof remains in the authorized private
evidence workspace. The personal account and prior person page were restored.
Touch-leave passed mounted pointer regression tests; direct hardware touch was
not exercised because the in-app browser lacks direct touch dispatch.
