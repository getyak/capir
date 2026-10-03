import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_VERSION,
  TalentSignalClient,
  TalentSignalHttpError,
  type ResourceCaptureRequest,
} from "@talent-signal/contracts";
import { Pool } from "pg";

const baseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:4317";
const artifactDir =
  process.env.EVALUATION_ARTIFACT_DIR ??
  fileURLToPath(
    new URL(
      "../../../../output/evaluation/2026-08-24-v1-prd-07",
      import.meta.url,
    ),
  );

type PersonScope = ResourceCaptureRequest["person_scope"];

function sourceRequest(
  runId: string,
  suffix: string,
  personScope: PersonScope,
  text: string,
  reviewStatus: "proposed" | "reviewed" = "reviewed",
): ResourceCaptureRequest {
  const clientResourceId = `pursuit-evidence:${runId}:${suffix}`;
  return {
    contract_version: CONTRACT_VERSION,
    idempotency_key: `${runId}:${suffix}:capture`,
    channel: "ios_share",
    purpose: "Synthetic evidence availability and identity integrity proof",
    captured_at: "2026-08-24T13:00:00.000Z",
    source_timezone: "Asia/Shanghai",
    person_scope: personScope,
    resource: {
      client_resource_id: clientResourceId,
      kind: "conversation_transcript",
      display_name: `Synthetic governed Signal ${suffix}`,
      media_type: "text/plain",
      observed_at: "2026-08-24T13:00:00.000Z",
      source_timezone: "Asia/Shanghai",
      source_locator: `synthetic:pursuit-evidence:${runId}:${suffix}`,
      retention: {
        requested_mode: "ephemeral",
        source_scope: "reviewed_selected_text",
      },
    },
    fragments: [
      {
        client_resource_id: clientResourceId,
        kind: "message",
        sequence: 0,
        text,
        locator: {
          kind: "message",
          source_message_id: `${suffix}-m1`,
          sequence: 0,
          speaker_side: "left",
        },
        attribution: { actor_kind: "candidate", status: "confirmed" },
        review_status: reviewStatus,
        parser: { name: "synthetic-prd07", version: "1.0.0" },
      },
    ],
  };
}

async function expectError(
  operation: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof TalentSignalHttpError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`Expected ${status} ${code}`);
}

async function assertDeletionCanaryAbsent(
  accountId: string,
  proposalId: string,
  canary: string,
): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for raw deletion-canary proof.");
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query<{
      proposal_content: boolean;
      item_content: boolean;
      operation_content: boolean;
      idempotency_content: boolean;
      audit_content: boolean;
      fragment_content: boolean;
    }>(
      `SELECT
         EXISTS(
           SELECT 1 FROM pursuit_proposals proposals
           WHERE proposals.account_id = $1 AND proposals.id = $2
             AND to_jsonb(proposals)::text LIKE '%' || $3 || '%'
         ) AS proposal_content,
         EXISTS(
           SELECT 1 FROM pursuit_proposal_items items
           WHERE items.account_id = $1 AND items.proposal_id = $2
             AND to_jsonb(items)::text LIKE '%' || $3 || '%'
         ) AS item_content,
         EXISTS(
           SELECT 1 FROM pursuit_operations operations
           WHERE operations.account_id = $1 AND operations.proposal_id = $2
             AND to_jsonb(operations)::text LIKE '%' || $3 || '%'
         ) AS operation_content,
         EXISTS(
           SELECT 1 FROM idempotency_records records
           WHERE records.account_id = $1
             AND records.operation_scope LIKE '%pursuit_proposal%'
             AND COALESCE(records.response_body::text, '')
               LIKE '%' || $3 || '%'
         ) AS idempotency_content,
         EXISTS(
           SELECT 1 FROM audit_events events
           WHERE events.account_id = $1
             AND events.entity_type = 'pursuit_proposal'
             AND events.entity_id = $2
             AND events.metadata::text LIKE '%' || $3 || '%'
         ) AS audit_content,
         EXISTS(
           SELECT 1
           FROM pursuit_proposal_item_evidence links
           JOIN evidence_fragments fragments
             ON fragments.account_id = links.account_id
            AND fragments.id = links.evidence_fragment_id
           WHERE links.account_id = $1
             AND links.proposal_item_id IN (
               SELECT id FROM pursuit_proposal_items
               WHERE account_id = $1 AND proposal_id = $2
             )
             AND COALESCE(fragments.text_content, '') LIKE '%' || $3 || '%'
         ) AS fragment_content`,
      [accountId, proposalId, canary],
    );
    const row = result.rows[0];
    assert(row);
    assert.deepEqual(row, {
      proposal_content: false,
      item_content: false,
      operation_content: false,
      idempotency_content: false,
      audit_content: false,
      fragment_content: false,
    });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const runId = randomUUID();
  const deletionCanary = `DELETE-CANARY-${runId}`;
  const alpha = new TalentSignalClient(baseUrl);
  const beta = new TalentSignalClient(baseUrl);
  const alphaLogin = await alpha.login({
    account_slug: "fixture-alpha",
    user_email: "recruiter@alpha.local",
    client_label: "pursuit-evidence-integrity-evaluation",
  });
  await beta.login({
    account_slug: "fixture-beta",
    user_email: "recruiter@beta.local",
    client_label: "pursuit-evidence-integrity-evaluation",
  });

  const first = await alpha.createResourceCapture(
    sourceRequest(
      runId,
      "first",
      {
        status: "new_person",
        display_label: "Synthetic evidence person",
        relationship_context: {
          status: "proposed",
          label: "Synthetic evidence search",
          purpose: "Verify source authority propagation",
          role: "Candidate",
        },
        binding_basis: "The evaluator explicitly creates a synthetic Person.",
      },
      `Tuesday works, but the exact time remains unresolved. ${deletionCanary}`,
    ),
  );
  assert.equal(first.identity.status, "bound");
  assert(first.identity.person_id);
  assert(first.identity.relationship_context_id);
  const firstDetail = await alpha.getRelationshipResource(first.resource.id);
  const firstEvidence = firstDetail.fragments[0];
  assert(firstEvidence);

  const second = await alpha.createResourceCapture(
    sourceRequest(
      runId,
      "second",
      {
        status: "confirmed",
        person_id: first.identity.person_id,
        relationship_context: {
          status: "existing",
          relationship_context_id: first.identity.relationship_context_id,
        },
        binding_basis: "The evaluator explicitly binds a second source to the same Person.",
      },
      "The candidate confirmed the role outcome remains relevant.",
    ),
  );
  const secondDetail = await alpha.getRelationshipResource(second.resource.id);
  const secondEvidence = secondDetail.fragments[0];
  assert(secondEvidence);

  const sameNameA = await alpha.createResourceCapture(
    sourceRequest(
      runId,
      "same-name-a",
      {
        status: "new_person",
        display_label: "Alex Chen",
        relationship_context: {
          status: "proposed",
          label: "Same-name search A",
          purpose: "Prove distinct identity A",
          role: "Candidate",
        },
        binding_basis: "Synthetic explicit creation of the first same-name Person.",
      },
      "Synthetic identity A evidence.",
    ),
  );
  const sameNameB = await alpha.createResourceCapture(
    sourceRequest(
      runId,
      "same-name-b",
      {
        status: "new_person",
        display_label: "Alex Chen",
        relationship_context: {
          status: "proposed",
          label: "Same-name search B",
          purpose: "Prove distinct identity B",
          role: "Candidate",
        },
        binding_basis: "Synthetic explicit creation of the second same-name Person.",
      },
      "Synthetic identity B evidence.",
    ),
  );
  assert(sameNameA.identity.person_id);
  assert(sameNameB.identity.person_id);
  assert.notEqual(sameNameA.identity.person_id, sameNameB.identity.person_id);

  const ambiguous = await alpha.createResourceCapture(
    sourceRequest(
      runId,
      "same-name-review",
      {
        status: "candidates",
        candidate_person_ids: [
          sameNameA.identity.person_id,
          sameNameB.identity.person_id,
        ],
        display_name_hint: "Alex Chen",
        reason: "The same display label is insufficient to choose a Person.",
      },
      "This source is intentionally ambiguous between two same-name people.",
      "proposed",
    ),
  );
  assert.equal(ambiguous.identity.status, "needs_review");
  assert.equal(ambiguous.identity.person_id, null);
  assert.equal(ambiguous.identity.candidate_person_ids.length, 2);

  const created = await alpha.createPursuit({
    idempotency_key: `${runId}:pursuit:create`,
    type: "recruiting",
    title: "Synthetic evidence-integrity search",
    target_outcome: "mutual_final_decision",
    target_date: "2026-10-30",
    status: "active",
    milestone: "evidence_review",
    roles: [
      {
        subject_ref: { type: "person", id: first.identity.person_id },
        role_type: "candidate",
        status: "active",
        confidence: "confirmed",
        basis_kind: "evidence_supported",
        evidence_refs: [firstEvidence.id, secondEvidence.id],
      },
      {
        subject_ref: { type: "person", id: sameNameA.identity.person_id },
        role_type: "candidate",
        status: "active",
        confidence: "confirmed",
        basis_kind: "user_authored",
        evidence_refs: [],
      },
      {
        subject_ref: { type: "person", id: sameNameB.identity.person_id },
        role_type: "candidate",
        status: "active",
        confidence: "confirmed",
        basis_kind: "user_authored",
        evidence_refs: [],
      },
    ],
    gaps: [
      {
        title: "Two-source dependency",
        basis: {
          kind: "evidence_supported",
          summary: "Two reviewed sources currently support this open question.",
          evidence_refs: [firstEvidence.id, secondEvidence.id],
        },
        close_condition: "The candidate records one current answer.",
      },
      {
        title: "Single-source scheduling dependency",
        basis: {
          kind: "evidence_supported",
          summary: "Only the first source supports this open question.",
          evidence_refs: [firstEvidence.id],
        },
        close_condition: "A new reviewed source records the exact time.",
      },
      {
        title: "Recruiter-authored calibration note",
        basis: {
          kind: "user_authored",
          summary: "The recruiter explicitly recorded this without claiming evidence support.",
          evidence_refs: [],
        },
        close_condition: "The recruiter removes or closes the note.",
      },
    ],
  });
  const preDelete = created.pursuit;
  assert.equal(preDelete.roles[0]?.evidence_state.availability, "available");
  assert.equal(preDelete.roles[1]?.basis.kind, "user_authored");
  assert(preDelete.roles[1]?.basis.attributed_by_user_id);
  assert.equal(preDelete.roles[1]?.evidence_state.availability, "not_required");
  assert.equal(preDelete.gaps[0]?.basis.evidence_state.availability, "available");
  assert.equal(preDelete.gaps[2]?.basis.evidence_state.availability, "not_required");

  const staged = await alpha.stagePursuitProposal(preDelete.id, {
    idempotency_key: `${runId}:proposal:stage`,
    capture_id: first.capture_id,
    base_revision: preDelete.revision,
    summary: `The first source may support a milestone change. ${deletionCanary}`,
    producer: {
      kind: "agent",
      name: "synthetic-prd07-proposal-worker",
      version: "1.0.0",
      run_id: runId,
    },
    items: [
      {
        item_key: "milestone",
        basis_kind: "evidence_supported",
        epistemic_status: "inference",
        evidence_refs: [firstEvidence.id],
        reason: `The candidate described a scheduling step. ${deletionCanary}`,
        effect_summary: `Would change only the Pursuit milestone after review. ${deletionCanary}`,
        change: {
          kind: "set_milestone",
          proposed_value: `scheduling_review_${deletionCanary}`,
        },
      },
    ],
  });
  assert.equal(staged.proposal.evidence_state.availability, "available");

  const deletionRequest = {
    idempotency_key: `${runId}:first:delete`,
    reason: "Verify Pursuit authority invalidation from a synthetic source deletion.",
  };
  const deletion = await alpha.deleteCapture(first.capture_id, deletionRequest);
  const replayedDeletion = await alpha.deleteCapture(
    first.capture_id,
    deletionRequest,
  );
  assert.equal(replayedDeletion.deletion_id, deletion.deletion_id);

  const postDelete = (await alpha.getPursuit(preDelete.id)).pursuit;
  assert.equal(postDelete.roles[0]?.evidence_state.availability, "partial");
  assert.equal(postDelete.roles[0]?.evidence_state.available_reference_count, 1);
  assert.equal(postDelete.roles[0]?.evidence_state.reference_count, 2);
  assert.equal(postDelete.gaps[0]?.basis.evidence_state.availability, "partial");
  assert.equal(postDelete.gaps[1]?.basis.evidence_state.availability, "unavailable");
  assert.equal(postDelete.gaps[2]?.basis.evidence_state.availability, "not_required");

  const postDeleteProposal = (
    await alpha.getPursuitProposal(staged.proposal.id)
  ).proposal;
  assert.equal(postDeleteProposal.status, "superseded");
  assert.equal(postDeleteProposal.evidence_state.availability, "unavailable");
  assert.equal(
    postDeleteProposal.items[0]?.evidence_state.availability,
    "unavailable",
  );
  assert.equal(
    postDeleteProposal.summary,
    "[source-derived Proposal content removed]",
  );
  assert.equal(postDeleteProposal.items[0]?.before_value, null);
  assert.deepEqual(postDeleteProposal.items[0]?.proposed_value, {
    content_removed: true,
  });
  assert.equal(
    postDeleteProposal.items[0]?.reason,
    "[source-derived Proposal reason removed]",
  );
  assert.equal(
    postDeleteProposal.items[0]?.effect_summary,
    "[source-derived Proposal effect removed]",
  );
  assert.equal(JSON.stringify(postDeleteProposal).includes(deletionCanary), false);
  await assertDeletionCanaryAbsent(
    alphaLogin.account.id,
    staged.proposal.id,
    deletionCanary,
  );
  assert.equal(
    (await alpha.listPursuitProposals()).proposals.some(
      (proposal) => proposal.id === staged.proposal.id,
    ),
    false,
  );
  await expectError(
    () =>
      alpha.reviewPursuitProposal(staged.proposal.id, {
        operation_id: randomUUID(),
        idempotency_key: `${runId}:proposal:review-after-delete`,
        base_revision: preDelete.revision,
        reason: "A superseded Proposal must remain non-reviewable.",
        decisions: [
          {
            item_id: staged.proposal.items[0]!.id,
            decision: "confirm",
          },
        ],
      }),
    409,
    "PURSUIT_PROPOSAL_NOT_REVIEWABLE",
  );

  const appliedMilestoneProposal = await alpha.stagePursuitProposal(
    preDelete.id,
    {
      idempotency_key: `${runId}:proposal:stage-applied-milestone`,
      capture_id: second.capture_id,
      base_revision: postDelete.revision,
      summary:
        "The surviving reviewed source supports a recruiter-confirmed milestone update.",
      producer: {
        kind: "agent",
        name: "synthetic-prd07-proposal-worker",
        version: "1.0.0",
        run_id: runId,
      },
      items: [
        {
          item_key: "applied-milestone",
          basis_kind: "evidence_supported",
          epistemic_status: "inference",
          evidence_refs: [secondEvidence.id],
          reason: "The surviving reviewed source supports this milestone.",
          effect_summary:
            "Would change only the Pursuit milestone after recruiter review.",
          change: {
            kind: "set_milestone",
            proposed_value: "candidate_outcome_review",
          },
        },
      ],
    },
  );
  const appliedMilestone = await alpha.reviewPursuitProposal(
    appliedMilestoneProposal.proposal.id,
    {
      operation_id: randomUUID(),
      idempotency_key: `${runId}:proposal:confirm-applied-milestone`,
      base_revision: postDelete.revision,
      reason:
        "The recruiter confirms the milestone while the supporting source is still available.",
      decisions: [
        {
          item_id: appliedMilestoneProposal.proposal.items[0]!.id,
          decision: "confirm",
        },
      ],
    },
  );
  assert.equal(appliedMilestone.proposal.status, "applied");
  assert.equal(appliedMilestone.pursuit.milestone, "candidate_outcome_review");
  assert.equal(appliedMilestone.pursuit.milestone_authority.kind, "evidence_supported");
  assert.equal(
    appliedMilestone.pursuit.milestone_authority.evidence_state.availability,
    "available",
  );
  assert.equal(
    appliedMilestone.pursuit.milestone_authority.proposal_id,
    appliedMilestoneProposal.proposal.id,
  );
  assert.equal(
    appliedMilestone.pursuit.milestone_authority.receipt_id,
    appliedMilestone.receipt.id,
  );

  const temporalPursuit = await alpha.createPursuit({
    idempotency_key: `${runId}:temporal-authority:create`,
    type: "recruiting",
    title: "Synthetic temporal-authority search",
    target_outcome: "mutual_final_decision",
    target_date: "2026-11-15",
    status: "active",
    milestone: "authority_a",
    roles: [
      {
        subject_ref: { type: "person", id: first.identity.person_id },
        role_type: "candidate",
        status: "active",
        confidence: "confirmed",
        basis_kind: "evidence_supported",
        evidence_refs: [secondEvidence.id],
      },
    ],
  });
  const temporalProposal = await alpha.stagePursuitProposal(
    temporalPursuit.pursuit.id,
    {
      idempotency_key: `${runId}:temporal-authority:proposal`,
      capture_id: second.capture_id,
      base_revision: temporalPursuit.pursuit.revision,
      summary: "The reviewed source may support authority B.",
      producer: {
        kind: "agent",
        name: "synthetic-temporal-authority-worker",
        version: "1.0.0",
        run_id: runId,
      },
      items: [
        {
          item_key: "temporal-milestone",
          basis_kind: "evidence_supported",
          epistemic_status: "inference",
          evidence_refs: [secondEvidence.id],
          reason: "The reviewed source names authority B.",
          effect_summary: "Would set only the temporal Pursuit milestone.",
          change: { kind: "set_milestone", proposed_value: "authority_b" },
        },
      ],
    },
  );
  const temporalApplied = await alpha.reviewPursuitProposal(
    temporalProposal.proposal.id,
    {
      operation_id: randomUUID(),
      idempotency_key: `${runId}:temporal-authority:apply-b`,
      base_revision: temporalPursuit.pursuit.revision,
      reason: "Apply the evidence-backed B value for temporal provenance proof.",
      decisions: [
        {
          item_id: temporalProposal.proposal.items[0]!.id,
          decision: "confirm",
        },
      ],
    },
  );
  assert.equal(temporalApplied.pursuit.milestone_authority.kind, "evidence_supported");
  const temporalDirectC = await alpha.revisePursuit(temporalPursuit.pursuit.id, {
    idempotency_key: `${runId}:temporal-authority:direct-c`,
    expected_revision: temporalApplied.pursuit.revision,
    reason: "The recruiter directly records a newer C state.",
    milestone: "authority_c",
  });
  const temporalDirectB = await alpha.revisePursuit(temporalPursuit.pursuit.id, {
    idempotency_key: `${runId}:temporal-authority:direct-b`,
    expected_revision: temporalDirectC.pursuit.revision,
    reason: "The recruiter directly restores B without reusing old evidence.",
    milestone: "authority_b",
  });
  assert.equal(temporalDirectB.pursuit.milestone, "authority_b");
  assert.equal(temporalDirectB.pursuit.milestone_authority.kind, "user_authored");
  assert.equal(temporalDirectB.pursuit.milestone_authority.proposal_id, null);
  assert.equal(
    temporalDirectB.pursuit.milestone_authority.receipt_id,
    temporalDirectB.receipt.id,
  );
  assert.equal(
    temporalDirectB.pursuit.milestone_authority.confirmed_by_user_id,
    temporalDirectB.receipt.actor_user_id,
  );

  const appliedSourceDeletion = await alpha.deleteCapture(second.capture_id, {
    idempotency_key: `${runId}:second:delete-after-milestone-apply`,
    reason:
      "Verify an applied evidence-backed milestone keeps value while exposing lost authority.",
  });
  const afterAppliedSourceDeletion = (
    await alpha.getPursuit(preDelete.id)
  ).pursuit;
  const afterAppliedSourceDeletionProposal = (
    await alpha.getPursuitProposal(appliedMilestoneProposal.proposal.id)
  ).proposal;
  assert.equal(afterAppliedSourceDeletion.milestone, "candidate_outcome_review");
  assert.equal(
    afterAppliedSourceDeletion.milestone_authority.kind,
    "evidence_supported",
  );
  assert.equal(
    afterAppliedSourceDeletion.milestone_authority.evidence_state.availability,
    "unavailable",
  );
  assert.equal(
    afterAppliedSourceDeletion.milestone_authority.confirmed_by_user_id,
    appliedMilestone.receipt.actor_user_id,
  );
  assert(appliedMilestone.pursuit.milestone_authority.confirmed_at);
  assert.equal(
    afterAppliedSourceDeletion.milestone_authority.receipt_id,
    appliedMilestone.receipt.id,
  );
  assert.equal(
    afterAppliedSourceDeletion.milestone_authority.proposal_id,
    appliedMilestoneProposal.proposal.id,
  );
  assert.equal(
    afterAppliedSourceDeletionProposal.summary,
    "[source-derived Proposal content removed]",
  );
  assert.deepEqual(
    afterAppliedSourceDeletionProposal.items[0]?.decision.decided_value,
    { content_removed: true },
  );
  const temporalAfterDeletion = (
    await alpha.getPursuit(temporalPursuit.pursuit.id)
  ).pursuit;
  assert.equal(temporalAfterDeletion.milestone, "authority_b");
  assert.equal(temporalAfterDeletion.milestone_authority.kind, "user_authored");
  assert.equal(temporalAfterDeletion.milestone_authority.proposal_id, null);
  assert.equal(
    temporalAfterDeletion.milestone_authority.receipt_id,
    temporalDirectB.receipt.id,
  );

  const lineage = await alpha.getDeletionLineage(deletion.deletion_id);
  const lineageTypes = new Set(lineage.lineage.map((entry) => entry.entity_type));
  assert(lineageTypes.has("pursuit_proposal"));
  assert(lineageTypes.has("pursuit_proposal_item"));
  assert(
    lineage.lineage
      .filter((entry) =>
        ["pursuit_proposal", "pursuit_proposal_item"].includes(
          entry.entity_type,
        ),
      )
      .every((entry) => entry.disposition === "content_removed"),
  );
  await expectError(
    () => beta.getDeletionLineage(deletion.deletion_id),
    404,
    "DELETION_NOT_FOUND",
  );
  await expectError(
    () => beta.getPursuit(preDelete.id),
    404,
    "PURSUIT_NOT_FOUND",
  );

  const todayProjection = {
    eyebrow:
      postDelete.gaps[0]?.basis.evidence_state.availability === "partial"
        ? "Evidence partly unavailable"
        : "invalid",
    evidence_backed: false,
    available_reference_count:
      postDelete.gaps[0]?.basis.evidence_state.available_reference_count,
    reference_count: postDelete.gaps[0]?.basis.evidence_state.reference_count,
  };
  assert.equal(todayProjection.eyebrow, "Evidence partly unavailable");
  assert.equal(todayProjection.evidence_backed, false);

  const artifact = {
    schema_version: "talent-signal.v1-prd-07-runtime.1",
    artifact_id: "TS-V1-PRD-07-RUNTIME-01",
    generated_at: "2026-08-24T13:30:00.000Z",
    data_classification: "synthetic_only",
    contract_version: CONTRACT_VERSION,
    verdict: "pass",
    checks: {
      confirmed_role_has_reviewed_evidence_or_user_attribution: true,
      epistemic_proposal_state_remains_explicit: true,
      same_name_people_remain_distinct: true,
      same_name_capture_enters_identity_review: true,
      pre_delete_authority_available: true,
      post_delete_role_authority_partial: true,
      post_delete_gap_authority_partial_and_unavailable: true,
      user_authored_gap_not_rewritten: true,
      open_proposal_superseded: true,
      superseded_proposal_not_reviewable: true,
      today_projection_does_not_claim_evidence_backed: true,
      applied_milestone_authority_available_before_source_delete: true,
      applied_milestone_value_preserved_after_source_delete: true,
      applied_milestone_authority_unavailable_after_source_delete: true,
      applied_milestone_keeps_confirmer_time_proposal_and_receipt: true,
      source_derived_proposal_content_redacted_after_deletion: true,
      deletion_canary_absent_from_api_and_operational_stores: true,
      milestone_authority_follows_latest_mutation_not_value_equality: true,
      deletion_retry_is_idempotent: true,
      lineage_includes_pursuit_proposal_and_item: true,
      cross_workspace_pursuit_and_lineage_hidden: true,
    },
    identity_review: {
      resolution_case_id: ambiguous.identity.resolution_case_id,
      candidate_person_ids: ambiguous.identity.candidate_person_ids,
    },
    pre_delete: {
      pursuit: preDelete,
      proposal: staged.proposal,
    },
    post_delete: {
      pursuit: postDelete,
      proposal: postDeleteProposal,
      today_projection: todayProjection,
      deletion,
      lineage_types: [...lineageTypes].sort(),
    },
    applied_milestone_source_deletion: {
      proposal: appliedMilestone.proposal,
      applied_receipt: appliedMilestone.receipt,
      authority_before_delete: appliedMilestone.pursuit.milestone_authority,
      authority_after_delete:
        afterAppliedSourceDeletion.milestone_authority,
      redacted_proposal_after_delete: afterAppliedSourceDeletionProposal,
      deletion: appliedSourceDeletion,
    },
    temporal_milestone_authority: {
      evidence_backed_b: temporalApplied.pursuit.milestone_authority,
      direct_c: temporalDirectC.pursuit.milestone_authority,
      direct_b: temporalDirectB.pursuit.milestone_authority,
      after_old_source_deletion: temporalAfterDeletion.milestone_authority,
    },
    missing_proof: [
      "physical-device relaunch across an authenticated workspace switch",
      "real candidate data retention and privacy operations",
    ],
  };
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    `${artifactDir}/pursuit-evidence-integrity-runtime.json`,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const details =
    error instanceof TalentSignalHttpError
      ? `\n${JSON.stringify(
          { status: error.status, code: error.code, details: error.details },
          null,
          2,
        )}`
      : "";
  process.stderr.write(
    `Pursuit evidence integrity evaluation failed: ${
      error instanceof Error ? error.stack ?? error.message : "unknown error"
    }${details}\n`,
  );
  process.exitCode = 1;
});
