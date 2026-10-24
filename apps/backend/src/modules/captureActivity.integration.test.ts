import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import Fastify from "fastify";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createAuthGuard, type AuthContext } from "./auth.js";
import { CaptureActivityService } from "./captureActivityService.js";
import { decryptActivityToken, type CapturePushResult } from "./captureActivity.js";
import { admitBackgroundCapture, registerCaptureAdmissionRoutes, type CaptureAdmissionRequest } from "./captureAdmission.js";
import { mutateAgentSession } from "./agentSessions.js";

// This suite must never mutate a resident database. The caller owns a fresh,
// fully migrated disposable PostgreSQL database, as for the queue integration suite.
const databaseURL = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (databaseURL && !["127.0.0.1", "localhost"].includes(new URL(databaseURL).hostname)) {
  throw new Error("Capture Activity integration tests require isolated loopback PostgreSQL.");
}
const pool = databaseURL ? new Pool({ connectionString: databaseURL, max: 3, connectionTimeoutMillis: 5000, query_timeout: 10000 }) : null;
const suite = pool ? describe : describe.skip;
// Real database and HTTP admission share a loaded host with native acceptance.
// Keep assertions unchanged, with the same bounded budget as the queue suite.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const accounts: string[] = [];
const config = { keyID: "ABCDEFGHIJ", teamID: "ABCDEFGHIJ", privateKey: "synthetic-integration-storage-key", environment: "production" as const, bundleID: "com.talentsignal.app" };

afterEach(async () => {
  for (const account of accounts.splice(0)) {
    const tables = (await pool!.query<{ table_name: string }>("SELECT table_name FROM lab_test_workspace_table_manifest WHERE scope='account' ORDER BY table_name")).rows.map(row => row.table_name);
    const targets = [...tables, "sessions"];
    await pool!.query(`WITH ${targets.map((table, i) => `d${i} AS (DELETE FROM "${table}" WHERE account_id=$1 RETURNING 1)`).join(",")} SELECT 1`, [account]);
    await pool!.query("DELETE FROM users WHERE account_id=$1", [account]);
    await pool!.query("DELETE FROM accounts WHERE id=$1", [account]);
  }
});
afterAll(async () => { await pool?.end(); });

async function seed() {
  const account = randomUUID(), user = randomUUID(), session = randomUUID(), message = randomUUID(), instance = randomUUID(), entry = randomUUID();
  accounts.push(account);
  const auth: AuthContext = { accountId: account, userId: user, sessionId: randomUUID(), accountSlug: `capture-${account}`, userEmail: `${user}@example.invalid`, userKind: "simulated_human" };
  const token = randomUUID();
  await pool!.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic capture proof')", [account, auth.accountSlug]);
  await pool!.query("INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Synthetic capture proof','simulated_human')", [user, account, auth.userEmail]);
  await pool!.query("INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'Synthetic capture proof',now()+interval '1 hour')", [auth.sessionId, account, user, createHash("sha256").update(token).digest("hex")]);
  const now = new Date().toISOString();
  const payload = { id: session, scopeKind: "unresolved_intent", personDisplayLabel: "", contextDisplayLabel: "", title: "", turns: [], createdAt: now, updatedAt: now };
  await pool!.query("INSERT INTO agent_sessions(account_id,id,created_by_user_id,revision,payload,created_at,expires_at) VALUES($1,$2,$3,1,$4::jsonb,now(),now()+interval '1 day')", [account, session, user, JSON.stringify(payload)]);
  await pool!.query("INSERT INTO conversation_queue_entries(account_id,session_id,id,message_id,created_by_user_id,auth_session_id,sequence,status,objective,idempotency_key,expires_at) VALUES($1,$2,$3,$4,$5,$6,1,'queued','',$7,now()+interval '1 day')", [account, session, entry, message, user, auth.sessionId, `capture:${message}`]);
  await pool!.query("INSERT INTO conversation_queue_state(account_id,session_id,revision,next_sequence) VALUES($1,$2,1,2)", [account, session]);
  const pixels = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFoQAAAAASUVORK5CYII=", "base64");
  await pool!.query("INSERT INTO conversation_message_images(account_id,session_id,message_id,queue_entry_id,image_index,attachment_id,file_name,media_type,byte_size,content_hash,content,expires_at) VALUES($1,$2,$3,$4,0,$5,'synthetic.png','image/png',$6,$7,$8,now()+interval '1 day')", [account, session, message, entry, randomUUID(), pixels.length, createHash("sha256").update(pixels).digest("hex"), pixels]);
  const input = (generation: number, token = String(generation).repeat(64)) => ({ message_id: message, activity_instance_id: instance, token, token_generation: generation, environment: "production" });
  const row = async () => (await pool!.query("SELECT * FROM capture_activity_registrations WHERE account_id=$1", [account])).rows[0];
  return { account, user, session, message, instance, auth, token, input, row };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function captureRequest(): CaptureAdmissionRequest {
  const id = randomUUID(), now = new Date().toISOString();
  const pixels = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFoQAAAAASUVORK5CYII=", "base64");
  return { session_operation_id: randomUUID(), initial_session: {
    id, scopeKind: "unresolved_intent", personDisplayLabel: "", contextDisplayLabel: "", title: "Screenshot", turns: [], createdAt: now, updatedAt: now, isUnread: true,
  }, message: { session_id: id, message_id: randomUUID(), idempotency_key: randomUUID(), objective: "", images: [{
    attachment_id: randomUUID(), file_name: "synthetic.png", media_type: "image/png", byte_size: pixels.length,
    content_hash: createHash("sha256").update(pixels).digest("hex"), data_base64: pixels.toString("base64"),
  }] } };
}

suite("single-request background capture admission", () => {
  it("registers an available Activity token in the same authenticated source request", async () => {
    const s = await seed(), input = captureRequest(), instance = randomUUID();
    input.capture_activity = { activity_instance_id: instance, token: "a".repeat(64), token_generation: 1, environment: "production" };
    const service = new CaptureActivityService(pool!, config, { send: async () => ({ accepted: true, invalidToken: false }) });
    const app = Fastify({ logger: false });
    registerCaptureAdmissionRoutes(app, pool!, createAuthGuard(pool!), service);
    try {
      const response = await app.inject({ method: "POST", url: `/v1/capture-admissions/${input.initial_session.id}`, headers: { authorization: `Bearer ${s.token}` }, payload: input });
      expect(response.statusCode).toBe(202);
      await service.pump();
      const row = await s.row();
      expect(row.session_id).toBe(input.initial_session.id);
      expect(row.message_id).toBe(input.message.message_id);
      expect(row.activity_instance_id).toBe(instance);
      expect(Number(row.token_generation)).toBe(1);
    } finally { await app.close(); }
  });

  it("preserves the admitted source receipt when optional push registration is rejected", async () => {
    const s = await seed(), input = captureRequest();
    input.capture_activity = { activity_instance_id: randomUUID(), token: "a".repeat(64), token_generation: 1, environment: "sandbox" };
    const service = new CaptureActivityService(pool!, config, { send: async () => { throw new Error("Unexpected provider call"); } });
    const app = Fastify({ logger: false });
    registerCaptureAdmissionRoutes(app, pool!, createAuthGuard(pool!), service);
    try {
      const response = await app.inject({ method: "POST", url: `/v1/capture-admissions/${input.initial_session.id}`, headers: { authorization: `Bearer ${s.token}` }, payload: input });
      expect(response.statusCode).toBe(202);
      expect(response.json().message_id).toBe(input.message.message_id);
      expect(await s.row()).toBeUndefined();
      expect((await pool!.query("SELECT id FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2", [s.account, input.initial_session.id])).rowCount).toBe(1);
    } finally { await app.close(); }
  });

  it("authenticates the actual HTTP route, validates its body and rejects a revoked-login replay", async () => {
    const s = await seed(), input = captureRequest(), url = `/v1/capture-admissions/${input.initial_session.id}`;
    const app = Fastify({ logger: false });
    registerCaptureAdmissionRoutes(app, pool!, createAuthGuard(pool!));
    try {
      expect((await app.inject({ method: "POST", url, payload: input })).statusCode).toBe(401);
      const headers = { authorization: `Bearer ${s.token}` };
      const invalid = structuredClone(input);
      invalid.message.session_id = randomUUID();
      expect((await app.inject({ method: "POST", url, headers, payload: invalid })).statusCode).toBe(422);
      const accepted = await app.inject({ method: "POST", url, headers, payload: input });
      expect(accepted.statusCode).toBe(202);
      expect(accepted.json().message_id).toBe(input.message.message_id);
      expect(accepted.json().session_id).toBe(input.initial_session.id);
      await pool!.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [s.auth.sessionId]);
      expect((await app.inject({ method: "POST", url, headers, payload: input })).statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it("creates the exact Session and admits once, including replay after a lost response", async () => {
    const s = await seed(), input = captureRequest(), id = input.initial_session.id;
    const first = await admitBackgroundCapture(pool!, s.auth, id, input);
    const replay = await admitBackgroundCapture(pool!, s.auth, id, input);
    expect(first.response.session_id).toBe(id);
    expect(first.response.message_id).toBe(input.message.message_id);
    expect(replay.replayed).toBe(true);
    expect(replay.response.queue_entry_id).toBe(first.response.queue_entry_id);
    const entries = await pool!.query("SELECT id FROM conversation_queue_entries WHERE account_id=$1 AND session_id=$2", [s.account, id]);
    expect(entries.rowCount).toBe(1);
  });

  it("continues the original image when foreground creation wins the race", async () => {
    const s = await seed(), input = captureRequest(), id = input.initial_session.id;
    await mutateAgentSession(pool!, s.auth, id, { expected_revision: 0, idempotency_key: randomUUID(), payload: input.initial_session });
    const result = await admitBackgroundCapture(pool!, s.auth, id, input);
    expect(result.response.session_id).toBe(id);
    expect(result.response.message_id).toBe(input.message.message_id);
  });

  it("rejects a conflicting immutable Session creation time and changed screenshot replay", async () => {
    const s = await seed(), input = captureRequest(), id = input.initial_session.id;
    await mutateAgentSession(pool!, s.auth, id, { expected_revision: 0, idempotency_key: randomUUID(), payload: {
      ...input.initial_session, createdAt: new Date(Date.now() - 60000).toISOString(),
    } });
    await expect(admitBackgroundCapture(pool!, s.auth, id, input)).rejects.toMatchObject({ statusCode: 409 });
    const fresh = captureRequest();
    await admitBackgroundCapture(pool!, s.auth, fresh.initial_session.id, fresh);
    const changed = structuredClone(fresh);
    changed.message.images![0]!.attachment_id = randomUUID();
    await expect(admitBackgroundCapture(pool!, s.auth, fresh.initial_session.id, changed)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("never admits an image to a different owner or a deleted Session", async () => {
    const s = await seed(), input = captureRequest(), id = input.initial_session.id;
    const otherUser = randomUUID();
    await pool!.query("INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Other synthetic owner','simulated_human')", [otherUser, s.account, `${otherUser}@example.invalid`]);
    const otherAuth = { ...s.auth, userId: otherUser, sessionId: randomUUID() };
    await pool!.query("INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'Other synthetic owner',now()+interval '1 hour')", [otherAuth.sessionId, s.account, otherUser, createHash("sha256").update(randomUUID()).digest("hex")]);
    await admitBackgroundCapture(pool!, s.auth, id, input);
    await expect(admitBackgroundCapture(pool!, otherAuth, id, input)).rejects.toMatchObject({ statusCode: 404 });
    await mutateAgentSession(pool!, s.auth, id, { expected_revision: 1, idempotency_key: randomUUID() }, true);
    await expect(admitBackgroundCapture(pool!, s.auth, id, input)).rejects.toMatchObject({ statusCode: 410 });
  });
});

suite("capture Activity real database fencing", () => {
  it("removes retired capabilities before claiming work so they cannot block an active account", async () => {
    const retired = await seed(), active = await seed(), sent: string[] = [];
    const service = new CaptureActivityService(pool!, config, { send: async token => {
      sent.push(token); return { accepted: true, invalidToken: false };
    } });
    await service.register(retired.auth, retired.session, retired.input(1, "a".repeat(64)));
    await service.register(active.auth, active.session, active.input(1, "b".repeat(64)));
    await pool!.query("UPDATE accounts SET retired_at=now() WHERE id=$1", [retired.account]);
    await service.pump();
    expect(sent).toEqual(["b".repeat(64)]);
    expect(await retired.row()).toBeUndefined();
    expect(await active.row()).toBeDefined();
  });

  it("rejects an admitted late registration write after its account retires", async () => {
    const s = await seed();
    const service = new CaptureActivityService(pool!, config, { send: async () => ({ accepted: true, invalidToken: false }) });
    await service.register(s.auth, s.session, s.input(1));
    await pool!.query("UPDATE accounts SET retired_at=now() WHERE id=$1", [s.account]);
    await expect(pool!.query("UPDATE capture_activity_registrations SET next_attempt_at=now() WHERE account_id=$1", [s.account]))
      .rejects.toMatchObject({ code: "P0001", message: "ACCOUNT_RETIRED" });
  });

  it("refreshes unchanged active work after the liveness interval", async () => {
    const s = await seed();
    const revisions: number[] = [];
    const service = new CaptureActivityService(pool!, config, { send: async (_token, payload) => {
      revisions.push(payload.aps["content-state"].eventRevision);
      return { accepted: true, invalidToken: false };
    } });
    await service.register(s.auth, s.session, s.input(1));
    await service.pump();
    await pool!.query("UPDATE capture_activity_registrations SET last_sent_at=$2,last_dispatched_at=$3,next_attempt_at=now() WHERE account_id=$1", [s.account, new Date(Date.now() - 31000), new Date(Date.now() - 2000)]);
    await service.pump();
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toBeGreaterThan(revisions[0]!);
    expect((await s.row()).last_phase).toBe("queued");
  });

  it("preserves terminal state across a transient end failure and removes only after accepted end", async () => {
    const s = await seed();
    await pool!.query("UPDATE conversation_queue_entries SET status='completed' WHERE account_id=$1", [s.account]);
    const events: string[] = [];
    let accept = true;
    const service = new CaptureActivityService(pool!, config, { send: async (_token, payload) => {
      events.push(payload.aps.event);
      return { accepted: accept, invalidToken: false };
    } });
    await service.register(s.auth, s.session, s.input(1));
    await service.pump();
    expect((await s.row()).last_phase).toBe("review");
    accept = false;
    await pool!.query("UPDATE capture_activity_registrations SET terminal_since=$2,last_dispatched_at=$3,next_attempt_at=now() WHERE account_id=$1", [s.account, new Date(Date.now() - 31000), new Date(Date.now() - 2000)]);
    await service.pump();
    expect(await s.row()).toBeDefined();
    accept = true;
    await pool!.query("UPDATE capture_activity_registrations SET last_dispatched_at=$2,next_attempt_at=now() WHERE account_id=$1", [s.account, new Date(Date.now() - 2000)]);
    await service.pump();
    expect(events).toEqual(["update", "end", "end"]);
    expect(await s.row()).toBeUndefined();
  });

  it("keeps a newer token when an older push returns invalid-token", async () => {
    const s = await seed(), entered = deferred<void>(), result = deferred<CapturePushResult>();
    const service = new CaptureActivityService(pool!, config, { send: async () => { entered.resolve(); return result.promise; } });
    await service.register(s.auth, s.session, s.input(1));
    const pushing = service.pump();
    await entered.promise;
    await service.register(s.auth, s.session, s.input(2));
    result.resolve({ accepted: false, invalidToken: true });
    await pushing;
    const row = await s.row();
    expect(Number(row.token_generation)).toBe(2);
    expect(decryptActivityToken(row.token_ciphertext, config.privateKey, [s.account, s.user, s.session, s.instance].join(":"))).toBe(s.input(2).token);
  });

  it("does not mark a newer registration delivered when an older push succeeds", async () => {
    const s = await seed(), entered = deferred<void>(), result = deferred<CapturePushResult>();
    const service = new CaptureActivityService(pool!, config, { send: async () => { entered.resolve(); return result.promise; } });
    await service.register(s.auth, s.session, s.input(1));
    const pushing = service.pump();
    await entered.promise;
    await service.register(s.auth, s.session, s.input(2));
    result.resolve({ accepted: true, invalidToken: false });
    await pushing;
    const row = await s.row();
    expect(Number(row.token_generation)).toBe(2);
    expect(Number(row.last_sent_revision)).toBe(-1);
  });

  it("rejects late generations and changed-token replay without replacing the current capability", async () => {
    const s = await seed(), service = new CaptureActivityService(pool!, config, { send: async () => ({ accepted: true, invalidToken: false }) });
    await service.register(s.auth, s.session, s.input(2));
    await expect(service.register(s.auth, s.session, s.input(1))).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.register(s.auth, s.session, s.input(2, "a".repeat(64)))).rejects.toMatchObject({ statusCode: 409 });
    expect(Number((await s.row()).token_generation)).toBe(2);
    await service.register(s.auth, s.session, s.input(2));
    expect(Number((await s.row()).token_generation)).toBe(2);
  });

  it("denies another owner and removes the capability after login revocation before sending", async () => {
    const s = await seed(), other = await seed();
    let sends = 0;
    const service = new CaptureActivityService(pool!, config, { send: async () => { sends++; return { accepted: true, invalidToken: false }; } });
    await expect(service.register(other.auth, s.session, s.input(1))).rejects.toMatchObject({ statusCode: 404 });
    await service.register(s.auth, s.session, s.input(1));
    await pool!.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [s.auth.sessionId]);
    await service.pump();
    expect(sends).toBe(0);
    expect(await s.row()).toBeUndefined();
  });
});
