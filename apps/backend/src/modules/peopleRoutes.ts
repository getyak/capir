import { Type } from "@sinclair/typebox";
import {
  ErrorResponseSchema,
  PEOPLE_DIRECTORY_QUERY_MAX_SCALARS,
  parsePeopleDirectoryQuery,
  PersonDetailResponseSchema,
  PersonDirectoryResponseSchema,
} from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";

import { ApiError } from "../lib/apiError.js";
import { getPerson, listPeople, searchPeople } from "./people.js";

const PeopleQuerySchema = Type.Object(
  {
    query: Type.Optional(Type.String({ maxLength: PEOPLE_DIRECTORY_QUERY_MAX_SCALARS })),
  },
  { additionalProperties: false },
);
const PeopleSearchSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: PEOPLE_DIRECTORY_QUERY_MAX_SCALARS }),
  },
  { additionalProperties: false },
);
const PersonParamsSchema = Type.Object(
  { personId: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
);

function assertQueryInput(value: unknown, allowMissing = false): void {
  const admitted = parsePeopleDirectoryQuery(value, { allowMissing });
  if (!admitted.ok) throw new ApiError(400, "PEOPLE_DIRECTORY_QUERY_INVALID",
    admitted.reason === "too_long" ? "Query exceeds the supported input limit."
      : "Invalid query. Use supported text without NUL or unpaired surrogates.");
}

export function registerPeopleRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
): void {
  const security = [{ bearerSession: [] }];

  app.get<{ Querystring: { query?: string } }>(
    "/v1/people",
    {
      // Check the original value before schema coercion can turn a wrong
      // provided type into a string. Existing validation -> auth order stays.
      preValidation: async request => { assertQueryInput(request.query.query, true); },
      preHandler: authenticate,
      schema: {
        tags: ["people"],
        security,
        querystring: PeopleQuerySchema,
        response: {
          200: PersonDirectoryResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) => listPeople(pool, request.auth, request.query.query),
  );

  app.get<{ Params: { personId: string } }>(
    "/v1/people/:personId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["people"],
        security,
        params: PersonParamsSchema,
        response: { 200: PersonDetailResponseSchema, "4xx": ErrorResponseSchema },
      },
    },
    async (request) => getPerson(pool, request.auth, request.params.personId),
  );

  app.post<{ Body: { query: string } }>(
    "/v1/people/search",
    {
      // Do not replace the body with normalized text before the existing
      // minLength check: whitespace-only search keeps its existing semantics.
      preValidation: async request => { assertQueryInput(request.body?.query); },
      preHandler: authenticate,
      schema: {
        tags: ["people"],
        security,
        body: PeopleSearchSchema,
        response: {
          200: PersonDirectoryResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      searchPeople(pool, request.auth, request.body.query),
  );
}
