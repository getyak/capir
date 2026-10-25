# Renewable first-party login across clients

## Outcome and boundary

Keep real-user iOS, macOS, Web and capir CLI login usable across access-token expiry,
application updates and restarts, until explicit sign-out or canonical session
revocation. Preserve the released macOS device protocol, account/workspace
identity, revocation, and intentionally expiring Lab/test/integration grants.
Transient transport, server and protected-storage failures must preserve the
renewal credential and show a recoverable unavailable state.

This task includes implementation, independent review, latest-head CI, merge,
resident backend/Web deployment, CLI installation/distribution and native releases.
Physical reboot and external device installation remain separate acceptance
claims; no simulated result substitutes for them. Browser storage removal and
browser-enforced cookie retention are platform limits, not remote revocation.

## Baseline and ownership

- Verified main: `a0895d451403b34546a8ab12fc14f7411e0e3629`.
- Managed workspace: `/Users/cubxxw/.codex/worktrees/unified-persistent-login/talent-signal`.
- Branch: `codex/unified-persistent-login`.
- Permanent evidence: `/Users/cubxxw/ops/tasks/unified-persistent-login-20261025/`.
- Rebuildable artifacts: `/private/tmp/ai-test-unified-persistent-login-20261025.v2jTWy`.
- Parent owns protocol, generic backend/contracts, integration, release and proof.
- Native owner: iOS production paths, protected storage, tests and stable family identity.
- Web owner: all Web login/claims, encrypted cookie renewal, logout and scope bindings.
- CLI owner: capir protocol, crash-safe refresh, credential locking and consumers.
- Independent reviewer owns the final security/correctness review.

## Evidence and decisions

Initial audits confirm two independent Web 8-hour gates and iOS deleting an
expired Keychain session. CLI already rotates tokens but has 7-day idle and
30-day absolute limits; a lost refresh response permanently marks it uncertain.
Updating only login expiry or helper callbacks cannot fix production paths.

The Mac capability stays separate. Ordinary real-user Web/iOS sessions enroll
a scoped renewable capability against one canonical session, using a live
bearer; Lab and Mac/CLI backing sessions cannot enroll. The caller persists the
random secret before enrollment. Renewal is idempotent across retries and
bounded access generations. The backend stores only the secret digest.

Protocol proposal (freeze after owner review):

- `POST /v1/auth/persistent/enroll`: bearer + `{renewal_secret, client_kind}`,
  where secret is 43-character base64url and kind is `web` or `ios`.
- `POST /v1/auth/persistent/renew` and `/revoke`: body proof
  `{renewal_secret, account_id, user_id, session_id}`, independent of old access.
- Enrollment/renewal return existing `SessionResponse` plus required `session_id`.
- Only `PERSISTENT_SESSION_REVOKED` (401) and
  `PERSISTENT_SESSION_INELIGIBLE` (403) are terminal authority failures.
- Capability has no idle or absolute lifetime; access retains configured TTL.
- Web stores the secret only in an encrypted HttpOnly cookie; client session
  exposes no renewal secret. Cookie lifetime is renewed on use within browser limits.
- iOS retains `WhenUnlockedThisDeviceOnly`; locked storage is unavailable,
  never sign-out. Previously frozen background capture authority is not broadened.
- CLI retains its distinct scoped grant protocol with durable refresh request
  identity and retry recovery; a different replay still triggers revocation.

Official references: [Auth.js renewal](https://authjs.dev/guides/refresh-token-rotation),
[Apple protected Keychain](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly),
[OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html).

## Milestones

1. Complete: production-path audits and frozen interfaces; Pi task `20261025-153159-a4b4ccf8` failed with 401 before code/tokens, so scoped Codex workers implemented without paid provider fallback.
2. Complete: implement backend, iOS, Web, macOS and CLI; exercise expiry, retries, concurrent use, scope, logout and revocation. Independent review findings about logout/renewal races, stream/prefix dispatch, protocol downgrade and pending-enrollment revocation have been repaired and re-reviewed.
3. Core merged in [PR 433](https://github.com/getyak/capir/pull/433) as `b9280b5795b48dbf81a469be8e321dfa6c5ff8b5`, after all applicable checks passed at `fcc816bb5c7657673834e588fa4ae0fd02463dcb`. **Active:** a focused backend follow-up preserves ended Lab operation IDs across renewable canonical-session inactivity. It must pass independent review and its applicable checks before the combined runtime rollout.
4. Deploy affected resident services and distribute native/CLI updates; verify exact live revisions and behavior. The CLI signing key matches the committed public key, but the reviewed dedicated OIDC attachment returned 403 for organization Identity EditAuth. An eligible human principal is required; do not widen workload roles or substitute a human CI token.
5. Save sanitized evidence, classify acceptance limits and reclaim only task-owned rebuildable resources.

## Verification and delivery evidence

Host proof before final source integration: Agent 592 passed / 24 skipped;
backend 1278 passed / 689 skipped (database-gated tests are separately recorded).
The final generic pending-logout proof has 51 cases, including 20 real-app
PostgreSQL cases. macOS revoke backend proof has 25 cases, including 17 real-app
PostgreSQL cases. CLI full suite has 293 passed / 1 conditional skip; the final
protocol rollback regression has 30 passing auth cases. Web focused auth proof
has 173 cases before integration, with an additional 34 macOS BFF cases.

iOS signed Simulator proof covers 95 unique related cases across the r4/r5
runs. The r4 fixture compared fractional dates against existing ISO8601 storage;
the fixture now uses whole seconds and its full structural assertion passes.
These are targeted tests, not a claim that the full native suite, physical
reboot, TestFlight distribution or installed-device acceptance has passed.
Focused macOS native execution passed 40 cases with 3 integration cases skipped;
the exact official Sparkle 2.10.0 commit was verified against Package.resolved.
The app used an isolated acceptance bundle identity, preserving the installed
signed app and its session. Web merge reconciliation adds 75 passing cases,
with TypeScript and scoped ESLint checks passing.
The final full Web suite passed 355 files / 3114 tests; full CLI passed
296 tests with one Linux filesystem-conditional skip; SDK host tests passed
14 cases; the final host/real-PostgreSQL backend proof passed 107 cases with
no skips. The final core PR's iOS smoke, macOS native/Hybrid, Web, backend,
CLI, four-platform package, documentation and security workflows passed.
CodeQL 116 was repaired in a test expectation; 117/118 were independently
verified as random-bearer capability/opaque-selector derivation and individually
dismissed as false positives with API readback. No scanning rule was excluded.
Documentation, Wiki and architecture checks pass with 112 migrations; all 110
previous migration names, order and SQL bytes match the verified baseline.

Production construction, dispatch, state change and independent readback
must be traced for each client. Test fixtures must not provide missing wiring.
Do not manipulate real account deadlines or revoke existing user devices to
simulate expiry. Use isolated synthetic databases and named disposable sessions.

## Resource state

Pause marker absent at start. About 44.7 GiB disk free, 9.78 GiB swap and 136
Node/npm processes; these are diagnostic warnings. Reuse services, serialize
heavy/native work and do not terminate unrelated processes. No task-owned
service or browser was reused as task ownership. One task-owned disposable
PostgreSQL Compose project now hosts `capri_persistent_test_unified` and
`capir_test_unified` on loopback 51991; it must be removed with its own volumes
after formal evidence is saved. Native build/test uses the Primary iPhone,
initially Shutdown, with DerivedData and results inside the registered artifact.

## Integration and release ownership

The auth checkpoint is `f47ee6f2`; main through `998caed1` (including sidebar
PRs 430/431) was merged as `59da4dcd`. Preserve already-live Web revision
`fbf7ef07a6a0dcdc21ef0dc3dc646276979b3f80` through a normal merge, including
its localization and composer recovery. The overlapping login/recovery files
must retain both continuity and localized unavailable states. This task owns
the common Web/API activation; the sidebar chat owns its subsequent UI check.

Affected resident runtimes include the primary TestFlight API and its shared
image sidecar, Web, and the separate development API on port 4318. The latter
requires its own existing configuration, network, database and volumes; do not
apply the primary staging Compose configuration to it. Unchanged independent
research agents and browser executor remain preserved.

The human authorized this release's cross-chat coordination and exactly nine
recent unused cache IDs. Their parent/child references prevented reclamation
(0 B); additional descendant deletion is not implied. The bounded follow-up
proposal retains mutable/shared/in-use records and requires explicit approval
under the local 168-hour retention policy. Evidence and exact IDs live in the
permanent task directory; no images, containers, volumes or source are cache.
Dependency inputs matched the existing deployed image byte-for-byte, so a
guarded candidate build reused all dependency layers without reaching its
1.5-GiB VM free-space floor. Extra cache reclamation is no longer a release
prerequisite; no unapproved descendant cache was deleted.

## Lab idempotency follow-up

A final lifetime audit found an existing cleanup assumption: trial and feature
override tombstones were deleted once the originating short access deadline
was more than seven days old. A renewable canonical session can return later
with the same identity; replaying an ended operation ID must still return its
ended record, rather than insert an active configuration again. Preserve only
these idempotency records while their canonical first-party authority remains
renewable. Keep trial/override/entry expiries, authorization guards, ordinary
expired-session cleanup and observation retention unchanged. Ordinary MCP
grants already use their own expiry rather than an old login-access deadline.

This nonblocking P2 was documented before the core merge. The follow-up is
isolated on `codex/renewable-login-lab-tombstones` from fresh main `b9280b57`;
native, Web and CLI source content remains identical to the verified core.
