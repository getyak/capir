import { randomUUID } from "node:crypto";

import type {
  ChatMediaAsset,
  ChatMediaDeleteResponse,
  CreateChatMediaRequest,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import { sha256 } from "../lib/hash.js";
import { invalidateMemoriesForArtifactIds } from "./memoryReviewRecall.js";
import { lockLabMediaWorkspace } from "./labWorkspaceAccess.js";
import type { AuthContext } from "./auth.js";
import type {
  ChatMediaStorage,
  StoredChatMedia,
} from "./chatMediaStorage.js";

export const CHAT_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const CHAT_MEDIA_MAX_ITEMS = 10;
/**
 * Fixed content-free storage failure diagnostic. The storage exception is
 * never retained: `failure_reason` may only carry this bounded code so raw
 * error content cannot escape into durable failure metadata.
 */
export const CHAT_MEDIA_STORAGE_FAILURE_REASON = "CHAT_MEDIA_STORAGE_FAILED";

interface ChatMediaRow {
  id: string;
  subject_id: string;
  assignment_id: string;
  created_by_user_id: string;
  idempotency_key: string;
  file_name: string;
  media_type: ChatMediaAsset["media_type"];
  byte_size: number;
  width: number | null;
  height: number | null;
  storage_provider: "local" | "s3";
  object_key: string;
  status: ChatMediaAsset["status"];
  created_at: Date;
  upload_state?: "idle" | "writing" | "unknown";
  upload_attempt_id?: string | null;
  upload_storage_scope?: string | null;
}

function asset(row: ChatMediaRow): ChatMediaAsset {
  return {
    id: row.id,
    file_name: row.file_name,
    media_type: row.media_type,
    byte_size: row.byte_size,
    width: row.width,
    height: row.height,
    status: row.status,
    created_at: row.created_at.toISOString(),
  };
}

function cleanFileName(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned || "image";
}

async function mediaRow(
  client: Pick<Pool, "query"> | PoolClient,
  accountId: string,
  mediaId: string,
  lock = false,
): Promise<ChatMediaRow> {
  const result = await client.query<ChatMediaRow>(
    `SELECT id, subject_id, assignment_id, created_by_user_id,
       idempotency_key, file_name, media_type, byte_size, width, height,
       storage_provider, object_key, status, created_at,
       upload_state, upload_attempt_id, upload_storage_scope
     FROM chat_media_assets
     WHERE account_id = $1 AND id = $2
     ${lock ? "FOR UPDATE" : ""}`,
    [accountId, mediaId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      404,
      "CHAT_MEDIA_NOT_FOUND",
      "The account-scoped Chat image was not found.",
    );
  }
  return row;
}

export async function createChatMediaAsset(
  pool: Pool,
  auth: AuthContext,
  storage: ChatMediaStorage,
  request: CreateChatMediaRequest,
): Promise<ChatMediaAsset> {
  return inTransaction(pool, async (client) => {
    const existing = await client.query<ChatMediaRow>(
      `SELECT id, subject_id, assignment_id, created_by_user_id,
         idempotency_key, file_name, media_type, byte_size, width, height,
         storage_provider, object_key, status, created_at
       FROM chat_media_assets
       WHERE account_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [auth.accountId, request.idempotency_key],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (
        row.subject_id !== request.person_id ||
        row.assignment_id !== request.relationship_context_id ||
        row.file_name !== cleanFileName(request.file_name) ||
        row.media_type !== request.media_type ||
        row.byte_size !== request.byte_size ||
        row.width !== (request.width ?? null) ||
        row.height !== (request.height ?? null)
      ) {
        throw new ApiError(
          409,
          "CHAT_MEDIA_IDEMPOTENCY_CONFLICT",
          "This upload key was already used for different image metadata.",
        );
      }
      return asset(row);
    }

    const scope = await client.query<{ id: string }>(
      `SELECT assignments.id
       FROM assignments
       JOIN subjects
         ON subjects.account_id = assignments.account_id
        AND subjects.id = assignments.subject_id
       WHERE assignments.account_id = $1
         AND assignments.id = $2
         AND assignments.subject_id = $3
         AND assignments.status = 'active'
         AND subjects.status = 'active'`,
      [auth.accountId, request.relationship_context_id, request.person_id],
    );
    if (!scope.rows[0]) {
      throw new ApiError(
        404,
        "CHAT_MEDIA_SCOPE_NOT_FOUND",
        "The image must belong to an active person and relationship context.",
      );
    }

    const id = randomUUID();
    const objectKey = `${auth.accountId}/${request.person_id}/${id}`;
    const createdAt = new Date();
    const fileName = cleanFileName(request.file_name);
    const inserted = await client.query<ChatMediaRow>(
      `INSERT INTO chat_media_assets(
         id, account_id, subject_id, assignment_id, created_by_user_id,
         idempotency_key, file_name, media_type, byte_size, width, height,
         storage_provider, object_key
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, subject_id, assignment_id, created_by_user_id,
         idempotency_key, file_name, media_type, byte_size, width, height,
         storage_provider, object_key, status, created_at`,
      [
        id,
        auth.accountId,
        request.person_id,
        request.relationship_context_id,
        auth.userId,
        request.idempotency_key,
        fileName,
        request.media_type,
        request.byte_size,
        request.width ?? null,
        request.height ?? null,
        storage.provider,
        objectKey,
      ],
    );
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "chat_media.upload_staged",
      "chat_media_asset",
      id,
      {
        person_id: request.person_id,
        relationship_context_id: request.relationship_context_id,
        media_type: request.media_type,
        byte_size: request.byte_size,
        storage_provider: storage.provider,
      },
    );
    return asset(inserted.rows[0] ?? {
      id,
      subject_id: request.person_id,
      assignment_id: request.relationship_context_id,
      created_by_user_id: auth.userId,
      idempotency_key: request.idempotency_key,
      file_name: fileName,
      media_type: request.media_type,
      byte_size: request.byte_size,
      width: request.width ?? null,
      height: request.height ?? null,
      storage_provider: storage.provider,
      object_key: objectKey,
      status: "pending",
      created_at: createdAt,
    });
  });
}

function unsettledUpload(): ApiError {
  return new ApiError(503, "CHAT_MEDIA_WRITE_UNSETTLED", "The image upload has not finished. Its storage result must be reconciled before retrying or deleting.");
}

function assertMediaStorageOwner(row: ChatMediaRow, accountId: string): void {
  if (row.object_key !== `${accountId}/${row.subject_id}/${row.id}`) {
    throw new ApiError(503, "CHAT_MEDIA_STORAGE_OWNER_MISMATCH", "The image storage key does not match its recorded owner.");
  }
}

async function settleCompletedUpload(
  client: PoolClient, auth: AuthContext, storage: ChatMediaStorage, row: ChatMediaRow,
): Promise<boolean> {
  assertMediaStorageOwner(row, auth.accountId);
  if (!row.upload_state || row.upload_state === "idle") return true;
  if (storage.provider !== "s3" || row.storage_provider !== "s3" || !storage.verifyUpload ||
      !row.upload_attempt_id || !row.upload_storage_scope || row.upload_storage_scope !== storage.labScopeID) return false;
  let complete: boolean;
  try {
    complete = await storage.verifyUpload(row.object_key, row.upload_attempt_id, row.byte_size, row.media_type);
  } catch {
    throw new ApiError(503, "CHAT_MEDIA_RECONCILIATION_FAILED", "The image upload's storage receipt could not be checked.");
  }
  if (!complete) return false;
  const receipt = sha256(JSON.stringify(["s3_head_complete_attempt.v1", row.upload_storage_scope,
    row.upload_attempt_id, row.byte_size, row.media_type]));
  await client.query(`UPDATE chat_media_assets SET upload_state='idle',status='failed',
    failure_reason=$3,upload_settlement_receipt=$4,updated_at=now()
    WHERE account_id=$1 AND id=$2 AND upload_attempt_id=$5`,
  [auth.accountId, row.id, CHAT_MEDIA_STORAGE_FAILURE_REASON, receipt, row.upload_attempt_id]);
  await client.query(`UPDATE lab_test_workspace_media_writes SET state='settled',settled_at=now()
    WHERE id=$1 AND media_id=$2`, [row.upload_attempt_id, row.id]);
  await appendAudit(client, { accountId: auth.accountId, actorUserId: auth.userId },
    "chat_media.upload_reconciled", "chat_media_asset", row.id,
    { receipt_type: "s3_head_complete_attempt.v1", receipt_sha256: receipt });
  row.upload_state = "idle";
  row.status = "failed";
  return true;
}

/** Operator/user retry readback; never reads image bytes or deletes objects. */
export async function reconcileChatMediaUpload(
  pool: Pool, auth: AuthContext, storage: ChatMediaStorage, mediaId: string, expectedAttemptId?: string,
): Promise<{ id: string; status: "settled" | "unresolved" }> {
  return inTransaction(pool, async client => {
    if (auth.userKind === "lab_human") await lockLabMediaWorkspace(client, auth, storage);
    const row = await mediaRow(client, auth.accountId, mediaId, true);
    if (row.created_by_user_id !== auth.userId) {
      throw new ApiError(403, "CHAT_MEDIA_UPLOAD_DENIED", "Only the uploader can reconcile this image upload.");
    }
    if (expectedAttemptId && row.upload_attempt_id !== expectedAttemptId) {
      throw new ApiError(409, "CHAT_MEDIA_ATTEMPT_CHANGED", "The image upload attempt changed; inspect its current receipt before recovery.");
    }
    return { id: mediaId, status: await settleCompletedUpload(client, auth, storage, row) ? "settled" : "unresolved" };
  });
}

export async function uploadChatMediaContent(
  pool: Pool,
  auth: AuthContext,
  storage: ChatMediaStorage,
  mediaId: string,
  body: Uint8Array,
  contentType: string,
): Promise<ChatMediaAsset> {
  // Admission commits before PUT, so other processes and crash recovery see
  // the same unfinished operation. No process-local lock or elapsed-time lease.
  const admitted = await inTransaction(pool, async (client) => {
    const workspaceId = auth.userKind === "lab_human"
      ? await lockLabMediaWorkspace(client, auth, storage) : undefined;
    const row = await mediaRow(client, auth.accountId, mediaId, true);
    if (row.created_by_user_id !== auth.userId) {
      throw new ApiError(403, "CHAT_MEDIA_UPLOAD_DENIED", "Only the uploader can finish this image upload.");
    }
    if (row.status === "ready") return { row, attemptId: null };
    if (row.status === "deleted") {
      throw new ApiError(410, "CHAT_MEDIA_DELETED", "The image upload was deleted.");
    }
    if (row.storage_provider !== storage.provider ||
        (row.upload_storage_scope && row.upload_storage_scope !== storage.labScopeID)) {
      throw new ApiError(503, "CHAT_MEDIA_STORAGE_CHANGED", "The configured media storage no longer matches this upload.");
    }
    if (!await settleCompletedUpload(client, auth, storage, row)) throw unsettledUpload();
    if (storage.provider === "s3" && !storage.labScopeID) {
      throw new ApiError(503, "CHAT_MEDIA_STORAGE_SCOPE_REQUIRED", "The image storage must identify its scope before accepting uploads.");
    }
    if (contentType.toLowerCase() !== row.media_type || body.byteLength !== row.byte_size) {
      throw new ApiError(422, "CHAT_MEDIA_CONTENT_MISMATCH", "The uploaded image bytes do not match the reviewed file metadata.");
    }
    if (workspaceId) {
      const previous = await client.query(
        "SELECT 1 FROM lab_test_workspace_media_writes WHERE media_id=$1 AND state<>'settled' LIMIT 1", [mediaId]);
      if (previous.rowCount) throw unsettledUpload();
    }
    const attemptId = randomUUID();
    await client.query(`UPDATE chat_media_assets SET upload_state='writing',upload_attempt_id=$3,
      upload_started_at=now(),upload_storage_scope=$4,upload_settlement_receipt=NULL,updated_at=now()
      WHERE account_id=$1 AND id=$2`, [auth.accountId, mediaId, attemptId, storage.labScopeID ?? null]);
    if (workspaceId) {
      await client.query(`INSERT INTO lab_test_workspace_media_writes(id,workspace_id,media_id)
        VALUES ($1,$2,$3)`, [attemptId, workspaceId, mediaId]);
    }
    return { row, attemptId, workspaceId };
  });
  if (!admitted.attemptId) return asset(admitted.row);

  let failed = false;
  try {
    await storage.put(admitted.row.object_key, body, admitted.row.media_type, admitted.attemptId);
  } catch {
    failed = true;
  }
  // A rejected remote promise does not establish that S3 stopped accepting
  // bytes. Keep that attempt fenced until a matching terminal receipt exists.
  const state = failed && storage.provider === "s3" ? "unknown" : "idle";
  if (admitted.workspaceId) {
    await pool.query(`UPDATE lab_test_workspace_media_writes SET state=$2,
      settled_at=CASE WHEN $2='settled' THEN now() ELSE NULL END WHERE id=$1`,
    [admitted.attemptId, state === "unknown" ? "unknown" : "settled"]);
  }
  const completed = await inTransaction(pool, async (client) => {
    const current = await mediaRow(client, auth.accountId, mediaId, true);
    if (current.upload_attempt_id !== admitted.attemptId || current.upload_state !== "writing") {
      throw unsettledUpload();
    }
    const updated = await client.query<ChatMediaRow>(
      `UPDATE chat_media_assets
       SET status = $3, failure_reason = $4, upload_state = $5, updated_at = now()
       WHERE account_id = $1 AND id = $2 AND upload_attempt_id = $6
       RETURNING *`,
      [auth.accountId, mediaId, failed ? "failed" : "ready",
        failed ? CHAT_MEDIA_STORAGE_FAILURE_REASON : null, state, admitted.attemptId],
    );
    if (!failed) {
      await appendAudit(client, { accountId: auth.accountId, actorUserId: auth.userId },
        "chat_media.uploaded", "chat_media_asset", mediaId,
        { byte_size: admitted.row.byte_size, storage_provider: storage.provider });
    }
    return asset(updated.rows[0]!);
  });
  if (failed) {
    throw new ApiError(503, "CHAT_MEDIA_STORAGE_FAILED", "The image could not be stored. Retry keeps the same upload identity.");
  }
  return completed;
}

export async function getChatMediaContent(
  pool: Pick<Pool, "query"> | PoolClient,
  auth: AuthContext,
  storage: ChatMediaStorage,
  mediaId: string,
): Promise<StoredChatMedia> {
  const row = await mediaRow(pool, auth.accountId, mediaId);
  assertMediaStorageOwner(row, auth.accountId);
  if (row.status !== "ready") {
    throw new ApiError(404, "CHAT_MEDIA_UNAVAILABLE", "The Chat image is not available.");
  }
  if (row.storage_provider !== storage.provider) {
    throw new ApiError(503, "CHAT_MEDIA_STORAGE_CHANGED", "The configured media storage no longer matches this image.");
  }
  return storage.get(row.object_key, row.media_type);
}

export async function deleteChatMediaAsset(
  pool: Pool,
  auth: AuthContext,
  storage: ChatMediaStorage,
  mediaId: string,
): Promise<ChatMediaDeleteResponse> {
  return inTransaction(pool, async (client) => {
    if (auth.userKind === "lab_human") await lockLabMediaWorkspace(client, auth, storage);
    const row = await mediaRow(client, auth.accountId, mediaId, true);
    if (row.created_by_user_id !== auth.userId) {
      throw new ApiError(403, "CHAT_MEDIA_DELETE_DENIED", "Only the uploader can remove this unsubmitted image.");
    }
    if (!await settleCompletedUpload(client, auth, storage, row)) throw unsettledUpload();
    const unresolvedLabWrite = await client.query(
      "SELECT 1 FROM lab_test_workspace_media_writes WHERE media_id=$1 AND state<>'settled' LIMIT 1", [mediaId]);
    if (unresolvedLabWrite.rowCount) throw unsettledUpload();
    if (row.status === "deleted") return { id: mediaId, status: "deleted" };
    if (row.storage_provider !== storage.provider ||
        (row.upload_storage_scope && row.upload_storage_scope !== storage.labScopeID)) {
      throw new ApiError(503, "CHAT_MEDIA_STORAGE_CHANGED", "Restore this image's storage before deleting it.");
    }
    const binding = await client.query(
      `SELECT 1 FROM context_manifest_media
       WHERE account_id = $1 AND media_id = $2`,
      [auth.accountId, mediaId],
    );
    if (binding.rows[0]) {
      throw new ApiError(
        409,
        "CHAT_MEDIA_ALREADY_SUBMITTED",
        "Submitted Chat media remains part of the durable task receipt.",
      );
    }
    if (row.storage_provider === storage.provider) {
      if (storage.provider === "s3") {
        // A delete marker leaves historical private image bytes recoverable.
        // Acknowledge deletion only after every exact-key version is removed.
        if (!storage.purge) {
          throw new ApiError(503, "CHAT_MEDIA_PERMANENT_PURGE_UNAVAILABLE", "The image cannot be permanently removed with the configured storage adapter.");
        }
        await storage.purge(row.object_key);
      } else {
        await storage.delete(row.object_key);
      }
    }
    await client.query(
      `UPDATE chat_media_assets
       SET status = 'deleted', failure_reason = NULL,
         deleted_at = now(), updated_at = now()
       WHERE account_id = $1 AND id = $2`,
      [auth.accountId, mediaId],
    );
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "chat_media.deleted",
      "chat_media_asset",
      mediaId,
      { submitted: false },
    );
    await invalidateMemoriesForArtifactIds(client, auth.accountId, [mediaId]);
    return { id: mediaId, status: "deleted" };
  });
}

export async function bindChatMediaToManifest(
  client: PoolClient,
  accountId: string,
  personId: string,
  relationshipContextId: string,
  manifestId: string,
  mediaIds: string[],
): Promise<ChatMediaAsset[]> {
  if (mediaIds.length === 0) return [];
  const result = await client.query<ChatMediaRow>(
    `SELECT id, subject_id, assignment_id, created_by_user_id,
       idempotency_key, file_name, media_type, byte_size, width, height,
       storage_provider, object_key, status, created_at
     FROM chat_media_assets
     WHERE account_id = $1 AND id = ANY($2::uuid[])
     ORDER BY array_position($2::uuid[], id)
     FOR UPDATE`,
    [accountId, mediaIds],
  );
  if (
    result.rows.length !== mediaIds.length ||
    result.rows.some(
      (row) =>
        row.status !== "ready" ||
        row.subject_id !== personId ||
        row.assignment_id !== relationshipContextId,
    )
  ) {
    throw new ApiError(
      409,
      "CHAT_MEDIA_NOT_READY",
      "Every image must be uploaded and scoped to this relationship before Ask.",
    );
  }
  for (const [sequence, row] of result.rows.entries()) {
    try {
      await client.query(
        `INSERT INTO context_manifest_media(account_id, manifest_id, media_id, sequence)
         VALUES ($1, $2, $3, $4)`,
        [accountId, manifestId, row.id, sequence],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ApiError(
          409,
          "CHAT_MEDIA_ALREADY_SUBMITTED",
          "An image can belong to only one submitted Chat task.",
        );
      }
      throw error;
    }
  }
  return result.rows.map(asset);
}

export async function listManifestChatMedia(
  client: Pick<Pool, "query"> | PoolClient,
  accountId: string,
  manifestId: string,
): Promise<ChatMediaAsset[]> {
  const result = await client.query<ChatMediaRow>(
    `SELECT media.id, media.subject_id, media.assignment_id,
       media.created_by_user_id, media.idempotency_key, media.file_name,
       media.media_type, media.byte_size, media.width, media.height,
       media.storage_provider, media.object_key, media.status, media.created_at
     FROM context_manifest_media bindings
     JOIN chat_media_assets media
       ON media.account_id = bindings.account_id AND media.id = bindings.media_id
     WHERE bindings.account_id = $1 AND bindings.manifest_id = $2
     ORDER BY bindings.sequence`,
    [accountId, manifestId],
  );
  return result.rows.map(asset);
}
