/** Real password/Session/Review/source owners on the explicit disposable PG.
 * This private seam test does not claim Core/provider/publication integration. */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { SessionResponse, UnscopedChatTaskResponse } from "@talent-signal/contracts";
import type { BackendConfig } from "../config.js";
import { buildApp } from "../app.js";
import { createAuthGuard, type AuthContext } from "./auth.js";
import { LocalChatMediaStorage } from "./chatMediaStorage.js";
import { LabWorkspaceService } from "./labWorkspaces.js";
import { createHarnessSourceGuardWithBinding } from "./harnessSourceGuard.js";
import { accessLegacySavedMemoryRun, admitLegacyChatAuthority, bindLegacySavedMemoryRun,
  LegacyChatTerminated, type LegacyChatAuthority } from "./legacyChatAuthority.js";
import { captureSavedMemoryReadProof } from "./savedMemoryLineage.js";
import { recallMemoriesTracked } from "./memoryReviewTrackedRecall.js";
import { searchSavedMemory } from "./savedMemoryDiscovery.js";
import { savedMemoryDatabase, withSavedMemoryFixture, type SavedMemoryFixture } from "./fixtures/savedMemoryDiscovery.fixture.js";

if (process.env.GET_455_LEGACY_MEMORY_RUN_TEST_REQUIRED === "1" && !savedMemoryDatabase) {
  throw new Error("The Legacy Memory Run gate requires its explicit disposable loopback PostgreSQL fixture.");
}
const config = (): BackendConfig => ({ databaseUrl: savedMemoryDatabase!, host: "127.0.0.1", port: 0,
  allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false,
  passwordAuthEnabled: true, passwordRegistrationEnabled: false, simulatedAuthEnabled: false,
  internalLabEnabled: false, retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 });

async function actualOwner(f: SavedMemoryFixture, pool: Pool = f.pool) {
  const renewalSecret = randomBytes(32).toString("base64url");
  const enrolled = await f.request({ method: "POST", url: "/v1/auth/persistent/enroll",
    payload: { renewal_secret: renewalSecret, client_kind: "web" } });
  expect(enrolled.statusCode).toBe(200); // Credential-bearing response is never formatted by assertions.
  const login = enrolled.json<SessionResponse>();
  if (!login.session_id) throw new Error("The actual enrollment omitted its login identity.");
  const auth: AuthContext = { accountId: login.account.id, accountSlug: login.account.slug,
    userId: login.user.id, userEmail: login.user.email, userKind: login.user.kind, sessionId: login.session_id };
  const owner = await admitLegacyChatAuthority(pool, auth, `Bearer ${login.access_token}`, config());
  return { owner, auth, renewalSecret };
}
async function actualSource(f: SavedMemoryFixture) {
  const objective = "Synthetic actual source for the private joint owner gate.";
  const created = await f.post({ idempotency_key: randomUUID(), objective });
  expect(created.statusCode).toBe(201);
  const sessionID = randomUUID();
  await f.saveAnswer(sessionID, objective, created.json<UnscopedChatTaskResponse>());
  return sessionID;
}
async function bound(f: SavedMemoryFixture, owner: LegacyChatAuthority, auth: AuthContext, sessionID?: string) {
  const source = await createHarnessSourceGuardWithBinding(f.pool, auth, sessionID,
    () => ({ expiresAt: new Date(Date.now() + 60_000), personIDs: [] }));
  const handle = await bindLegacySavedMemoryRun(owner, { auth, source: source.source, guard: source.guard,
    taskID: randomUUID(), runID: randomUUID(), runDeadlineMonotonicMs: performance.now() + 30_000 });
  return { handle, run: accessLegacySavedMemoryRun(handle, owner, auth) };
}

describe.skipIf(!savedMemoryDatabase)("Legacy credential + original source + prospective Memory at one fresh tick", { concurrent: false }, () => {
  it("keeps the original accepted login live through a real rotation, then rejects its expired previous branch", async () => {
    await withSavedMemoryFixture(async f => {
      const { owner, auth, renewalSecret } = await actualOwner(f);
      let sidecar: Awaited<ReturnType<typeof buildApp>> | undefined;
      try {
        const { run } = await bound(f, owner, auth);
        expect((await run.finalizeProof(run.reads.snapshot())).available).toBe(true);
        // Normal renewal endpoint, not a fabricated token hash/accepted slot.
        sidecar = await buildApp({ pool: f.pool, config: config(), remoteChatProvider: null,
          personResearchProvider: null, privateConversationProvider: null, labProviders: new Map(),
          labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false, labCIVerifier: null, screenshotContact: null });
        await sidecar.ready();
        const renewed = await sidecar.inject({ method: "POST", url: "/v1/auth/persistent/renew",
          payload: { renewal_secret: renewalSecret, account_id: auth.accountId, user_id: auth.userId, session_id: auth.sessionId } });
        expect(renewed.statusCode).toBe(200);
        expect((await run.finalizeProof(run.reads.snapshot())).available).toBe(true);
        const expired = await f.pool.query(`UPDATE sessions SET previous_token_expires_at=clock_timestamp()-interval '1 second'
          WHERE account_id=$1 AND user_id=$2 AND id=$3 AND previous_token_hash IS NOT NULL`, [auth.accountId, auth.userId, auth.sessionId]);
        expect(expired.rowCount).toBe(1);
        await expect(run.assertCurrent()).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(owner.signal.aborted).toBe(true);
        let invoked = false;
        await expect(owner.provider(async () => { invoked = true; return "must not become201"; })).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(invoked).toBe(false);
      } finally { owner.dispose(); await sidecar?.close(); }
    });
  }, 15_000);

  it("rejects a withdrawn real accepted Memory despite an already-held repeatable-read transaction", async () => {
    await withSavedMemoryFixture(async f => {
      const memory = await f.acceptSelf("My synthetic joint-gate notebook has a copper cover.");
      const { owner, auth } = await actualOwner(f), client = await f.pool.connect();
      try {
        const { run } = await bound(f, owner, auth);
        const tracked = await recallMemoriesTracked(f.pool, auth, { surface: "chat", scope: "self" });
        const selected = tracked.originalStamps.filter(s => s.item_id === memory.itemID);
        expect(selected).toHaveLength(1);
        const proof = captureSavedMemoryReadProof({ ...run.reads.snapshot(), stamps: selected });
        expect((await run.finalizeProof(proof)).available).toBe(true);
        run.reads.admit(selected);
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        expect((await client.query("SELECT status FROM memory_items WHERE account_id=$1 AND id=$2", [auth.accountId, memory.itemID])).rows[0]?.status).toBe("active");
        const withdrawal = await f.request({ method: "POST", url: `/v1/memory/items/${memory.itemID}/mutations`, payload: {
          operation: "delete", expected_version: memory.version, idempotency_key: randomUUID(), reason: "Synthetic explicit withdrawal." } });
        expect(withdrawal.statusCode).toBe(200);
        expect(await f.current()).toBe(200);
        // The old snapshot really still sees active. The bound owner must use
        // its independent pool SELECT instead of this long transaction.
        expect((await client.query("SELECT status FROM memory_items WHERE account_id=$1 AND id=$2", [auth.accountId, memory.itemID])).rows[0]?.status).toBe("active");
        await expect(owner.withClient(client, async () => { await run.assertCurrent(); }))
          .rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(owner.signal.aborted).toBe(true);
      } finally { await client.query("ROLLBACK"); client.release(); owner.dispose(); }
    });
  }, 15_000);

  it("rechecks the actual source Session and permanently aborts after its normal HTTP deletion", async () => {
    await withSavedMemoryFixture(async f => {
      const sessionID = await actualSource(f), { owner, auth } = await actualOwner(f);
      try {
        const { run } = await bound(f, owner, auth, sessionID);
        expect((await run.finalizeProof(run.reads.snapshot())).available).toBe(true);
        const removed = await f.request({ method: "DELETE", url: `/v1/agent-sessions/${sessionID}`,
          payload: { expected_revision: 1, idempotency_key: randomUUID() } });
        expect(removed.statusCode).toBe(200); expect(await f.current()).toBe(200);
        await expect(run.assertCurrent()).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(owner.signal.aborted).toBe(true);
      } finally { owner.dispose(); }
    });
  }, 15_000);

  it("keeps every actually exposed search domain in the next joint instead of validating only the new read", async () => {
    await withSavedMemoryFixture(async f => {
      const memory = await f.acceptSelf("My synthetic lexical-joint-needle notebook is copper.");
      const { owner, auth } = await actualOwner(f);
      try {
        const { run } = await bound(f, owner, auth);
        let charged = 0;
        const page = await searchSavedMemory({ pool: f.pool, database: f.pool, authority: run.authority, reads: run.reads,
          remainingContextCharacters: () => 24_000 - charged,
          chargeContextCharacters: n => { charged += n; return charged <= 24_000; }, finalizeRead: run.finalizeRead },
        { terms: ["lexical-joint-needle"], limit: 10 });
        expect(page.items.map(item => item.id)).toContain(memory.itemID);
        expect((await run.finalizeProof(run.reads.snapshot())).available).toBe(true);
        const expired = await f.pool.query(`UPDATE memory_discovery_queries SET expires_at=clock_timestamp()-interval '1 second'
          WHERE account_id=$1 AND reader_actor_id=$2`, [auth.accountId, auth.userId]);
        expect(expired.rowCount).toBe(1);
        await expect(run.finalizeProof(run.reads.snapshot())).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(owner.signal.aborted).toBe(true);
      } finally { owner.dispose(); }
    });
  }, 15_000);

  it("charges a real final-query ACK delay against the original Core budget without replacing its rows", async () => {
    await withSavedMemoryFixture(async f => {
      let holdACK = false;
      // Real SQL and rows are unchanged; only delivery of this test-owned
      // client's actual final result is delayed to model a slow ACK.
      const pool = new Proxy(f.pool, { get(target, key) {
        if (key === "query") return async (...args: unknown[]) => {
          const result: unknown = await Reflect.apply(target.query, target, args);
          if (holdACK && typeof args[0] === "string" && args[0].includes("AS read_until")) await delay(2200);
          return result;
        };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const { owner, auth } = await actualOwner(f, pool);
      try {
        const source = await createHarnessSourceGuardWithBinding(f.pool, auth, undefined,
          () => ({ expiresAt: new Date(Date.now() + 60_000), personIDs: [] }));
        const handle = await bindLegacySavedMemoryRun(owner, { auth, source: source.source, guard: source.guard,
          taskID: randomUUID(), runID: randomUUID(), runDeadlineMonotonicMs: performance.now() + 2000 });
        const run = accessLegacySavedMemoryRun(handle, owner, auth);
        expect((await run.finalizeProof(run.reads.snapshot())).available).toBe(true);
        holdACK = true;
        await expect(run.finalizeProof(run.reads.snapshot())).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(owner.signal.aborted).toBe(true);
      } finally { owner.dispose(); }
    });
  }, 15_000);

  it("refuses forged owner identities and the new Lab branch after real Lab entry/authentication", async () => {
    await withSavedMemoryFixture(async f => {
      const directory = await mkdtemp(join(tmpdir(), "get455-private-lab-"));
      const service = new LabWorkspaceService(f.pool, new LocalChatMediaStorage(directory), 3_600);
      const workspaceID = randomUUID();
      let labOwner: LegacyChatAuthority | undefined, sidecar: Awaited<ReturnType<typeof buildApp>> | undefined;
      let created = false;
      try {
        await service.create(f.auth, { id: workspaceID, duration_hours: 1 }); created = true;
        const token = randomBytes(32).toString("base64url");
        const entry = await service.enter(f.auth, workspaceID, { id: randomUUID(), access_token: token });
        expect(entry.state).toBe("active");
        let labAuth: AuthContext | undefined;
        sidecar = await buildApp({ pool: f.pool, config: config(), remoteChatProvider: null,
          personResearchProvider: null, privateConversationProvider: null, labProviders: new Map(),
          labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false, labCIVerifier: null, screenshotContact: null });
        sidecar.get("/__get455_private_lab_identity", { preHandler: createAuthGuard(f.pool, undefined, config()) },
          async request => { labAuth = request.auth; return { accepted: true }; });
        await sidecar.ready();
        expect((await sidecar.inject({ method: "GET", url: "/__get455_private_lab_identity",
          headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
        const capturedAuth = (): AuthContext | undefined => labAuth;
        const actualLab = capturedAuth();
        if (!actualLab) throw new Error("The real Lab authenticator did not provide its identity.");
        labOwner = await admitLegacyChatAuthority(f.pool, actualLab, `Bearer ${token}`, config());
        await labOwner.assertCurrent(); // Existing unbound Lab remains lawful.
        const source = await createHarnessSourceGuardWithBinding(f.pool, actualLab, undefined,
          () => ({ expiresAt: new Date(Date.now() + 30_000), personIDs: [] }));
        const input = { auth: actualLab, taskID: randomUUID(), runID: randomUUID(), source: source.source,
          guard: source.guard, runDeadlineMonotonicMs: performance.now() + 20_000 };
        await expect(bindLegacySavedMemoryRun({ ...labOwner }, input)).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(labOwner.signal.aborted).toBe(false);
        await expect(bindLegacySavedMemoryRun(labOwner, input)).rejects.toBeInstanceOf(LegacyChatTerminated);
        expect(labOwner.signal.aborted).toBe(true);
      } finally {
        labOwner?.dispose(); await sidecar?.close();
        try { if (created) await service.stop(f.auth, workspaceID, randomUUID()); }
        finally { await rm(directory, { recursive: true, force: true }); }
      }
    });
  }, 15_000);
});
