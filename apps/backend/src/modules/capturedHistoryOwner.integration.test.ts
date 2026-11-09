import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createConversationHistoryTools, ScriptedAgentProvider } from "@talent-signal/agent";
import type { SessionResponse, UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import type { DatabaseClient } from "../database/pool.js";
import { admitLegacyChatAuthority, bindLegacyCapturedHistoryRun, prepareLegacyCapturedHistory,
  LegacyChatTerminated, type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { executeWorkspaceConversationAgent } from "./workspaceConversationAgent.js";
import { independentReply, savedMemoryDatabase, withSavedMemoryFixture,
  type SavedMemoryFixture } from "./fixtures/savedMemoryDiscovery.fixture.js";

if (process.env.GET_455_CAPTURED_HISTORY_TEST_REQUIRED === "1" && !savedMemoryDatabase)
  throw new Error("The captured history owner requires the explicit disposable database.");

async function setup(f: SavedMemoryFixture) {
  const objective = "Keep this synthetic greeting in my original Session.";
  const posted = await f.post({ idempotency_key: randomUUID(), objective });
  expect(posted.statusCode).toBe(201);
  const response = posted.json<UnscopedChatTaskResponse>();
  expect(response.blocks[0]?.body).toBe(independentReply);
  const sessionID = randomUUID();
  await f.saveAnswer(sessionID, objective, response);
  const enrollment = await f.request({ method: "POST", url: "/v1/auth/persistent/enroll",
    payload: { renewal_secret: randomBytes(32).toString("base64url"), client_kind: "web" } });
  expect(enrollment.statusCode).toBe(200);
  const login = enrollment.json<SessionResponse>();
  expect(login.session_id === f.auth.sessionId && login.account.id === f.auth.accountId && login.user.id === f.auth.userId).toBe(true);
  const owner = () => admitLegacyChatAuthority(f.pool, f.auth, `Bearer ${login.access_token}`,
    { databaseUrl: savedMemoryDatabase!, host: "127.0.0.1", port: 0, allowedOrigins: [], appleSignInAudiences: [],
      appleSignInEnabled: false, passwordAuthEnabled: true, passwordRegistrationEnabled: false, simulatedAuthEnabled: false, internalLabEnabled: false,
      retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 });
  const expiresAt = (await f.pool.query<{ expires_at: Date }>(
    "SELECT expires_at FROM agent_sessions WHERE account_id=$1 AND id=$2", [f.auth.accountId, sessionID])).rows[0]!.expires_at;
  const messageID = randomUUID();
  const prepare = (reader: LegacyChatAuthority, database: DatabaseClient, runID: string) =>
    prepareLegacyCapturedHistory(reader, { database, auth: f.auth, sessionID, taskID: runID, messageID,
      sources: () => ({ expiresAt, personIDs: [] }) });
  const execute = (reader: LegacyChatAuthority, database: DatabaseClient, runID: string,
    frame: Awaited<ReturnType<typeof prepareLegacyCapturedHistory>>) => executeWorkspaceConversationAgent({
      database, auth: f.auth, sessionID, messageID, runID, objective: "Read my synthetic greeting.",
      provider: new ScriptedAgentProvider([], { outcome: "reply", title: "Greeting", body: independentReply }),
      conversationHistory: frame.conversationHistory, ...(frame.snapshot ? { sessionHistory: frame.snapshot } : {}),
      capturedHistory: { owner: reader, handle: frame.handle }, assertCurrent: frame.snapshot?.assertCurrent ?? frame.guard,
    });
  return { owner, prepare, execute, sessionID, messageID, response };
}

describe.skipIf(!savedMemoryDatabase)("original captured history owner on real PostgreSQL", () => {
  it("rejects a same-text canonical body change even while the actual empty V2 remains current", async () => {
    await withSavedMemoryFixture(async f => {
      const state = await setup(f), reader = await state.owner(), runID = randomUUID();
      try {
        const frame = await state.prepare(reader, f.pool, runID);
        expect(frame.snapshot?.messages.some(m => m.text === independentReply)).toBe(true);
        await frame.snapshot!.assertCurrent();
        const changed = await f.pool.query(`UPDATE idempotency_records SET response_body=response_body #- '{blocks,0,title}'
          WHERE account_id=$1 AND actor_user_id=$2 AND operation_scope='create_unscoped_chat_task'
            AND status='completed' AND response_status=201 AND response_body->>'task_id'=$3
            AND (response_body#>'{blocks,0}') ? 'title' RETURNING response_body#>>'{blocks,0,body}'=$4 AS same_text`,
        [f.auth.accountId, f.auth.userId, state.response.task_id, independentReply]);
        expect(changed.rows).toEqual([{ same_text: true }]);
        const current = await f.pool.query("SELECT saved_memory_task_current($1,$2,$3,statement_timestamp()) AS current",
          [f.auth.accountId, state.response.task_id, f.auth.userId]);
        expect(current.rows).toEqual([{ current: true }]);
        await expect(frame.snapshot!.assertCurrent()).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(reader.signal.aborted).toBe(true);
        expect(() => reader.throwIfTerminated()).toThrow(LegacyChatTerminated);
      } finally { reader.dispose(); }
    });
  }, 15_000);

  it("retains the first inline obligation when the later complete read withholds its original reply", async () => {
    await withSavedMemoryFixture(async f => {
      const state = await setup(f), reader = await state.owner(), client = await f.pool.connect();
      const query = client.query;
      let inlineSelected = false, completeWithheld = false, removed = false;
      client.query = new Proxy(query, { apply(target, receiver, args: unknown[]) {
        const pending = Reflect.apply(target, receiver, args);
        if (typeof args[0] !== "string" || !args[0].includes("AS responses FROM budget")) return pending;
        return Promise.resolve(pending).then(async actual => {
          const rows = (actual as { rows: Array<{ responses: Array<{ claim: string | null;
            response_body: { task_id: string; blocks?: Array<{ body: string }> } }> }> }).rows;
          const body = rows[0]?.responses.find(item => item.response_body.task_id === state.response.task_id);
          if (!removed) {
            inlineSelected = Boolean(body?.claim && body.response_body.blocks?.some(block => block.body === independentReply));
            const change = await f.pool.connect();
            try {
              await change.query("BEGIN");
              await change.query("DELETE FROM agent_task_memory_session_copies WHERE account_id=$1 AND task_id=$2",
                [f.auth.accountId, state.response.task_id]);
              const loss = await change.query("DELETE FROM agent_task_memory_lineage WHERE account_id=$1 AND task_id=$2 AND dependency_count=0",
                [f.auth.accountId, state.response.task_id]);
              expect(loss.rowCount).toBe(1);
              await change.query("COMMIT"); removed = true;
            } catch (error) { await change.query("ROLLBACK"); throw error; }
            finally { change.release(); }
          } else completeWithheld = body?.claim === null && body.response_body.blocks?.length === 0;
          return actual;
        });
      } });
      try {
        let prepared = false;
        await expect(reader.withClient(client, async held => {
          const runID = randomUUID(), frame = await state.prepare(reader, held, runID);
          prepared = true;
          await state.execute(reader, held, runID, frame);
        })).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(prepared).toBe(false);
        expect(inlineSelected).toBe(true); expect(removed).toBe(true); expect(completeWithheld).toBe(true);
        expect(reader.signal.aborted).toBe(true);
      } finally { client.query = query; client.release(); reader.dispose(); }
    });
  }, 15_000);

  it("refuses a foreign frame before touching the recipient, and refuses the original guarded lease after return", async () => {
    await withSavedMemoryFixture(async f => {
      const state = await setup(f), a = await state.owner(), b = await state.owner(), client = await f.pool.connect();
      try {
        await client.query("BEGIN");
        const runID = randomUUID();
        const captured = await a.withClient(client, async held => {
          const frame = await state.prepare(a, held, runID);
          expect(() => bindLegacyCapturedHistoryRun(b, frame.handle, { runID, runDeadlineMonotonicMs: 0,
            workspaceID: f.auth.accountId, sessionID: state.sessionID, messageID: state.messageID,
            conversationHistory: frame.conversationHistory, sessionHistory: frame.snapshot }))
            .toThrow(LegacyChatTerminated);
          await b.assertCurrent();
          expect(b.signal.aborted).toBe(false);
          await state.execute(a, held, runID, frame);
          await frame.snapshot!.assertCurrent();
          return frame;
        });
        await expect(a.withClient(client, async () => captured.snapshot!.assertCurrent())).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(a.signal.aborted).toBe(true); await b.assertCurrent();
      } finally { try { await client.query("ROLLBACK"); } finally { client.release(); a.dispose(); b.dispose(); } }
    });
  }, 15_000);

  it("rejects both a raw borrowed client and a forwarding wrapper around the actual pool", async () => {
    await withSavedMemoryFixture(async f => {
      const state = await setup(f), client = await f.pool.connect();
      try {
        for (const database of [client, { query: f.pool.query.bind(f.pool) } as unknown as DatabaseClient]) {
          const reader = await state.owner();
          try {
            await expect(state.prepare(reader, database, randomUUID())).rejects.toBeInstanceOf(LegacyChatTerminated);
            expect(reader.signal.aborted).toBe(true);
          } finally { reader.dispose(); }
        }
      } finally { client.release(); }
    });
  }, 15_000);

  it("charges the last history-tool query ACK against the original finite login horizon", async () => {
    await withSavedMemoryFixture(async f => {
      const state = await setup(f), reader = await state.owner(), client = await f.pool.connect();
      let checks = 0, positiveFinalRow = false, expiredBeforeAck = false;
      try {
        await client.query("BEGIN");
        await expect(reader.withClient(client, async held => {
          const runID = randomUUID(), frame = await state.prepare(reader, held, runID);
          await state.execute(reader, held, runID, frame);
          const tool = createConversationHistoryTools(frame.snapshot!).tools[0]!;
          const signal = new AbortController().signal;
          await tool.execute({ operation: "page" }, signal);
          const query = client.query;
          client.query = new Proxy(query, { apply(target, receiver, args: unknown[]) {
            if (typeof args[0] !== "string" || !args[0].includes("captured_history_owner AS MATERIALIZED") || ++checks !== 2)
              return Reflect.apply(target, receiver, args);
            return (async () => {
              // Shorten only the actual login before dispatching the last SQL.
              // This returns the genuine command result after the observed clock.
              const shortened = await f.pool.query(`UPDATE sessions SET expires_at=LEAST(expires_at,clock_timestamp()+interval '500 milliseconds')
                WHERE account_id=$1 AND user_id=$2 AND id=$3 RETURNING expires_at`, [f.auth.accountId,f.auth.userId,f.auth.sessionId]);
              expect(shortened.rowCount).toBe(1);
              const result = await Reflect.apply(target, receiver, args) as { rows: { available: boolean }[] };
              positiveFinalRow = result.rows.length === 1 && result.rows[0]?.available === true;
              await delay(650);
              const current = await f.pool.query("SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE id=$1", [f.auth.sessionId]);
              expiredBeforeAck = current.rows[0]?.expired === true;
              return result;
            })();
          } });
          try { await tool.execute({ operation: "page" }, signal); }
          finally { client.query = query; }
        })).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(checks).toBe(2); expect(positiveFinalRow).toBe(true); expect(expiredBeforeAck).toBe(true);
        expect(reader.signal.aborted).toBe(true);
      } finally { try { await client.query("ROLLBACK"); } finally { client.release(); reader.dispose(); } }
    });
  }, 15_000);
});
