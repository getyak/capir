import { randomUUID } from "node:crypto";

import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  AgentSessionMutationRequestSchema,
  AgentSessionDeleteRequestSchema,
  CONTRACT_VERSION,
  type AgentSessionPayload,
  type AgentSessionRecord,
  type AgentSessionMutationRequest,
  type AgentSessionDeleteRequest,
  type AgentSessionListResponse,
} from "@talent-signal/contracts";
import type { Pool } from "pg";
import { inTransaction, type DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { digestValue, sha256 } from "../lib/hash.js";
import { assertAccountActive } from "./accountIdentity.js";
import type { AuthContext } from "./auth.js";
import { invalidateMcpInteractionsForSession } from "./mcpInteractions.js";
import {
  inheritedSessionChatSources,
  loadSessionScreenshotContexts,
  screenshotConversationText,
  type AgentSessionChatSource,
} from "./agentSessionSources.js";
import { sweepHarnessSessions } from "./harnessSessions.js";
import { sweepConversationQueue } from "./conversationQueueSweep.js";
import { assertConversationQueueOwnedClaim, type ConversationQueueRunFence } from "./conversationQueueState.js";
import { invalidateMemoriesForSessionIds } from "./memoryReviewRecall.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!FormatRegistry.Has("uuid"))
  FormatRegistry.Set("uuid", (value) => UUID.test(value));
if (!FormatRegistry.Has("date-time"))
  FormatRegistry.Set(
    "date-time",
    (value) =>
      /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)),
  );
const DAY = 86_400_000;
const MICROSECONDS = /^(?:0|[1-9]\d{0,18})$/u;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const MAX_SESSION_SNAPSHOT_ITEMS = 5_000;
const MAX_ACTIVE_SESSION_SNAPSHOTS = 4;

type AgentSessionListCursor = {
  v: 1;
  snapshot_id: string;
  before_us: string | null;
  before_id: string | null;
};

function validMicroseconds(value: string | undefined): value is string {
  return Boolean(
    value &&
    MICROSECONDS.test(value) &&
    BigInt(value) <= POSTGRES_BIGINT_MAX,
  );
}

function encodeAgentSessionListCursor(cursor: AgentSessionListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeAgentSessionListCursor(value: string): AgentSessionListCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<AgentSessionListCursor>;
    if (
      parsed.v !== 1 ||
      !UUID.test(parsed.snapshot_id ?? "") ||
      ((parsed.before_us === null) !== (parsed.before_id === null)) ||
      (parsed.before_us !== null && !validMicroseconds(parsed.before_us)) ||
      (parsed.before_id !== null && !UUID.test(parsed.before_id ?? ""))
    ) {
      throw new Error("invalid_cursor");
    }
    return parsed as AgentSessionListCursor;
  } catch {
    throw new ApiError(
      400,
      "AGENT_SESSION_CURSOR_INVALID",
      "The Session list cursor is invalid.",
    );
  }
}
function canonicalID(value: string): string {
  return UUID.test(value) ? value.toLowerCase() : value;
}
function sameID(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return left == null || right == null
    ? left == null && right == null
    : canonicalID(left) === canonicalID(right);
}
function normalizeSessionIdentifiers(
  value: AgentSessionPayload,
): AgentSessionPayload {
  const payload = structuredClone(value);
  for (const key of [
    "id",
    "personID",
    "relationshipContextID",
    "identityResolutionCaseID",
    "originSessionID",
    "originTurnID",
  ] as const) {
    const current = payload[key];
    if (current != null) payload[key] = canonicalID(current);
  }
  if (payload.screenshotTaskIDs)
    payload.screenshotTaskIDs = payload.screenshotTaskIDs.map(canonicalID);
  if (payload.inheritedScreenshotTaskIDs)
    payload.inheritedScreenshotTaskIDs =
      payload.inheritedScreenshotTaskIDs.map(canonicalID);
  for (const turn of payload.turns) {
    turn.id = canonicalID(turn.id);
    for (const message of turn.steeredMessages ?? []) message.id = canonicalID(message.id);
    for (const key of [
      "taskID",
      "contextManifestID",
      "knowledgeSnapshotID",
    ] as const)
      turn.response[key] = canonicalID(turn.response[key]);
    for (const media of turn.response.media ?? [])
      media.id = canonicalID(media.id);
  }
  for (const receipt of payload.contactReceipts ?? []) {
    for (const key of [
      "id",
      "captureID",
      "resourceID",
      "duplicateOfResourceID",
      "personID",
      "relationshipContextID",
      "resolutionCaseID",
    ] as const) {
      const current = receipt[key];
      if (current != null) receipt[key] = canonicalID(current);
    }
  }
  if (payload.contactProposal) {
    for (const key of ["sessionID", "sourceMessageID"] as const) {
      const current = payload.contactProposal[key];
      if (current != null) payload.contactProposal[key] = canonicalID(current);
    }
  }
  return payload;
}

type AgentSessionDisplayBlock = NonNullable<
  AgentSessionPayload["turns"][number]["response"]["savedBlocks"]
>[number];
const displayBlockCollections = [
  "savedBlocks",
  "unboundPersonResearchBlocks",
  "unboundConversationBlocks",
] as const;

function shareClassificationComparable(block: AgentSessionDisplayBlock) {
  const copy = structuredClone(block);
  delete copy.allows_static_share;
  return copy;
}

/** The exact immutable turn identity shared by share and image preservation. */
function sameImmutableTurn(
  candidate: AgentSessionPayload["turns"][number],
  turn: AgentSessionPayload["turns"][number],
): boolean {
  return (
    sameID(candidate.id, turn.id) &&
    candidate.objective === turn.objective &&
    Date.parse(candidate.createdAt) === Date.parse(turn.createdAt) &&
    sameID(candidate.response.taskID, turn.response.taskID) &&
    sameID(
      candidate.response.contextManifestID,
      turn.response.contextManifestID,
    )
  );
}

/** Only the fenced queue writer can create execution receipts or folded input.
 * Legacy saves restore omitted server fields; changed identity or content fails
 * closed. A deleted whole turn remains deletable, but JSON cannot forge a fold.
 */
function preserveExecutionProvenance(
  payload: AgentSessionPayload,
  previous: AgentSessionPayload | null,
  queueMessageID?: string,
): void {
  for (const turn of payload.turns) {
    const before = previous?.turns.find((candidate) => sameID(candidate.id, turn.id));
    if (!before && queueMessageID && sameID(turn.id, queueMessageID)) continue;
    if (before && (before.steeredMessages !== undefined || before.response.execution !== undefined
      || before.response.mcpInteraction !== undefined || before.response.hostResult !== undefined)
      && !sameImmutableTurn(before, turn)) {
      throw new ApiError(409, "AGENT_SESSION_EXECUTION_PROVENANCE_CHANGED",
        "A stored execution's message identity cannot be rewritten.");
    }
    if (before?.response.execution !== undefined) {
      // The queue's canonical answer is already retained in this Session. Keep
      // it immutable instead of duplicating private prose into another store.
      for (const collection of displayBlockCollections) {
        const stored = before.response[collection];
        const current = turn.response[collection];
        if (current != null && digestValue(current.map(shareClassificationComparable))
          !== digestValue((stored ?? []).map(shareClassificationComparable))) {
          throw new ApiError(409, "AGENT_SESSION_EXECUTION_PROVENANCE_CHANGED",
            "A stored execution's canonical answer cannot be rewritten.");
        }
        if (stored != null && current == null)
          turn.response[collection] = structuredClone(stored);
      }
    }
    // Server-issued execution, steering and MCP provenance are immutable to
    // clients: a legacy save that omits a stored reference restores it (the
    // card survives), and a client can never create or change one — including
    // host-only human results and forged or wrong-turn request references.
    for (const field of ["steeredMessages", "execution", "mcpInteraction", "hostResult"] as const) {
      const current = field === "steeredMessages" ? turn.steeredMessages
        : (turn.response as Record<string, unknown>)[field];
      const stored = field === "steeredMessages" ? before?.steeredMessages
        : (before?.response as Record<string, unknown> | undefined)?.[field];
      if (current !== undefined && digestValue(current) !== digestValue(stored ?? null)) {
        throw new ApiError(409, "AGENT_SESSION_EXECUTION_PROVENANCE_CHANGED",
          "Only the owned queue can create or change execution provenance.");
      }
      if (stored !== undefined && current === undefined) {
        if (field === "steeredMessages") turn.steeredMessages = structuredClone(before!.steeredMessages!);
        else (turn.response as Record<string, unknown>)[field] = structuredClone(stored);
      }
    }
  }
}

/**
 * Existing clients decode and re-encode a Session without the inline image
 * manifest. The server owns that manifest: a legacy PUT that drops the field
 * restores the stored one, while a changed or newly forged manifest for an
 * existing immutable turn is refused instead of erasing or rewriting pixels.
 * New turns may carry their own manifest because attachment ownership still
 * comes from the owned queue record, never from this JSON.
 */
function preserveExistingTurnImages(
  payload: AgentSessionPayload,
  previous: AgentSessionPayload | null,
): void {
  if (!previous) return;
  for (const turn of payload.turns) {
    const before = previous.turns.find((candidate) =>
      sameImmutableTurn(candidate, turn),
    );
    if (!before) continue;
    if (turn.images === undefined) {
      if (before.images !== undefined)
        turn.images = structuredClone(before.images);
      continue;
    }
    if (digestValue(turn.images) !== digestValue(before.images ?? [])) {
      throw new ApiError(
        409,
        "AGENT_SESSION_IMAGE_MANIFEST_CHANGED",
        "A stored turn's image manifest cannot be changed by a later save.",
      );
    }
  }
}

/**
 * Old clients decode and re-encode a Session without the GET-27 share field.
 * Preserve the server's prior decision only for the exact same immutable turn
 * and display block. Any changed or newly introduced block stays unclassified
 * so current clients fail closed instead of inheriting stale share authority.
 */
function preserveExistingShareClassifications(
  payload: AgentSessionPayload,
  previous: AgentSessionPayload | null,
): void {
  if (!previous) return;
  for (const turn of payload.turns) {
    const before = previous.turns.find((candidate) =>
      sameImmutableTurn(candidate, turn),
    );
    if (!before) continue;
    for (const collection of displayBlockCollections) {
      const currentBlocks = turn.response[collection] ?? [];
      const previousBlocks = before.response[collection] ?? [];
      for (const block of currentBlocks) {
        if (block.allows_static_share !== undefined) continue;
        const previousBlock = previousBlocks.find(
          (candidate) => sameID(candidate.id, block.id),
        );
        if (
          previousBlock?.allows_static_share !== undefined &&
          digestValue(shareClassificationComparable(previousBlock)) ===
            digestValue(shareClassificationComparable(block))
        ) {
          block.allows_static_share = previousBlock.allows_static_share;
        }
      }
    }
  }
}
interface Row {
  id: string;
  created_by_user_id: string;
  revision: number;
  payload: AgentSessionPayload | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  deleted_at: Date | null;
  composer_draft_hash: string | null;
  composer_draft_started_at: Date | null;
}
const missing = () =>
  new ApiError(
    404,
    "AGENT_SESSION_NOT_FOUND",
    "The Session is not available in this account and user scope.",
  );
function record(row: Row): AgentSessionRecord {
  return {
    session_id: row.id,
    revision: row.revision,
    payload: row.payload ? normalizeSessionIdentifiers(row.payload) : null,
    updated_at: row.updated_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    deleted_at: row.deleted_at?.toISOString() ?? null,
    display_authority: "stale_unconfirmed",
  };
}
async function rowFor(
  client: DatabaseClient,
  auth: AuthContext,
  id: string,
): Promise<Row | null> {
  const row = (
    await client.query<Row>(
      "SELECT * FROM agent_sessions WHERE account_id=$1 AND id=$2",
      [auth.accountId, id],
    )
  ).rows[0];
  if (row && !sameID(row.created_by_user_id, auth.userId)) throw missing();
  return row ?? null;
}
export async function sweepAgentSessions(
  client: DatabaseClient,
  accountId?: string,
): Promise<void> {
  await sweepHarnessSessions(client, accountId);
  // Retention first closes every MCP human request and OAuth capability bound
  // to a Session that is about to disappear, and removes its private derived
  // payloads, before the Session content itself is purged.
  const expiring = await client.query<{ account_id: string; id: string }>(
    `SELECT account_id, id FROM agent_sessions
     WHERE deleted_at IS NULL AND expires_at<=now()
       AND ($1::uuid IS NULL OR account_id=$1)`,
    [accountId ?? null],
  );
  for (const session of expiring.rows) {
    await invalidateMcpInteractionsForSession(client, session.account_id, session.id);
  }
  await client.query(
    `UPDATE agent_sessions SET payload=NULL,deleted_at=now(),updated_at=now(),revision=revision+1
    WHERE deleted_at IS NULL AND expires_at<=now() AND ($1::uuid IS NULL OR account_id=$1)`,
    [accountId ?? null],
  );
  await client.query(
    "SELECT retract_agent_session_tasks(account_id,payload) FROM agent_sessions WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR account_id=$1)",
    [accountId ?? null],
  );
  await client.query(
    "SELECT retract_agent_session_chat_sources(account_id) FROM (SELECT DISTINCT account_id FROM agent_session_chat_sources WHERE $1::uuid IS NULL OR account_id=$1) owners",
    [accountId ?? null],
  );
  await client.query(
    "SELECT purge_agent_session_chat_tasks(account_id) FROM (SELECT DISTINCT account_id FROM agent_session_chat_tasks WHERE $1::uuid IS NULL OR account_id=$1) owners",
    [accountId ?? null],
  );
  await client.query(
    `UPDATE agent_sessions SET payload=redact_agent_session_payload(account_id,payload),updated_at=now(),revision=revision+1
    WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR account_id=$1)
    AND payload IS DISTINCT FROM redact_agent_session_payload(account_id,payload)`,
    [accountId ?? null],
  );
  await sweepConversationQueue(client, accountId);
}

/**
 * Physical list-snapshot retention runs outside Session business transactions.
 * Its caller must surface failures so an operator can repair persistent cleanup
 * faults without rolling back sensitive-content scrubbing or user mutations.
 */
export async function cleanupExpiredAgentSessionListSnapshots(
  client: Pool,
  accountId?: string,
): Promise<void> {
  await client.query(
    `DELETE FROM agent_session_list_snapshots
     WHERE expires_at<=statement_timestamp()
       AND ($1::uuid IS NULL OR account_id=$1)`,
    [accountId ?? null],
  );
}

export async function runAgentSessionRetentionSweep(
  client: Pool,
): Promise<void> {
  // Finish and commit the security-sensitive sweep before auxiliary snapshot
  // cleanup starts in its own autocommit statement.
  await sweepAgentSessions(client);
  await cleanupExpiredAgentSessionListSnapshots(client);
}
export async function getAgentSession(
  client: DatabaseClient,
  auth: AuthContext,
  id: string,
): Promise<AgentSessionRecord> {
  await sweepAgentSessions(client, auth.accountId);
  const row = await rowFor(client, auth, id);
  if (!row) throw missing();
  return record(row);
}
export async function listAgentSessions(
  client: Pool,
  auth: AuthContext,
  after?: string,
  limit = 50,
): Promise<AgentSessionListResponse> {
  await sweepAgentSessions(client, auth.accountId);
  const effectiveLimit = Math.min(50, Math.max(1, limit));
  let cursor = after ? decodeAgentSessionListCursor(after) : null;
  if (!cursor) {
    const snapshotID = randomUUID();
    await inTransaction(client, async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`agent-session-list:${auth.accountId}:${auth.userId}`],
      );
      // Keep a small multi-tab window while bounding live identity rows. The
      // authenticated route rate bucket separately bounds materialization
      // write/CPU amplification.
      await tx.query(
        `DELETE FROM agent_session_list_snapshots
         WHERE account_id=$1 AND created_by_user_id=$2 AND id IN (
           SELECT id FROM agent_session_list_snapshots
           WHERE account_id=$1 AND created_by_user_id=$2
           ORDER BY created_at DESC,id DESC
           OFFSET $3
         )`,
        [
          auth.accountId,
          auth.userId,
          MAX_ACTIVE_SESSION_SNAPSHOTS - 1,
        ],
      );
      const materialized = await tx.query(
        `WITH snapshot AS (
           INSERT INTO agent_session_list_snapshots(
             account_id,id,created_by_user_id,expires_at
           ) VALUES($1,$3,$2,clock_timestamp()+interval '5 minutes')
           RETURNING account_id,id
         )
         INSERT INTO agent_session_list_snapshot_items(
           account_id,snapshot_id,session_id,sort_updated_at
         )
         SELECT snapshot.account_id,snapshot.id,sessions.id,sessions.updated_at
         FROM snapshot
         JOIN agent_sessions sessions ON sessions.account_id=snapshot.account_id
         WHERE sessions.created_by_user_id=$2
         ORDER BY sessions.updated_at DESC,sessions.id DESC
         LIMIT $4`,
        [
          auth.accountId,
          auth.userId,
          snapshotID,
          MAX_SESSION_SNAPSHOT_ITEMS + 1,
        ],
      );
      if ((materialized.rowCount ?? 0) > MAX_SESSION_SNAPSHOT_ITEMS) {
        throw new ApiError(
          413,
          "AGENT_SESSION_LIST_TOO_LARGE",
          "The Session list is too large to snapshot safely.",
        );
      }
    });
    cursor = {
      v: 1,
      snapshot_id: snapshotID,
      before_us: null,
      before_id: null,
    };
  }
  const beforePredicate = cursor.before_us === null
    ? ""
    : `AND ((extract(epoch FROM item.sort_updated_at)*1000000)::bigint,item.session_id)
           < ($4::bigint,$5::uuid)`;
  const parameters: unknown[] = [
    auth.accountId,
    auth.userId,
    cursor.snapshot_id,
  ];
  if (cursor.before_us !== null) {
    parameters.push(cursor.before_us, cursor.before_id);
  }
  parameters.push(effectiveLimit + 1);
  const limitParameter = parameters.length;
  type PageRow = Row & {
    snapshot_marker: string;
    sort_updated_at_us: string;
  };
  type EmptyPageRow = {
    id: null;
    snapshot_marker: string;
    sort_updated_at_us: null;
  };
  const result = await client.query<PageRow | EmptyPageRow>(
    `SELECT snapshot.id AS snapshot_marker,page.*
     FROM agent_session_list_snapshots snapshot
     LEFT JOIN LATERAL (
       SELECT sessions.*,
         (extract(epoch FROM item.sort_updated_at)*1000000)::bigint::text
           AS sort_updated_at_us
       FROM agent_session_list_snapshot_items item
       JOIN agent_sessions sessions
         ON sessions.account_id=item.account_id AND sessions.id=item.session_id
       WHERE item.account_id=snapshot.account_id
         AND item.snapshot_id=snapshot.id
         AND sessions.created_by_user_id=$2
         ${beforePredicate}
       ORDER BY item.sort_updated_at DESC,item.session_id DESC
       LIMIT $${limitParameter}
     ) page ON TRUE
     WHERE snapshot.account_id=$1 AND snapshot.created_by_user_id=$2
       AND snapshot.id=$3 AND snapshot.expires_at>statement_timestamp()`,
    parameters,
  );
  if (!result.rows.length) {
    throw new ApiError(
      410,
      "AGENT_SESSION_CURSOR_EXPIRED",
      "The Session list cursor expired; restart from the first page.",
    );
  }
  const rows = result.rows.filter((row): row is PageRow => row.id !== null);
  const page = rows.slice(0, effectiveLimit);
  const complete = rows.length <= effectiveLimit;
  const last = page.at(-1);
  if (complete) {
    try {
      await client.query(
        `DELETE FROM agent_session_list_snapshots
         WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3`,
        [auth.accountId, auth.userId, cursor.snapshot_id],
      );
    } catch {
      // Completion cleanup must not hide a successful canonical read. The
      // observable recurring sweep owns eventual physical retention cleanup.
    }
  }
  return {
    contract_version: CONTRACT_VERSION,
    sessions: page.map(record),
    complete,
    next_cursor: complete || !last
      ? null
      : encodeAgentSessionListCursor({
          ...cursor,
          before_us: last.sort_updated_at_us,
          before_id: last.id,
        }),
  };
}
function invalid(message: string): never {
  throw new ApiError(400, "AGENT_SESSION_INVALID", message);
}
function future(value: string): boolean {
  return Date.parse(value) > Date.now() + 5 * 60_000;
}
interface CanonicalSessionManifest {
  id: string;
  task_id: string;
  subject_id: string;
  assignment_id: string | null;
  knowledge_snapshot_id: string;
}
async function canonicalSessionManifests(
  client: DatabaseClient,
  auth: AuthContext,
  taskIDs: string[],
) {
  const rows = (
    await client.query<CanonicalSessionManifest>(
      "SELECT id,task_id,subject_id,assignment_id,knowledge_snapshot_id FROM context_manifests WHERE account_id=$1 AND task_id::text=ANY($2::text[])",
      [auth.accountId, taskIDs.map(canonicalID)],
    )
  ).rows;
  return new Map(rows.map((row) => [row.task_id, row]));
}
async function lockAgentSessionSources(
  client: DatabaseClient,
  auth: AuthContext,
  payload: AgentSessionPayload,
) {
  const taskIDs = [
    ...new Set(payload.turns.map((turn) => canonicalID(turn.response.taskID))),
  ];
  // Lock source authority before the Session row. An overlapping source transition
  // either commits first and is re-read, or waits and redacts the newly saved row.
  await client.query(
    `SELECT m.id FROM context_manifests m
    JOIN knowledge_snapshots s ON s.account_id=m.account_id AND s.id=m.knowledge_snapshot_id
    JOIN subjects p ON p.account_id=m.account_id AND p.id=m.subject_id
    JOIN assignments a ON a.account_id=m.account_id AND a.id=m.assignment_id
    WHERE m.account_id=$1 AND m.task_id::text=ANY($2::text[]) FOR SHARE OF m,s,p,a NOWAIT`,
    [auth.accountId, taskIDs.map(canonicalID)],
  );
  await client.query(
    `SELECT f.id FROM context_manifests m
    JOIN context_manifest_evidence me ON me.account_id=m.account_id AND me.manifest_id=m.id
    JOIN evidence_fragments f ON f.account_id=me.account_id AND f.id=me.evidence_fragment_id
    JOIN source_resources r ON r.account_id=f.account_id AND r.id=f.resource_id
    JOIN captures c ON c.account_id=r.account_id AND c.id=r.capture_id
    JOIN source_retention_receipts sr ON sr.account_id=c.account_id AND sr.capture_id=c.id
    WHERE m.account_id=$1 AND m.task_id::text=ANY($2::text[]) FOR SHARE OF me,f,r,c,sr NOWAIT`,
    [auth.accountId, taskIDs.map(canonicalID)],
  );
  const screenshotIDs = [
    ...new Set([...taskIDs, ...(payload.screenshotTaskIDs ?? [])]),
  ];
  await client.query(
    `SELECT id FROM screenshot_contact_tasks WHERE account_id=$1 AND created_by_user_id=$2
    AND id::text=ANY($3::text[]) FOR SHARE NOWAIT`,
    [auth.accountId, auth.userId, screenshotIDs],
  );
  await client.query(
    `SELECT c.id FROM screenshot_contact_tasks t
    JOIN captures c ON c.account_id=t.account_id AND c.id=t.capture_id
    JOIN source_retention_receipts sr ON sr.account_id=c.account_id AND sr.capture_id=c.id
    WHERE t.account_id=$1 AND t.created_by_user_id=$2 AND t.id::text=ANY($3::text[]) FOR SHARE OF c,sr NOWAIT`,
    [auth.accountId, auth.userId, screenshotIDs],
  );
}
function prepareComposerDraft(
  auth: AuthContext,
  id: string,
  payload: AgentSessionPayload,
  existing: Row | null,
) {
  if (payload.composerDraft == null) return null;
  const hash = sha256(
    `${auth.accountId.toLowerCase()}:${id.toLowerCase()}:${payload.composerDraft}`,
  );
  const started =
    existing?.composer_draft_hash === hash && existing.composer_draft_started_at
      ? existing.composer_draft_started_at
      : new Date(
          Math.min(
            Date.now(),
            Date.parse(
              payload.composerDraftUpdatedAt ?? new Date().toISOString(),
            ),
          ),
        );
  // The database retains this digest/clock even after expiration, fencing an
  // offline retry that attempts to give unchanged content a fresh deadline.
  payload.composerDraftUpdatedAt = started.toISOString();
  return { hash, startedAt: started };
}
async function validatePayload(
  client: DatabaseClient,
  auth: AuthContext,
  id: string,
  payload: AgentSessionPayload,
  previous: AgentSessionPayload | null,
) {
  if (payload.id.toLowerCase() !== id.toLowerCase())
    invalid("The Session ID must match its route.");
  if (
    future(payload.updatedAt) ||
    (payload.createdAt != null && future(payload.createdAt)) ||
    payload.turns.some((turn) => future(turn.createdAt))
  )
    invalid("Session timestamps cannot be in the future.");
  if (payload.composerDraftUpdatedAt && future(payload.composerDraftUpdatedAt))
    invalid("A composer draft cannot start in the future.");
  const screenshotAdmission = [
    payload.pendingScreenshotIdempotencyKey,
    payload.pendingScreenshotRequestIdentity,
    payload.pendingScreenshotCapturedAt,
  ];
  if (screenshotAdmission.some((value) => value != null)) {
    if (
      screenshotAdmission.some((value) => value == null) ||
      !payload.pendingObjective?.trim()
    ) {
      invalid(
        "Screenshot recovery requires its original key, hash, capture time, and objective.",
      );
    }
    if (future(payload.pendingScreenshotCapturedAt!)) {
      invalid("The original screenshot capture time cannot be in the future.");
    }
    if (
      previous?.pendingScreenshotIdempotencyKey &&
      (previous.pendingScreenshotIdempotencyKey !==
        payload.pendingScreenshotIdempotencyKey ||
        previous.pendingScreenshotRequestIdentity !==
          payload.pendingScreenshotRequestIdentity ||
        Date.parse(previous.pendingScreenshotCapturedAt!) !==
          Date.parse(payload.pendingScreenshotCapturedAt!) ||
        previous.pendingObjective !== payload.pendingObjective)
    ) {
      invalid(
        "An unresolved screenshot admission must keep its original request identity and capture time.",
      );
    }
  }
  const humanMessageIDs = payload.turns.flatMap((turn) =>
    [turn.id, ...(turn.steeredMessages ?? []).map((message) => message.id)].map(canonicalID),
  );
  if (new Set(humanMessageIDs).size !== humanMessageIDs.length)
    invalid("Message IDs must be unique within a Session.");
  if (payload.scopeKind === "relationship") {
    if (
      !payload.personID ||
      !payload.relationshipContextID ||
      payload.identityResolutionCaseID
    )
      invalid("A relationship Session needs exactly one person and context.");
    const match = await client.query(
      `SELECT 1 FROM assignments a JOIN subjects s ON s.account_id=a.account_id AND s.id=a.subject_id
      WHERE a.account_id=$1 AND a.id=$2 AND a.subject_id=$3 AND a.status='active' AND s.status='active'`,
      [auth.accountId, payload.relationshipContextID, payload.personID],
    );
    if (!match.rowCount) throw missing();
  } else if (payload.scopeKind === "identity_review") {
    if (
      !payload.identityResolutionCaseID ||
      payload.personID ||
      payload.relationshipContextID
    )
      invalid("An identity-review Session needs exactly one case.");
    if (
      !(
        await client.query(
          "SELECT 1 FROM identity_resolution_cases WHERE account_id=$1 AND id=$2 AND status<>'deleted'",
          [auth.accountId, payload.identityResolutionCaseID],
        )
      ).rowCount
    )
      throw missing();
  } else if (
    payload.personID ||
    payload.relationshipContextID ||
    payload.identityResolutionCaseID
  )
    invalid("An unbound Session cannot claim a relationship scope.");
  if (previous) {
    if (
      previous.createdAt != null &&
      (payload.createdAt == null ||
        Date.parse(previous.createdAt) !== Date.parse(payload.createdAt))
    )
      invalid("The original Session creation time cannot change.");
    // Clients round-trip ISO timestamps at JavaScript millisecond precision.
    // Equivalent representations must retain the server's original immutable
    // value, including any greater precision recorded by the originating client.
    if (previous.createdAt != null) payload.createdAt = previous.createdAt;
    if (
      previous.scopeKind === "relationship" &&
      (payload.scopeKind !== previous.scopeKind ||
        !sameID(payload.personID, previous.personID) ||
        !sameID(payload.relationshipContextID, previous.relationshipContextID))
    )
      invalid(
        "An established relationship scope cannot be moved; start a new Session.",
      );
    if (
      !sameID(previous.originSessionID, payload.originSessionID) ||
      !sameID(previous.originTurnID, payload.originTurnID) ||
      previous.originKind !== payload.originKind
    )
      invalid("Fork provenance is immutable.");
    for (let index = 0; index < previous.turns.length; index++) {
      const before = previous.turns[index]!;
      const after = payload.turns[index];
      if (!after || !sameImmutableTurn(after, before))
        invalid("Existing message identity and order must be preserved.");
      after.createdAt = before.createdAt;
    }
  }
  if (payload.originKind && !payload.originSessionID)
    invalid("Local lineage requires its original Session and message IDs.");
  if (Boolean(payload.originSessionID) !== Boolean(payload.originTurnID))
    invalid("Fork provenance requires its source Session and message.");
  if (payload.originSessionID && !previous) {
    if (payload.originSessionID.toLowerCase() === id.toLowerCase())
      invalid("A Session cannot fork itself.");
    const origin = await rowFor(client, auth, payload.originSessionID);
    if (
      !origin &&
      payload.originKind === "local" &&
      (
        await client.query("SELECT 1 FROM agent_sessions WHERE id=$1 LIMIT 1", [
          payload.originSessionID,
        ])
      ).rowCount
    )
      throw missing();
    if (origin?.deleted_at || (origin && origin.expires_at <= new Date()))
      throw missing();
    if (
      payload.originKind !== "local" &&
      (!origin?.payload ||
        !origin.payload.turns.some((t) => sameID(t.id, payload.originTurnID)))
    )
      throw missing();
  }
  const taskIDs = payload.screenshotTaskIDs ?? [];
  const inheritedIDs = payload.inheritedScreenshotTaskIDs ?? [];
  if (
    new Set(inheritedIDs).size !== inheritedIDs.length ||
    inheritedIDs.some((taskID) => !taskIDs.includes(taskID))
  )
    invalid(
      "Inherited screenshot references must be unique retained task references.",
    );
  if (
    previous?.inheritedScreenshotTaskIDs != null &&
    (payload.inheritedScreenshotTaskIDs == null ||
      previous.inheritedScreenshotTaskIDs.length !== inheritedIDs.length ||
      previous.inheritedScreenshotTaskIDs.some(
        (taskID) => !inheritedIDs.includes(canonicalID(taskID)),
      ))
  )
    invalid(
      "Inherited screenshot references cannot be promoted to live tasks.",
    );
  if (
    previous &&
    previous.inheritedScreenshotTaskIDs == null &&
    payload.inheritedScreenshotTaskIDs != null &&
    (previous.screenshotTaskIDs ?? []).some(
      (taskID) => !inheritedIDs.includes(canonicalID(taskID)),
    )
  )
    invalid(
      "Migrating inherited screenshot references must preserve every previous task reference.",
    );
  if (
    taskIDs.length &&
    (
      await client.query(
        "SELECT id FROM screenshot_contact_tasks WHERE account_id=$1 AND created_by_user_id=$2 AND id=ANY($3::uuid[])",
        [auth.accountId, auth.userId, taskIDs],
      )
    ).rowCount !== new Set(taskIDs).size
  )
    throw missing();
  for (const receipt of payload.contactReceipts ?? []) {
    if (
      !(
        await client.query(
          `SELECT 1 FROM source_resources r JOIN captures c ON c.account_id=r.account_id AND c.id=r.capture_id
      WHERE r.account_id=$1 AND r.id=$2 AND c.id=$3 AND c.created_by_user_id=$4`,
          [auth.accountId, receipt.resourceID, receipt.captureID, auth.userId],
        )
      ).rowCount
    )
      throw missing();
  }
  const manifests = await canonicalSessionManifests(
    client,
    auth,
    payload.turns.map((turn) => canonicalID(turn.response.taskID)),
  );
  const scopedResults = (
    await client.query<{ task_id: string }>(
      `SELECT response_body->>'task_id' AS task_id FROM idempotency_records
    WHERE account_id=$1 AND operation_scope='create_chat_task' AND response_body->>'task_id'=ANY($2::text[])`,
      [
        auth.accountId,
        payload.turns.map((turn) => canonicalID(turn.response.taskID)),
      ],
    )
  ).rows;
  for (const turn of payload.turns) {
    if (
      turn.response.disposition === "screenshot_processing" &&
      !taskIDs.includes(turn.response.taskID)
    )
      invalid(
        "A screenshot response must retain its canonical task reference.",
      );
    const manifest = manifests.get(canonicalID(turn.response.taskID));
    if (manifest) {
      if (
        manifest.id !== turn.response.contextManifestID.toLowerCase() ||
        manifest.subject_id !== payload.personID ||
        manifest.assignment_id !== payload.relationshipContextID ||
        manifest.knowledge_snapshot_id !==
          turn.response.knowledgeSnapshotID.toLowerCase()
      )
        throw missing();
    } else if (
      UUID.test(turn.response.contextManifestID) ||
      scopedResults.some((result) => result.task_id === turn.response.taskID)
    ) {
      throw missing();
    }
  }
  const draft = payload.contactProposal;
  if (draft) {
    if (draft.sessionID && draft.sessionID.toLowerCase() !== id.toLowerCase())
      invalid("A proposal belongs to its Session.");
    if (
      draft.sourceMessageID &&
      !payload.turns.some(
        (turn) =>
          turn.id.toLowerCase() === draft.sourceMessageID!.toLowerCase(),
      )
    )
      invalid("Proposal provenance must name a message in its Session.");
    const source = draft.sourceText ?? draft.draft.sourceNote;
    for (const evidence of [
      ...(draft.fieldEvidence ?? []),
      ...(draft.draft.fieldEvidence ?? []),
    ])
      if (
        !evidence.exactExcerpt.trim() ||
        !source.includes(evidence.exactExcerpt)
      )
        invalid("Proposal field evidence must be an exact source substring.");
    if (
      future(draft.updatedAt) ||
      (draft.expiresAt &&
        Date.parse(draft.expiresAt) > Date.parse(draft.updatedAt) + 7 * DAY)
    )
      invalid("Proposal retention cannot exceed seven days.");
  }
}
export async function mutateAgentSession(
  pool: Pool,
  auth: AuthContext,
  id: string,
  request: AgentSessionMutationRequest | AgentSessionDeleteRequest,
  deleted = false,
  /** Host-only authority. HTTP routes never populate this argument. The owned
   * queue fence is rechecked and locked in the Session write transaction. */
  queueWrite?: { fence: ConversationQueueRunFence; messageId: string; allowCancelRequested: boolean },
): Promise<AgentSessionRecord> {
  if (
    !Value.Check(
      deleted
        ? AgentSessionDeleteRequestSchema
        : AgentSessionMutationRequestSchema,
      request,
    )
  )
    invalid("The Session must match the bounded typed contract.");
  if (Buffer.byteLength(JSON.stringify(request)) > 240 * 1024)
    invalid("A Session cannot exceed 240 KiB.");
  request = {
    ...request,
    idempotency_key: canonicalID(request.idempotency_key),
  };
  if (!deleted)
    request = {
      ...request,
      payload: normalizeSessionIdentifiers(
        (request as AgentSessionMutationRequest).payload,
      ),
    };
  const hash = digestValue({ session_id: id.toLowerCase(), deleted, request });
  const performMutation = () =>
    inTransaction(pool, async (client) => {
      // Governed Session writes fence the account for the whole transaction.
      await assertAccountActive(client, auth.accountId);
      // Fail and release held locks before a reverse-ordered source transition can
      // form a deadlock. The complete database-only operation can safely retry.
      await client.query("SET LOCAL lock_timeout = '100ms'");
      // One writer per owner fences create races and cross-session idempotency-key reuse.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${auth.accountId}:${auth.userId}:agent-sessions`],
      );
      await sweepAgentSessions(client, auth.accountId);
      const existing = await rowFor(client, auth, id);
      const operation = (
        await client.query<{ request_hash: string; session_id: string }>(
          "SELECT request_hash,session_id FROM agent_session_operations WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3",
          [auth.accountId, auth.userId, request.idempotency_key],
        )
      ).rows[0];
      if (operation) {
        if (
          operation.request_hash !== hash ||
          operation.session_id !== id.toLowerCase()
        )
          throw new ApiError(
            409,
            "AGENT_SESSION_IDEMPOTENCY_CONFLICT",
            "This operation key already identifies a different Session intent.",
          );
        if (!existing) throw missing();
        return record(existing);
      }
      if (existing?.deleted_at)
        throw new ApiError(
          410,
          "AGENT_SESSION_DELETED",
          "This Session was deleted or expired and cannot be restored.",
          { session: record(existing) },
        );
      if ((existing?.revision ?? 0) !== request.expected_revision)
        throw new ApiError(
          409,
          "AGENT_SESSION_REVISION_CONFLICT",
          "The Session changed on another device. Merge with its current revision.",
          { session: existing ? record(existing) : null },
        );
      let payload: AgentSessionPayload | null = null;
      let composerMetadata: { hash: string; startedAt: Date } | null = null;
      let createdAt = existing?.created_at ?? new Date();
      if (!deleted) {
        payload = structuredClone(
          (request as AgentSessionMutationRequest).payload,
        );
        if (queueWrite) {
          if (!sameID(queueWrite.fence.accountId, auth.accountId) || !sameID(queueWrite.fence.sessionId, id))
            throw missing();
          await assertConversationQueueOwnedClaim(client, queueWrite.fence,
            { allowCancelRequested: queueWrite.allowCancelRequested });
          const ownedMessage = (await client.query<{ message_id: string; created_by_user_id: string }>(
            "SELECT message_id,created_by_user_id FROM conversation_queue_entries WHERE account_id=$1 AND id=$2",
            [auth.accountId, queueWrite.fence.entryId],
          )).rows[0];
          if (!ownedMessage || !sameID(ownedMessage.message_id, queueWrite.messageId)
            || !sameID(ownedMessage.created_by_user_id, auth.userId)) throw missing();
        }
        let provenanceSource = existing?.payload ?? null;
        if (!provenanceSource && payload.originSessionID) {
          const origin = await rowFor(client, auth, payload.originSessionID);
          if (origin?.payload && !origin.deleted_at && origin.expires_at > new Date()) {
            const through = origin.payload.turns.findIndex(turn => sameID(turn.id, payload!.originTurnID));
            if (through >= 0) provenanceSource = { ...origin.payload, turns: origin.payload.turns.slice(0, through + 1) };
          }
        }
        preserveExecutionProvenance(payload, provenanceSource, queueWrite?.messageId);
        const newIDs = payload.turns.flatMap(turn => [turn, ...(turn.steeredMessages ?? [])])
          .filter(message => !existing?.payload?.turns.some(turn =>
            [turn, ...(turn.steeredMessages ?? [])].some(before => sameID(before.id, message.id))))
          .map(message => message.id);
        if (!queueWrite && newIDs.length) {
          const reserved = await client.query(
            `SELECT 1 FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2
             AND message_id=ANY($3::uuid[]) LIMIT 1`, [auth.accountId, id, newIDs],
          );
          if (reserved.rowCount) throw new ApiError(409, "AGENT_SESSION_QUEUE_MESSAGE_RESERVED",
            "An admitted queue message can only be saved by its owned execution.");
        }
        preserveExistingShareClassifications(
          payload,
          existing?.payload ?? null,
        );
        preserveExistingTurnImages(payload, existing?.payload ?? null);
        await lockAgentSessionSources(client, auth, payload);
        await validatePayload(
          client,
          auth,
          id,
          payload,
          existing?.payload ?? null,
        );
        if (!existing)
          createdAt = new Date(
            Math.min(
              Date.now(),
              Date.parse(payload.updatedAt),
              ...(payload.createdAt ? [Date.parse(payload.createdAt)] : []),
              ...payload.turns.map((turn) => Date.parse(turn.createdAt)),
            ),
          );
        if (createdAt.valueOf() + 30 * DAY <= Date.now())
          throw new ApiError(
            410,
            "AGENT_SESSION_EXPIRED",
            "This Session is older than the thirty-day retention period.",
          );
        composerMetadata = prepareComposerDraft(auth, id, payload, existing);
        await client.query("SELECT retract_agent_session_tasks($1,$2::jsonb)", [
          auth.accountId,
          JSON.stringify(payload),
        ]);
        payload = (
          await client.query<{ payload: AgentSessionPayload }>(
            "SELECT redact_agent_session_payload($1,$2::jsonb) AS payload",
            [auth.accountId, JSON.stringify(payload)],
          )
        ).rows[0]!.payload;
      }
      if (payload) {
        const bytes = (
          await client.query<{ bytes: number }>(
            "SELECT octet_length($1::jsonb::text) AS bytes",
            [JSON.stringify(payload)],
          )
        ).rows[0]!.bytes;
        if (bytes > 262144)
          invalid("The stored Session representation cannot exceed 256 KiB.");
      }
      const result = (
        await client.query<Row>(
          `INSERT INTO agent_sessions(account_id,id,created_by_user_id,revision,payload,created_at,expires_at,deleted_at,composer_draft_hash,composer_draft_started_at)
      VALUES ($1,$2,$3,1,$4::jsonb,$5,$6,CASE WHEN $7 THEN now() ELSE NULL END,$9,$10)
      ON CONFLICT (account_id,id) DO UPDATE SET revision=agent_sessions.revision+1,payload=EXCLUDED.payload,updated_at=now(),deleted_at=EXCLUDED.deleted_at,
        composer_draft_hash=COALESCE(EXCLUDED.composer_draft_hash,agent_sessions.composer_draft_hash),
        composer_draft_started_at=COALESCE(EXCLUDED.composer_draft_started_at,agent_sessions.composer_draft_started_at)
      WHERE agent_sessions.created_by_user_id=$3 AND agent_sessions.revision=$8 AND agent_sessions.deleted_at IS NULL
      RETURNING *`,
          [
            auth.accountId,
            id,
            auth.userId,
            payload ? JSON.stringify(payload) : null,
            createdAt,
            new Date(createdAt.valueOf() + 30 * DAY),
            deleted,
            request.expected_revision,
            composerMetadata?.hash ?? null,
            composerMetadata?.startedAt ?? null,
          ],
        )
      ).rows[0];
      if (!result) {
        const current = await rowFor(client, auth, id);
        throw new ApiError(
          current?.deleted_at ? 410 : 409,
          current?.deleted_at
            ? "AGENT_SESSION_DELETED"
            : "AGENT_SESSION_REVISION_CONFLICT",
          "The Session changed while this update was being checked.",
          { session: current ? record(current) : null },
        );
      }
      await client.query(
        `INSERT INTO agent_session_operations(account_id,session_id,actor_user_id,idempotency_key,request_hash,resulting_revision) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          auth.accountId,
          id,
          auth.userId,
          request.idempotency_key,
          hash,
          result.revision,
        ],
      );
      if (deleted) {
        // An explicit Session deletion revokes dependent accepted Memory now.
        // The natural retention sweep does not call this path, so a purged
        // Session image does not erase independently retained evidence.
        await invalidateMemoriesForSessionIds(client, auth.accountId, [id]);
        // Bound MCP human requests, OAuth attempts and receipts lose their
        // private payloads and can no longer be decided or resurrected.
        await invalidateMcpInteractionsForSession(client, auth.accountId, id);
      }
      return record(result);
    });
  for (let attempt = 0; ; attempt++) {
    try {
      return await performMutation();
    } catch (error) {
      const databaseError = error as { code?: string; table?: string };
      if (["55P03", "40P01", "40001"].includes(databaseError.code ?? "")) {
        if (attempt < 4) {
          await new Promise((resolve) =>
            setTimeout(resolve, 25 * 2 ** attempt),
          );
          continue;
        }
        throw new ApiError(
          409,
          "AGENT_SESSION_SOURCE_BUSY",
          "The Session source is changing. Retry the same update after it settles.",
        );
      }
      // Never expose PostgreSQL's rejected-row detail (which can contain private
      // payload text) if a database invariant rejects the final representation.
      if (
        databaseError.code === "23514" &&
        databaseError.table === "agent_sessions"
      )
        invalid("The stored Session does not match its bounded contract.");
      throw error;
    }
  }
}

export async function readAgentSessionConversation(
  client: DatabaseClient,
  auth: AuthContext,
  sessionId: string,
  scope: { personId: string | null; relationshipContextId: string | null },
): Promise<{
  /** Persistence truth, independent of whether old content is still admissible. */
  hasRecordedTurns: boolean;
  messages: Array<{
    message_id: string;
    role: "user" | "assistant";
    text: string;
  }>;
  sources?: AgentSessionChatSource[];
  unavailableScreenshotContext?: boolean;
}> {
  const row = await rowFor(client, auth, sessionId);
  if (!row) return { hasRecordedTurns: false, messages: [] };
  if (row.deleted_at || row.expires_at <= new Date())
    throw new ApiError(
      410,
      "AGENT_SESSION_DELETED",
      "This Session was deleted or expired.",
    );
  const payload = row.payload!;
  if (
    !sameID(payload.personID, scope.personId) ||
    !sameID(payload.relationshipContextID, scope.relationshipContextId)
  )
    throw new ApiError(
      409,
      "AGENT_SESSION_SCOPE_CHANGED",
      "Conversation history belongs to a different relationship scope.",
    );
  const turns = payload.turns.slice(-6);
  const bodies = (
    await client.query<{
      operation_scope: string;
      response_body: {
        task_id: string;
        blocks?: Array<{
          kind: string;
          body: string;
          citation_dependency_ids?: string[];
        }>;
        context_manifest_id?: string;
      };
    }>(
      `SELECT operation_scope,response_body FROM idempotency_records WHERE account_id=$1 AND actor_user_id=$2 AND status='completed'
    AND operation_scope IN ('create_chat_task','create_unscoped_chat_task') AND response_body->>'task_id'=ANY($3::text[])`,
      [
        auth.accountId,
        auth.userId,
        turns.map((t) => canonicalID(t.response.taskID)),
      ],
    )
  ).rows;
  const manifests = await canonicalSessionManifests(
    client,
    auth,
    turns.map((turn) => canonicalID(turn.response.taskID)),
  );
  const screenshotTasks = (
    await client.query<{ id: string }>(
      "SELECT id FROM screenshot_contact_tasks WHERE account_id=$1 AND id::text=ANY($2::text[])",
      [auth.accountId, turns.map((turn) => canonicalID(turn.response.taskID))],
    )
  ).rows;
  const screenshotContexts = await loadSessionScreenshotContexts(
    client,
    auth,
    turns.map((turn) => canonicalID(turn.response.taskID)),
  );
  const sourcesByMessage = new Map<string, AgentSessionChatSource[]>();
  let unavailableScreenshotContext = false;
  const messages: Array<{
    message_id: string;
    role: "user" | "assistant";
    text: string;
  }> = [];
  for (const turn of turns) {
    // A stopped partial answer has no durable lineage and must not re-enter the
    // model as successful assistant history.
    if (turn.response.taskID.startsWith("cancelled-")) continue;
    if (
      turn.response.disposition === "screenshot_processing" ||
      payload.screenshotTaskIDs?.includes(turn.response.taskID) ||
      screenshotTasks.some((task) => sameID(task.id, turn.response.taskID))
    ) {
      const source = screenshotContexts.find((item) =>
        sameID(item.id, turn.response.taskID),
      );
      if (
        !source ||
        (scope.personId != null &&
          source.subject_id != null &&
          (!sameID(source.subject_id, scope.personId) ||
            !sameID(source.assignment_id, scope.relationshipContextId)))
      ) {
        unavailableScreenshotContext = true;
        continue;
      }
      const hostResult = (turn.response as { hostResult?: { request_id: string; call_id: string; outcome: string } }).hostResult;
      messages.push(hostResult
        ? {
            message_id: turn.id,
            role: "assistant",
            text: `Host tool result (not user text; request ${hostResult.request_id}, call ${hostResult.call_id}, outcome ${hostResult.outcome}). The human decision and tool result are host data; continue the original task from them.`,
          }
        : {
            message_id: turn.id,
            role: "user",
            text: turn.objective.slice(0, 2000),
          });
      if (source.summary || source.question || source.findings?.length) {
        messages.push({
          message_id: source.id,
          role: "assistant",
          text: screenshotConversationText(source, turn.id),
        });
        sourcesByMessage.set(source.id, [
          { taskID: source.id, fingerprint: source.fingerprint },
        ]);
      } else unavailableScreenshotContext = true;
      continue;
    }
    const inheritedSources = await inheritedSessionChatSources(
      client,
      auth,
      canonicalID(turn.response.taskID),
    );
    if (inheritedSources === null) {
      unavailableScreenshotContext = true;
      continue;
    }
    const manifest = manifests.get(canonicalID(turn.response.taskID));
    const canonicalResult = bodies.find((item) =>
      sameID(item.response_body.task_id, turn.response.taskID),
    );
    const scoped =
      manifest || canonicalResult?.operation_scope === "create_chat_task";
    if (scoped) {
      if (
        !manifest ||
        !sameID(manifest.subject_id, scope.personId) ||
        !sameID(manifest.assignment_id, scope.relationshipContextId)
      )
        continue;
      const available = (
        await client.query<{ available: boolean }>(
          "SELECT agent_session_task_available($1,$2,$3,$4) AS available",
          [
            auth.accountId,
            canonicalID(turn.response.taskID),
            scope.personId ? canonicalID(scope.personId) : null,
            scope.relationshipContextId
              ? canonicalID(scope.relationshipContextId)
              : null,
          ],
        )
      ).rows[0]?.available;
      if (!available) continue;
    }
    for (const message of [turn, ...(turn.steeredMessages ?? [])]) {
      // A typed host tool result is host/assistant result provenance and never
      // a human-authored user message.
      const hostResult = message === turn
        ? (turn.response as { hostResult?: { request_id: string; call_id: string; outcome: string; actor_user_id: string } }).hostResult
        : undefined;
      messages.push(hostResult
        ? {
            message_id: message.id,
            role: "assistant",
            text: `Host tool result (not user text; request ${hostResult.request_id}, call ${hostResult.call_id}, outcome ${hostResult.outcome}, resolved by ${hostResult.actor_user_id}). The decision and result are host data; continue the original task from them.`,
          }
        : {
            message_id: message.id,
            role: "user",
            text: message.objective.slice(0, 2000),
          });
    }
    const canonical = canonicalResult?.response_body;
    // New queue turns carry server-owned execution provenance and immutable
    // canonical display blocks. Old endpoint turns still use their governed
    // idempotency result. No extra prose store or retention scope is created.
    const retained = turn.response.execution !== undefined
      ? turn.response.unboundConversationBlocks ?? turn.response.savedBlocks ?? [] : [];
    const text = (canonical?.blocks ?? retained)
      .filter((block) =>
        ["answer", "clarification", "question_set"].includes(block.kind),
      )
      .map((block) => block.body)
      .join("\n")
      .slice(0, 2000);
    if (text)
      messages.push({
        message_id: turn.response.taskID,
        role: "assistant",
        text,
      });
    if (text && inheritedSources.length)
      sourcesByMessage.set(turn.response.taskID, inheritedSources);
  }
  let remaining = 12000;
  const boundedMessages = messages
    .reverse()
    .map((message) => {
      const text = message.text.slice(0, remaining);
      remaining -= text.length;
      return { ...message, text };
    })
    .filter((message) => message.text.length > 0)
    .reverse();
  const sources = [
    ...new Map(
      boundedMessages
        .flatMap((message) => sourcesByMessage.get(message.message_id) ?? [])
        .map((source) => [source.taskID, source]),
    ).values(),
  ];
  return {
    hasRecordedTurns: payload.turns.length > 0,
    messages: boundedMessages,
    ...(sources.length ? { sources } : {}),
    ...(unavailableScreenshotContext
      ? { unavailableScreenshotContext: true }
      : {}),
  };
}
