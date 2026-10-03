import { randomBytes, randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  type MemoryDismissRequest,
  type MemoryDismissResponse,
  type MemoryProposalListResponse,
  type MemoryProposalRecord,
  type MemoryReviewDraft,
  type MemoryReviewDraftRequest,
  type MemoryReviewResponse,
  type MemoryReviewView,
  type MemorySurface,
} from "@talent-signal/contracts";
import type { Pool } from "pg";

import { inTransaction, type DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import type { AuthContext } from "./auth.js";
import {
  MEMORY_REVIEW_SCOPE_TTL_MS,
  allowedScopeForSurface,
  surfaceAllowsScope,
} from "./memoryReviewPolicy.js";
import { proposalRecord } from "./memoryReviewStage.js";
import {
  loadDraft,
  loadProposal,
  loadProposalItems,
  loadReviewScope,
  serializeProposalItem,
  type ProposalItemRow,
  type ProposalRow,
  type ReviewScopeRow,
} from "./memoryReviewStore.js";
import { verifyPendingSourceAuthority } from "./memorySourceVerification.js";
import { assertPursuitAssociationCurrent } from "./memoryPursuitScopes.js";

/**
 * Revalidate a stored Pursuit association before any read/mutation, in the
 * caller's transaction so authority cannot change between check and write.
 */
async function revalidateScopePursuit(
  client: DatabaseClient,
  auth: AuthContext,
  scope: ReviewScopeRow,
  lock: boolean,
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
    { lock },
  );
}

export function hashReviewCredential(token: string): string {
  return sha256(`memory-review-credential:${token}`);
}

export function mintReviewCredential(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Validate one rendered review credential. Multiple credentials can coexist for
 * the same scope, so opening a second tab does not invalidate the first.
 */
export async function assertReviewCredential(
  client: DatabaseClient,
  scope: ReviewScopeRow,
  credential: string | null | undefined,
): Promise<void> {
  if (!credential) {
    throw new ApiError(
      403,
      "MEMORY_REVIEW_CREDENTIAL_INVALID",
      "This Memory review scope needs its rendered credential.",
    );
  }
  const result = await client.query<{ id: string }>(
    `SELECT id FROM memory_review_credentials
     WHERE account_id = $1 AND review_scope_id = $2 AND credential_hash = $3
       AND revoked_at IS NULL AND expires_at > now()`,
    [scope.account_id, scope.id, hashReviewCredential(credential)],
  );
  if (!result.rows[0]) {
    throw new ApiError(
      403,
      "MEMORY_REVIEW_CREDENTIAL_INVALID",
      "This Memory review credential is no longer valid for this scope.",
    );
  }
}

async function insertReviewCredential(
  client: DatabaseClient,
  scope: ReviewScopeRow,
  credential: string,
): Promise<void> {
  await client.query(
    `INSERT INTO memory_review_credentials(
       id, account_id, review_scope_id, credential_hash, expires_at
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      randomUUID(),
      scope.account_id,
      scope.id,
      hashReviewCredential(credential),
      new Date(Date.now() + MEMORY_REVIEW_SCOPE_TTL_MS),
    ],
  );
}

export function visibleItems(
  scope: ReviewScopeRow,
  items: readonly ProposalItemRow[],
): ProposalItemRow[] {
  return items.filter((item) => {
    if (item.added_revision > scope.proposal_revision) return false;
    if (item.status !== "pending") return false;
    if (!surfaceAllowsScope(scope.purpose, item.scope)) return false;
    if (scope.allowed_scope === "relationship") {
      return item.scope === "relationship"
        && item.subject_id === scope.person_id
        && item.relationship_context_id === scope.relationship_context_id;
    }
    if (scope.allowed_scope === "person_relationship") {
      if (scope.person_id && item.subject_id !== scope.person_id) return false;
      if (
        scope.person_id
        && item.relationship_context_id
        && scope.relationship_context_id
        && item.relationship_context_id !== scope.relationship_context_id
      ) {
        return false;
      }
    }
    return true;
  });
}

/** Pending items whose original source is no longer available are dropped. */
export async function filterUnavailableProposalItems(
  client: DatabaseClient,
  auth: AuthContext,
  proposal: ProposalRow,
  items: readonly ProposalItemRow[],
): Promise<ProposalItemRow[]> {
  if (items.length === 0) return [];
  const verification = await verifyPendingSourceAuthority(
    client,
    auth,
    proposal,
    items,
  );
  if (verification.unavailableItemIds.size === 0) return [...items];
  return items.filter((item) => !verification.unavailableItemIds.has(item.id));
}

/** Visible items for one purpose, excluding any whose bound source is unavailable. */
export async function visibleReviewItems(
  client: DatabaseClient,
  auth: AuthContext,
  scope: ReviewScopeRow,
  proposal: ProposalRow,
  items: readonly ProposalItemRow[],
): Promise<ProposalItemRow[]> {
  return filterUnavailableProposalItems(
    client,
    auth,
    proposal,
    visibleItems(scope, items),
  );
}

export function filterDraft(
  draft: MemoryReviewDraft | null,
  visibleIds: ReadonlySet<string>,
): MemoryReviewDraft | null {
  if (!draft) return null;
  return {
    contact_decision: draft.contact_decision,
    selected_item_ids: draft.selected_item_ids.filter((id) => visibleIds.has(id)),
    edited_text: Object.fromEntries(
      Object.entries(draft.edited_text).filter(([id]) => visibleIds.has(id)),
    ),
    item_decisions: Object.fromEntries(
      Object.entries(draft.item_decisions).filter(([id]) => visibleIds.has(id)),
    ),
    revision: draft.revision,
    updated_at: draft.updated_at,
  };
}

async function buildReviewView(
  client: DatabaseClient,
  auth: AuthContext,
  scope: ReviewScopeRow,
  proposal: ProposalRow,
): Promise<MemoryReviewView> {
  const items = await loadProposalItems(client, auth.accountId, proposal.id);
  const scoped = visibleItems(scope, items);
  const verification = await verifyPendingSourceAuthority(
    client,
    auth,
    proposal,
    scoped,
  );
  const visible = scoped.filter(
    (item) => !verification.unavailableItemIds.has(item.id),
  );
  const unavailableVisibleCount = scoped.length - visible.length;
  const draft = filterDraft(
    await loadDraft(client, auth.accountId, proposal.id, auth.userId),
    new Set(visible.map((item) => item.id)),
  );
  return {
    contract_version: CONTRACT_VERSION,
    review_scope_id: scope.id,
    review_revision: scope.revision,
    purpose: scope.purpose,
    proposal_id: proposal.id,
    proposal_revision: scope.proposal_revision,
    allowed_scope: scope.allowed_scope,
    person_id: scope.person_id,
    relationship_context_id: scope.relationship_context_id,
    person_display_label: proposal.person_display_label,
    relationship_display_label: proposal.relationship_display_label,
    pursuit_id: scope.pursuit_id,
    pursuit_role_id: scope.pursuit_role_id,
    pursuit_role_evidence_fragment_id: scope.pursuit_role_evidence_fragment_id,
    pursuit_capture_id: scope.pursuit_capture_id,
    pursuit_capture_version: scope.pursuit_capture_version,
    source_session_id: scope.source_session_id,
    source_message_id: scope.source_message_id,
    contact_decision: proposal.contact_decision,
    contact_status: proposal.contact_status,
    status: proposal.status,
    expires_at: scope.expires_at.toISOString(),
    visible_item_count: visible.length,
    visible_default_selected_count: visible.filter((item) => item.default_selected).length,
    source_status: !verification.proposalSourceAvailable || unavailableVisibleCount > 0
      ? "unavailable"
      : "available",
    source_unavailable_visible_item_count: unavailableVisibleCount,
    items: visible.map(serializeProposalItem),
    draft,
  };
}

async function proposalRecordFor(
  client: DatabaseClient,
  row: ProposalRow,
  auth: AuthContext,
  purpose: MemorySurface,
  personId: string | null,
  contextId: string | null,
): Promise<MemoryProposalRecord | null> {
  if (purpose === "chat" && row.surface !== "chat") return null;
  const items = await loadProposalItems(client, row.account_id, row.id);
  const available = await filterUnavailableProposalItems(client, auth, row, items);
  const visible = available.filter((item) => {
    if (item.status !== "pending") return false;
    if (!surfaceAllowsScope(purpose, item.scope)) return false;
    if (purpose !== "chat") {
      if (!personId || item.subject_id !== personId) return false;
      if (contextId && item.relationship_context_id && item.relationship_context_id !== contextId) {
        return false;
      }
    }
    return true;
  });
  if (visible.length === 0) return null;
  return {
    proposal_id: row.id,
    revision: row.revision,
    status: row.status,
    surface: row.surface,
    contact_decision: row.contact_decision,
    contact_status: row.contact_status,
    identity_authority: row.identity_authority,
    person_id: row.target_person_id,
    relationship_context_id: row.target_relationship_context_id,
    person_display_label: row.person_display_label,
    relationship_display_label: row.relationship_display_label,
    item_count: visible.length,
    default_selected_count: visible.filter((item) => item.default_selected).length,
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
  };
}

/**
 * Purpose-scoped proposal list. A people/relationship query never returns
 * private self counts or ids and needs the exact contact scope.
 */
export async function listMemoryProposals(
  client: DatabaseClient,
  auth: AuthContext,
  purpose: MemorySurface | null,
  personId: string | null,
  contextId: string | null,
  sessionId: string | null = null,
): Promise<MemoryProposalListResponse> {
  const effectivePurpose = purpose ?? "chat";
  if (effectivePurpose !== "chat" && !personId) {
    throw new ApiError(400, "MEMORY_SCOPE_REQUIRED", "This surface needs one contact to list Memory proposals.");
  }
  const result = await client.query<ProposalRow>(
    `SELECT * FROM memory_proposals
     WHERE account_id = $1
       AND created_by_user_id = $2
       AND status IN ('open', 'partially_committed')
       AND expires_at > now()
       AND ($3::uuid IS NULL OR session_id = $3)
     ORDER BY created_at DESC, id
     LIMIT 50`,
    [auth.accountId, auth.userId, sessionId],
  );
  const proposals: MemoryProposalRecord[] = [];
  for (const row of result.rows) {
    const record = await proposalRecordFor(
      client,
      row,
      auth,
      effectivePurpose,
      personId,
      contextId,
    );
    if (record) proposals.push(record);
  }
  return { contract_version: CONTRACT_VERSION, proposals };
}

export interface OpenReviewResult {
  response: MemoryReviewResponse;
  created: boolean;
}

export async function openMemoryReview(
  pool: Pool,
  auth: AuthContext,
  proposalId: string,
  request: {
    purpose: MemorySurface;
    person_id?: string | null;
    relationship_context_id?: string | null;
    pursuit_id?: string | null;
    pursuit_role_id?: string | null;
    pursuit_role_evidence_fragment_id?: string | null;
    session_id?: string | null;
    pursuit_capture_id?: string | null;
    pursuit_capture_version?: number | null;
  },
): Promise<MemoryReviewResponse> {
  return inTransaction(pool, async (client) => {
    const proposal = await loadProposal(client, auth.accountId, proposalId, true);
    if (!proposal || proposal.created_by_user_id !== auth.userId) {
      throw new ApiError(404, "MEMORY_NOT_FOUND", "The requested Memory proposal was not found.");
    }
    let personId = request.person_id ?? proposal.target_person_id;
    let contextId = request.relationship_context_id ?? proposal.target_relationship_context_id;
    // A Chat entry capability binds the exact originating Session; a browser
    // cannot open the same proposal under a different Session authority.
    if (request.session_id && proposal.session_id !== request.session_id) {
      throw new ApiError(
        409,
        "MEMORY_REVIEW_SCOPE_MISMATCH",
        "This Memory proposal belongs to a different conversation than the current entry.",
      );
    }
    let pursuitCaptureId: string | null = null;
    let pursuitCaptureVersion: number | null = null;
    if (request.pursuit_id) {
      if (!request.pursuit_role_id || !request.pursuit_role_evidence_fragment_id || !personId) {
        throw new ApiError(
          400,
          "MEMORY_PURSUIT_ASSOCIATION_REQUIRED",
          "A Pursuit-scoped review needs its exact role, evidence reference and person.",
        );
      }
      const association = await assertPursuitAssociationCurrent(client, auth, {
        pursuitId: request.pursuit_id,
        roleId: request.pursuit_role_id,
        evidenceFragmentId: request.pursuit_role_evidence_fragment_id,
        personId,
        relationshipContextId: contextId,
        captureId: request.pursuit_capture_id ?? null,
        captureVersion: request.pursuit_capture_version ?? null,
      }, { lock: true });
      // The current association is authority; a supplied context cannot widen it.
      contextId = association.relationshipContextId;
      pursuitCaptureId = association.captureId;
      pursuitCaptureVersion = association.captureVersion;
    }
    if (request.purpose === "chat" && proposal.surface !== "chat") {
      throw new ApiError(
        403,
        "MEMORY_REVIEW_SCOPE_MISMATCH",
        "A business proposal cannot be widened into a private Chat review.",
      );
    }
    if (request.purpose === "people") {
      if (!personId || personId !== proposal.target_person_id) {
        throw new ApiError(409, "MEMORY_REVIEW_SCOPE_MISMATCH", "The People surface must open the proposal's resolved contact.");
      }
    }
    if (request.purpose === "relationship") {
      if (
        !personId
        || personId !== proposal.target_person_id
        || !contextId
        || contextId !== proposal.target_relationship_context_id
      ) {
        throw new ApiError(409, "MEMORY_REVIEW_SCOPE_MISMATCH", "The relationship surface must open the proposal's exact contact and relationship context.");
      }
    }
    // Terminal metadata is scoped and authoritative, including in a fresh tab.
    // It contains no private item text, IDs or counts from another surface.
    if (proposal.status === "dismissed") {
      throw new ApiError(409, "MEMORY_REVIEW_DISMISSED", "This proposal was dismissed.");
    }
    if (proposal.status === "committed") {
      const operation = await client.query<{ operation_key: string }>(
        `SELECT commit.operation_key FROM memory_commits commit
         JOIN memory_review_scopes review ON review.account_id = commit.account_id AND review.id = commit.review_scope_id
         WHERE commit.account_id = $1 AND commit.proposal_id = $2 AND commit.committed_by_user_id = $3
           AND ($4 = 'chat' OR (review.purpose = $4 AND review.person_id IS NOT DISTINCT FROM $5::uuid
             AND review.relationship_context_id IS NOT DISTINCT FROM $6::uuid))
         ORDER BY commit.created_at DESC LIMIT 1`,
        [auth.accountId, proposal.id, auth.userId, request.purpose, personId, contextId],
      );
      throw new ApiError(409, "MEMORY_REVIEW_PROCESSED", "This proposal was already processed.", { operation_key: operation.rows[0]?.operation_key ?? null });
    }
    if (proposal.status !== "open" && proposal.status !== "partially_committed") {
      throw new ApiError(409, "MEMORY_PROPOSAL_CLOSED", "This proposal is no longer available.");
    }
    if (proposal.expires_at.valueOf() <= Date.now()) throw new ApiError(410, "MEMORY_PROPOSAL_EXPIRED", "This Memory proposal expired.");
    const allowedScope = allowedScopeForSurface(request.purpose);
    const credential = mintReviewCredential();
    const existing = await client.query<ReviewScopeRow>(
      `SELECT * FROM memory_review_scopes
       WHERE account_id = $1 AND proposal_id = $2 AND reader_user_id = $3
         AND purpose = $4 AND proposal_revision = $5
         AND person_id IS NOT DISTINCT FROM $6::uuid
         AND relationship_context_id IS NOT DISTINCT FROM $7::uuid
         AND pursuit_id IS NOT DISTINCT FROM $8::uuid
         AND pursuit_role_id IS NOT DISTINCT FROM $9::uuid
         AND pursuit_role_evidence_fragment_id IS NOT DISTINCT FROM $10::uuid
         AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [
        auth.accountId,
        proposal.id,
        auth.userId,
        request.purpose,
        proposal.revision,
        personId,
        contextId,
        request.pursuit_id ?? null,
        request.pursuit_role_id ?? null,
        request.pursuit_role_evidence_fragment_id ?? null,
      ],
    );
    let scope = existing.rows[0];
    if (!scope) {
      scope = (
        await client.query<ReviewScopeRow>(
          `INSERT INTO memory_review_scopes(
             id, account_id, proposal_id, proposal_revision, reader_user_id,
             surface, purpose, allowed_scope, credential_hash, person_id,
             relationship_context_id, source_session_id, source_message_id,
             pursuit_id, pursuit_role_id, pursuit_role_evidence_fragment_id,
             pursuit_capture_id, pursuit_capture_version,
             revision, expires_at
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,0,$19)
           RETURNING *`,
          [
            randomUUID(),
            auth.accountId,
            proposal.id,
            proposal.revision,
            auth.userId,
            request.purpose,
            request.purpose,
            allowedScope,
            hashReviewCredential(credential),
            personId,
            contextId,
            proposal.session_id,
            proposal.source_message_id,
            request.pursuit_id ?? null,
            request.pursuit_role_id ?? null,
            request.pursuit_role_evidence_fragment_id ?? null,
            pursuitCaptureId,
            pursuitCaptureVersion,
            new Date(Date.now() + MEMORY_REVIEW_SCOPE_TTL_MS),
          ],
        )
      ).rows[0];
    }
    if (!scope) {
      throw new ApiError(500, "MEMORY_REVIEW_OPEN_FAILED", "The review scope could not be created.");
    }
    // Each render gets its own credential; opening another tab never revokes it.
    await insertReviewCredential(client, scope, credential);
    return {
      contract_version: CONTRACT_VERSION,
      review_credential: credential,
      review: await buildReviewView(client, auth, scope, proposal),
    };
  });
}

export async function readMemoryReview(
  pool: Pool,
  auth: AuthContext,
  reviewScopeId: string,
  credential: string | null,
): Promise<MemoryReviewResponse> {
  return inTransaction(pool, async (client) => {
    const scope = await loadReviewScope(client, auth.accountId, reviewScopeId);
    if (!scope || scope.reader_user_id !== auth.userId) {
      throw new ApiError(404, "MEMORY_NOT_FOUND", "The requested Memory review was not found.");
    }
    await assertReviewCredential(client, scope, credential);
    await revalidateScopePursuit(client, auth, scope, false);
    const proposal = await loadProposal(client, auth.accountId, scope.proposal_id);
    if (!proposal) {
      throw new ApiError(404, "MEMORY_NOT_FOUND", "The reviewed proposal was not found.");
    }
    return {
      contract_version: CONTRACT_VERSION,
      review_credential: null,
      review: await buildReviewView(client, auth, scope, proposal),
    };
  });
}

/**
 * Merge a surface's local draft into the proposal-level draft. Selections for
 * items outside this surface's visibility are preserved, so a relationship
 * save never drops private Chat choices.
 */
export async function saveMemoryReviewDraft(
  pool: Pool,
  auth: AuthContext,
  reviewScopeId: string,
  credential: string | null,
  request: MemoryReviewDraftRequest,
): Promise<MemoryReviewResponse> {
  return inTransaction(pool, async (client) => {
    const scope = await loadReviewScope(client, auth.accountId, reviewScopeId, true);
    if (!scope || scope.reader_user_id !== auth.userId) {
      throw new ApiError(404, "MEMORY_NOT_FOUND", "The requested Memory review was not found.");
    }
    await assertReviewCredential(client, scope, credential);
    await revalidateScopePursuit(client, auth, scope, true);
    if (scope.expires_at.valueOf() <= Date.now()) {
      throw new ApiError(410, "MEMORY_REVIEW_EXPIRED", "This Memory review expired; open it again.");
    }
    if (scope.revision !== request.expected_review_revision) {
      throw new ApiError(409, "MEMORY_REVIEW_DRAFT_STALE", "The review draft changed elsewhere.", {
        current_review_revision: scope.revision,
      });
    }
    const proposal = await loadProposal(client, auth.accountId, scope.proposal_id, true);
    if (!proposal) {
      throw new ApiError(404, "MEMORY_NOT_FOUND", "The reviewed proposal was not found.");
    }
    if (scope.proposal_revision !== proposal.revision) {
      throw new ApiError(409, "MEMORY_REVIEW_DRAFT_STALE", "The proposal changed; reopen it before saving draft choices.");
    }
    const items = await loadProposalItems(client, auth.accountId, proposal.id);
    const visible = await visibleReviewItems(client, auth, scope, proposal, items);
    const visibleIds = new Set(visible.map((item) => item.id));
    for (const selectedId of request.selected_item_ids) {
      if (!visibleIds.has(selectedId)) {
        throw new ApiError(
          409,
          "MEMORY_ITEM_NOT_IN_FROZEN_REVIEW",
          "A draft selection is not visible in this review purpose.",
          { item_id: selectedId },
        );
      }
    }
    const existing = await loadDraft(client, auth.accountId, proposal.id, auth.userId);
    const mergedSelected = [
      ...(existing?.selected_item_ids.filter((id) => !visibleIds.has(id)) ?? []),
      ...request.selected_item_ids,
    ];
    const mergedEdited = {
      ...Object.fromEntries(
        Object.entries(existing?.edited_text ?? {}).filter(([id]) => !visibleIds.has(id)),
      ),
      ...request.edited_text,
    };
    const mergedDecisions = {
      ...Object.fromEntries(
        Object.entries(existing?.item_decisions ?? {}).filter(([id]) => !visibleIds.has(id)),
      ),
      ...request.item_decisions,
    };
    await client.query(
      `INSERT INTO memory_review_drafts(
         id, account_id, proposal_id, review_scope_id, reader_user_id, revision,
         contact_decision, selected_item_ids, edited_text, item_decisions, expires_at
       )
       VALUES ($1,$2,$3,$4,$5,1,$6,$7::uuid[],$8::jsonb,$9::jsonb,$10)
       ON CONFLICT (account_id, proposal_id, reader_user_id) DO UPDATE SET
         revision = memory_review_drafts.revision + 1,
         review_scope_id = EXCLUDED.review_scope_id,
         contact_decision = EXCLUDED.contact_decision,
         selected_item_ids = EXCLUDED.selected_item_ids,
         edited_text = EXCLUDED.edited_text,
         item_decisions = EXCLUDED.item_decisions,
         expires_at = EXCLUDED.expires_at,
         updated_at = now()`,
      [
        randomUUID(),
        auth.accountId,
        proposal.id,
        scope.id,
        auth.userId,
        request.contact_decision,
        mergedSelected,
        JSON.stringify(mergedEdited),
        JSON.stringify(mergedDecisions),
        new Date(Date.now() + MEMORY_REVIEW_SCOPE_TTL_MS),
      ],
    );
    const freshScope = await loadReviewScope(client, auth.accountId, scope.id);
    if (!freshScope) {
      throw new ApiError(500, "MEMORY_REVIEW_DRAFT_FAILED", "The review draft could not be read back.");
    }
    const updated = (
      await client.query<ReviewScopeRow>(
        `UPDATE memory_review_scopes
         SET revision = revision + 1, updated_at = now()
         WHERE account_id = $1 AND id = $2
         RETURNING *`,
        [auth.accountId, scope.id],
      )
    ).rows[0] ?? freshScope;
    return {
      contract_version: CONTRACT_VERSION,
      review_credential: null,
      review: await buildReviewView(client, auth, updated, proposal),
    };
  });
}

/**
 * Source/revision-scoped no-save. An empty item_ids list dismisses the whole
 * visible scope; a non-empty list dismisses only those visible items. A
 * dismissal never creates memory, a contact, or a commit receipt, and it never
 * touches hidden self or another purpose's items.
 */
export async function dismissMemoryReview(
  pool: Pool,
  auth: AuthContext,
  reviewScopeId: string,
  credential: string | null,
  request: MemoryDismissRequest,
  itemExpectation?: { proposalRevision: number; itemId: string; addedRevision: number },
): Promise<MemoryDismissResponse & { replayed: boolean }> {
  return inTransaction(pool, async (client) => {
    const idempotency = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      `dismiss_memory_review:${reviewScopeId}`,
      request.idempotency_key,
      request,
    );
    if (idempotency.replay) {
      return {
        ...(idempotency.replay.body as MemoryDismissResponse),
        replayed: true,
      };
    }
    const scope = await loadReviewScope(client, auth.accountId, reviewScopeId, true);
    if (!scope || scope.reader_user_id !== auth.userId) {
      throw new ApiError(404, "MEMORY_NOT_FOUND", "The requested Memory review was not found.");
    }
    await assertReviewCredential(client, scope, credential);
    await revalidateScopePursuit(client, auth, scope, true);
    if (scope.revision !== request.expected_review_revision) {
      throw new ApiError(409, "MEMORY_REVIEW_DRAFT_STALE", "The review changed elsewhere.", {
        current_review_revision: scope.revision,
      });
    }
    const proposal = await loadProposal(client, auth.accountId, scope.proposal_id, true);
    if (!proposal || (proposal.status !== "open" && proposal.status !== "partially_committed")) {
      throw new ApiError(409, "MEMORY_PROPOSAL_CLOSED", "This Memory proposal is no longer open.");
    }
    const items = await loadProposalItems(client, auth.accountId, proposal.id);
    const visible = await visibleReviewItems(client, auth, scope, proposal, items);
    if (itemExpectation) {
      const target = visible.find((item) => item.id === itemExpectation.itemId);
      if (scope.proposal_revision !== itemExpectation.proposalRevision
        || proposal.revision !== itemExpectation.proposalRevision
        || !target || target.status !== "pending"
        || target.added_revision !== itemExpectation.addedRevision
        || request.item_ids.length !== 1 || request.item_ids[0] !== target.id) {
        throw new ApiError(409, "MEMORY_ITEM_STALE", "This Memory item changed; reopen the review.");
      }
    }
    const visibleIds = new Set(visible.map((item) => item.id));
    const targetIds = request.item_ids.length === 0
      ? [...visibleIds]
      : request.item_ids;
    for (const itemId of targetIds) {
      if (!visibleIds.has(itemId)) {
        throw new ApiError(
          409,
          "MEMORY_ITEM_NOT_IN_FROZEN_REVIEW",
          "A dismissal can only target items visible in this review purpose.",
          { item_id: itemId },
        );
      }
    }
    if (targetIds.length > 0) {
      await client.query(
        `UPDATE memory_proposal_items SET status = 'skipped'
         WHERE account_id = $1 AND id = ANY($2::uuid[])`,
        [auth.accountId, targetIds],
      );
    }
    await client.query(
      `INSERT INTO memory_proposal_dismissals(
         id, account_id, proposal_id, proposal_revision, review_scope_id,
         purpose, dismissed_item_ids, reason, created_by_user_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8,$9)`,
      [
        randomUUID(),
        auth.accountId,
        proposal.id,
        scope.proposal_revision,
        scope.id,
        scope.purpose,
        targetIds,
        request.reason,
        auth.userId,
      ],
    );
    const remaining = await client.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count FROM memory_proposal_items
       WHERE account_id = $1 AND proposal_id = $2 AND status = 'pending'`,
      [auth.accountId, proposal.id],
    );
    const remainingCount = remaining.rows[0]?.count ?? 0;
    const proposalStatus = remainingCount === 0 ? "dismissed" : proposal.status;
    if (remainingCount === 0) {
      await client.query(
        `UPDATE memory_proposals SET status = 'dismissed', updated_at = now()
         WHERE account_id = $1 AND id = $2`,
        [auth.accountId, proposal.id],
      );
    }
    const body: MemoryDismissResponse = {
      contract_version: CONTRACT_VERSION,
      replayed: false,
      dismissed_item_ids: targetIds,
      proposal_status: proposalStatus,
    };
    await completeIdempotency(client, idempotency, 200, body);
    return { ...body, replayed: false };
  });
}
