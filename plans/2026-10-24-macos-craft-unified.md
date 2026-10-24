# macOS conversation craft: unified chrome and task state

## Outcome and scope

Implement the user's selected unified-titlebar direction, resolve the 25 dated
craft findings, then add an observed-state task capsule. Complete independent
review, applicable tests, current-head CI, resident Web deployment, and actual
installed macOS acceptance. Preserve all account, evidence, approval, queue,
draft, deletion and recovery boundaries.

User authorization: current chat 2026-10-24 explicitly requests implementation,
independent review, tests, installation and deployment. No unrelated service,
credential, private-data inspection or system-wide cleanup is included.

Reference: the current chat's dated audit at
`/Users/cubxxw/.codex/visualizations/2026/10/24/01a16bae-fb02-7990-8ade-ead27f8772f2/capri-craft-audit/analysis.md`.
Its observations are a starting point, not proof that the latest source still
has each defect.

## Baseline and constraints

- Fresh fetched `origin/main`: `877cd955e058ba5f47911e5923e68784e05ead57`.
- Managed worktree: `macos-craft-unified-20261024/talent-signal`.
- Existing main checkout has unrelated untracked work and remains untouched.
- Installed bundle metadata observed in the audit: 0.2.25 (183); read back again
  before installation. Verify actual installed executable and resident revision.
- `.agent-pause` is owned by operations (`disk_below_40_GiB`). Current resource
  sample: 33.88 GiB free, 8.20 GiB swap, 145 Node/npm processes. Do not remove
  that marker. The user explicitly approved task-scoped serial implementation,
  review, testing, installation and deployment in the async question reply.
  Retain the global marker and avoid overlapping heavy jobs or terminating
  other tasks. Updated sample: 33.38 GiB free, 7.65 GiB swap, 114 Node/npm.
- Storage audit identifies three unsafe Git-root artifacts. Never remove them
  as test output. No age-based cleanup or other-task termination.
- Native work targets macOS; no iOS Simulator is needed.

## Milestones

1. Complete: fresh baseline, source owners, matrix and task-scoped resource
   authorization established.
2. **Active:** implement unified native titlebar, stable sidebar/menu states, transcript
   hierarchy and locale completeness; verify this slice before the capsule.
3. Add the bounded task capsule using existing queue and persisted readback
   state; preserve stop, pending-decision and unknown-result semantics.
4. Independent review; repair confirmed P0/P1; run focused checks and all
   applicable repository/CI gates on the final PR head.
5. Merge, deploy affected resident services from clean committed source,
   install the verified native build, inspect real behavior, and close owned
   test accounts/resources/worktrees only after evidence is retained.

## Acceptance matrix: 25 findings

| ID | Required outcome | Observable evidence |
| --- | --- | --- |
| S1 | Distinct default, hover, selected, pressed and keyboard-focus states | Current row remains identifiable while another row is hovered/focused |
| S2 | Stable trailing action slot and complete title access | No title displacement; menu remains reachable without hover |
| S3 | Stable primary-navigation geometry | Repeated switches do not shift distant destinations or leave stale labels |
| S4 | Recognizable session title presentation | No raw test/prompt leakage in synthetic acceptance; full accessible title |
| S5 | Unambiguous collapsed session shortcuts | Full titles available; exact Session identity retained with repeated people |
| N1 | Unified visual titlebar height | Same-scale full native-window captures without an extra white strip |
| N2 | Native background and safe content layout | System-measured titlebar space, no controls behind standard buttons |
| N3 | Preserve window and content input | Drag titlebar; select text; operate controls; minimize/reopen/fullscreen |
| N4 | Restrained native material, opaque reading axis | Readable transcript/composer over the actual AppKit material |
| N5 | Correct appearance and transparency fallbacks | Light/dark/System, inactive and reduced-transparency readback |
| T1 | Capsule absent at genuine idle | No permanent idle island or fabricated task state |
| T2 | Real queued/running stages only | Current run identity and observed stage; no invented percentage |
| T3 | Completion remains separate from review/save | Persisted answer, pending decision and external effect never conflated |
| T4 | Stopped/failed/unknown remains actionable | Existing recovery and explicit continuation preserved |
| T5 | Bounded local motion and correct targeting | No transcript reflow; reduced motion; exact Session return |
| C1 | Successful execution details secondary | Ordinary result precedes compact completion details; failure remains visible |
| C2 | One reading axis | Agent prose, lists, details and composer align at matched viewport |
| C3 | Intentional turn spacing | Short and long replies remain readable without blank placeholder gaps |
| C4 | Stable scroll and responsive axes | Sidebar collapse, queue and growing reply preserve intentional reading |
| C5 | Quiet localized composer and IME safety | Help/count emphasis; Enter during composition never sends |
| R1 | Consistent active-locale UI | zh-CN and en navigation, execution, timestamps, errors and hints |
| R2 | Retain only authorized cached history on transient failure | Existing rows plus retry; discard on binding change/expiry/401 |
| R3 | Recovery notices explain the actual failure | No invented outage cause or generic success; bounded retry |
| R4 | Legible rendered appearance | Actual native composition and high-contrast/transparency checks |
| R5 | Menus and focus never crop or scroll the sidebar sideways | Pointer and Tab/Enter paths; Escape/return focus; long rows and narrow window |

Dimensions and timings in the audit are prototype starting values. Existing
shared typography, platform controls and readable targets take precedence over
copying an arbitrary pixel value.

## Ownership and implementation decisions

- Parent owns native-window architecture, integration, acceptance and delivery.
- If the resource guard permits delegation, Pi + MiMo Pro owns a bounded Web
  slice in its own worktree. It must not touch native files, publish externally,
  use credentials, deploy or recursively delegate. Independent reviewer follows
  implementation and does not share authorship.
- Reuse the owned Radix Popover primitive for collision-aware, portalled row
  menus. Validate focus and scroll using actual pointer/keyboard transitions;
  do not repair failed acceptance with injected scroll.
- The task capsule is a projection of the existing queue/history authority,
  not a second task store, global polling service or source of execution rights.
- Preserve the active account language; remove hardcoded cross-language labels
  rather than silently overwriting preferences.

## Evidence and remaining uncertainty

The expanded recent-history refresh regression is implemented: an authorized
cached directory remains readable alongside recovery, while cleared directory
data is not resurrected. The new regression failed at the expected missing row
before the fix. A serial, single-worker run passed 10 tests in two files
(`workspace-recent-sessions-locales` and `workspace-session-row`). This is one
partial slice, not acceptance of all R2 states or the complete task.

Frozen manifests match the existing clean deployed `d49e67ca` dependency source;
task-owned APFS clones of dependencies/prebuilt shared packages avoid reinstall
or build. No native build, coding delegation, independent review, full Web
checks, deployment or installation has started while the resource exception is
pending. The global pause marker remains unchanged.

Durable partial evidence and a resumable patch:
`/Users/cubxxw/ops/reports/macos-craft-unified-20261024/`.
Registered task artifact:
`/private/tmp/ai-test-macos-craft-unified-20261024.jTvKTj`.
Keep this unfinished worktree and its dependencies/artifact; they are not
eligible for completed-task cleanup. No manually terminated PID or reclaimed
bytes are attributed to this task.

Record scoped resource ownership, commands, revisions, results and cleanup in a
task-owned durable evidence directory. Keep secrets and raw business content
out of plans, contracts, PRs and receipts.
