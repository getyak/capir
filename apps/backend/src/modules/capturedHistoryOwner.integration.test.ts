import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createConversationHistoryTools, ScriptedAgentProvider } from "@talent-signal/agent";
import type { SessionResponse, UnscopedChatTaskResponse } from "@talent-signal/contracts";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import type { DatabaseClient } from "../database/pool.js";
import { admitLegacyChatAuthority, bindLegacyCapturedHistoryRun, prepareLegacyCapturedHistory,
  LegacyChatTerminated, type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { inSavedMemoryCanonicalTransaction } from "./savedMemoryCanonicalTransaction.js";
import { createHarnessSourceGuardWithBinding } from "./harnessSourceGuard.js";
import { registerSavedMemoryLineage, type SavedMemoryReadProof } from "./savedMemoryLineage.js";
import { sealWorkspaceSavedMemoryRun, consumeWorkspaceSavedMemoryCompletion } from "./workspaceSavedMemoryRun.js";
import { recordSessionChatSources } from "./agentSessionSources.js";
import { createScreenshotContactTask, loadScreenshotContactTask, ScreenshotContactTaskRunner } from "./screenshotContactTasks.js";
import { createLegacyUnscopedChatTask, createUnscopedChatTask } from "./unscopedChat.js";
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
  const saved = await f.saveAnswer(sessionID, objective, response);
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
  return { owner, prepare, execute, sessionID, messageID, response, saved };
}

function withBorrow<T>(f: SavedMemoryFixture, owner: LegacyChatAuthority, operation: (client: PoolClient) => Promise<T>) {
  return inSavedMemoryCanonicalTransaction(f.pool, owner, operation, () => false);
}

describe.skipIf(!savedMemoryDatabase)("original captured history owner on real PostgreSQL", () => {
  it("rejects a same-text canonical body change even while the actual empty V2 remains current", async () => {
    await withSavedMemoryFixture(async f => {
      const state = await setup(f), reader = await state.owner(), runID = randomUUID();
      try {
        const frame = await state.prepare(reader, f.pool, runID);
        await state.execute(reader, f.pool, runID, frame);
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
      const state = await setup(f), reader = await state.owner();
      try {
        await withBorrow(f, reader, async client => {
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
          } finally { client.query = query; }
        });
      } finally { reader.dispose(); }
    });
  }, 15_000);

  it("refuses a foreign frame before touching the recipient, and refuses the original guarded lease after return", async () => {
    await withSavedMemoryFixture(async f => {
      const state = await setup(f), a = await state.owner(), b = await state.owner();
      try {
        const runID = randomUUID();
        const captured = await withBorrow(f, a, client => a.withClient(client, async held => {
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
        }));
        await expect(withBorrow(f, a, client => a.withClient(client, async () => captured.snapshot!.assertCurrent()))).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(a.signal.aborted).toBe(true); await b.assertCurrent();
      } finally { a.dispose(); b.dispose(); }
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
      const state = await setup(f), reader = await state.owner();
      let checks = 0, positiveFinalRow = false, expiredBeforeAck = false;
      try {
        await expect(withBorrow(f, reader, client => reader.withClient(client, async held => {
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
        }))).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(checks).toBe(2); expect(positiveFinalRow).toBe(true); expect(expiredBeforeAck).toBe(true);
        expect(reader.signal.aborted).toBe(true);
      } finally { reader.dispose(); }
    });
  }, 15_000);

  it("refuses capture exposure before Core and refuses a forged same-owner clock on a genuine borrow", async () => {
    await withSavedMemoryFixture(async f => {
      const state = await setup(f);
      for (const attempt of ["inventory", "page", "clock"] as const) {
        const owner = await state.owner();
        let attempted = false;
        try {
          await expect(withBorrow(f, owner, client => owner.withClient(client, async held => {
            const runID = randomUUID(), frame = await state.prepare(owner, held, runID);
            expect(frame.snapshot).toBeDefined();
            if (attempt === "clock") {
              attempted = true;
              bindLegacyCapturedHistoryRun(owner, frame.handle, { runID, runDeadlineMonotonicMs: Number.MAX_SAFE_INTEGER,
                sessionID: state.sessionID, messageID: state.messageID, workspaceID: f.auth.accountId,
                sessionHistory: frame.snapshot, conversationHistory: frame.conversationHistory });
            } else if (attempt === "inventory") {
              attempted = true;
              createConversationHistoryTools(frame.snapshot!);
            } else {
              // A backend caller already has the original private projection.
              // Even if it assembles a real tool without the inventory getter,
              // the original snapshot guard must refuse its actual execute call.
              const tool = createConversationHistoryTools({ version: frame.snapshot!.version,
                messages: frame.complete!.messages, assertCurrent: frame.snapshot!.assertCurrent }).tools[0]!;
              attempted = true;
              await tool.execute({ operation: "page" }, new AbortController().signal);
            }
          }))).rejects.toBeInstanceOf(LegacyChatTerminated);
          expect(attempted).toBe(true);
          expect(owner.signal.aborted).toBe(true);
        } finally { owner.dispose(); }
      }
    });
  }, 15_000);

  it("rejects foreign finalization and nested or forwarded borrows while both genuine owners stay usable", async () => {
    await withSavedMemoryFixture(async f => {
      const state = await setup(f), a = await state.owner(), b = await state.owner();
      try {
        await withBorrow(f, a, raw => a.withClient(raw, async held => {
          const aID = randomUUID(), frameA = await state.prepare(a, held, aID);
          for (const forwarded of [raw, held, { query: held.query.bind(held) } as PoolClient]) {
            await expect(b.withClient(forwarded, ch => state.prepare(b, ch, randomUUID()))).rejects.toBeInstanceOf(LegacyChatTerminated);
          }
          let borrowed = false;
          const forwardedPool = new Proxy(f.pool, { get(target, key) {
            if (key === "connect") return async () => { borrowed = true; return raw; };
            return Reflect.get(target, key);
          } });
          await expect(inSavedMemoryCanonicalTransaction(forwardedPool, b,
            client => b.withClient(client, ch => state.prepare(b, ch, randomUUID())), () => false)).rejects.toBeInstanceOf(LegacyChatTerminated);
          expect(borrowed).toBe(false);
          const bID = randomUUID(), frameB = await state.prepare(b, f.pool, bID);
          for (const finalize of [b.assertFinalCurrent, b.lockAccountsForFinalization, b.lockReadersForFinalization]) {
            await expect(finalize(held)).rejects.toBeInstanceOf(LegacyChatTerminated);
          }
          await state.execute(b, f.pool, bID, frameB);
          await state.execute(a, held, aID, frameA);
          for (const frame of [frameA, frameB]) {
            const page = await createConversationHistoryTools(frame.snapshot!).tools[0]!.execute({ operation: "page" }, new AbortController().signal);
            expect(JSON.stringify(page)).toContain(independentReply);
          }
          expect(a.signal.aborted || b.signal.aborted).toBe(false);
        }));
      } finally { a.dispose(); b.dispose(); }
    });
  }, 15_000);

  it("delivers two overlapping real history pages while one source observation is outstanding", async () => {
    await withSavedMemoryFixture(async f => {
      const state = await setup(f), owner = await state.owner();
      try {
        await withBorrow(f, owner, client => owner.withClient(client, async held => {
          const runID = randomUUID(), frame = await state.prepare(owner, held, runID);
          await state.execute(owner, held, runID, frame);
          const tool = createConversationHistoryTools(frame.snapshot!).tools[0]!, signal = new AbortController().signal;
          let entered!: () => void, release!: () => void;
          const started = new Promise<void>(resolve => { entered = resolve; });
          const barrier = new Promise<void>(resolve => { release = resolve; });
          const query = client.query;
          let sourceReads = 0;
          client.query = new Proxy(query, { apply(target, receiver, args: unknown[]) {
            const actual = Reflect.apply(target, receiver, args);
            if (typeof args[0] !== "string" || !args[0].includes("AS session_stamp") || ++sourceReads !== 1) return actual;
            return Promise.resolve(actual).then(async row => { entered(); await barrier; return row; });
          } });
          try {
            const first = tool.execute({ operation: "page" }, signal);
            await Promise.race([started, first.then(() => { throw Error("The real source barrier was never reached."); })]);
            const second = tool.execute({ operation: "page" }, signal);
            const both = Promise.all([first, second]);
            try { await Promise.race([both, delay(50)]); } finally { release(); }
            for (const page of await both) expect(JSON.stringify(page)).toContain(independentReply);
            expect(sourceReads).toBeGreaterThan(1);
            expect(owner.signal.aborted).toBe(false);
          } finally { release(); client.query = query; }
        }));
      } finally { owner.dispose(); }
    });
  }, 15_000);

  it("charges a held positive history ACK to a human-only turn's real inherited screenshot expiry", async () => {
    await withSavedMemoryFixture(async f => {
      const state = await setup(f), reader = await state.owner();
      try {
        const created = await createScreenshotContactTask(f.pool, f.auth, { idempotency_key: randomUUID(),
          objective: "Read this weather note.", text: "Weather overview", captured_at: new Date().toISOString(),
          source: { kind: "selected_text", title: "Weather", url: "" }, allow_public_research: false });
        const shotID = created.body.task_id;
        await new ScreenshotContactTaskRunner(f.pool, { research: null, model: {
          async extract() { throw Error("Unexpected OCR prepass."); }, async next() { throw Error("Unexpected model loop."); },
          async run(input, signal) {
            await input.recordUnderstanding([{ platform: "Web", conversation_kind: "not_chat", contact_name: null,
              identity_clues: [], messages: [], uncertainties: [] }], signal);
            return { providerRequestID: randomUUID(), model: "synthetic-sdk", inputTokens: 1, outputTokens: 1 };
          },
        } }).start(f.auth, shotID);
        const shot = await loadScreenshotContactTask(f.pool, f.auth, shotID);
        expect(shot.status).toBe("completed");
        const originID = randomUUID(), original = state.saved.payload!;
        const first = original.turns[0]!;
        const origin = await f.request({ method: "PUT", url: `/v1/agent-sessions/${originID}`, payload: {
          expected_revision: 0, idempotency_key: randomUUID(),
          payload: { ...original, id: originID, screenshotTaskIDs: [shotID], turns: [{ ...first, id: randomUUID(),
            objective: "Read this weather note.", response: { ...first.response, taskID: shotID, disposition: "screenshot_processing",
              contextManifestID: "none-screenshot", knowledgeSnapshotID: "none-screenshot", unboundConversationBlocks: [] } }] },
        } });
        expect(origin.statusCode).toBe(200);
        const human = "What did the weather note say?";
        const derived = await createUnscopedChatTask(f.pool, f.auth, { idempotency_key: randomUUID(),
          session_id: originID, objective: human }, f.provider);
        expect(derived.body.blocks[0]?.body).toBe(independentReply);
        const id = derived.body.task_id;
        const inherited = await f.pool.query("SELECT screenshot_task_id FROM agent_session_chat_sources WHERE account_id=$1 AND task_id=$2",
          [f.auth.accountId, id]);
        expect(inherited.rows).toEqual([{ screenshot_task_id: shotID }]);
        await f.saveAnswer(state.sessionID, human, derived.body, { expectedRevision: state.saved.revision, priorTurns: original.turns });
        const loss = await f.pool.query(`UPDATE idempotency_records SET response_body=jsonb_set(response_body,'{blocks}','[]'::jsonb)
          WHERE account_id=$1 AND actor_user_id=$2 AND operation_scope='create_unscoped_chat_task' AND response_body->>'task_id'=$3`,
        [f.auth.accountId, f.auth.userId, id]);
        expect(loss.rowCount).toBe(1);
        // This real mutation can advance the source generation. Perform it
        // before capturing the Session, and never edit it after capture.
        const horizon = await f.pool.query(`UPDATE screenshot_contact_tasks SET expires_at=clock_timestamp()+interval '8 seconds'
          WHERE account_id=$1 AND id=$2 RETURNING to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deadline`,
        [f.auth.accountId, shotID]);
        expect(horizon.rowCount).toBe(1);
        const deadline: string = horizon.rows[0].deadline;
        let finalPositive = false, expiredDuringAck = false, finalChecks = 0;
        await expect(withBorrow(f, reader, client => reader.withClient(client, async held => {
          const runID = randomUUID(), frame = await state.prepare(reader, held, runID);
          await state.execute(reader, held, runID, frame);
          expect(frame.complete?.messages.some(m => m.role === "user" && m.text === human)).toBe(true);
          expect(frame.complete?.messages.some(m => m.message_id === id && m.role === "assistant")).toBe(false);
          expect(frame.complete?.sources?.length ?? 0).toBe(0);
          const tool = createConversationHistoryTools(frame.snapshot!).tools[0]!;
          const query = client.query;
          client.query = new Proxy(query, { apply(target, receiver, args: unknown[]) {
            const actual = Reflect.apply(target, receiver, args);
            if (typeof args[0] !== "string" || !args[0].includes("captured_history_owner AS MATERIALIZED") || ++finalChecks !== 2) return actual;
            return Promise.resolve(actual).then(async result => {
              const row = (result as { rows: { available: boolean; read_until: string }[] }).rows[0];
              finalPositive = row?.available === true && row.read_until === deadline;
              const remaining = await f.pool.query("SELECT extract(epoch FROM ($1::timestamptz-clock_timestamp()))*1000 AS ms", [deadline]);
              await delay(Math.max(0, Number(remaining.rows[0].ms)) + 80);
              const status = await f.pool.query("SELECT NOT agent_session_chat_sources_available($1,$2) AS expired", [f.auth.accountId,id]);
              expiredDuringAck = status.rows[0].expired === true;
              return result;
            });
          } });
          try { await tool.execute({ operation: "page" }, new AbortController().signal); }
          finally { client.query = query; }
        }))).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(finalPositive && expiredDuringAck && reader.signal.aborted).toBe(true);
      } finally { reader.dispose(); }
    });
  }, 30_000);

  it("serializes real absent-slot insertions while the final writer's positive result awaits COMMIT", async () => {
    await withSavedMemoryFixture(async f => {
      const state = await setup(f), producer = await state.owner(), reader = await state.owner(), other = await state.owner();
      const contender = await f.pool.connect();
      try {
        const objective = "Remember this synthetic untracked response.";
        let finite: Readonly<SavedMemoryReadProof> | undefined;
        // Generate the original response and its finite proof in the same actual
        // Core Run. The normal trusted chat writer preserves the legacy untracked
        // canonical body. The competing registration below uses that exact proof.
        const old = await createUnscopedChatTask(f.pool, f.auth, { objective, idempotency_key: randomUUID() }, {
          providerId: "zhipu-chat-completions", model: "synthetic-core", supportsImageInput: false,
          async answer(request) {
            const taskID = request.observation!.run_id;
            const expiresAt = new Date(producer.snapshotOriginal().originalDeadline);
            const source = await createHarnessSourceGuardWithBinding(f.pool, f.auth, undefined, () => ({ expiresAt, personIDs: [] }));
            const admission = { pool: f.pool, auth: f.auth, owner: producer, taskID, ...source };
            const result = await executeWorkspaceConversationAgent({ database: f.pool, auth: f.auth, objective, runID: taskID,
              provider: new ScriptedAgentProvider([], { outcome: "reply", title: "Synthetic reply", body: independentReply }),
              savedMemoryAdmission: admission });
            const handle = await sealWorkspaceSavedMemoryRun(admission, taskID, taskID);
            finite = consumeWorkspaceSavedMemoryCompletion(handle, producer, f.auth, taskID, taskID);
            return { kind: "answer", title: result.block.title, body: result.block.body, citation_ids: [],
              provider_id: "zhipu-chat-completions", model: "synthetic-core", provider_request_id: null,
              input_tokens: result.providerResult.inputTokens ?? 0, output_tokens: result.providerResult.outputTokens ?? 0,
              usage_reported: result.providerResult.inputTokens !== null && result.providerResult.outputTokens !== null };
          },
        });
        expect(old.status).toBe(201);
        const taskID = old.body.task_id, proof = finite!;
        expect(proof.task_id).toBe(taskID);
        const slots = async (db: DatabaseClient) => (await db.query(`SELECT
          EXISTS(SELECT 1 FROM agent_task_memory_lineage WHERE account_id=$1 AND task_id=$2::uuid) AS lineage,
          EXISTS(SELECT 1 FROM agent_session_chat_tasks WHERE account_id=$1 AND task_id=$2::uuid::text) AS retention`,
        [f.auth.accountId, taskID])).rows[0];
        expect(await slots(contender)).toEqual({ lineage: false, retention: false });
        await f.saveAnswer(state.sessionID, objective, old.body, { expectedRevision: state.saved.revision, priorTurns: state.saved.payload!.turns });
        const competingLineage = () => registerSavedMemoryLineage(contender, { auth: f.auth, taskID,
          expiresAt: proof.expires_at, assertCurrent: producer.assertCurrent }, proof);
        const competingRetention = () => recordSessionChatSources(contender, f.auth, state.sessionID, taskID, []);
        const otherID = randomUUID(), otherFrame = await state.prepare(other, f.pool, otherID);
        await state.execute(other, f.pool, otherID, otherFrame);
        let finalPositive = false, contested = false, readOriginal = false;
        const provider = Object.assign(new ScriptedAgentProvider([], { outcome: "reply", title: "Synthetic reply", body: independentReply }), {
          providerId: "claude-agent-sdk" as const, supportsImageInput: false,
          async answer(): Promise<never> { throw Error("Unexpected SDK fallback."); },
        });
        const run = provider.run.bind(provider);
        provider.run = async (...args: Parameters<typeof run>) => {
          const [request, , signal] = args;
          const tool = request.supplementalTools?.find(t => t.name === "read_session_history");
          if (!tool) throw Error("Missing real history tool.");
          const page = await tool.execute({ operation: "page" }, signal);
          const block = page.content.find(x => x.type === "text");
          if (block?.type === "text") {
            const data = JSON.parse(block.text) as { entries: { message_id: string; text: string }[] };
            readOriginal = data.entries.some(m => m.message_id === taskID && m.text === independentReply);
          }
          return run(...args);
        };
        const originals = new Map<PoolClient, PoolClient["query"]>();
        const observe = (client: PoolClient) => {
          if (originals.has(client)) return;
          const query = client.query; originals.set(client, query);
          let completed = false, checksAfterWrite = 0;
          client.query = new Proxy(query, { apply(target, receiver, args: unknown[]) {
            const actual = Reflect.apply(target, receiver, args);
            const sql = args[0];
            if (typeof sql !== "string") return actual;
            if (sql.includes("UPDATE idempotency_records") && sql.includes("SET status = 'completed'")) completed = true;
            if (!completed || !sql.includes("captured_history_owner AS MATERIALIZED") || ++checksAfterWrite !== 2) return actual;
            // This is the actual child's last fixed-domain SQL before classified
            // COMMIT. Hold its genuine positive ACK across both real insertions.
            return Promise.resolve(actual).then(async result => {
              finalPositive = (result as { rows: { available: boolean }[] }).rows[0]?.available === true;
              const attempted = { lineage: false, retention: false }, runQuery = contender.query;
              contender.query = new Proxy(runQuery, { apply(fn, target, args: unknown[]) {
                if (typeof args[0] === "string") {
                  if (args[0].includes("SELECT register_saved_memory_lineage")) attempted.lineage = true;
                  if (args[0].includes("INSERT INTO agent_session_chat_tasks")) attempted.retention = true;
                }
                return Reflect.apply(fn, target, args);
              } });
              try {
                await contender.query("BEGIN");
                try {
                  await contender.query("SET LOCAL lock_timeout='150ms'");
                  await expect(competingLineage()).rejects.toMatchObject({ code: "55P03" });
                } finally { await contender.query("ROLLBACK"); }
                await contender.query("BEGIN");
                try {
                  await expect(competingRetention()).rejects.toMatchObject({ code: "AGENT_SESSION_CONTEXT_UNAVAILABLE" });
                } finally { await contender.query("ROLLBACK"); }
                expect(await slots(contender)).toEqual({ lineage: false, retention: false });
                contested = attempted.lineage && attempted.retention && !reader.signal.aborted;
              } finally { contender.query = runQuery; }
              return result;
            });
          } });
        };
        f.pool.on("acquire", observe);
        const key = randomUUID();
        try {
          const child = await createLegacyUnscopedChatTask(reader, f.pool, f.auth, { idempotency_key: key, session_id: state.sessionID,
            message_id: randomUUID(), objective: "Read my synthetic untracked response." }, provider);
          expect(child.status).toBe(201);
          const stored = await contender.query(`SELECT response_body->>'task_id' AS task FROM idempotency_records
            WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3 AND operation_scope='create_unscoped_chat_task'
              AND status='completed' AND response_status=201`, [f.auth.accountId, f.auth.userId, key]);
          expect(stored.rows).toEqual([{ task: child.body.task_id }]);
        } finally {
          f.pool.off("acquire", observe);
          for (const [client, query] of originals) client.query = query;
        }
        expect(readOriginal && finalPositive && contested).toBe(true);
        // Both real mutations now succeed using the same data. The other
        // still-open reader holding the earlier capture cannot publish with it.
        await contender.query("BEGIN");
        try { await competingLineage(); await competingRetention(); await contender.query("COMMIT"); }
        catch (error) { await contender.query("ROLLBACK"); throw error; }
        expect(await slots(contender)).toEqual({ lineage: true, retention: true });
        await expect(inSavedMemoryCanonicalTransaction(f.pool, other, client => other.withClient(client, async held => {
          await other.lockAccountsForFinalization(held);
          await other.lockReadersForFinalization(held);
          await other.assertFinalCurrent(held);
          return taskID;
        }), result => result === taskID)).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(other.signal.aborted).toBe(true);
      } finally { contender.release(); reader.dispose(); producer.dispose(); other.dispose(); }
    });
  }, 30_000);

});
