import { Type } from "@sinclair/typebox";
import type { ScreenshotContactTaskRequest } from "@talent-signal/agent";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import type { ChatMediaStorage } from "./chatMediaStorage.js";
import {
  cancelScreenshotContactTask,
  confirmScreenshotContactProfile,
  createScreenshotContactTask,
  deleteContactCaptureTask,
  deleteScreenshotPreprocessingSource,
  linkScreenshotContactTaskCapture,
  listScreenshotContactTasks,
  loadBrowserCaptureTask,
  loadScreenshotContactImage,
  loadScreenshotContactTask,
  lookupScreenshotContactReceipt,
  resumeScreenshotContactTask,
  type ScreenshotContactTaskRunner,
} from "./screenshotContactTasks.js";

/** Start HTTP background work only after a successful completed reply
 * whose canonical admitted product run is committed and bound to this task.
 * Failed, rejected or prematurely closed responses never dispatch provider
 * work: Fastify treats ERR_STREAM_PREMATURE_CLOSE as fulfillment, so
 * fulfillment alone is not proof of a delivered admitted response. Internal
 * non-HTTP runner callers keep their own deliberate contract. */
export function startScreenshotTaskAfterCommittedReply(options: {
  request: FastifyRequest; reply: FastifyReply; pool: Pool;
  runner: ScreenshotContactTaskRunner; auth: AuthContext; taskID: string;
  image?: ScreenshotContactTaskRequest["image"];
}): void {
  const { request, reply, pool, runner, auth, taskID } = options;
  let finished = false;
  // Registered before reply.then so a real finish is observed before Fastify's
  // end-of-stream callback runs.
  reply.raw.on("finish", () => { finished = true; });
  const start = () => {
    if (!finished) {
      request.log.warn({ task_id: taskID }, "Contact task response did not complete; background work not started");
      return;
    }
    if (reply.statusCode !== 200 && reply.statusCode !== 201) {
      request.log.warn({ task_id: taskID, status_code: reply.statusCode },
        "Contact task response was not an admitted success; background work not started");
      return;
    }
    void (async () => {
      const bound = await pool.query<{ id: string }>(`SELECT id FROM product_runs
        WHERE account_id=$1 AND user_id=$2 AND task_id=$3::uuid AND task_kind='screenshot' AND status<>'failed'`,
      [auth.accountId, auth.userId, taskID]).catch(() => null);
      if (!bound?.rowCount) {
        request.log.error({ task_id: taskID }, "Contact task has no committed canonical run; background work not started");
        return;
      }
      void runner.start(auth, taskID, options.image).catch(() => request.log.error({ task_id: taskID }, "Contact task could not start"));
    })();
  };
  void reply.then(start, error => {
    request.log.error({ err: error, task_id: taskID }, "Contact task response failed; background work not started");
  });
}

export function registerScreenshotContactRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
  chatMediaStorage: ChatMediaStorage,
  screenshotRunner: ScreenshotContactTaskRunner | null,
) {
  const security = [{ bearerSession: [] }];
  const idParams = Type.Object({ id: Type.String({ format: "uuid" }) });
  const revisionBody = Type.Object(
    { expected_revision: Type.Integer({ minimum: 1 }) },
    { additionalProperties: false },
  );

  app.post<{ Body: unknown }>("/v1/contact-agent/tasks", {
    preHandler: authenticate,
    bodyLimit: 40_100_000,
    schema: { tags: ["contact-agent"], security },
  }, async (request, reply) => {
    if (!screenshotRunner) {
      throw new ApiError(503, "CONTACT_AGENT_UNAVAILABLE", "Screenshot contact Agent is not configured.");
    }
    const result = await createScreenshotContactTask(
      pool,
      request.auth,
      request.body,
      chatMediaStorage,
      { preprocessingRequired: true },
    );
    startScreenshotTaskAfterCommittedReply({
      request, reply, pool, runner: screenshotRunner, auth: request.auth, taskID: result.body.task_id,
    });
    return reply.header("idempotent-replayed", result.replayed)
      .status(result.replayed ? 200 : 201).send(result.body);
  });

  app.get<{ Params: { id: string; index: number } }>("/v1/contact-agent/tasks/:id/images/:index", {
    preHandler: authenticate,
    schema: {
      security,
      params: Type.Object({ id: Type.String({ format: "uuid" }), index: Type.Integer({ minimum: 0, maximum: 9 }) }),
    },
  }, async (request, reply) => {
    const image = await loadScreenshotContactImage(
      pool,
      request.auth,
      request.params.id,
      request.params.index,
      chatMediaStorage,
    );
    return reply.header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .type(image.media_type).send(Buffer.from(image.data_base64, "base64"));
  });

  app.post<{ Params: { id: string }; Body: { expected_revision: number } }>(
    "/v1/contact-agent/tasks/:id/delete",
    { preHandler: authenticate, schema: { security, params: idParams, body: revisionBody } },
    async request => deleteContactCaptureTask(
      pool,
      request.auth,
      request.params.id,
      request.body.expected_revision,
      chatMediaStorage,
      () => screenshotRunner?.fenceSourceDeletion(request.auth, request.params.id),
    ),
  );
  app.post<{ Params: { id: string }; Body: { expected_revision: number } }>(
    "/v1/contact-agent/tasks/:id/preprocessing-source/delete",
    { preHandler: authenticate, schema: { security, params: idParams, body: revisionBody } },
    async request => deleteScreenshotPreprocessingSource(
      pool,
      request.auth,
      request.params.id,
      request.body.expected_revision,
      chatMediaStorage,
      () => screenshotRunner?.fenceSourceDeletion(request.auth, request.params.id),
    ),
  );
  app.post<{
    Params: { id: string };
    Body: { expected_revision: number; capture_id: string; source_resource_id: string };
  }>("/v1/contact-agent/tasks/:id/capture-link", {
    preHandler: authenticate,
    schema: {
      security,
      params: idParams,
      body: Type.Object({
        expected_revision: Type.Integer({ minimum: 1 }),
        capture_id: Type.String({ format: "uuid" }),
        source_resource_id: Type.String({ format: "uuid" }),
      }, { additionalProperties: false }),
    },
  }, async request => linkScreenshotContactTaskCapture(
    pool,
    request.auth,
    request.params.id,
    request.body,
  ));

  app.get<{ Params: { requestId: string } }>("/v1/contact-agent/browser-captures/:requestId", {
    preHandler: authenticate,
    schema: {
      security,
      params: Type.Object({ requestId: Type.String({ pattern: "^[a-zA-Z0-9-]{8,80}$" }) }),
    },
  }, async request => loadBrowserCaptureTask(pool, request.auth, request.params.requestId));
  app.get<{ Querystring: { handoff_request_id?: string } }>("/v1/contact-agent/tasks", {
    preHandler: authenticate,
    schema: {
      security,
      querystring: Type.Object({
        handoff_request_id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      }, { additionalProperties: false }),
    },
  }, async request => request.query.handoff_request_id
    ? lookupScreenshotContactReceipt(pool, request.auth, request.query.handoff_request_id)
    : listScreenshotContactTasks(pool, request.auth));
  app.get<{ Params: { id: string } }>("/v1/contact-agent/tasks/:id", {
    preHandler: authenticate,
    schema: { security, params: idParams },
  }, async (request, reply) => {
    const result = await loadScreenshotContactTask(pool, request.auth, request.params.id);
    if (result.status === "running" && screenshotRunner) {
      startScreenshotTaskAfterCommittedReply({
        request, reply, pool, runner: screenshotRunner, auth: request.auth, taskID: result.task_id,
      });
    }
    return reply.send(result);
  });

  app.post<{
    Params: { id: string };
    Body: {
      expected_revision: number;
      selected_person_id?: string;
      selected_relationship_context_id?: string;
      new_contact_name?: string;
      image?: ScreenshotContactTaskRequest["image"];
    };
  }>("/v1/contact-agent/tasks/:id/resume", {
    preHandler: authenticate,
    bodyLimit: 14_000_000,
    schema: {
      security,
      params: idParams,
      body: Type.Object({
        expected_revision: Type.Integer({ minimum: 1 }),
        selected_person_id: Type.Optional(Type.String({ format: "uuid" })),
        selected_relationship_context_id: Type.Optional(Type.String({ format: "uuid" })),
        new_contact_name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        image: Type.Optional(Type.Object({
          media_type: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg"), Type.Literal("image/webp")]),
          byte_size: Type.Integer({ minimum: 1, maximum: 10_000_000 }),
          content_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
          data_base64: Type.String({ maxLength: 13_400_000 }),
        }, { additionalProperties: false })),
      }, { additionalProperties: false }),
    },
  }, async (request, reply) => {
    if (!screenshotRunner) {
      throw new ApiError(503, "CONTACT_AGENT_UNAVAILABLE", "Screenshot contact Agent is not configured.");
    }
    const result = await resumeScreenshotContactTask(pool, request.auth, request.params.id, request.body);
    startScreenshotTaskAfterCommittedReply({
      request, reply, pool, runner: screenshotRunner, auth: request.auth,
      taskID: result.task_id, ...(request.body.image ? { image: request.body.image } : {}),
    });
    return reply.send(result);
  });
  app.post<{ Params: { id: string }; Body: unknown }>("/v1/contact-agent/tasks/:id/profile-confirmation", {
    preHandler: authenticate,
    bodyLimit: 16_000,
    schema: { security, params: idParams },
  }, async request => confirmScreenshotContactProfile(pool, request.auth, request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: { expected_revision: number } }>(
    "/v1/contact-agent/tasks/:id/cancel",
    { preHandler: authenticate, schema: { security, params: idParams, body: revisionBody } },
    async request => cancelScreenshotContactTask(
      pool,
      request.auth,
      request.params.id,
      request.body.expected_revision,
      () => screenshotRunner?.fenceTaskCancellation(request.auth, request.params.id),
    ),
  );
}
