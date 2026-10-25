# ADR 0027: Renewable first-party login

Status: accepted for the user-authorized implementation, 2026-10-25.
[The execution plan](../../plans/2026-10-25-unified-persistent-login.md) owns delivery evidence.

## Decision

First-party human login must survive access expiry, application updates,
process restarts and long inactivity. Explicit sign-out, device/grant revocation,
account retirement and membership disablement remain authority boundaries.
The change does not remove the expiry of Lab runs, test-space entries,
machine integration grants or third-party provider credentials.

Web and iOS use one canonical backend session and a separate high-entropy
renewal capability. Enrollment requires a live real-user bearer for that same
session. Lab, CLI backing and Mac device sessions cannot enroll through this
protocol. The capability has no idle or absolute deadline. The backend stores
only its digest, immutable identity and an access generation. Renewal verifies
the live identity and canonical revocation state under database locks before
issuing bounded access. Retries recover the same generation without extending
the previous access deadline. The released Mac protocol keeps its stricter
browser-authorization proof and native vault.

The capability grants continuing access to the same identity; it is sensitive
authentication material rather than a new scope or model authority. Web keeps
it inside an encrypted HttpOnly cookie. iOS keeps it in the existing
`WhenUnlockedThisDeviceOnly` Keychain boundary. Neither public session data,
preferences, URLs, logs nor evidence artifacts contain it. A locked Keychain
can delay renewal; it does not establish revocation and does not authorize a
new capture while locked. Sign-out fences active work before any remote wait;
revocation retries cannot delete or replace a later login.

Legacy browser migration first returns a protected pending cookie and performs
no enrollment write. A subsequent request proves that the browser retained the
secret before enrollment can commit. This permits recovery even after the old
eight-hour JWT has disappeared. Pending logout supplies its original canonical
access proof to the revoke-only endpoint: under the same session lock, it can
terminate an expired session or wait for an in-flight enrollment to commit and
then revoke it. That proof cannot renew access or enroll an expired session.
Web, iOS and macOS retain revocation-only recovery until the server confirms it.

Browser renewal writes an independent encrypted family cookie so a late response
cannot overwrite a newer primary login. Non-authorizing login barriers and
sign-out tombstones prevent fallback to older families. Revocation journals do
not participate in authentication; bounded pending entries are retained rather
than silently discarded when a service is unavailable.

CLI retains its browser consent, PKCE, exact-origin scopes, secure keyring and
independent canonical grant. A negotiated new protocol removes human grant
idle/absolute deadlines while preserving the earlier protocol's response
shape and bounded behavior. Refresh remains rotating: the client durably
records an intent before dispatch, and an identical proof/request identity
recovers the committed result after a lost response. A different replay does
not gain authority. Cross-process credential locking and atomic replacement
remain required.

Every production request resolves usable credentials before dispatch. A
refresh failure must not replay a business mutation. Stable canonical family
identity preserves drafts, selected-workspace bindings and short-lived
confirmation forms through access rotation. A new login cannot inherit those
bindings from an earlier primary session.

Session-bound Lab configuration IDs retain their replay tombstones while the
canonical login can renew; short access expiry cannot prove a request is no
longer replayable. This retains configuration metadata, not experiment activity:
stopped or expired trials and feature overrides keep their original deadlines,
and measurement observations still expire after seven days. Ordinary ended or
revoked sessions keep the existing cleanup grace period.

## Platform and migration limits

Browser cookies have platform-enforced retention limits. Web renews its
encrypted cookie during active use within the browser's accepted maximum;
cleared storage, private-window closure or prolonged absence beyond that
maximum requires login. See [Chrome's cookie limit](https://developer.chrome.com/blog/cookie-max-age-expires)
and [Auth.js renewal behavior](https://authjs.dev/guides/refresh-token-rotation).

Updates preserve existing bundle, Keychain service, cookie, keyring and origin
identities. A still-live legacy session may enroll without another interactive
login. An already-expired legacy bearer with no renewal capability cannot
authorize enrollment; it needs one normal login. No migration revives revoked
sessions or manufactures authority from expired credentials.

Network failures, upstream errors, protected-storage unavailability and unknown
authentication-looking responses preserve the credential and expose retry.
Only a verified terminal response closes authenticated state. The UI must not
promise that clearing local data, changing devices or losing encryption keys
can preserve login.

## Verification and reconsideration

Review production construction, dispatch, persistence and independent readback
for each client. Exercise long idle, concurrency, lost responses, interrupted
storage writes, logout races, revocation, retirement and test-space expiry.
An archived IPA, processed TestFlight build, installed update and physical
device reboot are separate evidence states.

Reconsider the capability design if the threat model requires sender-bound
device keys or if actual compromise/replay evidence changes the recovery
tradeoff. The [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html)
informs bounded access and rotating CLI refresh; the Web/iOS first-party
capability is a separate opaque session protocol, not an OAuth refresh grant.
