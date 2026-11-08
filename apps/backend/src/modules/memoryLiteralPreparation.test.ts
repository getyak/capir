import { createHash } from "node:crypto";
import * as contracts from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import * as sourceOwner from "./memoryLiteralSource.js";
import { sourceRevisionHash, type MemorySourceAuthority } from "./memoryReviewStore.js";

type ObjectValue = Record<string, any>;
type Prepare = (input: unknown, authority: MemorySourceAuthority, digest: (text: string) => string) => Promise<ObjectValue>;
function prepare(): Prepare {
  const value: unknown = Reflect.get(sourceOwner, "prepareMemoryLiteralProposalBatch");
  expect(value, "new V2 preparation API is not implemented").toBeTypeOf("function");
  return value as Prepare;
}
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const session = "11111111-1111-4111-8111-111111111111", message = "22222222-2222-4222-8222-222222222222";
const sourceText = "  Ａe\u0301🙂 keep\r\nkeep  ";
const authority: MemorySourceAuthority = { text: sourceText, artifacts: [], sessionId: session, messageId: message,
  sourceTaskId: null, captureIds: [], messageTextHash: "7222906c71afc589dd32325738eead95d776b4b08a78a3be371d11ae0e3af4f0",
  imageManifest: [], captureVersion: null, captureSubjectId: null, captureContextId: null };
const locator = { kind: "message", session_id: session, message_id: message, character_start: 2, character_end: 7 };
const candidate = () => ({ scope: "self", operation: "add", statement_kind: "fact", display_text: sourceText,
  source_excerpt: "Ａe\u0301🙂", source_locator: { ...locator }, time_status: "unknown", sensitivity: "normal",
  reason: "Synthetic exact preparation" });
const request = (items = [candidate()]) => ({ content_protocol: "literal-v2", items });
const tuple = (d: ObjectValue) => [d.sha256, d.utf8_bytes, d.utf16_code_units, d.unicode_scalar_count];

describe("new V2 proposal preparation composes existing exact primitives", () => {
  it("fills provenance only from the actual host source and preserves every original literal byte", async () => {
    const input = request(), before = structuredClone(input), result = await prepare()(input, authority, hash);
    expect(input).toEqual(before); expect(result.items).toHaveLength(1);
    const item = result.items[0], manifest = item.content_manifest;
    expect(item.display_text).toBe(sourceText); expect(item.original_display_text).toBe(sourceText);
    expect(item.source_excerpt).toBe("Ａe\u0301🙂"); expect(item.content_protocol).toBe("literal-v2");
    expect(manifest.display_text).toEqual({ sha256: authority.messageTextHash, utf8_bytes: 25, utf16_code_units: 20, unicode_scalar_count: 19 });
    expect(manifest.original_display_text).toEqual(manifest.display_text);
    expect(manifest.source_excerpt).toEqual({ sha256: "3b0ea815af8a5c4e4f4cd4b9a1781d8337c8322ca63ce4f347285f4ec5e1466f",
      utf8_bytes: 10, utf16_code_units: 5, unicode_scalar_count: 4 });
    expect(manifest.source_revision_hash).toBe("ac5b7803204734c23058a3835c789b9ecc86393dab2b45e872bfd3f36ad7fedb");
    // Fixed ASCII-key canonical locator bytes, independent of the new helper.
    const locatorBytes = `{"character_end":7,"character_start":2,"kind":"message","message_id":"${message}","session_id":"${session}"}`;
    expect(manifest.source_locator_sha256).toBe(hash(locatorBytes));
    expect(manifest.message_range).toEqual({ ...locator, range_version: 1, representation: "authored_message_text.v1",
      offset_unit: "utf16_code_unit", source_revision_hash: manifest.source_revision_hash, source_text_sha256: authority.messageTextHash,
      excerpt_sha256: manifest.source_excerpt.sha256 });
    const range = manifest.message_range;
    expect(item.content_manifest_digest).toBe(hash(JSON.stringify(["literal-v2", "literal-v2", tuple(manifest.display_text),
      tuple(manifest.original_display_text), tuple(manifest.source_excerpt), manifest.source_revision_hash, manifest.source_locator_sha256,
      ["message", session, message, 1, "authored_message_text.v1", "utf16_code_unit", 2, 7,
        manifest.source_revision_hash, authority.messageTextHash, range.excerpt_sha256]])));
    expect(result.request).toEqual(contracts.encodeMemoryLiteralRequest(before));
    expect(Object.isFrozen(item.content_manifest.message_range)).toBe(true);
    expect(item).not.toHaveProperty("accepted"); expect(item).not.toHaveProperty("reviewed_evidence");
  });

  it("does not deduplicate byte-distinct NFKC-compatible candidate text during preparation", async () => {
    const first = candidate(), second = { ...candidate(), display_text: sourceText.normalize("NFKC") };
    const output = await prepare()(request([first, second]), authority, hash);
    expect(output.items.map((item: ObjectValue) => item.display_text)).toEqual([first.display_text, second.display_text]);
    expect(output.items[0].content_manifest.display_text.sha256).not.toBe(output.items[1].content_manifest.display_text.sha256);
  });

  it("uses the explicitly selected repeated occurrence and rejects an invented range", async () => {
    const item = { ...candidate(), source_excerpt: "keep", source_locator: { ...locator, character_start: 14, character_end: 18 } };
    const output = await prepare()(request([item]), authority, hash);
    expect(output.items[0].content_manifest.message_range).toMatchObject({ character_start: 14, character_end: 18 });
    await expect(prepare()(request([{ ...item, source_locator: { ...item.source_locator, character_start: 9, character_end: 13 } }]), authority, hash))
      .rejects.toMatchObject({ code: "MEMORY_CONTENT_RANGE_INVALID" });
  });

  it.each(["no_offsets", "split_pair", "equivalent_excerpt", "wrong_host_hash", "supplied_hash"])(
    "refuses malformed source binding %s without partial prepared items", async kind => {
      const item: ObjectValue = candidate(), host = structuredClone(authority);
      if (kind === "no_offsets") delete item.source_locator.character_start;
      if (kind === "split_pair") Object.assign(item.source_locator, { character_start: 5, character_end: 6 });
      if (kind === "equivalent_excerpt") item.source_excerpt = "Ae\u0301🙂";
      if (kind === "wrong_host_hash") host.messageTextHash = "0".repeat(64);
      if (kind === "supplied_hash") item.source_locator.source_revision_hash = "0".repeat(64);
      const before = JSON.stringify(item);
      await expect(prepare()({ content_protocol: "literal-v2", items: [candidate(), item] }, host, hash)).rejects.toBeDefined();
      expect(JSON.stringify(item)).toBe(before);
    });

  it.each([undefined, "legacy-v1", "literal-v3"])("does not silently negotiate the V2-only API from %s", async protocol => {
    await expect(prepare()({ ...request(), content_protocol: protocol }, authority, hash))
      .rejects.toMatchObject({ code: "MEMORY_CONTENT_VERSION_UNSUPPORTED" });
    expect(contracts.resolveMemoryContentProtocol(undefined)).toBe("legacy-v1");
  });

  it.each(["before\0after", "before\ud800after", "x".repeat(32769)])("rejects unpreservable or over-capacity statement %#", async text => {
    await expect(prepare()(request([{ ...candidate(), display_text: text }]), authority, hash)).rejects.toBeDefined();
  });

  it("charges all repeated request literals before producing anything and preserves a refused caller draft", async () => {
    const item = { ...candidate(), display_text: "x".repeat(32764), source_excerpt: "keep",
      source_locator: { ...locator, character_start: 14, character_end: 18 } };
    const exact = request(Array.from({ length: 8 }, () => structuredClone(item)));
    expect((await prepare()(exact, authority, hash)).request.literal_utf8_bytes).toBe(262144);
    const over = request([...exact.items, structuredClone(item)]), before = JSON.stringify(over);
    await expect(prepare()(over, authority, hash)).rejects.toMatchObject({ code: "MEMORY_CONTENT_LIMIT" });
    expect(JSON.stringify(over)).toBe(before);
  });

  it("measures actual encoded request escaping as a separate limit", async () => {
    const item = { ...candidate(), display_text: "\u0001".repeat(32764), source_excerpt: "keep",
      source_locator: { ...locator, character_start: 14, character_end: 18 } };
    const input = request(Array.from({ length: 8 }, () => structuredClone(item)));
    expect(Buffer.byteLength(JSON.stringify(input), "utf8")).toBeGreaterThan(1048576);
    await expect(prepare()(input, authority, hash)).rejects.toMatchObject({ code: "MEMORY_CONTENT_LIMIT" });
  });

  it("enforces separate exact 32KiB statement and 64KiB supporting-excerpt capacities", async () => {
    const text = "x".repeat(65536), host = { ...authority, text, messageTextHash: hash(text) };
    const item = { ...candidate(), display_text: "🙂".repeat(8192), source_excerpt: text,
      source_locator: { ...locator, character_start: 0, character_end: text.length } };
    const output = await prepare()(request([item]), host, hash);
    expect(output.items[0].content_manifest.display_text.utf8_bytes).toBe(32768);
    expect(output.items[0].content_manifest.source_excerpt.utf8_bytes).toBe(65536);
    const overText = text + "x";
    await expect(prepare()(request([{ ...item, source_excerpt: overText,
      source_locator: { ...item.source_locator, character_end: overText.length } }]),
    { ...host, text: overText, messageTextHash: hash(overText) }, hash)).rejects.toMatchObject({ code: "MEMORY_CONTENT_LIMIT" });
  });

  it("keeps admitted image proof separate from authored text ranges without granting pixel transcription", async () => {
    const host: MemorySourceAuthority = { ...authority, text: null, messageTextHash: null,
      artifacts: [{ artifactId: "image-0", kind: "image", sessionId: session, messageId: message,
        captureId: null, sourceResourceId: null, evidenceFragmentId: null, contentHash: "a".repeat(64), captureVersion: null }],
      imageManifest: [{ index: 0, attachmentId: message, contentHash: "a".repeat(64) }] };
    const item = { ...candidate(), source_excerpt: "Synthetic visible image excerpt", source_locator: {
      kind: "image_region", artifact_id: "image-0", session_id: session, image_index: 0, region: null } };
    const output = await prepare()({ content_protocol: "literal-v2", items: [item] }, host, hash);
    expect(output.items[0].content_manifest.message_range).toBeNull();
    expect(output.items[0].content_manifest).not.toHaveProperty("source_text_sha256");
    await expect(prepare()({ content_protocol: "literal-v2", items: [{ ...item,
      source_locator: { ...item.source_locator, artifact_id: "not-admitted" } }] }, host, hash)).rejects.toBeDefined();
  });

  it("retains independent proposal/evidence/accepted domains instead of certifying accepted state during stage", async () => {
    const prepared = (await prepare()(request(), authority, hash)).items[0];
    const proof = prepared.content_manifest;
    const evidence = await contracts.createMemoryEvidenceManifest({ source_excerpt: prepared.source_excerpt,
      source_revision_hash: proof.source_revision_hash, source_locator_sha256: proof.source_locator_sha256,
      message_range: proof.message_range }, hash);
    const accepted = await contracts.createMemoryAcceptedContentManifest({ display_text: "A later human correction", original_display_text: prepared.original_display_text,
      original_content_protocol: "literal-v2", reviewed_evidence: [{ evidence_id: message, content_protocol: "literal-v2", content_version: 1,
        content_manifest_digest: evidence.content_manifest_digest }] }, hash);
    expect(evidence.content_manifest).not.toHaveProperty("display_text");
    expect(accepted.content_manifest).not.toHaveProperty("source_excerpt");
    expect(new Set([prepared.content_manifest_digest, evidence.content_manifest_digest, accepted.content_manifest_digest]).size).toBe(3);
    expect(accepted.content_manifest.reviewed_evidence[0]?.content_manifest_digest).toBe(evidence.content_manifest_digest);
    expect(sourceRevisionHash(authority)).toBe(proof.source_revision_hash);
  });
});
