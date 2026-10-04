import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import type {
  AgentProvider,
  AgentProviderInputPart,
  AgentProviderRequest,
  AgentProviderResult,
} from "@talent-signal/agent";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  RemoteChatAnswerProviding,
  RemoteChatAnswerRequest,
  RemoteChatAnswerResult,
} from "./chatAnswerProvider.js";
import type { AuthContext } from "./auth.js";
import { ApiError } from "../lib/apiError.js";
import { ConversationQueueRunner } from "./conversationQueueRunner.js";
import { registerConversationQueueRoutes } from "./conversationQueueRoutes.js";
import { registerMcpInteractionRoutes, type McpRouteOptions } from "./mcpRoutes.js";
import { mcpInteractionDependencies } from "./mcpInteractions.js";
import { readAgentSessionConversation } from "./agentSessions.js";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import { buildApp } from "../app.js";
import { taskModelCatalog, taskPromptRevision } from "./labTaskConfiguration.js";

/**
 * Production wiring proof for user-owned MCP in the ordinary queued
 * conversation: the real Fastify conversation-queue route admits the message,
 * the real runner executes the governed workspace Agent path with a scripted
 * model, the host `mcp_connections` seam stages the durable request, the real
 * resolve route executes the approved call over real HTTP against a loopback
 * synthetic MCP server, and the durable receipt re-enters the same
 * conversation through the ordinary queue. No helper-only shortcut is used.
 *
 * Without CONTACT_AGENT_TEST_DATABASE_URL the suite is explicitly skipped.
 */

const url = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (url && !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("Use an isolated local PostgreSQL database for MCP conversation tests.");
}
const pool = url
  ? new Pool({ connectionString: url, idleTimeoutMillis: 0, max: 6 })
  : null;
const suite = url ? describe : describe.skip;
vi.setConfig({ testTimeout: 30_000 });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(25);
  }
  throw new Error("Timed out waiting for the expected MCP conversation state.");
}

function queueDiagnosticLogger() {
  const events: Record<string, unknown>[] = [];
  const capture = (level: string, metadata: Record<string, unknown>) => {
    const safe: Record<string, unknown> = { level };
    for (const key of ["queue_entry_id", "run_id", "failure_code", "status"]) {
      const value = metadata[key];
      if (typeof value === "string" && /^[a-z0-9_-]{1,80}$/iu.test(value)) safe[key] = value;
    }
    if (typeof metadata.duration_ms === "number") safe.duration_ms = metadata.duration_ms;
    const code = (metadata.err as { code?: unknown } | undefined)?.code;
    if (typeof code === "string" && /^[a-z0-9_-]{1,80}$/iu.test(code)) safe.error_code = code;
    events.push(safe);
    if (events.length > 60) events.shift();
  };
  return { events, logger: {
    info: (metadata: Record<string, unknown>) => capture("info", metadata),
    warn: (metadata: Record<string, unknown>) => capture("warn", metadata),
    error: (metadata: Record<string, unknown>) => capture("error", metadata),
  } };
}

async function waitForCompletedQueue(accountId: string, expectedCount: number, events: Record<string, unknown>[] = []) {
  const started = Date.now();
  try {
    await waitFor(async () => {
      const rows = await pool!.query<{ status: string }>(
        "SELECT status FROM conversation_queue_entries WHERE account_id=$1 ORDER BY created_at", [accountId]);
      if (rows.rows.some((row) => ["failed", "cancelled", "interrupted"].includes(row.status))) {
        throw new Error("The synthetic MCP queue reached an unexpected terminal state.");
      }
      return rows.rows.length === expectedCount && rows.rows.every((row) => row.status === "completed");
    });
  } catch (error) {
    // Control-plane metadata only, captured before fixture teardown. Exclude
    // objectives, provider prose, results and arbitrary span/error contents.
    const queue = await pool!.query(`SELECT id,status,failure_code,attempt,
      lease_generation,lease_expires_at>clock_timestamp() AS lease_live,
      result IS NOT NULL AS has_result,claimed_at,result_recorded_at,persisted_at,completed_at,updated_at
      FROM conversation_queue_entries WHERE account_id=$1 ORDER BY created_at`, [accountId]);
    const spans = await pool!.query(`SELECT s.span->>'name' AS name,s.span->>'kind' AS kind,
      s.span->>'status' AS status,s.span->>'started_at' AS started_at,
      s.span->>'finished_at' AS finished_at,
      s.span->'metadata'->>'failure_code' AS failure_code,
      s.span->'metadata'->>'duration_ms' AS duration_ms
      FROM product_run_spans s JOIN product_runs r ON r.id=s.run_id
      WHERE r.account_id=$1 ORDER BY s.created_at DESC LIMIT 30`, [accountId]);
    throw new Error(`Synthetic MCP queue did not complete: ${JSON.stringify({
      elapsed_wait_ms: Date.now() - started, expected_count: expectedCount,
      queue: queue.rows, spans: spans.rows, events,
    })}`, { cause: error });
  }
}

class ScriptedMcpConversationProvider implements RemoteChatAnswerProviding {
  readonly providerId = "zhipu-chat-completions" as const;
  readonly id = "zhipu-chat-completions";
  readonly model = "synthetic-conversation-model";
  readonly supportsImageInput = false;
  readonly objectives: string[] = [];
  readonly systemPrompts: string[] = [];
  readonly histories: ReadonlyArray<{ message_id: string; text: string }>[] = [];
  toolResults: unknown[] = [];
  connectionId = "";
  sessionId = "";

  async answer(_request: RemoteChatAnswerRequest): Promise<RemoteChatAnswerResult> {
    throw new Error("The governed agent path is required for this synthetic provider.");
  }

  async run(
    request: AgentProviderRequest,
    invokeTool: (name: string, input: unknown) => Promise<{ ok: boolean; callID: string; name: string; data?: unknown }>,
    signal: AbortSignal,
  ): Promise<AgentProviderResult> {
    this.objectives.push(request.objective);
    this.systemPrompts.push(request.systemPrompt);
    this.histories.push(request.conversationHistory ?? []);
    signal.throwIfAborted();
    if (this.objectives.length === 1) {
      // The ordinary Agent stages one exact tool-call proposal through the
      // real host seam. Nothing executes inside the model.
      const result = await invokeTool("mcp_connections", {
        arguments: JSON.stringify({ query: "hello" }),
        connection_id: this.connectionId,
        operation: "propose_call",
        purpose: "Answer the original question with one lookup.",
        tool_name: "lookup",
      });
      this.toolResults.push(result);
      return {
        structuredOutput: {
          outcome: "reply",
          title: "回复",
          body: "我已提交一次工具调用请求，等待你的确认。",
        },
        inputTokens: 1,
        outputTokens: 1,
        estimatedUsd: 0,
        turns: 1,
        permissionDenials: [],
      };
    }
    return {
      structuredOutput: {
        outcome: "reply",
        title: "回复",
        body: "已用工具结果继续完成原任务。",
      },
      inputTokens: 1,
      outputTokens: 1,
      estimatedUsd: 0,
      turns: 1,
      permissionDenials: [],
    };
  }
}

const servers: http.Server[] = [];
const syntheticToolResultText = "one row from the real tool " + "synthetic detail; ".repeat(35)
  + "synthetic-result-after-400-characters";

async function startSyntheticMcpServer(): Promise<{
  origin: string;
  calls: Array<{ method: string; headers: http.IncomingHttpHeaders; params: unknown }>;
  close: () => Promise<void>;
}> {
  const calls: Array<{ method: string; headers: http.IncomingHttpHeaders; params: unknown }> = [];
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: number;
      method: string;
      params?: unknown;
    };
    calls.push({ headers: request.headers, method: body.method, params: body.params });
    if (body.method === "initialize") {
      response.writeHead(200, {
        "content-type": "application/json",
        "mcp-session-id": "synthetic-conversation-session",
      });
      response.end(
        JSON.stringify({
          id: body.id,
          jsonrpc: "2.0",
          result: {
            capabilities: {},
            protocolVersion: "2025-11-25",
            serverInfo: { name: "synthetic", version: "1" },
          },
        }),
      );
      return;
    }
    if (body.method === "notifications/initialized") {
      response.writeHead(202);
      response.end();
      return;
    }
    if (body.method === "tools/list") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: body.id,
          jsonrpc: "2.0",
          result: {
            tools: [
              {
                description: "Lookup a thing",
                inputSchema: {
                  type: "object",
                  properties: { query: { type: "string", minLength: 1 } },
                  required: ["query"],
                  additionalProperties: false,
                },
                name: "lookup",
              },
            ],
          },
        }),
      );
      return;
    }
    if (body.method === "tools/call") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: body.id,
          jsonrpc: "2.0",
          result: { content: [{ text: syntheticToolResultText, type: "text" }] },
        }),
      );
      return;
    }
    response.writeHead(500);
    response.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    origin: `http://127.0.0.1:${port}`,
  };
}

interface Fixture {
  accountId: string;
  auth: AuthContext;
  connectionId: string;
  sessionId: string;
  userId: string;
}

async function seedFixture(
  connectionOrigin: string | null,
): Promise<{ fixture: Fixture; connectionId: string | null }> {
  const accountId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const connectionId = randomUUID();
  const auth: AuthContext = {
    accountId,
    accountSlug: `mcc-${accountId.slice(0, 8)}`,
    sessionId: randomUUID(),
    userEmail: `${userId}@synthetic.local`,
    userId,
    userKind: "simulated_human",
  };
  await pool!.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,$3)", [
    accountId,
    auth.accountSlug,
    "MCP conversation proof",
  ]);
  await pool!.query(
    "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'MCP chat','simulated_human')",
    [userId, accountId, auth.userEmail],
  );
  await pool!.query(
    "INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'synthetic',clock_timestamp()+interval '1 hour')",
    [auth.sessionId, accountId, userId, randomBytes(32).toString("hex")],
  );
  const now = new Date().toISOString();
  const payload = {
    id: sessionId,
    scopeKind: "unresolved_intent",
    personDisplayLabel: "",
    contextDisplayLabel: "",
    title: "",
    turns: [],
    updatedAt: now,
    createdAt: now,
  };
  await pool!.query(
    `INSERT INTO agent_sessions(account_id,id,created_by_user_id,revision,payload,created_at,expires_at)
     VALUES($1,$2,$3,1,$4::jsonb,now(),now()+interval '7 days')`,
    [accountId, sessionId, userId, JSON.stringify(payload)],
  );
  if (connectionOrigin) {
    await pool!.query(
      `INSERT INTO mcp_connections(
         account_id, id, created_by_user_id, friendly_name, server_url,
         credential_ciphertext, status, discovered_tools, tools_count, revision,
         auth_mode, nango_connection_id, nango_provider
       ) VALUES ($1,$2,$3,'Synthetic tool server',$4,NULL,'verified',$5,1,1,'anonymous',NULL,NULL)`,
      [
        accountId,
        connectionId,
        userId,
        `${connectionOrigin}/mcp`,
        JSON.stringify([
          {
            description: "Lookup a thing",
            input_schema: JSON.stringify({
              type: "object",
              properties: { query: { type: "string", minLength: 1 } },
              required: ["query"],
              additionalProperties: false,
            }),
            name: "lookup",
            read_only: true,
          },
        ]),
      ],
    );
    return { connectionId, fixture: { accountId, auth, connectionId, sessionId, userId } };
  }
  return {
    connectionId: null,
    fixture: { accountId, auth, connectionId, sessionId, userId },
  };
}

async function removeFixture(accountId: string): Promise<void> {
  // Mirrors the Lab cleanup manifest: every account-scoped table is swept,
  // then the control rows. Each statement tolerates a table the run never
  // touched.
  const manifest = await pool!.query<{ table_name: string }>(
    "SELECT table_name FROM lab_test_workspace_table_manifest WHERE scope='account'",
  );
  // Two passes resolve intra-manifest reference order without hard-coding it.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const { table_name: table } of manifest.rows) {
      await pool!.query(`DELETE FROM ${table} WHERE account_id=$1`, [accountId]).catch(() => undefined);
    }
  }
  for (const table of [
    "conversation_queue_entries",
    "conversation_queue_state",
    "agent_sessions",
    "idempotency_records",
  ]) {
    await pool!.query(`DELETE FROM ${table} WHERE account_id=$1`, [accountId]).catch(() => undefined);
  }
  await pool!.query("DELETE FROM audit_events WHERE account_id=$1", [accountId]).catch(() => undefined);
  await pool!.query("DELETE FROM harness_source_generations WHERE account_id=$1", [accountId]).catch(() => undefined);
  await pool!.query("DELETE FROM sessions WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM users WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM accounts WHERE id=$1", [accountId]);
}

beforeAll(async () => {
  if (!pool) return;
  const ready = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_name='mcp_interaction_requests'",
  );
  if (!ready.rowCount) {
    throw new Error(
      "CONTACT_AGENT_TEST_DATABASE_URL must point at a database migrated through 089_mcp_interactions.",
    );
  }
}, 30_000);

afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await pool?.end();
});

type StagedStep = { tool: Record<string, unknown>; reply: string; holdAfter?: () => Promise<void> };

class ScriptedStagingProvider implements RemoteChatAnswerProviding {
  readonly providerId = "zhipu-chat-completions" as const;
  readonly id = "zhipu-chat-completions";
  readonly model = "synthetic-conversation-model";
  readonly supportsImageInput = false;
  readonly objectives: string[] = [];
  readonly histories: ReadonlyArray<{ message_id: string; text: string }>[] = [];

  constructor(private readonly steps: StagedStep[]) {}

  async answer(_request: RemoteChatAnswerRequest): Promise<RemoteChatAnswerResult> {
    throw new Error("The governed agent path is required for this synthetic provider.");
  }

  async run(
    request: AgentProviderRequest,
    invokeTool: (name: string, input: unknown) => Promise<unknown>,
    signal: AbortSignal,
  ): Promise<AgentProviderResult> {
    signal.throwIfAborted();
    const step = this.steps[this.objectives.length];
    this.histories.push(request.conversationHistory ?? []);
    this.objectives.push(request.objective);
    if (step) {
      await invokeTool("mcp_connections", step.tool);
      if (step.holdAfter) await step.holdAfter();
      return {
        structuredOutput: { outcome: "reply", title: "回复", body: step.reply },
        inputTokens: 1, outputTokens: 1, estimatedUsd: 0, turns: 1, permissionDenials: [],
      };
    }
    return {
      structuredOutput: { outcome: "reply", title: "回复", body: "已继续原任务。" },
      inputTokens: 1, outputTokens: 1, estimatedUsd: 0, turns: 1, permissionDenials: [],
    };
  }
}

async function withStack<T>(
  fixture: Fixture,
  provider: RemoteChatAnswerProviding,
  run: (app: Fastify.FastifyInstance, diagnostics: Record<string, unknown>[]) => Promise<T>,
): Promise<T> {
  const app = Fastify();
  app.decorateRequest("auth", null as unknown as AuthContext);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, request_id: _request.id } });
      return;
    }
    reply.status(500).send({ error: { code: "INTERNAL", message: (error as Error).message, request_id: _request.id } });
  });
  registerConversationQueueRoutes(app, pool!, async (request) => {
    (request as unknown as { auth: AuthContext }).auth = fixture.auth;
  });
  registerMcpInteractionRoutes(app, pool!, async (request) => {
    (request as unknown as { auth: AuthContext }).auth = fixture.auth;
  }, {
    interactions: mcpInteractionDependencies({
      allowInsecureTls: true,
      allowedOrigins: [process.env.TALENT_SIGNAL_MCP_ALLOWED_ORIGINS ?? ""],
      resolver: async () => [{ address: "127.0.0.1", family: 4 }],
    }),
  });
  await app.ready();
  const diagnostics = queueDiagnosticLogger();
  const runner = new ConversationQueueRunner({
    pool: pool!,
    provider,
    logger: diagnostics.logger,
    pollIntervalMs: 20,
    heartbeatMs: 60,
    recoveryIntervalMs: 10_000,
    workerId: `mcp-${randomUUID()}`,
  });
  runner.start();
  try {
    return await run(app, diagnostics.events);
  } finally {
    await runner.close();
    await app.close();
  }
}

async function admit(app: Fastify.FastifyInstance, fixture: Fixture, objective: string) {
  return app.inject({
    method: "POST",
    payload: {
      idempotency_key: `admit-${randomUUID()}`,
      message_id: randomUUID(),
      objective,
      session_id: fixture.sessionId,
    },
    url: `/v1/agent-sessions/${fixture.sessionId}/conversation-queue`,
  });
}

async function pendingRequest(app: Fastify.FastifyInstance, fixture: Fixture) {
  const response = await app.inject({
    method: "GET",
    url: `/v1/mcp/interactions?session_id=${fixture.sessionId}`,
  });
  const body = response.json() as {
    requests: Array<{
      id: string; call_id: string; kind: string; state: string; revision: number;
      arguments_display: string; argument_schema: string | null; receipt: unknown;
    }>;
  };
  return body.requests.find((request) => request.state === "pending") ?? null;
}

suite("user-owned MCP in the ordinary queued conversation", () => {
  it("uses the production default SDK adapter for a host result while keeping real-login Lab selection", async () => {
    const { fixture } = await seedFixture(null);
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;
    const selected: string[] = [];
    let releaseContinuation!: () => void;
    const continuationGate = new Promise<void>((resolve) => { releaseContinuation = resolve; });
    const makeProvider = (label: string): RemoteChatAnswerProviding & AgentProvider => {
      const run: AgentProvider["run"] = async (request, invoke, signal) => {
        signal.throwIfAborted(); await request.assertCurrent?.();
        selected.push(label);
        if (label === "default") await continuationGate;
        if (selected.length === 1) {
          const staged = await invoke("mcp_connections", { operation: "propose_choice",
            options: JSON.stringify([{ id: "anonymous", label: "No sign-in" }, { id: "bearer", label: "API token" }]),
            purpose: "Choose the synthetic connection mode." }, signal);
          expect(staged.ok).toBe(true);
        }
        return { structuredOutput: { outcome: "reply", title: "Synthetic reply", body: "Synthetic governed continuation." },
          inputTokens: 1, outputTokens: 1, estimatedUsd: 0, turns: 1, permissionDenials: [] };
      };
      const adapter: RemoteChatAnswerProviding & AgentProvider = { providerId: "claude-agent-sdk", id: "claude-agent-sdk", model: `synthetic-${label}`,
        sdkVersion: "synthetic-local", inputCapabilities: { text: true, image: false, imageUnderstanding: false },
        supportsImageInput: false, supportsPromptPresets: true,
        answer: async () => { throw new Error("The production governed agent path is required"); },
        run, runWithPromptPreset: async (request, invoke, signal, preset, observed) => {
          const result = await run(request, invoke, signal);
          const entry = taskModelCatalog([adapter]).find((item) => item.task === "unscoped_chat")!;
          // This adapter ran locally; it truthfully reports no model dispatch.
          observed({ actual_model: null, prompt_revision: taskPromptRevision(entry, preset), actual_prompt_revision: null,
            requests_started: 0, responses_received: 0, input_tokens: null, output_tokens: null, provider_request_id: null });
          return result;
        } };
      return adapter;
    };
    const defaultAdapter = makeProvider("default");
    const trialAdapter = makeProvider("trial");
    // Disable optional broker traffic explicitly. This test owns only the
    // local synthetic queue; no SDK/model or provider credentials are used.
    vi.stubEnv("NANGO_API_KEY", ""); vi.stubEnv("NANGO_WEBHOOK_SIGNING_KEY", "");
    try {
      app = await buildApp({ pool: pool!, config: { databaseUrl: url!, host: "127.0.0.1", port: 0,
        allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false,
        passwordAuthEnabled: false, passwordRegistrationEnabled: false, simulatedAuthEnabled: true,
        internalLabEnabled: true, retentionSweepIntervalMs: 60000, sessionTtlSeconds: 3600 },
        remoteChatProvider: defaultAdapter, labProviders: new Map([[trialAdapter.model, trialAdapter]]),
        privateConversationProvider: null, personResearchProvider: null, screenshotContact: null, labJobWorkerEnabled: false });
      const login = await app.inject({ method: "POST", url: "/v1/auth/simulated-login",
        payload: { account_slug: fixture.auth.accountSlug, user_email: fixture.auth.userEmail, client_label: "SDK host result proof" } });
      expect(login.statusCode).toBe(200);
      const headers = { authorization: `Bearer ${login.json().access_token}` };
      const trial = await app.inject({ method: "POST", url: "/v1/lab/task-trials", headers,
        payload: { id: randomUUID(), task: "unscoped_chat", model: trialAdapter.model,
          prompt_preset: "baseline", duration_minutes: 5, replaces_trial_id: null } });
      expect(trial.statusCode).toBe(200);
      const admitted = await app.inject({ method: "POST", headers,
        url: `/v1/agent-sessions/${fixture.sessionId}/conversation-queue`,
        payload: { session_id: fixture.sessionId, message_id: randomUUID(), idempotency_key: `normal-${randomUUID()}`, objective: "Add a synthetic MCP connection." } });
      expect(admitted.statusCode).toBe(202);
      await waitFor(async () => (await pool!.query("SELECT count(*) AS n FROM conversation_queue_entries WHERE account_id=$1 AND status='completed'", [fixture.accountId])).rows[0].n === "1");
      expect(selected).toEqual(["trial"]);
      const requests = await pool!.query("SELECT id,call_id,revision FROM mcp_interaction_requests WHERE account_id=$1 AND kind='choice' AND state='pending'", [fixture.accountId]);
      expect(requests.rows).toHaveLength(1);
      const choice = requests.rows[0]!;
      const resolved = await app.inject({ method: "POST", headers,
        url: `/v1/mcp/interactions/${choice.id}/resolve`, payload: { action: "submit", choice_id: "anonymous",
          expected_revision: choice.revision, idempotency_key: `resolve-${randomUUID()}` } });
      expect(resolved.statusCode).toBe(200);
      await waitFor(() => selected.length === 2);
      expect(selected).toEqual(["trial", "default"]);
      const canonical = await app.inject({ method: "GET", headers,
        url: `/v1/agent-sessions/${fixture.sessionId}/conversation-queue` });
      expect(canonical.statusCode).toBe(200);
      expect(canonical.json().active?.host_result).toMatchObject({ request_id: choice.id, call_id: choice.call_id,
        kind: "choice", outcome: "submitted", actor_user_id: fixture.userId });
      const hostCall = canonical.json().active.host_result.call_id;
      releaseContinuation();
      await waitFor(async () => (await pool!.query("SELECT count(*) AS n FROM conversation_queue_entries WHERE account_id=$1 AND status='completed'", [fixture.accountId])).rows[0].n === "2");
      const entries = await pool!.query("SELECT auth_session_id,host_result,status,failure_code FROM conversation_queue_entries WHERE account_id=$1 ORDER BY sequence", [fixture.accountId]);
      expect(entries.rows[0].auth_session_id).not.toBeNull();
      expect(entries.rows[1]).toMatchObject({ auth_session_id: null, status: "completed", failure_code: null,
        host_result: { request_id: choice.id, call_id: hostCall, kind: "choice", outcome: "submitted", actor_user_id: fixture.userId } });
    } finally {
      releaseContinuation(); await app?.close(); vi.unstubAllEnvs(); await removeFixture(fixture.accountId);
    }
  });

  it("stages from the real Agent tool, executes the exact approval over HTTP, and continues the original task", async () => {
    const synthetic = await startSyntheticMcpServer();
    // The Agent-side staging adapter and the resolve route share the same
    // deployment configuration surface: the operator allowlist.
    process.env.TALENT_SIGNAL_MCP_ALLOWED_ORIGINS = synthetic.origin;
    const { fixture } = await seedFixture(synthetic.origin);
    const provider = new ScriptedMcpConversationProvider();
    provider.connectionId = fixture.connectionId;
    provider.sessionId = fixture.sessionId;
    const diagnostics = queueDiagnosticLogger();
    const app = Fastify();
    app.decorateRequest("auth", null as unknown as AuthContext);
    app.setErrorHandler((error, _request, reply) => {
      if (!(error instanceof ApiError)) console.error("UNEXPECTED", error);
      if (error instanceof ApiError) {
        reply.status(error.statusCode).send({
          error: { code: error.code, message: error.message },
        });
        return;
      }
      reply.status(500).send({ error: { code: "INTERNAL", message: (error as Error).message } });
    });
    const routeOptions: McpRouteOptions = {
      interactions: mcpInteractionDependencies({
        allowInsecureTls: true,
        allowedOrigins: [synthetic.origin],
        resolver: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    };
    registerConversationQueueRoutes(app, pool!, async (request) => {
      (request as unknown as { auth: AuthContext }).auth = fixture.auth;
    });
    registerMcpInteractionRoutes(app, pool!, async (request) => {
      (request as unknown as { auth: AuthContext }).auth = fixture.auth;
    }, routeOptions);
    await app.ready();
    const runner = new ConversationQueueRunner({
      pool: pool!,
      provider,
      logger: diagnostics.logger,
      pollIntervalMs: 20,
      heartbeatMs: 60,
      recoveryIntervalMs: 10_000,
      workerId: `mcp-${randomUUID()}`,
    });
    runner.start();
    try {
      // 1. The ordinary production route admits the user's message.
      const objective = "请用 lookup 工具回答原始问题。";
      const admitted = await app.inject({
        method: "POST",
        payload: {
          idempotency_key: `admit-${randomUUID()}`,
          message_id: randomUUID(),
          objective,
          session_id: fixture.sessionId,
        },
        url: `/v1/agent-sessions/${fixture.sessionId}/conversation-queue`,
      });
      expect(admitted.statusCode).toBe(202);

      // 2. The governed Agent run stages the exact call through the host tool.
      await waitFor(() => provider.objectives.length === 1);
      await waitFor(() => provider.toolResults.length === 1);
      expect(provider.toolResults[0]).toMatchObject({ ok: true });
      let pendingId = "";
      await waitFor(async () => {
        const response = await app.inject({
          method: "GET",
          url: `/v1/mcp/interactions?session_id=${fixture.sessionId}`,
        });
        const body = response.json() as {
          requests: Array<{ id: string; state: string }>;
        };
        const found = body.requests.find((request) => request.state === "pending");
        pendingId = found?.id ?? "";
        return Boolean(found);
      });
      const listResponse = await app.inject({
        method: "GET",
        url: `/v1/mcp/interactions?session_id=${fixture.sessionId}`,
      });
      const pending = (listResponse.json() as {
        requests: Array<{
          id: string;
          call_id: string;
          state: string;
          revision: number;
          arguments_display: string;
          argument_schema: string | null;
          receipt: unknown;
        }>;
      }).requests.find((request) => request.id === pendingId)!;
      expect(pending.state).toBe("pending");
      expect(pending.receipt).toBeNull();
      expect(pending.arguments_display).toContain("hello");
      expect(pending.argument_schema).toContain("query");

      // 3. The staged reference rides the persisted answer block once the
      // first turn is durably written.
      await waitForCompletedQueue(fixture.accountId, 1, diagnostics.events);
      const conversation = await readAgentSessionConversation(pool!, fixture.auth, fixture.sessionId, {
        personId: null,
        relationshipContextId: null,
      });
      expect(conversation.messages.map((message) => message.text)).toContain(objective);
      const payload = await pool!.query<{ payload: unknown }>(
        "SELECT payload FROM agent_sessions WHERE account_id=$1 AND id=$2",
        [fixture.accountId, fixture.sessionId],
      );
      const serialized = JSON.stringify(payload.rows[0]!.payload);
      expect(serialized).toContain(pending.id);
      expect(serialized).toContain(pending.call_id);

      // 4. The human approves exactly the staged call through the real route.
      const resolved = await app.inject({
        method: "POST",
        payload: {
          action: "approve",
          expected_revision: pending.revision ?? 1,
          idempotency_key: `approve-${randomUUID()}`,
        },
        url: `/v1/mcp/interactions/${pending.id}/resolve`,
      });
      if (resolved.statusCode !== 200) throw new Error(`resolve failed: ${resolved.statusCode} ${resolved.body}`);
      const resolvedBody = resolved.json() as {
        request: {
          state: string;
          receipt: {
            call_id: string;
            outcome: string;
            result_summary: string | null;
            server_origin: string;
            source: { kind: string; protocol_version: string | null };
          };
        };
      };
      expect(resolvedBody.request.state).toBe("submitted");
      expect(resolvedBody.request.receipt.outcome).toBe("succeeded");
      expect(resolvedBody.request.receipt.result_summary).toContain("one row from the real tool");
      expect(resolvedBody.request.receipt.source.kind).toBe("mcp_tool_result");
      expect(resolvedBody.request.receipt.source.protocol_version).toBe("2025-11-25");

      // The remote effect happened exactly once, over real HTTP with the
      // negotiated session and protocol headers.
      const toolCalls = synthetic.calls.filter((call) => call.method === "tools/call");
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]!.headers["mcp-session-id"]).toBe("synthetic-conversation-session");
      expect(toolCalls[0]!.params).toEqual({
        arguments: { query: "hello" },
        name: "lookup",
      });

      // 5. The durable result re-enters the same conversation through the
      // ordinary queue and the Agent continues the original task.
      await waitFor(() => provider.objectives.length === 2);
      const continuation = provider.objectives[1]!;
      expect(continuation).toContain(pending.call_id);
      expect(continuation).toContain("Continue the original task");
      expect(continuation).not.toContain("synthetic-result-after-400-characters");
      expect(provider.systemPrompts[1]).toContain('"result_json":');
      expect(provider.systemPrompts[1]).toContain(syntheticToolResultText);
      const secondHistory = provider.histories[1]!;
      expect(secondHistory.some((message) => message.text === objective)).toBe(true);
      const completion = await waitForCompletedQueue(fixture.accountId, 2, diagnostics.events).then(() => true);
      expect(completion).toBe(true);

      // No blind retry: one staged call, one claim, one remote effect.
      const toolRows = await pool!.query<{ state: string; revision: number }>(
        "SELECT state, revision FROM mcp_tool_calls WHERE account_id=$1",
        [fixture.accountId],
      );
      expect(toolRows.rows).toHaveLength(1);
      expect(toolRows.rows[0]!.state).toBe("succeeded");
      expect(synthetic.calls.filter((call) => call.method === "tools/call")).toHaveLength(1);
    } finally {
      delete process.env.TALENT_SIGNAL_MCP_ALLOWED_ORIGINS;
      await runner.close();
      await app.close();
      await removeFixture(fixture.accountId);
      await synthetic.close();
    }
  });

  it("queues an immutable host result as its own entry while the original run's steering intake is open", async () => {
    const { fixture } = await seedFixture(null);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = new ScriptedStagingProvider([
      {
        holdAfter: () => held,
        reply: "请选择连接方式。",
        tool: {
          operation: "propose_choice",
          options: JSON.stringify([
            { id: "anonymous", label: "No sign-in" },
            { id: "bearer", label: "API token" },
          ]),
          purpose: "How should this service connect?",
        },
      },
    ]);
    try {
      await withStack(fixture, provider, async (app, diagnostics) => {
        try {
          expect((await admit(app, fixture, "帮我添加服务。")).statusCode).toBe(202);
          await waitFor(() => provider.objectives.length === 1);
          await waitFor(async () => Boolean(await pendingRequest(app, fixture)));
          const pending = (await pendingRequest(app, fixture))!;
          // The human resolves the card while the original run is still live and
          // its steering intake is still open.
          const running = await pool!.query<{ status: string; steer_group_entry_id: string | null }>(
            "SELECT status, steer_group_entry_id FROM conversation_queue_entries WHERE account_id=$1 ORDER BY created_at",
            [fixture.accountId],
          );
          expect(running.rows[0]!.status).toBe("running");
          const resolved = await app.inject({
            method: "POST",
            payload: {
              action: "submit",
              choice_id: "bearer",
              expected_revision: pending.revision,
              idempotency_key: `steer-${randomUUID()}`,
            },
            url: `/v1/mcp/interactions/${pending.id}/resolve`,
          });
          expect(resolved.statusCode).toBe(200);

          // The host result entered its OWN queue entry and never attached to
          // the live steering leader.
          await waitFor(async () => {
            const rows = await pool!.query<{ steer_group_entry_id: string | null; host_result: unknown }>(
              "SELECT steer_group_entry_id, host_result FROM conversation_queue_entries WHERE account_id=$1 ORDER BY created_at",
              [fixture.accountId],
            );
            return rows.rows.length === 2 && Boolean(rows.rows[1]!.host_result);
          });
          const entries = await pool!.query<{ id: string; objective: string; revision: number; steer_group_entry_id: string | null; host_result: { outcome: string; request_id: string; actor_user_id: string } | null; status: string }>(
            "SELECT id, objective, revision, steer_group_entry_id, host_result, status FROM conversation_queue_entries WHERE account_id=$1 ORDER BY created_at",
            [fixture.accountId],
          );
          expect(entries.rows).toHaveLength(2);
          expect(entries.rows[1]!.steer_group_entry_id).toBeNull();
          expect(entries.rows[1]!.host_result).toMatchObject({
            actor_user_id: fixture.userId,
            outcome: "submitted",
            request_id: pending.id,
          });

          // A forged API edit cannot rewrite the objective associated with the
          // real human decision, even while the host continuation is queued.
          const before = await app.inject({ method: "GET",
            url: `/v1/agent-sessions/${fixture.sessionId}/conversation-queue` });
          const editKey = `host-edit-${randomUUID()}`;
          const edited = await app.inject({ method: "POST",
            url: `/v1/agent-sessions/${fixture.sessionId}/conversation-queue/mutations`,
            payload: { kind: "edit", queue_entry_id: entries.rows[1]!.id,
              objective: "Forged replacement for the accepted host result.",
              expected_revision: before.json().revision, idempotency_key: editKey } });
          expect(edited.statusCode).toBe(409);
          expect(edited.json().error.code).toBe("CONVERSATION_QUEUE_HOST_RESULT_IMMUTABLE");
          const after = await app.inject({ method: "GET",
            url: `/v1/agent-sessions/${fixture.sessionId}/conversation-queue` });
          expect(after.json().revision).toBe(before.json().revision);
          expect(after.json().queued).toEqual(before.json().queued);
          const unchanged = await pool!.query(
            "SELECT objective, revision, host_result, status FROM conversation_queue_entries WHERE account_id=$1 AND id=$2",
            [fixture.accountId, entries.rows[1]!.id],
          );
          expect(unchanged.rows[0]).toMatchObject({ objective: entries.rows[1]!.objective,
            revision: entries.rows[1]!.revision, host_result: entries.rows[1]!.host_result, status: "queued" });
          expect((await pool!.query(
            "SELECT 1 FROM conversation_queue_operations WHERE account_id=$1 AND idempotency_key=$2",
            [fixture.accountId, editKey],
          )).rowCount).toBe(0);

          // Release the original run; both complete and the typed result is the
          // durable turn provenance, not a fabricated user message.
          release();
          await waitForCompletedQueue(fixture.accountId, 2, diagnostics);
          const payload = await pool!.query<{ payload: { turns: Array<{ response?: { hostResult?: { request_id: string } } }> } }>(
            "SELECT payload FROM agent_sessions WHERE account_id=$1",
            [fixture.accountId],
          );
          const turns = payload.rows[0]!.payload.turns;
          const hostTurn = turns.find((turn) => turn.response?.hostResult);
          expect(hostTurn?.response?.hostResult?.request_id).toBe(pending.id);
          // The ordinary history projection presents it as host result data.
          const conversation = await readAgentSessionConversation(pool!, fixture.auth, fixture.sessionId, {
            personId: null,
            relationshipContextId: null,
          });
          // The typed human result never appears as a human-authored user turn.
          const userTexts = conversation.messages
            .filter((message) => message.role === "user")
            .map((message) => message.text);
          expect(userTexts.join("\n")).not.toContain("The user chose");
          expect(userTexts.join("\n")).not.toContain("MCP interaction result");
        } finally {
          release();
        }
      });
    } finally {
      release();
      await removeFixture(fixture.accountId);
    }
  });

  it("completes the full chat acceptance chain from zero connections", async () => {
    const synthetic = await startSyntheticMcpServer();
    process.env.TALENT_SIGNAL_MCP_ALLOWED_ORIGINS = synthetic.origin;
    const { fixture } = await seedFixture(null);
    const provider = new AddChainProvider(synthetic.origin);
    const toolCalls: Array<{ params: unknown; headers: http.IncomingHttpHeaders }> = [];
    try {
      await withStack(fixture, provider, async (app) => {
        const objective = "请用工具服务器回答原始问题。";
        expect((await admit(app, fixture, objective)).statusCode).toBe(202);
        // 1. The Agent stages the connection add; nothing exists yet.
        await waitFor(() => provider.objectives.length === 1);
        await waitFor(() => provider.toolResults.length === 1);
        expect(provider.toolResults[0]).toMatchObject({ ok: true });
        const addRequest = await pendingRequest(app, fixture);
        expect(addRequest?.kind).toBe("form");

        // 2. The human approves; the server really handshakes and discovers.
        const approved = await app.inject({
          method: "POST",
          payload: { action: "approve", expected_revision: addRequest!.revision, idempotency_key: `a-${randomUUID()}` },
          url: `/v1/mcp/interactions/${addRequest!.id}/resolve`,
        });
        expect(approved.statusCode).toBe(200);
        expect((approved.json() as { request: { state: string } }).request.state).toBe("submitted");

        // 3. The verified continuation re-enters the same conversation and the
        // Agent proposes the exact tool call without repeating the task.
        // The durable outbox intent settled exactly once and delivered.
        const outbox = await pool!.query<{ state: string; attempts: number }>(
          "SELECT state, attempts FROM mcp_continuation_outbox WHERE account_id=$1",
          [fixture.accountId],
        );
        expect(outbox.rows).toHaveLength(1);
        expect(outbox.rows[0]).toMatchObject({ state: "delivered", attempts: 1 });
        await waitFor(() => provider.objectives.length === 2);
        expect(provider.objectives[1]).toContain("verified and ready");
        expect(provider.objectives[1]).toContain("Continue the original task");
        try {
          await waitFor(async () => {
            const request = await pendingRequest(app, fixture);
            return request?.kind === "approval";
          });
        } catch (error) {
          const conns = await pool!.query("SELECT id,status,tools_count FROM mcp_connections WHERE account_id=$1", [fixture.accountId]);
          const entries = await pool!.query("SELECT status, failure_code, objective FROM conversation_queue_entries WHERE account_id=$1 ORDER BY created_at", [fixture.accountId]);
          const payload = await pool!.query("SELECT payload::text AS payload FROM agent_sessions WHERE account_id=$1", [fixture.accountId]);
          throw new Error(`no approval staged: err2=${JSON.stringify(provider.toolResults[2] ?? provider.toolResults[1])}`);
        }
        const pendingCall = (await pendingRequest(app, fixture))!;

        // 4. The exact approval runs the real tools/call over HTTP.
        const resolved = await app.inject({
          method: "POST",
          payload: { action: "approve", expected_revision: pendingCall.revision, idempotency_key: `b-${randomUUID()}` },
          url: `/v1/mcp/interactions/${pendingCall.id}/resolve`,
        });
        expect(resolved.statusCode).toBe(200);
        const receipt = (resolved.json() as { request: { receipt: { outcome: string; result_summary: string | null; call_id: string } } }).request.receipt;
        expect(receipt.outcome).toBe("succeeded");
        expect(receipt.result_summary).toContain("one row from the real tool");

        // 5. The result continues the original task in the same history.
        await waitFor(() => provider.objectives.length === 3);
        expect(provider.objectives[2]).toContain(receipt.call_id);
        expect(provider.objectives[2]).toContain("Continue the original task");
        expect(provider.histories[2]!.some((message) => message.text === objective)).toBe(true);
        await waitFor(async () => {
          const rows = await pool!.query<{ status: string }>(
            "SELECT status FROM conversation_queue_entries WHERE account_id=$1 ORDER BY created_at",
            [fixture.accountId],
          );
          return rows.rows.length === 3 && rows.rows.every((row) => row.status === "completed");
        });
        toolCalls.push(...synthetic.calls.filter((call) => call.method === "tools/call").map((call) => ({ headers: call.headers, params: call.params })));
      });
      // One real add handshake plus exactly one real tool call with the exact
      // approved arguments; no blind retries.
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]!.params).toEqual({ arguments: { query: "hello" }, name: "lookup" });
    } finally {
      delete process.env.TALENT_SIGNAL_MCP_ALLOWED_ORIGINS;
      await removeFixture(fixture.accountId);
      await synthetic.close();
    }
  });

  for (const scenario of [
    {
      name: "returns the selected choice into the conversation",
      resolution: { action: "submit", choice_id: "bearer" } as Record<string, unknown>,
      expected: "The user chose: API token",
    },
    {
      name: "returns a rejection into the conversation without executing",
      resolution: { action: "reject" } as Record<string, unknown>,
      expected: "outcome rejected",
    },
  ]) {
    it(scenario.name, async () => {
      const { fixture } = await seedFixture(null);
      const provider = new ScriptedStagingProvider([
        {
          reply: "请选择连接方式。",
          tool: {
            operation: "propose_choice",
            options: JSON.stringify([
              { id: "anonymous", label: "No sign-in" },
              { id: "bearer", label: "API token" },
              { id: "oauth", label: "OAuth" },
            ]),
            purpose: "How should this service connect?",
          },
        },
      ]);
      try {
        await withStack(fixture, provider, async (app) => {
          expect((await admit(app, fixture, "帮我添加服务。")).statusCode).toBe(202);
          await waitFor(() => provider.objectives.length === 1);
          await waitFor(async () => Boolean(await pendingRequest(app, fixture)));
          const pending = (await pendingRequest(app, fixture))!;
          expect(pending.kind).toBe("choice");
          const resolved = await app.inject({
            method: "POST",
            payload: {
              ...scenario.resolution,
              expected_revision: pending.revision,
              idempotency_key: `r-${randomUUID()}`,
            },
            url: `/v1/mcp/interactions/${pending.id}/resolve`,
          });
          expect(resolved.statusCode).toBe(200);
          // The decision enters the bound conversation exactly once.
          await waitFor(() => provider.objectives.length === 2);
          expect(provider.objectives[1]).toContain(scenario.expected);
          expect(provider.histories[1]!.length).toBeGreaterThan(0);
          const rows = await pool!.query<{ status: string }>(
            "SELECT status FROM conversation_queue_entries WHERE account_id=$1 ORDER BY created_at",
            [fixture.accountId],
          );
          expect(rows.rows).toHaveLength(2);
        });
      } finally {
        await removeFixture(fixture.accountId);
      }
    });
  }
});

class AddChainProvider implements RemoteChatAnswerProviding {
  readonly providerId = "zhipu-chat-completions" as const;
  readonly id = "zhipu-chat-completions";
  readonly model = "synthetic-conversation-model";
  readonly supportsImageInput = false;
  readonly objectives: string[] = [];
  readonly histories: ReadonlyArray<{ message_id: string; text: string }>[] = [];
  readonly toolResults: unknown[] = [];

  constructor(private readonly origin: string) {}

  async answer(_request: RemoteChatAnswerRequest): Promise<RemoteChatAnswerResult> {
    throw new Error("The governed agent path is required for this synthetic provider.");
  }

  async run(
    request: AgentProviderRequest,
    invokeTool: (name: string, input: unknown) => Promise<any>,
    signal: AbortSignal,
  ): Promise<AgentProviderResult> {
    signal.throwIfAborted();
    this.histories.push(request.conversationHistory ?? []);
    this.objectives.push(request.objective);
    const step = this.objectives.length;
    const reply = (body: string): AgentProviderResult => ({
      structuredOutput: { outcome: "reply", title: "回复", body },
      inputTokens: 1, outputTokens: 1, estimatedUsd: 0, turns: 1, permissionDenials: [],
    });
    if (step === 1) {
      this.toolResults.push(await invokeTool("mcp_connections", {
        auth_mode: "anonymous",
        friendly_name: "Synthetic tool server",
        operation: "propose_add",
        purpose: "Add the user's tool server to answer the original question.",
        server_url: `${this.origin}/mcp`,
      }));
      return reply("我已提交添加连接的请求，等待你的确认。");
    }
    if (step === 2) {
      const list = await invokeTool("mcp_connections", { operation: "list" });
      this.toolResults.push(list);
      const connectionId = (list.data as { connections: Array<{ id: string }> }).connections[0]!.id;
      this.toolResults.push(await invokeTool("mcp_connections", {
        arguments: JSON.stringify({ query: "hello" }),
        connection_id: connectionId,
        operation: "propose_call",
        purpose: "Answer the original question with one lookup.",
        tool_name: "lookup",
      }));
      return reply("我已提交工具调用请求，等待你的确认。");
    }
    return reply("已用工具结果继续完成原任务。");
  }
}
