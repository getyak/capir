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

Implementation in progress. No completed acceptance or release claimed yet.
