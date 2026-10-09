import { assertHarnessLabAuthority } from "./harnessSourceGuard.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { HarnessContinuation, HarnessContinuationFactory } from "@talent-signal/agent";
import type { AuthContext } from "./auth.js";
import { assertSessionForChat } from "./agentSessionSources.js";
import { digestValue } from "../lib/hash.js";
import { ApiError } from "../lib/apiError.js";
import type { DatabaseClient } from "../database/pool.js";

type Store = HarnessContinuation["store"];
type Key = Parameters<Store["load"]>[0];
type Entry = Parameters<Store["append"]>[1][number];
interface Binding {
  id: string; sdk_session_id: string; configuration_fingerprint: string;
  scope_fingerprint: string; source_generation: string; committed_turns: number;
}
const unavailable = () => new ApiError(409, "HARNESS_SESSION_UNAVAILABLE", "The working context changed. Retry from the current Session.");

export async function sweepHarnessSessions(database: DatabaseClient, accountID?: string): Promise<void> {
  await database.query(`UPDATE harness_sessions h SET invalidated_at=clock_timestamp()
    WHERE h.invalidated_at IS NULL AND ($1::uuid IS NULL OR h.account_id=$1) AND
      (h.expires_at<=clock_timestamp() OR NOT EXISTS (SELECT 1 FROM agent_sessions s
        WHERE s.account_id=h.account_id AND s.id=h.product_session_id AND s.created_by_user_id=h.owner_user_id
          AND s.deleted_at IS NULL AND s.expires_at>clock_timestamp()))`, [accountID ?? null]);
  await database.query(`DELETE FROM harness_session_entries e USING harness_sessions h
    WHERE e.account_id=h.account_id AND e.harness_session_id=h.id AND h.invalidated_at IS NOT NULL
      AND ($1::uuid IS NULL OR h.account_id=$1)`, [accountID ?? null]);
}

/** Must run inside the same product transaction as the eventual reply receipt.
 * SAVEPOINT/ROLLBACK keeps interrupted turns out of the last committed checkpoint.
 * The transaction-scoped advisory lock is the single-writer lease; a crash releases
 * it and rolls back every mirrored entry. SDK projectKey is not an authority input:
 * each adapter closes over one authenticated binding and admits only its SDK UUID.
 */
export function createHarnessContinuationFactory(client: PoolClient, probePool: Pool, auth: AuthContext, productSessionID: string,
  scope: { kind: "workspace_conversation" } | { kind: "relationship"; personID: string; contextID: string }, sources: () => { expiresAt: Date; personIDs: readonly string[] }): HarnessContinuationFactory {
  let acquired = false;
  return async configurationFingerprint => {
    const sourceExpiresAt = sources().expiresAt;
    if (acquired || !/^[a-f0-9]{64}$/u.test(configurationFingerprint) || !Number.isFinite(sourceExpiresAt.valueOf()) || sourceExpiresAt.valueOf() <= Date.now()) throw unavailable();
    acquired = true;
    const savepoint = `harness_${randomUUID().replaceAll("-", "")}`;
    // Fails immediately if accidentally called without a transaction.
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      const locked = (await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtext('talent-signal-harness'),hashtext($1)) AS acquired",
        [`${auth.accountId}:${productSessionID}`])).rows[0]?.acquired;
      if (!locked) throw new ApiError(409, "HARNESS_SESSION_BUSY", "Another turn is still using this Session.");
      const expires = await assertSessionForChat(client, auth, productSessionID);
      await sweepHarnessSessions(client, auth.accountId);
      // Account creation commits this baseline before any long SDK transaction.
      const generation = (await client.query<{ generation: string }>("SELECT generation FROM harness_source_generations WHERE account_id=$1", [auth.accountId])).rows[0]?.generation;
      if (generation === undefined) throw unavailable();
      const scopeFingerprint = digestValue({ owner: auth.userId, session: productSessionID, ...scope });
      let binding = (await client.query<Binding>(`SELECT id,sdk_session_id,configuration_fingerprint,scope_fingerprint,source_generation,committed_turns
        FROM harness_sessions WHERE account_id=$1 AND product_session_id=$2 AND owner_user_id=$3 AND invalidated_at IS NULL`,
        [auth.accountId, productSessionID, auth.userId])).rows[0];
      if (binding && (binding.configuration_fingerprint !== configurationFingerprint || binding.scope_fingerprint !== scopeFingerprint || binding.source_generation !== generation)) {
        await client.query("UPDATE harness_sessions SET invalidated_at=clock_timestamp() WHERE account_id=$1 AND id=$2", [auth.accountId, binding.id]);
        await client.query("DELETE FROM harness_session_entries WHERE account_id=$1 AND harness_session_id=$2", [auth.accountId, binding.id]);
        binding = undefined;
      }
      if (!binding) binding = (await client.query<Binding>(`INSERT INTO harness_sessions
        (account_id,id,product_session_id,owner_user_id,sdk_session_id,configuration_fingerprint,scope_fingerprint,source_generation,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,LEAST($9,$10,now()+interval '7 days')) RETURNING *`,
        [auth.accountId, randomUUID(), productSessionID, auth.userId, randomUUID(), configurationFingerprint, scopeFingerprint, generation, expires, sourceExpiresAt])).rows[0]!;
      await client.query("UPDATE harness_sessions SET expires_at=LEAST(expires_at,$3) WHERE account_id=$1 AND id=$2", [auth.accountId, binding.id, sourceExpiresAt]);
      const current = binding;
      let finished = false;
      let pending: Promise<void> = Promise.resolve();
      let appendFailure: unknown;
      const assertCurrent = async (fence = false) => {
        if (finished) throw unavailable();
        await assertHarnessLabAuthority(probePool, auth, "recheck");
        // An independent autocommit statement notices a pending source writer
        // without retaining a read lock or rolling back concurrent product SQL.
        // Pool starvation fails closed; a late queued query is read-only and its
        // connection is released automatically when the statement completes.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const visible = await Promise.race([
            probePool.query(`SELECT 1 FROM harness_source_generations g JOIN agent_sessions s ON s.account_id=g.account_id
              WHERE g.account_id=$1 AND g.generation=$2 AND s.id=$3 AND s.created_by_user_id=$4
                AND s.deleted_at IS NULL AND s.expires_at>clock_timestamp()
              FOR SHARE OF g,s NOWAIT`, [auth.accountId, current.source_generation, productSessionID, auth.userId]),
            new Promise<never>((_, reject) => { timer=setTimeout(() => reject(unavailable()), 1000); }),
          ]);
          if (!visible.rowCount || finished) throw unavailable();
        } catch(error) {
          if (error && typeof error === "object" && "code" in error && error.code === "55P03") throw unavailable();
          throw error;
        } finally { if (timer) clearTimeout(timer); }
        const authority = sources();
        if (!Number.isFinite(authority.expiresAt.valueOf())) throw unavailable();
        // A matched account can age out without any worker changing its status.
        // Shrink the retained checkpoint before exposing any new SDK capability.
        await client.query(`UPDATE harness_sessions SET expires_at=LEAST(expires_at,$3,
          (SELECT min(valid_until) FROM identity_handles WHERE account_id=$1 AND subject_id=ANY($4::uuid[]) AND status='confirmed'))
          WHERE account_id=$1 AND id=$2`, [auth.accountId, current.id, authority.expiresAt, [...authority.personIDs]]);
        const owner = (await client.query(`SELECT 1 FROM harness_sessions h JOIN harness_source_generations g ON g.account_id=h.account_id
          JOIN agent_sessions s ON s.account_id=h.account_id AND s.id=h.product_session_id AND s.created_by_user_id=h.owner_user_id
          WHERE h.account_id=$1 AND h.id=$2 AND h.owner_user_id=$3 AND h.product_session_id=$4 AND h.invalidated_at IS NULL
            AND h.source_generation=g.generation AND h.expires_at>clock_timestamp() AND s.deleted_at IS NULL AND s.expires_at>clock_timestamp()
          ${fence ? "FOR SHARE OF g,s NOWAIT" : ""}`, [auth.accountId, current.id, auth.userId, productSessionID])).rowCount;
        if (!owner) throw unavailable();
      };
      const subpath = (key: Key) => {
        if (key.sessionId !== current.sdk_session_id) throw unavailable();
        if (key.subpath === undefined) return "";
        if (!/^subagents\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/u.test(key.subpath) || key.subpath.length > 240) throw unavailable();
        return key.subpath;
      };
      const store: Store = {
        append: (key, entries) => {
          const operation = pending.then(async () => {
            const path = subpath(key);
            await assertCurrent();
            if (entries.length > 256) throw new Error("HARNESS_SESSION_BATCH_LIMIT");
            for (const entry of entries) {
              if (!entry || typeof entry.type !== "string" || (entry.uuid !== undefined && (typeof entry.uuid !== "string" || !entry.uuid || entry.uuid.length > 200))) throw unavailable();
              const raw = JSON.stringify(entry);
              if (Buffer.byteLength(raw) > 2_000_000) throw new Error("HARNESS_SESSION_ENTRY_LIMIT");
              const inserted = await client.query(`INSERT INTO harness_session_entries(account_id,harness_session_id,subpath,entry_uuid,body)
                VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(account_id,harness_session_id,subpath,entry_uuid) DO NOTHING RETURNING ordinal`,
                [auth.accountId, current.id, path, entry.uuid ?? null, raw]);
              if (!inserted.rowCount && !(await client.query(`SELECT 1 FROM harness_session_entries
                WHERE account_id=$1 AND harness_session_id=$2 AND subpath=$3 AND entry_uuid=$4 AND body=$5::jsonb`,
                [auth.accountId, current.id, path, entry.uuid, raw])).rowCount) throw new Error("HARNESS_SESSION_ENTRY_CONFLICT");
            }
            const total = (await client.query<{ bytes: string; count: string }>(`SELECT COALESCE(sum(octet_length(body::text)),0) AS bytes,count(*) AS count
              FROM harness_session_entries WHERE account_id=$1 AND harness_session_id=$2`, [auth.accountId, current.id])).rows[0]!;
            if (Number(total.bytes) > 16_000_000 || Number(total.count) > 4000) throw new Error("HARNESS_SESSION_SIZE_LIMIT");
          });
          pending = operation.catch(error => { appendFailure ??= error; });
          return operation;
        },
        load: async key => {
          const path = subpath(key); await assertCurrent();
          const rows = (await client.query<{ body: Entry }>(`SELECT body FROM harness_session_entries
            WHERE account_id=$1 AND harness_session_id=$2 AND subpath=$3 ORDER BY ordinal`, [auth.accountId, current.id, path])).rows;
          return rows.length ? rows.map(row => row.body) : null;
        },
        listSubkeys: async key => {
          subpath(key); await assertCurrent();
          return (await client.query<{ subpath: string }>(`SELECT DISTINCT subpath FROM harness_session_entries
            WHERE account_id=$1 AND harness_session_id=$2 AND subpath<>'' ORDER BY subpath`, [auth.accountId, current.id])).rows.map(row => row.subpath);
        },
        delete: async key => {
          subpath(key); await assertCurrent();
          await client.query("UPDATE harness_sessions SET invalidated_at=clock_timestamp() WHERE account_id=$1 AND id=$2", [auth.accountId, current.id]);
          await client.query("DELETE FROM harness_session_entries WHERE account_id=$1 AND harness_session_id=$2", [auth.accountId, current.id]);
        },
      };
      return { sessionID: current.sdk_session_id, resume: current.committed_turns > 0, store, assertCurrent,
        finish: async completed => {
          if (finished) throw unavailable();
          await pending;
          try {
            if (!completed || appendFailure) {
              await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
              if (completed && appendFailure) throw appendFailure;
              return;
            }
            // Short source/session fences close the last-check-to-commit window.
            await assertCurrent(true);
            const persisted = (await client.query("SELECT 1 FROM harness_session_entries WHERE account_id=$1 AND harness_session_id=$2 AND subpath='' LIMIT 1", [auth.accountId, current.id])).rowCount;
            if (!persisted) throw new Error("HARNESS_SESSION_MIRROR_EMPTY");
            await client.query("UPDATE harness_sessions SET committed_turns=committed_turns+1 WHERE account_id=$1 AND id=$2", [auth.accountId, current.id]);
          } catch (error) {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            throw error;
          } finally { finished = true; await client.query(`RELEASE SAVEPOINT ${savepoint}`); }
        } };
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  };
}
