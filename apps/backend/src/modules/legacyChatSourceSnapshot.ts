/** Original no-Session source fence for one durable attempt. Never recapture a
 * baseline on recovery, and never use this metadata as an independent grant. */
import { types } from "node:util";
import { recordProductEvent } from "@talent-signal/agent";
import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { assertHarnessLabAuthority, type HarnessSourceGuardFailureCode, type HarnessSourceGuardPhase } from "./harnessSourceGuard.js";
import { legacyChatProofDeadline, legacyChatProofId, legacyChatProofText, readLegacyChatSnapshotRecord,
  snapshotLegacyChatAuth } from "./legacyChatOriginalProof.js";

export interface LegacyChatSourceSnapshot {
  readonly version: 1;
  readonly accountId: string; readonly userId: string;
  readonly generation: string;
  readonly sessionStamp: null;
  readonly personIDs: readonly [];
  readonly expiresAt: string;
}
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
    const source = readLegacyChatSnapshotRecord(value, ["version", "accountId", "userId", "generation", "sessionStamp", "personIDs", "expiresAt"]);
    const people = source.personIDs;
    if (source.version !== 1 || source.sessionStamp !== null || types.isProxy(people) || !Array.isArray(people)
      || Object.getPrototypeOf(people) !== Array.prototype || Reflect.ownKeys(people).length !== 1
      || Object.getOwnPropertyDescriptor(people, "length")?.value !== 0) throw unavailable();
    return Object.freeze({ version: 1, accountId: legacyChatProofId(source.accountId), userId: legacyChatProofId(source.userId),
      generation: sourceGeneration(source.generation), sessionStamp: null, personIDs: Object.freeze([] as []), expiresAt: legacyChatProofDeadline(source.expiresAt) });
  } catch { throw unavailable(); }
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
export function restoreLegacyChatSourceGuard(database: DatabaseClient, auth: AuthContext, value: unknown,
  probe: DatabaseClient = database): () => Promise<void> {
  let original: Readonly<LegacyChatSourceSnapshot>, scope: Readonly<AuthContext>;
  try {
    original = validateLegacyChatSourceSnapshot(value);
    scope = snapshotLegacyChatAuth(auth);
    if (scope.accountId !== original.accountId || scope.userId !== original.userId) throw unavailable();
  } catch { return reject("recheck", "SOURCE_AUTHORITY_EXPIRED_OR_INVALID"); }
  let failed = false, first: unknown;
  return async () => {
    if (failed) throw first;
    try {
      const generation = await read(database, scope, original.expiresAt, probe, "recheck");
      if (generation !== original.generation) reject("recheck", "SOURCE_GENERATION_CHANGED");
    } catch (error) { failed = true; first = error; throw error; }
  };
}
