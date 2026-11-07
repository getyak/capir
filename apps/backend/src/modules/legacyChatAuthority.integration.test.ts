import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { LightMyRequestResponse } from "fastify";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { inTransaction } from "../database/pool.js";
import type { RemoteChatAnswerProviding, RemoteChatAnswerResult } from "./chatAnswerProvider.js";
import { encodePasswordCredential } from "./passwordCredential.js";
import { mutateAgentSession } from "./agentSessions.js";
import type { SessionResponse } from "@talent-signal/contracts";
import type { AuthContext } from "./auth.js";
import { compileRelationshipWiki } from "./wiki.js";
import type { BackendConfig } from "../config.js";
import { LocalChatMediaStorage } from "./chatMediaStorage.js";
import { LabWorkspaceService } from "./labWorkspaces.js";
import { labStopAuthorityKeySQL } from "./labStopAuthority.js";

const database = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (database) {
  const parsed = new URL(database);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/lab_regression_ci") {
    throw new Error("Use only the owned disposable loopback lab_regression_ci database.");
  }
}

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function waitForDispatch(entered: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([entered, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("The synthetic provider did not enter within the test budget.")), 2_000);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// The first case is the Hosted-confirmed original red; phase1 cases below
// retain real HTTP/auth/PG and prove only the original-credential boundary.
// The normal pure job skips it; the explicit Hosted PostgreSQL selector must
// run it. All identities and credentials below are generated test-only values.
describe.skipIf(!database)("legacy Chat original login authority over real HTTP handlers and PostgreSQL", () => {
  it("does not publish an unscoped answer after the original login is revoked while its provider awaits", async () => {
    const pool = new Pool({ connectionString: database!, max: 4, connectionTimeoutMillis: 2_000,
      statement_timeout: 5_000, query_timeout: 6_000 });
    // A different pool guarantees the revocation does not reuse the product
    // transaction's connection while that transaction awaits the provider.
    const control = new Pool({ connectionString: database!, max: 1, connectionTimeoutMillis: 2_000,
      statement_timeout: 5_000, query_timeout: 6_000 });
    const entered = barrier(), release = barrier();
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;
    let pending: Promise<LightMyRequestResponse> | undefined;
    let calls = 0, heldCalls = 0, hold = false;
    const accountId = randomUUID(), userId = randomUUID(), key = randomUUID(), positiveKey = randomUUID();
    const email = `legacy-authority-${userId}@example.invalid`;
    const password = randomBytes(24).toString("base64url");
    const answer: RemoteChatAnswerResult = { kind: "answer", title: "Synthetic reply",
      body: "Synthetic original-authority answer.", citation_ids: [], provider_id: "zhipu-chat-completions",
      model: "synthetic-original-authority", provider_request_id: null, input_tokens: 10, output_tokens: 5 };
    const provider: RemoteChatAnswerProviding = { providerId: "zhipu-chat-completions",
      model: answer.model, supportsImageInput: false, answer: async () => {
        calls += 1;
        if (hold) {
          heldCalls += 1;
          entered.resolve();
          await release.promise;
        }
        return answer;
      } };
    try {
      await inTransaction(pool, async client => {
        await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic legacy authority')",
          [accountId, `legacy-authority-${accountId}`]);
        await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",
          [email, accountId, userId]);
        await client.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic owner','password_human',$3)",
          [userId, accountId, email]);
        await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",
          [accountId, userId, await encodePasswordCredential(password)]);
      });
      app = await buildApp({ pool, config: { databaseUrl: database!, host: "127.0.0.1", port: 0,
        allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false,
        passwordAuthEnabled: true, passwordRegistrationEnabled: false, simulatedAuthEnabled: false,
        internalLabEnabled: false, retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 },
      remoteChatProvider: provider, personResearchProvider: null, privateConversationProvider: null,
      labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
      labCIVerifier: null, screenshotContact: null });
      await app.ready();
      const login = await app.inject({ method: "POST", url: "/v1/auth/password/login",
        payload: { identifier: email, password, client_label: "Synthetic original authority" } });
      // Never attach the login body, headers, bearer or stored hashes to an
      // assertion message: failed assertions must not export credentials.
      expect(login.statusCode).toBe(200);
      const signedIn = login.json<{ access_token: string; session_id: string }>();
      const headers = { authorization: `Bearer ${signedIn.access_token}` };
      expect((await app.inject({ method: "GET", url: "/v1/auth/session", headers })).statusCode).toBe(200);
      // Prove this actual HTTP/provider fixture can produce a lawful201 before
      // testing withdrawal. A blanket500/refusal cannot satisfy this control.
      const positive = await app.inject({ method: "POST", url: "/v1/chat/unscoped-tasks", headers,
        payload: { idempotency_key: positiveKey, objective: "Reply with a short synthetic greeting." } });
      expect(positive.statusCode).toBe(201);
      expect(positive.json<{ blocks: { body: string }[] }>().blocks[0]?.body).toBe(answer.body);
      expect(calls).toBe(1);
      hold = true;
      // The absence of a product Session is deliberate and valid on this
      // production route; no queue host claim or AuthContext is fabricated.
      pending = app.inject({ method: "POST", url: "/v1/chat/unscoped-tasks", headers,
        payload: { idempotency_key: key, objective: "Reply with a short synthetic greeting." } }).then(result => result);
      void pending.catch(() => {});
      await waitForDispatch(entered.promise);
      expect(calls).toBe(2);
      expect(heldCalls).toBe(1);
      const revoked = await control.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE account_id=$1 AND user_id=$2 AND id=$3 AND revoked_at IS NULL",
        [accountId, userId, signedIn.session_id]);
      expect(revoked.rowCount).toBe(1);
      // Actual fresh authentication proves revocation is already effective
      // before the old in-flight response is permitted to return.
      const denied = await app.inject({ method: "GET", url: "/v1/auth/session", headers });
      expect(denied.statusCode).toBe(401);
      release.resolve();
      const result = await pending;
      const completed = await control.query<{ count: number }>(`SELECT count(*)::int AS count FROM idempotency_records
        WHERE account_id=$1 AND actor_user_id=$2 AND operation_scope='create_unscoped_chat_task'
          AND idempotency_key=$3 AND status='completed' AND response_status < 400`, [accountId, userId, key]);
      const retained = await control.query<{ count: number }>(`SELECT count(*)::int AS count FROM idempotency_records
        WHERE account_id=$1 AND actor_user_id=$2 AND operation_scope='create_unscoped_chat_task'
          AND idempotency_key=$3 AND status='completed' AND response_status=201`, [accountId, userId, positiveKey]);
      expect(calls).toBe(2); // One lawful control + one held call, no fallback.
      expect(heldCalls).toBe(1);
      expect(retained.rows[0]?.count).toBe(1); // Revocation is not result deletion.
      expect.soft(result.statusCode).toBeGreaterThanOrEqual(400);
      expect.soft(result.statusCode).toBeLessThan(500);
      expect.soft(result.body.includes(answer.body)).toBe(false);
      expect.soft(completed.rows[0]?.count).toBe(0);
    } finally {
      release.resolve();
      try {
        await pending?.catch(() => {});
      } finally {
        try {
          await app?.close();
        } finally {
          // Synthetic rows belong only to this disposable CI database, which
          // the owning Hosted job tears down. Never clean another account.
          await Promise.all([pool.end(), control.end()]);
        }
      }
    }
  });
});

type ContinuationProbe = { positiveDelivered: number; positiveSawSeed: number; lateAttempts: number;
  lateDelivered: number; lateSawSeed: number; lateRejected: number; resumed: boolean[];
  sdkSessionIDs: string[]; seedID: string };
type HttpFixture = {
  pool: Pool; control: Pool; app: Awaited<ReturnType<typeof buildApp>>;
  accountId: string; userId: string; sessionId: string;
  entered: ReturnType<typeof barrier>; release: ReturnType<typeof barrier>;
  calls(): number; hold(value: boolean): void;
  post(key: string): Promise<LightMyRequestResponse>;
  current(): Promise<number>; enroll(): Promise<LightMyRequestResponse>;
  replayWithNewLogin(key: string): Promise<LightMyRequestResponse>;
  pending(): Promise<LightMyRequestResponse> | undefined;
  continuationProbe: ContinuationProbe | null;
};

async function withHttpFixture(options: { scoped?: boolean; failure?: boolean; agent?: boolean; continuation?: boolean;
  finalLock?: { entered: ReturnType<typeof barrier>; release: ReturnType<typeof barrier> } },
operation: (fixture: HttpFixture) => Promise<void>) {
  const pool = new Pool({ connectionString: database!, max: 4, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  const control = new Pool({ connectionString: database!, max: 1, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  const entered = barrier(), release = barrier();
  const accountId = randomUUID(), userId = randomUUID(), personId = randomUUID(), contextId = randomUUID();
  const email = `legacy-phase1-${userId}@example.invalid`, password = randomBytes(24).toString("base64url");
  const renewalSecret = randomBytes(32).toString("base64url");
  let productSessionID: string | undefined;
  const continuationProbe: ContinuationProbe | null = options.continuation ? {
    positiveDelivered: 0, positiveSawSeed: 0, lateAttempts: 0, lateDelivered: 0, lateSawSeed: 0,
    lateRejected: 0, resumed: [], sdkSessionIDs: [], seedID: randomUUID(),
  } : null;
  let app: HttpFixture["app"] | undefined, pending: Promise<LightMyRequestResponse> | undefined;
  let hold = false, calls = 0;
  const answer: RemoteChatAnswerResult = { kind: "answer", title: "Synthetic reply", body: "Synthetic phase1 reply.",
    citation_ids: [], provider_id: options.continuation ? "claude-agent-sdk" : "zhipu-chat-completions", model: "synthetic-phase1", provider_request_id: null,
    input_tokens: 10, output_tokens: 5 };
  const dispatch = async () => {
    calls++;
    if (hold) { entered.resolve(); await release.promise; }
    if (options.failure) throw new Error("Synthetic ordinary provider failure");
  };
  const provider: RemoteChatAnswerProviding = { providerId: answer.provider_id, model: answer.model,
    supportsImageInput: false, answer: async request => {
      if (!continuationProbe) { await dispatch(); return answer; }
      calls++;
      // This is the real HTTP host's continuation, not a substituted store or
      // Agent capability. The synthetic adapter remains answer-only.
      expect(request.continuation).toBeTypeOf("function");
      const continuation = await request.continuation!("c".repeat(64));
      const key = { projectKey: "synthetic-host-mirror", sessionId: continuation.sessionID };
      const containsSeed = (rows: unknown) => Array.isArray(rows) && rows.some((row: unknown) =>
        row !== null && typeof row === "object" && "uuid" in row && row.uuid === continuationProbe.seedID);
      continuationProbe.resumed.push(continuation.resume);
      continuationProbe.sdkSessionIDs.push(continuation.sessionID);
      if (!hold) {
        await continuation.store.append(key, [{ type: "user", uuid: continuationProbe.seedID,
          message: { role: "user", content: "Synthetic retained original-login mirror entry." } }]);
        const rows = await continuation.store.load(key);
        continuationProbe.positiveDelivered++;
        continuationProbe.positiveSawSeed += Number(containsSeed(rows));
        await continuation.finish(true);
      } else {
        entered.resolve(); // The real resumed lease exists before withdrawal.
        await release.promise;
        continuationProbe.lateAttempts++;
        try {
          const rows = await continuation.store.load(key);
          // Count any data delivery BEFORE the outer provider postcheck. A409
          // at that later boundary cannot make an earlier mirror leak pass.
          continuationProbe.lateDelivered++;
          continuationProbe.lateSawSeed += Number(containsSeed(rows));
        } catch (error) { continuationProbe.lateRejected++; throw error; }
        finally { await continuation.finish(false); }
      }
      return { ...answer, provider_request_id: continuation.sessionID };
    },
    ...(options.agent ? { id: "zhipu-chat-completions", sdkVersion: "synthetic", inputCapabilities: { images: false },
      run: async () => { await dispatch(); return { structuredOutput: { outcome: "reply", title: answer.title, body: answer.body },
        inputTokens: 10, outputTokens: 5, estimatedUsd: 0, turns: 1, permissionDenials: [] }; } } : {}) };
  // Instrument only the product's explicit connect(), never callback-based
  // pool.query. The real final row lock is already held before the test pause.
  const productPool = options.finalLock ? new Proxy(pool, { get(target, key) {
    if (key === "connect") return async () => {
      const client = await target.connect();
      return new Proxy(client, { get(connection, member) {
        if (member === "query") return async (...args: Parameters<PoolClient["query"]>) => {
          const result = await Reflect.apply(connection.query, connection, args);
          if (args[0] === "SELECT id FROM sessions WHERE account_id=$1 AND user_id=$2 AND id=$3 FOR SHARE NOWAIT") {
            options.finalLock!.entered.resolve();
            await options.finalLock!.release.promise;
          }
          return result;
        };
        const value = Reflect.get(connection, member, connection);
        return typeof value === "function" ? value.bind(connection) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } }) : pool;
  try {
    await inTransaction(pool, async client => {
      await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic phase1')", [accountId, `legacy-phase1-${accountId}`]);
      await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",
        [email, accountId, userId]);
      await client.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic owner','password_human',$3)",
        [userId, accountId, email]);
      await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",
        [accountId, userId, await encodePasswordCredential(password)]);
      if (options.scoped) {
        await client.query("INSERT INTO subjects(id,account_id,external_ref,display_label) VALUES($1::uuid,$2,$1::text,'Synthetic Person')", [personId, accountId]);
        await client.query("INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label) VALUES($1::uuid,$2,$3,$1::text,'Synthetic context')", [contextId, accountId, personId]);
      }
    });
    app = await buildApp({ pool: productPool, config: { databaseUrl: database!, host: "127.0.0.1", port: 0,
      allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false, passwordAuthEnabled: true,
      passwordRegistrationEnabled: false, simulatedAuthEnabled: false, internalLabEnabled: false,
      retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 }, remoteChatProvider: provider,
    personResearchProvider: null, privateConversationProvider: null, labProviders: new Map(), labJobWorkerEnabled: false,
    conversationQueueWorkerEnabled: false, labCIVerifier: null, screenshotContact: null });
    await app.ready();
    const login = await app.inject({ method: "POST", url: "/v1/auth/password/login", payload: { identifier: email, password, client_label: "Synthetic phase1" } });
    expect(login.statusCode).toBe(200); // Do not put any credential body in assertions.
    const signedIn = login.json<SessionResponse>();
    const sessionId = signedIn.session_id;
    if (!sessionId) throw new Error("The synthetic password login omitted its session identity.");
    const headers = { authorization: `Bearer ${signedIn.access_token}` };
    const auth: AuthContext = { accountId: signedIn.account.id, accountSlug: signedIn.account.slug,
      userId: signedIn.user.id, userEmail: signedIn.user.email, userKind: signedIn.user.kind, sessionId };
    if (options.scoped) {
      // The real compiler owns identity/attention blocks and publication gates.
      // A fixture's handwritten gold label cannot replace those invariants.
      const compiled = await compileRelationshipWiki(pool, auth, personId, contextId,
        { idempotency_key: randomUUID(), objective: "Prepare an empty synthetic relationship context." });
      expect(compiled.body.status).toBe("published");
      expect(compiled.body.quality.verdict).toBe("gold");
      expect(Object.values(compiled.body.quality.gates).every(value => value === "pass")).toBe(true);
      expect(compiled.body.blocks.some(block => block.type === "identity_context")).toBe(true);
      expect(compiled.body.blocks.some(block => block.type === "no_action")).toBe(true);
    }
    if (options.continuation) {
      // Seed a canonical empty ProductSession through its production owner,
      // using the actual login response's identity. No raw session-row insert.
      productSessionID = randomUUID();
      await mutateAgentSession(pool, auth, productSessionID, { expected_revision: 0, idempotency_key: randomUUID(), payload: {
        id: productSessionID, scopeKind: "unresolved_intent", personDisplayLabel: "New session", contextDisplayLabel: "Conversation",
        title: "Synthetic original-login continuation", updatedAt: new Date().toISOString(), isUnread: false, turns: [],
      } });
    }
    const activeApp = app;
    await operation({ pool, control, app, accountId, userId, sessionId, entered, release,
      calls: () => calls, hold: value => { hold = value; }, pending: () => pending, continuationProbe,
      current: async () => (await activeApp.inject({ method: "GET", url: "/v1/auth/session", headers })).statusCode,
      enroll: () => activeApp.inject({ method: "POST", url: "/v1/auth/persistent/enroll", headers,
        payload: { renewal_secret: renewalSecret, client_kind: "web" } }).then(response => response),
      replayWithNewLogin: async key => {
        const fresh = await activeApp.inject({ method: "POST", url: "/v1/auth/password/login",
          payload: { identifier: email, password, client_label: "Synthetic lawful replay" } });
        expect(fresh.statusCode).toBe(200);
        const value = fresh.json<{ access_token: string }>();
        return activeApp.inject({ method: "POST", url: "/v1/chat/unscoped-tasks",
          headers: { authorization: `Bearer ${value.access_token}` },
          payload: { idempotency_key: key, objective: "Reply with a short synthetic greeting." } }).then(result => result);
      },
      post: key => { pending = activeApp.inject({ method: "POST", url: options.scoped ? "/v1/chat/tasks" : "/v1/chat/unscoped-tasks", headers,
        payload: { idempotency_key: key, objective: "Reply with a short synthetic greeting.",
          ...(productSessionID ? { session_id: productSessionID } : {}),
          ...(options.scoped ? { person_id: personId, relationship_context_id: contextId } : {}) } }).then(result => result);
        void pending.catch(() => {}); return pending; },
    });
  } finally {
    release.resolve(); options.finalLock?.release.resolve();
    try { await pending?.catch(() => {}); }
    finally { try { await app?.close(); } finally { await Promise.all([pool.end(), control.end()]); } }
  }
}

async function noCompletedAttempt(f: HttpFixture, key: string) {
  const row = await f.control.query<{ count: number }>(`SELECT count(*)::int AS count FROM idempotency_records
    WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3 AND status='completed' AND response_status<400`,
  [f.accountId, f.userId, key]);
  expect(row.rows[0]?.count).toBe(0);
}
function denied(result: LightMyRequestResponse) {
  expect(result.statusCode).toBe(409);
  expect(result.json<{ error: { code: string } }>().error.code).toBe("LEGACY_CHAT_AUTHORITY_UNAVAILABLE");
  expect(result.body.includes("Synthetic phase1 reply.")).toBe(false);
}

function safeFailureContext(result: LightMyRequestResponse, providerCalls: number): string {
  let code: unknown;
  try { code = result.json<{ error?: { code?: unknown } }>()?.error?.code; } catch { /* No response-body logging. */ }
  return JSON.stringify({ error_code: typeof code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/u.test(code) ? code : null,
    provider_calls: providerCalls });
}

describe.skipIf(!database)("phase1 original credential publication (Hosted PostgreSQL only)", () => {
  it("does not deliver a real resumed continuation mirror after its original HTTP login is revoked", async () => {
    await withHttpFixture({ continuation: true }, async f => {
      const probe = f.continuationProbe!;
      expect(await f.current()).toBe(200);
      const positive = await f.post(randomUUID());
      expect(positive.statusCode).toBe(201);
      expect(positive.body.includes("Synthetic phase1 reply.")).toBe(true);
      expect(probe.positiveDelivered).toBe(1);
      expect(probe.positiveSawSeed).toBe(1);
      expect(probe.resumed).toEqual([false]);
      const mirrorCount = async () => (await f.control.query<{ count: number }>(`SELECT count(*)::int AS count
        FROM harness_session_entries e JOIN harness_sessions h ON h.account_id=e.account_id AND h.id=e.harness_session_id
        WHERE h.account_id=$1 AND h.sdk_session_id=$2 AND e.entry_uuid=$3 AND h.committed_turns=1`,
      [f.accountId, probe.sdkSessionIDs[0], probe.seedID])).rows[0]?.count;
      expect(await mirrorCount()).toBe(1); // A real committed PG mirror exists.
      f.hold(true);
      const key = randomUUID(), pending = f.post(key);
      await waitForDispatch(f.entered.promise);
      expect(probe.resumed).toEqual([false, true]);
      expect(probe.sdkSessionIDs[1]).toBe(probe.sdkSessionIDs[0]);
      expect((await f.control.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [f.sessionId])).rowCount).toBe(1);
      expect(await f.current()).toBe(401);
      f.release.resolve();
      const result = await pending;
      expect(probe.lateAttempts).toBe(1);
      expect.soft(probe.lateDelivered).toBe(0);
      expect.soft(probe.lateSawSeed).toBe(0);
      expect.soft(probe.lateRejected).toBe(1);
      denied(result);
      expect(f.calls()).toBe(2); // One lawful answer and one held attempt, no fallback.
      await noCompletedAttempt(f, key);
      expect(await mirrorCount()).toBe(1); // Prior lawful checkpoint is retained.
    });
  });

  it.each([{ scoped: true }, { agent: true }])("preserves lawful201 then rejects revoked original login: %j", async options => {
    await withHttpFixture(options, async f => {
      const positive = await f.post(randomUUID());
      expect(positive.statusCode, safeFailureContext(positive, f.calls())).toBe(201);
      expect(positive.body.includes("Synthetic phase1 reply.")).toBe(true);
      f.hold(true);
      const key = randomUUID(), pending = f.post(key);
      await waitForDispatch(f.entered.promise);
      const revoked = await f.control.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [f.sessionId]);
      expect(revoked.rowCount).toBe(1); // Must finish while the provider is still held.
      expect(await f.current()).toBe(401);
      f.release.resolve();
      denied(await pending);
      expect(f.calls()).toBe(2);
      await noCompletedAttempt(f, key);
    });
  });

  it.each([false, true])("ordinary provider failure keeps the existing fallback201 (scoped=%s)", async scoped => {
    await withHttpFixture({ scoped, failure: true }, async f => {
      const result = await f.post(randomUUID());
      expect(result.statusCode, safeFailureContext(result, f.calls())).toBe(201);
      expect(f.calls()).toBe(scoped ? 1 : 2);
    });
  });

  it("accepts actual current-to-previous renewal while the original deadline is still live", async () => {
    await withHttpFixture({}, async f => {
      f.hold(true);
      const pending = f.post(randomUUID());
      await waitForDispatch(f.entered.promise);
      expect((await f.enroll()).statusCode).toBe(200); // Actual owner rotation; no new session lock across await.
      expect(await f.current()).toBe(200); // Original token is now the accepted previous branch.
      f.release.resolve();
      expect((await pending).statusCode).toBe(201);
      expect(f.calls()).toBe(1);
    });
  });

  it.each(["current", "previous", "extended-previous"] as const)("cannot borrow a renewed deadline after %s admission", async branch => {
    await withHttpFixture({}, async f => {
      // A real accepted login with a subsecond original deadline. Database
      // formatting/pg_sleep retain microseconds; JavaScript never rounds it.
      await f.control.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '0.8 seconds' WHERE id=$1", [f.sessionId]);
      if (branch !== "current") expect((await f.enroll()).statusCode).toBe(200);
      expect(await f.current()).toBe(200);
      f.hold(true);
      const key = randomUUID(), pending = f.post(key);
      await waitForDispatch(f.entered.promise);
      if (branch === "current") expect((await f.enroll()).statusCode).toBe(200);
      // Wait for the exact ORIGINAL previous deadline without reading hashes.
      await f.control.query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM (previous_token_expires_at-clock_timestamp())))+0.01) FROM sessions WHERE id=$1", [f.sessionId]);
      if (branch === "extended-previous") {
        // Even an independently extended accepted previous slot cannot extend
        // a proof frozen before that write. Normal renewal never does this.
        await f.control.query("UPDATE sessions SET previous_token_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1", [f.sessionId]);
        expect(await f.current()).toBe(200);
      } else expect(await f.current()).toBe(401);
      f.release.resolve();
      denied(await pending);
      expect(f.calls()).toBe(1);
      await noCompletedAttempt(f, key);
    });
  });

  it("does not fallback after a source generation is withdrawn while auth remains live", async () => {
    await withHttpFixture({}, async f => {
      f.hold(true);
      const key = randomUUID(), pending = f.post(key);
      await waitForDispatch(f.entered.promise);
      await f.control.query("UPDATE harness_source_generations SET generation=generation+1 WHERE account_id=$1", [f.accountId]);
      expect(await f.current()).toBe(200);
      f.release.resolve();
      denied(await pending);
      expect(f.calls()).toBe(1);
      await noCompletedAttempt(f, key);
    });
  });

  it("serializes final publication with a real session UPDATE and retains lawful completed replay", async () => {
    const finalLock = { entered: barrier(), release: barrier() };
    await withHttpFixture({ finalLock }, async f => {
      const key = randomUUID(), pending = f.post(key);
      await waitForDispatch(finalLock.entered.promise);
      const client = await f.control.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout='150ms'");
        // FOR KEY SHARE would incorrectly allow this non-key mutation.
        await expect(client.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [f.sessionId]))
          .rejects.toMatchObject({ code: "55P03" });
      } finally { await client.query("ROLLBACK"); client.release(); }
      finalLock.release.resolve();
      const result = await pending;
      expect(result.statusCode).toBe(201);
      expect(f.calls()).toBe(1);
      expect((await f.control.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [f.sessionId])).rowCount).toBe(1);
      expect(await f.current()).toBe(401);
      const retained = await f.control.query<{ count: number }>(`SELECT count(*)::int AS count FROM idempotency_records
        WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3 AND status='completed' AND response_status=201`, [f.accountId, f.userId, key]);
      expect(retained.rows[0]?.count).toBe(1);
      const replay = await f.replayWithNewLogin(key);
      expect(replay.statusCode).toBe(201);
      expect(replay.json<{ task_id: string }>().task_id).toBe(result.json<{ task_id: string }>().task_id);
      expect(f.calls()).toBe(1); // A lawful new login reads, never reruns a completed provider attempt.
    });
  });
});

type LabWithdrawal = "grant" | "human-workspace-stop";
type LabWithdrawalState = {
  workspace_state: string; stop_id: string | null; child_session_live: boolean;
  entry_live: boolean; child_user_status: string | null;
  grant_state: string | null; grant_parent_revoked: boolean | null;
};
type LabHttpFixture = {
  control: Pool; parentAccountId: string; parentUserId: string; parentSessionId: string;
  childAccountId: string; childUserId: string; childSessionId: string; workspaceId: string; stopId: string;
  entered: ReturnType<typeof barrier>; release: ReturnType<typeof barrier>;
  calls(): number; heldCalls(): number; hold(): void;
  post(key: string): Promise<LightMyRequestResponse>;
  currentChild(): Promise<number>; currentParent(): Promise<number>;
  withdraw(): Promise<LightMyRequestResponse>;
  withdrawalState(): Promise<LabWithdrawalState>;
};

/** Actual parent login/provisioning/entry routes, with no fabricated child
 * AuthContext/session. Only the entitlement is server-owned synthetic setup,
 * following capirAuth.integration.test.ts. Credentials never leave closures. */
async function withLabHttpFixture(kind: LabWithdrawal, operation: (fixture: LabHttpFixture) => Promise<void>) {
  const pool = new Pool({ connectionString: database!, max: 4, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  // A stop can await cleanup on one connection while fresh HTTP authentication
  // and its exact synthetic-state observation use another control connection.
  const control = new Pool({ connectionString: database!, max: 3, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  const entered = barrier(), release = barrier();
  const parentAccountId = randomUUID(), parentUserId = randomUUID(), stopId = randomUUID();
  const email = `legacy-lab-${parentUserId}@example.invalid`, password = randomBytes(24).toString("base64url");
  const web = "https://legacy-lab-web.test.invalid", backend = "https://legacy-lab-api.test.invalid";
  let directory: string | undefined, storage: LocalChatMediaStorage | undefined;
  let app: HttpFixture["app"] | undefined, controlApp: HttpFixture["app"] | undefined;
  let pending: Promise<LightMyRequestResponse> | undefined, withdrawal: Promise<LightMyRequestResponse> | undefined;
  let hold = false, calls = 0, heldCalls = 0;
  const answer: RemoteChatAnswerResult = { kind: "answer", title: "Synthetic reply", body: "Synthetic phase1 reply.",
    citation_ids: [], provider_id: "zhipu-chat-completions", model: "synthetic-lab-authority", provider_request_id: null,
    input_tokens: 10, output_tokens: 5 };
  const provider: RemoteChatAnswerProviding = { providerId: answer.provider_id, model: answer.model,
    supportsImageInput: false, answer: async () => {
      calls++;
      if (hold) { heldCalls++; entered.resolve(); await release.promise; }
      return answer;
    } };
  try {
    directory = await mkdtemp(join(tmpdir(), "capir-legacy-lab-authority-"));
    storage = new LocalChatMediaStorage(directory);
    const config: BackendConfig = { databaseUrl: database!, host: "127.0.0.1", port: 0,
      allowedOrigins: [web], appleSignInAudiences: [], appleSignInEnabled: false, simulatedAuthEnabled: false,
      passwordAuthEnabled: true, passwordRegistrationEnabled: false, internalLabEnabled: true,
      retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600,
      chatMediaStorage: { provider: "local", directory },
      capirAuth: { enabled: true, webOrigin: web, backendOrigin: backend, codeTtlSeconds: 60,
        accessTtlSeconds: 60, refreshIdleTtlSeconds: 600, refreshAbsoluteTtlSeconds: 3_600 },
      capirTests: { enabled: true, provisioningKey: randomBytes(32).toString("base64url"), provisioningGeneration: 1,
        webOrigin: web, backendOrigin: backend, webConsumerKey: randomBytes(32).toString("base64url"), maxActiveRuns: 8 } };
    await inTransaction(control, async client => {
      await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic Lab parent')", [parentAccountId, `legacy-lab-${parentAccountId}`]);
      await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",
        [email, parentAccountId, parentUserId]);
      await client.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic Lab parent','password_human',$3)",
        [parentUserId, parentAccountId, email]);
      await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",
        [parentAccountId, parentUserId, await encodePasswordCredential(password)]);
    });
    const options = { config, chatMediaStorage: storage, personResearchProvider: null, privateConversationProvider: null,
      labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false, labCIVerifier: null, screenshotContact: null };
    app = await buildApp({ ...options, pool, remoteChatProvider: provider });
    controlApp = await buildApp({ ...options, pool: control, remoteChatProvider: null });
    await app.ready(); await controlApp.ready();
    const login = await controlApp.inject({ method: "POST", url: "/v1/auth/password/login",
      payload: { identifier: email, password, client_label: "Synthetic Lab parent" } });
    expect(login.statusCode).toBe(200);
    const parent = login.json<SessionResponse>(), parentSessionId = parent.session_id;
    if (!parentSessionId) throw new Error("The real synthetic parent login omitted its session identity.");
    const parentHeaders = { authorization: `Bearer ${parent.access_token}` };
    let child: SessionResponse, workspaceId: string, grantId: string | null = null;
    if (kind === "grant") {
      await control.query(`INSERT INTO capir_user_test_entitlements(id,account_id,user_id,scopes,state,granted_by)
        VALUES($1,$2,$3,ARRAY['test.create','test.status','test.stop','test.handoff'],'active','Synthetic GET449 Lab proof')`,
      [randomUUID(), parentAccountId, parentUserId]);
      const verifier = randomBytes(32).toString("base64url"), state = randomBytes(32).toString("base64url");
      const redirect = "http://127.0.0.1:49381/capir/callback";
      const authorized = await controlApp.inject({ method: "POST", url: "/v1/capir/auth/authorize", headers: parentHeaders,
        payload: { schema_version: "capir-auth.v2", redirect_uri: redirect, state,
          code_challenge: createHash("sha256").update(verifier, "ascii").digest("base64url"), code_challenge_method: "S256",
          web_origin: web, backend_origin: backend, scopes: ["grants.read", "grants.revoke", "test.create", "test.status", "test.stop", "test.handoff"],
          consent: true, client_label: "Synthetic Lab authority proof" } });
      expect(authorized.statusCode).toBe(200);
      const exchanged = await controlApp.inject({ method: "POST", url: "/v1/capir/auth/exchange",
        payload: { schema_version: "capir-auth.v2", code: authorized.json<{ code: string }>().code,
          code_verifier: verifier, state, redirect_uri: redirect, web_origin: web, backend_origin: backend } });
      expect(exchanged.statusCode).toBe(200);
      const grant = exchanged.json<{ access_token: string; grant: { id: string } }>();
      grantId = grant.grant.id;
      const childPassword = randomBytes(32).toString("base64url");
      const created = await controlApp.inject({ method: "POST", url: "/v1/capir/tests",
        headers: { authorization: `Bearer ${grant.access_token}`, "x-capir-backend-origin": backend },
        payload: { request_id: randomUUID(), password: childPassword, preset: "empty", duration_hours: 1, web_origin: web, backend_origin: backend } });
      expect(created.statusCode).toBe(200);
      const run = created.json<{ run: { id: string; username: string; state: string } }>().run;
      expect(run.state).toBe("ready");
      workspaceId = run.id; // The owning create path binds run.id = workspace_id.
      const admitted = await controlApp.inject({ method: "POST", url: "/v1/auth/password/login",
        payload: { identifier: run.username, password: childPassword, client_label: "Synthetic grant child" } });
      expect(admitted.statusCode).toBe(200);
      child = admitted.json<SessionResponse>();
      // Password login intentionally need not return session_id. Read the
      // actual server-issued identity through the same credential's owner.
      const current = await controlApp.inject({ method: "GET", url: "/v1/auth/session",
        headers: { authorization: `Bearer ${child.access_token}` } });
      expect(current.statusCode).toBe(200);
      const observed = current.json<SessionResponse>();
      expect(observed.account.id).toBe(child.account.id);
      expect(observed.user.id).toBe(child.user.id);
      if (!observed.session_id) throw new Error("The canonical Lab session readback omitted its identity.");
      child = { ...child, session_id: observed.session_id };
    } else {
      workspaceId = randomUUID();
      const created = await controlApp.inject({ method: "POST", url: "/v1/lab/workspaces", headers: parentHeaders,
        payload: { id: workspaceId, duration_hours: 1 } });
      expect(created.statusCode).toBe(200);
      expect(created.json<{ workspace: { state: string } }>().workspace.state).toBe("active");
      const entryToken = randomBytes(32).toString("base64url");
      const entered = await controlApp.inject({ method: "POST", url: `/v1/lab/workspaces/${workspaceId}/entries`, headers: parentHeaders,
        payload: { id: randomUUID(), access_token: entryToken } });
      expect(entered.statusCode).toBe(200);
      const entry = entered.json<{ entry: { state: string; session_id: string } }>().entry;
      expect(entry.state).toBe("active");
      const current = await controlApp.inject({ method: "GET", url: "/v1/auth/session", headers: { authorization: `Bearer ${entryToken}` } });
      expect(current.statusCode).toBe(200);
      // The session was issued by /entries; the token is the caller-held real
      // entry protocol value, not an invented row or req.auth override.
      child = { ...current.json<SessionResponse>(), access_token: entryToken, session_id: entry.session_id };
    }
    const childSessionId = child.session_id;
    if (!childSessionId) throw new Error("The real synthetic Lab entry omitted its session identity.");
    expect(child.user.kind).toBe("lab_human");
    const childHeaders = { authorization: `Bearer ${child.access_token}` };
    const product = app, observer = controlApp;
    await operation({ control, parentAccountId, parentUserId, parentSessionId,
      childAccountId: child.account.id, childUserId: child.user.id, childSessionId, workspaceId, stopId,
      entered, release, calls: () => calls, heldCalls: () => heldCalls, hold: () => { hold = true; },
      currentChild: async () => (await observer.inject({ method: "GET", url: "/v1/auth/session", headers: childHeaders })).statusCode,
      currentParent: async () => (await observer.inject({ method: "GET", url: "/v1/auth/session", headers: parentHeaders })).statusCode,
      post: key => {
        pending = product.inject({ method: "POST", url: "/v1/chat/unscoped-tasks", headers: childHeaders,
          payload: { idempotency_key: key, objective: "Reply with a short synthetic greeting." } }).then(result => result);
        void pending.catch(() => {}); return pending;
      },
      withdraw: () => {
        withdrawal = (kind === "grant"
          ? observer.inject({ method: "POST", url: "/v1/capir/auth/grants/revoke", headers: parentHeaders, payload: { schema_version: "capir-auth.v2", grant_id: grantId } })
          : observer.inject({ method: "POST", url: `/v1/lab/workspaces/${workspaceId}/stop`, headers: parentHeaders, payload: { id: stopId } }))
          .then(result => result);
        void withdrawal.catch(() => {}); return withdrawal;
      },
      withdrawalState: async () => {
        const row = (await control.query<LabWithdrawalState>(`SELECT w.state AS workspace_state,w.stop_id,
          EXISTS(SELECT 1 FROM sessions s WHERE s.id=$2 AND s.account_id=w.target_account_id AND s.user_id=w.target_user_id
            AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()) AS child_session_live,
          EXISTS(SELECT 1 FROM lab_test_workspace_entries e WHERE e.workspace_id=w.id AND e.session_id=$2
            AND e.revoked_at IS NULL AND e.expires_at>clock_timestamp()) AS entry_live,
          (SELECT u.status FROM users u WHERE u.account_id=w.target_account_id AND u.id=w.target_user_id) AS child_user_status,
          (SELECT g.state FROM capir_auth_grants g WHERE g.id=$3 AND g.account_id=$4 AND g.user_id=$5) AS grant_state,
          (SELECT s.revoked_at IS NOT NULL FROM capir_auth_grants g JOIN sessions s ON s.id=g.backing_session_id
            WHERE g.id=$3 AND g.account_id=$4 AND g.user_id=$5) AS grant_parent_revoked
          FROM lab_test_workspaces w WHERE w.id=$1 AND w.owner_account_id=$4 AND w.owner_user_id=$5`,
        [workspaceId, childSessionId, grantId, parentAccountId, parentUserId])).rows[0];
        if (!row) throw new Error("The exact synthetic Lab workspace was not available for authority readback.");
        return row;
      },
    });
  } finally {
    release.resolve();
    try { await pending?.catch(() => {}); }
    finally {
      try { await withdrawal?.catch(() => {}); }
      finally {
        try {
          if (storage) {
            // Canonical exact-owner cleanup also works after grant revocation.
            // The proof uses HTTP only; this is finally-only fixture cleanup.
            const service = new LabWorkspaceService(control, storage, 3_600);
            const owned = await control.query<{ id: string }>("SELECT id FROM lab_test_workspaces WHERE owner_account_id=$1 AND owner_user_id=$2 AND state<>'deleted'",
              [parentAccountId, parentUserId]);
            for (const row of owned.rows) await service.stopOperatorRun(row.id, randomUUID());
          }
        } finally {
          try { await app?.close(); }
          finally {
            try { await controlApp?.close(); }
            finally {
              try { await Promise.all([pool.end(), control.end()]); }
              finally { if (directory) await rm(directory, { recursive: true, force: true }); }
            }
          }
        }
      }
    }
    // Parent rows remain intact throughout the proof. Like the original
    // ordinary-login fixture, their generated-only database is job-owned and
    // discarded by Hosted, never removed by an overbroad account-delete helper.
  }
}

async function observeLabWithdrawal(kind: LabWithdrawal, f: LabHttpFixture): Promise<LabWithdrawalState> {
  const until = performance.now() + 2_000;
  do {
    const state = await f.withdrawalState();
    const withdrawn = kind === "grant"
      ? state.workspace_state === "active" && state.child_session_live && state.entry_live
        && state.child_user_status === "active" && state.grant_state === "revoked" && state.grant_parent_revoked === true
      : ["deleting", "deleted"].includes(state.workspace_state) && state.stop_id === f.stopId
        && !state.child_session_live && !state.entry_live && [null, "revoked"].includes(state.child_user_status);
    if (withdrawn && await f.currentChild() === 401) return state;
    await delay(10);
  } while (performance.now() < until);
  throw new Error("Canonical Lab withdrawal and fresh child authentication denial were not observed within the test budget.");
}

async function observeLabStopIntent(f: LabHttpFixture): Promise<LabWithdrawalState> {
  const until = performance.now() + 2_000;
  do {
    // pool.query is its own short autocommit transaction. If the shared trylock
    // succeeds it is released before this await returns; never retain it over
    // another await or use the held product transaction for the probe.
    const intent = await f.control.query<{ stop_clear: boolean }>(
      `SELECT pg_try_advisory_xact_lock_shared(${labStopAuthorityKeySQL}) AS stop_clear`, [f.childAccountId]);
    if (intent.rows[0]?.stop_clear === false) return f.withdrawalState();
    await delay(10);
  } while (performance.now() < until);
  throw new Error("The canonical Lab stop intent was not observed within the test budget.");
}

describe.skipIf(!database)("legacy Chat Lab lineage over real HTTP handlers and PostgreSQL", () => {
  it.each(["grant", "human-workspace-stop"] as const)("rejects a late answer after canonical %s withdrawal and preserves its real parent", async kind => {
    await withLabHttpFixture(kind, async f => {
      expect(await f.currentChild()).toBe(200);
      expect(await f.currentParent()).toBe(200);
      const positiveKey = randomUUID(), key = randomUUID();
      const positive = await f.post(positiveKey);
      expect(positive.statusCode, safeFailureContext(positive, f.calls())).toBe(201);
      expect(positive.body.includes("Synthetic phase1 reply.")).toBe(true);
      expect(f.calls()).toBe(1);
      f.hold();
      const pending = f.post(key);
      await waitForDispatch(f.entered.promise);
      expect(f.calls()).toBe(2); expect(f.heldCalls()).toBe(1);
      const withdrawal = f.withdraw();
      // A grant withdrawal must finish independently while the model is held.
      // claimIdempotency's write guard holds workspace SHARE over the provider
      // await. Stop first publishes exclusive advisory intent, then waits for
      // workspace UPDATE; neither deleting state nor fresh401 can precede release.
      if (kind === "grant") expect((await withdrawal).statusCode).toBe(200);
      const state = kind === "grant" ? await observeLabWithdrawal(kind, f) : await observeLabStopIntent(f);
      if (kind === "grant") {
        expect(state.child_session_live).toBe(true); expect(state.entry_live).toBe(true);
        expect(state.workspace_state).toBe("active"); expect(state.child_user_status).toBe("active");
        expect(state.grant_state).toBe("revoked"); expect(state.grant_parent_revoked).toBe(true);
      } else {
        expect(state).toMatchObject({ workspace_state: "active", stop_id: null, child_session_live: true,
          entry_live: true, child_user_status: "active", grant_state: null, grant_parent_revoked: null });
        // Auth reads committed lineage, not pending stop intent. The existing
        // independent harness source probe must reject that intent after return.
        expect(await f.currentChild()).toBe(200);
      }
      expect(await f.currentParent()).toBe(200);
      f.release.resolve();
      denied(await pending);
      expect(f.calls()).toBe(2); expect(f.heldCalls()).toBe(1); // No fallback/replay/model call.
      const completed = await f.control.query<{ count: number }>(`SELECT count(*)::int AS count FROM idempotency_records
        WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3 AND status='completed' AND response_status<400`,
      [f.childAccountId, f.childUserId, key]);
      expect(completed.rows[0]?.count).toBe(0);
      if (kind === "grant") {
        const prior = await f.control.query<{ count: number }>(`SELECT count(*)::int AS count FROM idempotency_records
          WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3 AND status='completed' AND response_status=201`,
        [f.childAccountId, f.childUserId, positiveKey]);
        expect(prior.rows[0]?.count).toBe(1); // Withdrawal does not erase a lawful prior child result.
      } else {
        const stopped = await withdrawal;
        expect(stopped.statusCode).toBe(200);
        const workspace = stopped.json<{ workspace: { state: string; data_rows: number | null; active_sessions: number;
          cleanup_error: string | null; pending_media_writes: number } }>().workspace;
        expect(workspace).toMatchObject({ state: "deleted", data_rows: 0, active_sessions: 0, cleanup_error: null, pending_media_writes: 0 });
        expect(await f.currentChild()).toBe(401);
        const closed = await f.withdrawalState();
        expect(closed).toMatchObject({ workspace_state: "deleted", stop_id: f.stopId, child_session_live: false,
          entry_live: false, child_user_status: "revoked" });
        const removed = await f.control.query<{ sessions: number; users: number; revoked_children: number; credentials: number }>(`SELECT
          (SELECT count(*)::int FROM sessions WHERE account_id=$1) AS sessions,
          (SELECT count(*)::int FROM users WHERE account_id=$1) AS users,
          (SELECT count(*)::int FROM users WHERE account_id=$1 AND id=$2 AND kind='lab_human' AND status='revoked') AS revoked_children,
          (SELECT count(*)::int FROM password_credentials WHERE account_id=$1) AS credentials`, [f.childAccountId, f.childUserId]);
        // Canonical cleanup retains exactly the revoked control identity;
        // its account-scoped data, sessions and password credentials are gone.
        expect(removed.rows[0]).toEqual({ sessions: 0, users: 1, revoked_children: 1, credentials: 0 });
      }
      expect(await f.currentParent()).toBe(200);
      const parent = await f.control.query<{ count: number }>(`SELECT count(*)::int AS count FROM accounts a
        JOIN users u ON u.account_id=a.id AND u.id=$2 JOIN sessions s ON s.account_id=a.id AND s.user_id=u.id AND s.id=$3
        WHERE a.id=$1 AND a.retired_at IS NULL AND u.status='active' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`,
      [f.parentAccountId, f.parentUserId, f.parentSessionId]);
      expect(parent.rows[0]?.count).toBe(1);
    });
  }, 15_000);
});
