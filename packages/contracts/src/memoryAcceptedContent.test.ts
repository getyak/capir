import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMemoryAcceptedContentManifest, type MemoryAcceptedContentManifestInput } from "./memoryAcceptedContent.js";
import { MemoryContentError } from "./memoryContent.js";

const golden = JSON.parse(readFileSync(new URL("./memoryAcceptedContentGolden.json", import.meta.url), "utf8")) as {
  vectors: Array<{ name: string; input: MemoryAcceptedContentManifestInput; manifest: unknown; manifest_digest_sha256: string }>;
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const fresh = () => structuredClone(golden.vectors[1]!.input);

describe("accepted Memory literal manifest is independent from evidence proofs", () => {
  it.each(golden.vectors)("matches independent ASCII tuple golden: $name", async vector => {
    const value = await createMemoryAcceptedContentManifest(vector.input, digest);
    expect(value.content_protocol).toBe("literal-v2");
    expect(value.content_manifest).toEqual(vector.manifest);
    expect(value.content_manifest_digest).toBe(vector.manifest_digest_sha256);
    expect(value.content_manifest).not.toHaveProperty("source_revision_hash");
    expect(value.content_manifest).not.toHaveProperty("source_excerpt");
    expect(value.content_manifest).not.toHaveProperty("message_range");
  });

  it("copies legacy evidence references without certifying their old raw bytes or inventing current source proof", async () => {
    const input = fresh();
    const before = structuredClone(input);
    const value = await createMemoryAcceptedContentManifest(input, digest);
    expect(value.content_manifest.original_display_text).toBeNull();
    expect(value.content_manifest.original_content_protocol).toBe("legacy-v1");
    expect(value.content_manifest.reviewed_evidence[0]).toEqual(input.reviewed_evidence[0]);
    expect(value.content_manifest.reviewed_evidence[0]!.content_manifest_digest).toBeNull();
    expect(value.content_manifest.reviewed_evidence[1]!.content_manifest_digest).toBe(input.reviewed_evidence[1]!.content_manifest_digest);
    expect(input).toEqual(before);
  });

  it("sorts UUID metadata with ASCII order, normalizes UUID case and rejects duplicate identities", async () => {
    const input = fresh();
    input.reviewed_evidence[0]!.evidence_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    input.reviewed_evidence[1]!.evidence_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const expected = await createMemoryAcceptedContentManifest(input, digest);
    const reversed = [...input.reviewed_evidence].reverse().map(ref => ({ ...ref, evidence_id: ref.evidence_id.toUpperCase() }));
    expect((await createMemoryAcceptedContentManifest({ ...input, reviewed_evidence: reversed }, digest)).content_manifest_digest)
      .toBe(expected.content_manifest_digest);
    await expect(createMemoryAcceptedContentManifest({ ...input, reviewed_evidence: [input.reviewed_evidence[0],
      { ...input.reviewed_evidence[0]!, evidence_id: input.reviewed_evidence[0]!.evidence_id.toUpperCase() }] }, digest))
      .rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" });
  });

  it.each(["final", "original", "evidence_id", "evidence_digest"])("changes the accepted identity when %s changes", async field => {
    const input = fresh();
    if (field === "final") input.display_text = "Human corrected Ae\u0301🙂";
    if (field === "original") input.original_display_text = "Known stored legacy rendering";
    if (field === "evidence_id") input.reviewed_evidence[0]!.evidence_id = "33333333-3333-4333-8333-333333333333";
    if (field === "evidence_digest") input.reviewed_evidence[1]!.content_manifest_digest = "a".repeat(64);
    expect((await createMemoryAcceptedContentManifest(input, digest)).content_manifest_digest)
      .not.toBe(golden.vectors[1]!.manifest_digest_sha256);
  });

  it("keeps exact statement bytes and derives internally consistent descriptors at the UTF8 bound", async () => {
    const text = "  Ａe\u0301🙂\r\n" + "a".repeat(32_768 - Buffer.byteLength("  Ａe\u0301🙂\r\n"));
    const value = await createMemoryAcceptedContentManifest({ ...fresh(), display_text: text }, digest);
    expect(value.content_manifest.display_text).toEqual({ sha256: digest(text), utf8_bytes: 32_768,
      utf16_code_units: text.length, unicode_scalar_count: Array.from(text).length });
    await expect(createMemoryAcceptedContentManifest({ ...fresh(), display_text: text + "a" }, digest))
      .rejects.toMatchObject({ code: "MEMORY_CONTENT_LIMIT" });
  });

  it("accepts the finite 10-reference boundary without dropping or aliasing a reference", async () => {
    const input = fresh();
    input.reviewed_evidence = Array.from({ length: 10 }, (_, index) => ({ ...input.reviewed_evidence[0]!,
      evidence_id: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111` }));
    const value = await createMemoryAcceptedContentManifest(input, digest);
    expect(value.content_manifest.reviewed_evidence).toHaveLength(10);
    expect(value.content_manifest.reviewed_evidence).not.toBe(input.reviewed_evidence);
  });

  it.each(["display_text", "original_display_text"])("rejects PG TEXT/JSONB-incompatible NUL and lone surrogates in %s", async field => {
    for (const text of ["before\0after", "before\ud800after", "before\udfffafter"])
      await expect(createMemoryAcceptedContentManifest({ ...fresh(), [field]: text }, digest))
        .rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" });
  });

  it.each(["unknown_original", "null_v2_original", "empty_refs", "too_many_refs", "legacy_digest", "v2_null_digest", "unknown_evidence_protocol", "wrong_version", "extra_source", "extra_descriptor"])(
    "refuses invalid/unsupported metadata rather than filling it: %s", async kind => {
      const input = fresh() as unknown as Record<string, unknown>;
      const refs = input.reviewed_evidence as Array<Record<string, unknown>>;
      if (kind === "unknown_original") input.original_content_protocol = "literal-v3";
      if (kind === "null_v2_original") input.original_content_protocol = "literal-v2";
      if (kind === "empty_refs") input.reviewed_evidence = [];
      if (kind === "too_many_refs") input.reviewed_evidence = Array.from({ length: 11 }, (_, index) => ({ ...refs[0],
        evidence_id: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111` }));
      if (kind === "legacy_digest") refs[0]!.content_manifest_digest = "a".repeat(64);
      if (kind === "v2_null_digest") refs[1]!.content_manifest_digest = null;
      if (kind === "unknown_evidence_protocol") refs[1]!.content_protocol = "literal-v3";
      if (kind === "wrong_version") refs[1]!.content_version = 2;
      if (kind === "extra_source") input.source_revision_hash = "a".repeat(64);
      if (kind === "extra_descriptor") input.display_text_descriptor = { sha256: "a".repeat(64) };
      await expect(createMemoryAcceptedContentManifest(input, digest)).rejects.toMatchObject({ name: "MemoryContentError" });
    });

  it.each(["root", "ref", "array_slot", "toJSON", "nonenumerable", "symbol"])(
    "uses only exact own data slots without executing getters or serializers: %s", async location => {
      const input = fresh(); let reads = 0;
      const get = () => { reads += 1; throw new Error("synthetic private getter"); };
      if (location === "root") Object.defineProperty(input, "display_text", { get });
      if (location === "ref") Object.defineProperty(input.reviewed_evidence[1]!, "content_manifest_digest", { get });
      if (location === "array_slot") Object.defineProperty(input.reviewed_evidence, "0", { get });
      if (location === "toJSON") Object.defineProperty(input, "toJSON", { get });
      if (location === "nonenumerable") Object.defineProperty(input, "display_text", { enumerable: false });
      if (location === "symbol") Object.defineProperty(input, Symbol("hidden"), { value: "synthetic private" });
      await expect(createMemoryAcceptedContentManifest(input, digest)).rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" });
      expect(reads).toBe(0);
    });

  it.each(["id", "protocol", "version", "hash", "returned_digest"])("does not coerce invalid %s metadata", async field => {
    const input = fresh(); let conversions = 0;
    const bad = Object.defineProperty({}, "toString", { get() { conversions += 1; throw new Error("synthetic private conversion"); } });
    const ref = input.reviewed_evidence[1] as unknown as Record<string, unknown>;
    if (field === "id") ref.evidence_id = bad;
    if (field === "protocol") ref.content_protocol = bad;
    if (field === "version") ref.content_version = bad;
    if (field === "hash") ref.content_manifest_digest = bad;
    await expect(createMemoryAcceptedContentManifest(input, field === "returned_digest" ? () => bad as unknown as string : digest))
      .rejects.toMatchObject({ name: "MemoryContentError" });
    expect(conversions).toBe(0);
  });

  it.each(["evidence_id", "content_protocol", "content_manifest_digest"])("rejects NUL in retained evidence %s metadata", async field => {
    const input = fresh();
    (input.reviewed_evidence[1] as unknown as Record<string, unknown>)[field] = "before\0after";
    await expect(createMemoryAcceptedContentManifest(input, digest)).rejects.toMatchObject({ name: "MemoryContentError" });
  });

  it("does not inspect a private exception thrown by reflective input or leak digest failures", async () => {
    const input = fresh(); let reads = 0;
    const error = new MemoryContentError("MEMORY_CONTENT_LIMIT");
    Object.defineProperty(error, "code", { get() { reads += 1; throw new Error("synthetic private exception getter"); } });
    input.reviewed_evidence = new Proxy(input.reviewed_evidence, { getPrototypeOf() { throw error; } });
    await expect(createMemoryAcceptedContentManifest(input, digest)).rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" });
    expect(reads).toBe(0);
    await expect(createMemoryAcceptedContentManifest(fresh(), () => { throw new Error("synthetic private digest failure"); }))
      .rejects.toMatchObject({ message: "MEMORY_CONTENT_INVALID" });
  });

  it("captures all input before digest awaits and returns a fresh deeply frozen manifest", async () => {
    const input = fresh();
    const pending = createMemoryAcceptedContentManifest(input, async value => { await Promise.resolve(); return digest(value); });
    input.display_text = "changed";
    input.reviewed_evidence[0]!.evidence_id = "33333333-3333-4333-8333-333333333333";
    input.reviewed_evidence.reverse();
    const value = await pending;
    expect(value.content_manifest_digest).toBe(golden.vectors[1]!.manifest_digest_sha256);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.content_manifest)).toBe(true);
    expect(Object.isFrozen(value.content_manifest.display_text)).toBe(true);
    expect(Object.isFrozen(value.content_manifest.reviewed_evidence)).toBe(true);
    expect(Object.isFrozen(value.content_manifest.reviewed_evidence[0])).toBe(true);
  });
});
