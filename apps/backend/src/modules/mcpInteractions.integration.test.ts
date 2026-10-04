import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "./auth.js";
import type { McpToolCallInput, McpToolCallResult } from "./mcpClient.js";
import type { McpExchangeInput, McpExchangeResponse } from "./mcpHttp.js";
import {
  applyNangoAuthWebhook,
  invalidateMcpInteractionsForSession,
  listMcpInteractions,
  pollNangoConnectRequest,
  proposeMcpChoice,
  proposeMcpConnection,
  recoverAbandonedMcpConnectionWork,
  type McpStagingAuthority,
  proposeMcpToolCall,
  readMcpInteraction,
  readMcpToolCallReceipt,
  resolveMcpInteraction,
  type McpInteractionContinuation,
  type McpInteractionDependencies,
} from "./mcpInteractions.js";
import { loadMcpEncryptionKey } from "./mcpSecurity.js";
import { startMcpOAuthCleanupPump } from "./mcpOauthCleanup.js";
import { mcpPinnedExchange } from "./mcpHttp.js";
import {
  createMcpConnection,
  disconnectMcpConnection,
  updateMcpConnection,
} from "./mcpConnections.js";

/**
 * DB-backed lifecycle and security coverage for durable user-owned MCP human
 * interactions. Uses an isolated local PostgreSQL database; the network effect
 * is a recorded stub so every lifecycle boundary is deterministic. Without
 * CONTACT_AGENT_TEST_DATABASE_URL the suite is explicitly skipped, never
 * silently passed.
 */

const url = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (url && !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("Use an isolated local PostgreSQL database for MCP interaction tests.");
}
const pool = url
  ? new Pool({ connectionString: url, idleTimeoutMillis: 0, max: 4 })
  : null;
const suite = url ? describe : describe.skip;

const encryptionKey = loadMcpEncryptionKey(Buffer.alloc(32, 7).toString("base64"));
if (!encryptionKey) throw new Error("synthetic key");

interface Fixture {
  accountId: string;
  auth: AuthContext;
  connectionId: string;
  sessionId: string;
  userId: string;
}

async function seed(label: string): Promise<Fixture> {
  const accountId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const connectionId = randomUUID();
  const auth: AuthContext = {
    accountId,
    accountSlug: `mi-${label}-${accountId.slice(0, 8)}`,
    sessionId,
    userEmail: `${userId}@synthetic.local`,
    userId,
    userKind: "simulated_human",
  };
  await pool!.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,$3)", [
    accountId,
    auth.accountSlug,
    `MCP interactions ${label}`,
  ]);
  await pool!.query(
    "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,$4,'simulated_human')",
    [userId, accountId, auth.userEmail, `MI ${label}`],
  );
  await pool!.query(
    "INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'synthetic',clock_timestamp()+interval '1 hour')",
    [sessionId, accountId, userId, randomBytes(32).toString("hex")],
  );
  // The request binds this conversation session; staging and every read
  // revalidate that the acting human still owns a live parent Session.
  await pool!.query(
    `INSERT INTO agent_sessions(account_id,id,created_by_user_id,revision,payload,created_at,expires_at)
     VALUES($1,$2,$3,1,$4::jsonb,now(),now()+interval '7 days')`,
    [
      accountId,
      sessionId,
      userId,
      JSON.stringify({
        id: sessionId,
        scopeKind: "unresolved_intent",
        personDisplayLabel: "",
        contextDisplayLabel: "",
        title: "",
        turns: [],
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }),
    ],
  );
  await pool!.query(
    `INSERT INTO mcp_connections(
       account_id, id, created_by_user_id, friendly_name, server_url,
       credential_ciphertext, status, discovered_tools, tools_count, revision,
       auth_mode, nango_connection_id, nango_provider
     ) VALUES ($1,$2,$3,'Synthetic tool server','https://tools.example.test/mcp',NULL,'verified',$4,1,1,'anonymous',NULL,NULL)`,
    [
      accountId,
      connectionId,
      userId,
      JSON.stringify([
        {
          description: "Lookup a thing",
          input_schema: JSON.stringify({
            type: "object",
            properties: {
              query: { type: "string", minLength: 1, maxLength: 50 },
              filters: { type: "array", items: { type: "string", maxLength: 10 } },
            },
            required: ["query"],
            additionalProperties: false,
          }),
          name: "lookup",
          read_only: true,
        },
      ]),
    ],
  );
  return { accountId, auth, connectionId, sessionId, userId };
}

async function removeAccount(accountId: string): Promise<void> {
  await pool!.query("DELETE FROM mcp_oauth_cleanup WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM mcp_continuation_outbox WHERE account_id=$1", [accountId]).catch(() => undefined);
  await pool!.query("DELETE FROM conversation_queue_entries WHERE account_id=$1", [accountId]).catch(() => undefined);
  await pool!.query("DELETE FROM conversation_queue_state WHERE account_id=$1", [accountId]).catch(() => undefined);
  await pool!.query("DELETE FROM agent_sessions WHERE account_id=$1", [accountId]).catch(() => undefined);
  await pool!.query("DELETE FROM mcp_tool_calls WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM mcp_oauth_connect_requests WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM mcp_interaction_requests WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM mcp_connections WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM sessions WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM idempotency_records WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM audit_events WHERE account_id=$1", [accountId]).catch(() => undefined);
  await pool!.query("DELETE FROM harness_source_generations WHERE account_id=$1", [accountId]).catch(() => undefined);
  await pool!.query("DELETE FROM users WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM accounts WHERE id=$1", [accountId]);
}

interface RecordedCall {
  input: McpToolCallInput;
}

function dependenciesWith(
  perform: (input: McpToolCallInput) => Promise<McpToolCallResult>,
  continuations: McpInteractionContinuation[] = [],
  extra: Partial<McpInteractionDependencies> = {},
): { dependencies: McpInteractionDependencies; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    dependencies: {
      allowInsecureTls: true,
      allowedOrigins: [],
      continueConversation: async (input) => {
        continuations.push(input);
      },
      encryptionKey,
      performCall: async (input) => {
        calls.push({ input });
        return perform(input);
      },
      // Deterministic public answers for the synthetic hostnames; the network
      // effect itself is the recorded stub.
      resolver: async () => [{ address: "8.8.8.8", family: 4 }],
      requestTtlMs: 60_000,
      toolCallTimeoutMs: 5_000,
      ...extra,
    },
  };
}

/**
 * A synthetic MCP handshake endpoint behind the injectable exchange seam: the
 * real client code performs initialize/initialized/tools/list against it, so
 * the add-verification path exercises genuine protocol steps.
 */
function fakeHandshakeExchange(
  tools: Array<{ name: string; inputSchema?: unknown; description?: string }> = [],
): typeof mcpPinnedExchange {
  return async (input: McpExchangeInput): Promise<McpExchangeResponse> => {
    const body = JSON.parse(input.body ?? "{}") as { method?: string };
    const respond = (payload: unknown): McpExchangeResponse => ({
      body: JSON.stringify(payload),
      contentType: "application/json",
      headers: { "mcp-session-id": "fake-session" },
      status: 200,
    });
    if (body.method === "initialize") {
      return respond({
        id: 1,
        jsonrpc: "2.0",
        result: {
          capabilities: {},
          protocolVersion: "2025-11-25",
          serverInfo: { name: "fake", version: "1" },
        },
      });
    }
    if (body.method === "notifications/initialized") {
      return { body: "", contentType: "", headers: {}, status: 202 };
    }
    if (body.method === "tools/list") {
      return respond({
        id: 2,
        jsonrpc: "2.0",
        result: {
          tools: tools.map((tool) => ({
            description: tool.description ?? "synthetic",
            inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
            name: tool.name,
          })),
        },
      });
    }
    return respond({ id: 201, jsonrpc: "2.0", result: { content: [] } });
  };
}

const successResult: McpToolCallResult = {
  effectSent: true,
  errorCode: null,
  isError: false,
  jsonrpcError: false,
  protocolVersion: "2025-11-25",
  resultText: JSON.stringify({ content: [{ text: "one row", type: "text" }] }),
  status: "succeeded",
};

const callPropose = (fixture: Fixture, overrides: Record<string, unknown> = {}) => ({
  arguments: JSON.stringify({ filters: ["a"], query: "hello" }),
  connection_id: fixture.connectionId,
  idempotency_key: `call-${randomUUID()}`,
  purpose: "Answer the original question with one lookup.",
  session_id: fixture.sessionId,
  tool_name: "lookup",
  ...overrides,
});

// Every remote value here is synthetic; the real protocol and SQL paths run.
async function stageOAuthProbe(fixture: Fixture, onInitialize: () => Promise<void> = async () => undefined, approve = true) {
  const endpoint = "https://publication.example.test/mcp";
  let connectRequestId = "";
  const nangoConnectionId = `synthetic-${randomUUID()}`;
  const nangoConfig = { apiKey: "test-key", baseUrl: "https://api.nango.dev", environment: "DEV", webhookSigningKey: "test-signing-key" };
  let dispatches = 0;
  let proxyRequests = 0;
  const metadata: { connection_id: string; created: string; provider_config_key?: string; provider?: string; tags: Record<string, string> } = {
    connection_id: nangoConnectionId, created: "2026-10-04T00:00:00.000Z", provider_config_key: "mcp-generic",
    tags: { mcp_server_url: endpoint, account_id: fixture.accountId, user_id: fixture.userId, provider: "mcp-generic" },
  };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/connect/sessions")) {
      // Read the production-generated identity and tags from the real producer.
      const body = JSON.parse(String(init?.body ?? "{}")) as { tags: Record<string, string> };
      connectRequestId = body.tags.connect_request_id!;
      metadata.tags = { ...body.tags };
      return new Response(JSON.stringify({ data: {
        connect_link: "https://connect.example.test/ui", expires_at: new Date(Date.now() + 1800000).toISOString(), token: "synthetic-session-token",
      } }), { status: 201 });
    }
    if (url.includes("/connections?")) return new Response(JSON.stringify({ connections: [metadata] }), { status: 200 });
    if (!url.includes("/proxy/")) throw new Error("Unexpected synthetic OAuth request");
    proxyRequests++;
    const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
    if (body.method === "initialize") { dispatches++; await onInitialize(); }
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: body.method === "initialize" ? {
      capabilities: {}, protocolVersion: "2025-11-25", serverInfo: { name: "synthetic", version: "1" },
    } : { tools: [{ name: "probe", inputSchema: { type: "object", properties: {} } }] } }),
    { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const { dependencies } = dependenciesWith(async () => successResult, [], { fetcher, nangoConfig });
  const staged = await proposeMcpConnection(pool!, fixture.auth, {
    auth_mode: "oauth", friendly_name: "Publication probe", idempotency_key: `probe-${randomUUID()}`,
    purpose: "Synthetic atomic-publication proof", server_url: endpoint, session_id: fixture.sessionId,
  }, dependencies);
  if (approve) await resolveMcpInteraction(pool!, fixture.auth, staged.request.id, {
    action: "approve", expected_revision: staged.request.revision, idempotency_key: `approve-${randomUUID()}`,
  }, dependencies);
  const raw = JSON.stringify({ type: "auth", operation: "creation", connectionId: nangoConnectionId,
    providerConfigKey: "mcp-generic", provider: "mcp-generic", environment: "DEV", success: true,
    tags: { connect_request_id: connectRequestId } });
  const signature = createHmac("sha256", nangoConfig.webhookSigningKey).update(raw).digest("hex");
  const { parseNangoAuthWebhook } = await import("./nango.js");
  return { dependencies, endpoint, connectRequestId, nangoConnectionId, staged, metadata,
    dispatches: () => dispatches, proxyRequests: () => proxyRequests,
    complete: (db: Pool = pool!) => applyNangoAuthWebhook(db, raw, signature, parseNangoAuthWebhook(raw), dependencies) };
}

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function awaitCondition(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The expected durable background outcome was not observed");
}

async function awaitSqlLockWait(pid: number): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = await pool!.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND state='active' AND wait_event_type='Lock'", [pid]);
    if (result.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The competing SQL write never reached a PostgreSQL row-lock wait");
}

beforeAll(async () => {
  if (!pool) return;
  // Fail fast on an un-migrated database instead of pretending the skip is a pass.
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
  await pool?.end();
});

suite("durable MCP human interactions", () => {
  it("stages a canonical request that a reload reads from current state", async () => {
    const fixture = await seed("canonical");
    try {
      const { dependencies, calls } = dependenciesWith(async () => successResult);
      const staged = await proposeMcpToolCall(pool!, fixture.auth, callPropose(fixture), dependencies);
      expect(staged.request.state).toBe("pending");
      expect(staged.request.target).toMatchObject({
        connection_id: fixture.connectionId,
        tool_name: "lookup",
      });
      expect(staged.request.arguments_display).toContain("hello");
      expect(staged.request.argument_schema).toContain("filters");

      // A reload of the card comes from the canonical record, not a snapshot.
      const reread = await readMcpInteraction(pool!, fixture.auth, staged.request.id);
      expect(reread.request).toEqual(staged.request);
      expect(calls).toHaveLength(0);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("denies a foreign session or message binding before staging", async () => {
    const fixture = await seed("binding");
    try {
      const { dependencies, calls } = dependenciesWith(async () => successResult);
      // A message that belongs to no conversation queue entry is refused.
      await expect(
        proposeMcpToolCall(
          pool!,
          fixture.auth,
          callPropose(fixture, { message_id: randomUUID() }),
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_SCOPE_MISMATCH" });
      // A session the acting human does not own is refused.
      const foreignSessionId = randomUUID();
      const other = await seed("binding-other");
      try {
        await expect(
          proposeMcpToolCall(
            pool!,
            fixture.auth,
            callPropose(fixture, { session_id: other.sessionId }),
            dependencies,
          ),
        ).rejects.toMatchObject({ code: "MCP_INTERACTION_SCOPE_MISMATCH" });
      } finally {
        await removeAccount(other.accountId);
      }
      await expect(
        proposeMcpConnection(
          pool!,
          fixture.auth,
          {
            auth_mode: "anonymous",
            friendly_name: "Foreign",
            idempotency_key: `fb-${randomUUID()}`,
            purpose: "Add.",
            server_url: "https://foreign.example.test/mcp",
            session_id: foreignSessionId,
          },
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_SCOPE_MISMATCH" });
      expect(calls).toHaveLength(0);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("rejects invalid arguments against the original schema and never executes", async () => {
    const fixture = await seed("invalid-args");
    try {
      const { dependencies, calls } = dependenciesWith(async () => successResult);
      await expect(
        proposeMcpToolCall(
          pool!,
          fixture.auth,
          callPropose(fixture, { arguments: JSON.stringify({ query: "" }) }),
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_CALL_ARGUMENTS_INVALID" });
      await expect(
        proposeMcpToolCall(
          pool!,
          fixture.auth,
          callPropose(fixture, { arguments: JSON.stringify({ query: "x", extra: true }) }),
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_CALL_ARGUMENTS_INVALID" });
      expect(calls).toHaveLength(0);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("is invisible across accounts and unresolvable across sessions", async () => {
    const owner = await seed("scope-owner");
    const other = await seed("scope-other");
    try {
      const { dependencies, calls } = dependenciesWith(async () => successResult);
      const staged = await proposeMcpToolCall(pool!, owner.auth, callPropose(owner), dependencies);
      await expect(readMcpInteraction(pool!, other.auth, staged.request.id)).rejects.toMatchObject({
        code: "MCP_INTERACTION_NOT_FOUND",
      });
      await expect(
        resolveMcpInteraction(
          pool!,
          other.auth,
          staged.request.id,
          { action: "approve", expected_revision: 1, idempotency_key: `x-${randomUUID()}` },
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_NOT_FOUND" });

      // A second live login session of the same account may resolve the same
      // durable request (refresh and cross-device restore); the continuation
      // still enters the bound conversation session exactly once.
      const continuations: McpInteractionContinuation[] = [];
      const crossDevice = dependenciesWith(async () => successResult, continuations);
      const foreignSession: AuthContext = { ...owner.auth, sessionId: randomUUID() };
      await pool!.query(
        "INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'synthetic',clock_timestamp()+interval '1 hour')",
        [foreignSession.sessionId, owner.accountId, owner.userId, randomBytes(32).toString("hex")],
      );
      const resolved = await resolveMcpInteraction(
        pool!,
        foreignSession,
        staged.request.id,
        { action: "approve", expected_revision: staged.request.revision, idempotency_key: `y-${randomUUID()}` },
        crossDevice.dependencies,
      );
      expect(resolved.request.state).toBe("submitted");
      expect(crossDevice.calls).toHaveLength(1);
      expect(continuations).toHaveLength(1);
      expect(continuations[0]!.sessionId).toBe(owner.sessionId);
      expect(calls).toHaveLength(0);

      // An expired acting session cannot resolve anything: authority is
      // revalidated transactionally at decision time.
      const expiredSession: AuthContext = { ...owner.auth, sessionId: randomUUID() };
      await pool!.query(
        "INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'synthetic',clock_timestamp()-interval '1 minute')",
        [expiredSession.sessionId, owner.accountId, owner.userId, randomBytes(32).toString("hex")],
      );
      const second = await proposeMcpToolCall(pool!, owner.auth, callPropose(owner), crossDevice.dependencies);
      await expect(
        resolveMcpInteraction(
          pool!,
          expiredSession,
          second.request.id,
          { action: "approve", expected_revision: second.request.revision, idempotency_key: `z-${randomUUID()}` },
          crossDevice.dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_SCOPE_MISMATCH" });
    } finally {
      await removeAccount(owner.accountId);
      await removeAccount(other.accountId);
    }
  });

  it("rejection and no-action execute nothing and stay recoverable", async () => {
    const fixture = await seed("rejection");
    try {
      const { dependencies, calls } = dependenciesWith(async () => successResult);
      const staged = await proposeMcpToolCall(pool!, fixture.auth, callPropose(fixture), dependencies);
      const rejected = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        { action: "reject", expected_revision: staged.request.revision, idempotency_key: `r-${randomUUID()}` },
        dependencies,
      );
      expect(rejected.request.state).toBe("rejected");
      expect(calls).toHaveLength(0);
      await expect(
        resolveMcpInteraction(
          pool!,
          fixture.auth,
          staged.request.id,
          { action: "approve", expected_revision: rejected.request.revision, idempotency_key: `a-${randomUUID()}` },
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_NOT_PENDING" });
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("expires stale requests before any decision can act", async () => {
    const fixture = await seed("expiry");
    try {
      const { dependencies, calls } = dependenciesWith(async () => successResult, [], {
        requestTtlMs: 1_000,
      });
      const staged = await proposeMcpToolCall(pool!, fixture.auth, callPropose(fixture), dependencies);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const reread = await readMcpInteraction(pool!, fixture.auth, staged.request.id);
      expect(reread.request.state).toBe("expired");
      await expect(
        resolveMcpInteraction(
          pool!,
          fixture.auth,
          staged.request.id,
          { action: "approve", expected_revision: reread.request.revision, idempotency_key: `e-${randomUUID()}` },
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_EXPIRED" });
      expect(calls).toHaveLength(0);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("replays a duplicate resolution and claims execution exactly once", async () => {
    const fixture = await seed("replay");
    try {
      const { dependencies, calls } = dependenciesWith(async () => successResult);
      const staged = await proposeMcpToolCall(pool!, fixture.auth, callPropose(fixture), dependencies);
      const key = `dup-${randomUUID()}`;
      const first = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        { action: "approve", expected_revision: staged.request.revision, idempotency_key: key },
        dependencies,
      );
      const second = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        { action: "approve", expected_revision: staged.request.revision, idempotency_key: key },
        dependencies,
      );
      expect(second).toEqual(first);
      expect(calls).toHaveLength(1);
      expect(first.request.state).toBe("submitted");
      expect(first.request.receipt).toMatchObject({
        call_id: staged.request.call_id,
        outcome: "succeeded",
        source: {
          kind: "mcp_tool_result",
          server_origin: "https://tools.example.test",
          tool_name: "lookup",
        },
      });
      // A second decision with a fresh key cannot reuse the single-use approval.
      await expect(
        resolveMcpInteraction(
          pool!,
          fixture.auth,
          staged.request.id,
          { action: "approve", expected_revision: first.request.revision, idempotency_key: `n-${randomUUID()}` },
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_NOT_PENDING" });
      expect(calls).toHaveLength(1);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("invalidates an approval when the connection revision changes", async () => {
    const fixture = await seed("stale");
    try {
      const { dependencies, calls } = dependenciesWith(async () => successResult);
      const staged = await proposeMcpToolCall(pool!, fixture.auth, callPropose(fixture), dependencies);
      await pool!.query(
        "UPDATE mcp_connections SET revision = revision + 1, credential_ciphertext = 'ciphertext' WHERE account_id=$1 AND id=$2",
        [fixture.accountId, fixture.connectionId],
      );
      const resolved = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        { action: "approve", expected_revision: staged.request.revision, idempotency_key: `s-${randomUUID()}` },
        dependencies,
      );
      expect(resolved.request.state).toBe("failed");
      expect(calls).toHaveLength(0);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("settles an unreadable outcome after send as unknown and never retries", async () => {
    const fixture = await seed("unknown");
    try {
      const { dependencies, calls } = dependenciesWith(async () => ({
        ...successResult,
        errorCode: "MCP_TIMEOUT",
        resultText: null,
        status: "outcome_unknown" as const,
      }));
      const staged = await proposeMcpToolCall(pool!, fixture.auth, callPropose(fixture), dependencies);
      const resolved = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        { action: "approve", expected_revision: staged.request.revision, idempotency_key: `u-${randomUUID()}` },
        dependencies,
      );
      expect(resolved.request.state).toBe("unknown");
      expect(resolved.request.receipt?.outcome).toBe("outcome_unknown");
      expect(calls).toHaveLength(1);
      await expect(
        resolveMcpInteraction(
          pool!,
          fixture.auth,
          staged.request.id,
          { action: "approve", expected_revision: resolved.request.revision, idempotency_key: `u2-${randomUUID()}` },
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_NOT_PENDING" });
      expect(calls).toHaveLength(1);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("settles a definitive failure distinctly from an unknown outcome", async () => {
    const fixture = await seed("failure");
    try {
      const { dependencies } = dependenciesWith(async () => ({
        ...successResult,
        errorCode: "MCP_HANDSHAKE_FAILED",
        isError: true,
        resultText: JSON.stringify({ content: [{ text: "tool error", type: "text" }], isError: true }),
        status: "failed" as const,
      }));
      const staged = await proposeMcpToolCall(pool!, fixture.auth, callPropose(fixture), dependencies);
      const resolved = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        { action: "approve", expected_revision: staged.request.revision, idempotency_key: `f-${randomUUID()}` },
        dependencies,
      );
      expect(resolved.request.state).toBe("failed");
      expect(resolved.request.receipt?.is_error).toBe(true);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("keeps the transient secret out of every durable and echoed surface", async () => {
    const fixture = await seed("secret");
    const continuations: McpInteractionContinuation[] = [];
    const secret = "tsuper-secret-bearer-value-123456";
    try {
      const { dependencies, calls } = dependenciesWith(async () => successResult, continuations, {
        exchange: fakeHandshakeExchange([{ name: "probe" }]),
      });
      const staged = await proposeMcpConnection(
        pool!,
        fixture.auth,
        {
          auth_mode: "bearer",
          friendly_name: "Private tool server",
          idempotency_key: `add-${randomUUID()}`,
          purpose: "Add the user's private tool server.",
          server_url: "https://private.example.test/mcp",
          session_id: fixture.sessionId,
        },
        dependencies,
      );
      expect(staged.request.kind).toBe("secret");
      const resolved = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        {
          action: "submit",
          expected_revision: staged.request.revision,
          idempotency_key: `addres-${randomUUID()}`,
          secret,
        },
        dependencies,
      );
      // The request settles only after the real handshake verified the
      // connection and discovered its tools; a save-only record is not success.
      expect(resolved.request.state).toBe("submitted");
      const verified = await pool!.query<{ status: string; tools_count: number; auth_mode: string }>(
        "SELECT status, tools_count, auth_mode FROM mcp_connections WHERE account_id=$1 AND friendly_name='Private tool server'",
        [fixture.accountId],
      );
      expect(verified.rows[0]?.status).toBe("verified");
      expect(verified.rows[0]?.tools_count).toBe(1);
      const responseText = JSON.stringify(resolved);
      expect(responseText).not.toContain(secret);

      const connection = await pool!.query<{
        credential_ciphertext: string;
        auth_mode: string;
      }>(
        "SELECT credential_ciphertext, auth_mode FROM mcp_connections WHERE account_id=$1 AND friendly_name='Private tool server'",
        [fixture.accountId],
      );
      expect(connection.rows[0]?.auth_mode).toBe("bearer");
      expect(connection.rows[0]?.credential_ciphertext).toBeTruthy();
      expect(connection.rows[0]?.credential_ciphertext).not.toContain(secret);

      const idempotency = await pool!.query<{ request_hash: string }>(
        "SELECT request_hash FROM idempotency_records WHERE account_id=$1",
        [fixture.accountId],
      );
      for (const row of idempotency.rows) {
        expect(row.request_hash).not.toContain(secret);
      }
      const stored = await pool!.query<{ rendered: string }>(
        `SELECT request_hash || ' ' || coalesce(response_body::text, '') AS rendered
         FROM idempotency_records WHERE account_id=$1`,
        [fixture.accountId],
      );
      expect(JSON.stringify(stored.rows)).not.toContain(secret);
      for (const message of continuations) {
        expect(message.text).not.toContain(secret);
      }
      expect(calls).toHaveLength(0);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("returns the resolved result to the same conversation as a durable receipt", async () => {
    const fixture = await seed("continuation");
    const continuations: McpInteractionContinuation[] = [];
    try {
      const { dependencies } = dependenciesWith(async () => successResult, continuations);
      const staged = await proposeMcpToolCall(pool!, fixture.auth, callPropose(fixture), dependencies);
      await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        { action: "approve", expected_revision: staged.request.revision, idempotency_key: `c-${randomUUID()}` },
        dependencies,
      );
      expect(continuations).toHaveLength(1);
      expect(continuations[0]!.sessionId).toBe(fixture.sessionId);
      expect(continuations[0]!.text).toContain(staged.request.call_id);
      expect(continuations[0]!.text).toContain("Continue the original task");

      const receipt = await readMcpToolCallReceipt(pool!, fixture.auth, staged.request.call_id);
      expect(receipt).toMatchObject({
        outcome: "succeeded",
        server_origin: "https://tools.example.test",
        tool_name: "lookup",
      });
      const listed = await listMcpInteractions(pool!, fixture.auth, {
        sessionId: fixture.sessionId,
      });
      expect(listed.requests.map((request) => request.id)).toContain(staged.request.id);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("keeps bearer mode on a rename and clears stale bindings on endpoint changes", async () => {
    const fixture = await seed("update-modes");
    try {
      const inbound = {
        encryptionKey,
        resolver: async () => [{ address: "8.8.8.8", family: 4 }],
      };
      const created = await createMcpConnection(
        pool!,
        fixture.auth,
        {
          bearer_secret: "tk-secret-bearer-123456",
          friendly_name: "Bearer server",
          idempotency_key: `c-${randomUUID()}`,
          server_url: "https://bearer.example.test/mcp",
        },
        inbound,
      );
      expect(created.connection.auth_mode).toBe("bearer");
      expect(created.connection.credential_configured).toBe(true);

      // A rename without a new secret keeps the still-valid bearer intact.
      const renamed = await updateMcpConnection(
        pool!,
        fixture.auth,
        created.connection.id,
        {
          expected_revision: created.connection.revision,
          friendly_name: "Bearer server renamed",
          idempotency_key: `u-${randomUUID()}`,
          server_url: "https://bearer.example.test/mcp",
        },
        inbound,
      );
      expect(renamed.connection.auth_mode).toBe("bearer");
      expect(renamed.connection.credential_configured).toBe(true);

      // Changing the endpoint clears the old origin's credential and any
      // OAuth broker binding: an old secret is never sent to a new origin.
      const moved = await updateMcpConnection(
        pool!,
        fixture.auth,
        created.connection.id,
        {
          expected_revision: renamed.connection.revision,
          friendly_name: "Bearer server renamed",
          idempotency_key: `m-${randomUUID()}`,
          server_url: "https://other.example.test/mcp",
        },
        inbound,
      );
      expect(moved.connection.auth_mode).toBe("anonymous");
      expect(moved.connection.credential_configured).toBe(false);

      // An explicit secret replaces; disconnect clears everything.
      const rekeyed = await updateMcpConnection(
        pool!,
        fixture.auth,
        created.connection.id,
        {
          bearer_secret: "tk-new-bearer-654321",
          expected_revision: moved.connection.revision,
          friendly_name: "Bearer server renamed",
          idempotency_key: `k-${randomUUID()}`,
          server_url: "https://other.example.test/mcp",
        },
        inbound,
      );
      expect(rekeyed.connection.auth_mode).toBe("bearer");
      const disconnected = await disconnectMcpConnection(
        pool!,
        fixture.auth,
        created.connection.id,
        {
          expected_revision: rekeyed.connection.revision,
          idempotency_key: `d-${randomUUID()}`,
        },
      );
      expect(disconnected.connection.auth_mode).toBe("anonymous");
      expect(disconnected.connection.credential_configured).toBe(false);

      // Explicit secret clearing also drops back to anonymous.
      const cleared = await createMcpConnection(
        pool!,
        fixture.auth,
        {
          bearer_secret: "tk-third-bearer-111222",
          friendly_name: "Cleared server",
          idempotency_key: `cc-${randomUUID()}`,
          server_url: "https://cleared.example.test/mcp",
        },
        inbound,
      );
      const dropped = await updateMcpConnection(
        pool!,
        fixture.auth,
        cleared.connection.id,
        {
          bearer_secret: null,
          expected_revision: cleared.connection.revision,
          friendly_name: "Cleared server",
          idempotency_key: `cd-${randomUUID()}`,
          server_url: "https://cleared.example.test/mcp",
        },
        inbound,
      );
      expect(dropped.connection.auth_mode).toBe("anonymous");
      expect(dropped.connection.credential_configured).toBe(false);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("rejects a server URL with a query before proposing anything", async () => {
    const fixture = await seed("query-reject");
    try {
      const { dependencies, calls } = dependenciesWith(async () => successResult);
      await expect(
        proposeMcpConnection(
          pool!,
          fixture.auth,
          {
            auth_mode: "oauth",
            friendly_name: "Queried",
            idempotency_key: `q-${randomUUID()}`,
            purpose: "Add a queried endpoint.",
            server_url: "https://queried.example.test/mcp?token=abc",
          },
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_ENDPOINT_REJECTED" });
      await expect(
        proposeMcpConnection(
          pool!,
          fixture.auth,
          {
            auth_mode: "anonymous",
            friendly_name: "Queried",
            idempotency_key: `q2-${randomUUID()}`,
            purpose: "Add a queried endpoint.",
            server_url: "https://queried.example.test/mcp?token=abc",
          },
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_ENDPOINT_REJECTED" });
      expect(calls).toHaveLength(0);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("binds an OAuth request to the real Nango session expiry", async () => {
    const fixture = await seed("oauth-expiry");
    const sessionExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const fetcher = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/connect/sessions")) {
        return new Response(
          JSON.stringify({
            data: {
              connect_link: "https://connect.example.test/ui",
              expires_at: sessionExpiry,
              token: "session-token-abcdef",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 201 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const { dependencies } = dependenciesWith(async () => successResult, [], {
        fetcher,
        nangoConfig: {
          apiKey: "test-key",
          baseUrl: "https://api.nango.dev",
          environment: "DEV",
          webhookSigningKey: "test-signing",
        },
      });
      const staged = await proposeMcpConnection(
        pool!,
        fixture.auth,
        {
          auth_mode: "oauth",
          friendly_name: "Notion",
          idempotency_key: `o-${randomUUID()}`,
          purpose: "Add the OAuth service.",
          server_url: "https://mcp.notion.com/mcp",
        },
        dependencies,
      );
      expect(staged.request.kind).toBe("oauth");
      expect(staged.request.oauth?.available).toBe(true);
      // The actual session lifetime bounds the request, not the generic TTL.
      expect(new Date(staged.request.expires_at).getTime()).toBeCloseTo(
        Date.parse(sessionExpiry),
        -3,
      );
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("stages a bounded choice and returns the selection to the conversation", async () => {
    const fixture = await seed("choice");
    const continuations: McpInteractionContinuation[] = [];
    try {
      const { dependencies } = dependenciesWith(async () => successResult, continuations);
      const staged = await proposeMcpChoice(
        pool!,
        fixture.auth,
        {
          idempotency_key: `ch-${randomUUID()}`,
          options: [
            { id: "anonymous", label: "No sign-in" },
            { id: "bearer", label: "API token" },
            { id: "oauth", label: "OAuth" },
          ],
          purpose: "How should this service connect?",
          session_id: fixture.sessionId,
        },
        dependencies,
      );
      expect(staged.request.kind).toBe("choice");
      expect(staged.request.choices).toHaveLength(3);
      const resolved = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        {
          action: "submit",
          choice_id: "bearer",
          expected_revision: staged.request.revision,
          idempotency_key: `chr-${randomUUID()}`,
        },
        dependencies,
      );
      expect(resolved.request.state).toBe("submitted");
      expect(continuations).toHaveLength(1);
      expect(continuations[0]!.text).toContain("The user chose: API token");
    } finally {
      await removeAccount(fixture.accountId);
    }
  });


  async function seedRunClaim(fixture: Fixture): Promise<McpStagingAuthority> {
    const entryId = randomUUID();
    const runId = randomUUID();
    const messageId = randomUUID();
    await pool!.query(
      `INSERT INTO conversation_queue_entries(
         account_id, session_id, id, message_id, created_by_user_id,
         sequence, status, content_state, objective, idempotency_key,
         revision, expires_at, run_id, lease_owner, lease_generation,
         lease_expires_at, attempt, created_at
       ) VALUES ($1,$2,$3,$4,$5,1,'running','retained','objective',$6,1,
         now()+interval '1 day',$7,$8,1,now()+interval '1 minute',1,now())`,
      [fixture.accountId, fixture.sessionId, entryId, messageId, fixture.userId,
        `seed-${randomUUID()}`.slice(0, 128), runId, `worker-${randomUUID()}`],
    );
    return {
      fence: {
        accountId: fixture.accountId,
        entryId,
        leaseGeneration: 1,
        leaseOwner: (await pool!.query<{ lease_owner: string }>(
          "SELECT lease_owner FROM conversation_queue_entries WHERE account_id=$1 AND id=$2",
          [fixture.accountId, entryId],
        )).rows[0]!.lease_owner,
        runId,
        sessionId: fixture.sessionId,
      },
      messageId,
      sessionId: fixture.sessionId,
    };
  }

  it("mints staging authority only from a live run claim or a live login session", async () => {
    const fixture = await seed("authority");
    try {
      const { dependencies, calls } = dependenciesWith(async () => successResult);
      const authority = await seedRunClaim(fixture);
      // A genuine live claim stages bound to its own conversation message.
      const staged = await proposeMcpToolCall(
        pool!,
        fixture.auth,
        callPropose(fixture, { message_id: authority.messageId }),
        dependencies,
        authority,
      );
      expect(staged.request.state).toBe("pending");

      // Wrong message binding cannot borrow the claim.
      await expect(
        proposeMcpToolCall(
          pool!,
          fixture.auth,
          callPropose(fixture, { message_id: randomUUID() }),
          dependencies,
          authority,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_SCOPE_MISMATCH" });

      // An old/stale claim (unknown lease) mints nothing.
      const stale = { ...authority, fence: { ...authority.fence, leaseGeneration: 99 } };
      await expect(
        proposeMcpToolCall(
          pool!,
          fixture.auth,
          callPropose(fixture, { message_id: authority.messageId }),
          dependencies,
          stale,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_SCOPE_MISMATCH" });

      // A fabricated non-session AuthContext with no claim mints nothing.
      const fabricated: AuthContext = { ...fixture.auth, sessionId: "conversation-queue-runner" };
      await expect(
        proposeMcpToolCall(pool!, fabricated, callPropose(fixture), dependencies),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_SCOPE_MISMATCH" });
      await expect(
        proposeMcpToolCall(
          pool!,
          { ...fixture.auth, sessionId: "" },
          callPropose(fixture),
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_SCOPE_MISMATCH" });

      // A canceled claim mints nothing.
      await pool!.query(
        "UPDATE conversation_queue_entries SET cancel_requested=true WHERE account_id=$1 AND id=$2",
        [fixture.accountId, authority.fence.entryId],
      );
      await expect(
        proposeMcpToolCall(
          pool!,
          fixture.auth,
          callPropose(fixture, { message_id: authority.messageId }),
          dependencies,
          authority,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_SCOPE_MISMATCH" });

      // A revoked owner cannot stage even with a live-looking claim.
      const revoked = await seed("authority-revoked");
      try {
        const revokedAuthority = await seedRunClaim(revoked);
        await pool!.query("UPDATE users SET status='revoked' WHERE account_id=$1", [revoked.accountId]);
        await expect(
          proposeMcpToolCall(
            pool!,
            revoked.auth,
            callPropose(revoked, { message_id: revokedAuthority.messageId }),
            dependencies,
            revokedAuthority,
          ),
        ).rejects.toMatchObject({ code: "MCP_INTERACTION_SCOPE_MISMATCH" });
      } finally {
        await pool!.query("UPDATE users SET status='active' WHERE account_id=$1", [revoked.accountId]);
        await removeAccount(revoked.accountId);
      }
      expect(calls).toHaveLength(0);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("scrubs private derived data and replay snapshots on session deletion", async () => {
    const fixture = await seed("deletion-scrub");
    const continuations: McpInteractionContinuation[] = [];
    try {
      const { dependencies } = dependenciesWith(async () => successResult, continuations, {
        exchange: fakeHandshakeExchange([{ name: "probe" }]),
      });
      const secret = "tsuper-secret-deletion-123456";
      const staged = await proposeMcpConnection(
        pool!,
        fixture.auth,
        {
          auth_mode: "bearer",
          friendly_name: "Private server",
          idempotency_key: `ds-${randomUUID()}`,
          purpose: "Add the private server with its secret.",
          server_url: "https://scrub.example.test/mcp",
          session_id: fixture.sessionId,
        },
        dependencies,
      );
      const key = `ds-resolve-${randomUUID()}`;
      const resolved = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        { action: "submit", expected_revision: staged.request.revision, idempotency_key: key, secret },
        dependencies,
      );
      expect(resolved.request.state).toBe("submitted");

      await pool!.query("DELETE FROM agent_sessions WHERE account_id=$1 AND id=$2", [fixture.accountId, fixture.sessionId]);
      await invalidateMcpInteractionsForSession(pool!, fixture.accountId, fixture.sessionId);

      // No private derived content survives anywhere durable.
      const rows = await pool!.query<{ arguments_display: string; purpose: string; bound_arguments: string | null; resolution_display: string | null; choices: unknown; oauth: unknown }>(
        "SELECT arguments_display, purpose, bound_arguments, resolution_display, choices, oauth FROM mcp_interaction_requests WHERE account_id=$1",
        [fixture.accountId],
      );
      const request = rows.rows[0]!;
      expect(request.arguments_display).toBe("[removed]");
      expect(request.purpose).toBe("[removed]");
      expect(request.bound_arguments).toBeNull();
      expect(JSON.stringify(request.choices)).toBe("[]");
      const calls = await pool!.query<{ arguments: string; result_json: string | null }>(
        "SELECT arguments, result_json FROM mcp_tool_calls WHERE account_id=$1",
        [fixture.accountId],
      );
      for (const call of calls.rows) {
        expect(call.arguments).toBe("[removed]");
        expect(call.result_json).toBeNull();
      }
      const outbox = await pool!.query<{ body: string; result_metadata: unknown }>(
        "SELECT body, result_metadata FROM mcp_continuation_outbox WHERE account_id=$1",
        [fixture.accountId],
      );
      for (const row of outbox.rows) {
        expect(row.body).toBe("[removed]");
        expect(row.result_metadata).toBeNull();
      }
      const idempotency = await pool!.query<{ response_body: unknown }>(
        "SELECT response_body FROM idempotency_records WHERE account_id=$1",
        [fixture.accountId],
      );
      expect(JSON.stringify(idempotency.rows)).not.toContain("scrub.example.test");

      // Replay with the original key returns no pre-deletion snapshot.
      await expect(
        resolveMcpInteraction(
          pool!,
          fixture.auth,
          staged.request.id,
          { action: "submit", expected_revision: 1, idempotency_key: key, secret },
          dependencies,
        ),
      ).rejects.toMatchObject({ code: "MCP_INTERACTION_NOT_FOUND" });
      // Public reads of the dead conversation are denied too.
      await expect(readMcpInteraction(pool!, fixture.auth, staged.request.id)).rejects.toMatchObject({
        code: "MCP_INTERACTION_NOT_FOUND",
      });
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("settles dispatched work truthfully when the session dies mid-flight", async () => {
    const fixture = await seed("deletion-inflight");
    const continuations: McpInteractionContinuation[] = [];
    try {
      const { dependencies } = dependenciesWith(async (input) => {
        // The conversation is deleted while the effect is in flight.
        await pool!.query("DELETE FROM agent_sessions WHERE account_id=$1 AND id=$2", [fixture.accountId, fixture.sessionId]);
        await invalidateMcpInteractionsForSession(pool!, fixture.accountId, fixture.sessionId);
        return { ...successResult, resultText: JSON.stringify({ content: [{ text: "late result", type: "text" }] }) };
        void input;
      }, continuations);
      const staged = await proposeMcpToolCall(pool!, fixture.auth, callPropose(fixture), dependencies);
      const resolved = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        { action: "approve", expected_revision: staged.request.revision, idempotency_key: `inflight-${randomUUID()}` },
        dependencies,
      );
      // The real outcome settles and is not rolled back or relabelled.
      expect(resolved.request.receipt?.outcome).toBe("succeeded");
      const stored = await pool!.query<{ state: string; result_json: string | null }>(
        "SELECT state, result_json FROM mcp_tool_calls WHERE account_id=$1",
        [fixture.accountId],
      );
      expect(stored.rows[0]!.state).toBe("succeeded");
      // Private payloads are scrubbed; accountability metadata remains.
      expect(stored.rows[0]!.result_json).toBeNull();
      // The public read of the dead conversation is denied without blocking.
      await expect(readMcpInteraction(pool!, fixture.auth, staged.request.id)).rejects.toMatchObject({
        code: "MCP_INTERACTION_NOT_FOUND",
      });
      const listed = await listMcpInteractions(pool!, fixture.auth, {});
      expect(listed.requests).toHaveLength(0);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("reconciles abandoned connection work without duplicating connections", async () => {
    const fixture = await seed("abandoned-work");
    try {
      const handshake = fakeHandshakeExchange([{ name: "probe" }]);
      const { dependencies } = dependenciesWith(async () => successResult, [], {
        exchange: handshake,
      });
      // Crash after insert: the request is submitting with a recorded work
      // connection identity and no settled outcome.
      const staged = await proposeMcpConnection(
        pool!,
        fixture.auth,
        {
          auth_mode: "anonymous",
          friendly_name: "Crashed server",
          idempotency_key: `cw-${randomUUID()}`,
          purpose: "Add the crashed server.",
          server_url: "https://crashed.example.test/mcp",
          session_id: fixture.sessionId,
        },
        dependencies,
      );
      const connectionId = randomUUID();
      await pool!.query(
        `INSERT INTO mcp_connections(
           account_id, id, created_by_user_id, friendly_name, server_url,
           credential_ciphertext, status, discovered_tools, tools_count, revision,
           auth_mode, nango_connection_id, nango_provider
         ) VALUES ($1,$2,$3,'Crashed server','https://crashed.example.test/mcp',NULL,'disconnected','[]',0,1,'anonymous',NULL,NULL)`,
        [fixture.accountId, connectionId, fixture.userId],
      );
      await pool!.query(
        `UPDATE mcp_interaction_requests SET state='submitting', work_connection_id=$2
         WHERE account_id=$1 AND id=$3`,
        [fixture.accountId, connectionId, staged.request.id],
      );
      await recoverAbandonedMcpConnectionWork(pool!, dependencies, fixture.auth, 0);
      const settled = await readMcpInteraction(pool!, fixture.auth, staged.request.id);
      expect(settled.request.state).toBe("submitted");
      const connections = await pool!.query<{ id: string; status: string; tools_count: number }>(
        "SELECT id, status, tools_count FROM mcp_connections WHERE account_id=$1 AND friendly_name IN ('Crashed server','Lost server')",
        [fixture.accountId],
      );
      // Exactly one work connection exists and it is verified usable; the
      // reconciliation never duplicated it.
      expect(connections.rows).toHaveLength(1);
      expect(connections.rows[0]).toMatchObject({ id: connectionId, status: "verified", tools_count: 1 });

      // Crash before any connection work: truthful failure, no fabrication.
      const lost = await proposeMcpConnection(
        pool!,
        fixture.auth,
        {
          auth_mode: "anonymous",
          friendly_name: "Lost server",
          idempotency_key: `lw-${randomUUID()}`,
          purpose: "Add the lost server.",
          server_url: "https://lost.example.test/mcp",
          session_id: fixture.sessionId,
        },
        dependencies,
      );
      await pool!.query(
        "UPDATE mcp_interaction_requests SET state='submitting' WHERE account_id=$1 AND id=$2",
        [fixture.accountId, lost.request.id],
      );
      await recoverAbandonedMcpConnectionWork(pool!, dependencies, fixture.auth, 0);
      const lostSettled = await readMcpInteraction(pool!, fixture.auth, lost.request.id);
      expect(lostSettled.request.state).toBe("failed");
      const after = await pool!.query(
        "SELECT id FROM mcp_connections WHERE account_id=$1 AND friendly_name IN ('Crashed server','Lost server')",
        [fixture.accountId],
      );
      expect(after.rows).toHaveLength(1);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("refuses OAuth completion and polling after owner withdrawal or across members", async () => {
    const fixture = await seed("oauth-withdrawal");
    const secondUserId = randomUUID();
    const secondSessionId = randomUUID();
    await pool!.query(
      "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Second member','simulated_human')",
      [secondUserId, fixture.accountId, `${secondUserId}@synthetic.local`],
    );
    await pool!.query(
      "INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'synthetic',clock_timestamp()+interval '1 hour')",
      [secondSessionId, fixture.accountId, secondUserId, randomBytes(32).toString("hex")],
    );
    const other: AuthContext = {
      ...fixture.auth,
      sessionId: secondSessionId,
      userEmail: `${secondUserId}@synthetic.local`,
      userId: secondUserId,
    };
    const nangoConfig = {
      apiKey: "test-key",
      baseUrl: "https://api.nango.dev",
      environment: "DEV",
      webhookSigningKey: "test-signing-key",
    };
    const webhookBody = JSON.stringify({
      type: "auth",
      operation: "creation",
      connectionId: "conn-real-1",
      providerConfigKey: "mcp-generic",
      provider: "mcp-generic",
      environment: "DEV",
      success: true,
      tags: { connect_request_id: "mcpconn_deadbeef12" },
    });
    const signature = (await import("node:crypto"))
      .createHmac("sha256", nangoConfig.webhookSigningKey)
      .update(webhookBody)
      .digest("hex");
    const fetcher = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/connect/sessions")) {
        return new Response(
          JSON.stringify({
            data: {
              connect_link: "https://connect.example.test/ui",
              expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              token: "session-token-oauth-test",
            },
          }),
          { status: 201 },
        );
      }
      if (String(input).includes("/connections?")) {
        return new Response(
          JSON.stringify({
            connections: [
              {
                connection_id: "conn-real-1",
                created: "2026-10-04T00:00:00.000Z",
                provider_config_key: "mcp-generic",
                tags: {
                  connect_request_id: "mcpconn_deadbeef12",
                  mcp_server_url: "https://oauth.example.test/mcp",
                  account_id: fixture.accountId, user_id: fixture.userId, provider: "mcp-generic",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const { dependencies } = dependenciesWith(async () => successResult, [], {
      fetcher,
      nangoConfig,
    });
    try {
      // A pending OAuth request owned by the fixture user.
      const { dependencies: staging } = dependenciesWith(async () => successResult, [], { fetcher, nangoConfig });
      const staged = await proposeMcpConnection(
        pool!,
        fixture.auth,
        {
          auth_mode: "oauth",
          friendly_name: "OAuth server",
          idempotency_key: `ow-${randomUUID()}`,
          purpose: "Add the OAuth server.",
          server_url: "https://oauth.example.test/mcp",
          session_id: fixture.sessionId,
        },
        staging,
      );
      expect(staged.request.kind).toBe("oauth");
      await pool!.query(
        `UPDATE mcp_oauth_connect_requests SET connect_request_id='mcpconn_deadbeef12'
         WHERE account_id=$1`,
        [fixture.accountId],
      );
      await pool!.query(
        `UPDATE mcp_interaction_requests SET state='waiting' WHERE account_id=$1`,
        [fixture.accountId],
      );

      // A same-account second member cannot poll the owner's request even
      // with the server-generated request id.
      const second = await pollNangoConnectRequest(pool!, other, "mcpconn_deadbeef12", dependencies);
      expect(second.status).toBe("ignored");
      const leaked = await pool!.query(
        "SELECT id FROM mcp_connections WHERE account_id=$1 AND auth_mode='oauth'",
        [fixture.accountId],
      );
      expect(leaked.rows).toHaveLength(0);

      // Owner withdrawal revokes the pending attempt: a late completion can
      // neither create a usable connection nor resurrect authority.
      await pool!.query("UPDATE users SET status='revoked' WHERE account_id=$1 AND id=$2", [fixture.accountId, fixture.userId]);
      const { parseNangoAuthWebhook } = await import("./nango.js");
      const outcome = await applyNangoAuthWebhook(
        pool!,
        webhookBody,
        signature,
        parseNangoAuthWebhook(webhookBody),
        dependencies,
      );
      expect(outcome.status === "ignored" || outcome.status === "applied").toBe(true);
      const created = await pool!.query<{ status: string; auth_mode: string }>(
        "SELECT status, auth_mode FROM mcp_connections WHERE account_id=$1 AND auth_mode='oauth'",
        [fixture.accountId],
      );
      for (const row of created.rows) {
        // No usable connection survives the withdrawal.
        expect(row.status === "failed" || row.status === "disconnected").toBe(true);
      }
      await pool!.query("UPDATE users SET status='active' WHERE account_id=$1 AND id=$2", [fixture.accountId, fixture.userId]);

      // Same owner on another device session may poll (cross-device restore).
      const crossDevice: AuthContext = { ...fixture.auth, sessionId: randomUUID() };
      await pool!.query(
        "INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'synthetic',clock_timestamp()+interval '1 hour')",
        [crossDevice.sessionId, fixture.accountId, fixture.userId, randomBytes(32).toString("hex")],
      );
      const ownerPoll = await pollNangoConnectRequest(pool!, crossDevice, "mcpconn_deadbeef12", dependencies);
      expect(ownerPoll.status === "ignored" || ownerPoll.status === "applied").toBe(true);
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  async function deleteConversation(accountId: string, sessionId: string): Promise<void> {
    const { inTransaction } = await import("../database/pool.js");
    await inTransaction(pool!, async (client) => {
      await client.query(
        "UPDATE agent_sessions SET payload = NULL, deleted_at = now() WHERE account_id=$1 AND id=$2",
        [accountId, sessionId],
      );
      await invalidateMcpInteractionsForSession(client, accountId, sessionId);
    });
  }

  it("never regrows private data when deletion races a tool settlement", async () => {
    // Order A: deletion commits before the late result settles.
    const fixture = await seed("race-delete-first");
    const continuations: McpInteractionContinuation[] = [];
    try {
      const { dependencies } = dependenciesWith(async () => {
        await deleteConversation(fixture.accountId, fixture.sessionId);
        return {
          ...successResult,
          resultText: JSON.stringify({ content: [{ text: "private late result", type: "text" }] }),
        };
      }, continuations);
      const staged = await proposeMcpToolCall(pool!, fixture.auth, callPropose(fixture), dependencies);
      const resolved = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        { action: "approve", expected_revision: staged.request.revision, idempotency_key: `raceA-${randomUUID()}` },
        dependencies,
      );
      // The real outcome settles for accountability; no private payload and
      // no continuation publication survive.
      expect(resolved.request.receipt?.outcome).toBe("succeeded");
      const rows = await pool!.query<{ result_json: string | null; result_summary: string | null }>(
        "SELECT result_json, result_summary FROM mcp_tool_calls WHERE account_id=$1",
        [fixture.accountId],
      );
      expect(rows.rows[0]!.result_json).toBeNull();
      expect(rows.rows[0]!.result_summary).toBe("[removed]");
      const outbox = await pool!.query("SELECT 1 FROM mcp_continuation_outbox WHERE account_id=$1", [fixture.accountId]);
      expect(outbox.rows).toHaveLength(0);
      const stored = await pool!.query("SELECT arguments_display FROM mcp_interaction_requests WHERE account_id=$1", [fixture.accountId]);
      expect(JSON.stringify(stored.rows)).not.toContain("private late result");
    } finally {
      await removeAccount(fixture.accountId);
    }

    // Order B: the deletion transaction starts during the in-flight call and
    // must leave a scrubbed final state no matter which side commits first.
    const fixtureB = await seed("race-settle-first");
    const continuationsB: McpInteractionContinuation[] = [];
    const deletionRef: { promise: Promise<void> | null } = { promise: null };
    try {
      const { dependencies } = dependenciesWith(async () => {
        deletionRef.promise = deleteConversation(fixtureB.accountId, fixtureB.sessionId);
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          ...successResult,
          resultText: JSON.stringify({ content: [{ text: "private racing result", type: "text" }] }),
        };
      }, continuationsB);
      const staged = await proposeMcpToolCall(pool!, fixtureB.auth, callPropose(fixtureB), dependencies);
      const resolved = await resolveMcpInteraction(
        pool!,
        fixtureB.auth,
        staged.request.id,
        { action: "approve", expected_revision: staged.request.revision, idempotency_key: `raceB-${randomUUID()}` },
        dependencies,
      );
      expect(resolved.request.receipt?.outcome).toBe("succeeded");
      await deletionRef.promise;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const rows = await pool!.query<{ result_json: string | null; result_summary: string | null }>(
        "SELECT result_json, result_summary FROM mcp_tool_calls WHERE account_id=$1",
        [fixtureB.accountId],
      );
      // Final state after both commit: nothing private persists.
      expect(rows.rows[0]!.result_json).toBeNull();
      expect(rows.rows[0]!.result_summary).toBe("[removed]");
      const outbox = await pool!.query<{ body: string }>(
        "SELECT body FROM mcp_continuation_outbox WHERE account_id=$1",
        [fixtureB.accountId],
      );
      for (const row of outbox.rows) {
        expect(row.body).not.toContain("private racing result");
        expect(row.body).toBe("[removed]");
      }
    } finally {
      await deletionRef.promise?.catch(() => undefined);
      await removeAccount(fixtureB.accountId);
    }
  });

  it("keeps the genuine directory-scope receipt when no conversation session is bound", async () => {
    const fixture = await seed("directory-scope");
    try {
      const { dependencies } = dependenciesWith(async () => ({
        ...successResult,
        resultText: JSON.stringify({ content: [{ text: "public library docs", type: "text" }] }),
      }));
      const staged = await proposeMcpToolCall(
        pool!,
        fixture.auth,
        callPropose(fixture, { session_id: undefined, message_id: undefined }),
        dependencies,
      );
      expect(staged.request.session_id).toBeNull();
      const resolved = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        { action: "approve", expected_revision: staged.request.revision, idempotency_key: `dir-${randomUUID()}` },
        dependencies,
      );
      // A NULL session is the legitimate page scope: the bounded redacted
      // genuine result is preserved, never scrubbed as deleted data.
      expect(resolved.request.receipt?.outcome).toBe("succeeded");
      expect(resolved.request.receipt?.result_summary).toContain("public library docs");
      const rows = await pool!.query<{ result_json: string | null }>(
        "SELECT result_json FROM mcp_tool_calls WHERE account_id=$1",
        [fixture.accountId],
      );
      expect(rows.rows[0]!.result_json).toContain("public library docs");
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it.each([false, true])("watches a rejected OAuth capability without UI or webhook (previously approved=%s)", async (approved) => {
    const fixture = await seed("oauth-reject-watch");
    let stop: (() => Promise<void>) | undefined;
    try {
      const probe = await stageOAuthProbe(fixture, async () => undefined, approved);
      const current = await readMcpInteraction(pool!, fixture.auth, probe.staged.request.id);
      const rejected = await resolveMcpInteraction(pool!, fixture.auth, current.request.id, {
        action: "reject", expected_revision: current.request.revision, idempotency_key: `reject-${randomUUID()}`,
      }, probe.dependencies);
      expect(rejected.request.state).toBe("rejected");
      const attempt = await pool!.query("SELECT state,nango_connection_id FROM mcp_oauth_connect_requests WHERE account_id=$1", [fixture.accountId]);
      expect(attempt.rows[0]).toMatchObject({ state: "failed", nango_connection_id: null });
      const before = await pool!.query("SELECT id,created_by_user_id,connect_request_id,provider,target_origin,broker_base_url,environment,state,closure_state FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId]);
      expect(before.rows).toHaveLength(1);
      expect(before.rows[0]).toMatchObject({ created_by_user_id: fixture.userId, connect_request_id: probe.connectRequestId,
        provider: "mcp-generic", target_origin: probe.endpoint, broker_base_url: "https://api.nango.dev", environment: "DEV", state: "pending", closure_state: "open" });
      let visible = false;
      let deleted = false;
      const deletedIds: string[] = [];
      const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (init?.method === "DELETE") {
          expect(url.pathname).toBe(`/connections/${probe.nangoConnectionId}`);
          expect(url.searchParams.get("provider_config_key")).toBe("mcp-generic");
          deletedIds.push(probe.nangoConnectionId); deleted = true;
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        expect(url.pathname).toBe("/connections");
        const ours = url.searchParams.get("tags[connect_request_id]") === probe.connectRequestId;
        return new Response(JSON.stringify({ connections: ours && visible && !deleted ? [probe.metadata] : [] }), { status: 200 });
      }) as typeof fetch;
      const runPump = () => startMcpOAuthCleanupPump(pool!, { intervalMs: 20, dependencies: { fetcher, nangoConfig: probe.dependencies.nangoConfig! } });
      stop = runPump();
      await awaitCondition(async () => (await pool!.query("SELECT attempts FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId])).rows[0]?.attempts > 0);
      await stop(); stop = undefined;
      const empty = await pool!.query("SELECT state,closure_state FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId]);
      expect(empty.rows[0]).toMatchObject({ state: "pending", closure_state: "open" });
      // No UI polling or webhook follows rejection. A grant appears after the
      // empty observation and process restart; the durable pump discovers it.
      visible = true;
      await pool!.query("UPDATE mcp_oauth_cleanup SET next_attempt_at=clock_timestamp() WHERE account_id=$1", [fixture.accountId]);
      stop = runPump();
      await awaitCondition(async () => (await pool!.query("SELECT state FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId])).rows[0]?.state === "confirmed");
      await stop(); stop = undefined;
      expect(deletedIds).toEqual([probe.nangoConnectionId]);
      expect(probe.proxyRequests()).toBe(0);
      const connection = await pool!.query("SELECT 1 FROM mcp_connections WHERE account_id=$1 AND id<>$2", [fixture.accountId, fixture.connectionId]);
      expect(connection.rowCount).toBe(0);
      const request = await pool!.query("SELECT state FROM mcp_interaction_requests WHERE account_id=$1", [fixture.accountId]);
      expect(request.rows[0].state).toBe("rejected");
      const watch = await pool!.query("SELECT closure_state FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId]);
      expect(watch.rows[0].closure_state).toBe("open");
    } finally { await stop?.(); await removeAccount(fixture.accountId); }
  });

  it("scrubs a private choice identifier from only the deleted Session while retaining call provenance", async () => {
    const fixture = await seed("choice-id-retention");
    const marker = "PRIVATE_FREEFORM_OPTION_patient_notes";
    const elsewhere = "PRESERVE_OTHER_SCOPE_OPTION";
    try {
      const { dependencies } = dependenciesWith(async () => successResult);
      const choose = async (optionId: string, sessionId?: string) => {
        const staged = await proposeMcpChoice(pool!, fixture.auth, {
          idempotency_key: `choice-${randomUUID()}`, options: [{ id: optionId, label: "Synthetic option" }, { id: "decline", label: "Decline" }],
          purpose: "Synthetic privacy check", ...(sessionId ? { session_id: sessionId } : {}),
        }, dependencies);
        await resolveMcpInteraction(pool!, fixture.auth, staged.request.id, {
          action: "submit", choice_id: optionId, expected_revision: staged.request.revision, idempotency_key: `choose-${randomUUID()}`,
        }, dependencies);
        return staged.request.id;
      };
      const choiceId = await choose(marker, fixture.sessionId);
      const otherChoiceId = await choose(elsewhere);
      const approval = await proposeMcpToolCall(pool!, fixture.auth, callPropose(fixture), dependencies);
      await resolveMcpInteraction(pool!, fixture.auth, approval.request.id, {
        action: "approve", expected_revision: approval.request.revision, idempotency_key: `approve-${randomUUID()}`,
      }, dependencies);
      const auditsBefore = await pool!.query("SELECT id,metadata FROM audit_events WHERE account_id=$1 AND entity_id=$2", [fixture.accountId, choiceId]);
      expect(JSON.stringify(auditsBefore.rows)).toContain(marker);
      await deleteConversation(fixture.accountId, fixture.sessionId);
      const requests = await pool!.query("SELECT * FROM mcp_interaction_requests WHERE account_id=$1 AND session_id=$2", [fixture.accountId, fixture.sessionId]);
      expect(JSON.stringify(requests.rows)).not.toContain(marker);
      expect(requests.rows.find((row) => row.id === choiceId)).toMatchObject({ state: "submitted", resolved_by_user_id: fixture.userId, resolution_display: null });
      const audit = await pool!.query("SELECT id,metadata FROM audit_events WHERE account_id=$1", [fixture.accountId]);
      expect(JSON.stringify(audit.rows)).not.toContain(marker);
      expect(JSON.stringify(audit.rows)).toContain(elsewhere);
      expect(audit.rows.filter((row) => auditsBefore.rows.some((old) => old.id === row.id))).toHaveLength(auditsBefore.rowCount!);
      const other = await pool!.query("SELECT resolution_display FROM mcp_interaction_requests WHERE account_id=$1 AND id=$2", [fixture.accountId, otherChoiceId]);
      expect(other.rows[0].resolution_display).toBe(`choice:${elsewhere}`);
      const session = await pool!.query("SELECT payload FROM agent_sessions WHERE account_id=$1 AND id=$2", [fixture.accountId, fixture.sessionId]);
      expect(session.rows[0].payload).toBeNull();
      const outbox = await pool!.query("SELECT body,result_metadata FROM mcp_continuation_outbox WHERE account_id=$1 AND session_id=$2", [fixture.accountId, fixture.sessionId]);
      expect(JSON.stringify(outbox.rows)).not.toContain(marker);
      const call = await pool!.query("SELECT id,request_id,connection_id,tool_name,state,executed_at FROM mcp_tool_calls WHERE account_id=$1", [fixture.accountId]);
      expect(call.rows[0]).toMatchObject({ id: approval.request.call_id, request_id: approval.request.id, connection_id: fixture.connectionId, tool_name: "lookup", state: "succeeded" });
      expect(call.rows[0].executed_at).not.toBeNull();
    } finally { await removeAccount(fixture.accountId); }
  });

  const admissionCases = ["wrong_account", "wrong_owner", "wrong_provider_tag", "wrong_endpoint",
    "foreign_config_with_matching_template", "template_without_config", "changed_broker", "changed_environment",
    ...["account_id", "user_id", "provider", "connect_request_id", "mcp_server_url"].map((tag) => `missing_${tag}`)];
  it.each(admissionCases.flatMap((caseName) => ["poll", "webhook"].map((path) => ({ caseName, path }))))(
    "rejects $caseName metadata before $path claim or any proxy request", async ({ caseName, path }) => {
      const fixture = await seed("oauth-admission-negative");
      try {
        const probe = await stageOAuthProbe(fixture);
        if (caseName === "wrong_account") probe.metadata.tags.account_id = randomUUID();
        else if (caseName === "wrong_owner") probe.metadata.tags.user_id = randomUUID();
        else if (caseName === "wrong_provider_tag") probe.metadata.tags.provider = "foreign-mcp-config";
        else if (caseName === "wrong_endpoint") probe.metadata.tags.mcp_server_url = `${probe.endpoint}?other=1`;
        else if (caseName === "foreign_config_with_matching_template") {
          probe.metadata.provider_config_key = "foreign-mcp-config"; probe.metadata.provider = "mcp-generic";
        } else if (caseName === "template_without_config") {
          delete probe.metadata.provider_config_key; probe.metadata.provider = "mcp-generic";
        } else if (caseName === "changed_broker") probe.dependencies.nangoConfig = { ...probe.dependencies.nangoConfig!, baseUrl: "https://different-broker.example.test" };
        else if (caseName === "changed_environment") probe.dependencies.nangoConfig = { ...probe.dependencies.nangoConfig!, environment: "OTHER" };
        else delete probe.metadata.tags[caseName.slice("missing_".length)];
        const outcome = path === "webhook" ? await probe.complete()
          : await pollNangoConnectRequest(pool!, fixture.auth, probe.connectRequestId, probe.dependencies);
        expect(outcome.status).toBe("ignored");
        expect(probe.proxyRequests()).toBe(0);
        const created = await pool!.query("SELECT 1 FROM mcp_connections WHERE account_id=$1 AND id<>$2", [fixture.accountId, fixture.connectionId]);
        expect(created.rowCount).toBe(0);
        const outbox = await pool!.query("SELECT 1 FROM mcp_continuation_outbox WHERE account_id=$1", [fixture.accountId]);
        expect(outbox.rowCount).toBe(0);
        const attempt = await pool!.query("SELECT nango_connection_id FROM mcp_oauth_connect_requests WHERE account_id=$1", [fixture.accountId]);
        expect(attempt.rows[0].nango_connection_id).toBeNull();
        const request = await pool!.query("SELECT state FROM mcp_interaction_requests WHERE account_id=$1", [fixture.accountId]);
        expect(request.rows[0].state).toBe("waiting");
      } finally { await removeAccount(fixture.accountId); }
    },
  );

  it("accepts full frozen metadata through production approval and owner polling", async () => {
    const fixture = await seed("oauth-admission-positive");
    try {
      const probe = await stageOAuthProbe(fixture);
      expect((await pollNangoConnectRequest(pool!, fixture.auth, probe.connectRequestId, probe.dependencies)).request?.state).toBe("submitted");
      expect(probe.proxyRequests()).toBe(3);
    } finally { await removeAccount(fixture.accountId); }
  });

  it.each(["owner", "account"])("holds %s authority through OAuth publication against a real PostgreSQL revoke barrier", async (scope) => {
    const fixture = await seed("oauth-sql-barrier");
    const held = barrier();
    const release = barrier();
    let authorityReads = 0;
    const probe = await stageOAuthProbe(fixture);
    // Wrap only this operation's clients; never patch the shared pooled client.
    const db = new Proxy(pool!, { get(target, property) {
      if (property !== "connect") { const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; }
      return async () => {
        const client = await target.connect();
        return new Proxy(client, { get(connection, key) {
          if (key !== "query") { const value = Reflect.get(connection, key); return typeof value === "function" ? value.bind(connection) : value; }
          return async (...args: unknown[]) => {
            const result = await Reflect.apply(connection.query, connection, args);
            if (typeof args[0] === "string" && /SELECT status FROM users\s+WHERE account_id = \$1 AND id = \$2 FOR SHARE/.test(args[0]) && ++authorityReads === 3) {
              held.resolve(); await release.promise;
            }
            return result;
          };
        } });
      };
    } }) as Pool;
    const competing = await pool!.connect();
    let completion: ReturnType<typeof probe.complete> | undefined;
    let revoke: Promise<unknown> | undefined;
    try {
      const pid = (await competing.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      completion = probe.complete(db);
      await held.promise;
      revoke = scope === "owner"
        ? competing.query("UPDATE users SET status='revoked' WHERE account_id=$1 AND id=$2", [fixture.accountId, fixture.userId])
        : competing.query("UPDATE accounts SET retired_at=clock_timestamp() WHERE id=$1", [fixture.accountId]);
      await awaitSqlLockWait(pid);
      release.resolve();
      expect((await completion).request?.state).toBe("submitted");
      await revoke;
      expect(probe.dispatches()).toBe(1);
      const attempt = await pool!.query("SELECT state FROM mcp_oauth_connect_requests WHERE account_id=$1", [fixture.accountId]);
      expect(attempt.rows[0].state).toBe("completed");
      const connection = await pool!.query("SELECT status,tools_count FROM mcp_connections WHERE account_id=$1 AND auth_mode='oauth'", [fixture.accountId]);
      expect(connection.rows[0]).toMatchObject({ status: "verified", tools_count: 1 });
    } finally {
      release.resolve(); await completion?.catch(() => undefined); await revoke?.catch(() => undefined);
      competing.release(); await removeAccount(fixture.accountId);
    }
  }, 15000);

  it("does not overwrite a disconnect committed during the OAuth handshake", async () => {
    const fixture = await seed("oauth-disconnect-barrier");
    try {
      const probe = await stageOAuthProbe(fixture, async () => {
        const connection = await pool!.query("SELECT id,revision FROM mcp_connections WHERE account_id=$1 AND auth_mode='oauth'", [fixture.accountId]);
        await disconnectMcpConnection(pool!, fixture.auth, connection.rows[0].id, {
          expected_revision: connection.rows[0].revision, idempotency_key: `disconnect-${randomUUID()}`,
        });
      });
      expect((await probe.complete()).request?.state).toBe("failed");
      const result = await pool!.query("SELECT state,resolution_display FROM mcp_interaction_requests WHERE account_id=$1", [fixture.accountId]);
      expect(result.rows[0]).toMatchObject({ state: "failed", resolution_display: "oauth_connection_changed" });
      const connection = await pool!.query("SELECT status,auth_mode,nango_connection_id,tools_count FROM mcp_connections WHERE account_id=$1 AND id<>$2", [fixture.accountId, fixture.connectionId]);
      expect(connection.rows[0]).toMatchObject({ status: "disconnected", auth_mode: "anonymous", nango_connection_id: null, tools_count: 0 });
      expect(probe.dispatches()).toBe(1);
      const cleanup = await pool!.query("SELECT nango_connection_id FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId]);
      expect(cleanup.rows.some((row) => row.nango_connection_id === probe.nangoConnectionId)).toBe(true);
    } finally { await removeAccount(fixture.accountId); }
  });

  it("does not overwrite a newer revision of the same OAuth binding", async () => {
    const fixture = await seed("oauth-revision-barrier");
    try {
      const probe = await stageOAuthProbe(fixture, async () => {
        // A separate accepted connection edit preserves the grant identity but
        // advances its generation while the original handshake is in flight.
        await pool!.query("UPDATE mcp_connections SET friendly_name='Newer edit',revision=revision+1 WHERE account_id=$1 AND auth_mode='oauth'", [fixture.accountId]);
      });
      expect((await probe.complete()).request?.state).toBe("failed");
      const connection = await pool!.query("SELECT status,revision,friendly_name,tools_count FROM mcp_connections WHERE account_id=$1 AND auth_mode='oauth'", [fixture.accountId]);
      expect(connection.rows[0]).toMatchObject({ status: "disconnected", revision: 2, friendly_name: "Newer edit", tools_count: 0 });
      const cleanup = await pool!.query("SELECT 1 FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId]);
      // A newer local edit of a still-live binding is not authorization to
      // destroy its credential in the cleanup worker.
      expect(cleanup.rowCount).toBe(0);
    } finally { await removeAccount(fixture.accountId); }
  });

  it.each(["verified", "withdrawn", "edited"])("recovers the original OAuth binding through atomic publication (%s)", async (scenario) => {
    const withdrawn = scenario === "withdrawn";
    const edited = scenario === "edited";
    const fixture = await seed(`oauth-restart-${scenario}`);
    try {
      const probe = await stageOAuthProbe(fixture, async () => {
        if (withdrawn) await pool!.query("UPDATE users SET status='revoked' WHERE account_id=$1 AND id=$2", [fixture.accountId, fixture.userId]);
      });
      const connectionId = randomUUID();
      // Crash snapshot: claim/insert committed; neither handshake nor publication happened.
      await pool!.query("UPDATE mcp_interaction_requests SET state='submitting',work_connection_id=$2 WHERE account_id=$1", [fixture.accountId, connectionId]);
      await pool!.query("UPDATE mcp_oauth_connect_requests SET nango_connection_id=$2 WHERE account_id=$1", [fixture.accountId, probe.nangoConnectionId]);
      await pool!.query(`INSERT INTO mcp_connections(account_id,id,created_by_user_id,friendly_name,server_url,status,auth_mode,nango_connection_id,nango_provider)
        VALUES($1,$2,$3,'Restart probe',$4,'disconnected','oauth',$5,'mcp-generic')`,
      [fixture.accountId, connectionId, fixture.userId, probe.endpoint, probe.nangoConnectionId]);
      if (edited) await pool!.query("UPDATE mcp_connections SET revision=revision+1,friendly_name='Edit before restart' WHERE account_id=$1 AND id=$2", [fixture.accountId, connectionId]);
      await recoverAbandonedMcpConnectionWork(pool!, probe.dependencies, fixture.auth, 0);
      const requests = await pool!.query("SELECT state,resolution_display FROM mcp_interaction_requests WHERE account_id=$1", [fixture.accountId]);
      expect(requests.rows[0]).toMatchObject({ state: withdrawn || edited ? "failed" : "submitted", resolution_display: withdrawn ? "owner_withdrawn" : edited ? "oauth_connection_changed" : "oauth_verified" });
      const connections = await pool!.query("SELECT id,status,tools_count FROM mcp_connections WHERE account_id=$1 AND id<>$2", [fixture.accountId, fixture.connectionId]);
      expect(connections.rows).toHaveLength(1);
      expect(connections.rows[0]).toMatchObject({ id: connectionId, status: withdrawn ? "failed" : edited ? "disconnected" : "verified", tools_count: withdrawn || edited ? 0 : 1 });
      const attempt = await pool!.query("SELECT state FROM mcp_oauth_connect_requests WHERE account_id=$1", [fixture.accountId]);
      expect(attempt.rows[0].state).toBe(withdrawn || edited ? "failed" : "completed");
      expect(probe.dispatches()).toBe(edited ? 0 : 1);
      const outbox = await pool!.query("SELECT 1 FROM mcp_continuation_outbox WHERE account_id=$1", [fixture.accountId]);
      expect(outbox.rowCount).toBe(withdrawn ? 0 : 1);
    } finally { await removeAccount(fixture.accountId); }
  });

  it("settles OAuth atomically when the owner is withdrawn mid-handshake", async () => {
    const fixture = await seed("oauth-atomic");
    const nangoConfig = {
      apiKey: "test-key",
      baseUrl: "https://api.nango.dev",
      environment: "DEV",
      webhookSigningKey: "test-signing-key",
    };
    const connectRequestId = "mcpconn_atomic01";
    const webhookBody = JSON.stringify({
      type: "auth",
      operation: "creation",
      connectionId: "conn-atomic-1",
      providerConfigKey: "mcp-generic",
      provider: "mcp-generic",
      environment: "DEV",
      success: true,
      tags: { connect_request_id: connectRequestId },
    });
    const signature = (await import("node:crypto"))
      .createHmac("sha256", nangoConfig.webhookSigningKey)
      .update(webhookBody)
      .digest("hex");
    let revoked = false;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/connect/sessions")) {
        return new Response(
          JSON.stringify({
            data: {
              connect_link: "https://connect.example.test/ui",
              expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              token: "session-token-atomic",
            },
          }),
          { status: 201 },
        );
      }
      if (url.includes("/connections?")) {
        return new Response(
          JSON.stringify({
            connections: [
              {
                connection_id: "conn-atomic-1",
                created: "2026-10-04T00:00:00.000Z",
                provider_config_key: "mcp-generic",
                tags: {
                  connect_request_id: connectRequestId,
                  mcp_server_url: "https://atomic.example.test/mcp",
                  account_id: fixture.accountId, user_id: fixture.userId, provider: "mcp-generic",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/proxy/")) {
        // The real OAuth handshake travels through the frozen Nango proxy;
        // the barrier withdraws the owner mid-handshake, between the claim
        // and the settlement.
        const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
        if (body.method === "initialize") {
          revoked = true;
          await pool!.query("UPDATE users SET status='revoked' WHERE account_id=$1 AND id=$2", [
            fixture.accountId,
            fixture.userId,
          ]);
          return new Response(
            JSON.stringify({
              id: body.id,
              jsonrpc: "2.0",
              result: {
                capabilities: {},
                protocolVersion: "2025-11-25",
                serverInfo: { name: "proxy-synthetic", version: "1" },
              },
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          );
        }
        if (body.method === "notifications/initialized") return new Response("", { status: 202 });
        return new Response(
          JSON.stringify({
            id: body.id,
            jsonrpc: "2.0",
            result: {
              tools: [
                {
                  description: "probe",
                  inputSchema: { type: "object", properties: {} },
                  name: "probe",
                },
              ],
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const { dependencies } = dependenciesWith(async () => successResult, [], {
      fetcher,
      nangoConfig,
    });
    try {
      const staged = await proposeMcpConnection(
        pool!,
        fixture.auth,
        {
          auth_mode: "oauth",
          friendly_name: "Atomic server",
          idempotency_key: `at-${randomUUID()}`,
          purpose: "Add the atomic server.",
          server_url: "https://atomic.example.test/mcp",
          session_id: fixture.sessionId,
        },
        dependencies,
      );
      await pool!.query(
        `UPDATE mcp_oauth_connect_requests SET connect_request_id=$2
         WHERE account_id=$1`,
        [fixture.accountId, connectRequestId],
      );
      await pool!.query("UPDATE mcp_interaction_requests SET state='waiting' WHERE account_id=$1", [fixture.accountId]);
      const { parseNangoAuthWebhook } = await import("./nango.js");
      const outcome = await applyNangoAuthWebhook(
        pool!,
        webhookBody,
        signature,
        parseNangoAuthWebhook(webhookBody),
        dependencies,
      );
      expect(outcome.status).toBe("applied");
      expect(revoked).toBe(true);
      // The atomic settlement saw the withdrawal: no usable connection, no
      // resurrected authority, minimal failed outcome only.
      const connections = await pool!.query<{ status: string; tools_count: number }>(
        "SELECT status, tools_count FROM mcp_connections WHERE account_id=$1 AND auth_mode='oauth'",
        [fixture.accountId],
      );
      expect(connections.rows).toHaveLength(1);
      expect(connections.rows[0]).toMatchObject({ status: "failed", tools_count: 0 });
      const requests = await pool!.query<{ state: string; resolution_display: string | null }>(
        "SELECT state, resolution_display FROM mcp_interaction_requests WHERE account_id=$1",
        [fixture.accountId],
      );
      expect(requests.rows[0]!.state).toBe("failed");
      expect(requests.rows[0]!.resolution_display).toBe("owner_withdrawn");
      const outbox = await pool!.query("SELECT 1 FROM mcp_continuation_outbox WHERE account_id=$1", [fixture.accountId]);
      expect(outbox.rows).toHaveLength(0);
      const attempt = await pool!.query<{ state: string }>(
        "SELECT state FROM mcp_oauth_connect_requests WHERE account_id=$1",
        [fixture.accountId],
      );
      expect(attempt.rows[0]!.state).toBe("failed");
      await pool!.query("UPDATE users SET status='active' WHERE account_id=$1 AND id=$2", [fixture.accountId, fixture.userId]);
    } finally {
      await pool!.query("UPDATE users SET status='active' WHERE account_id=$1 AND id=$2", [fixture.accountId, fixture.userId]).catch(() => undefined);
      await removeAccount(fixture.accountId);
    }
  });

  it("keeps an in-flight OAuth deletion to minimal outcome with no capability", async () => {
    const fixture = await seed("oauth-delete-race");
    const nangoConfig = {
      apiKey: "test-key",
      baseUrl: "https://api.nango.dev",
      environment: "DEV",
      webhookSigningKey: "test-signing-key",
    };
    const connectRequestId = "mcpconn_delrace01";
    const webhookBody = JSON.stringify({
      type: "auth",
      operation: "creation",
      connectionId: "conn-del-1",
      providerConfigKey: "mcp-generic",
      provider: "mcp-generic",
      environment: "DEV",
      success: true,
      tags: { connect_request_id: connectRequestId },
    });
    const signature = (await import("node:crypto"))
      .createHmac("sha256", nangoConfig.webhookSigningKey)
      .update(webhookBody)
      .digest("hex");
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/connect/sessions")) {
        return new Response(
          JSON.stringify({
            data: {
              connect_link: "https://connect.example.test/ui",
              expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              token: "session-token-delrace",
            },
          }),
          { status: 201 },
        );
      }
      if (String(input).includes("/connections?")) {
        return new Response(
          JSON.stringify({
            connections: [
              {
                connection_id: "conn-del-1",
                created: "2026-10-04T00:00:00.000Z",
                provider_config_key: "mcp-generic",
                tags: {
                  connect_request_id: connectRequestId,
                  mcp_server_url: "https://delrace.example.test/mcp",
                  account_id: fixture.accountId, user_id: fixture.userId, provider: "mcp-generic",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (String(input).includes("/proxy/")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
        if (body.method === "initialize") {
          // The conversation is deleted mid-handshake, between claim and
          // settlement, through the same transactional scrub production uses.
          deletionRef.promise = deleteConversation(fixture.accountId, fixture.sessionId);
          await deletionRef.promise;
          return new Response(
            JSON.stringify({
              id: body.id,
              jsonrpc: "2.0",
              result: {
                capabilities: {},
                protocolVersion: "2025-11-25",
                serverInfo: { name: "proxy-synthetic", version: "1" },
              },
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          );
        }
        if (body.method === "notifications/initialized") return new Response("", { status: 202 });
        return new Response(
          JSON.stringify({
            id: body.id,
            jsonrpc: "2.0",
            result: {
              tools: [
                { description: "probe", inputSchema: { type: "object", properties: {} }, name: "probe" },
              ],
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const deletionRef: { promise: Promise<void> | null } = { promise: null };
    const { dependencies } = dependenciesWith(async () => successResult, [], {
      fetcher,
      nangoConfig,
    });
    try {
      await proposeMcpConnection(
        pool!,
        fixture.auth,
        {
          auth_mode: "oauth",
          friendly_name: "Delrace server",
          idempotency_key: `dr-${randomUUID()}`,
          purpose: "Add the delrace server.",
          server_url: "https://delrace.example.test/mcp",
          session_id: fixture.sessionId,
        },
        dependencies,
      );
      await pool!.query(
        `UPDATE mcp_oauth_connect_requests SET connect_request_id=$2 WHERE account_id=$1`,
        [fixture.accountId, connectRequestId],
      );
      await pool!.query("UPDATE mcp_interaction_requests SET state='waiting' WHERE account_id=$1", [fixture.accountId]);
      const { parseNangoAuthWebhook } = await import("./nango.js");
      await applyNangoAuthWebhook(
        pool!,
        webhookBody,
        signature,
        parseNangoAuthWebhook(webhookBody),
        dependencies,
      );
      const connections = await pool!.query<{ status: string }>(
        "SELECT status FROM mcp_connections WHERE account_id=$1 AND auth_mode='oauth'",
        [fixture.accountId],
      );
      // A dead conversation leaves no usable capability and no private outbox.
      expect(connections.rows[0]!.status).toBe("failed");
      const outbox = await pool!.query("SELECT 1 FROM mcp_continuation_outbox WHERE account_id=$1", [fixture.accountId]);
      expect(outbox.rows).toHaveLength(0);
    } finally {
      await deletionRef.promise?.catch(() => undefined);
      await removeAccount(fixture.accountId);
    }
  });
  it("redacts secret-shaped remote echo from the public result receipt", async () => {
    const fixture = await seed("echo");
    try {
      const { dependencies } = dependenciesWith(async () => ({
        ...successResult,
        resultText: JSON.stringify({
          content: [
            {
              text: "remote echo: Bearer tsuper-secret-bearer-value-123456 and api_key=abc",
              type: "text",
            },
          ],
        }),
      }));
      const staged = await proposeMcpToolCall(pool!, fixture.auth, callPropose(fixture), dependencies);
      const resolved = await resolveMcpInteraction(
        pool!,
        fixture.auth,
        staged.request.id,
        { action: "approve", expected_revision: staged.request.revision, idempotency_key: `echo-${randomUUID()}` },
        dependencies,
      );
      const serialized = JSON.stringify(resolved.request.receipt);
      expect(serialized).not.toContain("tsuper-secret-bearer-value-123456");
    } finally {
      await removeAccount(fixture.accountId);
    }
  });
});
