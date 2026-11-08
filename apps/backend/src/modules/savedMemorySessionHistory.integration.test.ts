/** Source cases for actual PostgreSQL/HTTP data receipts. No model exposure or
 * Session atomic HTTP activation is provided by this prepared reader. */
import { randomBytes, randomUUID } from "node:crypto";
import type { SessionResponse, UnscopedChatTaskResponse } from "@talent-signal/contracts";
import type { DatabaseClient } from "../database/pool.js";
import type { BackendConfig } from "../config.js";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "./auth.js";
import { admitLegacyChatAuthority } from "./legacyChatAuthority.js";
import { createHarnessSourceGuardWithBinding, readHarnessRunSourceBinding } from "./harnessSourceGuard.js";
import { readAgentSessionConversation } from "./agentSessions.js";
import { boundedConversationHistory } from "./chatAnswerProvider.js";
import { readSavedMemoryRetainedLineage } from "./savedMemoryDurableLineage.js";
import { consumeSessionHistoryReceipt, isForeignSessionHistoryReceiptError,
  readSavedMemorySessionHistory } from "./savedMemorySessionHistory.js";
import { savedMemoryDatabase, withSavedMemoryFixture, type SavedMemoryFixture } from "./fixtures/savedMemoryDiscovery.fixture.js";

if (process.env.GET_455_SESSION_HISTORY_READER_TEST_REQUIRED === "1" && !savedMemoryDatabase)
  throw new Error("The Session history reader gate requires its explicit disposable loopback PostgreSQL fixture.");
const config = (): BackendConfig => ({ databaseUrl: savedMemoryDatabase!, host: "127.0.0.1", port: 0,
  allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false, passwordAuthEnabled: true,
  passwordRegistrationEnabled: false, simulatedAuthEnabled: false, internalLabEnabled: false,
  retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 });
async function withFrameFixture(operation: (f: Awaited<ReturnType<typeof prepare>>) => Promise<void>) {
  await withSavedMemoryFixture(async f => {
    const prepared = await prepare(f);
    try { await operation(prepared); } finally { prepared.owner.dispose(); }
  });
}
async function prepare(f: SavedMemoryFixture) {
  const statement = "My synthetic Session history notebook is copper.";
  const memory = await f.acceptSelf(statement);
  f.provider.mode = "recall"; f.provider.selectedMemoryID = memory.itemID;
  const objective = "Read my synthetic notebook.", answer = await f.post({ idempotency_key: randomUUID(), objective });
  expect(answer.statusCode).toBe(201);
  const body = answer.json<UnscopedChatTaskResponse>();
  expect(body.blocks[0]?.body).toBe(statement);
  const sessionID = randomUUID(), saved = await f.saveAnswer(sessionID, objective, body);
  const enrolled = await f.request({ method: "POST", url: "/v1/auth/persistent/enroll", payload: {
    renewal_secret: randomBytes(32).toString("base64url"), client_kind: "web" } });
  expect(enrolled.statusCode).toBe(200); // Never print the credential-bearing body.
  const login = enrolled.json<SessionResponse>();
  if (!login.session_id) throw new Error("Actual enrollment omitted its login identity.");
  const auth: AuthContext = { accountId: login.account.id, accountSlug: login.account.slug, userId: login.user.id,
    userEmail: login.user.email, userKind: login.user.kind, sessionId: login.session_id };
  const authorization = `Bearer ${login.access_token}`;
  const owner = await admitLegacyChatAuthority(f.pool, auth, authorization, config());
  const source = await createHarnessSourceGuardWithBinding(f.pool, auth, sessionID,
    () => ({ expiresAt: new Date(Date.now() + 60_000), personIDs: [] }));
  const input = { database: f.pool, owner, auth, sessionID, runID: randomUUID(), taskID: randomUUID(),
    source: source.source, guard: source.guard };
  return { f, statement, memory, body, saved, objective, owner, auth, authorization, input };
}

describe.skipIf(!savedMemoryDatabase)("actual stored Session inline history and private receipts", { concurrent: false }, () => {
  it("reads original canonical text/V2/source facts together and refuses clone/foreign/task handoffs", async () => {
    await withFrameFixture(async r => {
      const original = await readSavedMemoryRetainedLineage(r.f.pool, r.auth, r.body.task_id);
      const old = await readAgentSessionConversation(r.f.pool, r.auth, r.input.sessionID,
        { personId: null, relationshipContextId: null });
      const receipt = await readSavedMemorySessionHistory(r.input);
      const foreign = await admitLegacyChatAuthority(r.f.pool, r.auth, r.authorization, config());
      try {
        let touched = 0, error: unknown;
        const hooked = Object.defineProperty({ ...r.auth }, "accountId", { get() { touched++; return r.auth.accountId; } });
        try { consumeSessionHistoryReceipt(receipt, foreign, hooked, r.input.sessionID, r.input.runID, r.input.taskID); }
        catch (value) { error = value; }
        expect(isForeignSessionHistoryReceiptError(error)).toBe(true); expect(touched).toBe(0);
        expect(foreign.signal.aborted || r.owner.signal.aborted).toBe(false);
        expect(() => consumeSessionHistoryReceipt({ ...receipt } as typeof receipt, r.owner, r.auth,
          r.input.sessionID, r.input.runID, r.input.taskID)).toThrow();
        expect(() => consumeSessionHistoryReceipt(receipt, r.owner, r.auth,
          r.input.sessionID, r.input.runID, randomUUID())).toThrow();
        const facts = consumeSessionHistoryReceipt(receipt, r.owner, r.auth, r.input.sessionID, r.input.runID, r.input.taskID);
        expect(facts.messages).toEqual(boundedConversationHistory(old.messages));
        expect(facts.ancestors).toHaveLength(1); expect(facts.ancestors[0]?.proof).toEqual(original);
        expect(facts.source).toEqual(readHarnessRunSourceBinding(r.input.source, r.input.guard, r.auth));
        expect(facts.unavailableAssistantTaskIDs).toEqual([]);
        const metadata = (await r.f.pool.query<{ body_digest: string }>(
          "SELECT encode(sha256(convert_to(response_body::text,'UTF8')),'hex') AS body_digest FROM idempotency_records WHERE account_id=$1 AND id=$2",
          [r.auth.accountId, facts.ancestors[0]!.completionID])).rows;
        expect(metadata).toEqual([{ body_digest: facts.ancestors[0]!.bodyDigest }]);
        expect(Object.isFrozen(facts) && Object.isFrozen(facts.messages) && Object.isFrozen(facts.ancestors[0]?.proof)).toBe(true);
      } finally { foreign.dispose(); }
    });
  }, 15_000);

  it("matches the real last6-turn then inline12k/last12/current-message selection", async () => {
    await withFrameFixture(async r => {
      const template = r.saved.payload!.turns[0]!;
      const prior = Array.from({ length: 6 }, (_, n) => ({ ...template, id: randomUUID(), objective: `Synthetic human${n}:` + "x".repeat(3000) }));
      const sid = randomUUID();
      await r.f.saveAnswer(sid, "Synthetic final human:" + "z".repeat(3000), r.body, { priorTurns: prior });
      const source = await createHarnessSourceGuardWithBinding(r.f.pool, r.auth, sid,
        () => ({ expiresAt: new Date(Date.now() + 60_000), personIDs: [] }));
      const input = { ...r.input, sessionID: sid, source: source.source, guard: source.guard, currentMessageID: prior[5]!.id };
      const old = await readAgentSessionConversation(r.f.pool, r.auth, sid, { personId: null, relationshipContextId: null });
      const facts = consumeSessionHistoryReceipt(await readSavedMemorySessionHistory(input), r.owner, r.auth, sid, input.runID, input.taskID);
      expect(facts.messages).toEqual(boundedConversationHistory(old.messages, input.currentMessageID));
      expect(facts.messages.every(message => message.text.length <= 2000)).toBe(true);
      expect(facts.messages.reduce((n, message) => n + message.text.length, 0)).toBeLessThanOrEqual(12000);
      expect(facts.ancestors).toHaveLength(1); // Same actual canonical task copied, no manufactured successful result.
    });
  }, 15_000);

  it("suppresses withdrawn Memory assistant bytes immediately while preserving the real human message", async () => {
    await withFrameFixture(async r => {
      const removed = await r.f.request({ method: "POST", url: `/v1/memory/items/${r.memory.itemID}/mutations`, payload: {
        operation: "delete", expected_version: r.memory.version, idempotency_key: randomUUID(), reason: "Explicit synthetic history withdrawal." } });
      expect(removed.statusCode).toBe(200); expect(await r.f.current()).toBe(200);
      const source = await createHarnessSourceGuardWithBinding(r.f.pool, r.auth, r.input.sessionID,
        () => ({ expiresAt: new Date(Date.now() + 60_000), personIDs: [] }));
      const receipt = await readSavedMemorySessionHistory({ ...r.input, source: source.source, guard: source.guard });
      const facts = consumeSessionHistoryReceipt(receipt, r.owner, r.auth, r.input.sessionID, r.input.runID, r.input.taskID);
      expect(facts.messages).toEqual([{ message_id: r.saved.payload!.turns[0]!.id, role: "user", text: r.objective }]);
      expect(JSON.stringify(facts)).not.toContain(r.statement);
      expect(facts.ancestors).toEqual([]); expect(facts.unavailableAssistantTaskIDs).toEqual([r.body.task_id]);
    });
  }, 15_000);

  it("does not turn actual missing lineage behind a required canonical claim into an empty proof", async () => {
    await withFrameFixture(async r => {
      // Negative metadata loss only, after actual HTTP/Review created the real
      // completion. No accepted Memory, successful claim or lineage is inserted.
      await r.f.pool.query("DELETE FROM agent_task_memory_session_copies WHERE account_id=$1 AND task_id=$2", [r.auth.accountId, r.body.task_id]);
      await r.f.pool.query("DELETE FROM agent_task_saved_memory_dependencies WHERE account_id=$1 AND task_id=$2", [r.auth.accountId, r.body.task_id]);
      await r.f.pool.query("DELETE FROM agent_task_memory_lineage WHERE account_id=$1 AND task_id=$2", [r.auth.accountId, r.body.task_id]);
      const required = (await r.f.pool.query<{ required: boolean }>(
        "SELECT saved_memory_lineage_required AS required FROM idempotency_records WHERE account_id=$1 AND response_body->>'task_id'=$2",
        [r.auth.accountId, r.body.task_id])).rows;
      expect(required).toEqual([{ required: true }]);
      const source = await createHarnessSourceGuardWithBinding(r.f.pool, r.auth, r.input.sessionID,
        () => ({ expiresAt: new Date(Date.now() + 60_000), personIDs: [] }));
      const facts = consumeSessionHistoryReceipt(await readSavedMemorySessionHistory({ ...r.input, source: source.source, guard: source.guard }),
        r.owner, r.auth, r.input.sessionID, r.input.runID, r.input.taskID);
      expect(facts.messages.map(message => message.role)).toEqual(["user"]);
      expect(JSON.stringify(facts)).not.toContain(r.statement);
      expect(facts.ancestors).toEqual([]); expect(facts.unavailableAssistantTaskIDs).toEqual([r.body.task_id]);
    });
  }, 15_000);

  it("refuses body/guard observations from different actual Session generations", async () => {
    await withFrameFixture(async r => {
      const other = randomUUID(); await r.f.saveAnswer(other, r.objective, r.body);
      const wrong = await createHarnessSourceGuardWithBinding(r.f.pool, r.auth, other,
        () => ({ expiresAt: new Date(Date.now() + 60_000), personIDs: [] }));
      await expect(readSavedMemorySessionHistory({ ...r.input, source: wrong.source, guard: wrong.guard }))
        .rejects.toMatchObject({ code: "SAVED_MEMORY_SESSION_HISTORY_UNAVAILABLE" });
      const current = await createHarnessSourceGuardWithBinding(r.f.pool, r.auth, r.input.sessionID,
        () => ({ expiresAt: new Date(Date.now() + 60_000), personIDs: [] }));
      // Existing message text is immutable at the public Session API. Append
      // a real newly completed turn instead of fabricating a permitted edit.
      const objective = "Another actual synthetic question changes this Session's selected frame.";
      const appended = await r.f.post({ idempotency_key: randomUUID(), objective });
      expect(appended.statusCode).toBe(201);
      const changed = await r.f.saveAnswer(r.input.sessionID, objective, appended.json<UnscopedChatTaskResponse>(),
        { expectedRevision: r.saved.revision, priorTurns: r.saved.payload!.turns });
      expect(changed.revision).toBe(r.saved.revision + 1);
      expect(changed.payload!.turns).toHaveLength(r.saved.payload!.turns.length + 1);
      expect(changed.payload!.turns.at(-1)?.objective).toBe(objective);
      await expect(readSavedMemorySessionHistory({ ...r.input, source: current.source, guard: current.guard }))
        .rejects.toMatchObject({ code: "SAVED_MEMORY_SESSION_HISTORY_UNAVAILABLE" });
    });
  }, 15_000);

  it("refuses actual oversized stored canonical history before returning its text", async () => {
    await withFrameFixture(async r => {
      // Corrupt only a real completed result as a negative. This does not
      // manufacture an accepted item, a successful claim or an authority grant.
      const changed = await r.f.pool.query(`UPDATE idempotency_records SET response_body=
        jsonb_set(response_body,'{blocks,0,body}',to_jsonb(repeat('x',524289)))
        WHERE account_id=$1 AND actor_user_id=$2 AND response_body->>'task_id'=$3 AND status='completed'`,
      [r.auth.accountId, r.auth.userId, r.body.task_id]);
      expect(changed.rowCount).toBe(1); expect(await r.f.current()).toBe(200);
      const source = await createHarnessSourceGuardWithBinding(r.f.pool, r.auth, r.input.sessionID,
        () => ({ expiresAt: new Date(Date.now() + 60_000), personIDs: [] }));
      await expect(readSavedMemorySessionHistory({ ...r.input, database: r.f.pool as DatabaseClient,
        source: source.source, guard: source.guard })).rejects.toMatchObject({ statusCode: 413, code: "SAVED_MEMORY_BUDGET_LIMITED" });
    });
  }, 15_000);
});
