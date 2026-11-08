import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import * as contracts from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import * as contentOwner from "./memoryLiteralContent.js";

type ObjectValue = Record<string, any>;
type Project = (...args: unknown[]) => Promise<ObjectValue>;
function project(name: string): Project {
  const value: unknown = Reflect.get(contentOwner, name);
  expect(value, `new pure projection API ${name} is not implemented`).toBeTypeOf("function");
  return value as Project;
}
function schema(name: string): TSchema {
  const value: unknown = Reflect.get(contracts, name);
  expect(value, `new public DTO ${name} is not implemented`).toBeTypeOf("object"); return value as TSchema;
}
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const id = "55555555-5555-4555-8555-555555555555", scope = "33333333-3333-4333-8333-333333333333";
const evidenceID = "66666666-6666-4666-8666-666666666666", draftID = "77777777-7777-4777-8777-777777777777";
const hiddenID = "88888888-8888-4888-8888-888888888888";
const documentLocator = { kind: "document", source_resource_id: null, locator: { page: 1 } };
const documentLocatorHash = hash('{"kind":"document","locator":{"page":1},"source_resource_id":null}');
const golden = JSON.parse(readFileSync(new URL("../../../../packages/contracts/src/memoryAcceptedContentGolden.json", import.meta.url), "utf8")) as ObjectValue;
async function proposalRow(text = "🙂".repeat(100) + " EXACT_TAIL Ａe\u0301\r\n"): Promise<ObjectValue> {
  const excerpt = "z".repeat(260) + " SOURCE_TAIL", metadata = await contracts.createMemoryContentManifest({ display_text: text,
    original_display_text: text, original_content_protocol: "literal-v2", source_excerpt: excerpt,
    source_revision_hash: "a".repeat(64), source_locator_sha256: documentLocatorHash, message_range: null }, hash);
  return { id, account_id: "11111111-1111-4111-8111-111111111111", proposal_id: "44444444-4444-4444-8444-444444444444",
    scope: "self", subject_kind: "owner_self", relationship_kind: "none", operation: "add", statement_kind: "fact",
    display_text: text, original_display_text: text, source_excerpt: excerpt, ...metadata, previous_text: null,
    previous_memory_item_id: null, previous_revision: null, subject_id: null, relationship_context_id: null,
    speaker: null, reporter: null, valid_time: null, observed_time: null, time_status: "unknown", sensitivity: "normal",
    admission_status: "eligible", judgment_kind: "ordinary", admission_reason: null, default_selected: true,
    reason: "Synthetic bounded projection", locator: documentLocator,
    source_revision_hash: "a".repeat(64), source_excerpt_hash: hash(excerpt), added_revision: 2, status: "pending" };
}
async function acceptedRows(text = "🙂".repeat(100) + " ACCEPTED_TAIL"): Promise<ObjectValue> {
  const excerpt = "🙂".repeat(100) + " EVIDENCE_TAIL";
  const evidence = await contracts.createMemoryEvidenceManifest({ source_excerpt: excerpt, source_revision_hash: "a".repeat(64),
    source_locator_sha256: documentLocatorHash, message_range: null }, hash);
  const item = await contracts.createMemoryAcceptedContentManifest({ display_text: text, original_display_text: null,
    original_content_protocol: "legacy-v1", reviewed_evidence: [{ evidence_id: evidenceID, content_protocol: "literal-v2", content_version: 1,
      content_manifest_digest: evidence.content_manifest_digest }] }, hash);
  return { item: { id, account_id: "11111111-1111-4111-8111-111111111111", scope: "self", owner_user_id: scope,
    subject_id: null, relationship_context_id: null, display_text: text, original_display_text: null, ...item,
    statement_kind: "fact", speaker: null, reporter: null, valid_time: null, observed_time: null, time_status: "unknown",
    sensitivity: "normal", version: 7, status: "active", supersedes_id: null, conflict_group_id: null,
    created_at: new Date("2026-11-08T00:00:00.000Z") }, evidence: [{ id: evidenceID,
    memory_item_id: id, account_id: "11111111-1111-4111-8111-111111111111", excerpt, content_hash: hash(excerpt), ...evidence,
    content_version: 1, status: "active", locator: documentLocator,
    capture_id: null, source_resource_id: null, evidence_fragment_id: null, source_session_id: null,
    source_message_id: null, source_artifact_id: null }], can_edit: true };
}

// Synthetic already-loaded rows exercise pure integrity/projection only.
// Passing these functions is not source admission, SQL membership or Auth proof.
describe("new V2 bounded review/draft/recall/receipt projections", () => {
  it("returns explicit bounded review previews and exact canonical descriptors without the literal tail", async () => {
    const row = await proposalRow(), before = structuredClone(row);
    const out = await project("projectMemoryLiteralReviewItem")(row);
    expect(Value.Check(schema("MemoryLiteralReviewItemV2Schema"), out)).toBe(true);
    expect(out.display_text_preview.text_preview).toBe("🙂".repeat(64));
    expect(out.display_text_preview.coverage).toEqual({ status: "partial", start: 0, end: 128,
      total_utf16_code_units: row.display_text.length, total_utf8_bytes: Buffer.byteLength(row.display_text) });
    expect(out.display_text_preview.reference.descriptor.sha256).toBe(hash(row.display_text));
    expect(out.display_text_preview.reference.target).toEqual({ kind: "proposal_item", item_id: id, item_added_revision: 2, field: "display_text" });
    expect(out.original_display_text_preview.reference.target.field).toBe("original_display_text");
    expect(out.source_excerpt_preview.text_preview).toBe("z".repeat(256));
    expect(out.source_locator).toEqual({ kind: "document", source_resource_id: null, locator_sha256: documentLocatorHash });
    for (const key of ["display_text", "original_display_text", "source_excerpt", "previous_text"]) expect(out).not.toHaveProperty(key);
    expect(JSON.stringify(out)).not.toContain("EXACT_TAIL"); expect(JSON.stringify(out)).not.toContain("SOURCE_TAIL");
    expect(row).toEqual(before); expect(Object.isFrozen(out.display_text_preview.reference.descriptor)).toBe(true);
  });

  it.each(["missing_manifest", "changed_original", "changed_excerpt", "wrong_digest", "unknown_protocol"])(
    "does not hide invalid stored %s behind a valid selected display descriptor", async kind => {
      const row = await proposalRow();
      if (kind === "missing_manifest") row.content_manifest = null;
      if (kind === "changed_original") row.original_display_text += "changed";
      if (kind === "changed_excerpt") row.source_excerpt += "changed";
      if (kind === "wrong_digest") row.content_manifest_digest = "0".repeat(64);
      if (kind === "unknown_protocol") row.content_protocol = "literal-v3";
      await expect(project("projectMemoryLiteralReviewItem")(row)).rejects.toBeDefined();
    });

  it("does not certify model previous_text using a proposal's unrelated proof", async () => {
    const row = await proposalRow(); row.previous_text = "UNCERTIFIED_PREVIOUS_TAIL"; row.previous_memory_item_id = null;
    const out = await project("projectMemoryLiteralReviewItem")(row);
    expect(out.previous_memory).toBeNull(); expect(out).not.toHaveProperty("previous_text");
    expect(JSON.stringify(out)).not.toContain("UNCERTIFIED_PREVIOUS_TAIL");
  });

  it("projects a shared draft through this reading scope without mutating hidden saved choices", async () => {
    const row = { id: draftID, revision: 8, review_scope_id: hiddenID, content_protocol: "literal-v2", contact_decision: "none",
      selected_item_ids: [id, hiddenID], edited_text: { [id]: "", [hiddenID]: "PRIVATE_HIDDEN_DRAFT" },
      item_decisions: { [id]: "accept", [hiddenID]: "retain_conflict" }, updated_at: new Date("2026-11-08T00:00:00.000Z") };
    const before = structuredClone(row), out = await project("projectMemoryLiteralDraft")(row, { review_scope_id: scope, visible_item_ids: [id] });
    expect(Value.Check(schema("MemoryLiteralDraftV2Schema"), out)).toBe(true);
    expect(out.selected_item_ids).toEqual([id]); expect(Object.keys(out.edits)).toEqual([id]); expect(out.item_decisions).toEqual({ [id]: "accept" });
    expect(out.edits[id].reference.target).toEqual({ kind: "review_draft", draft_id: draftID, draft_revision: 8,
      review_scope_id: scope, item_id: id, field: "edited_text" });
    expect(out.edits[id].text_preview).toBe(""); expect(out.edits[id].reference.content_manifest_digest).toBeNull();
    expect(out.edits[id].reference.descriptor).toEqual({ sha256: hash(""), utf8_bytes: 0, utf16_code_units: 0, unicode_scalar_count: 0 });
    expect(out).not.toHaveProperty("edited_text"); expect(JSON.stringify(out)).not.toContain("PRIVATE_HIDDEN_DRAFT"); expect(row).toEqual(before);
  });

  it("can project durable drafts larger than one request without returning that full map", async () => {
    const keys = Array.from({ length: 9 }, (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
    const edited_text = Object.fromEntries(keys.map(key => [key, "x".repeat(32760) + "LONGTAIL"]));
    expect(Buffer.byteLength(Object.values(edited_text).join(""))).toBeGreaterThan(262144);
    const row = { id: draftID, revision: 2, review_scope_id: hiddenID, content_protocol: "literal-v2", contact_decision: "none",
      selected_item_ids: keys, edited_text, item_decisions: {}, updated_at: new Date("2026-11-08T00:00:00.000Z") };
    const out = await project("projectMemoryLiteralDraft")(row, { review_scope_id: scope, visible_item_ids: keys });
    expect(Object.keys(out.edits)).toHaveLength(9); expect(JSON.stringify(out)).not.toContain("LONGTAIL");
    for (const key of keys) expect(out.edits[key].reference.descriptor.utf8_bytes).toBe(32768);
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(16384);
    expect(row.edited_text).toEqual(edited_text);
  });

  it("keeps unknown legacy original null while projecting only the actual stored accepted bytes", async () => {
    const rows = await acceptedRows();
    rows.item.content_protocol = "legacy-v1"; rows.item.content_manifest = null; rows.item.content_manifest_digest = null;
    rows.evidence[0].content_protocol = "legacy-v1"; rows.evidence[0].content_manifest = null; rows.evidence[0].content_manifest_digest = null;
    const out = await project("projectMemoryLiteralRecallItem")(rows);
    expect(Value.Check(schema("MemoryLiteralRecallItemV2Schema"), out)).toBe(true);
    expect(out.original_display_text_preview).toBeNull();
    expect(out.display_text_preview.reference.content_protocol).toBe("legacy-v1");
    expect(out.display_text_preview.reference.content_manifest_digest).toBeNull();
    expect(out.display_text_preview.reference.descriptor.sha256).toBe(hash(rows.item.display_text));
    expect(out.evidence_refs[0].excerpt_preview.reference.content_protocol).toBe("legacy-v1");
    expect(out).not.toHaveProperty("display_text"); expect(out).not.toHaveProperty("original_display_text");
  });

  it("preserves independent accepted/evidence proof refs and bounded coverage with no complete tail exposure", async () => {
    const rows = await acceptedRows(), out = await project("projectMemoryLiteralRecallItem")(rows);
    expect(Value.Check(schema("MemoryLiteralRecallItemV2Schema"), out)).toBe(true);
    expect(out.display_text_preview.reference.target).toEqual({ kind: "memory_item", item_id: id, item_version: 7, field: "display_text" });
    expect(out.display_text_preview.reference.content_manifest_digest).toBe(rows.item.content_manifest_digest);
    expect(out.original_display_text_preview).toBeNull();
    expect(out.evidence_refs[0].excerpt_preview.reference.target).toEqual({ kind: "memory_evidence", evidence_id: evidenceID, content_version: 1, field: "excerpt" });
    expect(out.evidence_refs[0].excerpt_preview.reference.content_manifest_digest).toBe(rows.evidence[0].content_manifest_digest);
    expect(out.evidence_refs[0].excerpt_preview.reference.content_manifest_digest).not.toBe(rows.item.content_manifest_digest);
    expect(JSON.stringify(out)).not.toContain("ACCEPTED_TAIL"); expect(JSON.stringify(out)).not.toContain("EVIDENCE_TAIL");
    expect(out.display_text_preview.coverage.status).toBe("partial"); expect(out.evidence_refs[0].excerpt_preview.coverage.status).toBe("partial");
  });

  it.each(["missing_evidence", "wrong_parent", "wrong_evidence_version", "changed_proof", "revoked"])(
    "rejects incoherent accepted evidence %s instead of silently filtering it", async kind => {
      const rows = await acceptedRows();
      if (kind === "missing_evidence") rows.evidence = [];
      if (kind === "wrong_parent") rows.evidence[0].memory_item_id = hiddenID;
      if (kind === "wrong_evidence_version") rows.evidence[0].content_version = 2;
      if (kind === "changed_proof") rows.evidence[0].content_manifest_digest = "0".repeat(64);
      if (kind === "revoked") rows.evidence[0].status = "revoked";
      await expect(project("projectMemoryLiteralRecallItem")(rows)).rejects.toBeDefined();
    });

  it("projects compact receipt facts from independent accepted golden metadata, omitting unbounded prose", async () => {
    const vector = golden.vectors.find((v: ObjectValue) => v.name === "legacy-correction-unknown-original");
    expect(vector).toBeDefined();
    const accepted_content = { content_protocol: "literal-v2", content_manifest_digest: vector.manifest_digest_sha256,
      final_descriptor: vector.manifest.display_text, original_content_protocol: vector.manifest.original_content_protocol,
      original_descriptor: vector.manifest.original_display_text, reviewed_evidence: vector.manifest.reviewed_evidence };
    const row = { changes: [{ proposal_item_id: id, decision: "accept", memory_item_id: id,
      accepted_content, display_text: "PRIVATE_RECEIPT_PROSE", source_excerpt: "PRIVATE_RECEIPT_SOURCE" },
    { proposal_item_id: hiddenID, decision: "keep_old", memory_item_id: null, accepted_content: null }] };
    const out = await project("projectMemoryLiteralReceiptFacts")(row);
    expect(out).toEqual({ content_protocol: "literal-v2", changes: [
      { proposal_item_id: id, decision: "accept", memory_item_id: id, accepted_content },
      { proposal_item_id: hiddenID, decision: "keep_old", memory_item_id: null, accepted_content: null }] });
    expect(Value.Check(schema("MemoryLiteralReceiptFactsV2Schema"), out)).toBe(true);
    expect(JSON.stringify(out)).not.toContain("PRIVATE_RECEIPT_");
    expect(out.changes[0].accepted_content.original_descriptor).toBeNull();
  });

  it("does not manufacture compact content proof for a supposedly applied receipt change", async () => {
    await expect(project("projectMemoryLiteralReceiptFacts")({ changes: [{ proposal_item_id: id, decision: "accept",
      memory_item_id: id, accepted_content: null }] })).rejects.toBeDefined();
  });
});
