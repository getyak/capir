import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  normalizeIdentityHandle,
  type IdentityHandleType,
  type MemoryCommitRequest,
  type MemoryCommitResponse,
  type MemoryDecision,
  type MemoryItemDecisionRequest,
  type MemoryItemDecisionResponse,
  type MemoryItemMutationRequest,
  type MemoryItemMutationResponse,
  type MemoryOperationReadback,
  type MemoryReceipt,
  type MemoryUndoRequest,
  type MemoryUndoResponse,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import { inTransaction, type DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import { sha256 } from "../lib/hash.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import type { AuthContext } from "./auth.js";
import {
  contactReclaimIsSafe,
  decisionWritesNewItem,
  editedTextIsUserAugmented,
  undoIsCompensable,
  validateMemorySelection,
} from "./memoryReviewPolicy.js";
import { assertReviewCredential, dismissMemoryReview, visibleReviewItems } from "./memoryReviewRead.js";
import { assertPursuitAssociationCurrent } from "./memoryPursuitScopes.js";

/** Same-transaction revalidation of a stored Pursuit association. */
export async function assertScopePursuitCurrent(
  client: DatabaseClient,
  auth: AuthContext,
  scope: {
    pursuit_id: string | null;
    pursuit_role_id: string | null;
    pursuit_role_evidence_fragment_id: string | null;
    pursuit_capture_version: number | null;
    pursuit_capture_id: string | null;
    person_id: string | null;
    relationship_context_id: string | null;
  },
  lock: boolean,
  acceptedHistory = false,
): Promise<void> {
  if (!scope.pursuit_id) return;
  if (
    !scope.pursuit_role_id
    || !scope.pursuit_role_evidence_fragment_id
    || !scope.person_id
  ) {
    throw new ApiError(
      409,
      "MEMORY_PURSUIT_ASSOCIATION_STALE",
      "The stored Pursuit association is incomplete; reopen the review from the Pursuit.",
    );
  }
  await assertPursuitAssociationCurrent(
    client,
    auth,
    {
      pursuitId: scope.pursuit_id,
      roleId: scope.pursuit_role_id,
      evidenceFragmentId: scope.pursuit_role_evidence_fragment_id,
      personId: scope.person_id,
      relationshipContextId: scope.relationship_context_id,
      captureVersion: scope.pursuit_capture_version,
      captureId: scope.pursuit_capture_id,
    },
    { lock, acceptedHistory },
  );
}
import { verifyPendingSourceAuthority } from "./memorySourceVerification.js";
import {
  MEMORY_EVIDENCE_AVAILABLE_SQL,
  contactExternalRef,
  enqueueProjectionJob,
  invalidateDerivedKnowledge,
  loadProposal,
  loadProposalItems,
  loadReviewScope,
  resolveIdentityBinding,
  resolveOwnerSubject,
  serializeReceipt,
  serializeRecallItem,
  type EvidenceRow,
  type IdentityBinding,
  type MemoryItemRow,
  type ProposalItemRow,
  type ReceiptRow,
} from "./memoryReviewStore.js";

async function loadEvidence(
  client: DatabaseClient,
  accountId: string,
  memoryItemId: string,
): Promise<EvidenceRow[]> {
  const result = await client.query<EvidenceRow>(
    `SELECT id, memory_item_id, capture_id, source_resource_id,
            evidence_fragment_id, source_session_id, source_message_id,
            source_artifact_id, locator, excerpt, status
     FROM memory_item_evidence
     WHERE account_id = $1 AND memory_item_id = $2 AND status = 'active'
     ORDER BY created_at, id`,
    [accountId, memoryItemId],
  );
  return result.rows;
}

async function createMemoryContact(
  client: PoolClient,
  auth: AuthContext,
  displayLabel: string,
  clue: { type: string; value: string } | null,
  relationshipContext: string | null,
  requiresContext: boolean,
): Promise<{ personId: string; contextId: string | null }> {
  if (clue) {
    const normalized = normalizeIdentityHandle(clue.type as IdentityHandleType, clue.value);
    if (normalized) {
      const existingHandle = await client.query<{ subject_id: string }>(
        `SELECT subject_id FROM identity_handles
         WHERE account_id = $1 AND handle_type = $2 AND normalized_value_hash = $3
           AND status = 'confirmed'
           AND (valid_until IS NULL OR valid_until > now())
         LIMIT 1`,
        [auth.accountId, clue.type, sha256(normalized)],
      );
      if (existingHandle.rows[0]) {
        throw new ApiError(
          409,
          "MEMORY_CONTACT_ALREADY_EXISTS",
          "A confirmed contact already owns this identity clue; review it instead of creating a duplicate.",
          { existing_person_id: existingHandle.rows[0].subject_id },
        );
      }
    }
  }
  const externalRef = contactExternalRef(displayLabel, clue);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO subjects(id, account_id, external_ref, display_label, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (account_id, external_ref) DO NOTHING
     RETURNING id`,
    [randomUUID(), auth.accountId, externalRef, displayLabel],
  );
  const personId = inserted.rows[0]?.id;
  if (!personId) {
    throw new ApiError(
      409,
      "MEMORY_CONTACT_ALREADY_EXISTS",
      "A concurrent commit created this contact; reload the current contact.",
    );
  }
  if (!relationshipContext) {
    if (requiresContext) {
      throw new ApiError(
        409,
        "MEMORY_RELATIONSHIP_CONTEXT_REQUIRED",
        "Relationship memory requires a relationship label for the new contact.",
      );
    }
    return { personId, contextId: null };
  }
  const assignmentId = randomUUID();
  await client.query(
    `INSERT INTO assignments(
       id, account_id, subject_id, external_ref, display_label, status
     )
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [
      assignmentId,
      auth.accountId,
      personId,
      `memory-contact-context:${sha256(`${personId}:${relationshipContext}`)}`,
      relationshipContext,
    ],
  );
  return { personId, contextId: assignmentId };
}

async function readReceipt(
  client: DatabaseClient,
  accountId: string,
  commitId: string,
): Promise<MemoryReceipt | null> {
  const result = await client.query<
    ReceiptRow & { proposal_id: string; proposal_revision: number }
  >(
    `SELECT receipts.*, commits.proposal_id, commits.proposal_revision
     FROM memory_receipts receipts
     JOIN memory_commits commits
       ON commits.account_id = receipts.account_id
      AND commits.id = receipts.commit_id
     WHERE receipts.account_id = $1 AND receipts.commit_id = $2`,
    [accountId, commitId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const limits: string[] = [];
  if (row.status === "undone") limits.push("This commit was already undone.");
  return serializeReceipt({
    receipt: row,
    proposalId: row.proposal_id,
    proposalRevision: row.proposal_revision,
    undoAllowed: row.status === "applied",
    undoLimits: limits,
  });
}

export interface MemoryCommitResult {
  body: MemoryCommitResponse;
  replayed: boolean;
  status: number;
}

export function skippedVisibleItemIds<T extends { id: string }>(
  visible: readonly T[],
  selectedItemIds: readonly string[],
  mode: "batch" | "item",
): string[] {
  if (mode === "item") return [];
  const selected = new Set(selectedItemIds);
  return visible.filter((item) => !selected.has(item.id)).map((item) => item.id);
}

/**
 * Atomic per-scope commit: auth + purpose credential -> frozen review ->
 * exact selection and explicit judgment -> contact dependency -> all-or-none
 * domain mutation + outbox -> immutable receipt. Contact creation happens only
 * here, for an authenticated human decision.
 */
export async function commitMemoryReview(
  pool: Pool,
  auth: AuthContext,
  reviewScopeId: string,
  credential: string | null,
  request: MemoryCommitRequest,
  mode: "batch" | "item" = "batch",
  itemExpectation?: { id: string; addedRevision: number },
): Promise<MemoryCommitResult> {
  return inTransaction(pool, async (client) => {
    const idempotency = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      mode === "item" ? "commit_memory_review_item" : "commit_memory_review",
      request.idempotency_key,
      { review_scope_id: reviewScopeId, ...request },
    );
    if (idempotency.replay) {
      const replayScope = await loadReviewScope(client, auth.accountId, reviewScopeId);
      if (!replayScope || replayScope.reader_user_id !== auth.userId) {
        throw new ApiError(404, "MEMORY_NOT_FOUND", "The requested Memory review was not found.");
      }
      await assertReviewCredential(client, replayScope, credential);
      // A replay must pass current authorization too: a withdrawn role,
      // evidence link, source or capture epoch denies the replay.
      await assertScopePursuitCurrent(client, auth, replayScope, true, true);
      // The operation belongs to the exact scope that committed it; replaying
      // the same key through another legitimate scope must not return the
      // original (possibly private) item ids.
      const committing = await client.query<{ review_scope_id: string }>(
        `SELECT review_scope_id FROM memory_commits
         WHERE account_id = $1 AND committed_by_user_id = $2
           AND operation_key = $3`,
        [auth.accountId, auth.userId, request.idempotency_key],
      );
      const committingScope = committing.rows[0]?.review_scope_id;
      if (committingScope && committingScope !== reviewScopeId) {
        throw new ApiError(
          409,
          "MEMORY_OPERATION_SCOPE_MISMATCH",
          "This operation key belongs to a different Memory review scope.",
        );
      }
      const replayBody = idempotency.replay.body as MemoryCommitResponse;
      const replayCommitId = replayBody?.receipt?.commit_id;
      if (
        replayCommitId
        && !(await receiptSourceAvailable(client, auth.accountId, replayCommitId))
      ) {
        throw new ApiError(
          409,
          "MEMORY_SOURCE_REVOKED",
          "The committed source was deleted; its receipt is history only.",
        );
      }
      return {
        body: replayBody,
        replayed: true,
        status: idempotency.replay.status,
      };
    }

    const scope = await loadReviewScope(client, auth.accountId, reviewScopeId, true);
    if (!scope || scope.reader_user_id !== auth.userId) {
      throw new ApiError(404, "MEMORY_NOT_FOUND", "The requested Memory review was not found.");
    }
    await assertReviewCredential(client, scope, credential);
    // Same transaction as the mutation: a role/evidence/source change during
    // review must invalidate this commit rather than widen its scope.
    await assertScopePursuitCurrent(client, auth, scope, true);
    if (scope.expires_at.valueOf() <= Date.now()) {
      throw new ApiError(410, "MEMORY_REVIEW_EXPIRED", "This Memory review expired; open it again.");
    }
    const proposal = await loadProposal(client, auth.accountId, scope.proposal_id, true);
    if (!proposal) {
      throw new ApiError(404, "MEMORY_NOT_FOUND", "The reviewed proposal was not found.");
    }
    if (proposal.status !== "open" && proposal.status !== "partially_committed") {
      throw new ApiError(409, "MEMORY_PROPOSAL_CLOSED", "This Memory proposal is no longer open.");
    }
    if (
      request.expected_proposal_revision !== scope.proposal_revision
      || proposal.revision !== scope.proposal_revision
    ) {
      throw new ApiError(
        409,
        "MEMORY_REVIEW_REBASE_REQUIRED",
        "The proposal changed after this review was frozen; re-read it before committing.",
        {
          frozen_proposal_revision: scope.proposal_revision,
          current_proposal_revision: proposal.revision,
        },
      );
    }
    if (
      request.person_id
      && request.person_id !== proposal.target_person_id
    ) {
      throw new ApiError(
        409,
        "MEMORY_REVIEW_SCOPE_MISMATCH",
        "Changing the contact needs a guarded rebase before committing.",
      );
    }

    const items = await loadProposalItems(client, auth.accountId, proposal.id, true);
    const visible = await visibleReviewItems(client, auth, scope, proposal, items);
    if (mode === "item" && itemExpectation) {
      const target = visible.find((item) => item.id === itemExpectation.id);
      if (!target || target.status !== "pending" || target.added_revision !== itemExpectation.addedRevision
        || request.selected_item_ids.length !== 1 || request.selected_item_ids[0] !== target.id) {
        throw new ApiError(409, "MEMORY_ITEM_STALE", "This Memory item changed; reopen the review.");
      }
    }
    const sourceVerification = await verifyPendingSourceAuthority(
      client,
      auth,
      proposal,
      items,
      { lock: true },
    );
    if (!sourceVerification.proposalSourceAvailable) {
      throw new ApiError(
        409,
        "MEMORY_SOURCE_UNAVAILABLE",
        "The original admitted source is no longer available; commit refused.",
      );
    }
    if (
      request.selected_item_ids.length === 0
      && request.contact_decision !== "new"
    ) {
      throw new ApiError(
        409,
        "MEMORY_EMPTY_COMMIT",
        "An empty Memory commit is only allowed as an explicit contact-only add.",
      );
    }
    const validation = validateMemorySelection({
      frozenRevision: scope.proposal_revision,
      surface: scope.purpose,
      contactDecision: request.contact_decision,
      contactStatus: proposal.contact_status,
      selectedItemIds: request.selected_item_ids,
      itemDecisions: request.item_decisions,
      items: visible,
    });
    if (!validation.ok) {
      throw new ApiError(409, validation.code, validation.message, {
        item_id: validation.itemId ?? null,
      });
    }
    const selected = validation.selected;
    const relationshipItems = selected.filter((item) => item.scope === "relationship");
    const nonSelfItems = selected.filter((item) => item.scope !== "self");

    const requestedAuthority =
      request.identity_authority ?? proposal.identity_authority;
    const binding: IdentityBinding = await resolveIdentityBinding(
      client,
      auth.accountId,
      {
        contactDecision: request.contact_decision,
        personId: proposal.target_person_id,
        contextId: proposal.target_relationship_context_id,
        identityAuthority: requestedAuthority,
        identityClue: request.new_contact?.identity_clue ?? null,
        newContactLabel:
          request.new_contact?.display_label?.trim()
          ?? proposal.person_display_label,
      },
    );
    if (
      request.contact_decision === "existing"
      && nonSelfItems.length > 0
      && binding.status !== "resolved"
    ) {
      throw new ApiError(
        409,
        "MEMORY_IDENTITY_NOT_AUTHORIZED",
        "Only a current stable handle or an explicit human selection may bind an existing contact.",
      );
    }
    let personId = binding.personId;
    let contextId = binding.contextId;
    let createdPerson = false;
    if (request.contact_decision === "new") {
      if (proposal.target_person_id) {
        throw new ApiError(
          409,
          "MEMORY_CONTACT_TARGET_RESOLVED",
          "A contact already resolved for this proposal; save against it explicitly.",
        );
      }
      if (binding.status === "ambiguous") {
        throw new ApiError(
          409,
          "MEMORY_IDENTITY_AMBIGUOUS",
          "Resolve the ambiguous contact before creating one.",
        );
      }
      const label =
        request.new_contact?.display_label?.trim() || proposal.person_display_label;
      if (!label) {
        throw new ApiError(
          409,
          "MEMORY_CONTACT_DETAILS_REQUIRED",
          "Creating a contact requires the staged, source-grounded display name.",
        );
      }
      const created = await createMemoryContact(
        client,
        auth,
        label,
        request.new_contact?.identity_clue ?? null,
        request.new_contact?.relationship_context?.trim()
          || proposal.relationship_display_label,
        relationshipItems.length > 0,
      );
      personId = created.personId;
      contextId = created.contextId;
      createdPerson = true;
    } else if (nonSelfItems.length > 0 || request.contact_decision === "existing") {
      if (!personId) {
        throw new ApiError(
          409,
          "MEMORY_CONTACT_REQUIRED",
          "A resolved contact is required for person and relationship memory.",
        );
      }
      const subject = await client.query<{ id: string }>(
        `SELECT id FROM subjects
         WHERE account_id = $1 AND id = $2 AND status = 'active'
         FOR UPDATE`,
        [auth.accountId, personId],
      );
      if (!subject.rows[0]) {
        throw new ApiError(409, "MEMORY_CONTACT_NOT_FOUND", "The resolved contact is no longer active.");
      }
      if (relationshipItems.length > 0) {
        if (!contextId) {
          throw new ApiError(
            409,
            "MEMORY_RELATIONSHIP_CONTEXT_REQUIRED",
            "Relationship memory requires an exact relationship context.",
          );
        }
        const assignment = await client.query<{ id: string }>(
          `SELECT id FROM assignments
           WHERE account_id = $1 AND id = $2 AND subject_id = $3 AND status = 'active'
           FOR UPDATE`,
          [auth.accountId, contextId, personId],
        );
        if (!assignment.rows[0]) {
          throw new ApiError(
            409,
            "MEMORY_RELATIONSHIP_CONTEXT_NOT_FOUND",
            "The relationship context is no longer active for this contact.",
          );
        }
      }
    }

    // Per-item source revalidation before any accepted write.
    for (const item of selected) {
      if (!item.source_session_id && !item.capture_id && !item.source_artifact_id) {
        throw new ApiError(
          409,
          "MEMORY_SOURCE_UNBOUND",
          "Every accepted memory needs an admitted source.",
        );
      }
      if (sourceVerification.unavailableItemIds.has(item.id)) {
        throw new ApiError(
          409,
          "MEMORY_SOURCE_UNAVAILABLE",
          "A selected memory's original source is no longer available.",
          { item_id: item.id },
        );
      }
    }

    const previousById = new Map<string, MemoryItemRow>();
    for (const item of selected) {
      const decision = request.item_decisions[item.id] ?? "accept";
      if (!decisionWritesNewItem(decision)) continue;
      const effectiveOperation =
        decision === "accept_new" ? "update"
        : decision === "retain_conflict" ? "contest"
        : item.operation;
      if (effectiveOperation === "add" && !item.previous_memory_item_id) continue;
      if (!item.previous_memory_item_id) {
        throw new ApiError(
          409,
          "MEMORY_ITEM_REVISION_CONFLICT",
          "An update or conflict item has no resolvable previous version.",
          { item_id: item.id },
        );
      }
      const existing = await client.query<MemoryItemRow>(
        `SELECT * FROM memory_items
         WHERE account_id = $1 AND id = $2
         FOR UPDATE`,
        [auth.accountId, item.previous_memory_item_id],
      );
      const row = existing.rows[0];
      const expected =
        request.expected_item_versions[item.id] ?? item.previous_revision ?? null;
      if (!row || row.status !== "active" || expected === null || row.version !== expected) {
        throw new ApiError(
          409,
          "MEMORY_ITEM_REVISION_CONFLICT",
          "A concurrent change replaced this memory after the review froze.",
          {
            item_id: item.id,
            previous_memory_item_id: item.previous_memory_item_id,
            expected_version: expected,
            current_version: row?.version ?? null,
          },
        );
      }
      if (
        row.scope !== item.scope
        || row.subject_id !== item.subject_id
        || row.relationship_context_id !== item.relationship_context_id
      ) {
        throw new ApiError(
          409,
          "MEMORY_ITEM_SCOPE_CHANGED",
          "The previous memory no longer belongs to this scope.",
          { item_id: item.id },
        );
      }
      if (
        (item.scope === "self" || item.scope === "relationship")
        && row.owner_user_id !== auth.userId
      ) {
        throw new ApiError(
          409,
          "MEMORY_ITEM_SCOPE_CHANGED",
          "Another user's private memory cannot be modified here.",
          { item_id: item.id },
        );
      }
      previousById.set(item.id, row);
    }

    const ownerSubjectId =
      selected.some((item) => item.scope === "self")
        ? await resolveOwnerSubject(client, auth.accountId, auth.userId)
        : null;

    const createdItemIds: string[] = [];
    const updatedItemIds: string[] = [];
    const skippedItemIds: string[] = [];
    const changes: Array<Record<string, unknown>> = [];
    const now = new Date();

    for (const item of selected) {
      const decision = request.item_decisions[item.id] ?? "accept";
      if (!decisionWritesNewItem(decision)) {
        await client.query(
          `UPDATE memory_proposal_items SET status = 'skipped'
           WHERE account_id = $1 AND id = $2`,
          [auth.accountId, item.id],
        );
        skippedItemIds.push(item.id);
        changes.push({
          proposal_item_id: item.id,
          decision,
          memory_item_id: null,
        });
        continue;
      }
      const effectiveOperation =
        decision === "accept_new" ? "update"
        : decision === "retain_conflict" ? "contest"
        : item.operation;
      const edited = request.edited_text[item.id]?.trim();
      const displayText = edited && edited.length > 0
        ? edited.slice(0, 1_000)
        : item.display_text;
      // The contact-reference invariant runs on edited text too: an
      // independent self item must not become contact-dependent by editing.
      if (item.scope === "self" && item.subject_kind === "owner_self") {
        const references = [
          proposal.person_display_label,
          request.new_contact?.display_label,
          request.new_contact?.identity_clue?.value,
        ].filter(
          (value): value is string => Boolean(value && value.trim().length >= 2),
        );
        const normalizedText = displayText.normalize("NFKC");
        if (
          references.some((reference) =>
            normalizedText.includes(reference.normalize("NFKC").trim()),
          )
        ) {
          throw new ApiError(
            409,
            "MEMORY_SELF_SCOPE_ESCAPE",
            "This self sentence names the current contact and must be bound or reclassified.",
            { item_id: item.id },
          );
        }
      }
      const itemEdited = editedTextIsUserAugmented(
        item.original_display_text,
        edited ?? null,
      );
      const previous = previousById.get(item.id) ?? null;
      const memoryItemId = randomUUID();
      const conflictGroupId =
        effectiveOperation === "contest"
          ? previous?.conflict_group_id ?? randomUUID()
          : null;
      const version = previous ? previous.version + 1 : 1;
      const subjectId = item.scope === "self" ? ownerSubjectId : personId;
      await client.query(
        `INSERT INTO memory_items(
           id, account_id, owner_user_id, scope, subject_id, relationship_context_id,
           display_text, original_display_text, statement_kind, speaker, reporter,
           valid_time, observed_time, time_status, sensitivity, version, status,
           supersedes_id, conflict_group_id, source_proposal_id,
           source_proposal_item_id, created_by_user_id
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'active',
                 $17,$18,$19,$20,$21)`,
        [
          memoryItemId,
          auth.accountId,
          auth.userId,
          item.scope,
          subjectId,
          item.scope === "relationship" ? contextId : null,
          displayText,
          item.original_display_text,
          item.statement_kind,
          item.speaker,
          item.reporter,
          item.valid_time,
          item.observed_time,
          item.time_status,
          item.sensitivity,
          version,
          previous?.id ?? null,
          conflictGroupId,
          proposal.id,
          item.id,
          auth.userId,
        ],
      );
      if (previous && effectiveOperation === "update") {
        await client.query(
          `UPDATE memory_items
           SET status = 'superseded', superseded_by_id = $3, updated_at = now()
           WHERE account_id = $1 AND id = $2`,
          [auth.accountId, previous.id, memoryItemId],
        );
        updatedItemIds.push(previous.id);
      }
      if (previous && effectiveOperation === "contest") {
        await client.query(
          `UPDATE memory_items
           SET conflict_group_id = COALESCE(conflict_group_id, $3), updated_at = now()
           WHERE account_id = $1 AND id = $2`,
          [auth.accountId, previous.id, conflictGroupId],
        );
      }
      await client.query(
        `INSERT INTO memory_item_evidence(
           id, account_id, memory_item_id, capture_id, source_resource_id,
           evidence_fragment_id, source_session_id, source_message_id,
           source_task_id, source_artifact_id, locator, excerpt, content_hash,
           source_capture_version, status
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,'active')`,
        [
          randomUUID(),
          auth.accountId,
          memoryItemId,
          item.capture_id,
          item.source_resource_id,
          item.evidence_fragment_id,
          item.source_session_id ?? proposal.session_id,
          item.source_message_id ?? proposal.source_message_id,
          proposal.source_task_id,
          item.source_artifact_id,
          JSON.stringify(item.locator),
          item.source_excerpt,
          sha256(item.source_excerpt),
          item.source_capture_version,
        ],
      );
      await client.query(
        `UPDATE memory_proposal_items
         SET status = 'committed', committed_memory_item_id = $3
         WHERE account_id = $1 AND id = $2`,
        [auth.accountId, item.id, memoryItemId],
      );
      createdItemIds.push(memoryItemId);
      changes.push({
        proposal_item_id: item.id,
        decision,
        operation: effectiveOperation,
        scope: item.scope,
        memory_item_id: memoryItemId,
        version,
        edited_by_user: itemEdited,
        previous_memory_item_id: previous?.id ?? null,
      });
    }

    // A skipped contact only saves self memory; person/relationship items stay
    // pending so restoring the same identity recovers the prior selection.
    const contactSkipped = request.contact_decision === "none";
    if (!contactSkipped) {
      for (const itemId of skippedVisibleItemIds(visible, request.selected_item_ids, mode)) {
        await client.query(
          `UPDATE memory_proposal_items SET status = 'skipped'
           WHERE account_id = $1 AND id = $2`,
          [auth.accountId, itemId],
        );
        skippedItemIds.push(itemId);
      }
    }

    const remaining = await client.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count FROM memory_proposal_items
       WHERE account_id = $1 AND proposal_id = $2 AND status = 'pending'`,
      [auth.accountId, proposal.id],
    );
    const remainingCount = remaining.rows[0]?.count ?? 0;
    const nextStatus = remainingCount === 0
      ? "committed"
      : contactSkipped
        ? "open"
        : "partially_committed";
    if (contactSkipped) {
      await client.query(
        `UPDATE memory_proposals SET updated_at = now()
         WHERE account_id = $1 AND id = $2`,
        [auth.accountId, proposal.id],
      );
    } else {
      await client.query(
        `UPDATE memory_proposals
         SET revision = revision + 1, status = $3, updated_at = now()
         WHERE account_id = $1 AND id = $2`,
        [auth.accountId, proposal.id, nextStatus],
      );
    }

    const commitId = randomUUID();
    await client.query(
      `INSERT INTO memory_commits(
         id, account_id, proposal_id, proposal_revision, review_scope_id,
         committed_by_user_id, operation_key, contact_decision, created_person_id,
         created_relationship_context_id, status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'applied')`,
      [
        commitId,
        auth.accountId,
        proposal.id,
        scope.proposal_revision,
        scope.id,
        auth.userId,
        request.idempotency_key,
        request.contact_decision,
        createdPerson ? personId : null,
        request.contact_decision === "new" ? contextId : null,
      ],
    );
    for (const change of changes) {
      if (!change.memory_item_id) continue;
      await client.query(
        `INSERT INTO memory_commit_items(
           id, account_id, commit_id, proposal_item_id, operation, scope,
           memory_item_id, memory_item_version, previous_memory_item_id,
           previous_version, edited_by_user, decision
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          randomUUID(),
          auth.accountId,
          commitId,
          change.proposal_item_id,
          change.operation ?? "add",
          change.scope,
          change.memory_item_id,
          change.version ?? 1,
          change.previous_memory_item_id ?? null,
          previousById.get(change.proposal_item_id as string)?.version ?? null,
          change.edited_by_user ?? false,
          change.decision,
        ],
      );
    }
    const undoToken = randomUUID();
    await client.query(
      `INSERT INTO memory_receipts(
         id, account_id, commit_id, operation_key, status, contact_decision,
         created_person_id, person_display_label, created_relationship_context_id,
         item_count, created_item_ids, updated_item_ids, skipped_item_ids,
         changes, undo_token, projection_status
       )
       VALUES ($1,$2,$3,$4,'applied',$5,$6,$7,$8,$9,$10::uuid[],$11::uuid[],
               $12::uuid[],$13::jsonb,$14,'pending')`,
      [
        randomUUID(),
        auth.accountId,
        commitId,
        request.idempotency_key,
        request.contact_decision,
        createdPerson ? personId : null,
        proposal.person_display_label,
        request.contact_decision === "new" ? contextId : null,
        createdItemIds.length,
        createdItemIds,
        updatedItemIds,
        skippedItemIds,
        JSON.stringify(changes),
        undoToken,
      ],
    );

    const affectedScope = { subjectId: personId, relationshipContextId: contextId };
    if (!contactSkipped) {
      await invalidateDerivedKnowledge(client, auth.accountId, affectedScope);
      await enqueueProjectionJob(client, auth.accountId, affectedScope, "memory_committed");
    }
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "memory.committed",
      "memory_commit",
      commitId,
      {
        proposal_id: proposal.id,
        proposal_revision: scope.proposal_revision,
        review_scope_id: scope.id,
        contact_decision: request.contact_decision,
        created_person_id: createdPerson ? personId : null,
        item_count: createdItemIds.length,
        skipped_item_ids: skippedItemIds,
        remaining_pending_count: remainingCount,
      },
    );

    const receipt = await readReceipt(client, auth.accountId, commitId);
    if (!receipt) {
      throw new ApiError(500, "MEMORY_COMMIT_FAILED", "The commit receipt could not be read back.");
    }
    const body: MemoryCommitResponse = {
      contract_version: CONTRACT_VERSION,
      replayed: false,
      receipt,
    };
    await completeIdempotency(client, idempotency, 201, body);
    return { body, replayed: false, status: 201 };
  });
}

export async function receiptSourceAvailable(
  client: DatabaseClient,
  accountId: string,
  commitId: string,
): Promise<boolean> {
  const result = await client.query<{ unavailable: number }>(
    `SELECT COUNT(*)::integer AS unavailable
     FROM memory_commit_items items
     JOIN memory_items memory
       ON memory.account_id = items.account_id AND memory.id = items.memory_item_id
     WHERE items.account_id = $1 AND items.commit_id = $2
       AND (
         memory.status IN ('deleted', 'invalidated')
         OR EXISTS (
           SELECT 1 FROM memory_item_evidence e
           WHERE e.account_id = items.account_id
             AND e.memory_item_id = items.memory_item_id
             AND NOT ${MEMORY_EVIDENCE_AVAILABLE_SQL}
         )
       )`,
    [accountId, commitId],
  );
  const total = await client.query<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM memory_commit_items
     WHERE account_id = $1 AND commit_id = $2 AND memory_item_id IS NOT NULL`,
    [accountId, commitId],
  );
  // A contact-only or keep_old commit has no memory rows and is still valid.
  return (total.rows[0]?.count ?? 0) === 0
    || (result.rows[0]?.unavailable ?? 0) === 0;
}

async function itemDecisionSnapshot(
  pool: Pool,
  auth: AuthContext,
  reviewScopeId: string,
): Promise<{ proposalRevision: number; remainingCount: number }> {
  const current = await pool.query<{ proposal_revision: number; remaining_count: number }>(
    `SELECT proposal.revision AS proposal_revision,
            COUNT(item.id) FILTER (WHERE item.status = 'pending')::integer AS remaining_count
     FROM memory_review_scopes scope
     JOIN memory_proposals proposal
       ON proposal.account_id = scope.account_id AND proposal.id = scope.proposal_id
     LEFT JOIN memory_proposal_items item
       ON item.account_id = proposal.account_id AND item.proposal_id = proposal.id
     WHERE scope.account_id = $1 AND scope.id = $2 AND scope.reader_user_id = $3
     GROUP BY proposal.revision`,
    [auth.accountId, reviewScopeId, auth.userId],
  );
  const row = current.rows[0];
  if (!row) throw new ApiError(404, "MEMORY_NOT_FOUND", "The Memory review was not found.");
  return { proposalRevision: row.proposal_revision, remainingCount: row.remaining_count };
}

/** One protected card decision; the existing batch route keeps its semantics. */
export async function decideMemoryReviewItem(
  pool: Pool,
  auth: AuthContext,
  reviewScopeId: string,
  credential: string | null,
  request: MemoryItemDecisionRequest,
): Promise<MemoryItemDecisionResponse> {
  const expectation = {
    proposalRevision: request.expected_proposal_revision,
    itemId: request.item_id,
    addedRevision: request.expected_item_added_revision,
  };
  if (request.decision === "skip") {
    const dismissed = await dismissMemoryReview(pool, auth, reviewScopeId, credential, {
      idempotency_key: request.idempotency_key,
      expected_review_revision: request.expected_review_revision,
      item_ids: [request.item_id],
      reason: request.reason,
    }, expectation);
    const current = await itemDecisionSnapshot(pool, auth, reviewScopeId);
    return {
      contract_version: CONTRACT_VERSION,
      kind: "skipped",
      item_id: request.item_id,
      replayed: dismissed.replayed,
      receipt: null,
      proposal_revision: current.proposalRevision,
      remaining_pending_item_count: current.remainingCount,
    };
  }
  const body: MemoryCommitRequest = {
    idempotency_key: request.idempotency_key,
    expected_proposal_revision: request.expected_proposal_revision,
    contact_decision: request.contact_decision,
    ...(request.contact_decision === "existing" ? { identity_authority: "human_selection" as const } : {}),
    selected_item_ids: [request.item_id],
    edited_text: request.edited_text ? { [request.item_id]: request.edited_text } : {},
    item_decisions: { [request.item_id]: request.decision },
    expected_item_versions: request.expected_item_version
      ? { [request.item_id]: request.expected_item_version }
      : {},
    new_contact: null,
    reason: request.reason,
  };
  const committed = await commitMemoryReview(
    pool, auth, reviewScopeId, credential, body, "item",
    { id: request.item_id, addedRevision: request.expected_item_added_revision },
  );
  const current = await itemDecisionSnapshot(pool, auth, reviewScopeId);
  const memoryItemId = committed.body.receipt.decisions.find((entry) => entry.proposal_item_id === request.item_id)?.memory_item_id;
  const applied = memoryItemId ? await pool.query<{ display_text: string }>(
    `SELECT display_text FROM memory_items WHERE account_id = $1 AND owner_user_id = $2 AND id = $3`,
    [auth.accountId, auth.userId, memoryItemId],
  ) : null;
  return {
    contract_version: CONTRACT_VERSION,
    kind: "committed",
    applied_display_text: applied?.rows[0]?.display_text ?? null,
    item_id: request.item_id,
    replayed: committed.replayed,
    receipt: committed.body.receipt,
    proposal_revision: current.proposalRevision,
    remaining_pending_item_count: current.remainingCount,
  };
}

export async function readMemoryOperation(
  pool: Pool,
  auth: AuthContext,
  operationKey: string,
): Promise<MemoryOperationReadback> {
  return inTransaction(pool, async (client) => {
  const receipt = await client.query<
    ReceiptRow & { proposal_id: string; proposal_revision: number }
  >(
    `SELECT receipts.*, commits.proposal_id, commits.proposal_revision
     FROM memory_receipts receipts
     JOIN memory_commits commits
       ON commits.account_id = receipts.account_id
      AND commits.id = receipts.commit_id
     WHERE receipts.account_id = $1
       AND receipts.operation_key = $2
       AND commits.committed_by_user_id = $3`,
    [auth.accountId, operationKey, auth.userId],
  );
  const row = receipt.rows[0];
  if (row) {
    const commit = await client.query<{ review_scope_id: string }>(`SELECT review_scope_id FROM memory_commits WHERE account_id = $1 AND id = $2 FOR SHARE`, [auth.accountId, row.commit_id]);
    const scope = commit.rows[0] && await loadReviewScope(client, auth.accountId, commit.rows[0].review_scope_id, true);
    if (!scope) throw new ApiError(404, "MEMORY_NOT_FOUND", "The operation scope was not found.");
    await assertScopePursuitCurrent(client, auth, scope, true, true);
    const available = await receiptSourceAvailable(client, auth.accountId, row.commit_id);
    if (!available && row.status === "applied") {
      return {
        contract_version: CONTRACT_VERSION,
        operation_key: operationKey,
        state: "source_revoked",
        receipt: null,
      };
    }
    return {
      contract_version: CONTRACT_VERSION,
      operation_key: operationKey,
      state: row.status === "undone" ? "undone" : "applied",
      receipt: serializeReceipt({
        receipt: row,
        proposalId: row.proposal_id,
        proposalRevision: row.proposal_revision,
        undoAllowed: row.status === "applied",
        undoLimits: [],
      }),
    };
  }
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
    receipt: null,
  };
  });
}

export async function undoMemoryCommit(
  pool: Pool,
  auth: AuthContext,
  commitId: string,
  request: MemoryUndoRequest,
): Promise<MemoryUndoResponse & { replayed: boolean }> {
  return inTransaction(pool, (client) => undoMemoryCommitInTransaction(client, auth, commitId, request));
}

export async function undoMemoryCommitInTransaction(
  client: PoolClient,
  auth: AuthContext,
  commitId: string,
  request: MemoryUndoRequest,
  authorize?: () => Promise<void>,
): Promise<MemoryUndoResponse & { replayed: boolean }> {
    const idempotency = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "undo_memory_commit",
      request.idempotency_key,
      { commit_id: commitId, ...request },
    );
    const commit = await client.query<{
      id: string;
      proposal_id: string;
      proposal_revision: number;
      review_scope_id: string;
      committed_by_user_id: string;
      status: "applied" | "undone";
      revision: number;
      created_person_id: string | null;
      created_relationship_context_id: string | null;
    }>(
      `SELECT id, proposal_id, proposal_revision, review_scope_id,
              committed_by_user_id, status,
              revision, created_person_id, created_relationship_context_id
       FROM memory_commits
       WHERE account_id = $1 AND id = $2
       FOR UPDATE`,
      [auth.accountId, commitId],
    );
    const row = commit.rows[0];
    if (!row || row.committed_by_user_id !== auth.userId) {
      throw new ApiError(404, "MEMORY_NOT_FOUND", "The requested Memory commit was not found.");
    }
    const currentScope = await loadReviewScope(client, auth.accountId, row.review_scope_id, true);
    if (!currentScope) throw new ApiError(404, "MEMORY_NOT_FOUND", "The operation scope was not found.");
    await assertScopePursuitCurrent(client, auth, currentScope, true, true);
    if (row.status === "applied" && !await receiptSourceAvailable(client, auth.accountId, commitId)) {
      throw new ApiError(409, "MEMORY_SOURCE_REVOKED", "The source was revoked; this operation cannot be replayed.");
    }
    await authorize?.();
    if (idempotency.replay) {
      const receipt = await readReceipt(client, auth.accountId, commitId);
      if (!receipt) throw new ApiError(404, "MEMORY_NOT_FOUND", "The receipt was not found.");
      return { contract_version: CONTRACT_VERSION, receipt, replayed: true };
    }
    if (row.status === "undone") {
      // The narrow historical-own-compensation exception still revalidates a
      // Pursuit association: a revoked role/evidence/source denies even an
      // already-undone receipt.
      const undoneScope = await loadReviewScope(client, auth.accountId, row.review_scope_id, true);
      if (undoneScope) await assertScopePursuitCurrent(client, auth, undoneScope, true, true);
      const receipt = await readReceipt(client, auth.accountId, commitId);
      if (!receipt) {
        throw new ApiError(404, "MEMORY_NOT_FOUND", "The commit receipt was not found.");
      }
      const body: MemoryUndoResponse = { contract_version: CONTRACT_VERSION, replayed: true, receipt };
      await completeIdempotency(client, idempotency, 200, body);
      return body;
    }
    if (row.revision !== request.expected_commit_revision) {
      throw new ApiError(409, "MEMORY_COMMIT_STALE", "The commit changed before this undo.", {
        current_commit_revision: row.revision,
      });
    }
    // A Pursuit-derived compensation must revalidate the same current
    // association in the same transaction as the mutation.
    const undoingScope = await loadReviewScope(client, auth.accountId, row.review_scope_id, true);
    if (undoingScope) await assertScopePursuitCurrent(client, auth, undoingScope, true, true);
    const items = await client.query<{
      id: string;
      proposal_item_id: string;
      operation: "add" | "update" | "contest";
      memory_item_id: string;
      memory_item_version: number;
      previous_memory_item_id: string | null;
      previous_version: number | null;
      decision: MemoryDecision;
    }>(
      `SELECT id, proposal_item_id, operation, memory_item_id, memory_item_version,
              previous_memory_item_id, previous_version, decision
       FROM memory_commit_items
       WHERE account_id = $1 AND commit_id = $2
       ORDER BY created_at, id`,
      [auth.accountId, commitId],
    );
    const limits: string[] = [];
    for (const item of items.rows) {
      if (item.decision === "keep_old" || item.decision === "skip") continue;
      const current = await client.query<MemoryItemRow>(
        `SELECT * FROM memory_items WHERE account_id = $1 AND id = $2 FOR UPDATE`,
        [auth.accountId, item.memory_item_id],
      );
      const memory = current.rows[0];
      if (!memory) {
        throw new ApiError(
          409,
          "MEMORY_UNDO_BLOCKED",
          "A committed memory is missing and cannot be reversed safely.",
        );
      }
      const compensable = undoIsCompensable({
        itemStatus: memory.status,
        itemVersion: memory.version,
        latestVersion: item.memory_item_version,
        laterCommitTouchesItem: memory.version > item.memory_item_version
          || memory.status === "superseded",
      });
      if (!compensable.safe) {
        throw new ApiError(
          409,
          "MEMORY_UNDO_BLOCKED",
          compensable.reason ?? "The memory changed after this commit.",
          { memory_item_id: item.memory_item_id },
        );
      }
    }
    for (const item of items.rows) {
      if (item.decision === "keep_old" || item.decision === "skip") continue;
      await client.query(
        `UPDATE memory_items
         SET status = 'deleted', deleted_at = now(), updated_at = now()
         WHERE account_id = $1 AND id = $2`,
        [auth.accountId, item.memory_item_id],
      );
      await client.query(
        `UPDATE memory_item_evidence
         SET status = 'revoked', revoked_at = now(),
             revocation_reason = 'commit_undone'
         WHERE account_id = $1 AND memory_item_id = $2`,
        [auth.accountId, item.memory_item_id],
      );
      if (item.operation === "update" && item.previous_memory_item_id) {
        // Never revive a previous version whose source is no longer authorized.
        const unavailable = await client.query<{ count: number }>(
          `SELECT COUNT(*)::integer AS count FROM memory_item_evidence e
           WHERE e.account_id = $1 AND e.memory_item_id = $2
             AND NOT ${MEMORY_EVIDENCE_AVAILABLE_SQL}`,
          [auth.accountId, item.previous_memory_item_id],
        );
        if ((unavailable.rows[0]?.count ?? 0) > 0) {
          await client.query(
            `UPDATE memory_items
             SET status = 'invalidated', invalidated_at = now(),
                 invalidated_reason = 'source_unavailable_at_undo', updated_at = now()
             WHERE account_id = $1 AND id = $2`,
            [auth.accountId, item.previous_memory_item_id],
          );
          limits.push("A restored earlier version stayed invalidated because its source is no longer authorized.");
        } else {
          await client.query(
            `UPDATE memory_items
             SET status = 'active', superseded_by_id = NULL, updated_at = now()
             WHERE account_id = $1 AND id = $2 AND status = 'superseded'`,
            [auth.accountId, item.previous_memory_item_id],
          );
        }
      }
      if (item.operation === "contest" && item.previous_memory_item_id) {
        await client.query(
          `UPDATE memory_items
           SET conflict_group_id = NULL, updated_at = now()
           WHERE account_id = $1 AND id = $2
             AND EXISTS (
               SELECT 1 FROM memory_items undone
               WHERE undone.account_id = $1 AND undone.id = $3
                 AND undone.conflict_group_id IS NOT NULL
             )
             AND NOT EXISTS (
               SELECT 1 FROM memory_items other
               JOIN memory_items undone2
                 ON undone2.account_id = $1 AND undone2.id = $3
               WHERE other.account_id = $1
                 AND other.id <> $2
                 AND other.status = 'active'
                 AND other.conflict_group_id = undone2.conflict_group_id
             )`,
          [auth.accountId, item.previous_memory_item_id, item.memory_item_id],
        );
      }
    }
    let contactOutcome: "retained" | "reclaimed" | null = null;
    let contextOutcome: "retained" | "reclaimed" | null = null;
    if (row.created_person_id) {
      // Coordinate with foreign-key writers before checking later dependencies.
      await client.query(`SELECT id FROM subjects WHERE account_id = $1 AND id = $2 FOR UPDATE`, [auth.accountId, row.created_person_id]);
      if (row.created_relationship_context_id) await client.query(`SELECT id FROM assignments WHERE account_id = $1 AND id = $2 FOR UPDATE`, [auth.accountId, row.created_relationship_context_id]);
      const dependence = await client.query<{
        memories: number;
        assignments: number;
        captures: number;
        handles: number;
        profiles: number;
        manifests: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::integer FROM memory_items
             WHERE account_id = $1 AND subject_id = $2 AND status = 'active') AS memories,
           (SELECT COUNT(*)::integer FROM assignments
             WHERE account_id = $1 AND subject_id = $2 AND status = 'active') AS assignments,
           (SELECT COUNT(*)::integer FROM captures
             WHERE account_id = $1 AND subject_id = $2 AND status = 'active') AS captures,
           (SELECT COUNT(*)::integer FROM identity_handles
             WHERE account_id = $1 AND subject_id = $2 AND status IN ('proposed', 'confirmed')) AS handles,
           (SELECT COUNT(*)::integer FROM person_profiles
             WHERE account_id = $1 AND subject_id = $2) AS profiles,
           (SELECT COUNT(*)::integer FROM context_manifests
             WHERE account_id = $1 AND subject_id = $2 AND status = 'active') AS manifests`,
        [auth.accountId, row.created_person_id],
      );
      const counts = dependence.rows[0] ?? {
        memories: 0,
        assignments: 0,
        captures: 0,
        handles: 0,
        profiles: 0,
        manifests: 0,
      };
      const safe = contactReclaimIsSafe({
        laterMemoryItemCount: counts.memories,
        // The commit's own relationship context is not a later dependence.
        laterAssignmentCount: Math.max(
          0,
          counts.assignments - (row.created_relationship_context_id ? 1 : 0),
        ),
        laterSourceCount: counts.captures,
        laterHandleCount: counts.handles,
        laterProfileCount: counts.profiles,
        laterManifestCount: counts.manifests,
      });
      contactOutcome = safe ? "reclaimed" : "retained";
      contextOutcome = row.created_relationship_context_id ? contactOutcome : null;
      if (safe) {
        await client.query(
          `UPDATE assignments SET status = 'deleted', deleted_at = now()
           WHERE account_id = $1 AND subject_id = $2 AND status = 'active'`,
          [auth.accountId, row.created_person_id],
        );
        await client.query(
          `UPDATE subjects SET status = 'deleted', deleted_at = now()
           WHERE account_id = $1 AND id = $2 AND status = 'active'`,
          [auth.accountId, row.created_person_id],
        );
      } else {
        limits.push(
          "The contact now has later sources, memory, handles, profiles, contexts, or manifests and was retained.",
        );
      }
    }
    await client.query(
      `UPDATE memory_commits
       SET status = 'undone', undone_at = now(), revision = revision + 1
       WHERE account_id = $1 AND id = $2`,
      [auth.accountId, commitId],
    );
    await client.query(
      `UPDATE memory_receipts
       SET status = 'undone', undone_at = now(), undo_contact_outcome = $3, undo_context_outcome = $4
       WHERE account_id = $1 AND commit_id = $2`,
      [auth.accountId, commitId, contactOutcome, contextOutcome],
    );
    const scope = {
      subjectId: row.created_person_id,
      relationshipContextId: row.created_relationship_context_id,
    };
    await invalidateDerivedKnowledge(client, auth.accountId, scope);
    await enqueueProjectionJob(client, auth.accountId, scope, "memory_undone");
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "memory.commit_undone",
      "memory_commit",
      commitId,
      { reason: request.reason, item_count: items.rows.length, limits },
    );
    const receipt = await readReceipt(client, auth.accountId, commitId);
    if (!receipt) {
      throw new ApiError(500, "MEMORY_UNDO_FAILED", "The undo receipt could not be read back.");
    }
    const body: MemoryUndoResponse = { contract_version: CONTRACT_VERSION, replayed: false, receipt };
    await completeIdempotency(client, idempotency, 200, body);
    return { ...body, replayed: false };
}

export async function readMemoryItem(
  client: DatabaseClient,
  auth: AuthContext,
  itemId: string,
): Promise<import("@talent-signal/contracts").MemoryRecallItem | null> {
  const result = await client.query<MemoryItemRow>(
    `SELECT * FROM memory_items
     WHERE account_id = $1 AND id = $2 AND status <> 'deleted'`,
    [auth.accountId, itemId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const evidence = await loadEvidence(client, auth.accountId, itemId);
  return serializeRecallItem(row, evidence, evidence.length > 0);
}

/** Versioned correction or deletion of an accepted Memory. */
export async function mutateMemoryItem(
  pool: Pool,
  auth: AuthContext,
  itemId: string,
  request: MemoryItemMutationRequest,
): Promise<MemoryItemMutationResponse & { replayed: boolean }> {
  return inTransaction(pool, async (client) => {
    const idempotency = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      `mutate_memory_item:${itemId}`,
      request.idempotency_key,
      request,
    );
    const existing = await client.query<MemoryItemRow>(
      `SELECT * FROM memory_items
       WHERE account_id = $1 AND id = $2
       FOR UPDATE`,
      [auth.accountId, itemId],
    );
    const row = existing.rows[0];
    if (!row || row.owner_user_id !== auth.userId) {
      throw new ApiError(404, "MEMORY_NOT_FOUND", "The requested Memory item was not found.");
    }
    const entry = request.entry_scope;
    if (entry && entry.purpose !== "chat") {
      if (row.scope === "self" || !entry.person_id || row.subject_id !== entry.person_id ||
          (entry.purpose === "relationship" && (!entry.relationship_context_id || row.relationship_context_id !== entry.relationship_context_id))) {
        throw new ApiError(403, "MEMORY_SCOPE_MISMATCH", "This item is outside the current entry.");
      }
      const person = await client.query(`SELECT id FROM subjects WHERE account_id=$1 AND id=$2 AND status='active' FOR SHARE`, [auth.accountId, entry.person_id]);
      if (!person.rows[0]) throw new ApiError(404, "MEMORY_NOT_FOUND", "The contact is no longer current.");
      if (entry.purpose === "relationship") {
        const context = await client.query(`SELECT id FROM assignments WHERE account_id=$1 AND id=$2 AND subject_id=$3 AND status='active' FOR SHARE`,
          [auth.accountId, entry.relationship_context_id, entry.person_id]);
        if (!context.rows[0]) throw new ApiError(404, "MEMORY_NOT_FOUND", "The relationship is no longer current.");
      }
      if (entry.pursuit_id) {
        if (!entry.pursuit_role_id || !entry.pursuit_role_evidence_fragment_id || !entry.pursuit_capture_id || !entry.pursuit_capture_version) throw new ApiError(403, "MEMORY_SCOPE_MISMATCH", "The Pursuit entry is incomplete.");
        await assertPursuitAssociationCurrent(client, auth, { pursuitId: entry.pursuit_id, roleId: entry.pursuit_role_id,
          evidenceFragmentId: entry.pursuit_role_evidence_fragment_id, personId: entry.person_id,
          relationshipContextId: entry.relationship_context_id ?? null, captureId: entry.pursuit_capture_id, captureVersion: entry.pursuit_capture_version }, { lock: true });
      }
    }
    if (idempotency.replay) return { ...(idempotency.replay.body as MemoryItemMutationResponse), replayed: true };
    if (row.status !== "active") {
      throw new ApiError(409, "MEMORY_ITEM_NOT_ACTIVE", "This memory is no longer active.");
    }
    if (row.version !== request.expected_version) {
      throw new ApiError(409, "MEMORY_ITEM_REVISION_CONFLICT", "The memory changed before this correction.", {
        current_version: row.version,
      });
    }
    let responseItem: import("@talent-signal/contracts").MemoryRecallItem | null;
    let status: MemoryItemMutationResponse["status"];
    if (request.operation === "delete") {
      await client.query(
        `UPDATE memory_items
         SET status = 'deleted', deleted_at = now(), updated_at = now()
         WHERE account_id = $1 AND id = $2`,
        [auth.accountId, itemId],
      );
      await client.query(
        `UPDATE memory_item_evidence
         SET status = 'revoked', revoked_at = now(), revocation_reason = 'user_deleted'
         WHERE account_id = $1 AND memory_item_id = $2`,
        [auth.accountId, itemId],
      );
      responseItem = null;
      status = "deleted";
    } else {
      if (!request.display_text?.trim()) {
        throw new ApiError(400, "MEMORY_ITEM_TEXT_REQUIRED", "A correction needs the corrected sentence.");
      }
      const newItemId = randomUUID();
      const evidenceSource = await loadEvidence(client, auth.accountId, itemId);
      await client.query(
        `INSERT INTO memory_items(
           id, account_id, owner_user_id, scope, subject_id, relationship_context_id,
           display_text, original_display_text, statement_kind, speaker, reporter,
           valid_time, observed_time, time_status, sensitivity, version, status,
           supersedes_id, conflict_group_id, created_by_user_id
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'active',
                 $17,$18,$19)`,
        [
          newItemId,
          auth.accountId,
          auth.userId,
          row.scope,
          row.subject_id,
          row.relationship_context_id,
          request.display_text.trim().slice(0, 1_000),
          row.original_display_text ?? row.display_text,
          row.statement_kind,
          row.speaker,
          row.reporter,
          row.valid_time,
          row.observed_time,
          row.time_status,
          row.sensitivity,
          row.version + 1,
          row.id,
          row.conflict_group_id,
          auth.userId,
        ],
      );
      await client.query(
        `UPDATE memory_items
         SET status = 'superseded', superseded_by_id = $3, updated_at = now()
         WHERE account_id = $1 AND id = $2`,
        [auth.accountId, itemId, newItemId],
      );
      for (const evidence of evidenceSource) {
        await client.query(
          `INSERT INTO memory_item_evidence(
             id, account_id, memory_item_id, capture_id, source_resource_id,
             evidence_fragment_id, source_session_id, source_message_id,
             source_task_id, source_artifact_id, locator, excerpt, content_hash,
             source_capture_version, status
           )
           SELECT $1, account_id, $3, capture_id, source_resource_id,
                  evidence_fragment_id, source_session_id, source_message_id,
                  source_task_id, source_artifact_id, locator, excerpt,
                  content_hash, source_capture_version, 'active'
           FROM memory_item_evidence WHERE account_id = $2 AND id = $4`,
          [randomUUID(), auth.accountId, newItemId, evidence.id],
        );
      }
      responseItem = await readMemoryItem(client, auth, newItemId);
      status = "active";
    }
    const scope = {
      subjectId: row.subject_id,
      relationshipContextId: row.relationship_context_id,
    };
    await invalidateDerivedKnowledge(client, auth.accountId, scope);
    await enqueueProjectionJob(
      client,
      auth.accountId,
      scope,
      request.operation === "delete" ? "memory_deleted" : "memory_corrected",
    );
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      `memory.item_${request.operation}`,
      "memory_item",
      itemId,
      { reason: request.reason, previous_version: row.version },
    );
    const body: MemoryItemMutationResponse = {
      contract_version: CONTRACT_VERSION,
      operation_key: request.idempotency_key,
      item: responseItem,
      status,
    };
    await completeIdempotency(client, idempotency, 200, body);
    return { ...body, replayed: false };
  });
}
