# ADR 0025: Same-owner desktop text recovery

Status: implementation pending native build and live acceptance, 2026-10-23.

## Context

A real revoked-session check reached the native browser-login surface, but
cancel/retry replaced the original destination and a new WebKit store could not
read the old unsent text. ADR 0021's isolated login stores remain necessary:
neither response cancellation nor a matching display name settles identity.

## Decision

Retain fresh store selection, epochs, retirement, correlated consume/readback,
and all credential boundaries in ADR 0021 and ADR 0022. Never copy cookies,
enumerate private storage, revive an old store, or move an outbox into a new
login. Add one narrow recovery path for one bounded unsent **text** draft.

The fixed first-party read-only status route returns the stable non-authorizing
draft storage partition after checking the live primary session. Native records
only the verified account ID, user ID and partition alongside the exact store.
An existing healthy store can establish this metadata through an isolated-world
status fetch with fixed origin, redirect rejection and stale-read fencing.
Missing or invalid metadata cannot be replaced by DOM, display-name or local-key
claims. This observation does not settle an unresolved login operation.

Before the first deliberate recovery login rotates its store, native reads only
the exact draft key for the frozen destination and its verified partition. The
validated text and original expiry remain in coordinator memory across cancel
and retry. Reading storage does not grant authentication or execution authority.
The new login still completes its real consume and live status protocol first.
Only identical verified account, user and partition can restore the text into
the fresh store, before the workspace loads. A different identity/partition
receives neither text nor the old private destination. An existing different
draft is never overwritten. Origin changes drop the in-memory recovery context;
late/cancelled callbacks cannot admit a replacement store.

The pre-rotation text read has a three-second native deadline; late WebKit
callbacks cannot change its result. An unavailable capture never deletes the
donor store and does not indefinitely block a fresh login. Its notice states
that the old page/text could not be verified, without claiming restoration.

Local draft restoration is separate from authentication. A failed local write
cannot turn proven authentication back into an unknown login result. Enter the
verified workspace with an honest notice and retain the capsule in memory for
an explicit copy or discard action. Copy requires another first-party live
owner readback and the current generation/store epoch; clipboard write success
is required before removing the capsule. Retain at most eight unexpired failed
capsules, deduplicated by owner, destination and text. At that bound the UI
states that the new draft remains only in its quarantined donor store. Nothing
is submitted automatically. Different-owner login and origin changes clear
these transient capsules.

The actual account logout action uses a fixed first-party login destination
with `intent=sign-out`. The native main-frame/KVO login policy consumes that
local cleanup intent and clears the return target and all transient capsules;
it never treats it as authentication evidence. Foreign origins cannot trigger
this path. An ordinary expired-session login destination retains recovery
intent. Closing and reopening the native scene applies explicit logout cleanup
before considering any previous completed-login presentation.

Authentication loss quarantines bounded local text rather than deleting it.
Explicit sign-out, verified different-account pruning, denied/deleted Session
access and existing expiry/deletion rules retain their cleanup semantics.
Outbox rows and image bytes are excluded from this native transfer; new private
content is never automatically submitted by recovery.

## Limits and evidence

This is same-process text recovery. It does not promise unsent attachment
recovery, process-crash recovery, or automatic import from a legacy store with
no verified owner metadata. The UI names these limits. A persistent encrypted
recovery capsule requires a separate retention/deletion design.

Required evidence includes same-owner revoke/cancel/retry, account/partition
mismatch, original TTL, source retirement, stale completion, destination
conflict, storage failure, and the real signed/native interaction. Source tests
and a successful Web build do not establish native acceptance.
