import type { AuthContext } from "./auth.js";
import { ApiError } from "../lib/apiError.js";
import type { DatabaseClient } from "../database/pool.js";
import {
  resolveSessionSourceAuthority,
  sourceRevisionHash,
  type MemoryImageManifestEntry,
  type MemorySourceAuthority,
  type ProposalItemRow,
  type ProposalRow,
} from "./memoryReviewStore.js";

export interface PendingVerification {
  /** The proposal's own contact/message source snapshot is currently available. */
  proposalSourceAvailable: boolean;
  /** Pending items whose bound source is no longer available or no longer matches. */
  unavailableItemIds: Set<string>;
}

function sameImageManifest(
  stored: readonly MemoryImageManifestEntry[],
  current: readonly MemoryImageManifestEntry[],
): boolean {
  if (stored.length !== current.length) return false;
  for (let index = 0; index < stored.length; index += 1) {
    const left = stored[index]!;
    const right = current[index]!;
    if (
      left.index !== right.index
      || left.attachmentId !== right.attachmentId
      || left.contentHash !== right.contentHash
    ) {
      return false;
    }
  }
  return true;
}

async function sessionPendingAvailable(
  client: DatabaseClient,
  auth: AuthContext,
  sessionId: string,
  lock: boolean,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM agent_sessions
     WHERE account_id = $1 AND id = $2
       AND created_by_user_id = $3
       AND deleted_at IS NULL
       AND expires_at > now()
       AND payload IS NOT NULL
     ${lock ? "FOR SHARE" : ""}`,
    [auth.accountId, sessionId, auth.userId],
  );
  return Boolean(result.rows[0]);
}

async function tombstoneBlocks(
  client: DatabaseClient,
  accountId: string,
  binding: {
    sessionIds: readonly string[];
    captureIds: readonly string[];
    artifactIds: readonly string[];
    captureVersion: number | null;
  },
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM memory_source_revocations
     WHERE account_id = $1
       AND (source_version IS NULL OR source_version = $2::integer)
       AND (
         (source_kind = 'session' AND source_id = ANY($3::text[]))
         OR (source_kind = 'capture' AND source_id = ANY($4::text[]))
         OR (source_kind = 'artifact' AND source_id = ANY($5::text[]))
       )
     LIMIT 1`,
    [
      accountId,
      binding.captureVersion,
      binding.sessionIds,
      binding.captureIds,
      binding.artifactIds,
    ],
  );
  return Boolean(result.rows[0]);
}

/**
 * Reconstruct current host authority for a pending proposal and compare it to
 * the immutable snapshot bound at stage time. Pending proposals require the
 * original source to still be available; accepted minimum evidence is governed
 * separately after a successful commit. Only the exact reviewed message and its
 * ordered admitted images are compared, never the whole Session revision.
 */
export async function verifyPendingSourceAuthority(
  client: DatabaseClient,
  auth: AuthContext,
  proposal: ProposalRow,
  items: readonly ProposalItemRow[],
  options: { lock?: boolean } = {},
): Promise<PendingVerification> {
  const unavailableItemIds = new Set<string>();
  const lock = options.lock === true;
  // Empty contact-only proposals carry provenance at the Session/message level.
  // Without that binding there are no item sources to verify: fail closed.
  let proposalSourceAvailable = items.length > 0 || Boolean(proposal.session_id && proposal.source_message_id);
  let currentAuthority: MemorySourceAuthority | null = null;

  if (proposal.session_id) {
    try {
      currentAuthority = await resolveSessionSourceAuthority(
        client,
        auth,
        proposal.session_id,
        proposal.source_message_id,
        options,
      );
    } catch {
      currentAuthority = null;
    }
    const storedManifest = proposal.source_image_manifest ?? [];
    if (
      !currentAuthority
      || (proposal.source_message_text_hash ?? null) !== currentAuthority.messageTextHash
      || !sameImageManifest(storedManifest, currentAuthority.imageManifest)
      || (proposal.source_revision_hash ?? null) !== sourceRevisionHash(currentAuthority)
    ) {
      proposalSourceAvailable = false;
    }
  } else if (proposal.source_capture_version !== null) {
    // Capture-sourced proposals verify the bound epoch below via their items.
    proposalSourceAvailable = items.length > 0;
  } else if (items.length > 0 && items.every((item) => !item.source_session_id && !item.capture_id)) {
    proposalSourceAvailable = false;
  }

  // Contact-only image proposals deliberately have no item rows. Their
  // Session and immutable admitted artifacts still carry revocation authority.
  // The resolver above takes source locks before this ledger read on commit.
  if (proposalSourceAvailable && currentAuthority) {
    proposalSourceAvailable = !(await tombstoneBlocks(client, auth.accountId, {
      sessionIds: currentAuthority.sessionId ? [currentAuthority.sessionId] : [],
      captureIds: currentAuthority.captureIds,
      artifactIds: currentAuthority.artifacts.map(artifact => artifact.artifactId),
      captureVersion: currentAuthority.captureVersion,
    }));
  }

  const captureItems = items.filter((item) => item.capture_id);
  const captureById = new Map<
    string,
    { version: number; subject: string | null; context: string | null }
  >();
  for (const captureId of new Set(captureItems.map((item) => item.capture_id!))) {
    const capture = await client.query<{
      version: number;
      subject_id: string | null;
      assignment_id: string | null;
      status: string;
    }>(
      `SELECT version, subject_id, assignment_id, status
       FROM captures
       WHERE account_id = $1 AND id = $2
       ${lock ? "FOR SHARE" : ""}`,
      [auth.accountId, captureId],
    );
    const row = capture.rows[0];
    if (row && row.status === "active") {
      captureById.set(captureId, {
        version: row.version,
        subject: row.subject_id,
        context: row.assignment_id,
      });
    }
  }

  for (const item of items) {
    let available = true;
    let captureVersion: number | null = item.source_capture_version;
    if (item.capture_id) {
      const capture = captureById.get(item.capture_id);
      available = Boolean(
        capture
        && capture.version === item.source_capture_version
        && capture.subject === item.subject_id
        && capture.context === (item.relationship_context_id ?? capture.context),
      );
      captureVersion = capture?.version ?? item.source_capture_version;
      if (available) {
        // Pending review fails closed on the current source-access authority
        // (explicit authorization, deadline, and retention) before the sweep.
        const receipt = await client.query<{
          authorization_state: string;
          source_access_state: string;
          authorization_expires_at: Date | null;
          retention_until: Date | null;
        }>(
          `SELECT authorization_state, source_access_state,
                  authorization_expires_at, retention_until
           FROM source_retention_receipts
           WHERE account_id = $1 AND capture_id = $2`,
          [auth.accountId, item.capture_id],
        );
        const receiptRow = receipt.rows[0];
        available = Boolean(
          receiptRow
          && receiptRow.authorization_state === "authorized"
          && receiptRow.source_access_state === "available"
          && (!receiptRow.authorization_expires_at
            || receiptRow.authorization_expires_at.getTime() > Date.now())
          && (!receiptRow.retention_until
            || receiptRow.retention_until.getTime() > Date.now()),
        );
      }
      if (available && item.source_resource_id) {
        const resource = await client.query<{ id: string }>(
          `SELECT resources.id
           FROM source_resources resources
           WHERE resources.account_id = $1 AND resources.id = $2
             AND resources.processing_state <> 'deleted'
             AND resources.deleted_at IS NULL`,
          [auth.accountId, item.source_resource_id],
        );
        available = Boolean(resource.rows[0]);
      }
      if (available && item.evidence_fragment_id) {
        const fragment = await client.query<{ id: string }>(
          `SELECT id FROM evidence_fragments
           WHERE account_id = $1 AND id = $2 AND status = 'active'`,
          [auth.accountId, item.evidence_fragment_id],
        );
        available = Boolean(fragment.rows[0]);
      }
    } else if (item.source_artifact_id || item.source_session_id) {
      // Relationship Chat media are real chat_media_assets rows; every other
      // artifact belongs to the admitted Session message authority.
      const looksLikeMediaId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        item.source_artifact_id ?? "",
      );
      let mediaAvailable = false;
      if (looksLikeMediaId) {
        const media = await client.query<{ id: string }>(
          `SELECT id FROM chat_media_assets
           WHERE account_id = $1 AND id::text = $2
             AND status = 'ready' AND deleted_at IS NULL`,
          [auth.accountId, item.source_artifact_id],
        );
        mediaAvailable = Boolean(media.rows[0]);
      }
      if (mediaAvailable) {
        available = item.source_session_id
          ? await sessionPendingAvailable(client, auth, item.source_session_id, lock)
          : true;
      } else if (item.source_session_id) {
        available = proposalSourceAvailable
          && (currentAuthority?.messageId ?? proposal.source_message_id)
            === item.source_message_id;
      } else {
        available = false;
      }
    } else {
      available = false;
    }
    if (available) {
      available = !(await tombstoneBlocks(client, auth.accountId, {
        sessionIds: item.source_session_id ? [item.source_session_id] : [],
        captureIds: item.capture_id ? [item.capture_id] : [],
        artifactIds: item.source_artifact_id ? [item.source_artifact_id] : [],
        captureVersion,
      }));
    }
    if (!available) unavailableItemIds.add(item.id);
  }

  return { proposalSourceAvailable, unavailableItemIds };
}

/** Strict gate for commit/reproposal: missing authority is a hard rejection. */
export async function assertPendingSourceAuthority(
  client: DatabaseClient,
  auth: AuthContext,
  proposal: ProposalRow,
  items: readonly ProposalItemRow[],
  options: { lock?: boolean } = {},
): Promise<{ unavailableItemIds: Set<string> }> {
  const result = await verifyPendingSourceAuthority(
    client,
    auth,
    proposal,
    items,
    options,
  );
  if (!result.proposalSourceAvailable) {
    throw new ApiError(
      409,
      "MEMORY_SOURCE_UNAVAILABLE",
      "The original admitted source is no longer available; review cannot proceed.",
    );
  }
  return { unavailableItemIds: result.unavailableItemIds };
}
