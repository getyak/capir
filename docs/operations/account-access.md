# Account and workspace access

## Everyday access

Use the account's configured Google, Apple, or email/password identity. A federated
login does not create a default password. Web **Account and security** reports the
actual configured methods and active sessions from the authenticated backend, and
Settings manages sign-in methods: connecting Apple/Google, setting or changing a
password, and removing a method. Every change first proves the current identity,
and at least one usable login method always remains.

## macOS browser sign-in

The Mac primary-login surface offers **Sign in in your browser**; it never collects account passwords, registration fields or provider credentials. The system authentication browser reuses a valid Web session where supported, then asks the user to confirm the displayed account for this Mac request. Otherwise the ordinary Web login and onboarding flow returns to that confirmation. A matching request hint helps identify the operation being approved. Cancelling keeps a usable retry surface.

Browser approval creates a separate, revocable Mac backend session through a short-lived, one-use grant. It does not copy the browser cookie, attach a credential, change the account or grant local capture permission. Browser and Mac sign-outs remain independent. The Mac opens the workspace only after live backend identity readback in its selected WebKit store; seeing a callback or a browser success page alone is insufficient.

Existing healthy Mac sessions reopen directly. An expired session returns to the same browser-only entry. An uncertain exchange offers **Check sign-in result** and deliberate **Sign in again**; recovery does not replay a potentially consumed grant or report cancellation as rollback. A new primary login isolates old late cookie responses in a separate persistent store and preserves quarantined local drafts. [ADR 0022](../decisions/0022-browser-owned-macos-login.md) owns the design and [the active plan](../../plans/2026-10-01-macos-browser-login.md) distinguishes implementation proof, live-provider verification and installed-release acceptance.

## One account, normalized email ownership

One Talent Signal account is recognized by its primary email; Apple, Google and
password are credentials for that account. Email lookup uses one shared
trim/lowercase normalization. Gmail dots, plus tags, and distinct domains are not
collapsed, and Apple relay addresses are never rewritten. Provider identity is
the validated `(provider, issuer/subject)` pair; an email match is a collision to
resolve, never authority over an existing account. Automatic email linking
(`allowDangerousEmailAccountLinking`) is never used.

PostgreSQL arbitrates normalized-email uniqueness across every provider through
the `account_email_reservations` primary key plus a users-table trigger; all
registration and linking paths claim their reservation in the same transaction.
Revoking membership never frees an email or revives an old credential. Historical
same-email accounts are reported and reserved as an explicit `conflict` state
with a NULL owner; existing owners keep their authenticated access and no record
is renamed, merged, or deleted. Authenticated recovery explains the exact
conflict; the historical duplicate screen below resolves it.

## Verified password signup

Password registration starts a short-lived pending request that stores only a
password hash and a verification-secret hash. Nothing reserves an email before
verification, so an unverified signup can never pre-hijack an address or block a
verified provider signup. The confirmation link requires an intentional button
press (a GET or mail scanner never creates an account), ownership is arbitrated
in the confirming transaction, and a concurrently created owner wins: the
pending password is discarded, never inherited. Retrying the same unverified
form rotates the code on the same pending request; a different password starts a
separate request. Expired, replayed, or over-attempted codes fail generically.

Delivery uses the server-configured Resend adapter (`RESEND_API_KEY`,
`RESEND_FROM_EMAIL`, `POST https://api.resend.com/emails`) with a timeout,
sanitized errors and idempotency keys. Tests inject an isolated mail sink.
Both deployment Compose files pass these server-only settings to the API. Set
`AUTH_VERIFICATION_BASE_URL` to the Web HTTPS origin for confirmation links;
otherwise the first allowed origin is used. Keep password registration disabled
until the mail transport and an authorized recipient have been verified.
Production never returns or logs verification codes and never pretends an
unconfigured or failed transport succeeded: it fails with an honest
`EMAIL_DELIVERY_UNAVAILABLE`/`EMAIL_DELIVERY_FAILED` state and no account is
created. Existing sign-in and authenticated linking keep working while delivery
is unavailable. Existing password accounts remain explicitly legacy-unverified
until real ownership proof is recorded.

## Sign-in methods and step-up

Each provider occupies one row (Apple, Google, Password) with its real state:
Connected, Not connected, or Needs email verification; the provider account hint
shows only after authenticated verification. Adding a method never creates a
workspace, moves records, or overwrites the primary email, and linking never
replaces the current session with the provider's session.

Every credential change uses a short-lived, single-use attempt bound to the
account, user, auth session, provider, intent, backend origin (derived from the
actual request), nonce and the account/user revisions its step-up proof was
checked against; commit rechecks all of them. Attempts fail recoverably on
expiry, replay, cross-provider, cross-origin, stale-tab, revoked-session and
concurrent use. Failed password step-ups persist their lockout bookkeeping and
mint no attempt.

Current identity is proven with the account password or a fresh assertion from
an already linked provider. Provider-only accounts therefore reauthenticate
with a linked provider; the new password, if any, is collected after
reauthentication and never travels through redirects, URLs, or cookies.
Current-provider proof and new-provider proof are distinct purposes with
distinct challenges. Apple returns by cross-site form POST, so the transient
operation cookie is deliberately `Secure; SameSite=None` while the long-lived
session cookie keeps its existing policy; a short-lived one-use proof is staged
at the callback and the operation completes on the fixed same-origin
`/workspace/settings/link-complete` route after the original session and
revisions are revalidated. A missing, cancelled, stale or wrong-purpose attempt
fails closed to Settings and never falls through to ordinary login. Success
requires authoritative backend settings readback.

Unlink requires recent proof and cannot remove the final usable login method,
including accounts with historical duplicate provider rows. Unbound OAuth with
an existing email says to sign in with an existing method, then connect the new
method in Settings; no empty second account is created. Public errors disclose
no names, data counts, linked provider details, or workspace information.

## Verified secondary emails

A linked provider that verifies an address different from the primary email
reserves that exact normalized address for the existing canonical account in
the same transaction that links the provider, under the same email lock and
uniqueness arbitration as registration. An already-linked subject that
presents a newly verified address is arbitrated before its hint moves. The
same owner's existing claim is idempotent and records explicit provenance
(`verification_source`, `verified_at`); another owner or an unresolved
historical conflict fails closed, and no second account is ever created for
that address. Unverified or missing provider hints are labels, never claims,
and historical hints are never backfilled as verified.

Established issuer/subject credentials remain authoritative for sign-in when a
provider changes its email: ordinary login never takes over a foreign address,
moves an account, or revokes a valid credential. Unlinking retains the verified
claims and their provenance; releasing or reassigning an address needs a
separate, explicitly verified flow. Reservations never become password
identifiers: sign-in stays the primary email or username plus the configured
password, and signup or reset never inherits a password.

## Historical duplicate resolution

Historical same-email accounts keep separate data. Both credentials are freshly
verified before any cross-account inventory is shown, and both parties'
account/profile revisions and proof timestamps are frozen at prepare and
rechecked under stable lock ordering at commit; removing or changing either
proven credential invalidates the prepared request. The initiating auth session
is revalidated inside the commit transaction, so a request admitted before a
session revocation can never commit.

The frozen dual-proof state also includes every email reservation related to
both parties (normalized address, owner, state, revision and verification
provenance), locked and rechecked in stable order at commit. Reservations
unambiguously owned by the retiring user transfer with the credentials; a
changed claim or an unexplained third-party claim refuses the transfer and
requires renewed preparation. Unknown historical hints never become claims as
a side effect of reconciliation, and resolving the primary collision never
takes ownership away from an unproven third party.

Only an entirely empty duplicate may transfer, and "empty" uses the full
classified account-data inventory (Lab table manifest plus every `*_account_id`
ownership column, Lab workspace entries/media receipts, and the system
harness-generation baseline): extra users, product rows, retired-login
tombstones, nonzero generations, associations, or unclassified tables all make
the case review-required. An empty transfer moves the credentials to the
explicitly selected canonical user, retires the redundant login with an auditable
alias/tombstone, revokes its old sessions, resolves the email reservation to its
single canonical owner, and marks the source account retired in one transaction.
Non-empty duplicates stay a protected review-required state with a concrete
inventory; nothing is merged or re-parented by generic SQL, and all data remains
accessible through its original authenticated boundary.

Account retirement is persistent state on the account row. Every governed write
takes a shared lock on that existing account row and verifies it is active
through commit; database guards cover direct and indirect ownership and both
OLD/NEW scopes on scope changes. If a product write commits first, reconciliation
sees that data and refuses the empty transfer; if retirement wins, the late write
fails `ACCOUNT_RETIRED` and adds nothing to either account. Late writes are never
redirected into the canonical account.

## Cross-device synchronization

People and conversation Sessions are canonical backend records shared by iOS,
Web, and the macOS Web surface. On startup, foreground/focus, network recovery
and relevant mutations, one shared refresh coordinator per surface refreshes
People AND Session history together on a bounded active interval, pauses hidden
polling, coalesces in-flight work, and drops late responses after an account or
endpoint switch. Refresh preserves search, scroll, selection, composing text and
pending writes; failed sync keeps recovery state instead of marking work
synchronized; deletes propagate and offline resurrection is rejected. Private
conversations keep their explicit privacy semantics and existing retention.

## Account onboarding

Every successful Google, Apple, account password, or registration sign-in
continues to `/onboarding?callbackUrl=<original safe target>`. The onboarding
page decides from canonical backend state whether the step is required and
redirects returning users immediately. The shared development-fixture email
login keeps its existing direct behavior. Onboarding is a property of the
authenticated
user, stored as additive `users` columns (`onboarding_status`, `onboarding_focus`,
`onboarding_profile_url`); it is never a candidate or contact record. The
existing `users.profile_revision` remains the single revision for both profile
and onboarding writes.

`GET /v1/account/onboarding` returns the canonical state and
`POST /v1/account/onboarding` records `completed` or `skipped`. Writes recheck
the active session transactionally, reject Lab users, share the account lock
order with account management, reject stale revisions, and reuse
`account_access_events` idempotency under the `onboarding` kind. Audit details
carry revision and status only; names, focus, and URLs never enter the trail.
Empty focus or profile URL clears the stored value.

`POST /v1/account/onboarding/preview` reads exactly one user-supplied public
HTTPS page through a bounded, DNS-pinned HTTPS client (same-origin redirects,
public IP and per-hop robots checks, one page at depth 0, byte/time limits) and returns at
most a 600-character untrusted excerpt. Nothing is persisted, no contact or
model call is created, and the excerpt is never promoted into the saved profile
automatically. Local, private, userinfo-bearing, and IP-literal URLs are
rejected. A denied or unreadable page (for example LinkedIn) returns a truthful
readable error; manual entry still works.

## Apple sign-in setup

Apple availability requires valid supplied config and HTTPS. The callback uses
`response_mode=form_post`, so its state and nonce cookies must be
`Secure; SameSite=None`; plain-HTTP deployments report Apple as unavailable
rather than showing a button whose callback cannot validate. The long-lived
session cookie policy is unchanged.

The preferred Web configuration generates a short-lived client secret from a
Sign in with Apple private key:

- `AUTH_APPLE_ID`: Apple **Services ID** (Web Services ID).
- `AUTH_APPLE_TEAM_ID`: ten-character Apple Team ID.
- `AUTH_APPLE_KEY_ID`: ten-character Key ID for the `.p8` key.
- `AUTH_APPLE_PRIVATE_KEY`: PEM-encoded P-256 `.p8` private key.

The Web server confirms the key is an EC P-256 key and signs a fresh 15-minute
ES256 client secret on every request, so a long-running process never reuses an
expired token. Supplying any one of the three key settings requires all three
plus `AUTH_APPLE_ID`; a partial set stays unavailable and never silently falls
back to a static secret. Malformed or partial config returns no credentials and
logs no secret or error data.

`AUTH_APPLE_SECRET` remains supported as a legacy pre-generated client secret.
Its JWT is parsed and checked for `alg: ES256`, a key identifier, audience
`https://appleid.apple.com`, `sub` equal to `AUTH_APPLE_ID`, a team-shaped
issuer, and finite `iat`/`exp` values no more than 15,777,000 seconds (six
months) in the future and with a total lifetime no longer than that ceiling.
The 15,777,000-second bound is Apple's documented maximum. This is metadata
validation only: it cannot prove Apple authorized the signing key. Only
Apple's token endpoint can, by accepting or rejecting the secret at exchange
time.

Create the key under **Certificates, Identifiers & Profiles → Keys → Sign in
with Apple** and download the `.p8` once (Apple never shows it again). Rotate by
replacing the key settings (or the legacy secret) in Infisical and restarting
the Web process; generated secrets refresh automatically. See
[Create a Sign in with Apple private key](https://developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key/),
[Creating a client secret](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret),
and the [Auth.js Apple provider](https://authjs.dev/getting-started/providers/apple).

- Staging Web callback:
  `https://smile-m4-minimac-mini.tail25e61f.ts.net:10443/api/auth/callback/apple`.
- Web: `AUTH_APPLE_ID` is the Apple **Services ID** (Web Services ID); the
  callback URL is `https://<host>/api/auth/callback/apple`.
- Backend: `APPLE_SIGN_IN_AUDIENCES` must include the Web Services ID (and the
  native bundle ID for the iOS client). The backend independently verifies the
  identity token audience, nonce, signature, issuer, and expiry before opening a
  session.

Real Apple secrets are not present in this repository. Missing or malformed
config keeps the provider unavailable; nothing is faked as enabled.

On Web, the avatar menu opens `/workspace/settings` inside the workspace. In the
macOS client, its Settings entry and `⌘,` open the same independent native
Settings window; Web-owned account panes remain bound to the backend session,
while device controls remain local. Settings never use the legacy fixture
fallback. Profile names and workspace names are editable; email and provider
identity remain unchanged.

## Ownership and management

A new personal workspace explicitly belongs to its creator. Migration assigns an
owner to existing personal workspaces only when exactly one active real user is
the sole member. Ambiguous and fixture workspaces retain their existing roles;
they are not silently claimed. Ownership is separate from the existing
`admin`/`member` session contract so existing clients remain compatible.

Owners manage the space name, existing member roles/status, and transfer ownership
to another active real member. Admins manage the name and ordinary members; they
cannot grant admin privileges, change another admin, change themselves, or modify
the owner. Ownership is workspace-scoped, never platform-wide. This version does
not add invitations or a global multi-workspace identity migration.

Stopping a member or changing their role revokes their sessions. Reinstatement
requires a new login. Each user can revoke their other sessions; current-session
exit uses normal sign-out. Mutations recheck current authority, reject stale
revisions, and retain idempotency and an account-scoped management record.
Access-event details retain target IDs, member role/status transitions, ownership
transfers and actual session revocations in the same transaction. Profile and
workspace events retain revision changes without copying personal names into the
trail. Events predating migration `069_account_access_event_details` have unknown
(`NULL`) details; their history is not reconstructed. Replays preserve the original
event, and restoring membership never revives a revoked session.
These privileges do not authorize candidate-data collection or external effects.

## Default development fixture

Only an explicitly simulated, non-production seeded backend provides:

| Field | Development fixture value |
| --- | --- |
| Username | `cubxxw` |
| Email | `cubxxw@talentsignal.local` |
| Password | `cubxxw` |
| Workspace / role | `fixture-alpha` / admin |

Use the email in the Web email field. These are public synthetic fixture values,
not deployment credentials. Seeding resets fixture state and must not run against
the shared TestFlight or production database. The seed command refuses production
or disabled simulated authentication. Legacy configured default-account Web
providers are disabled in production, even if their flags are set.

Other `simulated_human` fixture identities have no password. Use the explicit
simulated API in local evaluations, or an isolated internal test workspace.

## Internal test workspaces

`/workspace/settings/testing` uses the existing server-controlled Lab capability.
A real signed-in user creates an empty, isolated test account for 1, 4, or 24 hours.
No shared test password is required. Entry credentials remain in encrypted,
HttpOnly cookies and the backend stores their hashes. The primary session stays
separate; a persistent banner returns the user to their own workspace.

Expired or mismatched test-session cookies fail closed. They never silently turn
an in-progress test action into a real-workspace write. Workspace requests carry
the rendered account scope, and stale tabs are refused if that scope changes.
The Web API ingress requires a rendered workspace identifier for task-history reads
and workspace mutations, including older tabs that already hold an analysis receipt.
Native image links and event streams retain their route authorization.
Login, public demo and extension protocols keep their own boundaries. Extension
task creation, exact task readback and keyed recovery use the existing session
fingerprint, verified by the route before accessing content. Response preferences
and artifact downloads also retain their stronger session binding. Standalone
contact pages share one authenticated layout and workspace identifier; clients
with a missing identifier refuse local API requests before network access.
Entering another test workspace requires returning first while a test cookie is
present; the existing credential is not overwritten by a sequential entry.
When the primary login is missing, leaving a test workspace clears only the local
test cookie and opens login recovery; a remote leave failure keeps retry state.
Screenshot analysis and telemetry also reject missing scope identifiers within
their routes before reading private payloads.
This includes telemetry creation, batches and completion, even when they precede
the primary product request: private trace content must use the same
`workspaceSessionFetch` boundary as the action it records. A rejected product
request cannot undo telemetry already retained under the wrong account.
Test data may contain synthetic or explicitly authorized testing material only;
isolation is not consent for external processing or retention.

Ending a test workspace revokes access before data cleanup. The UI distinguishes
cleanup pending/failed from verified deletion. New database tables must be
explicitly classified in the Lab cleanup manifest and account-scoped tables need
the Lab write guard. Unknown tables block creation/cleanup instead of silently
leaving data behind. Restore normal access before creating another workspace.

## Verification

The account integration evaluation requires the disposable `account_proof`
PostgreSQL database and `ACCOUNT_EVALUATION_DATABASE_URL`. Run migrations first,
then `pnpm --filter @talent-signal/backend exec tsx src/evaluation/runAccountManagementEvaluation.ts`.
It checks ownership, cross-account denial, replay/stale decisions, member
revocation, transfer, verified signup, and the full isolated test-workspace
lifecycle.

The account identity integration suite runs against a disposable loopback
PostgreSQL database through `ACCOUNT_IDENTITY_TEST_DATABASE_URL`:

```
DATABASE_URL=<disposable> pnpm --filter @talent-signal/backend migrate
ACCOUNT_IDENTITY_TEST_DATABASE_URL=<disposable>   pnpm --filter @talent-signal/backend exec vitest run accountIdentity
```

It covers provider registration orderings and concurrency, historical collision
reservations, verified signup/replay/expiry/resend/transport failure, step-up
lockout persistence, attempt binding (replay, cross-session, wrong origin),
linking idempotency and conflicts, last-method protection including historical
multiplicity, ambiguous legacy password login, dual-proof freshness, admitted
late-write retirement fencing, and provider-only first-password/other-provider
flows. Provider proofs in tests are injected verifier fixtures; they are never
live Apple or Google evidence. The legacy backfill is separately applied over
pre-migration fixtures (see `docs/evaluations/account-sync/`), and live provider,
delivery and multi-client acceptance remain parent-owned checkpoints.

Credentials for deployed services remain in [Infisical](secrets.md). The Notion
home contains a short access reference; this document owns operational details.
