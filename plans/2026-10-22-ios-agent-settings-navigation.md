# iOS Agent and workspace settings navigation

## Outcome and boundary

Replace the stacked Agent and Workspace sheets with ordinary full-screen
navigation: workspace page → Agent → Workspace settings → setting. Preserve the
selected workspace page, native Back and interactive pop, settings state,
account-scoped data, and exact-effect review. Setting contents and bounded
edit/import/review modals are outside this change.

## Evidence and decision

The supplied screenshot shows Workspace settings over a dimmed Agent sheet.
The implementation confirms two presentation owners: the archive sheet routes
to Agent's own NavigationStack, then Agent presents another sheet containing a
second NavigationStack. Workspace drilldowns also change presentation detents.

Use the existing archive NavigationStack for all of these destinations. Push
Agent with navigationDestination and settings with NavigationLink; remove the
inner stacks, sheet-only close controls, detent transitions, and unused routes.
Keep proposal review and internal testing as bounded root-owned presentations.
They return to the current settings context when dismissed. Refresh canonical
workspace state when Agent is popped, as its former sheet dismissal did.

Keeping one Agent sheet with pushed settings would remove one layer, but leave
a persistent configuration destination modal. A fullScreenCover would retain
a separate navigation owner. Neither is needed for this hierarchy.

Native navigation behavior follows Apple's
[NavigationStack documentation](https://developer.apple.com/documentation/swiftui/navigationstack).

## Milestones

1. Completed: isolate from origin/main at
   `62cf8d699149dd0df68ab93361d4301e6b492be0`; preserve the original checkout's
   untracked work.
2. Completed: implement navigation and update existing live-account/image and
   language test journeys. Add a focused settings/back/interactive-pop journey
   and verify internal testing returns to settings in the test specification.
3. Active: independent static review passed after fixing two old modal-close
   references and deterministic light/dark test setup. Native validation moved
   to existing GitHub CI after the host failed the resource gate during boot.
4. Pending: inspect current-revision native results and exported screenshots,
   resolve CI failures, and integrate only after applicable checks pass.
   No TestFlight release or resident-service change is part of this iOS patch.

## Verification and resource gate

Before source edits, `/Users/cubxxw/.agent-pause` existed for operations incident
`INC-20261022055202-4d3e5e`, with reason
`disk_below_30_GiB_swap_above_19_GiB`. The resource snapshot reported 24.64 GiB
free, 19.93 GiB swap, and 250 Node/npm processes. The user policy prohibits new
heavy work, builds, or delegation while paused. No simulator, build, Pi worker,
review subagent, application server, or browser was started for this task.

Static checks completed: `git diff --check`, Swift frontend parsing of the eight
changed Swift files, and all four scripts underlying `pnpm docs:check`. The pnpm
entry unexpectedly auto-installed dependencies in the fresh worktree before
running checks. Its task-owned processes (63471, 63557, 63581, 63822) were sent
SIGTERM and verified absent. All four check scripts were then run directly.
Ten generated dependency directories were removed through a registered
storage-guard artifact (1,144,936 KiB, reported as 1.09 GiB). Shared package-store
content is retained. The registered cleanup artifact was verified removed. Parsing does not establish typecheck,
link, launch, appearance, Back gestures, or UI-test success.

After the operations pause is lifted (or the user authorizes a scoped override
and the resource preflight is safe), use the documented Primary iPhone session
and registered artifact directory. Run only the navigation journey, existing
Agent/source entry, settings, language, Chinese AX5, and internal-testing checks
affected by the change. Capture full-screen Agent and Workspace settings in
light/dark and Chinese accessibility text. Check ordinary Back and interactive
pop, return-page retention, proposal review, and failed-sign-out recovery.
Do not claim physical-device or TestFlight verification from Simulator results.

The UI tests were authored before their production edits. The user authorized
this task to bypass the global pause on 2026-10-22 after a safe resource check.
Preflight reported 37.85 GiB free and 10.10 GiB swap. All three devices were shut
down and no xcodebuild was active. Another task acquired the machine-wide
session first; this task waited without interrupting it.

After acquiring the session, Primary iPhone bootstatus remained at `Waiting on
System App` for approximately four minutes. Before any build began, resources
fell to 28.79 GiB free and 19.17 GiB swap. The task's wrapper (PID 72920) received
SIGTERM, stopped its child group, and shut down the device it had booted. No
application code was compiled or tested locally. Raw boot/session evidence was
preserved in the chat artifact directory. The global pause marker is unchanged.

The PR quick and release smoke selections now include both new navigation
journeys. Existing CI exports attachments only from their result bundles into
a seven-day navigation-evidence artifact. This provides actual screenshots for
inspection without adding a local build, changing release workflows, uploading
to TestFlight, or claiming that passing assertions establish visual quality.

## Resource ownership and recovery

Branch: `codex/ios-agent-settings-navigation`.
Managed worktree:
`/Users/cubxxw/.codex/worktrees/ios-agent-settings-navigation/talent-signal`.
Retain this worktree and its patch until native validation and delivery finish.
The task-owned native session is stopped; no native helper remains. Dependency-cleanup evidence is
saved in the chat artifact directory. The unsuccessful native boot receipts have been copied to the chat artifact
directory. Its temporary registered artifact can now be removed.
