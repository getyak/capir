import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { createMemoryAcceptedContentManifest, createMemoryEvidenceManifest, MemoryLiteralPageSchema,
  MemoryLiteralPreviewSchema } from "@talent-signal/contracts";
import { createMemoryLiteralReference, createMemoryLiteralPreview, readMemoryLiteralPage } from "./memoryLiteralContent.js";

const id = "11111111-1111-4111-8111-111111111111";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function source(text = "  Ａe\u0301🙂 tail\r\n") {
  // Actual metadata producer; these are synthetic server-loaded literal rows,
  // not an authenticated DB/HTTP fixture or proof of current source access.
  const metadata = await createMemoryAcceptedContentManifest({ display_text: text, original_display_text: text,
    original_content_protocol: "literal-v2", reviewed_evidence: [{ evidence_id: id, content_protocol: "legacy-v1",
      content_version: 1, content_manifest_digest: null }] }, hash);
  return { target: { kind: "memory_item", item_id: id, item_version: 2, field: "display_text" }, text,
    content_protocol: metadata.content_protocol, content_manifest_digest: metadata.content_manifest_digest,
    stored_descriptor: metadata.content_manifest.display_text };
}
const request = (reference: unknown, offset = 0) => ({ page_version: 1, reference, offset });
const draft = (text = "Unconfirmed exact draft Ａe\u0301🙂\r\n") => ({ target: { kind: "review_draft", draft_id: id,
  draft_revision: 3, review_scope_id: "22222222-2222-4222-8222-222222222222", item_id: "33333333-3333-4333-8333-333333333333",
  field: "edited_text" }, text, content_protocol: "literal-v2", content_manifest_digest: null });

describe("host literal projections validate actual current stored bytes", () => {
  it("describes legacy stored bytes explicitly without inventing an exact legacy manifest", () => {
    const text = "  Ａe\u0301🙂 tail\r\n";
    const preview = createMemoryLiteralPreview({ target: { kind: "memory_item", item_id: id, item_version: 1, field: "display_text" }, text });
    expect(preview.reference.content_protocol).toBe("legacy-v1");
    expect(preview.reference.content_manifest_digest).toBeNull();
    expect(preview.reference.descriptor).toEqual({ sha256: hash(text), utf8_bytes: Buffer.byteLength(text),
      utf16_code_units: text.length, unicode_scalar_count: Array.from(text).length });
    expect(preview.text_preview).toBe(text);
    expect(preview.coverage.status).toBe("complete");
    expect(preview).not.toHaveProperty("display_text");
    expect(Value.Check(MemoryLiteralPreviewSchema, preview)).toBe(true);
  });

  it("returns a scalar-safe bounded UTF8 preview with truthful tail coverage", async () => {
    const row = await source("🙂".repeat(100) + " tail");
    const preview = createMemoryLiteralPreview(row);
    expect(preview.text_preview).toBe("🙂".repeat(64));
    expect(Buffer.byteLength(preview.text_preview)).toBe(256);
    expect(preview.coverage).toEqual({ status: "partial", start: 0, end: 128,
      total_utf16_code_units: row.text.length, total_utf8_bytes: Buffer.byteLength(row.text) });
    expect(Value.Check(MemoryLiteralPreviewSchema, preview)).toBe(true);
    expect(JSON.stringify(preview)).not.toContain(" tail");
    expect(Object.isFrozen(preview.coverage)).toBe(true);
  });

  it("pages escaped text within actual encoded budget without losing scalar boundaries or the tail", async () => {
    const row = await source("\u0001".repeat(16_000) + "🙂 final tail");
    const reference = createMemoryLiteralReference(row);
    let offset = 0; const pieces: string[] = []; let complete = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const page = readMemoryLiteralPage(row, request(reference, offset));
      expect(Value.Check(MemoryLiteralPageSchema, page)).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(65_536);
      expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(16_384);
      expect(page.start).toBe(offset);
      expect(page.text).toBe(row.text.slice(page.start, page.end));
      pieces.push(page.text);
      if (!page.has_more) { expect(page.next_offset).toBeNull(); complete = true; break; }
      expect(page.next_offset).toBe(page.end);
      expect(page.end).toBeGreaterThan(offset); offset = page.end;
    }
    expect(complete).toBe(true);
    expect(pieces.join("")).toBe(row.text);
    expect(pieces.length).toBeGreaterThan(1);
  });

  it("retains the separate 64KiB minimal evidence limit and 32KiB statement limit", async () => {
    const text = "x".repeat(65_536);
    const metadata = await createMemoryEvidenceManifest({ source_excerpt: text, source_revision_hash: "a".repeat(64),
      source_locator_sha256: "b".repeat(64), message_range: null }, hash);
    const row = { target: { kind: "memory_evidence", evidence_id: id, content_version: 1, field: "excerpt" }, text,
      content_protocol: metadata.content_protocol, content_manifest_digest: metadata.content_manifest_digest,
      stored_descriptor: metadata.content_manifest.excerpt };
    expect(createMemoryLiteralReference(row).descriptor.utf8_bytes).toBe(65_536);
    expect(() => createMemoryLiteralReference({ ...row, target: { kind: "memory_item", item_id: id,
      item_version: 1, field: "display_text" } })).toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_UNAVAILABLE" }));
  });

  it("does not certify previous text with a proposal manifest that never bound it", async () => {
    const row = await source();
    expect(() => createMemoryLiteralReference({ ...row, target: { kind: "proposal_item", item_id: id,
      item_added_revision: 2, field: "previous_text" } })).toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_UNAVAILABLE" }));
    // A prior accepted statement is read through that accepted row's own
    // current scoped identity/version/manifest, never the proposal's proof.
    expect(createMemoryLiteralReference(row).target.kind).toBe("memory_item");
  });

  it.each(["owner_id", "version", "manifest", "protocol", "text"])("rejects an old reference after current %s changes", async field => {
    const row = await source(); const reference = createMemoryLiteralReference(row);
    const current = field === "text" ? await source("A current changed exact literal") : structuredClone(row);
    if (field === "owner_id") current.target.item_id = "22222222-2222-4222-8222-222222222222";
    if (field === "version") current.target.item_version += 1;
    if (field === "manifest") current.content_manifest_digest = "c".repeat(64);
    if (field === "protocol") Object.assign(current, { content_protocol: "legacy-v1", content_manifest_digest: null, stored_descriptor: null });
    expect(() => readMemoryLiteralPage(current, request(reference))).toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_STALE" }));
  });

  it.each(["missing_descriptor", "wrong_hash", "wrong_units", "wrong_bytes", "wrong_scalars", "unknown_protocol", "missing_text", "NUL", "surrogate", "legacy_fake_manifest"])(
    "does not turn invalid stored %s into an empty successful page", async kind => {
      const row = await source(); const value = structuredClone(row) as unknown as Record<string, unknown>;
      const descriptor = value.stored_descriptor as Record<string, unknown>;
      if (kind === "missing_descriptor") delete value.stored_descriptor;
      if (kind === "wrong_hash") descriptor.sha256 = "a".repeat(64);
      if (kind === "wrong_units") descriptor.utf16_code_units = Number(descriptor.utf16_code_units) + 1;
      if (kind === "wrong_bytes") descriptor.utf8_bytes = Number(descriptor.utf8_bytes) + 1;
      if (kind === "wrong_scalars") descriptor.unicode_scalar_count = Number(descriptor.unicode_scalar_count) + 1;
      if (kind === "unknown_protocol") value.content_protocol = "literal-v3";
      if (kind === "missing_text") value.text = null;
      if (kind === "NUL") value.text = "before\0after";
      if (kind === "surrogate") value.text = "before\ud800after";
      if (kind === "legacy_fake_manifest") value.content_protocol = "legacy-v1";
      expect(() => createMemoryLiteralPreview(value)).toThrowError(expect.objectContaining({ code: kind === "unknown_protocol"
        ? "MEMORY_CONTENT_VERSION_UNSUPPORTED" : "MEMORY_CONTENT_UNAVAILABLE" }));
    });

  it("rejects invalid traversal and unknown page versions without changing the literal", async () => {
    const row = await source("🙂 exact"); const reference = createMemoryLiteralReference(row);
    for (const offset of [-1, 0.5, 1, row.text.length + 1])
      expect(() => readMemoryLiteralPage(row, request(reference, offset))).toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_INVALID" }));
    expect(() => readMemoryLiteralPage(row, { ...request(reference), page_version: 2 }))
      .toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_VERSION_UNSUPPORTED" }));
    expect(row.text).toBe("🙂 exact");
  });

  it.each(["source", "target", "stored_descriptor", "reference", "reference_descriptor", "toJSON", "proxy"])(
    "never executes input getters/toJSON/proxy traps: %s", async location => {
      const row = await source(); const value = structuredClone(row); const reference = structuredClone(createMemoryLiteralReference(row));
      let reads = 0; const get = () => { reads += 1; throw new Error("synthetic private input getter"); };
      let input: unknown = value;
      if (location === "source") Object.defineProperty(value, "text", { get });
      if (location === "target") Object.defineProperty(value.target, "field", { get });
      if (location === "stored_descriptor") Object.defineProperty(value.stored_descriptor, "sha256", { get });
      if (location === "reference") Object.defineProperty(reference, "content_manifest_digest", { get });
      if (location === "reference_descriptor") Object.defineProperty(reference.descriptor, "utf8_bytes", { get });
      if (location === "toJSON") Object.defineProperty(value, "toJSON", { get });
      if (location === "proxy") input = new Proxy(value, { get, ownKeys: get, getPrototypeOf: get });
      expect(() => readMemoryLiteralPage(input, request(reference))).toThrow();
      expect(reads).toBe(0);
    });

  it("rejects credential/grant/raw-source claims and descriptor coercion in a page request", async () => {
    const row = await source(); const reference = createMemoryLiteralReference(row);
    for (const extra of [{ review_credential: "synthetic-not-a-credential" }, { authorized: true }, { source_text: "synthetic forbidden" }])
      expect(() => readMemoryLiteralPage(row, { ...request(reference), ...extra })).toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_INVALID" }));
    const bad = structuredClone(reference) as unknown as Record<string, unknown>; let conversions = 0;
    bad.content_manifest_digest = { toString() { conversions += 1; return "a".repeat(64); } };
    expect(() => readMemoryLiteralPage(row, request(bad))).toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_INVALID" }));
    expect(conversions).toBe(0);
  });

  it.each(["", " \t\r\n", "Unconfirmed Ａe\u0301🙂\r\n"])("preserves an actual unfinished draft without inventing a stored manifest %#", text => {
    const row = draft(text); const preview = createMemoryLiteralPreview(row);
    expect(preview.reference.target).toEqual(row.target);
    expect(preview.reference.content_protocol).toBe("literal-v2");
    expect(preview.reference.content_manifest_digest).toBeNull();
    expect(preview.reference.descriptor).toEqual({ sha256: hash(text), utf8_bytes: Buffer.byteLength(text),
      utf16_code_units: text.length, unicode_scalar_count: Array.from(text).length });
    expect(preview.text_preview).toBe(text);
    expect(preview.coverage.status).toBe("complete");
    expect(Value.Check(MemoryLiteralPreviewSchema, preview)).toBe(true);
    const page = readMemoryLiteralPage(row, request(preview.reference));
    expect(page.text).toBe(text); expect(page.has_more).toBe(false);
    expect(Value.Check(MemoryLiteralPageSchema, page)).toBe(true);
    expect(page).not.toHaveProperty("confirmed");
  });

  it.each(["draft_id", "draft_revision", "review_scope_id", "item_id", "text"])("fences an old draft ref after current %s changes", field => {
    const row = draft(); const reference = createMemoryLiteralReference(row); const next = structuredClone(row);
    if (field === "text") next.text = "Another saved draft tail";
    else if (field === "draft_revision") next.target.draft_revision += 1;
    else (next.target as Record<string, unknown>)[field] = "44444444-4444-4444-8444-444444444444";
    expect(() => readMemoryLiteralPage(next, request(reference))).toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_STALE" }));
  });

  it("bounds draft literal bytes without trimming, partial output or weakening canonical v2 proof requirements", async () => {
    const text = "🙂".repeat(8192); const row = draft(text);
    const reference = createMemoryLiteralReference(row);
    expect(reference.descriptor.utf8_bytes).toBe(32_768);
    const first = readMemoryLiteralPage(row, request(reference));
    const second = readMemoryLiteralPage(row, request(reference, first.end));
    expect(first.text + second.text).toBe(text);
    expect(() => createMemoryLiteralReference(draft(text + "a"))).toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_UNAVAILABLE" }));
    for (const text of ["before\0after", "before\ud800after"])
      expect(() => createMemoryLiteralReference(draft(text))).toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_UNAVAILABLE" }));
    expect(() => createMemoryLiteralReference({ ...draft(), content_manifest_digest: "a".repeat(64) }))
      .toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_UNAVAILABLE" }));
    expect(() => createMemoryLiteralReference({ ...draft(), stored_descriptor: reference.descriptor }))
      .toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_UNAVAILABLE" }));
    const canonical = await source();
    expect(() => createMemoryLiteralReference({ ...canonical, content_manifest_digest: null }))
      .toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_UNAVAILABLE" }));
  });

  it("does not read a draft revision getter or treat a missing draft as an empty draft", () => {
    const row = draft(); let reads = 0;
    Object.defineProperty(row.target, "draft_revision", { get() { reads += 1; throw new Error("synthetic private getter"); } });
    expect(() => createMemoryLiteralReference(row)).toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_UNAVAILABLE" }));
    expect(reads).toBe(0);
    expect(() => createMemoryLiteralReference({ ...draft(), text: null })).toThrowError(expect.objectContaining({ code: "MEMORY_CONTENT_UNAVAILABLE" }));
  });
});
