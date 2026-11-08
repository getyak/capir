/** Pure preparation of an already host-admitted source. This creates no
 * proposal, evidence, accepted row, retention claim or read authority. */
import { Value } from "@sinclair/typebox/value";
import type { Static } from "@sinclair/typebox";
import { captureMemoryLiteralData, canonicalMemoryLiteralJson, createMemoryContentManifest,
  encodeMemoryLiteralRequest, freezeMemoryLiteralData, MemoryContentError, MemoryLiteralCandidateV2Schema,
  memoryLiteralInvalid, memoryLiteralRecord, requireMemoryLiteral, describeMemoryText, MEMORY_LITERAL_HASH, verifyMemoryMessageRange,
  type MemoryMessageRangeV2 } from "@talent-signal/contracts";
import { sha256 } from "../lib/hash.js";
import { sourceRevisionHash, type MemorySourceAuthority } from "./memoryReviewStore.js";

type Candidate = Static<typeof MemoryLiteralCandidateV2Schema>;
type Digest = (text: string) => string | Promise<string>;
const rangeInvalid = (): never => { throw new MemoryContentError("MEMORY_CONTENT_RANGE_INVALID"); };

function grounding(item: Candidate, host: MemorySourceAuthority, revision: string): Readonly<MemoryMessageRangeV2> | null {
  const locator = item.source_locator;
  if (locator.kind === "message") {
    if (typeof host.text !== "string" || host.messageId === null || host.messageTextHash !== sha256(host.text)
      || locator.message_id !== host.messageId || locator.session_id !== host.sessionId
      || locator.character_start === undefined || locator.character_end === undefined) return rangeInvalid();
    return verifyMemoryMessageRange(item.source_excerpt, { ...locator, range_version: 1,
      representation: "authored_message_text.v1", offset_unit: "utf16_code_unit", source_revision_hash: revision,
      source_text_sha256: host.messageTextHash, excerpt_sha256: sha256(item.source_excerpt) }, {
      text: host.text, session_id: host.sessionId, message_id: host.messageId,
      source_revision_hash: revision, source_text_sha256: host.messageTextHash });
  }
  if (locator.kind === "image_region") {
    const matches = host.artifacts.filter(artifact => artifact.kind === "image" && artifact.artifactId === locator.artifact_id);
    const artifact = matches[0];
    if (matches.length !== 1 || !artifact || typeof artifact.contentHash !== "string" || !MEMORY_LITERAL_HASH.test(artifact.contentHash) || artifact.sessionId !== host.sessionId
      || artifact.messageId !== host.messageId || locator.session_id !== artifact.sessionId) return rangeInvalid();
    // The current source owner binds attachment identity into its canonical
    // artifact ID. Keep the older image-N owner shape as an explicit alias;
    // neither name suffices without this actual admitted artifact + manifest.
    const manifests = host.imageManifest.filter(image => image.contentHash === artifact.contentHash
      && (locator.image_index === undefined || image.index === locator.image_index)
      && (artifact.artifactId === "image-" + image.index
        || artifact.artifactId === "conversation-image-" + artifact.messageId + "-" + image.index + "-" + image.attachmentId));
    if (manifests.length !== 1) return rangeInvalid();
    const region = locator.region;
    if (region && (region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1)) return rangeInvalid();
    return null;
  }
  // The current authority DTO has no independently loaded document text or
  // extraction version. Do not invent ranges/proof from an opaque locator.
  return rangeInvalid();
}

export async function prepareMemoryLiteralProposalBatch(value: unknown, authority: MemorySourceAuthority, digest: Digest) {
  try {
    // Negotiate explicitly, including absent/undefined markers, without
    // consulting a caller getter. Legacy callers use the unchanged old owner.
    const marker = value !== null && typeof value === "object"
      ? Object.getOwnPropertyDescriptor(value, "content_protocol") : undefined;
    if (!marker || ("value" in marker && marker.value !== "literal-v2")) throw new MemoryContentError("MEMORY_CONTENT_VERSION_UNSUPPORTED");
    if (!("value" in marker)) return memoryLiteralInvalid();
    const snapshot = memoryLiteralRecord(captureMemoryLiteralData(value), ["content_protocol", "items"]);
    const request = encodeMemoryLiteralRequest(snapshot);
    if (!Array.isArray(snapshot.items) || snapshot.items.length > 40) return memoryLiteralInvalid();
    const items = snapshot.items.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return memoryLiteralInvalid();
      const raw = item as Record<string, unknown>;
      // Byte limits have their own refusal, even when the JSON schema also
      // bounds string length. No partial result is returned for a late item.
      requireMemoryLiteral(raw.display_text as string, "statement"); requireMemoryLiteral(raw.source_excerpt as string, "excerpt");
      if (!Value.Check(MemoryLiteralCandidateV2Schema, item)) return memoryLiteralInvalid();
      const candidate = item as Candidate;
      if (candidate.previous_text != null && describeMemoryText(candidate.previous_text).utf8_bytes > 32_768) throw new MemoryContentError("MEMORY_CONTENT_LIMIT");
      return candidate;
    });
    // No caller-owned source object survives the first digest await. The host
    // remains responsible for reloading/rechecking this authority at real I/O.
    const host = captureMemoryLiteralData(authority) as MemorySourceAuthority;
    const revision = sourceRevisionHash(host);
    const prepared = items.map(item => ({ item, range: grounding(item, host, revision),
      locatorHash: sha256(canonicalMemoryLiteralJson(item.source_locator)) }));
    const result = [];
    for (const current of prepared) {
      const item = current.item;
      const metadata = await createMemoryContentManifest({ display_text: item.display_text,
        original_display_text: item.display_text, original_content_protocol: "literal-v2", source_excerpt: item.source_excerpt,
        source_revision_hash: revision, source_locator_sha256: current.locatorHash, message_range: current.range }, digest);
      result.push(freezeMemoryLiteralData({ ...item, original_display_text: item.display_text, ...metadata }));
    }
    return freezeMemoryLiteralData({ request, items: result });
  } catch (error) {
    if (error instanceof MemoryContentError) throw error;
    return memoryLiteralInvalid();
  }
}
