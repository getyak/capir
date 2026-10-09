import { Type, FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ErrorResponseSchema,
  TimeActivityKindSchema,
  TimeActivityListResponseSchema,
  TimeReviewRequestSchema,
  TimeReviewResponseSchema,
  TimeScheduleDeleteRequestSchema,
  TimeScheduleMutationRequestSchema,
  TimeScheduleResponseSchema,
  type TimeActivityKind,
  type TimeReviewRequest,
  type TimeScheduleDeleteRequest,
  type TimeScheduleMutationRequest,
} from "@talent-signal/contracts";
import type { FastifyInstance, FastifySchema, FastifySchemaCompiler, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";

import { registerRecurringJob } from "../lib/recurringJob.js";
import { ApiError } from "../lib/apiError.js";
import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";
import { listTimeActivities } from "./timeActivities.js";
import { reviewTimeRange } from "./timeReview.js";
import {
  deleteTimeSchedule,
  getTimeSchedule,
  putTimeSchedule,
} from "./timeSchedules.js";
import { assertQueryTimeScope, isValidCalendarDay } from "./timeWorkspaceShared.js";

interface TimeActivitiesQuery {
  from: string;
  to: string;
  time_zone: string;
  person_id?: string;
  kind?: TimeActivityKind;
  after?: string;
}

const DAY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

const TimeActivitiesQuerySchema = Type.Object(
  {
    from: Type.String({ pattern: DAY_PATTERN }),
    to: Type.String({ pattern: DAY_PATTERN }),
    time_zone: Type.String({ minLength: 1, maxLength: 100 }),
    person_id: Type.Optional(Type.String({ format: "uuid" })),
    kind: Type.Optional(TimeActivityKindSchema),
    after: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 2048,
        pattern: "^[A-Za-z0-9_-]+$",
      }),
    ),
  },
  { additionalProperties: false },
);

const ScheduleParamsSchema = Type.Object(
  { id: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
);

// Keep explicit nulls intact: Ajv's default coercion changes the reminder
// union's null branch into 0 (a start-time alarm) before reaching that branch.
// Match the non-mutating validator used by conversation queue mutations.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
if (!FormatRegistry.Has("uuid")) FormatRegistry.Set("uuid", (value) => UUID.test(value));
if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set("date-time", (value) =>
    DATE_TIME.test(value) && Number.isFinite(Date.parse(value)),
  );
}

function isScheduleDateTime(value: string): boolean {
  return DATE_TIME.test(value) && isValidCalendarDay(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function scheduleValidatorCompiler(app: FastifyInstance): FastifySchemaCompiler<FastifySchema> {
  return (routeSchema) => {
    if (routeSchema.httpPart === "body") {
      return (data) => Value.Check(TimeScheduleMutationRequestSchema, data)
        && isScheduleDateTime(data.starts_at) && isScheduleDateTime(data.ends_at)
        ? { value: data }
        : { error: new ApiError(400, "REQUEST_VALIDATION_FAILED", "The schedule does not match its bounded contract.") };
    }
    const fallback = app.validatorCompiler;
    if (!fallback) throw new Error("TIME_SCHEDULE_VALIDATOR_UNAVAILABLE");
    return fallback(routeSchema);
  };
}

export function registerTimeWorkspaceRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
  remoteChatProvider: RemoteChatAnswerProviding | null | undefined,
): void {
  const common = {
    preHandler: authenticate,
    schema: { security: [{ bearerSession: [] }], tags: ["time"] },
  };
  const reviewRateLimit = app.rateLimit({
    keyGenerator: (request) =>
      `${request.auth.accountId}:${request.auth.userId}`,
    max: 6,
    timeWindow: "1 minute",
  });

  app.get<{ Querystring: TimeActivitiesQuery }>(
    "/v1/time/activities",
    {
      ...common,
      schema: {
        ...common.schema,
        querystring: TimeActivitiesQuerySchema,
        response: {
          200: TimeActivityListResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const scope = assertQueryTimeScope(request.query);
      return listTimeActivities(pool, request.auth, scope, request.query.after);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/time/schedules/:id",
    {
      ...common,
      schema: {
        ...common.schema,
        params: ScheduleParamsSchema,
        response: {
          200: TimeScheduleResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return getTimeSchedule(pool, request.auth, request.params.id);
    },
  );

  app.put<{ Params: { id: string }; Body: TimeScheduleMutationRequest }>(
    "/v1/time/schedules/:id",
    {
      ...common,
      validatorCompiler: scheduleValidatorCompiler(app),
      schema: {
        ...common.schema,
        params: ScheduleParamsSchema,
        body: TimeScheduleMutationRequestSchema,
        response: {
          200: TimeScheduleResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return putTimeSchedule(pool, request.auth, request.params.id, request.body);
    },
  );

  app.delete<{ Params: { id: string }; Body: TimeScheduleDeleteRequest }>(
    "/v1/time/schedules/:id",
    {
      ...common,
      schema: {
        ...common.schema,
        params: ScheduleParamsSchema,
        body: TimeScheduleDeleteRequestSchema,
        response: {
          200: TimeScheduleResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return deleteTimeSchedule(
        pool,
        request.auth,
        request.params.id,
        request.body,
      );
    },
  );

  app.post<{ Body: TimeReviewRequest }>(
    "/v1/time/review",
    {
      ...common,
      preHandler: [authenticate, reviewRateLimit],
      schema: {
        ...common.schema,
        body: TimeReviewRequestSchema,
        response: {
          200: TimeReviewResponseSchema,
          "4xx": ErrorResponseSchema,
          "5xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return reviewTimeRange(
        pool,
        request.auth,
        request.body,
        remoteChatProvider,
      );
    },
  );

  registerRecurringJob(app, {
    name: "time-activity-snapshot-cleanup",
    intervalMs: 60_000,
    run: async () => {
      try {
        await pool.query(
          `DELETE FROM time_activity_snapshots
           WHERE expires_at<=statement_timestamp()`,
        );
      } catch (error) {
        app.log.warn(
          { error: error instanceof Error ? error.name : "unknown" },
          "time activity snapshot cleanup skipped",
        );
      }
    },
  });
}
