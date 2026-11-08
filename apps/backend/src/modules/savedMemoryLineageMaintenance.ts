/** Finite, task-indexed maintenance. It is never the read-authorization gate.
 * No automatic timer/startup hook: the service owner must wire both to this
 * single-flight entry only after the bounded Session-owner replacement passes. */
import type { Pool, PoolClient } from "pg";
import { ApiError } from "../lib/apiError.js";

const flights = new WeakMap<Pool, Promise<SavedMemoryMaintenanceResult>>();
const unavailable = () => new ApiError(503, "SAVED_MEMORY_STORAGE_UNAVAILABLE", "Saved Memory storage is temporarily unavailable.");
export async function withSavedMemoryTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  let late = false, timer: ReturnType<typeof setTimeout> | undefined;
  const borrowed = Promise.resolve().then(() => pool.connect()).then(client => {
    if (late) { client.release(); throw unavailable(); }
    return client;
  });
  let client: PoolClient;
  try {
    client = await Promise.race([borrowed, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { late = true; reject(unavailable()); }, 2_000);
    })]);
  } catch { late = true; throw unavailable(); }
  finally { if (timer) clearTimeout(timer); }
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '2s'");
    await client.query("SET LOCAL lock_timeout = '100ms'");
    const value = await operation(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Static error only. */ }
    if (error instanceof ApiError) throw error;
    throw unavailable();
  } finally { client.release(); }
}
export interface SavedMemoryMaintenanceResult {
  readonly invalidatedTasks: number;
  readonly scrubbedTasks: number;
  readonly expiredQueries: number;
  readonly sessionScrubNotWired: boolean;
}
export interface SavedMemoryMaintenanceOptions {
  /** Approved current owner, same short Tx/client. It must include bounded
   * canonical Session cleanup and its actual trigger work, not a no-op ACK. */
  readonly scrubTask?: (client: PoolClient, accountId: string, taskID: string, limit: number) => Promise<boolean>;
}
export function runSavedMemoryMaintenance(pool: Pool, options: SavedMemoryMaintenanceOptions = {}): Promise<SavedMemoryMaintenanceResult> {
  const existing = flights.get(pool);
  if (existing) return existing;
  const task = withSavedMemoryTransaction(pool, async client => {
    // Candidate scan also uses the bounded borrower/statement timeout. Closed
    // Lab graphs belong to canonical cleanup, never a resurrection/guard bypass.
    const allowed = `EXISTS (SELECT 1 FROM accounts a WHERE a.id=l.account_id AND a.retired_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM lab_test_workspaces w WHERE w.target_account_id=l.account_id
        AND (w.state<>'active' OR w.expires_at<=clock_timestamp()))`;
    // Query entropy is operational metadata, not a renewable permission.
    // Expiry cleanup is bounded even if the original actor never searches again.
    const expired = await client.query(`WITH selected AS MATERIALIZED (
      SELECT account_id,id FROM memory_discovery_queries WHERE expires_at<=clock_timestamp()
      ORDER BY expires_at,account_id,id LIMIT 50 FOR UPDATE SKIP LOCKED
    ) DELETE FROM memory_discovery_queries q USING selected s WHERE q.account_id=s.account_id AND q.id=s.id`);
    const expiredQueries = expired.rowCount;
    if (expiredQueries === null || expiredQueries < 0 || expiredQueries > 50) throw unavailable();
    const dirty = (await client.query<{ account_id: string; memory_item_id: string }>(`SELECT l.account_id,l.memory_item_id
      FROM memory_item_lineage l WHERE l.cleanup_epoch<l.epoch AND ${allowed}
      ORDER BY l.changed_at,l.account_id,l.memory_item_id LIMIT 1`)).rows[0];
    let invalidatedTasks = 0;
    if (dirty) {
      await client.query("SELECT id FROM accounts WHERE id=$1 AND retired_at IS NULL FOR SHARE NOWAIT", [dirty.account_id]);
      const result = (await client.query<{ count: number }>("SELECT invalidate_saved_memory_dependents($1,$2,50) AS count",
        [dirty.account_id, dirty.memory_item_id])).rows[0];
      if (!result || !Number.isSafeInteger(result.count) || result.count < 0 || result.count > 50) throw unavailable();
      invalidatedTasks = result.count;
    }
    let scrubbedTasks = 0;
    if (options.scrubTask) {
      // One task and <=50 routed Session copies per invocation, not50 tasks
      // each with an unbounded fork fanout. Caller schedules another finite tick.
      const pending = (await client.query<{ account_id: string; task_id: string }>(`SELECT l.account_id,l.task_id
        FROM agent_task_memory_lineage l WHERE l.withdrawn_at IS NOT NULL AND NOT l.cleanup_complete AND ${allowed}
        ORDER BY l.withdrawn_at,l.account_id,l.task_id LIMIT 1`)).rows[0];
      if (pending) {
        await client.query("SELECT id FROM accounts WHERE id=$1 AND retired_at IS NULL FOR SHARE NOWAIT", [pending.account_id]);
        if (await options.scrubTask(client, pending.account_id, pending.task_id, 50)) scrubbedTasks = 1;
      }
    }
    return Object.freeze({ invalidatedTasks, scrubbedTasks, expiredQueries, sessionScrubNotWired: !options.scrubTask });
  });
  flights.set(pool, task);
  void task.finally(() => { if (flights.get(pool) === task) flights.delete(pool); }).catch(() => {});
  return task;
}
