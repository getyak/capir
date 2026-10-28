import { Type } from "@sinclair/typebox";
import {
  AgentSessionMutationRequestSchema,
  AgentSessionDeleteRequestSchema,
  AgentSessionResponseSchema,
  AgentSessionListResponseSchema,
  ErrorResponseSchema,
  CONTRACT_VERSION,
  type AgentSessionMutationRequest,
  type AgentSessionDeleteRequest,
  type AgentSessionRecord,
} from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import { ApiError } from "../lib/apiError.js";
import { registerRecurringJob } from "../lib/recurringJob.js";
import {
  getAgentSession,
  listAgentSessions,
  mutateAgentSession,
  runAgentSessionRetentionSweep,
} from "./agentSessions.js";

/** Reader negotiation changes historical display only, never canonical state or execution scope. */
function sessionForReader(session: AgentSessionRecord, includeMemoryDraftTargets: boolean): AgentSessionRecord {
  if (includeMemoryDraftTargets || !session.payload || !session.payload.turns.some(turn => turn.memoryDraftTarget !== undefined)) return session;
  const copy = structuredClone(session);
  for (const turn of copy.payload!.turns) delete turn.memoryDraftTarget;
  return copy;
}

async function readerSession(read: () => Promise<AgentSessionRecord>, includeMemoryDraftTargets: boolean) {
  try {
    return sessionForReader(await read(), includeMemoryDraftTargets);
  } catch (error) {
    // Conflict/deletion readback carries the same Session DTO as a success.
    // Keep that recovery path compatible with strict legacy readers too.
    if (!includeMemoryDraftTargets && error instanceof ApiError && error.details && typeof error.details === "object"
      && "session" in error.details && error.details.session && typeof error.details.session === "object"
      && "payload" in error.details.session) {
      throw new ApiError(error.statusCode, error.code, error.message, { ...error.details,
        session: sessionForReader(error.details.session as AgentSessionRecord, false) });
    }
    throw error;
  }
}

export function registerAgentSessionRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
) {
  const common = {
    preHandler: authenticate,
    schema: { security: [{ bearerSession: [] }], tags: ["agent-sessions"] },
  };
  const params = Type.Object(
    { id: Type.String({ format: "uuid" }) },
    { additionalProperties: false },
  );
  const authenticatedListRateLimit = app.rateLimit({
    errorResponseBuilder: () => new ApiError(
      429,
      "AGENT_SESSION_LIST_RATE_LIMITED",
      "Too many Session list refreshes; retry after the current window.",
    ),
    keyGenerator: (request) =>
      `${request.auth.accountId}:${request.auth.userId}`,
    max: 30,
    timeWindow: "1 minute",
  });
  const firstPageListRateLimit: preHandlerHookHandler = async function (
    request,
    reply,
  ) {
    const query = request.query as { after?: string };
    if (!query.after) {
      await authenticatedListRateLimit.call(this, request, reply);
    }
  };
  app.get<{ Querystring: { after?: string; limit?: string } }>(
    "/v1/agent-sessions",
    {
      ...common,
      // Authentication must establish the owner before the bucket key is
      // derived; loopback Web traffic otherwise collapses into one IP bucket.
      preHandler: [authenticate, firstPageListRateLimit],
      schema: {
        ...common.schema,
        querystring: Type.Object(
          {
            after: Type.Optional(
              Type.String({ maxLength: 512, pattern: "^[A-Za-z0-9_-]+$" }),
            ),
            limit: Type.Optional(
              Type.String({ pattern: "^(?:[1-9]|[1-4][0-9]|50)$" }),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: AgentSessionListResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const result = await listAgentSessions(
        pool,
        request.auth,
        request.query.after,
        Number(request.query.limit ?? 50),
      );
      return { ...result, sessions: result.sessions.map(session => sessionForReader(session,
        request.headers["x-conversation-memory-draft-target"] === "1")) };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/agent-sessions/:id",
    {
      ...common,
      schema: {
        ...common.schema,
        params,
        response: {
          200: AgentSessionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return {
        contract_version: CONTRACT_VERSION,
        session: await readerSession(() => getAgentSession(pool, request.auth, request.params.id),
          request.headers["x-conversation-memory-draft-target"] === "1"),
      };
    },
  );
  app.put<{ Params: { id: string }; Body: AgentSessionMutationRequest }>(
    "/v1/agent-sessions/:id",
    {
      ...common,
      bodyLimit: 250 * 1024,
      schema: {
        ...common.schema,
        params,
        body: AgentSessionMutationRequestSchema,
        response: {
          200: AgentSessionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return {
        contract_version: CONTRACT_VERSION,
        session: await readerSession(() => mutateAgentSession(
          pool,
          request.auth,
          request.params.id,
          request.body,
        ), request.headers["x-conversation-memory-draft-target"] === "1"),
      };
    },
  );
  app.delete<{ Params: { id: string }; Body: AgentSessionDeleteRequest }>(
    "/v1/agent-sessions/:id",
    {
      ...common,
      schema: {
        ...common.schema,
        params,
        body: AgentSessionDeleteRequestSchema,
        response: {
          200: AgentSessionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return {
        contract_version: CONTRACT_VERSION,
        session: await readerSession(() => mutateAgentSession(
          pool,
          request.auth,
          request.params.id,
          request.body,
          true,
        ), request.headers["x-conversation-memory-draft-target"] === "1"),
      };
    },
  );
  registerRecurringJob(app, {
    name: "agent-session-retention-sweep",
    intervalMs: 60_000,
    run: () => runAgentSessionRetentionSweep(pool),
  });
}
