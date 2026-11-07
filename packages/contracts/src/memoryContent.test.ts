import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeMemoryText, requireMemoryLiteral, memoryLiteralDescriptor,
  encodeMemoryLiteralRequest, memoryContentPage, resolveMemoryContentProtocol,
  createMemoryContentManifest,
  type MemoryTextStatistics,
} from "./memoryContent.js";

const golden = JSON.parse(readFileSync(new URL("./memoryContentGolden.json", import.meta.url), "utf8")) as {
  vectors: Array<{ text: string; sha256: string } & MemoryTextStatistics>;
  manifest_digest_sha256: string;
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
