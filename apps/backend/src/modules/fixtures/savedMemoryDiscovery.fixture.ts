import { randomBytes, randomUUID } from "node:crypto";

import {
  ScriptedAgentProvider,
  type AgentToolResult,
} from "@talent-signal/agent";
import {
  type AgentSessionPayload,
  type AgentSessionRecord,
  type MemoryCommitRequest,
  type MemoryCommitResponse,
  type MemoryProposalCandidate,
  type MemoryProposalStageRequest,
  type MemoryRecallResponse,
  type MemoryReviewResponse,
  type SessionResponse,
  type UnscopedChatTaskRequest,
  type UnscopedChatTaskResponse,
} from "@talent-signal/contracts";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { expect } from "vitest";

import { buildApp } from "../../app.js";
import { inTransaction } from "../../database/pool.js";
import type { AuthContext } from "../auth.js";
import type { RemoteChatAnswerProviding, RemoteChatAnswerResult } from "../chatAnswerProvider.js";
import { encodePasswordCredential } from "../passwordCredential.js";

// The fixture is inert without the explicit disposable CI URL. Reject malformed
// URLs with a static error, never an error containing the supplied credential.
export const savedMemoryDatabase = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (savedMemoryDatabase) {
  let parsed: URL;
  try { parsed = new URL(savedMemoryDatabase); }
  catch { throw new Error("Use only the owned disposable loopback lab_regression_ci database."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.search || parsed.hash
    || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/lab_regression_ci") {
    throw new Error("Use only the owned disposable loopback lab_regression_ci database.");
  }
}

export const independentReply = "A synthetic greeting without any saved Memory.";

type Delivery = { id: string; version: number; display_text: string };

/**
 * A real tool-capable Agent implementation with a synthetic result. It delegates
 * tool dispatch to the existing ScriptedAgentProvider, never invents a `.run`
 * method on an answer-only adapter, and makes no model/network request. Only the
 * remote provider is replaced: authentication, source resolution, Memory owners,
 * Chat publication, idempotency and Session readers remain production code.
 */
class MemoryReadingProvider extends ScriptedAgentProvider implements RemoteChatAnswerProviding {
  readonly providerId = "zhipu-chat-completions" as const;
  readonly supportsImageInput = false;
  calls = 0;
  fallbackCalls = 0;
  mode: "neutral" | "recall" | "discovery" = "neutral";
  selectedMemoryID: string | null = null;
  discoveryTerms: string[] = [];
  delivered: Delivery[] = [];
  toolManifest: string[] = [];
  toolResults: readonly AgentToolResult[] = [];

  constructor() { super([], { outcome: "reply", title: "Synthetic reply", body: independentReply }); }

  async answer(): Promise<RemoteChatAnswerResult> {
    this.fallbackCalls += 1;
    throw new Error("The synthetic tool-capable provider must not enter answer fallback.");
  }

  override async run(...args: Parameters<ScriptedAgentProvider["run"]>) {
    const [request, invokeTool, signal] = args;
    this.calls += 1;
    this.delivered = (request.selfMemoryContext?.items ?? []).map(item => ({
      id: item.id, version: item.version, display_text: item.display_text,
    }));
    this.toolManifest = [...request.toolManifest];
    this.toolResults = [];
    const selected = this.delivered.find(item => item.id === this.selectedMemoryID);
    const body = this.mode === "recall"
      ? selected?.display_text ?? "No currently authorized saved Memory was delivered."
      : independentReply;
    const script = new ScriptedAgentProvider(
      this.mode === "discovery" ? [{ tool: "search_saved_memory", input: { terms: [...this.discoveryTerms], limit: 10 } }] : [],
      results => {
        this.toolResults = results;
        return { outcome: "reply", title: "Synthetic reply", body };
      },
    );
    return script.run(request, invokeTool, signal);
  }
}

export interface SavedMemoryFixture {
  pool: Pool;
  auth: AuthContext;
  provider: MemoryReadingProvider;
  request(options: Omit<InjectOptions, "headers">): Promise<LightMyRequestResponse>;
  post(request: UnscopedChatTaskRequest): Promise<LightMyRequestResponse>;
  current(): Promise<number>;
  recall(): Promise<MemoryRecallResponse>;
  acceptSelf(text: string): Promise<{ itemID: string; version: number; sourceSessionID: string }>;
  saveAnswer(sessionID: string, objective: string, answer: UnscopedChatTaskResponse,
    options?: { expectedRevision?: number; priorTurns?: AgentSessionPayload["turns"] }): Promise<AgentSessionRecord>;
}

function displayTurn(objective: string, answer: UnscopedChatTaskResponse): AgentSessionPayload["turns"][number] {
  return {
    id: randomUUID(), objective, createdAt: answer.created_at,
    response: {
      contractVersion: answer.contract_version, taskID: answer.task_id,
      // Actual unscoped responses have neither context_manifest_id nor
      // knowledge_snapshot_id. This is the existing Native/client marker,
      // never a fabricated UUID or evidence/knowledge grant.
      contextManifestID: "none-unbound-conversation",
      knowledgeSnapshotID: "none-unbound-conversation",
      disposition: answer.disposition, createdAt: answer.created_at,
      unboundConversationBlocks: answer.blocks.map(block => ({
        id: block.id, kind: block.kind, title: block.title, body: block.body,
        status: block.status, citation_dependency_ids: [], requires_user_decision: false,
      })),
    },
  };
}

function selfCandidate(text: string, sessionID: string, messageID: string): MemoryProposalCandidate {
  return {
    scope: "self", operation: "add", statement_kind: "source_statement",
    display_text: text, subject_id: null, relationship_context_id: null,
    speaker: "me", reporter: "me", valid_time: null, observed_time: null,
    time_status: "known", sensitivity: "normal", source_excerpt: text,
    source_locator: { kind: "message", session_id: sessionID, message_id: messageID },
    previous_memory_item_id: null, previous_text: null, previous_revision: null,
    reason: "Explicit synthetic human Memory acceptance for the withdrawal regression.",
  };
}

export async function withSavedMemoryFixture(operation: (fixture: SavedMemoryFixture) => Promise<void>) {
  if (!savedMemoryDatabase) throw new Error("The explicit disposable PostgreSQL gate is required.");
  const pool = new Pool({ connectionString: savedMemoryDatabase, max: 4,
    connectionTimeoutMillis: 2_000, statement_timeout: 5_000, query_timeout: 6_000 });
  const provider = new MemoryReadingProvider();
  const accountID = randomUUID(), userID = randomUUID();
  const email = `memory-discovery-${userID}@example.invalid`, password = randomBytes(24).toString("base64url");
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    // Only synthetic account/login setup is SQL. Do not hand-insert accepted
    // Memory, a successful result, a lineage row, a source grant or gold Wiki.
    await inTransaction(pool, async client => {
      await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic saved Memory discovery')",
        [accountID, `saved-memory-${accountID}`]);
      await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",
        [email, accountID, userID]);
      await client.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic Memory owner','password_human',$3)",
        [userID, accountID, email]);
      await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",
        [accountID, userID, await encodePasswordCredential(password)]);
    });
    app = await buildApp({ pool, config: { databaseUrl: savedMemoryDatabase, host: "127.0.0.1", port: 0,
      allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false,
      passwordAuthEnabled: true, passwordRegistrationEnabled: false, simulatedAuthEnabled: false,
      internalLabEnabled: false, retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 },
    remoteChatProvider: provider, personResearchProvider: null, privateConversationProvider: null,
    labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
    labCIVerifier: null, screenshotContact: null });
    await app.ready();
    const login = await app.inject({ method: "POST", url: "/v1/auth/password/login",
      payload: { identifier: email, password, client_label: "Synthetic saved Memory discovery" } });
    expect(login.statusCode).toBe(200); // Never assert/print login body or bearer.
    const signedIn = login.json<SessionResponse>();
    if (!signedIn.session_id) throw new Error("The synthetic login omitted its session identity.");
    const headers = { authorization: `Bearer ${signedIn.access_token}` };
    const auth: AuthContext = { accountId: signedIn.account.id, accountSlug: signedIn.account.slug,
      userId: signedIn.user.id, userEmail: signedIn.user.email, userKind: signedIn.user.kind,
      sessionId: signedIn.session_id };
    const activeApp = app;
    const request: SavedMemoryFixture["request"] = options => activeApp.inject({ ...options, headers }).then(value => value);
    const saveAnswer: SavedMemoryFixture["saveAnswer"] = async (sessionID, objective, answer, options = {}) => {
      const result = await request({ method: "PUT", url: `/v1/agent-sessions/${sessionID}`, payload: {
        idempotency_key: randomUUID(), expected_revision: options.expectedRevision ?? 0,
        payload: { id: sessionID, scopeKind: "unresolved_intent", personDisplayLabel: "New session",
          contextDisplayLabel: "Conversation", title: "Synthetic saved Memory reply", updatedAt: answer.created_at,
          isUnread: false, turns: [...(options.priorTurns ?? []), displayTurn(objective, answer)] },
      } });
      expect(result.statusCode).toBe(200);
      return result.json<{ session: AgentSessionRecord }>().session;
    };
    const fixture: SavedMemoryFixture = {
      pool, auth, provider, request,
      post: body => request({ method: "POST", url: "/v1/chat/unscoped-tasks", payload: body }),
      current: async () => (await request({ method: "GET", url: "/v1/auth/session" })).statusCode,
      recall: async () => {
        const response = await request({ method: "GET", url: "/v1/memory/items?surface=chat&scope=self" });
        expect(response.statusCode).toBe(200);
        return response.json<MemoryRecallResponse>();
      },
      saveAnswer,
      acceptSelf: async text => {
        provider.mode = "neutral";
        const sourceSessionID = randomUUID();
        const source = await fixture.post({ idempotency_key: randomUUID(), objective: text });
        expect(source.statusCode).toBe(201);
        const sourceRecord = await saveAnswer(sourceSessionID, text, source.json<UnscopedChatTaskResponse>());
        const messageID = sourceRecord.payload!.turns[0]!.id;
        const stageRequest: MemoryProposalStageRequest = {
          idempotency_key: randomUUID(), surface: "chat", session_id: sourceSessionID,
          source_message_id: messageID, source_task_id: null, person_id: null, relationship_context_id: null,
          contact_decision: "none", identity_clue: null, new_contact: null,
          proposer: { kind: "human", name: "Synthetic human acceptance", version: "1" },
          items: [selfCandidate(text, sourceSessionID, messageID)],
        };
        const staged = await request({ method: "POST", url: "/v1/memory/proposals", payload: stageRequest });
        expect(staged.statusCode).toBe(201);
        const proposalID = staged.json<{ proposal: { proposal_id: string } }>().proposal.proposal_id;
        const opened = await request({ method: "POST", url: `/v1/memory/proposals/${proposalID}/reviews`,
          payload: { purpose: "chat", person_id: null, relationship_context_id: null } });
        expect(opened.statusCode).toBe(200);
        const reviewed = opened.json<MemoryReviewResponse>();
        if (!reviewed.review_credential) throw new Error("The actual review omitted its confirmation credential.");
        const commitRequest: MemoryCommitRequest = {
          idempotency_key: randomUUID(), expected_proposal_revision: reviewed.review.proposal_revision,
          selected_item_ids: reviewed.review.items.map(item => item.id), contact_decision: "none",
          edited_text: {}, item_decisions: {}, expected_item_versions: {}, new_contact: null,
          reason: "Explicit synthetic human acceptance before the saved-answer regression.",
        };
        // The credential is passed only to its normal HTTP confirmation header,
        // never returned by the fixture or included in an assertion/report.
        const committed = await activeApp.inject({ method: "POST",
          url: `/v1/memory/reviews/${reviewed.review.review_scope_id}/commits`,
          headers: { ...headers, "x-memory-review-credential": reviewed.review_credential }, payload: commitRequest });
        expect(committed.statusCode).toBe(201);
        const receipt = committed.json<MemoryCommitResponse>().receipt;
        expect(receipt.created_item_ids).toHaveLength(1);
        const itemID = receipt.created_item_ids[0]!;
        const item = (await fixture.recall()).items.find(value => value.id === itemID);
        expect(item?.display_text).toBe(text);
        return { itemID, version: item!.version, sourceSessionID };
      },
    };
    await operation(fixture);
    expect(provider.fallbackCalls).toBe(0);
  } finally {
    try { await app?.close(); }
    finally { await pool.end(); }
    // The Hosted owner tears down this disposable database. This fixture never
    // deletes an unrelated account, resource, service or another test's rows.
  }
}
