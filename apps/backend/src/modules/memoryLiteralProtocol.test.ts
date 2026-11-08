import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeMemoryText, requireMemoryLiteral, memoryLiteralDescriptor,
  encodeMemoryLiteralRequest, memoryContentPage, resolveMemoryContentProtocol,
  createMemoryContentManifest, createMemoryEvidenceManifest,
  type MemoryTextStatistics, type MemoryEvidenceManifestInput,
} from "@talent-signal/contracts";

const golden = JSON.parse(readFileSync(new URL("../../../../packages/contracts/src/memoryContentGolden.json", import.meta.url), "utf8")) as {
  vectors: Array<{ text: string; sha256: string } & MemoryTextStatistics>;
  manifest_digest_sha256: string;
  evidence_manifests: Array<{ name: string; input: MemoryEvidenceManifestInput; excerpt_descriptor: MemoryTextStatistics & { sha256: string }; manifest_digest_sha256: string }>;
};

describe("literal-v2 lossless content and transport limits", () => {
  it.each(["descriptor", "source_revision_hash", "source_locator_sha256"].flatMap(field =>
    ["array", "coercible", "toString-getter"].map(shape => ({ field, shape }))))(
    "rejects a non-string $field ($shape) without coercion", async ({ field, shape }) => {
      const hash = "a".repeat(64);
      let coercions = 0;
      const value = shape === "array" ? [hash] : shape === "coercible"
        ? { toString() { coercions += 1; return hash; } }
        : Object.defineProperty({}, "toString", { get() { coercions += 1; throw new Error("synthetic private coercion"); } });
      let failure: unknown;
      try {
        if (field === "descriptor") memoryLiteralDescriptor("literal", "statement", value as unknown as string);
        else await createMemoryContentManifest({ display_text: "literal", original_display_text: "literal",
          original_content_protocol: "literal-v2", source_excerpt: "literal", source_revision_hash: hash,
          source_locator_sha256: hash, message_range: null, [field]: value as unknown as string },
        text => createHash("sha256").update(text).digest("hex"));
      } catch (error) { failure = error; }
      expect(coercions).toBe(0);
      expect(failure).toMatchObject({ code: "MEMORY_CONTENT_INVALID" });
    });

  it.each(golden.vectors)("preserves independently counted literal %#", vector => {
    expect(describeMemoryText(vector.text)).toEqual({ utf8_bytes: vector.utf8_bytes,
      utf16_code_units: vector.utf16_code_units, unicode_scalar_count: vector.unicode_scalar_count });
    expect(createHash("sha256").update(vector.text, "utf8").digest("hex")).toBe(vector.sha256);
    if (vector.text.trim()) {
      expect(requireMemoryLiteral(vector.text, "statement")).toBe(vector.text);
      expect(memoryLiteralDescriptor(vector.text, "statement", vector.sha256)).toMatchObject({ sha256: vector.sha256,
        utf8_bytes: vector.utf8_bytes, utf16_code_units: vector.utf16_code_units,
        unicode_scalar_count: vector.unicode_scalar_count });
    }
  });

  it.each(["\ud800", "\udfff", "a\ud800z", "a\u0000z"])("refuses strings the storage cannot preserve exactly %#", value => {
    expect(() => describeMemoryText(value)).toThrow();
    expect(() => requireMemoryLiteral(value, "excerpt")).toThrow();
  });

  it("keeps exact UTF-8 capacity across one/two/three/four-byte scalars", () => {
    for (const [scalar, count] of [["a", 32768], ["é", 16384], ["界", 10922], ["🙂", 8192]] as const) {
      const value = scalar.repeat(count);
      expect(requireMemoryLiteral(value, "statement")).toBe(value);
      expect(() => requireMemoryLiteral(value + scalar, "statement")).toThrow();
    }
    const excerpt = "🙂".repeat(16384);
    expect(requireMemoryLiteral(excerpt, "excerpt")).toBe(excerpt);
    expect(() => requireMemoryLiteral(excerpt + "a", "excerpt")).toThrow();
  });

  it("charges every literal copy instead of deduplicating shared request objects", () => {
    const item = { display_text: "a".repeat(32768) };
    const encoded = encodeMemoryLiteralRequest({ items: Array(8).fill(item) });
    expect(encoded.literal_utf8_bytes).toBe(262144);
    expect(JSON.parse(encoded.body).items).toHaveLength(8);
    expect(() => encodeMemoryLiteralRequest({ items: Array(9).fill(item) })).toThrow();
  });

  it("charges edited-text maps and original/previous/excerpt copies together", () => {
    expect(encodeMemoryLiteralRequest({ display_text: "Ａ", original_display_text: "Ａ",
      previous_text: "é", source_excerpt: "e\u0301", edited_text: { first: "🙂", second: "x" } })
      .literal_utf8_bytes).toBe(16);
  });

  it("rejects actual JSON escaping overflow even when decoded literals fit", () => {
    const request = { items: Array.from({ length: 8 }, () => ({ display_text: "\u0001".repeat(32768) })) };
    expect(() => encodeMemoryLiteralRequest(request)).toThrow();
  });

  it("returns a scalar-safe bounded page with honest remaining coverage", () => {
    const value = "a".repeat(16383) + "🙂tail";
    const first = memoryContentPage(value, 0);
    expect(first.text).toBe("a".repeat(16383));
    expect(first).toMatchObject({ start_utf16: 0, end_utf16: 16383, has_more: true, next_offset: 16383 });
    const last = memoryContentPage(value, first.next_offset!);
    expect(last.text).toBe("🙂tail");
    expect(last).toMatchObject({ has_more: false, next_offset: null });
    expect(first.text + last.text).toBe(value);
    expect(() => memoryContentPage(value, 16384)).toThrow();
  });

  it("reduces escaped pages to the encoded budget without dropping the tail", () => {
    const source = "\u0001".repeat(16384);
    const first = memoryContentPage(source, 0);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(65536);
    expect(first.has_more).toBe(true);
    expect(first.next_offset).toBeGreaterThan(0);
    const last = memoryContentPage(source, first.next_offset!);
    expect(first.text + last.text).toBe(source);
    expect(last.has_more).toBe(false);
  });

  it("keeps legacy absence distinguishable and rejects unsupported versions", () => {
    expect(resolveMemoryContentProtocol(undefined)).toBe("legacy-v1");
    expect(resolveMemoryContentProtocol("literal-v2")).toBe("literal-v2");
    expect(() => resolveMemoryContentProtocol(null)).toThrow();
    expect(() => resolveMemoryContentProtocol("literal-v3")).toThrow();
  });

  it("binds the literal proposed/final/excerpt bytes and source revision separately", async () => {
    const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
    const source = { original_content_protocol: "literal-v2" as const,
      source_revision_hash: "a".repeat(64), source_locator_sha256: "b".repeat(64), message_range: null };
    const first = await createMemoryContentManifest({ display_text: "é", original_display_text: "e\u0301",
      source_excerpt: "e\u0301", ...source }, digest);
    expect(first.content_protocol).toBe("literal-v2");
    expect(first.content_manifest_digest).toBe(golden.manifest_digest_sha256);
    expect(first.content_manifest.display_text.utf8_bytes).toBe(2);
    expect(first.content_manifest.original_display_text?.utf8_bytes).toBe(3);
    expect(first.content_manifest.display_text.sha256).not.toBe(first.content_manifest.original_display_text?.sha256);
    const changed = await createMemoryContentManifest({ display_text: "e\u0301", original_display_text: "e\u0301",
      source_excerpt: "e\u0301", ...source }, digest);
    expect(first.content_manifest_digest).not.toBe(changed.content_manifest_digest);
    const rebound = await createMemoryContentManifest({ display_text: "é", original_display_text: "e\u0301",
      source_excerpt: "e\u0301", ...source, source_revision_hash: "c".repeat(64) }, digest);
    expect(first.content_manifest_digest).not.toBe(rebound.content_manifest_digest);
    const legacy = await createMemoryContentManifest({ display_text: "é", original_display_text: "e\u0301",
      source_excerpt: "e\u0301", ...source, original_content_protocol: "legacy-v1" }, digest);
    expect(legacy.content_manifest.original_content_protocol).toBe("legacy-v1");
    expect(legacy.content_manifest_digest).not.toBe(first.content_manifest_digest);
    const unknownOriginal = await createMemoryContentManifest({ display_text: "é", original_display_text: null,
      source_excerpt: "e\u0301", ...source, original_content_protocol: "legacy-v1" }, digest);
    expect(unknownOriginal.content_manifest.original_display_text).toBeNull();
    await expect(createMemoryContentManifest({ display_text: "é", original_display_text: null,
      source_excerpt: "e\u0301", ...source }, digest)).rejects.toThrow();
    expect(Object.isFrozen(first.content_manifest)).toBe(true);
  });
});


describe("independent literal-v2 evidence manifest", () => {
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  it.each(golden.evidence_manifests)("matches independent evidence-only ASCII golden $name", async vector => {
    const result = await createMemoryEvidenceManifest(vector.input, digest);
    expect(result.content_protocol).toBe("literal-v2");
    expect(result.content_manifest).toEqual({ version: "literal-v2", excerpt: vector.excerpt_descriptor,
      source_revision_hash: vector.input.source_revision_hash, source_locator_sha256: vector.input.source_locator_sha256,
      message_range: vector.input.message_range });
    expect(result.content_manifest_digest).toBe(vector.manifest_digest_sha256);
    expect(result.content_manifest).not.toHaveProperty("display_text");
    expect(result.content_manifest).not.toHaveProperty("original_display_text");
    expect(Object.isFrozen(result.content_manifest.excerpt)).toBe(true);
  });

  it("does not rebind earlier evidence when an item is corrected or more evidence is attached", async () => {
    const old = await createMemoryEvidenceManifest(golden.evidence_manifests[0]!.input, digest);
    const saved = JSON.stringify(old);
    const corrected = await createMemoryContentManifest({ ...golden.evidence_manifests[0]!.input,
      display_text: "Human corrected statement", original_display_text: null, original_content_protocol: "legacy-v1" }, digest);
    const next = await createMemoryEvidenceManifest({ ...golden.evidence_manifests[0]!.input, source_excerpt: "Another exact excerpt" }, digest);
    expect(corrected.content_manifest.original_content_protocol).toBe("legacy-v1");
    expect(old.content_manifest_digest).not.toBe(corrected.content_manifest_digest);
    expect(old.content_manifest_digest).not.toBe(next.content_manifest_digest);
    expect(JSON.stringify(old)).toBe(saved);
    expect(Object.isFrozen(old)).toBe(true);
  });

  it.each(["source_excerpt", "source_revision_hash", "source_locator_sha256", "message_range"] as const)(
    "changes evidence identity when %s changes", async key => {
      const source = golden.evidence_manifests[0]!.input;
      const input = { ...source, [key]: key === "source_excerpt" ? "é" : key === "message_range"
        ? { ...golden.evidence_manifests[1]!.input.message_range!, character_start: 3, character_end: 5, excerpt_sha256: digest(source.source_excerpt) }
        : "c".repeat(64) };
      expect((await createMemoryEvidenceManifest(input, digest)).content_manifest_digest)
        .not.toBe((await createMemoryEvidenceManifest(source, digest)).content_manifest_digest);
    });

  it.each(["source_revision_hash", "source_locator_sha256", "digest"] as const)(
    "rejects non-string %s without conversion", async key => {
      let conversions = 0;
      const invalid = Object.defineProperty({}, "toString", { get() { conversions += 1; throw new Error("synthetic private coercion"); } });
      const input = { ...golden.evidence_manifests[0]!.input,
        ...(key === "digest" ? {} : { [key]: invalid as unknown as string }) };
      await expect(createMemoryEvidenceManifest(input, key === "digest" ? () => invalid as unknown as string : digest))
        .rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" });
      expect(conversions).toBe(0);
    });

  it("captures binding and range before the first digest await", async () => {
    const input = structuredClone(golden.evidence_manifests[1]!.input);
    const pending = createMemoryEvidenceManifest(input, async value => { await Promise.resolve(); return digest(value); });
    input.source_excerpt = "changed";
    input.source_revision_hash = "c".repeat(64);
    Object.assign(input.message_range!, { character_start: 10 });
    const result = await pending;
    expect(result.content_manifest_digest).toBe(golden.evidence_manifests[1]!.manifest_digest_sha256);
    expect(Object.isFrozen(result.content_manifest.message_range)).toBe(true);
  });

  it("rejects source/range or excerpt/range mismatch rather than manufacturing a new source proof", async () => {
    const source = golden.evidence_manifests[1]!.input;
    await expect(createMemoryEvidenceManifest({ ...source, source_revision_hash: "c".repeat(64) }, digest))
      .rejects.toMatchObject({ code: "MEMORY_CONTENT_RANGE_INVALID" });
    await expect(createMemoryEvidenceManifest({ ...source, source_excerpt: "different" }, digest))
      .rejects.toMatchObject({ code: "MEMORY_CONTENT_RANGE_INVALID" });
  });
});


it("rejects an internally inconsistent evidence range length before it can describe stored bytes", async () => {
  const source = golden.evidence_manifests[1]!.input;
  await expect(createMemoryEvidenceManifest({ ...source,
    message_range: { ...source.message_range!, character_end: source.message_range!.character_end + 1 } },
    value => createHash("sha256").update(value).digest("hex")))
    .rejects.toMatchObject({ code: "MEMORY_CONTENT_RANGE_INVALID" });
});
