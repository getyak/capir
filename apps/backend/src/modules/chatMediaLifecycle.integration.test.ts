import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "./auth.js";
import { createChatMediaAsset, deleteChatMediaAsset, getChatMediaContent, reconcileChatMediaUpload, uploadChatMediaContent } from "./chatMedia.js";
import { inspectDeletedChatMedia, reconcileStoppedLabUpload } from "./chatMediaMaintenance.js";
import { LocalChatMediaStorage, S3ChatMediaStorage, type ChatMediaStorage } from "./chatMediaStorage.js";

const databaseURL = process.env.CHAT_MEDIA_TEST_DATABASE_URL;
if (databaseURL && !["localhost", "127.0.0.1"].includes(new URL(databaseURL).hostname)) {
  throw new Error("Use a disposable loopback media proof database.");
}
const pool = databaseURL ? new Pool({ connectionString: databaseURL, max: 3 }) : null;
const secondPool = databaseURL ? new Pool({ connectionString: databaseURL, max: 3 }) : null;
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await Promise.all([pool?.end(), secondPool?.end()]); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(storage: ChatMediaStorage) {
  const accountId = randomUUID(), userId = randomUUID(), personId = randomUUID(), relationshipId = randomUUID();
  await pool!.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic media lifecycle')", [accountId, `media-${accountId}`]);
  await pool!.query("INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Synthetic','simulated_human')", [userId, accountId, `${userId}@example.test`]);
  await pool!.query("INSERT INTO subjects(id,account_id,external_ref,display_label) VALUES($1,$2,$3,'Synthetic')", [personId, accountId, personId]);
  await pool!.query("INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label) VALUES($1,$2,$3,$4,'Synthetic')", [relationshipId, accountId, personId, relationshipId]);
  const auth = { accountId, userId, userKind: "simulated_human" } as AuthContext;
  const media = await createChatMediaAsset(pool!, auth, storage, {
    idempotency_key: randomUUID(), person_id: personId, relationship_context_id: relationshipId,
    file_name: "synthetic.png", media_type: "image/png", byte_size: 1,
  });
  return { auth, media };
}

// Controlled storage is the external boundary; account scoping, admission,
// transactions, deletion and audits all use actual PostgreSQL/domain code.
describe.skipIf(!pool)("Chat media upload/delete lifecycle", () => {
  it("refuses deletion while another database client owns an unfinished PUT, then purges on retry", async () => {
    const started = deferred(), finish = deferred();
    let present = false;
    const storage: ChatMediaStorage = {
      provider: "s3", labScopeID: "synthetic-store",
      async put() { started.resolve(); await finish.promise; present = true; },
      async get() { return { body: new Uint8Array([1]), contentType: "image/png" }; },
      async delete() { throw new Error("A versioned object needs permanent purge"); },
      async purge() { present = false; },
    };
    const { auth, media } = await fixture(storage);
    const upload = uploadChatMediaContent(pool!, auth, storage, media.id, new Uint8Array([1]), "image/png");
    await started.promise;
    try {
      await expect(deleteChatMediaAsset(secondPool!, auth, storage, media.id)).rejects.toMatchObject({
        code: "CHAT_MEDIA_WRITE_UNSETTLED", statusCode: 503,
      });
    } finally { finish.resolve(); await upload; }
    expect(present).toBe(true);
    await expect(deleteChatMediaAsset(secondPool!, auth, storage, media.id)).resolves.toEqual({ id: media.id, status: "deleted" });
    expect(present).toBe(false);
    await expect(deleteChatMediaAsset(pool!, auth, storage, media.id)).resolves.toEqual({ id: media.id, status: "deleted" });
    const audit = await pool!.query("SELECT event_type FROM audit_events WHERE account_id=$1 AND entity_id=$2 AND event_type='chat_media.deleted'", [auth.accountId, media.id]);
    expect(audit.rowCount).toBe(1);
  });

  it("never dispatches bytes after deletion wins admission", async () => {
    let puts = 0;
    const storage: ChatMediaStorage = { provider: "local", async put() { puts++; }, async delete() {}, async get() { throw new Error("unused"); } };
    const { auth, media } = await fixture(storage);
    await deleteChatMediaAsset(pool!, auth, storage, media.id);
    await expect(uploadChatMediaContent(secondPool!, auth, storage, media.id, new Uint8Array([1]), "image/png"))
      .rejects.toMatchObject({ code: "CHAT_MEDIA_DELETED" });
    expect(puts).toBe(0);
  });

  it("dispatches only one PUT for simultaneous retry and reuses a ready receipt", async () => {
    const started = deferred(), finish = deferred();
    let puts = 0;
    const storage: ChatMediaStorage = { provider: "local", async put() { puts++; started.resolve(); await finish.promise; }, async delete() {}, async get() { throw new Error("unused"); } };
    const { auth, media } = await fixture(storage);
    const first = uploadChatMediaContent(pool!, auth, storage, media.id, new Uint8Array([1]), "image/png");
    await started.promise;
    try {
      await expect(uploadChatMediaContent(secondPool!, auth, storage, media.id, new Uint8Array([1]), "image/png"))
        .rejects.toMatchObject({ code: "CHAT_MEDIA_WRITE_UNSETTLED" });
    } finally { finish.resolve(); await first; }
    await expect(uploadChatMediaContent(secondPool!, auth, storage, media.id, new Uint8Array([1]), "image/png"))
      .resolves.toMatchObject({ id: media.id, status: "ready" });
    expect(puts).toBe(1);
  });

  it("keeps a failed remote PUT fenced until matching late completion is observed, then deletion retry purges it", async () => {
    let attempt = "", present = false, purges = 0;
    const storage: ChatMediaStorage = {
      provider: "s3", labScopeID: "synthetic-store",
      async put(_key, _body, _type, id) { attempt = id!; throw new Error("PRIVATE_TRANSPORT_CANARY"); },
      async verifyUpload(_key, id, bytes, type) { return present && id === attempt && bytes === 1 && type === "image/png"; },
      async purge() { purges++; present = false; }, async delete() { throw new Error("unused"); }, async get() { throw new Error("unused"); },
    };
    const { auth, media } = await fixture(storage);
    await expect(uploadChatMediaContent(pool!, auth, storage, media.id, new Uint8Array([1]), "image/png"))
      .rejects.toMatchObject({ code: "CHAT_MEDIA_STORAGE_FAILED" });
    await expect(deleteChatMediaAsset(secondPool!, auth, storage, media.id)).rejects.toMatchObject({ code: "CHAT_MEDIA_WRITE_UNSETTLED" });
    await pool!.query("UPDATE chat_media_assets SET upload_started_at=now()-interval '30 days' WHERE id=$1", [media.id]);
    await expect(deleteChatMediaAsset(secondPool!, auth, storage, media.id)).rejects.toMatchObject({ code: "CHAT_MEDIA_WRITE_UNSETTLED" });
    expect(purges).toBe(0);
    present = true; // The one remote request eventually finishes after its response was lost.
    await expect(deleteChatMediaAsset(secondPool!, auth, storage, media.id)).resolves.toMatchObject({ status: "deleted" });
    expect(present).toBe(false); expect(purges).toBe(1);
    const row = (await pool!.query("SELECT upload_state,failure_reason FROM chat_media_assets WHERE id=$1", [media.id])).rows[0];
    expect(row.upload_state).toBe("idle");
    const audit = await pool!.query("SELECT metadata FROM audit_events WHERE account_id=$1 AND entity_id=$2", [auth.accountId, media.id]);
    expect(JSON.stringify(audit.rows)).not.toContain("PRIVATE_TRANSPORT_CANARY");
    expect((await pool!.query("SELECT 1 FROM audit_events WHERE entity_id=$1 AND event_type='chat_media.uploaded'", [media.id])).rowCount).toBe(0);
  });

  it("retries a settled local failure with the same identity", async () => {
    let puts = 0;
    const storage: ChatMediaStorage = { provider: "local", async put() { if (++puts === 1) throw new Error("PRIVATE_LOCAL_CANARY"); }, async delete() {}, async get() { throw new Error("unused"); } };
    const { auth, media } = await fixture(storage);
    await expect(uploadChatMediaContent(pool!, auth, storage, media.id, new Uint8Array([1]), "image/png"))
      .rejects.toMatchObject({ code: "CHAT_MEDIA_STORAGE_FAILED" });
    await expect(uploadChatMediaContent(secondPool!, auth, storage, media.id, new Uint8Array([1]), "image/png"))
      .resolves.toMatchObject({ id: media.id, status: "ready" });
    expect(puts).toBe(2);
  });

  it("does not read or mutate another account or uploader's storage", async () => {
    let writes = 0;
    const storage: ChatMediaStorage = { provider: "local", async put() { writes++; }, async delete() { writes++; }, async get() { throw new Error("unused"); } };
    const { auth, media } = await fixture(storage);
    const other = await fixture(storage);
    for (const stranger of [other.auth, { ...auth, userId: other.auth.userId }]) {
      await expect(uploadChatMediaContent(secondPool!, stranger, storage, media.id, new Uint8Array([1]), "image/png"))
        .rejects.toMatchObject({ statusCode: stranger.accountId === auth.accountId ? 403 : 404 });
      await expect(deleteChatMediaAsset(secondPool!, stranger, storage, media.id))
        .rejects.toMatchObject({ statusCode: stranger.accountId === auth.accountId ? 403 : 404 });
    }
    expect(writes).toBe(0);
  });

  it("does not acknowledge deletion against a different storage provider", async () => {
    const local: ChatMediaStorage = { provider: "local", async put() {}, async delete() {}, async get() { throw new Error("unused"); } };
    const { auth, media } = await fixture(local);
    const other = { ...local, provider: "s3", labScopeID: "wrong-scope" } as ChatMediaStorage;
    await expect(deleteChatMediaAsset(secondPool!, auth, other, media.id)).rejects.toMatchObject({ code: "CHAT_MEDIA_STORAGE_CHANGED" });
    expect((await pool!.query("SELECT status FROM chat_media_assets WHERE id=$1", [media.id])).rows[0].status).toBe("pending");
  });


  it("builds historical inventory from committed uploader deletion intent without reading live objects", async () => {
    const inspected: string[] = [];
    const storage: ChatMediaStorage = {
      provider: "s3", labScopeID: "synthetic-store",
      async put() {}, async get() { throw new Error("Inventory cannot read pixels"); },
      async delete() { throw new Error("Inventory cannot delete"); }, async purge() {},
      async inspectVersions(key) { inspected.push(key); return { versions: 2, deleteMarkers: 1 }; },
    };
    const { auth, media } = await fixture(storage);
    const live = await fixture(storage);
    await deleteChatMediaAsset(pool!, auth, storage, media.id);
    const key = (await pool!.query("SELECT object_key FROM chat_media_assets WHERE id=$1", [media.id])).rows[0].object_key as string;
    const report = await inspectDeletedChatMedia(pool!, storage);
    expect(inspected).toContain(key);
    expect(inspected.some(value => value.endsWith(live.media.id))).toBe(false);
    expect(JSON.stringify(report)).not.toContain(auth.accountId);
    expect(JSON.stringify(report)).not.toContain(media.id);
    expect(report.retained_versions).toBeGreaterThanOrEqual(2);
  });


  it("refuses an operator recovery receipt for a different attempt", async () => {
    const storage: ChatMediaStorage = { provider: "s3", labScopeID: "synthetic-store", async put() { throw new Error("lost response"); },
      async verifyUpload() { return true; }, async purge() {}, async delete() {}, async get() { throw new Error("unused"); } };
    const { auth, media } = await fixture(storage);
    await expect(uploadChatMediaContent(pool!, auth, storage, media.id, new Uint8Array([1]), "image/png"))
      .rejects.toMatchObject({ code: "CHAT_MEDIA_STORAGE_FAILED" });
    await expect(reconcileChatMediaUpload(secondPool!, auth, storage, media.id, randomUUID()))
      .rejects.toMatchObject({ code: "CHAT_MEDIA_ATTEMPT_CHANGED" });
    expect((await pool!.query("SELECT upload_state FROM chat_media_assets WHERE id=$1", [media.id])).rows[0].upload_state).toBe("unknown");
  });


  it("settles a proven late PUT for a closing Lab workspace without reopening its deleted-data write gate", async () => {
    const scope = "a".repeat(64);
    const storage: ChatMediaStorage = { provider: "s3", labScopeID: scope, async put() { throw new Error("lost response"); },
      async verifyUpload() { return true; }, async purge() {}, async delete() {}, async get() { throw new Error("unused"); } };
    const owner = await fixture(storage), target = await fixture(storage), workspaceId = randomUUID();
    await pool!.query("UPDATE users SET kind='lab_human' WHERE account_id=$1 AND id=$2", [target.auth.accountId, target.auth.userId]);
    await pool!.query(`INSERT INTO lab_test_workspaces(id,owner_account_id,owner_user_id,target_account_id,target_user_id,
      duration_hours,expires_at,media_scope_hash) VALUES($1,$2,$3,$4,$5,1,now()+interval '1 hour',$6)`,
    [workspaceId, owner.auth.accountId, owner.auth.userId, target.auth.accountId, target.auth.userId, scope]);
    await expect(uploadChatMediaContent(pool!, { ...target.auth, userKind: "lab_human" }, storage,
      target.media.id, new Uint8Array([1]), "image/png")).rejects.toMatchObject({ code: "CHAT_MEDIA_STORAGE_FAILED" });
    const attempt = (await pool!.query("SELECT upload_attempt_id FROM chat_media_assets WHERE id=$1", [target.media.id])).rows[0].upload_attempt_id as string;
    await pool!.query("UPDATE lab_test_workspaces SET state='deleting',stop_id=$2,stop_reason='manual',stopped_at=now() WHERE id=$1", [workspaceId, randomUUID()]);
    await expect(reconcileStoppedLabUpload(secondPool!, storage, target.auth.accountId, target.media.id, attempt))
      .resolves.toMatchObject({ status: "workspace_cleanup_ready" });
    expect((await pool!.query("SELECT state FROM lab_test_workspace_media_writes WHERE id=$1", [attempt])).rows[0].state).toBe("settled");
    expect((await pool!.query("SELECT upload_state FROM chat_media_assets WHERE id=$1", [target.media.id])).rows[0].upload_state).toBe("unknown");
  });


  it("preserves an unfinished attempt after its writer process is killed and reconciles from a new pool", async () => {
    const storage: ChatMediaStorage = { provider: "s3", labScopeID: "synthetic-store", async put() {},
      async purge() {}, async delete() {}, async get() { throw new Error("unused"); }, async verifyUpload() { return false; } };
    const { auth, media } = await fixture(storage);
    const child = fork(new URL("./testSupport/chatMediaUploadCrash.mjs", import.meta.url), {
      execArgv: ["--import", createRequire(import.meta.url).resolve("tsx")],
      env: { ...process.env, DATABASE_URL: databaseURL!, CHAT_MEDIA_CRASH_CASE: JSON.stringify({ auth, mediaId: media.id }) },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const message = await Promise.race([
        once(child, "message").then(([value]) => value as { started: boolean; attemptId: string }),
        once(child, "exit").then(() => { throw new Error("Synthetic writer exited before PUT admission"); }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Synthetic writer admission timed out")), 20_000); }),
      ]);
      expect(message.started).toBe(true);
      const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
      const restarted = new Pool({ connectionString: databaseURL!, max: 2 });
      try {
        await expect(deleteChatMediaAsset(restarted, auth, storage, media.id)).rejects.toMatchObject({ code: "CHAT_MEDIA_WRITE_UNSETTLED" });
        const state = (await restarted.query("SELECT upload_state,upload_attempt_id FROM chat_media_assets WHERE id=$1", [media.id])).rows[0];
        expect(state).toMatchObject({ upload_state: "writing", upload_attempt_id: message.attemptId });
        await expect(reconcileChatMediaUpload(restarted, auth, { ...storage, async verifyUpload() { return true; } }, media.id, message.attemptId))
          .resolves.toMatchObject({ status: "settled" });
        await expect(deleteChatMediaAsset(restarted, auth, storage, media.id)).resolves.toMatchObject({ status: "deleted" });
      } finally { await restarted.end(); }
    } finally {
      if (timer) clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 30_000);


  it("enforces the fence through authenticated HTTP upload/delete routes", async () => {
    const { buildApp } = await import("../app.js");
    const started = deferred(), finish = deferred();
    let present = false;
    const storage: ChatMediaStorage = { provider: "local", async put() { started.resolve(); await finish.promise; present = true; },
      async delete() { present = false; }, async get() { return { body: new Uint8Array([1]), contentType: "image/png" }; } };
    const { auth, media } = await fixture(storage);
    const scope = (await pool!.query("SELECT subject_id,assignment_id FROM chat_media_assets WHERE id=$1", [media.id])).rows[0];
    const app = await buildApp({ pool: pool!, chatMediaStorage: storage,
      config: { databaseUrl: databaseURL!, host: "127.0.0.1", port: 0, allowedOrigins: [], appleSignInAudiences: [],
        appleSignInEnabled: false, passwordAuthEnabled: false, passwordRegistrationEnabled: false, simulatedAuthEnabled: true,
        internalLabEnabled: false, retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3600 },
      remoteChatProvider: null, privateConversationProvider: null, personResearchProvider: null, screenshotContact: null,
      conversationQueueWorkerEnabled: false, labJobWorkerEnabled: false,
    });
    try {
      const login = await app.inject({ method: "POST", url: "/v1/auth/simulated-login", payload: {
        account_slug: `media-${auth.accountId}`, user_email: `${auth.userId}@example.test`, client_label: "synthetic-media-proof",
      } });
      expect(login.statusCode).toBe(200);
      const authorization = `Bearer ${login.json().access_token}`;
      const staged = await app.inject({ method: "POST", url: "/v1/chat/media", headers: { authorization }, payload: {
        person_id: scope.subject_id, relationship_context_id: scope.assignment_id, idempotency_key: randomUUID(),
        file_name: "synthetic.png", media_type: "image/png", byte_size: 1,
      } });
      expect(staged.statusCode).toBe(201);
      const id = staged.json().id as string;
      expect((await app.inject({ method: "DELETE", url: `/v1/chat/media/${id}` })).statusCode).toBe(401);
      const uploading = app.inject({ method: "PUT", url: `/v1/chat/media/${id}/content`,
        headers: { authorization, "content-type": "image/png" }, payload: Buffer.from([1]) }).then(response => response);
      await started.promise;
      try {
        const deleting = await app.inject({ method: "DELETE", url: `/v1/chat/media/${id}`, headers: { authorization } });
        expect(deleting.statusCode).toBe(503);
        expect(deleting.json().error.code).toBe("CHAT_MEDIA_WRITE_UNSETTLED");
      } finally { finish.resolve(); }
      expect((await uploading).statusCode).toBe(200);
      expect((await app.inject({ method: "DELETE", url: `/v1/chat/media/${id}`, headers: { authorization } })).statusCode).toBe(200);
      expect(present).toBe(false);
      expect((await app.inject({ method: "GET", url: `/v1/chat/media/${id}/content`, headers: { authorization } })).statusCode).toBe(404);
    } finally { finish.resolve(); await app.close(); }
  }, 60_000);


  it("rejects a corrupted cross-owner object key before upload, read or deletion reaches storage", async () => {
    let storageCalls = 0;
    const storage: ChatMediaStorage = { provider: "local", async put() { storageCalls++; }, async delete() { storageCalls++; },
      async get() { storageCalls++; return { body: new Uint8Array([1]), contentType: "image/png" }; } };
    const { auth, media } = await fixture(storage);
    const other = await fixture(storage);
    await pool!.query("UPDATE chat_media_assets SET object_key=$2 WHERE id=$1", [media.id, `${other.auth.accountId}/another-person/${media.id}`]);
    await expect(uploadChatMediaContent(secondPool!, auth, storage, media.id, new Uint8Array([1]), "image/png"))
      .rejects.toMatchObject({ code: "CHAT_MEDIA_STORAGE_OWNER_MISMATCH" });
    await expect(deleteChatMediaAsset(secondPool!, auth, storage, media.id)).rejects.toMatchObject({ code: "CHAT_MEDIA_STORAGE_OWNER_MISMATCH" });
    await pool!.query("UPDATE chat_media_assets SET status='ready' WHERE id=$1", [media.id]);
    await expect(getChatMediaContent(secondPool!, auth, storage, media.id)).rejects.toMatchObject({ code: "CHAT_MEDIA_STORAGE_OWNER_MISMATCH" });
    expect(storageCalls).toBe(0);
  });


  it.each([[403, "AccessDenied"], [400, "ExpiredToken"]] as const)("retries or deletes after a trusted terminal S3 receipt (%s/%s)", async (status, code) => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "synthetic-only"); vi.stubEnv("AWS_SECRET_ACCESS_KEY", "synthetic-only");
    vi.stubEnv("AWS_SESSION_TOKEN", "synthetic-only"); vi.stubEnv("AWS_PROFILE", undefined); vi.stubEnv("AWS_DEFAULT_PROFILE", undefined);
    let allowed = false, puts = 0;
    const server = createServer((request, response) => {
      request.resume();
      if (request.method === "PUT") {
        puts++;
        response.writeHead(allowed ? 200 : status, { "Content-Type": "application/xml", "x-amz-request-id": `synthetic-request-${puts}` });
        response.end(allowed ? "" : `<Error><Code>${code}</Code><Message>PRIVATE_REJECTION_CANARY</Message></Error>`);
      } else if (request.method === "HEAD") { response.writeHead(404); response.end(); }
      else { response.writeHead(200, { "Content-Type": "application/xml" }); response.end('<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated></ListVersionsResult>'); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const storage = new S3ChatMediaStorage("synthetic", { region: "test-1", forcePathStyle: true,
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
      const deleted = await fixture(storage);
      await expect(uploadChatMediaContent(pool!, deleted.auth, storage, deleted.media.id, new Uint8Array([1]), "image/png"))
        .rejects.toMatchObject({ code: "CHAT_MEDIA_STORAGE_FAILED" });
      const failed = (await pool!.query("SELECT upload_state,upload_settlement_receipt,failure_reason FROM chat_media_assets WHERE id=$1", [deleted.media.id])).rows[0];
      expect(failed.upload_state).toBe("idle");
      expect(failed.upload_settlement_receipt).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(failed)).not.toContain("PRIVATE_REJECTION_CANARY");
      await expect(deleteChatMediaAsset(secondPool!, deleted.auth, storage, deleted.media.id)).resolves.toMatchObject({ status: "deleted" });
      const retry = await fixture(storage);
      await expect(uploadChatMediaContent(pool!, retry.auth, storage, retry.media.id, new Uint8Array([1]), "image/png"))
        .rejects.toMatchObject({ code: "CHAT_MEDIA_STORAGE_FAILED" });
      allowed = true;
      await expect(uploadChatMediaContent(secondPool!, retry.auth, storage, retry.media.id, new Uint8Array([1]), "image/png"))
        .resolves.toMatchObject({ id: retry.media.id, status: "ready" });
      expect(puts).toBe(3);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 30_000);


  it.each(["after_put", "before_put"] as const)("recovers local %s interruption from a killed writer without an elapsed-time lease", async phase => {
    const directory = await mkdtemp(join(tmpdir(), "capir-local-crash-"));
    const storage = new LocalChatMediaStorage(directory);
    const { auth, media } = await fixture(storage);
    const child = fork(new URL("./testSupport/chatMediaUploadCrash.mjs", import.meta.url), {
      execArgv: ["--import", createRequire(import.meta.url).resolve("tsx")],
      env: { ...process.env, DATABASE_URL: databaseURL!, CHAT_MEDIA_CRASH_CASE: JSON.stringify({ auth, mediaId: media.id, localDirectory: directory, phase }) },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const message = await Promise.race([
        once(child, "message").then(([value]) => value as { attemptId: string }),
        once(child, "exit").then(() => { throw new Error("Local writer exited before its checkpoint"); }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Local writer checkpoint timed out")), 20_000); }),
      ]);
      const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
      await expect(reconcileChatMediaUpload(secondPool!, auth, storage, media.id, message.attemptId,
        { cancelLocal: phase === "before_put" })).resolves.toMatchObject({ status: "settled" });
      await expect(uploadChatMediaContent(secondPool!, auth, storage, media.id, new Uint8Array([1]), "image/png"))
        .resolves.toMatchObject({ id: media.id, status: "ready" });
      const key = (await pool!.query("SELECT object_key FROM chat_media_assets WHERE id=$1", [media.id])).rows[0].object_key as string;
      expect(Array.from((await getChatMediaContent(pool!, auth, storage, media.id)).body)).toEqual([1]);
      await deleteChatMediaAsset(pool!, auth, storage, media.id);
      expect(await storage.existsForLab(key)).toBe(false);
    } finally {
      if (timer) clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);


  it("keeps a retryable S3 5xx response unresolved even if its error name resembles a terminal refusal", async () => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "synthetic-only"); vi.stubEnv("AWS_SECRET_ACCESS_KEY", "synthetic-only");
    vi.stubEnv("AWS_SESSION_TOKEN", "synthetic-only"); vi.stubEnv("AWS_PROFILE", undefined); vi.stubEnv("AWS_DEFAULT_PROFILE", undefined);
    const server = createServer((request, response) => {
      request.resume(); response.writeHead(request.method === "PUT" ? 503 : 404,
        { "Content-Type": "application/xml", "x-amz-request-id": "synthetic-ambiguous-response" });
      response.end(request.method === "PUT" ? "<Error><Code>AccessDenied</Code></Error>" : "");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const storage = new S3ChatMediaStorage("synthetic", { region: "test-1", forcePathStyle: true,
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
      const { auth, media } = await fixture(storage);
      await expect(uploadChatMediaContent(pool!, auth, storage, media.id, new Uint8Array([1]), "image/png"))
        .rejects.toMatchObject({ code: "CHAT_MEDIA_STORAGE_FAILED" });
      expect((await pool!.query("SELECT upload_state FROM chat_media_assets WHERE id=$1", [media.id])).rows[0].upload_state).toBe("unknown");
      await expect(deleteChatMediaAsset(secondPool!, auth, storage, media.id)).rejects.toMatchObject({ code: "CHAT_MEDIA_WRITE_UNSETTLED" });
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 30_000);

});
