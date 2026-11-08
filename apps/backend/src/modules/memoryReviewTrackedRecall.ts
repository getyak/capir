/** Private Run input, not a response or an authorization capability. Every
 * returned legacy item, retained evidence reference and original epoch comes
 * from one fixed SELECT snapshot. The real entry still owns current auth,
 * whole-Run admission and the final publication/COMMIT fence. */
import { CONTRACT_VERSION, type MemoryRecallResponse, type MemoryScope } from "@talent-signal/contracts";
import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import type { MemoryRecallRequest } from "./memoryReviewRecall.js";
import { MEMORY_EVIDENCE_AVAILABLE_SQL, serializeRecallItem,
  type EvidenceRow, type MemoryItemRow } from "./memoryReviewStore.js";
import { captureSavedMemoryStamp, savedMemoryUnavailable, savedMemoryUUID,
  type SavedMemoryStamp } from "./savedMemoryLineage.js";

export interface TrackedMemoryRecallPage {
  readonly page: Readonly<MemoryRecallResponse>;
  /** Host-only metadata. Admit only the items actually exposed by the owner;
   * never send this holder or its stamps through the public/tool serializer. */
  readonly originalStamps: readonly Readonly<SavedMemoryStamp>[];
}

type RecallCursor = { scope: MemoryScope; created_at: string; id: string };
type TrackedEvidence = EvidenceRow & { content_protocol: unknown };
type TrackedRow = MemoryItemRow & {
  content_protocol: unknown;
  cursor_time: string;
  original_lineage_epoch: unknown;
  retained_evidence: TrackedEvidence[];
};

// Keep the existing recall cursor, ordering and limit semantics. This is a
// separate private reader because the public DTO must not acquire epochs.
function boundedLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}
function decodeCursor(value: string): RecallCursor {
  try {
    if (value.length > 500) throw new Error();
    const row = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as RecallCursor;
    if (!["self", "person", "relationship"].includes(row.scope)
      || !/^\d{4}-\d{2}-\d{2}T/.test(row.created_at) || !Number.isFinite(Date.parse(row.created_at))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(row.id)) throw new Error();
    return row;
  } catch {
    throw new ApiError(400, "MEMORY_CURSOR_INVALID", "Read Memory using the returned continuation cursor.");
  }
}
function requireLegacy(protocol: unknown): void {
  if (protocol !== "legacy-v1") {
    throw new ApiError(409, "MEMORY_CONTENT_VERSION_UNSUPPORTED", "Use the matching complete Memory content reader.");
  }
}
/** The serializer creates this JSON projection from driver-owned rows; freeze
 * nested locators as well so no later caller can mutate the admitted page. */
function freezeProjection<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeProjection(child);
    Object.freeze(value);
  }
  return value;
}

/** Uses the existing recall ACL, including shared Person Memory. It must not
 * inherit discovery's acting-owner-only filter. No SQL, projection callback,
 * source grant or epoch is accepted from the request. */
export async function recallMemoriesTracked(
  client: DatabaseClient,
  auth: AuthContext,
  request: MemoryRecallRequest,
): Promise<Readonly<TrackedMemoryRecallPage>> {
  const accountId = savedMemoryUUID(auth.accountId), userId = savedMemoryUUID(auth.userId);
  const surface = request.surface;
  const personId = request.person_id ?? null, contextId = request.relationship_context_id ?? null;
  const requestedScope = request.scope;
  const limit = boundedLimit(request.limit);
  const cursor = request.cursor ? decodeCursor(request.cursor) : null;
  const parameters: unknown[] = [accountId, userId];
  let scopeClause: string;
  if (surface === "chat") {
    if (personId && contextId) {
      parameters.push(personId, contextId);
      scopeClause = `(
        (m.scope = 'self' AND m.owner_user_id = $2)
        OR (m.subject_id = $3 AND (
          m.scope = 'person'
          OR (m.scope = 'relationship' AND m.owner_user_id = $2
            AND m.relationship_context_id = $4)
        ))
      )`;
    } else if (personId) {
      parameters.push(personId);
      scopeClause = `(
        (m.scope = 'self' AND m.owner_user_id = $2)
        OR (m.subject_id = $3 AND (
          m.scope = 'person'
          OR (m.scope = 'relationship' AND m.owner_user_id = $2)
        ))
      )`;
    } else {
      scopeClause = `(m.scope = 'self' AND m.owner_user_id = $2)`;
    }
  } else if (surface === "people") {
    if (!personId) throw new ApiError(400, "MEMORY_SCOPE_REQUIRED", "People recall needs one contact.");
    parameters.push(personId);
    scopeClause = `(m.subject_id = $3 AND (
      m.scope = 'person'
      OR (m.scope = 'relationship' AND m.owner_user_id = $2)
    ))`;
  } else {
    if (!personId || !contextId) {
      throw new ApiError(400, "MEMORY_SCOPE_REQUIRED", "Relationship recall needs one contact and one relationship context.");
    }
    parameters.push(personId, contextId);
    scopeClause = `(
      m.subject_id = $3
      AND (
        m.scope = 'person'
        OR (m.scope = 'relationship' AND m.owner_user_id = $2
          AND m.relationship_context_id = $4)
      )
    )`;
  }
  let pageClause = "";
  if (requestedScope) {
    parameters.push(requestedScope);
    pageClause += ` AND m.scope = $${parameters.length}`;
  }
  if (cursor) {
    parameters.push(cursor.scope, cursor.created_at, cursor.id);
    const scope = `$${parameters.length - 2}`, time = `$${parameters.length - 1}::timestamptz`, id = `$${parameters.length}::uuid`;
    pageClause += ` AND (m.scope > ${scope} OR (m.scope = ${scope} AND
      (m.created_at < ${time} OR (m.created_at = ${time} AND m.id > ${id}))))`;
  }
  parameters.push(limit + 1);
  const limitParameter = `$${parameters.length}`;
  try {
    const result = await client.query<TrackedRow>(
      `SELECT m.*,
        to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
        original_lineage.epoch::text AS original_lineage_epoch,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id',e.id,'memory_item_id',e.memory_item_id,'capture_id',e.capture_id,
          'source_resource_id',e.source_resource_id,'evidence_fragment_id',e.evidence_fragment_id,
          'source_session_id',e.source_session_id,'source_message_id',e.source_message_id,
          'source_artifact_id',e.source_artifact_id,'locator',e.locator,'excerpt',e.excerpt,
          'status',e.status,'content_protocol',e.content_protocol
        ) ORDER BY e.created_at,e.id),'[]'::jsonb)
          FROM memory_item_evidence e
          WHERE e.account_id=m.account_id AND e.memory_item_id=m.id AND e.status='active') AS retained_evidence
       FROM memory_items m
       LEFT JOIN memory_item_lineage original_lineage
         ON original_lineage.account_id=m.account_id AND original_lineage.memory_item_id=m.id
       WHERE m.account_id = $1
         AND $2::uuid IS NOT NULL
         AND m.status = 'active'
         AND ${scopeClause}
         ${pageClause}
         AND (
           m.subject_id IS NULL
           OR EXISTS (
             SELECT 1 FROM subjects s
             WHERE s.account_id = m.account_id AND s.id = m.subject_id AND s.status = 'active'
           )
         )
         AND (
           m.scope <> 'self'
           OR (m.owner_user_id=$2 AND m.relationship_context_id IS NULL AND (
             m.subject_id IS NULL OR EXISTS (
               SELECT 1 FROM subjects owner_subject
               WHERE owner_subject.account_id=m.account_id AND owner_subject.id=m.subject_id
                 AND owner_subject.external_ref='workspace-owner:' || $2::text AND owner_subject.status='active'
             )
           ))
         )
         AND (
           m.relationship_context_id IS NULL
           OR EXISTS (
             SELECT 1 FROM assignments a
             WHERE a.account_id = m.account_id AND a.id = m.relationship_context_id AND a.status = 'active'
               AND a.subject_id = m.subject_id
           )
         )
         AND EXISTS (
           SELECT 1 FROM memory_item_evidence active_evidence
           WHERE active_evidence.account_id = m.account_id AND active_evidence.memory_item_id = m.id
             AND active_evidence.status = 'active'
         )
         AND NOT EXISTS (
           SELECT 1 FROM memory_item_evidence e
           WHERE e.account_id = m.account_id AND e.memory_item_id = m.id AND NOT ${MEMORY_EVIDENCE_AVAILABLE_SQL}
         )
       ORDER BY m.scope,m.created_at DESC,m.id
       LIMIT ${limitParameter}`,
      parameters,
    );
    if (!Array.isArray(result.rows) || result.rows.length > limit + 1) return savedMemoryUnavailable();
    const rows = result.rows.slice(0, limit), items: MemoryRecallResponse["items"] = [], stamps: Readonly<SavedMemoryStamp>[] = [];
    for (const row of rows) {
      requireLegacy(row.content_protocol);
      if (!Array.isArray(row.retained_evidence) || row.retained_evidence.length === 0) return savedMemoryUnavailable();
      for (const source of row.retained_evidence) requireLegacy(source.content_protocol);
      const stamp = captureSavedMemoryStamp({ item_id: row.id, item_version: row.version,
        lineage_epoch: row.original_lineage_epoch, memory_owner_id: row.owner_user_id,
        scope: row.scope, subject_id: row.scope === "self" ? null : row.subject_id,
        relationship_context_id: row.relationship_context_id });
      items.push({ ...serializeRecallItem(row, row.retained_evidence, true), can_edit: row.owner_user_id === userId });
      stamps.push(stamp);
    }
    const page: MemoryRecallResponse = { contract_version: CONTRACT_VERSION, surface,
      person_id: personId, relationship_context_id: contextId, items,
      has_more: result.rows.length > limit,
      next_cursor: result.rows.length > limit && rows.length ? Buffer.from(JSON.stringify({
        scope: rows.at(-1)!.scope, created_at: rows.at(-1)!.cursor_time, id: rows.at(-1)!.id,
      })).toString("base64url") : null };
    return Object.freeze({ page: freezeProjection(page), originalStamps: Object.freeze(stamps) });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Database/parser/private exception text is not a tool response.
    return savedMemoryUnavailable();
  }
}
