import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { AuthContext } from "./auth.js";
import type { IdempotencyClaim } from "../lib/idempotency.js";
import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";
import { LegacyChatTerminated, type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { captureLegacyChatSourceSnapshot } from "./legacyChatSourceSnapshot.js";
import type { EncodedLegacyChatCheckpoint, LegacyChatCheckpointBinding } from "./legacyChatCheckpoint.js";

export const LEGACY_CHAT_OPERATION = "create_unscoped_chat_task";
export const legacyChatOwnerInstance = randomUUID();
export type LegacyChatExecutionState = "admitted" | "dispatch_started" | "result_ready" | "completed"
  | "cancelled" | "expired" | "authority_lost" | "unknown" | "result_unavailable" | "content_unavailable";
export type LegacyChatTerminalReason = "source_withdrawn" | "credential_lost" | "client_disconnected"
  | "expired" | "lease_lost" | "checkpoint_invalid" | "operator_cancelled" | "commit_unknown";
export interface LegacyChatExecutionRow {
  account_id: string; idempotency_id: string; task_id: string; attempt_id: string;
  request_message_id: string | null;
  state: LegacyChatExecutionState; owner_instance: string; owner_generation: string; owner_nonce: string;
  original_proof: unknown; source_snapshot: unknown; frozen_provider: FrozenProviderDescriptor | null;
  execution_deadline: Date; lease_until: Date; dispatch_started_at: Date | null;
  checkpoint: string | null; checkpoint_bytes: number | null; checkpoint_sha256: string | null;
  checkpoint_expires_at: Date | null; completed_at: Date | null; content_retired_at: Date | null;
  execution_deadline_exact: string;
}
interface FrozenProviderDescriptor {
  providerID: "deepseek-chat-completions"; model: string; configurationDigest: string | null;
}
export interface LegacyChatOwnerToken {
  accountId: string; parentID: string; taskID: string; attemptID: string;
  instance: string; generation: string; nonce: string;
}
export interface LegacyChatAdmission {
  kind: "legacy_durable_owner";
  token: LegacyChatOwnerToken;
  row: LegacyChatExecutionRow;
  provider: RemoteChatAnswerProviding | null;
}
export interface LegacyChatWaiter { kind: "legacy_durable_waiter"; parentID: string }

/** Freeze only the actual selected answer capability, retaining its method
 * receiver. Adapter names do not imply Agent capabilities or known policy. */
export function snapshotEligibleLegacyProvider(provider: RemoteChatAnswerProviding | null):
  { provider: RemoteChatAnswerProviding | null; descriptor: FrozenProviderDescriptor | null } | null {
  if (provider === null) return { provider: null, descriptor: null };
  const actual = provider as RemoteChatAnswerProviding & { run?: unknown };
  if (actual.providerId !== "deepseek-chat-completions" || typeof actual.run === "function"
    || typeof actual.runWithPromptPreset === "function" || actual.supportsImageInput !== false) return null;
  const answer = actual.answer, model = actual.model;
  if (typeof answer !== "function" || typeof model !== "string" || !model.length
    || model.includes("\0") || Buffer.byteLength(model, "utf8") > 256) throw new LegacyChatTerminated();
  const digest = actual.loadedTaskConfiguration?.taskConfigurationDigest ?? null;
  if (digest !== null && (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(digest))) throw new LegacyChatTerminated();
  const descriptor = Object.freeze({ providerID: "deepseek-chat-completions" as const, model, configurationDigest: digest });
  return { descriptor, provider: Object.freeze({ providerId: descriptor.providerID, model,
    supportsImageInput: false, answer: (request: Parameters<RemoteChatAnswerProviding["answer"]>[0]) => Reflect.apply(answer, actual, [request]) }) };
}

const exactDeadline = "to_char(execution_deadline AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS execution_deadline_exact";

export async function admitLegacyChatExecution(client: PoolClient, auth: AuthContext,
  claim: IdempotencyClaim, authority: LegacyChatAuthority,
  selected: NonNullable<ReturnType<typeof snapshotEligibleLegacyProvider>>, messageID?: string): Promise<LegacyChatAdmission> {
  await authority.assertCurrent();
  const proof = authority.snapshotOriginal();
  const deadline = (await client.query<{ deadline: string }>(`SELECT to_char(
    LEAST($1::timestamptz,clock_timestamp()+interval '60 seconds') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deadline`, [proof.originalDeadline])).rows[0]?.deadline;
  if (!deadline) throw new LegacyChatTerminated();
  const source = await captureLegacyChatSourceSnapshot(client, auth, deadline, client);
  await authority.assertCurrent();
  const token: LegacyChatOwnerToken = Object.freeze({ accountId: auth.accountId, parentID: claim.id,
    taskID: randomUUID(), attemptID: randomUUID(), instance: legacyChatOwnerInstance,
    generation: "1", nonce: randomUUID() });
  const result = await client.query<LegacyChatExecutionRow>(`INSERT INTO legacy_chat_executions(
    account_id,idempotency_id,task_id,attempt_id,state,owner_instance,owner_generation,owner_nonce,
    original_proof,source_snapshot,frozen_provider,execution_deadline,lease_until,request_message_id)
    VALUES($1,$2,$3,$4,'admitted',$5,1,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::timestamptz,
      LEAST($10::timestamptz,clock_timestamp()+interval '30 seconds'),$11) RETURNING *,${exactDeadline}`,
  [token.accountId,token.parentID,token.taskID,token.attemptID,token.instance,token.nonce,
    JSON.stringify(proof),JSON.stringify(source),selected.descriptor === null ? null : JSON.stringify(selected.descriptor),deadline,messageID ?? null]);
  const row = result.rows[0];
  if (!row) throw new LegacyChatTerminated();
  return { kind: "legacy_durable_owner", token, row, provider: selected.provider };
}

/** The existing canonical claim has already checked actor/scope/key/body hash.
 * Releasing this admission transaction precedes any waiter polling. */
export async function legacyChatWaiterForClaim(client: PoolClient, auth: AuthContext,
  key: string): Promise<LegacyChatWaiter | null> {
  const row = (await client.query<{ id: string }>(`SELECT p.id FROM idempotency_records p
    JOIN legacy_chat_executions e ON e.account_id=p.account_id AND e.idempotency_id=p.id
    WHERE p.account_id=$1 AND p.actor_user_id=$2 AND p.operation_scope=$3 AND p.idempotency_key=$4`,
  [auth.accountId,auth.userId,LEGACY_CHAT_OPERATION,key])).rows[0];
  return row ? { kind: "legacy_durable_waiter", parentID: row.id } : null;
}

export async function readLegacyChatExecution(client: PoolClient, auth: AuthContext,
  parentID: string): Promise<LegacyChatExecutionRow | null> {
  return (await client.query<LegacyChatExecutionRow>(`SELECT e.*,${exactDeadline}
    FROM legacy_chat_executions e JOIN idempotency_records p
      ON p.account_id=e.account_id AND p.id=e.idempotency_id
    WHERE e.account_id=$1 AND e.idempotency_id=$2 AND p.actor_user_id=$3 AND p.operation_scope=$4`,
  [auth.accountId,parentID,auth.userId,LEGACY_CHAT_OPERATION])).rows[0] ?? null;
}

/** Every advancing caller has already acquired original account/source/reader/
 * Lab fences on this same client. Never take execution before its parent. */
export async function lockLegacyChatExecution(client: PoolClient, auth: AuthContext,
  token: LegacyChatOwnerToken): Promise<LegacyChatExecutionRow> {
  const parent = await client.query(`SELECT id FROM idempotency_records
    WHERE account_id=$1 AND id=$2 AND actor_user_id=$3 AND operation_scope=$4 FOR UPDATE NOWAIT`,
  [auth.accountId,token.parentID,auth.userId,LEGACY_CHAT_OPERATION]);
  if (parent.rowCount !== 1) throw new LegacyChatTerminated();
  const row = (await client.query<LegacyChatExecutionRow>(`SELECT *,${exactDeadline}
    FROM legacy_chat_executions WHERE account_id=$1 AND idempotency_id=$2
      AND attempt_id=$3 AND owner_instance=$4 AND owner_generation=$5::bigint AND owner_nonce=$6
      AND execution_deadline>clock_timestamp() AND lease_until>clock_timestamp() FOR UPDATE NOWAIT`,
  [auth.accountId,token.parentID,token.attemptID,token.instance,token.generation,token.nonce])).rows[0];
  if (!row) throw new LegacyChatTerminated();
  return row;
}

const ownerPredicate = `account_id=$1 AND idempotency_id=$2 AND attempt_id=$3
  AND owner_instance=$4 AND owner_generation=$5::bigint AND owner_nonce=$6
  AND lease_until>clock_timestamp() AND execution_deadline>clock_timestamp()`;
const ownerValues = (token: LegacyChatOwnerToken) => [token.accountId,token.parentID,token.attemptID,
  token.instance,token.generation,token.nonce];
const exactlyOne = (count: number | null) => { if (count !== 1) throw new LegacyChatTerminated(); };

export async function markLegacyChatDispatch(client: PoolClient, token: LegacyChatOwnerToken): Promise<void> {
  exactlyOne((await client.query(`UPDATE legacy_chat_executions SET state='dispatch_started',
    dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE ${ownerPredicate} AND state='admitted'`, ownerValues(token))).rowCount);
}
export async function renewLegacyChatLease(client: PoolClient, token: LegacyChatOwnerToken): Promise<void> {
  exactlyOne((await client.query(`UPDATE legacy_chat_executions SET
    lease_until=LEAST(execution_deadline,clock_timestamp()+interval '30 seconds'),updated_at=clock_timestamp()
    WHERE ${ownerPredicate} AND state='dispatch_started'`, ownerValues(token))).rowCount);
}
export async function storeLegacyChatCheckpoint(client: PoolClient, token: LegacyChatOwnerToken,
  packet: EncodedLegacyChatCheckpoint): Promise<void> {
  exactlyOne((await client.query(`UPDATE legacy_chat_executions SET state='result_ready',checkpoint=$7,
    checkpoint_bytes=$8,checkpoint_sha256=$9,checkpoint_expires_at=execution_deadline,updated_at=clock_timestamp()
    WHERE ${ownerPredicate} AND ((state='admitted' AND frozen_provider IS NULL)
      OR (state='dispatch_started' AND frozen_provider IS NOT NULL))`,
  [...ownerValues(token),packet.json,packet.byteLength,packet.sha256])).rowCount);
}
export async function completeLegacyChatExecution(client: PoolClient, token: LegacyChatOwnerToken): Promise<void> {
  exactlyOne((await client.query(`UPDATE legacy_chat_executions SET state='completed',completed_at=clock_timestamp(),
    original_proof=NULL,source_snapshot=NULL,checkpoint=NULL,checkpoint_bytes=NULL,
    checkpoint_sha256=NULL,checkpoint_expires_at=NULL,updated_at=clock_timestamp()
    WHERE ${ownerPredicate} AND state='result_ready' AND checkpoint_expires_at>clock_timestamp()`, ownerValues(token))).rowCount);
}
/** Explicit recovery can acquire only an existing durable result from a lost
 * lease. It changes owner generation/nonce, never attempt/task/provider/proof. */
export async function adoptLegacyChatCheckpoint(client: PoolClient, auth: AuthContext,
  expected: LegacyChatExecutionRow): Promise<LegacyChatOwnerToken> {
  if ((await client.query(`SELECT id FROM idempotency_records WHERE account_id=$1 AND id=$2
    AND actor_user_id=$3 AND operation_scope=$4 FOR UPDATE NOWAIT`,
  [auth.accountId,expected.idempotency_id,auth.userId,LEGACY_CHAT_OPERATION])).rowCount !== 1) throw new LegacyChatTerminated();
  const locked = (await client.query<{ owner_generation: string }>(`SELECT owner_generation
    FROM legacy_chat_executions WHERE account_id=$1 AND idempotency_id=$2 AND attempt_id=$3
      AND owner_instance=$4 AND owner_generation=$5::bigint AND owner_nonce=$6
      AND state='result_ready' AND execution_deadline>clock_timestamp()
      AND checkpoint_expires_at>clock_timestamp() AND lease_until<=clock_timestamp() FOR UPDATE NOWAIT`,
  [auth.accountId,expected.idempotency_id,expected.attempt_id,expected.owner_instance,
    expected.owner_generation,expected.owner_nonce])).rows[0];
  if (!locked) throw new LegacyChatTerminated();
  const nonce = randomUUID();
  const result = (await client.query<{ owner_generation: string }>(`UPDATE legacy_chat_executions SET
    owner_instance=$7,owner_generation=owner_generation+1,owner_nonce=$8,
    lease_until=LEAST(execution_deadline,clock_timestamp()+interval '30 seconds'),updated_at=clock_timestamp()
    WHERE account_id=$1 AND idempotency_id=$2 AND attempt_id=$3 AND owner_instance=$4
      AND owner_generation=$5::bigint AND owner_nonce=$6 AND state='result_ready'
      AND lease_until<=clock_timestamp() AND execution_deadline>clock_timestamp()
      AND checkpoint_expires_at>clock_timestamp() RETURNING owner_generation`,
  [auth.accountId,expected.idempotency_id,expected.attempt_id,expected.owner_instance,
    expected.owner_generation,expected.owner_nonce,legacyChatOwnerInstance,nonce])).rows[0];
  if (!result) throw new LegacyChatTerminated();
  return Object.freeze({ accountId: auth.accountId,parentID: expected.idempotency_id,taskID: expected.task_id,
    attemptID: expected.attempt_id,instance: legacyChatOwnerInstance,generation: result.owner_generation,nonce });
}
export function legacyChatCheckpointBinding(row: LegacyChatExecutionRow): LegacyChatCheckpointBinding {
  return { taskID: row.task_id, provider: row.frozen_provider === null ? null : {
    providerID: row.frozen_provider.providerID, model: row.frozen_provider.model } };
}
