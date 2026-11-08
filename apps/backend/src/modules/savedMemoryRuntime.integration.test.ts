/** Tests-first actual synchronous C03 runtime boundary. No new production API
 * import: absence of a recorded tuple/tool is an assertion, not collection red.
 * Source-only until the explicit Hosted PostgreSQL selector executes it. */
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import { readAgentSessionConversation } from "./agentSessions.js";
import { assertDenied, independentReply, savedMemoryDatabase, withSavedMemoryRuntime,
  type RuntimeStamp } from "./fixtures/savedMemoryRuntime.fixture.js";

type Runtime = Parameters<Parameters<typeof withSavedMemoryRuntime>[0]>[0];
const body = (response: { json<T>(): T }) => response.json<UnscopedChatTaskResponse>();
function memoryToolItems(r: Runtime): Array<{ id: string; version: number; display_text: string }> {
  const result = r.tools().find(tool => tool.name === "memory_review" || tool.name === "search_saved_memory");
  expect(result?.ok).toBe(true);
  const items = (result?.data as { items?: Array<{ id: string; version: number; display_text: string }> } | undefined)?.items;
  expect(Array.isArray(items)).toBe(true);
  if (!Array.isArray(items)) throw new Error("The actual Memory tool did not return its bounded item page.");
  return items;
}

async function dependencies(r: Runtime, taskID: string): Promise<RuntimeStamp[]> {
  return (await r.control.query<RuntimeStamp>(`SELECT memory_item_id::text,item_version,lineage_epoch::text,
    memory_owner_id::text,scope,subject_id::text,relationship_context_id::text
    FROM agent_task_saved_memory_dependencies WHERE account_id=$1 AND task_id=$2 ORDER BY memory_item_id`,
  [r.f.auth.accountId, taskID])).rows;
}
async function publication(r: Runtime, taskID: string, key: string) {
  return (await r.control.query<{ format_version: number; reader: string; dependency_count: number;
    proof_digest: string; no_task_deadline: boolean; canonical_same_tx: boolean; dependencies_same_tx: boolean }>(`
    SELECT t.format_version,t.reader_actor_id::text AS reader,t.dependency_count,t.proof_digest,
      t.expires_at IS NULL AS no_task_deadline,t.xmin=i.xmin AS canonical_same_tx,
      NOT EXISTS(SELECT 1 FROM agent_task_saved_memory_dependencies d WHERE d.account_id=t.account_id
        AND d.task_id=t.task_id AND d.xmin<>t.xmin) AS dependencies_same_tx
    FROM agent_task_memory_lineage t JOIN idempotency_records i ON i.account_id=t.account_id
      AND i.actor_user_id=t.reader_actor_id AND i.operation_scope='create_unscoped_chat_task'
      AND i.idempotency_key=$4 AND i.status='completed' AND i.response_status=201 AND i.response_body->>'task_id'=t.task_id::text
    WHERE t.account_id=$1 AND t.reader_actor_id=$2 AND t.task_id=$3`,
  [r.f.auth.accountId, r.f.auth.userId, taskID, key])).rows;
}
async function noSuccessfulPublication(r: Runtime, key: string, taskID = r.lastRunID()) {
  if (!taskID || !/^[a-f0-9-]{36}$/.test(taskID)) throw new Error("The actual provider Run identity was not observed.");
  const row = (await r.control.query<{ completed: string; lineages: string }>(`SELECT
    (SELECT count(*) FROM idempotency_records i WHERE i.account_id=$1 AND i.actor_user_id=$2
      AND i.operation_scope='create_unscoped_chat_task' AND i.idempotency_key=$3
      AND i.status='completed' AND i.response_status BETWEEN 200 AND 299)::text AS completed,
    (SELECT count(*) FROM agent_task_memory_lineage t WHERE t.account_id=$1
      AND t.reader_actor_id=$2 AND t.task_id=$4)::text AS lineages`,
  [r.f.auth.accountId, r.f.auth.userId, key, taskID])).rows[0];
  expect(row).toEqual({ completed: "0", lineages: "0" });
}
async function withdraw(r: Runtime, id: string, version: number, operation: "correct" | "delete") {
  const response = await r.request({ method: "POST", url: `/v1/memory/items/${id}/mutations`, payload: {
    idempotency_key: randomUUID(), expected_version: version, operation,
    ...(operation === "correct" ? { display_text: "My synthetic runtime project uses a silver notebook." } : {}),
    reason: "Explicit synthetic withdrawal while the model callback is held.",
  } });
  expect(response.statusCode).toBe(200);
}

describe.skipIf(!savedMemoryDatabase)("saved Memory actual runtime read-set, publication and replay", () => {
  it.each(["self", "recall", "search"] as const)(
    "records all actually exposed original tuples atomically with %s completion and keeps the proof immutable on replay",
    async kind => withSavedMemoryRuntime(async r => {
      const first = "My synthetic runtime aurora_%\\ project uses a copper notebook.";
      const other = "My synthetic runtime violet project uses a paper notebook.";
      const a = await r.f.acceptSelf(first), b = await r.f.acceptSelf(other);
      const toolOnly = kind === "self" ? undefined : await r.acceptToolOnlyPerson();
      const stamps = [await r.stamp(a.itemID), await r.stamp(b.itemID), ...(toolOnly ? [await r.stamp(toolOnly.itemID)] : [])]
        .sort((x, y) => x.memory_item_id.localeCompare(y.memory_item_id));
      if (toolOnly && kind !== "self") r.configureToolOnly(kind, toolOnly);
      else r.configure(kind, a.itemID, ["aurora_%\\"]);
      const key = randomUUID(), objective = toolOnly
        ? `Read the accepted notebook clue for ${toolOnly.email} in Runtime notebook partner.` : "Read my saved synthetic project clue.";
      const before = r.calls(), answer = await r.post({ idempotency_key: key, objective });
      expect(answer.statusCode).toBe(201);
      if (kind === "search") expect(r.manifest()).toContain("search_saved_memory");
      expect(r.delivered()).toEqual(expect.arrayContaining([
        { id: a.itemID, version: a.version, display_text: first }, { id: b.itemID, version: b.version, display_text: other },
      ]));
      if (kind !== "self") {
        expect(r.tools()).toHaveLength(kind === "recall" ? 3 : 1);
        expect(r.tools().map(tool => tool.name)).toEqual(kind === "recall"
          ? ["contact_workspace", "contact_workspace", "memory_review"] : ["search_saved_memory"]);
        for (const tool of r.tools()) expect(tool.ok).toBe(true);
        if (!toolOnly) throw new Error("The tool-only regression did not prepare its real independent scope.");
        const bootstrap = new Set(r.delivered().map(item => item.id));
        expect(bootstrap.has(toolOnly.itemID)).toBe(false);
        const returned = memoryToolItems(r);
        expect(returned).toContainEqual(expect.objectContaining({ id: toolOnly.itemID, version: toolOnly.version, display_text: toolOnly.text }));
        // Explicit positive difference: self-only registration cannot satisfy
        // the exact A+B+C union below even if the real tool returns C correctly.
        expect(returned.filter(item => !bootstrap.has(item.id)).map(item => item.id)).toEqual([toolOnly.itemID]);
      }
      expect(body(answer).blocks[0]?.body).toBe(toolOnly?.text ?? first);
      const task = body(answer).task_id;
      expect(await dependencies(r, task)).toEqual(stamps); // Includes exposed-but-unquoted b; no model-selected subset.
      const rows = await publication(r, task, key);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ format_version: 1, reader: r.f.auth.userId, dependency_count: stamps.length,
        proof_digest: expect.stringMatching(/^[a-f0-9]{64}$/), no_task_deadline: true,
        canonical_same_tx: true, dependencies_same_tx: true });
      const replay = await r.post({ idempotency_key: key, objective });
      expect(replay.statusCode).toBe(201);
      expect(body(replay)).toEqual(body(answer));
      expect(r.calls()).toBe(before + 1);
      expect(await publication(r, task, key)).toEqual(rows);
      expect(await dependencies(r, task)).toEqual(stamps);
      expect(await r.current()).toBe(200);
    }), 15_000,
  );

  it.each(["recall", "search"] as const)(
    "withdraws the completed %s-only tuple while preserving a completed self-only reply and independent reply",
    async kind => withSavedMemoryRuntime(async r => {
      const independentKey = randomUUID(), independentObjective = "Give an independent synthetic greeting before Memory admission.";
      const independent = await r.post({ idempotency_key: independentKey, objective: independentObjective });
      expect(independent.statusCode).toBe(201);
      expect(body(independent).blocks[0]?.body).toBe(independentReply);
      const a = await r.f.acceptSelf("My synthetic preserved self notebook is blue."), b = await r.f.acceptSelf("My synthetic unquoted self notebook is green.");
      const c = await r.acceptToolOnlyPerson();
      const selfStamps = [await r.stamp(a.itemID), await r.stamp(b.itemID)].sort((x, y) => x.memory_item_id.localeCompare(y.memory_item_id));
      r.configure("self", a.itemID);
      const selfKey = randomUUID(), selfObjective = "Read my independently preserved self notebook.";
      const self = await r.post({ idempotency_key: selfKey, objective: selfObjective });
      expect(self.statusCode).toBe(201);
      expect(body(self).blocks[0]?.body).toBe("My synthetic preserved self notebook is blue.");
      expect(r.delivered().some(item => item.id === c.itemID)).toBe(false);
      expect(await dependencies(r, body(self).task_id)).toEqual(selfStamps);
      r.configureToolOnly(kind, c);
      const key = randomUUID(), objective = `Read the accepted notebook clue for ${c.email} in Runtime notebook partner.`;
      const derived = await r.post({ idempotency_key: key, objective });
      expect(derived.statusCode).toBe(201);
      if (kind === "search") expect(r.manifest()).toContain("search_saved_memory");
      for (const tool of r.tools()) expect(tool.ok).toBe(true);
      const bootstrap = new Set(r.delivered().map(item => item.id));
      expect([...bootstrap].sort()).toEqual([a.itemID, b.itemID].sort());
      expect(bootstrap.has(c.itemID)).toBe(false);
      expect(memoryToolItems(r).filter(item => !bootstrap.has(item.id)).map(item => item.id)).toEqual([c.itemID]);
      expect(body(derived).blocks[0]?.body).toBe(c.text);
      const union = [...selfStamps, await r.stamp(c.itemID)].sort((x, y) => x.memory_item_id.localeCompare(y.memory_item_id));
      expect(await dependencies(r, body(derived).task_id)).toEqual(union);
      const calls = r.calls();
      await withdraw(r, c.itemID, c.version, "delete");
      expect(await r.current()).toBe(200);
      expect(await r.stamp(a.itemID)).toEqual(selfStamps.find(item => item.memory_item_id === a.itemID));
      expect(await r.stamp(b.itemID)).toEqual(selfStamps.find(item => item.memory_item_id === b.itemID));
      assertDenied(await r.post({ idempotency_key: key, objective }), c.text);
      const selfReplay = await r.post({ idempotency_key: selfKey, objective: selfObjective });
      expect(selfReplay.statusCode).toBe(201);
      expect(body(selfReplay)).toEqual(body(self));
      const independentReplay = await r.post({ idempotency_key: independentKey, objective: independentObjective });
      expect(independentReplay.statusCode).toBe(201);
      expect(body(independentReplay)).toEqual(body(independent));
      expect(r.calls()).toBe(calls);
    }), 15_000,
  );

  it.each(["correct", "delete"] as const)(
    "refuses a held actual model completion after %s without a successful canonical/lineage publication",
    async operation => withSavedMemoryRuntime(async r => {
      const statement = "My synthetic held runtime project uses a copper notebook.";
      const m = await r.f.acceptSelf(statement);
      const beforeStamp = await r.stamp(m.itemID);
      r.configure("self", m.itemID);
      const held = r.holdNext(), key = randomUUID(), before = r.calls();
      const pending = r.start({ idempotency_key: key, objective: "Read my held synthetic project clue." });
      await held.entered();
      expect(r.delivered()).toContainEqual({ id: m.itemID, version: m.version, display_text: statement });
      await noSuccessfulPublication(r, key);
      await withdraw(r, m.itemID, m.version, operation);
      expect(BigInt((await r.stamp(m.itemID)).lineage_epoch)).toBeGreaterThan(BigInt(beforeStamp.lineage_epoch));
      expect(await r.current()).toBe(200);
      held.release();
      assertDenied(await pending, statement);
      await noSuccessfulPublication(r, key);
      expect(r.calls()).toBe(before + 1);
    }), 15_000,
  );

  it("keeps a completed original epoch withdrawn after actual reviewed replacement and lawful undo restore the same item/version", async () => {
    await withSavedMemoryRuntime(async r => {
      const statement = "My synthetic reversible notebook is copper.";
      const m = await r.f.acceptSelf(statement), original = await r.stamp(m.itemID);
      r.configure("self", m.itemID);
      const key = randomUUID(), objective = "Read my reversible synthetic notebook clue.";
      const answer = await r.post({ idempotency_key: key, objective });
      expect(answer.statusCode).toBe(201);
      expect(body(answer).blocks[0]?.body).toBe(statement);
      const changed = await r.reviewedUpdate(m.itemID, m.version, statement, "My synthetic reversible notebook is now silver.");
      expect((await r.f.recall()).items.some(item => item.id === m.itemID)).toBe(false);
      const undone = await r.request({ method: "POST", url: `/v1/memory/commits/${changed.commitID}/undo`, payload: {
        idempotency_key: randomUUID(), expected_commit_revision: changed.revision, reason: "Undo the synthetic replacement through the canonical owner.",
      } });
      expect(undone.statusCode).toBe(200);
      expect((await r.f.recall()).items).toContainEqual(expect.objectContaining({ id: m.itemID, version: m.version, display_text: statement }));
      const restored = await r.stamp(m.itemID);
      expect(restored.item_version).toBe(original.item_version);
      expect(BigInt(restored.lineage_epoch)).toBeGreaterThan(BigInt(original.lineage_epoch));
      const calls = r.calls();
      assertDenied(await r.post({ idempotency_key: key, objective }), statement);
      expect(r.calls()).toBe(calls);
      expect(await dependencies(r, body(answer).task_id)).toEqual([original]);
      r.configure("self", m.itemID);
      const fresh = await r.post({ idempotency_key: randomUUID(), objective });
      expect(fresh.statusCode).toBe(201);
      expect(body(fresh).blocks[0]?.body).toBe(statement);
      expect(await dependencies(r, body(fresh).task_id)).toEqual([restored]);
    });
  }, 15_000);

  it("cannot rebind a held model's original tuple to the new epoch after reviewed replacement and undo restore the same item/version", async () => {
    await withSavedMemoryRuntime(async r => {
      const statement = "My synthetic held reversible notebook is copper.";
      const m = await r.f.acceptSelf(statement), original = await r.stamp(m.itemID);
      r.configure("self", m.itemID);
      const held = r.holdNext(), key = randomUUID(), calls = r.calls();
      const pending = r.start({ idempotency_key: key, objective: "Read my held reversible synthetic notebook." });
      await held.entered();
      expect(r.delivered()).toContainEqual({ id: m.itemID, version: m.version, display_text: statement });
      const originalTask = r.lastRunID();
      const changed = await r.reviewedUpdate(m.itemID, m.version, statement, "My synthetic held reversible notebook is now silver.");
      const undone = await r.request({ method: "POST", url: `/v1/memory/commits/${changed.commitID}/undo`, payload: {
        idempotency_key: randomUUID(), expected_commit_revision: changed.revision, reason: "Restore the actual prior synthetic item while its model callback is held.",
      } });
      expect(undone.statusCode).toBe(200);
      expect((await r.f.recall()).items).toContainEqual(expect.objectContaining({ id: m.itemID, version: m.version, display_text: statement }));
      expect(BigInt((await r.stamp(m.itemID)).lineage_epoch)).toBeGreaterThan(BigInt(original.lineage_epoch));
      expect(await r.current()).toBe(200);
      held.release();
      assertDenied(await pending, statement);
      await noSuccessfulPublication(r, key, originalTask);
      expect(r.calls()).toBe(calls + 2); // One held model and one actual human-update source reply; no fallback.
    });
  }, 15_000);

  it.each([false, true])("preserves actual human prose and independent history while withholding only withdrawn assistant content (complete=%s)",
    async complete => withSavedMemoryRuntime(async r => {
      const human = "Keep this original human request even if my saved notebook clue is withdrawn.";
      const neutral = await r.post({ idempotency_key: randomUUID(), objective: "Give an independent synthetic greeting." });
      expect(neutral.statusCode).toBe(201);
      expect(body(neutral).blocks[0]?.body).toBe(independentReply);
      const statement = "My synthetic historical runtime notebook is violet.";
      const m = await r.f.acceptSelf(statement);
      r.configure("self", m.itemID);
      const answer = await r.post({ idempotency_key: randomUUID(), objective: human });
      expect(answer.statusCode).toBe(201);
      const sessionID = randomUUID();
      const independent = await r.f.saveAnswer(sessionID, "Original independent human greeting.", body(neutral));
      const saved = await r.f.saveAnswer(sessionID, human, body(answer), { expectedRevision: independent.revision,
        priorTurns: independent.payload!.turns });
      const scope = { personId: null, relationshipContextId: null };
      const initial = await readAgentSessionConversation(r.f.pool, r.f.auth, sessionID, scope, { complete });
      expect(initial.messages.some(message => message.role === "assistant" && message.text === statement)).toBe(true);
      await withdraw(r, m.itemID, m.version, "delete");
      const calls = r.calls();
      const current = await readAgentSessionConversation(r.f.pool, r.f.auth, sessionID, scope, { complete });
      expect(current.messages).toContainEqual({ message_id: saved.payload!.turns[1]!.id, role: "user", text: human });
      expect(current.messages.some(message => message.role === "assistant" && message.text === statement)).toBe(false);
      expect(current.messages.some(message => message.role === "assistant" && message.text === independentReply)).toBe(true);
      expect(r.calls()).toBe(calls);
      expect(await r.current()).toBe(200);
    }), 15_000,
  );

  it("keeps a legally completed no-Session reply readable by the renewed actual login after the original accepted branch expires, then still applies withdrawal", async () => {
    await withSavedMemoryRuntime(async r => {
      const statement = "My synthetic retained runtime notebook is copper.";
      const m = await r.f.acceptSelf(statement);
      r.configure("self", m.itemID);
      const login = await r.shortenAndRotateLogin(), key = randomUUID(), objective = "Read my retained synthetic notebook clue.";
      const answer = await login.oldPost({ idempotency_key: key, objective });
      expect(answer.statusCode).toBe(201);
      expect(body(answer).blocks[0]?.body).toBe(statement);
      const calls = r.calls();
      await login.waitOriginalExpiry();
      expect((await login.oldRequest({ method: "GET", url: "/v1/auth/session" })).statusCode).toBe(401);
      expect(await r.current()).toBe(200);
      const replay = await r.post({ idempotency_key: key, objective });
      expect(replay.statusCode).toBe(201);
      expect(body(replay)).toEqual(body(answer));
      expect((await publication(r, body(answer).task_id, key))[0]?.no_task_deadline).toBe(true);
      expect(r.calls()).toBe(calls);
      await withdraw(r, m.itemID, m.version, "delete");
      assertDenied(await r.post({ idempotency_key: key, objective }), statement);
      expect(r.calls()).toBe(calls);
    });
  }, 15_000);

  it("rejects a held unfinished reply when its original accepted login expires even though the renewed current login remains live", async () => {
    await withSavedMemoryRuntime(async r => {
      const statement = "My synthetic unfinished runtime notebook is copper.";
      const m = await r.f.acceptSelf(statement);
      r.configure("self", m.itemID);
      const login = await r.shortenAndRotateLogin(), held = r.holdNext(), key = randomUUID(), calls = r.calls();
      const pending = login.oldPost({ idempotency_key: key, objective: "Read my unfinished synthetic notebook clue." });
      await held.entered();
      expect(r.delivered()).toContainEqual({ id: m.itemID, version: m.version, display_text: statement });
      await login.waitOriginalExpiry();
      expect((await login.oldRequest({ method: "GET", url: "/v1/auth/session" })).statusCode).toBe(401);
      expect(await r.current()).toBe(200);
      held.release();
      assertDenied(await pending, statement);
      await noSuccessfulPublication(r, key);
      expect(r.calls()).toBe(calls + 1);
    });
  }, 15_000);

  it("does not turn an actually expired operational query into the retention deadline of its completed canonical answer", async () => {
    await withSavedMemoryRuntime(async r => {
      const statement = "My synthetic operational-query notebook is copper.";
      const m = await r.f.acceptSelf(statement);
      r.configure("search", m.itemID, ["operational-query"]);
      const key = randomUUID(), objective = "Find my synthetic operational-query notebook.";
      const answer = await r.post({ idempotency_key: key, objective });
      expect(answer.statusCode).toBe(201);
      expect(r.manifest()).toContain("search_saved_memory");
      expect(r.tools()[0]?.ok).toBe(true);
      expect(body(answer).blocks[0]?.body).toBe(statement);
      // Narrow the real query's operational expiry only; no fake clock/row or
      // extension of a credential, read ticket, Run or published task lifetime.
      const changed = await r.control.query(`UPDATE memory_discovery_queries SET expires_at=clock_timestamp()+interval '0.05 seconds'
        WHERE account_id=$1 AND reader_actor_id=$2 RETURNING id`, [r.f.auth.accountId, r.f.auth.userId]);
      expect(changed.rowCount).toBe(1);
      const limit = performance.now() + 1_000;
      let expired = false;
      while (performance.now() < limit) {
        expired = (await r.control.query<{ expired: boolean }>(`SELECT expires_at<=clock_timestamp() AS expired
          FROM memory_discovery_queries WHERE account_id=$1 AND id=$2`, [r.f.auth.accountId, changed.rows[0]!.id])).rows[0]?.expired === true;
        if (expired) break;
        await delay(10);
      }
      expect(expired).toBe(true);
      const calls = r.calls(), replay = await r.post({ idempotency_key: key, objective });
      expect(replay.statusCode).toBe(201);
      expect(body(replay)).toEqual(body(answer));
      expect((await publication(r, body(answer).task_id, key))[0]?.no_task_deadline).toBe(true);
      expect(r.calls()).toBe(calls);
      await withdraw(r, m.itemID, m.version, "delete");
      assertDenied(await r.post({ idempotency_key: key, objective }), statement);
      expect(r.calls()).toBe(calls);
    });
  }, 15_000);

  it("records a genuine empty original read set explicitly, without inventing finite retention or treating an absent lineage as independence", async () => {
    await withSavedMemoryRuntime(async r => {
      const key = randomUUID(), answer = await r.post({ idempotency_key: key, objective: "Give an independent synthetic greeting." });
      expect(answer.statusCode).toBe(201);
      expect(body(answer).blocks[0]?.body).toBe(independentReply);
      expect(r.delivered()).toEqual([]);
      expect(await dependencies(r, body(answer).task_id)).toEqual([]);
      const rows = await publication(r, body(answer).task_id, key);
      expect(rows).toHaveLength(1); // An absent row is not an empty-set proof.
      expect(rows[0]).toEqual({ format_version: 1, reader: r.f.auth.userId, dependency_count: 0,
        proof_digest: expect.stringMatching(/^[a-f0-9]{64}$/), no_task_deadline: true,
        canonical_same_tx: true, dependencies_same_tx: true });
    });
  }, 15_000);
});
