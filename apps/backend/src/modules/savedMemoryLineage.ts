/** Host-only admitted Memory metadata. Never construct this from provider prose,
 * request JSON or a missing historical dependency record. Publication must use
 * the same PoolClient/transaction as its canonical result, after existing fences. */
import { createHash } from "node:crypto";
import { types } from "node:util";
import type { PoolClient } from "pg";
import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";

export const SAVED_MEMORY_READ_LIMIT = 256;
export const SAVED_MEMORY_PROOF_MAX_BYTES = 128 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const EPOCH = /^[1-9][0-9]{0,18}$/;
const STAMP_KEYS = ["item_id", "item_version", "lineage_epoch", "memory_owner_id", "scope", "subject_id", "relationship_context_id"] as const;
export interface SavedMemoryStamp {
  readonly item_id: string;
  readonly item_version: number;
  readonly lineage_epoch: string;
  readonly memory_owner_id: string;
  readonly scope: "self" | "person" | "relationship";
  readonly subject_id: string | null;
  readonly relationship_context_id: string | null;
}
export interface SavedMemoryReadProof {
  readonly version: 1;
  readonly account_id: string;
  readonly reader_actor_id: string;
  readonly task_id: string;
  readonly expires_at: string;
  readonly stamps: readonly SavedMemoryStamp[];
}
export interface SavedMemoryAuthority {
  readonly auth: Readonly<Pick<AuthContext, "accountId" | "userId">>;
  readonly taskID: string;
  /** Original server/DB deadline, never a new lifetime supplied by a model. */
  readonly expiresAt: string;
  /** Real current login/claim + source authority supplied by the owning entry.
   * No label/provider id/sentinel can implement this authority. */
  readonly assertCurrent: () => Promise<void>;
}
/** Freeze the binding, not a permission. Only the actual owning entry can
 * supply the live assertion; no provider/request object is accepted here. */
export function captureSavedMemoryAuthority(value: SavedMemoryAuthority): SavedMemoryAuthority {
  const r = savedMemoryOwnRecord(value, ["auth", "taskID", "expiresAt", "assertCurrent"]);
  if (!r.auth || typeof r.auth !== "object" || types.isProxy(r.auth) || typeof r.assertCurrent !== "function") return savedMemoryUnavailable();
  const account = Object.getOwnPropertyDescriptor(r.auth, "accountId"), user = Object.getOwnPropertyDescriptor(r.auth, "userId");
  if (!account || !("value" in account) || !user || !("value" in user)) return savedMemoryUnavailable();
  return Object.freeze({ auth: Object.freeze({ accountId: savedMemoryUUID(account.value), userId: savedMemoryUUID(user.value) }),
    taskID: savedMemoryUUID(r.taskID), expiresAt: savedMemoryDeadline(r.expiresAt),
    assertCurrent: (r.assertCurrent as () => Promise<void>).bind(value) });
}
export function savedMemoryUnavailable(): never {
  throw new ApiError(409, "SAVED_MEMORY_UNAVAILABLE", "The saved Memory context is no longer available. Read the current source again.");
}
export function savedMemoryBudgetLimited(): never {
  throw new ApiError(413, "SAVED_MEMORY_BUDGET_LIMITED", "The current Run cannot admit another complete saved Memory page.");
}
export function savedMemoryOwnRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return savedMemoryUnavailable();
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return savedMemoryUnavailable();
    const names = Reflect.ownKeys(value);
    if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) return savedMemoryUnavailable();
    const out: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const slot = Object.getOwnPropertyDescriptor(value, key);
      if (!slot || !("value" in slot) || !slot.enumerable) return savedMemoryUnavailable();
      out[key] = slot.value;
    }
    return out;
  } catch { return savedMemoryUnavailable(); }
}
export function savedMemoryOwnArray(value: unknown, limit: number): unknown[] {
  try {
    if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return savedMemoryUnavailable();
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > limit || Reflect.ownKeys(value).length !== length + 1) return savedMemoryUnavailable();
    const output: unknown[] = [];
    for (let i = 0; i < length; i++) {
      const slot = Object.getOwnPropertyDescriptor(value, String(i));
      if (!slot || !("value" in slot) || !slot.enumerable) return savedMemoryUnavailable();
      output.push(slot.value);
    }
    return output;
  } catch { return savedMemoryUnavailable(); }
}
export function savedMemoryUUID(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) return savedMemoryUnavailable();
  return value;
}
export function savedMemoryDeadline(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/.test(value)
    || value.startsWith("0000") || !Number.isFinite(Date.parse(value))
    || new Date(Date.parse(value)).toISOString().slice(0, 19) !== value.slice(0, 19)) return savedMemoryUnavailable();
  // Date is used only for calendar syntax, never to compare/round this deadline.
  return value;
}
export function captureSavedMemoryStamp(value: unknown): Readonly<SavedMemoryStamp> {
  const r = savedMemoryOwnRecord(value, STAMP_KEYS);
  if (!Number.isSafeInteger(r.item_version) || (r.item_version as number) < 1 || (r.item_version as number) > 2147483647
    || typeof r.lineage_epoch !== "string" || !EPOCH.test(r.lineage_epoch)
    || BigInt(r.lineage_epoch) > 9223372036854775807n
    || !["self", "person", "relationship"].includes(r.scope as string)) return savedMemoryUnavailable();
  const subject = r.subject_id === null ? null : savedMemoryUUID(r.subject_id);
  const context = r.relationship_context_id === null ? null : savedMemoryUUID(r.relationship_context_id);
  if ((r.scope === "self" && (subject !== null || context !== null))
    || (r.scope === "person" && (subject === null || context !== null))
    || (r.scope === "relationship" && (subject === null || context === null))) return savedMemoryUnavailable();
  return Object.freeze({ item_id: savedMemoryUUID(r.item_id), item_version: r.item_version as number,
    lineage_epoch: r.lineage_epoch, memory_owner_id: savedMemoryUUID(r.memory_owner_id),
    scope: r.scope as SavedMemoryStamp["scope"], subject_id: subject, relationship_context_id: context });
}
export function captureSavedMemoryReadProof(value: unknown): Readonly<SavedMemoryReadProof> {
  const r = savedMemoryOwnRecord(value, ["version", "account_id", "reader_actor_id", "task_id", "expires_at", "stamps"]);
  if (r.version !== 1) return savedMemoryUnavailable();
  const stamps = savedMemoryOwnArray(r.stamps, SAVED_MEMORY_READ_LIMIT).map(captureSavedMemoryStamp);
  if (new Set(stamps.map(item => item.item_id)).size !== stamps.length
    || stamps.some((item, i) => i > 0 && stamps[i - 1]!.item_id >= item.item_id)) return savedMemoryUnavailable();
  const proof: SavedMemoryReadProof = { version: 1, account_id: savedMemoryUUID(r.account_id),
    reader_actor_id: savedMemoryUUID(r.reader_actor_id), task_id: savedMemoryUUID(r.task_id),
    expires_at: savedMemoryDeadline(r.expires_at), stamps: Object.freeze(stamps) };
  if (Buffer.byteLength(JSON.stringify(proof), "utf8") > SAVED_MEMORY_PROOF_MAX_BYTES) return savedMemoryBudgetLimited();
  return Object.freeze(proof);
}
function binding(authority: SavedMemoryAuthority, proof: SavedMemoryReadProof) {
  if (proof.account_id !== authority.auth.accountId || proof.reader_actor_id !== authority.auth.userId
    || proof.task_id !== authority.taskID || proof.expires_at !== authority.expiresAt) return savedMemoryUnavailable();
}
function stampJSON(stamps: readonly SavedMemoryStamp[]) { return JSON.stringify(stamps); }

/** Only capture epochs selected in the SAME source query as the exposed text.
 * Requerying a new epoch after returning old text would give that old text a new
 * authority. Recall/self-core wiring must preserve that original tuple. */
export class SavedMemoryReadSet {
  private readonly items = new Map<string, Readonly<SavedMemoryStamp>>();
  private sealed = false;
  private readonly authority: SavedMemoryAuthority;
  constructor(authority: SavedMemoryAuthority) { this.authority = captureSavedMemoryAuthority(authority); }
  admit(values: readonly SavedMemoryStamp[]): void {
    if (this.sealed) return savedMemoryUnavailable();
    const captured = savedMemoryOwnArray(values, SAVED_MEMORY_READ_LIMIT).map(captureSavedMemoryStamp);
    const next = new Map(this.items);
    for (const stamp of captured) {
      const before = next.get(stamp.item_id);
      if (before && JSON.stringify(before) !== JSON.stringify(stamp)) return savedMemoryUnavailable();
      next.set(stamp.item_id, stamp);
    }
    if (next.size > SAVED_MEMORY_READ_LIMIT) return savedMemoryBudgetLimited();
    // Commit the whole page's metadata only after capacity/conflict checks.
    this.items.clear(); for (const [key, value] of next) this.items.set(key, value);
  }
  inherit(value: unknown): void {
    const proof = captureSavedMemoryReadProof(value);
    if (proof.account_id !== this.authority.auth.accountId || proof.reader_actor_id !== this.authority.auth.userId) return savedMemoryUnavailable();
    // The caller must already have admitted that original task's source/TTL.
    this.admit(proof.stamps);
  }
  snapshot(): Readonly<SavedMemoryReadProof> {
    return captureSavedMemoryReadProof({ version: 1, account_id: this.authority.auth.accountId,
      reader_actor_id: this.authority.auth.userId, task_id: this.authority.taskID,
      expires_at: this.authority.expiresAt, stamps: [...this.items.values()].sort((a, b) => a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0) });
  }
  seal(): Readonly<SavedMemoryReadProof> { this.sealed = true; return this.snapshot(); }
  async assertCurrent(database: DatabaseClient): Promise<void> {
    await this.authority.assertCurrent();
    await assertSavedMemoryProofCurrent(database, this.authority, this.snapshot());
    await this.authority.assertCurrent();
  }
}

export async function assertSavedMemoryProofCurrent(database: DatabaseClient, authority: SavedMemoryAuthority,
  value: unknown): Promise<void> {
  const proof = captureSavedMemoryReadProof(value); binding(authority, proof);
  const row = (await database.query<{ available: boolean }>(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
    SELECT saved_memory_read_set_current($1,$2,$3::jsonb,$4::timestamptz,tick.checked_at) AS available FROM tick`,
    [proof.account_id, proof.reader_actor_id, stampJSON(proof.stamps), proof.expires_at])).rows[0];
  if (row?.available !== true) return savedMemoryUnavailable();
}

/** Caller owns account/source/claim locks and the canonical publication Tx.
 * New locks are short, deterministic and NOWAIT; no model/network await here.
 * Targets -> items -> evidence -> epochs, then the caller's final live-auth
 * envelope. Mutations holding a reverse source order abort instead of waiting. */
export async function registerSavedMemoryLineage(client: PoolClient, authority: SavedMemoryAuthority,
  value: unknown): Promise<void> {
  const proof = captureSavedMemoryReadProof(value); binding(authority, proof);
  const ids = proof.stamps.map(stamp => stamp.item_id);
  const people = [...new Set(proof.stamps.flatMap(stamp => stamp.subject_id ? [stamp.subject_id] : []))].sort();
  const contexts = [...new Set(proof.stamps.flatMap(stamp => stamp.relationship_context_id ? [stamp.relationship_context_id] : []))].sort();
  await client.query("SELECT id FROM subjects WHERE account_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE NOWAIT", [proof.account_id, people]);
  await client.query("SELECT id FROM assignments WHERE account_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE NOWAIT", [proof.account_id, contexts]);
  await client.query("SELECT id FROM memory_items WHERE account_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE NOWAIT", [proof.account_id, ids]);
  await client.query("SELECT id FROM memory_item_evidence WHERE account_id=$1 AND memory_item_id=ANY($2::uuid[]) ORDER BY id FOR SHARE NOWAIT", [proof.account_id, ids]);
  await client.query("SELECT memory_item_id FROM memory_item_lineage WHERE account_id=$1 AND memory_item_id=ANY($2::uuid[]) ORDER BY memory_item_id FOR SHARE NOWAIT", [proof.account_id, ids]);
  await assertSavedMemoryProofCurrent(client, authority, proof);
  const json = JSON.stringify(proof), digest = createHash("sha256").update(json, "utf8").digest("hex");
  const recorded = (await client.query<{ recorded: boolean }>(`SELECT register_saved_memory_lineage($1,$2,$3,$4::timestamptz,$5::jsonb,$6) AS recorded`,
    [proof.account_id, proof.reader_actor_id, proof.task_id, proof.expires_at, stampJSON(proof.stamps), digest])).rows[0];
  if (recorded?.recorded !== true) return savedMemoryUnavailable();
  // The real owner performs its joint source/login/claim final fence while
  // these locks remain held, immediately before canonical COMMIT/publication.
}

/** A missing old format is UNKNOWN, never an empty independent read-set. */
export async function readSavedMemoryLineage(database: DatabaseClient, auth: Pick<AuthContext, "accountId" | "userId">,
  taskID: string): Promise<Readonly<SavedMemoryReadProof>> {
  savedMemoryUUID(taskID);
  const row = (await database.query<{ proof: unknown; proof_digest: string }>(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
    SELECT t.proof_digest,jsonb_build_object('version',1,'account_id',t.account_id::text,
    'reader_actor_id',t.reader_actor_id::text,'task_id',t.task_id::text,
    'expires_at',to_char(t.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'stamps',COALESCE((SELECT jsonb_agg(jsonb_build_object('item_id',d.memory_item_id::text,'item_version',d.item_version,
      'lineage_epoch',d.lineage_epoch::text,'memory_owner_id',d.memory_owner_id::text,'scope',d.scope,
      'subject_id',d.subject_id::text,'relationship_context_id',d.relationship_context_id::text) ORDER BY d.memory_item_id)
      FROM agent_task_memory_dependencies d WHERE d.account_id=t.account_id AND d.task_id=t.task_id),'[]'::jsonb)) AS proof
    FROM agent_task_memory_lineage t CROSS JOIN tick WHERE t.account_id=$1 AND t.reader_actor_id=$2 AND t.task_id=$3
      AND t.format_version=1 AND t.withdrawn_at IS NULL AND t.expires_at>tick.checked_at
      AND saved_memory_task_current(t.account_id,t.task_id,t.reader_actor_id,tick.checked_at)`, [auth.accountId, auth.userId, taskID])).rows[0];
  if (!row) return savedMemoryUnavailable();
  const r = savedMemoryOwnRecord(row, ["proof", "proof_digest"]), proof = captureSavedMemoryReadProof(r.proof);
  if (r.proof_digest !== createHash("sha256").update(JSON.stringify(proof), "utf8").digest("hex")) return savedMemoryUnavailable();
  return proof;
}

/** The existing Session/fork owner calls this within its own canonical Tx,
 * after checking original source/task retention and before its final fence.
 * Routing is never authority and never changes the original dependency set. */
export async function recordSavedMemorySessionCopy(client: PoolClient, auth: Pick<AuthContext, "accountId" | "userId">,
  taskID: string, sessionID: string): Promise<void> {
  const row = (await client.query<{ recorded: boolean }>("SELECT record_saved_memory_session_copy($1,$2,$3,$4) AS recorded",
    [savedMemoryUUID(auth.accountId), savedMemoryUUID(auth.userId), savedMemoryUUID(taskID), savedMemoryUUID(sessionID)])).rows[0];
  if (row?.recorded !== true) return savedMemoryUnavailable();
}
