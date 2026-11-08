/** Real HTTP/Core/Review/credential/canonical owners on the explicitly owned
 * disposable PostgreSQL. These cases intentionally require the actual new
 * runtime wiring; missing lineage is an assertion failure, never an empty proof. */
import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { SessionResponse, UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import type { BackendConfig } from "../config.js";
import type { AuthContext } from "./auth.js";
import { admitLegacyChatAuthority, LegacyChatTerminated, readLegacySavedMemoryPublication } from "./legacyChatAuthority.js";
import { savedMemoryDurableProofDigest } from "./savedMemoryDurableLineage.js";
import { recallMemoriesTracked } from "./memoryReviewTrackedRecall.js";
import { independentReply, savedMemoryDatabase, withSavedMemoryFixture, type SavedMemoryFixture } from "./fixtures/savedMemoryDiscovery.fixture.js";

type Runtime = SavedMemoryFixture;
const readerCredentials = new WeakMap<Runtime, { auth: AuthContext; authorization: string }>();
if (process.env.GET_455_LEGACY_MEMORY_COMPLETION_TEST_REQUIRED === "1" && !savedMemoryDatabase)
  throw new Error("The Legacy completion gate requires its explicit disposable loopback PostgreSQL fixture.");
const config = (): BackendConfig => ({ databaseUrl: savedMemoryDatabase!, host: "127.0.0.1", port: 0,
  allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false, passwordAuthEnabled: true,
  passwordRegistrationEnabled: false, simulatedAuthEnabled: false, internalLabEnabled: false,
  retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 });
async function reader(r: Runtime) {
  let identity = readerCredentials.get(r);
  if (!identity) {
    const enrolled = await r.request({ method: "POST", url: "/v1/auth/persistent/enroll",
      payload: { renewal_secret: randomBytes(32).toString("base64url"), client_kind: "web" } });
    expect(enrolled.statusCode).toBe(200); // Never format a credential-bearing response.
    const login = enrolled.json<SessionResponse>();
    if (!login.session_id) throw new Error("Actual enrollment omitted its login identity.");
    const auth: AuthContext = { accountId: login.account.id, accountSlug: login.account.slug, userId: login.user.id,
      userEmail: login.user.email, userKind: login.user.kind, sessionId: login.session_id };
    identity = { auth, authorization: `Bearer ${login.access_token}` };
    readerCredentials.set(r, identity);
  }
  return { auth: identity.auth, owner: await admitLegacyChatAuthority(r.pool, identity.auth, identity.authorization, config()) };
}
async function heldReaderFence(r: Runtime, current: Awaited<ReturnType<typeof reader>>) {
  const client = await r.pool.connect();
  let begun = false;
  try {
    await client.query("BEGIN"); begun = true;
    await current.owner.withClient(client, async held => {
      await current.owner.lockAccountsForFinalization(held);
      await current.owner.lockReadersForFinalization(held);
      await current.owner.assertFinalCurrent(held);
    });
    await client.query("COMMIT"); begun = false;
  } finally {
    try { if (begun) await client.query("ROLLBACK"); }
    finally { client.release(); }
  }
}
async function answer(r: Runtime, kind: "self" | "search" = "self", sessionID?: string) {
  const text = "My synthetic completion gate aurora notebook has a copper cover.";
  const memory = await r.acceptSelf(text);
  const original = await recallMemoriesTracked(r.pool, r.auth, { surface: "chat", scope: "self" });
  expect(original.originalStamps.map(s => s.item_id)).toContain(memory.itemID);
  r.provider.mode = kind === "search" ? "discovery" : "recall";
  r.provider.selectedMemoryID = memory.itemID; r.provider.discoveryTerms = ["aurora"];
  const key = randomUUID(), objective = "Read my synthetic completion gate notebook.";
  const response = await r.post({ idempotency_key: key, objective, ...(sessionID ? { session_id: sessionID } : {}) });
  expect(response.statusCode).toBe(201);
  const body = response.json<UnscopedChatTaskResponse>();
  expect(body.blocks[0]?.body).toBe(kind === "search" ? independentReply : text);
  if (kind === "search") {
    const result = r.provider.toolResults.find(result => result.name === "search_saved_memory");
    expect(result?.ok).toBe(true);
    const items = (result?.data as { items?: Array<{ id: string }> } | undefined)?.items;
    expect(items?.map(item => item.id)).toContain(memory.itemID);
  }
  expect(r.provider.delivered).toContainEqual({ id: memory.itemID, version: memory.version, display_text: text });
  return { body, memory, key, objective, original: original.originalStamps };
}

/** Observe the real held-final rows without substituting a query or result.
 * Bounded metadata SELECTs on that client and an independent autocommit pool
 * check precede its original promise resolution. Their real elapsed cost is
 * charged by the production owner. No
 * private credential parameters or response prose are inspected. */
function observeHeldFinal(r: Runtime) {
  const seen = new WeakSet<PoolClient>(), restore: Array<() => void> = [];
  const observations: Array<{ task_id: string | null; available: boolean; held_outer_and_private: boolean }> = [];
  const acquired = (client: PoolClient) => {
    if (seen.has(client)) return;
    seen.add(client);
    const original = client.query;
    const wrapped = new Proxy(original, { apply(target, thisArg, args: unknown[]) {
      const result: unknown = Reflect.apply(target, thisArg, args);
      const text = args[0];
      if (typeof text !== "string" || !text.includes("d.stamps=$12::jsonb->'proof'->'stamps'")
        || !result || typeof (result as Promise<unknown>).then !== "function") return result;
      return (result as Promise<unknown>).then(async actual => {
        const metadata = await Reflect.apply(original, client, [`SELECT t.task_id::text,
          pg_current_xact_id_if_assigned()::text AS outer_xid
          FROM agent_task_memory_lineage t JOIN idempotency_records i ON i.id=t.completion_idempotency_id
          WHERE t.account_id=$1 AND t.format_version=2 AND i.status='completed' AND i.response_status=201
            AND i.account_id=t.account_id AND i.actor_user_id=t.reader_actor_id
            AND i.response_body->>'task_id'=t.task_id::text
            AND saved_memory_task_current(t.account_id,t.task_id,t.reader_actor_id,statement_timestamp())
          ORDER BY t.task_id LIMIT 16`, [r.auth.accountId]]) as { rows: Array<{ task_id: string; outer_xid: string | null }> };
        if (metadata.rows.length >= 16) throw new Error("The synthetic completion probe exceeded its fixed metadata bound.");
        // Only this one request is in flight in the fixture. Find the one row
        // that is still private to this actual outer transaction. PL/pgSQL
        // EXCEPTION blocks give rows subxids; literal xmin=top-xid is invalid.
        for (const row of metadata.rows) {
          if (!row.outer_xid) continue;
          const outside = (await r.pool.query<{ canonical_visible: boolean; lineage_visible: boolean }>(`SELECT
            EXISTS(SELECT 1 FROM idempotency_records i WHERE i.account_id=$1 AND i.actor_user_id=$2
              AND i.status='completed' AND i.response_status=201 AND i.response_body->>'task_id'=$3) AS canonical_visible,
            EXISTS(SELECT 1 FROM agent_task_memory_lineage t WHERE t.account_id=$1 AND t.reader_actor_id=$2
              AND t.task_id=$3::uuid) AS lineage_visible`, [r.auth.accountId, r.auth.userId, row.task_id])).rows[0];
          const after = await Reflect.apply(original, client, ["SELECT pg_current_xact_id_if_assigned()::text AS outer_xid"]) as {
            rows: Array<{ outer_xid: string | null }> };
          const rows = (actual as { rows: Array<{ available?: unknown }> }).rows;
          observations.push({ task_id: row.task_id, available: rows.length === 1 && rows[0]?.available === true,
            held_outer_and_private: after.rows[0]?.outer_xid === row.outer_xid
              && outside?.canonical_visible === false && outside.lineage_visible === false });
        }
        return actual;
      });
    } });
    client.query = wrapped;
    restore.push(() => { if (client.query === wrapped) client.query = original; });
  };
  r.pool.on("acquire", acquired);
  return { observations, dispose: () => { r.pool.off("acquire", acquired); for (const undo of restore) undo(); } };
}

describe.skipIf(!savedMemoryDatabase)("sealed canonical completion and actual current reader", { concurrent: false }, () => {
  it("checks real canonical writes on their held outer client, then replays V2 after the old discovery query expires", async () => {
    await withSavedMemoryFixture(async r => {
      const probe = observeHeldFinal(r);
      try {
        const a = await answer(r, "search");
        expect(probe.observations.some(o => o.task_id === a.body.task_id && o.available && o.held_outer_and_private)).toBe(true);
        const stored = (await r.pool.query<{ proof_digest: string; format_version: number; dependency_count: number }>(
          `SELECT t.proof_digest,t.format_version,t.dependency_count FROM agent_task_memory_lineage t
          JOIN idempotency_records i ON i.id=t.completion_idempotency_id
          WHERE t.account_id=$1 AND t.task_id=$2 AND i.status='completed' AND i.response_status=201
            AND i.account_id=t.account_id AND i.actor_user_id=t.reader_actor_id AND i.response_body->>'task_id'=t.task_id::text`,
          [r.auth.accountId, a.body.task_id])).rows;
        expect(stored).toHaveLength(1); expect(stored[0]!.format_version).toBe(2);
        expect(stored[0]!.dependency_count).toBeGreaterThan(0);
        const expired = await r.pool.query(`UPDATE memory_discovery_queries SET expires_at=clock_timestamp()-interval '1 second'
          WHERE account_id=$1 AND reader_actor_id=$2`, [r.auth.accountId, r.auth.userId]);
        expect(expired.rowCount).toBeGreaterThan(0);
        const current = await reader(r), calls = r.provider.calls;
        try {
          const retained = await readLegacySavedMemoryPublication(current.owner, current.auth, a.body.task_id);
          expect(retained.retention_kind).toBe("canonical_no_session");
          expect(retained.expires_at).toBeNull(); expect(retained.source_origin_session_id).toBeNull();
          expect(retained.stamps).toEqual(a.original);
          expect(savedMemoryDurableProofDigest(retained)).toBe(stored[0]!.proof_digest);
          await heldReaderFence(r, current); // Both explicit and withClient-tail held joints read this same original V2.
          expect(r.provider.calls).toBe(calls); expect(current.owner.signal.aborted).toBe(false);
        } finally { current.owner.dispose(); }
      } finally { probe.dispose(); }
    });
  }, 15_000);

  it("refuses an actual accepted Memory withdrawal for a new reader without reusing the old Run or query", async () => {
    await withSavedMemoryFixture(async r => {
      const a = await answer(r), current = await reader(r), calls = r.provider.calls;
      try {
        expect((await readLegacySavedMemoryPublication(current.owner, current.auth, a.body.task_id)).stamps).toEqual(a.original);
        const removed = await r.request({ method: "POST", url: `/v1/memory/items/${a.memory.itemID}/mutations`, payload: {
          operation: "delete", expected_version: a.memory.version, idempotency_key: randomUUID(), reason: "Explicit synthetic replay withdrawal." } });
        expect(removed.statusCode).toBe(200); expect(await r.current()).toBe(200);
        await expect(heldReaderFence(r, current)).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(current.owner.signal.aborted).toBe(true); expect(r.provider.calls).toBe(calls);
      } finally { current.owner.dispose(); }
    });
  }, 15_000);

  it("retains the original Session provenance while any actual saved copy remains, then refuses the last copy deletion", async () => {
    await withSavedMemoryFixture(async r => {
      const neutral = await r.post({ idempotency_key: randomUUID(), objective: "Synthetic independent source greeting." });
      expect(neutral.statusCode).toBe(201);
      const origin = randomUUID(), source = await r.saveAnswer(origin, "Synthetic independent source greeting.", neutral.json<UnscopedChatTaskResponse>());
      const a = await answer(r, "self", origin), copyID = randomUUID();
      const copy = await r.saveAnswer(copyID, a.objective, a.body);
      const before = await reader(r);
      let retained: Awaited<ReturnType<typeof readLegacySavedMemoryPublication>>;
      try { retained = await readLegacySavedMemoryPublication(before.owner, before.auth, a.body.task_id); }
      finally { before.owner.dispose(); }
      expect(retained.stamps).toEqual(a.original);
      expect(retained.retention_kind).toBe("session_bound"); expect(retained.source_origin_session_id).toBe(origin);
      expect(retained.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
      const deletedOrigin = await r.request({ method: "DELETE", url: `/v1/agent-sessions/${origin}`,
        payload: { expected_revision: source.revision, idempotency_key: randomUUID() } });
      expect(deletedOrigin.statusCode).toBe(200);
      const after = await reader(r);
      try { expect(await readLegacySavedMemoryPublication(after.owner, after.auth, a.body.task_id)).toEqual(retained); }
      finally { after.owner.dispose(); }
      const deletedCopy = await r.request({ method: "DELETE", url: `/v1/agent-sessions/${copyID}`,
        payload: { expected_revision: copy.revision, idempotency_key: randomUUID() } });
      expect(deletedCopy.statusCode).toBe(200);
      const last = await reader(r);
      try {
        await expect(readLegacySavedMemoryPublication(last.owner, last.auth, a.body.task_id)).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(last.owner.signal.aborted).toBe(true);
      } finally { last.owner.dispose(); }
    });
  }, 15_000);

  it("refuses missing lineage and a revoked actual current-reader credential instead of granting an empty proof", async () => {
    await withSavedMemoryFixture(async r => {
      const a = await answer(r), missing = await reader(r);
      try {
        await expect(readLegacySavedMemoryPublication(missing.owner, missing.auth, randomUUID())).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(missing.owner.signal.aborted).toBe(true);
      } finally { missing.owner.dispose(); }
      const current = await reader(r);
      try {
        expect((await readLegacySavedMemoryPublication(current.owner, current.auth, a.body.task_id)).stamps.length).toBeGreaterThan(0);
        const revoked = await r.pool.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE account_id=$1 AND user_id=$2 AND id=$3 AND revoked_at IS NULL",
          [current.auth.accountId, current.auth.userId, current.auth.sessionId]);
        expect(revoked.rowCount).toBe(1);
        await expect(readLegacySavedMemoryPublication(current.owner, current.auth, a.body.task_id)).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(current.owner.signal.aborted).toBe(true);
      } finally { current.owner.dispose(); }
    });
  }, 15_000);
});
