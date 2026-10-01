# Browser-owned macOS sign-in

## Outcome and authorization

The user requests complete implementation, replacement of the earlier desktop-login design, elegant boundaries, explicit successful-chain standards, and no username/password entry in the Mac application. Browser authentication may use the existing Web methods. Codex owns architecture, integration, independent acceptance and delivery; Pi/MiMo owns a bounded implementation and first local checks. Do not touch unrelated worktrees, accounts or evidence. Do not re-enter the incomplete September 25 linking protocol as a prerequisite.

## Baseline and scope

Fresh origin/main: `127600957161ac52f910ac05f1aeb77b1daf9490`. Parent worktree: `/Users/cubxxw/.codex/worktrees/macos-browser-sign-in/talent-signal`, branch `codex/macos-browser-sign-in`. Original checkout has unrelated untracked documents and plans, preserved. GET-43 belongs to IMStage and is unrelated; do not edit it.

In scope: browser-owned primary login, durable one-use backend grant, first-party browser confirmation, authenticated WebKit cookie installation, native recovery and origin/store ownership, relevant tests, updated canonical documents. Existing account methods, onboarding, Web sign-in, account identity and retention remain authoritative. Account settings remain in the external browser; no new native credential-linking protocol. No passkey registration, global account migration, copied browser cookies, broad native bridge, provider secret changes, iOS Simulator or new token lifetime policy.

## Decision

[ADR 0022](../docs/decisions/0022-browser-owned-macos-login.md) replaces ADR0019's per-provider primary-login protocol. A single first-party browser flow uses the current verified Web account with explicit approval and issues a separate Mac device session. Provider/password authentication stays entirely in that browser. The default browser owns authentication; the existing AppDelegate delivers the fixed private-scheme callback, and PKCE binds exchange to the initiating app operation. Native never receives provider credentials or copies authentication cookies. A new identified WebKit store isolates each new primary login; durable selection and unresolved markers protect restart and late responses.

## Milestones

1. Complete: implement backend grant, Web confirmation/exchange/status, and native user flow on the frozen baseline with Pi.
2. Complete for owned acceptance: independent source review closed confirmed P0/P1; backend/PostgreSQL, Web, real WebKit and native checks pass. Actual Safari approval/OS callback/workspace and restart passed with a distinct owned ad-hoc app and disposable identity.
3. Implementation checks/deployment complete: PR #268 created, implementation-head CI passed, local backend and resident Web deployed/read back. Pending: latest evidence-only head checks, merge, signed/notarized publication and installed-client acceptance; live public providers remain unproven.
4. Complete: decisions/operations evidence routed, formal receipts preserved outside temporary artifacts, owned proof app/tabs/servers/database and registered temporary artifact removed. Customer data, unrelated tasks and default Safari retained.

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


## Safari and authorized storage recovery checkpoint

The user authorized switching the default browser to Safari and explicitly asked not to restore Chrome in the short term. System Settings and LaunchServices HTTP/HTTPS both confirm Safari. The owned browser fixture can authenticate in Safari, but the full ASWebAuthenticationSession approval/callback/workspace chain still has no successful user-surface receipt. Do not classify the ordinary Safari login or real-WK fixture as complete OS acceptance. Disposable fixture servers/database and the owned 10445 Serve handler were removed; the original Serve configuration was read back unchanged.

At source revision `9f5c27e8`, applicable backend/Web/native/policy/security CI passed; CodeQL aggregate is neutral with no annotations (the existing PR workflow skips the Swift build). Independent security re-review found no remaining P0/P1/P2. A clean detached backend checkout with VM-readable Opik bind files is prepared under `~/data/talent-signal-runtime-releases/9f5c27e8`.

The user explicitly authorized freeing disk space. Online Colima fstrim reclaimed approximately 12 GiB without restarting the VM or containers. Verified inactive, reproducible caches and old downloaded runtime versions supplied the remaining space; current runtime versions, pending application updates, repositories, application data, Docker volumes, rollback images and unrelated test artifacts were preserved. All 41 original running container IDs remain. Free space rose from approximately 60 GiB to 81 GiB. The storage audit still returns its warning status for unrelated aged/unregistered artifacts; capacity and allowlist checks pass, and those artifacts must not be deleted as a workaround. Detailed cleanup receipts live in the task's private state directory.

A pre-existing Opik ClickHouse connection health failure was recovered with the canonical launcher; backend health returned to healthy and the version probe remains 2.2.45. The source-verified backend image build failed before modifying the running API: the VM resolves Docker Hub to an unrelated endpoint and TLS rejects the certificate. The health keeper was restored. A host-network import of the official, digest-bound ARM64 Node base image is being attempted with TLS validation retained; no global DNS, proxy or VM-sharing change is authorized by this workaround. Backend deployment, resident Web update and signed installed-client acceptance remain pending.


## Deployment and native delivery replan

The official ARM64 Node base image was imported through the host network with TLS and digest checks intact. Clean source revision `9f5c27e8` built and deployed successfully as `talent-signal-backend-local:9f5c27e8-browser-login`; migrations, readiness, Apple metadata, synthetic Opik write/read/delete and tailnet HTTPS probes passed. The paired Infisical image/revision and backend current-release pointer were read back, and the health keeper was restored. The resident Web was built from the same clean source and activated through its normal LaunchAgent. Rollback releases remain available. The backend allowlist now includes exactly the configured resident Web origin; anonymous grant prepare/cancel succeeds there and an arbitrary foreign origin is refused. These operational checks do not establish authenticated workspace admission.

A second actual native acceptance run used the source-matched production Web build on an owned loopback fixture, avoiding shared-host Safari cookie replacement. The native action entered waiting and later expired honestly, but Safari displayed only its Start Page and no authorization window. No approval, callback or Mac session admission was observed. The proof app and disposable fixture services/database were stopped, with all customer data and installed application state preserved. Safari remains the authorized default browser.

The settled repair replaces only native browser delivery with NSWorkspace URL opening and the existing AppDelegate callback, retaining the backend/Web grant, exact callback, PKCE and selected-WK identity readback. Independent architecture review found no P0/P1 blocker, contingent on rejecting unsolicited/stale callbacks without mutating an active lease, synchronously preventing duplicates, preserving cancellation/expiry, and exercising the actual OS chain. Closed-window restoration needs explicit acceptance; a dispatch Boolean is not proof of browser arrival. Private scheme routing is not exclusive, and RFC8252 URI-form conformance is not claimed.

Pi task `20261001-214224-aa31447d`, frozen base `9f5c27e8`, owns DesktopBrowserLogin.swift, the existing AppDelegate in SelectedTextServiceProvider.swift, and directly affected tests. The parent owns architecture/docs, integration, independent review, actual native tests and user-surface evidence. The worker is prohibited from heavy builds, dependency installs, deployment and global OS preferences. The task is running; implementation acceptance, current-head CI and the signed installed-client gate remain pending.

Disk recovery reached approximately 81 GiB before the authorized backend/Web builds. Subsequent builds and parallel activity reduced available capacity; verify the live threshold again before any new heavy native build. Two inactive earlier auth-task dependency directories are being removed only after process/open-file checks; source, patches, accepted-test receipts, rollback artifacts and the unrelated active CLI task are preserved.


## Native delivery integration checkpoint

Pi native task `20261001-214224-aa31447d` produced the bounded opener/delegate/guard implementation and affected tests. Parent stopped the still-running worker after inspecting the candidate and independently identifying test/lifecycle integration work; status is cancelled and verification is false, not ready-for-review or accepted delivery. Parent retained its source/session evidence and imported only the four owned source/test files. The worker's out-of-scope generated project edit was not imported; parent owns regeneration. The shared test harness and URL/String issue are corrected in the extracted candidate, and parent fixes async blocking-call placement, wires the fixed-scene presenter, and adds a presenter/duplicate regression.

Independent read-only review finds callback guard ordering and same-owner window-host retention appropriate, with no new production P0/P1. Parent preserves a live owned WK host across window closure, retires it on origin/store replacement, and consumes an already-completed result on reappearance. The exact presenter integration and real closed-window OS/WK chain still require compilation and observed acceptance. Old failed proof-app copy and the temporary official-image import binary were removed only after they were stopped; original build products, xcresults, source/provenance receipts and screenshots remain.


## Native proof and form-origin header correction

The integrated native application compiles and its 58 focused tests pass, with zero failures/skips, in `native-url-delivery.xcresult`. Independent final source review found no unresolved P0/P1/P2. The proof binary has a distinct ad-hoc bundle id; source hashes and metadata are retained privately. The actual Mac entry now automatically opens Safari and displays matching verified account/hint confirmation. The first approval reached the backend but Safari could not route the temporary app scheme; explicit registration of the owned proof bundle fixed the missing test-install prerequisite, without updating the installed app or browser defaults. That old operation expired and was not replayed.

Direct native browser entry with the now-valid Safari session then fails the existing exact-Origin form guard. Sanitized own-fixture HTTP metadata shows `Origin: null`, absent Referer, and same-origin Fetch Metadata. The cause is the source's no-referrer authorization-page header: WHATWG Fetch serializes non-CORS navigation POST origins as null under that policy. Independent standards/security review accepts changing only authorization-page policy to strict-origin, which emits origin-only referrers with no path/query proofs. API no-referrer and all Origin/CSRF/live-session checks remain intact; null/foreign-Origin refusal regression passes. Updated Web verification passes 54 tests (18 protocol, 3 page, 33 proxy). The native full OS chain still awaits a production-built repaired Web fixture.

Parallel local activity has consumed recovered capacity. Two unreferenced obsolete project backend build images (`830125dd-main` and `973e7913-platform`) were removed after frozen source/object verification and checking every container reference; all 44 then-running containers were retained. Current source image and the two most recent rollback images remain. Image deletion alone does not establish host recovery; online trimming and a fresh storage check must precede the next heavy Web build.


## Actual Safari OS-chain acceptance and handoff

At implementation revision `1b82a562`, clean production Web build/deployment succeeds and every applicable current-head CI check passes. Independent implemented-header review finds no P0/P1/P2. Exact rendered authorization-page Referrer-Policy is strict-origin on both the fixture and resident Web; actual Safari POST has exact Origin and an origin-only Referer. The temporary proof bundle registration had no default scheme handler. A normally installed, distinct owned ad-hoc app becomes the scheme handler without changing Safari HTTP/HTTPS defaults. A new request then completes through actual Safari confirmation and its one-time Allow prompt. The native window was closed before approval; the fixture grant is consumed through the OS callback before any further native UI inspection, produces one independently identified device session and exact owned account/user, and the selected WK workspace shows that identity. Quit/relaunch restores the same workspace without opening another auth tab. Formal screenshot and sanitized receipt are in the evaluation directory. No helper approval or manual callback URL opening substitutes for the OS chain.

The native proof and all owned Safari auth tabs are closed; the installed fixture bundle is unregistered/removed; both fixture servers and the disposable PostgreSQL Compose stack/volume are stopped/removed. Original installed app, customer data, other tasks and default Safari are preserved. Formal native xcresults/build logs are copied to the private durable task state before task artifact removal. Disk capacity reached 80.065 GiB immediately before the heavy production Web rebuild; builds/concurrent activity consume space afterward, so do not quote that preflight as current free space.

Signing/notarization credentials are now configuration-ready through the existing scoped release contract. That does not prove a signed binary, release publication or update of the existing installed application. The release workflow admits main only; PR #268 remains the reviewable merge boundary, with the signed installed-client/provider acceptance gates explicitly pending. No Linear issue is associated and no unrelated issue is closed.
