import { saveProductRunCase } from "./productRunCases.js";
import { saveProductRunOutput, productRunSink, metadataOnlyProductSpan, cleanupProductRunSources, usageDiagnosticProjection } from "./productRunStorage.js";
import { loadScreenshotContactTask } from "./screenshotContactTasks.js";
import { randomUUID } from "node:crypto";
import { withProductRunCapture, captureObservationContent, observationID, type ProductRunSpan } from "@talent-signal/agent";
import { CONTRACT_VERSION, ProductRunFeedbackMutationSchema, ProductRunListSchema,
  type ProductRunDetail, type ProductRunFeedback, type ProductRunFeedbackMutation, type ProductRunSummary } from "@talent-signal/contracts";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { registerRecurringJob } from "../lib/recurringJob.js";
import { labHash } from "./labJobCases.js";
import type { AuthContext } from "./auth.js";

const tasks = new Map([
  ["/v1/chat/tasks", "relationship_chat"], ["/v1/chat/unscoped-tasks", "conversation"],
  ["/v1/contact-agent/tasks", "screenshot"], ["/v1/person-research/tasks", "person_research"],
]);
const iso = (value: Date | string | null) => value instanceof Date ? value.toISOString() : value;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
export const feedbackReasons = {
  helpful: ["new_insight", "remembered_context", "clear_next_step", "ready_to_use"],
  unhelpful: ["wrong_intent", "wrong_memory", "incorrect_information", "not_actionable", "poor_expression"],
};
function platform(request: FastifyRequest): string {
  const value = request.headers["x-talent-signal-platform"];
  if (value === "web" || value === "ios") return value;
  return "unknown";
}
function containsPassage(value: unknown, passage: string): boolean {
  if (typeof value === "string") return value.includes(passage);
  if (Array.isArray(value)) return value.some(item => containsPassage(item, passage));
  return !!value && typeof value === "object" && Object.values(value).some(item => containsPassage(item, passage));
}
function bodyObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
// Original screenshots already have product-owned storage. Keep their exact
// hashes/metadata here and preview the source by task ID instead of duplicating bytes.
function inputSnapshot(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, item) => key === "data_base64" ? "[original image available through task source]" : item));
}
type Row = {
  id: string; task_id: string | null; session_id: string | null; platform: string; task_kind: string;
  objective: string; input: unknown; output: unknown; output_hash: string | null; status: string; attempts: number;
  created_at: Date; updated_at: Date; finished_at: Date | null; expires_at: Date;
  feedback_revision: number; sentiment: "helpful" | "unhelpful" | null; reasons: string[]; comment: string;
  correction: string; selected_text: string; feedback_updated_at: Date | null;
  span_count: number; model: string | null; content_available: boolean; diagnostics_available: boolean;
};
function feedback(row: Row): ProductRunFeedback {
  return { revision: row.feedback_revision, sentiment: row.sentiment, reasons: row.reasons,
    comment: row.content_available ? row.comment : "", correction: row.content_available ? row.correction : "",
    selected_text: row.content_available ? row.selected_text : "", updated_at: iso(row.feedback_updated_at) };
}
function summary(row: Row): ProductRunSummary {
  return { id: row.id, task_id: row.task_id, session_id: row.session_id, platform: row.platform, task_kind: row.task_kind,
    objective: row.content_available ? row.objective : "Original content unavailable", status:
      row.status === "running" && Date.now() - row.updated_at.valueOf() > 15 * 60_000 ? "interrupted" : row.status,
    created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)!,
    duration_ms: row.finished_at ? Math.max(0, row.finished_at.valueOf() - row.created_at.valueOf()) : null,
    attempts: row.attempts, output_hash: row.output_hash, feedback: feedback(row), model: row.model,
    span_count: Number(row.span_count), content_available: row.content_available };
}
const available = `product_run_source_available(r.id)`;
const select = `SELECT r.*,${available} AS content_available,
  screenshot_usage_diagnostics_available(r.id) AS diagnostics_available,
  (SELECT count(*)::int FROM product_run_spans s WHERE s.run_id=r.id) AS span_count,
  (SELECT s.span->'metadata'->>'model' FROM product_run_spans s WHERE s.run_id=r.id
    AND s.span->'metadata'->>'model' IS NOT NULL ORDER BY s.created_at DESC LIMIT 1) AS model FROM product_runs r`;

export class ProductRunService {
  constructor(readonly pool: Pool) {}
  async list(auth: AuthContext, query: { sentiment?: string; platform?: string; status?: string; q?: string; cursor?: string }) {
    const args = [auth.accountId, auth.userId, query.platform || null, query.status || null, query.q || null];
    const base = `r.account_id=$1 AND r.user_id=$2 AND ($3::text IS NULL OR r.platform=$3)
      AND ($4::text IS NULL OR (CASE WHEN r.status='running' AND r.updated_at<now()-interval '15 minutes' THEN 'interrupted' ELSE r.status END)=$4) AND ($5::text IS NULL OR (${available} AND r.objective ILIKE '%'||$5||'%'))`;
    const counts = (await this.pool.query<{ all: number; helpful: number; unhelpful: number; unrated: number }>(
      `SELECT count(*)::int AS all,count(*) FILTER(WHERE sentiment='helpful')::int AS helpful,
        count(*) FILTER(WHERE sentiment='unhelpful')::int AS unhelpful,count(*) FILTER(WHERE sentiment IS NULL)::int AS unrated
       FROM product_runs r WHERE ${base}`, args)).rows[0]!;
    const result = await this.pool.query<Row>(`${select} WHERE ${base}
      AND ($6::text IS NULL OR ($6='unrated' AND r.sentiment IS NULL) OR r.sentiment=$6)
      AND ($7::uuid IS NULL OR (r.created_at,r.id)<(SELECT created_at,id FROM product_runs WHERE id=$7 AND account_id=$1 AND user_id=$2))
      ORDER BY r.created_at DESC,r.id DESC LIMIT 51`, [...args, query.sentiment || null, query.cursor || null]);
    return { contract_version: CONTRACT_VERSION, runs: result.rows.slice(0, 50).map(summary),
      next_cursor: result.rows.length > 50 ? result.rows[49]!.id : null, counts };
  }
  async detail(auth: AuthContext, id: string, byTask = false): Promise<ProductRunDetail> {
    const row = (await this.pool.query<Row>(`${select} WHERE r.account_id=$1 AND r.user_id=$2 AND r.${byTask ? "task_id" : "id"}=$3
      ORDER BY r.created_at LIMIT 1`, [auth.accountId, auth.userId, id])).rows[0];
    if (!row) throw new ApiError(404, "PRODUCT_RUN_NOT_FOUND", "The run is not available in this account.");
    const spans = (await this.pool.query<{ span: ProductRunDetail["spans"][number] }>(
      "SELECT span FROM product_run_spans WHERE run_id=$1 ORDER BY created_at,id", [row.id])).rows.flatMap(entry => {
        if (row.content_available) return [entry.span];
        if (!row.task_id || row.status === "failed") return [metadataOnlyProductSpan(entry.span)];
        // A still admitted same-owner screenshot source keeps only its strictly
        // sanitized usage counters across unrelated generation drift. Raw
        // input/output, history and every other span stay unavailable.
        if (row.diagnostics_available) {
          const diagnostic = usageDiagnosticProjection(entry.span as unknown as ProductRunSpan);
          return diagnostic ? [diagnostic] : [];
        }
        return [];
      });
    const history = row.content_available ? (await this.pool.query<ProductRunDetail["history"][number]>(
      "SELECT id,revision,output_hash,platform,sentiment,reasons,comment,correction,selected_text,updated_at,output FROM product_run_feedback_events WHERE run_id=$1 ORDER BY revision DESC", [row.id])).rows : [];
    const execution = row.content_available && row.task_id ? (await this.pool.query<{ snapshot: unknown }>(`SELECT snapshot FROM feedback_execution_snapshots
      WHERE account_id=$1 AND user_id=$2 AND task_id=$3 AND feedback_execution_source_state(id)='available'`,
    [auth.accountId, auth.userId, row.task_id])).rows[0]?.snapshot ?? null : null;
    const corrections = row.content_available && row.task_id ? (await this.pool.query(`SELECT f.id,f.category,f.expected_behavior_proposal,f.regression_id,f.status,f.revision
      FROM product_feedback f JOIN feedback_execution_snapshots e ON e.id=f.execution_id
      WHERE f.account_id=$1 AND f.user_id=$2 AND e.task_id=$3 AND feedback_execution_source_state(e.id)='available'`,
    [auth.accountId, auth.userId, row.task_id])).rows : [];
    return { contract_version: CONTRACT_VERSION, run: summary(row), input: row.content_available ? row.input : null,
      output: row.content_available ? row.output : null, spans, history, execution, corrections };
  }
  async react(auth: AuthContext, taskID: string, request: ProductRunFeedbackMutation, sourcePlatform: string): Promise<ProductRunDetail> {
    if (request.reasons.some(reason => !request.sentiment || !feedbackReasons[request.sentiment].includes(reason)))
      throw new ApiError(422, "FEEDBACK_REASON_INVALID", "Choose reasons matching this feedback.");
    if (!request.sentiment && (request.reasons.length || request.comment || request.correction || request.selected_text))
      throw new ApiError(422, "FEEDBACK_WITHDRAWAL_INVALID", "Withdraw the signal without carrying an active note.");
    await inTransaction(this.pool, async client => {
      const row = (await client.query<Row>(`SELECT r.*,${available} AS content_available FROM product_runs r
        WHERE r.account_id=$1 AND r.user_id=$2 AND r.task_id=$3 ORDER BY r.created_at LIMIT 1 FOR UPDATE OF r`,
      [auth.accountId, auth.userId, taskID])).rows[0];
      if (!row) throw new ApiError(404, "PRODUCT_RUN_NOT_FOUND", "The original run is unavailable.");
      const hash = labHash({ taskID, request });
      const old = (await client.query<{ request_hash: string; run_id: string }>(
        "SELECT request_hash,run_id FROM product_run_feedback_events WHERE id=$1", [request.idempotency_key])).rows[0];
      if (old) {
        if (old.run_id !== row.id || old.request_hash !== hash) throw new ApiError(409, "FEEDBACK_IDEMPOTENCY_CONFLICT", "This submission already names another edit.");
        return;
      }
      if (row.feedback_revision !== request.expected_revision || row.output_hash !== request.output_hash)
        throw new ApiError(409, "FEEDBACK_CHANGED", "The answer or feedback changed. Reload its current state.");
      if (!row.content_available && request.sentiment) throw new ApiError(410, "PRODUCT_RUN_EXPIRED", "The original answer is no longer available.");
      if (request.selected_text && !containsPassage(row.output, request.selected_text))
        throw new ApiError(422, "FEEDBACK_SELECTION_INVALID", "The selected passage must belong to this answer.");
      const revision = row.feedback_revision + 1;
      await client.query(`INSERT INTO product_run_feedback_events(id,run_id,revision,output_hash,platform,sentiment,reasons,comment,correction,selected_text,request_hash,output)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb)`,
      [request.idempotency_key, row.id, revision, request.output_hash, sourcePlatform, request.sentiment,
        JSON.stringify(request.reasons), request.comment, request.correction, request.selected_text, hash, JSON.stringify(row.output)]);
      await client.query(`UPDATE product_runs SET feedback_revision=$2,sentiment=$3,reasons=$4::jsonb,comment=$5,
        correction=$6,selected_text=$7,feedback_updated_at=now() WHERE id=$1`,
      [row.id, revision, request.sentiment, JSON.stringify(request.reasons), request.comment, request.correction, request.selected_text]);
    });
    return this.detail(auth, taskID, true);
  }
}

/** Observe admitted real requests before execution, including fallback, errors and retries.
 * Fastify handlers run after authentication/validation; onSend observes the actual wire answer.
 * https://fastify.dev/docs/latest/Reference/Hooks/
 */
export function registerProductRunMonitoring(app: FastifyInstance, pool: Pool, authenticate: preHandlerHookHandler) {
  const service = new ProductRunService(pool);
  const active = new WeakMap<FastifyRequest, { id: string; finish: boolean; flush: () => Promise<void>; input: unknown; objective: string }>();
  app.addHook("onRoute", route => {
    const kind = tasks.get(route.url);
    if (!kind || route.method !== "POST") return;
    const handler = route.handler;
    route.handler = async function(request, reply) {
      const body = bodyObject(request.body), auth = request.auth;
      const frozen = captureObservationContent(inputSnapshot(body), 2_000_000);
      const id = observationID(labHash([auth.accountId, auth.userId, route.url, body.idempotency_key ?? randomUUID(), labHash(body)]));
      const admission=await pool.query<{source_generation:string|null}>(`INSERT INTO product_runs(id,account_id,user_id,session_id,platform,task_kind,objective,input,source_generation)
        VALUES($1,$2,$3,$4,$5,$6,'',NULL,(SELECT generation FROM harness_source_generations WHERE account_id=$2))
        ON CONFLICT(id) DO UPDATE SET attempts=product_runs.attempts+1,
          source_generation=CASE WHEN product_runs.status='failed' AND product_runs.task_id IS NULL
            THEN EXCLUDED.source_generation ELSE product_runs.source_generation END
        RETURNING source_generation`,
      [id, auth.accountId, auth.userId, typeof body.session_id === "string" && uuid.test(body.session_id) ? body.session_id : null,
        platform(request), kind]);
      const sink = productRunSink(pool, id, error => { app.log.error({ err: error, run_id: id }, "Product span persistence failed"); },admission.rows[0]?.source_generation);
      active.set(request, { id, finish: false, flush: sink.flush, input: frozen, objective: String(body.objective ?? "").slice(0,12000) });
      reply.header("x-talent-signal-run-id", id);
      return withProductRunCapture(sink, () => handler.call(this, request, reply));
    };
  });
  app.addHook("onSend", async (request, reply, payload) => {
    const record = active.get(request);
    if (!record || record.finish || typeof payload !== "string") return payload;
    record.finish = true;
    const output = JSON.parse(payload) as Record<string, unknown>;
    const taskID = typeof output.task_id === "string" && uuid.test(output.task_id) ? output.task_id : null;
    const blocks = Array.isArray(output.blocks) ? output.blocks : [];
    const status = reply.statusCode >= 400 ? "failed" : output.status === "running" ? "running"
      : blocks.some(block => ["AI answer unavailable", "Local reply", "本地回复"].includes(String(bodyObject(block).title))) ? "fallback" : "completed";
    await inTransaction(pool, async client => {
      if (taskID && tasks.get(request.routeOptions.url ?? "") === "screenshot") {
        // Background checkpoints acquire this task before their Run row too.
        await client.query("SELECT id FROM screenshot_contact_tasks WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3 FOR SHARE",
          [request.auth.accountId,request.auth.userId,taskID]);
      }
      if (taskID && status !== "failed") {
        await client.query("UPDATE product_runs SET task_id=COALESCE(task_id,$4::uuid),input=$2::jsonb,objective=$3,status=$5 WHERE id=$1 AND (task_id IS NULL OR task_id=$4::uuid)",
          [record.id,JSON.stringify(record.input),record.objective,taskID,status]);
      }
      await saveProductRunOutput(client, { id: record.id, ...(taskID ? { taskID } : {}) }, output, status);
      await client.query(`UPDATE product_runs SET input=NULL,output=NULL,objective='',comment='',correction='',selected_text=''
        WHERE id=$1 AND NOT product_run_source_available(id)`,[record.id]);
    });
    await record.flush();
    // The background runner can finish before HTTP serialization assigns its task ID.
    if (taskID && tasks.get(request.routeOptions.url ?? "") === "screenshot") {
      const current = await loadScreenshotContactTask(pool, request.auth, taskID);
      await saveProductRunOutput(pool, { id: record.id, taskID }, current as unknown as Record<string, unknown>, current.status);
    }
    return payload;
  });
  const preHandler = [authenticate, async (_request: FastifyRequest, reply: import("fastify").FastifyReply) => { reply.header("cache-control", "no-store"); }];
  const params = Type.Object({ id: Type.String({ format: "uuid" }) }, { additionalProperties: false });
  app.get<{ Querystring: { sentiment?: string; platform?: string; status?: string; q?: string; cursor?: string } }>("/v1/product-runs", {
    preHandler, schema: { querystring: Type.Object({
      sentiment: Type.Optional(Type.Union([Type.Literal("helpful"), Type.Literal("unhelpful"), Type.Literal("unrated")])),
      platform: Type.Optional(Type.Union([Type.Literal("web"), Type.Literal("ios"), Type.Literal("unknown")])),
      status: Type.Optional(Type.String({ maxLength: 30 })), q: Type.Optional(Type.String({ maxLength: 200 })),
      cursor: Type.Optional(Type.String({ format: "uuid" })),
    }, { additionalProperties: false }), response: { 200: ProductRunListSchema } },
  }, request => service.list(request.auth, request.query));
  app.get<{ Params: { id: string } }>("/v1/product-runs/:id", { preHandler, schema: { params } }, request => service.detail(request.auth, request.params.id));
  app.get<{ Params: { id: string } }>("/v1/product-runs/tasks/:id", { preHandler, schema: { params } }, request => service.detail(request.auth, request.params.id, true));
  app.put<{ Params: { id: string }; Body: ProductRunFeedbackMutation }>("/v1/product-runs/tasks/:id/feedback", {
    preHandler, schema: { params, body: ProductRunFeedbackMutationSchema },
  }, request => service.react(request.auth, request.params.id, request.body, platform(request)));
  app.post<{ Params: { id: string }; Body: { id: string; output_hash: string; expected_behavior: string } }>("/v1/product-runs/:id/cases", {
    preHandler, schema: { params, body: Type.Object({ id: Type.String({ format: "uuid" }),
      output_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }), expected_behavior: Type.String({ minLength: 1, maxLength: 2000 }) }, { additionalProperties: false }) } },
    async request => ({ contract_version: CONTRACT_VERSION, ...await saveProductRunCase(pool, request.auth,
      await service.detail(request.auth, request.params.id), request.body) }));
  registerRecurringJob(app, {
    name: "product-run-source-cleanup",
    intervalMs: 60_000,
    run: () => cleanupProductRunSources(pool),
  });
}
