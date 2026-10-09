import { Type } from "@sinclair/typebox";
import {
  CAPIR_TEST_SCHEMA_VERSION,
  CapirTestCapabilitiesResponseSchema,
  CapirTestCreateRequestSchema,
  CapirTestHandoffExchangeRequestSchema,
  CapirTestHandoffExchangeResponseSchema,
  CapirTestHandoffRequestSchema,
  CapirTestHandoffResponseSchema,
  CapirTestRunResponseSchema,
  CapirTestStopRequestSchema,
  ErrorResponseSchema,
  type CapirTestCreateRequest,
  type CapirTestHandoffExchangeRequest,
  type CapirTestHandoffRequest,
  type CapirTestStopRequest,
} from "@talent-signal/contracts";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";

import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import type { ChatMediaStorage } from "./chatMediaStorage.js";
import { LabWorkspaceService } from "./labWorkspaces.js";
import { registerLabWorkspaceRoutes } from "./labWorkspaceRoutes.js";
import {
  CapirTestsService,
  capirTestWebConsumerAuthorized,
  ensureCapirTestProvisioningPrincipal,
  ensureUserTestProvisioner,
  resolveCapirTestProvisioningPrincipal,
  type CapirTestPrincipal,
} from "./capirTests.js";
import { registerCapirAuthRoutes } from "../routes/capirAuthRoutes.js";
import { CapirAuthService } from "./capirAuth.js";

/** Compose both workspace ownership forms through one shared lifecycle. */
export function registerCapirTestWorkspaceRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: BackendConfig,
  storage: ChatMediaStorage,
  authenticate: preHandlerHookHandler,
  deploymentWorkspaceIds?:readonly string[],
): void {
  const capirAuth=registerCapirAuthRoutes(app,pool,config,authenticate,deploymentWorkspaceIds);
  const workspaces = new LabWorkspaceService(pool, storage, config.sessionTtlSeconds);
  registerLabWorkspaceRoutes(app, workspaces, authenticate, config.internalLabEnabled === true);
  registerCapirTestRoutes(
    app,
    new CapirTestsService(pool, config, storage, workspaces),
    authenticate,
    capirAuth,
  );
}

/**
 * HTTP surface for operator-owned test provisioning (Task 1).
 *
 * Public capabilities are truthful about the disabled default and never
 * advertise unavailable legacy human-auth/sandbox scopes as working. All other
 * routes require the configured provisioning credential or the trusted Web
 * consumer key and are rate-limited, quota-bound and origin-scoped.
 */
export function registerCapirTestRoutes(
  app: FastifyInstance,
  service: CapirTestsService,
  authenticate: preHandlerHookHandler,
  capirAuth?: CapirAuthService,
): void {
  const principals = new WeakMap<FastifyRequest, CapirTestPrincipal>();
  const responseErrors = { "4xx": ErrorResponseSchema, "5xx": ErrorResponseSchema };
  const rate = { rateLimit: { max: 30, timeWindow: "1 minute" } };

  const gate: preHandlerHookHandler = async (_request, reply) => {
    reply.header("cache-control", "no-store");
    if (!service.enabled) {
      throw new ApiError(403, "CAPIR_TESTS_DISABLED", "Internal test-account provisioning is disabled on this service.");
    }
  };



  const webConsumer: preHandlerHookHandler = async (request) => {
    const settings = service.settings;
    const presented = request.headers["x-capir-web-consumer-key"];
    if (
      !capirTestWebConsumerAuthorized(
        settings?.webConsumerKey,
        typeof presented === "string" ? presented : undefined,
      )
    ) {
      throw new ApiError(401, "CAPIR_TEST_WEB_CONSUMER_REQUIRED", "The trusted Web consumer key is required.");
    }
  };

  const principal = (request: FastifyRequest): CapirTestPrincipal => {
    const found = principals.get(request);
    if (!found) {
      throw new ApiError(401, "CAPIR_TEST_PROVISIONING_REQUIRED", "A test-provisioning credential is required.");
    }
    return found;
  };

  /**
   * Explicit test-credential resolution: a dedicated operator credential when
   * the caller presents one, otherwise a scoped logged-in user grant whose
   * server-owned test entitlement is checked here and again in every locked
   * write. A present but denied user credential never falls back to the
   * operator namespace.
   */
  const admission = (scope: string): preHandlerHookHandler => async (request) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new ApiError(401, "CAPIR_TEST_PROVISIONING_REQUIRED", "A test-provisioning credential is required.");
    }
    const token = authorization.slice("Bearer ".length);
    const operator = await resolveCapirTestProvisioningPrincipal(service.pool, token);
    if (operator) {
      if (operator.state !== "enabled") {
        throw new ApiError(401, "CAPIR_TEST_PROVISIONING_REQUIRED", "A test-provisioning credential is required.");
      }
      const settings = service.settings;
      if (
        !settings?.webOrigin ||
        !settings.backendOrigin ||
        operator.webOrigin !== settings.webOrigin ||
        operator.backendOrigin !== settings.backendOrigin
      ) {
        throw new ApiError(
          403,
          "CAPIR_TEST_ORIGIN_DENIED",
          "This provisioning principal is scoped to an exact registered origin pair.",
        );
      }
      const backendOrigin = request.headers["x-capir-backend-origin"];
      if (backendOrigin !== operator.backendOrigin) {
        throw new ApiError(
          403,
          "CAPIR_TEST_ORIGIN_DENIED",
          "This provisioning principal is scoped to an exact registered origin pair.",
        );
      }
      principals.set(request, operator);
      return;
    }
    if (!capirAuth) {
      throw new ApiError(401, "CAPIR_TEST_PROVISIONING_REQUIRED", "A test-provisioning credential is required.");
    }
    const backendOrigin = request.headers["x-capir-backend-origin"];
    const webOrigin = request.headers["x-capir-web-origin"];
    const grant = await capirAuth.admitGrantToken(token, {
      backendOrigin: typeof backendOrigin === "string" ? backendOrigin : undefined,
      webOrigin: typeof webOrigin === "string" ? webOrigin : undefined,
    });
    const authority = await capirAuth.requireTestScope(grant, scope);
    principals.set(request, await ensureUserTestProvisioner(service.pool, service.config, authority, scope));
  };

  const params = Type.Object({ id: Type.String({ format: "uuid" }) }, { additionalProperties: false });
  const runResponse = { 200: CapirTestRunResponseSchema, ...responseErrors };

  app.get(
    "/v1/capir/capabilities",
    { config: rate, schema: { response: { 200: CapirTestCapabilitiesResponseSchema } } },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");
      return service.capabilities();
    },
  );

  // Canonical run readback for a live operator-owned test session: the shared
  // Lab authority (the ordinary session guard) already admitted this session.
  // No provisioning key or password is needed; ordinary real accounts and
  // revoked/expired Lab sessions are denied.
  app.get(
    "/v1/capir/test-session",
    {
      preHandler: [authenticate],
      config: rate,
      schema: { response: runResponse },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return {
        schema_version: CAPIR_TEST_SCHEMA_VERSION,
        run: await service.currentRun(request.auth),
      };
    },
  );

  app.post<{ Body: CapirTestCreateRequest }>(
    "/v1/capir/tests",
    {
      preHandler: [gate, admission("test.create")],
      config: rate,
      schema: {
        body: CapirTestCreateRequestSchema,
        response: runResponse,
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return {
        schema_version: CAPIR_TEST_SCHEMA_VERSION,
        run: await service.create(principal(request), request.body),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/capir/tests/:id",
    { preHandler: [gate, admission("test.status")], config: rate, schema: { params, response: runResponse } },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return {
        schema_version: CAPIR_TEST_SCHEMA_VERSION,
        run: await service.status(principal(request), request.params.id),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: CapirTestStopRequest }>(
    "/v1/capir/tests/:id/stop",
    {
      preHandler: [gate, admission("test.stop")],
      config: rate,
      schema: { params, body: CapirTestStopRequestSchema, response: runResponse },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return {
        schema_version: CAPIR_TEST_SCHEMA_VERSION,
        run: await service.stop(principal(request), request.params.id, request.body),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: CapirTestHandoffRequest }>(
    "/v1/capir/tests/:id/handoffs",
    {
      preHandler: [gate, admission("test.handoff")],
      config: rate,
      schema: {
        params,
        body: CapirTestHandoffRequestSchema,
        response: { 200: CapirTestHandoffResponseSchema, ...responseErrors },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return service.createHandoff(principal(request), request.params.id, request.body);
    },
  );

  app.post<{ Body: CapirTestHandoffExchangeRequest }>(
    "/v1/capir/tests/handoffs/exchange",
    {
      preHandler: [gate, webConsumer],
      config: rate,
      schema: {
        body: CapirTestHandoffExchangeRequestSchema,
        response: { 200: CapirTestHandoffExchangeResponseSchema, ...responseErrors },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return service.exchangeHandoff(request.body);
    },
  );

  // The explicitly configured provisioning principal is materialized on ready;
  // failures stay observable and leave provisioning fail-closed.
  app.addHook("onReady", async () => {
    if (!service.enabled) return;
    try {
      await ensureCapirTestProvisioningPrincipal(service.pool, service.settings);
    } catch (error) {
      app.log.error({ err: error }, "CAPIR_TEST_PROVISIONING_PRINCIPAL_PENDING");
    }
  });
}
