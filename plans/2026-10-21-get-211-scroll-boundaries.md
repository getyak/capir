# GET-211 — stable workspace scrolling

## Outcome and boundary

Keep the Web workspace and shared macOS Web surface anchored to the viewport.
Sidebar, route chrome, and account footer stay stable; overflowing content has
an explicit scroll owner. Time date/view/filter controls stay operable while
reading. Preserve narrow screens, keyboard access, menus, test banners, and
conversation reading continuity. No domain, authorization, backend, or native
binary behavior is changed by the UI fix. The required CI audit also needs a
minimal compatible shared MCP SDK security upgrade, described below.

## Implementation

- Bound the mounted workspace to the dynamic viewport and suppress root and
  content-edge bounce without affecting public-page document scrolling. Absolute
  page helpers stay inside the stage containing block, including native settings.
- Give ordinary pages the content stage; conversations retain their transcript
  and composer layout, with legitimate short-window overflow still accessible.
- Pin Time date/view/filter controls, measure their actual height to reveal
  keyboard destinations below them, and leave quick ranges in the reading flow.
- Give week calendars one vertical owner. Narrow views keep readable 580px
  calendar columns with bounded horizontal scrolling; the hours do not scroll
  independently.
- Reduce unnecessary Today/Settings trailing padding and short-window spacing.

## Required CI repair

The complete production dependency audit rejected the existing MCP SDK 1.31.0
for four upstream advisories. Upgrade the existing `^1.29.0` override to the
minimal patched version 1.32.0, verified against the npm release/integrity
metadata. Keep security gates unchanged and update the existing graph
regression. This requires deploying the affected shared backend/Agent Host as
well as Web from clean committed source. No new integrations are introduced.

## Evidence

- Baseline: `98b9608dbe7774badba39afda91f265967e8552d`. Existing document heights
  exceeded the viewport; week calendars also had a separate hours scrollbar.
- Fixed the external acceptance harness: wait for the settled login/workspace
  state and use the real login field. A locator timeout alone never proved a
  product failure.
- 93 focused host tests passed. Lint, typecheck, docs and architecture passed.
  Full Web run passed 2697 tests with one new-label i18n coverage failure;
  corrected the label and passed the 52-test i18n/Time recheck. The SDK repair
  passed a fresh zero-advisory production audit, dependency security regressions,
  and complete Agent/Agent Host checks. CI owns the
  complete current-commit rerun.
- Real synthetic browser checks cover 1274x720, 1274x600, 900x600, 390x844,
  and 320x640: shell bounds, empty conversation edges, sticky Time controls,
  calendar scroll ownership, filter/range-review keyboard access, navigation,
  and Settings fit. Genuine overflow remains readable.
- Independent review's narrow sticky-group and calendar-legibility P2 findings
  were fixed and rechecked. No remaining P0/P1/P2. At 320x640 the expanded
  controls leave about 140px for reading; calendar horizontal wheel moved240px
  while the document stayed still. Dark/reduced-motion account menu bounds and
  the native-settings CSS adapter also passed; an initial adapter failure exposed
  absolute hidden helpers escaping the unpositioned stage, now corrected.
- Reference: [CSS Overscroll Behavior](https://www.w3.org/TR/css-overscroll-1/).

## Remaining delivery gates

1. Commit and linked PR; all applicable checks on the latest PR commit.
2. Normal merge and readback.
3. Clean committed resident Web and backend/Agent Host build/activation, exact
   live revisions, protected
   workspace and changed-behavior verification, and launchd restart recovery.
4. Linear completion only after acceptance; stop and verify owned test cleanup.

The native binary is unchanged. Browser checks do not establish physical
trackpad behavior in the installed WKWebView application. Keep that distinction
in the delivery report; do not claim a native gesture test that was not run.
