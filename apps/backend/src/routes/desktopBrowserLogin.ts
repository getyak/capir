import {
  DesktopBrowserLoginApproveRequestSchema,
  DesktopBrowserLoginApproveResponseSchema,
  DesktopBrowserLoginCancelRequestSchema,
  DesktopBrowserLoginCancelResponseSchema,
  DesktopBrowserLoginConsumeRequestSchema,
  DesktopBrowserLoginDeclineRequestSchema,
  DesktopBrowserLoginGrantResultRequestSchema,
  DesktopBrowserLoginGrantResultResponseSchema,
  DesktopBrowserLoginGrantViewSchema,
  DesktopBrowserLoginPrepareRequestSchema,
  DesktopBrowserLoginPrepareResponseSchema,
  DesktopBrowserLoginStatusResponseSchema,
  ErrorResponseSchema,
  SessionResponseSchema,
  type DesktopBrowserLoginApproveRequest,
  type DesktopBrowserLoginCancelRequest,
  type DesktopBrowserLoginConsumeRequest,
  type DesktopBrowserLoginDeclineRequest,
  type DesktopBrowserLoginGrantResultRequest,
  type DesktopBrowserLoginPrepareRequest,
} from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { Type } from "@sinclair/typebox";
import type { Pool } from "pg";

import type { BackendConfig } from "../config.js";
import {
  approveDesktopBrowserLogin,
  cancelDesktopBrowserLogin,
  consumeDesktopBrowserLogin,
  declineDesktopBrowserLogin,
  prepareDesktopBrowserLogin,
  postgresDesktopBrowserLoginDb,
  readDesktopBrowserLoginGrant,
  readDesktopBrowserLoginGrantResult,
  readDesktopBrowserLoginStatus,
} from "../modules/desktopBrowserLogin.js";

const AttemptParams = Type.Object({
  attemptId: Type.String({ format: "uuid" }),
});

/**
 * Browser-owned macOS primary login routes (ADR 0022). Preparation,
 * consumption, cancellation and secret-bound result reads are anonymous but
 * proof-bound and rate limited; approval and status require the normal bearer
 * session. No route logs or echoes a secret.
 */
export function registerDesktopBrowserLogin(
  app: FastifyInstance,
  pool: Pool,
  config: BackendConfig,
  authenticate: preHandlerHookHandler,
): void {
  const db = postgresDesktopBrowserLoginDb(pool);

  app.post<{ Body: DesktopBrowserLoginPrepareRequest }>("/v1/desktop-browser-login/prepare", {
    config: {
      rateLimit: {
        // The backend sees the first-party BFF's IP: this is an aggregate
        // service budget, not a per-person limit. Do not trust forwarded IPs.
        max: 120,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["auth"],
      body: DesktopBrowserLoginPrepareRequestSchema,
      response: {
        200: DesktopBrowserLoginPrepareResponseSchema,
        "4xx": ErrorResponseSchema,
      },
    },
  }, async (request) => prepareDesktopBrowserLogin(db, config, request.body));

  app.post<{ Body: DesktopBrowserLoginConsumeRequest }>("/v1/desktop-browser-login/consume", {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["auth"],
      body: DesktopBrowserLoginConsumeRequestSchema,
      response: {
        200: SessionResponseSchema,
        "4xx": ErrorResponseSchema,
      },
    },
  }, async (request) => consumeDesktopBrowserLogin(db, config, request.body));

  app.post<{ Params: { attemptId: string }; Body: DesktopBrowserLoginApproveRequest }>("/v1/desktop-browser-login/:attemptId/approve", {
    preHandler: [authenticate],
    config: {
      rateLimit: {
        max: 240,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["auth"],
      params: AttemptParams,
      body: DesktopBrowserLoginApproveRequestSchema,
      response: {
        200: DesktopBrowserLoginApproveResponseSchema,
        "4xx": ErrorResponseSchema,
      },
    },
  }, async (request) =>
    approveDesktopBrowserLogin(
      db,
      config,
      request.params.attemptId,
      request.auth,
      request.body,
    ));

  app.post<{ Params: { attemptId: string }; Body: DesktopBrowserLoginCancelRequest }>("/v1/desktop-browser-login/:attemptId/cancel", {
    config: {
      rateLimit: {
        max: 240,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["auth"],
      params: AttemptParams,
      body: DesktopBrowserLoginCancelRequestSchema,
      response: {
        200: DesktopBrowserLoginCancelResponseSchema,
        "4xx": ErrorResponseSchema,
      },
    },
  }, async (request) =>
    cancelDesktopBrowserLogin(db, request.params.attemptId, request.body));

  app.post<{ Params: { attemptId: string }; Body: DesktopBrowserLoginDeclineRequest }>("/v1/desktop-browser-login/:attemptId/decline", {
    preHandler: [authenticate],
    config: {
      rateLimit: {
        max: 240,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["auth"],
      params: AttemptParams,
      body: DesktopBrowserLoginDeclineRequestSchema,
      response: {
        200: DesktopBrowserLoginCancelResponseSchema,
        "4xx": ErrorResponseSchema,
      },
    },
  }, async (request) =>
    declineDesktopBrowserLogin(
      db,
      config,
      request.params.attemptId,
      request.auth,
      request.body,
    ));

  app.post<{ Params: { attemptId: string }; Body: DesktopBrowserLoginGrantResultRequest }>("/v1/desktop-browser-login/:attemptId/grant-result", {
    config: {
      rateLimit: {
        max: 240,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["auth"],
      params: AttemptParams,
      body: DesktopBrowserLoginGrantResultRequestSchema,
      response: {
        200: DesktopBrowserLoginGrantResultResponseSchema,
        "4xx": ErrorResponseSchema,
      },
    },
  }, async (request) =>
    readDesktopBrowserLoginGrantResult(db, request.params.attemptId, request.body));

  app.get<{ Params: { attemptId: string }; Querystring: { state: string; web_origin: string } }>("/v1/desktop-browser-login/:attemptId/grant", {
    preHandler: [authenticate],
    schema: {
      tags: ["auth"],
      security: [{ bearerSession: [] }],
      params: AttemptParams,
      querystring: Type.Object({
        state: Type.String({ minLength: 32, maxLength: 256 }),
        web_origin: Type.String({ minLength: 1, maxLength: 200 }),
      }),
      response: {
        200: DesktopBrowserLoginGrantViewSchema,
        "4xx": ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    return readDesktopBrowserLoginGrant(
      db,
      config,
      request.params.attemptId,
      request.auth,
      request.query,
    );
  });

  app.get<{ Params: { attemptId: string } }>("/v1/desktop-browser-login/:attemptId/status", {
    preHandler: [authenticate],
    schema: {
      tags: ["auth"],
      security: [{ bearerSession: [] }],
      params: AttemptParams,
      response: {
        200: DesktopBrowserLoginStatusResponseSchema,
        "4xx": ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    return readDesktopBrowserLoginStatus(db, request.params.attemptId, request.auth);
  });
}
