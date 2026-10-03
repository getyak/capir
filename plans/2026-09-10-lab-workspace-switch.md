# Lab workspace switching and navigation recovery

## Outcome and boundary

Enter and leave an isolated test workspace in-app, with verified identity,
visible feedback, preserved original data and reachable navigation. No process
termination or production backend mutation is in scope. The user subsequently
authorized publishing this repair to TestFlight through the main-only release gates.

## Evidence

- User screenshot: large red workspace banner; primary navigation is absent.
- Code: protected session adoption already increments contextGeneration and
  rebuilds scoped UI. Banner failures are only visible inside the manager.
- Code: retry/reconcile dispatch a returning child to inspectChild, which resets
  its phase to childActive and discards the return direction.
- Reference: [Stripe sandboxes](https://docs.stripe.com/sandboxes/dashboard/manage)
  keeps navigation available under a persistent environment marker and separates
  opening from deletion; [Slack switching](https://slack.com/help/articles/1500002200741-Switch-between-workspaces)
  changes workspace in place on mobile.

## Approach

Preserve the durable return direction on retry, foreground and relaunch. Reserve
physical layout space for the banner above the navigation container. Use a
quiet compact marker, accessible controls, progress and inline-action errors.
Keep return separate from destructive cleanup; verify identity before rebuilding.
Do not force quit or weaken maintenance/credential checks.

## Milestones

1. Complete: regression tests cover offline return via retry/reconcile/relaunch,
   blocked deletion, unchanged owner content and in-process view generation.
2. Complete: return routing, separate banner layout, progress/error recovery,
   explicit manager dismissal and enter/return/reenter UI coverage.
3. Complete: Release build, 10 unit tests and one native backend-backed UI
   journey passed with zero failures or skips. Screenshot inspection,
   localization and docs checks passed.

## Completion evidence

- Native command: `IOS_ONLY_TESTING=TalentSignalTests/LabWorkspaceTests,TalentSignalUITests/LabWorkspaceUITests bash scripts/ios/check.sh` with owned DerivedData and result-bundle paths.
- [Result summary](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-10-lab-workspace-switch/test-summary.json):
  11 passed, 0 failed, 0 skipped; iPhone 17 Pro, iOS 26.5 Simulator.
- [Test workspace](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-10-lab-workspace-switch/test-workspace.png)
  and [returned workspace](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-10-lab-workspace-switch/returned-workspace.png)
  were visually inspected at the full viewport. The marker occupies its own row;
  all four navigation destinations are visible, and native hit-target/frame and
  page-selection assertions passed.
- [Native readback](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-10-lab-workspace-switch/native-readback.json)
  and [cleanup receipt](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-10-lab-workspace-switch/deletion-receipt.png)
  confirm zero test rows/sessions after deletion and unchanged original people.
- `pnpm docs:check`, localization checks and `git diff --check` passed.
- No TestFlight release was performed. Real-device accessibility and the
  installed app version are not claimed verified.

## Review findings and bounded follow-ups

Reviewer: mobile-ux-reviewer. Lens: mobile task completion, navigation,
feedback and recovery. Initial evidence: screenshot plus code; confidence is
supported inference until the native run completes.

- P1, interrupted return: returning a child with no network or active recording
  leaves a protected return intent, but retry/foreground previously inspected
  the child and rewrote it as active. Fix preserves direction and stop ID;
  tests verify owner identity, regenerated root and leave-before-delete order.
- P1, feedback: the banner previously hid all failure messages in its manager.
  Show failed return at the tapped surface with retry, and progress while
  verifying return; never announce success while the child remains current.
- P1, navigation: screenshot shows no primary destinations under the large red
  marker. Reserve a sibling layout region above NavigationStack rather than
  relying on nested top insets. Native assertions check frame separation,
  hittability and page changes before returning.
- P2, language: "Canonical workspace" / "权威工作区" in an empty test account
  exposes internal architecture and may suggest that test data is production.
  A later empty-state pass should explain that this is an empty testing space
  and offer one sample-input action without copying real account data.
- P2, recovery: if the retained original credential expires, a direct original
  account sign-in path would be clearer than repeated retry. Existing protected
  reauthentication tests remain part of this run; do not bypass verification.
- P2, environment clarity: expiry and cleanup details already live in the
  manager. Keep them there; a persistent countdown or several global actions
  would compete with relationship navigation.

The environment banner is a bounded usability repair, not a new visual design
system. Real-device Dynamic Type, VoiceOver and the user's installed TestFlight
build remain separate from local Simulator proof.

## Authorized TestFlight delivery

Status: active. User requested direct TestFlight publication after reviewing the
local repair. Base remains origin/main 674ce92b; local product commit fd7ee592.
Local review checked return intent, owner credential verification, maintenance
barriers, leave-before-delete ordering and the verified UI navigation evidence;
no confirmed P0/P1 remains in the changed paths. Follow normal PR CI/Security,
merge with current-head verification, await main CI and the automatic iOS
release, then read back exact version/build and internal group availability.
No additional tester invitation is needed for this request.
