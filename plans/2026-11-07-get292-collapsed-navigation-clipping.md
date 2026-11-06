# GET-292 collapsed navigation clipping

Outcome: keep the first navigation destination fully visible after collapsing
the desktop sidebar, while preserving named keyboard controls, recent Session
shortcuts, bottom utilities, and the account footer.

Scope: the newly reproduced Chrome clipping in GET-292. GET-316's historical
conclusions and the older WKWebView blank/stretching observations remain
separate. Do not send messages, call models, mutate historical content, change
credentials, or switch resident services in parallel with their release owner.

Base: `d17f98b544077086e3c0f223ca138dda3f1ef8e9` from freshly fetched main.
Reproduction: live Web `99ce3138984e7a4d1f2184c0a36a4e5a23870f47`, real Chrome,
1387 x 733, default test workspace. Expanded links are 44px high. After collapse,
Today is y=-25 and the collapsed navigation has scrollTop=37, clientHeight=655,
scrollHeight=692, while window.scrollY remains zero. Focus moves to the bottom
Expand control. The recent-shortcut list cannot shrink, so focus scrolls the
overflowing rail and hides its first destination.

Hypothesis: let recent shortcuts shrink and scroll within their own bounded
region before the whole rail overflows. Preserve normal focus scrolling for
genuinely short viewports rather than disabling keyboard visibility.

Milestones:

1. Complete: preserve a failing browser geometry sample using current source and
   synthetic recent shortcuts; confirm the smallest layout change fixes it.
2. Complete for Chrome: run affected host tests and real Chrome transition/keyboard checks at the
   reported viewport and shorter/narrower viewports. Check WKWebView separately.
3. Active: obtain independent review, open a supplementary GET-292 PR, pass applicable
   latest-head gates and merge. Keep the issue In Progress until the resident
   release owner serially deploys and the actual surfaces pass acceptance.

Artifacts: `/private/tmp/ai-test-GET-292.ML8I3v`; historical reported screenshots
remain under `/Users/cubxxw/ops/runs/linear-audit-20261106/`. Preserve sanitized
formal receipts before removing task-only temporary resources.

## Candidate progress

The source fix uses `flex:0 1 auto` and a 44px minimum for the shortcut list.
Independent review identified and rejected a zero-height minimum: five focusable
shortcuts must retain at least one paintable target in short windows. No P0/P1
remains in the bounded variant. The 733px live-page style experiment returned
Today to y=12 and rail scrollTop=0; that temporary style was removed by reload,
the sidebar restored, the test login signed out, and its viewport override cleared.

Host checks: 97 affected sidebar/navigation/frame tests passed after building
contracts; initial missing-build import failures are retained as setup evidence.
Focused ESLint and `pnpm docs:check` passed. A synthetic source-component fixture
is available for candidate browser regression; it substitutes only directory
data/search presentation and footer data, and invokes no backend or model.
Candidate Chrome source-layout regression passed at 1387x733 and 1387x600,
with 480px keyboard/wheel/pointer reachability, 0/1/5/failed shortcut states,
761/760/390px boundaries, and Chinese navigation. All 44 native keyboard focus
samples were fully visible. Relevant transitions and fonts were bounded and
settled; screenshots were checked against actual dimensions. An initial fixture
missing global styles and an overbroad 44px assertion are preserved as harness
corrections, not product failures. Final independent outcome review found no
remaining P0/P1/P2.

Supplementary PR: https://github.com/getyak/capir/pull/513. Its first head passed
all applicable GitHub Actions checks; two non-required Vercel statuses report
"Account is blocked." The repository requires `CI required` and `Security required`,
not those previews. Latest-head gates must still be read back before merge.
WKWebView readback and serial resident deployment remain pending. Formal
evidence: `/Users/cubxxw/ops/runs/get292-sidebar-clipping-20261107/`.
