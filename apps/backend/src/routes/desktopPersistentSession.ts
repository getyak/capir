import {
  DesktopPersistentSessionEnrollRequestSchema, DesktopPersistentSessionProofSchema,
  DesktopPersistentSessionResponseSchema, DesktopPersistentSessionStatusSchema,
  DesktopPersistentSessionRevokeResponseSchema, ErrorResponseSchema,
  type DesktopPersistentSessionEnrollRequest, type DesktopPersistentSessionProof,
} from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import type { BackendConfig } from "../config.js";
import { enrollDesktopPersistentSession, renewDesktopPersistentSession,
  revokeDesktopPersistentSession, readDesktopPersistentSessionStatus } from "../modules/desktopPersistentSession.js";

export function registerDesktopPersistentSession(app: FastifyInstance, pool: Pool, config: BackendConfig,
  authenticate: preHandlerHookHandler, audience?: readonly string[]): void {
  const rate = { rateLimit: { max: 120, timeWindow: "1 minute" } };
  app.post<{ Body: DesktopPersistentSessionEnrollRequest }>("/v1/desktop-persistent-session/enroll", {
    preHandler: [authenticate], config: rate,
    schema: { tags: ["auth"], body: DesktopPersistentSessionEnrollRequestSchema,
      response: { 200: DesktopPersistentSessionResponseSchema, "4xx": ErrorResponseSchema } },
  }, request => enrollDesktopPersistentSession(pool, config, request.auth!, request.body, audience));
  app.post<{ Body: DesktopPersistentSessionProof }>("/v1/desktop-persistent-session/renew", {
    config: rate, schema: { tags: ["auth"], body: DesktopPersistentSessionProofSchema,
      response: { 200: DesktopPersistentSessionResponseSchema, "4xx": ErrorResponseSchema } },
  }, request => renewDesktopPersistentSession(pool, config, request.body, audience));
  app.post<{ Body: DesktopPersistentSessionProof }>("/v1/desktop-persistent-session/revoke", {
    config: rate, schema: { tags: ["auth"], body: DesktopPersistentSessionProofSchema,
      response: { 200: DesktopPersistentSessionRevokeResponseSchema, "4xx": ErrorResponseSchema } },
  }, request => revokeDesktopPersistentSession(pool, config, request.body, audience));
  app.get("/v1/desktop-persistent-session/status", {
    preHandler: [authenticate],
    schema: { tags: ["auth"], response: { 200: DesktopPersistentSessionStatusSchema, "4xx": ErrorResponseSchema } },
  }, request => readDesktopPersistentSessionStatus(pool, request.auth!));
}
