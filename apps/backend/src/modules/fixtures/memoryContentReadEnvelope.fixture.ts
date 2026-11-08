/** Synthetic real HTTP/PG setup for the additive content reader. Never a grant
 * or a fake AuthContext. Only query acknowledgements are delayed by tests. */
import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { expect } from "vitest";
import { CONTRACT_VERSION, type MemoryProposalCandidate, type MemoryReviewResponse } from "@talent-signal/contracts";
import { buildApp } from "../../app.js";
import type { BackendConfig } from "../../config.js";
import { inTransaction } from "../../database/pool.js";
import { createAuthGuard, type AuthContext } from "../auth.js";
import { encodePasswordCredential } from "../passwordCredential.js";
import * as authorityOwner from "../memoryReadAuthority.js";
import * as reviewOwner from "../memoryReviewRead.js";

export const database = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (database) {
  let parsed: URL;
  try { parsed = new URL(database); } catch { throw new Error("Owned disposable loopback database required."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.search || parsed.hash
    || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/lab_regression_ci")
    throw new Error("Owned disposable loopback lab_regression_ci without URL options required.");
}

// Structural consumer types avoid importing a not-yet-existing module. The
// opaque fence is obtained only from the real domain prepare owner, never built
// or modified by a test. Missing APIs are explicit availability reds.
export type PreparedReview = Readonly<{
  body: MemoryReviewResponse; encodedBody: string; finalFence: unknown;
}>;
export type ContentFactory = (options: Readonly<{
  config: Readonly<BackendConfig>; deploymentWorkspaceIds?: readonly string[];
}>) => (auth: AuthContext, actualAuthorization: string | undefined) => Readonly<{
  run<T>(client: PoolClient, load: (client: PoolClient) => Promise<T>): Promise<T>;
}>;
export type PrepareReview = (client: PoolClient, auth: AuthContext, scopeID: string,
  renderedCredential: string) => Promise<PreparedReview>;

export function requiredContentAPIs() {
  const create = Reflect.get(authorityOwner, "createMemoryContentReaderProbeFactory") as unknown;
  const prepare = Reflect.get(reviewOwner, "prepareMemoryReviewContent") as unknown;
  expect(typeof create, "Content reader factory availability; not a module/import/setup failure.").toBe("function");
  expect(typeof prepare, "Real Review-domain prepare availability; never fabricate a fence.").toBe("function");
  return { create: create as ContentFactory, prepare: prepare as PrepareReview };
}

export function barrier() {
  let done!: () => void;
  const promise = new Promise<void>(resolve => { done = resolve; });
  return { promise, resolve: () => done() };
}
export async function bounded<T>(promise: Promise<T>, milliseconds = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Synthetic content-reader barrier was not reached.")), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

const sentence = "I prefer complete evidence before an explicit decision.";
export async function withReviewFixture(run: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const fixture = await setup();
  try { await run(fixture); } finally { await fixture.close(); }
}

async function setup() {
  const pool = new Pool({ connectionString: database!, max: 1, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  const control = new Pool({ connectionString: database!, max: 2, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const releases: Array<() => void> = [];
  const pending = new Set<Promise<unknown>>();
  const accountId = randomUUID(), userId = randomUUID();
  const email = `memory-content-${userId}@example.invalid`, password = randomBytes(24).toString("base64url");
  const config: BackendConfig = { databaseUrl: database!, host: "127.0.0.1", port: 0,
    allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false,
    passwordAuthEnabled: true, passwordRegistrationEnabled: false, simulatedAuthEnabled: false,
    internalLabEnabled: false, retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 };
  let capturedAuth: AuthContext | undefined;
  try {
    await inTransaction(control, async client => {
      await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic content reader')", [accountId, `content-${accountId}`]);
      await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)", [email, accountId, userId]);
      await client.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic owner','password_human',$3)", [userId, accountId, email]);
      await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)", [accountId, userId, await encodePasswordCredential(password)]);
    });
    app = await buildApp({ pool, config, remoteChatProvider: null, personResearchProvider: null,
      privateConversationProvider: null, labProviders: new Map(), labJobWorkerEnabled: false,
      conversationQueueWorkerEnabled: false, labCIVerifier: null, screenshotContact: null });
    // The actual authenticator supplies the host-only factory input. Nothing
    // assigns request.auth or serializes it back to a caller.
    app.get("/__content_reader_test_auth", { preHandler: createAuthGuard(pool, undefined, config) }, async request => {
      capturedAuth = request.auth; return { accepted: true };
    });
    await app.ready();
    const login = await app.inject({ method: "POST", url: "/v1/auth/password/login",
      payload: { identifier: email, password, client_label: "Synthetic content reader" } });
    expect(login.statusCode).toBe(200); // Never print the credential-bearing body.
    const authorization = `Bearer ${login.json<{ access_token: string }>().access_token}`;
    const headers = { authorization };
    const authRead = await app.inject({ method: "GET", url: "/__content_reader_test_auth", headers });
    expect(authRead.statusCode).toBe(200); expect(authRead.json()).toEqual({ accepted: true });
    if (!capturedAuth) throw new Error("The real authenticator did not admit the synthetic account.");
    const auth = capturedAuth;
    const sessionID = randomUUID(), messageID = randomUUID(), stamp = new Date().toISOString();
    const created = await app.inject({ method: "PUT", url: `/v1/agent-sessions/${sessionID}`, headers,
      payload: { expected_revision: 0, idempotency_key: randomUUID(), payload: {
        id: sessionID, scopeKind: "unresolved_intent", personDisplayLabel: "", contextDisplayLabel: "",
        title: "Synthetic source", updatedAt: stamp, createdAt: stamp, isUnread: false,
        turns: [{ id: messageID, objective: sentence, createdAt: stamp, response: {
          contractVersion: CONTRACT_VERSION, taskID: randomUUID(), contextManifestID: "none-unbound-conversation",
          knowledgeSnapshotID: "none-unbound-conversation", disposition: "answer", createdAt: stamp,
        } }],
      } } });
    expect(created.statusCode).toBe(200);
    const candidate: MemoryProposalCandidate = { scope: "self", operation: "add", statement_kind: "fact",
      display_text: sentence, subject_id: null, relationship_context_id: null, speaker: null, reporter: null,
      valid_time: null, observed_time: null, time_status: "unknown", sensitivity: "normal",
      source_excerpt: sentence, source_locator: { kind: "message", session_id: sessionID, message_id: messageID },
      previous_memory_item_id: null, previous_text: null, previous_revision: null, reason: "Synthetic reviewed evidence" };
    const staged = await app.inject({ method: "POST", url: "/v1/memory/proposals", headers, payload: {
      idempotency_key: randomUUID(), surface: "chat", session_id: sessionID, source_message_id: messageID,
      person_id: null, relationship_context_id: null, contact_decision: "none", new_contact: null,
      proposer: { kind: "human", name: "synthetic-content-reader", version: "1" }, items: [candidate],
    } });
    expect(staged.statusCode).toBe(201);
    const proposalID = staged.json<{ proposal: { proposal_id: string } }>().proposal.proposal_id;
    const opened = await app.inject({ method: "POST", url: `/v1/memory/proposals/${proposalID}/reviews`, headers,
      payload: { purpose: "chat", session_id: sessionID } });
    expect(opened.statusCode).toBe(200);
    const review = opened.json<MemoryReviewResponse>();
    expect(review.review.items).toHaveLength(1);
    expect(review.review.items[0]?.display_text).toBe(sentence);
    if (!review.review_credential) throw new Error("Actual open review omitted its rendered credential.");
    const credential = review.review_credential, scopeID = review.review.review_scope_id;

    async function waitExpiry(deadline: string) {
      const end = performance.now() + 6_000;
      while (performance.now() < end) {
        if ((await control.query<{ expired: boolean }>("SELECT clock_timestamp()>=$1::timestamptz AS expired", [deadline])).rows[0]?.expired) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("The real database deadline did not pass within the synthetic budget.");
    }
    const format = "YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"";
    async function shortenLogin() {
      return (await control.query<{ deadline: string }>(`UPDATE sessions SET expires_at=clock_timestamp()+interval '3 seconds'
        WHERE account_id=$1 AND user_id=$2 AND id=$3 RETURNING to_char(expires_at AT TIME ZONE 'UTC','${format}') AS deadline`,
      [accountId, userId, auth.sessionId])).rows[0]!.deadline;
    }
    async function originalReview() {
      const r = await app!.inject({ method: "GET", url: `/v1/memory/reviews/${scopeID}`,
        headers: { ...headers, "x-memory-review-credential": credential } });
      expect(r.statusCode).toBe(200);
      return { body: r.json<MemoryReviewResponse>(), encodedBody: r.body };
    }
    return { pool, control, config, auth, authorization, accountId, userId, sessionID, scopeID, proposalID,
      credential, review, sentence, waitExpiry, shortenLogin, originalReview,
      async assertActualHeaderAccepted() {
        const r = await app!.inject({ method: "GET", url: "/__content_reader_test_auth", headers });
        expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ accepted: true });
      },
      track<T>(promise: Promise<T>): Promise<T> { pending.add(promise); void promise.catch(() => {}); return promise; },
      releaseOnClose(release: () => void) { releases.push(release); },
      async close() {
        for (const release of releases) release();
        try { await Promise.allSettled(pending); }
        finally { try { await app!.close(); } finally { await Promise.all([pool.end(), control.end()]); } }
      },
    };
  } catch (error) {
    for (const release of releases) release();
    try { await app?.close(); } finally { await Promise.all([pool.end(), control.end()]); }
    throw error;
  }
}

export function observedClient(client: PoolClient, hold?: { phase: "commit" | "final";
  entered: ReturnType<typeof barrier>; release: ReturnType<typeof barrier> }) {
  const state = { finalQueries: 0, queriesAfterFinal: 0, commitsBeforeFinal: 0,
    realCommitsAcknowledged: 0, finalHasActualPositiveRow: false, released: false, finalAcknowledged: false };
  const proxy = new Proxy(client, { get(target, key) {
    if (key === "release") return () => { state.released = true; target.release(); };
    if (key !== "query") { const value = Reflect.get(target, key, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value; }
    return (...args: unknown[]) => {
      const first = args[0]; const sql = typeof first === "string" ? first
        : first && typeof first === "object" ? Reflect.get(first, "text") as unknown : undefined;
      const text = typeof sql === "string" ? sql : "";
      if (state.finalAcknowledged) state.queriesAfterFinal++;
      const isFinal = text.includes("tick.checked_at") && text.includes("memory_review_scopes")
        && text.includes("sessions.token_hash");
      const isCommit = text.trim().toUpperCase() === "COMMIT";
      if (isCommit && state.finalQueries === 0) state.commitsBeforeFinal++;
      const result: unknown = Reflect.apply(target.query, target, args);
      if (isCommit && hold?.phase === "commit") {
        return Promise.resolve(result).then(async actual => {
          expect(actual && typeof actual === "object" ? Reflect.get(actual, "command") : null).toBe("COMMIT");
          state.realCommitsAcknowledged++; hold.entered.resolve(); await hold.release.promise;
          return actual;
        });
      }
      if (!isFinal) return result;
      state.finalQueries++;
      if (!result || typeof Reflect.get(Object(result), "then") !== "function")
        throw new Error("The final observation must be a real PostgreSQL Promise.");
      return Promise.resolve(result).then(async actual => {
        const rows: unknown = actual && typeof actual === "object" ? Reflect.get(actual, "rows") : undefined;
        const firstRow: unknown = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
        const remaining: unknown = firstRow && typeof firstRow === "object" ? Reflect.get(firstRow, "remaining_ms") : null;
        const positive = typeof remaining === "number" ? Number.isSafeInteger(remaining) && remaining > 0
          : typeof remaining === "string" && /^[1-9][0-9]*$/.test(remaining)
            && Number.isSafeInteger(Number(remaining));
        state.finalHasActualPositiveRow = Array.isArray(rows) && rows.length === 1 && positive;
        if (hold?.phase === "final") { expect(state.finalHasActualPositiveRow).toBe(true); hold.entered.resolve(); await hold.release.promise; }
        state.finalAcknowledged = true; return actual;
      });
    };
  } });
  return { client: proxy, state, release() { if (!state.released) proxy.release(); } };
}
