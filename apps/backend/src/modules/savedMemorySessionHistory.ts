/** Prepared host data only. A receipt proves which real SELECT produced an
 * immutable frame; it is not authentication or permission to expose that frame.
 * The actual private Legacy Run owner must consume it and run its joined fence. */
import { types } from "node:util";
import type { ConversationMessage } from "@talent-signal/agent";
import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import type { LegacyChatAuthority } from "./legacyChatAuthority.js";
import { snapshotLegacyChatAuth } from "./legacyChatOriginalProof.js";
import { readHarnessRunSourceBinding, type HarnessRunSourceHandle,
  type HarnessRunSourceBinding } from "./harnessSourceGuard.js";
import { boundedConversationHistory } from "./chatAnswerProvider.js";
import { captureSavedMemoryDurableProof, savedMemoryDurableProofDigest,
  type SavedMemoryDurableProofV2 } from "./savedMemoryDurableLineage.js";
import { savedMemoryDeadline, savedMemoryOwnArray, savedMemoryOwnRecord, savedMemoryUUID } from "./savedMemoryLineage.js";
import { legacySavedMemoryMicroseconds } from "./legacySavedMemoryDomain.js";

const MAX_FRAME_BYTES = 512 * 1024;
const MAX_ANCESTOR_BYTES = 128 * 1024;
declare const sessionHistoryReceiptBrand: unique symbol;
export interface SavedMemorySessionHistoryReceipt { readonly [sessionHistoryReceiptBrand]: true }
export interface SavedMemorySessionHistoryAncestor {
  readonly taskID: string;
  readonly completionID: string;
  readonly bodyDigest: string;
  readonly proofDigest: string;
  readonly proof: Readonly<SavedMemoryDurableProofV2>;
  readonly sourceTaskExpiresAt: string | null;
}
export interface SavedMemorySessionHistoryFacts {
  readonly accountId: string;
  readonly userId: string;
  readonly sessionID: string;
  readonly taskID: string;
  readonly runID: string;
  readonly source: Readonly<HarnessRunSourceBinding>;
  readonly checkedAt: string;
  readonly readUntil: string;
  readonly messages: readonly Readonly<ConversationMessage>[];
  readonly ancestors: readonly Readonly<SavedMemorySessionHistoryAncestor>[];
  /** Explicitly unavailable, never a certified empty Memory dependency set.
   * The current Legacy inheritance contract refuses any nonempty list. */
  readonly unavailableAssistantTaskIDs: readonly string[];
}
interface ReceiptState {
  owner: LegacyChatAuthority; auth: Readonly<AuthContext>; database: DatabaseClient;
  facts: Readonly<SavedMemorySessionHistoryFacts>; deadline: number; consumed: boolean;
}
const receipts = new WeakMap<object, ReceiptState>();
const foreignErrors = new WeakSet<object>();
class HistoryUnavailable extends ApiError {
  constructor() { super(409, "SAVED_MEMORY_SESSION_HISTORY_UNAVAILABLE", "The original Session history is not available for this Run."); }
}
class HistoryBudgetLimited extends ApiError {
  constructor() { super(413, "SAVED_MEMORY_BUDGET_LIMITED", "The current Run cannot admit the complete Session history frame."); }
}
const unavailable = (): never => { throw new HistoryUnavailable(); };
/** Read-only foreign identity preflight, before any owner's phase/clock guard.
 * Own and unknown receipts return false without conferring any authority. */
export function isForeignSessionHistoryReceipt(receipt: SavedMemorySessionHistoryReceipt,
  owner: LegacyChatAuthority): boolean {
  const entry = receipts.get(receipt);
  return entry !== undefined && entry.owner !== owner;
}
/** Static errors minted by this module only. Structural codes never identify
 * a genuine foreign receipt; the actual owner decides its terminal policy. */
export function isForeignSessionHistoryReceiptError(error: unknown): boolean {
  return error !== null && typeof error === "object" && foreignErrors.has(error);
}
/** Data-source identity only. The actual Legacy owner compares this against
 * its private pool/active/guarded client; a caller-provided SQL callback or
 * allowlist cannot substitute for that owner-side provenance check. */
export function sessionHistoryReceiptUsesDatabase(receipt: SavedMemorySessionHistoryReceipt,
  owner: LegacyChatAuthority, database: DatabaseClient): boolean {
  const entry = receipts.get(receipt);
  return entry !== undefined && entry.owner === owner && entry.database === database;
}

/** Existing inline suffix selection, shared by the actual Session reader.
 * Pure shaping only; it grants no source or reader authority. */
export function boundInlineAgentSessionMessages<T extends { text: string }>(messages: readonly T[]): T[] {
  let remaining = 12000;
  return [...messages].reverse().map(message => {
    const text = message.text.slice(0, remaining);
    remaining -= text.length;
    return { ...message, text };
  }).filter(message => message.text.length > 0).reverse();
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) return unavailable();
  return value;
}
function text(value: unknown, limit = MAX_FRAME_BYTES): string {
  if (typeof value !== "string") return unavailable();
  if (Buffer.byteLength(value, "utf8") > limit) throw new HistoryBudgetLimited();
  return value;
}

// One real statement: original source binding, human prose, canonical assistant
// text and its original retained tuples share the same snapshot and tick.
// Neither client cached assistant blocks nor a later epoch lookup is used.
const historySQL = `WITH tick AS MATERIALIZED (SELECT statement_timestamp() AS checked_at),
 admitted AS MATERIALIZED (
   SELECT product.payload,product.expires_at,login.expires_at AS login_expires_at,
     jsonb_build_object('accountId',product.account_id::text,'userId',product.created_by_user_id::text,
       'sessionID',product.id::text,'generation',COALESCE(g.generation,0)::text,
       'sessionStamp',md5(jsonb_build_array(product.payload->'turns',product.payload->'personID',product.payload->'relationshipContextID')::text),
       'sessionExpiresAt',$5::jsonb->'sessionExpiresAt','sourceExpiresAt',$5::jsonb->'sourceExpiresAt',
       'personIDs',$5::jsonb->'personIDs') AS source
   FROM agent_sessions product JOIN accounts a ON a.id=product.account_id AND a.retired_at IS NULL
   JOIN users u ON u.account_id=product.account_id AND u.id=product.created_by_user_id AND u.status='active' AND u.kind='password_human'
   JOIN sessions login ON login.account_id=u.account_id AND login.user_id=u.id AND login.id=$3::uuid
     AND login.revoked_at IS NULL
   CROSS JOIN tick LEFT JOIN harness_source_generations g ON g.account_id=product.account_id
   WHERE product.account_id=$1 AND product.created_by_user_id=$2 AND product.id=$4::uuid
     AND product.deleted_at IS NULL AND product.expires_at>tick.checked_at
     AND login.expires_at>tick.checked_at
     AND product.payload->>'personID' IS NULL AND product.payload->>'relationshipContextID' IS NULL
     AND jsonb_typeof(product.payload->'turns')='array'
     AND COALESCE(g.generation,0)::text=$5::jsonb->>'generation'
     AND md5(jsonb_build_array(product.payload->'turns',product.payload->'personID',product.payload->'relationshipContextID')::text)=$5::jsonb->>'sessionStamp'
     AND ($5::jsonb->>'sourceExpiresAt')::timestamptz>tick.checked_at
     AND ($5::jsonb->>'sessionExpiresAt')::timestamptz>tick.checked_at
     AND NOT EXISTS (SELECT 1 FROM identity_handles h WHERE h.account_id=$1
       AND h.subject_id IN (SELECT value::uuid FROM jsonb_array_elements_text($5::jsonb->'personIDs'))
       AND h.status='confirmed' AND h.valid_until<=tick.checked_at)
 ), turns AS MATERIALIZED (
   SELECT turn,ordinal,admitted.payload FROM admitted,
     jsonb_array_elements(admitted.payload->'turns') WITH ORDINALITY selected(turn,ordinal)
   ORDER BY ordinal DESC LIMIT 6
 ), captured AS MATERIALIZED (
   SELECT turns.*,lower(turn->'response'->>'taskID') AS task_id,
     canonical.id AS completion_id,canonical.response_body,canonical.operation_scope,
     canonical.candidate_count,t.proof_digest,t.format_version,t.retention_kind,t.source_origin_session_id,
     t.expires_at AS retained_expiry,c.expires_at AS source_expiry,
     CASE WHEN t.format_version=2 THEN jsonb_build_object('version',2,'account_id',t.account_id::text,
       'reader_actor_id',t.reader_actor_id::text,'task_id',t.task_id::text,
       'completion_idempotency_id',t.completion_idempotency_id::text,'retention_kind',t.retention_kind,
       'source_origin_session_id',t.source_origin_session_id::text,
       'expires_at',CASE WHEN t.expires_at IS NULL THEN NULL ELSE to_char(t.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
       'stamps',d.stamps) ELSE NULL END AS proof,
     COALESCE(canonical.operation_scope='create_unscoped_chat_task' AND canonical.candidate_count=1
       AND canonical.id=t.completion_idempotency_id AND t.reader_actor_id=$2 AND t.format_version=2
       AND saved_memory_task_current($1,t.task_id,$2,tick.checked_at)
       AND t.proof_digest=saved_memory_durable_digest_115(t.account_id,t.reader_actor_id,t.task_id,t.completion_idempotency_id,
         t.retention_kind,t.source_origin_session_id,CASE WHEN t.expires_at IS NULL THEN NULL ELSE
           to_char(t.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,d.stamps)
       AND ((t.retention_kind='canonical_no_session' AND c.task_id IS NULL)
         OR (t.retention_kind='session_bound' AND c.actor_user_id=$2 AND c.origin_session_id=t.source_origin_session_id
           AND c.expires_at=t.expires_at)),false) AS memory_available,
     agent_session_chat_sources_available($1,lower(turn->'response'->>'taskID')) AS source_available,
     CASE WHEN turn->'response'->>'taskID' LIKE 'cancelled-%' THEN 'cancelled'
       WHEN turn->'response' ? 'execution' OR turn->'response' ? 'hostResult'
         OR turn->'response'->>'disposition'='screenshot_processing'
         OR COALESCE(payload->'screenshotTaskIDs','[]'::jsonb) ? (turn->'response'->>'taskID')
         OR EXISTS (SELECT 1 FROM screenshot_contact_tasks shot WHERE shot.account_id=$1 AND shot.id::text=lower(turn->'response'->>'taskID'))
         OR EXISTS (SELECT 1 FROM context_manifests m WHERE m.account_id=$1 AND m.task_id::text=lower(turn->'response'->>'taskID'))
         OR canonical.operation_scope='create_chat_task' THEN 'unsupported' ELSE 'normal' END AS kind
   FROM turns CROSS JOIN tick LEFT JOIN LATERAL (
     SELECT i.*,count(*) OVER () AS candidate_count FROM idempotency_records i
     WHERE i.account_id=$1 AND i.actor_user_id=$2 AND i.status='completed' AND i.response_status=201
       AND i.operation_scope IN ('create_chat_task','create_unscoped_chat_task')
       AND i.response_body->>'task_id'=lower(turn->'response'->>'taskID')
     ORDER BY i.id LIMIT 1
   ) canonical ON true
   LEFT JOIN agent_task_memory_lineage t ON t.account_id=$1 AND t.task_id::text=lower(turn->'response'->>'taskID')
   LEFT JOIN agent_session_chat_tasks c ON c.account_id=$1 AND c.task_id=lower(turn->'response'->>'taskID')
   LEFT JOIN LATERAL (SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id',d.memory_item_id::text,'item_version',d.item_version,
     'lineage_epoch',d.lineage_epoch::text,'memory_owner_id',d.memory_owner_id::text,'scope',d.scope,
     'subject_id',d.subject_id::text,'relationship_context_id',d.relationship_context_id::text) ORDER BY d.memory_item_id),'[]'::jsonb) AS stamps
     FROM agent_task_saved_memory_dependencies d WHERE d.account_id=$1 AND d.task_id=t.task_id) d ON true
 ), frames AS MATERIALIZED (
   SELECT ordinal,kind,source_available,memory_available,retained_expiry,source_expiry,
     jsonb_build_object('kind',kind,'task_id',task_id,'source_available',source_available,
       'human_messages',CASE WHEN kind='normal' THEN jsonb_build_array(jsonb_build_object('message_id',turn->>'id','text',turn->>'objective'))
         || COALESCE((SELECT jsonb_agg(jsonb_build_object('message_id',s->>'id','text',s->>'objective') ORDER BY n)
           FROM jsonb_array_elements(COALESCE(turn->'steeredMessages','[]'::jsonb)) WITH ORDINALITY steering(s,n)),'[]'::jsonb) ELSE '[]'::jsonb END,
       'assistant_text',CASE WHEN kind='normal' AND memory_available THEN (SELECT string_agg(block->>'body',E'\\n' ORDER BY n)
         FROM jsonb_array_elements(COALESCE(response_body->'blocks','[]'::jsonb)) WITH ORDINALITY blocks(block,n)
         WHERE block->>'kind' IN ('answer','clarification','question_set')) ELSE NULL END,
       'ancestor',CASE WHEN kind='normal' AND memory_available THEN jsonb_build_object('taskID',task_id,'completionID',completion_id::text,
         'bodyDigest',encode(sha256(convert_to(response_body::text,'UTF8')),'hex'),'proofDigest',proof_digest,'proof',proof,
         'sourceTaskExpiresAt',CASE WHEN source_expiry IS NULL THEN NULL ELSE to_char(source_expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END) ELSE NULL END) AS frame
   FROM captured
 ), budget AS MATERIALIZED (
   SELECT COALESCE(sum(octet_length(frame::text)),0) AS frame_bytes,
     COALESCE(sum(octet_length((frame->'ancestor')::text)),0) AS ancestor_bytes,
     min(LEAST(retained_expiry,source_expiry)) FILTER (WHERE memory_available) AS ancestor_expiry FROM frames
 ) SELECT to_char(tick.checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS checked_at,
   to_char(LEAST(admitted.expires_at,admitted.login_expires_at,($5::jsonb->>'sourceExpiresAt')::timestamptz,
     ($5::jsonb->>'sessionExpiresAt')::timestamptz,budget.ancestor_expiry) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS read_until,
   admitted.source,CASE WHEN budget.frame_bytes+octet_length(admitted.source::text)<=524288
     AND budget.ancestor_bytes+octet_length(admitted.source::text)<=131072
     THEN COALESCE((SELECT jsonb_agg(frame ORDER BY ordinal) FROM frames),'[]'::jsonb) ELSE NULL END AS turns
 FROM admitted CROSS JOIN tick CROSS JOIN budget`;

export async function readSavedMemorySessionHistory(input: {
  database: DatabaseClient; owner: LegacyChatAuthority; auth: AuthContext;
  sessionID: string; runID: string; taskID: string;
  source: HarnessRunSourceHandle; guard: () => Promise<void>; currentMessageID?: string;
}): Promise<SavedMemorySessionHistoryReceipt> {
  try {
    if (!input || typeof input !== "object" || types.isProxy(input)) return unavailable();
    const row = savedMemoryOwnRecord(input, ["database", "owner", "auth", "sessionID", "runID", "taskID", "source", "guard",
      ...(Object.getOwnPropertyDescriptor(input, "currentMessageID") ? ["currentMessageID"] : [])]);
    const owner = row.owner as LegacyChatAuthority;
    if (!owner || typeof owner !== "object" || types.isProxy(owner)) return unavailable();
    const auth = snapshotLegacyChatAuth(row.auth as AuthContext);
    const database = row.database as DatabaseClient;
    if (auth.userKind !== "password_human") return unavailable();
    const sessionID = savedMemoryUUID(row.sessionID), runID = savedMemoryUUID(row.runID), taskID = savedMemoryUUID(row.taskID);
    const currentMessageID = row.currentMessageID === undefined ? undefined : savedMemoryUUID(row.currentMessageID);
    const sourceHandle = row.source as HarnessRunSourceHandle, guard = row.guard as () => Promise<void>;
    const source = readHarnessRunSourceBinding(sourceHandle, guard, auth);
    if (source.sessionID !== sessionID || !source.sessionStamp || !source.sessionExpiresAt) return unavailable();
    const begun = performance.now();
    const result = await database.query(historySQL,
      [auth.accountId, auth.userId, auth.sessionId, sessionID, JSON.stringify(source)]);
    if (result.rows.length !== 1) return unavailable();
    const captured = savedMemoryOwnRecord(result.rows[0], ["checked_at", "read_until", "source", "turns"]);
    const checkedAt = savedMemoryDeadline(captured.checked_at), readUntil = savedMemoryDeadline(captured.read_until);
    if (readUntil <= checkedAt || readUntil > source.sourceExpiresAt || readUntil > source.sessionExpiresAt) return unavailable();
    const observedSource = savedMemoryOwnRecord(captured.source, ["accountId", "userId", "sessionID", "generation", "sessionStamp",
      "sessionExpiresAt", "sourceExpiresAt", "personIDs"]);
    // JSONB key order differs from JS. Capture scalars/own array before any
    // serialization so a synthetic or retained row cannot invoke data hooks.
    const people = savedMemoryOwnArray(observedSource.personIDs, source.personIDs.length).map(savedMemoryUUID);
    if (JSON.stringify(people) !== JSON.stringify(source.personIDs)) return unavailable();
    for (const key of ["accountId", "userId", "sessionID", "generation", "sessionStamp", "sessionExpiresAt", "sourceExpiresAt"] as const)
      if (observedSource[key] !== source[key]) return unavailable();
    if (JSON.stringify(readHarnessRunSourceBinding(sourceHandle, guard, auth)) !== JSON.stringify(source)) return unavailable();
    if (captured.turns === null) throw new HistoryBudgetLimited();
    const messages: ConversationMessage[] = [], available = new Map<string, Readonly<SavedMemorySessionHistoryAncestor>>();
    const unavailableTasks = new Set<string>();
    for (const value of savedMemoryOwnArray(captured.turns, 6)) {
      const turn = savedMemoryOwnRecord(value, ["kind", "task_id", "source_available", "human_messages", "assistant_text", "ancestor"]);
      if (turn.kind === "cancelled") continue;
      if (turn.kind !== "normal" || turn.source_available !== true) return unavailable();
      const oldTaskID = savedMemoryUUID(turn.task_id);
      for (const value of savedMemoryOwnArray(turn.human_messages, 21)) {
        const message = savedMemoryOwnRecord(value, ["message_id", "text"]);
        messages.push({ message_id: savedMemoryUUID(message.message_id), role: "user", text: text(message.text).slice(0, 2000) });
      }
      if (turn.ancestor === null) {
        if (turn.assistant_text !== null) return unavailable();
        unavailableTasks.add(oldTaskID); continue;
      }
      const ancestor = savedMemoryOwnRecord(turn.ancestor, ["taskID", "completionID", "bodyDigest", "proofDigest", "proof", "sourceTaskExpiresAt"]);
      const proof = captureSavedMemoryDurableProof(ancestor.proof);
      const sourceTaskExpiresAt = ancestor.sourceTaskExpiresAt === null ? null : savedMemoryDeadline(ancestor.sourceTaskExpiresAt);
      const fact = Object.freeze({ taskID: savedMemoryUUID(ancestor.taskID), completionID: savedMemoryUUID(ancestor.completionID),
        bodyDigest: hash(ancestor.bodyDigest), proofDigest: hash(ancestor.proofDigest), proof, sourceTaskExpiresAt });
      if (fact.taskID !== oldTaskID || proof.task_id !== oldTaskID || proof.account_id !== auth.accountId || proof.reader_actor_id !== auth.userId
        || proof.completion_idempotency_id !== fact.completionID || proof.expires_at !== sourceTaskExpiresAt
        || savedMemoryDurableProofDigest(proof) !== fact.proofDigest
        || (proof.expires_at !== null && readUntil > proof.expires_at)) return unavailable();
      const before = available.get(oldTaskID);
      if (before && JSON.stringify(before) !== JSON.stringify(fact)) return unavailable();
      available.set(oldTaskID, fact);
      if (turn.assistant_text !== null) messages.push({ message_id: oldTaskID, role: "assistant", text: text(turn.assistant_text).slice(0, 2000) });
    }
    const selected = boundedConversationHistory(boundInlineAgentSessionMessages(messages), currentMessageID)
      .map(message => Object.freeze(message));
    const selectedTasks = new Set(selected.filter(message => message.role === "assistant").map(message => message.message_id));
    const ancestors = [...available.values()].filter(ancestor => selectedTasks.has(ancestor.taskID));
    if (Buffer.byteLength(JSON.stringify({ source, ancestors }), "utf8") > MAX_ANCESTOR_BYTES
      || Buffer.byteLength(JSON.stringify({ source, messages: selected, ancestors }), "utf8") > MAX_FRAME_BYTES) throw new HistoryBudgetLimited();
    const deadline = begun + Number((legacySavedMemoryMicroseconds(readUntil) - legacySavedMemoryMicroseconds(checkedAt)) / 1000n);
    if (performance.now() >= deadline) return unavailable();
    const facts = Object.freeze({ accountId: auth.accountId, userId: auth.userId, sessionID, taskID, runID, source,
      checkedAt, readUntil, messages: Object.freeze(selected), ancestors: Object.freeze(ancestors),
      unavailableAssistantTaskIDs: Object.freeze([...unavailableTasks].sort()) });
    const receipt = Object.freeze({}) as SavedMemorySessionHistoryReceipt;
    receipts.set(receipt, { owner, auth, database, facts, deadline, consumed: false });
    return receipt;
  } catch (error) {
    if (!types.isProxy(error) && (error instanceof HistoryBudgetLimited || error instanceof HistoryUnavailable)) throw error;
    return unavailable();
  }
}

/** One private data handoff, not permission. The real Legacy facade validates
 * its private owner/Run first; no caller method/callback is invoked here. */
export function consumeSessionHistoryReceipt(receipt: SavedMemorySessionHistoryReceipt,
  owner: LegacyChatAuthority, auth: AuthContext, sessionID: string, runID: string, taskID: string): Readonly<SavedMemorySessionHistoryFacts> {
  const entry = receipts.get(receipt);
  if (entry && entry.owner !== owner) {
    const error = new HistoryUnavailable(); foreignErrors.add(error); throw error;
  } // Foreign owner cannot burn the real receipt or invoke auth hooks.
  try {
    const actor = snapshotLegacyChatAuth(auth);
    if (!entry || entry.consumed || entry.owner !== owner || entry.auth.accountId !== actor.accountId || entry.auth.userId !== actor.userId
      || entry.auth.sessionId !== actor.sessionId || entry.auth.userKind !== actor.userKind
      || entry.facts.sessionID !== savedMemoryUUID(sessionID) || entry.facts.runID !== savedMemoryUUID(runID)
      || entry.facts.taskID !== savedMemoryUUID(taskID) || performance.now() >= entry.deadline) return unavailable();
    entry.consumed = true;
    return entry.facts;
  } catch { return unavailable(); }
}
