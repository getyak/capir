import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  normalizeIdentityHandle,
  type AgentSessionPayload,
  type IdentityHandleType,
  type MemoryDecision,
  type MemoryProposalItem,
  type MemoryRecallItem,
  type MemoryReceipt,
  type MemoryReviewDraft,
  type MemorySourceLocator,
} from "@talent-signal/contracts";
import type { PoolClient } from "pg";

import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";

export interface ProposalRow {
  id: string;
  account_id: string;
  created_by_user_id: string;
  proposer_kind: "agent" | "human";
  proposer_name: string;
  proposer_version: string;
  surface: "chat" | "people" | "relationship";
  session_id: string | null;
  source_task_id: string | null;
  source_message_id: string | null;
  target_person_id: string | null;
  target_relationship_context_id: string | null;
  contact_decision: "existing" | "new" | "none";
  contact_status: "resolved" | "ambiguous" | "pending";
  identity_authority: "tentative" | "stable_handle" | "human_selection";
  person_display_label: string | null;
  relationship_display_label: string | null;
  source_revision_hash: string | null;
  source_message_text_hash: string | null;
  source_image_manifest: MemoryImageManifestEntry[] | null;
  source_capture_version: number | null;
  source_subject_id: string | null;
  source_relationship_context_id: string | null;
  target_revision: number;
  revision: number;
  status: "open" | "partially_committed" | "committed" | "dismissed" | "expired";
  superseded_by_proposal_id: string | null;
  rebase_count: number;
  frozen_at: Date;
  created_at: Date;
  expires_at: Date;
}

export interface ProposalItemRow {
  id: string;
  account_id: string;
  proposal_id: string;
  scope: "self" | "person" | "relationship";
  subject_kind: "owner_self" | "resolved_subject" | "proposal_target";
  relationship_kind: "none" | "resolved_context" | "proposal_target_context";
  operation: "add" | "update" | "contest";
  statement_kind: "fact" | "source_statement" | "user_opinion";
  display_text: string;
  original_display_text: string;
  previous_text: string | null;
  previous_memory_item_id: string | null;
  previous_revision: number | null;
  previous_owner_user_id: string | null;
  subject_id: string | null;
  relationship_context_id: string | null;
  speaker: string | null;
  reporter: string | null;
  valid_time: Date | null;
  observed_time: Date | null;
  time_status: "known" | "unknown" | "future" | "past";
  sensitivity: "normal" | "sensitive";
  admission_status: "eligible" | "needs_judgment" | "ineligible";
  admission_reason: string | null;
  judgment_kind:
    | "ordinary"
    | "conflict"
    | "sensitive"
    | "ambiguous_attribution"
    | "stale_target"
    | "self_scope_escape";
  default_selected: boolean;
  reason: string;
  source_excerpt: string;
  source_excerpt_hash: string;
  locator: MemorySourceLocator;
  capture_id: string | null;
  source_resource_id: string | null;
  evidence_fragment_id: string | null;
  source_artifact_id: string | null;
  source_session_id: string | null;
  source_message_id: string | null;
  source_revision_hash: string | null;
  source_capture_version: number | null;
  content_hash: string;
  added_revision: number;
  status: "pending" | "committed" | "skipped";
  committed_memory_item_id: string | null;
}

export interface MemoryItemRow {
  id: string;
  account_id: string;
  owner_user_id: string;
  scope: "self" | "person" | "relationship";
  subject_id: string | null;
  relationship_context_id: string | null;
  display_text: string;
  original_display_text: string | null;
  statement_kind: "fact" | "source_statement" | "user_opinion";
  speaker: string | null;
  reporter: string | null;
  valid_time: Date | null;
  observed_time: Date | null;
  time_status: "known" | "unknown" | "future" | "past";
  sensitivity: "normal" | "sensitive";
  version: number;
  status: "active" | "superseded" | "invalidated" | "deleted";
  supersedes_id: string | null;
  superseded_by_id: string | null;
  conflict_group_id: string | null;
  created_at: Date;
}

export interface EvidenceRow {
  id: string;
  memory_item_id: string;
  capture_id: string | null;
  source_resource_id: string | null;
  evidence_fragment_id: string | null;
  source_session_id: string | null;
  source_message_id: string | null;
  source_artifact_id: string | null;
  locator: MemorySourceLocator;
  excerpt: string;
  status: "active" | "revoked";
}

export interface ReviewScopeRow {
  id: string;
  account_id: string;
  proposal_id: string;
  proposal_revision: number;
  reader_user_id: string;
  surface: "chat" | "people" | "relationship";
  purpose: "chat" | "people" | "relationship";
  allowed_scope: "all" | "person_relationship" | "relationship";
  credential_hash: string;
  person_id: string | null;
  relationship_context_id: string | null;
  source_session_id: string | null;
  source_message_id: string | null;
  pursuit_id: string | null;
  pursuit_role_id: string | null;
  pursuit_role_evidence_fragment_id: string | null;
  pursuit_capture_id: string | null;
  pursuit_capture_version: number | null;
  revision: number;
  created_at: Date;
  expires_at: Date;
}

export interface ReceiptRow {
  id: string;
  account_id: string;
  commit_id: string;
  operation_key: string;
  status: "applied" | "undone";
  contact_decision: "existing" | "new" | "none";
  created_person_id: string | null;
  person_display_label: string | null;
  created_relationship_context_id: string | null;
  undo_contact_outcome: "retained" | "reclaimed" | null;
  undo_context_outcome: "retained" | "reclaimed" | null;
  item_count: number;
  created_item_ids: string[];
  updated_item_ids: string[];
  skipped_item_ids: string[];
  changes: unknown;
  undo_token: string;
  projection_status: "pending" | "rebuilt" | "not_required";
  created_at: Date;
  undone_at: Date | null;
}

export interface MemoryAdmittedArtifact {
  artifactId: string;
  kind: "image" | "text";
  sessionId: string | null;
  messageId: string | null;
  captureId: string | null;
  sourceResourceId: string | null;
  evidenceFragmentId: string | null;
  contentHash: string | null;
  captureVersion: number | null;
  /** Original media/artifact id when it differs from the provider artifact id. */
  sourceArtifactId?: string | null;
}

export interface MemoryImageManifestEntry {
  index: number;
  attachmentId: string;
  contentHash: string;
}

export interface MemorySourceAuthority {
  /** Host-verified admitted text for the exact user message. */
  text: string | null;
  artifacts: readonly MemoryAdmittedArtifact[];
  sessionId: string | null;
  messageId: string | null;
  sourceTaskId: string | null;
  captureIds: readonly string[];
  /** Hash of the exact original message text (not the whole Session). */
  messageTextHash: string | null;
  imageManifest: readonly MemoryImageManifestEntry[];
  captureVersion: number | null;
  captureSubjectId: string | null;
  captureContextId: string | null;
}

export function emptySourceAuthority(): MemorySourceAuthority {
  return {
    text: null,
    artifacts: [],
    sessionId: null,
    messageId: null,
    sourceTaskId: null,
    captureIds: [],
    messageTextHash: null,
    imageManifest: [],
    captureVersion: null,
    captureSubjectId: null,
    captureContextId: null,
  };
}

/**
 * An accepted Memory is recalled only while every retained evidence row is
 * available. Natural Session/image TTL (source purged or authorization expired)
 * is deliberately not included; explicit deletion or revocation is.
 */
export const MEMORY_EVIDENCE_AVAILABLE_SQL = `(
  e.status = 'active'
  AND (
    e.capture_id IS NULL
    OR EXISTS (
      SELECT 1 FROM captures c
      WHERE c.account_id = e.account_id AND c.id = e.capture_id
        AND c.status = 'active' AND c.deleted_at IS NULL
    )
  )
  AND (
    e.source_resource_id IS NULL
    OR EXISTS (
      SELECT 1 FROM source_resources r
      WHERE r.account_id = e.account_id AND r.id = e.source_resource_id
        AND r.processing_state <> 'deleted' AND r.deleted_at IS NULL
    )
  )
  AND (
    e.capture_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM source_retention_receipts rr
      WHERE rr.account_id = e.account_id AND rr.capture_id = e.capture_id
        AND (rr.authorization_state = 'revoked' OR rr.source_access_state = 'deleted')
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM memory_source_revocations r
    WHERE r.account_id = e.account_id
      AND (r.source_version IS NULL
        OR r.source_version = e.source_capture_version)
      AND (
        (r.source_kind = 'session' AND e.source_session_id IS NOT NULL
          AND e.source_session_id::text = r.source_id)
        OR (r.source_kind = 'capture' AND e.capture_id IS NOT NULL
          AND e.capture_id::text = r.source_id)
        OR (r.source_kind = 'artifact' AND e.source_artifact_id IS NOT NULL
          AND e.source_artifact_id = r.source_id)
      )
  )
)`;

export async function loadProposal(
  client: DatabaseClient,
  accountId: string,
  proposalId: string,
  lock = false,
): Promise<ProposalRow | null> {
  const result = await client.query<ProposalRow>(
    `SELECT * FROM memory_proposals
     WHERE account_id = $1 AND id = $2
     ${lock ? "FOR UPDATE" : ""}`,
    [accountId, proposalId],
  );
  return result.rows[0] ?? null;
}

export async function loadProposalItems(
  client: DatabaseClient,
  accountId: string,
  proposalId: string,
  lock = false,
): Promise<ProposalItemRow[]> {
  const result = await client.query<ProposalItemRow>(
    `SELECT * FROM memory_proposal_items
     WHERE account_id = $1 AND proposal_id = $2
     ORDER BY added_revision, created_at, id
     ${lock ? "FOR UPDATE" : ""}`,
    [accountId, proposalId],
  );
  return result.rows;
}

export async function loadReviewScope(
  client: DatabaseClient,
  accountId: string,
  reviewScopeId: string,
  lock = false,
): Promise<ReviewScopeRow | null> {
  const result = await client.query<ReviewScopeRow>(
    `SELECT * FROM memory_review_scopes
     WHERE account_id = $1 AND id = $2
     ${lock ? "FOR UPDATE" : ""}`,
    [accountId, reviewScopeId],
  );
  return result.rows[0] ?? null;
}

/**
 * Canonical proposal-level draft for one reader. The draft is keyed by
 * proposal, not by a single purpose-bound review scope, so every surface sees
 * the merged selection while only its own visible items are submitted.
 */
export async function loadDraft(
  client: DatabaseClient,
  accountId: string,
  proposalId: string,
  readerUserId: string,
): Promise<MemoryReviewDraft | null> {
  const result = await client.query<{
    contact_decision: "existing" | "new" | "none";
    selected_item_ids: string[] | null;
    edited_text: Record<string, string> | null;
    item_decisions: Record<string, MemoryDecision> | null;
    revision: number;
    updated_at: Date;
  }>(
    `SELECT contact_decision, selected_item_ids, edited_text, item_decisions,
            revision, updated_at
     FROM memory_review_drafts
     WHERE account_id = $1 AND proposal_id = $2 AND reader_user_id = $3
       AND (expires_at IS NULL OR expires_at > now())`,
    [accountId, proposalId, readerUserId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    contact_decision: row.contact_decision,
    selected_item_ids: row.selected_item_ids ?? [],
    edited_text: row.edited_text ?? {},
    item_decisions: row.item_decisions ?? {},
    revision: row.revision,
    updated_at: row.updated_at.toISOString(),
  };
}

export function serializeProposalItem(row: ProposalItemRow): MemoryProposalItem {
  return {
    id: row.id,
    scope: row.scope,
    subject_kind: row.subject_kind,
    relationship_kind: row.relationship_kind,
    operation: row.operation,
    statement_kind: row.statement_kind,
    display_text: row.display_text,
    original_display_text: row.original_display_text,
    previous_text: row.previous_text,
    previous_memory_item_id: row.previous_memory_item_id,
    previous_revision: row.previous_revision,
    subject_id: row.subject_id,
    relationship_context_id: row.relationship_context_id,
    speaker: row.speaker,
    reporter: row.reporter,
    valid_time: row.valid_time?.toISOString() ?? null,
    observed_time: row.observed_time?.toISOString() ?? null,
    time_status: row.time_status,
    sensitivity: row.sensitivity,
    admission_status: row.admission_status,
    judgment_kind: row.judgment_kind,
    judgment_reason: row.admission_reason,
    default_selected: row.default_selected,
    reason: row.reason,
    source_excerpt: row.source_excerpt,
    source_locator: row.locator,
    added_revision: row.added_revision,
    status: row.status,
  };
}

export function serializeRecallItem(
  item: MemoryItemRow,
  evidence: readonly EvidenceRow[],
  evidenceRetained: boolean,
): MemoryRecallItem {
  return {
    id: item.id,
    scope: item.scope,
    statement_kind: item.statement_kind,
    display_text: item.display_text,
    original_display_text: item.original_display_text ?? item.display_text,
    subject_id: item.subject_id,
    relationship_context_id: item.relationship_context_id,
    speaker: item.speaker,
    reporter: item.reporter,
    valid_time: item.valid_time?.toISOString() ?? null,
    observed_time: item.observed_time?.toISOString() ?? null,
    time_status: item.time_status,
    sensitivity: item.sensitivity,
    version: item.version,
    supersedes_id: item.supersedes_id,
    conflict_group_id: item.conflict_group_id,
    evidence_retained: evidenceRetained,
    evidence_refs: evidence.map((row) => ({
      excerpt: row.excerpt,
      locator: row.locator,
      capture_id: row.capture_id,
      source_resource_id: row.source_resource_id,
      source_session_id: row.source_session_id,
      source_message_id: row.source_message_id,
      source_artifact_id: row.source_artifact_id,
    })),
    created_at: item.created_at.toISOString(),
  };
}

export function serializeReceipt(input: {
  receipt: ReceiptRow;
  proposalId: string;
  proposalRevision: number;
  undoAllowed: boolean;
  undoLimits: readonly string[];
}): MemoryReceipt {
  const { receipt: row } = input;
  const rawChanges = Array.isArray(row.changes)
    ? (row.changes as Array<Record<string, unknown>>)
    : [];
  const decisions = rawChanges.map((change) => ({
    proposal_item_id: String(change.proposal_item_id ?? ""),
    decision: (change.decision as MemoryDecision | undefined) ?? "accept",
    memory_item_id:
      typeof change.memory_item_id === "string" ? change.memory_item_id : null,
  }));
  const keptOldItemIds = decisions
    .filter((entry) => entry.decision === "keep_old")
    .map((entry) => entry.proposal_item_id);
  const appliedItemCount = decisions.filter(
    (entry) => entry.decision !== "keep_old" && entry.decision !== "skip",
  ).length;
  return {
    contract_version: CONTRACT_VERSION,
    commit_id: row.commit_id,
    operation_key: row.operation_key,
    proposal_id: input.proposalId,
    proposal_revision: input.proposalRevision,
    status: row.status,
    contact_decision: row.contact_decision,
    created_person_id: row.created_person_id,
    person_display_label: row.person_display_label,
    created_relationship_context_id: row.created_relationship_context_id,
    undo_contact_outcome: row.undo_contact_outcome ?? null,
    undo_context_outcome: row.undo_context_outcome ?? null,
    item_count: row.item_count,
    applied_item_count: appliedItemCount,
    created_item_ids: row.created_item_ids,
    updated_item_ids: row.updated_item_ids,
    skipped_item_ids: row.skipped_item_ids,
    kept_old_item_ids: keptOldItemIds,
    decisions,
    undo: {
      token: row.undo_token,
      allowed: input.undoAllowed,
      limits: [...input.undoLimits],
    },
    projection_status: row.projection_status,
    created_at: row.created_at.toISOString(),
    undone_at: row.undone_at?.toISOString() ?? null,
  };
}

/** Resolve or lazily create the authenticated user's own stable subject. */
export async function resolveOwnerSubject(
  client: PoolClient,
  accountId: string,
  userId: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM subjects
     WHERE account_id = $1 AND external_ref = $2 AND status = 'active'
     FOR UPDATE`,
    [accountId, `workspace-owner:${userId}`],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const user = await client.query<{ display_name: string; status: string }>(
    `SELECT display_name, status FROM users WHERE account_id = $1 AND id = $2`,
    [accountId, userId],
  );
  if (user.rows[0]?.status !== "active") {
    throw new Error("The authenticated user is not active.");
  }
  const id = randomUUID();
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO subjects(id, account_id, external_ref, display_label, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (account_id, external_ref) DO UPDATE
       SET display_label = EXCLUDED.display_label
     RETURNING id`,
    [id, accountId, `workspace-owner:${userId}`, user.rows[0].display_name],
  );
  return inserted.rows[0]!.id;
}

/** Deterministic contact key so a concurrent duplicate create fails closed. */
export function contactExternalRef(
  displayLabel: string,
  clue: { type: string; value: string } | null,
): string {
  if (!clue) return `memory-contact:${randomUUID()}`;
  return `memory-contact:${sha256(`${clue.type}:${clue.value.normalize("NFKC").toLowerCase()}`)}`;
}

export interface ResolvedContactStatus {
  status: "resolved" | "ambiguous" | "pending";
  personId: string | null;
  displayLabel: string | null;
}

export interface IdentityBindingInput {
  contactDecision: "existing" | "new" | "none";
  personId: string | null;
  contextId: string | null;
  identityAuthority: "tentative" | "stable_handle" | "human_selection";
  identityClue: { type: string; value: string } | null;
  newContactLabel: string | null;
}

export interface IdentityBinding {
  personId: string | null;
  contextId: string | null;
  displayLabel: string | null;
  status: "resolved" | "ambiguous" | "pending";
  authority: "tentative" | "stable_handle" | "human_selection";
}

async function subjectLabel(
  client: DatabaseClient,
  accountId: string,
  personId: string,
): Promise<{ id: string; display_label: string } | null> {
  const result = await client.query<{ id: string; display_label: string }>(
    `SELECT id, display_label FROM subjects
     WHERE account_id = $1 AND id = $2 AND status = 'active'`,
    [accountId, personId],
  );
  return result.rows[0] ?? null;
}

async function duplicateNameCount(
  client: DatabaseClient,
  accountId: string,
  displayLabel: string,
): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM subjects
     WHERE account_id = $1 AND status = 'active'
       AND lower(display_label) = lower($2)`,
    [accountId, displayLabel],
  );
  return result.rows[0]?.count ?? 0;
}

export async function currentStableHandleOwner(
  client: DatabaseClient,
  accountId: string,
  clue: { type: string; value: string },
): Promise<string | null> {
  const normalized = normalizeIdentityHandle(clue.type as IdentityHandleType, clue.value);
  if (!normalized) return null;
  const result = await client.query<{ subject_id: string; source_resource_id: string | null }>(
    `SELECT handles.subject_id, handles.source_resource_id FROM identity_handles handles
     JOIN subjects subject ON subject.account_id = handles.account_id AND subject.id = handles.subject_id AND subject.status = 'active'
     LEFT JOIN source_resources resource ON resource.account_id = handles.account_id AND resource.id = handles.source_resource_id
     LEFT JOIN source_retention_receipts receipt ON receipt.account_id = resource.account_id AND receipt.capture_id = resource.capture_id
     WHERE handles.account_id = $1 AND handles.handle_type = $2 AND handles.normalized_value_hash = $3
       AND handles.status = 'confirmed' AND (handles.valid_until IS NULL OR handles.valid_until > now())
       AND (handles.source_resource_id IS NULL OR (resource.processing_state <> 'deleted'
         AND receipt.authorization_state = 'authorized' AND (receipt.authorization_expires_at IS NULL OR receipt.authorization_expires_at > now())))
     ORDER BY handles.id LIMIT 2 FOR SHARE OF handles, subject`,
    [accountId, clue.type, sha256(normalized)],
  );
  if (result.rows.length !== 1) return null;
  const owner = result.rows[0]!;
  if (owner.source_resource_id) {
    const source = await client.query(`SELECT resource.id FROM source_resources resource
      JOIN source_retention_receipts receipt ON receipt.account_id = resource.account_id AND receipt.capture_id = resource.capture_id
      WHERE resource.account_id = $1 AND resource.id = $2 AND resource.processing_state <> 'deleted'
        AND receipt.authorization_state = 'authorized' AND (receipt.authorization_expires_at IS NULL OR receipt.authorization_expires_at > now())
      FOR SHARE OF resource, receipt`, [accountId, owner.source_resource_id]);
    if (!source.rows[0]) return null;
  }
  return owner.subject_id;
}

/**
 * Resolve the reviewed contact binding. Only current stable-handle authority or
 * an authenticated human selection creates a resolved existing target; a
 * tentative model name stays a draft and never auto-binds. Duplicate display
 * names do not reject an explicit human selection.
 */
export async function resolveIdentityBinding(
  client: DatabaseClient,
  accountId: string,
  input: IdentityBindingInput,
): Promise<IdentityBinding> {
  if (input.contactDecision === "none") {
    return {
      personId: null,
      contextId: null,
      displayLabel: null,
      status: "pending",
      authority: "tentative",
    };
  }

  const verifyContext = async (personId: string, contextId: string | null) => {
    if (!contextId) return;
    const result = await client.query<{ id: string }>(
      `SELECT id FROM assignments
       WHERE account_id = $1 AND id = $2 AND subject_id = $3 AND status = 'active'`,
      [accountId, contextId, personId],
    );
    if (!result.rows[0]) {
      throw new ApiError(
        409,
        "MEMORY_RELATIONSHIP_CONTEXT_NOT_FOUND",
        "The relationship context is not active for this contact.",
      );
    }
  };

  if (input.contactDecision === "new") {
    if (input.identityClue) {
      const owner = await currentStableHandleOwner(client, accountId, input.identityClue);
      if (owner) {
        throw new ApiError(
          409,
          "MEMORY_CONTACT_ALREADY_EXISTS",
          "A confirmed contact already owns this identity clue; review it instead of creating a duplicate.",
          { existing_person_id: owner },
        );
      }
    }
    const label = input.newContactLabel?.trim() ?? null;
    if (!label) {
      throw new ApiError(
        409,
        "MEMORY_CONTACT_DETAILS_REQUIRED",
        "A new-contact draft needs a source-grounded display label.",
      );
    }
    const duplicates = await duplicateNameCount(client, accountId, label);
    return {
      personId: null,
      contextId: null,
      displayLabel: label,
      status: duplicates > 0 ? "ambiguous" : "pending",
      authority: "tentative",
    };
  }

  const authority = input.identityAuthority;
  if (authority === "stable_handle") {
    if (!input.identityClue) {
      throw new ApiError(
        409,
        "MEMORY_STABLE_HANDLE_REQUIRED",
        "Stable-handle authority needs the exact current identity clue.",
      );
    }
    const owner = await currentStableHandleOwner(client, accountId, input.identityClue);
    if (!owner) {
      throw new ApiError(
        409,
        "MEMORY_STABLE_HANDLE_NOT_FOUND",
        "No current confirmed handle matches this identity clue.",
      );
    }
    const subject = await subjectLabel(client, accountId, owner);
    if (!subject) {
      throw new ApiError(409, "MEMORY_CONTACT_NOT_FOUND", "The handle owner is not active.");
    }
    await verifyContext(owner, input.contextId);
    return {
      personId: owner,
      contextId: input.contextId,
      displayLabel: subject.display_label,
      status: "resolved",
      authority,
    };
  }
  if (authority === "human_selection") {
    if (!input.personId) {
      throw new ApiError(
        409,
        "MEMORY_CONTACT_REQUIRED",
        "A human selection needs the exact contact id.",
      );
    }
    const subject = await subjectLabel(client, accountId, input.personId);
    if (!subject) {
      throw new ApiError(409, "MEMORY_CONTACT_NOT_FOUND", "The selected contact is not active.");
    }
    if (input.identityClue) {
      const owner = await currentStableHandleOwner(client, accountId, input.identityClue);
      if (owner && owner !== input.personId) {
        throw new ApiError(
          409,
          "MEMORY_CONTACT_OWNER_CONFLICT",
          "The identity clue currently belongs to another contact.",
          { existing_person_id: owner },
        );
      }
    }
    await verifyContext(input.personId, input.contextId);
    return {
      personId: input.personId,
      contextId: input.contextId,
      displayLabel: subject.display_label,
      status: "resolved",
      authority,
    };
  }

  // Tentative: keep a draft target, never assert a resolved identity. The
  // target's own display label counts once, so ambiguity needs more than one.
  const personId = input.personId;
  const label = personId
    ? (await subjectLabel(client, accountId, personId))?.display_label ?? input.newContactLabel
    : input.newContactLabel;
  const duplicates = label
    ? await duplicateNameCount(client, accountId, label)
    : 0;
  if (personId) await verifyContext(personId, input.contextId);
  const ambiguous = personId ? duplicates > 1 : duplicates > 0;
  return {
    personId,
    contextId: personId ? input.contextId : null,
    displayLabel: label,
    status: ambiguous ? "ambiguous" : "pending",
    authority: "tentative",
  };
}

/**
 * contact_status is server-derived from the account directory, never from a
 * model or browser claim. A name-only match stays a pending draft rather than
 * an asserted identity, and duplicates are ambiguous.
 */
export async function deriveContactStatus(
  client: DatabaseClient,
  accountId: string,
  personId: string | null,
  displayLabel: string | null,
): Promise<ResolvedContactStatus> {
  if (personId) {
    const subject = await client.query<{ id: string; display_label: string }>(
      `SELECT id, display_label FROM subjects
       WHERE account_id = $1 AND id = $2 AND status = 'active'`,
      [accountId, personId],
    );
    const row = subject.rows[0];
    if (!row) return { status: "pending", personId: null, displayLabel };
    const duplicates = await client.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count FROM subjects
       WHERE account_id = $1 AND status = 'active'
         AND lower(display_label) = lower($2)`,
      [accountId, row.display_label],
    );
    return {
      status: (duplicates.rows[0]?.count ?? 0) > 1 ? "ambiguous" : "resolved",
      personId: row.id,
      displayLabel: row.display_label,
    };
  }
  if (displayLabel?.trim()) {
    const duplicates = await client.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count FROM subjects
       WHERE account_id = $1 AND status = 'active'
         AND lower(display_label) = lower($2)`,
      [accountId, displayLabel.trim()],
    );
    return {
      status: (duplicates.rows[0]?.count ?? 0) > 0 ? "ambiguous" : "pending",
      personId: null,
      displayLabel: displayLabel.trim(),
    };
  }
  return { status: "pending", personId: null, displayLabel: null };
}

/**
 * Load the authenticated original user message and its ordered image manifest
 * from the durable Session. The caller never supplies source text or artifact
 * IDs; a browser or model cannot fabricate an admitted original.
 */
export async function resolveSessionSourceAuthority(
  client: DatabaseClient,
  auth: AuthContext,
  sessionId: string | null,
  messageId: string | null,
  options: { lock?: boolean } = {},
): Promise<MemorySourceAuthority> {
  if (!sessionId) return emptySourceAuthority();
  const lock = options.lock === true;
  const session = await client.query<{
    created_by_user_id: string;
    deleted_at: Date | null;
    expires_at: Date;
    payload: AgentSessionPayload | null;
  }>(
    `SELECT created_by_user_id, deleted_at, expires_at, payload
     FROM agent_sessions
     WHERE account_id = $1 AND id = $2
     ${lock ? "FOR SHARE" : ""}`,
    [auth.accountId, sessionId],
  );
  const row = session.rows[0];
  if (!row || row.created_by_user_id !== auth.userId) {
    throw new ApiError(
      404,
      "MEMORY_SOURCE_SESSION_NOT_FOUND",
      "The referenced conversation Session is not available to this user.",
    );
  }
  if (row.deleted_at) {
    throw new ApiError(
      410,
      "MEMORY_SOURCE_SESSION_DELETED",
      "The referenced conversation Session was deleted.",
    );
  }
  if (row.expires_at.valueOf() <= Date.now()) {
    throw new ApiError(
      410,
      "MEMORY_SOURCE_SESSION_EXPIRED",
      "The referenced conversation Session expired; its temporary source is no longer available.",
    );
  }
  const payload = row.payload;
  if (!payload) {
    throw new ApiError(
      409,
      "MEMORY_SOURCE_SESSION_UNAVAILABLE",
      "The referenced conversation Session no longer retains its source payload.",
    );
  }
  const humanMessages = payload.turns.flatMap(turn => [turn,
    ...(turn.steeredMessages ?? []).map(message => ({ ...message, response: turn.response })),
  ]);
  const turn = messageId
    ? humanMessages.find((candidate) => candidate.id === messageId)
    : humanMessages[humanMessages.length - 1];
  if (messageId && !turn) {
    throw new ApiError(
      404,
      "MEMORY_SOURCE_MESSAGE_NOT_FOUND",
      "The referenced user message is not part of this Session.",
    );
  }
  const stored = turn
    ? await client.query<{
        image_index: number;
        attachment_id: string;
        content_hash: string;
      }>(
        `SELECT image_index, attachment_id, content_hash
         FROM conversation_message_images
         WHERE account_id = $1 AND session_id = $2 AND message_id = $3
           AND expires_at > now()
         ORDER BY image_index
         ${lock ? "FOR SHARE" : ""}`,
        [auth.accountId, sessionId, turn.id],
      )
    : { rows: [] as Array<{ image_index: number; attachment_id: string; content_hash: string }> };
  const artifacts: MemoryAdmittedArtifact[] = [];
  const expectedImages = turn?.images ?? [];
  if (stored.rows.length !== expectedImages.length) {
    throw new ApiError(
      409,
      "MEMORY_SOURCE_IMAGES_UNAVAILABLE",
      "The admitted message images no longer match the immutable submitted manifest.",
    );
  }
  for (const image of stored.rows) {
    const expected = expectedImages[image.image_index];
    if (
      !expected
      || expected.attachment_id !== image.attachment_id
      || expected.content_hash !== image.content_hash
    ) {
      throw new ApiError(
        409,
        "MEMORY_SOURCE_IMAGE_ORDER_CHANGED",
        "The admitted image order or digest no longer matches this message.",
      );
    }
  }
  expectedImages.forEach((image, index) => {
    artifacts.push({
      artifactId: `conversation-image-${turn!.id}-${index}-${image.attachment_id}`,
      kind: "image",
      sessionId,
      messageId: turn!.id,
      captureId: null,
      sourceResourceId: null,
      evidenceFragmentId: null,
      contentHash: image.content_hash,
      captureVersion: null,
    });
  });
  artifacts.push({
    artifactId: `${sessionId}:message:${turn?.id ?? ""}`,
    kind: "text",
    sessionId,
    messageId: turn?.id ?? null,
    captureId: null,
    sourceResourceId: null,
    evidenceFragmentId: null,
    contentHash: turn ? sha256(turn.objective) : null,
    captureVersion: null,
  });
  return {
    text: turn?.objective ?? null,
    artifacts,
    sessionId,
    messageId: turn?.id ?? null,
    sourceTaskId: turn?.response.taskID ?? null,
    captureIds: [],
    messageTextHash: turn ? sha256(turn.objective) : null,
    imageManifest: expectedImages.map((image, index) => ({
      index,
      attachmentId: image.attachment_id,
      contentHash: image.content_hash,
    })),
    captureVersion: null,
    captureSubjectId: null,
    captureContextId: null,
  };
}

/** Stable fingerprint of the admitted source revisions bound at stage time. */
export function sourceRevisionHash(authority: MemorySourceAuthority): string {
  return sha256(
    JSON.stringify({
      session: authority.sessionId,
      message: authority.messageId,
      messageTextHash: authority.messageTextHash,
      imageManifest: authority.imageManifest,
      capture: [
        authority.captureVersion,
        authority.captureSubjectId,
        authority.captureContextId,
      ],
    }),
  );
}

export interface SourceBinding {
  sessionIds: string[];
  captureIds: string[];
  artifactIds: string[];
}

export function sourceBindingFor(items: readonly {
  source_session_id: string | null;
  capture_id: string | null;
  source_artifact_id: string | null;
}[]): SourceBinding {
  const sessionIds = new Set<string>();
  const captureIds = new Set<string>();
  const artifactIds = new Set<string>();
  for (const item of items) {
    if (item.source_session_id) sessionIds.add(item.source_session_id);
    if (item.capture_id) captureIds.add(item.capture_id);
    if (item.source_artifact_id) artifactIds.add(item.source_artifact_id);
  }
  return {
    sessionIds: [...sessionIds],
    captureIds: [...captureIds],
    artifactIds: [...artifactIds],
  };
}

/**
 * Race-safe source revalidation. Row locks are taken before the revocation
 * ledger is read, so a concurrent explicit delete either lands before this
 * check (and is seen) or waits and then revokes the derived evidence after.
 * Natural TTL is not in the ledger and does not block a pending write.
 */
export async function lockAndAssertSourceAuthority(
  client: PoolClient,
  accountId: string,
  binding: SourceBinding,
): Promise<void> {
  if (binding.sessionIds.length > 0) {
    const sessions = await client.query<{ id: string }>(
      `SELECT id FROM agent_sessions
       WHERE account_id = $1 AND id = ANY($2::uuid[])
       FOR SHARE`,
      [accountId, binding.sessionIds],
    );
    if (sessions.rows.length !== binding.sessionIds.length) {
      throw new ApiError(
        409,
        "MEMORY_SOURCE_REVOKED",
        "A bound conversation source is no longer available.",
      );
    }
  }
  if (binding.captureIds.length > 0) {
    const captures = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM captures
       WHERE account_id = $1 AND id = ANY($2::uuid[])
       FOR SHARE`,
      [accountId, binding.captureIds],
    );
    if (
      captures.rows.length !== binding.captureIds.length
      || captures.rows.some((row) => row.status !== "active")
    ) {
      throw new ApiError(
        409,
        "MEMORY_SOURCE_REVOKED",
        "A bound capture source was deleted before this commit.",
      );
    }
  }
  const revoked = await client.query<{ source_kind: string; source_id: string }>(
    `SELECT source_kind, source_id FROM memory_source_revocations
     WHERE account_id = $1
       AND (
         (source_kind = 'session' AND source_id = ANY($2::text[]))
         OR (source_kind = 'capture' AND source_id = ANY($3::text[]))
         OR (source_kind = 'artifact' AND source_id = ANY($4::text[]))
       )`,
    [
      accountId,
      binding.sessionIds,
      binding.captureIds,
      binding.artifactIds,
    ],
  );
  if (revoked.rows.length > 0) {
    throw new ApiError(
      409,
      "MEMORY_SOURCE_REVOKED",
      "A bound source was explicitly deleted or rebound before this commit.",
      { revoked: revoked.rows.map((row) => row.source_kind) },
    );
  }
}

export async function revokedSourceKeys(
  client: DatabaseClient,
  accountId: string,
  binding: SourceBinding,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const hasAny =
    binding.sessionIds.length > 0
    || binding.captureIds.length > 0
    || binding.artifactIds.length > 0;
  if (!hasAny) return keys;
  const revoked = await client.query<{ source_kind: string; source_id: string }>(
    `SELECT source_kind, source_id FROM memory_source_revocations
     WHERE account_id = $1
       AND (
         (source_kind = 'session' AND source_id = ANY($2::text[]))
         OR (source_kind = 'capture' AND source_id = ANY($3::text[]))
         OR (source_kind = 'artifact' AND source_id = ANY($4::text[]))
       )`,
    [
      accountId,
      binding.sessionIds,
      binding.captureIds,
      binding.artifactIds,
    ],
  );
  for (const row of revoked.rows) keys.add(`${row.source_kind}:${row.source_id}`);
  return keys;
}

export function artifactForLocator(
  authority: MemorySourceAuthority,
  locator: MemorySourceLocator,
): MemoryAdmittedArtifact | null {
  if (locator.kind === "image_region") {
    return (
      authority.artifacts.find(
        (artifact) =>
          artifact.kind === "image" && artifact.artifactId === locator.artifact_id,
      ) ?? null
    );
  }
  if (locator.kind === "message") {
    return (
      authority.artifacts.find(
        (artifact) =>
          artifact.kind === "text"
          && (locator.message_id === null
            || artifact.messageId === locator.message_id),
      ) ?? null
    );
  }
  if (locator.kind === "document") {
    return (
      authority.artifacts.find(
        (artifact) =>
          locator.source_resource_id !== null
          && artifact.sourceResourceId === locator.source_resource_id,
      ) ?? null
    );
  }
  return null;
}

/**
 * Accepted Memory changes immediately invalidate derived understanding so a
 * fresh Session cannot read the superseded Wiki/index version while the
 * projection outbox rebuilds behind it.
 */
export async function invalidateDerivedKnowledge(
  client: PoolClient,
  accountId: string,
  scope: { subjectId: string | null; relationshipContextId: string | null },
): Promise<void> {
  if (!scope.subjectId && !scope.relationshipContextId) return;
  await client.query(
    `UPDATE knowledge_snapshots
     SET status = 'superseded'
     WHERE account_id = $1
       AND status IN ('published', 'draft', 'abstained')
       AND (
         ($2::uuid IS NOT NULL AND subject_id = $2)
         OR ($3::uuid IS NOT NULL AND assignment_id = $3)
       )`,
    [accountId, scope.subjectId, scope.relationshipContextId],
  );
  await client.query(
    `UPDATE context_manifests
     SET status = 'superseded'
     WHERE account_id = $1
       AND status = 'active'
       AND (
         ($2::uuid IS NOT NULL AND subject_id = $2)
         OR ($3::uuid IS NOT NULL AND assignment_id = $3)
       )`,
    [accountId, scope.subjectId, scope.relationshipContextId],
  );
}

export async function enqueueProjectionJob(
  client: PoolClient,
  accountId: string,
  scope: { subjectId: string | null; relationshipContextId: string | null },
  reason:
    | "memory_committed"
    | "memory_undone"
    | "memory_corrected"
    | "memory_deleted"
    | "source_invalidated",
): Promise<void> {
  await client.query(
    `INSERT INTO memory_projection_jobs(
       id, account_id, subject_id, relationship_context_id, reason
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      randomUUID(),
      accountId,
      scope.subjectId,
      scope.relationshipContextId,
      reason,
    ],
  );
}
