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
  let parsed: URL;
  try { parsed = new URL(database); } catch { throw new Error("Use only the owned disposable loopback lab_regression_ci database."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.search || parsed.hash
    || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/lab_regression_ci") {
    throw new Error("Use only the owned disposable loopback lab_regression_ci database.");
  }
}

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe.skipIf(!database)("legacy answer-only lifecycle over real HTTP handlers and PostgreSQL", () => {
  it.each([false,true])("releases its only product connection while the actual answer-only provider awaits (internalLab=%s)", async internalLabEnabled => {
    const pool = new Pool({ connectionString: database!, max: 1, connectionTimeoutMillis: 2_000,
      statement_timeout: 5_000, query_timeout: 6_000 });
    const control = new Pool({ connectionString: database!, max: 1, connectionTimeoutMillis: 2_000,
      statement_timeout: 5_000, query_timeout: 6_000 });
    const entered = barrier(), release = barrier();
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;
    let pending: Promise<LightMyRequestResponse> | undefined;
    let hold = false, calls = 0;
    const accountId = randomUUID(), userId = randomUUID(), key = randomUUID();
    const email = `legacy-one-client-${userId}@example.invalid`;
    const password = randomBytes(24).toString("base64url");
    const answer: RemoteChatAnswerResult = { kind: "answer", title: "Synthetic reply",
      body: "Synthetic answer without tools or a product Session.", citation_ids: [],
      provider_id: "deepseek-chat-completions", model: "synthetic-one-client",
      provider_request_id: null, input_tokens: 10, output_tokens: 5 };
    // This adapter genuinely has only answer, never a fabricated Agent run or
    // tool capability. It makes no network/model call and ignores cancellation
    // until the test releases it, so a late callback cannot be waved away.
    const provider: RemoteChatAnswerProviding = { providerId: answer.provider_id,
      model: answer.model, supportsImageInput: false, answer: async () => {
        calls += 1;
        if (hold) { entered.resolve(); await release.promise; }
        return answer;
      } };
    try {
      await inTransaction(control, async client => {
        await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic one-client lifecycle')",
          [accountId, `legacy-one-client-${accountId}`]);
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
        internalLabEnabled, retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 },
      remoteChatProvider: provider, personResearchProvider: null, privateConversationProvider: null,
      labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
      labCIVerifier: null, screenshotContact: null });
      await app.ready();
      const login = await app.inject({ method: "POST", url: "/v1/auth/password/login",
        payload: { identifier: email, password, client_label: "Synthetic one-client lifecycle" } });
      expect(login.statusCode).toBe(200); // Never export the credential body on failure.
      const signedIn = login.json<{ access_token: string }>();
      const headers = { authorization: `Bearer ${signedIn.access_token}` };
      const positive = await app.inject({ method: "POST", url: "/v1/chat/unscoped-tasks", headers,
        payload: { idempotency_key: randomUUID(), objective: "Give a synthetic greeting." } });
      expect(positive.statusCode).toBe(201);
      expect(positive.json<{ blocks: { body: string }[] }>().blocks[0]?.body).toBe(answer.body);
      expect(calls).toBe(1);
      hold = true;
      pending = app.inject({ method: "POST", url: "/v1/chat/unscoped-tasks", headers,
        payload: { idempotency_key: key, objective: "Give another synthetic greeting." } }).then(result => result);
      void pending.catch(() => {});
      let dispatchTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([entered.promise, new Promise<never>((_resolve, reject) => {
          dispatchTimer = setTimeout(() => reject(new Error("The synthetic provider did not enter within the test budget.")), 2_000);
        })]);
      } finally { if (dispatchTimer) clearTimeout(dispatchTimer); }
      expect(calls).toBe(2);
      const poolBeforeHeartbeat = { total: pool.totalCount, idle: pool.idleCount };
      let heartbeatOutcome: "completed" | "acquisition_timeout" | "other_failure" = "other_failure";
      try {
        // Crucially use the same real max=1 product pool, not the independent
        // setup pool. Its normal two-second acquisition bound remains intact.
        await pool.query("SELECT 1 AS one_client_heartbeat");
        heartbeatOutcome = "completed";
      } catch (error) {
        // Classify only the driver's fixed acquisition-timeout string. Never
        // export an error object, SQL, connection string or unknown message.
        if (error instanceof Error && error.message === "timeout exceeded when trying to connect") {
          heartbeatOutcome = "acquisition_timeout";
          expect.soft(poolBeforeHeartbeat).toEqual({ total: 1, idle: 0 });
        }
      }
      finally { release.resolve(); }
      const result = await pending;
      expect.soft(heartbeatOutcome, "The held answer must leave the only product connection available.").toBe("completed");
      expect(result.statusCode).toBe(201);
      expect(result.json<{ blocks: { body: string }[] }>().blocks[0]?.body).toBe(answer.body);
      expect(calls).toBe(2); // One positive and one held answer, never redispatch.
      expect((await pool.query("SELECT 1 AS released_product_heartbeat")).rows[0]?.released_product_heartbeat).toBe(1);
    } finally {
      release.resolve();
      try { await pending?.catch(() => {}); }
      finally {
        try { await app?.close(); }
        finally { await Promise.all([pool.end(), control.end()]); }
      }
      // The owning disposable CI database is torn down by the Hosted job.
      // No other account, production service or local database is cleaned.
    }
  });
});
