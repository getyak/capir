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
2. Complete at the source gate: unified native titlebar, stable sidebar/menu
   states, transcript hierarchy and locale completeness; independent spec and
   quality review approved `8db3332e` with no confirmed findings.
3. Implemented: bounded task capsule using existing queue and persisted
   readback state, without remounting the composer. Final affected checks passed
   82 tests; independent review and full-branch follow-up closed all confirmed P1/P2. Existing decision cards and Latest result own
   review and unread-result semantics; no duplicate Reply ready claim is added.
4. **Active:** full source review approved and fresh full Web passed2,873 tests
   in334 files ataba97935. PR416 native, Web, backend and CLI CI passed.
   Required security audit found newly published transitive vulnerabilities;
   repair minimal compatible overrides and malicious-input regressions, review
   independently, then require all gates on the new PR head.
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
task-owned APFS clones of dependencies/prebuilt shared packages avoid redundant
installation. The user approved serial task execution while retaining the global
pause marker. MiMo Pro failed authentication on its first request without code
changes; one Codex implementer completed the Web slice without a provider retry.
The native titlebar slice passed 49 focused tests, including production
SwiftUI-host geometry. Web stage one passed 229 focused tests
and a later 75-test document/locale supplement (overlapping, not additive).
Stage-one independent review approved the source gate. The capsule's final
affected group passed 82 tests after its priority and centered-header fixes;
an earlier interrupted timeout round remains recorded, with no definite cause
claimed. Capsule and whole-branch review, current-head CI, deployment and
installed acceptance are still required. A concurrent resource spike reduced
free space below 30 GiB; no production build may start until the storage gate
recovers. Other tasks and their Simulator are preserved.

Durable partial evidence and a resumable patch:
`/Users/cubxxw/ops/reports/macos-craft-unified-20261024/`.
Registered task artifact:
`/private/tmp/ai-test-macos-craft-unified-20261024.jTvKTj`.
Keep this unfinished worktree and its dependencies/artifact; they are not
eligible for completed-task cleanup. The owned blocked Sparkle-resolution build
PID 95531 was gracefully terminated before reuse of the exact pinned package
cache. Retired, unreferenced dependencies and reproducible build/failed-test
caches were removed with exact registered artifact cleanup after formal failure
evidence was saved. Browser-executor dependencies still referenced by a resident
service were retained. Cleanup receipts distinguish allocated bytes from unknown
physical APFS reclamation; free-space changes are not attributed to this task.

Record scoped resource ownership, commands, revisions, results and cleanup in a
task-owned durable evidence directory. Keep secrets and raw business content
out of plans, contracts, PRs and receipts.

## Integration update — 2026-10-24

PR416: https://github.com/getyak/capir/pull/416. Production reviews approved
through059b3cb4, test fixture repair approved ataba97935. Full Web2873/2873
and native49/49 passed. Required production dependency audit failed with11
findings; no audit ignores or lowered thresholds are permitted. Publisher
verified patches affect Backend and Agent Host as well as Web, expanding the
required resident deployment scope. Global pause remains; task execution is
serial under the explicit user exception. Actual deployment/installation and
rendered acceptance are still open.

## Dependency verification checkpoint

The compatible security patch and authentic generated lock passed independent
full review with no confirmed P0/P1/P2. Temporary helper source
`a61cd8aa1635b403bc201c46ccb9b35b24a4b8c4`, run40072712586, passed normal and
frozen pnpm11.18 installation,32 Linux security regressions with zero skips,
and a complete production audit with zero findings. The helper workflow is
absent from this task branch. The earlier failed run remains failure evidence.

The genuine source-bound verification receipt was preserved byte-for-byte;
normal local pnpm still validated the actual parsed lock hash, full policy and
store integrity. Local frozen installation passed; security regressions passed
25 with7 Linux-only skips (all7 ran remotely). Eight focused importer files
passed130 tests. Web typecheck, documentation checks and local production audit
passed. Dependency versions/integrities and importer/patch preservation are
recorded in the formal ops report. The original d49e67ca dependency-cache match
was a pre-repair baseline, not a claim about the repaired graph.

Fresh current-PR-head CI, merge, clean-source resident Web/Backend/Agent Host
releases, signed native installation and actual25-point acceptance remain open.
The global pause remains intact under the user's task-scoped serial exception.

## Installed acceptance follow-up

PR416 merged at7fa3ee31 with exact-merge CI/Security/macOS checks green. Signed
macOS0.2.27(185) was installed through the actual Sparkle offer; codesign,
stapler, Gatekeeper and all137 published bundle entries match. Web and all five
affected API/Agent Host roles now use the approved source/image. Existing model
providers, volumes and network boundaries were retained. Canonical primary
provider/voice/observation/auth probes passed; Infisical image/revision pair and
backend/current agree, keeper registration restored. Web KeepAlive recovery
passed after one owned-wrapper SIGTERM. Private legacy backup and normal099–102
migrations passed, with every migration checksum matching source.

Actual native acceptance exposed row-menu text bleeding through the62% native
material override after portaling above live rows. The follow-up keeps this
specific reading panel opaque; source/CI cannot stand in for deployed visual
readback. Navigation also exposed Chinese loading announcements in an English
workspace; the same active-locale provider now owns both loading strings across
all five catalogs. Four non-Chinese rendering regressions were reproduced before
the change. Native custom macOS command menus retain their preexisting device
language behavior; this follow-up changes Web-owned workspace strings only.

All25 acceptance rows remain open until the final deployed Web follow-up and
real signed-native/owned synthetic workflows have been adjudicated. Permanent
proof: /Users/cubxxw/ops/reports/macos-craft-unified-20261024/.

The installed long-reply path also exposed Chinese fold/provenance/Markdown
accessibility labels in an English workspace. They now use the same five
catalogs while preserving answer text, governed source names and image alt
text. Four non-Chinese fold-control failures were reproduced before the fix.
The sidebar's initial first-message title was observed to settle to the exact
canonical generated title on the shared directory refresh; no automatic rename
or new title authority was introduced.

Further installed acceptance exposed a confirmed-withdrawal gap: after a failed
task and its supplements were removed server-side, accepted local outbox rows
remained and projected a permanent waiting state. The fix binds cleanup to the
exact Withdraw receipt, Session and frozen CAS snapshot; mere absence, failed
transport and mismatched/stale receipts never authorize local deletion. Confirmed
removed message identities retire only their scoped outbox/image/handoff data;
other queued intentions, other accounts and new drafts remain. A visible group
note explains that withdrawing a task also removes its pending supplements.
Tests cover group withdrawal/reload, ambiguous and wrong receipts, other scope/
queued identities and old receipt ABA. The raw UI failure and metadata-only
owned test database readback are retained; no private conversation data was read.

Native custom menus were also confirmed to mix hardcoded Chinese with English
macOS controls on an en-SG device. Nineteen owned command/appearance keys now
use five compiled bundle localizations. Three focused XCTest cases passed against
the built app; signed publication/install and actual menu readback remain open.
No dynamic account-locale authority or wholesale native Settings rewrite was added.

## Final installed acceptance follow-up: shell locale and health uncertainty

PRs #416 and #417 are merged. Web is on `066ffa5`; all five affected
backend roles use the prior merge's identical backend tree/image `7fa3ee3`.
macOS 0.2.28 (186) is signed, notarized, published and passed the release's
published-app tests; local signed Sparkle installation is in progress.

Actual isolated-run acceptance confirmed Stop -> Paused, queue editing,
explicit Resume -> persisted answer, and successful Withdraw clearing local
outbox entries while preserving another queue item and an unsent draft,
including after reload. Browser-only Offline preserved authorized recent
sessions plus Retry. It also exposed two remaining R1/R3 defects: account
popover labels bypassed the catalog, and browser transport failure fabricated
a backend-unavailable observation. This bounded Web follow-up localizes the
ordinary account/usage/appearance chrome and changes only that client failure
to an unconfirmed read. Server-provided dependency failures remain visible.
No backend, native, credentials, account scopes or effect actions change.

New red evidence: seven focused tests initially had six failures (all four
non-Simplified-Chinese account popovers plus health label/transport assertions).
The first green pass also corrected two test expectations to existing
Traditional-Chinese/Korean catalog wording; this is not a product change.
Independent review, exact-head CI and clean committed Web deployment remain
required before this follow-up closes. Formal raw evidence is under the
operations report directory recorded above.

## Open-stream restart acceptance correction

The final `630d703` Web deployment is active and PR #418's current-head checks
passed. Its actual SIGTERM recovery test failed: after 45 readiness probes,
the prior process still held an authenticated subscription and stopped
accepting new connections. Infisical was awaiting its still-running Next child.
Refreshing this task's native window closed that old stream; the old process
then exited and launchd restored service. Thus the prior `7fa3ee3` recovery is
narrower evidence and cannot substitute for recovery with a live subscription.

The installed Next 16.4.2 source awaits `server.close()` before cleanup. The
conversation queue's read-only Web SSE proxy has no process-shutdown abort.
Add a process-scoped termination signal only to that subscription transport;
retain ordinary request/transaction deadlines and all canonical task state.
Do not terminate or cancel an Agent task, install another poller, force-exit
Node, disable Next's own graceful handler, or add periodic connection churn.
Required proof: a live native subscription remains open while SIGTERM causes
launchd recovery without a manual refresh; persisted turns remain unchanged.

The repair registers the shutdown signal before the first auth await, fences
late admission of a stream after termination, and aborts only the upstream
read-only subscription. A reviewer found and closed the first-auth-wait race;
the held-claims regression uses the real signal helper with an isolated event
emitter. Web regressions: 22 passed in two files. Native recovery title, body,
HTTP-status copy and Reload now follow the same five app/device language tables
as menus (24 keys per table); compiled-app regressions: 4 passed, no skips.
The native red resource test failed before these keys were added. No native
connection policy, login, persistence, task mutation or settings action changed.
All applicable current-head CI, signed publication/installation, clean committed
Web activation and the open-subscription restart re-test remain required.

## Delivery readback and remaining visual acceptance

PRs #416, #417, #418 and #420 are merged with their applicable current-head
checks and independent reviews complete. Resident Web is the clean `f4ecd485`
release. All five affected backend/Agent Host roles remain on image/source
`7fa3ee3`; their backend tree is unchanged by later Web/native-only follow-ups.

The open-native-subscription SIGTERM re-test passed in 5.421 seconds, wrapper
24394 -> 24677, without a client action. The exact original Session and its two
user messages remained visible after recovery. The prior 45-probe failure is
retained separately. The final OS Pinyin test converted n/i/Space to a Chinese
candidate and Enter ended the next active composition without submitting; its
draft, input source and expiring test workspace were then cleaned and deletion
read back. No primary-account message was sent.

The signed macOS 0.2.29 (188) distribution at `f4ecd485` passed packaging,
notarization, actual published-app tests and signed appcast publication.
Local Sparkle installation completed and relaunched build 188. Its 147 bundle
entries (file bytes, directory modes and symbolic links) match the published
ZIP; strict code signing, stapled notarization and Gatekeeper all passed.
The release's target commit and exact bundle identity bind this installation
to `f4ecd485`; the revision is not embedded in Info.plist. Sparkle restarted
to a new draft; the original Session was explicitly selected afterward and
its two user turns read back. The formal installation receipt owns this state.

The formal operations matrix currently records 24 covered checks and **N3
fullscreen visual acceptance partial**. The fullscreen white band/blue indicator
remains overlay-confounded with unknown cause; no guessed inset, application
severity or visual pass is assigned. Normal-window controls, selection,
minimize/restore, native zoom, resize and fullscreen entry/exit were exercised.
macOS 27 hardware, a full VoiceOver workflow and physical keyboard hardware are
not claimed. Preserve the source worktree and its recovery references while
this acceptance remains open. The permanent report and raw evidence are in
`/Users/cubxxw/ops/reports/macos-craft-unified-20261024/`.
