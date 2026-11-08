import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as memoryReview from "./memoryReview.js";

// Existing namespace import is deliberate: new APIs fail availability assertions,
// never module resolution. These are pure request tests, not source admission.
type Capture = (value: unknown) => Readonly<Record<string, unknown>>;
function capture(name: "captureMemoryLiteralStageRequest" | "captureMemoryLiteralCommitRequest"): Capture {
  const value: unknown = Reflect.get(memoryReview, name);
  expect(typeof value, `New writer API availability: ${name}; semantics have not run.`).toBe("function");
  return value as Capture;
}
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const ids = { account: id("1"), actor: id("2"), session: id("3"), message: id("4"), item: id("5"), scope: id("6"), proposal: id("7"), key: id("8") };
const text = " \tI prefer café summaries first.\nThen I verify each source. \t";
const descriptor = (value: string) => ({ sha256: hash(value), utf8_bytes: Buffer.byteLength(value, "utf8"),
  utf16_code_units: value.length, unicode_scalar_count: [...value].length });
function candidate(value = text) {
  return { scope: "self", operation: "add", statement_kind: "fact", display_text: value, source_excerpt: value,
    subject_id: null, relationship_context_id: null, speaker: null, reporter: null, valid_time: null, observed_time: null,
    time_status: "unknown", sensitivity: "normal", previous_memory_item_id: null, previous_text: null, previous_revision: null,
    reason: "Explicit synthetic self preference", source_locator: { kind: "message", session_id: ids.session,
      message_id: ids.message, character_start: 0, character_end: value.length } };
}
function stage() {
  return { content_protocol: "literal-v2", idempotency_key: ids.key, surface: "chat", session_id: ids.session,
    source_message_id: ids.message, person_id: null, relationship_context_id: null, contact_decision: "none", new_contact: null,
    proposer: { kind: "human", name: "synthetic-literal-writer", version: "1" }, items: [candidate()] };
}
function confirmation(value = text) {
  const entry = { purpose: "chat", person_id: null, relationship_context_id: null, source_session_id: ids.session,
    pursuit_id: null, pursuit_role_id: null, pursuit_role_evidence_fragment_id: null, pursuit_capture_id: null, pursuit_capture_version: null };
  const d = descriptor(value), proof = "a".repeat(64);
  const input = { version: "memory-literal-confirmation.v1", account_id: ids.account, actor_user_id: ids.actor,
    review_scope_id: ids.scope, review_revision: 0, proposal_id: ids.proposal, proposal_revision: 1, entry_scope: entry,
    item_id: ids.item, item_added_revision: 1, decision: "accept", previous_item_version: null,
    proposal_manifest_digest: proof, final: { kind: "inline", edited_text: value, descriptor: d } };
  // Independent fixed-order protocol tuple, not the writer's encoder.
  const tuple = [input.version, ids.account, ids.actor, ids.scope, 0, ids.proposal, 1,
    ["chat", null, null, ids.session, null, null, null, null, null], ids.item, 1, "accept", null, proof,
    ["inline", [d.sha256, d.utf8_bytes, d.utf16_code_units, d.unicode_scalar_count]]];
  return { ...input, confirmation_digest: hash(JSON.stringify(tuple)) };
}
function commit() {
  return { content_protocol: "literal-v2", idempotency_key: ids.key, expected_proposal_revision: 1,
    expected_review_revision: 0, contact_decision: "none", selected_item_ids: [ids.item],
    confirmations: [confirmation()], reason: "Explicit synthetic confirmation" };
}

describe("canonical literal writer request capture, not a permission or stored-row producer", () => {
  it("captures exact raw Stage bytes without trimming, normalization or caller-owned references", () => {
    const input = stage(), original = structuredClone(input);
    const result = capture("captureMemoryLiteralStageRequest")(input);
    expect(result).toEqual(original);
    input.items[0]!.display_text = "changed after capture";
    expect(result).toEqual(original);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
  });

  it.each([undefined, "legacy-v1", "literal-v3", null])("rejects absent or unsupported opt-in marker %s without changing the legacy owner", marker => {
    const parse = capture("captureMemoryLiteralStageRequest");
    const input: Record<string, unknown> = stage();
    if (marker === undefined) delete input.content_protocol; else input.content_protocol = marker;
    expect(() => parse(input)).toThrowError("MEMORY_CONTENT_VERSION_UNSUPPORTED");
  });

  it("accepts exactly32KiB UTF8 using fewer than12000 UTF16 units as a pure limit fixture", () => {
    const parse = capture("captureMemoryLiteralStageRequest"), value = "界".repeat(10_922) + "ab";
    expect(Buffer.byteLength(value, "utf8")).toBe(32_768); expect(value.length).toBe(10_924);
    const input = { ...stage(), items: [candidate(value)] };
    expect(parse(input)).toEqual(input); // No claim that this prose passed canonical meaning admission.
    expect(() => parse({ ...stage(), items: [candidate(value + "c")] })).toThrowError("MEMORY_CONTENT_LIMIT");
  });

  it("counts every statement and excerpt copy across the whole request", () => {
    const parse = capture("captureMemoryLiteralStageRequest"), value = "a".repeat(32_768);
    const items = Array.from({ length: 4 }, () => candidate(value));
    expect(parse({ ...stage(), items })).toEqual({ ...stage(), items });
    expect(() => parse({ ...stage(), items: [...items, candidate("b")] })).toThrowError("MEMORY_CONTENT_LIMIT");
  });

  it("rejects JSON encoding over1MiB even when decoded literal copies fit256KiB", () => {
    const parse = capture("captureMemoryLiteralStageRequest"), value = "\u0001".repeat(32_767) + "a";
    const input = { ...stage(), items: Array.from({ length: 4 }, () => candidate(value)) };
    expect(Buffer.byteLength(JSON.stringify(input), "utf8") > 1_048_576).toBe(true);
    expect(() => parse(input)).toThrowError("MEMORY_CONTENT_LIMIT");
  });

  it.each(["a\u0000b", "a\ud800b", "a\udc00b"])("rejects non-PG/invalid Unicode without replacing it: %j", value => {
    const parse = capture("captureMemoryLiteralStageRequest");
    expect(() => parse({ ...stage(), items: [candidate(value)] })).toThrowError("MEMORY_CONTENT_INVALID");
  });

  it("never invokes inherited fields, getters, proxies or coercion hooks", () => {
    const parse = capture("captureMemoryLiteralStageRequest"); let reads = 0;
    const getter = Object.defineProperty(stage(), "items", { enumerable: true, get() { reads++; throw new Error("PRIVATE_SYNTHETIC"); } });
    const nested = stage(); Object.defineProperty(nested.items[0]!, "display_text", { enumerable: true, get() { reads++; return text; } });
    const inherited = Object.assign(Object.create({ content_protocol: "literal-v2" }), stage()); delete inherited.content_protocol;
    const coercible = { ...stage(), idempotency_key: { toString() { reads++; return ids.key; } } };
    const proxied = new Proxy(stage(), { ownKeys() { reads++; throw new Error("PRIVATE_PROXY"); } });
    for (const input of [getter, nested, inherited, coercible, proxied]) expect(() => parse(input)).toThrowError("MEMORY_CONTENT_INVALID");
    expect(reads).toBe(0);
  });

  it("refuses source/manifest/authority fields supplied as additional wire properties", () => {
    const parse = capture("captureMemoryLiteralStageRequest");
    for (const value of [{ ...stage(), source_authority: { text } }, { ...stage(), authorized: true },
      { ...stage(), items: [{ ...candidate(), content_manifest: { version: "literal-v2" } }] }])
      expect(() => parse(value)).toThrowError("MEMORY_CONTENT_INVALID");
  });

  it("rejects a context-without-person tuple without attempting target lookup", () => {
    const parse = capture("captureMemoryLiteralStageRequest");
    expect(() => parse({ ...stage(), relationship_context_id: ids.actor, person_id: null }))
      .toThrowError("MEMORY_CONTENT_INVALID");
  });

  it("captures one exact inline confirmation and leaves its bytes immutable", () => {
    const parse = capture("captureMemoryLiteralCommitRequest"), input = commit(), before = structuredClone(input), result = parse(input);
    expect(result).toEqual(before); input.confirmations[0]!.final.edited_text = "changed later";
    expect(result).toEqual(before); expect(Object.isFrozen(result.confirmations)).toBe(true);
  });

  it("rejects duplicate/missing selected confirmations, mixed final shapes and explicit empty text", () => {
    const parse = capture("captureMemoryLiteralCommitRequest"), input = commit();
    for (const value of [{ ...input, confirmations: [] }, { ...input, confirmations: [confirmation(), confirmation()] },
      { ...input, selected_item_ids: [ids.item, ids.proposal] },
      { ...input, confirmations: [{ ...confirmation(), final: { ...confirmation().final, reference: {} } }] },
      { ...input, confirmations: [{ ...confirmation(), final: { kind: "inline", edited_text: "", descriptor: descriptor("") } }] }])
      expect(() => parse(value)).toThrowError("MEMORY_CONTENT_INVALID");
  });

  it("budgets all inline confirmations atomically, including a late oversized item", () => {
    const parse = capture("captureMemoryLiteralCommitRequest"), input = commit();
    const late = { ...confirmation("x".repeat(32_769)), item_id: ids.proposal };
    expect(() => parse({ ...input, selected_item_ids: [ids.item, ids.proposal], confirmations: [confirmation(), late] }))
      .toThrowError("MEMORY_CONTENT_LIMIT");
  });
});
