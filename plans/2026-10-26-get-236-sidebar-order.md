# GET-236: quiet pin state and durable manual list order

## Outcome and boundary

Replace the title-consuming Pinned badge with a small non-interactive pin
indicator, and let the owner arrange People and Sessions using a pointer or
equivalent keyboard commands. Preserve navigation, selection, drafts, pin and
archive semantics. This is display preference, never a person's value.

Only the shared Web/macOS list surfaces and necessary preference plumbing are
in scope. Native iOS density and GET-237 are excluded. Private reference images
and user data remain outside the public repository.

## Evidence and decisions

- Verified GET-236 via native Linear MCP: GetYak/GET, no blockers, In Progress.
- Reference maps to `WorkspaceRecentSessions`, not a native SwiftUI list.
- Existing Session flags are local to the origin/client, partitioned by the
  server HMAC of backend account (workspace) and user. They do not sync between
  devices. Manual order will follow that same disclosed ownership contract.
- Pin groups precede ordinary Sessions. Manual order applies inside each group;
  archive remains independent. New/unordered records retain server recency
  after the owner's arranged records. Partial inventories never prune saved IDs.
- Search shows the saved order but disables rearrangement until cleared. Drops
  only address currently loaded, visible IDs in the same group; pagination
  never fetches additional private data for a move.
- Use a small existing Phosphor pin as state, preserving a full accessible name.
  Use the row's existing trailing menu target for both drag entry and keyboard
  alternatives; avoid another permanent column on Session rows.
- Order writes must read current storage under an origin-scoped Web Lock,
  publish only confirmed readback, and retain an honest recoverable error on
  storage/capability failure. No remote writes, Agent calls or polling.

## Milestones

1. Complete: fresh main `7bd5b0a`, affected paths and source ownership verified.
2. Complete: scoped local order, shared pointer/menu control, compact pin indicator
   wired through People sidebar/directory and all Session projections.
3. Active: focused persistence/interaction/isolation tests and browser acceptance.
4. Independent sub-agent review, fix confirmed P0/P1, then linked PR and CI.
5. Merge, deploy affected resident Web from clean committed source, verify the
   actual Web/macOS surface, then mark Linear Done with destination readback.

## Verification and delivery gates

Retain controlled equal-size before/after captures outside the repository.
Cover pointer activation/cancellation/drop, keyboard alternatives, touch target,
pin boundaries, selection/focus/scroll, search, partial inventories, additions
and deletion, reload, account/workspace isolation, storage failures and concurrent
queued writes. Check long multilingual/Emoji titles, light/dark, 200% text,
reduced motion and accessibility semantics. Unit tests do not establish live
persistence or installed-client acceptance.

Run applicable Web tests, lint, typecheck/build, docs and security gates. Record
CI, merge, resident revision and product acceptance separately. Existing Vercel
quota and native resource constraints are unverified historical clues; do not
probe them through duplicate deployments or take over unrelated simulators.

## Current operational state

- Workspace: `/Users/cubxxw/ops/symphony/runtime/workspaces/GET-236`.
- Branch: `codex/get-236-pinned`; initial HEAD `fa01bb1c`.
- Remote main API readback: `7bd5b0a35d8ee2fdfa54a0dfae02c26b9738b35c`;
  bounded Git fetch diagnosis ongoing before implementation.
- Frozen offline dependency installation succeeded using the existing pnpm
  content-addressed cache. No simulator was started. The task's development
  server was stopped before the production-build checkpoint.
- Resource sample: 49.33 GiB free, 11.82 GiB swap, 147 Node/npm processes.
  Reuse one browser and run heavy validation serially; preserve other jobs.
- Linear agent-context discovery advertises a method the connector rejects as
  missing; issue/team/comments reads work. Do not confuse that with a full
  Linear connection failure.

- First independent review found no P0/P1 and four P2 issues: clipped drop
  targets, a replaced feedback class, full-preference recovery and repeated
  relative moves while saving. All four have source fixes and focused tests;
  final review closed all five findings with no P0/P1. Real hit testing owns
  drop admission.
- The existing CLI browser cache lacks its expected Chromium build. The owned
  test run remains `697b7f0b-f43a-4e6d-b6e0-834cb761ec3e`; no new run was
  allocated. Reused installed Chromium in one automated context after the
  failed launcher. Operator identity and target run/account/user were verified.

## Verified implementation checkpoint

- Web suite: 371 files / 3269 tests passed; focused suites, typecheck, full
  Web lint, docs/architecture, secret-contract and repository-policy tests
  passed. Production build and remote gates remain pending.
- Independent review: no P0/P1; all five confirmed P2 findings fixed and
  re-reviewed, including unknown reset readback.
- Real Chromium in the owned run: pointer rearrangement and reload in both
  lists; keyboard Tab/Enter and settled focus return; filtered moves disabled;
  scroller moved 130px and footer drop rejected; storage refusal retained
  order and retry recovered; delayed lock disabled relative commands; offline
  local moves succeeded. Touch drag passed for both directories at 390px;
  200% text retained 44px controls. WebKit acceptance remains active.
- Pin geometry at the same 248px sidebar: indicator 41.61px to 12px; title
  82.39px to 100px, retaining the 44px interaction target.
- Private evidence: `/Users/cubxxw/ops/runs/get-236-20261026`.
- Main API readback remains `7bd5b0a`; both main Vercel contexts succeeded.
  This does not establish this branch's forthcoming CI/deployment results.
- The Webpack development harness exposed authentication-cycle/HMR errors and
  a navigation-load timeout. The affected authentication sources are unchanged;
  completed cases bound to the correct run and had no browser page errors.
  Clean production runtime acceptance remains mandatory.
