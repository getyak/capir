# Persistent macOS sign-in

## Outcome and boundary

Keep Mac sign-in across updates, app relaunch, reboot and long inactivity.
Automatic renewal must stop on deliberate sign-out or canonical session
revocation, including requests already in flight. Web/iOS duration, browser
primary authentication and exact account/store ownership remain unchanged.

## Starting evidence and ownership

- Baseline: `88c5f5728138dd18500f818a37a5e16a6a49662d`.
- Investigated installed Mac: 0.2.29; resident access TTL: 28,800 seconds.
- Isolated branch/worktree: `codex/pi-20261025-111937-d0df1f51`.
- Pi task `20261025-111937-d0df1f51` failed before implementation with
  `401 Invalid API Key`. Scoped backend/native workers and the parent continued;
  no provider/billing fallback.
- User authorized this task's builds/delegation/deployment as a single-task
  exception to the resource pause marker. The marker remains in place.
- Parent owns Web/BFF/docs, synthesis, review and delivery. Workers own native
  and backend/contracts respectively; all unrelated source is preserved.

## Approach and alternatives

Persist an origin/store/account-bound capability in macOS Keychain before
enrollment dispatch. Enrollment proves a live Mac session from consumed browser
authorization. Hash-only backend storage binds it to the same canonical session,
without an idle/absolute capability deadline. Access rotates by generation under
transaction locks; previous access retains only its original expiration.
Supported Auth.js signIn installs the ordinary short cookie, followed by separate
live readback in the selected persistent WK store.

Normal renewal preserves store/conversation/drafts. Sign-out first persists a
fresh empty store epoch, disables renewal and discards its credential. Dormant
renewable sessions remain visible/revocable in Settings. Expired legacy sessions
without the capability cannot be resurrected.

Global TTL extension was rejected because it changes other clients and
eventually expires again. A permanent access bearer removes bounded access
expiry. A cookie alone cannot guarantee recovery after arbitrary inactivity.

## Milestones and evidence

1. Implementation: backend generation/revocation, native protected persistence
   and lifecycle, server-only BFF cookie installation.
2. Verification: deterministic edge cases, disposable PostgreSQL races,
   native actual-construction/lifecycle tests, type checks and docs gates.
3. Independent review, repair and re-review (complete).
4. Current-head CI and merge, affected resident Web/API deployment, signed Mac
   update and live changed-behavior acceptance.
5. Preserve proof; reclaim only task-owned temporary resources.

Backend57 tests (including11 actual disposable PostgreSQL tests), Web136
focused tests, Web/backend type checks and docs gates passed. The latest full native-unit run passed356 with zero failures and nine
explicitly skipped fixture-dependent cases. Condition-based fixture startup
regressions cover delayed readiness and bounded failure; product timeouts are
unchanged.
Independent review closed its confirmedP1/P2 issues, including exact-session
bindings across access rotation and selected-workspace/lost-response recovery.
This source snapshot precedes release. Current CI, merge, deployment and
installed acceptance are tracked in PR426 and the formal delivery record below.

Formal evidence: `/Users/cubxxw/ops/tasks/macos-persistent-login-20261025/`.
Rebuildable artifacts:
`/private/tmp/ai-test-macos-persistent-login-20261025.X9bhPw`.
Owned Compose project: `capri-macos-session-proof-20261025`, PostgreSQL tmpfs,
loopback 54357, DB `capri_persistent_test_20261025`.

Verify >8h and long inactivity, lost responses/concurrent renewal, logout races,
remote revocation, disabled/retired identity, origin/account binding and transient
outages. Never run expiry fixtures against real/resident data. Helper tests do
not establish installed update or physical reboot acceptance. Do not reboot the
shared computer; preserve deployed current/rollback versions and unrelated work.

## Capture primary-owner correction

PR426 merged after all applicable current-head and merged-main checks passed.
The merged backend was deployed and its prepared image/revision pair saved and
read back before resuming recovery. Release40163919378 was cancelled before
publication when pre-installation review found a P2: native capture compared a
primary-owner receipt to the independently selected business account. The
follow-up keeps both identities explicit and adds startup/recovery and wrong
primary counterexamples. Readiness also requires migration106 before advertising
the new device-session path as ready. ADR0026 owns the identity decision; tests enforce it.
Signed installation and live acceptance remain incomplete in this snapshot.
