import { createHash } from "node:crypto";
import * as contracts from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";

type ObjectValue = Record<string, any>;
type Digest = (text: string) => string | Promise<string>;
type Create = (input: unknown, digest: Digest) => Promise<ObjectValue>;
type Verify = (confirmation: unknown, current: unknown, digest: Digest) => Promise<boolean>;
function api<T>(name: string): T {
  const value: unknown = Reflect.get(contracts, name);
  expect(value, `new public confirmation API ${name} is not implemented`).toBeTypeOf("function");
  return value as T;
}
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const ids = { account: "11111111-1111-4111-8111-111111111111", actor: "22222222-2222-4222-8222-222222222222",
  review: "33333333-3333-4333-8333-333333333333", proposal: "44444444-4444-4444-8444-444444444444",
  item: "55555555-5555-4555-8555-555555555555", evidence: "66666666-6666-4666-8666-666666666666",
  draft: "77777777-7777-4777-8777-777777777777", person: "88888888-8888-4888-8888-888888888888",
  session: "99999999-9999-4999-8999-999999999999" };
const descriptor = { sha256: "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c",
  utf8_bytes: 2, utf16_code_units: 1, unicode_scalar_count: 1 };
const finalDescriptor = { sha256: "3b0ea815af8a5c4e4f4cd4b9a1781d8337c8322ca63ce4f347285f4ec5e1466f",
  utf8_bytes: 10, utf16_code_units: 5, unicode_scalar_count: 4 };
const proposalDigest = "018f5bb0e2337130904a5c3707e9c5096e7dfdfd5c45fb353f6e5576c2548def";
const entry = (purpose = "chat") => ({ purpose, person_id: purpose === "people" ? ids.person : null,
  relationship_context_id: null, source_session_id: purpose === "chat" ? ids.session : null,
  pursuit_id: null, pursuit_role_id: null, pursuit_role_evidence_fragment_id: null, pursuit_capture_id: null, pursuit_capture_version: null });
const reference = () => ({ reference_version: 1, content_protocol: "literal-v2", content_manifest_digest: proposalDigest,
  descriptor: { ...descriptor }, target: { kind: "proposal_item", item_id: ids.item, item_added_revision: 2, field: "display_text" } });
function review(): ObjectValue {
  return { version: "memory-literal-confirmation.v1", account_id: ids.account, actor_user_id: ids.actor,
    review_scope_id: ids.review, review_revision: 3, proposal_id: ids.proposal, proposal_revision: 4,
    entry_scope: entry(), item_id: ids.item, item_added_revision: 2, decision: "accept", previous_item_version: null,
    proposal_manifest_digest: proposalDigest, final: { kind: "proposal", reference: reference() } };
}
function mutation(): ObjectValue {
  return { version: "memory-item-mutation-confirmation.v1", account_id: ids.account, actor_user_id: ids.actor,
    item_id: ids.item, expected_item_version: 7, operation: "correct", entry_scope: entry("people"),
    expected_content_protocol: "legacy-v1", expected_content_manifest_digest: null, expected_stored_descriptor: { ...descriptor },
    original_content_protocol: "legacy-v1", original_descriptor: null, evidence: [{ evidence_id: ids.evidence,
      content_protocol: "legacy-v1", content_version: 1, content_manifest_digest: null }], final_descriptor: { ...finalDescriptor } };
}
// Independently fixed Python stdlib compact ASCII tuple and SHA-256, not a
// serializer or expected value imported from the proposed implementation.
const reviewTuple = '["memory-literal-confirmation.v1","11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333",3,"44444444-4444-4444-8444-444444444444",4,["chat",null,null,"99999999-9999-4999-8999-999999999999",null,null,null,null,null],"55555555-5555-4555-8555-555555555555",2,"accept",null,"018f5bb0e2337130904a5c3707e9c5096e7dfdfd5c45fb353f6e5576c2548def",["proposal",[1,["proposal_item","55555555-5555-4555-8555-555555555555",2,"display_text"],"literal-v2","018f5bb0e2337130904a5c3707e9c5096e7dfdfd5c45fb353f6e5576c2548def",["4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c",2,1,1]]]]';
const reviewHash = "fdfb66f02c639776b8016dcc1263bc009917e58d8db74e8bf6d099e187dc7f1a";
const mutationTuple = '["memory-item-mutation-confirmation.v1","11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","55555555-5555-4555-8555-555555555555",7,"correct",["people","88888888-8888-4888-8888-888888888888",null,null,null,null,null,null,null],"legacy-v1",null,["4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c",2,1,1],"legacy-v1",null,[["66666666-6666-4666-8666-666666666666","legacy-v1",1,null]],["3b0ea815af8a5c4e4f4cd4b9a1781d8337c8322ca63ce4f347285f4ec5e1466f",10,5,4]]';
const mutationHash = "032a255cc9a8396e95a96c6658944e93c447892c3bf95d3d71a6ce7078fa1325";

describe("new review and accepted mutation confirmation protocols", () => {
  it("matches the independent review tuple without claiming read proof or permission", async () => {
    const input = review(), created = await api<Create>("createMemoryReviewConfirmationV1")(input, hash);
    expect(hash(reviewTuple)).toBe(reviewHash);
    expect(created).toEqual({ ...input, confirmation_digest: reviewHash });
    expect(await api<Verify>("verifyMemoryReviewConfirmationV1")(created, input, hash)).toBe(true);
    expect(created).not.toHaveProperty("read_by_human"); expect(created).not.toHaveProperty("authorized");
    expect(Object.isFrozen(created.final.reference.descriptor)).toBe(true);
  });

  const reviewChanges: Array<[string, (value: ObjectValue) => void]> = [
    ["account", v => { v.account_id = ids.person; }], ["actor", v => { v.actor_user_id = ids.person; }],
    ["review scope", v => { v.review_scope_id = ids.person; }], ["review revision", v => { v.review_revision++; }],
    ["proposal", v => { v.proposal_id = ids.person; }], ["proposal revision", v => { v.proposal_revision++; }],
    ["purpose", v => { v.entry_scope.purpose = "people"; }], ["person", v => { v.entry_scope.person_id = ids.person; }],
    ["context", v => { v.entry_scope.relationship_context_id = ids.person; }], ["source session", v => { v.entry_scope.source_session_id = ids.person; }],
    ["Pursuit", v => { v.entry_scope.pursuit_id = ids.person; }], ["Pursuit role", v => { v.entry_scope.pursuit_role_id = ids.person; }],
    ["Pursuit evidence", v => { v.entry_scope.pursuit_role_evidence_fragment_id = ids.person; }],
    ["Pursuit capture", v => { v.entry_scope.pursuit_capture_id = ids.person; }], ["capture version", v => { v.entry_scope.pursuit_capture_version = 1; }],
    ["item", v => { v.item_id = ids.person; }], ["added revision", v => { v.item_added_revision++; }],
    ["decision", v => { v.decision = "retain_conflict"; }], ["previous version", v => { v.previous_item_version = 2; }],
    ["proposal proof", v => { v.proposal_manifest_digest = "b".repeat(64); }],
    ["final descriptor", v => { v.final.reference.descriptor = { ...finalDescriptor }; }],
    ["final ref version", v => { v.final.reference.target.item_added_revision++; }],
  ];
  it.each(reviewChanges)("invalidates an old review confirmation when current %s changes", async (_name, change) => {
    const input = review(), created = await api<Create>("createMemoryReviewConfirmationV1")(input, hash), current = structuredClone(input);
    change(current); expect(await api<Verify>("verifyMemoryReviewConfirmationV1")(created, current, hash)).toBe(false);
  });

  it("binds a current draft ref to this reading scope and its actual revision", async () => {
    const input = review(); input.final = { kind: "draft", reference: { ...reference(), content_manifest_digest: null,
      target: { kind: "review_draft", draft_id: ids.draft, draft_revision: 8, review_scope_id: ids.review, item_id: ids.item, field: "edited_text" } } };
    const created = await api<Create>("createMemoryReviewConfirmationV1")(input, hash);
    expect(await api<Verify>("verifyMemoryReviewConfirmationV1")(created, input, hash)).toBe(true);
    for (const [key, value] of [["draft_id", ids.person], ["draft_revision", 9], ["review_scope_id", ids.person], ["item_id", ids.person]] as const) {
      const changed = structuredClone(input); changed.final.reference.target[key] = value;
      expect(await api<Verify>("verifyMemoryReviewConfirmationV1")(created, changed, hash)).toBe(false);
    }
    const wrongScope = structuredClone(input); wrongScope.final.reference.target.review_scope_id = ids.person;
    await expect(api<Create>("createMemoryReviewConfirmationV1")(wrongScope, hash)).rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" });
  });

  it("keeps proposal/draft/inline choices exclusive and does not turn an empty edit into the proposal", async () => {
    const create = api<Create>("createMemoryReviewConfirmationV1"), input = review();
    const inline = { kind: "inline", edited_text: "é", descriptor: { ...descriptor } };
    const positive = { ...input, final: inline };
    expect(await api<Verify>("verifyMemoryReviewConfirmationV1")(await create(positive, hash), positive, hash)).toBe(true);
    for (const final of [{ ...inline, reference: reference() }, { ...input.final, edited_text: "é" },
      { kind: "inline", edited_text: "", descriptor: { sha256: hash(""), utf8_bytes: 0, utf16_code_units: 0, unicode_scalar_count: 0 } },
      { ...inline, edited_text: "e\u0301" }, { kind: "proposal", reference: { ...reference(), target: { ...reference().target, field: "source_excerpt" } } }]) {
      await expect(create({ ...input, final }, hash)).rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" });
    }
  });

  it("captures all own data before the first digest await and never reads getters/coercions", async () => {
    const create = api<Create>("createMemoryReviewConfirmationV1"), input = review();
    const original = structuredClone(input);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const pending = create(input, async text => { await gate; return hash(text); });
    input.review_revision = 100; input.final.reference.descriptor.sha256 = "0".repeat(64); release();
    expect(await pending).toEqual({ ...original, confirmation_digest: reviewHash });
    let reads = 0;
    const accessor = Object.defineProperty(review(), "proposal_revision", { enumerable: true, get() { reads++; throw new Error("synthetic private getter"); } });
    await expect(create(accessor, hash)).rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" }); expect(reads).toBe(0);
    const coercible = { toString() { reads++; return proposalDigest; } };
    await expect(create({ ...review(), proposal_manifest_digest: coercible }, hash)).rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" }); expect(reads).toBe(0);
  });

  it("requires an exact complete selected set before a batch can be considered confirmed", async () => {
    const input = review(), created = await api<Create>("createMemoryReviewConfirmationV1")(input, hash);
    const verify = api<(values: unknown, current: unknown, digest: Digest) => Promise<boolean>>("verifyMemoryReviewConfirmationBatchV1");
    expect(await verify([created], [input], hash)).toBe(true);
    for (const confirmations of [[], [created, created], [{ ...created, confirmation_digest: "0".repeat(64) }]]) {
      expect(await verify(confirmations, [input], hash)).toBe(false);
    }
    const another = review(); another.item_id = ids.person; another.final.reference.target.item_id = ids.person;
    const anotherConfirmation = await api<Create>("createMemoryReviewConfirmationV1")(another, hash);
    expect(await verify([created, anotherConfirmation], [input, another], hash)).toBe(true);
    expect(await verify([created], [input, another], hash)).toBe(false);
  });

  it("uses an independent accepted correction domain without inventing a pending review scope", async () => {
    const input = mutation(), created = await api<Create>("createMemoryItemMutationConfirmationV1")(input, hash);
    expect(hash(mutationTuple)).toBe(mutationHash); expect(created).toEqual({ ...input, confirmation_digest: mutationHash });
    expect(created.confirmation_digest).not.toBe(reviewHash); expect(created).not.toHaveProperty("review_scope_id");
    expect(await api<Verify>("verifyMemoryItemMutationConfirmationV1")(created, input, hash)).toBe(true);
    await expect(api<Create>("createMemoryItemMutationConfirmationV1")({ ...input, review_scope_id: ids.review }, hash))
      .rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" });
  });

  const mutationChanges: Array<[string, (value: ObjectValue) => void]> = [
    ["actor", v => { v.actor_user_id = ids.person; }], ["account", v => { v.account_id = ids.person; }],
    ["item version", v => { v.expected_item_version++; }], ["item", v => { v.item_id = ids.person; }],
    ["operation", v => { v.operation = "delete"; v.final_descriptor = null; }], ["entry", v => { v.entry_scope.person_id = ids.actor; }],
    ["current stored bytes", v => { v.expected_stored_descriptor = { ...finalDescriptor }; }],
    ["current protocol", v => { v.expected_content_protocol = "literal-v2"; v.expected_content_manifest_digest = "a".repeat(64); }],
    ["original provenance", v => { v.original_content_protocol = "literal-v2"; v.original_descriptor = { ...descriptor }; }],
    ["evidence ID", v => { v.evidence[0].evidence_id = ids.person; }], ["evidence version", v => { v.evidence[0].content_version = 2; }],
    ["evidence protocol", v => { v.evidence[0].content_protocol = "literal-v2"; v.evidence[0].content_manifest_digest = "a".repeat(64); }],
    ["final bytes", v => { v.final_descriptor = { ...descriptor }; }],
  ];
  it.each(mutationChanges)("rejects an old accepted mutation confirmation when current %s changes", async (_name, change) => {
    const input = mutation(), created = await api<Create>("createMemoryItemMutationConfirmationV1")(input, hash), current = structuredClone(input);
    change(current); expect(await api<Verify>("verifyMemoryItemMutationConfirmationV1")(created, current, hash)).toBe(false);
  });

  it("binds deletion explicitly and preserves legacy unknown-original/evidence semantics", async () => {
    const input: ObjectValue = { ...mutation(), operation: "delete", final_descriptor: null };
    const create = api<Create>("createMemoryItemMutationConfirmationV1"), confirmed = await create(input, hash);
    expect(confirmed.original_descriptor).toBeNull(); expect(confirmed.evidence[0].content_manifest_digest).toBeNull();
    expect(await api<Verify>("verifyMemoryItemMutationConfirmationV1")(confirmed, input, hash)).toBe(true);
    for (const changed of [{ ...input, final_descriptor: descriptor }, { ...input, original_content_protocol: "literal-v2" },
      { ...input, evidence: [input.evidence[0], input.evidence[0]] }, { ...input, final: { kind: "draft", reference: reference() } }]) {
      await expect(create(changed, hash)).rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" });
    }
  });

  it("rejects accessor and coercible accepted metadata without reading private exception prose", async () => {
    const create = api<Create>("createMemoryItemMutationConfirmationV1"); let reads = 0;
    const input = mutation();
    Object.defineProperty(input.expected_stored_descriptor, "sha256", { enumerable: true,
      get() { reads++; throw new Error("PRIVATE_SYNTHETIC_DESCRIPTOR"); } });
    await expect(create(input, hash)).rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" });
    const other = mutation(); other.evidence[0].content_manifest_digest = { toString() { reads++; return "a".repeat(64); } };
    await expect(create(other, hash)).rejects.toMatchObject({ code: "MEMORY_CONTENT_INVALID" });
    expect(reads).toBe(0);
  });
});
