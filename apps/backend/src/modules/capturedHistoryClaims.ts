import { createHash } from "node:crypto";
import { ApiError } from "../lib/apiError.js";
import type { PoolClient } from "pg";
import { lockSavedMemoryLineageTargets, type SavedMemoryStamp } from "./savedMemoryLineage.js";
import type { DatabaseClient } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { captureSavedMemoryRetainedProof, savedMemoryDurableProofDigest } from "./savedMemoryDurableLineage.js";
import { SESSION_HISTORY_MAX_TURNS, SESSION_HISTORY_TASK_UUID_SQL, sessionHistorySnapshotUnavailable,
  type SessionHistoryCanonicalResult } from "./sessionHistorySnapshot.js";

const utc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// The same projection identifies the selected completion at capture and on every
// subsequent owner check. NULL lineage is a specific legacy state, including
// for old non-UUID task names. It cannot subsequently acquire a different proof.
const joins = `LEFT JOIN agent_task_memory_lineage m ON m.account_id=i.account_id AND m.task_id=${SESSION_HISTORY_TASK_UUID_SQL}
  LEFT JOIN agent_session_chat_tasks retained ON retained.account_id=i.account_id
    AND retained.task_id=canonical_agent_session_id(i.response_body->>'task_id')
  LEFT JOIN LATERAL (SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'item_id',d.memory_item_id::text,'item_version',d.item_version,'lineage_epoch',d.lineage_epoch::text,
    'memory_owner_id',d.memory_owner_id::text,'scope',d.scope,'subject_id',d.subject_id::text,
    'relationship_context_id',d.relationship_context_id::text) ORDER BY d.memory_item_id),'[]'::jsonb) AS stamps
    FROM agent_task_saved_memory_dependencies d WHERE d.account_id=i.account_id AND d.task_id=m.task_id) deps ON true`;
const claim = `jsonb_build_object('task',i.response_body->>'task_id','completion',i.id,'operation',i.operation_scope,
  'status',i.response_status,'required',i.saved_memory_lineage_required,
  'body',encode(sha256(convert_to(i.response_body::text,'UTF8')),'hex'),
  'sourceActor',retained.actor_user_id,'sourceOrigin',retained.origin_session_id,'sourceUntil',${utc("retained.expires_at")},
  'count',m.dependency_count,'digest',m.proof_digest,'proof',CASE WHEN m.task_id IS NULL THEN NULL ELSE
    jsonb_build_object('version',m.format_version,'account_id',m.account_id,'reader_actor_id',m.reader_actor_id,
      'task_id',m.task_id,'expires_at',${utc("m.expires_at")},'stamps',deps.stamps) ||
      CASE WHEN m.format_version=2 THEN jsonb_build_object('completion_idempotency_id',m.completion_idempotency_id,
        'retention_kind',m.retention_kind,'source_origin_session_id',m.source_origin_session_id) ELSE '{}'::jsonb END END)`;
const qualified = `((NOT i.saved_memory_lineage_required AND m.task_id IS NULL)
  OR (saved_memory_task_current(i.account_id,m.task_id,i.actor_user_id,tick.checked_at)
    AND ((NOT i.saved_memory_lineage_required AND m.format_version=1)
      OR (m.format_version=2 AND m.completion_idempotency_id=i.id AND i.response_status=201
        AND i.operation_scope='create_unscoped_chat_task'
        AND ((m.retention_kind='canonical_no_session' AND retained.task_id IS NULL)
          OR (m.retention_kind='session_bound' AND retained.actor_user_id=i.actor_user_id
            AND retained.origin_session_id=m.source_origin_session_id AND retained.expires_at=m.expires_at))))))`;

export interface CapturedCanonicalBody extends SessionHistoryCanonicalResult { claim: string | null }

/** A fixed query returning the canonical body and its private metadata together.
 * A refused complete frame transfers no bodies or metadata. Inline projects only
 * the text the existing UTF-16 selection can actually use. */
export async function readCapturedHistoryBodies(database: DatabaseClient, auth: AuthContext,
  taskIDs: string[], complete: boolean): Promise<CapturedCanonicalBody[]> {
  const inlineProjection = `jsonb_build_object('task_id',body->>'task_id') || CASE WHEN body ? 'blocks' THEN
    jsonb_build_object('blocks',jsonb_build_array(jsonb_build_object('kind','answer','body',COALESCE((
      SELECT left(string_agg(b->>'body',E'\\n' ORDER BY n),2000)
      FROM jsonb_array_elements(body->'blocks') WITH ORDINALITY blocks(b,n)
      WHERE b->>'kind' IN ('answer','clarification','question_set')),'')))) ELSE '{}'::jsonb END`;
  const row = (await database.query<{ responses: CapturedCanonicalBody[] | null }>(`WITH tick AS MATERIALIZED (
    SELECT statement_timestamp() AS checked_at
  ), candidates AS MATERIALIZED (
    SELECT i.operation_scope,CASE WHEN visible.ok THEN i.response_body
      ELSE jsonb_build_object('task_id',i.response_body->>'task_id','blocks','[]'::jsonb) END AS body,
      CASE WHEN visible.ok AND i.response_body ? 'blocks' THEN ${claim} ELSE NULL END AS original
    FROM idempotency_records i CROSS JOIN tick ${joins} CROSS JOIN LATERAL (SELECT ${qualified} AS ok) visible
    WHERE i.account_id=$1 AND i.actor_user_id=$2 AND i.status='completed'
      AND i.operation_scope IN ('create_chat_task','create_unscoped_chat_task')
      AND i.response_body->>'task_id'=ANY($3::text[])
  ), projected AS MATERIALIZED (
    SELECT jsonb_build_object('operation_scope',operation_scope,'response_body',${complete ? "body" : inlineProjection},
      'claim',original::text) AS frame FROM candidates
  ), budget AS MATERIALIZED (
    SELECT count(*) AS total,COALESCE(sum(octet_length(frame::text)),0) AS bytes FROM projected
  ) SELECT CASE WHEN total<=$4 AND bytes + GREATEST(2,total*2)<=$5
    THEN (SELECT COALESCE(jsonb_agg(frame),'[]'::jsonb) FROM projected) ELSE NULL END AS responses FROM budget`,
  [auth.accountId, auth.userId, taskIDs, SESSION_HISTORY_MAX_TURNS, 1_048_576])).rows[0];
  if (!row || !Array.isArray(row.responses)) throw sessionHistorySnapshotUnavailable();
  for (const item of row.responses) {
    if (item.claim === null) continue;
    const original = JSON.parse(item.claim) as { proof: unknown; digest: string | null };
    if (original.proof === null) continue;
    // Qualify both released codecs, including the actual V1 JSON key order and
    // finite clock. Invalid metadata withholds just this canonical assistant.
    try {
      const proof = captureSavedMemoryRetainedProof(original.proof);
      const digest = proof.version === 2 ? savedMemoryDurableProofDigest(proof)
        : createHash("sha256").update(JSON.stringify(proof)).digest("hex");
      if (digest === original.digest) continue;
    } catch (error) {
      if (error instanceof ApiError && error.code === "SAVED_MEMORY_BUDGET_LIMITED") throw sessionHistorySnapshotUnavailable();
    }
    item.claim = null;
    item.response_body = { task_id: item.response_body.task_id, blocks: [] };
  }
  return row.responses;
}

/** Final-writer locks only, in the original transaction after provider work.
 * Follow the frozen identity set. These locks cannot admit a newer proof. */
export async function lockCapturedHistoryClaims(database: PoolClient, account: string, originals: readonly unknown[]) {
  // Every non-NULL proof was decoded at capture; concatenate the actual
  // tuples only for the shared lock helper. The final joint compares each
  // original independently, including inconsistent or empty sets.
  const claims = originals as readonly { proof: { stamps: SavedMemoryStamp[] } | null }[];
  const stamps = claims.flatMap(item => item.proof?.stamps ?? []);
  if (stamps.length) await lockSavedMemoryLineageTargets(database, { account_id: account, stamps });
  const params = [account, JSON.stringify(claims)];
  await database.query(`SELECT i.id FROM idempotency_records i WHERE i.account_id=$1
    AND i.id IN (SELECT (a->>'completion')::uuid FROM jsonb_array_elements($2::jsonb) a)
    ORDER BY i.id FOR SHARE NOWAIT`, params);
  await database.query(`SELECT l.task_id FROM agent_task_memory_lineage l WHERE l.account_id=$1 AND l.task_id IN
    (SELECT (a->'proof'->>'task_id')::uuid FROM jsonb_array_elements($2::jsonb) a)
    ORDER BY l.task_id FOR UPDATE NOWAIT`, params);
  await database.query(`SELECT d.task_id FROM agent_task_saved_memory_dependencies d WHERE d.account_id=$1
    AND (d.task_id,d.memory_item_id) IN (SELECT (a->'proof'->>'task_id')::uuid,(s->>'item_id')::uuid
      FROM jsonb_array_elements($2::jsonb) a,jsonb_array_elements(a->'proof'->'stamps') s)
    ORDER BY d.task_id,d.memory_item_id FOR SHARE NOWAIT`, params);
}

// Parameter 12 is assembled exclusively by the real Legacy owner. The capture
// query and this last statement use byte-for-byte identical tuple projections.
export const capturedHistoryClaimsCurrentSQL = `NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements($12::jsonb->'claims') wanted WHERE NOT EXISTS (
    SELECT 1 FROM idempotency_records i ${joins}
    WHERE i.id=(wanted->>'completion')::uuid AND i.account_id=$6 AND i.actor_user_id=$7 AND i.status='completed'
      AND ${qualified} AND ${claim}=wanted))`;

export const capturedHistorySourcesCurrentSQL = `NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements_text($12::jsonb->'tasks') requested(task)
  LEFT JOIN agent_session_chat_tasks t ON t.account_id=$6 AND t.task_id=canonical_agent_session_id(requested.task)
  WHERE (t.actor_user_id IS NOT NULL AND t.actor_user_id<>$7) OR NOT agent_session_chat_sources_available($6,requested.task))
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($12::jsonb->'screenshots') shot
    LEFT JOIN screenshot_contact_tasks t ON t.account_id=$6 AND t.id=(shot->>'taskID')::uuid
    WHERE t.id IS NULL OR t.created_by_user_id<>$7 OR NOT agent_session_screenshot_context_available($6,t.id)
      OR agent_session_screenshot_fingerprint(t) IS DISTINCT FROM shot->>'fingerprint')`;

export const capturedHistoryDeadlineSQL = `LEAST(
  (SELECT min((item->'proof'->>'expires_at')::timestamptz) FROM jsonb_array_elements($12::jsonb->'claims') item),
  (SELECT min(t.expires_at) FROM jsonb_array_elements_text($12::jsonb->'tasks') wanted(task)
    JOIN agent_session_chat_tasks t ON t.account_id=$6 AND t.task_id=canonical_agent_session_id(wanted.task)),
  (SELECT min(LEAST(t.expires_at,c.retention_until,r.authorization_expires_at))
    FROM jsonb_array_elements($12::jsonb->'screenshots') shot
    JOIN screenshot_contact_tasks t ON t.account_id=$6 AND t.id=(shot->>'taskID')::uuid
    LEFT JOIN captures c ON c.account_id=t.account_id AND c.id=t.capture_id
    LEFT JOIN source_retention_receipts r ON r.account_id=c.account_id AND r.capture_id=c.id),
  (SELECT min(h.valid_until) FROM identity_handles h WHERE h.account_id=$6 AND h.status='confirmed'
    AND h.subject_id IN (SELECT value::uuid FROM jsonb_array_elements_text($12::jsonb->'source'->'personIDs'))))`;
