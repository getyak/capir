import { Type } from "@sinclair/typebox";
import { CONTRACT_VERSION, DesktopCaptureReceiptSchema,
  type ConversationImageManifest, type ConversationQueueEntryStatus } from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { getAgentSession } from "./agentSessions.js";
import { readConversationMessageImageManifests } from "./conversationMessageImages.js";

type CaptureRow = { id: string; message_id: string; status: ConversationQueueEntryStatus; updated_at: Date };
type CaptureTurn = { id: string; images?: readonly ConversationImageManifest[] };

export function projectDesktopCaptureReceipt(
  row: CaptureRow,
  image_manifest: readonly ConversationImageManifest[],
  turns: readonly CaptureTurn[],
) {
  const matching = turns.find(turn => turn.id === row.message_id);
  const expectedImage = image_manifest[0];
  const recordedImage = matching?.images?.[0];
  const result_recorded = row.status === "completed" && image_manifest.length === 1 &&
    matching?.images?.length === 1 && expectedImage !== undefined && recordedImage !== undefined &&
    recordedImage.attachment_id === expectedImage.attachment_id &&
    recordedImage.byte_size === expectedImage.byte_size &&
    recordedImage.content_hash === expectedImage.content_hash;
  return {
    contract_version: CONTRACT_VERSION,
    message_id: row.message_id,
    queue_entry_id: row.id,
    status: row.status,
    image_manifest: [...image_manifest].slice(0, 1),
    observed_at: row.updated_at.toISOString(),
    result_recorded: result_recorded === true,
  };
}

export async function readDesktopCaptureReceipt(pool: Pool, auth: AuthContext, sessionId: string, messageId: string) {
  const session = await getAgentSession(pool, auth, sessionId);
  if (session.deleted_at || Date.parse(session.expires_at) <= Date.now() || !session.payload) {
    throw new ApiError(410, "DESKTOP_CAPTURE_SESSION_GONE", "The original Session is no longer available.");
  }
  const row = (await pool.query<CaptureRow>(
    `SELECT id,message_id,status,updated_at FROM conversation_queue_entries
     WHERE account_id=$1 AND session_id=$2 AND message_id=$3 AND created_by_user_id=$4`,
    [auth.accountId, sessionId, messageId, auth.userId],
  )).rows[0];
  if (!row) throw new ApiError(404, "DESKTOP_CAPTURE_NOT_FOUND", "The screenshot was not admitted in this Session.");
  const manifests = await readConversationMessageImageManifests(pool, auth.accountId, [row.id]);
  return { session_id: sessionId, ...projectDesktopCaptureReceipt(row, manifests.get(row.id) ?? [], session.payload.turns) };
}

export function registerDesktopCaptureReceipt(app: FastifyInstance, pool: Pool, authenticate: preHandlerHookHandler): void {
  app.get<{ Params: { sessionId: string; messageId: string } }>("/v1/desktop-capture/:sessionId/:messageId", {
    preHandler: [authenticate],
    schema: {
      security: [{ bearerSession: [] }],
      params: Type.Object({ sessionId: Type.String({ format: "uuid" }), messageId: Type.String({ format: "uuid" }) }),
      response: { 200: DesktopCaptureReceiptSchema },
    },
  }, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    return readDesktopCaptureReceipt(pool, request.auth, request.params.sessionId, request.params.messageId);
  });
}
