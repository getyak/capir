import { randomUUID } from "node:crypto";

import type {
  MemoryRecallItem,
  MemoryRecallResponse,
  MemorySurface,
  MemoryScope,
} from "@talent-signal/contracts";
import type { PoolClient } from "pg";

import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import type { AuthContext } from "./auth.js";
import {
  MEMORY_EVIDENCE_AVAILABLE_SQL,
  enqueueProjectionJob,
  invalidateDerivedKnowledge,
  serializeRecallItem,
  type EvidenceRow,
  type MemoryItemRow,
} from "./memoryReviewStore.js";

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.trunc(value)));
}

export interface MemoryRecallRequest {
  surface: MemorySurface;
  person_id?: string | null;
  relationship_context_id?: string | null;
  limit?: number;
  scope?: MemoryScope | undefined;
  cursor?: string | null | undefined;
}

type RecallCursor = { scope: MemoryScope; created_at: string; id: string };

function decodeCursor(value: string): RecallCursor {
  try {
    if (value.length > 500) throw new Error();
    const row = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as RecallCursor;
    if (!["self", "person", "relationship"].includes(row.scope)
      || !/^\d{4}-\d{2}-\d{2}T/.test(row.created_at) || !Number.isFinite(Date.parse(row.created_at))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(row.id)) throw new Error();
    return row;
  } catch {
    throw new ApiError(400, "MEMORY_CURSOR_INVALID", "Read Memory using the returned continuation cursor.");
  }
}

/**
 * Authentication-first recall. `self` is private to the acting user and never
 * returned on People/relationship surfaces. Person/relationship recall needs an
 * active subject and context and is refused on a business purpose.
 */
export async function recallMemories(
  client: DatabaseClient,
  auth: AuthContext,
  request: MemoryRecallRequest,
): Promise<MemoryRecallResponse> {
  const limit = boundedLimit(request.limit, 50, 100);
  const cursor = request.cursor ? decodeCursor(request.cursor) : null;
  const personId = request.person_id ?? null;
  const contextId = request.relationship_context_id ?? null;
  const parameters: unknown[] = [auth.accountId, auth.userId];
  let scopeClause: string;
  if (request.surface === "chat") {
    if (personId && contextId) {
      parameters.push(personId, contextId);
      scopeClause = `(
        (m.scope = 'self' AND m.owner_user_id = $2)
        OR (m.subject_id = $3 AND (
          m.scope = 'person'
          OR (m.scope = 'relationship' AND m.owner_user_id = $2
            AND m.relationship_context_id = $4)
        ))
      )`;
    } else if (personId) {
      parameters.push(personId);
      scopeClause = `(
        (m.scope = 'self' AND m.owner_user_id = $2)
        OR (m.subject_id = $3 AND (
          m.scope = 'person'
          OR (m.scope = 'relationship' AND m.owner_user_id = $2)
        ))
      )`;
    } else {
      scopeClause = `(m.scope = 'self' AND m.owner_user_id = $2)`;
    }
  } else if (request.surface === "people") {
    if (!personId) {
      throw new ApiError(400, "MEMORY_SCOPE_REQUIRED", "People recall needs one contact.");
    }
    parameters.push(personId);
    scopeClause = `(m.subject_id = $3 AND (
      m.scope = 'person'
      OR (m.scope = 'relationship' AND m.owner_user_id = $2)
    ))`;
  } else {
    if (!personId || !contextId) {
      throw new ApiError(
        400,
        "MEMORY_SCOPE_REQUIRED",
        "Relationship recall needs one contact and one relationship context.",
      );
    }
    parameters.push(personId, contextId);
    scopeClause = `(
      m.subject_id = $3
      AND (
        m.scope = 'person'
        OR (m.scope = 'relationship' AND m.owner_user_id = $2
          AND m.relationship_context_id = $4)
      )
    )`;
  }
  let pageClause = "";
  if (request.scope) {
    parameters.push(request.scope);
    pageClause += ` AND m.scope = $${parameters.length}`;
  }
  if (cursor) {
    parameters.push(cursor.scope, cursor.created_at, cursor.id);
    const scope = `$${parameters.length - 2}`;
    const time = `$${parameters.length - 1}::timestamptz`;
    const id = `$${parameters.length}::uuid`;
    pageClause += ` AND (m.scope > ${scope} OR (m.scope = ${scope} AND
      (m.created_at < ${time} OR (m.created_at = ${time} AND m.id > ${id}))))`;
  }
  parameters.push(limit + 1);
  const limitParameter = `$${parameters.length}`;
  const result = await client.query<MemoryItemRow & { cursor_time: string }>(
    `SELECT m.*, to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM memory_items m
     WHERE m.account_id = $1
       AND $2::uuid IS NOT NULL
       AND m.status = 'active'
       AND ${scopeClause}
       ${pageClause}
       AND (
         m.subject_id IS NULL
         OR EXISTS (
           SELECT 1 FROM subjects s
           WHERE s.account_id = m.account_id AND s.id = m.subject_id
             AND s.status = 'active'
         )
       )
       AND (
         m.relationship_context_id IS NULL
         OR EXISTS (
           SELECT 1 FROM assignments a
           WHERE a.account_id = m.account_id AND a.id = m.relationship_context_id
             AND a.status = 'active'
         )
       )
       AND EXISTS (
         SELECT 1 FROM memory_item_evidence active_evidence
         WHERE active_evidence.account_id = m.account_id
           AND active_evidence.memory_item_id = m.id
           AND active_evidence.status = 'active'
       )
       AND NOT EXISTS (
         SELECT 1 FROM memory_item_evidence e
         WHERE e.account_id = m.account_id
           AND e.memory_item_id = m.id
           AND NOT ${MEMORY_EVIDENCE_AVAILABLE_SQL}
       )
     ORDER BY m.scope, m.created_at DESC, m.id
     LIMIT ${limitParameter}`,
    parameters,
  );
  const items: MemoryRecallItem[] = [];
  const rows = result.rows.slice(0, limit);
  if (rows.length) {
    const evidence = await client.query<EvidenceRow>(
      `SELECT id, memory_item_id, capture_id, source_resource_id,
              evidence_fragment_id, source_session_id, source_message_id,
              source_artifact_id, locator, excerpt, status
       FROM memory_item_evidence
       WHERE account_id = $1 AND memory_item_id = ANY($2::uuid[]) AND status = 'active'
       ORDER BY memory_item_id, created_at, id`,
      [auth.accountId, rows.map(row => row.id)],
    );
    const byMemory = new Map<string, EvidenceRow[]>();
    for (const source of evidence.rows) {
      const sources = byMemory.get(source.memory_item_id) ?? [];
      sources.push(source);
      byMemory.set(source.memory_item_id, sources);
    }
    for (const row of rows) {
      const sources = byMemory.get(row.id) ?? [];
      if (sources.length) {
        items.push({
          ...serializeRecallItem(row, sources, true),
          // Person Memory is readable by the account, but only its owner may
          // mutate it. This hint never replaces the mutation authority check.
          can_edit: row.owner_user_id === auth.userId,
        });
      }
    }
  }
  return {
    contract_version: CONTRACT_VERSION,
    surface: request.surface,
    person_id: personId,
    relationship_context_id: contextId,
    items,
    has_more: result.rows.length > limit,
    next_cursor: result.rows.length > limit && rows.length
      ? Buffer.from(JSON.stringify({
        scope: rows.at(-1)!.scope, created_at: rows.at(-1)!.cursor_time, id: rows.at(-1)!.id,
      })).toString("base64url") : null,
  };
}

async function invalidateItemsForEvidencePredicate(
  client: PoolClient,
  accountId: string,
  predicate: string,
  parameters: unknown[],
  reason: "source_deleted" | "identity_rebound" | "source_revoked",
): Promise<number> {
  const affected = await client.query<{
    evidence_id: string;
    memory_item_id: string;
    subject_id: string | null;
    relationship_context_id: string | null;
  }>(
    `SELECT DISTINCT evidence.id AS evidence_id, evidence.memory_item_id,
            items.subject_id, items.relationship_context_id
     FROM memory_item_evidence evidence
     JOIN memory_items items
       ON items.account_id = evidence.account_id
      AND items.id = evidence.memory_item_id
     WHERE evidence.account_id = $1
       AND evidence.status = 'active'
       AND ${predicate}`,
    [accountId, ...parameters],
  );
  if (affected.rows.length === 0) return 0;
  const itemIds = [...new Set(affected.rows.map((row) => row.memory_item_id))];
  const evidenceIds = affected.rows.map((row) => row.evidence_id);
  await client.query(
    `UPDATE memory_item_evidence
     SET status = 'revoked', revoked_at = now(), revocation_reason = $2
     WHERE account_id = $1 AND id = ANY($3::uuid[])`,
    [accountId, reason, evidenceIds],
  );
  await client.query(
    `UPDATE memory_items
     SET status = 'invalidated', invalidated_at = now(),
         invalidated_reason = $3, updated_at = now()
     WHERE account_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
    [accountId, itemIds, reason],
  );
  const scopes = new Map<string, { subjectId: string | null; relationshipContextId: string | null }>();
  for (const row of affected.rows) {
    scopes.set(`${row.subject_id ?? ""}:${row.relationship_context_id ?? ""}`, {
      subjectId: row.subject_id,
      relationshipContextId: row.relationship_context_id,
    });
  }
  for (const scope of scopes.values()) {
    await invalidateDerivedKnowledge(client, accountId, scope);
    await enqueueProjectionJob(client, accountId, scope, "source_invalidated");
  }
  return itemIds.length;
}

async function recordSourceRevocations(
  client: PoolClient,
  accountId: string,
  sourceKind: "session" | "capture" | "artifact",
  sourceIds: readonly string[],
  reason: "source_deleted" | "identity_rebound" | "source_revoked",
  versions?: ReadonlyMap<string, number>,
): Promise<void> {
  for (const sourceId of sourceIds) {
    await client.query(
      `INSERT INTO memory_source_revocations(
         id, account_id, source_kind, source_id, reason, source_version
       )
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (account_id, source_kind, source_id) DO UPDATE
         SET reason = EXCLUDED.reason,
             source_version = EXCLUDED.source_version`,
      [
        randomUUID(),
        accountId,
        sourceKind,
        sourceId,
        reason,
        versions?.get(sourceId) ?? null,
      ],
    );
  }
}

/**
 * Explicit capture deletion / identity rebind revokes retained evidence and
 * removes dependent Memory from every read path immediately. An identity
 * rebind tombstones only the old capture version; a later binding has a new
 * version and can stage fresh evidence.
 */
export async function invalidateMemoriesForCaptureIds(
  client: PoolClient,
  accountId: string,
  captureIds: readonly string[],
  reason: "source_deleted" | "identity_rebound" | "source_revoked",
  versions?: ReadonlyMap<string, number>,
): Promise<number> {
  if (captureIds.length === 0) return 0;
  await recordSourceRevocations(
    client,
    accountId,
    "capture",
    captureIds,
    reason,
    reason === "source_deleted" ? undefined : versions,
  );
  return invalidateItemsForEvidencePredicate(
    client,
    accountId,
    "evidence.capture_id = ANY($2::uuid[])",
    [captureIds],
    reason,
  );
}

/**
 * Explicit Session deletion. Natural Session TTL expiry does not call this, so
 * accepted minimum evidence survives; pending proposals are blocked by the
 * revocation ledger.
 */
export async function invalidateMemoriesForSessionIds(
  client: PoolClient,
  accountId: string,
  sessionIds: readonly string[],
): Promise<number> {
  if (sessionIds.length === 0) return 0;
  await recordSourceRevocations(
    client,
    accountId,
    "session",
    sessionIds,
    "source_deleted",
  );
  return invalidateItemsForEvidencePredicate(
    client,
    accountId,
    "evidence.source_session_id = ANY($2::uuid[])",
    [sessionIds],
    "source_deleted",
  );
}

/**
 * Explicit deletion of an admitted image/media artifact.
 */
export async function invalidateMemoriesForArtifactIds(
  client: PoolClient,
  accountId: string,
  artifactIds: readonly string[],
): Promise<number> {
  if (artifactIds.length === 0) return 0;
  await recordSourceRevocations(
    client,
    accountId,
    "artifact",
    artifactIds,
    "source_deleted",
  );
  return invalidateItemsForEvidencePredicate(
    client,
    accountId,
    "evidence.source_artifact_id = ANY($2::text[])",
    [artifactIds],
    "source_deleted",
  );
}

export async function sweepExpiredMemoryProposals(
  client: PoolClient,
): Promise<number> {
  const result = await client.query(
    `UPDATE memory_proposals
     SET status = 'expired', updated_at = now()
     WHERE status IN ('open', 'partially_committed')
       AND expires_at <= now()`,
  );
  return result.rowCount ?? 0;
}
