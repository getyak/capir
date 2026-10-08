import {
  CapirAuthAuthorizeRequestSchema,
  CapirAuthAuthorizeResponseSchema,
  CapirAuthCapabilitiesResponseSchema,
  CapirAuthExchangeRequestSchema,
  CapirAuthExchangeResponseSchema,
  CapirAuthGrantListResponseSchema,
  CapirAuthGrantRevokeRequestSchema,
  CapirAuthGrantRevokeResponseSchema,
  CapirAuthLogoutRequestSchema,
  CapirAuthLogoutResponseSchema,
  CapirAuthRefreshRequestSchema,
  CapirAuthRefreshResponseSchema,
  CapirAuthV2StatusResponseSchema,
  ErrorResponseSchema,
} from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";

import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import { CapirAuthService } from "../modules/capirAuth.js";

/**
 * HTTP surface for browser-owned CLI authorization (`capir-auth.v2`).
 *
 * Anonymous discovery is protocol metadata and never a trust source. The
 * authorize route requires a real authenticated Web session (the browser
 * consent POST is dispatched by the Web layer after a session-bound CSRF
 * proof); the exchange route is bound by the single-use code and PKCE S256.
 * Scoped grant routes accept only dedicated grant credentials, never a
 * general workspace API bearer.
 */
export function registerCapirAuthRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: BackendConfig,
  authenticate: preHandlerHookHandler,
  deploymentWorkspaceIds?:readonly string[],
): CapirAuthService {
  const service = new CapirAuthService(pool, config, deploymentWorkspaceIds);
  const responseErrors = { "4xx": ErrorResponseSchema, "5xx": ErrorResponseSchema };
  const rate = { rateLimit: { max: 30, timeWindow: "1 minute" } };
  const strictRate = { rateLimit: { max: 10, timeWindow: "1 minute" } };

  const noStore = (reply: { header(name: string, value: string): unknown }): void => {
    reply.header("cache-control", "no-store");
    reply.header("referrer-policy", "no-referrer");
  };

  app.addHook('onRequest',async(request,reply)=>{
    if(request.url.startsWith('/v1/capir/auth/'))noStore(reply);
  });

  app.get(
    "/v1/capir/auth/capabilities",
    { config: rate, schema: { response: { 200: CapirAuthCapabilitiesResponseSchema } } },
    async (_request, reply) => {
      noStore(reply);
      return service.capabilities();
    },
  );

  app.get('/v1/capir/auth/context', {preHandler:[authenticate], config:rate}, async (request, reply) => {
    noStore(reply);
    return service.consentContext(request.auth);
  });

  app.post(
    "/v1/capir/auth/authorize",
    {
      preHandler: [authenticate],
      config: strictRate,
      schema: {
        body: CapirAuthAuthorizeRequestSchema,
        response: { 200: CapirAuthAuthorizeResponseSchema, ...responseErrors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      return service.authorize(request.auth, request.body as never);
    },
  );

  app.post(
    "/v1/capir/auth/exchange",
    {
      config: strictRate,
      schema: {
        body: CapirAuthExchangeRequestSchema,
        response: { 200: CapirAuthExchangeResponseSchema, ...responseErrors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      return service.exchange(request.body as never);
    },
  );

  app.post(
    "/v1/capir/auth/refresh",
    {
      config: strictRate,
      schema: {
        body: CapirAuthRefreshRequestSchema,
        response: { 200: CapirAuthRefreshResponseSchema, ...responseErrors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      return service.refresh(request.body as never);
    },
  );

  app.get(
    "/v1/capir/auth/status",
    {
      config: rate,
      schema: { response: { 200: CapirAuthV2StatusResponseSchema, ...responseErrors } },
    },
    async (request, reply) => {
      noStore(reply);
      return service.status(grantToken(request.headers.authorization));
    },
  );

  app.post(
    "/v1/capir/auth/logout",
    {
      config: rate,
      schema: {
        body: CapirAuthLogoutRequestSchema,
        response: { 200: CapirAuthLogoutResponseSchema, ...responseErrors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const body = request.body as { refresh_token?: string };
      return service.logout({
        accessToken: optionalGrantToken(request.headers.authorization),
        ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
      });
    },
  );

  // Web "account and security": the caller's own grants, current real account
  // only, no key material and no test-cookie fallback.
  app.get(
    "/v1/capir/auth/grants",
    {
      preHandler: [authenticate],
      config: rate,
      schema: { response: { 200: CapirAuthGrantListResponseSchema, ...responseErrors } },
    },
    async (request, reply) => {
      noStore(reply);
      return service.listGrants(request.auth);
    },
  );

  app.post(
    "/v1/capir/auth/grants/revoke",
    {
      preHandler: [authenticate],
      config: rate,
      schema: {
        body: CapirAuthGrantRevokeRequestSchema,
        response: { 200: CapirAuthGrantRevokeResponseSchema, ...responseErrors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const body = request.body as { grant_id: string };
      return service.revokeGrant(request.auth, body.grant_id);
    },
  );

  return service;
}

function optionalGrantToken(authorization: string | undefined): string | undefined {
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
}

function grantToken(authorization: string | undefined): string {
  const token = optionalGrantToken(authorization);
  if (!token) {
    throw new ApiError(401, "CAPIR_AUTH_REQUIRED", "A scoped capir CLI credential is required.");
  }
  return token;
}
