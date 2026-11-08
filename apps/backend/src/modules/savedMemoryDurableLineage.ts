/** Completed-result Memory metadata. Capture/codec functions grant no access.
 * Registration requires the actual outer canonical completion/source writes on
 * the same held PoolClient. The final joined source/credential fence and actual
 * COMMIT/ACK publication remain the real entry owner's responsibility. */
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabaseClient } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { consumeSessionChatRetentionReceipt, type SessionChatRetentionReceipt } from "./agentSessionSources.js";
import { SAVED_MEMORY_PROOF_MAX_BYTES, SAVED_MEMORY_READ_LIMIT, captureSavedMemoryReadProof,
  captureSavedMemoryStamp, lockSavedMemoryLineageTargets, savedMemoryBudgetLimited, savedMemoryDeadline,
  savedMemoryOwnArray, savedMemoryOwnRecord, savedMemoryUnavailable, savedMemoryUUID,
  type SavedMemoryReadProof, type SavedMemoryStamp } from "./savedMemoryLineage.js";

export interface SavedMemoryDurableProofV2 {
  readonly version: 2;
  readonly account_id: string;
  readonly reader_actor_id: string;
  readonly task_id: string;
  readonly completion_idempotency_id: string;
  readonly retention_kind: "session_bound" | "canonical_no_session";
  readonly source_origin_session_id: string | null;
  readonly expires_at: string | null;
  readonly stamps: readonly Readonly<SavedMemoryStamp>[];
}
export type SavedMemoryRetainedProof = Readonly<SavedMemoryReadProof> | Readonly<SavedMemoryDurableProofV2>;
const KEYS = ["version", "account_id", "reader_actor_id", "task_id", "completion_idempotency_id",
  "retention_kind", "source_origin_session_id", "expires_at", "stamps"] as const;
const AUTH_KEYS = ["accountId", "accountSlug", "userId", "userEmail", "userKind", "sessionId"] as const;

/** Closed metadata codec only. A parsed JSON object is never the private source
 * receipt, proof of a completed task or a granted current reader. */
export function captureSavedMemoryDurableProof(value: unknown): Readonly<SavedMemoryDurableProofV2> {
  const r = savedMemoryOwnRecord(value, KEYS);
  if (r.version !== 2) return savedMemoryUnavailable();
  const stamps = savedMemoryOwnArray(r.stamps, SAVED_MEMORY_READ_LIMIT).map(captureSavedMemoryStamp);
  if (stamps.some((stamp, i) => i > 0 && stamps[i - 1]!.item_id >= stamp.item_id)) return savedMemoryUnavailable();
  let origin: string | null, expiry: string | null;
  if (r.retention_kind === "session_bound") {
    origin = savedMemoryUUID(r.source_origin_session_id); expiry = savedMemoryDeadline(r.expires_at);
  } else if (r.retention_kind === "canonical_no_session" && r.source_origin_session_id === null && r.expires_at === null) {
    origin = null; expiry = null;
  } else return savedMemoryUnavailable();
  const proof: SavedMemoryDurableProofV2 = { version: 2, account_id: savedMemoryUUID(r.account_id),
    reader_actor_id: savedMemoryUUID(r.reader_actor_id), task_id: savedMemoryUUID(r.task_id),
    completion_idempotency_id: savedMemoryUUID(r.completion_idempotency_id), retention_kind: r.retention_kind,
    source_origin_session_id: origin, expires_at: expiry, stamps: Object.freeze(stamps) };
  if (Buffer.byteLength(JSON.stringify(proof), "utf8") > SAVED_MEMORY_PROOF_MAX_BYTES) return savedMemoryBudgetLimited();
  return Object.freeze(proof);
}

/** v1 keeps its original finite schema. Missing/unknown versions never become
 * explicit-zero or unlimited completed results. */
export function captureSavedMemoryRetainedProof(value: unknown): SavedMemoryRetainedProof {
  // Inspect the version through an own-data capture, without invoking hooks.
  const candidate = value && typeof value === "object" ? value : savedMemoryUnavailable();
  // Either complete closed schema is validated below; descriptor access itself
  // is avoided until the shared own-data/proxy guard has captured that schema.
  let v1: Readonly<SavedMemoryReadProof> | undefined;
  try { v1 = captureSavedMemoryReadProof(candidate); } catch { /* try only the other explicit format */ }
  return v1 ?? captureSavedMemoryDurableProof(candidate);
}

/** Fixed ASCII tuple is also recomputed by SQL115. All nine proof fields are
 * bound; the retained source deadline is never a new exposure/query/login TTL. */
export function savedMemoryDurableProofDigest(value: unknown): string {
  const p = captureSavedMemoryDurableProof(value);
  const tuple = ["saved-memory-durable.v2", p.account_id, p.reader_actor_id, p.task_id,
    p.completion_idempotency_id, p.retention_kind, p.source_origin_session_id, p.expires_at,
    p.stamps.map(s => [s.item_id, s.item_version, s.lineage_epoch, s.memory_owner_id, s.scope, s.subject_id, s.relationship_context_id])];
  return createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex");
}

function captureActor(value: AuthContext): AuthContext {
  const r = savedMemoryOwnRecord(value, AUTH_KEYS);
  for (const key of ["accountSlug", "userEmail", "userKind", "sessionId"]) if (typeof r[key] !== "string") return savedMemoryUnavailable();
  r.accountId = savedMemoryUUID(r.accountId); r.userId = savedMemoryUUID(r.userId);
  return Object.freeze(r) as unknown as AuthContext;
}
function transactionID(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value)
    || BigInt(value) > 18_446_744_073_709_551_615n) return savedMemoryUnavailable();
  return value;
}
function captureReader(value: Pick<AuthContext, "accountId" | "userId">) {
  let r: Record<string, unknown>;
  try { r = savedMemoryOwnRecord(value, ["accountId", "userId"]); }
  catch { r = savedMemoryOwnRecord(value, AUTH_KEYS); }
  return Object.freeze({ accountId: savedMemoryUUID(r.accountId), userId: savedMemoryUUID(r.userId) });
}

/** Consume the source owner's private fact and register only AFTER the real
 * canonical completion was written in the caller's existing outer transaction.
 * This operation performs no provider call, pool lease or COMMIT. */
export async function registerSavedMemoryDurableLineage(client: PoolClient, auth: AuthContext,
  exposureValue: unknown, sourceReceipt: SessionChatRetentionReceipt, completionClaimID: string,
): Promise<Readonly<SavedMemoryDurableProofV2>> {
  const current = captureActor(auth), exposure = captureSavedMemoryReadProof(exposureValue);
  const completion = savedMemoryUUID(completionClaimID);
  if (exposure.account_id !== current.accountId || exposure.reader_actor_id !== current.userId) return savedMemoryUnavailable();
  const fact = consumeSessionChatRetentionReceipt(client, current, exposure.task_id, sourceReceipt);
  const retention = savedMemoryOwnRecord(fact.retention,
    fact.retention.kind === "session_bound" ? ["kind", "original_expires_at"] : ["kind"]);
  const durable = captureSavedMemoryDurableProof({ version: 2, account_id: exposure.account_id,
    reader_actor_id: exposure.reader_actor_id, task_id: exposure.task_id, completion_idempotency_id: completion,
    retention_kind: retention.kind, source_origin_session_id: fact.originSessionID,
    expires_at: retention.kind === "session_bound" ? retention.original_expires_at : null, stamps: exposure.stamps });
  // Do not assign a new transaction ID to manufacture a witness. The real
  // source/idempotency completion writes have already assigned the outer xid8.
  const witness = savedMemoryOwnRecord((await client.query<{ transaction_id: unknown }>(
    "SELECT pg_current_xact_id_if_assigned()::text AS transaction_id")).rows[0], ["transaction_id"]);
  const xid = transactionID(witness.transaction_id);
  await client.query("SET LOCAL lock_timeout = '100ms'");
  await lockSavedMemoryLineageTargets(client, exposure);
  const result = savedMemoryOwnRecord((await client.query<{ recorded: unknown }>(
    `SELECT register_saved_memory_durable_lineage($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::timestamptz,$11::xid8) AS recorded`,
    [durable.account_id, durable.reader_actor_id, durable.task_id, durable.completion_idempotency_id,
      durable.retention_kind, durable.source_origin_session_id, durable.expires_at, JSON.stringify(durable.stamps),
      savedMemoryDurableProofDigest(durable), exposure.expires_at, xid],
  )).rows[0], ["recorded"]);
  if (result.recorded !== true) return savedMemoryUnavailable();
  return durable;
}

/** Retained metadata only. The caller must admit the ancestor through the real
 * current canonical source/credential owner before inheriting its original
 * stamps. This query never publishes result prose or grants a new exposure. */
export async function readSavedMemoryRetainedLineage(database: DatabaseClient,
  auth: Pick<AuthContext, "accountId" | "userId">, taskID: string): Promise<SavedMemoryRetainedProof> {
  const current = captureReader(auth);
  const account = savedMemoryUUID(current.accountId), actor = savedMemoryUUID(current.userId), task = savedMemoryUUID(taskID);
  const row = savedMemoryOwnRecord((await database.query<{ proof: unknown; proof_digest: unknown }>(
    `WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at), dependencies AS (
       SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id',d.memory_item_id::text,'item_version',d.item_version,
         'lineage_epoch',d.lineage_epoch::text,'memory_owner_id',d.memory_owner_id::text,'scope',d.scope,
         'subject_id',d.subject_id::text,'relationship_context_id',d.relationship_context_id::text) ORDER BY d.memory_item_id),'[]'::jsonb) AS stamps
       FROM agent_task_memory_dependencies d WHERE d.account_id=$1 AND d.task_id=$3
     ) SELECT t.proof_digest,CASE t.format_version
       WHEN 1 THEN jsonb_build_object('version',1,'account_id',t.account_id::text,'reader_actor_id',t.reader_actor_id::text,
         'task_id',t.task_id::text,'expires_at',to_char(t.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'stamps',d.stamps)
       WHEN 2 THEN jsonb_build_object('version',2,'account_id',t.account_id::text,'reader_actor_id',t.reader_actor_id::text,
         'task_id',t.task_id::text,'completion_idempotency_id',t.completion_idempotency_id::text,'retention_kind',t.retention_kind,
         'source_origin_session_id',t.source_origin_session_id::text,
         'expires_at',CASE WHEN t.expires_at IS NULL THEN NULL ELSE to_char(t.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'stamps',d.stamps)
       ELSE NULL END AS proof FROM agent_task_memory_lineage t CROSS JOIN tick CROSS JOIN dependencies d
       WHERE t.account_id=$1 AND t.task_id=$3 AND t.reader_actor_id=$2
         AND saved_memory_task_current(t.account_id,t.task_id,t.reader_actor_id,tick.checked_at)`, [account, actor, task],
  )).rows[0], ["proof", "proof_digest"]);
  const proof = captureSavedMemoryRetainedProof(row.proof);
  const digest = proof.version === 2 ? savedMemoryDurableProofDigest(proof)
    : createHash("sha256").update(JSON.stringify(proof), "utf8").digest("hex");
  if (row.proof_digest !== digest || proof.account_id !== account || proof.reader_actor_id !== actor || proof.task_id !== task) return savedMemoryUnavailable();
  return proof;
}
