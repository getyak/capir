import { randomUUID } from "node:crypto";

import type {
  MemoryDecision,
  MemoryProposalCandidate,
  MemoryProposalRecord,
  MemoryProposalStageRequest,
  MemoryRelationshipKind,
  MemorySubjectKind,
} from "@talent-signal/contracts";
import type { DatabaseClient } from "../database/pool.js";
import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import { sha256, sha256Bytes } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";
import {
  MEMORY_PROPOSAL_TTL_MS,
  classifyMemoryAdmission,
  classifyTemporalRelation,
  defaultSelectionForChange,
  type MemoryDependence,
} from "./memoryReviewPolicy.js";
import { verifyPendingSourceAuthority } from "./memorySourceVerification.js";
import { recallMemories } from "./memoryReviewRecall.js";
import {
  artifactForLocator,
  loadProposal,
  loadProposalItems,
  memoryTargetSubjectMatches,
  resolveIdentityBinding,
  resolveSessionSourceAuthority,
  revokedSourceKeys,
  sourceBindingFor,
  sourceRevisionHash,
  type IdentityBinding,
  type MemoryItemRow,
  type MemorySourceAuthority,
  type ProposalItemRow,
  type ProposalRow,
} from "./memoryReviewStore.js";

export async function proposalRecord(
  client: DatabaseClient,
  row: ProposalRow,
): Promise<MemoryProposalRecord> {
  const counts = await client.query<{
    item_count: number;
    default_selected_count: number;
  }>(
    `SELECT
       COUNT(*)::integer AS item_count,
       COUNT(*) FILTER (WHERE default_selected AND status = 'pending')::integer
         AS default_selected_count
     FROM memory_proposal_items
     WHERE account_id = $1 AND proposal_id = $2`,
    [row.account_id, row.id],
  );
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
    item_count: counts.rows[0]?.item_count ?? 0,
    default_selected_count: counts.rows[0]?.default_selected_count ?? 0,
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
  };
}

async function loadPreviousTarget(
  client: DatabaseClient,
  auth: AuthContext,
  candidate: MemoryProposalCandidate,
  dependence: MemoryDependence,
): Promise<{ row: MemoryItemRow | null; status: "not_requested" | "valid" | "stale" }> {
  if (candidate.operation === "add" && !candidate.previous_memory_item_id) {
    return { row: null, status: "not_requested" };
  }
  if (!candidate.previous_memory_item_id) {
    return { row: null, status: "stale" };
  }
  const result = await client.query<MemoryItemRow>(
    `SELECT * FROM memory_items WHERE account_id = $1 AND id = $2`,
    [auth.accountId, candidate.previous_memory_item_id],
  );
  const row = result.rows[0];
  if (!row || row.status !== "active") return { row: null, status: "stale" };
  if (row.scope !== dependence.scope) return { row: null, status: "stale" };
  if (!await memoryTargetSubjectMatches(client, auth, row, dependence)) return { row: null, status: "stale" };
  if (row.relationship_context_id !== dependence.relationshipContextId) {
    return { row: null, status: "stale" };
  }
  if (
    (dependence.scope === "self" || dependence.scope === "relationship")
    && row.owner_user_id !== auth.userId
  ) {
    return { row: null, status: "stale" };
  }
  if (
    candidate.previous_revision
    && row.version !== candidate.previous_revision
  ) {
    return { row: null, status: "stale" };
  }
  return { row, status: "valid" };
}

function dependenceFor(
  candidate: MemoryProposalCandidate,
  binding: IdentityBinding,
): MemoryDependence {
  const declared = candidate.dependence_kind;
  if (declared === "contact" || declared === "relationship") {
    const resolvedSubject = binding.status === "resolved" && Boolean(binding.personId);
    const scope = declared === "relationship" ? "relationship" : "person";
    const relationshipKind = declared === "relationship"
      ? (resolvedSubject && binding.contextId ? "resolved_context" : "proposal_target_context")
      : "none";
    return {
      scope,
      subjectKind: resolvedSubject ? "resolved_subject" : "proposal_target",
      subjectId: binding.personId,
      relationshipKind,
      relationshipContextId: declared === "relationship" ? binding.contextId : null,
    };
  }
  if (candidate.scope === "self") {
    const hasContactDependence = Boolean(
      candidate.subject_id || candidate.relationship_context_id,
    );
    return {
      scope: "self",
      subjectKind: hasContactDependence ? "resolved_subject" : "owner_self",
      subjectId: candidate.subject_id ?? null,
      relationshipKind: candidate.relationship_context_id ? "resolved_context" : "none",
      relationshipContextId: candidate.relationship_context_id ?? null,
    };
  }
  const resolvedSubject = binding.status === "resolved" && Boolean(binding.personId);
  const subjectKind: MemorySubjectKind = resolvedSubject
    ? "resolved_subject"
    : "proposal_target";
  const subjectId = binding.personId;
  if (candidate.scope === "person") {
    return {
      scope: "person",
      subjectKind,
      subjectId,
      relationshipKind: "none",
      relationshipContextId: null,
    };
  }
  const resolvedContext = resolvedSubject && Boolean(binding.contextId);
  return {
    scope: "relationship",
    subjectKind,
    subjectId,
    relationshipKind: resolvedContext ? "resolved_context" : "proposal_target_context",
    relationshipContextId: binding.contextId,
  };
}

export interface StagedProposal {
  proposal: MemoryProposalRecord;
  scopeCounts: { self: number; person: number; relationship: number };
  replayed: boolean;
}

async function scopeCounts(
  client: DatabaseClient,
  accountId: string,
  proposalId: string,
): Promise<{ self: number; person: number; relationship: number }> {
  const result = await client.query<{ scope: string; count: number }>(
    `SELECT scope, COUNT(*)::integer AS count
     FROM memory_proposal_items
     WHERE account_id = $1 AND proposal_id = $2 AND status = 'pending'
     GROUP BY scope`,
    [accountId, proposalId],
  );
  const counts = { self: 0, person: 0, relationship: 0 };
  for (const row of result.rows) {
    if (row.scope === "self" || row.scope === "person" || row.scope === "relationship") {
      counts[row.scope] = row.count;
    }
  }
  return counts;
}

/**
 * Stage a bounded, proposal-only Memory review from host-admitted source
 * authority. Exact duplicates and unchanged statements never produce a card.
 * Prohibited inference and ungrounded excerpts never enter the proposal.
 */
export async function stageMemoryProposal(
  client: DatabaseClient,
  auth: AuthContext,
  request: MemoryProposalStageRequest,
  authority: MemorySourceAuthority,
): Promise<StagedProposal | null> {
  const now = new Date();
  const contactDecision = request.contact_decision;
  const newContactLabel = request.new_contact?.display_label?.trim() ?? null;
  const sourceRevision = sourceRevisionHash(authority);
  const effectiveSessionId = authority.sessionId ?? request.session_id ?? null;
  const effectiveMessageId = authority.messageId ?? request.source_message_id ?? null;
  // Without item provenance, source readback must be reconstructible from the
  // host-owned Session/message manifest. Capture-only entries retain items.
  if (request.items.length === 0 && (!authority.sessionId || !authority.messageId)) return null;

  // Host task identity replays only for the same creator, surface, and exact
  // source. A different user's task reference reveals nothing.
  if (request.source_task_id) {
    const existing = await client.query<ProposalRow>(
      `SELECT * FROM memory_proposals
       WHERE account_id = $1 AND source_task_id = $2`,
      [auth.accountId, request.source_task_id],
    );
    const row = existing.rows[0];
    if (row) {
      if (
        row.created_by_user_id !== auth.userId
        || row.surface !== request.surface
        || (row.session_id ?? null) !== effectiveSessionId
        || (row.source_message_id ?? null) !== effectiveMessageId
      ) {
        throw new ApiError(
          409,
          "MEMORY_TASK_SOURCE_CONFLICT",
          "This task reference already staged a different source.",
        );
      }
      const replayItems = await loadProposalItems(client, auth.accountId, row.id);
      const revoked = await revokedSourceKeys(
        client,
        auth.accountId,
        sourceBindingFor(replayItems),
      );
      if (revoked.size > 0) {
        throw new ApiError(
          409,
          "MEMORY_SOURCE_REVOKED",
          "The staged source was deleted; reopen the current source before reviewing.",
        );
      }
      return {
        proposal: await proposalRecord(client, row),
        scopeCounts: await scopeCounts(client, auth.accountId, row.id),
        replayed: true,
      };
    }
  }

  // A new-contact label is grounded in the admitted user text or a specific
  // admitted image locator; it is never asserted as user text.
  if (contactDecision === "new" && newContactLabel) {
    const groundedInText = Boolean(
      authority.text
      && authority.text.normalize("NFKC").includes(newContactLabel.normalize("NFKC")),
    );
    const locator = request.new_contact?.source_locator ?? null;
    const groundedInImage = Boolean(
      locator
      && artifactForLocator(authority, locator)?.kind === "image",
    );
    if (!groundedInText && !groundedInImage) {
      throw new ApiError(
        409,
        "MEMORY_CONTACT_NAME_UNGROUNDED",
        "A draft contact name must come from the admitted user text or an admitted image region.",
      );
    }
  }

  const binding = await resolveIdentityBinding(client, auth.accountId, {
    contactDecision,
    personId: request.person_id ?? null,
    contextId: request.relationship_context_id ?? null,
    identityAuthority: request.identity_authority ?? "tentative",
    identityClue: request.identity_clue ?? null,
    newContactLabel,
  });
  const personId = binding.personId;
  const contextId = binding.contextId;
  const personDisplayLabel = binding.displayLabel;
  const contactStatus = binding.status;
  const relationshipDisplayLabel =
    contactDecision === "new"
      ? request.new_contact?.relationship_context?.trim() || null
      : null;

  const existingTexts = await client.query<{ display_text: string }>(
    `SELECT display_text FROM memory_items
     WHERE account_id = $1 AND status = 'active'
       AND (
         (scope = 'self' AND owner_user_id = $2)
         OR (
           scope = 'relationship' AND owner_user_id = $2
           AND ($3::uuid IS NULL OR subject_id = $3)
           AND ($4::uuid IS NULL OR relationship_context_id = $4)
         )
         OR ($3::uuid IS NOT NULL AND scope = 'person' AND subject_id = $3)
       )`,
    [auth.accountId, auth.userId, personId, contextId],
  );
  const suppressed = await client.query<{ content_hash: string }>(
    `SELECT content_hash FROM memory_proposal_items
     WHERE account_id = $1
       AND status IN ('skipped', 'committed')
       AND (
         (
           $2::uuid IS NOT NULL
           AND source_session_id = $2::uuid
           AND source_message_id IS NOT DISTINCT FROM $3::uuid
         )
         OR (
           $2::uuid IS NULL
           AND (
             source_artifact_id = ANY($4::text[])
             OR capture_id = ANY($5::uuid[])
           )
         )
       )
       AND source_capture_version IS NOT DISTINCT FROM $6::integer`,
    [
      auth.accountId,
      effectiveSessionId,
      effectiveMessageId,
      authority.artifacts.map((artifact) => artifact.artifactId),
      authority.captureIds,
      authority.captureVersion,
    ],
  );
  const knownTexts = new Set(
    existingTexts.rows.map((row) =>
      row.display_text.normalize("NFKC").trim().toLocaleLowerCase(),
    ),
  );
  const suppressedHashes = new Set(suppressed.rows.map((row) => row.content_hash));

  interface PreparedItem {
    scope: "self" | "person" | "relationship";
    subjectKind: MemorySubjectKind;
    subjectId: string | null;
    relationshipKind: MemoryRelationshipKind;
    relationshipContextId: string | null;
    operation: "add" | "update" | "contest";
    statementKind: "fact" | "source_statement" | "user_opinion";
    displayText: string;
    originalDisplayText: string;
    contentHash: string;
    previous: MemoryItemRow | null;
    previousText: string | null;
    previousRevision: number | null;
    previousOwnerUserId: string | null;
    speaker: string | null;
    reporter: string | null;
    validTime: string | null;
    observedTime: string | null;
    timeStatus: "known" | "unknown" | "future" | "past";
    sensitivity: "normal" | "sensitive";
    admissionStatus: "eligible" | "needs_judgment";
    judgmentKind: ProposalItemRow["judgment_kind"];
    admissionReason: string;
    defaultSelected: boolean;
    reason: string;
    sourceExcerpt: string;
    locator: MemoryProposalCandidate["source_locator"];
    captureId: string | null;
    sourceResourceId: string | null;
    evidenceFragmentId: string | null;
    sourceArtifactId: string | null;
    sourceSessionId: string | null;
    sourceMessageId: string | null;
    sourceRevisionHash: string;
    sourceCaptureVersion: number | null;
  }

  const prepared: PreparedItem[] = [];
  for (const candidate of request.items) {
    if (candidate.scope !== "self" && contactDecision === "none") continue;
    const dependence = dependenceFor(candidate, binding);
    const displayText = candidate.display_text.normalize("NFKC").trim();
    if (!displayText) continue;
    const normalized = displayText.toLocaleLowerCase();
    if (knownTexts.has(normalized)) continue;
    const artifact = artifactForLocator(authority, candidate.source_locator);
    if (!authority.sessionId && !artifact) continue;
    const contentHash = sha256(
      [
        dependence.scope,
        dependence.subjectId ?? "",
        dependence.relationshipContextId ?? "",
        normalized,
      ].join("|"),
    );
    if (suppressedHashes.has(contentHash)) continue;
    const previous = await loadPreviousTarget(client, auth, candidate, dependence);
    const relation = classifyTemporalRelation(
      previous.row
        ? { displayText: previous.row.display_text, timeStatus: previous.row.time_status }
        : candidate.previous_text
          ? { displayText: candidate.previous_text, timeStatus: candidate.time_status }
          : null,
      { ...candidate, display_text: displayText },
    );
    if (relation === "no_change") continue;
    // A new future plan is temporally distinct from a current fact: it is a
    // separate add and must never supersede the fact.
    const effectivePrevious = relation === "separate" ? null : previous.row;
    const effectiveOperation = relation === "separate" ? "add" : candidate.operation;
    const contactReferences = [
      binding.displayLabel,
      request.identity_clue?.value,
      request.new_contact?.display_label,
    ].filter((value): value is string => Boolean(value && value.trim().length >= 2));
    const admission = classifyMemoryAdmission(
      { ...candidate, display_text: displayText },
      {
        sourceText: authority.text,
        admittedArtifactIds: authority.artifacts.map((entry) => entry.artifactId),
        existingDisplayTexts: [...knownTexts],
        dependence,
        previousTargetStatus: previous.status,
        contactReferences,
      },
    );
    if (admission.status === "ineligible") continue;
    knownTexts.add(normalized);
    suppressedHashes.add(contentHash);
    prepared.push({
      scope: dependence.scope,
      subjectKind: dependence.subjectKind,
      subjectId: dependence.subjectId,
      relationshipKind: dependence.relationshipKind,
      relationshipContextId: dependence.relationshipContextId,
      operation: effectiveOperation,
      statementKind: candidate.statement_kind,
      displayText,
      originalDisplayText: displayText,
      contentHash,
      previous: effectivePrevious,
      previousText: effectivePrevious?.display_text ?? (effectiveOperation === "add" ? null : candidate.previous_text ?? null),
      previousRevision: effectivePrevious?.version ?? (effectiveOperation === "add" ? null : candidate.previous_revision ?? null),
      previousOwnerUserId: effectivePrevious?.owner_user_id ?? null,
      speaker: candidate.speaker ?? null,
      reporter: candidate.reporter ?? null,
      validTime: candidate.valid_time ?? null,
      observedTime: candidate.observed_time ?? null,
      timeStatus: candidate.time_status,
      sensitivity: candidate.sensitivity,
      admissionStatus: admission.status === "eligible" ? "eligible" : "needs_judgment",
      judgmentKind: admission.judgment,
      admissionReason: admission.reason,
      defaultSelected: defaultSelectionForChange(
        admission.status,
        relation,
        effectiveOperation,
      ),
      reason: candidate.reason,
      sourceExcerpt: candidate.source_excerpt,
      locator: candidate.source_locator,
      captureId: artifact?.captureId ?? null,
      sourceResourceId: artifact?.sourceResourceId ?? null,
      evidenceFragmentId: artifact?.evidenceFragmentId ?? null,
      sourceArtifactId: artifact?.sourceArtifactId ?? artifact?.artifactId ?? null,
      sourceSessionId: authority.sessionId ?? artifact?.sessionId ?? null,
      sourceMessageId: artifact?.messageId ?? effectiveMessageId,
      sourceRevisionHash: sourceRevision,
      sourceCaptureVersion: artifact?.captureVersion ?? null,
    });
  }

  // A source-grounded counterparty is itself a reviewable contact change.
  // Do not manufacture Memory items merely to expose the Add contact card.
  if (prepared.length === 0 && !(request.items.length === 0 && contactDecision === "new" && newContactLabel)) return null;

  const proposalId = randomUUID();
  await client.query(
    `INSERT INTO memory_proposals(
       id, account_id, created_by_user_id, proposer_kind, proposer_name,
       proposer_version, surface, session_id, source_task_id, source_message_id,
       target_person_id, target_relationship_context_id, contact_decision,
       contact_status, identity_authority, person_display_label,
       relationship_display_label, source_revision_hash, source_message_text_hash,
       source_image_manifest, source_capture_version, source_subject_id,
       source_relationship_context_id, target_revision,
       revision, status, expires_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20::jsonb,$21,$22,$23,$24,1,'open',$25)`,
    [
      proposalId,
      auth.accountId,
      auth.userId,
      request.proposer.kind,
      request.proposer.name,
      request.proposer.version,
      request.surface,
      effectiveSessionId,
      request.source_task_id ?? null,
      effectiveMessageId,
      personId,
      contextId,
      contactDecision,
      contactStatus,
      binding.authority,
      personDisplayLabel,
      relationshipDisplayLabel,
      sourceRevision,
      authority.messageTextHash,
      JSON.stringify(authority.imageManifest),
      authority.captureVersion,
      authority.captureSubjectId,
      authority.captureContextId ?? null,
      1,
      new Date(now.valueOf() + MEMORY_PROPOSAL_TTL_MS),
    ],
  );
  for (const item of prepared) {
    await client.query(
      `INSERT INTO memory_proposal_items(
         id, account_id, proposal_id, scope, subject_kind, relationship_kind,
         operation, statement_kind, display_text, original_display_text,
         previous_text, previous_memory_item_id, previous_revision,
         previous_owner_user_id, subject_id, relationship_context_id, speaker,
         reporter, valid_time, observed_time, time_status, sensitivity,
         admission_status, judgment_kind, admission_reason, default_selected,
         reason, source_excerpt, source_excerpt_hash, locator, capture_id,
         source_resource_id, evidence_fragment_id, source_artifact_id,
         source_session_id, source_message_id, source_revision_hash,
         source_capture_version,
         content_hash, added_revision, status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,$31,$32,
               $33,$34,$35,$36,$37,$38,$39,1,'pending')`,
      [
        randomUUID(),
        auth.accountId,
        proposalId,
        item.scope,
        item.subjectKind,
        item.relationshipKind,
        item.operation,
        item.statementKind,
        item.displayText,
        item.originalDisplayText,
        item.previousText,
        item.previous?.id ?? null,
        item.previousRevision,
        item.previousOwnerUserId,
        item.subjectId,
        item.relationshipContextId,
        item.speaker,
        item.reporter,
        item.validTime,
        item.observedTime,
        item.timeStatus,
        item.sensitivity,
        item.admissionStatus,
        item.judgmentKind,
        item.admissionReason,
        item.defaultSelected,
        item.reason,
        item.sourceExcerpt,
        sha256(item.sourceExcerpt),
        JSON.stringify(item.locator),
        item.captureId,
        item.sourceResourceId,
        item.evidenceFragmentId,
        item.sourceArtifactId,
        item.sourceSessionId,
        item.sourceMessageId,
        item.sourceRevisionHash,
        item.sourceCaptureVersion,
        item.contentHash,
      ],
    );
  }
  await appendAudit(
    client,
    { accountId: auth.accountId, actorUserId: auth.userId },
    "memory.proposal_staged",
    "memory_proposal",
    proposalId,
    {
      surface: request.surface,
      contact_decision: contactDecision,
      contact_status: contactStatus,
      target_person_id: personId,
      target_relationship_context_id: contextId,
      item_count: prepared.length,
      default_selected_count: prepared.filter((item) => item.defaultSelected).length,
      source_session_id: authority.sessionId,
      source_message_id: authority.messageId,
    },
  );
  const row = await loadProposal(client, auth.accountId, proposalId);
  if (!row) {
    throw new ApiError(500, "MEMORY_STAGE_FAILED", "The staged proposal could not be read back.");
  }
  return { proposal: await proposalRecord(client, row), scopeCounts: await scopeCounts(client, auth.accountId, proposalId), replayed: false };
}

export interface RebaseResult {
  proposal: MemoryProposalRecord;
  reviewCredential: string | null;
  replayed: boolean;
}

/**
 * Guarded identity rebase. Restoring the same contact keeps pending selections;
 * choosing another person regenerates the relevant items without moving the
 * prior person's memory. Ambiguity is resolved or skipped, never guessed.
 */
export interface RebaseRequest {
  expected_proposal_revision: number;
  contact_decision: "existing" | "new" | "none";
  identity_authority?: "tentative" | "stable_handle" | "human_selection";
  identity_clue?: { type: string; value: string } | null;
  person_id?: string | null;
  relationship_context_id?: string | null;
  new_contact?: { display_label: string; relationship_context: string } | null;
  reason: string;
}

async function loadPendingAndSkippedItems(
  client: DatabaseClient,
  accountId: string,
  proposalId: string,
): Promise<ProposalItemRow[]> {
  return (
    await client.query<ProposalItemRow>(
      `SELECT * FROM memory_proposal_items
       WHERE account_id = $1 AND proposal_id = $2
         AND status IN ('pending', 'skipped')
       ORDER BY added_revision, created_at, id
       FOR UPDATE`,
      [accountId, proposalId],
    )
  ).rows;
}

function itemMatchesTarget(
  item: ProposalItemRow,
  personId: string | null,
  contextId: string | null,
): boolean {
  if (item.scope === "self") return true;
  if (item.subject_id !== personId) return false;
  if (item.scope === "relationship") {
    return item.relationship_context_id === contextId;
  }
  return true;
}

/**
 * Guarded identity rebase. Restoring the same contact keeps the frozen
 * selections; switching target deactivates the prior person's items (keeping
 * them as history) and reactivates items already bound to the new target. New
 * claims for a different person are produced by regenerateMemoryProposal, not
 * by moving the old person's sentences.
 */
async function currentRelationshipLabel(client: DatabaseClient, accountId: string, binding: IdentityBinding, newLabel: string | null | undefined): Promise<string | null> {
  if (!binding.contextId) return newLabel?.trim() || null;
  const rows = await client.query<{display_label:string}>(
    "SELECT display_label FROM assignments WHERE account_id=$1 AND id=$2 AND subject_id=$3 AND status='active'",
    [accountId,binding.contextId,binding.personId]);
  return rows.rows[0]?.display_label ?? null;
}

export async function rebaseMemoryProposal(
  client: DatabaseClient,
  auth: AuthContext,
  proposalId: string,
  request: RebaseRequest,
): Promise<RebaseResult> {
  const proposal = await loadProposal(client, auth.accountId, proposalId, true);
  if (!proposal || proposal.created_by_user_id !== auth.userId) {
    throw new ApiError(404, "MEMORY_NOT_FOUND", "The requested Memory proposal was not found.");
  }
  if (proposal.status !== "open" && proposal.status !== "partially_committed") {
    throw new ApiError(409, "MEMORY_PROPOSAL_CLOSED", "This Memory proposal is no longer open.");
  }
  if (proposal.revision !== request.expected_proposal_revision) {
    throw new ApiError(409, "MEMORY_REVIEW_REBASE_REQUIRED", "The proposal changed before this rebase.", {
      current_proposal_revision: proposal.revision,
    });
  }
  const previousPersonId = proposal.target_person_id;
  const previousContextId = proposal.target_relationship_context_id;
  const binding = await resolveIdentityBinding(client, auth.accountId, {
    contactDecision: request.contact_decision,
    personId: request.person_id ?? null,
    contextId:
      request.relationship_context_id
      ?? (request.person_id && request.person_id === proposal.target_person_id
        ? proposal.target_relationship_context_id
        : null),
    identityAuthority: request.identity_authority ?? proposal.identity_authority,
    identityClue: request.identity_clue ?? null,
    newContactLabel: request.new_contact?.display_label?.trim() ?? null,
  });
  const personId = binding.personId;
  const contextId = binding.contextId;
  const relationshipDisplayLabel = await currentRelationshipLabel(client,auth.accountId,binding,request.new_contact?.relationship_context);

  const sameTarget =
    previousPersonId === personId
    && previousContextId === contextId
    && proposal.contact_decision === request.contact_decision;
  if (sameTarget) {
    return {
      proposal: await proposalRecord(client, proposal),
      reviewCredential: null,
      replayed: true,
    };
  }

  const items = await loadPendingAndSkippedItems(client, auth.accountId, proposalId);
  const requeued: string[] = [];
  const dropped: string[] = [];
  for (const item of items) {
    if (item.scope === "self") {
      if (item.status === "skipped") requeued.push(item.id);
      continue;
    }
    const matches = itemMatchesTarget(item, personId, contextId);
    if (matches && item.status === "skipped") requeued.push(item.id);
    if (!matches && item.status === "pending") dropped.push(item.id);
  }
  if (requeued.length > 0) {
    await client.query(
      `UPDATE memory_proposal_items SET status = 'pending'
       WHERE account_id = $1 AND id = ANY($2::uuid[])`,
      [auth.accountId, requeued],
    );
  }
  if (dropped.length > 0) {
    await client.query(
      `UPDATE memory_proposal_items SET status = 'skipped'
       WHERE account_id = $1 AND id = ANY($2::uuid[])`,
      [auth.accountId, dropped],
    );
  }
  const nextRevision = proposal.revision + 1;
  await client.query(
    `UPDATE memory_proposals
     SET revision = $3, target_person_id = $4, target_relationship_context_id = $5,
         contact_decision = $6, contact_status = $7, identity_authority = $8,
         person_display_label = $9, relationship_display_label = $10,
         rebase_count = rebase_count + 1, updated_at = now()
     WHERE account_id = $1 AND id = $2`,
    [
      auth.accountId,
      proposalId,
      nextRevision,
      personId,
      contextId,
      request.contact_decision,
      binding.status,
      binding.authority,
      binding.displayLabel,
      relationshipDisplayLabel,
    ],
  );
  await client.query(
    `INSERT INTO memory_proposal_rebases(
       id, account_id, proposal_id, from_revision, to_revision, reason,
       previous_person_id, previous_relationship_context_id, person_id,
       relationship_context_id, requeued_item_ids, dropped_item_ids,
       created_by_user_id
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[],$12::uuid[],$13)`,
    [
      randomUUID(),
      auth.accountId,
      proposalId,
      proposal.revision,
      nextRevision,
      request.reason,
      previousPersonId,
      previousContextId,
      personId,
      contextId,
      requeued,
      dropped,
      auth.userId,
    ],
  );
  await appendAudit(
    client,
    { accountId: auth.accountId, actorUserId: auth.userId },
    "memory.proposal_rebased",
    "memory_proposal",
    proposalId,
    {
      from_revision: proposal.revision,
      to_revision: nextRevision,
      previous_person_id: previousPersonId,
      person_id: personId,
      identity_authority: binding.authority,
      requeued_item_ids: requeued,
      dropped_item_ids: dropped,
      reason: request.reason,
    },
  );
  const fresh = await loadProposal(client, auth.accountId, proposalId);
  if (!fresh) {
    throw new ApiError(500, "MEMORY_REBASE_FAILED", "The rebased proposal could not be read back.");
  }
  return {
    proposal: await proposalRecord(client, fresh),
    reviewCredential: null,
    replayed: false,
  };
}

export interface MemoryRegenerationImage {
  artifactId: string;
  imageIndex: number;
  contentType: string;
  contentHash: string;
  dataBase64: string;
}

export interface MemoryRegenerationInput {
  workspaceID: string;
  sourceText: string | null;
  sessionId: string | null;
  messageId: string | null;
  /** Ordered admitted source images with real bytes for the provider. */
  images: readonly MemoryRegenerationImage[];
  targetPersonId: string | null;
  targetContextId: string | null;
  targetDisplayLabel: string | null;
  relationshipDisplayLabel: string | null;
  existingMemoryTexts: readonly string[];
}

/** Governed loader for one admitted original image under current auth. */
export type MemoryRegenerationImageLoader = (input: {
  auth: AuthContext;
  sessionId: string;
  messageId: string;
  imageIndex: number;
}) => Promise<{ media_type: string; content: Uint8Array } | null>;

/** Host-supplied bounded proposer used to regenerate items for a new target. */
export type MemoryProposalRegenerator = (
  input: MemoryRegenerationInput,
) => Promise<readonly MemoryProposalCandidate[]>;

/**
 * Real regenerate path: the bounded proposer runs outside the SQL transaction,
 * then a version-guarded write creates fresh dependent items for the new target
 * and deactivates the prior target's items. Self items are retained.
 */
export async function regenerateMemoryProposal(
  pool: import("pg").Pool,
  auth: AuthContext,
  proposalId: string,
  request: RebaseRequest,
  regenerator: MemoryProposalRegenerator,
  loadImage?: MemoryRegenerationImageLoader,
): Promise<RebaseResult> {
  const prepared = await inTransaction(pool, async (client) => {
    const proposal = await loadProposal(client, auth.accountId, proposalId);
    if (!proposal || proposal.created_by_user_id !== auth.userId) {
      throw new ApiError(404, "MEMORY_NOT_FOUND", "The requested Memory proposal was not found.");
    }
    if (proposal.status !== "open" && proposal.status !== "partially_committed") {
      throw new ApiError(409, "MEMORY_PROPOSAL_CLOSED", "This Memory proposal is no longer open.");
    }
    if (proposal.revision !== request.expected_proposal_revision) {
      throw new ApiError(409, "MEMORY_REVIEW_REBASE_REQUIRED", "The proposal changed before this rebase.");
    }
    const items = await loadPendingAndSkippedItems(client, auth.accountId, proposalId);
    const sourceCheck = await verifyPendingSourceAuthority(
      client,
      auth,
      proposal,
      items,
    );
    if (!sourceCheck.proposalSourceAvailable) {
      throw new ApiError(
        409,
        "MEMORY_SOURCE_UNAVAILABLE",
        "The original admitted source is no longer available to regenerate this proposal.",
      );
    }
    const authority = proposal.session_id
      ? await resolveSessionSourceAuthoritySafe(client, auth, proposal.session_id, proposal.source_message_id)
      : null;
    if (!authority || (!authority.text && authority.artifacts.every((a) => a.kind !== "image"))) {
      throw new ApiError(
        409,
        "MEMORY_REGENERATION_UNAVAILABLE",
        "The original admitted source is no longer available to regenerate this proposal.",
      );
    }
    const binding = await resolveIdentityBinding(client, auth.accountId, {
      contactDecision: request.contact_decision,
      personId: request.person_id ?? null,
      contextId:
      request.relationship_context_id
      ?? (request.person_id && request.person_id === proposal.target_person_id
        ? proposal.target_relationship_context_id
        : null),
      identityAuthority: request.identity_authority ?? proposal.identity_authority,
      identityClue: request.identity_clue ?? null,
      newContactLabel: request.new_contact?.display_label?.trim() ?? null,
    });
    // Governed recall for the exact new target and current proposal purpose.
    // Self is included only when the proposal purpose is private Chat, and a
    // new uncreated target has no applicable business memory yet (an empty
    // target recall, never a broad owner/person query).
    const recallSurface =
      proposal.surface === "chat"
        ? "chat"
        : proposal.surface === "people"
          ? "people"
          : "relationship";
    const recalled = binding.personId
      ? await recallMemories(client, auth, {
          surface: recallSurface,
          person_id: binding.personId,
          relationship_context_id: binding.contextId,
          limit: 50,
        })
      : recallSurface === "chat"
        ? await recallMemories(client, auth, { surface: "chat", limit: 50 })
        : { items: [] as Array<{ display_text: string }> };
    const images: MemoryRegenerationImage[] = [];
    if (authority.sessionId && authority.messageId) {
      for (const artifact of authority.artifacts.filter((entry) => entry.kind === "image")) {
        const manifest = authority.imageManifest.find((entry) =>
          artifact.artifactId.endsWith(`-${entry.attachmentId}`),
        );
        if (!manifest) continue;
        const loaded = loadImage
          ? await loadImage({
              auth,
              sessionId: authority.sessionId,
              messageId: authority.messageId,
              imageIndex: manifest.index,
            })
          : null;
        if (!loaded) {
          throw new ApiError(
            409,
            "MEMORY_REGENERATION_IMAGE_UNAVAILABLE",
            "An admitted original image is no longer available for regeneration.",
          );
        }
        const contentHash = sha256Bytes(loaded.content);
        if (contentHash !== manifest.contentHash) {
          throw new ApiError(
            409,
            "MEMORY_SOURCE_IMAGE_ORDER_CHANGED",
            "An admitted image changed before regeneration.",
          );
        }
        images.push({
          artifactId: artifact.artifactId,
          imageIndex: manifest.index,
          contentType: loaded.media_type,
          contentHash,
          dataBase64: Buffer.from(loaded.content).toString("base64"),
        });
      }
    }
    const sameTarget =
      proposal.contact_decision === request.contact_decision
      && proposal.target_person_id === binding.personId
      && proposal.target_relationship_context_id === binding.contextId
      && (proposal.person_display_label ?? null) === (binding.displayLabel ?? null);
    return {
      proposal,
      authority,
      binding,
      sameTarget,
      images,
      relationshipLabel: await currentRelationshipLabel(client,auth.accountId,binding,request.new_contact?.relationship_context),
      existingTexts: recalled.items.map((item) => item.display_text),
      items,
    };
  });

  // Restoring the same identity is a replay: keep the existing draft choices
  // and make no model call.
  if (prepared.sameTarget) {
    return {
      proposal: await proposalRecord(pool, prepared.proposal),
      reviewCredential: null,
      replayed: true,
    };
  }

  // Provider work happens outside the SQL transaction.
  const candidates = await regenerator({
    workspaceID: auth.accountId,
    sourceText: prepared.authority.text,
    sessionId: prepared.authority.sessionId,
    messageId: prepared.authority.messageId,
    images: prepared.images,
    targetPersonId: prepared.binding.personId,
    targetContextId: prepared.binding.contextId,
    targetDisplayLabel: prepared.binding.displayLabel,
    relationshipDisplayLabel: prepared.relationshipLabel,
    existingMemoryTexts: prepared.existingTexts,
  });

  return inTransaction(pool, async (client) => {
    const proposal = await loadProposal(client, auth.accountId, proposalId, true);
    if (!proposal || proposal.created_by_user_id !== auth.userId) {
      throw new ApiError(404, "MEMORY_NOT_FOUND", "The requested Memory proposal was not found.");
    }
    // Version guard: the proposal must not have moved during regeneration.
    if (proposal.revision !== request.expected_proposal_revision) {
      throw new ApiError(409, "MEMORY_REVIEW_REBASE_REQUIRED", "The proposal changed while regenerating.", {
        current_proposal_revision: proposal.revision,
      });
    }
    // Atomic final-ownership guard: before ANY mutation, revalidate the current
    // original source under its row locks and compare it with the admission the
    // provider saw. A source deleted/mutated/expired during inference must
    // reject without changing target, revision, items, or drafts.
    const finalItems = await loadPendingAndSkippedItems(client, auth.accountId, proposalId);
    const finalSource = await verifyPendingSourceAuthority(
      client,
      auth,
      proposal,
      finalItems,
      { lock: true },
    );
    if (!finalSource.proposalSourceAvailable) {
      throw new ApiError(
        409,
        "MEMORY_SOURCE_UNAVAILABLE",
        "The original source changed during regeneration; nothing was written.",
      );
    }
    if (prepared.authority.sessionId && prepared.authority.messageId) {
      const currentAuthority = await resolveSessionSourceAuthority(
        client,
        auth,
        prepared.authority.sessionId,
        prepared.authority.messageId,
        { lock: true },
      );
      if (
        (currentAuthority.messageTextHash ?? null) !== (prepared.authority.messageTextHash ?? null)
        || JSON.stringify(currentAuthority.imageManifest)
          !== JSON.stringify(prepared.authority.imageManifest)
        || sourceRevisionHash(currentAuthority)
          !== sourceRevisionHash(prepared.authority)
      ) {
        throw new ApiError(
          409,
          "MEMORY_SOURCE_UNAVAILABLE",
          "The original source changed during regeneration; nothing was written.",
        );
      }
    } else if (prepared.authority.captureVersion !== null) {
      const capture = await client.query<{
        version: number;
        subject_id: string | null;
        assignment_id: string | null;
        status: string;
      }>(
        `SELECT version, subject_id, assignment_id, status
         FROM captures
         WHERE account_id = $1 AND id = $2
         FOR SHARE`,
        [auth.accountId, prepared.authority.captureIds[0] ?? null],
      );
      const captureRow = capture.rows[0];
      if (
        !captureRow
        || captureRow.status !== "active"
        || captureRow.version !== prepared.authority.captureVersion
        || captureRow.subject_id !== prepared.authority.captureSubjectId
        || captureRow.assignment_id !== prepared.authority.captureContextId
      ) {
        throw new ApiError(
          409,
          "MEMORY_SOURCE_UNAVAILABLE",
          "The original source changed during regeneration; nothing was written.",
        );
      }
    }
    const previousPersonId = proposal.target_person_id;
    const previousContextId = proposal.target_relationship_context_id;
    const binding = await resolveIdentityBinding(client, auth.accountId, {
      contactDecision: request.contact_decision,
      personId: request.person_id ?? null,
      contextId:
      request.relationship_context_id
      ?? (request.person_id && request.person_id === proposal.target_person_id
        ? proposal.target_relationship_context_id
        : null),
      identityAuthority: request.identity_authority ?? proposal.identity_authority,
      identityClue: request.identity_clue ?? null,
      newContactLabel: request.new_contact?.display_label?.trim() ?? null,
    });
    const selfItems = prepared.items.filter((item) => item.scope === "self");
    const dependentItems = prepared.items.filter((item) => item.scope !== "self");
    if (dependentItems.length > 0) {
      await client.query(
        `UPDATE memory_proposal_items SET status = 'skipped'
         WHERE account_id = $1 AND id = ANY($2::uuid[])`,
        [auth.accountId, dependentItems.map((item) => item.id)],
      );
    }
    const nextRevision = proposal.revision + 1;
    const sourceRevision = sourceRevisionHash(prepared.authority);
    await client.query(
      `UPDATE memory_proposals
       SET revision = $3, target_person_id = $4, target_relationship_context_id = $5,
           contact_decision = $6, contact_status = $7, identity_authority = $8,
           person_display_label = $9, relationship_display_label = $10,
           source_revision_hash = $11, rebase_count = rebase_count + 1, updated_at = now()
       WHERE account_id = $1 AND id = $2`,
      [
        auth.accountId,
        proposalId,
        nextRevision,
        binding.personId,
        binding.contextId,
        request.contact_decision,
        binding.status,
        binding.authority,
        binding.displayLabel,
        await currentRelationshipLabel(client,auth.accountId,binding,request.new_contact?.relationship_context),
        sourceRevision,
      ],
    );
    const requeued = selfItems.filter((item) => item.status === "skipped").map((item) => item.id);
    if (requeued.length > 0) {
      await client.query(
        `UPDATE memory_proposal_items SET status = 'pending'
         WHERE account_id = $1 AND id = ANY($2::uuid[])`,
        [auth.accountId, requeued],
      );
    }
    const inserted = await insertRegeneratedItems(
      client,
      auth,
      proposalId,
      nextRevision,
      prepared.authority,
      sourceRevision,
      binding,
      candidates,
      prepared.existingTexts,
    );
    // A persisted draft belongs to the proposal, so identity replacement must
    // move its decision atomically too. Only unchanged self intent survives;
    // new target-dependent items require a fresh explicit selection.
    await client.query(
      `UPDATE memory_review_drafts SET
         contact_decision = $3, revision = revision + 1, updated_at = now(),
         selected_item_ids = ARRAY(SELECT id FROM unnest(selected_item_ids) AS id WHERE id = ANY($4::uuid[])),
         edited_text = COALESCE((SELECT jsonb_object_agg(key, value) FROM jsonb_each(edited_text) WHERE key = ANY($5::text[])), '{}'::jsonb),
         item_decisions = COALESCE((SELECT jsonb_object_agg(key, value) FROM jsonb_each(item_decisions) WHERE key = ANY($5::text[])), '{}'::jsonb)
       WHERE account_id = $1 AND proposal_id = $2`,
      [auth.accountId, proposalId, request.contact_decision,
        selfItems.map((item) => item.id), selfItems.map((item) => item.id)],
    );
    await client.query(
      `INSERT INTO memory_proposal_rebases(
         id, account_id, proposal_id, from_revision, to_revision, reason,
         previous_person_id, previous_relationship_context_id, person_id,
         relationship_context_id, requeued_item_ids, dropped_item_ids,
         created_by_user_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[],$12::uuid[],$13)`,
      [
        randomUUID(),
        auth.accountId,
        proposalId,
        proposal.revision,
        nextRevision,
        request.reason,
        previousPersonId,
        previousContextId,
        binding.personId,
        binding.contextId,
        requeued,
        dependentItems.map((item) => item.id),
        auth.userId,
      ],
    );
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "memory.proposal_regenerated",
      "memory_proposal",
      proposalId,
      {
        from_revision: proposal.revision,
        to_revision: nextRevision,
        person_id: binding.personId,
        identity_authority: binding.authority,
        regenerated_item_ids: inserted,
        reason: request.reason,
      },
    );
    const fresh = await loadProposal(client, auth.accountId, proposalId);
    if (!fresh) {
      throw new ApiError(500, "MEMORY_REBASE_FAILED", "The regenerated proposal could not be read back.");
    }
    return {
      proposal: await proposalRecord(client, fresh),
      reviewCredential: null,
      replayed: false,
    };
  });
}

async function resolveSessionSourceAuthoritySafe(
  client: DatabaseClient,
  auth: AuthContext,
  sessionId: string,
  messageId: string | null,
): Promise<MemorySourceAuthority | null> {
  try {
    return await resolveSessionSourceAuthority(client, auth, sessionId, messageId);
  } catch {
    return null;
  }
}

async function insertRegeneratedItems(
  client: DatabaseClient,
  auth: AuthContext,
  proposalId: string,
  revision: number,
  authority: MemorySourceAuthority,
  sourceRevision: string,
  binding: IdentityBinding,
  candidates: readonly MemoryProposalCandidate[],
  existingTexts: readonly string[],
): Promise<string[]> {
  const known = new Set(
    existingTexts.map((value) => value.normalize("NFKC").trim().toLocaleLowerCase()),
  );
  const inserted: string[] = [];
  for (const candidate of candidates) {
    const dependence = dependenceFor(candidate, binding);
    if (dependence.scope === "self") continue;
    const displayText = candidate.display_text.normalize("NFKC").trim();
    if (!displayText) continue;
    const normalized = displayText.toLocaleLowerCase();
    if (known.has(normalized)) continue;
    const artifact = artifactForLocator(authority, candidate.source_locator);
    if (!authority.sessionId && !artifact) continue;
    const previous = await loadPreviousTarget(client, auth, candidate, dependence);
    const relation = classifyTemporalRelation(
      previous.row
        ? { displayText: previous.row.display_text, timeStatus: previous.row.time_status }
        : candidate.previous_text
          ? { displayText: candidate.previous_text, timeStatus: candidate.time_status }
          : null,
      { ...candidate, display_text: displayText },
    );
    if (relation === "no_change") continue;
    const effectivePrevious = relation === "separate" ? null : previous.row;
    const effectiveOperation = relation === "separate" ? "add" : candidate.operation;
    const admission = classifyMemoryAdmission(
      { ...candidate, display_text: displayText },
      {
        sourceText: authority.text,
        admittedArtifactIds: authority.artifacts.map((entry) => entry.artifactId),
        existingDisplayTexts: [...known],
        dependence,
        previousTargetStatus: previous.status,
        contactReferences: [binding.displayLabel].filter(
          (value): value is string => Boolean(value && value.trim().length >= 2),
        ),
      },
    );
    if (admission.status === "ineligible") continue;
    const itemId = randomUUID();
    known.add(normalized);
    await client.query(
      `INSERT INTO memory_proposal_items(
         id, account_id, proposal_id, scope, subject_kind, relationship_kind,
         operation, statement_kind, display_text, original_display_text,
         previous_text, previous_memory_item_id, previous_revision,
         previous_owner_user_id, subject_id, relationship_context_id, speaker,
         reporter, valid_time, observed_time, time_status, sensitivity,
         admission_status, judgment_kind, admission_reason, default_selected,
         reason, source_excerpt, source_excerpt_hash, locator, capture_id,
         source_resource_id, evidence_fragment_id, source_artifact_id,
         source_session_id, source_message_id, source_revision_hash,
         source_capture_version, content_hash, added_revision, status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,$31,$32,
               $33,$34,$35,$36,$37,$38,$39,$40,'pending')`,
      [
        itemId,
        auth.accountId,
        proposalId,
        dependence.scope,
        dependence.subjectKind,
        dependence.relationshipKind,
        effectiveOperation,
        candidate.statement_kind,
        displayText,
        displayText,
        effectivePrevious?.display_text ?? (effectiveOperation === "add" ? null : candidate.previous_text ?? null),
        effectivePrevious?.id ?? null,
        effectivePrevious?.version ?? (effectiveOperation === "add" ? null : candidate.previous_revision ?? null),
        effectivePrevious?.owner_user_id ?? null,
        dependence.subjectId,
        dependence.relationshipContextId,
        candidate.speaker ?? null,
        candidate.reporter ?? null,
        candidate.valid_time ?? null,
        candidate.observed_time ?? null,
        candidate.time_status,
        candidate.sensitivity,
        admission.status === "eligible" ? "eligible" : "needs_judgment",
        admission.judgment,
        admission.reason,
        defaultSelectionForChange(admission.status, relation, effectiveOperation),
        candidate.reason,
        candidate.source_excerpt,
        sha256(candidate.source_excerpt),
        JSON.stringify(candidate.source_locator),
        artifact?.captureId ?? null,
        artifact?.sourceResourceId ?? null,
        artifact?.evidenceFragmentId ?? null,
        artifact?.sourceArtifactId ?? artifact?.artifactId ?? null,
        authority.sessionId ?? artifact?.sessionId ?? null,
        artifact?.messageId ?? authority.messageId,
        sourceRevision,
        artifact?.captureVersion ?? null,
        sha256(
          [
            dependence.scope,
            dependence.subjectId ?? "",
            dependence.relationshipContextId ?? "",
            normalized,
          ].join("|"),
        ),
        revision,
      ],
    );
    inserted.push(itemId);
  }
  return inserted;
}

export type { MemoryDecision };
