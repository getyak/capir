/** Explicit first-slice DTOs. Capture is synchronous and grants no authority. */
import { types } from "node:util";
import { Value } from "@sinclair/typebox/value";
import { captureMemoryLiteralData, encodeMemoryLiteralRequest, freezeMemoryLiteralData,
  MemoryContentError, MemoryLiteralCandidateV2Schema, MemoryLiteralDescriptorSchema,
  MEMORY_LITERAL_UUID, memoryLiteralInvalid, memoryLiteralRecord, requireMemoryLiteral,
  type MemoryProposalStageRequest, type MemoryReviewConfirmationV1 } from "@talent-signal/contracts";

export type LiteralStageRequest = MemoryProposalStageRequest & { content_protocol: "literal-v2" };
export interface LiteralCommitRequest {
  content_protocol: "literal-v2"; idempotency_key: string; expected_proposal_revision: number;
  expected_review_revision: number; contact_decision: "none"; selected_item_ids: string[];
  confirmations: MemoryReviewConfirmationV1[]; reason: string;
}
const uuid = (value: unknown): value is string => typeof value === "string" && MEMORY_LITERAL_UUID.test(value);
const revision = (value: unknown, minimum = 1): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && value >= minimum && value <= 2_147_483_647;
const bounded = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum;

/** Reject proxies before even asking for descriptors. Reflection on a Proxy
 * would otherwise execute its ownKeys/getPrototypeOf traps. */
function rejectHooks(value: unknown): void {
  const seen = new Set<object>(); let nodes = 0;
  function visit(input: unknown, depth: number): void {
    if (++nodes > 20_000 || depth > 24) throw new MemoryContentError("MEMORY_CONTENT_LIMIT");
    if (!input || typeof input !== "object") return;
    if (types.isProxy(input) || seen.has(input)) return memoryLiteralInvalid();
    seen.add(input);
    const proto = Object.getPrototypeOf(input);
    if (Array.isArray(input) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return memoryLiteralInvalid();
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") return memoryLiteralInvalid();
      const slot = Object.getOwnPropertyDescriptor(input, key);
      if (!slot || !("value" in slot)) return memoryLiteralInvalid();
      visit(slot.value, depth + 1);
    }
    seen.delete(input);
  }
  visit(value, 0);
}
export function captureMemoryLiteralWriterData(value: unknown): unknown {
  rejectHooks(value);
  return captureMemoryLiteralData(value);
}
function capture(value: unknown): Record<string, unknown> {
  rejectHooks(value);
  const marker = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "content_protocol") : undefined;
  if (!marker || marker.value !== "literal-v2") throw new MemoryContentError("MEMORY_CONTENT_VERSION_UNSUPPORTED");
  const result = captureMemoryLiteralData(value);
  if (!result || typeof result !== "object" || Array.isArray(result)) return memoryLiteralInvalid();
  encodeMemoryLiteralRequest(result);
  return result as Record<string, unknown>;
}

export function captureMemoryLiteralStageRequest(value: unknown): Readonly<LiteralStageRequest> {
  const request = memoryLiteralRecord(capture(value), ["content_protocol", "idempotency_key", "surface", "session_id",
    "source_message_id", "person_id", "relationship_context_id", "contact_decision", "new_contact", "proposer", "items"]);
  if (!uuid(request.idempotency_key) || !uuid(request.session_id) || !uuid(request.source_message_id)
    || request.surface !== "chat" || request.person_id !== null || request.relationship_context_id !== null
    || request.contact_decision !== "none" || request.new_contact !== null) return memoryLiteralInvalid();
  const proposer = memoryLiteralRecord(request.proposer, ["kind", "name", "version"]);
  if (proposer.kind !== "human" || !bounded(proposer.name, 160) || !bounded(proposer.version, 80)) return memoryLiteralInvalid();
  if (!Array.isArray(request.items) || request.items.length === 0 || request.items.length > 40) return memoryLiteralInvalid();
  for (const value of request.items) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return memoryLiteralInvalid();
    const item = value as Record<string, unknown>;
    requireMemoryLiteral(item.display_text as string, "statement"); requireMemoryLiteral(item.source_excerpt as string, "excerpt");
    if (!Value.Check(MemoryLiteralCandidateV2Schema, item) || item.scope !== "self" || item.operation !== "add"
      || item.subject_id != null || item.relationship_context_id != null || item.previous_memory_item_id != null
      || item.previous_text != null || item.previous_revision != null
      || (item.dependence_kind !== undefined && item.dependence_kind !== "independent_self")) return memoryLiteralInvalid();
    const locator = item.source_locator as Record<string, unknown>;
    if (locator.kind !== "message" || locator.session_id !== request.session_id || locator.message_id !== request.source_message_id) return memoryLiteralInvalid();
  }
  return freezeMemoryLiteralData(request) as unknown as Readonly<LiteralStageRequest>;
}

export function captureMemoryLiteralCommitRequest(value: unknown): Readonly<LiteralCommitRequest> {
  const request = memoryLiteralRecord(capture(value), ["content_protocol", "idempotency_key", "expected_proposal_revision",
    "expected_review_revision", "contact_decision", "selected_item_ids", "confirmations", "reason"]);
  if (!uuid(request.idempotency_key) || !revision(request.expected_proposal_revision) || !revision(request.expected_review_revision, 0)
    || request.contact_decision !== "none" || !bounded(request.reason, 500)
    || !Array.isArray(request.selected_item_ids) || request.selected_item_ids.length === 0 || request.selected_item_ids.length > 200
    || request.selected_item_ids.some(id => !uuid(id)) || new Set(request.selected_item_ids).size !== request.selected_item_ids.length
    || !Array.isArray(request.confirmations) || request.confirmations.length !== request.selected_item_ids.length) return memoryLiteralInvalid();
  const selected = new Set(request.selected_item_ids), confirmed = new Set<unknown>();
  for (const value of request.confirmations) {
    const c = memoryLiteralRecord(value, ["version", "account_id", "actor_user_id", "review_scope_id", "review_revision", "proposal_id",
      "proposal_revision", "entry_scope", "item_id", "item_added_revision", "decision", "previous_item_version", "proposal_manifest_digest", "final", "confirmation_digest"]);
    if (c.version !== "memory-literal-confirmation.v1" || !uuid(c.account_id) || !uuid(c.actor_user_id) || !uuid(c.review_scope_id)
      || !uuid(c.proposal_id) || !uuid(c.item_id) || !revision(c.review_revision, 0) || !revision(c.proposal_revision)
      || !revision(c.item_added_revision) || c.decision !== "accept" || c.previous_item_version !== null
      || !selected.has(c.item_id) || confirmed.has(c.item_id)
      || typeof c.proposal_manifest_digest !== "string" || !/^[a-f0-9]{64}$/u.test(c.proposal_manifest_digest)
      || typeof c.confirmation_digest !== "string" || !/^[a-f0-9]{64}$/u.test(c.confirmation_digest)) return memoryLiteralInvalid();
    const entry = memoryLiteralRecord(c.entry_scope, ["purpose", "person_id", "relationship_context_id", "source_session_id", "pursuit_id",
      "pursuit_role_id", "pursuit_role_evidence_fragment_id", "pursuit_capture_id", "pursuit_capture_version"]);
    if (entry.purpose !== "chat" || !uuid(entry.source_session_id)
      || Object.entries(entry).some(([key, value]) => !["purpose", "source_session_id"].includes(key) && value !== null)) return memoryLiteralInvalid();
    const final = memoryLiteralRecord(c.final, ["kind", "edited_text", "descriptor"]);
    if (final.kind !== "inline") return memoryLiteralInvalid();
    requireMemoryLiteral(final.edited_text as string, "statement");
    if (!Value.Check(MemoryLiteralDescriptorSchema, final.descriptor)) return memoryLiteralInvalid();
    confirmed.add(c.item_id);
  }
  return freezeMemoryLiteralData(request) as unknown as Readonly<LiteralCommitRequest>;
}
