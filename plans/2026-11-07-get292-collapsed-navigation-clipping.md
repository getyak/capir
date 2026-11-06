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
not those previews. Latest head `89bf29b4` passed both required gates; PR #513 merged as
`12f39808e6bf3d4e866cecc857a40ebec1c0b93c`. Post-merge checks are separate.
WKWebView readback and serial resident deployment remain pending. Formal
evidence: `/Users/cubxxw/ops/runs/get292-sidebar-clipping-20261107/`.


## Current-source WKWebView follow-up

Base: freshly fetched main `12f39808`; branch `codex/get-292-webview-sidebar`.
The installed 0.2.47 (258) executable exactly matches the official ZIP binary
(SHA-256 `9a854817ec57cb9f8e25eccdb94ad8ca6df67aeabfb6c694b96b1951ffc9f9e0`).
Its source tag resolves to `0580dbf6`. Live Web is still `99ce3138`. These are
provenance facts, not candidate acceptance.

An isolated WKWebView host loads the same current-source Frame, Nav, global
styles, theme and CSS fixture, with the product user agent and desktop display
metadata. It uses a distinct bundle identifier, a nonpersistent store and only
loopback synthetic content. It has no account, model, capture or ASR capability.
The current main reproduces the installed symptom: initial rail rows are 44px
and nav 182px; after collapse/expand, computed state returns correctly but used
row heights become 106/232/124/88px and nav 556px. A normal Reload restores it.

The `height:max-content` hypothesis failed and was removed. The single-property
candidate `grid-auto-rows:max-content` restores content-sized grid tracks. The
observed first pass and three repeated English transitions remain 44px / 182px;
Chinese, desktop 761px and mobile 760/390px transitions pass. In the 480px
short desktop window, the existing scroll area clips Time initially; ordinary
scrolling advances it by 44px and paints all four targets fully. The first
visibility assertion omitted clipping ancestors, was rejected by independent
review, and is retained as a harness failure. The corrected proof intersects
target bounds with clipping ancestors and verifies real scroll reachability. At 200% root text size rows naturally grow to 52px / nav 214px, preserving
content instead of fixing row heights. All samples wait for loaded fonts and
settled layout. Host tests: 97 passed again. Independent source review has no
remaining P0/P1/P2; Chrome desktop, 200% text, 761/760px and Chinese 390px checks passed;
console warnings/errors are empty. Final independent evidence review is pending.

The fixture and private installed-client screenshots remain local. Keep the
single GET-292 issue In Progress through serialized resident deployment and
actual installed-client acceptance; disable any premature linked close by
restoring the issue status if needed. No resident service was switched here.
