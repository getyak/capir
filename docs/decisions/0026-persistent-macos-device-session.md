# ADR 0026: Persistent macOS device sessions

Status: accepted for the user-authorized implementation, 2026-10-25.
[The execution plan](../../plans/2026-10-25-macos-persistent-login.md) tracks delivery evidence.

## Decision

A Mac remains signed in across updates, relaunch, reboot and long inactivity.
Short access/cookie expiry triggers automatic renewal. Primary authentication
and explicit account confirmation remain browser-owned.

The app generates a random device capability and persists it in macOS Keychain,
bound to canonical Web origin, selected persistent WK store and account/user,
before enrollment can commit. It never enters preferences, registry JSON,
rendered content, callback URLs or logs. Signed updates keep stable bundle and
Keychain service identity.

Enrollment proves an active real Mac session minted by consumed browser
authorization. Healthy legacy Mac sessions can enroll on update; an expired
legacy session without the capability requires one browser login. Backend
storage contains hashes and immutable origin/canonical-session ownership.
The capability has no idle/absolute expiration. Session revocation, user
disablement and account retirement prevent renewal. Dormant devices remain
visible and revocable in Account and security.

Renewal locks the account/session and derives generation-specific short access.
Rotation occurs within a renewal window; concurrent calls and lost responses
recover the current generation. Previous access is never extended past its
original expiry. Ordinary Web/iOS session duration remains unchanged.

The server-authorized persistent provider alone puts the canonical device
session ID in the encrypted JWT. Conversation, capture and selected-workspace
bindings use that exact ID with account/user and separate domain tags, so an
access rotation does not invalidate a mounted conversation or lose a selected
test workspace. A new primary session changes the binding; ordinary Web keeps
its exact-access binding. Live short-access authorization and purpose-specific
capability deadlines still apply. Initial healthy legacy enrollment may rebind
an already verified selected test workspace, preserving its original encrypted
cookie expiry; a new canonical primary login cannot inherit that selection.

Native proof uses bounded JSON POSTs to a fixed first-party BFF route.
Custom-header, origin and fetch-metadata checks protect ambient-cookie
enrollment. Supported Auth.js Credentials/signIn installs the HttpOnly cookie.
A separate live backend readback in the selected WK store must verify identity
before workspace admission. Read-only status writes no cookies.

## Races and recovery

Startup, foreground/wake, expiry and an active timer share one renewal owner.
Normal renewal preserves conversation/draft/store state. Transient service,
transport and locked-Keychain failures retain the capability and drafts; they
do not establish revocation.

Native recovery verifies the live primary account, user and canonical device
session separately from the selected business workspace. Authorized test-space
selection can make those account IDs differ. Capture context carries both
identities; the primary tuple must match the renewal receipt while business
owner, login binding, store epoch and processing policy retain their own
guards. Account equality between these two roles is not authorization proof.
Until that primary proof is verified, every read must rejoin recovery. Failed
attempts grant no later admission through an existing business cookie.

Explicit sign-out synchronously disables renewal, persists a fresh empty store
epoch and discards only the former scope's capability. Late writes stay in the
retired store. Server revocation and renewal share canonical session locking;
renewal cannot revive revoked state or change account ownership.

A global TTL extension affects other clients and still expires. A cookie alone
is constrained by browser retention. A permanent access bearer removes bounded
access expiry. The separate Keychain capability adds a narrow native credential
boundary while retaining explicit identity and remote device revocation.

This refines ADR 0022 only for the dedicated first-party device capability.
Provider credentials, bearer access and browser cookies remain outside native
preferences/callbacks. Readback and late-cookie isolation rules still apply.

## Sources

- [Apple TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains):
  SecItem defaults to file-based Keychain; data-protection groups require
  appropriate signing entitlements/provisioning.
- [Apple SecItemAdd](https://developer.apple.com/documentation/security/secitemadd(_:_:)):
  protected items use Security framework APIs.
- [Auth.js Next.js signIn](https://authjs.dev/reference/nextjs#signin):
  supported server Credentials cookie installation with redirect disabled.
