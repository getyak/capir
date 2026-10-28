import type { Pool } from "pg";
import { inTransaction } from "../database/pool.js";
import { sha256 } from "../lib/hash.js";
import type { ChatMediaStorage } from "./chatMediaStorage.js";

interface Tombstone {
  account_id: string; id: string; subject_id: string; object_key: string;
  storage_provider: string; upload_state: string; upload_storage_scope: string | null;
  trusted_intent: boolean; submitted: boolean; deleted_at: Date; audit_sequence: string | null;
}
interface InventoryEntry {
  fingerprint: string; owner_fingerprint: string; blockers: string[];
  versions: number | null; delete_markers: number | null;
}

/** Metadata-only operator inventory. It cannot permanently delete any object. */
export async function inspectDeletedChatMedia(pool: Pool, storage: ChatMediaStorage) {
  return inTransaction(pool, async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const rows = await client.query<Tombstone>(`SELECT media.account_id,media.id,media.subject_id,
      media.object_key,media.storage_provider,media.upload_state,media.upload_storage_scope,media.deleted_at,
      EXISTS(SELECT 1 FROM context_manifest_media binding WHERE binding.account_id=media.account_id
        AND binding.media_id=media.id) AS submitted,
      EXISTS(SELECT 1 FROM audit_events event WHERE event.account_id=media.account_id
        AND event.entity_id=media.id AND event.entity_type='chat_media_asset'
        AND event.event_type='chat_media.deleted' AND event.actor_user_id=media.created_by_user_id
        AND event.metadata @> '{"submitted":false}'::jsonb AND event.occurred_at=media.deleted_at) AS trusted_intent,
      (SELECT max(event.sequence)::text FROM audit_events event WHERE event.account_id=media.account_id
        AND event.entity_id=media.id AND event.entity_type='chat_media_asset'
        AND event.event_type='chat_media.deleted' AND event.actor_user_id=media.created_by_user_id
        AND event.metadata @> '{"submitted":false}'::jsonb AND event.occurred_at=media.deleted_at) AS audit_sequence
      FROM chat_media_assets media WHERE media.status='deleted' AND media.deleted_at IS NOT NULL
      ORDER BY media.account_id,media.id LIMIT 1001`);
    const entries: InventoryEntry[] = [];
    let inspected = 0, retainedVersions = 0, retainedMarkers = 0;
    for (const row of rows.rows.slice(0, 1000)) {
      const blockers: string[] = [];
      if (!row.trusted_intent) blockers.push("deletion_intent_unproven");
      if (row.submitted) blockers.push("submitted_media");
      if (row.upload_state !== "idle") blockers.push("upload_unsettled");
      if (row.object_key !== `${row.account_id}/${row.subject_id}/${row.id}`) blockers.push("object_owner_mismatch");
      if (row.storage_provider !== storage.provider) blockers.push("storage_provider_mismatch");
      if (row.upload_storage_scope && row.upload_storage_scope !== storage.labScopeID) blockers.push("storage_scope_mismatch");
      if (!storage.inspectVersions || !storage.labScopeID || storage.provider !== "s3") blockers.push("version_inventory_unavailable");
      let versions: number | null = null, markers: number | null = null;
      if (blockers.length === 0) {
        // Legacy rows have no recorded store fingerprint. Listing only the
        // configured store is useful evidence, never proof it was the old store.
        if (!row.upload_storage_scope) blockers.push("legacy_storage_scope_unverified");
        try {
          const inventory = await storage.inspectVersions!(row.object_key);
          versions = inventory.versions; markers = inventory.deleteMarkers;
          inspected++; retainedVersions += versions; retainedMarkers += markers;
        } catch { blockers.push("version_inventory_failed"); }
      }
      entries.push({
        fingerprint: sha256(JSON.stringify([row.account_id, row.id, row.object_key, row.deleted_at, row.audit_sequence])),
        owner_fingerprint: sha256(row.account_id), blockers, versions, delete_markers: markers,
      });
    }
    return {
      version: "chat-media-deletion-inventory.v1", mode: "dry_run" as const,
      storage_scope_sha256: storage.labScopeID ? sha256(storage.labScopeID) : null,
      truncated: rows.rows.length > 1000, considered: entries.length, inspected,
      retained_versions: retainedVersions, retained_delete_markers: retainedMarkers,
      scope_sha256: sha256(JSON.stringify(entries)), entries,
    };
  });
}

/** Operator-only recovery of the control receipt after Lab's data write gate closes. */
export async function reconcileStoppedLabUpload(
  pool: Pool, storage: ChatMediaStorage, accountId: string, mediaId: string, attemptId: string,
): Promise<{ status: "workspace_cleanup_ready" | "unresolved" }> {
  return inTransaction(pool, async client => {
    // Keep the canonical workspace -> media lock order. Do not reopen or write
    // the closed account graph; only its existing control ledger can settle.
    const workspace = (await client.query<{ id: string; media_scope_hash: string }>(
      "SELECT id,media_scope_hash FROM lab_test_workspaces WHERE target_account_id=$1 AND state='deleting' FOR SHARE",
      [accountId])).rows[0];
    const row = (await client.query<{ object_key: string; subject_id: string; byte_size: number;
      media_type: string; upload_attempt_id: string; upload_storage_scope: string; storage_provider: string }>(
      `SELECT object_key,subject_id,byte_size,media_type,upload_attempt_id,upload_storage_scope,storage_provider
       FROM chat_media_assets WHERE account_id=$1 AND id=$2 FOR UPDATE`, [accountId, mediaId])).rows[0];
    if (!workspace || !row || row.upload_attempt_id !== attemptId ||
        row.object_key !== `${accountId}/${row.subject_id}/${mediaId}` || row.storage_provider !== "s3" ||
        storage.provider !== "s3" || !storage.verifyUpload || !storage.labScopeID ||
        row.upload_storage_scope !== storage.labScopeID || workspace.media_scope_hash !== storage.labScopeID) {
      throw new Error("CHAT_MEDIA_RECOVERY_SCOPE_CHANGED");
    }
    const write = (await client.query("SELECT 1 FROM lab_test_workspace_media_writes WHERE workspace_id=$1 AND media_id=$2 AND id=$3 FOR UPDATE",
      [workspace.id, mediaId, attemptId])).rows[0];
    if (!write) throw new Error("CHAT_MEDIA_RECOVERY_SCOPE_CHANGED");
    if (!await storage.verifyUpload(row.object_key, attemptId, row.byte_size, row.media_type)) return { status: "unresolved" };
    const receipt = sha256(JSON.stringify(["s3_head_complete_attempt.v1", storage.labScopeID, attemptId, row.byte_size, row.media_type]));
    await client.query(`UPDATE lab_test_workspace_media_writes SET state='settled',settled_at=now(),settlement_receipt=$4
      WHERE workspace_id=$1 AND media_id=$2 AND id=$3`, [workspace.id, mediaId, attemptId, receipt]);
    return { status: "workspace_cleanup_ready" };
  });
}
