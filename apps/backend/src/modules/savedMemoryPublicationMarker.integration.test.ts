/** Actual HTTP/Review publication-marker contract on the admitted disposable PG.
 * Source-only until the explicit Hosted selector runs it. No successful marker,
 * canonical reply, Memory, credential or lineage is inserted by these tests. */
import { randomUUID } from "node:crypto";
import type { UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import { assertDenied, independentReply, savedMemoryDatabase, withSavedMemoryRuntime } from "./fixtures/savedMemoryRuntime.fixture.js";

if (process.env.GET_455_PUBLICATION_MARKER_TEST_REQUIRED === "1" && !savedMemoryDatabase) {
  throw new Error("GET455 publication-marker verification requires the explicit disposable loopback database.");
}

type Runtime = Parameters<Parameters<typeof withSavedMemoryRuntime>[0]>[0];
type Publication = {
  claim_id: string;
  required: boolean;
  lineage_present: boolean;
  format_version: number | null;
  retention_kind: string | null;
  completion_bound: boolean | null;
  no_origin_session: boolean;
  no_task_deadline: boolean;
  dependency_count: number | null;
  same_transaction: boolean | null;
};
const body = (response: { json<T>(): T }) => response.json<UnscopedChatTaskResponse>();

async function publication(r: Runtime, task: string, key: string): Promise<Publication> {
  const rows = (await r.control.query<Publication>(`SELECT i.id::text AS claim_id,
    i.saved_memory_lineage_required AS required,t.task_id IS NOT NULL AS lineage_present,
    t.format_version,t.retention_kind,t.completion_idempotency_id=i.id AS completion_bound,
    t.source_origin_session_id IS NULL AS no_origin_session,t.expires_at IS NULL AS no_task_deadline,
    t.dependency_count,t.xmin=i.xmin AS same_transaction
    FROM idempotency_records i LEFT JOIN agent_task_memory_lineage t
      ON t.account_id=i.account_id AND t.reader_actor_id=i.actor_user_id AND t.task_id::text=i.response_body->>'task_id'
    WHERE i.account_id=$1 AND i.actor_user_id=$2 AND i.operation_scope='create_unscoped_chat_task'
      AND i.idempotency_key=$3 AND i.status='completed' AND i.response_status=201 AND i.response_body->>'task_id'=$4`,
  [r.f.auth.accountId, r.f.auth.userId, key, task])).rows;
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("The actual HTTP completion did not publish its canonical claim.");
  return row;
}

function expectDurable(row: Publication, count: number): void {
  expect(row).toMatchObject({ required: true, lineage_present: true, format_version: 2,
    retention_kind: "canonical_no_session", completion_bound: true, no_origin_session: true,
    no_task_deadline: true, dependency_count: count, same_transaction: true });
}

describe.skipIf(!savedMemoryDatabase)("saved Memory actual publication marker and missing-proof replay", () => {
  it("marks a real self completion, replays without a model, and refuses replay after its exact owned proof is lost", async () => {
    await withSavedMemoryRuntime(async r => {
      const statement = "My synthetic publication-marker notebook is copper.";
      const memory = await r.f.acceptSelf(statement);
      r.configure("self", memory.itemID);
      const key = randomUUID(), objective = "Read my accepted synthetic publication-marker notebook.";
      const calls = r.calls(), answer = await r.post({ idempotency_key: key, objective });
      expect(answer.statusCode).toBe(201);
      expect(body(answer).blocks[0]?.body).toBe(statement);
      expect(r.delivered()).toContainEqual({ id: memory.itemID, version: memory.version, display_text: statement });
      const task = body(answer).task_id, published = await publication(r, task, key);
      expectDurable(published, r.delivered().length);
      expect(r.calls()).toBe(calls + 1);
      const replay = await r.post({ idempotency_key: key, objective });
      expect(replay.statusCode).toBe(201);
      expect(body(replay)).toEqual(body(answer));
      expect(r.calls()).toBe(calls + 1);
      expect(await publication(r, task, key)).toEqual(published);

      // Synthetic fault injection only, never a product cleanup operation.
      // The real FK has no cascade: remove only this owned task's proof children
      // after proving that it has no Session-copy mapping. Keep its canonical
      // claim/marker, accepted Memory, source messages and credentials intact.
      const copies = (await r.control.query<{ count: string }>(`SELECT count(*)::text AS count
        FROM agent_task_memory_session_copies WHERE account_id=$1 AND task_id=$2`,
      [r.f.auth.accountId, task])).rows;
      expect(copies).toEqual([{ count: "0" }]);
      const removedDependencies = await r.control.query(`DELETE FROM agent_task_saved_memory_dependencies d
        USING agent_task_memory_lineage t WHERE d.account_id=t.account_id AND d.task_id=t.task_id
          AND t.account_id=$1 AND t.reader_actor_id=$2 AND t.task_id=$3 RETURNING d.memory_item_id`,
      [r.f.auth.accountId, r.f.auth.userId, task]);
      expect(removedDependencies.rowCount).toBe(published.dependency_count);
      const removed = await r.control.query<{ task_id: string }>(`DELETE FROM agent_task_memory_lineage
        WHERE account_id=$1 AND reader_actor_id=$2 AND task_id=$3 RETURNING task_id::text`,
      [r.f.auth.accountId, r.f.auth.userId, task]);
      expect(removed.rows).toEqual([{ task_id: task }]);
      const missing = await publication(r, task, key);
      expect(missing).toMatchObject({ claim_id: published.claim_id, required: true, lineage_present: false,
        format_version: null, retention_kind: null, completion_bound: null, dependency_count: null, same_transaction: null });
      expect((await r.f.recall()).items).toContainEqual(expect.objectContaining({
        id: memory.itemID, version: memory.version, display_text: statement }));
      expect(await r.current()).toBe(200);
      assertDenied(await r.post({ idempotency_key: key, objective }), statement);
      expect(r.calls()).toBe(calls + 1);
      expect(await publication(r, task, key)).toEqual(missing);
    });
  }, 15_000);

  it("marks a genuinely empty completed read set and preserves its real V2 claim on normal replay", async () => {
    await withSavedMemoryRuntime(async r => {
      const key = randomUUID(), objective = "Give an independent synthetic publication-marker greeting.";
      const calls = r.calls(), answer = await r.post({ idempotency_key: key, objective });
      expect(answer.statusCode).toBe(201);
      expect(body(answer).blocks[0]?.body).toBe(independentReply);
      expect(r.delivered()).toEqual([]);
      const task = body(answer).task_id, published = await publication(r, task, key);
      expectDurable(published, 0);
      const replay = await r.post({ idempotency_key: key, objective });
      expect(replay.statusCode).toBe(201);
      expect(body(replay)).toEqual(body(answer));
      expect(await publication(r, task, key)).toEqual(published);
      expect(r.calls()).toBe(calls + 1);
      expect(await r.current()).toBe(200);
    });
  }, 15_000);

  it("rejects clearing a genuinely published true marker and leaves the canonical reply replayable", async () => {
    await withSavedMemoryRuntime(async r => {
      const key = randomUUID(), objective = "Give an independent synthetic immutable-marker greeting.";
      const calls = r.calls(), answer = await r.post({ idempotency_key: key, objective });
      expect(answer.statusCode).toBe(201);
      expect(body(answer).blocks[0]?.body).toBe(independentReply);
      const task = body(answer).task_id, published = await publication(r, task, key);
      // Column existence, true and real V2 must be observed before the negative
      // update: a missing column or absent publication cannot count as refusal.
      expectDurable(published, 0);
      await expect(r.control.query(`UPDATE idempotency_records SET saved_memory_lineage_required=false
        WHERE account_id=$1 AND actor_user_id=$2 AND id=$3 AND operation_scope='create_unscoped_chat_task'
          AND idempotency_key=$4 AND status='completed' AND response_status=201 AND response_body->>'task_id'=$5`,
      [r.f.auth.accountId, r.f.auth.userId, published.claim_id, key, task]))
        .rejects.toMatchObject({ code: "23514", constraint: "saved_memory_canonical_marker_115" });
      expect(await publication(r, task, key)).toEqual(published);
      expect(await r.current()).toBe(200);
      const replay = await r.post({ idempotency_key: key, objective });
      expect(replay.statusCode).toBe(201);
      expect(body(replay)).toEqual(body(answer));
      expect(r.calls()).toBe(calls + 1);
    });
  }, 15_000);
});
