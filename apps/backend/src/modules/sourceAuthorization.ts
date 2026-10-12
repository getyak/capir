import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  type SourceAuthorizationDecisionRequest,
  type SourceAuthorizationDecisionResponse,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import {
  claimIdempotency,
  completeIdempotency,
} from "../lib/idempotency.js";
import type { AuthContext } from "./auth.js";
import { invalidateMemoriesForCaptureIds } from "./memoryReviewRecall.js";
import { compileRelationshipWiki } from "./wiki.js";

/**
 * Fixed content-free recompilation diagnostics. A failed Relationship Wiki
 * recompilation keeps `compilation` null and stays retryable through the
 * compilation job; the raw exception is never retained in the durable
 * decision response, job `last_error`, or any other field.
 */
export const RELATIONSHIP_WIKI_COMPILATION_FAILED =
  "Relationship Wiki recompilation failed.";
export const RELATIONSHIP_WIKI_EXPIRY_COMPILATION_FAILED =
  "Relationship Wiki recompilation failed after source authorization expired.";

interface SourceAuthorizationRow {
  id: string;
  created_by_user_id: string;
  subject_id: string | null;
  assignment_id: string | null;
  identity_status: "bound" | "ambiguous" | "unbound";
  status: "active" | "deleted";
  version: number;
  authorization_state: "authorized" | "revoked" | "expired";
  authorization_expires_at: Date | null;
}

type SourceAuthorizationTransitionRequest =
  Omit<SourceAuthorizationDecisionRequest, "decision"> & {
    decision: "revoke" | "restore" | "expire";
  };

interface SourceAuthorizationTransitionOptions {
  systemActor?: boolean;
  occurredAt?: Date;
}

export interface SourceAuthorizationMutationResult {
  body: SourceAuthorizationDecisionResponse;
  replayed: boolean;
  status: number;
  idempotencyRecordId: string;
}

async function loadLineageCaptureIds(
  client: PoolClient,
  accountId: string,
  rootCaptureId: string,
): Promise<string[]> {
  const lineage = await client.query<{ capture_id: string }>(
    `WITH RECURSIVE resource_lineage AS (
       SELECT resources.id, resources.capture_id
       FROM source_resources resources
       WHERE resources.account_id = $1
         AND resources.capture_id = $2
         AND resources.processing_state <> 'deleted'
       UNION
       SELECT children.id, children.capture_id
       FROM source_resources children
       JOIN resource_lineage parents
         ON children.discovered_from_resource_id = parents.id
       WHERE children.account_id = $1
         AND children.processing_state <> 'deleted'
     )
     SELECT DISTINCT capture_id
     FROM resource_lineage
     ORDER BY capture_id`,
    [accountId, rootCaptureId],
  );
  const captureIds = lineage.rows.map((row) => row.capture_id);
  return captureIds.length > 0 ? captureIds : [rootCaptureId];
}

async function invalidateKnowledge(
  client: PoolClient,
  accountId: string,
  captureIds: string[],
  personId: string,
  relationshipContextId: string,
): Promise<string[]> {
  const snapshots = await client.query<{ id: string }>(
    `SELECT DISTINCT snapshot_id AS id
     FROM (
       SELECT blocks.snapshot_id
       FROM evidence_fragments fragments
       JOIN knowledge_dependencies dependencies
         ON dependencies.account_id = fragments.account_id
        AND dependencies.dependency_type = 'evidence_fragment'
        AND dependencies.dependency_id = fragments.id
       JOIN knowledge_blocks blocks
         ON blocks.account_id = dependencies.account_id
        AND blocks.id = dependencies.block_id
       WHERE fragments.account_id = $1
         AND fragments.capture_id = ANY($2::uuid[])
       UNION
       SELECT knowledge.id AS snapshot_id
       FROM knowledge_snapshots knowledge
       WHERE knowledge.account_id = $1
         AND knowledge.subject_id = $3
         AND knowledge.assignment_id = $4
         AND knowledge.status IN ('published', 'draft', 'abstained')
     ) governed_snapshots
     ORDER BY snapshot_id`,
    [accountId, captureIds, personId, relationshipContextId],
  );
  const snapshotIds = snapshots.rows.map((snapshot) => snapshot.id);
  if (snapshotIds.length === 0) {
    return [];
  }
  await client.query(
    `UPDATE knowledge_snapshots
     SET status = 'superseded'
     WHERE account_id = $1
       AND id = ANY($2::uuid[])
       AND status IN ('published', 'draft', 'abstained')`,
    [accountId, snapshotIds],
  );
  await client.query(
    `UPDATE context_manifests
     SET status = 'superseded'
     WHERE account_id = $1
       AND knowledge_snapshot_id = ANY($2::uuid[])
       AND status = 'active'`,
    [accountId, snapshotIds],
  );
  await client.query(
    `UPDATE idempotency_records
     SET response_body = '{"invalidated":true}'::jsonb
     WHERE account_id = $1
       AND (
         (
           operation_scope = 'compile_relationship_wiki'
           AND response_body->>'snapshot_id' = ANY($2::text[])
         )
         OR (
           operation_scope = 'create_chat_task'
           AND response_body->>'knowledge_snapshot_id' = ANY($2::text[])
         )
       )`,
    [accountId, snapshotIds],
  );
  return snapshotIds;
}

async function findSurvivingPriorStateIds(
  client: PoolClient,
  accountId: string,
  captureIds: string[],
): Promise<string[]> {
  const priorStates = await client.query<{ prior_state_id: string }>(
    `WITH RECURSIVE state_chain AS (
       SELECT
         states.id AS retracted_state_id,
         states.supersedes_state_id AS candidate_state_id,
         1 AS depth
       FROM confirmed_states states
       JOIN proposed_assertions assertions
         ON assertions.account_id = states.account_id
        AND assertions.id = states.source_assertion_id
       WHERE states.account_id = $1
         AND assertions.capture_id = ANY($2::uuid[])
         AND states.status = 'active'
         AND states.supersedes_state_id IS NOT NULL
       UNION ALL
       SELECT
         chain.retracted_state_id,
         candidate.supersedes_state_id,
         chain.depth + 1
       FROM state_chain chain
       JOIN confirmed_states candidate
         ON candidate.account_id = $1
        AND candidate.id = chain.candidate_state_id
       JOIN proposed_assertions candidate_assertion
         ON candidate_assertion.account_id = candidate.account_id
        AND candidate_assertion.id = candidate.source_assertion_id
       WHERE candidate_assertion.capture_id = ANY($2::uuid[])
         AND candidate.supersedes_state_id IS NOT NULL
         AND chain.depth < 100
     ),
     surviving_prior AS (
       SELECT
         chain.retracted_state_id,
         candidate.id AS prior_state_id,
         row_number() OVER (
           PARTITION BY chain.retracted_state_id
           ORDER BY chain.depth
         ) AS candidate_rank
       FROM state_chain chain
       JOIN confirmed_states candidate
         ON candidate.account_id = $1
        AND candidate.id = chain.candidate_state_id
       JOIN proposed_assertions candidate_assertion
         ON candidate_assertion.account_id = candidate.account_id
        AND candidate_assertion.id = candidate.source_assertion_id
       WHERE NOT (
           candidate_assertion.capture_id = ANY($2::uuid[])
         )
         AND candidate.status = 'superseded'
         AND candidate.value_text IS NOT NULL
     )
     SELECT prior_state_id
     FROM surviving_prior
     WHERE candidate_rank = 1`,
    [accountId, captureIds],
  );
  return [
    ...new Set(priorStates.rows.map((state) => state.prior_state_id)),
  ];
}

async function transitionCaptureSourceAuthorization(
  pool: Pool,
  auth: AuthContext,
  rootCaptureId: string,
  request: SourceAuthorizationTransitionRequest,
  options: SourceAuthorizationTransitionOptions = {},
): Promise<SourceAuthorizationMutationResult> {
  return inTransaction(pool, async (client) => {
    const operationScope =
      `decide_source_authorization:${rootCaptureId}`;
    const idempotency = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      operationScope,
      request.idempotency_key,
      request,
    );
    if (idempotency.replay) {
      return {
        body:
          idempotency.replay
            .body as SourceAuthorizationDecisionResponse,
        replayed: true,
        status: idempotency.replay.status,
        idempotencyRecordId: idempotency.id,
      };
    }

    const rootResult = await client.query<SourceAuthorizationRow>(
      `SELECT
         captures.id,
         captures.created_by_user_id,
         captures.subject_id,
         captures.assignment_id,
         captures.identity_status,
         captures.status,
         captures.version,
         receipts.authorization_state,
         receipts.authorization_expires_at
       FROM captures
       JOIN source_retention_receipts receipts
         ON receipts.account_id = captures.account_id
        AND receipts.capture_id = captures.id
       WHERE captures.account_id = $1
         AND captures.id = $2
       FOR UPDATE OF captures, receipts`,
      [auth.accountId, rootCaptureId],
    );
    const root = rootResult.rows[0];
    if (!root) {
      throw new ApiError(
        404,
        "SOURCE_AUTHORIZATION_CAPTURE_NOT_FOUND",
        "The source capture was not found.",
      );
    }
    if (root.status === "deleted") {
      throw new ApiError(
        410,
        "SOURCE_AUTHORIZATION_CAPTURE_DELETED",
        "A deleted source cannot change authorization.",
      );
    }
    if (
      root.identity_status !== "bound" ||
      !root.subject_id ||
      !root.assignment_id
    ) {
      throw new ApiError(
        409,
        "SOURCE_AUTHORIZATION_REQUIRES_BOUND_SOURCE",
        "Resolve the source identity before changing its authorization.",
      );
    }
    if (root.version !== request.expected_capture_version) {
      throw new ApiError(
        409,
        "SOURCE_AUTHORIZATION_STALE",
        "The source changed before this authorization decision.",
        { current_capture_version: root.version },
      );
    }

    const targetState =
      request.decision === "revoke"
        ? "revoked"
        : request.decision === "expire"
          ? "expired"
          : "authorized";
    const decidedAt = options.occurredAt ?? new Date();
    if (
      request.decision === "revoke" &&
      request.authorization_expires_at
    ) {
      throw new ApiError(
        422,
        "SOURCE_AUTHORIZATION_EXPIRY_NOT_ALLOWED",
        "Only a restored authorization can set a new authorization deadline.",
      );
    }
    const restoredAuthorizationExpiresAt =
      request.decision === "restore" &&
      request.authorization_expires_at
        ? new Date(request.authorization_expires_at)
        : null;
    if (
      restoredAuthorizationExpiresAt &&
      (!Number.isFinite(restoredAuthorizationExpiresAt.getTime()) ||
        restoredAuthorizationExpiresAt <= decidedAt)
    ) {
      throw new ApiError(
        422,
        "SOURCE_AUTHORIZATION_EXPIRY_INVALID",
        "A restored source-authorization deadline must be a valid future timestamp.",
      );
    }
    if (
      request.decision === "expire" &&
      (!root.authorization_expires_at ||
        root.authorization_expires_at > decidedAt)
    ) {
      throw new ApiError(
        409,
        "SOURCE_AUTHORIZATION_NOT_DUE",
        "The source authorization deadline has not elapsed.",
      );
    }
    if (root.authorization_state === targetState) {
      throw new ApiError(
        409,
        "SOURCE_AUTHORIZATION_UNCHANGED",
        request.decision === "revoke"
          ? "This source is already revoked."
          : request.decision === "expire"
            ? "This source authorization is already expired."
            : "This source is already authorized.",
      );
    }

    const captureIds = await loadLineageCaptureIds(
      client,
      auth.accountId,
      rootCaptureId,
    );
    const lineage = await client.query<SourceAuthorizationRow>(
      `SELECT
         captures.id,
         captures.created_by_user_id,
         captures.subject_id,
         captures.assignment_id,
         captures.identity_status,
         captures.status,
         captures.version,
         receipts.authorization_state,
         receipts.authorization_expires_at
       FROM captures
       JOIN source_retention_receipts receipts
         ON receipts.account_id = captures.account_id
        AND receipts.capture_id = captures.id
       WHERE captures.account_id = $1
         AND captures.id = ANY($2::uuid[])
       ORDER BY captures.id
       FOR UPDATE OF captures, receipts`,
      [auth.accountId, captureIds],
    );
    if (
      lineage.rows.length !== captureIds.length ||
      lineage.rows.some(
        (capture) =>
          capture.status !== "active" ||
          capture.identity_status !== "bound" ||
          capture.subject_id !== root.subject_id ||
          capture.assignment_id !== root.assignment_id ||
          capture.authorization_state !== root.authorization_state ||
          capture.authorization_expires_at?.getTime() !==
            root.authorization_expires_at?.getTime(),
      )
    ) {
      throw new ApiError(
        409,
        "SOURCE_AUTHORIZATION_LINEAGE_DIVERGED",
        "A discovered source now has a different identity or authorization state; review the lineage before changing access.",
      );
    }

    if (request.decision === "revoke") {
      const unresolvedEffects = await client.query<{ id: string }>(
        `SELECT id
         FROM action_proposals
         WHERE account_id = $1
           AND capture_id = ANY($2::uuid[])
           AND status IN ('executing', 'unknown')
         LIMIT 1`,
        [auth.accountId, captureIds],
      );
      if (unresolvedEffects.rows[0]) {
        throw new ApiError(
          409,
          "SOURCE_AUTHORIZATION_RECONCILIATION_REQUIRED",
          "Reconcile the in-flight or unknown external effect before revoking its source.",
        );
      }
    }

    let retractedStateIds: string[] = [];
    let reopenedPriorStateIds: string[] = [];
    let revokedActionIds: string[] = [];
    let returnedHandleIds: string[] = [];

    if (request.decision !== "restore") {
      const priorStateIds = await findSurvivingPriorStateIds(
        client,
        auth.accountId,
        captureIds,
      );
      const retracted = await client.query<{ id: string }>(
        `UPDATE confirmed_states states
         SET status = 'retracted',
             valid_until = COALESCE(states.valid_until, $3)
         FROM proposed_assertions assertions
         WHERE assertions.account_id = $1
           AND assertions.capture_id = ANY($2::uuid[])
           AND states.account_id = assertions.account_id
           AND states.source_assertion_id = assertions.id
           AND states.status NOT IN ('deleted', 'retracted')
         RETURNING states.id`,
        [auth.accountId, captureIds, decidedAt],
      );
      retractedStateIds = retracted.rows.map((state) => state.id);
      if (priorStateIds.length > 0) {
        const reopened = await client.query<{ id: string }>(
          `UPDATE confirmed_states
           SET status = 'contested'
           WHERE account_id = $1
             AND id = ANY($2::uuid[])
             AND status = 'superseded'
           RETURNING id`,
          [auth.accountId, priorStateIds],
        );
        reopenedPriorStateIds = reopened.rows.map((state) => state.id);
      }

      await client.query(
        `UPDATE action_approvals approvals
         SET status = 'revoked',
             revoked_at = $3,
             revocation_reason = 'Source authorization was revoked.'
         FROM action_proposals actions
         WHERE actions.account_id = $1
           AND actions.capture_id = ANY($2::uuid[])
           AND approvals.account_id = actions.account_id
           AND approvals.action_id = actions.id
           AND approvals.status = 'active'`,
        [auth.accountId, captureIds, decidedAt],
      );
      const revokedActions = await client.query<{ id: string }>(
        `UPDATE action_proposals
         SET status = 'revoked',
             version = version + 1,
             updated_at = $3
         WHERE account_id = $1
           AND capture_id = ANY($2::uuid[])
           AND status IN ('proposed', 'approved', 'failed')
         RETURNING id`,
        [auth.accountId, captureIds, decidedAt],
      );
      revokedActionIds = revokedActions.rows.map((action) => action.id);

      const returnedHandles = await client.query<{ id: string }>(
        `UPDATE identity_handles
         SET status = 'proposed',
             confirmed_by_user_id = NULL,
             valid_until = NULL,
             updated_at = $3
         WHERE account_id = $1
           AND source_resource_id IN (
             SELECT id
             FROM source_resources
             WHERE account_id = $1
               AND capture_id = ANY($2::uuid[])
           )
           AND status = 'confirmed'
         RETURNING id`,
        [auth.accountId, captureIds, decidedAt],
      );
      returnedHandleIds = returnedHandles.rows.map((handle) => handle.id);
    }

    const reopenedClaims = await client.query<{ id: string }>(
      `WITH claim_targets AS (
         SELECT
           assertions.id,
           active.id AS active_state_id,
           active.value_text AS active_value
         FROM proposed_assertions assertions
         LEFT JOIN confirmed_states active
           ON active.account_id = assertions.account_id
          AND active.assignment_id = $3
          AND active.field = assertions.field
          AND active.status = 'active'
         WHERE assertions.account_id = $1
           AND assertions.capture_id = ANY($2::uuid[])
           AND assertions.review_status <> 'deleted'
       )
       UPDATE proposed_assertions assertions
       SET review_status = 'pending',
           proposal_status = CASE
             WHEN targets.active_state_id IS NULL THEN 'proposed'
             WHEN targets.active_value = assertions.proposed_value
               THEN 'proposed'
             ELSE 'ambiguous'
           END,
           temporal_relation = CASE
             WHEN targets.active_state_id IS NULL THEN 'new'
             WHEN targets.active_value = assertions.proposed_value
               THEN 'reinforces'
             ELSE 'supersedes'
           END,
           supersedes_state_id = targets.active_state_id,
           version = assertions.version + 1
       FROM claim_targets targets
       WHERE assertions.account_id = $1
         AND assertions.id = targets.id
       RETURNING assertions.id`,
      [auth.accountId, captureIds, root.assignment_id],
    );

    const invalidatedSnapshots = await invalidateKnowledge(
      client,
      auth.accountId,
      captureIds,
      root.subject_id,
      root.assignment_id,
    );

    await client.query(
      `UPDATE source_retention_receipts
       SET authorization_state = $3,
           authorization_reason = $4,
           authorization_changed_at = $5,
           authorization_expires_at = $6,
           updated_at = $5
       WHERE account_id = $1
         AND capture_id = ANY($2::uuid[])`,
      [
        auth.accountId,
        captureIds,
        targetState,
        request.decision === "revoke"
          ? "recruiter_revoked"
          : request.decision === "expire"
            ? "authorization_expired"
            : "recruiter_restored",
        decidedAt,
        request.decision === "restore"
          ? restoredAuthorizationExpiresAt
          : root.authorization_expires_at,
      ],
    );
    const advanced = await client.query<{ id: string; version: number }>(
      `UPDATE captures
       SET version = version + 1,
           updated_at = $3
       WHERE account_id = $1
         AND id = ANY($2::uuid[]) RETURNING id, version`,
      [auth.accountId, captureIds, decidedAt],
    );
    if (request.decision === "expire") {
      for (const capture of advanced.rows) {
        await client.query(`INSERT INTO source_natural_epoch_transitions(account_id,capture_id,from_version,to_version,transition_kind,occurred_at)
          VALUES($1,$2,$3,$4,'authorization_expired',$5)`, [auth.accountId, capture.id, capture.version - 1, capture.version, decidedAt]);
      }
    }
    if (request.decision === "revoke") {
      // Only an explicit human revoke permanently invalidates accepted Memory.
      // Natural authorization expiry ("expire") keeps the independently
      // retained minimal evidence available, matching the retention contract.
      // The tombstone is epoch-scoped to the revoked capture version, so a
      // later restore can stage fresh evidence while the old accepted epoch
      // stays gone.
      await invalidateMemoriesForCaptureIds(
        client,
        auth.accountId,
        captureIds,
        "source_revoked",
        new Map(lineage.rows.map((capture) => [capture.id, capture.version])),
      );
    }
    if (request.decision === "restore") {
      await client.query(
        `UPDATE evidence_fragments
         SET review_status = 'proposed'
         WHERE account_id = $1
           AND capture_id = ANY($2::uuid[])
           AND status = 'active'
           AND review_status = 'reviewed'`,
        [auth.accountId, captureIds],
      );
      await client.query(
        `UPDATE source_resources resources
         SET processing_state = CASE
               WHEN EXISTS (
                 SELECT 1
                 FROM evidence_fragments fragments
                 WHERE fragments.account_id = resources.account_id
                   AND fragments.resource_id = resources.id
                   AND fragments.status = 'active'
               )
               THEN 'needs_fact_review'
               ELSE resources.processing_state
             END,
             updated_at = $3
         WHERE resources.account_id = $1
           AND resources.capture_id = ANY($2::uuid[])
           AND resources.processing_state <> 'deleted'`,
        [auth.accountId, captureIds, decidedAt],
      );
    }

    const externalEffects = await client.query<{
      completed_count: number;
      follow_up_count: number;
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE status = 'completed'
         )::integer AS completed_count,
         COUNT(*) FILTER (
           WHERE status IN ('completed', 'executing', 'unknown')
         )::integer AS follow_up_count
       FROM action_proposals
       WHERE account_id = $1
         AND capture_id = ANY($2::uuid[])`,
      [auth.accountId, captureIds],
    );
    const decisionId = randomUUID();
    await client.query(
      `INSERT INTO source_authorization_decisions(
         id, account_id, root_capture_id, decided_by_user_id,
         decision, prior_authorization_state, authorization_state,
         reason, affected_capture_ids, subject_id, assignment_id,
         capture_version, states_retracted, prior_states_reopened,
         claims_reopened, actions_revoked,
         identity_handles_returned_to_review,
         knowledge_snapshots_invalidated, decided_at,
         transition_actor, authorization_expires_at,
         external_effects_requiring_follow_up
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18, $19, $20, $21, $22
       )`,
      [
        decisionId,
        auth.accountId,
        rootCaptureId,
        options.systemActor ? null : auth.userId,
        request.decision,
        root.authorization_state,
        targetState,
        request.reason,
        captureIds,
        root.subject_id,
        root.assignment_id,
        root.version,
        retractedStateIds.length,
        reopenedPriorStateIds.length,
        reopenedClaims.rows.length,
        revokedActionIds.length,
        returnedHandleIds.length,
        invalidatedSnapshots,
        decidedAt,
        options.systemActor ? "system" : "human",
        request.decision === "restore"
          ? restoredAuthorizationExpiresAt
          : root.authorization_expires_at,
        externalEffects.rows[0]?.follow_up_count ?? 0,
      ],
    );
    await client.query(
      `INSERT INTO source_authorization_compilation_jobs(
         id, account_id, decision_id, idempotency_record_id,
         requested_by_user_id, subject_id, assignment_id,
         transition_actor, available_at
       )
       VALUES ($1, $2, $1, $3, $4, $5, $6, $7, $8)`,
      [
        decisionId,
        auth.accountId,
        idempotency.id,
        auth.userId,
        root.subject_id,
        root.assignment_id,
        options.systemActor ? "system" : "human",
        decidedAt,
      ],
    );

    const body: SourceAuthorizationDecisionResponse = {
      contract_version: CONTRACT_VERSION,
      decision_id: decisionId,
      root_capture_id: rootCaptureId,
      affected_capture_ids: captureIds,
      decision: request.decision,
      prior_authorization_state: root.authorization_state,
      authorization_state: targetState,
      authorization_expires_at:
        (
          request.decision === "restore"
            ? restoredAuthorizationExpiresAt
            : root.authorization_expires_at
        )?.toISOString() ?? null,
      person_id: root.subject_id,
      relationship_context_id: root.assignment_id,
      root_capture_version: root.version + 1,
      states_retracted: retractedStateIds.length,
      prior_states_reopened_for_review:
        reopenedPriorStateIds.length,
      claims_reopened: reopenedClaims.rows.length,
      actions_revoked: revokedActionIds.length,
      completed_actions_requiring_follow_up:
        externalEffects.rows[0]?.completed_count ?? 0,
      external_effects_requiring_follow_up:
        externalEffects.rows[0]?.follow_up_count ?? 0,
      identity_handles_returned_to_review:
        returnedHandleIds.length,
      knowledge_snapshots_invalidated: invalidatedSnapshots,
      compilation: null,
      compilation_error: null,
      decided_at: decidedAt.toISOString(),
    };
    await appendAudit(
      client,
      {
        accountId: auth.accountId,
        actorUserId: options.systemActor ? null : auth.userId,
      },
      request.decision === "revoke"
        ? "source.authorization_revoked"
        : request.decision === "expire"
          ? "source.authorization_expired"
          : "source.authorization_restored",
      "capture",
      rootCaptureId,
      {
        decision_id: decisionId,
        person_id: root.subject_id,
        relationship_context_id: root.assignment_id,
        affected_capture_ids: captureIds,
        reason: request.reason,
        states_retracted: body.states_retracted,
        prior_states_reopened_for_review:
          body.prior_states_reopened_for_review,
        claims_reopened: body.claims_reopened,
        actions_revoked: body.actions_revoked,
        external_effects_requiring_follow_up:
          body.external_effects_requiring_follow_up,
        authorization_expires_at:
          body.authorization_expires_at,
        knowledge_snapshots_invalidated:
          invalidatedSnapshots,
      },
    );
    await completeIdempotency(client, idempotency, 201, body);
    return {
      body,
      replayed: false,
      status: 201,
      idempotencyRecordId: idempotency.id,
    };
  });
}

export async function decideCaptureSourceAuthorization(
  pool: Pool,
  auth: AuthContext,
  rootCaptureId: string,
  request: SourceAuthorizationDecisionRequest,
): Promise<SourceAuthorizationMutationResult> {
  const expired = await expireCaptureSourceAuthorizationIfDue(
    pool,
    auth,
    rootCaptureId,
    request.expected_capture_version,
  );
  if (expired && request.decision !== "restore") {
    throw new ApiError(
      409,
      "SOURCE_AUTHORIZATION_ALREADY_EXPIRED",
      "The source authorization expired before this decision. Reload the current source state.",
    );
  }
  return transitionCaptureSourceAuthorization(
    pool,
    auth,
    rootCaptureId,
    expired
      ? {
          ...request,
          expected_capture_version: expired.root_capture_version,
        }
      : request,
  );
}

export interface SourceAuthorizationExpiryResult {
  auth: AuthContext;
  mutation: SourceAuthorizationMutationResult;
}

async function lineageRootCaptureId(
  pool: Pool,
  accountId: string,
  captureId: string,
): Promise<string> {
  const result = await pool.query<{ capture_id: string }>(
    `WITH RECURSIVE ancestors AS (
       SELECT
         resources.id,
         resources.capture_id,
         resources.discovered_from_resource_id,
         0 AS depth
       FROM source_resources resources
       WHERE resources.account_id = $1
         AND resources.capture_id = $2
         AND resources.processing_state <> 'deleted'
       UNION ALL
       SELECT
         parent.id,
         parent.capture_id,
         parent.discovered_from_resource_id,
         ancestors.depth + 1
       FROM ancestors
       JOIN source_resources parent
         ON parent.account_id = $1
        AND parent.id = ancestors.discovered_from_resource_id
       WHERE ancestors.depth < 100
         AND parent.processing_state <> 'deleted'
     )
     SELECT capture_id
     FROM ancestors
     ORDER BY depth DESC, capture_id
     LIMIT 1`,
    [accountId, captureId],
  );
  return result.rows[0]?.capture_id ?? captureId;
}

export async function sweepDueSourceAuthorizations(
  pool: Pool,
  now = new Date(),
): Promise<SourceAuthorizationExpiryResult[]> {
  const due = await pool.query<{
    account_id: string;
    account_slug: string;
    capture_id: string;
    created_by_user_id: string;
    user_email: string;
    authorization_expires_at: Date;
  }>(
    `SELECT
       receipts.account_id,
       accounts.slug AS account_slug,
       receipts.capture_id,
       captures.created_by_user_id,
       users.email AS user_email,
       receipts.authorization_expires_at
     FROM source_retention_receipts receipts
     JOIN captures
       ON captures.account_id = receipts.account_id
      AND captures.id = receipts.capture_id
     JOIN accounts
       ON accounts.id = receipts.account_id
     JOIN users
       ON users.account_id = captures.account_id
      AND users.id = captures.created_by_user_id
     WHERE receipts.authorization_state = 'authorized'
       AND receipts.authorization_expires_at IS NOT NULL
       AND receipts.authorization_expires_at <= $1
       AND captures.status = 'active'
       AND captures.identity_status = 'bound'
       AND users.status = 'active'
     ORDER BY receipts.authorization_expires_at, receipts.capture_id
     LIMIT 100`,
    [now],
  );
  const results: SourceAuthorizationExpiryResult[] = [];
  const seenRoots = new Set<string>();
  for (const item of due.rows) {
    const rootCaptureId = await lineageRootCaptureId(
      pool,
      item.account_id,
      item.capture_id,
    );
    const root = await pool.query<{
      version: number;
      authorization_state: "authorized" | "revoked" | "expired";
      authorization_expires_at: Date | null;
      created_by_user_id: string;
      account_slug: string;
      user_email: string;
    }>(
      `SELECT
         captures.version,
         captures.created_by_user_id,
         receipts.authorization_state,
         receipts.authorization_expires_at,
         accounts.slug AS account_slug,
         users.email AS user_email
       FROM captures
       JOIN source_retention_receipts receipts
         ON receipts.account_id = captures.account_id
        AND receipts.capture_id = captures.id
       JOIN accounts
         ON accounts.id = captures.account_id
       JOIN users
         ON users.account_id = captures.account_id
        AND users.id = captures.created_by_user_id
       WHERE captures.account_id = $1
         AND captures.id = $2`,
      [item.account_id, rootCaptureId],
    );
    const rootRow = root.rows[0];
    if (
      !rootRow ||
      seenRoots.has(rootCaptureId) ||
      rootRow.authorization_state !== "authorized" ||
      !rootRow.authorization_expires_at ||
      rootRow.authorization_expires_at > now
    ) {
      continue;
    }
    seenRoots.add(rootCaptureId);
    const auth: AuthContext = {
      accountId: item.account_id,
      accountSlug: rootRow.account_slug,
      userId: rootRow.created_by_user_id,
      userEmail: rootRow.user_email,
      userKind: "simulated_human",
      sessionId: "system:source-authorization-expiry",
    };
    try {
      const mutation = await transitionCaptureSourceAuthorization(
        pool,
        auth,
        rootCaptureId,
        {
          idempotency_key:
            `authorization-expiry:${rootCaptureId}:${rootRow.authorization_expires_at.toISOString()}`,
          expected_capture_version: rootRow.version,
          decision: "expire",
          reason: "The governed source-authorization deadline elapsed.",
        },
        { systemActor: true, occurredAt: now },
      );
      results.push({ auth, mutation });
    } catch (error) {
      if (
        error instanceof ApiError &&
        [
          "SOURCE_AUTHORIZATION_STALE",
          "SOURCE_AUTHORIZATION_NOT_DUE",
          "SOURCE_AUTHORIZATION_UNCHANGED",
        ].includes(error.code)
      ) {
        continue;
      }
      throw error;
    }
  }
  return results;
}

async function compileExpiredSourceAuthorization(
  pool: Pool,
  expiration: SourceAuthorizationExpiryResult,
): Promise<SourceAuthorizationDecisionResponse> {
  let body = expiration.mutation.body;
  try {
    const compilation = await compileRelationshipWiki(
      pool,
      expiration.auth,
      body.person_id,
      body.relationship_context_id,
      {
        idempotency_key:
          `source-authorization-${body.decision_id}`,
        objective:
          "Rebuild the relationship Wiki after source authorization expired, excluding every dependent conclusion while preserving surviving authorized evidence.",
      },
      { auditActorUserId: null },
    );
    body = {
      ...body,
      compilation: {
        snapshot_id: compilation.body.id,
        status: compilation.body.status,
        verdict: compilation.body.quality.verdict,
        block_count: compilation.body.blocks.length,
      },
    };
  } catch {
    body = {
      ...body,
      compilation_error: RELATIONSHIP_WIKI_EXPIRY_COMPILATION_FAILED,
    };
  }
  await persistSourceAuthorizationCompilation(
    pool,
    expiration.mutation.idempotencyRecordId,
    body,
  );
  return body;
}

async function expireCaptureSourceAuthorizationIfDue(
  pool: Pool,
  auth: AuthContext,
  rootCaptureId: string,
  expectedCaptureVersion: number,
  now = new Date(),
): Promise<SourceAuthorizationDecisionResponse | null> {
  const due = await pool.query<{
    version: number;
    authorization_state: "authorized" | "revoked" | "expired";
    authorization_expires_at: Date | null;
  }>(
    `SELECT
       captures.version,
       receipts.authorization_state,
       receipts.authorization_expires_at
     FROM captures
     JOIN source_retention_receipts receipts
       ON receipts.account_id = captures.account_id
      AND receipts.capture_id = captures.id
     WHERE captures.account_id = $1
       AND captures.id = $2`,
    [auth.accountId, rootCaptureId],
  );
  const row = due.rows[0];
  if (
    !row ||
    row.version !== expectedCaptureVersion ||
    row.authorization_state !== "authorized" ||
    !row.authorization_expires_at ||
    row.authorization_expires_at > now
  ) {
    return null;
  }
  const mutation = await transitionCaptureSourceAuthorization(
    pool,
    auth,
    rootCaptureId,
    {
      idempotency_key:
        `authorization-expiry:${rootCaptureId}:${row.authorization_expires_at.toISOString()}`,
      expected_capture_version: row.version,
      decision: "expire",
      reason: "The governed source-authorization deadline elapsed.",
    },
    { systemActor: true, occurredAt: now },
  );
  return compileExpiredSourceAuthorization(pool, { auth, mutation });
}

export async function sweepAndRecompileDueSourceAuthorizations(
  pool: Pool,
  now = new Date(),
): Promise<SourceAuthorizationDecisionResponse[]> {
  const expirations = await sweepDueSourceAuthorizations(pool, now);
  const completed: SourceAuthorizationDecisionResponse[] = [];
  for (const expiration of expirations) {
    completed.push(
      await compileExpiredSourceAuthorization(pool, expiration),
    );
  }
  return completed;
}

export async function persistSourceAuthorizationCompilation(
  pool: Pool,
  idempotencyRecordId: string,
  body: SourceAuthorizationDecisionResponse,
  options: { leaseOwner?: string } = {},
): Promise<void> {
  await inTransaction(pool, async (client) => {
    const completed = body.compilation !== null;
    const retry = !completed && body.compilation_error !== null;
    const job = await client.query<{ id: string }>(
      `UPDATE source_authorization_compilation_jobs
       SET status = CASE
             WHEN $3::boolean THEN 'completed'
             WHEN $4::boolean THEN 'retry'
             ELSE status
           END,
           knowledge_snapshot_id = CASE
             WHEN $3::boolean THEN $5::uuid
             WHEN $4::boolean THEN NULL
             ELSE knowledge_snapshot_id
           END,
           completed_at = CASE
             WHEN $3::boolean THEN now()
             WHEN $4::boolean THEN NULL
             ELSE completed_at
           END,
           available_at = CASE
             WHEN $4::boolean THEN
               now() + make_interval(
                 secs => LEAST(
                   3600,
                   5 * power(2, LEAST(attempt_count, 9))::integer
                 )
               )
             ELSE available_at
           END,
           lease_owner = CASE
             WHEN $3::boolean OR $4::boolean THEN NULL
             ELSE lease_owner
           END,
           lease_expires_at = CASE
             WHEN $3::boolean OR $4::boolean THEN NULL
             ELSE lease_expires_at
           END,
           last_error = CASE
             WHEN $3::boolean THEN NULL
             WHEN $4::boolean THEN $6
             ELSE last_error
           END,
           updated_at = now()
       WHERE idempotency_record_id = $1
         AND (
           (
             $2::text IS NULL
             AND status IN ('pending', 'retry')
           )
           OR
           (
             $2::text IS NOT NULL
             AND status = 'running'
             AND lease_owner = $2
           )
         )
       RETURNING id`,
      [
        idempotencyRecordId,
        options.leaseOwner ?? null,
        completed,
        retry,
        body.compilation?.snapshot_id ?? null,
        body.compilation_error,
      ],
    );
    if (!job.rows[0]) {
      return;
    }
    await client.query(
      `UPDATE idempotency_records
       SET response_body = $2
       WHERE id = $1
         AND status = 'completed'`,
      [idempotencyRecordId, body],
    );
  });
}

interface SourceAuthorizationCompilationJob {
  id: string;
  account_id: string;
  account_slug: string;
  decision_id: string;
  idempotency_record_id: string;
  requested_by_user_id: string;
  user_email: string;
  subject_id: string;
  assignment_id: string;
  transition_actor: "human" | "system";
  decision: "revoke" | "restore" | "expire";
  response_body: SourceAuthorizationDecisionResponse;
  lease_owner: string;
}

function sourceAuthorizationCompilationObjective(
  decision: SourceAuthorizationCompilationJob["decision"],
): string {
  if (decision === "revoke") {
    return "Rebuild the relationship Wiki without evidence whose source authorization was revoked.";
  }
  if (decision === "restore") {
    return "Rebuild the relationship Wiki after restoring the source as reviewable evidence without restoring prior conclusions or actions.";
  }
  return "Rebuild the relationship Wiki after source authorization expired, excluding every dependent conclusion while preserving surviving authorized evidence.";
}

async function claimSourceAuthorizationCompilationJob(
  pool: Pool,
  workerId: string,
  now: Date,
  leaseDurationMs: number,
): Promise<SourceAuthorizationCompilationJob | null> {
  return inTransaction(pool, async (client) => {
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    const claimed = await client.query<SourceAuthorizationCompilationJob>(
      `WITH candidate AS (
         SELECT jobs.id
         FROM source_authorization_compilation_jobs jobs
         WHERE (
             jobs.status IN ('pending', 'retry')
             AND jobs.available_at <= $1
           )
           OR (
             jobs.status = 'running'
             AND jobs.lease_expires_at <= $1
           )
         ORDER BY
           CASE WHEN jobs.status = 'running' THEN 0 ELSE 1 END,
           COALESCE(jobs.lease_expires_at, jobs.available_at),
           jobs.created_at,
           jobs.id
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       ),
       leased AS (
         UPDATE source_authorization_compilation_jobs jobs
         SET status = 'running',
             attempt_count = jobs.attempt_count + 1,
             lease_owner = $2,
             lease_expires_at = $3,
             updated_at = $1
         FROM candidate
         WHERE jobs.id = candidate.id
         RETURNING jobs.*
       )
       SELECT
         leased.id,
         leased.account_id,
         accounts.slug AS account_slug,
         leased.decision_id,
         leased.idempotency_record_id,
         leased.requested_by_user_id,
         users.email AS user_email,
         leased.subject_id,
         leased.assignment_id,
         leased.transition_actor,
         decisions.decision,
         idempotency.response_body,
         leased.lease_owner
       FROM leased
       JOIN accounts
         ON accounts.id = leased.account_id
       JOIN users
         ON users.account_id = leased.account_id
        AND users.id = leased.requested_by_user_id
       JOIN source_authorization_decisions decisions
         ON decisions.account_id = leased.account_id
        AND decisions.id = leased.decision_id
       JOIN idempotency_records idempotency
         ON idempotency.account_id = leased.account_id
        AND idempotency.id = leased.idempotency_record_id
        AND idempotency.status = 'completed'`,
      [now, workerId, leaseExpiresAt],
    );
    return claimed.rows[0] ?? null;
  });
}

async function retryUnresolvedSourceAuthorizationCompilationJob(
  pool: Pool,
  job: SourceAuthorizationCompilationJob,
  message: string,
): Promise<void> {
  await pool.query(
    `UPDATE source_authorization_compilation_jobs
     SET status = 'retry',
         available_at = now() + make_interval(
           secs => LEAST(
             3600,
             5 * power(2, LEAST(attempt_count, 9))::integer
           )
         ),
         lease_owner = NULL,
         lease_expires_at = NULL,
         last_error = $3,
         updated_at = now()
     WHERE id = $1
       AND status = 'running'
       AND lease_owner = $2`,
    [job.id, job.lease_owner, message.slice(0, 500)],
  );
}

export interface SourceAuthorizationCompilationWorkerResult {
  claimed: number;
  completed: number;
  retried: number;
}

export async function runPendingSourceAuthorizationCompilationJobs(
  pool: Pool,
  options: {
    now?: Date;
    limit?: number;
    leaseDurationMs?: number;
    workerId?: string;
  } = {},
): Promise<SourceAuthorizationCompilationWorkerResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 100));
  const leaseDurationMs = Math.max(
    5_000,
    options.leaseDurationMs ?? 60_000,
  );
  const workerId =
    options.workerId ?? `source-authorization-worker:${randomUUID()}`;
  const result: SourceAuthorizationCompilationWorkerResult = {
    claimed: 0,
    completed: 0,
    retried: 0,
  };
  for (let index = 0; index < limit; index += 1) {
    const claimAt = options.now ?? new Date();
    const job = await claimSourceAuthorizationCompilationJob(
      pool,
      workerId,
      claimAt,
      leaseDurationMs,
    );
    if (!job) {
      break;
    }
    result.claimed += 1;
    const auth: AuthContext = {
      accountId: job.account_id,
      accountSlug: job.account_slug,
      userId: job.requested_by_user_id,
      userEmail: job.user_email,
      userKind: "simulated_human",
      sessionId: "system:source-authorization-compilation-worker",
    };
    if (
      !job.response_body ||
      job.response_body.decision_id !== job.decision_id
    ) {
      await retryUnresolvedSourceAuthorizationCompilationJob(
        pool,
        job,
        "The durable authorization decision response was unavailable.",
      );
      result.retried += 1;
      continue;
    }
    let body = job.response_body;
    try {
      const compilation = await compileRelationshipWiki(
        pool,
        auth,
        job.subject_id,
        job.assignment_id,
        {
          idempotency_key:
            `source-authorization-${job.decision_id}`,
          objective: sourceAuthorizationCompilationObjective(
            job.decision,
          ),
        },
        {
          auditActorUserId:
            job.transition_actor === "system"
              ? null
              : job.requested_by_user_id,
        },
      );
      body = {
        ...body,
        compilation: {
          snapshot_id: compilation.body.id,
          status: compilation.body.status,
          verdict: compilation.body.quality.verdict,
          block_count: compilation.body.blocks.length,
        },
        compilation_error: null,
      };
      await persistSourceAuthorizationCompilation(
        pool,
        job.idempotency_record_id,
        body,
        { leaseOwner: workerId },
      );
      result.completed += 1;
    } catch {
      body = {
        ...body,
        compilation: null,
        compilation_error: RELATIONSHIP_WIKI_COMPILATION_FAILED,
      };
      await persistSourceAuthorizationCompilation(
        pool,
        job.idempotency_record_id,
        body,
        { leaseOwner: workerId },
      );
      result.retried += 1;
    }
  }
  return result;
}
