import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { CloneType, FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { AgentSessionRecordSchema, CONTRACT_VERSION, type AgentSessionRecord } from "@talent-signal/contracts";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiError.js";

const store = vi.hoisted(() => ({ read: vi.fn(), list: vi.fn(), mutate: vi.fn() }));
vi.mock("./agentSessions.js", () => ({
  getAgentSession: store.read, listAgentSessions: store.list, mutateAgentSession: store.mutate,
  runAgentSessionRetentionSweep: vi.fn(),
}));
import { registerAgentSessionRoutes } from "./agentSessionRoutes.js";

const sessionID = "11111111-1111-4111-8111-111111111111";
const personID = "22222222-2222-4222-8222-222222222222";
const messageID = "33333333-3333-4333-8333-333333333333";
const stamp = "2026-10-29T00:00:00.000Z";
const headerName = "x-conversation-memory-draft-target";
// Schema clones must retain TypeBox's symbol-keyed Kind/Optional metadata.
const legacyRecord = CloneType(AgentSessionRecordSchema);
delete (legacyRecord.properties.payload.anyOf[0].properties.turns.items.properties as Record<string, unknown>).memoryDraftTarget;
FormatRegistry.Set("uuid", value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
FormatRegistry.Set("date-time", value => Number.isFinite(Date.parse(value)));

function canonical(): AgentSessionRecord {
  return { session_id: sessionID, revision: 3, updated_at: stamp, expires_at: "2026-11-01T00:00:00.000Z",
    deleted_at: null, display_authority: "stale_unconfirmed", payload: {
      id: sessionID, scopeKind: "unresolved_intent", personDisplayLabel: "Conversation", contextDisplayLabel: "Conversation",
      title: "Synthetic Memory draft", updatedAt: stamp, isUnread: false,
      turns: [{ id: messageID, objective: "Prepare a reviewable draft.", createdAt: stamp,
        memoryDraftTarget: { person_id: personID }, response: { contractVersion: CONTRACT_VERSION,
          taskID: messageID, contextManifestID: "none-unbound-conversation", knowledgeSnapshotID: "none-unbound-conversation",
          disposition: "answered", createdAt: stamp, savedBlocks: [] } }],
    } };
}

let current: AgentSessionRecord;
const apps: ReturnType<typeof Fastify>[] = [];
async function app() {
  const server = Fastify();
  apps.push(server);
  await server.register(rateLimit, { global: false });
  server.setErrorHandler((error, req, reply) => {
    const caught = error as ApiError;
    reply.code(caught.statusCode ?? 500).send({ error: { code: caught.code ?? "INVALID", message: caught.message,
      request_id: req.id, ...(caught.details ? { details: caught.details } : {}) } });
  });
  registerAgentSessionRoutes(server, {} as Pool, async req => {
    req.auth = { accountId: sessionID, accountSlug: "synthetic", userId: sessionID,
      userEmail: "synthetic@example.test", userKind: "simulated_human", sessionId: sessionID };
  });
  return server;
}
beforeEach(() => {
  vi.clearAllMocks();
  current = canonical();
  store.read.mockImplementation(async () => current);
  store.mutate.mockImplementation(async () => current);
  store.list.mockImplementation(async () => ({ contract_version: CONTRACT_VERSION, sessions: [current], complete: true, next_cursor: null }));
});
afterEach(async () => { await Promise.all(apps.splice(0).map(server => server.close())); });

describe("historical Memory target reader negotiation", () => {
  for (const method of ["GET", "PUT", "DELETE", "LIST"] as const) {
    it.each([undefined, "0", "1"])(`${method} exposes target metadata only for the exact reader opt-in %s`, async header => {
      const server = await app();
      const payload = { expected_revision: current.revision, idempotency_key: messageID,
        ...(method === "PUT" ? { payload: current.payload } : {}) };
      const result = await server.inject({ method: method === "LIST" ? "GET" : method,
        url: `/v1/agent-sessions${method === "LIST" ? "" : `/${sessionID}`}`,
        ...(method === "PUT" || method === "DELETE" ? { payload } : {}),
        ...(header ? { headers: { [headerName]: header } } : {}),
      });
      expect(result.statusCode, result.body).toBe(200);
      expect(result.headers["cache-control"]).toBe("no-store");
      const record = method === "LIST" ? result.json().sessions[0] : result.json().session;
      expect(record.payload.turns[0].memoryDraftTarget).toEqual(header === "1" ? { person_id: personID } : undefined);
      expect(Value.Check(legacyRecord, record)).toBe(header !== "1");
      expect(record.payload.scopeKind).toBe("unresolved_intent");
      expect(record.payload).not.toHaveProperty("personID");
      expect(current.payload!.turns[0]!.memoryDraftTarget).toEqual({ person_id: personID });
      if (method === "PUT") expect(store.mutate.mock.calls[0]).toHaveLength(4);
    });
  }

  it.each([undefined, "1"])("keeps conflict recovery DTOs compatible with opt-in %s", async header => {
    store.mutate.mockRejectedValue(new ApiError(409, "AGENT_SESSION_REVISION_CONFLICT", "Read the current revision.", { session: current }));
    const result = await (await app()).inject({ method: "PUT", url: `/v1/agent-sessions/${sessionID}`,
      payload: { expected_revision: 1, idempotency_key: messageID, payload: current.payload },
      ...(header ? { headers: { [headerName]: header } } : {}) });
    expect(result.statusCode).toBe(409);
    const record = result.json().error.details.session;
    expect(Value.Check(legacyRecord, record)).toBe(header !== "1");
    expect(record.payload.turns[0].memoryDraftTarget).toEqual(header === "1" ? { person_id: personID } : undefined);
    expect(current.payload!.turns[0]!.memoryDraftTarget).toEqual({ person_id: personID });
  });

  it("does not invent content when the canonical Session is a tombstone", async () => {
    current = { ...current, payload: null, deleted_at: stamp };
    const result = await (await app()).inject({ method: "GET", url: `/v1/agent-sessions/${sessionID}` });
    expect(result.statusCode).toBe(200);
    expect(result.json().session.payload).toBeNull();
    expect(Value.Check(legacyRecord, result.json().session)).toBe(true);
  });
});
