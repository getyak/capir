import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { ConversationMemoryDraftTargetSchema, TalentSignalClient } from "@talent-signal/contracts";
import { memoryDraftHasAuthoredText, reconcileMemoryDraftTarget } from "./conversation-memory-draft-target";
import { conversationExpiry, readConversationMessages, writeConversationMessage, type LocalMessage } from "./conversation-local";

const PERSON = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
let previousUuidFormat: ReturnType<typeof FormatRegistry.Get>;
beforeAll(() => { previousUuidFormat = FormatRegistry.Get("uuid"); FormatRegistry.Set("uuid", value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)); });
afterAll(() => { if (previousUuidFormat) FormatRegistry.Set("uuid", previousUuidFormat); else FormatRegistry.Delete("uuid"); });

function storage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); }, key: index => [...data.keys()][index] ?? null, clear: () => data.clear() };
}
function message(extra: Record<string, unknown> = {}): LocalMessage {
  return { id: MESSAGE, objective: "@Lin Prepare this authored note for review.", createdAt: new Date().toISOString(), delivery: "unknown", expiresAt: conversationExpiry(), ...extra } as LocalMessage;
}

it("limits a current-message target to one Person ID without identity, recall, or effect authority", () => {
  expect(Value.Check(ConversationMemoryDraftTargetSchema, { person_id: PERSON })).toBe(true);
  for (const value of [null, [], { person_id: "name-only" }, { person_id: PERSON, humanIdentityBinding: true }, { person_id: PERSON, relationship_context_id: PERSON }, { person_id: PERSON, recall: true }]) {
    expect(Value.Check(ConversationMemoryDraftTargetSchema, value)).toBe(false);
  }
});

it("restores the original immutable target and text from the outbox without inferring one for old messages", () => {
  const target = storage();
  writeConversationMessage("account", SESSION, message({ memoryDraftTarget: { person_id: PERSON }, memoryDraftTargetLabel: "Lin" }), target);
  expect(readConversationMessages("account", SESSION, target)[0]).toMatchObject({ objective: "@Lin Prepare this authored note for review.", memoryDraftTarget: { person_id: PERSON }, memoryDraftTargetLabel: "Lin" });
  writeConversationMessage("other-account", SESSION, message(), target);
  expect(readConversationMessages("other-account", SESSION, target)[0]).not.toHaveProperty("memoryDraftTarget");
});

it("rejects malformed stored targets instead of downgrading them to ordinary unbound messages", () => {
  for (const memoryDraftTarget of [{ person_id: "Lin" }, { person_id: PERSON, recall: true }, null, [{ person_id: PERSON }]]) {
    const target = storage();
    writeConversationMessage("account", SESSION, message({ memoryDraftTarget }), target);
    expect(readConversationMessages("account", SESSION, target)).toEqual([]);
  }
});

it("does not restore an image-only targeted message with no current authored text", () => {
  const target = storage();
  writeConversationMessage("account", SESSION, message({ objective: "", memoryDraftTarget: { person_id: PERSON }, images: [{ attachment_id: MESSAGE, file_name: "image.png", media_type: "image/png", byte_size: 4, content_hash: "a".repeat(64) }] }), target);
  expect(readConversationMessages("account", SESSION, target)).toEqual([]);
});

it("keeps only the untouched explicitly chosen reference and requires authored text beyond it", () => {
  const target = { person_id: PERSON, label: "Lin", start: 0, end: 4, text: "@Lin" };
  expect(memoryDraftHasAuthoredText("@Lin ", target)).toBe(false);
  expect(memoryDraftHasAuthoredText("@Lin authored", target)).toBe(true);
  expect(reconcileMemoryDraftTarget("@Lin old", "@Lin new text", target)).toEqual(target);
  expect(reconcileMemoryDraftTarget("@Lin old", "@Other old", target)).toBeNull();
  expect(reconcileMemoryDraftTarget("@Lin old", "", target)).toBeNull();
  expect(reconcileMemoryDraftTarget("@Lin old", "note @Lin old", target)).toMatchObject({ start: 5, end: 9 });
});

it("uses a separate target admission route so older backends cannot strip the target and accept an ordinary message", async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({}));
  vi.stubGlobal("fetch", transport);
  try {
    const client = new TalentSignalClient("https://synthetic.invalid", "synthetic-test-only");
    const body = { session_id: SESSION, message_id: MESSAGE, idempotency_key: MESSAGE, objective: "current text" };
    await client.admitConversationQueueEntry(body);
    await client.admitConversationQueueEntry({ ...body, memory_draft_target: { person_id: PERSON } });
    expect(String(transport.mock.calls[0][0])).toMatch(/\/conversation-queue$/u);
    expect(String(transport.mock.calls[1][0])).toMatch(/\/conversation-queue\/memory-draft$/u);
  } finally { vi.unstubAllGlobals(); }
});

it("opts only new historical readers into target metadata while keeping the legacy reader request unchanged", async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({})); vi.stubGlobal("fetch", transport);
  try {
    const client = new TalentSignalClient("https://synthetic.invalid", "synthetic-test-only");
    await client.getAgentSession(SESSION);
    await client.getAgentSession(SESSION, undefined, { includeMemoryDraftTargets: true });
    const headers = (index: number) => new Headers(transport.mock.calls[index][1]?.headers);
    expect(headers(0).has("x-conversation-memory-draft-target")).toBe(false);
    expect(headers(1).get("x-conversation-memory-draft-target")).toBe("1");
  } finally { vi.unstubAllGlobals(); }
});
