# Local Symphony delivery

Use a single explicitly selected Linear issue to verify the local automation
before enabling more work. The normal delivery gates still apply: a visible
session, a local commit, or a queued merge does not establish completion.

## Ownership and entry

The local Symphony registry maps a Linear workspace, team and project to a
repository and an application Project. Verify these identities before writing.
Only claim a ready Todo issue that is not already owned by another task.
Create an isolated checkout from fresh remote `main`; preserve the original
developer checkout and its uncommitted work.

An authenticated application driver creates one local Codex task and places it
in the mapped ChatGPT Project. Verify the resulting thread and project through
the supported application tools. This is an application-visible local task;
it does not imply a cloud ChatGPT conversation or visibility on the ChatGPT
website. The standalone Symphony process does not itself have those application
tools or permission to approve a native project-access prompt.

The Project directory and the issue checkout can differ. Every execution
instruction must name the isolated checkout, issue and ownership generation.
Do not start product work from the Project directory merely because a session
appears there. A missing project mapping or uncertain creation result requires
reconciliation; do not create another thread as a retry.

## One bounded execution

Keep the initial rollout at one active issue and one execution dispatch for its
current ownership generation. Persist the dispatch intent before sending the
application instruction. Keep its request identity, canonical thread, previous
turn, start time and deadline in the host-owned receipt outside the checkout.

A repeated dispatch, timeout or lost acknowledgment must not start a second
worker. A deadline stops further automatic dispatch and requests operator
attention. It is not a provider token limit and does not promise forced
interruption of an application turn that is still running. A blocked worker
must report the concrete reason, finish its turn and wait for an explicit
handoff instead of repeatedly summarizing the same blocker.

Pi and the configured MiMo model may implement a bounded batch initiated by the
user's active coding request. Keep the provider and model frozen in its task
contract, inspect its actual changes and verify them independently. Token Plan
credentials must not be installed in a scheduler, GitHub Actions or a product
backend. Failure does not authorize a silent switch to a paid API or an
unbounded retry.

## Delivery gates

1. Implement only the issue scope in its task branch. Run the affected tests;
   documentation changes also require `pnpm docs:check`. Preserve evidence.
2. Obtain an independent review of the actual commit. Resolve confirmed P0/P1
   findings and re-review changed code before opening the associated PR.
3. Wait for every applicable check on the latest PR head and satisfy repository
   protections. Recheck after a push; an older green run is insufficient.
4. Merge through the allowed normal method with a head guard. Read back the
   merged PR and its merge commit; a queued auto-merge is still pending.
5. Verify acceptance against the actual merge commit and issue criteria. Deploy
   and verify affected resident services when runtime changes require it. A
   documentation-only change does not introduce such a deployment requirement.
6. Pass the final live delivery gate, then update Linear and read back Done.
   Restore an unfinished issue if an integration closed it before acceptance.

The fixed host operations for review, merge, acceptance and final gating retain
their existing checks. An explicitly authorized, unexpired single-issue app
execution lease may permit that issue's review and acceptance while the legacy
fleet remains paused. It does not resume the fleet or grant arbitrary host
commands. Ordinary workers remain subject to the pause and ownership checks.

## Stop, inspect and recover

`In Review`, `Needs Human`, a local block and an application-owned receipt are
waiting states for the native scheduler. They must disappear from both polling
and refresh-by-ID results. The same bound issue and its comments remain readable
for handoff; stop does not grant permission to write another issue.

Inspect the service's `runtime/project-sessions/ISSUE_UUID.json`, its current
claim generation and the canonical application task before recovery. Keep
unknown or malformed receipts stopped. Preserve uncertain side effects and
reconcile them through destination readback rather than clearing their records.
Inactive handoffs may release the active application slot while retaining the
native execution hold.

The local `pause.local` and hard `model-pause.json` markers serve different
purposes. Ordinary resume cannot clear a hard model pause; service startup must
refuse it. Do not remove either marker to make a single demonstration run.

Terminate only processes owned by this run, using SIGTERM after checking their
identity. Do not force-kill a surviving or identity-unknown group. Preserve its
checkout and durable cleanup barrier so another writer cannot start against
the same repository until cleanup has been reconciled.

Retain a compact receipt linking the issue, thread, branch, reviewed head,
current CI, merged PR and acceptance evidence. Exclude credentials, signed
attachment URLs, raw conversations and machine-specific configuration. After
delivery, preserve the formal receipt before removing rebuildable test output
and an unused task checkout. Keep blocked work recoverable.
