# GET-322: preserve search text entered before hydration

## Outcome and boundary

Preserve text entered into the server-rendered People search before JavaScript
loads, through hydration and a later same-query refresh. Do not change query
authority, history behavior, composition ownership, authorization or persistence.
This is a narrow follow-up to merged #485 and #486, discovered during actual
resident verification. Continue only within the fixed 02:00 local deadline.

## Observed root cause

On clean resident `4cd6586f`, hold Next JavaScript requests and type a synthetic
draft into the actual SSR input. Release scripts and observe the input's real
onChange binding. The DOM still contains the draft, but a later same-query RSC
refresh restores the server query. Already-hydrated input preserves its draft.
The controlled state starts from query and never adopts the early DOM value;
React deliberately preserves that DOM value during initial hydration alone.
The retained browser red receipt is `resident-search-hydration-red.json` in the
GET-322 evidence directory. An earlier response-time read was premature and is
not used as proof that the subsequent React render preserved the draft.

## Ownership and verification

- Parent owns this plan, branch integration, actual browser proof, current-head
  CI, normal merge and clean resident activation/recovery.
- `web_craft` owns People search source and focused tests. First reproduce with
  renderToString, early DOM input, hydrateRoot and a later result refresh; then
  adopt an unhandled early value once without taking over later local intent.
- `independent_review` reviews the final change and its IME/history fences.
- All workers preserve other changes; no overlapping writes or heavy builds.

Run focused search tests, lint, typecheck and docs validation. Verify the same
delayed-JavaScript scenario in the real app after the fix, including a later
render and screenshot readback. Required CI must pass on the new PR head before
normal merge. Build and activate clean committed source, read the live revision,
authenticated changed behavior and graceful subscription recovery. Preserve the
previous release. Clean only this task's isolated run and inactive artifacts.

Local checkpoint: the real SSR/hydration regression first failed for an early
nonempty draft and an early clear (2 failures / 17 passes). The one-time guarded
layout adoption made both pass. With StrictMode and unchanged-SSR controls,
the related nine files pass 114 checks; direct TypeScript, narrow ESLint, diff
and documentation checks pass. Independent source review found no confirmed
P0/P1/P2. Actual resident delayed-JavaScript verification remains the release
acceptance step; source review and response-time observations do not replace it.
