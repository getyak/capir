/** Private engine tickets. None is a wire value, read grant, or publication
 * fence. Factories load canonical sources; engines still own every DB check. */
import { createMemoryAcceptedContentManifest, createMemoryEvidenceManifest,
  describeMemoryText, freezeMemoryLiteralData, memoryLiteralInvalid, requireMemoryLiteral, verifyMemoryReviewConfirmationBatchV1,
  type MemoryCommitRequest, type MemoryProposalStageRequest } from "@talent-signal/contracts";
import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";
import { captureMemoryLiteralStageRequest, captureMemoryLiteralCommitRequest,
  type LiteralCommitRequest } from "./memoryLiteralWriterCapture.js";
import { prepareMemoryLiteralProposalBatch } from "./memoryLiteralPreparation.js";
import { verifyMemoryLiteralProposalRow } from "./memoryLiteralIntegrity.js";
import { resolveSessionSourceAuthority, type MemorySourceAuthority,
  type ProposalItemRow, type ProposalRow, type ReviewScopeRow } from "./memoryReviewStore.js";

declare const brand: unique symbol;
export interface LiteralWriterTicket { readonly [brand]: true }
type Binding = { client: DatabaseClient; account: string; actor: string };
type Prepared = Awaited<ReturnType<typeof prepareMemoryLiteralProposalBatch>>;
type StageMode = Binding & { kind: "stage"; request: MemoryProposalStageRequest;
  authority: MemorySourceAuthority; prepared: Prepared };
export type LiteralCommitMode = Binding & { kind: "commit"; request: MemoryCommitRequest;
  captured: Readonly<LiteralCommitRequest>; scopeID: string };
type OpenMode = Binding & { kind: "open"; proposalID: string };
const tickets = new WeakMap<object, StageMode | LiteralCommitMode | OpenMode>();
function ticket(mode: StageMode | LiteralCommitMode | OpenMode): LiteralWriterTicket {
  const key = Object.freeze({}) as LiteralWriterTicket; tickets.set(key, Object.freeze(mode)); return key;
}
function take(key: LiteralWriterTicket, client: DatabaseClient, auth: AuthContext) {
  const mode = tickets.get(key); tickets.delete(key);
  if (!mode || mode.client !== client || mode.account !== auth.accountId || mode.actor !== auth.userId) return memoryLiteralInvalid();
  return mode;
}
export async function prepareLiteralStage(client: DatabaseClient, auth: AuthContext, input: unknown) {
  const captured = captureMemoryLiteralStageRequest(input);
  const authority = freezeMemoryLiteralData(await resolveSessionSourceAuthority(client, auth,
    captured.session_id ?? null, captured.source_message_id ?? null, { lock: true })) as MemorySourceAuthority;
  const prepared = await prepareMemoryLiteralProposalBatch({ content_protocol: "literal-v2", items: captured.items }, authority, sha256);
  const request: MemoryProposalStageRequest = freezeMemoryLiteralData({ ...captured, source_task_id: null });
  return { request, captured, authority, ticket: ticket({ kind: "stage", client, account: auth.accountId,
    actor: auth.userId, request, authority, prepared }) };
}
export function takeLiteralStage(key: LiteralWriterTicket, client: DatabaseClient, auth: AuthContext,
  request: MemoryProposalStageRequest, authority: MemorySourceAuthority) {
  const mode = take(key, client, auth);
  if (mode.kind !== "stage" || mode.request !== request || mode.authority !== authority) return memoryLiteralInvalid();
  return mode.prepared;
}
export function prepareLiteralCommit(client: DatabaseClient, auth: AuthContext, scopeID: string, input: unknown) {
  const captured = captureMemoryLiteralCommitRequest(input);
  const request: MemoryCommitRequest = { idempotency_key: captured.idempotency_key,
    expected_proposal_revision: captured.expected_proposal_revision, contact_decision: "none",
    selected_item_ids: [...captured.selected_item_ids], edited_text: {}, item_decisions: {}, expected_item_versions: {}, reason: captured.reason };
  for (const c of captured.confirmations) {
    if (c.final.kind !== "inline") return memoryLiteralInvalid();
    request.edited_text[c.item_id] = c.final.edited_text; request.item_decisions[c.item_id] = "accept";
  }
  const frozen = freezeMemoryLiteralData(request);
  return { request: frozen, ticket: ticket({ kind: "commit", client, account: auth.accountId, actor: auth.userId,
    scopeID, request: frozen, captured }) };
}
export function takeLiteralCommit(key: LiteralWriterTicket, client: DatabaseClient, auth: AuthContext,
  scopeID: string, request: MemoryCommitRequest): LiteralCommitMode {
  const mode = take(key, client, auth);
  if (mode.kind !== "commit" || mode.scopeID !== scopeID || mode.request !== request) return memoryLiteralInvalid();
  return mode;
}
export function prepareLiteralOpen(client: DatabaseClient, auth: AuthContext, proposalID: string) {
  return ticket({ kind: "open", client, account: auth.accountId, actor: auth.userId, proposalID });
}
export function takeLiteralOpen(key: LiteralWriterTicket, client: DatabaseClient, auth: AuthContext, proposalID: string) {
  const mode = take(key, client, auth);
  if (mode.kind !== "open" || mode.proposalID !== proposalID) return memoryLiteralInvalid();
}

/** Actual current rows, rather than model declarations, supply every binding
 * other than the human's explicit inline bytes. Validate the whole batch before
 * the engine inserts its first accepted item. */
export async function validateLiteralCommit(mode: LiteralCommitMode, auth: AuthContext, scope: ReviewScopeRow,
  proposal: ProposalRow, selected: readonly ProposalItemRow[]) {
  const { captured } = mode;
  if (scope.revision !== captured.expected_review_revision || scope.purpose !== "chat" || proposal.surface !== "chat"
    || scope.person_id !== null || scope.relationship_context_id !== null || scope.pursuit_id !== null
    || scope.pursuit_role_id !== null || scope.pursuit_role_evidence_fragment_id !== null || scope.pursuit_capture_id !== null
    || scope.pursuit_capture_version !== null || scope.source_session_id !== proposal.session_id
    || scope.source_message_id !== proposal.source_message_id || !scope.source_session_id
    || proposal.created_by_user_id !== auth.userId || proposal.contact_decision !== "none"
    || proposal.target_person_id !== null || proposal.target_relationship_context_id !== null
    || selected.length !== captured.selected_item_ids.length) return memoryLiteralInvalid();
  const current = [];
  for (const item of selected) {
    if (item.content_protocol !== "literal-v2" || item.scope !== "self" || item.subject_kind !== "owner_self"
      || item.relationship_kind !== "none" || item.subject_id !== null || item.relationship_context_id !== null
      || item.operation !== "add" || item.previous_memory_item_id !== null || item.previous_revision !== null
      || item.source_session_id !== scope.source_session_id || item.source_message_id !== scope.source_message_id
      || item.account_id !== auth.accountId || item.proposal_id !== proposal.id || item.status !== "pending") return memoryLiteralInvalid();
    await verifyMemoryLiteralProposalRow({ ...item });
    const supplied = captured.confirmations.find(c => c.item_id === item.id);
    if (!supplied || supplied.final.kind !== "inline") return memoryLiteralInvalid();
    const edited = mode.request.edited_text[item.id];
    if (typeof edited !== "string") return memoryLiteralInvalid();
    requireMemoryLiteral(edited, "statement");
    current.push({ version: "memory-literal-confirmation.v1", account_id: auth.accountId, actor_user_id: auth.userId,
      review_scope_id: scope.id, review_revision: scope.revision, proposal_id: proposal.id, proposal_revision: proposal.revision,
      entry_scope: { purpose: scope.purpose, person_id: scope.person_id, relationship_context_id: scope.relationship_context_id,
        source_session_id: scope.source_session_id, pursuit_id: scope.pursuit_id, pursuit_role_id: scope.pursuit_role_id,
        pursuit_role_evidence_fragment_id: scope.pursuit_role_evidence_fragment_id,
        pursuit_capture_id: scope.pursuit_capture_id, pursuit_capture_version: scope.pursuit_capture_version },
      item_id: item.id, item_added_revision: item.added_revision, decision: "accept", previous_item_version: null,
      proposal_manifest_digest: item.content_manifest_digest,
      final: { kind: "inline", edited_text: edited, descriptor: { sha256: sha256(edited), ...describeMemoryText(edited) } } });
  }
  if (!await verifyMemoryReviewConfirmationBatchV1(captured.confirmations, current, sha256)) return memoryLiteralInvalid();
}

export async function literalAcceptedMetadata(item: ProposalItemRow, finalText: string, evidenceID: string) {
  requireMemoryLiteral(finalText, "statement");
  const proposal = await verifyMemoryLiteralProposalRow({ ...item });
  if (!proposal || item.content_protocol !== "literal-v2") return memoryLiteralInvalid();
  const evidence = await createMemoryEvidenceManifest({ source_excerpt: item.source_excerpt,
    source_revision_hash: proposal.source_revision_hash, source_locator_sha256: proposal.source_locator_sha256,
    message_range: proposal.message_range }, sha256);
  const refs = [{ evidence_id: evidenceID, content_protocol: "literal-v2" as const,
    content_version: 1 as const, content_manifest_digest: evidence.content_manifest_digest }];
  const accepted = await createMemoryAcceptedContentManifest({ display_text: finalText, original_display_text: item.original_display_text,
    original_content_protocol: proposal.original_content_protocol, reviewed_evidence: refs }, sha256);
  return { evidence, accepted, facts: { content_protocol: "literal-v2", content_manifest_digest: accepted.content_manifest_digest,
    final_descriptor: { sha256: sha256(finalText), ...describeMemoryText(finalText) },
    original_content_protocol: proposal.original_content_protocol, original_descriptor: accepted.content_manifest.original_display_text,
    reviewed_evidence: accepted.content_manifest.reviewed_evidence } };
}

export function refuseLiteralDowngrade(items: readonly ProposalItemRow[]): void {
  if (items.some(item => item.content_protocol !== undefined && item.content_protocol !== "legacy-v1")) {
    throw new ApiError(409, "MEMORY_CONTENT_VERSION_UNSUPPORTED", "Reopen this Memory using its explicit content protocol.");
  }
}
