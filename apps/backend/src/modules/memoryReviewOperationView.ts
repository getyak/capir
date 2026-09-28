import {
  CONTRACT_VERSION,
  type MemoryOperationUndoRequest,
  type MemoryOperationUndoResponse,
  type MemoryReceipt,
  type MemoryScopedOperationView,
  type MemorySurface,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import { inTransaction, type DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { undoMemoryCommitInTransaction, assertScopePursuitCurrent, receiptSourceAvailable } from "./memoryReviewCommit.js";
import { loadReviewScope, serializeReceipt, type ReviewScopeRow } from "./memoryReviewStore.js";

interface ScopedCommitRow {
  commit_id: string;
  commit_revision: number;
  status: "applied" | "undone";
  proposal_id: string;
  proposal_revision: number;
  review_scope_id: string;
  created_person_id: string | null;
  created_relationship_context_id: string | null;
  source_session_id: string | null;
  undo_contact_outcome: "retained" | "reclaimed" | null;
  undo_context_outcome: "retained" | "reclaimed" | null;
}

interface ScopedCommitItemRow {
  proposal_item_id: string;
  scope: "self" | "person" | "relationship";
  subject_id: string | null;
  relationship_context_id: string | null;
}

interface ScopedProposalItemRow {
  id: string;
  scope: "self" | "person" | "relationship";
  subject_id: string | null;
  relationship_context_id: string | null;
  subject_kind: "owner_self" | "resolved_subject" | "proposal_target";
  relationship_kind: "none" | "resolved_context" | "proposal_target_context";
}

export interface ScopedOperationQuery {
  purpose: MemorySurface;
  person_id?: string | null;
  relationship_context_id?: string | null;
  session_id?: string | null;
  pursuit_id?: string | null;
  pursuit_role_id?: string | null;
  pursuit_role_evidence_fragment_id?: string | null;
  pursuit_capture_id?: string | null;
  pursuit_capture_version?: number | null;
}

async function assertScopeTargetAuthorized(
  client: DatabaseClient,
  auth: AuthContext,
  query: ScopedOperationQuery,
): Promise<void> {
  if (query.purpose === "chat") return;
  if (!query.person_id) {
    throw new ApiError(
      400,
      "MEMORY_SCOPE_REQUIRED",
      "This business surface needs the actual person scope.",
    );
  }
  const person = await client.query<{ id: string }>(
    `SELECT id FROM subjects
     WHERE account_id = $1 AND id = $2 AND status = 'active'`,
    [auth.accountId, query.person_id],
  );
  if (!person.rows[0]) {
    throw new ApiError(404, "MEMORY_NOT_FOUND", "The requested contact was not found.");
  }
  if (query.purpose === "relationship") {
    if (!query.relationship_context_id) {
      throw new ApiError(
        400,
        "MEMORY_SCOPE_REQUIRED",
        "The relationship surface needs its exact relationship context.",
      );
    }
    const assignment = await client.query<{ id: string }>(
      `SELECT id FROM assignments
       WHERE account_id = $1 AND id = $2 AND subject_id = $3
         AND status = 'active'`,
      [auth.accountId, query.relationship_context_id, query.person_id],
    );
    if (!assignment.rows[0]) {
      throw new ApiError(
        404,
        "MEMORY_NOT_FOUND",
        "The requested relationship context was not found.",
      );
    }
  }
}

function itemVisibleInScope(
  item: ScopedCommitItemRow,
  query: ScopedOperationQuery,
): boolean {
  if (query.purpose === "chat") return true;
  if (item.scope === "self") return false;
  if (item.subject_id !== query.person_id) return false;
  if (query.purpose === "people") {
    return (
      !query.relationship_context_id
      || !item.relationship_context_id
      || item.relationship_context_id === query.relationship_context_id
    );
  }
  return item.relationship_context_id === query.relationship_context_id;
}

/**
 * Restricted projection of one committed operation. A business surface only
 * ever sees its own authorized effects; a mixed private Chat batch is not
 * exposed and its whole-batch undo stays unavailable here.
 */
export async function readMemoryScopedOperationView(
  pool: Pool,
  auth: AuthContext,
  operationKey: string,
  query: ScopedOperationQuery,
): Promise<MemoryScopedOperationView> {
  return inTransaction(pool, (client) => readMemoryScopedOperationViewInTransaction(client, auth, operationKey, query));
}

async function readSkippedItemOperation(
  client: PoolClient,
  auth: AuthContext,
  operationKey: string,
  query: ScopedOperationQuery,
): Promise<MemoryScopedOperationView | null> {
  const records = await client.query<{
    operation_scope: string;
    status: string;
    response_body: { dismissed_item_ids?: unknown } | null;
  }>(
    `SELECT operation_scope, status, response_body
     FROM idempotency_records
     WHERE account_id = $1 AND actor_user_id = $2 AND idempotency_key = $3
       AND operation_scope LIKE 'dismiss_memory_review:%'`,
    [auth.accountId, auth.userId, operationKey],
  );
  if (records.rows.length !== 1) return null;
  const record = records.rows[0]!;
  const scopeId = record.operation_scope.slice("dismiss_memory_review:".length);
  const scope = await loadReviewScope(client, auth.accountId, scopeId, true);
  if (!scope || scope.reader_user_id !== auth.userId) return null;
  if (scope.purpose !== query.purpose
    || (query.session_id && query.session_id !== scope.source_session_id)
    || (query.person_id && query.person_id !== scope.person_id)
    || (query.relationship_context_id && query.relationship_context_id !== scope.relationship_context_id)
    || (query.pursuit_id && (query.pursuit_id !== scope.pursuit_id
      || query.pursuit_role_id !== scope.pursuit_role_id
      || query.pursuit_role_evidence_fragment_id !== scope.pursuit_role_evidence_fragment_id
      || query.pursuit_capture_id !== scope.pursuit_capture_id
      || query.pursuit_capture_version !== scope.pursuit_capture_version))) {
    throw new ApiError(403, "MEMORY_ENTRY_SCOPE_MISMATCH", "This operation belongs to a different entry.");
  }
  await assertScopePursuitCurrent(client, auth, scope, true, true);
  if (query.purpose !== "chat") await assertScopeTargetAuthorized(client, auth, query);
  const ids = record.response_body?.dismissed_item_ids;
  const itemId = record.status === "completed" && Array.isArray(ids) && ids.length === 1
    && typeof ids[0] === "string" ? ids[0] : null;
  const item = itemId ? await client.query<{ status: string }>(
    `SELECT status FROM memory_proposal_items
     WHERE account_id = $1 AND proposal_id = $2 AND id = $3`,
    [auth.accountId, scope.proposal_id, itemId],
  ) : null;
  const skipped = item?.rows[0]?.status === "skipped";
  return {
    contract_version: CONTRACT_VERSION,
    operation_key: operationKey,
    state: record.status === "processing" ? "pending" : skipped ? "skipped" : "unavailable",
    dismissed_item_id: skipped ? itemId : null,
    purpose: query.purpose,
    person_id: query.person_id ?? null,
    relationship_context_id: query.relationship_context_id ?? null,
    source_session_id: scope.source_session_id,
    pursuit_id: scope.pursuit_id,
    pursuit_role_id: scope.pursuit_role_id,
    pursuit_role_evidence_fragment_id: scope.pursuit_role_evidence_fragment_id,
    pursuit_capture_id: scope.pursuit_capture_id,
    pursuit_capture_version: scope.pursuit_capture_version,
    visible_effect_count: 0,
    visible_receipt: null,
    undo: { allowed: false, limits: [] },
  };
}

async function readMemoryScopedOperationViewInTransaction(
  client: PoolClient, auth: AuthContext, operationKey: string, query: ScopedOperationQuery,
): Promise<MemoryScopedOperationView> {
    const commit = await client.query<ScopedCommitRow>(
      `SELECT commits.id AS commit_id, commits.revision AS commit_revision,
              commits.status, commits.proposal_id, commits.proposal_revision,
              commits.review_scope_id, commits.created_person_id,
              commits.created_relationship_context_id,
              receipt.undo_contact_outcome, receipt.undo_context_outcome,
              proposal.session_id AS source_session_id
       FROM memory_commits commits
       JOIN memory_proposals proposal
         ON proposal.account_id = commits.account_id
        AND proposal.id = commits.proposal_id
       JOIN memory_receipts receipt ON receipt.account_id = commits.account_id AND receipt.commit_id = commits.id
       WHERE commits.account_id = $1
         AND commits.operation_key = $2
         AND commits.committed_by_user_id = $3
       FOR SHARE OF commits`,
      [auth.accountId, operationKey, auth.userId],
    );
    const row = commit.rows[0];
    let storedScope: ReviewScopeRow | null = null;
    if (row) {
      const scope = await loadReviewScope(client, auth.accountId, row.review_scope_id, true);
      if (!scope) throw new ApiError(404, "MEMORY_NOT_FOUND", "The operation scope was not found.");
      storedScope = scope;
      if ((query.session_id && query.session_id !== row.source_session_id) ||
          (query.pursuit_id && (query.pursuit_id !== scope.pursuit_id ||
            query.pursuit_role_id !== scope.pursuit_role_id ||
            query.pursuit_role_evidence_fragment_id !== scope.pursuit_role_evidence_fragment_id ||
            query.pursuit_capture_id !== scope.pursuit_capture_id ||
            query.pursuit_capture_version !== scope.pursuit_capture_version))) {
        throw new ApiError(403, "MEMORY_ENTRY_SCOPE_MISMATCH", "This operation belongs to a different entry.");
      }
      await assertScopePursuitCurrent(client, auth, scope, true, true);
      // A historical own compensation stays recoverable through the original
      // operation lineage even after the created person/context was reclaimed;
      // every other read still requires current entry authority.
      const reclaimedPerson = row.status === "undone" && row.undo_contact_outcome === "reclaimed"
        && Boolean(row.created_person_id) && query.person_id === row.created_person_id;
      const reclaimedContext = row.status === "undone" && row.undo_context_outcome === "reclaimed"
        && Boolean(row.created_relationship_context_id) && query.relationship_context_id === row.created_relationship_context_id;
      if (query.purpose !== "chat" && !(reclaimedPerson && (query.purpose === "people" || reclaimedContext))) {
        await assertScopeTargetAuthorized(client, auth, query);
      }
    }
    if (!row) {
      const skipped = await readSkippedItemOperation(client, auth, operationKey, query);
      if (skipped) return skipped;
      const pending = await client.query<{ status: string }>(
        `SELECT status FROM idempotency_records
         WHERE account_id = $1 AND actor_user_id = $2
           AND operation_scope IN ('commit_memory_review', 'commit_memory_review_item')
           AND idempotency_key = $3`,
        [auth.accountId, auth.userId, operationKey],
      );
      return {
        contract_version: CONTRACT_VERSION,
        operation_key: operationKey,
        state: pending.rows[0] ? "pending" : "unavailable",
        purpose: query.purpose,
        person_id: query.person_id ?? null,
        relationship_context_id: query.relationship_context_id ?? null,
        visible_effect_count: 0,
        visible_receipt: null,
        undo: { allowed: false, limits: ["This operation is not available in the current scope."] },
      };
    }

    const receipt = await client.query<
      Parameters<typeof serializeReceipt>[0]["receipt"] & {
        proposal_id: string;
        proposal_revision: number;
      }
    >(
      `SELECT receipts.*, commits.proposal_id, commits.proposal_revision
       FROM memory_receipts receipts
       JOIN memory_commits commits
         ON commits.account_id = receipts.account_id
        AND commits.id = receipts.commit_id
       WHERE receipts.account_id = $1 AND receipts.commit_id = $2`,
      [auth.accountId, row.commit_id],
    );
    const receiptRow = receipt.rows[0];
    if (!receiptRow) {
      return {
        contract_version: CONTRACT_VERSION,
        operation_key: operationKey,
        source_session_id: row.source_session_id,
        pursuit_id: storedScope?.pursuit_id ?? null,
        pursuit_role_id: storedScope?.pursuit_role_id ?? null,
        pursuit_role_evidence_fragment_id: storedScope?.pursuit_role_evidence_fragment_id ?? null,
        pursuit_capture_id: storedScope?.pursuit_capture_id ?? null,
        pursuit_capture_version: storedScope?.pursuit_capture_version ?? null,
        commit_id: row.commit_id,
        commit_revision: row.commit_revision,
        state: "unavailable",
        purpose: query.purpose,
        person_id: query.person_id ?? null,
        relationship_context_id: query.relationship_context_id ?? null,
        visible_effect_count: 0,
        visible_receipt: null,
        undo: { allowed: false, limits: ["The receipt is not available."] },
      };
    }
    // A revoked/deleted source must not restore the old candidate payload on
    // any surface, chat included.
    const sourceAvailable =
      row.status === "undone"
      || (await receiptSourceAvailable(client, auth.accountId, row.commit_id));
    if (!sourceAvailable) {
      return {
        contract_version: CONTRACT_VERSION,
        operation_key: operationKey,
        source_session_id: row.source_session_id,
        pursuit_id: storedScope?.pursuit_id ?? null,
        pursuit_role_id: storedScope?.pursuit_role_id ?? null,
        pursuit_role_evidence_fragment_id: storedScope?.pursuit_role_evidence_fragment_id ?? null,
        pursuit_capture_id: storedScope?.pursuit_capture_id ?? null,
        pursuit_capture_version: storedScope?.pursuit_capture_version ?? null,
        commit_id: row.commit_id,
        commit_revision: row.commit_revision,
        state: "source_revoked",
        purpose: query.purpose,
        person_id: query.person_id ?? null,
        relationship_context_id: query.relationship_context_id ?? null,
        visible_effect_count: 0,
        visible_receipt: null,
        undo: {
          allowed: false,
          limits: ["The committed source was revoked; this receipt is history only."],
        },
      };
    }

    // Decisions include skipped/kept-old scope effects that never create a
    // memory row, so scope checks must cover every receipt decision, not only
    // accepted commit items.
    const preliminary = serializeReceipt({
      receipt: receiptRow,
      proposalId: receiptRow.proposal_id,
      proposalRevision: receiptRow.proposal_revision,
      undoAllowed: false,
      undoLimits: [],
    });
    const decisionRows = preliminary.decisions.map((entry) => ({
      proposal_item_id: entry.proposal_item_id,
      decision: entry.decision,
      memory_item_id: entry.memory_item_id ?? null,
    }));
    // Skipped items are recorded only in skipped_item_ids, never in changes, so
    // visibility and whole-batch undo must account for them too.
    const skippedProposalIds: string[] = Array.isArray(receiptRow.skipped_item_ids)
      ? receiptRow.skipped_item_ids
      : [];
    const scopeProposalIds = [
      ...new Set([
        ...decisionRows.map((entry) => entry.proposal_item_id),
        ...skippedProposalIds,
      ]),
    ];
    const proposalItems = scopeProposalIds.length === 0
      ? { rows: [] as ScopedProposalItemRow[] }
      : await client.query<ScopedProposalItemRow>(
          `SELECT id, scope, subject_id, relationship_context_id, subject_kind, relationship_kind
           FROM memory_proposal_items
           WHERE account_id = $1 AND id = ANY($2::uuid[])`,
          [auth.accountId, scopeProposalIds],
        );
    const proposalById = new Map(proposalItems.rows.map((item) => [item.id, item]));
    const classify = (proposalItemId: string): ScopedCommitItemRow | null => {
      const item = proposalById.get(proposalItemId);
      if (!item) return null;
      return {
        proposal_item_id: item.id,
        scope: item.scope,
        subject_id:
          item.subject_id
          ?? (item.subject_kind === "proposal_target" ? row.created_person_id : null),
        relationship_context_id:
          item.relationship_context_id
          ?? (item.relationship_kind === "proposal_target_context"
            ? row.created_relationship_context_id
            : null),
      };
    };
    const visibleIds = new Set<string>();
    for (const proposalItemId of scopeProposalIds) {
      const classified = classify(proposalItemId);
      if (classified && itemVisibleInScope(classified, query)) {
        visibleIds.add(proposalItemId);
      }
    }
    const allVisible = scopeProposalIds.every((id) => visibleIds.has(id));
    const contactVisible =
      query.purpose === "chat"
      || !row.created_person_id
      || row.created_person_id === query.person_id;
    const contextVisible =
      query.purpose !== "relationship"
      || !row.created_relationship_context_id
      || row.created_relationship_context_id === query.relationship_context_id;
    const undoAllowed = row.status === "applied" && allVisible && contactVisible && contextVisible;
    const limits: string[] = [];
    if (row.status === "undone") limits.push("This commit was already undone.");
    if (!allVisible) {
      limits.push("Some original effects belong to another scope; undo them from the original authorized review.");
    }
    if (!contactVisible) {
      limits.push("The created contact is outside this scope.");
    }
    if (!contextVisible) {
      limits.push("The created relationship context is outside this scope.");
    }
    const full = serializeReceipt({
      receipt: receiptRow,
      proposalId: receiptRow.proposal_id,
      proposalRevision: receiptRow.proposal_revision,
      undoAllowed,
      undoLimits: limits,
    });
    // Receipt created/updated ids are memory ids; map them back through the
    // commit items so a scoped projection keeps its own visible effects.
    const memoryToProposal = new Map(
      decisionRows
        .filter((entry) => entry.memory_item_id)
        .map((entry) => [entry.memory_item_id!, entry.proposal_item_id]),
    );
    const visibleMemoryId = (memoryId: string): boolean => {
      const proposalItemId = memoryToProposal.get(memoryId);
      return proposalItemId ? visibleIds.has(proposalItemId) : false;
    };
    const visibleReceipt = projectReceipt(full, visibleIds, visibleMemoryId, {
      personId: query.purpose === "chat" ? null : query.person_id ?? null,
      contextId: query.purpose === "chat" ? null : query.relationship_context_id ?? null,
    });
    return {
      contract_version: CONTRACT_VERSION,
      operation_key: operationKey,
      commit_id: row.commit_id,
      commit_revision: row.commit_revision,
      state: row.status === "undone" ? "undone" : "applied",
      purpose: query.purpose,
      person_id: query.person_id ?? null,
      relationship_context_id: query.relationship_context_id ?? null,
      source_session_id: row.source_session_id,
      pursuit_id: storedScope?.pursuit_id ?? null,
      pursuit_role_id: storedScope?.pursuit_role_id ?? null,
      pursuit_role_evidence_fragment_id: storedScope?.pursuit_role_evidence_fragment_id ?? null,
      pursuit_capture_id: storedScope?.pursuit_capture_id ?? null,
      pursuit_capture_version: storedScope?.pursuit_capture_version ?? null,
      visible_effect_count: visibleIds.size,
      visible_receipt: visibleReceipt,
      undo: { allowed: undoAllowed, limits },
    };
}

function projectReceipt(
  receipt: MemoryReceipt,
  visibleIds: ReadonlySet<string>,
  visibleMemoryId: (memoryId: string) => boolean,
  scope: { personId: string | null; contextId: string | null },
): MemoryReceipt {
  const decisions = receipt.decisions.filter((entry) =>
    visibleIds.has(entry.proposal_item_id),
  );
  const visiblePerson =
    !scope.personId || receipt.created_person_id === scope.personId;
  // A hidden person must never leak its created relationship context on a
  // person query without a matching context.
  const visibleContext =
    visiblePerson
    && (!scope.contextId || receipt.created_relationship_context_id === scope.contextId);
  const appliedItemCount = decisions.filter(
    (entry) => entry.decision !== "keep_old" && entry.decision !== "skip",
  ).length;
  return {
    ...receipt,
    created_person_id: visiblePerson ? receipt.created_person_id ?? null : null,
    person_display_label: visiblePerson ? receipt.person_display_label ?? null : null,
    undo_contact_outcome: visiblePerson ? receipt.undo_contact_outcome ?? null : null,
    undo_context_outcome: visibleContext ? receipt.undo_context_outcome ?? null : null,
    created_relationship_context_id: visibleContext
      ? receipt.created_relationship_context_id ?? null
      : null,
    item_count: visibleIds.size,
    applied_item_count: appliedItemCount,
    created_item_ids: receipt.created_item_ids.filter(visibleMemoryId),
    updated_item_ids: receipt.updated_item_ids.filter(visibleMemoryId),
    skipped_item_ids: receipt.skipped_item_ids.filter((id) => visibleIds.has(id)),
    kept_old_item_ids: decisions
      .filter((entry) => entry.decision === "keep_old")
      .map((entry) => entry.proposal_item_id),
    decisions,
  };
}

/**
 * Scope-bound undo. Whole-batch compensation is allowed only when every
 * original effect is visible in the current authorized entry scope. A business
 * surface can never undo a mixed private Chat batch that includes invisible
 * self items.
 */
export async function undoMemoryScopedOperation(
  pool: Pool,
  auth: AuthContext,
  operationKey: string,
  request: MemoryOperationUndoRequest,
): Promise<MemoryOperationUndoResponse> {
  return inTransaction(pool, async (client) => {
    const operation = await client.query<{ id: string }>(
      `SELECT id FROM memory_commits WHERE account_id = $1 AND operation_key = $2 AND committed_by_user_id = $3`,
      [auth.accountId, operationKey, auth.userId],
    );
    const commitId = operation.rows[0]?.id;
    if (!commitId) throw new ApiError(409, "MEMORY_OPERATION_NOT_READY", "This operation has no committed result yet.");
    const query: ScopedOperationQuery = request;
    const result = await undoMemoryCommitInTransaction(client, auth, commitId, {
      idempotency_key: request.idempotency_key,
      expected_commit_revision: request.expected_commit_revision,
      reason: request.reason,
    }, async () => {
      const view = await readMemoryScopedOperationViewInTransaction(client, auth, operationKey, query);
      if (view.state !== "undone" && !view.undo.allowed) {
        throw new ApiError(409, "MEMORY_UNDO_SCOPE_MISMATCH", "Undo this operation from its original authorized review.");
      }
    });
    const current = await readMemoryScopedOperationViewInTransaction(client, auth, operationKey, query);
    if (!current.visible_receipt) throw new ApiError(409, "MEMORY_OPERATION_NOT_READY", "The scoped result is not available.");
    return { contract_version: CONTRACT_VERSION, replayed: result.replayed, receipt: current.visible_receipt };
  });
}
