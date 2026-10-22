# Local iOS testing

## Purpose

Local iOS tests need one predictable simulator and one machine-wide owner so a
developer Mac does not accumulate booted runtimes or let two test sessions fight
over the same device. This document defines the session wrapper, when each
simulator profile is justified, and how `scripts/ios/check.sh` participates.

Executable truth lives in `scripts/ios/dev-ios-session.py`,
`scripts/ios/check.sh`, and `scripts/ios/test_dev_ios_session.py`.

## Session wrapper

`dev-ios-session` is a Python standard-library tool, installed as
`~/.local/bin/dev-ios-session` and kept in the repository as
`scripts/ios/dev-ios-session.py`. It has three commands:

```bash
# Resolve and print the allowlisted device for a profile (read-only).
scripts/ios/dev-ios-session.py select

# Run a command inside a session that owns the device and the machine lock.
scripts/ios/dev-ios-session.py run -- ./scripts/ios/check.sh

# Validate an inherited session owner for scripts that must not re-lock.
scripts/ios/dev-ios-session.py is-owner --profile primary
```

Selection reads
`~/.config/dev-storage-guard/simulator-allowlist.tsv`, whose tab-separated
entries are `UDID<TAB>label`:

| Profile | Allowlist label | Use |
| --- | --- | --- |
| `primary` | `Primary iPhone` | Default for daily affected unit and UI tests. |
| `compact` | `Compact iPhone` | Layout, keyboard, and Dynamic Type changes, plus targeted release checks. |
| `ipad` | `iPad` | Only capabilities or layouts that are iPad-specific. |

`DEV_IOS_PROFILE` defaults the profile, `IOS_SIMULATOR_ID` may name an explicit
allowlisted device, and `DEV_IOS_REASON` records why a secondary device is
required. Selecting `compact` or `ipad` requires a nonempty reason; a `primary`
run always resolves the `Primary iPhone` entry even when another simulator is
booted. An explicit UDID that does not match the chosen profile fails instead of
silently switching devices. Tests may point at a throwaway allowlist with
`DEV_IOS_ALLOWLIST`.

Malformed `simctl` output, an unexpected JSON shape, or a device whose
`isAvailable` is not literally true fails with a clear message instead of an
unexpected traceback.

## When to use each device

- Run daily affected iOS tests on `primary`.
- Use `compact` for layout, keyboard, and Dynamic Type work, and for a focused
  release check on the compact device.
- Use `ipad` only when the change is specifically supported there.
- Web and backend work does not use a Simulator by default; they keep their own
  checks.

```bash
# Daily primary run.
scripts/ios/dev-ios-session.py run -- \
  scripts/ios/check.sh

# Compact device for a keyboard or layout change.
DEV_IOS_PROFILE=compact \
DEV_IOS_REASON="keyboard layout verification" \
  scripts/ios/dev-ios-session.py run -- scripts/ios/check.sh

# iPad only for a supported-specific change.
DEV_IOS_PROFILE=ipad DEV_IOS_REASON="iPad split-view check" \
  scripts/ios/dev-ios-session.py run -- scripts/ios/check.sh
```

## Lock, session identity, and lifecycle

`run` serializes participating processes on the existing machine-wide lock at
`IOS_AUTOMATION_LOCK_FILE` (default `/tmp/ios-automation.xcodebuild.lock`) using
`/usr/bin/shlock`, bounded by `--timeout` seconds. A lock held past the deadline
fails with exit code 75. The lock records the wrapper process.

After acquiring the lock, the wrapper atomically writes a metadata record beside
it (owner pid, lock path, selected UDID, profile, reason, a random session id,
and whether the device was borrowed). A nested run is accepted only when the
inherited environment agrees with that record, the real lock holder, and a
living ancestor of the caller. Changing `IOS_SIMULATOR_ID`, `DEV_IOS_PROFILE`,
and `DEV_IOS_REASON` together, or copying a session environment from outside the
process tree, cannot redirect the session or acquire its lock. Cleanup removes
the metadata only when this process still owns the lock; a legacy standalone
`shlock` holder is left untouched.

A session only controls the device it selected:

- It refuses to start while other simulators are booted, and leaves them alone.
- It refuses to start while unrelated `xcodebuild` processes are observable, and
  never kills them.
- It never creates, erases, or deletes a simulator and never boots a device
  itself; the child command starts the selected device.
- It shuts the selected device down at closeout only when the device was
  `Shutdown` before the session and the session brought it up. A device that was
  already booted is borrowed, produces a clear warning, and is left running.
- It never runs `simctl shutdown all` and never shuts down another device.

The child runs in its own process group. `SIGINT` and `SIGTERM` are handled from
the start of the run, including while waiting for the lock, and are forwarded to
the group while a child is active. The session keeps the lock until every live
member of that group is gone: a direct exit is followed by a bounded TERM/KILL
teardown of background descendants, so a lingering grandchild cannot outlive the
lock. The child's failure exit code is preserved.

Cleanup is verified rather than assumed. After a shutdown the wrapper reads the
inventory back and requires the selected device to be `Shutdown`. A shutdown
failure, a failed readback, or an inventory failure at closeout is reported with
the selected UDID and makes the run exit nonzero (70) when the child succeeded;
a child failure is preserved while the cleanup failure is still recorded.

## check.sh integration

On macOS, when a helper is available and `CI` is not `true` or `1`,
`scripts/ios/check.sh` decides the route only through the helper `is-owner`
check, and re-enters itself through an absolute script path when it does not own
a session. The helper is resolved from `DEV_IOS_SESSION_BIN`, then the first
`dev-ios-session` on `PATH`, then `~/.local/bin/dev-ios-session`. An explicitly
set but unusable `DEV_IOS_SESSION_BIN` fails closed outside CI. `DEV_IOS_PROFILE`
and `DEV_IOS_REASON` select a secondary device, and the wrapper exports the
normalized reason so the nested `is-owner` call sees the same selection.

If the helper exists but the inherited session does not validate, `check.sh`
enters the helper instead of silently falling back to the standalone lock; the
helper then either acquires the lock for a fresh run or fails immediately for an
inconsistent inherited session. CI and non-Darwin hosts keep the standalone
`shlock` path and the existing simulator selection and test selection.

Inside a validated local session the default `IOS_REBOOT_SIMULATOR` is `false`,
so a borrowed, prebooted device is never interrupted. Standalone and CI keep the
reboot default of `true`, and an explicit `IOS_REBOOT_SIMULATOR=true` still
reboots the chosen device. A retry never reboots a borrowed device; it reports
that reboot was skipped instead of interrupting the session. Reboots only ever
affect the selected device, never any other simulator.

## Storage guard

`dev-storage-guard` is unchanged. It still audits disk pressure, governs
artifact directories, and prunes non-allowlisted simulators. The session wrapper
does not allocate or manage artifact storage; use `dev-storage-guard
new-artifact` for test artifacts and remove them after durable evidence is
recorded.

## Verification

`python3 -m unittest discover -s scripts/ios -p test_dev_ios_session.py -v`
exercises the wrapper with subprocess fakes, so it never touches a real
Simulator. It covers selection and allowlist errors, two-process lock
exclusion, stale and legacy locks, nested metadata integrity (including changed
and copied environments), borrowed-device handling, background-descendant
teardown, and shutdown/readback/inventory cleanup failures.
`bash -n scripts/ios/check.sh` checks the integration syntax. The session's real
behavior on a device is observed through the ordinary `check.sh` output and
result bundles.

## Opt-in live account journey

The `LiveConversationFlowUITests`, `LiveImageFlowUITests`, and
`LiveAccountFlowUITests` suites are opt-in acceptance against an explicit
backend and authorized password account. Missing environment inputs skip the
tests; a skip is not a live pass. Follow
[account access](account-access.md) before using a long-lived workspace. Use
synthetic content only and verify the native Account screen's exact email before
sending it. These tests do not exercise Apple/Google sign-in or TestFlight
distribution.

Build for testing once with normal Simulator signing, then run
`test-without-building` inside the selected `dev-ios-session`. Pass
`TEST_RUNNER_TS_IOS_LIVE_BACKEND_URL`, `TEST_RUNNER_TS_IOS_LIVE_EMAIL`, and
`TEST_RUNNER_TS_IOS_LIVE_PASSWORD` to `xcodebuild` through a private process
environment, never literal command arguments or tracked files. Treat runner
configuration, logs, recordings, and result bundles as private: XCTest can log
typed text. Keep only sanitized receipts after acceptance.

Run the journey in this order:

1. From signed-out state, `LiveConversationFlowUITests/testLiveKeyboardSignInAndIdentity`
   verifies keyboard Next/Go submission and the exact native identity without
   saving credentials in Passwords. Then
   `LiveConversationFlowUITests/testLiveTextRoundTripAndDraftRecovery` performs
   ordinary email sign-in when needed, verifies identity, sends one unique
   synthetic text request, checks an Agent response, and verifies the sent
   conversation and unsent draft after relaunch.
2. `LiveImageFlowUITests/testInspectedImageCompletesCaptureWithoutPeople` requires a
   preloaded synthetic image and `TS_IOS_LIVE_STAGE_IMAGE=synthetic-app-icon`.
   Start `python3 scripts/ios/live-image-inspection.py <private-artifact-dir>`;
   privately load its config into runner inputs `TS_IOS_LIVE_INSPECTION_URL`
   and `TS_IOS_LIVE_INSPECTION_NONCE` (with the `TEST_RUNNER_` prefix when
   invoking `xcodebuild`). Inspect `selected-image.png`, then copy
   `inspection-challenge.private` to `inspection-approved.private`. Approval
   binds to that upload's PNG digest and fresh challenge. The same native view
   then sends exactly once and checks the no-person capture result; it never
   automatically reselects or resends after a failure. This exercises screenshot
   intake, not general visual question answering. Use
   `testExistingImageReceiptAndSourceAreRecoverable` with the explicit existing
   Session, task and synthetic marker inputs (`TS_IOS_LIVE_IMAGE_SESSION_ID`,
   `TS_IOS_LIVE_IMAGE_TASK_ID`, `TS_IOS_LIVE_IMAGE_MARKER`) to verify recovery
   without another upload. Stop the owned loopback helper after the attempt.
3. `LiveAccountFlowUITests/testLiveNavigationAndSignOut` verifies People,
   Sessions, Today and Account, then signs out and verifies the signed-out
   state after relaunch. Run it last because it revokes the native session.

Use only the narrow suite needed while iterating. The offline
`AuthenticationWelcomeUITests` cover tap/short-pull behavior and keyboard
progression with synthetic credentials; they do not establish a live login.
`LiveProtectedStorageTests` checks only protected-store status metadata for the
explicit endpoint and never exposes its contents.
