# capir conversation feedback

## Outcome and scope

After Send, Web and the embedded macOS conversation show a compact, truthful
assistant status in the transcript until a reply or recoverable failure appears.
The supplied screenshot is a visual reference, not authority to perform its
quoted task. Native iOS, broad rebranding, deployment, and external writes are
outside this task.

## Evidence and approach

- The user reports missing feedback/replies and a stiff presentation. Surface
  is confirmed as Web. The embedded macOS surface shares these components but
  is not separately accepted by this task.
- `QueuedConversation` renders accepted local messages without any processing
  status until a streamed active snapshot arrives.
- `useConversation.reconcile` removes local messages on active/queued snapshots
  before canonical history readback. An empty completion snapshot followed by
  delayed/failed detail readback can leave no transcript representation.
- Existing concurrent Web/macOS edits were frozen in the isolated baseline
  `ac17fe2843b14b9cab8a72fc46c1d3445b04c1e2`. Before integration, each affected
  source file was compared with that baseline. Only this task's conversation
  diff was applied; the user's existing edits and Git index were preserved.
- Pi implementation: `20261005-125348-fe825686`, MiMo Pro, conversation-only
  ownership. Evidence: `/Users/cubxxw/.local/state/pi-delegate/tasks/20261005-125348-fe825686`.
- Deployed Web is a separate release, `d9153b46`; local-source results do not
  establish a production fix. CLI-created isolated accounts were used rather
  than the user's daily account. After the initial native browser interaction
  failed, an in-app browser successfully sent one synthetic message. The reply
  arrived in four seconds and persisted after reload. Both isolated test runs
  were stopped and read back as `deleted`, with their credentials removed.
- An authenticated synthetic-account health read confirmed API/database/schema
  health and deployment revision only, not model or conversation health.
- First implementation passed 126 focused tests, but parent review found lost
  receipt resend on detail failure, unaccepted Stop intent treated as outcome,
  double-counted queue capacity, count-only image handoff, missing readback
  retention for reopened active runs, and transcript ordering gaps. A bounded
  Pi repair batch returned no usable repair and was cancelled. Parent fixes
  were verified against failing regressions before integration. A final
  regression also reproduced loss of preview text when preview/completion
  frames arrived in one network chunk; synchronous stream state fixes it.
- Actual `ConversationWorkRow` and its CSS rendered in a synthetic local browser
  harness. Light/dark and 390px layouts were inspected. Reduced-motion emulation
  returned animation `none`, and narrow layout had no horizontal overflow.
  Harness/component evidence is explicitly distinct from the authenticated Web
  journey. Browser overrides were reset after testing.
- Final source checks: 19 focused files / 136 tests passed, Web typecheck passed,
  scoped ESLint and documentation/architecture checks passed. Evidence and limits are recorded in the dated
  [evaluation](../docs/evaluations/2026-10-05-capir-message-feedback/README.md).
- Owned browser tabs and the local preview server were closed. The registered
  temporary test artifact was removed after preserving sanitized evidence.

## Milestones

1. [x] Inspect existing send, admission, stream, reconciliation and presentation.
2. [x] Reproduce feedback gaps with focused tests and implement complete states.
3. [x] Independently review and verify focused checks and rendered behavior.
4. [x] Integrate only this task's diff, preserve evidence, clean owned temporary
   resources, and report deployment/verification limits explicitly.

## Acceptance

No blank admission/readback handoff, duplicate bubbles, false running/success
claims, automatic resend of unknown delivery, or loss of source images/drafts.
Verify accepted waiting, live preview, queued/paused, reconnecting, failure and
final replacement. Check narrow/dark/reduced-motion presentation where rendered
verification is available. Preserve account/session fencing and exact-ID retry.
