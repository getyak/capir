# Action Button capture with durable background delivery

## Outcome and authority

The user explicitly authorized implementation of the reviewed design, focused
tests, PR creation and merge after current-head gates, deployment of affected
resident services, and TestFlight publication. An intentional long press should
capture one screenshot, reliably hand it to the existing conversation queue,
continue server execution without keeping the UI open, project real progress to
one Live Activity, and open the original protected Session.

Design input: the user-reviewed report at
`/Users/cubxxw/.codex/visualizations/2026/10/24/01a16dd6-6f8b-77b0-aa19-cf703db6cfe1/ios-action-button-design.md`.
This report grants no authority to confirm facts or send external messages.

## Baseline and resource ownership

- Clean isolated managed worktree, branch `codex/ios-action-button-background`,
  starting at `d191470831f9810dffb035d90d292779a5f88b25`.
- Original main and unrelated untracked work remain untouched.
- The pre-existing `.agent-pause` is owned by the SRE chat and remains in place.
  Fresh audit: 53.62 GiB free, above the documented 40 GiB recovery line;
  173 Node/npm processes and 9.85 GiB swap are diagnostic warnings. The user's
  current explicit release instruction authorizes this scoped manual task;
  do not resume other workloads or remove the global marker. Serialize heavy work.
- No task-owned service, simulator, build or background process at plan creation.
- Native Xcode is 26.6. Use supported APIs; do not make iOS 27-only APIs a
  requirement without a matching SDK and actual verification.

## Boundaries and settled direction

1. Offer a prebuilt two-action screenshot Shortcut; keep manual instructions only
   as recovery. System Action Button assignment remains user-owned. Distinguish
   a received shortcut from proof of the physical assignment.
2. Persist capture, Session, message, request identity and frozen account/endpoint
   scope before acknowledging them. Local save, remote admission and completed
   processing are distinct states. Never silently claim an unscoped source for
   a later account.
3. Reuse the existing image conversation queue, source authority, idempotency,
   server worker, cancellation and Session synchronization. Do not introduce a
   second model pipeline. Keep original IDs across unknown-result reconciliation.
4. Start a user-initiated Live Activity from the Intent where supported; bind it
   to the same Session. Use actual admission/execution events. APNs updates must
   work when the app is suspended; register tokens under authenticated ownership,
   fence stale updates and invalidate revoked/deleted scopes. Never expose
   screenshots, names, conversations, credentials or user text in Activity payloads.
5. Immediate bounded upload plus file-backed system background transfer/recovery;
   no detached Task or permanent client polling as the reliability guarantee.
   Activity denial and delayed push cannot block server processing.

## Milestones

- [completed] Implement and prove native capture/background handoff, minimal
  setup, same-Session admission and Activity lifecycle with focused regression tests.
- [completed] Configure and verify APNs/signing prerequisites without exposing
  credentials. Device delivery acceptance remains separate from provisioning.
- [completed] Establish authenticated server push updates, token rotation and
  revocation tests, plus single-request background admission under lock.
- [pending] Independent sub-agent review, fix confirmed P0/P1, re-review those fixes;
  pass applicable local and latest-head CI gates and merge.
- [pending] Deploy each affected resident service from clean committed source,
  read back live revision and changed behavior; publish and verify the exact
  TestFlight build, then record actual acceptance limitations.

## Verification and definition of done

The user explicitly chose to finish publication first and defer physical-device
acceptance. Complete native/host tests, independent review, current-head CI,
merge, affected runtime deployment and exact TestFlight publication now. Record
real Shortcut import, Action Button, locked-device APNs and deep-link checks as
the agreed follow-up; do not wait for hardware or claim they passed.

Cover cold/background invocation, protected file failures, expired login and
scope changes, successful/unknown/failed admission, response loss, duplicate
invocation, termination/relaunch, offline recovery, refused Live Activity,
APNs failure/out-of-order events, exact Session deep link and source deletion.
Use synthetic screenshots for deterministic tests. Native checks must run through
`dev-ios-session` and a registered task artifact path, using Primary iPhone.
Record physical-device proof separately from Simulator and cloud signing proof.

PR merge, CI success, backend deployment, Apple processing and installability
are separate evidence states. Missing APNs credentials or device access is a
specific incomplete acceptance item, never a passing simulation.

## Execution ledger

- 2026-10-24: fresh resource audit, concurrent task inventory, clean managed
  worktree and release workflow inspected. Existing MiMo task from earlier today
  failed with provider 401 Invalid API Key; current doctor checks presence only.
  Make at most one bounded current attempt before choosing an evidence-based fallback.
- MiMo task `20261024-215922-bcb61fac` failed before code generation with provider
  401 Invalid API Key. No billing/provider fallback; Codex worker owns implementation.
  Parent owns the generic Shortcut generator and signed asset. Frozen offline
  install reused 804 cached packages with pnpm11.18.0.
- Registered native artifact: `/private/tmp/ai-test-ios-action-button-background.gqNKp9`.
  First completed native focused run:67 tests,0 failures; subsequent changes need
  final verification. Device inventory reports0 connected physical devices.
- Generic two-action Shortcut passes two deterministic recipe/privacy checks and
  Apple `shortcuts sign --mode anyone` succeeded. Actual iOS import and physical
  Action Button invocation remain separate acceptance. Bundled-file import is
  the supported fallback; no invented iCloud link or undocumented import scheme.
- Main AppID Push Notifications capability enabled and read back. Existing
  signing refresh workflow40101867099 passed; ASC readback confirms main profile
  `aps-environment=production`; unrelated app identities and certificates untouched.
- User explicitly confirmed final browser registration of a dedicated production,
  topic-specific APNs key for only `com.talentsignal.app`. Its configuration
  is recorded in the private project operations document. Private material is
  mode0600 in the existing private credential
  directory and Infisical staging:/backend, never in source/Notion/logs. All five
  agreed variables passed consistency readback; real P-256 key validated.
- APNs production HTTP/2 synthetic invalid-token probe returned400BadDeviceToken.
  This records transport/request preflight, NOT real push delivery or device proof.
- Requested Notion project document created in the owner's existing project
  library and read back. It records configuration and evidence only; private
  destination identifiers remain in the local delivery evidence.
- Independent reviewer role preset could not start (unsupported model); a fresh
  default agent `review_capture_v2` is performing the actual read-only review.
- First independent review found Session-creation race, stale token-registration
  writes and pending-signout journal bypass. All are release blockers; repairs
  and regression verification are in progress before re-review.
- Parent owns `captureActivity.integration.test.ts` and a disposable PostgreSQL
  Compose project `capri-capture-proof` on loopback57985. Its volume and containers
  are task-owned, have no permanent restart and must be removed after evidence.
  It is not a resident service; no resident database is used by these tests.
- The two-request upload is being consolidated into one file-backed system
  request so locked-device Keychain protection cannot strand the image between
  Session creation and queue admission. The private credential protection stays
  unchanged. Each retry keeps the original Session/message/operation identities.
- Fresh107-migration disposable PostgreSQL and13 actual database/HTTP tests now
  pass, including optional Activity registration success/failure independence,
  unchanged-work heartbeat and transient terminal-end retry. Backend typecheck
  and the generic recipe's two checks also pass. The new database suite is
  explicitly included in the existing CI PostgreSQL regression step.
- Re-review closed the original three P1s but found a remaining late-token
  registration outbox gap. Native repair uses the same OS file-backed session
  and generation acknowledgements. A logout-store-owned, hash-only deny mirror
  must durably append before Keychain writes, fail closed on unreadable state,
  and never authorize a new capture. Keep full Keychain authorization for intake.
- Intermediate native setup UI3/3 and focused capture/continuity checks passed.
  Two real Keychain cases failed with unsigned simulator error-34018 and require
  an ad-hoc signed rerun. These are not recorded as passed or substituted by
  unrelated native tests. The final outbox/mirror source also needs recompile.
- Independent final code review closed all confirmed P0/P1. Hash-only Session
  deletion generations preserve private-file protection; existing captures never
  initialize missing deny state, fresh authorization binds a non-reusable random
  generation, and unshipped nil-generation records fail closed.
- Final native build-for-testing succeeded with ad-hoc signing. The65-case
  affected regression is still running. Create a draft PR now so cloud CI can
  run concurrently; retain this local run as a merge gate. Source/handler hashes
  are frozen. A later metadata-only description clarifies authorized background
  upload and passes release-policy/localization checks.

- Final current critical source passed65/65 native regressions and3/3 setup UI
  checks;32/32 focused backend checks and13/13 PostgreSQL/HTTP checks passed.
  The native wrapper returned70 only during redundant simulator shutdown;
  xcresult independently reports Passed/65/0, and a separate guarded state read
  confirms Shutdown. Preserve that teardown warning rather than claiming a
  completely clean wrapper exit. Metadata-only copy is covered by release
  policy/localization and will be recompiled in latest-head CI.
