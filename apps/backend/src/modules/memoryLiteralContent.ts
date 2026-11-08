/** Pure projections of server-loaded, currently admitted Memory literals.
 * These functions do not authenticate or retain a source. Every real route or
 * tool must re-resolve current account/purpose/item/evidence access each time,
 * validate its whole stored manifest, and recheck authority after awaits. */
import { createHash } from "node:crypto";
import { types } from "node:util";
import { MEMORY_CONTENT_PAGE_MAX_JSON_BYTES, MEMORY_LITERAL_PREVIEW_MAX_UTF8_BYTES,
  memoryContentPage, memoryLiteralDescriptor, requireMemoryLiteral,
  describeMemoryText,
  type MemoryLiteralDescriptorWire, type MemoryLiteralReference, type MemoryLiteralTarget,
  type MemoryLiteralPreview, type MemoryLiteralPageResponse } from "@talent-signal/contracts";
import { ApiError } from "../lib/apiError.js";

const invalid = (): never => { throw new ApiError(400, "MEMORY_CONTENT_INVALID", "The Memory content request is invalid."); };
const unavailable = (): never => { throw new ApiError(409, "MEMORY_CONTENT_UNAVAILABLE", "The stored Memory content is not currently verifiable."); };
const unsupported = (): never => { throw new ApiError(409, "MEMORY_CONTENT_VERSION_UNSUPPORTED", "This Memory content version is unsupported."); };
const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const DESCRIPTOR_KEYS = ["sha256", "utf8_bytes", "utf16_code_units", "unicode_scalar_count"] as const;

function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const properties = Object.getOwnPropertyDescriptors(value), allowed = new Set([...required, ...optional]);
  if (Reflect.ownKeys(properties).length > allowed.size) return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(properties)) {
    if (typeof key !== "string" || !allowed.has(key)) return invalid();
    const slot = Object.getOwnPropertyDescriptor(properties, key)?.value as PropertyDescriptor | undefined;
    if (!slot || !("value" in slot) || !slot.enumerable) return invalid();
    result[key] = slot.value;
  }
  if (!required.every(key => Object.hasOwn(result, key))) return invalid();
  return result;
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) return invalid();
  return value as T;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) return invalid();
  return value;
}
function positive(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) return invalid();
  return value;
}
function target(value: unknown): MemoryLiteralTarget {
  const row = record(value, ["kind"], ["item_id", "item_added_revision", "item_version", "evidence_id", "content_version", "field",
    "draft_id", "draft_revision", "review_scope_id"]);
  if (row.kind === "review_draft") {
    if (Object.keys(row).length !== 6) return invalid();
    return Object.freeze({ kind: row.kind, draft_id: id(row.draft_id), draft_revision: positive(row.draft_revision, 2_147_483_647),
      review_scope_id: id(row.review_scope_id), item_id: id(row.item_id), field: oneOf(row.field, ["edited_text"] as const) });
  }
  if (Object.keys(row).length !== 4) return invalid();
  if (row.kind === "proposal_item" && Object.hasOwn(row, "item_added_revision")) return Object.freeze({ kind: row.kind,
    item_id: id(row.item_id), item_added_revision: positive(row.item_added_revision, 2_147_483_647),
    field: oneOf(row.field, ["display_text", "original_display_text", "source_excerpt"] as const) });
  if (row.kind === "memory_item" && Object.hasOwn(row, "item_version")) return Object.freeze({ kind: row.kind,
    item_id: id(row.item_id), item_version: positive(row.item_version, 2_147_483_647),
    field: oneOf(row.field, ["display_text", "original_display_text"] as const) });
  if (row.kind === "memory_evidence" && row.content_version === 1) return Object.freeze({ kind: row.kind,
    evidence_id: id(row.evidence_id), content_version: 1, field: oneOf(row.field, ["excerpt"] as const) });
  return invalid();
}
function descriptor(value: unknown, draft = false): Readonly<MemoryLiteralDescriptorWire> {
  const row = record(value, DESCRIPTOR_KEYS);
  if (typeof row.sha256 !== "string" || !HASH.test(row.sha256)) return invalid();
  const count = (value: unknown) => {
    if (draft && value === 0) return 0;
    return positive(value, draft ? 32_768 : 65_536);
  };
  const bytes = count(row.utf8_bytes), units = count(row.utf16_code_units), scalars = count(row.unicode_scalar_count);
  if (scalars > units || units > 2 * scalars || units > bytes || bytes > 4 * scalars) return invalid();
  return Object.freeze({ sha256: row.sha256, utf8_bytes: bytes, utf16_code_units: units, unicode_scalar_count: scalars });
}
function protocol(value: unknown, legacyIfMissing = false): "legacy-v1" | "literal-v2" {
  if (value === "legacy-v1" || (legacyIfMissing && value === undefined)) return "legacy-v1";
  if (value === "literal-v2") return value;
  return unsupported();
}
function reference(value: unknown): Readonly<MemoryLiteralReference> {
  const row = record(value, ["reference_version", "target", "descriptor", "content_protocol", "content_manifest_digest"]);
  if (row.reference_version !== 1) return unsupported();
  const provenance = protocol(row.content_protocol), currentTarget = target(row.target);
  const currentDescriptor = descriptor(row.descriptor, currentTarget.kind === "review_draft");
  if (currentTarget.kind === "review_draft") {
    if (row.content_manifest_digest !== null) return invalid();
    return Object.freeze({ reference_version: 1, target: currentTarget, descriptor: currentDescriptor,
      content_protocol: provenance, content_manifest_digest: null });
  }
  if (provenance === "legacy-v1") {
    if (row.content_manifest_digest !== null) return invalid();
    return Object.freeze({ reference_version: 1, target: currentTarget, descriptor: currentDescriptor,
      content_protocol: provenance, content_manifest_digest: null });
  }
  if (typeof row.content_manifest_digest !== "string" || !HASH.test(row.content_manifest_digest)) return invalid();
  return Object.freeze({ reference_version: 1, target: currentTarget, descriptor: currentDescriptor,
    content_protocol: provenance, content_manifest_digest: row.content_manifest_digest });
}
function identity(ref: Readonly<MemoryLiteralReference>): string {
  const owner = ref.target, d = ref.descriptor;
  const ownerIdentity = owner.kind === "review_draft"
    ? [owner.kind, owner.draft_id, owner.draft_revision, owner.review_scope_id, owner.item_id, owner.field]
    : [owner.kind, owner.kind === "memory_evidence" ? owner.evidence_id : owner.item_id,
    owner.kind === "memory_evidence" ? owner.content_version : owner.kind === "memory_item" ? owner.item_version : owner.item_added_revision,
    owner.field];
  return JSON.stringify([1, ...ownerIdentity, ref.content_protocol, ref.content_manifest_digest,
    d.sha256, d.utf8_bytes, d.utf16_code_units, d.unicode_scalar_count]);
}

/** Internal input is an explicit server adapter DTO, never a body supplied by
 * HTTP/model. V2 requires the selected descriptor from its validated stored
 * manifest; legacy may describe currently stored bytes without a fake digest. */
function stored(value: unknown): { reference: Readonly<MemoryLiteralReference>; text: string } {
  let row: Record<string, unknown>;
  try { row = record(value, ["target", "text"], ["content_protocol", "content_manifest_digest", "stored_descriptor"]); }
  catch { return unavailable(); }
  const provenance = protocol(row.content_protocol, true);
  try {
    const currentTarget = target(row.target), kind = currentTarget.field === "source_excerpt" || currentTarget.field === "excerpt" ? "excerpt" : "statement";
    if (currentTarget.kind === "review_draft") {
      const statistics = describeMemoryText(row.text as string);
      if (statistics.utf8_bytes > 32_768 || row.content_manifest_digest != null || row.stored_descriptor != null) return unavailable();
      const text = row.text as string;
      const actual = descriptor({ ...statistics, sha256: createHash("sha256").update(text, "utf8").digest("hex") }, true);
      return { text, reference: Object.freeze({ reference_version: 1, target: currentTarget, descriptor: actual,
        content_protocol: provenance, content_manifest_digest: null }) };
    }
    const text = requireMemoryLiteral(row.text as string, kind);
    const actual = descriptor(memoryLiteralDescriptor(text, kind, createHash("sha256").update(text, "utf8").digest("hex")));
    if (provenance === "legacy-v1") {
      if (row.content_manifest_digest != null || row.stored_descriptor != null) return unavailable();
    } else {
      if (typeof row.content_manifest_digest !== "string" || !HASH.test(row.content_manifest_digest)) return unavailable();
      if (JSON.stringify(descriptor(row.stored_descriptor)) !== JSON.stringify(actual)) return unavailable();
    }
    return { text, reference: Object.freeze({ reference_version: 1, target: currentTarget, descriptor: actual,
      content_protocol: provenance, content_manifest_digest: provenance === "legacy-v1" ? null : row.content_manifest_digest as string }) as Readonly<MemoryLiteralReference> };
  } catch { return unavailable(); }
}

export function createMemoryLiteralReference(source: unknown): Readonly<MemoryLiteralReference> {
  return stored(source).reference;
}
export function createMemoryLiteralPreview(source: unknown): Readonly<MemoryLiteralPreview> {
  const current = stored(source); let text = "", bytes = 0;
  for (const scalar of current.text) {
    const size = Buffer.byteLength(scalar, "utf8");
    if (bytes + size > MEMORY_LITERAL_PREVIEW_MAX_UTF8_BYTES) break;
    bytes += size; text += scalar;
  }
  const result = Object.freeze({ preview_version: 1 as const, text_preview: text, reference: current.reference,
    coverage: Object.freeze({ status: text.length === current.text.length ? "complete" as const : "partial" as const,
      start: 0 as const, end: text.length, total_utf16_code_units: current.reference.descriptor.utf16_code_units,
      total_utf8_bytes: current.reference.descriptor.utf8_bytes }) });
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 4 * 1024) return unavailable();
  return result as Readonly<MemoryLiteralPreview>;
}
export function readMemoryLiteralPage(source: unknown, input: unknown): Readonly<MemoryLiteralPageResponse> {
  const request = record(input, ["page_version", "reference", "offset"]);
  if (request.page_version !== 1) return unsupported();
  const expected = reference(request.reference), offset = request.offset;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > 65_536) return invalid();
  const current = stored(source);
  if (identity(expected) !== identity(current.reference)) throw new ApiError(409, "MEMORY_CONTENT_STALE", "The Memory content changed; reload its current reference.");
  let page: ReturnType<typeof memoryContentPage>;
  try { page = memoryContentPage(current.text, offset); } catch { return invalid(); }
  const result = Object.freeze({ page_version: 1 as const, reference: current.reference, offset_unit: "utf16_code_unit" as const,
    text: page.text, start: page.start_utf16, end: page.end_utf16, total_utf16_code_units: page.total_utf16,
    total_utf8_bytes: page.total_utf8_bytes, has_more: page.has_more, next_offset: page.next_offset });
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MEMORY_CONTENT_PAGE_MAX_JSON_BYTES) return unavailable();
  return result as Readonly<MemoryLiteralPageResponse>;
}
