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
import { invalidateMemoriesForArtifactIds } from "./memoryReviewRecall.js";
import { lockLabMediaWorkspace, trackedLabMediaPut } from "./labWorkspaceAccess.js";
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
       storage_provider, object_key, status, created_at
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

export async function uploadChatMediaContent(
  pool: Pool,
  auth: AuthContext,
  storage: ChatMediaStorage,
  mediaId: string,
  body: Uint8Array,
  contentType: string,
): Promise<ChatMediaAsset> {
  const perform = async (query: Pick<Pool,"query"> | PoolClient,
    finish: (operation:(client:PoolClient)=>Promise<ChatMediaAsset>)=>Promise<ChatMediaAsset>,
    workspaceId?:string):Promise<ChatMediaAsset> => {
  const row = await mediaRow(query, auth.accountId, mediaId);
  if (row.created_by_user_id !== auth.userId) {
    throw new ApiError(403, "CHAT_MEDIA_UPLOAD_DENIED", "Only the uploader can finish this image upload.");
  }
  if (row.status === "ready") return asset(row);
  if (row.status === "deleted") {
    throw new ApiError(410, "CHAT_MEDIA_DELETED", "The image upload was deleted.");
  }
  if (row.storage_provider !== storage.provider) {
    throw new ApiError(503, "CHAT_MEDIA_STORAGE_CHANGED", "The configured media storage no longer matches this upload.");
  }
  if (contentType.toLowerCase() !== row.media_type || body.byteLength !== row.byte_size) {
    throw new ApiError(
      422,
      "CHAT_MEDIA_CONTENT_MISMATCH",
      "The uploaded image bytes do not match the reviewed file metadata.",
    );
  }
  try {
    if(workspaceId)await trackedLabMediaPut(pool,workspaceId,mediaId,storage,row.object_key,body,row.media_type);
    else await storage.put(row.object_key, body, row.media_type);
  } catch {
    await query.query(
      `UPDATE chat_media_assets
       SET status = 'failed', failure_reason = $3, updated_at = now()
       WHERE account_id = $1 AND id = $2 AND status <> 'deleted'`,
      [
        auth.accountId,
        mediaId,
        CHAT_MEDIA_STORAGE_FAILURE_REASON,
      ],
    );
    throw new ApiError(503, "CHAT_MEDIA_STORAGE_FAILED", "The image could not be stored. Retry keeps the same upload identity.");
  }
  return finish(async (client) => {
    const updated = await client.query<ChatMediaRow>(
      `UPDATE chat_media_assets
       SET status = 'ready', failure_reason = NULL, updated_at = now()
       WHERE account_id = $1 AND id = $2 AND status IN ('pending', 'failed')
       RETURNING id, subject_id, assignment_id, created_by_user_id,
         idempotency_key, file_name, media_type, byte_size, width, height,
         storage_provider, object_key, status, created_at`,
      [auth.accountId, mediaId],
    );
    const ready = updated.rows[0] ?? (await mediaRow(client, auth.accountId, mediaId, true));
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "chat_media.uploaded",
      "chat_media_asset",
      mediaId,
      { byte_size: row.byte_size, storage_provider: row.storage_provider },
    );
    return asset(ready);
  });
  };
  if(auth.userKind==="lab_human")return inTransaction(pool,async client=>{
    const workspaceId=await lockLabMediaWorkspace(client,auth,storage);
    return perform(client,operation=>operation(client),workspaceId);
  });
  return perform(pool,operation=>inTransaction(pool,operation));
}

export async function getChatMediaContent(
  pool: Pick<Pool, "query"> | PoolClient,
  auth: AuthContext,
  storage: ChatMediaStorage,
  mediaId: string,
): Promise<StoredChatMedia> {
  const row = await mediaRow(pool, auth.accountId, mediaId);
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
    const row = await mediaRow(client, auth.accountId, mediaId, true);
    if (row.created_by_user_id !== auth.userId) {
      throw new ApiError(403, "CHAT_MEDIA_DELETE_DENIED", "Only the uploader can remove this unsubmitted image.");
    }
    if (row.status === "deleted") return { id: mediaId, status: "deleted" };
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
