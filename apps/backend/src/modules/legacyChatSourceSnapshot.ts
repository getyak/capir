/** Original source fence for one finite durable attempt. Never recapture a
 * baseline on recovery, and never use this metadata as an independent grant. */
import { types } from "node:util";
import { recordProductEvent } from "@talent-signal/agent";
import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { assertHarnessLabAuthority, type HarnessSourceGuardFailureCode, type HarnessSourceGuardPhase } from "./harnessSourceGuard.js";
import { legacyChatProofDeadline, legacyChatProofId, legacyChatProofText, readLegacyChatSnapshotRecord,
  snapshotLegacyChatAuth } from "./legacyChatOriginalProof.js";

interface LegacyChatSourceSnapshotV1 {
  readonly version: 1;
  readonly accountId: string; readonly userId: string;
  readonly generation: string;
  readonly sessionStamp: null;
  readonly personIDs: readonly [];
  readonly expiresAt: string;
}
interface LegacyChatSourceSnapshotV2 {
  readonly version: 2;
  readonly accountId: string; readonly userId: string; readonly generation: string;
  readonly sessionID: string; readonly sessionStamp: string; readonly sessionExpiresAt: string;
  readonly personIDs: readonly []; readonly expiresAt: string;
}
export type LegacyChatSourceSnapshot = LegacyChatSourceSnapshotV1 | LegacyChatSourceSnapshotV2;
const unavailable = () => new ApiError(409, "HARNESS_SOURCE_CHANGED", "The source context changed. Retry using its current state.");
function note(phase: HarnessSourceGuardPhase, code: HarnessSourceGuardFailureCode): void {
  void recordProductEvent("harness.source_guard.rejected", "context", undefined, undefined,
    { failure_code: code, phase }, { failed: true }).catch(() => undefined);
}
function reject(phase: HarnessSourceGuardPhase, code: HarnessSourceGuardFailureCode): never {
  note(phase, code);
  throw unavailable();
}
function sourceGeneration(value: unknown): string {
  const exact = legacyChatProofText(value, 20);
  // PostgreSQL BIGINT is a signed decimal domain. Preserve its actual text,
  // including values above JS safe integer, never Number/parseInt conversion.
  if (!/^(?:0|-?[1-9]\d{0,18})$/u.test(exact)) throw unavailable();
  const bigint = BigInt(exact);
  if (bigint < -9223372036854775808n || bigint > 9223372036854775807n) throw unavailable();
  return exact;
}
export function validateLegacyChatSourceSnapshot(value: unknown): Readonly<LegacyChatSourceSnapshot> {
  try {
    // Read the discriminant as own data too; probing value.version could call
    // a getter before the strict record decoder has rejected it.
    if (!value || typeof value !== "object" || types.isProxy(value)) throw unavailable();
    const version = Object.getOwnPropertyDescriptor(value, "version");
    if (!version || !("value" in version)) throw unavailable();
    const source = readLegacyChatSnapshotRecord(value, version.value === 2
      ? ["version", "accountId", "userId", "generation", "sessionID", "sessionStamp", "sessionExpiresAt", "personIDs", "expiresAt"]
      : ["version", "accountId", "userId", "generation", "sessionStamp", "personIDs", "expiresAt"]);
    const people = source.personIDs;
    if (types.isProxy(people) || !Array.isArray(people)
      || Object.getPrototypeOf(people) !== Array.prototype || Reflect.ownKeys(people).length !== 1
      || Object.getOwnPropertyDescriptor(people, "length")?.value !== 0) throw unavailable();
    const common = { accountId: legacyChatProofId(source.accountId), userId: legacyChatProofId(source.userId),
      generation: sourceGeneration(source.generation), personIDs: Object.freeze([] as []), expiresAt: legacyChatProofDeadline(source.expiresAt) };
    if (source.version === 1 && source.sessionStamp === null) return Object.freeze({ version: 1,
      accountId: common.accountId,userId: common.userId,generation: common.generation,sessionStamp: null,
      personIDs: common.personIDs,expiresAt: common.expiresAt });
    if (source.version !== 2 || typeof source.sessionStamp !== "string" || !/^[a-f0-9]{32}$/u.test(source.sessionStamp)) throw unavailable();
    const sessionExpiresAt = legacyChatProofDeadline(source.sessionExpiresAt);
    if (common.expiresAt > sessionExpiresAt) throw unavailable();
    const snapshot = Object.freeze({ version: 2 as const, ...common, sessionID: legacyChatProofId(source.sessionID),
      sessionStamp: source.sessionStamp, sessionExpiresAt });
    if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 4096) throw unavailable();
    return snapshot;
  } catch { throw unavailable(); }
}

/** Fixed server SQL with alias s. The self-task slot is supplied exclusively
 * by a canonical execution row, never by a request or a snapshot allowlist.
 * An own lineage row must also join its real same-actor unscoped ledger. */
export function legacyChatEmptySessionContextSQL(selfTask: "$5::text" | "e.task_id::text" | "NULL::text"): string {
  return `COALESCE(s.payload->>'scopeKind'='unresolved_intent'
    AND s.payload->'turns'='[]'::jsonb
    AND COALESCE(s.payload->'personID','null'::jsonb)='null'::jsonb
    AND COALESCE(s.payload->'relationshipContextID','null'::jsonb)='null'::jsonb
    AND COALESCE(s.payload->'identityResolutionCaseID','null'::jsonb)='null'::jsonb
    AND COALESCE(s.payload->'originKind','null'::jsonb)='null'::jsonb
    AND COALESCE(s.payload->'originSessionID','null'::jsonb)='null'::jsonb
    AND COALESCE(s.payload->'originTurnID','null'::jsonb)='null'::jsonb
    AND COALESCE(s.payload->'contactProposal','null'::jsonb)='null'::jsonb
    AND COALESCE(s.payload->'contactReceipts','[]'::jsonb) IN ('null'::jsonb,'[]'::jsonb)
    AND COALESCE(s.payload->'screenshotTaskIDs','[]'::jsonb) IN ('null'::jsonb,'[]'::jsonb)
    AND COALESCE(s.payload->'inheritedScreenshotTaskIDs','[]'::jsonb) IN ('null'::jsonb,'[]'::jsonb),false)
    AND NOT EXISTS (SELECT 1 FROM conversation_queue_entries q WHERE q.account_id=s.account_id AND q.session_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM agent_session_chat_tasks t WHERE t.account_id=s.account_id AND t.origin_session_id=s.id
      AND NOT COALESCE((t.task_id=${selfTask} AND t.actor_user_id=s.created_by_user_id AND EXISTS (
        SELECT 1 FROM legacy_chat_executions own JOIN idempotency_records parent
          ON parent.account_id=own.account_id AND parent.id=own.idempotency_id
        WHERE own.account_id=t.account_id AND own.task_id::text=t.task_id AND own.request_message_id IS NULL
          AND parent.actor_user_id=s.created_by_user_id AND parent.operation_scope='create_unscoped_chat_task'
          AND (own.source_snapshot->>'sessionID'=s.id::text OR (own.state='completed' AND parent.status='completed'
            AND parent.response_body->>'task_id'=own.task_id::text)))),false))
    AND NOT EXISTS (SELECT 1 FROM mcp_interaction_requests m WHERE m.account_id=s.account_id AND m.session_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM mcp_oauth_connect_requests m WHERE m.account_id=s.account_id AND m.session_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM mcp_continuation_outbox m WHERE m.account_id=s.account_id AND m.session_id=s.id)`;
}

/** Shared exact source predicate for the bounded invalid-source janitor. e is
 * its real execution row and s is the original owned Session, not a new grant. */
export const legacyChatSessionSnapshotCurrentSQL = `EXISTS (SELECT 1 FROM agent_sessions s
  WHERE s.account_id=e.account_id AND e.source_snapshot->>'accountId'=e.account_id::text
    AND s.id::text=e.source_snapshot->>'sessionID'
    AND s.created_by_user_id::text=e.source_snapshot->>'userId' AND s.deleted_at IS NULL
    AND e.source_snapshot->>'expiresAt'=to_char(e.execution_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    AND jsonb_typeof(e.source_snapshot->'sessionExpiresAt')='string'
    AND e.source_snapshot->>'sessionExpiresAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$'
    AND e.source_snapshot->>'sessionExpiresAt'>=e.source_snapshot->>'expiresAt'
    AND s.expires_at>clock_timestamp() AND to_char(s.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')>=e.source_snapshot->>'sessionExpiresAt'
    AND md5(jsonb_build_array(s.payload->'turns',s.payload->'personID',s.payload->'relationshipContextID')::text)=e.source_snapshot->>'sessionStamp'
    AND COALESCE((SELECT generation FROM harness_source_generations WHERE account_id=e.account_id),0)::text=e.source_snapshot->>'generation'
    AND ${legacyChatEmptySessionContextSQL("e.task_id::text")})`;

type SessionSourceRow = { generation: string; session_stamp: string; session_expiry: string;
  deadline: string; structural: boolean; live: boolean; empty: boolean; liveUntil: number };
async function readSession(database: DatabaseClient, auth: AuthContext, sessionID: string, expiresAt: string,
  selfTaskID: string | null, probe: DatabaseClient, phase: HarnessSourceGuardPhase): Promise<SessionSourceRow> {
  const started = performance.now();
  await assertHarnessLabAuthority(probe, auth, phase);
  let raw: unknown;
  try {
    raw = (await database.query(`SELECT
      COALESCE((SELECT generation FROM harness_source_generations WHERE account_id=$1),0)::text AS generation,
      md5(jsonb_build_array(s.payload->'turns',s.payload->'personID',s.payload->'relationshipContextID')::text) AS session_stamp,
      to_char(s.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS session_expiry,
      to_char(LEAST($4::timestamptz,s.expires_at,clock_timestamp()+interval '60 seconds') AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deadline,
      floor(extract(epoch FROM (LEAST($4::timestamptz,s.expires_at,clock_timestamp()+interval '60 seconds')
        -clock_timestamp()))*1000)::text AS remaining_ms,
      COALESCE(jsonb_typeof(s.payload)='object' AND jsonb_typeof(s.payload->'turns')='array'
        AND s.payload->>'scopeKind' IN ('unresolved_intent','relationship','identity_review'),false) AS structural,
      s.deleted_at IS NULL AND s.expires_at>clock_timestamp() AND $4::timestamptz>clock_timestamp() AS live,
      ${legacyChatEmptySessionContextSQL("$5::text")} AS empty
      FROM agent_sessions s WHERE s.account_id=$1 AND s.created_by_user_id=$2 AND s.id=$3`,
    [auth.accountId,auth.userId,sessionID,expiresAt,selfTaskID])).rows[0];
  } catch (error) { note(phase,"UNEXPECTED_PROBE_FAILURE"); throw error; }
  let row: Record<string,unknown>;
  try {
    row = readLegacyChatSnapshotRecord(raw,["generation","session_stamp","session_expiry","deadline","remaining_ms","structural","live","empty"]);
    sourceGeneration(row.generation); legacyChatProofDeadline(row.session_expiry); legacyChatProofDeadline(row.deadline);
    if (typeof row.session_stamp !== "string" || !/^[a-f0-9]{32}$/u.test(row.session_stamp)
      || typeof row.empty !== "boolean") throw unavailable();
  } catch { return reject(phase,"SOURCE_ROW_UNAVAILABLE"); }
  if (row.structural !== true) return reject(phase,"SOURCE_ROW_UNAVAILABLE");
  if (row.live !== true) return reject(phase,"SOURCE_NOT_CURRENT");
  if (typeof row.remaining_ms !== "string" || !/^\d+$/u.test(row.remaining_ms)
    || !Number.isSafeInteger(Number(row.remaining_ms)) || Number(row.remaining_ms)>60_000)
    return reject(phase,"SOURCE_NOT_CURRENT");
  // The original absolute deadline stays unchanged. Charge the entire Lab/DB
  // roundtrip, and use a monotonic local clock after the last authority await.
  const liveUntil = performance.now()+Number(row.remaining_ms)-Math.ceil(performance.now()-started);
  if (performance.now()>=liveUntil) return reject(phase,"SOURCE_NOT_CURRENT");
  return { ...row,liveUntil } as SessionSourceRow;
}

/** A Session/source fence is always before reader/parent/execution locks.
 * FOR UPDATE also excludes the existing legacy lineage writer's FOR SHARE;
 * two compatible SHARE holders must not each ignore their own phantom task. */
export async function lockLegacyChatSessionSource(database: DatabaseClient, auth: AuthContext, value: unknown): Promise<void> {
  const source = validateLegacyChatSourceSnapshot(value);
  if (source.accountId !== auth.accountId || source.userId !== auth.userId) throw unavailable();
  if (source.version === 1) return;
  if ((await database.query(`SELECT id FROM agent_sessions WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3 FOR UPDATE NOWAIT`,
    [auth.accountId,auth.userId,source.sessionID])).rowCount !== 1) throw unavailable();
}

export async function tryCaptureEmptySessionSource(database: DatabaseClient, auth: AuthContext, sessionID: string,
  expiresAt: string, beforeLock: () => Promise<void>, probe: DatabaseClient = database): Promise<Readonly<LegacyChatSourceSnapshotV2> | null> {
  const scope = snapshotLegacyChatAuth(auth), id = legacyChatProofId(sessionID), expiry = legacyChatProofDeadline(expiresAt);
  const row = await readSession(database,scope,id,expiry,null,probe,"admission");
  if (!row.empty) return null; // Legal nonempty context retains the original atomic path.
  const original = validateLegacyChatSourceSnapshot({ version: 2,accountId: scope.accountId,userId: scope.userId,
    generation: row.generation,sessionID: id,sessionStamp: row.session_stamp,sessionExpiresAt: row.session_expiry,
    personIDs: [],expiresAt: row.deadline });
  if (original.version !== 2) throw unavailable();
  await beforeLock();
  await lockLegacyChatSessionSource(database,scope,original);
  // Positive owning-loader check, not an inference from payload.turns alone.
  const { readAgentSessionConversation } = await import("./agentSessions.js");
  const conversation = await readAgentSessionConversation(database,scope,id,
    { personId: null,relationshipContextId: null },{ complete: true });
  if (conversation.hasRecordedTurns || conversation.messages.length || conversation.sources?.length
    || conversation.historyTaskIDs?.length || conversation.unavailableScreenshotContext) throw unavailable();
  await restoreLegacyChatSourceGuard(database,scope,original,probe)();
  return original;
}

async function read(database: DatabaseClient, auth: AuthContext, expiresAt: string, probe: DatabaseClient,
  phase: HarnessSourceGuardPhase): Promise<string> {
  await assertHarnessLabAuthority(probe, auth, phase);
  let raw: unknown;
  try {
    // Same source-owner SQL/clock as createHarnessSourceGuard, explicitly fixed
    // to null Session and empty people. Root passes the fixed DB deadline as
    // six-digit text; no Date conversion can extend/round that SQL comparison.
    raw = (await database.query(`
      SELECT COALESCE((SELECT generation FROM harness_source_generations WHERE account_id=$1),0)::text AS generation,
        (SELECT md5(jsonb_build_array(payload->'turns',payload->'personID',payload->'relationshipContextID')::text)
          FROM agent_sessions WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3
            AND deleted_at IS NULL AND expires_at>clock_timestamp()) AS session_stamp,
        ($4::timestamptz IS NULL OR $4>clock_timestamp()) AND NOT EXISTS (
          SELECT 1 FROM identity_handles WHERE account_id=$1 AND subject_id=ANY($5::uuid[])
            AND status='confirmed' AND valid_until<=clock_timestamp()) AS current`,
    [auth.accountId, auth.userId, null, expiresAt, []])).rows[0];
  } catch (error) {
    note(phase, "UNEXPECTED_PROBE_FAILURE");
    throw error; // The surrounding original authority owns terminal classification.
  }
  if (!raw) return reject(phase, "SOURCE_ROW_UNAVAILABLE");
  let row: Record<string, unknown>, generation: string;
  try {
    row = readLegacyChatSnapshotRecord(raw, ["generation", "session_stamp", "current"]);
    generation = sourceGeneration(row.generation);
  } catch { return reject(phase, "SOURCE_ROW_UNAVAILABLE"); }
  if (row.current !== true) return reject(phase, "SOURCE_NOT_CURRENT");
  if (row.session_stamp !== null) return reject(phase, "SESSION_CONTEXT_CHANGED");
  return generation;
}

export async function captureLegacyChatSourceSnapshot(database: DatabaseClient, auth: AuthContext, expiresAt: string,
  probe: DatabaseClient = database): Promise<Readonly<LegacyChatSourceSnapshot>> {
  let scope: Readonly<AuthContext>, expiry: string;
  try { scope = snapshotLegacyChatAuth(auth); expiry = legacyChatProofDeadline(expiresAt); }
  catch { return reject("admission", "SOURCE_AUTHORITY_EXPIRED_OR_INVALID"); }
  const generation = await read(database, scope, expiry, probe, "admission");
  return validateLegacyChatSourceSnapshot({ version: 1, accountId: scope.accountId, userId: scope.userId, generation,
    sessionStamp: null, personIDs: [], expiresAt: expiry });
}

/** Synchronous validation/capture only. The returned check must run before
 * dispatch and at the existing before/after/final boundaries; it never adopts
 * the first current read as a baseline. Root supplies the same guarded client
 * facade during short transactions, including the explicit Lab probe facade. */
export interface LegacyChatSourceGuard {
  (): Promise<void>;
  /** Synchronous check after a final credential await; never a new grant. */
  assertLive(): void;
}
export function restoreLegacyChatSourceGuard(database: DatabaseClient, auth: AuthContext, value: unknown,
  probe: DatabaseClient = database, selfTaskID: string | null = null): LegacyChatSourceGuard {
  let original: Readonly<LegacyChatSourceSnapshot>, scope: Readonly<AuthContext>;
  try {
    original = validateLegacyChatSourceSnapshot(value);
    scope = snapshotLegacyChatAuth(auth);
    if (scope.accountId !== original.accountId || scope.userId !== original.userId) throw unavailable();
    if (selfTaskID !== null) selfTaskID = legacyChatProofId(selfTaskID);
  } catch { return reject("recheck", "SOURCE_AUTHORITY_EXPIRED_OR_INVALID"); }
  let failed = false, first: unknown, liveUntil: number | null = null;
  const assertLive = () => {
    if (failed) throw first;
    if (original.version === 2 && (liveUntil === null || performance.now()>=liveUntil)) {
      failed = true;
      try { reject("recheck","SOURCE_NOT_CURRENT"); } catch (error) { first = error; throw error; }
    }
  };
  const guard = async () => {
    if (failed) throw first;
    try {
      if (original.version === 1) {
        const generation = await read(database, scope, original.expiresAt, probe, "recheck");
        if (generation !== original.generation) reject("recheck", "SOURCE_GENERATION_CHANGED");
      } else {
        if (liveUntil !== null) assertLive();
        const row = await readSession(database,scope,original.sessionID,original.expiresAt,selfTaskID,probe,"recheck");
        liveUntil = Math.min(liveUntil ?? Infinity,row.liveUntil);
        assertLive();
        if (row.generation !== original.generation) reject("recheck","SOURCE_GENERATION_CHANGED");
        if (!row.empty || row.session_stamp !== original.sessionStamp || row.session_expiry < original.sessionExpiresAt)
          reject("recheck","SESSION_CONTEXT_CHANGED");
      }
    } catch (error) { failed = true; first = error; throw error; }
  };
  return Object.freeze(Object.assign(guard,{ assertLive }));
}
