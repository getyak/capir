import { Type } from "@sinclair/typebox";
import {
  ErrorResponseSchema,
  PersonDetailResponseSchema,
  PersonDirectoryResponseSchema,
} from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";

import { getPerson, listPeople, searchPeople } from "./people.js";

const PeopleQuerySchema = Type.Object(
  {
    query: Type.Optional(Type.String({ maxLength: 160 })),
  },
  { additionalProperties: false },
);
const PeopleSearchSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);
const PersonParamsSchema = Type.Object(
  { personId: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
);

export function registerPeopleRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
): void {
  const security = [{ bearerSession: [] }];

  app.get<{ Querystring: { query?: string } }>(
    "/v1/people",
    {
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
