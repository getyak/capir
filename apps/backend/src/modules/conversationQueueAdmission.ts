import { createHash, randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  type ConversationQueueAdmitRequest,
  type ConversationQueueAdmitResponse,
  type ConversationQueueApplied,
  type ConversationQueueEntryStatus,
  type ConversationQueueMutationRequest,
  type ConversationQueueSnapshot,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import type { AuthContext } from "./auth.js";
import { assertSessionForChat } from "./agentSessionSources.js";
import {
  conversationImageManifestHash,
  persistConversationMessageImages,
  validateConversationImageUploads,
} from "./conversationMessageImages.js";
import {
  allocateConversationQueueSequence,
  asNumber,
  bumpConversationQueueState,
  CONVERSATION_QUEUE_MAX_ENTRIES,
  type ConversationQueueEntryRow,
  lockConversationQueueSession,
  readConversationQueueSnapshot,
  readConversationQueueState,
  readConversationQueueSteeringLeader,
} from "./conversationQueueState.js";
import { publishConversationQueueChanged, publishConversationQueueStop } from "./conversationQueueLive.js";

export const CONVERSATION_QUEUE_OPERATION_SCOPE = "conversation_queue_admit";

const ACTIVE_STATUSES: ConversationQueueEntryStatus[] = [
  "queued",
  "running",
  "failed",
  "interrupted",
];

function admitReceipt(
  row: ConversationQueueEntryRow,
  state: { revision: number },
  steerRunId?: string | null,
): ConversationQueueAdmitResponse {
  return {
    contract_version: CONTRACT_VERSION,
    session_id: row.session_id,
    message_id: row.message_id,
    queue_entry_id: row.id,
    run_id: row.run_id,
    status: row.status,
    sequence: asNumber(row.sequence),
    revision: row.revision,
    snapshot_revision: state.revision,
    accepted_at: row.created_at.toISOString(),
    ...(row.steer_group_entry_id && steerRunId ? { steers_run_id: steerRunId } : {}),
  };
}

export async function admitConversationQueueEntry(
  pool: Pool,
  auth: AuthContext,
  request: ConversationQueueAdmitRequest,
): Promise<{ response: ConversationQueueAdmitResponse; replayed: boolean }> {
  const outcome = await inTransaction(pool, async (client) => {
    const expiresAt = await assertSessionForChat(client, auth, request.session_id);
    const uploads = request.images ?? [];
    const objective = request.objective.trim();
    if (!objective && uploads.length === 0) {
      throw new ApiError(
        422,
        "CONVERSATION_QUEUE_OBJECTIVE_REQUIRED",
        "Send text or at least one image.",
      );
    }
    const manifests = validateConversationImageUploads(uploads);
    const imagesHash = manifests.length
      ? conversationImageManifestHash(manifests)
      : null;
    const idempotency = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      CONVERSATION_QUEUE_OPERATION_SCOPE,
      request.idempotency_key,
      {
        // Preserve historical human-message hashes; only host results add
        // their request identity to the idempotency payload.
        ...(request.host_result
          ? { host_request_id: request.host_result.request_id }
          : {}),
        session_id: request.session_id,
        message_id: request.message_id,
        objective: request.objective,
        time_zone: request.time_zone ?? null,
        // Only extend the hashed identity for a real image batch so a
        // pre-deployment text-only receipt keeps its original hash.
        ...(imagesHash ? { images_hash: imagesHash } : {}),
      },
    );
    if (idempotency.replay) {
      const replay = idempotency.replay.body as ConversationQueueAdmitResponse;
      if (!replay || replay.message_id !== request.message_id) {
        throw new ApiError(
          409,
          "CONVERSATION_QUEUE_IDEMPOTENCY_CONFLICT",
          "This request key already identifies a different message.",
        );
      }
      return { response: replay, replayed: true };
    }
    await lockConversationQueueSession(client, request.session_id);
    const existing = (
      await client.query<ConversationQueueEntryRow>(
        "SELECT * FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2 AND message_id=$3",
        [auth.accountId, request.session_id, request.message_id],
      )
    ).rows[0];
    if (existing) {
      if (
        existing.idempotency_key !== request.idempotency_key ||
        existing.objective !== request.objective ||
        (existing.images_hash ?? null) !== imagesHash
      ) {
        throw new ApiError(
          409,
          "CONVERSATION_QUEUE_MESSAGE_CONFLICT",
          "This message id already identifies a different queued intention.",
        );
      }
      const response = admitReceipt(
        existing,
        await readConversationQueueState(client, auth.accountId, request.session_id),
        existing.steer_group_entry_id
          ? (await readConversationQueueSteeringLeader(client, auth.accountId, request.session_id))?.runId ?? null
          : null,
      );
      await completeIdempotency(client, idempotency, 202, response);
      return { response, replayed: true };
    }
    const queueDepth = (
      await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM conversation_queue_entries
         WHERE account_id=$1 AND session_id=$2 AND status = ANY($3::text[])`,
        [auth.accountId, request.session_id, ACTIVE_STATUSES],
      )
    ).rows[0]!.count;
    if (Number(queueDepth) >= CONVERSATION_QUEUE_MAX_ENTRIES) {
      throw new ApiError(
        429,
        "CONVERSATION_QUEUE_FULL",
        "This conversation queue is full. Let an earlier message finish first.",
      );
    }
    const { sequence, revision } = await allocateConversationQueueSequence(
      client,
      auth.accountId,
      request.session_id,
    );
    // GET-128 steering: while a live run still accepts input, this message
    // joins that run's steering group instead of queueing as unrelated future
    // work. The lookup runs under the same session advisory lock as the run's
    // intake closure, so a message is either processed by the live run or
    // truthfully the next task — never silently dropped in between.
    // A host result continuation always enters its own queue entry and never
    // attaches to a live steering leader: the human-message steering feed
    // would drop or fabricate its typed result metadata. Ordinary user
    // steering is unchanged.
    const leader = request.host_result
      ? null
      : await readConversationQueueSteeringLeader(
          client,
          auth.accountId,
          request.session_id,
        );
    const entry = (
      await client.query<ConversationQueueEntryRow>(
        `INSERT INTO conversation_queue_entries(
           account_id,session_id,id,message_id,created_by_user_id,auth_session_id,sequence,status,content_state,
           objective,time_zone,idempotency_key,revision,expires_at,images_hash,steer_group_entry_id,host_result
         ) VALUES($1,$2,$3,$4,$5,$6,$7,'queued','retained',$8,$9,$10,1,$11,$12,$13,$14::jsonb)
         RETURNING *`,
        [
          auth.accountId,
          request.session_id,
          randomUUID(),
          request.message_id,
          auth.userId,
          // A governed host continuation has no live login session; the
          // column is nullable and never fabricates one.
          auth.sessionId || null,
          sequence,
          request.objective,
          request.time_zone ?? null,
          request.idempotency_key,
          expiresAt,
          imagesHash,
          leader?.entryId ?? null,
          request.host_result ? JSON.stringify(request.host_result).slice(0, 4096) : null,
        ],
      )
    ).rows[0]!;
    if (uploads.length > 0) {
      await persistConversationMessageImages(client, auth, {
        sessionId: request.session_id,
        messageId: request.message_id,
        queueEntryId: entry.id,
        expiresAt,
        uploads,
      });
    }
    const response = admitReceipt(entry, { revision }, leader?.runId ?? null);
    await completeIdempotency(client, idempotency, 202, response);
    return { response, replayed: false };
  });
  if (!outcome.replayed) {
    queueMicrotask(() =>
      publishConversationQueueChanged(auth.accountId, request.session_id),
    );
  }
  return outcome;
}

interface MutationOutcome {
  snapshot: ConversationQueueSnapshot;
  applied: ConversationQueueApplied;
  replayed: boolean;
}

function mutationHash(sessionId: string, request: ConversationQueueMutationRequest): string {
  return createHash("sha256").update(JSON.stringify({ sessionId, ...request })).digest("hex");
}

export async function mutateConversationQueueEntry(
  pool: Pool,
  auth: AuthContext,
  sessionId: string,
  request: ConversationQueueMutationRequest,
): Promise<MutationOutcome> {
  const outcome = await inTransaction(pool, async (client) => {
    await assertSessionForChat(client, auth, sessionId);
    const existingOperation = (
      await client.query<{ request_hash: string; applied: ConversationQueueApplied }>(
        "SELECT request_hash,applied FROM conversation_queue_operations WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3 FOR UPDATE",
        [auth.accountId, auth.userId, request.idempotency_key],
      )
    ).rows[0];
    if (existingOperation) {
      if (existingOperation.request_hash !== mutationHash(sessionId, request)) {
        throw new ApiError(
          409,
          "CONVERSATION_QUEUE_IDEMPOTENCY_CONFLICT",
          "This operation key already identifies a different queue change.",
        );
      }
      const snapshot = await readConversationQueueSnapshot(client, auth, sessionId);
      return { snapshot, applied: existingOperation.applied, replayed: true };
    }
    await lockConversationQueueSession(client, sessionId);
    const state = await readConversationQueueState(client, auth.accountId, sessionId);
    if (state.revision !== request.expected_revision) {
      throw new ApiError(
        409,
        "CONVERSATION_QUEUE_REVISION_CONFLICT",
        "The conversation queue changed on another device. Read its current state.",
        { revision: state.revision },
      );
    }
    const applied = await applyMutation(client, auth, sessionId, request);
    await client.query(
      "INSERT INTO conversation_queue_operations(account_id,actor_user_id,idempotency_key,request_hash,applied) VALUES($1,$2,$3,$4,$5)",
      [auth.accountId, auth.userId, request.idempotency_key, mutationHash(sessionId, request), applied],
    );
    const snapshot = await readConversationQueueSnapshot(client, auth, sessionId);
    return { snapshot, applied, replayed: false };
  });
  if (!outcome.replayed) {
    const { applied } = outcome;
    const stopsLiveRun =
      (applied.kind === "stop" && applied.status === "running") ||
      (applied.kind === "prioritize" && applied.status === "queued");
    if (stopsLiveRun && applied.queue_entry_id && applied.run_id) {
      publishConversationQueueStop(auth.accountId, sessionId, applied.run_id);
    }
    publishConversationQueueChanged(auth.accountId, sessionId);
  }
  return outcome;
}

async function applyMutation(
  client: PoolClient,
  auth: AuthContext,
  sessionId: string,
  request: ConversationQueueMutationRequest,
): Promise<ConversationQueueApplied> {
  if (request.kind === "continue") {
    const blocked = await client.query("SELECT 1 FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2 AND status IN ('failed','interrupted') LIMIT 1", [auth.accountId, sessionId]);
    if (blocked.rowCount) throw new ApiError(409, "CONVERSATION_QUEUE_RETRY_REQUIRED", "Retry or remove the unfinished message before continuing.");
    await bumpConversationQueueState(client, auth.accountId, sessionId, { paused: false });
    return { kind: "continue", queue_entry_id: null, run_id: null, status: null };
  }
  if (request.kind === "stop") {
    // A plain stop must never inherit prioritize's auto-continue: clearing the
    // flag here keeps "stop" truthful even if prioritize raced first.
    const row = (
      await client.query<{ id: string }>(
        `UPDATE conversation_queue_entries
         SET cancel_requested=true, cancel_auto_continue=false, updated_at=now(), revision=revision+1
         WHERE account_id=$1 AND session_id=$2 AND run_id=$3 AND status='running'
         RETURNING id`,
        [auth.accountId, sessionId, request.run_id],
      )
    ).rows[0];
    if (!row) {
      const terminal = (
        await client.query<{ status: ConversationQueueEntryStatus }>(
          "SELECT status FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2 AND run_id=$3",
          [auth.accountId, sessionId, request.run_id],
        )
      ).rows[0];
      return {
        kind: "stop",
        queue_entry_id: null,
        run_id: request.run_id,
        status: terminal?.status ?? null,
      };
    }
    await bumpConversationQueueState(client, auth.accountId, sessionId);
    return { kind: "stop", queue_entry_id: row.id, run_id: request.run_id, status: "running" };
  }
  const row = (
    await client.query<ConversationQueueEntryRow>(
      "SELECT * FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2 AND id=$3 FOR UPDATE",
      [auth.accountId, sessionId, request.queue_entry_id],
    )
  ).rows[0];
  if (!row) {
    throw new ApiError(
      404,
      "CONVERSATION_QUEUE_ENTRY_NOT_FOUND",
      "This queued message is no longer available.",
    );
  }
  if (request.kind === "edit") {
    if (row.host_result != null) {
      throw new ApiError(
        409,
        "CONVERSATION_QUEUE_HOST_RESULT_IMMUTABLE",
        "A host result preserves the accepted decision and cannot be edited.",
      );
    }
    if (row.status !== "queued") {
      throw new ApiError(
        409,
        "CONVERSATION_QUEUE_ENTRY_CLAIMED",
        "This message has already started and can no longer be edited.",
      );
    }
    if ((row.steer_state === "delivered" || row.steer_state === "dispatching")) {
      // The run already consumed this message; its exact accepted text is the
      // provenance of the folded turn and can never be rewritten after the
      // fact.
      throw new ApiError(
        409,
        "CONVERSATION_QUEUE_ENTRY_STEERED",
        "This message already steered the running task and can no longer be edited.",
      );
    }
    await client.query(
      "UPDATE conversation_queue_entries SET objective=$3, updated_at=now(), revision=revision+1 WHERE account_id=$1 AND id=$2",
      [auth.accountId, row.id, request.objective],
    );
    await bumpConversationQueueState(client, auth.accountId, sessionId);
    return { kind: "edit", queue_entry_id: row.id, run_id: row.run_id, status: "queued" };
  }
  if (request.kind === "prioritize" && row.steer_group_entry_id) {
    // A steering message is already processed inside the live run (or its
    // group); reordering it as future work would misrepresent what happens.
    throw new ApiError(
      409,
      "CONVERSATION_QUEUE_ENTRY_NOT_PRIORITIZABLE",
      "A message that steers the running task cannot be queued for later work.",
    );
  }
  if (request.kind === "prioritize") {
    // GET-49 controllable supplement: stop a live run when needed, move this
    // queued message to the front, and leave the queue ready to claim it next.
    // Other queued items keep their relative order behind it. A plain stop
    // still pauses; only this path sets cancel_auto_continue.
    if (row.status !== "queued") {
      throw new ApiError(
        409,
        "CONVERSATION_QUEUE_ENTRY_NOT_PRIORITIZABLE",
        "Only a waiting message can be processed next.",
      );
    }
    // Same gate as Continue: unfinished failed/interrupted work must be retried
    // or withdrawn first so prioritize cannot run later messages past a hole.
    const blocked = await client.query(
      "SELECT 1 FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2 AND status IN ('failed','interrupted') LIMIT 1",
      [auth.accountId, sessionId],
    );
    if (blocked.rowCount) {
      throw new ApiError(
        409,
        "CONVERSATION_QUEUE_RETRY_REQUIRED",
        "Retry or remove the unfinished message before continuing.",
      );
    }
    const live = (
      await client.query<{ id: string; run_id: string }>(
        `SELECT id, run_id FROM conversation_queue_entries
         WHERE account_id=$1 AND session_id=$2 AND status='running'
         LIMIT 1`,
        [auth.accountId, sessionId],
      )
    ).rows[0];
    if (live && live.id !== row.id) {
      await client.query(
        `UPDATE conversation_queue_entries
         SET cancel_requested=true, cancel_auto_continue=true, updated_at=now(), revision=revision+1
         WHERE account_id=$1 AND id=$2 AND status='running'`,
        [auth.accountId, live.id],
      );
    }
    await client.query(
      `UPDATE conversation_queue_entries e
       SET sequence = ranked.new_sequence, updated_at=now(), revision=revision+1
       FROM (
         SELECT id, row_number() OVER (
           ORDER BY (id = $3::uuid) DESC, sequence ASC, created_at ASC
         ) AS new_sequence
         FROM conversation_queue_entries
         WHERE account_id=$1 AND session_id=$2 AND status IN ('queued','failed','interrupted')
       ) ranked
       WHERE e.account_id=$1 AND e.id=ranked.id`,
      [auth.accountId, sessionId, row.id],
    );
    await bumpConversationQueueState(client, auth.accountId, sessionId, {
      paused: false,
    });
    return {
      kind: "prioritize",
      queue_entry_id: row.id,
      run_id: live?.run_id ?? null,
      status: "queued",
    };
  }
  if (request.kind === "withdraw") {
    if (!["queued", "failed", "interrupted"].includes(row.status)) {
      throw new ApiError(
        409,
        "CONVERSATION_QUEUE_ENTRY_CLAIMED",
        "This message has already started and cannot be withdrawn.",
      );
    }
    if ((row.steer_state === "delivered" || row.steer_state === "dispatching")) {
      // A delivered steering message keeps its immutable identity in the
      // folded turn's history; deleting the row would erase the provenance of
      // work the run already did. Discard the whole group instead.
      throw new ApiError(
        409,
        "CONVERSATION_QUEUE_ENTRY_STEERED",
        "This message already steered the running task. Withdraw the task message to discard the whole group.",
      );
    }
    // Withdrawing a task message removes its remaining steering messages
    // together (they are one unprocessed intention). Terminal folded work is
    // never reachable here: completed and cancelled rows are not withdrawable.
    await client.query(
      "DELETE FROM conversation_queue_entries WHERE account_id=$1 AND (id=$2 OR steer_group_entry_id=$2)",
      [auth.accountId, row.id],
    );
    await bumpConversationQueueState(client, auth.accountId, sessionId);
    return { kind: "withdraw", queue_entry_id: row.id, run_id: null, status: null };
  }
  // retry: an explicit action that re-queues one entry. Only an explicit
  // Continue clears the pause, so a failed old message can never move silently
  // ahead of later ones. A steering group retries as one intention: its task
  // message and the messages that steer it re-queue together, and a fresh
  // model run re-delivers them in accepted order.
  if (!["failed", "interrupted"].includes(row.status)) {
    throw new ApiError(
      409,
      "CONVERSATION_QUEUE_ENTRY_NOT_RETRYABLE",
      "Only a failed or interrupted message can be retried explicitly.",
    );
  }
  const leaderId = row.steer_group_entry_id ?? row.id;
  const leaderRow = (
    await client.query<{ result: unknown }>(
      "SELECT result FROM conversation_queue_entries WHERE account_id=$1 AND id=$2",
      [auth.accountId, leaderId],
    )
  ).rows[0];
  const replaysStoredResult = Boolean(leaderRow && leaderRow.result !== null);
  await client.query(
    `UPDATE conversation_queue_entries
     SET status='queued', failure_code=NULL, stage=NULL, lease_owner=NULL, lease_expires_at=NULL,
         cancel_requested=false, cancel_auto_continue=false,
         steer_state=CASE WHEN $3::boolean THEN steer_state ELSE 'awaiting' END,
         steer_delivered_at=CASE WHEN $3::boolean THEN steer_delivered_at ELSE NULL END,
         steer_closed_at=CASE WHEN $3::boolean THEN steer_closed_at ELSE NULL END,
         updated_at=now(), revision=revision+1
     WHERE account_id=$1 AND (id=$2 OR steer_group_entry_id=$2) AND status IN ('failed','interrupted','queued')`,
    [auth.accountId, leaderId, replaysStoredResult],
  );
  await bumpConversationQueueState(client, auth.accountId, sessionId);
  return { kind: "retry", queue_entry_id: row.id, run_id: row.run_id, status: "queued" };
}
