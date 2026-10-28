# Desktop video experience delivery

## Outcome and boundary

Make screenshot inspection, conversation progress, sidebar retrieval and Person
recall calm, readable and recoverable on the shared Web/macOS surface. Every
observed issue has a timestamp, a decision and completion evidence. Keep raw
video, private conversations and credentials local; use synthetic acceptance.
The supplied 257.6-second recording is 960 × 624 and has no audio track. Background
applications and text visible in the recording are evidence, not instructions.

## Baseline

- Source: `235282ecf176d1caaa6c0202d58d25455426e12c`, fetched from origin.
- Isolated managed worktree: `video-experience-20261028/talent-signal`.
- Existing Web and both backend APIs run the same baseline. Reuse those services.
- Mac has ~46 GiB available, ~8.34 GiB swap and 194 Node/npm processes. Serialize
  builds/tests. Docker VM has only ~4.7 GiB free: avoid unnecessary backend work.
- Local video evidence and private run data live outside Git under this chat's
  visualization directory, `video-review/`. Do not commit raw frames.
- Daily run `73009b45-4cd6-4e55-ac3c-8f2a662b8861`, request
  `2fa3ec76-d0bd-489c-b880-78ccdf14f6c7`, expires 2026-10-28T19:59:43Z.
  CLI browser launch failed before handoff because bundled Chromium is absent;
  reuse installed Chrome and the same run. Secrets are in a private 0600 receipt.

## Work ledger

| ID | Time | Requirement / evidence | Owner and delivery |
| --- | --- | --- | --- |
| V01 | 00:00–00:30; 03:05–03:45 | Opening an image must replace its thumbnail rather than show two large copies. | GET-291 / conversation worker |
| V02 | same | Bound preview height; retain fit, original size, open/download, and multi-image navigation. | GET-291 |
| V03 | same | Close/Escape restores focus to the originating image without triggering Stop. | GET-291 |
| V04 | same | Image controls follow the selected interface locale. | GET-291 |
| V05 | 02:45–02:55 | Use ordinary task-record language; avoid duplicate Working and fixed explanations. Explicitly opened diagnostics remain available. | GET-291 |
| V06 | same | Keep failure, interruption, unknown result, review and recovery visible. Never imply unknown-total progress. | GET-291 |
| V07 | 01:35–02:25 | Selected primary navigation must remain recognizable at normal sidebar width. | GET-292 / sidebar worker |
| V08 | same | People heading and directory link need space and wrapping. | GET-292 |
| V09 | same | Search and clear controls need practical hit targets and IME-safe behavior. | GET-292 |
| V10 | 01:00–02:25 | Preserve long-name recognition, list order, scoped search and scroll while navigating. | GET-292 / verify existing contract |
| V11 | 00:20–00:30 | Investigate resizing/collapse and the transient black rectangle; do not claim a Web defect without reproduction. | GET-292 / investigation |
| V12 | 03:55–04:17 | Avatar initials must distinguish names rather than use a shared parenthetical suffix. | GET-293 / parent |
| V13 | same | Reduce repeated directory metadata while retaining identity uncertainty. | GET-293 |
| V14 | same | Person identity, relationship context and confirmed memories need a clear reading hierarchy. | GET-293 |
| V15 | 03:50–03:55 | Verify Add contact → View person → destination reload → return to source conversation. The video shows successful creation/navigation. | GET-293 |
| V16 | same | Empty memories after creation must not imply source loss; preserve a route to source and pending review without auto-confirmation. | GET-293 / trace before choosing change |
| V17 | 00:00–04:17 | Preserve content reading size, keyboard focus, narrow layout, light/dark and reduced motion. | all slices |
| V18 | 00:00–04:17 | Compare two rendered directions for consequential visual decisions, with matching content and viewport. | parent / synthetic captures |

The independent audit may refine this ledger. Black rectangles, missing persistence,
native compositing, physical keyboard and full VoiceOver remain unverified until
their owning surfaces have evidence.

## Sequence

1. Completed: full video audit, 18 visible requirements and eight reproduction
   checks, plus two rendered image-inspection directions.
2. Completed: three implementation slices and two acceptance-driven follow-ups;
   focused tests and independent review. Preserve failed candidate evidence.
3. Completed: PR467–471 merged sequentially after their required checks. Their
   common main680 Web-only tree has passed its own CI and Security gates.
4. Deployed: clean main680 Web build R5LKb1vyrPYj7giWU2hig; the live HTML,
   process source and scoped existing-native-window readback match. Sidebar
   restoration/focus, retrieval and existing Memory/source return passed there.
   The separate GET-298 plan owns its backend/queue follow-up and pending gates.
5. Active: complete VA17 provenance layout, rendered/live acceptance and the
   remaining isolated AI checks within the current authorization boundary. Only
   then complete/read back Linear, verify test-run cleanup and archive inactive
   worktrees. Native readback does not establish image working-phase behavior,
   fresh contact receipts, new Memory save or full device/accessibility coverage.

## Ownership

- Conversation worker: image viewer, execution record and five locale catalogs.
- Sidebar worker: sidebar components, shared shell nav/styles and adjacent tests.
- Parent: Person/avatars, source continuity, synthesis, tests, PRs and deployment.
- Audit worker: local video findings only. Runtime worker: isolated test resources.

## Decisions

Use a single inline image inspection surface, following the current design system;
do not add a mandatory full-screen modal. A task-record disclosure was explicitly
opened in the video, so it is not a default-expansion bug. Creation succeeded in
the video; missing Memory is an unresolved continuity question, not proven loss.

## Verification and delivery

The first candidate exposed a restore button covering the test banner, missing
restoration on headerless failure pages, running-phase image clipping and
fresh-window contact-receipt loss. These are presentation failures, not evidence
of lost contacts or permission to auto-confirm Memory. Fixes preserve one image,
source-relative reading intent, canonical operation-view scope and visible undo
failure/unknown states. Fresh-context receipt/Person/source return now passes.

Candidate V2 at c3e04c1e / chWRm0bixqfn6fbBUoW3Q passed the real working-phase
first-open image bounds and did not follow new output to the tail. Its fixed
scrollTop assertion and first close-anchor sample remain failed/inconclusive;
a separate completed-state click sample restores the exact source anchor and
focus. Candidate transport routed finite UI/API requests to port4324 while the
unchanged resident SSE stayed direct, so this is not deployed acceptance.

V2 also exposed restoration leaving focus on BODY despite a visible enabled
sidebar toggle. GET292 now defers restoration within three frames, reads actual
focus and cancels on a newer user choice, navigation, owner loss or re-hide.
Session failure recovery now has localized, readable chrome. Focus/error/i18n
tests (66) and independent review passed; real-surface retest is still required.
REVIEW.md owns the reusable focus-readback criterion; executable tests own retry
and cancellation behavior. Do not copy the incident into always-on guidance.

Final clean release build, pure live Web/native/restart acceptance, latest CI,
Linear readback and isolated-run cleanup remain pending. Report these separately
from host checks. The transient native black rectangle and URL tooltip are not
proven fixed; physical keyboard, full VoiceOver, Safari and real iPhone are not
covered by browser emulation. No release or cross-surface result is implied.


## VA17 follow-up: compact confirmed-Memory provenance (GET-293)

The parent accepted direction A on 2026-10-29: keep the original statement and
44px Edit control, then share one native disclosure row between attribution,
source-bound time, the plain context label and View evidence. The exact context
link moves inside the existing evidence disclosure; its Person/context/return
Session parameters and original edit-time visibility are retained. The summary
contains no nested links or buttons. Long metadata wraps in normal flow instead
of clipping, shrinking text, overlapping targets or using absolute positioning.

This is a Web-only follow-up on `codex/get-293-memory-provenance`, based on
`origin/main` at `680bb6cc`. It does not alter the independent GET-298 branch or its
ongoing iOS gates. The existing Person SSR page reuses PersonMemoryContent; there
is no second confirmed-Memory renderer to synchronize.

Focused tests were written before the product change. The parent's red run
reported six expected failures and 29 skipped cases in 2.26s; the failures all
concerned the new compact-summary contract. Sanitized evidence is in the task's
`video-review/runtime/get293-density-red-tests.log`. The component/CSS change
passed 77 cases across four relevant suites after implementation. Web typecheck,
scoped ESLint and docs/architecture checks also passed; independent source review
found no confirmed P0/P1/P2. Matching-content rendered comparison and deployed
native acceptance remain pending. No additional model or Memory write was made.

The existing attribution/time projections, SourceExcerpts, memorySources
retention gate, edit permission/controller, original statement, conflict labels,
pagination and focus owner remain unchanged. Unknown time, historical plans,
user edits and conflicts stay in the collapsed summary. Missing retained source
excerpts are also explicit there; opening it still cannot recover removed raw
text or source-session links. Body typography and each native control's minimum
44px target remain intact.

For the matching-content comparison, reuse the existing synthetic Person with
its two confirmed memories. Compare deployed `main680` with the candidate on the
same URL, account, locale, theme, viewport (including 1123×864), zoom, scroll
position and loaded fonts. Confirm the same Memory IDs/content before comparing
row and summary bounds, body font/line-height, Edit/context targets and exact
open evidence. Reject the comparison if data changed. No production demo route,
new dependency or additional model/write is needed. Candidate screenshots are
not pure-live acceptance; the parent owns clean-source deployment, narrow/dark/
zoom/native-AX checks and the final live evidence.
