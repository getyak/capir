/** Actual SDK-branch HTTP history capture; only the remote model is synthetic.
 * Negative metadata loss follows a genuine normal V2 publication. No successful
 * grant, auth result, Session save or DB response is fabricated. */
import { randomBytes, randomUUID } from "node:crypto";
import { ScriptedAgentProvider } from "@talent-signal/agent";
import type { SessionResponse, UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { readAgentSessionConversation } from "./agentSessions.js";
import { assertDenied } from "./fixtures/savedMemoryRuntime.fixture.js";
import { independentReply, savedMemoryDatabase, withSavedMemoryFixture } from "./fixtures/savedMemoryDiscovery.fixture.js";

if (process.env.GET_455_CAPTURED_HISTORY_TEST_REQUIRED === "1" && !savedMemoryDatabase)
  throw new Error("Captured history verification requires the explicit disposable loopback database.");

type Page = { entries: Array<{ message_id: string; role: string; text: string }> };
function page(output: unknown): Page {
  if (!output || typeof output !== "object" || !("content" in output) || !Array.isArray(output.content))
    throw new Error("The actual history tool did not return its text envelope.");
  const block = output.content.find(value => value?.type === "text" && typeof value.text === "string");
  if (!block) throw new Error("The actual history tool omitted its text result.");
  const result = JSON.parse(block.text) as Page;
  expect(Array.isArray(result.entries)).toBe(true);
  return result;
}

// Both cases keep all original Runtime15/Discovery6 cases and budgets unchanged.
describe.skipIf(!savedMemoryDatabase)("captured Memory history through the actual SDK HTTP entry", () => {
  it.each(["dependency", "lineage"] as const)(
    "terminates the real owner after captured %s loss, even if the synthetic model swallows the tool error",
    async loss => withSavedMemoryFixture(async f => {
      // This original fixture has only its real password login, no existing
      // persistent enrollment. The sole normal enrollment below owns its secret.
      const control = new Pool({ connectionString: savedMemoryDatabase, max: 1,
        connectionTimeoutMillis: 2_000, statement_timeout: 5_000, query_timeout: 6_000 });
      try {
      const human = "Preserve my original synthetic historical notebook request.";
      const neutral = await f.post({ idempotency_key: randomUUID(), objective: "Give an independent synthetic greeting." });
      expect(neutral.statusCode).toBe(201);
      const independent = neutral.json<UnscopedChatTaskResponse>();
      expect(independent.blocks[0]?.body).toBe(independentReply);
      const statement = "My synthetic captured-history notebook is violet.";
      const memory = await f.acceptSelf(statement);
      f.provider.mode = "recall"; f.provider.selectedMemoryID = memory.itemID;
      const completed = await f.post({ idempotency_key: randomUUID(), objective: human });
      expect(completed.statusCode).toBe(201);
      const dependent = completed.json<UnscopedChatTaskResponse>();
      expect(dependent.blocks[0]?.body).toBe(statement);
      const registered = (await control.query<{ format_version: number; dependency_count: number; required: boolean }>(`
        SELECT l.format_version,l.dependency_count,i.saved_memory_lineage_required AS required
        FROM agent_task_memory_lineage l JOIN idempotency_records i ON i.id=l.completion_idempotency_id
        WHERE l.account_id=$1 AND l.reader_actor_id=$2 AND l.task_id=$3 AND i.status='completed' AND i.response_status=201`,
      [f.auth.accountId, f.auth.userId, dependent.task_id])).rows;
      expect(registered).toEqual([{ format_version: 2, dependency_count: 1, required: true }]);
      const sessionID = randomUUID();
      const first = await f.saveAnswer(sessionID, "Preserve my independent original greeting.", independent);
      const saved = await f.saveAnswer(sessionID, human, dependent, {
        expectedRevision: first.revision, priorTurns: first.payload!.turns,
      });
      const initial = await readAgentSessionConversation(f.pool, f.auth, sessionID,
        { personId: null, relationshipContextId: null }, { complete: true });
      expect(initial.messages.some(message => message.role === "assistant" && message.text === statement)).toBe(true);
      const tuple = async () => (await control.query(`SELECT m.id::text,m.version,m.owner_user_id::text,m.scope,
        m.subject_id::text,m.relationship_context_id::text,l.epoch::text FROM memory_items m
        JOIN memory_item_lineage l ON l.account_id=m.account_id AND l.memory_item_id=m.id
        WHERE m.account_id=$1 AND m.owner_user_id=$2 AND m.id=$3`,
      [f.auth.accountId, f.auth.userId, memory.itemID])).rows;
      const originalTuple = await tuple(); expect(originalTuple).toHaveLength(1);
      const witness = async () => (await control.query<{ stamp: string; generation: string; live: boolean }>(`
        SELECT md5(jsonb_build_array(s.payload->'turns',s.payload->'personID',s.payload->'relationshipContextID')::text) AS stamp,
          COALESCE(g.generation,0)::text AS generation,a.revoked_at IS NULL AND a.expires_at>clock_timestamp() AS live
        FROM agent_sessions s JOIN sessions a ON a.account_id=s.account_id AND a.user_id=s.created_by_user_id AND a.id=$3
        LEFT JOIN harness_source_generations g ON g.account_id=s.account_id
        WHERE s.account_id=$1 AND s.id=$2`, [f.auth.accountId, sessionID, f.auth.sessionId])).rows[0];
      const enrollment = await f.request({ method: "POST", url: "/v1/auth/persistent/enroll",
        payload: { renewal_secret: randomBytes(32).toString("base64url"), client_kind: "web" } });
      expect(enrollment.statusCode).toBe(200);
      const login = enrollment.json<SessionResponse>(); // Used only for normal HTTP authentication; never logged.
      expect(login.session_id === f.auth.sessionId && login.account.id === f.auth.accountId
        && login.user.id === f.auth.userId).toBe(true);
      let phase: "stale" | "fresh" = "stale", calls = 0, fallbackCalls = 0;
      let firstToolRead = false, metadataRemoved = false, staleToolRejected = false, staleTextReturned = false;
      const provider = Object.assign(new ScriptedAgentProvider([], {
        outcome: "reply", title: "Synthetic captured history", body: independentReply,
      }), { providerId: "claude-agent-sdk" as const, supportsImageInput: false,
        answer: async () => { fallbackCalls++; throw new Error("The synthetic SDK must not enter answer fallback."); } });
      const originalRun = provider.run.bind(provider);
      provider.run = async (...args: Parameters<typeof originalRun>) => {
        calls++;
        const [input, , signal] = args;
        const tool = input.supplementalTools?.find(candidate => candidate.name === "read_session_history");
        if (!tool) throw new Error("The real SDK entry did not construct its complete history tool.");
        if (phase === "fresh") {
          const current = page(await tool.execute({ operation: "page" }, signal));
          expect(current.entries).toContainEqual(expect.objectContaining({ role: "user", text: human }));
          expect(current.entries).toContainEqual(expect.objectContaining({ role: "assistant", text: independentReply }));
          expect(current.entries.some(message => message.role === "assistant" && message.text === statement)).toBe(false);
        } else {
          const captured = page(await tool.execute({ operation: "page" }, signal));
          expect(captured.entries).toContainEqual(expect.objectContaining({ role: "assistant", text: statement }));
          expect(captured.entries).toContainEqual(expect.objectContaining({ role: "user", text: human }));
          expect(captured.entries).toContainEqual(expect.objectContaining({ role: "assistant", text: independentReply }));
          firstToolRead = true;
          const before = await witness(); expect(before?.live).toBe(true);
          // Only loss is injected, after the genuine HTTP/Memory/Session producer.
          // The original Memory item and its epoch remain unchanged and readable.
          if (loss === "dependency") {
            const removed = await control.query("DELETE FROM agent_task_saved_memory_dependencies WHERE account_id=$1 AND task_id=$2 AND memory_item_id=$3 RETURNING memory_item_id",
              [f.auth.accountId, dependent.task_id, memory.itemID]);
            expect(removed.rowCount).toBe(1);
          } else {
            // The real child FKs do not cascade. Remove only this actual task's
            // routing/dependency metadata before its parent, on one owned client.
            const lossClient = await control.connect();
            try {
              await lossClient.query("BEGIN");
              const dependencies = await lossClient.query("DELETE FROM agent_task_saved_memory_dependencies WHERE account_id=$1 AND task_id=$2 RETURNING memory_item_id",
                [f.auth.accountId, dependent.task_id]);
              expect(dependencies.rowCount).toBe(1);
              await lossClient.query("DELETE FROM agent_task_memory_session_copies WHERE account_id=$1 AND task_id=$2",
                [f.auth.accountId, dependent.task_id]);
              const removed = await lossClient.query("DELETE FROM agent_task_memory_lineage WHERE account_id=$1 AND task_id=$2 RETURNING task_id",
                [f.auth.accountId, dependent.task_id]);
              expect(removed.rowCount).toBe(1);
              await lossClient.query("COMMIT");
            } catch (error) { await lossClient.query("ROLLBACK"); throw error; }
            finally { lossClient.release(); }
          }
          metadataRemoved = true;
          const marker = (await control.query<{ required: boolean }>(`SELECT saved_memory_lineage_required AS required
            FROM idempotency_records WHERE account_id=$1 AND actor_user_id=$2 AND response_body->>'task_id'=$3
              AND operation_scope='create_unscoped_chat_task' AND status='completed' AND response_status=201`,
          [f.auth.accountId, f.auth.userId, dependent.task_id])).rows;
          expect(marker).toEqual([{ required: true }]);
          expect(await witness()).toEqual(before);
          expect(await tuple()).toEqual(originalTuple);
          expect(await f.current()).toBe(200);
          try {
            const stale = page(await tool.execute({ operation: "page" }, signal));
            staleTextReturned = stale.entries.some(message => message.role === "assistant" && message.text === statement);
          } catch { staleToolRejected = true; }
          // Deliberately swallow the tool error: only the actual owner can prevent
          // this neutral provider answer becoming a successful publication.
        }
        return originalRun(...args);
      };
      let sdk: Awaited<ReturnType<typeof buildApp>> | undefined;
      try {
        sdk = await buildApp({ pool: f.pool, config: { databaseUrl: savedMemoryDatabase!, host: "127.0.0.1", port: 0,
          allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false,
          passwordAuthEnabled: true, passwordRegistrationEnabled: false, simulatedAuthEnabled: false,
          internalLabEnabled: false, retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 },
        remoteChatProvider: provider, personResearchProvider: null, privateConversationProvider: null,
        labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
        labCIVerifier: null, screenshotContact: null });
        await sdk.ready();
        const key = randomUUID();
        const rejected = await sdk.inject({ method: "POST", url: "/v1/chat/unscoped-tasks",
          headers: { authorization: `Bearer ${login.access_token}` }, payload: {
            idempotency_key: key, objective: "Read my prior synthetic dialogue through its history tool.",
            session_id: sessionID, message_id: randomUUID(),
          } });
        expect(firstToolRead).toBe(true); expect(metadataRemoved).toBe(true);
        expect(staleTextReturned).toBe(false); expect(staleToolRejected).toBe(true);
        assertDenied(rejected, statement);
        expect(calls).toBe(1); expect(fallbackCalls).toBe(0);
        const publication = (await control.query<{ completed: string }>(`SELECT count(*)::text AS completed
          FROM idempotency_records WHERE account_id=$1 AND actor_user_id=$2 AND operation_scope='create_unscoped_chat_task'
            AND idempotency_key=$3 AND status='completed' AND response_status BETWEEN 200 AND 299`,
        [f.auth.accountId, f.auth.userId, key])).rows[0];
        expect(publication).toEqual({ completed: "0" });
        const current = await readAgentSessionConversation(f.pool, f.auth, sessionID,
          { personId: null, relationshipContextId: null }, { complete: true });
        expect(current.messages).toContainEqual({ message_id: saved.payload!.turns[1]!.id, role: "user", text: human });
        expect(current.messages.some(message => message.role === "assistant" && message.text === independentReply)).toBe(true);
        expect(current.messages.some(message => message.role === "assistant" && message.text === statement)).toBe(false);
        phase = "fresh";
        const fresh = await sdk.inject({ method: "POST", url: "/v1/chat/unscoped-tasks",
          headers: { authorization: `Bearer ${login.access_token}` }, payload: {
            idempotency_key: randomUUID(), objective: "Read only my currently available synthetic history.",
            session_id: sessionID, message_id: randomUUID(),
          } });
        expect(fresh.statusCode).toBe(201);
        expect(fresh.json<UnscopedChatTaskResponse>().blocks[0]?.body).toBe(independentReply);
        expect(calls).toBe(2); expect(fallbackCalls).toBe(0); expect(await f.current()).toBe(200);
      } finally { await sdk?.close(); }
      } finally { await control.end(); }
    }), 15_000,
  );
});
