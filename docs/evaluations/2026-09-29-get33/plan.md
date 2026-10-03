# GET-33 desktop companion delivery plan

## Outcome and boundary

Ship a real, launchable macOS companion whose appearance and visibility are
controlled from native Mac settings. Its calm ambient presentation may point to
work that already exists, but it must never infer a person's quality, invent a
task stage, read the screen continuously, or execute an external action.

The issue description is a direction with multiple future scenarios. This
delivery proves the complete first loop: choose a companion, preview it, show
it at the desktop edge, hide and restore it, inspect a truthful work state, and
return to the workspace. A generated environment prompt is only eligible once
the shared Web product can supply a scoped, provenance-preserving state feed.

## Design evidence and decision

- Source: [GET-33](https://linear.app/getyak/issue/GET-33/) and the user's
  ChatGPT Mini & Pets screenshot, provided as a visual reference rather than
  instructions or product authority.
- Existing [Figma exploration](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=38-3730)
  already has a restrained palette, six companion illustrations, a native
  settings rail and a desktop preview. Keep those strengths.
- The reference makes the pet preview and hide control immediately visible.
  The prior exploration mixed selection, speculative creation and display
  controls. The [visible state](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=301-1536)
  and [hidden state](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=301-1716)
  keep one selected companion while allowing a reversible exit. The hidden
  screen explicitly says selection and dragged position are remembered.
  The delivered states use the bundled companion names and omit the custom
  sprite importer, which this Mac build does not provide.
- The [unavailable-state task panel](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=305-1897)
  removes speculative counts and task stages. It opens the existing workspace
  while a trustworthy scoped task feed is unavailable.
- Use the original Figma vector characters, exported as bundled PNG for native
  rendering and SVG as inspectable source. The first slice has only a subtle
  optional idle breath; it does not animate a work outcome it cannot verify.
  Reduced Motion yields a static presentation.

## Milestones

1. Native settings and state: locally persisted selection, visibility,
   position and motion. Size control and validated custom artwork remain open.
2. Desktop surface: a small, nonactivating companion with hide/restore in
   Settings, bounded dragging, an accessible main-window action and no
   private text.
3. Truthful task panel: only real, scoped statuses with an explicit empty or
   unavailable state and a route back to the originating workspace surface.
4. Focused tests, native build and actual app launch; inspect the rendered
   desktop/settings flow and save evidence outside temporary build output.
5. Independent review, current-head CI, PR merge and Linear readback.

## First merged slice (historical evidence)

- Baseline: `origin/main@e3f5a96d`; branch `codex/get-33-desktop-pet`.
- Figma visible, hidden and unavailable-work designs and the exact six
  illustrations are available. The native settings, bundled selection,
  floating panel and reversible visibility control now build and launch.
- Native production app is `apps/macos`; `apps/macos-hybrid` is a feasibility
  shell and is not the GET-33 shipping target.
- No authenticated, native-readable cross-session background task feed was
  found during initial inspection. A panel must not fabricate running, queued
  or recent counts while this remains unavailable.
- Local storage audit found 69 GiB free, below the 80 GiB heavy-build guard.
  Scoped cache cleanup was attempted; the macOS build used a registered
  task-owned artifact directory and occupied about 453 MiB.
- Native Debug build passed. `WorkspaceSettingsTests` passed all 28 tests on
  the final responsive build. The updated UI test target also built
  successfully. The dedicated UI runner exited before
  test bootstrap twice, including with signing enabled; a later attempt
  stalled during bootstrap and was stopped. Its assertions have not executed.
- Live macOS readback confirmed the settings preview and visible show/hide
  button, all six bundled illustrations, the Figma-inspired two-column layout,
  the initial floating controls and truthful unavailable-state popover, and
  reopening the original workspace after closing its main window. The 820pt
  narrow layout has a reviewed vertical fallback
  but no successful window-resize screenshot. Computer Use captures the
  controls panel separately from the noninteractive artwork panel, so a
  composite desktop screenshot is not yet available as visual evidence.
- The first Pi/MiMo batch was cancelled after 194 no-op turns with no source
  changes. An independent reviewer found no remaining P0/P1 after the
  workspace reopening and pointer-interception fixes.

## Unmet requirements to adjudicate before issue closure

The issue also proposes 8×9 animated sprite sheets, custom and community pets,
real cross-session running/queued/recent counts, screenshot and draft handoffs,
reminders, recovery, and state-specific success/failure/cancel/incomplete
motion. The current Mac and Web boundary does not provide a trustworthy
cross-session desktop status feed. These behaviors are not established by the
first loop or by the Figma exploration and must not be marked complete without
their own implementation and live readback. GET-33 remains in progress.

## Continuation: simpler draggable companion

- Branch `codex/get-33-capture-loop` starts at merged `origin/main@130a8e9d`.
  The user asked for subtle motion, direct dragging instead of a position
  setting, visibility in Settings, simpler artwork chrome, and click-to-home.
  A proposed capture popover was removed before delivery in response; the
  companion now renders only its artwork, while the existing menu bar retains
  screenshot and session actions.
- [Visible](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=301-1536)
  and [hidden](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=301-1716)
  Figma screens were updated in place. Their copy explains the slight float,
  dragging, click-to-main-window, Settings visibility, and position persistence.
  Redundant hide, status segment, and shortcut controls were hidden. The saved
  screenshots `figma/301-1536.png` and `figma/301-1716.png` were inspected for
  overflow after the edit.
- Native implementation has one 100×100 transparent artwork panel. A short
  drag moves and persists a relative position on its display; clamping and
  display fallback keep it visible. A tap opens the main workspace scene while
  preserving its current URL and unsent draft. An unconditional route to
  `/workspace` would reload or discard a draft, so "主页" is interpreted as
  the app's main window pending the user's answer to this tradeoff. The
  optional 2pt float respects Reduce Motion. Settings alone owns show/hide
  and there is no position picker.
- The focused `WorkspaceSettingsTests` suite passed 30/30 on the final Debug
  source. The documentation, wiki, architecture boundary and diagram checks
  passed individually; the `pnpm docs:check` wrapper hung without output and
  was stopped. An isolated QA bundle built from this branch with identifier
  `com.talentsignal.macos.get33qa` launched on macOS. Computer Use showed its
  100×100 artwork panel and two-column Settings. Clicking its artwork after
  closing the main window reopened the workspace connection screen; Settings
  hide/restore and motion off/on each read back correctly. The later image
  cache and hidden-panel pause were rebuilt and retested, but do not have a
  second UI screenshot. A physical drag to the borderless panel still fails
  in Computer Use with `noWindowsAvailable`, so the direct input and saved
  position remain unverified on the real surface. Geometry and the click's
  no-navigation action have focused unit coverage.
- Independent review, current-head CI and PR delivery are the active checks.
  The original issue's broader task feed, draft handoff,
  community/custom art and state-specific motion remain unmet, so GET-33
  stays In Progress after this slice.
