# GET-325: Restore typing focus after removing a draft image

## Outcome and boundary

After a focused image Remove action commits successfully, return focus to the
same enabled composer. Preserve authored text and remaining attachments. A later
user focus choice, draft owner or session must cancel this handoff.

Only the conversation consumer and its regression coverage change. Persistence,
attachment identity, API contracts, provider calls and submission stay intact.

## Evidence and approach

The baseline at `8b11167` reproduced three real asynchronous focus failures:
durable success, refusal followed by retry, and rejection followed by retry.
Five ownership and user-intent controls passed. The button unmounted while the
same composer remained available, leaving the active element at the document body.

Retain a temporary operation owned by the current draft, session, trigger and
composer nodes. Wait for durable settlement and committed attachment absence.
Cancel on intervening focus, connected-trigger blur, pointer or Tab intent, owner
replacement, disabled composer or unmount. Remove every temporary listener.

## Milestones

1. Complete: reproduce through the real conversation hook and durable queue.
2. Complete in a private source snapshot: the reviewed candidate passed 13
   focused cases, including explicit blur, the last image and two removals.
3. Complete locally: the isolated branch passed 13 focused and 141 adjacent
   cases, changed-file ESLint, the four documentation checks, and Web typecheck.
   Three workspace packages each built once. A 1024 MiB typecheck ran out of
   heap; the same normal configuration passed once with a 2048 MiB heap.
   Current-head CI and normal repository merge gates remain pending.
4. Pending: verify settled active-element behavior in a real browser and deploy
   the affected resident Web service from clean committed source.

The keyboard cases exercise events with an explicit default-activation fixture;
they do not establish browser Enter/Space defaults. Happy DOM evidence does not
establish real IndexedDB, provider or deployed-product acceptance. Resident
deployment and live revision readback remain separate completion gates.
