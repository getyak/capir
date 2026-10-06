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
2. Complete: final verification, independent review and all four platform
   archive smokes passed. [PR 291](https://github.com/getyak/capir/pull/291)
   merged as `0d1c9b3e144091221033608fe8b08fff438fb943`; both release sources
   are main ancestors.
3. Active: attach the dedicated Infisical OIDC configuration, then publish
   both signed releases. The current principal lacks organization Identity
   EditAuth (HTTP 403); project access and canonical signing-key import work.
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
  CLI build/typecheck passed; tests218 passed,1 skipped (real Linux cross-filesystem
  probe unavailable on macOS; explicit EXDEV recovery test passed).
- Parent manifest/publication/policy tests35/35, docs:check and Wiki tests8/8
  passed. Workflow actionlint and shellcheck passed. Official Node package tests
  6/6 and real shell bootstrap tests10/10 passed, including bounded chunked bodies;
  four GitHub platforms remain mandatory before release acceptance.
- The signing key is canonical in `staging:/release:CAPIR_RELEASE_SIGNING_KEY`;
  readback derives the committed public key exactly. Restricted local key
  storage stays until actual OIDC signing succeeds. A temporary GitHub signing
  secret was removed and read back absent; there is no signing fallback.
- Direct target-project access succeeded. An HTTP 404 from an authentication
  probe did not establish expired authorization. The actual OIDC attach fails
  with HTTP 403 for missing organization Identity EditAuth; an eligible human
  principal must complete that operation. No tag, public release or user
  launcher change has occurred.
- Organization identity creation hit its plan quota. The dormant identity
  `4fb817bd-e093-405a-a3b2-3b49b5fb82b1` had no authentication methods,
  additional privileges or last login, both roles were no-access, and no
  repository/environment identity variable referenced it. Its baseline was
  preserved before renaming it for capir release. OIDC configuration remains
  unattached; there is no expanded access. Private admin configuration and
  resumable provisioning receipts are prepared.
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


The second run showed the pnpm action still invokes self-update from11.25 to
11.18, requesting an unavailable Intel native binary. Both package workflows
now install pnpm11.18's JavaScript distribution through a committed npm lock
with SHA512 integrity. PR smoke is a separate read-only workflow with default
checkout and no signing stage. Publication is tags-only; immutable event SHA
must equal the validated tag commit and is used by both downstream checkouts.
Release retries use GitHub rerun, avoiding a separate user-supplied ref path.
Local exact JavaScript pnpm reports11.18.0. Latest-head CI must confirm all four
platforms and closure of the workflow alerts before merge.


MiMo's single review of frozen head6431c43a completed with two lower-priority
findings, independently confirmed: a root/bin launcher was misclassified and a
repository variable was interpolated into shell source. The parent corrected
managed root/bin ownership, rejected reserved launcher paths before mutation,
and passed identity metadata through an environment variable. Current-head
closure will be recorded separately from the model's historical snapshot;
no repeated paid review of the same commit is needed.

Final local verification: CLI build/typecheck and218/219 tests passed (one
platform-specific skip); latest shell bootstrap10/10 passed. The physical-root
correction closes the independent reviewer's root/bin alias finding; regression
coverage exercises a real directory-symlink root through install, update and
rollback. Reserved-path aliases are rejected before launcher mutation.

## JavaScript scanning closure

Four real PR platform package smokes passed on4776796d, including Intel macOS.
JavaScript CodeQL then reported launcher snapshot check/use, runtime network
write and two source-policy regex alerts. Launcher snapshots now use one
no-follow, nonblocking descriptor for fstat/read/close; symlinks preserve their
identity and always require explicit replacement. Runtime archives are checked
in memory against one exact official SHASUMS entry before disk writes, with a
strict Node version. Source assertions use literal includes. The intended
verified runtime-download sink has one documented CodeQL annotation, reviewed
independently; no global query exclusion or alert dismissal was applied. Parent
CLI build/typecheck and218 passing tests (one skip) and pure35/35 passed again.
This does not claim protection from every external bin-directory writer during
plan/apply. Fresh source commits and latest-head CI still precede merge.

## Latest-head merge evidence

Release sources are `9669bd480f6fdc053f8b61e2d1718058cd6bba29` (0.2.0)
and `0cba7e8cb4531fc64d0c07b5b8105d7cf59caa0f` (0.2.1). Required CI
and Security passed that final head; all four real archive smokes passed.
The four final JavaScript alerts were independently verified false positives
and individually dismissed against their affected PR instances, with receipts
and rationale. No global query exclusion was introduced. The earlier scanning
notes describe intermediate runs, not the final disposition.

The additional Web processing-status request was delivered in PR 293. It does
not replace pending signed publication, actual install/update/rollback and
backed-up user-launcher replacement acceptance.
