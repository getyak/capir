import {
  DesktopPersistentSessionEnrollRequestSchema, DesktopPersistentSessionProofSchema,
  DesktopPersistentSessionResponseSchema, DesktopPersistentSessionStatusSchema,
  DesktopPersistentSessionRevokeResponseSchema, ErrorResponseSchema,
  DesktopPersistentSessionRevokeRequestSchema,
  type DesktopPersistentSessionEnrollRequest, type DesktopPersistentSessionProof, type DesktopPersistentSessionRevokeRequest,
} from "@talent-signal/contracts";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import { enrollDesktopPersistentSession, renewDesktopPersistentSession,
  revokeDesktopPersistentSession, readDesktopPersistentSessionStatus } from "../modules/desktopPersistentSession.js";

export function registerDesktopPersistentSession(app: FastifyInstance, pool: Pool, config: BackendConfig,
  authenticate: preHandlerHookHandler, audience?: readonly string[]): void {
  const rate = { rateLimit: { max: 120, timeWindow: "1 minute" } };
  const rejectDestructiveProof = async (request: FastifyRequest) => {
    // AJV otherwise strips additional fields before the handler sees them.
    if (request.body && typeof request.body === "object" && Object.hasOwn(request.body, "original_access_token")) {
      throw new ApiError(400, "DESKTOP_SESSION_PROOF_INVALID", "Original access proof is accepted only for revocation.");
    }
  };
  app.post<{ Body: DesktopPersistentSessionEnrollRequest }>("/v1/desktop-persistent-session/enroll", {
    preHandler: [authenticate], preValidation: rejectDestructiveProof, config: rate,
    schema: { tags: ["auth"], body: DesktopPersistentSessionEnrollRequestSchema,
      response: { 200: DesktopPersistentSessionResponseSchema, "4xx": ErrorResponseSchema } },
  }, request => enrollDesktopPersistentSession(pool, config, request.auth!, request.body, audience));
  app.post<{ Body: DesktopPersistentSessionProof }>("/v1/desktop-persistent-session/renew", {
    config: rate, preValidation: rejectDestructiveProof, schema: { tags: ["auth"], body: DesktopPersistentSessionProofSchema,
      response: { 200: DesktopPersistentSessionResponseSchema, "4xx": ErrorResponseSchema } },
  }, request => renewDesktopPersistentSession(pool, config, request.body, audience));
  app.post<{ Body: DesktopPersistentSessionRevokeRequest }>("/v1/desktop-persistent-session/revoke", {
    config: rate, schema: { tags: ["auth"], body: DesktopPersistentSessionRevokeRequestSchema,
      response: { 200: DesktopPersistentSessionRevokeResponseSchema, "4xx": ErrorResponseSchema } },
  }, request => revokeDesktopPersistentSession(pool, config, request.body, audience));
  app.get("/v1/desktop-persistent-session/status", {
    preHandler: [authenticate],
    schema: { tags: ["auth"], response: { 200: DesktopPersistentSessionStatusSchema, "4xx": ErrorResponseSchema } },
  }, request => readDesktopPersistentSessionStatus(pool, request.auth!));
}
