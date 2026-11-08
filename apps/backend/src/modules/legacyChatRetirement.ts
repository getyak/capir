import type { Pool, PoolClient } from "pg";
import type { DatabaseClient } from "../database/pool.js";
import { inLegacyChatRetirementTransaction } from "./legacyChatDatabase.js";
import type { LegacyChatOwnerToken, LegacyChatTerminalReason } from "./legacyChatExecutions.js";
import { labStopAuthorityKeySQL } from "./labStopAuthority.js";
import type { AuthContext } from "./auth.js";
import { ApiError } from "../lib/apiError.js";

const privateScrub = `original_proof=NULL,source_snapshot=NULL,checkpoint=NULL,
  checkpoint_bytes=NULL,checkpoint_sha256=NULL,checkpoint_expires_at=NULL,updated_at=clock_timestamp()`;

/** Authority-reducing only. The caller owns account -> parent -> execution
 * locks; this never asks an expired original credential to become live again. */
export async function retireLegacyChatOwner(client: PoolClient, token: LegacyChatOwnerToken,
  state: "cancelled" | "expired" | "authority_lost" | "unknown" | "result_unavailable",
  reason: LegacyChatTerminalReason): Promise<void> {
  await client.query(`UPDATE legacy_chat_executions SET state=CASE WHEN $7='unknown'
      AND dispatch_started_at IS NULL THEN 'expired' ELSE $7 END,terminal_reason=$8,${privateScrub}
    WHERE account_id=$1 AND idempotency_id=$2 AND attempt_id=$3 AND owner_instance=$4
      AND owner_generation=$5::bigint AND owner_nonce=$6
      AND state IN ('admitted','dispatch_started','result_ready')`,
  [token.accountId,token.parentID,token.attemptID,token.instance,token.generation,token.nonce,state,reason]);
}

export async function retireLegacyChatOwnerAfterFailure(pool: Pool, auth: AuthContext,
  token: LegacyChatOwnerToken,
  state: Parameters<typeof retireLegacyChatOwner>[2], reason: LegacyChatTerminalReason): Promise<void> {
  await inLegacyChatRetirementTransaction(pool, async client => {
    const lab = (await client.query<{ state: string; live: boolean; stop_clear: boolean }>(`SELECT state,
      expires_at>clock_timestamp() AS live,pg_try_advisory_xact_lock_shared(${labStopAuthorityKeySQL}) AS stop_clear
      FROM lab_test_workspaces WHERE target_account_id=$1 FOR SHARE NOWAIT`, [token.accountId])).rows[0];
    if (lab && (lab.state !== "active" || !lab.live || !lab.stop_clear)) return; // canonical Lab cleanup owns deletion
    if ((await client.query("SELECT id FROM accounts WHERE id=$1 AND retired_at IS NULL FOR SHARE NOWAIT", [token.accountId])).rowCount !== 1) return;
    if ((await client.query(`SELECT id FROM idempotency_records WHERE account_id=$1 AND id=$2
      AND actor_user_id=$3 AND operation_scope='create_unscoped_chat_task' FOR UPDATE NOWAIT`,
    [token.accountId,token.parentID,auth.userId])).rowCount !== 1) return;
    await client.query(`SELECT idempotency_id FROM legacy_chat_executions WHERE account_id=$1
      AND idempotency_id=$2 FOR UPDATE NOWAIT`, [token.accountId,token.parentID]);
    await retireLegacyChatOwner(client, token, state, reason);
  });
}

/** Preserve no-replay keys while the existing MCP owner erases its private
 * copies. A single statement is atomic even for an autocommit caller. The
 * account lock is NOWAIT because a source-owner transaction may already hold
 * source locks; conflict aborts the whole operation, never reports cleanup.
 * Normal whole-account/Lab graph deletion still removes both nodes together. */
export async function retireLegacyChatMcpContent(client: DatabaseClient, accountId: string,
  sessionId: string): Promise<void> {
  const result = await client.query<{ has_refs: boolean; fences: number }>(`WITH account_fence AS MATERIALIZED (
      SELECT id FROM accounts WHERE id=$1 FOR SHARE NOWAIT
    ), source_fence AS MATERIALIZED (
      SELECT g.account_id FROM harness_source_generations g JOIN account_fence f ON f.id=g.account_id
      WHERE EXISTS (SELECT 1 FROM mcp_interaction_requests WHERE account_id=$1 AND session_id=$2)
      FOR UPDATE OF g NOWAIT
    ), bumped AS (
      UPDATE harness_source_generations g SET generation=g.generation+1
      FROM source_fence f WHERE g.account_id=f.account_id RETURNING g.account_id
    ), parents AS MATERIALIZED (
      SELECT p.id FROM idempotency_records p
      JOIN legacy_chat_executions e ON e.account_id=p.account_id AND e.idempotency_id=p.id
      CROSS JOIN bumped f
      -- A held dispatch has no formed payload to search. Revoking the original
      -- account source epoch and all active attempts prevents future backfill;
      -- lawful unrelated COMPLETED content still uses the exact reference rule.
      WHERE p.account_id=f.account_id AND (e.state IN ('admitted','dispatch_started','result_ready') OR EXISTS (
        SELECT 1 FROM mcp_interaction_requests m WHERE m.account_id=$1 AND m.session_id=$2
          AND (p.response_body::text LIKE '%'||m.id||'%' OR e.checkpoint LIKE '%'||m.id||'%'
            OR (m.work_connection_id IS NOT NULL AND (
              p.response_body::text LIKE '%'||m.work_connection_id||'%'
              OR e.checkpoint LIKE '%'||m.work_connection_id||'%')))))
      ORDER BY p.id FOR UPDATE OF p NOWAIT
    ), executions AS MATERIALIZED (
      SELECT e.idempotency_id FROM legacy_chat_executions e JOIN parents p ON p.id=e.idempotency_id
      WHERE e.account_id=$1 ORDER BY e.idempotency_id FOR UPDATE OF e NOWAIT
    ), scrubbed AS (
      UPDATE legacy_chat_executions e SET state='content_unavailable',terminal_reason='source_withdrawn',
        content_retired_at=COALESCE(e.content_retired_at,clock_timestamp()),${privateScrub}
      FROM executions x WHERE e.account_id=$1 AND e.idempotency_id=x.idempotency_id
      RETURNING e.idempotency_id
    ), retired_parents AS (
      UPDATE idempotency_records p
      SET response_body=CASE WHEN p.status='completed'
        THEN '{"legacy_chat_content_unavailable":true}'::jsonb ELSE NULL END
      FROM scrubbed s WHERE p.account_id=$1 AND p.id=s.idempotency_id RETURNING p.id
    ) SELECT EXISTS(SELECT 1 FROM mcp_interaction_requests WHERE account_id=$1 AND session_id=$2) AS has_refs,
      (SELECT count(*)::int FROM source_fence) AS fences,
      (SELECT count(*)::int FROM retired_parents) AS retired`, [accountId,sessionId]);
  const row = result.rows[0];
  if (!row || (row.has_refs && row.fences !== 1)) throw new ApiError(409,"LEGACY_CHAT_SOURCE_RETIREMENT_PENDING",
    "The source cleanup could not be fenced. Retry it after the current source operation settles.");
}

/** Exact metadata candidates first, without row locks. Each bounded operation
 * then takes canonical Lab/account -> parent -> execution locks and rechecks
 * PostgreSQL time. A result_ready lease alone expiring does not erase the
 * explicit same-attempt resolve window. The janitor never publishes answers. */
export async function sweepLegacyChatExecutions(pool: Pool): Promise<number> {
  const candidates = (await inLegacyChatRetirementTransaction(pool,client => client.query<{ account_id: string; idempotency_id: string }>(`
    SELECT account_id,idempotency_id FROM legacy_chat_executions
    WHERE state IN ('admitted','dispatch_started','result_ready') AND (
      execution_deadline<=clock_timestamp() OR
      (state<>'result_ready' AND lease_until<=clock_timestamp()))
    ORDER BY execution_deadline,idempotency_id LIMIT 64`))).rows;
  let retired = 0;
  for (const candidate of candidates) {
    try {
      retired += await inLegacyChatRetirementTransaction(pool, async client => {
        const lab = (await client.query<{ state: string; live: boolean; stop_clear: boolean }>(`
          SELECT state,expires_at>clock_timestamp() AS live,
            pg_try_advisory_xact_lock_shared(${labStopAuthorityKeySQL}) AS stop_clear
          FROM lab_test_workspaces WHERE target_account_id=$1 FOR SHARE NOWAIT`, [candidate.account_id])).rows[0];
        // Closed Lab UPDATE is deliberately forbidden by its existing guard.
        // Its actual stop owner performs canonical whole-graph DELETE instead.
        if (lab && (lab.state !== "active" || !lab.live || !lab.stop_clear)) return 0;
        const account = await client.query(`SELECT id FROM accounts WHERE id=$1 AND retired_at IS NULL FOR SHARE NOWAIT`, [candidate.account_id]);
        if (account.rowCount !== 1) return 0;
        await client.query(`SELECT id FROM idempotency_records WHERE account_id=$1 AND id=$2 FOR UPDATE NOWAIT`,
          [candidate.account_id,candidate.idempotency_id]);
        const row = (await client.query<{ state: string; expired: boolean }>(`
          SELECT state,execution_deadline<=clock_timestamp() AS expired FROM legacy_chat_executions
          WHERE account_id=$1 AND idempotency_id=$2 AND state IN ('admitted','dispatch_started','result_ready')
            AND (execution_deadline<=clock_timestamp() OR (state<>'result_ready' AND lease_until<=clock_timestamp()))
          FOR UPDATE NOWAIT`, [candidate.account_id,candidate.idempotency_id])).rows[0];
        if (!row) return 0;
        const state = row.expired ? "expired" : row.state === "dispatch_started" ? "unknown" : "expired";
        const result = await client.query(`UPDATE legacy_chat_executions SET state=$3,terminal_reason=$4,${privateScrub}
          WHERE account_id=$1 AND idempotency_id=$2`, [candidate.account_id,candidate.idempotency_id,
          state,row.expired ? "expired" : "lease_lost"]);
        return result.rowCount ?? 0;
      });
    } catch (error) {
      // A skipped conflict means pending maintenance, not successful retirement.
      const code = (error as { code?: string })?.code;
      if (!["55P03","40P01","40001"].includes(code ?? "")) throw new Error("LEGACY_CHAT_RETIREMENT_PENDING");
    }
  }
  return retired;
}
