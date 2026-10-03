# Personal settings acceptance record (2026-09-29)

Branch `codex/personal-settings-browser`, base `0c5623e3` rebased onto `origin/main`
`f015f56c`. All runs below are from this isolated checkout; no installed app,
production data, credential or other worktree was touched.

## Implemented on branch

`⌘,` raises one independent native window titled 此 Mac 设置 with a single
navigation owner: 通用, 权限, 连接与诊断, 软件更新 and the account row
账号与偏好 ↗. The settings-only embedded Web surface, its DOM/CSS compatibility
overlay and its surface probe are gone. Account, appearance and account-connection
management open in the default browser. The handoff carries a destination only.

## Verified

| Surface | Command | Result |
| --- | --- | --- |
| macOS unit | `xcodebuild ... -only-testing:TalentSignalMacTests test` | 239 tests, 8 skipped, 0 failures, exit 0 |
| Native settings UI (real app) | `xcodebuild ... -only-testing:TalentSignalMacUITests/WorkspaceSettingsUITests test` | 2 tests, 0 failures, exit 0 |
| Web | `pnpm --filter @talent-signal/web exec vitest run` | 1542 passed, 1 skipped |
| Backend typecheck | `pnpm --filter @talent-signal/backend typecheck` | exit 0 |
| Lint | `pnpm lint` | 0 errors, 6 pre-existing warnings |
| Docs | `pnpm docs:check` | pass (11 canonical documents, 699 Markdown files, 3 diagrams) |
| Production build | `AUTH_SECRET=ci-build-only-not-a-deployment-secret pnpm build` | exit 0 |
| Account settings, module boundary | `vitest run src/modules/accountSettingsIsolation.integration.test.ts` | 5 passed against local PostgreSQL 18 |
| Account settings, HTTP boundary | `vitest run src/modules/accountSettingsHttp.integration.test.ts` | 5 passed against local PostgreSQL 18 |
| Final preview package | `MACOS_BUILD_NUMBER=34 MACOS_OUTPUT_DIR=/tmp/ts-package-final-20260929 bash scripts/macos/package.sh` | exit 0; universal DMG + ZIP + SHA256SUMS. Bundle reports `0.1.0 (34)`, contains arm64 and x86_64, passes strict signature verification and both SHA-256 checks. Release binary contains no test-session helper. |
| Account page in a real browser | disposable-profile headless Chrome over CDP against the loopback Web server | page rendered with the synthetic identity 合成用户 / Synthetic 设置账号 and the session `web-browser-acceptance` |

That browser row is page-level evidence from a task-owned disposable profile: the
account page renders with a real session cookie. It is not evidence of the
handoff, which is recorded in the row below.

| Real app-to-browser handoff | `testAccountRowHandsOffToTheDefaultBrowser` (exit 0, `/tmp/ts-ui-handoff10.log`) against a task-owned per-run origin on `127.0.0.1:4403` behind a logging proxy | the proxy log `/tmp/ts-proxy-4403.log` shows the embed loading `/workspace` with a WebKit user agent and no Chrome client hints, then, at the click, a Chrome top-level document navigation to `/workspace/settings` with `sec-ch-ua: "Chromium"` and `sec-fetch-site: none`, followed by `/login?callbackUrl=%2Fworkspace%2Fsettings` from the same browser client |
| Main conversation draft round trip | `testMainConversationDraftSurvivesAccountSettingsHandoff` against the signed-in synthetic Web service on `127.0.0.1:4404` | 1 UI test passed, exit 0 (`/tmp/ts-draft-ui3.log`); the unsent main Web composer value remained after opening browser account settings and returning to the app. The per-run proxy recorded a Chrome top-level request for `/workspace/settings` after the click. |

A fresh origin port per run plus `-ApplePersistenceIgnoreState YES` removed the
task-owned state pollution that made earlier runs misleading: a restored Quick Panel
dialog hid the main window from the harness and a restored embed route produced
`/workspace/settings` with no click at all.

The package row is a packaging check only. The preview is ad-hoc signed and
not notarized; it was written to a task-owned directory, and no installed
application was replaced. Build 34 is newer than the installed build 33. A
checksum-verified review copy of the DMG, ZIP and manifest is in the ignored
`output/settings-build34/` directory of this worktree.

The two UI tests launch the real app with `-workspace.web.origin
http://127.0.0.1:1`, so they are offline evidence: the native window opens, reuses
one window, exposes the device sections, shows 账号与偏好 ↗ before any click, and
reaches the screenshot recovery entries through search with no Web origin.

The two integration files seed real accounts in a disposable PostgreSQL 18
database and prove the isolation claim at both the module and HTTP layers: a
signed-out caller is refused, B's session reads only B, a payload naming A's
session answers `404 SESSION_NOT_FOUND` with A's session still active, a payload
naming A's user answers `404 MEMBER_NOT_FOUND` with A's role unchanged, and a
stale revision answers `409 ACCOUNT_STALE`. Both are gated on
`ACCOUNT_SETTINGS_TEST_DATABASE_URL` and wired into the CI step that migrates
`account_proof`.

The signed-in run used the existing `--web-workspace-testing` launch path. A DEBUG-only
test helper seeded a short-lived synthetic session cookie into the isolated WebKit
store before the first request. It admits only an explicit test launch and a
loopback origin; release builds exclude the helper. The earlier `--ui-testing`
attempt displayed a different native fixture surface and could not exercise the
main Web composer. The first Web run also targeted the HTML `id`, which WebKit did
not expose as an XCTest identifier; the successful run located the visible
“消息” text view and waited until it became editable before typing.

## Not verified
- VoiceOver was not exercised. Only accessibility identifiers and labels are
  asserted; no screen-reader session was recorded.
- Light and dark appearance were not captured.
- No previous Web release and no production-like database or deployment
  configuration were exercised.
- Installation was not performed: external distribution needs a Developer ID
  signed and notarized release. The preview package is for review and local
  testing, and the installed build 33 is unchanged.

## Baseline failures this change does not claim

A full `xcodebuild test` also runs `TalentSignalMacUITests`, where 16 tests fail
from their first `app.syntheticBanner` assertion onward. Running
`testTodayIsTheDefaultRetrievalSurface` in a throwaway worktree at `origin/main`
`f015f56c` reproduces that one failure at the same line, which proves that
reproduction is pre-existing; the other 15 remain open and unexplained for the
repository, and this change touches none of their surfaces.
