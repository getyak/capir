import Fastify from "fastify";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { registerConversationQueueRoutes } from "./conversationQueueRoutes.js";
const { admit } = vi.hoisted(() => ({ admit: vi.fn() }));
vi.mock("./conversationQueue.js", () => ({ admitConversationQueueEntry: admit,
  mutateConversationQueueEntry: vi.fn(), readConversationQueueSnapshot: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const personID = "22222222-2222-4222-8222-222222222222";
const path = `/v1/agent-sessions/${id}/conversation-queue`;
const request = { session_id: id, message_id: id, objective: "Prepare a reviewable draft from this text.", idempotency_key: "synthetic" };
const apps: ReturnType<typeof Fastify>[] = [];
async function app() {
  const server = Fastify(); apps.push(server);
  server.setErrorHandler((error, req, reply) => { const e = error as Error & { statusCode?: number; code?: string };
    reply.status(e.statusCode ?? 500).send({ error: { code: e.code ?? "INVALID", message: e.message, request_id: req.id } }); });
  registerConversationQueueRoutes(server, {} as Pool, async req => {
    req.auth = { accountId: id, accountSlug: "synthetic", userId: id, userEmail: "synthetic@example.test",
      userKind: "simulated_human", sessionId: id };
  });
  admit.mockImplementation(async (_pool, _auth, body) => ({ response: { contract_version: CONTRACT_VERSION,
    session_id: id, message_id: id, queue_entry_id: id, run_id: null, status: "queued", sequence: 1,
    revision: 1, snapshot_revision: 1, accepted_at: "2026-10-29T00:00:00.000Z",
    ...(body.memory_draft_target ? { memory_draft_target: body.memory_draft_target } : {}) }, replayed: false }));
  return server;
}
afterEach(async () => { await Promise.all(apps.splice(0).map(server => server.close())); vi.clearAllMocks(); });
describe("explicit Memory draft admission route", () => {
  it("requires the dedicated path and echoes the unchanged selected target", async () => {
    const server = await app(); const target = { person_id: personID };
    const result = await server.inject({ method: "POST", url: `${path}/memory-draft`, payload: { ...request, memory_draft_target: target } });
    expect(result.statusCode).toBe(202); expect(result.json().memory_draft_target).toEqual(target);
    expect(admit.mock.calls[0]?.[2]).toMatchObject({ memory_draft_target: target });
    const ordinary = await server.inject({ method: "POST", url: path, payload: { ...request, memory_draft_target: target } });
    expect(ordinary.statusCode).toBe(422); expect(admit).toHaveBeenCalledOnce();
  });
  it("preserves ordinary admission's legacy response shape", async () => {
    const result = await (await app()).inject({ method: "POST", url: path, payload: request });
    expect(result.statusCode).toBe(202); expect(result.json()).not.toHaveProperty("memory_draft_target");
  });
  it.each([
    request,
    { ...request, memory_draft_target: { person_id: personID, display_label: "untrusted extra" } },
    { ...request, memory_draft_target: { person_id: "not-a-person-id" } },
  ])("fails closed without stripping an absent or malformed target: %j", async payload => {
    const result = await (await app()).inject({ method: "POST", url: `${path}/memory-draft`, payload });
    expect(result.statusCode).toBeGreaterThanOrEqual(400); expect(result.statusCode).toBeLessThan(500);
    expect(admit).not.toHaveBeenCalled();
  });
  it("gets an unsupported-path response from an old server rather than ordinary admission", async () => {
    const legacy = Fastify(); apps.push(legacy); const accepted = vi.fn(() => ({ accepted: true }));
    legacy.post(path, accepted);
    const result = await legacy.inject({ method: "POST", url: `${path}/memory-draft`, payload: { ...request, memory_draft_target: { person_id: personID } } });
    expect(result.statusCode).toBe(404); expect(accepted).not.toHaveBeenCalled();
  });
});
