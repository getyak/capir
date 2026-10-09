import { randomUUID } from "node:crypto";

import {
  ErrorResponseSchema,
  McpClientGrantCreateRequestSchema,
  McpConnectionProposeRequestSchema,
  McpDirectoryListResponseSchema,
  McpInteractionListResponseSchema,
  McpInteractionResponseSchema,
  McpInteractionResolveRequestSchema,
  McpOAuthAvailabilityResponseSchema,
  McpToolCallProposeRequestSchema,
  type McpConnectionProposeRequest,
  type McpInteractionResolveRequest,
  type McpToolCallProposeRequest,
  McpClientGrantCreateResponseSchema,
  McpClientGrantListResponseSchema,
  McpClientGrantResponseSchema,
  McpClientGrantRevokeRequestSchema,
  McpConnectionActionRequestSchema,
  McpConnectionCreateRequestSchema,
  McpConnectionListResponseSchema,
  McpConnectionResponseSchema,
  McpConnectionUpdateRequestSchema,
  McpEndpointsResponseSchema,
  type McpClientGrantCreateRequest,
  type McpClientGrantRevokeRequest,
  type McpConnectionActionRequest,
  type McpConnectionCreateRequest,
  type McpConnectionUpdateRequest,
} from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import type { BackendConfig } from "../config.js";
import { operatorTestDeployment } from "./labWorkspaceAccess.js";
import { Type } from "@sinclair/typebox";

import {
  connectMcpConnection,
  createMcpConnection,
  disconnectMcpConnection,
  inboundDependencies,
  listMcpConnections,
  updateMcpConnection,
  type McpInboundDependencies,
} from "./mcpConnections.js";
import {
  createMcpClientGrant,
  listMcpClientGrants,
  publicMcpEndpoint,
  resolveMcpGrant,
  revokeMcpClientGrant,
} from "./mcpGrants.js";
import {
  createMcpToolRegistry,
  registerMcpServerRoutes,
} from "./mcpServer.js";
import { parsePublicMcpOrigin } from "./mcpSecurity.js";
import { ApiError } from "../lib/apiError.js";
import { admitConversationQueueEntry } from "./conversationQueueAdmission.js";
import { reconcileMcpOAuthCleanup } from "./mcpOauthCleanup.js";
import { mcpDirectoryCatalog } from "./mcpDirectory.js";
import {
  applyNangoAuthWebhook,
  listMcpInteractions,
  mcpInteractionDependencies,
  pollNangoConnectRequest,
  proposeMcpConnection,
  proposeMcpToolCall,
  readMcpInteraction,
  recoverAbandonedMcpClaims,
  recoverAbandonedMcpConnectionWork,
  recoverMcpContinuations,
  resolveMcpInteraction,
  type McpInteractionContinuation,
  type McpInteractionDependencies,
} from "./mcpInteractions.js";
import { loadNangoConfig, parseNangoAuthWebhook, NANGO_DEFAULT_BASE_URL } from "./nango.js";
import { CONTRACT_VERSION } from "@talent-signal/contracts";

const IdParamsSchema = Type.Object(
  { id: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
);

export interface McpRouteOptions {
  allowedOrigins?: string[];
  deploymentWorkspaceIds?: readonly string[] | undefined;
  inbound?: McpInboundDependencies;
  publicOrigin?: string | null;
  interactions?: McpInteractionDependencies;
  /** Production continuation: re-enter the ordinary queued conversation. */
  continueConversation?: (input: McpInteractionContinuation) => Promise<void>;
}

export function registerMcpExtensionRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
  options: McpRouteOptions = {},
  config?: BackendConfig,
): void {
  const inbound = options.inbound ?? inboundDependencies();
  const publicOrigin =
    options.publicOrigin === undefined
      ? parsePublicMcpOrigin()
      : options.publicOrigin;
  const security = [{ bearerSession: [] }];
  const noStore: preHandlerHookHandler = async (_request, reply) => {
    reply.header("cache-control", "no-store");
  };

  app.get(
    "/v1/mcp/connections",
    {
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        response: {
          200: McpConnectionListResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => listMcpConnections(pool, request.auth),
  );

  app.post<{ Body: McpConnectionCreateRequest }>(
    "/v1/mcp/connections",
    {
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        body: McpConnectionCreateRequestSchema,
        response: {
          201: McpConnectionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await createMcpConnection(pool, request.auth, request.body, inbound)),
  );

  app.put<{ Body: McpConnectionUpdateRequest; Params: { id: string } }>(
    "/v1/mcp/connections/:id",
    {
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        params: IdParamsSchema,
        body: McpConnectionUpdateRequestSchema,
        response: {
          200: McpConnectionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      updateMcpConnection(
        pool,
        request.auth,
        request.params.id,
        request.body,
        inbound,
      ),
  );

  app.post<{ Body: McpConnectionActionRequest; Params: { id: string } }>(
    "/v1/mcp/connections/:id/connect",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        params: IdParamsSchema,
        body: McpConnectionActionRequestSchema,
        response: {
          200: McpConnectionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      connectMcpConnection(
        pool,
        request.auth,
        request.params.id,
        request.body,
        inbound,
      ),
  );

  app.post<{ Body: McpConnectionActionRequest; Params: { id: string } }>(
    "/v1/mcp/connections/:id/disconnect",
    {
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        params: IdParamsSchema,
        body: McpConnectionActionRequestSchema,
        response: {
          200: McpConnectionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      disconnectMcpConnection(
        pool,
        request.auth,
        request.params.id,
        request.body,
      ),
  );

  app.get(
    "/v1/mcp/clients",
    {
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        response: {
          200: McpClientGrantListResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => listMcpClientGrants(pool, request.auth),
  );

  app.post<{ Body: McpClientGrantCreateRequest }>(
    "/v1/mcp/clients",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        body: McpClientGrantCreateRequestSchema,
        response: {
          201: McpClientGrantCreateResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await createMcpClientGrant(
            pool,
            request.auth,
            request.body,
            publicOrigin,
          ),
        ),
  );

  app.post<{ Body: McpClientGrantRevokeRequest; Params: { id: string } }>(
    "/v1/mcp/clients/:id/revoke",
    {
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        params: IdParamsSchema,
        body: McpClientGrantRevokeRequestSchema,
        response: {
          200: McpClientGrantResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      revokeMcpClientGrant(pool, request.auth, request.params.id, request.body),
  );

  app.get(
    "/v1/mcp/endpoints",
    {
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        response: {
          200: McpEndpointsResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async () => publicMcpEndpoint(publicOrigin),
  );

  registerMcpServerRoutes(app, {
    allowedOrigins: options.allowedOrigins ?? [],
    publicOrigin,
    resolveGrant: (authorization) =>
      resolveMcpGrant(pool, authorization, {
        operatorTestDeployment: operatorTestDeployment(config),
        ...(options.deploymentWorkspaceIds
          ? { deploymentWorkspaceIds: options.deploymentWorkspaceIds }
          : {}),
      }),
    tools: createMcpToolRegistry(pool),
  });

  registerMcpInteractionRoutes(app, pool, authenticate, options);
}

const InteractionIdParamsSchema = Type.Object(
  { id: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
);

const ConnectRequestParamsSchema = Type.Object(
  { connectRequestId: Type.String({ minLength: 8, maxLength: 120 }) },
  { additionalProperties: false },
);

/**
 * Durable user-owned MCP human interactions. Every mutation revalidates the
 * acting account, member and session inside its transaction; staged requests
 * are the canonical card state and approvals are single-use and bound exactly.
 */
export function registerMcpInteractionRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
  options: McpRouteOptions = {},
): void {
  const dependencies = options.interactions ?? mcpInteractionDependencies();
  const security = [{ bearerSession: [] }];
  const noStore: preHandlerHookHandler = async (_request, reply) => {
    reply.header("cache-control", "no-store");
  };
  // The stable queue identity and host-only typed result come from the
  // durable outbox intent, so a retry re-admits the exact same message and
  // queue idempotency makes it a no-op instead of a duplicate task.
  const continueConversation =
    options.continueConversation ??
    (async (input: McpInteractionContinuation) => {
      await admitConversationQueueEntry(pool, input.auth, {
        host_result: input.result,
        idempotency_key: input.idempotencyKey,
        message_id: input.messageId,
        objective: input.text.slice(0, 1_000),
        session_id: input.sessionId,
      });
    });
  const withContinuation: McpInteractionDependencies = {
    ...dependencies,
    continueConversation,
  };

  app.get(
    "/v1/mcp/directory",
    {
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        response: { 200: McpDirectoryListResponseSchema, "4xx": ErrorResponseSchema },
      },
    },
    async () => ({
      contract_version: CONTRACT_VERSION,
      entries: mcpDirectoryCatalog(),
    }),
  );

  app.get(
    "/v1/mcp/oauth/availability",
    {
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        response: {
          200: McpOAuthAvailabilityResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async () => {
      const config = loadNangoConfig();
      return {
        available: config !== null,
        base_url: config ? config.baseUrl : NANGO_DEFAULT_BASE_URL,
        contract_version: CONTRACT_VERSION,
        note: config
          ? "OAuth is mediated by Nango connect sessions bound to this deployment."
          : "This deployment has not configured OAuth (NANGO_API_KEY and NANGO_WEBHOOK_SIGNING_KEY are absent), so OAuth connections are unavailable. Nothing was started.",
      };
    },
  );

  app.get(
    "/v1/mcp/interactions",
    {
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        querystring: Type.Object(
          { session_id: Type.Optional(Type.String({ format: "uuid" })) },
          { additionalProperties: false },
        ),
        response: {
          200: McpInteractionListResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      await recoverAbandonedMcpClaims(pool, withContinuation, request.auth);
      await recoverAbandonedMcpConnectionWork(pool, withContinuation, request.auth);
      await recoverMcpContinuations(pool, withContinuation, request.auth);
      await reconcileMcpOAuthCleanup(pool).catch(() => undefined);
      return listMcpInteractions(pool, request.auth, {
        sessionId: (request.query as { session_id?: string }).session_id ?? null,
      });
    },
  );

  app.post<{ Body: McpToolCallProposeRequest }>(
    "/v1/mcp/interactions/propose-call",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        body: McpToolCallProposeRequestSchema,
        response: {
          201: McpInteractionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await proposeMcpToolCall(
            pool,
            request.auth,
            request.body,
            withContinuation,
          ),
        ),
  );

  app.post<{ Body: McpConnectionProposeRequest }>(
    "/v1/mcp/interactions/propose-connection",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        body: McpConnectionProposeRequestSchema,
        response: {
          201: McpInteractionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await proposeMcpConnection(
            pool,
            request.auth,
            request.body,
            withContinuation,
          ),
        ),
  );

  app.get<{ Params: { id: string } }>(
    "/v1/mcp/interactions/:id",
    {
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        params: InteractionIdParamsSchema,
        response: {
          200: McpInteractionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      await recoverAbandonedMcpClaims(pool, withContinuation, request.auth);
      await recoverAbandonedMcpConnectionWork(pool, withContinuation, request.auth);
      await recoverMcpContinuations(pool, withContinuation, request.auth);
      return readMcpInteraction(pool, request.auth, request.params.id);
    },
  );

  app.post<{ Params: { id: string }; Body: McpInteractionResolveRequest }>(
    "/v1/mcp/interactions/:id/resolve",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        params: InteractionIdParamsSchema,
        body: McpInteractionResolveRequestSchema,
        response: {
          200: McpInteractionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      resolveMcpInteraction(
        pool,
        request.auth,
        request.params.id,
        request.body,
        withContinuation,
      ),
  );

  app.post<{ Params: { connectRequestId: string } }>(
    "/v1/mcp/oauth/poll/:connectRequestId",
    {
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
      preHandler: [authenticate, noStore],
      schema: {
        security,
        tags: ["mcp"],
        params: ConnectRequestParamsSchema,
        response: {
          200: McpInteractionResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const outcome = await pollNangoConnectRequest(
        pool,
        request.auth,
        request.params.connectRequestId,
        withContinuation,
      );
      if (outcome.request) {
        return {
          contract_version: CONTRACT_VERSION,
          request: outcome.request,
        };
      }
      throw new ApiError(
        409,
        "MCP_OAUTH_REQUEST_NOT_FOUND",
        "No verified authorization completion exists for this request yet.",
      );
    },
  );

  // The single public incoming webhook route. It reads the exact raw body for
  // HMAC verification, is bounded, persists before acknowledging, and accepts
  // only Nango auth events.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: 64 * 1024 },
      (_request, body, done) => {
        done(null, body);
      },
    );
    scope.post(
      "/v1/mcp/oauth/webhook",
      {
        config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
        schema: {
          tags: ["mcp"],
          hide: true,
        },
      },
      async (request, reply) => {
        reply.header("cache-control", "no-store");
        const rawBody = typeof request.body === "string" ? request.body : "";
        const header = request.headers["x-nango-hmac-sha256"];
        const webhook = parseNangoAuthWebhook(rawBody);
        const outcome = await applyNangoAuthWebhook(
          pool,
          rawBody,
          header,
          webhook,
          withContinuation,
        );
        if (outcome.status === "unavailable") {
          return reply.status(503).send({ error: "MCP_OAUTH_UNAVAILABLE" });
        }
        if (outcome.status === "unverified") {
          return reply.status(401).send({ error: "MCP_WEBHOOK_UNVERIFIED" });
        }
        // Verified events are acknowledged only after persistence; duplicates
        // are deduplicated by the bound connect request state.
        return reply.status(200).send({ ok: true });
      },
    );
  });
}
