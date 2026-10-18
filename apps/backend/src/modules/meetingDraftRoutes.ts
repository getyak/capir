import { Type } from "@sinclair/typebox";
import {
  CONTRACT_VERSION,
  ErrorResponseSchema,
  MeetingDraftDismissRequestSchema,
  MeetingDraftListResponseSchema,
  MeetingDraftListScopeSchema,
  MeetingDraftResponseSchema,
  MeetingDraftUpdateRequestSchema,
  type MeetingDraftDismissRequest,
  type MeetingDraftListScope,
  type MeetingDraftUpdateRequest,
} from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import {
  dismissMeetingDraft,
  getMeetingDraft,
  listMeetingDrafts,
  updateMeetingDraft,
} from "./meetingDrafts.js";
import { registerRecurringJob } from "../lib/recurringJob.js";

export async function sweepMeetingDraftRetention(
  app: Pick<FastifyInstance, "log">,
  pool: Pick<Pool, "query">,
): Promise<void> {
  try {
    // Snapshot rows are ephemeral pagination infrastructure, including inside
    // an active Lab workspace. Their cleanup must never prevent the higher
    // priority per-account sensitive-content redaction below.
    await pool.query(
      "DELETE FROM meeting_draft_list_snapshots WHERE expires_at<=statement_timestamp()",
    );
  } catch (error) {
    app.log.warn(
      { err: error },
      "meeting draft list snapshot cleanup skipped",
    );
  }
  const accounts = await pool.query<{ account_id: string }>(
    `SELECT DISTINCT d.account_id FROM meeting_drafts d
     WHERE d.status NOT IN ('redacted','expired')
       AND NOT EXISTS(SELECT 1 FROM lab_test_workspaces w
         WHERE w.target_account_id=d.account_id)`,
  );
  for (const account of accounts.rows) {
    try {
      await pool.query("SELECT redact_unavailable_meeting_drafts($1)", [
        account.account_id,
      ]);
    } catch (error) {
      app.log.warn(
        { err: error },
        "meeting draft retention sweep skipped one account",
      );
    }
  }
}

export function registerMeetingDraftRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
) {
  const common = {
    preHandler: authenticate,
    schema: { security: [{ bearerSession: [] }], tags: ["meeting-drafts"] },
  };
  const params = Type.Object(
    { id: Type.String({ format: "uuid" }) },
    { additionalProperties: false },
  );
  const authenticatedListRateLimit = app.rateLimit({
    keyGenerator: (request) =>
      `${request.auth.accountId}:${request.auth.userId}`,
    max: 30,
    timeWindow: "1 minute",
  });
  app.get<{ Querystring: { after?: string; limit?: string; scope?: MeetingDraftListScope } }>(
    "/v1/meeting-drafts",
    {
      ...common,
      // Authentication runs first so loopback Web-server traffic is isolated
      // by canonical account/user identity rather than one shared IP bucket.
      // The list implementation separately caps each materialized snapshot at
      // 5,000 identities as the resource-volume backstop.
      preHandler: [authenticate, authenticatedListRateLimit],
      schema: {
        ...common.schema,
        querystring: Type.Object(
          {
            after: Type.Optional(
              Type.String({
                minLength: 1,
                maxLength: 1024,
                pattern: "^[A-Za-z0-9_-]+$",
              }),
            ),
            limit: Type.Optional(
              Type.String({ pattern: "^(?:[1-9]|[1-4][0-9]|50)$" }),
            ),
            scope: Type.Optional(MeetingDraftListScopeSchema),
          },
          { additionalProperties: false },
        ),
        response: {
          200: MeetingDraftListResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return listMeetingDrafts(
        pool,
        request.auth,
        request.query.after,
        Number(request.query.limit ?? 50),
        request.query.scope ?? "all",
      );
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/meeting-drafts/:id",
    {
      ...common,
      schema: {
        ...common.schema,
        params,
        response: {
          200: MeetingDraftResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return {
        contract_version: CONTRACT_VERSION,
        draft: await getMeetingDraft(pool, request.auth, request.params.id),
      };
    },
  );
  app.put<{ Params: { id: string }; Body: MeetingDraftUpdateRequest }>(
    "/v1/meeting-drafts/:id",
    {
      ...common,
      schema: {
        ...common.schema,
        params,
        body: MeetingDraftUpdateRequestSchema,
        response: {
          200: MeetingDraftResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return {
        contract_version: CONTRACT_VERSION,
        draft: await updateMeetingDraft(
          pool,
          request.auth,
          request.params.id,
          request.body,
        ),
      };
    },
  );
  app.post<{
    Params: { id: string };
    Body: MeetingDraftDismissRequest;
  }>(
    "/v1/meeting-drafts/:id/dismiss",
    {
      ...common,
      schema: {
        ...common.schema,
        params,
        body: MeetingDraftDismissRequestSchema,
        response: {
          200: MeetingDraftResponseSchema,
          "4xx": ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return {
        contract_version: CONTRACT_VERSION,
        draft: await dismissMeetingDraft(
          pool,
          request.auth,
          request.params.id,
          request.body,
        ),
      };
    },
  );
  registerRecurringJob(app, {
    name: "meeting-draft-retention-sweep",
    intervalMs: 60_000,
    run: () => sweepMeetingDraftRetention(app, pool),
  });
}
