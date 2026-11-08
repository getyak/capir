import { createHash } from "node:crypto";
import * as contracts from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import { prepareMemoryLiteralProposalBatch } from "./memoryLiteralSource.js";
import { projectMemoryLiteralReviewItem } from "./memoryLiteralContent.js";
import { sourceRevisionHash, type MemorySourceAuthority } from "./memoryReviewStore.js";

const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const account = "11111111-1111-4111-8111-111111111111", message = "22222222-2222-4222-8222-222222222222";
const scope = "33333333-3333-4333-8333-333333333333", proposal = "44444444-4444-4444-8444-444444444444";
const firstItem = "55555555-5555-4555-8555-555555555555", secondItem = "66666666-6666-4666-8666-666666666666";
const session = "77777777-7777-4777-8777-777777777777";
const attachmentA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", attachmentB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const descriptor = { sha256: "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c",
  utf8_bytes: 2, utf16_code_units: 1, unicode_scalar_count: 1 };
const review = (item = firstItem) => ({ version: "memory-literal-confirmation.v1", account_id: account, actor_user_id: message,
  review_scope_id: scope, review_revision: 3, proposal_id: proposal, proposal_revision: 4, item_id: item,
  entry_scope: { purpose: "chat", person_id: null, relationship_context_id: null, source_session_id: session,
    pursuit_id: null, pursuit_role_id: null, pursuit_role_evidence_fragment_id: null, pursuit_capture_id: null, pursuit_capture_version: null },
  item_added_revision: 2, decision: "accept", previous_item_version: null, proposal_manifest_digest: "a".repeat(64),
  final: { kind: "inline", edited_text: "é", descriptor: { ...descriptor } } });

describe("peer regression: the captured current inline bytes must match their descriptor", () => {
  it("rejects same-size changed current bytes in single confirmation verification", async () => {
    const input = review(), saved = await contracts.createMemoryReviewConfirmationV1(input, hash);
    expect(await contracts.verifyMemoryReviewConfirmationV1(saved, input, hash)).toBe(true);
    const current = structuredClone(input); current.final.edited_text = "è";
    expect(current.final.edited_text.length).toBe(input.final.edited_text.length);
    expect(Buffer.byteLength(current.final.edited_text)).toBe(Buffer.byteLength(input.final.edited_text));
    expect(hash(current.final.edited_text)).not.toBe(current.final.descriptor.sha256);
    expect(await contracts.verifyMemoryReviewConfirmationV1(saved, current, hash)).toBe(false);
  });

  it("rejects a changed later current inline value in an otherwise exact two-item batch", async () => {
    const inputs = [review(), review(secondItem)];
    const confirmations = await Promise.all(inputs.map(input => contracts.createMemoryReviewConfirmationV1(input, hash)));
    expect(await contracts.verifyMemoryReviewConfirmationBatchV1(confirmations, inputs, hash)).toBe(true);
    const current = structuredClone(inputs); current[1]!.final.edited_text = "è";
    expect(await contracts.verifyMemoryReviewConfirmationBatchV1(confirmations, current, hash)).toBe(false);
  });

  it("captures current bytes before the first digest await while retaining valid verification", async () => {
    const input = review(), saved = await contracts.createMemoryReviewConfirmationV1(input, hash), current = structuredClone(input);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const pending = contracts.verifyMemoryReviewConfirmationV1(saved, current, async text => { await gate; return hash(text); });
    current.final.edited_text = "è"; current.final.descriptor.sha256 = "0".repeat(64); release();
    expect(await pending).toBe(true);
  });
});

const canonicalArtifactB = "conversation-image-22222222-2222-4222-8222-222222222222-1-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function imageAuthority(): MemorySourceAuthority {
  return { text: null, sessionId: session, messageId: message, sourceTaskId: null, captureIds: [], messageTextHash: null,
    captureVersion: null, captureSubjectId: null, captureContextId: null,
    artifacts: [{ artifactId: "conversation-image-22222222-2222-4222-8222-222222222222-0-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "image", sessionId: session, messageId: message, captureId: null, sourceResourceId: null,
      evidenceFragmentId: null, contentHash: "a".repeat(64), captureVersion: null },
    { artifactId: canonicalArtifactB, kind: "image", sessionId: session, messageId: message, captureId: null,
      sourceResourceId: null, evidenceFragmentId: null, contentHash: "b".repeat(64), captureVersion: null }],
    imageManifest: [{ index: 0, attachmentId: attachmentA, contentHash: "a".repeat(64) },
      { index: 1, attachmentId: attachmentB, contentHash: "b".repeat(64) }] };
}
const imageRequest = () => ({ content_protocol: "literal-v2", items: [{ scope: "self", operation: "add", statement_kind: "fact",
  display_text: "Synthetic independently reviewed image statement", source_excerpt: "Synthetic image observation",
  source_locator: { kind: "image_region", artifact_id: canonicalArtifactB, session_id: session, image_index: 1, region: null },
  time_status: "unknown", sensitivity: "normal", reason: "Synthetic current source-owner image mapping" }] });

describe("peer regression: real host canonical image identity and immutable manifest association", () => {
  it.each([true, false])("accepts the actual source-owner artifact shape with explicit index %s", async explicit => {
    const input = imageRequest(), host = imageAuthority();
    if (!explicit) Reflect.deleteProperty(input.items[0]!.source_locator, "image_index");
    const out = await prepareMemoryLiteralProposalBatch(input, host, hash);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.source_locator).toMatchObject({ kind: "image_region", artifact_id: canonicalArtifactB });
    expect(out.items[0]!.content_manifest.message_range).toBeNull();
    expect(out.items[0]!.content_manifest.source_revision_hash).toBe(sourceRevisionHash(host));
    expect(out.items[0]!.content_manifest).not.toHaveProperty("source_text_sha256");
  });

  it.each(["index", "attachment", "hash", "unadmitted", "duplicate_artifact", "duplicate_manifest", "session", "message"])(
    "rejects mismatched %s without producing a text range or partial batch", async kind => {
      const input = imageRequest(), host = imageAuthority();
      if (kind === "index") input.items[0]!.source_locator.image_index = 0;
      if (kind === "attachment") host.imageManifest[1]!.attachmentId = attachmentA;
      if (kind === "hash") host.artifacts[1]!.contentHash = "c".repeat(64);
      if (kind === "unadmitted") input.items[0]!.source_locator.artifact_id = canonicalArtifactB.replace(attachmentB, attachmentA);
      if (kind === "duplicate_artifact") host.artifacts = [...host.artifacts, { ...host.artifacts[1]! }];
      if (kind === "duplicate_manifest") host.imageManifest = [...host.imageManifest, { ...host.imageManifest[1]! }];
      if (kind === "session") host.artifacts[1]!.sessionId = firstItem;
      if (kind === "message") host.artifacts[1]!.messageId = firstItem;
      await expect(prepareMemoryLiteralProposalBatch(input, host, hash)).rejects.toMatchObject({ code: "MEMORY_CONTENT_RANGE_INVALID" });
    });
});

// Fixed expected JSON is authored independently of the production formatter.
// In particular an Object.fromEntries round-trip would re-enumerate 2 before 10.
const numeric = { "2": "two", "10": "ten", a: { "2": ["z", { "11": "eleven", "1": "one" }], "10": "inner-ten" } };
const numericGolden = '{"10":"ten","2":"two","a":{"10":"inner-ten","2":["z",{"1":"one","11":"eleven"}]}}';
const unicode = { "\uE000": "private-use", "🙂": "astral", "é": "precomposed", "e\u0301": "decomposed", a: "ascii" };
const unicodeGolden = '{"a":"ascii","e\u0301":"decomposed","é":"precomposed","🙂":"astral","\uE000":"private-use"}';

describe("peer regression: deterministic canonical locator code-unit ordering", () => {
  it("keeps numeric-looking nested keys lexically ordered and array order intact", () => {
    expect(contracts.canonicalMemoryLiteralJson(numeric)).toBe(numericGolden);
  });
  it("preserves distinct Unicode keys and UTF16 code-unit ordering without normalization", () => {
    expect(contracts.canonicalMemoryLiteralJson(unicode)).toBe(unicodeGolden);
  });
  it("validates a whole proposal role against independent fixed numeric locator bytes through the public projection", async () => {
    const locatorBytes = '{"kind":"document","locator":' + numericGolden + ',"source_resource_id":null}';
    const metadata = await contracts.createMemoryContentManifest({ display_text: "Synthetic complete literal", original_display_text: "Synthetic complete literal",
      original_content_protocol: "literal-v2", source_excerpt: "Synthetic document observation", source_revision_hash: "a".repeat(64),
      source_locator_sha256: hash(locatorBytes), message_range: null }, hash);
    const out = await projectMemoryLiteralReviewItem({ id: firstItem, account_id: account, scope: "self", subject_kind: "owner_self",
      relationship_kind: "none", operation: "add", statement_kind: "fact", display_text: "Synthetic complete literal",
      original_display_text: "Synthetic complete literal", source_excerpt: "Synthetic document observation", ...metadata,
      locator: { kind: "document", source_resource_id: null, locator: numeric }, source_revision_hash: "a".repeat(64),
      source_excerpt_hash: hash("Synthetic document observation"), previous_memory_item_id: null, previous_revision: null,
      subject_id: null, relationship_context_id: null, speaker: null, reporter: null, valid_time: null, observed_time: null,
      time_status: "unknown", sensitivity: "normal", admission_status: "eligible", judgment_kind: "ordinary", admission_reason: null,
      default_selected: true, reason: "Synthetic numeric locator proof", added_revision: 2, status: "pending" });
    expect(out.source_locator).toEqual({ kind: "document", source_resource_id: null, locator_sha256: hash(locatorBytes) });
  });
});
