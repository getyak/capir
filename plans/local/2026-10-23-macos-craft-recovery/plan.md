# Desktop recovery and craft implementation

Date: 2026-10-23. Owner: current Codex task. User authorized sequential implementation of the 30 audit findings and requested quality above 97/100.

## Outcome and boundaries

Implement evidence-grounded fixes in order, retain existing product semantics, and verify the installed/native and resident Web surfaces. A target score is not completion evidence. Previous findings/report: /Users/cubxxw/data/talent-signal/output/evaluation/2026-10-23-macos-persona-audit/.

Base: origin/main f97811d2c. Isolated managed worktree: macos-craft-recovery; branch codex/macos-craft-recovery-20261023. Existing source checkout and untracked work preserved. Reuse existing dependencies through temporary untracked symlinks; never stage those symlinks. No install, shared compiled output rebuild or additional service. Preserve any shared test cache.

The global pause marker owner=current-chat-sre, reason=disk_below_40_GiB, remains active. Current resources: 299 Node/npm processes, 14.33 GiB swap, 31.52 GiB free. Safe cache dry-run found no eligible candidates. No heavy builds, delegation, native builds or deployment while the pause remains. Lightweight source work and serial focused unit checks can progress. No other task's processes or data may be removed.

## Quality target

A fixed internal assessment rubric: recovery/truthful state 25, interaction/keyboard/IME 25, reading/information hierarchy 20, visual consistency 15, native lifecycle/accessibility 15. Each criterion requires recorded acceptance evidence; unknowns are unscored and block a final >=97 claim. This is an internal design assessment, not a validated external benchmark. Any unresolved P0/P1, missing auth/privacy/regression gate or missing native acceptance blocks completion regardless of arithmetic.

## Sequential milestones

1. ACTIVE: M01 expiry handoff through the existing native /login navigation policy; M02 bounded directory request lifecycle; M03 actual account language preference and effective locale. Write failing behavior tests first, implement, then run serial focused checks. Preserve network/401 distinction, identity, draft and retry race boundaries.
2. PENDING: independent review and live deployment/acceptance of milestone 1. Pause gate currently blocks required heavy verification, delegation and deployment. Never call source-only work shipped.
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
