import { randomBytes, randomUUID } from "node:crypto";

import type { LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { inTransaction } from "../database/pool.js";
import type { RemoteChatAnswerProviding, RemoteChatAnswerResult } from "./chatAnswerProvider.js";
import { encodePasswordCredential } from "./passwordCredential.js";

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

// This is the first-red milestone for GET449, not a lifecycle implementation.
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
