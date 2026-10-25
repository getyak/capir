import {
  PersistentSessionEnrollRequestSchema, PersistentSessionProofSchema,
  PersistentSessionResponseSchema, PersistentSessionRevokeRequestSchema, PersistentSessionRevokeResponseSchema,
  ErrorResponseSchema, type PersistentSessionEnrollRequest, type PersistentSessionProof, type PersistentSessionRevokeRequest,
} from "@talent-signal/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import { enrollPersistentSession, renewPersistentSession, revokePersistentSession } from "../modules/persistentSession.js";

export function registerPersistentSession(app: FastifyInstance, pool: Pool, config: BackendConfig,
  authenticate: preHandlerHookHandler, audience?: readonly string[]): void {
  const rate = { rateLimit: { max: 120, timeWindow: "1 minute" } };
  const noStore = async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header("cache-control", "private, no-store");
  };
  const rejectDestructiveProof = async (request: FastifyRequest) => {
    // Fastify's shared AJV policy strips additional properties. Reject this
    // revoke-only proof before that transformation so no access-bearing
    // endpoint can silently accept it as part of a renewal request.
    if (request.body && typeof request.body === "object"
      && Object.hasOwn(request.body, "original_access_token")) {
      throw new ApiError(400, "PERSISTENT_SESSION_PROOF_INVALID",
        "Original access proof is accepted only for login revocation.");
    }
  };
  const enrollAuthentication: preHandlerHookHandler = async function(request, reply) {
    try {
      // The app supplies createAuthGuard, which is an async hook. Fastify's
      // exported preHandlerHookHandler type describes its callback overload.
      const asyncGuard = authenticate as unknown as (this: FastifyInstance,
        request: FastifyRequest, reply: FastifyReply) => Promise<void>;
      await asyncGuard.call(this, request, reply);
    } catch (error) {
      // Only the owning guard's exact canonical denial is terminal. Unknown
      // proxy/audience/configuration errors retain their independent meaning.
      if (error instanceof ApiError && error.statusCode === 401 && error.code === "SESSION_INVALID") {
        throw new ApiError(401, "PERSISTENT_SESSION_REVOKED", "This login is no longer authorized. Sign in again.");
      }
      throw error;
    }
  };
  app.post<{ Body: PersistentSessionEnrollRequest }>("/v1/auth/persistent/enroll", {
    preHandler: [enrollAuthentication], preValidation: rejectDestructiveProof, onRequest: noStore, config: rate,
    schema: { tags: ["auth"], body: PersistentSessionEnrollRequestSchema,
      response: { 200: PersistentSessionResponseSchema, "4xx": ErrorResponseSchema } },
  }, request => enrollPersistentSession(pool, config, request.auth!, request.body, audience));
  app.post<{ Body: PersistentSessionProof }>("/v1/auth/persistent/renew", {
    config: rate, preValidation: rejectDestructiveProof, onRequest: noStore, schema: { tags: ["auth"], body: PersistentSessionProofSchema,
      response: { 200: PersistentSessionResponseSchema, "4xx": ErrorResponseSchema } },
  }, request => renewPersistentSession(pool, config, request.body, audience));
  app.post<{ Body: PersistentSessionRevokeRequest }>("/v1/auth/persistent/revoke", {
    config: rate, onRequest: noStore, schema: { tags: ["auth"], body: PersistentSessionRevokeRequestSchema,
      response: { 200: PersistentSessionRevokeResponseSchema, "4xx": ErrorResponseSchema } },
  }, request => revokePersistentSession(pool, config, request.body, audience));
}
