# Personal settings acceptance record (2026-09-29)

Branch `codex/personal-settings-browser`, base `0c5623e3` rebased onto `origin/main`
`f015f56c`. All runs below are from this isolated checkout; no installed app,
production data, credential or other worktree was touched.

## What shipped

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
| Package (preview, unsigned) | `MACOS_OUTPUT_DIR=/tmp/ts-package bash scripts/macos/package.sh` | exit 0, universal DMG + ZIP + SHA256SUMS in a task-owned directory |

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

## Not verified

- The default browser was never actually opened and the account pages were never
  rendered in a real browser. The native opener, its failure banner and its retry
  are covered with an injected opener; the pages are covered by the Web suite and
  the HTTP integration tests. No run has driven `NSWorkspace.open`.
- VoiceOver was not exercised. Only accessibility identifiers and labels are
  asserted; no screen-reader session was recorded.
- Light and dark appearance were not captured.
- No previous Web release and no production-like database or deployment
  configuration were exercised.
- Installation was not performed: the preview package is unsigned, so the
  remaining step is a signed and notarized build plus the install decision.

## Baseline failures this change does not claim

A full `xcodebuild test` also runs `TalentSignalMacUITests`, where 16 tests fail
from their first `app.syntheticBanner` assertion onward. Running
`testTodayIsTheDefaultRetrievalSurface` in a throwaway worktree at `origin/main`
`f015f56c` reproduces that one failure at the same line, which proves that
reproduction is pre-existing; the other 15 remain open and unexplained for the
repository, and this change touches none of their surfaces.
