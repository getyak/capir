/** GET457 test-only fixture on the released Main schema. Only the remote
 * answer is synthetic; login, source Session, proposal and review use real HTTP. */
import { randomBytes, randomUUID } from "node:crypto";
import type { AgentSessionPayload, AgentSessionRecord, SessionResponse,
  UnscopedChatTaskRequest, UnscopedChatTaskResponse } from "@talent-signal/contracts";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { expect } from "vitest";
import { buildApp } from "../../app.js";
import { inTransaction } from "../../database/pool.js";
import type { AuthContext } from "../auth.js";
import type { RemoteChatAnswerProviding, RemoteChatAnswerResult } from "../chatAnswerProvider.js";
import { encodePasswordCredential } from "../passwordCredential.js";

export const memoryStageDatabase = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (memoryStageDatabase) {
  let parsed: URL;
  try { parsed = new URL(memoryStageDatabase); }
  catch { throw new Error("Use only the owned disposable loopback lab_regression_ci database."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.search || parsed.hash
    || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/lab_regression_ci")
    throw new Error("Use only the owned disposable loopback lab_regression_ci database without URL options.");
}
type Request = (options: Omit<InjectOptions, "headers">) => Promise<LightMyRequestResponse>;
export interface MemoryProposalStageFixture {
  pool: Pool; auth: AuthContext; request: Request;
  post(body: UnscopedChatTaskRequest): Promise<LightMyRequestResponse>;
  saveAnswer(sessionID: string, objective: string, response: UnscopedChatTaskResponse): Promise<AgentSessionRecord>;
}

export async function withMemoryProposalStageFixture(operation: (fixture: MemoryProposalStageFixture) => Promise<void>): Promise<void> {
  if (!memoryStageDatabase) throw new Error("The explicit disposable PostgreSQL gate is required.");
  const pool = new Pool({ connectionString: memoryStageDatabase, max: 4,
    connectionTimeoutMillis: 2_000, statement_timeout: 5_000, query_timeout: 6_000 });
  const accountID = randomUUID(), userID = randomUUID(), password = randomBytes(24).toString("base64url");
  const email = `memory-stage-commit-${userID}@example.invalid`;
  const requests = new Set<Promise<LightMyRequestResponse>>();
  let app: Awaited<ReturnType<typeof buildApp>> | undefined, poolError = false;
  pool.on("error", () => { poolError = true; });
  const answer: RemoteChatAnswerResult = { kind: "answer", title: "Synthetic stage commit source",
    body: "Synthetic independent source reply.", citation_ids: [], provider_id: "deepseek-chat-completions",
    model: "synthetic-stage-commit", provider_request_id: null, input_tokens: 1, output_tokens: 1 };
  const provider: RemoteChatAnswerProviding = { providerId: answer.provider_id, model: answer.model,
    supportsImageInput: false, answer: async () => answer };
  try {
    // Only the synthetic password-account setup is SQL. No successful Chat,
    // Session, proposal, proof, review or authentication result is inserted.
    await inTransaction(pool, async client => {
      await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic stage commit owner')",
        [accountID, `memory-stage-commit-${accountID}`]);
      await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",
        [email, accountID, userID]);
      await client.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic owner','password_human',$3)",
        [userID, accountID, email]);
      await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",
        [accountID, userID, await encodePasswordCredential(password)]);
    });
    app = await buildApp({ pool, config: { databaseUrl: memoryStageDatabase, host: "127.0.0.1", port: 0,
      allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false,
      passwordAuthEnabled: true, passwordRegistrationEnabled: false, simulatedAuthEnabled: false,
      internalLabEnabled: false, retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 },
    remoteChatProvider: provider, personResearchProvider: null, privateConversationProvider: null,
    labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
    labCIVerifier: null, screenshotContact: null });
    await app.ready();
    const login = await app.inject({ method: "POST", url: "/v1/auth/password/login", payload: {
      identifier: email, password, client_label: "Synthetic stage commit regression",
    } });
    expect(login.statusCode).toBe(200); // Never print or assert the credential body.
    const signedIn = login.json<SessionResponse>();
    if (!signedIn.session_id) throw new Error("The actual synthetic login omitted its session identity.");
    const auth: AuthContext = { accountId: signedIn.account.id, accountSlug: signedIn.account.slug,
      userId: signedIn.user.id, userEmail: signedIn.user.email, userKind: signedIn.user.kind, sessionId: signedIn.session_id };
    const headers = { authorization: `Bearer ${signedIn.access_token}` }, activeApp = app;
    const request: Request = options => {
      const pending = activeApp.inject({ ...options, headers }).then(value => value);
      requests.add(pending); void pending.then(() => requests.delete(pending), () => requests.delete(pending));
      return pending;
    };
    await operation({ pool, auth, request,
      post: body => request({ method: "POST", url: "/v1/chat/unscoped-tasks", payload: body }),
      saveAnswer: async (sessionID, objective, response) => {
        const turn: AgentSessionPayload["turns"][number] = { id: randomUUID(), objective, createdAt: response.created_at,
          response: { contractVersion: response.contract_version, taskID: response.task_id,
            contextManifestID: "none-unbound-conversation", knowledgeSnapshotID: "none-unbound-conversation",
            disposition: response.disposition, createdAt: response.created_at,
            unboundConversationBlocks: response.blocks.map(block => ({ id: block.id, kind: block.kind,
              title: block.title, body: block.body, status: block.status, citation_dependency_ids: [], requires_user_decision: false })) } };
        const saved = await request({ method: "PUT", url: `/v1/agent-sessions/${sessionID}`, payload: {
          idempotency_key: randomUUID(), expected_revision: 0,
          payload: { id: sessionID, scopeKind: "unresolved_intent", personDisplayLabel: "New session",
            contextDisplayLabel: "Conversation", title: "Synthetic stage commit source", updatedAt: response.created_at,
            isUnread: false, turns: [turn] },
        } });
        expect(saved.statusCode).toBe(200);
        return saved.json<{ session: AgentSessionRecord }>().session;
      },
    });
  } finally {
    await Promise.allSettled([...requests]);
    try { await app?.close(); } finally { await pool.end(); }
    expect(poolError, "The owned stage fixture Pool must not fail silently.").toBe(false);
  }
}
