# GET-25: Web loading performance

## Outcome and boundary

Make authenticated Web entry and navigation responsive without extending the
lifetime of candidate evidence, identity, sessions, or approval authority.
Issue: https://linear.app/getyak/issue/GET-25

Worktree starts at `56292d3c` from remote main. The original checkout and GET-9 /
GET-23 work remain separately owned. Detailed Linear contents are not yet read:
both available browser transports timed out or had no connected extension.

## Evidence and design

- Workspace layout blocks every route on an unrelated Lab manifest request;
  the client retries the same operation after server failure. Move the read to
  the existing bounded client loader so product HTML does not wait for Lab.
- Phosphor barrels export thousands of icons and are absent from Next's default
  optimized-import list. Explicitly optimize client and SSR entry points.
- Screenshot capture is conditional but statically imported. Split that panel
  at its client boundary and retain its existing review/close semantics.
- Repeated cookie decoding can be shared within a React server render only.
  Keep expiry checks outside memoization and backend authorization at use time.
- Hashed Next assets already support immutable browser caching. Do not add a
  service worker, persistent candidate cache, global token/client cache, or a
  shared CDN cache for private pages/API responses. Those require an independent
  invalidation and retention design and do not address the measured blocker.

## Milestones

1. **Complete:** capture production-build baseline and deterministic delayed-Lab
   HTTP evidence; inspect the installed framework documentation.
2. **Complete:** implement loading changes and focused regressions, preserving retry and
   account isolation; compare the same production routes and resource bytes.
3. **Complete:** independent sub-agent review, fix confirmed P0/P1, run Web/docs checks.
4. **Active:** create linked PR, pass current-head gates, merge/read back, finish Linear only
   after acceptance. Record real access blockers rather than declaring success.

## Verification

Use synthetic account credentials and a loopback-only backend fixture. Measure
product markup availability with a delayed Lab, backend request counts, initial
JS bytes and private/static response cache headers. Confirm fresh reads after
backend changes, distinct account responses, unauthenticated redirect and expiry.
Use browser interaction if its transport becomes available. Wall-clock results
on a busy developer machine are diagnostic, not field Core Web Vitals.

## Sources

Installed Next.js 16.3.4 documentation in `apps/web/node_modules/next/dist/docs/`:
`optimizePackageImports`, `lazy-loading`, and `loading` references.

- https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports
- https://nextjs.org/docs/app/guides/lazy-loading
- https://nextjs.org/docs/app/api-reference/file-conventions/loading
- https://react.dev/reference/react/cache

React cache is per server request; it is not a cross-request authorization cache.

## Progress

- Implementation, Web lint/tests/build and docs checks pass. Independent review
  has no unresolved P0/P1/P2; its script cleanup P2 was fixed and independently
  checked with a missing build (nonzero exit without hanging).
- [Production HTTP evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-10-web-loading/README.md)
  records the before/after measurements and cache/account regression checks.
- Lab panels were also split into a lazy dialog module; the provider remains
  mounted to preserve navigation state. Person merge stays unchanged because it
  exposes an always-visible trigger and is outside this measured slice.
- GitHub CLI recovered. Browser/native Linear transports remain unavailable;
  do not mark the issue complete without reading additional acceptance criteria.
