# Agent capability assessment

## Outcome and boundary

Answer whether Talent Signal currently uses genuine Agent capabilities and
assess the design against implemented behavior. This is a read-only product
assessment; no runtime configuration, private evidence, or external effects
will be changed or exercised.

Snapshot: local working tree on 2026-09-06, based on
`a72d4e5f80da257451b2e7ba5441b94ee9655d7b`, with substantial pre-existing changes.
Those changes are preserved and included when reading current implementation.

## Approach

Distinguish model-selected tool use, deterministic workflows, deployment
admission, historical runtime evidence, and design targets. Trace concrete
user entry points through provider loops and governed state boundaries.
Prefer focused local tests; do not send candidate data or start paid model Runs.

## Milestones

1. Complete: inspect canonical Agent architecture and identify runtime paths.
2. Complete: trace user entry points, provider admission, memory, and recovery;
   verify focused deterministic behavior and available runtime metadata.
3. Complete: synthesize evidence-linked conclusions, limitations, and the
   smallest useful next investment; `pnpm docs:check` passed.

## Initial evidence and unknowns

- The tool catalog and provider loops are executable, not only design prose.
- Workspace conversation has a model-callable bounded contact workspace.
- Pursuit Runs default to a deterministic provider; remote admission must be
  inspected separately from conversation admission.
- Deployed feature admission is verified below; real-user outcomes remain
  unverified.
- No architecture change or additional authorization is required for this
  assessment. Product priorities would matter only for subsequent implementation.

## Completion evidence

The final answer separates observations, design judgments, recommendations,
and unknown deployment or outcome evidence, with exact repository references.
Record focused test results here before handoff.

## Verified observations

- Read-only metadata from `talent-signal-testflight-local-api-1`: remote Chat
  is enabled with Zhipu `glm-5.3`; Pursuit provider/model are unset, selecting
  the deterministic default; person research and sensitive AI processing are
  both false. `/health/ready` returned ready with migration
  `046_lab_feature_overrides`. The deployed compiled modules contain both the
  model tool loop and the deterministic named-contact path.
- [Conversation provider](../apps/backend/src/modules/chatAnswerProvider.ts)
  selects tools over bounded model turns, but explicit named relationship
  questions can search/read and terminate with zero model turns.
  [Unscoped Chat](../apps/backend/src/modules/unscopedChat.ts) still labels that
  result `agent_completed`; it is not proof of remote inference. The newer
  [Lab parity evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-05-lab-batch-task-parity/README.md)
  explicitly distinguishes local-only from remote attempts.
- [Pursuit Runs](../apps/backend/src/modules/agentRuns.ts) default to the
  deterministic provider. Remote Pursuit evidence admission is synthetic-only.
  [Scoped Chat](../apps/backend/src/modules/chat.ts) instead compiles up to 20
  Wiki blocks by fixed type priority and makes a bounded answer call.
- [Task lifecycle](../apps/backend/src/modules/agentTasks.ts) persists scope and
  terminal checkpoints, fenced attempts, review state, and domain receipts.
  Resolving the decision completes the Task; it does not resume deliberation.
  The iOS AgentTaskProjectionStore has no shipping UI caller in current source.
- [Local research](../apps/agent-host/README.md) has search/fetch/draft tools
  and restorable observations. This is a separate local capability, not proof
  that the current TestFlight Chat can conduct arbitrary research.
- [Claude adapter](../apps/agent/src/claudeProvider.ts) explicitly supplies
  empty agents and skills. Repository development Skills are not automatically
  loaded into this product runtime.

## Design judgment and recommendations

The model/evidence/effect separation is implemented through typed capabilities,
same-Run authorization, fingerprints, review-only proposals, and rejection
tests. The useful autonomy is narrower than the control-plane vocabulary.

Prioritize one measurable relationship task that can retrieve missing evidence,
ask a clarification, resume after the answer, and verify its outcome. Reuse
current domain decisions. Compare its usefulness, review effort, latency, and
cost with the existing bounded answer flow before broadening the runtime.

Secondary implementation gaps: conversation execution bypasses the shared
Pursuit runner and reports estimated cost as zero; budget and receipt semantics
are inconsistent across paths. The Claude adapter reports SDK `0.3.241` while
the package pins `0.3.251`, weakening version fingerprint accuracy. These are
observations for subsequent work, not fixes performed by this assessment.

## Verification results

- Agent package: 8 test files, 50 tests passed.
- Agent Host package: 8 test files, 23 tests passed.
- Focused backend: workspaceConversationAgent, chatAnswerProvider, agentRuns,
  agentHistory, and unscopedChat; 5 files, 51 tests passed.
- These are deterministic local checks; no new paid model trial, private
  candidate content, database mutation, or product UI walkthrough was used.
- Latest retained Lab parity proof uses a local deterministic upstream and
  explicitly does not claim external-model quality. Historical credentialed
  Claude trials exist, but do not prove current deployment outcomes.
- `pnpm docs:check` passed: documentation, published Wiki, and architecture
  checks. Scoped whitespace check passed. Assessment complete; no application
  code or runtime configuration changed.
