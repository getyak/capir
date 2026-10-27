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

## Delivery checkpoint

- PR #450 merged at `0d46b810b07b8a68a0c31861dda4bc1eff4cf54d` after
  independent review closed all five confirmed P2 findings with no P0/P1.
- Web suite: 371 files / 3269 tests passed; lint, typecheck, docs, repository
  policy and secret-contract checks passed. Exact PR-head applicable CI and
  Vercel passed. Post-merge push CI/security passed; a later scheduled Swift
  scan was cancelled by a higher-priority main run, not reported as green.
- Clean resident Web build/activation succeeded at that merge, build ID
  `l8rZ5JtC5qs-XSkKCubiM`. The successor preserves concurrent GET-237 density.
- Chromium covered pointer/reload in both lists, keyboard/focus, filtered
  commands, scrolling/outside drops, storage refusal/retry, queued locks,
  offline moves, touch, dark/reduced motion and 200% text with 44px controls.
  Real WebKit on resident HTTPS passed both drag/reload cases without page
  errors. Pin geometry at the same 248px sidebar: 41.61px to 12px, with title
  space 82.39px to 100px and the 44px interaction target retained.
- Installed macOS client is 0.2.36 (202), on the default test workspace. It
  renders the new controls; final native interaction/restoration remains active.
  Earlier native attempts overlapped another task's navigation and are not
  counted as passing interaction evidence.
- Graceful child-process termination recovered automatically, but terminating
  the launchd parent reproducibly left one connection accepting subscription
  retries with 503 while the listener was closed. Bounded diagnostics confirmed
  the same HTTP connection was reused. Closing only idle connections released
  the process and launchd restored it. Follow-up hardening closes subscription
  connections on both live and rejected responses; focused tests were first
  observed failing. Final parent-termination acceptance remains mandatory.

## Remaining gates

1. Review, CI and merge the subscription-transport hardening from fresh main.
2. Deploy clean committed source and repeat parent-termination recovery with
   an authenticated subscription open, unchanged turns and no manual refresh.
3. Finish installed-client drag/pin/reload checks, restore original preferences,
   stop the owned expiring run, and verify deletion before Linear Done.

## Evidence and ownership

- Task source: `/Users/cubxxw/ops/symphony/runtime/workspaces/GET-236`.
- Private formal evidence: `/Users/cubxxw/ops/runs/get-236-20261026`.
- Owned test run: `697b7f0b-f43a-4e6d-b6e0-834cb761ec3e`; only synthetic
  data, no model send. Credentials stay in registered private temporary output.
- No simulator or backend restart. Preserve other tasks and the live/rollback
  releases. Retain the source checkout while release worktrees reference its
  common Git directory. Development auth/HMR and unsettled captures remain
  harness diagnostics, separate from clean production acceptance.
