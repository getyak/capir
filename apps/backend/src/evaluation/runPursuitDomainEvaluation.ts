import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_VERSION,
  TalentSignalClient,
  TalentSignalHttpError,
  type PursuitMutationResponse,
} from "@talent-signal/contracts";

const baseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:4317";
const artifactDir =
  process.env.EVALUATION_ARTIFACT_DIR ??
  fileURLToPath(
    new URL(
      "../../../../output/evaluation/2026-08-24-v1-prd-01",
      import.meta.url,
    ),
  );

const alphaUserId = "10000000-0000-4000-8000-000000000011";
const betaUserId = "20000000-0000-4000-8000-000000000011";

function errorCode(result: PromiseSettledResult<unknown>): string | null {
  return result.status === "rejected" &&
    result.reason instanceof TalentSignalHttpError
    ? result.reason.code
    : null;
}

async function expectHttpError(
  operation: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert(error instanceof TalentSignalHttpError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

async function main(): Promise<void> {
  const runId = randomUUID();
  const alpha = new TalentSignalClient(baseUrl);
  const beta = new TalentSignalClient(baseUrl);
  const alphaSession = await alpha.login({
    account_slug: "fixture-alpha",
    user_email: "recruiter@alpha.local",
    client_label: "pursuit-domain-evaluation",
  });
  const betaSession = await beta.login({
    account_slug: "fixture-beta",
    user_email: "recruiter@beta.local",
    client_label: "pursuit-domain-evaluation",
  });

  assert.equal(alphaSession.user.id, alphaUserId);
  assert.equal(betaSession.user.id, betaUserId);

  const personCapture = await alpha.createCapture({
    idempotency_key: `${runId}:person:capture`,
    source: {
      kind: "transcript",
      channel: "api_connector",
      captured_at: "2026-08-24T10:42:00.000Z",
      source_timezone: "Asia/Shanghai",
      purpose: "Synthetic Pursuit role contract evaluation",
      source_locator: `synthetic:pursuit-domain:${runId}`,
      retention: {
        requested_mode: "ephemeral",
        source_scope: "reviewed_selected_text",
      },
    },
    identity: {
      status: "bound",
      external_ref: `synthetic:person:${runId}`,
      display_label: "Synthetic Zhou Yu",
      assignment_ref: `synthetic:assignment:${runId}`,
      assignment_label: "Synthetic relationship context",
      binding_basis: "Explicit synthetic evaluator fixture.",
    },
    messages: [
      {
        source_message_id: "m1",
        sequence: 0,
        speaker: "recruiter",
        text: "Synthetic context only; no candidate assertion is proposed.",
      },
    ],
  });
  assert(personCapture.subject_id);

  const recruitingRequest = {
    idempotency_key: `${runId}:recruiting:create`,
    type: "recruiting" as const,
    title: "VP Engineering · Acme",
    target_outcome: "accepted_offer",
    target_date: "2026-10-15",
    status: "active" as const,
    milestone: "interviewing",
    roles: [
      {
        subject_ref: {
          type: "person" as const,
          id: personCapture.subject_id,
        },
        role_type: "candidate",
        status: "active" as const,
        confidence: "confirmed" as const,
        basis_kind: "user_authored" as const,
        evidence_refs: [],
      },
    ],
    criteria: [
      {
        key: "role-outcomes",
        label: "Role outcomes",
        requirement: "The role scorecard names observable first-year outcomes.",
      },
    ],
    gaps: [
      {
        title: "Remote-work boundary is unresolved",
        basis: {
          kind: "user_authored" as const,
          summary: "The recruiter recorded an unresolved client policy question.",
          evidence_refs: [],
        },
        close_condition: "The accountable client owner records the policy answer.",
      },
    ],
    actions: [
      {
        title: "Prepare the client policy question",
        owner_user_id: alphaUserId,
        status: "drafted" as const,
        due_at: "2026-08-28T09:00:00.000Z",
      },
    ],
  };

  const created = await alpha.createPursuit(recruitingRequest);
  assert.equal(created.contract_version, CONTRACT_VERSION);
  assert.equal(created.pursuit.workspace_id, alphaSession.account.id);
  assert.equal(created.pursuit.revision, 1);
  assert.equal(created.pursuit.actions[0]?.owner_user_id, alphaUserId);
  assert.equal(created.pursuit.roles[0]?.role_type, "candidate");
  assert.deepEqual(created.pursuit.actions[0]?.external_effects, []);
  assert.equal(created.pursuit.gaps[0]?.basis.kind, "user_authored");
  assert.equal(created.receipt.status, "applied");
  assert.deepEqual(created.receipt.entity_ref, {
    type: "pursuit",
    id: created.pursuit.id,
    before_revision: 0,
    after_revision: 1,
  });

  const replayedCreate = await alpha.createPursuit(recruitingRequest);
  assert.equal(replayedCreate.pursuit.id, created.pursuit.id);
  assert.equal(replayedCreate.receipt.id, created.receipt.id);
  assert.equal(
    replayedCreate.receipt.operation_id,
    created.receipt.operation_id,
  );

  const operationReadback = await alpha.getOperation(
    created.receipt.operation_id,
  );
  assert.deepEqual(operationReadback.receipt, created.receipt);
  await expectHttpError(
    () => beta.getPursuit(created.pursuit.id),
    404,
    "PURSUIT_NOT_FOUND",
  );
  await expectHttpError(
    () => beta.getOperation(created.receipt.operation_id),
    404,
    "OPERATION_NOT_FOUND",
  );

  const revised = await alpha.revisePursuit(created.pursuit.id, {
    idempotency_key: `${runId}:recruiting:revision:2`,
    expected_revision: 1,
    reason: "The recruiter moved the search into shortlist review.",
    milestone: "shortlist_review",
  });
  assert.equal(revised.pursuit.revision, 2);
  assert.equal(revised.receipt.entity_ref.before_revision, 1);
  assert.equal(revised.receipt.entity_ref.after_revision, 2);
  assert.deepEqual(revised.receipt.changed_fields, ["milestone"]);

  const replayedRevision = await alpha.revisePursuit(
    created.pursuit.id,
    {
      idempotency_key: `${runId}:recruiting:revision:2`,
      expected_revision: 1,
      reason: "The recruiter moved the search into shortlist review.",
      milestone: "shortlist_review",
    },
  );
  assert.equal(replayedRevision.receipt.id, revised.receipt.id);
  assert.equal(replayedRevision.pursuit.revision, 2);

  const concurrentResults = await Promise.allSettled([
    alpha.revisePursuit(created.pursuit.id, {
      idempotency_key: `${runId}:recruiting:concurrent:a`,
      expected_revision: 2,
      reason: "Pause while the client revalidates the role.",
      status: "paused",
    }),
    alpha.revisePursuit(created.pursuit.id, {
      idempotency_key: `${runId}:recruiting:concurrent:b`,
      expected_revision: 2,
      reason: "Move the target date after client review.",
      target_date: "2026-10-22",
    }),
  ]);
  const applied = concurrentResults.filter(
    (item): item is PromiseFulfilledResult<PursuitMutationResponse> =>
      item.status === "fulfilled",
  );
  const conflicts = concurrentResults.filter(
    (item) => errorCode(item) === "PURSUIT_REVISION_CONFLICT",
  );
  assert.equal(applied.length, 1);
  assert.equal(conflicts.length, 1);
  assert.equal(applied[0]?.value.pursuit.revision, 3);

  await expectHttpError(
    () =>
      alpha.revisePursuit(created.pursuit.id, {
        idempotency_key: `${runId}:recruiting:stale`,
        expected_revision: 1,
        reason: "A stale client tries to overwrite the canonical state.",
        milestone: "stale_overwrite",
      }),
    409,
    "PURSUIT_REVISION_CONFLICT",
  );
  await expectHttpError(
    () =>
      alpha.createPursuit({
        ...recruitingRequest,
        idempotency_key: `${runId}:invalid-owner`,
        title: "Invalid cross-workspace owner",
        actions: [
          {
            title: "This must not persist",
            owner_user_id: betaUserId,
            status: "drafted",
          },
        ],
      }),
    422,
    "PURSUIT_ACTION_OWNER_SCOPE_INVALID",
  );
  await expectHttpError(
    () =>
      alpha.createPursuit({
        ...recruitingRequest,
        idempotency_key: `${runId}:missing-gap-evidence`,
        title: "Invalid unsupported gap",
        gaps: [
          {
            title: "Unsupported",
            basis: {
              kind: "evidence_supported",
              summary: "This incorrectly claims evidence support.",
              evidence_refs: [],
            },
            close_condition: "A reviewed source is attached.",
          },
        ],
      }),
    422,
    "PURSUIT_GAP_EVIDENCE_REQUIRED",
  );

  const sales = await alpha.createPursuit({
    idempotency_key: `${runId}:sales:create`,
    type: "sales",
    title: "Acme expansion",
    target_outcome: "signed_expansion",
    target_date: "2026-11-30",
    status: "active",
    milestone: "decision_review",
    roles: [
      {
        subject_ref: {
          type: "person",
          id: personCapture.subject_id,
        },
        role_type: "buyer",
        status: "active",
        confidence: "confirmed",
        basis_kind: "user_authored",
        evidence_refs: [],
      },
    ],
    criteria: [
      {
        key: "customer-outcome",
        label: "Customer outcome",
        requirement: "The customer-owned outcome is explicit.",
      },
    ],
  });
  assert.equal(sales.pursuit.type, "sales");
  assert.equal(sales.pursuit.criteria[0]?.key, "customer-outcome");
  assert.equal(
    sales.pursuit.roles[0]?.subject_ref.id,
    created.pursuit.roles[0]?.subject_ref.id,
  );
  assert.equal(sales.pursuit.roles[0]?.role_type, "buyer");

  const list = await alpha.listPursuits();
  assert.equal(list.workspace_id, alphaSession.account.id);
  assert(list.pursuits.some((item) => item.id === created.pursuit.id));
  assert(list.pursuits.some((item) => item.id === sales.pursuit.id));
  assert.equal(
    list.pursuits.filter((item) => item.id === created.pursuit.id).length,
    1,
  );
  const finalRecruiting = await alpha.getPursuit(created.pursuit.id);
  assert.equal(finalRecruiting.pursuit.revision, 3);
  const ownedAction = finalRecruiting.pursuit.actions[0];
  assert(ownedAction);
  const proposalSupersededByAction = await alpha.stagePursuitProposal(
    created.pursuit.id,
    {
      idempotency_key: `${runId}:recruiting:proposal:before-action`,
      capture_id: personCapture.id,
      base_revision: finalRecruiting.pursuit.revision,
      summary: "This proposal must not remain reviewable after the Pursuit changes.",
      producer: {
        kind: "human",
        name: "synthetic-pursuit-domain-evaluator",
        version: "1.0.0",
        run_id: `TS-V1-ACTION-SUPERSESSION-${runId}`,
      },
      items: [
        {
          item_key: "superseded-gap",
          basis_kind: "user_authored",
          epistemic_status: "unknown",
          evidence_refs: [],
          reason: "Exercise proposal authority after an independent action outcome.",
          effect_summary: "Would add one internal gap only after item review.",
          change: {
            kind: "add_gap",
            proposed_value: {
              title: "Synthetic proposal authority gap",
              basis_summary: "Synthetic user-authored evaluator input.",
              close_condition: "The evaluator observes canonical supersession.",
            },
          },
        },
      ],
    },
  );
  await expectHttpError(
    () =>
      alpha.completePursuitAction(created.pursuit.id, ownedAction.id, {
        operation_id: randomUUID(),
        idempotency_key: `${runId}:recruiting:action:stale`,
        expected_pursuit_revision: 1,
        expected_action_revision: ownedAction.revision,
        outcome_summary: "This stale outcome must not persist.",
      }),
    409,
    "PURSUIT_REVISION_CONFLICT",
  );
  const actionCompletionRequest = {
    operation_id: randomUUID(),
    idempotency_key: `${runId}:recruiting:action:complete`,
    expected_pursuit_revision: finalRecruiting.pursuit.revision,
    expected_action_revision: ownedAction.revision,
    outcome_summary:
      "The recruiter prepared the exact client policy question; client response is still pending.",
  };
  const completedAction = await alpha.completePursuitAction(
    created.pursuit.id,
    ownedAction.id,
    actionCompletionRequest,
  );
  const completedActionReadback = completedAction.pursuit.actions.find(
    (item) => item.id === ownedAction.id,
  );
  assert(completedActionReadback);
  assert.equal(completedAction.pursuit.revision, 4);
  assert.equal(completedActionReadback.status, "completed");
  assert.equal(completedActionReadback.revision, ownedAction.revision + 1);
  assert.equal(
    (await alpha.getPursuitProposal(proposalSupersededByAction.proposal.id))
      .proposal.status,
    "superseded",
  );
  assert.equal(
    (await alpha.listPursuitProposals()).proposals.some(
      ({ id }) => id === proposalSupersededByAction.proposal.id,
    ),
    false,
  );
  assert.equal(
    completedActionReadback.outcome_summary,
    actionCompletionRequest.outcome_summary,
  );
  assert(completedActionReadback.completed_at);
  assert.deepEqual(completedActionReadback.external_effects, []);
  assert.equal(completedAction.receipt.actor_user_id, alphaUserId);
  assert.equal(completedAction.receipt.entity_ref.before_revision, 3);
  assert.equal(completedAction.receipt.entity_ref.after_revision, 4);
  assert.deepEqual(completedAction.receipt.changed_fields, [
    `actions.${ownedAction.id}.status`,
    `actions.${ownedAction.id}.outcome_summary`,
  ]);
  assert.deepEqual(completedAction.receipt.external_effects, []);
  assert.equal(
    completedAction.receipt.operation_id,
    actionCompletionRequest.operation_id,
  );
  const replayedActionCompletion = await alpha.completePursuitAction(
    created.pursuit.id,
    ownedAction.id,
    actionCompletionRequest,
  );
  assert.equal(replayedActionCompletion.receipt.id, completedAction.receipt.id);
  assert.equal(replayedActionCompletion.pursuit.revision, 4);
  const actionOperationReadback = await alpha.getOperation(
    completedAction.receipt.operation_id,
  );
  assert.deepEqual(actionOperationReadback.receipt, completedAction.receipt);
  await expectHttpError(
    () =>
      alpha.completePursuitAction(created.pursuit.id, ownedAction.id, {
        ...actionCompletionRequest,
        idempotency_key: `${runId}:recruiting:action:reused-operation`,
        expected_pursuit_revision: completedAction.pursuit.revision,
        expected_action_revision: completedActionReadback.revision,
        outcome_summary: "A reused operation ID must not authorize a second mutation.",
      }),
    409,
    "OPERATION_ID_REUSED",
  );

  const artifact = {
    evidence_id: "TS-V1-PRD-01-RUNTIME-01",
    contract_version: CONTRACT_VERSION,
    environment: "fresh synthetic PostgreSQL account-scoped backend",
    requirements: [
      "V1-CRM-001",
      "V1-CRM-002",
      "V1-CRM-003",
      "V1-CRM-004",
      "V1-CRM-005",
      "V1-REV-003",
      "V1-REV-005",
      "V1-SEC-001",
      "V1-AGT-005",
    ],
    results: {
      recruiting_and_sales_share_contract: "pass",
      same_person_different_pursuit_roles: "pass",
      canonical_revision_readback: "pass",
      structured_receipt_readback: "pass",
      duplicate_create_same_entity_and_receipt: "pass",
      duplicate_revision_same_receipt: "pass",
      concurrent_revision_one_applied_one_conflict: "pass",
      stale_revision_conflict: "pass",
      cross_workspace_entity_read: "not_found",
      cross_workspace_operation_read: "not_found",
      cross_workspace_action_owner: "rejected",
      unsupported_gap_evidence_claim: "rejected",
      stale_action_completion: "rejected",
      owned_action_observed_outcome: "persisted_with_revisioned_readback",
      duplicate_action_completion_same_receipt: "pass",
      reused_action_operation_id: "rejected",
      action_revision_supersedes_open_proposal: "pass",
      external_effect_arrays: "empty",
    },
    recruiting: {
      created_revision: created.pursuit.revision,
      final_revision: completedAction.pursuit.revision,
      operation_receipt_readback: "same_structured_receipt",
      action_outcome_receipt_readback: "same_structured_receipt",
    },
    sales: {
      revision: sales.pursuit.revision,
      shared_schema: "pass",
    },
    limitations: [
      "This proves the backend Pursuit foundation, not the Proposal review state machine or iOS readback.",
      "All content and accounts are synthetic; no external effect is available.",
    ],
  };
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    `${artifactDir}/pursuit-domain-runtime.json`,
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Pursuit domain evaluation failed: ${error instanceof Error ? error.stack ?? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
