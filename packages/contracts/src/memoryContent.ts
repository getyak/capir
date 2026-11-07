/** Literal storage/transport budgets are independent of model context and Run
 * budgets. No helper in this module confers source or read authority. */
export const MEMORY_LITERAL_PROTOCOL = "literal-v2" as const;
export const MEMORY_STATEMENT_MAX_UTF8_BYTES = 32 * 1024;
export const MEMORY_EXCERPT_MAX_UTF8_BYTES = 64 * 1024;
export const MEMORY_REQUEST_LITERAL_MAX_UTF8_BYTES = 256 * 1024;
export const MEMORY_REQUEST_MAX_JSON_BYTES = 1024 * 1024;
export const MEMORY_CONTENT_PAGE_MAX_TEXT_BYTES = 16 * 1024;
export const MEMORY_CONTENT_PAGE_MAX_JSON_BYTES = 64 * 1024;

export type MemoryContentProtocol = "legacy-v1" | typeof MEMORY_LITERAL_PROTOCOL;
export interface MemoryTextStatistics {
  utf8_bytes: number;
  utf16_code_units: number;
  unicode_scalar_count: number;
}
export interface MemoryLiteralDescriptor extends MemoryTextStatistics { sha256: string }

export class MemoryContentError extends Error {
  constructor(readonly code: "MEMORY_CONTENT_INVALID" | "MEMORY_CONTENT_LIMIT"
    | "MEMORY_CONTENT_VERSION_UNSUPPORTED" | "MEMORY_CONTENT_RANGE_INVALID") {
    super(code);
    this.name = "MemoryContentError";
  }
}
const invalid = (): never => { throw new MemoryContentError("MEMORY_CONTENT_INVALID"); };
const limit = (): never => { throw new MemoryContentError("MEMORY_CONTENT_LIMIT"); };
const invalidRange = (): never => { throw new MemoryContentError("MEMORY_CONTENT_RANGE_INVALID"); };
const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;

export function resolveMemoryContentProtocol(value: unknown): MemoryContentProtocol {
  if (value === undefined || value === "legacy-v1") return "legacy-v1";
  if (value === MEMORY_LITERAL_PROTOCOL) return value;
  throw new MemoryContentError("MEMORY_CONTENT_VERSION_UNSUPPORTED");
}

/** Reject invalid UTF-16 before UTF-8 encoding can silently substitute U+FFFD.
 * Do not trim, normalize Unicode or rewrite line endings. */
export function describeMemoryText(value: string): Readonly<MemoryTextStatistics> {
  if (typeof value !== "string") return invalid();
  let bytes = 0, scalars = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) return invalid();
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return invalid();
      bytes += 4; index += 1;
    } else {
      if (unit >= 0xdc00 && unit <= 0xdfff) return invalid();
      bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
    }
    scalars += 1;
  }
  return Object.freeze({ utf8_bytes: bytes, utf16_code_units: value.length, unicode_scalar_count: scalars });
}

export function requireMemoryLiteral(value: string, kind: "statement" | "excerpt"): string {
  const statistics = describeMemoryText(value);
  if (!value.trim()) return invalid();
  if (statistics.utf8_bytes > (kind === "statement" ? MEMORY_STATEMENT_MAX_UTF8_BYTES : MEMORY_EXCERPT_MAX_UTF8_BYTES)) return limit();
  return value;
}

/** The producer computes the digest from these exact literal bytes. A digest
 * in an untrusted request does not establish a source or a retained version. */
export function memoryLiteralDescriptor(value: string, kind: "statement" | "excerpt", digest: string): Readonly<MemoryLiteralDescriptor> {
  requireMemoryLiteral(value, kind);
  if (typeof digest !== "string" || !HASH.test(digest)) return invalid();
  return Object.freeze({ ...describeMemoryText(value), sha256: digest });
}

export interface MemoryMessageRangeV2 {
  kind: "message";
  session_id: string | null;
  message_id: string;
  range_version: 1;
  representation: "authored_message_text.v1";
  offset_unit: "utf16_code_unit";
  character_start: number;
  character_end: number;
  source_revision_hash: string;
  source_text_sha256: string;
  excerpt_sha256: string;
}
export interface MemoryMessageTextSource {
  text: string;
  session_id: string | null;
  message_id: string;
  source_revision_hash: string;
  source_text_sha256: string;
}
const RANGE_KEYS = ["kind", "session_id", "message_id", "range_version", "representation", "offset_unit",
  "character_start", "character_end", "source_revision_hash", "source_text_sha256", "excerpt_sha256"] as const;

function scalarBoundary(value: string, offset: number): boolean {
  const unit = value.charCodeAt(offset), before = value.charCodeAt(offset - 1);
  return !(unit >= 0xdc00 && unit <= 0xdfff && before >= 0xd800 && before <= 0xdbff);
}

function snapshotMessageRange(value: unknown): Readonly<MemoryMessageRangeV2> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalidRange();
  let properties: Record<string, PropertyDescriptor>;
  try { properties = Object.getOwnPropertyDescriptors(value); } catch { return invalidRange(); }
  if (Reflect.ownKeys(properties).length !== RANGE_KEYS.length
    || RANGE_KEYS.some(key => !Object.hasOwn(properties, key) || !("value" in properties[key]!))) return invalidRange();
  // Snapshot each allowlisted own data property once; accessors cannot change a
  // value between validation and the returned immutable binding.
  const entry = Object.fromEntries(RANGE_KEYS.map(key => [key, properties[key]!.value])) as Record<string, unknown>;
  if (entry.kind !== "message" || entry.range_version !== 1 || entry.representation !== "authored_message_text.v1"
    || entry.offset_unit !== "utf16_code_unit" || typeof entry.message_id !== "string" || !UUID.test(entry.message_id)
    || !(entry.session_id === null || (typeof entry.session_id === "string" && UUID.test(entry.session_id)))) return invalidRange();
  const sessionID = typeof entry.session_id === "string" ? entry.session_id.toLowerCase() : null;
  if (typeof entry.source_revision_hash !== "string" || !HASH.test(entry.source_revision_hash)
    || typeof entry.source_text_sha256 !== "string" || !HASH.test(entry.source_text_sha256)
    || typeof entry.excerpt_sha256 !== "string" || !HASH.test(entry.excerpt_sha256)) return invalidRange();
  const start = entry.character_start, end = entry.character_end;
  if (typeof start !== "number" || typeof end !== "number" || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || start >= end) return invalidRange();
  return Object.freeze({ kind: "message", session_id: sessionID, message_id: entry.message_id.toLowerCase(),
    range_version: 1, representation: "authored_message_text.v1", offset_unit: "utf16_code_unit",
    character_start: start, character_end: end, source_revision_hash: entry.source_revision_hash,
    source_text_sha256: entry.source_text_sha256, excerpt_sha256: entry.excerpt_sha256 });
}

/** Only exact host-owned text may be selected. The caller supplies current
 * source/version/digests out of band and must recheck its own auth/lifetime. */
export function verifyMemoryMessageRange(excerpt: string, value: unknown,
  host: Readonly<MemoryMessageTextSource>): Readonly<MemoryMessageRangeV2> {
  requireMemoryLiteral(excerpt, "excerpt");
  describeMemoryText(host.text);
  const range = snapshotMessageRange(value);
  if (!UUID.test(host.message_id) || range.message_id !== host.message_id.toLowerCase()
    || !(host.session_id === null || (typeof host.session_id === "string" && UUID.test(host.session_id)))
    || range.session_id !== (host.session_id?.toLowerCase() ?? null)
    || range.source_revision_hash !== host.source_revision_hash || range.source_text_sha256 !== host.source_text_sha256
    || range.character_end > host.text.length || !scalarBoundary(host.text, range.character_start)
    || !scalarBoundary(host.text, range.character_end)
    || host.text.slice(range.character_start, range.character_end) !== excerpt) return invalidRange();
  return range;
}

const LITERAL_FIELDS = new Set(["display_text", "original_display_text", "applied_display_text",
  "source_excerpt", "excerpt", "previous_text", "edited_text"]);

/** Encode once and charge what is actually on the wire, including repeated
 * copies and edited-text maps. The returned body is the measured body; callers
 * must not serialize a mutable original object again for dispatch. */
export function encodeMemoryLiteralRequest(value: unknown): Readonly<{
  body: string; literal_utf8_bytes: number; encoded_utf8_bytes: number;
}> {
  let body: string;
  try { body = JSON.stringify(value); } catch { return invalid(); }
  if (typeof body !== "string") return invalid();
  const encoded = describeMemoryText(body).utf8_bytes;
  if (encoded > MEMORY_REQUEST_MAX_JSON_BYTES) return limit();
  const wire: unknown = JSON.parse(body);
  let literalBytes = 0;
  function walk(node: unknown, literal: boolean, depth: number): void {
    if (depth > 64) return invalid();
    if (typeof node === "string") {
      if (literal) {
        literalBytes += describeMemoryText(node).utf8_bytes;
        if (literalBytes > MEMORY_REQUEST_LITERAL_MAX_UTF8_BYTES) return limit();
      }
    } else if (Array.isArray(node)) {
      for (const item of node) walk(item, literal, depth + 1);
    } else if (node !== null && typeof node === "object") {
      for (const [key, item] of Object.entries(node)) walk(item, literal || LITERAL_FIELDS.has(key), depth + 1);
    }
  }
  walk(wire, false, 0);
  return Object.freeze({ body, literal_utf8_bytes: literalBytes, encoded_utf8_bytes: encoded });
}

export interface MemoryLiteralPage {
  text: string;
  start_utf16: number;
  end_utf16: number;
  total_utf16: number;
  total_utf8_bytes: number;
  has_more: boolean;
  next_offset: number | null;
}

/** Text-only paging, never a cursor or source grant. Callers bind the returned
 * offsets to their current owner/version/field and check the final envelope. */
export function memoryContentPage(value: string, offset: number): Readonly<MemoryLiteralPage> {
  const total = describeMemoryText(value);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > value.length || !scalarBoundary(value, offset)) return invalidRange();
  let end = offset, bytes = 0, escapedBytes = 0;
  // Reserve room for bounded identity/digest/cursor metadata in the host's
  // final response, whose actual encoding still needs its own check.
  const encodedTextBudget = MEMORY_CONTENT_PAGE_MAX_JSON_BYTES - 2048;
  while (end < value.length) {
    const scalar = value.codePointAt(end)!;
    const scalarBytes = scalar < 0x80 ? 1 : scalar < 0x800 ? 2 : scalar < 0x10000 ? 3 : 4;
    const escaped = scalar === 0x22 || scalar === 0x5c ? 2
      : scalar < 0x20 ? [8, 9, 10, 12, 13].includes(scalar) ? 2 : 6 : scalarBytes;
    if (bytes + scalarBytes > MEMORY_CONTENT_PAGE_MAX_TEXT_BYTES || escapedBytes + escaped > encodedTextBudget) break;
    bytes += scalarBytes; escapedBytes += escaped; end += scalar > 0xffff ? 2 : 1;
  }
  const page: MemoryLiteralPage = { text: value.slice(offset, end), start_utf16: offset, end_utf16: end,
    total_utf16: value.length, total_utf8_bytes: total.utf8_bytes,
    has_more: end < value.length, next_offset: end < value.length ? end : null };
  if (describeMemoryText(JSON.stringify(page)).utf8_bytes > MEMORY_CONTENT_PAGE_MAX_JSON_BYTES) return limit();
  return Object.freeze(page);
}

export interface MemoryContentManifestV2 {
  version: typeof MEMORY_LITERAL_PROTOCOL;
  original_content_protocol: MemoryContentProtocol;
  display_text: Readonly<MemoryLiteralDescriptor>;
  original_display_text: Readonly<MemoryLiteralDescriptor> | null;
  source_excerpt: Readonly<MemoryLiteralDescriptor>;
  source_revision_hash: string;
  source_locator_sha256: string;
  message_range: Readonly<MemoryMessageRangeV2> | null;
}
export interface MemoryContentManifestInput {
  original_content_protocol: MemoryContentProtocol;
  display_text: string;
  original_display_text: string | null;
  source_excerpt: string;
  source_revision_hash: string;
  source_locator_sha256: string;
  /** Null for image/document proof; their existing source owner must validate
   * the artifact/region/extraction. A null range never invents text offsets. */
  message_range: Readonly<MemoryMessageRangeV2> | null;
}

/** Platform-neutral producer helper: backend uses its real SHA-256 primitive;
 * Web/native peers use their own. The source owner still verifies authority.
 * All input is captured before the first digest await. */
export async function createMemoryContentManifest(input: MemoryContentManifestInput,
  digest: (value: string) => string | Promise<string>): Promise<Readonly<{
    content_protocol: typeof MEMORY_LITERAL_PROTOCOL;
    content_manifest: Readonly<MemoryContentManifestV2>;
    content_manifest_digest: string;
  }>> {
  const display = requireMemoryLiteral(input.display_text, "statement");
  const originalProtocol = resolveMemoryContentProtocol(input.original_content_protocol);
  const originalInput = input.original_display_text;
  if (originalInput === null && originalProtocol !== "legacy-v1") return invalid();
  const original = originalInput === null ? null : requireMemoryLiteral(originalInput, "statement");
  const excerpt = requireMemoryLiteral(input.source_excerpt, "excerpt");
  const revision = input.source_revision_hash, locatorHash = input.source_locator_sha256;
  if (typeof revision !== "string" || typeof locatorHash !== "string"
    || !HASH.test(revision) || !HASH.test(locatorHash)) return invalid();
  const inputRange = input.message_range;
  const range = inputRange === null ? null : snapshotMessageRange(inputRange);
  const hashes = await Promise.all([digest(display), original === null ? null : digest(original), digest(excerpt)]);
  if (hashes.some((hash, index) => !(index === 1 && original === null && hash === null)
    && (typeof hash !== "string" || !HASH.test(hash)))) return invalid();
  if (range && (range.source_revision_hash !== revision || range.excerpt_sha256 !== hashes[2])) return invalidRange();
  const manifest: Readonly<MemoryContentManifestV2> = Object.freeze({ version: MEMORY_LITERAL_PROTOCOL,
    original_content_protocol: originalProtocol,
    display_text: memoryLiteralDescriptor(display, "statement", hashes[0]!),
    original_display_text: original === null ? null : memoryLiteralDescriptor(original, "statement", hashes[1]!),
    source_excerpt: memoryLiteralDescriptor(excerpt, "excerpt", hashes[2]!),
    source_revision_hash: revision, source_locator_sha256: locatorHash, message_range: range });
  const tuple = (value: MemoryLiteralDescriptor) => [value.sha256, value.utf8_bytes, value.utf16_code_units, value.unicode_scalar_count];
  // A fixed ASCII tuple avoids locale/key-order/normalization differences in
  // confirmation hashing. Literal content is represented by its exact digest.
  const rangeTuple = range ? [range.kind, range.session_id, range.message_id, range.range_version,
    range.representation, range.offset_unit, range.character_start, range.character_end,
    range.source_revision_hash, range.source_text_sha256, range.excerpt_sha256] : null;
  const body = JSON.stringify([MEMORY_LITERAL_PROTOCOL, originalProtocol, tuple(manifest.display_text),
    manifest.original_display_text === null ? null : tuple(manifest.original_display_text),
    tuple(manifest.source_excerpt), revision, locatorHash, rangeTuple]);
  const manifestDigest = await digest(body);
  if (typeof manifestDigest !== "string" || !HASH.test(manifestDigest)) return invalid();
  return Object.freeze({ content_protocol: MEMORY_LITERAL_PROTOCOL, content_manifest: manifest,
    content_manifest_digest: manifestDigest });
}
