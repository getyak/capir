import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { MemoryLiteralReferenceSchema, MemoryLiteralPreviewSchema,
  MemoryLiteralPageRequestSchema, MemoryLiteralPageSchema } from "@talent-signal/contracts";

const descriptor = { sha256: "a".repeat(64), utf8_bytes: 8, utf16_code_units: 4, unicode_scalar_count: 3 };
const base = { reference_version: 1, descriptor, content_protocol: "literal-v2", content_manifest_digest: "b".repeat(64) };
const proposal = { kind: "proposal_item", item_id: "11111111-1111-4111-8111-111111111111", item_added_revision: 2, field: "display_text" };
const accepted = { kind: "memory_item", item_id: proposal.item_id, item_version: 3, field: "original_display_text" };
const evidence = { kind: "memory_evidence", evidence_id: proposal.item_id, content_version: 1, field: "excerpt" };
const reference = { ...base, target: proposal };

describe("Memory literal wire primitives are explicit bounded references, never source grants", () => {
  it.each([proposal, accepted, evidence])("accepts only an explicit supported target $kind", target => {
    expect(Value.Check(MemoryLiteralReferenceSchema, { ...base, target })).toBe(true);
    expect(Value.Check(MemoryLiteralReferenceSchema, { ...base, target, content_protocol: "legacy-v1", content_manifest_digest: null })).toBe(true);
  });

  it.each(["unknown_protocol", "legacy_fake_digest", "v2_null_digest", "source_transcript", "wrong_field", "unbound_previous", "wrong_owner_revision", "extra_permission", "descriptor_extra", "descriptor_too_large", "hash_array"])(
    "rejects malformed/ambiguous ref %s", kind => {
      const value = structuredClone(reference) as unknown as Record<string, unknown>;
      const target = value.target as Record<string, unknown>;
      if (kind === "unknown_protocol") value.content_protocol = "literal-v3";
      if (kind === "legacy_fake_digest") value.content_protocol = "legacy-v1";
      if (kind === "v2_null_digest") value.content_manifest_digest = null;
      if (kind === "source_transcript") target.kind = "session_transcript";
      if (kind === "wrong_field") target.field = "source_text";
      if (kind === "unbound_previous") target.field = "previous_text";
      if (kind === "wrong_owner_revision") target.item_added_revision = "2";
      if (kind === "extra_permission") target.authorized = true;
      if (kind === "descriptor_extra") (value.descriptor as Record<string, unknown>).source_text = "synthetic source";
      if (kind === "descriptor_too_large") (value.descriptor as Record<string, unknown>).utf8_bytes = 65_537;
      if (kind === "hash_array") value.content_manifest_digest = ["b".repeat(64)];
      expect(Value.Check(MemoryLiteralReferenceSchema, value)).toBe(false);
    });

  it("keeps preview text and coverage explicitly separate from canonical full text", () => {
    const preview = { preview_version: 1, text_preview: "Ａe", reference,
      coverage: { status: "partial", start: 0, end: 2, total_utf16_code_units: 4, total_utf8_bytes: 8 } };
    expect(Value.Check(MemoryLiteralPreviewSchema, preview)).toBe(true);
    expect(Value.Check(MemoryLiteralPreviewSchema, { ...preview, display_text: "Ａe" })).toBe(false);
    expect(Value.Check(MemoryLiteralPreviewSchema, { ...preview, text_preview: "x".repeat(257) })).toBe(false);
    expect(Value.Check(MemoryLiteralPreviewSchema, { ...preview, coverage: { ...preview.coverage, status: "read_by_human" } })).toBe(false);
  });

  it("carries page traversal data without a credential or source permission", () => {
    const request = { page_version: 1, reference, offset: 0 };
    expect(Value.Check(MemoryLiteralPageRequestSchema, request)).toBe(true);
    expect(Value.Check(MemoryLiteralPageRequestSchema, { ...request, review_credential: "not-in-this-payload" })).toBe(false);
    expect(Value.Check(MemoryLiteralPageRequestSchema, { ...request, offset: -1 })).toBe(false);
    expect(Value.Check(MemoryLiteralPageRequestSchema, { ...request, offset: 0.5 })).toBe(false);
    const page = { page_version: 1, reference, text: "Ａe", offset_unit: "utf16_code_unit",
      start: 0, end: 2, total_utf16_code_units: 4, total_utf8_bytes: 8, has_more: true, next_offset: 2 };
    expect(Value.Check(MemoryLiteralPageSchema, page)).toBe(true);
    expect(Value.Check(MemoryLiteralPageSchema, { ...page, source_text: "not a transcript reader" })).toBe(false);
    expect(Value.Check(MemoryLiteralPageSchema, { ...page, text: "x".repeat(16_385) })).toBe(false);
    expect(Value.Check(MemoryLiteralPageSchema, { ...page, next_offset: "2" })).toBe(false);
  });

  it("represents an unconfirmed draft with its own owner/revision and honest null manifest", () => {
    const target = { kind: "review_draft", draft_id: proposal.item_id, draft_revision: 3,
      review_scope_id: "22222222-2222-4222-8222-222222222222", item_id: proposal.item_id, field: "edited_text" };
    const descriptor = { sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      utf8_bytes: 0, utf16_code_units: 0, unicode_scalar_count: 0 };
    const reference = { ...base, target, descriptor, content_manifest_digest: null };
    expect(Value.Check(MemoryLiteralReferenceSchema, reference)).toBe(true);
    expect(Value.Check(MemoryLiteralReferenceSchema, { ...reference, content_protocol: "legacy-v1" })).toBe(true);
    expect(Value.Check(MemoryLiteralReferenceSchema, { ...reference, content_manifest_digest: "a".repeat(64) })).toBe(false);
    expect(Value.Check(MemoryLiteralReferenceSchema, { ...reference, target: accepted })).toBe(false);
    expect(Value.Check(MemoryLiteralReferenceSchema, { ...reference, target: { ...target, draft_revision: 0 } })).toBe(false);
    const preview = { preview_version: 1, text_preview: "", reference,
      coverage: { status: "complete", start: 0, end: 0, total_utf16_code_units: 0, total_utf8_bytes: 0 } };
    expect(Value.Check(MemoryLiteralPreviewSchema, preview)).toBe(true);
    expect(Value.Check(MemoryLiteralPreviewSchema, { ...preview, confirmed: true })).toBe(false);
    const page = { page_version: 1, reference, text: "", offset_unit: "utf16_code_unit",
      start: 0, end: 0, total_utf16_code_units: 0, total_utf8_bytes: 0, has_more: false, next_offset: null };
    expect(Value.Check(MemoryLiteralPageSchema, page)).toBe(true);
  });
});
