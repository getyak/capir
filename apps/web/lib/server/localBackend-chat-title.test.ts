import { beforeEach, expect, it, vi } from "vitest";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
const { client } = vi.hoisted(() => ({ client: { currentSession: vi.fn(), setClientPlatform: vi.fn(), compileKnowledge: vi.fn(), getAgentSession: vi.fn(), saveAgentSession: vi.fn(), createChatTask: vi.fn() } }));
vi.mock("./backendAuth", () => ({ authenticatedBackendClient: async () => client, authSecret: () => "synthetic-title-test" }));
import { askRelationshipChat } from "./localBackend";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.clearAllMocks(); client.currentSession.mockResolvedValue({});
  client.getAgentSession.mockResolvedValue({ session: { revision: 2, payload: { id, title: "Chosen title", scopeKind: "relationship", turns: [], composerDraft: "Unsent draft" } } });
  client.createChatTask.mockResolvedValue({ contract_version: CONTRACT_VERSION, task_id: id, session_title: "Model title", blocks: [], created_at: "2026-10-29T00:00:00Z" });
});
it("preserves a title chosen during a relationship run and retains its draft", async () => {
  await askRelationshipChat({ request_id: id, person_id: id, relationship_context_id: id, objective: "Synthetic first message" });
  expect(client.saveAgentSession).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    expected_revision: 2, payload: expect.objectContaining({ title: "Chosen title", composerDraft: "Unsent draft", turns: expect.any(Array) }),
  }));
});
