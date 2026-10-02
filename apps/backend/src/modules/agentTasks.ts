import { randomUUID } from "node:crypto";

import {
  fingerprint,
  resolveProductPrompt, bundledPrompt,
  type AgentProvider,
} from "@talent-signal/agent";
import {
  CONTRACT_VERSION,
  type AgentBriefingArtifact,
  type AgentDecisionResolutionResponse,
  type AgentRun,
  type AgentTaskEvent,
  type AgentTaskEventsResponse,
  type AgentTaskListResponse,
  type AgentTaskProjection,
  type AgentTaskResponse,
  type AgentTaskStatus,
  type CancelAgentTaskRequest,
  type CreatePursuitAgentTaskRequest,
  type ResolveAgentDecisionBundleRequest,
  type TelemetryContext,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import {
  inTransaction,
  type DatabaseClient,
} from "../database/pool.js";
import { appendAudit } from "../lib/audit.js";
import { ApiError } from "../lib/apiError.js";
import {
  claimIdempotency,
  completeIdempotency,
} from "../lib/idempotency.js";
import type { AuthContext } from "./auth.js";
import {
  configuredAgentProvider,
  createPursuitAgentRun,
  pursuitAgentSemanticIdentity,
} from "./agentRuns.js";
import { compileAgentScope } from "./agentGateway.js";
import type { MutationResult } from "./captures.js";
import { readPursuit } from "./pursuits.js";
import { reviewPursuitProposal } from "./pursuitProposals.js";

const TASK_PERMISSION_CEILING = [
  "read_pursuit",
  "read_evidence",
  "create_briefing_artifact",
  "stage_pursuit_proposal",
  "record_no_action",
] as const;
const TASK_LEASE_MS = 45_000;
const ARTIFACT_TTL_MS = 24 * 60 * 60 * 1_000;
const DECISION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const activeTaskControllers = new Map<string, AbortController>();

type SemanticSnapshot = AgentTaskProjection["semantic_snapshot"];

interface AgentTaskRow {
  id: string;
  account_id: string;
  pursuit_id: string;
  capture_id: string;
  requested_by_user_id: string;
  kind: "pre_call_briefing";
  objective: string;
  task_revision: number;
  status: AgentTaskStatus;
  permission_ceiling: AgentTaskProjection["permission_ceiling"];
  semantic_snapshot: SemanticSnapshot;
  evidence_refs: string[];
  input_artifact_refs: string[];
  telemetry: TelemetryContext | null;
  active_attempt: number | null;
  lease_owner: string | null;
  lease_epoch: number;
  lease_expires_at: Date | string | null;
  continue_allowed: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
}

interface AgentTaskRunRow {
  id: string;
  task_id: string;
  attempt: number;
  expected_task_revision: number;
  status: NonNullable<AgentTaskProjection["latest_run"]>["status"];
  agent_run_id: string | null;
  run_idempotency_key: string;
  snapshot_digest: string;
  lease_epoch: number;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  agent_run_status: NonNullable<
    AgentTaskProjection["latest_run"]
  >["agent_run_status"];
  terminal_receipt: {
    reason_code: string;
    proposal_id: string | null;
    no_action_id: string | null;
  } | null;
}

interface AgentArtifactRow {
  id: string;
  task_id: string;
  agent_run_id: string | null;
  type: "pursuit_briefing";
  authority: "non_canonical";
  effective_status: AgentBriefingArtifact["status"];
  title: string;
  content: Omit<
    AgentBriefingArtifact,
    | "id"
    | "task_id"
    | "run_id"
    | "type"
    | "authority"
    | "status"
    | "title"
    | "evidence_manifest_digest"
    | "observed_at"
    | "expires_at"
  >;
  evidence_manifest_digest: string;
  observed_at: Date | string;
  expires_at: Date | string;
}

interface ClarificationRow {
  id: string;
  task_id: string;
  task_revision: number;
  request_revision: number;
  question: string;
  reason: string;
  response_schema: Record<string, unknown>;
  status: "open" | "answered" | "expired" | "cancelled";
  expires_at: Date | string;
}

interface DecisionBundleRow {
  id: string;
  task_id: string;
  task_revision: number;
  bundle_revision: number;
  dependency: string;
  status: "open" | "partially_resolved" | "resolved" | "expired" | "cancelled";
  proposal_id: string | null;
  expires_at: Date | string;
}

interface DecisionItemRow {
  id: string;
  domain_subject_kind:
    | "pursuit_proposal_item"
    | "fact_decision"
    | "action_approval";
  domain_subject_id: string;
  item_revision: number;
  status:
    | "open"
    | "accepted"
    | "edited"
    | "rejected"
    | "kept_unresolved"
    | "expired";
  domain_receipt_ref: string | null;
}

interface EventRow {
  event_id: string;
  account_id: string;
  task_id: string;
  run_id: string | null;
  task_sequence: number;
  stream_cursor: string | number;
  name: AgentTaskEvent["name"];
  occurred_at: Date | string;
  schema_version: 1;
  public_payload: Record<string, unknown>;
}

interface EvidenceExcerptRow {
  fragment_id: string;
  text_content: string;
  content_hash: string;
  observed_at: Date | string;
  source_display_name: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function optionalIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function compactEvidence(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= 320
    ? normalized
    : `${normalized.slice(0, 317).trimEnd()}…`;
}

async function appendTaskEvent(
  client: PoolClient,
  task: Pick<AgentTaskRow, "id" | "account_id">,
  name: AgentTaskEvent["name"],
  publicPayload: Record<string, unknown>,
  runID: string | null = null,
): Promise<{ sequence: number; cursor: string }> {
  const sequenceResult = await client.query<{ next_sequence: number }>(
    `SELECT COALESCE(MAX(task_sequence), 0)::int + 1 AS next_sequence
     FROM agent_task_events
     WHERE account_id = $1 AND task_id = $2`,
    [task.account_id, task.id],
  );
  const sequence = sequenceResult.rows[0]?.next_sequence ?? 1;
  const eventID = randomUUID();
  const occurredAt = new Date().toISOString();
  await client.query(
    `INSERT INTO agent_task_events(
       event_id, account_id, task_id, run_id, task_sequence, name,
       public_payload, schema_version, occurred_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 1, $8)`,
    [
      eventID,
      task.account_id,
      task.id,
      runID,
      sequence,
      name,
      JSON.stringify(publicPayload),
      occurredAt,
    ],
  );
  const outbox = await client.query<{ stream_cursor: string | number }>(
    `INSERT INTO agent_delivery_outbox(
       account_id, task_id, task_sequence, event_id, payload
     )
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING stream_cursor`,
    [
      task.account_id,
      task.id,
      sequence,
      eventID,
      JSON.stringify({
        event_id: eventID,
        task_id: task.id,
        task_sequence: sequence,
        name,
        occurred_at: occurredAt,
        schema_version: 1,
        public_payload: publicPayload,
      }),
    ],
  );
  return {
    sequence,
    cursor: String(outbox.rows[0]?.stream_cursor ?? 0),
  };
}

async function readTaskProjection(
  client: DatabaseClient,
  auth: Pick<AuthContext, "accountId">,
  taskID: string,
): Promise<AgentTaskProjection> {
  const taskResult = await client.query<AgentTaskRow>(
    `SELECT * FROM agent_tasks
     WHERE account_id = $1 AND id = $2`,
    [auth.accountId, taskID],
  );
  const task = taskResult.rows[0];
  if (!task) {
    throw new ApiError(404, "AGENT_TASK_NOT_FOUND", "The Agent Task was not found.");
  }

  const runResult = await client.query<AgentTaskRunRow>(
    `SELECT links.*,
            runs.status AS agent_run_status,
            runs.terminal_receipt
     FROM agent_task_runs links
     LEFT JOIN agent_runs runs
       ON runs.account_id = links.account_id
      AND runs.id = links.agent_run_id
     WHERE links.account_id = $1 AND links.task_id = $2
     ORDER BY links.attempt DESC
     LIMIT 1`,
    [auth.accountId, taskID],
  );
  const taskRun = runResult.rows[0] ?? null;

  const artifactResult = await client.query<AgentArtifactRow>(
    `SELECT artifacts.*,
            CASE
              WHEN artifacts.status = 'current'
               AND (
                 artifacts.expires_at <= now()
                 OR EXISTS (
                   SELECT 1
                   FROM agent_artifact_evidence links
                   LEFT JOIN evidence_fragments fragments
                     ON fragments.account_id = links.account_id
                    AND fragments.id = links.fragment_id
                   LEFT JOIN source_resources resources
                     ON resources.account_id = fragments.account_id
                    AND resources.id = fragments.resource_id
                   LEFT JOIN captures
                     ON captures.account_id = fragments.account_id
                    AND captures.id = fragments.capture_id
                   LEFT JOIN source_retention_receipts receipts
                     ON receipts.account_id = fragments.account_id
                    AND receipts.capture_id = fragments.capture_id
                   WHERE links.account_id = artifacts.account_id
                     AND links.artifact_id = artifacts.id
                     AND (
                       fragments.id IS NULL
                       OR fragments.status <> 'active'
                       OR fragments.review_status <> 'reviewed'
                       OR fragments.attribution_status <> 'confirmed'
                       OR fragments.content_hash <> links.content_hash
                       OR resources.processing_state = 'deleted'
                       OR captures.status <> 'active'
                       OR receipts.source_access_state = 'deleted'
                       OR receipts.authorization_state <> 'authorized'
                       OR (
                         receipts.authorization_expires_at IS NOT NULL
                         AND receipts.authorization_expires_at <= now()
                       )
                     )
                 )
               ) THEN 'stale'
              ELSE artifacts.status
            END AS effective_status
     FROM agent_artifacts artifacts
     WHERE artifacts.account_id = $1 AND artifacts.task_id = $2
     ORDER BY artifacts.created_at DESC, artifacts.id DESC
     LIMIT 1`,
    [auth.accountId, taskID],
  );
  const artifact = artifactResult.rows[0] ?? null;

  const clarificationResult = await client.query<ClarificationRow>(
    `SELECT id, task_id, task_revision, request_revision, question, reason,
            response_schema, status, expires_at
     FROM agent_clarification_requests
     WHERE account_id = $1 AND task_id = $2
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [auth.accountId, taskID],
  );
  const clarification = clarificationResult.rows[0] ?? null;

  const bundleResult = await client.query<DecisionBundleRow>(
    `SELECT id, task_id, task_revision, bundle_revision, dependency, status,
            proposal_id, expires_at
     FROM agent_decision_bundles
     WHERE account_id = $1 AND task_id = $2
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [auth.accountId, taskID],
  );
  const bundle = bundleResult.rows[0] ?? null;
  const itemResult = bundle
    ? await client.query<DecisionItemRow>(
        `SELECT id, domain_subject_kind, domain_subject_id, item_revision,
                status, domain_receipt_ref
         FROM agent_decision_items
         WHERE account_id = $1 AND bundle_id = $2
         ORDER BY created_at, id`,
        [auth.accountId, bundle.id],
      )
    : { rows: [] as DecisionItemRow[] };

  const cursorResult = await client.query<{
    latest_sequence: number;
    latest_cursor: string | number;
  }>(
    `SELECT
       COALESCE(MAX(events.task_sequence), 0)::int AS latest_sequence,
       COALESCE(MAX(outbox.stream_cursor), 0)::text AS latest_cursor
     FROM agent_task_events events
     LEFT JOIN agent_delivery_outbox outbox
       ON outbox.account_id = events.account_id
      AND outbox.event_id = events.event_id
     WHERE events.account_id = $1 AND events.task_id = $2`,
    [auth.accountId, taskID],
  );
  const cursor = cursorResult.rows[0] ?? {
    latest_sequence: 0,
    latest_cursor: "0",
  };

  const mappedArtifact: AgentBriefingArtifact | null = artifact
    ? {
        id: artifact.id,
        task_id: artifact.task_id,
        run_id: artifact.agent_run_id,
        type: artifact.type,
        authority: artifact.authority,
        status: artifact.effective_status,
        title: artifact.title,
        ...artifact.content,
        what_changed:
          artifact.effective_status === "stale"
            ? artifact.content.what_changed.map((claim) => ({
                ...claim,
                epistemic_status:
                  claim.authority === "reviewed_evidence"
                    ? ("stale" as const)
                    : claim.epistemic_status,
                freshness:
                  claim.authority === "reviewed_evidence"
                    ? ("unavailable" as const)
                    : claim.freshness,
              }))
            : artifact.content.what_changed,
        evidence_manifest_digest: artifact.evidence_manifest_digest,
        observed_at: iso(artifact.observed_at),
        expires_at: iso(artifact.expires_at),
      }
    : null;

  // Source authorization is evaluated again at read time. A historical Task
  // row may still say it is waiting for a decision, but a now-stale Artifact
  // must never keep presenting that decision as current authority. Preserve
  // the stored history and project the safe refresh state to every client.
  const projectedStatus: AgentTaskStatus =
    mappedArtifact?.status === "stale" &&
    [
      "active",
      "waiting_for_clarification",
      "waiting_for_domain_decision",
      "waiting_for_external",
    ].includes(task.status)
      ? "needs_rebase"
      : task.status;

  return {
    id: task.id,
    workspace_id: task.account_id,
    pursuit_id: task.pursuit_id,
    requested_by_user_id: task.requested_by_user_id,
    kind: task.kind,
    objective: task.objective,
    task_revision: task.task_revision,
    status: projectedStatus,
    permission_ceiling: task.permission_ceiling,
    semantic_snapshot: task.semantic_snapshot,
    latest_run: taskRun
      ? {
          id: taskRun.agent_run_id,
          attempt: taskRun.attempt,
          status: taskRun.status,
          agent_run_status: taskRun.agent_run_status,
          reason_code: taskRun.terminal_receipt?.reason_code ?? null,
          proposal_id: taskRun.terminal_receipt?.proposal_id ?? null,
          no_action_id: taskRun.terminal_receipt?.no_action_id ?? null,
        }
      : null,
    artifact: mappedArtifact,
    clarification: clarification
      ? {
          id: clarification.id,
          task_id: clarification.task_id,
          task_revision: clarification.task_revision,
          request_revision: clarification.request_revision,
          question: clarification.question,
          reason: clarification.reason,
          response_schema: clarification.response_schema,
          status: clarification.status,
          expires_at: iso(clarification.expires_at),
        }
      : null,
    decision_bundle: bundle
      ? {
          id: bundle.id,
          task_id: bundle.task_id,
          task_revision: bundle.task_revision,
          bundle_revision: bundle.bundle_revision,
          dependency: bundle.dependency,
          status: bundle.status,
          proposal_id: bundle.proposal_id,
          items: itemResult.rows,
          expires_at: iso(bundle.expires_at),
        }
      : null,
    latest_sequence: Number(cursor.latest_sequence),
    latest_cursor: String(cursor.latest_cursor),
    continue_allowed: task.continue_allowed,
    external_effects: [],
    created_at: iso(task.created_at),
    updated_at: iso(task.updated_at),
    completed_at: optionalIso(task.completed_at),
  };
}

async function taskAuthContext(
  client: DatabaseClient,
  task: AgentTaskRow,
): Promise<AuthContext> {
  const result = await client.query<{
    account_slug: string;
    user_email: string;
    user_kind: AuthContext["userKind"];
  }>(
    `SELECT accounts.slug AS account_slug,
            users.email AS user_email,
            users.kind AS user_kind
     FROM accounts
     JOIN users ON users.account_id = accounts.id
     WHERE accounts.id = $1 AND users.id = $2`,
    [task.account_id, task.requested_by_user_id],
  );
  const identity = result.rows[0];
  if (!identity) {
    throw new ApiError(
      409,
      "AGENT_TASK_PRINCIPAL_UNAVAILABLE",
      "The Task principal is no longer available.",
    );
  }
  return {
    accountId: task.account_id,
    accountSlug: identity.account_slug,
    userId: task.requested_by_user_id,
    userEmail: identity.user_email,
    userKind: identity.user_kind,
    sessionId: `agent-task:${task.id}`,
  };
}

function scheduleTask(
  pool: Pool,
  taskID: string,
  provider?: AgentProvider,
): void {
  setImmediate(() => {
    void executeAgentTask(pool, taskID, provider).catch(() => undefined);
  });
}

export async function createPursuitAgentTask(
  pool: Pool,
  auth: AuthContext,
  pursuitID: string,
  request: CreatePursuitAgentTaskRequest,
  options: { provider?: AgentProvider; schedule?: boolean } = {},
): Promise<MutationResult<AgentTaskResponse>> {
  const provider = options.provider ?? configuredAgentProvider();
  const promptSnapshot = await resolveProductPrompt("pursuit/proposal");
  const taskID = randomUUID();
  const objective = request.objective.trim();
  const result = await inTransaction(pool, async (client) => {
    const idempotency = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      `create_pursuit_agent_task:${pursuitID}`,
      request.idempotency_key,
      request,
    );
    if (idempotency.replay) {
      return {
        body: idempotency.replay.body as AgentTaskResponse,
        replayed: true,
        status: idempotency.replay.status,
      };
    }

    const scope = await compileAgentScope(client, auth, {
      runID: taskID,
      pursuitID,
      pursuitRevision: request.expected_revision,
      captureID: request.capture_id,
      objective,
      evidenceRefs: request.evidence_refs,
      inputArtifactManifest: [],
    });
    const identity = pursuitAgentSemanticIdentity(provider, promptSnapshot.text);
    const semanticSnapshot: SemanticSnapshot = {
      pursuit_revision: scope.pursuitRevision,
      evidence_manifest_digest: fingerprint(scope.evidenceManifest),
      agent_definition_digest: identity.agentDefinitionDigest,
      prompt_snapshot: promptSnapshot,
      tool_schema_digest: identity.toolSchemaDigest,
      policy_digest: identity.policyDigest,
      model_digest: identity.modelDigest,
      created_at: new Date().toISOString(),
    };
    const objectiveDigest = fingerprint(objective);
    const scopeDigest = fingerprint({
      pursuitID,
      captureID: request.capture_id,
      evidenceRefs: request.evidence_refs,
    });

    try {
      await client.query(
        `INSERT INTO agent_tasks(
           id, account_id, pursuit_id, capture_id, requested_by_user_id,
           idempotency_record_id, kind, objective, objective_digest,
           scope_digest, task_revision, status, permission_ceiling,
           semantic_snapshot, evidence_refs, input_artifact_refs, telemetry
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, 'pre_call_briefing', $7, $8, $9,
           1, 'active', $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
           $14::jsonb
         )`,
        [
          taskID,
          auth.accountId,
          pursuitID,
          request.capture_id,
          auth.userId,
          idempotency.id,
          objective,
          objectiveDigest,
          scopeDigest,
          JSON.stringify(TASK_PERMISSION_CEILING),
          JSON.stringify(semanticSnapshot),
          JSON.stringify(request.evidence_refs),
          JSON.stringify(request.input_artifact_refs ?? []),
          request.telemetry ? JSON.stringify(request.telemetry) : null,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM agent_tasks
           WHERE account_id = $1
             AND pursuit_id = $2
             AND kind = 'pre_call_briefing'
             AND objective_digest = $3
             AND scope_digest = $4
             AND status IN (
               'active', 'waiting_for_clarification',
               'waiting_for_domain_decision', 'waiting_for_external',
               'needs_rebase'
             )
           LIMIT 1`,
          [auth.accountId, pursuitID, objectiveDigest, scopeDigest],
        );
        throw new ApiError(
          409,
          "AGENT_TASK_ALREADY_ACTIVE",
          "An equivalent governed Task is already active.",
          { task_id: existing.rows[0]?.id ?? null },
        );
      }
      throw error;
    }
    const insertedTask = (await client.query<AgentTaskRow>(
      `SELECT * FROM agent_tasks WHERE account_id = $1 AND id = $2 FOR UPDATE`,
      [auth.accountId, taskID],
    )).rows[0];
    if (!insertedTask) throw new Error("The accepted Agent Task was not persisted.");
    await appendTaskEvent(client, insertedTask, "task.accepted", {
      kind: insertedTask.kind,
      pursuit_revision: semanticSnapshot.pursuit_revision,
      evidence_reference_count: request.evidence_refs.length,
      external_effect_count: 0,
    });
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "agent_task_accepted",
      "agent_task",
      taskID,
      {
        pursuit_id: pursuitID,
        task_kind: insertedTask.kind,
        pursuit_revision: semanticSnapshot.pursuit_revision,
        evidence_reference_count: request.evidence_refs.length,
        external_effect_count: 0,
      },
    );
    const body: AgentTaskResponse = {
      contract_version: CONTRACT_VERSION,
      task: await readTaskProjection(client, auth, taskID),
    };
    await completeIdempotency(client, idempotency, 202, body);
    return { body, replayed: false, status: 202 };
  });

  if (!result.replayed && options.schedule !== false) {
    scheduleTask(pool, taskID, provider);
  }
  return result;
}

interface ClaimedTask {
  task: AgentTaskRow;
  taskRun: AgentTaskRunRow;
  auth: AuthContext;
  workerID: string;
  leaseEpoch: number;
}

async function claimTask(
  pool: Pool,
  taskID: string,
): Promise<ClaimedTask | null> {
  return inTransaction(pool, async (client) => {
    const task = (await client.query<AgentTaskRow>(
      `SELECT * FROM agent_tasks
       WHERE id = $1
       FOR UPDATE`,
      [taskID],
    )).rows[0];
    if (!task || task.status !== "active") return null;
    if (
      task.lease_owner &&
      task.lease_expires_at &&
      new Date(task.lease_expires_at).getTime() > Date.now()
    ) {
      return null;
    }
    const workerID = randomUUID();
    const leaseEpoch = task.lease_epoch + 1;
    const latest = (await client.query<AgentTaskRunRow>(
      `SELECT links.*, NULL::text AS agent_run_status,
              NULL::jsonb AS terminal_receipt
       FROM agent_task_runs links
       WHERE links.account_id = $1 AND links.task_id = $2
       ORDER BY attempt DESC
       LIMIT 1
       FOR UPDATE`,
      [task.account_id, task.id],
    )).rows[0];
    const reusable =
      latest &&
      ["scheduled", "running"].includes(latest.status) &&
      latest.expected_task_revision === task.task_revision;
    const attempt = reusable ? latest.attempt : (latest?.attempt ?? 0) + 1;
    const taskRunID = reusable ? latest.id : randomUUID();
    const runIdempotencyKey = reusable
      ? latest.run_idempotency_key
      : `agent-task:${task.id}:attempt:${attempt}`;
    const snapshotDigest = fingerprint(task.semantic_snapshot);
    if (reusable) {
      await client.query(
        `UPDATE agent_task_runs
         SET status = 'running', lease_epoch = $4,
             started_at = COALESCE(started_at, now())
         WHERE account_id = $1 AND id = $2 AND task_id = $3`,
        [task.account_id, taskRunID, task.id, leaseEpoch],
      );
    } else {
      await client.query(
        `INSERT INTO agent_task_runs(
           id, account_id, task_id, attempt, expected_task_revision, status,
           run_idempotency_key, snapshot_digest, lease_epoch, started_at
         )
         VALUES ($1, $2, $3, $4, $5, 'running', $6, $7, $8, now())`,
        [
          taskRunID,
          task.account_id,
          task.id,
          attempt,
          task.task_revision,
          runIdempotencyKey,
          snapshotDigest,
          leaseEpoch,
        ],
      );
      await client.query(
        `INSERT INTO agent_task_checkpoints(
           id, account_id, task_id, task_run_id, checkpoint_sequence, phase,
           public_state, snapshot_digest
         )
         VALUES ($1, $2, $3, $4, 1, 'context_frozen', $5::jsonb, $6)`,
        [
          randomUUID(),
          task.account_id,
          task.id,
          taskRunID,
          JSON.stringify({
            dependency: "Compile a grounded pre-call briefing.",
            completed: [],
            remaining: ["bounded_agent_run", "canonical_readback"],
          }),
          snapshotDigest,
        ],
      );
      await appendTaskEvent(client, task, "run.started", {
        attempt,
        task_revision: task.task_revision,
      });
      await appendTaskEvent(client, task, "context.compiled", {
        pursuit_revision: task.semantic_snapshot.pursuit_revision,
        evidence_manifest_digest:
          task.semantic_snapshot.evidence_manifest_digest,
      });
      await appendTaskEvent(client, task, "checkpoint.saved", {
        phase: "context_frozen",
        checkpoint_sequence: 1,
      });
    }
    await client.query(
      `UPDATE agent_tasks
       SET active_attempt = $3,
           lease_owner = $4,
           lease_epoch = $5,
           lease_expires_at = $6,
           updated_at = now()
       WHERE account_id = $1 AND id = $2`,
      [
        task.account_id,
        task.id,
        attempt,
        workerID,
        leaseEpoch,
        new Date(Date.now() + TASK_LEASE_MS).toISOString(),
      ],
    );
    const auth = await taskAuthContext(client, task);
    return {
      task: { ...task, active_attempt: attempt, lease_epoch: leaseEpoch },
      taskRun: {
        ...(latest ?? {
          id: taskRunID,
          task_id: task.id,
          attempt,
          expected_task_revision: task.task_revision,
          status: "running" as const,
          agent_run_id: null,
          run_idempotency_key: runIdempotencyKey,
          snapshot_digest: snapshotDigest,
          lease_epoch: leaseEpoch,
          created_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          completed_at: null,
          agent_run_status: null,
          terminal_receipt: null,
        }),
        status: "running",
        lease_epoch: leaseEpoch,
      },
      auth,
      workerID,
      leaseEpoch,
    };
  });
}

async function evidenceExcerpts(
  client: DatabaseClient,
  task: AgentTaskRow,
): Promise<EvidenceExcerptRow[]> {
  if (task.evidence_refs.length === 0) return [];
  const result = await client.query<EvidenceExcerptRow>(
    `SELECT fragments.id AS fragment_id, fragments.text_content,
            fragments.content_hash, resources.observed_at,
            resources.display_name AS source_display_name
     FROM evidence_fragments fragments
     JOIN source_resources resources
       ON resources.account_id = fragments.account_id
      AND resources.id = fragments.resource_id
     WHERE fragments.account_id = $1
       AND fragments.id = ANY($2::uuid[])
       AND fragments.status = 'active'
       AND fragments.review_status = 'reviewed'
       AND fragments.attribution_status = 'confirmed'
       AND fragments.text_content IS NOT NULL
     ORDER BY array_position($2::uuid[], fragments.id)`,
    [task.account_id, task.evidence_refs],
  );
  return result.rows;
}

async function buildBriefing(
  client: PoolClient,
  task: AgentTaskRow,
  taskRun: AgentTaskRunRow,
  agentRunID: string,
  proposalID: string | null,
  noActionID: string | null,
): Promise<{
  artifactID: string;
  dependency: string;
  noActionReasonCode: string | null;
}> {
  const pursuit = await readPursuit(client, task.account_id, task.pursuit_id);
  const excerpts = await evidenceExcerpts(client, task);
  const openGap = pursuit.gaps.find((gap) => gap.status === "open") ?? null;
  const openAction = pursuit.actions.find(
    (action) => !["completed", "cancelled", "failed"].includes(action.status),
  ) ?? null;
  const proposal = proposalID
    ? (await client.query<{ summary: string }>(
        `SELECT summary FROM pursuit_proposals
         WHERE account_id = $1 AND id = $2`,
        [task.account_id, proposalID],
      )).rows[0] ?? null
    : null;
  const noAction = noActionID
    ? (await client.query<{ reason: string; reason_code: string }>(
        `SELECT reason, reason_code FROM agent_no_actions
         WHERE account_id = $1 AND id = $2`,
        [task.account_id, noActionID],
      )).rows[0] ?? null
    : null;
  const isAmbiguousTime = noAction?.reason_code === "AMBIGUOUS_TIME";
  const dependency = isAmbiguousTime
    ? "The exact calendar date, timezone, duration, and meeting consent remain unresolved."
    : openGap
      ? openAction
        ? `${openGap.title} The existing user-owned action “${openAction.title}” remains open; the selected evidence does not justify a duplicate.`
        : openGap.title
      : proposal
        ? "A review-only Pursuit change is waiting for a human decision."
        : openAction
          ? `The existing user-owned action “${openAction.title}” remains open; the selected evidence does not justify a duplicate.`
          : "No unresolved dependency is supported by the selected evidence.";
  const dependencyRefs = isAmbiguousTime
    ? task.evidence_refs
    : openGap?.basis.evidence_refs ?? [];
  const observedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ARTIFACT_TTL_MS).toISOString();
  const artifactID = randomUUID();
  const content: AgentArtifactRow["content"] = {
    summary: proposal?.summary ??
      `${pursuit.title} is currently at ${pursuit.milestone}. ${
        noAction?.reason ??
        "The selected governed evidence does not support a new canonical change."
      }`,
    what_changed: excerpts.slice(0, 8).map((item) => ({
      id: randomUUID(),
      statement: `${item.source_display_name}: ${compactEvidence(item.text_content)}`,
      epistemic_status: "observed_evidence",
      authority: "reviewed_evidence",
      evidence_refs: [item.fragment_id],
      observed_at: iso(item.observed_at),
      freshness: "current",
    })),
    what_matters_now: {
      dependency,
      reason: isAmbiguousTime
        ? noAction.reason
        : openGap
        ? openGap.close_condition
        : proposal?.summary ??
          (openAction
            ? `Continue the existing action owned by ${openAction.owner_display_name}; do not create another action for the same work.`
            : "No new milestone, commitment, or user-owned action is justified by this snapshot."),
      authority: !isAmbiguousTime && openGap ? "canonical_pursuit" : "agent_interpretation",
      evidence_refs: dependencyRefs,
    },
    next_move: proposalID
      ? {
          kind: "review_proposal",
          label: "Review the exact Pursuit proposal",
          reason: "The proposal is review-only and has no execution authority.",
        }
      : isAmbiguousTime
        ? {
            kind: "clarify",
            label: "Confirm the exact date, timezone, duration, and meeting consent",
            reason: noAction.reason,
          }
      : openAction
        ? {
            kind: "continue_owned_action",
            label: openAction.title,
            reason: `This action remains owned by ${openAction.owner_display_name}; no duplicate action was created.`,
          }
        : {
            kind: "no_action",
            label: "No action now",
            reason: noAction?.reason ??
              "Wait for a material change or newly reviewed evidence.",
          },
    limitations: [
      "This briefing is a non-canonical artifact and cannot confirm facts or execute an action.",
      "Only the frozen, reviewed evidence manifest was considered.",
      ...(excerpts.length === 0
        ? ["No reviewed evidence excerpt was available for the change section."]
        : []),
    ],
  };
  await client.query(
    `INSERT INTO agent_artifacts(
       id, account_id, task_id, task_run_id, agent_run_id, type, authority,
       status, title, content, evidence_manifest_digest, observed_at, expires_at
     )
     VALUES (
       $1, $2, $3, $4, $5, 'pursuit_briefing', 'non_canonical', 'current',
       $6, $7::jsonb, $8, $9, $10
     )`,
    [
      artifactID,
      task.account_id,
      task.id,
      taskRun.id,
      agentRunID,
      `Briefing · ${pursuit.title}`,
      JSON.stringify(content),
      task.semantic_snapshot.evidence_manifest_digest,
      observedAt,
      expiresAt,
    ],
  );
  for (const [index, item] of excerpts.entries()) {
    await client.query(
      `INSERT INTO agent_artifact_evidence(
         account_id, artifact_id, fragment_id, manifest_order, content_hash
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [task.account_id, artifactID, item.fragment_id, index, item.content_hash],
    );
  }
  return {
    artifactID,
    dependency,
    noActionReasonCode: noAction?.reason_code ?? null,
  };
}

async function createClarificationRequest(
  client: PoolClient,
  task: AgentTaskRow,
  nextTaskRevision: number,
): Promise<string> {
  const clarificationID = randomUUID();
  await client.query(
    `INSERT INTO agent_clarification_requests(
       id, account_id, task_id, task_revision, request_revision,
       question, reason, response_schema, status, expires_at
     )
     VALUES ($1, $2, $3, $4, 1, $5, $6, $7::jsonb, 'open', $8)`,
    [
      clarificationID,
      task.account_id,
      task.id,
      nextTaskRevision,
      "What exact calendar date, timezone, duration, and meeting consent apply?",
      "The selected evidence contains a relative time phrase without enough temporal or consent authority for a meeting action.",
      JSON.stringify({
        type: "object",
        required: ["date", "timezone", "duration_minutes", "meeting_consent"],
        properties: {
          date: { type: "string", format: "date" },
          timezone: { type: "string" },
          duration_minutes: { type: "integer", minimum: 1 },
          meeting_consent: { type: "boolean" },
        },
        additionalProperties: false,
      }),
      new Date(Date.now() + DECISION_TTL_MS).toISOString(),
    ],
  );
  return clarificationID;
}

async function createDecisionBundle(
  client: PoolClient,
  task: AgentTaskRow,
  proposalID: string,
  dependency: string,
  nextTaskRevision: number,
): Promise<string> {
  const bundleID = randomUUID();
  await client.query(
    `INSERT INTO agent_decision_bundles(
       id, account_id, task_id, task_revision, bundle_revision, dependency,
       status, proposal_id, expires_at
     )
     VALUES ($1, $2, $3, $4, 1, $5, 'open', $6, $7)`,
    [
      bundleID,
      task.account_id,
      task.id,
      nextTaskRevision,
      dependency,
      proposalID,
      new Date(Date.now() + DECISION_TTL_MS).toISOString(),
    ],
  );
  const items = await client.query<{ id: string }>(
    `SELECT id FROM pursuit_proposal_items
     WHERE account_id = $1 AND proposal_id = $2
     ORDER BY created_at, id`,
    [task.account_id, proposalID],
  );
  for (const item of items.rows) {
    await client.query(
      `INSERT INTO agent_decision_items(
         id, account_id, bundle_id, domain_subject_kind,
         domain_subject_id, item_revision, status
       )
       VALUES ($1, $2, $3, 'pursuit_proposal_item', $4, 1, 'open')`,
      [randomUUID(), task.account_id, bundleID, item.id],
    );
  }
  return bundleID;
}

async function finalizeTask(
  pool: Pool,
  claimed: ClaimedTask,
  run: AgentRun,
): Promise<void> {
  await inTransaction(pool, async (client) => {
    const task = (await client.query<AgentTaskRow>(
      `SELECT * FROM agent_tasks
       WHERE account_id = $1 AND id = $2
       FOR UPDATE`,
      [claimed.task.account_id, claimed.task.id],
    )).rows[0];
    if (
      !task ||
      task.status !== "active" ||
      task.task_revision !== claimed.task.task_revision ||
      task.lease_owner !== claimed.workerID ||
      task.lease_epoch !== claimed.leaseEpoch
    ) {
      return;
    }
    const receipt = run.terminal_receipt;
    if (!receipt) {
      throw new Error("A terminal Agent Run readback is required.");
    }
    await client.query(
      `UPDATE agent_task_runs
       SET agent_run_id = $4,
           status = $5,
           completed_at = now()
       WHERE account_id = $1 AND id = $2 AND task_id = $3`,
      [
        task.account_id,
        claimed.taskRun.id,
        task.id,
        run.id,
        run.status === "proposal_staged" || run.status === "no_action"
          ? "completed"
          : "failed",
      ],
    );
    await client.query(
      `INSERT INTO agent_task_checkpoints(
         id, account_id, task_id, task_run_id, checkpoint_sequence, phase,
         public_state, snapshot_digest
       )
       VALUES ($1, $2, $3, $4, 2, 'provider_terminal', $5::jsonb, $6)`,
      [
        randomUUID(),
        task.account_id,
        task.id,
        claimed.taskRun.id,
        JSON.stringify({
          agent_run_id: run.id,
          agent_run_status: run.status,
          reason_code: receipt.reason_code,
        }),
        claimed.taskRun.snapshot_digest,
      ],
    );

    const supported = run.status === "proposal_staged" || run.status === "no_action";
    const briefing = supported
      ? await buildBriefing(
          client,
          task,
          claimed.taskRun,
          run.id,
          receipt.proposal_id,
          receipt.no_action_id,
        )
      : null;
    const nextTaskRevision = task.task_revision + 1;
    let nextStatus: AgentTaskStatus;
    let continueAllowed = false;
    let completedAt: string | null = null;
    let eventName: AgentTaskEvent["name"];

    if (run.status === "proposal_staged" && receipt.proposal_id && briefing) {
      const bundleID = await createDecisionBundle(
        client,
        task,
        receipt.proposal_id,
        briefing.dependency,
        nextTaskRevision,
      );
      nextStatus = "waiting_for_domain_decision";
      eventName = "run.completed";
      await appendTaskEvent(
        client,
        task,
        "artifact.ready",
        { artifact_id: briefing.artifactID, authority: "non_canonical" },
        run.id,
      );
      await client.query(
        `UPDATE agent_task_runs
         SET status = 'suspended', completed_at = NULL
         WHERE account_id = $1 AND id = $2 AND task_id = $3`,
        [task.account_id, claimed.taskRun.id, task.id],
      );
      await appendTaskEvent(
        client,
        task,
        "decision.requested",
        { bundle_id: bundleID, proposal_id: receipt.proposal_id },
        run.id,
      );
    } else if (
      run.status === "no_action" &&
      briefing &&
      briefing.noActionReasonCode === "AMBIGUOUS_TIME"
    ) {
      const clarificationID = await createClarificationRequest(
        client,
        task,
        nextTaskRevision,
      );
      nextStatus = "waiting_for_clarification";
      continueAllowed = true;
      eventName = "run.completed";
      await appendTaskEvent(
        client,
        task,
        "artifact.ready",
        { artifact_id: briefing.artifactID, authority: "non_canonical" },
        run.id,
      );
      await appendTaskEvent(
        client,
        task,
        "clarification.requested",
        {
          clarification_id: clarificationID,
          reason_code: briefing.noActionReasonCode,
        },
        run.id,
      );
    } else if (run.status === "no_action" && briefing) {
      nextStatus = "no_action";
      completedAt = new Date().toISOString();
      eventName = "run.no_action";
      await appendTaskEvent(
        client,
        task,
        "artifact.ready",
        { artifact_id: briefing.artifactID, authority: "non_canonical" },
        run.id,
      );
    } else if (run.status === "budget_exhausted") {
      nextStatus = "abstained";
      continueAllowed = true;
      completedAt = new Date().toISOString();
      eventName = "run.abstained";
    } else {
      nextStatus = "failed";
      completedAt = new Date().toISOString();
      eventName = "run.failed";
    }
    await client.query(
      `UPDATE agent_tasks
       SET status = $3,
           task_revision = $4,
           continue_allowed = $5,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now(),
           completed_at = $6
       WHERE account_id = $1 AND id = $2`,
      [
        task.account_id,
        task.id,
        nextStatus,
        nextTaskRevision,
        continueAllowed,
        completedAt,
      ],
    );
    await appendTaskEvent(
      client,
      task,
      eventName,
      {
        status: nextStatus,
        reason_code: receipt.reason_code,
        external_effect_count: 0,
      },
      run.id,
    );
    await appendAudit(
      client,
      { accountId: task.account_id, actorUserId: task.requested_by_user_id },
      "agent_task_attempt_terminal",
      "agent_task",
      task.id,
      {
        task_status: nextStatus,
        agent_run_id: run.id,
        agent_run_status: run.status,
        reason_code: receipt.reason_code,
        external_effect_count: 0,
      },
    );
  });
}

async function failClaimedTask(
  pool: Pool,
  claimed: ClaimedTask,
  error: unknown,
): Promise<void> {
  const code = error instanceof ApiError ? error.code : "AGENT_TASK_EXECUTION_FAILED";
  const needsRebase = code === "AGENT_PURSUIT_BASE_CONFLICT";
  await inTransaction(pool, async (client) => {
    const task = (await client.query<AgentTaskRow>(
      `SELECT * FROM agent_tasks
       WHERE account_id = $1 AND id = $2
       FOR UPDATE`,
      [claimed.task.account_id, claimed.task.id],
    )).rows[0];
    if (
      !task ||
      task.status !== "active" ||
      task.lease_owner !== claimed.workerID ||
      task.lease_epoch !== claimed.leaseEpoch
    ) {
      return;
    }
    await client.query(
      `UPDATE agent_task_runs
       SET status = 'failed', completed_at = now()
       WHERE account_id = $1 AND id = $2 AND status IN ('scheduled', 'running')`,
      [task.account_id, claimed.taskRun.id],
    );
    await client.query(
      `UPDATE agent_tasks
       SET status = $3,
           task_revision = task_revision + 1,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now(),
           completed_at = $4
       WHERE account_id = $1 AND id = $2`,
      [
        task.account_id,
        task.id,
        needsRebase ? "needs_rebase" : "failed",
        needsRebase ? null : new Date().toISOString(),
      ],
    );
    await appendTaskEvent(
      client,
      task,
      needsRebase ? "task.needs_rebase" : "run.failed",
      { reason_code: code, external_effect_count: 0 },
    );
  });
}

export async function executeAgentTask(
  pool: Pool,
  taskID: string,
  provider: AgentProvider = configuredAgentProvider(),
): Promise<void> {
  const claimed = await claimTask(pool, taskID);
  if (!claimed) return;
  const controller = new AbortController();
  activeTaskControllers.set(taskID, controller);
  try {
    const result = await createPursuitAgentRun(
      pool,
      claimed.auth,
      claimed.task.pursuit_id,
      {
        idempotency_key: claimed.taskRun.run_idempotency_key,
        capture_id: claimed.task.capture_id,
        base_revision: claimed.task.semantic_snapshot.pursuit_revision,
        objective: claimed.task.objective,
        evidence_refs: claimed.task.evidence_refs,
        input_artifact_refs: claimed.task.input_artifact_refs,
        ...(claimed.task.telemetry ? { telemetry: claimed.task.telemetry } : {}),
      },
      provider,
      controller.signal,
      "operational_only",
      claimed.task.semantic_snapshot.prompt_snapshot ?? bundledPrompt("pursuit/proposal"),
    );
    await finalizeTask(pool, claimed, result.body.run);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === "IDEMPOTENCY_REQUEST_IN_PROGRESS"
    ) {
      return;
    }
    await failClaimedTask(pool, claimed, error);
  } finally {
    if (activeTaskControllers.get(taskID) === controller) {
      activeTaskControllers.delete(taskID);
    }
  }
}

export async function getAgentTask(
  pool: Pool,
  auth: AuthContext,
  taskID: string,
): Promise<AgentTaskResponse> {
  return {
    contract_version: CONTRACT_VERSION,
    task: await readTaskProjection(pool, auth, taskID),
  };
}

export async function listPursuitAgentTasks(
  pool: Pool,
  auth: AuthContext,
  pursuitID: string,
  state: "active" | "all" = "active",
): Promise<AgentTaskListResponse> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM agent_tasks
     WHERE account_id = $1 AND pursuit_id = $2
       AND (
         $3 = 'all'
         OR status IN (
           'active', 'waiting_for_clarification',
           'waiting_for_domain_decision', 'waiting_for_external',
           'needs_rebase'
         )
       )
     ORDER BY updated_at DESC, id DESC
     LIMIT 100`,
    [auth.accountId, pursuitID, state],
  );
  return {
    contract_version: CONTRACT_VERSION,
    workspace_id: auth.accountId,
    tasks: await Promise.all(
      result.rows.map((row) => readTaskProjection(pool, auth, row.id)),
    ),
  };
}

export async function getAgentTaskEvents(
  pool: Pool,
  auth: AuthContext,
  taskID: string,
  afterSequence = 0,
): Promise<AgentTaskEventsResponse> {
  await readTaskProjection(pool, auth, taskID);
  const result = await pool.query<EventRow>(
    `SELECT events.*, outbox.stream_cursor
     FROM agent_task_events events
     JOIN agent_delivery_outbox outbox
       ON outbox.account_id = events.account_id
      AND outbox.event_id = events.event_id
     WHERE events.account_id = $1
       AND events.task_id = $2
       AND events.task_sequence > $3
     ORDER BY events.task_sequence
     LIMIT 500`,
    [auth.accountId, taskID, afterSequence],
  );
  const latest = await pool.query<{
    latest_sequence: number;
    latest_cursor: string | number;
  }>(
    `SELECT COALESCE(MAX(events.task_sequence), 0)::int AS latest_sequence,
            COALESCE(MAX(outbox.stream_cursor), 0)::text AS latest_cursor
     FROM agent_task_events events
     LEFT JOIN agent_delivery_outbox outbox
       ON outbox.account_id = events.account_id
      AND outbox.event_id = events.event_id
     WHERE events.account_id = $1 AND events.task_id = $2`,
    [auth.accountId, taskID],
  );
  return {
    contract_version: CONTRACT_VERSION,
    task_id: taskID,
    events: result.rows.map((row) => ({
      event_id: row.event_id,
      workspace_id: row.account_id,
      task_id: row.task_id,
      run_id: row.run_id,
      task_sequence: row.task_sequence,
      stream_cursor: String(row.stream_cursor),
      name: row.name,
      occurred_at: iso(row.occurred_at),
      schema_version: 1,
      public_payload: row.public_payload,
    })),
    latest_sequence: Number(latest.rows[0]?.latest_sequence ?? 0),
    latest_cursor: String(latest.rows[0]?.latest_cursor ?? 0),
  };
}

export async function cancelAgentTask(
  pool: Pool,
  auth: AuthContext,
  taskID: string,
  request: CancelAgentTaskRequest,
): Promise<MutationResult<AgentTaskResponse>> {
  const result = await inTransaction(pool, async (client) => {
    const idempotency = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      `cancel_agent_task:${taskID}`,
      request.idempotency_key,
      request,
    );
    if (idempotency.replay) {
      return {
        body: idempotency.replay.body as AgentTaskResponse,
        replayed: true,
        status: idempotency.replay.status,
      };
    }
    const task = (await client.query<AgentTaskRow>(
      `SELECT * FROM agent_tasks
       WHERE account_id = $1 AND id = $2
       FOR UPDATE`,
      [auth.accountId, taskID],
    )).rows[0];
    if (!task) {
      throw new ApiError(404, "AGENT_TASK_NOT_FOUND", "The Agent Task was not found.");
    }
    if (task.task_revision !== request.expected_revision) {
      throw new ApiError(
        409,
        "AGENT_TASK_REVISION_CONFLICT",
        "The Agent Task changed before cancellation.",
        { current_revision: task.task_revision },
      );
    }
    if (
      ["completed", "no_action", "abstained", "failed", "cancelled", "expired"].includes(
        task.status,
      )
    ) {
      throw new ApiError(
        409,
        "AGENT_TASK_ALREADY_TERMINAL",
        "A terminal Agent Task cannot be cancelled again.",
      );
    }
    await client.query(
      `UPDATE agent_tasks
       SET status = 'cancelled',
           task_revision = task_revision + 1,
           lease_owner = NULL,
           lease_epoch = lease_epoch + 1,
           lease_expires_at = NULL,
           completed_at = now(),
           updated_at = now()
       WHERE account_id = $1 AND id = $2`,
      [auth.accountId, taskID],
    );
    await client.query(
      `UPDATE agent_task_runs
       SET status = 'cancelled', completed_at = now()
       WHERE account_id = $1 AND task_id = $2
         AND status IN ('scheduled', 'running', 'suspended')`,
      [auth.accountId, taskID],
    );
    await client.query(
      `UPDATE agent_clarification_requests
       SET status = 'cancelled'
       WHERE account_id = $1 AND task_id = $2 AND status = 'open'`,
      [auth.accountId, taskID],
    );
    await client.query(
      `UPDATE agent_decision_bundles
       SET status = 'cancelled', updated_at = now()
       WHERE account_id = $1 AND task_id = $2
         AND status IN ('open', 'partially_resolved')`,
      [auth.accountId, taskID],
    );
    await appendTaskEvent(client, task, "task.cancelled", {
      reason: request.reason,
      external_effect_count: 0,
    });
    const body: AgentTaskResponse = {
      contract_version: CONTRACT_VERSION,
      task: await readTaskProjection(client, auth, taskID),
    };
    await completeIdempotency(client, idempotency, 200, body);
    return { body, replayed: false, status: 200 };
  });
  activeTaskControllers.get(taskID)?.abort(new Error("Agent Task cancelled."));
  return result;
}

export async function resolveAgentDecisionBundle(
  pool: Pool,
  auth: AuthContext,
  bundleID: string,
  request: ResolveAgentDecisionBundleRequest,
): Promise<MutationResult<AgentDecisionResolutionResponse>> {
  const correlation = await pool.query<{
    task_id: string;
    task_revision: number;
    bundle_revision: number;
    bundle_status: string;
    proposal_id: string | null;
    agent_item_id: string;
    domain_subject_id: string;
  }>(
    `SELECT bundles.task_id, bundles.task_revision,
            bundles.bundle_revision, bundles.status AS bundle_status,
            bundles.proposal_id, items.id AS agent_item_id,
            items.domain_subject_id
     FROM agent_decision_bundles bundles
     JOIN agent_decision_items items
       ON items.account_id = bundles.account_id
      AND items.bundle_id = bundles.id
     WHERE bundles.account_id = $1 AND bundles.id = $2
     ORDER BY items.created_at, items.id`,
    [auth.accountId, bundleID],
  );
  const first = correlation.rows[0];
  if (!first) {
    throw new ApiError(
      404,
      "AGENT_DECISION_BUNDLE_NOT_FOUND",
      "The Agent Decision Bundle was not found.",
    );
  }
  if (!first.proposal_id) {
    throw new ApiError(
      422,
      "AGENT_DECISION_OWNER_UNSUPPORTED",
      "This Decision Bundle is not owned by a Pursuit Proposal review.",
    );
  }
  const decisionsByID = new Map(
    request.decisions.map((decision) => [decision.item_id, decision]),
  );
  if (
    decisionsByID.size !== request.decisions.length ||
    correlation.rows.length !== request.decisions.length ||
    correlation.rows.some((item) => !decisionsByID.has(item.agent_item_id))
  ) {
    throw new ApiError(
      422,
      "AGENT_DECISION_SET_INVALID",
      "Resolve every item in this Decision Bundle exactly once.",
    );
  }
  const review = await reviewPursuitProposal(
    pool,
    auth,
    first.proposal_id,
    {
      operation_id: request.operation_id,
      idempotency_key: request.idempotency_key,
      base_revision: request.base_revision,
      reason: request.reason,
      decisions: correlation.rows.map((item) => {
        const decision = decisionsByID.get(item.agent_item_id)!;
        return {
          item_id: item.domain_subject_id,
          decision: decision.decision === "accept" ? "confirm" : decision.decision,
          ...(decision.decision === "edit"
            ? { edited_value: decision.edited_value }
            : {}),
        };
      }),
    },
    {
      onResolved: async (client, body) => {
        const bundle = (await client.query<DecisionBundleRow>(
          `SELECT id, task_id, task_revision, bundle_revision, dependency,
                  status, proposal_id, expires_at
           FROM agent_decision_bundles
           WHERE account_id = $1 AND id = $2
           FOR UPDATE`,
          [auth.accountId, bundleID],
        )).rows[0];
        const task = bundle
          ? (await client.query<AgentTaskRow>(
              `SELECT * FROM agent_tasks
               WHERE account_id = $1 AND id = $2
               FOR UPDATE`,
              [auth.accountId, bundle.task_id],
            )).rows[0]
          : null;
        if (!bundle || !task) {
          throw new ApiError(
            404,
            "AGENT_DECISION_BUNDLE_NOT_FOUND",
            "The Agent Decision Bundle was not found.",
          );
        }
        if (
          bundle.status !== "open" ||
          task.status !== "waiting_for_domain_decision"
        ) {
          throw new ApiError(
            409,
            "AGENT_DECISION_BUNDLE_NOT_OPEN",
            "This Decision Bundle no longer accepts a resolution.",
          );
        }
        if (
          task.task_revision !== request.expected_task_revision ||
          bundle.task_revision !== request.expected_task_revision ||
          bundle.bundle_revision !== request.expected_bundle_revision
        ) {
          throw new ApiError(
            409,
            "AGENT_DECISION_REVISION_CONFLICT",
            "The Agent Task or Decision Bundle changed before resolution.",
            {
              current_task_revision: task.task_revision,
              current_bundle_revision: bundle.bundle_revision,
            },
          );
        }
        for (const proposalItem of body.proposal.items) {
          const mappedStatus =
            proposalItem.decision.status === "confirmed"
              ? "accepted"
              : proposalItem.decision.status;
          await client.query(
            `UPDATE agent_decision_items
             SET status = $4, domain_receipt_ref = $5
             WHERE account_id = $1 AND bundle_id = $2
               AND domain_subject_id = $3`,
            [
              auth.accountId,
              bundleID,
              proposalItem.id,
              mappedStatus,
              body.receipt.id,
            ],
          );
        }
        await client.query(
          `UPDATE agent_decision_bundles
           SET status = 'resolved', bundle_revision = bundle_revision + 1,
               updated_at = now()
           WHERE account_id = $1 AND id = $2`,
          [auth.accountId, bundleID],
        );
        await client.query(
          `UPDATE agent_tasks
           SET status = 'completed', task_revision = task_revision + 1,
               completed_at = now(), updated_at = now()
           WHERE account_id = $1 AND id = $2`,
          [auth.accountId, task.id],
        );
        await client.query(
          `UPDATE agent_task_runs
           SET status = 'completed', completed_at = now()
           WHERE account_id = $1 AND task_id = $2 AND status = 'suspended'`,
          [auth.accountId, task.id],
        );
        await appendTaskEvent(client, task, "decision.resolved", {
          bundle_id: bundleID,
          proposal_id: body.proposal.id,
          domain_receipt_ref: body.receipt.id,
          outcome: body.receipt.outcome,
          external_effect_count: 0,
        });
        await appendAudit(
          client,
          { accountId: auth.accountId, actorUserId: auth.userId },
          "agent_decision_bundle_resolved",
          "agent_decision_bundle",
          bundleID,
          {
            task_id: task.id,
            proposal_id: body.proposal.id,
            receipt_id: body.receipt.id,
            outcome: body.receipt.outcome,
            external_effect_count: 0,
          },
        );
      },
    },
  );
  if (review.status !== 200 || !("receipt" in review.body)) {
    throw new ApiError(
      409,
      "AGENT_DECISION_DOMAIN_CONFLICT",
      "The underlying domain decision conflicted with canonical Pursuit state.",
      review.body,
    );
  }
  return {
    body: {
      ...(await getAgentTask(pool, auth, first.task_id)),
      domain_receipt: review.body.receipt,
    } satisfies AgentDecisionResolutionResponse,
    replayed: review.replayed,
    status: 200,
  };
}

export async function assertProposalReviewNotAgentCorrelated(
  client: PoolClient,
  auth: AuthContext,
  proposalID: string,
): Promise<void> {
  const correlated = await client.query<{ bundle_id: string; task_id: string }>(
    `SELECT id AS bundle_id, task_id
     FROM agent_decision_bundles
     WHERE account_id = $1 AND proposal_id = $2
       AND status IN ('open', 'partially_resolved')
     LIMIT 1`,
    [auth.accountId, proposalID],
  );
  if (correlated.rows[0]) {
    throw new ApiError(
      409,
      "AGENT_DECISION_BUNDLE_REQUIRED",
      "Review this Proposal through its Agent Decision Bundle so task and domain state commit together.",
      correlated.rows[0],
    );
  }
}

export async function recoverGovernedAgentTasks(
  pool: Pool,
  provider?: AgentProvider,
): Promise<{ scheduled: number }> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM agent_tasks
     WHERE status = 'active'
       AND (lease_expires_at IS NULL OR lease_expires_at <= now())
     ORDER BY updated_at, id
     LIMIT 100`,
  );
  for (const row of result.rows) scheduleTask(pool, row.id, provider);
  return { scheduled: result.rows.length };
}
