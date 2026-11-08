/** Shared accepted-login observation used by Memory readers. The domain owner
 * supplies its current scope/content CTE in the same final statement. This
 * module preserves the existing list SQL; serving-deployment predicates and
 * domain fences remain obligations of each concrete reader integration.
 */
import { labWorkspaceSessionActiveSQL } from "./labWorkspaceAccess.js";

export interface MemoryReadAuthorityRow {
  token_hash: string;
  expires_at: Date;
  accepted_deadline: string;
  checked_ms: string;
  snapshot_at: string;
}
export interface MemoryReadAuthorityBounds {
  nowMs: number;
  sessionExpiresAtMs: number;
}

const acceptedDeadlineSQL = (parameter: number) => `CASE WHEN $${parameter}::text IS NULL
  OR sessions.token_hash=$${parameter} THEN sessions.expires_at ELSE sessions.previous_token_expires_at END`;
export const memoryReadAuthoritySQL = (loginParameter: number, acceptedParameter: number, originalDeadlineParameter?: number) => `SELECT sessions.token_hash, sessions.expires_at,
  to_char((${acceptedDeadlineSQL(acceptedParameter)}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS accepted_deadline,
  floor(extract(epoch FROM tick.checked_at) * 1000)::text AS checked_ms,
  to_char(tick.checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS snapshot_at
  FROM sessions
  JOIN accounts ON accounts.id = sessions.account_id AND accounts.retired_at IS NULL
  JOIN users ON users.account_id = sessions.account_id AND users.id = sessions.user_id AND users.status = 'active'
  CROSS JOIN tick
  WHERE sessions.account_id = $1 AND sessions.user_id = $2 AND sessions.id = $${loginParameter}::uuid
    AND sessions.revoked_at IS NULL AND sessions.expires_at > tick.checked_at
    AND ($${acceptedParameter}::text IS NULL OR sessions.token_hash=$${acceptedParameter}
      OR (sessions.previous_token_hash=$${acceptedParameter} AND sessions.previous_token_expires_at>tick.checked_at))
    ${originalDeadlineParameter ? `AND tick.checked_at<$${originalDeadlineParameter}::timestamptz` : ""}
    AND ${labWorkspaceSessionActiveSQL}`;


export function memoryReadAuthorityBounds(row: MemoryReadAuthorityRow): MemoryReadAuthorityBounds | null {
  if (!/^[a-f0-9]{64}$/u.test(row.token_hash ?? "")
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(row.accepted_deadline ?? "")) return null;
  const value = { nowMs: Number(row.checked_ms),
    sessionExpiresAtMs: Math.min(row.expires_at.getTime(), Date.parse(row.accepted_deadline)) };
  if (!Number.isSafeInteger(value.nowMs) || !Number.isSafeInteger(value.sessionExpiresAtMs)
    || value.sessionExpiresAtMs <= value.nowMs) return null;
  return value;
}


// Additive opt-in core only. Existing GET448 SQL/bounds and every current
// HTTP/Agent adapter retain their original behavior until separately wired.
export { createMemoryContentReaderProbeFactory } from "./memoryContentReadEnvelope.js";
export type { MemoryContentReaderProbe, MemoryContentReaderProbeFactory, MemoryContentReaderOptions } from "./memoryContentReadEnvelope.js";
