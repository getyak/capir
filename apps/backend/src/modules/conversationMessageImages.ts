import { createHash } from "node:crypto";

import type {
  ConversationImageManifest,
  ConversationImageUpload,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { validateContactImage } from "./contactTaskImages.js";

export const CONVERSATION_IMAGE_MAX_COUNT = 10;
export const CONVERSATION_IMAGE_MAX_BYTES = 10_000_000;
export const CONVERSATION_IMAGE_MAX_TOTAL_BYTES = 30_000_000;

export interface ConversationMessageImage {
  manifest: ConversationImageManifest;
  data: Uint8Array;
}

export interface ConversationRunImage extends ConversationMessageImage {
  /** Originating immutable message id; provenance for the model context. */
  messageId: string;
  imageIndex: number;
}

export interface ConversationRunImages {
  images: ConversationRunImage[];
  /** Earlier images in this Session that did not fit the bounded budget. */
  omitted: number;
}

function integrityError(code: string, message: string): ApiError {
  return new ApiError(422, code, message);
}

/**
 * Validate one ordered upload batch and return its canonical manifest.
 *
 * The manifest never carries bytes; `validated` in the caller still owns the
 * decoded base64. Signature, canonical base64, declared byte size and SHA-256
 * all have to agree before the batch is admissible.
 */
export function validateConversationImageUploads(
  uploads: readonly ConversationImageUpload[],
): ConversationImageManifest[] {
  if (uploads.length > CONVERSATION_IMAGE_MAX_COUNT) {
    throw integrityError(
      "CONVERSATION_IMAGE_LIMIT",
      `Keep at most ${CONVERSATION_IMAGE_MAX_COUNT} images in one message.`,
    );
  }
  const attachmentIDs = new Set<string>();
  let total = 0;
  return uploads.map((upload) => {
    if (attachmentIDs.has(upload.attachment_id)) {
      throw integrityError(
        "CONVERSATION_IMAGE_DUPLICATE_ATTACHMENT",
        "Each image attachment id must be unique within one message.",
      );
    }
    attachmentIDs.add(upload.attachment_id);
    if (
      upload.byte_size < 1 ||
      upload.byte_size > CONVERSATION_IMAGE_MAX_BYTES
    ) {
      throw integrityError(
        "CONVERSATION_IMAGE_SIZE_INVALID",
        "Each image must be 10 MB or smaller.",
      );
    }
    const fileName = upload.file_name.trim();
    if (!fileName || fileName.length > 200) {
      throw integrityError(
        "CONVERSATION_IMAGE_NAME_INVALID",
        "Each image needs a bounded file name.",
      );
    }
    const manifest = validateContactImage({
      media_type: upload.media_type,
      byte_size: upload.byte_size,
      content_hash: upload.content_hash,
      data_base64: upload.data_base64,
    });
    total += manifest.byte_size;
    if (total > CONVERSATION_IMAGE_MAX_TOTAL_BYTES) {
      throw integrityError(
        "CONVERSATION_IMAGE_TOTAL_LIMIT",
        "A message may carry at most 30 MB of images.",
      );
    }
    return {
      attachment_id: upload.attachment_id,
      file_name: fileName,
      media_type: manifest.media_type,
      byte_size: manifest.byte_size,
      content_hash: manifest.content_hash,
    };
  });
}

/** Immutable commitment over the ordered manifest, including attachment ids. */
export function conversationImageManifestHash(
  manifests: readonly ConversationImageManifest[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        manifests.map((manifest) => [
          manifest.attachment_id,
          manifest.file_name,
          manifest.media_type,
          manifest.byte_size,
          manifest.content_hash,
        ]),
      ),
    )
    .digest("hex");
}

/**
 * Persist the ordered manifest and exact bytes atomically with admission.
 * Caller already runs inside the admission transaction.
 */
export async function persistConversationMessageImages(
  client: PoolClient,
  auth: AuthContext,
  input: {
    sessionId: string;
    messageId: string;
    queueEntryId: string;
    expiresAt: Date;
    uploads: readonly ConversationImageUpload[];
  },
): Promise<void> {
  for (const [index, upload] of input.uploads.entries()) {
    const bytes = Buffer.from(upload.data_base64, "base64");
    await client.query(
      `INSERT INTO conversation_message_images(
         account_id,session_id,message_id,queue_entry_id,image_index,attachment_id,
         file_name,media_type,byte_size,content_hash,content,expires_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        auth.accountId,
        input.sessionId,
        input.messageId,
        input.queueEntryId,
        index,
        upload.attachment_id,
        upload.file_name.trim(),
        upload.media_type,
        upload.byte_size,
        upload.content_hash,
        bytes,
        input.expiresAt,
      ],
    );
  }
}

/** Ordered manifests for a bounded set of queue entries, keyed by entry id. */
export async function readConversationMessageImageManifests(
  client: DatabaseClient,
  accountId: string,
  queueEntryIds: readonly string[],
): Promise<Map<string, ConversationImageManifest[]>> {
  const grouped = new Map<string, ConversationImageManifest[]>();
  if (queueEntryIds.length === 0) return grouped;
  const rows = (
    await client.query<{
      queue_entry_id: string;
      attachment_id: string;
      file_name: string;
      media_type: ConversationImageManifest["media_type"];
      byte_size: number;
      content_hash: string;
    }>(
      `SELECT queue_entry_id,attachment_id,file_name,media_type,byte_size,content_hash
       FROM conversation_message_images
       WHERE account_id=$1 AND queue_entry_id = ANY($2::uuid[])
       ORDER BY queue_entry_id, image_index`,
      [accountId, queueEntryIds],
    )
  ).rows;
  for (const row of rows) {
    const list = grouped.get(row.queue_entry_id) ?? [];
    list.push({
      attachment_id: row.attachment_id,
      file_name: row.file_name,
      media_type: row.media_type,
      byte_size: row.byte_size,
      content_hash: row.content_hash,
    });
    grouped.set(row.queue_entry_id, list);
  }
  return grouped;
}

/** Ordered bytes plus manifest for one queue entry; used by the runner only. */
export async function readConversationMessageImages(
  pool: Pool,
  accountId: string,
  queueEntryId: string,
): Promise<ConversationMessageImage[]> {
  const rows = (
    await pool.query<{
      attachment_id: string;
      file_name: string;
      media_type: ConversationImageManifest["media_type"];
      byte_size: number;
      content_hash: string;
      content: Buffer;
    }>(
      `SELECT attachment_id,file_name,media_type,byte_size,content_hash,content
       FROM conversation_message_images
       WHERE account_id=$1 AND queue_entry_id=$2
       ORDER BY image_index`,
      [accountId, queueEntryId],
    )
  ).rows;
  return rows.map((row) => ({
    manifest: {
      attachment_id: row.attachment_id,
      file_name: row.file_name,
      media_type: row.media_type,
      byte_size: row.byte_size,
      content_hash: row.content_hash,
    },
    data: new Uint8Array(row.content),
  }));
}

/**
 * Images for one run: the current message first, then recent earlier images
 * from the same Session only, bounded to the shared 10-image / 30 MB budget.
 * The current message always wins; earlier images fill the remaining room in
 * deterministic chronological order. Other Sessions and accounts are never
 * joined in, and out-of-budget images are counted so the caller can say so.
 */
export async function readConversationRunImages(
  pool: Pool,
  accountId: string,
  sessionId: string,
  queueEntryId: string,
): Promise<ConversationRunImages> {
  const rows = (
    await pool.query<{
      queue_entry_id: string;
      message_id: string;
      attachment_id: string;
      file_name: string;
      media_type: ConversationImageManifest["media_type"];
      byte_size: number;
      content_hash: string;
      sequence: string;
      image_index: number;
    }>(
      `SELECT i.queue_entry_id,i.message_id,i.attachment_id,i.file_name,i.media_type,
              i.byte_size,i.content_hash,e.sequence,i.image_index
       FROM conversation_message_images i
       JOIN conversation_queue_entries e
         ON e.account_id=i.account_id AND e.id=i.queue_entry_id
       WHERE i.account_id=$1 AND i.session_id=$2
         AND (i.queue_entry_id=$3 OR e.sequence < (
           SELECT sequence FROM conversation_queue_entries
           WHERE account_id=$1 AND id=$3
         ))
       ORDER BY e.sequence DESC, i.image_index ASC`,
      [accountId, sessionId, queueEntryId],
    )
  ).rows;
  const current = rows.filter((row) => row.queue_entry_id === queueEntryId);
  const earlier = rows.filter((row) => row.queue_entry_id !== queueEntryId);
  const included: typeof earlier = [];
  let count = current.length;
  let bytes = current.reduce((total, row) => total + row.byte_size, 0);
  for (const row of earlier) {
    if (count >= CONVERSATION_IMAGE_MAX_COUNT || bytes + row.byte_size > CONVERSATION_IMAGE_MAX_TOTAL_BYTES) continue;
    included.push(row);
    count += 1;
    bytes += row.byte_size;
  }
  // Select metadata first: never pull unbounded historical BYTEA into Node.
  // Sorting by sequence AND original index preserves multi-image message order.
  const ordered = included.concat(current).sort((a, b) =>
    BigInt(a.sequence) < BigInt(b.sequence) ? -1 :
      BigInt(a.sequence) > BigInt(b.sequence) ? 1 : a.image_index - b.image_index,
  );
  if (ordered.length === 0) return { images: [], omitted: earlier.length };
  const contentRows = (await pool.query<{
    queue_entry_id: string; image_index: number; content: Buffer;
  }>(
    `SELECT i.queue_entry_id,i.image_index,i.content
     FROM conversation_message_images i
     JOIN unnest($3::uuid[], $4::integer[]) AS selected(entry_id, image_index)
       ON i.queue_entry_id=selected.entry_id AND i.image_index=selected.image_index
     WHERE i.account_id=$1 AND i.session_id=$2`,
    [accountId, sessionId, ordered.map((row) => row.queue_entry_id), ordered.map((row) => row.image_index)],
  )).rows;
  const contents = new Map(contentRows.map((row) => [
    `${row.queue_entry_id}:${row.image_index}`, row.content,
  ]));
  return {
    images: ordered.flatMap((row) => {
      const content = contents.get(`${row.queue_entry_id}:${row.image_index}`);
      // A concurrent Session deletion must not manufacture empty image input.
      if (!content) return [];
      return [{
      messageId: row.message_id,
      imageIndex: row.image_index,
      manifest: {
        attachment_id: row.attachment_id,
        file_name: row.file_name,
        media_type: row.media_type,
        byte_size: row.byte_size,
        content_hash: row.content_hash,
      },
      data: new Uint8Array(content),
    }];
    }),
    omitted: earlier.length - included.length,
  };
}

/**
 * Original-image readback.
 *
 * Authority is derived from the owned queue record and current Session
 * lifecycle, never from a free-form Session JSON blob. A later account switch,
 * deletion or expiry makes the same URL return nothing.
 */
export async function readConversationMessageImage(
  pool: Pool,
  auth: AuthContext,
  sessionId: string,
  messageId: string,
  imageIndex: number,
): Promise<{ media_type: string; content: Buffer } | null> {
  const row = (
    await pool.query<{ media_type: string; content: Buffer }>(
      `SELECT i.media_type, i.content
       FROM conversation_message_images i
       JOIN conversation_queue_entries e
         ON e.account_id=i.account_id AND e.id=i.queue_entry_id
       JOIN agent_sessions s
         ON s.account_id=i.account_id AND s.id=i.session_id
       WHERE i.account_id=$1 AND i.session_id=$2 AND i.message_id=$3
         AND i.image_index=$4
         AND e.created_by_user_id=$5
         AND e.expires_at>now()
         AND i.expires_at>now()
         AND encode(sha256(i.content),'hex')=i.content_hash AND s.created_by_user_id=$5
         AND s.deleted_at IS NULL AND s.expires_at>now()
         AND NOT EXISTS (SELECT 1 FROM memory_source_revocations r WHERE r.account_id=i.account_id
           AND ((r.source_kind='artifact' AND r.source_id='conversation-image-'||i.message_id::text||'-'||i.image_index::text||'-'||i.attachment_id::text)
             OR (r.source_kind='session' AND r.source_id=i.session_id::text)))`,
      [auth.accountId, sessionId, messageId, imageIndex, auth.userId],
    )
  ).rows[0];
  return row ?? null;
}
