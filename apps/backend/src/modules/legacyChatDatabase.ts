import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import type { DatabaseClient } from "../database/pool.js";
import type { LegacyChatAuthority } from "./legacyChatAuthority.js";
import { LegacyChatTerminated } from "./legacyChatAuthority.js";
import { createLegacyChatOwnerGate } from "./legacyChatOwner.js";

/** COMMIT was sent; an exception cannot prove whether it committed. Callers
 * resolve only from the canonical same-attempt row, never repeat the RPC. */
export class LegacyChatCommitUnknown extends Error {
  constructor() { super("LEGACY_CHAT_COMMIT_UNKNOWN"); }
}

async function borrow(pool: Pool): Promise<PoolClient> {
  let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
  const pending = pool.connect().then(client => {
    if (expired) { client.release(); throw new LegacyChatTerminated(); }
    return client;
  });
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { expired = true; reject(new LegacyChatTerminated()); }, 2_000);
      timer.unref?.();
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** New authority-reducing owners have a finite acquisition bound too. They
 * deliberately require no dead original credential; a late checkout is only
 * released, and an unacknowledged COMMIT is never described as rollback. */
export async function inLegacyChatRetirementTransaction<T>(pool: Pool,
  operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await borrow(pool);
  let began = false,commitSent = false,discard = false;
  try {
    await client.query("BEGIN"); began = true;
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SET LOCAL statement_timeout='5s'");
    const result = await operation(client);
    commitSent = true;
    try { await client.query("COMMIT"); }
    catch { discard = true; throw new LegacyChatCommitUnknown(); }
    return result;
  } catch (error) {
    if (began && !commitSent) { try { await client.query("ROLLBACK"); } catch { discard = true; } }
    throw error;
  } finally { client.release(discard); }
}

/** Only the durable answer-only owner uses this facade. Ordinary and ineligible
 * legacy transactions keep their original PoolClient/probe construction. */
export function createLegacyChatDatabase(pool: Pool, authority: LegacyChatAuthority) {
  const gate = createLegacyChatOwnerGate(), context = new AsyncLocalStorage<PoolClient>();
  // Only a server-owned synchronous guard may use this hook. It runs after
  // withClient's final credential await, without yielding before COMMIT.
  const run = <T>(operation: (client: PoolClient) => Promise<T>, transaction = true,
    beforeCommit?: () => void): Promise<T> => gate(async () => {
    const client = await borrow(pool);
    let began = false, commitSent = false, discard = false;
    try {
      if (transaction) {
        await client.query("BEGIN"); began = true;
        await client.query("SET LOCAL lock_timeout='2s'");
        await client.query("SET LOCAL statement_timeout='5s'");
      }
      const value = await authority.withClient(client, guarded => context.run(guarded, () => operation(guarded)));
      if (transaction) {
        beforeCommit?.();
        authority.throwIfTerminated();
        commitSent = true;
        try { await client.query("COMMIT"); }
        catch { discard = true; throw new LegacyChatCommitUnknown(); }
      }
      return value;
    } catch (error) {
      if (began && !commitSent) {
        try { await client.query("ROLLBACK"); } catch { discard = true; }
      }
      throw error;
    } finally { client.release(discard); }
  });
  const query = async (...args: unknown[]) => {
    const read = async (client: PoolClient) => {
      await authority.assertCurrent(); // Original proof only; not recursive source callbacks.
      const value = await Reflect.apply(client.query, client, args);
      await authority.assertCurrent();
      return value;
    };
    const current = context.getStore();
    return current ? read(current) : run(read, false);
  };
  const database = { query } as unknown as DatabaseClient;
  return { database, run };
}
