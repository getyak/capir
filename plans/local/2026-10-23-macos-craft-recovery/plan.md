# Desktop recovery and craft implementation

Date: 2026-10-23. Owner: current Codex task. User authorized sequential implementation of the 30 audit findings and requested quality above 97/100.

## Outcome and boundaries

Implement evidence-grounded fixes in order, retain existing product semantics, and verify the installed/native and resident Web surfaces. A target score is not completion evidence. Previous findings/report: /Users/cubxxw/data/talent-signal/output/evaluation/2026-10-23-macos-persona-audit/.

Base: origin/main f97811d2c. Isolated managed worktree: macos-craft-recovery; branch codex/macos-craft-recovery-20261023. Existing source checkout and untracked work preserved. Reuse existing dependencies through temporary untracked symlinks; never stage those symlinks. No install, shared compiled output rebuild or additional service. Preserve any shared test cache.

Initial checkpoint (superseded by the serial exception below): the global pause marker owner=current-chat-sre, reason=disk_below_40_GiB, remains active. Resources at that checkpoint: 299 Node/npm processes, 14.33 GiB swap, 31.52 GiB free. Safe cache dry-run found no eligible candidates. No heavy builds, delegation, native builds or deployment while the pause remains. Lightweight source work and serial focused unit checks can progress. No other task's processes or data may be removed.

## Quality target

A fixed internal assessment rubric: recovery/truthful state 25, interaction/keyboard/IME 25, reading/information hierarchy 20, visual consistency 15, native lifecycle/accessibility 15. Each criterion requires recorded acceptance evidence; unknowns are unscored and block a final >=97 claim. This is an internal design assessment, not a validated external benchmark. Any unresolved P0/P1, missing auth/privacy/regression gate or missing native acceptance blocks completion regardless of arithmetic.

## Sequential milestones

1. ACTIVE: M01 expiry handoff through the existing native /login navigation policy; M02 bounded directory request lifecycle; M03 actual account language preference and effective locale. Write failing behavior tests first, implement, then run serial focused checks. Preserve network/401 distinction, identity, draft and retry race boundaries.
2. ACTIVE: initial source review and Web deployment passed; real native recovery exposed draft/target loss. Follow-up source review passed, but native build and patched live acceptance remain pending. Never call source-only work shipped.
3. PENDING: M05-M10 navigation and conversation reading hierarchy; then M11-M16 People/Memory identity, hierarchy and evidence. Recheck current code and compare identical rendered states.
4. PENDING: M17-M24 native settings, capture, window, theme, IME and accessibility. M04 requires stable runtime repro before a route change.
5. PENDING: M25-M30 long threads, queue/stop, offline, attachments, time/Today; isolated authorized capir run and cleanup. Final independent assessment uses the fixed rubric and reports unmet criteria explicitly.

## Evidence

Use ignored output/evaluation/2026-10-23-macos-craft-recovery for focused test receipts, source/revision manifest, before/after images and acceptance. No new model run or business record writes in the initial source batch. Preserve the worktree until all required acceptance and delivery are complete. Runtime changes require clean-source deployment and served revision readback per docs/operations/testflight-local-backend.md.

## First source batch checkpoint

- M01 implemented: confirmed expiry removes private content and requests an actual main-frame /login navigation only in the desktop host. Ordinary browsers keep explicit recovery; transport failures do not log out. Recovery title/body now use the existing locale catalog. Failing API-to-boundary test observed before implementation.
- M02 implemented: a 15-second shared directory deadline includes body decoding; timeout is retryable, cancellation settles even for an abort-ignoring loader, inflight releases, and late results cannot populate cache. Three new cache failures observed before implementation. The real search dialog additionally verifies timeout -> error -> retry, preserved query/dialog, and fresh results through production hook wiring.
- M03 implemented for language truth: RootLayout passes the stored account preference independently of effective locale; menu distinguishes system/explicit/unreadable choice. Six rendered account-menu cases passed. Remaining untranslated menu/page copy is still pending; this is not whole-product i18n completion.
- Original shared contracts/dist is stale and lacks current locale exports. A temporary uncommitted Vitest config aliases the unchanged current contracts source. This is source-level verification, not a compiled-package/build acceptance. The ordinary cached-artifact run failed; do not hide that environment condition.
- Focused suite: ten files passed, 92 tests. An added production search timeout/retry case and current recovery tests then passed (10 tests across two files), yielding 93 distinct passing cases across the union. JSON receipts are in ignored output. Focused TypeScript (including the existing desktop ambient declaration), affected-file ESLint, docs, wiki, architecture boundary and diagram checks passed; final focused type/lint recheck after the integration test addition also passed.
- Native control recovered. Installed 0.2.17 build 170: clicked its login button, verified browser account test@cubxxw.com / capri Test Workspace and matching code against native, confirmed, accepted only the one-time system Open Application prompt, and observed the authenticated native conversation. The owned Chrome authorization tab was closed. No credentials or one-time codes are retained in artifacts. This is existing-release baseline evidence, not patch acceptance.
- Later the native app navigated to People and began downloading an update without this task sending either input. Stop native input because the input owner is unknown (concurrent use or automatic behavior is possible); do not cancel that update or claim ownership of it. Native account session remains intentionally signed in.
- Resident manifest advanced externally to 1dbb74dcc6358d17277fa799b1d42824a3d50732, whose source matches main for the four changed production components checked (menu, boundary, provider, directory cache). Preserve the complete active source lineage before eventual deployment. Manifest is not served-revision proof.
- Pause remains active: no Pi, sub-agent, heavy build, deployment or PR-triggered build dispatched. Independent review, compiled checks, live changed-behavior acceptance, all remaining findings and >=97 target remain incomplete.

## User-authorized serial acceptance exception

2026-10-23: user explicitly allowed this task to perform serial independent review, Web build and deployment acceptance while retaining the global pause marker. Preserve other tasks/processes, keep the >=30 GiB preflight and post-dependency gate, and do not treat this as permission for parallel heavy work or unrelated cleanup. Independent reviewer recovery_review is auditing 979b62a85 read-only.

## Initial independent review and P1 correction

The reviewer role could not start because its fixed model is unavailable on this account; no review result was accepted from that failed attempt. An independent default agent recovery_review_v2 completed the fixed 979b62a85 audit and found one P1: directory invalidation aborts its own real 401 body before code recognition, so the boundary event never arrives. The original Response.json test did not model that cancellation.

Correction uses a closed same-origin `X-Talent-Signal-Session-Status: expired` response header from the two real directory route producers; only canonical credential failures receive it. The client recognizes it before cache discard aborts transport, retaining immediate private-cache removal. Missing Web auth in the People producer is normalized to existing canonical AUTHENTICATION_REQUIRED. Legacy body-only behavior remains, with current-scope and cancellation checks both before and after asynchronous decoding; old replies cannot expire the new account.

A new integration test uses the actual Session route's status, headers and body with a real abort-linked Fetch body through the shared cache, directory reader, request wrapper and mounted native boundary. It failed with private content remaining before the fix, then passed. Producer, malformed/error-status, foreign-origin and cancelled/changed-scope counterexamples cover metadata trust and stale replies. This deterministic behavior belongs in executable production-path tests, consistent with project-knowledge-steward; no new global rule or memory update is needed.

Retired-release cleanup preflight detected that a required old build receipt disappeared during inspection. This task executed no deletion; a fresh VM mount inventory only exposes data/workspace, not Library. Do not attribute a concurrent free-space increase or another task's cache removal to this task.

## Serial production verification and recovery follow-up

- f50367fa2 passed independent re-review: the original P1 was closed, with 52/52 independently rerun cases and no new confirmed P0/P1. The resident integration 2df06bbea preserved 1dbb74dcc's complete lineage; independent range-diff and catalog comparison passed.
- Exact pnpm 11.18.0 frozen install and all 987 supply-chain policy checks passed in a clean detached release. The full Web production build and TypeScript passed; minimum free space was 30.32 GiB. Normal compiled dependencies then passed all 137 focused cases without source aliases.
- The installer activated resident 2df06bbeac1223db21dc5edebdacea8bed62589b, build br_TE7uS6nCESrwDQ3EI0. HTTPS build-manifest bytes matched the candidate. Both real unauthenticated directory routes returned canonical401 plus the closed expiry header. Protected default-account settings loaded; stored language was system and the menu correctly showed Follow system / English in browser and native. Explicit en/zh-CN matrix and whole-product localization remain pending.
- Installed native updated externally to0.2.21/175. Initial blank window recovered through the real Reload menu; root cause remains unknown. A newly created, precisely identified14:05 Mac session was revoked via Web settings; readback removed only that session. The native foreground directory refresh entered the browser-owned login surface without a reload or route click. Cancel/retry and fresh browser/OS handoff succeeded, but changed the original draft locator and did not recover the synthetic unsent text. M01 is therefore only partially accepted.
- New observed gaps: explicit sign-out goes to the public homepage before a login link enters native recovery; a forced foreground color makes the inactive native login button visually unclear. The follow-up source repairs those paths and adds bounded same-process text recovery under ADR0025. No cookie, whole-store, attachment or outbox transfer is permitted. The owner is live-verified account/user plus server-issued storage partition, never a DOM claim.
- Follow-up source tests observed failures before repair for native sign-out target, actual account-form wiring, null-scope draft deletion, conversation401 deletion and missing status partition. The sign-out group passed27 cases; text retention/status group passed29 cases. Changed Swift files parsed successfully; native typecheck/build/tests and real patched-native acceptance have NOT run. The current resource exception explicitly covered serial review, Web build and deployment; a native build must respect the still-present pause and a separately concrete scope.
- Current small feature branch remains codex/macos-craft-recovery-20261023; resident integration branch and active clean release are retained. No PR, merge, final score or remaining-finding completion is claimed. Cleanup executed by this task remains0.00 GiB; no process was manually terminated.

## Follow-up source review checkpoint

- The revised same-owner text capsule, local-write fallback, explicit logout event and original-target retry passed independent source re-review with no remaining confirmed P0/P1. Review report records source hashes and the separate native acceptance gap.
- Confirmed review findings repaired: cancelled export retry losing its donor; local storage failure looping proven login back into unknown authentication; retained text surviving intentional sign-out; and a late explicit sign-out signal being lost after expiry already set signedOut=true. The last event is now delivered synchronously, independently of Boolean change observation, including to invalidate an awaiting copy verification.
- Export has a three-second native deadline and owner verification a six-second native deadline. Late reads cannot settle a newer operation. The donor is preserved; unavailable recovery is named honestly. Partial write errors do not claim that no text was written.
- Current focused Web union: 21 test files, 204 passing cases. TypeScript, changed-file ESLint, docs, wiki, architecture and diagrams passed. The earlier 231-case run used a different selection; it is historical evidence, not the current final union count. Swift parse passed; native semantic compilation and native tests remain unexecuted. New non-skipping actual WebKit script tests cover round-trip text/TTL, conflicting destination and a partial Home-pointer write failure, but have not run yet.
- Native build/acceptance exception requested with an isolated application identity, no replacement of the installed client, serial execution and a >=30 GiB floor. Until answered, continue authorized Web verification only. Resource sample: approximately30.4 GiB free, high shared Node count and16.15 GiB swap; preserve the pause and all other tasks.

## Authorized native validation resume

2026-10-23: the user explicitly approved this task's serial macOS native build, targeted tests and UI acceptance exception. Preserve the pause, use an independent application identity and never replace the installed client. The30GiB local floor still applies. Fresh resources were28.15GiB free,18.75GiB swap and329 Node/npm processes, so no local Xcode build started. Cache-maintenance dry-run found no eligible candidates. The separate iOS task remains incomplete and explicitly retains Build12; its source and DerivedData were preserved.

The source patches were replayed without conflict onto current remote main37b5a49f on codex/macos-craft-recovery-verified-20261023. Range-diff verifies all three patches are equivalent to the reviewed originals. The old feature and resident branches and clean failed candidate remain available. Use the existing GitHub-hosted Check macOS workflow for native compilation/tests while the local disk floor is unsatisfied. Its disposable host cannot replace real same-owner browser-login/live Web recovery acceptance. Do not start a second heavy workflow while this serial native check runs.
