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
  screen explicitly says work continues and the appearance is remembered.
- The [unavailable-state task panel](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=305-1897)
  removes speculative counts and task stages. It opens the existing workspace
  while a trustworthy scoped task feed is unavailable.
- Use the original Figma vector characters, exported as bundled PNG for native
  rendering and SVG as inspectable source. Motion changes a character's pose
  only when a real state changes. Reduced Motion yields a static presentation.

## Milestones

1. Native settings and state: locally persisted selection, visibility,
   position, size and motion; import validates custom artwork before use.
2. Desktop surface: a small, nonactivating companion with hide/restore,
   bounded positioning, keyboard/accessibility support and no private text.
3. Truthful task panel: only real, scoped statuses with an explicit empty or
   unavailable state and a route back to the originating workspace surface.
4. Focused tests, native build and actual app launch; inspect the rendered
   desktop/settings flow and save evidence outside temporary build output.
5. Independent review, current-head CI, PR merge and Linear readback.

## Current state

- Baseline: `origin/main@e3f5a96d`; branch `codex/get-33-desktop-pet`.
- Figma visible/hidden designs and exact six illustrations are available.
- Native production app is `apps/macos`; `apps/macos-hybrid` is a feasibility
  shell and is not the GET-33 shipping target.
- No authenticated, native-readable cross-session background task feed was
  found during initial inspection. A panel must not fabricate running, queued
  or recent counts while this remains unavailable.
- Local storage audit found 69 GiB free, below the 80 GiB heavy-build guard.
  Inspect narrowly scoped build products and safe cleanup before building.
