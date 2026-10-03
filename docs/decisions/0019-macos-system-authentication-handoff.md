# macOS system authentication handoff

Status: superseded for macOS primary login by [ADR 0022](0022-browser-owned-macos-login.md), 2026-10-01. The earlier per-provider native login/link design below is historical rationale, not an implementation prerequisite. Account settings remain browser-owned. [ADR 0018](0018-unified-account-login-and-sync.md) still governs canonical identity and credential changes.

## Problem and outcome

The macOS app uses an origin-partitioned WKWebView cookie store. Its existing
external-link policy cancels Apple/Google navigation and offers to open the URL
in another browser. The callback cannot access the original attempt cookie.
Cancelling the native prompt also leaves both Web OAuth buttons pending.

Use ASWebAuthenticationSession from a first-party authorization entry, then
redeem a short-lived proof inside the original WKWebView. Successful login must
return that window to the canonical account. Cancellation restores usable
controls. Google must never authenticate inside WKWebView.

## Protocol

New hosts publish display-only `authProtocolVersion: 1` metadata. Only capable
hosts receive plain same-origin `/desktop-auth/request` links for provider
login/link. Ordinary browsers keep their existing flow. Older hosts must not
enter an unsupported protocol. Display metadata is never authorization.

1. Native intercepts only the exact configured-origin main-frame request path,
   with allowlisted provider and immutable purpose. It generates a random
   verifier and state in native memory. It submits the S256 challenge and state
   to `POST /api/desktop-auth/prepare` using the original WKWebView cookie jar.
2. Prepare checks exact Origin, sets an attempt-specific HttpOnly pairing cookie, and redirects
   to a fixed pending path. Link authorization scope, recent reauthentication,
   session fingerprint and credential revision come from the server session.
   Every purpose captures the initiating authentication fingerprint, including
   an explicit anonymous state for login; an intervening login must not be
   overwritten by a delayed callback.
   Client-supplied account/user IDs are not accepted as proof.
3. Native accepts pending navigation only for its active generation and state.
   It starts ASWebAuthenticationSession at first-party
   `/desktop-auth/authorize?attempt=<opaque-id>&state=<native-state>`. The server
   verifies the state against the stored hash and retains it in a short-lived
   sealed browser-attempt cookie for the final callback. It cannot reconstruct
   the raw state from its database hash. Provider state/nonce/PKCE cookies are
   created there, in the system authentication browser.
4. Provider completion retains the established Apple HTTPS form-post callback.
   A confirmation view names the verified identity and intended effect. An
   unrelated existing browser login is not fresh provider proof. Completion
   approves the attempt; it does not yet attach a credential.
5. A fixed `com.talentsignal.macos.auth://complete` callback carries only attempt,
   one-time code and state. Native validates scheme, host, path, state, origin
   and current attempt generation before submitting a same-origin
   `POST /api/desktop-auth/consume` in the original WKWebView.
6. Consume requires the pairing cookie, code and verifier. It atomically
   rechecks all bindings, unchanged initiating auth fingerprint and expiry,
   consumes the attempt and creates a separate
   backend device session for login, or commits the existing linking transaction.
   The Web server sets its normal HttpOnly cookie. Link preserves the original
   WKWebView login, account and drafts.

Use `WKWebView.load(URLRequest)` for fixed prepare/consume POST requests with
the precise Origin and Content-Type. Keep the verifier out of page DOM and the
JavaScript bridge; never provide a general credential bridge or arbitrary
evaluator requested by Web content. Tokens, provider credentials, bearer sessions and
Auth.js cookies must not enter URLs, logs, metadata or JS bridge messages.
Never copy the system browser's cookie jar into WKWebView.

## Authority and lifecycle

One backend `desktop_auth_attempts` state machine owns the durable protocol:

`prepared -> authorizing -> approved -> consumed`, with terminal
`cancelled` and `expired` states.

Store opaque ID, provider, purpose, protocol version, exact Web origin/backend
environment, challenge, state hash, pairing-secret hash, expiry, originating
session fingerprint and scope (explicitly anonymous or authenticated for login;
authenticated for link), credential revision,
reauthentication reference, approved verified proof reference, code hash and
lifecycle timestamps. Use a five-minute attempt and at most a one-minute code.
Consume is atomic, single-use and replay resistant. Hash opaque secrets at rest.

Pairing cookies have an attempt-specific name and bounded lifetime/count. A
consume/cancel response clears only its own attempt cookie. A late response
from an older generation must never replace or remove a newer pairing cookie,
including across windows sharing one origin store. Serialize native starts,
but do not rely on that alone to prevent HTTP response races.

Return paths and callback are fixed by purpose; reject arbitrary redirect URLs.
Session revocation, account switch, origin change and window destruction
invalidate outstanding attempts for both login and link. Credential changes
also invalidate outstanding link attempts. Lab accounts cannot
use the handoff to cross into real-account scope; include the new table in
classified cleanup and data-inventory checks.

Provider cancellation, timeout, offline failure and native window closure
cancel the active attempt, clear pairing state and navigate to the fixed login
or settings return path with a recoverable status. Controls become usable again.
Ignore late callbacks after cancellation or generation change. Start at most
one authentication session per native window.

## Implementation ownership and acceptance

Implement as a second bounded Pi phase after unified identity is reviewed, using
the first phase's provider verification and credential commit primitives.
Suggested files: a macOS `DesktopAuthenticationSession` service and tests,
minimal `QuietWorkspaceView` integration, Web desktop-auth routes/server helper,
backend handoff module/routes/migration and shared contracts. Avoid duplicating
identity resolution or making a parallel credential store.

Required tests include wrong verifier/state, callback tampering, stale generation,
iframe entry, cross-origin request, replay, timeout, revoke, concurrent start,
wrong browser identity and last-method linking constraints. Native cancellation
must be exercised in the actual window. Live Apple/Google proof and returning
to the original macOS window are separate from injected provider tests.

After login, verify bidirectional People and conversation Session IDs between
the macOS window, Web and iOS. Device authentication sessions remain independent.

## Sources

- [Apple ASWebAuthenticationSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession)
- [Google sign-in best practices](https://developers.google.com/identity/siwg/best-practices)
- [OAuth for native apps, RFC 8252](https://www.rfc-editor.org/info/rfc8252/)
