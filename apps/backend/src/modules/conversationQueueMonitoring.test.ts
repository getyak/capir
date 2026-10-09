import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  reconcileRecoveredQueueRunMonitoring,
  recoveredQueueRunStatus,
  type RecoveredQueueRunAttempt,
} from "./conversationQueueMonitoring.js";

const attempt: RecoveredQueueRunAttempt = {
  accountId: "10000000-0000-4000-8000-00000000000a",
  sessionId: "20000000-0000-4000-8000-00000000000b",
  entryId: "30000000-0000-4000-8000-00000000000c",
  messageId: "40000000-0000-4000-8000-00000000000d",
  runId: "50000000-0000-4000-8000-00000000000e",
  attempt: 2,
  createdByUserId: "60000000-0000-4000-8000-00000000000f",
  leaseGeneration: 3,
};

function syntheticQuery() {
  return vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 0 }));
}

function syntheticPool(query: ReturnType<typeof syntheticQuery>) {
  return { query } as unknown as Pool;
}

function syntheticLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("recovered queue run monitoring reconciliation", () => {
  it("reconciles one recovered attempt through exact canonical and product bindings", async () => {
    const query = syntheticQuery();
    await reconcileRecoveredQueueRunMonitoring(syntheticPool(query), attempt, syntheticLogger());
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([
      attempt.accountId,
      attempt.sessionId,
      attempt.entryId,
      attempt.runId,
      attempt.leaseGeneration,
      attempt.createdByUserId,
    ]);
    // The queue row binds the attempt identity, atomically inside the write.
    expect(sql).toContain("q.account_id=$1 AND q.session_id=$2 AND q.id=$3 AND q.run_id=$4 AND q.lease_generation=$5");
    expect(sql).toContain("q.created_by_user_id=$6");
    expect(sql).toContain("q.status IN ('interrupted','cancelled','failed')");
    // The product run must be that attempt's own record with the same owner.
    expect(sql).toContain("r.id=q.run_id AND r.account_id=q.account_id AND r.session_id=q.session_id");
    expect(sql).toContain("r.user_id=q.created_by_user_id");
    // Only an unbound, still-live running product row may be reconciled.
    expect(sql).toContain("r.task_id IS NULL AND r.status IN ('running','partial') AND r.expires_at>clock_timestamp()");
    // Terminal finalization clears the lease owner, so it can never fence here.
    expect(sql).not.toContain("lease_owner");
  });

  it("projects only terminal queue truth and can never infer completed", async () => {
    expect(recoveredQueueRunStatus("interrupted", false)).toBe("interrupted");
    expect(recoveredQueueRunStatus("interrupted", true)).toBe("interrupted");
    expect(recoveredQueueRunStatus("cancelled", false)).toBe("cancelled");
    expect(recoveredQueueRunStatus("cancelled", true)).toBe("cancelled");
    expect(recoveredQueueRunStatus("failed", false)).toBe("failed");
    expect(recoveredQueueRunStatus("failed", true)).toBe("partial");
    for (const nonTerminal of ["queued", "running", "completed"]) {
      expect(recoveredQueueRunStatus(nonTerminal, false)).toBeNull();
      expect(recoveredQueueRunStatus(nonTerminal, true)).toBeNull();
    }
    // The statement's mapping is generated from exactly that projection.
    const query = syntheticQuery();
    await reconcileRecoveredQueueRunMonitoring(syntheticPool(query), attempt, syntheticLogger());
    const sql = (query.mock.calls[0] as [string])[0];
    expect(sql.match(/WHEN /g)).toHaveLength(6);
    expect(sql.match(/THEN '(\w+)'/g)).toEqual([
      "THEN 'interrupted'", "THEN 'interrupted'",
      "THEN 'cancelled'", "THEN 'cancelled'",
      "THEN 'failed'", "THEN 'partial'",
    ]);
    expect(sql).not.toContain("'completed'");
  });

  it("writes monitoring metadata only: no bodies, spans or logs", async () => {
    const query = syntheticQuery();
    const logger = syntheticLogger();
    await reconcileRecoveredQueueRunMonitoring(syntheticPool(query), attempt, logger);
    const [sql] = query.mock.calls[0] as [string];
    expect(query).toHaveBeenCalledTimes(1);
    expect(sql.trimStart()).toMatch(/^UPDATE product_runs/);
    expect(sql).not.toMatch(
      /INSERT|INTO|input|output|objective|source_generation|product_run_spans|comment|correction|selected_text|duration|task_id=|result=/i,
    );
    // The canonical completed_at is the finish time, never a fabricated one.
    expect(sql).toContain("finished_at=q.completed_at");
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("stays inert and silent when repeated or when no row matches", async () => {
    const query = syntheticQuery();
    const logger = syntheticLogger();
    await reconcileRecoveredQueueRunMonitoring(syntheticPool(query), attempt, logger);
    await reconcileRecoveredQueueRunMonitoring(syntheticPool(query), attempt, logger);
    await reconcileRecoveredQueueRunMonitoring(syntheticPool(query), attempt, logger);
    expect(query).toHaveBeenCalledTimes(3);
    for (const call of query.mock.calls) {
      expect(call).toEqual(query.mock.calls[0]);
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns diagnostics only and never throws or changes queue truth when the write fails", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => {
      throw new Error("synthetic diagnostics outage");
    });
    const logger = syntheticLogger();
    await expect(
      reconcileRecoveredQueueRunMonitoring(syntheticPool(query), attempt, logger),
    ).resolves.toBeUndefined();
    // One best-effort statement, no retry and no compensating write.
    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as [string];
    expect(sql.trimStart()).toMatch(/^UPDATE product_runs/);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [metadata, message] = logger.warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(metadata).toMatchObject({
      session_id: attempt.sessionId,
      message_id: attempt.messageId,
      queue_entry_id: attempt.entryId,
      run_id: attempt.runId,
      task_id: attempt.runId,
      attempt: attempt.attempt,
      failure_code: "MONITORING_UNAVAILABLE",
    });
    expect(Object.keys(metadata).sort()).toEqual([
      "attempt", "failure_code", "message_id", "queue_entry_id", "run_id", "session_id", "task_id",
    ]);
    expect(message).toBe("conversation queue recovery could not reconcile monitoring");
  });
});
