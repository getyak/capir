# capir standalone release and updates

## Outcome and authorization

The user authorized a real GitHub Release, standalone installation, explicit self-update, recoverable version replacement, and automatic update checks. Parent owns GitHub writes, signing secret, review, merge and release acceptance. Implementation is delegated to Pi + MiMo Pro; it may not publish, change credentials or modify the existing user installation.

## Baseline and boundary

- Frozen base: `61a24dab5af78a4ba33cd783e3babcbd05274a72` (fresh origin/main).
- Existing user launcher targets release `d9153b46`; no updater exists.
- Existing checkout has unrelated dirty UI work; task is isolated.
- Supported standalone targets: macOS arm64/x64 and Linux glibc arm64/x64. Windows remains source-installed, explicitly unsupported by this POSIX updater.
- Auth, model configuration, journals and sandbox/test-account semantics stay outside release files.
- Auto-check is a bounded update notification, not automatic installation. Help/version and machine/noninteractive invocations stay offline.

## Approach

Publish immutable `capir-v0.2.0` and `capir-v0.2.1` from two reviewed commits in one merge-preserved PR, then use them for a real GitHub update. The final current version is 0.2.1; 0.2.0 is the retained update baseline. Bundle pinned Node 22.23.2, CLI dist, production dependencies and licenses. A dedicated `capir-stable` channel carries a signed manifest and installer, separate from desktop latest releases. RSA SHA256 manifest verification uses a committed public key; the private key is delivered from staging:/release in Infisical through a dedicated GitHub OIDC identity; local restricted signing storage is removed after verified cutover. Publish channel last, after all target archives pass standalone smoke. Version directories and atomic current symlink switching keep running versions intact. Explicit rollback preserves the previous install.

## Milestones

1. Complete locally: release packaging, bootstrap, updater, offline routing,
   rollback and bounded automatic notices; preserve unrelated user work.
2. Active: final package/bootstrap verification and latest-head CI. Independent
   review has closed all confirmed findings; re-review material changes.
3. Pending: merge the two version commits through required checks, then publish
   both signed releases using the dedicated Infisical OIDC identity.
4. Pending: install A from GitHub, publish B, verify automatic notice and real
   update/rollback/re-update/no-op; migrate the legacy launcher with backup.

## Completion evidence

Link merged PR, release and signed manifest; retain sanitized command evidence for release installation, update/replacement, rollback, automatic check behavior, signature/tamper rejection, focused tests and platform smoke. Never claim a fixture test proves GitHub publishing. Do not finish at ready_for_review or queued CI.

## Current evidence and remaining work

- Delivery worktree: `/Users/cubxxw/.codex/worktrees/capir-release-updater/talent-signal`.
  Frozen main remains `61a24dab5af78a4ba33cd783e3babcbd05274a72`.
- Pi task `20261005-150809-9dedd737` stopped after its generated `_index/log.md`
  exceeded the worker contract. Parent inspected and selectively transferred
  implementation, final tests and canonical article. The parent wiki build
  owns generated docs/log. No further worker budget was started.
- Parent reconciled the hash-bound snapshots, preserving all independently
  confirmed fixes: confined archive links, physical install binding, launcher
  byte/symlink undo, lock/recovery ordering, retry adoption, staged/reused source
  binding and actual-version smoke, value-aware notice exclusions and TTY gating.
- Final independent review closed publication source freezing, dispatch input,
  monotonic channel promotion and release retry defects. Public version assets
  remain read-only. Unpublished drafts may rebuild only as a complete verified
  seven-file cohort. A verified promotion checkpoint is persisted before channel
  clobber, so deletion-before-upload failures remain resumable without downgrade.
- Independent review also closed cross-filesystem installation, absolute custom
  paths, bounded bootstrap streaming, failed-smoke cleanup and binary launcher
  restoration. Publication regressions13/13 passed independently. Parent full
  CLI build/typecheck passed; tests214 passed,1 skipped (real Linux cross-filesystem
  probe unavailable on macOS; explicit EXDEV recovery test passed).
- Parent manifest/publication/policy tests34/34, docs:check and Wiki tests8/8
  passed. Workflow actionlint and shellcheck passed. Official Node package tests
  6/6 and real shell bootstrap tests10/10 passed, including bounded chunked bodies;
  four GitHub platforms remain mandatory before release acceptance.
- Signing key is generated in restricted parent-owned local storage. Its public
  key is committed; canonical import and a dedicated OIDC identity still require
  human Infisical reauthorization. Latest read-only local auth check returned404.
  A previously provisioned temporary GitHub secret was removed and read back
  absent; there is no signing fallback. Credential details remain private.
- GitHub `capir-release` environment is provisioned with custom deployment policy
  allowing only `main` and `capir-v*`. Ruleset24493698 protects only `capir-v*`
  version tags from update/deletion; creation stays permitted and the mutable
  `capir-stable` tag is outside this rule. Canonical repository: `getyak/capir`,
  id1322192683; old `getyak/talent-signal` URLs redirect.
- Existing user launcher is unchanged; its recorded SHA256 is
  `038d2bd42f0259ae3f71fb1384600eb1967f6fd81771f6c3de7a59af5e35f843`.
  Recheck immediately before authorized migration.
- Private sanitized acceptance helpers and receipts live in the parent task
  state directory. Registered test artifact root:
  `/private/tmp/ai-test-capir-release-updater.OEf0wc`. Preserve unique evidence
  until durable delivery, then remove only this task's artifacts.

Real GitHub publishing, four-platform CI and installed-user replacement are not
proven by local fixtures. This plan stays active until those observations exist.


## First GitHub run and corrections

PR291 first head `6431c43ac00f886b11bc3cfa5cfd8d72191bb77b` built and
smoked real darwin-arm64, linux-arm64 and linux-x64 archives. Intel macOS stopped
in pnpm bootstrap. The pinned pnpm v11 action requires Node22.13+ to be installed
first on Intel macOS; this is now explicit. The package job disables all store
caching and uses separate default-event PR checkout versus validated release
SHA checkout, addressing the introduced CodeQL workflow alerts. Workflow output
redirections are grouped for CI shellcheck. Full-repository actionlint with
shellcheck on PATH and policy15/15 passed; independent review found no defect in
this correction. The next source commits will become the release A/B targets;
prior PR history is preserved. Fresh-head CI remains required before merge.
