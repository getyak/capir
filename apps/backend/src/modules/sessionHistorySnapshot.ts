import { createHash } from "node:crypto";
import type { ConversationMessage, SessionHistorySnapshot } from "@talent-signal/agent";
import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { SESSION_CHAT_SOURCE_LIMIT, type AgentSessionChatSource, type AgentSessionScreenshotContext } from "./agentSessionSources.js";
import { labWorkspaceSessionActiveSQL } from "./labWorkspaceAccess.js";

export const SESSION_HISTORY_MAX_TURNS = 200;
const MAX_MESSAGES = SESSION_HISTORY_MAX_TURNS * 22;
const MAX_SOURCE_ROWS = SESSION_HISTORY_MAX_TURNS * 20;
const MAX_RESULT_BYTES = 1_048_576;
const MAX_TEXT_BYTES = 1_048_576;
const HISTORY_OWNER_SQL = `SELECT 1 FROM sessions
  JOIN accounts ON accounts.id=sessions.account_id
  JOIN users ON users.account_id=sessions.account_id AND users.id=sessions.user_id
  JOIN agent_sessions product ON product.account_id=sessions.account_id AND product.created_by_user_id=sessions.user_id
  WHERE sessions.id=$1 AND sessions.account_id=$2 AND sessions.user_id=$3
    AND sessions.revoked_at IS NULL AND sessions.expires_at>clock_timestamp()
    AND users.status='active' AND accounts.retired_at IS NULL
    AND product.id=$4 AND product.deleted_at IS NULL AND product.expires_at>clock_timestamp()
    AND product.payload->>'personID' IS NULL AND product.payload->>'relationshipContextID' IS NULL
    AND ${labWorkspaceSessionActiveSQL}`;

export function assertSessionHistoryTextBudget(messages: readonly ConversationMessage[]): void {
  if (messages.length > MAX_MESSAGES) throw sessionHistorySnapshotUnavailable();
  let bytes = 0;
  for (const message of messages) {
    if (message.message_id.length > 300) throw sessionHistorySnapshotUnavailable();
    bytes += Buffer.byteLength(message.text, "utf8");
    if (bytes > MAX_TEXT_BYTES) throw sessionHistorySnapshotUnavailable();
  }
}

export interface SessionHistoryCanonicalResult {
  operation_scope: string;
  response_body: { task_id: string; blocks?: Array<{ kind: string; body: string; citation_dependency_ids?: string[] }>;
    context_manifest_id?: string };
}

/** The CASE guards the scalar aggregation: oversized rows never cross the
 * database connection. Counting first in a separate statement would race an
 * update between admission and download. No partial body is called complete. */
export async function readSessionHistoryBodies(database: DatabaseClient, auth: AuthContext,
  taskIDs: string[]): Promise<SessionHistoryCanonicalResult[]> {
  const row = (await database.query<{ history_result_rows: string; history_result_bytes: string;
    responses: SessionHistoryCanonicalResult[] | null }>(`WITH candidates AS MATERIALIZED (
      SELECT operation_scope,response_body,octet_length(response_body::text) AS bytes FROM idempotency_records
      WHERE account_id=$1 AND actor_user_id=$2 AND status='completed'
        AND operation_scope IN ('create_chat_task','create_unscoped_chat_task')
        AND response_body->>'task_id'=ANY($3::text[])
    ), budget AS MATERIALIZED (
      SELECT count(*) AS result_rows,COALESCE(sum(bytes),0) AS result_bytes FROM candidates
    ) SELECT result_rows::text AS history_result_rows,result_bytes::text AS history_result_bytes,
      CASE WHEN result_rows<=$4 AND result_bytes<=$5 THEN
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('operation_scope',operation_scope,'response_body',response_body)),'[]'::jsonb)
          FROM candidates) ELSE NULL END AS responses FROM budget`,
  [auth.accountId, auth.userId, taskIDs, SESSION_HISTORY_MAX_TURNS, MAX_RESULT_BYTES])).rows[0];
  if (!row || !Number.isSafeInteger(Number(row.history_result_rows)) || Number(row.history_result_rows) < 0
    || Number(row.history_result_rows) > SESSION_HISTORY_MAX_TURNS
    || !Number.isSafeInteger(Number(row.history_result_bytes)) || Number(row.history_result_bytes) < 0
    || Number(row.history_result_bytes) > MAX_RESULT_BYTES || !Array.isArray(row.responses)
    || row.responses.length !== Number(row.history_result_rows)) throw sessionHistorySnapshotUnavailable();
  return row.responses;
}

/** One bounded metadata round trip rather than two queries for every turn. */
export async function readSessionHistorySources(database: DatabaseClient, auth: AuthContext,
  taskIDs: string[]): Promise<Map<string, AgentSessionChatSource[] | null>> {
  const rows = (await database.query<{ history_source_task: string; available: boolean;
    screenshot_task_id: string | null; source_fingerprint: string | null }>(`WITH requested AS (
      SELECT DISTINCT unnest($3::text[]) AS task_id
    ) SELECT requested.task_id AS history_source_task,
      agent_session_chat_sources_available($1,requested.task_id) AS available,
      source.screenshot_task_id,source.source_fingerprint FROM requested
    LEFT JOIN agent_session_chat_sources source ON source.account_id=$1 AND source.actor_user_id=$2 AND source.task_id=requested.task_id
    LIMIT $4`, [auth.accountId, auth.userId, taskIDs, MAX_SOURCE_ROWS + 1])).rows;
  if (rows.length > MAX_SOURCE_ROWS) throw sessionHistorySnapshotUnavailable();
  const result = new Map<string, AgentSessionChatSource[] | null>();
  for (const row of rows) {
    if (!row.available) { result.set(row.history_source_task, null); continue; }
    if (!result.has(row.history_source_task)) result.set(row.history_source_task, []);
    if (row.screenshot_task_id && row.source_fingerprint)
      result.get(row.history_source_task)?.push({ taskID: row.screenshot_task_id, fingerprint: row.source_fingerprint });
  }
  if (new Set(taskIDs).size !== result.size) throw sessionHistorySnapshotUnavailable();
  return result;
}

/** Keep the existing canonical screenshot-summary projection, not raw state,
 * OCR, pixels or research bodies. Trim on the database side before transport. */
export async function readSessionHistoryScreenshots(database: DatabaseClient, auth: AuthContext,
  taskIDs: string[]): Promise<AgentSessionScreenshotContext[]> {
  return (await database.query<AgentSessionScreenshotContext>(`SELECT t.id,t.subject_id,t.assignment_id,t.capture_id,t.source_resource_id,
    agent_session_screenshot_fingerprint(t) AS fingerprint,
    left(t.state->'response'->>'summary',700) AS summary,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('text',left(f.value->>'text',200),'message_refs',
      (SELECT COALESCE(jsonb_agg(left(r.value,100)),'[]'::jsonb) FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(f.value->'message_refs')='array' THEN f.value->'message_refs' ELSE '[]'::jsonb END
      ) WITH ORDINALITY r(value,ordinal) WHERE r.ordinal<=4))),'[]'::jsonb)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.state->'response'->'findings')='array'
        THEN t.state->'response'->'findings' ELSE '[]'::jsonb END) WITH ORDINALITY f(value,ordinal) WHERE f.ordinal<=3) AS findings,
    left(t.state->'response'->>'question',200) AS question,
    (SELECT COALESCE(jsonb_agg(left(l.value,150)),'[]'::jsonb) FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(t.state->'response'->'limitations')='array' THEN t.state->'response'->'limitations' ELSE '[]'::jsonb END
    ) WITH ORDINALITY l(value,ordinal) WHERE l.ordinal<=2) AS limitations
    FROM screenshot_contact_tasks t WHERE t.account_id=$1 AND t.created_by_user_id=$2
      AND t.id::text=ANY($3::text[]) AND agent_session_screenshot_context_available($1,t.id)`,
  [auth.accountId, auth.userId, taskIDs])).rows;
}

/** Additional read authority, never a new authored-message/effect capability. */
export function createSessionHistorySnapshot(input: {
  database: DatabaseClient; auth: AuthContext; sessionID: string;
  messages: readonly ConversationMessage[]; currentMessageID?: string;
  sources: readonly AgentSessionChatSource[]; assertCurrent: () => Promise<void>;
  taskIDs: readonly string[]; sessionStamp: string; sourceGeneration: string;
  onExpiry?: (expiresAt: Date) => void;
}): SessionHistorySnapshot {
  const { database, auth, sessionID } = input;
  assertSessionHistoryTextBudget(input.messages);
  if (input.sources.length > SESSION_CHAT_SOURCE_LIMIT) throw sessionHistorySnapshotUnavailable();
  if (input.taskIDs.length > SESSION_HISTORY_MAX_TURNS) throw sessionHistorySnapshotUnavailable();
  const messages = input.messages.filter(message => message.message_id !== input.currentMessageID)
    .map(message => ({ ...message }));
  const sources = input.sources.map(source => ({ ...source }));
  const taskIDs = [...new Set(input.taskIDs)];
  if (messages.length && !taskIDs.length) throw unavailable();
  let earliestExpiry = Infinity;
  const version = createHash("sha256").update(JSON.stringify([
    auth.accountId, auth.userId, sessionID, messages, sources, taskIDs, input.sessionStamp, input.sourceGeneration,
  ])).digest("hex");
  return { messages, version, assertCurrent: async () => {
    // This guard was captured BEFORE compiling canonical dialogue. It binds
    // its complete turns/scope stamp and the account's source generation.
    await input.assertCurrent();
    await assertSessionHistoryOwner(database, auth, sessionID);
    await input.assertCurrent();
    // Final authority is one statement, after every other awaited guard. An
    // original reply can expire naturally while its fork Session stays live;
    // auth can also be revoked during the preceding metadata await.
    const row = (await database.query<{ history_owner_current: boolean; history_tasks_current: boolean;
      history_sources_current: boolean; history_stamp_current: boolean; history_generation_current: boolean;
      expires_at: Date | null; read_until: Date; checked_at: Date }>(`WITH history_deadlines AS MATERIALIZED (SELECT
        (SELECT min(expires_at) FROM agent_session_chat_tasks WHERE account_id=$2 AND actor_user_id=$3 AND task_id=ANY($5::text[])) AS task_expiry,
        (SELECT min(LEAST(source.expires_at,capture.retention_until,retention.authorization_expires_at))
          FROM screenshot_contact_tasks source
          LEFT JOIN captures capture ON capture.account_id=source.account_id AND capture.id=source.capture_id
          LEFT JOIN source_retention_receipts retention ON retention.account_id=capture.account_id AND retention.capture_id=capture.id
          WHERE source.account_id=$2 AND source.created_by_user_id=$3 AND source.id=ANY($6::uuid[])) AS source_expiry,
        (SELECT expires_at FROM sessions WHERE id=$1 AND account_id=$2 AND user_id=$3) AS auth_expiry,
        (SELECT expires_at FROM agent_sessions WHERE id=$4 AND account_id=$2 AND created_by_user_id=$3) AS session_expiry
      ), history_authority AS MATERIALIZED (SELECT
      EXISTS(${HISTORY_OWNER_SQL}) AS history_owner_current,
      NOT EXISTS (SELECT 1 FROM unnest($5::text[]) requested(task_id)
        LEFT JOIN agent_session_chat_tasks task ON task.account_id=$2 AND task.task_id=canonical_agent_session_id(requested.task_id)
        WHERE (task.actor_user_id IS NOT NULL AND task.actor_user_id<>$3)
          OR NOT agent_session_chat_sources_available($2,requested.task_id)) AS history_tasks_current,
      NOT EXISTS (SELECT 1 FROM unnest($6::uuid[],$7::text[]) wanted(id,fingerprint)
        LEFT JOIN screenshot_contact_tasks source ON source.account_id=$2 AND source.id=wanted.id
        WHERE source.id IS NULL OR source.created_by_user_id<>$3
          OR NOT agent_session_screenshot_context_available($2,source.id)
          OR agent_session_screenshot_fingerprint(source)<>wanted.fingerprint) AS history_sources_current,
      EXISTS(SELECT 1 FROM agent_sessions WHERE account_id=$2 AND created_by_user_id=$3 AND id=$4
        AND md5(jsonb_build_array(payload->'turns',payload->'personID',payload->'relationshipContextID')::text)=$8) AS history_stamp_current,
      COALESCE((SELECT generation FROM harness_source_generations WHERE account_id=$2),0)::text=$9 AS history_generation_current,
      LEAST(task_expiry,source_expiry) AS expires_at,
      LEAST(task_expiry,source_expiry,auth_expiry,session_expiry) AS read_until FROM history_deadlines)
      SELECT history_authority.*,clock_timestamp() AS checked_at FROM history_authority`,
    [auth.sessionId, auth.accountId, auth.userId, sessionID, taskIDs,
      sources.map(source => source.taskID), sources.map(source => source.fingerprint), input.sessionStamp, input.sourceGeneration])).rows[0];
    if (!row || !row.history_owner_current || !row.history_tasks_current || !row.history_sources_current
      || !row.history_stamp_current || !row.history_generation_current
      || !(row.checked_at instanceof Date) || !Number.isFinite(row.checked_at.valueOf())
      || !(row.read_until instanceof Date) || !Number.isFinite(row.read_until.valueOf())
      || row.checked_at.valueOf() >= row.read_until.valueOf()) throw unavailable();
    if (row.expires_at != null) {
      if (!(row.expires_at instanceof Date) || !Number.isFinite(row.expires_at.valueOf())) throw unavailable();
      earliestExpiry = Math.min(earliestExpiry, row.expires_at.valueOf());
      if (row.checked_at.valueOf() >= earliestExpiry) throw unavailable();
      input.onExpiry?.(new Date(earliestExpiry));
    }
  } };
}

/** Used before compiling the complete snapshot as well as every tool read. */
export async function assertSessionHistoryOwner(database: DatabaseClient, auth: AuthContext, sessionID: string): Promise<void> {
  const live = await database.query(HISTORY_OWNER_SQL,
  [auth.sessionId, auth.accountId, auth.userId, sessionID]);
  if (!live.rows.length) throw unavailable();
}

function unavailable() {
  return new ApiError(409, "SESSION_HISTORY_UNAVAILABLE", "The conversation history is no longer available in this session.");
}

export function sessionHistorySnapshotUnavailable() {
  return new ApiError(413, "SESSION_HISTORY_SNAPSHOT_UNAVAILABLE", "Earlier conversation history is unavailable for this run. The saved conversation has not changed.");
}
