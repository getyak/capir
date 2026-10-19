# Web and macOS craft loop — 2026-10-20

## Outcome and boundary

Improve the real signed-in workspace's visual hierarchy and interaction craft through 12:00 Asia/Shanghai. Stop new implementation at 11:30. Preserve all business logic, data, capabilities, approval boundaries and unrelated work. Structural product changes are recorded as pending decisions in `design-log.md`.

## Baseline and ownership

- Parent worktree: `/Users/cubxxw/.codex/worktrees/design-noon-20261020/talent-signal`, branch `codex/design-noon-20261020`, frozen remote main `1c7c9891`.
- Main checkout has unrelated untracked `.playwright-mcp/`, `docs/evaluations/`, `plans/local/`; a separate chat is updating remote code. Do not touch either.
- Resident Web baseline: `20c0d64a84db9e5978f3e06e57b03c03b3a06c55`, port 3000, tailnet HTTPS 10443.
- Installed macOS app: `/Users/cubxxw/Applications/Talent Signal.app`, AppKit shell with WKWebView of resident Web. Shared Web presentation changes affect both; native source changes require separate native validation.
- One Pi writer per repository. Pi implements bounded presentation changes; parent owns real-surface QA, review, commits and deployment. No Linear writes.

## Authorized QA environment

Refreshed existing CLI grant for `test@cubxxw.com`. Isolated run `45910cd3-e607-4f06-9041-b7a3d70964be`, request `491c5c16-a071-4568-9d9c-5faa5977c662`, account `a381f068-7493-472c-8fbf-d884d055db7d`, preset daily verified 12 contacts / 30 observations / 4 tasks. Expires 2026-10-21 00:38 Asia/Shanghai. Credentials only in keyring and private registered artifact; never commit them. Stop and read back cleanup at end.

Permanent screenshot directory: `/Users/cubxxw/.codex/visualizations/2026/10/19/01a15501-5b97-7201-aa3c-ae89795377d2/design-noon`. Private temporary artifact: `/private/tmp/ai-test-design-noon-20261020.635cI2`. Screenshots must contain synthetic QA content only. Browser actions use cua_repl with the existing IAB tab; app actions use CUA with the installed app path.

## Milestones

1. **Active:** inspect conversation, Today, People/detail, Time, Sessions, Settings and utility states at 1440 / 390 Web widths, default and narrow macOS windows. Save baseline; rank 1–3 visible craft problems.
2. Implement one small complete design-system or component slice with Pi. Compare two rendered directions for consequential visual changes, retain only demonstrated improvement.
3. Run focused checks and actual light/dark/responsive/keyboard/empty/error interaction checks. Review diff independently, append `design-log.md`, small commit.
4. Deploy affected resident Web from clean committed detached source per operations guide; read back live revision and changed behavior. Repeat loop from global inspection.
5. At 11:30, stop new changes; complete verification, deployment, evidence, cleanup and final comparison report with five next priorities.

## Constraints and current observations

Storage audit: 40 GiB free, 34 registered artifacts totaling 8.6 GiB, no unauthorized simulators. Resource audit: 79 Node processes, 9.15 GiB swap; inspected active processes, avoid overlapping heavy builds. No iOS tests needed for Web CSS. Never stop unrelated workloads. No simulator launch.

Initial conversation canvas is already restrained. Native initial session is expired; inspect its recovery state before reauthenticating. Shared theme has six sizes and existing desktop material support; avoid blindly replacing it. Browser plugin is not listed; available built-in CUA browser supports DOM locators, screenshots and viewport override and is the UI automation owner.

## Completion evidence

Each accepted loop links matched screenshots, changed scope, rationale, focused test/build output, commit and live deployment revision. Final report distinguishes observed improvement from subjective reference parity, and explicitly names untested states or blockers. Goal remains active until the time boundary and all required handoff work are met.

## Checkpoint — 00:50 Asia/Shanghai

- Baselines saved: conversation/People/person/Today/Time at 1440; People/Today/Time at 390; dark settings, conversation, Sessions and account/search menus. CUA `tab.screenshot()` is the authoritative saved image; the native browser preview can temporarily scale a cached compositor image immediately after viewport changes, so inspect stable saved screenshots rather than treating that artifact as a product defect.
- Native login: first attempt became unresolved and readback said incomplete. A deliberate second normal browser authorization (matching hint verified) completed successfully on installed build 125. Do not report the first failure as fixed by code. Primary identity and workspace read back as the configured default account. Native Today contains explicitly fictional prepared tasks; native baseline screenshots use only that synthetic visible surface. Native baseline default 1123×865, narrow 900×720; resize verified through CUA. Native settings 900×632 inspected. No real conversation opened or data edited.
- Pi batch 1: `20261020-004219-e7ca8276`, frozen base `fd7c1fe7`, CSS-only Today daily-brief direction. Parent waits for ready_for_review; no diff copied yet. Contract `/Users/cubxxw/.local/state/design-noon-20261020/round-1.json`.
- Parent installed frozen offline dependencies. Baseline Web typecheck passed. Initial docs:check passed in full.
- Parent dev preview uses 127.0.0.1:3100 with real backend, explicit loopback-only non-resident cookie policy and integration mode. Development startup before workspace package builds caused module-not-found cache; verified direct contracts import and successful dependency builds, restarted only owned preview; real login and Today now render. No product code change required. Its dev process is the exec session 21567; log in private task artifact. Test identity logged in normally, same run. Never copy cookies or forge sessions.
- Next dev regenerates `apps/web/AGENTS.md` heading and `next-env.d.ts` route paths; inspect and restore only these known generated changes when stopping dev before clean-source release. They are outside the intended design diff.
- Private capir-evals `evidence/` is immutable historical archive and new raw output must not enter Git. Keep current screenshots in the permanent local directory and link them from design-log; do not append to historical archive.

Ranked observations: (1) Today 40px date + two empty summary cards push the actual task below the 390 first viewport; implementing consistent 24px title and content-first sections. (2) Time at 390 stacks title, day nav, six controls and range filters before the first record; consider presentation-only toolbar grouping after round 1. (3) Native has both AppKit title/toolbar and Web header; document structural chrome changes before touching native source. Sessions empty state, People list and search are already comparatively restrained; do not change merely for activity.

### Evidence packaging decision

The user's current request explicitly requires before/after screenshots in a committed `design-log.md`. Preserve a small, curated set of synthetic screenshots beside that log under `design-log/2026-10-20/round-XX/` so links remain portable and CI does not depend on `/Users/...`. This is task-specific requested deliverable material, not a new canonical evaluation archive. Raw captures, credentials, diagnostics and transient output remain outside Git. Do not modify capir-evals historical `evidence/`.

### Preview note

The active IAB tab is id 3 (`local`, reusing the former Ambi reference tab); browser viewport capability applies to this selected tab. Keep production/reference tab id 1 (`web`) and old preview id 2 (`oldLocal`) secondary. A transient raw-CDP metrics override was cleared; do not leave emulated metrics in another tab. Next's dev indicator overlapped the account avatar; it was hidden through its own Preferences for this session, without a product config change. Local preview is now correct and ordinary account-menu interactions work. Actual saved-image dimensions were checked with image metadata.

Reference screenshots: Ambi's public continuous-intelligence section captured (1280px actual source); Linear's public homepage did not finish rendering and is not accepted visual proof. Do not call reference parity established.

## Checkpoint — round 1 implementation and QA (about 01:10)

Pi `20261020-004219-e7ca8276` is ready_for_review: 3 scoped CSS files, no untracked/out-of-scope changes; 21 focused tests and Web lint exit 0 (receipts in Pi artifact), PostCSS parsing reported successful. Parent copied the patch and fixed independent review's two P2 gaps: 180ms transition token/fallbacks and 500 link weight. Parent also made the optional Agent action outlined so the focus link remains the sole filled primary. Independent reviewer `today_review` rechecked these fixes: no P0/P1 or new concrete findings, diff hash `68cd5808f8f04540ad144b89ba51c1fe1c5f6b945c4bae30bd184fda5cc76663` (before the later mobile summary adjustment). Dedicated reviewer preset failed due its unavailable gpt-5.4 model; default inherited-model reviewer was used successfully. Reviewer is reusable with followup_task.

Parent 21 focused tests passed (log `round-1-focused-tests.log`). New CSS actually rendered at 1440: date 24px; task top 393.39 vs 449.06 baseline; CTA top 657.97 vs 734.64, no horizontal overflow. Source evidence and all content remain intact. Desktop content-first direction accepted provisionally; resident deployment and native after proof still pending.

First mobile after (stacked bare summaries) moved title only from 625.30 to 580.69. Rather than call that sufficient, parent changed short status summaries to two columns at <=640px; populated contexts with `.title` still get full-width stacked reading via `:has`. This latest small CSS adjustment has NOT yet rendered/been reviewed. Need verify 390 screenshot and long/populated branch, repeat focused checks as warranted and ask reviewer to recheck.

Local dev HMR failed to notice external CSS edits: disk 24px while DOM stayed 40px. Confirmed own Next process cwd, stopped it, removed only owned `.next/dev` cache, restarted; new style then rendered correctly. A subsequent small CSS change again failed HMR. Switched owned preview to documented `next dev --webpack` with `WATCHPACK_POLLING=true`, still 127.0.0.1:3100, no product config change. New exec session **52880**, log remains private `web-dev.log`; verify it is ready and reload the existing `local` tab id 3. Prior dev sessions 21567 and 93200 are stopped; port 3100 was checked empty before new startup. No resident service touched.

Latest source edits are uncommitted in parent worktree. Generated AGENTS.md heading + next-env.d.ts changes remain known dev churn; restore only those after stopping dev before clean-source production release. Do not remove source or other tasks. Curated final screenshot assets have NOT yet been copied into tracked `design-log/`; local files labeled `01-*after*` are provisional and must be overwritten with verified current rendering, preferably resident production screenshots for final log (no dev indicator). Baselines are safe and retained.


## 01:23 checkpoint — settled local proof

Fresh IAB tab 4 recovered the error-page tab; tab 3 remains stale and cannot be bound by the browser URL policy. Standard Turbopack session 98789 was stopped and its port is verified empty. The Webpack attempt is no longer active. Recovered generated AGENTS/next-env churn only.

The final mobile two-column short-status direction rendered correctly at 390×844 after real summary requests completed. Task top 469.89px versus baseline 625.30px; no overflow. Matched local screenshots are curated under `design-log/2026-10-20/round-01/`. Dark 1440/390, source disclosure with Enter, per-tab blocked-request error then keyboard Retry recovery, and reduced motion were verified. The health banner briefly appeared with actual healthy responses delayed by local load, then recovered; retained as a separate observation. Populated-title layout still needs visual exercise; source review is clean with final diff hash e6b3534d13f479474f7af4d6c2e2cfe077d0a29c68c773d2cf2b8e4324c23cf6.

Final three-file test set passed39/39, log round-1-final-tests.log. docs:check passed. The mobile baseline uses correct390×844 resident capture; malformed local390×271 file rejected. Next: docs check, inspect exact diff and commit, clean detached production build, recheck live revision before activation, verify HTTPS and installed native default/narrow, launchd recovery. Active resident remains original20c0d64a unless fresh readback says otherwise. Do not claim delivered before those gates.


## 01:32 checkpoint — concurrent resident release preserved

Loop1 committed81976127, production build succeeded from clean detached source with receipt buildID vzbiCVxpqOq1gJLBxB5yj. Activation safely refused because another installer held install.lock; no service takeover occurred. That installer completed resident067705264c6cec10d7e010a13b8df8144957af3c (contact-intake review/main integration). To preserve its live behavior, merged its exact commit into design branch, producing40166aaba56b90bd0ceb7acb2bf34abf49861dd9. Relative to live06770526, only our threeCSS files and design evidence/docs differ. No backend differences; no backend deployment needed for the presentation slice. Clean detached release40166aab installed frozen dependencies with pinnedpnpm11.18.0,37GiB free after prep; production build running session54212, log round-1-merged-build.log. Recheck active-release and install.lock before activation again.

Pi round2 20261020-012824-26eb87e0 owns only time-workspace.module.css, frozen81976127, no overlapping source writes. It aims to reduce Time toolbar chrome and mobile wrapping while retaining all features,44px hit targets, URL state and data logic. Parent has not applied its patch. A correct390×844 baseline was captured with explicit screenshot clip; normal screenshot immediately after viewport resize can return a scaled stale canvas, so verify actual pixels/paint. Desktop02 baseline currently shows loading/health warning and must be replaced with settled state before comparison. Permanent screenshots include only synthetic content.


## 01:40 checkpoint — loop1 activated, native settling issue under observation

Merged candidate40166aab production build succeeded, buildID3eHsC9QkVQxOaQMMKZZfo; clean source. Installer succeeded and active-release readback matches. Loopback auth providers200/password-account present; Tailscale HTTPS login200 with normal certificate validation. Browser protected Today loaded real synthetic tasks; actual date24px and390 no overflow verified. Resident final screenshots01-today-resident-light-1440/390-after are now correct-painted images (390 heading width350 and task top469.89). Replace local after assets with these for formal evidence.

Native0.2.8(125) loaded changed CSS and ⌘K/Esc works;900×720 reflows to one column without overflow. However native AX tree and screenshots can lag navigation; Today summaries remained loading after background reload even while task and date hydrated. No code/business fix made. Activated via real keyboard, retried native menu, navigated People/read-only and back to remount; await settled screenshot before claiming normal-native-summary proof. Current native window900×720; restore1123×865 for matched default capture. Do not install unrelated0.2.9 update. Restart recovery verification still outstanding. Pi round2 active, no parent patch applied.


## 01:50 checkpoint — Web loop1 proved; native proof remains open

Launchd restart proof succeeded, with live40166aab/buildID3eHsC9QkVQxOaQMMKZZfo unchanged and password provider200. Protected IAB Today reloaded after restart, both summaries completed. Canonical design review paragraph updated narrowly to require matched content/state and verified saved pixels; initial docs-line-budget failure was fixed by replacing the existing paragraph concisely, not adding another policy section. docs:check rerun passed.

Response interception attempt served no fixture (fixtureSeen=false); Fetch interception was explicitly cleared with Fetch.enable patterns:[] and actual Today reloaded. Fetch.disable is unsupported in the browser wrapper. Instead, isolated source-CSS static layout fixture under private/css-fixture served only synthetic HTML/CSS on loopback3101, verified350px full-width titles at390 and280px at320, no overflow,2px focus outline. Screenshots visibly label synthetic fixture. Closed tab6 before stopping owned server91173; server exited0. No product data was written. Curated final images now use resident light1440/390 and dark1440, plus labeled static fixture images. Browser tab5 is healthy QA; tab3 is stale error page and cannot be closed/bound via current URL policy (do not retry); tab4 local stopped and also policy errors after attempting stale3 context. Avoid those handles.

Independent today_review found no causal CSS path for native loading. Existing refresh sets localized date before hidden early return (no request/deadline starts); this is a hypothesis, not runtime proof. Normal minimize/restore via Window→capri and foreground reload/remount still did not yield settled summaries during tool observation. No native inspector/security settings were enabled. Actual rendered screenshot and AX can lag; native People navigation did work despite unchanged AX. Incorrect raw narrow-after capture was People and renamed rejected-01-macos-narrow-wrong-route.png. Default changed Today loading capture renamed01-today-macos-default-loading-after.png. Do not use either as matched normal-state proof. Native currently900×720, restore1123×865 before handoff. Need safe runtime-only visibility/request diagnostics or equivalent actual proof; no business logic change authorized. Pi round2 stillrunning19turns, no source diff last inspected, frozen task contract remains unchanged.


## 02:13 checkpoint — loop2 local proof complete

Pi task20261020-012824-26eb87e0 ready_for_review, only time-workspace.module.css. Parent applied patch and excluded disabled hover, added opacity transition. Parent actual forced-colors screenshots revealed Canvas backplates hiding light labels; fixed narrowly with system palette and forced-color-adjust:none on filled primary/selected controls, stronger selected specificity and explicit primary hover. Real1440 screenshot confirms labels visible and pointer hover preserves system colors/opacity1. Independent today_review rechecked: no new concrete P0/P1/P2, final CSS hash f8df2bec04331bc254c7a6a6cbc684a1ed5569eb01351b7be9a7e0663fd6a91c.

390 default first record594.17 vs703.67 baseline, two toolbar rows; enabled filter naturally uses third row and preserves full label. 320 no page overflow but date wraps, recorded gap. Dark1440/390, Week/month URL changes, local week scroll and keyboard disclosure2px outline checked. Reduced motion0s. Parent typecheck passed after correcting own test/cache race;38focused tests passed. Worker lint0; no source logic changes. Curated synthetic screenshots and local QA receipt under round-02. Final light candidates precede forced-color-only correction; normal palette unchanged.

HMR again failed to observe external CSS. Stopped owned preview69548, verified3100empty, removed only owned .next/dev (after prior typecheck complete), restarted62816 and confirmed forcedColorAdjust:none in actual DOM. Preview62816 now stopped exit0,3100empty. Restored known generated AGENTS.md heading and next-env.d.ts churn. Do not remove caches while checks read them: earlier own cache clear during typecheck produced TS6053, then sequential regeneration/typecheck passed. No resident impact.

Native app remains1123x865, primary capri Test Workspace, summary loading. Time click produced hover but no confirmed navigation; AX timed out/reset CUA kernel. No native normal-state proof. Do not repeatedly click stale indices. Browser local selected7 still healthy; CUA was reset, so rebind7 after reading fresh docs, never stale tabs3/4. Browser media features had been reset to[], viewport390, local QA appearance dark. Need final clean commit/build/activation and live Web + native checks. Live currently40166aab/build3eHsC9QkVQxOaQMMKZZfo. Resource audit started33676;76Node,11.8GiBswap,34.5GiBfree, existing VM/fseventsd load high. Owned dev stopped; no other build started. Preserve all other jobs.


## Loop3 candidate scope — People mobile heading and search rhythm

Fresh resident38fa6c00 synthetic390 baseline first row483.875px. Main heading/action stack plus separate result-count row consume space before the list. Parent owns a small CSS-only candidate in people-directory-app.module.css: align heading/Add within one row; compact default search plus count, full-width input whenever committed query adds Clear; keep all metadata/controls,44px search actions, existing URL/search behavior. Adopt shared180ms for existing row/icon140ms transitions. No content/logic/data edits. Actual preview acceptance still required; reject if input readability or long recovery copy regresses. Native normal-state proof still open. No new Pi batch for this small patch.


## 02:19 recovery observation

Loop2 deployed38fa6c00/buildMakeWxrw-wksqlK0dm4LM; protected Time390 actual recordtop594.17 and1440 sidebar empty schedule state verified; formal light images now resident captures. Owned locked restart test (no revision change) failed its25-second bound with connection refused. launchd remains running and logs subsequently show Infisical injected at02:19:01 followed by Next ready5.9sec. This indicates delayed startup rather than a proven app crash; final readback pending. Do not claim restart passed before port/API/protected page recovers. No repeated kickstart, rollback or source change yet. Main source candidate People CSS remains uncommitted, independent review passed hash7bd130aeef92dec1182c07a509ead066cf3c97cb9e1f1dc25bc995c49f352219; actualrenderpending.
