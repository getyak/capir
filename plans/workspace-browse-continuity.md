# Independent desktop browsing and working context

## Outcome and boundary

Let a user find a Person or time record without replacing the conversation they
are editing. Desktop categories select the left browser; concrete records open
the right workspace. Mobile keeps ordinary route navigation. Person identity,
authorization, source reads and writes retain their current domain owners.

The complete requested outcome also includes explicit right-side tabs, per-tab
draft/caret/reading-position restoration, and temporary source previews. These
remain required follow-up milestones; the first slice must not be described as
the entire feature.

## Baseline and evidence

- Branch: `codex/workspace-browse-continuity-20261023`.
- Clean source baseline: `37b5a49f4a97afe786d0f4891788072a6af33e7f` (`origin/main`).
- Worktree: `/Users/cubxxw/.codex/worktrees/workspace-browse-continuity-20261023/talent-signal`.
- The original checkout has unrelated untracked research and evaluation files;
  none are task-owned.
- On 2026-10-23, the existing macOS workspace reproduced the problem: clicking
  People replaced the recent-Session sidebar and the conversation canvas with
  the People directory and People page. This was an existing authenticated
  window; no test account, message or relationship record was created.
- `WorkspaceSidebarContext` branches on `usePathname`; rail categories are
  route links. People search and calendar scope also read the right-side URL.
- Existing navigation continuity remembers vetted locators, not mounted page
  state. It cannot establish caret, scroll or draft retention across objects.

## Approach

Keep one authenticated, in-memory left-browser selection independent of route
changes. Initialize from a deep link, then change it only through category
selection. Preserve visited sidebar panels and their independent scroll areas.
Reuse the existing vetted, scope-bound directory/calendar locators. Calendar
day/range browsing and clearing a sidebar search must not write the work URL.
Concrete Person/Session/schedule links and explicit full-directory links retain
their canonical routes. Modified clicks retain native browser semantics.

Do not cache arbitrary Next.js `children`: mounted route consumers would still
observe the global pathname/search and could silently change identity. Right
tabs need explicit document identity and state ownership before implementation.
Ordinary record opens reuse the active document; only an explicit new-tab action
retains another one. A single document needs no full tab strip.

## Milestones

1. Source implementation and focused checks complete: independent desktop
   categories, People filtering, calendar browsing and account/expiry fences.
   This is not runtime acceptance.
2. Pending the resource gate: independently review, build, deploy the affected resident Web service from
   clean committed source, and verify its live revision and unchanged right
   canvas through desktop category browsing. Verify narrow navigation too.
3. Implement explicit right-document tabs with scoped state ownership and source
   previews; verify drafts, caret, scroll, close/reopen, history, errors, expiry,
   account switch and deletion on the real surface.

## Execution constraint

The existing `/Users/cubxxw/.agent-pause` is owned by `current-chat-sre`, with
`reason=disk_below_40_GiB`. The initial sample had 28.88 GiB free, 17.65 GiB swap
and 311 Node/npm processes. Per local policy, do not start new builds, services
or delegation while the marker is present; do not remove another task's marker.
Light source work and a single bounded test process may proceed. No completion,
release or real-surface acceptance claim is allowed without milestone 2 and the
remaining requested behaviors. Preserve this worktree until delivery.

## Acceptance

- While a conversation draft is visible, category selection changes only the
  left browser, with no history entry, route fetch, right remount or scroll reset.
- People filtering and calendar month/day/horizon browsing retain that boundary.
- Opening a concrete record changes only the right object; sidebar choice,
  search, calendar location and scroll remain stable.
- Mobile routes and modified browser clicks remain available.
- New authorization scopes do not inherit the previous scope's state; expiry
  cannot restore private rows or permit stale reads.
- Explicit right tabs preserve each document's exact identity, committed draft,
  selection/caret and reading position. No credentials, raw conversations or
  source contents are added to navigation persistence.

## Verification and handoff

- Focused Vitest run: 8 files, 97 tests passed, no failed tests; one worker,
  9 seconds. Includes the real sidebar People/calendar controls, shell/layout
  regressions and scoped navigation locator checks. The browser integration
  test uses a synthetic editor and sidebar stubs to check retained nodes; this
  is not proof of production conversation state restoration across routes.
- ESLint passed for all nine changed TypeScript files. `git diff --check` passed.
- `pnpm docs:check` stopped before executing its script because pnpm attempted
  automatic dependency synchronization against the borrowed dependency links
  and refused to purge without a TTY. No reinstall/override was attempted.
  All four underlying package-script checks passed when invoked directly:
  `check-docs.mjs`, `wiki.mjs check`, `check-architecture-boundaries.mjs`, and
  `check-architecture-diagrams.mjs`.
- Sanitized source hashes, the verification receipt and test JSON are saved in
  ignored `output/evaluation/2026-10-23-workspace-browse-continuity/` in this
  worktree. The registered temporary report directory is
  `/private/tmp/ai-test-workspace-browse-continuity.vcwlYB`; retain it while the
  delivery remains incomplete. It is not the sole evidence copy.
- Existing macOS window restored to its original conversation entry after
  baseline observation. No messages, contacts or meetings were created.
- No service, simulator or browser process was started by this task. Borrowed
  dependency symlinks are removed after verification; no dependency installs
  or shared-directory cleanup were performed. No PID was terminated.

Full typecheck/build, independent review, resident deployment, changed-runtime
desktop/narrow acceptance, right tabs and source-preview acceptance remain
incomplete. Keep this branch/worktree and its evidence for continuation; do not
merge, close an issue or describe the requested feature as delivered.
