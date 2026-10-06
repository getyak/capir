import { randomUUID } from "node:crypto";
import { captureObservationContent, recordProductEvent, withProductRunCapture } from "@talent-signal/agent";
import type { Pool } from "pg";
import { inTransaction } from "../database/pool.js";
import { productRunSink, saveProductRunOutput } from "./productRunStorage.js";
import type { ClaimedConversationQueueEntry } from "./conversationQueueState.js";
import type { ConversationQueueExecutionResult } from "./conversationQueueCompletion.js";
import type { ConversationQueueRunnerLogger } from "./conversationQueueRunner.js";

export type QueueRunCorrelation = Pick<ClaimedConversationQueueEntry,
  "sessionId" | "messageId" | "entryId" | "runId" | "attempt">;

export function queueRunCorrelation(claim: QueueRunCorrelation) {
  return { session_id: claim.sessionId, message_id: claim.messageId, queue_entry_id: claim.entryId,
    run_id: claim.runId, task_id: claim.runId, attempt: claim.attempt };
}

export type RecoveredQueueRunAttempt = QueueRunCorrelation
  & Pick<ClaimedConversationQueueEntry, "accountId" | "createdByUserId" | "leaseGeneration">;

const RECOVERED_TERMINAL_QUEUE_STATUSES = ["interrupted", "cancelled", "failed"] as const;

/** Diagnostic projection of canonical terminal queue truth for one attempt.
 * A failed attempt that keeps its stored result projects `partial`, matching
 * `settle`. Nothing here can invent `completed`: it stays exclusive to
 * canonical completion/output linkage.
 */
export function recoveredQueueRunStatus(queueStatus: string, hasStoredResult: boolean):
  "interrupted" | "cancelled" | "failed" | "partial" | null {
  if (queueStatus === "interrupted" || queueStatus === "cancelled") return queueStatus;
  if (queueStatus === "failed") return hasStoredResult ? "partial" : "failed";
  return null;
}

/** Built from the verified projection only, so the statement and its semantics cannot drift. */
function recoveredQueueRunStatusCase(): string {
  const branches = RECOVERED_TERMINAL_QUEUE_STATUSES.flatMap((queueStatus) =>
    [false, true].map((hasStoredResult) =>
      `WHEN q.status='${queueStatus}' AND (q.result IS NOT NULL)=${hasStoredResult}`
      + ` THEN '${recoveredQueueRunStatus(queueStatus, hasStoredResult)!}'`));
  return `CASE ${branches.join(" ")} END`;
}

/** Best-effort monitoring reconciliation for a recovered terminal attempt.
 *
 * The queue stays the single status authority: one fenced statement projects
 * its terminal truth onto the attempt's monitoring row, atomically bound to the
 * canonical queue row account/session/entry/run/lease generation and to the
 * product run's own id/account/session/created user. Terminal finalization
 * clears `lease_owner`, so the generation fences the attempt instead of a
 * cleared owner; a stale retry, generation, account or session never reaches
 * another attempt. The write is metadata only — never input/output/objective,
 * source generation, task_id, spans or a fabricated duration — takes the
 * canonical `completed_at` as its finish time, and requires the product row to
 * stay unbound, running and unexpired instead of resurrecting deleted or
 * expired records. Repeated calls are inert, and a diagnostic failure never
 * changes queue truth or fails recovery.
 */
export async function reconcileRecoveredQueueRunMonitoring(
  pool: Pool,
  attempt: RecoveredQueueRunAttempt,
  logger: ConversationQueueRunnerLogger,
): Promise<void> {
  try {
    await pool.query(`UPDATE product_runs r
      SET status=${recoveredQueueRunStatusCase()},
        finished_at=q.completed_at, updated_at=now()
      FROM conversation_queue_entries q
      WHERE q.account_id=$1 AND q.session_id=$2 AND q.id=$3 AND q.run_id=$4 AND q.lease_generation=$5
        AND q.created_by_user_id=$6
        AND q.status IN (${RECOVERED_TERMINAL_QUEUE_STATUSES.map((status) => `'${status}'`).join(",")})
        AND r.id=q.run_id AND r.account_id=q.account_id AND r.session_id=q.session_id
        AND r.user_id=q.created_by_user_id
        AND r.task_id IS NULL AND r.status IN ('running','partial') AND r.expires_at>clock_timestamp()`,
    [attempt.accountId, attempt.sessionId, attempt.entryId, attempt.runId,
      attempt.leaseGeneration, attempt.createdByUserId]);
  } catch {
    logger.warn({ ...queueRunCorrelation(attempt), failure_code: "MONITORING_UNAVAILABLE" },
      "conversation queue recovery could not reconcile monitoring");
  }
}

/** Each model attempt owns a capture context, even when the diagnostic DB is unavailable. */
export async function beginQueueRunMonitoring(pool: Pool, claim: ClaimedConversationQueueEntry, logger: ConversationQueueRunnerLogger) {
  const correlation = queueRunCorrelation(claim), started = Date.now();
  const report = () => logger.warn({ ...correlation, failure_code: "MONITORING_UNAVAILABLE" }, "conversation monitoring unavailable");
  let sink: ReturnType<typeof productRunSink> | undefined;
  try {
    const row = (await pool.query<{ source_generation: string | null }>(`INSERT INTO product_runs
      (id,account_id,user_id,session_id,platform,task_kind,objective,source_generation)
      VALUES($1,$2,$3,$4,'unknown','conversation','',(SELECT generation FROM harness_source_generations WHERE account_id=$2))
      ON CONFLICT(id) DO NOTHING RETURNING source_generation`,
    [claim.runId,claim.accountId,claim.createdByUserId,claim.sessionId])).rows[0];
    if (row) sink = productRunSink(pool, claim.runId, report, row.source_generation);
  } catch { report(); }
  const safeSink = { append: async (span: Parameters<NonNullable<typeof sink>["append"]>[0]) => {
    try { await sink?.append(span); } catch { report(); }
  } };
  return {
    capture<T>(execute: () => Promise<T>): Promise<T> { return withProductRunCapture(safeSink, async () => {
      logger.info(correlation, "conversation model execution started");
      await recordProductEvent("conversation.queue.started", "context", undefined, undefined, correlation);
      return execute();
    }); },
    async settle() {
      try {
        const row = (await pool.query<{ status: string; failure_code: string | null; run_id: string | null; has_result: boolean }>(
          "SELECT status,failure_code,run_id,result IS NOT NULL AS has_result FROM conversation_queue_entries WHERE account_id=$1 AND id=$2",
          [claim.accountId,claim.entryId])).rows[0];
        const status = row?.run_id !== claim.runId ? "interrupted"
          : row.status === "failed" && row.has_result ? "partial" : row.status;
        const metadata = { ...correlation, duration_ms: Date.now()-started,
          failure_code: row?.run_id === claim.runId ? row.failure_code : "LEASE_LOST" };
        await safeSink.append({ id: randomUUID(), parent_id: null, name: `conversation.queue.${status ?? "interrupted"}`,
          kind: "context", started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(),
          status: status === "completed" ? "completed" : "failed",
          input: captureObservationContent(undefined,0), output: captureObservationContent(undefined,0), metadata,
          error: status === "completed" ? null : "Operation failed" });
        await pool.query(`UPDATE product_runs SET status=$2,updated_at=now(),finished_at=CASE WHEN $2='running' THEN NULL ELSE clock_timestamp() END
          WHERE id=$1 AND task_id IS NULL AND status IN ('running','partial')`, [claim.runId,status ?? "interrupted"]);
        await sink?.flush();
        logger.info({ ...metadata, status }, "conversation model execution settled");
      } catch { report(); }
    },
  };
}

/** Called only after canonical completion commits and the queue is completed.
 * A persistence-only replay updates the original model attempt by task ID.
 */
export async function completeQueueRunMonitoring(pool: Pool, claim: ClaimedConversationQueueEntry,
  result: ConversationQueueExecutionResult, logger: ConversationQueueRunnerLogger): Promise<void> {
  const id = result.body.task_id;
  try {
    const input = captureObservationContent({ session_id:claim.sessionId,message_id:claim.messageId,
      queue_entry_id:claim.entryId,objective:claim.objective,images:result.images ?? [] },2_000_000);
    const linked = await inTransaction(pool, async client => {
      // Keep the generation captured before execution. Revocation must never rebind a result.
      const row = (await client.query(`UPDATE product_runs SET task_id=$1,input=$4::jsonb,objective=$5,status='completed',updated_at=now()
        WHERE id=$1 AND account_id=$2 AND user_id=$3 AND status IN ('running','partial')
          AND (task_id IS NULL OR task_id=$1) AND expires_at>clock_timestamp() RETURNING id`,
      [id,claim.accountId,claim.createdByUserId,JSON.stringify(input),claim.objective])).rows[0];
      if (!row) return false;
      await saveProductRunOutput(client,{id,taskID:id},result.body as unknown as Record<string,unknown>,"completed");
      await client.query("UPDATE product_runs SET input=NULL,output=NULL,objective='' WHERE id=$1 AND NOT product_run_source_available(id)",[id]);
      return true;
    });
    if (linked) logger.info({ ...queueRunCorrelation(claim), run_id:id,task_id:id }, "conversation reply linked to monitoring");
    else logger.warn({ ...queueRunCorrelation(claim), run_id:id,task_id:id, failure_code:"MONITORING_BINDING_UNAVAILABLE" }, "conversation reply monitoring unavailable");
  } catch {
    logger.warn({ ...queueRunCorrelation(claim), failure_code:"MONITORING_UNAVAILABLE" }, "conversation reply monitoring unavailable");
  }
}
