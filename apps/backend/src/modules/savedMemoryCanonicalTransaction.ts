import type { Pool, PoolClient } from "pg";
import { ApiError } from "../lib/apiError.js";
import { measureLabServerStage } from "../lib/labDiagnostics.js";
import { assertLegacyCanonicalPool, type LegacyChatAuthority } from "./legacyChatAuthority.js";

// Registered only between BEGIN and the end of the real borrow's operation.
const canonicalBorrows = new WeakMap<PoolClient, { pool: Pool; owner: LegacyChatAuthority; claimed: boolean }>();

export function canonicalBorrowOwner(client: PoolClient) {
  return canonicalBorrows.get(client)?.owner;
}

export function claimCanonicalBorrow(pool: Pool, owner: LegacyChatAuthority, client: PoolClient): boolean {
  const borrow = canonicalBorrows.get(client);
  if (!borrow || borrow.pool !== pool || borrow.owner !== owner || borrow.claimed) return false;
  borrow.claimed = true;
  return true;
}

/** A sent COMMIT failed to acknowledge. This is never a rollback receipt. */
export class SavedMemoryCanonicalCommitUnknown extends ApiError {
  constructor() {
    super(503, "SAVED_MEMORY_COMMIT_UNKNOWN", "保存结果尚未确认，请使用同一请求重试以检查保存状态。");
  }
}

function connectionUnavailable(): ApiError {
  return new ApiError(503, "SAVED_MEMORY_DATABASE_UNAVAILABLE", "暂时无法检查保存状态，请使用同一请求重试。");
}

async function borrow(pool: Pool): Promise<PoolClient> {
  let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
  const pending = pool.connect().then(client => {
    if (expired) { client.release(); throw connectionUnavailable(); }
    return client;
  });
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { expired = true; reject(connectionUnavailable()); }, 2_000);
      timer.unref?.();
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

function commitCommand(ack: unknown): unknown {
  if (!ack || typeof ack !== "object") return undefined;
  try { return Object.getOwnPropertyDescriptor(ack, "command")?.value; }
  catch { return undefined; }
}

/** Narrow atomic-path transport adapter; not a source or authorization owner.
 * The caller must run its actual authority.withClient/source/SQL operation.
 * governed is the host's private result classifier, never a permission grant.
 * No provider/model work is retried here and no SQL timeout is replaced. */
export async function inSavedMemoryCanonicalTransaction<T>(pool: Pool, authority: LegacyChatAuthority,
  operation: (client: PoolClient) => Promise<T>, governed: (result: T) => boolean,
  options: { boundedBorrow?: boolean } = {}): Promise<T> {
  assertLegacyCanonicalPool(authority, pool);
  const client = await measureLabServerStage("database_connection", () => options.boundedBorrow === false ? pool.connect() : borrow(pool));
  let protectedResult = false, commitSent = false, discard = false;
  try {
    await client.query("BEGIN");
    canonicalBorrows.set(client, { pool, owner: authority, claimed: false });
    let result: T;
    try { result = await operation(client); }
    finally { canonicalBorrows.delete(client); }
    protectedResult = governed(result);
    if (protectedResult) authority.throwIfTerminated();
    commitSent = true;
    let ack: unknown;
    try { ack = await measureLabServerStage("database_commit", () => client.query("COMMIT")); }
    catch (error) {
      if (protectedResult) { discard = true; throw new SavedMemoryCanonicalCommitUnknown(); }
      throw error;
    }
    if (protectedResult) {
      const command = commitCommand(ack);
      if (command !== "COMMIT") {
        discard = true;
        if (command === "ROLLBACK") {
          throw new ApiError(409, "SAVED_MEMORY_COMPLETION_NOT_COMMITTED", "本次结果未保存，请使用同一请求重试。");
        }
        throw new SavedMemoryCanonicalCommitUnknown();
      }
    }
    // A known ACK can outlive the original clock. Never roll it back or deliver
    // through an expired owner; the caller resolves retries by canonical read.
    if (protectedResult) authority.throwIfTerminated();
    return result;
  } catch (error) {
    // Ungoverned results retain pool.inTransaction's rollback/error semantics,
    // including rollback failure taking precedence over the original error.
    if (!protectedResult || !commitSent) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (discard) client.release(true);
    else client.release();
  }
}
