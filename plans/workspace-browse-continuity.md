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
close an issue or describe the full requested feature as delivered. The verified
sidebar slice may be released separately after its release gates pass.

## 2026-10-23 remote delivery continuation

The user explicitly requested pushing the change and publishing a new version.
Publish the independently verified sidebar slice as the next release; right-side
tabs and source-preview acceptance remain disclosed follow-up requirements and
are not part of this slice's release claim.

- Repository canonical name resolved by GitHub: `getyak/capir` (the existing
  `getyak/talent-signal` remote redirects there).
- Published branch: `codex/workspace-browse-continuity-20261023`.
- PR: https://github.com/getyak/capir/pull/410 (draft until release gates pass).
- Merged current remote main `a89bba220af54b16d777a16f444173d994a273e2`
  into the task branch, preserving its shared compact rail, avatar and unread
  behavior. The compact rail now expands the browser through the same category
  control used by the expanded rail.
- After integration, 118 focused tests passed and four shell tests failed
  because the borrowed local contracts distribution lacks `LOCALE_ENDONYMS`.
  The source exports it; current-head CI's clean shared-package build must
  validate that path. Do not misreport these four local results as passes.
- Targeted ESLint passed. The build-cache maintenance dry run found zero safe
  candidates. No cache or other task's artifacts were deleted.
- Host resources remain below the 30 GiB production-build gate; the existing
  `current-chat-sre` resource pause is still present. No new local build,
  resident service or review worker was started. No resident activation or
  live changed-behavior verification has occurred.

Required before merging/publishing: independent review with no confirmed P0/P1,
all current-head applicable CI checks, recovery of the host resource gate,
clean-source resident Web build/activation, and live desktop/narrow acceptance.

## 2026-10-23 unified release approval and integration

The user approved a one-release exception to the existing resource pause and
explicitly authorized coordination with the sidebar-resize task for one combined
release. The pause marker remains untouched. This task owns final integration,
CI, merge, resident Web build, activation and live acceptance; the resize task
will not start a competing deployment. Preserve the 30 GiB build gate and
current plus rollback releases.

- Integrated the complete resize branch through `ba9e02e0`: adjustable sidebar,
  hide/restore edge, persisted non-sensitive layout preferences and plus-only
  recent header. The final merge uses its shared layout presentation and the
  independent browser's enabled selection and keyboard-focus restoration.
- Initial independent source review found no P0/P1; its compact-category focus
  P2 is fixed, tested and re-reviewed. A final integration review is requested.
- Remote head `71fb750d` failed Web CI on missing i18n entries and an obsolete
  implementation-string assertion. `ea395ef7` adds all five locale entries,
  updates that assertion, restores compact category keyboard focus and clears
  browse selection semantics after expiry without remounting revoked panels.
- MiMo first review was published against `71fb750d`. Its mobile P2 was not
  confirmed: the entire sidebar column is hidden at <=760px; desktop retained
  panels must survive a temporary breakpoint change. Its expired-provider P3
  is fixed. No second paid review was started for that same head.
- The prior local tests used borrowed, stale compiled contracts; their six
  dependency/export failures are not passes. Replace borrowed links with an
  independent frozen-lockfile install before final verification.
- Host sample before dependency preparation: 37.96 GiB available, 7.59 GiB swap,
  142 Node/npm processes. Docker VM has 9.39 GiB available. Only one bounded
  integration test/build owner is active. No production activation yet.

Independent frozen install with pnpm 11.18.0 succeeded. Full Web typecheck,
full Web ESLint and `pnpm docs:check` passed. The unified focused run passed
173/174 tests; its only failure was the new frame's untranslated accessibility
copy. Added useT and eight catalog keys in all five locales; the 40-test
frame/i18n rerun and targeted ESLint pass. The other 134 focused tests were
unchanged after that failure. Final combined CI is still required.

Final independent source review approved `a89bba22..b34de5be` with no confirmed
P0/P1/P2. The first combined CI passed 2,755 Web tests and failed seven obsolete
setup clicks in two existing recent-list suites: the removed group disclosure
no longer exists. Removed only that setup/helper; retain every sorting, pin,
archive/restore, selection, arrival-motion, reduced-motion and storage-failure
assertion. The original failure reproduces locally. Full single-worker Web
tests and a review of this test-only correction are in progress.

Acceptance uses one owned daily run `27e044aa-8151-4a4c-9c9f-5f32ed82b0c2`,
request `a95a7914-57c4-4de9-b22e-d70cb98339ed`, provisioned by the reused default
account CLI grant. Owner and target readbacks are recorded separately in the
sanitized receipt. The CLI browser verified active 12/30/4 synthetic data and
was gracefully closed (PID 48969); the isolated IAB context is reused for QA.
No messages or external effects have been sent. The run must be stopped and
its cleanup read back before handoff.
