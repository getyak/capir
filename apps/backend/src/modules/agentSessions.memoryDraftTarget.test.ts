import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { CONTRACT_VERSION, type AgentSessionPayload } from "@talent-signal/contracts";
import { describe, expect, it, vi } from "vitest";
import { mutateAgentSession } from "./agentSessions.js";
import type { AuthContext } from "./auth.js";

const personID = "22222222-2222-4222-8222-222222222222";
const otherPersonID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const auth: AuthContext = { accountId: randomUUID(), accountSlug: "synthetic", userId: randomUUID(),
  userEmail: "synthetic@example.test", userKind: "simulated_human", sessionId: randomUUID() };

function payload(target = true): AgentSessionPayload {
  const stamp = new Date().toISOString();
  return { id: randomUUID(), scopeKind: "unresolved_intent", personDisplayLabel: "Conversation", contextDisplayLabel: "Conversation",
    title: "Synthetic draft history", updatedAt: stamp, isUnread: false,
    turns: [{ id: randomUUID(), objective: "Prepare a reviewable Memory draft for the selected person.", createdAt: stamp,
      ...(target ? { memoryDraftTarget: { person_id: personID } } : {}),
      response: { contractVersion: CONTRACT_VERSION, taskID: randomUUID(), contextManifestID: "none-unbound-conversation",
        knowledgeSnapshotID: "none-unbound-conversation", disposition: "answered", createdAt: stamp, savedBlocks: [] } }],
  };
}

/** A SQL-boundary fake: production mutateAgentSession owns validation and provenance.
 * It does not model source lifecycle; that requires the isolated PostgreSQL suite.
 */
function fakeStore(previous: AgentSessionPayload | null) {
  type Row = { id: string; created_by_user_id: string; revision: number; payload: AgentSessionPayload | null;
    created_at: Date; updated_at: Date; expires_at: Date; deleted_at: Date | null;
    composer_draft_hash: null; composer_draft_started_at: null };
  const date = new Date();
  let row: Row | null = previous ? { id: previous.id, created_by_user_id: auth.userId, revision: 1,
    payload: structuredClone(previous), created_at: date, updated_at: date,
    expires_at: new Date(date.valueOf() + 86_400_000), deleted_at: null, composer_draft_hash: null, composer_draft_started_at: null } : null;
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    const result = (rows: unknown[] = []) => ({ command: "SELECT", rowCount: rows.length, rows, fields: [], oid: 0 });
    if (sql.includes("SELECT retired_at FROM accounts")) return result([{ retired_at: null }]);
    if (sql.startsWith("SELECT * FROM agent_sessions")) return result(row ? [structuredClone(row)] : []);
    if (sql.includes("SELECT redact_agent_session_payload($1,$2::jsonb) AS payload")) return result([{ payload: JSON.parse(values[1] as string) }]);
    if (sql.includes("SELECT octet_length")) return result([{ bytes: Buffer.byteLength(values[0] as string) }]);
    if (sql.includes("INSERT INTO agent_sessions(")) {
      row = { id: values[1] as string, created_by_user_id: auth.userId, revision: (row?.revision ?? 0) + 1,
        payload: JSON.parse(values[3] as string), created_at: values[4] as Date, updated_at: new Date(),
        expires_at: values[5] as Date, deleted_at: null, composer_draft_hash: null, composer_draft_started_at: null };
      return result([structuredClone(row)]);
    }
    return result();
  });
  const client = { query, release: vi.fn() };
  return { pool: { connect: async () => client } as unknown as Pool, query, stored: () => row?.payload };
}

function mutate(store: ReturnType<typeof fakeStore>, value: AgentSessionPayload, revision = 1) {
  return mutateAgentSession(store.pool, auth, value.id, {
    expected_revision: revision, idempotency_key: randomUUID(), payload: value,
  });
}

describe("server-owned Memory target history", () => {
  it("restores target metadata omitted by a legacy client without changing Session authority", async () => {
    const original = payload();
    const store = fakeStore(original);
    const legacy = structuredClone(original);
    delete legacy.turns[0]!.memoryDraftTarget;
    legacy.title = "User-owned title changed";
    const saved = await mutate(store, legacy);
    expect(saved.payload!.turns[0]!.memoryDraftTarget).toEqual({ person_id: personID });
    expect(store.stored()!.turns[0]!.memoryDraftTarget).toEqual({ person_id: personID });
    expect(saved.payload!.scopeKind).toBe("unresolved_intent");
    expect(saved.payload).not.toHaveProperty("personID");
    expect(legacy.turns[0]).not.toHaveProperty("memoryDraftTarget");
  });

  it("refuses a target on a new client-authored turn", async () => {
    const store = fakeStore(null);
    await expect(mutate(store, payload(), 0)).rejects.toMatchObject({ statusCode: 409, code: "AGENT_SESSION_EXECUTION_PROVENANCE_CHANGED" });
    expect(store.stored()).toBeUndefined();
    expect(store.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO agent_sessions("))).toBe(false);
  });

  it("refuses a client target added to an existing ordinary turn or resurrected after canonical scrubbing", async () => {
    const ordinary = payload(false);
    const store = fakeStore(ordinary);
    const forged = structuredClone(ordinary);
    forged.turns[0]!.memoryDraftTarget = { person_id: personID };
    await expect(mutate(store, forged)).rejects.toMatchObject({ statusCode: 409, code: "AGENT_SESSION_EXECUTION_PROVENANCE_CHANGED" });
    expect(store.stored()!.turns[0]).not.toHaveProperty("memoryDraftTarget");
  });

  it("refuses changing the selected Person on a canonical target", async () => {
    const original = payload();
    const store = fakeStore(original);
    const changed = structuredClone(original);
    changed.turns[0]!.memoryDraftTarget = { person_id: otherPersonID };
    await expect(mutate(store, changed)).rejects.toMatchObject({ statusCode: 409, code: "AGENT_SESSION_EXECUTION_PROVENANCE_CHANGED" });
    expect(store.stored()!.turns[0]!.memoryDraftTarget).toEqual({ person_id: personID });
  });

  it.each(["objective", "createdAt", "taskID"] as const)("keeps target provenance attached to the same immutable %s", async field => {
    const original = payload();
    const store = fakeStore(original);
    const changed = structuredClone(original);
    delete changed.turns[0]!.memoryDraftTarget;
    if (field === "objective") changed.turns[0]!.objective = "Different authored source";
    if (field === "createdAt") changed.turns[0]!.createdAt = new Date(Date.now() - 5000).toISOString();
    if (field === "taskID") changed.turns[0]!.response.taskID = randomUUID();
    await expect(mutate(store, changed)).rejects.toMatchObject({ statusCode: 409, code: "AGENT_SESSION_EXECUTION_PROVENANCE_CHANGED" });
  });

  it("accepts an unchanged canonical target without treating UUID case as a target change", async () => {
    const original = payload();
    original.turns[0]!.memoryDraftTarget = { person_id: otherPersonID };
    const store = fakeStore(original);
    const echoed = structuredClone(original);
    echoed.turns[0]!.memoryDraftTarget!.person_id = otherPersonID.toUpperCase();
    const saved = await mutate(store, echoed);
    expect(saved.payload!.turns[0]!.memoryDraftTarget).toEqual({ person_id: otherPersonID });
  });
});
