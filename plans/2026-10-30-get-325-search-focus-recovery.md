# Recover global search keyboard focus (GET-325)

## Outcome and boundary

Selecting an accepted same-tab People or Session result hands keyboard focus to that route's settled title after the search modal releases its trap. Escape, explicit cancellation and modified/new-tab activations retain the existing trigger return. Never steal a later user-selected focus or survive the account lifetime.

The approved recovery brief is the audit's `talent-leafhour-minimal-recovery-queue.json`. Only the isolated branch `codex/get-325-search-focus-recovery` is writable. Initial base: `b5a9048db378ea44668e11510f57ba8cc0e131bd`. PR #486 at `8fa1f246` did not contain this module or global-search consumers; it merged during verification. This recovery was rebased cleanly onto `4cd6586f84119e9b576ef10783fd5d13a4fa5a0d` and the affected checks were repeated. [GET-325](https://linear.app/getyak/issue/GET-325) owns this local recovery.

## Approach

Use the recovered bounded in-memory helper and explicit target markers. Keep current i18n, account directory cache, session workbench/queue, rename/send recovery and PR #486 changes. Do not replay the old branch or copy old consumer files. A generic route focus manager would broaden the change; always returning focus to the global trigger leaves accepted navigation without a destination handoff.

Latest main removed the old SessionSourceHeading. Attach markers to current ready queued/legacy session titles and the unavailable route title; loading placeholders receive none. Person markers go only on settled headings. No new persistence, network requests, user data, credentials or backend/schema changes.

## Tasks and evidence

- [x] Fetch/read latest main; inspect current AGENTS, Link guide, runtime consumers and open PR.
- [x] Clean baseline: existing search-dialog 3/3 tests pass.
- [x] Recover behavioral dialog tests with literal destination fixtures and observe expected failure before product edits.
- [x] Recover helper and boundary tests; minimally wire accepted Link navigation and settled titles.
- [x] Verify late destination, same route, modified/new-tab, user focus, timeout, expiry, account replacement, navigation and cleanup; rerun neighboring search/workbench tests and narrow lint.
- [x] Record exact local checks and remaining gates; prepare the audit handoff for local commit.
- [ ] Parent independent review before any push/PR; locked-dependency full checks and real framework/browser acceptance.

## Decisions and constraints

- Ruling: use the requested AUDIT path through git worktree add; the native worktree tool cannot select that exact path.
- Ruling: keep a single worker and reuse existing dependency links. Host resources: 260 Node/npm processes, 10.73 GiB swap, 41.73 GiB free; no pause marker. No install, full build, resident restart/deploy or real-account access.
- Reused React/DOM19.3.1 and Radix dialog1.3.1 match the manifest. Cached Next16.4.2 differs from locked16.4.3; focused tests establish their stated behavior only, not the final framework build or browser acceptance.
- Parent specifically owns independent review, subsequent push/PR and GET-325 linkage. Runtime deployment is outside this authorized local handoff, so it remains unverified rather than complete.

## Verification limits

Focused host checks are appropriate for this bounded source recovery. Full project checks, locked-dependency build and real compiled App Router/installed-client keyboard acceptance remain downstream gates; no synthetic fixture establishes production acceptance. Exact evidence lives in the audit handoff and registered test artifact.


## Local verification result

162 focused tests across 12 files pass on rebased main with one worker. Narrow lint, standalone strict helper typecheck, documentation/wiki/architecture boundary and diagram scripts pass. Red evidence includes three destination handoffs, an unpainted retained heading, the actual queued title consumer, and a late Radix close callback after owner unmount; the implementation now fences each.

Full Web typecheck is not green with the reused workspace dependencies: both an in-memory exact-base control and the candidate report the same 201 diagnostic profiles, with zero additions/removals. The cached contracts declaration entry lacks current exports such as LocaleTag; do not rebuild shared resident artifacts merely to clear this local handoff. The isolated helper has no type errors.

The pnpm docs:check wrapper attempted its dependency preflight and stopped before modules removal because no TTY was available. It was not forced. The equivalent four existing Node check scripts passed directly; do not claim the wrapper command passed or a dependency installation completed.

- Ruling: omit targets from loading placeholders, skip unpainted/hidden retained headings, and fail closed without the workspace root. The red tests showed a retained title could otherwise consume the intent; geometry in happy-dom is explicitly a synthetic fixture.
- Ruling: add a mounted-owner fence and clear the pending intent on cleanup. The delayed Radix close callback could otherwise re-arm work after cleanup.

The exact local commit, check artifacts, command results and limitations are in the parent audit's capir-search-recovery-handoff. Source is ready for independent review, not runtime delivery or production acceptance.

The first post-rebase assertion run exposed a test-double defect: happy-dom followed the _blank link to anonymous localhost instead of remaining a controlled navigation fixture. The Link double now suppresses actual browser navigation in every branch and models only the documented onNavigate eligibility. The accepted final 162-test run is clean; this does not prove real tab navigation.

## Independent review follow-up

The real Radix Presence keeps closing Content mounted for its 120ms CSS exit.
Cmd-K can reopen that same Content before close autofocus consumes the previous
selection. A new open now clears that selection and cancels any active handoff.
The behavior belongs in the existing dialog integration tests: seven red cases
cover reopening then Escape, explicit close, four modifiers and a new tab;
another case proves a newly accepted result still wins. The harness uses real
Dialog/Presence with live CSS animation-name and painted-heading fixtures;
animationend is dispatched explicitly. It does not establish compiled browser
animation or App Router acceptance. Parent review is required again before push.

The first multi-case animation harness restored a global getComputedStyle spy
in the wrong order, causing cross-test recursion. Its first Escape failure was
valid, but the rest of that run is harness failure evidence. Corrected teardown
produced exactly seven focus failures with fifteen passing controls before the
product edit, then all twenty-two dialog tests passed after the fix.

The final single-worker neighboring regression run passes 170 tests across the
same twelve files, with no failures or skips. Narrow lint and the four existing
documentation/boundary scripts pass. Earlier full-Web typecheck and compiled
browser/deployment limitations still apply; this follow-up does not claim them.
