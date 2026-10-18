import { FormatRegistry, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ErrorResponseSchema,
  PersonSourceSyncDeleteRequestSchema,
  PersonSourceSyncListQuerySchema,
  PersonSourceSyncListResponseSchema,
  PersonSourceSyncMutationRequestSchema,
  PersonSourceSyncResponseSchema,
  PersonSourceSyncRunsResponseSchema,
  type PersonSourceSyncDeleteRequest,
  type PersonSourceSyncListQuery,
  type PersonSourceSyncMutationRequest,
} from "@talent-signal/contracts";
import type {
  FastifyInstance,
  FastifySchema,
  FastifySchemaCompiler,
  preHandlerHookHandler,
} from "fastify";
import type { Pool } from "pg";

import { ApiError } from "../lib/apiError.js";
import {
  deletePersonSourceSync,
  getPersonSourceSync,
  listPersonSourceSyncRuns,
  listPersonSourceSyncs,
  putPersonSourceSync,
} from "./personSourceSync.js";

const PersonSourceSyncParamsSchema = Type.Object(
  { id: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
);

// Keep explicit values intact: Ajv's default coercion rewrites the fixed
// interval literal and nullable-safe unions before they reach validation.
// Match the non-mutating validator used by time workspace mutations.
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
if (!FormatRegistry.Has("uuid")) {
  FormatRegistry.Set("uuid", (value) => UUID.test(value));
}
if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set("date-time", (value) =>
    DATE_TIME.test(value) && Number.isFinite(Date.parse(value)),
  );
}

function bodyValidatorCompiler(
  app: FastifyInstance,
  schema: { [key: string]: unknown },
): FastifySchemaCompiler<FastifySchema> {
  return (routeSchema) => {
    if (routeSchema.httpPart === "body") {
      return (data) =>
        Value.Check(schema as never, data)
          ? { value: data }
          : {
              error: new ApiError(
                400,
                "REQUEST_VALIDATION_FAILED",
                "The periodic observation does not match its bounded contract.",
              ),
            };
    }
    const fallback = app.validatorCompiler;
    if (!fallback) {
      throw new Error("PERSON_SOURCE_SYNC_VALIDATOR_UNAVAILABLE");
    }
    return fallback(routeSchema);
  };
}

export function registerPersonSourceSyncRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
): void {
  const common = {
    preHandler: authenticate,
    schema: { security: [{ bearerSession: [] }], tags: ["time"] },
  };

  // Bounded owner-scoped lookup by exact person/context (+ optional seed);
  // an all-account or cross-owner list is never served.
  app.get<{ Querystring: PersonSourceSyncListQuery }>(
    "/v1/time/person-source-syncs",
    {
      ...common,
      schema: {
        ...common.schema,
        querystring: PersonSourceSyncListQuerySchema,
        response: {
          200: PersonSourceSyncListResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return listPersonSourceSyncs(pool, request.auth, request.query);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/time/person-source-syncs/:id",
    {
      ...common,
      schema: {
        ...common.schema,
        params: PersonSourceSyncParamsSchema,
        response: {
          200: PersonSourceSyncResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return getPersonSourceSync(pool, request.auth, request.params.id);
    },
  );

  app.put<{ Params: { id: string }; Body: PersonSourceSyncMutationRequest }>(
    "/v1/time/person-source-syncs/:id",
    {
      ...common,
      validatorCompiler: bodyValidatorCompiler(
        app,
        PersonSourceSyncMutationRequestSchema,
      ),
      schema: {
        ...common.schema,
        params: PersonSourceSyncParamsSchema,
        body: PersonSourceSyncMutationRequestSchema,
        response: {
          200: PersonSourceSyncResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return putPersonSourceSync(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
    },
  );

  app.delete<{ Params: { id: string }; Body: PersonSourceSyncDeleteRequest }>(
    "/v1/time/person-source-syncs/:id",
    {
      ...common,
      validatorCompiler: bodyValidatorCompiler(
        app,
        PersonSourceSyncDeleteRequestSchema,
      ),
      schema: {
        ...common.schema,
        params: PersonSourceSyncParamsSchema,
        body: PersonSourceSyncDeleteRequestSchema,
        response: {
          200: PersonSourceSyncResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return deletePersonSourceSync(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/time/person-source-syncs/:id/runs",
    {
      ...common,
      schema: {
        ...common.schema,
        params: PersonSourceSyncParamsSchema,
        response: {
          200: PersonSourceSyncRunsResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return listPersonSourceSyncRuns(pool, request.auth, request.params.id);
    },
  );
}
