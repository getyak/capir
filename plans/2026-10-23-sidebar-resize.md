# Quiet, resizable conversation sidebar

## Outcome and scope

Keep the recent Session list visible with one icon-only add action. Remove its
redundant heading/disclosure and visible “new conversation” text. Let desktop
users resize the sidebar by dragging its boundary, hide it past a threshold,
and recover it from the left edge. Preserve the existing compact rail, exact
Session navigation, drafts, account controls and mobile bottom navigation.

## Current evidence

- User supplied a private screenshot; it is reference input only, not a fixture.
- Isolated branch `codex/sidebar-resize-20261023` starts at remote main
  `37b5a49f`; unrelated files in the primary checkout remain untouched.
- Existing owners are `WorkspaceRecentSessions`, `WorkspaceShellNav`, the
  authenticated layout and `workspace-shell.module.css`.
- Resource preflight: approximately 29 GiB free, 333 Node/npm processes,
  17.56 GiB swap. `/Users/cubxxw/.agent-pause` belongs to `current-chat-sre`
  with reason `disk_below_40_GiB`. No new heavy build or delegation is allowed.
- No task services, browsers, simulator sessions or test artifacts started.

## Approach

Use a shared client shell around the server-rendered sidebar and content.
Persist only local presentation preferences. A keyboard-accessible separator
owns pointer capture, cancellation, bounded width and recovery. Full hiding
must remove sidebar controls from keyboard focus; mobile navigation remains
available regardless of desktop preference. Retain the existing global rail
toggle; the removed disclosure is the one in the recent-conversations header.

## Milestones

1. Complete: implement the compact header and reversible resize interaction.
2. Complete: focused single-worker interaction/regression checks using existing
   dependencies; inspect the diff. See verification below.
3. Blocked by the existing resource pause: obtain independent review, run applicable
   build/type checks, deploy the affected resident Web from clean committed
   source and verify desktop/mobile, light/dark and reload on the real surface.

## Acceptance

- Header has an accessible plus action and no redundant heading/disclosure.
- Drag adjusts width; crossing the threshold hides the whole desktop sidebar.
- Left-edge drag, double click and keyboard controls restore the sidebar.
- Pointer cancellation/Escape restore the previous state; reload restores only
  committed preferences; denied storage remains usable in memory.
- Hidden desktop controls are inert, and narrow-screen navigation stays usable.
- Preserve fresh-draft handoff and existing archived/pinned Session behavior.

Local tests alone are not deployment or product acceptance. Keep this plan
incomplete until review and live revision/behavior verification have succeeded.

## Verification and resume checkpoint

- The new compact-header regression first failed on the previous visible
  “new conversation” text, then passed after implementation.
- Focused Vitest command (run from `apps/web`):

  ```sh
  ./node_modules/.bin/vitest run components/workspace-shell-frame.test.tsx components/workspace-more-destinations.test.ts components/new-conversation.test.ts components/workspace-chrome-states.test.ts lib/workspaceShell.test.ts lib/workspace-shell-render.test.ts --maxWorkers=1 --no-file-parallelism
  ```

  Result: 6 files, 86 tests passed. The split tests cover pointer cancellation,
  lost capture, Escape, keyboard restore, viewport changes, legacy rail
  migration, denied storage, cross-window readback and mobile navigation.
- ESLint passed for all changed TypeScript/TSX files.
- A narrow no-emit TypeScript check passed for the two new runtime modules,
  using existing React types and a CSS-module declaration. This is not the
  complete application typecheck or a production build.
- `pnpm_config_verify_deps_before_run=false pnpm docs:check` passed, including
  Wiki, architecture boundaries and all five diagram checks. The environment
  flag prevents installation into the borrowed dependency links. The first
  sandboxed attempt failed while verifying the pinned pnpm registry signature;
  the authorized retry succeeded. No dependency installation was performed.
- Existing dependency directories were borrowed through task-owned symlinks;
  no dev server, browser, simulator, Pi worker or sub-agent was launched.
- Rechecked resource gate before checkpoint: approximately 29 GiB free; the
  original pause marker remains. Existing shared services were not restarted.

Remaining acceptance: independent review; complete app typecheck/build; real
desktop drag and edge recovery at expanded/compact widths; keyboard focus;
narrow/mobile navigation; light/dark/reduced motion; reload; then clean-source
resident Web deployment and live revision/behavior readback. No PR, merge or
deployment is claimed. Retain the worktree because this task is not delivered.
