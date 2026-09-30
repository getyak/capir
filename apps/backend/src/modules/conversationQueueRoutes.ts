import { Type, FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ConversationQueueAdmitRequestSchema,
  ConversationQueueAdmitResponseSchema,
  ConversationQueueMutationRequestSchema,
  ConversationQueueMutationResponseSchema,
  ConversationQueueSnapshotSchema,
  ErrorResponseSchema,
  type ConversationQueueAdmitRequest,
  type ConversationQueueMutationRequest,
} from "@talent-signal/contracts";
import type {
  FastifyInstance,
  FastifySchema,
  FastifySchemaCompiler,
  preHandlerHookHandler,
} from "fastify";
import type { Pool } from "pg";

import {
  admitConversationQueueEntry,
  mutateConversationQueueEntry,
  readConversationQueueSnapshot,
} from "./conversationQueue.js";
import { readConversationMessageImage } from "./conversationMessageImages.js";
import {
  readConversationQueuePreview,
  subscribeConversationQueueLive,
} from "./conversationQueueLive.js";
import { currentSession } from "./auth.js";
import { ApiError } from "../lib/apiError.js";

const STREAM_LIFETIME_MS = 55_000;
const HEARTBEAT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
if (!FormatRegistry.Has("uuid")) FormatRegistry.Set("uuid", (value) => UUID.test(value));
if (!FormatRegistry.Has("date-time"))
  FormatRegistry.Set(
    "date-time",
    (value) => /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)),
  );

/**
 * Narrow, non-mutating body validation for the mutation union.
 *
 * Fastify's default Ajv uses `removeAdditional`, which mutates an `anyOf`
 * union branch before later branches are checked; the first `edit` branch then
 * strips `run_id` so a valid `stop` can never match. TypeBox `Value.Check`
 * validates the union without mutating the caller's body. Every other schema
 * part keeps the application's default compiler.
 */
function conversationQueueValidatorCompiler(
  app: FastifyInstance,
): FastifySchemaCompiler<FastifySchema> {
  return (routeSchema) => {
    const schemaID = (routeSchema.schema as { $id?: string } | undefined)?.$id;
    if (routeSchema.httpPart === "body" && schemaID === "ConversationQueueMutationRequest") {
      return (data) =>
        Value.Check(ConversationQueueMutationRequestSchema, data)
          ? { value: data }
          : {
              error: new ApiError(
                400,
                "CONVERSATION_QUEUE_MUTATION_INVALID",
                "The queue mutation does not match its bounded contract.",
              ),
            };
    }
    const fallback = app.validatorCompiler;
    if (!fallback) throw new Error("CONVERSATION_QUEUE_VALIDATOR_UNAVAILABLE");
    return fallback(routeSchema);
  };
}

export function registerConversationQueueRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
) {
  const streams = new Set<() => void>();
  app.addHook("preClose", async () => { for (const close of streams) close(); });
  const mutationValidatorCompiler = conversationQueueValidatorCompiler(app);
  const common = {
    preHandler: authenticate,
    schema: { security: [{ bearerSession: [] }], tags: ["agent-sessions"] },
  };
  const params = Type.Object(
    { id: Type.String({ format: "uuid" }) },
    { additionalProperties: false },
  );

  app.post<{ Params: { id: string }; Body: ConversationQueueAdmitRequest }>(
    "/v1/agent-sessions/:id/conversation-queue",
    {
      ...common,
      bodyLimit: 40_100_000,
      schema: {
        ...common.schema,
        params,
        body: ConversationQueueAdmitRequestSchema,
        response: {
          202: ConversationQueueAdmitResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.body.session_id !== request.params.id) {
        return reply.status(400).send({
          error: {
            code: "CONVERSATION_QUEUE_SESSION_MISMATCH",
            message: "The queue request must address its own Session.",
            request_id: request.id,
          },
        });
      }
      const result = await admitConversationQueueEntry(
        pool,
        request.auth,
        request.body,
      );
      request.log.info({
        session_id: request.params.id,
        message_id: request.body.message_id,
        queue_entry_id: result.response.queue_entry_id,
        replayed: result.replayed,
        image_count: request.body.images?.length ?? 0,
        image_bytes: request.body.images?.reduce((total, image) => total + image.byte_size, 0) ?? 0,
      }, "conversation queue admitted");
      return reply
        .header("idempotent-replayed", result.replayed)
        .status(202)
        .send(result.response);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/agent-sessions/:id/conversation-queue",
    {
      ...common,
      schema: {
        ...common.schema,
        params,
        response: { 200: ConversationQueueSnapshotSchema, "4xx": ErrorResponseSchema },
      },
    },
    async (request) =>
      readConversationQueueSnapshot(pool, request.auth, request.params.id),
  );

  app.get<{ Params: { id: string; messageId: string; index: number } }>(
    "/v1/agent-sessions/:id/conversation-images/:messageId/:index",
    {
      ...common,
      schema: {
        ...common.schema,
        params: Type.Object({
          id: Type.String({ format: "uuid" }),
          messageId: Type.String({ format: "uuid" }),
          index: Type.Integer({ minimum: 0, maximum: 9 }),
        }),
      },
    },
    async (request, reply) => {
      const image = await readConversationMessageImage(
        pool,
        request.auth,
        request.params.id,
        request.params.messageId,
        request.params.index,
      );
      if (!image) {
        return reply.status(404).send({
          error: {
            code: "CONVERSATION_IMAGE_NOT_FOUND",
            message: "This conversation image is no longer available.",
            request_id: request.id,
          },
        });
      }
      return reply
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff")
        .type(image.media_type)
        .send(image.content);
    },
  );

  app.post<{ Params: { id: string }; Body: ConversationQueueMutationRequest }>(
    "/v1/agent-sessions/:id/conversation-queue/mutations",
    {
      ...common,
      validatorCompiler: mutationValidatorCompiler,
      schema: {
        ...common.schema,
        params,
        body: ConversationQueueMutationRequestSchema,
        response: {
          200: ConversationQueueMutationResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const outcome = await mutateConversationQueueEntry(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
      return {
        contract_version: outcome.snapshot.contract_version,
        snapshot: outcome.snapshot,
        applied: outcome.applied,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/agent-sessions/:id/conversation-queue/stream",
    {
      ...common,
      schema: { ...common.schema, params },
    },
    async (request, reply) => {
      const sessionId = request.params.id;
      // Ownership and availability are checked before the transport is handed
      // over, so a deleted or foreign Session never opens a stream.
      await readConversationQueueSnapshot(pool, request.auth, sessionId);
      const accountId = request.auth.accountId;
      const raw = reply.raw;
      reply.hijack();
      raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      let closed = false;
      let dirty = true;
      let pumping = false;
      let lastRevision = -1;
      let lastPreview = "";
      const write = (chunk: string) => {
        if (closed) return;
        if (raw.writableLength > 128_000) { cleanup(); return; }
        raw.write(chunk);
      };
      const pump = async () => {
        if (closed || pumping) return;
        pumping = true;
        try {
          while (dirty && !closed) {
            dirty = false;
            let snapshot;
            try {
              await currentSession(pool, request.auth);
              snapshot = await readConversationQueueSnapshot(pool, request.auth, sessionId);
            } catch {
              // A revoked or deleted Session fences the stream immediately.
              write(`event: unavailable\ndata: ${JSON.stringify({ code: "CONVERSATION_QUEUE_UNAVAILABLE" })}\n\n`);
              cleanup();
              return;
            }
            const active = snapshot.active;
            const preview = active?.run_id && !active.cancel_requested
              ? readConversationQueuePreview(active.run_id)
              : null;
            if (preview && active?.run_id === preview.runId) {
              // Recheck the live lease as well as observation authority before
              // exposing process-local text. Recovery can reuse a run identity.
              const lease = await pool.query(`SELECT 1 FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2 AND run_id=$3 AND status='running' AND cancel_requested=false AND lease_expires_at>now() AND lease_generation=$4`, [accountId, sessionId, preview.runId, preview.leaseGeneration]);
              if (!lease.rowCount) { continue; }
            }
            if (closed) return;
            if (snapshot.revision !== lastRevision) {
              lastRevision = snapshot.revision;
              write(
                `id: ${snapshot.revision}\nevent: snapshot\ndata: ${JSON.stringify({
                  ...snapshot,
                  preview: preview
                    ? {
                        run_id: preview.runId,
                        message_id: preview.messageId,
                        text: preview.text, completed_tools: preview.completedTools ?? [],
                        stage: preview.stage,
                        revision: preview.sequence,
                      }
                    : null,
                })}\n\n`,
              );
            }
            const previewKey = preview ? `${preview.runId}:${preview.sequence}` : "";
            if (preview && previewKey !== lastPreview) {
              lastPreview = previewKey;
              write(`event: preview\ndata: ${JSON.stringify({ run_id: preview.runId, message_id: preview.messageId, text: preview.text, completed_tools: preview.completedTools ?? [], stage: preview.stage, revision: preview.sequence })}\n\n`);
            }
          }
        } catch {
          // Database uncertainty cannot retain a stream with stale authority.
          write("event: unavailable\ndata: {\"code\":\"CONVERSATION_QUEUE_UNAVAILABLE\"}\n\n");
          cleanup();
        } finally {
          pumping = false;
        }
      };
      write("retry: 2000\n\n");
      const unsubscribe = subscribeConversationQueueLive((event) => {
        if (event.type === "stop") return;
        if (event.type === "preview") {
          if (event.preview.accountId !== accountId || event.preview.sessionId !== sessionId) return;
          dirty = true;
          void pump();
          return;
        }
        if (event.accountId !== accountId || event.sessionId !== sessionId) return;
        dirty = true;
        void pump();
      });
      const heartbeat = setInterval(() => { write(": heartbeat\n\n"); dirty = true; void pump(); }, HEARTBEAT_MS);
      heartbeat.unref?.();
      const lifetime = setTimeout(() => {
        write("event: reconnect\ndata: {}\n\n");
        cleanup();
      }, STREAM_LIFETIME_MS);
      lifetime.unref?.();
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
        streams.delete(cleanup);
        raw.end();
      };
      streams.add(cleanup);
      raw.on("close", cleanup);
      raw.on("error", cleanup);
      await pump();
    },
  );
}
