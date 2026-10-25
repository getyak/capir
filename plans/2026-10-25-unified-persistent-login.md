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

- Initial verified main: `a0895d451403b34546a8ab12fc14f7411e0e3629`.
- Managed workspace: `/Users/cubxxw/.codex/worktrees/unified-persistent-login/talent-signal`.
- Initial core branch: `codex/unified-persistent-login`; current CLI publication branch: `codex/cli-publication-edit-binding`; final documentation branch: `codex/login-release-receipts`.
- Permanent evidence: `/Users/cubxxw/ops/tasks/unified-persistent-login-20261025/`.
- Active task-owned rebuildable artifacts are enumerated in the permanent `state.json`. The original `/private/tmp/ai-test-unified-persistent-login-20261025.v2jTWy` disappeared externally; that removal is not credited to this task. Completed native recovery artifacts were precisely removed after formal evidence retention.
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
3. Complete: core [PR 433](https://github.com/getyak/capir/pull/433), retention/readiness [PR 435](https://github.com/getyak/capir/pull/435), browser capture/native fixture [PR 437](https://github.com/getyak/capir/pull/437), PostgreSQL timeout [PR 438](https://github.com/getyak/capir/pull/438), and strict native acceptance [PR 439](https://github.com/getyak/capir/pull/439) passed independent review and applicable latest-head gates, then merged normally. Exact commits and gate receipts are retained in the permanent evidence directory.
4. Backend, Web and installed macOS are deployed within the real-service acceptance boundaries below. TestFlight **0.2.39 (20261025214048)** is processed from `500d327f`; its actual IPA bytes, source cohort and production endpoint are verified. Browser extension **0.2.1** is published and its three release assets are byte-verified. CLI **0.2.4** is officially published and installed from the signed darwin-arm64 archive. A normal command automatically migrated the original grant to the persistent protocol without interactive login; owner, grant, scopes and origins are unchanged, while refresh and absolute deadlines are NULL. Its same-source actual provider contract passed with confirmed own-resource cleanup.
5. Sanitized evidence and acceptance limits are retained in `DELIVERY.md` under the permanent evidence directory. Independent final release/client review, documentation merge and exact resource closeout complete the delivery; older failed runs and rollback versions remain separately retained.

## Verification and delivery evidence

Current Web readback is **e5d06b90 / P541h5YZYzw_EsQ8ynks4** at the final
22:37 UTC snapshot. Its 41 authentication/config/dependency inputs match R4/R5;
active pointer, clean release source, build and listener identities agree.
All six fixed public GETs passed, including both primary and legacy API
manifest/readiness at `1dba58c6`. Independent review found no P0/P1/P2.
R4 `142d9d63` remains the last actual login/renewal/SSR/BFF/sign-out lifecycle,
with confirmed own-session cleanup; current evidence inherits its measured
code cohort and adds public deployment readback. No new current-Web login or
private environment/AUTH_SECRET/old-cookie continuity is claimed. Historical
b7c3 and b0ce snapshots remain intact.

The CLI publication repair in [PR 446](https://github.com/getyak/capir/pull/446)
passed independent review, 99 focused tests and all applicable exact-head gates,
then merged normally as `81362b1b` with the complete reviewed tree preserved.
Exact-main CI **40239225135** and Security **40239225192** passed. The two main
Vercel previews actually failed because of deployment rate limits; an independent
source/consumer review confirms that the five publication-tooling files do not
enter Web/API/native application inputs and the GitHub publisher does not consume
those previews. The failure states remain retained, rather than described as green.

Actual main-only no-secret contract **40240608250** ran from that exact source
and passed fresh draft rediscovery, binary asset verification, explicit edit
identity, asset deletion/reupload and response-bound draft cleanup. The owned
release **423702042** returned DELETE 204 then GET 404; the exact probe Git ref
also returned 404, and independent parent readback confirmed main remained 81362.
This is the required real job-token proof before an official version tag.
The earlier 500d contract **40236765053** remains failed despite separate reviewed
cleanup of its acknowledged draft; its observed omitted-PATCH-tag defect led to
the narrow explicit tag/source binding repair. Official 0.2.2 and 0.2.3 tags and
empty failed-publication drafts remain immutable. No workload role, quota or
human CI token was substituted.

Official [capir 0.2.4](https://github.com/getyak/capir/releases/tag/capir-v0.2.4)
run **40241123814**, attempt 1, passed four real platform archive smokes,
Infisical OIDC signing and publication from exact `81362b1b`. All seven immutable
assets match the RSA-SHA256 signed complete manifest; the stable channel's
three files are byte-identical and promotion followed version publication.
The shared GitHub latest release was preserved. The official installer backed
up the original launcher and retained its old runtime, then installed the
managed 0.2.4 command with the exact source/platform/build identity.

One ordinary test-status command for a fixed nonexistent run automatically
migrated the existing grant after natural access expiry. Its authenticated
business 404 is correctly mapped to `CAPIR_TEST_NOT_FOUND` exit 3; the first
operator assertion expected a wrong error name and remains recorded as failed.
The corrected receipt changes that expectation only; it does not repeat the
business command or reconstruct the migration. Two fresh read-only CLI processes
confirm the same owner/grant/scopes/origins, active future short access and NULL
refresh/absolute deadlines. The persistent protocol is grounded in the actual
schema/deadline constraints, without inventing a wire-version field omitted by
CLI status. No password login, deadline modification or substitute grant was used.

Main 81362 retains 18 preexisting open CodeQL alerts on unchanged source paths;
actual applicable JavaScript/Actions analyses have 39/1 results with no errors.
Independent review found no introduced or affected confirmed P0/P1. Swift was
actually skipped for this CLI-only delta; main 500d's prior real Swift scan had
zero results, which is not claimed as a new 81362 scan. The corresponding actual
automatic iOS and macOS release decisions both reported no native release inputs
changed and skipped their publication jobs; existing published binaries remain.


Host proof before final source integration: Agent 592 passed / 24 skipped;
backend 1278 passed / 689 skipped (database-gated tests are separately recorded).
The final generic pending-logout proof has 51 cases, including 20 real-app
PostgreSQL cases. macOS revoke backend proof has 25 cases, including 17 real-app
PostgreSQL cases. CLI full suite has 293 passed / 1 conditional skip; the final
protocol rollback regression has 30 passing auth cases. Web focused auth proof
has 173 cases before integration, with an additional 34 macOS BFF cases.

Historical signed iOS r4/r5 receipts retain passing and failing run counts;
no retained case-ID manifest proves 95 distinct cases, so no unique total is
claimed. The final strict real-service case passed once with zero failures or
skips, the same default owner and persistent-device marker on both launches,
and no second-launch credential fallback. TestFlight 0.2.39 is processed from 500d327f; the production iOS source differs from 0.2.38 only in UI tests.
Physical-device installation, update and reboot remain untested.
A later single metadata-only observation found the installed 0.2.36 process
still using the same canonical identity, origin, scope and epoch 22, now at
access generation 3 with expiry 2026-10-26T04:47:06Z. The exact trigger of that
prior generation change was not observed. This probe read no credential values,
performed no login/renewal/UI mutation and did not cross the old generation 2 deadline.
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
service or browser was reused as task ownership. The task-owned disposable
PostgreSQL stack and its test-only volumes were removed after formal evidence
was retained. Native testing used the shared Primary iPhone; all allowlisted
devices are back at Shutdown without erase. The recovered native artifact was
removed through the guard after strict acceptance, merge, main checks and
processed TestFlight readback. The original artifact disappeared externally;
its removal is not attributed to this task.

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

The human authorized release coordination, nine exact cache IDs, then an
explicit expansion of 48 dependent IDs. Fresh ownership/reference checks
removed 39 unused, immutable, unshared records and retained 16 newly protected
records plus two held roots. Containers, images, volumes, mounts, start times
and Docker context matched before and after. Rounded Buildx display totals
estimate 1.53937 GiB removed; host disk fluctuations are not credited.
Formal evidence and exact IDs are in `backend/cache-cleanup/`. No broad prune
or unapproved cache deletion occurred; Docker capacity was still critical.

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

This nonblocking P2 was documented before the core merge, independently
reviewed, fixed in PR 435 and deployed. Its scoped retention and migration-108
readiness checks preserve the original Lab deadlines and observation policy.
