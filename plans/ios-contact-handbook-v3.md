# iOS contact handbook v3

## Outcome

Implement the user-selected minimal contact overview in native iOS: identity,
one authorized Memory excerpt, one explicitly related work draft, and a scoped
conversation entry. Full Memory, evidence, person details and work status remain
reachable through disclosure rather than occupying the overview.

## Scope and boundaries

Native iOS only; reuse existing authenticated People/Memory contracts and
semantic colors/brand mark. No backend/schema, provider, external messaging or
calendar writes. Preserve real display names, fixture markers, statement kind,
source attribution, exact relationship scope and action draft state. Do not
infer a context-to-Pursuit link or manufacture missing profile/contact fields.

## Baseline and reference

- Base: `43acf4ea242b70f21d45701f357c56a0b72b7629` (`origin/main`).
- Isolated branch: `codex/ios-contact-handbook-v3`.
- Visual: `/Users/cubxxw/.codex/visualizations/2026/10/23/01a16924-2e50-78a2-b18f-c83a7415772c/ios-contact-handbook-v3.png`.
- Main checkout has unrelated untracked work; it is not a write target.
- Existing `.agent-pause` cites disk pressure. Initial resource snapshot:
  32.71 GiB disk, 11.63 GiB swap, 231 Node/npm processes. No new delegation,
  Simulator or native build before an explicit exception. On 2026-10-24 the user
  approved one controlled validation: one independent reviewer and serial
  use of one Primary iPhone; the pause marker remains unchanged.

## Milestones

1. [complete] Implement scoped, validated read models and minimal contact page.
2. [complete for unit/source; runtime pending] Verify wire scope, stale-response rejection, pagination, empty/failure
   recovery and real navigation with focused tests and independent review.
3. [active: hosted CI after local environment failure] Build and inspect the native primary-iPhone result against v3;
   record unresolved blockers truthfully, then deliver the clean source change.

## Completion evidence

A contact opens without resetting People search/scroll; the overview stays
minimal. Memory is read from scoped recall with evidence and is absent when
unavailable. A contextual conversation is an unsent draft. Opening a work item
shows its real Pursuit and stored status/time, without creating an action.
English/Chinese, Dynamic Type, light/dark, missing profile and multi-context
contacts remain usable. Retain screenshots and focused test receipts in the
permanent task evidence directory; clean only this task's rebuildable artifacts.

## Review and checks

- Independent read-only review found one P1 (Memory attribution/time semantics),
  and two P2s (source-read suspension fencing and Chinese Action labels). All
  three were fixed and the same reviewer confirmed closure, with no new P0/P1.
- Overview/list/detail now preserve source statement vs fact vs recorded view,
  speaker, future/past/unknown time and conflict boundaries.
- Swift syntax parsing, localization boundary, diff whitespace and docs checks
  passed. Native compilation and focused tests are in progress on the approved
  shared Primary iPhone; no second device or parallel Simulator session.
- Explicit DEBUG-only contact Memory fixtures require both the UI-test preview
  environment and a dedicated launch argument. They never recover a failed
  canonical read or populate a real account.

## Native result (2026-10-24)

- Final build-for-testing passed. Twelve PersonMemoryTests passed, with zero
  failures. The enclosing run was interrupted while the UI target was pending;
  it is not reported as an overall green test run.
- UI-only execution failed before a contact page opened: XCTDaemonErrorDomain
  Code 18, `Timed out waiting for AX loaded notification`. No UI scenario or
  screenshot is claimed as passing.
- A single data-preserving recovery used the same Primary iPhone. The test
  framework had already shut it down; bootstatus then waited on System App
  until the 180-second recovery bound. No erasure, new device, shared service
  restart or unrelated process termination was used.
- Native interaction/visual acceptance remains pending. Keep the delivery as a
  draft; do not merge or represent it as released. Native-only scope requires
  no backend/Web deployment.
- Permanent evidence: `/Users/cubxxw/.codex/visualizations/2026/10/23/01a16924-2e50-78a2-b18f-c83a7415772c/implementation-evidence`.
- Registered build products are retained at `/private/tmp/ai-test-ios-contact-handbook-v3.MIi5Cc` to resume acceptance without rebuilding. The isolated source worktree is retained until delivery/merge.

## Hosted CI continuation

The local session was released without removing the pause marker. The four
contact UI scenarios are now part of existing PR quick (19 journeys) and main
smoke (20 journeys) lists. The selector/count harness passed all six checks;
the same independent reviewer confirmed selectors and documentation counts.
Hosted macOS CI will provide native interaction and screenshot acceptance
without starting another local Simulator session. Keep the PR draft until the
relevant UI outcomes and screenshots are checked.

Successful hosted contact journeys now retain their screenshot attachments,
using exact result-part filenames alongside existing Agent settings evidence.
The independent reviewer confirmed export scope and retention; all 18 release
policy checks passed. Native-only presentation is frozen pending actual UI
results (ink navigation tint, localized evidence availability, and the
selected-person unsent-chat assertion are included).

The first hosted run on `aa162d5` passed the unit suite and preceding native
journeys, then failed to locate the Continue control in the contact overview.
The exported recording shows the entire control on screen. The next change
moves the page accessibility identifier before its safe-area inset, so it does
not wrap the inset control; the original hit-test assertion remains and now
captures a synthetic accessibility tree on failure. This is a hypothesis until
the hosted overview and unsent-conversation tests pass. The same reviewer
approved the narrow change and moving the four independent contact journeys
immediately after launch, without changing either tier's coverage or budget.
