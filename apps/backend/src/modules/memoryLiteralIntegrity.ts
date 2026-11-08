/** Integrity of already loaded rows, never an authorization/source/TTL check.
 * Snapshot every selected own data slot before invoking any async producer. */
import { types } from "node:util";
import { canonicalMemoryLiteralJson, captureMemoryLiteralData, createMemoryAcceptedContentManifest,
  createMemoryContentManifest, createMemoryEvidenceManifest, memoryLiteralRecord,
  requireMemoryLiteral, resolveMemoryContentProtocol, MEMORY_LITERAL_UUID, type MemoryAcceptedEvidenceReference } from "@talent-signal/contracts";
import { sha256 } from "../lib/hash.js";
import { ApiError } from "../lib/apiError.js";

export type LiteralRow = Record<string, unknown>;
export const memoryLiteralUnavailable = (): never => { throw new ApiError(409, "MEMORY_CONTENT_UNAVAILABLE", "The stored Memory content is not currently verifiable."); };
const dates = new Set(["valid_time", "observed_time", "created_at", "updated_at"]);
export function pickMemoryLiteralRow(input: unknown, keys: readonly string[]): LiteralRow {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) return memoryLiteralUnavailable();
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return memoryLiteralUnavailable();
    const slots = Object.getOwnPropertyDescriptors(input), out: LiteralRow = Object.create(null);
    for (const key of keys) {
      const slot = slots[key];
      if (!slot) continue;
      if (!("value" in slot) || !slot.enumerable) return memoryLiteralUnavailable();
      let value: unknown = slot.value;
      if (dates.has(key) && value instanceof Date) {
        if (types.isProxy(value) || Object.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length !== 0) return memoryLiteralUnavailable();
        value = Date.prototype.toISOString.call(value);
      }
      if (value !== undefined) out[key] = value;
    }
    return out;
  } catch { return memoryLiteralUnavailable(); }
}
export function pickMemoryLiteralRows(input: unknown, maximum: number): unknown[] {
  try {
    if (!Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype) return memoryLiteralUnavailable();
    const length = Object.getOwnPropertyDescriptor(input, "length")?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maximum
      || Reflect.ownKeys(input).length !== length + 1) return memoryLiteralUnavailable();
    const output: unknown[] = [];
    for (let i = 0; i < length; i++) {
      const slot = Object.getOwnPropertyDescriptor(input, String(i));
      if (!slot || !("value" in slot) || !slot.enumerable) return memoryLiteralUnavailable();
      output.push(slot.value);
    }
    return output;
  } catch { return memoryLiteralUnavailable(); }
}
export const literalRowKeys = ["id", "account_id", "content_protocol", "content_manifest", "content_manifest_digest", "display_text",
  "original_display_text", "source_excerpt", "excerpt", "source_revision_hash", "source_excerpt_hash", "content_hash", "content_version",
  "locator", "memory_item_id", "status", "version", "added_revision", "scope", "subject_kind", "relationship_kind", "operation",
  "statement_kind", "previous_memory_item_id", "previous_revision", "subject_id", "relationship_context_id", "speaker", "reporter",
  "valid_time", "observed_time", "time_status", "sensitivity", "admission_status", "judgment_kind", "admission_reason",
  "default_selected", "reason", "supersedes_id", "conflict_group_id", "created_at", "capture_id", "source_resource_id",
  "source_session_id", "source_message_id", "source_artifact_id"] as const;
export function captureMemoryLiteralRow(value: unknown): LiteralRow {
  return captureMemoryLiteralData(pickMemoryLiteralRow(value, literalRowKeys), 512 * 1024) as LiteralRow;
}
function same(actual: unknown, expected: unknown): void {
  if (canonicalMemoryLiteralJson(actual) !== canonicalMemoryLiteralJson(expected)) return memoryLiteralUnavailable();
}
function plainManifest(value: unknown, keys: readonly string[]): LiteralRow {
  try { return memoryLiteralRecord(value, keys); } catch { return memoryLiteralUnavailable(); }
}
export function assertMemoryLiteralLocator(row: LiteralRow, manifest: LiteralRow, excerpt: string): void {
  const locator = row.locator as LiteralRow | undefined;
  if (!locator || manifest.source_locator_sha256 !== sha256(canonicalMemoryLiteralJson(locator))) return memoryLiteralUnavailable();
  if (row.source_revision_hash !== undefined && row.source_revision_hash !== manifest.source_revision_hash) return memoryLiteralUnavailable();
  const range = manifest.message_range;
  if (range !== null) {
    const r = range as LiteralRow;
    if (locator.kind !== "message" || r.kind !== "message" || locator.message_id !== r.message_id || locator.session_id !== r.session_id
      || locator.character_start !== r.character_start || locator.character_end !== r.character_end
      || typeof r.character_start !== "number" || typeof r.character_end !== "number"
      || r.character_end - r.character_start !== excerpt.length || r.excerpt_sha256 !== sha256(excerpt)) return memoryLiteralUnavailable();
  } else if (locator.kind === "message") return memoryLiteralUnavailable();
}
export async function verifyMemoryLiteralProposalRow(row: LiteralRow) {
  if (typeof row.account_id !== "string" || !MEMORY_LITERAL_UUID.test(row.account_id)) return memoryLiteralUnavailable();
  const protocol = resolveMemoryContentProtocol(row.content_protocol);
  requireMemoryLiteral(row.display_text as string, "statement"); requireMemoryLiteral(row.source_excerpt as string, "excerpt");
  if (row.original_display_text !== null) requireMemoryLiteral(row.original_display_text as string, "statement");
  if (protocol === "legacy-v1") {
    if (row.content_manifest != null || row.content_manifest_digest != null) return memoryLiteralUnavailable();
    return null;
  }
  const m = plainManifest(row.content_manifest, ["version", "original_content_protocol", "display_text", "original_display_text", "source_excerpt",
    "source_revision_hash", "source_locator_sha256", "message_range"]);
  if (row.source_revision_hash !== m.source_revision_hash) return memoryLiteralUnavailable();
  assertMemoryLiteralLocator(row, m, row.source_excerpt as string);
  if (row.source_excerpt_hash !== undefined && row.source_excerpt_hash !== sha256(row.source_excerpt as string)) return memoryLiteralUnavailable();
  const expected = await createMemoryContentManifest({ display_text: row.display_text as string, original_display_text: row.original_display_text as string | null,
    original_content_protocol: m.original_content_protocol as "legacy-v1" | "literal-v2", source_excerpt: row.source_excerpt as string,
    source_revision_hash: m.source_revision_hash as string, source_locator_sha256: m.source_locator_sha256 as string,
    message_range: m.message_range as Parameters<typeof createMemoryContentManifest>[0]["message_range"] }, sha256);
  same(row.content_manifest, expected.content_manifest);
  if (row.content_manifest_digest !== expected.content_manifest_digest) return memoryLiteralUnavailable();
  return expected.content_manifest;
}
export async function verifyMemoryLiteralEvidenceRow(row: LiteralRow) {
  const protocol = resolveMemoryContentProtocol(row.content_protocol);
  if (row.status !== "active" || row.content_version !== 1) return memoryLiteralUnavailable();
  requireMemoryLiteral(row.excerpt as string, "excerpt");
  if (row.content_hash !== undefined && row.content_hash !== sha256(row.excerpt as string)) return memoryLiteralUnavailable();
  if (protocol === "legacy-v1") {
    if (row.content_manifest != null || row.content_manifest_digest != null) return memoryLiteralUnavailable();
    return null;
  }
  const m = plainManifest(row.content_manifest, ["version", "excerpt", "source_revision_hash", "source_locator_sha256", "message_range"]);
  assertMemoryLiteralLocator(row, m, row.excerpt as string);
  const expected = await createMemoryEvidenceManifest({ source_excerpt: row.excerpt as string, source_revision_hash: m.source_revision_hash as string,
    source_locator_sha256: m.source_locator_sha256 as string,
    message_range: m.message_range as Parameters<typeof createMemoryEvidenceManifest>[0]["message_range"] }, sha256);
  same(row.content_manifest, expected.content_manifest);
  if (row.content_manifest_digest !== expected.content_manifest_digest) return memoryLiteralUnavailable();
  return expected.content_manifest;
}
export async function verifyMemoryLiteralAcceptedRow(row: LiteralRow, evidence: readonly LiteralRow[]) {
  const protocol = resolveMemoryContentProtocol(row.content_protocol);
  if (row.status !== "active" || evidence.length > 10 || typeof row.account_id !== "string" || !MEMORY_LITERAL_UUID.test(row.account_id)) return memoryLiteralUnavailable();
  requireMemoryLiteral(row.display_text as string, "statement");
  if (row.original_display_text !== null) requireMemoryLiteral(row.original_display_text as string, "statement");
  const ids = new Set<unknown>();
  for (const e of evidence) {
    if (e.memory_item_id !== row.id || e.account_id !== row.account_id || ids.has(e.id)) return memoryLiteralUnavailable();
    ids.add(e.id);
  }
  const evidenceManifests = await Promise.all(evidence.map(verifyMemoryLiteralEvidenceRow));
  if (protocol === "legacy-v1") {
    if (row.content_manifest != null || row.content_manifest_digest != null) return memoryLiteralUnavailable();
    return { manifest: null, evidenceManifests };
  }
  const m = plainManifest(row.content_manifest, ["version", "original_content_protocol", "display_text", "original_display_text", "reviewed_evidence"]);
  const refs = evidence.map(e => ({ evidence_id: e.id, content_protocol: resolveMemoryContentProtocol(e.content_protocol),
    content_version: 1, content_manifest_digest: e.content_manifest_digest ?? null })) as MemoryAcceptedEvidenceReference[];
  const expected = await createMemoryAcceptedContentManifest({ display_text: row.display_text, original_display_text: row.original_display_text,
    original_content_protocol: m.original_content_protocol, reviewed_evidence: refs }, sha256);
  same(row.content_manifest, expected.content_manifest);
  if (row.content_manifest_digest !== expected.content_manifest_digest) return memoryLiteralUnavailable();
  return { manifest: expected.content_manifest, evidenceManifests };
}
