# Web craft evaluation — October 7, 2026

People, Today and Sessions now share a consistent readable layout. People
shows one contact count and retains search and identity context. Today keeps
the next action prominent, replaces the inactive Agent panel with a compact
explanation, and offers keyboard-accessible source details. Sessions aligns its
spacing, type and action sizes with the other pages. Nested viewport minimum
heights no longer add empty scrolling, including the 78px narrow-shell excess.

## Scope and authority

The source branch is `codex/web-craft-oct07`, isolated from the original dirty
checkout. Only Web presentation and focused tests changed. Evidence warnings,
ownership, approval boundaries, eligible composer behavior and navigation
destinations remain available. No real candidate data, native implementation,
backend runtime or Agent behavior was changed.

The Pi/MiMo Pro implementation batch was reviewed and integrated by Codex;
Codex corrected additional layout issues observed in the browser and performed
the final checks and deployment. Pi was stopped before a redundant build and
is not recorded as a completed delivery or independent final reviewer.

## Before and after

All captures use an owned synthetic test space, with 12 contacts, 30
observations and four tasks. The test-space banner belongs to that environment.
Desktop captures use 1440×1000; the mobile captures use 390×844.

| Surface | Before | Active production |
| --- | --- | --- |
| Today | [Before](before-viewport-today.png) | [After](live-today.png) |
| People | [Before](before-viewport-people.png) | [After](live-people.png) |
| Sessions | [Before](before-viewport-sessions.png) | [After](live-sessions.png) |

Additional captures: [mobile People](live-people-mobile.png),
[mobile Sessions](live-sessions-mobile-confirmed.png), and
[dark Today](live-today-dark.png).

## Verification

- Final focused Vitest suite: seven files, 40 tests passed. It covers People,
  Today, Sessions, directory hydration, shell rendering and Today domain
  behavior. Changed-file ESLint and repository typecheck passed.
- Final `pnpm docs:check` passed, including wiki, architecture boundaries and
  architecture diagrams, with 434 Markdown files checked.
- Clean detached production build passed. The existing `realpathSync` tracing
  warning in `candidateWorkspace.ts` remains; that module was not changed.
- [Live browser receipt](live-verification.json): all 19 checks passed on the
  resident HTTPS origin, in `Asia/Shanghai`. Checks include keyboard disclosure,
  visible search focus, exact and empty search, clear, person navigation and
  reload, populated session retrieval, 320px/390px bounds, dark mode and reduced
  motion. No uncaught browser errors were observed.
- Empty desktop search and desktop Today fit the viewport without artificial
  scroll. Narrow Sessions fits its viewport; long People and Today content
  scrolls normally. All tested narrow pages avoid horizontal overflow.
- [Restart receipt](restart-verification.json): launchd recovery passed with a
  new PID and a real `password-account` authentication provider response. An
  authenticated Sessions page was read back after the restart. An earlier
  probe expected the wrong provider ID; the corrected probe uses the actual
  producer response and does not treat that earlier attempt as a pass.

Browser coverage does not establish native acceptance, all possible long-title
or unread combinations, or the user's subjective approval of the visual design.
Unread/title handling also has focused unit coverage. No full final repository
test suite is claimed; the checks target the changed Web behavior.

## Resident release and cleanup

[Active release receipt](release.json): source
`f0018f60940de7b7e18db953ce536687e0a7f95c`, build
`0slPTip5ETExcVkXLOPyh`, port 3000. The release was built from clean committed
source and activated through the existing Web launch agent. The original
tailnet HTTPS handler remains reachable. The preceding release is retained for
rollback. Later evidence-only commits do not change the deployed runtime.

Owned capir run `f5947716-c4ba-449f-a4f9-07870e7e45a2` was stopped, then read
back as `deleted`, with no cleanup error and its local credential removed.
[Cleanup receipt](cleanup.json) contains only the relevant non-secret fields.
Private run and browser credential files were removed. The dev preview was
stopped. No simulator was created or started; the scoped simulator guard
retained the three shutdown allowlisted devices and deleted none. Unrelated
test artifacts and the original checkout were preserved.
