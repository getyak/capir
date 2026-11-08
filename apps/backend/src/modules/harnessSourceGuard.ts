import { recordProductEvent } from "@talent-signal/agent";
import { types } from "node:util";
import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { labStopAuthorityKeySQL } from "./labStopAuthority.js";
import { legacyChatProofDeadline, legacyChatProofId, readLegacyChatSnapshotRecord,
  snapshotLegacyChatAuth } from "./legacyChatOriginalProof.js";

export interface HarnessSourceAuthority { expiresAt: Date; personIDs: readonly string[] }

type HarnessSourceGuard = () => Promise<void>;
declare const harnessRunSourceBrand: unique symbol;
/** In-process owner identity only. This handle and its metadata grant neither
 * authentication nor current source/Memory availability or publication. */
export interface HarnessRunSourceHandle { readonly [harnessRunSourceBrand]: true }
export interface HarnessRunSourceBinding {
  readonly accountId: string;
  readonly userId: string;
  readonly sessionID: string | null;
  readonly generation: string;
  readonly sessionStamp: string | null;
  readonly sessionExpiresAt: string | null;
  /** Original observed sources() SQL input, only narrowed thereafter. Not a
   * new Run/credential/retention lifetime or proof of source independence. */
  readonly sourceExpiresAt: string;
  readonly personIDs: readonly string[];
}
interface SourceObservation {
  generation: string; sessionStamp: string | null;
  sessionExpiresAt: string | null; sourceExpiresAt: string | null; personIDs: string[];
}
interface SourceBindingState {
  readonly auth: Readonly<AuthContext>;
  readonly guard: HarnessSourceGuard;
  readonly sessionID: string | null;
  readonly generation: string;
  readonly sessionStamp: string | null;
  sessionExpiresAt: string | null;
  sourceExpiresAt: string | null;
  readonly personIDs: Set<string>;
  latestSourceDefined: boolean;
  latestSequence: number;
  checking: number;
  failed: boolean;
}
const sourceBindings = new WeakMap<object, SourceBindingState>();

// Opt-in observation columns only. Preserve PostgreSQL microseconds as text:
// https://node-postgres.com/features/types#date--timestamp--timestamptz
// https://www.postgresql.org/docs/18/functions-formatting.html
const sourceBindingColumnsSQL = `,
        to_char($4::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_expires_at,
        (SELECT to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          FROM agent_sessions WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3
            AND deleted_at IS NULL AND expires_at>clock_timestamp()) AS session_expires_at,
        $5::uuid[] AS source_person_ids`;

function sourceObservation(value: unknown, sessionID: string | null): SourceObservation {
  try {
    const row = readLegacyChatSnapshotRecord(value, ["generation", "session_stamp", "current",
      "source_expires_at", "session_expires_at", "source_person_ids"]);
    if (row.current !== true || typeof row.generation !== "string"
      || !/^(?:0|-?[1-9][0-9]{0,18})$/u.test(row.generation)
      || BigInt(row.generation) < -9223372036854775808n || BigInt(row.generation) > 9223372036854775807n
      || !Array.isArray(row.source_person_ids) || types.isProxy(row.source_person_ids)) throw unavailable();
    const people = row.source_person_ids;
    if (Object.getPrototypeOf(people) !== Array.prototype
      || Reflect.ownKeys(people).length !== people.length + 1) throw unavailable();
    const personIDs: string[] = [];
    for (let i = 0; i < people.length; i++) {
      const slot = Object.getOwnPropertyDescriptor(people, String(i));
      if (!slot || !("value" in slot) || !slot.enumerable) throw unavailable();
      personIDs.push(legacyChatProofId(slot.value));
    }
    const stamp = row.session_stamp;
    if (sessionID === null ? stamp !== null || row.session_expires_at !== null
      : typeof stamp !== "string" || !/^[a-f0-9]{32}$/u.test(stamp)) throw unavailable();
    return { generation: row.generation, sessionStamp: stamp as string | null,
      sessionExpiresAt: sessionID === null ? null : legacyChatProofDeadline(row.session_expires_at),
      sourceExpiresAt: row.source_expires_at === null ? null : legacyChatProofDeadline(row.source_expires_at), personIDs };
  } catch { throw unavailable(); }
}
function narrowSourceBinding(state: SourceBindingState, observed: SourceObservation, sequence: number): void {
  if (observed.sessionExpiresAt !== null && (state.sessionExpiresAt === null
    || observed.sessionExpiresAt < state.sessionExpiresAt)) state.sessionExpiresAt = observed.sessionExpiresAt;
  if (observed.sourceExpiresAt !== null && (state.sourceExpiresAt === null
    || observed.sourceExpiresAt < state.sourceExpiresAt)) state.sourceExpiresAt = observed.sourceExpiresAt;
  for (const id of observed.personIDs) state.personIDs.add(id);
  // Concurrent rechecks may finish out of order. Only actual callback-observation
  // order controls whether the latest source was defined; floors/people union
  // include every successful observation. Pending reads cannot be unpacked.
  if (sequence > state.latestSequence) {
    state.latestSequence = sequence;
    state.latestSourceDefined = observed.sourceExpiresAt !== null;
  }
}

/** Parameter facts for a future fixed owner-joined SQL, not an availability
 * assertion. That owner must check current credential/Lab/source/Memory/query
 * at one DB tick. A clone cannot replace this private handle at that entry. */
export function readHarnessRunSourceBinding(handle: HarnessRunSourceHandle,
  guard: HarnessSourceGuard, auth: AuthContext): Readonly<HarnessRunSourceBinding> {
  let current: Readonly<AuthContext>;
  try { current = snapshotLegacyChatAuth(auth); } catch { throw unavailable(); }
  const state = sourceBindings.get(handle);
  if (!state || state.guard !== guard || state.failed || state.checking !== 0
    || !state.latestSourceDefined || state.sourceExpiresAt === null
    || state.auth.accountId !== current.accountId || state.auth.userId !== current.userId
    || state.auth.sessionId !== current.sessionId || state.auth.userKind !== current.userKind) throw unavailable();
  return Object.freeze({ accountId: state.auth.accountId, userId: state.auth.userId, sessionID: state.sessionID,
    generation: state.generation, sessionStamp: state.sessionStamp, sessionExpiresAt: state.sessionExpiresAt,
    sourceExpiresAt: state.sourceExpiresAt, personIDs: Object.freeze([...state.personIDs].sort()) });
}

/** Lifecycle point whose read observed the rejection. */
export type HarnessSourceGuardPhase = "admission" | "recheck";

/** Static observed-branch codes. Only these strings reach diagnostics: never
 * SQL, row content, raw database codes, error prose, names, timestamps, IDs,
 * credential values, source text, prompts, memory or screenshots. */
export type HarnessSourceGuardFailureCode =
  | "LAB_AUTHORITY_MISSING" | "LAB_STOP_PENDING" | "LAB_WORKSPACE_INACTIVE" | "LAB_WORKSPACE_EXPIRED"
  | "PROBE_TIMEOUT" | "LOCK_UNAVAILABLE" | "UNEXPECTED_PROBE_FAILURE"
  | "SOURCE_AUTHORITY_EXPIRED_OR_INVALID" | "SOURCE_ROW_UNAVAILABLE" | "SOURCE_NOT_CURRENT" | "SESSION_MISSING"
  | "SOURCE_GENERATION_CHANGED" | "SESSION_CONTEXT_CHANGED";

const unavailable = () => new ApiError(409, "HARNESS_SOURCE_CHANGED", "The source context changed. Retry using its current state.");
// The probe may wait on the shared pool or host scheduling before its NOWAIT
// query runs. Keep a finite budget without treating ordinary delay as revoked
// authority; state and expiry are still checked after the fresh read returns.
const LAB_AUTHORITY_PROBE_TIMEOUT_MS = 5_000;

/** One best-effort static diagnostic per observed rejection. Request-local and
 * never awaited: a failing or hanging capture sink can neither postpone nor
 * replace the rejection it describes, never decides admission, and a caller
 * without a sink stays equivalent. */
function noteGuardRejection(phase: HarnessSourceGuardPhase, failureCode: HarnessSourceGuardFailureCode): void {
  void recordProductEvent("harness.source_guard.rejected", "context", undefined, undefined,
    { failure_code: failureCode, phase }, { failed: true }).catch(() => undefined);
}

/** Run on an independent autocommit connection so a pending Lab stop wins. */
export async function assertHarnessLabAuthority(probe: DatabaseClient, auth: AuthContext,
  phase: HarnessSourceGuardPhase = "admission"): Promise<void> {
  if (auth.userKind !== "lab_human") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let workspace: {state:string; expires_at:Date; stop_clear:boolean} | undefined;
  try {
    const result = await Promise.race([
      probe.query<{state:string; expires_at:Date; stop_clear:boolean}>(`SELECT state,expires_at,
        pg_try_advisory_xact_lock_shared(${labStopAuthorityKeySQL}) AS stop_clear FROM lab_test_workspaces
        WHERE target_account_id=$1::uuid AND target_user_id=$2::uuid FOR SHARE NOWAIT`,[auth.accountId,auth.userId]),
      new Promise<never>((_,reject) => { timer=setTimeout(() => {
        timedOut = true;
        noteGuardRejection(phase, "PROBE_TIMEOUT");
        reject(unavailable());
      },LAB_AUTHORITY_PROBE_TIMEOUT_MS); }),
    ]);
    workspace = result.rows[0];
  } catch(error) {
    if (timedOut) throw error;
    // Only the exact NOWAIT conflict code is mapped to a static enum value.
    if ((error as {code?:string})?.code==="55P03") { noteGuardRejection(phase, "LOCK_UNAVAILABLE"); throw unavailable(); }
    noteGuardRejection(phase, "UNEXPECTED_PROBE_FAILURE");
    throw error;
  } finally { if(timer) clearTimeout(timer); }
  if (!workspace) { noteGuardRejection(phase, "LAB_AUTHORITY_MISSING"); throw unavailable(); }
  if (!workspace.stop_clear) { noteGuardRejection(phase, "LAB_STOP_PENDING"); throw unavailable(); }
  if (workspace.state!=="active") { noteGuardRejection(phase, "LAB_WORKSPACE_INACTIVE"); throw unavailable(); }
  if (workspace.expires_at.valueOf()<=Date.now()) { noteGuardRejection(phase, "LAB_WORKSPACE_EXPIRED"); throw unavailable(); }
}

/** Capture BEFORE reading dialogue, Memory or images. A continuation created
 * after compilation cannot establish the version of that earlier input.
 * READ COMMITTED obtains a new snapshot per command; clock_timestamp advances
 * inside the product transaction. https://www.postgresql.org/docs/18/transaction-iso.html
 */
export async function createHarnessSourceGuard(database: DatabaseClient, auth: AuthContext,
  sessionID: string | undefined, sources: () => HarnessSourceAuthority | undefined, probe: DatabaseClient = database): Promise<() => Promise<void>> {
  return (await createSourceGuardOwner(database, auth, sessionID, sources, probe, false)).guard;
}

/** Opt in before reading/compiling source. Not wired to any tool or reader.
 * A pending undefined sources() cannot be unpacked as an independent domain. */
export async function createHarnessSourceGuardWithBinding(database: DatabaseClient, auth: AuthContext,
  sessionID: string | undefined, sources: () => HarnessSourceAuthority | undefined, probe: DatabaseClient = database,
): Promise<Readonly<{ guard: HarnessSourceGuard; source: HarnessRunSourceHandle }>> {
  const owner = await createSourceGuardOwner(database, auth, sessionID, sources, probe, true);
  if (!owner.source) throw unavailable();
  return Object.freeze({ guard: owner.guard, source: owner.source });
}

async function createSourceGuardOwner(database: DatabaseClient, auth: AuthContext,
  sessionID: string | undefined, sources: () => HarnessSourceAuthority | undefined, probe: DatabaseClient,
  binding: boolean,
): Promise<{ guard: HarnessSourceGuard; source?: HarnessRunSourceHandle }> {
  // The original entry keeps its argument behavior and exact SQL predicate.
  if (binding) {
    try { auth = snapshotLegacyChatAuth(auth); if (sessionID !== undefined) sessionID = legacyChatProofId(sessionID); }
    catch { throw unavailable(); }
  }
  let sequence = 0;
  const observations = new WeakMap<object, { value: SourceObservation; sequence: number }>();
  const read = async (phase: HarnessSourceGuardPhase) => {
    await assertHarnessLabAuthority(probe, auth, phase);
    const observedSequence = binding ? ++sequence : 0;
    const authority = sources();
    if (authority && (!Number.isFinite(authority.expiresAt.valueOf()) || authority.expiresAt.valueOf() <= Date.now())) {
      noteGuardRejection(phase, "SOURCE_AUTHORITY_EXPIRED_OR_INVALID");
      throw unavailable();
    }
    let row: { generation: string; session_stamp: string | null; current: boolean } | undefined;
    try {
      row = (await database.query<{ generation: string; session_stamp: string | null; current: boolean }>(`
      SELECT COALESCE((SELECT generation FROM harness_source_generations WHERE account_id=$1),0)::text AS generation,
        (SELECT md5(jsonb_build_array(payload->'turns',payload->'personID',payload->'relationshipContextID')::text)
          FROM agent_sessions WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3
            AND deleted_at IS NULL AND expires_at>clock_timestamp()) AS session_stamp,
        ($4::timestamptz IS NULL OR $4>clock_timestamp()) AND NOT EXISTS (
          SELECT 1 FROM identity_handles WHERE account_id=$1 AND subject_id=ANY($5::uuid[])
            AND status='confirmed' AND valid_until<=clock_timestamp()) AS current${binding ? sourceBindingColumnsSQL : ""}`,
    [auth.accountId, auth.userId, sessionID ?? null, authority?.expiresAt ?? null, [...(authority?.personIDs ?? [])]])).rows[0];
    } catch (error) {
      noteGuardRejection(phase, "UNEXPECTED_PROBE_FAILURE");
      throw error;
    }
    if (!row) { noteGuardRejection(phase, "SOURCE_ROW_UNAVAILABLE"); throw unavailable(); }
    if (!row.current) { noteGuardRejection(phase, "SOURCE_NOT_CURRENT"); throw unavailable(); }
    if (sessionID && !row.session_stamp) { noteGuardRejection(phase, "SESSION_MISSING"); throw unavailable(); }
    if (binding) {
      try { observations.set(row, { value: sourceObservation(row, sessionID ?? null), sequence: observedSequence }); }
      catch { noteGuardRejection(phase, "SOURCE_ROW_UNAVAILABLE"); throw unavailable(); }
    }
    return row;
  };
  const admitted = await read("admission");
  let state: SourceBindingState | undefined;
  const guard = async () => {
    if (state) state.checking++;
    try {
      const current = await read("recheck");
      if (current.generation !== (state ? state.generation : admitted.generation)) { noteGuardRejection("recheck", "SOURCE_GENERATION_CHANGED"); throw unavailable(); }
      if (current.session_stamp !== (state ? state.sessionStamp : admitted.session_stamp)) { noteGuardRejection("recheck", "SESSION_CONTEXT_CHANGED"); throw unavailable(); }
      if (state) {
        const observed = observations.get(current);
        if (!observed) throw unavailable();
        narrowSourceBinding(state, observed.value, observed.sequence);
      }
    } catch (error) {
      if (state) state.failed = true;
      throw error;
    } finally { if (state) state.checking--; }
  };
  if (!binding) return { guard };
  const observed = observations.get(admitted);
  if (!observed) throw unavailable();
  state = { auth, guard, sessionID: sessionID ?? null, generation: observed.value.generation,
    sessionStamp: observed.value.sessionStamp, sessionExpiresAt: observed.value.sessionExpiresAt,
    sourceExpiresAt: observed.value.sourceExpiresAt, personIDs: new Set(observed.value.personIDs),
    latestSourceDefined: observed.value.sourceExpiresAt !== null, latestSequence: observed.sequence, checking: 0, failed: false };
  const source = Object.freeze({}) as HarnessRunSourceHandle;
  sourceBindings.set(source, state);
  return { guard, source };
}
