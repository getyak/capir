import { randomUUID } from "node:crypto";

import {
  SOURCE_RETENTION_POLICY_VERSION,
  type CaptureSourceInput,
  type CreateCaptureRequest,
  type SourceRetentionReceipt,
  type SourceRetentionRequest,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import type { AuthContext } from "./auth.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
export const EVIDENCE_CROP_MAX_RETENTION_DAYS = 30;
export const FULL_SOURCE_MAX_RETENTION_DAYS = 7;

type SourceAccessState = SourceRetentionReceipt["source_access"]["state"];
type SourceAccessReason = SourceRetentionReceipt["source_access"]["reason"];
type RetentionEvent =
  SourceRetentionReceipt["lineage"][number]["event_type"];
type RetentionEventReason =
  SourceRetentionReceipt["lineage"][number]["reason"];
type RetentionDerivativeDisposition =
  SourceRetentionReceipt["derivative_lineage"][number]["disposition"];

interface RetentionDerivative {
  entity_type: string;
  entity_id: string;
  disposition: RetentionDerivativeDisposition;
}

export interface ResolvedSourceRetentionPolicy {
  requestedMode: SourceRetentionRequest["requested_mode"];
  effectiveMode: SourceRetentionRequest["requested_mode"];
  sourceScope: SourceRetentionRequest["source_scope"];
  requestedRetentionUntil: Date | null;
  retentionUntil: Date | null;
  sourceAccessReason: SourceAccessReason;
}

interface RetentionRow {
  receipt_id: string;
  account_id: string;
  capture_id: string;
  policy_version: typeof SOURCE_RETENTION_POLICY_VERSION;
  requested_mode: SourceRetentionReceipt["requested_policy"]["mode"];
  effective_mode: SourceRetentionReceipt["effective_policy"]["mode"];
  source_scope: SourceRetentionReceipt["effective_policy"]["source_scope"];
  requested_retention_until: Date | null;
  retention_until: Date | null;
  source_access_state: SourceAccessState;
  source_access_reason: SourceAccessReason;
  authorization_state:
    SourceRetentionReceipt["source_authorization"]["state"];
  authorization_reason:
    SourceRetentionReceipt["source_authorization"]["reason"];
  authorization_changed_at: Date;
  authorization_expires_at: Date | null;
  review_completion_event:
    | "analysis_proposal_committed"
    | "resource_intake_committed"
    | null;
  review_completed_at: Date | null;
  source_purged_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
}

function invalidPolicy(code: string, message: string): never {
  throw new ApiError(422, code, message);
}

export function validateSourceRetentionPayload(
  request: CreateCaptureRequest,
): void {
  const { kind, retention } = request.source;
  const singleAtomicMessage =
    request.messages.length === 1 &&
    request.messages[0]?.sequence === 0;

  if (
    retention.source_scope === "reviewed_selected_text" &&
    (kind !== "transcript" || !singleAtomicMessage)
  ) {
    invalidPolicy(
      "SOURCE_SCOPE_PAYLOAD_MISMATCH",
      "Reviewed selected text requires one atomic transcript message.",
    );
  }
  if (
    retention.source_scope === "reviewed_extracted_text" &&
    kind !== "screenshot_metadata"
  ) {
    invalidPolicy(
      "SOURCE_SCOPE_PAYLOAD_MISMATCH",
      "Reviewed extracted text requires screenshot-derived source metadata.",
    );
  }
  if (
    retention.source_scope === "reviewed_evidence_crop"
  ) {
    invalidPolicy(
      "SOURCE_SCOPE_PAYLOAD_MISMATCH",
      "Reviewed evidence-crop retention is unavailable until the backend governs the actual crop asset.",
    );
  }
}

export function resolveSourceRetentionPolicy(
  request: SourceRetentionRequest,
  submittedAt = new Date(),
  sourceKind?: CaptureSourceInput["kind"],
): ResolvedSourceRetentionPolicy {
  if (
    request.requested_mode === "full_source" &&
    sourceKind !== "fixture"
  ) {
    invalidPolicy(
      "FULL_SOURCE_TRANSPORT_UNSUPPORTED",
      "This transport cannot prove that the backend received the complete reviewed source.",
    );
  }
  if (
    request.requested_mode === "full_source" &&
    request.source_scope !== "full_reviewed_source"
  ) {
    invalidPolicy(
      "FULL_SOURCE_SCOPE_REQUIRED",
      "Full-source retention requires a complete reviewed source payload.",
    );
  }
  if (
    request.requested_mode === "evidence_crop" &&
    request.source_scope === "full_reviewed_source"
  ) {
    invalidPolicy(
      "EVIDENCE_CROP_SCOPE_REQUIRED",
      "Evidence-crop retention accepts only the final reviewed crop or selection.",
    );
  }
  if (
    request.requested_mode === "ephemeral" &&
    request.requested_retention_until !== undefined
  ) {
    invalidPolicy(
      "EPHEMERAL_DEADLINE_NOT_ALLOWED",
      "Ephemeral source is purged when the analysis proposal commits, not at a caller-selected deadline.",
    );
  }

  const requestedRetentionUntil = request.requested_retention_until
    ? new Date(request.requested_retention_until)
    : null;
  if (
    requestedRetentionUntil &&
    (!Number.isFinite(requestedRetentionUntil.getTime()) ||
      requestedRetentionUntil <= submittedAt)
  ) {
    invalidPolicy(
      "RETENTION_DEADLINE_INVALID",
      "A requested retention deadline must be a valid future timestamp.",
    );
  }

  if (request.requested_mode === "ephemeral") {
    return {
      requestedMode: request.requested_mode,
      effectiveMode: request.requested_mode,
      sourceScope: request.source_scope,
      requestedRetentionUntil: null,
      retentionUntil: null,
      sourceAccessReason: "awaiting_review_completion",
    };
  }

  const maximumDays =
    request.requested_mode === "evidence_crop"
      ? EVIDENCE_CROP_MAX_RETENTION_DAYS
      : FULL_SOURCE_MAX_RETENTION_DAYS;
  const maximum = new Date(submittedAt.getTime() + maximumDays * DAY_MS);
  const retentionUntil =
    requestedRetentionUntil && requestedRetentionUntil < maximum
      ? requestedRetentionUntil
      : maximum;
  return {
    requestedMode: request.requested_mode,
    effectiveMode: request.requested_mode,
    sourceScope: request.source_scope,
    requestedRetentionUntil,
    retentionUntil,
    sourceAccessReason: "retained_until_deadline",
  };
}

async function appendRetentionEvent(
  client: PoolClient,
  row: Pick<RetentionRow, "account_id" | "receipt_id" | "capture_id">,
  eventType: RetentionEvent,
  reason: RetentionEventReason,
  occurredAt: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO source_retention_events(
       id, account_id, receipt_id, capture_id, event_type, reason, occurred_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (account_id, receipt_id, event_type) DO NOTHING`,
    [
      randomUUID(),
      row.account_id,
      row.receipt_id,
      row.capture_id,
      eventType,
      reason,
      occurredAt,
    ],
  );
}

export async function createSourceRetentionRecord(
  client: PoolClient,
  input: {
    accountId: string;
    captureId: string;
    sourceLocator: string | null;
    policy: ResolvedSourceRetentionPolicy;
    submittedAt: Date;
    authorizationExpiresAt?: string | null;
    reviewCompletionEvent?:
      | "analysis_proposal_committed"
      | "resource_intake_committed";
  },
): Promise<void> {
  const {
    accountId,
    captureId,
    sourceLocator,
    policy,
    submittedAt,
    authorizationExpiresAt: authorizationExpiresAtInput = null,
    reviewCompletionEvent = "analysis_proposal_committed",
  } = input;
  const authorizationExpiresAt = authorizationExpiresAtInput
    ? new Date(authorizationExpiresAtInput)
    : null;
  if (
    authorizationExpiresAt &&
    (!Number.isFinite(authorizationExpiresAt.getTime()) ||
      authorizationExpiresAt <= submittedAt)
  ) {
    invalidPolicy(
      "SOURCE_AUTHORIZATION_EXPIRY_INVALID",
      "A source-authorization deadline must be a valid future timestamp.",
    );
  }
  await client.query(
    `INSERT INTO source_retention_receipts(
       receipt_id, account_id, capture_id, policy_version, requested_mode,
       effective_mode, source_scope, source_locator,
       requested_retention_until, retention_until, source_access_state,
       source_access_reason, review_completion_event,
       authorization_expires_at, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'available', $11, $12,
       $13, $14, $14
     )`,
    [
      captureId,
      accountId,
      captureId,
      SOURCE_RETENTION_POLICY_VERSION,
      policy.requestedMode,
      policy.effectiveMode,
      policy.sourceScope,
      sourceLocator,
      policy.requestedRetentionUntil,
      policy.retentionUntil,
      policy.sourceAccessReason,
      reviewCompletionEvent,
      authorizationExpiresAt,
      submittedAt,
    ],
  );
  await appendRetentionEvent(
    client,
    {
      account_id: accountId,
      receipt_id: captureId,
      capture_id: captureId,
    },
    "source_submitted",
    "capture_submitted",
    submittedAt,
  );
}

async function retentionRow(
  client: PoolClient,
  accountId: string,
  captureId: string,
  lock = false,
): Promise<RetentionRow> {
  const result = await client.query<RetentionRow>(
    `SELECT
       receipt_id, account_id, capture_id, policy_version, requested_mode,
       effective_mode, source_scope, requested_retention_until,
       retention_until, source_access_state, source_access_reason,
       authorization_state, authorization_reason,
       authorization_changed_at, authorization_expires_at,
       review_completion_event,
       review_completed_at, source_purged_at, deleted_at, created_at
     FROM source_retention_receipts
     WHERE account_id = $1 AND capture_id = $2
     ${lock ? "FOR UPDATE" : ""}`,
    [accountId, captureId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      404,
      "RETENTION_RECEIPT_NOT_FOUND",
      "The source-retention receipt was not found.",
    );
  }
  return row;
}

async function collectRetentionDerivatives(
  client: PoolClient,
  row: RetentionRow,
): Promise<RetentionDerivative[]> {
  const result = await client.query<RetentionDerivative>(
    `WITH affected_fragments AS (
       SELECT id
       FROM evidence_fragments
       WHERE account_id = $1 AND capture_id = $2
     ),
     affected_roles AS (
       SELECT DISTINCT roles.id
       FROM pursuit_roles roles
       JOIN pursuit_role_evidence evidence
         ON evidence.account_id = roles.account_id
        AND evidence.role_id = roles.id
       WHERE evidence.account_id = $1
         AND evidence.evidence_fragment_id IN (
           SELECT id FROM affected_fragments
         )
     ),
     affected_proposals AS (
       SELECT DISTINCT proposals.id
       FROM pursuit_proposals proposals
       LEFT JOIN pursuit_proposal_items items
         ON items.account_id = proposals.account_id
        AND items.proposal_id = proposals.id
       LEFT JOIN pursuit_proposal_item_evidence evidence
         ON evidence.account_id = items.account_id
        AND evidence.proposal_item_id = items.id
       WHERE proposals.account_id = $1
         AND (
           proposals.capture_id = $2
           OR evidence.evidence_fragment_id IN (
             SELECT id FROM affected_fragments
           )
         )
     ),
     affected_proposal_items AS (
       SELECT items.id
       FROM pursuit_proposal_items items
       WHERE items.account_id = $1
         AND items.proposal_id IN (SELECT id FROM affected_proposals)
     ),
     affected_tasks AS (
       SELECT id, idempotency_record_id
       FROM agent_tasks
       WHERE account_id = $1 AND capture_id = $2
     ),
     affected_runs AS (
       SELECT id, idempotency_record_id
       FROM agent_runs
       WHERE account_id = $1 AND capture_id = $2
     ),
     affected_artifacts AS (
       SELECT id
       FROM agent_artifacts
       WHERE account_id = $1
         AND task_id IN (SELECT id FROM affected_tasks)
     ),
     affected_bundles AS (
       SELECT id
       FROM agent_decision_bundles
       WHERE account_id = $1
         AND task_id IN (SELECT id FROM affected_tasks)
     ),
     inventory AS (
       SELECT 'capture'::text AS entity_type,
              captures.id AS entity_id,
              'access_revoked'::text AS disposition
       FROM captures
       WHERE captures.account_id = $1 AND captures.id = $2
       UNION ALL
       SELECT 'subject', captures.subject_id, 'confirmed_state_retained'
       FROM captures
       WHERE captures.account_id = $1
         AND captures.id = $2
         AND captures.subject_id IS NOT NULL
       UNION ALL
       SELECT 'assignment', captures.assignment_id, 'confirmed_state_retained'
       FROM captures
       WHERE captures.account_id = $1
         AND captures.id = $2
         AND captures.assignment_id IS NOT NULL
       UNION ALL
       SELECT 'source_resource', resources.id, 'content_purged'
       FROM source_resources resources
       WHERE resources.account_id = $1 AND resources.capture_id = $2
       UNION ALL
       SELECT 'reviewed_person_public_profile', profiles.subject_id,
              'content_purged'
       FROM reviewed_person_public_profiles profiles
       JOIN source_resources resources
         ON resources.account_id = profiles.account_id
        AND resources.id = profiles.source_resource_id
       WHERE resources.account_id = $1 AND resources.capture_id = $2
       UNION ALL
       SELECT 'evidence_fragment', fragments.id, 'content_purged'
       FROM evidence_fragments fragments
       WHERE fragments.account_id = $1 AND fragments.capture_id = $2
       UNION ALL
       SELECT 'evidence_fragment_review', reviews.id, 'audit_reference_retained'
       FROM evidence_fragment_reviews reviews
       JOIN evidence_fragments fragments
         ON fragments.account_id = reviews.account_id
        AND fragments.id = reviews.fragment_id
       WHERE fragments.account_id = $1 AND fragments.capture_id = $2
       UNION ALL
       SELECT 'analysis_proposal', proposals.id, 'content_purged'
       FROM analysis_proposals proposals
       WHERE proposals.account_id = $1 AND proposals.capture_id = $2
       UNION ALL
       SELECT 'assertion_proposal', assertions.id,
              CASE
                WHEN assertions.review_status = 'confirmed'
                  THEN 'confirmed_state_retained'
                ELSE 'content_purged'
              END
       FROM proposed_assertions assertions
       WHERE assertions.account_id = $1 AND assertions.capture_id = $2
       UNION ALL
       SELECT 'fact_decision', decisions.id, 'audit_reference_retained'
       FROM fact_decisions decisions
       JOIN proposed_assertions assertions
         ON assertions.account_id = decisions.account_id
        AND assertions.id = decisions.assertion_id
       WHERE assertions.account_id = $1 AND assertions.capture_id = $2
       UNION ALL
       SELECT 'confirmed_state', states.id, 'confirmed_state_retained'
       FROM confirmed_states states
       JOIN proposed_assertions assertions
         ON assertions.account_id = states.account_id
        AND assertions.id = states.source_assertion_id
       WHERE assertions.account_id = $1 AND assertions.capture_id = $2
       UNION ALL
       SELECT 'pursuit_role', id, 'confirmed_state_retained'
       FROM affected_roles
       UNION ALL
       SELECT 'pursuit_role_evidence_registry', id, 'access_revoked'
       FROM affected_roles
       UNION ALL
       SELECT 'pursuit_proposal', id, 'content_purged'
       FROM affected_proposals
       UNION ALL
       SELECT 'pursuit_proposal_item', id, 'content_purged'
       FROM affected_proposal_items
       UNION ALL
       SELECT DISTINCT 'pursuit_proposal_item_evidence_registry',
              evidence.proposal_item_id, 'access_revoked'
       FROM pursuit_proposal_item_evidence evidence
       WHERE evidence.account_id = $1
         AND evidence.proposal_item_id IN (
           SELECT id FROM affected_proposal_items
         )
       UNION ALL
       SELECT 'pursuit_operation_audit_reference', operations.id,
              'audit_reference_retained'
       FROM pursuit_operations operations
       WHERE operations.account_id = $1
         AND operations.proposal_id IN (SELECT id FROM affected_proposals)
       UNION ALL
       SELECT 'pursuit_receipt_audit_reference', receipts.id,
              'confirmed_state_retained'
       FROM pursuit_receipts receipts
       WHERE receipts.account_id = $1
         AND receipts.proposal_id IN (SELECT id FROM affected_proposals)
       UNION ALL
       SELECT 'agent_task', id, 'content_purged'
       FROM affected_tasks
       UNION ALL
       SELECT 'agent_task_run', task_runs.id, 'audit_reference_retained'
       FROM agent_task_runs task_runs
       WHERE task_runs.account_id = $1
         AND task_runs.task_id IN (SELECT id FROM affected_tasks)
       UNION ALL
       SELECT 'agent_task_checkpoint', checkpoints.id, 'content_purged'
       FROM agent_task_checkpoints checkpoints
       WHERE checkpoints.account_id = $1
         AND checkpoints.task_id IN (SELECT id FROM affected_tasks)
       UNION ALL
       SELECT 'agent_artifact', id, 'content_purged'
       FROM affected_artifacts
       UNION ALL
       SELECT DISTINCT 'agent_artifact_evidence_registry',
              evidence.artifact_id, 'access_revoked'
       FROM agent_artifact_evidence evidence
       WHERE evidence.account_id = $1
         AND evidence.artifact_id IN (SELECT id FROM affected_artifacts)
       UNION ALL
       SELECT 'agent_clarification_request', requests.id, 'content_purged'
       FROM agent_clarification_requests requests
       WHERE requests.account_id = $1
         AND requests.task_id IN (SELECT id FROM affected_tasks)
       UNION ALL
       SELECT 'agent_decision_bundle', id, 'content_purged'
       FROM affected_bundles
       UNION ALL
       SELECT 'agent_decision_item', items.id, 'access_revoked'
       FROM agent_decision_items items
       WHERE items.account_id = $1
         AND items.bundle_id IN (SELECT id FROM affected_bundles)
       UNION ALL
       SELECT 'agent_task_event', events.event_id, 'content_purged'
       FROM agent_task_events events
       WHERE events.account_id = $1
         AND events.task_id IN (SELECT id FROM affected_tasks)
       UNION ALL
       SELECT DISTINCT 'agent_delivery_outbox_registry', outbox.event_id,
              'content_purged'
       FROM agent_delivery_outbox outbox
       WHERE outbox.account_id = $1
         AND outbox.task_id IN (SELECT id FROM affected_tasks)
       UNION ALL
       SELECT 'agent_run', id, 'content_purged'
       FROM affected_runs
       UNION ALL
       SELECT DISTINCT 'agent_run_evidence_registry', evidence.run_id,
              'access_revoked'
       FROM agent_run_evidence evidence
       WHERE evidence.account_id = $1
         AND evidence.run_id IN (SELECT id FROM affected_runs)
       UNION ALL
       SELECT DISTINCT 'agent_run_event_registry', events.run_id,
              'audit_reference_retained'
       FROM agent_run_events events
       WHERE events.account_id = $1
         AND events.run_id IN (SELECT id FROM affected_runs)
       UNION ALL
       SELECT 'agent_tool_call', calls.id, 'audit_reference_retained'
       FROM agent_tool_calls calls
       WHERE calls.account_id = $1
         AND calls.run_id IN (SELECT id FROM affected_runs)
       UNION ALL
       SELECT 'agent_run_output', outputs.id, 'content_purged'
       FROM agent_run_outputs outputs
       WHERE outputs.account_id = $1
         AND outputs.run_id IN (SELECT id FROM affected_runs)
       UNION ALL
       SELECT 'agent_no_action', no_actions.id, 'content_purged'
       FROM agent_no_actions no_actions
       WHERE no_actions.account_id = $1
         AND no_actions.run_id IN (SELECT id FROM affected_runs)
       UNION ALL
       SELECT 'idempotency_record', records.id, 'content_purged'
       FROM idempotency_records records
       WHERE records.account_id = $1
         AND (
           records.id IN (
             SELECT idempotency_record_id FROM affected_tasks
             UNION
             SELECT idempotency_record_id FROM affected_runs
           )
           OR (
             records.operation_scope IN (
               'create_resource_capture', 'create_capture'
             )
             AND COALESCE(
               records.response_body->>'capture_id',
               records.response_body->>'id'
             ) = $2::text
           )
           OR (
             (
               records.operation_scope LIKE 'stage_pursuit_proposal:%'
               OR records.operation_scope LIKE 'review_pursuit_proposal:%'
             )
             AND records.response_body->'proposal'->>'id' IN (
               SELECT id::text FROM affected_proposals
             )
           )
         )
     )
     SELECT DISTINCT entity_type, entity_id,
            disposition::text AS disposition
     FROM inventory
     WHERE entity_id IS NOT NULL
     ORDER BY entity_type, entity_id`,
    [row.account_id, row.capture_id],
  );
  return result.rows;
}

async function purgeRetentionDerivatives(
  client: PoolClient,
  row: RetentionRow,
  derivatives: RetentionDerivative[],
  occurredAt: Date,
): Promise<void> {
  const ids = (entityType: string): string[] =>
    derivatives
      .filter((item) => item.entity_type === entityType)
      .map((item) => item.entity_id);
  const taskIds = ids("agent_task");
  const runIds = ids("agent_run");
  const proposalIds = ids("pursuit_proposal");
  const idempotencyIds = ids("idempotency_record");

  await client.query(
    `DELETE FROM reviewed_person_public_profiles profiles
     USING source_resources resources
     WHERE resources.account_id = $1
       AND resources.capture_id = $2
       AND profiles.account_id = resources.account_id
       AND profiles.source_resource_id = resources.id`,
    [row.account_id, row.capture_id],
  );
  await client.query(
    `UPDATE evidence_fragments
     SET status = 'purged',
         text_content = NULL,
         content_hash = 'purged',
         locator = '{"purged":true}'::jsonb
     WHERE account_id = $1 AND capture_id = $2`,
    [row.account_id, row.capture_id],
  );
  await client.query(
    `UPDATE source_resources
     SET display_name = '[source expired]',
         content_hash = NULL,
         source_locator = NULL,
         payload_ref = NULL,
         updated_at = $3
     WHERE account_id = $1 AND capture_id = $2`,
    [row.account_id, row.capture_id, occurredAt],
  );
  await client.query(
    `UPDATE proposed_assertions
     SET evidence_quote = NULL,
         proposed_value = CASE
           WHEN review_status = 'confirmed' THEN proposed_value
           ELSE NULL
         END,
         proposal_status = CASE
           WHEN review_status = 'confirmed' THEN proposal_status
           ELSE 'superseded'
         END,
         version = version + 1
     WHERE account_id = $1 AND capture_id = $2`,
    [row.account_id, row.capture_id],
  );

  if (taskIds.length > 0) {
    await client.query(
      `UPDATE agent_tasks
       SET objective = '[source expired]',
           evidence_refs = '[]'::jsonb,
           input_artifact_refs = '[]'::jsonb,
           status = CASE
             WHEN status IN (
               'active', 'waiting_for_clarification',
               'waiting_for_domain_decision', 'waiting_for_external'
             ) THEN 'needs_rebase'
             ELSE status
           END,
           task_revision = task_revision + 1,
           continue_allowed = false,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = $3
       WHERE account_id = $1 AND id = ANY($2::uuid[])`,
      [row.account_id, taskIds, occurredAt],
    );
    await client.query(
      `UPDATE agent_task_runs
       SET status = 'cancelled', completed_at = $3
       WHERE account_id = $1
         AND task_id = ANY($2::uuid[])
         AND status IN ('scheduled', 'running', 'suspended')`,
      [row.account_id, taskIds, occurredAt],
    );
    await client.query(
      `UPDATE agent_task_checkpoints
       SET public_state = '{"source_content_state":"purged"}'::jsonb
       WHERE account_id = $1 AND task_id = ANY($2::uuid[])`,
      [row.account_id, taskIds],
    );
    await client.query(
      `UPDATE agent_artifacts
       SET title = '[source expired]',
           content = '{
             "summary":"Source-derived Artifact content expired with its authorized source.",
             "what_changed":[],
             "what_matters_now":{
               "dependency":"Review current evidence before continuing.",
               "reason":"The prior source authorization and retention window expired.",
               "authority":"agent_interpretation",
               "evidence_refs":[]
             },
             "next_move":{
               "kind":"no_action",
               "label":"Review changed source",
               "reason":"Create a new immutable Task version only from currently authorized evidence."
             },
             "limitations":["Source-derived content was purged; this Artifact has no current authority."]
           }'::jsonb
       WHERE account_id = $1 AND task_id = ANY($2::uuid[])`,
      [row.account_id, taskIds],
    );
    await client.query(
      `UPDATE agent_clarification_requests
       SET question = '[source expired]',
           reason = '[source expired]',
           response_schema = '{}'::jsonb,
           status = CASE WHEN status = 'open' THEN 'cancelled' ELSE status END
       WHERE account_id = $1 AND task_id = ANY($2::uuid[])`,
      [row.account_id, taskIds],
    );
    await client.query(
      `UPDATE agent_decision_bundles
       SET dependency = '[source expired]',
           status = CASE
             WHEN status IN ('open', 'partially_resolved') THEN 'cancelled'
             ELSE status
           END,
           updated_at = $3
       WHERE account_id = $1 AND task_id = ANY($2::uuid[])`,
      [row.account_id, taskIds, occurredAt],
    );
    await client.query(
      `UPDATE agent_decision_items items
       SET status = CASE WHEN items.status = 'open' THEN 'expired' ELSE items.status END,
           updated_at = $3
       FROM agent_decision_bundles bundles
       WHERE bundles.account_id = $1
         AND bundles.task_id = ANY($2::uuid[])
         AND items.account_id = bundles.account_id
         AND items.bundle_id = bundles.id`,
      [row.account_id, taskIds, occurredAt],
    );
    await client.query(
      `UPDATE agent_task_events
       SET public_payload = '{"source_content_state":"purged"}'::jsonb
       WHERE account_id = $1 AND task_id = ANY($2::uuid[])`,
      [row.account_id, taskIds],
    );
    await client.query(
      `UPDATE agent_delivery_outbox
       SET payload = jsonb_set(
         payload,
         '{public_payload}',
         '{"source_content_state":"purged"}'::jsonb,
         true
       )
       WHERE account_id = $1 AND task_id = ANY($2::uuid[])`,
      [row.account_id, taskIds],
    );
  }

  if (runIds.length > 0) {
    await client.query(
      `UPDATE agent_runs
       SET objective = '[source expired]',
           context_manifest = jsonb_build_object(
             'pursuit_revision', base_revision,
             'evidence', '[]'::jsonb,
             'input_artifacts', '[]'::jsonb
           )
       WHERE account_id = $1 AND id = ANY($2::uuid[])`,
      [row.account_id, runIds],
    );
    await client.query(
      `UPDATE agent_run_evidence
       SET inclusion_reason = '[source expired]',
           authorization_scope = '[source expired]'
       WHERE account_id = $1 AND run_id = ANY($2::uuid[])`,
      [row.account_id, runIds],
    );
    await client.query(
      `UPDATE agent_run_events
       SET metadata = '{"source_content_state":"purged"}'::jsonb
       WHERE account_id = $1 AND run_id = ANY($2::uuid[])`,
      [row.account_id, runIds],
    );
    await client.query(
      `UPDATE agent_run_outputs
       SET status = 'quarantined',
           structured_output = '{"source_content_state":"purged"}'::jsonb
       WHERE account_id = $1 AND run_id = ANY($2::uuid[])`,
      [row.account_id, runIds],
    );
    await client.query(
      `UPDATE agent_no_actions
       SET reason = '[source expired]', missing_evidence_refs = '[]'::jsonb
       WHERE account_id = $1 AND run_id = ANY($2::uuid[])`,
      [row.account_id, runIds],
    );
  }

  if (proposalIds.length > 0) {
    await client.query(
      `UPDATE pursuit_proposals
       SET status = CASE
             WHEN status IN ('needs_review', 'confirming', 'conflict', 'failed')
               THEN 'superseded'
             ELSE status
           END,
           summary = '[source-derived Proposal content expired]',
           revision = revision + 1,
           updated_at = $3
       WHERE account_id = $1 AND id = ANY($2::uuid[])`,
      [row.account_id, proposalIds, occurredAt],
    );
    await client.query(
      `UPDATE pursuit_proposal_items
       SET before_value = NULL,
           proposed_value = '{"content_purged":true}'::jsonb,
           epistemic_status = 'superseded',
           reason = '[source-derived Proposal reason expired]',
           effect_summary = '[source-derived Proposal effect expired]',
           decided_value = CASE
             WHEN decided_value IS NULL THEN NULL
             ELSE '{"content_purged":true}'::jsonb
           END,
           decision_reason = CASE
             WHEN decision_reason IS NULL THEN NULL
             ELSE '[source-derived review reason expired]'
           END
       WHERE account_id = $1 AND proposal_id = ANY($2::uuid[])`,
      [row.account_id, proposalIds],
    );
  }

  if (idempotencyIds.length > 0) {
    await client.query(
      `UPDATE idempotency_records
       SET response_body = jsonb_build_object(
         'source_content_state', 'purged',
         'capture_id', $3::text
       )
       WHERE account_id = $1 AND id = ANY($2::uuid[])`,
      [row.account_id, idempotencyIds, row.capture_id],
    );
  }
}

async function recordRetentionDerivatives(
  client: PoolClient,
  row: RetentionRow,
  derivatives: RetentionDerivative[],
  occurredAt: Date,
): Promise<void> {
  for (const derivative of derivatives) {
    await client.query(
      `INSERT INTO source_retention_derivative_lineage(
         id, account_id, receipt_id, capture_id,
         entity_type, entity_id, disposition, recorded_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (account_id, receipt_id, entity_type, entity_id)
       DO NOTHING`,
      [
        randomUUID(),
        row.account_id,
        row.receipt_id,
        row.capture_id,
        derivative.entity_type,
        derivative.entity_id,
        derivative.disposition,
        occurredAt,
      ],
    );
  }
}

async function purgeSourceContent(
  client: PoolClient,
  row: RetentionRow,
  reason: "review_completed" | "retention_deadline_elapsed",
  occurredAt: Date,
  actorUserId: string | null,
): Promise<boolean> {
  if (row.source_access_state !== "available") {
    return false;
  }

  const updated = await client.query(
    `UPDATE source_retention_receipts
     SET source_access_state = 'purged',
         source_access_reason = $3,
         source_purged_at = $4,
         updated_at = $4
     WHERE account_id = $1
       AND capture_id = $2
       AND source_access_state = 'available'`,
    [row.account_id, row.capture_id, reason, occurredAt],
  );
  if (updated.rowCount !== 1) {
    return false;
  }

  // Resource-intake completion drops the transient transport payload while
  // preserving the explicitly reviewed fragment as governed evidence. A
  // retention deadline is the stronger lifecycle boundary: it expires every
  // still-source-dependent Task, Proposal, Artifact, and registry reference
  // and therefore receives the complete derivative-disposition ledger.
  const derivatives =
    reason === "retention_deadline_elapsed"
      ? await collectRetentionDerivatives(client, row)
      : [];
  if (derivatives.length > 0) {
    await purgeRetentionDerivatives(client, row, derivatives, occurredAt);
  }

  await client.query(
    `UPDATE evidence_items
     SET status = 'purged',
         redacted_text = NULL,
         content_hash = 'purged',
         purged_at = $3
     WHERE account_id = $1
       AND capture_id = $2
       AND status = 'active'`,
    [row.account_id, row.capture_id, occurredAt],
  );
  await client.query(
    `UPDATE proposed_assertions
     SET evidence_quote = NULL
     WHERE account_id = $1 AND capture_id = $2`,
    [row.account_id, row.capture_id],
  );
  const advanced = await client.query<{ id: string; version: number }>(
    `UPDATE captures
     SET source_metadata = jsonb_strip_nulls(jsonb_build_object(
           'kind', source_kind,
           'captured_at', source_metadata->'captured_at',
           'source_timezone', source_metadata->'source_timezone',
           'purpose', purpose
         )),
         version = version + 1,
         updated_at = $3
     WHERE account_id = $1 AND id = $2 RETURNING id, version`,
    [row.account_id, row.capture_id, occurredAt],
  );
  for (const capture of advanced.rows) {
    await client.query(`INSERT INTO source_natural_epoch_transitions(account_id,capture_id,from_version,to_version,transition_kind,occurred_at)
      VALUES($1,$2,$3,$4,'payload_purged',$5)`, [row.account_id, capture.id, capture.version - 1, capture.version, occurredAt]);
  }
  await client.query(
    `UPDATE idempotency_records
     SET response_body = jsonb_build_object('capture_id', $2)
     WHERE account_id = $1
       AND operation_scope = 'create_capture'
       AND response_body->>'id' = $2`,
    [row.account_id, row.capture_id],
  );
  await client.query(
    `UPDATE idempotency_records
     SET response_body = jsonb_set(
       response_body,
       '{assertions}',
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_set(assertion, '{evidence_quote}', 'null'::jsonb, true)
           )
           FROM jsonb_array_elements(response_body->'assertions') assertion
         ),
         '[]'::jsonb
       ),
       true
     )
     WHERE account_id = $1
       AND operation_scope = $2
       AND response_body ? 'assertions'`,
    [row.account_id, `submit_analysis:${row.capture_id}`],
  );
  if (derivatives.length > 0) {
    await recordRetentionDerivatives(client, row, derivatives, occurredAt);
  }
  await appendRetentionEvent(
    client,
    row,
    "source_purged",
    reason,
    occurredAt,
  );
  await appendAudit(
    client,
    { accountId: row.account_id, actorUserId },
    "capture.source_purged",
    "capture",
    row.capture_id,
    {
      effective_mode: row.effective_mode,
      reason,
      source_scope: row.source_scope,
    },
  );
  return true;
}

export async function completeSourceReview(
  client: PoolClient,
  auth: AuthContext,
  captureId: string,
  completedAt = new Date(),
  completionEvent:
    | "analysis_proposal_committed"
    | "resource_intake_committed" = "analysis_proposal_committed",
): Promise<boolean> {
  const row = await retentionRow(client, auth.accountId, captureId, true);
  if (!row.review_completed_at) {
    await client.query(
      `UPDATE source_retention_receipts
       SET review_completed_at = $3,
           review_completion_event = $4,
           updated_at = $3
       WHERE account_id = $1 AND capture_id = $2`,
      [auth.accountId, captureId, completedAt, completionEvent],
    );
    row.review_completed_at = completedAt;
    await appendRetentionEvent(
      client,
      row,
      "review_completed",
      completionEvent,
      completedAt,
    );
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "capture.source_review_completed",
      "capture",
      captureId,
      { completion_event: completionEvent },
    );
  }
  if (row.effective_mode === "ephemeral") {
    return purgeSourceContent(
      client,
      row,
      "review_completed",
      completedAt,
      auth.userId,
    );
  }
  return false;
}

export async function enforceSourceRetentionForCapture(
  client: PoolClient,
  accountId: string,
  captureId: string,
  now = new Date(),
): Promise<boolean> {
  const row = await retentionRow(client, accountId, captureId, true);
  if (
    row.source_access_state !== "available" ||
    !row.retention_until ||
    row.retention_until > now
  ) {
    return false;
  }
  return purgeSourceContent(
    client,
    row,
    "retention_deadline_elapsed",
    now,
    null,
  );
}

async function loadSourceRetentionReceipt(
  client: PoolClient,
  accountId: string,
  captureId: string,
  now = new Date(),
): Promise<SourceRetentionReceipt> {
  const row = await retentionRow(client, accountId, captureId);
  const [events, derivatives, deletion] = await Promise.all([
    client.query<{
      id: string;
      event_type: RetentionEvent;
      reason: RetentionEventReason;
      occurred_at: Date;
    }>(
      `SELECT id, event_type, reason, occurred_at
       FROM source_retention_events
       WHERE account_id = $1 AND receipt_id = $2
       ORDER BY
         occurred_at,
         CASE event_type
           WHEN 'source_submitted' THEN 1
           WHEN 'review_completed' THEN 2
           WHEN 'source_purged' THEN 3
           WHEN 'source_deleted' THEN 4
         END,
         id`,
      [accountId, row.receipt_id],
    ),
    client.query<{
      entity_type: string;
      entity_id: string;
      disposition: RetentionDerivativeDisposition;
      recorded_at: Date;
    }>(
      `SELECT entity_type, entity_id, disposition, recorded_at
       FROM source_retention_derivative_lineage
       WHERE account_id = $1 AND receipt_id = $2
       ORDER BY entity_type, entity_id`,
      [accountId, row.receipt_id],
    ),
    client.query<{ id: string }>(
      `SELECT id
       FROM deletion_requests
       WHERE account_id = $1 AND capture_id = $2
       ORDER BY access_revoked_at DESC, id DESC
       LIMIT 1`,
      [accountId, captureId],
    ),
  ]);
  return {
    receipt_id: row.receipt_id,
    capture_id: row.capture_id,
    account_id: row.account_id,
    policy_version: row.policy_version,
    requested_policy: {
      mode: row.requested_mode,
      source_scope: row.source_scope,
      retention_until:
        row.requested_retention_until?.toISOString() ?? null,
    },
    effective_policy: {
      mode: row.effective_mode,
      source_scope: row.source_scope,
      retention_until: row.retention_until?.toISOString() ?? null,
      review_completion_event:
        row.review_completion_event,
    },
    source_access: {
      state: row.source_access_state,
      reason: row.source_access_reason,
    },
    source_authorization: {
      state:
        row.authorization_state === "authorized" &&
        row.authorization_expires_at &&
        row.authorization_expires_at <= now
          ? "expired"
          : row.authorization_state,
      reason:
        row.authorization_state === "authorized" &&
        row.authorization_expires_at &&
        row.authorization_expires_at <= now
          ? "authorization_expired"
          : row.authorization_reason,
      changed_at:
        (
          row.authorization_state === "authorized" &&
          row.authorization_expires_at &&
          row.authorization_expires_at <= now
            ? row.authorization_expires_at
            : row.authorization_changed_at
        ).toISOString(),
      expires_at:
        row.authorization_expires_at?.toISOString() ?? null,
    },
    lifecycle: {
      submitted_at: row.created_at.toISOString(),
      review_completed_at: row.review_completed_at?.toISOString() ?? null,
      retention_until: row.retention_until?.toISOString() ?? null,
      source_purged_at: row.source_purged_at?.toISOString() ?? null,
      deleted_at: row.deleted_at?.toISOString() ?? null,
    },
    deletion_id: deletion.rows[0]?.id ?? null,
    lineage: events.rows.map((event) => ({
      event_id: event.id,
      event_type: event.event_type,
      reason: event.reason,
      occurred_at: event.occurred_at.toISOString(),
    })),
    derivative_lineage: derivatives.rows.map((derivative) => ({
      entity_type: derivative.entity_type,
      entity_id: derivative.entity_id,
      disposition: derivative.disposition,
      recorded_at: derivative.recorded_at.toISOString(),
    })),
  };
}

export async function getSourceRetentionReceipt(
  pool: Pool,
  auth: AuthContext,
  captureId: string,
  now = new Date(),
): Promise<SourceRetentionReceipt> {
  return inTransaction(pool, async (client) => {
    await enforceSourceRetentionForCapture(
      client,
      auth.accountId,
      captureId,
      now,
    );
    return loadSourceRetentionReceipt(
      client,
      auth.accountId,
      captureId,
      now,
    );
  });
}

export async function getSourceRetentionReceiptByLocator(
  pool: Pool,
  auth: AuthContext,
  sourceLocator: string,
  now = new Date(),
): Promise<SourceRetentionReceipt> {
  return inTransaction(pool, async (client) => {
    const result = await client.query<{ capture_id: string }>(
      `SELECT capture_id
       FROM source_retention_receipts
       WHERE account_id = $1 AND source_locator = $2
       ORDER BY created_at DESC, receipt_id DESC
       LIMIT 1`,
      [auth.accountId, sourceLocator],
    );
    const captureId = result.rows[0]?.capture_id;
    if (!captureId) {
      throw new ApiError(
        404,
        "RETENTION_RECEIPT_NOT_FOUND",
        "The source-retention receipt was not found.",
      );
    }
    await enforceSourceRetentionForCapture(
      client,
      auth.accountId,
      captureId,
      now,
    );
    return loadSourceRetentionReceipt(
      client,
      auth.accountId,
      captureId,
      now,
    );
  });
}

export async function sweepDueSourceRetention(
  pool: Pool,
  now = new Date(),
): Promise<number> {
  return inTransaction(pool, async (client) => {
    const due = await client.query<{ account_id: string; capture_id: string }>(
      `SELECT receipts.account_id, receipts.capture_id
       FROM source_retention_receipts receipts
       JOIN accounts
         ON accounts.id = receipts.account_id AND accounts.retired_at IS NULL
       WHERE receipts.source_access_state = 'available'
         AND receipts.retention_until IS NOT NULL
         AND receipts.retention_until <= $1
       ORDER BY receipts.retention_until, receipts.capture_id
       LIMIT 100
       FOR UPDATE OF receipts SKIP LOCKED`,
      [now],
    );
    let purged = 0;
    for (const item of due.rows) {
      if (
        await enforceSourceRetentionForCapture(
          client,
          item.account_id,
          item.capture_id,
          now,
        )
      ) {
        purged += 1;
      }
    }
    return purged;
  });
}

export async function markSourceDeleted(
  client: PoolClient,
  auth: AuthContext,
  captureId: string,
  deletedAt = new Date(),
): Promise<void> {
  const row = await retentionRow(client, auth.accountId, captureId, true);
  await client.query(
    `UPDATE source_retention_receipts
     SET source_access_state = 'deleted',
         source_access_reason = 'manual_deletion',
         source_purged_at = COALESCE(source_purged_at, $3),
         deleted_at = $3,
         updated_at = $3
     WHERE account_id = $1 AND capture_id = $2`,
    [auth.accountId, captureId, deletedAt],
  );
  await appendRetentionEvent(
    client,
    row,
    "source_deleted",
    "manual_deletion",
    deletedAt,
  );
}
