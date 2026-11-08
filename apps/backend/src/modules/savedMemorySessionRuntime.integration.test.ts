/** Actual public HTTP/Core/Session boundaries on the explicitly owned Hosted
 * PostgreSQL. Only the existing synthetic provider is observed; every Memory,
 * answer, Session and canonical lineage is produced by its real product API. */
import { randomUUID } from "node:crypto";
import type { AgentSessionRecord, UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import { independentReply, savedMemoryDatabase, withSavedMemoryFixture,
  type SavedMemoryFixture } from "./fixtures/savedMemoryDiscovery.fixture.js";

if (process.env.GET_455_SESSION_MEMORY_RUNTIME_TEST_REQUIRED === "1" && !savedMemoryDatabase)
  throw new Error("The Session runtime gate requires its explicit disposable loopback PostgreSQL fixture.");

function observeModel(f: SavedMemoryFixture, syntheticReply?: string) {
  const original = f.provider.run;
  const frames: Array<{ history: readonly { message_id: string; role: string; text: string }[];
    selfCharacters: number; selfItems: number; selfStatus: string }> = [];
  const observed: typeof original = async (...args) => {
    const input = args[0];
    frames.push({ history: (input.conversationHistory ?? []).map(message => ({ ...message })),
      selfCharacters: JSON.stringify(input.selfMemoryContext ?? null).length,
      selfItems: input.selfMemoryContext?.items.length ?? 0,
      selfStatus: input.selfMemoryContext?.status ?? "unavailable" });
    const result = await original.apply(f.provider, args);
    // Configure only the synthetic remote result. Core validation, HTTP
    // publication, durable proof and later Session save remain real owners.
    return syntheticReply === undefined ? result : { ...result,
      structuredOutput: { outcome: "reply", title: "Synthetic long reply", body: syntheticReply } };
  };
  f.provider.run = observed;
  return { frames, dispose: () => { if (f.provider.run === observed) f.provider.run = original; } };
}

async function noCompletedKey(f: SavedMemoryFixture, key: string) {
  const rows = await f.pool.query<{ count: string }>(`SELECT count(*)::text AS count
    FROM idempotency_records WHERE account_id=$1 AND actor_user_id=$2
      AND operation_scope='create_unscoped_chat_task' AND idempotency_key=$3
      AND status='completed' AND response_status BETWEEN 200 AND 299`,
  [f.auth.accountId, f.auth.userId, key]);
  expect(rows.rows).toEqual([{ count: "0" }]);
}

describe.skipIf(!savedMemoryDatabase)("actual Session Memory runtime admission", { concurrent: false }, () => {
  it("delivers the real selected history and canonical V2 when the existing Session has less than seven days left", async () => {
    await withSavedMemoryFixture(async f => {
      const memory = await f.acceptSelf("My synthetic short-lived Session notebook has a copper cover.");
      f.provider.mode = "neutral";
      const objective = "A synthetic prior question for the short-lived Session.";
      const prior = await f.post({ idempotency_key: randomUUID(), objective });
      expect(prior.statusCode).toBe(201);
      const answer = prior.json<UnscopedChatTaskResponse>(), sessionID = randomUUID();
      const saved = await f.saveAnswer(sessionID, objective, answer);
      // Narrow only the owned synthetic source's lifetime, without inserting
      // proof or modifying its content. Real source guards must see this floor.
      const narrowed = await f.pool.query<{ short_lived: boolean }>(`UPDATE agent_sessions
        SET expires_at=clock_timestamp()+interval '1 hour'
        WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3 AND deleted_at IS NULL
        RETURNING expires_at>clock_timestamp() AND expires_at<clock_timestamp()+interval '2 hours' AS short_lived`,
      [f.auth.accountId, f.auth.userId, sessionID]);
      expect(narrowed.rows).toEqual([{ short_lived: true }]);
      const probe = observeModel(f), calls = f.provider.calls;
      try {
        const response = await f.post({ idempotency_key: randomUUID(), session_id: sessionID,
          objective: "Continue the same synthetic notebook conversation." });
        expect(response.statusCode).toBe(201);
        expect(f.provider.calls).toBe(calls + 1);
        expect(probe.frames).toHaveLength(1);
        expect(probe.frames[0]!.history).toEqual([
          { message_id: saved.payload!.turns[0]!.id, role: "user", text: objective },
          { message_id: answer.task_id, role: "assistant", text: independentReply },
        ]);
        expect(probe.frames[0]!.selfItems).toBe(1);
        expect(f.provider.delivered.map(item => item.id)).toEqual([memory.itemID]);
        const body = response.json<UnscopedChatTaskResponse>();
        const lineage = await f.pool.query<{ format_version: number; session_bound: boolean;
          source_is_original: boolean; within_source: boolean; dependency_count: number }>(`SELECT
          t.format_version,t.retention_kind='session_bound' AS session_bound,
          t.source_origin_session_id=s.id AS source_is_original,
          t.expires_at IS NOT NULL AND t.expires_at<=s.expires_at AS within_source,t.dependency_count
          FROM agent_task_memory_lineage t JOIN agent_sessions s ON s.account_id=t.account_id AND s.id=$4
          JOIN idempotency_records i ON i.id=t.completion_idempotency_id
          WHERE t.account_id=$1 AND t.reader_actor_id=$2 AND t.task_id=$3
            AND i.status='completed' AND i.response_status=201 AND i.response_body->>'task_id'=t.task_id::text`,
        [f.auth.accountId, f.auth.userId, body.task_id, sessionID]);
        expect(lineage.rows).toEqual([{ format_version: 2, session_bound: true,
          source_is_original: true, within_source: true, dependency_count: 1 }]);
        expect(f.provider.fallbackCalls).toBe(0);
        expect(await f.current()).toBe(200);
      } finally { probe.dispose(); }
    });
  }, 15_000);

  it("refuses the combined history and self Memory budget before model entry and leaves the saved Session intact", async () => {
    await withSavedMemoryFixture(async f => {
      const memories = [];
      for (let index = 0; index < 14; index++) {
        const text = `Synthetic personal notebook ${index}: ${String.fromCharCode(65 + index).repeat(900)}`;
        memories.push(await f.acceptSelf(text));
      }
      expect((await f.recall()).items.map(item => item.id).sort()).toEqual(memories.map(item => item.itemID).sort());
      f.provider.mode = "neutral";
      const sessionID = randomUUID();
      let saved: AgentSessionRecord | undefined;
      const syntheticReply = "Synthetic historical reply: " + "R".repeat(1_500);
      const probe = observeModel(f, syntheticReply);
      try {
        for (let index = 0; index < 6; index++) {
          const objective = `Synthetic historical question ${index}: ${String.fromCharCode(97 + index).repeat(940)}`;
          expect(objective.length).toBeLessThanOrEqual(1_000);
          const prior = await f.post({ idempotency_key: randomUUID(), objective });
          expect(prior.statusCode).toBe(201);
          expect(prior.json<UnscopedChatTaskResponse>().blocks[0]?.body).toBe(syntheticReply);
          saved = await f.saveAnswer(sessionID, objective, prior.json<UnscopedChatTaskResponse>(),
            { expectedRevision: saved?.revision ?? 0, priorTurns: saved?.payload?.turns ?? [] });
        }
        expect(saved?.payload?.turns).toHaveLength(6);
        expect(probe.frames).toHaveLength(6);
        const metadata = probe.frames.map(frame => ({ historyMessages: frame.history.length,
          selfItems: frame.selfItems, selfCharacters: frame.selfCharacters }));
        // A complete accepted page need not fit the whole-item core. The
        // actual compiler selected 13/14 here; require its explicit partial
        // state and measured context size, not an unbounded all-items frame.
        expect(probe.frames.every(frame => frame.history.length === 0 && frame.selfStatus === "partial"
          && frame.selfItems > 0 && frame.selfItems < memories.length
          && frame.selfCharacters > 16_000 && frame.selfCharacters < 24_000),
        "Actual synthetic frame counts: " + JSON.stringify(metadata)).toBe(true);
        const calls = f.provider.calls, before = JSON.stringify(saved!.payload), key = randomUUID();
        const response = await f.post({ idempotency_key: key, session_id: sessionID,
          objective: "Continue this synthetic conversation under the same shared context budget." });
        expect(response.statusCode).toBe(413);
        expect(response.json<{ error: { code: string } }>().error.code).toBe("SAVED_MEMORY_BUDGET_LIMITED");
        expect(f.provider.calls).toBe(calls);
        expect(probe.frames).toHaveLength(6);
        expect(f.provider.fallbackCalls).toBe(0);
        await noCompletedKey(f, key);
        const readback = await f.request({ method: "GET", url: `/v1/agent-sessions/${sessionID}` });
        expect(readback.statusCode).toBe(200);
        const actual = readback.json<{ session: AgentSessionRecord }>().session;
        expect(actual.revision).toBe(saved!.revision);
        expect(JSON.stringify(actual.payload)).toBe(before);
        expect(await f.current()).toBe(200);
      } finally { probe.dispose(); }
    });
  }, 15_000);
});
