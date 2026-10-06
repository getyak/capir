import { recordProductEvent } from "@talent-signal/agent";
import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { labStopAuthorityKeySQL } from "./labStopAuthority.js";

export interface HarnessSourceAuthority { expiresAt: Date; personIDs: readonly string[] }

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
      },1000); }),
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
  const read = async (phase: HarnessSourceGuardPhase) => {
    await assertHarnessLabAuthority(probe, auth, phase);
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
            AND status='confirmed' AND valid_until<=clock_timestamp()) AS current`,
    [auth.accountId, auth.userId, sessionID ?? null, authority?.expiresAt ?? null, [...(authority?.personIDs ?? [])]])).rows[0];
    } catch (error) {
      noteGuardRejection(phase, "UNEXPECTED_PROBE_FAILURE");
      throw error;
    }
    if (!row) { noteGuardRejection(phase, "SOURCE_ROW_UNAVAILABLE"); throw unavailable(); }
    if (!row.current) { noteGuardRejection(phase, "SOURCE_NOT_CURRENT"); throw unavailable(); }
    if (sessionID && !row.session_stamp) { noteGuardRejection(phase, "SESSION_MISSING"); throw unavailable(); }
    return row;
  };
  const admitted = await read("admission");
  return async () => {
    const current = await read("recheck");
    if (current.generation !== admitted.generation) { noteGuardRejection("recheck", "SOURCE_GENERATION_CHANGED"); throw unavailable(); }
    if (current.session_stamp !== admitted.session_stamp) { noteGuardRejection("recheck", "SESSION_CONTEXT_CHANGED"); throw unavailable(); }
  };
}
