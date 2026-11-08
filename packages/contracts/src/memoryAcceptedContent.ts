/** Accepted text integrity is separate from source/evidence admission. No
 * historical reference or digest in this module grants current read access. */
import { describeMemoryText, memoryLiteralDescriptor, requireMemoryLiteral,
  MemoryContentError, type MemoryContentProtocol, type MemoryLiteralDescriptor } from "./memoryContent.js";

export const MEMORY_ACCEPTED_MANIFEST_VERSION = "accepted-memory-literal.v1" as const;
export const MEMORY_ACCEPTED_EVIDENCE_MAX_REFS = 10;
export const MEMORY_ACCEPTED_MANIFEST_MAX_JSON_BYTES = 8 * 1024;
export type MemoryAcceptedEvidenceReference = {
  evidence_id: string;
  content_version: 1;
} & ({ content_protocol: "legacy-v1"; content_manifest_digest: null }
  | { content_protocol: "literal-v2"; content_manifest_digest: string });
export interface MemoryAcceptedContentManifestInput {
  display_text: string;
  original_display_text: string | null;
  original_content_protocol: MemoryContentProtocol;
  reviewed_evidence: MemoryAcceptedEvidenceReference[];
}
export interface MemoryAcceptedContentManifestV1 {
  readonly version: typeof MEMORY_ACCEPTED_MANIFEST_VERSION;
  readonly original_content_protocol: MemoryContentProtocol;
  readonly display_text: Readonly<MemoryLiteralDescriptor>;
  readonly original_display_text: Readonly<MemoryLiteralDescriptor> | null;
  readonly reviewed_evidence: readonly Readonly<MemoryAcceptedEvidenceReference>[];
}
export interface MemoryAcceptedContentMetadata {
  readonly content_protocol: "literal-v2";
  readonly content_manifest: Readonly<MemoryAcceptedContentManifestV1>;
  readonly content_manifest_digest: string;
}

const invalid = (): never => { throw new MemoryContentError("MEMORY_CONTENT_INVALID"); };
const limit = (): never => { throw new MemoryContentError("MEMORY_CONTENT_LIMIT"); };
const unsupported = (): never => { throw new MemoryContentError("MEMORY_CONTENT_VERSION_UNSUPPORTED"); };
const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;

/** Snapshot exact enumerable own data slots without reading getters/toJSON.
 * Reflection failures never carry private exception prose across this API. */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object") return invalid();
  let properties: Record<string, PropertyDescriptor>;
  try {
    if (Array.isArray(value)) return invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();
    properties = Object.getOwnPropertyDescriptors(value);
  } catch { return invalid(); }
  if (Reflect.ownKeys(properties).length !== keys.length) return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const slot = Object.getOwnPropertyDescriptor(properties, key)?.value as PropertyDescriptor | undefined;
    if (!slot || !("value" in slot) || !slot.enumerable) return invalid();
    result[key] = slot.value;
  }
  return result;
}

function evidenceReferences(value: unknown): readonly Readonly<MemoryAcceptedEvidenceReference>[] {
  let length: unknown;
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
    length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  } catch { return invalid(); }
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1) return invalid();
  if (length > MEMORY_ACCEPTED_EVIDENCE_MAX_REFS) return limit();
  let slots: Record<string, PropertyDescriptor>;
  try {
    slots = Object.getOwnPropertyDescriptors(value);
  } catch { return invalid(); }
  if (Reflect.ownKeys(slots).length !== length + 1) return invalid();
  const references: Readonly<MemoryAcceptedEvidenceReference>[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(slots, String(index))?.value as PropertyDescriptor | undefined;
    if (!slot || !("value" in slot) || !slot.enumerable) return invalid();
    const item = record(slot.value, ["evidence_id", "content_protocol", "content_version", "content_manifest_digest"]);
    if (typeof item.evidence_id !== "string" || !UUID.test(item.evidence_id) || item.content_version !== 1) return invalid();
    const evidenceID = item.evidence_id.toLowerCase();
    if (ids.has(evidenceID)) return invalid();
    ids.add(evidenceID);
    const protocol = item.content_protocol, digest = item.content_manifest_digest;
    if (protocol !== "legacy-v1" && protocol !== "literal-v2") return unsupported();
    if (protocol === "legacy-v1") {
      if (digest !== null) return invalid();
      references.push(Object.freeze({ evidence_id: evidenceID, content_protocol: protocol, content_version: 1, content_manifest_digest: null }));
    } else {
      if (typeof digest !== "string" || !HASH.test(digest)) return invalid();
      references.push(Object.freeze({ evidence_id: evidenceID, content_protocol: protocol, content_version: 1, content_manifest_digest: digest }));
    }
  }
  // UUIDs are fixed lowercase ASCII metadata. Do not use locale collation.
  references.sort((left, right) => left.evidence_id < right.evidence_id ? -1 : left.evidence_id > right.evidence_id ? 1 : 0);
  return Object.freeze(references);
}

/** Describes exact stored/confirmed final and original literals, plus the
 * independently versioned evidence reviewed for them. The caller owns current
 * account/item/evidence membership, source authorization and atomic publication.
 * Legacy evidence is copied as legacy; no raw source proof is manufactured.
 * Capture every input before invoking the first asynchronous digest. */
export async function createMemoryAcceptedContentManifest(input: unknown,
  digest: (value: string) => string | Promise<string>): Promise<Readonly<MemoryAcceptedContentMetadata>> {
  const source = record(input, ["display_text", "original_display_text", "original_content_protocol", "reviewed_evidence"]);
  const protocol = source.original_content_protocol;
  if (protocol !== "legacy-v1" && protocol !== "literal-v2") return unsupported();
  const display = requireMemoryLiteral(source.display_text as string, "statement");
  const originalInput = source.original_display_text;
  if (originalInput === null && protocol !== "legacy-v1") return invalid();
  const original = originalInput === null ? null : requireMemoryLiteral(originalInput as string, "statement");
  const references = evidenceReferences(source.reviewed_evidence);
  const safeDigest = async (value: string): Promise<string> => {
    try {
      const hash = await digest(value);
      if (typeof hash !== "string" || !HASH.test(hash)) return invalid();
      return hash;
    } catch { return invalid(); }
  };
  const hashes = await Promise.all([safeDigest(display), original === null ? null : safeDigest(original)]);
  const manifest: Readonly<MemoryAcceptedContentManifestV1> = Object.freeze({ version: MEMORY_ACCEPTED_MANIFEST_VERSION,
    original_content_protocol: protocol,
    display_text: memoryLiteralDescriptor(display, "statement", hashes[0]!),
    original_display_text: original === null ? null : memoryLiteralDescriptor(original, "statement", hashes[1]!),
    reviewed_evidence: references });
  if (describeMemoryText(JSON.stringify(manifest)).utf8_bytes > MEMORY_ACCEPTED_MANIFEST_MAX_JSON_BYTES) return limit();
  const tuple = (value: MemoryLiteralDescriptor) => [value.sha256, value.utf8_bytes, value.utf16_code_units, value.unicode_scalar_count];
  const encoded = JSON.stringify(["memory-accepted-literal.v1", protocol, tuple(manifest.display_text),
    manifest.original_display_text === null ? null : tuple(manifest.original_display_text),
    references.map(ref => [ref.evidence_id, ref.content_protocol, ref.content_version, ref.content_manifest_digest])]);
  return Object.freeze({ content_protocol: "literal-v2", content_manifest: manifest,
    content_manifest_digest: await safeDigest(encoded) });
}
