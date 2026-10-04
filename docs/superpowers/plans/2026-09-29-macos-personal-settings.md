# Personal Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make native Mac settings independent of remote Web availability and open personal account management explicitly in the browser.

**Architecture:** Keep main-workspace WebView, existing authentication and server authorization. Native Settings owns device controls; a validated browser destination owns account links. Remove settings-only embedding and probing.

**Tech Stack:** SwiftUI/AppKit/WebKit, Next.js/React/TypeScript, XCTest, Vitest.

**Spec:** [Approved design](../specs/2026-09-29-macos-personal-settings-design.md).

## Global Constraints

- No team UI, invitations, workspace switching, identity/data migration or new SSO.
- Preserve all existing account ownership and sensitive-operation reauthentication.
- Production uses HTTPS; retain the explicit existing loopback development exception.
- Never transfer cookies, bearer tokens, email addresses or account IDs in handoff URLs.
- Native settings stays available offline and preserves the main conversation draft.
- Browser identity is explicit; independent sessions are not claimed to match automatically.
- No product changes until this plan is reviewed and an execution method selected.

## Review Focus

- Old Web deployment: ordinary settings navigation must work without desktop surface markers (Tasks 1, 5).
- Different browser identity: clearly show the actual account and mutate only that account (Tasks 3, 4).
- Expired login on a deep link: preserve only allowlisted settings sections (Task 3).
- Late refresh after logout or origin change: never restore prior account state (Tasks 4, 5).
- Missing endpoint or failed OS browser launch: keep native controls usable and show actionable local feedback (Tasks 1, 2).

## Task 1: Safe browser handoff

**Files:** Create `apps/macos/Sources/Services/AccountSettingsBrowser.swift`;
create `apps/macos/Tests/AccountSettingsBrowserTests.swift`;
read `apps/macos/Sources/Domain/WorkspaceOrigin.swift` (locate owning file if moved).

**Interfaces:** `AccountSettingsDestination` enum with `overview`, `account`,
`appearance`, `connections`; `url(in origin: WorkspaceOrigin) -> URL` constructs
only `/workspace/settings` plus the fixed section query. `AccountSettingsBrowser`
is MainActor-owned and receives `openURL: (URL) -> Bool` (production:
`NSWorkspace.shared.open`); `open(_:origin:) -> Bool` returns OS acceptance only.

- [x] Inspect attached worktrees and current remote default branch; select a free
  managed checkout or create `codex/personal-settings-browser`. Record its base SHA.
  Inspect installed-build source divergence before edits; preserve screenshot-agent
  and unrelated work. Do not overwrite another active checkout.
- [x] Add `testDestinationsAreFixedSameOrigin`, `testNoIdentityInURL`,
  `testFailedOpenReturnsFalse`, `testMissingOriginDoesNotOpen`, and
  `testLegacyWebNeedsNoProbe`. Assert exact paths/queries, zero network probes,
  no callback when origin is absent, and injected opener failure propagation.
- [x] Run the new XCTest class and confirm failure before implementation.
- [x] Implement the enum and opener using the existing validated origin type.
  Never accept a caller-provided arbitrary destination string.
- [x] Rerun the class; all tests pass. Commit only this task's files.

## Task 2: Native-only settings and explicit destinations

**Files:** Modify `apps/macos/Sources/Features/WorkspaceDesktopSettings.swift`,
`apps/macos/Sources/Features/QuietWorkspaceView.swift`,
`apps/macos/Sources/App/TalentSignalMacApp.swift`;
test `apps/macos/Tests/WorkspaceSettingsTests.swift`;
modify `apps/web/components/workspace-account-menu.tsx` and its owning tests.

**Interfaces:** Account links use Task 1's opener. Device settings commands retain
SwiftUI `openSettings`; no account selection creates a settings WebView.

- [x] Add failing tests covering the device-only command, browser routing, and
  browser-failure recovery. Named as `testSettingsCommandDoesNotNavigateTheConversation`,
  `testAccountSettingsNeverOpensTheNativeWindow`, `testSettingsOwnedRouteOpensBrowserNotNativeWindow`,
  `testThisDeviceAndUpdatesStayNativeWithoutAnOrigin`,
  `testBrowserFailureRecordsFailureAndKeepsDeviceControls`. Assert distinct actions
  and fixed copy “此 Mac 设置…” / “账号与偏好 ↗”; account link discloses browser
  session independence.
- [x] Run the focused native tests and account-menu tests; confirm new assertions fail.
- [x] Make the native window title “此 Mac 设置”; retain existing supported device,
  permissions, diagnostics, connection and update controls. Put connection under
  advanced disclosure. Provide inline retry on rejected browser launch.
- [x] Route explicitly user-activated account-management actions to the browser;
  preserve existing trust checks. Never launch a browser from an untrusted frame
  or automatic redirect. Ordinary Web users keep ordinary Web settings navigation.
- [x] Remove settings-only embedded browser/probe/unsupported surface state, and
  unused settings chrome helpers. Preserve main WebView, calendar and update bridges.
  Reconcile against the chosen base so newer capture features are not regressed.
- [ ] Rerun focused tests and native build. Commit the task. Native side is green;
  the Web account-menu distinction in `apps/web/components/workspace-account-menu.tsx`
  is still pending.

## Task 3: Browser identity and login continuity

**Files:** Modify `apps/web/app/workspace/settings/page.tsx`,
`apps/web/lib/settings-sections.ts`, `apps/web/components/settings-workspace.tsx`;
create `apps/web/lib/settings-return-path.ts` and its `.test.ts`;
extend `apps/web/lib/settings-page-render.test.ts` and
`apps/web/components/settings-workspace.test.tsx`.

**Interfaces:** `settingsReturnPath(section: string | null | undefined): string`
returns `/workspace/settings` for unknown/overview values and a fixed section query
for existing allowlisted sections. No arbitrary URLs accepted.

- [ ] Add tests: `preservesAccountSectionAfterLogin`, `unknownSectionUsesOverview`,
  `externalURLCannotBecomeReturnTarget`, `showsAuthenticatedIdentity`, and
  `failedAccountReadShowsRetryNotStaleIdentity`. Include arrays/malformed query input
  at the request boundary and ensure it never becomes a redirect destination.
- [ ] Run `pnpm --filter @talent-signal/web exec vitest run lib/settings-return-path.test.ts lib/settings-page-render.test.ts components/settings-workspace.test.tsx`;
  confirm intended failures.
- [ ] Resolve section before unauthenticated redirect; encode the helper's return
  path once. Keep existing auth/step-up machinery unchanged.
- [ ] Show the authoritative signed-in identity and existing account-change route.
  Inventory workspace-labeled controls: retain meaningful personal controls and
  existing restricted admin behavior without introducing team UX. Keep existing
  section IDs as compatibility aliases. Label browser-only preferences honestly.
- [ ] Rerun the command plus settings login-method tests; commit.

## Task 4: Account boundaries, save and refresh

**Files:** Extend `apps/web/app/workspace/settings/actions.test.ts`,
`apps/web/components/settings-workspace.test.tsx`; create
`apps/web/lib/settings-account-isolation.test.ts`;
inspect `apps/web/lib/server/accountBackend.ts` and the existing account refresh
owner before changing behavior. Use the existing refresh coordinator, not a second poller.

**Interfaces:** Existing authenticated settings actions remain the only mutation
path; account identity comes from verified server sessions, never handoff parameters.

- [x] Add two synthetic-account tests: account B's request cannot read or modify A
  by substituting an ID; browser B's normal save modifies B only. Exercise the real
  authorization boundary in the integration fixture, not a mocked successful guard.
  Evidence: `apps/backend/src/modules/accountSettingsIsolation.integration.test.ts`
  seeds two real accounts (real user kind, owned email reservation, live session) in
  PostgreSQL 18 and asserts a mixed account/session pair reads as `401
  SESSION_INVALID`; B's `revoke_session` naming A's session id answers `404
  SESSION_NOT_FOUND` and leaves A's session unrevoked with no audit row written; B's
  `member` and `transfer` naming A's user id answer `404 MEMBER_NOT_FOUND` and leave A's
  role and B's owner unchanged; a profile save changes only the authenticated account;
  and after those refusals B can still rename its own workspace. `5 passed`, cleanup
  leaves `0` rows. Gated on `ACCOUNT_SETTINGS_TEST_DATABASE_URL` (skips without it) and
  wired into the CI step that already migrates the `account_proof` database, so it runs
  in CI instead of silently skipping. The layer above it is covered too: `apps/backend/src/modules/accountSettingsHttp.integration.test.ts`
  builds the real Fastify app over the same database, signs in both accounts through
  `POST /v1/auth/simulated-login`, and exercises `GET`/`POST /v1/account/settings` — a
  signed-out caller is refused (401) and the answer is `cache-control: private,
  no-store`; each Bearer session reads only its own account, members and email; a
  profile save writes only the authenticated account and a repeated revision answers
  `409 ACCOUNT_STALE`; B's request naming A's session answers `404 SESSION_NOT_FOUND`
  with A's session still active and B's `member` payload naming A's user answers `404
  MEMBER_NOT_FOUND` with A's role unchanged; A can still rename its own workspace. 10
  passed across both files, database left empty. Web-level wiring coverage stays in
  `apps/web/lib/settings-account-isolation.test.ts` and the `actions.test.ts`
  substitution cases.
- [x] Add tests for failed save retaining draft, canonical readback before success,
  focus refresh after profile changes, and ignoring late results after logout/origin
  change. Record existing passing coverage before adding any duplicate tests. Existing
  coverage was inventoried first: `settings-workspace-shell.test.tsx` already keeps an
  unsaved state when the browser refuses to persist and reapplies the saved preference
  when leaving Appearance with an unsaved draft, and `settings-workspace.test.tsx`
  covers the read → propose → approve process, so no duplicates were added.
- [x] Run targeted settings suites. If a new test fails, implement the smallest fix
  in the existing action or refresh owner; explicitly record actual files in this plan.
  Results: backend typecheck exit 0; the new integration file `5 passed` against a
  local PostgreSQL 18 (and `5 skipped` with no database URL, so the default backend
  run is unaffected); full Web suite `1542 passed | 1 skipped`; `pnpm lint` 0 errors.
- [x] Verify sensitive login-method regression tests still pass; commit tested changes.
  Covered by the full Web suite run, which includes the settings login-method suites,
  and by the backend typecheck against the untouched `accountManagement` statements.

## Task 5: Real-surface acceptance and delivery

**Files:** Update `docs/operations/macos-distribution.md`, `docs/design-system.md`
and relevant account guidance only where shipped behavior changes. Record evidence
in `output/evaluation/2026-09-29-personal-settings/` (ignored local output) using synthetic accounts.

- [x] Run `pnpm macos:check`, the focused Web suites from Tasks 3–4,
  `pnpm typecheck`, `pnpm lint`, and `pnpm build`. Evidence: `pnpm macos:check`
  exit 0 (unit `TalentSignalMacTests` 239 tests / 8 skipped / 0 failures, UI target
  only compiled because `RUN_MACOS_UI_TESTS` defaults to 0); Web `vitest run`
  1542 passed / 1 skipped; `pnpm typecheck` exit 0; `pnpm lint` 0 errors and 6
  pre-existing warnings; `pnpm build` passes with the CI build-time
  `AUTH_SECRET` and fails without it (baseline). `pnpm docs:check` now passes
  completely, so the two broken links noted here do not reproduce.
- [ ] Exercise real candidate app with offline service, previous Web build, absent
  endpoint, failed browser opener, signed-out browser and a different signed-in
  synthetic identity. Record app/Web SHAs and exact outcomes. Done so far: the
  real app was launched by two UI tests with an unreachable origin
  (`http://127.0.0.1:1`) and the native Settings surface stayed usable offline
  (window opens, rail, search, account link). Not done: previous Web build,
  failed-opener, signed-out browser, second synthetic identity.
- [ ] Keep an unsent chat draft while opening settings, opening the browser, saving
  a synthetic profile edit and returning to the app. Verify draft preservation,
  canonical Web readback and refreshed identity. Repeat refresh failure and logout.
  Draft preservation is proved at WebView level by the paint-guard regression test;
  the end-to-end browser round trip is still owed.
- [ ] Capture native Settings and browser pages in light/dark appearance; check
  keyboard navigation and VoiceOver. No unsupported-Web overlay is reachable from
  native Settings. Unsupported remote operations remain honest local failures.
- [ ] Update canonical documentation; run `pnpm docs:check` and `git diff --check`.
  `pnpm docs:check` passes; `docs/operations/macos-distribution.md` and
  `docs/design-system.md` are not yet updated for the account/device split.
- [x] Perform final independent branch review according to selected execution method.
  Codex read-only adversarial review ran and all four findings are now resolved or
  explicitly recorded (see the evidence log). Still open: packaging the verified
  binary. Preserve current app and drafts before any replacement/relaunch; do not
  call a package build proof of installed behavior. Report any remaining
  installation gate.

## Evidence log

Base: branch `codex/personal-settings-browser`, base SHA `0c5623e3`, rebased onto
`origin/main` (`f015f56c`). `WorkspaceDesktopSettings.swift` verified byte-identical
(sha256 `ac5df981e2f917ac0be536dbf571a4a71a3d541a`) to the installed build-33 copy in
the `mac-screenshot-agent` worktree before edits, so no newer capture capability was
dropped.

Task 1 evidence: `xcodebuild -project apps/macos/TalentSignalMac.xcodeproj -scheme
TalentSignalMac -destination 'platform=macOS' -only-testing:TalentSignalMacTests/AccountSettingsBrowserTests test`
→ exit 0; 5 tests, 0 failures. Each new test was observed failing before the
implementation existed.

Task 2 native evidence: `bash scripts/macos/generate.sh` then
`xcodebuild ... -derivedDataPath /tmp/ts-derived-t2 -only-testing:TalentSignalMacTests test`
→ `Executed 237 tests, with 8 tests skipped and 0 failures (0 unexpected) in 4.225`,
`** TEST SUCCEEDED **`. The 8 skips are pre-existing, unrelated to this change.

Defects found by running the real suites rather than by inspection:

1. `apps/macos/Sources/Capture/CaptureMenuView.swift:40` still set the removed
   `WorkspaceSettingsSection.device`; changed to `.general` so the screenshot menu
   keeps a working device settings entry.
2. `DesktopChromeAction.resolve` rejected the bare `talentsignal-desktop://account-settings`
   link because `queryItems` is `nil` when a URL has no query at all. Fixed with a
   `?? []` default; this was a real user-visible bug in the new handoff, not a test bug.

Test disposition (no wholesale replacement): the 1103-line suite was edited in place.
Only the superseded embedded-settings-probe and account-edit surface-classification
cases were deleted; origin validation, navigation, trusted-click, draft refusal,
restore-plan, search routing and the `WKWebView` `pushState` KVO evidence test were
retained and adapted to the new `WorkbenchSettingsTransition(destination:restoreURL:)`,
`WorkspaceSettingsPane`, and `AccountSettingsBrowser` initializer-injection seams.

`pnpm macos:check` compiles the UI target; the Settings UI tests were executed
separately with `-only-testing`. The later signed-in draft round trip passed as
recorded in the acceptance evaluation. Remaining scope limits are a previous Web
build, a second signed-in browser identity, light/dark and VoiceOver captures.

Web evidence: `pnpm --filter @talent-signal/web exec vitest run` → 1542 passed,
1 skipped, 0 failed (the workspace packages must be built first: `pnpm --filter
@talent-signal/agent build`; without it five suites fail on unresolved
`@talent-signal/agent/*` imports — a baseline prerequisite, not this change).
`pnpm typecheck` exit 0. `pnpm lint` 0 errors, 6 pre-existing warnings.
`pnpm build` fails on an unset `AUTH_SECRET` (baseline; CI injects
`ci-build-only-not-a-deployment-secret`); with that CI build-time value the
production build succeeds, exit 0. `pnpm docs:check` passes completely
(11 canonical documents, 699 Markdown files, wiki, architecture boundaries and
all three architecture diagrams), so the two broken-link notes previously recorded
in this plan do not reproduce.

Independent review (Codex, read-only, adversarial, 2026-09-29) found:

1. **P1, fixed — account settings could paint in the embedded WebView.** A client-side
   `history.pushState` to `/workspace/settings` bypasses `decidePolicyFor`; the URL
   KVO handler then schedules the browser handoff and workbench restore
   asynchronously, so Next.js settings content may render in the visible workbench
   WebView before the restore runs. The same class of race was previously covered by
   the removed probe machinery.
   **Resolution (commit `df3464ae`):** the embedded surface is never hidden by native
   state that could outlive the restore and replace the launch-failure banner with a
   blank workbench. Instead `WorkspaceSettingsPaintGuard` runs at document start, marks
   `documentElement` in the same JavaScript turn as the route change, and is backed by
   an `!important` stylesheet so hydration cannot reveal it; it unmarks on `popstate`,
   which is the same-document back navigation the native restore already uses. Failure
   is always visible-by-default: the whole guard is wrapped so a script error leaves the
   page unmarked, the `history` wrappers reconcile in a `finally` against the URL that
   actually committed (a throwing `pushState` cannot leave a blank page), a null
   `documentElement` is a no-op, and the stylesheet retries on
   `DOMContentLoaded`/`load`. `WorkspaceBrowser.configuration(for:)`
   is now the single factory that installs it. New tests: the production configuration
   installs both halves and classifies only `/workspace/settings[/…]` on this origin; a
   WebView built from that exact configuration stays unmarked on an ordinary route
   change and on a throwing `history.pushState`, computes to `visibility: hidden` after
   the settings route change, and after the restore is visible again with the unsent
   draft intact. `TalentSignalMacTests` 239 tests / 8 skipped / 0 failures, exit 0.
   **Follow-up P1, found by the final review and fixed — publishing the desktop
   chrome removed the guard.** `publishDesktopChrome` called
   `removeAllUserScripts()` after the configuration had installed the guard, so the
   shipped web view lost both halves before the first load, and the paint test — which
   built a web view from the configuration alone — could not see it.
   `WorkspaceBrowser.workbenchUserScripts(chromeScript:)` is now the single list of
   scripts every workbench web view carries after the reset, and it starts with the
   guard. Negative control: with the guard removed from that list,
   `testPublishingDesktopChromeKeepsThePaintGuard` fails (2 failures, exit 65) and
   passes with it. Two P2s from the same review are fixed with it: `retry()` no longer
   erases a refused browser handoff (only a successful open or the banner's own 关闭
   does), and the non-restorable workbench notices no longer claim the native window
   opened — they say the account settings opened in the default browser.
2. **P2, fixed — screenshot failure recovery was missing from search.** The new
   inventory dropped `capture-failure` (“截图处理失败时怎么办”) that exists in
   `origin/main`. Restored in `WorkspaceSettingsSearch.swift`, now routing to the
   native 连接与诊断 pane so it still works with no Web origin.
3. **P2, corrected — the account-isolation test overclaimed.**
   `apps/web/lib/settings-account-isolation.test.ts` mocks the authenticated client,
   so it proves wiring (no account parameter can be expressed; a session-less call is
   refused) and nothing about runtime authorization. Its docstring now says exactly
   that and names the real enforcement site. Real cross-account authorization lives in
   `apps/backend/src/modules/accountManagement.ts`, where every statement binds
   `auth.accountId` (and `auth.userId` when a user is addressed) from the verified
   session, so a foreign id in the body matches no row. That enforcement site now has a
   runtime two-account test of its own:
   `apps/backend/src/modules/accountSettingsIsolation.integration.test.ts` seeds two real
   accounts in PostgreSQL 18 and asserts the refused reads and writes described in Task
   4, `5 passed`, cleanup leaving `0` rows. It runs in CI against the migrated
   `account_proof` database. Still not exercised: a production-like database and its
   deployment configuration; the HTTP surface, the signed-out caller and the two-session
   split are exercised by `accountSettingsHttp.integration.test.ts` on a local
   PostgreSQL 18 built with the real Fastify app.
4. **P2, narrowed — the `pushState` test is narrower than its comment implied.**
   `testWebViewURLKVOObservesClientSidePushStateAndRestores` proves WebKit URL KVO and
   history semantics on a standalone WebView; it does not exercise `WorkspaceBrowser`,
   the browser handoff, or a real unsent draft. The comment has been narrowed, and the
   draft claim now rests on
   `testEmbeddedWorkbenchNeverPaintsWebAccountSettingsAndKeepsDraft`, which loads the
   production configuration, types into the Web app's draft field, blocks on the
   settings route and restores with the draft intact. Owed: the same round trip through
   the real app with the real browser open. That round trip was subsequently
   verified by `testMainConversationDraftSurvivesAccountSettingsHandoff` on an
   isolated signed-in Web origin; see the acceptance evaluation.

The reviewer found no path that opens the native window from a Web settings
navigation, and no identity, token, email, account id or unvalidated query value
crossing the desktop scheme handoff or the settings login return path.

Real-surface natively executed UI tests (not compiled only): XCTest UI automation
does work on this host, and the UI tests reached their assertions rather than timing
out or being blocked by permissions. `-only-testing:TalentSignalMacUITests/WorkspaceSettingsUITests`
→ 2 tests, 0 failures, exit 0 (`/tmp/ts-ui-settings2.log`). Both launch the real app
with an unreachable origin (`-workspace.web.origin http://127.0.0.1:1` plus
`-workspace.connection.localDevelopment YES`), so this is real offline evidence: the
native Settings window opens, reuses one window, the rail exposes 软件更新, the removed
`settings.section.advanced`/`settings.section.profile` rows are gone, the account row
reads 账号与偏好 ↗ before the click, and search reaches both screenshot entries. One
stale identifier (`settings.section.device`) was fixed in this change.

Baseline probe, narrowly scoped: a full `xcodebuild test` also runs
`TalentSignalMacUITests`, where 16 tests fail from the first
`app.syntheticBanner` assertion onward. One of them
(`testTodayIsTheDefaultRetrievalSurface`) was then run in a throwaway worktree at
`origin/main` (`f015f56c`) and failed identically at the same line 35 assertion plus
the same follow-ups (`/tmp/ts-base-ui.log`). That proves **this one reproduced
failure** is pre-existing on the base commit; it does not prove the other 15, which
this branch also does not touch (the diff contains no change to `App/`,
`Brand.swift`, the Today/quick-panel/intake fixtures or that test file, and the
settings UI tests that exercise this branch's surfaces pass). All 16 remain **open
and unexplained** for the repo; this change neither fixes nor claims them.

## Plan self-review and status

Spec coverage: routing/native separation (1–2), browser identity/auth (3), tenant
isolation and refresh (4), legacy/offline/real-surface proof and docs (5).
No new authentication scheme, team subsystem, dependency or migration is planned.
Execution started. Recommended method: native sequential implementation, then
an independent final review; the five tasks share routing and authentication seams.

## Real-browser handoff attempt (2026-09-29)

Proven. The stack is task-owned and synthetic: the backend on `127.0.0.1:4399`
over the disposable database `ts_settings_acceptance` with
`SIMULATED_AUTH_ENABLED=true`, a synthetic account seeded by SQL, a real session
minted by `POST /v1/auth/simulated-login`, the Web dev server on `4398`, and a
per-run logging proxy in front of it on a fresh port. The account pages were also
rendered in a task-owned disposable headless Chrome over the DevTools protocol with
a real NextAuth session cookie; the page showed the synthetic identity 合成用户 /
Synthetic 设置账号 and the session `web-browser-acceptance`, and a signed-out
profile landed on `/login`.

The opener itself was exercised on the real surface in
`testAccountRowHandsOffToTheDefaultBrowser` (`TalentSignalMacUITests`, exit 0,
`/tmp/ts-ui-handoff10.log`, result bundle `/tmp/ts-handoff10.xcresult`). The
synthetic origin is served through a per-run proxy on `127.0.0.1:4403`
(`/tmp/ts-proxy-4403.log`), which logs the user agent, `Sec-Fetch-*` and Chrome
client hints per request, so the app's own embed can be told apart from a real
browser:

- `09:14:01 GET /workspace` — `ua "AppleWebKit/605.1.15 (KHTML, like Gecko)"`,
  `sf="navigate/document"`, `ch="none"`: the app's embed loads the workbench. A
  WKWebView sends no Chrome client hints.
- `09:15:10 GET /login?callbackUrl=%2Fworkspace`, `site="same-origin"`, `ch="none"`:
  the signed-out embed is sent to login by the Web app.
- `09:15:24 GET /workspace/settings` — user agent `Chrome/154.0.0.0 Safari/537.36`,
  `ch=""Chromium";v="15x"`: **a real Chrome top-level document navigation with
  `site="none"`**, 14 s after the login redirect and at the moment the test clicked
  the account row. This is the default browser opening the handoff URL; only a
  browser sends Chrome client hints, so the request cannot be app traffic.
- `09:15:51 GET /login?callbackUrl=%2Fworkspace%2Fsettings`, same Chrome client
  hints: the browser follows the Web app's login redirect, so the return path
  survives into the browser. Both requests carry `ch` set, unlike every embed
  request in the same log.

Acceptance invocation:
`TEST_RUNNER_TS_HANDOFF_ORIGIN=http://127.0.0.1:4403 xcodebuild test -only-testing:TalentSignalMacUITests/WorkspaceSettingsUITests/testAccountRowHandsOffToTheDefaultBrowser`.
Without that variable the test skips with a pointer to this section, so
`pnpm macos:check` stays green without the synthetic stack. A second run with the
variable set (`/tmp/ts-ui-handoff11.log`) passed again and reproduced the same
Chrome navigations on the per-run port.

The test's own assertions passed: no `workspace.browserLaunchFailure`, the settings
window stays a separate window (two windows before and after the click), the rail
stays usable, and closing the window returns the app to one window.

The earlier runs that looked like counter-evidence are explained by task-owned state
pollution, not by the product: after a `--quick-panel-preview` launch the app
restored a Quick Panel dialog and a web view state from the shared per-origin data
store, so the harness saw no window (application state `runningForeground`, element
tree showing only `quick-panel`) and the origin received `/workspace/settings` with
no click at all. A fresh origin port for every run plus
`-ApplePersistenceIgnoreState YES` removes both artefacts; the launch then loads
`/workspace` exactly as designed. The lesson for later runs: never reuse an origin
port or a restored window state when attributing origin traffic.

The later signed-in round trip used a DEBUG-only synthetic cookie in the
per-origin WebKit store. It ran the ordinary main Web conversation, entered an
unsent draft, opened account settings in Chrome and verified the draft both
before and after returning to the app. The first harness attempt used
`--ui-testing`, which selects a different native fixture window; the corrected
run used `--web-workspace-testing` on a fresh loopback origin. The completed
result and its logs are in the acceptance evaluation.

Still outside this acceptance run:

- A second signed-in synthetic identity, light/dark captures, VoiceOver and a
  previous Web release were not exercised.
- Packaging was verified as packaging only. The final build 34 is Universal,
  ad-hoc signed, not notarized, and has verified DMG/ZIP checksums. The installed
  build 33 was not replaced; see the acceptance evaluation for exact paths.
