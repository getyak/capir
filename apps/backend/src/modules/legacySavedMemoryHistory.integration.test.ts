/** Real Auth/HTTP Memory/canonical V2/Session source seam on disposable PG.
 * These prepared-module cases do not activate the public Session entry or
 * replace its unchanged required completion cases. No fabricated grants/rows. */
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SessionResponse, UnscopedChatTaskResponse } from "@talent-signal/contracts";
import type { BackendConfig } from "../config.js";
import type { DatabaseClient } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { encodePasswordCredential } from "./passwordCredential.js";
import { createHarnessSourceGuardWithBinding } from "./harnessSourceGuard.js";
import { accessLegacySavedMemoryRun, admitLegacyChatAuthority, bindLegacySavedMemoryRun,
  inheritLegacySavedMemoryHistory, LegacyChatTerminated, sealLegacySavedMemoryRun,
  type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { readSavedMemorySessionHistory } from "./savedMemorySessionHistory.js";
import { recallMemoriesTracked } from "./memoryReviewTrackedRecall.js";
import { searchSavedMemory } from "./savedMemoryDiscovery.js";
import { savedMemoryDatabase, withSavedMemoryFixture, type SavedMemoryFixture } from "./fixtures/savedMemoryDiscovery.fixture.js";

if (process.env.GET_455_LEGACY_MEMORY_HISTORY_TEST_REQUIRED === "1" && !savedMemoryDatabase)
  throw new Error("The Legacy history gate requires its explicit disposable loopback PostgreSQL fixture.");
const config = (): BackendConfig => ({ databaseUrl: savedMemoryDatabase!, host: "127.0.0.1", port: 0,
  allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false, passwordAuthEnabled: true,
  passwordRegistrationEnabled: false, simulatedAuthEnabled: false, internalLabEnabled: false,
  retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 });

async function original(f: SavedMemoryFixture, search = false) {
  const text = "My synthetic history-joint-aurora notebook has a copper cover.";
  const memory = await f.acceptSelf(text);
  const stamps = (await recallMemoriesTracked(f.pool, f.auth, { surface: "chat", scope: "self" })).originalStamps;
  expect(stamps.map(stamp => stamp.item_id)).toContain(memory.itemID);
  f.provider.mode = search ? "discovery" : "recall"; f.provider.selectedMemoryID = memory.itemID;
  f.provider.discoveryTerms = ["history-joint-aurora"];
  const objective = "Read the synthetic history-joint-aurora notebook.";
  const response = await f.post({ idempotency_key: randomUUID(), objective });
  expect(response.statusCode).toBe(201);
  const body = response.json<UnscopedChatTaskResponse>();
  expect(f.provider.delivered).toContainEqual({ id: memory.itemID, version: memory.version, display_text: text });
  if (search) expect(f.provider.toolResults.find(result => result.name === "search_saved_memory")?.ok).toBe(true);
  else expect(body.blocks[0]?.body).toBe(text);
  const sessionID = randomUUID(), saved = await f.saveAnswer(sessionID, objective, body);
  return { memory, stamps, body, sessionID, saved };
}
async function currentOwner(f: SavedMemoryFixture) {
  // Synthetic login setup only: issue a genuinely different normal password
  // login, so expiration of the original answer's login is a meaningful test.
  const password = randomBytes(24).toString("base64url");
  const credential = await f.pool.query(`UPDATE password_credentials SET password_scrypt=$3
    WHERE account_id=$1 AND user_id=$2`, [f.auth.accountId, f.auth.userId, await encodePasswordCredential(password)]);
  expect(credential.rowCount).toBe(1);
  const response = await f.request({ method: "POST", url: "/v1/auth/password/login",
    payload: { identifier: f.auth.userEmail, password, client_label: "Synthetic current history reader" } });
  expect(response.statusCode).toBe(200); // Never format the credential-bearing response.
  const login = response.json<SessionResponse>();
  if (!login.session_id) throw new Error("The actual password login omitted its session identity.");
  const auth: AuthContext = { accountId: login.account.id, accountSlug: login.account.slug, userId: login.user.id,
    userEmail: login.user.email, userKind: login.user.kind, sessionId: login.session_id };
  expect(auth.sessionId).not.toBe(f.auth.sessionId);
  return { auth, owner: await admitLegacyChatAuthority(f.pool, auth, `Bearer ${login.access_token}`, config()) };
}
async function prepared(f: SavedMemoryFixture, sessionID: string, owner: LegacyChatAuthority, auth: AuthContext,
  readerDatabase: DatabaseClient = f.pool) {
  const source = await createHarnessSourceGuardWithBinding(f.pool, auth, sessionID,
    () => ({ expiresAt: new Date(Date.now() + 60_000), personIDs: [] }));
  const taskID = randomUUID(), runID = randomUUID();
  const handle = await bindLegacySavedMemoryRun(owner, { auth, ...source, taskID, runID,
    runDeadlineMonotonicMs: performance.now() + 30_000 });
  const run = accessLegacySavedMemoryRun(handle, owner, auth);
  const receipt = await readSavedMemorySessionHistory({ database: readerDatabase, owner, auth, sessionID, taskID, runID, ...source });
  return { run, handle, receipt };
}
async function expireQueries(f: SavedMemoryFixture) {
  const result = await f.pool.query<{ legal: boolean; expired: boolean }>(`UPDATE memory_discovery_queries
    SET expires_at=created_at+interval '1 microsecond'
    WHERE account_id=$1 AND reader_actor_id=$2 AND created_at+interval '1 microsecond'<clock_timestamp()
    RETURNING expires_at>created_at AS legal,expires_at<=clock_timestamp() AS expired`, [f.auth.accountId, f.auth.userId]);
  expect(result.rowCount).toBeGreaterThan(0);
  expect(result.rows.every(row => row.legal && row.expired)).toBe(true);
  const readback = await f.pool.query<{ legal: boolean; expired: boolean }>(`SELECT expires_at>created_at AS legal,
    expires_at<=clock_timestamp() AS expired FROM memory_discovery_queries WHERE account_id=$1 AND reader_actor_id=$2`,
  [f.auth.accountId, f.auth.userId]);
  expect(readback.rows).toHaveLength(result.rows.length);
  expect(readback.rows.every(row => row.legal && row.expired)).toBe(true);
}

describe.skipIf(!savedMemoryDatabase)("private bound Run inherits original inline Session V2 domains", { concurrent: false }, () => {

  it("rejects a real pool-forwarding wrapper as a substitute for the owner's private reader database", async () => {
    await withSavedMemoryFixture(async f => {
      const a = await original(f), { owner, auth } = await currentOwner(f);
      try {
        const wrapper = { query: f.pool.query.bind(f.pool) } as unknown as DatabaseClient;
        const { run, handle, receipt } = await prepared(f, a.sessionID, owner, auth, wrapper);
        await owner.assertCurrent(); expect(await f.current()).toBe(200);
        await expect(inheritLegacySavedMemoryHistory(handle, owner, auth, receipt)).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(run.reads.snapshot().stamps).toEqual([]); expect(owner.signal.aborted).toBe(true);
      } finally { owner.dispose(); }
    });
  }, 15_000);

  it("inherits a real same-SELECT frame from the owner's actual current guarded transaction client", async () => {
    await withSavedMemoryFixture(async f => {
      const a = await original(f), { owner, auth } = await currentOwner(f), client = await f.pool.connect();
      let begun = false;
      try {
        await client.query("BEGIN"); begun = true;
        await owner.withClient(client, async held => {
          const { run, handle, receipt } = await prepared(f, a.sessionID, owner, auth, held);
          const frame = await inheritLegacySavedMemoryHistory(handle, owner, auth, receipt);
          expect(frame.envelope.available).toBe(true);
          expect(frame.messages.some(message => message.role === "assistant" && message.text === a.body.blocks[0]?.body)).toBe(true);
          expect(run.reads.snapshot().stamps).toEqual(a.stamps); await run.assertCurrent();
          expect(owner.signal.aborted).toBe(false);
          // This is the real prepared reader seam, not a new Session completion
          // writer. Seal/held-final new canonical publication remains HTTP work.
        });
        await client.query("COMMIT"); begun = false; expect(await f.current()).toBe(200);
      } finally {
        try { if (begun) await client.query("ROLLBACK"); }
        finally { client.release(); owner.dispose(); }
      }
    });
  }, 15_000);

  it("keeps genuine V2 history after the original query and login expire without restarting either lifetime", async () => {
    await withSavedMemoryFixture(async f => {
      const a = await original(f, true), { owner, auth } = await currentOwner(f);
      try {
        const { run, handle, receipt } = await prepared(f, a.sessionID, owner, auth);
        const calls = f.provider.calls, originalDeadline = run.authority.expiresAt;
        await expireQueries(f);
        const expired = await f.pool.query(`UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second'
          WHERE account_id=$1 AND user_id=$2 AND id=$3 AND id<>$4`, [f.auth.accountId, f.auth.userId, f.auth.sessionId, auth.sessionId]);
        expect(expired.rowCount).toBe(1); expect(await f.current()).toBe(401);
        expect((await f.pool.query<{ live: boolean }>(`SELECT revoked_at IS NULL AND expires_at>clock_timestamp() AS live
          FROM sessions WHERE account_id=$1 AND user_id=$2 AND id=$3`, [auth.accountId, auth.userId, auth.sessionId])).rows).toEqual([{ live: true }]);
        expect((await inheritLegacySavedMemoryHistory(handle, owner, auth, receipt)).envelope.available).toBe(true);
        expect(run.reads.snapshot().stamps).toEqual(a.stamps);
        expect(run.authority.expiresAt).toBe(originalDeadline);
        await run.assertCurrent();
        expect((await sealLegacySavedMemoryRun(handle, owner, auth)).stamps).toEqual(a.stamps);
        expect(f.provider.calls).toBe(calls); expect(owner.signal.aborted).toBe(false);
      } finally { owner.dispose(); }
    });
  }, 15_000);

  it("refuses a real accepted Memory withdrawal after a successful history joint", async () => {
    await withSavedMemoryFixture(async f => {
      const a = await original(f), { owner, auth } = await currentOwner(f);
      try {
        const { run, handle, receipt } = await prepared(f, a.sessionID, owner, auth);
        await inheritLegacySavedMemoryHistory(handle, owner, auth, receipt);
        expect(run.reads.snapshot().stamps).toEqual(a.stamps); await run.assertCurrent();
        const removed = await f.request({ method: "POST", url: `/v1/memory/items/${a.memory.itemID}/mutations`, payload: {
          operation: "delete", expected_version: a.memory.version, idempotency_key: randomUUID(), reason: "Explicit synthetic inherited withdrawal." } });
        expect(removed.statusCode).toBe(200); expect(await f.current()).toBe(200);
        await expect(run.assertCurrent()).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(owner.signal.aborted).toBe(true);
        let invoked = false;
        await expect(owner.provider(async () => { invoked = true; return "must never publish"; })).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(invoked).toBe(false);
      } finally { owner.dispose(); }
    });
  }, 15_000);

  it("refuses an actual canonical body rewrite while the Session stamp and Memory remain unchanged", async () => {
    await withSavedMemoryFixture(async f => {
      const a = await original(f), { owner, auth } = await currentOwner(f);
      try {
        const { run, handle, receipt } = await prepared(f, a.sessionID, owner, auth);
        await inheritLegacySavedMemoryHistory(handle, owner, auth, receipt); await run.assertCurrent();
        const changed = await f.pool.query(`UPDATE idempotency_records SET response_body=jsonb_set(response_body,'{blocks,0,body}',
          to_jsonb('Changed synthetic canonical reply'::text)) WHERE account_id=$1 AND actor_user_id=$2
          AND operation_scope='create_unscoped_chat_task' AND status='completed' AND response_body->>'task_id'=$3`,
        [auth.accountId, auth.userId, a.body.task_id]);
        expect(changed.rowCount).toBe(1); expect(await f.current()).toBe(200);
        await expect(run.assertCurrent()).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(owner.signal.aborted).toBe(true);
      } finally { owner.dispose(); }
    });
  }, 15_000);

  it("refuses a missing original dependency without treating the ancestor as independent", async () => {
    await withSavedMemoryFixture(async f => {
      const a = await original(f), { owner, auth } = await currentOwner(f);
      try {
        const { run, handle, receipt } = await prepared(f, a.sessionID, owner, auth);
        await inheritLegacySavedMemoryHistory(handle, owner, auth, receipt); await run.assertCurrent();
        const removed = await f.pool.query(`DELETE FROM agent_task_saved_memory_dependencies
          WHERE account_id=$1 AND task_id=$2 AND memory_item_id=$3`, [auth.accountId, a.body.task_id, a.memory.itemID]);
        expect(removed.rowCount).toBe(1);
        expect((await f.pool.query<{ current: boolean }>(`SELECT saved_memory_task_current($1,$2,$3,statement_timestamp()) AS current`,
          [auth.accountId, a.body.task_id, auth.userId])).rows).toEqual([{ current: false }]);
        expect(await f.current()).toBe(200);
        await expect(sealLegacySavedMemoryRun(handle, owner, auth)).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(owner.signal.aborted).toBe(true);
      } finally { owner.dispose(); }
    });
  }, 15_000);

  it("retains the new Run's actual query domain as well as the inherited V2 domain", async () => {
    await withSavedMemoryFixture(async f => {
      const a = await original(f), { owner, auth } = await currentOwner(f);
      try {
        const { run, handle, receipt } = await prepared(f, a.sessionID, owner, auth);
        await inheritLegacySavedMemoryHistory(handle, owner, auth, receipt);
        let charged = 0;
        const page = await searchSavedMemory({ pool: f.pool, database: f.pool, authority: run.authority, reads: run.reads,
          remainingContextCharacters: () => 24_000 - charged, chargeContextCharacters: n => { charged += n; return charged <= 24_000; },
          finalizeRead: run.finalizeRead }, { terms: ["history-joint-aurora"], limit: 10 });
        expect(page.items.map(item => item.id)).toContain(a.memory.itemID); await run.assertCurrent();
        await expireQueries(f); expect(await f.current()).toBe(200);
        await expect(run.assertCurrent()).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(owner.signal.aborted).toBe(true);
      } finally { owner.dispose(); }
    });
  }, 15_000);

  it("refuses a real source Session revision after receipt selection instead of rebasing its original stamp", async () => {
    await withSavedMemoryFixture(async f => {
      const a = await original(f), { owner, auth } = await currentOwner(f);
      try {
        const { run, handle, receipt } = await prepared(f, a.sessionID, owner, auth);
        const changed = await f.pool.query(`UPDATE agent_sessions SET payload=jsonb_set(payload,'{turns,0,objective}',
          to_jsonb('Changed synthetic source turn'::text)),revision=revision+1 WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3`,
        [auth.accountId, auth.userId, a.sessionID]);
        expect(changed.rowCount).toBe(1); expect(await f.current()).toBe(200);
        await expect(inheritLegacySavedMemoryHistory(handle, owner, auth, receipt)).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(run.reads.snapshot().stamps).toEqual([]); expect(owner.signal.aborted).toBe(true);
      } finally { owner.dispose(); }
    });
  }, 15_000);
});
