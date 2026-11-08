/** New literal read primitives; not wired into legacy full-text DTOs. A
 * reference describes current stored bytes, never source/read authority.
 * Structural JSON limits are supplemented by exact UTF8/count/digest and
 * cross-field validation in the host producer/reader. */
import { Type, type Static } from "@sinclair/typebox";
import { MEMORY_CONTENT_PAGE_MAX_TEXT_BYTES } from "./memoryContent.js";

export const MEMORY_LITERAL_PREVIEW_MAX_UTF8_BYTES = 256;
const obj = { additionalProperties: false } as const;
const id = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const literalCount = Type.Integer({ minimum: 1, maximum: 65_536 });
const draftCount = Type.Integer({ minimum: 0, maximum: 32_768 });
const offset = Type.Integer({ minimum: 0, maximum: 65_536 });
const revision = Type.Integer({ minimum: 1, maximum: 2_147_483_647 });

export const MemoryLiteralDescriptorSchema = Type.Object({ sha256: hash,
  utf8_bytes: literalCount, utf16_code_units: literalCount, unicode_scalar_count: literalCount }, obj);
export const MemoryCanonicalLiteralTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal("proposal_item"), item_id: id, item_added_revision: revision,
    field: Type.Union([Type.Literal("display_text"), Type.Literal("original_display_text"),
      Type.Literal("source_excerpt")]) }, obj),
  Type.Object({ kind: Type.Literal("memory_item"), item_id: id, item_version: revision,
    field: Type.Union([Type.Literal("display_text"), Type.Literal("original_display_text")]) }, obj),
  Type.Object({ kind: Type.Literal("memory_evidence"), evidence_id: id, content_version: Type.Literal(1),
    field: Type.Literal("excerpt") }, obj),
]);
export const MemoryDraftLiteralTargetSchema = Type.Object({ kind: Type.Literal("review_draft"),
  draft_id: id, draft_revision: revision, review_scope_id: id, item_id: id, field: Type.Literal("edited_text") }, obj);
export const MemoryLiteralTargetSchema = Type.Union([MemoryCanonicalLiteralTargetSchema, MemoryDraftLiteralTargetSchema]);
export const MemoryDraftLiteralDescriptorSchema = Type.Object({ sha256: hash,
  utf8_bytes: draftCount, utf16_code_units: draftCount, unicode_scalar_count: draftCount }, obj);

/** Reference format and literal provenance have independent versions. Legacy
 * descriptors refer only to currently stored bytes; no exact raw backfill. */
export const MemoryCanonicalLiteralReferenceSchema = Type.Union([
  Type.Object({ reference_version: Type.Literal(1), target: MemoryCanonicalLiteralTargetSchema,
    descriptor: MemoryLiteralDescriptorSchema, content_protocol: Type.Literal("legacy-v1"),
    content_manifest_digest: Type.Null() }, obj),
  Type.Object({ reference_version: Type.Literal(1), target: MemoryCanonicalLiteralTargetSchema,
    descriptor: MemoryLiteralDescriptorSchema, content_protocol: Type.Literal("literal-v2"),
    content_manifest_digest: hash }, obj),
]);
/** An unfinished draft has no canonical stored manifest. Its exact stored
 * bytes and current draft/item/review identity are sufficient for traversal,
 * never for accepting Memory or authorizing access. Empty edits are valid. */
export const MemoryDraftLiteralReferenceSchema = Type.Object({ reference_version: Type.Literal(1),
  target: MemoryDraftLiteralTargetSchema, descriptor: MemoryDraftLiteralDescriptorSchema,
  content_protocol: Type.Union([Type.Literal("legacy-v1"), Type.Literal("literal-v2")]),
  content_manifest_digest: Type.Null() }, obj);
export const MemoryLiteralReferenceSchema = Type.Union([MemoryCanonicalLiteralReferenceSchema, MemoryDraftLiteralReferenceSchema]);

const canonicalPreview = Type.Object({ preview_version: Type.Literal(1),
  text_preview: Type.String({ minLength: 1, maxLength: MEMORY_LITERAL_PREVIEW_MAX_UTF8_BYTES }),
  reference: MemoryCanonicalLiteralReferenceSchema,
  coverage: Type.Object({ status: Type.Union([Type.Literal("complete"), Type.Literal("partial")]),
    start: Type.Literal(0), end: Type.Integer({ minimum: 0, maximum: MEMORY_LITERAL_PREVIEW_MAX_UTF8_BYTES }),
    total_utf16_code_units: literalCount, total_utf8_bytes: literalCount }, obj) }, obj);
const draftPreview = Type.Object({ preview_version: Type.Literal(1),
  text_preview: Type.String({ maxLength: MEMORY_LITERAL_PREVIEW_MAX_UTF8_BYTES }), reference: MemoryDraftLiteralReferenceSchema,
  coverage: Type.Object({ status: Type.Union([Type.Literal("complete"), Type.Literal("partial")]),
    start: Type.Literal(0), end: Type.Integer({ minimum: 0, maximum: MEMORY_LITERAL_PREVIEW_MAX_UTF8_BYTES }),
    total_utf16_code_units: draftCount, total_utf8_bytes: draftCount }, obj) }, obj);
export const MemoryLiteralPreviewSchema = Type.Union([canonicalPreview, draftPreview]);

/** The current route/tool scope and header credential are separate. The
 * request/ref/cursor can never select or manufacture them. */
export const MemoryLiteralPageRequestSchema = Type.Object({ page_version: Type.Literal(1),
  reference: MemoryLiteralReferenceSchema, offset }, obj);
const canonicalPage = Type.Object({ page_version: Type.Literal(1),
  reference: MemoryCanonicalLiteralReferenceSchema,
  text: Type.String({ maxLength: MEMORY_CONTENT_PAGE_MAX_TEXT_BYTES }),
  offset_unit: Type.Literal("utf16_code_unit"), start: offset, end: offset,
  total_utf16_code_units: literalCount, total_utf8_bytes: literalCount,
  has_more: Type.Boolean(), next_offset: Type.Union([offset, Type.Null()]) }, obj);
const draftOffset = Type.Integer({ minimum: 0, maximum: 32_768 });
const draftPage = Type.Object({ page_version: Type.Literal(1), reference: MemoryDraftLiteralReferenceSchema,
  text: Type.String({ maxLength: MEMORY_CONTENT_PAGE_MAX_TEXT_BYTES }), offset_unit: Type.Literal("utf16_code_unit"),
  start: draftOffset, end: draftOffset, total_utf16_code_units: draftCount, total_utf8_bytes: draftCount,
  has_more: Type.Boolean(), next_offset: Type.Union([draftOffset, Type.Null()]) }, obj);
export const MemoryLiteralPageSchema = Type.Union([canonicalPage, draftPage]);

export type MemoryLiteralDescriptorWire = Static<typeof MemoryLiteralDescriptorSchema>;
export type MemoryLiteralTarget = Static<typeof MemoryLiteralTargetSchema>;
export type MemoryDraftLiteralReference = Static<typeof MemoryDraftLiteralReferenceSchema>;
export type MemoryLiteralReference = Static<typeof MemoryLiteralReferenceSchema>;
export type MemoryLiteralPreview = Static<typeof MemoryLiteralPreviewSchema>;
export type MemoryLiteralPageRequest = Static<typeof MemoryLiteralPageRequestSchema>;
export type MemoryLiteralPageResponse = Static<typeof MemoryLiteralPageSchema>;
