import { beforeEach, describe, expect, it, vi } from "vitest";

const { client } = vi.hoisted(() => ({ client: {
  currentSession: vi.fn(), getPerson: vi.fn(), listPeople: vi.fn(),
  listMemoryProposals: vi.fn(), recallMemories: vi.fn(),
  resolveMemoryPursuitScopes: vi.fn(),
} }));
vi.mock("server-only", () => ({}));
vi.mock("./backendAuth", () => ({
  authenticatedBackendClient: vi.fn(async () => client),
  authSecret: vi.fn(() => "synthetic-memory-loader-test"),
}));

import { loadPersonMemory, loadPursuitMemoryScopes } from "./localBackend";

const personId = "11111111-1111-4111-8111-111111111111";
const otherPersonId = "22222222-2222-4222-8222-222222222222";
const item = { id: "memory-1", subject_id: personId, scope: "person" };

beforeEach(() => {
  vi.resetAllMocks();
  client.currentSession.mockResolvedValue({});
  client.getPerson.mockResolvedValue({ person: { id: personId }, basic_fields: [], contact_points: [] });
  client.listMemoryProposals.mockResolvedValue({ proposals: [] });
  client.recallMemories.mockResolvedValue({ surface: "people", person_id: personId, items: [item], has_more: false });
  client.resolveMemoryPursuitScopes.mockResolvedValue({ scopes: [] });
});

describe("exact Person Memory destination", () => {
  it("pages only exact relationship scopes and never lets an unresolved scope conceal the other authorized entries", async () => {
    client.resolveMemoryPursuitScopes.mockResolvedValue({ scopes: [
      { person_id: personId, relationship_context_id: null },
      { person_id: personId, relationship_context_id: otherPersonId },
    ] });
    const result = await loadPursuitMemoryScopes(personId);
    expect(client.listMemoryProposals).toHaveBeenCalledTimes(1);
    expect(client.listMemoryProposals).toHaveBeenCalledWith({ purpose: "relationship", person_id: personId,
      relationship_context_id: otherPersonId, paginate: true });
    expect(result).toHaveLength(1); expect(result[0]?.relationship_context_id).toBe(otherPersonId);
  });
  it("reads the exact person independently of the bounded directory and keeps continuation", async () => {
    client.recallMemories.mockResolvedValue({ surface: "people", person_id: personId, items: [item], has_more: true, next_cursor: "returned-cursor" });
    const result = await loadPersonMemory(personId);
    expect(client.getPerson).toHaveBeenCalledWith(personId);
    expect(client.listMemoryProposals).toHaveBeenCalledWith({ purpose: "people", person_id: personId, paginate: true });
    expect(client.listPeople).not.toHaveBeenCalled();
    expect(client.recallMemories).toHaveBeenCalledWith({ surface: "people", person_id: personId, limit: 50 });
    expect(result).toMatchObject({ person: { id: personId }, items: [item], basicFields: [], contactPoints: [], hasMore: true, nextCursor: "returned-cursor" });
  });

  it.each(["person", "surface", "self", "item-person", "missing-cursor"])("refuses an inconsistent %s readback", async (changed) => {
    if (changed === "person") client.getPerson.mockResolvedValue({ person: { id: otherPersonId }, basic_fields: [] });
    if (changed === "surface") client.recallMemories.mockResolvedValue({ surface: "chat", person_id: personId, items: [item] });
    if (changed === "self") client.recallMemories.mockResolvedValue({ surface: "people", person_id: personId, items: [{ ...item, scope: "self" }] });
    if (changed === "item-person") client.recallMemories.mockResolvedValue({ surface: "people", person_id: personId, items: [{ ...item, subject_id: otherPersonId }] });
    if (changed === "missing-cursor") client.recallMemories.mockResolvedValue({ surface: "people", person_id: personId, items: [item], has_more: true });
    await expect(loadPersonMemory(personId)).rejects.toThrow();
  });

  it("never authenticates or dispatches for a malformed person id", async () => {
    await expect(loadPersonMemory("invalid")).rejects.toThrow("人物标识无效");
    expect(client.currentSession).not.toHaveBeenCalled();
    expect(client.getPerson).not.toHaveBeenCalled();
  });
});
