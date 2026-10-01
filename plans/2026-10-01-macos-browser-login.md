# Browser-owned macOS sign-in

## Outcome and authorization

The user requests complete implementation, replacement of the earlier desktop-login design, elegant boundaries, explicit successful-chain standards, and no username/password entry in the Mac application. Browser authentication may use the existing Web methods. Codex owns architecture, integration, independent acceptance and delivery; Pi/MiMo owns a bounded implementation and first local checks. Do not touch unrelated worktrees, accounts or evidence. Do not re-enter the incomplete September 25 linking protocol as a prerequisite.

## Baseline and scope

Fresh origin/main: `127600957161ac52f910ac05f1aeb77b1daf9490`. Parent worktree: `/Users/cubxxw/.codex/worktrees/macos-browser-sign-in/talent-signal`, branch `codex/macos-browser-sign-in`. Original checkout has unrelated untracked documents and plans, preserved. GET-43 belongs to IMStage and is unrelated; do not edit it.

In scope: browser-owned primary login, durable one-use backend grant, first-party browser confirmation, authenticated WebKit cookie installation, native recovery and origin/store ownership, relevant tests, updated canonical documents. Existing account methods, onboarding, Web sign-in, account identity and retention remain authoritative. Account settings remain in the external browser; no new native credential-linking protocol. No passkey registration, global account migration, copied browser cookies, broad native bridge, provider secret changes, iOS Simulator or new token lifetime policy.

## Decision

[ADR 0022](../docs/decisions/0022-browser-owned-macos-login.md) replaces ADR0019's per-provider primary-login protocol. A single first-party browser flow uses the current verified Web account with explicit approval and issues a separate Mac device session. Provider/password authentication stays entirely in that browser. ASWebAuthenticationSession owns callback delivery; PKCE binds exchange to the initiating app operation. Native never receives provider credentials or copies authentication cookies. A new identified WebKit store isolates each new primary login; durable selection and unresolved markers protect restart and late responses.

## Milestones

1. Complete: implement backend grant, Web confirmation/exchange/status, and native user flow on the frozen baseline with Pi.
2. Source accepted: independently inspect diff and run backend/PostgreSQL, Web, real WebKit and native acceptance; close confirmed P0/P1 findings with independent reviewer. Full system-browser user acceptance remains pending below.
3. Pending: run current-head required checks; create reviewable PR; rebuild/redeploy local backend as required by apps/backend/AGENTS.md and verify affected Web/native surfaces without claiming a production release or modifying provider accounts.
4. Pending: route final decisions/operations evidence, preserve formal receipts and clean only task-owned temporary artifacts.

## Successful chain and failure evidence

Success requires all of: the real native login entry; browser identity read from the live backend; intentional browser approval for this Mac operation; correctly bound one-use callback; atomic backend device-session creation; normal HttpOnly session cookie installed in the selected WK store; no-cookie-write live backend status identifying the exact approved account AND user; original workspace/onboarding opened with the same canonical identity. An HTTP call, callback, DOM flag, auth JWT decode alone or helper test is insufficient.

Exercise wrong state/verifier/code/origin, arbitrary redirect, expired/replayed/cancelled grants, browser-session revocation, Lab refusal, double-click/concurrent operations, delayed cookie responses, account and endpoint switches, cancellation before/after possible exchange, restart with unresolved selection, network loss and exact read-only recovery. Never replay a potentially consumed grant to manufacture success. Existing valid Mac sessions reopen without launching the browser; expired sessions expose the same browser-only entry and preserve recoverable drafts.

## Environment and receipts

Storage audit initially reports 76 GiB free against the 80 GiB heavyweight-build threshold. No iOS Simulator is required. Inspect reclaimable package caches safely before native heavyweight builds, preserve active task artifacts and repositories. Pi preflight is offline only: Pro credential present, no active Pi writer found. Relevant sources: Codex and Claude Code official browser-auth docs, RFC8252, Apple ASWebAuthenticationSession and identified WK data stores, installed Next.js route/cookie guides and Auth.js supported Credentials signIn APIs.

## Open uncertainties

Actual provider/password interaction may require the human's credentials or OS confirmation; do not fake it. Controlled account/browser/WebKit proof can establish protocol mechanics separately. Installed-app and production-release changes need an independently verified source/binary boundary; do not claim the user's installed app changed after only building test source. Source implementation and deployed acceptance are separate.

## Implementation batch

Pi task `20261001-143724-30881287`, frozen base `72381674`, provider `xiaomi-token-plan-cn`, model `mimo-v2.6-pro`, one implementation owner. Contract lives in the private Pi state directory; worker owns source only, parent owns this plan and ADR/operations. Offline dependency setup completed and implementation is running. No provider credentials, real account mutations, installed-app changes or production release are delegated.

## Environment checkpoint

`dev-storage-guard prune-pnpm` removed unused package-cache metadata/files without deleting repositories or test evidence. Parent offline install then required refreshed package-manager metadata; online frozen-lockfile install restores exactly the reviewed dependency graph, with no package upgrade. Disk remains below the heavyweight-build threshold, so native heavyweight work is deferred. Existing updater/app caches and active services remain intact. Capture transport currently constructs a second WK host at `apps/macos/Sources/Capture/CaptureTransport.swift`; parent will own that path if it falls outside the frozen Pi scope.

## Acceptance environment

Parent task artifact directory: `/private/tmp/ai-test-macos-browser-login-20261001.wcgXIc`. Disposable PostgreSQL18 Compose project `ts-desktop-browser-login`, loopback port55491, no permanent restart. It holds synthetic test identities only and will be stopped with `down --volumes --remove-orphans` after formal receipts are preserved. Canonical document updates pass `pnpm docs:check` at parent `c69aba80`.

## Independent acceptance checkpoint

Parent-owned `desktopBrowserLogin.postgres.test.ts` runs against the disposable migrated database. Concurrent consumption passes: exactly one session and exact grant/session/account/user correlation. The real PostgreSQL revoke/consume race fails: a revocation already holding the browser session write lock does not prevent candidate code from minting a device session. This is a confirmed blocker, not a flaky HTTP result. Preserve account-before-session row locking and independently rerun this regression after repair. The worker's nineteen mocked unit tests cannot establish this concurrency boundary. Exact Web-origin binding, idempotent approval identity checks, and bounded anonymous-grant cleanup remain review targets.

## Native integration and review checkpoint (October 1)

Parent owns all native source/tests and Capture integration after the candidate failed production-construction inspection. The login coordinator now survives WebKit-host recreation and is shared across workspace windows; actual WK navigation completion, isolated receipt parsing and nested live status parsing precede admission. Persistent process ownership, commit-before-publication epochs, restart unresolved markers, fresh-store corruption recovery, and old Capture host retirement are implemented. Xcode Debug build passes; eighteen targeted native state/store/connection tests pass. A separately opted-in real-WebKit fixture test passes against real backend/Web routes: anonymous prepare, synthetic backend approval, actual Auth.js cookie installation in the selected WK store, live correlated status, reopened-store readback and stale-store refusal. It explicitly does not substitute for OS browser approval.

Independent sub-agent review confirmed URL query proof logging and expiry-after-row-lock waiting bugs. Automatic Fastify URL logging is now path-only with real injection regression; Next development request logs exclude first-party auth URLs. Corrupted-registry UI recovery now reaches the browser-owned action. Pi repair 3 owns only backend module/expiry regressions; native source and presentation remain parent-owned. The original revocation race now passes in real PostgreSQL. The current OS ASWebAuthenticationSession starts and displays matching codes, but the default Chrome window cannot be read by CUA (timeout); the full OS callback chain remains pending, and a user observation question is pending asynchronously. No installed-app or provider-account changes are claimed.

After safe unused package/Docker-cache cleanup, bounded native incremental build/test uses the existing task artifact directory and no Simulator. Heavy release work remains deferred until the 80 GiB disk requirement can be met safely. Do not clean unrelated registered artifacts or live app caches.

## Source acceptance checkpoint

Independent review `/root/independent_login_review` closed all three confirmed P1 findings and found no P0/P1 remaining. Parent independently reran 32 backend tests including four real PostgreSQL tests, 52 Web tests and native full XCTest (260 executed, 9 explicitly skipped, zero failures). Backend and Web typechecks pass. Actual retained-cookie/backend-revocation browser recovery returns through normal reauthentication to the exact original Mac confirmation, observed and captured. Formal sanitized evidence is in `docs/evaluations/2026-10-01-macos-browser-login/`.

The OS blocker is now specifically identified: the configured default Chrome process has both headless and no-startup-window flags. Do not stop or change another task's browser. Explicit user approval to temporarily select Safari and restore Chrome is pending. The complete OS user chain and signed installed-release gate remain pending; no claim of either is permitted.

## Delivery checkpoint

Draft PR https://github.com/getyak/talent-signal/pull/268 is attached to this task. Its first repository-policy run rejected a redundant HTTP probe's unmanaged credential-shaped environment variable. The duplicate probe is removed; actual backend/PostgreSQL and production WebKit tests are the maintained acceptance entry points. The Infisical manifest regression is rerun instead of adding a new production secret or hiding the variable from scanning.

The required local backend deploy failed before building. The initial missing-config diagnosis was incomplete: Colima cannot read the managed `.codex` worktree's bind mounts. Existing operational documentation already requires a clean detached deployment checkout under the Colima-shared `~/data` path and in-VM bind-file verification. Re-running the canonical checkout's Opik launcher restored ClickHouse, backend and frontend to healthy state; the version probe passes and mounts again belong to the canonical checkout. No database volumes were removed. Future deployment must follow that documented path and coordinate the keeper; do not retry from this managed worktree.

The latest storage audit reports 64 GiB free, below the mandatory 80 GiB heavyweight-build threshold. Only task-owned build products and safe unused cache cleanup are authorized; these cannot supply the missing space. Backend rebuild/redeployment and signed release remain pending until the threshold is met. Do not delete unrelated artifacts, repositories, app data or active Docker volumes to satisfy it.

Current-head quality checks at `2cc6d07c` pass for Web, backend, native, repository policy and security workflows. The separate CodeQL aggregate correctly rejects biased hint generation (three annotations) and incomplete notice-attribute escaping. Parent repairs use `crypto.randomInt`, attribute-context escaping and script-data escaping, with a malicious-input Web regression. Narrow backend 26/26 and Web 17/17 tests pass. Independent re-review passed with no remaining P0/P1/P2; new-head CodeQL is required. A final opt-in real WK test against the restarted current source backend also passes; it still does not establish browser intention or the OS callback.
