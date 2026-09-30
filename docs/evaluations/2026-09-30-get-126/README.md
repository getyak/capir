# GET-126 workspace footer and account menu verification

Dated 2026-09-30. The implementation starts from `41d6b734`. All screenshots,
bridge values, usage values and database records below are synthetic. No private
conversations, credentials or original issue screenshots are committed.

## Design and result

[Editable Figma comparison and states](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=365-1970)
contains two genuine footer alternatives. Selected A exchanges the 120px apps
pill and 40px update entry inside a constant 216px strip; B keeps separate
compact labeled utilities. Separate light, dark, available-update, expanded
usage, failure and support states are editable frames, text, instances and
vectors. The A prototype (`365:2333`, `365:2365`) has a read-back-verified
220ms hover transition. The optional GIF export did not complete; no GIF claim
is made. Figma version and usage examples are illustrative, not release truth.

The implemented menu puts identity and an available-update banner first,
then usage, mobile access and support, then preferences and logout. Support
expands inline to stay reachable in short or narrow windows; the separate
Figma support flyout is an alternative concept rather than an exact runtime
layout promise. Ordinary browsers retain their account row.

| Evidence | Artifact |
| --- | --- |
| Selected A default and hover | [Default](figma-default.png), [hover](figma-hover.png) |
| Runtime light account menu | [Menu](menu-final.png) |
| Runtime hover and actual host version tooltip | [Hover](hover-final.png) |
| Runtime dark support disclosure | [Dark support](dark-support-final.png) |
| Failed usage read and disclosure | [Error](usage-error.png), [detail](usage-detail.png) |

## Observed checks

- Web focused checks: 42 tests in five files, covering footer/bridge states,
  usage store, proxy and download surfaces. Web and backend typechecks pass;
  lint has zero errors and six existing warnings outside this change.
  One concurrent local backend run exceeded its existing 5s timeout under
  compiler contention; the isolated final run passed all 17 in 2.86s, without
  raising timeouts or changing production code.
- Backend: 17 tests cover Shanghai Monday/week/year boundaries, configurable
  reference allowance, unique retained-run metadata, exact member/account
  scope, future exclusion, authenticated route registration and no-store.
- Real PostgreSQL 18 exercise of the production aggregate: start inclusive,
  next Monday exclusive, future rows excluded, exact member/account isolation,
  failed retained runs counted, identical run retry counted once, metadata-row
  removal count 3→2. See [SQL receipt](weekly-sql-proof.json). Source deletion
  may retain run metadata; the UI does not promise that source deletion lowers
  the displayed count.
- Chromium at 1100×780: main region remains `x=236,width=864` before/after
  hover. Apps/update widths are 40/120 after hover, with intact 16/15px SVGs.
  Keyboard focus also expands the update; its tooltip is hoverable and Escape
  dismisses it. Hover and state changes preserve the draft and execute no
  native action. Reduced motion is immediate (the global 0.01ms override).
- Menu width 316px; default height 557.5px exposes logout. At 860×520 its
  bounded scroll region is `y=26,height=436`; End focuses the visible logout
  at `y=416.5,height=38`. The collapsed rail preserves 40px entries and intact
  SVGs, moving the main region to `x=56` only on deliberate rail collapse.
- Downloading/installing have no install href; failure keeps an updates retry;
  idle links to download; an ordinary browser renders no native schemes.
  Usage failure/retry never displays a fabricated zero. Old hosts render an
  address/copy fallback; an actual isolated-browser clipboard read-back was
  `hello@talentsignal.ai`.
- Native macOS 26.4 WKWebView rendered the current Web implementation. CUA
  verified complete menu layout, closed-submenu keyboard skipping and Escape.
  A lightweight native rehearsal directly compiled the production support
  policy: clicking the real mail link displayed an NSAlert confirmation sheet,
  and Cancel restored the same workspace/menu without opening or sending mail.
  NSURL-backed opaque mail URLs require `URLComponents.path`; a dedicated
  production XCTest counterexample preserves this finding.
- A standalone Swift compilation exercised 17 allow/deny assertions against
  the actual support policy; changed Swift files also pass parser checks.
  No local iOS Simulator was started. Local disk was below the heavy-build
  threshold, so the full native app build/test is reserved for Check macOS CI.

## Review and scope

Independent review found no unresolved P0/P1 after fixes. Its subjective score
for this workspace slice is **96/100**, using the rubric frozen before review:

| Dimension | Score |
| --- | --- |
| Hierarchy and space | 19/20 |
| Continuity and motion | 20/20 |
| Truth and recovery | 19/20 |
| Accessibility and input | 19/20 |
| Visual craft | 19/20 |

Deductions remain for dense expanded details, manual email copy on older hosts,
and no live announcement of asynchronous usage state. This is an expert review
of the checked slice, not a user-study score or full-product rating.

Usage is a read-only aggregate of retained `product_runs` IDs, scoped to the
rendered account, member and session through an opaque HMAC plus the workspace
fingerprint. Missing/stale bindings fail closed before any aggregate read.
Responses never expose run content. The configurable default **1000** is a
weekly reference allowance, not an enforced quota, payment balance or gifted
billing credit. Admission limits and retention are unchanged.

New native mail support is capability-gated and permits only the configured
support recipient and an optional bounded subject, from an explicitly activated
trusted main frame. The native confirmation owns the OS handoff; neither the
page nor a generated summary can send mail.

## Delivery gates and limitations

This record does not claim OS mail-draft completion, a full product-binary
manual run, actual update installation/restart, a newly published native
release or iOS install access. The existing installer trust boundary remains
unchanged. Full native build/tests, all applicable CI and repository gates must
pass on the latest PR head before merge. PR and Linear read-backs carry the
remote delivery outcome; Linear stays open until accepted and merged.
