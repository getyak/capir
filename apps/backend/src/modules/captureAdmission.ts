import { Type } from "@sinclair/typebox";
import { AgentSessionPayloadSchema, ConversationQueueAdmitRequestSchema, ConversationQueueAdmitResponseSchema,
  type AgentSessionPayload, type ConversationQueueAdmitRequest } from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import { ApiError } from "../lib/apiError.js";
import { getAgentSession, mutateAgentSession } from "./agentSessions.js";
import type { AuthContext } from "./auth.js";
import type { CaptureActivityService } from "./captureActivityService.js";
import { admitConversationQueueEntry } from "./conversationQueueAdmission.js";

export interface CaptureAdmissionRequest {
  session_operation_id: string;
  initial_session: AgentSessionPayload;
  message: ConversationQueueAdmitRequest;
  capture_activity?: { activity_instance_id: string; token: string; environment: string; token_generation: number };
}

export function assertInitialCaptureSession(id: string, input: CaptureAdmissionRequest): void {
  const session = input.initial_session;
  if (session.id.toLowerCase() !== id.toLowerCase() || input.message.session_id.toLowerCase() !== id.toLowerCase()
      || session.scopeKind !== "unresolved_intent" || session.turns.length !== 0
      || session.personID != null || session.relationshipContextID != null || session.identityResolutionCaseID != null
      || (session.contactReceipts?.length ?? 0) !== 0 || (session.screenshotTaskIDs?.length ?? 0) !== 0
      || session.contactProposal != null || session.originSessionID != null || session.originTurnID != null
      || session.personDisplayLabel !== "" || session.contextDisplayLabel !== ""
      || (input.message.images?.length ?? 0) !== 1 || input.message.host_result != null) {
    throw new ApiError(422, "CAPTURE_ADMISSION_INVALID", "Capture admission requires one image and its own empty unresolved Session.");
  }
}

/** One file-backed HTTP operation. Each governed step is idempotent, so a
 * crash between Session creation and message admission is resumed with the
 * exact same operation/body, without another client request under lock. */
export async function admitBackgroundCapture(pool: Pool, auth: AuthContext, id: string, input: CaptureAdmissionRequest) {
  assertInitialCaptureSession(id, input);
  try {
    await mutateAgentSession(pool, auth, id, { expected_revision: 0,
      idempotency_key: input.session_operation_id, payload: input.initial_session });
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "AGENT_SESSION_REVISION_CONFLICT") throw error;
    // Compatibility with an earlier foreground placeholder creator. A 409 is
    // never success by itself: authenticated current-owner readback must match
    // the exact persisted initial Session identity and immutable creation time.
    const current = await getAgentSession(pool, auth, id);
    const payload = current.payload;
    if (current.deleted_at != null || !payload || payload.id.toLowerCase() !== id.toLowerCase()
        || payload.scopeKind !== "unresolved_intent"
        || Date.parse(payload.createdAt ?? payload.updatedAt) !== Date.parse(input.initial_session.createdAt ?? input.initial_session.updatedAt)) throw error;
  }
  return admitConversationQueueEntry(pool, auth, input.message);
}

export function registerCaptureAdmissionRoutes(app: FastifyInstance, pool: Pool, authenticate: preHandlerHookHandler, activityService: CaptureActivityService | null = null) {
  app.post<{ Params: { id: string }; Body: CaptureAdmissionRequest }>("/v1/capture-admissions/:id", {
    preHandler: authenticate, bodyLimit: 40_100_000, schema: {
      params: Type.Object({ id: Type.String({ format: "uuid" }) }, { additionalProperties: false }),
      body: Type.Object({ session_operation_id: Type.String({ format: "uuid" }),
        initial_session: AgentSessionPayloadSchema, message: ConversationQueueAdmitRequestSchema,
        capture_activity: Type.Optional(Type.Object({ activity_instance_id: Type.String({ format: "uuid" }),
          token: Type.String({ pattern: "^[0-9a-f]{32,1024}$" }), token_generation: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
          environment: Type.Union([Type.Literal("production"), Type.Literal("sandbox")]) }, { additionalProperties: false })) }, { additionalProperties: false }),
      response: { 202: ConversationQueueAdmitResponseSchema },
    },
  }, async (request, reply) => {
    const result = await admitBackgroundCapture(pool, request.auth, request.params.id, request.body);
    if (activityService && request.body.capture_activity) {
      // Optional projection never changes the canonical source receipt. A late
      // or rotated capability is recovered by the normal registration outbox.
      try {
        await activityService.register(request.auth, request.params.id,
          { ...request.body.capture_activity, message_id: request.body.message.message_id });
        void activityService.pump().catch(() => undefined);
      } catch { /* No token, source body or provider failure enters logs. */ }
    }
    return reply.header("idempotent-replayed", result.replayed).code(202).send(result.response);
  });
}
