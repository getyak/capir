# GET-262: readable work in the Session thread

## Outcome and scope

Keep the user's request, observed work and persisted results on the same
chronological reading axis. Within five seconds a reader should see the current
observed stage or the actual forming reply without opening a disclosure.
Preserve GET-251's quiet shell, GET-263's single current Stop, evidence placement,
queue ownership, failure/retry, stopped state and canonical readback authority.
No provider, account, backend or native protocol changes.

## Baseline and approach

- Isolated Symphony checkout: `GET-262`, branch `codex/get-262-session`.
- GitHub main readback: `0f6fe610466de2a14f089dea7675b7a222abe018`.
  Initial fetch is downloading the shallow checkout's missing history.
- Linear GET-251 is Done, canonical PR #454. No existing GET-262 PR found.
- Observed gap: live `preview.text` reaches `SessionExecutionCard.draft` but is
  rendered only inside closed execution details. With no preview, the main
  thread shows only a generic details link while the specific stage is hidden.
- Pause marker absent; initial disk 78.63 GiB, swap 6.89 GiB, 140 Node processes.
  Use one owned frontend listener, no Simulator or unrelated process cleanup.
- Render actual forming Markdown above diagnostics, explicitly unfinished.
  Without output, render only the observed stage (neutral phase fallback for an
  absent/unknown stage), never an invented assistant acknowledgement.
- Keep the final persisted semantic result standalone and remove live draft on
  readback. Unknown, failure and Stop retain existing recovery owners.

## Milestones

1. Host work complete: two focused tests reproduced the hidden-draft/missing-stage
   regressions, then all 3,495 Web tests across 379 files passed. Lint, Web types,
   documentation, Wiki and architecture checks passed. Full-product captures active.
2. Independent agent review; close confirmed findings and verify current head.
   Refresh main, open one linked PR, pass latest applicable CI, ordinary merge.
3. Serialize resident Web release after inspecting current revision/ownership.
   Build clean committed source, activate, verify live revision and behavior in
   the owned expiring test account, stop it and read back cleanup.
4. Update/read back Linear only after required acceptance. Save formal evidence,
   record Symphony generation/thread handoff and retain any incomplete boundary.

## Evidence and limits

Keep sanitized reports in `docs/verification/get-262/`; private credentials and
temporary browser state belong only in the registered task artifact. Host tests,
full browser snapshots, native host checks, independent review, CI, merge and
resident acceptance are separate evidence. Do not touch GET-282's uncommitted
checkout or other tasks' ports/data/releases. Linear field-notes endpoint returned
unavailable; native issue reads work.

## Verification updates

- Fresh shallow main fetch completed; GET-251 PR #454 is merged and its quiet
  shell remains unchanged. Initial broad history fetch was superseded by the
  successful bounded main fetch, not used as stale-main evidence.
- Frozen install succeeded with the unchanged lockfile and pinned pnpm 11.18.0
  after command-scoped registry transport recovery; no dependency edits.
- Independent read-only agent `review_get262` reviewed the four source/test
  changes and their producers/consumers; no P0/P1/P2 findings. Runtime acceptance
  remains separate.
- One owned expiring daily test run is ready, reused after CLI browser launch
  failed. Browser plugin also lacks its extension; an isolated installed Chrome
  context signed into that same run. Credentials remain only in private artifacts.
- Candidate browser forwarding through the HTTPS production origin could not
  connect development HMR; preserve this harness failure, never call it a native
  or production acceptance. No production listener was modified.

- Full candidate browser on task-owned port 3062, connected to the same expiring
  test run: observed inline queued state 2,913ms after Send, then actual unfinished
  streamed text 7,467ms into the second request, outside closed activity details.
  Earlier input/results remain in chronological order.
- Real Stop acceptance at 390px/dark/reduced motion: one Stop, three preserved
  user messages, one interrupted record and zero live draft rows after stop.
  320/390/1280px document widths equal viewport widths. Enter opens the stopped
  record; Escape closes it and actual focus remains on its summary. Reload keeps
  all three requests and terminal state. No additional provider requests followed
  Stop. These are local-candidate observations, not resident release acceptance.
- Main advanced to `7e8be8010334d8a3e2142f32c7518712ce941d00` (GET-275).
  Its changes do not overlap the four reviewed UI/test files; refresh this base
  before opening the PR and revalidate the shared Agent boundary and latest CI.
- A separate Debug macOS build uses a task-specific bundle ID for full native
  WebKit snapshots, preserving the installed client's profile. Native evidence
  remains pending; seven host appearance contracts pass.
