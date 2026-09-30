import { randomUUID } from "node:crypto";

import type { CalendarDraft, ChatResponseBlock, MeetingDraftListResponse, MeetingDraftListScope, MeetingDraftRecord, MeetingDraftResponse, MeetingDraftUpdateRequest } from "@talent-signal/contracts";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import type { Pool } from "pg";
import { inTransaction, type DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import { digestValue } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";

/**
 * Account- and user-scoped projection of CalendarDraft values produced by
 * session-bound chat tasks. A draft is a reviewable proposal with
 * external_effect='none'; it is never a confirmed event or execution receipt.
 */

interface MeetingDraftRow {
  id: string;
  created_by_user_id: string;
  source_task_id: string;
  origin_session_id: string;
  source_message_id: string | null;
  title: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  time_zone: string | null;
  source_excerpt: string | null;
  reference_time: Date | null;
  source_image: CalendarDraft["source_image"] | null;
  status: MeetingDraftRecord["status"];
  external_effect: "none";
  revision: number;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  redacted_at: Date | null;
  dismissed_at: Date | null;
}

interface MeetingDraftOperationRow {
  draft_id: string;
  operation: "edit" | "dismiss";
  request_hash: string;
  response_revision: number;
}

type MeetingDraftAuthorityRow = Pick<
  MeetingDraftRow,
  "origin_session_id" | "revision" | "source_task_id" | "status"
>;

type MeetingDraftCursor = {
  v: 3;
  scope: MeetingDraftListScope;
  snapshot_id: string;
  before_us: string | null;
  before_id: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MICROSECONDS = /^(?:0|[1-9]\d{0,18})$/u;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const MAX_SNAPSHOT_ITEMS = 5_000;
const CURRENT_CONTENT_PREDICATE = `(d.status IN ('redacted','expired') OR (
  d.expires_at>statement_timestamp()
  AND meeting_draft_source_available(
    d.account_id,d.origin_session_id,d.source_task_id
  )
))`;

function validMicroseconds(value: string | undefined): value is string {
  return Boolean(
    value &&
    MICROSECONDS.test(value) &&
    BigInt(value) <= POSTGRES_BIGINT_MAX,
  );
}

function encodeCursor(cursor: MeetingDraftCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(
  value: string,
  requestedScope: MeetingDraftListScope,
): MeetingDraftCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<MeetingDraftCursor>;
    if (
      parsed.v !== 3 ||
      parsed.scope !== requestedScope ||
      !UUID.test(parsed.snapshot_id ?? "") ||
      ((parsed.before_us === null) !== (parsed.before_id === null)) ||
      (parsed.before_us !== null && !validMicroseconds(parsed.before_us)) ||
      (parsed.before_id !== null && !UUID.test(parsed.before_id ?? ""))
    ) {
      throw new Error("invalid_cursor");
    }
    return parsed as MeetingDraftCursor;
  } catch {
    throw new ApiError(
      400,
      "MEETING_DRAFT_CURSOR_INVALID",
      "The meeting draft snapshot cursor is invalid.",
    );
  }
}

function record(row: MeetingDraftRow): MeetingDraftRecord {
  const base = {
    id: row.id,
    external_effect: "none",
    revision: row.revision,
    source_task_id: row.source_task_id,
    origin_session_id: row.origin_session_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
  } as const;
  if (row.status === "redacted" || row.status === "expired") {
    return {
      ...base,
      status: row.status,
      content_available: false,
      title: null,
      starts_at: null,
      ends_at: null,
      time_zone: null,
      source_excerpt: null,
      reference_time: null,
      redacted_at: row.redacted_at!.toISOString(),
      dismissed_at: row.dismissed_at?.toISOString() ?? null,
    };
  }
  const content = {
    content_available: true,
    title: row.title!,
    starts_at: row.starts_at!.toISOString(),
    ends_at: row.ends_at!.toISOString(),
    time_zone: row.time_zone!,
    source_excerpt: row.source_excerpt!,
    reference_time: row.reference_time!.toISOString(),
    ...(row.source_image ? {source_image:row.source_image} : {}),
    redacted_at: null,
  } as const;
  return row.status === "dismissed"
    ? {
        ...base,
        ...content,
        status: "dismissed",
        dismissed_at: row.dismissed_at!.toISOString(),
      }
    : {
        ...base,
        ...content,
        status: "needs_review",
        dismissed_at: null,
      };
}

function calendarDrafts(blocks: ChatResponseBlock[]): CalendarDraft[] {
  const drafts: CalendarDraft[] = [];
  for (const block of blocks) {
    const draft = block.calendar_draft;
    if (draft) drafts.push(draft);
  }
  return drafts;
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/**
 * Record every CalendarDraft produced by a session-bound chat task. The caller
 * must already hold the session/task source authority lock for this
 * transaction. Rows are keyed by the draft id, so an idempotent retry (or a
 * replayed request inside the same transaction) never duplicates a draft.
 *
 * Expiry is bounded by the originating Session/task and by a 30 day maximum.
 * A retry that changes the draft identity for an already-stored task draft is
 * rejected rather than silently overwritten.
 */
export async function recordMeetingDraftsForTask(
  client: DatabaseClient,
  auth: AuthContext,
  input: {
    taskID: string;
    sessionID: string;
    blocks: ChatResponseBlock[];
    messageID?: string | undefined;
  },
): Promise<void> {
  const drafts = calendarDrafts(input.blocks);
  if (!drafts.length) return;
  if (!input.sessionID) return;
  const authority = (
    await client.query<{ expires_at: Date; session_expires_at: Date }>(
      `SELECT t.expires_at,s.expires_at AS session_expires_at
       FROM agent_session_chat_tasks t
       JOIN agent_sessions s
         ON s.account_id=t.account_id AND s.id=t.origin_session_id
       WHERE t.account_id=$1 AND t.actor_user_id=$2 AND t.task_id=$3 AND s.id=$4
         AND t.expires_at>statement_timestamp()
         AND s.created_by_user_id=$2 AND s.payload IS NOT NULL
         AND s.deleted_at IS NULL AND s.expires_at>statement_timestamp()
         AND agent_session_chat_sources_available(t.account_id,t.task_id)
       FOR SHARE OF t,s`,
      [auth.accountId, auth.userId, input.taskID, input.sessionID],
    )
  ).rows[0];
  if (!authority) {
    throw new ApiError(
      409,
      "MEETING_DRAFT_SOURCE_UNAVAILABLE",
      "The Session chat task is not available for a meeting draft.",
    );
  }
  const expiresAt = new Date(
    Math.min(
      authority.expires_at.valueOf(),
      authority.session_expires_at.valueOf(),
      Date.now() + 30 * 86_400_000,
    ),
  );
  for (const draft of drafts) {
    const start = Date.parse(draft.starts_at);
    const end = Date.parse(draft.ends_at);
    const reference = Date.parse(draft.reference_time);
    if (
      draft.source_request_id !== input.taskID ||
      draft.status !== "needs_review" ||
      draft.external_effect !== "none" ||
      !draft.title.trim() ||
      !draft.source_excerpt.trim() ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      !Number.isFinite(reference) ||
      end <= start ||
      end - start > 7 * 86_400_000 ||
      !validTimeZone(draft.time_zone)
    ) {
      throw new ApiError(
        409,
        "MEETING_DRAFT_SOURCE_MISMATCH",
        "The draft does not match the safe calendar proposal produced by this task.",
      );
    }
    if (draft.source_message_id && draft.source_message_id !== input.messageID) {
      const source = (await client.query<{ objective: string | null }>(
        `SELECT m.objective FROM conversation_queue_entries m
         JOIN conversation_queue_entries l ON l.account_id=m.account_id AND l.id=m.steer_group_entry_id
         WHERE m.account_id=$1 AND m.session_id=$2 AND m.created_by_user_id=$3 AND m.message_id=$4
           AND m.steer_state='delivered' AND l.run_id=$5 AND l.status='running'
           AND l.lease_expires_at>now() AND l.cancel_requested=false`,
        [auth.accountId, input.sessionID, auth.userId, draft.source_message_id, input.taskID],
      )).rows[0];
      if (!source?.objective?.includes(draft.source_excerpt)) throw new ApiError(409,
        "MEETING_DRAFT_SOURCE_MISMATCH", "The supplementary draft must quote its owned delivered message.");
    }
    await client.query(
      `SELECT record_meeting_draft_with_image($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      [
        auth.accountId,
        draft.id,
        auth.userId,
        input.taskID,
        input.sessionID,
        draft.source_message_id ?? input.messageID ?? null,
        draft.title,
        draft.starts_at,
        draft.ends_at,
        draft.time_zone,
        draft.source_excerpt,
        draft.reference_time,
        expiresAt,
        draft.source_image ? JSON.stringify(draft.source_image) : null,
      ],
    );

  }
}

function missing(): ApiError {
  return new ApiError(
    404,
    "MEETING_DRAFT_NOT_FOUND",
    "The meeting draft is not available in this account and user scope.",
  );
}

async function redactUnavailable(
  client: DatabaseClient,
  accountId: string,
): Promise<void> {
  await client.query("SELECT redact_unavailable_meeting_drafts($1)", [
    accountId,
  ]);
}

async function replayMeetingDraftOperation(
  client: DatabaseClient,
  auth: AuthContext,
  input: {
    draftID: string;
    idempotencyKey: string;
    operation: MeetingDraftOperationRow["operation"];
    requestHash: string;
  },
): Promise<MeetingDraftRecord | null> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${auth.accountId}:${auth.userId}:${input.idempotencyKey}`,
  ]);
  const operation = (
    await client.query<MeetingDraftOperationRow>(
      `SELECT draft_id,operation,request_hash,response_revision
       FROM meeting_draft_operations
       WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3`,
      [auth.accountId, auth.userId, input.idempotencyKey],
    )
  ).rows[0];
  if (!operation) return null;
  if (
    operation.draft_id !== input.draftID ||
    operation.operation !== input.operation ||
    operation.request_hash !== input.requestHash
  ) {
    throw new ApiError(
      409,
      "MEETING_DRAFT_INTENT_CONFLICT",
      "This operation identity belongs to a different meeting draft intent.",
    );
  }
  const row = (
    await client.query<MeetingDraftRow>(
      `SELECT * FROM meeting_drafts d
       WHERE d.account_id=$1 AND d.created_by_user_id=$2 AND d.id=$3
         AND ${CURRENT_CONTENT_PREDICATE}`,
      [auth.accountId, auth.userId, input.draftID],
    )
  ).rows[0];
  if (!row) throw missing();
  if (row.revision !== operation.response_revision) {
    throw new ApiError(
      409,
      "MEETING_DRAFT_OPERATION_SUPERSEDED",
      "This operation succeeded, but a newer draft revision now exists.",
    );
  }
  return record(row);
}

async function recordMeetingDraftOperation(
  client: DatabaseClient,
  auth: AuthContext,
  input: {
    draftID: string;
    idempotencyKey: string;
    operation: MeetingDraftOperationRow["operation"];
    requestHash: string;
    responseRevision: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO meeting_draft_operations(
       account_id,actor_user_id,idempotency_key,draft_id,operation,
       request_hash,response_revision
     ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      auth.accountId,
      auth.userId,
      input.idempotencyKey,
      input.draftID,
      input.operation,
      input.requestHash,
      input.responseRevision,
    ],
  );
}

export async function getMeetingDraft(
  client: DatabaseClient,
  auth: AuthContext,
  id: string,
): Promise<MeetingDraftRecord> {
  await redactUnavailable(client, auth.accountId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = (
      await client.query<MeetingDraftRow>(
        `SELECT * FROM meeting_drafts d
         WHERE d.account_id=$1 AND d.created_by_user_id=$2 AND d.id=$3
           AND ${CURRENT_CONTENT_PREDICATE}`,
        [auth.accountId, auth.userId, id],
      )
    ).rows[0];
    if (row) return record(row);
    // If authority lapsed after the preflight statement, persist the tombstone
    // and read only its already-redacted representation on the second pass.
    if (attempt === 0) await redactUnavailable(client, auth.accountId);
  }
  throw missing();
}

export async function listMeetingDrafts(
  client: DatabaseClient,
  auth: AuthContext,
  after?: string,
  limit = 50,
  scope: MeetingDraftListScope = "all",
): Promise<MeetingDraftListResponse> {
  await redactUnavailable(client, auth.accountId);
  await client.query(
    `DELETE FROM meeting_draft_list_snapshots
     WHERE account_id=$1 AND created_by_user_id=$2
       AND expires_at<=statement_timestamp()`,
    [auth.accountId, auth.userId],
  );
  const effectiveLimit = Math.min(50, Math.max(1, limit));
  const scopePredicate = scope === "reviewable"
    ? "d.status='needs_review'"
    : scope === "inactive"
      ? "d.status<>'needs_review'"
      : "TRUE";
  let cursor = after ? decodeCursor(after, scope) : null;
  if (!cursor) {
    const snapshotID = randomUUID();
    // Snapshot identity and every matching draft key are written by one SQL
    // statement and therefore share one PostgreSQL visibility snapshot.
    const materialized = await client.query(
      `WITH snapshot AS (
         INSERT INTO meeting_draft_list_snapshots(
           account_id,id,created_by_user_id,scope,expires_at
         ) VALUES($1,$3,$2,$4,clock_timestamp()+interval '5 minutes')
         RETURNING account_id,id
       )
       INSERT INTO meeting_draft_list_snapshot_items(
         account_id,snapshot_id,draft_id,sort_created_at
       )
       SELECT snapshot.account_id,snapshot.id,d.id,d.created_at
       FROM snapshot
       JOIN meeting_drafts d ON d.account_id=snapshot.account_id
       WHERE d.created_by_user_id=$2
         AND ${scopePredicate}
         AND ${CURRENT_CONTENT_PREDICATE}
       ORDER BY d.created_at DESC,d.id DESC
       LIMIT $5`,
      [
        auth.accountId,
        auth.userId,
        snapshotID,
        scope,
        MAX_SNAPSHOT_ITEMS + 1,
      ],
    );
    if ((materialized.rowCount ?? 0) > MAX_SNAPSHOT_ITEMS) {
      await client.query(
        `DELETE FROM meeting_draft_list_snapshots
         WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3`,
        [auth.accountId, auth.userId, snapshotID],
      );
      throw new ApiError(
        413,
        "MEETING_DRAFT_LIST_TOO_LARGE",
        "The meeting draft list is too large to snapshot safely.",
      );
    }
    cursor = {
      v: 3,
      scope,
      snapshot_id: snapshotID,
      before_us: null,
      before_id: null,
    };
  }
  const beforePredicate = cursor.before_us === null
    ? ""
    : `AND ((extract(epoch FROM i.sort_created_at)*1000000)::bigint,i.draft_id)
           < ($5::bigint,$6::uuid)`;
  const parameters: unknown[] = [
    auth.accountId,
    auth.userId,
    cursor.snapshot_id,
    scope,
  ];
  if (cursor.before_us !== null) {
    parameters.push(cursor.before_us, cursor.before_id);
  }
  parameters.push(effectiveLimit + 1);
  const limitParameter = parameters.length;
  type PageRow = MeetingDraftRow & {
    snapshot_marker: string;
    sort_created_at_us: string;
  };
  type EmptyPageRow = {
    id: null;
    snapshot_marker: string;
    sort_created_at_us: null;
  };
  const result = await client.query<PageRow | EmptyPageRow>(
      `SELECT snapshot.id AS snapshot_marker,page.*
       FROM meeting_draft_list_snapshots snapshot
       LEFT JOIN LATERAL (
         SELECT d.*,
           (extract(epoch FROM i.sort_created_at)*1000000)::bigint::text AS sort_created_at_us
         FROM meeting_draft_list_snapshot_items i
         JOIN meeting_drafts d
           ON d.account_id=i.account_id AND d.id=i.draft_id
         WHERE i.account_id=snapshot.account_id AND i.snapshot_id=snapshot.id
           AND d.created_by_user_id=$2
           AND ${CURRENT_CONTENT_PREDICATE}
           ${beforePredicate}
         ORDER BY i.sort_created_at DESC,i.draft_id DESC
         LIMIT $${limitParameter}
       ) page ON TRUE
       WHERE snapshot.account_id=$1 AND snapshot.created_by_user_id=$2
         AND snapshot.id=$3 AND snapshot.scope=$4
         AND snapshot.expires_at>statement_timestamp()`,
      parameters,
    );
  if (!result.rows.length) {
    throw new ApiError(
      410,
      "MEETING_DRAFT_CURSOR_EXPIRED",
      "The meeting draft list cursor expired; restart from the first page.",
    );
  }
  const rows = result.rows.filter((row): row is PageRow => row.id !== null);
  const page = rows.slice(0, effectiveLimit);
  const complete = rows.length <= effectiveLimit;
  const last = page.at(-1);
  if (complete) {
    await client.query(
      `DELETE FROM meeting_draft_list_snapshots
       WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3`,
      [auth.accountId, auth.userId, cursor.snapshot_id],
    );
  }
  return {
    contract_version: CONTRACT_VERSION,
    drafts: page.map(record),
    complete,
    next_cursor: complete || !last
      ? null
      : encodeCursor({
          ...cursor,
          before_us: last.sort_created_at_us,
          before_id: last.id,
        }),
  };
}

export async function updateMeetingDraft(
  pool: Pool,
  auth: AuthContext,
  id: string,
  request: MeetingDraftUpdateRequest,
): Promise<MeetingDraftRecord> {
  const draftID = id.toLowerCase();
  const idempotencyKey = request.idempotency_key.toLowerCase();
  const title = request.title.trim();
  const start = Date.parse(request.starts_at);
  const end = Date.parse(request.ends_at);
  if (
    !title ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 7 * 86_400_000
  ) {
    throw new ApiError(
      400,
      "MEETING_DRAFT_INVALID",
      "The reviewed title and interval are invalid.",
    );
  }
  const normalized = {
    title,
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
  };
  const requestHash = digestValue({
    expected_revision: request.expected_revision,
    ...normalized,
  });

  await redactUnavailable(pool, auth.accountId);
  try {
    return await inTransaction(pool, async (tx) => {
      const replay = await replayMeetingDraftOperation(tx, auth, {
      draftID,
      idempotencyKey,
      operation: "edit",
      requestHash,
    });
      if (replay) return replay;
      const row = (
      await tx.query<MeetingDraftAuthorityRow>(
        `SELECT origin_session_id,revision,source_task_id,status
         FROM meeting_drafts
         WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3
         FOR UPDATE`,
        [auth.accountId, auth.userId, draftID],
      )
      ).rows[0];
      if (!row) throw missing();
      if (row.status !== "needs_review") {
      throw new ApiError(
        409,
        "MEETING_DRAFT_UNAVAILABLE",
        "This draft is no longer reviewable.",
      );
      }
      if (row.revision !== request.expected_revision) {
      throw new ApiError(
        409,
        "MEETING_DRAFT_REVISION_CONFLICT",
        "Read the current draft before changing it.",
      );
      }
      const updated = (
      await tx.query<MeetingDraftRow>(
        `UPDATE meeting_drafts SET
           title=$4,starts_at=$5,ends_at=$6,updated_at=clock_timestamp(),
           revision=revision+1,edit_idempotency_key=$7,edit_request_hash=$8
         WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3
           AND status='needs_review'
           AND expires_at>clock_timestamp()
           AND meeting_draft_source_available(
             account_id,origin_session_id,source_task_id
           )
         RETURNING *`,
        [
          auth.accountId,
          auth.userId,
          draftID,
          normalized.title,
          normalized.starts_at,
          normalized.ends_at,
          idempotencyKey,
          requestHash,
        ],
      )
      ).rows[0];
      if (!updated) {
        throw new ApiError(
        409,
        "MEETING_DRAFT_UNAVAILABLE",
        "This draft expired or its source authority changed before the edit.",
        );
      }
      await appendAudit(
      tx,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "meeting_draft.edited",
      "meeting_draft",
      draftID,
      {
        source_task_id: row.source_task_id,
        origin_session_id: row.origin_session_id,
        external_effect: "none",
        changed_fields: ["title", "starts_at", "ends_at"],
        revision: updated.revision,
      },
      );
      await recordMeetingDraftOperation(tx, auth, {
      draftID,
      idempotencyKey,
      operation: "edit",
      requestHash,
      responseRevision: updated.revision,
      });
      return record(updated);
    });
  } catch (error) {
    // The final conditional write can observe expiry/source revocation after
    // the preflight sweep. Persist its tombstone outside the rolled-back write.
    await redactUnavailable(pool, auth.accountId);
    throw error;
  }
}

/**
 * Idempotent dismiss. A retry with the same idempotency key returns the stored
 * result; a new key with a stale revision is rejected. Source revocation,
 * expiry, or redaction still produces a non-sensitive tombstone.
 */
export async function dismissMeetingDraft(
  pool: Pool,
  auth: AuthContext,
  id: string,
  request: { expected_revision: number; idempotency_key: string },
): Promise<MeetingDraftRecord> {
  const draftID = id.toLowerCase();
  const idempotencyKey = request.idempotency_key.toLowerCase();
  const requestHash = digestValue({
    expected_revision: request.expected_revision,
  });
  await redactUnavailable(pool, auth.accountId);
  try {
    return await inTransaction(pool, async (tx) => {
      const replay = await replayMeetingDraftOperation(tx, auth, {
      draftID,
      idempotencyKey,
      operation: "dismiss",
      requestHash,
    });
      if (replay) return replay;
      const row = (
      await tx.query<MeetingDraftAuthorityRow>(
        `SELECT origin_session_id,revision,source_task_id,status
         FROM meeting_drafts
         WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3
         FOR UPDATE`,
        [auth.accountId, auth.userId, draftID],
      )
      ).rows[0];
      if (!row) throw missing();
      if (row.status === "redacted" || row.status === "expired") {
      throw new ApiError(
        409,
        "MEETING_DRAFT_UNAVAILABLE",
        "This draft is no longer reviewable and cannot be dismissed.",
      );
      }
      if (row.status === "dismissed") {
      throw new ApiError(
        409,
        "MEETING_DRAFT_ALREADY_DISMISSED",
        "This draft was already dismissed.",
      );
      }
      if (row.revision !== request.expected_revision) {
      throw new ApiError(
        409,
        "MEETING_DRAFT_REVISION_CONFLICT",
        "Read the current draft before changing it.",
      );
      }
      const updated = (
      await tx.query<MeetingDraftRow>(
        `UPDATE meeting_drafts SET
           status='dismissed', dismissed_at=clock_timestamp(),
           updated_at=clock_timestamp(),
           revision=revision+1, dismiss_idempotency_key=$4
         WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3
           AND status='needs_review'
           AND expires_at>clock_timestamp()
           AND meeting_draft_source_available(
             account_id,origin_session_id,source_task_id
           )
         RETURNING *`,
        [auth.accountId, auth.userId, draftID, idempotencyKey],
      )
      ).rows[0];
      if (!updated) {
        throw new ApiError(
        409,
        "MEETING_DRAFT_UNAVAILABLE",
        "This draft expired or its source authority changed before dismissal.",
        );
      }
      await appendAudit(
      tx,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "meeting_draft.dismissed",
      "meeting_draft",
      draftID,
      {
        source_task_id: row.source_task_id,
        origin_session_id: row.origin_session_id,
        external_effect: "none",
        disposition: "dismissed",
        revision: updated.revision,
      },
      );
      await recordMeetingDraftOperation(tx, auth, {
      draftID,
      idempotencyKey,
      operation: "dismiss",
      requestHash,
      responseRevision: updated.revision,
      });
      return record(updated);
    });
  } catch (error) {
    await redactUnavailable(pool, auth.accountId);
    throw error;
  }
}

export function meetingDraftResponse(
  draft: MeetingDraftRecord,
): MeetingDraftResponse {
  return { contract_version: CONTRACT_VERSION, draft };
}
