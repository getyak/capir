import { randomUUID } from "node:crypto";

import type { UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";

import { readAgentSessionConversation } from "./agentSessions.js";
import {
  independentReply,
  savedMemoryDatabase,
  withSavedMemoryFixture,
} from "./fixtures/savedMemoryDiscovery.fixture.js";

// New-feature initial regressions, not an assertion that these cases have run.
// The explicit Hosted PG selector must supply the disposable URL and collect
// all six cases with zero skips. No production module/API is mocked or missing.
describe.skipIf(!savedMemoryDatabase)("saved Memory discovery and durable withdrawal over actual HTTP/PG owners", () => {
  it.each(["delete", "correct", "delete_source"] as const)(
    "does not replay a completed Memory-derived reply after %s; preserves an independent completed reply",
    async change => withSavedMemoryFixture(async f => {
      const independentKey = randomUUID(), independentObjective = "Give a short synthetic greeting.";
      const independent = await f.post({ idempotency_key: independentKey, objective: independentObjective });
      expect(independent.statusCode).toBe(201);
      expect(independent.json<UnscopedChatTaskResponse>().blocks[0]?.body).toBe(independentReply);
      expect(f.provider.delivered).toEqual([]);
      const statement = "My synthetic aurora project uses a copper notebook.";
      const memory = await f.acceptSelf(statement);
      f.provider.mode = "recall";
      f.provider.selectedMemoryID = memory.itemID;
      const key = randomUUID(), objective = "Remind me of my saved project detail.";
      // No product Session is intentional: this ordinary workspace entry is
      // legal and may not evade durable Memory dependencies through omission.
      const answer = await f.post({ idempotency_key: key, objective });
      expect(answer.statusCode).toBe(201);
      const body = answer.json<UnscopedChatTaskResponse>();
      expect(f.provider.delivered).toContainEqual({ id: memory.itemID, version: memory.version, display_text: statement });
      expect(body.blocks[0]?.body).toBe(statement);
      const calls = f.provider.calls;
      const lawfulReplay = await f.post({ idempotency_key: key, objective });
      expect(lawfulReplay.statusCode).toBe(201);
      expect(lawfulReplay.json<UnscopedChatTaskResponse>().task_id).toBe(body.task_id);
      expect(lawfulReplay.json<UnscopedChatTaskResponse>().blocks[0]?.body).toBe(statement);
      expect(f.provider.calls).toBe(calls);
      const withdrawal = change === "delete_source"
        ? await f.request({ method: "DELETE", url: `/v1/agent-sessions/${memory.sourceSessionID}`,
          payload: { expected_revision: 1, idempotency_key: randomUUID() } })
        : await f.request({ method: "POST", url: `/v1/memory/items/${memory.itemID}/mutations`, payload: {
          operation: change, expected_version: memory.version, idempotency_key: randomUUID(),
          ...(change === "correct" ? { display_text: "My synthetic project now uses a silver notebook." } : {}),
          reason: "The synthetic human explicitly withdraws the old saved statement.",
        } });
      expect(withdrawal.statusCode).toBe(200);
      expect((await f.recall()).items.some(item => item.id === memory.itemID)).toBe(false);
      expect(await f.current()).toBe(200); // A blanket login denial is not withdrawal proof.
      const replay = await f.post({ idempotency_key: key, objective });
      expect.soft(replay.statusCode).toBeGreaterThanOrEqual(400);
      expect.soft(replay.statusCode).toBeLessThan(500);
      expect.soft(replay.body.includes(statement)).toBe(false);
      expect.soft(f.provider.calls).toBe(calls); // No retry/fallback/new model attempt.
      const independentReplay = await f.post({ idempotency_key: independentKey, objective: independentObjective });
      expect(independentReplay.statusCode).toBe(201);
      expect(independentReplay.json<UnscopedChatTaskResponse>().blocks[0]?.body).toBe(independentReply);
      expect(f.provider.calls).toBe(calls);
    }),
  );

  it.each([false, true])(
    "removes withdrawn derived text from the existing history reader while preserving human prose (complete=%s)",
    async complete => withSavedMemoryFixture(async f => {
      const statement = "My synthetic coral project uses a violet notebook.";
      const memory = await f.acceptSelf(statement);
      f.provider.mode = "recall";
      f.provider.selectedMemoryID = memory.itemID;
      const objective = "Please remind me of the project detail I previously saved.";
      const answer = await f.post({ idempotency_key: randomUUID(), objective });
      expect(answer.statusCode).toBe(201);
      const body = answer.json<UnscopedChatTaskResponse>();
      expect(body.blocks[0]?.body).toBe(statement);
      expect(f.provider.delivered).toContainEqual({ id: memory.itemID, version: memory.version, display_text: statement });
      const sessionID = randomUUID();
      const saved = await f.saveAnswer(sessionID, objective, body);
      expect(saved.payload?.turns).toHaveLength(1);
      const scope = { personId: null, relationshipContextId: null };
      const before = await readAgentSessionConversation(f.pool, f.auth, sessionID, scope, { complete });
      expect(before.messages).toContainEqual({ message_id: saved.payload!.turns[0]!.id, role: "user", text: objective });
      expect(before.messages.some(message => message.role === "assistant" && message.text === statement)).toBe(true);
      const calls = f.provider.calls;
      const withdrawal = await f.request({ method: "POST", url: `/v1/memory/items/${memory.itemID}/mutations`,
        payload: { operation: "delete", expected_version: memory.version, idempotency_key: randomUUID(),
          reason: "Explicit synthetic human withdrawal after canonical Session persistence." } });
      expect(withdrawal.statusCode).toBe(200);
      expect((await f.recall()).items.some(item => item.id === memory.itemID)).toBe(false);
      expect(await f.current()).toBe(200);
      const after = await readAgentSessionConversation(f.pool, f.auth, sessionID, scope, { complete });
      expect.soft(after.messages.some(message => message.text.includes(statement))).toBe(false);
      expect.soft(after.messages).toContainEqual({ message_id: saved.payload!.turns[0]!.id, role: "user", text: objective });
      expect(f.provider.calls).toBe(calls);
    }),
  );

  it("routes the actual read-only search_saved_memory tool to an older accepted literal clue", async () => {
    await withSavedMemoryFixture(async f => {
      const statement = "My synthetic aurora_%\\ project uses a copper notebook.";
      const memory = await f.acceptSelf(statement);
      // A pattern implementation that treats '_'/'%' as wildcards must not
      // include this independently accepted non-literal neighbour.
      await f.acceptSelf("My synthetic auroraXQ project uses a silver notebook.");
      f.provider.mode = "discovery";
      f.provider.discoveryTerms = ["aurora_%\\"];
      const answer = await f.post({ idempotency_key: randomUUID(), objective: "Find my saved project clue." });
      expect(answer.statusCode).toBe(201);
      // The scripted adapter dispatches the real tool through the real runtime.
      // It never fabricates a successful tool result or an accepted Memory row.
      expect(f.provider.toolManifest).toContain("search_saved_memory");
      expect(f.provider.toolResults).toHaveLength(1);
      const result = f.provider.toolResults[0]!;
      expect(result.name).toBe("search_saved_memory");
      expect(result.ok).toBe(true);
      const page = result.data as { matching: string; items: Array<{ id: string; version: number; display_text: string }>;
        has_more: boolean; next_cursor: string | null };
      expect(page.matching).toBe("literal_terms_any");
      expect(page.items).toHaveLength(1);
      expect(page.items).toContainEqual(expect.objectContaining({ id: memory.itemID, version: memory.version, display_text: statement }));
      expect(page.has_more).toBe(false);
      expect(page.next_cursor).toBeNull();
      expect(f.provider.fallbackCalls).toBe(0);
      expect(await f.current()).toBe(200);
    });
  });
});
