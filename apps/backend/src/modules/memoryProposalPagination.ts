import { CONTRACT_VERSION, type MemoryProposalListResponse, type MemoryProposalRecord } from "@talent-signal/contracts";
import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import type { ProposalRow } from "./memoryReviewStore.js";
import { MEMORY_PROPOSAL_CURSOR_TTL_MS, MEMORY_PROPOSAL_PAGE_SIZE,
  openMemoryProposalCursor, sealMemoryProposalCursor,
  type MemoryProposalCursorScope, type MemoryProposalCursorState } from "./memoryProposalCursor.js";
import { MEMORY_PROPOSAL_SOURCE_ELIGIBILITY_SQL } from "./memoryProposalSourceEligibility.js";
import { labWorkspaceSessionActiveSQL } from "./labWorkspaceAccess.js";

export interface MemoryProposalPageRequest { paginate?: boolean | undefined; cursor?: string | null | undefined }
type ListScope = Pick<MemoryProposalCursorScope, "purpose" | "personId" | "contextId" | "sourceSessionId">;
type ListRow = ProposalRow & { cursor_time: string; qualified_count: number; qualified_default_count: number };
type AuthorityRow = { token_hash: string; expires_at: Date; checked_ms: string; snapshot_at: string };

function changed(): never {
  throw new ApiError(409, "MEMORY_PROPOSAL_CURSOR_STALE",
    "The proposal list changed. Start a fresh read.");
}

// Scope predicates apply before LIMIT, and are reused by the final envelope.
// ADR0024 + recall's current business scope: an inactive or mismatched target
// is not a listable scope. Chat keeps its existing independent owner semantics.
const activeScopeSQL = `($4 = 'chat' OR (
  EXISTS (SELECT 1 FROM subjects active_subject
    WHERE active_subject.account_id = $1 AND active_subject.id = $5::uuid AND active_subject.status = 'active')
  AND (($4 = 'people' AND $6::uuid IS NULL) OR EXISTS (
    SELECT 1 FROM assignments active_context
    WHERE active_context.account_id = $1 AND active_context.id = $6::uuid
      AND active_context.subject_id = $5::uuid AND active_context.status = 'active'
  ))
))`;
const proposalScopeSQL = `p.account_id = $1 AND p.created_by_user_id = $2
  AND p.status IN ('open', 'partially_committed') AND p.expires_at > now()
  AND ($3::uuid IS NULL OR p.session_id = $3)
  AND ($4 <> 'chat' OR p.surface = 'chat') AND ${activeScopeSQL}`;
const qualifiedItemsSQL = `SELECT count(*)::int AS item_count,
    (count(*) FILTER (WHERE i.default_selected))::int AS default_selected_count
    FROM memory_proposal_items i
    WHERE i.account_id = p.account_id AND i.proposal_id = p.id AND i.status = 'pending'
      AND ($4 = 'chat' OR (i.subject_id = $5::uuid
        AND (($4 = 'people' AND i.scope IN ('person', 'relationship'))
          OR ($4 = 'relationship' AND i.scope = 'relationship' AND i.relationship_context_id = $6::uuid))
        AND ($6::uuid IS NULL OR i.relationship_context_id IS NULL OR i.relationship_context_id = $6)))
      AND ${MEMORY_PROPOSAL_SOURCE_ELIGIBILITY_SQL}`;

const authoritySQL = (loginParameter: number) => `SELECT sessions.token_hash, sessions.expires_at,
  floor(extract(epoch FROM tick.checked_at) * 1000)::text AS checked_ms,
  to_char(tick.checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS snapshot_at
  FROM sessions
  JOIN accounts ON accounts.id = sessions.account_id AND accounts.retired_at IS NULL
  JOIN users ON users.account_id = sessions.account_id AND users.id = sessions.user_id AND users.status = 'active'
  CROSS JOIN tick
  WHERE sessions.account_id = $1 AND sessions.user_id = $2 AND sessions.id = $${loginParameter}::uuid
    AND sessions.revoked_at IS NULL AND sessions.expires_at > tick.checked_at
    AND ${labWorkspaceSessionActiveSQL}`;

const requalifiedSQL = (expectedParameter: number) => `qualified AS MATERIALIZED (
  SELECT p.id FROM memory_proposals p
  JOIN jsonb_to_recordset($${expectedParameter}::jsonb) expected(id uuid, revision integer, created_at timestamptz,
    item_count integer, default_selected_count integer)
    ON p.id = expected.id AND p.revision = expected.revision AND p.created_at = expected.created_at
  CROSS JOIN LATERAL (${qualifiedItemsSQL}) admitted
  WHERE ${proposalScopeSQL} AND admitted.item_count = expected.item_count
    AND admitted.default_selected_count = expected.default_selected_count AND admitted.item_count > 0
)`;

function bounds(row: AuthorityRow) {
  if (!/^[a-f0-9]{64}$/u.test(row.token_hash ?? "")) return changed();
  const value = { nowMs: Number(row.checked_ms), sessionExpiresAtMs: row.expires_at.getTime() };
  if (!Number.isSafeInteger(value.nowMs) || !Number.isSafeInteger(value.sessionExpiresAtMs)
    || value.sessionExpiresAtMs <= value.nowMs) return changed();
  return value;
}

/** The cursor is traversal metadata, never a permission or source credential. */
export async function readMemoryProposalPage(
  client: DatabaseClient, auth: AuthContext, scope: ListScope,
  request: MemoryProposalPageRequest,
  serialize: (row: ProposalRow) => Promise<MemoryProposalRecord | null>,
): Promise<MemoryProposalListResponse> {
  const params: unknown[] = [auth.accountId, auth.userId, scope.sourceSessionId,
    scope.purpose, scope.personId, scope.contextId, auth.sessionId];
  const paginated = request.paginate === true || Boolean(request.cursor);
  const cursorScope: MemoryProposalCursorScope = { ...scope, accountId: auth.accountId,
    userId: auth.userId, loginSessionId: auth.sessionId };
  // Every list form repeats the same live authority. Pagination is only a
  // representation choice, never a caller-controlled permission switch.
  // token_hash is SHA256(bearer), not a server secret or issuer credential;
  // reading it here only binds both observations to the same generation.
  const authority = (await client.query<AuthorityRow>(
    `WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at) ${authoritySQL(3)}`,
    [auth.accountId, auth.userId, auth.sessionId],
  )).rows[0];
  if (!authority) return changed();
  const originalBounds = bounds(authority);
  let state: MemoryProposalCursorState | null = null;
  if (paginated) {
    if (request.cursor) state = openMemoryProposalCursor(request.cursor, authority.token_hash, cursorScope, originalBounds);
    else state = { snapshotAt: authority.snapshot_at, beforeCreatedAt: authority.snapshot_at,
      beforeId: "00000000-0000-0000-0000-000000000000",
      validUntilMs: Math.min(originalBounds.sessionExpiresAtMs,
        Date.parse(authority.snapshot_at) + MEMORY_PROPOSAL_CURSOR_TTL_MS) };
  }
  const cursorClause = state
    ? `AND p.created_at <= $7::timestamptz ${request.cursor
      ? "AND (p.created_at < $8::timestamptz OR (p.created_at = $8::timestamptz AND p.id > $9::uuid))" : ""}`
    : "";
  const listParams = params.slice(0, 6);
  if (state) {
    listParams.push(state.snapshotAt);
    if (request.cursor) listParams.push(state.beforeCreatedAt, state.beforeId);
  }
  const rows = (await client.query<ListRow>(
    `SELECT p.*, admitted.item_count AS qualified_count, admitted.default_selected_count AS qualified_default_count,
       to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
     FROM memory_proposals p CROSS JOIN LATERAL (${qualifiedItemsSQL}) admitted
     WHERE ${proposalScopeSQL} AND admitted.item_count > 0 ${cursorClause}
     ORDER BY p.created_at DESC, p.id LIMIT ${MEMORY_PROPOSAL_PAGE_SIZE}`,
    listParams,
  )).rows;
  if (rows.length > MEMORY_PROPOSAL_PAGE_SIZE) return changed();
  const records: MemoryProposalRecord[] = [];
  for (const row of rows) {
    const record = await serialize(row); // Original source verifier stays authoritative.
    if (!record) return changed(); // Never leak a newly withdrawn frontier via empty pages.
    if (record.item_count !== row.qualified_count
      || record.default_selected_count !== row.qualified_default_count) return changed();
    records.push(record);
  }
  const expected = rows.map((row, index) => ({ id: row.id, revision: row.revision, created_at: row.cursor_time,
    item_count: records[index]!.item_count, default_selected_count: records[index]!.default_selected_count }));
  // One final SQL snapshot checks both the login and every selected/probe row.
  // Any expiry, source withdrawal, mutation or rotation fails before publishing
  // page metadata. Source eligibility is read directly, with no cached index.
  const envelopeStarted = performance.now();
  const envelope = (await client.query<AuthorityRow & { scope_active: boolean }>(
    `WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at),
     ${requalifiedSQL(8)} SELECT current_auth.*, ${activeScopeSQL} AS scope_active
     FROM (${authoritySQL(7)}) current_auth WHERE (SELECT count(*) FROM qualified) = $9`,
    [...params, JSON.stringify(expected), expected.length],
  )).rows[0];
  if (!envelope || envelope.token_hash !== authority.token_hash) return changed();
  const finalBounds = bounds(envelope);
  // Include the whole round trip as a conservative upper bound on elapsed DB
  // time, without trusting host/DB wall-clock synchronization or renewing TTL.
  finalBounds.nowMs += Math.ceil(performance.now() - envelopeStarted);
  if (finalBounds.nowMs >= Math.min(originalBounds.sessionExpiresAtMs, finalBounds.sessionExpiresAtMs)) return changed();
  // Closed/foreign business scopes retain the legacy empty-array shape. Their
  // candidates were filtered before LIMIT; even an empty page still passed
  // the same live login/Lab/generation/deadline envelope above.
  if (!paginated) return { contract_version: CONTRACT_VERSION, proposals: records };
  if (!state || envelope.scope_active !== true) return changed();
  if (state.validUntilMs <= finalBounds.nowMs || state.validUntilMs > finalBounds.sessionExpiresAtMs) return changed();
  const hasMore = rows.length === MEMORY_PROPOSAL_PAGE_SIZE;
  // At most49 visible records + one verified lookahead stays within50. The
  // probe is not consumed: it appears in the next page after the returned anchor.
  const proposals = hasMore ? records.slice(0, -1) : records;
  const anchor = hasMore ? rows[proposals.length - 1] : null;
  const nextCursor = anchor ? sealMemoryProposalCursor(envelope.token_hash, cursorScope,
    { ...state, beforeCreatedAt: anchor.cursor_time, beforeId: anchor.id }, finalBounds) : null;
  return { contract_version: CONTRACT_VERSION, proposals, has_more: hasMore,
    next_cursor: nextCursor, snapshot_at: state.snapshotAt };
}
