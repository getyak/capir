# Renewable first-party login across clients

## Outcome and boundary

Keep real-user iOS, Web and capir CLI login usable across access-token expiry,
application updates and restarts, until explicit sign-out or canonical session
revocation. Preserve the released macOS device protocol, account/workspace
identity, revocation, and intentionally expiring Lab/test/integration grants.
Transient transport, server and protected-storage failures must preserve the
renewal credential and show a recoverable unavailable state.

This task includes implementation, independent review, latest-head CI, merge,
resident backend/Web deployment, CLI installation/distribution and iOS release.
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
2. **Active:** implement backend, iOS, Web and CLI; exercise expiry, retries, concurrent use, scope, logout and revocation. Generic backend and CLI focused proofs are green. Independent review found logout/renewal races and missing stream/prefix dispatch paths; repair and closure are required before PR.
3. Independent review, repair confirmed findings and complete applicable checks on the current revision.
4. Merge, deploy affected resident services and distribute native/CLI updates; verify exact live revisions and behavior.
5. Save sanitized evidence, classify acceptance limits and reclaim only task-owned rebuildable resources.

## Verification and delivery evidence

Host proof: Agent 592 passed / 24 skipped; backend 1278 passed / 689 skipped
(database-gated tests are separately recorded). Generic backend proof has
16 real-app PostgreSQL cases plus policy/auth regression tests. Existing Mac
persistence PostgreSQL regression: 11 passed. CLI focused proof: 62 host cases
and 19 route/SDK cases; full suite and review repairs are in progress.
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
