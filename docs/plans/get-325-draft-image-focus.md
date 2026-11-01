# GET-325: Restore typing focus after removing a draft image

## Outcome and boundary

After a focused image Remove action commits successfully, return focus to the
same enabled composer. Preserve authored text and remaining attachments. A later
user focus choice, draft owner or session must cancel this handoff.

Only the conversation consumer and its regression coverage change. Persistence,
attachment identity, API contracts, provider calls and submission stay intact.

## Evidence and approach

The initial baseline at `8b11167` reproduced three asynchronous focus failures
through the real conversation hook: durable success, refusal followed by retry,
and rejection followed by retry. Five ownership and user-intent controls passed.
The first fix passed 13 focused and 141 adjacent local cases, ESLint, documentation
checks and Web typecheck; its applicable CI passed and PR #508 merged normally as
`92219990b63b6bc5600d33b741abaea5143000db`. The initial 1024 MiB typecheck ran out
of heap; the same normal configuration passed once with a 2048 MiB heap.

Actual Chrome 156 with real IndexedDB then exposed a native failure that happy-dom
did not reproduce. V3 preserved durable ACK at 3104.5 ms, trusted Remove-button
focusout at 3106.9 ms while the node was still connected, and detachment by the
3107.2 ms microtask. The same enabled composer, authored text and correct remaining
durable image survived, but focus stayed on BODY. The connected-only blur guard
rejects that native removal transition.

Retain the temporary operation owned by the current draft, session, trigger and
composer nodes. Wait for durable settlement and committed attachment absence.
Use a stable React callback ref to mark cleanup for only the current operation's
exact trigger before native removeChild. Ref setup clears the marker for the same
node, including StrictMode replay or re-attachment. Explicit blur of a mounted
control still cancels immediately; known React commit detachment is the exception.
Keep intervening foreign focus, pointer or Tab intent, owner replacement, disabled
composer, unmount and ABA protection. Remove every temporary listener. Restore
only after the original image is absent and its exact trigger is disconnected.

## Follow-up milestones

1. Complete: preserve the actual native RED and its passive event timeline.
2. Complete locally: all 16 focused controls and 141 adjacent regressions passed
   with no skips, as did changed-file ESLint, Web typecheck at 2048 MiB and the
   four documentation checks. Each ran once and reused the existing package builds.
   The exact component candidate passed all five native Chrome cases: pointer,
   Enter, Space, later foreign focus and explicit connected blur. The private
   candidate bytes equal the component applied to this normal branch.
3. Pending: applicable published-head CI and normal repository review/merge
   gates for the follow-up commit. The first PR's green checks and merge do not
   satisfy these new gates.
4. Pending: deploy the affected resident Web service from clean committed source,
   verify its live revision and finish actual product acceptance.

Unit keyboard cases use an explicit default-activation fixture. Native Enter and
Space defaults require the actual browser cases. Preserve native RED, private
candidate results, normal source checks, CI, merge, deployment and product
acceptance as separate records. Browser network/session data and Next navigation
are isolated fixtures; native DOM and IndexedDB are real. These local results do
not establish published-head CI, resident deployment or product acceptance.
