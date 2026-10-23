import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CaptureImageObservationSchema, DesktopCaptureResultSchema, CONTRACT_VERSION, type ConversationImageManifest,
  type ConversationQueueEntryStatus, type DesktopCaptureResult } from "@talent-signal/contracts";
import type { Pool } from "pg";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { getAgentSession } from "./agentSessions.js";
import { projectDesktopCaptureReceipt } from "./desktopCaptureReceipt.js";

interface CaptureResultRow {
  id: string;
  message_id: string;
  run_id: string | null;
  revision: number;
  status: ConversationQueueEntryStatus;
  updated_at: Date;
}

export function projectDesktopCaptureResult(sessionId: string, row: CaptureResultRow,
  sources: readonly (ConversationImageManifest & { capture_observation?: unknown })[],
  turns: readonly { id: string; images?: readonly ConversationImageManifest[] }[],
): DesktopCaptureResult | null {
  if (!projectDesktopCaptureReceipt(row, sources, turns).result_recorded) return null;
  const record = sources[0]!;
  const { attachment_id, file_name, media_type, byte_size, content_hash } = record;
  const source = { attachment_id, file_name, media_type, byte_size, content_hash };
  const envelope = record.capture_observation && typeof record.capture_observation === "object"
    ? record.capture_observation as Record<string, unknown> : null;
  const candidate = envelope?.observation;
  const observation = row.run_id && envelope?.run_id === row.run_id &&
    Value.Check(CaptureImageObservationSchema, candidate) && candidate.content_hash === source.content_hash &&
    candidate.artifact_id === `conversation-image-${row.message_id}-0-${source.attachment_id}`
      ? candidate : null;
  const result_version = createHash("sha256").update(JSON.stringify([
    row.id, row.run_id, row.revision, source.attachment_id, source.content_hash, observation,
  ])).digest("hex");
  return { contract_version: CONTRACT_VERSION, session_id: sessionId, message_id: row.message_id,
    queue_entry_id: row.id, result_version, source, observation, observed_at: row.updated_at.toISOString() };
}

/** No free-form Session field can create a clue. Recheck source lifecycle on
 * every visible-surface read; the old metadata receipt remains compatible. */
export async function readDesktopCaptureResult(pool: Pool, auth: AuthContext, sessionId: string, messageId: string) {
  const session = await getAgentSession(pool, auth, sessionId);
  if (session.deleted_at || Date.parse(session.expires_at) <= Date.now() || !session.payload) {
    throw new ApiError(410, "DESKTOP_CAPTURE_SESSION_GONE", "The original Session is no longer available.");
  }
  const row = (await pool.query<CaptureResultRow>(
    `SELECT id,message_id,run_id,revision,status,updated_at FROM conversation_queue_entries
     WHERE account_id=$1 AND session_id=$2 AND message_id=$3 AND created_by_user_id=$4`,
    [auth.accountId, sessionId, messageId, auth.userId],
  )).rows[0];
  if (!row) throw new ApiError(404, "DESKTOP_CAPTURE_NOT_FOUND", "The screenshot was not admitted in this Session.");
  if (row.status !== "completed") throw new ApiError(409, "DESKTOP_CAPTURE_RESULT_NOT_RECORDED", "The screenshot has not completed.");
  const sources = (await pool.query<ConversationImageManifest & { capture_observation: unknown }>(
    `SELECT i.attachment_id,i.file_name,i.media_type,i.byte_size,i.content_hash,i.capture_observation
     FROM conversation_message_images i
     JOIN conversation_queue_entries e ON e.account_id=i.account_id AND e.id=i.queue_entry_id
     JOIN agent_sessions s ON s.account_id=i.account_id AND s.id=i.session_id
     WHERE i.account_id=$1 AND i.session_id=$2 AND i.message_id=$3 AND i.queue_entry_id=$4
       AND e.created_by_user_id=$5 AND e.expires_at>now()
       AND e.status='completed'
       AND i.expires_at>now() AND octet_length(i.content)=i.byte_size
       AND encode(sha256(i.content),'hex')=i.content_hash AND s.created_by_user_id=$5
       AND s.deleted_at IS NULL AND s.expires_at>now()
       AND NOT EXISTS (SELECT 1 FROM memory_source_revocations r WHERE r.account_id=i.account_id
         AND ((r.source_kind='artifact' AND r.source_id='conversation-image-'||i.message_id::text||'-'||i.image_index::text||'-'||i.attachment_id::text)
           OR (r.source_kind='session' AND r.source_id=i.session_id::text)))
     ORDER BY i.image_index`,
    [auth.accountId, sessionId, messageId, row.id, auth.userId],
  )).rows;
  if (!sources.length) throw new ApiError(410, "DESKTOP_CAPTURE_SOURCE_GONE", "The current screenshot source is unavailable.");
  const result = projectDesktopCaptureResult(sessionId, row, sources, session.payload.turns);
  if (!result) throw new ApiError(409, "DESKTOP_CAPTURE_RESULT_NOT_RECORDED", "The exact screenshot result is not recorded yet.");
  return result;
}

export function registerDesktopCaptureResult(app: FastifyInstance, pool: Pool, authenticate: preHandlerHookHandler): void {
  app.get<{ Params: { sessionId: string; messageId: string } }>("/v1/desktop-capture/:sessionId/:messageId/result", {
    preHandler: [authenticate],
    schema: {
      security: [{ bearerSession: [] }],
      params: Type.Object({ sessionId: Type.String({ format: "uuid" }), messageId: Type.String({ format: "uuid" }) }),
      response: { 200: DesktopCaptureResultSchema },
    },
  }, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    return readDesktopCaptureResult(pool, request.auth, request.params.sessionId, request.params.messageId);
  });
}
