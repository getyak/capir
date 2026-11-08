/** Closed, noncredential metadata for the Legacy owner. Nothing here is a
 * grant; only its private credential owner composes and executes the final SQL. */
import { captureSavedMemoryReadProof, captureSavedMemoryStamp, savedMemoryDeadline,
  savedMemoryOwnArray, savedMemoryOwnRecord, savedMemoryUnavailable, savedMemoryUUID,
  type SavedMemoryReadProof } from "./savedMemoryLineage.js";
import type { SavedMemoryFinalReadDomain } from "./savedMemoryDiscovery.js";

export interface LegacySavedMemoryReadEnvelope {
  readonly available: true;
  readonly checked_at: string;
  readonly read_until: string;
}
export function captureLegacySavedMemoryEnvelope(value: unknown): Readonly<LegacySavedMemoryReadEnvelope> {
  const row = savedMemoryOwnRecord(value, ["available", "checked_at", "read_until"]);
  const checked_at = savedMemoryDeadline(row.checked_at), read_until = savedMemoryDeadline(row.read_until);
  if (row.available !== true || read_until <= checked_at) return savedMemoryUnavailable();
  return Object.freeze({ available: true, checked_at, read_until });
}
export function legacySavedMemoryMicroseconds(value: string): bigint {
  savedMemoryDeadline(value);
  return BigInt(Date.parse(value.slice(0, 23) + "Z")) * 1000n + BigInt(value.slice(23, 26));
}
export function captureLegacySavedMemoryDomain(value: unknown): Readonly<SavedMemoryFinalReadDomain> {
  const row = savedMemoryOwnRecord(value, ["proof", "query_id", "query_digest", "projection_version", "cutoff",
    "query_expires_at", "literal_patterns", "page_limit", "delivered_stamps"]);
  const proof = captureSavedMemoryReadProof(row.proof);
  const patterns = savedMemoryOwnArray(row.literal_patterns, 8);
  if (typeof row.query_digest !== "string" || !/^[a-f0-9]{64}$/u.test(row.query_digest)
    || row.projection_version !== 1 || !Number.isSafeInteger(row.page_limit)
    || (row.page_limit as number) < 1 || (row.page_limit as number) > 20 || !patterns.length
    || patterns.some(p => typeof p !== "string" || !p.length || p.length > 242)
    || patterns.reduce<number>((n, p) => n + Buffer.byteLength(p as string, "utf8"), 0) > 4112) return savedMemoryUnavailable();
  const delivered = savedMemoryOwnArray(row.delivered_stamps, row.page_limit as number).map(captureSavedMemoryStamp);
  if (new Set(delivered.map(s => s.item_id)).size !== delivered.length
    || delivered.some(s => !proof.stamps.some(p => JSON.stringify(p) === JSON.stringify(s)))) return savedMemoryUnavailable();
  return Object.freeze({ proof, query_id: savedMemoryUUID(row.query_id), query_digest: row.query_digest,
    projection_version: 1, cutoff: savedMemoryDeadline(row.cutoff), query_expires_at: savedMemoryDeadline(row.query_expires_at),
    literal_patterns: Object.freeze(patterns as string[]), page_limit: row.page_limit as number,
    delivered_stamps: Object.freeze(delivered) });
}
export function assertLegacySavedMemoryProofSuperset(current: SavedMemoryReadProof, next: SavedMemoryReadProof): void {
  if (current.account_id !== next.account_id || current.reader_actor_id !== next.reader_actor_id
    || current.task_id !== next.task_id || current.expires_at !== next.expires_at
    || current.stamps.some(s => !next.stamps.some(p => JSON.stringify(p) === JSON.stringify(s)))) return savedMemoryUnavailable();
}

// Fixed slot12: own server metadata. Slots1..11, including all credentials,
// remain exclusively assembled inside legacyChatAuthority. One tick for every
// source/Memory/query predicate. No caller SQL, dynamic clock or boolean grant.
export const legacySavedMemorySourceSQL = `
  COALESCE((SELECT generation FROM harness_source_generations WHERE account_id=$6),0)::text=$12::jsonb->'source'->>'generation'
  AND ($12::jsonb->'source'->>'sourceExpiresAt')::timestamptz>tick.checked_at
  AND (CASE WHEN $12::jsonb->'source'->>'sessionID' IS NULL THEN true ELSE EXISTS (
    SELECT 1 FROM agent_sessions source_session
    WHERE source_session.account_id=$6 AND source_session.created_by_user_id=$7
      AND source_session.id=($12::jsonb->'source'->>'sessionID')::uuid
      AND source_session.deleted_at IS NULL AND source_session.expires_at>tick.checked_at
      AND ($12::jsonb->'source'->>'sessionExpiresAt')::timestamptz>tick.checked_at
      AND md5(jsonb_build_array(source_session.payload->'turns',source_session.payload->'personID',
        source_session.payload->'relationshipContextID')::text)=$12::jsonb->'source'->>'sessionStamp'
  ) END)
  AND NOT EXISTS (SELECT 1 FROM identity_handles handle WHERE handle.account_id=$6
    AND handle.subject_id IN (SELECT value::uuid FROM jsonb_array_elements_text($12::jsonb->'source'->'personIDs'))
    AND handle.status='confirmed' AND handle.valid_until<=tick.checked_at)`;

export const legacySavedMemoryProofSQL = `
  saved_memory_read_set_current($6,$7,$12::jsonb->'proof'->'stamps',
    ($12::jsonb->'proof'->>'expires_at')::timestamptz,tick.checked_at)
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($12::jsonb->'domains') domain
    WHERE saved_memory_discovery_current($6,$7,(domain->>'query_id')::uuid,domain->>'query_digest',
      (domain->>'projection_version')::integer,(domain->>'cutoff')::timestamptz,
      (domain->>'query_expires_at')::timestamptz,$12::jsonb->'proof'->'stamps',domain->'delivered_stamps',
      ARRAY(SELECT jsonb_array_elements_text(domain->'literal_patterns')),(domain->>'page_limit')::integer,
      ($12::jsonb->'proof'->>'expires_at')::timestamptz,tick.checked_at) IS NOT TRUE)`;
