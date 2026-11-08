import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import * as contracts from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";

// New protocol contract tests: absent namespace members fail Vitest assertions,
// not module resolution/production TypeScript. No new wire is implemented here.
function schema(name: string): TSchema {
  const value: unknown = Reflect.get(contracts, name);
  expect(value, `new public contract ${name} is not implemented`).toBeTypeOf("object");
  return value as TSchema;
}
const id = "55555555-5555-4555-8555-555555555555", scope = "33333333-3333-4333-8333-333333333333";
const descriptor = { sha256: "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c",
  utf8_bytes: 2, utf16_code_units: 1, unicode_scalar_count: 1 };
const reference = { reference_version: 1, content_protocol: "literal-v2", content_manifest_digest: "a".repeat(64), descriptor,
  target: { kind: "proposal_item", item_id: id, item_added_revision: 2, field: "display_text" } };
const preview = { preview_version: 1, text_preview: "é", reference,
  coverage: { status: "complete", start: 0, end: 1, total_utf16_code_units: 1, total_utf8_bytes: 2 } };
const page = { page_version: 1, reference, offset: 0 };
const entry = { purpose: "people", person_id: "88888888-8888-4888-8888-888888888888", relationship_context_id: null,
  source_session_id: null, pursuit_id: null, pursuit_role_id: null, pursuit_role_evidence_fragment_id: null,
  pursuit_capture_id: null, pursuit_capture_version: null };
function draftReference() {
  return { ...reference, content_manifest_digest: null,
    target: { kind: "review_draft", draft_id: "77777777-7777-4777-8777-777777777777", draft_revision: 3,
      review_scope_id: scope, item_id: id, field: "edited_text" } };
}
function reviewItem() {
  return { content_protocol: "literal-v2", id, scope: "self", subject_kind: "owner_self", relationship_kind: "none",
    operation: "add", statement_kind: "fact", display_text_preview: preview, original_display_text_preview: {
      ...preview, reference: { ...reference, target: { ...reference.target, field: "original_display_text" } } },
    source_excerpt_preview: { ...preview, reference: { ...reference, target: { ...reference.target, field: "source_excerpt" } } },
    previous_memory: null, previous_memory_item_id: null, previous_revision: null, subject_id: null,
    relationship_context_id: null, speaker: null, reporter: null, valid_time: null, observed_time: null,
    time_status: "unknown", sensitivity: "normal", admission_status: "eligible", judgment_kind: "ordinary",
    judgment_reason: null, default_selected: true, reason: "Synthetic explicit review", source_locator: {
      kind: "message", session_id: null, message_id: "99999999-9999-4999-8999-999999999999", character_start: 0, character_end: 1 },
    added_revision: 2, status: "pending" };
}

describe("new literal-v2 public DTO branches", () => {
  it("wraps the existing strict page primitive instead of dropping its new protocol marker", () => {
    const s = schema("MemoryLiteralReviewPageRequestV2Schema");
    expect(Value.Check(s, { content_protocol: "literal-v2", page })).toBe(true);
    expect(Value.Check(contracts.MemoryLiteralPageRequestSchema, { content_protocol: "literal-v2", page })).toBe(false);
    for (const value of [page, { page }, { content_protocol: "literal-v3", page }, { content_protocol: "legacy-v1", page },
      { content_protocol: "literal-v2", page, authorized: true },
      { content_protocol: "literal-v2", page: { ...page, review_credential: "not a body field" } }]) expect(Value.Check(s, value)).toBe(false);
  });

  it("keeps review pages restricted to pending item/draft targets", () => {
    const s = schema("MemoryLiteralReviewPageRequestV2Schema");
    expect(Value.Check(s, { content_protocol: "literal-v2", page: { ...page, reference: draftReference() } })).toBe(true);
    for (const target of [{ kind: "memory_item", item_id: id, item_version: 1, field: "display_text" },
      { kind: "memory_evidence", evidence_id: id, content_version: 1, field: "excerpt" }, { kind: "session_transcript", session_id: id }]) {
      expect(Value.Check(s, { content_protocol: "literal-v2", page: { ...page, reference: { ...reference, target } } })).toBe(false);
    }
  });

  it("requires an independent accepted entry and accepted target on an accepted-page request", () => {
    const s = schema("MemoryLiteralAcceptedPageRequestV2Schema");
    const acceptedPage = { ...page, reference: { ...reference,
      target: { kind: "memory_item", item_id: id, item_version: 1, field: "display_text" } } };
    expect(Value.Check(s, { content_protocol: "literal-v2", entry_scope: entry, page: acceptedPage })).toBe(true);
    expect(Value.Check(s, { content_protocol: "literal-v2", page: acceptedPage })).toBe(false);
    expect(Value.Check(s, { content_protocol: "literal-v2", entry_scope: entry, page })).toBe(false);
    expect(Value.Check(s, { content_protocol: "literal-v2", entry_scope: { ...entry, review_scope_id: scope }, page: acceptedPage })).toBe(false);
    expect(Value.Check(s, { content_protocol: "literal-v2", entry_scope: { ...entry, authorized: true }, page: acceptedPage })).toBe(false);
  });

  it("uses an explicit page response wrapper with no read/confirmation grant", () => {
    const s = schema("MemoryLiteralPageResponseV2Schema");
    const body = { content_protocol: "literal-v2", page: { page_version: 1, reference, text: "é", offset_unit: "utf16_code_unit",
      start: 0, end: 1, total_utf16_code_units: 1, total_utf8_bytes: 2, has_more: false, next_offset: null } };
    expect(Value.Check(s, body)).toBe(true);
    expect(Value.Check(s, { ...body, confirmed: true })).toBe(false);
    expect(Value.Check(s, { ...body, page: { ...body.page, source_text: "synthetic original source" } })).toBe(false);
  });

  it("separates review previews from every old canonical prose field", () => {
    const s = schema("MemoryLiteralReviewItemV2Schema"), value = reviewItem();
    expect(Value.Check(s, value)).toBe(true);
    expect(Value.Check(contracts.MemoryProposalItemSchema, value)).toBe(false);
    for (const key of ["display_text", "original_display_text", "source_excerpt", "previous_text"]) {
      expect(Value.Check(s, { ...value, [key]: "A full value must not masquerade as a preview" })).toBe(false);
    }
    expect(Value.Check(s, { ...value, display_text_preview: { ...preview, text_preview: "x".repeat(257) } })).toBe(false);
    expect(Value.Check(s, { ...value, content_protocol: "literal-v3" })).toBe(false);
  });

  it("represents a shared unfinished draft without embedding its whole edited_text map", () => {
    const s = schema("MemoryLiteralDraftV2Schema");
    const value = { content_protocol: "literal-v2", draft_id: "77777777-7777-4777-8777-777777777777", revision: 3,
      review_scope_id: scope, contact_decision: "none", selected_item_ids: [id], edits: { [id]: {
        ...preview, reference: draftReference() } }, item_decisions: { [id]: "accept" }, updated_at: "2026-11-08T00:00:00.000Z" };
    expect(Value.Check(s, value)).toBe(true);
    expect(Value.Check(s, { ...value, edited_text: { [id]: "hidden unbounded map" } })).toBe(false);
    expect(Value.Check(s, { ...value, confirmed: true })).toBe(false);
  });

  it("limits compact receipt facts to descriptors and real evidence refs, not another prose copy", () => {
    const s = schema("MemoryLiteralReceiptFactsV2Schema");
    const accepted_content = { content_protocol: "literal-v2", content_manifest_digest: "b".repeat(64), final_descriptor: descriptor,
      original_content_protocol: "legacy-v1", original_descriptor: null, reviewed_evidence: [{ evidence_id: id,
        content_protocol: "legacy-v1", content_version: 1, content_manifest_digest: null }] };
    const value = { content_protocol: "literal-v2", changes: [{ proposal_item_id: id, decision: "accept", memory_item_id: id, accepted_content }] };
    expect(Value.Check(s, value)).toBe(true);
    expect(Value.Check(s, { ...value, changes: [{ ...value.changes[0], display_text: "not a compact fact" }] })).toBe(false);
    expect(Value.Check(s, { ...value, changes: [{ ...value.changes[0], accepted_content: { ...accepted_content, original_descriptor: "invented old original" } }] })).toBe(false);
    expect(Value.Check(s, { ...value, changes: [{ proposal_item_id: id, decision: "keep_old", memory_item_id: null, accepted_content: null }] })).toBe(true);
    expect(Value.Check(s, { ...value, changes: [{ proposal_item_id: id, decision: "accept", memory_item_id: id, accepted_content: null }] })).toBe(false);
    expect(Value.Check(s, { ...value, accepted: true })).toBe(false);
  });
});
