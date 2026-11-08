import type { Pool } from "pg";
import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { restoreLegacyChatAuthority, type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { lockLegacyChatSessionSource, restoreLegacyChatSourceGuard, type LegacyChatSourceGuard } from "./legacyChatSourceSnapshot.js";
import { createLegacyChatDatabase, LegacyChatCommitUnknown } from "./legacyChatDatabase.js";
import { adoptLegacyChatCheckpoint, readLegacyChatExecution,
  type LegacyChatExecutionRow, type LegacyChatOwnerToken } from "./legacyChatExecutions.js";
import { finalizeLegacyChatCheckpoint, readLegacyChatPublication } from "./legacyChatLifecycle.js";
import { retireLegacyChatOwner, retireLegacyChatOwnerAfterFailure } from "./legacyChatRetirement.js";

const unavailable = () => new ApiError(409,"LEGACY_CHAT_EXECUTION_UNAVAILABLE",
  "This attempt is unavailable. No new model call was started.");
const tokenFor = (row: LegacyChatExecutionRow): LegacyChatOwnerToken => ({
  accountId: row.account_id,parentID: row.idempotency_id,taskID: row.task_id,attemptID: row.attempt_id,
  instance: row.owner_instance,generation: row.owner_generation,nonce: row.owner_nonce,
});
interface RecoveryInput { pool: Pool; auth: AuthContext; authority: LegacyChatAuthority; key: string }

/** Only a current authenticated same-actor lookup supplies private restoration
 * data. Public body/query never contains a proof, generation or attempt UUID. */
async function loadByKey(input: RecoveryInput): Promise<LegacyChatExecutionRow> {
  const database = createLegacyChatDatabase(input.pool,input.authority);
  return database.run(async client => {
    await input.authority.lockAccountsForFinalization(client);
    await input.authority.lockReadersForFinalization(client);
    const parent = (await client.query<{ id: string }>(`SELECT p.id FROM idempotency_records p
      JOIN legacy_chat_executions e ON e.account_id=p.account_id AND e.idempotency_id=p.id
      WHERE p.account_id=$1 AND p.actor_user_id=$2 AND p.operation_scope='create_unscoped_chat_task'
        AND p.idempotency_key=$3 FOR SHARE OF p,e NOWAIT`, [input.auth.accountId,input.auth.userId,input.key])).rows[0];
    if (!parent) throw unavailable();
    const row = await readLegacyChatExecution(client,input.auth,parent.id);
    if (!row) throw unavailable();
    await input.authority.assertFinalCurrent(client);
    return row;
  });
}

export async function readLegacyChatStatus(input: RecoveryInput) {
  const row = await loadByKey(input);
  const state = await readLegacyChatPublication({ database: createLegacyChatDatabase(input.pool,input.authority),
    authority: input.authority,auth: input.auth,parentID: row.idempotency_id });
  if (!state) throw unavailable();
  return state;
}

export async function cancelLegacyChatExecution(input: RecoveryInput) {
  const row = await loadByKey(input), database = createLegacyChatDatabase(input.pool,input.authority);
  await database.run(async client => {
    await input.authority.lockAccountsForFinalization(client);
    await input.authority.lockReadersForFinalization(client);
    await client.query(`SELECT id FROM idempotency_records WHERE account_id=$1 AND id=$2
      AND actor_user_id=$3 AND operation_scope='create_unscoped_chat_task' FOR UPDATE NOWAIT`,
    [input.auth.accountId,row.idempotency_id,input.auth.userId]);
    await client.query(`SELECT idempotency_id FROM legacy_chat_executions WHERE account_id=$1
      AND idempotency_id=$2 FOR UPDATE NOWAIT`, [input.auth.accountId,row.idempotency_id]);
    const current = await readLegacyChatExecution(client,input.auth,row.idempotency_id);
    if (!current) throw unavailable();
    await retireLegacyChatOwner(client,tokenFor(current),"cancelled","operator_cancelled");
    await input.authority.assertFinalCurrent(client);
  });
  return readLegacyChatStatus(input);
}

export async function resolveLegacyChatExecution(input: RecoveryInput & { config: BackendConfig }) {
  const row = await loadByKey(input);
  if (row.state === "completed") {
    const state = await readLegacyChatStatus(input);
    if (state.completed) return state.completed;
    throw unavailable();
  }
  if (row.state !== "result_ready") throw unavailable();
  let original: LegacyChatAuthority | undefined;
  let source: LegacyChatSourceGuard | undefined;
  let adopted: LegacyChatOwnerToken | undefined;
  let adoptionAttempted = false,adoptionCommitted = false;
  try {
    original = await restoreLegacyChatAuthority(input.pool,input.auth,row.original_proof,input.config);
    const database = createLegacyChatDatabase(input.pool,original);
    source = restoreLegacyChatSourceGuard(database.database,input.auth,row.source_snapshot,database.database,row.task_id);
    original.observeSource(source);
    await database.run(async client => {
      await original!.lockAccountsForFinalization(client);
      await lockLegacyChatSessionSource(client,input.auth,row.source_snapshot);
      await original!.assertFinalCurrent(client);
      source!.assertLive();
      await original!.lockReadersForFinalization(client);
      adoptionAttempted = true;
      adopted = await adoptLegacyChatCheckpoint(client,input.auth,row);
      await original!.assertFinalCurrent(client);
      source!.assertLive();
    });
    adoptionCommitted = true;
    source.assertLive();
    if (!adopted) throw unavailable();
    try {
      const completed = await finalizeLegacyChatCheckpoint({ database,authority: original,auth: input.auth,token: adopted,sourceSnapshot: row.source_snapshot,source });
      // Original A may lawfully publish; current resolver B independently owns
      // delivery. Recheck B after every original-owner await/COMMIT. A lawful
      // committed fact survives B's later revocation without exposing it to B.
      const current = await readLegacyChatStatus(input);
      if (!current.completed) throw unavailable();
      source.assertLive();
      return { ...completed,body: current.completed.body };
    }
    catch (error) {
      if (!(error instanceof LegacyChatCommitUnknown)) throw error;
      const current = await readLegacyChatStatus(input);
      if (current.completed) { source.assertLive(); return current.completed; }
      throw error;
    }
  } catch (error) {
    // An unacknowledged adoption may already have changed the nonce. Preserve
    // the ready result and original fixed expiry rather than guessing rollback.
    if (!(error instanceof LegacyChatCommitUnknown) && (!adoptionAttempted || adoptionCommitted)) {
      await retireLegacyChatOwnerAfterFailure(input.pool,input.auth,adoptionCommitted && adopted ? adopted : tokenFor(row),
        "authority_lost","credential_lost").catch(() => undefined);
    }
    // A concurrent lawful finalizer may have won. Its current-reader replay
    // does not inherit the old original-proof lifetime or lose completed facts.
    const current = await readLegacyChatStatus(input).catch(() => null);
    if (current?.completed) {
      // A previously completed lookup has its own lawful read policy. This
      // in-flight recovery must still not deliver beyond its fixed original
      // source bound merely because a COMMIT acknowledgement was delayed.
      try { source?.assertLive(); } catch { throw unavailable(); }
      return current.completed;
    }
    throw unavailable();
  } finally { original?.dispose(); }
}
